/** Global client state (Zustand): session, theme, toasts and the editor workspace. */
import { create } from 'zustand';
import { emptyAutomaton, type Automaton, type AutomatonType, type Profile } from '@automata/shared';
import { api, setUnauthorizedHandler, tokenStore } from './api';

/* ------------------------------ session ------------------------------ */

interface AuthState {
  user: Profile | null;
  status: 'loading' | 'ready';
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; full_name: string; role: 'student' | 'teacher' }) => Promise<void>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  init: async () => {
    if (!tokenStore.get()) return set({ status: 'ready' });
    try {
      const { user } = await api.get<{ user: Profile }>('/auth/me');
      set({ user, status: 'ready' });
    } catch {
      tokenStore.set(null);
      set({ user: null, status: 'ready' });
    }
  },
  login: async (email, password) => {
    const { token, user } = await api.post<{ token: string; user: Profile }>('/auth/login', { email, password });
    tokenStore.set(token);
    set({ user });
  },
  register: async (input) => {
    const { token, user } = await api.post<{ token: string; user: Profile }>('/auth/register', input);
    tokenStore.set(token);
    set({ user });
  },
  logout: () => {
    tokenStore.set(null);
    set({ user: null });
  },
}));

setUnauthorizedHandler(() => {
  if (useAuth.getState().user) {
    useAuth.getState().logout();
    toast('info', 'Your session has expired. Please sign in again.');
  }
});

/* ------------------------------- theme ------------------------------- */

interface ThemeState {
  dark: boolean;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  dark: typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  toggle: () => {
    const dark = !get().dark;
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('automata.theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
    set({ dark });
  },
}));

/* ------------------------------- toasts ------------------------------ */

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  dismiss: (id: number) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

let toastId = 0;
export function toast(kind: Toast['kind'], message: string) {
  const id = ++toastId;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
  setTimeout(() => useToasts.getState().dismiss(id), kind === 'error' ? 7000 : 4000);
}

/* ----------------------------- workspace ----------------------------- */

const DRAFT_KEY = 'automata.draft';

interface WorkspaceState {
  automaton: Automaton;
  name: string;
  /** Id of the saved automaton this document came from (null = never saved). */
  savedId: string | null;
  /** Bumped whenever the document is REPLACED, so the canvas remounts with the new content. */
  docKey: number;
  dirty: boolean;
  /** Edits coming from the canvas. */
  edit: (automaton: Automaton) => void;
  /** Replace the whole document (open, new, load example, convert type). */
  load: (automaton: Automaton, name?: string, savedId?: string | null) => void;
  setName: (name: string) => void;
  markSaved: (savedId: string) => void;
}

function readDraft(): { automaton: Automaton; name: string; savedId: string | null } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft && Array.isArray(draft.automaton?.states) && Array.isArray(draft.automaton?.transitions)) return draft;
  } catch {
    /* ignore a corrupt draft */
  }
  return null;
}

const writeDraft = (s: Pick<WorkspaceState, 'automaton' | 'name' | 'savedId'>) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ automaton: s.automaton, name: s.name, savedId: s.savedId }));
  } catch {
    /* ignore */
  }
};

const draft = typeof localStorage !== 'undefined' ? readDraft() : null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  automaton: draft?.automaton ?? emptyAutomaton('DFA'),
  name: draft?.name ?? 'Untitled automaton',
  savedId: draft?.savedId ?? null,
  docKey: 0,
  dirty: false,
  edit: (automaton) => {
    set({ automaton, dirty: true });
    writeDraft(get());
  },
  load: (automaton, name, savedId = null) => {
    set((s) => ({ automaton, name: name ?? s.name, savedId, docKey: s.docKey + 1, dirty: false }));
    writeDraft(get());
  },
  setName: (name) => {
    set({ name, dirty: true });
    writeDraft(get());
  },
  markSaved: (savedId) => {
    set({ savedId, dirty: false });
    writeDraft(get());
  },
}));

/**
 * Re-tag an automaton as another machine type, filling in or dropping the
 * fields that only some types use so the result is well-formed.
 */
export function convertType(a: Automaton, type: AutomatonType): Automaton {
  const transitions = a.transitions
    .map((t) => {
      const base = { id: t.id, from: t.from, to: t.to, symbol: t.symbol };
      if (type === 'PDA') return { ...base, pop: t.pop ?? '', push: t.push ?? '' };
      if (type === 'TM') return { ...base, symbol: t.symbol === '' ? '_' : t.symbol, write: t.write ?? (t.symbol === '' ? '_' : t.symbol), move: t.move ?? ('R' as const) };
      return base;
    })
    // ε-moves are only legal in an ε-NFA (and a PDA).
    .filter((t) => type === 'ENFA' || type === 'PDA' || type === 'TM' || t.symbol !== '');
  return { type, states: a.states, transitions };
}
