import { useMemo, useState } from 'react';
import { boundedCompare, cfgAccepts, enumerateLanguage, parseCfg, parseGrammar, productionToString, type ParseNode } from '@automata/algorithms';
import { GRAMMAR_HELP } from '../components/answers';
import { Badge, Card, Field, Notice, PageHeader, showInput } from '../components/ui';

const SAMPLES: Array<{ name: string; text: string; input: string }> = [
  { name: 'aⁿbⁿ', text: 'S -> aSb | ε', input: 'aabb' },
  { name: 'Palindromes', text: 'S -> aSa | bSb | a | b | ε', input: 'abba' },
  { name: 'Balanced parentheses', text: 'S -> SS | (S) | ε', input: '(()())' },
  { name: 'Arithmetic', text: 'E -> E+T | T\nT -> T*F | F\nF -> (E) | x', input: 'x+x*x' },
];

/* ---- parse tree drawing ---- */

interface Placed {
  node: ParseNode;
  x: number;
  y: number;
  children: Placed[];
}

/** Classic tidy layout: leaves get consecutive columns, parents sit above the middle of their children. */
function layoutTree(root: ParseNode): { placed: Placed; width: number; height: number } {
  let column = 0;
  let depthMax = 0;
  const place = (node: ParseNode, depth: number): Placed => {
    depthMax = Math.max(depthMax, depth);
    const children = (node.children ?? []).map((c) => place(c, depth + 1));
    const x = children.length ? (children[0]!.x + children[children.length - 1]!.x) / 2 : column++ * 38 + 24;
    return { node, x, y: depth * 54 + 22, children };
  };
  const placed = place(root, 0);
  return { placed, width: Math.max(column * 38 + 10, 60), height: depthMax * 54 + 46 };
}

function ParseTree({ tree }: { tree: ParseNode }) {
  const { placed, width, height } = useMemo(() => layoutTree(tree), [tree]);
  const lines: JSX.Element[] = [];
  const nodes: JSX.Element[] = [];
  const walk = (p: Placed, key: string) => {
    p.children.forEach((c, i) => {
      lines.push(<line key={`l${key}.${i}`} x1={p.x} y1={p.y + 12} x2={c.x} y2={c.y - 12} stroke="var(--edge)" strokeWidth="1.2" />);
      walk(c, `${key}.${i}`);
    });
    const leaf = p.node.children === null;
    nodes.push(
      <g key={`n${key}`}>
        {!leaf && <circle cx={p.x} cy={p.y} r="13" fill="var(--state-fill)" stroke="var(--state-stroke)" strokeWidth="1.4" />}
        <text
          x={p.x}
          y={p.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-monospace, Consolas, monospace"
          fontSize="13"
          fontWeight={leaf ? 700 : 600}
          fill={leaf ? (p.node.symbol === 'ε' ? 'rgb(var(--muted))' : 'var(--active)') : 'rgb(var(--ink))'}
        >
          {p.node.symbol}
        </text>
      </g>,
    );
  };
  walk(placed, '0');
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface p-2">
      <svg width={width} height={height} role="img" aria-label="Parse tree" className="mx-auto block">
        {lines}
        {nodes}
      </svg>
    </div>
  );
}

/* ---- page ---- */

