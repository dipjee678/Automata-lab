/**
 * Automatic grading engine.
 *
 * Regular-language questions (DFA / NFA construction, NFA→DFA, minimization,
 * regular expressions) are graded EXACTLY: both the submission and the
 * reference are turned into DFAs and compared by language equivalence, never
 * by state names or graph shape. A shortest counterexample is produced when
 * they differ.
 *
 * CFG, PDA and Turing-machine questions have no general decidable equivalence
 * test, so they are graded by BOUNDED TESTING (every string up to a length
 * bound plus the teacher's test cases). Those results are flagged
 * `exact: false` and are meant to be reviewed by the teacher.
 */
import type {
  Answer,
  Automaton,
  Counterexample,
  GradeResult,
  GradingCriteria,
  QuestionType,
  Reference,
  TestCase,
} from '@automata/shared';
import { alphabetOf, isFiniteAutomaton, labelOf, simulateFA, validateAutomaton } from './fa';
import { agreementCounts, checkEquivalence, dfaAccepts, isMinimalDfa, minimizeDfa, toDfa, type Dfa } from './dfa';
import { parseRegex, regexAlphabet, regexToDfa, validateRegex } from './regex';
import { cfgAccepts, parseGrammar } from './cfg';
import { simulatePda } from './pda';
import { simulateTm } from './tm';
import { balancedAccuracy, boundedCompare, showString } from './util';
import { BLANK } from '@automata/shared';

