**English** | [Dansk](README.da.md)

# Funscript Session Player

A lightweight funscript player that builds sessions of a chosen length (e.g. 15 min) from clips of many
videos, picked so the script speed fits together.

## Run it

```bash
python server.py
```

Open http://127.0.0.1:8000 – choose the folder with your videos and press **Scan**.

Only needs Python 3.9+ (no packages; tested with 3.12). `ffprobe` is used for the video length when it is
installed, otherwise the length of the script is used.

### Portable (everything in one folder)

Run `make-portable.ps1` once (PowerShell in the app folder:
`powershell -ExecutionPolicy Bypass -File make-portable.ps1`). It puts its own Python with librosa in `python\`,
ffmpeg/ffprobe in `bin\` and the cache in `data\` (copied from `%LOCALAPPDATA%\FunscriptSession`). The database,
`sessions\` and `Genererede scripts\` already live in the folder. After that the whole app is one folder that can
be copied to another PC or a USB stick; `Start Funscript.bat` uses `python\` when it is there. Your videos stay
where they are (the library is only read). `-NoLibrosa` skips librosa (smaller, but no new beat scripts), `-Zip`
also makes `dist\FunscriptSession-portable-<version>.zip` with the program only – never your database, sessions or
scripts.

## How it works

1. **Scan** finds videos and their script by file name (`Video.mp4` → `Video.funscript`).
   Each script is analysed in 5-second windows: average speed in *u/s* (position units per second,
   0–100 scale). The result is stored in `funscript.db` (SQLite), so only new/changed files are analysed again.
2. **Build session** picks the length, time per video, target speed and course (constant, build-up or waves).
   For each clip the part of each video whose speed is closest to the target (and steadiest) is found. Videos
   that are more than ±30% off are only used when nothing else fits.
   The choice is also "natural": clips start and end at a turning point of a stroke or a pause (moved at most
   ±2.5 s), the next clip preferably starts in the position where the previous one ended, the stroke length is
   similar to the previous clip, a video in the same category or with a shared genre/actor is preferred as a
   follow-up, and intros/credits (first and last 4%) are avoided.
   **Beat sync:** PMV/Cock Hero videos (recognised by folder, genre or name) are only cut on the bottom stroke –
   in beat-synced scripts that is the music's beat – and after a PMV clip a clip with the same tempo
   (strokes/min, or half/double time) is preferred. The tempo is shown in the clip info.

**Auto scripts for PMVs:** PMVs without a script get the button "🎵 Make script". The app finds the music's beat
(librosa, in 30-second pieces so tempo changes in compilations are followed) and makes one stroke per beat – the
bottom on the beat, stroke length from how loud the music is, quiet passages hold still. The script is saved in
the `Genererede scripts` folder in the app folder (never next to the video) with the same folder layout and name
as the video – `X:\PMV.mp4` → `Genererede scripts\X\PMV.funscript` – so it can be copied next to the video to use
in other players. It is marked "auto". Under Library, "🎵 Make scripts for all PMVs (N)" makes scripts for all of
them in the background (with progress and Stop), and 📂 opens the folder. Tested against real PMV scripts: 71–99%
of the automatic strokes land on a real stroke. Needs `pip install librosa`; without it the buttons are hidden.
PMVs that already have a script get the button "🎵 New script": the app makes an auto script alongside (the
original is never touched) and uses it. The "auto ⇄ / original ⇄" button switches between the two.
"↻ Remake auto scripts" makes all auto scripts again with the newest version of the beat detection. Missing beats
in the middle of the music are filled in, so there are no holes in the script.

**Auto vib scripts:** At the same time `.vib` and `.vib2` are made for vibrators (e.g. Lovense Gush 2 and Edge):
`.vib` pulses on the beat and gets stronger when the music is loud, `.vib2` (motor 2) pulses on the off-beat with
the strength of the bass, so the two motors take turns. The strength is spread over the whole range within each
video (calm parts are really calm, peaks reach the top) with a clear pause after each pulse. They are only used
when the video has no vib scripts of its own. PMVs that have a script but no vib get the button "📳 Make vib",
and "Make scripts for all PMVs" makes them too.
Other videos (not PMVs) can get vib scripts from their stroke script: one pulse per stroke, stronger the faster
the stroke, and quick strokes are pooled into pulses of at least 250 ms. `.vib2` pulses half way through each
stroke with the strength of the overall pace. Use "📳 Make vib" on a video or "📳 Make vib scripts for all other
videos" (a few minutes for several hundred videos, does not need librosa).

3. The clips are laid one after another and one funscript for the whole session is assembled, stored in the
   database and downloadable as `.funscript`.
4. The player switches seamlessly between clips (the next clip is preloaded) and drives a device via Intiface
   Central (Buttplug, `linear` for Handy/OSR, `vibrate` for vibrators).

Each session is also saved automatically as `.funscript` in the `sessions\` folder (can be changed under
"Saved sessions"). The file is named e.g. `004 - 15 min · Build-up · 216 u-s.funscript`, and the list of clips is
in the script's metadata. Deleting a session in the app leaves the file.

**The Handy directly (firmware 4, Handy API v3):** Enter your Application ID and the connection key from the
Handy app under Devices and press Connect. The Application ID needs a free developer account: request an
invitation at https://user.handyfeeling.com/invite, register, log in and issue an API token (Application ID).
The session's combined script is uploaded to Handy's own script hosting, and the Handy plays it by itself in sync
with the video (HSSP). On seeking, clip changes or buffering it resyncs automatically. The keys are only stored in
your browser. Intiface can still be used for other devices.

**Trash cans are skipped:** The scan does not go into recycle bins and system folders (`#recycle`, `@eaDir`,
`#snapshot` on Synology, `$RECYCLE.BIN`, `System Volume Information`, `.Trash` and hidden folders).

