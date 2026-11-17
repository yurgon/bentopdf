// Signature generator, step 2: put the signature on a PDF.
// The page is drawn with pdf.js; the signature sits on top and can be dragged, resized
// (corner handle, or + and − keys) and removed. Saving stamps the PNG onto each chosen
// spot with pdf-lib, so the result looks the same in every PDF reader.
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import { href, t, tn } from '../i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

interface Spot {
  page: number; // 0-based
  x: number; // left, fraction of page width
  y: number; // top, fraction of page height
  w: number; // width, fraction of page width
}

let png: Blob | null = null;
let aspect = 3; // signature width / height
let pdf: PDFDocumentProxy | null = null;
let bytes: Uint8Array | null = null;
let fileName = 'document.pdf';
let pageNo = 0;
let pageCount = 0;
let vp: PageViewport | null = null; // current page at scale 1
let spots: Spot[] = [];
let pngUrl = '';
let output: { blob: Blob; name: string } | null = null;
let wired = false;

const make = $('sig-make');
const sign = $('sig-sign');
const footMake = $('foot-make');
const footSign = $('foot-sign');
const drop = $('pdf-drop');
const input = $<HTMLInputElement>('pdf-input');
const placer = $('placer');
const stage = $('sig-stage');
const layer = $('sig-layer');
const pageCanvas = $<HTMLCanvasElement>('page-canvas');
const err = $('sign-error');
const saveBtn = $<HTMLButtonElement>('sign-make');
const result = $('sign-result');

async function pdfjs() {
  const lib = await import('pdfjs-dist');
  await import('../../../js/utils/setup-pdf-worker');
  return lib;
}

export function openSigner(image: Blob, ratio: number): void {
  png = image;
  aspect = ratio;
  if (pngUrl) URL.revokeObjectURL(pngUrl);
  pngUrl = URL.createObjectURL(image);
  layer.querySelectorAll('img').forEach((i) => (i.src = pngUrl));
  if (!wired) wire();
  make.hidden = true;
  footMake.hidden = true;
  sign.hidden = false;
  footSign.hidden = false;
  if (!pdf) {
    drop.hidden = false;
    placer.hidden = true;
    result.hidden = true;
  } else {
    void showPage(pageNo);
  }
  $('tool').scrollIntoView({ behavior: 'smooth', block: 'start' });
  (pdf ? saveBtn : drop.querySelector('input'))?.focus({ preventScroll: true });
}

function back(): void {
  sign.hidden = true;
  footSign.hidden = true;
  make.hidden = false;
  footMake.hidden = false;
}

function showError(msg: string, where = err): void {
  where.innerHTML = msg;
  where.hidden = false;
}

async function takePdf(file: File | undefined): Promise<void> {
  if (!file) return;
  const pdfErr = $('pdf-error');
  pdfErr.hidden = true;
  err.hidden = true;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    showError(t('That is not a PDF. Choose a .pdf file.'), pdfErr);
    return;
  }
  try {
    const lib = await pdfjs();
    bytes = new Uint8Array(await file.arrayBuffer());
    pdf?.destroy();
    pdf = await lib.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    pdf = null;
    const locked = (e as { name?: string })?.name === 'PasswordException';
    showError(
      locked
        ? t(
            'This PDF is protected with a password. <a href="{link}">Unlock it</a> first, then sign it here.',
            { link: href('/unlock-pdf') }
          )
        : t('This file could not be opened as a PDF. It may be damaged.'),
      pdfErr
    );
    return;
  }
  fileName = file.name;
  pageCount = pdf.numPages;
  // most documents are signed on the last page: start there, with one signature placed
  spots = [];
  pageNo = pageCount - 1;
  drop.hidden = true;
  placer.hidden = false;
  result.hidden = true;
  await showPage(pageNo);
  addSpot();
  saveBtn.disabled = false;
}

