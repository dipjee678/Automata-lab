import { Plus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Course } from '@automata/shared';
import { Button, Card, EmptyState, ErrorState, Field, Modal, Notice, PageHeader, Spinner, useFetch } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { toast, useAuth } from '../lib/stores';

type CourseRow = Course & { teacher_name: string; student_count: number; assignment_count: number };

export function CoursesPage() {
  const user = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const { data, error, loading, reload } = useFetch<{ courses: CourseRow[] }>('/courses');
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const canCreate = user.role !== 'student';

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setJoining(true);
    setJoinError(null);
    try {
      const res = await api.post<{ course: Course }>('/courses/join', { join_code: code.trim() });
      toast('success', `You joined ${res.course.title}.`);
      navigate(`/courses/${res.course.id}`);
    } catch (err) {
      setJoinError(errorMessage(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={user.role === 'student' ? 'Courses you are enrolled in.' : user.role === 'admin' ? 'Every course on the platform.' : 'Courses you teach.'}
        actions={
          canCreate && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New course
            </Button>
          )
        }
      />

      {user.role === 'student' && (
        <Card className="mb-5" title="Join a course">
          <form onSubmit={join} className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <Field label="Join code">
                <input className="input font-mono uppercase" value={code} maxLength={20} placeholder="e.g. DEMO331" autoComplete="off" onChange={(e) => setCode(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" variant="primary" loading={joining} disabled={!code.trim()}>
              Join
            </Button>
            <p className="w-full text-xs text-muted">Your teacher shares this code with the class.</p>
          </form>
          {joinError && (
            <div className="mt-3">
              <Notice tone="error">{joinError}</Notice>
            </div>
          )}
        </Card>
      )}

      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data!.courses.length === 0 ? (
        <EmptyState title={canCreate ? 'No courses yet' : 'You are not enrolled in any course'}>
          {canCreate ? 'Create a course to start adding assignments and enrolling students.' : 'Enter the join code from your teacher above.'}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data!.courses.map((c) => (
            <Link key={c.id} to={`/courses/${c.id}`} className="card group flex flex-col p-4 transition-colors hover:border-accent">
              <div className="text-xs font-semibold uppercase tracking-wide text-accent">{c.code}</div>
              <h2 className="mt-0.5 text-base font-semibold group-hover:text-accent">{c.title}</h2>
              <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted">{c.description || 'No description.'}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span>{c.teacher_name}</span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {c.student_count}
                </span>
                <span>
                  {c.assignment_count} assignment{c.assignment_count === 1 ? '' : 's'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <CourseDialog
          onClose={() => setCreating(false)}
          onSaved={(course) => {
            setCreating(false);
            navigate(`/courses/${course.id}`);
          }}
        />
      )}
    </>
  );
}

export function CourseDialog({ course, onClose, onSaved }: { course?: Course; onClose: () => void; onSaved: (course: Course) => void }) {
  const [form, setForm] = useState({ title: course?.title ?? '', code: course?.code ?? '', description: course?.description ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = course ? await api.patch<{ course: Course }>(`/courses/${course.id}`, form) : await api.post<{ course: Course }>('/courses', form);
      toast('success', course ? 'Course updated.' : 'Course created.');
      onSaved(res.course);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={course ? 'Edit course' : 'New course'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!form.title.trim() || !form.code.trim()} onClick={submit}>
            {course ? 'Save changes' : 'Create course'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Title">
          <input className="input" value={form.title} maxLength={200} placeholder="Theory of Computation" onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Course code">
          <input className="input" value={form.code} maxLength={30} placeholder="CSE 331" onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="input h-24 resize-y" value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
