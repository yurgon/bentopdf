// Graph paper generator: square grid, millimeter paper, dot grid, isometric and lined paper,
// drawn as vectors at exact size for print and PDF.
import {
  mountGenerator,
  formVal,
  formNum,
  formOn,
  presetPaper,
  defaultPaper,
} from '../print/gen';
import { t, tn } from '../i18n';
import {
  PAPER,
  MM,
  INCH,
  line,
  clip,
  circlePath,
  type Op,
  type Page,
  type Paper,
} from '../print/sheet';

presetPaper();

type Kind = 'square' | 'mm' | 'dots' | 'iso' | 'lined';
const form = document.getElementById('gen-form') as HTMLFormElement;
const stepInput = form.querySelector<HTMLInputElement>('input[name="step"]')!;
const unitText = document.getElementById('step-unit')!;
const presets = document.getElementById('step-presets')!;
if (defaultPaper() === 'letter') {
  // US visitors think in inches: start with 1/4 inch squares
  form.querySelector<HTMLInputElement>('#unit-in')!.checked = true;
  stepInput.value = '0.25';
}

const PRESETS: Record<string, [string, number][]> = {
  'mm:square': [
    ['5 mm', 5],
    ['1 cm', 10],
    ['4 mm', 4],
    ['2 mm', 2],
  ],
  'in:square': [
    ['1/4 in', 0.25],
    ['1/5 in', 0.2],
    ['1/2 in', 0.5],
    ['1 in', 1],
  ],
  'mm:dots': [
    ['5 mm', 5],
    ['1 cm', 10],
    ['4 mm', 4],
  ],
  'in:dots': [
    ['1/4 in', 0.25],
    ['1/5 in', 0.2],
    ['1/2 in', 0.5],
  ],
  'mm:iso': [
    ['5 mm', 5],
    ['1 cm', 10],
    ['8 mm', 8],
  ],
  'in:iso': [
    ['1/4 in', 0.25],
    ['1/2 in', 0.5],
    ['1 in', 1],
  ],
  'mm:lined': [
    ['Wide 8.7 mm', 8.7],
    ['College 7.1 mm', 7.1],
    ['Narrow 6.4 mm', 6.4],
  ],
  'in:lined': [
    ['Wide 11/32 in', 0.34375],
    ['College 9/32 in', 0.28125],
    ['Narrow 1/4 in', 0.25],
  ],
};
const DEFAULT_STEP: Record<string, number> = { mm: 5, in: 0.25 };

let lastKey = '';
function syncControls(): void {
  const kind = formVal('kind') as Kind;
  const unit = formVal('unit');
  form.dataset.kind = kind;
  // fields that only apply to some kinds
  form.querySelectorAll<HTMLElement>('[data-kinds]').forEach((el) => {
    el.hidden = !el.dataset.kinds!.split(' ').includes(kind);
  });
  unitText.textContent = unit === 'in' ? 'in' : 'mm';
  const key = `${unit}:${kind}`;
  if (key !== lastKey && kind !== 'mm') {
    const list = PRESETS[key] ?? [];
    presets.innerHTML = list
      .map(
        ([l, v]) =>
          `<button type="button" class="btn btn-sm btn-ghost" data-step="${v}">${l.replace(/^(Wide|College|Narrow)/, (w) => t(w))}</button>`
      )
      .join('');
    // when the unit or type changes, start from a sensible step
    const [prevUnit, prevKind] = lastKey.split(':');
    if (
      lastKey &&
      (prevUnit !== unit ||
        prevKind === 'lined' ||
        kind === 'lined' ||
        prevKind === 'mm')
    )
      stepInput.value = String(list[0]?.[1] ?? DEFAULT_STEP[unit]);
  }
  lastKey = key;
  stepInput.step = unit === 'in' ? '0.05' : '0.5';
  presets
    .querySelectorAll<HTMLButtonElement>('[data-step]')
    .forEach((b) =>
      b.setAttribute(
        'aria-pressed',
        String(
          Math.abs(parseFloat(b.dataset.step!) - parseFloat(stepInput.value)) <
            1e-6
        )
      )
    );
  const thick = formNum('weight', 0.1, 1.5, 0.35);
  document.getElementById('weight-out')!.textContent = `${thick.toFixed(2)} pt`;
}
presets.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-step]');
  if (!b) return;
  stepInput.value = b.dataset.step!;
  form.dispatchEvent(new Event('input'));
});
form.addEventListener('input', syncControls, true);
form.addEventListener('change', syncControls, true);
syncControls();

