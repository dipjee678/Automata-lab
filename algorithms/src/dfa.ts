/**
 * Core regular-language algorithms on a compact DFA representation:
 * subset construction, ε-removal, minimization (partition refinement),
 * product construction, equivalence checking with shortest counterexamples.
 */
import type { Automaton, State, Transition } from '@automata/shared';
import { alphabetOf, epsilonClosure, labelOf } from './fa';
import { layeredLayout } from './layout';

/** Compact DFA. `delta[q][i]` is the successor of q on `alphabet[i]`, or -1 if undefined. */
export interface Dfa {
  alphabet: string[];
  names: string[];
  start: number;
  accepting: boolean[];
  delta: number[][];
}

const MAX_DFA_STATES = 4000;

/* ------------------------------------------------------------------ */
/* Automaton JSON  ->  Dfa                                             */
/* ------------------------------------------------------------------ */

/** True when the automaton has no ε-moves and at most one move per (state, symbol). */
export function isDeterministic(a: Automaton): boolean {
  const seen = new Map<string, string>();
  for (const t of a.transitions) {
    if (t.symbol === '') return false;
    const key = `${t.from}\u0000${t.symbol}`;
    const prev = seen.get(key);
    if (prev !== undefined && prev !== t.to) return false;
    seen.set(key, t.to);
  }
  return true;
}

/** Direct translation of a deterministic automaton (keeps every state and its name). */
export function deterministicToDfa(a: Automaton, extraAlphabet: string[] = []): Dfa {
  if (!isDeterministic(a)) throw new Error('The automaton is not deterministic.');
  const alphabet = alphabetOf(a, extraAlphabet);
  const index = new Map(a.states.map((s, i) => [s.id, i]));
  const symIndex = new Map(alphabet.map((c, i) => [c, i]));
  const delta = a.states.map(() => new Array<number>(alphabet.length).fill(-1));
  for (const t of a.transitions) delta[index.get(t.from)!]![symIndex.get(t.symbol)!] = index.get(t.to)!;
  const start = a.states.findIndex((s) => s.initial);
  if (start < 0) throw new Error('No initial state is set.');
  return { alphabet, names: a.states.map((s) => s.label), start, accepting: a.states.map((s) => !!s.accepting), delta };
}

export interface SubsetStep {
  /** Name of the DFA state being expanded, e.g. "{q0, q1}". */
  subset: string;
  accepting: boolean;
  moves: Array<{ symbol: string; target: string; isNew: boolean }>;
}

export interface SubsetResult {
  dfa: Dfa;
  /** NFA state ids making up each DFA state. */
  subsets: string[][];
  steps: SubsetStep[];
  startClosure: string;
}

/**
 * Subset (powerset) construction, handling ε-transitions through ε-closures.
 * Only subsets reachable from the start are generated. The empty subset ∅
 * appears as an explicit dead state when it is reachable, so the result is
 * always a complete DFA.
 */
export function subsetConstruction(a: Automaton, extraAlphabet: string[] = []): SubsetResult {
  const init = a.states.find((s) => s.initial);
  if (!init) throw new Error('No initial state is set.');
  const alphabet = alphabetOf(a, extraAlphabet);
  const order = new Map(a.states.map((s, i) => [s.id, i]));
  const acceptingIds = new Set(a.states.filter((s) => s.accepting).map((s) => s.id));
  const canon = (set: Set<string>) => [...set].sort((x, y) => order.get(x)! - order.get(y)!);
  const nameOf = (ids: string[]) => (ids.length ? `{${ids.map((id) => labelOf(a, id)).join(', ')}}` : '∅');

  // Pre-index transitions by (state, symbol) for speed.
  const moves = new Map<string, string[]>();
  for (const t of a.transitions) {
    if (t.symbol === '') continue;
    const key = `${t.from}\u0000${t.symbol}`;
    (moves.get(key) ?? moves.set(key, []).get(key)!).push(t.to);
  }

  const subsets: string[][] = [];
  const indexOf = new Map<string, number>();
  const intern = (ids: string[]): [number, boolean] => {
    const key = ids.join('\u0000');
    const existing = indexOf.get(key);
    if (existing !== undefined) return [existing, false];
    if (subsets.length >= MAX_DFA_STATES)
      throw new Error(`Subset construction exceeded ${MAX_DFA_STATES} states; the automaton is too large.`);
    indexOf.set(key, subsets.length);
    subsets.push(ids);
    return [subsets.length - 1, true];
  };

  const startSet = canon(epsilonClosure(a, [init.id]));
  intern(startSet);
  const delta: number[][] = [];
  const steps: SubsetStep[] = [];

  for (let i = 0; i < subsets.length; i++) {
    const current = subsets[i]!;
    const row: number[] = [];
    const step: SubsetStep = { subset: nameOf(current), accepting: current.some((q) => acceptingIds.has(q)), moves: [] };
    for (const c of alphabet) {
      const moved = new Set<string>();
      for (const q of current) for (const r of moves.get(`${q}\u0000${c}`) ?? []) moved.add(r);
      const target = canon(epsilonClosure(a, moved));
      const [idx, isNew] = intern(target);
      row.push(idx);
      step.moves.push({ symbol: c, target: nameOf(target), isNew });
    }
    delta.push(row);
    steps.push(step);
  }

  return {
    dfa: {
      alphabet,
      names: subsets.map(nameOf),
      start: 0,
      accepting: subsets.map((ids) => ids.some((q) => acceptingIds.has(q))),
      delta,
    },
    subsets,
    steps,
    startClosure: nameOf(startSet),
  };
}

