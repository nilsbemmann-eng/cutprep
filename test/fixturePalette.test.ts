/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/pipeline';
import { DEFAULT_SETTINGS } from '../src/core/types';

// Native-size decode of test/fixtures/grinch-raster.jpg (scripts/make-fixture-rgba.py).
const W = 995;
const H = 1283;

describe('real fixture palette (grinch, k=6)', () => {
  it('has no anti-aliasing blend colours and keeps the grey zipper', () => {
    const raw = gunzipSync(readFileSync(new URL('./fixtures/grinch-995x1283.rgba.gz', import.meta.url)));
    expect(raw.length).toBe(W * H * 4);
    const img = { width: W, height: H, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length) };
    const a = analyze(img, DEFAULT_SETTINGS);
    const names = a.palette.map((p) => p.name);
    // Red/black seams used to become 'braun' and 'dunkelrot' layers.
    expect(names).not.toContain('braun');
    expect(names).not.toContain('dunkelrot');
    // The zipper is a mid grey; without the fix it was absorbed into 'schwarz'.
    expect(names).toContain('grau');
    expect(names).toContain('schwarz');
  }, 60000);
});
