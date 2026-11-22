import { describe, expect, it } from 'vitest';
import { carryOverPaletteEdits } from '../src/core/paletteCarry';
import type { PaletteEntry, RGB } from '../src/core/types';

function entry(id: number, rgb: RGB, name: string, over: Partial<PaletteEntry> = {}): PaletteEntry {
  return {
    id,
    rgb,
    originalRgb: rgb,
    name,
    deleted: false,
    mergedInto: null,
    monoInclude: false,
    pixelCount: 100,
    ...over,
  };
}

const RED: RGB = [220, 30, 30];
const BLACK: RGB = [20, 20, 20];
const WHITE: RGB = [252, 252, 252];
const GREEN: RGB = [130, 200, 10];
const BLUE: RGB = [30, 70, 220];

describe('carryOverPaletteEdits', () => {
  it('carries deleted, monoInclude and a recolour to the nearest new cluster', () => {
    const old = [
      entry(0, WHITE, 'weiß', { deleted: true }),
      entry(1, [255, 225, 0], 'gelb', { originalRgb: RED }), // red recoloured to yellow
      entry(2, BLACK, 'schwarz', { monoInclude: true }),
    ];
    // New analysis: slightly different colours, different order/ids.
    const fresh = [
      entry(0, [250, 250, 250], 'weiß', { deleted: true }),
      entry(1, [24, 18, 16], 'schwarz', { monoInclude: true }),
      entry(2, [214, 34, 30], 'rot'),
    ];
    const out = carryOverPaletteEdits(old, fresh);
    expect(out.map((e) => e.id)).toEqual([0, 1, 2]);
    expect(out[0].deleted).toBe(true);
    expect(out[1]).toMatchObject({ name: 'schwarz', monoInclude: true, rgb: [24, 18, 16] });
    // The recolour wins over the new cluster colour, the original colour is the new cluster's.
    expect(out[2]).toMatchObject({ rgb: [255, 225, 0], name: 'gelb', originalRgb: [214, 34, 30] });
    expect(out[2].pixelCount).toBe(100);
  });

  it('remaps mergedInto to the new ids and drops it when the target has no match', () => {
    const old = [
      entry(0, WHITE, 'weiß'),
      entry(1, GREEN, 'hellgrün', { mergedInto: 2 }),
      entry(2, RED, 'rot'),
      entry(3, BLACK, 'schwarz', { mergedInto: 4 }),
      entry(4, BLUE, 'blau'),
    ];
    const fresh = [entry(0, WHITE, 'weiß'), entry(1, RED, 'rot'), entry(2, GREEN, 'hellgrün'), entry(3, BLACK, 'schwarz')];
    const out = carryOverPaletteEdits(old, fresh);
    expect(out.find((e) => e.name === 'hellgrün')!.mergedInto).toBe(1);
    expect(out.find((e) => e.name === 'schwarz')!.mergedInto).toBeNull();
  });

  it('gives entries beyond the deltaE cut-off the analysis defaults', () => {
    const old = [entry(0, RED, 'rot', { deleted: true, monoInclude: true })];
    const fresh = [entry(0, BLUE, 'blau'), entry(1, [215, 35, 35], 'rot')];
    const out = carryOverPaletteEdits(old, fresh);
    expect(out[0]).toMatchObject({ name: 'blau', deleted: false, monoInclude: false });
    expect(out[1]).toMatchObject({ name: 'rot', deleted: true, monoInclude: true });
  });

  it('matches one-to-one: two new clusters near one old entry only inherit once', () => {
    const old = [entry(0, RED, 'rot', { deleted: true })];
    const fresh = [entry(0, [200, 40, 40], 'rot'), entry(1, [221, 31, 30], 'rot')];
    const out = carryOverPaletteEdits(old, fresh);
    expect(out[0].deleted).toBe(false);
    expect(out[1].deleted).toBe(true);
  });

  it('does not mutate its inputs', () => {
    const old = [entry(0, RED, 'rot', { deleted: true })];
    const fresh = [entry(0, RED, 'rot')];
    carryOverPaletteEdits(old, fresh);
    expect(fresh[0].deleted).toBe(false);
  });
  it('never pairs the background with the interior entry of the same colour', () => {
    // User deleted the interior white and recoloured the background (unusual, but possible).
    const old = [
      entry(0, [250, 250, 250], 'weiß', { role: 'background', deleted: false }),
      entry(1, BLACK, 'schwarz'),
      entry(6, [250, 250, 250], 'weiß', { role: 'interior', deleted: true }),
    ];
    // Re-analysis: the interior white is now slightly closer to the old background colour.
    const fresh = [
      entry(0, [253, 253, 253], 'weiß', { role: 'interior' }),
      entry(1, [22, 22, 22], 'schwarz'),
      entry(2, [240, 240, 240], 'weiß', { role: 'background', deleted: true }),
    ];
    const out = carryOverPaletteEdits(old, fresh);
    expect(out.find((e) => e.role === 'interior')!.deleted).toBe(true);
    expect(out.find((e) => e.role === 'background')!.deleted).toBe(false);
    expect(out.find((e) => e.name === 'schwarz')!.deleted).toBe(false);
  });

  it('does not pair role-less entries with background or interior entries', () => {
    const old = [entry(0, WHITE, 'weiß', { deleted: true })];
    const fresh = [entry(0, WHITE, 'weiß', { role: 'interior' })];
    expect(carryOverPaletteEdits(old, fresh)[0].deleted).toBe(false);
  });
  it('drops interior edits when the re-analysis has no interior entry', () => {
    const old = [
      entry(0, WHITE, 'weiß', { role: 'background', deleted: false }),
      entry(1, RED, 'rot', { mergedInto: 6 }),
      entry(6, WHITE, 'weiß', { role: 'interior', deleted: true }),
    ];
    const fresh = [entry(0, WHITE, 'weiß', { role: 'background', deleted: true }), entry(1, RED, 'rot')];
    const out = carryOverPaletteEdits(old, fresh);
    expect(out).toHaveLength(2);
    expect(out[0].deleted).toBe(false); // background keeps its own edit
    expect(out[1].mergedInto).toBeNull(); // merge into the vanished interior is reset
  });
});
