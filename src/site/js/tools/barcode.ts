// Barcode generator: UPC-A, EAN-13, Code 128, Code 39, ITF-14 and QR. One code, a list or a
// numbered range; separate files (PNG, SVG, PDF, ZIP) or a sheet of self-adhesive labels.
// Bars come from bwip-js; drawing, PDF and print use the same vector sheets as the other tools.
import bwip from 'bwip-js/browser';
import {
  mountGenerator,
  formVal,
  formNum,
  formOn,
  defaultPaper,
  type Built,
} from '../print/gen';
import {
  PAPER,
  MM,
  FONT_FAMILY,
  fitText,
  pageToSvg,
  loadFonts,
  download,
  line,
  type Op,
  type Page,
  type Paper,
} from '../print/sheet';
import {
  checkValue,
  encode,
  isProblem,
  rangeValues,
  labelSlots,
  SHEETS,
  type Kind,
  type Problem,
  type Sym,
  type LabelSheet,
  type RawEncoder,
} from '../print/barcode-core';
import { t, tn, tp } from '../i18n';

/** Most codes in one batch. null = no limit (the brief keeps the switch, turned off). */
const BATCH_LIMIT: number | null = null;

// the named export `raw` takes an options object; the default export has the (bcid, text, opts) form
const raw = (bwip as unknown as { raw: RawEncoder }).raw;
const form = document.getElementById('gen-form') as HTMLFormElement;
const info = document.getElementById('words-info')!;
const $in = (name: string) =>
  form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;

// ---------- defaults per type ----------
const SIZE: Record<Kind, [number, number]> = {
  upca: [31.4, 22],
  ean13: [31.4, 22],
  code128: [40, 15],
  code39: [50, 15],
  itf14: [80, 25],
  qr: [30, 30],
};
const EXAMPLE: Record<Kind, string> = {
  upca: '03600029145',
  ean13: '590123412345',
  code128: 'SKU-00125',
  code39: 'PART-0042',
  itf14: '1540014128876',
  qr: 'https://plyleaf.com',
};
let lastKind = formVal('kind') as Kind;
function syncControls(e?: Event): void {
  const kind = formVal('kind') as Kind;
  if (kind !== lastKind) {
    // a new type: its usual size, and an example that fits it
    $in('width').value = String(SIZE[kind][0]);
    $in('height').value = String(SIZE[kind][1]);
    const one = $in('value');
    if (!one.value.trim() || one.value === EXAMPLE[lastKind])
      one.value = EXAMPLE[kind];
    const from = $in('from');
    if (!from.value.trim() || from.value === EXAMPLE[lastKind])
      from.value = EXAMPLE[kind];
    lastKind = kind;
  }
  const src = formVal('source');
  const layout = formVal('layout');
  form
    .querySelectorAll<HTMLElement>('[data-source]')
    .forEach((el) => (el.hidden = el.dataset.source !== src));
  form
    .querySelectorAll<HTMLElement>('[data-kind]')
    .forEach((el) => (el.hidden = !el.dataset.kind!.split(' ').includes(kind)));
  document
    .querySelectorAll<HTMLElement>('[data-layout]')
    .forEach((el) => (el.hidden = el.dataset.layout !== layout));
  $in('captext').closest<HTMLElement>('.field')!.hidden =
    formVal('caption') !== 'text';
  document.getElementById('test-btn')!.hidden = layout !== 'labels';
  // a preset fills the label fields; editing a field makes the sheet custom
  const target = e?.target as HTMLElement | undefined;
  if (target?.getAttribute('name') === 'sheet') fillSheet();
  else if (target?.closest('[data-sheet-field]'))
    (form.querySelector('select[name="sheet"]') as HTMLSelectElement).value =
      'custom';
}

const sheetSel = form.querySelector<HTMLSelectElement>('select[name="sheet"]')!;
sheetSel.innerHTML =
  `<optgroup label="Letter">${SHEETS.filter((s) => s.paper === 'letter')
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join('')}</optgroup>` +
  `<optgroup label="A4">${SHEETS.filter((s) => s.paper === 'a4')
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join('')}</optgroup>` +
  `<option value="custom">${t('My own sizes')}</option>`;
