/**
 * Review cases for "Konturen komplett in Schwarz" (synthetic, 4 cm at 10 px/mm, so the
 * working image equals the source). Each case guards one way the outline step used to
 * repaint things that are not outlines.
 */
import { describe, expect, it } from 'vitest';
import { rgbToLab } from '../src/core/color';
import { carryOverPaletteEdits } from '../src/core/paletteCarry';
import { analyze, type Analysis } from '../src/core/pipeline';
import { DEFAULT_SETTINGS, type RGB, type RGBAImage, type Settings } from '../src/core/types';

const S = 400;
type Shape = (x: number, y: number) => boolean;
type Layer = { shape: Shape; rgb: RGB };

/** Renders layers back to front with 4×4 supersampling (anti-aliased edges). */
function render(bg: RGB, layers: Layer[]): RGBAImage {
  const data = new Uint8ClampedArray(S * S * 4);
  const ss = 4;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          let c = bg;
          for (const l of layers) if (l.shape(px, py)) c = l.rgb;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      const o = (y * S + x) * 4;
      const n = ss * ss;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
      data[o + 3] = 255;
    }
  return { width: S, height: S, data };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Shape => (x, y) =>
  x >= x0 && x < x1 && y >= y0 && y < y1;
const circ = (cx: number, cy: number, r: number): Shape => (x, y) => Math.hypot(x - cx, y - cy) < r;
const ring = (cx: number, cy: number, r: number, w: number): Shape => (x, y) => {
  const d = Math.hypot(x - cx, y - cy);
  return d < r && d >= r - w;
};
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const line = (ax: number, ay: number, bx: number, by: number, w: number): Shape => (x, y) =>
  segDist(x, y, ax, ay, bx, by) < w / 2;
const frame = (x0: number, y0: number, x1: number, y1: number, w: number): Shape => (x, y) =>
  rect(x0, y0, x1, y1)(x, y) && !rect(x0 + w, y0 + w, x1 - w, y1 - w)(x, y);

const INK: RGB = [15, 12, 10];
const WHITE: RGB = [255, 255, 255];
const base: Settings = { ...DEFAULT_SETTINGS, targetWidthCm: 4 };

/** Label ids of the layer Einfarbig cuts. */
const cutIds = (a: Analysis) => new Set(a.palette.filter((p) => p.monoInclude).map((p) => p.id));

/** Share of the pixel centres inside `shape` for which `test(label)` holds. */
function share(a: Analysis, shape: Shape, test: (label: number, i: number) => boolean): number {
  let n = 0;
  let hit = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (!shape(x + 0.5, y + 0.5)) continue;
      n++;
      const i = y * a.width + x;
      if (test(a.labels[i], i)) hit++;
    }
  expect(n).toBeGreaterThan(0);
  return hit / n;
}

const onCut = (a: Analysis, shape: Shape) => {
  const ids = cutIds(a);
  return share(a, shape, (l) => ids.has(l));
};

