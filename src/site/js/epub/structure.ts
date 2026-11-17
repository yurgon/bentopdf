// Stage 2 of PDF to EPUB: turn positioned lines into a book. Removes running heads and page
// numbers, joins lines into paragraphs, undoes end-of-line hyphenation, finds chapters (from
// bookmarks or font sizes), moves footnotes to the chapter end and places pictures in the flow.
import type {
  Block,
  Book,
  Chapter,
  Extracted,
  Line,
  Note,
  OutlineItem,
  Picture,
  Seg,
  StructureOptions,
} from './model';

export const lineText = (l: { segs: Seg[] }) => l.segs.map((s) => s.t).join('');
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[­]/g, '')
    .replace(/\d+/g, '#')
    .replace(/[^\p{L}#]+/gu, ' ')
    .trim();
const loose = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();

function mode(values: number[], step: number): number {
  const m = new Map<number, number>();
  for (const v of values) {
    const k = Math.round(v / step) * step;
    m.set(k, (m.get(k) || 0) + 1);
  }
  let best = 0,
    bestN = -1;
  for (const [k, n] of m) if (n > bestN) [best, bestN] = [k, n];
  return best;
}
function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const PAGE_NO =
  /^[\s\-\u2013\u2014.·|[\]()]*(\d{1,4}|[ivxlcdm]{1,8})[\s\-\u2013\u2014.·|[\]()]*$/i;
const PAGE_WORD =
  /^(page|p\.|стр\.?|страница|seite|página|pagina|strona|stránka|sayfa)\s*\d{1,4}(\s*(of|из|von|de|di|z|ze|\/)\s*\d{1,4})?$/i;
const NOTE_START = /^\s*(\d{1,3}|[*†‡§¶]{1,3})[\s.)\]]+(?=\S)/;

interface Ctx {
  body: number;
  lead: number;
  left: Map<number, number>;
  right: Map<number, number>;
  justified: Map<number, boolean>;
}

/** The text size most of the book is set in, weighted by characters. */
function bodySize(lines: Line[]): number {
  const m = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    m.set(k, (m.get(k) || 0) + lineText(l).length);
  }
  let best = 10,
    bestN = -1;
  for (const [k, n] of m) if (n > bestN) [best, bestN] = [k, n];
  return best;
}

// ---------- running heads, page numbers ----------

function removeHeadersFooters(
  ex: Extracted,
  lines: Line[],
  body: number
): { kept: Line[]; removed: number } {
  const byPage = groupByPage(lines);
  // running heads usually repeat the book or chapter title
  const titles = new Set(
    [ex.title, ...ex.outline.map((o) => o.title)]
      .map(norm)
      .filter((t) => t.length > 3)
  );
  type Cand = { line: Line; key: string; lone: boolean };
  const cands: Cand[] = [];
  const counts = new Map<string, Set<number>>();
  for (const [p, ls] of byPage) {
    const h = ex.pages[p]?.h ?? 800;
    const sorted = [...ls].sort((a, b) => a.top - b.top);
    sorted.forEach((l, i) => {
      const top = i < 2 && l.top < h * 0.16;
      const bottom = i >= sorted.length - 2 && l.base > h * 0.84;
      if (!top && !bottom) return;
      const key = (top ? 'T' : 'B') + norm(lineText(l));
      // a small line alone at the very top or bottom, far from the text
      const next = top ? sorted[i + 1] : sorted[i - 1];
      const far = !next || Math.abs(next.base - l.base) > body * 2.2;
      const text = lineText(l).trim();
      const lone =
        far &&
        l.size < body * 0.92 &&
        (top
          ? i === 0 && text.length < 80
          : i === sorted.length - 1 &&
            text.length < 40 &&
            !NOTE_START.test(text));
      cands.push({ line: l, key, lone });
      if (!counts.has(key)) counts.set(key, new Set());
      counts.get(key)!.add(p);
    });
  }
  const drop = new Set<Line>();
  for (const { line, key, lone } of cands) {
    const t = lineText(line).trim();
    if (PAGE_NO.test(t) || PAGE_WORD.test(t)) {
      if (line.size < body * 1.6) drop.add(line);
      continue;
    }
    const n = counts.get(key)!.size;
    if (key.length < 3) continue;
    const plain = !(line.bold && line.size >= body * 0.98);
    if (lone || (titles.has(key.slice(1)) && line.size < body * 0.96 && plain))
      drop.add(line);
    else if (n >= 3 && line.size < body * 1.3 && plain) drop.add(line);
    else if (n === 2 && line.size < body * 0.96 && plain) drop.add(line);
  }
  return { kept: lines.filter((l) => !drop.has(l)), removed: drop.size };
}

