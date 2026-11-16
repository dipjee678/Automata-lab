import { BookOpenCheck, ClipboardList, GraduationCap, Inbox, Share2, Target, TrendingUp, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Profile, Verdict } from '@automata/shared';
import { Badge, Card, EmptyState, ErrorState, formatDate, PageHeader, Spinner, StatCard, useFetch, VerdictBadge } from '../components/ui';
import { useAuth } from '../lib/stores';

interface Recent {
  id: string;
  assignment_id: string;
  created_at: string;
  question: string;
  student?: string;
  verdict: Verdict | null;
  score: number | null;
  max_score: number | null;
  exact?: boolean | null;
}

interface AssignmentRow {
  id: string;
  title: string;
  course: string;
  due_at: string | null;
  questions: number;
  answered: number;
  score: number;
  total: number;
  percent: number;
}

type Dashboard =
  | { role: 'admin'; users: number; admins: number; teachers: number; students: number; courses: number; submissions: number; recentUsers: Profile[] }
  | { role: 'teacher'; courses: number; students: number; assignments: number; published: number; submissions: number; needsReview: number; recent: Recent[] }
  | {
      role: 'student';
      courses: number;
      assignments: number;
      completed: number;
      average: number | null;
      practiceSolved: number;
      practiceAttempts: number;
      practiceTotal: number;
      upcoming: AssignmentRow[];
      assignmentsList: AssignmentRow[];
      recent: Recent[];
    };

const QuickLink = ({ to, icon, title, text }: { to: string; icon: ReactNode; title: string; text: string }) => (
  <Link to={to} className="card flex items-start gap-3 p-4 transition-colors hover:border-accent">
    <div className="rounded-md bg-accent/10 p-2 text-accent">{icon}</div>
    <div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-sm text-muted">{text}</div>
    </div>
  </Link>
);

