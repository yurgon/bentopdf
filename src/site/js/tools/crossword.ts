// Crossword puzzle maker: words and clues in, a crossing grid with numbered squares out,
// on a puzzle sheet and a separate answer key. Drawn in the browser, printed or saved as PDF.
import {
  mountGenerator,
  formVal,
  formOn,
  presetPaper,
  type Built,
} from '../print/gen';
import {
  PAPER,
  MM,
  measure,
  type Op,
  type Page,
  type Paper,
} from '../print/sheet';
import {
  buildCrossword,
  enumeration,
  parsePairs,
  type Crossword,
} from '../print/teach-core';
import { sheetHead, wrapAt, INK, SOFT } from '../print/teach-draw';
import { t, tn, tp } from '../i18n';

/** Most words in one puzzle. null = no limit (the brief keeps the switch, turned off). */
const WORD_LIMIT: number | null = null;

presetPaper();
const info = document.getElementById('words-info')!;

let seed = (Math.random() * 2 ** 31) | 0;
document.getElementById('rebuild-btn')!.addEventListener('click', () => {
  seed = (Math.random() * 2 ** 31) | 0;
  gen.refresh();
});

// the grid takes a moment for long lists: keep the last one while only the paper or title changes
let cache: { key: string; cw: Crossword } | null = null;
function crossword(items: { word: string; clue: string }[]): Crossword {
  const key =
    seed +
    '\u0002' +
    items.map((i) => i.word + '\u0001' + i.clue).join('\u0002');
  if (cache?.key !== key) cache = { key, cw: buildCrossword(items, seed) };
  return cache.cw;
}

function drawGrid(
  ops: Op[],
  cw: Crossword,
  x0: number,
  y0: number,
  cell: number,
  answers: boolean
) {
  for (let i = 0; i < cw.cells.length; i++) {
    if (!cw.cells[i]) continue;
    const x = x0 + (i % cw.w) * cell;
    const y = y0 + Math.floor(i / cw.w) * cell;
    ops.push({
      t: 'rect',
      x,
      y,
      w: cell,
      h: cell,
      fill: '#ffffff',
      stroke: INK,
      sw: Math.max(0.6, cell * 0.035),
    });
    if (cw.nums[i])
      ops.push({
        t: 'text',
        x: x + cell * 0.07,
        y: y + cell * 0.3,
        size: Math.max(4.5, cell * 0.27),
        text: String(cw.nums[i]),
        fill: INK,
      });
    if (answers)
      ops.push({
        t: 'text',
        x: x + cell / 2,
        y: y + cell * 0.76,
        size: cell * 0.56,
        text: cw.cells[i],
        fill: INK,
        bold: true,
        anchor: 'middle',
      });
  }
}

interface Item {
  num: string;
  lines: string[];
  head?: boolean;
}
function clueItems(
  cw: Crossword,
  across: boolean,
  colW: number,
  size: number
): Item[] {
  const indent = measure('00', size, true) + 6;
  const items: Item[] = [
    { num: '', lines: [across ? tp('Across') : tp('Down')], head: true },
  ];
  for (const e of cw.entries.filter((e) => e.across === across)) {
    const en = enumeration(e.shown);
    const text = (e.clue || '') + (en ? ` (${en})` : '');
    items.push({
      num: String(e.num),
      lines: wrapAt(text, colW - indent, size),
    });
  }
  return items;
}
const itemH = (it: Item, size: number) =>
  it.head ? size * 1.9 : it.lines.length * size * 1.25 + size * 0.45;
const colH = (items: Item[], size: number) =>
  items.reduce((s, it) => s + itemH(it, size), 0);

