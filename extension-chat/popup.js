/* global chrome */
import { AI_SITES, canRead, siteFor } from './shared.js';

const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const site = siteFor(tab?.url);

if (!tab || !canRead(tab.url)) {
  $('blocked').hidden = false;
} else if (site) {
  $('site').textContent = site.name;
  $('chat').hidden = false;
} else {
  for (const s of AI_SITES) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = s.name;
    li.append(a);
    $('sites').append(li);
  }
  $('other').hidden = false;
}

const MESSAGES = {
  'no-chat':
    'No chat found on this page. Open a conversation with at least one answer and try again.',
  blocked: 'Chrome does not let extensions read this page.',
  failed: 'Could not read this chat. Reload the page and try again.',
};

document.querySelectorAll('[data-then]').forEach((b) =>
  b.addEventListener('click', async () => {
    document.querySelectorAll('button').forEach((x) => (x.disabled = true));
    $('status').className = 'status';
    $('status').textContent = 'Reading the chat…';
    const res = await chrome.runtime.sendMessage({
      type: 'export',
      tabId: tab.id,
      then: b.dataset.then,
    });
    if (res?.ok) return window.close();
    $('status').className = 'status err';
    $('status').textContent = MESSAGES[res?.error] || MESSAGES.failed;
    document.querySelectorAll('button').forEach((x) => (x.disabled = false));
  })
);
