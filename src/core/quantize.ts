import type { RGB, RGBAImage } from './types';
import { labToRgb } from './color';

export interface KmeansOptions {
  /** Per-pixel flag (non-zero = transparent), length width*height. */
  transparent?: Uint8Array;
  /** Maximum number of pixels used to fit the centroids. */
  sampleSize?: number;
  seed?: number;
}

const MAX_ITERATIONS = 20;
const MERGE_DELTA_E = 3;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// sRGB byte -> linear, precomputed
const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const XN = 0.95047;
const ZN = 1.08883;
const D = 6 / 29;
const D3 = D * D * D;

function labF(t: number): number {
  return t > D3 ? Math.cbrt(t) : t / (3 * D * D) + 4 / 29;
}

/** Converts the RGBA buffer into interleaved L,a,b floats (3 per pixel). */
function toLabBuffer(data: Uint8ClampedArray, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = LINEAR[data[i * 4]];
    const g = LINEAR[data[i * 4 + 1]];
    const b = LINEAR[data[i * 4 + 2]];
    const fx = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN);
    const fy = labF(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
    const fz = labF((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN);
    out[i * 3] = 116 * fy - 16;
    out[i * 3 + 1] = 500 * (fx - fy);
    out[i * 3 + 2] = 200 * (fy - fz);
  }
  return out;
}

