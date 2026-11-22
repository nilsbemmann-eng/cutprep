import type { RGBAImage } from '../core/types';

/** Decodes an image Blob to RGBA pixels; the browser applies EXIF orientation. */
export async function loadImageFile(file: Blob): Promise<RGBAImage> {
  const bmp = await createImageBitmap(file);
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

/** Hook for the Web Share Target (filled in Task 10). */
export function consumeSharedImage(): Promise<Blob | null> {
  return Promise.resolve(null);
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
