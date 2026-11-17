// Stage 1 of PDF to EPUB: read a PDF with pdf.js into styled lines, pictures and bookmarks.
// Pages without a text layer are handed to OCR (ocr.ts). Everything stays in the browser.
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from '../../../js/pdf.worker?worker&url';
import type {
  Extracted,
  Line,
  OutlineItem,
  PageInfo,
  Picture,
  Seg,
} from './model';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const { OPS, Util } = pdfjsLib;

export interface Progress {
  stage: 'read' | 'ocr' | 'ocr-load';
  done: number;
  total: number;
}
export interface ExtractOptions {
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
}
export interface RecognizeOptions extends ExtractOptions {
  /** also cut out pictures between the recognised lines (default true) */
  pictures?: boolean;
  /** recognise one rendered page; returns its lines */
  ocr: (
    canvas: HTMLCanvasElement,
    scale: number,
    page: number
  ) => Promise<Line[]>;
}

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: '/pdfjs-viewer/standard_fonts/',
    cMapUrl: '/pdfjs-viewer/cmaps/',
    cMapPacked: true,
    iccUrl: '/pdfjs-viewer/iccs/',
  }).promise;
}

interface RawItem {
  t: string;
  x: number;
  w: number;
  base: number;
  size: number;
  bold: boolean;
  italic: boolean;
}

const STYLE_BOLD = /bold|black|heavy|semibold|demi|[-,]bd\b|w[6-9]00/i;
const STYLE_ITALIC = /italic|oblique|[-,]it\b|slanted|kursiv/i;

interface FontLike {
  name?: string;
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
}

function fontStyle(
  page: PDFPageProxy,
  fontName: string,
  cache: Map<string, { bold: boolean; italic: boolean }>
) {
  let s = cache.get(fontName);
  if (s) return s;
  let f: FontLike | null;
  try {
    f = page.commonObjs.has(fontName)
      ? (page.commonObjs.get(fontName) as FontLike)
      : null;
  } catch {
    f = null;
  }
  const name = (f?.name || '').replace(/^[A-Z]{6}\+/, '');
  s = {
    bold: Boolean(f?.bold || f?.black) || STYLE_BOLD.test(name),
    italic: Boolean(f?.italic) || STYLE_ITALIC.test(name),
  };
  cache.set(fontName, s);
  return s;
}

/** Text items → positioned items in viewport space (points, y down). */
function rawItems(
  items: TextItem[],
  vp: PageViewport,
  page: PDFPageProxy,
  cache: Map<string, { bold: boolean; italic: boolean }>
): RawItem[] {
  const out: RawItem[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const m = Util.transform(vp.transform, it.transform) as number[];
    // skip rotated or vertical text: it is rare in books and breaks line building
    if (Math.abs(m[1]) > Math.abs(m[0]) * 0.2 || m[0] <= 0) continue;
    const size = Math.hypot(m[2], m[3]);
    if (size < 2) continue;
    const st = fontStyle(page, it.fontName, cache);
    out.push({
      t: it.str,
      x: m[4],
      w: it.width * vp.scale,
      base: m[5],
      size,
      ...st,
    });
  }
  return out;
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/** Group items into lines: same baseline, small raised items join the line below them. */
export function buildLines(items: RawItem[], page: number): Line[] {
  if (!items.length) return [];
  const sizes = median(items.filter((i) => i.t.trim()).map((i) => i.size));
  const main = items.filter((i) => i.size >= sizes * 0.8 || !i.t.trim());
  const small = items.filter((i) => i.size < sizes * 0.8 && i.t.trim());
  main.sort((a, b) => a.base - b.base || a.x - b.x);

  type Row = { base: number; size: number; items: RawItem[] };
  const rows: Row[] = [];
  for (const it of main) {
    const r = rows.find(
      (r) => Math.abs(r.base - it.base) < Math.max(r.size, it.size) * 0.35
    );
    if (r) {
      r.items.push(it);
      if (it.t.trim() && it.size > r.size) r.size = it.size;
    } else rows.push({ base: it.base, size: it.size, items: [it] });
  }
  // small items: footnote markers raised on a body line, or small lines of their own
  for (const it of small) {
    const host = rows.find(
      (r) =>
        it.base < r.base + 0.5 &&
        it.base > r.base - r.size * 0.9 &&
        r.items.some(
          (o) => o.t.trim() && it.x >= o.x - 2 && it.x <= o.x + o.w + r.size
        )
    );
    if (host) host.items.push({ ...it, sup: true } as RawItem & { sup: true });
    else {
      const r = rows.find((r) => Math.abs(r.base - it.base) < it.size * 0.35);
      if (r) r.items.push(it);
      else rows.push({ base: it.base, size: it.size, items: [it] });
    }
  }

  const lines: Line[] = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    // split a row at wide gaps: columns or table cells
    let cur: RawItem[] = [];
    const flush = () => {
      if (cur.some((i) => i.t.trim())) lines.push(toLine(cur, r, page));
      cur = [];
    };
    for (const it of r.items) {
      const prev = cur[cur.length - 1];
      if (prev && it.x - (prev.x + prev.w) > r.size * 3) flush();
      cur.push(it);
    }
    flush();
  }
  return orderColumns(lines);
}

