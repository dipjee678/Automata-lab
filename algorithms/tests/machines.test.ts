import { describe, expect, it } from 'vitest';
import { buildAutomaton, simulatePda, simulateTm, validateAutomaton } from '../src';
import { allStrings, anbnPda, anbnTm } from './fixtures';

const isAnBn = (s: string) => {
  const m = s.match(/^(a*)(b*)$/);
  return !!m && m[1]!.length === m[2]!.length;
};

describe('PDA execution', () => {
  it('accepts exactly aⁿbⁿ', () => {
    for (const s of allStrings(['a', 'b'], 8)) {
      const r = simulatePda(anbnPda, s);
      expect(r.status, `"${s}"`).toBe(isAnBn(s) ? 'accepted' : 'rejected');
    }
  });

  it('records stack contents along the accepting run', () => {
    const r = simulatePda(anbnPda, 'aabb');
    expect(r.accepted).toBe(true);
    const stacks = r.path.map((c) => c.stack.join(''));
    expect(stacks).toEqual(['Z', 'AZ', 'AAZ', 'AAZ', 'AZ', 'Z', 'Z']);
    expect(r.path[0]!.transition).toBeNull();
    expect(r.path[1]!.action).toBe('push A');
    expect(r.path[4]!.action).toBe('pop A');
    expect(r.path[r.path.length - 1]!.position).toBe(4);
  });

  it('explores nondeterministic choices (even-length palindromes)', () => {
    const pal = buildAutomaton('PDA', {
      states: ['push', 'pop', 'done'],
      initial: 'push',
      accepting: ['done'],
      transitions: [
        ['push', 'a, ε → a ; b, ε → b', 'push'],
        ['push', 'ε, ε → ε', 'pop'],
        ['pop', 'a, a → ε ; b, b → ε', 'pop'],
        ['pop', 'ε, Z → ε', 'done'],
      ],
    });
    for (const s of allStrings(['a', 'b'], 8)) {
      const expected = s.length % 2 === 0 && s === [...s].reverse().join('');
      expect(simulatePda(pal, s).accepted, `"${s}"`).toBe(expected);
    }
  });

  it('pushes multi-symbol strings with the leftmost symbol on top', () => {
    const p = buildAutomaton('PDA', {
      states: ['s', 't'],
      initial: 's',
      accepting: ['t'],
      transitions: [
        ['s', 'x, Z → ABZ', 's'],
        ['s', 'y, A → ε', 't'],
      ],
    });
    expect(simulatePda(p, 'xy').path.map((c) => c.stack.join(''))).toEqual(['Z', 'ABZ', 'BZ']);
  });

  it('reports "limit" instead of looping forever on stack-growing ε-loops', () => {
    const loop = buildAutomaton('PDA', { states: ['s', 'f'], initial: 's', accepting: ['f'], transitions: [['s', 'ε, ε → A', 's']] });
    const r = simulatePda(loop, 'a', { maxConfigs: 500 });
    expect(r.status).toBe('limit');
    expect(r.accepted).toBe(false);
  });

  it('terminates on ε-loops that do not change the stack', () => {
    const loop = buildAutomaton('PDA', {
      states: ['s', 'u', 'f'],
      initial: 's',
      accepting: ['f'],
      transitions: [
        ['s', 'ε, ε → ε', 'u'],
        ['u', 'ε, ε → ε', 's'],
      ],
    });
    expect(simulatePda(loop, 'a').status).toBe('rejected');
  });
});

describe('Turing machine execution', () => {
  it('accepts exactly aⁿbⁿ', () => {
    for (const s of allStrings(['a', 'b'], 8)) expect(simulateTm(anbnTm, s).status, `"${s}"`).toBe(isAnBn(s) ? 'accepted' : 'rejected');
  });

  it('records tape, head and state at every step', () => {
    const r = simulateTm(anbnTm, 'ab');
    const label = (id: string) => anbnTm.states.find((s) => s.id === id)!.label;
    expect(r.steps.map((s) => `${label(s.state)}:${s.tape.join('')}@${s.head}`)).toEqual([
      'q0:ab@0',
      'q1:Xb@1',
      'q2:XY@0',
      'q0:XY@1',
      'q3:XY_@2',
      'acc:XY_@2',
    ]);
    expect(r.output).toBe('XY');
  });

  it('computes: binary increment', () => {
    const inc = buildAutomaton('TM', {
      states: ['right', 'carry', 'done'],
      initial: 'right',
      accepting: ['done'],
      transitions: [
        ['right', '0 → 0, R ; 1 → 1, R', 'right'],
        ['right', '_ → _, L', 'carry'],
        ['carry', '1 → 0, L', 'carry'],
        ['carry', '0 → 1, S ; _ → 1, S', 'done'],
      ],
    });
    for (const n of [0, 1, 5, 7, 12, 255]) expect(simulateTm(inc, n.toString(2)).output).toBe((n + 1).toString(2));
  });

  it('extends the tape to the left', () => {
    const left = buildAutomaton('TM', {
      states: ['s', 't', 'f'],
      initial: 's',
      accepting: ['f'],
      transitions: [
        ['s', 'a → a, L', 't'],
        ['t', '_ → b, S', 'f'],
      ],
    });
    const r = simulateTm(left, 'a');
    expect(r.accepted).toBe(true);
    expect(r.output).toBe('ba');
    expect(r.steps[r.steps.length - 1]!.head).toBe(0);
  });

  it('reports "limit" for a machine that never halts', () => {
    const forever = buildAutomaton('TM', { states: ['s', 'f'], initial: 's', accepting: ['f'], transitions: [['s', '_ → _, R ; a → a, R', 's']] });
    const r = simulateTm(forever, 'aa', { maxSteps: 200 });
    expect(r.status).toBe('limit');
    expect(r.steps.length).toBe(201);
  });

  it('rejects nondeterministic machines', () => {
    const bad = buildAutomaton('TM', {
      states: ['s', 'f'],
      initial: 's',
      accepting: ['f'],
      transitions: [
        ['s', 'a → a, R', 's'],
        ['s', 'a → b, R', 'f'],
      ],
    });
    expect(validateAutomaton(bad).errors.join()).toMatch(/nondeterminism/i);
    expect(() => simulateTm(bad, 'a')).toThrow(/nondeterministic/);
  });
});
