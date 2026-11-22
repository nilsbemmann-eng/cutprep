import { describe, expect, it } from 'vitest';
import { splitInteriorBackground } from '../src/core/interior';

const BG = 0;
const INK = 1;

/**
 * size x size label map: background everywhere, a square INK ring (outer edge at
 * `from`, `thick` px wide, side length `side`) with a gap of `gap` px in the
 * middle of its top side.
 */
function ring(size: number, { from = 10, side = 20, thick = 2, gap = 0 } = {}): Int16Array {
  const l = new Int16Array(size * size).fill(BG);
  const to = from + side; // exclusive
  for (let y = from; y < to; y++)
    for (let x = from; x < to; x++) {
      const onRing = x < from + thick || x >= to - thick || y < from + thick || y >= to - thick;
      if (onRing) l[y * size + x] = INK;
    }
  const mid = from + Math.floor(side / 2);
  const g0 = mid - Math.floor(gap / 2);
  for (let y = from; y < from + thick; y++) for (let x = g0; x < g0 + gap; x++) l[y * size + x] = BG;
  return l;
}

const count = (l: Int16Array, v: number) => l.reduce((n, x) => n + (x === v ? 1 : 0), 0);
/** Inside area of the default ring (20 - 2*2)^2. */
const INSIDE = 16 * 16;

describe('splitInteriorBackground', () => {
  it('keeps the inside of a closed ring as a new label, even without gap closing', () => {
    const l = ring(40);
    const { labels, interiorLabel } = splitInteriorBackground(l, 40, 40, BG, 0);
    expect(interiorLabel).toBe(2);
    expect(count(labels, 2)).toBe(INSIDE);
    expect(labels[20 * 40 + 20]).toBe(2);
    expect(labels[0]).toBe(BG);
    expect(count(labels, INK)).toBe(count(l, INK));
  });

  it('closes a gap smaller than the radius', () => {
    const l = ring(40, { gap: 2 });
    const { labels, interiorLabel } = splitInteriorBackground(l, 40, 40, BG, 2);
    expect(interiorLabel).toBe(2);
    expect(labels[20 * 40 + 20]).toBe(2);
    // The inside survives almost completely; only the gap mouth may go to the outside.
    expect(count(labels, 2)).toBeGreaterThan(INSIDE * 0.9);
    // Outside background stays background up to the ring.
    expect(labels[9 * 40 + 15]).toBe(BG);
    expect(labels[0]).toBe(BG);
  });

  it('lets the same gap leak with radius 0', () => {
    const l = ring(40, { gap: 2 });
    const { labels, interiorLabel } = splitInteriorBackground(l, 40, 40, BG, 0);
    expect(interiorLabel).toBeNull();
    expect(Array.from(labels)).toEqual(Array.from(l));
  });

  it('lets a gap larger than the radius leak', () => {
    const l = ring(60, { from: 10, side: 40, thick: 2, gap: 10 });
    const { labels, interiorLabel } = splitInteriorBackground(l, 60, 60, BG, 2);
    expect(interiorLabel).toBeNull();
    // Unreached concave-corner pixels stay background (no seed is farther than r from the ring).
    expect(Array.from(labels)).toEqual(Array.from(l));
  });

  it('treats a transparent (-1) border as outside', () => {
    const size = 44;
    const l = new Int16Array(size * size).fill(-1);
    const inner = ring(40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) l[(y + 2) * size + x + 2] = inner[y * 40 + x];
    const { labels, interiorLabel } = splitInteriorBackground(l, size, size, BG, 1);
    expect(interiorLabel).toBe(2);
    expect(count(labels, 2)).toBe(INSIDE);
    expect(labels[2 * size + 2]).toBe(BG); // background next to the transparent frame
    expect(count(labels, -1)).toBe(count(l, -1)); // transparency untouched
  });

  it('does nothing without a background label', () => {
    const l = ring(40);
    const { labels, interiorLabel } = splitInteriorBackground(l, 40, 40, null, 2);
    expect(interiorLabel).toBeNull();
    expect(Array.from(labels)).toEqual(Array.from(l));
    expect(labels).not.toBe(l);
  });

  it('uses the given new label and leaves its input untouched', () => {
    const l = ring(40);
    const before = l.slice();
    const { labels, interiorLabel } = splitInteriorBackground(l, 40, 40, BG, 0, 7);
    expect(interiorLabel).toBe(7);
    expect(count(labels, 7)).toBe(INSIDE);
    expect(Array.from(l)).toEqual(Array.from(before));
  });
  it('keeps a wide enclosed area but not a narrow enclosed channel (width < 2r)', () => {
    const w = 60;
    const h = 40;
    const l = new Int16Array(w * h).fill(BG);
    // Two closed INK boxes: 20x20 (inside 16x16) and 8x20 (inside a 4 px wide channel).
    const box = (x0: number, x1: number) => {
      for (let y = 10; y < 30; y++)
        for (let x = x0; x < x1; x++)
          if (x < x0 + 2 || x >= x1 - 2 || y < 12 || y >= 28) l[y * w + x] = INK;
    };
    box(5, 25);
    box(40, 48);
    const { labels, interiorLabel } = splitInteriorBackground(l, w, h, BG, 3);
    expect(interiorLabel).toBe(2);
    expect(count(labels, 2)).toBe(INSIDE);
    expect(labels[20 * w + 15]).toBe(2);
    expect(labels[20 * w + 44]).toBe(BG); // channel: every pixel within r of the outline
  });

  it('encloses areas of a motif that touches the image border', () => {
    // Ring flush with the top-left corner: the border itself is ink, not outside.
    const l = ring(40, { from: 0 });
    const { labels, interiorLabel } = splitInteriorBackground(l, 40, 40, BG, 2);
    expect(interiorLabel).toBe(2);
    expect(count(labels, 2)).toBe(INSIDE);
    expect(labels[39 * 40 + 39]).toBe(BG);
    expect(labels[0]).toBe(INK);
  });
});
