# Plyleaf site: how pages are built

## Our pages

Every Plyleaf page (home, section indexes, tool pages, About, Privacy, Contact) is rendered from one template by `scripts/site/build-pages.mjs`, the first step of `npm run build`.

- `src/site/site.json`: name, address, navigation, footer.
- `src/site/content/tools/<slug>.json` + `<slug>.html`: one tool page. The JSON holds the search title and description, H1, promise line, outline, related tools and update date; the HTML holds the instructions, example result, article and questions.
- `src/site/content/sections/*.json`: section indexes ("For printing", "For e-readers"); their tool lists come from `content/catalog.json`.
- `src/site/content/pages/*`: About, Privacy, Contact.
- `src/site/content/catalog.json`: the tool groups on the home page. Every BentoPDF tool page not listed there is added under "More PDF tools", so the home page links to every tool.
- `src/site/partials/work/<name>.html`: the work area of a tool; its script is `src/site/js/tools/<name>.ts`.
- Templates: `scripts/site/templates.mjs`. Styles: `src/site/css/` (tokens and components from DESIGN.md).

The generator writes `site-pages/*.html` (not committed). `vite.config.ts` adds them as build inputs, so a page with the same name as a BentoPDF page replaces it.

The build stops with an error when a page breaks a rule: title over 60 characters, description over 155, more or fewer than one H1, a link to a page that does not exist, an empty or broken anchor, an image without `alt` or size, a tool page missing one of the nine blocks (3–5 steps, 6–10 questions, 3–4 related tools), or the main query missing from the promise line.

Structured data is generated from the content: WebApplication, BreadcrumbList, FAQPage (from the questions) and HowTo (from the steps) on tool pages; CollectionPage with an ItemList on section indexes; WebSite and Organization on the home page.

## Languages

Our pages are English only. By the brief, a language gets search pages only after its own keyword research. Until then each language copy (`/de/pdf-booklet` and so on) is the English page with `noindex` and the canonical pointing to the English address, and no hreflang links (`scripts/site/i18n-hook.mjs`). BentoPDF's own translated pages keep their language versions and hreflang links.

## BentoPDF pages

BentoPDF's tool pages keep their markup. `src/css/plyleaf-legacy.css` remaps Tailwind's gray and indigo scales to the Plyleaf tokens, so they get the same light/dark theme, font and amber accent. Name and logo come from `VITE_BRAND_NAME` and `VITE_BRAND_LOGO` (`npm run build:plyleaf`).

Header and footer: `build-pages.mjs` writes `site-pages/partials/navbar.html`, `footer.html` and `footer-compact.html` from `site.json`. `vite.config.ts` lists `site-pages/partials` after `src/partials`, so these replace BentoPDF's partials of the same name: every page has the same header, footer and 1168px width, with no GitHub, Products or BentoPDF promo links. The upload area of tool pages is capped at 880px in `plyleaf-legacy.css`.

Dropped pages: `dropBentoPages` in `site.json` lists BentoPDF pages we do not publish (licensing, FAQ, terms, product promos, blog, hub pages). `vite.config.ts` removes them from the build inputs; a trailing `*` matches a prefix.

## Usage counter

`src/site/js/stats.ts` sends one beacon per page view and one per finished job (`plyleaf:done` event; BentoPDF's `downloadFile()` fires it too) to `/api/e`. The Pages Function `functions/api/e.ts` adds 1 to a daily total in the D1 database `plyleaf-stats` (day, kind, tool, language). No cookies, IP addresses, user agents or identifiers.

Read the numbers:

```bash
npx wrangler d1 execute plyleaf-stats --remote --command "SELECT tool, kind, SUM(n) AS n FROM counts GROUP BY tool, kind ORDER BY n DESC"
```

## Social cards

`node scripts/site/og-images.mjs` renders a 1200×630 card for every page into `public/images/og/` with headless Chrome. Run it after changing a page's H1 or promise line.
