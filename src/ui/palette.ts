import { rgbToHex, hexToRgb } from './colorUtil';
import type { PaletteEntry } from '../core/types';

/** Renders the editable palette; mutates the entries and calls onChange. */
export function renderPalette(
  root: HTMLElement,
  entries: PaletteEntry[],
  mono: boolean,
  onChange: () => void,
): void {
  root.replaceChildren();
  if (entries.length === 0) return;
  const h = document.createElement('h2');
  h.textContent = 'Palette';
  root.append(h);

  const nameCount = new Map<string, number>();
  for (const e of entries) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
  const label = (e: PaletteEntry) => (nameCount.get(e.name)! > 1 ? `${e.name} (${e.id})` : e.name);

  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'pal-row';
    if (e.deleted) row.classList.add('deleted');
    if (e.mergedInto !== null) row.classList.add('merged');

    const color = document.createElement('input');
    color.type = 'color';
    color.value = rgbToHex(e.rgb);
    color.setAttribute('aria-label', `Farbe ${label(e)} ändern`);
    color.addEventListener('change', () => {
      e.rgb = hexToRgb(color.value);
      onChange();
    });

    const name = document.createElement('span');
    name.className = 'pal-name';
    name.textContent = label(e);
    if (e.mergedInto !== null) {
      const tag = document.createElement('small');
      const target = entries.find((x) => x.id === e.mergedInto);
      tag.textContent = ` → zusammengelegt mit ${target ? label(target) : '?'}`;
      name.append(tag);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = e.deleted ? 'Wiederherstellen' : 'Löschen';
    del.addEventListener('click', () => {
      e.deleted = !e.deleted;
      onChange();
    });

    const merge = document.createElement('select');
    merge.setAttribute('aria-label', `${label(e)} zusammenlegen mit`);
    const none = new Option('Zusammenlegen mit…', '');
    merge.append(none);
    for (const o of entries) {
      if (o.id === e.id || o.deleted) continue;
      merge.append(new Option(label(o), String(o.id)));
    }
    merge.value = e.mergedInto === null ? '' : String(e.mergedInto);
    merge.addEventListener('change', () => {
      e.mergedInto = merge.value === '' ? null : Number(merge.value);
      onChange();
    });

    row.append(color, name, del, merge);

    if (mono) {
      const lab = document.createElement('label');
      lab.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = e.monoInclude;
      cb.addEventListener('change', () => {
        e.monoInclude = cb.checked;
        onChange();
      });
      lab.append(cb, ' schneiden');
      row.append(lab);
    }
    root.append(row);
  }
}