/** Any finite automaton -> DFA (direct when already deterministic, subset construction otherwise). */
export function toDfa(a: Automaton, extraAlphabet: string[] = []): Dfa {
  return isDeterministic(a) ? deterministicToDfa(a, extraAlphabet) : subsetConstruction(a, extraAlphabet).dfa;
}

/* ------------------------------------------------------------------ */
/* ε-NFA -> NFA                                                        */
/* ------------------------------------------------------------------ */

export interface EpsilonRemovalResult {
  automaton: Automaton;
  closures: Array<{ state: string; closure: string[] }>;
  newAccepting: string[];
}

/**
 * Remove ε-transitions while keeping the same set of states:
 *   δ'(q, a) = ε-closure( δ( ε-closure(q), a ) )
 *   q is accepting in the result iff ε-closure(q) contains an accepting state.
 */
export function removeEpsilon(a: Automaton): EpsilonRemovalResult {
  const alphabet = alphabetOf(a);
  const accepting = new Set(a.states.filter((s) => s.accepting).map((s) => s.id));
  const closures = new Map(a.states.map((s) => [s.id, epsilonClosure(a, [s.id])]));
  const order = new Map(a.states.map((s, i) => [s.id, i]));
  const sortIds = (ids: Iterable<string>) => [...ids].sort((x, y) => order.get(x)! - order.get(y)!);

  const transitions: Transition[] = [];
  let n = 0;
  for (const s of a.states) {
    for (const c of alphabet) {
      const moved = new Set<string>();
      for (const t of a.transitions) if (t.symbol === c && closures.get(s.id)!.has(t.from)) moved.add(t.to);
      for (const target of sortIds(epsilonClosure(a, moved)))
        transitions.push({ id: `t${n++}`, from: s.id, to: target, symbol: c });
    }
  }

  const newAccepting: string[] = [];
  const states: State[] = a.states.map((s) => {
    const acc = [...closures.get(s.id)!].some((q) => accepting.has(q));
    if (acc && !s.accepting) newAccepting.push(s.label);
    return { ...s, accepting: acc };
  });

  return {
    automaton: { type: 'NFA', states, transitions, alphabet: a.alphabet },
    closures: a.states.map((s) => ({ state: s.label, closure: sortIds(closures.get(s.id)!).map((id) => labelOf(a, id)) })),
    newAccepting,
  };
}

/* ------------------------------------------------------------------ */
/* Basic DFA operations                                                */
/* ------------------------------------------------------------------ */

export function dfaAccepts(d: Dfa, input: string): boolean {
  let q = d.start;
  for (const c of input) {
    const i = d.alphabet.indexOf(c);
    if (i < 0) return false;
    q = d.delta[q]![i]!;
    if (q < 0) return false;
  }
  return d.accepting[q]!;
}

/**
 * Re-express `d` over `alphabet` (a superset of its own) and make the
 * transition function total by adding one dead state if anything is missing.
 */
