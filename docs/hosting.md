# Hosting on Cloudflare Pages

## Deploy

```bash
SITE_URL=https://plyleaf.com npm run build:plyleaf
npx wrangler pages deploy --project-name plyleaf --branch main
```

`wrangler.toml` points Wrangler at `dist/` and binds the D1 database `plyleaf-stats` (usage counter) as `STATS`. The Pages Function in `functions/api/e.ts` is deployed with the site.

While `SITE_URL` is not the final domain, `scripts/apply-indexing-policy.mjs` marks every page `noindex`. On the real domain, build with `SITE_URL=https://<domain> ALLOW_INDEXING=true`.

## Domain

`plyleaf.com` is a Cloudflare zone (Free plan, nameservers `lola.ns.cloudflare.com` and `ray.ns.cloudflare.com`) attached to the Pages project as custom domains `plyleaf.com` and `www.plyleaf.com` (DNS: proxied CNAME records for `@` and `www` to `plyleaf.pages.dev`). A redirect rule in the zone sends `www.plyleaf.com/*` to `plyleaf.com` with a 301, keeping the query string. `plyleaf.pages.dev` stays as the project's own address; its pages carry the `plyleaf.com` canonical. The domain is registered outside Cloudflare, so nameserver changes are made at the registrar.

## Headers

`scripts/generate-security-headers.mjs` writes `dist/_headers`: the content security policy plus the page-isolation headers `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. Without them the browser refuses `SharedArrayBuffer`, and the office-document converter (LibreOffice) does not start. `scripts/site/finalize.mjs` adds long caching for `/assets/*`.

## File size limit

Cloudflare Pages accepts files up to 25 MiB. Two LibreOffice files are larger (`soffice.wasm.gz` 49 MB, `soffice.data.gz` 29 MB). `scripts/site/finalize.mjs` splits every file over the limit into `<name>.part0`, `.part1`, … and `<name>.parts` (the count). `src/js/utils/libreoffice-loader.ts` first asks for the whole file and, if it is missing, downloads the parts and joins them. Other hosts that serve the whole file keep working unchanged.

## Processing modules from the CDN

PyMuPDF, Ghostscript and CoherentPDF are loaded from jsDelivr by default (`VITE_WASM_*_URL`), Tesseract language data too. They are allowed by the CSP and work under `credentialless` isolation because jsDelivr sends `Access-Control-Allow-Origin: *`.

Fallback if jsDelivr is blocked or slow in a region: copy the packages into the site and point the variables at them (`VITE_WASM_PYMUPDF_URL=/wasm/pymupdf/` and so on), as the BentoPDF air-gap bundle does (`bentopdf-airgap-bundle/`). Files over 25 MiB are split by the same build step; the loaders for these modules would need the same parts fallback as LibreOffice.
