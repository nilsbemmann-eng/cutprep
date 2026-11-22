/**
 * Closes short gaps in a line-art mask by connecting line ends to the nearest line ahead.
 *
 * Plain morphological closing would also merge neighbouring parallel strokes into blobs
 * and fill concave corners, so the bridges are built from the line ends instead:
 *
 * 1. The mask is thinned to a 1 px skeleton (Zhang-Suen). `peel` remembers in which
 *    iteration a pixel was removed, which gives the local half-width of the line.
 * 2. Skeleton end points (one run of skeleton neighbours, at most two of them) of thin
 *    lines are the candidates. Walking back along the skeleton gives the line direction;
 *    ends that hit a junction right away are spurs of a ragged edge and are skipped.
 * 3. For each end the best target is a skeleton pixel within reach ahead of it (inside a
 *    ±CONE_DEG cone around the line direction) whose gap, i.e. distance minus both
 *    half-widths, is at most maxGapPx. Pixels of the same line count only when the way
 *    round along the skeleton is much longer than the straight gap (a nearly closed loop),
 *    never the stroke the end belongs to. Score = gap plus a penalty for leaving the line
 *    direction.
 * 4. The bridge is the straight segment end → target, drawn with a disc of the line's own
 *    half-width. It is dropped when more than MAX_FOREIGN of its new pixels are not
 *    `allowed` (e.g. it would cut through a colour fill).
 *
 * All bridges are decided on the original mask and then added together, so bridges never
 * chain. Work is proportional to the mask pixels (thinning) and the number of ends times
 * the search window.
 */

/** Cone half-angle around the line direction in which a target may lie. */
const CONE_DEG = 60;
const COS_CONE = Math.cos((CONE_DEG * Math.PI) / 180);
/** At most this share of a bridge's new pixels may lie outside `allowed`. */
const MAX_FOREIGN = 0.25;
/** A target on the same line must be this many times farther along the skeleton than straight. */
const DETOUR = 2.5;

export interface BridgeOptions {
  /** Longest gap (between the line edges) that is bridged, px. */
  maxGapPx: number;
  /** Ends of lines wider than twice this are not bridged (wide shapes, letters). */
  maxHalfWidthPx: number;
  /** Whether a bridge may cross pixel i; a bridge mostly over other pixels is dropped. Default: all. */
  allowed?: (i: number) => boolean;
  /** Filled with counts for diagnostics (line ends looked at, bridged, rejected by `allowed`). */
  stats?: { ends: number; noTarget: number; foreign: number; bridged: number };
}

export interface Skeleton {
  skel: Uint8Array;
  /** Iteration (1-based, capped at 255) in which a mask pixel was thinned away; 0 on the skeleton. */
  peel: Uint8Array;
}

/**
 * Zhang-Suen thinning of a 0/1 mask. Only pixels on the current boundary are examined, so
 * the cost is proportional to the mask area. Pixels on the image border are dropped. After
 * `maxIter` iterations the rest stays as it is (shapes wider than 2·maxIter keep a core).
 */
export function thin(mask: Uint8Array, w: number, h: number, maxIter = Infinity): Skeleton {
  const n = w * h;
  const s = mask.slice();
  const peel = new Uint8Array(n);
  if (w < 3 || h < 3) return { skel: new Uint8Array(n), peel };
  for (let x = 0; x < w; x++) s[x] = s[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) s[y * w] = s[y * w + w - 1] = 0;

  // Active list: pixels whose deletability may have changed. dirty bit 1 / 2: still to be
  // checked in sub-pass 0 / 1. A pixel checked without success needs no new check until a
  // neighbour is removed, so finished skeleton parts drop out of the list.
  let count = 0;
  for (let i = 0; i < n; i++) count += s[i];
  let list = new Int32Array(count);
  let next = new Int32Array(count);
  const del = new Int32Array(count);
  const dirty = new Uint8Array(n);
  const nb8 = offsets8(w);
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (!s[i]) continue;
    if (!s[i - 1] || !s[i + 1] || !s[i - w] || !s[i + w] || !s[i - w - 1] || !s[i - w + 1] || !s[i + w - 1] || !s[i + w + 1]) {
      list[len++] = i;
      dirty[i] = 3;
    }
  }

  for (let iter = 1; len > 0; iter++) {
    let removed = 0;
    for (let pass = 0; pass < 2; pass++) {
      const bit = pass + 1;
      let nd = 0;
      for (let k = 0; k < len; k++) {
        const i = list[k];
        if (!(dirty[i] & bit)) continue;
        dirty[i] &= ~bit;
        const p2 = s[i - w];
        const p3 = s[i - w + 1];
        const p4 = s[i + 1];
        const p5 = s[i + w + 1];
        const p6 = s[i + w];
        const p7 = s[i + w - 1];
        const p8 = s[i - 1];
        const p9 = s[i - w - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (+(!p2 && p3) as number) + +(!p3 && p4) + +(!p4 && p5) + +(!p5 && p6) +
          +(!p6 && p7) + +(!p7 && p8) + +(!p8 && p9) + +(!p9 && p2);
        if (a !== 1) continue;
        if (pass === 0 ? p2 & p4 & p6 || p4 & p6 & p8 : p2 & p4 & p8 || p2 & p6 & p8) continue;
        del[nd++] = i;
      }
      removed += nd;
      for (let k = 0; k < nd; k++) {
        s[del[k]] = 0;
        dirty[del[k]] = 0;
        peel[del[k]] = iter > 255 ? 255 : iter;
      }
      // Neighbours of removed pixels must be checked again in both sub-passes.
      let nl = 0;
      for (let k = 0; k < len; k++) if (dirty[list[k]]) next[nl++] = list[k];
      for (let k = 0; k < nd; k++) {
        const i = del[k];
        for (let o = 0; o < 8; o++) {
          const j = i + nb8[o];
          if (!s[j]) continue;
          if (!dirty[j]) next[nl++] = j;
          dirty[j] = 3;
        }
      }
      const t = list;
      list = next;
      next = t;
      len = nl;
    }
    if (removed === 0 || iter >= maxIter) break;
  }
  return { skel: s, peel };
}

