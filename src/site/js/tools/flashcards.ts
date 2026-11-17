// Flashcard maker: terms and definitions in, sheets of cards out. Fronts and backs alternate
// page by page and the backs are mirrored, so a two-sided print puts each definition right
// behind its term. Drawn in the browser, printed or saved as PDF.
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
  fitText,
  line,
  type Op,
  type Page,
  type Paper,
} from '../print/sheet';
import { parsePairs, cardSlots, type CardSlot } from '../print/teach-core';
import { INK, SOFT } from '../print/teach-draw';
import { t, tn } from '../i18n';

/** Most cards in one set. null = no limit (the brief keeps the switch, turned off). */
const CARD_LIMIT: number | null = null;

presetPaper();
const info = document.getElementById('words-info')!;
const MARGIN = 10 * MM;

function drawText(
  ops: Op[],
  text: string,
  s: CardSlot,
  maxSize: number,
  bold: boolean
) {
  const pad = Math.min(s.w, s.h) * 0.1;
  const { size, lines } = fitText(
    text,
    s.w - 2 * pad,
    s.h - 2 * pad - 12,
    maxSize,
    6,
    bold,
    1.2
  );
  const lh = size * 1.2;
  const top = s.y + s.h / 2 - (lines.length * lh) / 2 + size * 0.8;
  lines.forEach((l, i) =>
    ops.push({
      t: 'text',
      x: s.x + s.w / 2,
      y: top + i * lh,
      size,
      text: l,
      fill: INK,
      bold,
      anchor: 'middle',
    })
  );
}

/** Dashed lines along every card edge, the same on both sides of the sheet. */
function cutLines(W: number, H: number, per: number): Op {
  const slots = cardSlots(W, H, per, MARGIN, 'front', 'long');
  const xs = [...new Set(slots.flatMap((s) => [s.x, s.x + s.w]))];
  const ys = [...new Set(slots.flatMap((s) => [s.y, s.y + s.h]))];
  const d = [
    ...xs.map((x) => line(x, MARGIN * 0.35, x, H - MARGIN * 0.35)),
    ...ys.map((y) => line(MARGIN * 0.35, y, W - MARGIN * 0.35, y)),
  ].join('');
  return { t: 'path', d, stroke: '#b5b5b5', sw: 0.5, dash: [4, 3] };
}

function build(): Built {
  const [W, H] = PAPER[(formVal('paper') || 'a4') as Paper];
  const per = +formVal('per') || 8;
  const flip = (formVal('flip') || 'long') as 'long' | 'short';
  const swap = formOn('swap');
  const cuts = formOn('cuts');
  const deck = formVal('title').trim().slice(0, 60);
  const scale = { s: 0.8, m: 1, l: 1.25 }[formVal('text')] ?? 1;
  let pairs = parsePairs(formVal('pairs'));
  if (CARD_LIMIT) pairs = pairs.slice(0, CARD_LIMIT);
  if (!pairs.length) {
    info.textContent = '';
    return {
      pages: [],
      summary: '',
      error: t('Add at least one card: a term and its definition on one line.'),
    };
  }
  const empty = pairs.filter((p) => !p.b).length;
  const sheets = Math.ceil(pairs.length / per);
  info.textContent =
    tn(pairs.length, '{n} card', '{n} cards') +
    ' · ' +
    tn(sheets, '{n} sheet of paper', '{n} sheets of paper') +
    (empty
      ? ' · ' +
        tn(empty, '{n} card has no back yet.', '{n} cards have no back yet.')
      : '');

  const front = cardSlots(W, H, per, MARGIN, 'front', flip);
  const back = cardSlots(W, H, per, MARGIN, 'back', flip);
  const cut = cutLines(W, H, per);
  const pages: Page[] = [];
  const termSize = { 4: 34, 6: 30, 8: 26 }[per]! * scale;
  const defSize = { 4: 20, 6: 17, 8: 15 }[per]! * scale;
  for (let i = 0; i < pairs.length; i += per) {
    const chunk = pairs.slice(i, i + per);
    const f: Op[] = cuts ? [cut] : [];
    const b: Op[] = cuts ? [cut] : [];
    chunk.forEach((p, k) => {
      const [ft, bt] = swap ? [p.b, p.a] : [p.a, p.b];
      const no = String(i + k + 1);
      drawText(f, ft, front[k], swap ? defSize : termSize, !swap);
      drawText(b, bt, back[k], swap ? termSize : defSize, swap);
      // the same number on both sides: an easy check that the backs line up
      for (const [ops, s] of [
        [f, front[k]],
        [b, back[k]],
      ] as [Op[], CardSlot][]) {
        ops.push({
          t: 'text',
          x: s.x + s.w - 8,
          y: s.y + s.h - 7,
          size: 7,
          text: no,
          fill: SOFT,
          anchor: 'end',
        });
        if (deck && ops === f)
          ops.push({
            t: 'text',
            x: s.x + 8,
            y: s.y + s.h - 7,
            size: 7,
            text: deck,
            fill: SOFT,
          });
      }
    });
    pages.push({ w: W, h: H, ops: f }, { w: W, h: H, ops: b });
  }
  return {
    pages,
    summary: `${tn(pairs.length, '{n} card', '{n} cards')} · ${tn(pages.length, '{n} page', '{n} pages')} · ${
      flip === 'long' ? t('flip on the long edge') : t('flip on the short edge')
    }`,
  };
}

mountGenerator({
  tool: 'flashcard-maker',
  title: t('Flashcards'),
  fileName: () => `flashcards-${per()}-per-page.pdf`,
  previewMax: 4,
  build,
});
function per() {
  return formVal('per') || '8';
}
