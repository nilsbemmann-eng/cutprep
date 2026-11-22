import { describe, it, expect } from 'vitest';
import { kmeansLab, detectBackground } from '../src/core/quantize';
import { labToRgb, rgbToLab } from '../src/core/color';
import type { RGBAImage, RGB } from '../src/core/types';

function solid(w: number, h: number, c: RGB): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

function fillRect(img: RGBAImage, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
}

describe('labToRgb', () => {
  it('round-trips sRGB through Lab', () => {
    const samples: RGB[] = [[0, 0, 0], [255, 255, 255], [220, 30, 40], [12, 200, 99], [128, 128, 128]];
    for (const s of samples) {
      const back = labToRgb(rgbToLab(s));
      expect(Math.abs(back[0] - s[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(back[1] - s[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(back[2] - s[2])).toBeLessThanOrEqual(1);
    }
  });
});

describe('kmeansLab', () => {
  it('finds exactly 3 colors in a 3-block image with k=6', () => {
    const img = solid(100, 100, [255, 0, 0]);
    fillRect(img, 34, 0, 67, 100, [0, 255, 0]);
    fillRect(img, 67, 0, 100, 100, [0, 0, 255]);
    const { palette, labels } = kmeansLab(img, 6);
    expect(palette.length).toBe(3);
    expect(labels.length).toBe(100 * 100);
    for (const c of palette) {
      for (const v of c) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true);
    }
    expect(new Set(labels).size).toBe(3);
  });

  it('sorts palette by pixel count descending with matching labels', () => {
    const img = solid(100, 100, [255, 255, 255]);
    fillRect(img, 0, 0, 30, 100, [0, 0, 0]);
    fillRect(img, 30, 0, 40, 100, [255, 0, 0]);
    const { palette, labels } = kmeansLab(img, 4);
    expect(palette.length).toBe(3);
    const counts = new Array(palette.length).fill(0);
    for (const l of labels) counts[l]++;
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(palette[0]).toEqual([255, 255, 255]);
  });

  it('labels transparent pixels -1', () => {
    const img = solid(10, 10, [255, 0, 0]);
    fillRect(img, 5, 0, 10, 10, [0, 0, 255]);
    const transparent = new Uint8Array(100);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 2; x++) transparent[y * 10 + x] = 1;
    const { labels, palette } = kmeansLab(img, 3, { transparent });
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const l = labels[y * 10 + x];
        if (x < 2) expect(l).toBe(-1);
        else expect(l).toBeGreaterThanOrEqual(0);
      }
    }
    expect(palette.length).toBe(2);
  });

  it('is deterministic for the same seed', () => {
    const img = solid(60, 60, [10, 20, 30]);
    fillRect(img, 0, 0, 30, 60, [200, 180, 40]);
    fillRect(img, 30, 30, 60, 60, [90, 220, 140]);
    const a = kmeansLab(img, 5, { seed: 7 });
    const b = kmeansLab(img, 5, { seed: 7 });
    expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
    expect(a.palette).toEqual(b.palette);
  });

  it('handles a 2400x1800 image in under 2 s', () => {
    const img = solid(2400, 1800, [240, 240, 230]);
    fillRect(img, 600, 400, 1800, 1400, [30, 90, 200]);
    const t0 = performance.now();
    const { palette, labels } = kmeansLab(img, 6);
    const dt = performance.now() - t0;
    expect(palette.length).toBe(2);
    expect(labels.length).toBe(2400 * 1800);
    expect(dt).toBeLessThan(2000);
  });
});

describe('detectBackground', () => {
  it('returns the white label for a white border with a red circle', () => {
    const w = 50;
    const h = 50;
    const img = solid(w, h, [255, 255, 255]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.hypot(x - 25, y - 25) < 12) fillRect(img, x, y, x + 1, y + 1, [220, 20, 20]);
      }
    }
    const { palette, labels } = kmeansLab(img, 4);
    const bg = detectBackground(labels, w, h);
    expect(bg).not.toBeNull();
    expect(palette[bg as number]).toEqual([255, 255, 255]);
  });

  it('returns null for three equally sized border colors', () => {
    // 4x4 grid: 12 border pixels, 4 per label
    const g = new Int16Array(16);
    const border = [0, 1, 2, 3, 7, 11, 15, 14, 13, 12, 8, 4];
    border.forEach((idx, i) => (g[idx] = Math.floor(i / 4)));
    expect(detectBackground(g, 4, 4)).toBeNull();
  });

  it('ignores transparent (-1) border pixels in numerator and denominator', () => {
    const g = new Int16Array(16).fill(-1);
    // 12 border pixels: 3 are label 2, 9 are -1 -> label 2 has 100%
    g[0] = 2; g[1] = 2; g[2] = 2;
    expect(detectBackground(g, 4, 4)).toBe(2);
  });

  it('returns null when all border pixels are transparent', () => {
    expect(detectBackground(new Int16Array(16).fill(-1), 4, 4)).toBeNull();
  });
});
