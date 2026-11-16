// Renders social-preview cards (1200×630 PNG) for every Plyleaf page with headless Chrome:
//   node scripts/site/og-images.mjs
// Output goes to public/images/og/<slug>.png (committed). Also writes the 180×180 touch icon.
// Run it after changing a page's h1 or promise. Needs Google Chrome installed (macOS path below or CHROME env).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const CONTENT = path.join(ROOT, 'src/site/content');
const OUT = path.join(ROOT, 'public/images/og');
const CHROME =
  process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const site = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/site/site.json'), 'utf8')
);
const font = (w) =>
  path.join(
    ROOT,
    `node_modules/@fontsource/hanken-grotesk/files/hanken-grotesk-latin-${w}-normal.woff2`
  );
const mark = fs
  .readFileSync(path.join(ROOT, 'public/images/plyleaf-mark.svg'), 'utf8')
  .replace(/<style>[\s\S]*?<\/style>/, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const read = (dir) =>
  fs
    .readdirSync(path.join(CONTENT, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) =>
      JSON.parse(fs.readFileSync(path.join(CONTENT, dir, f), 'utf8'))
    );
const home = JSON.parse(
  fs.readFileSync(path.join(CONTENT, 'home.json'), 'utf8')
);
const cards = [
  {
    slug: 'default',
    h1: 'Free PDF tools that never upload your files',
    line: site.description,
  },
  { slug: 'index', h1: home.h1, line: home.lede },
  ...read('tools').map((t) => ({ slug: t.slug, h1: t.h1, line: t.promise })),
  ...read('sections').map((s) => ({
    slug: s.slug,
    h1: s.h1,
    line: s.intro.split('. ')[0] + '.',
  })),
  ...read('pages').map((p) => ({ slug: p.slug, h1: p.h1, line: p.promise })),
];

const css = `
@font-face{font-family:H;src:url(file://${font(400)});font-weight:400}
@font-face{font-family:H;src:url(file://${font(600)});font-weight:600}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{font-family:H;background:#fff;color:#2b2621;display:flex;flex-direction:column;justify-content:space-between;padding:72px 80px;box-sizing:border-box}
.brand{display:flex;align-items:center;gap:14px;font-weight:600;font-size:30px}
.brand svg{width:44px;height:44px}
.brand svg rect,.brand svg path:first-of-type{stroke:#2b2621}
h1{font-weight:600;font-size:76px;line-height:1.04;letter-spacing:-0.03em;margin:0;max-width:16ch}
p{font-size:30px;line-height:1.4;color:#5b544c;margin:24px 0 0;max-width:40ch}
.foot{display:flex;gap:28px;font-size:24px;color:#5b544c}
.foot b{color:#8a5a00;font-weight:600}
.bar{position:absolute;left:0;right:0;bottom:0;height:12px;background:#f2b631}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plyleaf-og-'));
const shoot = (html, file, w, h) => {
  const src = path.join(tmp, 'card.html');
  fs.writeFileSync(src, html);
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${w},${h}`,
      `--screenshot=${file}`,
      `file://${src}`,
    ],
    { stdio: 'ignore' }
  );
};
fs.mkdirSync(OUT, { recursive: true });
for (const c of cards) {
  shoot(
    `<!doctype html><meta charset="utf-8"><style>${css}</style>
<div class="brand">${mark}${esc(site.name)}</div>
<div><h1>${esc(c.h1)}</h1><p>${esc(c.line)}</p></div>
<div class="foot"><b>Free</b><span>Files stay on your device</span><span>No account</span></div><div class="bar"></div>`,
    path.join(OUT, `${c.slug}.png`),
    1200,
    630
  );
  console.log('og', c.slug);
}
shoot(
  `<!doctype html><style>html,body{margin:0;width:180px;height:180px;background:#fff;display:grid;place-items:center}svg{width:120px;height:120px}svg rect,svg path:first-of-type{stroke:#2b2621}</style>${mark}`,
  path.join(ROOT, 'public/images/plyleaf-touch.png'),
  180,
  180
);
console.log('touch icon');
fs.rmSync(tmp, { recursive: true, force: true });
