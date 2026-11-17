// Printer test sheets: black and white, color (CMYK), alignment and margins, and the
// two-sided sheet that the booklet maker also offers. Pure drawing, no brands or logos.
import {
  MM,
  grey,
  line,
  measure,
  type Color,
  type Op,
  type Page,
} from './sheet';

const INK = '#000000';
const MUTED = '#555555';
const HAIR = '#9a9a9a';

// ---------- text helpers ----------
function para(
  ops: Op[],
  text: string,
  x: number,
  y: number,
  maxW: number,
  size = 8.5,
  fill: Color = '#222222',
  gap = 1.4
): number {
  const words = text.split(/\s+/);
  let cur = '';
  const lines: string[] = [];
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  lines.forEach((l, i) =>
    ops.push({ t: 'text', x, y: y + i * size * gap, size, text: l, fill })
  );
  return y + lines.length * size * gap;
}
const label = (
  ops: Op[],
  text: string,
  x: number,
  y: number,
  anchor: 'start' | 'middle' | 'end' = 'start',
  size = 7
) => ops.push({ t: 'text', x, y, size, text, fill: MUTED, anchor });
const heading = (ops: Op[], text: string, x: number, y: number) =>
  ops.push({ t: 'text', x, y, size: 9.5, text, bold: true, fill: INK });

function header(
  ops: Op[],
  W: number,
  m: number,
  title: string,
  n: string,
  paper: string
): number {
  ops.push({
    t: 'text',
    x: m,
    y: m + 14,
    size: 17,
    text: title,
    bold: true,
    fill: INK,
  });
  label(
    ops,
    `Printer test page ${n} · ${paper} · print at 100% (Actual size)`,
    m,
    m + 28,
    'start',
    8
  );
  label(ops, 'plyleaf.com/printer-test-page', W - m, m + 28, 'end', 8);
  ops.push({
    t: 'path',
    d: line(m, m + 36, W - m, m + 36),
    stroke: INK,
    sw: 0.75,
  });
  return m + 54;
}

/** n strips across a box, colored by f(t) with t from 0 to 1. Strips overlap a hair to avoid seams. */
function strips(
  ops: Op[],
  x: number,
  y: number,
  w: number,
  h: number,
  count: number,
  f: (t: number) => Color
) {
  const sw = w / count;
  for (let i = 0; i < count; i++)
    ops.push({
      t: 'rect',
      x: x + i * sw,
      y,
      w: i === count - 1 ? sw : sw * 2,
      h,
      fill: f(i / (count - 1)),
    });
}

const paperName = (w: number, h: number) => {
  const s = Math.min(w, h);
  return Math.abs(s - 595.28) < 2
    ? 'A4'
    : Math.abs(s - 612) < 2
      ? 'Letter'
      : Math.abs(s - 841.89) < 2
        ? 'A3'
        : `${Math.round(w / MM)} × ${Math.round(h / MM)} mm`;
};

