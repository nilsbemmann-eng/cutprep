# CutPrep – Spezifikation

Stand: 2026-11-22 (aus Grilling-Interview)

## Zweck
Rastergrafiken (Cliparts, JPG/PNG/WebP) in schneidfertige SVGs für den
**Cricut Joy Xtra / Cricut Design Space** (Windows + Android) umwandeln.

## Ausgabe
- **Modus „Mehrfarbig“ (Standard):** eine SVG-Gruppe `<g id="…">` pro Folienfarbe, sauber benannt.
- **Modus „Einfarbig“:** alles eine Farbe, Details als Aussparungen (Löcher).
- **Ebenenaufbau:**
  - Standard **Aussparen (Knockout)**: jede Farbe nur ihre eigene Fläche, jede Ebene um eine
    einstellbare **Überlappung** (Default 0,4 mm) aufgedickt, damit keine Blitzer entstehen.
  - Schalter **„Schwarz als Basis-Ebene“** → Stapeln: dunkelste Farbe wird volle Silhouette
    (Vereinigung aller Flächen), die übrigen Farben liegen oben drauf.
- **SVG-Regeln (Design-Space-Kompatibilität):** nur gefüllte `<path>`-Elemente in `<g>`-Gruppen;
  kein `<text>`, keine Masken, Filter, Clip-Pfade, Transforms, Strokes. `width`/`height` in `mm`,
  `viewBox` in mm-Einheiten.
- **Export:** ein SVG mit allen Ebenen; optional ein SVG pro Ebene; optional PNG pro Ebene.

## Bedienung (automatisch + Feinschliff, Live-Vorschau)
- Farbanzahl 2–8 (Regler)
- Palette: Farben zusammenlegen, umfärben, löschen (z. B. Hintergrund)
- Hintergrundfarbe **innerhalb** des Motivs (z. B. weißes Fell) bleibt als eigene Farbe „… (im Motiv)“ erhalten;
  Regler **„Konturlücken schließen (mm)“** (Default 1,0 mm) bestimmt, wie weit die Kontur offen sein darf
  (betrifft nur diese Innenflächen).
- Schalter **„Konturen komplett in Schwarz“** (Default an): die dunkle Linienzeichnung (auch dünne,
  kantengeglättete Linien) landet vollständig und durchgehend auf der schwarzen Ebene, statt in
  Grün/Rot/Grau zu zerfallen oder von Glättung und Krümelentfernung zerlegt zu werden. Gibt es keine
  schwarze Farbe (dunkel **und** neutral), wird eine Ebene „schwarz“ angelegt. Farbflächen bleiben farbig
  (kein Silhouetten-Modus), auch dunkle wie Braun, Marine oder Anthrazit. Lücken in den Linien bis zur Länge des
  Reglers **„Linienlücken überbrücken (mm)“** (Default 2,0 mm, 0–5, 0 = aus; nur aktiv, solange der Schalter an ist;
  unabhängig von „Konturlücken schließen“) werden vom Linienende aus überbrückt (in Linienrichtung, in Linienbreite,
  nicht quer durch Farbflächen; die Suche hat ein festes Arbeitsbudget, bei extrem vielen Linienenden bleiben
  dann einige Lücken offen). Schwache, helle Strichteile, die an einer Linie hängen, gehören dazu.
  Bei dunklem Hintergrund bleibt der Hintergrund außen vor.
- Mindestgröße für Teile (mm²) – Krümel, die man nicht entgittern kann, fallen weg
- Glättung / Detailtreue
- Zielbreite in cm (Default 20 cm; Joy Xtra max. ~21,6 cm Materialbreite)
- Kein Vektor-Editor – Feinarbeit in Design Space.

## Vorverarbeitung
Klassisch: intern hochskalieren (2–4×), kantenerhaltend entrauschen, Farben normalisieren.
KI-Hochskalierung ist **später** als zusätzlicher Pipeline-Schritt vorgesehen.

## Ein-/Ausgabe-Wege
- Eingang: Datei wählen, Drag & Drop, Zwischenablage (Strg+V), Android „Teilen mit…“ (Web Share Target).
- Ausgang: Download, Teilen (Web Share API).

## Plattform
- Installierbare **PWA**, vollständig offline, Verarbeitung lokal (Web Worker). Kein Bild verlässt das Gerät.
- Hosting: GitHub Pages, öffentliches Repo `cutprep`.
- Oberfläche auf Deutsch.
- **Später:** Tauri 2 (.exe/.apk) aus demselben Code.

## Nicht in v1
KI-Aufbereitung, Tauri-Pakete, Kamera, Vektor-Editor, Centerline für Stiftplotter.

## Referenzmaterial
- `test/fixtures/grinch-raster.jpg` – typische schlechte Vorlage (klein, JPEG, grauer Hintergrund).
- `test/fixtures/grinch-referenz-vektor.jpg` – Zielbild (handgezeichneter Vektor, mehrfarbig + einfarbig).
