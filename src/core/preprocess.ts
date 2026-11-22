import type { RGBAImage } from './types';

const BASE_PX_PER_MM = 10;
const MAX_SIDE = 2400;

/** Working resolution for a target width; caps the longer side at 2400 px. */
export function workingSize(
  srcW: number,
  srcH: number,
  targetWidthCm: number,
): { width: number; height: number; pxPerMm: number } {
  let width = Math.round(targetWidthCm * 10 * BASE_PX_PER_MM);
  let height = Math.round((width * srcH) / srcW);
  let pxPerMm = BASE_PX_PER_MM;
  const longest = Math.max(width, height);
  if (longest > MAX_SIDE) {
    const scale = MAX_SIDE / longest;
    if (width >= height) {
      width = MAX_SIDE;
      height = Math.round(height * scale);
    } else {
      height = MAX_SIDE;
      width = Math.round(width * scale);
    }
    pxPerMm = BASE_PX_PER_MM * scale;
  }
  return { width, height, pxPerMm };
}

/** Bilinear resize with pixel-center sampling and edge clamping. */
export function resizeBilinear(img: RGBAImage, width: number, height: number): RGBAImage {
  const { width: sw, height: sh, data: src } = img;
  const out = new Uint8ClampedArray(width * height * 4);
  const xScale = sw / width;
  const yScale = sh / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(Math.max((y + 0.5) * yScale - 0.5, 0), sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(Math.max((x + 0.5) * xScale - 0.5, 0), sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const wx = fx - x0;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[(y0 * sw + x0) * 4 + c] * (1 - wx) + src[(y0 * sw + x1) * 4 + c] * wx;
        const bot = src[(y1 * sw + x0) * 4 + c] * (1 - wx) + src[(y1 * sw + x1) * 4 + c] * wx;
        out[o + c] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return { width, height, data: out };
}

/** Composite over white; transparent[i] = 1 where original alpha < 128. */
export function flattenAlpha(img: RGBAImage): { image: RGBAImage; transparent: Uint8Array } {
  const n = img.width * img.height;
  const out = new Uint8ClampedArray(n * 4);
  const transparent = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3];
    if (a < 128) transparent[i] = 1;
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = (img.data[i * 4 + c] * a + 255 * (255 - a)) / 255;
    }
    out[i * 4 + 3] = 255;
  }
  return { image: { width: img.width, height: img.height, data: out }, transparent };
}

/** Per-channel stretch between the clipPercent low/high percentiles to 0..255; alpha untouched. */
export function autoLevels(img: RGBAImage, clipPercent = 0.5): RGBAImage {
  const n = img.width * img.height;
  const out = new Uint8ClampedArray(img.data);
  const clip = (clipPercent / 100) * n;
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[img.data[i * 4 + c]]++;
    let low = 0;
    let cum = 0;
    for (; low < 255; low++) {
      cum += hist[low];
      if (cum > clip) break;
    }
    let high = 255;
    cum = 0;
    for (; high > 0; high--) {
      cum += hist[high];
      if (cum > clip) break;
    }
    if (high <= low) continue;
    const scale = 255 / (high - low);
    for (let i = 0; i < n; i++) {
      out[i * 4 + c] = (img.data[i * 4 + c] - low) * scale;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Marks anti-aliasing seams: 1 where any RGB channel differs by more than
 * `threshold` from the pixel `distance` px to the left, right, above or below
 * (neighbours clamped to the image). Used to keep blend pixels out of the
 * k-means fit; on typical artwork this flags about 3 % of the pixels.
 */
export function edgeMask(img: RGBAImage, distance = 2, threshold = 40): Uint8Array {
  const { width: w, height: h, data: d } = img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - distance) * w;
    const down = Math.min(h - 1, y + distance) * w;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const nb = [y * w + Math.max(0, x - distance), y * w + Math.min(w - 1, x + distance), up + x, down + x];
      let edge = 0;
      for (let k = 0; k < 4 && !edge; k++) {
        const j = nb[k];
        for (let c = 0; c < 3; c++) {
          if (Math.abs(d[i * 4 + c] - d[j * 4 + c]) > threshold) {
            edge = 1;
            break;
          }
        }
      }
      out[i] = edge;
    }
  }
  return out;
}
