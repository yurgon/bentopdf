// PDF booklet maker: arranges pages for fold-and-staple printing, entirely in the browser.
// pdf-lib (the heavy part) is loaded only after a file is chosen.
import type { PDFDocument, PDFPage, PDFEmbeddedPage } from 'pdf-lib';
import { href, t, tn } from '../i18n';

type PdfLib = typeof import('pdf-lib');
let lib: PdfLib | null = null;
const loadLib = async (): Promise<PdfLib> => (lib ??= await import('pdf-lib'));

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const tool = $('tool');
const drop = $('drop-zone');
const input = $<HTMLInputElement>('file-input');
const fileArea = $('file-display-area');
const opts = $('tool-options');
const make = $<HTMLButtonElement>('make-btn');
const prog = $('progress');
const bar = $('progress-bar');
const pLabel = $('progress-label');
const pPct = $('progress-pct');
const result = $('result');
const preview = $('booklet-preview');
const sum = $('preview-sum');
const err = $('drop-error');

// booklet size → [sheet you print on, booklet page size]
const SIZES: Record<
  string,
  { sheet: [number, number]; from: string; to: string }
> = {
  a5: { sheet: [595.28, 841.89], from: 'A4', to: 'A5' },
  hl: { sheet: [612, 792], from: 'Letter', to: 'half Letter' },
  a4: { sheet: [841.89, 1190.55], from: 'A3', to: 'A4' },
};

interface Loaded {
  name: string;
  size: number;
  pages: number;
  doc: PDFDocument;
}
let file: Loaded | null = null;
let output: { blob: Blob; name: string } | null = null;
let busy = false;

const val = (name: string): string =>
  (tool.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement)
    .value;
const fmtSize = (b: number) =>
  b > 1e6
    ? `${(b / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1e3))} KB`;

/** Page order for a saddle-stitched booklet. Sheet s carries [front-left, front-right] and [back-left, back-right]. */
export function sheetsFor(n: number, rtl: boolean) {
  const N = Math.ceil(n / 4) * 4;
  const out: { front: [number, number]; back: [number, number] }[] = [];
  for (let s = 0; s < N / 4; s++) {
    let front: [number, number] = [N - 2 * s, 2 * s + 1];
    let back: [number, number] = [2 * s + 2, N - 2 * s - 1];
    if (rtl) {
      front = [front[1], front[0]];
      back = [back[1], back[0]];
    }
    out.push({ front, back });
  }
  return { N, sheets: out };
}

// ---------- preview (schematic, instant) ----------
const cell = (p: number, n: number, N: number) => {
  const blank = p > n;
  const cls = blank ? 'blank' : p === 1 || p === N ? 'cover' : '';
  return `<span class="${cls}" aria-label="${blank ? t('blank page') : t('page {p}', { p })}">${blank ? '·' : p}</span>`;
};
function render(): void {
  if (!file) return;
  const n = file.pages;
  const { N, sheets } = sheetsFor(n, val('bind') === 'r');
  const twoPass = val('duplex') === 'manual';
  preview.innerHTML = sheets
    .map(
      (sh, i) => `
      <div class="sheet">
        <div class="sheet-sides">
          <div class="spread">${cell(sh.front[0], n, N)}${cell(sh.front[1], n, N)}</div>
          <div class="spread">${cell(sh.back[0], n, N)}${cell(sh.back[1], n, N)}</div>
        </div>
        <div class="sheet-cap tnum"><span>${t('Sheet {n}', { n: i + 1 })}</span><span>${twoPass ? t('pass 1 · pass 2') : t('front · back')}</span></div>
      </div>`
    )
    .join('');
  const blanks = N - n;
  const { from, to } = SIZES[val('size')];
  sum.textContent =
    tn(
      sheets.length,
      '{pages} pages on {n} sheet of {paper}',
      '{pages} pages on {n} sheets of {paper}',
      {
        pages: N,
        paper: t(from),
      }
    ) +
    (blanks
      ? ` · ${tn(blanks, '{n} blank page added at the end', '{n} blank pages added at the end')}`
      : '');
  $('result-sub').textContent =
    `${baseName(file.name)}-booklet.pdf · ${tn(sheets.length, '{n} sheet', '{n} sheets')} · ${t(to)}` +
    (twoPass ? ` · ${t('two passes')}` : '');
}
const baseName = (name: string) => name.replace(/\.pdf$/i, '');