export function completeDfa(d: Dfa, alphabet: string[] = d.alphabet): Dfa {
  const sigma = [...new Set([...alphabet, ...d.alphabet])].sort();
  const old = new Map(d.alphabet.map((c, i) => [c, i]));
  let needsDead = false;
  const delta = d.delta.map((row) =>
    sigma.map((c) => {
      const i = old.get(c);
      const target = i === undefined ? -1 : row[i]!;
      if (target < 0) needsDead = true;
      return target;
    }),
  );
  if (!needsDead) return { ...d, alphabet: sigma, delta };
  const dead = d.names.length;
  let deadName = '∅';
  while (d.names.includes(deadName)) deadName += "'";
  return {
    alphabet: sigma,
    names: [...d.names, deadName],
    start: d.start,
    accepting: [...d.accepting, false],
    delta: [...delta.map((row) => row.map((t) => (t < 0 ? dead : t))), sigma.map(() => dead)],
  };
}

/** Drop states that cannot be reached from the start state. */
export function reachableDfa(d: Dfa): { dfa: Dfa; removed: string[] } {
  const seen = new Array<boolean>(d.names.length).fill(false);
  const orderList = [d.start];
  seen[d.start] = true;
  for (let h = 0; h < orderList.length; h++)
    for (const t of d.delta[orderList[h]!]!)
      if (t >= 0 && !seen[t]) {
        seen[t] = true;
        orderList.push(t);
      }
  const keep = d.names.map((_, i) => i).filter((i) => seen[i]);
  const remap = new Map(keep.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  return {
    dfa: {
      alphabet: d.alphabet,
      names: keep.map((i) => d.names[i]!),
      start: remap.get(d.start)!,
      accepting: keep.map((i) => d.accepting[i]!),
      delta: keep.map((i) => d.delta[i]!.map((t) => (t < 0 ? -1 : remap.get(t)!))),
    },
    removed: d.names.filter((_, i) => !seen[i]),
  };
}

export function complementDfa(d: Dfa, alphabet: string[] = d.alphabet): Dfa {
  const c = completeDfa(d, alphabet);
  return { ...c, accepting: c.accepting.map((x) => !x) };
}

/* ------------------------------------------------------------------ */
/* Minimization                                                        */
/* ------------------------------------------------------------------ */

export interface MinimizationRound {
  /** The partition at the start of this round (blocks of state names). */
  partition: string[][];
  /** For every state: its block and the blocks its successors fall into. */
  table: Array<{ state: string; block: number; targets: number[] }>;
  /** Blocks that had to be split in this round. */
  splits: string[];
}

export interface MinimizationResult {
  dfa: Dfa;
  rounds: MinimizationRound[];
  removedUnreachable: string[];
  addedDeadState: boolean;
  /** Final blocks (names of the merged original states). */
  blocks: string[][];
  originalCount: number;
}

/**
 * DFA minimization by partition refinement (Moore's algorithm).
 *
 *  1. Remove unreachable states and complete the transition function.
 *  2. Start from the partition {accepting, non-accepting}.
 *  3. Repeatedly split blocks: two states stay together only if, for every
 *     symbol, their successors lie in the same block.
 *  4. When no block splits, each block is one state of the minimal DFA.
 *
 * The result is the unique (up to renaming) minimal complete DFA.
 */
export function minimizeDfa(input: Dfa): MinimizationResult {
  const { dfa: reach, removed } = reachableDfa(input);
  const d = completeDfa(reach);
  const n = d.names.length;
  const addedDeadState = n > reach.names.length;

  // Number blocks by first occurrence so the numbering is deterministic.
  const renumber = (keys: string[]): number[] => {
    const ids = new Map<string, number>();
    return keys.map((k) => ids.get(k) ?? ids.set(k, ids.size).get(k)!);
  };
  const blocksOf = (block: number[]): string[][] => {
    const out: string[][] = [];
    block.forEach((b, q) => (out[b] ??= []).push(d.names[q]!));
    return out;
  };

  let block = renumber(d.accepting.map((acc) => (acc ? 'A' : 'N')));
  let count = new Set(block).size;
  const rounds: MinimizationRound[] = [];

  for (;;) {
    const table = d.names.map((state, q) => ({ state, block: block[q]!, targets: d.delta[q]!.map((t) => block[t]!) }));
    const next = renumber(table.map((row) => `${row.block}|${row.targets.join(',')}`));
    const nextCount = new Set(next).size;

    const splits: string[] = [];
    if (nextCount !== count) {
      const partition = blocksOf(block);
      const sub = new Map<number, Set<number>>();
      next.forEach((nb, q) => (sub.get(block[q]!) ?? sub.set(block[q]!, new Set()).get(block[q]!)!).add(nb));
      for (const [b, parts] of sub) if (parts.size > 1) splits.push(`{${partition[b]!.join(', ')}}`);
    }
    rounds.push({ partition: blocksOf(block), table, splits });
    if (nextCount === count) break;
    block = next;
    count = nextCount;
  }

  const blocks = blocksOf(block);
  const rep: number[] = [];
  block.forEach((b, q) => {
    if (rep[b] === undefined) rep[b] = q;
  });
  const min: Dfa = {
    alphabet: d.alphabet,
    names: blocks.map((b) => (b.length === 1 ? b[0]! : `{${b.join(', ')}}`)),
    start: block[d.start]!,
    accepting: rep.map((q) => d.accepting[q]!),
    delta: rep.map((q) => d.delta[q]!.map((t) => block[t]!)),
  };
  return { dfa: min, rounds, removedUnreachable: removed, addedDeadState, blocks, originalCount: input.names.length };
}

/**
 * Is this DFA already minimal? Convention-agnostic: a partial DFA (dead state
 * omitted) and a complete one are both accepted, as long as no state is
 * unreachable and no two states are equivalent.
 */
export function isMinimalDfa(d: Dfa): { minimal: boolean; states: number; minimalStates: number; unreachable: string[] } {
  const { dfa: reach, removed } = reachableDfa(d);
  const complete = completeDfa(reach);
  const min = minimizeDfa(complete).dfa;
  const added = complete.names.length - reach.names.length;
  return {
    minimal: removed.length === 0 && min.names.length === complete.names.length,
    states: d.names.length,
    minimalStates: min.names.length - added,
    unreachable: removed,
  };
}

/* ------------------------------------------------------------------ */
/* Product construction, equivalence, counterexamples                  */
/* ------------------------------------------------------------------ */

export type ProductMode = 'intersection' | 'union' | 'difference' | 'symmetric-difference';

const combine: Record<ProductMode, (a: boolean, b: boolean) => boolean> = {
  intersection: (a, b) => a && b,
  union: (a, b) => a || b,
  difference: (a, b) => a && !b,
  'symmetric-difference': (a, b) => a !== b,
};

export interface ProductResult {
  dfa: Dfa;
  /** For each product state, the pair of component state indexes. */
  pairs: Array<[number, number]>;
}

/**
 * Product construction of two DFAs over the union of their alphabets.
 * Only pairs reachable from (startA, startB) are built.
 */
export function productDfa(a0: Dfa, b0: Dfa, mode: ProductMode): ProductResult {
  const sigma = [...new Set([...a0.alphabet, ...b0.alphabet])].sort();
  const a = completeDfa(a0, sigma);
  const b = completeDfa(b0, sigma);
  const nb = b.names.length;
  const index = new Map<number, number>();
  const pairs: Array<[number, number]> = [];
  const intern = (p: number, q: number) => {
    const key = p * nb + q;
    let i = index.get(key);
    if (i === undefined) {
      i = pairs.length;
      index.set(key, i);
      pairs.push([p, q]);
    }
    return i;
  };
  intern(a.start, b.start);
  const delta: number[][] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [p, q] = pairs[i]!;
    delta.push(sigma.map((_, s) => intern(a.delta[p]![s]!, b.delta[q]![s]!)));
    if (pairs.length > MAX_DFA_STATES * 10) throw new Error('Product automaton is too large.');
  }
  return {
    dfa: {
      alphabet: sigma,
      names: pairs.map(([p, q]) => `(${a.names[p]}, ${b.names[q]})`),
      start: 0,
      accepting: pairs.map(([p, q]) => combine[mode](a.accepting[p]!, b.accepting[q]!)),
      delta,
    },
    pairs,
  };
}

