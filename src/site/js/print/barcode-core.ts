// Barcode core: checks a value, works out the check digit and turns it into bars or modules.
// No DOM and no drawing. The encoder (bwip-js `raw`) is passed in, so the same code runs in the
// browser and in Node (for a future local server for assistants).

export type Kind = 'upca' | 'ean13' | 'code128' | 'code39' | 'itf14' | 'qr';

export const KINDS: Kind[] = [
  'upca',
  'ean13',
  'code128',
  'code39',
  'itf14',
  'qr',
];

/** What went wrong, as a code plus values; the page turns it into a sentence. */
export interface Problem {
  error:
    | 'empty'
    | 'digits'
    | 'length'
    | 'check'
    | 'chars'
    | 'ascii'
    | 'toolong';
  vars?: Record<string, string | number>;
}

export interface Checked {
  /** what goes to the encoder */
  data: string;
  /** human-readable text under the code */
  text: string;
  /** the check digit was added (not typed) */
  added?: string;
}

/** GTIN check digit (UPC-A, EAN-13, ITF-14): weights 3,1,3,1… from the right. */
export function gtinCheck(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = +body[body.length - 1 - i];
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return String((10 - (sum % 10)) % 10);
}

const GTIN_LEN: Partial<Record<Kind, number>> = {
  upca: 12,
  ean13: 13,
  itf14: 14,
};
const CODE39 = /^[0-9A-Z\-. $/+%]+$/;

export function checkValue(kind: Kind, raw: string): Checked | Problem {
  const v = raw.trim();
  if (!v) return { error: 'empty' };
  const full = GTIN_LEN[kind];
  if (full) {
    const digits = v.replace(/[\s-]/g, '');
    if (!/^\d+$/.test(digits)) return { error: 'digits' };
    if (digits.length === full - 1) {
      const c = gtinCheck(digits);
      return { data: digits + c, text: digits + c, added: c };
    }
    if (digits.length !== full)
      return {
        error: 'length',
        vars: { a: full - 1, b: full, n: digits.length },
      };
    const should = gtinCheck(digits.slice(0, -1));
    if (should !== digits.slice(-1))
      return { error: 'check', vars: { given: digits.slice(-1), should } };
    return { data: digits, text: digits };
  }
  if (kind === 'code39') {
    const up = v.toUpperCase();
    if (!CODE39.test(up)) {
      const bad = [...new Set([...up].filter((c) => !CODE39.test(c)))].join(
        ' '
      );
      return { error: 'chars', vars: { chars: bad } };
    }
    return { data: up, text: up };
  }
  if (kind === 'code128') {
    if (!/^[\x20-\x7e]+$/.test(v)) return { error: 'ascii' };
    if (v.length > 80) return { error: 'toolong', vars: { max: 80 } };
    return { data: v, text: v };
  }
  // QR: any text; the encoder reports when it is too long
  if (new TextEncoder().encode(v).length > 2000)
    return { error: 'toolong', vars: { max: 2000 } };
  return { data: v, text: v };
}

export const isProblem = (r: unknown): r is Problem =>
  typeof r === 'object' && r !== null && !Array.isArray(r) && 'error' in r;

// ---------- symbols ----------

export interface Linear {
  type: 'linear';
  kind: Kind;
  /** bar, space, bar, … widths in modules */
  widths: number[];
  modules: number;
  /** indices of bars drawn longer (guard bars of UPC and EAN) */
  long: Set<number>;
  /** blank space each side, in modules */
  quiet: [number, number];
  text: string;
}
export interface Matrix {
  type: 'matrix';
  kind: Kind;
  size: number;
  dark: boolean[];
  quiet: number;
  text: string;
}
export type Sym = Linear | Matrix;

/** bwip-js `raw` (or anything with the same shape). */
export type RawEncoder = (
  bcid: string,
  text: string,
  opts?: Record<string, unknown>
) => Array<Record<string, unknown>>;

