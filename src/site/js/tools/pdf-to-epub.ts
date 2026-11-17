// PDF to EPUB, step 1: everything runs in the browser. Reading uses pdf.js, scanned pages are
// recognized with tesseract.js (its language model is the only download), the EPUB is written
// with JSZip. The heavy modules load after a file is chosen.
import '../../css/epub-tool.css';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Book, Extracted, Picture, StructureOptions } from '../epub/model';
import type { Progress } from '../epub/extract';
import { OCR_LANGS } from '../epub/ocr';

type Extract = typeof import('../epub/extract');
type Structure = typeof import('../epub/structure');
type Build = typeof import('../epub/build');
let mods: { ex: Extract; st: Structure; bd: Build } | null = null;
const loadMods = async () =>
  (mods ??= {
    ex: await import('../epub/extract'),
    st: await import('../epub/structure'),
    bd: await import('../epub/build'),
  });

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const tool = $('tool');
const drop = $('drop-zone');
const input = $<HTMLInputElement>('file-input');
const err = $('drop-error');
const fileArea = $('file-display-area');
const prog = $('progress');
const bar = $('progress-bar');
const pLabel = $('progress-label');
const pPct = $('progress-pct');
const pEta = $('progress-eta');
const scan = $('scan-panel');
const opts = $('tool-options');
const make = $<HTMLButtonElement>('make-btn');
const result = $('result');
const makeErr = $('make-error');
const tocEl = $('epub-toc');
const pageEl = $('epub-page');
const langSel = $<HTMLSelectElement>('ocr-lang');

interface Loaded {
  name: string;
  size: number;
  pdf: PDFDocumentProxy;
  ex: Extracted | null;
}
let file: Loaded | null = null;
let book: Book | null = null;
let output: { blob: Blob; name: string } | null = null;
let job: AbortController | null = null;
let stopOcr: (() => Promise<void>) | null = null;
let shownChapter = 0;
const picUrls = new Map<Picture, string>();

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const fmtSize = (b: number) =>
  b > 1e6
    ? `${(b / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1e3))} KB`;
const baseName = (name: string) => name.replace(/\.pdf$/i, '');
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!
  );
const fmtTime = (sec: number) => {
  if (sec < 50) return 'less than a minute';
  const m = Math.round(sec / 60);
  if (m < 60) return plural(m, 'minute', 'minutes');
  const h = Math.floor(m / 60);
  return `${plural(h, 'hour', 'hours')} ${m % 60 ? plural(m % 60, 'minute', 'minutes') : ''}`.trim();
};
const slowDevice = () =>
  matchMedia('(pointer: coarse)').matches ||
  (navigator.hardwareConcurrency || 4) <= 4;

// ---------- states ----------

function hideAll(): void {
  drop.hidden = true;
  fileArea.hidden = true;
  prog.hidden = true;
  scan.hidden = true;
  opts.hidden = true;
  result.hidden = true;
  makeErr.hidden = true;
}
function showError(html: string): void {
  reset();
  drop.dataset.state = 'error';
  err.innerHTML = html;
  err.hidden = false;
}
function reset(): void {
  job?.abort();
  job = null;
  void stopOcr?.();
  stopOcr = null;
  void file?.pdf.destroy();
  file = null;
  book = null;
  output = null;
  for (const u of picUrls.values()) URL.revokeObjectURL(u);
  picUrls.clear();
  input.value = '';
  hideAll();
  drop.hidden = false;
  drop.dataset.state = 'idle';
  err.hidden = true;
  make.hidden = false;
  make.disabled = true;
  make.textContent = 'Make EPUB';
}

let started = 0;
function showProgress(label: string, done: number, total: number): void {
  prog.hidden = false;
  const pct = total ? Math.round((done / total) * 100) : 0;
  bar.style.width = `${pct}%`;
  pLabel.textContent = label;
  pPct.textContent = `${pct}%`;
  if (done === 0) {
    started = performance.now();
    pEta.textContent = '';
  } else if (done < total) {
    const per = (performance.now() - started) / 1000 / done;
    const left = per * (total - done);
    pEta.textContent =
      left < 50 ? 'Less than a minute left' : `About ${fmtTime(left)} left`;
  } else pEta.textContent = '';
}

// ---------- open and read ----------