// ---------- sheet 1: black and white ----------
export function blackSheet(W: number, H: number): Page {
  const ops: Op[] = [];
  const m = 14 * MM;
  const cw = W - 2 * m;
  let y = header(ops, W, m, 'Black and white', '1', paperName(W, H));

  heading(ops, 'Solid black', m, y);
  y += 8;
  ops.push({ t: 'rect', x: m, y, w: cw, h: 64, fill: 'cmyk(0,0,0,1)' });
  y += 64 + 26;

  heading(ops, 'Gray steps, 0 to 100%', m, y);
  y += 8;
  const steps = 11;
  const pw = cw / steps;
  for (let i = 0; i < steps; i++) {
    ops.push({
      t: 'rect',
      x: m + i * pw,
      y,
      w: pw,
      h: 36,
      fill: `cmyk(0,0,0,${i / 10})`,
      stroke: i === 0 ? HAIR : undefined,
      sw: 0.4,
    });
    label(ops, `${i * 10}`, m + i * pw + pw / 2, y + 47, 'middle');
  }
  y += 47 + 24;

  heading(ops, 'Smooth gradient', m, y);
  y += 8;
  strips(ops, m, y, cw, 26, 240, (t) => `cmyk(0,0,0,${t.toFixed(3)})`);
  y += 26 + 26;

  heading(ops, 'Line widths', m, y);
  y += 12;
  const widths = [0.1, 0.25, 0.5, 1, 2, 4];
  const colW = cw / 2;
  widths.forEach((w, i) => {
    const ly = y + i * 13;
    ops.push({
      t: 'path',
      d: line(m + 34, ly, m + colW - 16, ly),
      stroke: INK,
      sw: w,
    });
    label(ops, `${w} pt`, m, ly + 2.5);
  });
  // vertical lines of the same widths
  widths.forEach((w, i) => {
    const lx = m + colW + 10 + i * ((colW - 10) / widths.length);
    ops.push({ t: 'path', d: line(lx, y - 4, lx, y + 60), stroke: INK, sw: w });
    label(ops, `${w}`, lx + 4, y + 60);
  });
  y += 6 * 13 + 18;

  heading(ops, 'Text sizes', m, y);
  y += 6;
  const sample = 'The quick brown fox jumps over the lazy dog 0123456789';
  for (const s of [4, 5, 6, 8, 10, 12, 16]) {
    y += s * 1.35;
    let t = sample;
    while (measure(t, s) > cw - 30 && t.includes(' '))
      t = t.slice(0, t.lastIndexOf(' '));
    label(ops, `${s}`, m, y, 'start', 7);
    ops.push({ t: 'text', x: m + 30, y, size: s, text: t, fill: INK });
  }
  y += 22;

  // fine pattern and a circle: banding, smearing and stretched printing show up here
  const box = Math.min(110, H - m - y - 70);
  if (box > 50) {
    heading(ops, 'Fine pattern', m, y);
    heading(ops, 'Circle, should be round', m + box + 40, y);
    y += 8;
    const cell = 2;
    let d = '';
    for (let r = 0; r < box / cell; r++)
      for (let c = 0; c < box / cell; c++)
        if ((r + c) % 2 === 0)
          d += `M${(m + c * cell).toFixed(2)} ${(y + r * cell).toFixed(2)}h${cell}v${cell}h-${cell}z`;
    ops.push({ t: 'path', d, fill: INK });
    const cx = m + box + 40 + box / 2;
    ops.push({
      t: 'circle',
      cx,
      cy: y + box / 2,
      r: box / 2 - 1,
      stroke: INK,
      sw: 1,
    });
    ops.push({
      t: 'path',
      d:
        line(cx - box / 2 + 1, y + box / 2, cx + box / 2 - 1, y + box / 2) +
        line(cx, y + 1, cx, y + box - 1),
      stroke: HAIR,
      sw: 0.5,
    });
    label(
      ops,
      `${Math.round((box - 2) / MM)} mm across both ways`,
      cx,
      y + box + 12,
      'middle'
    );
    y += box + 22;
  }

  para(
    ops,
    'Good print: the black block is even with no white lines, all 11 grey steps look different, the 0.1 pt line is visible and the 4 pt text is readable. White lines across the black block usually mean a clogged nozzle or worn drum: run the printer’s cleaning cycle.',
    m,
    Math.max(y, H - m - 26),
    cw,
    8
  );
  return { w: W, h: H, ops };
}

// ---------- sheet 2: color ----------
const hsl = (h: number, s: number, l: number): Color => {
  const a = s * Math.min(l, 1 - l);
  const f = (k: number) => {
    const t = (k + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1));
  };
  return (
    '#' +
    [f(0), f(8), f(4)]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
};

