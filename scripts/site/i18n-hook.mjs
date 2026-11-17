// Plyleaf pages are written in English. By the brief, a language gets pages for search only after
// its own keyword research; until then a language copy keeps the English page text, translates
// the interface where we have a dictionary (scripts/site/i18n-ui.mjs), and is noindex with a
// self canonical and no hreflang. Copies also keep links from translated BentoPDF pages
// (/de/pdf-booklet and so on) from leading to a 404.
import fs from 'node:fs';
import path from 'node:path';
import { languageCopy } from './i18n-ui.mjs';

const MARK = /<meta\s+name="plyleaf:content"\s+content="en"\s*\/?>/i;
const REDIRECT = /<script[^>]*data-language-redirect[^>]*><\/script>\s*/i;

export const isPlyleafPage = (html) => MARK.test(html);

// No automatic jump to a language copy: the visitor picks a language in the footer.
export const withoutLanguageRedirect = (html) => html.replace(REDIRECT, '');

export function writeLanguageCopy(html, file, langDir, opts) {
  const out = languageCopy(withoutLanguageRedirect(html), {
    ...opts,
    slug: file.replace(/\.html$/, ''),
  });
  fs.mkdirSync(langDir, { recursive: true });
  fs.writeFileSync(path.join(langDir, file), out);
}
