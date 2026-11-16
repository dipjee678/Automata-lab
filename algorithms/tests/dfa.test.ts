import { describe, expect, it } from 'vitest';
import type { Automaton } from '@automata/shared';
import {
  acceptsFA,
  agreementCounts,
  buildAutomaton,
  checkEquivalence,
  complementDfa,
  completeDfa,
  dfaAccepts,
  dfaToAutomaton,
  isMinimalDfa,
  minimizeDfa,
  productDfa,
  removeEpsilon,
  subsetConstruction,
  toDfa,
  validateAutomaton,
} from '../src';
import { aStarBStarCStar, allStrings, div3, div3Mod6, endsIn01, rng } from './fixtures';

/** Random NFA / ε-NFA over {a, b} for property tests. */
function randomNfa(rand: () => number, withEpsilon: boolean): Automaton {
  const n = 2 + Math.floor(rand() * 4);
  const names = Array.from({ length: n }, (_, i) => `n${i}`);
  const transitions: Array<[string, string, string]> = [];
  const m = 2 + Math.floor(rand() * 9);
  for (let i = 0; i < m; i++) {
    const r = rand();
    const label = withEpsilon && r < 0.2 ? 'ε' : r < 0.6 ? 'a' : 'b';
    transitions.push([names[Math.floor(rand() * n)]!, label, names[Math.floor(rand() * n)]!]);
  }
  return buildAutomaton(withEpsilon ? 'ENFA' : 'NFA', {
    states: names,
    initial: 'n0',
    accepting: names.filter(() => rand() < 0.4),
    transitions,
    alphabet: ['a', 'b'],
  });
}

describe('subset construction (NFA → DFA)', () => {
  it('produces the textbook DFA for "ends in 01"', () => {
    const { dfa, steps, startClosure } = subsetConstruction(endsIn01);
    expect(startClosure).toBe('{q0}');
    expect(dfa.names.sort()).toEqual(['{q0, q1}', '{q0, q2}', '{q0}'].sort());
    expect(steps).toHaveLength(3);
    expect(steps[0]!.moves).toEqual([
      { symbol: '0', target: '{q0, q1}', isNew: true },
      { symbol: '1', target: '{q0}', isNew: false },
    ]);
  });

  it('creates an explicit dead state ∅ when needed and yields a complete DFA', () => {
    const nfa = buildAutomaton('NFA', { states: ['a', 'b'], initial: 'a', accepting: ['b'], transitions: [['a', 'x', 'b']] });
    const { dfa } = subsetConstruction(nfa);
    expect(dfa.names).toContain('∅');
    expect(dfa.delta.flat().every((t) => t >= 0)).toBe(true);
  });

  it('handles ε-transitions through closures', () => {
    const { dfa, startClosure } = subsetConstruction(aStarBStarCStar);
    expect(startClosure).toBe('{s0, s1, s2}');
    for (const s of allStrings(['a', 'b', 'c'], 6)) expect(dfaAccepts(dfa, s)).toBe(/^a*b*c*$/.test(s));
  });

  it('preserves the language of random NFAs and ε-NFAs', () => {
    const rand = rng(42);
    const strings = allStrings(['a', 'b'], 7);
    for (let i = 0; i < 60; i++) {
      const nfa = randomNfa(rand, i % 2 === 0);
      const { dfa } = subsetConstruction(nfa);
      for (const s of strings) expect(dfaAccepts(dfa, s), `nfa #${i} on "${s}"`).toBe(acceptsFA(nfa, s));
    }
  });

  it('respects an extra alphabet', () => {
    const { dfa } = subsetConstruction(endsIn01, ['2']);
    expect(dfa.alphabet).toEqual(['0', '1', '2']);
    expect(dfaAccepts(dfa, '201')).toBe(false);
  });
});

describe('ε-NFA → NFA', () => {
  it('removes ε-transitions and keeps the language', () => {
    const { automaton, closures, newAccepting } = removeEpsilon(aStarBStarCStar);
    expect(automaton.transitions.every((t) => t.symbol !== '')).toBe(true);
    expect(validateAutomaton(automaton, { as: 'NFA' }).errors).toEqual([]);
    expect(closures[0]).toEqual({ state: 's0', closure: ['s0', 's1', 's2'] });
    expect(newAccepting.sort()).toEqual(['s0', 's1']);
    for (const s of allStrings(['a', 'b', 'c'], 6)) expect(acceptsFA(automaton, s)).toBe(acceptsFA(aStarBStarCStar, s));
  });

  it('preserves the language of random ε-NFAs', () => {
    const rand = rng(7);
    const strings = allStrings(['a', 'b'], 6);
    for (let i = 0; i < 40; i++) {
      const enfa = randomNfa(rand, true);
      const { automaton } = removeEpsilon(enfa);
      for (const s of strings) expect(acceptsFA(automaton, s)).toBe(acceptsFA(enfa, s));
    }
  });
});

