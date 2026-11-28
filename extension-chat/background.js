/* global chrome */
// Service worker: reads the chat in the active tab (only when the user asks, via activeTab)
// and opens the export page. Also prints the export page straight to a PDF file when the
// user has allowed the optional "debugger" permission.
import {
  AI_PATTERNS,
  PAPER_INCHES,
  canRead,
  getSettings,
  putChat,
} from './shared.js';

const MENU = 'export-chat';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU,
      title: 'Export this chat to PDF',
      contexts: ['page', 'selection'],
      documentUrlPatterns: AI_PATTERNS,
    });
  });
  if (reason === 'install')
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU && tab) exportTab(tab, 'pdf');
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'export-pdf') return;
  tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab) exportTab(tab, 'pdf');
});

/** Read the chat in `tab` and open the export page. `then` = what the page does first. */
async function exportTab(tab, then = '') {
  if (!canRead(tab.url)) return { error: 'blocked' };
  setBadge(tab.id, '…', '#6b6359');
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['extract.js'],
    });
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__plyleafExtract(),
    });
    if (!result || result.error) {
      setBadge(tab.id, '!', '#c2410c');
      return { error: result?.error || 'no-chat' };
    }
    const id = await putChat(result);
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`export.html#${id}${then ? '&' + then : ''}`),
      index: tab.index + 1,
      openerTabId: tab.id,
    });
    setBadge(tab.id, '');
    return { ok: true };
  } catch (e) {
    console.warn('Plyleaf: export failed', e);
    setBadge(tab.id, '!', '#c2410c');
    return { error: 'failed', message: String(e?.message || e) };
  }
}

function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (color)
    chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  if (text === '!')
    setTimeout(
      () => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}),
      4000
    );
}

/** Print the export page (the sender) to PDF bytes with Chrome's own engine. */
async function printTab(tabId, opts) {
  const s = await getSettings();
  const [w, h] = PAPER_INCHES[opts.paper || s.paper] || PAPER_INCHES.letter;
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const { data } = await chrome.debugger.sendCommand(
      target,
      'Page.printToPDF',
      {
        paperWidth: w,
        paperHeight: h,
        marginTop: 0.6,
        marginBottom: 0.7,
        marginLeft: 0.6,
        marginRight: 0.6,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="width:100%;font:9px system-ui,sans-serif;color:#8a8178;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        generateDocumentOutline: true,
        generateTaggedPDF: true,
        transferMode: 'ReturnAsBase64',
      }
    );
    return data;
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const own =
    sender.id === chrome.runtime.id && !sender.tab?.url?.startsWith('http');
  if (!own) return false;
  if (msg.type === 'export') {
    chrome.tabs
      .get(msg.tabId)
      .then((tab) => exportTab(tab, msg.then))
      .then(reply, (e) => reply({ error: 'failed', message: String(e) }));
    return true;
  }
  if (msg.type === 'print' && sender.tab) {
    printTab(sender.tab.id, msg)
      .then((data) => reply({ data }))
      .catch((e) => reply({ error: String(e?.message || e) }));
    return true;
  }
  return false;
});
