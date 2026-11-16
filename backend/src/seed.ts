/**
 * Demo data for local development: one admin, one teacher, two students, a
 * course with assignments and a few graded submissions.
 *
 * SAMPLE DATA ONLY – never run this against a production database.
 * All seeded accounts share the password below (override with SEED_PASSWORD).
 */
import { buildAutomaton, gradeAnswer } from '@automata/algorithms';
import { defaultCriteria, type Answer, type Assignment, type Course, type Profile, type QuestionInput, type QuestionRow, type Role } from '@automata/shared';
import type { Deps } from './http';

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'automata-demo-1';

export const SEED_USERS: Array<{ email: string; full_name: string; role: Role }> = [
  { email: 'admin@automatalab.test', full_name: 'Ada Admin', role: 'admin' },
  { email: 'teacher@automatalab.test', full_name: 'Dr. Tara Teacher', role: 'teacher' },
  { email: 'student@automatalab.test', full_name: 'Sam Student', role: 'student' },
  { email: 'student2@automatalab.test', full_name: 'Riya Rahman', role: 'student' },
];

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

const mod6 = buildAutomaton('DFA', {
  states: ['A', 'B', 'C', 'D', 'E', 'F'],
  initial: 'A',
  accepting: ['A', 'D'],
  transitions: ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((name, r, all) => [
    [name, '0', all[(2 * r) % 6]!] as [string, string, string],
    [name, '1', all[(2 * r + 1) % 6]!] as [string, string, string],
  ]),
});

const div3 = buildAutomaton('DFA', {
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

const question = (q: Partial<QuestionInput> & Pick<QuestionInput, 'type' | 'title' | 'prompt' | 'reference'>): QuestionInput => ({
  marks: 10,
  alphabet: ['0', '1'],
  given: null,
  tests: [],
  criteria: defaultCriteria(),
  ...q,
});

const REGULAR: QuestionInput[] = [
  question({
    type: 'dfa_construct',
    title: 'Binary strings divisible by 3',
    prompt: 'Construct a DFA over {0, 1} that accepts the binary numbers (most significant bit first) divisible by 3. The empty string is treated as 0 and must be accepted.',
    reference: { kind: 'automaton', automaton: div3 },
    tests: [
      { input: '110', accept: true },
      { input: '101', accept: false },
    ],
  }),
  question({
    type: 'nfa_to_dfa',
    title: 'Convert the NFA to a DFA',
    prompt: 'Use the subset construction to convert the given NFA (strings ending in 01) into an equivalent DFA.',
    given: nfaEndsIn01,
    reference: { kind: 'given' },
  }),
  question({
    type: 'dfa_minimize',
    title: 'Minimize the DFA',
    prompt: 'Minimize the given six-state DFA. Full marks require a DFA that is both equivalent and minimal.',
    given: mod6,
    reference: { kind: 'given' },
    marks: 15,
  }),
  question({
    type: 'regex',
    title: 'Regular expression: ends in 01',
    prompt: 'Write a regular expression over {0, 1} for the strings that end in 01.',
    reference: { kind: 'regex', regex: '(0|1)*01' },
    marks: 5,
  }),
];

const CONTEXT_FREE: QuestionInput[] = [
  question({
    type: 'cfg',
    title: 'Grammar for aⁿbⁿ',
    prompt: 'Write a context-free grammar for { aⁿbⁿ | n ≥ 0 }.',
    alphabet: ['a', 'b'],
    reference: { kind: 'grammar', grammar: 'S -> aSb | ε' },
  }),
  question({
    type: 'pda',
    title: 'PDA for aⁿbⁿ',
    prompt: 'Construct a PDA accepting { aⁿbⁿ | n ≥ 0 } by final state. The stack starts with Z.',
    alphabet: ['a', 'b'],
    reference: { kind: 'grammar', grammar: 'S -> aSb | ε' },
    tests: [
      { input: 'aabb', accept: true },
      { input: 'aab', accept: false },
    ],
  }),
];

/** Insert the demo data. Returns false (and does nothing) if it is already there. */
export async function seedDemo(deps: Deps): Promise<boolean> {
  const { store, auth } = deps;
  if (await store.findOne<Profile>('profiles', { email: SEED_USERS[0]!.email })) return false;

  const users: Record<string, Profile> = {};
  for (const u of SEED_USERS) {
    const id = await auth.register(u.email, SEED_PASSWORD);
    users[u.role === 'student' ? u.email.split('@')[0]! : u.role] = await store.insert<Profile>('profiles', { id, ...u });
  }
  const teacher = users.teacher!;

  const course = await store.insert<Course>('courses', {
    title: 'Theory of Computation',
    code: 'CSE 331',
    description: 'Finite automata, regular expressions, context-free grammars, pushdown automata and Turing machines.',
    teacher_id: teacher.id,
    join_code: 'DEMO331',
  });
  for (const key of ['student', 'student2']) await store.insert('enrollments', { course_id: course.id, student_id: users[key]!.id });

  const inTwoWeeks = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  const addAssignment = async (title: string, description: string, published: boolean, questions: QuestionInput[]) => {
    const a = await store.insert<Assignment>('assignments', { course_id: course.id, title, description, due_at: inTwoWeeks, max_attempts: null, published });
    const rows: QuestionRow[] = [];
    for (const [i, q] of questions.entries()) rows.push(await store.insert<QuestionRow>('questions', { ...q, assignment_id: a.id, position: i + 1 }));
    return { assignment: a, questions: rows };
  };

  const hw1 = await addAssignment('Homework 1: Regular Languages', 'DFA construction, subset construction, minimization and regular expressions. All questions are graded exactly by language equivalence.', true, REGULAR);
  await addAssignment('Homework 2: Context-Free Languages', 'Grammars and pushdown automata. These are graded by bounded testing and reviewed by the teacher.', true, CONTEXT_FREE);
  await addAssignment('Homework 3: Turing Machines (draft)', 'Not yet published.', false, []);

  // A few graded submissions from the second student so analytics have data.
  const submit = async (q: QuestionRow, answer: Answer, attempt: number) => {
    const result = gradeAnswer({ ...q, given: q.given ?? null }, answer);
    const s = await store.insert<{ id: string }>('submissions', { question_id: q.id, assignment_id: q.assignment_id, student_id: users.student2!.id, answer, attempt, late: false });
    await store.insert('grades', {
      submission_id: s.id,
      auto_score: result.score,
      final_score: result.score,
      max_score: result.maxScore,
      verdict: result.verdict,
      exact: result.exact,
      method: result.method,
      feedback: result.feedback,
      counterexample: result.counterexample ?? null,
      adjusted_by: null,
      adjust_note: null,
      updated_at: new Date().toISOString(),
    });
  };
  const wrongDiv3 = { ...div3, states: div3.states.map((s) => ({ ...s, accepting: s.label === 'r1' })) };
  await submit(hw1.questions[0]!, { kind: 'automaton', automaton: wrongDiv3 }, 1);
  await submit(hw1.questions[0]!, { kind: 'automaton', automaton: div3 }, 2);
  await submit(hw1.questions[2]!, { kind: 'automaton', automaton: mod6 }, 1);
  await submit(hw1.questions[3]!, { kind: 'regex', regex: '(0+1)*1' }, 1);

  return true;
}
