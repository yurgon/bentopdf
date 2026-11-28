/* global chrome */
// Plyleaf extension service worker.
// 1. Save the current page as a real (text, not screenshot) PDF through Chrome's own print
//    engine (DevTools protocol Page.printToPDF). Nothing leaves the computer.
// 2. Open PDFs in the bundled PDF.js editor (pdfjs/editor.html): from a link, the open PDF
//    tab, a local file, or (when the visitor turns it on) every PDF link they open.
// 3. Send a PDF (a link, the open PDF tab, or a local file from the popup) to a tool on
//    plyleaf.com. The bytes go from here to the plyleaf.com tab through the extension only;
//    plyleaf.com itself runs the tools in the browser and never uploads the file.
import {
  TOOLS,
  PAPERS,
  getSettings,
  fileNameFrom,
  canSave,
  putHandoff,
  getHandoff,
  deleteHandoff,
  sweepHandoffs,
  toolUrl,
  editorUrl,
  ALL_SITES,
} from './shared.js';

const PDF_LINKS = [
  '*://*/*.pdf',
  '*://*/*.pdf?*',
  '*://*/*.pdf#*',
  '*://*/*.PDF',
  '*://*/*.PDF?*',
];

// ---------- context menus ----------
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: 'welcome.html' });
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'save-page',
    title: 'Save page as PDF',
    contexts: ['page', 'selection', 'image'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
  chrome.contextMenus.create({
    id: 'open-link',
    title: 'Open PDF in Plyleaf',
    contexts: ['link'],
    targetUrlPatterns: PDF_LINKS,
  });
  chrome.contextMenus.create({
    id: 'open-link:editor',
    parentId: 'open-link',
    title: 'Edit in the Plyleaf editor',
    contexts: ['link'],
    targetUrlPatterns: PDF_LINKS,
  });
  chrome.contextMenus.create({
    id: 'open-link:sep',
    parentId: 'open-link',
    type: 'separator',
    contexts: ['link'],
    targetUrlPatterns: PDF_LINKS,
  });
  for (const t of TOOLS) {
    chrome.contextMenus.create({
      id: `open-link:${t.slug}`,
      parentId: 'open-link',
      title: t.label,
      contexts: ['link'],
      targetUrlPatterns: PDF_LINKS,
    });
  }
  sweepHandoffs().catch(() => {});
  syncPdfRule();
});

chrome.runtime.onStartup.addListener(() => {
  sweepHandoffs().catch(() => {});
  syncPdfRule();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === 'save-page') {
    // permissions.request has to run inside the click, before any await
    chrome.permissions.request({ permissions: ['debugger'] }, (ok) => {
      if (!ok)
        return toast(tab, 'Plyleaf needs one permission to save pages as PDF.');
      savePage(tab).catch((e) => toast(tab, e.message));
    });
    return;
  }
  if (id.startsWith('open-link:')) {
    const slug = id.slice('open-link:'.length);
    const url = info.linkUrl;
    chrome.permissions.request({ origins: [originPattern(url)] }, (ok) => {
      if (!ok)
        return toast(tab, 'Plyleaf needs permission to read that PDF link.');
      if (slug === 'editor') openEditor(url, tab);
      else openUrlInTool(url, slug, tab).catch((e) => toast(tab, e.message));
    });
  }
});

// The popup closes while Chrome shows a permission prompt, so it leaves the action in
// session storage and it is finished here once the permission is granted.
chrome.permissions.onAdded.addListener(async () => {
  syncPdfRule();
  const { pending } = await chrome.storage.session.get('pending');
  if (!pending || Date.now() - pending.at > 2 * 60 * 1000) return;
  await chrome.storage.session.remove('pending');
  const tab = await chrome.tabs.get(pending.tabId).catch(() => undefined);
  try {
    if (pending.type === 'save') await savePage(tab);
    else if (pending.type === 'open-url')
      await openUrlInTool(pending.url, pending.slug, tab);
    else if (pending.type === 'open-editor')
      await openEditor(pending.url, tab, pending.sameTab);
  } catch (e) {
    toast(tab, e.message);
  }
});

// ---------- messages from the popup and from the plyleaf.com content script ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg?.type) {
      case 'save': {
        const tab = await chrome.tabs.get(msg.tabId);
        return savePage(tab);
      }
      case 'open-url': {
        const tab = msg.tabId ? await chrome.tabs.get(msg.tabId) : undefined;
        return openUrlInTool(msg.url, msg.slug, tab);
      }
      case 'open-editor': {
        const tab = msg.tabId ? await chrome.tabs.get(msg.tabId) : undefined;
        return openEditor(msg.url, tab, msg.sameTab);
      }
      case 'handoff-get': {
        if (!sender.url?.startsWith('https://plyleaf.com/'))
          throw new Error('not allowed');
        const rec = await getHandoff(msg.id);
        if (!rec) return null;
        const size = rec.bytes.byteLength;
        const start = msg.offset || 0;
        const end = Math.min(size, start + (msg.length || 4 * 1024 * 1024));
        return {
          name: rec.name,
          size,
          chunk: toBase64(new Uint8Array(rec.bytes, start, end - start)),
        };
      }
      case 'handoff-done': {
        if (!sender.url?.startsWith('https://plyleaf.com/'))
          throw new Error('not allowed');
        await deleteHandoff(msg.id);
        return true;
      }
      default:
        throw new Error('unknown message');
    }
  })().then(
    (value) => reply({ ok: true, value }),
    (e) => reply({ ok: false, error: e?.message || String(e) })
  );
  return true; // async reply
});

