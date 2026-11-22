import { germanColorName, rgbToLab } from './color';
import { splitInteriorBackground } from './interior';
import { dissolveLabels, majorityFilter, removeSmallRegions } from './labels';
import { buildLayerMasks, dilate } from './layers';
import { bridgeGaps } from './bridge';
import { lightnessChromaFromLab, outlineMask, PIXEL_EXCLUDED, PIXEL_INK, type LightnessChroma } from './outline';
import { autoLevels, edgeMask, flattenAlpha, resizeBilinear, workingSize } from './preprocess';
import { detectBackground, kmeansLab } from './quantize';
import { buildSvg, layerIds, scalePathData } from './svg';
import { startTimer, type StageTimer } from './timing';
import type { Tracer } from './trace';
import type { PaletteEntry, RGB, RGBAImage, Settings } from './types';

export interface Analysis {
  width: number;
  height: number;
  pxPerMm: number;
  labels: Int16Array;
  palette: PaletteEntry[];
}

export interface RenderLayer {
  id: string;
  name: string;
  color: RGB;
  svg: string;
}

export interface RenderResult {
  svg: string;
  layers: RenderLayer[];
  warnings: string[];
}

export const WIDTH_WARNING = 'Breiter als 21,6 cm – passt nicht auf das Joy-Xtra-Material';
export const NO_LAYER_WARNING = 'Keine Ebene ausgewählt';
const MAX_MATERIAL_WIDTH_CM = 21.6;

/** Widest stroke (mm) still treated as a line by the outline mask; wider ink is a k-means area anyway. */
const OUTLINE_MAX_LINE_MM = 1.2;
/**
 * A cluster at least this dark (L*) and this neutral (chroma) is the black layer the outlines
 * go to; otherwise 'schwarz' is added (dark red or navy is a colour, not the outline black).
 */
const BLACK_MAX_L = 35;
const BLACK_MAX_CHROMA = 20;
/** Clusters this close (CIE76) to the outline colour count as ink too. */
const INK_DELTA_E = 12;
/** Background colours darker than this are never painted over by outlines (dark-background images). */
const DARK_BACKGROUND_L = 50;
/** Clusters with at least this share of pixels within FRINGE_MM of the outlines are anti-aliasing fringe. */
const FRINGE_SHARE = 0.8;
const FRINGE_MM = 0.3;
/**
 * ... and either at least this share of its pixels are blend seams (edge mask), or its colour
 * is a blend of the outline colour and another cluster (within this ΔE of the segment).
 * Fixture "dunkelgrün": 17 % seam, ΔE 4.7 → fringe. Outlined 0.6 mm dark-green stems: 74 %
 * seam (narrow cores are mostly edge), ΔE 17 → kept.
 */
const FRINGE_SEAM_SHARE = 0.85;
const FRINGE_BLEND_DELTA_E = 10;

/** True when a settings change invalidates the (expensive) analysis. */
export function needsReanalysis(prev: Settings, next: Settings): boolean {
  return (
    prev.colorCount !== next.colorCount ||
    prev.smoothing !== next.smoothing ||
    prev.minPartAreaMm2 !== next.minPartAreaMm2 ||
    prev.targetWidthCm !== next.targetWidthCm ||
    prev.gapCloseMm !== next.gapCloseMm ||
    prev.outlinesBlack !== next.outlinesBlack ||
    prev.bridgeGapMm !== next.bridgeGapMm
  );
}

/** Nearest-neighbour resize of a 0/1 mask. */
function resizeMaskNearest(mask: Uint8Array, sw: number, sh: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / w));
      out[y * w + x] = mask[sy * sw + sx];
    }
  }
  return out;
}

