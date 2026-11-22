import type { RGB } from './types';
import { toHex } from './color';

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? '0' : String(r);
}

const TOKEN = /([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

const ARITY: Record<string, number> = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, z: 0 };

/**
 * Command-aware affine transform of SVG path data (x' = sx*x, y' = ty + sy*y).
 * Absolute coordinates get the translation `ty`; relative ones only the scale.
 * Output: command letter directly followed by its numbers, all separated by single spaces.
 * Arcs are not supported (flags and radii cannot be transformed this way).
 */
export function transformPathData(d: string, sx: number, sy: number, ty: number): string {
  const out: string[] = [];
  let cmd = '';
  let idx = 0; // index of the next number within the current command group
  for (const m of d.matchAll(TOKEN)) {
    if (m[1]) {
      if (/[aA]/.test(m[1])) throw new Error('Arc commands (A/a) are not supported');
      cmd = m[1];
      idx = 0;
      out.push(out.length > 0 ? ` ${cmd}` : cmd);
      continue;
    }
    const lower = cmd.toLowerCase();
    const arity = ARITY[lower];
    if (arity === undefined || arity === 0) throw new Error(`Unexpected number in path data (command "${cmd}")`);
    const abs = cmd !== lower;
    const isX = lower === 'h' || (lower !== 'v' && idx % 2 === 0);
    const v = parseFloat(m[2]);
    const num = fmt(isX ? sx * v : abs ? ty + sy * v : sy * v);
    out.push(idx === 0 && /[a-zA-Z]$/.test(out[out.length - 1] ?? '') ? num : ` ${num}`);
    idx = (idx + 1) % arity;
  }
  return out.join('');
}

/** Multiplies every coordinate in SVG path data by `factor` (no arcs). */
export function scalePathData(d: string, factor: number): string {
  return transformPathData(d, factor, factor, 0);
}

const UMLAUTS: Record<string, string> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };

/** Safe, unique SVG ids from layer names: umlauts expanded, dupes get -2, -3. */
export function layerIds(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = name
      .toLowerCase()
      .replace(/[äöüß]/g, (c) => UMLAUTS[c])
      .replace(/[^a-z0-9-]/g, '-');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

/** Builds the Cricut-compatible SVG. Paths must already be in millimetres. */
export function buildSvg(
  layers: { name: string; color: RGB; paths: string[] }[],
  widthMm: number,
  heightMm: number,
): string {
  const ids = layerIds(layers.map((l) => l.name));
  const w = fmt(widthMm);
  const h = fmt(heightMm);
  const groups: string[] = [];
  layers.forEach((l, i) => {
    if (l.paths.length === 0) return;
    groups.push(
      `<g id="${ids[i]}"><path fill="${toHex(l.color)}" fill-rule="evenodd" d="${l.paths.join(' ')}"/></g>`,
    );
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
    groups.join('\n') +
    `\n</svg>\n`
  );
}

const FORBIDDEN_ELEMENTS = ['text', 'mask', 'filter', 'clipPath', 'image', 'style', 'use', 'defs'];
const FORBIDDEN_ATTRS = ['transform', 'stroke', 'style'];

/** String-based check against the Cricut rules; empty list means OK. */
export function validateCricutSvg(svg: string): string[] {
  const issues: string[] = [];
  for (const el of FORBIDDEN_ELEMENTS) {
    if (new RegExp(String.raw`<${el}[\s/>]`).test(svg)) issues.push(`Verbotenes Element <${el}>`);
  }
  for (const a of FORBIDDEN_ATTRS) {
    if (new RegExp(String.raw`\s${a}\s*=`).test(svg)) issues.push(`Verbotenes Attribut ${a}=`);
  }
  const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
  for (const a of ['width', 'height']) {
    const v = root.match(new RegExp(String.raw`\s${a}="([^"]*)"`))?.[1];
    if (v === undefined || !/^[\d.]+mm$/.test(v)) issues.push(`${a} muss in mm angegeben sein`);
  }
  for (const p of svg.match(/<path\b[^>]*>/g) ?? []) {
    if (!/\sfill="#[0-9a-fA-F]{6}"/.test(p)) issues.push('Pfad ohne fill="#rrggbb"');
  }
  return issues;
}