// ---------- states ----------
function showError(html: string): void {
  drop.dataset.state = 'error';
  err.innerHTML = html;
  err.hidden = false;
}
function reset(): void {
  $('make-error').hidden = true;
  file = null;
  output = null;
  input.value = '';
  drop.hidden = false;
  drop.dataset.state = 'idle';
  fileArea.hidden = true;
  opts.hidden = true;
  result.hidden = true;
  prog.hidden = true;
  make.hidden = false;
  make.disabled = true;
  make.removeAttribute('data-loading');
  make.textContent = t('Make booklet');
}
function setLoaded(f: Loaded): void {
  file = f;
  output = null;
  err.hidden = true;
  drop.dataset.state = 'idle';
  $('file-name').textContent = f.name;
  $('file-info').textContent =
    `${tn(f.pages, '{n} page', '{n} pages')} · ${fmtSize(f.size)}`;
  drop.hidden = true;
  fileArea.hidden = false;
  opts.hidden = false;
  result.hidden = true;
  prog.hidden = true;
  make.hidden = false;
  make.disabled = false;
  render();
}
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!
  );

async function openFile(f: File): Promise<void> {
  if (busy) return;
  if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) {
    showError(
      t('“{name}” is not a PDF. Choose a file that ends in .pdf.', {
        name: escapeHtml(f.name),
      })
    );
    return;
  }
  busy = true;
  drop.dataset.state = 'busy';
  try {
    const [{ PDFDocument }, bytes] = await Promise.all([
      loadLib(),
      f.arrayBuffer(),
    ]);
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (e) {
      if (e instanceof Error && /encrypt/i.test(e.message)) {
        showError(
          t(
            'This PDF is password-protected. Remove the password with <a href="{link}">Unlock PDF</a>, then make the booklet.',
            { link: href('/unlock-pdf') }
          )
        );
      } else {
        showError(
          t(
            'This file could not be read as a PDF. It may be damaged. Try <a href="{link}">Repair PDF</a> first.',
            { link: href('/repair-pdf') }
          )
        );
      }
      return;
    }
    const pages = doc.getPageCount();
    if (!pages) {
      showError(t('This PDF has no pages.'));
      return;
    }
    setLoaded({ name: f.name, size: f.size, pages, doc });
  } finally {
    busy = false;
    if (drop.dataset.state === 'busy') drop.dataset.state = 'idle';
  }
}

async function sampleFile(): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await loadLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.16, 0.15, 0.13);
  for (let i = 1; i <= 14; i++) {
    const page = doc.addPage([419.53, 595.28]); // A5
    const title =
      i === 1 ? 'Field notes' : i === 14 ? 'The end' : `Chapter ${i - 1}`;
    page.drawText(title, { x: 48, y: 520, size: 26, font: bold, color: ink });
    for (let l = 0; l < 14; l++)
      page.drawRectangle({
        x: 48,
        y: 470 - l * 26,
        width: 320 - ((l * 37) % 90),
        height: 6,
        color: rgb(0.86, 0.85, 0.82),
      });
    page.drawText(String(i), { x: 202, y: 36, size: 12, font, color: ink });
  }
  const bytes = await doc.save();
  const f = new File([new Uint8Array(bytes)], 'field-notes.pdf', {
    type: 'application/pdf',
  });
  await openFile(f);
}

// ---------- imposition ----------
/** Draws a source page into a box, upright and as large as fits. Landscape pages are turned to fit the portrait half. */
function place(
  out: PDFPage,
  e: PDFEmbeddedPage,
  srcRotation: number,
  box: { x: number; y: number; w: number; h: number },
  degrees: PdfLib['degrees']
): void {
  const a = ((srcRotation % 360) + 360) % 360; // PDF /Rotate, clockwise
  let theta = (360 - a) % 360; // drawPage rotates counter-clockwise
  let vw = a % 180 ? e.height : e.width; // visual size after /Rotate
  let vh = a % 180 ? e.width : e.height;
  if (vw > vh) {
    theta = (theta + 90) % 360;
    [vw, vh] = [vh, vw];
  }
  const s = Math.min(box.w / vw, box.h / vh);
  const bx = box.x + (box.w - vw * s) / 2;
  const by = box.y + (box.h - vh * s) / 2;
  const w = e.width * s;
  const h = e.height * s;
  const at =
    theta === 0
      ? { x: bx, y: by }
      : theta === 90
        ? { x: bx + h, y: by }
        : theta === 180
          ? { x: bx + w, y: by + h }
          : { x: bx, y: by + w };
  out.drawPage(e, { ...at, xScale: s, yScale: s, rotate: degrees(theta) });
}

function setProgress(pct: number, label: string): void {
  bar.style.width = `${pct}%`;
  pPct.textContent = `${Math.round(pct)}%`;
  pLabel.textContent = label;
}
const nextFrame = () =>
  new Promise((r) => requestAnimationFrame(() => r(null)));

