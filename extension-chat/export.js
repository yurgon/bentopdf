/* global chrome */
// The export page: shows the chat as a document, lets the user pick what goes in,
// and saves it as PDF, Markdown, Word or HTML. Everything happens in this tab.
import {
  PAPERS,
  PAPER_INCHES,
  baseName,
  getChat,
  getSettings,
  setSettings,
} from './shared.js';

const $ = (id) => document.getElementById(id);
const doc = $('doc');
const [id, then] = location.hash.slice(1).split('&');
const settings = await getSettings();
let chat;

// ---------- load ----------

function problem(title, text) {
  doc.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'problem';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  box.append(h, p);
  doc.append(box);
  document
    .querySelectorAll('.panel button, .panel input, .panel select')
    .forEach((b) => (b.disabled = true));
}

try {
  chat = id ? await getChat(id) : null;
} catch {
  chat = null;
}
if (!chat) {
  problem(
    'This export has expired',
    'Exports are kept on this computer for a day. Open the chat again and press the Plyleaf button.'
  );
} else {
  render();
  bindPanel();
  if (then === 'pdf') setTimeout(() => downloadPdf(true), 300);
  else if (['md', 'doc', 'html'].includes(then))
    setTimeout(() => save(then), 300);
}

// ---------- render ----------

/** Parse our own HTML (built by extract.js) without running anything. */
function fragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const f = tpl.content;
  f.querySelectorAll(
    'script, style, iframe, object, embed, link, meta'
  ).forEach((e) => e.remove());
  for (const e of f.querySelectorAll('*'))
    for (const a of [...e.attributes])
      if (
        /^on/i.test(a.name) ||
        (/^(href|src)$/.test(a.name) && /^\s*javascript:/i.test(a.value))
      )
        e.removeAttribute(a.name);
  // the page's layout boxes come through as <div>; drop the ones that only wrap one thing
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of f.querySelectorAll('div:not(.math)')) {
      const only = d.childNodes.length === 1 && d.firstChild.nodeType === 1;
      const empty =
        !d.textContent.trim() && !d.querySelector('img, math, hr, br');
      if (empty) {
        d.remove();
        changed = true;
      } else if (only) {
        d.replaceWith(d.firstChild);
        changed = true;
      }
    }
  }
  // a code viewer's language label ("python") sits right above the code; the code keeps it
  for (const pre of f.querySelectorAll('pre[data-lang]')) {
    let el = pre;
    for (let up = 0; up < 3 && el && el !== f; up++) {
      let prev = el.previousSibling;
      while (prev && prev.nodeType === 3 && !prev.data.trim())
        prev = prev.previousSibling;
      const text = prev?.textContent?.trim().toLowerCase();
      if (text && text === pre.dataset.lang && !prev.querySelector?.('pre')) {
        prev.remove();
        break;
      }
      if (prev && text) break;
      el = el.parentNode;
    }
  }
  f.querySelectorAll('a[href]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  return f;
}

