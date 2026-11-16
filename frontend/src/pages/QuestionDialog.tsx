/** Teacher dialogs: author a question, and try it out as a student would. */
import { useMemo, useState } from 'react';
import { isFiniteAutomaton } from '@automata/algorithms';
import {
  defaultCriteria,
  emptyAutomaton,
  EXACT_QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  questionTypeSchema,
  type Answer,
  type Automaton,
  type AutomatonType,
  type GradeResult,
  type GradingCriteria,
  type QuestionInput,
  type QuestionRow,
  type QuestionType,
  type Reference,
  type TestCase,
} from '@automata/shared';
import { AnswerEditor, answerProblem, emptyAnswer, GRAMMAR_HELP, GradeFeedback, REGEX_HELP } from '../components/answers';
import { Button, Field, MethodBadge, Modal, Notice } from '../components/ui';
import { AutomatonEditor } from '../editor/AutomatonEditor';
import { api, errorMessage } from '../lib/api';
import { EXAMPLES, TYPE_NAMES } from '../lib/examples';
import { convertType, toast, useWorkspace } from '../lib/stores';

type RefKind = Reference['kind'];

/** Which kinds of reference solution make sense for each question type. */
const REFERENCE_KINDS: Record<QuestionType, RefKind[]> = {
  dfa_construct: ['automaton', 'regex', 'tests'],
  nfa_construct: ['automaton', 'regex', 'tests'],
  nfa_to_dfa: ['given'],
  dfa_minimize: ['given'],
  regex: ['regex', 'automaton', 'tests'],
  cfg: ['grammar', 'regex', 'tests'],
  pda: ['grammar', 'automaton', 'regex', 'tests'],
  tm: ['automaton', 'grammar', 'regex', 'tests'],
};

const KIND_LABELS: Record<RefKind, string> = {
  automaton: 'A reference automaton',
  regex: 'A regular expression',
  grammar: 'A context-free grammar',
  tests: 'Test strings only',
  given: 'Derived from the given automaton',
};

/** Machine type of the reference automaton editor for a question type. */
const referenceMachine = (t: QuestionType): AutomatonType => (t === 'pda' ? 'PDA' : t === 'tm' ? 'TM' : 'ENFA');
const givenMachine = (t: QuestionType): AutomatonType => (t === 'dfa_minimize' ? 'DFA' : 'ENFA');

/* ---- test strings: "+ 0110" accepts, "- 01" rejects ---- */

const testsToText = (tests: TestCase[]) => tests.map((t) => `${t.accept ? '+' : '-'} ${t.input === '' ? 'ε' : t.input}`).join('\n');

function parseTests(text: string): { tests: TestCase[]; error: string | null } {
  const tests: TestCase[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const m = line.match(/^([+-])\s*(\S*)$/);
    if (!m) return { tests: [], error: `Line ${i + 1}: write "+ string" for a string that must be accepted or "- string" for one that must be rejected.` };
    const input = m[2] === 'ε' || m[2] === 'eps' ? '' : m[2]!;
    tests.push({ input, accept: m[1] === '+' });
  }
  return { tests, error: null };
}

/** Does this description let the grader decide equivalence exactly? */
function isExact(type: QuestionType, kind: RefKind, refAutomaton: Automaton): boolean {
  if (!EXACT_QUESTION_TYPES.includes(type)) return false;
  if (kind === 'regex' || kind === 'given') return true;
  return kind === 'automaton' && isFiniteAutomaton(refAutomaton.type);
}

/* ------------------------------------------------------------------ */
/* Embedded automaton field                                            */
/* ------------------------------------------------------------------ */

