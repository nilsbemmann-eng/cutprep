import { describe, it, expect } from 'vitest';
import { scalePathData, transformPathData, layerIds, buildSvg, validateCricutSvg } from '../src/core/svg';
import { toHex } from '../src/core/color';

describe('scalePathData', () => {
  it('scales every number', () => {
    expect(scalePathData('M10 20C30 40 50 60 70 80', 0.1)).toBe('M1 2 C3 4 5 6 7 8');
  });
  it('handles negative, leading-dot and exponent numbers', () => {
    expect(scalePathData('M-1.5 .5L1e-3 2', 2)).toBe('M-3 1 L0.002 4');
  });
  it('handles commands glued to numbers and glued decimals', () => {
    expect(scalePathData('M10,20c-1.5.5', 2)).toBe('M20 40 c-3 1');
  });
  it('rounds to 3 decimals, strips trailing zeros and negative zero', () => {
    expect(scalePathData('M1 1L-0.0001 3', 0.3333)).toBe('M0.333 0.333 L0 1');
    expect(scalePathData('M10 10', 0.05)).toBe('M0.5 0.5');
  });
  it('keeps Z', () => {
    expect(scalePathData('M0 0L10 0L10 10Z', 0.5)).toBe('M0 0 L5 0 L5 5 Z');
  });
});

describe('transformPathData', () => {
  it('normalises potrace output (10x, Y up) with relative commands', () => {
    expect(transformPathData('M50 150l0 -100 150 0z', 0.1, -0.1, 30)).toBe('M5 15 l0 10 15 0 z');
  });
  it('transforms absolute follow-up commands', () => {
    expect(transformPathData('M0 0L10 20C1 2 3 4 5 6', 1, -1, 100)).toBe('M0 100 L10 80 C1 98 3 96 5 94');
  });
  it('treats implicit pairs after M as absolute lines', () => {
    expect(transformPathData('M0 0 10 10 20 20', 1, -1, 100)).toBe('M0 100 10 90 20 80');
  });
  it('handles H/V/h/v', () => {
    expect(transformPathData('M0 0H10V20', 2, -3, 100)).toBe('M0 100 H20 V40');
    expect(transformPathData('M0 0h10v20', 2, -3, 100)).toBe('M0 100 h20 v-60');
  });
  it('maps an asymmetric potrace point to the right pixel row', () => {
    expect(transformPathData('M10 250', 0.1, -0.1, 30)).toBe('M1 5');
  });
  it('throws on arcs', () => {
    expect(() => transformPathData('M0 0A1 1 0 0 1 2 2', 1, 1, 0)).toThrow();
    expect(() => transformPathData('M0 0a1 1 0 0 1 2 2', 1, 1, 0)).toThrow();
  });
});

describe('layerIds', () => {
  it('replaces umlauts and dedupes', () => {
    expect(layerIds(['grün', 'grün', 'weiß'])).toEqual(['gruen', 'gruen-2', 'weiss']);
  });
  it('lowercases, maps other chars to dash and counts 3rd duplicate', () => {
    expect(layerIds(['Dunkel Rot', 'Köln', 'a', 'a', 'a'])).toEqual([
      'dunkel-rot', 'koeln', 'a', 'a-2', 'a-3',
    ]);
  });
});

describe('toHex', () => {
  it('clamps and rounds', () => {
    expect(toHex([300, -5, 127.6])).toBe('#ff0080');
  });
});

const layers = [
  { name: 'grün', color: [40, 160, 50] as [number, number, number], paths: ['M0 0L1 0L1 1Z', 'M2 2L3 2L3 3Z'] },
  { name: 'leer', color: [0, 0, 0] as [number, number, number], paths: [] },
  { name: 'rot', color: [220, 30, 40] as [number, number, number], paths: ['M0 0 L5 0 L5 5 Z'] },
];

describe('buildSvg', () => {
  const svg = buildSvg(layers, 200, 150);
  it('has mm size and viewBox', () => {
    expect(svg).toContain('width="200mm"');
    expect(svg).toContain('height="150mm"');
    expect(svg).toContain('viewBox="0 0 200 150"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
  it('rounds size to 3 decimals', () => {
    expect(buildSvg(layers, 200.12345, 99.9999)).toContain('viewBox="0 0 200.123 100"');
  });
  it('emits one group with one evenodd path per non-empty layer', () => {
    expect((svg.match(/<g /g) ?? []).length).toBe(2);
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    expect(svg).toContain('<g id="gruen">');
    expect(svg).not.toContain('id="leer"');
    expect(svg).toContain('<path fill="#28a032" fill-rule="evenodd" d="M0 0L1 0L1 1Z M2 2L3 2L3 3Z"/>');
  });
  it('passes validation', () => {
    expect(validateCricutSvg(svg)).toEqual([]);
  });
});

describe('validateCricutSvg', () => {
  it('flags forbidden elements and attributes', () => {
    const bad =
      '<svg width="10" height="10mm" viewBox="0 0 10 10"><g transform="x"><text>a</text><path d="M0 0" stroke="#000"/></g></svg>';
    const v = validateCricutSvg(bad).join('|');
    expect(v).toContain('<text>');
    expect(v).toContain('transform=');
    expect(v).toContain('stroke=');
    expect(v).toContain('width');
    expect(v).toContain('fill');
  });
  it('flags other forbidden elements', () => {
    for (const el of ['mask', 'filter', 'clipPath', 'image', 'style', 'use', 'defs']) {
      const s = `<svg width="1mm" height="1mm"><${el}/></svg>`;
      expect(validateCricutSvg(s).join('|')).toContain(`<${el}>`);
    }
  });
});
