/**
 * Step-by-step simulation for every machine type, with play / pause / step /
 * back / reset controls. Reports the states and transitions to highlight on
 * the canvas through `onHighlight`.
 */
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { labelOf, simulateFA, simulatePda, simulateTm, validateAutomaton } from '@automata/algorithms';
import type { Automaton } from '@automata/shared';
import { Badge, Button, cx, IconButton, Notice } from '../components/ui';

export interface Highlight {
  states: string[];
  transitions: string[];
}

interface Run {
  total: number;
  status: 'accepted' | 'rejected' | 'limit';
  message: string;
  highlight: (i: number) => Highlight;
  render: (i: number) => ReactNode;
}

/** Input tape with the consumed prefix dimmed and the next symbol marked. */
function InputTape({ symbols, consumed }: { symbols: string[]; consumed: number }) {
  if (symbols.length === 0) return <div className="font-mono text-sm text-muted">ε (empty input)</div>;
  return (
    <div className="flex flex-wrap gap-0.5 font-mono text-sm" aria-label="Input">
      {symbols.map((c, i) => (
        <span
          key={i}
          className={cx(
            'flex h-7 min-w-7 items-center justify-center rounded border px-1',
            i < consumed ? 'border-line/60 text-muted/60' : i === consumed ? 'border-accent bg-accent/10 font-bold text-accent' : 'border-line',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start gap-3 text-sm">
    <span className="w-24 shrink-0 pt-0.5 text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

function buildRun(a: Automaton, input: string): Run {
  const name = (id: string) => labelOf(a, id);

  if (a.type === 'PDA') {
    const r = simulatePda(a, input);
    const symbols = [...input];
    return {
      total: r.path.length,
      status: r.status,
      message: r.message,
      highlight: (i) => ({ states: [r.path[i]!.state], transitions: r.path[i]!.transition ? [r.path[i]!.transition!] : [] }),
      render: (i) => {
        const c = r.path[i]!;
        return (
          <div className="space-y-2">
            <Row label="Input">
              <InputTape symbols={symbols} consumed={c.position} />
            </Row>
            <Row label="State">
              <span className="font-mono font-semibold">{name(c.state)}</span>
            </Row>
            <Row label="Stack">
              <div className="flex items-center gap-0.5 font-mono text-sm" aria-label="Stack, top first">
                {c.stack.length === 0 ? (
                  <span className="text-muted">empty</span>
                ) : (
                  c.stack.map((s, k) => (
                    <span key={k} className={cx('flex h-7 min-w-7 items-center justify-center rounded border px-1', k === 0 ? 'border-accent bg-accent/10 font-bold text-accent' : 'border-line')}>
                      {s}
                    </span>
                  ))
                )}
                <span className="ml-2 text-xs text-muted">← top is on the left</span>
              </div>
            </Row>
            <Row label="Operation">{c.action}</Row>
          </div>
        );
      },
    };
  }

  if (a.type === 'TM') {
    const r = simulateTm(a, input);
    return {
      total: r.steps.length,
      status: r.status,
      message: r.message,
      highlight: (i) => ({ states: [r.steps[i]!.state], transitions: r.steps[i]!.transition ? [r.steps[i]!.transition!] : [] }),
      render: (i) => {
        const s = r.steps[i]!;
        // Show a window around the head so long tapes stay readable.
        const from = Math.max(0, s.head - 14);
        const cells = s.tape.slice(from, from + 30);
        return (
          <div className="space-y-2">
            <Row label="Tape">
              <div className="flex flex-wrap gap-0.5 font-mono text-sm" aria-label="Tape">
                {from > 0 && <span className="self-center px-1 text-muted">…</span>}
                {cells.map((c, k) => (
                  <span
                    key={k}
                    className={cx('flex h-8 min-w-7 items-center justify-center rounded border px-1', from + k === s.head ? 'border-accent bg-accent/15 font-bold text-accent ring-2 ring-accent/40' : 'border-line', c === '_' && 'text-muted')}
                  >
                    {c === '_' ? '␣' : c}
                  </span>
                ))}
                {from + 30 < s.tape.length && <span className="self-center px-1 text-muted">…</span>}
              </div>
            </Row>
            <Row label="Head">
              cell {s.head} reads <span className="font-mono font-semibold">{s.tape[s.head] === '_' ? '␣ (blank)' : s.tape[s.head]}</span>
            </Row>
            <Row label="State">
              <span className="font-mono font-semibold">{name(s.state)}</span>
            </Row>
          </div>
        );
      },
    };
  }

  const trace = simulateFA(a, input);
  return {
    total: trace.steps.length,
    status: trace.accepted ? 'accepted' : 'rejected',
    message: trace.message,
    highlight: (i) => ({ states: trace.steps[i]!.active, transitions: trace.steps[i]!.transitions }),
    render: (i) => {
      const s = trace.steps[i]!;
      return (
        <div className="space-y-2">
          <Row label="Input">
            <InputTape symbols={trace.input} consumed={s.consumed} />
          </Row>
          <Row label={a.type === 'DFA' ? 'State' : 'Active states'}>
            <span className="font-mono font-semibold">{s.active.length === 0 ? '∅ (no active state)' : a.type === 'DFA' && s.active.length === 1 ? name(s.active[0]!) : `{${s.active.map(name).join(', ')}}`}</span>
          </Row>
          <Row label="Step">{s.symbol === null ? (a.type === 'ENFA' ? 'Start: ε-closure of the initial state' : 'Start in the initial state') : `Read "${s.symbol}"`}</Row>
        </div>
      );
    },
  };
}

/**
 * Returns the same object for as long as the automaton is LOGICALLY unchanged,
 * ignoring state positions – so dragging a state does not restart a simulation.
 */
export function useStableAutomaton(automaton: Automaton): Automaton {
  const signature = JSON.stringify([automaton.type, automaton.alphabet ?? null, automaton.states.map((s) => [s.id, s.label, !!s.initial, !!s.accepting]), automaton.transitions]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => automaton, [signature]);
}

export function SimulationPanel({ automaton: live, onHighlight }: { automaton: Automaton; onHighlight: (h: Highlight) => void }) {
  const automaton = useStableAutomaton(live);
  const [input, setInput] = useState('');
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(700);

  const errors = useMemo(() => validateAutomaton(automaton).errors, [automaton]);

  const run = useMemo<{ run: Run | null; error: string | null }>(() => {
    if (!started || errors.length) return { run: null, error: null };
    try {
      return { run: buildRun(automaton, input), error: null };
    } catch (e) {
      return { run: null, error: e instanceof Error ? e.message : 'Simulation failed.' };
    }
  }, [started, automaton, input, errors]);

  const total = run.run?.total ?? 0;
  const current = Math.min(step, Math.max(0, total - 1));
  const atEnd = current >= total - 1;

  // Editing the machine or the input restarts the run from step 0.
  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [automaton, input]);

  useEffect(() => {
    onHighlight(run.run ? run.run.highlight(current) : { states: [], transitions: [] });
  }, [run.run, current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear highlights when the panel goes away.
  useEffect(() => () => onHighlight({ states: [], transitions: [] }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    if (atEnd) return setPlaying(false);
    const timer = setTimeout(() => setStep((s) => s + 1), speed);
    return () => clearTimeout(timer);
  }, [playing, atEnd, current, speed]);

  const begin = (autoplay: boolean) => {
    setStarted(true);
    setStep(0);
    setPlaying(autoplay);
  };
  const reset = () => {
    setStarted(false);
    setStep(0);
    setPlaying(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="sim-input">
          Input string
        </label>
        <div className="flex gap-2">
          <input
            id="sim-input"
            className="input font-mono"
            value={input}
            placeholder="leave empty for ε"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setInput(e.target.value.replace(/\s/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && begin(false)}
          />
        </div>
      </div>

      {errors.length > 0 ? (
        <Notice tone="warn">
          <p className="font-medium">Fix these problems before simulating:</p>
          <ul className="mt-1 list-disc pl-4">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Simulation controls">
          {!started ? (
            <>
              <Button variant="primary" size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => begin(true)}>
                Run
              </Button>
              <Button size="sm" icon={<SkipForward className="h-3.5 w-3.5" />} onClick={() => begin(false)}>
                Step through
              </Button>
            </>
          ) : (
            <>
              <IconButton label="Reset" onClick={reset} className="border border-line">
                <RotateCcw className="h-4 w-4" />
              </IconButton>
              <IconButton label="Previous step" disabled={current === 0} onClick={() => (setPlaying(false), setStep(current - 1))} className="border border-line">
                <ChevronLeft className="h-4 w-4" />
              </IconButton>
              <IconButton label={playing ? 'Pause' : 'Play'} disabled={atEnd} onClick={() => setPlaying((p) => !p)} className="border border-line">
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </IconButton>
              <IconButton label="Next step" disabled={atEnd} onClick={() => (setPlaying(false), setStep(current + 1))} className="border border-line">
                <ChevronRight className="h-4 w-4" />
              </IconButton>
              <span className="ml-1 text-xs tabular-nums text-muted">
                step {current} / {Math.max(0, total - 1)}
              </span>
              <select className="input ml-auto !w-auto !py-1 text-xs" aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={1400}>Slow</option>
                <option value={700}>Normal</option>
                <option value={250}>Fast</option>
              </select>
            </>
          )}
        </div>
      )}

      {run.error && <Notice tone="error">{run.error}</Notice>}

      {run.run && (
        <>
          <div className="rounded-md border border-line bg-raised/50 p-3">{run.run.render(current)}</div>
          {atEnd ? (
            <Notice tone={run.run.status === 'accepted' ? 'success' : run.run.status === 'limit' ? 'warn' : 'error'}>
              <span data-testid="sim-result">{run.run.message}</span>
            </Notice>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted">
              Final result:
              <Badge tone={run.run.status === 'accepted' ? 'green' : run.run.status === 'limit' ? 'amber' : 'red'}>{run.run.status === 'accepted' ? 'accepted' : run.run.status === 'limit' ? 'inconclusive' : 'rejected'}</Badge>
              <span>— keep stepping to see why.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Run many strings at once and tabulate the verdicts. */
export function BatchTester({ automaton: live }: { automaton: Automaton }) {
  const automaton = useStableAutomaton(live);
  const [text, setText] = useState('');
  const errors = useMemo(() => validateAutomaton(automaton).errors, [automaton]);
  const rows = useMemo(() => {
    if (errors.length) return [];
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => {
        const input = line === 'ε' || line === 'eps' ? '' : line;
        try {
          const status = automaton.type === 'PDA' ? simulatePda(automaton, input).status : automaton.type === 'TM' ? simulateTm(automaton, input, { keepTrace: false }).status : simulateFA(automaton, input).accepted ? 'accepted' : 'rejected';
          return { input, status };
        } catch {
          return { input, status: 'error' as const };
        }
      });
  }, [text, automaton, errors]);

  return (
    <div className="space-y-2">
      <label className="label" htmlFor="batch-input">
        One string per line (write ε for the empty string)
      </label>
      <textarea id="batch-input" className="input h-28 resize-y font-mono" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder={'0110\n101\nε'} />
      {errors.length > 0 && text.trim() !== '' && <Notice tone="warn">The automaton is not valid yet: {errors[0]}</Notice>}
      {rows.length > 0 && (
        <table className="table-base">
          <thead>
            <tr>
              <th>String</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="font-mono">{r.input === '' ? 'ε' : r.input}</td>
                <td>
                  <Badge tone={r.status === 'accepted' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status === 'limit' ? 'inconclusive' : r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