const BCID: Record<Kind, string> = {
  upca: 'upca',
  ean13: 'ean13',
  code128: 'code128',
  code39: 'code39',
  itf14: 'itf14',
  qr: 'qrcode',
};

export function encode(
  raw: RawEncoder,
  kind: Kind,
  c: Checked,
  opts: { code39check?: boolean; qrLevel?: 'L' | 'M' | 'Q' | 'H' } = {}
): Sym {
  const extra: Record<string, unknown> = {};
  if (kind === 'code39' && opts.code39check) extra.includecheck = true;
  if (kind === 'qr') extra.eclevel = opts.qrLevel ?? 'M';
  const r = raw(BCID[kind], c.data, extra)[0];
  if (kind === 'qr') {
    const n = r.pixx as number;
    return {
      type: 'matrix',
      kind,
      size: n,
      dark: (r.pixs as number[]).map((p) => p === 1),
      quiet: 4,
      text: c.text,
    };
  }
  const widths = r.sbs as number[];
  const modules = widths.reduce((s, w) => s + w, 0);
  let long = new Set<number>();
  let quiet: [number, number] = [10, 10];
  if (kind === 'ean13') {
    long = new Set([0, 1, 14, 15, 28, 29]);
    quiet = [11, 7];
  } else if (kind === 'upca') {
    long = new Set([0, 1, 2, 3, 14, 15, 26, 27, 28, 29]);
    quiet = [9, 9];
  }
  let text = c.text;
  if (kind === 'code39' && opts.code39check) {
    // the encoder appended the mod 43 character; show it too
    const SET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
    const sum = [...c.data].reduce((s, ch) => s + SET.indexOf(ch), 0);
    text = c.text + SET[sum % 43];
  }
  return { type: 'linear', kind, widths, modules, long, quiet, text };
}

// ---------- ranges ----------

/**
 * Values counting up from `from`: the last run of digits goes up by one each time and keeps
 * its width (SKU-0099 → SKU-0100). For UPC, EAN and ITF-14 a typed check digit is dropped first,
 * because each new number gets its own.
 */
export function rangeValues(
  kind: Kind,
  from: string,
  count: number
): string[] | Problem {
  let start = from.trim();
  if (kind in GTIN_LEN) start = start.replace(/[\s-]/g, '');
  if (!start) return { error: 'empty' };
  const full = GTIN_LEN[kind];
  if (full) {
    if (!/^\d+$/.test(start)) return { error: 'digits' };
    if (start.length === full) start = start.slice(0, -1);
    if (start.length !== full - 1)
      return {
        error: 'length',
        vars: { a: full - 1, b: full, n: start.length },
      };
  }
  const m = /(\d+)(?!.*\d)/.exec(start);
  if (!m) return { error: 'digits' };
  const head = start.slice(0, m.index);
  const tail = start.slice(m.index + m[1].length);
  const width = m[1].length;
  const out: string[] = [];
  let n = BigInt(m[1]);
  for (let i = 0; i < count; i++, n++) {
    const s = n.toString().padStart(width, '0');
    if (full && s.length > width) break; // ran past the last number of that length
    out.push(head + s + tail);
  }
  return out;
}

// ---------- label sheets ----------

export interface LabelSheet {
  id: string;
  name: string;
  paper: 'a4' | 'letter';
  /** millimetres */
  cols: number;
  rows: number;
  w: number;
  h: number;
  top: number;
  left: number;
  /** distance from one label's left edge to the next, and from one top edge to the next */
  hp: number;
  vp: number;
}

