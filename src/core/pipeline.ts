import { germanColorName, rgbToLab } from './color';
import { majorityFilter, removeSmallRegions } from './labels';
import { buildLayerMasks } from './layers';
import { autoLevels, edgeMask, flattenAlpha, resizeBilinear, workingSize } from './preprocess';
import { detectBackground, kmeansLab } from './quantize';
import { buildSvg, layerIds, scalePathData } from './svg';
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

/** True when a settings change invalidates the (expensive) analysis. */
export function needsReanalysis(prev: Settings, next: Settings): boolean {
  return (
    prev.colorCount !== next.colorCount ||
    prev.smoothing !== next.smoothing ||
    prev.minPartAreaMm2 !== next.minPartAreaMm2 ||
    prev.targetWidthCm !== next.targetWidthCm
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
  const { width, height, pxPerMm } = workingSize(src.width, src.height, settings.targetWidthCm);
  const flat = flattenAlpha(src);
  const resized = resizeBilinear(flat.image, width, height);
  const transparent = resizeMaskNearest(flat.transparent, src.width, src.height, width, height);
  const leveled = autoLevels(resized);

  // Anti-aliasing seams would otherwise become clusters of their own and crowd
  // out small real colours; they are only left out of the fit, not the labelling.
  const { palette: colors, labels: raw } = kmeansLab(leveled, settings.colorCount, {
    transparent,
    fitExclude: edgeMask(leveled),
  });
  let labels = majorityFilter(raw, width, height, Math.round(settings.smoothing * 3));
  labels = removeSmallRegions(labels, width, height, settings.minPartAreaMm2 * pxPerMm * pxPerMm);

  const counts = new Array<number>(colors.length).fill(0);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) counts[labels[i]]++;

  const bg = detectBackground(labels, width, height);
  // Clusters wiped out by cleanup are dropped; ids keep their label value.
  const palette: PaletteEntry[] = colors
    .map((rgb, id) => ({
      id,
      rgb,
      originalRgb: [...rgb] as RGB,
      name: germanColorName(rgb),
      deleted: id === bg,
      mergedInto: null,
      monoInclude: false,
      pixelCount: counts[id],
    }))
    .filter((e) => e.pixelCount > 0);

  let darkest: PaletteEntry | null = null;
  let darkestL = Infinity;
  for (const e of palette) {
    if (e.deleted) continue;
    const L = rgbToLab(e.rgb)[0];
    if (L < darkestL) {
      darkestL = L;
      darkest = e;
    }
  }
  if (darkest) darkest.monoInclude = true;

  return { width, height, pxPerMm, labels, palette };
}

export async function render(
  a: Analysis,
  palette: PaletteEntry[],
  settings: Settings,
  tracer: Tracer,
): Promise<RenderResult> {
  const masks = buildLayerMasks(a.labels, a.width, a.height, palette, settings, a.pxPerMm);
  const opts = {
    turdsize: Math.ceil(settings.minPartAreaMm2 * a.pxPerMm * a.pxPerMm),
    alphamax: 0.5 + settings.smoothing * 0.8,
  };
  const widthMm = settings.targetWidthCm * 10;
  const heightMm = (widthMm * a.height) / a.width;
  const mmPerPx = widthMm / a.width;
  const traced: { name: string; color: RGB; paths: string[] }[] = [];
  for (const m of masks) {
    const raw = await tracer(m.mask, m.width, m.height, opts);
    const paths = raw.filter((d) => d.length > 0).map((d) => scalePathData(d, mmPerPx));
    if (paths.length > 0) traced.push({ name: m.name, color: m.color, paths });
  }

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

  return { svg: buildSvg(traced, widthMm, heightMm), layers, warnings };
}
