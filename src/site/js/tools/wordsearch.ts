// Word search maker: a word list in, puzzles out, as many different versions as the class
// needs, each with its answer key. Drawn in the browser, printed or saved as PDF.
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
  measure,
  line,
  type Op,
  type Page,
  type Paper,
} from '../print/sheet';
import {
  buildWordSearch,
  autoSize,
  lettersOf,
  type Level,
  type WordSearch,
} from '../print/teach-core';
import { sheetHead, wrapAt, INK, SOFT } from '../print/teach-draw';
import { t, tn, tp } from '../i18n';

/** Most words in one puzzle. null = no limit (the brief keeps the switch, turned off). */
const WORD_LIMIT: number | null = null;
/** Most versions in one set. null = no limit (switched off). */
const VERSION_LIMIT: number | null = null;

presetPaper();
const info = document.getElementById('words-info')!;
let seed = (Math.random() * 2 ** 31) | 0;
document.getElementById('rebuild-btn')!.addEventListener('click', () => {
  seed = (Math.random() * 2 ** 31) | 0;
  gen.refresh();
});

function userWords(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of formVal('words').split(/\r?\n|[,;]/)) {
    const w = raw.trim().replace(/\s+/g, ' ');
    const k = lettersOf(w);
    if ([...k].length >= 2 && !seen.has(k)) {
      seen.add(k);
      out.push(w);
    }
  }
  return WORD_LIMIT ? out.slice(0, WORD_LIMIT) : out;
}

const cache = new Map<string, WordSearch>();
function puzzle(
  words: string[],
  size: number,
  level: Level,
  s: number
): WordSearch {
  const key = [s, size, level, ...words].join('\u0001');
  let p = cache.get(key);
  if (!p) {
    if (cache.size > 200) cache.clear();
    p = buildWordSearch(words, size, level, s);
    cache.set(key, p);
  }
  return p;
}

function drawGrid(
  ops: Op[],
  p: WordSearch,
  x0: number,
  y0: number,
  cell: number,
  key: boolean
) {
  const n = p.size;
  ops.push({
    t: 'rect',
    x: x0 - cell * 0.15,
    y: y0 - cell * 0.15,
    w: cell * (n + 0.3),
    h: cell * (n + 0.3),
    stroke: INK,
    sw: Math.max(0.8, cell * 0.04),
  });
  if (key)
    for (const f of p.found) {
      const ax = x0 + (f.x + 0.5) * cell;
      const ay = y0 + (f.y + 0.5) * cell;
      const bx = x0 + (f.x + f.dx * (f.len - 1) + 0.5) * cell;
      const by = y0 + (f.y + f.dy * (f.len - 1) + 0.5) * cell;
      ops.push({
        t: 'path',
        d: line(ax, ay, bx, by),
        stroke: '#f2b134',
        sw: cell * 0.72,
        cap: 'round',
        opacity: 0.45,
      });
    }
  for (let i = 0; i < n * n; i++)
    ops.push({
      t: 'text',
      x: x0 + (i % n) * cell + cell / 2,
      y: y0 + Math.floor(i / n) * cell + cell * 0.7,
      size: cell * 0.56,
      text: p.grid[i],
      fill: INK,
      anchor: 'middle',
    });
}

function wordList(
  ops: Op[],
  words: string[],
  x: number,
  y: number,
  w: number,
  size: number
): number {
  const sorted = words.slice().sort((a, b) => a.localeCompare(b));
  const widest =
    Math.max(...sorted.map((s) => measure(s.toLocaleUpperCase(), size))) + 22;
  const cols = Math.max(1, Math.min(4, Math.floor(w / widest)));
  const rows = Math.ceil(sorted.length / cols);
  const cw = w / cols;
  sorted.forEach((s, i) => {
    const cx = x + Math.floor(i / rows) * cw;
    const cy = y + (i % rows) * size * 1.55;
    ops.push({
      t: 'rect',
      x: cx,
      y: cy - size * 0.72,
      w: size * 0.75,
      h: size * 0.75,
      stroke: SOFT,
      sw: 0.6,
    });
    ops.push({
      t: 'text',
      x: cx + size * 1.25,
      y: cy,
      size,
      text: wrapAt(s.toLocaleUpperCase(), cw - size * 1.6, size)[0],
      fill: INK,
    });
  });
  return rows * size * 1.55;
}

