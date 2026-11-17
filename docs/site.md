# Plyleaf site: how pages are built

## Our pages

Every Plyleaf page (home, section indexes, tool pages, About, Privacy, Contact) is rendered from one template by `scripts/site/build-pages.mjs`, the first step of `npm run build`.

- `src/site/site.json`: name, address, navigation, footer.
- `src/site/content/tools/<slug>.json` + `<slug>.html`: one tool page. `section` is optional: a tool without one (the signature generator) has only Home in its breadcrumbs. The JSON holds the search title and description, H1, promise line, outline, related tools and update date; the HTML holds the instructions, example result, article and questions.
- `src/site/content/sections/*.json`: section indexes ("For printing", "For e-readers"); their tool lists come from `content/catalog.json`.
- `src/site/content/pages/*`: About, Privacy, Contact.
- `src/site/content/catalog.json`: the tool groups on the home page. Every BentoPDF tool page not listed there is added under "More PDF tools", so the home page links to every tool.
- `src/site/partials/work/<name>.html`: the work area of a tool; its script is `src/site/js/tools/<name>.ts`.
- Templates: `scripts/site/templates.mjs`. Styles: `src/site/css/` (tokens and components from DESIGN.md).

The generator writes `site-pages/*.html` (not committed). `vite.config.ts` adds them as build inputs, so a page with the same name as a BentoPDF page replaces it.

The build stops with an error when a page breaks a rule: title over 60 characters, description over 155, more or fewer than one H1, a link to a page that does not exist, an empty or broken anchor, an image without `alt` or size, a tool page missing one of the nine blocks (3–5 steps, 6–10 questions, 3–4 related tools), or the main query missing from the promise line.

Structured data is generated from the content: WebApplication, BreadcrumbList, FAQPage (from the questions) and HowTo (from the steps) on tool pages; CollectionPage with an ItemList on section indexes; WebSite and Organization on the home page.

## Languages

Pages are written in English, and only English pages are for search. By the brief, a language gets search pages only after its own keyword research for that country; until then a language gets an interface translation only.

- **Interface languages** (no page ever says the interface is machine-translated or unchecked): German, French, Italian, Portuguese, Turkish, Indonesian, Vietnamese, Russian, Korean, Chinese (simplified and traditional), Spanish, Japanese, Dutch, Polish, Ukrainian, Swedish, Danish, Catalan, Slovak, Belarusian, Arabic and Persian (right to left). Text drawn on printed sheets stays English for Chinese, Japanese, Korean, Arabic and Persian: the print font has no glyphs for them. Dictionaries: `src/site/i18n/<lang>.json`, keyed by the English text; counted phrases hold plural forms (`one`, `few`, `many`, `other`).
- **What is translated:** the header, the footer, the working tool (its markup and the messages its script shows, via `t()`/`tn()` in `src/site/js/i18n.ts`), and text drawn on printed sheets (`tp()`/`tpn()`; Chinese and Korean keep English there because the print font has no CJK glyphs). The page text (hero, guide, FAQ) stays English and is marked `lang="en"`. Bingo theme word lists are English.
- **Build:** `scripts/site/i18n-ui.mjs` turns each English page into `/<lang>/<slug>`: translates the interface, adds the note, puts the script strings into a JSON block (`#pl-i18n`, no inline script for the CSP), keeps links inside the language. The footer links every page to its language copies.
- **Search markup:** every `/<lang>/` page is `noindex, follow` with a self canonical; no page carries hreflang; the sitemap lists English pages only (`scripts/apply-indexing-policy.mjs`, `scripts/generate-sitemap.mjs`). BentoPDF's own translated pages follow the same rule.
- **Adding or changing text:** after editing a partial or a script string, run `node scripts/site/i18n-ui.mjs --keys` (writes `src/site/i18n/_keys.json` and shows what each language is missing; `--missing` lists the strings). Missing strings fall back to English.

## AI assistants

