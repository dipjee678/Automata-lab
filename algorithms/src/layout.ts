/**
 * Simple layered layout for generated automata: states are placed in columns
 * by their BFS distance from the start state.
 */
export function layeredLayout(
  n: number,
  edges: Array<[number, number]>,
  start: number,
): Array<{ x: number; y: number }> {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) if (u !== v) adj[u]!.push(v);

  const depth = new Array<number>(n).fill(-1);
  if (n > 0) {
    depth[start] = 0;
    const queue = [start];
    for (let h = 0; h < queue.length; h++) {
      const u = queue[h]!;
      for (const v of adj[u]!)
        if (depth[v] === -1) {
          depth[v] = depth[u]! + 1;
          queue.push(v);
        }
    }
  }
  const maxDepth = Math.max(0, ...depth);
  const layers: number[][] = Array.from({ length: maxDepth + 2 }, () => []);
  for (let i = 0; i < n; i++) layers[depth[i] === -1 ? maxDepth + 1 : depth[i]!]!.push(i);

  const pos = new Array<{ x: number; y: number }>(n);
  const DX = 170;
  const DY = 120;
  layers.forEach((layer, li) => {
    layer.forEach((node, k) => {
      // Stagger alternate columns slightly so straight edges between columns do not overlap.
      const offset = (k - (layer.length - 1) / 2) * DY + (li % 2 === 1 && layer.length === 1 ? 0 : 0);
      pos[node] = { x: 80 + li * DX, y: 220 + offset };
    });
  });
  return pos;
}