export interface EquivalenceResult {
  equivalent: boolean;
  /** Shortest string on which the two languages differ (when not equivalent). */
  counterexample: string | null;
  /** Membership of the counterexample in A and in B. */
  inA: boolean | null;
  inB: boolean | null;
  /** Number of product states explored. */
  explored: number;
}

/**
 * Exact DFA equivalence check.
 *
 * L(A) = L(B) iff no state of the symmetric-difference product automaton
 * that accepts is reachable. We run a breadth-first search over reachable
 * pairs (p, q); the first pair where exactly one component accepts yields a
 * SHORTEST distinguishing string (BFS explores strings in order of length,
 * and symbols in sorted order, so it is also the first in shortlex order).
 */
export function checkEquivalence(a0: Dfa, b0: Dfa): EquivalenceResult {
  const sigma = [...new Set([...a0.alphabet, ...b0.alphabet])].sort();
  const a = completeDfa(a0, sigma);
  const b = completeDfa(b0, sigma);
  const nb = b.names.length;

  const parent = new Map<number, { prev: number; symbol: string } | null>();
  const startKey = a.start * nb + b.start;
  parent.set(startKey, null);
  const queue = [startKey];

  for (let h = 0; h < queue.length; h++) {
    const key = queue[h]!;
    const p = Math.floor(key / nb);
    const q = key % nb;
    if (a.accepting[p] !== b.accepting[q]) {
      const symbols: string[] = [];
      for (let k: number = key; parent.get(k); k = parent.get(k)!.prev) symbols.push(parent.get(k)!.symbol);
      return {
        equivalent: false,
        counterexample: symbols.reverse().join(''),
        inA: a.accepting[p]!,
        inB: b.accepting[q]!,
        explored: parent.size,
      };
    }
    for (let s = 0; s < sigma.length; s++) {
      const nk = a.delta[p]![s]! * nb + b.delta[q]![s]!;
      if (!parent.has(nk)) {
        parent.set(nk, { prev: key, symbol: sigma[s]! });
        queue.push(nk);
      }
    }
  }
  return { equivalent: true, counterexample: null, inA: null, inB: null, explored: parent.size };
}

