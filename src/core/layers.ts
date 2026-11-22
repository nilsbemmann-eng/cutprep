import { rgbToLab } from './color';
import type { LayerMask, PaletteEntry, Settings } from './types';

/**
 * Maps every palette id to its final target id following mergedInto chains.
 * null = deleted (the entry itself, or any entry on its merge chain, is deleted,
 * or the chain points to an unknown id). Merge cycles resolve to the lowest id
 * of the cycle.
 */
export function resolvePalette(entries: PaletteEntry[]): Map<number, number | null> {
  const byId = new Map<number, PaletteEntry>();
  for (const e of entries) byId.set(e.id, e);
  const result = new Map<number, number | null>();

  for (const start of entries) {
    const path: number[] = [];
    const seen = new Map<number, number>();
    let cur: PaletteEntry | undefined = start;
    let target: number | null = null;
    while (true) {
      if (!cur || cur.deleted) {
        target = null;
        break;
      }
      const at = seen.get(cur.id);
      if (at !== undefined) {
        target = Math.min(...path.slice(at));
        break;
      }
      seen.set(cur.id, path.length);
      path.push(cur.id);
      if (cur.mergedInto === null) {
        target = cur.id;
        break;
      }
      cur = byId.get(cur.mergedInto);
    }
    result.set(start.id, target);
  }
  return result;
}

/** Circular dilation (disc of radius radiusPx) of a 0/1 mask via row-run stamping. */
export function dilate(mask: Uint8Array, w: number, h: number, radiusPx: number): Uint8Array {
  if (radiusPx <= 0) return mask.slice();
  const out = new Uint8Array(w * h);
  const r = radiusPx;
  const halfWidths: number[] = [];
  for (let dy = 0; dy <= r; dy++) halfWidths.push(Math.floor(Math.sqrt(r * r - dy * dy)));

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let x = 0;
    while (x < w) {
      if (!mask[row + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < w && mask[row + x]) x++;
      const end = x; // exclusive
      for (let dy = -r; dy <= r; dy++) {
        const ty = y + dy;
        if (ty < 0 || ty >= h) continue;
        const hw = halfWidths[Math.abs(dy)];
        const from = Math.max(0, start - hw);
        const to = Math.min(w, end + hw);
        out.fill(1, ty * w + from, ty * w + to);
      }
    }
  }
  return out;
}

function countOnes(m: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

export function buildLayerMasks(
  labels: Int16Array,
  w: number,
  h: number,
  entries: PaletteEntry[],
  settings: Settings,
  pxPerMm: number,
): LayerMask[] {
  const resolved = resolvePalette(entries);
  const byId = new Map<number, PaletteEntry>();
  for (const e of entries) byId.set(e.id, e);

  // One mask per active target; unknown/deleted labels are skipped.
  const targetMasks = new Map<number, Uint8Array>();
  const union = new Uint8Array(w * h);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0) continue;
    const t = resolved.get(l);
    if (t === undefined || t === null) continue;
    let m = targetMasks.get(t);
    if (!m) {
      m = new Uint8Array(w * h);
      targetMasks.set(t, m);
    }
    m[i] = 1;
    union[i] = 1;
  }

  const layers = [...targetMasks.entries()].map(([id, mask]) => ({
    id,
    mask,
    area: countOnes(mask),
    entry: byId.get(id)!,
  }));
  const byAreaDesc = (a: { id: number; area: number }, b: { id: number; area: number }) =>
    b.area - a.area || a.id - b.id;

  const make = (name: string, color: LayerMask['color'], mask: Uint8Array): LayerMask => ({
    name,
    color,
    mask,
    width: w,
    height: h,
  });

  if (settings.mode === 'mono') {
    const mono = new Uint8Array(w * h);
    let any = false;
    for (const l of layers) {
      if (!l.entry.monoInclude) continue;
      for (let i = 0; i < mono.length; i++) if (l.mask[i]) mono[i] = 1;
      any = true;
    }
    return any ? [make('schnitt', [0, 0, 0], mono)] : [];
  }

  if (layers.length === 0) return [];
  layers.sort(byAreaDesc);

  if (settings.stackOnDarkest) {
    let darkest = layers[0];
    let darkestL = Infinity;
    for (const l of layers) {
      // Background-coloured interior areas never become the base silhouette.
      if (l.entry.role === 'interior') continue;
      const L = rgbToLab(l.entry.rgb)[0];
      if (L < darkestL) {
        darkestL = L;
        darkest = l;
      }
    }
    const result: LayerMask[] = [make(`${darkest.entry.name}-basis`, darkest.entry.rgb, union)];
    for (const l of layers) {
      if (l === darkest) continue;
      result.push(make(l.entry.name, l.entry.rgb, l.mask));
    }
    return result;
  }

  const radius = Math.round(settings.overlapMm * pxPerMm);
  return layers.map((l) => {
    let mask = l.mask;
    if (radius > 0) {
      mask = dilate(l.mask, w, h, radius);
      // Overlap only grows under neighbouring foil, never into background.
      for (let i = 0; i < mask.length; i++) mask[i] &= union[i];
    }
    return make(l.entry.name, l.entry.rgb, mask);
  });
}
