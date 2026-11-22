import { describe, expect, it } from 'vitest';
import { buildLayerMasks, dilate, resolvePalette } from '../src/core/layers';
import { DEFAULT_SETTINGS, type PaletteEntry, type RGB } from '../src/core/types';

function entry(id: number, rgb: RGB, over: Partial<PaletteEntry> = {}): PaletteEntry {
  return {
    id,
    rgb,
    originalRgb: rgb,
    name: `f${id}`,
    deleted: false,
    mergedInto: null,
    monoInclude: false,
    pixelCount: 0,
    ...over,
  };
}

const rowCount = (m: Uint8Array, w: number, y: number) => {
  let n = 0;
  for (let x = 0; x < w; x++) n += m[y * w + x];
  return n;
};

describe('resolvePalette', () => {
  it('follows merge chains and propagates deletion', () => {
    const r = resolvePalette([
      entry(0, [0, 0, 0], { mergedInto: 1 }),
      entry(1, [0, 0, 0], { mergedInto: 2 }),
      entry(2, [0, 0, 0]),
      entry(3, [0, 0, 0], { deleted: true }),
      entry(4, [0, 0, 0], { mergedInto: 3 }),
    ]);
    expect(r.get(0)).toBe(2);
    expect(r.get(1)).toBe(2);
    expect(r.get(2)).toBe(2);
    expect(r.get(3)).toBeNull();
    expect(r.get(4)).toBeNull();
  });

  it('resolves cycles to the lowest id', () => {
    const r = resolvePalette([
      entry(5, [0, 0, 0], { mergedInto: 7 }),
      entry(7, [0, 0, 0], { mergedInto: 6 }),
      entry(6, [0, 0, 0], { mergedInto: 5 }),
    ]);
    expect(r.get(5)).toBe(5);
    expect(r.get(6)).toBe(5);
    expect(r.get(7)).toBe(5);
  });
});

describe('dilate', () => {
  it('matches a naive disc reference', () => {
    const w = 23, h = 19, r = 3;
    const m = new Uint8Array(w * h);
    for (const [x, y] of [[5, 5], [6, 5], [15, 12], [0, 0], [22, 18]]) m[y * w + x] = 1;
    const expected = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++)
            if (m[yy * w + xx] && (x - xx) ** 2 + (y - yy) ** 2 <= r * r) expected[y * w + x] = 1;
    expect(Array.from(dilate(m, w, h, r))).toEqual(Array.from(expected));
  });

  it('radius 0 returns a copy', () => {
    const m = new Uint8Array([0, 1, 0]);
    const o = dilate(m, 3, 1, 0);
    expect(o).toEqual(m);
    expect(o).not.toBe(m);
  });
});

