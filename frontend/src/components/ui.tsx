/** Small, dependency-free UI kit used across the app. */
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Verdict } from '@automata/shared';
import { api, errorMessage } from '../lib/api';
import { useToasts } from '../lib/stores';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/* ------------------------------ buttons ------------------------------ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 dark:text-slate-950',
  secondary: 'border border-line bg-panel text-ink hover:bg-raised',
  ghost: 'text-ink hover:bg-raised',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** Square icon-only button; `label` is both the tooltip and the accessible name. */
export function IconButton({ label, active, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      {...rest}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-accent text-white dark:text-slate-950' : 'text-ink hover:bg-raised',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------- layout ------------------------------ */

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex items-start justify-between p-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      {icon && <div className="rounded-md bg-accent/10 p-2 text-accent">{icon}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'violet';
const TONES: Record<Tone, string> = {
  neutral: 'bg-raised text-muted',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  violet: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', TONES[tone])}>
      {children}
    </span>
  );
}

const VERDICT: Record<Verdict, { tone: Tone; label: string }> = {
  correct: { tone: 'green', label: 'Correct' },
  partial: { tone: 'amber', label: 'Partially correct' },
  incorrect: { tone: 'red', label: 'Incorrect' },
  invalid: { tone: 'red', label: 'Invalid' },
  needs_review: { tone: 'blue', label: 'Needs review' },
};
export const VerdictBadge = ({ verdict }: { verdict: Verdict }) => <Badge tone={VERDICT[verdict].tone}>{VERDICT[verdict].label}</Badge>;

/** Label that states whether a result is an exact decision or bounded testing. */
export const MethodBadge = ({ exact }: { exact: boolean }) =>
  exact ? (
    <Badge tone="violet" title="Decided by an exact algorithm (language equivalence).">
      Exact
    </Badge>
  ) : (
    <Badge tone="blue" title="Compared on a bounded set of strings only. Not a proof of equivalence.">
      Bounded testing
    </Badge>
  );

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

/* ------------------------------- states ------------------------------ */

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
  </div>
);

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success' | 'warn'; children: ReactNode }) {
  const styles = {
    info: 'border-sky-300/60 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
    error: 'border-red-300/60 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
    success: 'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
    warn: 'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  }[tone];
  const Icon = tone === 'error' || tone === 'warn' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div role={tone === 'error' ? 'alert' : 'note'} className={cx('flex gap-2 rounded-md border px-3 py-2 text-sm', styles)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const ErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="py-6">
    <Notice tone="error">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        {onRetry && (
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </Notice>
  </div>
);

/* -------------------------------- modal ------------------------------ */

const openModals: object[] = [];

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose in a ref so the focus effect runs only once per open
  // (otherwise every parent re-render would steal focus back to the first field).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Dialogs can nest (e.g. a transition label inside the question dialog):
    // Escape closes only the one on top.
    const token = {};
    openModals.push(token);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openModals[openModals.length - 1] === token && close.current();
    window.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    // Focus the first field (or the dialog itself) so keyboard users land inside.
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, [data-autofocus]');
    (first ?? ref.current)?.focus({ preventScroll: true }); // keep long dialogs scrolled to the top
    return () => {
      openModals.splice(openModals.indexOf(token), 1);
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx('flex max-h-[92vh] w-full flex-col rounded-t-xl border border-line bg-panel shadow-xl sm:rounded-xl', wide ? 'sm:max-w-5xl' : 'sm:max-w-lg')}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------- toasts ------------------------------ */

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto flex items-start gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg',
            t.kind === 'error' ? 'border-red-400/60' : t.kind === 'success' ? 'border-emerald-400/60' : 'border-line',
          )}
        >
          {t.kind === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
          )}
          <span className="flex-1">{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- data loading --------------------------- */

/** Load JSON from the API with loading / error state and a reload function. */
export function useFetch<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get<T>(path)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e) => !cancelled && setState((s) => ({ data: s.data, error: errorMessage(e), loading: false })));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export const formatDate = (iso: string | null | undefined, withTime = true) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
};

/** Show a symbol string with ε for the empty string. */
export const showInput = (s: string) => (s === '' ? 'ε' : s);
