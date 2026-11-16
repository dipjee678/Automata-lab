import { describe, expect, it } from 'vitest';
import { defaultCriteria, type Answer, type Automaton } from '@automata/shared';
import { acceptsFA, buildAutomaton, gradeAnswer, minimizeDfa, dfaToAutomaton, toDfa, validateQuestion, type GradableQuestion } from '../src';
import { anbnPda, anbnTm, div3, div3Mod6, endsIn01 } from './fixtures';

const question = (over: Partial<GradableQuestion>): GradableQuestion => ({
  type: 'dfa_construct',
  marks: 10,
  alphabet: ['0', '1'],
  given: null,
  reference: { kind: 'automaton', automaton: div3 },
  tests: [],
  criteria: defaultCriteria(),
  ...over,
});
const fa = (automaton: Automaton): Answer => ({ kind: 'automaton', automaton });

describe('grading: DFA construction (exact)', () => {
  const q = question({});

  it('gives full marks to an equivalent DFA with a completely different structure', () => {
    const r = gradeAnswer(q, fa(div3Mod6));
    expect(r).toMatchObject({ score: 10, maxScore: 10, verdict: 'correct', exact: true, counterexample: null });
  });

  it('also accepts a regex reference', () => {
    const r = gradeAnswer(question({ reference: { kind: 'regex', regex: '(0|1(01*0)*1)*' } }), fa(div3));
    expect(r.verdict).toBe('correct');
  });

  it('returns a shortest counterexample for a wrong DFA', () => {
    // Off by one: accepts remainder 1 instead of remainder 0.
    const wrong = { ...div3, states: div3.states.map((s) => ({ ...s, accepting: s.label === 'r1' })) };
    const r = gradeAnswer(q, fa(wrong));
    expect(r.exact).toBe(true);
    expect(r.verdict).not.toBe('correct');
    expect(r.counterexample).toEqual({ input: '', expected: true, actual: false });
    expect(r.feedback[0]).toMatch(/must be accepted/);
    expect(r.feedback.join('\n')).toMatch(/run:/);
    expect(r.score).toBeLessThan(5);
  });

  it('the counterexample really distinguishes the two languages', () => {
    const wrong = buildAutomaton('DFA', {
      states: ['x', 'y'],
      initial: 'x',
      accepting: ['x'],
      transitions: [
        ['x', '0', 'x'],
        ['x', '1', 'y'],
        ['y', '1', 'x'],
        ['y', '0', 'y'],
      ],
    });
    const r = gradeAnswer(q, fa(wrong));
    const ce = r.counterexample!;
    expect(acceptsFA(div3, ce.input)).toBe(ce.expected);
    expect(acceptsFA(wrong, ce.input)).toBe(ce.actual);
    expect(ce.expected).not.toBe(ce.actual);
    // The wrong DFA accepts "even number of 1s". Every string of length ≤ 2 agrees;
    // 101 (= 5, not divisible by 3, two 1s) is the first difference in shortlex order.
    expect(ce.input).toBe('101');
  });

  it('awards partial credit capped by the teacher and none when disabled', () => {
    // Almost right: differs only on strings that visit r2 then read 1.
    const near = buildAutomaton('DFA', {
      states: ['r0', 'r1', 'r2'],
      initial: 'r0',
      accepting: ['r0'],
      transitions: [
        ['r0', '0', 'r0'],
        ['r0', '1', 'r1'],
        ['r1', '0', 'r2'],
        ['r1', '1', 'r0'],
        ['r2', '0', 'r1'],
        ['r2', '1', 'r1'],
      ],
    });
    const withPartial = gradeAnswer(q, fa(near));
    expect(withPartial.verdict).toBe('partial');
    expect(withPartial.score).toBeGreaterThan(0);
    expect(withPartial.score).toBeLessThanOrEqual(5); // default cap 50%
    const strict = gradeAnswer(question({ criteria: { ...defaultCriteria(), partialCredit: false } }), fa(near));
    expect(strict).toMatchObject({ score: 0, verdict: 'incorrect' });
  });

  it('gives a trivial answer (accept everything) no partial credit', () => {
    const all = buildAutomaton('DFA', { states: ['p'], initial: 'p', accepting: ['p'], transitions: [['p', '0,1', 'p']] });
    expect(gradeAnswer(q, fa(all))).toMatchObject({ score: 0, verdict: 'incorrect' });
  });

  it('rejects an NFA where a DFA is required', () => {
    const r = gradeAnswer(q, fa(endsIn01));
    expect(r).toMatchObject({ score: 0, verdict: 'invalid' });
    expect(r.feedback.join('\n')).toMatch(/nondeterminism/i);
  });

  it('rejects submissions without an initial state or of the wrong kind', () => {
    const noInit = { ...div3, states: div3.states.map((s) => ({ ...s, initial: false })) };
    expect(gradeAnswer(q, fa(noInit)).verdict).toBe('invalid');
    expect(gradeAnswer(q, { kind: 'regex', regex: '0*' }).verdict).toBe('invalid');
    expect(gradeAnswer(q, { kind: 'grammar', grammar: 'S -> 0' }).verdict).toBe('invalid');
    expect(gradeAnswer(q, fa(anbnPda)).verdict).toBe('invalid');
  });

  it('treats missing transitions as a dead state unless completeness is required', () => {
    const ref = buildAutomaton('DFA', {
      states: ['a', 'b', 'dead'],
      initial: 'a',
      accepting: ['b'],
      transitions: [
        ['a', '0', 'b'],
        ['a', '1', 'dead'],
        ['b', '0,1', 'dead'],
        ['dead', '0,1', 'dead'],
      ],
    });
    const partial = buildAutomaton('DFA', { states: ['a', 'b'], initial: 'a', accepting: ['b'], transitions: [['a', '0', 'b']] });
    const lenient = question({ reference: { kind: 'automaton', automaton: ref } });
    expect(gradeAnswer(lenient, fa(partial)).verdict).toBe('correct');
    const strict = question({ reference: { kind: 'automaton', automaton: ref }, criteria: { ...defaultCriteria(), requireComplete: true } });
    expect(gradeAnswer(strict, fa(partial)).verdict).toBe('invalid');
  });
});