/** The 8 neighbour offsets, clockwise from north. */
function offsets8(w: number): Int32Array {
  return Int32Array.of(-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1);
}

/** Skeleton neighbours of i (8-connected); i must not be on the image border. */
function neighbours(s: Uint8Array, i: number, nb8: Int32Array, out: number[]): number {
  out.length = 0;
  for (let o = 0; o < 8; o++) if (s[i + nb8[o]]) out.push(i + nb8[o]);
  return out.length;
}

/** True for a line end: one or two skeleton neighbours that touch each other. */
function isEnd(s: Uint8Array, i: number, nb8: Int32Array): boolean {
  let b = 0;
  let a = 0;
  for (let k = 0; k < 8; k++) {
    const v = s[i + nb8[k]];
    b += v;
    if (!v && s[i + nb8[(k + 1) & 7]]) a++;
  }
  return b >= 1 && b <= 2 && a === 1;
}

/** Half-width of the line around skeleton pixel i (from the thinning iterations). */
function halfWidth(peel: Uint8Array, i: number, nb8: Int32Array): number {
  let m = 0;
  for (let o = 0; o < 8; o++) if (peel[i + nb8[o]] > m) m = peel[i + nb8[o]];
  return m + 0.5;
}

/**
 * Adds bridges across short gaps of `mask` (in place, see module comment).
 * Returns the number of bridges drawn.
 */
