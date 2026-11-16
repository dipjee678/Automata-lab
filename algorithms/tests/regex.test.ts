import { describe, expect, it } from 'vitest';
import {
  acceptsFA,
  checkEquivalence,
  dfaAccepts,
  matchRegex,
  parseRegex,
  regexToDfa,
  regexToEnfa,
  regexToString,
  validateRegex,
  type RegexNode,
} from '../src';
import { allStrings, rng } from './fixtures';

describe('regular expression validation', () => {
  it.each(['a', 'ab', 'a|b', 'a+b', '(a|b)*abb', 'a*b?c', 'ε', '∅', '(0+1)*01', 'a | b', '\\+\\*', '((a))'])('accepts %s', (src) => {
    expect(validateRegex(src).ok).toBe(true);
  });

  it.each([
    ['', /empty/i],
    ['(', /end of expression|never closed/i],
    ['(a', /never closed/i],
    ['a)', /unmatched/i],
    ['*a', /nothing to apply/i],
    ['a||b', /missing/i],
    ['a|', /right operand/i],
    ['|a', /operand is missing/i],
    ['()', /empty parentheses/i],
    ['a\\', /backslash/i],
  ])('rejects %j', (src, pattern) => {
    const v = validateRegex(src);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.error).toMatch(pattern);
      expect(v.position).toBeGreaterThanOrEqual(0);
    }
  });

  it('applies the usual precedence: star > concatenation > union', () => {
    expect(parseRegex('ab*|c')).toEqual({
      type: 'union',
      left: { type: 'concat', left: { type: 'symbol', value: 'a' }, right: { type: 'star', inner: { type: 'symbol', value: 'b' } } },
      right: { type: 'symbol', value: 'c' },
    });
  });

  it('treats + as union (textbook notation)', () => {
    expect(parseRegex('a+b')).toEqual(parseRegex('a|b'));
  });

  it('round-trips through the pretty printer', () => {
    for (const src of ['(a|b)*abb', 'a(b|c)*d?', 'ε|a', '(ab)*', 'a|b|c', '\\+a']) {
      const ast = parseRegex(src);
      expect(parseRegex(regexToString(ast))).toEqual(ast);
    }
  });
});

describe('Thompson construction and matching', () => {
  it('builds an ε-NFA with one start and one accepting state', () => {
    const { automaton, steps } = regexToEnfa('(a|b)*abb');
    expect(automaton.states.filter((s) => s.initial)).toHaveLength(1);
    expect(automaton.states.filter((s) => s.accepting)).toHaveLength(1);
    expect(steps[steps.length - 1]!.expression).toBe('(a|b)*abb');
  });

  it.each([
    ['(a|b)*abb', /^(a|b)*abb$/],
    ['a*b?c', /^a*b?c$/],
    ['(ab|ba)*', /^(ab|ba)*$/],
    ['(a|ε)b', /^a?b$/],
    ['a(a|b)*a|a', /^(a(a|b)*a|a)$/],
    ['∅|b', /^b$/],
    ['a∅|b*', /^b*$/],
    ['ε', /^$/],
    ['(a*)*', /^a*$/],
  ])('%s matches the same strings as the JS engine', (src, js) => {
    const { automaton } = regexToEnfa(src);
    const dfa = regexToDfa(src, ['a', 'b', 'c']);
    for (const s of allStrings(['a', 'b', 'c'], 6)) {
      expect(acceptsFA(automaton, s), `ε-NFA on "${s}"`).toBe(js.test(s));
      expect(dfaAccepts(dfa, s), `DFA on "${s}"`).toBe(js.test(s));
    }
  });

  it('agrees with the JS engine on random expressions', () => {
    const rand = rng(5);
    const gen = (depth: number): RegexNode => {
      const r = rand();
      if (depth === 0 || r < 0.3) return rand() < 0.1 ? { type: 'epsilon' } : { type: 'symbol', value: rand() < 0.5 ? 'a' : 'b' };
      if (r < 0.55) return { type: 'concat', left: gen(depth - 1), right: gen(depth - 1) };
      if (r < 0.75) return { type: 'union', left: gen(depth - 1), right: gen(depth - 1) };
      if (r < 0.9) return { type: 'star', inner: gen(depth - 1) };
      return { type: 'optional', inner: gen(depth - 1) };
    };
    const toJs = (n: RegexNode): string => {
      switch (n.type) {
        case 'epsilon':
          return '(?:)';
        case 'empty':
          return '(?!)';
        case 'symbol':
          return n.value;
        case 'concat':
          return `(?:${toJs(n.left)})(?:${toJs(n.right)})`;
        case 'union':
          return `(?:${toJs(n.left)}|${toJs(n.right)})`;
        case 'star':
          return `(?:${toJs(n.inner)})*`;
        case 'optional':
          return `(?:${toJs(n.inner)})?`;
      }
    };
    const strings = allStrings(['a', 'b'], 6);
    for (let i = 0; i < 80; i++) {
      const ast = gen(4);
      const src = regexToString(ast);
      const js = new RegExp(`^(?:${toJs(ast)})$`);
      const dfa = regexToDfa(src, ['a', 'b']);
      for (const s of strings) expect(dfaAccepts(dfa, s), `${src} on "${s}"`).toBe(js.test(s));
    }
  });

  it('decides equivalence of expressions exactly', () => {
    const eq = (x: string, y: string) => checkEquivalence(regexToDfa(x), regexToDfa(y));
    expect(eq('(a|b)*', '(a*b*)*').equivalent).toBe(true);
    expect(eq('(ab)*a', 'a(ba)*').equivalent).toBe(true);
    expect(eq('a*', 'aa*')).toMatchObject({ equivalent: false, counterexample: '', inA: true, inB: false });
    expect(eq('(a|b)*', 'a*|b*')).toMatchObject({ equivalent: false, counterexample: 'ab' });
  });

  it('explains matching results', () => {
    expect(matchRegex('(a|b)*abb', 'aabb')).toMatchObject({ accepted: true });
    const stuck = matchRegex('ab', 'aa');
    expect(stuck.accepted).toBe(false);
    expect(stuck.explanation).toMatch(/position 2/);
    expect(matchRegex('ab', 'a').explanation).toMatch(/not yet complete/);
    expect(matchRegex('ab', 'ax').explanation).toMatch(/does not occur/);
    expect(matchRegex('a*', '').accepted).toBe(true);
  });
});
