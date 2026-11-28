/* global chrome */
// Runs on plyleaf.com. When the extension opens a tool as
//   https://plyleaf.com/<tool>#plyleaf-ext=<id>
// this script fetches the PDF from the extension in chunks and drops it into the tool's
// file input, exactly as if the visitor had picked it.
(() => {
  const m = /[#&]plyleaf-ext=([0-9a-f-]{36})/.exec(location.hash);
  if (!m) return;
  const id = m[1];
  history.replaceState(null, '', location.pathname + location.search);

  const ask = (msg) =>
    new Promise((resolve, reject) =>
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError)
          return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || 'failed'));
        resolve(res.value);
      })
    );

  const waitFor = (sel, ms = 20000) =>
    new Promise((resolve) => {
      const found = document.querySelector(sel);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(sel);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(document.querySelector(sel));
      }, ms);
    });

  const fromBase64 = (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };

  (async () => {
    const parts = [];
    let name = 'document.pdf';
    let offset = 0;
    let size = Infinity;
    while (offset < size) {
      const r = await ask({ type: 'handoff-get', id, offset });
      if (!r) return; // already used or expired
      name = r.name;
      size = r.size;
      const u8 = fromBase64(r.chunk);
      parts.push(u8);
      offset += u8.length;
      if (!u8.length) break;
    }
    ask({ type: 'handoff-done', id }).catch(() => {});

    const input = await waitFor('#file-input');
    if (!input) return;
    // the tool scripts attach their listeners on page ready; give them a moment
    if (document.readyState !== 'complete')
      await new Promise((r) => addEventListener('load', r, { once: true }));
    await new Promise((r) => setTimeout(r, 300));

    const dt = new DataTransfer();
    dt.items.add(new File(parts, name, { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })().catch((e) => console.warn('Plyleaf extension:', e.message));
})();