function toLine(
  items: RawItem[],
  row: { base: number; size: number },
  page: number
): Line {
  const segs: Seg[] = [];
  let lastEnd = -Infinity;
  let chars = 0,
    boldChars = 0,
    italChars = 0;
  for (const it of items) {
    const sup = (it as RawItem & { sup?: boolean }).sup === true;
    let t = it.t;
    const gap = it.x - lastEnd;
    const prev = segs[segs.length - 1];
    if (
      prev &&
      gap > row.size * 0.12 &&
      !/\s$/.test(prev.t) &&
      !/^\s/.test(t) &&
      !sup
    )
      t = ' ' + t;
    lastEnd = Math.max(lastEnd, it.x + it.w);
    const n = it.t.replace(/\s/g, '').length;
    if (!sup) {
      chars += n;
      if (it.bold) boldChars += n;
      if (it.italic) italChars += n;
    }
    if (
      prev &&
      Boolean(prev.bold) === it.bold &&
      Boolean(prev.italic) === it.italic &&
      Boolean(prev.sup) === sup
    )
      prev.t += t;
    else
      segs.push({
        t,
        ...(it.bold ? { bold: true } : {}),
        ...(it.italic ? { italic: true } : {}),
        ...(sup ? { sup: true } : {}),
      });
  }
  const main = items.filter(
    (i) => !(i as RawItem & { sup?: boolean }).sup && i.t.trim()
  );
  const size = main.length ? median(main.map((i) => i.size)) : row.size;
  const x0 = Math.min(...items.filter((i) => i.t.trim()).map((i) => i.x));
  const x1 = Math.max(...items.map((i) => i.x + i.w));
  return {
    page,
    segs,
    x0,
    x1,
    base: row.base,
    top: row.base - size * 0.8,
    size,
    bold: chars > 0 && boldChars / chars > 0.8,
    italic: chars > 0 && italChars / chars > 0.8,
  };
}

/** Two-column pages: read the left column, then the right one. */
function orderColumns(lines: Line[]): Line[] {
  lines.sort((a, b) => a.base - b.base || a.x0 - b.x0);
  if (lines.length < 8) return lines;
  const left = Math.min(...lines.map((l) => l.x0));
  const right = Math.max(...lines.map((l) => l.x1));
  const mid = (left + right) / 2;
  const width = right - left;
  const leftCol = lines.filter((l) => l.x1 < mid + width * 0.04);
  const rightCol = lines.filter((l) => l.x0 > mid - width * 0.04);
  if (
    leftCol.length + rightCol.length < lines.length * 0.75 ||
    leftCol.length < 4 ||
    rightCol.length < 4
  )
    return lines;
  // full-width lines (titles) keep their place above the columns
  const full = lines.filter(
    (l) => !leftCol.includes(l) && !rightCol.includes(l)
  );
  const firstCol = Math.min(leftCol[0].base, rightCol[0].base);
  const above = full.filter((l) => l.base < firstCol);
  const below = full.filter((l) => l.base >= firstCol);
  return [...above, ...leftCol, ...rightCol, ...below];
}

