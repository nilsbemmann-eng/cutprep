# Innenweiß erhalten – Plan

**Ziel:** Flächen in der Hintergrundfarbe, die *innerhalb* des Motivs liegen (z. B. der weiße Mützenrand des Grinch), bleiben als eigene, schneidbare Farbe erhalten, statt mit dem Hintergrund gelöscht zu werden.

**Problem heute:** `detectBackground` liefert ein Label; der ganze Cluster wird gelöscht – Hintergrund und Mützenfell sind im Grinch derselbe Cluster („weiß“, 73 %). Ein einfacher Flood-Fill vom Rand hilft kaum (nur 0,29 % eingeschlossen), weil die schwarze Kontur Lücken hat.

## Ansatz (Entscheidungen)
1. **Außenbereich mit Lückenschluss:** Barriere = alle Pixel, die weder Hintergrundlabel noch transparent sind, dilatiert um `r = round(gapCloseMm · pxPerMm)`. Flood-Fill (4er-Nachbarschaft) startet an allen Randpixeln mit Hintergrundlabel oder −1 und läuft durch Hintergrund-/transparente Pixel, die nicht in der Barriere liegen. Erreichte Fläche wird um `r` dilatiert (Kante wiederherstellen) und mit „Label = Hintergrund“ geschnitten → **Außen**.
2. **Innen** = Hintergrundlabel-Pixel, die nicht Außen sind. Sie bekommen ein **neues Label** (`max(id)+1`) und einen eigenen Paletteneintrag: gleiche Farbe, `deleted: false`, Feld `role: 'interior'`. Der Hintergrund-Eintrag bekommt `role: 'background'`. Danach läuft die Krümelentfernung, sodass winzige Innenstücke verschwinden.
3. **Neue Einstellung** `gapCloseMm` (Default **1,0 mm**, Bereich 0–3, Schritt 0,1), Regler „Konturlücken schließen (mm)“. Änderung löst Neuanalyse aus. 0 = reiner Flood-Fill ohne Lückenschluss. Kein Hintergrund erkannt → nichts tun.
4. **UI:** Der Innen-Eintrag erscheint in der Palette als z. B. „weiß (im Motiv)“, der Hintergrund als „weiß (Hintergrund)“. Löschen/Zusammenlegen/Umfärben funktionieren wie bei jeder Farbe.
5. **Übertrag von Palettenänderungen** (`carryOverPaletteEdits`): Einträge werden nur mit Einträgen **derselben Rolle** gepaart, sonst könnten Hintergrund und Innenweiß (gleiche Farbe) vertauscht werden.
6. **Einfarbig:** Innenweiß ist standardmäßig nicht „schneiden“ (bleibt Loch) – wie bisher alle hellen Farben.
7. **Ebenenname/ID:** normaler Farbname („weiß“ → id `weiss`); bei Kollision greift `layerIds` (`weiss-2`). Kein Sonderfall nötig.

Default-Wert in Schritt 3 wird am Grinch-Fixture kalibriert (Ziel: Mützenrand und Bommel bleiben erhalten, kein Hintergrund „läuft“ ins Innere); Abweichung vom Default 1,0 mm nur mit Messwerten begründet.
