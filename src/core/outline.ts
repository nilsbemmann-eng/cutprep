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
 *    than that (closing − L ≥ max(TOPHAT_MIN, TOPHAT_REL · closing)) and dark enough
 *    (L ≤ maxL, see below). Step edges (a red area next to white) are not raised by a
 *    closing, so the darker side of an ordinary colour edge is not marked.
 * 2. Ink pixels: pixels the caller marks as ink (already labelled with the outline colour)
 *    that are darker than inkL. They are only seeds for step 3 and cover the cores of lines
 *    wider than the top-hat; a dark fill of another colour is never an ink pixel.
 * 3. Fringe: from those seeds, up to GROW_DEPTH px outwards into pixels that are still
 *    nearer to ink than to their brightest neighbour (dilation-based ratio ≥ GROW_REL).
 *    The depth limit keeps this from creeping along a dark-but-coloured fill.
 * 4. Every candidate must look like a blend of ink and its surroundings: its chroma may
 *    not exceed what the ink fraction leaves of the most saturated neighbour (plus
 *    CHROMA_TOL). This keeps saturated red slivers between white areas and coloured
 *    strokes (navy, dark green) out.
 * 5. 8-connected components smaller than `minAreaPx` are dropped (specks, JPEG noise).
 *
 * The lightness limits are relative to the outline colour and the paper: a pixel counts
 * as line only if it is at most MAX_L_REL of the way from the ink to the paper (so a
 * mid-grey design line on white is not an outline), never above MAX_L_ABS. Fainter
 * line-shaped pixels (up to FAINT_L_*) are added by hysteresis when they are connected to
 * a line pixel: the light, broken-up parts of a stroke.
 *
 * L* and chroma are kept as bytes in half units (0..200 / 0..255), so the max/min filters
 * and all buffers are Uint8Array. All steps are O(pixels): the filters use van Herk /
 * Gil-Werman block maxima, independent of the radius.
 */
import type { RGBAImage } from './types';

/** L* and chroma per pixel, both in half units (value / 2 = L*, C*), C clamped to 127.5. */
export interface LightnessChroma {
  width: number;
  height: number;
  L: Uint8Array;
  C: Uint8Array;
}

/** Per-pixel class for outlineMask: 0 = normal, PIXEL_INK = may seed as ink, PIXEL_EXCLUDED = never outline. */
export const PIXEL_INK = 1;
export const PIXEL_EXCLUDED = 2;

export interface OutlineOptions {
  /** Half-width of the widest line still treated as a line (px). */
  radiusPx: number;
  /** Connected outline pieces smaller than this are dropped (px). */
  minAreaPx: number;
  /** L* of the outline colour (default 0). */
  inkL?: number;
  /** L* of the paper the lines are drawn on (default 100). */
  paperL?: number;
  /**
   * Label map and class per label (PIXEL_INK / PIXEL_EXCLUDED, indexed by label; label -1
   * and labels beyond the table count as 0). Without them no pixel seeds as ink.
   */
  labels?: Int16Array;
  labelClass?: Uint8Array;
  /** Scratch buffer of at least width·height entries (reused by the caller). */
  queue?: Int32Array;
}

// Tuned on test/fixtures/grinch-raster.jpg (see test/fixtureOutline.test.ts).
const TOPHAT_MIN = 10;
const TOPHAT_REL = 0.25;
/**
 * Faint strokes on white (pompom, hand) have cores around L* 45-55; a 0.4 mm grey (130)
 * design line (L* ≈ 54) and the mid-grey zipper teeth (L* ≈ 64) must stay above the limit.
 */
const MAX_L_ABS = 58;
const MAX_L_REL = 0.5;
/**
 * Faint line pixels (up to this lightness) count only when connected to a line pixel: the
 * light, broken parts of strokes (fur, pompom) whose gaps would otherwise stay open. The
 * mid-grey zipper teeth (L* ≈ 64) stay above.
 */
const FAINT_L_ABS = 70;
const FAINT_L_REL = 0.7;
const INK_L_ABS = 30;
const INK_L_REL = 0.25;
const GROW_REL = 0.45;
const CHROMA_TOL = 15;

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const D3 = (6 / 29) ** 3;
const labF = (t: number) => (t > D3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);