// ---------- save page as PDF ----------
async function savePage(tab) {
  if (!tab?.id) throw new Error('No page to save.');
  if (!canSave(tab.url))
    throw new Error('Chrome does not let extensions save this kind of page.');
  if (!(await chrome.permissions.contains({ permissions: ['debugger'] })))
    throw new Error('Plyleaf needs one permission to save pages as PDF.');

  const s = await getSettings();
  const paper = PAPERS[s.paper] || PAPERS.a4;
  const m = s.margins === 'none' ? 0 : 0.4;
  const target = { tabId: tab.id };

  setBadge(tab.id, '…');
  let data;
  try {
    await chrome.debugger.attach(target, '1.3');
    try {
      const res = await chrome.debugger.sendCommand(target, 'Page.printToPDF', {
        landscape: !!s.landscape,
        printBackground: !!s.background,
        paperWidth: paper.w,
        paperHeight: paper.h,
        marginTop: m,
        marginBottom: m,
        marginLeft: m,
        marginRight: m,
        preferCSSPageSize: false,
        generateDocumentOutline: true,
        generateTaggedPDF: true,
      });
      data = res.data;
    } finally {
      await chrome.debugger.detach(target).catch(() => {});
    }
  } catch (e) {
    setBadge(tab.id, '');
    if (/another debugger|already attached/i.test(e?.message || ''))
      throw new Error('Close DevTools on this tab, then try again.', {
        cause: e,
      });
    throw new Error('This page could not be saved: ' + (e?.message || e), {
      cause: e,
    });
  }

  const url = await blobUrl(data, 'application/pdf');
  await chrome.downloads.download({
    url,
    filename: fileNameFrom(tab.title, hostOf(tab.url)),
  });
  setBadge(tab.id, '✓');
  setTimeout(() => setBadge(tab.id, ''), 2500);
  return true;
}

// The service worker cannot make blob: URLs, and data: URLs over about 2 MB fail in
// chrome.downloads, so a hidden offscreen page turns the bytes into a blob URL.
async function blobUrl(base64, type) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Turn the finished PDF into a blob URL for the download.',
    });
  }
  const res = await chrome.runtime.sendMessage({
    type: 'make-blob',
    base64,
    mime: type,
    target: 'offscreen',
  });
  if (!res?.ok)
    throw new Error(res?.error || 'Could not prepare the download.');
  return res.url;
}

// ---------- the bundled editor ----------
async function openEditor(url, tab, sameTab = false) {
  const target = editorUrl(url);
  if (sameTab && tab?.id) await chrome.tabs.update(tab.id, { url: target });
  else
    await chrome.tabs.create({
      url: target,
      index: tab ? tab.index + 1 : undefined,
    });
  return true;
}

// "Open PDFs in the Plyleaf editor": a redirect rule for PDF addresses opened in a tab.
// It is on only while the setting is on AND the visitor has given access to all sites.
const PDF_RULE_ID = 1;
async function syncPdfRule() {
  try {
    const { openPdfs } = await chrome.storage.sync.get('openPdfs');
    const allowed = await chrome.permissions.contains(ALL_SITES);
    const addRules = [];
    if (openPdfs && allowed) {
      addRules.push({
        id: PDF_RULE_ID,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { regexSubstitution: editorUrl('\\0') },
        },
        condition: {
          regexFilter: '^https?://[^?#]*\\.[Pp][Dd][Ff]([?#].*)?$',
          resourceTypes: ['main_frame'],
        },
      });
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [PDF_RULE_ID],
      addRules,
    });
  } catch (e) {
    console.warn('Plyleaf: PDF rule', e);
  }
}
chrome.permissions.onRemoved.addListener(syncPdfRule);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'openPdfs' in changes) syncPdfRule();
});

// ---------- open a PDF in a Plyleaf tool ----------
async function openUrlInTool(url, slug, tab) {
  if (!TOOLS.some((t) => t.slug === slug)) throw new Error('Unknown tool.');
  let res;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch (e) {
    throw new Error('That PDF could not be downloaded.', { cause: e });
  }
  if (!res.ok)
    throw new Error(`That PDF could not be downloaded (error ${res.status}).`);
  const bytes = await res.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength));
  if (!String.fromCharCode(...head).includes('%PDF'))
    throw new Error('That link is not a PDF file.');
  const name = nameFromResponse(res, url);
  const id = await putHandoff(name, bytes);
  await chrome.tabs.create({
    url: toolUrl(slug, id),
    index: tab ? tab.index + 1 : undefined,
  });
  return true;
}

function nameFromResponse(res, url) {
  const cd = res.headers.get('content-disposition') || '';
  const star = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(cd);
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  let name;
  try {
    name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : '';
  } catch {
    name = plain ? plain[1] : '';
  }
  if (!name) {
    try {
      name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    } catch {
      /* keep empty */
    }
  }
  return fileNameFrom(name.replace(/\.pdf$/i, ''), 'document');
}

// ---------- helpers ----------
function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'page';
  }
}

function toBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function setBadge(tabId, text) {
  chrome.action.setBadgeBackgroundColor({ color: '#d99a1e' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

// A short message on the page itself (context menu actions have no popup to show it in).
function toast(tab, text) {
  if (!tab?.id) return;
  chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      args: [text],
      func: (t) => {
        const el = document.createElement('div');
        el.textContent = 'Plyleaf: ' + t;
        el.setAttribute('role', 'status');
        el.style.cssText =
          'position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);' +
          'max-width:min(480px,calc(100vw - 32px));padding:12px 16px;border-radius:10px;' +
          'background:#2b2621;color:#f3f0ea;font:14px/1.4 system-ui,sans-serif;' +
          'box-shadow:0 8px 24px rgba(0,0,0,.25)';
        document.documentElement.appendChild(el);
        setTimeout(() => el.remove(), 5000);
      },
    })
    .catch(() => {});
}
