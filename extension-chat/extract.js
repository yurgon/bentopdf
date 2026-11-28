// Reads the open AI chat from the page. Injected on demand (activeTab), never on its own.
// Defines window.__plyleafExtract(); the service worker calls it and gets back
//   { site: {id, name}, title, url, date, turns: [{ role: 'user'|'assistant', html }] }
// The HTML is rebuilt from scratch with a short allow-list of tags, so no page script,
// style, button or tracking attribute comes along. Nothing is sent anywhere.
(() => {
  if (window.__plyleafExtract) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const host = location.hostname;

  // Drop matches that sit inside another match (keeps the outermost one).
  const outermost = (els) =>
    els.filter((e) => !els.some((o) => o !== e && o.contains(e)));

  // ---------- one reader per site ----------
  // Each returns the turns that are in the DOM right now, in page order:
  // [{ key, role, el, parts? }]. `parts` (several content roots) wins over `el`.

  const readers = {
    chatgpt() {
      const heads = $$('[data-conversation-role]');
      if (heads.length) {
        return heads.map((h) => {
          const role =
            h.dataset.conversationRole === 'user' ? 'user' : 'assistant';
          const box = h.parentElement;
          const turn = h.closest('[data-turn-key]');
          const key = (turn?.dataset.turnKey || textKey(box)) + ':' + role;
          if (role === 'user') {
            const msg =
              box.querySelector(
                '[class*="group/user-message"] .whitespace-pre-wrap'
              ) ||
              box.querySelector('.whitespace-pre-wrap') ||
              box.querySelector('[class*="user-message"]') ||
              box;
            return { key, role, el: msg };
          }
          const parts = $$('[data-dil-response]', box);
          if (parts.length) return { key, role, parts: outermost(parts) };
          const md = $$('.markdown', box);
          return md.length
            ? { key, role, parts: md }
            : { key, role, el: box, skipHeading: h };
        });
      }
      // older layout
      return $$('[data-message-author-role]').map((m) => {
        const role =
          m.dataset.messageAuthorRole === 'user' ? 'user' : 'assistant';
        const key = (m.dataset.messageId || textKey(m)) + ':' + role;
        const el =
          role === 'user'
            ? m.querySelector('.whitespace-pre-wrap') || m
            : m.querySelector('.markdown') || m;
        return { key, role, el };
      });
    },

    claude() {
      return $$(
        '[data-testid="user-message"], [data-testid="assistant-message"]'
      ).map((m) => {
        const role = m.dataset.testid === 'user-message' ? 'user' : 'assistant';
        const key =
          (m.dataset.turnKey ||
            m.closest('[data-turn-key]')?.dataset.turnKey ||
            textKey(m)) +
          ':' +
          role;
        if (role === 'user') return { key, role, el: m };
        const md = outermost(
          $$('.standard-markdown, .progressive-markdown', m)
        ).filter((e) => !e.closest('[class*="thinking"], details'));
        return md.length ? { key, role, parts: md } : { key, role, el: m };
      });
    },

    gemini() {
      return $$('user-query, model-response').map((m) => {
        const role = m.tagName === 'USER-QUERY' ? 'user' : 'assistant';
        const key =
          (m.closest('.conversation-container')?.id || textKey(m)) + ':' + role;
        if (role === 'user')
          return { key, role, el: m.querySelector('.query-text') || m };
        const md =
          m.querySelector('.markdown-main-panel') ||
          m.querySelector('message-content .markdown') ||
          m.querySelector('.markdown');
        return { key, role, el: md || m };
      });
    },

    perplexity() {
      const els = outermost($$('[data-message-bubble], .prose[data-renderer]'));
      return els.map((m) => ({
        key: 'p:' + textKey(m),
        role: m.matches('[data-message-bubble]') ? 'user' : 'assistant',
        el: m,
      }));
    },

    deepseek() {
      return $$('.ds-message').map((m) => {
        const md = $$('.ds-markdown', m).filter(
          (e) => !e.closest('[class*="think"]')
        );
        const role = md.length ? 'assistant' : 'user';
        return {
          key: 'd:' + role + ':' + textKey(m),
          role,
          ...(md.length ? { parts: outermost(md) } : { el: m }),
        };
      });
    },

    grok() {
      return $$('[id^="response-"]').map((m) => {
        const role = /\bitems-end\b/.test(m.className) ? 'user' : 'assistant';
        return {
          key: m.id || textKey(m),
          role,
          el: m.querySelector('.message-bubble') || m,
        };
      });
    },

    copilot() {
      return $$(
        '[data-content="user-message"], [data-content="ai-message"]'
      ).map((m) => ({
        key: 'cp:' + textKey(m),
        role: m.dataset.content === 'user-message' ? 'user' : 'assistant',
        el: m,
      }));
    },

    // Any other chat page: messages that say who wrote them, or else rendered markdown.
    generic() {
      const tagged = $$(
        '[data-message-author-role], [data-role="user"], [data-role="assistant"]'
      );
      if (tagged.length)
        return outermost(tagged).map((m) => {
          const r = (
            m.dataset.messageAuthorRole ||
            m.dataset.role ||
            ''
          ).toLowerCase();
          return {
            key: 'x:' + (m.dataset.messageId || m.id || textKey(m)),
            role: r === 'user' ? 'user' : 'assistant',
            el: m,
          };
        });
      return outermost($$('.markdown, .prose, [class*="markdown"]')).map(
        (m) => ({
          key: 'y:' + (m.id || textKey(m)),
          role: 'assistant',
          el: m,
        })
      );
    },
  };

  const SITES = [
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      test: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
    },
    { id: 'claude', name: 'Claude', test: /(^|\.)claude\.ai$/ },
    { id: 'gemini', name: 'Gemini', test: /^gemini\.google\.com$/ },
    { id: 'perplexity', name: 'Perplexity', test: /(^|\.)perplexity\.ai$/ },
    { id: 'deepseek', name: 'DeepSeek', test: /^chat\.deepseek\.com$/ },
    { id: 'grok', name: 'Grok', test: /(^|\.)grok\.com$/ },
    { id: 'copilot', name: 'Copilot', test: /^copilot\.microsoft\.com$/ },
    {
      id: 'mistral',
      name: 'Le Chat',
      test: /^chat\.mistral\.ai$/,
      reader: 'generic',
    },
  ];

  function textKey(el) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return t.length + '.' + (h >>> 0).toString(36);
  }

  // ---------- clean HTML ----------

  const KEEP = new Set(
    'p h1 h2 h3 h4 h5 h6 ul ol li blockquote strong b em i u s del ins sup sub a br hr table thead tbody tfoot tr th td caption img figure figcaption kbd mark dl dt dd details summary'.split(
      ' '
    )
  );
  const SKIP = new Set(
    'button svg style script noscript input textarea select option iframe canvas template video audio object embed link meta form nav header footer aside'.split(
      ' '
    )
  );
  const HIDDEN_CLASS =
    /(^|\s)(sr-only|visually-hidden|cdk-visually-hidden|screen-reader-only)(\s|$)/;
  const LANG_SKIP =
    /^(copy|copied|run|edit|download|code|wrap|expand|collapse|share|preview)$/i;

  const esc = (s) =>
    s.replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );

  function isCodeBlock(el) {
    return (
      el.tagName === 'PRE' ||
      el.tagName === 'CODE-BLOCK' ||
      el.hasAttribute('data-chatgpt-copy-code') ||
      el.getAttribute('data-client-defined-widget') === 'code_block'
    );
  }

  function codeBlock(el) {
    const pre = el.tagName === 'PRE' ? el : el.querySelector('pre');
    const code = pre?.querySelector('code') || pre;
    const copy =
      el.closest('[data-chatgpt-copy-code]') ||
      el.querySelector('[data-chatgpt-copy-code]');
    let text = copy?.getAttribute('data-chatgpt-copy-code');
    if (!text) {
      // CodeMirror-style viewers put each line in its own element
      const lines = code ? $$('.cm-line', code) : [];
      text = lines.length
        ? lines.map((l) => l.textContent).join('\n')
        : code?.innerText || code?.textContent || el.innerText || '';
    }
    let lang =
      (code?.className?.match?.(/language-([\w+#.-]+)/) || [])[1] || '';
    if (!lang) {
      const box =
        el.closest(
          '[data-client-defined-widget="code_block"], code-block, [role="group"]'
        ) ||
        pre?.parentElement?.parentElement ||
        el;
      for (const c of $$('span, div', box)) {
        if (c.children.length || pre?.contains(c)) continue;
        const t = c.textContent.trim();
        if (
          t &&
          t.length <= 20 &&
          !LANG_SKIP.test(t) &&
          /^[\w+#. -]+$/.test(t)
        ) {
          lang = t;
          break;
        }
      }
    }
    lang = lang.toLowerCase();
    return `<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(text.replace(/\n+$/, ''))}</code></pre>`;
  }

  function mathml(m) {
    const c = m.cloneNode(true);
    const tex = (
      c.querySelector('annotation[encoding="application/x-tex"]')
        ?.textContent || ''
    ).trim();
    c.querySelectorAll('annotation, annotation-xml').forEach((a) => a.remove());
    for (const e of [c, ...c.querySelectorAll('*')])
      for (const a of [...e.attributes])
        if (
          !/^(display|mathvariant|stretchy|fence|separator|accent|accentunder|lspace|rspace|columnalign|rowspacing|columnspacing|mathsize|movablelimits|largeop|symmetric|minsize|maxsize|linethickness|width|height|depth|xmlns)$/.test(
            a.name
          )
        )
          e.removeAttribute(a.name);
    const block =
      m.getAttribute('display') === 'block' ||
      !!m.closest('.katex-display, .math-block');
    c.setAttribute('display', block ? 'block' : 'inline');
    const html = c.outerHTML.replace(/<math\b/, `<math data-tex="${esc(tex)}"`);
    return block ? `<div class="math">${html}</div>` : html;
  }

  const images = []; // each picture once, however often its message is re-read
  const imageIndex = new Map();

  function walk(node, out, pre) {
    if (node.nodeType === 3) {
      let t = esc(node.data);
      if (pre) t = t.replace(/\n/g, '<br>');
      out.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === 'math') return void out.push(mathml(el));
    if (el.getAttribute('aria-hidden') === 'true') return;
    if (HIDDEN_CLASS.test(el.className?.baseVal ?? el.className ?? '')) return;
    if (
      el.getAttribute('data-markdown-copy') === 'exclude' ||
      el.hasAttribute('data-find-omitted')
    )
      return;
    if (
      el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'tooltip'
    )
      return;
    // KaTeX without MathML: keep the TeX source
    if (el.classList.contains('katex') && !el.querySelector('math')) {
      const tex = el.querySelector('annotation')?.textContent;
      if (tex) return void out.push(`<code class="tex">${esc(tex)}</code>`);
    }
    if (isCodeBlock(el)) return void out.push(codeBlock(el));
    let cs;
    try {
      cs = getComputedStyle(el);
    } catch {
      cs = null;
    }
    if (cs && cs.display === 'none') return;
    const kidPre = pre || (cs ? /^pre/.test(cs.whiteSpace) : false);

    if (tag === 'img') {
      const src = el.currentSrc || el.src;
      const w = el.naturalWidth || el.width;
      if (!src || !/^(https?:|data:|blob:)/.test(src) || (w && w < 28)) return;
      let i = imageIndex.get(src);
      if (i === undefined) imageIndex.set(src, (i = images.push({ src }) - 1));
      out.push(
        `<img data-i="${i}" src="${esc(src)}" alt="${esc(el.alt || '')}">`
      );
      return;
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      let abs = '';
      try {
        const u = new URL(href, location.href);
        for (const k of [...u.searchParams.keys()])
          if (/^utm_/i.test(k)) u.searchParams.delete(k);
        abs = u.href;
      } catch {
        /* bad link */
      }
      if (/^(https?:|mailto:)/.test(abs)) {
        out.push(`<a href="${esc(abs)}">`);
        for (const c of el.childNodes) walk(c, out, kidPre);
        out.push('</a>');
        return;
      }
    }
    if (tag === 'code') {
      out.push('<code>' + esc(el.textContent) + '</code>');
      return;
    }
    if (KEEP.has(tag)) {
      let attrs = '';
      if (tag === 'td' || tag === 'th') {
        for (const a of ['colspan', 'rowspan'])
          if (el.getAttribute(a)) attrs += ` ${a}="${esc(el.getAttribute(a))}"`;
        const al = cs?.textAlign;
        if (al === 'center' || al === 'right') attrs += ` align="${al}"`;
      }
      if (tag === 'ol' && el.getAttribute('start'))
        attrs += ` start="${esc(el.getAttribute('start'))}"`;
      if (tag === 'details') attrs += ' open';
      out.push(`<${tag}${attrs}>`);
      for (const c of el.childNodes) walk(c, out, kidPre);
      if (!/^(br|hr)$/.test(tag)) out.push(`</${tag}>`);
      return;
    }
    // anything else: a plain block or nothing, depending on how the page shows it
    const block =
      cs && /^(block|flex|grid|list-item|table|flow-root)$/.test(cs.display);
    if (block) out.push('<div>');
    for (const c of el.childNodes) walk(c, out, kidPre);
    if (block) out.push('</div>');
  }

  function clean(roots, skip) {
    const out = [];
    for (const r of roots) {
      if (skip) skip.setAttribute('aria-hidden', 'true');
      walk(r, out, false);
      if (skip) skip.removeAttribute('aria-hidden');
    }
    return out
      .join('')
      .replace(/(<div>\s*<\/div>)+/g, '')
      .trim();
  }

  // ---------- images: copy them into the document so the export works offline ----------

  function toDataUrl(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  }

  async function inlineImage(src) {
    if (src.startsWith('data:')) return src;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(src, {
        credentials: 'include',
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') || blob.size > 12e6) return null;
      return await toDataUrl(blob);
    } catch {
      return null;
    }
  }

  // ---------- scrolling: chat apps only keep part of a long chat in the page ----------

  function scrollerOf(el) {
    for (
      let e = el?.parentElement;
      e && e !== document.body;
      e = e.parentElement
    ) {
      const s = getComputedStyle(e);
      if (
        /(auto|scroll|overlay)/.test(s.overflowY) &&
        e.scrollHeight > e.clientHeight + 4
      )
        return e;
    }
    return document.scrollingElement || document.documentElement;
  }

  function toast(text) {
    let t = document.getElementById('plyleaf-chat-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'plyleaf-chat-toast';
      t.setAttribute('role', 'status');
      t.style.cssText =
        'position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 16px;border-radius:10px;background:#2b2621;color:#f3f0ea;font:500 14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none';
      document.documentElement.append(t);
    }
    t.textContent = text;
    return () => t.remove();
  }

  function cleanTitle() {
    let t = document.title || '';
    t = t.replace(
      /\s*[-|–—·:]\s*(ChatGPT|Claude|Google Gemini|Gemini|Perplexity|DeepSeek|Grok|Microsoft Copilot|Copilot|Le Chat|Mistral AI)\s*$/i,
      ''
    );
    t = t.replace(
      /^(ChatGPT|Claude|Google Gemini|Gemini|Perplexity|DeepSeek|Grok|Copilot|Microsoft Copilot|Le Chat|New chat|New session)$/i,
      ''
    );
    return t.trim();
  }

  window.__plyleafExtract = async function () {
    const site = SITES.find((s) => s.test.test(host)) || {
      id: 'other',
      name: 'AI',
      reader: 'generic',
    };
    const read = readers[site.reader || site.id] || readers.generic;
    let turns = read();
    if (!turns.length && read !== readers.generic) turns = readers.generic();
    if (!turns.length) return { error: 'no-chat' };

    const done = toast('Plyleaf is reading the chat…');
    const order = []; // keys in page order
    const got = new Map(); // key -> { role, html }

    const grab = () => {
      let cur = read();
      if (!cur.length && read !== readers.generic) cur = readers.generic();
      let prev = null;
      cur.forEach((t, i) => {
        const html = clean(t.parts || [t.el], t.skipHeading);
        const old = got.get(t.key);
        if (!old) {
          let at = prev ? order.indexOf(prev) + 1 : -1;
          if (at < 0) {
            const next = cur.slice(i + 1).find((n) => got.has(n.key));
            at = next ? order.indexOf(next.key) : order.length;
          }
          order.splice(at, 0, t.key);
          got.set(t.key, { role: t.role, html });
        } else if (html.length > old.html.length) old.html = html;
        prev = t.key;
      });
    };

    const scroller = scrollerOf(turns[0].el || turns[0].parts?.[0]);
    const start = scroller.scrollTop;
    try {
      if (scroller.scrollHeight > scroller.clientHeight + 40) {
        // load older messages first
        let h = -1;
        for (let n = 0; n < 40 && scroller.scrollHeight !== h; n++) {
          h = scroller.scrollHeight;
          scroller.scrollTop = 0;
          await sleep(n ? 700 : 300);
          grab();
        }
        // then walk down so every message is rendered once
        const step = Math.max(200, scroller.clientHeight * 0.7);
        for (let y = 0; y <= scroller.scrollHeight; y += step) {
          scroller.scrollTop = y;
          await sleep(160);
          grab();
        }
      }
      grab();
    } finally {
      scroller.scrollTop = start;
    }

    done();
    const doneImg = images.length
      ? toast('Plyleaf is copying images…')
      : () => {};
    const urls = await Promise.all(images.map((im) => inlineImage(im.src)));
    doneImg();

    const result = order
      .map((k) => got.get(k))
      .filter(
        (t) =>
          t.html.replace(/<[^>]+>/g, '').trim() ||
          /<(img|math|pre)/.test(t.html)
      )
      .map((t) => ({
        role: t.role,
        html: t.html.replace(/<img data-i="(\d+)" src="[^"]*"/g, (m, i) =>
          urls[i] ? `<img src="${urls[i]}"` : m.replace(/ data-i="\d+"/, '')
        ),
      }));
    if (!result.length) return { error: 'no-chat' };

    let title = cleanTitle();
    if (!title) {
      const first = result.find((t) => t.role === 'user');
      const doc = new DOMParser().parseFromString(
        first?.html || '',
        'text/html'
      );
      title = (doc.body.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 70);
    }
    return {
      site: { id: site.id, name: site.name },
      title: title || site.name + ' chat',
      url: location.href,
      date: new Date().toISOString(),
      turns: result,
    };
  };
})();