function dateText(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function render() {
  doc.innerHTML = '';
  const head = document.createElement('header');
  head.className = 'doc-head';
  const h1 = document.createElement('h1');
  h1.textContent = chat.title;
  h1.contentEditable = 'plaintext-only';
  h1.spellcheck = false;
  h1.title = 'Click to rename';
  h1.addEventListener('input', () => {
    chat.title = h1.textContent.trim() || chat.site.name + ' chat';
    document.title = chat.title;
  });
  h1.addEventListener(
    'keydown',
    (e) => e.key === 'Enter' && (e.preventDefault(), h1.blur())
  );
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.append(`${chat.site.name} · ${dateText(chat.date)} · `);
  const link = document.createElement('a');
  link.href = chat.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = chat.url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  meta.append(link);
  head.append(h1, meta);
  doc.append(head);

  chat.turns.forEach((t, i) => {
    const sec = document.createElement('section');
    sec.className = 'turn ' + t.role;
    sec.dataset.i = i;
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = t.role === 'user' ? 'You' : chat.site.name;
    const body = document.createElement('div');
    body.className = 'body';
    body.append(fragment(t.html));
    sec.append(who, body);
    doc.append(sec);
    t.on = true;
  });
  document.title = chat.title;
  $('count').textContent =
    `${chat.turns.length} message${chat.turns.length === 1 ? '' : 's'}`;
  paintList();
  apply();
}

function apply() {
  doc.classList.remove('size-s', 'size-m', 'size-l');
  doc.classList.add('size-' + settings.size);
  doc.classList.toggle('no-labels', !settings.labels);
  doc.classList.toggle('breaks', settings.breaks);
  doc.querySelector('.doc-head').hidden = !settings.header;
  for (const sec of doc.querySelectorAll('.turn')) {
    const t = chat.turns[sec.dataset.i];
    sec.classList.toggle(
      'off',
      !t.on || (t.role === 'user' && !settings.questions)
    );
  }
  const [w, h] = PAPER_INCHES[settings.paper];
  document.documentElement.style.setProperty(
    '--sheet',
    Math.round(w * 96) + 'px'
  );
  $('page-size').textContent =
    `@page { size: ${w}in ${h}in; margin: 0.6in 0.6in 0.7in; }`;
}

// ---------- options ----------

function paintList() {
  const list = $('msgs');
  list.innerHTML = '';
  chat.turns.forEach((t) => {
    const li = document.createElement('li');
    li.className = t.role === 'user' ? 'is-user' : '';
    li.hidden = t.role === 'user' && !settings.questions;
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = t.on;
    box.addEventListener('change', () => {
      t.on = box.checked;
      apply();
    });
    const text = document.createElement('span');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = (t.role === 'user' ? 'You' : chat.site.name) + ' ';
    const say = document.createElement('span');
    say.className = 'say';
    say.textContent = plain(t.html).slice(0, 140) || '(image)';
    text.append(who, say);
    label.append(box, text);
    li.append(label);
    list.append(li);
  });
}

function plain(html) {
  const spaced = html.replace(
    /<(br|\/p|\/div|\/li|\/h\d|\/pre|\/td|\/th)\b[^>]*>/g,
    ' $&'
  );
  return (
    new DOMParser().parseFromString(spaced, 'text/html').body.textContent || ''
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function bindPanel() {
  const paper = $('paper');
  for (const [key, p] of Object.entries(PAPERS))
    paper.add(new Option(p.label, key));
  paper.value = settings.paper;
  paper.addEventListener('change', () => {
    settings.paper = paper.value;
    changed();
  });
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
      changed();
    })
  );
  for (const key of ['questions', 'labels', 'header', 'breaks']) {
    $(key).checked = settings[key];
    $(key).addEventListener('change', (e) => {
      settings[key] = e.target.checked;
      if (key === 'questions') paintList();
      changed();
    });
  }
  $('all').addEventListener('click', () => setAll(true));
  $('none').addEventListener('click', () => setAll(false));
  $('pdf').addEventListener('click', () => downloadPdf(false));
  document
    .querySelectorAll('[data-format]')
    .forEach((b) => b.addEventListener('click', () => save(b.dataset.format)));
  paintPdfHint();
}

function setAll(on) {
  chat.turns.forEach((t) => (t.on = on));
  paintList();
  apply();
}

function changed() {
  setSettings(settings);
  apply();
}

function status(text, kind = '') {
  $('status').textContent = text;
  $('status').className = 'status ' + kind;
}

// ---------- PDF ----------

function hasDirect() {
  return chrome.permissions.contains({ permissions: ['debugger'] });
}

async function paintPdfHint() {
  const hint = $('pdf-hint');
  hint.innerHTML = '';
  if (await hasDirect()) {
    hint.textContent = 'Saves straight to your Downloads folder.';
    return;
  }
  hint.append("Chrome's print window opens: choose Save as PDF. ");
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link';
  b.textContent = 'Skip that window next time';
  b.addEventListener('click', async () => {
    const ok = await chrome.permissions.request({ permissions: ['debugger'] });
    if (ok) status('Done. PDFs now save in one click.', 'ok');
    paintPdfHint();
  });
  hint.append(b);
}

function visibleCount() {
  return doc.querySelectorAll('.turn:not(.off)').length;
}

async function downloadPdf(auto) {
  if (!visibleCount()) return status('Pick at least one message.', 'err');
  if (document.activeElement?.isContentEditable) document.activeElement.blur();
  if (!(await hasDirect())) {
    status('');
    window.print();
    return;
  }
  status('Making the PDF…');
  $('pdf').disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'print',
      paper: settings.paper,
    });
    if (!res?.data) throw new Error(res?.error || 'no data');
    const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
    download(new Blob([bytes], { type: 'application/pdf' }), 'pdf');
    status('Saved to your Downloads folder.', 'ok');
  } catch (e) {
    console.warn(e);
    status(
      auto ? '' : 'Could not save directly. Opening the print window.',
      'err'
    );
    window.print();
  } finally {
    $('pdf').disabled = false;
  }
}

