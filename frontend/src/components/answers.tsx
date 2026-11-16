/**
 * Components for answering and reviewing questions: the per-type answer
 * editor, a read-only automaton preview, and the grading feedback card.
 */
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseGrammar, validateAutomaton, validateRegex } from '@automata/algorithms';
import { answerKindFor, automatonTypeFor, emptyAutomaton, type Answer, type Automaton, type AutomatonType, type GradeResult, type QuestionType } from '@automata/shared';
import { AutomatonEditor } from '../editor/AutomatonEditor';
import { SimulationPanel, type Highlight } from '../editor/SimulationPanel';
import { TYPE_NAMES } from '../lib/examples';
import { useWorkspace } from '../lib/stores';
import { Button, cx, MethodBadge, Notice, showInput, VerdictBadge } from './ui';

/* ------------------------------------------------------------------ */
/* Read-only preview                                                   */
/* ------------------------------------------------------------------ */

export function AutomatonPreview({ automaton, name, height = 'h-72', openable = true }: { automaton: Automaton; name?: string; height?: string; openable?: boolean }) {
  const navigate = useNavigate();
  // Remount when the content changes (the canvas reads its input once).
  const key = useMemo(() => JSON.stringify(automaton), [automaton]);
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className={height}>
        <AutomatonEditor key={key} initial={automaton} readOnly />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line bg-panel px-3 py-1.5 text-xs text-muted">
        <span>
          {TYPE_NAMES[automaton.type]} · {automaton.states.length} state{automaton.states.length === 1 ? '' : 's'} · {automaton.transitions.length} transition{automaton.transitions.length === 1 ? '' : 's'}
        </span>
        {openable && (
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => {
              const ws = useWorkspace.getState();
              if (ws.dirty && ws.automaton.states.length > 0 && !window.confirm('Replace the automaton currently open in the editor? Unsaved changes will be lost.')) return;
              ws.load(automaton, name ?? 'Untitled automaton', null);
              navigate('/editor');
            }}
          >
            Open in editor
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Answer editor                                                       */
/* ------------------------------------------------------------------ */

export const emptyAnswer = (type: QuestionType): Answer => {
  const kind = answerKindFor(type);
  if (kind === 'regex') return { kind, regex: '' };
  if (kind === 'grammar') return { kind, grammar: '' };
  return { kind, automaton: emptyAutomaton(automatonTypeFor(type)) };
};

export const REGEX_HELP = (
  <>
    Notation: <code className="font-mono">|</code> or <code className="font-mono">+</code> for union, juxtaposition for concatenation, <code className="font-mono">*</code> for star, <code className="font-mono">?</code> for optional,
    parentheses for grouping, <code className="font-mono">ε</code> for the empty string, <code className="font-mono">∅</code> for the empty language. Note that <code className="font-mono">+</code> means union here, as in textbooks.
  </>
);

export const GRAMMAR_HELP = (
  <>
    One rule per line, e.g. <code className="font-mono">S -&gt; aSb | ε</code>. Nonterminals are single uppercase letters; every other character is a terminal. The first rule's head is the start symbol.
  </>
);

/** Is this answer worth sending? Returns a reason when it is not. */
export function answerProblem(answer: Answer): string | null {
  if (answer.kind === 'regex') return answer.regex.trim() ? null : 'Enter a regular expression first.';
  if (answer.kind === 'grammar') return answer.grammar.trim() ? null : 'Enter a grammar first.';
  return answer.automaton.states.length ? null : 'Draw an automaton first.';
}

interface AnswerEditorProps {
  type: QuestionType;
  value: Answer;
  onChange: (answer: Answer) => void;
  /** Change to reset the canvas (e.g. when switching question or loading an earlier attempt). */
  resetKey: string | number;
  /** Lets NFA questions pick NFA vs ε-NFA; other types are fixed. */
  allowSimulation?: boolean;
}

export function AnswerEditor({ type, value, onChange, resetKey, allowSimulation = true }: AnswerEditorProps) {
  const [highlight, setHighlight] = useState<Highlight>({ states: [], transitions: [] });
  const [showSim, setShowSim] = useState(false);

  if (value.kind === 'regex') {
    const v = value.regex.trim() ? validateRegex(value.regex) : null;
    return (
      <div className="space-y-2">
        <label className="label" htmlFor="answer-regex">
          Your regular expression
        </label>
        <input id="answer-regex" className="input font-mono text-base" value={value.regex} spellCheck={false} autoComplete="off" placeholder="(0|1)*01" onChange={(e) => onChange({ kind: 'regex', regex: e.target.value })} />
        {v && !v.ok ? <Notice tone="error">{v.error}</Notice> : <p className="text-xs text-muted">{REGEX_HELP}</p>}
        <SymbolButtons symbols={['ε', '∅', '|', '*']} onInsert={(s) => onChange({ kind: 'regex', regex: value.regex + s })} />
      </div>
    );
  }

  if (value.kind === 'grammar') {
    const parsed = value.grammar.trim() ? parseGrammar(value.grammar) : null;
    return (
      <div className="space-y-2">
        <label className="label" htmlFor="answer-grammar">
          Your grammar
        </label>
        <textarea id="answer-grammar" className="input h-40 resize-y font-mono text-sm" value={value.grammar} spellCheck={false} placeholder={'S -> aSb | ε'} onChange={(e) => onChange({ kind: 'grammar', grammar: e.target.value })} />
        {parsed?.errors.length ? (
          <Notice tone="error">
            {parsed.errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </Notice>
        ) : (
          <p className="text-xs text-muted">{GRAMMAR_HELP}</p>
        )}
        {parsed?.warnings.map((w, i) => (
          <Notice key={i} tone="warn">
            {w}
          </Notice>
        ))}
        <SymbolButtons symbols={['ε', '→', '|']} onInsert={(s) => onChange({ kind: 'grammar', grammar: value.grammar + s })} />
      </div>
    );
  }

  const automaton = value.automaton;
  const setType = (t: AutomatonType) => onChange({ kind: 'automaton', automaton: { ...automaton, type: t, transitions: t === 'ENFA' ? automaton.transitions : automaton.transitions.filter((x) => x.symbol !== '') } });
  const problems = automaton.states.length ? validateAutomaton(automaton, { as: type === 'nfa_construct' ? 'ENFA' : automatonTypeFor(type) }) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label !mb-0">Your {TYPE_NAMES[automatonTypeFor(type) === 'ENFA' ? automaton.type : automatonTypeFor(type)]}</span>
        <div className="flex items-center gap-2">
          {type === 'nfa_construct' && (
            <select className="input !w-auto !py-1 text-xs" aria-label="Automaton kind" value={automaton.type} onChange={(e) => setType(e.target.value as AutomatonType)}>
              <option value="ENFA">ε-NFA (ε-transitions allowed)</option>
              <option value="NFA">NFA</option>
              <option value="DFA">DFA</option>
            </select>
          )}
          {allowSimulation && (
            <Button size="sm" onClick={() => setShowSim((s) => !s)} aria-expanded={showSim}>
              {showSim ? 'Hide simulator' : 'Try a string'}
            </Button>
          )}
        </div>
      </div>
      <div className={cx('grid gap-3', showSim && 'lg:grid-cols-[1fr_20rem]')}>
        <div className="h-[26rem] overflow-hidden rounded-md border border-line bg-surface">
          {/* The key includes the machine type because the canvas fixes its type at mount. */}
          <AutomatonEditor key={`${resetKey}:${automaton.type}`} initial={automaton} onChange={(a) => onChange({ kind: 'automaton', automaton: a })} highlight={highlight} />
        </div>
        {showSim && (
          <div className="rounded-md border border-line bg-panel p-3">
            <SimulationPanel automaton={automaton} onHighlight={setHighlight} />
          </div>
        )}
      </div>
      {problems?.errors.map((e, i) => (
        <Notice key={i} tone="warn">
          {e}
        </Notice>
      ))}
    </div>
  );
}

function SymbolButtons({ symbols, onInsert }: { symbols: string[]; onInsert: (s: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">Insert:</span>
      {symbols.map((s) => (
        <Button key={s} size="sm" className="font-mono" onClick={() => onInsert(s === '→' ? ' → ' : s)} aria-label={`Insert ${s}`}>
          {s}
        </Button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Read-only answer + feedback                                         */
/* ------------------------------------------------------------------ */

export function AnswerView({ answer }: { answer: Answer }) {
  if (answer.kind === 'regex') return <pre className="overflow-x-auto rounded-md border border-line bg-raised/50 p-3 font-mono text-sm">{answer.regex || '(empty)'}</pre>;
  if (answer.kind === 'grammar') return <pre className="overflow-x-auto rounded-md border border-line bg-raised/50 p-3 font-mono text-sm">{answer.grammar || '(empty)'}</pre>;
  if (answer.automaton.states.length === 0) return <p className="text-sm text-muted">(empty automaton)</p>;
  return <AutomatonPreview automaton={answer.automaton} height="h-64" />;
}

type FeedbackLike = Pick<GradeResult, 'verdict' | 'exact' | 'method' | 'feedback' | 'counterexample'> & { score: number; maxScore: number };

/** The result of grading: verdict, score, method label, counterexample and explanations. */
export function GradeFeedback({ result, note }: { result: FeedbackLike; note?: string | null }) {
  const tone = result.verdict === 'correct' ? 'border-emerald-400/60' : result.verdict === 'partial' ? 'border-amber-400/60' : 'border-red-400/60';
  const ce = result.counterexample;
  return (
    <div className={cx('rounded-lg border-2 bg-panel p-4', tone)} data-testid="grade-feedback">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={result.verdict} />
        <MethodBadge exact={result.exact} />
        <span className="ml-auto text-lg font-semibold tabular-nums" data-testid="grade-score">
          {result.score} / {result.maxScore}
        </span>
      </div>
      {ce && (
        <div className="mt-3 rounded-md bg-raised px-3 py-2 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Counterexample</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-base font-semibold" data-testid="counterexample">
              {showInput(ce.input)}
            </code>
            <span className="text-muted">
              expected: <strong className="text-ink">{ce.expected ? 'accept' : 'reject'}</strong> · your answer: <strong className="text-ink">{ce.actual ? 'accepts' : 'rejects'}</strong>
            </span>
          </div>
        </div>
      )}
      <ul className="mt-3 space-y-1.5 text-sm">
        {result.feedback.map((line, i) => (
          <li key={i} className={cx(i === 0 && 'font-medium')}>
            {line}
          </li>
        ))}
      </ul>
      {note && (
        <div className="mt-3">
          <Notice>
            <span className="font-medium">Teacher's note:</span> {note}
          </Notice>
        </div>
      )}
      <p className="mt-3 border-t border-line pt-2 text-xs text-muted">Method: {result.method}</p>
    </div>
  );
}
