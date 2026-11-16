import { ArrowLeft, CheckCircle2, Circle, CircleDashed, Eye, EyeOff, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  EXACT_QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type Answer,
  type Assignment,
  type Grade,
  type Profile,
  type PublicQuestion,
  type QuestionRow,
  type Submission,
} from '@automata/shared';
import { AnswerEditor, answerProblem, AnswerView, AutomatonPreview, emptyAnswer, GradeFeedback } from '../components/answers';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, formatDate, MethodBadge, Modal, Notice, PageHeader, Spinner, Tabs, useFetch, VerdictBadge } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { toast } from '../lib/stores';
import { AssignmentDialog } from './CoursePage';
import { QuestionDialog, TryQuestionDialog } from './QuestionDialog';

interface Progress {
  question_id: string;
  attempts: number;
  best: Grade | null;
}
type AssignmentData =
  | { manages: true; assignment: Assignment; course: { id: string; title: string; code: string }; questions: QuestionRow[] }
  | { manages: false; assignment: Assignment; course: { id: string; title: string; code: string }; questions: PublicQuestion[]; progress: Progress[] };

type Attempt = Submission & { grade: Grade | null };

/** Adapt a stored grade row to the shape the feedback card expects. */
const asResult = (g: Grade) => ({ score: g.final_score, maxScore: g.max_score, verdict: g.verdict, exact: g.exact, method: g.method, feedback: g.feedback, counterexample: g.counterexample });

export function AssignmentPage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useFetch<AssignmentData>(`/assignments/${id}`);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Assignment not found.'} onRetry={reload} />;

  const { assignment, course } = data;
  const total = data.questions.reduce((s, q) => s + q.marks, 0);
  return (
    <>
      <Link to={`/courses/${course.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {course.code} · {course.title}
      </Link>
      {data.manages ? <TeacherView data={data} total={total} reload={reload} /> : <StudentView key={assignment.id} data={data} total={total} reload={reload} />}
    </>
  );
}

const Meta = ({ assignment, total, count }: { assignment: Assignment; total: number; count: number }) => (
  <span className="flex flex-wrap gap-x-4 gap-y-1">
    <span>
      {count} question{count === 1 ? '' : 's'} · {total} marks
    </span>
    <span>{assignment.due_at ? `Due ${formatDate(assignment.due_at)}` : 'No deadline'}</span>
    <span>{assignment.max_attempts ? `${assignment.max_attempts} attempt${assignment.max_attempts === 1 ? '' : 's'} per question` : 'Unlimited attempts'} · best attempt counts</span>
  </span>
);

/* ================================================================== */
/* Student                                                             */
/* ================================================================== */

function StudentView({ data, total, reload }: { data: Extract<AssignmentData, { manages: false }>; total: number; reload: () => void }) {
  const { assignment, questions, progress } = data;
  const [selected, setSelected] = useState<string | null>(questions[0]?.id ?? null);
  const earned = progress.reduce((s, p) => s + (p.best?.final_score ?? 0), 0);
  const question = questions.find((q) => q.id === selected) ?? null;
  const overdue = !!assignment.due_at && new Date(assignment.due_at) < new Date();

  return (
    <>
      <PageHeader
        title={assignment.title}
        subtitle={<Meta assignment={assignment} total={total} count={questions.length} />}
        actions={
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted">Your score</div>
            <div className="text-xl font-semibold tabular-nums" data-testid="assignment-score">
              {earned} / {total}
            </div>
          </div>
        }
      />
      {assignment.description && <p className="mb-4 whitespace-pre-wrap text-sm text-muted">{assignment.description}</p>}
      {overdue && (
        <div className="mb-4">
          <Notice tone="warn">The deadline has passed. You can still submit, but new submissions are marked as late.</Notice>
        </div>
      )}

      {questions.length === 0 ? (
        <EmptyState title="This assignment has no questions yet" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Questions" className="flex gap-2 overflow-x-auto lg:block lg:space-y-1.5 lg:overflow-visible">
            {questions.map((q, i) => {
              const p = progress.find((x) => x.question_id === q.id);
              const done = p?.best && p.best.final_score >= q.marks;
              return (
                <button
                  key={q.id}
                  type="button"
                  aria-current={selected === q.id}
                  onClick={() => setSelected(q.id)}
                  className={cx('card flex w-56 shrink-0 items-start gap-2 p-3 text-left transition-colors lg:w-full', selected === q.id ? 'border-accent bg-accent/5' : 'hover:border-accent/60')}
                >
                  {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : p?.attempts ? <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted/50" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {i + 1}. {q.title}
                    </span>
                    <span className="block text-xs tabular-nums text-muted">
                      {p?.best ? `${p.best.final_score} / ${q.marks}` : `${q.marks} marks`}
                      {p?.attempts ? ` · ${p.attempts} attempt${p.attempts === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
          {question && <StudentQuestion key={question.id} question={question} assignment={assignment} onGraded={reload} />}
        </div>
      )}
    </>
  );
}

