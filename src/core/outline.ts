/**
 * Outline (line-art) detection on the levelled working image.
 *
 * Thin anti-aliased ink lines become blend colours after upscaling (dark green, dark red,
 * grey) and k-means hands them to the neighbouring colour; majorityFilter and
 * removeSmallRegions then erode what is left. This mask finds them directly from lightness:
 *
 * 1. Line pixels: black top-hat. The greyscale closing of L* (max then min filter over a
 *    square of radius `radiusPx`) fills dark structures narrower than about 2·radius with
 *    the lightness of their surroundings; a pixel is a line pixel when it is clearly darker
 *    than that (closing − L ≥ max(TOPHAT_MIN, TOPHAT_REL · closing)) and dark in absolute
 *    terms (L ≤ MAX_L). Step edges (a red area next to white) are not raised by a closing,
 *    so the darker side of an ordinary colour edge is not marked.
 * 2. Ink pixels: L < INK_L with low chroma (wide black areas, the cores of thick lines).
 * 3. Fringe: from those seeds, up to GROW_DEPTH px outwards into pixels that are still
 *    nearer to ink than to their brightest neighbour (dilation-based ratio ≥ GROW_REL).
 *    The depth limit keeps this from creeping along a dark-but-coloured fill.
 * 4. Every candidate must look like a blend of ink and its surroundings: its chroma may
 *    not exceed what the ink fraction leaves of the most saturated neighbour (plus
 *    CHROMA_TOL). This keeps saturated red slivers between white areas out.
 * 5. 8-connected components smaller than `minAreaPx` are dropped (specks, JPEG noise).
 *
 * All steps are O(pixels): the max/min filters use monotonic queues, independent of radius.
 */
import type { RGBAImage } from './types';

export interface OutlineOptions {
  /** Half-width of the widest line still treated as a line (px). */
  radiusPx: number;
  /** Connected outline pieces smaller than this are dropped (px). */
  minAreaPx: number;
}

// Tuned on test/fixtures/grinch-raster.jpg (see test/fixtureOutline.test.ts).
const TOPHAT_MIN = 10;
const TOPHAT_REL = 0.25;
/**
 * Faint strokes on white (pompom, hand) have cores around L* 45-58; the mid-grey zipper
 * teeth (L* ≈ 64, also narrow and darker than their surroundings) must stay above this.
 */