// ---------- pictures: raster images and larger vector drawings ----------

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
type Mat = number[];

function boxOf(m: Mat, x0: number, y0: number, x1: number, y1: number): Box {
  const pts = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x0 < b.x1 + pad &&
  b.x0 < a.x1 + pad &&
  a.y0 < b.y1 + pad &&
  b.y0 < a.y1 + pad;

async function pictureBoxes(
  page: PDFPageProxy,
  vp: PageViewport
): Promise<{ images: Box[]; drawings: Box[] }> {
  const ol = await page.getOperatorList();
  const images: Box[] = [];
  const drawings: Box[] = [];
  let m: Mat = vp.transform.slice();
  // fill and stroke colours: white shapes are page backgrounds, not drawings
  let fill = '#000000',
    stroke = '#000000';
  const stack: { m: Mat; fill: string; stroke: string }[] = [];
  const isWhite = (c: string) => /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(c);
  const PAINT = new Set<number>([
    OPS.fill,
    OPS.eoFill,
    OPS.stroke,
    OPS.closeStroke,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  const STROKES = new Set<number>([OPS.stroke, OPS.closeStroke]);
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const a = ol.argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ m: m.slice(), fill, stroke });
        break;
      case OPS.restore: {
        const st = stack.pop();
        if (st) ({ m, fill, stroke } = st);
        break;
      }
      case OPS.setFillRGBColor:
        if (typeof a[0] === 'string') fill = a[0];
        break;
      case OPS.setStrokeRGBColor:
        if (typeof a[0] === 'string') stroke = a[0];
        break;
      case OPS.transform:
        m = Util.transform(m, a as number[]) as Mat;
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ m: m.slice(), fill, stroke });
        if (Array.isArray(a[0])) m = Util.transform(m, a[0] as number[]) as Mat;
        break;
      case OPS.paintFormXObjectEnd: {
        const st = stack.pop();
        if (st) ({ m, fill, stroke } = st);
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageXObjectRepeat:
        images.push(boxOf(m, 0, 0, 1, 1));
        break;
      case OPS.constructPath: {
        // clip paths (op endPath) and white shapes draw nothing visible
        const op = a[0] as number;
        if (!PAINT.has(op)) break;
        if (isWhite(STROKES.has(op) ? stroke : fill)) break;
        const mm = a[2] as number[] | null;
        if (mm && mm.length === 4 && isFinite(mm[0]))
          drawings.push(boxOf(m, mm[0], mm[1], mm[2], mm[3]));
        break;
      }
    }
  }
  return { images, drawings };
}

/** Merge overlapping boxes into clusters. */
function cluster(boxes: Box[], pad: number): Box[] {
  const out: Box[] = [];
  for (const b of boxes) {
    let cur = { ...b };
    for (let k = out.length - 1; k >= 0; k--) {
      if (overlaps(out[k], cur, pad)) {
        const o = out.splice(k, 1)[0];
        cur = {
          x0: Math.min(o.x0, cur.x0),
          y0: Math.min(o.y0, cur.y0),
          x1: Math.max(o.x1, cur.x1),
          y1: Math.max(o.y1, cur.y1),
        };
        k = out.length;
      }
    }
    out.push(cur);
  }
  return out;
}

