// Which language copies of our pages are open to search. A copy is open when the build translated
// all of its text (scripts/site/i18n-ui.mjs marks it with <meta name="plyleaf:content" content="<lang>">).
// The indexing policy, the sitemap and the SEO audit all read the answer from here.
import fs from 'node:fs';
import path from 'node:path';

const MARK = /<meta\s+name="plyleaf:content"\s+content="([a-zA-Z-]+)"\s*\/?>/i;

/** { slug: ['de', 'pt', …] } for every page with at least one open language copy. */
export function localizedPages(distDir) {
  const out = {};
  for (const e of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(distDir, e.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.html')) continue;
      const head = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 6000);
      const m = head.match(MARK);
      if (!m || m[1] !== e.name) continue;
      (out[f.replace(/\.html$/, '')] ??= []).push(e.name);
    }
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

/** Page URL in a language ('en' is the root). */
export function pageUrl(siteUrl, lang, slug) {
  const p = slug === 'index' ? '' : slug;
  const base = lang === 'en' ? siteUrl : `${siteUrl}/${lang}`;
  return p ? `${base}/${p}` : base;
}

/** hreflang links for a page open in `langs` (plus English and x-default). */
export function hreflangLinks(siteUrl, slug, langs) {
  const all = ['en', ...langs];
  return [
    ...all.map(
      (l) =>
        `<link rel="alternate" hreflang="${l}" href="${pageUrl(siteUrl, l, slug)}" />`
    ),
    `<link rel="alternate" hreflang="x-default" href="${pageUrl(siteUrl, 'en', slug)}" />`,
  ];
}
