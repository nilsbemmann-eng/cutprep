import { germanColorName, rgbToLab } from './color';
import { splitInteriorBackground } from './interior';
import { dissolveLabels, majorityFilter, removeSmallRegions } from './labels';
import { buildLayerMasks, dilate } from './layers';
import { outlineMask } from './outline';
import { autoLevels, edgeMask, flattenAlpha, resizeBilinear, workingSize } from './preprocess';
import { detectBackground, kmeansLab } from './quantize';
import { buildSvg, layerIds, scalePathData } from './svg';
import { startTimer } from './timing';
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
/** A cluster at least this dark (L*) is the black layer the outlines go to; otherwise 'schwarz' is added. */
const BLACK_MAX_L = 35;
/** Background colours darker than this are never painted over by outlines (dark-background images). */
const DARK_BACKGROUND_L = 50;
/** Clusters with at least this share of pixels within FRINGE_MM of the outlines are anti-aliasing fringe. */
const FRINGE_SHARE = 0.8;
const FRINGE_MM = 0.3;

/** True when a settings change invalidates the (expensive) analysis. */
export function needsReanalysis(prev: Settings, next: Settings): boolean {
  return (
    prev.colorCount !== next.colorCount ||
    prev.smoothing !== next.smoothing ||
    prev.minPartAreaMm2 !== next.minPartAreaMm2 ||
    prev.targetWidthCm !== next.targetWidthCm ||
    prev.gapCloseMm !== next.gapCloseMm ||
    prev.outlinesBlack !== next.outlinesBlack
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
  const { palette: colors, labels: raw } = kmeansLab(leveled, settings.colorCount, {
    transparent,
    fitExclude,
  });
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
  if (settings.outlinesBlack) {
    const res = forceOutlines(labels, width, height, outlineMask(leveled, {
      radiusPx: (OUTLINE_MAX_LINE_MM / 2) * pxPerMm,
      minAreaPx: minAreaPx,
    }), fitExclude, colors, bg, addedBlackId, FRINGE_MM * pxPerMm);
    labels = res.labels;
    outlineLabel = res.target;
    timer?.lap('outlines');
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
  // With outlines on, their layer is the cut colour (it is the darkest cluster or the added black).
  const cut = palette.find((e) => e.id === outlineLabel) ?? darkest;
  if (cut) cut.monoInclude = true;
  timer?.lap('palette');
  timer?.done();

  return { width, height, pxPerMm, labels, palette };
}

/**
 * Paints the outline mask onto the label map with the black label: the darkest non-background
 * cluster when it is dark enough (L* <= BLACK_MAX_L), otherwise `addedLabel`. Clusters made up
 * almost only of the outlines' anti-aliasing fringe (dark green between ink and green) are
 * dissolved into their neighbours so they cannot keep pieces of the lines; likewise
 * blend-seam pixels (`seam`, the edge mask) of other colours right next to the outlines, so
 * a line on white does not get a grey halo layer. Background pixels are not refilled: on a
 * hard edge that would thicken the line by a pixel and can close off enclosed areas. Dark backgrounds are left alone. Without any outline pixel
 * nothing changes and target is null.
 */
function forceOutlines(
  labels: Int16Array,
  w: number,
  h: number,
  mask: Uint8Array,
  seam: Uint8Array,
  colors: RGB[],
  bg: number | null,
  addedLabel: number,
  fringePx: number,
): { labels: Int16Array; target: number | null } {
  let any = false;
  for (let i = 0; i < mask.length && !any; i++) any = mask[i] === 1;
  if (!any) return { labels, target: null };

  let darkest = -1;
  let darkestL = Infinity;
  colors.forEach((c, id) => {
    const L = rgbToLab(c)[0];
    if (id !== bg && L < darkestL) {
      darkestL = L;
      darkest = id;
    }
  });
  const target = darkest >= 0 && darkestL <= BLACK_MAX_L ? darkest : addedLabel;
  const keepBg = bg !== null && rgbToLab(colors[bg])[0] < DARK_BACKGROUND_L;

  const total = new Array<number>(colors.length).fill(0);
  const nearLines = new Array<number>(colors.length).fill(0);
  const near = dilate(mask, w, h, Math.max(1, Math.round(fringePx)));
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0 || l >= colors.length) continue;
    total[l]++;
    if (near[i]) nearLines[l]++;
  }
  const fringe = new Set<number>();
  for (let id = 0; id < colors.length; id++) {
    if (id === target || id === bg || total[id] === 0) continue;
    if (nearLines[id] >= FRINGE_SHARE * total[id]) fringe.add(id);
  }

  const out = labels.slice();
  const halo = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) {
    if (out[i] < 0 || (keepBg && out[i] === bg)) continue;
    if (mask[i]) out[i] = target;
    else if (seam[i] && near[i] && out[i] !== target && out[i] !== bg) halo[i] = 1;
  }
  return { labels: dissolveLabels(out, w, h, fringe, halo), target };
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