export function colorSheet(W: number, H: number): Page {
  const ops: Op[] = [];
  const m = 14 * MM;
  const cw = W - 2 * m;
  let y = header(ops, W, m, 'Color', '2', paperName(W, H));

  heading(ops, 'Cyan, magenta, yellow, black', m, y);
  y += 8;
  const inks: [string, Color][] = [
    ['Cyan', 'cmyk(1,0,0,0)'],
    ['Magenta', 'cmyk(0,1,0,0)'],
    ['Yellow', 'cmyk(0,0,1,0)'],
    ['Black', 'cmyk(0,0,0,1)'],
  ];
  const bw = cw / 4;
  inks.forEach(([n, c], i) => {
    ops.push({ t: 'rect', x: m + i * bw, y, w: bw, h: 70, fill: c });
    label(ops, n, m + i * bw + bw / 2, y + 82, 'middle', 8);
  });
  y += 82 + 22;

  heading(ops, 'Mixed colors', m, y);
  y += 8;
  const mixes: [string, Color][] = [
    ['Red', 'cmyk(0,1,1,0)'],
    ['Green', 'cmyk(1,0,1,0)'],
    ['Blue', 'cmyk(1,1,0,0)'],
    ['Orange', 'cmyk(0,0.5,1,0)'],
    ['Purple', 'cmyk(0.5,1,0,0)'],
    ['Teal', 'cmyk(1,0,0.5,0)'],
  ];
  const mw = cw / mixes.length;
  mixes.forEach(([n, c], i) => {
    ops.push({ t: 'rect', x: m + i * mw, y, w: mw, h: 40, fill: c });
    label(ops, n, m + i * mw + mw / 2, y + 51, 'middle');
  });
  y += 51 + 22;

  heading(ops, 'Tints, 10 to 100%', m, y);
  y += 8;
  const rows: [string, (t: number) => Color][] = [
    ['C', (t) => `cmyk(${t},0,0,0)`],
    ['M', (t) => `cmyk(0,${t},0,0)`],
    ['Y', (t) => `cmyk(0,0,${t},0)`],
    ['K', (t) => `cmyk(0,0,0,${t})`],
  ];
  const tw = (cw - 16) / 10;
  rows.forEach(([n, f], r) => {
    label(ops, n, m, y + r * 22 + 13, 'start', 8);
    for (let i = 1; i <= 10; i++)
      ops.push({
        t: 'rect',
        x: m + 16 + (i - 1) * tw,
        y: y + r * 22,
        w: tw - 2,
        h: 18,
        fill: f(i / 10),
      });
  });
  y += 4 * 22 + 20;

  heading(ops, 'Spectrum', m, y);
  y += 8;
  strips(ops, m, y, cw, 30, 180, (t) => hsl(t * 330, 1, 0.5));
  y += 30 + 24;

  heading(ops, 'Gray from color inks (top) and from black ink (bottom)', m, y);
  y += 8;
  strips(
    ops,
    m,
    y,
    cw,
    20,
    120,
    (t) =>
      `cmyk(${(t * 0.75).toFixed(3)},${(t * 0.62).toFixed(3)},${(t * 0.62).toFixed(3)},0)`
  );
  strips(
    ops,
    m,
    y + 22,
    cw,
    20,
    120,
    (t) => `cmyk(0,0,0,${(t * 0.75).toFixed(3)})`
  );
  y += 42 + 24;

  heading(ops, 'Photo-like tones', m, y);
  y += 8;
  const tones = [
    hsl(25, 0.45, 0.78),
    hsl(22, 0.4, 0.62),
    hsl(20, 0.35, 0.45),
    hsl(210, 0.6, 0.75),
    hsl(120, 0.35, 0.45),
    hsl(45, 0.9, 0.6),
    grey(0.85),
    grey(0.5),
  ];
  const ow = cw / tones.length;
  tones.forEach((c, i) =>
    ops.push({ t: 'rect', x: m + i * ow, y, w: ow, h: 30, fill: c })
  );
  y += 30 + 22;

  para(
    ops,
    'Good print: each of the four ink bars is solid and the right color, the tints rise evenly and the spectrum has no gaps. A missing or wrong-colored bar means that cartridge is empty, dried or clogged: clean the print head or replace it. If the top gray strip looks tinted next to the bottom one, the color inks are out of balance.',
    m,
    Math.max(y, H - m - 36),
    cw,
    8
  );
  return { w: W, h: H, ops };
}

