**English** | [Dansk](CHANGELOG.da.md)

# Changelog

All changes to Funscript Session. Restart the server (`Start Funscript.bat`) after updating.

## 1.1.0 – 2026-11-20

### Added
- **TV (TvFin): vibrators and tempo.** A session sent to the TV now includes its vibrator tracks (`vib`/`vib2`), so TvFin 1.11.0 can drive vibrators and strokers through Intiface Central on this PC, like the app does. TvFin also got tempo (50–150 %) for the video and the Handy.

## 1.0.0 – 2026-11-20

First versioned release. Everything below was built before it; from now on each release has its own entry.

### Sessions
- Build sessions of a chosen length from clips of many videos, matched on script speed, with natural cut points,
  similar stroke length, related follow-ups, beat sync for PMVs, warm-up, surprises and courses (constant,
  build-up, waves, edging, finale, the whole ride).
- Live steering (▲▼⏹), build similar, edit/swap/move clips, saved set-ups, ∞ endless, 🎯 edge game.
- Learns what you like; ★ favourites, 👎 never use, ⭐ favourite spots (B).

### Devices
- The Handy directly (firmware 4, API v3, HSSP) with temperature guard, stroke range (now remembered), delay and
  🎯 calibration; vibrators via Intiface (`.vib`/`.vib2`), ✋ hold still; connects automatically.

### Scripts
- Auto beat scripts for PMVs (librosa), "New script" with auto ⇄ original, vib scripts from music or from the
  stroke script with a full dynamic range; script check; trash cans and system folders are skipped when scanning.

### Library and playback
- Picture grid with Jellyfin `.nfo` metadata, actor/genre/category filters and a metadata editor; hover previews;
  even volume; continue where you left off; sound cues and Home Assistant voice; DA/EN.
- 📊 statistics, 💾 backup/restore, undo messages, help page (?).

### Remote and TV
- 📱 phone remote on port 8001 (key in the link).
- 📺 TvFin on Samsung TVs: pairing like Quick Connect, sessions with the Handy on the TV, reports played time and
  position back; continue on the TV or the PC.
