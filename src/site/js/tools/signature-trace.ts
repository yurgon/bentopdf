// Signature generator: pixel work that has nothing to do with the page.
// - photoMask(): turns a photo of a signature on paper into an ink mask (alpha 0–255),
//   evening out uneven light and dropping specks;
// - grow(): makes ink lines thicker or thinner;
// - bbox(): the box around the ink;
// - tracePath(): outlines the ink as SVG path data (marching squares + simplification),
//   so the SVG download is a real vector file, not an embedded picture.

export interface Mask {
  a: Uint8ClampedArray; // alpha per pixel, 0 = paper, 255 = ink
  w: number;
  h: number;
}

/** Ink mask from an image of a signature on (roughly) white paper. `level` −30…30 moves the cut-off. */
export function photoMask(
  src: CanvasImageSource,
  sw: number,
  sh: number,
  level = 0
): Mask {
  const MAX = 1600;
  const k = Math.min(1, MAX / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; // transparent PNGs: treat see-through as paper
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4)
    gray[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];

  // paper brightness: brightest value in each block (ink is thin, so the block max is paper),
  // smoothed and stretched back over the image; dividing by it removes shadows and gradients
  const B = Math.max(8, Math.round(Math.max(w, h) / 50));
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  let blocks = new Float32Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = ((y / B) | 0) * bw;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      const bi = by + ((x / B) | 0);
      if (v > blocks[bi]) blocks[bi] = v;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        let s = 0;
        let m = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue;
            s += blocks[yy * bw + xx];
            m++;
          }
        // keep the brighter of the block and its neighbourhood, so a big ink blob does not darken the paper
        next[y * bw + x] = Math.max(blocks[y * bw + x] * 0.85, s / m);
      }
    blocks = next;
  }
  const dark = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, y / B - 0.5));
    const y0 = fy | 0;
    const y1 = Math.min(bh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / B - 0.5));
      const x0 = fx | 0;
      const x1 = Math.min(bw - 1, x0 + 1);
      const tx = fx - x0;
      const bg =
        (blocks[y0 * bw + x0] * (1 - tx) + blocks[y0 * bw + x1] * tx) *
          (1 - ty) +
        (blocks[y1 * bw + x0] * (1 - tx) + blocks[y1 * bw + x1] * tx) * ty;
      const d = Math.min(
        1,
        Math.max(0, 1 - gray[y * w + x] / Math.max(bg, 24))
      );
      dark[y * w + x] = d;
      hist[Math.min(255, (d * 255) | 0)]++;
    }
  }

  // Otsu's threshold on darkness, then nudged by the user's "clean-up" slider
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let otsu = 40;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      otsu = i;
    }
  }
  const t = Math.min(0.85, Math.max(0.07, otsu / 255 + level * 0.006));
  const lo = t * 0.7;
  const hi = Math.min(1, t * 1.3 + 0.02);
  const a = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const d = dark[i];
    if (d <= lo) continue;
    const s = d >= hi ? 1 : (d - lo) / (hi - lo);
    a[i] = 255 * s * s * (3 - 2 * s);
  }
  dropSpecks(a, w, h);
  return { a, w, h };
}

/** Removes ink blobs that are too small to be part of a signature (dust, paper grain). */
function dropSpecks(a: Uint8ClampedArray, w: number, h: number): void {
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const comps: { start: number; size: number; pixels: Int32Array }[] = [];
  let biggest = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i] || a[i] < 110) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    seen[i] = 1;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (!seen[q] && a[q] >= 110) {
            seen[q] = 1;
            queue[tail++] = q;
          }
        }
    }
    comps.push({ start: i, size: tail, pixels: queue.slice(0, tail) });
    if (tail > biggest) biggest = tail;
  }
  const minSize = Math.max(14, Math.min(biggest * 0.02, n * 0.00004));
  for (const c of comps) {
    if (c.size >= minSize) continue;
    for (const p of c.pixels) {
      const x = p % w;
      const y = (p / w) | 0;
      // clear the blob and its soft edge
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) a[yy * w + xx] = 0;
        }
    }
  }
}

/** Thicker (r > 0) or thinner (r < 0) lines: a separable max or min filter of radius |r|. */
export function grow(m: Mask, r: number): Mask {
  if (!r) return m;
  const { w, h } = m;
  const R = Math.abs(r);
  const pick = r > 0 ? Math.max : Math.min;
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = m.a[y * w + x];
      for (let d = 1; d <= R; d++) {
        if (x - d >= 0) v = pick(v, m.a[y * w + x - d]);
        if (x + d < w) v = pick(v, m.a[y * w + x + d]);
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let d = 1; d <= R; d++) {
        if (y - d >= 0) v = pick(v, tmp[(y - d) * w + x]);
        if (y + d < h) v = pick(v, tmp[(y + d) * w + x]);
      }
      out[y * w + x] = v;
    }
  return { a: out, w, h };
}