/** L* and chroma (√(a*²+b*²)) per pixel, D65, as floats (reference/measurement use). */
export function lightnessChroma(img: RGBAImage): { L: Float32Array; C: Float32Array } {
  const n = img.width * img.height;
  const d = img.data;
  const L = new Float32Array(n);
  const C = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = LINEAR[d[i * 4]];
    const g = LINEAR[d[i * 4 + 1]];
    const b = LINEAR[d[i * 4 + 2]];
    const fx = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const fy = labF(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
    const fz = labF((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
    L[i] = 116 * fy - 16;
    const A = 500 * (fx - fy);
    const B = 200 * (fy - fz);
    C[i] = Math.sqrt(A * A + B * B);
  }
  return { L, C };
}

/** Byte L* and C* (half units) from an interleaved Lab buffer, e.g. the one kmeansLab computed. */
export function lightnessChromaFromLab(lab: Float32Array, width: number, height: number): LightnessChroma {
  const n = width * height;
  const L = new Uint8Array(n);
  const C = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = lab[i * 3];
    const a = lab[i * 3 + 1];
    const b = lab[i * 3 + 2];
    L[i] = l <= 0 ? 0 : l >= 100 ? 200 : Math.round(l * 2);
    const c = Math.sqrt(a * a + b * b) * 2;
    C[i] = c >= 255 ? 255 : Math.round(c);
  }
  return { width, height, L, C };
}

function lightnessChromaBytes(img: RGBAImage): LightnessChroma {
  const { L: Lf, C: Cf } = lightnessChroma(img);
  const n = Lf.length;
  const L = new Uint8Array(n);
  const C = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = Math.max(0, Math.min(200, Math.round(Lf[i] * 2)));
    C[i] = Math.min(255, Math.round(Cf[i] * 2));
  }
  return { width: img.width, height: img.height, L, C };
}

/**
 * Square (2r+1)² max (or min) filter of a byte image, window clipped at the borders.
 * Van Herk / Gil-Werman: per direction a running maximum from each block start (g) and
 * towards each block end (h), blocks of k = 2r+1, so every window spans at most two blocks:
 * about 3 comparisons per pixel and pass, independent of r. The vertical pass runs row by
 * row (cache friendly). A min filter is the max filter of the inverted values.
 */
export function squareFilter(a: Uint8Array, w: number, h: number, r: number, max: boolean): Uint8Array {
  if (max) return maxFilter(a, w, h, r);
  const inv = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) inv[i] = 255 - a[i];
  const out = maxFilter(inv, w, h, r);
  for (let i = 0; i < out.length; i++) out[i] = 255 - out[i];
  return out;
}

function maxFilter(a: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const k = 2 * r + 1;
  const tmp = new Uint8Array(a.length);
  // Horizontal: per column, where its clipped window starts/ends and whether it spans two
  // blocks (then max(h[lo], g[hi])) or starts at a block start (g[hi]) or not (h[lo]).
  const lo = new Int32Array(w);
  const hi = new Int32Array(w);
  const mode = new Uint8Array(w); // 0: two blocks, 1: g[hi], 2: h[lo]
  for (let x = 0; x < w; x++) {
    lo[x] = x - r < 0 ? 0 : x - r;
    hi[x] = x + r >= w ? w - 1 : x + r;
    mode[x] = ((lo[x] / k) | 0) !== ((hi[x] / k) | 0) ? 0 : lo[x] % k === 0 ? 1 : 2;
  }
  const g = new Uint8Array(w);
  const hb = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let b = 0; b < w; b += k) {
      const end = b + k < w ? b + k : w;
      let m = a[row + b];
      g[b] = m;
      for (let x = b + 1; x < end; x++) {
        const v = a[row + x];
        if (v > m) m = v;
        g[x] = m;
      }
      m = a[row + end - 1];
      hb[end - 1] = m;
      for (let x = end - 2; x >= b; x--) {
        const v = a[row + x];
        if (v > m) m = v;
        hb[x] = m;
      }
    }
    for (let x = 0; x < w; x++) {
      const md = mode[x];
      if (md === 0) {
        const p = hb[lo[x]];
        const q = g[hi[x]];
        tmp[row + x] = p > q ? p : q;
      } else tmp[row + x] = md === 1 ? g[hi[x]] : hb[lo[x]];
    }
  }
  // Vertical: the block arrays hold whole rows.
  const G = new Uint8Array(a.length);
  const H = new Uint8Array(a.length);
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
    const ylo = y - r < 0 ? 0 : y - r;
    const yhi = y + r >= h ? h - 1 : y + r;
    const row = y * w;
    const dl = ylo * w - row;
    const dh = yhi * w - row;
    if (((ylo / k) | 0) !== ((yhi / k) | 0)) {
      for (let x = row; x < row + w; x++) out[x] = H[x + dl] > G[x + dh] ? H[x + dl] : G[x + dh];
    } else if (ylo % k === 0) out.set(G.subarray(row + dh, row + dh + w), row);
    else out.set(H.subarray(row + dl, row + dl + w), row);
  }
  return out;
}

/** Maximum of each 2×2 block (the last row/column of an odd size forms 1-wide blocks). */
function blockMax(a: Uint8Array, w: number, h: number): Uint8Array {
  const hw2 = (w + 1) >> 1;
  const out = new Uint8Array(hw2 * ((h + 1) >> 1));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const orow = (y >> 1) * hw2;
    for (let x = 0; x < w; x++) {
      const v = a[row + x];
      const o = orow + (x >> 1);
      if (v > out[o]) out[o] = v;
    }
  }
  return out;
}

