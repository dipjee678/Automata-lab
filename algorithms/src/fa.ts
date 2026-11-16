/**
 * Finite automata: validation, ε-closure and step-by-step simulation.
 *
 * Everything here works directly on the editor's `Automaton` JSON so the
 * simulator can report state ids / transition ids for highlighting.
 */
import type { Automaton, AutomatonType, Transition } from '@automata/shared';
import { EPSILON } from '@automata/shared';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export const isFiniteAutomaton = (t: AutomatonType) => t === 'DFA' || t === 'NFA' || t === 'ENFA';

/** Sorted input alphabet: explicit alphabet ∪ every non-ε symbol on a transition. */
export function alphabetOf(a: Automaton, extra: string[] = []): string[] {
  const set = new Set<string>([...(a.alphabet ?? []), ...extra]);
  for (const t of a.transitions) if (t.symbol !== '') set.add(t.symbol);
  return [...set].sort();
}

export const labelOf = (a: Automaton, id: string) => a.states.find((s) => s.id === id)?.label ?? id;

/** Human readable label for one transition (used in messages and on edges). */
export function transitionLabel(type: AutomatonType, t: Transition): string {
  const e = (s: string | undefined) => (s === undefined || s === '' ? EPSILON : s);
  if (type === 'PDA') return `${e(t.symbol)}, ${e(t.pop)} → ${e(t.push)}`;
  if (type === 'TM') return `${t.symbol} → ${t.write ?? t.symbol}, ${t.move ?? 'R'}`;
  return e(t.symbol);
}

/**
 * Structural validation for any automaton type.
 * `as` lets the grader validate a submission against the type a question
 * demands (e.g. an editor automaton tagged NFA that must be a DFA).
 */
export function validateAutomaton(
  a: Automaton,
  opts: { as?: AutomatonType; alphabet?: string[]; requireComplete?: boolean } = {},
): ValidationResult {
  const type = opts.as ?? a.type;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(a.states.map((s) => s.id));

  if (a.states.length === 0) {
    errors.push('The automaton has no states.');
    return { errors, warnings };
  }
  if (ids.size !== a.states.length) errors.push('Two states share the same internal id.');

  const labels = new Map<string, number>();
  for (const s of a.states) labels.set(s.label, (labels.get(s.label) ?? 0) + 1);
  for (const [l, n] of labels) if (n > 1) warnings.push(`${n} states are named "${l}".`);

  const initials = a.states.filter((s) => s.initial);
  if (initials.length === 0) errors.push('No initial state is set.');
  if (initials.length > 1)
    errors.push(`There must be exactly one initial state (found ${initials.length}: ${initials.map((s) => s.label).join(', ')}).`);

  for (const t of a.transitions) {
    if (!ids.has(t.from) || !ids.has(t.to)) errors.push(`A transition refers to a state that does not exist.`);
  }
  if (errors.length) return { errors, warnings };

  const L = (id: string) => labelOf(a, id);

  if (isFiniteAutomaton(type)) {
    for (const t of a.transitions) {
      if ([...t.symbol].length > 1)
        errors.push(`Transition ${L(t.from)} → ${L(t.to)}: "${t.symbol}" is not a single symbol.`);
      if (t.symbol === '' && type !== 'ENFA')
        errors.push(`Transition ${L(t.from)} → ${L(t.to)} is an ε-transition, which a ${type} may not have.`);
    }
    if (type === 'DFA') {
      const seen = new Map<string, string>();
      for (const t of a.transitions) {
        if (t.symbol === '') continue;
        const key = `${t.from}\u0000${t.symbol}`;
        const prev = seen.get(key);
        if (prev !== undefined && prev !== t.to)
          errors.push(`Nondeterminism: state ${L(t.from)} has more than one transition on "${t.symbol}".`);
        seen.set(key, t.to);
      }
      const sigma = alphabetOf(a, opts.alphabet);
      const missing: string[] = [];
      for (const s of a.states)
        for (const c of sigma) if (!seen.has(`${s.id}\u0000${c}`)) missing.push(`δ(${s.label}, ${c})`);
      if (missing.length) {
        const msg = `Missing transition${missing.length > 1 ? 's' : ''}: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? `, … (${missing.length} total)` : ''}.`;
        if (opts.requireComplete) errors.push(`${msg} The transition function must be total.`);
        else warnings.push(`${msg} Missing transitions are treated as going to an implicit dead state.`);
      }
    }
  }

  if (type === 'PDA') {
    for (const t of a.transitions) {
      if ([...t.symbol].length > 1) errors.push(`Transition ${L(t.from)} → ${L(t.to)}: input "${t.symbol}" must be one symbol or ε.`);
      if ([...(t.pop ?? '')].length > 1) errors.push(`Transition ${L(t.from)} → ${L(t.to)}: pop "${t.pop}" must be one stack symbol or ε.`);
    }
  }

  if (type === 'TM') {
    const seen = new Set<string>();
    for (const t of a.transitions) {
      if ([...t.symbol].length !== 1) errors.push(`Transition ${L(t.from)} → ${L(t.to)}: read symbol must be exactly one tape symbol.`);
      if ([...(t.write ?? t.symbol)].length !== 1) errors.push(`Transition ${L(t.from)} → ${L(t.to)}: write symbol must be exactly one tape symbol.`);
      const key = `${t.from}\u0000${t.symbol}`;
      if (seen.has(key)) errors.push(`Nondeterminism: state ${L(t.from)} has two transitions reading "${t.symbol}". Only deterministic Turing machines are supported.`);
      seen.add(key);
    }
  }

  // Reachability (warning only – unreachable states never change the language).
  const init = initials[0]!;
  const reach = new Set([init.id]);
  const stack = [init.id];
  while (stack.length) {
    const q = stack.pop()!;
    for (const t of a.transitions)
      if (t.from === q && !reach.has(t.to)) {
        reach.add(t.to);
        stack.push(t.to);
      }
  }
  const unreachable = a.states.filter((s) => !reach.has(s.id));
  if (unreachable.length) warnings.push(`Unreachable state${unreachable.length > 1 ? 's' : ''}: ${unreachable.map((s) => s.label).join(', ')}.`);
  if (!a.states.some((s) => s.accepting)) warnings.push('There is no accepting state, so no string is accepted.');

  return { errors, warnings };
}

