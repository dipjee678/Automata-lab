/**
 * Parsing of transition labels typed by users, and a compact builder for
 * writing automata in code (seed data, practice problems, tests).
 */
import type { Automaton, AutomatonType, State, Transition } from '@automata/shared';
import { BLANK } from '@automata/shared';
import { layeredLayout } from './layout';

type LabelParts = Pick<Transition, 'symbol' | 'pop' | 'push' | 'write' | 'move'>;

const EPS = new Set(['', 'ε', 'ϵ', 'λ', 'eps', 'epsilon', '\\e']);
const eps = (s: string) => (EPS.has(s) ? '' : s);
const ARROW = /->|→|\//;

/**
 * Parse the text of an edge label into one or more transitions.
 *   Finite automata :  a        0,1        ε
 *   PDA             :  a, Z → AZ ; ε, ε → ε        (read, pop → push)
 *   Turing machine  :  a → b, R ; _ → _, L         (read → write, move)
 */
export function parseTransitionLabel(type: AutomatonType, text: string): { parts: LabelParts[]; error: string | null } {
  const fail = (error: string) => ({ parts: [], error });
  const trimmed = text.trim();

  if (type === 'DFA' || type === 'NFA' || type === 'ENFA') {
    if (trimmed === '') return type === 'ENFA' ? { parts: [{ symbol: '' }], error: null } : fail('Enter at least one symbol.');
    const out: LabelParts[] = [];
    for (const raw of trimmed.split(/[\s,]+/).filter(Boolean)) {
      const symbol = eps(raw);
      if (symbol === '' && type !== 'ENFA') return fail(`ε-transitions are only allowed in an ε-NFA.`);
      if ([...symbol].length > 1) return fail(`"${raw}" is not a single symbol. Separate symbols with commas.`);
      if (!out.some((p) => p.symbol === symbol)) out.push({ symbol });
    }
    return { parts: out, error: null };
  }

  const entries = trimmed.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return fail('Enter at least one transition.');
  const out: LabelParts[] = [];

  for (const entry of entries) {
    const sides = entry.split(ARROW);
    if (sides.length !== 2) return fail(type === 'PDA' ? `"${entry}": use the form  read, pop → push` : `"${entry}": use the form  read → write, move`);
    const left = sides[0]!.split(',').map((s) => s.trim());
    const right = sides[1]!.split(',').map((s) => s.trim());

    if (type === 'PDA') {
      if (left.length !== 2 || right.length !== 1) return fail(`"${entry}": use the form  read, pop → push`);
      const symbol = eps(left[0]!);
      const pop = eps(left[1]!);
      const push = eps(right[0]!);
      if ([...symbol].length > 1) return fail(`"${left[0]}": read at most one input symbol (or ε).`);
      if ([...pop].length > 1) return fail(`"${left[1]}": pop at most one stack symbol (or ε).`);
      out.push({ symbol, pop, push });
    } else {
      if (left.length !== 1 || right.length !== 2) return fail(`"${entry}": use the form  read → write, move`);
      const norm = (s: string) => (s === '□' || s === '␣' || s === '' ? BLANK : s);
      const symbol = norm(left[0]!);
      const write = norm(right[0]!);
      const move = right[1]!.toUpperCase();
      if ([...symbol].length !== 1 || [...write].length !== 1) return fail(`"${entry}": read and write must each be one tape symbol (use ${BLANK} for blank).`);
      if (move !== 'L' && move !== 'R' && move !== 'S') return fail(`"${entry}": the move must be L, R or S.`);
      out.push({ symbol, write, move });
    }
  }
  return { parts: out, error: null };
}

export interface AutomatonSpec {
  /** State names; all are created in this order. */
  states: string[];
  initial: string;
  accepting: string[];
  /** [from, label, to] with the label in the notation of parseTransitionLabel. */
  transitions: Array<[string, string, string]>;
  alphabet?: string[];
}

/** Build an automaton from a compact description, with an automatic layout. */
export function buildAutomaton(type: AutomatonType, spec: AutomatonSpec): Automaton {
  const index = new Map(spec.states.map((s, i) => [s, i]));
  const need = (name: string) => {
    const i = index.get(name);
    if (i === undefined) throw new Error(`Unknown state "${name}" in automaton spec.`);
    return i;
  };
  const transitions: Transition[] = [];
  const edges: Array<[number, number]> = [];
  for (const [from, label, to] of spec.transitions) {
    const { parts, error } = parseTransitionLabel(type, label);
    if (error) throw new Error(`Bad transition label "${label}": ${error}`);
    edges.push([need(from), need(to)]);
    for (const p of parts) transitions.push({ id: `t${transitions.length}`, from: `s${need(from)}`, to: `s${need(to)}`, ...p });
  }
  const pos = layeredLayout(spec.states.length, edges, need(spec.initial));
  const states: State[] = spec.states.map((label, i) => ({
    id: `s${i}`,
    label,
    x: pos[i]!.x,
    y: pos[i]!.y,
    initial: label === spec.initial,
    accepting: spec.accepting.includes(label),
  }));
  return { type, states, transitions, ...(spec.alphabet ? { alphabet: spec.alphabet } : {}) };
}
