// Builds Plyleaf's own pages (home, section indexes, tool pages, trust pages) from one template
// and per-page content files in src/site/content. Output: site-pages/*.html (generated, not committed),
// which vite.config.ts adds as build inputs, overriding BentoPDF pages with the same name.
// Also writes site-pages/_meta.json, read later by the i18n, sitemap and robots steps.
// Fails the build when a page breaks the template rules (nine blocks, lengths, links).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  esc,
  head,
  header,
  headerBar,
  footer,
  footerBar,
  toolPage,
  homePage,
  sectionPage,
  textPage,
} from './templates.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const SITE_DIR = path.join(ROOT, 'src/site');
const CONTENT = path.join(SITE_DIR, 'content');
const OUT = path.join(ROOT, 'site-pages');

const site = readJson(path.join(SITE_DIR, 'site.json'));
const SITE_URL = (process.env.SITE_URL || site.url).replace(/\/+$/, '');
const sprite = fs
  .readFileSync(path.join(SITE_DIR, 'partials/sprite.html'), 'utf8')
  .trim();

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const urlFor = (slug) =>
  slug === 'index' ? `${SITE_URL}/` : `${SITE_URL}/${slug}`;
const ogFor = (slug) => {
  const own = path.join(ROOT, 'public/images/og', `${slug}.png`);
  return `${SITE_URL}/images/og/${fs.existsSync(own) ? slug : 'default'}.png`;
};

const errors = [];
const fail = (page, msg) => errors.push(`${page}: ${msg}`);

