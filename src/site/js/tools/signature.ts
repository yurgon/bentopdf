// Signature generator: type a name in a handwriting font, draw with a finger or mouse,
// or clean up a photo of a signature on paper. Output: transparent PNG in two sizes, SVG,
// and a one-step "sign a PDF with it" (signature-sign.ts, loaded on demand).
// Everything happens on this device; nothing is sent or stored.
import '../../css/signature.css';
import { photoMask, grow, bbox, tracePath, type Mask } from './signature-trace';

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const FONTS = [
  'Sacramento',
  'Great Vibes',
  'Mrs Saint Delafield',
  'Herr Von Muellerhoff',
  'Allura',
  'Alex Brush',
  'Monsieur La Doulaise',
  'Dancing Script',
  'Parisienne',
  'Pinyon Script',
  'Kristi',
  'La Belle Aurore',
  'Cedarville Cursive',
  'Whisper',
];
const INK: Record<string, string> = { black: '#1a1a1a', blue: '#1f3a93' };
const PNG_W = 800;
const PNG_HD_W = 2400;

type Mode = 'type' | 'draw' | 'photo';
interface P {
  x: number;
  y: number;
  t: number;
}

const nameInput = $<HTMLInputElement>('sig-name');
const fontsBox = $('sig-fonts');
const pad = $<HTMLCanvasElement>('sig-pad');
const out = $<HTMLCanvasElement>('sig-out');
const weight = $<HTMLInputElement>('sig-weight');
const slant = $<HTMLInputElement>('sig-slant');
const level = $<HTMLInputElement>('photo-level');
const sizeHint = $('sig-size');
const buttons = ['dl-png', 'dl-png-hd', 'dl-svg', 'to-sign'].map((id) =>
  $<HTMLButtonElement>(id)
);

let mode: Mode = 'type';
let font = FONTS[0];
const strokes: P[][] = [];
let photo: ImageBitmap | null = null;
let photoBase: Mask | null = null; // mask before thickness, so the slider is quick
let photoBaseLevel = NaN;
let current: HTMLCanvasElement | null = null; // composed signature, full resolution

const ink = () =>
  INK[
    (document.querySelector('input[name="ink"]:checked') as HTMLInputElement)
      .value
  ];
const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, 40);
const baseName = () =>
  mode === 'type' && slug(nameInput.value)
    ? `signature-${slug(nameInput.value)}`
    : 'signature';

// ---------- font choices ----------
function buildFonts(): void {
  fontsBox.innerHTML = '';
  FONTS.forEach((f, i) => {
    const label = document.createElement('label');
    label.className = 'sig-font';
    label.innerHTML = `<input type="radio" name="font" value="${f}"${i === 0 ? ' checked' : ''} /><span class="sig-font-sample" style="font-family:'${f}'"></span><span class="sig-font-name">${f}</span>`;
    fontsBox.append(label);
  });
  updateSamples();
  fontsBox.addEventListener('change', (e) => {
    font = (e.target as HTMLInputElement).value;
    schedule();
  });
}
function updateSamples(): void {
  const text = nameInput.value.trim() || 'Your name';
  fontsBox
    .querySelectorAll<HTMLElement>('.sig-font-sample')
    .forEach((el) => (el.textContent = text));
}

// ---------- masks: black ink with alpha, at full resolution ----------
const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

async function typedMask(): Promise<HTMLCanvasElement | null> {
  const text = nameInput.value.trim();
  if (!text) return null;
  const F = 220;
  const css = `${F}px "${font}"`;
  await document.fonts.load(css, text);
  const probe = canvas(1, 1).getContext('2d')!;
  probe.font = css;
  const m = probe.measureText(text);
  const left = m.actualBoundingBoxLeft;
  const right = m.actualBoundingBoxRight;
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  const margin = F * 0.5;
  const c = canvas(left + right + margin * 2, asc + desc + margin * 2);
  const ctx = c.getContext('2d')!;
  ctx.font = css;
  ctx.fillStyle = ctx.strokeStyle = '#000';
  ctx.lineJoin = ctx.lineCap = 'round';
  const x = margin + left;
  const y = margin + asc;
  ctx.fillText(text, x, y);
  const lw = Math.max(0, (Number(weight.value) - 2) * F * 0.007);
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeText(text, x, y);
  }
  return c;
}

/** Draws strokes with a pen-like line: smooth curves, a little thinner where the hand moves fast. */
function paintStrokes(
  ctx: CanvasRenderingContext2D,
  k: number,
  base: number
): void {
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x * k, s[0].y * k, (base * k) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    let w = base;
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);
      const target = base * Math.min(1.2, Math.max(0.55, 1.25 - v * 0.22));
      w += (target - w) * 0.35;
      const m0 =
        i === 1 ? a : { x: (a.x + s[i - 2].x) / 2, y: (a.y + s[i - 2].y) / 2 };
      const m1 =
        i === s.length - 1 ? b : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.lineWidth = w * k;
      ctx.beginPath();
      ctx.moveTo(m0.x * k, m0.y * k);
      ctx.quadraticCurveTo(a.x * k, a.y * k, m1.x * k, m1.y * k);
      ctx.stroke();
    }
  }
}
const penBase = () => 0.6 + Number(weight.value) * 0.55;