describe('grading: NFA construction and NFA → DFA (exact)', () => {
  it('accepts any equivalent NFA or DFA for an NFA question', () => {
    const q = question({ type: 'nfa_construct', reference: { kind: 'regex', regex: '(0|1)*01' } });
    expect(gradeAnswer(q, fa(endsIn01)).verdict).toBe('correct');
    expect(gradeAnswer(q, fa(dfaToAutomaton(toDfa(endsIn01)))).verdict).toBe('correct');
  });

  it('requires a deterministic, equivalent answer for a conversion question', () => {
    const q = question({ type: 'nfa_to_dfa', given: endsIn01, reference: { kind: 'given' } });
    expect(gradeAnswer(q, fa(endsIn01)).verdict).toBe('invalid'); // handing the NFA back is not a DFA
    expect(gradeAnswer(q, fa(dfaToAutomaton(toDfa(endsIn01)))).verdict).toBe('correct');
    const r = gradeAnswer(q, fa(div3));
    expect(r.verdict).not.toBe('correct');
    expect(r.counterexample).not.toBeNull();
  });
});

describe('grading: DFA minimization (exact)', () => {
  const q = question({ type: 'dfa_minimize', given: div3Mod6, reference: { kind: 'given' } });

  it('gives full marks only to an equivalent AND minimal DFA', () => {
    expect(gradeAnswer(q, fa(div3))).toMatchObject({ score: 10, verdict: 'correct' });
    expect(gradeAnswer(q, fa(dfaToAutomaton(minimizeDfa(toDfa(div3Mod6)).dfa))).verdict).toBe('correct');
  });

  it('deducts the minimality share for an equivalent but non-minimal DFA', () => {
    const r = gradeAnswer(q, fa(div3Mod6));
    expect(r).toMatchObject({ score: 6, verdict: 'partial', exact: true }); // default minimality weight 40%
    expect(r.feedback[0]).toMatch(/not minimal: it has 6 state\(s\).*has 3/);
  });

  it('still reports a counterexample for a small but wrong DFA', () => {
    const tiny = buildAutomaton('DFA', { states: ['p'], initial: 'p', accepting: ['p'], transitions: [['p', '0,1', 'p']] });
    const r = gradeAnswer(q, fa(tiny));
    expect(r.counterexample).toEqual({ input: '1', expected: false, actual: true });
  });
});

describe('grading: regular expressions (exact)', () => {
  const q = question({ type: 'regex', reference: { kind: 'regex', regex: '(0|1)*01' } });

  it('accepts a differently written equivalent expression', () => {
    expect(gradeAnswer(q, { kind: 'regex', regex: '(0+1)*01' }).verdict).toBe('correct');
    expect(gradeAnswer(q, { kind: 'regex', regex: '(1|0)*0(0|1)*01|1*01|(0|1)*01' }).verdict).toBe('correct');
  });

  it('accepts a regex graded against an automaton reference', () => {
    const viaNfa = question({ type: 'regex', reference: { kind: 'automaton', automaton: endsIn01 } });
    expect(gradeAnswer(viaNfa, { kind: 'regex', regex: '(0|1)*01' }).verdict).toBe('correct');
  });

  it('gives a counterexample for a wrong expression', () => {
    const r = gradeAnswer(q, { kind: 'regex', regex: '(0|1)*1' });
    expect(r.counterexample).toEqual({ input: '1', expected: false, actual: true });
    expect(r.exact).toBe(true);
  });

  it('reports syntax errors as invalid', () => {
    const r = gradeAnswer(q, { kind: 'regex', regex: '(0|1' });
    expect(r.verdict).toBe('invalid');
    expect(r.feedback[0]).toMatch(/syntax error/i);
  });
});

