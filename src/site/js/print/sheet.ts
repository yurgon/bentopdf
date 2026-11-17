// Vector sheets for the printing generators (test page, graph paper, bingo, tracing).
// One list of drawing operations per page feeds three outputs: the on-screen preview (SVG),
// the browser print (the same SVG at real size) and the PDF download (pdf-lib, loaded lazily).
// Units are PDF points (1/72 inch), origin at the top left, y pointing down.
import type { PDFDocument, PDFFont, PDFPage, Color as PdfColor } from 'pdf-lib';

export const MM = 72 / 25.4;
export const INCH = 72;
export type Paper = 'a4' | 'letter';
export const PAPER: Record<Paper, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** '#rrggbb' or 'cmyk(c,m,y,k)' with 0..1 values; CMYK stays CMYK in the PDF. */
export type Color = string;

interface Paint {
  fill?: Color;
  stroke?: Color;
  /** stroke width in points */
  sw?: number;
  dash?: number[];
  cap?: 'butt' | 'round';
  opacity?: number;
}
export type Op =
  | ({ t: 'path'; d: string } & Paint)
  | ({ t: 'rect'; x: number; y: number; w: number; h: number } & Paint)
  | ({ t: 'circle'; cx: number; cy: number; r: number } & Paint)
  | {
      t: 'text';
      x: number;
      /** baseline */
      y: number;
      size: number;
      text: string;
      fill?: Color;
      bold?: boolean;
      anchor?: 'start' | 'middle' | 'end';
    };

export interface Page {
  w: number;
  h: number;
  ops: Op[];
}

// ---------- colours ----------
const CMYK_RE = /^cmyk\(([^)]+)\)$/;
function toRgb(c: Color): [number, number, number] {
  const m = c.match(CMYK_RE);
  if (m) {
    const [C, M, Y, K] = m[1].split(',').map(Number);
    return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)];
  }
  const h = c.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}