function groupByPage(lines: Line[]): Map<number, Line[]> {
  const m = new Map<number, Line[]>();
  for (const l of lines) {
    if (!m.has(l.page)) m.set(l.page, []);
    m.get(l.page)!.push(l);
  }
  return m;
}

// ---------- footnotes ----------

let noteSeq = 0;
function takeFootnotes(
  ex: Extracted,
  lines: Line[],
  body: number
): { kept: Line[]; notes: Note[] } {
  const notes: Note[] = [];
  const drop = new Set<Line>();
  for (const [p, ls] of groupByPage(lines)) {
    const h = ex.pages[p]?.h ?? 800;
    const sorted = [...ls].sort((a, b) => a.top - b.top);
    const run: Line[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const l = sorted[i];
      if (l.size < body * 0.9 && l.size > body * 0.45) run.unshift(l);
      else break;
    }
    if (!run.length || run[0].top < h * 0.45) continue;
    // the run must sit below the body text, not be all of the page
    if (run.length === sorted.length) continue;
    const first = run[0];
    if (!NOTE_START.test(lineText(first)) && !first.segs[0]?.sup) continue;
    const pageNotes: Note[] = [];
    for (const l of run) {
      const t = lineText(l);
      const m = t.match(NOTE_START);
      const supLead = l.segs[0]?.sup && l.segs[0].t.trim();
      if (m || supLead) {
        const marker = (m ? m[1] : l.segs[0].t).trim();
        let segs = l.segs.map((s) => ({ ...s }));
        if (supLead) segs = segs.slice(1);
        else segs[0] = { ...segs[0], t: segs[0].t.replace(NOTE_START, '') };
        segs = segs.map((s) => {
          const { sup: _sup, ...rest } = s;
          void _sup;
          return rest;
        });
        pageNotes.push({ page: p, marker, segs, id: `fn${++noteSeq}` });
      } else if (pageNotes.length) {
        appendLine(pageNotes[pageNotes.length - 1].segs, l.segs);
      } else continue;
      drop.add(l);
    }
    notes.push(...pageNotes);
  }
  return { kept: lines.filter((l) => !drop.has(l)), notes };
}

