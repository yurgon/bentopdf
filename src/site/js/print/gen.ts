// Shared controller for the printing generators: reads the form, redraws the preview
// on every change, prints at real size and saves a PDF. Nothing leaves the browser.
import '../../css/print-tools.css';
import {
  loadFonts,
  pageToSvg,
  printPages,
  toPdf,
  download,
  type Page,
} from './sheet';
import { t, tn } from '../i18n';

export interface Built {
  pages: Page[];
  /** short line under the preview, e.g. "30 cards on 15 pages" */
  summary: string;
  /** optional problem to show instead of the preview */
  error?: string;
}

export interface GenOptions {
  tool: string;
  title: string;
  fileName: () => string;
  build: () => Built;
  /** how many pages the preview shows before "and N more" (default 4) */
  previewMax?: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export function mountGenerator(o: GenOptions): { refresh: () => void } {
  const form = $<HTMLFormElement>('gen-form');
  const stage = $('gen-pages');
  const sum = $('gen-sum');
  const err = $('gen-error');
  const printBtn = $<HTMLButtonElement>('print-btn');
  const pdfBtn = $<HTMLButtonElement>('pdf-btn');
  const max = o.previewMax ?? 4;
  let current: Built = { pages: [], summary: '' };
  let timer = 0;

  const draw = () => {
    current = o.build();
    const ok = !current.error && current.pages.length > 0;
    err.hidden = !current.error;
    err.textContent = current.error ?? '';
    printBtn.disabled = pdfBtn.disabled = !ok;
    sum.textContent = current.summary;
    if (!ok) {
      stage.innerHTML = '';
      return;
    }
    const shown = current.pages.slice(0, max);
    const more = current.pages.length - shown.length;
    stage.innerHTML =
      shown
        .map(
          (p, i) =>
            `<figure class="gen-page" style="aspect-ratio:${p.w}/${p.h}">${pageToSvg(p, false, t('Page {a} of {b}', { a: i + 1, b: current.pages.length }))}</figure>`
        )
        .join('') +
      (more > 0
        ? `<p class="gen-more tnum">${tn(more, 'and {n} more page', 'and {n} more pages')}</p>`
        : '');
  };
  const refresh = () => {
    clearTimeout(timer);
    timer = window.setTimeout(draw, 60);
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  form.addEventListener('submit', (e) => e.preventDefault());

  const done = (how: string) =>
    window.dispatchEvent(
      new CustomEvent('plyleaf:done', { detail: { tool: o.tool, how } })
    );

  printBtn.addEventListener('click', async () => {
    draw();
    if (current.error) return;
    await printPages(current.pages);
    done('print');
  });
  pdfBtn.addEventListener('click', async () => {
    draw();
    if (current.error) return;
    const label = pdfBtn.innerHTML;
    pdfBtn.disabled = true;
    pdfBtn.textContent = t('Making PDF…');
    try {
      const blob = await toPdf(current.pages, { title: o.title });
      download(blob, o.fileName());
      done('pdf');
    } catch (e) {
      err.hidden = false;
      err.textContent = t('Could not make the PDF: {why}', {
        why: (e as Error).message,
      });
    } finally {
      pdfBtn.innerHTML = label;
      pdfBtn.disabled = false;
    }
  });

  draw();
  // the print font arrives a moment later; redraw so text is measured with it
  loadFonts().then(draw);
  return { refresh };
}

// ---------- form helpers ----------
export const formVal = (name: string): string => {
  const el = document.querySelector<HTMLInputElement>(
    `#gen-form [name="${name}"]:checked, #gen-form select[name="${name}"], #gen-form input[name="${name}"]:not([type=radio]):not([type=checkbox]), #gen-form textarea[name="${name}"]`
  );
  return el?.value ?? '';
};
export const formNum = (
  name: string,
  min: number,
  max: number,
  def: number
): number => {
  const v = parseFloat(formVal(name).replace(',', '.'));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
};
export const formOn = (name: string): boolean =>
  !!document.querySelector<HTMLInputElement>(`#gen-form input[name="${name}"]`)
    ?.checked;
export const formAll = (name: string): string[] =>
  [
    ...document.querySelectorAll<HTMLInputElement>(
      `#gen-form input[name="${name}"]:checked`
    ),
  ].map((i) => i.value);

/** Letter for the US, Canada, Mexico, the Philippines and a few others; A4 elsewhere. */
export function defaultPaper(): 'a4' | 'letter' {
  const lang = (
    navigator.languages?.[0] ??
    navigator.language ??
    ''
  ).toUpperCase();
  const region = lang.split('-')[1] ?? '';
  return ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'PR', 'GT', 'CR'].includes(
    region
  )
    ? 'letter'
    : 'a4';
}
/** Selects the paper radio for this visitor unless the page set it already. */
export function presetPaper(): void {
  const el = document.querySelector<HTMLInputElement>(
    `#gen-form input[name="paper"][value="${defaultPaper()}"]`
  );
  if (el) el.checked = true;
}