function download(blob, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = baseName(chat.title) + '.' + ext;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

// ---------- other formats ----------

/** The turns that are switched on, as {role, who, body element}. */
function chosen() {
  return [...doc.querySelectorAll('.turn:not(.off)')].map((sec) => ({
    role: sec.classList.contains('user') ? 'user' : 'assistant',
    who: sec.querySelector('.who').textContent,
    body: sec.querySelector('.body'),
  }));
}

async function save(format) {
  if (!visibleCount()) return status('Pick at least one message.', 'err');
  try {
    if (format === 'md' || format === 'copy') {
      const md = toMarkdown();
      if (format === 'copy') {
        await navigator.clipboard.writeText(md);
        return status('Copied as Markdown.', 'ok');
      }
      download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), 'md');
    } else if (format === 'doc') {
      download(
        new Blob(['﻿', toWord()], { type: 'application/msword' }),
        'doc'
      );
    } else if (format === 'html') {
      download(
        new Blob([await toHtml()], { type: 'text/html;charset=utf-8' }),
        'html'
      );
    }
    status('Saved to your Downloads folder.', 'ok');
  } catch (e) {
    console.warn(e);
    status('Something went wrong. Please try again.', 'err');
  }
}

function headerLines() {
  return settings.header
    ? [
        `# ${chat.title}`,
        '',
        `${chat.site.name} · ${dateText(chat.date)} · ${chat.url}`,
        '',
      ]
    : [];
}

function toMarkdown() {
  const out = headerLines();
  for (const t of chosen()) {
    if (settings.labels) out.push(`## ${t.who}`, '');
    out.push(mdBlock(t.body).trim(), '');
    if (!settings.labels) out.push('---', '');
  }
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

function mdInline(node) {
  let s = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      s += n.data.replace(/([*_`[\]\\])/g, '\\$1');
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    const inner = () => mdInline(n);
    if (tag === 'strong' || tag === 'b') s += `**${inner()}**`;
    else if (tag === 'em' || tag === 'i') s += `*${inner()}*`;
    else if (tag === 'del' || tag === 's') s += `~~${inner()}~~`;
    else if (tag === 'code') s += '`' + n.textContent + '`';
    else if (tag === 'br') s += '  \n';
    else if (tag === 'a') s += `[${inner()}](${n.getAttribute('href')})`;
    else if (tag === 'img') s += imgMd(n);
    else if (tag === 'math') s += mathMd(n);
    else if (/^(p|div|ul|ol|pre|table|blockquote|h[1-6])$/.test(tag))
      s += '\n' + mdBlock(n) + '\n';
    else s += inner();
  }
  return s;
}

function imgMd(n) {
  const src = n.getAttribute('src') || '';
  if (src.startsWith('data:') && src.length > 300_000)
    return `![${n.alt || 'image'}]()`;
  return `![${n.alt || 'image'}](${src})`;
}

function mathMd(n) {
  const tex = n.getAttribute('data-tex') || n.textContent;
  return n.getAttribute('display') === 'block'
    ? `\n$$\n${tex}\n$$\n`
    : `$${tex}$`;
}

function mdBlock(node, depth = 0) {
  const parts = [];
  let inline = '';
  const flush = () => {
    if (inline.trim()) parts.push(inline.trim());
    inline = '';
  };
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      inline += n.data.replace(/\s+/g, ' ');
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      flush();
      parts.push(
        '#'.repeat(Math.min(6, +tag[1] + 2)) + ' ' + mdInline(n).trim()
      );
    } else if (tag === 'p') {
      flush();
      parts.push(mdInline(n).trim());
    } else if (tag === 'pre') {
      flush();
      parts.push(
        '```' +
          (n.dataset.lang || '') +
          '\n' +
          n.textContent.replace(/\n$/, '') +
          '\n```'
      );
    } else if (tag === 'ul' || tag === 'ol') {
      flush();
      parts.push(mdList(n, depth));
    } else if (tag === 'blockquote') {
      flush();
      parts.push(
        mdBlock(n, depth)
          .split('\n')
          .map((l) => '> ' + l)
          .join('\n')
      );
    } else if (tag === 'table') {
      flush();
      parts.push(mdTable(n));
    } else if (tag === 'hr') {
      flush();
      parts.push('---');
    } else if (tag === 'div' && n.classList.contains('math')) {
      flush();
      const m = n.querySelector('math');
      parts.push(
        m
          ? `$$\n${m.getAttribute('data-tex') || m.textContent}\n$$`
          : n.textContent
      );
    } else if (/^(div|figure|details|dl|section)$/.test(tag)) {
      flush();
      parts.push(mdBlock(n, depth));
    } else {
      const wrap = document.createElement('span');
      wrap.append(n.cloneNode(true));
      inline += mdInline(wrap);
    }
  }
  flush();
  return parts.filter(Boolean).join('\n\n');
}

function mdList(list, depth) {
  const ordered = list.tagName === 'OL';
  let k = +(list.getAttribute('start') || 1);
  const pad = '   '.repeat(depth);
  return [...list.children]
    .filter((li) => li.tagName === 'LI')
    .map((li) => {
      const mark = ordered ? `${k++}.` : '-';
      const nested = [...li.children].filter((c) =>
        /^(UL|OL)$/.test(c.tagName)
      );
      const clone = li.cloneNode(true);
      [...clone.children]
        .filter((c) => /^(UL|OL)$/.test(c.tagName))
        .forEach((c) => c.remove());
      const text = mdBlock(clone, depth)
        .replace(/\n\n+/g, '\n')
        .split('\n')
        .join('\n' + pad + '   ');
      const sub = nested.map((n) => mdList(n, depth + 1)).join('\n');
      return pad + mark + ' ' + text.trim() + (sub ? '\n' + sub : '');
    })
    .join('\n');
}

function mdTable(table) {
  const rows = [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.children].map((c) =>
      mdInline(c)
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\|/g, '\\|')
        .trim()
    )
  );
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const line = (r) =>
    '| ' +
    Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ') +
    ' |';
  return [
    line(rows[0]),
    '| ' + Array(cols).fill('---').join(' | ') + ' |',
    ...rows.slice(1).map(line),
  ].join('\n');
}