async function openFile(f: File): Promise<void> {
  if (job) return;
  if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) {
    showError(
      `“${escapeHtml(f.name)}” is not a PDF. Choose a file that ends in .pdf.`
    );
    return;
  }
  drop.dataset.state = 'busy';
  let pdf: PDFDocumentProxy;
  try {
    const [{ ex }, bytes] = await Promise.all([loadMods(), f.arrayBuffer()]);
    pdf = await ex.openPdf(bytes);
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException')
      showError(
        'This PDF is password-protected. Remove the password with <a href="/unlock-pdf">Unlock PDF</a>, then convert it.'
      );
    else
      showError(
        'This file could not be read as a PDF. It may be damaged. Try <a href="/repair-pdf">Repair PDF</a> first.'
      );
    return;
  }
  file = { name: f.name, size: f.size, pdf, ex: null };
  hideAll();
  fileArea.hidden = false;
  $('file-name').textContent = f.name;
  $('file-info').textContent =
    `${plural(pdf.numPages, 'page', 'pages')} · ${fmtSize(f.size)}`;
  make.disabled = true;
  await read();
}

async function read(): Promise<void> {
  if (!file) return;
  const { ex } = await loadMods();
  job = new AbortController();
  const me = file;
  showProgress('Reading pages', 0, me.pdf.numPages);
  try {
    me.ex = await ex.extract(me.pdf, {
      signal: job.signal,
      onProgress: (p: Progress) =>
        showProgress(
          `Reading page ${Math.min(p.done + 1, p.total)} of ${p.total}`,
          p.done,
          p.total
        ),
    });
  } catch (e) {
    if (file !== me) return;
    if (e instanceof ex.Cancelled) reset();
    else
      showError(
        'Something went wrong while reading this PDF. It may be damaged. Try <a href="/repair-pdf">Repair PDF</a> first.'
      );
    return;
  } finally {
    if (file === me) job = null;
  }
  if (file !== me) return;
  prog.hidden = true;
  const scanned = me.ex.pages.filter((p) => p.ocr).length;
  if (scanned) offerOcr(scanned);
  else showOptions();
}

function offerOcr(n: number): void {
  if (!file?.ex) return;
  const ex = file.ex;
  const all = n === ex.pages.length;
  $('scan-title').textContent = all
    ? `This book is scanned: ${plural(n, 'page is an image', 'pages are images')}`
    : `${plural(n, 'page is a scanned image', 'pages are scanned images')}`;
  const per = slowDevice() ? 10 : 4;
  $('scan-sub').textContent =
    `Their text has to be recognized before it can flow on an e-reader. On this device that takes about ${fmtTime(n * per)}. ` +
    `The recognition model for the language (about 2 to 15 MB) is downloaded once; your file stays here.`;
  if (!langSel.options.length) {
    const names = Object.entries(OCR_LANGS).sort((a, b) =>
      a[1].name.localeCompare(b[1].name)
    );
    langSel.innerHTML = names
      .map(([k, v]) => `<option value="${k}">${escapeHtml(v.name)}</option>`)
      .join('');
  }
  const hasText = ex.lines.length > 30;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  const guess = hasText ? ex.lang : nav;
  langSel.value = OCR_LANGS[guess] ? guess : 'en';
  $<HTMLButtonElement>('skip-ocr-btn').hidden = all;
  hideAll();
  fileArea.hidden = false;
  scan.hidden = false;
  make.disabled = true;
}

async function runOcr(): Promise<void> {
  if (!file?.ex || job) return;
  const me = file;
  const ex = me.ex!;
  const { ex: exMod } = await loadMods();
  const { createOcr } = await import('../epub/ocr');
  job = new AbortController();
  const signal = job.signal;
  scan.hidden = true;
  const lang = langSel.value;
  showProgress('Loading the text recognition model', 0, 1);
  try {
    const ocr = await createOcr(lang, (p) => {
      if (!signal.aborted) {
        bar.style.width = `${Math.round(p * 100)}%`;
        pPct.textContent = `${Math.round(p * 100)}%`;
      }
    });
    stopOcr = () => ocr.stop();
    if (signal.aborted) throw new exMod.Cancelled();
    const total = ex.pages.filter((p) => p.ocr).length;
    await exMod.recognizePages(me.pdf, ex, {
      signal,
      ocr: (c, s, p) => ocr.recognize(c, s, p),
      onProgress: (p) =>
        showProgress(
          `Recognizing text: page ${Math.min(p.done + 1, total)} of ${total}`,
          p.done,
          total
        ),
    });
    await ocr.stop();
    stopOcr = null;
    if (ex.pages.filter((p) => p.ocr).length > ex.pages.length / 2)
      ex.lang = lang;
  } catch (e) {
    if (file !== me) return;
    void stopOcr?.();
    stopOcr = null;
    job = null;
    prog.hidden = true;
    if (e instanceof exMod.Cancelled || signal.aborted) {
      // drop half-recognized pages: they are recognized again next time
      offerOcr(ex.pages.filter((p) => p.ocr).length);
    } else {
      offerOcr(ex.pages.filter((p) => p.ocr).length);
      makeErr.textContent =
        'Text recognition could not start. Check the internet connection (the language model is downloaded once) and try again.';
      makeErr.hidden = false;
    }
    return;
  }
  job = null;
  if (file !== me) return;
  prog.hidden = true;
  showOptions();
}

