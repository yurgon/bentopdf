import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isIndexingBlocked, resolveSiteUrl } from './indexing-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');
const NOINDEX_META = '<meta name="robots" content="noindex, follow" />';

function listHtml(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listHtml(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

// Language folders (/de/, /fr/, …): interface translations only, no pages researched for search
// in that language yet, so they stay out of the index and nothing points at them with hreflang.
const LANGS = new Set(
  fs
    .readdirSync(path.resolve(__dirname, '../public/locales'))
    .filter((d) => d !== 'en')
);
const HREFLANG = /[ \t]*<link\s+rel=["']alternate["'][^>]*hreflang=[^>]*>\s*/gi;

if (!isIndexingBlocked()) {
  let langPages = 0;
  for (const file of listHtml(DIST_DIR)) {
    const rel = path.relative(DIST_DIR, file).split(path.sep);
    const html = fs.readFileSync(file, 'utf-8');
    let next = html.replace(HREFLANG, '');
    if (rel.length > 1 && LANGS.has(rel[0])) {
      const robots = /<meta\s+name=["']robots["'][^>]*>/i;
      next = robots.test(next)
        ? next.replace(robots, NOINDEX_META)
        : next.replace(/<\/head>/i, `  ${NOINDEX_META}\n  </head>`);
      langPages++;
    }
    if (next !== html) fs.writeFileSync(file, next);
  }
  console.log(
    `Indexing policy: English pages may be indexed; ${langPages} language pages are noindex, hreflang removed.`
  );
} else {
  let updated = 0;
  for (const file of listHtml(DIST_DIR)) {
    const html = fs.readFileSync(file, 'utf-8');
    const robots = /<meta\s+name=["']robots["'][^>]*>/i;
    const next = robots.test(html)
      ? html.replace(robots, NOINDEX_META)
      : html.replace(/<\/head>/i, `  ${NOINDEX_META}\n  </head>`);
    if (next !== html) {
      fs.writeFileSync(file, next);
      updated++;
    }
  }
  console.log(
    `Indexing policy: SITE_URL is ${resolveSiteUrl()}, so ${updated} pages were marked noindex. Set ALLOW_INDEXING=true to let search engines index this deployment.`
  );
}
