// Interface strings for the language copies of our pages (/de/, /fr/, …). The English text is
// the key. The build puts the dictionary for the page's language into a JSON block,
// <script type="application/json" id="pl-i18n"> (a data block, so the CSP has nothing to
// allow; see scripts/site/i18n-ui.mjs). English pages have none and use the English text.
type Forms = string | Partial<Record<Intl.LDMLPluralRule, string>>;
type Vars = Record<string, string | number>;

const dict: Record<string, Forms> = (() => {
  try {
    return JSON.parse(document.getElementById('pl-i18n')?.textContent || '{}');
  } catch {
    return {};
  }
})();

export const lang = document.documentElement.lang || 'en';
const locale = lang === 'zh' ? 'zh-CN' : lang;
const rules = new Intl.PluralRules(locale);

/** A number written the way the page's language writes it. */
export const num = (n: number) => n.toLocaleString(locale);

const fill = (s: string, v: Vars) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in v ? String(typeof v[k] === 'number' ? num(v[k] as number) : v[k]) : m
  );

/** t('Reading page {a} of {b}', { a, b }) */
export function t(en: string, v: Vars = {}): string {
  const tr = dict[en];
  return fill(typeof tr === 'string' ? tr : en, v);
}

/** Counted phrase: tn(n, '{n} page', '{n} pages'). The English plural form is the key. */
export function tn(
  n: number,
  one: string,
  other: string,
  v: Vars = {}
): string {
  const tr = dict[other];
  let s: string;
  if (tr && typeof tr === 'object')
    s = tr[rules.select(n)] ?? tr.other ?? other;
  else if (typeof tr === 'string') s = tr;
  else s = n === 1 ? one : other;
  return fill(s, { n, ...v });
}

/** A site path in the page's language: /unlock-pdf → /de/unlock-pdf on German pages. */
export const href = (path: string) =>
  lang === 'en' ? path : `/${lang}${path}`;

/** The name of a language in the page's language (falls back to the English name). */
export function langName(code: string, english: string): string {
  try {
    const tag = code === 'zh' ? 'zh-Hans' : code;
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(tag);
    if (name && name !== tag && lang !== 'en')
      return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    /* old browser: English name */
  }
  return english;
}

// Text drawn on printed sheets uses Liberation Sans (Latin, Cyrillic, Greek, Vietnamese).
// Chinese, Japanese and Korean have no glyphs there, so printed text stays English for them.
const printable = !/^(zh|ja|ko)/.test(lang);
/** t() for text drawn on a printed sheet or PDF page. */
export const tp = (en: string, v: Vars = {}) =>
  printable ? t(en, v) : fill(en, v);
/** tn() for text drawn on a printed sheet or PDF page. */
export const tpn = (n: number, one: string, other: string, v: Vars = {}) =>
  printable ? tn(n, one, other, v) : fill(n === 1 ? one : other, { n, ...v });
