import { describe, expect, it } from 'vitest';
import { cfgAccepts, enumerateLanguage, parseCfg, parseGrammar, type ParseNode } from '../src';
import { allStrings } from './fixtures';

const grammar = (text: string) => {
  const r = parseGrammar(text);
  if (!r.grammar) throw new Error(r.errors.join('; '));
  return r.grammar;
};

/** Concatenate the leaves of a parse tree. */
const yieldOf = (n: ParseNode): string => (n.children === null ? (n.symbol === 'ε' ? '' : n.symbol) : n.children.map(yieldOf).join(''));

describe('grammar parsing', () => {
  it('reads productions, terminals, nonterminals and the start symbol', () => {
    const g = grammar('S -> aSb | ε\n# comment\nT → c');
    expect(g.start).toBe('S');
    expect(g.nonterminals).toEqual(['S', 'T']);
    expect(g.terminals).toEqual(['a', 'b', 'c']);
    expect(g.productions).toEqual([
      { head: 'S', body: ['a', 'S', 'b'] },
      { head: 'S', body: [] },
      { head: 'T', body: ['c'] },
    ]);
  });

  it('accepts several spellings of ε', () => {
    for (const eps of ['ε', 'eps', 'λ', '']) expect(grammar(`S -> a | ${eps}`).productions[1]!.body).toEqual([]);
  });

  it('reports syntax errors with line numbers', () => {
    expect(parseGrammar('S -> a\nnonsense').errors[0]).toMatch(/Line 2/);
    expect(parseGrammar('ab -> a').errors[0]).toMatch(/single uppercase letter/);
    expect(parseGrammar('').errors[0]).toMatch(/no productions/);
    expect(parseGrammar('S -> a', 'X').errors[0]).toMatch(/start symbol/);
  });

  it('warns about useless symbols', () => {
    const r = parseGrammar('S -> aA | b\nB -> b');
    expect(r.warnings.join()).toMatch(/A is used but has no productions/);
    expect(r.warnings.join()).toMatch(/Unreachable from S: B/);
    expect(parseGrammar('S -> S').warnings.join()).toMatch(/language is empty/);
  });
});

describe('membership and derivations', () => {
  it('recognises aⁿbⁿ', () => {
    const g = grammar('S -> aSb | ε');
    for (const s of allStrings(['a', 'b'], 8)) {
      const m = s.match(/^(a*)(b*)$/);
      expect(cfgAccepts(g, s), `"${s}"`).toBe(!!m && m[1]!.length === m[2]!.length);
    }
  });

  it('recognises balanced parentheses with a left-recursive, ambiguous grammar', () => {
    const g = grammar('S -> SS | (S) | ε');
    const balanced = (s: string) => {
      let d = 0;
      for (const c of s) {
        d += c === '(' ? 1 : -1;
        if (d < 0) return false;
      }
      return d === 0;
    };
    for (const s of allStrings(['(', ')'], 8)) expect(cfgAccepts(g, s), `"${s}"`).toBe(balanced(s));
  });

  it('recognises palindromes', () => {
    const g = grammar('S -> aSa | bSb | a | b | ε');
    for (const s of allStrings(['a', 'b'], 8)) expect(cfgAccepts(g, s)).toBe(s === [...s].reverse().join(''));
  });

  it('copes with unit-rule cycles and nullable chains', () => {
    const g = grammar('S -> A | a\nA -> B\nB -> S | AB | ε');
    expect(cfgAccepts(g, '')).toBe(true);
    expect(cfgAccepts(g, 'a')).toBe(true);
    expect(cfgAccepts(g, 'aaa')).toBe(true);
    expect(cfgAccepts(g, 'b')).toBe(false);
  });

  it('parses arithmetic expressions with correct precedence', () => {
    const g = grammar('E -> E+T | T\nT -> T*F | F\nF -> (E) | x');
    const r = parseCfg(g, 'x+x*x');
    expect(r.accepted).toBe(true);
    // Root must be E → E + T (multiplication binds tighter).
    expect(r.tree!.children!.map((c) => c.symbol)).toEqual(['E', '+', 'T']);
    expect(yieldOf(r.tree!)).toBe('x+x*x');
    expect(cfgAccepts(g, 'x+')).toBe(false);
    expect(cfgAccepts(g, '(x+x)*x')).toBe(true);
  });

  it('produces a valid leftmost derivation', () => {
    const g = grammar('S -> aSb | ε');
    const r = parseCfg(g, 'aabb');
    expect(r.derivation.map((d) => d.form)).toEqual(['S', 'aSb', 'aaSbb', 'aabb']);
    expect(r.derivation.map((d) => d.rule)).toEqual([null, 'S → aSb', 'S → aSb', 'S → ε']);
  });

  it('derives the empty string', () => {
    const r = parseCfg(grammar('S -> aSb | ε'), '');
    expect(r.accepted).toBe(true);
    expect(r.derivation.map((d) => d.form)).toEqual(['S', 'ε']);
  });

  it('returns no tree for strings outside the language', () => {
    expect(parseCfg(grammar('S -> aSb | ε'), 'abab')).toEqual({ accepted: false, tree: null, derivation: [] });
  });

  it('every parse tree yields its input', () => {
    const g = grammar('S -> SS | (S) | ε');
    for (const s of ['', '()', '(())()', '()()()', '((()))']) expect(yieldOf(parseCfg(g, s).tree!)).toBe(s);
  });

  it('enumerates the language up to a bound', () => {
    const { strings, completeUpTo } = enumerateLanguage(grammar('S -> aSb | ε'), 6);
    expect(completeUpTo).toBe(6);
    expect(strings).toEqual(['', 'ab', 'aabb', 'aaabbb']);
  });
});