const css = (c: Color) => {
  if (!CMYK_RE.test(c)) return c;
  const [r, g, b] = toRgb(c).map((v) => Math.round(v * 255));
  return `rgb(${r} ${g} ${b})`;
};
export const grey = (v: number) => {
  const h = Math.round(v * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${h}${h}${h}`;
};

// ---------- text measuring (same font in preview, print and PDF) ----------
const FONT_URL = {
  regular: '/pdfjs-viewer/standard_fonts/LiberationSans-Regular.ttf',
  bold: '/pdfjs-viewer/standard_fonts/LiberationSans-Bold.ttf',
};
export const FONT_FAMILY = 'Plyleaf Print Sans';
let fontsReady: Promise<void> | null = null;
/** Loads the print font for the preview; call before measuring text. */
export function loadFonts(): Promise<void> {
  return (fontsReady ??= Promise.all(
    (['regular', 'bold'] as const).map(async (k) => {
      const f = new FontFace(FONT_FAMILY, `url(${FONT_URL[k]})`, {
        weight: k === 'bold' ? '700' : '400',
      });
      document.fonts.add(await f.load());
    })
  )
    .then((): void => undefined)
    .catch((): void => undefined));
}
let ctx: CanvasRenderingContext2D | null = null;
/** Width of a string in points at the given size. */
export function measure(text: string, size: number, bold = false): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * size * 0.55;
  ctx.font = `${bold ? 700 : 400} 100px "${FONT_FAMILY}", Arial, sans-serif`;
  return (ctx.measureText(text).width / 100) * size;
}

/**
 * Fits text into a box: wraps on spaces, shrinks down to minSize, and as a last resort
 * breaks a long word with a hyphen. Returns the size and the lines (centred by the caller).
 */
export function fitText(
  text: string,
  maxW: number,
  maxH: number,
  maxSize: number,
  minSize = 5,
  bold = false,
  lineGap = 1.15
): { size: number; lines: string[] } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  // shrink whole words down to half the size; below that, a hyphen reads better than tiny text
  const floor = Math.max(minSize, maxSize * 0.5);
  for (let size = maxSize; size >= floor; size -= 0.5) {
    const lines = wrap(words, maxW, size, bold);
    if (lines && lines.length * size * lineGap <= maxH) return { size, lines };
  }
  let best = { size: minSize, lines: [text] };
  for (let size = floor; size >= minSize; size -= 0.5) {
    const lines = breakWords(words, maxW, size, bold);
    best = { size, lines };
    if (lines.length * size * lineGap <= maxH) return best;
  }
  return best;
}
function breakWords(
  words: string[],
  maxW: number,
  size: number,
  bold: boolean
): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    for (const piece of hyphenate(w, maxW, size, bold)) {
      const next = cur ? `${cur} ${piece}` : piece;
      if (measure(next, size, bold) <= maxW) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = piece;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function wrap(
  words: string[],
  maxW: number,
  size: number,
  bold: boolean
): string[] | null {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (measure(w, size, bold) > maxW) return null;
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next, size, bold) <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function hyphenate(
  w: string,
  maxW: number,
  size: number,
  bold: boolean
): string[] {
  if (measure(w, size, bold) <= maxW) return [w];
  const out: string[] = [];
  let rest = [...w];
  while (rest.length) {
    let n = rest.length;
    while (n > 1 && measure(rest.slice(0, n).join('') + '-', size, bold) > maxW)
      n--;
    const last = n === rest.length;
    out.push(rest.slice(0, n).join('') + (last ? '' : '-'));
    rest = rest.slice(n);
  }
  return out;
}

// ---------- SVG (preview and print) ----------
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => +v.toFixed(2);
function paintAttrs(p: Paint): string {
  const a: string[] = [];
  a.push(`fill="${p.fill ? css(p.fill) : 'none'}"`);
  if (p.stroke) {
    a.push(`stroke="${css(p.stroke)}"`, `stroke-width="${n(p.sw ?? 1)}"`);
    if (p.dash?.length) a.push(`stroke-dasharray="${p.dash.map(n).join(' ')}"`);
    if (p.cap) a.push(`stroke-linecap="${p.cap}"`, 'stroke-linejoin="round"');
  }
  if (p.opacity != null && p.opacity < 1) a.push(`opacity="${p.opacity}"`);
  return a.join(' ');
}
export function opToSvg(o: Op): string {
  switch (o.t) {
    case 'path':
      return `<path d="${o.d}" ${paintAttrs(o)}/>`;
    case 'rect':
      return `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" ${paintAttrs(o)}/>`;
    case 'circle':
      return `<circle cx="${n(o.cx)}" cy="${n(o.cy)}" r="${n(o.r)}" ${paintAttrs(o)}/>`;
    case 'text':
      return `<text x="${n(o.x)}" y="${n(o.y)}" font-size="${n(o.size)}" font-family="'${FONT_FAMILY}', Arial, sans-serif"${o.bold ? ' font-weight="700"' : ''} fill="${css(o.fill ?? '#000000')}"${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}>${esc(o.text)}</text>`;
  }
}
/** Page as SVG. With `real`, the size is set in millimetres for printing. */
export function pageToSvg(p: Page, real = false, label = ''): string {
  const size = real
    ? `width="${n(p.w / MM)}mm" height="${n(p.h / MM)}mm"`
    : `width="${n(p.w)}" height="${n(p.h)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(p.w)} ${n(p.h)}" ${size} ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}><rect width="100%" height="100%" fill="#ffffff"/>${p.ops.map(opToSvg).join('')}</svg>`;
}

// ---------- PDF ----------
type PdfLib = typeof import('pdf-lib');
let lib: PdfLib | null = null;
const fontBytes: Partial<Record<'regular' | 'bold', ArrayBuffer>> = {};

function pdfColor(L: PdfLib, c: Color): PdfColor {
  const m = c.match(CMYK_RE);
  if (m) {
    const [C, M, Y, K] = m[1].split(',').map(Number);
    return L.cmyk(C, M, Y, K);
  }
  const [r, g, b] = toRgb(c);
  return L.rgb(r, g, b);
}
function drawOp(
  L: PdfLib,
  page: PDFPage,
  H: number,
  o: Op,
  fonts: Record<'regular' | 'bold', PDFFont | null>
): void {
  if (o.t === 'text') {
    const f = (o.bold ? fonts.bold : fonts.regular)!;
    const w = f.widthOfTextAtSize(o.text, o.size);
    const x =
      o.anchor === 'middle' ? o.x - w / 2 : o.anchor === 'end' ? o.x - w : o.x;
    page.drawText(o.text, {
      x,
      y: H - o.y,
      size: o.size,
      font: f,
      color: pdfColor(L, o.fill ?? '#000000'),
    });
    return;
  }
  const paint = {
    color: o.fill ? pdfColor(L, o.fill) : undefined,
    borderColor: o.stroke ? pdfColor(L, o.stroke) : undefined,
    borderWidth: o.stroke ? (o.sw ?? 1) : 0,
    borderDashArray: o.dash,
    borderLineCap:
      o.cap === 'round' ? L.LineCapStyle.Round : L.LineCapStyle.Butt,
    opacity: o.opacity,
    borderOpacity: o.opacity,
  };
  if (o.t === 'rect') {
    page.drawRectangle({
      x: o.x,
      y: H - o.y - o.h,
      width: o.w,
      height: o.h,
      ...paint,
    });
  } else if (o.t === 'circle') {
    page.drawCircle({ x: o.cx, y: H - o.cy, size: o.r, ...paint });
  } else {
    // drawSvgPath reads y downwards from the given origin, like our ops
    page.drawSvgPath(o.d, { x: 0, y: H, ...paint });
  }
}