// ---------- sheet 3: alignment and margins ----------
export function alignSheet(W: number, H: number): Page {
  const ops: Op[] = [];
  // nested frames at fixed distances from the paper edge show where printing stops
  for (const [mm, c] of [
    [0, '#000000'],
    [3, '#000000'],
    [5, '#000000'],
    [10, '#000000'],
  ] as [number, Color][]) {
    const d = mm * MM;
    ops.push({
      t: 'rect',
      x: d + 0.25,
      y: d + 0.25,
      w: W - 2 * d - 0.5,
      h: H - 2 * d - 0.5,
      stroke: c,
      sw: 0.5,
      dash: mm === 0 ? undefined : mm === 3 ? [2, 2] : undefined,
    });
    if (mm > 0) {
      label(ops, `${mm} mm`, d + 3, d + 9, 'start', 6.5);
      label(ops, `${mm} mm`, W - d - 3, H - d - 4, 'end', 6.5);
    }
  }
  const m = 16 * MM;
  const cw = W - 2 * m;
  ops.push({
    t: 'text',
    x: m,
    y: m + 14,
    size: 17,
    text: 'Alignment and margins',
    bold: true,
    fill: INK,
  });
  label(
    ops,
    `Printer test page 3 · ${paperName(W, H)} · print at 100% (Actual size)`,
    m,
    m + 28,
    'start',
    8
  );

  // 100 mm rulers: if they measure shorter, the print dialog scaled the page
  const rx = m;
  let y = m + 66;
  heading(ops, 'This line is 100 mm long. Check it with a ruler.', rx, y - 18);
  let d = line(rx, y, rx + 100 * MM, y);
  for (let i = 0; i <= 100; i++) {
    const len = i % 10 === 0 ? 10 : i % 5 === 0 ? 6.5 : 3.5;
    d += line(rx + i * MM, y, rx + i * MM, y + len);
    if (i % 10 === 0)
      label(ops, `${i / 10}`, rx + i * MM, y + 19, 'middle', 6.5);
  }
  ops.push({ t: 'path', d, stroke: INK, sw: 0.5 });
  label(ops, 'cm', rx + 100 * MM + 8, y + 19, 'start', 6.5);

  // vertical ruler down the right side
  const vx = W - m;
  const vy = y + 34;
  d = line(vx, vy, vx, vy + 100 * MM);
  for (let i = 0; i <= 100; i++) {
    const len = i % 10 === 0 ? 10 : i % 5 === 0 ? 6.5 : 3.5;
    d += line(vx - len, vy + i * MM, vx, vy + i * MM);
    if (i % 10 === 0)
      label(ops, `${i / 10}`, vx - 14, vy + i * MM + 2.5, 'end', 6.5);
  }
  ops.push({ t: 'path', d, stroke: INK, sw: 0.5 });

  // 10 mm grid: squares should be square, lines straight
  y += 48;
  heading(ops, '10 mm squares', rx, y);
  y += 8;
  const g = 60;
  d = '';
  for (let i = 0; i <= g / 10; i++) {
    d += line(rx + i * 10 * MM, y, rx + i * 10 * MM, y + g * MM);
    d += line(rx, y + i * 10 * MM, rx + g * MM, y + i * 10 * MM);
  }
  d +=
    line(rx, y, rx + g * MM, y + g * MM) + line(rx + g * MM, y, rx, y + g * MM);
  ops.push({ t: 'path', d, stroke: INK, sw: 0.4 });

  // center mark
  const cx = W / 2;
  const cy = H / 2;
  const cm =
    'M' +
    [cx - 14, cy].join(' ') +
    'H' +
    (cx + 14) +
    'M' +
    cx +
    ' ' +
    (cy - 14) +
    'V' +
    (cy + 14);
  ops.push({ t: 'path', d: cm, stroke: INK, sw: 0.5 });
  ops.push({ t: 'circle', cx, cy, r: 8, stroke: INK, sw: 0.5 });

  y += g * MM + 30;
  const tips = [
    'Frames: the outer frame sits on the paper edge, the others 3, 5 and 10 mm in. Frames that are cut off show your printer’s margin. Keep text and lines inside the last frame that printed whole.',
    'The 100 mm line: if it is shorter, the page was shrunk. Print again with Actual size or 100% instead of Fit to page.',
    'Squares: if the 10 mm squares come out as rectangles, the paper is slipping. Check the paper guides and use a fresh, flat stack.',
    'Center mark: fold the sheet in half both ways. The folds should cross on the mark. If they do not, the print is shifted.',
  ];
  for (const t of tips) y = para(ops, t, rx, y, cw - 50, 8.5) + 7;
  return { w: W, h: H, ops };
}