async function makeBooklet(): Promise<void> {
  if (!file || busy) return;
  busy = true;
  make.disabled = true;
  $('make-error').hidden = true;
  make.dataset.loading = 'true';
  make.innerHTML = `<span class="spinner" aria-hidden="true"></span>${t('Making booklet')}`;
  opts.hidden = true;
  prog.hidden = false;
  try {
    const { PDFDocument, degrees } = await loadLib();
    setProgress(2, t('Reading pages'));
    await nextFrame();
    const src = file.doc;
    const n = file.pages;
    const { sheets } = sheetsFor(n, val('bind') === 'r');
    const [pw, ph] = SIZES[val('size')].sheet;
    const W = ph; // landscape sheet
    const H = pw;
    const out = await PDFDocument.create();
    out.setTitle(`${baseName(file.name)} (booklet)`);
    out.setProducer('Plyleaf');
    out.setCreator('Plyleaf PDF booklet maker');
    const embedded = await out.embedPdf(src, src.getPageIndices());
    const rotation = src.getPages().map((p) => p.getRotation().angle);
    setProgress(30, t('Arranging pages on sheets'));

    const side = (pair: [number, number]) => {
      const page = out.addPage([W, H]);
      pair.forEach((p, slot) => {
        if (p <= n)
          place(
            page,
            embedded[p - 1],
            rotation[p - 1],
            { x: slot * (W / 2), y: 0, w: W / 2, h: H },
            degrees
          );
      });
    };
    const twoPass = val('duplex') === 'manual';
    const order = twoPass
      ? [...sheets.map((s) => s.front), ...sheets.map((s) => s.back)]
      : sheets.flatMap((s) => [s.front, s.back]);
    for (let i = 0; i < order.length; i++) {
      side(order[i]);
      if (i % 8 === 7) {
        setProgress(
          30 + (40 * (i + 1)) / order.length,
          t('Arranging pages on sheets')
        );
        await nextFrame();
      }
    }
    setProgress(72, t('Writing the PDF'));
    await nextFrame();
    const bytes = await out.save();
    output = {
      blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
      name: `${baseName(file.name)}-booklet.pdf`,
    };
    setProgress(100, t('Done'));
    $('result-title').textContent = twoPass
      ? t('Booklet ready: print pages 1 to {a} first, then {b} to {c}', {
          a: sheets.length,
          b: sheets.length + 1,
          c: sheets.length * 2,
        })
      : t('Booklet ready');
    prog.hidden = true;
    result.hidden = false;
    make.hidden = true;
    $('download-btn').focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    prog.hidden = true;
    opts.hidden = false;
    const me = $('make-error');
    me.textContent = t(
      'Something went wrong while making the booklet. Try again, or try a smaller file.'
    );
    me.hidden = false;
  } finally {
    busy = false;
    make.removeAttribute('data-loading');
    make.textContent = t('Make booklet');
    make.disabled = !file;
  }
}

function download(): void {
  if (!output) return;
  const url = URL.createObjectURL(output.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = output.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  window.dispatchEvent(
    new CustomEvent('plyleaf:done', { detail: { tool: 'pdf-booklet' } })
  );
}

// ---------- wiring ----------
$('sample-btn').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  void sampleFile();
});
input.addEventListener('change', () => {
  const f = input.files?.[0];
  if (f) void openFile(f);
});
for (const t of ['dragenter', 'dragover'] as const)
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.dataset.state = 'over';
  });
for (const t of ['dragleave', 'dragend'] as const)
  drop.addEventListener(t, () => {
    drop.dataset.state = 'idle';
  });
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.dataset.state = 'idle';
  const f = e.dataTransfer?.files[0];
  if (f) void openFile(f);
});
$('remove-file').addEventListener('click', reset);
$('restart-btn').addEventListener('click', reset);
tool.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.name && t.type === 'radio') {
    output = null;
    result.hidden = true;
    make.hidden = false;
    opts.hidden = false;
    render();
  }
});
make.addEventListener('click', () => void makeBooklet());

// the same two-sided test sheet as the printer test page, on the paper this booklet prints on
$('duplex-test-btn').addEventListener('click', async () => {
  const [{ duplexSheets }, { toPdf, download: save }] = await Promise.all([
    import('../print/test-sheets'),
    import('../print/sheet'),
  ]);
  const { sheet, from } = SIZES[val('size')];
  const blob = await toPdf(duplexSheets(sheet[0], sheet[1]), {
    title: t('Two-sided printing test'),
  });
  save(blob, `two-sided-test-${from.toLowerCase()}.pdf`);
});
$('download-btn').addEventListener('click', download);