export async function toPdf(
  pages: Page[],
  meta: { title: string; subject?: string }
): Promise<Blob> {
  lib ??= await import('pdf-lib');
  const L = lib;
  const doc: PDFDocument = await L.PDFDocument.create();
  doc.setTitle(meta.title);
  if (meta.subject) doc.setSubject(meta.subject);
  doc.setCreator('Plyleaf (plyleaf.com)');
  doc.setProducer('Plyleaf');
  const hasText = (bold: boolean) =>
    pages.some((p) => p.ops.some((o) => o.t === 'text' && !!o.bold === bold));
  const fonts: Record<'regular' | 'bold', PDFFont | null> = {
    regular: null,
    bold: null,
  };
  if (hasText(false) || hasText(true)) {
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    doc.registerFontkit(fontkit);
    for (const k of ['regular', 'bold'] as const) {
      if (!hasText(k === 'bold')) continue;
      fontBytes[k] ??= await fetch(FONT_URL[k]).then((r) => r.arrayBuffer());
      fonts[k] = await doc.embedFont(fontBytes[k]!, { subset: true });
    }
  }
  for (const p of pages) {
    const page = doc.addPage([p.w, p.h]);
    for (const o of p.ops) drawOp(L, page, p.h, o, fonts);
  }
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

// ---------- browser print ----------
/** Prints the pages at real size through a print-only copy of the SVGs. */
export async function printPages(pages: Page[]): Promise<void> {
  if (!pages.length) return;
  await loadFonts();
  document.getElementById('print-root')?.remove();
  document.getElementById('print-style')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = pages
    .map((p) => `<div class="print-page">${pageToSvg(p, true)}</div>`)
    .join('');
  // one named @page per sheet size, so portrait and landscape sheets can share a print job
  const sizes = [
    ...new Set(pages.map((p) => `${n(p.w / MM)}mm ${n(p.h / MM)}mm`)),
  ];
  root.querySelectorAll<HTMLElement>('.print-page').forEach((el, i) => {
    const p = pages[i];
    el.dataset.size = String(
      sizes.indexOf(`${n(p.w / MM)}mm ${n(p.h / MM)}mm`)
    );
    el.style.width = `${n(p.w / MM)}mm`;
    el.style.height = `${n(p.h / MM)}mm`;
  });
  const style = document.createElement('style');
  style.id = 'print-style';
  style.textContent = `@page { size: ${sizes[0]}; margin: 0; }
${sizes.map((s, i) => `@page s${i} { size: ${s}; margin: 0; }\n.print-page[data-size="${i}"] { page: s${i}; }`).join('\n')}
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#print-root) { display: none !important; }
  #print-root { display: block !important; }
  .print-page { overflow: hidden; break-after: page; page-break-after: always; }
  .print-page:last-child { break-after: auto; page-break-after: auto; }
  .print-page svg { display: block; }
}
@media screen { #print-root { display: none; } }`;
  document.head.append(style);
  document.body.append(root);
  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // let the browser lay out the SVGs before the dialog opens
  await new Promise((r) => setTimeout(r, 80));
  window.print();
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---------- small geometry helpers ----------
export const line = (x1: number, y1: number, x2: number, y2: number): string =>
  `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`;
/** A circle as path data (four Bézier arcs), for drawing thousands of dots in one path. */
export function circlePath(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  return `M${n(cx - r)} ${n(cy)}C${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)}C${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)}C${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)}C${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)}Z`;
}
/** Clips the segment to a rectangle (Liang–Barsky); null when it lies outside. */
export function clip(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: { x: number; y: number; w: number; h: number }
): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const tests: [number, number][] = [
    [-dx, x1 - r.x],
    [dx, r.x + r.w - x1],
    [-dy, y1 - r.y],
    [dy, r.y + r.h - y1],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/** Seeded random numbers, so the preview and the download show the same cards. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
