/**
 * Context-free grammars: parsing of the textual notation, exact membership
 * testing, parse trees and leftmost derivations.
 *
 * Notation (one rule per line):
 *     S -> aSb | ε
 *     A -> aA | b
 *  - Nonterminals are single UPPERCASE letters; every other character is a terminal.
 *  - Alternatives are separated by `|`. The arrow may be written `->` or `→`.
 *  - ε (or an empty alternative, or the word `eps`) is the empty string.
 *  - The head of the first rule is the start symbol.
 *  - Lines starting with `#` or `//` are comments.
 */
import type { Grammar, Production } from '@automata/shared';
import { boundedLengthFor, shortlex } from './util';

export interface GrammarParseResult {
  grammar: Grammar | null;
  errors: string[];
  warnings: string[];
}

const isNonterminal = (c: string) => /^[A-Z]$/.test(c);
const EPSILON_WORDS = new Set(['', 'ε', 'ϵ', 'λ', 'eps', 'epsilon']);

export function parseGrammar(text: string, startSymbol?: string): GrammarParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const productions: Production[] = [];
  const heads: string[] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const m = line.match(/^(.*?)(->|→|::=)(.*)$/);
    if (!m) {
      errors.push(`Line ${i + 1}: expected a rule of the form "A -> α | β".`);
      return;
    }
    const head = m[1]!.trim();
    if (!isNonterminal(head)) {
      errors.push(`Line ${i + 1}: the left-hand side "${head}" must be a single uppercase letter (a nonterminal).`);
      return;
    }
    if (!heads.includes(head)) heads.push(head);
    for (const altRaw of m[3]!.split('|')) {
      const alt = altRaw.replace(/\s+/g, '');
      const body = EPSILON_WORDS.has(alt) ? [] : [...alt].filter((c) => !EPSILON_WORDS.has(c));
      const key = `${head}→${body.join('')}`;
      if (seen.has(key)) continue; // ignore exact duplicates
      seen.add(key);
      productions.push({ head, body });
    }
  });

  if (productions.length === 0 && errors.length === 0) errors.push('The grammar has no productions.');
  if (errors.length) return { grammar: null, errors, warnings };

  const start = startSymbol?.trim() || heads[0]!;
  if (!heads.includes(start)) errors.push(`The start symbol "${start}" has no productions.`);

  const terminals = new Set<string>();
  const used = new Set<string>();
  for (const p of productions)
    for (const s of p.body) {
      if (isNonterminal(s)) used.add(s);
      else terminals.add(s);
    }
  for (const nt of used) if (!heads.includes(nt)) warnings.push(`Nonterminal ${nt} is used but has no productions, so it can never be rewritten.`);

  if (errors.length) return { grammar: null, errors, warnings };
  const nonterminals = [...new Set([...heads, ...used])];
  const grammar: Grammar = { start, nonterminals, terminals: [...terminals].sort(), productions };

  // Reachability / productivity diagnostics (warnings only).
  const reachable = new Set([start]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of productions)
      if (reachable.has(p.head))
        for (const s of p.body)
          if (isNonterminal(s) && !reachable.has(s)) {
            reachable.add(s);
            changed = true;
          }
  }
  const unreachable = heads.filter((h) => !reachable.has(h));
  if (unreachable.length) warnings.push(`Unreachable from ${start}: ${unreachable.join(', ')}.`);
  const productive = productiveNonterminals(grammar);
  const dead = heads.filter((h) => !productive.has(h));
  if (dead.length) warnings.push(`Never derive a terminal string (non-productive): ${dead.join(', ')}.`);
  if (!productive.has(start)) warnings.push('The start symbol derives no terminal string: the language is empty.');

  return { grammar, errors, warnings };
}

/** Nonterminals that derive at least one terminal string. */
export function productiveNonterminals(g: Grammar): Set<string> {
  const productive = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of g.productions)
      if (!productive.has(p.head) && p.body.every((s) => !isNonterminal(s) || productive.has(s))) {
        productive.add(p.head);
        changed = true;
      }
  }
  return productive;
}

export const productionToString = (p: Production) => `${p.head} → ${p.body.length ? p.body.join('') : 'ε'}`;

/* ------------------------------------------------------------------ */
/* Exact membership + parse tree                                       */
/* ------------------------------------------------------------------ */

export interface ParseNode {
  symbol: string;
  /** null for terminal / ε leaves. */
  children: ParseNode[] | null;
}

export interface CfgParseResult {
  accepted: boolean;
  tree: ParseNode | null;
  /** Leftmost derivation: sentential forms from the start symbol to the string. */
  derivation: Array<{ form: string; rule: string | null }>;
}

interface Entry {
  production: Production;
  /** Boundaries p0..pk with body symbol m spanning [p[m], p[m+1]). */
  splits: number[];
}

