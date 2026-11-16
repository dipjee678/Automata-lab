/**
 * Shared domain model for Automata Lab.
 *
 * These types and Zod schemas are the single JSON representation used by the
 * frontend editor, the algorithm library, the REST API and the database
 * (automata / answers / references are stored as JSONB in this exact shape).
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Display form of the empty string. Internally ε is always stored as ''. */
export const EPSILON = 'ε';
/** Blank tape symbol of Turing machines. */
export const BLANK = '_';
/** Bottom-of-stack marker that every PDA starts with. */
export const STACK_START = 'Z';

/* ------------------------------------------------------------------ */
/* Automata                                                            */
/* ------------------------------------------------------------------ */

export const automatonTypeSchema = z.enum(['DFA', 'NFA', 'ENFA', 'PDA', 'TM']);
export type AutomatonType = z.infer<typeof automatonTypeSchema>;

export const stateSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(40),
  x: z.number().finite(),
  y: z.number().finite(),
  initial: z.boolean().optional(),
  accepting: z.boolean().optional(),
});
export type State = z.infer<typeof stateSchema>;

/**
 * One transition.
 *  - Finite automata: `symbol` is the input symbol ('' = ε).
 *  - PDA: `symbol` is the input read ('' = ε), `pop` the stack symbol removed
 *    ('' = pop nothing), `push` the string pushed ('' = nothing; the LEFTMOST
 *    character ends up on top of the stack).
 *  - Turing machine: `symbol` is the tape symbol read, `write` the symbol
 *    written, `move` the head direction.
 */
export const transitionSchema = z.object({
  id: z.string().min(1).max(64),
  from: z.string().min(1),
  to: z.string().min(1),
  symbol: z.string().max(8),
  pop: z.string().max(8).optional(),
  push: z.string().max(32).optional(),
  write: z.string().max(8).optional(),
  move: z.enum(['L', 'R', 'S']).optional(),
});
export type Transition = z.infer<typeof transitionSchema>;

export const automatonSchema = z.object({
  type: automatonTypeSchema,
  states: z.array(stateSchema).max(300),
  transitions: z.array(transitionSchema).max(3000),
  /** Optional explicit input alphabet. When absent it is derived from the transitions. */
  alphabet: z.array(z.string().min(1).max(8)).max(64).optional(),
});
export type Automaton = z.infer<typeof automatonSchema>;

export const emptyAutomaton = (type: AutomatonType = 'DFA'): Automaton => ({
  type,
  states: [],
  transitions: [],
});

/* ------------------------------------------------------------------ */
/* Grammars                                                            */
/* ------------------------------------------------------------------ */

export interface Production {
  head: string;
  /** Sequence of single-character symbols. Empty array = ε-production. */
  body: string[];
}

export interface Grammar {
  start: string;
  nonterminals: string[];
  terminals: string[];
  productions: Production[];
}

/* ------------------------------------------------------------------ */
/* Questions, answers and grading                                      */
/* ------------------------------------------------------------------ */

export const questionTypeSchema = z.enum([
  'dfa_construct',
  'nfa_construct',
  'nfa_to_dfa',
  'dfa_minimize',
  'regex',
  'cfg',
  'pda',
  'tm',
]);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  dfa_construct: 'Construct a DFA',
  nfa_construct: 'Construct an NFA',
  nfa_to_dfa: 'Convert NFA to DFA',
  dfa_minimize: 'Minimize a DFA',
  regex: 'Write a regular expression',
  cfg: 'Construct a CFG',
  pda: 'Construct a PDA',
  tm: 'Construct a Turing machine',
};

/** Which grading method applies to a question type. */
export const EXACT_QUESTION_TYPES: QuestionType[] = [
  'dfa_construct',
  'nfa_construct',
  'nfa_to_dfa',
  'dfa_minimize',
  'regex',
];

export const testCaseSchema = z.object({
  input: z.string().max(200),
  accept: z.boolean(),
});
export type TestCase = z.infer<typeof testCaseSchema>;

/** The teacher's expected answer. Never sent to students. */
export const referenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('automaton'), automaton: automatonSchema }),
  z.object({ kind: z.literal('regex'), regex: z.string().min(1).max(500) }),
  z.object({ kind: z.literal('grammar'), grammar: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal('tests'), tests: z.array(testCaseSchema).min(1).max(200) }),
  /** For conversion questions the reference is derived from `given`. */
  z.object({ kind: z.literal('given') }),
]);
export type Reference = z.infer<typeof referenceSchema>;