describe('DFA minimization', () => {
  it('reduces the mod-6 automaton to the 3-state divisibility DFA', () => {
    const result = minimizeDfa(toDfa(div3Mod6));
    expect(result.dfa.names).toHaveLength(3);
    expect(result.blocks.map((b) => b.sort())).toEqual([
      ['a0', 'a3'],
      ['a1', 'a4'],
      ['a2', 'a5'],
    ]);
    expect(checkEquivalence(result.dfa, toDfa(div3)).equivalent).toBe(true);
    expect(result.rounds.length).toBeGreaterThanOrEqual(2);
    expect(result.rounds[0]!.partition).toHaveLength(2);
  });

  it('leaves a minimal DFA unchanged in size', () => {
    expect(minimizeDfa(toDfa(div3)).dfa.names).toHaveLength(3);
    expect(isMinimalDfa(toDfa(div3)).minimal).toBe(true);
    expect(isMinimalDfa(toDfa(div3Mod6)).minimal).toBe(false);
  });

  it('removes unreachable states and completes partial DFAs', () => {
    const d = buildAutomaton('DFA', {
      states: ['a', 'b', 'island'],
      initial: 'a',
      accepting: ['b', 'island'],
      transitions: [
        ['a', 'x', 'b'],
        ['island', 'x', 'island'],
      ],
    });
    const result = minimizeDfa(toDfa(d));
    expect(result.removedUnreachable).toEqual(['island']);
    expect(result.addedDeadState).toBe(true);
    expect(result.dfa.names).toHaveLength(3); // a, b, dead
    expect(isMinimalDfa(toDfa(d)).minimal).toBe(false); // has an unreachable state
  });

  it('collapses a DFA with no accepting state to a single state', () => {
    const d = { ...div3, states: div3.states.map((s) => ({ ...s, accepting: false })) };
    expect(minimizeDfa(toDfa(d)).dfa.names).toHaveLength(1);
  });

  it('is language preserving and idempotent on random inputs', () => {
    const rand = rng(99);
    for (let i = 0; i < 60; i++) {
      const dfa = subsetConstruction(randomNfa(rand, i % 3 === 0)).dfa;
      const min = minimizeDfa(dfa).dfa;
      expect(checkEquivalence(dfa, min).equivalent).toBe(true);
      expect(min.names.length).toBeLessThanOrEqual(dfa.names.length);
      expect(minimizeDfa(min).dfa.names.length).toBe(min.names.length);
    }
  });

  it('yields the same number of states for equivalent DFAs (uniqueness of the minimal DFA)', () => {
    const viaNfa = minimizeDfa(subsetConstruction(endsIn01).dfa).dfa;
    const direct = buildAutomaton('DFA', {
      states: ['A', 'B', 'C', 'D'],
      initial: 'A',
      accepting: ['C'],
      transitions: [
        ['A', '0', 'B'],
        ['A', '1', 'D'],
        ['D', '0', 'B'],
        ['D', '1', 'D'],
        ['B', '0', 'B'],
        ['B', '1', 'C'],
        ['C', '0', 'B'],
        ['C', '1', 'A'],
      ],
    });
    expect(minimizeDfa(toDfa(direct)).dfa.names.length).toBe(viaNfa.names.length);
    expect(viaNfa.names).toHaveLength(3);
  });
});