// ---------- pages that exist after the build: ours + BentoPDF's ----------
const bentoPages = new Set(
  fs
    .readdirSync(path.join(ROOT, 'src/pages'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.slice(0, -5))
);
for (const f of fs.readdirSync(ROOT))
  if (f.endsWith('.html')) bentoPages.add(f.slice(0, -5));
const toolFiles = fs
  .readdirSync(path.join(CONTENT, 'tools'))
  .filter((f) => f.endsWith('.json'));
const sectionFiles = fs
  .readdirSync(path.join(CONTENT, 'sections'))
  .filter((f) => f.endsWith('.json'));
const textFiles = fs
  .readdirSync(path.join(CONTENT, 'pages'))
  .filter((f) => f.endsWith('.json'));
const ourSlugs = new Set([
  'index',
  ...[...toolFiles, ...sectionFiles, ...textFiles].map((f) => f.slice(0, -5)),
]);
const dropped = (slug) =>
  (site.dropBentoPages || []).some((d) =>
    d.endsWith('*') ? slug.startsWith(d.slice(0, -1)) : slug === d
  );
for (const s of [...bentoPages]) if (dropped(s)) bentoPages.delete(s);
const known = new Set([...bentoPages, ...ourSlugs]);
const hidden = new Set([
  '404',
  'wasm-settings',
  'index',
  'simple-index',
  'advertise',
  'kura',
  'hyper-compress',
]);

// ---------- catalog: home groups + automatic "more tools" ----------
const catalog = readJson(path.join(CONTENT, 'catalog.json'));
const enTools = readJson(path.join(ROOT, 'public/locales/en/tools.json'));
const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const groups = catalog.groups.map((g) => ({
  ...g,
  tools: g.tools.filter((t) => {
    if (!known.has(t.slug)) {
      console.warn(`   catalog: ${t.slug} has no page yet, not listed`);
      return false;
    }
    return true;
  }),
}));
const listed = new Set(groups.flatMap((g) => g.tools.map((t) => t.slug)));
const toolLike = [...bentoPages].filter(
  (s) =>
    fs.existsSync(path.join(ROOT, 'src/pages', `${s}.html`)) &&
    !listed.has(s) &&
    !hidden.has(s) &&
    !ourSlugs.has(s)
);
// BentoPDF names mix "Pdf to zip", "Compress pdf to 1mb": make them read like the rest
const SMALL = new Set([
  'a',
  'an',
  'and',
  'by',
  'for',
  'in',
  'of',
  'or',
  'to',
  'with',
]);
const tidyName = (n) =>
  n
    .split(' ')
    .map((w, i) =>
      /^pdf(\/a)?$/i.test(w)
        ? w.toUpperCase()
        : /^\d+(kb|mb)$/i.test(w)
          ? w.replace(/(kb|mb)$/i, (u) => ` ${u.toUpperCase()}`)
          : /^(txt|csv|json|xml|svg|rtf|odg|vsd|wpd|wps|bmp|cbz|png|tiff)$/i.test(
                w
              )
            ? w.toUpperCase()
            : i > 0 && SMALL.has(w.toLowerCase())
              ? w.toLowerCase()
              : w[0].toUpperCase() + w.slice(1)
    )
    .join(' ');
const more = toolLike
  .map((slug) => {
    const t = enTools[camel(slug)] || {};
    const name =
      t.name || slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    return { slug, name: tidyName(name), line: t.subtitle || '' };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const home = readJson(path.join(CONTENT, 'home.json'));
const homeGroups = [
  ...groups.filter((g) => g.home !== false),
  { id: 'g-more', title: home.moreTitle, icon: 'plus', tools: more },
];

// ---------- checks ----------
function checkMeta(name, p) {
  if (!p.title || p.title.length > 60)
    fail(name, `title must be 1 to 60 characters (${p.title?.length})`);
  if (!p.description || p.description.length > 155)
    fail(
      name,
      `description must be 1 to 155 characters (${p.description?.length})`
    );
}
function checkLinks(name, html) {
  const doc = new JSDOM(html).window.document;
  const ids = new Set([...doc.querySelectorAll('[id]')].map((e) => e.id));
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href === '#' || href === '')
      fail(name, `empty link “${a.textContent.trim()}”`);
    else if (href.startsWith('#')) {
      if (!ids.has(href.slice(1))) fail(name, `anchor ${href} has no target`);
    } else if (href.startsWith('/')) {
      // language switcher: /de/<slug> is the copy of /<slug>, made by i18n-ui.mjs
      const bare = a.hasAttribute('hreflang')
        ? href.replace(/^\/[a-z]{2}(-[A-Z]{2})?(?=\/|$)/, '')
        : href;
      const slug = bare.slice(1).split(/[?#]/)[0] || 'index';
      if (!known.has(slug)) fail(name, `link to missing page ${href}`);
    }
  }
  for (const img of doc.querySelectorAll('img')) {
    if (!img.hasAttribute('alt'))
      fail(name, `image without alt: ${img.getAttribute('src')}`);
    if (!img.getAttribute('width') || !img.getAttribute('height'))
      fail(name, `image without width/height: ${img.getAttribute('src')}`);
  }
  if (doc.querySelectorAll('h1').length !== 1)
    fail(name, 'must have exactly one h1');
  if ((html.match(/<title[\s>]/g) || []).length !== 1)
    fail(name, 'must have exactly one <title> (use aria-label on SVG figures)');
  if (/[\u2013\u2014]/.test(html))
    fail(name, 'contains an em or en dash (house style forbids them)');
  return doc;
}
// the nine blocks of a tool page, see DESIGN.md and the brief
function checkNineBlocks(name, t, doc) {
  const need = {
    'title and promise':
      doc.querySelector('h1') && doc.querySelector('.promise'),
    'work area': doc.querySelector('#tool'),
    instructions:
      doc.querySelectorAll('#how-to .step').length >= 3 &&
      doc.querySelectorAll('#how-to .step').length <= 5,
    'what you get': doc.querySelector('#result-example'),
    'how it works': doc.querySelector('#how-it-works'),
    'description and limits': doc.querySelector('#uses'),
    questions:
      doc.querySelectorAll('#faq details').length >= 6 &&
      doc.querySelectorAll('#faq details').length <= 10,
    'related tools':
      doc.querySelectorAll('#related a').length >= 3 &&
      doc.querySelectorAll('#related a').length <= 4,
    'update date': doc.querySelector('.updated time[datetime]'),
  };
  for (const [block, ok] of Object.entries(need))
    if (!ok) fail(name, `block missing or out of range: ${block}`);
  const lead = (t.promise || '').toLowerCase();
  if (t.mainQuery && !lead.includes(t.mainQuery.toLowerCase()))
    fail(name, `main query “${t.mainQuery}” is not in the first paragraph`);
  for (const o of t.outline)
    if (!doc.getElementById(o.id))
      fail(name, `outline points to missing #${o.id}`);
}

// ---------- structured data ----------
const org = {
  '@type': 'Organization',
  name: site.name,
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/images/plyleaf-touch.png`,
};
const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: urlFor(c.path === '/' ? 'index' : c.path.slice(1)),
  })),
});
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
function faqLd(doc) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [...doc.querySelectorAll('#faq details')].map((d) => ({
      '@type': 'Question',
      name: text(d.querySelector('summary')),
      acceptedAnswer: {
        '@type': 'Answer',
        text: text(d.querySelector('.answer')),
      },
    })),
  };
}
function howToLd(doc, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: text(doc.querySelector('#how-to h2')),
    step: [...doc.querySelectorAll('#how-to .step')].map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: text(s.querySelector('h3')),
      text: text(s.querySelector('p')),
      url: `${url}#how-to`,
    })),
  };
}

