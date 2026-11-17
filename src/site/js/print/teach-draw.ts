// Shared bits of the teacher sheets: the heading with a name line, and plain wrapped text.
import { fitText, measure, line, type Op } from './sheet';

export const INK = '#1a1a1a';
export const SOFT = '#6b6b6b';
export const RULE = '#9a9a9a';

/** Title on the left, "Name ____ Date ____" on the right; returns the y below the heading. */
export function sheetHead(
  ops: Op[],
  W: number,
  m: number,
  title: string,
  opts: { nameLine: boolean; name: string; date: string; tag?: string }
): number {
  const tagW = opts.tag ? measure(opts.tag, 9, true) + 8 : 0;
  const { size, lines } = fitText(title, W - 2 * m - tagW, 26, 20, 11, true);
  ops.push({
    t: 'text',
    x: m,
    y: m + size * 0.85,
    size,
    text: lines.join(' '),
    bold: true,
    fill: INK,
  });
  if (opts.tag)
    ops.push({
      t: 'text',
      x: W - m,
      y: m + 9,
      size: 9,
      text: opts.tag,
      bold: true,
      fill: SOFT,
      anchor: 'end',
    });
  let y = m + Math.max(size, 14) + 6;
  if (opts.nameLine) {
    y += 16;
    const nw = measure(opts.name, 10);
    const dw = measure(opts.date, 10);
    const dateX = W - m - 110;
    ops.push({ t: 'text', x: m, y, size: 10, text: opts.name, fill: SOFT });
    ops.push({
      t: 'path',
      d: line(m + nw + 6, y + 2, dateX - 18, y + 2),
      stroke: RULE,
      sw: 0.6,
    });
    ops.push({ t: 'text', x: dateX, y, size: 10, text: opts.date, fill: SOFT });
    ops.push({
      t: 'path',
      d: line(dateX + dw + 6, y + 2, W - m, y + 2),
      stroke: RULE,
      sw: 0.6,
    });
  }
  return y + 14;
}

/** Wrapped lines at a fixed size (long words break with a hyphen). */
export function wrapAt(
  text: string,
  w: number,
  size: number,
  bold = false
): string[] {
  if (!text.trim()) return [''];
  return fitText(text, w, 1e6, size, size, bold, 1.2).lines;
}
