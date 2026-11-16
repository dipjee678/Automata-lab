/**
 * Regular expressions in textbook notation.
 *
 *   union          r|s   or   r+s      (lowest precedence)
 *   concatenation  rs
 *   Kleene star    r*
 *   optional       r?                  (shorthand for r|ε)
 *   grouping       (r)
 *   empty string   ε     (also: ϵ, λ)
 *   empty language ∅
 *   escape         \c    literal c, e.g. \+  \*  \(
 *
 * NOTE: following the convention of automata-theory textbooks, `+` is UNION,
 * not "one or more". Write aa* for one or more a's.
 */
import type { Automaton, State, Transition } from '@automata/shared';
import { simulateFA, type FATrace } from './fa';
import { minimizeDfa, subsetConstruction, type Dfa } from './dfa';
import { layeredLayout } from './layout';

export type RegexNode =
  | { type: 'empty' }
  | { type: 'epsilon' }
  | { type: 'symbol'; value: string }
  | { type: 'union'; left: RegexNode; right: RegexNode }
  | { type: 'concat'; left: RegexNode; right: RegexNode }
  | { type: 'star'; inner: RegexNode }
  | { type: 'optional'; inner: RegexNode };

export class RegexSyntaxError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message);
    this.name = 'RegexSyntaxError';
  }
}

const EPSILON_CHARS = new Set(['ε', 'ϵ', 'λ']);
const SPECIAL = new Set(['(', ')', '|', '+', '*', '?', '\\']);

/** Recursive-descent parser. Grammar:
 *    union  := concat (('|' | '+') concat)*
 *    concat := postfix*
 *    postfix:= atom ('*' | '?')*
 *    atom   := symbol | ε | ∅ | '\' char | '(' union ')'
 */
export function parseRegex(source: string): RegexNode {
  const chars = [...source];
  let pos = 0;

  const skipSpace = () => {
    while (pos < chars.length && /\s/.test(chars[pos]!)) pos++;
  };
  const peek = () => {
    skipSpace();
    return chars[pos];
  };

  const parseUnion = (): RegexNode => {
    let node = parseConcat();
    for (let c = peek(); c === '|' || c === '+'; c = peek()) {
      const opPos = pos++;
      const next = peek();
      if (next === undefined || next === ')' || next === '|' || next === '+')
        throw new RegexSyntaxError(`Operator "${c}" at position ${opPos + 1} is missing its right operand. Use ε for the empty string.`, opPos);
      node = { type: 'union', left: node, right: parseConcat() };
    }
    return node;
  };

  const parseConcat = (): RegexNode => {
    let node: RegexNode | null = null;
    for (let c = peek(); c !== undefined && c !== ')' && c !== '|' && c !== '+'; c = peek()) {
      const next = parsePostfix();
      node = node ? { type: 'concat', left: node, right: next } : next;
    }
    if (!node) {
      const c = peek();
      throw new RegexSyntaxError(
        c === undefined
          ? 'Unexpected end of expression. Use ε for the empty string.'
          : `Unexpected "${c}" at position ${pos + 1}: an operand is missing before it.`,
        pos,
      );
    }
    return node;
  };

  const parsePostfix = (): RegexNode => {
    let node = parseAtom();
    for (let c = peek(); c === '*' || c === '?'; c = peek()) {
      pos++;
      node = c === '*' ? { type: 'star', inner: node } : { type: 'optional', inner: node };
    }
    return node;
  };

  const parseAtom = (): RegexNode => {
    const c = peek();
    if (c === undefined) throw new RegexSyntaxError('Unexpected end of expression.', pos);
    if (c === '(') {
      const open = pos++;
      if (peek() === ')') throw new RegexSyntaxError(`Empty parentheses at position ${open + 1}. Use ε for the empty string.`, open);
      const node = parseUnion();
      if (peek() !== ')') throw new RegexSyntaxError(`Parenthesis opened at position ${open + 1} is never closed.`, open);
      pos++;
      return node;
    }
    if (c === '*' || c === '?') throw new RegexSyntaxError(`"${c}" at position ${pos + 1} has nothing to apply to.`, pos);
    if (c === '\\') {
      pos++;
      const lit = chars[pos];
      if (lit === undefined) throw new RegexSyntaxError('A backslash at the end of the expression escapes nothing.', pos - 1);
      pos++;
      return { type: 'symbol', value: lit };
    }
    pos++;
    if (EPSILON_CHARS.has(c)) return { type: 'epsilon' };
    if (c === '∅') return { type: 'empty' };
    return { type: 'symbol', value: c };
  };

  if (peek() === undefined) throw new RegexSyntaxError('The expression is empty. Use ε for the empty string or ∅ for the empty language.', 0);
  const ast = parseUnion();
  if (peek() === ')') throw new RegexSyntaxError(`Unmatched ")" at position ${pos + 1}.`, pos);
  return ast;
}