function build(): Built {
  const [W, H] = PAPER[(formVal('paper') || 'a4') as Paper];
  const m = 15 * MM;
  const words = userWords();
  if (words.length < 2) {
    info.textContent = '';
    return {
      pages: [],
      summary: '',
      error: t('Add at least two words, one per line.'),
    };
  }
  const sizeSel = formVal('size');
  const size = sizeSel === 'auto' ? autoSize(words) : +sizeSel || 15;
  const level = (formVal('level') || 'medium') as Level;
  let versions = Math.round(formNum('versions', 1, 100, 1));
  if (VERSION_LIMIT) versions = Math.min(versions, VERSION_LIMIT);
  const title = formVal('title').trim().slice(0, 80) || tp('Word search');
  const head = {
    nameLine: formOn('nameline'),
    name: tp('Name'),
    date: tp('Date'),
  };
  const showList = formOn('list');

  const puzzles = Array.from({ length: versions }, (_, v) =>
    puzzle(words, size, level, seed + v * 7919)
  );
  const left = new Set(puzzles.flatMap((p) => p.left));
  info.textContent =
    tn(words.length, '{n} word.', '{n} words.') +
    (left.size
      ? ' ' +
        t('Did not fit: {words}. Choose a bigger grid or fewer words.', {
          words: [...left].join(', '),
        })
      : '');

  const pages: Page[] = [];
  const label = (v: number) =>
    versions > 1 ? tp('VERSION {n}', { n: v + 1 }) : undefined;
  puzzles.forEach((p, v) => {
    const ops: Op[] = [];
    const top = sheetHead(ops, W, m, title, { ...head, tag: label(v) });
    const placed = p.found.map((f) => f.word);
    const listSize = placed.length > 24 ? 9.5 : 11;
    // reserve room for the word list under the grid
    const est = showList
      ? Math.ceil(
          placed.length /
            Math.max(
              1,
              Math.min(
                4,
                Math.floor(
                  (W - 2 * m) /
                    (Math.max(
                      ...placed.map((s) =>
                        measure(s.toLocaleUpperCase(), listSize)
                      )
                    ) +
                      22)
                )
              )
            )
        ) *
          listSize *
          1.55 +
        40
      : 0;
    const cell = Math.min(
      34,
      (W - 2 * m) / (size + 0.3),
      (H - m - top - 10 - est) / (size + 0.3)
    );
    const gx = m + (W - 2 * m - cell * size) / 2;
    drawGrid(ops, p, gx, top + cell * 0.15, cell, false);
    if (showList) {
      const ly = top + cell * (size + 0.3) + 26;
      ops.push({
        t: 'text',
        x: m,
        y: ly,
        size: 10,
        text: tp('Find these words'),
        bold: true,
        fill: SOFT,
      });
      wordList(ops, placed, m, ly + listSize * 1.9, W - 2 * m, listSize);
    }
    pages.push({ w: W, h: H, ops });
  });

  // answer keys: one big key for a single puzzle, four smaller keys per page for a class set
  if (formOn('key')) {
    const per = versions === 1 ? 1 : 4;
    for (let i = 0; i < puzzles.length; i += per) {
      const ops: Op[] = [];
      const top = sheetHead(ops, W, m, title, {
        ...head,
        nameLine: false,
        tag: tp('ANSWER KEY'),
      });
      const chunk = puzzles.slice(i, i + per);
      if (per === 1) {
        const cell = Math.min(
          34,
          (W - 2 * m) / (size + 0.3),
          (H - m - top - 10) / (size + 0.3)
        );
        drawGrid(
          ops,
          chunk[0],
          m + (W - 2 * m - cell * size) / 2,
          top + cell * 0.15,
          cell,
          true
        );
      } else {
        const g = 16;
        const bw = (W - 2 * m - g) / 2;
        const bh = (H - m - top - g) / 2;
        chunk.forEach((p, k) => {
          const bx = m + (k % 2) * (bw + g);
          const by = top + Math.floor(k / 2) * (bh + g);
          ops.push({
            t: 'text',
            x: bx,
            y: by + 9,
            size: 9,
            text: tp('VERSION {n}', { n: i + k + 1 }),
            bold: true,
            fill: SOFT,
          });
          const cell = Math.min(bw / (size + 0.3), (bh - 20) / (size + 0.3));
          drawGrid(
            ops,
            p,
            bx + (bw - cell * size) / 2,
            by + 18 + cell * 0.15,
            cell,
            true
          );
        });
      }
      pages.push({ w: W, h: H, ops });
    }
  }
  return {
    pages,
    summary: `${tn(versions, '{n} puzzle', '{n} puzzles')} · ${size}×${size} · ${tn(pages.length, '{n} page', '{n} pages')}`,
  };
}

const gen = mountGenerator({
  tool: 'word-search-maker',
  title: t('Word search'),
  fileName: () => `word-search-${formVal('level') || 'medium'}.pdf`,
  previewMax: 4,
  build,
});