sheetSel.value = defaultPaper() === 'letter' ? 'l-30' : 'a-24';
const FIELDS = ['cols', 'rows', 'lw', 'lh', 'top', 'left', 'hp', 'vp'] as const;
function fillSheet(): void {
  const s = SHEETS.find((x) => x.id === sheetSel.value);
  if (!s) return;
  const v = [s.cols, s.rows, s.w, s.h, s.top, s.left, s.hp, s.vp];
  FIELDS.forEach(
    (f, i) => ($in(f).value = String(Math.round(v[i] * 100) / 100))
  );
  const p = form.querySelector<HTMLInputElement>(
    `input[name="lpaper"][value="${s.paper}"]`
  );
  if (p) p.checked = true;
}
fillSheet();
const pp = form.querySelector<HTMLInputElement>(
  `input[name="paper"][value="${defaultPaper()}"]`
);
if (pp) pp.checked = true;
form.addEventListener('input', syncControls, true);
form.addEventListener('change', syncControls, true);

function sheet(): LabelSheet {
  const n = (f: string, min: number, max: number, def: number) =>
    formNum(f, min, max, def);
  return {
    id: 'form',
    name: '',
    paper: (formVal('lpaper') || 'a4') as Paper,
    cols: Math.round(n('cols', 1, 20, 3)),
    rows: Math.round(n('rows', 1, 40, 8)),
    w: n('lw', 5, 300, 63.5),
    h: n('lh', 5, 300, 33.9),
    top: n('top', 0, 200, 10),
    left: n('left', 0, 200, 5),
    hp: n('hp', 5, 300, 66),
    vp: n('vp', 5, 300, 34),
  };
}

// ---------- values ----------
function problemText(p: Problem, kind: Kind): string {
  const name = KIND_NAME[kind];
  switch (p.error) {
    case 'empty':
      return t('Type a value to encode.');
    case 'digits':
      return t('{name} holds digits only.', { name });
    case 'length':
      return t(
        '{name} needs {a} digits (the check digit is added) or {b} digits with the check digit. This has {n}.',
        { name, ...p.vars }
      );
    case 'check':
      return t(
        'The check digit should be {should}, not {given}. Check the number, or leave out the last digit and it will be added.',
        p.vars
      );
    case 'chars':
      return t(
        'Code 39 cannot hold {chars}. It takes A to Z, 0 to 9, space and - . $ / + %.',
        p.vars
      );
    case 'ascii':
      return t(
        'Code 128 holds plain Latin letters, digits and common symbols only. Use QR for other text.'
      );
    case 'toolong':
      return t('Too long: at most {max} characters for this type.', p.vars);
  }
}
const KIND_NAME: Record<Kind, string> = {
  upca: 'UPC-A',
  ean13: 'EAN-13',
  code128: 'Code 128',
  code39: 'Code 39',
  itf14: 'ITF-14',
  qr: 'QR',
};

interface Item {
  value: string;
  extra: string;
}
function items(kind: Kind): Item[] | string {
  const src = formVal('source');
  const extra =
    formVal('caption') === 'text' ? formVal('captext').trim().slice(0, 60) : '';
  let list: Item[];
  if (src === 'one') list = [{ value: formVal('value'), extra }];
  else if (src === 'list')
    list = formVal('list')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        const [v, c] = l.split('\t');
        return {
          value: v.trim(),
          extra: (c ?? '').trim().slice(0, 60) || extra,
        };
      });
  else {
    const r = rangeValues(
      kind,
      formVal('from'),
      Math.round(formNum('count', 1, 100000, 50))
    );
    if (isProblem(r)) return problemText(r, kind);
    list = r.map((value) => ({ value, extra }));
  }
  if (BATCH_LIMIT) list = list.slice(0, BATCH_LIMIT);
  return list;
}

