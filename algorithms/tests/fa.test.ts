import { describe, expect, it } from 'vitest';
import { acceptsFA, buildAutomaton, epsilonClosure, parseTransitionLabel, simulateFA, validateAutomaton } from '../src';
import { aStarBStarCStar, allStrings, div3, endsIn01 } from './fixtures';

describe('DFA simulation', () => {
  it('accepts exactly the binary multiples of 3', () => {
    for (const s of allStrings(['0', '1'], 9)) {
      const value = s === '' ? 0 : parseInt(s, 2);
      expect(acceptsFA(div3, s), `string "${s}"`).toBe(value % 3 === 0);
    }
  });

  it('records one active state and one transition per step', () => {
    const trace = simulateFA(div3, '110');
    expect(trace.accepted).toBe(true);
    expect(trace.steps).toHaveLength(4);
    expect(trace.steps.map((s) => s.active.length)).toEqual([1, 1, 1, 1]);
    expect(trace.steps.slice(1).every((s) => s.transitions.length === 1)).toBe(true);
    const label = (id: string) => div3.states.find((s) => s.id === id)!.label;
    expect(trace.steps.map((s) => label(s.active[0]!))).toEqual(['r0', 'r1', 'r0', 'r0']);
  });

  it('rejects and reports where a partial DFA gets stuck', () => {
    const partial = buildAutomaton('DFA', { states: ['a', 'b'], initial: 'a', accepting: ['b'], transitions: [['a', 'x', 'b']] });
    const trace = simulateFA(partial, 'xx');
    expect(trace.accepted).toBe(false);
    expect(trace.stuckAt).toBe(1);
    expect(trace.message).toMatch(/no transition/i);
  });

  it('rejects symbols outside the alphabet', () => {
    expect(acceptsFA(div3, '12')).toBe(false);
  });

  it('handles the empty string', () => {
    expect(acceptsFA(div3, '')).toBe(true);
    expect(acceptsFA(endsIn01, '')).toBe(false);
  });
});

describe('NFA simulation', () => {
  it('tracks every active state', () => {
    const trace = simulateFA(endsIn01, '001');
    const label = (id: string) => endsIn01.states.find((s) => s.id === id)!.label;
    expect(trace.steps.map((s) => s.active.map(label))).toEqual([['q0'], ['q0', 'q1'], ['q0', 'q1'], ['q0', 'q2']]);
    expect(trace.accepted).toBe(true);
  });

  it('accepts exactly the strings ending in 01', () => {
    for (const s of allStrings(['0', '1'], 8)) expect(acceptsFA(endsIn01, s)).toBe(s.endsWith('01'));
  });
});

describe('epsilon closure and ε-NFA simulation', () => {
  const id = (label: string) => aStarBStarCStar.states.find((s) => s.label === label)!.id;
  const labels = (set: Set<string>) => [...set].map((x) => aStarBStarCStar.states.find((s) => s.id === x)!.label).sort();

  it('computes transitive closures', () => {
    expect(labels(epsilonClosure(aStarBStarCStar, [id('s0')]))).toEqual(['s0', 's1', 's2']);
    expect(labels(epsilonClosure(aStarBStarCStar, [id('s1')]))).toEqual(['s1', 's2']);
    expect(labels(epsilonClosure(aStarBStarCStar, [id('s2')]))).toEqual(['s2']);
    expect(labels(epsilonClosure(aStarBStarCStar, []))).toEqual([]);
  });

  it('terminates on ε-cycles', () => {
    const cyc = buildAutomaton('ENFA', {
      states: ['x', 'y', 'z'],
      initial: 'x',
      accepting: ['z'],
      transitions: [
        ['x', 'ε', 'y'],
        ['y', 'ε', 'x'],
        ['y', 'a', 'z'],
      ],
    });
    expect(epsilonClosure(cyc, [cyc.states[0]!.id]).size).toBe(2);
    expect(acceptsFA(cyc, 'a')).toBe(true);
    expect(acceptsFA(cyc, '')).toBe(false);
  });

  it('accepts a*b*c*', () => {
    for (const s of allStrings(['a', 'b', 'c'], 6)) expect(acceptsFA(aStarBStarCStar, s)).toBe(/^a*b*c*$/.test(s));
  });

  it('starts in the ε-closure of the initial state', () => {
    expect(simulateFA(aStarBStarCStar, '').steps[0]!.active).toHaveLength(3);
  });
});