function build(): Built {
  const [W, H] = PAPER[(formVal('paper') || 'a4') as Paper];
  const m = 15 * MM;
  const title = formVal('title').trim().slice(0, 80) || tp('Crossword');
  const nameLine = formOn('nameline');
  const head = { nameLine, name: tp('Name'), date: tp('Date') };
  let items = parsePairs(formVal('words'))
    .map((p) => ({ word: p.a, clue: p.b }))
    .filter((p) => [...p.word.replace(/[^\p{L}]/gu, '')].length >= 2);
  if (WORD_LIMIT) items = items.slice(0, WORD_LIMIT);
  const noClue = items.filter((i) => !i.clue).length;
  if (items.length < 2) {
    info.textContent = '';
    return {
      pages: [],
      summary: '',
      error: t(
        'Add at least two words, one per line, each with its clue: word - clue.'
      ),
    };
  }
  const cw = crossword(items);
  info.textContent = [
    tn(cw.entries.length, '{n} word in the grid.', '{n} words in the grid.'),
    cw.left.length
      ? t(
          'Did not fit: {words}. Press “Rebuild grid” or add words that share letters.',
          {
            words: cw.left.map((l) => l.shown).join(', '),
          }
        )
      : '',
    noClue
      ? tn(noClue, '{n} word has no clue yet.', '{n} words have no clue yet.')
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const pages: Page[] = [];
  const gap = 18;
  const colW = (W - 2 * m - gap) / 2;
  const bank = formOn('bank');

  // puzzle sheet: the largest grid that still leaves room for the clues on the page
  let ops: Op[] = [];
  const top = sheetHead(ops, W, m, title, head);
  const maxCell = Math.min(30, (W - 2 * m) / cw.w);
  let size = 10.5;
  let cell = maxCell;
  let across: Item[] = [];
  let down: Item[] = [];
  let bankLines: string[] = [];
  const bankText = cw.entries
    .map((e) => e.shown.toLocaleUpperCase())
    .sort((a, b) => a.localeCompare(b))
    .join('     ');
  search: for (const s of [12, 11, 10, 9]) {
    across = clueItems(cw, true, colW, s);
    down = clueItems(cw, false, colW, s);
    bankLines = bank ? wrapAt(bankText, W - 2 * m, s) : [];
    const need =
      Math.max(colH(across, s), colH(down, s)) +
      (bank ? bankLines.length * s * 1.4 + s * 2.2 : 0);
    for (let c = maxCell; c >= 13; c -= 0.5) {
      if (top + c * cw.h + 22 + need <= H - m) {
        size = s;
        cell = c;
        break search;
      }
    }
    size = s;
    cell = Math.max(13, Math.min(maxCell, (H - m - top - 22 - need) / cw.h));
  }
  const gx = m + (W - 2 * m - cell * cw.w) / 2;
  drawGrid(ops, cw, gx, top, cell, false);
  let y = top + cell * cw.h + 22;
  if (bank) {
    ops.push({
      t: 'text',
      x: m,
      y: y + size * 0.4,
      size: size * 0.9,
      text: tp('Word bank'),
      bold: true,
      fill: SOFT,
    });
    y += size * 1.6;
    for (const l of bankLines) {
      ops.push({
        t: 'text',
        x: m,
        y: y + size * 0.4,
        size,
        text: l,
        fill: INK,
      });
      y += size * 1.4;
    }
    y += size * 0.8;
  }
  // two columns, Across and Down; a column that runs out of room continues on the next page
  const cols = [
    { x: m, items: across, i: 0 },
    { x: m + colW + gap, items: down, i: 0 },
  ];
  let startY = y;
  const indent = measure('00', size, true) + 6;
  for (;;) {
    for (const col of cols) {
      let cy = startY;
      while (col.i < col.items.length) {
        const it = col.items[col.i];
        const h = itemH(it, size);
        if (cy + h > H - m && cy > startY) break;
        if (it.head)
          ops.push({
            t: 'text',
            x: col.x,
            y: cy + size,
            size: size * 1.15,
            text: it.lines[0],
            bold: true,
            fill: INK,
          });
        else {
          ops.push({
            t: 'text',
            x: col.x,
            y: cy + size,
            size,
            text: it.num,
            bold: true,
            fill: INK,
          });
          it.lines.forEach((l, k) =>
            ops.push({
              t: 'text',
              x: col.x + indent,
              y: cy + size + k * size * 1.25,
              size,
              text: l,
              fill: INK,
            })
          );
        }
        cy += h;
        col.i++;
      }
    }
    pages.push({ w: W, h: H, ops });
    if (cols.every((c) => c.i >= c.items.length)) break;
    ops = [];
    startY = sheetHead(ops, W, m, `${title} ${tp('(continued)')}`, {
      ...head,
      nameLine: false,
    });
  }

  // answer key: the same grid, filled in, as large as the page allows
  if (formOn('key')) {
    const kops: Op[] = [];
    const ktop = sheetHead(kops, W, m, title, {
      ...head,
      nameLine: false,
      tag: tp('ANSWER KEY'),
    });
    const kcell = Math.min(34, (W - 2 * m) / cw.w, (H - m - ktop - 10) / cw.h);
    drawGrid(kops, cw, m + (W - 2 * m - kcell * cw.w) / 2, ktop, kcell, true);
    pages.push({ w: W, h: H, ops: kops });
  }

  return {
    pages,
    summary: `${tn(cw.entries.length, '{n} word', '{n} words')} · ${cw.w}×${cw.h} · ${tn(pages.length, '{n} page', '{n} pages')}`,
  };
}

const gen = mountGenerator({
  tool: 'crossword-puzzle-maker',
  title: t('Crossword'),
  fileName: () => 'crossword.pdf',
  previewMax: 3,
  build,
});