describe('grading: CFG / PDA / TM (bounded testing, clearly labelled)', () => {
  const cfgQ = question({ type: 'cfg', alphabet: ['a', 'b'], reference: { kind: 'grammar', grammar: 'S -> aSb | ε' } });

  it('accepts an equivalent grammar but marks the result as not exact', () => {
    const r = gradeAnswer(cfgQ, { kind: 'grammar', grammar: 'S -> aTb | ε\nT -> aTb | ε' });
    expect(r).toMatchObject({ score: 10, verdict: 'correct', exact: false });
    expect(r.method).toMatch(/^Bounded testing/);
    expect(r.feedback.join('\n')).toMatch(/not a proof/);
    expect(r.feedback.join('\n')).toMatch(/undecidable/);
  });

  it('finds a shortest counterexample for a wrong grammar', () => {
    const r = gradeAnswer(cfgQ, { kind: 'grammar', grammar: 'S -> aSb | ab' });
    expect(r.counterexample).toEqual({ input: '', expected: true, actual: false });
    expect(r.exact).toBe(false);
    const r2 = gradeAnswer(cfgQ, { kind: 'grammar', grammar: 'S -> aS | Sb | ε' });
    expect(r2.counterexample).toEqual({ input: 'a', expected: false, actual: true });
  });

  it('reports grammar syntax errors as invalid', () => {
    expect(gradeAnswer(cfgQ, { kind: 'grammar', grammar: 'this is not a grammar' }).verdict).toBe('invalid');
  });

  it('grades a PDA against a reference grammar and against test strings', () => {
    const viaGrammar = question({ type: 'pda', alphabet: ['a', 'b'], reference: { kind: 'grammar', grammar: 'S -> aSb | ε' } });
    expect(gradeAnswer(viaGrammar, fa(anbnPda))).toMatchObject({ verdict: 'correct', exact: false });
    const viaTests = question({
      type: 'pda',
      alphabet: ['a', 'b'],
      reference: { kind: 'tests', tests: [{ input: 'ab', accept: true }, { input: 'aab', accept: false }, { input: '', accept: true }] },
    });
    const ok = gradeAnswer(viaTests, fa(anbnPda));
    expect(ok).toMatchObject({ verdict: 'correct', exact: false });
    expect(ok.method).toMatch(/3 teacher test string/);
    expect(gradeAnswer(viaTests, fa(div3)).verdict).toBe('invalid'); // a DFA is not a PDA submission
  });

  it('grades a Turing machine against a reference machine', () => {
    const q = question({ type: 'tm', alphabet: ['a', 'b'], reference: { kind: 'automaton', automaton: anbnTm }, criteria: { ...defaultCriteria(), boundedLength: 6 } });
    expect(gradeAnswer(q, fa(anbnTm))).toMatchObject({ verdict: 'correct', exact: false });
    const acceptAll = buildAutomaton('TM', { states: ['s'], initial: 's', accepting: ['s'], transitions: [] });
    const r = gradeAnswer(q, fa(acceptAll));
    expect(r.counterexample).toEqual({ input: 'a', expected: false, actual: true });
  });

  it('falls back to bounded testing for a regular question that only has test strings', () => {
    const q = question({ reference: { kind: 'tests', tests: [{ input: '11', accept: true }, { input: '10', accept: false }] } });
    const r = gradeAnswer(q, fa(div3));
    expect(r).toMatchObject({ verdict: 'correct', exact: false });
  });
});

describe('question validation', () => {
  it('accepts well-formed questions', () => {
    expect(validateQuestion(question({}))).toEqual([]);
    expect(validateQuestion(question({ type: 'dfa_minimize', given: div3Mod6, reference: { kind: 'given' } }))).toEqual([]);
  });

  it('rejects broken references', () => {
    expect(validateQuestion(question({ type: 'regex', reference: { kind: 'regex', regex: '(a' } }))).toHaveLength(1);
    expect(validateQuestion(question({ type: 'cfg', reference: { kind: 'grammar', grammar: 'oops' } }))).toHaveLength(1);
    expect(validateQuestion(question({ type: 'nfa_to_dfa', reference: { kind: 'given' } })).length).toBeGreaterThan(0);
    expect(validateQuestion(question({ type: 'dfa_minimize', given: endsIn01, reference: { kind: 'given' } })).join()).toMatch(/must be a DFA/);
  });
});
