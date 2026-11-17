// Last Plyleaf build step (after apply-indexing-policy):
// - robots.txt for this deployment's address, pointing at its sitemap;
// - long cache for hashed assets in Cloudflare's _headers;
// - _redirects for pages that moved;
// - files above Cloudflare Pages' 25 MiB per-file limit split into parts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIndexingBlocked, resolveSiteUrl } from '../indexing-policy.mjs';
import { writeLlmsTxt } from './llms.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const DIST = path.join(ROOT, 'dist');
const SITE_URL = resolveSiteUrl().replace(/\/+$/, '');
const LIMIT = 25 * 1024 * 1024;

// robots.txt: crawlers may read every page (noindex only works on pages they can fetch)
fs.writeFileSync(
  path.join(DIST, 'robots.txt'),
  `# ${isIndexingBlocked() ? 'Test deployment: every page carries noindex.' : 'Plyleaf'}
# AI assistants and their crawlers are welcome; a summary of the site is at ${SITE_URL}/llms.txt
User-agent: *
Allow: /
Disallow: /api/
Disallow: /*.wasm$

User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Google-Extended
User-agent: Applebot-Extended
Allow: /
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`
);

// llms.txt for AI assistants
const llms = writeLlmsTxt({ root: ROOT, dist: DIST, siteUrl: SITE_URL });
console.log(`✔ Plyleaf finalize: llms.txt with ${llms.tools} tools`);

// cache: hashed build assets never change; pages and the sitemap are revalidated
const headersPath = path.join(DIST, '_headers');
let headers = fs.existsSync(headersPath)
  ? fs.readFileSync(headersPath, 'utf8')
  : '';
if (!headers.includes('/assets/*')) {
  headers += `
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/images/*
  Cache-Control: public, max-age=86400
`;
  fs.writeFileSync(headersPath, headers);
}

// moved pages: the text editor took over /edit-pdf, the annotator moved to /annotate-pdf
const moved = [['edit-pdf-text', 'edit-pdf']];
fs.writeFileSync(
  path.join(DIST, '_redirects'),
  moved
    .flatMap(([from, to]) => [
      `/${from} /${to} 301`,
      `/${from}.html /${to} 301`,
      `/:lang/${from} /:lang/${to} 301`,
      `/:lang/${from}.html /:lang/${to} 301`,
    ])
    .join('\n') + '\n'
);

// BentoPDF's own pages carry its name and address in hidden metadata (tab title suffix,
// author, site name, its X account, breadcrumb data on bentopdf.com): rewrite them to ours
const BRAND = process.env.VITE_BRAND_NAME || '';
if (BRAND) {
  let rebranded = 0;
  const pages = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) pages(p);
      else if (e.name.endsWith('.html')) {
        const html = fs.readFileSync(p, 'utf8');
        const rename = (block) => block.replace(/BentoPDF/g, BRAND);
        const out = html
          .replace(/https:\/\/www\.bentopdf\.com/g, SITE_URL)
          .replace(
            /\s*<meta name="twitter:(site|creator)" content="@BentoPDF"\s*\/?>/g,
            ''
          )
          // metadata and structured data only; visible credits to BentoPDF stay
          .replace(/<head>[\s\S]*?<\/head>/, rename)
          .replace(
            /<script type="application\/ld\+json"[\s\S]*?<\/script>/g,
            rename
          );
        if (out !== html) {
          fs.writeFileSync(p, out);
          rebranded++;
        }
      }
    }
  };
  pages(DIST);
  console.log(
    `✔ Plyleaf finalize: ${rebranded} BentoPDF pages renamed to ${BRAND} in titles and metadata`
  );
}

// files above Cloudflare Pages' limit are split into parts that the LibreOffice loader
// reassembles (src/js/utils/libreoffice-loader.ts): <name>.part0…N and <name>.parts (the count)
const PART = 24 * 1024 * 1024;
const big = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (fs.statSync(p).size > LIMIT) big.push(p);
  }
};
walk(DIST);
for (const p of big) {
  const data = fs.readFileSync(p);
  const count = Math.ceil(data.length / PART);
  for (let i = 0; i < count; i++)
    fs.writeFileSync(`${p}.part${i}`, data.subarray(i * PART, (i + 1) * PART));
  fs.writeFileSync(`${p}.parts`, String(count));
  fs.rmSync(p);
}
console.log(
  `✔ Plyleaf finalize: robots.txt for ${SITE_URL}, cache headers` +
    (big.length
      ? `; split ${big.length} file(s) over 25 MiB: ${big.map((p) => path.relative(DIST, p)).join(', ')}`
      : '')
);
