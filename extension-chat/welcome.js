/* global chrome */
// First run: what it does, then the first settings, then how to use it.
import { AI_SITES, PAPERS, getSettings, setSettings } from './shared.js';

const $ = (id) => document.getElementById(id);
const settings = await getSettings();
const save = () => setSettings(settings);

const paper = $('paper');
for (const [key, p] of Object.entries(PAPERS))
  paper.add(new Option(p.label, key));
paper.value = settings.paper;
paper.addEventListener(
  'change',
  () => ((settings.paper = paper.value), save())
);

const segs = document.querySelectorAll('[data-size]');
const paintSeg = () =>
  segs.forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.size === settings.size))
  );
paintSeg();
segs.forEach((b) =>
  b.addEventListener('click', () => {
    settings.size = b.dataset.size;
    paintSeg();
    save();
  })
);
for (const key of ['questions', 'labels']) {
  $(key).checked = settings[key];
  $(key).addEventListener(
    'change',
    (e) => ((settings[key] = e.target.checked), save())
  );
}

const dots = document.querySelectorAll('.dots li');
document.querySelectorAll('[data-next]').forEach((b) =>
  b.addEventListener('click', () => {
    save();
    const n = +b.dataset.next;
    document
      .querySelectorAll('.step')
      .forEach((s) => (s.hidden = s.id !== 'step-' + n));
    dots.forEach((d, i) =>
      i === n - 1
        ? d.setAttribute('aria-current', 'step')
        : d.removeAttribute('aria-current')
    );
  })
);

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

const directStatus = (text, kind) => {
  $('direct-status').textContent = text;
  $('direct-status').className = 'status ' + kind;
};
async function paintDirect() {
  if (await chrome.permissions.contains({ permissions: ['debugger'] })) {
    $('direct').hidden = true;
    directStatus('On. PDFs save straight to your Downloads folder.', 'ok');
  }
}
$('direct').addEventListener('click', async () => {
  if (await chrome.permissions.request({ permissions: ['debugger'] }))
    return paintDirect();
  directStatus(
    'Not allowed. The print window will open instead, which works too.',
    'err'
  );
});
paintDirect();