/** Validate without throwing. */
export function validateRegex(source: string): { ok: true; ast: RegexNode } | { ok: false; error: string; position: number } {
  try {
    return { ok: true, ast: parseRegex(source) };
  } catch (e) {
    if (e instanceof RegexSyntaxError) return { ok: false, error: e.message, position: e.position };
    throw e;
  }
}

export function regexAlphabet(node: RegexNode, out = new Set<string>()): Set<string> {
  switch (node.type) {
    case 'symbol':
      out.add(node.value);
      break;
    case 'union':
    case 'concat':
      regexAlphabet(node.left, out);
      regexAlphabet(node.right, out);
      break;
    case 'star':
    case 'optional':
      regexAlphabet(node.inner, out);
      break;
  }
  return out;
}

/** Pretty-print an AST back to a string with minimal parentheses. */
export function regexToString(node: RegexNode): string {
  const prec = (n: RegexNode) => (n.type === 'union' ? 0 : n.type === 'concat' ? 1 : 2);
  const wrap = (n: RegexNode, min: number) => (prec(n) < min ? `(${regexToString(n)})` : regexToString(n));
  switch (node.type) {
    case 'empty':
      return '∅';
    case 'epsilon':
      return 'ε';
    case 'symbol':
      return SPECIAL.has(node.value) || EPSILON_CHARS.has(node.value) || node.value === '∅' ? `\\${node.value}` : node.value;
    case 'union':
      return `${wrap(node.left, 0)}|${wrap(node.right, 0)}`;
    case 'concat':
      return `${wrap(node.left, 1)}${wrap(node.right, 1)}`;
    case 'star':
      return `${wrap(node.inner, 2)}*`;
    case 'optional':
      return `${wrap(node.inner, 2)}?`;
  }
}

/* ------------------------------------------------------------------ */
/* Thompson's construction                                             */
/* ------------------------------------------------------------------ */

export interface ThompsonStep {
  /** Sub-expression this fragment was built for. */
  expression: string;
  rule: string;
  start: string;
  accept: string;
}

/**
 * Thompson's construction: build an ε-NFA with exactly one start and one
 * accepting state for every sub-expression, bottom-up.
 */
