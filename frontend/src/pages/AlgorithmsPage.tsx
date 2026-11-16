import { useMemo, useState, type ReactNode } from 'react';
import {
  checkEquivalence,
  dfaToAutomaton,
  isDeterministic,
  isFiniteAutomaton,
  minimizeDfa,
  productDfa,
  regexToEnfa,
  removeEpsilon,
  subsetConstruction,
  toDfa,
  validateAutomaton,
  type ProductMode,
} from '@automata/algorithms';
import type { Automaton, SavedAutomaton } from '@automata/shared';
import { AutomatonPreview } from '../components/answers';
import { Badge, Card, Field, Notice, PageHeader, showInput, Tabs, useFetch } from '../components/ui';
import { EXAMPLES, TYPE_NAMES } from '../lib/examples';
import { useWorkspace } from '../lib/stores';

/* ------------------------------------------------------------------ */
/* Choosing the input automaton                                        */
/* ------------------------------------------------------------------ */

type Source = { kind: 'editor' } | { kind: 'saved'; id: string } | { kind: 'example'; id: string } | { kind: 'regex'; regex: string };

interface Resolved {
  automaton: Automaton | null;
  name: string;
  error: string | null;
}

function useResolved(source: Source, saved: SavedAutomaton[]): Resolved {
  const editor = useWorkspace((s) => s.automaton);
  const editorName = useWorkspace((s) => s.name);
  return useMemo(() => {
    let automaton: Automaton | null = null;
    let name = '';
    try {
      if (source.kind === 'editor') [automaton, name] = [editor, editorName];
      else if (source.kind === 'saved') {
        const s = saved.find((x) => x.id === source.id);
        if (!s) return { automaton: null, name: '', error: 'Choose a saved automaton.' };
        [automaton, name] = [s.data, s.name];
      } else if (source.kind === 'example') {
        const ex = EXAMPLES.find((x) => x.id === source.id)!;
        [automaton, name] = [ex.automaton, ex.name];
      } else {
        if (!source.regex.trim()) return { automaton: null, name: '', error: 'Enter a regular expression.' };
        [automaton, name] = [regexToEnfa(source.regex).automaton, source.regex];
      }
    } catch (e) {
      return { automaton: null, name: '', error: e instanceof Error ? e.message : 'Invalid input.' };
    }
    if (!isFiniteAutomaton(automaton.type))
      return { automaton: null, name, error: `These algorithms work on finite automata. "${name}" is a ${TYPE_NAMES[automaton.type]}.` };
    if (automaton.states.length === 0) return { automaton: null, name, error: source.kind === 'editor' ? 'The automaton in the editor is empty. Draw one first or pick an example.' : 'This automaton is empty.' };
    const errors = validateAutomaton(automaton, { as: 'ENFA' }).errors;
    if (errors.length) return { automaton: null, name, error: errors[0]! };
    return { automaton, name, error: null };
  }, [source, saved, editor, editorName]);
}

