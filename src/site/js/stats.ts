// Cookieless usage counter: page views and finished operations per tool.
// Sends only the page path and a tool name. No cookies, no identifiers, no referrer, no user agent stored.
const ENDPOINT = '/api/e';
let sentView = false;

const toolSlug = (): string =>
  location.pathname
    .replace(/^\/([a-z]{2}(-[A-Z]{2})?)(?=\/)/, '')
    .replace(/\.html$/, '')
    .replace(/^\/+|\/+$/g, '') || 'index';

function send(kind: 'view' | 'done', tool = toolSlug()): void {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    return;
  const body = JSON.stringify({ k: kind, p: location.pathname, t: tool });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
    } else {
      void fetch(ENDPOINT, {
        method: 'POST',
        body,
        keepalive: true,
        credentials: 'omit',
      });
    }
  } catch {
    /* counting must never break a page */
  }
}

/** Call once per page load. */
export function countView(): void {
  if (sentView) return;
  sentView = true;
  send('view');
}

/** Call when a tool has produced its result (a file was saved). */
export function countDone(tool?: string): void {
  send('done', tool);
}

// Any code (ours or BentoPDF's downloadFile) can signal a finished job with this event.
window.addEventListener('plyleaf:done', (e) => {
  countDone((e as CustomEvent<{ tool?: string }>).detail?.tool);
});