export function regexToEnfa(source: string | RegexNode): { automaton: Automaton; steps: ThompsonStep[] } {
  const ast = typeof source === 'string' ? parseRegex(source) : source;
  let count = 0;
  const edges: Array<{ from: number; to: number; symbol: string }> = [];
  const steps: ThompsonStep[] = [];
  const fresh = () => count++;
  const eps = (from: number, to: number) => edges.push({ from, to, symbol: '' });

  const build = (node: RegexNode): [number, number] => {
    let s: number;
    let f: number;
    let rule: string;
    switch (node.type) {
      case 'empty':
        s = fresh();
        f = fresh();
        rule = 'Empty language: two states with no connecting transition.';
        break;
      case 'epsilon':
        s = fresh();
        f = fresh();
        eps(s, f);
        rule = 'Empty string: a single ε-transition.';
        break;
      case 'symbol':
        s = fresh();
        f = fresh();
        edges.push({ from: s, to: f, symbol: node.value });
        rule = `Symbol: one transition labelled "${node.value}".`;
        break;
      case 'concat': {
        const [s1, f1] = build(node.left);
        const [s2, f2] = build(node.right);
        eps(f1, s2);
        s = s1;
        f = f2;
        rule = 'Concatenation: ε-link the accept of the left part to the start of the right part.';
        break;
      }
      case 'union': {
        const [s1, f1] = build(node.left);
        const [s2, f2] = build(node.right);
        s = fresh();
        f = fresh();
        eps(s, s1);
        eps(s, s2);
        eps(f1, f);
        eps(f2, f);
        rule = 'Union: new start with ε to both branches; both branches ε to a new accept.';
        break;
      }
      case 'star': {
        const [s1, f1] = build(node.inner);
        s = fresh();
        f = fresh();
        eps(s, s1);
        eps(s, f);
        eps(f1, s1);
        eps(f1, f);
        rule = 'Star: new start/accept; ε to skip the body, ε to loop back and repeat it.';
        break;
      }
      case 'optional': {
        const [s1, f1] = build(node.inner);
        s = fresh();
        f = fresh();
        eps(s, s1);
        eps(s, f);
        eps(f1, f);
        rule = 'Optional: new start/accept; ε to skip the body.';
        break;
      }
    }
    steps.push({ expression: regexToString(node), rule, start: `q${s}`, accept: `q${f}` });
    return [s, f];
  };

  const [start, accept] = build(ast);
  const pos = layeredLayout(
    count,
    edges.map((e) => [e.from, e.to]),
    start,
  );
  const states: State[] = Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    label: `q${i}`,
    x: pos[i]!.x,
    y: pos[i]!.y,
    initial: i === start,
    accepting: i === accept,
  }));
  const transitions: Transition[] = edges.map((e, i) => ({ id: `t${i}`, from: `s${e.from}`, to: `s${e.to}`, symbol: e.symbol }));
  return { automaton: { type: 'ENFA', states, transitions, alphabet: [...regexAlphabet(ast)].sort() }, steps };
}

/** Regex -> minimal complete DFA over (its own alphabet ∪ extraAlphabet). */
export function regexToDfa(source: string, extraAlphabet: string[] = []): Dfa {
  const { automaton } = regexToEnfa(source);
  const min = minimizeDfa(subsetConstruction(automaton, extraAlphabet).dfa).dfa;
  return { ...min, names: min.names.map((_, i) => `q${i}`) };
}

/* ------------------------------------------------------------------ */
/* Matching with explanation                                           */
/* ------------------------------------------------------------------ */

export interface RegexMatchResult {
  accepted: boolean;
  explanation: string;
  trace: FATrace;
  automaton: Automaton;
}

/** Test whether the WHOLE string belongs to the language of the expression. */
export function matchRegex(source: string, input: string): RegexMatchResult {
  const { automaton } = regexToEnfa(source);
  const trace = simulateFA(automaton, input);
  const shown = input === '' ? 'ε (the empty string)' : `"${input}"`;
  const sigma = new Set(automaton.alphabet);
  let explanation: string;
  if (trace.accepted) {
    explanation = `${shown} is in the language: after reading all ${trace.input.length} symbol(s) the equivalent NFA is in an accepting state.`;
  } else if (trace.stuckAt !== null) {
    const c = trace.input[trace.stuckAt]!;
    const prefix = trace.input.slice(0, trace.stuckAt).join('');
    explanation = !sigma.has(c)
      ? `${shown} is not in the language: the symbol "${c}" at position ${trace.stuckAt + 1} does not occur in the expression at all.`
      : `${shown} is not in the language: after the prefix "${prefix}" the expression does not allow "${c}" (position ${trace.stuckAt + 1}).`;
  } else {
    explanation = `${shown} is not in the language: every symbol can be read, but the string ends at a point where the expression is not yet complete (no accepting state is active).`;
  }
  return { accepted: trace.accepted, explanation, trace, automaton };
}
