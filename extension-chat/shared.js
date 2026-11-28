/* global chrome */
// Code shared by the service worker, the popup, the export page and the welcome page.

export const SITE = 'https://plyleaf.com';

// Chat sites with a dedicated reader in extract.js. Any other page can still be tried:
// extract.js falls back to a generic reader.
export const AI_SITES = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    hosts: ['chatgpt.com', 'chat.openai.com'],
  },
  {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai/',
    hosts: ['claude.ai'],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    hosts: ['gemini.google.com'],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    hosts: ['perplexity.ai', 'www.perplexity.ai'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    hosts: ['chat.deepseek.com'],
  },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/', hosts: ['grok.com'] },
  {
    id: 'copilot',
    name: 'Copilot',
    url: 'https://copilot.microsoft.com/',
    hosts: ['copilot.microsoft.com'],
  },
  {
    id: 'mistral',
    name: 'Le Chat',
    url: 'https://chat.mistral.ai/',
    hosts: ['chat.mistral.ai'],
  },
];

/** URL patterns for the right-click menu. */
export const AI_PATTERNS = AI_SITES.flatMap((s) =>
  s.hosts.map((h) => `https://${h}/*`)
);

export function siteFor(url) {
  try {
    const host = new URL(url).hostname;
    return AI_SITES.find((s) => s.hosts.includes(host)) || null;
  } catch {
    return null;
  }
}

const BLOCKED =
  /^(chrome|edge|brave|about|chrome-extension|devtools|view-source|data|blob|file):/i;

/** Pages Chrome lets an extension read. */
export function canRead(url) {
  if (!url || BLOCKED.test(url)) return false;
  return !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(
    url
  );
}

export const PAPERS = {
  letter: { label: 'Letter', css: 'letter' },
  a4: { label: 'A4', css: 'A4' },
  legal: { label: 'Legal', css: 'legal' },
  a3: { label: 'A3', css: 'A3' },
};
// inches, for Chrome's printToPDF
export const PAPER_INCHES = {
  letter: [8.5, 11],
  a4: [8.27, 11.69],
  legal: [8.5, 14],
  a3: [11.69, 16.54],
};

export function defaultPaper() {
  const lang = (navigator.language || '').toLowerCase();
  return /^(en-us|en-ca|es-mx|fr-ca)$/.test(lang) || lang.endsWith('-us')
    ? 'letter'
    : 'a4';
}

export const DEFAULT_SETTINGS = {
  paper: null, // defaultPaper() on first read
  size: 'm', // text size: s | m | l
  questions: true, // include the user's own messages
  labels: true, // "You" / "ChatGPT" above each message
  header: true, // title, site, date and link at the top
  breaks: false, // start every answer on a new page
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

/** A file name from a chat title: safe on every OS, not too long, no extension. */
export function baseName(title, fallback = 'chat') {
  return (
    (title || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100)
      .replace(/[. ]+$/, '') || fallback
  );
}

// ---------- chat store ----------
// A read chat waits in IndexedDB on the extension origin until the export page shows it.
// It never leaves the computer. Old records are cleared after a day.

const DB = 'plyleaf-chats';
const STORE = 'chats';
const TTL_MS = 24 * 60 * 60 * 1000;

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

export async function putChat(chat) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await tx('readwrite', (s) => {
    s.put({ ...chat, savedAt: now }, id);
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (!c.value || now - c.value.savedAt > TTL_MS) c.delete();
      c.continue();
    };
  });
  return id;
}

export function getChat(id) {
  return tx('readonly', (s) => s.get(id));
}