describe('outline review cases', () => {
  it('C: keeps dark low-chroma fills (brown, navy, charcoal) in their own colour', () => {
    const fills: [RGB, number, number][] = [
      [[70, 45, 25], 20, 20], // brown
      [[25, 35, 70], 210, 20], // navy
      [[55, 55, 55], 20, 210], // charcoal
      [[20, 70, 30], 210, 210], // dark green
    ];
    const layers: Layer[] = [];
    const inner: Shape[] = [];
    const lines: Shape[] = [];
    for (const [rgb, x, y] of fills) {
      layers.push({ shape: rect(x, y, x + 170, y + 170), rgb: INK });
      layers.push({ shape: rect(x + 6, y + 6, x + 164, y + 164), rgb });
      layers.push({ shape: line(x + 30, y + 85, x + 140, y + 85, 3), rgb: INK });
      inner.push(rect(x + 15, y + 15, x + 155, y + 70));
      lines.push(line(x + 40, y + 85, x + 130, y + 85, 2));
    }
    const img = render(WHITE, layers);
    const s = { ...base, colorCount: 6 };
    const on = analyze(img, s);
    const off = analyze(img, { ...s, outlinesBlack: false });
    // Every fill keeps the label it has without the outline step.
    for (const sh of inner) expect(share(on, sh, (l, i) => l === off.labels[i])).toBeGreaterThan(0.97);
    // The black layer does not swallow the fills (it was 57 % of the image).
    const black = on.palette.find((p) => p.monoInclude)!;
    expect(black.pixelCount / on.labels.length).toBeLessThan(0.32);
    // The thin ink lines inside the fills are black.
    for (const sh of lines) expect(onCut(on, sh)).toBeGreaterThan(0.9);
  });

  it('D: black text on dark red goes to a neutral black layer, not to the red', () => {
    const bars: Shape[] = [];
    for (let i = 0; i < 8; i++) bars.push(line(60 + i * 38, 140, 60 + i * 38, 260, 5));
    const img = render(WHITE, [
      { shape: rect(30, 100, 370, 300), rgb: [120, 15, 20] },
      ...bars.map((shape) => ({ shape, rgb: INK })),
      { shape: circ(200, 40, 25), rgb: [250, 200, 20] },
    ]);
    const a = analyze(img, base);
    const cut = a.palette.filter((p) => p.monoInclude);
    expect(cut).toHaveLength(1);
    const [L, A, B] = rgbToLab(cut[0].rgb);
    expect(L).toBeLessThan(25);
    expect(Math.hypot(A, B)).toBeLessThan(20);
    expect(onCut(a, (x, y) => bars.some((b) => b(x, y)) && y > 150 && y < 250)).toBeGreaterThan(0.95);
    // Red farther than 6 px from every bar.
    const red = (x: number, y: number) =>
      rect(40, 110, 360, 290)(x, y) && !bars.some((_, i) => Math.abs(x - (60 + i * 38)) < 8.5 && y > 131 && y < 269);
    expect(onCut(a, red)).toBeLessThan(0.02);
  });

  it('F: a thin white line on a black background stays white', () => {
    const img = render([0, 0, 0], [
      { shape: circ(200, 200, 120), rgb: WHITE },
      { shape: circ(200, 200, 90), rgb: [0, 0, 0] },
      { shape: line(80, 350, 320, 350, 4), rgb: WHITE },
      { shape: circ(200, 200, 40), rgb: [220, 30, 40] },
    ]);
    const on = analyze(img, base);
    const off = analyze(img, { ...base, outlinesBlack: false });
    for (const sh of [line(90, 350, 310, 350, 2), ring(200, 200, 116, 22), circ(200, 200, 34)])
      expect(share(on, sh, (l, i) => l === off.labels[i])).toBeGreaterThan(0.97);
    const white = on.palette.find((p) => p.name === 'weiß' && !p.role)!;
    expect(share(on, line(90, 350, 310, 350, 2), (l) => l === white.id)).toBeGreaterThan(0.95);
  });

  it('I: thin dark-green stems outlined in black keep their colour', () => {
    const layers: Layer[] = [
      { shape: circ(300, 120, 70), rgb: INK },
      { shape: circ(300, 120, 64), rgb: [136, 199, 5] },
    ];
    const stems: Shape[] = [];
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 40;
      layers.push({ shape: line(x, 120, x + 10, 380, 10), rgb: INK }); // 1.0 mm in total
      layers.push({ shape: line(x, 120, x + 10, 380, 6), rgb: [20, 90, 40] }); // 0.6 mm core
      stems.push(line(x, 130, x + 10, 370, 4));
    }
    const img = render(WHITE, [...layers, { shape: circ(330, 320, 40), rgb: [220, 30, 40] }]);
    const a = analyze(img, { ...base, colorCount: 5 });
    const core = (x: number, y: number) => stems.some((s) => s(x, y));
    // Was 100 %. What is left (≈ 7 %) is the halo split of the seam between the black outline
    // and the 6 px core, which reaches into the measured inner 4 px on the slanted stems.
    expect(onCut(a, core)).toBeLessThan(0.1);
    expect(a.palette.some((p) => p.name === 'dunkelgrün')).toBe(true);
  });

  it('J: a thin mid-grey design line is not turned black', () => {
    const img = render(WHITE, [
      { shape: frame(30, 30, 370, 370, 4), rgb: INK },
      { shape: line(60, 120, 340, 120, 4), rgb: [130, 130, 130] },
      { shape: line(60, 200, 340, 200, 4), rgb: [150, 150, 150] },
      { shape: rect(60, 260, 200, 340), rgb: [150, 150, 150] },
      { shape: circ(280, 300, 40), rgb: [220, 30, 40] },
    ]);
    const a = analyze(img, base);
    expect(onCut(a, line(70, 120, 330, 120, 2))).toBeLessThan(0.1);
    expect(onCut(a, line(70, 200, 330, 200, 2))).toBeLessThan(0.1);
    expect(onCut(a, frame(31, 31, 369, 369, 2))).toBeGreaterThan(0.95);
  });

  it('K: 0.8 mm navy strokes stay navy next to a black frame', () => {
    const img = render(WHITE, [
      { shape: frame(20, 20, 380, 380, 5), rgb: INK },
      { shape: line(60, 120, 340, 120, 8), rgb: [0, 0, 128] },
      { shape: line(60, 200, 340, 200, 8), rgb: [25, 35, 70] },
      { shape: circ(200, 300, 50), rgb: [220, 30, 40] },
    ]);
    const a = analyze(img, base);
    expect(onCut(a, line(70, 120, 330, 120, 7))).toBeLessThan(0.1);
    expect(onCut(a, line(70, 200, 330, 200, 7))).toBeLessThan(0.1);
  });

  it('L: toggling the setting keeps the cut flag on the analysis default', () => {
    const img = render(WHITE, [
      { shape: rect(20, 20, 380, 380), rgb: [136, 199, 5] },
      { shape: rect(250, 40, 350, 140), rgb: [220, 30, 40] },
      { shape: line(60, 200, 340, 260, 2.5), rgb: INK },
      { shape: line(60, 300, 340, 300, 2.5), rgb: INK },
    ]);
    const s = { ...base, colorCount: 3 };
    const on = analyze(img, { ...s, outlinesBlack: true });
    const off = analyze(img, { ...s, outlinesBlack: false });
    const flags = (p: Analysis['palette']) => p.map((e) => [e.id, e.monoInclude]);
    expect(flags(carryOverPaletteEdits(on.palette, off.palette))).toEqual(flags(off.palette));
    expect(flags(carryOverPaletteEdits(off.palette, on.palette))).toEqual(flags(on.palette));
    // A cut flag the user set by hand still survives the toggle.
    const edited = off.palette.map((e) => ({ ...e, monoInclude: e.name === 'hellgrün' ? true : e.monoInclude }));
    const carried = carryOverPaletteEdits(edited, on.palette);
    expect(carried.find((e) => e.name === 'hellgrün')!.monoInclude).toBe(true);
  });

  it('M: bridgeGapMm alone decides whether a line gap is bridged', () => {
    // Two collinear 3 px (0.3 mm) strokes with a 16 px (1.6 mm) gap between them.
    const img = render(WHITE, [
      { shape: line(60, 200, 190, 200, 3), rgb: INK },
      { shape: line(206, 200, 340, 200, 3), rgb: INK },
    ]);
    const gap = rect(194, 199, 202, 202);
    const at = (s: Settings) => onCut(analyze(img, s), gap);
    expect(at({ ...base, bridgeGapMm: 0 })).toBeLessThan(0.1);
    expect(at({ ...base, bridgeGapMm: 2 })).toBeGreaterThan(0.9);
    // Too short for this gap: stays open.
    expect(at({ ...base, bridgeGapMm: 1 })).toBeLessThan(0.1);
    // gapCloseMm only drives the interior split, not the bridges.
    expect(at({ ...base, bridgeGapMm: 2, gapCloseMm: 0 })).toBeGreaterThan(0.9);
    expect(at({ ...base, bridgeGapMm: 0, gapCloseMm: 3 })).toBeLessThan(0.1);
  });
});