function chooseRegions(
  found: { images: Box[]; drawings: Box[] },
  lines: Line[],
  w: number,
  h: number
): Box[] {
  const pageA = w * h;
  const clip = (b: Box): Box => ({
    x0: Math.max(0, b.x0),
    y0: Math.max(0, b.y0),
    x1: Math.min(w, b.x1),
    y1: Math.min(h, b.y1),
  });
  const textBoxes = lines.map((l) => ({
    x0: l.x0,
    y0: l.top,
    x1: l.x1,
    y1: l.base + l.size * 0.25,
  }));
  const textHeavy = (b: Box) => {
    const inside = textBoxes.filter(
      (t) =>
        t.x0 >= b.x0 - 2 &&
        t.x1 <= b.x1 + 2 &&
        t.y0 >= b.y0 - 2 &&
        t.y1 <= b.y1 + 2
    );
    const ta = inside.reduce((s, t) => s + area(t), 0);
    // a box around running text (a frame, a shaded note) is not a picture
    return inside.length > 6 && ta > area(b) * 0.3;
  };
  const imgs = found.images
    .map(clip)
    .filter((b) => area(b) > pageA * 0.01 && area(b) < pageA * 0.9);
  // vector art: skip hairlines (rules, underlines) and full-page backgrounds
  const vec = cluster(
    found.drawings
      .map(clip)
      .filter(
        (b) => b.x1 - b.x0 > 1.5 && b.y1 - b.y0 > 1.5 && area(b) < pageA * 0.85
      ),
    6
  ).filter(
    (b) => area(b) > pageA * 0.02 && b.x1 - b.x0 > 40 && b.y1 - b.y0 > 30
  );
  return cluster([...imgs, ...vec], 2).filter((b) => !textHeavy(b));
}

async function renderPage(
  page: PDFPageProxy,
  scale: number
): Promise<HTMLCanvasElement> {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // "print" intent renders without requestAnimationFrame, so it keeps going in a background tab
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport: vp,
    intent: 'print',
  }).promise;
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), type, q)
  );

async function cropPictures(
  page: PDFPageProxy,
  regions: Box[],
  pageNo: number
): Promise<Picture[]> {
  if (!regions.length) return [];
  const longest = Math.max(
    ...regions.map((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0))
  );
  // aim for about 1200 px on the longest side of the largest picture
  const scale = Math.min(3, Math.max(1.5, 1200 / longest));
  const canvas = await renderPage(page, scale);
  const out: Picture[] = [];
  for (const b of regions) {
    const pad = 2;
    const sx = Math.max(0, Math.floor((b.x0 - pad) * scale));
    const sy = Math.max(0, Math.floor((b.y0 - pad) * scale));
    const sw = Math.min(
      canvas.width - sx,
      Math.ceil((b.x1 - b.x0 + pad * 2) * scale)
    );
    const sh = Math.min(
      canvas.height - sy,
      Math.ceil((b.y1 - b.y0 + pad * 2) * scale)
    );
    if (sw < 8 || sh < 8) continue;
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    c.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    out.push({
      page: pageNo,
      x0: b.x0,
      x1: b.x1,
      top: b.y0,
      bottom: b.y1,
      blob: await toBlob(c, 'image/jpeg', 0.85),
      type: 'image/jpeg',
      w: sw,
      h: sh,
    });
  }
  canvas.width = canvas.height = 0;
  return out;
}

// ---------- bookmarks ----------

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

async function readOutline(
  pdf: PDFDocumentProxy,
  heights: (p: number) => { h: number; vp: PageViewport | null }
): Promise<OutlineItem[]> {
  let tree: OutlineNode[] | null;
  try {
    tree = await pdf.getOutline();
  } catch {
    tree = null;
  }
  if (!tree?.length) return [];
  const out: OutlineItem[] = [];
  const walk = async (nodes: OutlineNode[], depth: number) => {
    for (const n of nodes) {
      try {
        let dest = n.dest as unknown;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0] != null) {
          const ref = dest[0] as { num: number; gen: number } | number;
          const page =
            typeof ref === 'number' ? ref : await pdf.getPageIndex(ref);
          let top: number | null = null;
          const kind = (dest[1] as { name?: string })?.name;
          const info = heights(page);
          if (kind === 'XYZ' && typeof dest[3] === 'number' && info.vp) {
            top = (info.vp.convertToViewportPoint(0, dest[3]) as number[])[1];
          } else if (
            (kind === 'FitH' || kind === 'FitBH') &&
            typeof dest[2] === 'number' &&
            info.vp
          ) {
            top = (info.vp.convertToViewportPoint(0, dest[2]) as number[])[1];
          }
          const title = (n.title || '').replace(/\s+/g, ' ').trim();
          if (title) out.push({ title, depth, page, top });
        }
      } catch {
        /* a broken bookmark is skipped */
      }
      if (n.items?.length) await walk(n.items, depth + 1);
    }
  };
  await walk(tree, 0);
  return out;
}