function drawnMask(): HTMLCanvasElement | null {
  if (!strokes.length) return null;
  const w = pad.clientWidth || 600;
  const h = pad.clientHeight || 220;
  const k = 2400 / w;
  const c = canvas(w * k, h * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = ctx.strokeStyle = '#000';
  paintStrokes(ctx, k, penBase());
  return c;
}

function photoMaskCanvas(): HTMLCanvasElement | null {
  if (!photo) return null;
  const lv = Number(level.value);
  if (!photoBase || photoBaseLevel !== lv) {
    photoBase = photoMask(photo, photo.width, photo.height, lv);
    photoBaseLevel = lv;
  }
  const scale = Math.max(photoBase.w, photoBase.h) / 1000; // thickness steps feel the same on any photo
  const m = grow(
    photoBase,
    Math.round((Number(weight.value) - 4) * 0.6 * scale)
  );
  const c = canvas(m.w, m.h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(m.w, m.h);
  for (let i = 0; i < m.a.length; i++) img.data[i * 4 + 3] = m.a[i];
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Crop to the ink, lean it, colour it. Returns null when there is nothing to show. */
function compose(mask: HTMLCanvasElement): HTMLCanvasElement | null {
  const mctx = mask.getContext('2d', { willReadFrequently: true })!;
  const data = mctx.getImageData(0, 0, mask.width, mask.height).data;
  const box = bbox(data, mask.width, mask.height, 4, 3, 12);
  if (!box) return null;
  const tan = Math.tan((Number(slant.value) * Math.PI) / 180);
  const pad = Math.round(Math.max(box.w, box.h) * 0.03) + 4;
  const extra = Math.abs(tan) * box.h;
  const c = canvas(box.w + extra + pad * 2, box.h + pad * 2);
  const ctx = c.getContext('2d')!;
  // lean right for a positive slant: the top moves right, the bottom stays
  ctx.setTransform(1, 0, -tan, 1, pad + (tan > 0 ? extra : 0), pad);
  ctx.drawImage(mask, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = ink();
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---------- render ----------
let pending = 0;
let token = 0;
function schedule(): void {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => void render());
}
async function render(): Promise<void> {
  const my = ++token;
  let mask: HTMLCanvasElement | null = null;
  try {
    mask =
      mode === 'type'
        ? await typedMask()
        : mode === 'draw'
          ? drawnMask()
          : photoMaskCanvas();
  } catch (e) {
    console.error(e);
  }
  if (my !== token) return;
  current = mask ? compose(mask) : null;
  const has = !!current;
  buttons.forEach((b) => (b.disabled = !has));
  $('sig-empty').hidden = has;
  out.hidden = !has;
  if (!current) {
    sizeHint.textContent = 'Transparent background';
    return;
  }
  const k = Math.min(1, 1200 / current.width);
  out.width = Math.round(current.width * k);
  out.height = Math.round(current.height * k);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, out.width, out.height);
  const r = current.height / current.width;
  sizeHint.textContent = `PNG ${PNG_W} × ${Math.round(PNG_W * r)} or ${PNG_HD_W} × ${Math.round(PNG_HD_W * r)} px, transparent`;
}

// ---------- drawing pad ----------
let drawing: P[] | null = null;
function sizePad(): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = pad.clientWidth;
  const h = pad.clientHeight;
  if (!w || !h) return;
  pad.width = Math.round(w * dpr);
  pad.height = Math.round(h * dpr);
  repaintPad();
}
function repaintPad(): void {
  const ctx = pad.getContext('2d')!;
  const dpr = pad.width / (pad.clientWidth || 1);
  ctx.clearRect(0, 0, pad.width, pad.height);
  ctx.fillStyle = ctx.strokeStyle = ink();
  paintStrokes(ctx, dpr, penBase());
  $('pad-hint').hidden = strokes.length > 0;
  $<HTMLButtonElement>('pad-undo').disabled = !strokes.length;
  $<HTMLButtonElement>('pad-clear').disabled = !strokes.length;
}
function padPoint(e: PointerEvent): P {
  const r = pad.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
}
pad.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  e.preventDefault();
  try {
    pad.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or already released pointer: drawing still works without capture */
  }
  drawing = [padPoint(e)];
  strokes.push(drawing);
  repaintPad();
});
pad.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const co = e.getCoalescedEvents?.();
  const evs = co && co.length ? co : [e];
  for (const ev of evs) {
    const p = padPoint(ev);
    const last = drawing[drawing.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.2) drawing.push(p);
  }
  repaintPad();
});
const endStroke = () => {
  if (!drawing) return;
  drawing = null;
  schedule();
};
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);
$('pad-undo').addEventListener('click', () => {
  strokes.pop();
  repaintPad();
  schedule();
});
$('pad-clear').addEventListener('click', () => {
  strokes.length = 0;
  repaintPad();
  schedule();
});
new ResizeObserver(() => {
  // keep strokes where they were drawn when the pad changes width
  const old = Number(pad.dataset.w || 0);
  const w = pad.clientWidth;
  if (old && w && old !== w && strokes.length) {
    const k = w / old;
    for (const s of strokes) for (const p of s) ((p.x *= k), (p.y *= k));
  }
  if (w) pad.dataset.w = String(w);
  sizePad();
}).observe(pad);

