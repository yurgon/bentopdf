// Bingo card generator: sets of different cards from numbers, your own words or a theme,
// plus a caller sheet and cut-out calling cards. Drawn in the browser, printed or saved as PDF.
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
  fitText,
  line,
  rng,
  type Color,
  type Op,
  type Page,
  type Paper,
} from '../print/sheet';
import { THEMES } from '../print/bingo-themes';

/** Most cards in one set. null = no limit (the brief keeps the switch, turned off). */
const CARD_LIMIT: number | null = null;

presetPaper();

const form = document.getElementById('gen-form') as HTMLFormElement;
const themeSel = form.querySelector<HTMLSelectElement>('select[name="theme"]')!;
themeSel.innerHTML = Object.entries(THEMES)
  .map(([k, t]) => `<option value="${k}">${t.name}</option>`)
  .join('');
const wordsInfo = document.getElementById('words-info')!;
const freeBox = form.querySelector<HTMLInputElement>('input[name="free"]')!;
const countInput = form.querySelector<HTMLInputElement>('input[name="count"]')!;
if (CARD_LIMIT) countInput.max = String(CARD_LIMIT);

let seed = (Math.random() * 2 ** 31) | 0;
document.getElementById('shuffle-btn')!.addEventListener('click', () => {
  seed = (Math.random() * 2 ** 31) | 0;
  gen.refresh();
});

function syncControls(): void {
  const src = formVal('source');
  form.querySelectorAll<HTMLElement>('[data-source]').forEach((el) => {
    el.hidden = el.dataset.source !== src;
  });
  const size = +formVal('size');
  freeBox.disabled = size % 2 === 0;
  freeBox.closest('label')!.classList.toggle('is-off', size % 2 === 0);
  if (src === 'words') {
    const n = userWords().length;
    const need = cellsNeeded(size);
    wordsInfo.textContent =
      n >= need
        ? `${n} ${n === 1 ? 'word' : 'words'}. Each card uses ${need}.`
        : `${n} of at least ${need} words for a ${size}×${size} card.`;
  }
}
form.addEventListener('input', syncControls, true);
form.addEventListener('change', syncControls, true);

const cellsNeeded = (size: number) =>
  size * size - (size % 2 === 1 && formOn('free') ? 1 : 0);
