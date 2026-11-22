export interface Preview {
  setOriginal(url: string | null): void;
  setSvg(svg: string | null): void;
  /** Shows the text as status and marks the shown result as outdated (dimmed). */
  setBusy(text: string | null): void;
  /** Marks the shown result as outdated (dimmed) without a status text, e.g. after an error. */
  setStale(stale: boolean): void;
  setWarnings(warnings: string[]): void;
  setError(message: string | null): void;
}

export function setupPreview(root: HTMLElement): Preview {
  root.innerHTML = `
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Ansicht">
        <button type="button" id="v-result" aria-pressed="true">Ergebnis</button>
        <button type="button" id="v-orig" aria-pressed="false">Original</button>
      </div>
      <span id="busy" class="busy" role="status" hidden></span>
    </div>
    <div id="warnings" class="warnings" role="status"></div>
    <div id="error" class="error" role="alert" hidden></div>
    <div class="stage checker" id="stage">
      <p class="placeholder" id="placeholder">Noch kein Bild geladen.</p>
      <div id="result" class="view"></div>
      <img id="orig" class="view" alt="Originalbild" hidden />
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const result = $('result');
  const orig = $<HTMLImageElement>('orig');
  const bResult = $<HTMLButtonElement>('v-result');
  const bOrig = $<HTMLButtonElement>('v-orig');
  let showOriginal = false;
  let hasResult = false;
  let hasOriginal = false;

  const sync = () => {
    result.hidden = showOriginal;
    orig.hidden = !showOriginal;
    bResult.setAttribute('aria-pressed', String(!showOriginal));
    bOrig.setAttribute('aria-pressed', String(showOriginal));
    $('placeholder').hidden = showOriginal ? hasOriginal : hasResult || hasOriginal;
  };
  bResult.addEventListener('click', () => {
    showOriginal = false;
    sync();
  });
  bOrig.addEventListener('click', () => {
    showOriginal = true;
    sync();
  });

  return {
    setOriginal(url) {
      const old = orig.src;
      if (url) orig.src = url;
      else orig.removeAttribute('src');
      if (old.startsWith('blob:')) URL.revokeObjectURL(old);
      hasOriginal = url !== null;
      sync();
    },
    setSvg(svg) {
      result.replaceChildren();
      hasResult = false;
      if (svg) {
        // Our own generated markup, parsed as SVG (no string concatenation of user input).
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const el = doc.documentElement;
        if (el.nodeName === 'svg') {
          result.append(document.importNode(el, true));
          hasResult = true;
        }
      }
      sync();
    },
    setBusy(text) {
      const b = $('busy');
      b.hidden = text === null;
      b.textContent = text ?? '';
      // Keep showing the previous result, dimmed, until the newer one arrives.
      this.setStale(text !== null);
    },
    setStale(stale) {
      $('stage').classList.toggle('computing', stale);
      result.setAttribute('aria-busy', String(stale));
    },
    setWarnings(warnings) {
      const w = $('warnings');
      w.replaceChildren(
        ...warnings.map((t) => {
          const p = document.createElement('p');
          p.textContent = t;
          return p;
        }),
      );
    },
    setError(message) {
      const e = $('error');
      e.hidden = message === null;
      e.textContent = message ?? '';
    },
  };
}
