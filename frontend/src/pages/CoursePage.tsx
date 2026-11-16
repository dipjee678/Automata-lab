import { ArrowLeft, Copy, Pencil, Plus, Trash2, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QUESTION_TYPE_LABELS, type Assignment, type Course, type Profile, type QuestionType } from '@automata/shared';
import { Badge, Button, Card, EmptyState, ErrorState, Field, formatDate, Modal, Notice, PageHeader, Spinner, StatCard, Tabs, useFetch } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { toast, useAuth } from '../lib/stores';
import { CourseDialog } from './CoursesPage';

type AssignmentRow = Assignment & { question_count: number; total_marks: number; my_score?: number; my_answered?: number };

interface CourseData {
  course: Course & { teacher_name: string };
  manages: boolean;
  assignments: AssignmentRow[];
  students: Array<Profile & { enrolled_at: string }>;
}

export function CoursePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const { data, error, loading, reload } = useFetch<CourseData>(`/courses/${id}`);
  const [tab, setTab] = useState<'assignments' | 'students' | 'analytics'>('assignments');
  const [editing, setEditing] = useState(false);
  const [newAssignment, setNewAssignment] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Course not found.'} onRetry={reload} />;
  const { course, manages, assignments, students } = data;

  const remove = async () => {
    if (!window.confirm(`Delete the course "${course.title}" with all its assignments, submissions and grades? This cannot be undone.`)) return;
    try {
      await api.delete(`/courses/${course.id}`);
      toast('success', 'Course deleted.');
      navigate('/courses');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const leave = async () => {
    if (!window.confirm(`Leave "${course.title}"? You will lose access to its assignments.`)) return;
    try {
      await api.delete(`/courses/${course.id}/enrollments/${user.id}`);
      toast('success', 'You left the course.');
      navigate('/courses');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <>
      <Link to="/courses" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> All courses
      </Link>
      <PageHeader
        title={
          <>
            <span className="mr-2 text-accent">{course.code}</span>
            {course.title}
          </>
        }
        subtitle={
          <>
            {course.description && <span className="block">{course.description}</span>}
            <span className="block">Teacher: {course.teacher_name}</span>
          </>
        }
        actions={
          manages ? (
            <>
              <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button icon={<Trash2 className="h-3.5 w-3.5" />} onClick={remove}>
                Delete
              </Button>
            </>
          ) : (
            <Button onClick={leave}>Leave course</Button>
          )
        }
      />

      {manages && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'assignments', label: `Assignments (${assignments.length})` },
            { id: 'students', label: `Students (${students.length})` },
            { id: 'analytics', label: 'Analytics' },
          ]}
        />
      )}

      {tab === 'assignments' && (
        <>
          {manages && (
            <div className="mb-3 flex justify-end">
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewAssignment(true)}>
                New assignment
              </Button>
            </div>
          )}
          {assignments.length === 0 ? (
            <EmptyState title="No assignments yet">{manages ? 'Create an assignment, add questions with reference solutions, then publish it.' : 'Your teacher has not published any assignment yet.'}</EmptyState>
          ) : (
            <div className="space-y-2">
              {assignments.map((a) => {
                const overdue = !!a.due_at && new Date(a.due_at) < new Date();
                return (
                  <Link key={a.id} to={`/assignments/${a.id}`} className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors hover:border-accent">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold">{a.title}</h2>
                        {manages && <Badge tone={a.published ? 'green' : 'neutral'}>{a.published ? 'Published' : 'Draft'}</Badge>}
                        {overdue && <Badge tone="amber">Past due</Badge>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>
                          {a.question_count} question{a.question_count === 1 ? '' : 's'} · {a.total_marks} marks
                        </span>
                        <span>{a.due_at ? `Due ${formatDate(a.due_at)}` : 'No deadline'}</span>
                        {a.max_attempts && <span>max {a.max_attempts} attempts per question</span>}
                      </div>
                    </div>
                    {!manages && (
                      <div className="text-right text-sm">
                        <div className="font-semibold tabular-nums">
                          {a.my_score ?? 0} / {a.total_marks}
                        </div>
                        <div className="text-xs text-muted">
                          {a.my_answered ?? 0} of {a.question_count} answered
                        </div>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}

      {manages && tab === 'students' && <StudentsTab course={course} students={students} onChange={reload} />}
      {manages && tab === 'analytics' && <AnalyticsTab courseId={course.id} />}

      {editing && (
        <CourseDialog
          course={course}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {newAssignment && (
        <AssignmentDialog
          courseId={course.id}
          onClose={() => setNewAssignment(false)}
          onSaved={(a) => {
            setNewAssignment(false);
            navigate(`/assignments/${a.id}`);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Students                                                            */
/* ------------------------------------------------------------------ */

function StudentsTab({ course, students, onChange }: { course: Course; students: Array<Profile & { enrolled_at: string }>; onChange: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enrol = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ student: Profile }>(`/courses/${course.id}/enrollments`, { email: email.trim() });
      toast('success', `${res.student.full_name} is now enrolled.`);
      setEmail('');
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Profile) => {
    if (!window.confirm(`Remove ${s.full_name} from this course? Their submissions are kept.`)) return;
    try {
      await api.delete(`/courses/${course.id}/enrollments/${s.id}`);
      onChange();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(course.join_code);
      toast('success', 'Join code copied.');
    } catch {
      toast('info', `Join code: ${course.join_code}`);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card title={`Enrolled students (${students.length})`} pad={false}>
        {students.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No students yet">Share the join code, or enrol students by email.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Enrolled</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.full_name}</td>
                    <td className="text-muted">{s.email}</td>
                    <td className="whitespace-nowrap text-muted">{formatDate(s.enrolled_at, false)}</td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" icon={<UserMinus className="h-3.5 w-3.5" />} onClick={() => remove(s)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="space-y-4">
        <Card title="Join code">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-raised px-3 py-2 text-center font-mono text-lg font-semibold tracking-widest" data-testid="join-code">
              {course.join_code}
            </code>
            <Button icon={<Copy className="h-3.5 w-3.5" />} onClick={copy}>
              Copy
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">Students enter this code under Courses → Join a course.</p>
        </Card>
        <Card title="Enrol by email">
          <Field label="Student email" error={error}>
            <input className="input" type="email" value={email} placeholder="student@university.edu" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email.trim() && enrol()} />
          </Field>
          <Button className="mt-3" variant="primary" loading={busy} disabled={!email.trim()} onClick={enrol}>
            Enrol student
          </Button>
          <p className="mt-2 text-xs text-muted">The student must already have an account.</p>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

interface Analytics {
  students: number;
  questions: number;
  total_marks: number;
  class_average: number | null;
  perAssignment: Array<{ assignment_id: string; title: string; due_at: string | null; total_marks: number; submitted: number; average_percent: number | null }>;
  perQuestion: Array<{ question_id: string; assignment_id: string; title: string; type: QuestionType; marks: number; attempted: number; attempts: number; correct: number; average_percent: number | null; needs_review: number }>;
  perStudent: Array<{ student_id: string; full_name: string; email: string; answered: number; score: number; percent: number }>;
  distribution: number[];
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
        <div className={`h-full rounded-full ${value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${value}%` }} />
      </div>
      <span className="tabular-nums">{value}%</span>
    </div>
  );
}

function AnalyticsTab({ courseId }: { courseId: string }) {
  const { data, error, loading, reload } = useFetch<Analytics>(`/courses/${courseId}/analytics`);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load analytics.'} onRetry={reload} />;
  if (data.questions === 0) return <EmptyState title="Nothing to analyse yet">Analytics cover published assignments. Publish an assignment with at least one question.</EmptyState>;

  const max = Math.max(1, ...data.distribution);
  const labels = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];
  const hardest = [...data.perQuestion].filter((q) => q.average_percent !== null).sort((a, b) => a.average_percent! - b.average_percent!)[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Class average" value={pct(data.class_average)} hint="of all available marks" />
        <StatCard label="Students" value={data.students} />
        <StatCard label="Published questions" value={data.questions} hint={`${data.total_marks} marks in total`} />
        <StatCard label="Hardest question" value={hardest ? pct(hardest.average_percent) : '—'} hint={hardest?.title ?? 'no attempts yet'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Card title="Score distribution">
          <div className="flex h-40 items-end gap-2" role="img" aria-label={`Score distribution: ${data.distribution.map((n, i) => `${labels[i]}: ${n}`).join(', ')}`}>
            {data.distribution.map((n, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-xs tabular-nums text-muted">{n}</span>
                <div className="w-full rounded-t bg-accent/80" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 4 : 1 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-2 text-center text-[10px] text-muted">
            {labels.map((l) => (
              <span key={l} className="flex-1">
                {l}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Students by overall score (unanswered questions count as zero).</p>
        </Card>

        <Card title="Assignments" pad={false}>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Started by</th>
                  <th>Average (of those who started)</th>
                </tr>
              </thead>
              <tbody>
                {data.perAssignment.map((a) => (
                  <tr key={a.assignment_id}>
                    <td>
                      <Link to={`/assignments/${a.assignment_id}`} className="font-medium hover:text-accent hover:underline">
                        {a.title}
                      </Link>
                    </td>
                    <td className="tabular-nums">
                      {a.submitted} / {data.students}
                    </td>
                    <td>
                      <Meter value={a.average_percent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="Questions" pad={false}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Question</th>
                <th>Type</th>
                <th>Attempted</th>
                <th>Fully correct</th>
                <th>Attempts</th>
                <th>Average</th>
                <th>To review</th>
              </tr>
            </thead>
            <tbody>
              {data.perQuestion.map((q) => (
                <tr key={q.question_id}>
                  <td className="font-medium">{q.title}</td>
                  <td className="whitespace-nowrap text-muted">{QUESTION_TYPE_LABELS[q.type]}</td>
                  <td className="tabular-nums">
                    {q.attempted} / {data.students}
                  </td>
                  <td className="tabular-nums">{q.correct}</td>
                  <td className="tabular-nums">{q.attempts}</td>
                  <td>
                    <Meter value={q.average_percent} />
                  </td>
                  <td>{q.needs_review > 0 ? <Badge tone="blue">{q.needs_review}</Badge> : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Students" pad={false}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Student</th>
                <th>Answered</th>
                <th>Score</th>
                <th>Overall</th>
              </tr>
            </thead>
            <tbody>
              {data.perStudent.map((s) => (
                <tr key={s.student_id}>
                  <td>
                    <div className="font-medium">{s.full_name}</div>
                    <div className="text-xs text-muted">{s.email}</div>
                  </td>
                  <td className="tabular-nums">
                    {s.answered} / {data.questions}
                  </td>
                  <td className="tabular-nums">
                    {s.score} / {data.total_marks}
                  </td>
                  <td>
                    <Meter value={s.percent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment dialog (create / edit)                                   */
/* ------------------------------------------------------------------ */

/** datetime-local value <-> ISO string, in the user's own time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function AssignmentDialog({ courseId, assignment, onClose, onSaved }: { courseId?: string; assignment?: Assignment; onClose: () => void; onSaved: (a: Assignment) => void }) {
  const [form, setForm] = useState({
    title: assignment?.title ?? '',
    description: assignment?.description ?? '',
    due: toLocalInput(assignment?.due_at ?? null),
    max_attempts: assignment?.max_attempts ? String(assignment.max_attempts) : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempts = form.max_attempts.trim() === '' ? null : Number(form.max_attempts);
  const attemptsError = attempts !== null && (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) ? 'Enter a whole number from 1 to 100, or leave empty for unlimited.' : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = { title: form.title.trim(), description: form.description, due_at: form.due ? new Date(form.due).toISOString() : null, max_attempts: attempts };
    try {
      const res = assignment
        ? await api.patch<{ assignment: Assignment }>(`/assignments/${assignment.id}`, body)
        : await api.post<{ assignment: Assignment }>(`/courses/${courseId}/assignments`, body);
      toast('success', assignment ? 'Assignment updated.' : 'Assignment created as a draft.');
      onSaved(res.assignment);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={assignment ? 'Edit assignment' : 'New assignment'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!form.title.trim() || !!attemptsError} onClick={submit}>
            {assignment ? 'Save changes' : 'Create draft'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Title">
          <input className="input" value={form.title} maxLength={200} placeholder="Homework 1: Regular languages" onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Instructions">
          <textarea className="input h-24 resize-y" value={form.description} maxLength={4000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deadline" hint="Optional. Late submissions are accepted and flagged.">
            <input className="input" type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
          </Field>
          <Field label="Attempts per question" error={attemptsError} hint="Empty = unlimited. The best attempt counts.">
            <input className="input" inputMode="numeric" value={form.max_attempts} placeholder="unlimited" onChange={(e) => setForm({ ...form, max_attempts: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
