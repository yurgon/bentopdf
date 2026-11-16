// Plyleaf pages are written in English only. By the brief, a language gets pages for search only after
// its own keyword research; until then a language copy is the English page, marked noindex, with the
// canonical pointing to the English URL and no hreflang links. The copies exist so that links from
// translated BentoPDF pages (/de/pdf-booklet and so on) do not lead to a 404.
import fs from 'node:fs';
import path from 'node:path';

const MARK = /<meta\s+name="plyleaf:content"\s+content="en"\s*\/?>/i;
const ROBOTS = /<meta\s+name="robots"[^>]*>/i;

const REDIRECT = /<script[^>]*data-language-redirect[^>]*><\/script>\s*/i;

export const isPlyleafPage = (html) => MARK.test(html);

// No automatic jump to a language copy: until a language has its own pages, the copy is the same English page.
export const withoutLanguageRedirect = (html) => html.replace(REDIRECT, '');

export function writeEnglishOnlyCopy(html, file, langDir) {
  const out = withoutLanguageRedirect(html).replace(
    ROBOTS,
    '<meta name="robots" content="noindex, follow" />'
  );
  fs.mkdirSync(langDir, { recursive: true });
  fs.writeFileSync(path.join(langDir, file), out);
}