export function analyze(src: RGBAImage, settings: Settings): Analysis {
  const timer = import.meta.env.DEV ? startTimer('analyze') : null;
  const { width, height, pxPerMm } = workingSize(src.width, src.height, settings.targetWidthCm);
  const flat = flattenAlpha(src);
  const resized = resizeBilinear(flat.image, width, height);
  const transparent = resizeMaskNearest(flat.transparent, src.width, src.height, width, height);
  timer?.lap(`resize ${width}x${height}`);
  const leveled = autoLevels(resized);
  const fitExclude = edgeMask(leveled);
  timer?.lap('levels+edges');

  // Anti-aliasing seams would otherwise become clusters of their own and crowd
  // out small real colours; they are only left out of the fit, not the labelling.
  const km = kmeansLab(leveled, settings.colorCount, { transparent, fitExclude });
  const { palette: colors, labels: raw } = km;
  // The outline step reuses k-means' Lab conversion (as bytes); the float buffer is dropped.
  const lc = settings.outlinesBlack ? lightnessChromaFromLab(km.lab, width, height) : null;
  km.lab = new Float32Array(0);
  timer?.lap('kmeans');
  const minAreaPx = settings.minPartAreaMm2 * pxPerMm * pxPerMm;
  let labels = majorityFilter(raw, width, height, Math.round(settings.smoothing * 3));
  timer?.lap('majority');
  labels = removeSmallRegions(labels, width, height, minAreaPx);
  timer?.lap('removeSmall');

  const bg = detectBackground(labels, width, height);
  // Interior copy of the background is colors.length; an added black entry comes after it.
  const addedBlackId = colors.length + 1;
  let outlineLabel: number | null = null;
  if (lc) {
    // Line gaps up to bridgeGapMm are bridged; gapCloseMm only steers the interior split below.
    const res = forceOutlines(labels, width, height, lc, fitExclude, colors, bg, addedBlackId, pxPerMm,
      minAreaPx, settings.bridgeGapMm * pxPerMm, timer);
    labels = res.labels;
    outlineLabel = res.target;
    timer?.lap('outlines:paint');
  }
  // Background-coloured areas inside the motif (e.g. white fur) get a label of their own
  // (colors.length, so it never collides with a cluster id) instead of being deleted.
  const split = splitInteriorBackground(
    labels,
    width,
    height,
    bg,
    settings.gapCloseMm * pxPerMm,
    colors.length,
  );
  timer?.lap('background+interior');
  if (split.interiorLabel !== null) {
    labels = removeSmallRegions(split.labels, width, height, minAreaPx);
    timer?.lap('removeSmall#2');
  }

  // Index = label id. Slot colors.length is the interior copy of the background (unused
  // without one, it then simply gets no pixels); slot addedBlackId the added outline black.
  const entryColors: RGB[] = [...colors, bg !== null ? colors[bg] : [255, 255, 255]];
  if (outlineLabel === addedBlackId) entryColors.push([0, 0, 0]);
  const counts = new Array<number>(entryColors.length).fill(0);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) counts[labels[i]]++;

  // Clusters wiped out by cleanup are dropped; ids keep their label value.
  const palette: PaletteEntry[] = entryColors
    .map((rgb, id): PaletteEntry => {
      const e: PaletteEntry = {
        id,
        rgb: [...rgb] as RGB,
        originalRgb: [...rgb] as RGB,
        name: germanColorName(rgb),
        deleted: id === bg,
        mergedInto: null,
        monoInclude: false,
        pixelCount: counts[id],
      };
      if (id === bg) e.role = 'background';
      else if (id === colors.length) e.role = 'interior';
      // The outlines' own layer, even if an outline-only colour would be named differently.
      if (id === addedBlackId) e.name = 'schwarz';
      return e;
    })
    .filter((e) => e.pixelCount > 0);

  let darkest: PaletteEntry | null = null;
  let darkestL = Infinity;
  for (const e of palette) {
    // The interior copy of the background is never the cut colour (it stays a hole).
    if (e.deleted || e.role === 'interior') continue;
    const L = rgbToLab(e.rgb)[0];
    if (L < darkestL) {
      darkestL = L;
      darkest = e;
    }
  }
  // With outlines on, their layer is the cut colour (the darkest neutral cluster or the added black).
  const cut = palette.find((e) => e.id === outlineLabel) ?? darkest;
  if (cut) cut.monoInclude = true;
  for (const e of palette) e.monoDefault = e.monoInclude;
  timer?.lap('palette');
  timer?.done();

  return { width, height, pxPerMm, labels, palette };
}

/**
 * Chooses the outline colour, builds the outline mask (with gaps bridged) and paints it onto
 * the label map. Target: the darkest near-neutral cluster (L* <= BLACK_MAX_L, chroma <=
 * BLACK_MAX_CHROMA) that still has pixels, otherwise `addedLabel` (pure black). Only pixels
 * already labelled with the target or a cluster within INK_DELTA_E of it may seed as wide
 * ink, so dark fills of other colours (brown, navy, charcoal) keep their colour.
 *
 * A dark background is excluded from the mask (it would put every edge of every light
 * shape into the outlines). Gaps up to `gapPx` are bridged (core/bridge.ts) where the
 * bridge runs over the (light) background, seam pixels or the outline colour.
 *
 * Clusters made up almost only of the outlines' anti-aliasing fringe (dark green between ink
 * and green) are dissolved into their neighbours, so they cannot keep pieces of the lines;
 * likewise blend-seam pixels (`seam`, the edge mask) of other colours right next to the
 * outlines, so a line on white does not get a grey halo layer. Background pixels are not
 * refilled: on a hard edge that would thicken the line by a pixel and can close off
 * enclosed areas. Without any outline pixel nothing changes and target is null.
 */