/** A copy of the visible document with math turned into text (for Word). */
function docClone({ texMath }) {
  const c = doc.cloneNode(true);
  c.querySelectorAll('.turn.off').forEach((e) => e.remove());
  c.querySelector('.doc-head')?.toggleAttribute('hidden', !settings.header);
  c.querySelectorAll('[hidden]').forEach((e) => e.remove());
  c.querySelectorAll('[contenteditable]').forEach((e) =>
    e.removeAttribute('contenteditable')
  );
  if (!settings.labels) c.querySelectorAll('.who').forEach((e) => e.remove());
  if (texMath)
    c.querySelectorAll('math').forEach((m) => {
      const code = document.createElement('code');
      code.textContent = m.getAttribute('data-tex') || m.textContent;
      m.replaceWith(code);
    });
  return c;
}

function toWord() {
  const c = docClone({ texMath: true });
  // Word ignores most CSS; give it the basics inline
  c.querySelectorAll('pre').forEach((p) =>
    p.setAttribute(
      'style',
      'font-family:Consolas,monospace;font-size:10pt;background:#f6f4f0;padding:8pt;border:1pt solid #e4ded5'
    )
  );
  c.querySelectorAll('table').forEach((t) =>
    t.setAttribute('style', 'border-collapse:collapse')
  );
  c.querySelectorAll('th, td').forEach((t) =>
    t.setAttribute('style', 'border:1pt solid #d6cfc4;padding:4pt 6pt')
  );
  c.querySelectorAll('.turn.user .body').forEach((b) =>
    b.setAttribute('style', 'background:#f5f1ea;padding:6pt 8pt')
  );
  c.querySelectorAll('.who').forEach((w) =>
    w.setAttribute(
      'style',
      'color:#8a5a12;font-weight:bold;font-size:9pt;margin-top:12pt'
    )
  );
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${escapeHtml(chat.title)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4}h1{font-size:18pt}code{font-family:Consolas,monospace}</style></head><body>${c.innerHTML}</body></html>`;
}

async function toHtml() {
  const css = await fetch(chrome.runtime.getURL('doc.css')).then((r) =>
    r.text()
  );
  const c = docClone({ texMath: false });
  const [w] = PAPER_INCHES[settings.paper];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(chat.title)}</title>
<style>${css}
body{margin:0;background:#fff}.doc{max-width:${Math.round(w * 96)}px;margin:0 auto;padding:40px 24px 64px}</style></head>
<body><article class="${escapeHtml(c.className)}">${c.innerHTML}</article></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]
  );
}
