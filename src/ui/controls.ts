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
      <label>Konturlücken schließen (mm) <output id="o-gap">${d.gapCloseMm}</output>
        <input type="range" id="gapCloseMm" min="0" max="3" step="0.1" value="${d.gapCloseMm}"
          aria-describedby="gapCloseMm-hint" />
        <small id="gapCloseMm-hint">Betrifft nur Innenflächen: Hintergrundfarbe im Motiv (z. B. weißes Fell) bleibt erhalten, solange die Kontur höchstens so weit offen ist. 0 = nur ganz umschlossene Flächen.</small></label>
      <label>Modus
        <select id="mode">
          <option value="multi">Mehrfarbig</option>
          <option value="mono">Einfarbig</option>
        </select></label>
      <label class="check"><input type="checkbox" id="stackOnDarkest" /> Schwarz als Basis-Ebene</label>
      <label class="check"><input type="checkbox" id="outlinesBlack" ${d.outlinesBlack ? 'checked' : ''}
          aria-describedby="outlinesBlack-hint" /> <span>Konturen komplett in Schwarz</span>
        <small id="outlinesBlack-hint">Für Strichzeichnungen: dunkle Linien – auch dünne – kommen vollständig auf die schwarze Ebene, Lücken werden bis zur Länge „Linienlücken überbrücken“ geschlossen.</small></label>
      <label>Linienlücken überbrücken (mm) <output id="o-bridge">${d.bridgeGapMm}</output>
        <input type="range" id="bridgeGapMm" min="0" max="5" step="0.1" value="${d.bridgeGapMm}"
          ${d.outlinesBlack ? '' : 'disabled'} aria-describedby="bridgeGapMm-hint" />
        <small id="bridgeGapMm-hint">Schließt Lücken in schwarzen Linien bis zu dieser Länge, in Linienrichtung. 0 = aus.</small></label>
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
    gapCloseMm: clamp(num('gapCloseMm', d.gapCloseMm), 0, 3),
    outlinesBlack: $<HTMLInputElement>('outlinesBlack').checked,
    bridgeGapMm: clamp(num('bridgeGapMm', d.bridgeGapMm), 0, 5),
  });

  root.addEventListener('input', () => {
    $('o-colors').textContent = $<HTMLInputElement>('colorCount').value;
    $('o-smooth').textContent = $<HTMLInputElement>('smoothing').value;
    $('o-gap').textContent = $<HTMLInputElement>('gapCloseMm').value;
    $('o-bridge').textContent = $<HTMLInputElement>('bridgeGapMm').value;
    $<HTMLInputElement>('bridgeGapMm').disabled = !$<HTMLInputElement>('outlinesBlack').checked;
    onChange();
  });
  root.addEventListener('change', onChange);
  return { getSettings };
}