async function showPage(n: number): Promise<void> {
  if (!pdf) return;
  pageNo = Math.max(0, Math.min(pageCount - 1, n));
  const page = await pdf.getPage(pageNo + 1);
  vp = page.getViewport({ scale: 1 });
  const avail = Math.min(820, placer.clientWidth || 600);
  const cssScale = avail / vp.width;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const view = page.getViewport({ scale: cssScale * dpr });
  pageCanvas.width = Math.round(view.width);
  pageCanvas.height = Math.round(view.height);
  pageCanvas.style.width = `${Math.round(vp.width * cssScale)}px`;
  stage.style.width = pageCanvas.style.width;
  const ctx = pageCanvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
  await page.render({ canvasContext: ctx, viewport: view, canvas: pageCanvas })
    .promise;
  $('page-label').textContent = t('Page {a} of {b}', {
    a: pageNo + 1,
    b: pageCount,
  });
  $<HTMLButtonElement>('page-prev').disabled = pageNo === 0;
  $<HTMLButtonElement>('page-next').disabled = pageNo === pageCount - 1;
  drawSpots();
}

const heightOf = (s: Spot) =>
  vp ? (s.w * vp.width) / aspect / vp.height : s.w / aspect;

function addSpot(): void {
  if (!vp) return;
  const w = Math.min(0.32, (vp.height / vp.width) * 0.09 * aspect); // about 9% of the page height
  const s: Spot = { page: pageNo, w, x: 0.92 - w, y: 0 };
  s.y = Math.max(0.02, 0.88 - heightOf(s));
  spots.push(s);
  drawSpots();
  const last = layer.lastElementChild;
  if (last instanceof HTMLElement) last.focus({ preventScroll: true });
  saveBtn.disabled = false;
  result.hidden = true;
}

function place(el: HTMLElement, s: Spot): void {
  el.style.left = `${s.x * 100}%`;
  el.style.top = `${s.y * 100}%`;
  el.style.width = `${s.w * 100}%`;
  el.style.height = `${heightOf(s) * 100}%`;
}
const clamp = (s: Spot) => {
  s.w = Math.max(0.04, Math.min(1, s.w));
  s.x = Math.max(0, Math.min(1 - s.w, s.x));
  s.y = Math.max(0, Math.min(1 - heightOf(s), s.y));
};

function drawSpots(): void {
  layer.innerHTML = '';
  spots
    .filter((s) => s.page === pageNo)
    .forEach((s) => {
      const el = document.createElement('div');
      el.className = 'sig-item';
      el.tabIndex = 0;
      el.setAttribute('role', 'group');
      el.setAttribute(
        'aria-label',
        t(
          'Signature. Drag or use arrow keys to move, plus and minus to resize, Delete to remove.'
        )
      );
      el.innerHTML = `<img src="${pngUrl}" alt="" /><span class="sig-handle" aria-hidden="true"></span><button type="button" class="sig-del" aria-label="${t('Remove this signature')}"><svg class="i i-sm" aria-hidden="true"><use href="#i-x" /></svg></button>`;
      place(el, s);
      layer.append(el);

      // drag to move; the corner handle resizes
      let start: {
        px: number;
        py: number;
        x: number;
        y: number;
        w: number;
        resize: boolean;
      } | null = null;
      el.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.sig-del')) return;
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable: dragging still works while the pointer stays on the item */
        }
        el.focus({ preventScroll: true });
        start = {
          px: e.clientX,
          py: e.clientY,
          x: s.x,
          y: s.y,
          w: s.w,
          resize: !!(e.target as HTMLElement).closest('.sig-handle'),
        };
      });
      el.addEventListener('pointermove', (e) => {
        if (!start) return;
        const r = stage.getBoundingClientRect();
        const dx = (e.clientX - start.px) / r.width;
        const dy = (e.clientY - start.py) / r.height;
        if (start.resize) s.w = start.w + dx;
        else {
          s.x = start.x + dx;
          s.y = start.y + dy;
        }
        clamp(s);
        place(el, s);
        result.hidden = true;
      });
      const end = (): void => {
        start = null;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.05 : 0.01;
        const k = e.key;
        if (k === 'ArrowLeft') s.x -= step;
        else if (k === 'ArrowRight') s.x += step;
        else if (k === 'ArrowUp') s.y -= step;
        else if (k === 'ArrowDown') s.y += step;
        else if (k === '+' || k === '=') s.w *= 1.08;
        else if (k === '-') s.w /= 1.08;
        else if (k === 'Delete' || k === 'Backspace') return remove(s);
        else return;
        e.preventDefault();
        clamp(s);
        place(el, s);
        result.hidden = true;
      });
      el.querySelector('.sig-del')!.addEventListener('click', () => remove(s));
    });
  const total = spots.length;
  $('place-hint').textContent = total
    ? tn(
        total,
        '{n} signature placed. Drag to move, pull the corner to resize.',
        '{n} signatures placed. Drag to move, pull the corner to resize.'
      )
    : t('No signature placed yet. Use “Add to this page”.');
  saveBtn.disabled = total === 0;
}