function RecentList({ items, showStudent }: { items: Recent[]; showStudent?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-muted">No submissions yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <Link to={`/assignments/${r.assignment_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent hover:underline">
            {showStudent && r.student ? `${r.student} — ` : ''}
            {r.question}
          </Link>
          {r.verdict && <VerdictBadge verdict={r.verdict} />}
          {r.exact === false && <Badge tone="blue">bounded</Badge>}
          <span className="tabular-nums text-muted">
            {r.score ?? '—'} / {r.max_score ?? '—'}
          </span>
          <span className="w-full text-xs text-muted sm:w-auto">{formatDate(r.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const user = useAuth((s) => s.user)!;
  const { data, error, loading, reload } = useFetch<Dashboard>('/dashboard');

  const header = <PageHeader title={`Welcome, ${user.full_name}`} subtitle={{ admin: 'Platform overview.', teacher: 'Your courses, assignments and recent student work.', student: 'Your courses, assignments and learning progress.' }[user.role]} />;
  if (loading && !data) return <>{header}<Spinner /></>;
  if (error || !data) return <>{header}<ErrorState message={error ?? 'Could not load the dashboard.'} onRetry={reload} /></>;

  const tools = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <QuickLink to="/editor" icon={<Share2 className="h-4 w-4" />} title="Automata editor" text="Draw and simulate DFAs, NFAs, PDAs and Turing machines." />
      <QuickLink to="/algorithms" icon={<TrendingUp className="h-4 w-4" />} title="Conversions" text="Subset construction, minimization, equivalence — step by step." />
      <QuickLink to="/practice" icon={<Target className="h-4 w-4" />} title="Practice" text="Sample problems with instant feedback and counterexamples." />
    </div>
  );

  if (data.role === 'admin')
    return (
      <>
        {header}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Users" value={data.users} hint={`${data.admins} admin · ${data.teachers} teacher · ${data.students} student`} icon={<Users className="h-4 w-4" />} />
          <StatCard label="Courses" value={data.courses} icon={<GraduationCap className="h-4 w-4" />} />
          <StatCard label="Submissions" value={data.submissions} icon={<Inbox className="h-4 w-4" />} />
          <StatCard label="Teachers" value={data.teachers} icon={<BookOpenCheck className="h-4 w-4" />} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Newest accounts" actions={<Link to="/admin/users" className="text-xs font-medium text-accent hover:underline">Manage users</Link>}>
            <ul className="divide-y divide-line">
              {data.recentUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{u.full_name}</span> <span className="text-muted">{u.email}</span>
                  </span>
                  <Badge tone={u.role === 'admin' ? 'red' : u.role === 'teacher' ? 'violet' : 'blue'}>{u.role}</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Manage">
            <div className="grid gap-3">
              <QuickLink to="/admin/users" icon={<Users className="h-4 w-4" />} title="Users and roles" text="Promote teachers, remove accounts." />
              <QuickLink to="/courses" icon={<GraduationCap className="h-4 w-4" />} title="All courses" text="Open or remove any course on the platform." />
            </div>
          </Card>
        </div>
      </>
    );

  if (data.role === 'teacher')
    return (
      <>
        {header}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Courses" value={data.courses} icon={<GraduationCap className="h-4 w-4" />} />
          <StatCard label="Students" value={data.students} icon={<Users className="h-4 w-4" />} />
          <StatCard label="Assignments" value={data.assignments} hint={`${data.published} published`} icon={<ClipboardList className="h-4 w-4" />} />
          <StatCard label="To review" value={data.needsReview} hint="graded by bounded testing" icon={<Inbox className="h-4 w-4" />} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card title="Recent submissions">
            <RecentList items={data.recent} showStudent />
          </Card>
          <Card title="Get started">
            {data.courses === 0 ? (
              <EmptyState title="No courses yet" action={<Link to="/courses" className="text-sm font-medium text-accent hover:underline">Create your first course</Link>}>
                Create a course, share its join code and add assignments.
              </EmptyState>
            ) : (
              <div className="grid gap-3">
                <QuickLink to="/courses" icon={<GraduationCap className="h-4 w-4" />} title="Your courses" text="Assignments, students and analytics." />
                <QuickLink to="/editor" icon={<Share2 className="h-4 w-4" />} title="Automata editor" text="Prepare reference automata." />
              </div>
            )}
          </Card>
        </div>
      </>
    );

  return (
    <>
      {header}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Courses" value={data.courses} icon={<GraduationCap className="h-4 w-4" />} />
        <StatCard label="Assignments done" value={`${data.completed} / ${data.assignments}`} icon={<ClipboardList className="h-4 w-4" />} />
        <StatCard label="Average score" value={data.average === null ? '—' : `${data.average}%`} hint="on assignments you started" icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Practice solved" value={`${data.practiceSolved} / ${data.practiceTotal}`} hint={`${data.practiceAttempts} attempt${data.practiceAttempts === 1 ? '' : 's'}`} icon={<Target className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="To do">
          {data.courses === 0 ? (
            <EmptyState title="You are not in a course yet" action={<Link to="/courses" className="text-sm font-medium text-accent hover:underline">Join a course</Link>}>
              Ask your teacher for the join code.
            </EmptyState>
          ) : data.upcoming.length === 0 ? (
            <p className="text-sm text-muted">Nothing open — every published assignment is answered.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.upcoming.map((a) => (
                <li key={a.id} className="py-2">
                  <Link to={`/assignments/${a.id}`} className="text-sm font-medium hover:text-accent hover:underline">
                    {a.title}
                  </Link>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>{a.course}</span>
                    <span>
                      {a.answered} / {a.questions} answered
                    </span>
                    <span>{a.due_at ? `due ${formatDate(a.due_at)}` : 'no deadline'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent results">
          <RecentList items={data.recent} />
        </Card>
      </div>

      {data.assignmentsList.length > 0 && (
        <div className="mt-4">
          <Card title="Progress by assignment">
            <ul className="space-y-3">
              {data.assignmentsList.map((a) => (
                <li key={a.id}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <Link to={`/assignments/${a.id}`} className="truncate font-medium hover:text-accent hover:underline">
                      {a.title}
                    </Link>
                    <span className="whitespace-nowrap tabular-nums text-muted">
                      {a.score} / {a.total} ({a.percent}%)
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={a.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${a.title} score`}>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${a.percent}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted">Laboratory</h2>
      {tools}
    </>
  );
}
