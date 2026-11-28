// Boots the bundled PDF.js editor (pdfjs/viewer.html) inside the extension.
// The PDF comes from the address hash:
//   #src=<http(s) URL>   a PDF on the web (a redirected PDF tab, a right-clicked link)
//   #handoff=<id>        bytes left in the extension's IndexedDB (a local file)
//   (nothing)            an empty editor with an "Open a PDF" prompt
// Everything runs in this page; the PDF is never sent anywhere.
import { getHandoff, deleteHandoff, fileNameFrom } from '../shared.js';

const raw = location.hash.slice(1);
history.replaceState(null, '', location.pathname); // the viewer reads the hash as #page= etc.

// Turn on every editing tool the viewer has, before it reads its preferences.
try {
  const prefs = JSON.parse(localStorage.getItem('pdfjs.preferences') || '{}');
  delete prefs.annotationEditorMode;
  localStorage.setItem(
    'pdfjs.preferences',
    JSON.stringify({
      ...prefs,
      enableSignatureEditor: true,
      enablePermissions: false,
    })
  );
} catch {
  /* storage off: defaults still work */
}

const app = () => window.PDFViewerApplication;

async function ready() {
  while (!app()) await new Promise((r) => setTimeout(r, 20));
  await app().initializedPromise;
  return app();
}

function showEmpty(message) {
  const box = document.createElement('div');
  box.id = 'plyleafEmpty';
  const h = document.createElement('h1');
  h.textContent = message || 'Edit a PDF';
  const p = document.createElement('p');
  p.textContent =
    'Add text, draw, highlight, sign, insert images and fill in forms. Nothing is uploaded.';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Open a PDF';
  b.addEventListener('click', () => app()?._openFileInput?.click());
  const hint = document.createElement('small');
  hint.textContent = 'or drop a PDF file here';
  box.append(h, p, b, hint);
  document.body.append(box);
  app()?.eventBus?._on('documentloaded', () => box.remove());
}

async function bytesFromUrl(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok)
    throw new Error(`The PDF could not be downloaded (error ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  // the URL after src= is kept raw, '#' and '&' included
  const src = raw.startsWith('src=') ? raw.slice(4) : null;
  const handoff = raw.startsWith('handoff=') ? raw.slice(8) : null;

  const viewer = await ready();
  if (!src && !handoff) return showEmpty();

  try {
    let bytes;
    let name;
    if (src) {
      bytes = await bytesFromUrl(src);
      name = src;
    } else {
      const rec = await getHandoff(handoff);
      if (!rec) return showEmpty('That file is no longer here. Open it again.');
      deleteHandoff(handoff).catch(() => {});
      bytes = new Uint8Array(rec.bytes);
      name = fileNameFrom(rec.name.replace(/\.pdf$/i, ''), 'document');
    }
    const url = URL.createObjectURL(
      new Blob([bytes], { type: 'application/pdf' })
    );
    await viewer.open({ url, originalUrl: name });
    if (src) document.documentElement.dataset.source = src;
  } catch (e) {
    showEmpty(e?.message || 'This PDF could not be opened.');
  }
}

main();