export function bridgeGaps(mask: Uint8Array, w: number, h: number, opts: BridgeOptions): number {
  const maxGap = opts.maxGapPx;
  if (maxGap <= 0 || w < 3 || h < 3) return 0;
  const maxHw = Math.max(1, opts.maxHalfWidthPx);
  // Wider shapes are never bridged, so their cores need not be thinned to the end.
  const { skel, peel } = thin(mask, w, h, Math.ceil(maxHw) + 2);
  const allowed = opts.allowed;
  const add = new Uint8Array(w * h);
  const nb8 = offsets8(w);
  const nb: number[] = [];
  const own = new Map<number, number>();
  const bfs: number[] = [];
  let bridges = 0;

  for (let e = w + 1; e < w * h - w - 1; e++) {
    if (!skel[e] || !isEnd(skel, e, nb8)) continue;
    const ex = e % w;
    if (ex === 0 || ex === w - 1) continue;
    const ey = (e - ex) / w;

    // Walk back along the line for its direction and width.
    let hw = halfWidth(peel, e, nb8);
    let prev = -1;
    let cur = e;
    let walked = 0;
    let junction = false;
    const seen = new Set<number>([e]);
    // Long enough to get past a tapering tip: the width found so far sets the length.
    while (walked < Math.max(4, Math.ceil(3 * hw))) {
      neighbours(skel, cur, nb8, nb);
      const fresh = nb.filter((j) => j !== prev && !seen.has(j));
      if (fresh.length === 0) break;
      // Several fresh neighbours that do not touch each other: a junction.
      if (fresh.length > 1) {
        const touching = fresh.every((j) => fresh.every((k) => Math.abs((j % w) - (k % w)) <= 1 && Math.abs(((j / w) | 0) - ((k / w) | 0)) <= 1));
        if (!touching) {
          junction = true;
          break;
        }
        // Staircase: continue with the 4-neighbour.
        fresh.sort((j, k) => +(Math.abs(j - cur) !== 1 && Math.abs(j - cur) !== w) - +(Math.abs(k - cur) !== 1 && Math.abs(k - cur) !== w));
        for (const j of fresh) seen.add(j);
      }
      prev = cur;
      cur = fresh[0];
      seen.add(cur);
      walked++;
      const hwHere = halfWidth(peel, cur, nb8);
      if (hwHere > hw) hw = hwHere;
    }
    if (walked < 3) continue; // a dot, not a line
    if (junction && walked < 2 * hw + 3) continue; // a spur of a ragged edge
    if (hw > maxHw) continue;
    const bx = cur % w;
    const by = (cur - bx) / w;
    let dx = ex - bx;
    let dy = ey - by;
    const dl = Math.hypot(dx, dy);
    if (dl === 0) continue;
    dx /= dl;
    dy /= dl;

    // Skeleton distances from the end along its own line.
    const reach = maxGap + hw + maxHw + 1;
    const maxGeo = Math.ceil(DETOUR * reach + 2 * hw + 2);
    own.clear();
    own.set(e, 0);
    bfs.length = 0;
    bfs.push(e);
    for (let k = 0; k < bfs.length; k++) {
      const p = bfs[k];
      const g = own.get(p)!;
      if (g >= maxGeo) continue;
      neighbours(skel, p, nb8, nb);
      for (const j of nb) {
        if (own.has(j)) continue;
        own.set(j, g + 1);
        bfs.push(j);
      }
    }

    // Best target ahead.
    const R = Math.ceil(reach);
    const reach2 = reach * reach;
    let best = -1;
    let bestScore = Infinity;
    let bestHw = 0;
    for (let ty = Math.max(1, ey - R); ty <= Math.min(h - 2, ey + R); ty++) {
      const vy = ty - ey;
      for (let tx = Math.max(1, ex - R); tx <= Math.min(w - 2, ex + R); tx++) {
        const t = ty * w + tx;
        if (!skel[t]) continue;
        const vx = tx - ex;
        const d2 = vx * vx + vy * vy;
        if (d2 < 1 || d2 > reach2) continue;
        const dist = Math.sqrt(d2);
        const cos = (vx * dx + vy * dy) / dist;
        if (cos < COS_CONE) continue;
        const g = own.get(t);
        if (g !== undefined && g <= DETOUR * dist + 2 * hw) continue;
        const thw = halfWidth(peel, t, nb8);
        const gap = dist - hw - thw;
        if (gap > maxGap) continue;
        const score = Math.max(0, gap) + 0.5 * dist * (1 - cos);
        if (score < bestScore) {
          bestScore = score;
          best = t;
          bestHw = thw;
        }
      }
    }
    if (opts.stats) opts.stats.ends++;
    if (best < 0) {
      if (opts.stats) opts.stats.noTarget++;
      continue;
    }

    // Straight segment end → target; check what it crosses before drawing it.
    const tx = best % w;
    const ty = (best - tx) / w;
    const len = Math.max(Math.abs(tx - ex), Math.abs(ty - ey));
    let free = 0;
    let foreign = 0;
    for (let k = 0; k <= len; k++) {
      const px = Math.round(ex + ((tx - ex) * k) / len);
      const py = Math.round(ey + ((ty - ey) * k) / len);
      const p = py * w + px;
      if (mask[p]) continue;
      free++;
      if (allowed && !allowed(p)) foreign++;
    }
    if (free === 0 || foreign > MAX_FOREIGN * free) {
      if (opts.stats && free > 0) opts.stats.foreign++;
      continue;
    }
    const rad = Math.max(1, Math.round(Math.min(hw, bestHw + 0.5) - 0.5));
    for (let k = 0; k <= len; k++) {
      const px = Math.round(ex + ((tx - ex) * k) / len);
      const py = Math.round(ey + ((ty - ey) * k) / len);
      for (let oy = -rad; oy <= rad; oy++) {
        const yy = py + oy;
        if (yy < 0 || yy >= h) continue;
        for (let ox = -rad; ox <= rad; ox++) {
          const xx = px + ox;
          if (xx < 0 || xx >= w || ox * ox + oy * oy > rad * rad + rad) continue;
          add[yy * w + xx] = 1;
        }
      }
    }
    bridges++;
    if (opts.stats) opts.stats.bridged++;
  }
  for (let i = 0; i < add.length; i++) if (add[i]) mask[i] = 1;
  return bridges;
}
