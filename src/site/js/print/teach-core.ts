// Layout cores for the teacher generators: crossword, word search and flashcards.
// Pure functions, no DOM and no drawing: the tool pages turn the result into sheets,
// and the same code can run in Node (for a future local server for assistants).

export type Rand = () => number;

/** Small seeded generator (mulberry32), so a layout can be rebuilt exactly. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(a: T[], r: Rand): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Letters only, upper case, any alphabet ("ice-cream" → "ICECREAM"). */
export const lettersOf = (s: string): string =>
  [...s.normalize('NFC').toLocaleUpperCase()]
    .filter((c) => /\p{L}/u.test(c))
    .join('');

/** "3, 5" for a two-word answer, '' for one word. */
export function enumeration(s: string): string {
  const parts = s
    .trim()
    .split(/[\s-]+/)
    .map(lettersOf)
    .filter(Boolean);
  return parts.length > 1 ? parts.map((p) => [...p].length).join(', ') : '';
}

// ---------- pairs: "term - definition" ----------

export interface Pair {
  a: string;
  b: string;
}

/**
 * One pair per line. A tab (pasted from a spreadsheet) wins; otherwise the first
 * " - ", " – ", ":", "=", "|" or ";" splits the line. Lines with no separator
 * keep an empty second half.
 */
export function parsePairs(text: string): Pair[] {
  const out: Pair[] = [];
  const lines = text.split(/\r?\n/);
  const tabbed = lines.some((l) => l.includes('\t'));
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let a = line;
    let b = '';
    if (tabbed && raw.includes('\t')) {
      const cells = raw.split('\t').map((c) => c.trim());
      a = cells[0];
      b = cells.slice(1).filter(Boolean).join(' ');
    } else {
      const m = /\s[-–—]\s|:|=|\||;/.exec(line);
      if (m) {
        a = line.slice(0, m.index).trim();
        b = line.slice(m.index + m[0].length).trim();
      }
    }
    // strip quotes a spreadsheet adds around cells
    const unq = (s: string) => s.replace(/^"(.*)"$/s, '$1').replace(/""/g, '"');
    a = unq(a);
    b = unq(b);
    if (a || b) out.push({ a, b });
  }
  return out;
}

// ---------- crossword ----------

export interface CrossEntry {
  answer: string; // letters only
  shown: string; // as typed
  clue: string;
  x: number;
  y: number;
  across: boolean;
  num: number;
}
export interface Crossword {
  w: number;
  h: number;
  /** row-major, '' = black/empty */
  cells: string[];
  /** clue number at each cell, 0 = none */
  nums: number[];
  entries: CrossEntry[];
  /** words that found no place in the grid */
  left: { shown: string; clue: string }[];
}

interface Cell {
  ch: string;
  h: boolean;
  v: boolean;
}

/** Builds a connected grid where words cross; tries many orders and keeps the best. */
export function buildCrossword(
  items: { word: string; clue: string }[],
  seed: number,
  tries = 60
): Crossword {
  const words = items
    .map((it) => ({
      answer: lettersOf(it.word),
      shown: it.word.trim(),
      clue: it.clue.trim(),
    }))
    .filter((w) => [...w.answer].length >= 2);
  const r = seeded(seed);
  let best: { placed: Placed[]; left: typeof words; score: number } | null =
    null;
  for (let t = 0; t < tries; t++) {
    // longest first with a little shuffle, so each try differs
    const order = shuffle(words.slice(), r).sort(
      (a, b) => [...b.answer].length - [...a.answer].length + (r() - 0.5) * 3
    );
    const res = attempt(order, r);
    const box = bounds(res.placed);
    const area = (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1);
    const ratio =
      Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1) /
      Math.max(1, Math.min(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1));
    const score =
      res.placed.length * 1000 + res.crossings * 25 - area * 0.6 - ratio * 30;
    if (!best || score > best.score)
      best = { placed: res.placed, left: res.left, score };
  }
  return finish(best ? best.placed : [], best ? best.left : words);
}

interface Placed {
  answer: string;
  shown: string;
  clue: string;
  x: number;
  y: number;
  across: boolean;
}

