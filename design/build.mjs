// Builds the static design prototypes: node design/build.mjs
// src/*.html shells + shared partials -> design/site/*.html (full pages)
// and design/site/_artifact-index.html (the foundation page without <html>/<head>, for previewing as an artifact).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const out = path.join(dir, 'site');
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
for (const f of ['plyleaf.css', 'plyleaf.js'])
  fs.copyFileSync(path.join(dir, 'assets', f), path.join(out, 'assets', f));

const parts = {
  SPRITE: src('sprite.html'),
  HEADER: src('header.html'),
  FOOTER: src('footer.html'),
  TOOL: src('booklet-tool.html'),
  ARTICLE: src('booklet-article.html'),
  TOOLS: src('home-tools.html'),
};
const pages = {
  'foundation.html': {
    shell: 'foundation.html',
    home: 'home-a.html',
    tool: 'tool-a.html',
  },
  'tool-a.html': {
    shell: 'tool-a.html',
    home: 'home-a.html',
    tool: 'tool-a.html',
  },
  'tool-b.html': {
    shell: 'tool-b.html',
    home: 'home-b.html',
    tool: 'tool-b.html',
  },
  'home-a.html': {
    shell: 'home-a.html',
    home: 'home-a.html',
    tool: 'tool-a.html',
  },
  'home-b.html': {
    shell: 'home-b.html',
    home: 'home-b.html',
    tool: 'tool-b.html',
  },
};
const fill = (html, p) =>
  html
    .replace(
      /\{\{(SPRITE|HEADER|FOOTER|TOOL|ARTICLE|TOOLS)\}\}/g,
      (_, k) => parts[k]
    )
    .replace(/\{\{home\}\}/g, p.home)
    .replace(/\{\{tool\}\}/g, p.tool);

for (const [name, p] of Object.entries(pages)) {
  let html = fill(src(p.shell), p);
  html = fill(html, p); // partials may contain {{home}}
  if (/\{\{/.test(html)) throw new Error(`unfilled placeholder in ${name}`);
  fs.writeFileSync(path.join(out, name), html);
}
fs.copyFileSync(
  path.join(out, 'foundation.html'),
  path.join(out, 'index.html')
);

// artifact root: same foundation page, head contents moved to the top, no html/head/body wrappers
const f = fs.readFileSync(path.join(out, 'foundation.html'), 'utf8');
const head = f
  .match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = f.match(/<body>([\s\S]*?)<\/body>/)[1];
fs.writeFileSync(
  path.join(out, '_artifact-index.html'),
  head.replace(
    '<title>',
    '<meta name="claude:viewport-fit-sides" content="cover">\n<title>'
  ) + body
);
console.log('built', Object.keys(pages).join(', '));