/** Box around the ink, or null when there is none. */
export function bbox(
  a: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  stride = 1,
  offset = 0,
  min = 10
): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (a[(row + x) * stride + offset] > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

type Pt = [number, number];

/**
 * Outlines of the ink as SVG path data (fill-rule evenodd), in pixel units of the mask.
 * Marching squares with sub-pixel interpolation, then Ramer–Douglas–Peucker simplification
 * and smooth quadratic curves through the remaining points.
 */
export function tracePath(
  alphaAt: (x: number, y: number) => number,
  w: number,
  h: number
): string {
  const T = 128;
  // padded grid so every outline closes
  const W = w + 2;
  const H = h + 2;
  const g = new Uint8Array(W * H);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) g[(y + 1) * W + x + 1] = alphaAt(x, y);

  const pts = new Map<number, Pt>(); // edge key → interpolated point
  const links = new Map<number, number[]>(); // edge key → the other ends of its segments
  const edgePoint = (key: number): Pt => {
    let p = pts.get(key);
    if (p) return p;
    const cell = key >> 1;
    const x = cell % W;
    const y = (cell / W) | 0;
    const a = g[cell];
    if (key & 1) {
      const b = g[cell + W]; // vertical edge (x,y)–(x,y+1)
      p = [x, y + (T - a) / (b - a || 1)];
    } else {
      const b = g[cell + 1]; // horizontal edge (x,y)–(x+1,y)
      p = [x + (T - a) / (b - a || 1), y];
    }
    pts.set(key, p);
    return p;
  };
  const link = (k1: number, k2: number) => {
    edgePoint(k1);
    edgePoint(k2);
    (links.get(k1) ?? links.set(k1, []).get(k1)!).push(k2);
    (links.get(k2) ?? links.set(k2, []).get(k2)!).push(k1);
  };
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      const tl = g[i] >= T ? 8 : 0;
      const tr = g[i + 1] >= T ? 4 : 0;
      const br = g[i + W + 1] >= T ? 2 : 0;
      const bl = g[i + W] >= T ? 1 : 0;
      const c = tl | tr | br | bl;
      if (c === 0 || c === 15) continue;
      const top = i * 2;
      const bottom = (i + W) * 2;
      const left = i * 2 + 1;
      const right = (i + 1) * 2 + 1;
      switch (c) {
        case 1:
        case 14:
          link(left, bottom);
          break;
        case 2:
        case 13:
          link(bottom, right);
          break;
        case 3:
        case 12:
          link(left, right);
          break;
        case 4:
        case 11:
          link(top, right);
          break;
        case 6:
        case 9:
          link(top, bottom);
          break;
        case 7:
        case 8:
          link(left, top);
          break;
        case 5:
        case 10: {
          const centre = (g[i] + g[i + 1] + g[i + W] + g[i + W + 1]) / 4 >= T;
          const inkTlBr = c === 10;
          if (centre === inkTlBr) {
            link(top, right);
            link(left, bottom);
          } else {
            link(left, top);
            link(bottom, right);
          }
          break;
        }
      }
    }

  const used = new Set<number>();
  const parts: string[] = [];
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1;
    let cur = start;
    while (!used.has(cur)) {
      used.add(cur);
      const p = pts.get(cur)!;
      loop.push([p[0] - 1, p[1] - 1]);
      const next = links.get(cur)!.find((k) => k !== prev && !used.has(k));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length < 3) continue;
    const s = simplify(loop, 0.45);
    if (s.length < 3) continue;
    // smooth closed curve: start at the midpoint of the first edge, then Q through each point
    const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m0 = mid(s[s.length - 1], s[0]);
    let d = `M${f(m0[0])} ${f(m0[1])}`;
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      const m = mid(p, s[(i + 1) % s.length]);
      d += `Q${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])}`;
    }
    parts.push(`${d}Z`);
  }
  return parts.join('');
}

/** Ramer–Douglas–Peucker on a closed loop (iterative, so long outlines do not overflow the stack). */
function simplify(p: Pt[], eps: number): Pt[] {
  if (p.length < 8) return p;
  // split the loop at the point farthest from the start, simplify both halves
  let far = 0;
  let fd = -1;
  for (let i = 1; i < p.length; i++) {
    const d = (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const keep = new Uint8Array(p.length + 1);
  keep[0] = keep[far] = keep[p.length] = 1;
  const at = (i: number) => p[i % p.length];
  const stack: [number, number][] = [
    [0, far],
    [far, p.length],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const [ax, ay] = at(a);
    const [bx, by] = at(b);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let idx = -1;
    let max = eps;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = at(i);
      const d = Math.abs(dy * x - dx * y + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) if (keep[i]) out.push(p[i]);
  return out;
}