// ---------- language ----------

export function guessLang(text: string, fallback = 'en'): string {
  const sample = text.slice(0, 20000);
  const count = (re: RegExp) => (sample.match(re) || []).length;
  const letters = count(/\p{L}/gu) || 1;
  if (count(/[Ѐ-ӿ]/g) / letters > 0.4) {
    if (count(/[іїєґ]/gi) > letters * 0.005) return 'uk';
    if (count(/[ўі]/gi) > letters * 0.005) return 'be';
    if (count(/[ђћџљњ]/gi) > letters * 0.002) return 'sr';
    return 'ru';
  }
  if (count(/[֐-׿]/g) / letters > 0.4) return 'he';
  if (count(/[؀-ۿ]/g) / letters > 0.4) return 'ar';
  if (count(/[Ͱ-Ͽ]/g) / letters > 0.4) return 'el';
  if (count(/[぀-ヿ]/g) > letters * 0.05) return 'ja';
  if (count(/[一-鿿]/g) / letters > 0.3) return 'zh';
  if (count(/[가-힯]/g) / letters > 0.3) return 'ko';
  const words = sample.toLowerCase().match(/\p{L}+/gu) || [];
  const hits = (list: string[]) => {
    const s = new Set(list);
    return words.filter((w) => s.has(w)).length;
  };
  const scores: [string, number][] = [
    ['en', hits(['the', 'and', 'of', 'to', 'is', 'that', 'with'])],
    ['de', hits(['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit'])],
    ['fr', hits(['le', 'la', 'les', 'et', 'des', 'est', 'une'])],
    ['es', hits(['el', 'los', 'que', 'y', 'del', 'las', 'una'])],
    ['it', hits(['il', 'che', 'di', 'e', 'della', 'per', 'una'])],
    ['pt', hits(['o', 'que', 'não', 'uma', 'os', 'do', 'da'])],
    ['pl', hits(['nie', 'się', 'jest', 'że', 'na', 'w', 'i'])],
    ['nl', hits(['de', 'het', 'een', 'en', 'van', 'niet', 'is'])],
    ['cs', hits(['je', 'že', 'se', 'na', 'to', 'jsem', 'ale'])],
    ['tr', hits(['bir', 've', 'bu', 'için', 'ile', 'çok', 'da'])],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 5 ? scores[0][0] : fallback;
}

// ---------- main ----------

const pdfDateLess = (s: unknown) =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';

export async function extract(
  pdf: PDFDocumentProxy,
  opt: ExtractOptions
): Promise<Extracted> {
  const n = pdf.numPages;
  const pages: PageInfo[] = [];
  const lines: Line[] = [];
  const pictures: Picture[] = [];
  const vps: (PageViewport | null)[] = [];
  let cover: Blob | null = null;

  for (let p = 0; p < n; p++) {
    if (opt.signal.aborted) throw new Cancelled();
    opt.onProgress({ stage: 'read', done: p, total: n });
    const page = await pdf.getPage(p + 1);
    const vp = page.getViewport({ scale: 1 });
    vps.push(vp);
    const info: PageInfo = { w: vp.width, h: vp.height, ocr: false };
    pages.push(info);
    if (p === 0) {
      try {
        const c = await renderPage(page, Math.min(3, 1200 / vp.width));
        cover = await toBlob(c, 'image/jpeg', 0.88);
        c.width = c.height = 0;
      } catch {
        cover = null;
      }
    }
    const found = await pictureBoxes(page, vp); // also loads fonts into commonObjs
    const tc = await page.getTextContent();
    const items = rawItems(
      tc.items.filter((i): i is TextItem => 'str' in i),
      vp,
      page,
      new Map()
    );
    const chars = items.reduce((s, i) => s + i.t.replace(/\s/g, '').length, 0);
    const bigImage = found.images.some(
      (b) => area(b) > vp.width * vp.height * 0.5
    );
    if (chars < 20 && bigImage) {
      info.ocr = true;
      page.cleanup();
      continue;
    }
    const pageLines = buildLines(items, p);
    lines.push(...pageLines);
    const regions = chooseRegions(found, pageLines, vp.width, vp.height);
    if (regions.length)
      pictures.push(...(await cropPictures(page, regions, p)));
    page.cleanup();
  }

  lines.sort((a, b) => a.page - b.page);

  const outline = await readOutline(pdf, (p) => ({
    h: pages[p]?.h ?? 0,
    vp: vps[p] ?? null,
  }));
  let title = '',
    author = '',
    lang = '';
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as Record<string, unknown>;
    title = pdfDateLess(info?.Title);
    author = pdfDateLess(info?.Author);
    lang = pdfDateLess(info?.Language).slice(0, 2).toLowerCase();
    const md = meta.metadata;
    if (md) {
      title ||= pdfDateLess(md.get('dc:title'));
      author ||= pdfDateLess(md.get('dc:creator'));
    }
  } catch {
    /* no metadata */
  }
  const text = lines
    .slice(0, 800)
    .map((l) => l.segs.map((s) => s.t).join(''))
    .join(' ');
  lang = /^[a-z]{2}$/.test(lang) ? lang : guessLang(text);
  return { pages, lines, pictures, outline, title, author, lang, cover };
}