// ---------- sheets 4 and 5: two-sided test (landscape, as the booklet prints) ----------
function arrow(ops: Op[], cx: number, top: number, len: number, fill: Color) {
  const hw = len * 0.28;
  const sw = len * 0.1;
  ops.push({
    t: 'path',
    d: `M${cx} ${top}L${cx + hw} ${top + hw}L${cx + sw} ${top + hw}L${cx + sw} ${top + len}L${cx - sw} ${top + len}L${cx - sw} ${top + hw}L${cx - hw} ${top + hw}Z`,
    fill,
  });
}
function regMarks(ops: Op[], W: number, H: number) {
  const o = 18 * MM;
  for (const [x, y] of [
    [o, o],
    [W - o, o],
    [o, H - o],
    [W - o, H - o],
  ]) {
    ops.push({ t: 'circle', cx: x, cy: y, r: 7, stroke: INK, sw: 0.5 });
    ops.push({
      t: 'path',
      d: line(x - 12, y, x + 12, y) + line(x, y - 12, x, y + 12),
      stroke: INK,
      sw: 0.5,
    });
  }
}

/** Front and back of the two-sided test. Pass the sheet in portrait; it prints landscape. */
export function duplexSheets(pw: number, ph: number): Page[] {
  const W = Math.max(pw, ph);
  const H = Math.min(pw, ph);
  const pages: Page[] = [];
  for (const side of ['front', 'back'] as const) {
    const ops: Op[] = [];
    regMarks(ops, W, H);
    const cx = W / 2;
    ops.push({
      t: 'text',
      x: cx,
      y: 15 * MM,
      size: 12,
      text: '↑  TOP EDGE  ↑',
      bold: true,
      fill: INK,
      anchor: 'middle',
    });
    const big = side === 'front' ? 'FRONT' : 'BACK';
    arrow(
      ops,
      side === 'front' ? W * 0.3 : W * 0.7,
      H * 0.2,
      H * 0.42,
      side === 'front' ? '#000000' : grey(0.35)
    );
    ops.push({
      t: 'text',
      x: side === 'front' ? W * 0.3 : W * 0.7,
      y: H * 0.74,
      size: 54,
      text: big,
      bold: true,
      fill: INK,
      anchor: 'middle',
    });
    ops.push({
      t: 'text',
      x: side === 'front' ? W * 0.3 : W * 0.7,
      y: H * 0.74 + 22,
      size: 11,
      text: side === 'front' ? 'Side 1 of 2' : 'Side 2 of 2',
      fill: MUTED,
      anchor: 'middle',
    });
    const tx = side === 'front' ? W * 0.52 : W * 0.1;
    const tw = W * 0.38;
    let y = H * 0.24;
    heading(
      ops,
      side === 'front' ? 'Two-sided printing test' : 'Reading the result',
      tx,
      y
    );
    y += 16;
    const text =
      side === 'front'
        ? [
            'Print both pages of this file on one sheet with the same settings you will use for your booklet.',
            'Printer that prints both sides: choose two-sided, flip on the short edge.',
            'Printer that prints one side: print this page, put the sheet back in the tray, print the back page. Note which way up you put it back.',
          ]
        : [
            'Hold the sheet up to a window. The arrows on both sides should point to the same edge, the TOP EDGE.',
            'Back upside down: switch between flip on short edge and flip on long edge, or turn the stack the other way before the second pass.',
            'Circles at the corners should line up front to back. A few millimeters off is normal for home printers.',
          ];
    for (const t of text) y = para(ops, t, tx, y, tw, 9.5) + 8;
    pages.push({ w: W, h: H, ops });
  }
  return pages;
}

export const SHEETS = {
  black: { name: 'Black and white', build: blackSheet },
  color: { name: 'Color', build: colorSheet },
  align: { name: 'Alignment and margins', build: alignSheet },
} as const;
