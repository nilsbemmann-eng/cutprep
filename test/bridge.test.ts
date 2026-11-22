import { describe, expect, it } from 'vitest';
import { bridgeGaps, thin } from '../src/core/bridge';
import { splitInteriorBackground } from '../src/core/interior';

const W = 120;
const H = 120;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function mask(draw: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (draw(x + 0.5, y + 0.5)) m[y * W + x] = 1;
  return m;
}
const seg = (ax: number, ay: number, bx: number, by: number, width: number) => (x: number, y: number) =>
  segDist(x, y, ax, ay, bx, by) < width / 2;

function components(m: Uint8Array): number {
  const seen = new Uint8Array(m.length);
  let n = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || seen[s]) continue;
    n++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (m[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
    }
  }
  return n;
}
const count = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);

/** Share of the image enclosed by the mask (flood fill from the border, no gap closing). */
function enclosed(m: Uint8Array): number {
  const labels = Int16Array.from(m, (v) => (v ? 1 : 0));
  const out = splitInteriorBackground(labels, W, H, 0, 0, 9).labels;
  return out.reduce((a, v) => a + (v === 9 ? 1 : 0), 0) / m.length;
}

const opts = { maxGapPx: 12, maxHalfWidthPx: 5 };

describe('thin', () => {
  it('reduces a 5 px bar to a 1 px line and records the half-width', () => {
    const m = mask(seg(20, 60, 100, 60, 5));
    const { skel, peel } = thin(m, W, H);
    for (let x = 30; x < 90; x++) {
      let col = 0;
      for (let y = 50; y < 70; y++) col += skel[y * W + x];
      expect(col).toBe(1);
    }
    expect(Math.max(...peel)).toBe(2);
  });
});

describe('bridgeGaps', () => {
  it('joins two collinear strokes across an 8 px gap with a bridge of the line width', () => {
    const m = mask((x, y) => seg(10, 60, 50, 60, 3)(x, y) || seg(58, 60, 110, 60, 3)(x, y));
    const before = count(m);
    expect(components(m)).toBe(2);
    expect(bridgeGaps(m, W, H, opts)).toBeGreaterThan(0);
    expect(components(m)).toBe(1);
    // Roughly gap × line width, not a blob.
    expect(count(m) - before).toBeLessThan(8 * 5 + 10);
    for (let x = 0; x < W; x++) {
      expect(m[50 * W + x]).toBe(0);
      expect(m[70 * W + x]).toBe(0);
    }
  });

  it('leaves gaps longer than maxGapPx open', () => {
    const m = mask((x, y) => seg(10, 60, 40, 60, 3)(x, y) || seg(60, 60, 110, 60, 3)(x, y));
    bridgeGaps(m, W, H, opts);
    expect(components(m)).toBe(2);
  });

  it('closes a ring with a gap, so its inside becomes enclosed', () => {
    const ring = (x: number, y: number) => {
      const d = Math.hypot(x - 60, y - 60);
      const ang = Math.atan2(y - 60, x - 60);
      return d < 40 && d >= 37 && Math.abs(ang) > 0.1; // gap ≈ 8 px at angle 0
    };
    const m = mask(ring);
    expect(enclosed(m)).toBe(0);
    bridgeGaps(m, W, H, opts);
    expect(enclosed(m)).toBeGreaterThan(0.25);
  });

  it('does not merge parallel strokes that end side by side', () => {
    const m = mask((x, y) => seg(10, 40, 100, 40, 3)(x, y) || seg(10, 47, 100, 47, 3)(x, y) || seg(10, 54, 100, 54, 3)(x, y));
    const before = count(m);
    bridgeGaps(m, W, H, opts);
    expect(components(m)).toBe(3);
    expect(count(m)).toBe(before);
  });

  it('connects a stroke that stops short of a crossing line (T-junction)', () => {
    const m = mask((x, y) => seg(60, 10, 60, 100, 3)(x, y) || seg(10, 55, 52, 55, 3)(x, y));
    bridgeGaps(m, W, H, opts);
    expect(components(m)).toBe(1);
  });

  it('leaves a free stroke end with nothing ahead alone', () => {
    const m = mask((x, y) => seg(20, 60, 60, 60, 3)(x, y) || seg(70, 20, 110, 20, 3)(x, y));
    const before = m.slice();
    bridgeGaps(m, W, H, opts);
    expect(m).toEqual(before);
  });

  it('does not bridge through pixels that are not allowed', () => {
    const m = mask((x, y) => seg(10, 60, 50, 60, 3)(x, y) || seg(58, 60, 110, 60, 3)(x, y));
    const ok = mask((x) => x < 52 || x > 56);
    bridgeGaps(m, W, H, { ...opts, allowed: (i) => ok[i] === 1 });
    expect(components(m)).toBe(2);
  });

  it('does not bridge from the ends of wide shapes', () => {
    const m = mask((x, y) => seg(10, 60, 50, 60, 16)(x, y) || seg(74, 60, 110, 60, 16)(x, y));
    bridgeGaps(m, W, H, opts);
    expect(components(m)).toBe(2);
  });

  it('stops searching when the work budget is used up and stays deterministic', () => {
    const draw = (x: number, y: number) =>
      seg(10, 30, 50, 30, 3)(x, y) || seg(58, 30, 110, 30, 3)(x, y) ||
      seg(10, 80, 50, 80, 3)(x, y) || seg(58, 80, 110, 80, 3)(x, y);
    const stats = (): NonNullable<Parameters<typeof bridgeGaps>[3]['stats']> => ({
      ends: 0, noTarget: 0, foreign: 0, bridged: 0, budgetExhausted: false,
    });
    const full = mask(draw);
    const fullStats = stats();
    const nFull = bridgeGaps(full, W, H, { ...opts, stats: fullStats });
    expect(fullStats.budgetExhausted).toBe(false);

    const none = mask(draw);
    const before = none.slice();
    const noneStats = stats();
    expect(bridgeGaps(none, W, H, { ...opts, maxWork: 0, stats: noneStats })).toBe(0);
    expect(none).toEqual(before);
    expect(noneStats.budgetExhausted).toBe(true);

    const run = () => {
      const m = mask(draw);
      const st = stats();
      const n = bridgeGaps(m, W, H, { ...opts, maxWork: Math.floor(fullStats.work! * 0.6), stats: st });
      return { m, n, st };
    };
    const a = run();
    const b = run();
    expect(a.st.budgetExhausted).toBe(true);
    expect(a.n).toBeGreaterThan(0); // bridges found before the budget ran out are kept
    expect(a.n).toBeLessThan(nFull);
    expect(a.m).toEqual(b.m);
    expect(a.n).toBe(b.n);
  });
});