describe('validation', () => {
  it('requires exactly one initial state', () => {
    const none = { ...div3, states: div3.states.map((s) => ({ ...s, initial: false })) };
    expect(validateAutomaton(none).errors.join()).toMatch(/initial/i);
    const two = { ...div3, states: div3.states.map((s) => ({ ...s, initial: true })) };
    expect(validateAutomaton(two).errors.join()).toMatch(/exactly one/i);
  });

  it('rejects an empty automaton', () => {
    expect(validateAutomaton({ type: 'DFA', states: [], transitions: [] }).errors).toHaveLength(1);
  });

  it('detects nondeterminism and ε-moves in a DFA', () => {
    expect(validateAutomaton(endsIn01, { as: 'DFA' }).errors.join()).toMatch(/nondeterminism/i);
    expect(validateAutomaton(aStarBStarCStar, { as: 'DFA' }).errors.join()).toMatch(/ε-transition/);
    expect(validateAutomaton(aStarBStarCStar, { as: 'NFA' }).errors.join()).toMatch(/ε-transition/);
    expect(validateAutomaton(aStarBStarCStar).errors).toEqual([]);
  });

  it('reports missing transitions as warning or error', () => {
    const partial = buildAutomaton('DFA', { states: ['a', 'b'], initial: 'a', accepting: ['b'], transitions: [['a', 'x', 'b']] });
    expect(validateAutomaton(partial).errors).toEqual([]);
    expect(validateAutomaton(partial).warnings.join()).toMatch(/missing/i);
    expect(validateAutomaton(partial, { requireComplete: true }).errors.join()).toMatch(/total/i);
    expect(validateAutomaton(partial, { alphabet: ['x', 'y'] }).warnings.join()).toMatch(/δ\(a, y\)/);
  });

  it('flags dangling transitions and unreachable states', () => {
    const dangling = { ...div3, transitions: [...div3.transitions, { id: 'bad', from: 's0', to: 'nope', symbol: '0' }] };
    expect(validateAutomaton(dangling).errors.join()).toMatch(/does not exist/);
    const extra = { ...div3, states: [...div3.states, { id: 'u', label: 'u', x: 0, y: 0 }] };
    expect(validateAutomaton(extra).warnings.join()).toMatch(/unreachable/i);
  });
});

describe('transition label parsing', () => {
  it('parses finite-automaton labels', () => {
    expect(parseTransitionLabel('DFA', '0, 1').parts.map((p) => p.symbol)).toEqual(['0', '1']);
    expect(parseTransitionLabel('ENFA', 'ε').parts).toEqual([{ symbol: '' }]);
    expect(parseTransitionLabel('DFA', 'ε').error).toBeTruthy();
    expect(parseTransitionLabel('DFA', 'ab').error).toMatch(/single symbol/);
    expect(parseTransitionLabel('NFA', '').error).toBeTruthy();
  });

  it('parses PDA labels', () => {
    expect(parseTransitionLabel('PDA', 'a, Z -> AZ').parts).toEqual([{ symbol: 'a', pop: 'Z', push: 'AZ' }]);
    expect(parseTransitionLabel('PDA', 'ε, ε → ε').parts).toEqual([{ symbol: '', pop: '', push: '' }]);
    expect(parseTransitionLabel('PDA', 'a, Z').error).toBeTruthy();
    expect(parseTransitionLabel('PDA', 'ab, Z -> Z').error).toBeTruthy();
  });

  it('parses Turing machine labels', () => {
    expect(parseTransitionLabel('TM', 'a -> b, r ; _ → _, L').parts).toEqual([
      { symbol: 'a', write: 'b', move: 'R' },
      { symbol: '_', write: '_', move: 'L' },
    ]);
    expect(parseTransitionLabel('TM', 'a -> b, X').error).toMatch(/L, R or S/);
  });
});
