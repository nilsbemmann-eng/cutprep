import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { carryOverPaletteEdits } from './core/paletteCarry';
import { needsReanalysis, type RenderResult } from './core/pipeline';
import type { PaletteEntry, RGBAImage, Settings } from './core/types';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';
import { setupControls } from './ui/controls';
import { setupExport, baseName } from './ui/export';
import { consumeSharedImage, loadImageFile, setupInput } from './ui/input';
import { renderPalette } from './ui/palette';
import { setupPreview } from './ui/preview';

const DEBOUNCE_MS = 250;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header><h1>CutPrep</h1><p>Bild in Cricut-taugliche Ebenen umwandeln – alles lokal auf deinem Gerät.</p></header>
  <main>
    <section id="input" aria-label="Eingabe"></section>
    <section id="preview" aria-label="Vorschau"></section>
    <section id="controls" aria-label="Einstellungen"></section>
    <section id="palette" aria-label="Palette"></section>
    <section id="export" aria-label="Export"></section>
  </main>`;
const el = (id: string) => app.querySelector<HTMLElement>('#' + id)!;

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

let imageName = 'bild';
/** True once an image was handed to the worker (which keeps the pixels). */
let hasImage = false;
let palette: PaletteEntry[] = [];
/** Settings of the latest analysis request (decides whether a change needs a new one). */
let requestedSettings: Settings | null = null;
/** Settings of the last successful analysis; null after a failure. */
let analyzedSettings: Settings | null = null;
/** Palette whose edits the pending analysis should inherit; null for a new image. */
let carryFrom: PaletteEntry[] | null = null;
let analyzing = false;
let current: RenderResult | null = null;
let analyzeId = 0;
let renderId = 0;
let timer: number | undefined;

const preview = setupPreview(el('preview'));
const exporter = setupExport(
  el('export'),
  () => (current ? { result: current, name: imageName } : null),
  (m) => preview.setError(m),
);
const controls = setupControls(el('controls'), () => schedule(false));

let paletteMode: Settings['mode'] = 'multi';

function showPalette(): void {
  paletteMode = controls.getSettings().mode;
  renderPalette(el('palette'), palette, controls.getSettings().mode === 'mono', () => {
    showPalette();
    schedule(true);
  });
}

/** newImage: transfers the pixels to the worker; otherwise it re-analyses its cached copy. */
function sendAnalyze(newImage?: RGBAImage): void {
  if (!hasImage) return;
  const settings = controls.getSettings();
  requestedSettings = settings;
  // Same image, new settings: keep the user's palette edits (an earlier pending carry
  // source stays, since the current palette may not belong to the latest analysis yet).
  carryFrom = newImage ? null : analyzing ? carryFrom : palette;
  analyzing = true;
  preview.setBusy('Analysiere Bild…');
  const msg: WorkerRequest = { type: 'analyze', requestId: ++analyzeId, settings, image: newImage };
  worker.postMessage(msg, newImage ? [newImage.data.buffer] : []);
}

/** Drops the result so nothing stale can be previewed or exported. */
function clearResult(): void {
  current = null;
  exporter.setEnabled(false);
  preview.setSvg(null);
  preview.setWarnings([]);
}

function sendRender(): void {
  const settings = controls.getSettings();
  preview.setBusy('Berechne Vorschau…');
  const msg: WorkerRequest = {
    type: 'render',
    requestId: ++renderId,
    palette: palette.map((p) => ({ ...p, rgb: [...p.rgb] as PaletteEntry['rgb'] })),
    settings,
  };
  worker.postMessage(msg);
}

/** paletteOnly: palette edits never need a new analysis. */
function schedule(paletteOnly: boolean): void {
  if (!hasImage) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const s = controls.getSettings();
    if (!paletteOnly && (!requestedSettings || needsReanalysis(requestedSettings, s))) sendAnalyze();
    // A pending analysis renders with the latest settings once it arrives.
    else if (!analyzing) sendRender();
    // The palette's "schneiden" column depends on the mode; avoid needless rebuilds (focus).
    if (s.mode !== paletteMode) showPalette();
  }, DEBOUNCE_MS);
}

worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
  const msg = ev.data;
  if (msg.type === 'analyzed') {
    if (msg.requestId !== analyzeId) return;
    analyzing = false;
    analyzedSettings = requestedSettings;
    const fresh = msg.analysis.palette;
    palette = carryFrom ? carryOverPaletteEdits(carryFrom, fresh) : fresh.map((p) => ({ ...p }));
    carryFrom = null;
    showPalette();
    sendRender();
  } else if (msg.type === 'rendered') {
    if (msg.requestId !== renderId) return;
    current = msg.result;
    preview.setBusy(null);
    preview.setError(null);
    preview.setSvg(msg.result.svg);
    preview.setWarnings(msg.result.warnings);
    exporter.setEnabled(true);
  } else if (msg.type === 'error') {
    if (msg.requestId !== (msg.op === 'analyze' ? analyzeId : renderId)) return;
    if (msg.op === 'analyze') {
      // The worker dropped its analysis: the next settings change starts a new one.
      analyzing = false;
      analyzedSettings = null;
      requestedSettings = null;
      carryFrom = null;
      palette = [];
      showPalette();
      clearResult();
    }
    preview.setBusy(null);
    preview.setError(`Fehler: ${msg.message}`);
  }
};
worker.onerror = () => {
  preview.setBusy(null);
  preview.setError('Der Hintergrundprozess ist abgestürzt. Bitte Seite neu laden.');
};

async function onFile(file: Blob & { name?: string }): Promise<void> {
  try {
    preview.setError(null);
    const image = await loadImageFile(file);
    hasImage = true;
    imageName = baseName(file.name ?? 'bild');
    analyzedSettings = null;
    // The old palette and result belong to the previous image.
    palette = [];
    showPalette();
    clearResult();
    preview.setOriginal(URL.createObjectURL(file));
    sendAnalyze(image);
  } catch {
    preview.setError('Das Bild konnte nicht gelesen werden.');
  }
}

setupInput(el('input'), (f) => void onFile(f));
void consumeSharedImage().then((blob) => {
  if (blob) void onFile(blob);
});

// Offline support: production builds only (the dev server has no precache manifest).
if (import.meta.env.PROD) registerSW({ immediate: true });

// Dev-only hook for browser verification (tree-shaken from production builds).
if (import.meta.env.DEV) {
  (window as unknown as { __cutprep: unknown }).__cutprep = {
    load: (f: File) => onFile(f),
    get current() {
      return current;
    },
    get palette() {
      return palette;
    },
    get analyzedSettings() {
      return analyzedSettings;
    },
  };
}
