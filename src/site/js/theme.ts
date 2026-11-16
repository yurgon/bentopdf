// Light/dark toggle in the site header. System theme by default; an explicit choice is remembered
// (and applied before first paint by /plyleaf-theme.js).
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
  toggle.querySelector('use')?.setAttribute('href', d ? '#i-sun' : '#i-moon');
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
