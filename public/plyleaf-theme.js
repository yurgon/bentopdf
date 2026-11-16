// Applies the remembered light/dark choice before first paint (no flash). Kept tiny and external for the CSP.
try {
  var t = localStorage.getItem('plyleaf-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