function attempt(
  order: { answer: string; shown: string; clue: string }[],
  r: Rand
) {
  const grid = new Map<string, Cell>();
  const key = (x: number, y: number) => x + ',' + y;
  const at = (x: number, y: number) => grid.get(key(x, y));
  const placed: Placed[] = [];
  let crossings = 0;

  const fits = (
    letters: string[],
    x: number,
    y: number,
    across: boolean
  ): number => {
    const dx = across ? 1 : 0;
    const dy = across ? 0 : 1;
    const n = letters.length;
    if (at(x - dx, y - dy) || at(x + dx * n, y + dy * n)) return -1;
    let cross = 0;
    for (let i = 0; i < n; i++) {
      const cx = x + dx * i;
      const cy = y + dy * i;
      const c = at(cx, cy);
      if (c) {
        if (c.ch !== letters[i] || (across ? c.h : c.v)) return -1;
        cross++;
      } else if (at(cx + dy, cy + dx) || at(cx - dy, cy - dx)) return -1;
    }
    return cross;
  };
  const put = (
    w: (typeof order)[0],
    letters: string[],
    x: number,
    y: number,
    across: boolean
  ) => {
    letters.forEach((ch, i) => {
      const cx = x + (across ? i : 0);
      const cy = y + (across ? 0 : i);
      const c = at(cx, cy) ?? { ch, h: false, v: false };
      if (across) c.h = true;
      else c.v = true;
      grid.set(key(cx, cy), c);
    });
    placed.push({ ...w, x, y, across });
  };

  let queue = order.slice();
  const left: typeof order = [];
  for (let pass = 0; pass < 3 && queue.length; pass++) {
    const next: typeof order = [];
    for (const w of queue) {
      const letters = [...w.answer];
      if (!placed.length) {
        put(w, letters, 0, 0, true);
        continue;
      }
      const box = bounds(placed);
      let bestMove: {
        x: number;
        y: number;
        across: boolean;
        s: number;
      } | null = null;
      for (const p of placed) {
        const pl = [...p.answer];
        for (let i = 0; i < pl.length; i++)
          for (let j = 0; j < letters.length; j++) {
            if (pl[i] !== letters[j]) continue;
            const across = !p.across;
            const cx = p.x + (p.across ? i : 0);
            const cy = p.y + (p.across ? 0 : i);
            const x = across ? cx - j : cx;
            const y = across ? cy : cy - j;
            const cross = fits(letters, x, y, across);
            if (cross < 1) continue;
            const nx0 = Math.min(box.x0, x);
            const ny0 = Math.min(box.y0, y);
            const nx1 = Math.max(box.x1, x + (across ? letters.length - 1 : 0));
            const ny1 = Math.max(box.y1, y + (across ? 0 : letters.length - 1));
            const w2 = nx1 - nx0 + 1;
            const h2 = ny1 - ny0 + 1;
            // more crossings, a smaller and squarer grid, plus a bit of chance
            const s =
              cross * 12 - w2 * h2 * 0.05 - Math.abs(w2 - h2) * 0.8 + r() * 2;
            if (!bestMove || s > bestMove.s) bestMove = { x, y, across, s };
          }
      }
      if (bestMove) {
        crossings += fits(letters, bestMove.x, bestMove.y, bestMove.across);
        put(w, letters, bestMove.x, bestMove.y, bestMove.across);
      } else next.push(w);
    }
    if (next.length === queue.length) {
      left.push(...next);
      queue = [];
    } else queue = next;
  }
  left.push(...queue);
  return { placed, left, crossings };
}

function bounds(placed: Placed[]) {
  let x0 = 0,
    y0 = 0,
    x1 = 0,
    y1 = 0;
  placed.forEach((p, i) => {
    const n = [...p.answer].length;
    const ex = p.x + (p.across ? n - 1 : 0);
    const ey = p.y + (p.across ? 0 : n - 1);
    if (i === 0 || p.x < x0) x0 = p.x;
    if (i === 0 || p.y < y0) y0 = p.y;
    if (i === 0 || ex > x1) x1 = ex;
    if (i === 0 || ey > y1) y1 = ey;
  });
  return { x0, y0, x1, y1 };
}

function finish(
  placed: Placed[],
  left: { shown: string; clue: string }[]
): Crossword {
  if (!placed.length)
    return {
      w: 0,
      h: 0,
      cells: [],
      nums: [],
      entries: [],
      left: left.map((l) => ({ shown: l.shown, clue: l.clue })),
    };
  const b = bounds(placed);
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  const cells = new Array<string>(w * h).fill('');
  const nums = new Array<number>(w * h).fill(0);
  const ps = placed.map((p) => ({ ...p, x: p.x - b.x0, y: p.y - b.y0 }));
  for (const p of ps)
    [...p.answer].forEach((ch, i) => {
      cells[(p.y + (p.across ? 0 : i)) * w + p.x + (p.across ? i : 0)] = ch;
    });
  // number the starts in reading order
  const starts = [...new Set(ps.map((p) => p.y * w + p.x))].sort(
    (a, c) => a - c
  );
  starts.forEach((s, i) => (nums[s] = i + 1));
  const entries: CrossEntry[] = ps
    .map((p) => ({ ...p, num: nums[p.y * w + p.x] }))
    .sort((a, c) => a.num - c.num);
  return {
    w,
    h,
    cells,
    nums,
    entries,
    left: left.map((l) => ({ shown: l.shown, clue: l.clue })),
  };
}

// ---------- word search ----------

export type Level = 'easy' | 'medium' | 'hard';
/** [dx, dy]: easy reads right and down; medium adds diagonals; hard adds every backward line. */
export const DIRS: Record<Level, [number, number][]> = {
  easy: [
    [1, 0],
    [0, 1],
  ],
  medium: [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ],
  hard: [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
    [-1, 0],
    [0, -1],
    [-1, -1],
    [-1, 1],
  ],
};

export interface Found {
  word: string; // as typed
  x: number;
  y: number;
  dx: number;
  dy: number;
  len: number;
}
export interface WordSearch {
  size: number;
  grid: string[]; // row-major letters
  found: Found[];
  /** words that did not fit */
  left: string[];
}

