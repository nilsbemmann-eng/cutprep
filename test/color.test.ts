import { describe, it, expect } from 'vitest';
import { rgbToLab, deltaE, germanColorName, toHex } from '../src/core/color';
import { DEFAULT_SETTINGS } from '../src/core/types';

describe('color', () => {
  it('converts white to Lab [100,0,0]', () => {
    const [l, a, b] = rgbToLab([255, 255, 255]);
    expect(l).toBeCloseTo(100, 0);
    expect(Math.abs(a)).toBeLessThan(0.5);
    expect(Math.abs(b)).toBeLessThan(0.5);
  });
  it('deltaE is 0 for identical colors and positive otherwise', () => {
    expect(deltaE([10, 20, 30], [10, 20, 30])).toBe(0);
    expect(deltaE([0, 0, 0], [255, 255, 255])).toBeGreaterThan(90);
  });
  it('names colors in German', () => {
    expect(germanColorName([230, 30, 40])).toBe('rot');
    expect(['grün', 'hellgrün']).toContain(germanColorName([140, 200, 40]));
    expect(germanColorName([20, 20, 20])).toBe('schwarz');
    expect(germanColorName([245, 245, 245])).toBe('weiß');
  });
  it('formats hex', () => {
    expect(toHex([255, 0, 16])).toBe('#ff0010');
  });
  it('has the specified default settings', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      colorCount: 6, targetWidthCm: 20, minPartAreaMm2: 1,
      smoothing: 0.5, overlapMm: 0.4, mode: 'multi', stackOnDarkest: false, gapCloseMm: 1,
      outlinesBlack: true,
    });
  });
});