**Categories:** The folders in the library (e.g. `X:\Handy\PoV`) become categories that can be chosen under
"New session". Folders with just one video end up under "Loose files". On top of that, "PMV" gathers all
PMV/Cock Hero/beat videos, whichever folder they are in.

**Transitions:** Between clips the script glides over 600 ms instead of jumping, and the picture fades over.
With "Smooth transitions between clips" off, every point in the session's script is 100% from your original
files (only the clips' start/end points are calculated, and they lie on the original curve).

**Vibrators (Lovense Edge, Gush 2 and others):** Connect via Intiface Central under "Devices" – can run at the
same time as the Handy. Scan finds `Video.vib.funscript` (motor 1) and `Video.vib2.funscript` (motor 2, e.g.
Edge). Under "Vibration" choose: "Automatic" (default – vibration only when a vibrator is connected via Intiface
when the session is built; otherwise strokes only), "No vibration (Handy/strokes only)", "Use .vib script – derive
from strokes where it is missing", or "Only videos with a .vib script". The session is also saved as
`.vib.funscript`/`.vib2.funscript`. Commands are only sent on changes (max ~10/s), so Bluetooth is not overloaded.
"Vib strength" scales all vibrators.

**Temperature:** With the Handy connected directly, the motor temperature is shown (read every 5 s while
playing). 10 °C below the limit a warning is shown. Above the limit (default 70 °C, can be set to 50–74 °C) the
app pauses and blocks ▶ until the motor is 8 °C below the limit. It does not restart by itself. The Handy also has
its own built-in protection at 75 °C.

**Favourites and never use:** ★ on a video makes it preferred in sessions, 👎 means it is never used.
"Favourites only" builds sessions from ★ videos only.

**Clips in the session:** Below the player all clips in the open session are shown with picture, title, speed and
length. The active clip is marked; click to jump to a clip. Hover a clip to preview exactly that clip (muted).
Rename the session with ✎ (or double-click the name) – also from the list of saved sessions. The saved files in
`sessions\` get the same new name.

**Surprise me:** 🎲 next to "Build session" builds a session with a random course, speed and (sometimes)
category, with the chosen length. "Surprises ⚡" (under More settings) gives 2–4 unexpected turns per 20 min:
⚡ a short burst (+40%), ⏸ a sudden pause or 🔥 an extra edge (up and then stop). They are shown on the clip cards.

**Sound cues:** 🔔 at the player. Short, discreet sounds (made in the browser, nothing to download): a bell at the
start/end of the warm-up, a swoosh up/down on tempo changes, a deep tone at a pause, a "zap" on a burst, a rising
tone on an edge, a gong at the finale, two ticks at the last minute and a blip on ▲▼. At most every 4 s
(important ones 1.5 s). Volume and 🔊 test under Devices → Adjustment.

**Voice from Home Assistant:** Under Adjustment → Cues, "Voice (Home Assistant)" can be chosen. Make the lines in
`stemme-tekster.txt` with HA's TTS (e.g. Christel); HA saves them as mp3 with the text as the title. Enter HA's
tts folder (e.g. `\\<ha>\config\tts`) and press "Get voices": the app reads the titles, copies the matching files
to its cache (the HA folder is only read) and uses them from then on. Lines without a recording fall back to the
sound cue. Danish only.

**Live steering:** While playing, ▲ (or arrow up) picks faster and ▼ (arrow down) calmer upcoming clips (±15%
per press), and ⏹ replaces the rest with about 2 min of finale. The clip playing now continues undisturbed; the
Handy gets the new script in the background. The change is saved in the session.

**Learns what you like:** Clips you watch to the end count positively; clips you skip (⏭ before half way), swap
or remove count negatively. Sessions then prefer the videos you like (♥ in the grid, sort "Liked most (learned)")
and avoid the parts you skipped. It weighs less than ★, recent actions count most, and "Forget what was learned"
in the grid resets it.

**Warm-up:** "Warm-up (video only)" (0–10 min) puts calm clips before the session, where the Handy holds still and
vibrators are off; then it glides into the session. The countdown is shown at the player, and the warm-up is
marked blue on the timeline. It is kept when editing and with "Build similar".

**Build similar:** "🔁 Build similar" (next to the session's name or in the list) makes a new session with exactly
the same settings and video selection, but new clips – the previous session's parts are avoided.

**Edit clips:** Hover a clip: 🔄 swaps it with another part of a video with the same speed and length (preferably
a video not already in the session – press again for a new suggestion), ✕ removes it. Drag a clip to move it. The
stroke and vib scripts are rebuilt with the session's settings, and the saved files in `sessions\` are updated.

**Even volume:** The server measures the loudness of each video in the background (ffmpeg, 4 samples of 20 s;
about 5 min for 330 videos the first time, then only new/changed ones). While playing, each video is turned up or
down towards the library's median (at most +18/−15 dB), with a gentle compressor and a limiter against
distortion. The ≋ button next to the volume turns it on/off; the tooltip shows the correction for the video.

**Continue where you left off:** The position is saved in the database every 5 s while playing and on pause. The
next time the app opens, "Continue … from 7:32" is offered. Finished sessions are not offered.

**Script check:** Scan finds scripts that end at least 1 min before the video, are longer than the video, have
pauses of 1½ min or more, or have extremely fast parts (over 800 u/s). They are marked with ⚠ (hover for
details), can be sorted to the top of the grid, and sessions avoid parts with extreme speed or a lot of stillness.

**Preview:** Hover a card in the grid – the video plays muted and jumps through four places; a white marker on the
speed curve shows where.

**⭐ Favourite spots:** Press ⭐ or B (or ⭐ on the phone) while something you like is playing. Sessions then pick
that part of the video more often (and videos with ⭐ a little more often). Can be undone.

**∞ Endless:** With ∞ on, a similar session with new clips is built 1½ minutes before the end, and it takes over
when the old one ends, so it just goes on until you stop.

**🎯 Edge game:** 🎯 next to "Build session" builds a build-up session. Press "😮 Close" (E, or on the phone) when
you are close: the devices pause (20 s, a little longer each time), the next clips are picked calmer, and then it
builds up again. At the end you see how many times and how long you held out.

**📊 Statistics and backup:** Played time (in total and the last 7 days), sessions, most used videos and
categories, how many clips you watch to the end, ⭐ spots and edge games. "💾 Save backup" saves everything you
made and chose (set-ups too) in one file; "📂 Restore backup" merges it with what is here, without deleting
anything. Handy keys are not included in the backup.

**Saved set-ups:** "＋ Save set-up" above "Build session" saves your choices (length, course, speed, categories,
warm-up, surprises and so on) as a button; one press sets them and builds.

**Undo:** 👎, deleting a session and "Forget what was learned" show a message at the bottom with "Undo" for 6
seconds instead of a popup. Deletions only happen when the message goes away.

**Connect automatically:** The Handy and Intiface connect by themselves when the app opens if they were connected
last time. "Disconnect" turns that off again.

**Help:** ? at the top (or the ? key) shows all keyboard shortcuts and what the buttons do.

**Play on a TV (Samsung and others):** Press Win+K on the PC and choose the TV (Screen mirroring), and use ⛶
fullscreen. Turn on "📺 Mirroring to TV" under Adjustment: the picture shows up a little later on the TV, so the
Handy and vibrators wait as much (starts at −250 ms, can be set from −1500 to +500 ms). The TV and the PC each
remember their own delay.
"🎯 Calibrate delay" shows a circle that flashes and clicks every second while the Handy hits the bottom on the
flash (vibrators give a pulse). Drag the slider (or ← →) until they match, and press Save.

**Remote control from the phone:** Turn on "📱 Control from phone" under Devices, and open the link on the phone
(same wifi). It has play/pause, previous/next, ✋ hold still (the devices stop, the video plays on – also H on the
keyboard), ▼▲⏹, tempo and volume. The remote runs on port 8001 and can only control playback, and only with the
key in the link; the rest of the app can still only be reached from the PC itself. "New link" makes a new key.
The first time, Windows Firewall asks: allow Python on private networks.

**Edit metadata:** ✎ on a picture in the big overview opens an editor for title, actors, genres, studio and year.
The edits are stored in the app's database and survive a new scan; the .nfo files are never changed.
"Reset to .nfo" removes the edits again.

**Big overview:** "⊞ Show big pictures" opens a grid with big pictures, titles, actors and year from the Jellyfin
`.nfo` files. Search title/actor/genre/studio, filter by genre, actor and category, sort (name, favourites,
speed, length, least played), and click a picture to select it for sessions or not. ★/👎 can be set directly on
the card. Esc closes.

**Thumbnails:** Shown in the library. They are made once with ffmpeg from the video's own poster
(`<name>-poster.jpg`, `folder.jpg` and so on) or a frame from the video, and stored in the local cache
(`...\FunscriptSession\thumbs`). The library is not touched.

**Tempo:** The slider at the player (50–150%, or `[` and `]`) changes the tempo of both the video and the Handy.

**Max speed:** Avoids parts above the limit and shortens strokes that are too fast, so no stroke in the session
goes over it. Note that a tempo over 100% makes the strokes faster again.

**Stroke range:** Under Adjustment, limits how far the Handy moves (e.g. 20–80). It is remembered.

**Courses:** Constant, Build-up, Waves, Edging (three build-ups with pauses) and Finale (calm, then a fast last
part), plus The whole ride (Build-up → Waves → Edging → Finale in one session: 25% / 25% / 30% / 20%). A shorter
time per video gives smoother curves.

Shortcuts: space = play/pause, ←/→ = 10 s, N = next clip, ↑/↓ = harder/calmer, F = fullscreen, H = hold still,
B = mark a spot, E = close (edge game), `[`/`]` = tempo, ? = help. Click the video = play/pause, double-click =
fullscreen. In fullscreen a control bar is shown when the mouse moves.

## 📺 Watch sessions on a TV (TvFin)

Saved sessions can be played on a Samsung TV with [TvFin](https://github.com/Tntdruid/TvFin) (the Jellyfin app for
Tizen). The TV plays the clips one after another and drives the Handy directly (Handy API v3, HSSP).

1. Turn on **📱 Remote → Control from phone**. Below it is the address the TV needs (e.g. `192.168.1.20:8001`).
2. On the TV: **⚙ Settings → Connect Funscript**. The TV searches the network by itself and shows the PC – pick it
   (or type the address if it is not found). The TV shows a code.
3. On the PC, **"📺 A TV wants to connect · code 1234"** pops up at the bottom right. Check that the code matches
   and press **Allow**. With "Send the Handy set-up along" the TV gets your Application ID and connection key, so
   they don't have to be typed on the TV.
4. The TV now shows the sessions (🎬 Funscript on the home screen). Remote: ◀ ▶ seek 10 s, ▲ next clip,
   ▼ previous clip, OK pause, Back stop.
5. The TV reports back to the app: the session counts as played, the played time shows up in 📊 Statistics, and
   the position is saved. If you stop in the middle of a session, **▶ Continue «name» from …** is shown at the top
   of the TV's Funscript screen – and "Continue" on the PC offers the same place (and the other way round).

Security: only the remote server (port 8001) can be reached from the network. The TV only gets the key when you
press Allow on the PC, and can then only *read* sessions and stream their videos (`/tv/...`) – plus report played,
played time and position back. "New link" makes a new key, so the TV (and the phone) have to connect again.

## Language

The app is available in Danish and English – switch with **DA/EN** at the top left (the choice is remembered; the
first time the browser's language is used). All texts are written in Danish in the code; `web/i18n.js` has the
English dictionary, so a new text must be added there too. The server's error messages and new session names
follow the chosen language.

## Files

- `server.py` – HTTP server, API and video streaming (with Range/seek)
- `funlib.py` – scanning, analysis, database and session builder
- `remote.py` – the remote and TV server (port 8001)
- `beatgen.py` – beat and vib scripts from music (optional, needs librosa)
- `web/` – frontend (vanilla HTML/CSS/JS)

Environment variables: `FUNSCRIPT_DB` (path to the database), `FUNSCRIPT_PORT` (default 8000),
`FUNSCRIPT_REMOTE_PORT` (default 8001), `FUNSCRIPT_GENERATED` (folder for generated scripts).

See [CHANGELOG.md](CHANGELOG.md) for changes.