/**
 * Drops 8-connected components of a 0/1 mask smaller than minAreaPx (in place). `seen` and
 * `queue` are scratch buffers of at least w·h entries; seen must be all zero.
 */
export function dropSmallComponents(
  m: Uint8Array,
  w: number,
  h: number,
  minAreaPx: number,
  seen: Uint8Array = new Uint8Array(w * h),
  queue: Int32Array = new Int32Array(w * h),
): void {
  if (minAreaPx <= 1) return;
  const n = w * h;
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
export function outlineMask(src: RGBAImage | LightnessChroma, opts: OutlineOptions): Uint8Array {
  const { width: w, height: h } = src;
  const n = w * h;
  const m = new Uint8Array(n);
  if (n === 0) return m;
  const r = Math.max(1, Math.round(opts.radiusPx));
  const { L, C } = 'L' in src ? src : lightnessChromaBytes(src);
  const lbl = opts.labels;
  const lcls = opts.labelClass;
  const classOf = (i: number): number => {
    if (!lbl || !lcls) return 0;
    const l = lbl[i];
    return l >= 0 && l < lcls.length ? lcls[l] : 0;
  };
  const inkL = Math.max(0, opts.inkL ?? 0);
  const paperL = Math.max(inkL, opts.paperL ?? 100);
  // Half units, like L.
  const maxL = 2 * Math.min(MAX_L_ABS, inkL + MAX_L_REL * (paperL - inkL));
  const faintMaxL = 2 * Math.min(FAINT_L_ABS, inkL + FAINT_L_REL * (paperL - inkL));
  const inkMaxL = 2 * Math.min(INK_L_ABS, inkL + INK_L_REL * (paperL - inkL));
  const tol = 2 * CHROMA_TOL;
  const tophatMin = 2 * TOPHAT_MIN;

  // Surroundings (closing, dilation, max chroma) on 2×2 block maxima with half the radius:
  // a quarter of the work, windows within a pixel of the full-resolution ones. The tests
  // below still use every pixel's own L and C, so thin lines keep full resolution.
  const hw2 = (w + 1) >> 1;
  const hh2 = (h + 1) >> 1;
  const r2 = Math.max(1, Math.round(r / 2));
  const lMax = blockMax(L, w, h);
  let dil: Uint8Array | null = squareFilter(lMax, hw2, hh2, r2, true);
  const closed = squareFilter(dil, hw2, hh2, r2, false);
  const cMax = squareFilter(blockMax(C, w, h), hw2, hh2, r2, true);
  /** Index into the half-resolution arrays for full-resolution pixel i. */
  const half = (i: number): number => {
    const x = i % w;
    return ((i - x) / w >> 1) * hw2 + (x >> 1);
  };

  // 1 = line pixel, 2 = faint line pixel (kept only if connected to a line pixel, below).
  let faint = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i];
    if (l > faintMaxL) continue;
    const c = classOf(i);
    if (c === PIXEL_EXCLUDED) continue;
    if (c === PIXEL_INK && l < inkMaxL) {
      m[i] = 1;
      continue;
    }
    const j = half(i);
    const s = closed[j];
    const d = s - l;
    if (s <= 0 || d < tophatMin || d < TOPHAT_REL * s) continue;
    // Ink fraction relative to the surround; the chroma must fit a blend of ink and surround.
    if (C[i] > (1 - d / s) * cMax[j] + tol) continue;
    if (l <= maxL) m[i] = 1;
    else {
      m[i] = 2;
      faint++;
    }
  }

  const queue = opts.queue && opts.queue.length >= n ? opts.queue : new Int32Array(n);
  let tail = 0;
  // Hysteresis: faint pixels 8-connected to a line pixel join it (the faint, broken-up
  // parts of a stroke), isolated faint lines (a grey design line) are dropped.
  if (faint > 0) {
    for (let i = 0; i < n; i++) if (m[i] === 1) queue[tail++] = i;
    for (let head = 0; head < tail; head++) {
      const p = queue[head];
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const k = ny * w + nx;
          if (m[k] === 2) {
            m[k] = 1;
            queue[tail++] = k;
          }
        }
      }
    }
    for (let i = 0; i < n; i++) if (m[i] === 2) m[i] = 0;
  }

  // Fringe growth, breadth-first so depth[] is the distance in px from the seeds.
  const growDepth = Math.max(1, Math.round(r / 2));
  const depth = new Uint8Array(n);
  tail = 0;
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
        const l = L[k];
        if (m[k] || l > maxL || classOf(k) === PIXEL_EXCLUDED) continue;
        const j = half(k);
        const s = dil[j];
        if (s <= 0) continue;
        const a = (s - l) / s;
        if (a < GROW_REL || C[k] > (1 - a) * cMax[j] + tol) continue;
        m[k] = 1;
        depth[k] = depth[p] + 1;
        queue[tail++] = k;
      }
    }
  }
  dil = null;

  depth.fill(0);
  dropSmallComponents(m, w, h, opts.minAreaPx, depth, queue);
  return m;
}
