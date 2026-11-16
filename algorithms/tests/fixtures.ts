import { buildAutomaton } from '../src';

/** Binary numbers divisible by 3 (ε counts as 0). */
export const div3 = buildAutomaton('DFA', {
  states: ['r0', 'r1', 'r2'],
  initial: 'r0',
  accepting: ['r0'],
  transitions: [
    ['r0', '0', 'r0'],
    ['r0', '1', 'r1'],
    ['r1', '0', 'r2'],
    ['r1', '1', 'r0'],
    ['r2', '0', 'r1'],
    ['r2', '1', 'r2'],
  ],
});

/** Same language as div3, built on remainders mod 6 (not minimal). */
export const div3Mod6 = buildAutomaton('DFA', {
  states: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'],
  initial: 'a0',
  accepting: ['a0', 'a3'],
  transitions: [0, 1, 2, 3, 4, 5].flatMap((r) => [
    [`a${r}`, '0', `a${(2 * r) % 6}`] as [string, string, string],
    [`a${r}`, '1', `a${(2 * r + 1) % 6}`] as [string, string, string],
  ]),
});

/** NFA for strings over {0,1} ending in 01. */
export const endsIn01 = buildAutomaton('NFA', {
  states: ['q0', 'q1', 'q2'],
  initial: 'q0',
  accepting: ['q2'],
  transitions: [
    ['q0', '0,1', 'q0'],
    ['q0', '0', 'q1'],
    ['q1', '1', 'q2'],
  ],
});

/** ε-NFA for a*b*c*. */
export const aStarBStarCStar = buildAutomaton('ENFA', {
  states: ['s0', 's1', 's2'],
  initial: 's0',
  accepting: ['s2'],
  transitions: [
    ['s0', 'a', 's0'],
    ['s0', 'ε', 's1'],
    ['s1', 'b', 's1'],
    ['s1', 'ε', 's2'],
    ['s2', 'c', 's2'],
  ],
});

/** PDA for { aⁿbⁿ | n ≥ 0 }. */
export const anbnPda = buildAutomaton('PDA', {
  states: ['p0', 'p1', 'p2'],
  initial: 'p0',
  accepting: ['p2'],
  transitions: [
    ['p0', 'a, ε → A', 'p0'],
    ['p0', 'ε, ε → ε', 'p1'],
    ['p1', 'b, A → ε', 'p1'],
    ['p1', 'ε, Z → Z', 'p2'],
  ],
});

/** Turing machine for { aⁿbⁿ | n ≥ 0 }. */
export const anbnTm = buildAutomaton('TM', {
  states: ['q0', 'q1', 'q2', 'q3', 'acc'],
  initial: 'q0',
  accepting: ['acc'],
  transitions: [
    ['q0', 'a → X, R', 'q1'],
    ['q0', 'Y → Y, R', 'q3'],
    ['q0', '_ → _, S', 'acc'],
    ['q1', 'a → a, R ; Y → Y, R', 'q1'],
    ['q1', 'b → Y, L', 'q2'],
    ['q2', 'a → a, L ; Y → Y, L', 'q2'],
    ['q2', 'X → X, R', 'q0'],
    ['q3', 'Y → Y, R', 'q3'],
    ['q3', '_ → _, S', 'acc'],
  ],
});

/** All binary strings up to a length. */
export function allStrings(alphabet: string[], maxLen: number): string[] {
  const out = [''];
  let layer = [''];
  for (let i = 0; i < maxLen; i++) {
    layer = layer.flatMap((p) => alphabet.map((c) => p + c));
    out.push(...layer);
  }
  return out;
}

/** Small deterministic PRNG so randomized tests are reproducible. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
