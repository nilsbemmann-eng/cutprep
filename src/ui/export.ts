import type { RenderResult } from '../core/pipeline';

const PNG_DPI = 300;

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const svgBlob = (svg: string) => new Blob([svg], { type: 'image/svg+xml' });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function baseName(filename: string): string {
  const b = filename.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  return b || 'bild';
}

export function downloadSvg(result: RenderResult, name: string): void {
  download(svgBlob(result.svg), `${name}-cutprep.svg`);
}

export async function downloadLayerSvgs(result: RenderResult, name: string): Promise<void> {
  for (const l of result.layers) {
    download(svgBlob(l.svg), `${name}-${l.id}.svg`);
    await pause(250);
  }
}

/** Rasterises one layer SVG at 300 dpi of its mm size. */
async function svgToPng(svg: string): Promise<Blob> {
  const m = svg.match(/<svg\b[^>]*\swidth="([\d.]+)mm"[^>]*\sheight="([\d.]+)mm"/);
  if (!m) throw new Error('SVG ohne mm-Größe');
  const w = Math.max(1, Math.round((parseFloat(m[1]) / 25.4) * PNG_DPI));
  const h = Math.max(1, Math.round((parseFloat(m[2]) / 25.4) * PNG_DPI));
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas nicht verfügbar');
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG-Export fehlgeschlagen'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadLayerPngs(result: RenderResult, name: string): Promise<void> {
  for (const l of result.layers) {
    download(await svgToPng(l.svg), `${name}-${l.id}.png`);
    await pause(250);
  }
}

export function canShareFiles(): boolean {
  if (typeof navigator.canShare !== 'function') return false;
  return navigator.canShare({ files: [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })] });
}

export async function shareSvg(result: RenderResult, name: string): Promise<void> {
  const file = new File([result.svg], `${name}-cutprep.svg`, { type: 'image/svg+xml' });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'CutPrep' });
}

export function setupExport(
  root: HTMLElement,
  get: () => { result: RenderResult; name: string } | null,
  onError: (msg: string) => void,
): { setEnabled(on: boolean): void } {
  root.innerHTML = `
    <h2>Export</h2>
    <div class="btns">
      <button type="button" class="primary" id="x-svg">SVG speichern</button>
      <button type="button" id="x-share" hidden>Teilen</button>
      <button type="button" id="x-layers">Ebenen einzeln (SVG)</button>
      <button type="button" id="x-png">Ebenen als PNG</button>
    </div>`;
  const btns = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  const run = (fn: (r: RenderResult, n: string) => unknown) => async () => {
    const cur = get();
    if (!cur) return;
    try {
      await fn(cur.result, cur.name);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const q = (id: string) => root.querySelector<HTMLButtonElement>('#' + id)!;
  q('x-svg').addEventListener('click', run(downloadSvg));
  q('x-layers').addEventListener('click', run(downloadLayerSvgs));
  q('x-png').addEventListener('click', run(downloadLayerPngs));
  q('x-share').addEventListener('click', run(shareSvg));
  if (canShareFiles()) q('x-share').hidden = false;
  const setEnabled = (on: boolean) => btns.forEach((b) => (b.disabled = !on));
  setEnabled(false);
  return { setEnabled };
}
