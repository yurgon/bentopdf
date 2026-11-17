// Interface translations for the language copies of our pages (/de/, /fr/, …).
//
// By the brief, a language gets pages for search only after its own keyword research. Until
// then a language copy keeps the English page text and translates only the interface: the
// header, the footer, the working tool and the messages its script shows. Copies are noindex
// with a self canonical and no hreflang. The pages never say how the translation was made.
//
// Dictionaries: src/site/i18n/<lang>.json, keyed by the English text. A value is a string, or
// for counted phrases (tn() in src/site/js/i18n.ts) an object of plural forms
// { one, few, many, other }. Text with inline markup (a link inside a sentence) is keyed by its
// inner HTML. `node scripts/site/i18n-ui.mjs` lists the keys and what each language is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const DICT_DIR = path.join(ROOT, 'src/site/i18n');

/** Languages with a translated interface, in the order the switcher shows them. */
export const UI_LANGS = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  tr: 'Türkçe',
  id: 'Bahasa Indonesia',
  vi: 'Tiếng Việt',
  ru: 'Русский',
  ko: '한국어',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
  ja: '日本語',
  nl: 'Nederlands',
  pl: 'Polski',
  uk: 'Українська',
  sv: 'Svenska',
  da: 'Dansk',
  ca: 'Català',
  sk: 'Slovenčina',
  be: 'Беларуская',
  ar: 'العربية',
  fa: 'فارسی',
};

/** Parts of a page that are interface. Everything else in <main> is English page text. */
const REGIONS = [
  'a.visually-hidden[href="#main"]',
  '.site-header',
  '.site-footer',
  '.work',
  '.home-hero .search',
  '#search-empty',
];
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
const INLINE = new Set([
  'A',
  'B',
  'STRONG',
  'EM',
  'I',
  'CODE',
  'KBD',
  'BR',
  'SPAN',
]);
const SKIP = new Set(['SCRIPT', 'STYLE', 'svg', 'SVG', 'TEMPLATE', 'TEXTAREA']);

const norm = (s) => s.replace(/\s+/g, ' ').trim();
// sample values the script replaces (“220 pages · 2.1 MB”, “book.pdf”) and template leftovers
const hasLetters = (s) =>
  /\p{L}{2,}/u.test(s) && !/^\s*(\d|\{\{)|\.(pdf|epub)\b/.test(s);

/** An element whose own text runs around inline markup: translated as one piece of HTML. */
function isMixed(el) {
  let text = false;
  let inline = false;
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.textContent.trim()) text = true;
    else if (n.nodeType === 1) {
      if (!INLINE.has(n.tagName) || n.querySelector('*:not(br)')) return false;
      if (n.tagName !== 'BR' && n.textContent.trim()) inline = true;
    }
  }
  return text && inline;
}

/** One walker for both kinds of text: records each key met and, with a dictionary, replaces it. */
function makeVisitor(
  keys,
  dict,
  { letters = hasLetters, skip = () => false } = {}
) {
  const visit = (el) => {
    if (
      SKIP.has(el.tagName) ||
      el.getAttribute('translate') === 'no' ||
      skip(el)
    )
      return;
    for (const a of ATTRS) {
      if (el.hasAttribute(`data-i18n-${a}`)) continue; // BentoPDF's locales handle it
      const v = el.getAttribute(a);
      if (!v || !letters(v)) continue;
      const k = norm(v);
      keys.add(k);
      if (dict && typeof dict[k] === 'string') el.setAttribute(a, dict[k]);
    }
    if (el.hasAttribute('data-i18n')) {
      // BentoPDF's own markup: its text comes from public/locales
      for (const c of el.children) visit(c);
      return;
    }
    if (isMixed(el)) {
      const k = norm(el.innerHTML);
      keys.add(k);
      if (dict && typeof dict[k] === 'string') el.innerHTML = dict[k];
      return;
    }
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 1) visit(n);
      else if (n.nodeType === 3 && letters(n.textContent)) {
        const k = norm(n.textContent);
        keys.add(k);
        if (dict && typeof dict[k] === 'string') {
          const lead = /^\s/.test(n.textContent) ? ' ' : '';
          const tail = /\s$/.test(n.textContent) ? ' ' : '';
          n.textContent = lead + dict[k] + tail;
        }
      }
    }
  };
  return visit;
}

/**
 * Walks the interface regions. With a dictionary, replaces what it has; always returns the
 * keys it met (so the same walk lists what needs translating).
 */
