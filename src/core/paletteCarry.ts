import { rgbToLab } from './color';
import type { PaletteEntry } from './types';

/** Beyond this CIE76 distance an old entry is not considered the same colour. */
export const CARRY_MAX_DELTA_E = 15;

/**
 * Re-applies the user's palette edits (deleted, mergedInto, monoInclude and a
 * recolour) after a re-analysis of the same image. Old and new entries are
 * paired one-to-one by nearest Lab distance of their ORIGINAL cluster colours
 * (`originalRgb`), closest pairs first, up to `maxDeltaE`; only entries with the same
 * `role` are paired (background and interior white would otherwise swap). Unpaired new entries
 * keep the analysis defaults; mergedInto is remapped to the new ids and
 * dropped when its target has no partner. Returns new objects; inputs stay untouched.
 */
export function carryOverPaletteEdits(
  oldEntries: readonly PaletteEntry[],
  newEntries: readonly PaletteEntry[],
  maxDeltaE = CARRY_MAX_DELTA_E,
): PaletteEntry[] {
  const oldLab = oldEntries.map((e) => rgbToLab(e.originalRgb));
  const newLab = newEntries.map((e) => rgbToLab(e.originalRgb));
  const pairs: { o: number; n: number; d: number }[] = [];
  for (let o = 0; o < oldEntries.length; o++) {
    for (let n = 0; n < newEntries.length; n++) {
      const a = oldLab[o];
      const b = newLab[n];
      // Background and interior share a colour; only the role tells them apart.
      if (oldEntries[o].role !== newEntries[n].role) continue;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d <= maxDeltaE) pairs.push({ o, n, d });
    }
  }
  pairs.sort((p, q) => p.d - q.d || p.n - q.n || p.o - q.o);

  const partnerOfNew = new Map<number, number>(); // new index -> old index
  const newIdOfOldId = new Map<number, number>();
  const usedOld = new Set<number>();
  for (const { o, n } of pairs) {
    if (usedOld.has(o) || partnerOfNew.has(n)) continue;
    usedOld.add(o);
    partnerOfNew.set(n, o);
    newIdOfOldId.set(oldEntries[o].id, newEntries[n].id);
  }

  return newEntries.map((fresh, n) => {
    const out: PaletteEntry = { ...fresh, rgb: [...fresh.rgb], originalRgb: [...fresh.originalRgb] };
    const o = partnerOfNew.get(n);
    if (o === undefined) return out;
    const old = oldEntries[o];
    out.deleted = old.deleted;
    out.monoInclude = old.monoInclude;
    out.mergedInto = old.mergedInto === null ? null : (newIdOfOldId.get(old.mergedInto) ?? null);
    if (out.mergedInto === out.id) out.mergedInto = null;
    const recoloured = old.rgb.some((c, i) => c !== old.originalRgb[i]);
    if (recoloured) {
      out.rgb = [...old.rgb];
      out.name = old.name;
    }
    return out;
  });
}