const IN = 25.4;
/** Common self-adhesive sheets. Sizes from the makers' templates; every value can be adjusted. */
export const SHEETS: LabelSheet[] = [
  {
    id: 'l-30',
    name: '30 per sheet, 2⅝ × 1 in (5160, 8160)',
    paper: 'letter',
    cols: 3,
    rows: 10,
    w: 2.625 * IN,
    h: 1 * IN,
    top: 0.5 * IN,
    left: 0.1875 * IN,
    hp: 2.75 * IN,
    vp: 1 * IN,
  },
  {
    id: 'l-80',
    name: '80 per sheet, 1¾ × ½ in (5167)',
    paper: 'letter',
    cols: 4,
    rows: 20,
    w: 1.75 * IN,
    h: 0.5 * IN,
    top: 0.5 * IN,
    left: 0.28125 * IN,
    hp: 2.0625 * IN,
    vp: 0.5 * IN,
  },
  {
    id: 'l-20',
    name: '20 per sheet, 4 × 1 in (5161)',
    paper: 'letter',
    cols: 2,
    rows: 10,
    w: 4 * IN,
    h: 1 * IN,
    top: 0.5 * IN,
    left: 0.15625 * IN,
    hp: 4.1875 * IN,
    vp: 1 * IN,
  },
  {
    id: 'l-14',
    name: '14 per sheet, 4 × 1⅓ in (5162)',
    paper: 'letter',
    cols: 2,
    rows: 7,
    w: 4 * IN,
    h: (4 / 3) * IN,
    top: 0.8333 * IN,
    left: 0.15625 * IN,
    hp: 4.1875 * IN,
    vp: (4 / 3) * IN,
  },
  {
    id: 'l-10',
    name: '10 per sheet, 4 × 2 in (5163)',
    paper: 'letter',
    cols: 2,
    rows: 5,
    w: 4 * IN,
    h: 2 * IN,
    top: 0.5 * IN,
    left: 0.15625 * IN,
    hp: 4.1875 * IN,
    vp: 2 * IN,
  },
  {
    id: 'a-65',
    name: '65 per sheet, 38.1 × 21.2 mm (L7651)',
    paper: 'a4',
    cols: 5,
    rows: 13,
    w: 38.1,
    h: 21.2,
    top: 10.7,
    left: 4.75,
    hp: 40.6,
    vp: 21.2,
  },
  {
    id: 'a-24',
    name: '24 per sheet, 63.5 × 33.9 mm (L7159)',
    paper: 'a4',
    cols: 3,
    rows: 8,
    w: 63.5,
    h: 33.9,
    top: 12.9,
    left: 6.45,
    hp: 66.05,
    vp: 33.9,
  },
  {
    id: 'a-24e',
    name: '24 per sheet, 70 × 37 mm, edge to edge',
    paper: 'a4',
    cols: 3,
    rows: 8,
    w: 70,
    h: 37,
    top: 0.5,
    left: 0,
    hp: 70,
    vp: 37,
  },
  {
    id: 'a-21',
    name: '21 per sheet, 63.5 × 38.1 mm (L7160)',
    paper: 'a4',
    cols: 3,
    rows: 7,
    w: 63.5,
    h: 38.1,
    top: 15.15,
    left: 7.25,
    hp: 66.04,
    vp: 38.1,
  },
  {
    id: 'a-14',
    name: '14 per sheet, 99.1 × 38.1 mm (L7163)',
    paper: 'a4',
    cols: 2,
    rows: 7,
    w: 99.1,
    h: 38.1,
    top: 15.15,
    left: 4.65,
    hp: 101.6,
    vp: 38.1,
  },
  {
    id: 'a-10',
    name: '10 per sheet, 99.1 × 57 mm (L7173)',
    paper: 'a4',
    cols: 2,
    rows: 5,
    w: 99.1,
    h: 57,
    top: 6,
    left: 4.65,
    hp: 101.6,
    vp: 57,
  },
];

/** Label rectangles in millimetres, row by row. */
export function labelSlots(
  s: LabelSheet
): { x: number; y: number; w: number; h: number }[] {
  const out = [];
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++)
      out.push({ x: s.left + c * s.hp, y: s.top + r * s.vp, w: s.w, h: s.h });
  return out;
}
