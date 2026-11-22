/** Post-processing of k-means label maps: edge smoothing and speck removal. */

/**
 * Majority (mode) filter with a square (2r+1)^2 window. Out-of-bounds pixels are ignored,
 * -1 pixels neither vote nor change. A pixel changes only if another label has strictly
 * more votes than its own; if several other labels tie for the most votes, the lowest
 * label index wins. Returns a new array.
 */
export function majorityFilter(labels: Int16Array, w: number, h: number, radius: number): Int16Array {
  const out = labels.slice();
  const r = Math.floor(radius);
  if (r <= 0 || w === 0 || h === 0) return out;

  const total = w * h;
  let maxLabel = -1;
  for (let i = 0; i < total; i++) if (labels[i] > maxLabel) maxLabel = labels[i];
  if (maxLabel < 0) return out;

  const curVotes = new Int32Array(total);
  const bestVotes = new Int32Array(total);
  const bestLabel = new Int16Array(total).fill(-1);
  const tmp = new Int32Array(total);
  const colSum = new Int32Array(w);

  for (let l = 0; l <= maxLabel; l++) {
    // Horizontal sliding sum per row.
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let s = 0;
      for (let x = 0; x < Math.min(r, w); x++) if (labels[row + x] === l) s++;
      for (let x = 0; x < w; x++) {
        const add = x + r;
        if (add < w && labels[row + add] === l) s++;
        const rem = x - r - 1;
        if (rem >= 0 && labels[row + rem] === l) s--;
        tmp[row + x] = s;
      }
    }
    // Vertical sliding sum, row by row (cache friendly).
    colSum.fill(0);
    for (let y = 0; y < Math.min(r, h); y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) colSum[x] += tmp[row + x];
    }
    for (let y = 0; y < h; y++) {
      const add = y + r;
      if (add < h) {
        const row = add * w;
        for (let x = 0; x < w; x++) colSum[x] += tmp[row + x];
      }
      const rem = y - r - 1;
      if (rem >= 0) {
        const row = rem * w;
        for (let x = 0; x < w; x++) colSum[x] -= tmp[row + x];
      }
      const base = y * w;
      for (let x = 0; x < w; x++) {
        const i = base + x;
        const v = colSum[x];
        if (labels[i] === l) curVotes[i] = v;
        if (v > bestVotes[i]) {
          bestVotes[i] = v;
          bestLabel[i] = l;
        }
      }
    }
  }

  for (let i = 0; i < total; i++) {
    if (labels[i] >= 0 && bestVotes[i] > curVotes[i]) out[i] = bestLabel[i];
  }
  return out;
}

/**
 * Reassigns 4-connected components smaller than minAreaPx to the label most often touching
 * their border (4-neighbour edge contacts, ties -> lowest label). -1 is never recolored or
 * used as a target; a component without any non-(-1) neighbour is kept. Repeats up to
 * 5 passes until stable. Returns a new array.
 */
export function removeSmallRegions(labels: Int16Array, w: number, h: number, minAreaPx: number): Int16Array {
  let cur = labels.slice();
  const total = w * h;
  if (total === 0 || minAreaPx <= 1) return cur;

  let maxLabel = -1;
  for (let i = 0; i < total; i++) if (labels[i] > maxLabel) maxLabel = labels[i];
  if (maxLabel < 0) return cur;

  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  const contacts = new Int32Array(maxLabel + 1);

  for (let pass = 0; pass < 5; pass++) {
    const next = cur.slice();
    seen.fill(0);
    let changed = false;

    for (let start = 0; start < total; start++) {
      if (seen[start] || cur[start] < 0) continue;
      const lab = cur[start];
      // Iterative BFS; queue[0..tail) ends up holding the whole component.
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      seen[start] = 1;
      while (head < tail) {
        const p = queue[head++];
        const x = p % w;
        if (x > 0 && !seen[p - 1] && cur[p - 1] === lab) { seen[p - 1] = 1; queue[tail++] = p - 1; }
        if (x < w - 1 && !seen[p + 1] && cur[p + 1] === lab) { seen[p + 1] = 1; queue[tail++] = p + 1; }
        if (p >= w && !seen[p - w] && cur[p - w] === lab) { seen[p - w] = 1; queue[tail++] = p - w; }
        if (p < total - w && !seen[p + w] && cur[p + w] === lab) { seen[p + w] = 1; queue[tail++] = p + w; }
      }
      if (tail >= minAreaPx) continue;

      contacts.fill(0);
      for (let k = 0; k < tail; k++) {
        const p = queue[k];
        const x = p % w;
        let n: number;
        if (x > 0 && (n = cur[p - 1]) >= 0 && n !== lab) contacts[n]++;
        if (x < w - 1 && (n = cur[p + 1]) >= 0 && n !== lab) contacts[n]++;
        if (p >= w && (n = cur[p - w]) >= 0 && n !== lab) contacts[n]++;
        if (p < total - w && (n = cur[p + w]) >= 0 && n !== lab) contacts[n]++;
      }
      let best = -1;
      let bestCount = 0;
      for (let l = 0; l <= maxLabel; l++) {
        if (contacts[l] > bestCount) { bestCount = contacts[l]; best = l; }
      }
      if (best < 0) continue;
      for (let k = 0; k < tail; k++) next[queue[k]] = best;
      changed = true;
    }

    cur = next;
    if (!changed) break;
  }
  return cur;
}

/**
 * Relabels every pixel whose label is flagged in `dissolve` with the label of the nearest
 * (4-connected, breadth-first) pixel that keeps its label, so a dissolved cluster is split
 * between its neighbours along the middle. -1 pixels neither change nor spread; dissolved
 * pixels that no kept label can reach stay as they were. Returns a new array.
 */
export function dissolveLabels(labels: Int16Array, w: number, h: number, dissolve: ReadonlySet<number>): Int16Array {
  const out = labels.slice();
  const total = w * h;
  if (dissolve.size === 0 || total === 0) return out;
  const open = new Uint8Array(total);
  const queue = new Int32Array(total);
  let tail = 0;
  for (let i = 0; i < total; i++) {
    if (labels[i] < 0) continue;
    if (dissolve.has(labels[i])) open[i] = 1;
    else queue[tail++] = i;
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const x = p % w;
    const l = out[p];
    const reach = (k: number) => {
      if (!open[k]) return;
      open[k] = 0;
      out[k] = l;
      queue[tail++] = k;
    };
    if (x > 0) reach(p - 1);
    if (x < w - 1) reach(p + 1);
    if (p >= w) reach(p - w);
    if (p < total - w) reach(p + w);
  }
  return out;
}
