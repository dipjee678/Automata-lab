/**
 * Nondeterministic pushdown automaton simulation.
 *
 * Conventions
 *  - The stack initially holds the single bottom marker Z.
 *  - A transition  (read, pop → push)  may read one input symbol or ε, may pop
 *    one stack symbol or ε (pop nothing), and pushes a string whose LEFTMOST
 *    character becomes the new top (ε pushes nothing).
 *  - Acceptance is by FINAL STATE: the whole input is consumed and the PDA is
 *    in an accepting state.
 *
 * Because a PDA is nondeterministic we search the configuration graph
 * breadth-first. ε-loops that grow the stack make that graph infinite, so the
 * search is cut off after `maxConfigs` configurations; in that case the result
 * is reported as 'limit' (inconclusive) rather than as a rejection.
 */
import type { Automaton } from '@automata/shared';
import { STACK_START } from '@automata/shared';

export interface PdaConfig {
  state: string;
  /** Number of input symbols consumed. */
  position: number;
  /** Stack contents, top first. */
  stack: string[];
  /** Transition that produced this configuration (null for the initial one). */
  transition: string | null;
  /** Description of the stack operation performed. */
  action: string;
}

export interface PdaResult {
  status: 'accepted' | 'rejected' | 'limit';
  accepted: boolean;
  /** An accepting run if one exists, otherwise the run that consumed the most input. */
  path: PdaConfig[];
  explored: number;
  message: string;
}

export function simulatePda(a: Automaton, input: string, opts: { maxConfigs?: number } = {}): PdaResult {
  const maxConfigs = opts.maxConfigs ?? 20000;
  const w = [...input];
  const init = a.states.find((s) => s.initial);
  if (!init) throw new Error('No initial state is set.');
  const accepting = new Set(a.states.filter((s) => s.accepting).map((s) => s.id));
  const outgoing = new Map<string, typeof a.transitions>();
  for (const t of a.transitions) (outgoing.get(t.from) ?? outgoing.set(t.from, []).get(t.from)!).push(t);

  interface Node {
    state: string;
    position: number;
    stack: string; // top first
    parent: number;
    transition: string | null;
    action: string;
  }
  const nodes: Node[] = [{ state: init.id, position: 0, stack: STACK_START, parent: -1, transition: null, action: `start with ${STACK_START} on the stack` }];
  const seen = new Set<string>([`${init.id}|0|${STACK_START}`]);
  let best = 0;
  let found = -1;
  let hitLimit = false;

  for (let h = 0; h < nodes.length && found < 0; h++) {
    const cur = nodes[h]!;
    if (cur.position === w.length && accepting.has(cur.state)) {
      found = h;
      break;
    }
    if (cur.position > nodes[best]!.position) best = h;
    for (const t of outgoing.get(cur.state) ?? []) {
      if (t.symbol !== '' && w[cur.position] !== t.symbol) continue;
      const pop = t.pop ?? '';
      if (pop !== '' && !cur.stack.startsWith(pop)) continue;
      const push = t.push ?? '';
      const stack = push + cur.stack.slice(pop.length);
      const position = cur.position + (t.symbol === '' ? 0 : 1);
      const key = `${t.to}|${position}|${stack}`;
      if (seen.has(key)) continue;
      if (nodes.length >= maxConfigs) {
        hitLimit = true;
        break;
      }
      seen.add(key);
      const action =
        (pop ? `pop ${pop}` : '') + (pop && push ? ', ' : '') + (push ? `push ${push}` : '') || 'stack unchanged';
      nodes.push({ state: t.to, position, stack, parent: h, transition: t.id, action });
    }
    if (hitLimit) break;
  }

  const end = found >= 0 ? found : best;
  const path: PdaConfig[] = [];
  for (let k = end; k >= 0; k = nodes[k]!.parent) {
    const nd = nodes[k]!;
    path.push({ state: nd.state, position: nd.position, stack: [...nd.stack], transition: nd.transition, action: nd.action });
  }
  path.reverse();

  const status: PdaResult['status'] = found >= 0 ? 'accepted' : hitLimit ? 'limit' : 'rejected';
  const message =
    status === 'accepted'
      ? 'Accepted: there is a run that consumes the whole input and ends in an accepting state.'
      : status === 'limit'
        ? `Inconclusive: no accepting run was found within ${maxConfigs} configurations (the PDA may have ε-loops that grow the stack).`
        : `Rejected: all ${nodes.length} reachable configurations were explored and none accepts. The run shown got furthest through the input.`;
  return { status, accepted: status === 'accepted', path, explored: nodes.length, message };
}
