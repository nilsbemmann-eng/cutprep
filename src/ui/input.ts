import type { RGBAImage } from '../core/types';

/** Longest side of the decoded image; matches the working-resolution cap (2400 px). */
export const MAX_DECODE_SIDE = 2400;

/** Size that fits width x height into MAX_DECODE_SIDE (never upscales), aspect kept. */
export function decodeSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Natural (EXIF-oriented) size from the header, without decoding all pixels. */
function naturalSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild nicht lesbar'));
    };
    img.src = url;
  });
}

/**
 * Decodes an image Blob to RGBA pixels, the longest side capped at
 * MAX_DECODE_SIDE so large photos never exist at full resolution (memory on
 * phones). The browser applies EXIF orientation.
 */
export async function loadImageFile(file: Blob): Promise<RGBAImage> {
  const natural = await naturalSize(file);
  const target = decodeSize(natural.width, natural.height);
  const bmp =
    target.width === natural.width && target.height === natural.height
      ? await createImageBitmap(file)
      : await createImageBitmap(file, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
        });
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas nicht verfügbar');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: d.width, height: d.height, data: d.data };
  } finally {
    bmp.close();
  }
}

/**
 * Web Share Target: the service worker stores the shared file in the cache 'cutprep-share'
 * and redirects to ./?shared=1. Returns the file once (and removes it), else null.
 */
export async function consumeSharedImage(): Promise<Blob | null> {
  const params = new URLSearchParams(location.search);
  if (params.get('shared') !== '1') return null;
  try {
    const cache = await caches.open('cutprep-share');
    const res = await cache.match('shared-image');
    if (!res) return null;
    const blob = await res.blob();
    await cache.delete('shared-image');
    return blob;
  } catch {
    return null;
  } finally {
    params.delete('shared');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
}

function firstImage(files: FileList | File[] | null | undefined): File | null {
  for (const f of Array.from(files ?? [])) if (f.type.startsWith('image/')) return f;
  return null;
}

/** Wires file button, drop zone and global paste to one callback. */
export function setupInput(root: HTMLElement, onFile: (f: File) => void): void {
  root.innerHTML = `
    <div class="dropzone" id="dropzone">
      <button type="button" class="primary" id="pick">Bild wählen</button>
      <p>oder Bild hierher ziehen oder mit Strg+V einfügen</p>
      <input type="file" id="file" accept="image/*" hidden aria-label="Bilddatei auswählen" />
    </div>`;
  const input = root.querySelector<HTMLInputElement>('#file')!;
  const zone = root.querySelector<HTMLElement>('#dropzone')!;
  root.querySelector<HTMLButtonElement>('#pick')!.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = firstImage(input.files);
    if (f) onFile(f);
    input.value = '';
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = firstImage(e.dataTransfer?.files);
    if (f) onFile(f);
  });
  document.addEventListener('paste', (e) => {
    const f = firstImage(e.clipboardData?.files);
    if (f) onFile(f);
  });
}
