/**
 * Drawing geometry shared by the interactive canvas and the SVG/PNG exporter,
 * so an exported picture looks exactly like the editor.
 *
 * A state is a "stadium" (pill) of fixed height whose width depends only on
 * its label, which makes the geometry a pure function of the automaton.
 */
import type { Automaton, AutomatonType, Transition } from '@automata/shared';
import { transitionLabel } from '@automata/algorithms';

export const NODE_H = 56;
export const nodeWidth = (label: string) => Math.max(NODE_H, 22 + [...label].length * 7.6);

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Box of a state given its top-left position. */
export const boxAt = (x: number, y: number, label: string): Box => {
  const w = nodeWidth(label);
  return { cx: x + w / 2, cy: y + NODE_H / 2, w, h: NODE_H };
};

/** Point where a ray from the centre of a stadium in direction (dx, dy) leaves it. */
export function stadiumEdge(b: Box, dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const r = b.h / 2;
  const L = Math.max(0, b.w / 2 - r); // half-length of the straight part
  let t: number;
  if (Math.abs(uy) > 1e-9 && Math.abs((r / Math.abs(uy)) * ux) <= L) {
    t = r / Math.abs(uy); // leaves through the flat top/bottom
  } else {
    // leaves through the round cap centred at (±L, 0)
    const c = Math.sign(ux || 1) * L;
    const dot = ux * c;
    t = dot + Math.sqrt(Math.max(0, dot * dot - (c * c - r * r)));
  }
  return { x: b.cx + ux * t, y: b.cy + uy * t };
}

export interface EdgeGeometry {
  /** SVG path of the line (stops at the base of the arrow head). */
  path: string;
  /** Polygon points of the arrow head. */
  arrow: string;
  /** Where to centre the label. */
  label: Pt;
}

const ARROW = 10;

function arrowHead(tip: Pt, ux: number, uy: number): { points: string; base: Pt } {
  const base = { x: tip.x - ux * ARROW, y: tip.y - uy * ARROW };
  const px = -uy * 4.5;
  const py = ux * 4.5;
  return { points: `${tip.x},${tip.y} ${base.x + px},${base.y + py} ${base.x - px},${base.y - py}`, base };
}

/**
 * @param curved  bend the edge (used when the reverse edge also exists, so the two do not overlap)
 */
export function edgeGeometry(from: Box, to: Box, self: boolean, curved: boolean): EdgeGeometry {
  if (self) {
    // Loop above the state.
    const top = from.cy - from.h / 2;
    const s = { x: from.cx - 11, y: top + 1.5 };
    const e = { x: from.cx + 11, y: top + 1.5 };
    const c1 = { x: from.cx - 34, y: top - 58 };
    const c2 = { x: from.cx + 34, y: top - 58 };
    const d = Math.hypot(e.x - c2.x, e.y - c2.y);
    const head = arrowHead(e, (e.x - c2.x) / d, (e.y - c2.y) / d);
    return {
      path: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${head.base.x} ${head.base.y}`,
      arrow: head.points,
      label: { x: from.cx, y: top - 52 },
    };
  }

  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const dist = Math.hypot(dx, dy) || 1;
  const bend = curved ? Math.min(60, Math.max(28, dist * 0.2)) : 0;
  // Control point: midpoint pushed sideways. A→B and B→A get opposite sides automatically.
  const ctrl = { x: (from.cx + to.cx) / 2 + (-dy / dist) * bend, y: (from.cy + to.cy) / 2 + (dx / dist) * bend };
  const s = stadiumEdge(from, ctrl.x - from.cx, ctrl.y - from.cy);
  const e = stadiumEdge(to, ctrl.x - to.cx, ctrl.y - to.cy);
  const tl = Math.hypot(e.x - ctrl.x, e.y - ctrl.y) || 1;
  const head = arrowHead(e, (e.x - ctrl.x) / tl, (e.y - ctrl.y) / tl);
  return {
    path: curved ? `M ${s.x} ${s.y} Q ${ctrl.x} ${ctrl.y} ${head.base.x} ${head.base.y}` : `M ${s.x} ${s.y} L ${head.base.x} ${head.base.y}`,
    arrow: head.points,
    label: { x: 0.25 * s.x + 0.5 * ctrl.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * ctrl.y + 0.25 * e.y },
  };
}

/** Lines of text shown on the edge that carries these transitions. */
export function edgeLabelLines(type: AutomatonType, transitions: Transition[]): string[] {
  if (type === 'PDA' || type === 'TM') return transitions.map((t) => transitionLabel(type, t));
  return [transitions.map((t) => transitionLabel(type, t)).join(', ')];
}

/** Transitions grouped per (from, to) pair – one drawn edge each. */
export function groupTransitions(a: Automaton): Array<{ id: string; from: string; to: string; transitions: Transition[] }> {
  const groups = new Map<string, { id: string; from: string; to: string; transitions: Transition[] }>();
  for (const t of a.transitions) {
    const id = `e:${t.from}:${t.to}`;
    (groups.get(id) ?? groups.set(id, { id, from: t.from, to: t.to, transitions: [] }).get(id)!).transitions.push(t);
  }
  return [...groups.values()];
}
