// Name tracing worksheets: dashed or dotted letters on school ruling, with start dots and
// direction arrows. Letters come from single-stroke Hershey fonts (see docs/licenses.md),
// so every letter is a pen path with a real start point and direction.
import {
  mountGenerator,
  formVal,
  formNum,
  formOn,
  presetPaper,
  type Built,
} from '../print/gen';
import {
  PAPER,
  MM,
  line,
  type Op,
  type Page,
  type Paper,
} from '../print/sheet';
import HERSHEY from '../print/hershey.json';
import { t, tn, tp } from '../i18n';

presetPaper();

type Pt = [number, number];
interface Face {
  cap: number;
  x: number;
  desc: number;
  glyphs: Record<string, [number, string]>;
}
const FACES = HERSHEY as unknown as Record<'print' | 'cursive', Face>;

interface Glyph {
  adv: number;
  strokes: Pt[][];
  dots: Pt[][];
}
const cache = new Map<string, Glyph | null>();

const len = (s: Pt[]) =>
  s.reduce(
    (a, p, i) =>
      i ? a + Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]) : 0,
    0
  );
const isDot = (s: Pt[]) => {
  const xs = s.map((p) => p[0]);
  const ys = s.map((p) => p[1]);
  return (
    Math.max(...xs) - Math.min(...xs) < 70 &&
    Math.max(...ys) - Math.min(...ys) < 70
  );
};
/** True when every point lies close to the line from first to last point. */
const straight = (s: Pt[]) => {
  const [a, b] = [s[0], s[s.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1) return false;
  return s.every(
    (p) =>
      Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) /
        L <
      25
  );
};

/**
 * Hershey strokes are drawn in plotter order. For print letters we turn them into the order
 * children are taught: top to bottom, left to right, round letters (a, d, g, q) bowl first.
 */
function teachOrder(ch: string, strokes: Pt[][]): Pt[][] {
  const out = strokes.map((s) => {
    const a = s[0];
    const b = s[s.length - 1];
    const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < 20;
    if (closed) return s;
    if (straight(s)) {
      const horizontal = Math.abs(b[0] - a[0]) > 2 * Math.abs(b[1] - a[1]);
      const flip = horizontal ? a[0] > b[0] : a[1] < b[1];
      return flip ? s.slice().reverse() : s;
    }
    // curves start at their higher end; level ends start on the left
    const flip = Math.abs(a[1] - b[1]) < 90 ? a[0] > b[0] + 20 : a[1] < b[1];
    return flip ? s.slice().reverse() : s;
  });
  const bowlFirst = 'adgq'.includes(ch);
  return out.sort((s, t) => {
    if (bowlFirst) {
      const cs = straight(s) ? 1 : 0;
      const ct = straight(t) ? 1 : 0;
      if (cs !== ct) return cs - ct;
    }
    const dy = t[0][1] - s[0][1];
    if (Math.abs(dy) > 60) return dy;
    const dx = s[0][0] - t[0][0];
    if (Math.abs(dx) > 40) return dx;
    // same start: the longer vertical reach goes first (the stem of E, F, L)
    const reach = (u: Pt[]) =>
      Math.max(...u.map((p) => p[1])) - Math.min(...u.map((p) => p[1]));
    return reach(t) - reach(s);
  });
}

function glyph(style: 'print' | 'cursive', ch: string): Glyph | null {
  const key = style + ch;
  if (cache.has(key)) return cache.get(key)!;
  const raw = FACES[style].glyphs[ch];
  if (!raw) {
    cache.set(key, null);
    return null;
  }
  const all: Pt[][] = raw[1]
    ? raw[1]
        .split('|')
        .map((s) => s.split(' ').map((p) => p.split(',').map(Number) as Pt))
    : [];
  const dots = all.filter(isDot);
  let strokes = all.filter((s) => !isDot(s) && s.length > 1);
  if (style === 'print') strokes = teachOrder(ch, strokes);
  const g = { adv: raw[0], strokes, dots };
  cache.set(key, g);
  return g;
}

