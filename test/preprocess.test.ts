import { describe, it, expect } from 'vitest';
import { workingSize, resizeBilinear, flattenAlpha, autoLevels, edgeMask } from '../src/core/preprocess';
import type { RGBAImage } from '../src/core/types';

function img(width: number, height: number, px: number[]): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(px) };
}

describe('workingSize', () => {
  it('uses 10 px/mm for normal sizes', () => {
    expect(workingSize(4000, 3000, 20)).toEqual({ width: 2000, height: 1500, pxPerMm: 10 });
  });
  it('caps the longer side at 2400 and lowers pxPerMm', () => {
    const r = workingSize(500, 700, 20);
    expect(r.width).toBe(1714);
    expect(r.height).toBe(2400);
    expect(r.pxPerMm).toBeGreaterThan(8.561);
    expect(r.pxPerMm).toBeLessThan(8.581);
  });
  it('upscales small thumbnails', () => {
    expect(workingSize(200, 100, 20).width).toBe(2000);
  });
});

describe('resizeBilinear', () => {
  it('keeps corner colors when upscaling 2x2 to 4x4', () => {
    const src = img(2, 2, [
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 0, 255,
    ]);
    const out = resizeBilinear(src, 4, 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    const at = (x: number, y: number) => Array.from(out.data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(at(0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(3, 0)).toEqual([0, 255, 0, 255]);
    expect(at(0, 3)).toEqual([0, 0, 255, 255]);
    expect(at(3, 3)).toEqual([255, 255, 0, 255]);
  });
});

describe('flattenAlpha', () => {
  it('turns transparent pixels white and masks them', () => {
    const src = img(2, 1, [10, 20, 30, 0, 10, 20, 30, 255]);
    const { image, transparent } = flattenAlpha(src);
    expect(Array.from(image.data)).toEqual([255, 255, 255, 255, 10, 20, 30, 255]);
    expect(Array.from(transparent)).toEqual([1, 0]);
  });
  it('composites semi-transparent pixels over white', () => {
    const { image, transparent } = flattenAlpha(img(1, 1, [0, 0, 0, 128]));
    expect(image.data[0]).toBe(127);
    expect(image.data[3]).toBe(255);
    expect(transparent[0]).toBe(0);
  });
});

describe('autoLevels', () => {
  it('stretches 50..200 to 0..255', () => {
    const px: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const v = 50 + Math.round((i / 999) * 150);
      px.push(v, v, v, 255);
    }
    const out = autoLevels(img(1000, 1, px));
    let min = 255, max = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      min = Math.min(min, out.data[i]);
      max = Math.max(max, out.data[i]);
      expect(out.data[i + 3]).toBe(255);
    }
    expect(min).toBe(0);
    expect(max).toBe(255);
  });
  it('leaves flat channels unchanged', () => {
    const out = autoLevels(img(2, 1, [80, 80, 80, 255, 80, 80, 80, 255]));
    expect(Array.from(out.data)).toEqual([80, 80, 80, 255, 80, 80, 80, 255]);
  });
});

describe('edgeMask', () => {
  /** 40x10: red left, 8 px linear red->black ramp at x=16..23, black right. */
  function ramp(): RGBAImage {
    const w = 40, h = 10;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = Math.min(1, Math.max(0, (x - 15) / 9));
        data.set([Math.round(220 * (1 - t)), 20 * (1 - t), 20 * (1 - t), 255], (y * w + x) * 4);
      }
    return { width: w, height: h, data };
  }

  it('flags the soft border but not the flat areas', () => {
    const m = edgeMask(ramp());
    const at = (x: number, y: number) => m[y * 40 + x];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x <= 11; x++) expect(at(x, y)).toBe(0);
      for (let x = 16; x <= 23; x++) expect(at(x, y)).toBe(1);
      for (let x = 28; x < 40; x++) expect(at(x, y)).toBe(0);
    }
  });

  it('respects distance and threshold', () => {
    // A 1-step change of 30 per channel is below the default threshold 40.
    const flat = img(5, 1, [0, 0, 0, 255, 0, 0, 0, 255, 30, 30, 30, 255, 30, 30, 30, 255, 30, 30, 30, 255]);
    expect(Array.from(edgeMask(flat))).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(edgeMask(flat, 1, 20))).toEqual([0, 1, 1, 0, 0]);
  });
});
