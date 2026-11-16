// Behaviour shared by every Plyleaf page: theme toggle, home search, "On this page" outline, usage counter.
import { countView } from './stats';

const root = document.documentElement;

// ---- theme: system by default, an explicit choice is remembered (applied early by /plyleaf-theme.js)
const toggle = document.getElementById('theme-toggle');
const dark = (): boolean =>
  root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
function paintToggle(): void {
  if (!toggle) return;
  const d = dark();
  toggle.setAttribute(
    'aria-label',
    d ? 'Switch to light theme' : 'Switch to dark theme'
  );
  toggle.querySelector('use')?.setAttribute('href', d ? '#sun' : '#moon');
}
paintToggle();
toggle?.addEventListener('click', () => {
  root.dataset.theme = dark() ? 'light' : 'dark';
  try {
    localStorage.setItem('plyleaf-theme', root.dataset.theme);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  paintToggle();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.(
  'change',
  paintToggle
);

// ---- home: filter the tool lists as you type
const search = document.getElementById(
  'tool-search'
) as HTMLInputElement | null;
if (search) {
  const items = [...document.querySelectorAll<HTMLElement>('[data-tool]')];
  const groups = [...document.querySelectorAll<HTMLElement>('[data-group]')];
  const empty = document.getElementById('search-empty');
  search.addEventListener('input', () => {
    const v = search.value.trim().toLowerCase();
    let shown = 0;
    for (const li of items) {
      const hit = !v || (li.textContent || '').toLowerCase().includes(v);
      li.hidden = !hit;
      if (hit) shown++;
    }
    for (const g of groups)
      g.hidden = !!v && !g.querySelector('[data-tool]:not([hidden])');
    if (empty) empty.hidden = shown > 0;
  });
}

// ---- tool page: highlight the outline entry for the section in view
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>('.toc a')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(
    tocLinks.map((a) => [a.getAttribute('href')!.slice(1), a])
  );
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        tocLinks.forEach((l) => l.removeAttribute('aria-current'));
        byId.get(e.target.id)?.setAttribute('aria-current', 'true');
      }
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );
  byId.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
}

countView();