export function buildWordSearch(
  words: string[],
  size: number,
  level: Level,
  seed: number,
  tries = 200
): WordSearch {
  const r = seeded(seed);
  const list = words
    .map((w) => ({ shown: w.trim(), letters: [...lettersOf(w)] }))
    .filter((w) => w.letters.length >= 2 && w.letters.length <= size)
    .sort((a, b) => b.letters.length - a.letters.length);
  const tooLong = words
    .filter((w) => [...lettersOf(w)].length > size)
    .map((w) => w.trim());
  const dirs = DIRS[level];
  let best: { cells: string[]; found: Found[]; left: string[] } | null = null;
  for (let t = 0; t < tries; t++) {
    const cells = new Array<string>(size * size).fill('');
    const found: Found[] = [];
    const left: string[] = [];
    for (const w of list) {
      const n = w.letters.length;
      const options: {
        x: number;
        y: number;
        dx: number;
        dy: number;
        overlap: number;
      }[] = [];
      // a sample of random starts and directions; overlaps on shared letters are welcome
      for (let k = 0; k < 120; k++) {
        const [dx, dy] = dirs[Math.floor(r() * dirs.length)];
        const x = Math.floor(r() * size);
        const y = Math.floor(r() * size);
        const ex = x + dx * (n - 1);
        const ey = y + dy * (n - 1);
        if (ex < 0 || ey < 0 || ex >= size || ey >= size) continue;
        let overlap = 0;
        let ok = true;
        for (let i = 0; i < n; i++) {
          const c = cells[(y + dy * i) * size + x + dx * i];
          if (c && c !== w.letters[i]) {
            ok = false;
            break;
          }
          if (c) overlap++;
        }
        if (ok && overlap < n) options.push({ x, y, dx, dy, overlap });
      }
      if (!options.length) {
        left.push(w.shown);
        continue;
      }
      options.sort((a, b) => b.overlap - a.overlap);
      const pick =
        r() < 0.5 ? options[0] : options[Math.floor(r() * options.length)];
      for (let i = 0; i < n; i++)
        cells[(pick.y + pick.dy * i) * size + pick.x + pick.dx * i] =
          w.letters[i];
      found.push({
        word: w.shown,
        x: pick.x,
        y: pick.y,
        dx: pick.dx,
        dy: pick.dy,
        len: n,
      });
    }
    // a word placed backward is wanted at the hard level: keep tries that use some
    const back = found.filter(
      (f) => f.dx < 0 || (f.dx === 0 && f.dy < 0)
    ).length;
    if (
      !best ||
      left.length < best.left.length ||
      (left.length === best.left.length &&
        level === 'hard' &&
        back > 0 &&
        best.found.filter((f) => f.dx < 0 || (f.dx === 0 && f.dy < 0))
          .length === 0)
    )
      best = { cells, found, left };
    if (
      best.left.length === 0 &&
      (level !== 'hard' || back > 0 || found.length < 2)
    )
      break;
  }
  // fill the gaps with letters from the words themselves, so the alphabet matches
  const pool = list.flatMap((w) => w.letters);
  const cells = best!.cells.map(
    (c) => c || (pool.length ? pool[Math.floor(r() * pool.length)] : 'A')
  );
  return {
    size,
    grid: cells,
    found: best!.found,
    left: [...tooLong, ...best!.left],
  };
}

/** A grid that fits the longest word and leaves room for the rest. */
export function autoSize(words: string[]): number {
  const lens = words.map((w) => [...lettersOf(w)].length).filter((n) => n > 1);
  if (!lens.length) return 10;
  const longest = Math.max(...lens);
  const letters = lens.reduce((s, n) => s + n, 0);
  return Math.min(
    25,
    Math.max(8, longest, Math.ceil(Math.sqrt(letters * 2.2)))
  );
}

// ---------- flashcards ----------

export interface CardSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Columns and rows for 4, 6 or 8 cards on a portrait sheet. */
export const CARD_GRID: Record<number, [number, number]> = {
  4: [2, 2],
  6: [2, 3],
  8: [2, 4],
};

/**
 * Card slots on a sheet with equal margins on both sides, so a two-sided print lines up.
 * Fronts read left to right; on the back each card sits behind its front:
 * flip on the long edge mirrors the columns, flip on the short edge mirrors the rows.
 */
export function cardSlots(
  W: number,
  H: number,
  per: number,
  margin: number,
  side: 'front' | 'back',
  flip: 'long' | 'short'
): CardSlot[] {
  const [cols, rows] = CARD_GRID[per] ?? CARD_GRID[8];
  const w = (W - 2 * margin) / cols;
  const h = (H - 2 * margin) / rows;
  const out: CardSlot[] = [];
  for (let i = 0; i < cols * rows; i++) {
    let c = i % cols;
    let r = Math.floor(i / cols);
    if (side === 'back') {
      if (flip === 'long') c = cols - 1 - c;
      else r = rows - 1 - r;
    }
    out.push({ x: margin + c * w, y: margin + r * h, w, h });
  }
  return out;
}
