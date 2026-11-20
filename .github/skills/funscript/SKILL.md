---
name: funscript
description: "Use when developing, debugging or extending Funscript Session (session builder/player for the Handy and vibrators), including its Python server, the web UI, beat/vib script generation, the phone remote, or the TvFin TV integration (/tv/... endpoints on port 8001)."
---

# Funscript Session

A small local app that builds sessions of a chosen length from clips of many videos, matched on script speed,
and plays them with one combined `.funscript` for The Handy (API v3, HSSP) and vibrators (Intiface/Buttplug).
Python 3.12 standard library + SQLite on the server, vanilla JS in the browser. No build step.

Also read `CLAUDE.md` in the repo root: it has the latest notes and the TvFin details.

## Files

- `server.py` – HTTP server on **127.0.0.1:8000** (`FUNSCRIPT_PORT`), all `/api/...` routes, static files from `web/`,
  video streaming (`/media/<id>`, Range) and thumbnails (`/thumb/<id>`). Danish error texts, translated by
  `MESSAGES_EN` / `translate_message` when the browser sends `X-Lang: en`.
- `funlib.py` – everything else: `parse_funscript`, speed/amplitude/beat analysis, `find_script`/`find_vib_scripts`,
  `.nfo` metadata, `Library` (SQLite: videos, sessions, feedback, marks, play_log, edge_games, settings),
  `ClipPicker`/`build_session`/`steer_session`, `assemble_script`, `vib_from_strokes`, backup/restore, stats.
- `remote.py` – the **LAN server on port 8001** (`FUNSCRIPT_REMOTE_PORT`), only when "Styr fra mobilen" is on:
  the phone remote page (`web/remote.html`) and the TV endpoints for TvFin. Everything needs the key `?k=`
  (`remote_key` setting), except `/tv/hello` and pairing.
- `beatgen.py` – optional (needs `librosa`): beat-based stroke script and `.vib`/`.vib2` from a PMV's music.
- `web/` – `index.html`, `app.js` (all UI and playback), `handy.js` (Handy API v3 client), `i18n.js` (Danish source
  strings, `EN` dict, `t()`, `translatePage()`), `style.css`, `remote.html`.
- `Genererede scripts/` – scripts the app made itself (mirrors the library's folder layout). Never written next to
  the videos.

## Endpoints (main server, 127.0.0.1 only)

`/api/health`, `/api/settings`, `/api/library`, `/api/scan` (+`/status`), `/api/remux` (+`/status`),
`/api/audio/status`, `/api/sessions`, `/api/sessions/build`, `/api/sessions/<id>` (GET/DELETE),
`/api/sessions/<id>/{similar,steer,edit|swap,rename,played,funscript}`, `/api/resume`,
`/api/videos/<id>/{rating,meta,script,generate,marks}`, `/api/marks/<id>/delete`, `/api/generate/{all,stop,status,open}`,
`/api/feedback` (+`/reset`), `/api/stats` (+`/tick`, `/edge`), `/api/backup`, `/api/restore`,
`/api/voice` (+`/scan`, `/file/<key>.mp3`), `/api/remote` (+`/wait` long-poll, `/status`),
`/api/tv/pending`, `/api/tv/answer`.

## TvFin integration (port 8001)

TvFin (`D:\OneDrive\Code Stuff\TvFin`, Tizen/ES5, see its `CLAUDE.md`) plays sessions on a Samsung TV:
- Discovery: `GET /tv/hello` → `{app, name}` (no key, reveals nothing else).
- Pairing like Quick Connect: `POST /tv/pair?name=…` → `{id, code}`; the PC app shows a banner, the user presses
  Allow (`/api/tv/answer`); `GET /tv/pair/<id>` → `pending | approved {key, handy} | denied | expired`.
- Read with the key: `/tv/info`, `/tv/sessions`, `/tv/sessions/<id>`, `/tv/media/<videoId>` (Range), `/tv/thumb/<videoId>`.
- Report back with the key: `POST /tv/sessions/<id>/played`, `POST /tv/stats/tick {seconds}`,
  `GET|POST /tv/resume {sessionId, ms}` (empty body = finished). The position is the same `resume` setting the PC
  uses, so a session can be continued on either.
- CORS `*` and `OPTIONS` on `/tv/...`. A change on one side usually needs the matching change on the other.

## Rules

- **The video library (X:\) is read-only**: never write, move or delete there. Generated scripts go to
  `Genererede scripts/`, caches to `%LOCALAPPDATA%\FunscriptSession`.
- **Handy keys** (Application ID, connection key) live only in the browser's `localStorage`; never store or log them
  on the server. Backups leave them out.
- `.funscript`: JSON with `actions` [{`at` ms, `pos` 0–100}]; validate, clamp, sort, drop invalid actions.
  Video time is seconds in the browser, script time is milliseconds.
- New UI text: Danish in the HTML/JS, English in the `EN` dict in `web/i18n.js`.
- Static files are served with `Cache-Control: no-cache`; a page reload picks up JS/CSS changes, server changes need
  a restart.
- No dependencies beyond the standard library (librosa is optional, only for `beatgen.py`).
- Commit or push only when the user asks.

## Testing

There is no test suite. Always:
- `python -W error -m py_compile funlib.py server.py remote.py beatgen.py` and `node --check web/*.js`.
- Run a **copy** so the real data is not touched:
  `FUNSCRIPT_DB=<copy>.db FUNSCRIPT_PORT=18000 FUNSCRIPT_REMOTE_PORT=18001 FUNSCRIPT_REMOTE_HOST=127.0.0.1 python server.py`
  (set `export_path` in the copy's settings to a temp folder; `FUNSCRIPT_GENERATED` moves generated scripts).
  `FUNSCRIPT_REMOTE_HOST=127.0.0.1` avoids the Windows Firewall prompt while testing.
- Check the flow in a browser (console errors, the changed controls) and say what could not be tested
  (real Handy, vibrators, phone, TV).
