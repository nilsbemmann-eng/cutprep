import { describe, it, expect } from 'vitest';
import { scalePathData, layerIds, buildSvg, validateCricutSvg } from '../src/core/svg';
import { toHex } from '../src/core/color';

describe('scalePathData', () => {
  it('scales every number', () => {
    expect(scalePathData('M10 20C30 40 50 60 70 80', 0.1)).toBe('M1 2C3 4 5 6 7 8');
  });
  it('handles negative, leading-dot and exponent numbers', () => {
    expect(scalePathData('M-1.5 .5L1e-3 2', 2)).toBe('M-3 1L0.002 4');
  });
  it('handles commands glued to numbers and glued decimals', () => {
    expect(scalePathData('M10,20c-1.5.5', 2)).toBe('M20 40c-3 1');
  });
  it('rounds to 3 decimals, strips trailing zeros and negative zero', () => {
    expect(scalePathData('M1 1L-0.0001 3', 0.3333)).toBe('M0.333 0.333L0 1');
    expect(scalePathData('M10 10', 0.05)).toBe('M0.5 0.5');
  });
  it('keeps Z', () => {
    expect(scalePathData('M0 0L10 0L10 10Z', 0.5)).toBe('M0 0L5 0L5 5Z');
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
  { name: 'rot', color: [220, 30, 40] as [number, number, number], paths: ['M0 0L5 0L5 5Z'] },
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