// ---------- options and preview ----------

function options(): StructureOptions {
  const val = (n: string) =>
    (
      tool.querySelector(
        `input[name="${n}"]:checked`
      ) as HTMLInputElement | null
    )?.value;
  const on = (n: string) =>
    (tool.querySelector(`input[name="${n}"]`) as HTMLInputElement).checked;
  return {
    chapters: (val('chapters') as StructureOptions['chapters']) || 'auto',
    cleanHeaders: on('clean'),
    notes: on('notes'),
    pictures: on('pictures'),
  };
}

function showOptions(): void {
  hideAll();
  fileArea.hidden = false;
  opts.hidden = false;
  make.hidden = false;
  make.disabled = false;
  shownChapter = -1;
  refresh();
}

function refresh(): void {
  if (!file?.ex || !mods) return;
  const o = options();
  book = mods.st.structure(file.ex, o);
  output = null;
  const s = book.stats;
  const hasMarks = file.ex.outline.length >= 2;
  $('ch-hint').textContent =
    o.chapters === 'auto'
      ? hasMarks
        ? `Chapters come from the ${plural(file.ex.outline.length, 'bookmark', 'bookmarks')} in the PDF.`
        : s.chapterSource === 'fonts'
          ? 'This PDF has no bookmarks, so chapters were found by heading size.'
          : 'No bookmarks or clear headings found, so the book is split every 20 pages.'
      : o.chapters === 'fonts'
        ? s.chapterSource === 'fonts'
          ? 'Lines set larger or bolder than the text start chapters and sections.'
          : 'No clear headings found, so the book is split every 20 pages.'
        : 'No chapter detection: one table of contents entry per 20 pages.';
  const parts = [
    plural(book.chapters.length, 'chapter', 'chapters'),
    plural(s.paragraphs, 'paragraph', 'paragraphs'),
  ];
  if (o.cleanHeaders && s.removedLines)
    parts.push(
      `${plural(s.removedLines, 'running head or page number', 'running heads and page numbers')} removed`
    );
  if (o.notes && s.notes) parts.push(plural(s.notes, 'footnote', 'footnotes'));
  if (o.pictures && s.pictures)
    parts.push(plural(s.pictures, 'picture', 'pictures'));
  if (s.ocrPages)
    parts.push(`${plural(s.ocrPages, 'page', 'pages')} recognized`);
  $('preview-sum').textContent = parts.join(' · ');
  renderToc();
  // open the first chapter that has text, often after a title page
  if (shownChapter < 0 || shownChapter >= book.chapters.length) {
    const firstReal = book.chapters.findIndex(
      (c) => c.blocks.filter((b) => b.kind === 'p').length > 3
    );
    shownChapter = Math.max(0, firstReal);
  }
  renderChapter(shownChapter);
}

function renderToc(): void {
  if (!book) return;
  tocEl.innerHTML = book.chapters
    .map((c, i) => {
      // heading ids in the chapter are h1, h2… in order (see chapterBody)
      const heads = c.blocks.filter((b) => b.kind === 'h');
      const subs = c.front
        ? ''
        : heads
            .map((b, k) => ({ b, id: `h${k + 1}` }))
            .filter(
              ({ b }) =>
                b.level === 2 &&
                (b.segs ?? []).map((x) => x.t).join('') !== c.title
            )
            .slice(0, 12)
            .map(
              ({ b, id }) =>
                `<li class="sub"><button type="button" data-ch="${i}" data-h="${id}">${escapeHtml((b.segs ?? []).map((x) => x.t).join(''))}</button></li>`
            )
            .join('');
      return `<li><button type="button" data-ch="${i}">${escapeHtml(c.title)}</button></li>${subs}`;
    })
    .join('');
}