export const criteriaSchema = z.object({
  /** Award partial marks for an inequivalent answer, based on bounded agreement. */
  partialCredit: z.boolean().default(true),
  /** Upper bound (percent of marks) an incorrect answer can earn through partial credit. */
  partialCap: z.number().min(0).max(100).default(50),
  /** Percent of the marks reserved for minimality (dfa_minimize only). */
  minimalityWeight: z.number().min(0).max(100).default(40),
  /** Require a total transition function for DFA answers. */
  requireComplete: z.boolean().default(false),
  /** Bounded testing: all strings up to this length are compared. */
  boundedLength: z.number().int().min(1).max(12).default(8),
});
export type GradingCriteria = z.infer<typeof criteriaSchema>;
export const defaultCriteria = (): GradingCriteria => criteriaSchema.parse({});

export const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('automaton'), automaton: automatonSchema }),
  z.object({ kind: z.literal('regex'), regex: z.string().max(500) }),
  z.object({ kind: z.literal('grammar'), grammar: z.string().max(4000) }),
]);
export type Answer = z.infer<typeof answerSchema>;

/** What kind of answer a question type expects. */
export const answerKindFor = (t: QuestionType): Answer['kind'] =>
  t === 'regex' ? 'regex' : t === 'cfg' ? 'grammar' : 'automaton';

/** Which automaton type the student editor should be set to. */
export const automatonTypeFor = (t: QuestionType): AutomatonType =>
  t === 'nfa_construct' ? 'ENFA' : t === 'pda' ? 'PDA' : t === 'tm' ? 'TM' : 'DFA';

export const questionInputSchema = z.object({
  type: questionTypeSchema,
  title: z.string().min(1).max(200),
  prompt: z.string().max(4000).default(''),
  marks: z.number().min(0).max(1000),
  alphabet: z.array(z.string().min(1).max(8)).max(64).default([]),
  given: automatonSchema.nullable().optional(),
  reference: referenceSchema,
  /** Optional extra test strings, used for bounded testing and feedback. */
  tests: z.array(testCaseSchema).max(200).default([]),
  criteria: criteriaSchema.default({}),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

export type Verdict = 'correct' | 'partial' | 'incorrect' | 'invalid' | 'needs_review';

export interface Counterexample {
  /** The distinguishing string ('' is the empty string). */
  input: string;
  /** Whether the expected language contains it. */
  expected: boolean;
  /** Whether the submitted answer accepts it. */
  actual: boolean;
}

export interface GradeResult {
  score: number;
  maxScore: number;
  verdict: Verdict;
  /** true = mathematically exact decision; false = bounded testing only. */
  exact: boolean;
  /** Human readable name of the method used. */
  method: string;
  feedback: string[];
  counterexample?: Counterexample | null;
}

/* ------------------------------------------------------------------ */
/* Database rows                                                       */
/* ------------------------------------------------------------------ */

export const roleSchema = z.enum(['admin', 'teacher', 'student']);
export type Role = z.infer<typeof roleSchema>;

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  code: string;
  join_code: string;
  teacher_id: string;
  created_at: string;
}

export interface Enrollment {
  id: string;
  course_id: string;
  student_id: string;
  created_at: string;
}

export interface Assignment {
  id: string;
  course_id: string;
  title: string;
  description: string;
  due_at: string | null;
  /** Maximum number of attempts per question (null = unlimited). */
  max_attempts: number | null;
  published: boolean;
  created_at: string;
}

export interface QuestionRow extends QuestionInput {
  id: string;
  assignment_id: string;
  position: number;
  created_at: string;
}

/** A question as students see it: no reference solution, no hidden tests. */
export type PublicQuestion = Omit<QuestionRow, 'reference' | 'tests'>;

export interface Submission {
  id: string;
  question_id: string;
  assignment_id: string;
  student_id: string;
  answer: Answer;
  attempt: number;
  late: boolean;
  created_at: string;
}

export interface Grade {
  id: string;
  submission_id: string;
  auto_score: number;
  final_score: number;
  max_score: number;
  verdict: Verdict;
  exact: boolean;
  method: string;
  feedback: string[];
  counterexample: Counterexample | null;
  adjusted_by: string | null;
  adjust_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedAutomaton {
  id: string;
  owner_id: string;
  name: string;
  type: AutomatonType;
  data: Automaton;
  created_at: string;
  updated_at: string;
}

export interface PracticeHistory {
  id: string;
  user_id: string;
  problem_id: string;
  answer: Answer;
  score: number;
  max_score: number;
  verdict: Verdict;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* API request schemas                                                 */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  full_name: z.string().min(1).max(120),
  role: z.enum(['teacher', 'student']).default('student'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const courseInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  code: z.string().min(1).max(30),
});

export const assignmentInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).default(''),
  due_at: z.string().datetime({ offset: true }).nullable().default(null),
  max_attempts: z.number().int().min(1).max(100).nullable().default(null),
  published: z.boolean().default(false),
});

export const savedAutomatonInputSchema = z.object({
  name: z.string().min(1).max(120),
  data: automatonSchema,
});

export const gradeAdjustSchema = z.object({
  final_score: z.number().min(0),
  note: z.string().max(1000).default(''),
});