/** Point raised markers in the text at the notes of the same page. */
function linkMarkers(
  lines: Line[],
  notes: Note[],
  ocrPages: Set<number>
): void {
  const byPage = new Map<number, Note[]>();
  for (const n of notes) {
    if (!byPage.has(n.page)) byPage.set(n.page, []);
    byPage.get(n.page)!.push(n);
  }
  const linked = new Set<string>();
  for (const l of lines) {
    const pn = byPage.get(l.page);
    if (!pn) continue;
    for (const s of l.segs) {
      if (!s.sup) continue;
      const n = pn.find((n) => n.marker === s.t.trim() && !linked.has(n.id));
      if (n) {
        s.note = n.id;
        linked.add(n.id);
      }
    }
  }
  // OCR often loses the raise: "harbour1 and" → a marker glued to a word
  for (const [p, pn] of byPage) {
    for (const n of pn) {
      if (linked.has(n.id) || !/^\d{1,3}$/.test(n.marker)) continue;
      const re = new RegExp(
        `(?<=[\\p{L}.,;:!?»”"')])${n.marker}(?=[\\s.,;:]|$)`,
        'u'
      );
      outer: for (const l of lines) {
        if (l.page !== p) continue;
        for (let k = 0; k < l.segs.length; k++) {
          const s = l.segs[k];
          if (s.sup || s.note) continue;
          const m = re.exec(s.t);
          if (!m) continue;
          const before = { ...s, t: s.t.slice(0, m.index) };
          const mark: Seg = { t: n.marker, sup: true, note: n.id };
          const after = { ...s, t: s.t.slice(m.index + n.marker.length) };
          l.segs.splice(k, 1, before, mark, after);
          linked.add(n.id);
          break outer;
        }
      }
    }
  }
  // On scans a tiny raised digit is often read as * ’ " or ° right after the sentence end.
  // Take such marks in reading order for the notes of that page that are still unlinked.
  const JUNK = /(?<=\p{L}[.!?,;:]?)([*’'"°^¹²³⁴⁵⁶⁷⁸⁹⁰]{1,2})(?=\s|$)/u;
  for (const [p, pn] of byPage) {
    if (!ocrPages.has(p)) continue;
    const open = pn.filter((n) => !linked.has(n.id));
    if (!open.length) continue;
    for (const l of lines) {
      if (l.page !== p || !open.length) continue;
      for (let k = 0; k < l.segs.length && open.length; k++) {
        const s = l.segs[k];
        if (s.sup || s.note) continue;
        const m = JUNK.exec(s.t);
        if (!m) continue;
        const n = open.shift()!;
        const before = { ...s, t: s.t.slice(0, m.index) };
        const mark: Seg = { t: n.marker, sup: true, note: n.id };
        const after = { ...s, t: s.t.slice(m.index + m[1].length) };
        l.segs.splice(k, 1, before, mark, after);
        linked.add(n.id);
      }
    }
  }
}

// ---------- paragraphs ----------

function pageEdges(
  lines: Line[],
  body: number
): Pick<Ctx, 'left' | 'right' | 'justified'> {
  const left = new Map<number, number>();
  const right = new Map<number, number>();
  const justified = new Map<number, boolean>();
  const bodyLines = lines.filter((l) => Math.abs(l.size - body) < body * 0.12);
  const allLeft = mode(
    bodyLines.map((l) => l.x0),
    2
  );
  for (const [p, ls] of groupByPage(bodyLines)) {
    if (ls.length < 3) continue;
    const l0 = mode(
      ls.map((l) => l.x0),
      2
    );
    // the mode can land on indented lines if most are short; take the leftmost common edge
    const minX = quantile(
      ls.map((l) => l.x0),
      0.1
    );
    left.set(p, Math.abs(l0 - minX) < body * 0.6 ? l0 : minX);
    const r = quantile(
      ls.map((l) => l.x1),
      0.85
    );
    right.set(p, r);
    const flush = ls.filter((l) => Math.abs(l.x1 - r) < 1.5).length;
    justified.set(p, flush > ls.length * 0.45);
  }
  left.set(-1, allLeft);
  return { left, right, justified };
}

/** Does `cur` continue the paragraph that `prev` ends? */
function continues(
  prev: Line,
  cur: Line,
  ctx: Ctx,
  firstOnPage: boolean
): boolean {
  const { body, lead } = ctx;
  if (Math.abs(cur.size - prev.size) > body * 0.15) return false;
  if (cur.bold !== prev.bold && cur.bold && lineText(cur).length < 80)
    return false;
  const left = ctx.left.get(cur.page) ?? ctx.left.get(-1) ?? cur.x0;
  const indent = cur.x0 - left;
  if (indent > body * 0.7 && indent < body * 8) return false;
  if (cur.paraHint && !firstOnPage) {
    // OCR paragraph starts are only trusted when the layout agrees a little
    if (indent > body * 0.4 || cur.base - prev.base > lead * 1.3) return false;
  }
  if (!firstOnPage && prev.page === cur.page) {
    const gap = cur.base - prev.base;
    if (lead > 0 && gap > lead * 1.45) return false;
  }
  const right = ctx.right.get(prev.page);
  const prevText = lineText(prev).trimEnd();
  if (right) {
    const width = right - (ctx.left.get(prev.page) ?? prev.x0);
    const short = right - prev.x1;
    const ends = /[.!?…:;"»”’)\]]$/.test(prevText);
    if (ctx.justified.get(prev.page)) {
      if (short > body * 2 && ends) return false;
      if (short > width * 0.45) return false;
    } else if (short > width * 0.4 && ends) return false;
  }
  return true;
}

/** Append a line to a paragraph, undoing end-of-line hyphenation. */
function appendLine(into: Seg[], add: Seg[]): void {
  if (!add.length) return;
  const segs = add.map((s) => ({ ...s }));
  const last = into[into.length - 1];
  if (!last) {
    into.push(...segs);
    return;
  }
  last.t = last.t.replace(/\s+$/, '');
  segs[0].t = segs[0].t.replace(/^\s+/, '');
  const nextStart = segs[0].t;
  if (/­$/.test(last.t)) last.t = last.t.slice(0, -1);
  else if (/\p{L}[-‐]$/u.test(last.t)) {
    if (/^\p{Ll}/u.test(nextStart)) last.t = last.t.slice(0, -1);
    // "Jean-" + "Paul": keep the hyphen, no space
  } else if (!segs[0].sup) last.t += ' ';
  for (const s of segs) {
    const prev = into[into.length - 1];
    if (
      Boolean(prev.bold) === Boolean(s.bold) &&
      Boolean(prev.italic) === Boolean(s.italic) &&
      !prev.sup &&
      !s.sup
    )
      prev.t += s.t;
    else into.push(s);
  }
}

// ---------- headings ----------

interface Role {
  level: number;
  chapter: boolean;
  title: string;
  skip?: boolean;
}

function headingCandidates(
  lines: Line[],
  ctx: Ctx
): Map<number, { size: number; bold: boolean }> {
  const out = new Map<number, { size: number; bold: boolean }>();
  const { body, lead } = ctx;
  lines.forEach((l, i) => {
    const t = lineText(l).trim();
    if (!/\p{L}/u.test(t) || t.length > 150) return;
    const big = l.size >= body * 1.18;
    const prev = lines[i - 1];
    const isolated =
      !prev ||
      prev.page !== l.page ||
      l.base - prev.base > (lead || body * 1.3) * 1.3;
    const next = lines[i + 1];
    const nextBody = !next || !next.bold || next.size !== l.size;
    const boldLine =
      l.bold &&
      l.size >= body * 0.95 &&
      isolated &&
      nextBody &&
      t.length < 90 &&
      !/[,;]$/.test(t);
    if (big || boldLine)
      out.set(i, { size: Math.round(l.size * 2) / 2, bold: l.bold });
  });
  return out;
}

/** Join consecutive heading lines of the same style into one heading. */
function mergeHeadingLines(
  lines: Line[],
  cands: Map<number, { size: number; bold: boolean }>
): {
  first: number;
  last: number;
  size: number;
  bold: boolean;
  text: string;
}[] {
  const out: {
    first: number;
    last: number;
    size: number;
    bold: boolean;
    text: string;
  }[] = [];
  const idx = [...cands.keys()].sort((a, b) => a - b);
  for (const i of idx) {
    const c = cands.get(i)!;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.last === i - 1 &&
      Math.abs(prev.size - c.size) <= c.size * 0.07 &&
      prev.bold === c.bold &&
      lines[i].page === lines[prev.last].page &&
      lines[i].base - lines[prev.last].base < c.size * 2.2 &&
      i - prev.first < 4
    ) {
      prev.last = i;
      prev.text += ' ' + lineText(lines[i]).trim();
    } else
      out.push({ first: i, last: i, ...c, text: lineText(lines[i]).trim() });
  }
  return out;
}

function fontRoles(
  lines: Line[],
  ctx: Ctx,
  pages: number
): Map<number, Role> | null {
  const heads = mergeHeadingLines(lines, headingCandidates(lines, ctx));
  if (!heads.length) return null;
  // heading styles: sizes that step by less than 7% count as one style (OCR sizes wobble)
  const styleKey = (h: { size: number; bold: boolean }) =>
    `${h.size}|${h.bold ? 1 : 0}`;
  const styleOf = new Map<string, number>();
  const clusters: { size: number; bold: boolean; keys: string[] }[] = [];
  for (const bold of [true, false]) {
    const sizes = [
      ...new Set(heads.filter((h) => h.bold === bold).map((h) => h.size)),
    ].sort((x, y) => y - x);
    let cur: { size: number; bold: boolean; keys: string[] } | null = null;
    let prev = 0;
    for (const size of sizes) {
      if (!cur || prev - size > prev * 0.07) {
        cur = { size, bold, keys: [] };
        clusters.push(cur);
      }
      cur.keys.push(styleKey({ size, bold }));
      prev = size;
    }
  }
  clusters.sort((x, y) => y.size - x.size || Number(y.bold) - Number(x.bold));
  clusters.forEach((c, i) => c.keys.forEach((k) => styleOf.set(k, i)));
  const styles = clusters;
  const levelOf = (h: { size: number; bold: boolean }) =>
    styleOf.get(styleKey(h)) ?? 0;
  const count = new Map<number, number>();
  for (const h of heads)
    count.set(levelOf(h), (count.get(levelOf(h)) || 0) + 1);
  let chapterLevel = -1;
  for (let k = 0; k < styles.length; k++) {
    if ((count.get(k) || 0) >= 2) {
      chapterLevel = k;
      break;
    }
  }
  if (chapterLevel < 0) chapterLevel = 0;
  const chapterSize = styles[chapterLevel].size;
  // bold body-size lead-ins on most pages are emphasis, not chapters
  if (
    chapterSize < ctx.body * 1.18 &&
    (count.get(chapterLevel) || 0) > pages * 0.8
  )
    return null;
  // section levels: rank only the styles used inside chapters (a title page has its own)
  const firstChapter =
    heads.find((h) => levelOf(h) === chapterLevel)?.first ?? 0;
  const inner = [
    ...new Set(
      heads
        .filter((h) => h.first > firstChapter && levelOf(h) > chapterLevel)
        .map(levelOf)
    ),
  ].sort((a, b) => a - b);
  const roles = new Map<number, Role>();
  for (const h of heads) {
    const lv = levelOf(h);
    const rank = inner.indexOf(lv);
    const level =
      lv <= chapterLevel
        ? 1
        : Math.min(3, (rank >= 0 ? rank : lv - chapterLevel - 1) + 2);
    roles.set(h.first, { level, chapter: lv === chapterLevel, title: h.text });
    for (let k = h.first + 1; k <= h.last; k++)
      roles.set(k, { level, chapter: false, title: '', skip: true });
  }
  return roles;
}

interface Mark {
  before: number;
  title: string;
  level: number;
  chapter: boolean;
}

function outlineRoles(
  lines: Line[],
  outline: OutlineItem[],
  ctx: Ctx
): { roles: Map<number, Role>; marks: Mark[] } | null {
  if (outline.length < 2) return null;
  const d0 = outline.filter((o) => o.depth === 0).length;
  const d1 = outline.filter((o) => o.depth === 1).length;
  const base = d0 === 1 && d1 >= 2 ? 1 : 0;
  const items = outline.filter((o) => o.depth >= base && o.depth <= base + 2);
  if (items.filter((o) => o.depth === base).length < 1) return null;
  const roles = new Map<number, Role>();
  const marks: Mark[] = [];
  const firstOfPage = new Map<number, number>();
  lines.forEach((l, i) => {
    if (!firstOfPage.has(l.page)) firstOfPage.set(l.page, i);
  });
  const used = new Set<number>();
  for (const o of items) {
    const level = o.depth - base + 1;
    const chapter = o.depth === base;
    const want = loose(o.title);
    let found = -1,
      span = 0;
    for (const pg of [o.page, o.page + 1]) {
      const start = firstOfPage.get(pg);
      if (start === undefined) continue;
      for (let i = start; i < lines.length && lines[i].page === pg; i++) {
        if (used.has(i)) continue;
        if (o.top !== null && pg === o.page && lines[i].base < o.top - 4)
          continue;
        let acc = '';
        for (
          let k = 0;
          k < 4 && i + k < lines.length && lines[i + k].page === pg;
          k++
        ) {
          acc += loose(lineText(lines[i + k]));
          if (!acc) break;
          if (
            acc === want ||
            (want.length >= 6 &&
              acc.length >= 6 &&
              (want.startsWith(acc)
                ? k === 3 || acc.length === want.length
                : acc.startsWith(want)))
          ) {
            found = i;
            span = k + 1;
            break;
          }
          if (!want.startsWith(acc)) break;
        }
        if (found >= 0) break;
        // headings sit near the top of the page; stop after a dozen lines
        if (i - start > 12) break;
      }
      if (found >= 0) break;
    }
    if (found >= 0) {
      roles.set(found, { level, chapter, title: o.title });
      used.add(found);
      for (let k = 1; k < span; k++) {
        roles.set(found + k, { level, chapter: false, title: '', skip: true });
        used.add(found + k);
      }
    } else {
      // no matching line: start the chapter at the bookmark's place
      let at = -1;
      for (let pg = o.page; pg < o.page + 3 && at < 0; pg++) {
        const start = firstOfPage.get(pg);
        if (start === undefined) continue;
        at = start;
        if (o.top !== null && pg === o.page) {
          let i = start;
          while (
            i < lines.length &&
            lines[i].page === pg &&
            lines[i].base < o.top - 2
          )
            i++;
          if (i < lines.length) at = i;
        }
      }
      marks.push({
        before: at < 0 ? lines.length : at,
        title: o.title,
        level,
        chapter,
      });
    }
  }
  // font headings inside chapters become section headings
  const heads = mergeHeadingLines(lines, headingCandidates(lines, ctx));
  for (const h of heads) {
    if (roles.has(h.first) || used.has(h.first)) continue;
    const level = h.size >= ctx.body * 1.18 ? 2 : 3;
    roles.set(h.first, { level, chapter: false, title: h.text });
    for (let k = h.first + 1; k <= h.last; k++)
      roles.set(k, { level, chapter: false, title: '', skip: true });
  }
  return { roles, marks };
}

// ---------- main ----------

export function structure(ex: Extracted, opt: StructureOptions): Book {
  noteSeq = 0;
  // deep copy segs: linking markers edits them
  let lines: Line[] = ex.lines.map((l) => ({
    ...l,
    segs: l.segs.map((s) => ({ ...s })),
  }));
  const body = bodySize(lines);

  // lines inside a picture are its labels; they come with the picture
  const pics = ex.pictures;
  lines = lines.filter((l) => {
    const cy = (l.top + l.base) / 2;
    const cx = (l.x0 + l.x1) / 2;
    return !pics.some(
      (p) =>
        p.page === l.page &&
        cy > p.top &&
        cy < p.bottom &&
        cx > p.x0 &&
        cx < p.x1
    );
  });

  let removed = 0;
  if (opt.cleanHeaders) {
    const r = removeHeadersFooters(ex, lines, body);
    lines = r.kept;
    removed = r.removed;
  }
  let notes: Note[] = [];
  if (opt.notes) {
    const r = takeFootnotes(ex, lines, body);
    lines = r.kept;
    notes = r.notes;
    linkMarkers(
      lines,
      notes,
      new Set(ex.pages.flatMap((p, i) => (p.ocr ? [i] : [])))
    );
  }

  // line spacing of body text
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1],
      b = lines[i];
    if (a.page !== b.page) continue;
    if (
      Math.abs(a.size - body) > body * 0.12 ||
      Math.abs(b.size - body) > body * 0.12
    )
      continue;
    const g = b.base - a.base;
    if (g > body * 0.8 && g < body * 2.5) gaps.push(g);
  }
  const ctx: Ctx = {
    body,
    lead: mode(gaps, 0.25) || body * 1.25,
    ...pageEdges(lines, body),
  };

  // chapters
  let roles = new Map<number, Role>();
  let marks: Mark[] = [];
  let source: Book['stats']['chapterSource'] = 'pages';
  if (opt.chapters === 'auto') {
    const o = outlineRoles(lines, ex.outline, ctx);
    if (o) {
      roles = o.roles;
      marks = o.marks;
      source = 'bookmarks';
    }
  }
  if (source === 'pages' && opt.chapters !== 'none') {
    const f = fontRoles(lines, ctx, ex.pages.length);
    if (f) {
      roles = f;
      source = 'fonts';
    }
  }
  if (opt.chapters === 'none' || !roles.size) {
    roles = new Map();
    marks = [];
    source = 'pages';
    const per = 20;
    const firstOfPage = new Map<number, number>();
    lines.forEach((l, i) => {
      if (!firstOfPage.has(l.page)) firstOfPage.set(l.page, i);
    });
    for (let p = 0; p < ex.pages.length; p += per) {
      let at = -1;
      for (let q = p; q < p + per && at < 0; q++) at = firstOfPage.get(q) ?? -1;
      if (at < 0) continue;
      const to = Math.min(ex.pages.length, p + per);
      marks.push({
        before: at,
        title: `Pages ${p + 1} to ${to}`,
        level: 1,
        chapter: true,
      });
    }
  }
  const marksAt = new Map<number, Mark[]>();
  for (const m of marks) {
    if (!marksAt.has(m.before)) marksAt.set(m.before, []);
    marksAt.get(m.before)!.push(m);
  }

  // assemble
  const chapters: Chapter[] = [];
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const placed = new Set<string>();
  let cur: Chapter = { title: ex.title, blocks: [], notes: [], front: true };
  let para: Block | null = null;
  let prevLine: Line | null = null;
  const pendingPics: Picture[] = [];
  const picQueue = opt.pictures
    ? [...pics].sort((a, b) => a.page - b.page || a.top - b.top)
    : [];
  const stats = { paragraphs: 0, headings: 0, pictures: 0 };
  const chapterOfPage = new Map<number, Chapter>();

  const flushPics = () => {
    for (const p of pendingPics.splice(0)) {
      cur.blocks.push({ kind: 'img', picture: p, page: p.page, top: p.top });
      stats.pictures++;
    }
  };
  const flushPara = () => {
    if (para) {
      const text = para
        .segs!.map((s) => s.t)
        .join('')
        .trim();
      if (text) {
        cur.blocks.push(para);
        stats.paragraphs++;
      }
      para = null;
    }
    flushPics();
  };
  const startHeading = (
    title: string,
    level: number,
    chapter: boolean,
    at: Line | undefined
  ) => {
    flushPara();
    if (chapter) {
      if (cur.blocks.length) chapters.push(cur);
      cur = { title, blocks: [], notes: [] };
    }
    cur.blocks.push({
      kind: 'h',
      level,
      segs: [{ t: title }],
      page: at?.page ?? 0,
      top: at?.top ?? 0,
    });
    stats.headings++;
    prevLine = null;
  };

  for (let i = 0; i <= lines.length; i++) {
    const l = lines[i];
    if (l) {
      while (
        picQueue.length &&
        (picQueue[0].page < l.page ||
          (picQueue[0].page === l.page && picQueue[0].top < l.top))
      )
        pendingPics.push(picQueue.shift()!);
      if (!chapterOfPage.has(l.page)) chapterOfPage.set(l.page, cur);
    }
    for (const m of marksAt.get(i) ?? [])
      startHeading(m.title, m.level, m.chapter, l);
    if (!l) break;
    const r = roles.get(i);
    if (r?.skip) continue;
    if (r) {
      startHeading(r.title, r.level, r.chapter, l);
      chapterOfPage.set(l.page, cur);
      continue;
    }
    const firstOnPage = !prevLine || prevLine.page !== l.page;
    if (para && prevLine && continues(prevLine, l, ctx, firstOnPage)) {
      appendLine(para.segs!, l.segs);
    } else {
      flushPara();
      para = {
        kind: 'p',
        segs: l.segs.map((s) => ({ ...s })),
        page: l.page,
        top: l.top,
      };
      para.segs![0].t = para.segs![0].t.replace(/^\s+/, '');
    }
    for (const s of l.segs) {
      if (s.note && !placed.has(s.note)) {
        const n = noteById.get(s.note);
        if (n) {
          cur.notes.push(n);
          placed.add(n.id);
        }
      }
    }
    prevLine = l;
  }
  pendingPics.push(...picQueue);
  flushPara();
  if (cur.blocks.length || !chapters.length) chapters.push(cur);
  const front = chapters[0];
  if (front?.front && !front.title) {
    const h = front.blocks.find((b) => b.kind === 'h');
    front.title = h
      ? (h.segs ?? [])
          .map((x) => x.t)
          .join('')
          .trim()
      : '';
    front.title ||= ex.lang === 'ru' ? 'Начало' : 'Start';
  }
  // notes nobody pointed at go to the chapter of their page
  for (const n of notes) {
    if (placed.has(n.id)) continue;
    let ch: Chapter | undefined;
    for (let p = n.page; p >= 0 && !ch; p--) ch = chapterOfPage.get(p);
    (ch ?? chapters[chapters.length - 1]).notes.push(n);
  }

  return {
    title: ex.title,
    author: ex.author,
    lang: ex.lang,
    chapters,
    stats: {
      pages: ex.pages.length,
      ...stats,
      removedLines: removed,
      notes: notes.length,
      ocrPages: ex.pages.filter((p) => p.ocr).length,
      chapterSource: source,
    },
  };
}
