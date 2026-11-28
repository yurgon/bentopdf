/* global chrome */
import {
  TOOLS,
  PAPERS,
  getSettings,
  setSettings,
  canSave,
  looksLikePdfUrl,
  SITE,
  editorUrl,
  ALL_SITES,
} from './shared.js';

const $ = (id) => document.getElementById(id);
const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r?.ok) throw new Error(r?.error || 'Something went wrong.');
    return r.value;
  });

function status(el, text, kind = '') {
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

// Chrome closes the popup when its permission prompt takes focus, so the action waits in
// session storage and the service worker finishes it when the permission arrives.
async function withPermission(perm, pending, run) {
  if (await chrome.permissions.contains(perm)) return run();
  await chrome.storage.session.set({ pending: { ...pending, at: Date.now() } });
  const ok = await chrome.permissions.request(perm);
  if (!ok) {
    await chrome.storage.session.remove('pending');
    throw new Error('Permission was not given, so Plyleaf cannot do this.');
  }
  return DEFERRED; // granted: the service worker runs `pending` from permissions.onAdded
}

const DEFERRED = Symbol('deferred');

function toolButtons(container, onPick) {
  container.replaceChildren(
    ...TOOLS.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.label;
      b.addEventListener('click', () => onPick(t.slug, b));
      return b;
    })
  );
}

async function isPdfTab(tab) {
  if (looksLikePdfUrl(tab.url)) return true;
  if (!/^https?:/.test(tab.url || '')) return false;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.contentType,
    });
    return r?.result === 'application/pdf';
  } catch {
    return false;
  }
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await getSettings();

  // ---------- options ----------
  const paper = $('paper');
  for (const [key, p] of Object.entries(PAPERS))
    paper.add(new Option(p.label, key));
  paper.value = settings.paper;
  const segs = document.querySelectorAll('.seg button');
  const paintSeg = () =>
    segs.forEach((b) =>
      b.setAttribute(
        'aria-pressed',
        String(b.dataset.landscape === String(settings.landscape))
      )
    );
  paintSeg();
  $('background').checked = settings.background;
  $('nomargins').checked = settings.margins === 'none';

  const save = () => setSettings(settings);
  paper.addEventListener(
    'change',
    () => ((settings.paper = paper.value), save())
  );
  segs.forEach((b) =>
    b.addEventListener('click', () => {
      settings.landscape = b.dataset.landscape === 'true';
      paintSeg();
      save();
    })
  );
  $('background').addEventListener(
    'change',
    (e) => ((settings.background = e.target.checked), save())
  );
  $('nomargins').addEventListener(
    'change',
    (e) => ((settings.margins = e.target.checked ? 'none' : 'default'), save())
  );

  // ---------- which panel ----------
  if (tab && (await isPdfTab(tab))) {
    $('pdf').hidden = false;
    $('pdf-title').textContent = tab.title || tab.url;
    $('edit-btn').addEventListener('click', async () => {
      const st = $('pdf-status');
      try {
        const msg = {
          type: 'open-editor',
          url: tab.url,
          tabId: tab.id,
          sameTab: true,
        };
        await withPermission({ origins: [originPattern(tab.url)] }, msg, () =>
          send(msg)
        );
        window.close();
      } catch (e) {
        status(st, e.message, 'err');
      }
    });
    toolButtons($('pdf-tools'), async (slug) => {
      const st = $('pdf-status');
      status(st, 'Opening…');
      try {
        await withPermission(
          { origins: [originPattern(tab.url)] },
          { type: 'open-url', url: tab.url, slug, tabId: tab.id },
          () => send({ type: 'open-url', url: tab.url, slug, tabId: tab.id })
        );
        window.close();
      } catch (e) {
        status(st, e.message, 'err');
      }
    });
  } else if (tab && canSave(tab.url)) {
    $('save').hidden = false;
    $('page-title').textContent = tab.title || tab.url;
    const granted = await chrome.permissions.contains({
      permissions: ['debugger'],
    });
    $('perm-note').hidden = granted;
    $('save-btn').addEventListener('click', async () => {
      const btn = $('save-btn');
      const st = $('save-status');
      btn.disabled = true;
      status(st, 'Saving…');
      try {
        const r = await withPermission(
          { permissions: ['debugger'] },
          { type: 'save', tabId: tab.id },
          () => send({ type: 'save', tabId: tab.id })
        );
        status(
          st,
          r === DEFERRED
            ? 'Saving… the PDF will appear in Downloads.'
            : 'Saved to your Downloads folder.',
          'ok'
        );
        $('perm-note').hidden = true;
      } catch (e) {
        status(st, e.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });
  } else {
    $('blocked').hidden = false;
  }

  // ---------- local file in the editor ----------
  $('local-edit').addEventListener('click', () => {
    chrome.tabs.create({
      url: editorUrl(),
      index: tab ? tab.index + 1 : undefined,
    });
    window.close();
  });

  // ---------- open every PDF link in the editor ----------
  const openPdfs = $('open-pdfs');
  const stored = await chrome.storage.sync.get('openPdfs');
  openPdfs.checked =
    !!stored.openPdfs && (await chrome.permissions.contains(ALL_SITES));
  openPdfs.addEventListener('change', async () => {
    const st = $('open-pdfs-status');
    if (!openPdfs.checked) {
      await chrome.storage.sync.set({ openPdfs: false });
      return status(st, '');
    }
    // set first: if the popup closes during Chrome's prompt, the service worker still
    // turns the rule on when the permission arrives
    await chrome.storage.sync.set({ openPdfs: true });
    const ok = await chrome.permissions.request(ALL_SITES);
    if (!ok) {
      openPdfs.checked = false;
      await chrome.storage.sync.set({ openPdfs: false });
      status(
        st,
        'Chrome needs your OK to open PDF links from any site.',
        'err'
      );
    } else status(st, 'PDF links now open in the Plyleaf editor.', 'ok');
  });

  // ---------- tools on the site for a local file ----------
  toolButtons($('site-tools'), (slug) => {
    chrome.tabs.create({
      url: `${SITE}/${slug}`,
      index: tab ? tab.index + 1 : undefined,
    });
    window.close();
  });
}

main();
