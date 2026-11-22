import { dilate } from './layers';

/**
 * Splits the background label into the real outside and enclosed areas of the
 * same colour (e.g. white fur inside an outlined motif).
 *
 * Barrier = every pixel that is neither background nor transparent (-1), dilated
 * by `gapRadiusPx` so that outline gaps up to about 2·radius are closed. A 4-connected
 * flood fill starts at all border pixels that are background/transparent and outside
 * the barrier, and runs through background/transparent pixels outside the barrier.
 * The reached area is dilated by the same radius (restoring the edge next to the
 * outline) and intersected with the background label: that is the outside.
 * Remaining background pixels get `newLabel` (default: max label + 1), but only where they
 * are connected to a core pixel farther than the radius from the motif; narrower enclosed
 * slivers stay background.
 *
 * Returns a new array; `interiorLabel` is null when nothing is enclosed or there is
 * no background. Transparent pixels are never changed.
 */
export function splitInteriorBackground(
  labels: Int16Array,
  w: number,
  h: number,
  bgLabel: number | null,
  gapRadiusPx: number,
  newLabel?: number,
): { labels: Int16Array; interiorLabel: number | null } {
  const out = labels.slice();
  const total = w * h;
  if (bgLabel === null || total === 0) return { labels: out, interiorLabel: null };

  const r = Math.max(0, Math.round(gapRadiusPx));
  const solid = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const l = labels[i];
    if (l !== bgLabel && l !== -1) solid[i] = 1;
  }
  const barrier = r > 0 ? dilate(solid, w, h, r) : solid;

  // reached doubles as the visited flag; queue holds each pixel at most once.
  const reached = new Uint8Array(total);
  const queue = new Int32Array(total);
  let tail = 0;
  const seed = (p: number): void => {
    if (!barrier[p] && !reached[p]) {
      reached[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < total - w) seed(p + w);
  }

  const outside = r > 0 ? dilate(reached, w, h, r) : reached;
  let maxLabel = -1;
  for (let i = 0; i < total; i++) if (labels[i] > maxLabel) maxLabel = labels[i];
  const interior = newLabel ?? maxLabel + 1;

  // Core filter: only enclosed areas with a core farther than r from the motif count as
  // interior. Slivers narrower than 2r (between zipper teeth, close letters) and leftover
  // concave corners stay background. Candidates reached from a core pixel become interior.
  const isCandidate = (i: number) => labels[i] === bgLabel && !outside[i];
  tail = 0;
  for (let i = 0; i < total; i++) {
    if (!barrier[i] && isCandidate(i)) {
      out[i] = interior;
      queue[tail++] = i;
    }
  }
  const grow = (p: number): void => {
    if (out[p] !== interior && isCandidate(p)) {
      out[p] = interior;
      queue[tail++] = p;
    }
  };
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const x = p % w;
    if (x > 0) grow(p - 1);
    if (x < w - 1) grow(p + 1);
    if (p >= w) grow(p - w);
    if (p < total - w) grow(p + w);
  }
  return { labels: out, interiorLabel: tail > 0 ? interior : null };
}
