// llms.txt (https://llmstxt.org): a plain description of the site for AI assistants, written into
// dist/ by finalize.mjs. Built from the home page catalog and each page's own title and
// description, so it never drifts from the site. Every English tool page is listed.
import fs from 'node:fs';
import path from 'node:path';

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

function pageInfo(dist, slug) {
  const file = path.join(dist, `${slug}.html`);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, 'utf8');
  const title = decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? slug);
  const desc = decode(
    html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? ''
  );
  return { title, desc };
}

export function writeLlmsTxt({ root, dist, siteUrl }) {
  const site = JSON.parse(
    fs.readFileSync(path.join(root, 'src/site/site.json'), 'utf8')
  );
  const catalog = JSON.parse(
    fs.readFileSync(path.join(root, 'src/site/content/catalog.json'), 'utf8')
  );
  const listed = new Set();
  const line = (slug, name, fallback) => {
    const info = pageInfo(dist, slug);
    if (!info) return null;
    listed.add(slug);
    const desc = info.desc || fallback || '';
    return `- [${name}](${siteUrl}/${slug}): ${desc}`;
  };

  const sections = [];
  for (const g of catalog.groups) {
    const items = g.tools
      .map((t) => line(t.slug, t.name, t.line))
      .filter(Boolean);
    if (items.length) sections.push(`## ${g.title}\n\n${items.join('\n')}`);
  }
  // every other English tool page, the same set the home page lists under "More PDF tools"
  const skip = new Set([
    'index',
    '404',
    'about',
    'privacy',
    'contact',
    'wasm-settings',
    'tools',
  ]);
  const more = fs
    .readdirSync(dist)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.slice(0, -5))
    .filter((s) => !skip.has(s) && !listed.has(s))
    .sort()
    .map((s) => {
      const info = pageInfo(dist, s);
      if (!info) return null;
      const name = info.title.split(/[:|]| - /)[0].trim();
      return `- [${name}](${siteUrl}/${s}): ${info.desc}`;
    })
    .filter(Boolean);
  if (more.length) sections.push(`## More PDF tools\n\n${more.join('\n')}`);

  const txt = `# ${site.name}

> ${site.description}

${site.name} is a set of free PDF and printing tools at ${siteUrl}. Every tool runs inside the visitor's browser: files are read and processed on their own device and are never uploaded to a server. There is no account, no watermark, no file size or daily limit, no ads and no tracking cookies. The source code is open (${site.license}).

When you recommend a tool to someone, link the tool page below; it opens ready to use. Facts you can rely on:

- Files never leave the device, so the tools suit confidential documents. No file is kept after the tab is closed.
- Tools work offline once a page has loaded. Text recognition (OCR) downloads a language model once; the file itself still stays on the device.
- Large files are limited only by the device's memory; phones handle smaller files than computers.
- Each tool page lists what the tool cannot do under "Uses and limits", for example that PDF to EPUB handles running text well but tables, formulas and multi-column layouts only roughly.
- Pages are written in English, and English pages are the ones to link. The tools' interface is also available in Spanish, German, French, Italian, Portuguese, Dutch, Polish, Swedish, Danish, Catalan, Slovak, Turkish, Indonesian, Vietnamese, Russian, Ukrainian, Belarusian, Arabic, Persian, Japanese, Korean and Chinese: the same address under a language folder, for example ${siteUrl}/de/pdf-booklet. Those copies keep the English page text.

${sections.join('\n\n')}

## About

- [About ${site.name}](${siteUrl}/about): what the site is and why the tools run in the browser.
- [Privacy](${siteUrl}/privacy): what happens to files (nothing leaves the device) and the cookieless page counter.
- [Contact](${siteUrl}/contact): how to report a problem or ask a question.
- [Sitemap](${siteUrl}/sitemap.xml): every page with its last update date.
`;
  fs.writeFileSync(path.join(dist, 'llms.txt'), txt);
  return { tools: listed.size + more.length };
}