function picUrl(p: Picture): string {
  let u = picUrls.get(p);
  if (!u) {
    u = URL.createObjectURL(p.blob);
    picUrls.set(p, u);
  }
  return u;
}

function renderChapter(i: number): void {
  if (!book || !mods) return;
  shownChapter = i;
  const ch = book.chapters[i];
  if (!ch) {
    pageEl.innerHTML =
      '<p class="epub-more">No text was found in this PDF.</p>';
    return;
  }
  const LIMIT = 80;
  const short = { ...ch, blocks: ch.blocks.slice(0, LIMIT) };
  const ids = new Set(
    short.blocks.flatMap((b) =>
      (b.segs ?? []).filter((s) => s.note).map((s) => s.note!)
    )
  );
  short.notes = ch.notes.filter((n) => ids.has(n.id));
  const { html } = mods.bd.chapterBody(short, picUrl, {
    pictures: options().pictures,
    lang: book.lang,
  });
  const more =
    ch.blocks.length > LIMIT
      ? `<p class="epub-more">The chapter goes on in the EPUB: ${plural(ch.blocks.length - LIMIT, 'more block', 'more blocks')}.</p>`
      : '';
  pageEl.innerHTML = html + more;
  pageEl.scrollTop = 0;
  for (const b of tocEl.querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute(
      'aria-current',
      String(Number(b.dataset.ch) === i && !b.closest('.sub'))
    );
  }
}

// ---------- make ----------

async function makeEpub(): Promise<void> {
  if (!file?.ex || !book || !mods) return;
  make.disabled = true;
  make.innerHTML =
    '<span class="spinner" aria-hidden="true"></span>Making EPUB';
  try {
    const o = options();
    const blob = await mods.bd.buildEpub(book, {
      pictures: o.pictures,
      cover: file.ex.cover,
      fallbackTitle: baseName(file.name),
    });
    output = { blob, name: `${baseName(file.name)}.epub` };
    hideAll();
    fileArea.hidden = false;
    result.hidden = false;
    make.hidden = true;
    $('result-title').textContent = 'EPUB ready';
    $('result-sub').textContent =
      `${output.name} · ${plural(book.chapters.length, 'chapter', 'chapters')} · ${fmtSize(blob.size)}`;
    window.dispatchEvent(
      new CustomEvent('plyleaf:done', { detail: { tool: 'pdf-to-epub' } })
    );
  } catch {
    makeErr.textContent =
      'The EPUB could not be written. Try turning off pictures, or try again.';
    makeErr.hidden = false;
  } finally {
    make.disabled = false;
    make.textContent = 'Make EPUB';
  }
}

function download(): void {
  if (!output) return;
  const url = URL.createObjectURL(output.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = output.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function sampleFile(): Promise<void> {
  drop.dataset.state = 'busy';
  try {
    const res = await fetch('/samples/plyleaf-sample-book.pdf');
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    await openFile(
      new File([blob], 'sample-book.pdf', { type: 'application/pdf' })
    );
  } catch {
    showError(
      'The sample book could not be loaded. Choose a PDF of your own instead.'
    );
  }
}

// ---------- events ----------

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
  const f = e.dataTransfer?.files?.[0];
  if (f) void openFile(f);
});
$('remove-file').addEventListener('click', reset);
$('restart-btn').addEventListener('click', reset);
$('cancel-btn').addEventListener('click', () => {
  job?.abort();
  void stopOcr?.();
});
$('ocr-btn').addEventListener('click', () => void runOcr());
$('skip-ocr-btn').addEventListener('click', () => {
  makeErr.hidden = true;
  showOptions();
});
$('back-btn').addEventListener('click', showOptions);
$('download-btn').addEventListener('click', download);
make.addEventListener('click', () => void makeEpub());
opts.addEventListener('change', (e) => {
  if ((e.target as HTMLElement).matches('input')) refresh();
});
tocEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-ch]'
  );
  if (!b) return;
  const ch = Number(b.dataset.ch);
  if (ch !== shownChapter) renderChapter(ch);
  const h = b.dataset.h
    ? pageEl.querySelector<HTMLElement>(`#${b.dataset.h}`)
    : null;
  pageEl.scrollTop = h ? h.offsetTop - 16 : 0;
});
