/* global chrome */
// Hidden page: turns base64 bytes into a blob: URL that chrome.downloads can save.
// URLs are revoked after a minute; the download has its own copy by then.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'make-blob') return;
  try {
    const bin = atob(msg.base64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u8], { type: msg.mime }));
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    reply({ ok: true, url });
  } catch (e) {
    reply({ ok: false, error: e?.message || String(e) });
  }
});