function nearest(lab: Float32Array, o: number, cent: Float64Array, k: number): number {
  const l = lab[o];
  const a = lab[o + 1];
  const b = lab[o + 2];
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < k; c++) {
    const dl = l - cent[c * 3];
    const da = a - cent[c * 3 + 1];
    const db = b - cent[c * 3 + 2];
    const d = dl * dl + da * da + db * db;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * K-means in Lab space (k-means++ init, seeded). Fits on a random sample of
 * non-transparent pixels, then assigns every pixel. Label -1 = transparent.
 * Palette is sorted by pixel count descending; label i refers to palette[i].
 */
export function kmeansLab(
  img: RGBAImage,
  k: number,
  opts: KmeansOptions = {},
): { palette: RGB[]; labels: Int16Array } {
  const n = img.width * img.height;
  const transparent = opts.transparent;
  const sampleSize = opts.sampleSize ?? 50000;
  const rand = mulberry32(opts.seed ?? 1);

  const lab = toLabBuffer(img.data, n);
  const labels = new Int16Array(n).fill(-1);

  // Candidate (opaque) pixel indices
  const opaque = new Int32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) if (!transparent || !transparent[i]) opaque[m++] = i;
  if (m === 0) return { palette: [], labels };

  // Random sample via partial Fisher-Yates
  const s = Math.min(sampleSize, m);
  for (let i = 0; i < s; i++) {
    const j = i + Math.floor(rand() * (m - i));
    const t = opaque[i];
    opaque[i] = opaque[j];
    opaque[j] = t;
  }
  const sample = new Float32Array(s * 3);
  for (let i = 0; i < s; i++) {
    const p = opaque[i] * 3;
    sample[i * 3] = lab[p];
    sample[i * 3 + 1] = lab[p + 1];
    sample[i * 3 + 2] = lab[p + 2];
  }

  let kk = Math.max(1, Math.min(Math.floor(k), s));
  let cent = new Float64Array(kk * 3);

  // k-means++ initialisation
  const first = Math.floor(rand() * s);
  cent.set([sample[first * 3], sample[first * 3 + 1], sample[first * 3 + 2]], 0);
  const minD = new Float64Array(s).fill(Infinity);
  let chosen = 1;
  while (chosen < kk) {
    const c = (chosen - 1) * 3;
    let total = 0;
    for (let i = 0; i < s; i++) {
      const dl = sample[i * 3] - cent[c];
      const da = sample[i * 3 + 1] - cent[c + 1];
      const db = sample[i * 3 + 2] - cent[c + 2];
      const d = dl * dl + da * da + db * db;
      if (d < minD[i]) minD[i] = d;
      total += minD[i];
    }
    let pick = s - 1;
    if (total > 0) {
      let r = rand() * total;
      for (let i = 0; i < s; i++) {
        r -= minD[i];
        if (r <= 0) {
          pick = i;
          break;
        }
      }
    }
    cent.set([sample[pick * 3], sample[pick * 3 + 1], sample[pick * 3 + 2]], chosen * 3);
    chosen++;
  }

  // Lloyd iterations on the sample
  const assign = new Int16Array(s).fill(-1);
  const sums = new Float64Array(kk * 3);
  const counts = new Float64Array(kk);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < s; i++) {
      const c = nearest(sample, i * 3, cent, kk);
      if (c !== assign[i]) {
        assign[i] = c;
        changed = true;
      }
      sums[c * 3] += sample[i * 3];
      sums[c * 3 + 1] += sample[i * 3 + 1];
      sums[c * 3 + 2] += sample[i * 3 + 2];
      counts[c]++;
    }
    for (let c = 0; c < kk; c++) {
      if (counts[c] > 0) {
        cent[c * 3] = sums[c * 3] / counts[c];
        cent[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
        cent[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
      }
    }
    if (!changed) break;
  }

  // Drop empty clusters, then merge clusters closer than deltaE 3
  const cl: { lab: [number, number, number]; w: number }[] = [];
  for (let c = 0; c < kk; c++) {
    if (counts[c] > 0) cl.push({ lab: [cent[c * 3], cent[c * 3 + 1], cent[c * 3 + 2]], w: counts[c] });
  }
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < cl.length; i++) {
      for (let j = i + 1; j < cl.length; j++) {
        const a = cl[i];
        const b = cl[j];
        if (Math.hypot(a.lab[0] - b.lab[0], a.lab[1] - b.lab[1], a.lab[2] - b.lab[2]) < MERGE_DELTA_E) {
          const w = a.w + b.w;
          a.lab = [
            (a.lab[0] * a.w + b.lab[0] * b.w) / w,
            (a.lab[1] * a.w + b.lab[1] * b.w) / w,
            (a.lab[2] * a.w + b.lab[2] * b.w) / w,
          ];
          a.w = w;
          cl.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // Final assignment of all opaque pixels to surviving centroids
  kk = cl.length;
  cent = new Float64Array(kk * 3);
  cl.forEach((c, i) => cent.set(c.lab, i * 3));
  const pixelCount = new Float64Array(kk);
  for (let i = 0; i < n; i++) {
    if (transparent && transparent[i]) continue;
    const c = nearest(lab, i * 3, cent, kk);
    labels[i] = c;
    pixelCount[c]++;
  }

  // Sort by count desc (dropping any cluster that ended up empty), renumber
  const order: number[] = [];
  for (let c = 0; c < kk; c++) if (pixelCount[c] > 0) order.push(c);
  order.sort((a, b) => pixelCount[b] - pixelCount[a] || a - b);
  const remap = new Int16Array(kk).fill(-1);
  order.forEach((old, i) => (remap[old] = i));
  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) labels[i] = remap[labels[i]];
  }
  const palette = order.map((old) => labToRgb(cl[old].lab));
  return { palette, labels };
}

/**
 * Label that makes up at least 50 % of the border pixels (first/last row and
 * column, each pixel once). Label -1 is ignored. Null if none qualifies.
 */
export function detectBackground(labels: Int16Array, width: number, height: number): number | null {
  const counts = new Map<number, number>();
  let total = 0;
  const visit = (x: number, y: number): void => {
    const l = labels[y * width + x];
    if (l < 0) return;
    total++;
    counts.set(l, (counts.get(l) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }
  if (total === 0) return null;
  let best: number | null = null;
  let bestCount = 0;
  for (const [l, c] of counts) {
    if (c > bestCount) {
      best = l;
      bestCount = c;
    }
  }
  return best !== null && bestCount * 2 >= total ? best : null;
}
