import { describe, expect, it } from 'vitest';
import { analyze, needsReanalysis, render } from '../src/core/pipeline';
import { validateCricutSvg } from '../src/core/svg';
import type { Tracer } from '../src/core/trace';
import { DEFAULT_SETTINGS, type RGBAImage, type Settings } from '../src/core/types';

/** Fake tracer: one rectangle (in px) around the mask's bounding box. */
const boxTracer: Tracer = async (mask, w, h) => {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  if (x1 < 0) return [];
  return [`M${x0} ${y0}L${x1 + 1} ${y0}L${x1 + 1} ${y1 + 1}L${x0} ${y1 + 1}Z`];
};

/** 200x200: white background, red disc (r<50), black ring (70<=r<90). */
function testImage(): RGBAImage {
  const size = 200;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - 100, y - 100);
      const c = r < 50 ? [220, 20, 20] : r >= 70 && r < 90 ? [0, 0, 0] : [255, 255, 255];
      data.set([...c, 255], (y * size + x) * 4);
    }
  return { width: size, height: size, data };
}

const settings: Settings = { ...DEFAULT_SETTINGS, colorCount: 3, targetWidthCm: 2 };

describe('pipeline', () => {
  it('analyzes into a palette with deleted white background', () => {
    const a = analyze(testImage(), settings);
    expect(a.width).toBe(200);
    expect(a.pxPerMm).toBe(10);
    expect(a.palette).toHaveLength(3);
    const deleted = a.palette.filter((p) => p.deleted);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].rgb.every((c) => c > 240)).toBe(true);
    const mono = a.palette.filter((p) => p.monoInclude);
    expect(mono).toHaveLength(1);
    expect(mono[0].rgb.every((c) => c < 30)).toBe(true);
    expect(a.palette.reduce((s, p) => s + p.pixelCount, 0)).toBe(200 * 200);
  });

  it('renders a valid SVG with 2 groups and per-layer SVGs', async () => {
    const a = analyze(testImage(), settings);
    const r = await render(a, a.palette, settings, boxTracer);
    expect(validateCricutSvg(r.svg)).toEqual([]);
    expect(r.svg.match(/<g /g)).toHaveLength(2);
    expect(r.layers).toHaveLength(2);
    for (const l of r.layers) {
      expect(validateCricutSvg(l.svg)).toEqual([]);
      expect(l.svg.match(/<g /g)).toHaveLength(1);
      expect(l.svg).toContain(`id="${l.id}"`);
    }
    expect(r.svg).toContain('width="20mm" height="20mm"');
    expect(r.warnings).toEqual([]);
  });

  it('yields a valid empty SVG plus warning when all colors are deleted', async () => {
    const a = analyze(testImage(), settings);
    const palette = a.palette.map((p) => ({ ...p, deleted: true }));
    const r = await render(a, palette, settings, boxTracer);
    expect(r.svg).not.toContain('<g');
    expect(validateCricutSvg(r.svg)).toEqual([]);
    expect(r.layers).toEqual([]);
    expect(r.warnings).toContain('Keine Ebene ausgewählt');
  });

  it('warns for target widths above 21.6 cm', async () => {
    const s = { ...settings, targetWidthCm: 25 };
    const a = analyze(testImage(), s);
    const r = await render(a, a.palette, s, boxTracer);
    expect(r.warnings).toContain('Breiter als 21,6 cm – passt nicht auf das Joy-Xtra-Material');
  });

  it('scales traced paths to millimetres', async () => {
    const a = analyze(testImage(), { ...settings, mode: 'mono' });
    const r = await render(a, a.palette, { ...settings, mode: 'mono' }, boxTracer);
    expect(r.layers).toHaveLength(1);
    expect(r.svg).toContain('M1.1 1.1 L19 1.1');
  });

  it('hits the exact target width even when the working width is capped', async () => {
    const w = 1000;
    const h = 3000;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        data.set(x < 500 ? [220, 20, 20, 255] : [255, 255, 255, 255], (y * w + x) * 4);
    const s: Settings = { ...settings, targetWidthCm: 20 };
    const a = analyze({ width: w, height: h, data }, s);
    expect(a.width).not.toBe(2000);
    const r = await render(a, a.palette, s, boxTracer);
    expect(r.svg).toContain('width="200mm" height="600mm"');
  });

  it('drops palette entries wiped out by cleanup', async () => {
    // White background, red disc, blue ring and three 4 px black speckles
    // (far below 1 mm2 = 100 px): the black cluster vanishes during cleanup.
    const size = 200;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const r = Math.hypot(x - 100, y - 100);
        if (r < 50) data.set([220, 20, 20, 255], (y * size + x) * 4);
        else if (r >= 70 && r < 90) data.set([30, 60, 200, 255], (y * size + x) * 4);
      }
    for (const [sx, sy] of [[5, 5], [150, 20], [30, 160]])
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) data.set([0, 0, 0, 255], ((sy + dy) * size + sx + dx) * 4);
    const s: Settings = { ...settings, colorCount: 4, mode: 'mono' };
    const a = analyze({ width: size, height: size, data }, s);
    expect(a.palette).toHaveLength(3);
    expect(a.palette.every((p) => p.pixelCount > 0)).toBe(true);
    const mono = a.palette.filter((p) => p.monoInclude);
    expect(mono).toHaveLength(1);
    expect(mono[0].deleted).toBe(false);
    const r = await render(a, a.palette, s, boxTracer);
    expect(r.layers.map((l) => l.name)).toEqual(['schnitt']);
    expect(r.warnings).toEqual([]);
  });

  it('needsReanalysis only for analysis-relevant settings', () => {
    expect(needsReanalysis(settings, { ...settings })).toBe(false);
    expect(needsReanalysis(settings, { ...settings, overlapMm: 1 })).toBe(false);
    expect(needsReanalysis(settings, { ...settings, mode: 'mono' })).toBe(false);
    expect(needsReanalysis(settings, { ...settings, stackOnDarkest: true })).toBe(false);
    for (const patch of [{ colorCount: 4 }, { smoothing: 0.1 }, { minPartAreaMm2: 3 }, { targetWidthCm: 10 }])
      expect(needsReanalysis(settings, { ...settings, ...patch })).toBe(true);
  });
});