export function GrammarPage() {
  const [text, setText] = useState(SAMPLES[0]!.text);
  const [input, setInput] = useState(SAMPLES[0]!.input);
  const [maxLen, setMaxLen] = useState(6);
  const [other, setOther] = useState('');

  const parsed = useMemo(() => parseGrammar(text), [text]);
  const g = parsed.grammar;

  const result = useMemo(() => {
    if (!g) return null;
    try {
      return { ...parseCfg(g, input), error: null as string | null };
    } catch (e) {
      return { accepted: false, tree: null, derivation: [], error: e instanceof Error ? e.message : 'Parsing failed.' };
    }
  }, [g, input]);

  const language = useMemo(() => (g ? enumerateLanguage(g, maxLen, 3000) : null), [g, maxLen]);

  const otherParsed = useMemo(() => (other.trim() ? parseGrammar(other) : null), [other]);
  const comparison = useMemo(() => {
    if (!g || !otherParsed?.grammar) return null;
    const h = otherParsed.grammar;
    const sigma = [...new Set([...g.terminals, ...h.terminals])];
    return boundedCompare((s) => cfgAccepts(g, s), (s) => cfgAccepts(h, s), sigma, 8, 2500);
  }, [g, otherParsed]);

  return (
    <>
      <PageHeader title="Context-free grammar laboratory" subtitle="Write a grammar, test strings, and see leftmost derivations and parse trees." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Grammar"
          actions={
            <select
              className="input !w-auto !py-1 text-xs"
              aria-label="Load a sample grammar"
              value=""
              onChange={(e) => {
                const s = SAMPLES.find((x) => x.name === e.target.value);
                if (s) {
                  setText(s.text);
                  setInput(s.input);
                }
              }}
            >
              <option value="">Samples…</option>
              {SAMPLES.map((s) => (
                <option key={s.name}>{s.name}</option>
              ))}
            </select>
          }
        >
          <textarea className="input h-44 resize-y font-mono text-sm" aria-label="Grammar productions" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
          <p className="mt-2 text-xs text-muted">{GRAMMAR_HELP}</p>
          <div className="mt-3 space-y-2">
            {parsed.errors.map((e, i) => (
              <Notice key={i} tone="error">
                {e}
              </Notice>
            ))}
            {parsed.warnings.map((w, i) => (
              <Notice key={i} tone="warn">
                {w}
              </Notice>
            ))}
          </div>
        </Card>

        <Card title="Structure">
          {g ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="label">Start symbol</dt>
                <dd className="font-mono font-semibold">{g.start}</dd>
              </div>
              <div>
                <dt className="label">Nonterminals</dt>
                <dd className="flex flex-wrap gap-1 font-mono">
                  {g.nonterminals.map((n) => (
                    <Badge key={n} tone="violet">
                      {n}
                    </Badge>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="label">Terminals</dt>
                <dd className="flex flex-wrap gap-1 font-mono">{g.terminals.length ? g.terminals.map((t) => <Badge key={t} tone="green">{t}</Badge>) : <span className="text-muted">none</span>}</dd>
              </div>
              <div>
                <dt className="label">Productions ({g.productions.length})</dt>
                <dd className="grid grid-cols-2 gap-x-4 font-mono sm:grid-cols-3">
                  {g.productions.map((p, i) => (
                    <span key={i}>{productionToString(p)}</span>
                  ))}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">Fix the errors in the grammar to see its structure.</p>
          )}
        </Card>
      </div>

      {g && (
        <>
          <div className="mt-4">
            <Card title="Test a string" actions={<Badge tone="violet" title="Membership is decided exactly by dynamic programming over all substrings (a CYK-style algorithm).">Exact membership</Badge>}>
              <input className="input font-mono" aria-label="Test string" value={input} spellCheck={false} placeholder="leave empty for ε" onChange={(e) => setInput(e.target.value.replace(/\s/g, ''))} />
              {result?.error && (
                <div className="mt-3">
                  <Notice tone="error">{result.error}</Notice>
                </div>
              )}
              {result && !result.error && (
                <div className="mt-3 space-y-4">
                  <Notice tone={result.accepted ? 'success' : 'error'}>
                    <span data-testid="cfg-result">
                      <strong>{result.accepted ? 'Generated.' : 'Not generated.'}</strong>{' '}
                      {result.accepted ? `${g.start} ⇒* ${showInput(input)}: the string is in the language.` : `No derivation of ${showInput(input)} from ${g.start} exists: the string is not in the language.`}
                    </span>
                  </Notice>
                  {result.accepted && result.tree && (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
                      <div>
                        <div className="label">Leftmost derivation</div>
                        <ol className="space-y-0.5 font-mono text-sm">
                          {result.derivation.map((d, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="w-5 shrink-0 text-right text-muted">{i === 0 ? '' : '⇒'}</span>
                              <span className="font-semibold">{d.form}</span>
                              {d.rule && <span className="ml-auto whitespace-nowrap text-xs text-muted">{d.rule}</span>}
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <div className="label">Parse tree</div>
                        <ParseTree tree={result.tree} />
                        <p className="mt-1 text-xs text-muted">One parse tree is shown. If the grammar is ambiguous, the string has others as well.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Strings of the language" actions={<Badge tone="blue">Bounded listing</Badge>}>
              <Field label={`Maximum length: ${maxLen}`}>
                <input type="range" min={0} max={10} value={maxLen} className="w-full" onChange={(e) => setMaxLen(Number(e.target.value))} />
              </Field>
              {language && (
                <>
                  <p className="my-2 text-sm text-muted">
                    {language.strings.length} string{language.strings.length === 1 ? '' : 's'} of length ≤ {language.completeUpTo}
                    {language.completeUpTo < maxLen && ` (the listing stops at length ${language.completeUpTo} to keep the number of candidates manageable)`}. Every candidate string up to that length was tested.
                  </p>
                  <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto font-mono">
                    {language.strings.slice(0, 300).map((s) => (
                      <button key={s} type="button" className="rounded border border-line px-1.5 py-0.5 text-xs hover:bg-raised" title="Use as test string" onClick={() => setInput(s)}>
                        {showInput(s)}
                      </button>
                    ))}
                    {language.strings.length === 0 && <span className="text-sm text-muted">No strings up to this length.</span>}
                  </div>
                </>
              )}
            </Card>

            <Card title="Compare with another grammar" actions={<Badge tone="blue">Bounded testing</Badge>}>
              <textarea className="input h-24 resize-y font-mono text-sm" aria-label="Second grammar" value={other} spellCheck={false} placeholder={'S -> aTb | ε\nT -> aTb | ε'} onChange={(e) => setOther(e.target.value)} />
              <div className="mt-3 space-y-2">
                {otherParsed?.errors.map((e, i) => (
                  <Notice key={i} tone="error">
                    {e}
                  </Notice>
                ))}
                {comparison &&
                  (comparison.firstDifference ? (
                    <Notice tone="error">
                      <strong>Different.</strong> <code className="rounded bg-panel px-1.5 py-0.5 font-mono font-semibold">{showInput(comparison.firstDifference.input)}</code> is{' '}
                      {comparison.firstDifference.expected ? 'generated by the first grammar but not by the second' : 'generated by the second grammar but not by the first'}.
                    </Notice>
                  ) : (
                    <Notice>
                      <strong>No difference found</strong> among all {comparison.tested} strings of length ≤ {comparison.testedLength}. This is evidence, not a proof.
                    </Notice>
                  ))}
                <p className="text-xs text-muted">
                  Equivalence of context-free grammars is undecidable in general, so no algorithm can always answer this question. This tool compares the two grammars on every string up to a length bound; a difference is definite, agreement is
                  only evidence.
                </p>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