function remove(s: Spot): void {
  spots = spots.filter((x) => x !== s);
  drawSpots();
  result.hidden = true;
}

async function saveSigned(): Promise<void> {
  if (!pdf || !bytes || !png || !spots.length) return;
  err.hidden = true;
  saveBtn.disabled = true;
  saveBtn.textContent = t('Saving…');
  try {
    const { PDFDocument, degrees } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    const img = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
    for (const s of spots) {
      const pg = await pdf.getPage(s.page + 1);
      const v = pg.getViewport({ scale: 1 });
      const w = s.w * v.width;
      const h = w / aspect;
      const left = s.x * v.width;
      const bottom = s.y * v.height + h;
      // the signature's lower-left corner on screen, in the page's own coordinates;
      // on a rotated page the image is turned by the page rotation so it reads upright
      const [x, y] = v.convertToPdfPoint(left, bottom);
      doc.getPage(s.page).drawImage(img, {
        x,
        y,
        width: w,
        height: h,
        rotate: degrees(v.rotation),
      });
    }
    const out = await doc.save();
    const name = `${fileName.replace(/\.pdf$/i, '')}-signed.pdf`;
    output = {
      blob: new Blob([new Uint8Array(out)], { type: 'application/pdf' }),
      name,
    };
    const pages = new Set(spots.map((s) => s.page + 1));
    $('sign-result-sub').textContent = `${name} · ${
      pages.size === 1
        ? t('signed on page {p}', { p: [...pages][0] })
        : t('signed on pages {p}', {
            p: [...pages].sort((a, b) => a - b).join(', '),
          })
    }`;
    result.hidden = false;
    $('signed-download').focus({ preventScroll: true });
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    console.error(e);
    const locked = /encrypt/i.test(String(e));
    showError(
      locked
        ? t(
            'This PDF has editing restrictions, so a signature cannot be added. <a href="{link}">Remove them</a> first.',
            { link: href('/unlock-pdf') }
          )
        : t(
            'Could not save the signed PDF. Try again, or tell us at hello@yurgon.app.'
          )
    );
  } finally {
    saveBtn.textContent = t('Save signed PDF');
    saveBtn.disabled = spots.length === 0;
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
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  document.dispatchEvent(
    new CustomEvent('plyleaf:done', { detail: { tool: 'signature-generator' } })
  );
}

function wire(): void {
  wired = true;
  input.addEventListener('change', () => void takePdf(input.files?.[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.dataset.state = 'over';
  });
  drop.addEventListener('dragleave', () => (drop.dataset.state = 'idle'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.dataset.state = 'idle';
    void takePdf(e.dataTransfer?.files[0]);
  });
  $('page-prev').addEventListener('click', () => void showPage(pageNo - 1));
  $('page-next').addEventListener('click', () => void showPage(pageNo + 1));
  $('place-add').addEventListener('click', addSpot);
  $('back-make').addEventListener('click', back);
  saveBtn.addEventListener('click', () => void saveSigned());
  $('signed-download').addEventListener('click', download);
  $('sign-again').addEventListener('click', () => {
    pdf?.destroy();
    pdf = null;
    bytes = null;
    spots = [];
    output = null;
    input.value = '';
    result.hidden = true;
    placer.hidden = true;
    drop.hidden = false;
    saveBtn.disabled = true;
  });
  let rw = 0;
  new ResizeObserver(() => {
    const w = placer.clientWidth;
    if (pdf && !placer.hidden && w && Math.abs(w - rw) > 24) {
      rw = w;
      void showPage(pageNo);
    }
  }).observe(placer);
}
