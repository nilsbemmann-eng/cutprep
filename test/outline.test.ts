import { describe, expect, it } from 'vitest';
import { rgbToLab } from '../src/core/color';
import { lightnessChroma, outlineMask, squareFilter } from '../src/core/outline';
import type { RGB, RGBAImage } from '../src/core/types';

const GREEN: RGB = [136, 199, 5];
const DARK_GREEN: RGB = [0, 80, 35];
const INK: RGB = [20, 15, 10];

function fill(size: number, rgb: RGB): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([...rgb, 255], i * 4);
  return { width: size, height: size, data };
}

function rect(img: RGBAImage, x0: number, y0: number, x1: number, y1: number, rgb: RGB): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set(rgb, (y * img.width + x) * 4);
}

/** Distance from (px,py) to the segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const LINE = { ax: 40, ay: 60, bx: 160, by: 140, width: 2 };

/** Anti-aliased ink line of LINE.width px (coverage blend), like a scanned/JPEG clipart stroke. */
function drawLine(img: RGBAImage): void {
  const half = LINE.width / 2;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const cov = Math.max(0, Math.min(1, half + 0.5 - segDist(x + 0.5, y + 0.5, LINE.ax, LINE.ay, LINE.bx, LINE.by)));
      if (cov <= 0) continue;
      const o = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) img.data[o + c] = img.data[o + c] * (1 - cov) + INK[c] * cov;
    }
}

/** Pixel centres on the line's core (distance < 0.5 px), away from its ends. */
function lineCore(size: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = segDist(x + 0.5, y + 0.5, LINE.ax + 6, LINE.ay + 4, LINE.bx - 6, LINE.by - 4);
      if (d < 0.5) out.push(y * size + x);
    }
  return out;
}

describe('outlineMask', () => {
  it('covers a thin anti-aliased line completely without fattening it much', () => {
    const img = fill(200, GREEN);
    drawLine(img);
    const m = outlineMask(img, { radiusPx: 6, minAreaPx: 100 });
    const core = lineCore(200);
    expect(core.length).toBeGreaterThan(100);
    expect(core.filter((i) => m[i]).length).toBe(core.length);
    // Nothing farther than 3 px from the stroke.
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++)
        if (segDist(x + 0.5, y + 0.5, LINE.ax, LINE.ay, LINE.bx, LINE.by) > 3) expect(m[y * 200 + x]).toBe(0);
  });

  it('drops isolated dark specks below the minimum area, keeps larger ink', () => {
    const img = fill(100, GREEN);
    rect(img, 20, 20, 23, 23, INK); // 9 px speck
    rect(img, 60, 60, 72, 72, INK); // 144 px
    const m = outlineMask(img, { radiusPx: 6, minAreaPx: 50 });
    expect(m[21 * 100 + 21]).toBe(0);
    expect(m[66 * 100 + 66]).toBe(1);
  });

  it('does not mark a wide dark-green fill', () => {
    const img = fill(200, GREEN);
    rect(img, 50, 50, 150, 150, DARK_GREEN);
    const m = outlineMask(img, { radiusPx: 6, minAreaPx: 100 });
    let n = 0;
    for (const v of m) n += v;
    expect(n).toBe(0);
  });
});

describe('squareFilter', () => {
  it('matches a brute-force clipped window max/min', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 100;
    for (const [w, h, r] of [[17, 11, 2], [5, 9, 3], [30, 4, 1], [3, 3, 4], [23, 19, 5]]) {
      const a = Float32Array.from({ length: w * h }, rnd);
      for (const max of [true, false]) {
        const got = squareFilter(a, w, h, r, max);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            let e = max ? -Infinity : Infinity;
            for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
              for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++)
                e = max ? Math.max(e, a[yy * w + xx]) : Math.min(e, a[yy * w + xx]);
            expect(got[y * w + x]).toBe(e);
          }
      }
    }
  });
});

describe('lightnessChroma', () => {
  it('agrees with rgbToLab', () => {
    const cols: RGB[] = [[0, 0, 0], [255, 255, 255], [136, 199, 5], [216, 33, 30], [20, 15, 10], [128, 128, 128]];
    const data = new Uint8ClampedArray(cols.length * 4);
    cols.forEach((c, i) => data.set([...c, 255], i * 4));
    const { L, C } = lightnessChroma({ width: cols.length, height: 1, data });
    cols.forEach((c, i) => {
      const [l, a, b] = rgbToLab(c);
      expect(Math.abs(L[i] - l)).toBeLessThan(0.1);
      expect(Math.abs(C[i] - Math.hypot(a, b))).toBeLessThan(0.1);
    });
  });
});
