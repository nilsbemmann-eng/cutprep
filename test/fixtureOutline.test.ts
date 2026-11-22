/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dilate } from '../src/core/layers';
import { lightnessChroma } from '../src/core/outline';
import { analyze } from '../src/core/pipeline';
import { autoLevels, flattenAlpha, resizeBilinear, workingSize } from '../src/core/preprocess';
import { DEFAULT_SETTINGS } from '../src/core/types';

// Native-size decode of test/fixtures/grinch-raster.jpg (scripts/make-fixture-rgba.py).
const W = 995;
const H = 1283;

function loadFixture() {
  const raw = gunzipSync(readFileSync(new URL('./fixtures/grinch-995x1283.rgba.gz', import.meta.url)));
  return { width: W, height: H, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length) };
}

/**
 * Outline reference: pixels of the levelled working image with L* < 40. That is the midpoint
 * between the ink (L* ≈ 6 after levels) and the lime green (L* ≈ 74), and below the red fill
 * (L* ≈ 47), so every reference pixel is closer to ink than to the fill it sits on. (L* < 45
 * would also count the dark JPEG shading inside the red hat.)
 */
const REF_L = 40;

describe('real fixture outlines (grinch, defaults)', () => {
  it('puts the complete line art on the black layer without flooding colour areas', () => {
    const src = loadFixture();
    const a = analyze(src, DEFAULT_SETTINGS);
    const { width: w, height: h } = workingSize(W, H, DEFAULT_SETTINGS.targetWidthCm);
    const { L } = lightnessChroma(autoLevels(resizeBilinear(flattenAlpha(src).image, w, h)));
    const black = a.palette.find((p) => p.monoInclude)!;
    expect(black.name).toBe('schwarz');

    const ref = new Uint8Array(w * h);
    for (let i = 0; i < ref.length; i++) ref[i] = L[i] < REF_L ? 1 : 0;
    const nearRef = dilate(ref, w, h, 3);
    let refN = 0;
    let hit = 0;
    let layer = 0;
    let notRef = 0;
    let far = 0;
    let light = 0;
    for (let i = 0; i < ref.length; i++) {
      const inLayer = a.labels[i] === black.id;
      if (ref[i]) refN++;
      if (!inLayer) continue;
      layer++;
      if (ref[i]) hit++;
      else notRef++;
      if (!nearRef[i]) far++;
      if (L[i] >= 60) light++;
    }
    // Calibration 2026-11-22: recall 93.5 % (66.8 % before the outline step); 26.8 % of the
    // layer lies outside the reference, almost all anti-aliasing fringe and faint strokes
    // with L* 40-60; 5.8 % is farther than 3 px from any reference pixel (faint strokes on
    // the white fur and hand), 3.3 % is light (L* >= 60). A flooded colour area would push
    // the last two up at once.
    // Round 2 (gap closing): faint stroke parts up to L* 70 that hang on a line (hysteresis)
    // and bridges across white gaps are added on purpose; both lie away from the L* < 40
    // reference by definition. Measured: recall 93.8 %, outside 29.7 %, farther than 3 px
    // 9.4 %, light 6.0 %, black layer 10.0 % of the image (9.6 % before).
    expect(hit / refN).toBeGreaterThanOrEqual(0.9);
    expect(notRef / layer).toBeLessThan(0.32);
    expect(far / layer).toBeLessThan(0.11);
    expect(light / layer).toBeLessThan(0.08);
    expect(layer / ref.length).toBeLessThan(0.11);
    // The dark-green anti-aliasing cluster no longer exists as a layer of its own.
    expect(a.palette.map((p) => p.name)).not.toContain('dunkelgrün');
  }, 60000);
});