function userWords(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of formVal('words').split(/\r?\n|;/)) {
    const w = raw.trim().replace(/\s+/g, ' ');
    const key = w.toLocaleLowerCase();
    if (w && !seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

// ---------- cards ----------
type Card = (string | null)[]; // row by row; null = free square
const LETTERS = 'BINGO';

function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** log of n choose k, to tell whether distinct word sets are easy to find */
const logChoose = (n: number, k: number) => {
  let s = 0;
  for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1);
  return s;
};

function makeCards(
  count: number,
  size: number,
  free: boolean,
  pool: string[] | null,
  r: () => number
): Card[] | string {
  const cells = size * size;
  const mid = free ? Math.floor(cells / 2) : -1;
  const need = cells - (free ? 1 : 0);
  // distinct word sets when there are plenty, otherwise distinct layouts
  const bySet = pool
    ? logChoose(pool.length, need) > Math.log(count * 20)
    : true;
  const seen = new Set<string>();
  const cards: Card[] = [];
  let tries = 0;
  while (cards.length < count) {
    if (++tries > count * 200 + 1000)
      return `Only ${cards.length} different cards are possible with these settings. Add more words or make fewer cards.`;
    let items: string[];
    if (pool) items = shuffle(pool.slice(), r).slice(0, need);
    else {
      // classic columns: 1–15, 16–30, ... each column holds numbers from its own range
      const cols = Array.from({ length: size }, (_, c) =>
        shuffle(
          Array.from({ length: 15 }, (_, i) => String(c * 15 + i + 1)),
          r
        ).slice(0, size)
      );
      items = [];
      for (let row = 0; row < size; row++)
        for (let c = 0; c < size; c++) {
          if (row * size + c === mid) continue;
          items.push(cols[c][row]);
        }
    }
    const key =
      bySet && pool
        ? items.slice().sort().join('\u0001')
        : items.join('\u0001');
    if (seen.has(key)) continue;
    seen.add(key);
    const card: Card = [];
    let k = 0;
    for (let i = 0; i < cells; i++) card.push(i === mid ? null : items[k++]);
    cards.push(card);
  }
  return cards;
}

// ---------- drawing ----------
const mix = (hex: string, t: number): Color => {
  const h = hex.replace('#', '');
  return (
    '#' +
    [0, 2, 4]
      .map((i) =>
        Math.round(parseInt(h.slice(i, i + 2), 16) * t + 255 * (1 - t))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
};

interface Style {
  color: string;
  title: string;
  numbers: boolean;
  textScale: number;
  size: number;
}

function drawText(
  ops: Op[],
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  maxSize: number,
  fill: Color,
  bold = false
) {
  const pad = Math.min(w, h) * 0.08;
  const { size, lines } = fitText(
    text,
    w - 2 * pad,
    h - 2 * pad,
    maxSize,
    4.5,
    bold
  );
  const lh = size * 1.15;
  const top = y + h / 2 - (lines.length * lh) / 2 + size * 0.8;
  lines.forEach((l, i) =>
    ops.push({
      t: 'text',
      x: x + w / 2,
      y: top + i * lh,
      size,
      text: l,
      fill,
      bold,
      anchor: 'middle',
    })
  );
}

function drawCard(
  ops: Op[],
  card: Card,
  no: number,
  total: number,
  slot: { x: number; y: number; w: number; h: number },
  s: Style
) {
  const { size } = s;
  const titleH = Math.min(slot.h * 0.13, 60);
  const footH = Math.max(10, slot.h * 0.035);
  const letters = s.numbers && size === 5;
  const avail = slot.h - titleH - footH - 4;
  const cell = Math.min(slot.w / size, avail / (size + (letters ? 0.6 : 0)));
  const headH = letters ? cell * 0.6 : 0;
  const gw = cell * size;
  const x0 = slot.x + (slot.w - gw) / 2;
  const blockH = titleH + headH + gw;
  const y0 = slot.y + Math.max(0, (slot.h - footH - blockH) / 2);

  drawText(
    ops,
    s.title || 'BINGO',
    x0,
    y0,
    gw,
    titleH,
    titleH * 0.72,
    s.color,
    true
  );
  let gy = y0 + titleH;
  if (letters) {
    ops.push({ t: 'rect', x: x0, y: gy, w: gw, h: headH, fill: s.color });
    for (let c = 0; c < size; c++)
      ops.push({
        t: 'text',
        x: x0 + c * cell + cell / 2,
        y: gy + headH * 0.74,
        size: headH * 0.62,
        text: LETTERS[c],
        fill: '#ffffff',
        bold: true,
        anchor: 'middle',
      });
    gy += headH;
  }
  // one text size for most of the card, so it looks even
  let maxText = cell * (s.numbers ? 0.42 : 0.27) * s.textScale;
  const pad = cell * 0.08;
  const fits = card
    .filter((c): c is string => c !== null)
    .map(
      (c) =>
        fitText(c, cell - 2 * pad, cell - 2 * pad, maxText, 4.5, s.numbers).size
    );
  if (fits.length) {
    // the typical square sets the size; only unusually long words go smaller
    fits.sort((a, b) => a - b);
    maxText = fits[Math.floor(fits.length / 4)];
  }
  card.forEach((item, i) => {
    const cx = x0 + (i % size) * cell;
    const cy = gy + Math.floor(i / size) * cell;
    if (item === null) {
      ops.push({
        t: 'rect',
        x: cx,
        y: cy,
        w: cell,
        h: cell,
        fill: mix(s.color, 0.18),
      });
      drawText(ops, 'FREE', cx, cy, cell, cell, cell * 0.24, s.color, true);
    } else
      drawText(ops, item, cx, cy, cell, cell, maxText, '#1a1a1a', s.numbers);
  });
  // grid lines: inner thin, outer frame bold
  const parts: string[] = [];
  for (let k = 1; k < size; k++) {
    parts.push(line(x0 + k * cell, gy, x0 + k * cell, gy + gw));
    parts.push(line(x0, gy + k * cell, x0 + gw, gy + k * cell));
  }
  ops.push({
    t: 'path',
    d: parts.join(''),
    stroke: s.color,
    sw: Math.max(0.6, cell * 0.012),
  });
  ops.push({
    t: 'rect',
    x: x0,
    y: y0 + titleH,
    w: gw,
    h: gw + headH,
    stroke: s.color,
    sw: Math.max(1.2, cell * 0.03),
  });
  ops.push({
    t: 'text',
    x: x0 + gw,
    y: gy + gw + footH * 0.95,
    size: Math.min(9, footH * 0.8),
    text: `Card ${no} of ${total}`,
    fill: '#6b6b6b',
    anchor: 'end',
  });
}

function slots(W: number, H: number, per: number) {
  const m = 12 * MM;
  const g = 2 * m;
  if (per === 1) return [{ x: m, y: m, w: W - 2 * m, h: H - 2 * m }];
  if (per === 2) {
    const h = (H - 2 * m - g) / 2;
    return [0, 1].map((i) => ({ x: m, y: m + i * (h + g), w: W - 2 * m, h }));
  }
  const w = (W - 2 * m - g) / 2;
  const h = (H - 2 * m - g) / 2;
  return [0, 1, 2, 3].map((i) => ({
    x: m + (i % 2) * (w + g),
    y: m + Math.floor(i / 2) * (h + g),
    w,
    h,
  }));
}
function cutLines(W: number, H: number, per: number): Op[] {
  if (per === 1) return [];
  const d =
    per === 2
      ? line(8, H / 2, W - 8, H / 2)
      : line(8, H / 2, W - 8, H / 2) + line(W / 2, 8, W / 2, H - 8);
  return [{ t: 'path', d, stroke: '#b5b5b5', sw: 0.5, dash: [4, 3] }];
}

function callerSheets(
  W: number,
  H: number,
  pool: string[],
  s: Style,
  numbers: boolean
): Page[] {
  const m = 14 * MM;
  const pages: Page[] = [];
  let ops: Op[] = [];
  const head = (cont: boolean) => {
    ops.push({
      t: 'text',
      x: m,
      y: m + 14,
      size: 17,
      text: `Caller sheet${cont ? ' (continued)' : ''}`,
      bold: true,
      fill: s.color,
    });
    ops.push({
      t: 'text',
      x: m,
      y: m + 30,
      size: 9,
      text: `${s.title || 'BINGO'} · ${pool.length} ${numbers ? 'numbers' : 'words'} · tick each one as you call it`,
      fill: '#555555',
    });
  };
  head(false);
  const top = m + 48;
  if (numbers) {
    // one column per letter range, like the cards
    const cols = s.size;
    const cw = (W - 2 * m) / cols;
    const rowH = Math.min(30, (H - top - m - 24) / 15);
    for (let c = 0; c < cols; c++) {
      if (s.size === 5)
        ops.push({
          t: 'text',
          x: m + c * cw + cw / 2,
          y: top + 12,
          size: 14,
          text: LETTERS[c],
          bold: true,
          fill: s.color,
          anchor: 'middle',
        });
      for (let i = 0; i < 15; i++) {
        const y = top + 24 + i * rowH;
        const x = m + c * cw + cw / 2 - 22;
        ops.push({
          t: 'rect',
          x,
          y: y + rowH * 0.2,
          w: rowH * 0.55,
          h: rowH * 0.55,
          stroke: '#777777',
          sw: 0.75,
        });
        ops.push({
          t: 'text',
          x: x + rowH * 0.8,
          y: y + rowH * 0.66,
          size: rowH * 0.5,
          text: String(c * 15 + i + 1),
          fill: '#1a1a1a',
        });
      }
    }
    pages.push({ w: W, h: H, ops });
    return pages;
  }
  const colsN = 3;
  const cw = (W - 2 * m) / colsN;
  const rowH = 20;
  const perCol = Math.floor((H - top - m) / rowH);
  pool.forEach((item, i) => {
    const onPage = i % (perCol * colsN);
    if (i > 0 && onPage === 0) {
      pages.push({ w: W, h: H, ops });
      ops = [];
      head(true);
    }
    const c = Math.floor(onPage / perCol);
    const y = top + (onPage % perCol) * rowH;
    const x = m + c * cw;
    ops.push({
      t: 'rect',
      x,
      y: y + 4,
      w: 10,
      h: 10,
      stroke: '#777777',
      sw: 0.75,
    });
    const { size, lines } = fitText(item, cw - 24, rowH, 10.5, 5);
    ops.push({
      t: 'text',
      x: x + 16,
      y: y + 13,
      size,
      text: lines.join(' '),
      fill: '#1a1a1a',
    });
  });
  pages.push({ w: W, h: H, ops });
  return pages;
}

function callingCards(W: number, H: number, items: string[], s: Style): Page[] {
  const m = 10 * MM;
  const cols = 4;
  const rows = 6;
  const cw = (W - 2 * m) / cols;
  const ch = (H - 2 * m) / rows;
  const pages: Page[] = [];
  for (let p = 0; p < items.length; p += cols * rows) {
    const ops: Op[] = [];
    const chunk = items.slice(p, p + cols * rows);
    chunk.forEach((item, i) => {
      const x = m + (i % cols) * cw;
      const y = m + Math.floor(i / cols) * ch;
      drawText(
        ops,
        item,
        x + 4,
        y + 4,
        cw - 8,
        ch - 8,
        ch * (s.numbers ? 0.36 : 0.22),
        '#1a1a1a',
        true
      );
    });
    const d: string[] = [];
    for (let c = 0; c <= cols; c++)
      d.push(line(m + c * cw, m, m + c * cw, H - m));
    for (let r = 0; r <= rows; r++)
      d.push(line(m, m + r * ch, W - m, m + r * ch));
    ops.push({
      t: 'path',
      d: d.join(''),
      stroke: '#b5b5b5',
      sw: 0.5,
      dash: [4, 3],
    });
    pages.push({ w: W, h: H, ops });
  }
  return pages;
}

function build(): Built {
  const src = formVal('source');
  const size = +formVal('size') || 5;
  const free = size % 2 === 1 && formOn('free');
  const numbers = src === 'numbers';
  let count = Math.round(formNum('count', 1, 1000, 30));
  if (CARD_LIMIT) count = Math.min(count, CARD_LIMIT);
  const per = +formVal('per') || 1;
  const [W, H] = PAPER[(formVal('paper') || 'a4') as Paper];
  const style: Style = {
    color: formVal('color') || '#c2410c',
    title: formVal('title').trim().slice(0, 60),
    numbers,
    textScale: { s: 0.8, m: 1, l: 1.25 }[formVal('text')] ?? 1,
    size,
  };
  const pool = numbers
    ? null
    : src === 'theme'
      ? (THEMES[formVal('theme')]?.words ?? THEMES.animals.words)
      : userWords();
  const need = cellsNeeded(size);
  if (pool && pool.length < need)
    return {
      pages: [],
      summary: '',
      error: `A ${size}×${size} card needs ${need} different words. Add ${need - pool.length} more, one per line.`,
    };
  const cards = makeCards(count, size, free, pool, rng(seed));
  if (typeof cards === 'string')
    return { pages: [], summary: '', error: cards };

  const pages: Page[] = [];
  const sl = slots(W, H, per);
  for (let i = 0; i < cards.length; i += per) {
    const ops: Op[] = cutLines(W, H, per);
    cards
      .slice(i, i + per)
      .forEach((c, k) =>
        drawCard(ops, c, i + k + 1, cards.length, sl[k], style)
      );
    pages.push({ w: W, h: H, ops });
  }
  const cardPages = pages.length;
  const all = numbers
    ? Array.from({ length: size * 15 }, (_, i) => String(i + 1))
    : pool!;
  let extra = '';
  if (formOn('caller')) {
    const cs = callerSheets(W, H, all, style, numbers);
    pages.push(...cs);
    extra += ` + caller sheet`;
  }
  if (formOn('calls')) {
    const labels =
      numbers && size === 5
        ? all.map((n) => `${LETTERS[Math.floor((+n - 1) / 15)]} ${n}`)
        : all;
    const cc = callingCards(W, H, labels, style);
    pages.push(...cc);
    extra += ` + ${cc.length} ${cc.length === 1 ? 'page' : 'pages'} of calling cards`;
  }
  return {
    pages,
    summary: `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} on ${cardPages} ${cardPages === 1 ? 'page' : 'pages'}${extra}`,
  };
}

syncControls();
const gen = mountGenerator({
  tool: 'bingo-card-generator',
  title: 'Bingo cards',
  fileName: () => `bingo-cards-${formVal('size')}x${formVal('size')}.pdf`,
  previewMax: 4,
  build,
});
