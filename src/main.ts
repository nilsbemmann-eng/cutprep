import './style.css';
import { needsReanalysis, type RenderResult } from './core/pipeline';
import type { PaletteEntry, Settings } from './core/types';
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
let image: Awaited<ReturnType<typeof loadImageFile>> | null = null;
let palette: PaletteEntry[] = [];
let analyzedSettings: Settings | null = null;
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

function sendAnalyze(): void {
  if (!image) return;
  const settings = controls.getSettings();
  analyzedSettings = settings;
  preview.setBusy('Analysiere Bild…');
  const msg: WorkerRequest = { type: 'analyze', requestId: ++analyzeId, image, settings };
  worker.postMessage(msg);
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
  if (!image) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const s = controls.getSettings();
    if (!paletteOnly && analyzedSettings && needsReanalysis(analyzedSettings, s)) sendAnalyze();
    else sendRender();
    // The palette's "schneiden" column depends on the mode; avoid needless rebuilds (focus).
    if (s.mode !== paletteMode) showPalette();
  }, DEBOUNCE_MS);
}

worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
  const msg = ev.data;
  if (msg.type === 'analyzed') {
    if (msg.requestId !== analyzeId) return;
    palette = msg.analysis.palette.map((p) => ({ ...p }));
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
    if (msg.requestId !== analyzeId && msg.requestId !== renderId) return;
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
    image = await loadImageFile(file);
    imageName = baseName(file.name ?? 'bild');
    current = null;
    exporter.setEnabled(false);
    preview.setOriginal(URL.createObjectURL(file));
    preview.setSvg(null);
    sendAnalyze();
  } catch {
    preview.setError('Das Bild konnte nicht gelesen werden.');
  }
}

setupInput(el('input'), (f) => void onFile(f));
void consumeSharedImage().then((blob) => {
  if (blob) void onFile(blob);
});

// Dev-only hook for browser verification (tree-shaken from production builds).
if (import.meta.env.DEV) {
  (window as unknown as { __cutprep: unknown }).__cutprep = {
    load: (f: File) => onFile(f),
    get current() {
      return current;
    },
  };
}
