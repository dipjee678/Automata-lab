import { useMemo, useState } from 'react';
import { checkEquivalence, dfaToAutomaton, matchRegex, regexToDfa, regexToEnfa, regexToString, validateRegex } from '@automata/algorithms';
import { AutomatonPreview, REGEX_HELP } from '../components/answers';
import { Badge, Button, Card, Notice, PageHeader, showInput, Tabs } from '../components/ui';

const SAMPLES = ['(a|b)*abb', '(0|1)*01', 'a*b*c*', '(ab|ba)*', '(0|10)*(1|ε)', '1(0|1)*1|1'];

export function RegexPage() {
  const [source, setSource] = useState('(a|b)*abb');
  const [input, setInput] = useState('aabb');
  const [batch, setBatch] = useState('abb\nab\nbabb\nε');
  const [other, setOther] = useState('');
  const [view, setView] = useState<'nfa' | 'dfa'>('dfa');

  const validation = useMemo(() => (source.trim() ? validateRegex(source) : null), [source]);
  const ok = validation?.ok === true;

  const built = useMemo(() => {
    if (!ok) return null;
    try {
      const thompson = regexToEnfa(source);
      const dfa = regexToDfa(source);
      return { thompson, dfa, error: null as string | null };
    } catch (e) {
      return { thompson: null, dfa: null, error: e instanceof Error ? e.message : 'Could not build the automaton.' };
    }
  }, [ok, source]);

  const match = useMemo(() => (ok ? matchRegex(source, input) : null), [ok, source, input]);
  const batchRows = useMemo(() => {
    if (!ok) return [];
    return batch
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => {
        const s = line === 'ε' || line === 'eps' ? '' : line;
        return { input: s, accepted: matchRegex(source, s).accepted };
      });
  }, [ok, source, batch]);

  const otherValidation = useMemo(() => (other.trim() ? validateRegex(other) : null), [other]);
  const comparison = useMemo(() => {
    if (!ok || otherValidation?.ok !== true) return null;
    return checkEquivalence(regexToDfa(source), regexToDfa(other));
  }, [ok, otherValidation, source, other]);

  return (
    <>
      <PageHeader title="Regular expression laboratory" subtitle="Validate an expression, test strings against it, turn it into an automaton and compare it with another expression." />

      <Card title="Expression">
        <input className="input font-mono text-base" aria-label="Regular expression" value={source} spellCheck={false} autoComplete="off" onChange={(e) => setSource(e.target.value)} placeholder="(a|b)*abb" />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Insert:</span>
          {['ε', '∅', '|', '*', '(', ')'].map((s) => (
            <Button key={s} size="sm" className="font-mono" aria-label={`Insert ${s}`} onClick={() => setSource((v) => v + s)}>
              {s}
            </Button>
          ))}
          <span className="ml-3 text-xs text-muted">Try:</span>
          {SAMPLES.map((s) => (
            <button key={s} type="button" className="rounded border border-line px-1.5 py-0.5 font-mono text-xs hover:bg-raised" onClick={() => setSource(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {!validation ? (
            <p className="text-sm text-muted">{REGEX_HELP}</p>
          ) : validation.ok ? (
            <Notice tone="success">
              Valid expression. Parsed as <code className="font-mono font-semibold">{regexToString(validation.ast)}</code>
            </Notice>
          ) : (
            <Notice tone="error">
              <div>{validation.error}</div>
              {/* Point at the offending position. */}
              <pre className="mt-1 overflow-x-auto font-mono text-xs">
                {source}
                {'\n'}
                {' '.repeat(Math.min(validation.position, [...source].length))}^
              </pre>
            </Notice>
          )}
        </div>
        {validation?.ok && <p className="mt-2 text-xs text-muted">{REGEX_HELP}</p>}
      </Card>

      {ok && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Test a string">
            <input className="input font-mono" aria-label="Test string" value={input} spellCheck={false} placeholder="leave empty for ε" onChange={(e) => setInput(e.target.value.replace(/\s/g, ''))} />
            {match && (
              <div className="mt-3">
                <Notice tone={match.accepted ? 'success' : 'error'}>
                  <span data-testid="regex-match">
                    <strong>{match.accepted ? 'Match.' : 'No match.'}</strong> {match.explanation}
                  </span>
                </Notice>
                <p className="mt-2 text-xs text-muted">The whole string must match (membership in the language), not just a part of it. Decided exactly by simulating the equivalent ε-NFA.</p>
              </div>
            )}
            <label className="label mt-4" htmlFor="regex-batch">
              Test many strings (one per line, ε for empty)
            </label>
            <textarea id="regex-batch" className="input h-24 resize-y font-mono" value={batch} spellCheck={false} onChange={(e) => setBatch(e.target.value)} />
            {batchRows.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {batchRows.map((r, i) => (
                  <Badge key={i} tone={r.accepted ? 'green' : 'red'}>
                    <span className="font-mono">{showInput(r.input)}</span> {r.accepted ? '✓' : '✗'}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          <Card title="Compare with another expression" actions={<Badge tone="violet">Exact</Badge>}>
            <input className="input font-mono" aria-label="Second regular expression" value={other} spellCheck={false} placeholder="(a*b*)*abb" onChange={(e) => setOther(e.target.value)} />
            <div className="mt-3">
              {otherValidation && !otherValidation.ok && <Notice tone="error">{otherValidation.error}</Notice>}
              {comparison &&
                (comparison.equivalent ? (
                  <Notice tone="success">
                    <strong>Equivalent.</strong> Both expressions describe exactly the same language.
                  </Notice>
                ) : (
                  <Notice tone="error">
                    <strong>Not equivalent.</strong> Shortest distinguishing string: <code className="rounded bg-panel px-1.5 py-0.5 font-mono font-semibold">{showInput(comparison.counterexample!)}</code> — it is{' '}
                    {comparison.inA ? 'in' : 'not in'} the first language and {comparison.inB ? 'in' : 'not in'} the second.
                  </Notice>
                ))}
              {!other.trim() && <p className="text-sm text-muted">Enter a second expression to decide whether the two describe the same language. Both are converted to minimal DFAs and compared with a product-automaton search.</p>}
            </div>
          </Card>
        </div>
      )}

      {built?.error && (
        <div className="mt-4">
          <Notice tone="error">{built.error}</Notice>
        </div>
      )}

      {built?.thompson && built.dfa && (
        <div className="mt-4">
          <Card title="Equivalent automaton">
            <Tabs
              value={view}
              onChange={setView}
              tabs={[
                { id: 'dfa', label: `Minimal DFA (${built.dfa.names.length} states)` },
                { id: 'nfa', label: `ε-NFA by Thompson's construction (${built.thompson.automaton.states.length} states)` },
              ]}
            />
            {view === 'dfa' ? (
              <>
                <AutomatonPreview automaton={dfaToAutomaton(built.dfa)} name={`Minimal DFA of ${source}`} height="h-80" />
                <p className="mt-2 text-sm text-muted">Obtained from the ε-NFA by the subset construction followed by partition-refinement minimization. A dead state is included when some strings can never be completed to a match.</p>
              </>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
                <AutomatonPreview automaton={built.thompson.automaton} name={`ε-NFA of ${source}`} height="h-96" />
                <ol className="max-h-96 space-y-2 overflow-y-auto text-sm">
                  {built.thompson.steps.map((s, i) => (
                    <li key={i} className="rounded-md border border-line px-2.5 py-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <code className="font-mono font-semibold">{s.expression}</code>
                        <span className="whitespace-nowrap font-mono text-xs text-muted">
                          {s.start} ⇝ {s.accept}
                        </span>
                      </div>
                      <div className="text-xs text-muted">{s.rule}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
