/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/pipeline';
import { DEFAULT_SETTINGS } from '../src/core/types';

// Native-size decode of test/fixtures/grinch-raster.jpg (scripts/make-fixture-rgba.py).
const W = 995;
const H = 1283;

function loadFixture() {
  const raw = gunzipSync(readFileSync(new URL('./fixtures/grinch-995x1283.rgba.gz', import.meta.url)));
  expect(raw.length).toBe(W * H * 4);
  return { width: W, height: H, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length) };
}

describe('real fixture palette (grinch, k=6)', () => {
  it('has no anti-aliasing blend colours and keeps the grey zipper', () => {
    const a = analyze(loadFixture(), DEFAULT_SETTINGS);
    const names = a.palette.map((p) => p.name);
    // Red/black seams used to become 'braun' and 'dunkelrot' layers.
    expect(names).not.toContain('braun');
    expect(names).not.toContain('dunkelrot');
    // The zipper is a mid grey; without the fix it was absorbed into 'schwarz'.
    expect(names).toContain('grau');
    expect(names).toContain('schwarz');
  }, 60000);
  it('keeps the white hat fur and pompom as interior white, deletes only the outside', () => {
    const a = analyze(loadFixture(), DEFAULT_SETTINGS);
    expect(a.width).toBe(1861);
    const inner = a.palette.find((p) => p.role === 'interior');
    const bg = a.palette.find((p) => p.role === 'background');
    expect(inner).toMatchObject({ name: 'weiß', deleted: false });
    expect(bg).toMatchObject({ name: 'weiß', deleted: true });
    // Calibration (gapCloseMm 1.0): interior 8.9 %, background 61.3 % of the image.
    // Below ~7 % the fur leaks out again; above ~10.5 % the outside starts counting as interior.
    const total = a.width * a.height;
    expect(inner!.pixelCount / total).toBeGreaterThan(0.07);
    expect(inner!.pixelCount / total).toBeLessThan(0.105);
    expect(bg!.pixelCount / total).toBeGreaterThan(0.55);
    const roleAt = (x: number, y: number) => a.palette.find((p) => p.id === a.labels[y * a.width + x])?.role;
    expect(roleAt(300, 940)).toBe('interior'); // pompom
    expect(roleAt(900, 440)).toBe('interior'); // hat fur
    expect(roleAt(100, 100)).toBe('background');
    expect(roleAt(1700, 1600)).toBe('background'); // right of the lettering
  }, 60000);
});