// ---------- drawing ----------
function build(): { pages: Page[]; summary: string; error?: string } {
  const kind = formVal('kind') as Kind;
  const unit = formVal('unit') === 'in' ? INCH : MM;
  const [pw, ph] = PAPER[(formVal('paper') || 'a4') as Paper];
  const land = formVal('orient') === 'landscape';
  const W = land ? ph : pw;
  const H = land ? pw : ph;
  const color = formVal('color') || '#8c8c8c';
  const weight = formNum('weight', 0.1, 1.5, 0.35);
  const margin = formNum('margin', 0, 40, 10) * MM;
  const count = Math.round(formNum('pages', 1, 100, 1));
  const step = kind === 'mm' ? MM : formNum('step', 0.04, 200, 5) * unit;
  const major = kind === 'mm' ? 10 : Math.round(formNum('major', 0, 20, 0));

  if (step < 0.9 * MM && kind !== 'mm')
    return {
      pages: [],
      summary: '',
      error: t('That step is too small to print clearly. Use 1 mm or more.'),
    };
  const area = { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin };
  if (area.w < step * 2 || area.h < step * 2)
    return {
      pages: [],
      summary: '',
      error: t('The margins leave no room for the grid. Make them smaller.'),
    };

  const ops: Op[] = [];
  let summary: string;
  const fmtStep =
    unit === INCH
      ? `${+(step / INCH).toFixed(3)} in`
      : `${+(step / MM).toFixed(2)} mm`;

  if (kind === 'square' || kind === 'mm' || kind === 'dots') {
    let nx = Math.floor(area.w / step + 1e-6);
    let ny = Math.floor(area.h / step + 1e-6);
    if (major > 1 && kind !== 'dots') {
      // end the grid on a bold line when there is room for at least one block
      if (nx >= major) nx -= nx % major;
      if (ny >= major) ny -= ny % major;
    }
    const gw = nx * step;
    const gh = ny * step;
    const x0 = (W - gw) / 2;
    const y0 = (H - gh) / 2;
    if (kind === 'dots') {
      let d = '';
      const r = Math.max(0.5, weight * 2);
      for (let i = 0; i <= nx; i++)
        for (let j = 0; j <= ny; j++)
          d += circlePath(x0 + i * step, y0 + j * step, r);
      ops.push({ t: 'path', d, fill: color });
      summary = t('{step} dot grid, {a} × {b} dots', {
        step: fmtStep,
        a: nx + 1,
        b: ny + 1,
      });
    } else {
      // three weights: fine lines, medium every 5 mm on millimeter paper, bold on the major lines
      const fine: string[] = [];
      const mid: string[] = [];
      const bold: string[] = [];
      const pick = (k: number) =>
        major > 1 && k % major === 0
          ? bold
          : kind === 'mm' && k % 5 === 0
            ? mid
            : fine;
      for (let i = 0; i <= nx; i++)
        pick(i).push(line(x0 + i * step, y0, x0 + i * step, y0 + gh));
      for (let j = 0; j <= ny; j++)
        pick(j).push(line(x0, y0 + j * step, x0 + gw, y0 + j * step));
      const w1 = kind === 'mm' ? weight * 0.6 : weight;
      if (fine.length)
        ops.push({ t: 'path', d: fine.join(''), stroke: color, sw: w1 });
      if (mid.length)
        ops.push({
          t: 'path',
          d: mid.join(''),
          stroke: color,
          sw: weight * 1.1,
        });
      if (bold.length)
        ops.push({
          t: 'path',
          d: bold.join(''),
          stroke: color,
          sw: weight * (kind === 'mm' ? 1.9 : 2.2),
        });
      summary =
        kind === 'mm'
          ? t('1 mm grid, bold every 1 cm, {a} × {b} mm', {
              a: (gw / MM) | 0,
              b: (gh / MM) | 0,
            })
          : t('{step} squares, {a} × {b}', { step: fmtStep, a: nx, b: ny });
    }
  } else if (kind === 'iso') {
    // vertical lines plus two families at 30 degrees: equilateral triangles of side `step`
    const h = (step * Math.sqrt(3)) / 2;
    const nx = Math.floor(area.w / h + 1e-6);
    const ny = Math.floor(area.h / step + 1e-6);
    const box = {
      x: (W - nx * h) / 2,
      y: (H - ny * step) / 2,
      w: nx * h,
      h: ny * step,
    };
    const parts: string[] = [];
    for (let i = 0; i <= nx; i++)
      parts.push(line(box.x + i * h, box.y, box.x + i * h, box.y + box.h));
    const k = 1 / Math.sqrt(3);
    const span = box.w * k + box.h;
    for (const dir of [1, -1]) {
      // y = y0 + c * step + dir * k * (x - x0)
      const n = Math.ceil(span / step) + 2;
      for (let c = -n; c <= n; c++) {
        // both families start on the left edge at whole steps, so they cross on the vertical lines
        const cy = box.y + c * step;
        const x1 = box.x - 10;
        const x2 = box.x + box.w + 10;
        const y1 = cy + dir * k * (x1 - box.x);
        const y2 = cy + dir * k * (x2 - box.x);
        const s = clip(x1, y1, x2, y2, box);
        if (s && Math.hypot(s[2] - s[0], s[3] - s[1]) > 0.5)
          parts.push(line(...s));
      }
    }
    ops.push({ t: 'path', d: parts.join(''), stroke: color, sw: weight });
    summary = t('{step} isometric triangles', { step: fmtStep });
  } else {
    // lined paper: header space, writing lines, optional red margin line
    const top = margin + (formOn('header') ? 18 * MM : 0);
    const n = Math.floor((H - margin - top) / step + 1e-6);
    const parts: string[] = [];
    for (let j = 0; j <= n; j++)
      parts.push(line(margin, top + j * step, W - margin, top + j * step));
    ops.push({ t: 'path', d: parts.join(''), stroke: color, sw: weight });
    if (formOn('header'))
      ops.push({
        t: 'path',
        d: line(margin, top - 6 * MM, W - margin, top - 6 * MM),
        stroke: color,
        sw: weight * 1.6,
      });
    if (formOn('marginline')) {
      const mx = margin + 25 * MM;
      ops.push({
        t: 'path',
        d: line(mx, margin, mx, H - margin),
        stroke: '#e0565b',
        sw: Math.max(0.5, weight),
      });
    }
    summary = tn(n + 1, '{n} line, {step} apart', '{n} lines, {step} apart', {
      step: fmtStep,
    });
  }

  const paperName = formVal('paper') === 'letter' ? t('Letter') : 'A4';
  const pages = Array.from({ length: count }, () => ({ w: W, h: H, ops }));
  return {
    pages,
    summary: `${summary} · ${paperName}${count > 1 ? ` · ${tn(count, '{n} page', '{n} pages')}` : ''}`,
  };
}

mountGenerator({
  tool: 'graph-paper',
  title: t('Graph paper'),
  fileName: () => {
    const kind = formVal('kind');
    const name =
      {
        square: 'graph-paper',
        mm: 'millimeter-paper',
        dots: 'dot-grid-paper',
        iso: 'isometric-paper',
        lined: 'lined-paper',
      }[kind] ?? 'graph-paper';
    return `${name}-${formVal('paper')}.pdf`;
  },
  previewMax: 1,
  build,
});
