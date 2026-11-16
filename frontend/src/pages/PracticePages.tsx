import { ArrowLeft, CheckCircle2, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QUESTION_TYPE_LABELS, type Answer, type Automaton, type GradeResult, type PracticeHistory, type QuestionType } from '@automata/shared';
import { AnswerEditor, answerProblem, AutomatonPreview, emptyAnswer, GradeFeedback } from '../components/answers';
import { Badge, Button, Card, EmptyState, ErrorState, formatDate, MethodBadge, PageHeader, Spinner, Tabs, useFetch, VerdictBadge } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { toast } from '../lib/stores';

interface Problem {
  id: string;
  title: string;
  prompt: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  type: QuestionType;
  marks: number;
  alphabet: string[];
  given: Automaton | null;
  exact: boolean;
  attempts: number;
  best_score: number | null;
  solved: boolean;
}

const DIFFICULTY = { easy: 'green', medium: 'amber', hard: 'red' } as const;

export function PracticePage() {
  const problems = useFetch<{ problems: Problem[] }>('/practice/problems');
  const history = useFetch<{ history: Array<PracticeHistory & { title: string }> }>('/practice/history');
  const [tab, setTab] = useState<'problems' | 'history'>('problems');

  if (problems.loading && !problems.data) return <Spinner />;
  if (problems.error) return <ErrorState message={problems.error} onRetry={problems.reload} />;
  const list = problems.data!.problems;
  const topics = [...new Set(list.map((p) => p.topic))];
  const solved = list.filter((p) => p.solved).length;

  return (
    <>
      <PageHeader
        title="Practice"
        subtitle="Self-paced problems with instant feedback. Nothing here counts towards a course grade."
        actions={
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums">
              {solved} / {list.length} solved
            </div>
            <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={solved} aria-valuemin={0} aria-valuemax={list.length} aria-label="Problems solved">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(solved / Math.max(1, list.length)) * 100}%` }} />
            </div>
          </div>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'problems', label: 'Problems' },
          { id: 'history', label: `My attempts${history.data ? ` (${history.data.history.length})` : ''}` },
        ]}
      />

      {tab === 'problems' &&
        topics.map((topic) => (
          <section key={topic} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{topic}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list
                .filter((p) => p.topic === topic)
                .map((p) => (
                  <Link key={p.id} to={`/practice/${p.id}`} className="card group flex flex-col p-4 transition-colors hover:border-accent">
                    <div className="flex items-start gap-2">
                      {p.solved ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-label="Solved" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted/50" aria-label="Not solved" />}
                      <h3 className="text-sm font-semibold group-hover:text-accent">{p.title}</h3>
                    </div>
                    <p className="mt-1.5 line-clamp-2 flex-1 text-sm text-muted">{p.prompt}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Badge tone={DIFFICULTY[p.difficulty]}>{p.difficulty}</Badge>
                      <MethodBadge exact={p.exact} />
                      {p.attempts > 0 && (
                        <span className="ml-auto text-xs tabular-nums text-muted">
                          best {p.best_score}/{p.marks} · {p.attempts} attempt{p.attempts === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
            </div>
          </section>
        ))}

      {tab === 'history' &&
        (history.loading && !history.data ? (
          <Spinner />
        ) : history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} />
        ) : history.data!.history.length === 0 ? (
          <EmptyState title="No attempts yet">Pick a problem and check an answer to start your history.</EmptyState>
        ) : (
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Problem</th>
                    <th>Result</th>
                    <th>Score</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data!.history.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <Link className="font-medium hover:text-accent hover:underline" to={`/practice/${h.problem_id}`}>
                          {h.title}
                        </Link>
                      </td>
                      <td>
                        <VerdictBadge verdict={h.verdict} />
                      </td>
                      <td className="tabular-nums">
                        {h.score} / {h.max_score}
                      </td>
                      <td className="whitespace-nowrap text-muted">{formatDate(h.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
    </>
  );
}

export function PracticeSolvePage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useFetch<{ problems: Problem[] }>('/practice/problems');
  const problem = data?.problems.find((p) => p.id === id);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (problem && !answer) setAnswer(emptyAnswer(problem.type));
  }, [problem, answer]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!problem) return <EmptyState title="Problem not found" action={<Link to="/practice" className="text-sm text-accent hover:underline">Back to practice</Link>} />;
  if (!answer) return <Spinner />;

  const blocked = answerProblem(answer);
  const check = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ result: GradeResult }>(`/practice/problems/${problem.id}/check`, { answer });
      setResult(res.result);
      if (res.result.verdict === 'correct') toast('success', 'Correct — well done!');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link to="/practice" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> All practice problems
      </Link>
      <PageHeader
        title={problem.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge>{QUESTION_TYPE_LABELS[problem.type]}</Badge>
            <Badge tone={DIFFICULTY[problem.difficulty]}>{problem.difficulty}</Badge>
            <MethodBadge exact={problem.exact} />
            {problem.alphabet.length > 0 && <span className="font-mono text-xs">Σ = {`{${problem.alphabet.join(', ')}}`}</span>}
          </span>
        }
      />
      <div className="space-y-4">
        <Card title="Problem">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{problem.prompt}</p>
          {problem.given && (
            <div className="mt-3">
              <div className="label">Given automaton</div>
              <AutomatonPreview automaton={problem.given} name={`${problem.title} (given)`} height="h-64" />
            </div>
          )}
        </Card>
        <Card title="Your answer">
          <AnswerEditor type={problem.type} value={answer} onChange={setAnswer} resetKey={problem.id} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={busy} disabled={!!blocked} onClick={check} title={blocked ?? undefined}>
              Check answer
            </Button>
            {blocked && <span className="text-sm text-muted">{blocked}</span>}
          </div>
        </Card>
        {result && <GradeFeedback result={result} />}
      </div>
    </>
  );
}
