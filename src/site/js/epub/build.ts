// Stage 3 of PDF to EPUB: write an EPUB 3 file (with an EPUB 2 table of contents for older
// readers) from the structured book. JSZip is loaded only when the file is built.
import type { Book, Chapter, Picture, Seg } from './model';

const XML_BAD = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
export const esc = (s: string) =>
  s
    .replace(XML_BAD, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function inline(segs: Seg[], noteNo: (id: string) => number): string {
  let out = '';
  for (const s of segs) {
    if (s.note) {
      const n = noteNo(s.note);
      out += `<sup><a class="noteref" epub:type="noteref" id="r-${s.note}" href="#${s.note}">${n}</a></sup>`;
      continue;
    }
    let t = esc(s.t);
    if (!t) continue;
    if (s.sup) t = `<sup>${t}</sup>`;
    if (s.italic) t = `<i>${t}</i>`;
    if (s.bold) t = `<b>${t}</b>`;
    out += t;
  }
  return out.replace(/\s{2,}/g, ' ');
}

export interface TocEntry {
  title: string;
  id: string;
  level: number;
}

/** Inner body HTML of one chapter, plus its section headings for the table of contents. */
export function chapterBody(
  ch: Chapter,
  imgSrc: (p: Picture) => string,
  opts: { pictures: boolean; lang: string }
): { html: string; toc: TocEntry[] } {
  const order = new Map(ch.notes.map((n, i) => [n.id, i + 1]));
  const noteNo = (id: string) => order.get(id) ?? 0;
  const toc: TocEntry[] = [];
  let html = '';
  let hn = 0;
  let afterHeading = true;
  for (const b of ch.blocks) {
    if (b.kind === 'h') {
      const level = Math.min(3, b.level ?? 1);
      const id = `h${++hn}`;
      const text = (b.segs ?? [])
        .map((s) => s.t)
        .join('')
        .trim();
      toc.push({ title: text, id, level });
      html += `<h${level} id="${id}">${esc(text)}</h${level}>\n`;
      afterHeading = true;
    } else if (b.kind === 'img') {
      if (!opts.pictures || !b.picture) continue;
      html += `<figure><img src="${imgSrc(b.picture)}" alt="${esc(pictureAlt(b.picture, opts.lang))}"/></figure>\n`;
      afterHeading = true;
    } else {
      const inner = inline(b.segs ?? [], noteNo).trim();
      if (!inner) continue;
      html += `<p${afterHeading ? ' class="first"' : ''}>${inner}</p>\n`;
      afterHeading = false;
    }
  }
  const refs = new Set(
    ch.blocks.flatMap((b) =>
      (b.segs ?? []).filter((x) => x.note).map((x) => x.note!)
    )
  );
  if (ch.notes.length) {
    html += `<hr class="notes-rule"/>\n<section class="notes" epub:type="footnotes">\n`;
    ch.notes.forEach((n, i) => {
      html += `<aside class="note" epub:type="footnote" id="${n.id}"><p>${refs.has(n.id) ? `<a href="#r-${n.id}">${i + 1}.</a>` : `${i + 1}.`} ${inline(n.segs, noteNo).trim()}</p></aside>\n`;
    });
    html += `</section>\n`;
  }
  return { html, toc };
}

const pictureAlt = (p: Picture, lang: string) =>
  lang === 'ru'
    ? `Иллюстрация, страница ${p.page + 1}`
    : `Picture from page ${p.page + 1}`;

export const BOOK_CSS = `body { margin: 0 4%; line-height: 1.45; }
h1, h2, h3 { line-height: 1.25; text-align: left; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 1.6em; margin: 1.5em 0 1em; }
h2 { font-size: 1.25em; margin: 1.4em 0 0.6em; }
h3 { font-size: 1.05em; margin: 1.2em 0 0.4em; }
p { margin: 0; text-indent: 1.3em; orphans: 2; widows: 2; }
p.first { text-indent: 0; }
figure { margin: 1em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figure img { max-width: 100%; max-height: 90vh; }
sup { line-height: 0; font-size: 0.7em; }
a.noteref { text-decoration: none; }
hr.notes-rule { width: 30%; margin: 2em 0 0.8em; border: 0; border-top: 1px solid currentColor; opacity: 0.4; }
aside.note p { text-indent: 0; font-size: 0.9em; margin: 0 0 0.5em; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
`;

const xhtml = (
  title: string,
  lang: string,
  body: string,
  css = '../style.css'
) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="${css}"/>
</head>
<body>
${body}</body>
</html>
`;

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface BuildOptions {
  pictures: boolean;
  cover: Blob | null;
  fallbackTitle: string;
}

export async function buildEpub(book: Book, opt: BuildOptions): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`
  );
  const lang = book.lang || 'en';
  const title = book.title || opt.fallbackTitle;
  const author = book.author;
  const id = `urn:uuid:${uuid()}`;
  const manifest: string[] = [];
  const spine: string[] = [];

  zip.file('OEBPS/style.css', BOOK_CSS);
  manifest.push('<item id="css" href="style.css" media-type="text/css"/>');

  if (opt.cover) {
    zip.file('OEBPS/images/cover.jpg', opt.cover);
    manifest.push(
      '<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>'
    );
    zip.file(
      'OEBPS/cover.xhtml',
      xhtml(
        title,
        lang,
        `<div class="cover"><img src="images/cover.jpg" alt="${esc(title)}"/></div>\n`,
        'style.css'
      )
    );
    manifest.push(
      '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>'
    );
    spine.push('<itemref idref="cover" linear="yes"/>');
  }

  const pics = new Map<Picture, string>();
  let picN = 0;
  const imgSrc = (p: Picture) => {
    let name = pics.get(p);
    if (!name) {
      name = `img${String(++picN).padStart(3, '0')}.${p.type === 'image/png' ? 'png' : 'jpg'}`;
      pics.set(p, name);
    }
    return `../images/${name}`;
  };

  const nav: { file: string; title: string; subs: TocEntry[] }[] = [];
  book.chapters.forEach((ch, i) => {
    const file = `text/ch${String(i + 1).padStart(3, '0')}.xhtml`;
    const { html, toc } = chapterBody(ch, imgSrc, {
      pictures: opt.pictures,
      lang,
    });
    zip.file(`OEBPS/${file}`, xhtml(ch.title, lang, html));
    manifest.push(
      `<item id="ch${i + 1}" href="${file}" media-type="application/xhtml+xml"/>`
    );
    spine.push(`<itemref idref="ch${i + 1}"/>`);
    const subs = ch.front
      ? []
      : toc.filter((t) => t.level === 2 && t.title !== ch.title);
    nav.push({ file, title: ch.title, subs });
  });
  for (const [p, name] of pics) {
    zip.file(`OEBPS/images/${name}`, p.blob);
    manifest.push(
      `<item id="${name.replace('.', '-')}" href="images/${name}" media-type="${p.type}"/>`
    );
  }

  const navList = nav
    .map(
      (n) =>
        `<li><a href="${n.file}">${esc(n.title)}</a>${
          n.subs.length
            ? `<ol>${n.subs.map((s) => `<li><a href="${n.file}#${s.id}">${esc(s.title)}</a></li>`).join('')}</ol>`
            : ''
        }</li>`
    )
    .join('\n');
  const tocTitle = lang === 'ru' ? 'Оглавление' : 'Contents';
  zip.file(
    'OEBPS/nav.xhtml',
    xhtml(
      tocTitle,
      lang,
      `<nav epub:type="toc" id="toc"><h1>${tocTitle}</h1>\n<ol>\n${navList}\n</ol></nav>\n` +
        (opt.cover
          ? `<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li><li><a epub:type="bodymatter" href="${nav[0]?.file ?? ''}">Start</a></li></ol></nav>\n`
          : ''),
      'style.css'
    )
  );
  manifest.push(
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
  );

  let order = 0;
  const ncxBody = nav
    .map((n, i) => {
      const own = ++order;
      const subs = n.subs
        .map(
          (s, k) =>
            `<navPoint id="np${i + 1}-${k + 1}" playOrder="${++order}"><navLabel><text>${esc(s.title)}</text></navLabel><content src="${n.file}#${s.id}"/></navPoint>`
        )
        .join('');
      return `<navPoint id="np${i + 1}" playOrder="${own}"><navLabel><text>${esc(n.title)}</text></navLabel><content src="${n.file}"/>${subs}</navPoint>`;
    })
    .join('\n');
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head><meta name="dtb:uid" content="${id}"/><meta name="dtb:depth" content="2"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${esc(title)}</text></docTitle>
<navMap>
${ncxBody}
</navMap>
</ncx>
`
  );
  manifest.push(
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
  );

  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
${author ? `<dc:creator>${esc(author)}</dc:creator>\n` : ''}<dc:language>${lang}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
${opt.cover ? '<meta name="cover" content="cover-image"/>\n' : ''}</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>
`
  );
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
