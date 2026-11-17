import { UI_LANGS } from './i18n-ui.mjs';

// Plyleaf page templates. Pure functions: data in, HTML string out.
// Every page shares head(), header() and footer(); page bodies are toolPage(), sectionPage(), homePage(), textPage().

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const icon = (id, cls = 'i') =>
  `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}" /></svg>`;

export const longDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

export function head(site, page) {
  const url = page.url;
  const og = page.ogImage;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <meta name="robots" content="${page.robots || 'index, follow, max-image-preview:large, max-snippet:-1'}" />
    <link rel="canonical" href="${esc(url)}" />
${site.verification?.google ? `    <meta name="google-site-verification" content="${esc(site.verification.google)}" />\n` : ''}    <meta name="plyleaf:content" content="en" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${esc(site.name)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:image" content="${esc(og)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(page.ogAlt || page.h1)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="${esc(url)}" />
    <meta name="twitter:title" content="${esc(page.title)}" />
    <meta name="twitter:description" content="${esc(page.description)}" />
    <meta name="twitter:image" content="${esc(og)}" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#1c1a17" media="(prefers-color-scheme: dark)" />
    <link rel="icon" href="/images/plyleaf-mark.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/images/plyleaf-touch.png" />
    <script src="/plyleaf-theme.js"></script>${(page.styles || []).map((h) => `\n    <link rel="stylesheet" href="${h}" />`).join('')}
    <link rel="stylesheet" href="/src/site/css/plyleaf.css" />
    <script type="module" src="/src/site/js/site.ts"></script>${page.script ? `\n    <script type="module" src="${page.script}"></script>` : ''}
    ${page.jsonLd.map(jsonLd).join('\n    ')}
  </head>`;
}

/** The header bar alone; also used as the navbar partial on BentoPDF's pages. */
export function headerBar(site, current, { skipLink = true } = {}) {
  const nav = site.nav
    .map(
      (n) =>
        `<a href="${n.href}"${n.wide ? ' class="nav-hide"' : ''}${n.href === current ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`
    )
    .join('\n        ');
  return `${skipLink ? '\n    <a class="visually-hidden" href="#main">Skip to content</a>' : ''}
    <header class="site-header">
      <div class="wrap">
        <a class="brand" href="/"><svg class="brand-mark" aria-hidden="true"><use href="#i-mark" /></svg>${esc(site.name)}</a>
        <nav class="nav" aria-label="Main">
        ${nav}
        <button class="theme-toggle" type="button" id="theme-toggle" aria-label="Switch to dark theme">${icon('moon', 'i i-sm')}</button>
        </nav>
      </div>
    </header>`;
}

export function header(site, sprite, current) {
  return `
  <body>
    ${sprite}${headerBar(site, current)}`;
}

/** Links to this page in every interface language (the copies are noindex, see i18n-ui.mjs). */
function langLinks(slug) {
  const p = slug === 'index' ? '' : slug;
  return Object.entries(UI_LANGS)
    .map(([code, name]) => {
      const href = code === 'en' ? `/${p}` : `/${code}/${p}`;
      return `<a href="${href}" hreflang="${code}" lang="${code}" translate="no"${code === 'en' ? ' aria-current="true"' : ''}>${esc(name)}</a>`;
    })
    .join('\n          ');
}

/** The footer alone; also used as the footer partial on BentoPDF's pages (no slug: no language links). */
export function footerBar(site, slug) {
  const cols = site.footer
    .map(
      (c) => `
      <div>
        <h3>${esc(c.title)}</h3>
        <ul>
          ${c.links.map((l) => `<li><a href="${l.href}">${esc(l.label)}</a></li>`).join('\n          ')}
        </ul>
      </div>`
    )
    .join('');
  return `
    <footer class="site-footer">
      <div class="wrap">
        <div class="about">
          <a class="brand" href="/"><svg class="brand-mark" aria-hidden="true"><use href="#i-mark" /></svg>${esc(site.name)}</a>
          <p class="footer-line">${esc(site.description)}</p>
        </div>${cols}
      </div>${
        slug
          ? `
      <div class="wrap langs-row">
        <nav class="langs" aria-label="Languages">
          ${langLinks(slug)}
        </nav>
      </div>`
          : ''
      }
    </footer>`;
}

export function footer(site, slug) {
  return `${footerBar(site, slug)}
  </body>
</html>
`;
}

const crumbs = (items) => `
          <ol class="crumbs" aria-label="Breadcrumb">
            ${items
              .map((c, i) =>
                i === items.length - 1
                  ? `<li aria-current="page">${esc(c.name)}</li>`
                  : `<li><a href="${c.path}">${esc(c.name)}</a></li>`
              )
              .join('\n            ')}
          </ol>`;

export const updatedBlock = (iso, note) => `
<p class="updated block-updated">
  <span>Updated <time datetime="${iso}">${longDate(iso)}</time></span>${note ? `<span>${esc(note)}</span>` : ''}
</p>`;

export function relatedBlock(items) {
  return `
<section class="block" id="related" aria-labelledby="h-related">
  <h2 id="h-related" class="block-title">Often needed next</h2>
  <div class="related">
    ${items
      .map(
        (r) =>
          `<a href="/${r.slug}"><span class="rel-icon">${icon(r.icon || 'file')}</span><span><span class="rel-name">${esc(r.name)}</span><br /><span class="rel-why">${esc(r.why)}</span></span>${icon('arrow', 'i i-arrow')}</a>`
      )
      .join('\n    ')}
  </div>
</section>`;
}

export function toolPage(t) {
  const facts = (t.facts || [])
    .map(
      (f, i) =>
        `<span class="badge${i === 0 ? ' badge-ok' : ''}">${icon(i === 0 ? 'device' : 'check')}${esc(f)}</span>`
    )
    .join('\n            ');
  const toc = t.outline
    .map((o) => `<li><a href="#${o.id}">${esc(o.label)}</a></li>`)
    .join('\n              ');
  return `
    <main id="main">
      <div class="wrap">
        <section class="hero-a">${crumbs(t.breadcrumb)}
          <h1>${esc(t.h1)}</h1>
          <p class="promise">${esc(t.promise)}</p>
          <div class="facts">
            ${facts}
          </div>
        </section>
        <div class="tool-a">
${t.workHtml}
        </div>
        <div class="doc-a">
          <nav class="toc" aria-label="On this page">
            <p>On this page</p>
            <ol>
              ${toc}
            </ol>
          </nav>
          <div class="content">
${t.articleHtml}
${relatedBlock(t.related)}
${updatedBlock(t.updated, t.updatedNote)}
          </div>
        </div>
      </div>
    </main>`;
}

export function toolList(group, { heading = 'h2', withIcon = true } = {}) {
  return `
  <section class="group" data-group id="${group.id}">
    <${heading}>${withIcon ? icon(group.icon) : ''}${
      group.section
        ? `<a href="/${group.section}">${esc(group.title)}</a>`
        : esc(group.title)
    }</${heading}>
    <ul>
      ${group.tools
        .map(
          (t) =>
            `<li data-tool><a href="/${t.slug}"${group.id === 'g-more' && t.line ? ` title="${esc(t.line)}"` : ''}><b>${esc(t.name)}</b><span>${esc(t.line)}</span></a></li>`
        )
        .join('\n      ')}
    </ul>
  </section>`;
}

export function homePage(h, groups) {
  return `
    <main id="main">
      <div class="wrap">
        <section class="home-hero">
          <h1>${esc(h.h1)}</h1>
          <p>${esc(h.lede)}</p>
          <div class="search" role="search">
            ${icon('search')}
            <label class="visually-hidden" for="tool-search">Find a tool</label>
            <input class="input" id="tool-search" type="search" placeholder="Find a tool: booklet, merge, sign…" autocomplete="off" />
          </div>
          <div class="proof">
            ${h.proof.map((p, i) => `<span>${icon(i === 0 ? 'device' : 'check')}${esc(p)}</span>`).join('')}
          </div>
        </section>
        <div class="groups">${groups.map((g) => toolList(g)).join('')}
        </div>
        <p class="search-empty" id="search-empty" hidden>No tool matches. Try a shorter word, like “merge” or “sign”.</p>
        <section class="why" aria-label="Why it is free and private">
          ${h.why.map((w) => `<div><h2>${esc(w.title)}</h2><p>${esc(w.text)}</p></div>`).join('\n          ')}
        </section>
      </div>
    </main>`;
}

export function sectionPage(s, group) {
  return `
    <main id="main">
      <div class="wrap">
        <section class="hero-a">${crumbs(s.breadcrumb)}
          <h1>${esc(s.h1)}</h1>
          <p class="promise">${esc(s.intro)}</p>
        </section>
        <div class="section-list">
          <ul>
            ${group.tools
              .map(
                (t) =>
                  `<li><a href="/${t.slug}"><b>${esc(t.name)}</b><span>${esc(t.line)}</span>${icon('arrow', 'i i-arrow')}</a></li>`
              )
              .join('\n            ')}
          </ul>
        </div>
        <div class="section-foot">${updatedBlock(s.updated)}</div>
      </div>
    </main>`;
}

export function textPage(p) {
  return `
    <main id="main">
      <div class="wrap">
        <section class="hero-a">${crumbs(p.breadcrumb)}
          <h1>${esc(p.h1)}</h1>
          <p class="promise">${esc(p.promise)}</p>
        </section>
        <div class="text-page prose">
${p.bodyHtml}
        </div>
        <div class="section-foot">${updatedBlock(p.updated)}</div>
      </div>
    </main>`;
}
