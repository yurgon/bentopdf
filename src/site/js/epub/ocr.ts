// Text recognition for scanned pages (pages with no text layer). tesseract.js runs in a
// web worker on this device; only the language model is downloaded, the page never leaves.
import type Tesseract from 'tesseract.js';
import type { Line, Seg } from './model';

/** ISO 639-1 → Tesseract model names we offer. */
export const OCR_LANGS: Record<string, { code: string; name: string }> = {
  en: { code: 'eng', name: 'English' },
  ru: { code: 'rus', name: 'Russian' },
  uk: { code: 'ukr', name: 'Ukrainian' },
  de: { code: 'deu', name: 'German' },
  fr: { code: 'fra', name: 'French' },
  es: { code: 'spa', name: 'Spanish' },
  it: { code: 'ita', name: 'Italian' },
  pt: { code: 'por', name: 'Portuguese' },
  pl: { code: 'pol', name: 'Polish' },
  nl: { code: 'nld', name: 'Dutch' },
  cs: { code: 'ces', name: 'Czech' },
  sk: { code: 'slk', name: 'Slovak' },
  tr: { code: 'tur', name: 'Turkish' },
  el: { code: 'ell', name: 'Greek' },
  he: { code: 'heb', name: 'Hebrew' },
  ar: { code: 'ara', name: 'Arabic' },
  zh: { code: 'chi_sim', name: 'Chinese (simplified)' },
  ja: { code: 'jpn', name: 'Japanese' },
  ko: { code: 'kor', name: 'Korean' },
};

export interface Ocr {
  recognize(
    canvas: HTMLCanvasElement,
    scale: number,
    page: number
  ): Promise<Line[]>;
  stop(): Promise<void>;
}

export async function createOcr(
  lang: string,
  onLoad?: (p: number) => void
): Promise<Ocr> {
  const { createConfiguredTesseractWorker } =
    await import('../../../js/utils/tesseract-runtime.js');
  const code = OCR_LANGS[lang]?.code ?? 'eng';
  const langs = code === 'eng' ? 'eng' : `${code}+eng`;
  const worker: Tesseract.Worker = await createConfiguredTesseractWorker(
    langs,
    1,
    (m: Tesseract.LoggerMessage) => {
      if (onLoad && /load|initializ/i.test(m.status)) onLoad(m.progress);
    }
  );
  return {
    async recognize(canvas, scale, page) {
      const r = await worker.recognize(
        canvas,
        {},
        { blocks: true, text: false }
      );
      return toLines(r.data.blocks ?? [], scale, page);
    },
    async stop() {
      await worker.terminate();
    },
  };
}

function toLines(
  blocks: Tesseract.Block[],
  scale: number,
  page: number
): Line[] {
  const out: Line[] = [];
  for (const b of blocks) {
    for (const p of b.paragraphs) {
      p.lines.forEach((l, li) => {
        const letters = (l.text.match(/\p{L}/gu) || []).length;
        if (l.confidence < 45 && letters < 8) return; // specks and picture noise
        if (!l.text.trim()) return;
        const segs: Seg[] = [];
        for (const w of l.words) {
          const syms = w.symbols ?? [];
          const supAll = syms.length > 0 && syms.every((s) => s.is_superscript);
          const supTail =
            !supAll && syms.length > 1 && syms[syms.length - 1].is_superscript;
          if (supTail) {
            // "word¹": split the raised digits off the word
            let k = syms.length;
            while (k > 0 && syms[k - 1].is_superscript) k--;
            const head = syms
              .slice(0, k)
              .map((s) => s.text)
              .join('');
            const tail = syms
              .slice(k)
              .map((s) => s.text)
              .join('');
            push(segs, (segs.length ? ' ' : '') + head, false);
            push(segs, tail, true);
          } else
            push(segs, (segs.length && !supAll ? ' ' : '') + w.text, supAll);
        }
        const base = (l.baseline.y0 + l.baseline.y1) / 2 / scale;
        const h = (l.rowAttributes?.rowHeight || l.bbox.y1 - l.bbox.y0) / scale;
        const size = Math.max(4, h * 0.95);
        out.push({
          page,
          segs,
          x0: l.bbox.x0 / scale,
          x1: l.bbox.x1 / scale,
          top: l.bbox.y0 / scale,
          base: base > 0 ? base : l.bbox.y1 / scale,
          size,
          bold: false,
          italic: false,
          paraHint: li === 0,
        });
      });
    }
  }
  return out.sort((a, b) => a.top - b.top);
}

function push(segs: Seg[], t: string, sup: boolean) {
  const prev = segs[segs.length - 1];
  if (prev && Boolean(prev.sup) === sup) prev.t += t;
  else segs.push(sup ? { t, sup: true } : { t });
}
