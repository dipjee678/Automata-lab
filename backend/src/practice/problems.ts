/**
 * Built-in practice problem bank. Reference solutions stay on the server;
 * students only ever receive the public part (see `publicProblem`).
 */
import { buildAutomaton, type GradableQuestion } from '@automata/algorithms';
import { defaultCriteria, type Automaton, type QuestionType } from '@automata/shared';

export interface PracticeProblem {
  id: string;
  title: string;
  prompt: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: GradableQuestion;
}

export interface PublicPracticeProblem {
  id: string;
  title: string;
  prompt: string;
  topic: string;
  difficulty: PracticeProblem['difficulty'];
  type: QuestionType;
  marks: number;
  alphabet: string[];
  given: Automaton | null;
  exact: boolean;
}

const q = (over: Partial<GradableQuestion> & Pick<GradableQuestion, 'type' | 'reference'>): GradableQuestion => ({
  marks: 10,
  alphabet: ['0', '1'],
  given: null,
  tests: [],
  criteria: defaultCriteria(),
  ...over,
});

const nfaEndsIn01 = buildAutomaton('NFA', {
  states: ['q0', 'q1', 'q2'],
  initial: 'q0',
  accepting: ['q2'],
  transitions: [
    ['q0', '0,1', 'q0'],
    ['q0', '0', 'q1'],
    ['q1', '1', 'q2'],
  ],
});

const enfaABC = buildAutomaton('ENFA', {
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
});

const mod6 = buildAutomaton('DFA', {
  states: ['A', 'B', 'C', 'D', 'E', 'F'],
  initial: 'A',
  accepting: ['A', 'D'],
  transitions: ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((name, r, all) => [
    [name, '0', all[(2 * r) % 6]!] as [string, string, string],
    [name, '1', all[(2 * r + 1) % 6]!] as [string, string, string],
  ]),
});

const redundant = buildAutomaton('DFA', {
  states: ['s', 'a1', 'a2', 'b1', 'b2', 'x'],
  initial: 's',
  accepting: ['b1', 'b2'],
  transitions: [
    ['s', 'a', 'a1'],
    ['s', 'b', 'x'],
    ['a1', 'a', 'a2'],
    ['a1', 'b', 'b1'],
    ['a2', 'a', 'a1'],
    ['a2', 'b', 'b2'],
    ['b1', 'a,b', 'x'],
    ['b2', 'a,b', 'x'],
    ['x', 'a,b', 'x'],
  ],
});