describe('product construction', () => {
  const evenZeros = buildAutomaton('DFA', {
    states: ['e', 'o'],
    initial: 'e',
    accepting: ['e'],
    transitions: [
      ['e', '0', 'o'],
      ['o', '0', 'e'],
      ['e', '1', 'e'],
      ['o', '1', 'o'],
    ],
  });
  const A = toDfa(div3);
  const B = toDfa(evenZeros);
  const even = (s: string) => [...s].filter((c) => c === '0').length % 2 === 0;
  const d3 = (s: string) => (s === '' ? 0 : parseInt(s, 2)) % 3 === 0;

  it.each([
    ['intersection', (s: string) => d3(s) && even(s)],
    ['union', (s: string) => d3(s) || even(s)],
    ['difference', (s: string) => d3(s) && !even(s)],
    ['symmetric-difference', (s: string) => d3(s) !== even(s)],
  ] as const)('%s accepts the right strings', (mode, oracle) => {
    const { dfa, pairs } = productDfa(A, B, mode);
    expect(pairs.length).toBe(6);
    for (const s of allStrings(['0', '1'], 8)) expect(dfaAccepts(dfa, s)).toBe(oracle(s));
  });

  it('works across different alphabets', () => {
    const onlyA = toDfa(buildAutomaton('DFA', { states: ['p'], initial: 'p', accepting: ['p'], transitions: [['p', 'a', 'p']] }));
    const onlyB = toDfa(buildAutomaton('DFA', { states: ['p'], initial: 'p', accepting: ['p'], transitions: [['p', 'b', 'p']] }));
    const { dfa } = productDfa(onlyA, onlyB, 'intersection');
    expect(dfaAccepts(dfa, '')).toBe(true);
    expect(dfaAccepts(dfa, 'a')).toBe(false);
    expect(dfaAccepts(dfa, 'b')).toBe(false);
  });

  it('complement flips membership, including for strings that hit missing transitions', () => {
    const c = complementDfa(A);
    for (const s of allStrings(['0', '1'], 7)) expect(dfaAccepts(c, s)).toBe(!d3(s));
    const partial = toDfa(buildAutomaton('DFA', { states: ['a', 'b'], initial: 'a', accepting: ['b'], transitions: [['a', 'x', 'b']] }));
    expect(dfaAccepts(complementDfa(partial), 'xx')).toBe(true);
    expect(completeDfa(partial).names).toHaveLength(3);
  });
});

describe('equivalence checking and counterexamples', () => {
  it('recognises structurally different but equivalent DFAs', () => {
    const r = checkEquivalence(toDfa(div3), toDfa(div3Mod6));
    expect(r).toMatchObject({ equivalent: true, counterexample: null });
  });

  it('treats a partial DFA and its completion as equivalent', () => {
    const partial = toDfa(buildAutomaton('DFA', { states: ['a', 'b'], initial: 'a', accepting: ['b'], transitions: [['a', 'x', 'b']] }));
    expect(checkEquivalence(partial, completeDfa(partial)).equivalent).toBe(true);
  });

  it('returns ε when the languages differ on the empty string', () => {
    const notAccepting = { ...div3, states: div3.states.map((s) => ({ ...s, accepting: s.label === 'r1' })) };
    const r = checkEquivalence(toDfa(div3), toDfa(notAccepting));
    expect(r).toMatchObject({ equivalent: false, counterexample: '', inA: true, inB: false });
  });

  it('finds a SHORTEST distinguishing string (verified by brute force)', () => {
    const rand = rng(2024);
    const strings = allStrings(['a', 'b'], 9); // shortlex order
    let inequivalent = 0;
    for (let i = 0; i < 80; i++) {
      const x = randomNfa(rand, false);
      const y = randomNfa(rand, i % 2 === 0);
      const r = checkEquivalence(toDfa(x), toDfa(y));
      const brute = strings.find((s) => acceptsFA(x, s) !== acceptsFA(y, s));
      if (r.equivalent) {
        expect(brute, `pair #${i}`).toBeUndefined();
      } else {
        inequivalent++;
        expect(r.counterexample).toBe(brute); // same string: shortest and first in shortlex order
        expect(acceptsFA(x, r.counterexample!)).toBe(r.inA);
        expect(acceptsFA(y, r.counterexample!)).toBe(r.inB);
      }
    }
    expect(inequivalent).toBeGreaterThan(10);
  });

  it('distinguishes languages over different alphabets', () => {
    const a = toDfa(buildAutomaton('DFA', { states: ['p'], initial: 'p', accepting: ['p'], transitions: [['p', 'a', 'p']] }));
    const ab = toDfa(buildAutomaton('DFA', { states: ['p'], initial: 'p', accepting: ['p'], transitions: [['p', 'a,b', 'p']] }));
    expect(checkEquivalence(a, ab)).toMatchObject({ equivalent: false, counterexample: 'b', inA: false, inB: true });
  });

  it('counts agreement exactly', () => {
    const A = toDfa(div3);
    const all = toDfa(buildAutomaton('DFA', { states: ['p'], initial: 'p', accepting: ['p'], transitions: [['p', '0,1', 'p']] }));
    const counts = agreementCounts(A, all, 6);
    const strings = allStrings(['0', '1'], 6);
    const inA = strings.filter((s) => dfaAccepts(A, s)).length;
    expect(counts).toMatchObject({ both: inA, onlyA: 0, onlyB: strings.length - inA, neither: 0 });
  });
});

describe('DFA → automaton JSON', () => {
  it('round-trips through the editor representation', () => {
    const d = minimizeDfa(toDfa(div3Mod6)).dfa;
    const a = dfaToAutomaton(d);
    expect(validateAutomaton(a).errors).toEqual([]);
    expect(checkEquivalence(toDfa(a), d).equivalent).toBe(true);
    expect(a.states.filter((s) => s.initial)).toHaveLength(1);
  });
});
