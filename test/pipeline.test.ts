import { describe, expect, it } from 'vitest';
import { analyze, needsReanalysis, render, RenderAbortedError } from '../src/core/pipeline';
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
    // red, black, white background + the white annulus enclosed by the black ring
    expect(a.palette).toHaveLength(4);
    const deleted = a.palette.filter((p) => p.deleted);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].rgb.every((c) => c > 240)).toBe(true);
    expect(deleted[0].role).toBe('background');
    const mono = a.palette.filter((p) => p.monoInclude);
    expect(mono).toHaveLength(1);
    expect(mono[0].rgb.every((c) => c < 30)).toBe(true);
    expect(a.palette.reduce((s, p) => s + p.pixelCount, 0)).toBe(200 * 200);
    for (const p of a.palette) {
      expect(p.originalRgb).toEqual(p.rgb);
      expect(p.originalRgb).not.toBe(p.rgb);
    }
  });

  it('renders a valid SVG with 2 groups and per-layer SVGs', async () => {
    const a = analyze(testImage(), settings);
    const r = await render(a, a.palette, settings, boxTracer);
    expect(validateCricutSvg(r.svg)).toEqual([]);
    expect(r.svg.match(/<g /g)).toHaveLength(3);
    expect(r.layers).toHaveLength(3);
    expect(r.layers.map((l) => l.id)).toContain('weiss');
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
    // red, blue, white background, white annulus inside the blue ring
    expect(a.palette).toHaveLength(4);
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
    for (const patch of [
      { colorCount: 4 },
      { smoothing: 0.1 },
      { minPartAreaMm2: 3 },
      { targetWidthCm: 10 },
      { gapCloseMm: 2 },
      { outlinesBlack: false },
    ])
      expect(needsReanalysis(settings, { ...settings, ...patch })).toBe(true);
  });
  it('keeps enclosed background colour as an interior entry', async () => {
    const a = analyze(testImage(), settings);
    const bg = a.palette.find((p) => p.role === 'background')!;
    const inner = a.palette.find((p) => p.role === 'interior')!;
    expect(inner).toBeDefined();
    expect(inner.deleted).toBe(false);
    expect(inner.monoInclude).toBe(false);
    expect(inner.rgb).toEqual(bg.rgb);
    expect(inner.name).toBe(bg.name);
    expect(inner.id).not.toBe(bg.id);
    // annulus 50 <= r < 70 around (100,100): pi*(70^2-50^2) ~ 7540 px
    expect(inner.pixelCount).toBeGreaterThan(6500);
    expect(inner.pixelCount).toBeLessThan(8500);
    expect(a.palette.filter((p) => !p.role).every((p) => p.rgb.some((c) => c < 240))).toBe(true);
    // Mono still cuts only the darkest colour.
    const mono = { ...settings, mode: 'mono' as const };
    const r = await render(a, a.palette, mono, boxTracer);
    expect(r.layers.map((l) => l.name)).toEqual(['schnitt']);
  });

  it('removes interior areas below the minimum part size', () => {
    // White background, black square 60x60 with a white hole of side `hole` in its centre.
    const img = (hole: number): RGBAImage => {
      const size = 100;
      const data = new Uint8ClampedArray(size * size * 4).fill(255);
      for (let y = 20; y < 80; y++)
        for (let x = 20; x < 80; x++) {
          const inHole = Math.abs(x - 49.5) < hole / 2 && Math.abs(y - 49.5) < hole / 2;
          if (!inHole) data.set([0, 0, 0, 255], (y * size + x) * 4);
        }
      return { width: size, height: size, data };
    };
    // 1 cm wide -> 10 px/mm; minimum 1 mm^2 = 100 px.
    const s: Settings = { ...settings, colorCount: 2, targetWidthCm: 1, gapCloseMm: 0 };
    expect(analyze(img(6), s).palette.some((p) => p.role === 'interior')).toBe(false);
    const big = analyze(img(20), s).palette.find((p) => p.role === 'interior');
    // 20x20 hole, corners slightly rounded by the majority filter.
    expect(big?.pixelCount).toBeGreaterThan(360);
    expect(big?.pixelCount).toBeLessThanOrEqual(400);
  });
  it('never makes the interior copy of a dark background the mono colour', async () => {
    // Black background, red ring (70 <= r < 90) enclosing black, blue square outside the ring.
    const size = 200;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const r = Math.hypot(x - 100, y - 100);
        let c = [0, 0, 0];
        if (r >= 70 && r < 90) c = [220, 20, 20];
        else if (x >= 175 && y >= 175 && x < 195 && y < 195) c = [30, 60, 200];
        data.set([...c, 255], (y * size + x) * 4);
      }
    const s: Settings = { ...settings, colorCount: 3, mode: 'mono' };
    const a = analyze({ width: size, height: size, data }, s);
    const inner = a.palette.find((p) => p.role === 'interior')!;
    expect(inner).toBeDefined();
    expect(inner.monoInclude).toBe(false);
    const mono = a.palette.filter((p) => p.monoInclude);
    expect(mono).toHaveLength(1);
    expect(mono[0].role).toBeUndefined();
    // autoLevels stretches the colours; the darkest motif colour is the red ring.
    expect(mono[0].rgb.some((c) => c > 150)).toBe(true);
    const r = await render(a, a.palette, s, boxTracer);
    expect(r.layers.map((l) => l.name)).toEqual(['schnitt']);
    // Stacked multi mode: the base layer is a motif colour, not the interior black.
    const stack = await render(a, a.palette, { ...s, mode: 'multi', stackOnDarkest: true }, boxTracer);
    expect(stack.layers[0].name).not.toBe(`${inner.name}-basis`);
    expect(stack.layers[0].name.endsWith('-basis')).toBe(true);
  });
});

describe('render abort', () => {
  it('stops after the layer during which shouldAbort turned true, without an SVG', async () => {
    const a = analyze(testImage(), settings);
    let calls = 0;
    const counting: Tracer = async (...args) => {
      calls++;
      return boxTracer(...args);
    };
    const run = render(a, a.palette, settings, counting, () => calls >= 1);
    await expect(run).rejects.toBeInstanceOf(RenderAbortedError);
    await expect(run).rejects.toMatchObject({ name: 'RenderAbortedError' });
    expect(calls).toBe(1);
  });

  it('traces nothing when aborted before the first layer', async () => {
    const a = analyze(testImage(), settings);
    let calls = 0;
    const counting: Tracer = async (...args) => {
      calls++;
      return boxTracer(...args);
    };
    await expect(render(a, a.palette, settings, counting, () => true)).rejects.toBeInstanceOf(RenderAbortedError);
    expect(calls).toBe(0);
  });

  it('renders normally while shouldAbort stays false', async () => {
    const a = analyze(testImage(), settings);
    const r = await render(a, a.palette, settings, boxTracer, () => false);
    expect(validateCricutSvg(r.svg)).toEqual([]);
    expect(r.layers.length).toBeGreaterThan(1);
  });
});
