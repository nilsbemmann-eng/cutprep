# CutPrep

Offline-fähige PWA (Vite + TypeScript), die Rasterbilder in Cricut-taugliche, ebenengetrennte SVGs umwandelt.

**Datenschutz:** Die Verarbeitung läuft komplett im Browser. Deine Bilder verlassen das Gerät nie.

Live: https://<github-account>.github.io/cutprep/

## Installation

- **Android:** Seite in Chrome öffnen, Menü → „App installieren“. Danach erscheint CutPrep unter „Teilen“ und kann Bilder direkt aus der Galerie entgegennehmen.
- **Windows:** Seite in Edge oder Chrome öffnen und in der Adressleiste auf das Installieren-Symbol klicken.

Nach der Installation funktioniert CutPrep auch ohne Internetverbindung.

## Benutzung

1. Bild laden.
2. Farben und Regler einstellen.
3. SVG speichern.
4. Das SVG in Cricut Design Space hochladen.

## Entwicklung

```
npm install
npm run dev     # Dev-Server
npm test        # Tests (vitest)
npm run build   # Typprüfung + Produktions-Build
```

Das Deployment läuft per GitHub Actions (`.github/workflows/pages.yml`) bei jedem Push auf `main`.

## Dokumentation

- Spezifikation: [docs/SPEC.md](docs/SPEC.md)
- Implementierungsplan: [docs/superpowers/plans/2026-11-22-cutprep-v1.md](docs/superpowers/plans/2026-11-22-cutprep-v1.md)

## Lizenz

GPL-2.0-or-later (wegen potrace), siehe [LICENSE](LICENSE).
