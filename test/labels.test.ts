import { describe, expect, it } from 'vitest';
import { majorityFilter, removeSmallRegions } from '../src/core/labels';

function make(w: number, h: number, f: (x: number, y: number) => number): Int16Array {
  const a = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x, y);
  return a;
}

describe('majorityFilter', () => {
  it('removes a single pixel inside a region (r=1)', () => {
    const l = make(7, 7, (x, y) => (x === 3 && y === 3 ? 1 : 0));
    const out = majorityFilter(l, 7, 7, 1);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('radius 0 returns an equal copy, input is not mutated', () => {
    const l = make(5, 5, (x, y) => (x === 2 && y === 2 ? 1 : 0));
    const snap = Array.from(l);
    const out = majorityFilter(l, 5, 5, 0);
    expect(out).not.toBe(l);
    expect(Array.from(out)).toEqual(snap);
    majorityFilter(l, 5, 5, 2);
    expect(Array.from(l)).toEqual(snap);
  });

  it('keeps the current label on ties', () => {
    // 2x1 image, r=1: both pixels see one vote each -> unchanged
    const out = majorityFilter(Int16Array.from([0, 1]), 2, 1, 1);
    expect(Array.from(out)).toEqual([0, 1]);
  });

  it('keeps -1 and ignores it as a voter', () => {
    const l = make(5, 5, (x, y) => (x === 0 ? -1 : x === 2 && y === 2 ? 1 : 0));
    const out = majorityFilter(l, 5, 5, 1);
    for (let y = 0; y < 5; y++) expect(out[y * 5]).toBe(-1);
    expect(out[2 * 5 + 2]).toBe(0);
    expect(Array.from(out).includes(-1)).toBe(true);
    expect(Array.from(out).some((v) => v === 1)).toBe(false);
  });

  it('is fast enough on 2400x2400 with r=3', () => {
    const w = 2400;
    const l = make(w, w, (x, y) => ((x >> 5) + (y >> 5) + ((x * 7 + y * 13) % 5 === 0 ? 1 : 0)) % 6);
    const t = Date.now();
    majorityFilter(l, w, w, 3);
    expect(Date.now() - t).toBeLessThan(4000);
  });
});

describe('removeSmallRegions', () => {
  const blob = (x: number, y: number) => (x >= 4 && x < 7 && y >= 4 && y < 7 ? 1 : 0);

  it('removes a 3x3 blob at minAreaPx=10', () => {
    const out = removeSmallRegions(make(12, 12, blob), 12, 12, 10);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('keeps a 3x3 blob at minAreaPx=9', () => {
    const l = make(12, 12, blob);
    const out = removeSmallRegions(l, 12, 12, 9);
    expect(Array.from(out)).toEqual(Array.from(l));
  });

  it('assigns a boundary blob to the neighbour with the longer shared border', () => {
    // left half 0, right half 2; blob (label 1) at x 4..6, y 3..4 sits mostly against 2
    const l = make(12, 8, (x, y) => (x >= 3 && x < 5 && y >= 3 && y < 5 ? 1 : x < 4 ? 0 : 2));
    // blob cols 3,4: col 3 touches 0 on the left (2 contacts), col 4 touches 2 on the right (2)
    // plus above/below: col3 -> 0 (4 contacts total with up/down), col4 -> 2 (4) : make it asymmetric
    const l2 = Int16Array.from(l);
    l2[3 * 12 + 5] = 1; // widen blob to the right so it only touches 2 more
    const out = removeSmallRegions(l2, 12, 8, 10);
    expect(Array.from(out).includes(1)).toBe(false);
    expect(out[3 * 12 + 3]).toBe(2);
  });

  it('never recolors or targets -1; keeps a component with no real neighbour', () => {
    const l = make(6, 6, (x, y) => (x === 2 && y === 2 ? 1 : -1));
    const out = removeSmallRegions(l, 6, 6, 5);
    expect(Array.from(out)).toEqual(Array.from(l));
    const t = make(6, 6, (x) => (x < 3 ? -1 : 0));
    const out2 = removeSmallRegions(t, 6, 6, 1000);
    expect(Array.from(out2)).toEqual(Array.from(t));
  });

  it('does not mutate input and handles huge regions without recursion', () => {
    const w = 2000;
    const l = make(w, w, () => 0);
    const snap = l.slice();
    const out = removeSmallRegions(l, w, w, 10);
    expect(out).not.toBe(l);
    expect(l).toEqual(snap);
  });
});
