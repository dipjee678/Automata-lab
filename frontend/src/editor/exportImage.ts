/** Export an automaton as a standalone SVG document or a PNG image. */
import type { Automaton } from '@automata/shared';
import { boxAt, edgeGeometry, edgeLabelLines, groupTransitions, type Box } from './geometry';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function automatonToSvg(a: Automaton, opts: { dark?: boolean } = {}): string {
  const dark = !!opts.dark;
  const c = dark
    ? { bg: '#181b22', fill: '#1f2430', stroke: '#cbd5e1', edge: '#94a3b8', text: '#e5e8ee', labelBg: '#181b22' }
    : { bg: '#ffffff', fill: '#ffffff', stroke: '#334155', edge: '#475569', text: '#181c25', labelBg: '#ffffff' };
  const boxes = new Map<string, Box>(a.states.map((s) => [s.id, boxAt(s.x, s.y, s.label)]));
  const groups = groupTransitions(a).filter((g) => boxes.has(g.from) && boxes.has(g.to));
  const hasReverse = (from: string, to: string) => groups.some((g) => g.from === to && g.to === from);

  // Bounding box (states, loops above states, initial arrows on the left).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.cx - b.w / 2 - 44);
    maxX = Math.max(maxX, b.cx + b.w / 2 + 20);
    minY = Math.min(minY, b.cy - b.h / 2 - 84);
    maxY = Math.max(maxY, b.cy + b.h / 2 + 24);
  }
  if (!isFinite(minX)) [minX, minY, maxX, maxY] = [0, 0, 240, 120];
  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);

  const parts: string[] = [];
  for (const g of groups) {
    const geo = edgeGeometry(boxes.get(g.from)!, boxes.get(g.to)!, g.from === g.to, g.from !== g.to && hasReverse(g.from, g.to));
    const lines = edgeLabelLines(a.type, g.transitions);
    const textW = Math.max(...lines.map((l) => [...l].length)) * 7 + 10;
    const textH = lines.length * 15 + 4;
    parts.push(
      `<path d="${geo.path}" fill="none" stroke="${c.edge}" stroke-width="1.6"/>`,
      `<polygon points="${geo.arrow}" fill="${c.edge}"/>`,
      `<rect x="${geo.label.x - textW / 2}" y="${geo.label.y - textH / 2}" width="${textW}" height="${textH}" rx="3" fill="${c.labelBg}" fill-opacity="0.92"/>`,
      ...lines.map(
        (l, i) =>
          `<text x="${geo.label.x}" y="${geo.label.y - ((lines.length - 1) * 15) / 2 + i * 15}" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace, Consolas, monospace" font-size="12.5" fill="${c.text}">${esc(l)}</text>`,
      ),
    );
  }
  for (const s of a.states) {
    const b = boxes.get(s.id)!;
    const x = b.cx - b.w / 2;
    const y = b.cy - b.h / 2;
    if (s.initial) {
      parts.push(
        `<path d="M ${x - 34} ${b.cy} L ${x - 10} ${b.cy}" stroke="${c.edge}" stroke-width="1.6"/>`,
        `<polygon points="${x - 1},${b.cy} ${x - 11},${b.cy - 4.5} ${x - 11},${b.cy + 4.5}" fill="${c.edge}"/>`,
      );
    }
    parts.push(`<rect x="${x}" y="${y}" width="${b.w}" height="${b.h}" rx="${b.h / 2}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.8"/>`);
    if (s.accepting)
      parts.push(`<rect x="${x + 4.5}" y="${y + 4.5}" width="${b.w - 9}" height="${b.h - 9}" rx="${(b.h - 9) / 2}" fill="none" stroke="${c.stroke}" stroke-width="1.4"/>`);
    parts.push(
      `<text x="${b.cx}" y="${b.cy}" text-anchor="middle" dominant-baseline="central" font-family="ui-sans-serif, system-ui, Segoe UI, sans-serif" font-size="13" font-weight="600" fill="${c.text}">${esc(s.label)}</text>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">` +
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${c.bg}"/>` +
    parts.join('') +
    `</svg>`
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (name: string) => name.trim().replace(/[^\w.-]+/g, '_').slice(0, 60) || 'automaton';

export function downloadSvg(a: Automaton, name: string, dark: boolean) {
  download(new Blob([automatonToSvg(a, { dark })], { type: 'image/svg+xml;charset=utf-8' }), `${safeName(name)}.svg`);
}

/** Rasterise the SVG at 2× for a crisp PNG. */
export function downloadPng(a: Automaton, name: string, dark: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const svg = automatonToSvg(a, { dark });
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas is not available in this browser.'));
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Could not create the PNG image.'));
        download(blob, `${safeName(name)}.png`);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Could not render the automaton as an image.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export function downloadJson(a: Automaton, name: string) {
  download(new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' }), `${safeName(name)}.json`);
}
