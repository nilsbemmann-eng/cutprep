export type RGB = [number, number, number];

/** RGBA pixel buffer, 4 bytes per pixel. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Settings {
  colorCount: number;
  targetWidthCm: number;
  minPartAreaMm2: number;
  smoothing: number;
  overlapMm: number;
  mode: 'multi' | 'mono';
  stackOnDarkest: boolean;
  /** Outline gaps up to about twice this width still enclose background-coloured areas. */
  gapCloseMm: number;
}

export const DEFAULT_SETTINGS: Settings = {
  colorCount: 6,
  targetWidthCm: 20,
  minPartAreaMm2: 1,
  smoothing: 0.5,
  overlapMm: 0.4,
  mode: 'multi',
  stackOnDarkest: false,
  gapCloseMm: 1,
};

export interface PaletteEntry {
  /** Equals the k-means label index this entry represents. */
  id: number;
  /** Colour to cut; changed by the user's colour picker. */
  rgb: RGB;
  /** Cluster colour as analysed (never edited); used to carry edits over a re-analysis. */
  originalRgb: RGB;
  name: string;
  deleted: boolean;
  mergedInto: number | null;
  monoInclude: boolean;
  pixelCount: number;
  /**
   * 'background': the detected background cluster (outside the motif).
   * 'interior': background-coloured areas enclosed by the motif, split off as their own entry.
   * Absent for all other colours.
   */
  role?: 'background' | 'interior';
}

export interface LayerMask {
  name: string;
  color: RGB;
  mask: Uint8Array;
  width: number;
  height: number;
}