// ---------- layout ----------
const RULE = '#7fa6d6';
const RULE_DARK = '#4f7fbf';
const INK = '#8a8a8a';
const START = '#16a34a';
const ARROW = '#e0622b';

interface RowOpts {
  style: 'print' | 'cursive';
  letters: 'dashed' | 'dotted' | 'none';
  guides: boolean;
}

/** Width of a text in font units, with extra spacing between print letters. */
function textWidth(style: 'print' | 'cursive', text: string): number {
  const track = style === 'print' ? 45 : 0;
  return (
    [...text].reduce((w, c) => w + (glyph(style, c)?.adv ?? 0) + track, 0) -
    track
  );
}

function pointAt(s: Pt[], t: number): { p: Pt; d: Pt } {
  const total = len(s);
  let acc = 0;
  for (let i = 1; i < s.length; i++) {
    const seg = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    if (acc + seg >= t * total && seg > 0) {
      const u = (t * total - acc) / seg;
      return {
        p: [
          s[i - 1][0] + (s[i][0] - s[i - 1][0]) * u,
          s[i - 1][1] + (s[i][1] - s[i - 1][1]) * u,
        ],
        d: [(s[i][0] - s[i - 1][0]) / seg, (s[i][1] - s[i - 1][1]) / seg],
      };
    }
    acc += seg;
  }
  return { p: s[s.length - 1], d: [1, 0] };
}

function drawRuling(
  ops: Op[],
  x1: number,
  x2: number,
  base: number,
  k: number,
  face: Face
) {
  ops.push({
    t: 'path',
    d: line(x1, base - face.cap * k, x2, base - face.cap * k),
    stroke: RULE,
    sw: 0.7,
  });
  ops.push({
    t: 'path',
    d: line(x1, base - face.x * k, x2, base - face.x * k),
    stroke: RULE,
    sw: 0.6,
    dash: [3, 2.5],
  });
  ops.push({
    t: 'path',
    d: line(x1, base, x2, base),
    stroke: RULE_DARK,
    sw: 1,
  });
}

