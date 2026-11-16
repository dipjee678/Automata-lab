/** Example machines that can be loaded into the editor and the labs (demonstration data). */
import { buildAutomaton } from '@automata/algorithms';
import type { Automaton } from '@automata/shared';

export interface Example {
  id: string;
  name: string;
  description: string;
  /** A string worth trying in the simulator. */
  sample: string;
  automaton: Automaton;
}

export const EXAMPLES: Example[] = [
  {
    id: 'dfa-div3',
    name: 'DFA: binary numbers divisible by 3',
    description: 'Each state remembers the remainder modulo 3.',
    sample: '1001',
    automaton: buildAutomaton('DFA', {
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
    }),
  },
  {
    id: 'dfa-mod6',
    name: 'DFA: six states, not minimal',
    description: 'Accepts the multiples of 3 using remainders modulo 6. Try minimizing it.',
    sample: '110',
    automaton: buildAutomaton('DFA', {
      states: ['A', 'B', 'C', 'D', 'E', 'F'],
      initial: 'A',
      accepting: ['A', 'D'],
      transitions: ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((name, r, all) => [
        [name, '0', all[(2 * r) % 6]!] as [string, string, string],
        [name, '1', all[(2 * r + 1) % 6]!] as [string, string, string],
      ]),
    }),
  },
  {
    id: 'nfa-ends-01',
    name: 'NFA: strings ending in 01',
    description: 'Guesses when the final 01 begins.',
    sample: '11001',
    automaton: buildAutomaton('NFA', {
      states: ['q0', 'q1', 'q2'],
      initial: 'q0',
      accepting: ['q2'],
      transitions: [
        ['q0', '0,1', 'q0'],
        ['q0', '0', 'q1'],
        ['q1', '1', 'q2'],
      ],
    }),
  },
  {
    id: 'enfa-abc',
    name: 'ε-NFA: a*b*c*',
    description: 'ε-transitions move on to the next block of letters.',
    sample: 'aabccc',
    automaton: buildAutomaton('ENFA', {
      states: ['p', 'q', 'r'],
      initial: 'p',
      accepting: ['r'],
      transitions: [
        ['p', 'a', 'p'],
        ['p', 'ε', 'q'],
        ['q', 'b', 'q'],
        ['q', 'ε', 'r'],
        ['r', 'c', 'r'],
      ],
    }),
  },
  {
    id: 'pda-anbn',
    name: 'PDA: aⁿbⁿ',
    description: 'Pushes an A for every a and pops one for every b.',
    sample: 'aaabbb',
    automaton: buildAutomaton('PDA', {
      states: ['p0', 'p1', 'p2'],
      initial: 'p0',
      accepting: ['p2'],
      transitions: [
        ['p0', 'a, ε → A', 'p0'],
        ['p0', 'ε, ε → ε', 'p1'],
        ['p1', 'b, A → ε', 'p1'],
        ['p1', 'ε, Z → Z', 'p2'],
      ],
    }),
  },
  {
    id: 'pda-palindrome',
    name: 'PDA: even-length palindromes',
    description: 'Nondeterministically guesses the middle of the string.',
    sample: 'abba',
    automaton: buildAutomaton('PDA', {
      states: ['push', 'pop', 'done'],
      initial: 'push',
      accepting: ['done'],
      transitions: [
        ['push', 'a, ε → a ; b, ε → b', 'push'],
        ['push', 'ε, ε → ε', 'pop'],
        ['pop', 'a, a → ε ; b, b → ε', 'pop'],
        ['pop', 'ε, Z → ε', 'done'],
      ],
    }),
  },
  {
    id: 'tm-anbn',
    name: 'Turing machine: aⁿbⁿ',
    description: 'Repeatedly crosses off one a and one b.',
    sample: 'aabb',
    automaton: buildAutomaton('TM', {
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
    }),
  },
  {
    id: 'tm-increment',
    name: 'Turing machine: binary increment',
    description: 'Adds one to a binary number and halts.',
    sample: '1011',
    automaton: buildAutomaton('TM', {
      states: ['right', 'carry', 'done'],
      initial: 'right',
      accepting: ['done'],
      transitions: [
        ['right', '0 → 0, R ; 1 → 1, R', 'right'],
        ['right', '_ → _, L', 'carry'],
        ['carry', '1 → 0, L', 'carry'],
        ['carry', '0 → 1, S ; _ → 1, S', 'done'],
      ],
    }),
  },
];

export const TYPE_NAMES = { DFA: 'DFA', NFA: 'NFA', ENFA: 'ε-NFA', PDA: 'PDA', TM: 'Turing machine' } as const;
