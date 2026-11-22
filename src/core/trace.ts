import { transformPathData } from './svg';

export type Tracer = (
  mask: Uint8Array,
  w: number,
  h: number,
  opts: { turdsize: number; alphamax: number },
) => Promise<string[]>;

/** Loads the potrace WASM module and returns a tracer (path data in px). */
export async function createPotraceTracer(): Promise<Tracer> {
  // Dynamic import: the library touches require() at load time and cannot be
  // loaded in Node/Vitest; keeping it lazy keeps importers of this file testable.
  const { init, potrace } = await import('esm-potrace-wasm');
  await init();
  return async (mask, w, h, opts) => {
    // Foreground black, background white, opaque.
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = mask[i] ? 0 : 255;
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    const image = { data, width: w, height: h } as unknown as ImageData;
    const raw = await potrace(image, {
      pathonly: true,
      extractcolors: false,
      turdsize: opts.turdsize,
      alphamax: opts.alphamax,
      opticurve: 1,
      opttolerance: 0.2,
    });
    // potrace's SVG backend output is 10x scaled with Y pointing up: normalise
    // to pixel coordinates with the origin at the top left.
    return raw.map((d) => transformPathData(d, 0.1, -0.1, h));
  };
}
