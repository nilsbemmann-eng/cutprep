import { rgbToHex, hexToRgb } from './colorUtil';
import { germanColorName } from '../core/color';
import type { PaletteEntry } from '../core/types';

/** Renders the editable palette; mutates the entries and calls onChange. */
export function renderPalette(
  root: HTMLElement,
  entries: PaletteEntry[],
  mono: boolean,
  onChange: () => void,
): void {
  // Remember the focused control so a rebuild can restore it.
  const active = document.activeElement as HTMLElement | null;
  const focusKey =
    active && root.contains(active) && active.dataset.id
      ? `[data-id="${active.dataset.id}"][data-kind="${active.dataset.kind}"]`
      : null;
  root.replaceChildren();
  if (entries.length === 0) return;
  const tag = (el: HTMLElement, id: number, kind: string) => {
    el.dataset.id = String(id);
    el.dataset.kind = kind;
  };
  const h = document.createElement('h2');
  h.textContent = 'Palette';
  root.append(h);

  // Background and the white inside the motif share a colour name; the role tells them apart.
  const baseLabel = (e: PaletteEntry) =>
    e.role === 'interior' ? `${e.name} (im Motiv)` : e.role === 'background' ? `${e.name} (Hintergrund)` : e.name;
  const nameCount = new Map<string, number>();
  for (const e of entries) nameCount.set(baseLabel(e), (nameCount.get(baseLabel(e)) ?? 0) + 1);
  const label = (e: PaletteEntry) => {
    const base = baseLabel(e);
    return nameCount.get(base)! > 1 ? `${base} (${e.id})` : base;
  };

  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'pal-row';
    if (e.deleted) row.classList.add('deleted');
    const target = e.mergedInto === null ? undefined : entries.find((x) => x.id === e.mergedInto);
    const targetGone = e.mergedInto !== null && (!target || target.deleted);
    if (e.mergedInto !== null) row.classList.add('merged');
    if (e.deleted || targetGone) row.classList.add('deleted');

    const color = document.createElement('input');
    color.type = 'color';
    color.value = rgbToHex(e.rgb);
    color.setAttribute('aria-label', `Farbe ${label(e)} ändern`);
    color.addEventListener('change', () => {
      e.rgb = hexToRgb(color.value);
      e.name = germanColorName(e.rgb);
      onChange();
    });

    const name = document.createElement('span');
    name.className = 'pal-name';
    name.textContent = label(e);
    if (e.mergedInto !== null) {
      const note = document.createElement('small');
      note.textContent = targetGone
        ? ` → Ziel gelöscht – wird nicht geschnitten`
        : ` → zusammengelegt mit ${label(target!)}`;
      name.append(note);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = e.deleted ? 'Wiederherstellen' : 'Löschen';
    del.setAttribute('aria-label', `${label(e)} ${e.deleted ? 'wiederherstellen' : 'löschen'}`);
    del.addEventListener('click', () => {
      e.deleted = !e.deleted;
      onChange();
    });

    const merge = document.createElement('select');
    merge.setAttribute('aria-label', `${label(e)} zusammenlegen mit`);
    const none = new Option('Zusammenlegen mit…', '');
    merge.append(none);
    for (const o of entries) {
      if (o.id === e.id) continue;
      // Keep the current target selectable even when it was deleted later.
      if (o.deleted && o.id !== e.mergedInto) continue;
      merge.append(new Option(o.deleted ? `${label(o)} (gelöscht)` : label(o), String(o.id)));
    }
    merge.value = e.mergedInto === null ? '' : String(e.mergedInto);
    merge.addEventListener('change', () => {
      e.mergedInto = merge.value === '' ? null : Number(merge.value);
      onChange();
    });

    tag(color, e.id, 'color');
    tag(del, e.id, 'delete');
    tag(merge, e.id, 'merge');
    row.append(color, name, del, merge);

    if (mono) {
      const lab = document.createElement('label');
      lab.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = e.monoInclude;
      cb.setAttribute('aria-label', `${label(e)} schneiden`);
      tag(cb, e.id, 'mono');
      cb.addEventListener('change', () => {
        e.monoInclude = cb.checked;
        onChange();
      });
      lab.append(cb, ' schneiden');
      row.append(lab);
    }
    root.append(row);
  }
  if (focusKey) root.querySelector<HTMLElement>(focusKey)?.focus();
}