function forceOutlines(
  labels: Int16Array,
  w: number,
  h: number,
  lc: LightnessChroma,
  seam: Uint8Array,
  colors: RGB[],
  bg: number | null,
  addedLabel: number,
  pxPerMm: number,
  minAreaPx: number,
  gapPx: number,
  timer: StageTimer | null,
): { labels: Int16Array; target: number | null } {
  const n = w * h;
  const k = colors.length;
  // Counters indexed by label + 1, so -1 (transparent) needs no test in the pixel loops.
  const total = new Int32Array(k + 2);
  for (let i = 0; i < n; i++) total[labels[i] + 1]++;
  const count = (id: number) => total[id + 1];
  const lab = colors.map((c) => rgbToLab(c));

  let target = addedLabel;
  let targetL = Infinity;
  colors.forEach((_, id) => {
    const [L, A, B] = lab[id];
    if (id === bg || count(id) === 0 || L > BLACK_MAX_L || Math.hypot(A, B) > BLACK_MAX_CHROMA) return;
    if (L < targetL) {
      targetL = L;
      target = id;
    }
  });
  const targetLab = target === addedLabel ? [0, 0, 0] : lab[target];
  const bgL = bg !== null ? lab[bg][0] : 100;
  const darkBg = bg !== null && bgL < DARK_BACKGROUND_L;

  // Per-label class: ink-like labels may seed wide ink, a dark background is never outline.
  const labelClass = new Uint8Array(k + 2);
  colors.forEach((_, id) => {
    if (id === bg) labelClass[id] = darkBg ? PIXEL_EXCLUDED : 0;
    else if (id === target || Math.hypot(lab[id][0] - targetLab[0], lab[id][1] - targetLab[1], lab[id][2] - targetLab[2]) <= INK_DELTA_E)
      labelClass[id] = PIXEL_INK;
  });
  const queue = new Int32Array(n);
  const radiusPx = (OUTLINE_MAX_LINE_MM / 2) * pxPerMm;
  const mask = outlineMask(lc, {
    radiusPx,
    minAreaPx,
    inkL: target === addedLabel ? 0 : targetL,
    paperL: darkBg ? 100 : bgL,
    labels,
    labelClass,
    queue,
  });
  timer?.lap('outlines:mask');
  let any = false;
  for (let i = 0; i < n && !any; i++) any = mask[i] === 1;
  if (!any) return { labels, target: null };

  // Clusters whose colour lies between the outline colour and another colour (or the
  // paper): anti-aliasing blends and faint ink.
  const paperLab = bg !== null ? lab[bg] : [100, 0, 0];
  const blendLabel = colors.map((_, id) => {
    if (id === target || id === bg || count(id) === 0) return false;
    if (segmentDistance(lab[id], targetLab, paperLab) <= FRINGE_BLEND_DELTA_E) return true;
    return colors.some((_, o) => o !== id && o !== target && count(o) > 0 &&
      segmentDistance(lab[id], targetLab, lab[o]) <= FRINGE_BLEND_DELTA_E);
  });

  if (gapPx > 0 && !darkBg) {
    // Bridges may run over the background, blend seams, the outline colour and blends of
    // it (the grey or dark green of faint, broken strokes), but not through fills: a pixel
    // of another colour is blocked only deep inside its fill, with no other label within
    // 2 px (a gap along a colour boundary is a gap in the line on that boundary). Only
    // pixels on candidate bridges are ever asked.
    const passable = new Uint8Array(k + 2);
    passable[0] = 1; // transparent
    colors.forEach((_, id) => {
      if (id === bg || labelClass[id] === PIXEL_INK || blendLabel[id]) passable[id + 1] = 1;
    });
    const allowed = (i: number): boolean => {
      const l = labels[i];
      if (seam[i] || l >= k || passable[l + 1]) return true;
      const x = i % w;
      const y = (i - x) / w;
      return (
        (x >= 2 && labels[i - 2] !== l) ||
        (x < w - 2 && labels[i + 2] !== l) ||
        (y >= 2 && labels[i - 2 * w] !== l) ||
        (y < h - 2 && labels[i + 2 * w] !== l)
      );
    };
    bridgeGaps(mask, w, h, { maxGapPx: gapPx, maxHalfWidthPx: radiusPx, allowed });
    timer?.lap('outlines:bridges');
  }

  // One pass: count pixels near the lines / on seams per label (before painting), paint the
  // mask with the target and flag halo pixels (blend seams of other colours next to lines).
  const fringePx = Math.max(1, Math.round(FRINGE_MM * pxPerMm));
  const near = dilate(mask, w, h, fringePx);
  const nearLines = new Int32Array(k + 2);
  const onSeam = new Int32Array(k + 2);
  const out = labels; // painted in place: the caller replaces its labels with the result
  const halo = near; // reused: each entry is read before it is overwritten
  const keepBg = darkBg ? bg : -2;
  for (let i = 0; i < n; i++) {
    const l = out[i];
    const isNear = near[i];
    const isSeam = seam[i];
    nearLines[l + 1] += isNear;
    onSeam[l + 1] += isSeam;
    halo[i] = 0;
    if (l < 0 || l === keepBg) continue;
    if (mask[i]) out[i] = target;
    else if (isSeam && isNear && l !== target && l !== bg) halo[i] = 1;
  }
  // A fringe cluster lies along the lines AND is either mostly blend seam or a colour
  // between the outline colour and another cluster; a real thin dark element (a dark-green
  // stem with a solid core) is neither.
  const fringe = new Set<number>();
  for (let id = 0; id < k; id++) {
    const t = count(id);
    if (id === target || id === bg || t === 0) continue;
    if (nearLines[id + 1] < FRINGE_SHARE * t) continue;
    if (onSeam[id + 1] >= FRINGE_SEAM_SHARE * t || blendLabel[id]) fringe.add(id);
  }
  return { labels: dissolveLabels(out, w, h, fringe, halo, queue), target };
}

