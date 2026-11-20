[English](CHANGELOG.md) | **Dansk**

# Changelog

Alle ændringer i Funscript Session. Genstart serveren (`Start Funscript.bat`) efter en opdatering.

## 1.1.0 – 2026-11-20

### Tilføjet
- **Tv (TvFin): vibratorer og tempo.** En session, der sendes til tv'et, har nu sine vibrator-spor med (`vib`/`vib2`), så TvFin 1.11.0 kan styre vibratorer og strokere via Intiface Central på denne PC, ligesom appen. TvFin har også fået tempo (50–150 %) for video og Handy.

## 1.0.0 – 2026-11-20

Første version med versionsnummer. Alt herunder blev lavet før; fremover får hver udgivelse sit eget afsnit.

### Sessioner
- Byg sessioner af en valgt længde ud fra klip fra mange videoer, valgt efter scriptets hastighed, med naturlige
  klippesteder, ens slaglængde, beslægtede opfølgere, takt-sync for PMV'er, opvarmning, overraskelser og forløb
  (konstant, opbygning, bølger, edging, finale, hele turen).
- Live-styring (▲▼⏹), byg lignende, rediger/byt/flyt klip, gemte opsætninger, ∞ uendelig, 🎯 edge-spil.
- Lærer hvad du kan lide; ★ favoritter, 👎 brug aldrig, ⭐ yndlingssteder (B).

### Enheder
- Handy direkte (firmware 4, API v3, HSSP) med temperaturvagt, slag-område (huskes nu), forsinkelse og
  🎯 kalibrering; vibratorer via Intiface (`.vib`/`.vib2`), ✋ hold stille; forbinder automatisk.

### Scripts
- Auto beat-scripts til PMV'er (librosa), "Nyt script" med auto ⇄ original, vib-scripts ud fra musik eller
  stroke-script med fuld dynamik; script-tjek; skraldespande og systemmapper springes over ved scanning.

### Bibliotek og afspilning
- Billedgitter med Jellyfin-`.nfo`-metadata, filtre på skuespiller/genre/kategori og metadata-editor;
  forhåndsvisning; ens lydstyrke; fortsæt hvor du slap; lyd-signaler og Home Assistant-stemme; DA/EN.
- 📊 statistik, 💾 backup/gendan, fortryd-beskeder, hjælpeside (?).

### Fjernbetjening og tv
- 📱 mobil-fjernbetjening på port 8001 (nøgle i linket).
- 📺 TvFin på Samsung-tv: parring som Quick Connect, sessioner med Handy på tv'et, melder spilletid og position
  tilbage; fortsæt på tv eller PC.