`dist/llms.txt` (built by `scripts/site/llms.mjs` from the catalog and each page's title and description) describes the site and lists every English tool page. `robots.txt` welcomes search and AI crawlers by name and points to it.

## BentoPDF pages

BentoPDF's tool pages keep their markup. `src/css/plyleaf-legacy.css` remaps Tailwind's gray and indigo scales to the Plyleaf tokens, so they get the same light/dark theme, font and amber accent. Name and logo come from `VITE_BRAND_NAME` and `VITE_BRAND_LOGO` (`npm run build:plyleaf`).

Header and footer: `build-pages.mjs` writes `site-pages/partials/navbar.html`, `footer.html` and `footer-compact.html` from `site.json`. `vite.config.ts` lists `site-pages/partials` after `src/partials`, so these replace BentoPDF's partials of the same name: every page has the same header, footer and 1168px width, with no GitHub, Products or BentoPDF promo links. The upload area of tool pages is capped at 880px in `plyleaf-legacy.css`.

Dropped pages: `dropBentoPages` in `site.json` lists BentoPDF pages we do not publish (licensing, FAQ, terms, product promos, blog, hub pages). `vite.config.ts` removes them from the build inputs; a trailing `*` matches a prefix.

## Printing generators

The printer test page, graph paper, bingo cards and name tracing worksheets make their sheets in the browser instead of reading a file. They share three modules in `src/site/js/print/`:

- `sheet.ts`: a page is a list of drawing operations (paths, rectangles, circles, text) in PDF points. The same list becomes the preview (SVG), the print (the same SVG at real size in millimetres, with an `@page` rule per sheet size) and the PDF (pdf-lib, loaded on first download). Colours written as `cmyk(...)` stay CMYK in the PDF. Text uses Liberation Sans from `public/pdfjs-viewer/standard_fonts`, measured with the same font in the preview, so what fits on screen fits on paper.
- `gen.ts`: the work area controller: reads the form (`#gen-form`), redraws the preview on every change, Print and Download PDF buttons, the `plyleaf:done` event, and the paper default (Letter for the US, Canada, Mexico and a few others, A4 elsewhere).
- `test-sheets.ts`: the four test sheets. `duplexSheets()` is also used by the booklet maker's "two-sided test sheet" link, on the booklet's own paper size.

Tool scripts: `src/site/js/tools/printer-test.ts`, `graph-paper.ts`, `bingo.ts` (ready word lists in `print/bingo-themes.ts`; `CARD_LIMIT` caps the cards per set and is `null`, off), `tracing.ts` (letters from `print/hershey.json`, see docs/licenses.md; print letters are reordered into the stroke order children are taught). Styles: `src/site/css/print-tools.css`.

## PDF to EPUB

`/pdf-to-epub` turns a PDF book into a reflowable EPUB in the browser. Modules in `src/site/js/epub/`:

- `extract.ts`: reads every page with pdf.js into lines (baseline, size, bold and italic from the font name, raised small digits as footnote markers), cuts out pictures (raster images and larger vector drawings; clip paths and white fills are ignored) and reads bookmarks, title, author and language. Pages with no text and a page-sized image are marked for OCR; `recognizePages()` renders them at about 250 dpi, recognises them with Tesseract (`ocr.ts`, model downloaded once for the chosen language) and finds pictures between the recognised lines. Pages are rendered with the `print` intent: the default display intent waits for `requestAnimationFrame` and stalls in a background tab.
- `structure.ts`: removes running heads and page numbers (lines repeated at the top or bottom of pages, page number patterns, small lone lines far from the text, lines equal to the book or a chapter title), moves footnotes (a run of small lines at the page bottom starting with a marker) to the chapter end and links the markers, joins lines into paragraphs (spacing, indent, short last line, across pages), undoes hyphenation, and finds chapters from bookmarks or from heading sizes (sizes within 7% are one style, for OCR), or every 20 pages.
- `build.ts`: EPUB 3 with nav and an EPUB 2 `toc.ncx`, cover from page 1, footnotes as `aside epub:type="footnote"`. `chapterBody()` is also the preview.

Work area: `src/site/partials/work/pdf-to-epub.html`, `src/site/js/tools/pdf-to-epub.ts`, `src/site/css/epub-tool.css`. The sample book `public/samples/plyleaf-sample-book.pdf` is our own short story typeset in Chrome.

Tested on generated books (Times and Liberation, Russian, Chrome-typeset with Georgia, 268 pages, with and without bookmarks, and a scanned copy): every paragraph matched the source exactly for text PDFs and 55 of 56 nearly exactly for the scan; 268 pages read in 3 to 8 seconds, OCR about 2 seconds a page on an M-series Mac.

## Usage counter

`src/site/js/stats.ts` sends one beacon per page view and one per finished job (`plyleaf:done` event; BentoPDF's `downloadFile()` fires it too) to `/api/e`. The Pages Function `functions/api/e.ts` adds 1 to a daily total in the D1 database `plyleaf-stats` (day, kind, tool, language). No cookies, IP addresses, user agents or identifiers.

Read the numbers:

```bash
npx wrangler d1 execute plyleaf-stats --remote --command "SELECT tool, kind, SUM(n) AS n FROM counts GROUP BY tool, kind ORDER BY n DESC"
```

## Social cards

`node scripts/site/og-images.mjs` renders a 1200×630 card for every page into `public/images/og/` with headless Chrome. Run it after changing a page's H1 or promise line.