/** Draws `text` with its left edge at x on baseline `base`; k converts font units to points. */
function drawWord(
  ops: Op[],
  text: string,
  x: number,
  base: number,
  k: number,
  o: RowOpts
) {
  const face = FACES[o.style];
  const track = o.style === 'print' ? 45 : 0;
  const capPt = face.cap * k;
  const sw = Math.max(0.9, capPt * 0.035);
  const paths: string[] = [];
  const dotsOps: Op[] = [];
  const guideOps: Op[] = [];
  let cx = x;
  for (const ch of text) {
    const g = glyph(o.style, ch);
    if (!g) continue;
    const P = (p: Pt): Pt => [cx + p[0] * k, base - p[1] * k];
    for (const s of g.strokes) {
      const pts = s.map(P);
      paths.push(
        'M' + pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L')
      );
    }
    for (const s of g.dots) {
      const xs = s.map((p) => p[0]);
      const ys = s.map((p) => p[1]);
      const c = P([
        (Math.min(...xs) + Math.max(...xs)) / 2,
        (Math.min(...ys) + Math.max(...ys)) / 2,
      ]);
      dotsOps.push({
        t: 'circle',
        cx: c[0],
        cy: c[1],
        r: sw * 1.2,
        fill: o.letters === 'none' ? '#2b2b2b' : INK,
      });
    }
    if (o.guides) {
      const many = g.strokes.length > 1 && o.style === 'print';
      const starts: Pt[] = [];
      g.strokes.forEach((s, i) => {
        if (len(s) * k < capPt * 0.12) return;
        // cursive letters flow into each other: one start dot and arrow per letter is enough
        if (o.style === 'cursive' && i > 0) return;
        const st = P(s[0]);
        // strokes that begin at the same spot (A, E, m) get their numbers on different sides
        const near = starts.filter(
          (q) => Math.hypot(q[0] - st[0], q[1] - st[1]) < capPt * 0.14
        ).length;
        starts.push(st);
        guideOps.push({
          t: 'circle',
          cx: st[0],
          cy: st[1],
          r: Math.max(1.6, capPt * 0.05),
          fill: START,
        });
        if (many) {
          const fs = Math.max(5, capPt * 0.13);
          const [lx, ly, anchor] =
            near === 0
              ? [st[0] - capPt * 0.09, st[1] - capPt * 0.05, 'end']
              : near === 1
                ? [st[0] + capPt * 0.09, st[1] - capPt * 0.05, 'start']
                : [st[0] - capPt * 0.09, st[1] + fs, 'end'];
          guideOps.push({
            t: 'text',
            x: lx,
            y: ly,
            size: fs,
            text: String(i + 1),
            fill: START,
            bold: true,
            anchor: anchor as 'start' | 'end',
          });
        }
        // arrowhead a third of the way along the stroke, pointing the way the pen moves
        const { p, d } = pointAt(s, len(s) * k > capPt * 0.5 ? 0.38 : 0.55);
        const tip = P(p);
        const dir: Pt = [d[0], -d[1]];
        const a = Math.max(3, capPt * 0.1);
        const n: Pt = [-dir[1], dir[0]];
        const f: Pt = [tip[0] + dir[0] * a * 0.55, tip[1] + dir[1] * a * 0.55];
        const b1: Pt = [
          tip[0] - dir[0] * a * 0.45 + n[0] * a * 0.42,
          tip[1] - dir[1] * a * 0.45 + n[1] * a * 0.42,
        ];
        const b2: Pt = [
          tip[0] - dir[0] * a * 0.45 - n[0] * a * 0.42,
          tip[1] - dir[1] * a * 0.45 - n[1] * a * 0.42,
        ];
        guideOps.push({
          t: 'path',
          d: `M${f[0].toFixed(2)} ${f[1].toFixed(2)}L${b1[0].toFixed(2)} ${b1[1].toFixed(2)}L${b2[0].toFixed(2)} ${b2[1].toFixed(2)}Z`,
          fill: ARROW,
        });
      });
    }
    cx += (g.adv + track) * k;
  }
  if (paths.length) {
    const d = paths.join('');
    if (o.letters === 'dashed')
      ops.push({
        t: 'path',
        d,
        stroke: INK,
        sw,
        dash: [sw * 2.6, sw * 2.2],
        cap: 'round',
      });
    else if (o.letters === 'dotted')
      ops.push({
        t: 'path',
        d,
        stroke: INK,
        sw: sw * 1.25,
        dash: [0, sw * 2.9],
        cap: 'round',
      });
    else ops.push({ t: 'path', d, stroke: '#2b2b2b', sw, cap: 'round' });
  }
  ops.push(...dotsOps, ...guideOps);
}

// ---------- worksheet ----------
const SIZES: Record<string, number> = { s: 12, m: 17, l: 24 }; // top line to base line, mm

function missingChars(style: 'print' | 'cursive', names: string[]): string[] {
  const bad = new Set<string>();
  for (const n of names)
    for (const c of n) if (c !== ' ' && !FACES[style].glyphs[c]) bad.add(c);
  return [...bad];
}