/** Lab distance of p from the segment a-b, measured only inside (10 %..90 %) of it, else Infinity. */
function segmentDistance(p: number[], a: number[], b: number[]): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (len2 === 0) return Infinity;
  const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2;
  if (t < 0.1 || t > 0.9) return Infinity;
  return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1], p[2] - a[2] - t * d[2]);
}

/** Thrown by render() when its shouldAbort callback asks it to stop. */
export class RenderAbortedError extends Error {
  constructor() {
    super('Vorschau abgebrochen');
    this.name = 'RenderAbortedError';
  }
}

/**
 * shouldAbort is checked before each layer is traced and before the SVG is built; once
 * it returns true, render rejects with RenderAbortedError. To let it change mid-render
 * the caller's tracer has to yield to its event loop (the core stays DOM/worker free).
 */
export async function render(
  a: Analysis,
  palette: PaletteEntry[],
  settings: Settings,
  tracer: Tracer,
  shouldAbort?: () => boolean,
): Promise<RenderResult> {
  const timer = import.meta.env.DEV ? startTimer('render') : null;
  const masks = buildLayerMasks(a.labels, a.width, a.height, palette, settings, a.pxPerMm);
  timer?.lap(`masks (${masks.length})`);
  const opts = {
    turdsize: Math.ceil(settings.minPartAreaMm2 * a.pxPerMm * a.pxPerMm),
    alphamax: 0.5 + settings.smoothing * 0.8,
  };
  const widthMm = settings.targetWidthCm * 10;
  const heightMm = (widthMm * a.height) / a.width;
  const mmPerPx = widthMm / a.width;
  const traced: { name: string; color: RGB; paths: string[] }[] = [];
  const abortIfAsked = () => {
    if (!shouldAbort?.()) return;
    timer?.done('abgebrochen');
    throw new RenderAbortedError();
  };
  for (const m of masks) {
    abortIfAsked();
    const raw = await tracer(m.mask, m.width, m.height, opts);
    const paths = raw.filter((d) => d.length > 0).map((d) => scalePathData(d, mmPerPx));
    if (paths.length > 0) traced.push({ name: m.name, color: m.color, paths });
    timer?.lap(`trace ${m.name}`);
  }

  abortIfAsked();

  const ids = layerIds(traced.map((l) => l.name));
  const layers: RenderLayer[] = traced.map((l, i) => ({
    id: ids[i],
    name: l.name,
    color: l.color,
    svg: buildSvg([l], widthMm, heightMm),
  }));

  const warnings: string[] = [];
  if (settings.targetWidthCm > MAX_MATERIAL_WIDTH_CM) warnings.push(WIDTH_WARNING);
  if (layers.length === 0) warnings.push(NO_LAYER_WARNING);

  const svg = buildSvg(traced, widthMm, heightMm);
  timer?.lap('svg');
  timer?.done();
  return { svg, layers, warnings };
}
