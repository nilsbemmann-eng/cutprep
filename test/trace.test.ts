import { describe, it, expect } from 'vitest';
import type { Tracer } from '../src/core/trace';

// Skipped: esm-potrace-wasm calls require('node:fs') at load time and throws
// 'require is not defined' in Node ESM / Vitest. Verified in the browser in Task 9.
describe('createPotraceTracer', () => {
  it.skip('traces a square with a hole into 2 subpaths without arcs', async () => {
    const w = 40;
    const h = 40;
    const mask = new Uint8Array(w * h);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) mask[y * w + x] = 1;
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) mask[y * w + x] = 0;
    const { createPotraceTracer } = await import('../src/core/trace');
    const tracer: Tracer = await createPotraceTracer();
    const paths = await tracer(mask, w, h, { turdsize: 2, alphamax: 1 });
    const joined = paths.join(' ');
    expect((joined.match(/M/g) ?? []).length).toBe(2);
    expect(joined).not.toMatch(/[Aa]/);
  });
});