export interface AgreementCounts {
  /** Strings (length ≤ maxLen) in both languages / only in A / only in B / in neither. */
  both: number;
  onlyA: number;
  onlyB: number;
  neither: number;
  maxLen: number;
}

/**
 * Count, over ALL strings of length ≤ maxLen, how the two languages agree.
 * Done by dynamic programming on the product automaton (no enumeration), so
 * it is exact even when |Σ|^maxLen is huge. Used for partial credit.
 */
export function agreementCounts(a0: Dfa, b0: Dfa, maxLen: number): AgreementCounts {
  const sigma = [...new Set([...a0.alphabet, ...b0.alphabet])].sort();
  const a = completeDfa(a0, sigma);
  const b = completeDfa(b0, sigma);
  const nb = b.names.length;
  const out: AgreementCounts = { both: 0, onlyA: 0, onlyB: 0, neither: 0, maxLen };
  let layer = new Map<number, number>([[a.start * nb + b.start, 1]]);
  for (let len = 0; len <= maxLen; len++) {
    const next = new Map<number, number>();
    for (const [key, cnt] of layer) {
      const p = Math.floor(key / nb);
      const q = key % nb;
      const inA = a.accepting[p]!;
      const inB = b.accepting[q]!;
      if (inA && inB) out.both += cnt;
      else if (inA) out.onlyA += cnt;
      else if (inB) out.onlyB += cnt;
      else out.neither += cnt;
      if (len < maxLen)
        for (let s = 0; s < sigma.length; s++) {
          const nk = a.delta[p]![s]! * nb + b.delta[q]![s]!;
          next.set(nk, (next.get(nk) ?? 0) + cnt);
        }
    }
    layer = next;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Dfa -> Automaton JSON                                               */
/* ------------------------------------------------------------------ */

/** Convert a compact DFA back to editor JSON with an automatic layout. */
export function dfaToAutomaton(d: Dfa, opts: { rename?: boolean } = {}): Automaton {
  const edges: Array<[number, number]> = [];
  d.delta.forEach((row, q) => row.forEach((t) => t >= 0 && edges.push([q, t])));
  const pos = layeredLayout(d.names.length, edges, d.start);
  const states: State[] = d.names.map((name, i) => ({
    id: `s${i}`,
    label: opts.rename ? `q${i}` : name,
    x: pos[i]!.x,
    y: pos[i]!.y,
    initial: i === d.start,
    accepting: d.accepting[i]!,
  }));
  const transitions: Transition[] = [];
  d.delta.forEach((row, q) =>
    row.forEach((t, s) => {
      if (t >= 0) transitions.push({ id: `t${transitions.length}`, from: `s${q}`, to: `s${t}`, symbol: d.alphabet[s]! });
    }),
  );
  return { type: 'DFA', states, transitions, alphabet: d.alphabet };
}