export function walkInterface(document, dict = null) {
  const keys = new Set();
  const visit = makeVisitor(keys, dict);
  const seen = new Set();
  for (const sel of REGIONS)
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      visit(el);
    }
  return keys;
}

// ---------- page text ----------

const PAGE_DICT_DIR = path.join(DICT_DIR, 'pages');
/**
 * Languages whose pages may be opened to search. A page opens in one of them only when every
 * piece of its text has a translation in src/site/i18n/pages/<lang>.json; until then the copy
 * stays as before (English page text, noindex).
 */
export const OPEN_LANGS = ['pt', 'id', 'tr', 'es', 'de', 'fr', 'vi'];
const META_TEXT = [
  'meta[name="description"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:image:alt"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
];
const LD_TEXT = new Set([
  'name',
  'description',
  'text',
  'featureList',
  'headline',
  'browserRequirements',
  'operatingSystem',
]);
// page text: anything with letters, numbered steps included
const pageLetters = (s) => /\p{L}{2,}/u.test(s);

/**
 * Walks the page's own text: title, descriptions, structured data and <main> without the
 * interface regions. Same contract as walkInterface.
 */
export function walkPage(document, dict = null, slug = '') {
  const keys = new Set();
  const lookup = pageLookup(dict, slug);
  const tr = (v) => {
    if (!v || !pageLetters(v)) return v;
    const k = norm(v);
    keys.add(k);
    return lookup?.[k] ?? v;
  };
  const title = document.querySelector('title');
  if (title) title.textContent = tr(title.textContent);
  for (const sel of META_TEXT)
    for (const m of document.querySelectorAll(sel))
      m.setAttribute('content', tr(m.getAttribute('content')));
  for (const s of document.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    let data;
    try {
      data = JSON.parse(s.textContent);
    } catch {
      continue;
    }
    const walk = (o) => {
      if (Array.isArray(o)) return o.map(walk);
      if (!o || typeof o !== 'object') return o;
      for (const [k, v] of Object.entries(o)) {
        if (LD_TEXT.has(k) && typeof v === 'string') o[k] = tr(v);
        else if (LD_TEXT.has(k) && Array.isArray(v))
          o[k] = v.map((x) => (typeof x === 'string' ? tr(x) : walk(x)));
        else o[k] = walk(v);
      }
      return o;
    };
    data = walk(data);
    if (dict) s.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  }
  const main = document.querySelector('main');
  if (main)
    makeVisitor(keys, lookup, {
      letters: pageLetters,
      skip: (el) => REGIONS.some((sel) => el.matches(sel)),
    })(main);
  return keys;
}

/**
 * A page dictionary maps English text to its translation; `"@pages": { slug: { … } }` holds the
 * few pieces a page translates differently (the same English word can need another gender or
 * term on one page). Returns a plain lookup object for one page.
 */
function pageLookup(dict, slug) {
  if (!dict) return null;
  const own = dict['@pages']?.[slug];
  return own ? { ...dict, ...own } : dict;
}

const pageDicts = {};
export function loadPageDict(lang) {
  if (!(lang in pageDicts)) {
    const f = path.join(PAGE_DICT_DIR, `${lang}.json`);
    pageDicts[lang] = fs.existsSync(f)
      ? JSON.parse(fs.readFileSync(f, 'utf8'))
      : null;
  }
  return pageDicts[lang];
}

/** The page text keys of an English page that still have no translation in `lang`. */
export function missingPageKeys(document, lang, slug) {
  const dict = pageLookup(loadPageDict(lang) || {}, slug);
  return [...walkPage(document)].filter((k) => typeof dict[k] !== 'string');
}

/** Keys used by the page scripts: the English arguments of t(), tn(), tp() and tpn(). */
export function scriptKeys() {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (f.endsWith('.ts')) files.push(f);
    }
  };
  walk(path.join(ROOT, 'src/site/js'));
  const lit = `'((?:[^'\\\\]|\\\\.)*)'`;
  const one = new RegExp(`\\btp?\\(\\s*${lit}`, 'g');
  const counted = new RegExp(
    `\\bt(?:p?n)\\(\\s*[^']*?,\\s*${lit},\\s*${lit}`,
    'g'
  );
  const unq = (s) => s.replace(/\\(.)/g, '$1');
  const keys = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(one)) keys.add(unq(m[1]));
    for (const m of src.matchAll(counted)) keys.add(unq(m[2]));
  }
  return keys;
}

