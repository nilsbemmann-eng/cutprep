import type { RGB } from './types';

// D65 reference white
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function labF(t: number): number {
  const d = 6 / 29;
  return t > d * d * d ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29;
}

/** sRGB (0-255) to CIE L*a*b* (D65). */
export function rgbToLab(rgb: RGB): [number, number, number] {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = labF(x / XN);
  const fy = labF(y / YN);
  const fz = labF(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 color difference. */
export function deltaE(a: RGB, b: RGB): number {
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

const COLOR_TABLE: ReadonlyArray<{ name: string; rgb: RGB }> = [
  { name: 'schwarz', rgb: [0, 0, 0] },
  { name: 'weiß', rgb: [255, 255, 255] },
  { name: 'grau', rgb: [128, 128, 128] },
  { name: 'rot', rgb: [220, 30, 40] },
  { name: 'dunkelrot', rgb: [130, 15, 25] },
  { name: 'orange', rgb: [255, 140, 0] },
  { name: 'gelb', rgb: [255, 225, 0] },
  { name: 'grün', rgb: [40, 160, 50] },
  { name: 'dunkelgrün', rgb: [0, 80, 35] },
  { name: 'hellgrün', rgb: [150, 220, 80] },
  { name: 'blau', rgb: [30, 70, 220] },
  { name: 'hellblau', rgb: [130, 200, 245] },
  { name: 'dunkelblau', rgb: [15, 25, 100] },
  { name: 'lila', rgb: [130, 50, 170] },
  { name: 'rosa', rgb: [250, 150, 190] },
  { name: 'braun', rgb: [120, 70, 30] },
  { name: 'beige', rgb: [225, 200, 160] },
  { name: 'türkis', rgb: [20, 190, 180] },
];

const TABLE_LAB = COLOR_TABLE.map((e) => ({ name: e.name, lab: rgbToLab(e.rgb) }));

/** German name of the nearest entry in a fixed color table (by deltaE). */
export function germanColorName(rgb: RGB): string {
  const lab = rgbToLab(rgb);
  let best = TABLE_LAB[0];
  let bestD = Infinity;
  for (const e of TABLE_LAB) {
    const d = Math.hypot(lab[0] - e.lab[0], lab[1] - e.lab[1], lab[2] - e.lab[2]);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best.name;
}

/** '#rrggbb' */
export function toHex(rgb: RGB): string {
  return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
}

function labFInv(t: number): number {
  const d = 6 / 29;
  return t > d ? t * t * t : 3 * d * d * (t - 4 / 29);
}

/** CIE L*a*b* (D65) to sRGB; integers 0-255, clamped. */
export function labToRgb(lab: [number, number, number]): RGB {
  const fy = (lab[0] + 16) / 116;
  const x = XN * labFInv(fy + lab[1] / 500);
  const y = YN * labFInv(fy);
  const z = ZN * labFInv(fy - lab[2] / 200);
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
}