function sheet(
  name: string,
  W: number,
  H: number,
  style: 'print' | 'cursive',
  letters: 'dashed' | 'dotted',
  guides: boolean,
  capMm: number,
  traced: number,
  empty: number,
  repeat: boolean,
  header: boolean
): { page: Page; rows: number; shrunk: boolean } {
  const face = FACES[style];
  const ops: Op[] = [];
  const m = 15 * MM;
  const usableW = W - 2 * m;
  let capPt = capMm * MM;
  // a long name shrinks so one copy fits on the line
  const unitW = textWidth(style, name);
  let shrunk = false;
  if (unitW > 0 && (unitW * capPt) / face.cap > usableW) {
    capPt = (usableW / unitW) * face.cap;
    shrunk = true;
  }
  const k = capPt / face.cap;
  const descPt = -face.desc * k;
  const rowH = capPt + descPt + Math.max(4 * MM, capPt * 0.35);

  let y = m;
  if (header) {
    const hy = m + 10;
    ops.push({
      t: 'text',
      x: m,
      y: hy,
      size: 11,
      text: tp('Name'),
      fill: '#444444',
    });
    ops.push({
      t: 'path',
      d: line(m + 36, hy + 2, m + usableW * 0.62, hy + 2),
      stroke: '#9a9a9a',
      sw: 0.6,
    });
    ops.push({
      t: 'text',
      x: m + usableW * 0.66,
      y: hy,
      size: 11,
      text: tp('Date'),
      fill: '#444444',
    });
    ops.push({
      t: 'path',
      d: line(m + usableW * 0.66 + 30, hy + 2, m + usableW, hy + 2),
      stroke: '#9a9a9a',
      sw: 0.6,
    });
    y += 26;
  }
  const fit = Math.max(1, Math.floor((H - m - y) / rowH));
  let t = Math.min(traced, fit);
  const e = Math.min(empty, fit - t);
  if (t + e === 0) t = 1;
  const gapW = face.x * k * 1.6;
  const unitPt = unitW * k;
  const copies =
    repeat && unitPt > 0
      ? Math.max(1, Math.floor((usableW + gapW) / (unitPt + gapW)))
      : 1;
  for (let r = 0; r < t + e; r++) {
    const base = y + capPt + r * rowH;
    drawRuling(ops, m, W - m, base, k, face);
    if (r >= t) continue;
    for (let c = 0; c < copies; c++)
      drawWord(ops, name, m + c * (unitPt + gapW), base, k, {
        style,
        letters,
        // start dots and arrows on the first row, where the child looks first
        guides: guides && r === 0,
      });
  }
  return { page: { w: W, h: H, ops }, rows: t + e, shrunk };
}

function build(): Built {
  const style = (formVal('style') === 'cursive' ? 'cursive' : 'print') as
    | 'print'
    | 'cursive';
  const letters = (formVal('letters') === 'dotted' ? 'dotted' : 'dashed') as
    | 'dashed'
    | 'dotted';
  const names = formVal('names')
    .split(/\r?\n/)
    .map((n) => n.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, 200);
  if (!names.length)
    return {
      pages: [],
      summary: '',
      error: t('Type a name to make a worksheet.'),
    };
  const bad = missingChars(style, names);
  if (bad.length)
    return {
      pages: [],
      summary: '',
      error: t(
        'These letters are not in the tracing letters yet: {letters}. Latin letters, including accented ones like é and ñ, work.',
        { letters: bad.join(' ') }
      ),
    };
  const [W, H] = PAPER[(formVal('paper') || 'a4') as Paper];
  const capMm = SIZES[formVal('size')] ?? 24;
  const traced = Math.round(formNum('traced', 1, 20, 4));
  const empty = Math.round(formNum('empty', 0, 20, 2));
  const pages: Page[] = [];
  let rows = 0;
  let shrunk = 0;
  for (const n of names) {
    const s = sheet(
      n,
      W,
      H,
      style,
      letters,
      formOn('guides'),
      capMm,
      traced,
      empty,
      formOn('repeat'),
      formOn('header')
    );
    pages.push(s.page);
    rows = s.rows;
    if (s.shrunk) shrunk++;
  }
  const fitNote =
    rows < traced + empty
      ? ` · ${tn(rows, '{n} row fits at this size', '{n} rows fit at this size')}`
      : ` · ${tn(rows, '{n} row', '{n} rows')}`;
  return {
    pages,
    summary: `${tn(pages.length, '{n} sheet', '{n} sheets')}${fitNote}${shrunk ? ` · ${tn(shrunk, 'a long name was made smaller to fit', '{n} long names were made smaller to fit')}` : ''}`,
  };
}

mountGenerator({
  tool: 'name-tracing-worksheets',
  title: t('Name tracing worksheets'),
  fileName: () => {
    const first = formVal('names')
      .split(/\r?\n/)[0]
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const many =
      formVal('names')
        .split(/\r?\n/)
        .filter((s) => s.trim()).length > 1;
    return many
      ? 'name-tracing-worksheets.pdf'
      : `name-tracing-${first || 'worksheet'}.pdf`;
  },
  previewMax: 4,
  build,
});
