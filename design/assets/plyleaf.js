// Plyleaf prototype behaviour: theme toggle + booklet tool demo (no real PDF processing here).
(function () {
  const root = document.documentElement;

  // ---- theme toggle: system by default, explicit choice remembered per viewer
  const tgl = document.getElementById('theme-toggle');
  const isDark = () =>
    root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
  const paintToggle = () => {
    if (!tgl) return;
    const dark = isDark();
    tgl.setAttribute(
      'aria-label',
      dark ? 'Switch to light theme' : 'Switch to dark theme'
    );
    tgl.querySelector('use').setAttribute('href', dark ? '#sun' : '#moon');
  };
  try {
    const t = localStorage.getItem('plyleaf-theme');
    if (t) root.dataset.theme = t;
  } catch (e) {}
  paintToggle();
  tgl &&
    tgl.addEventListener('click', () => {
      root.dataset.theme = isDark() ? 'light' : 'dark';
      try {
        localStorage.setItem('plyleaf-theme', root.dataset.theme);
      } catch (e) {}
      paintToggle();
    });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.(
    'change',
    paintToggle
  );

  // ---- home: filter tools by text
  const q = document.getElementById('tool-search');
  if (q) {
    const items = [...document.querySelectorAll('[data-tool]')];
    const groups = [...document.querySelectorAll('[data-group]')];
    const empty = document.getElementById('search-empty');
    q.addEventListener('input', () => {
      const v = q.value.trim().toLowerCase();
      let shown = 0;
      items.forEach((li) => {
        const hit = !v || li.textContent.toLowerCase().includes(v);
        li.hidden = !hit;
        if (hit) shown++;
      });
      groups.forEach((g) => {
        g.hidden = !!v && !g.querySelector('[data-tool]:not([hidden])');
      });
      if (empty) empty.hidden = shown > 0;
    });
  }

  // ---- booklet tool
  const tool = document.getElementById('tool');
  if (!tool) return;
  const $ = (id) => document.getElementById(id);
  const drop = $('drop-zone'),
    input = $('file-input'),
    fileArea = $('file-display-area'),
    opts = $('tool-options');
  const make = $('make-btn'),
    prog = $('progress'),
    bar = $('progress-bar'),
    pLabel = $('progress-label'),
    pPct = $('progress-pct');
  const result = $('result'),
    preview = $('booklet-preview'),
    sum = $('preview-sum'),
    err = $('drop-error'),
    toast = $('toast');
  const SIZES = {
    a5: ['A4', 'A5'],
    hl: ['Letter', 'half Letter'],
    a4: ['A3', 'A4'],
  };
  let file = null;

  const fmtSize = (b) =>
    b > 1e6
      ? (b / 1e6).toFixed(1) + ' MB'
      : Math.max(1, Math.round(b / 1e3)) + ' KB';
  const val = (name) =>
    tool.querySelector(`input[name="${name}"]:checked`).value;

  function sheetsFor(n, rtl) {
    const N = Math.ceil(n / 4) * 4,
      out = [];
    for (let s = 0; s < N / 4; s++) {
      let front = [N - 2 * s, 2 * s + 1],
        back = [2 * s + 2, N - 2 * s - 1];
      if (rtl) {
        front = front.reverse();
        back = back.reverse();
      }
      out.push({ front, back });
    }
    return { N, out };
  }
  const cell = (p, n, N) => {
    const cls = p > n ? 'blank' : p === 1 || p === N ? 'cover' : '';
    return `<span class="${cls}" aria-label="${p > n ? 'blank page' : 'page ' + p}">${p > n ? '–' : p}</span>`;
  };
  function render() {
    if (!file) return;
    const n = file.pages,
      { N, out } = sheetsFor(n, val('bind') === 'r');
    const two = val('duplex') === 'manual';
    preview.innerHTML = out
      .map(
        (sh, i) => `
      <div class="sheet">
        <div class="sheet-sides">
          <div class="spread">${cell(sh.front[0], n, N)}${cell(sh.front[1], n, N)}</div>
          <div class="spread">${cell(sh.back[0], n, N)}${cell(sh.back[1], n, N)}</div>
        </div>
        <div class="sheet-cap tnum"><span>Sheet ${i + 1}</span><span>${two ? 'pass 1 · pass 2' : 'front · back'}</span></div>
      </div>`
      )
      .join('');
    const blanks = N - n,
      [from, to] = SIZES[val('size')];
    sum.textContent =
      `${N} pages on ${out.length} ${out.length === 1 ? 'sheet' : 'sheets'} of ${from}` +
      (blanks
        ? ` · ${blanks} blank ${blanks === 1 ? 'page' : 'pages'} added at the end`
        : '');
    $('result-sub').textContent =
      `${file.name.replace(/\.pdf$/i, '')}-booklet.pdf · ${out.length} ${out.length === 1 ? 'sheet' : 'sheets'} · ${to}` +
      (two ? ' · two passes' : '');
  }
  function setFile(f) {
    file = f;
    err.hidden = true;
    drop.dataset.state = 'idle';
    $('file-name').textContent = f.name;
    $('file-info').textContent =
      `${f.pages} pages · ${fmtSize(f.size)}` +
      (f.demo ? ' · page count simulated in this prototype' : '');
    drop.hidden = true;
    fileArea.hidden = false;
    opts.hidden = false;
    result.hidden = true;
    prog.hidden = true;
    make.disabled = false;
    make.hidden = false;
    render();
  }
  function reset() {
    file = null;
    input.value = '';
    drop.hidden = false;
    fileArea.hidden = true;
    opts.hidden = true;
    result.hidden = true;
    prog.hidden = true;
    make.disabled = true;
    make.hidden = false;
    make.removeAttribute('data-loading');
    make.textContent = 'Make booklet';
  }
  function fail(msg) {
    drop.dataset.state = 'error';
    err.textContent = msg;
    err.hidden = false;
  }

  $('sample-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFile({ name: 'field-notes.pdf', pages: 14, size: 2.1e6 });
  });
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name))
      return fail(`“${f.name}” is not a PDF. Choose a file that ends in .pdf.`);
    setFile({ name: f.name, pages: 14, size: f.size, demo: true });
  });
  ['dragenter', 'dragover'].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.dataset.state = 'over';
    })
  );
  ['dragleave', 'dragend'].forEach((t) =>
    drop.addEventListener(t, () => {
      drop.dataset.state = 'idle';
    })
  );
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.dataset.state = 'idle';
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name))
      return fail(`“${f.name}” is not a PDF. Choose a file that ends in .pdf.`);
    setFile({ name: f.name, pages: 14, size: f.size, demo: true });
  });
  $('remove-file').addEventListener('click', reset);
  $('restart-btn').addEventListener('click', reset);
  tool.addEventListener('change', (e) => {
    if (e.target.name && e.target.name !== 'file') render();
  });

  make.addEventListener('click', () => {
    if (!file || make.disabled) return;
    make.disabled = true;
    make.dataset.loading = 'true';
    make.innerHTML =
      '<span class="spinner" aria-hidden="true"></span>Making booklet';
    opts.hidden = true;
    prog.hidden = false;
    const stages = [
      [0, 'Reading pages'],
      [30, 'Arranging pages on sheets'],
      [70, 'Writing the PDF'],
      [100, 'Done'],
    ];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pct = 0;
    const tick = () => {
      pct = Math.min(100, pct + (reduce ? 100 : 4 + Math.random() * 7));
      bar.style.width = pct + '%';
      pPct.textContent = Math.round(pct) + '%';
      pLabel.textContent = stages.filter((s) => pct >= s[0]).pop()[1];
      if (pct < 100) return setTimeout(tick, 70);
      setTimeout(() => {
        prog.hidden = true;
        result.hidden = false;
        make.hidden = true;
        $('download-btn').focus({ preventScroll: true });
      }, 200);
    };
    tick();
  });
  $('download-btn').addEventListener('click', () => {
    toast.textContent = 'This is a design prototype, so no file is created.';
    toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  });
})();
