// Interface translations for the language copies of our pages (/de/, /fr/, …).
//
// By the brief, a language gets pages for search only after its own keyword research. Until
// then a language copy keeps the English page text and translates only the interface: the
// header, the footer, the working tool and the messages its script shows. Copies are noindex
// with a self canonical and no hreflang. Translations are machine-made and marked unchecked.
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

/**
 * Walks the interface regions. With a dictionary, replaces what it has; always returns the
 * keys it met (so the same walk lists what needs translating).
 */
export function walkInterface(document, dict = null) {
  const keys = new Set();
  const visit = (el) => {
    if (SKIP.has(el.tagName) || el.getAttribute('translate') === 'no') return;
    for (const a of ATTRS) {
      if (el.hasAttribute(`data-i18n-${a}`)) continue; // BentoPDF's locales handle it
      const v = el.getAttribute(a);
      if (!v || !hasLetters(v)) continue;
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
      else if (n.nodeType === 3 && hasLetters(n.textContent)) {
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
  const seen = new Set();
  for (const sel of REGIONS)
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      visit(el);
    }
  return keys;
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

const NOTE_KEY =
  'The interface of this page is translated by machine and not yet checked. The page text is in English.';
const UNCHECKED_KEYS = [NOTE_KEY, 'Languages'];

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
 * dictionary exists, page text left in English, noindex, self canonical, links kept in the language.
 */
export function languageCopy(html, { lang, slug, siteUrl, languages, server }) {
  const dom = new JSDOM(html);
  const d = dom.window.document;
  const dict = loadDict(lang);
  const pagePath = slug === 'index' ? '' : slug;
  const url = `${siteUrl}/${lang}${pagePath ? `/${pagePath}` : ''}`;

  d.documentElement.lang = lang;
  d.documentElement.dir = ['ar', 'fa'].includes(lang) ? 'rtl' : 'ltr';
  d.querySelector('script[data-language-redirect]')?.remove();
  const robots = d.querySelector('meta[name="robots"]');
  if (robots) robots.setAttribute('content', 'noindex, follow');
  d.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
  d.querySelector('meta[property="og:url"]')?.setAttribute('content', url);
  d.querySelector('meta[name="twitter:url"]')?.setAttribute('content', url);
  d.querySelectorAll('link[rel="alternate"][hreflang]').forEach((e) =>
    e.remove()
  );
  // structured data describes the English page; the copy is not for search
  d.querySelectorAll('script[type="application/ld+json"]').forEach((e) =>
    e.remove()
  );

  // page text stays English; the working tool speaks the page's language
  const main = d.querySelector('main');
  main?.setAttribute('lang', 'en');
  main?.setAttribute('dir', 'ltr');
  for (const w of d.querySelectorAll('.work')) w.setAttribute('lang', lang);
  if (!dict) {
    for (const el of d.querySelectorAll('.site-header, .site-footer'))
      el.setAttribute('lang', 'en');
  }

  // BentoPDF's own tool markup (data-i18n) has its translations in public/locales
  if (server) server.apply(d, server.resources);

  if (dict) {
    walkInterface(d, dict);
    const hero = d.querySelector('main .hero-a, main .home-hero');
    if (hero && typeof dict[NOTE_KEY] === 'string') {
      const note = d.createElement('p');
      note.className = 'lang-note';
      note.setAttribute('lang', lang);
      note.textContent = dict[NOTE_KEY];
      hero.after(note);
    }
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

// ---------- report: `node scripts/site/i18n-ui.mjs [--keys]` ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