/* ------------------------------------------------------------------ */
/* ε-closure                                                           */
/* ------------------------------------------------------------------ */

/**
 * ε-closure of a set of states: every state reachable using only
 * ε-transitions. `used` (optional) collects the ε-transition ids followed.
 */
export function epsilonClosure(a: Automaton, states: Iterable<string>, used?: Set<string>): Set<string> {
  const closure = new Set<string>(states);
  const stack = [...closure];
  while (stack.length) {
    const q = stack.pop()!;
    for (const t of a.transitions) {
      if (t.from !== q || t.symbol !== '') continue;
      if (used && closure.has(t.from)) used.add(t.id);
      if (!closure.has(t.to)) {
        closure.add(t.to);
        stack.push(t.to);
      }
    }
  }
  return closure;
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

export interface FAStep {
  /** Number of input symbols consumed so far. */
  consumed: number;
  /** Symbol read to get here (null for the initial configuration). */
  symbol: string | null;
  /** Ids of all active states after this step (one for a DFA). */
  active: string[];
  /** Ids of the transitions taken during this step (for highlighting). */
  transitions: string[];
}

export interface FATrace {
  input: string[];
  steps: FAStep[];
  accepted: boolean;
  /** Set when the machine died before consuming the whole input. */
  stuckAt: number | null;
  message: string;
}

/** Split an input string into single-character symbols. */
export const toSymbols = (input: string): string[] => [...input];

/**
 * Simulate a DFA / NFA / ε-NFA on `input`, tracking the full set of active
 * states. For a DFA that set always has at most one element, so the same
 * routine serves all three machine types.
 */
export function simulateFA(a: Automaton, input: string): FATrace {
  const symbols = toSymbols(input);
  const init = a.states.find((s) => s.initial);
  if (!init) throw new Error('No initial state is set.');

  const order = new Map(a.states.map((s, i) => [s.id, i]));
  const sorted = (set: Set<string>) => [...set].sort((x, y) => order.get(x)! - order.get(y)!);

  const steps: FAStep[] = [];
  let used = new Set<string>();
  let current = epsilonClosure(a, [init.id], used);
  steps.push({ consumed: 0, symbol: null, active: sorted(current), transitions: [...used] });

  let stuckAt: number | null = null;
  for (let i = 0; i < symbols.length; i++) {
    const c = symbols[i]!;
    used = new Set<string>();
    const moved = new Set<string>();
    for (const t of a.transitions) {
      if (t.symbol === c && current.has(t.from)) {
        moved.add(t.to);
        used.add(t.id);
      }
    }
    current = epsilonClosure(a, moved, used);
    steps.push({ consumed: i + 1, symbol: c, active: sorted(current), transitions: [...used] });
    if (current.size === 0) {
      stuckAt = i;
      break;
    }
  }

  const accepted = stuckAt === null && a.states.some((s) => s.accepting && current.has(s.id));
  const names = sorted(current).map((id) => labelOf(a, id));
  let message: string;
  if (stuckAt !== null)
    message = `Rejected: no transition on "${symbols[stuckAt]}" at position ${stuckAt + 1}, so the machine has no active state left.`;
  else if (accepted)
    message = `Accepted: the input ends in ${names.length > 1 ? `states {${names.join(', ')}}, which include` : `state ${names[0]}, which is`} an accepting state.`;
  else
    message = `Rejected: the input ends in ${names.length > 1 ? `states {${names.join(', ')}}, none of which is accepting` : `state ${names[0]}, which is not accepting`}.`;

  return { input: symbols, steps, accepted, stuckAt, message };
}

export const acceptsFA = (a: Automaton, input: string): boolean => simulateFA(a, input).accepted;