export const PRACTICE_PROBLEMS: PracticeProblem[] = [
  {
    id: 'dfa-even-zeros',
    title: 'Even number of 0s',
    prompt: 'Construct a DFA over {0, 1} that accepts exactly the strings containing an even number of 0s (zero counts as even).',
    topic: 'DFA',
    difficulty: 'easy',
    question: q({ type: 'dfa_construct', reference: { kind: 'regex', regex: '(1*01*0)*1*' } }),
  },
  {
    id: 'dfa-div3',
    title: 'Binary numbers divisible by 3',
    prompt: 'Construct a DFA over {0, 1} that accepts the binary representations (most significant bit first) of numbers divisible by 3. The empty string counts as 0 and is accepted. Leading zeros are allowed.',
    topic: 'DFA',
    difficulty: 'medium',
    question: q({ type: 'dfa_construct', reference: { kind: 'regex', regex: '(0|1(01*0)*1)*' } }),
  },
  {
    id: 'dfa-contains-101',
    title: 'Contains the substring 101',
    prompt: 'Construct a DFA over {0, 1} that accepts exactly the strings containing 101 as a substring.',
    topic: 'DFA',
    difficulty: 'medium',
    question: q({ type: 'dfa_construct', reference: { kind: 'regex', regex: '(0|1)*101(0|1)*' } }),
  },
  {
    id: 'nfa-ends-01',
    title: 'Strings ending in 01',
    prompt: 'Construct an NFA (ε-transitions allowed) over {0, 1} that accepts exactly the strings ending in 01. Try to use only three states.',
    topic: 'NFA',
    difficulty: 'easy',
    question: q({ type: 'nfa_construct', reference: { kind: 'regex', regex: '(0|1)*01' } }),
  },
  {
    id: 'nfa-third-last',
    title: 'Third symbol from the end is 1',
    prompt: 'Construct an NFA over {0, 1} that accepts the strings whose third symbol from the end is 1. An NFA needs only four states; the smallest DFA needs eight.',
    topic: 'NFA',
    difficulty: 'medium',
    question: q({ type: 'nfa_construct', reference: { kind: 'regex', regex: '(0|1)*1(0|1)(0|1)' } }),
  },
  {
    id: 'convert-ends-01',
    title: 'Subset construction: ends in 01',
    prompt: 'Convert the given NFA into an equivalent DFA using the subset construction.',
    topic: 'Conversion',
    difficulty: 'medium',
    question: q({ type: 'nfa_to_dfa', given: nfaEndsIn01, reference: { kind: 'given' } }),
  },
  {
    id: 'convert-abc',
    title: 'Subset construction with ε-moves',
    prompt: 'The given ε-NFA accepts a*b*c*. Convert it into an equivalent DFA. Remember to start from the ε-closure of the initial state.',
    topic: 'Conversion',
    difficulty: 'hard',
    question: q({ type: 'nfa_to_dfa', alphabet: ['a', 'b', 'c'], given: enfaABC, reference: { kind: 'given' } }),
  },
  {
    id: 'minimize-mod6',
    title: 'Minimize a six-state DFA',
    prompt: 'Minimize the given DFA. Your answer must accept the same language with as few states as possible.',
    topic: 'Minimization',
    difficulty: 'medium',
    question: q({ type: 'dfa_minimize', given: mod6, reference: { kind: 'given' } }),
  },
  {
    id: 'minimize-redundant',
    title: 'Merge equivalent states',
    prompt: 'The given DFA over {a, b} contains equivalent states. Construct the minimal DFA for the same language.',
    topic: 'Minimization',
    difficulty: 'medium',
    question: q({ type: 'dfa_minimize', alphabet: ['a', 'b'], given: redundant, reference: { kind: 'given' } }),
  },
  {
    id: 'regex-no-11',
    title: 'No two consecutive 1s',
    prompt: 'Write a regular expression over {0, 1} for the strings that do not contain 11 as a substring.',
    topic: 'Regular expressions',
    difficulty: 'medium',
    question: q({ type: 'regex', reference: { kind: 'regex', regex: '(0|10)*(1|ε)' } }),
  },
  {
    id: 'regex-even-length',
    title: 'Strings of even length',
    prompt: 'Write a regular expression over {a, b} for the strings of even length (including the empty string).',
    topic: 'Regular expressions',
    difficulty: 'easy',
    question: q({ type: 'regex', alphabet: ['a', 'b'], reference: { kind: 'regex', regex: '((a|b)(a|b))*' } }),
  },
  {
    id: 'regex-starts-ends-same',
    title: 'First and last symbol are equal',
    prompt: 'Write a regular expression over {a, b} for the non-empty strings whose first and last symbols are the same. Single-symbol strings count.',
    topic: 'Regular expressions',
    difficulty: 'medium',
    question: q({ type: 'regex', alphabet: ['a', 'b'], reference: { kind: 'regex', regex: 'a(a|b)*a|b(a|b)*b|a|b' } }),
  },
  {
    id: 'cfg-anbn',
    title: 'Grammar for aⁿbⁿ',
    prompt: 'Write a context-free grammar for { aⁿbⁿ | n ≥ 0 }.',
    topic: 'Context-free grammars',
    difficulty: 'easy',
    question: q({ type: 'cfg', alphabet: ['a', 'b'], reference: { kind: 'grammar', grammar: 'S -> aSb | ε' } }),
  },
  {
    id: 'cfg-palindromes',
    title: 'Grammar for palindromes',
    prompt: 'Write a context-free grammar for the palindromes over {a, b} (strings that read the same forwards and backwards, including ε).',
    topic: 'Context-free grammars',
    difficulty: 'medium',
    question: q({ type: 'cfg', alphabet: ['a', 'b'], reference: { kind: 'grammar', grammar: 'S -> aSa | bSb | a | b | ε' } }),
  },
  {
    id: 'cfg-balanced',
    title: 'Balanced parentheses',
    prompt: 'Write a context-free grammar for the balanced strings of parentheses over { (, ) }, including ε.',
    topic: 'Context-free grammars',
    difficulty: 'medium',
    question: q({ type: 'cfg', alphabet: ['(', ')'], reference: { kind: 'grammar', grammar: 'S -> SS | (S) | ε' }, criteria: { ...defaultCriteria(), boundedLength: 10 } }),
  },
  {
    id: 'pda-anbn',
    title: 'PDA for aⁿbⁿ',
    prompt: 'Construct a PDA (acceptance by final state, initial stack Z) for { aⁿbⁿ | n ≥ 0 }.',
    topic: 'Pushdown automata',
    difficulty: 'medium',
    question: q({ type: 'pda', alphabet: ['a', 'b'], reference: { kind: 'grammar', grammar: 'S -> aSb | ε' } }),
  },
  {
    id: 'tm-anbn',
    title: 'Turing machine for aⁿbⁿ',
    prompt: 'Construct a deterministic Turing machine that accepts { aⁿbⁿ | n ≥ 0 }. The machine accepts by entering an accepting state and rejects by halting anywhere else.',
    topic: 'Turing machines',
    difficulty: 'hard',
    question: q({ type: 'tm', alphabet: ['a', 'b'], reference: { kind: 'grammar', grammar: 'S -> aSb | ε' }, criteria: { ...defaultCriteria(), boundedLength: 7 } }),
  },
];

const EXACT: QuestionType[] = ['dfa_construct', 'nfa_construct', 'nfa_to_dfa', 'dfa_minimize', 'regex'];

export const publicProblem = (p: PracticeProblem): PublicPracticeProblem => ({
  id: p.id,
  title: p.title,
  prompt: p.prompt,
  topic: p.topic,
  difficulty: p.difficulty,
  type: p.question.type,
  marks: p.question.marks,
  alphabet: p.question.alphabet,
  given: p.question.given ?? null,
  exact: EXACT.includes(p.question.type),
});
