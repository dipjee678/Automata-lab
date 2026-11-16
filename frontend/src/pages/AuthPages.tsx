import { BookOpen } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Notice, useFetch } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/stores';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white dark:text-slate-950">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight">Automata Lab</div>
            <div className="text-xs text-muted">Formal languages laboratory with automatic grading</div>
          </div>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mb-5 mt-1 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
        <p className="mt-4 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const health = useFetch<{ mode: string }>('/health');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your course account to continue."
      footer={
        <>
          New here?{' '}
          <Link className="font-medium text-accent hover:underline" to="/register">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Email">
          <input className="input" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className="input" type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
      {health.data?.mode === 'local' && (
        <div className="mt-5">
          <Notice>
            This server runs in <strong>local demo mode</strong>. Sample teacher, student and admin accounts are listed in the project README.
          </Notice>
        </div>
      )}
      {health.error && (
        <div className="mt-5">
          <Notice tone="warn">The API is not reachable. Start it with <code className="font-mono">npm run dev</code>.</Notice>
        </div>
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const health = useFetch<{ allowTeacherSignup: boolean }>('/health');
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'student' as 'student' | 'teacher' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const passwordError = form.password.length > 0 && form.password.length < 8 ? 'Use at least 8 characters.' : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Students join courses with a code from their teacher."
      footer={
        <>
          Already registered?{' '}
          <Link className="font-medium text-accent hover:underline" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Full name">
          <input className="input" name="full_name" autoComplete="name" required maxLength={120} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" name="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" error={passwordError} hint="At least 8 characters.">
          <input className="input" type="password" name="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <fieldset>
          <legend className="label">I am a</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['student', 'teacher'] as const).map((role) => {
              const disabled = role === 'teacher' && health.data?.allowTeacherSignup === false;
              return (
                <label
                  key={role}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm capitalize ${form.role === role ? 'border-accent bg-accent/10 text-accent' : 'border-line'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                  title={disabled ? 'Teacher accounts are created by an administrator on this server.' : undefined}
                >
                  <input type="radio" name="role" className="sr-only" disabled={disabled} checked={form.role === role} onChange={() => setForm({ ...form, role })} />
                  {role}
                </label>
              );
            })}
          </div>
        </fieldset>
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!form.full_name || !form.email || form.password.length < 8}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
