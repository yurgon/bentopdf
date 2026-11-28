/* global chrome */
// First run: what the extension does, then the first settings, then the one permission.
import { PAPERS, getSettings, setSettings, ALL_SITES } from './shared.js';

const $ = (id) => document.getElementById(id);

const settings = await getSettings();
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

document.querySelectorAll('[data-next]').forEach((b) =>
  b.addEventListener('click', () => {
    save();
    document
      .querySelectorAll('.step')
      .forEach((s) => (s.hidden = s.id !== 'step-' + b.dataset.next));
    document.querySelector('.step:not([hidden]) h1')?.focus?.();
  })
);

const allowStatus = (text, kind) => {
  $('allow-status').textContent = text;
  $('allow-status').className = 'status ' + kind;
};
async function paintAllow() {
  if (await chrome.permissions.contains({ permissions: ['debugger'] })) {
    $('allow').hidden = true;
    allowStatus(
      'Page saving is on. Open any website and press the Plyleaf button.',
      'ok'
    );
  }
}
$('allow').addEventListener('click', async () => {
  const ok = await chrome.permissions.request({ permissions: ['debugger'] });
  if (ok) paintAllow();
  else
    allowStatus(
      'Not allowed yet. You can allow it later, the first time you save a page.',
      'err'
    );
});
paintAllow();

const pdfStatus = (text, kind) => {
  $('open-pdfs-status').textContent = text;
  $('open-pdfs-status').className = 'status ' + kind;
};
async function paintOpenPdfs() {
  const { openPdfs } = await chrome.storage.sync.get('openPdfs');
  if (openPdfs && (await chrome.permissions.contains(ALL_SITES))) {
    $('open-pdfs').hidden = true;
    pdfStatus('On. PDF links open in the Plyleaf editor.', 'ok');
  }
}
$('open-pdfs').addEventListener('click', async () => {
  await chrome.storage.sync.set({ openPdfs: true });
  if (await chrome.permissions.request(ALL_SITES)) return paintOpenPdfs();
  await chrome.storage.sync.set({ openPdfs: false });
  pdfStatus('Not turned on. You can do it later in the Plyleaf button.', 'err');
});
paintOpenPdfs();
