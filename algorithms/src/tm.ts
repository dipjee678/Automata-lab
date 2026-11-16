/**
 * Deterministic single-tape Turing machine simulation.
 *
 * Conventions
 *  - The tape is infinite in both directions and blank (`_`) outside the input.
 *  - The head starts on the first input symbol.
 *  - A transition  (read → write, move)  moves the head L(eft), R(ight) or S(tay).
 *  - The machine ACCEPTS as soon as it enters an accepting state, and REJECTS
 *    when no transition applies in a non-accepting state.
 *  - Halting is undecidable, so the run is cut off after `maxSteps` steps and
 *    reported as 'limit' (inconclusive).
 */
import type { Automaton } from '@automata/shared';
import { BLANK } from '@automata/shared';

export interface TmStep {
  state: string;
  /** Tape window: every visited / non-blank cell, always including the head. */
  tape: string[];
  /** Index of the head inside `tape`. */
  head: number;
  /** Transition taken to reach this configuration (null for the first). */
  transition: string | null;
}

export interface TmResult {
  status: 'accepted' | 'rejected' | 'limit';
  accepted: boolean;
  steps: TmStep[];
  /** Final non-blank tape contents. */
  output: string;
  message: string;
}

export function simulateTm(a: Automaton, input: string, opts: { maxSteps?: number; keepTrace?: boolean } = {}): TmResult {
  const maxSteps = opts.maxSteps ?? 5000;
  const keepTrace = opts.keepTrace ?? true;
  const init = a.states.find((s) => s.initial);
  if (!init) throw new Error('No initial state is set.');
  const accepting = new Set(a.states.filter((s) => s.accepting).map((s) => s.id));
  const delta = new Map<string, (typeof a.transitions)[number]>();
  for (const t of a.transitions) {
    const key = `${t.from}\u0000${t.symbol}`;
    if (delta.has(key)) throw new Error('The Turing machine is nondeterministic (two transitions read the same symbol in one state).');
    delta.set(key, t);
  }

  // Tape stored in an array with an offset so it can grow to the left.
  let tape = [...input];
  if (tape.length === 0) tape = [BLANK];
  let head = 0;
  let state = init.id;
  const steps: TmStep[] = [];
  const snapshot = (transition: string | null): TmStep => ({ state, tape: [...tape], head, transition });
  steps.push(snapshot(null));

  let status: TmResult['status'] = 'limit';
  for (let n = 0; n <= maxSteps; n++) {
    if (accepting.has(state)) {
      status = 'accepted';
      break;
    }
    const t = delta.get(`${state}\u0000${tape[head]}`);
    if (!t) {
      status = 'rejected';
      break;
    }
    if (n === maxSteps) break;
    tape[head] = t.write ?? t.symbol;
    state = t.to;
    const move = t.move ?? 'R';
    if (move === 'R') {
      head++;
      if (head === tape.length) tape.push(BLANK);
    } else if (move === 'L') {
      if (head === 0) tape.unshift(BLANK);
      else head--;
    }
    if (keepTrace) steps.push(snapshot(t.id));
    else steps[0] = snapshot(t.id);
  }

  const output = tape.join('').replace(new RegExp(`^${BLANK}+|${BLANK}+$`, 'g'), '');
  const label = a.states.find((s) => s.id === state)?.label ?? state;
  const message =
    status === 'accepted'
      ? `Accepted: the machine halted in accepting state ${label}.`
      : status === 'rejected'
        ? `Rejected: the machine halted in state ${label} with no transition for "${tape[head]}".`
        : `Inconclusive: the machine did not halt within ${maxSteps} steps (it may loop forever).`;
  return { status, accepted: status === 'accepted', steps, output, message };
}