const UNCHECKED_KEYS = ['Languages'];

const dicts = {};
export function loadDict(lang) {
  if (!(lang in UI_LANGS) || lang === 'en') return null;
  if (!(lang in dicts)) {
    const f = path.join(DICT_DIR, `${lang}.json`);
    dicts[lang] = fs.existsSync(f)
      ? JSON.parse(fs.readFileSync(f, 'utf8'))
      : null;
  }
  return dicts[lang];
}

let jsKeys = null;

/**
 * Turns an English Plyleaf page into its copy for `lang`: interface translated where a
 * dictionary exists, self canonical, links kept in the language. Page text is translated and the
 * copy is open to search when the page dictionary covers all of it (see OPEN_LANGS); otherwise
 * the page text stays English and the copy is noindex.
 */
export function languageCopy(html, { lang, slug, siteUrl, languages, server }) {
  const dom = new JSDOM(html);
  const d = dom.window.document;
  const dict = loadDict(lang);
  const pagePath = slug === 'index' ? '' : slug;
  const url = `${siteUrl}/${lang}${pagePath ? `/${pagePath}` : ''}`;

  // a page opens to search in its language only when all of its text is translated
  const localized =
    OPEN_LANGS.includes(lang) &&
    !!dict &&
    missingPageKeys(d, lang, slug).length === 0;

  d.documentElement.lang = lang;
  d.documentElement.dir = ['ar', 'fa'].includes(lang) ? 'rtl' : 'ltr'; // header and footer follow the language
  d.querySelector('script[data-language-redirect]')?.remove();
  const robots = d.querySelector('meta[name="robots"]');
  if (robots && !localized) robots.setAttribute('content', 'noindex, follow');
  d.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
  d.querySelector('meta[property="og:url"]')?.setAttribute('content', url);
  d.querySelector('meta[name="twitter:url"]')?.setAttribute('content', url);
  d.querySelectorAll('link[rel="alternate"][hreflang]').forEach((e) =>
    e.remove()
  );
  const rtl = ['ar', 'fa'].includes(lang);
  const main = d.querySelector('main');
  if (localized) {
    // the whole page speaks the language: text, descriptions and structured data
    walkPage(d, loadPageDict(lang), slug);
    d.querySelector('meta[name="plyleaf:content"]')?.setAttribute(
      'content',
      lang
    );
    const own = (u) =>
      typeof u === 'string' &&
      u.startsWith(`${siteUrl}/`) &&
      !/\.[a-z0-9]{2,5}$/i.test(u) &&
      !new RegExp(`^${siteUrl}/(${languages.join('|')})(/|$)`).test(u);
    const relink = (o) => {
      if (Array.isArray(o)) return o.forEach(relink);
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if ((k === 'url' || k === 'item') && own(v)) {
          const rest = v.slice(siteUrl.length + 1);
          o[k] = `${siteUrl}/${lang}${rest ? `/${rest}` : ''}`;
        } else relink(v);
      }
    };
    for (const s of d.querySelectorAll('script[type="application/ld+json"]')) {
      const data = JSON.parse(s.textContent);
      relink(data);
      s.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    }
    main?.setAttribute('lang', lang);
    main?.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  } else {
    // structured data describes the English page; the copy is not for search
    d.querySelectorAll('script[type="application/ld+json"]').forEach((e) =>
      e.remove()
    );
    // page text stays English; the working tool speaks the page's language
    main?.setAttribute('lang', 'en');
    main?.setAttribute('dir', 'ltr');
  }
  for (const w of d.querySelectorAll('.work')) {
    w.setAttribute('lang', lang);
    w.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  }
  if (!dict) {
    for (const el of d.querySelectorAll('.site-header, .site-footer'))
      el.setAttribute('lang', 'en');
  }

  // BentoPDF's own tool markup (data-i18n) has its translations in public/locales
  if (server) server.apply(d, server.resources);

  if (dict) {
    walkInterface(d, dict);
    jsKeys ??= scriptKeys();
    const used = Object.fromEntries(
      Object.entries(dict).filter(([k]) => jsKeys.has(k))
    );
    const data = d.createElement('script');
    data.type = 'application/json';
    data.id = 'pl-i18n';
    data.textContent = JSON.stringify(used).replace(/</g, '\\u003c');
    const firstModule = d.querySelector('head script[type="module"]');
    d.head.insertBefore(data, firstModule);
  }

  // the switcher marks the language you are on
  for (const a of d.querySelectorAll('.langs a[hreflang]')) {
    if (a.getAttribute('hreflang') === lang)
      a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }

  // links to our pages stay in this language
  const langRe = new RegExp(`^/(${languages.join('|')})(/|$)`);
  for (const a of d.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (!h.startsWith('/') || h.startsWith('//') || a.hasAttribute('hreflang'))
      continue;
    if (langRe.test(h) || /^\/(blog|docs|assets|api)(\/|$)/.test(h)) continue;
    const [p, rest = ''] = h.split(/(?=[?#])/);
    if (/\.[a-z0-9]{2,5}$/i.test(p)) continue; // files: /samples/x.pdf, /sitemap.xml
    a.setAttribute('href', `/${lang}${p}${rest}`); // /de/ is the language home (/de redirects there)
  }

  const out = dom.serialize();
  dom.window.close();
  return out;
}

// ---------- page text report ----------
// `node scripts/site/i18n-ui.mjs --pages` shows, for each open language, which pages are fully
// translated. `--export-pages <dir>` writes <dir>/<slug>.json: the English text keys of each page
// in page order, to translate into src/site/i18n/pages/<lang>.json.
function pageReport() {
  const pagesDir = path.join(ROOT, 'site-pages');
  const docs = fs
    .readdirSync(pagesDir)
    .filter((x) => x.endsWith('.html'))
    .map((f) => [
      f.replace(/\.html$/, ''),
      new JSDOM(fs.readFileSync(path.join(pagesDir, f), 'utf8')).window
        .document,
    ]);
  const exp = process.argv.indexOf('--export-pages');
  if (exp > 0) {
    const dir = process.argv[exp + 1];
    fs.mkdirSync(dir, { recursive: true });
    for (const [slug, d] of docs)
      fs.writeFileSync(
        path.join(dir, `${slug}.json`),
        JSON.stringify([...walkPage(d)], null, 1) + '\n'
      );
    console.log(`${docs.length} pages exported to ${dir}`);
  }
  for (const lang of OPEN_LANGS) {
    const missing = docs.map(([slug, d]) => [
      slug,
      missingPageKeys(d, lang, slug),
    ]);
    const done = missing.filter(([, m]) => !m.length).length;
    const left = missing.reduce((n, [, m]) => n + m.length, 0);
    console.log(
      `${lang.padEnd(6)} ${done}/${docs.length} pages translated` +
        (left ? `, ${left} pieces missing` : '')
    );
    if (process.argv.includes('--missing'))
      for (const [slug, m] of missing)
        for (const k of m) console.log(`   ${slug}: ${k}`);
  }
}

// ---------- report: `node scripts/site/i18n-ui.mjs [--keys]` ----------
if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  (process.argv.includes('--pages') || process.argv.includes('--export-pages'))
) {
  pageReport();
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pagesDir = path.join(ROOT, 'site-pages');
  const html = new Set(UNCHECKED_KEYS);
  for (const f of fs.readdirSync(pagesDir).filter((x) => x.endsWith('.html'))) {
    const { document } = new JSDOM(
      fs.readFileSync(path.join(pagesDir, f), 'utf8')
    ).window;
    for (const k of walkInterface(document)) html.add(k);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'src/site/partials/work'))) {
    const { document } = new JSDOM(
      fs.readFileSync(path.join(ROOT, 'src/site/partials/work', f), 'utf8')
    ).window;
    for (const k of walkInterface(document)) html.add(k);
  }
  const js = scriptKeys();
  const all = [...new Set([...html, ...js])].sort();
  if (process.argv.includes('--keys')) {
    fs.mkdirSync(DICT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(DICT_DIR, '_keys.json'),
      JSON.stringify({ html: [...html].sort(), js: [...js].sort() }, null, 2) +
        '\n'
    );
  }
  console.log(
    `${html.size} interface keys, ${js.size} script keys, ${all.length} in all`
  );
  for (const lang of Object.keys(UI_LANGS).slice(1)) {
    const dict = loadDict(lang) || {};
    const missing = all.filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !all.includes(k));
    console.log(
      `${lang.padEnd(6)} ${all.length - missing.length}/${all.length}` +
        (extra.length ? ` · ${extra.length} unused` : '')
    );
    if (process.argv.includes('--missing'))
      for (const k of missing) console.log(`   - ${k}`);
  }
}