/**
 * EXACT membership test for an arbitrary CFG (ε-rules, unit rules and left
 * recursion are all fine), by span-based dynamic programming – a
 * generalisation of CYK that does not require Chomsky normal form.
 *
 * derives(A, i, j) is true iff A ⇒* input[i..j). Spans are processed by
 * increasing length; inside one length we iterate to a fixpoint because
 * ε-rules and unit rules can make spans of the same length depend on each
 * other. Each fact stores the production and split points that FIRST proved
 * it, which only reference facts proved earlier – so reading a parse tree
 * back out is well-founded even for cyclic grammars.
 *
 * Time O(|G| · n³) for bounded rule length; inputs are limited to 200 symbols.
 */
export function parseCfg(g: Grammar, input: string): CfgParseResult {
  const w = [...input];
  const n = w.length;
  if (n > 200) throw new Error('Input is too long for the CFG parser (limit: 200 symbols).');
  const table = new Map<string, Entry>();
  const key = (A: string, i: number, j: number) => `${A}|${i}|${j}`;
  const byHead = new Map<string, Production[]>();
  for (const p of g.productions) (byHead.get(p.head) ?? byHead.set(p.head, []).get(p.head)!).push(p);

  /** Find boundaries so that body[m..] derives input[pos..j). */
  const matchBody = (body: string[], i: number, j: number): number[] | null => {
    const failed = new Set<number>();
    const splits: number[] = [i];
    const go = (m: number, pos: number): boolean => {
      if (m === body.length) return pos === j;
      const memo = m * (n + 1) + pos;
      if (failed.has(memo)) return false;
      const sym = body[m]!;
      if (!isNonterminal(sym)) {
        if (pos < j && w[pos] === sym) {
          splits.push(pos + 1);
          if (go(m + 1, pos + 1)) return true;
          splits.pop();
        }
      } else {
        for (let q = pos; q <= j; q++) {
          if (!table.has(key(sym, pos, q))) continue;
          splits.push(q);
          if (go(m + 1, q)) return true;
          splits.pop();
        }
      }
      failed.add(memo);
      return false;
    };
    return go(0, i) ? splits : null;
  };

  for (let len = 0; len <= n; len++) {
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0; i + len <= n; i++) {
        const j = i + len;
        for (const p of g.productions) {
          const k = key(p.head, i, j);
          if (table.has(k)) continue;
          const splits = matchBody(p.body, i, j);
          if (splits) {
            table.set(k, { production: p, splits });
            changed = true;
          }
        }
      }
    }
  }

  if (!table.has(key(g.start, 0, n))) return { accepted: false, tree: null, derivation: [] };

  const build = (A: string, i: number, j: number): ParseNode => {
    const { production, splits } = table.get(key(A, i, j))!;
    if (production.body.length === 0) return { symbol: A, children: [{ symbol: 'ε', children: null }] };
    return {
      symbol: A,
      children: production.body.map((sym, m) =>
        isNonterminal(sym) ? build(sym, splits[m]!, splits[m + 1]!) : { symbol: sym, children: null },
      ),
    };
  };
  const tree = build(g.start, 0, n);
  return { accepted: true, tree, derivation: leftmostDerivation(tree) };
}

export const cfgAccepts = (g: Grammar, input: string): boolean => parseCfg(g, input).accepted;

/** Read the leftmost derivation off a parse tree. */
export function leftmostDerivation(tree: ParseNode): Array<{ form: string; rule: string | null }> {
  let frontier: ParseNode[] = [tree];
  const expanded = new Set<ParseNode>();
  const render = () =>
    frontier
      .filter((nd) => nd.symbol !== 'ε' || nd.children !== null)
      .map((nd) => nd.symbol)
      .join('') || 'ε';
  const out: Array<{ form: string; rule: string | null }> = [{ form: tree.symbol, rule: null }];
  for (;;) {
    const idx = frontier.findIndex((nd) => nd.children !== null && !expanded.has(nd));
    if (idx < 0) break;
    const node = frontier[idx]!;
    const children = node.children!;
    const rule = `${node.symbol} → ${children.map((c) => c.symbol).join('')}`;
    // Children that are nonterminals stay expandable; mark terminal leaves as done.
    frontier = [...frontier.slice(0, idx), ...children, ...frontier.slice(idx + 1)];
    expanded.add(node);
    out.push({ form: render(), rule });
  }
  return out;
}

/**
 * List the strings of the language up to a length bound by testing every
 * candidate string (bounded enumeration – the bound actually reached is
 * returned as `completeUpTo`).
 */
export function enumerateLanguage(g: Grammar, maxLen: number, cap = 4000): { strings: string[]; completeUpTo: number } {
  const completeUpTo = boundedLengthFor(g.terminals.length, maxLen, cap);
  const strings: string[] = [];
  for (const s of shortlex(g.terminals, completeUpTo)) if (cfgAccepts(g, s)) strings.push(s);
  return { strings, completeUpTo };
}