/** Recognise the scanned pages of an extracted book and add their lines (in page order). */
export async function recognizePages(
  pdf: PDFDocumentProxy,
  ex: Extracted,
  opt: RecognizeOptions
): Promise<void> {
  const queue = ex.pages.map((p, i) => (p.ocr ? i : -1)).filter((i) => i >= 0);
  const got: Line[] = [];
  const pics: Picture[] = [];
  for (let k = 0; k < queue.length; k++) {
    if (opt.signal.aborted) throw new Cancelled();
    const p = queue[k];
    opt.onProgress({ stage: 'ocr', done: k, total: queue.length });
    const page = await pdf.getPage(p + 1);
    const vp = page.getViewport({ scale: 1 });
    // about 250 dpi for text recognition, capped for phones
    const scale = Math.min(250 / 72, 3200 / Math.max(vp.width, vp.height));
    const canvas = await renderPage(page, scale);
    if (opt.signal.aborted) throw new Cancelled();
    const pageLines = await opt.ocr(canvas, scale, p);
    got.push(...pageLines);
    if (opt.pictures !== false)
      pics.push(...(await scannedPictures(canvas, scale, pageLines, p)));
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
  opt.onProgress({ stage: 'ocr', done: queue.length, total: queue.length });
  // stable sort keeps the reading order inside each page
  ex.lines = [...ex.lines, ...got].sort((a, b) => a.page - b.page);
  ex.pictures.push(...pics);
}

/**
 * Pictures on a scanned page: wide gaps between recognised lines that still hold ink.
 * The search stays inside the text column, so dark scan edges are not taken for pictures.
 */
async function scannedPictures(
  canvas: HTMLCanvasElement,
  scale: number,
  lines: Line[],
  page: number
): Promise<Picture[]> {
  const W = canvas.width / scale;
  const H = canvas.height / scale;
  const sorted = [...lines].sort((a, b) => a.top - b.top);
  const body = median(sorted.map((l) => l.size)) || 10;
  const left = sorted.length ? Math.min(...sorted.map((l) => l.x0)) : W * 0.08;
  const right = sorted.length ? Math.max(...sorted.map((l) => l.x1)) : W * 0.92;
  const bands: Box[] = [];
  const minGap = Math.max(40, body * 4);
  if (!sorted.length)
    bands.push({ x0: W * 0.06, y0: H * 0.06, x1: W * 0.94, y1: H * 0.94 });
  for (let i = 0; i < sorted.length; i++) {
    const top = i === 0 ? H * 0.08 : sorted[i - 1].base + body * 0.4;
    const bottom = sorted[i].top - body * 0.2;
    if (bottom - top > minGap)
      bands.push({ x0: left - 4, y0: top, x1: right + 4, y1: bottom });
  }
  const last = sorted[sorted.length - 1];
  if (last && H * 0.92 - (last.base + body * 0.4) > minGap)
    bands.push({
      x0: left - 4,
      y0: last.base + body * 0.4,
      x1: right + 4,
      y1: H * 0.92,
    });

  const ctx = canvas.getContext('2d')!;
  // paper colour: most of a page is paper, so take a high percentile of the darkest channel
  const all = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const step = Math.max(
    1,
    Math.floor(Math.sqrt((canvas.width * canvas.height) / 40000))
  );
  const mins: number[] = [];
  for (let y = 0; y < canvas.height; y += step)
    for (let x = 0; x < canvas.width; x += step) {
      const k = (y * canvas.width + x) * 4;
      mins.push(Math.min(all[k], all[k + 1], all[k + 2]));
    }
  mins.sort((a, b) => a - b);
  const paper = mins[Math.floor(mins.length * 0.75)] ?? 255;
  const inkBelow = paper - 28;
  const out: Picture[] = [];
  for (const b of bands) {
    const sx = Math.max(0, Math.floor(b.x0 * scale));
    const sy = Math.max(0, Math.floor(b.y0 * scale));
    const sw = Math.min(canvas.width - sx, Math.ceil((b.x1 - b.x0) * scale));
    const sh = Math.min(canvas.height - sy, Math.ceil((b.y1 - b.y0) * scale));
    if (sw < 20 || sh < 20) continue;
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    // tight box around ink, sampling every 2nd pixel
    let ink = 0,
      n = 0,
      minX = sw,
      minY = sh,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < sh; y += 2) {
      for (let x = 0; x < sw; x += 2) {
        const k = (y * sw + x) * 4;
        n++;
        if (Math.min(data[k], data[k + 1], data[k + 2]) < inkBelow) {
          ink++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!n || ink / n < 0.015 || ink / n > 0.97 || maxX < 0) continue;
    const bw = maxX - minX + 1,
      bh = maxY - minY + 1;
    if (bw < 30 * scale || bh < 24 * scale) continue;
    const c = document.createElement('canvas');
    c.width = bw;
    c.height = bh;
    c.getContext('2d')!.drawImage(
      canvas,
      sx + minX,
      sy + minY,
      bw,
      bh,
      0,
      0,
      bw,
      bh
    );
    // scans are rendered large for recognition; keep pictures at a sane size
    const longest = Math.max(bw, bh);
    let src = c;
    if (longest > 1400) {
      const k = 1400 / longest;
      src = document.createElement('canvas');
      src.width = Math.round(bw * k);
      src.height = Math.round(bh * k);
      src.getContext('2d')!.drawImage(c, 0, 0, src.width, src.height);
    }
    out.push({
      page,
      x0: (sx + minX) / scale,
      x1: (sx + maxX) / scale,
      top: (sy + minY) / scale,
      bottom: (sy + maxY) / scale,
      blob: await toBlob(src, 'image/jpeg', 0.85),
      type: 'image/jpeg',
      w: src.width,
      h: src.height,
    });
  }
  return out;
}