const MAX_L = 58;
const INK_L = 25;
const INK_MAX_CHROMA = 30;
const GROW_REL = 0.45;
const CHROMA_TOL = 15;

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const D3 = (6 / 29) ** 3;
const labF = (t: number) => (t > D3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
// labF sampled on [0, 1.1] (X/Xn, Y, Z/Zn of sRGB colours stay below 1.0001); the step
// keeps L* and a*, b* within about 0.05 of the exact value.
const F_STEPS = 1 << 15;
const F_MAX = 1.1;
const F_LUT = new Float32Array(F_STEPS + 1);
for (let i = 0; i <= F_STEPS; i++) F_LUT[i] = labF((i / F_STEPS) * F_MAX);
const fLut = (t: number) => F_LUT[Math.round((t / F_MAX) * F_STEPS)];

/** L* and chroma (√(a*²+b*²)) per pixel, D65. */
export function lightnessChroma(img: RGBAImage): { L: Float32Array; C: Float32Array } {
  const n = img.width * img.height;
  const d = img.data;
  const L = new Float32Array(n);
  const C = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = LINEAR[d[i * 4]];
    const g = LINEAR[d[i * 4 + 1]];
    const b = LINEAR[d[i * 4 + 2]];
    const fx = fLut((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const fy = fLut(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
    const fz = fLut((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
    L[i] = 116 * fy - 16;
    const A = 500 * (fx - fy);
    const B = 200 * (fy - fz);
    C[i] = Math.sqrt(A * A + B * B);
  }
  return { L, C };
}

/**
 * Square (2r+1)² max (or min) filter, window clipped at the borders. Van Herk / Gil-Werman:
 * per direction a running maximum from each block start (g) and towards each block end (h),
 * blocks of k = 2r+1, so every window spans at most two blocks: about 3 comparisons per
 * pixel and pass, independent of r. The vertical pass runs row by row (cache friendly).
 * A min filter is the max filter of the negated values.
 */
export function squareFilter(a: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  if (max) return maxFilter(a, w, h, r);
  const neg = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) neg[i] = -a[i];
  const out = maxFilter(neg, w, h, r);
  for (let i = 0; i < out.length; i++) out[i] = -out[i];
  return out;
}

function maxFilter(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const k = 2 * r + 1;
  const tmp = new Float32Array(a.length);
  const g = new Float32Array(w);
  const hb = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const v = a[row + x];
      g[x] = x % k === 0 || g[x - 1] < v ? v : g[x - 1];
    }
    for (let x = w - 1; x >= 0; x--) {
      const v = a[row + x];
      hb[x] = x % k === k - 1 || x === w - 1 || hb[x + 1] < v ? v : hb[x + 1];
    }
    for (let x = 0; x < w; x++) {
      const lo = x - r < 0 ? 0 : x - r;
      const hi = x + r >= w ? w - 1 : x + r;
      let v: number;
      if (((lo / k) | 0) !== ((hi / k) | 0)) v = hb[lo] > g[hi] ? hb[lo] : g[hi];
      else v = lo % k === 0 ? g[hi] : hb[lo];
      tmp[row + x] = v;
    }
  }
  // Vertical: the block arrays hold whole rows.
  const G = new Float32Array(a.length);
  const H = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    if (y % k === 0) {
      G.set(tmp.subarray(row, row + w), row);
      continue;
    }
    for (let x = row; x < row + w; x++) G[x] = G[x - w] < tmp[x] ? tmp[x] : G[x - w];
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    if (y % k === k - 1 || y === h - 1) {
      H.set(tmp.subarray(row, row + w), row);
      continue;
    }
    for (let x = row; x < row + w; x++) H[x] = H[x + w] < tmp[x] ? tmp[x] : H[x + w];
  }
  // Same-block windows either start at a block start (g) or end at the image border, which
  // is also the end of the last block (h).
  const out = tmp; // tmp is no longer needed
  for (let y = 0; y < h; y++) {
    const lo = y - r < 0 ? 0 : y - r;
    const hi = y + r >= h ? h - 1 : y + r;
    const row = y * w;
    const dl = lo * w - row;
    const dh = hi * w - row;
    if (((lo / k) | 0) !== ((hi / k) | 0)) {
      for (let x = row; x < row + w; x++) out[x] = H[x + dl] > G[x + dh] ? H[x + dl] : G[x + dh];
    } else if (lo % k === 0) out.set(G.subarray(row + dh, row + dh + w), row);
    else out.set(H.subarray(row + dl, row + dl + w), row);
  }
  return out;
}

/** Drops 8-connected components of a 0/1 mask smaller than minAreaPx (in place). */
function dropSmallComponents(m: Uint8Array, w: number, h: number, minAreaPx: number): void {
  if (minAreaPx <= 1) return;
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!m[s] || seen[s]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const k = ny * w + nx;
          if (m[k] && !seen[k]) {
            seen[k] = 1;
            queue[tail++] = k;
          }
        }
      }
    }
    if (tail < minAreaPx) for (let k = 0; k < tail; k++) m[queue[k]] = 0;
  }
}

/** 1 where a pixel belongs to the dark line art of the image (see module comment). */
export function outlineMask(img: RGBAImage, opts: OutlineOptions): Uint8Array {
  const { width: w, height: h } = img;
  const n = w * h;
  const m = new Uint8Array(n);
  if (n === 0) return m;
  const r = Math.max(1, Math.round(opts.radiusPx));
  const { L, C } = lightnessChroma(img);
  const dil = squareFilter(L, w, h, r, true);
  const closed = squareFilter(dil, w, h, r, false);
  const cMax = squareFilter(C, w, h, r, true);

  /** Ink fraction relative to surround lightness s, or -1 when the chroma rules it out. */
  const blend = (i: number, s: number): number => {
    if (s <= 0) return -1;
    const a = (s - L[i]) / s;
    return C[i] > (1 - a) * cMax[i] + CHROMA_TOL ? -1 : a;
  };

  for (let i = 0; i < n; i++) {
    const l = L[i];
    if (l < INK_L && C[i] < INK_MAX_CHROMA) {
      m[i] = 1;
      continue;
    }
    if (l > MAX_L) continue;
    const s = closed[i];
    if (s - l < Math.max(TOPHAT_MIN, TOPHAT_REL * s)) continue;
    if (blend(i, s) >= 0) m[i] = 1;
  }

  // Fringe growth, breadth-first so depth[] is the distance in px from the seeds.
  const growDepth = Math.max(1, Math.round(r / 2));
  const depth = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  for (let i = 0; i < n; i++) if (m[i]) queue[tail++] = i;
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    if (depth[p] >= growDepth) continue;
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const k = ny * w + nx;
        if (m[k] || L[k] > MAX_L) continue;
        if (blend(k, dil[k]) < GROW_REL) continue;
        m[k] = 1;
        depth[k] = depth[p] + 1;
        queue[tail++] = k;
      }
    }
  }

  dropSmallComponents(m, w, h, opts.minAreaPx);
  return m;
}
