# Noter til Claude

## TvFin-integration (lavet 2026-11-16, fra TvFin-chatten)

Funscript Session kan nu afspilles på et Samsung-tv via **TvFin** (`D:\OneDrive\Code Stuff\TvFin`,
https://github.com/Tntdruid/TvFin), brugerens egen Jellyfin-app til Tizen.

**Hvad der er lavet her i Funscript:**
- `remote.py` (LAN-serveren på port 8001, samme som mobil-fjernbetjeningen):
  - `stream_file()` – fælles Range-streaming (bruges nu også af `server.py` `send_video`).
  - Parring à la Quick Connect: `POST /tv/pair?name=…` → `{id, code}` (4 cifre, udløber efter 5 min, maks 5 åbne),
    `GET /tv/pair/<id>` → `pending | approved {key, handy} | denied | expired` (svaret udleveres kun én gang).
  - Læs-kun endpoints med nøglen (`?k=` = `remote_key`): `/tv/info`, `/tv/sessions` (inkl. `thumbVideoId`),
    `/tv/sessions/<id>` (id, name, totalMs, clips, actions), `/tv/media/<videoId>` (Range), `/tv/thumb/<videoId>`.
  - CORS (`Access-Control-Allow-Origin: *`) og `OPTIONS` på `/tv/...`.
- `server.py`: `GET /api/tv/pending` og `POST /api/tv/answer {id, allow, handy}` (kun 127.0.0.1).
- `web/`: banner nederst til højre "📺 Et tv vil forbinde · kode …" med Tillad/Afvis og "Send Handy-opsætningen med"
  (sender `handyAppId`/`handyKey` fra browserens localStorage – de gemmes ikke på serveren). Adressen til tv'et vises
  under Fjernbetjening (`#tvAddress`). Polles hvert 3. sek mens fjernbetjeningen er slået til.
  Vigtigt: `#tvPair` skal stå FØR `<script>`-tags i `index.html` (ellers fejler `app.js` ved opstart).
- README: afsnittet "📺 Se sessioner på tv (TvFin)".

**I TvFin** (`app/js/funscript.js`): `Fun` (parring/endpoints, gemt pr. TvFin-bruger i localStorage
`tvfin-funscript`), `Handy` (port af `web/handy.js`, ES5-venlig) og `FunPlayer` (afspiller klip efter klip med
AVPlay; sessionstid = `clip.offsetMs + (videoTid - clip.startMs)`; Handy stoppes ved klipskift og startes igen ved
`started`; drift-korrektion hvert 5. sek hvis > 300 ms). Skærme `funpair` og `funscript` i `app/js/app.js`.

**Ikke lavet endnu / idéer:** Intiface/vibratorer fra tv'et (kræver ws til Intiface på PC'en), statistik/"afspillet"
tilbage til Funscript, fortsæt-position, tempo (playback_rate), edge-spil og stemme-coach på tv'et.

**Test-tip:** kør en kopi med egen database og porte, så de rigtige data ikke røres:
`FUNSCRIPT_DB=<kopi>.db FUNSCRIPT_PORT=18000 FUNSCRIPT_REMOTE_PORT=18001 FUNSCRIPT_REMOTE_HOST=127.0.0.1 python server.py`
(sæt `export_path` i kopiens settings til en temp-mappe, ellers skriver den .funscript-filer i `sessions\`).