// ---------- BentoPDF tools inside our template ----------
// Takes the working part of a BentoPDF page (the tool card and its dialogs) and the scripts that
// drive it. Its own title, subtitle and "Back to Tools" button give way to our hero; the SEO
// blocks under it are replaced by ours. Class "btn" is renamed: ours would restyle its buttons.
function legacyTool(slug) {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/pages', `${slug}.html`),
    'utf8'
  );
  const body = src.slice(src.indexOf('{{> navbar }}') + '{{> navbar }}'.length);
  const endMarks = ['<!-- How It Works', '<section', '{{> footer }}']
    .map((m) => body.indexOf(m))
    .filter((i) => i >= 0);
  const part = body.slice(0, Math.min(...endMarks));
  const dom = new JSDOM(`<body>${part}</body>`);
  const d = dom.window.document;
  const card = d.getElementById('tool-uploader');
  if (!card) fail(slug, 'legacy page has no #tool-uploader');
  const h1 = card.querySelector('h1');
  const sub = h1?.nextElementSibling;
  if (sub && sub.tagName === 'P') sub.remove();
  h1?.remove();
  const back = d.getElementById('back-to-tools');
  if (back) back.hidden = true;
  const wrap = d.getElementById('uploader');
  if (wrap) wrap.className = 'legacy-uploader';
  card.classList.add('legacy-card');
  for (const el of d.querySelectorAll('.btn')) {
    el.classList.remove('btn');
    el.classList.add('legacy-btn');
  }
  const scripts = [
    ...src.matchAll(/<script type="module" src="([^"]+)"><\/script>/g),
  ]
    .map((m) => m[1])
    .filter((s) => !/full-width|simple-mode-footer|mobileMenu/.test(s));
  const styles = [
    ...src.matchAll(/<link href="(\/src\/css\/[^"]+\.css)" rel="stylesheet"/g),
  ].map((m) => m[1]);
  // Markup after the footer (the PDF editor's full-screen app, its dialogs) is kept as it is:
  // that app styles its own .btn and toggles it from script.
  const footAt = body.indexOf('{{> footer }}');
  const tail =
    footAt >= 0 && footAt >= Math.min(...endMarks)
      ? body
          .slice(footAt + '{{> footer }}'.length)
          .split('<script')[0]
          .trim()
      : '';
  // parse it on its own so stray closing tags (the end of BentoPDF's landing wrapper) are dropped
  const tailHtml = tail
    ? new JSDOM(`<body>${tail}</body>`).window.document.body.innerHTML
    : '';
  const html = `<section class="work legacy" id="tool">
${d.body.innerHTML.replace(/\{\{&gt;/g, '{{>')}
</section>${tailHtml ? `\n${tailHtml}` : ''}
${scripts.map((s) => `<script type="module" src="${s}"></script>`).join('\n')}`;
  return { html, styles };
}

// ---------- render ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const meta = {};
const page = (slug, data, body, current) => {
  const html =
    head(site, data) +
    header(site, sprite, current) +
    body +
    footer(site, slug);
  const doc = checkLinks(slug, html);
  fs.writeFileSync(path.join(OUT, `${slug}.html`), html);
  meta[slug] = { updated: data.updated, englishOnly: true };
  return doc;
};
const sections = Object.fromEntries(
  sectionFiles.map((f) => {
    const s = readJson(path.join(CONTENT, 'sections', f));
    return [s.slug, s];
  })
);
const homeCrumb = { name: 'Home', path: '/' };

// tool pages
for (const f of toolFiles) {
  const t = readJson(path.join(CONTENT, 'tools', f));
  const name = t.slug;
  checkMeta(name, t);
  // a tool may stand on its own (signature generator) or sit in a section
  const section = t.section ? sections[t.section] : null;
  if (t.section && !section) fail(name, `unknown section ${t.section}`);
  const breadcrumb = [
    homeCrumb,
    ...(section ? [{ name: section.crumb, path: `/${section.slug}` }] : []),
    { name: t.crumb, path: `/${t.slug}` },
  ];
  const url = urlFor(t.slug);
  const articleHtml = fs.readFileSync(
    path.join(CONTENT, 'tools', `${t.slug}.html`),
    'utf8'
  );
  // "legacy": the working tool is BentoPDF's own (src/pages/<slug>.html), placed in our template
  const legacy =
    t.workArea === 'legacy' ? legacyTool(t.legacySource || t.slug) : null;
  const workHtml = legacy
    ? legacy.html
    : fs.readFileSync(
        path.join(SITE_DIR, 'partials/work', `${t.workArea}.html`),
        'utf8'
      );
  for (const r of t.related)
    if (!known.has(r.slug)) fail(name, `related tool ${r.slug} has no page`);
  const probe = new JSDOM(articleHtml).window.document;
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: t.app.name,
      url,
      description: t.description,
      applicationCategory: t.app.category,
      operatingSystem: 'Any (runs in a web browser)',
      browserRequirements: 'Requires JavaScript and a modern browser',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: t.app.featureList,
      dateModified: t.updated,
      publisher: org,
    },
    breadcrumbLd(breadcrumb),
    faqLd(probe),
    howToLd(probe, url),
  ];
  const doc = page(
    t.slug,
    {
      ...t,
      url,
      ogImage: ogFor(t.slug),
      jsonLd: ld,
      styles: legacy?.styles,
    },
    toolPage({ ...t, breadcrumb, articleHtml, workHtml }),
    t.section ? `/${t.section}` : null
  );
  checkNineBlocks(name, t, doc);
  meta[t.slug].section = t.section || null;
  meta[t.slug].kind = 'tool';
}