function SourcePicker({ label, value, onChange, saved }: { label: string; value: Source; onChange: (s: Source) => void; saved: SavedAutomaton[] }) {
  const editorName = useWorkspace((s) => s.name);
  const encoded = value.kind === 'editor' ? 'editor' : value.kind === 'regex' ? 'regex' : `${value.kind}:${value.id}`;
  const faExamples = EXAMPLES.filter((e) => isFiniteAutomaton(e.automaton.type));
  return (
    <div className="space-y-2">
      <Field label={label}>
        <select
          className="input"
          value={encoded}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'editor') onChange({ kind: 'editor' });
            else if (v === 'regex') onChange({ kind: 'regex', regex: '' });
            else onChange({ kind: v.startsWith('saved:') ? 'saved' : 'example', id: v.slice(v.indexOf(':') + 1) });
          }}
        >
          <option value="editor">Editor: {editorName}</option>
          <option value="regex">A regular expression…</option>
          {saved.length > 0 && (
            <optgroup label="Saved automata">
              {saved.map((s) => (
                <option key={s.id} value={`saved:${s.id}`}>
                  {s.name} ({TYPE_NAMES[s.type]})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Examples">
            {faExamples.map((e) => (
              <option key={e.id} value={`example:${e.id}`}>
                {e.name}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      {value.kind === 'regex' && <input className="input font-mono" aria-label={`${label}: regular expression`} placeholder="(a|b)*abb" value={value.regex} spellCheck={false} onChange={(e) => onChange({ kind: 'regex', regex: e.target.value })} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type TabId = 'subset' | 'epsilon' | 'minimize' | 'product' | 'equivalence';

export function AlgorithmsPage() {
  const saved = useFetch<{ automata: SavedAutomaton[] }>('/automata').data?.automata ?? [];
  const [tab, setTab] = useState<TabId>('subset');
  const [sourceA, setSourceA] = useState<Source>(() => (useWorkspace.getState().automaton.states.length ? { kind: 'editor' } : { kind: 'example', id: 'nfa-ends-01' }));
  const [sourceB, setSourceB] = useState<Source>({ kind: 'example', id: 'dfa-div3' });
  const [mode, setMode] = useState<ProductMode>('intersection');
  const a = useResolved(sourceA, saved);
  const b = useResolved(sourceB, saved);
  const needsB = tab === 'product' || tab === 'equivalence';

  return (
    <>
      <PageHeader
        title="Conversions and minimization"
        subtitle="Run the classic algorithms on finite automata and follow every step. All results on this page are exact."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'subset', label: 'NFA → DFA' },
          { id: 'epsilon', label: 'ε-NFA → NFA' },
          { id: 'minimize', label: 'Minimize DFA' },
          { id: 'product', label: 'Product' },
          { id: 'equivalence', label: 'Equivalence' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={needsB ? 'Automaton A' : 'Input automaton'}>
          <div className="space-y-3">
            <SourcePicker label="Source" value={sourceA} onChange={setSourceA} saved={saved} />
            {a.error ? <Notice tone="warn">{a.error}</Notice> : <AutomatonPreview automaton={a.automaton!} name={a.name} height="h-56" openable={sourceA.kind !== 'editor'} />}
          </div>
        </Card>
        {needsB ? (
          <Card title="Automaton B">
            <div className="space-y-3">
              <SourcePicker label="Source" value={sourceB} onChange={setSourceB} saved={saved} />
              {b.error ? <Notice tone="warn">{b.error}</Notice> : <AutomatonPreview automaton={b.automaton!} name={b.name} height="h-56" openable={sourceB.kind !== 'editor'} />}
            </div>
          </Card>
        ) : (
          <Card title="About this algorithm">
            <div className="space-y-2 text-sm text-muted">{ABOUT[tab]}</div>
          </Card>
        )}
      </div>

      <div className="mt-4">
        {a.automaton && tab === 'subset' && <SubsetView automaton={a.automaton} />}
        {a.automaton && tab === 'epsilon' && <EpsilonView automaton={a.automaton} />}
        {a.automaton && tab === 'minimize' && <MinimizeView automaton={a.automaton} />}
        {a.automaton && b.automaton && tab === 'product' && (
          <Guard>
            {() => {
              const result = productDfa(toDfa(a.automaton!), toDfa(b.automaton!), mode);
              return (
                <Card
                  title="Product automaton"
                  actions={
                    <select className="input !w-auto !py-1 text-xs" aria-label="Product mode" value={mode} onChange={(e) => setMode(e.target.value as ProductMode)}>
                      <option value="intersection">Intersection  A ∩ B</option>
                      <option value="union">Union  A ∪ B</option>
                      <option value="difference">Difference  A \ B</option>
                      <option value="symmetric-difference">Symmetric difference  A △ B</option>
                    </select>
                  }
                >
                  <p className="mb-3 text-sm text-muted">
                    Each state is a pair (state of A, state of B); both automata read the same symbol simultaneously. Only the {result.pairs.length} pair(s) reachable from the start pair are built. A pair is accepting when{' '}
                    {{ intersection: 'both components accept', union: 'at least one component accepts', difference: 'A accepts and B does not', 'symmetric-difference': 'exactly one component accepts' }[mode]}. Non-deterministic inputs are
                    determinized first; missing transitions lead to a dead state.
                  </p>
                  <AutomatonPreview automaton={dfaToAutomaton(result.dfa)} name={`Product (${mode})`} height="h-80" />
                </Card>
              );
            }}
          </Guard>
        )}
        {a.automaton && b.automaton && tab === 'equivalence' && (
          <Guard>
            {() => {
              const r = checkEquivalence(toDfa(a.automaton!), toDfa(b.automaton!));
              return (
                <Card title="Equivalence check" actions={<Badge tone="violet">Exact</Badge>}>
                  {r.equivalent ? (
                    <Notice tone="success">
                      <strong>Equivalent.</strong> A and B accept exactly the same language. All {r.explored} reachable state pairs of the product were explored and none separates the two automata.
                    </Notice>
                  ) : (
                    <Notice tone="error">
                      <strong>Not equivalent.</strong> Shortest distinguishing string:{' '}
                      <code className="rounded bg-panel px-1.5 py-0.5 font-mono font-semibold" data-testid="distinguishing-string">
                        {showInput(r.counterexample!)}
                      </code>{' '}
                      — A {r.inA ? 'accepts' : 'rejects'} it, B {r.inB ? 'accepts' : 'rejects'} it.
                    </Notice>
                  )}
                  <p className="mt-3 text-sm text-muted">
                    Method: breadth-first search over the product of the two (determinized, completed) automata, looking for a reachable pair in which exactly one component accepts — i.e. a reachable accepting state of the symmetric difference A △ B.
                    Because the search is breadth-first, the string found is as short as possible.
                  </p>
                </Card>
              );
            }}
          </Guard>
        )}
      </div>
    </>
  );
}

const ABOUT: Record<TabId, ReactNode> = {
  subset: (
    <>
      <p>
        The <strong>subset construction</strong> builds a DFA whose states are sets of NFA states. The start state is the ε-closure of the NFA's initial state; reading a symbol from a set S leads to the ε-closure of all states reachable from S on that
        symbol.
      </p>
      <p>A set is accepting if it contains an accepting NFA state. The empty set ∅ is the dead state. Only reachable sets are generated.</p>
    </>
  ),
  epsilon: (
    <>
      <p>
        ε-transitions are removed without adding states: for every state q and symbol a, the new transitions go to <span className="font-mono">ε-closure(δ(ε-closure(q), a))</span>.
      </p>
      <p>A state becomes accepting if its ε-closure contains an accepting state.</p>
    </>
  ),
  minimize: (
    <>
      <p>
        <strong>Partition refinement</strong> (Moore's algorithm): unreachable states are removed and the DFA is completed; then states are split into accepting and non-accepting, and blocks are split again and again until all states of a block behave the
        same on every symbol.
      </p>
      <p>Each final block becomes one state. The result is the unique minimal complete DFA for the language.</p>
    </>
  ),
  product: null,
  equivalence: null,
};

/** Render children lazily and show a readable message if an algorithm throws (e.g. state explosion). */
function Guard({ children }: { children: () => ReactNode }) {
  try {
    return <>{children()}</>;
  } catch (e) {
    return <Notice tone="error">{e instanceof Error ? e.message : 'The algorithm failed on this input.'}</Notice>;
  }
}

/* ------------------------------------------------------------------ */
/* Step-by-step views                                                  */
/* ------------------------------------------------------------------ */

function SubsetView({ automaton }: { automaton: Automaton }) {
  return (
    <Guard>
      {() => {
        const r = subsetConstruction(automaton);
        return (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Construction steps" pad={false}>
              <p className="border-b border-line px-4 py-2.5 text-sm text-muted">
                Start state: ε-closure of the initial state = <span className="font-mono font-semibold text-ink">{r.startClosure}</span>. Each row expands one subset; <Badge tone="blue">new</Badge> marks a subset discovered in that step.
                {isDeterministic(automaton) && ' The input is already deterministic, so every subset has at most one state.'}
              </p>
              <div className="overflow-x-auto">
                <table className="table-base font-mono">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>DFA state</th>
                      {r.dfa.alphabet.map((c) => (
                        <th key={c}>on {c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.steps.map((s, i) => (
                      <tr key={i}>
                        <td className="text-muted">{i + 1}</td>
                        <td className="whitespace-nowrap font-semibold">
                          {i === 0 && '→ '}
                          {s.accepting && '* '}
                          {s.subset}
                        </td>
                        {s.moves.map((m) => (
                          <td key={m.symbol} className="whitespace-nowrap">
                            {m.target} {m.isNew && <Badge tone="blue">new</Badge>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-2 text-xs text-muted">→ start state · * accepting state · ∅ dead state</p>
            </Card>
            <Card title={`Resulting DFA (${r.dfa.names.length} states)`}>
              <AutomatonPreview automaton={dfaToAutomaton(r.dfa)} name="DFA (subset construction)" height="h-80" />
            </Card>
          </div>
        );
      }}
    </Guard>
  );
}

function EpsilonView({ automaton }: { automaton: Automaton }) {
  return (
    <Guard>
      {() => {
        const r = removeEpsilon(automaton);
        const hasEps = automaton.transitions.some((t) => t.symbol === '');
        return (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="ε-closures" pad={false}>
              {!hasEps && <p className="border-b border-line px-4 py-2.5 text-sm text-muted">This automaton has no ε-transitions, so every closure is just the state itself and nothing changes.</p>}
              <table className="table-base font-mono">
                <thead>
                  <tr>
                    <th>State q</th>
                    <th>ε-closure(q)</th>
                  </tr>
                </thead>
                <tbody>
                  {r.closures.map((c) => (
                    <tr key={c.state}>
                      <td className="font-semibold">{c.state}</td>
                      <td>{`{${c.closure.join(', ')}}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.newAccepting.length > 0 && (
                <p className="px-4 py-2.5 text-sm">
                  Newly accepting (their closure contains an accepting state): <span className="font-mono font-semibold">{r.newAccepting.join(', ')}</span>
                </p>
              )}
            </Card>
            <Card title="Resulting NFA (no ε-transitions)">
              <AutomatonPreview automaton={r.automaton} name="NFA without ε" height="h-80" />
            </Card>
          </div>
        );
      }}
    </Guard>
  );
}

function MinimizeView({ automaton }: { automaton: Automaton }) {
  return (
    <Guard>
      {() => {
        const deterministic = isDeterministic(automaton);
        const input = toDfa(automaton);
        const r = minimizeDfa(input);
        return (
          <div className="space-y-4">
            {!deterministic && <Notice>The input is not deterministic, so it was first converted to a DFA with the subset construction ({input.names.length} states). The steps below start from that DFA.</Notice>}
            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Partition refinement">
                <ol className="space-y-4 text-sm">
                  <li>
                    <div className="font-medium">Preparation</div>
                    <p className="text-muted">
                      {r.removedUnreachable.length ? `Removed unreachable state(s): ${r.removedUnreachable.join(', ')}. ` : 'No unreachable states. '}
                      {r.addedDeadState ? 'Added a dead state ∅ so every state has a transition on every symbol.' : 'The transition function is already total.'}
                    </p>
                  </li>
                  {r.rounds.map((round, i) => (
                    <li key={i}>
                      <div className="font-medium">
                        {i === 0 ? 'Round 0: split accepting from non-accepting' : `Round ${i}`} — {round.partition.length} block{round.partition.length === 1 ? '' : 's'}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {round.partition.map((block, k) => (
                          <span key={k} className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-xs">
                            B{k} = {`{${block.join(', ')}}`}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 overflow-x-auto">
                        <table className="table-base font-mono text-xs">
                          <thead>
                            <tr>
                              <th>State</th>
                              <th>Block</th>
                              {r.dfa.alphabet.map((c) => (
                                <th key={c}>{c} leads to</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {round.table.map((row) => (
                              <tr key={row.state}>
                                <td className="font-semibold">{row.state}</td>
                                <td>B{row.block}</td>
                                {row.targets.map((t, k) => (
                                  <td key={k}>B{t}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-1 text-muted">
                        {round.splits.length
                          ? `States in ${round.splits.join(' and ')} disagree on where they lead, so ${round.splits.length === 1 ? 'that block is' : 'those blocks are'} split.`
                          : 'Within every block all states lead to the same blocks: the partition is stable.'}
                      </p>
                    </li>
                  ))}
                </ol>
              </Card>
              <Card title={`Minimal DFA (${r.dfa.names.length} states, from ${r.originalCount})`}>
                <AutomatonPreview automaton={dfaToAutomaton(r.dfa)} name="Minimal DFA" height="h-80" />
                <p className="mt-3 text-sm text-muted">
                  {r.dfa.names.length === input.names.length && r.removedUnreachable.length === 0 && !r.addedDeadState
                    ? 'The DFA was already minimal: no two states are equivalent.'
                    : 'Each block of the final partition became one state.'}
                </p>
              </Card>
            </div>
          </div>
        );
      }}
    </Guard>
  );
}