function AutomatonField({ label, machine, value, onChange }: { label: string; machine: AutomatonType; value: Automaton; onChange: (a: Automaton) => void }) {
  const [resetKey, setResetKey] = useState(0);
  const workspace = useWorkspace((s) => s.automaton);
  const compatible = (a: Automaton) => (machine === 'PDA' || machine === 'TM' ? a.type === machine : isFiniteAutomaton(a.type));
  const load = (a: Automaton) => {
    // Finite automata are re-tagged to the field's machine type; PDA/TM must match exactly.
    onChange(machine === 'PDA' || machine === 'TM' ? a : convertType(a, machine === 'DFA' ? 'DFA' : 'ENFA'));
    setResetKey((k) => k + 1);
  };
  const examples = EXAMPLES.filter((e) => compatible(e.automaton));
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="label !mb-0">
          {label} ({machine === 'ENFA' ? 'any finite automaton' : TYPE_NAMES[machine]})
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" disabled={workspace.states.length === 0 || !compatible(workspace)} title={compatible(workspace) ? 'Copy the automaton that is open in the main editor' : `The main editor holds a ${TYPE_NAMES[workspace.type]}, which does not fit here`} onClick={() => load(workspace)}>
            Copy from editor
          </Button>
          <select
            className="input !w-auto !py-1 text-xs"
            aria-label={`${label}: load an example`}
            value=""
            onChange={(e) => {
              const ex = examples.find((x) => x.id === e.target.value);
              if (ex) load(ex.automaton);
            }}
          >
            <option value="">Example…</option>
            {examples.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="h-80 overflow-hidden rounded-md border border-line bg-surface">
        <AutomatonEditor key={resetKey} initial={value} onChange={onChange} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Question dialog                                                     */
/* ------------------------------------------------------------------ */

export function QuestionDialog({ assignmentId, question, onClose, onSaved }: { assignmentId: string; question?: QuestionRow; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<QuestionType>(question?.type ?? 'dfa_construct');
  const [title, setTitle] = useState(question?.title ?? '');
  const [prompt, setPrompt] = useState(question?.prompt ?? '');
  const [marks, setMarks] = useState(String(question?.marks ?? 10));
  const [alphabet, setAlphabet] = useState((question?.alphabet ?? ['0', '1']).join(', '));
  const [given, setGiven] = useState<Automaton>(question?.given ?? emptyAutomaton(givenMachine(question?.type ?? 'nfa_to_dfa')));
  const [kind, setKind] = useState<RefKind>(question?.reference.kind ?? 'automaton');
  const [refAutomaton, setRefAutomaton] = useState<Automaton>(question?.reference.kind === 'automaton' ? question.reference.automaton : emptyAutomaton(referenceMachine(question?.type ?? 'dfa_construct')));
  const [refRegex, setRefRegex] = useState(question?.reference.kind === 'regex' ? question.reference.regex : '');
  const [refGrammar, setRefGrammar] = useState(question?.reference.kind === 'grammar' ? question.reference.grammar : '');
  const [refTests, setRefTests] = useState(question?.reference.kind === 'tests' ? testsToText(question.reference.tests) : '');
  const [extraTests, setExtraTests] = useState(testsToText(question?.tests ?? []));
  const [criteria, setCriteria] = useState<GradingCriteria>(question?.criteria ?? defaultCriteria());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the question type changes so embedded canvases restart with the right machine type.
  const [epoch, setEpoch] = useState(0);

  const needsGiven = type === 'nfa_to_dfa' || type === 'dfa_minimize';
  const exact = isExact(type, kind, refAutomaton);
  const parsedMarks = Number(marks);
  const marksError = marks.trim() === '' || !Number.isFinite(parsedMarks) || parsedMarks < 0 || parsedMarks > 1000 ? 'Enter a number from 0 to 1000.' : null;
  const extra = useMemo(() => parseTests(extraTests), [extraTests]);
  const refT = useMemo(() => parseTests(refTests), [refTests]);

  const changeType = (next: QuestionType) => {
    setType(next);
    setKind(REFERENCE_KINDS[next][0]!);
    setRefAutomaton(emptyAutomaton(referenceMachine(next)));
    if (next === 'nfa_to_dfa' || next === 'dfa_minimize') setGiven(emptyAutomaton(givenMachine(next)));
    setEpoch((e) => e + 1);
    setError(null);
  };

  const submit = async () => {
    let reference: Reference;
    if (kind === 'given') reference = { kind: 'given' };
    else if (kind === 'regex') reference = { kind: 'regex', regex: refRegex.trim() };
    else if (kind === 'grammar') reference = { kind: 'grammar', grammar: refGrammar };
    else if (kind === 'tests') {
      if (refT.error) return setError(refT.error);
      if (refT.tests.length === 0) return setError('Add at least one test string.');
      reference = { kind: 'tests', tests: refT.tests };
    } else reference = { kind: 'automaton', automaton: refAutomaton };
    if (extra.error) return setError(extra.error);
    if (kind === 'regex' && !refRegex.trim()) return setError('Enter the reference regular expression.');
    if (kind === 'grammar' && !refGrammar.trim()) return setError('Enter the reference grammar.');

    const body: QuestionInput = {
      type,
      title: title.trim(),
      prompt,
      marks: parsedMarks,
      alphabet: [...new Set(alphabet.split(/[\s,]+/).filter(Boolean))],
      given: needsGiven ? given : null,
      reference,
      tests: extra.tests,
      criteria,
    };
    setBusy(true);
    setError(null);
    try {
      if (question) await api.patch(`/questions/${question.id}`, body);
      else await api.post(`/assignments/${assignmentId}/questions`, body);
      toast('success', question ? 'Question updated.' : 'Question added.');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={question ? 'Edit question' : 'New question'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || !!marksError} onClick={submit}>
            {question ? 'Save question' : 'Add question'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Notice tone="error">{error}</Notice>}

        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Question type">
            <select className="input" value={type} onChange={(e) => changeType(questionTypeSchema.parse(e.target.value))}>
              {questionTypeSchema.options.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Marks" error={marksError}>
            <input className="input" inputMode="decimal" value={marks} onChange={(e) => setMarks(e.target.value)} />
          </Field>
        </div>

        <Field label="Title">
          <input className="input" value={title} maxLength={200} placeholder="Binary strings divisible by 3" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Problem statement">
          <textarea className="input h-24 resize-y" value={prompt} maxLength={4000} placeholder="Construct a DFA over {0, 1} that accepts…" onChange={(e) => setPrompt(e.target.value)} />
        </Field>
        <Field label="Input alphabet" hint="Symbols separated by commas. Strings over this alphabet are used for comparison and partial credit.">
          <input className="input font-mono" value={alphabet} placeholder="0, 1" onChange={(e) => setAlphabet(e.target.value)} />
        </Field>

        {needsGiven && <AutomatonField key={`given${epoch}`} label="Given automaton shown to students" machine={givenMachine(type)} value={given} onChange={setGiven} />}

        <section className="rounded-lg border border-line p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Expected answer</h3>
            <MethodBadge exact={exact} />
          </div>
          {needsGiven ? (
            <p className="text-sm text-muted">
              The expected language is the language of the given automaton. {type === 'dfa_minimize' ? 'Full marks also require the submitted DFA to be minimal.' : 'The submission must be deterministic and equivalent to it.'}
            </p>
          ) : (
            <div className="space-y-3">
              <Field label="Describe the expected language with">
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value as RefKind)}>
                  {REFERENCE_KINDS[type].map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              {kind === 'regex' && (
                <Field label="Reference regular expression" hint={REGEX_HELP}>
                  <input className="input font-mono" value={refRegex} spellCheck={false} placeholder="(0|1)*01" onChange={(e) => setRefRegex(e.target.value)} />
                </Field>
              )}
              {kind === 'grammar' && (
                <Field label="Reference grammar" hint={GRAMMAR_HELP}>
                  <textarea className="input h-28 resize-y font-mono text-sm" value={refGrammar} spellCheck={false} placeholder="S -> aSb | ε" onChange={(e) => setRefGrammar(e.target.value)} />
                </Field>
              )}
              {kind === 'tests' && (
                <Field label="Test strings" error={refT.error} hint={'One per line: "+ 0110" must be accepted, "- 01" must be rejected, "+ ε" is the empty string.'}>
                  <textarea className="input h-28 resize-y font-mono text-sm" value={refTests} spellCheck={false} placeholder={'+ 110\n- 101\n+ ε'} onChange={(e) => setRefTests(e.target.value)} />
                </Field>
              )}
              {kind === 'automaton' && <AutomatonField key={`ref${epoch}`} label="Reference automaton" machine={referenceMachine(type)} value={refAutomaton} onChange={setRefAutomaton} />}
            </div>
          )}
          <div className="mt-3">
            {exact ? (
              <Notice tone="success">Graded exactly: the submission is compared with the reference by language equivalence, and students get a shortest counterexample when it differs.</Notice>
            ) : (
              <Notice>
                Graded by bounded testing: {EXACT_QUESTION_TYPES.includes(type) ? 'test strings alone cannot prove equivalence' : 'equivalence is undecidable for this kind of machine or grammar'}. Submissions are checked on every string up to the length bound
                below plus your test strings, labelled as such, and flagged for your review.
              </Notice>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-line p-4">
          <h3 className="mb-3 text-sm font-semibold">Grading criteria</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={criteria.partialCredit} onChange={(e) => setCriteria({ ...criteria, partialCredit: e.target.checked })} />
              <span>
                Partial credit for wrong answers
                <span className="block text-xs text-muted">Based on how many strings are classified correctly; trivial answers earn nothing.</span>
              </span>
            </label>
            <Field label="Partial credit cap (%)" hint="The most a wrong answer can earn.">
              <input className="input" type="number" min={0} max={100} disabled={!criteria.partialCredit} value={criteria.partialCap} onChange={(e) => setCriteria({ ...criteria, partialCap: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
            </Field>
            {type === 'dfa_minimize' && (
              <Field label="Minimality weight (%)" hint="Deducted when the DFA is equivalent but not minimal.">
                <input className="input" type="number" min={0} max={100} value={criteria.minimalityWeight} onChange={(e) => setCriteria({ ...criteria, minimalityWeight: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
              </Field>
            )}
            {(type === 'dfa_construct' || type === 'nfa_to_dfa' || type === 'dfa_minimize') && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={criteria.requireComplete} onChange={(e) => setCriteria({ ...criteria, requireComplete: e.target.checked })} />
                <span>
                  Require a total transition function
                  <span className="block text-xs text-muted">Otherwise missing transitions count as an implicit dead state.</span>
                </span>
              </label>
            )}
            <Field label="Length bound" hint={exact ? 'Used only for the partial-credit statistics.' : 'All strings up to this length are tested (fewer if there would be too many).'}>
              <input className="input" type="number" min={1} max={12} value={criteria.boundedLength} onChange={(e) => setCriteria({ ...criteria, boundedLength: Math.min(12, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} />
            </Field>
          </div>
          {kind !== 'tests' && (
            <div className="mt-4">
              <Field label="Additional test strings (optional)" error={extra.error} hint={'Same format: "+ string" / "- string". Failing ones are quoted in the feedback.'}>
                <textarea className="input h-20 resize-y font-mono text-sm" value={extraTests} spellCheck={false} onChange={(e) => setExtraTests(e.target.value)} />
              </Field>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Try-it dialog                                                       */
/* ------------------------------------------------------------------ */

/** Lets the teacher answer their own question and see exactly what a student would get back. */
export function TryQuestionDialog({ question, onClose }: { question: QuestionRow; onClose: () => void }) {
  const [answer, setAnswer] = useState<Answer>(() => emptyAnswer(question.type));
  const [result, setResult] = useState<GradeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = answerProblem(answer);
  const run = async () => {
    setBusy(true);
    try {
      setResult((await api.post<{ result: GradeResult }>(`/questions/${question.id}/test`, { answer })).result);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal wide title={`Try it: ${question.title}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <Notice>This is a dry run: nothing is stored and no student sees it.</Notice>
        <AnswerEditor type={question.type} value={answer} onChange={setAnswer} resetKey={question.id} allowSimulation={false} />
        <div className="flex items-center gap-3">
          <Button variant="primary" loading={busy} disabled={!!blocked} onClick={run}>
            Grade this answer
          </Button>
          {blocked && <span className="text-sm text-muted">{blocked}</span>}
        </div>
        {result && <GradeFeedback result={result} />}
      </div>
    </Modal>
  );
}