// ---------- drawing ----------
const symCache = new Map<string, Sym>();
function symbol(kind: Kind, value: string): Sym | string {
  const c = checkValue(kind, value);
  if (isProblem(c)) return problemText(c, kind);
  const opts = {
    code39check: formOn('c39check'),
    qrLevel: (formVal('eclevel') || 'M') as 'L' | 'M' | 'Q' | 'H',
  };
  const key = [kind, c.data, opts.code39check, opts.qrLevel].join('\u0001');
  let s = symCache.get(key);
  if (!s) {
    try {
      s = encode(raw, kind, c, opts);
    } catch (e) {
      const msg = String((e as Error).message || e);
      return /too ?long|capacity|exceed/i.test(msg)
        ? t('Too long for one QR code. Shorten the text.')
        : t('This value cannot be encoded: {why}', {
            why: msg.replace(/^bwipp\.\w+#\d+:\s*/, ''),
          });
    }
    if (symCache.size > 2000) symCache.clear();
    symCache.set(key, s);
  }
  return s;
}

interface Drawn {
  ops: Op[];
  w: number;
  h: number;
  /** module width in mm, to warn about bars too thin to scan */
  x: number;
}
/** One code at the origin, in points. */
function drawCode(
  s: Sym,
  widthMm: number,
  heightMm: number,
  marginMm: number | null,
  extra: string
): Drawn {
  const ops: Op[] = [];
  const showNum = formVal('caption') !== 'none';
  const ink = '#000000';
  if (s.type === 'matrix') {
    const size = widthMm * MM;
    const mod = size / s.size;
    const q = marginMm ?? (s.quiet * mod) / MM;
    const m = q * MM;
    const d: string[] = [];
    for (let y = 0; y < s.size; y++) {
      let x = 0;
      while (x < s.size) {
        if (!s.dark[y * s.size + x]) {
          x++;
          continue;
        }
        let e = x;
        while (e < s.size && s.dark[y * s.size + e]) e++;
        d.push(
          `M${f(m + x * mod)} ${f(m + y * mod)}h${f((e - x) * mod)}v${f(mod)}h${f(-(e - x) * mod)}z`
        );
        x = e;
      }
    }
    ops.push({ t: 'path', d: d.join(''), fill: ink });
    let h = m + size;
    const lines = [
      showNum && formVal('caption') === 'number' ? s.text : '',
      extra,
    ].filter(Boolean);
    for (const l of lines) {
      const { size: ts, lines: ll } = fitText(l, size, 14, 9, 4.5);
      h += ts * 1.3;
      ops.push({
        t: 'text',
        x: m + size / 2,
        y: h,
        size: ts,
        text: ll[0] + (ll.length > 1 ? '…' : ''),
        fill: ink,
        anchor: 'middle',
      });
    }
    h += lines.length ? m * 0.6 : m;
    return { ops, w: size + 2 * m, h, x: mod / MM };
  }
  const X = (widthMm * MM) / s.modules;
  const barH = heightMm * MM;
  const itf = s.kind === 'itf14' && formOn('bearer');
  const bt = itf ? 3 * X : 0;
  const outer = marginMm === null ? 0 : marginMm * MM;
  const left =
    (marginMm === null ? s.quiet[0] * X : outer + (itf ? s.quiet[0] * X : 0)) +
    bt;
  const right =
    (marginMm === null ? s.quiet[1] * X : outer + (itf ? s.quiet[1] * X : 0)) +
    bt;
  const top = (marginMm === null ? 2 * X : outer) + bt;
  const retail =
    (s.kind === 'ean13' || s.kind === 'upca') &&
    formVal('caption') === 'number';
  const ts = Math.max(5, Math.min(14, X * 9));
  const ext = retail ? ts * 0.55 : 0;
  // bars as one filled path
  const d: string[] = [];
  let x = left;
  let bar = 0;
  s.widths.forEach((w, i) => {
    if (i % 2 === 0) {
      const h = barH + (s.long.has(bar) ? ext : 0);
      d.push(`M${f(x)} ${f(top)}h${f(w * X)}v${f(h)}h${f(-w * X)}z`);
      bar++;
    }
    x += w * X;
  });
  ops.push({ t: 'path', d: d.join(''), fill: ink });
  const bw = s.modules * X;
  if (itf) {
    const fx = left - s.quiet[0] * X - bt;
    const fw = bw + (s.quiet[0] + s.quiet[1]) * X + 2 * bt;
    const fy = top - bt;
    ops.push({
      t: 'path',
      d: `M${f(fx)} ${f(fy)}h${f(fw)}v${f(bt)}h${f(-fw)}z M${f(fx)} ${f(top + barH)}h${f(fw)}v${f(bt)}h${f(-fw)}z M${f(fx)} ${f(top)}h${f(bt)}v${f(barH)}h${f(-bt)}z M${f(fx + fw - bt)} ${f(top)}h${f(bt)}v${f(barH)}h${f(-bt)}z`,
      fill: ink,
    });
  }
  let h = top + barH + bt;
  if (retail) {
    const base = top + barH + ts * 0.95;
    const tx = (m: number) => left + m * X;
    const dg = s.text;
    const put = (text: string, at: number, size = ts) =>
      ops.push({
        t: 'text',
        x: at,
        y: base,
        size,
        text,
        fill: ink,
        anchor: 'middle',
      });
    if (s.kind === 'ean13') {
      put(dg[0], left - 5 * X);
      for (let i = 0; i < 6; i++) put(dg[1 + i], tx(3 + 7 * i + 3.5));
      for (let i = 0; i < 6; i++) put(dg[7 + i], tx(50 + 7 * i + 3.5));
    } else {
      put(dg[0], left - 5 * X, ts * 0.75);
      for (let i = 1; i < 6; i++) put(dg[i], tx(3 + 7 * i + 3.5));
      for (let i = 0; i < 5; i++) put(dg[6 + i], tx(50 + 7 * i + 3.5));
      put(dg[11], left + bw + 5 * X, ts * 0.75);
    }
    h = base + ts * 0.25;
  } else if (showNum && formVal('caption') === 'number') {
    const { size } = fitText(
      s.text,
      bw + left + right - 2 * bt,
      ts * 1.4,
      ts,
      4.5
    );
    h += size * 1.2;
    ops.push({
      t: 'text',
      x: left + bw / 2,
      y: h,
      size,
      text: s.text,
      fill: ink,
      anchor: 'middle',
    });
    h += size * 0.3;
  }
  if (extra) {
    const { size, lines } = fitText(
      extra,
      bw + left + right,
      ts * 1.4,
      ts,
      4.5
    );
    h += size * 1.25;
    ops.push({
      t: 'text',
      x: left + bw / 2,
      y: h,
      size,
      text: lines[0] + (lines.length > 1 ? '…' : ''),
      fill: ink,
      anchor: 'middle',
    });
    h += size * 0.3;
  }
  h += marginMm === null ? 2 * X : outer;
  return { ops, w: left + bw + right, h, x: X / MM };
}
const f = (n: number) => String(Math.round(n * 1000) / 1000);

/** Moves and scales a drawn code into place. */
function place(dr: Drawn, x: number, y: number, k: number): Op[] {
  return dr.ops.map((o) => {
    if (o.t === 'path')
      return {
        ...o,
        d: o.d.replace(
          /([MhvHVz])([^MhvHVz]*)/g,
          (_, c: string, args: string) => {
            const n = args
              .trim()
              .split(/[\s,]+/)
              .filter(Boolean)
              .map(Number);
            if (c === 'M') return `M${f(x + n[0] * k)} ${f(y + n[1] * k)}`;
            if (c === 'z') return 'z';
            return `${c}${f(n[0] * k)}`;
          }
        ),
      };
    if (o.t === 'text')
      return { ...o, x: x + o.x * k, y: y + o.y * k, size: o.size * k };
    if (o.t === 'rect')
      return { ...o, x: x + o.x * k, y: y + o.y * k, w: o.w * k, h: o.h * k };
    return o;
  });
}

// ---------- build ----------
interface Code {
  value: string;
  drawn: Drawn;
  sym: Sym;
  extra: string;
}
let lastCodes: Code[] = [];

function build(): Built {
  const kind = (formVal('kind') || 'ean13') as Kind;
  const list = items(kind);
  if (typeof list === 'string') return fail(list);
  if (!list.length) return fail(t('Type a value to encode.'));
  const isQr = kind === 'qr';
  const wMm = formNum('width', 5, 500, SIZE[kind][0]);
  const hMm = isQr ? wMm : formNum('height', 3, 300, SIZE[kind][1]);
  const mRaw = formVal('margin').trim();
  const margin = mRaw === '' ? null : formNum('margin', 0, 50, 0);

  const codes: Code[] = [];
  const bad: string[] = [];
  list.forEach((it, i) => {
    const s = symbol(kind, it.value);
    if (typeof s === 'string')
      bad.push(
        list.length > 1 ? t('Line {n}: {why}', { n: i + 1, why: s }) : s
      );
    else
      codes.push({
        value: s.text,
        drawn: drawCode(s, wMm, hMm, margin, it.extra),
        sym: s,
        extra: it.extra,
      });
  });
  if (bad.length)
    return fail(
      bad.slice(0, 5).join(' ') +
        (bad.length > 5
          ? ' ' +
            tn(bad.length - 5, 'And {n} more line.', 'And {n} more lines.')
          : '')
    );
  lastCodes = codes;

  const notes: string[] = [];
  const added =
    list.length === 1 && kind in { upca: 1, ean13: 1, itf14: 1 }
      ? checkValue(kind, list[0].value)
      : null;
  if (added && !isProblem(added) && added.added)
    notes.push(t('Check digit {d} added.', { d: added.added }));

  const layout = formVal('layout');
  if (layout === 'labels') {
    const sh = sheet();
    const [W, H] = PAPER[sh.paper];
    const slots = labelSlots(sh);
    const skip = Math.round(formNum('skip', 0, slots.length - 1, 0));
    const copies = Math.round(formNum('copies', 1, 500, 1));
    // on a low label, shorter bars keep the bars thick; only then is the whole code scaled
    const innerH = sh.h * MM - 3 * MM;
    const fitted = codes.map((c) => {
      if (isQr || c.drawn.h <= innerH) return c;
      const cut = (c.drawn.h - innerH) / MM;
      const h2 = Math.max(hMm * 0.35, hMm - cut);
      return { ...c, drawn: drawCode(c.sym, wMm, h2, margin, c.extra) };
    });
    const seq = fitted.flatMap((c) => Array<Code>(copies).fill(c));
    const pad = 1.5 * MM;
    let minX = Infinity;
    const pages: Page[] = [];
    let ops: Op[] = [];
    let k = skip;
    for (const c of seq) {
      if (k === slots.length) {
        pages.push({ w: W, h: H, ops });
        ops = [];
        k = 0;
      }
      const sl = slots[k++];
      const bw = sl.w * MM - 2 * pad;
      const bh = sl.h * MM - 2 * pad;
      const sc = Math.min(1, bw / c.drawn.w, bh / c.drawn.h);
      minX = Math.min(minX, c.drawn.x * sc);
      ops.push(
        ...place(
          c.drawn,
          sl.x * MM + pad + (bw - c.drawn.w * sc) / 2,
          sl.y * MM + pad + (bh - c.drawn.h * sc) / 2,
          sc
        )
      );
    }
    pages.push({ w: W, h: H, ops });
    if (!isQr && minX < 0.19)
      notes.push(
        t(
          'The bars are only {x} mm wide on these labels and may not scan. Choose bigger labels or a shorter value.',
          { x: minX.toFixed(2) }
        )
      );
    info.textContent = notes.join(' ');
    return {
      pages,
      summary: `${tn(codes.length, '{n} code', '{n} codes')} · ${tn(seq.length, '{n} label', '{n} labels')} · ${tn(pages.length, '{n} sheet', '{n} sheets')}`,
    };
  }

  // separate codes: one page per code for the PDF; Print lays them out on paper
  const pages: Page[] = codes.map((c) => ({
    w: c.drawn.w,
    h: c.drawn.h,
    ops: c.drawn.ops,
  }));
  const [W, H] = PAPER[(formVal('paper') || 'a4') as Paper];
  const m = 12 * MM;
  const gap = 6 * MM;
  const printPages: Page[] = [];
  let ops: Op[] = [];
  let x = m;
  let y = m;
  let rowH = 0;
  for (const c of codes) {
    const sc = Math.min(1, (W - 2 * m) / c.drawn.w, (H - 2 * m) / c.drawn.h);
    const w = c.drawn.w * sc;
    const h = c.drawn.h * sc;
    if (x + w > W - m + 0.01) {
      x = m;
      y += rowH + gap;
      rowH = 0;
    }
    if (y + h > H - m + 0.01) {
      printPages.push({ w: W, h: H, ops });
      ops = [];
      x = m;
      y = m;
      rowH = 0;
    }
    ops.push(...place(c.drawn, x, y, sc));
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  printPages.push({ w: W, h: H, ops });
  const x0 = codes[0].drawn.x;
  if (!isQr && x0 < 0.19)
    notes.push(
      t(
        'The bars are only {x} mm wide and may not scan. Make the code wider.',
        { x: x0.toFixed(2) }
      )
    );
  info.textContent = notes.join(' ');
  return {
    pages,
    printPages,
    summary: `${tn(codes.length, '{n} code', '{n} codes')} · ${(pages[0].w / MM).toFixed(1)} × ${(pages[0].h / MM).toFixed(1)} mm`,
  };
}
function fail(error: string): Built {
  lastCodes = [];
  info.textContent = '';
  return { pages: [], summary: '', error };
}

// ---------- test sheet: label outlines on plain paper ----------
function testSheet(): Page {
  const sh = sheet();
  const [W, H] = PAPER[sh.paper];
  const ops: Op[] = [];
  labelSlots(sh).forEach((s, i) => {
    const x = s.x * MM;
    const y = s.y * MM;
    const w = s.w * MM;
    const h = s.h * MM;
    ops.push({ t: 'rect', x, y, w, h, stroke: '#555555', sw: 0.4 });
    ops.push({
      t: 'path',
      d:
        line(x + w / 2 - 4, y + h / 2, x + w / 2 + 4, y + h / 2) +
        line(x + w / 2, y + h / 2 - 4, x + w / 2, y + h / 2 + 4),
      stroke: '#555555',
      sw: 0.4,
    });
    ops.push({
      t: 'text',
      x: x + 3,
      y: y + 8,
      size: 6,
      text: String(i + 1),
      fill: '#777777',
    });
  });
  // a 100 mm line to confirm the printer did not scale the page
  const ly = H / 2;
  ops.push({
    t: 'path',
    d:
      line(W / 2 - 50 * MM, ly, W / 2 + 50 * MM, ly) +
      line(W / 2 - 50 * MM, ly - 4, W / 2 - 50 * MM, ly + 4) +
      line(W / 2 + 50 * MM, ly - 4, W / 2 + 50 * MM, ly + 4),
    stroke: '#c2410c',
    sw: 0.8,
  });
  ops.push({
    t: 'text',
    x: W / 2,
    y: ly - 6,
    size: 8,
    text: tp(
      'This line is 100 mm. If it is shorter, turn off “Fit to page” in the print dialog.'
    ),
    fill: '#c2410c',
    anchor: 'middle',
  });
  return { w: W, h: H, ops };
}

// ---------- files: PNG, SVG, ZIP ----------
function safeName(v: string, used: Set<string>): string {
  const b =
    v
      .replace(/^https?:\/\//, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'barcode';
  let n = b;
  for (let i = 2; used.has(n); i++) n = `${b}-${i}`;
  used.add(n);
  return n;
}
function toCanvas(p: Page, dpi: number): HTMLCanvasElement {
  const k = dpi / 72;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(p.w * k));
  c.height = Math.max(1, Math.round(p.h * k));
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.scale(k, k);
  for (const o of p.ops) {
    g.fillStyle = (o as { fill?: string }).fill ?? '#000000';
    if (o.t === 'path') g.fill(new Path2D(o.d));
    else if (o.t === 'rect') g.fillRect(o.x, o.y, o.w, o.h);
    else if (o.t === 'text') {
      g.font = `${o.bold ? 700 : 400} ${o.size}px "${FONT_FAMILY}", Arial, sans-serif`;
      g.textAlign =
        o.anchor === 'middle'
          ? 'center'
          : o.anchor === 'end'
            ? 'right'
            : 'left';
      g.fillText(o.text, o.x, o.y);
    }
  }
  return c;
}
/** PNG with its print size stored (pHYs), so it comes out at the right size in other apps. */
async function png(p: Page, dpi: number): Promise<Blob> {
  const blob = await new Promise<Blob>((r) =>
    toCanvas(p, dpi).toBlob((b) => r(b!), 'image/png')
  );
  const buf = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1;
  dv.setUint32(17, crc(chunk.subarray(4, 17)));
  const at = 33; // after the signature and IHDR
  return new Blob([buf.subarray(0, at), chunk, buf.subarray(at)], {
    type: 'image/png',
  });
}
let crcTable: number[] | null = null;
function crc(b: Uint8Array): number {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const svgFile = (p: Page) =>
  new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${pageToSvg(p, true)}`], {
    type: 'image/svg+xml',
  });

async function save(
  kind: 'png' | 'svg',
  btn: HTMLButtonElement
): Promise<void> {
  gen.refresh();
  await new Promise((r) => setTimeout(r, 120));
  if (!lastCodes.length) return;
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = t('Making files…');
  try {
    await loadFonts();
    const dpi = +(formVal('dpi') || 300);
    const used = new Set<string>();
    const file = async (c: Code) => {
      const p = { w: c.drawn.w, h: c.drawn.h, ops: c.drawn.ops };
      return kind === 'png' ? png(p, dpi) : svgFile(p);
    };
    if (lastCodes.length === 1)
      download(
        await file(lastCodes[0]),
        `${safeName(lastCodes[0].value, used)}.${kind}`
      );
    else {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const c of lastCodes)
        zip.file(`${safeName(c.value, used)}.${kind}`, await file(c));
      download(
        await zip.generateAsync({ type: 'blob' }),
        `barcodes-${kind}.zip`
      );
    }
    window.dispatchEvent(
      new CustomEvent('plyleaf:done', {
        detail: { tool: 'barcode-generator', how: kind },
      })
    );
  } finally {
    btn.innerHTML = label;
    btn.disabled = false;
  }
}

syncControls();
const gen = mountGenerator({
  tool: 'barcode-generator',
  title: t('Barcodes'),
  fileName: () =>
    formVal('layout') === 'labels'
      ? 'barcode-labels.pdf'
      : lastCodes.length === 1
        ? `${safeName(lastCodes[0].value, new Set())}.pdf`
        : 'barcodes.pdf',
  previewMax: 12,
  build,
});
const pngBtn = document.getElementById('png-btn') as HTMLButtonElement;
const svgBtn = document.getElementById('svg-btn') as HTMLButtonElement;
pngBtn.addEventListener('click', () => save('png', pngBtn));
svgBtn.addEventListener('click', () => save('svg', svgBtn));
document.getElementById('test-btn')!.addEventListener('click', async () => {
  const { printPages } = await import('../print/sheet');
  await printPages([testSheet()]);
});
// PNG and SVG follow the same state as the PDF button
new MutationObserver(() => {
  const off = (document.getElementById('pdf-btn') as HTMLButtonElement)
    .disabled;
  pngBtn.disabled = svgBtn.disabled = off;
}).observe(document.getElementById('pdf-btn')!, {
  attributes: true,
  attributeFilter: ['disabled'],
});
