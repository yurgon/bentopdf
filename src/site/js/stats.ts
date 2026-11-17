// Site analytics, two services side by side for comparison:
// - Cloudflare Web Analytics: no cookies, no identifiers, loads for everyone.
// - Google Analytics (through the Google tag GTM-NZHGCVDB): sets cookies, so visitors in
//   Europe (EU, EEA, UK, Switzerland) get it only after they press Accept in a small bar.
//   Elsewhere it loads at once. The choice is kept in localStorage; the privacy page has a
//   button that clears it so the bar shows again.
import { t } from './i18n';

const CF_BEACON_TOKEN = '9aaf78baee97424d80e64a252f805398';
const GTM_ID = 'GTM-NZHGCVDB';
const CHOICE_KEY = 'plyleaf-analytics-consent'; // 'yes' | 'no'

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

let started = false;
let gaOn = false;

const isLocal = () =>
  location.hostname === 'localhost' || location.hostname === '127.0.0.1';

// No network lookup: the time zone is enough to tell Europe apart. Russia, Turkey and other
// non-EU countries in Europe/... also see the bar, which does no harm.
function inEurope(): boolean {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return (
      tz.startsWith('Europe/') ||
      /^Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)$/.test(tz) ||
      tz === 'Arctic/Longyearbyen'
    );
  } catch {
    return true; // unknown: ask
  }
}

function readChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function saveChoice(v: 'yes' | 'no'): void {
  try {
    localStorage.setItem(CHOICE_KEY, v);
  } catch {
    /* private mode: ask again next time */
  }
}

function loadCloudflare(): void {
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN }));
  document.head.appendChild(s);
}

function loadGoogle(): void {
  if (gaOn) return;
  gaOn = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(s);
}

function showBar(): void {
  if (document.getElementById('consent-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'consent-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', t('Cookies'));
  bar.className = 'consent-bar';
  const p = document.createElement('p');
  p.textContent = t(
    'May we use Google Analytics cookies to see which pages are useful? Your files never leave your device either way.'
  );
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'consent-yes';
  yes.textContent = t('Accept');
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'consent-no';
  no.textContent = t('Decline');
  const close = (v: 'yes' | 'no') => {
    saveChoice(v);
    bar.remove();
    if (v === 'yes') loadGoogle();
  };
  yes.addEventListener('click', () => close('yes'));
  no.addEventListener('click', () => close('no'));
  const actions = document.createElement('div');
  actions.append(no, yes);
  bar.append(p, actions);
  document.body.appendChild(bar);
}

/** Call once per page load. */
export function countView(): void {
  if (started || isLocal()) return;
  started = true;
  loadCloudflare();
  // #cookie-bar in the address shows the bar anywhere, to check how it looks
  const forceBar = location.hash === '#cookie-bar';
  if (!inEurope() && !forceBar) return loadGoogle();
  const choice = readChoice();
  if (choice === 'yes' && !forceBar) loadGoogle();
  else if (choice !== 'no' || forceBar) {
    if (document.body) showBar();
    else document.addEventListener('DOMContentLoaded', showBar);
  }
}

/** Call when a tool has produced its result (a file was saved). */
export function countDone(tool?: string): void {
  if (gaOn && window.gtag)
    window.gtag('event', 'tool_done', { tool: tool || '' });
}

// Any code (ours or BentoPDF's downloadFile) can signal a finished job with this event.
window.addEventListener('plyleaf:done', (e) => {
  countDone((e as CustomEvent<{ tool?: string }>).detail?.tool);
});

// The privacy page has a button that lets a visitor change their answer.
document.addEventListener('click', (e) => {
  const b = (e.target as Element | null)?.closest?.('[data-consent-reset]');
  if (!b) return;
  try {
    localStorage.removeItem(CHOICE_KEY);
  } catch {
    /* nothing stored */
  }
  if (inEurope()) showBar();
});
