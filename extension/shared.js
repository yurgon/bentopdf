/* global chrome */
// Code shared by the service worker and the popup (both are ES modules on the extension origin).

export const SITE = 'https://plyleaf.com';

// Tools a PDF can be sent to. The slug is the page path on plyleaf.com; every one of these
// pages has an <input id="file-input"> that the content script fills.
export const TOOLS = [
  { slug: 'edit-pdf', label: 'Edit PDF' },
  { slug: 'sign-pdf', label: 'Sign PDF' },
  { slug: 'compress-pdf', label: 'Compress PDF' },
  { slug: 'merge-pdf', label: 'Merge PDF' },
  { slug: 'split-pdf', label: 'Split PDF' },
  { slug: 'organize-pdf', label: 'Rearrange pages' },
  { slug: 'rotate-pdf', label: 'Rotate PDF' },
  { slug: 'pdf-to-word', label: 'PDF to Word' },
  { slug: 'pdf-to-jpg', label: 'PDF to JPG' },
  { slug: 'protect-pdf', label: 'Protect PDF' },
];

export const PAPERS = {
  letter: { label: 'Letter', w: 8.5, h: 11 },
  a4: { label: 'A4', w: 8.27, h: 11.69 },
  legal: { label: 'Legal', w: 8.5, h: 14 },
  a3: { label: 'A3', w: 11.69, h: 16.54 },
};

export function defaultPaper() {
  const lang = (navigator.language || '').toLowerCase();
  return /^(en-us|en-ca|es-mx|fr-ca)$/.test(lang) || lang.endsWith('-us')
    ? 'letter'
    : 'a4';
}

export const DEFAULT_SETTINGS = {
  paper: null, // filled with defaultPaper() on first read
  landscape: false,
  background: true,
  margins: 'default', // 'default' | 'none'
};

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!s.paper || !PAPERS[s.paper]) s.paper = defaultPaper();
  return s;
}

export function setSettings(s) {
  return chrome.storage.sync.set({ settings: s });
}

/** A file name from a page title: safe on every OS, not too long. */
export function fileNameFrom(title, fallback = 'page') {
  const base =
    (title || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .replace(/[. ]+$/, '') || fallback;
  return /\.pdf$/i.test(base) ? base : base + '.pdf';
}

export function looksLikePdfUrl(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && /\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
}

const BLOCKED =
  /^(chrome|edge|brave|about|chrome-extension|devtools|view-source|data|blob|file):/i;

/** Pages Chrome lets an extension print. */
export function canSave(url) {
  if (!url || BLOCKED.test(url)) return false;
  if (
    /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(
      url
    )
  )
    return false;
  return true;
}

// ---------- hand-off store ----------
// A PDF on its way to a plyleaf.com tab waits in IndexedDB on the extension origin, so it
// survives the service worker going to sleep. The content script asks for it in chunks and
// the record is deleted as soon as it has been read (or after 10 minutes).

const DB = 'plyleaf-handoff';
const STORE = 'files';
const TTL_MS = 10 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(out && 'result' in out ? out.result : undefined);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export async function putHandoff(name, bytes) {
  const id = crypto.randomUUID();
  await tx('readwrite', (s) => s.put({ name, bytes, at: Date.now() }, id));
  return id;
}

export function getHandoff(id) {
  return tx('readonly', (s) => s.get(id));
}

export function deleteHandoff(id) {
  return tx('readwrite', (s) => s.delete(id));
}

export async function sweepHandoffs() {
  const now = Date.now();
  await tx('readwrite', (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (!c.value || now - c.value.at > TTL_MS) c.delete();
      c.continue();
    };
  });
}

export function toolUrl(slug, id) {
  return `${SITE}/${slug}#plyleaf-ext=${id}`;
}
