import { DEFAULT_SETTINGS, type Settings } from '../core/types';

export interface Controls {
  getSettings(): Settings;
}

/** Builds the settings form; calls onChange (undebounced) on every edit. */
export function setupControls(root: HTMLElement, onChange: () => void): Controls {
  const d = DEFAULT_SETTINGS;
  root.innerHTML = `
    <h2>Einstellungen</h2>
    <div class="grid">
      <label>Farbanzahl <output id="o-colors">${d.colorCount}</output>
        <input type="range" id="colorCount" min="2" max="8" step="1" value="${d.colorCount}" /></label>
      <label>Zielbreite (cm)
        <input type="number" id="targetWidthCm" min="1" max="60" step="0.5" value="${d.targetWidthCm}" /></label>
      <label>Mindestteilgröße (mm²)
        <input type="number" id="minPartAreaMm2" min="0" max="100" step="0.5" value="${d.minPartAreaMm2}" /></label>
      <label>Glättung <output id="o-smooth">${d.smoothing}</output>
        <input type="range" id="smoothing" min="0" max="1" step="0.05" value="${d.smoothing}" /></label>
      <label>Überlappung (mm)
        <input type="number" id="overlapMm" min="0" max="3" step="0.1" value="${d.overlapMm}" /></label>
      <label>Modus
        <select id="mode">
          <option value="multi">Mehrfarbig</option>
          <option value="mono">Einfarbig</option>
        </select></label>
      <label class="check"><input type="checkbox" id="stackOnDarkest" /> Schwarz als Basis-Ebene</label>
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const num = (id: string, fallback: number) => {
    const v = parseFloat($<HTMLInputElement>(id).value.replace(',', '.'));
    return Number.isFinite(v) ? v : fallback;
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const getSettings = (): Settings => ({
    colorCount: Math.round(clamp(num('colorCount', d.colorCount), 2, 8)),
    targetWidthCm: clamp(num('targetWidthCm', d.targetWidthCm), 1, 60),
    minPartAreaMm2: clamp(num('minPartAreaMm2', d.minPartAreaMm2), 0, 100),
    smoothing: clamp(num('smoothing', d.smoothing), 0, 1),
    overlapMm: clamp(num('overlapMm', d.overlapMm), 0, 3),
    mode: $<HTMLSelectElement>('mode').value === 'mono' ? 'mono' : 'multi',
    stackOnDarkest: $<HTMLInputElement>('stackOnDarkest').checked,
  });

  root.addEventListener('input', () => {
    $('o-colors').textContent = $<HTMLInputElement>('colorCount').value;
    $('o-smooth').textContent = $<HTMLInputElement>('smoothing').value;
    onChange();
  });
  root.addEventListener('change', onChange);
  return { getSettings };
}