// section indexes
for (const s of Object.values(sections)) {
  checkMeta(s.slug, s);
  const group = groups.find((g) => g.id === s.groupId);
  if (!group || group.tools.length === 0)
    fail(s.slug, `group ${s.groupId} is empty`);
  const breadcrumb = [homeCrumb, { name: s.crumb, path: `/${s.slug}` }];
  const url = urlFor(s.slug);
  page(
    s.slug,
    {
      ...s,
      url,
      ogImage: ogFor(s.slug),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: s.h1,
          url,
          description: s.description,
          dateModified: s.updated,
          mainEntity: {
            '@type': 'ItemList',
            itemListElement: (group?.tools || []).map((t, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: t.name,
              url: urlFor(t.slug),
            })),
          },
        },
        breadcrumbLd(breadcrumb),
      ],
    },
    sectionPage({ ...s, breadcrumb }, group || { tools: [] }),
    `/${s.slug}`
  );
  meta[s.slug].kind = 'section';
}

// trust pages
for (const f of textFiles) {
  const p = readJson(path.join(CONTENT, 'pages', f));
  checkMeta(p.slug, p);
  const breadcrumb = [homeCrumb, { name: p.h1, path: `/${p.slug}` }];
  const bodyHtml = fs.readFileSync(
    path.join(CONTENT, 'pages', `${p.slug}.html`),
    'utf8'
  );
  page(
    p.slug,
    {
      ...p,
      url: urlFor(p.slug),
      ogImage: ogFor(p.slug),
      jsonLd: [breadcrumbLd(breadcrumb)],
    },
    textPage({ ...p, breadcrumb, bodyHtml }),
    `/${p.slug}`
  );
  meta[p.slug].kind = 'page';
}

// home
checkMeta('index', home);
page(
  'index',
  {
    ...home,
    url: urlFor('index'),
    ogImage: ogFor('index'),
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: site.name,
        url: `${SITE_URL}/`,
        description: home.description,
        publisher: org,
      },
      { '@context': 'https://schema.org', ...org },
    ],
  },
  homePage(home, homeGroups),
  '/'
);
meta.index.kind = 'home';

// our header and footer replace BentoPDF's navbar and footer partials on its tool pages
// (vite.config.ts registers site-pages/partials after src/partials, so these win)
fs.mkdirSync(path.join(OUT, 'partials'), { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'partials/navbar.html'),
  `<script src="/plyleaf-theme.js"></script>\n${sprite}${headerBar(site, '', { skipLink: false })}\n`
);
fs.writeFileSync(
  path.join(OUT, 'partials/footer.html'),
  `${footerBar(site)}\n`
);
// full-screen apps (multi-tool, workflow) use a one-line footer: same links, nothing else
const compactLinks = site.footer
  .at(-1)
  .links.map((l) => `<a href="${l.href}">${l.label}</a>`)
  .join('\n    ');
fs.writeFileSync(
  path.join(OUT, 'partials/footer-compact.html'),
  `{{#unless simpleMode}}
<footer class="site-footer-compact">
  <nav aria-label="Site links">
    <a href="/">${site.name}</a>
    ${compactLinks}
  </nav>
</footer>
{{/unless}}
`
);

fs.writeFileSync(
  path.join(OUT, '_meta.json'),
  JSON.stringify({ siteUrl: SITE_URL, pages: meta }, null, 2)
);

if (errors.length) {
  console.error(
    `✖ Plyleaf pages: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`
  );
  process.exit(1);
}
console.log(
  `✔ Plyleaf pages: ${Object.keys(meta).length} built (${toolFiles.length} tool, ${sectionFiles.length} section, ${textFiles.length} text, home lists ${listed.size + more.length} tools) → site-pages/`
);
export { esc };