describe('buildLayerMasks', () => {
  const w = 40, h = 6;
  const twoAreas = () => {
    const labels = new Int16Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = x < 20 ? 0 : 1;
    return labels;
  };
  const entries = () => [entry(0, [200, 0, 0]), entry(1, [0, 0, 200])];

  it('knockout: touching areas overlap exactly 4 px per side', () => {
    const out = buildLayerMasks(twoAreas(), w, h, entries(), DEFAULT_SETTINGS, 10);
    expect(out).toHaveLength(2);
    const [a, b] = out;
    expect(a.name).toBe('f0'); // equal area, lower id first
    for (let y = 0; y < h; y++) {
      expect(rowCount(a.mask, w, y)).toBe(24);
      expect(rowCount(b.mask, w, y)).toBe(24);
      expect(a.mask[y * w + 23]).toBe(1);
      expect(a.mask[y * w + 24]).toBe(0);
      expect(b.mask[y * w + 16]).toBe(1);
      expect(b.mask[y * w + 15]).toBe(0);
    }
  });

  it('knockout: outer silhouette does not grow into background', () => {
    const labels = new Int16Array(w * h).fill(-1);
    for (let y = 1; y < 5; y++) for (let x = 10; x < 30; x++) labels[y * w + x] = x < 20 ? 0 : 1;
    const out = buildLayerMasks(labels, w, h, entries(), DEFAULT_SETTINGS, 10);
    for (const l of out)
      for (let i = 0; i < l.mask.length; i++) if (l.mask[i]) expect(labels[i]).toBeGreaterThanOrEqual(0);
    const a = out[0];
    expect(a.mask[0 * w + 12]).toBe(0);
    expect(a.mask[2 * w + 9]).toBe(0);
  });

  it('knockout orders by area descending', () => {
    const labels = new Int16Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = x < 10 ? 0 : 1;
    const out = buildLayerMasks(labels, w, h, entries(), DEFAULT_SETTINGS, 10);
    expect(out.map((l) => l.name)).toEqual(['f1', 'f0']);
  });

  it('stacking: base is the union on darkest, upper layer undilated', () => {
    const out = buildLayerMasks(twoAreas(), w, h, entries(), { ...DEFAULT_SETTINGS, stackOnDarkest: true }, 10);
    expect(out).toHaveLength(2);
    // f1 (0,0,200) is darker than f0 (200,0,0)
    expect(out[0].name).toBe('f1-basis');
    expect(out[0].color).toEqual([0, 0, 200]);
    expect(Array.from(out[0].mask).every((v) => v === 1)).toBe(true);
    expect(out[1].name).toBe('f0');
    expect(rowCount(out[1].mask, w, 0)).toBe(20);
  });

  it('merged label goes into target mask using target colour/name', () => {
    const e = [entry(0, [200, 0, 0], { mergedInto: 1 }), entry(1, [1, 2, 3], { name: 'ziel' })];
    const out = buildLayerMasks(twoAreas(), w, h, e, { ...DEFAULT_SETTINGS, overlapMm: 0 }, 10);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ziel');
    expect(out[0].color).toEqual([1, 2, 3]);
    expect(Array.from(out[0].mask).every((v) => v === 1)).toBe(true);
  });

  it('deleted and unknown labels appear in no mask', () => {
    const labels = twoAreas();
    labels[5] = 9; // unknown id
    const e = [entry(0, [200, 0, 0], { deleted: true }), entry(1, [0, 0, 200])];
    const out = buildLayerMasks(labels, w, h, e, { ...DEFAULT_SETTINGS, overlapMm: 0 }, 10);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('f1');
    for (let i = 0; i < labels.length; i++) if (labels[i] !== 1) expect(out[0].mask[i]).toBe(0);
  });

  it('mono: union of included targets, [] without selection', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'mono' as const };
    expect(buildLayerMasks(twoAreas(), w, h, entries(), s, 10)).toEqual([]);
    const e = [entry(0, [200, 0, 0], { monoInclude: true }), entry(1, [0, 0, 200])];
    const out = buildLayerMasks(twoAreas(), w, h, e, s, 10);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('schnitt');
    expect(out[0].color).toEqual([0, 0, 0]);
    expect(rowCount(out[0].mask, w, 0)).toBe(20);
  });

  it('does not mutate inputs and handles large input quickly', () => {
    const labels = twoAreas();
    const copy = labels.slice();
    const e = entries();
    buildLayerMasks(labels, w, h, e, DEFAULT_SETTINGS, 10);
    expect(labels).toEqual(copy);
    expect(e[0].deleted).toBe(false);

    const W = 2400, H = 2400;
    const big = new Int16Array(W * H);
    for (let i = 0; i < big.length; i++) big[i] = ((i % W) >> 6) & 1;
    const t = Date.now();
    const r = buildLayerMasks(big, W, H, entries(), { ...DEFAULT_SETTINGS, overlapMm: 1 }, 10);
    expect(r).toHaveLength(2);
    expect(Date.now() - t).toBeLessThan(15000);
  });
});