// ---------- photo ----------
const photoInput = $<HTMLInputElement>('photo-input');
const photoDrop = $('photo-drop');
const photoErr = $('photo-error');
async function takePhoto(file: File | undefined): Promise<void> {
  if (!file) return;
  photoErr.hidden = true;
  if (
    !file.type.startsWith('image/') &&
    !/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name)
  ) {
    photoErr.textContent =
      'That is not an image. Choose a JPG or PNG photo of your signature.';
    photoErr.hidden = false;
    return;
  }
  try {
    photo?.close();
    photo = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    photo = null;
    photoErr.textContent =
      'This browser cannot open that photo. HEIC photos from an iPhone open in Safari; elsewhere, save the photo as JPG first.';
    photoErr.hidden = false;
    return;
  }
  photoBase = null;
  level.value = '0';
  photoDrop.hidden = true;
  $('photo-tune').hidden = false;
  schedule();
}
photoInput.addEventListener(
  'change',
  () => void takePhoto(photoInput.files?.[0])
);
photoDrop.addEventListener('dragover', (e) => {
  e.preventDefault();
  photoDrop.dataset.state = 'over';
});
photoDrop.addEventListener(
  'dragleave',
  () => (photoDrop.dataset.state = 'idle')
);
photoDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  photoDrop.dataset.state = 'idle';
  void takePhoto(e.dataTransfer?.files[0]);
});
$('photo-again').addEventListener('click', () => {
  photoInput.value = '';
  photoDrop.hidden = false;
  $('photo-tune').hidden = true;
  photo?.close();
  photo = null;
  photoBase = null;
  schedule();
  photoInput.click();
});
level.addEventListener('input', schedule);

// ---------- mode, settings ----------
document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => {
    mode = r.value as Mode;
    (['type', 'draw', 'photo'] as Mode[]).forEach(
      (m) => ($(`panel-${m}`).hidden = m !== mode)
    );
    if (mode === 'draw') requestAnimationFrame(sizePad);
    schedule();
  })
);
nameInput.addEventListener('input', () => {
  updateSamples();
  schedule();
});
weight.addEventListener('input', () => {
  if (mode === 'draw') repaintPad();
  schedule();
});
slant.addEventListener('input', schedule);
document.querySelectorAll<HTMLInputElement>('input[name="ink"]').forEach((r) =>
  r.addEventListener('change', () => {
    repaintPad();
    schedule();
  })
);

// ---------- downloads ----------
function scaled(src: HTMLCanvasElement, width: number): HTMLCanvasElement {
  let c = src;
  // halve in steps: a single big downscale looks jagged
  while (c.width / 2 >= width) {
    const n = canvas(c.width / 2, c.height / 2);
    const ctx = n.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, n.width, n.height);
    c = n;
  }
  const n = canvas(width, (width * src.height) / src.width);
  const ctx = n.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, n.width, n.height);
  return n;
}
const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((ok, no) =>
    c.toBlob((b) => (b ? ok(b) : no(new Error('png'))), 'image/png')
  );
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  document.dispatchEvent(
    new CustomEvent('plyleaf:done', { detail: { tool: 'signature-generator' } })
  );
}
export async function pngOf(width: number): Promise<Blob> {
  return toBlob(scaled(current!, width));
}
function svgOf(): Blob {
  const c = current!;
  // trace at no more than 2400 px wide: plenty of detail, quick to compute
  const t = c.width > PNG_HD_W ? scaled(c, PNG_HD_W) : c;
  const data = t
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, t.width, t.height).data;
  const d = tracePath(
    (x, y) => data[(y * t.width + x) * 4 + 3],
    t.width,
    t.height
  );
  const h = Math.round((PNG_W * t.height) / t.width);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PNG_W}" height="${h}" viewBox="0 0 ${t.width} ${t.height}"><path fill="${ink()}" fill-rule="evenodd" d="${d}"/></svg>\n`;
  return new Blob([svg], { type: 'image/svg+xml' });
}
$('dl-png').addEventListener('click', async () =>
  save(await pngOf(PNG_W), `${baseName()}.png`)
);
$('dl-png-hd').addEventListener('click', async () =>
  save(await pngOf(PNG_HD_W), `${baseName()}-large.png`)
);
$('dl-svg').addEventListener('click', () => save(svgOf(), `${baseName()}.svg`));

// ---------- sign a PDF ----------
$('to-sign').addEventListener('click', async () => {
  if (!current) return;
  const png = await pngOf(Math.min(1600, Math.max(800, current.width)));
  const { openSigner } = await import('./signature-sign');
  openSigner(png, current.width / current.height);
});

buildFonts();
render();
