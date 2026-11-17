// OCR additions for the Plyleaf page: how much language data the browser downloads before the
// first run, and how long the job will roughly take. Both are shown before anything starts.
import { t, tn, num } from '../i18n';

const sizes = new Map<string, Promise<number | null>>();

/** Compressed size of one Tesseract language pack, read from the CDN without downloading it. */
function packSize(code: string): Promise<number | null> {
  let p = sizes.get(code);
  if (!p) {
    const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`;
    p = fetch(url, { method: 'HEAD' })
      .then((r) =>
        r.ok ? +(r.headers.get('content-length') || 0) || null : null
      )
      .catch((): null => null);
    sizes.set(code, p);
  }
  return p;
}

const mb = (bytes: number) => num(Math.max(0.1, Math.round(bytes / 1e5) / 10));

/** "Language data to download: 4.1 MB (once; the browser keeps it for next time)." */
export async function packNote(codes: string[]): Promise<string> {
  if (!codes.length) return '';
  const all = await Promise.all(codes.map(packSize));
  if (all.some((s) => s == null))
    return t('Language data is downloaded once, then the browser keeps it.');
  const total = all.reduce((s: number, v) => s + (v as number), 0);
  return t(
    'Language data to download: {size} MB (once, then the browser keeps it).',
    { size: mb(total) }
  );
}

const isPhone = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/**
 * Rough time before the run. Measured on a laptop: about 4 s per page at the default
 * resolution (scale 2), growing with the square of the scale; phones are about 3 times slower.
 */
export function estimateNote(
  pages: number,
  scale: number,
  langs: number
): string {
  if (!pages) return '';
  const perPage = 4 * (scale / 2) ** 2 * (1 + 0.4 * Math.max(0, langs - 1));
  const phone = isPhone();
  const secs = pages * perPage * (phone ? 3 : 1);
  const time =
    secs < 60
      ? t('under a minute')
      : tn(Math.round(secs / 60), 'about {n} minute', 'about {n} minutes');
  let s = tn(pages, '{n} page: {time}.', '{n} pages: {time}.', { time });
  if (phone && secs > 120)
    s +=
      ' ' +
      t('On a phone, keep the screen on and this tab open, or it will pause.');
  return s;
}
