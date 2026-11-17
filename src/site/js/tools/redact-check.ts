// After redaction: reads the finished file the way anyone else would (pdf.js text extraction,
// document properties, bookmarks) and looks for every phrase that was blacked out. Used by the
// PDF editor before it downloads a file with applied redactions.
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from '../../../js/pdf.worker?worker&url';
import { t, tn } from '../i18n';

pdfjsLib.GlobalWorkerOptions.workerSrc ||= pdfWorkerUrl;

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** The phrases from `terms` that can still be found in the file. */
export async function findLeftovers(
  bytes: Uint8Array,
  terms: string[]
): Promise<string[]> {
  const doc = await pdfjsLib.getDocument({
    data: bytes.slice(), // pdf.js takes the buffer over; keep ours for the download
    wasmUrl: import.meta.env.BASE_URL + 'pdfjs-viewer/wasm/',
  }).promise;
  try {
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      for (const it of content.items) if ('str' in it) parts.push(it.str);
      page.cleanup();
    }
    const meta = await doc.getMetadata().catch((): null => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    for (const v of Object.values(info))
      if (typeof v === 'string') parts.push(v);
    const xmp = ((
      meta?.metadata as { getAll?: () => object } | null
    )?.getAll?.() ?? {}) as Record<string, unknown>;
    for (const v of Object.values(xmp))
      if (typeof v === 'string') parts.push(v);
    const walk = (items: { title: string; items: unknown[] }[] | null) => {
      for (const o of items ?? []) {
        parts.push(o.title);
        walk(o.items as { title: string; items: unknown[] }[]);
      }
    };
    walk(await doc.getOutline().catch((): null => null));
    // words can be split into several text pieces, so compare without spaces
    const haystack = flat(parts.join(''));
    return terms.filter((term) => {
      const f = flat(term);
      return f.length > 0 && haystack.includes(f);
    });
  } finally {
    await doc.destroy();
  }
}

export const checkedMessage = (n: number) => ({
  title: t('Redaction checked'),
  message: tn(
    n,
    'We searched the finished file for the blacked-out phrase: it is not in the text, the properties or the bookmarks.',
    'We searched the finished file for all {n} blacked-out phrases: none of them is in the text, the properties or the bookmarks.'
  ),
});

export const leftoverMessage = (words: string[]) => ({
  title: t('Some redacted text is still in the file'),
  message: t(
    'These words can still be found in the finished file: {words}. It was not downloaded. Black them out again, apply, and download once more.',
    { words: words.map((w) => `“${w}”`).join(', ') }
  ),
});