export interface GradableQuestion {
  type: QuestionType;
  marks: number;
  alphabet: string[];
  given?: Automaton | null;
  reference: Reference;
  tests: TestCase[];
  criteria: GradingCriteria;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

const invalid = (q: GradableQuestion, feedback: string[], method = 'Validation'): GradeResult => ({
  score: 0,
  maxScore: q.marks,
  verdict: 'invalid',
  exact: true,
  method,
  feedback,
  counterexample: null,
});

/** Marks for a wrong answer: scaled balanced accuracy, capped by the teacher's partial-credit cap. */
function partialScore(q: GradableQuestion, counts: { both: number; onlyExpected: number; onlyActual: number; neither: number }): number {
  if (!q.criteria.partialCredit) return 0;
  const quality = Math.max(0, 2 * balancedAccuracy(counts) - 1); // 0 for trivial answers, 1 for perfect
  return round2(q.marks * (q.criteria.partialCap / 100) * quality);
}

/* ------------------------------------------------------------------ */
/* Exact grading for regular languages                                 */
/* ------------------------------------------------------------------ */

/** DFA for the expected language, or null when the reference is not a regular-language description. */
function referenceDfa(q: GradableQuestion): Dfa | null {
  const ref = q.reference;
  if (ref.kind === 'regex') return regexToDfa(ref.regex, q.alphabet);
  const automaton = ref.kind === 'automaton' ? ref.automaton : ref.kind === 'given' ? q.given : null;
  if (!automaton || !isFiniteAutomaton(automaton.type)) return null;
  const check = validateAutomaton(automaton, { as: 'ENFA' });
  if (check.errors.length) throw new Error(`The reference solution of this question is invalid: ${check.errors[0]}`);
  return toDfa(automaton, q.alphabet);
}

/** Describe how the student's automaton processes a string (used in feedback). */
function describeRun(a: Automaton, input: string): string {
  const trace = simulateFA(a, input);
  const show = (ids: string[]) => (ids.length === 1 ? labelOf(a, ids[0]!) : ids.length === 0 ? '∅' : `{${ids.map((id) => labelOf(a, id)).join(', ')}}`);
  const parts = trace.steps.map((s, i) => (i === 0 ? show(s.active) : `—${s.symbol}→ ${show(s.active)}`));
  return `Your automaton's run: ${parts.join(' ')}  ⇒ ${trace.accepted ? 'accepts' : 'rejects'}.`;
}

function gradeRegular(q: GradableQuestion, answer: Answer, expected: Dfa): GradeResult {
  const feedback: string[] = [];
  let student: Dfa;
  let studentAutomaton: Automaton | null = null;
  const needsDfa = q.type === 'dfa_construct' || q.type === 'nfa_to_dfa' || q.type === 'dfa_minimize';

  // 1. Validate the submission.
  if (answer.kind === 'regex') {
    if (q.type !== 'regex') return invalid(q, ['This question expects an automaton, not a regular expression.']);
    const v = validateRegex(answer.regex);
    if (!v.ok) return invalid(q, [`Syntax error in the regular expression: ${v.error}`]);
    student = regexToDfa(answer.regex, q.alphabet);
  } else if (answer.kind === 'automaton') {
    if (q.type === 'regex') return invalid(q, ['This question expects a regular expression, not an automaton.']);
    const a = answer.automaton;
    if (!isFiniteAutomaton(a.type)) return invalid(q, [`This question expects a finite automaton, but a ${a.type} was submitted.`]);
    const sigma = [...new Set([...q.alphabet, ...expected.alphabet])];
    const v = validateAutomaton(a, { as: needsDfa ? 'DFA' : 'ENFA', alphabet: sigma, requireComplete: needsDfa && q.criteria.requireComplete });
    if (v.errors.length)
      return invalid(q, [needsDfa ? 'The submission is not a valid DFA:' : 'The submission is not a valid automaton:', ...v.errors]);
    feedback.push(...v.warnings.map((w) => `Note: ${w}`));
    student = toDfa(a, q.alphabet);
    studentAutomaton = a;
  } else {
    return invalid(q, ['This question does not accept a grammar as its answer.']);
  }

  // 2. Exact language comparison: BFS over the symmetric-difference product.
  const eq = checkEquivalence(expected, student);
  const method = 'Exact language equivalence (product construction + BFS)';

  if (!eq.equivalent) {
    const ce: Counterexample = { input: eq.counterexample!, expected: eq.inA!, actual: eq.inB! };
    feedback.unshift(
      ce.expected
        ? `Counterexample: ${showString(ce.input)} must be accepted, but your answer rejects it.`
        : `Counterexample: ${showString(ce.input)} must be rejected, but your answer accepts it.`,
    );
    if (studentAutomaton) feedback.push(describeRun(studentAutomaton, ce.input));
    feedback.push('This is a shortest string on which your language differs from the expected one.');

    const counts = agreementCounts(expected, student, q.criteria.boundedLength);
    const score = partialScore(q, { both: counts.both, onlyExpected: counts.onlyA, onlyActual: counts.onlyB, neither: counts.neither });
    const total = counts.both + counts.onlyA + counts.onlyB + counts.neither;
    const agree = counts.both + counts.neither;
    feedback.push(
      `Of all ${total} strings of length ≤ ${counts.maxLen}, your answer classifies ${agree} correctly ` +
        `(${counts.onlyA} wrongly rejected, ${counts.onlyB} wrongly accepted).`,
    );
    const failing = q.tests.filter((t) => dfaAccepts(student, t.input) !== t.accept).slice(0, 3);
    if (failing.length) feedback.push(`Failing test strings: ${failing.map((t) => `${showString(t.input)} (should be ${t.accept ? 'accepted' : 'rejected'})`).join('; ')}.`);
    return { score, maxScore: q.marks, verdict: score > 0 ? 'partial' : 'incorrect', exact: true, method, feedback, counterexample: ce };
  }

  // 3. Equivalent. Minimization questions additionally require minimality.
  if (q.type === 'dfa_minimize') {
    const info = isMinimalDfa(student);
    const target = minimizeDfa(expected).dfa.names.length;
    if (!info.minimal) {
      const score = round2(q.marks * (1 - q.criteria.minimalityWeight / 100));
      feedback.unshift(
        `Your DFA accepts the correct language but is not minimal: it has ${info.states} state(s), ` +
          `while the minimal complete DFA has ${target}.`,
      );
      if (info.unreachable.length) feedback.push(`Unreachable state(s) that can be removed: ${info.unreachable.join(', ')}.`);
      else feedback.push('Some of your states are equivalent (no string distinguishes them) and can be merged.');
      return { score, maxScore: q.marks, verdict: score > 0 ? 'partial' : 'incorrect', exact: true, method: `${method} + minimality check (partition refinement)`, feedback, counterexample: null };
    }
    feedback.unshift(`Correct: your DFA is equivalent to the given one and minimal (${info.states} state(s)).`);
    return { score: q.marks, maxScore: q.marks, verdict: 'correct', exact: true, method: `${method} + minimality check (partition refinement)`, feedback, counterexample: null };
  }

  feedback.unshift(
    q.type === 'regex'
      ? 'Correct: your expression describes exactly the expected language.'
      : 'Correct: your automaton accepts exactly the expected language.',
  );
  return { score: q.marks, maxScore: q.marks, verdict: 'correct', exact: true, method, feedback, counterexample: null };
}

/* ------------------------------------------------------------------ */
/* Bounded grading (CFG / PDA / TM / test-only references)             */
/* ------------------------------------------------------------------ */

interface Oracle {
  accepts: (s: string) => boolean;
  alphabet: string[];
  /** Number of runs that hit a resource limit (counted as "reject"). */
  inconclusive: () => number;
  /** Maximum number of strings worth enumerating against this oracle. */
  cap: number;
}

function automatonOracle(a: Automaton, alphabetHint: string[]): Oracle {
  let inconclusive = 0;
  if (a.type === 'PDA')
    return {
      accepts: (s) => {
        const r = simulatePda(a, s, { maxConfigs: 4000 });
        if (r.status === 'limit') inconclusive++;
        return r.accepted;
      },
      alphabet: alphabetOf(a),
      inconclusive: () => inconclusive,
      cap: 1200,
    };
  if (a.type === 'TM')
    return {
      accepts: (s) => {
        const r = simulateTm(a, s, { maxSteps: 2000, keepTrace: false });
        if (r.status === 'limit') inconclusive++;
        return r.accepted;
      },
      alphabet: alphabetOf(a).filter((c) => c !== BLANK),
      inconclusive: () => inconclusive,
      cap: 800,
    };
  const d = toDfa(a, alphabetHint);
  return { accepts: (s) => dfaAccepts(d, s), alphabet: d.alphabet, inconclusive: () => 0, cap: 3000 };
}

function gradeBounded(q: GradableQuestion, answer: Answer): GradeResult {
  const feedback: string[] = [];

  // 1. Validate the submission and build its membership oracle.
  let student: Oracle;
  if (answer.kind === 'grammar') {
    if (q.type !== 'cfg') return invalid(q, ['This question does not accept a grammar as its answer.']);
    const parsed = parseGrammar(answer.grammar);
    if (!parsed.grammar) return invalid(q, ['The grammar is not valid:', ...parsed.errors]);
    feedback.push(...parsed.warnings.map((w) => `Note: ${w}`));
    const g = parsed.grammar;
    student = { accepts: (s) => cfgAccepts(g, s), alphabet: g.terminals, inconclusive: () => 0, cap: 2500 };
  } else if (answer.kind === 'automaton') {
    const a = answer.automaton;
    const want = q.type === 'pda' ? 'PDA' : q.type === 'tm' ? 'TM' : q.type === 'cfg' ? null : 'FA';
    if (want === null) return invalid(q, ['This question expects a grammar.']);
    if (want === 'FA' ? !isFiniteAutomaton(a.type) : a.type !== want)
      return invalid(q, [`This question expects a ${want === 'FA' ? 'finite automaton' : want}, but a ${a.type} was submitted.`]);
    const needsDfa = q.type === 'dfa_construct' || q.type === 'nfa_to_dfa' || q.type === 'dfa_minimize';
    const v = validateAutomaton(a, needsDfa ? { as: 'DFA', alphabet: q.alphabet, requireComplete: q.criteria.requireComplete } : want === 'FA' ? { as: 'ENFA' } : {});
    if (v.errors.length) return invalid(q, ['The submission is not valid:', ...v.errors]);
    feedback.push(...v.warnings.map((w) => `Note: ${w}`));
    student = automatonOracle(a, q.alphabet);
  } else {
    if (q.type !== 'regex') return invalid(q, ['This question does not accept a regular expression as its answer.']);
    const v = validateRegex(answer.regex);
    if (!v.ok) return invalid(q, [`Syntax error in the regular expression: ${v.error}`]);
    const d = regexToDfa(answer.regex, q.alphabet);
    student = { accepts: (s) => dfaAccepts(d, s), alphabet: d.alphabet, inconclusive: () => 0, cap: 3000 };
  }

  // 2. Build the expected-language oracle (if the reference describes a language).
  let expected: Oracle | null = null;
  const ref = q.reference;
  if (ref.kind === 'grammar') {
    const parsed = parseGrammar(ref.grammar);
    if (!parsed.grammar) throw new Error(`The reference grammar of this question is invalid: ${parsed.errors[0]}`);
    const g = parsed.grammar;
    expected = { accepts: (s) => cfgAccepts(g, s), alphabet: g.terminals, inconclusive: () => 0, cap: 2500 };
  } else if (ref.kind === 'regex') {
    const d = regexToDfa(ref.regex, q.alphabet);
    expected = { accepts: (s) => dfaAccepts(d, s), alphabet: [...regexAlphabet(parseRegex(ref.regex))], inconclusive: () => 0, cap: 3000 };
  } else if (ref.kind === 'automaton' || (ref.kind === 'given' && q.given)) {
    expected = automatonOracle(ref.kind === 'automaton' ? ref.automaton : q.given!, q.alphabet);
  }

  // 3. Run the comparison: exhaustive up to a length bound + explicit tests.
  const counts = { both: 0, onlyExpected: 0, onlyActual: 0, neither: 0 };
  let first: Counterexample | null = null;
  const record = (input: string, e: boolean, a: boolean) => {
    if (e && a) counts.both++;
    else if (e) counts.onlyExpected++;
    else if (a) counts.onlyActual++;
    else counts.neither++;
    if (e !== a && (!first || input.length < first.input.length)) first = { input, expected: e, actual: a };
  };

  let methodParts: string[] = [];
  if (expected) {
    const sigma = q.alphabet.length ? q.alphabet : [...new Set([...expected.alphabet, ...student.alphabet])];
    const cmp = boundedCompare(expected.accepts, student.accepts, sigma, q.criteria.boundedLength, Math.min(expected.cap, student.cap));
    counts.both += cmp.both;
    counts.onlyExpected += cmp.onlyExpected;
    counts.onlyActual += cmp.onlyActual;
    counts.neither += cmp.neither;
    if (cmp.firstDifference) first = cmp.firstDifference;
    methodParts.push(`all ${cmp.tested} strings of length ≤ ${cmp.testedLength} over {${[...sigma].sort().join(', ')}}`);
  }
  const tests = [...(ref.kind === 'tests' ? ref.tests : []), ...q.tests];
  for (const t of tests) record(t.input, t.accept, student.accepts(t.input));
  if (tests.length) methodParts.push(`${tests.length} teacher test string(s)`);
  if (methodParts.length === 0) throw new Error('This question has neither a reference solution nor test strings to grade against.');

  const method = `Bounded testing: ${methodParts.join(' + ')}`;
  const stuck = student.inconclusive();
  if (stuck) feedback.push(`Note: ${stuck} run(s) hit the step/configuration limit and were counted as "not accepted".`);

  const ce = first as Counterexample | null;
  if (!ce) {
    feedback.unshift(
      `No difference found. Your answer agrees with the expected language on ${methodParts.join(' and ')}.`,
      'This is bounded testing, not a proof: equivalence of ' +
        (q.type === 'tm' ? 'Turing machines' : q.type === 'pda' ? 'pushdown automata' : q.type === 'cfg' ? 'context-free grammars' : 'these descriptions') +
        ' is ' + (q.type === 'cfg' || q.type === 'pda' || q.type === 'tm' ? 'undecidable in general' : 'checked here only against test strings') +
        ', so your teacher may still review this answer.',
    );
    return { score: q.marks, maxScore: q.marks, verdict: 'correct', exact: false, method, feedback, counterexample: null };
  }

  feedback.unshift(
    ce.expected
      ? `Counterexample: ${showString(ce.input)} must be accepted, but your answer does not accept it.`
      : `Counterexample: ${showString(ce.input)} must be rejected, but your answer accepts it.`,
  );
  const total = counts.both + counts.onlyExpected + counts.onlyActual + counts.neither;
  feedback.push(`${counts.both + counts.neither} of ${total} tested strings were classified correctly (${counts.onlyExpected} wrongly rejected, ${counts.onlyActual} wrongly accepted).`);
  const score = partialScore(q, counts);
  return { score, maxScore: q.marks, verdict: score > 0 ? 'partial' : 'incorrect', exact: false, method, feedback, counterexample: ce };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Grade one answer. Never throws for a bad SUBMISSION (that yields an
 * 'invalid' verdict); throws only when the QUESTION itself is broken.
 */
export function gradeAnswer(q: GradableQuestion, answer: Answer): GradeResult {
  const regularType = q.type === 'dfa_construct' || q.type === 'nfa_construct' || q.type === 'nfa_to_dfa' || q.type === 'dfa_minimize' || q.type === 'regex';
  if (regularType) {
    const expected = referenceDfa(q);
    if (expected) return gradeRegular(q, answer, expected);
  }
  return gradeBounded(q, answer);
}

/** Check that a question can be graded at all (used when a teacher saves it). */
export function validateQuestion(q: GradableQuestion): string[] {
  const errors: string[] = [];
  const ref = q.reference;
  try {
    if (ref.kind === 'regex') parseRegex(ref.regex);
    if (ref.kind === 'grammar') {
      const p = parseGrammar(ref.grammar);
      if (!p.grammar) errors.push(`Reference grammar: ${p.errors[0]}`);
    }
    if (ref.kind === 'automaton') {
      const v = validateAutomaton(ref.automaton, isFiniteAutomaton(ref.automaton.type) ? { as: 'ENFA' } : {});
      if (v.errors.length) errors.push(`Reference automaton: ${v.errors[0]}`);
    }
    if (ref.kind === 'given') {
      if (!q.given) errors.push('This question type needs a given automaton.');
    }
    if (q.given) {
      const v = validateAutomaton(q.given, isFiniteAutomaton(q.given.type) ? { as: 'ENFA' } : {});
      if (v.errors.length) errors.push(`Given automaton: ${v.errors[0]}`);
    }
    if ((q.type === 'nfa_to_dfa' || q.type === 'dfa_minimize') && !q.given) errors.push('Conversion and minimization questions need a given automaton.');
    if (q.type === 'dfa_minimize' && q.given && validateAutomaton(q.given, { as: 'DFA' }).errors.length)
      errors.push('The given automaton of a minimization question must be a DFA.');
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return errors;
}