function StudentQuestion({ question, assignment, onGraded }: { question: PublicQuestion; assignment: Assignment; onGraded: () => void }) {
  const attempts = useFetch<{ attempts: Attempt[] }>(`/questions/${question.id}/submissions/mine`);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [shown, setShown] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Start from the most recent attempt (or a blank answer) once the history has loaded.
  useEffect(() => {
    if (answer !== null || !attempts.data) return;
    const latest = attempts.data.attempts[0];
    setAnswer(latest?.answer ?? emptyAnswer(question.type));
    setShown(latest ?? null);
  }, [attempts.data, answer, question.type]);

  if (attempts.error) return <ErrorState message={attempts.error} onRetry={attempts.reload} />;
  if (!answer || !attempts.data) return <Spinner />;

  const used = attempts.data.attempts.length;
  const left = assignment.max_attempts === null ? null : Math.max(0, assignment.max_attempts - used);
  const blocked = left === 0 ? 'You have used all attempts for this question.' : answerProblem(answer);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ submission: Submission; grade: Grade }>(`/questions/${question.id}/submissions`, { answer });
      setShown({ ...res.submission, grade: res.grade });
      attempts.reload();
      onGraded();
      if (res.grade.verdict === 'correct') toast('success', 'Correct!');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <Card
        title={question.title}
        actions={
          <span className="flex items-center gap-1.5">
            <Badge>{QUESTION_TYPE_LABELS[question.type]}</Badge>
            <MethodBadge exact={EXACT_QUESTION_TYPES.includes(question.type)} />
            <Badge tone="violet">{question.marks} marks</Badge>
          </span>
        }
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{question.prompt || 'No further instructions.'}</p>
        {question.alphabet.length > 0 && <p className="mt-2 font-mono text-xs text-muted">Σ = {`{${question.alphabet.join(', ')}}`}</p>}
        {question.given && (
          <div className="mt-3">
            <div className="label">Given automaton</div>
            <AutomatonPreview automaton={question.given} name={`${question.title} (given)`} height="h-64" />
          </div>
        )}
      </Card>

      <Card title="Your answer">
        <AnswerEditor type={question.type} value={answer} onChange={setAnswer} resetKey={resetKey} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={busy} disabled={!!blocked} onClick={submit}>
            Submit answer
          </Button>
          <span className="text-sm text-muted">{blocked ?? (left === null ? 'Graded instantly. You can submit again; your best attempt counts.' : `${left} attempt${left === 1 ? '' : 's'} left. Your best attempt counts.`)}</span>
        </div>
      </Card>

      {shown?.grade && (
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>
              Result of attempt {shown.attempt} · {formatDate(shown.created_at)}
            </span>
            {shown.late && <Badge tone="amber">late</Badge>}
            {shown.grade.adjusted_by && <Badge tone="blue">adjusted by your teacher (auto: {shown.grade.auto_score})</Badge>}
          </div>
          <GradeFeedback result={asResult(shown.grade)} note={shown.grade.adjust_note} />
        </div>
      )}

      {used > 0 && (
        <Card
          title={`Previous attempts (${used})`}
          actions={
            <Button size="sm" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory((s) => !s)}>
              {showHistory ? 'Hide' : 'Show'}
            </Button>
          }
          pad={showHistory}
        >
          {showHistory && (
            <ul className="divide-y divide-line">
              {attempts.data.attempts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="font-medium">Attempt {a.attempt}</span>
                  {a.grade && <VerdictBadge verdict={a.grade.verdict} />}
                  {a.late && <Badge tone="amber">late</Badge>}
                  <span className="tabular-nums text-muted">{a.grade ? `${a.grade.final_score} / ${a.grade.max_score}` : 'not graded'}</span>
                  <span className="text-xs text-muted">{formatDate(a.created_at)}</span>
                  <span className="ml-auto flex gap-1.5">
                    <Button size="sm" onClick={() => setShown(a)}>
                      View feedback
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setAnswer(a.answer);
                        setResetKey((k) => k + 1);
                        toast('info', `Attempt ${a.attempt} loaded into the answer editor.`);
                      }}
                    >
                      Load answer
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

/* ================================================================== */
/* Teacher                                                             */
/* ================================================================== */

function TeacherView({ data, total, reload }: { data: Extract<AssignmentData, { manages: true }>; total: number; reload: () => void }) {
  const { assignment, questions, course } = data;
  const navigate = useNavigate();
  const [tab, setTab] = useState<'questions' | 'submissions'>('questions');
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<{ question?: QuestionRow } | null>(null);
  const [trying, setTrying] = useState<QuestionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const setPublished = async (published: boolean) => {
    setBusy(true);
    try {
      await api.patch(`/assignments/${assignment.id}`, { published });
      toast('success', published ? 'Published. Enrolled students can now see and answer it.' : 'Unpublished. Students can no longer see it.');
      reload();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeAssignment = async () => {
    if (!window.confirm(`Delete "${assignment.title}" with all its questions, submissions and grades? This cannot be undone.`)) return;
    try {
      await api.delete(`/assignments/${assignment.id}`);
      toast('success', 'Assignment deleted.');
      navigate(`/courses/${course.id}`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const removeQuestion = async (q: QuestionRow) => {
    if (!window.confirm(`Delete the question "${q.title}" and every submission to it? This cannot be undone.`)) return;
    try {
      await api.delete(`/questions/${q.id}`);
      reload();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {assignment.title} <Badge tone={assignment.published ? 'green' : 'neutral'}>{assignment.published ? 'Published' : 'Draft'}</Badge>
          </span>
        }
        subtitle={<Meta assignment={assignment} total={total} count={questions.length} />}
        actions={
          <>
            <Button
              variant={assignment.published ? 'secondary' : 'primary'}
              loading={busy}
              disabled={!assignment.published && questions.length === 0}
              title={!assignment.published && questions.length === 0 ? 'Add a question before publishing' : undefined}
              icon={assignment.published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              onClick={() => setPublished(!assignment.published)}
            >
              {assignment.published ? 'Unpublish' : 'Publish'}
            </Button>
            <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button icon={<Trash2 className="h-3.5 w-3.5" />} onClick={removeAssignment}>
              Delete
            </Button>
          </>
        }
      />
      {assignment.description && <p className="mb-4 whitespace-pre-wrap text-sm text-muted">{assignment.description}</p>}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'questions', label: `Questions (${questions.length})` },
          { id: 'submissions', label: 'Submissions and grades' },
        ]}
      />

      {tab === 'questions' && (
        <>
          <div className="mb-3 flex justify-end">
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({})}>
              Add question
            </Button>
          </div>
          {questions.length === 0 ? (
            <EmptyState title="No questions yet">Add a question with its expected answer. Regular-language questions are graded exactly; grammar, PDA and Turing-machine questions by bounded testing.</EmptyState>
          ) : (
            <div className="space-y-2">
              {questions.map((q, i) => {
                const exact = EXACT_QUESTION_TYPES.includes(q.type) && (q.reference.kind === 'regex' || q.reference.kind === 'given' || (q.reference.kind === 'automaton' && ['DFA', 'NFA', 'ENFA'].includes(q.reference.automaton.type)));
                return (
                  <div key={q.id} className="card flex flex-wrap items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold">
                          {i + 1}. {q.title}
                        </h2>
                        <Badge>{QUESTION_TYPE_LABELS[q.type]}</Badge>
                        <MethodBadge exact={exact} />
                        <Badge tone="violet">{q.marks} marks</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{q.prompt || 'No problem statement.'}</p>
                      <p className="mt-1 text-xs text-muted">
                        Expected answer:{' '}
                        {q.reference.kind === 'regex' ? (
                          <code className="font-mono">{q.reference.regex}</code>
                        ) : q.reference.kind === 'grammar' ? (
                          <code className="font-mono">{q.reference.grammar.split('\n').join(' ; ')}</code>
                        ) : q.reference.kind === 'tests' ? (
                          `${q.reference.tests.length} test string(s)`
                        ) : q.reference.kind === 'given' ? (
                          'language of the given automaton'
                        ) : (
                          `reference automaton (${q.reference.automaton.states.length} states)`
                        )}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setTrying(q)}>
                        Try it
                      </Button>
                      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setDialog({ question: q })}>
                        Edit
                      </Button>
                      <Button size="sm" aria-label={`Delete question ${q.title}`} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeQuestion(q)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'submissions' && <SubmissionsTab assignmentId={assignment.id} />}

      {editing && (
        <AssignmentDialog
          assignment={assignment}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {dialog && (
        <QuestionDialog
          assignmentId={assignment.id}
          question={dialog.question}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {trying && <TryQuestionDialog question={trying} onClose={() => setTrying(null)} />}
    </>
  );
}

/* ---------------------- submissions matrix ---------------------- */

interface SubmissionsData {
  assignment: Assignment;
  questions: QuestionRow[];
  students: Profile[];
  submissions: Attempt[];
}

/** The attempt that counts: highest final score, most recent on ties. */
function bestOf(attempts: Attempt[]): Attempt | null {
  let best: Attempt | null = null;
  for (const a of attempts) {
    if (!a.grade) continue;
    if (!best?.grade || a.grade.final_score > best.grade.final_score || (a.grade.final_score === best.grade.final_score && a.created_at > best.created_at)) best = a;
  }
  return best;
}

function SubmissionsTab({ assignmentId }: { assignmentId: string }) {
  const { data, error, loading, reload } = useFetch<SubmissionsData>(`/assignments/${assignmentId}/submissions`);
  const [review, setReview] = useState<{ student: Profile; question: QuestionRow } | null>(null);
  const [onlyReview, setOnlyReview] = useState(false);

  const byCell = useMemo(() => {
    const map = new Map<string, Attempt[]>();
    for (const s of data?.submissions ?? []) {
      const key = `${s.student_id}|${s.question_id}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(s);
    }
    return map;
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load submissions.'} onRetry={reload} />;
  if (data.questions.length === 0) return <EmptyState title="No questions yet" />;
  if (data.students.length === 0) return <EmptyState title="No students are enrolled yet">Submissions appear here once students answer.</EmptyState>;

  const total = data.questions.reduce((s, q) => s + q.marks, 0);
  const needsReview = (a: Attempt | null) => !!a?.grade && !a.grade.exact && !a.grade.adjusted_by;
  const pending = [...byCell.values()].filter((list) => needsReview(bestOf(list))).length;
  const rows = data.students.filter((s) => !onlyReview || data.questions.some((q) => needsReview(bestOf(byCell.get(`${s.id}|${q.id}`) ?? []))));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {data.submissions.length} submission{data.submissions.length === 1 ? '' : 's'} from {new Set(data.submissions.map((s) => s.student_id)).size} of {data.students.length} student(s). Click a cell to see the answer, the feedback and to adjust the grade.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
          Only students with answers to review <Badge tone="blue">{pending}</Badge>
        </label>
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Student</th>
                {data.questions.map((q, i) => (
                  <th key={q.id} title={q.title} className="whitespace-nowrap">
                    Q{i + 1} <span className="font-normal normal-case">/ {q.marks}</span>
                  </th>
                ))}
                <th className="whitespace-nowrap">Total / {total}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                let sum = 0;
                return (
                  <tr key={s.id}>
                    <td>
                      <div className="font-medium">{s.full_name}</div>
                      <div className="text-xs text-muted">{s.email}</div>
                    </td>
                    {data.questions.map((q) => {
                      const list = byCell.get(`${s.id}|${q.id}`) ?? [];
                      const best = bestOf(list);
                      if (best?.grade) sum += best.grade.final_score;
                      if (!best?.grade) return <td key={q.id} className="text-muted">—</td>;
                      const g = best.grade;
                      return (
                        <td key={q.id}>
                          <button
                            type="button"
                            className={cx(
                              'rounded-md border px-2 py-1 text-left tabular-nums transition-colors hover:border-accent',
                              g.final_score >= q.marks ? 'border-emerald-400/50 bg-emerald-500/10' : g.final_score > 0 ? 'border-amber-400/50 bg-amber-500/10' : 'border-red-400/50 bg-red-500/10',
                            )}
                            onClick={() => setReview({ student: s, question: q })}
                            aria-label={`${s.full_name}, ${q.title}: ${g.final_score} of ${q.marks}`}
                          >
                            <span className="font-semibold">{g.final_score}</span>
                            <span className="ml-1 text-xs text-muted">×{list.length}</span>
                            {needsReview(best) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-500 align-middle" title="Graded by bounded testing – review recommended" />}
                            {g.adjusted_by && <span className="ml-1 text-xs text-muted" title="Adjusted manually">✎</span>}
                          </button>
                        </td>
                      );
                    })}
                    <td className="font-semibold tabular-nums">{sum}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Each cell shows the best attempt · ×n = number of attempts · <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500 align-middle" /> graded by bounded testing, review recommended · ✎ adjusted manually
        </p>
      </Card>
      {review && (
        <ReviewDialog
          student={review.student}
          question={review.question}
          attempts={[...(byCell.get(`${review.student.id}|${review.question.id}`) ?? [])].sort((a, b) => b.attempt - a.attempt)}
          onClose={() => setReview(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}

function ReviewDialog({ student, question, attempts, onClose, onChanged }: { student: Profile; question: QuestionRow; attempts: Attempt[]; onClose: () => void; onChanged: () => void }) {
  const best = bestOf(attempts);
  const [selectedId, setSelectedId] = useState(best?.id ?? attempts[0]?.id);
  const selected = attempts.find((a) => a.id === selectedId) ?? attempts[0];
  if (!selected) return null;
  return (
    <Modal wide title={`${student.full_name} — ${question.title}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Attempts">
          {attempts.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={a.id === selected.id}
              onClick={() => setSelectedId(a.id)}
              className={cx('rounded-md border px-2.5 py-1 text-sm', a.id === selected.id ? 'border-accent bg-accent/10 text-accent' : 'border-line hover:bg-raised')}
            >
              Attempt {a.attempt}
              {a.grade && <span className="ml-1.5 tabular-nums text-muted">{a.grade.final_score}/{a.grade.max_score}</span>}
              {a.id === best?.id && <span className="ml-1.5 text-xs">(counts)</span>}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          Submitted {formatDate(selected.created_at)} {selected.late && <Badge tone="amber">late</Badge>}
        </p>
        <div>
          <div className="label">Submitted answer</div>
          <AnswerView answer={selected.answer} />
        </div>
        {selected.grade ? (
          <>
            <GradeFeedback result={asResult(selected.grade)} note={selected.grade.adjust_note} />
            <AdjustForm key={selected.grade.id + selected.grade.updated_at} grade={selected.grade} onSaved={onChanged} />
          </>
        ) : (
          <Notice tone="warn">This submission has no grade.</Notice>
        )}
      </div>
    </Modal>
  );
}

function AdjustForm({ grade, onSaved }: { grade: Grade; onSaved: () => void }) {
  const [score, setScore] = useState(String(grade.final_score));
  const [note, setNote] = useState(grade.adjust_note ?? '');
  const [busy, setBusy] = useState(false);
  const value = Number(score);
  const invalid = score.trim() === '' || !Number.isFinite(value) || value < 0 || value > grade.max_score;
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/grades/${grade.id}`, { final_score: value, note });
      toast('success', 'Grade updated.');
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-lg border border-line p-4">
      <h3 className="text-sm font-semibold">Adjust grade</h3>
      <p className="mt-0.5 text-xs text-muted">
        Automatic score: {grade.auto_score} / {grade.max_score}
        {grade.adjusted_by ? ` · currently adjusted to ${grade.final_score}` : ''}. The student sees the final score and your note.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <Field label={`Final score (max ${grade.max_score})`} error={invalid ? `0 to ${grade.max_score}` : null}>
          <input className="input" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} />
        </Field>
        <Field label="Note to the student">
          <input className="input" value={note} maxLength={1000} placeholder="Optional explanation" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button variant="primary" loading={busy} disabled={invalid} onClick={save}>
          Save grade
        </Button>
      </div>
    </section>
  );
}
