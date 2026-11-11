"""Library scanning, funscript analysis, SQLite storage and session building."""
import json
import math
import os
import random
import re
import shutil
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv"}
BROWSER_PLAYABLE = {".mp4", ".m4v", ".mov", ".mkv", ".webm"}
WINDOW_MS = 5000          # speed is measured in 5 second windows
MIN_CLIP_MS = 20000       # never make clips shorter than this (except a very short library)
AUTO_MIN_CLIP_MS = 60000  # "auto" clip length never goes below a minute per video
BRIDGE_MS = 600           # smooth glide between clips in the combined script
SPEED_TOLERANCE = 0.3   # clips further than ±30% from the target speed are a last resort

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    extension TEXT,
    size INTEGER,
    video_mtime REAL,
    duration_ms INTEGER,
    container TEXT,
    script_path TEXT,
    script_mtime REAL,
    action_count INTEGER DEFAULT 0,
    avg_speed REAL,
    speeds TEXT,
    play_count INTEGER DEFAULT 0,
    last_played REAL,
    scanned_at REAL,
    rating INTEGER DEFAULT 0,
    vib_path TEXT,
    vib2_path TEXT,
    meta TEXT,
    issues TEXT,
    audio_db REAL,
    amps TEXT
);
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    start_ms INTEGER,
    end_ms INTEGER,
    kind TEXT NOT NULL,
    score REAL NOT NULL,
    at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at REAL NOT NULL,
    total_ms INTEGER NOT NULL,
    params TEXT,
    clips TEXT NOT NULL,
    actions TEXT NOT NULL,
    play_count INTEGER DEFAULT 0,
    vib TEXT
);
"""


# ---------------------------------------------------------------- funscript

def parse_funscript(path):
    """Return validated, sorted [(at_ms, pos)] from a .funscript file."""
    with open(path, "r", encoding="utf-8-sig") as fh:
        raw = json.load(fh)
    actions = []
    for action in raw.get("actions", []) if isinstance(raw, dict) else []:
        try:
            at = int(round(float(action["at"])))
            pos = max(0, min(100, int(round(float(action["pos"])))))
        except (KeyError, TypeError, ValueError):
            continue
        if at >= 0:
            actions.append((at, pos))
    actions.sort()
    # drop duplicate timestamps (keep the last one)
    deduped = []
    for at, pos in actions:
        if deduped and deduped[-1][0] == at:
            deduped[-1] = (at, pos)
        else:
            deduped.append((at, pos))
    return deduped


def window_speeds(actions, duration_ms):
    """Average speed (pos units per second) for each WINDOW_MS window."""
    count = max(1, math.ceil(duration_ms / WINDOW_MS))
    movement = [0.0] * count
    for (a0, p0), (a1, p1) in zip(actions, actions[1:]):
        dist = abs(p1 - p0)
        if a1 <= a0 or dist == 0:
            continue
        t = a0
        while t < a1:
            w = int(t // WINDOW_MS)
            if w >= count:
                break
            w_end = min((w + 1) * WINDOW_MS, a1)
            movement[w] += dist * (w_end - t) / (a1 - a0)
            t = w_end
    speeds = []
    for i, moved in enumerate(movement):
        length = min(WINDOW_MS, duration_ms - i * WINDOW_MS) if duration_ms else WINDOW_MS
        speeds.append(round(moved / max(length / 1000.0, 0.5), 1))
    return speeds


SUSPECT_SPEED = 800        # u/s - far beyond normal Handy scripts (median peak ~480), usually an error
GAP_MS = 90000             # a pause this long is worth mentioning (short JOI breaks are normal)


def check_script(actions, duration_ms, speeds):
    """Problems worth knowing about, as codes the browser translates:
    ends_early / longer (script and video length disagree), gap (long pause), fast (extreme speed)."""
    if len(actions) < 2:
        return []
    issues = []
    last = actions[-1][0]
    if duration_ms and last < duration_ms - 60000 and last < duration_ms * 0.9:
        issues.append({"code": "ends_early", "sec": round((duration_ms - last) / 1000)})
    if duration_ms and last > duration_ms + 5000:
        issues.append({"code": "longer", "sec": round((last - duration_ms) / 1000)})
    first_w, last_w = int(actions[0][0] // WINDOW_MS), int(last // WINDOW_MS)
    run, best, best_at = 0, 0, 0
    for i in range(first_w, min(last_w, len(speeds))):
        run = run + 1 if speeds[i] == 0 else 0
        if run > best:
            best, best_at = run, (i - run + 1) * WINDOW_MS
    if best * WINDOW_MS >= GAP_MS:
        issues.append({"code": "gap", "sec": best * WINDOW_MS // 1000, "at": best_at // 1000})
    fastest = max(speeds) if speeds else 0
    if fastest > SUSPECT_SPEED:
        issues.append({"code": "fast", "max": round(fastest)})
    return issues


def window_amps(actions, duration_ms):
    """Average stroke length (pos units) per WINDOW_MS window; 0 where nothing moves.
    Two clips at the same speed can feel very different: short fast strokes vs long slow ones."""
    count = max(1, math.ceil(duration_ms / WINDOW_MS))
    total, strokes = [0.0] * count, [0] * count
    for (a0, p0), (a1, p1) in zip(actions, actions[1:]):
        length = abs(p1 - p0)
        if length < 5 or a1 <= a0:
            continue
        w = int(a0 // WINDOW_MS)
        if w < count:
            total[w] += length
            strokes[w] += 1
    return [round(t / n, 1) if n else 0 for t, n in zip(total, strokes)]


def average_speed(actions):
    if len(actions) < 2:
        return 0.0
    moved = sum(abs(b[1] - a[1]) for a, b in zip(actions, actions[1:]))
    span = (actions[-1][0] - actions[0][0]) / 1000.0
    return round(moved / span, 1) if span > 0 else 0.0


def interpolate(actions, at):
    """Script position at time `at` (ms), holding the edges."""
    if not actions:
        return 50
    if at <= actions[0][0]:
        return actions[0][1]
    if at >= actions[-1][0]:
        return actions[-1][1]
    lo, hi = 0, len(actions) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if actions[mid][0] <= at:
            lo = mid
        else:
            hi = mid
    (a0, p0), (a1, p1) = actions[lo], actions[hi]
    return int(round(p0 + (p1 - p0) * (at - a0) / max(1, a1 - a0)))


# ---------------------------------------------------------------- media probing

_FFPROBE = shutil.which("ffprobe")


def probe_media(path):
    """(duration_ms, container) via ffprobe, or (None, None) when unavailable."""
    if not _FFPROBE:
        return None, None
    try:
        result = subprocess.run(
            [_FFPROBE, "-v", "error", "-show_entries", "format=duration,format_name",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        fmt = json.loads(result.stdout or "{}").get("format", {})
        duration = fmt.get("duration")
        return (int(float(duration) * 1000) if duration else None), fmt.get("format_name")
    except (ValueError, OSError, subprocess.SubprocessError):
        return None, None


def browser_playable(extension, container, remuxed=False):
    # MPEG-TS streams are sometimes saved as .mp4; browsers can't play those unless remuxed.
    if remuxed:
        return True
    return extension in BROWSER_PLAYABLE and "mpegts" not in (container or "")


def needs_remux(container):
    return "mpegts" in (container or "")


# ---------------------------------------------------------------- remux cache
#
# MPEG-TS files are copied (never re-encoded) into a real mp4 in a local cache folder.
# The source files are only ever read; all output goes to REMUX_DIR.

_FFMPEG = shutil.which("ffmpeg")
REMUX_DIR = Path(os.environ.get("FUNSCRIPT_CACHE")
                 or Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "FunscriptSession" / "cache")


def remux_dir():
    """The cache folder as seen by other programs. Microsoft Store Python silently redirects
    writes under AppData to its package folder, which ffmpeg can't see; realpath undoes that."""
    REMUX_DIR.mkdir(parents=True, exist_ok=True)
    return Path(os.path.realpath(REMUX_DIR))


def remux_path(video_id):
    return remux_dir() / f"{int(video_id)}.mp4"


def remux_cached(video_id, source_mtime=None):
    """Cached mp4 for a video, or None when missing or older than the source."""
    path = remux_path(video_id)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    if source_mtime and mtime < source_mtime:
        return None
    return path


def remux(source, video_id, duration_ms=0, progress=None):
    """Copy the streams of `source` into REMUX_DIR/<id>.mp4. Never writes next to `source`."""
    if not _FFMPEG:
        raise RuntimeError("ffmpeg blev ikke fundet i PATH")
    target = remux_path(video_id)
    partial = target.with_suffix(".part")
    source = Path(source).resolve()
    if partial.parent != remux_dir() or source.parent == partial.parent:
        raise RuntimeError("Ugyldig cache-sti")
    cmd = [_FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
           "-i", str(source), "-map", "0:v:0", "-map", "0:a?", "-dn", "-sn",
           "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart",
           "-f", "mp4", "-progress", "pipe:1", "-nostats", str(partial)]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    errors = []
    reader = threading.Thread(target=lambda: errors.extend(proc.stderr), daemon=True)
    reader.start()
    for line in proc.stdout:
        key, _, value = line.strip().partition("=")
        if key == "out_time_us" and progress and duration_ms and value.isdigit():
            progress(min(0.99, int(value) / 1000 / duration_ms))
    proc.wait()
    reader.join(5)
    if proc.returncode != 0 or not partial.is_file():
        partial.unlink(missing_ok=True)
        raise RuntimeError("".join(errors).strip()[-300:] or f"ffmpeg fejlede ({proc.returncode})")
    os.replace(partial, target)
    if progress:
        progress(1.0)
    return target


# ---------------------------------------------------------------- thumbnails
#
# Made once with ffmpeg into a local cache: from the video's own poster image when there is one
# (Jellyfin/Kodi style "<name>-poster.jpg", "folder.jpg", ...), otherwise from a video frame.
# Like the remux cache, the library is only read.

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
THUMB_HEIGHT = 420  # sharp enough for the large grid view
_THUMB_SLOTS = threading.Semaphore(2)  # at most two ffmpeg thumbnail jobs at a time


def thumb_dir():
    folder = REMUX_DIR.parent / "thumbs"
    folder.mkdir(parents=True, exist_ok=True)
    return Path(os.path.realpath(folder))


def find_image(video_path):
    """A poster/cover image belonging to the video, or None."""
    try:
        siblings = list(video_path.parent.iterdir())
    except OSError:
        return None
    images = {p.name.lower(): p for p in siblings if p.suffix.lower() in IMAGE_EXTENSIONS}
    stem = video_path.stem.lower()
    for suffix in ("-poster", "-thumb", "-cover", "", "-fanart", "-backdrop"):
        for ext in IMAGE_EXTENSIONS:
            if stem + suffix + ext in images:
                return images[stem + suffix + ext]
    # folder-level images only describe the video when it is alone in its folder
    if sum(p.suffix.lower() in VIDEO_EXTENSIONS for p in siblings) == 1:
        for name in ("poster", "folder", "cover", "thumb", "fanart", "backdrop"):
            for ext in IMAGE_EXTENSIONS:
                if name + ext in images:
                    return images[name + ext]
    return None


NO_AUDIO = -999.0  # stored when a video has no (audible) sound, so it isn't measured again


def measure_loudness(path, duration_ms, points=(0.2, 0.4, 0.6, 0.8), seconds=20):
    """Average loudness (mean volume, dB) of a video from a few short samples.

    Uses ffmpeg's volumedetect on `seconds` of audio at each point; the file is only read.
    Returns NO_AUDIO for silent or audio-less videos, None if ffmpeg can't be used."""
    if not _FFMPEG:
        return None
    if not duration_ms or duration_ms < seconds * 1000 * 3:
        points = (0.0,)
    levels = []
    for f in points:
        start = duration_ms / 1000 * f if duration_ms else 0
        cmd = [_FFMPEG, "-nostdin", "-hide_banner", "-ss", f"{start:.1f}", "-t", str(seconds),
               "-i", str(path), "-vn", "-sn", "-dn", "-af", "volumedetect", "-f", "null", "-"]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120,
                                    errors="replace",
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            continue
        m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", result.stderr)
        if m and float(m.group(1)) > -60:  # ignore silent stretches
            levels.append(float(m.group(1)))
    if not levels:
        return NO_AUDIO
    power = sum(10 ** (level / 10) for level in levels) / len(levels)
    return round(10 * math.log10(power), 1)


def make_thumbnail(video_id, video_path, duration_ms=0):
    target = thumb_dir() / f"{int(video_id)}_{THUMB_HEIGHT}.jpg"
    if target.is_file():
        return target
    if not _FFMPEG:
        return None
    with _THUMB_SLOTS:
        if target.is_file():
            return target
        image = find_image(video_path)
        if image:
            source = ["-i", str(image)]
        else:  # a frame a little into the video, past intros and black frames
            seek = max(5.0, min(60.0, duration_ms / 1000 * 0.1)) if duration_ms else 5.0
            source = ["-ss", f"{seek:.1f}", "-i", str(video_path)]
        partial = target.with_name(target.stem + ".part.jpg")
        cmd = [_FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *source,
               "-frames:v", "1", "-vf", f"scale=-2:'min({THUMB_HEIGHT},ih)'", "-q:v", "3", str(partial)]
        try:
            subprocess.run(cmd, capture_output=True, timeout=60,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            return None
        if not partial.is_file():
            return None
        os.replace(partial, target)
        return target


# Script variants that describe up/down strokes, in order of preference for a Handy.
STROKE_VARIANTS = ["handy", "", "stroke", "l0", "sleeve", "dildo"]


def _norm(name):
    """Loose name for fuzzy matching: lowercase, no resolution tags or punctuation."""
    name = re.sub(r"(?i)(\b|_)(\d{3,4}p|4k|uhd|hd)(\b|_)", " ", name)
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _split_script(name):
    """'Clip.handy.funscript' -> ('clip', 'handy'); 'Clip.funscript' -> ('clip', '')."""
    stem = name[: -len(".funscript")]
    base, dot, variant = stem.rpartition(".")
    variant = variant.lower()
    if dot and (variant in STROKE_VARIANTS or re.fullmatch(
            r"(vib|vip|roll|pitch|twist|surge|sway|lube|suck|valve|twinning|[rlv]\d)\d*", variant)):
        return base, variant
    return stem, ""


def find_script(video_path, siblings=None):
    """Find the stroke script for a video.

    1. same basename (preferring a .handy variant, ignoring .vib/.roll/... axes)
    2. same basename after loose normalisation (case, punctuation, '1080p' tags)
    3. the only video in its folder with exactly one stroke script
    """
    if siblings is None:
        siblings = list(video_path.parent.iterdir())
    scripts = []
    for p in siblings:
        if p.name.lower().endswith(".funscript"):
            base, variant = _split_script(p.name)
            if variant in STROKE_VARIANTS:
                scripts.append((p, base, variant))
    if not scripts:
        return None

    def best(candidates):
        candidates.sort(key=lambda c: STROKE_VARIANTS.index(c[2]))
        return candidates[0][0] if candidates else None

    stem = video_path.stem
    match = best([c for c in scripts if c[1].lower() == stem.lower()])
    if match:
        return match
    match = best([c for c in scripts if _norm(c[1]) and _norm(c[1]) == _norm(stem)])
    if match:
        return match

    videos_here = [p for p in siblings if p.suffix.lower() in VIDEO_EXTENSIONS]
    if len(videos_here) == 1 and len({c[1].lower() for c in scripts}) == 1:
        return best(scripts)
    return None


VIB_PRIMARY = ["vib", "vib0", "vip"]   # first motor ("vip" is a common typo)
VIB_SECONDARY = ["vib2", "vib1"]       # second motor, eg. Lovense Edge


def find_vib_scripts(video_path, siblings=None):
    """(primary, secondary) vibration scripts for a video, matched like find_script."""
    if siblings is None:
        siblings = list(video_path.parent.iterdir())
    scripts = []
    for p in siblings:
        if p.name.lower().endswith(".funscript"):
            base, variant = _split_script(p.name)
            if variant in VIB_PRIMARY or variant in VIB_SECONDARY:
                scripts.append((p, base, variant))
    if not scripts:
        return None, None

    stem = video_path.stem
    group = [c for c in scripts if c[1].lower() == stem.lower()]
    if not group:
        group = [c for c in scripts if _norm(c[1]) and _norm(c[1]) == _norm(stem)]
    if not group:
        videos_here = [p for p in siblings if p.suffix.lower() in VIDEO_EXTENSIONS]
        if len(videos_here) == 1 and len({c[1].lower() for c in scripts}) == 1:
            group = scripts
    by_variant = {c[2]: c[0] for c in group}
    primary = next((by_variant[v] for v in VIB_PRIMARY if v in by_variant), None)
    secondary = next((by_variant[v] for v in VIB_SECONDARY
                      if v in by_variant and by_variant[v] != primary), None)
    if primary is None:  # eg. only vib1+vib2
        primary, secondary = secondary, None
    return primary, secondary


def find_nfo(video_path, siblings):
    """Jellyfin/Kodi metadata: '<name>.nfo', or 'movie.nfo' when the video is alone in its folder."""
    by_name = {p.name.lower(): p for p in siblings if p.suffix.lower() == ".nfo"}
    match = by_name.get(video_path.stem.lower() + ".nfo")
    if not match and sum(p.suffix.lower() in VIDEO_EXTENSIONS for p in siblings) == 1:
        match = by_name.get("movie.nfo")
    return match


def parse_nfo(path):
    """Title, genres, actors, studio and year from a .nfo file (empty dict if unreadable)."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.parse(str(path)).getroot()
    except (OSError, ET.ParseError):
        return {}

    def text(tag):
        node = root.find(tag)
        return (node.text or "").strip() if node is not None and node.text else ""

    def unique(values):
        seen, out = set(), []
        for v in values:
            if v and v.lower() not in seen:
                seen.add(v.lower())
                out.append(v)
        return out

    actors = unique((a.findtext("name") or "").strip() for a in root.findall("actor"))
    genres = unique((g.text or "").strip() for g in root.findall("genre") + root.findall("tag"))
    return {
        "title": text("title"),
        "genres": [g for g in genres if g.lower() not in {a.lower() for a in actors}],
        "actors": actors,
        "studio": text("studio"),
        "year": text("year"),
    }


def derive_vib(actions, window_ms=500, full_speed=350.0):
    """Vibration intensity (0-100) from how fast a stroke script moves. Used for clips
    whose video has no .vib script."""
    if len(actions) < 2:
        return []
    start, end = actions[0][0], actions[-1][0]
    count = max(1, math.ceil((end - start) / window_ms))
    moved = [0.0] * count
    for (a0, p0), (a1, p1) in zip(actions, actions[1:]):
        if a1 <= a0 or p0 == p1:
            continue
        t = a0
        while t < a1:
            w = int((t - start) // window_ms)
            if w >= count:
                break
            w_end = min(start + (w + 1) * window_ms, a1)
            moved[w] += abs(p1 - p0) * (w_end - t) / (a1 - a0)
            t = w_end
    out = []
    for w, m in enumerate(moved):
        speed = m / (window_ms / 1000.0)
        out.append((start + w * window_ms, int(round(min(100.0, 100.0 * speed / full_speed)))))
    out.append((end, 0))
    return out


# ---------------------------------------------------------------- database

class Library:
    def __init__(self, db_path, default_folder):
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        columns = {r["name"] for r in self.conn.execute("PRAGMA table_info(videos)")}
        for column, kind in (("container", "TEXT"), ("rating", "INTEGER DEFAULT 0"),
                             ("vib_path", "TEXT"), ("vib2_path", "TEXT"), ("meta", "TEXT"),
                             ("issues", "TEXT"), ("audio_db", "REAL"),
                             ("amps", "TEXT")):
            if column not in columns:  # added after the first release
                self.conn.execute(f"ALTER TABLE videos ADD COLUMN {column} {kind}")
        if "vib" not in {r["name"] for r in self.conn.execute("PRAGMA table_info(sessions)")}:
            self.conn.execute("ALTER TABLE sessions ADD COLUMN vib TEXT")
        self.conn.commit()
        self.default_folder = str(default_folder)
        self.default_export = str(Path(db_path).resolve().parent / "sessions")
        self.scan_state = {"running": False, "done": 0, "total": 0, "message": ""}
        self.audio_state = {"running": False, "done": 0, "total": 0}
        self.remux_state = {"running": False, "done": 0, "total": 0, "current": "",
                            "progress": 0.0, "failed": [], "error": ""}

    # settings
    def get_setting(self, key, default=None):
        with self.lock:
            row = self.conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def set_setting(self, key, value):
        with self.lock, self.conn:
            self.conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))

    def library_folder(self):
        return self.get_setting("library_path", self.default_folder)

    # scanning
    def scan(self, folder=None):
        folder = Path(folder or self.library_folder()).expanduser()
        if not folder.is_dir():
            raise ValueError(f"Mappen findes ikke: {folder}")
        files = sorted(p for p in folder.rglob("*")
                       if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS)
        self.scan_state = {"running": True, "done": 0, "total": len(files), "message": ""}
        seen = set()
        added = updated = 0
        try:
            for path in files:
                key = str(path)
                seen.add(key)
                changed = self._scan_one(path)
                added += changed == "added"
                updated += changed == "updated"
                self.scan_state["done"] += 1
            with self.lock, self.conn:
                rows = self.conn.execute("SELECT id, path FROM videos").fetchall()
                removed = [r["id"] for r in rows if r["path"] not in seen]
                self.conn.executemany("DELETE FROM videos WHERE id=?", [(i,) for i in removed])
        finally:
            self.scan_state["running"] = False
        summary = {"folder": str(folder), "found": len(files), "added": added,
                   "updated": updated, "removed": len(removed)}
        self.scan_state["message"] = json.dumps(summary)
        return summary

    def _scan_one(self, path):
        stat = path.stat()
        siblings = list(path.parent.iterdir())
        script = find_script(path, siblings)
        script_mtime = script.stat().st_mtime if script else None
        vib, vib2 = find_vib_scripts(path, siblings)
        vib_paths = (str(vib) if vib else None, str(vib2) if vib2 else None)
        nfo = find_nfo(path, siblings)
        meta = json.dumps(parse_nfo(nfo) if nfo else {}, ensure_ascii=False)
        with self.lock:
            row = self.conn.execute("SELECT * FROM videos WHERE path=?", (str(path),)).fetchone()
        video_unchanged = bool(row and row["video_mtime"] == stat.st_mtime and row["container"])
        if (video_unchanged and row["size"] == stat.st_size
                and row["script_path"] == (str(script) if script else None)
                and row["script_mtime"] == script_mtime
                and row["issues"] is not None and row["amps"] is not None):  # rows from before the script check get one now
            if (row["vib_path"], row["vib2_path"], row["meta"]) != (*vib_paths, meta):
                with self.lock, self.conn:
                    self.conn.execute("UPDATE videos SET vib_path=?, vib2_path=?, meta=? WHERE id=?",
                                      (*vib_paths, meta, row["id"]))
                return "updated"
            return "unchanged"

        if video_unchanged:
            duration, container = row["duration_ms"], row["container"]
        else:
            duration, container = probe_media(path)

        actions = []
        if script:
            try:
                actions = parse_funscript(script)
            except (OSError, ValueError):
                actions = []
        if not duration:
            duration = actions[-1][0] if actions else 0

        speeds = window_speeds(actions, duration) if actions and duration else []
        amps = window_amps(actions, duration) if actions and duration else []
        values = dict(
            path=str(path), name=path.stem, extension=path.suffix.lower(), size=stat.st_size,
            video_mtime=stat.st_mtime, duration_ms=duration, container=container,
            script_path=str(script) if script else None, script_mtime=script_mtime,
            action_count=len(actions), avg_speed=average_speed(actions),
            speeds=json.dumps(speeds), amps=json.dumps(amps), scanned_at=time.time(),
            vib_path=vib_paths[0], vib2_path=vib_paths[1], meta=meta,
            issues=json.dumps(check_script(actions, duration, speeds)),
        )
        if not video_unchanged:
            values["audio_db"] = None
        with self.lock, self.conn:
            if row:
                sets = ", ".join(f"{k}=:{k}" for k in values)
                self.conn.execute(f"UPDATE videos SET {sets} WHERE id=:id", {**values, "id": row["id"]})
                return "updated"
            cols = ", ".join(values)
            self.conn.execute(
                f"INSERT INTO videos({cols}) VALUES({', '.join(':' + k for k in values)})", values)
            return "added"

    # queries
    def videos(self):
        with self.lock:
            rows = self.conn.execute("SELECT * FROM videos ORDER BY name COLLATE NOCASE").fetchall()
        root = Path(self.library_folder())
        videos = [self._with_category(self._video_dict(r), root) for r in rows]
        taste = self.taste()
        for v in videos:
            v["taste"] = round(taste.get(v["id"], {}).get("score", 0.0), 2)
        # A top-level folder holding a single video is that video's own folder, not a category.
        sizes = {}
        for v in videos:
            sizes[v["category"]] = sizes.get(v["category"], 0) + 1
        for v in videos:
            if sizes[v["category"]] == 1:
                v["category"] = "Løse filer"
        return videos

    def video(self, video_id):
        with self.lock:
            row = self.conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()
        return self._with_category(self._video_dict(row), Path(self.library_folder())) if row else None

    @staticmethod
    def _with_category(video, root):
        """Category = the top-level folder inside the library (X:\\Handy\\Anal\\... -> 'Anal')."""
        try:
            parts = Path(video["path"]).relative_to(root).parts
            video["category"] = parts[0] if len(parts) > 1 else "Løse filer"
        except ValueError:
            video["category"] = "Andet"
        return video

    @staticmethod
    def _video_dict(row):
        remuxed = needs_remux(row["container"]) and bool(remux_cached(row["id"], row["video_mtime"]))
        return {
            "id": row["id"], "name": row["name"], "path": row["path"],
            "extension": row["extension"], "size": row["size"],
            "durationMs": row["duration_ms"] or 0,
            "hasScript": bool(row["script_path"]) and row["action_count"] > 1,
            "scriptPath": row["script_path"], "actionCount": row["action_count"],
            "avgSpeed": row["avg_speed"] or 0, "speeds": json.loads(row["speeds"] or "[]"),
            "amps": json.loads(row["amps"] or "[]"),
            "playable": browser_playable(row["extension"], row["container"], remuxed),
            "container": row["container"],
            "needsRemux": needs_remux(row["container"]) and not remuxed, "remuxed": remuxed,
            "playCount": row["play_count"] or 0, "lastPlayed": row["last_played"],
            "rating": row["rating"] or 0,
            "hasVib": bool(row["vib_path"]), "hasVib2": bool(row["vib2_path"]),
            **Library._meta_fields(row["meta"], row["name"]),
            "issues": json.loads(row["issues"] or "[]"),
            "loudness": row["audio_db"] if row["audio_db"] is not None and row["audio_db"] > NO_AUDIO else None,
        }

    @staticmethod
    def _meta_fields(raw, fallback_title):
        meta = json.loads(raw) if raw else {}
        return {
            "title": meta.get("title") or fallback_title,
            "genres": meta.get("genres", []), "actors": meta.get("actors", []),
            "studio": meta.get("studio", ""), "year": meta.get("year", ""),
        }

    def vib_actions(self, video_id):
        """(primary, secondary) original vibration scripts of a video; empty lists if none."""
        with self.lock:
            row = self.conn.execute(
                "SELECT vib_path, vib2_path FROM videos WHERE id=?", (video_id,)).fetchone()
        result = []
        for path in (row["vib_path"], row["vib2_path"]) if row else (None, None):
            try:
                result.append(parse_funscript(path) if path else [])
            except (OSError, ValueError):
                result.append([])
        return tuple(result)

    def measure_audio_all(self, workers=3):
        """Measure the loudness of every playable video that hasn't been measured yet."""
        from concurrent.futures import ThreadPoolExecutor
        with self.lock:
            rows = self.conn.execute(
                "SELECT id, path, extension, duration_ms FROM videos WHERE audio_db IS NULL").fetchall()
        todo = [r for r in rows if r["extension"] in BROWSER_PLAYABLE]
        self.audio_state = {"running": True, "done": 0, "total": len(todo)}

        def one(row):
            level = measure_loudness(row["path"], row["duration_ms"] or 0)
            if level is not None:
                with self.lock, self.conn:
                    self.conn.execute("UPDATE videos SET audio_db=? WHERE id=?", (level, row["id"]))
            self.audio_state["done"] += 1

        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                list(pool.map(one, todo))
        finally:
            self.audio_state["running"] = False

    # learning from what the user does
    FEEDBACK_SCORES = {"complete": 1.0, "skip": -1.0, "swap": -1.0, "remove": -1.5}

    def add_feedback(self, video_id, start_ms, end_ms, kind):
        score = self.FEEDBACK_SCORES.get(kind)
        if score is None:
            raise ValueError("Ukendt feedback")
        with self.lock, self.conn:
            self.conn.execute(
                "INSERT INTO feedback(video_id, start_ms, end_ms, kind, score, at) "
                "VALUES(?, ?, ?, ?, ?, ?)",
                (int(video_id), int(start_ms), int(end_ms), kind, score, time.time()))

    def taste(self):
        """What the user seems to like, per video: score -1..1 (watched to the end vs skipped,
        swapped or removed; recent events count most) and the parts to avoid."""
        with self.lock:
            rows = self.conn.execute(
                "SELECT video_id, start_ms, end_ms, score, at FROM feedback").fetchall()
        now = time.time()
        totals, avoid = {}, {}
        for r in rows:
            weight = 0.5 ** ((now - r["at"]) / (90 * 86400))  # half weight after ~3 months
            totals[r["video_id"]] = totals.get(r["video_id"], 0.0) + r["score"] * weight
            if r["score"] < 0 and r["end_ms"] and r["end_ms"] > r["start_ms"]:
                avoid.setdefault(r["video_id"], []).append((r["start_ms"], r["end_ms"]))
        return {vid: {"score": max(-1.0, min(1.0, total / 5)), "avoid": avoid.get(vid, [])}
                for vid, total in totals.items()} |                {vid: {"score": 0.0, "avoid": parts} for vid, parts in avoid.items() if vid not in totals}

    def reset_taste(self):
        with self.lock, self.conn:
            self.conn.execute("DELETE FROM feedback")

    def set_rating(self, video_id, rating):
        """1 = favourite, -1 = never use in sessions, 0 = neutral."""
        rating = max(-1, min(1, int(rating)))
        with self.lock, self.conn:
            self.conn.execute("UPDATE videos SET rating=? WHERE id=?", (rating, video_id))
        return rating

    def thumbnail(self, video_id):
        """Small cached thumbnail for a video (made on first request), or None."""
        video = self.video(video_id)
        if not video:
            return None
        return make_thumbnail(video["id"], Path(video["path"]), video["durationMs"])

    def media_path(self, video_id):
        """File to serve for a video: the remuxed cache copy when there is one."""
        with self.lock:
            row = self.conn.execute(
                "SELECT path, container, video_mtime FROM videos WHERE id=?", (video_id,)).fetchone()
        if not row:
            return None
        if needs_remux(row["container"]):
            cached = remux_cached(video_id, row["video_mtime"])
            if cached:
                return cached
        return Path(row["path"])

    def remux_pending(self, video_ids=None):
        videos = [v for v in self.videos() if v["needsRemux"]]
        if video_ids:
            wanted = {int(i) for i in video_ids}
            videos = [v for v in videos if v["id"] in wanted]
        return videos

    def remux_all(self, video_ids=None):
        """Remux every MPEG-TS video that has no cache copy yet (runs in a worker thread)."""
        videos = self.remux_pending(video_ids)
        state = {"running": True, "done": 0, "total": len(videos), "current": "",
                 "progress": 0.0, "failed": [], "error": ""}
        self.remux_state = state
        try:
            for v in videos:
                state.update(current=v["name"], progress=0.0)
                try:
                    remux(v["path"], v["id"], v["durationMs"],
                          progress=lambda f: state.update(progress=round(f, 3)))
                except Exception as exc:  # keep going with the rest
                    state["failed"].append({"id": v["id"], "name": v["name"], "error": str(exc)})
                state["done"] += 1
        except Exception as exc:
            state["error"] = str(exc)
        finally:
            state.update(running=False, current="")

    def script_actions(self, video_id):
        video = self.video(video_id)
        if not video or not video["scriptPath"]:
            return []
        try:
            return parse_funscript(video["scriptPath"])
        except (OSError, ValueError):
            return []

    # sessions
    def save_session(self, session):
        with self.lock, self.conn:
            cur = self.conn.execute(
                "INSERT INTO sessions(name, created_at, total_ms, params, clips, actions, vib) "
                "VALUES(?, ?, ?, ?, ?, ?, ?)",
                (session["name"], time.time(), session["totalMs"], json.dumps(session["params"]),
                 json.dumps(session["clips"]), json.dumps(session["actions"]),
                 json.dumps({"vib": session.get("vib", []), "vib2": session.get("vib2", [])})))
        return self.session(cur.lastrowid)

    def sessions(self):
        with self.lock:
            rows = self.conn.execute(
                "SELECT id, name, created_at, total_ms, params, clips, play_count, vib "
                "FROM sessions ORDER BY created_at DESC").fetchall()
        items = [{
            "id": r["id"], "name": r["name"], "createdAt": r["created_at"],
            "totalMs": r["total_ms"], "params": json.loads(r["params"] or "{}"),
            "clipCount": len(json.loads(r["clips"])), "playCount": r["play_count"],
            # old sessions (no vib column yet) get a derived track when opened
            "hasVib": not r["vib"] or bool(json.loads(r["vib"]).get("vib")),
        } for r in rows]
        for item in items:
            path = self.export_folder() / session_filename(item)
            item["file"] = str(path) if path.exists() else None
        return items

    def session(self, session_id):
        with self.lock:
            r = self.conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not r:
            return None
        actions = json.loads(r["actions"])
        vib = json.loads(r["vib"]) if r["vib"] else None
        if not vib:  # sessions from before vibration support: derive from the strokes
            vib = {"vib": [{"at": at, "pos": pos} for at, pos in
                           derive_vib([(a["at"], a["pos"]) for a in actions])], "vib2": []}
        return {
            "id": r["id"], "name": r["name"], "createdAt": r["created_at"],
            "totalMs": r["total_ms"], "params": json.loads(r["params"] or "{}"),
            "clips": json.loads(r["clips"]), "actions": actions,
            "vib": vib["vib"], "vib2": vib["vib2"],
            "playCount": r["play_count"],
        }

    def update_session(self, session):
        """Store edited clips/tracks of an existing session and refresh its exported files."""
        with self.lock, self.conn:
            self.conn.execute(
                "UPDATE sessions SET total_ms=?, clips=?, actions=?, vib=? WHERE id=?",
                (session["totalMs"], json.dumps(session["clips"]), json.dumps(session["actions"]),
                 json.dumps({"vib": session.get("vib", []), "vib2": session.get("vib2", [])}),
                 session["id"]))
        saved = self.session(session["id"])
        try:
            saved["file"] = str(self.export_session(saved, overwrite=True))
        except OSError as exc:
            saved["exportError"] = str(exc)
        return saved

    def rename_session(self, session_id, name):
        """Rename a session and its exported files in the sessions folder (never overwrites)."""
        name = " ".join(str(name).split())[:120]
        session = self.session(session_id)
        if not session or not name:
            return None
        old_main = self.export_path(session)
        new_main = self.export_path({**session, "name": name})
        if old_main != new_main:
            old_stem, new_stem = old_main.name[:-10], new_main.name[:-10]  # strip ".funscript"
            for suffix in (".funscript", ".vib.funscript", ".vib2.funscript"):
                src = old_main.with_name(old_stem + suffix)
                dst = new_main.with_name(new_stem + suffix)
                if src.exists() and not dst.exists():
                    os.replace(src, dst)
        with self.lock, self.conn:
            self.conn.execute("UPDATE sessions SET name=? WHERE id=?", (name, session_id))
        return name

    def delete_session(self, session_id):
        # The exported .funscript file is left on disk on purpose; only the DB row goes.
        with self.lock, self.conn:
            self.conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))

    # exported .funscript files
    def export_folder(self):
        return Path(self.get_setting("export_path", self.default_export)).expanduser()

    def export_path(self, session):
        return self.export_folder() / session_filename(session)

    def export_session(self, session, overwrite=False):
        """Write the session's combined script as a .funscript file.

        Existing files are left alone, unless `overwrite` (used after the session's own clips
        were edited, so its files match the new content)."""
        path = self.export_path(session)
        if path.exists() and not overwrite:
            return path
        path.parent.mkdir(parents=True, exist_ok=True)
        tracks = [(path, session["actions"])]
        stem = path.name[: -len(".funscript")]
        vib2_file = path.with_name(stem + ".vib2.funscript")
        if session.get("vib"):  # vibration tracks next to it: "<name>.vib.funscript"
            tracks.append((path.with_name(stem + ".vib.funscript"), session["vib"]))
        if session.get("vib2"):
            tracks.append((vib2_file, session["vib2"]))
        elif overwrite and session.get("vib") and vib2_file.exists():
            tracks.append((vib2_file, session["vib"]))  # motor 2 now simply follows motor 1
        for target, actions in reversed(tracks):  # main file last: it marks "exported"
            if target.exists() and not overwrite:
                continue
            tmp = target.with_name(target.name + ".tmp")
            tmp.write_text(json.dumps(session_funscript(session, actions), ensure_ascii=False),
                           encoding="utf-8")
            tmp.replace(target)
        return path

    def export_missing(self):
        """Export every saved session that doesn't have a file in the export folder yet."""
        written = 0
        for item in self.sessions():
            if not self.export_path(item).exists():
                self.export_session(self.session(item["id"]))
                written += 1
        return written

    def mark_played(self, session_id):
        session = self.session(session_id)
        if not session:
            return False
        ids = {c["videoId"] for c in session["clips"]}
        now = time.time()
        with self.lock, self.conn:
            self.conn.execute("UPDATE sessions SET play_count=play_count+1 WHERE id=?", (session_id,))
            self.conn.executemany(
                "UPDATE videos SET play_count=play_count+1, last_played=? WHERE id=?",
                [(now, i) for i in ids])
        return True


# ---------------------------------------------------------------- session building

def session_filename(session):
    """'004 - 15 min · Opbygning · 216 u-s.funscript' (safe on Windows)."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", session["name"]).strip(" .") or "session"
    return f"{session['id']:03d} - {name}.funscript"


def session_funscript(session, actions=None):
    """A session track (strokes by default) in standard .funscript format."""
    clips = session.get("clips", [])
    notes = "\n".join(
        f"{i + 1}. {c['name']} ({c['startMs'] // 60000}:{c['startMs'] // 1000 % 60:02d}"
        f"-{c['endMs'] // 60000}:{c['endMs'] // 1000 % 60:02d}, {round(c['speed'])} u/s"
        + (f", vib {c['vib']}" if c.get("vib") else "") + ")"
        for i, c in enumerate(clips))
    return {
        "version": "1.0", "inverted": False, "range": 100,
        "metadata": {"title": session["name"], "duration": session["totalMs"] // 1000,
                     "description": notes, "notes": "Samlet af Funscript Session"},
        "actions": session["actions"] if actions is None else actions,
    }


def _edging(f):
    """Three build-ups that each end in a calm break."""
    cycle = (f * 3) % 1
    return 0.6 + 0.75 * cycle / 0.82 if cycle < 0.82 else 0.45


def _journey(f):
    """Build-up -> waves -> edging -> finale in one session."""
    if f < 0.25:                                  # build-up: 60% -> 100%
        return 0.6 + 0.4 * f / 0.25
    if f < 0.5:                                   # one wave around 100%
        return 1.0 + 0.25 * math.sin(2 * math.pi * (f - 0.25) / 0.25)
    if f < 0.8:                                   # two edges: climb to 125%, then a calm break
        cycle = ((f - 0.5) / 0.3 * 2) % 1
        return 0.7 + 0.55 * cycle / 0.75 if cycle < 0.75 else 0.45
    return 1.45                                   # finale


CURVES = {
    "constant": lambda f: 1.0,
    "ramp": lambda f: 0.65 + 0.6 * f,                          # build-up: 65% -> 125%
    "waves": lambda f: 1.0 + 0.3 * math.sin(2 * math.pi * 3 * f),  # three waves
    "edging": _edging,
    "finale": lambda f: 0.85 if f < 0.8 else 1.45,             # calm, then a fast last 20%
    "journey": lambda f: _journey(f),                         # all of the above, one after another
}
CURVE_LABELS = {"constant": "Konstant", "ramp": "Opbygning", "waves": "Bølger",
                "edging": "Edging", "finale": "Finale", "journey": "Hele turen"}
CURVE_LABELS_EN = {"constant": "Constant", "ramp": "Build-up", "waves": "Waves",
                   "edging": "Edging", "finale": "Finale", "journey": "Full journey"}


def _quality_penalty(window):
    """Steer clear of probably broken parts: extreme speeds and long stretches without motion."""
    if not window:
        return 0.0
    penalty = 1.0 if max(window) > SUSPECT_SPEED else 0.0
    still = sum(1 for s in window if s == 0) / len(window)
    if still > 0.3:
        penalty += still
    return penalty


def _mean_amp(amps):
    moving = [a for a in amps if a > 0]
    return sum(moving) / len(moving) if moving else 0.0


def _best_window(video, length_ms, target, used_ranges, max_speed=None, prev_amp=None):
    """Find the start of the clip in `video` whose speed best matches `target`.

    With `prev_amp` (stroke length of the previous clip) windows with a similar stroke
    length are preferred, so consecutive clips feel alike and not just move as fast."""
    speeds = video["speeds"]
    amps = video.get("amps") or []
    duration = video["durationMs"]
    if duration <= length_ms or len(speeds) <= 1:
        avg = sum(speeds) / len(speeds) if speeds else 0
        score = abs(avg - target) / target
        if max_speed and speeds and max(speeds) > max_speed:
            score += 3.0
        score += _quality_penalty(speeds)
        if duration < length_ms:
            score += 0.5 * (length_ms - duration) / length_ms
        score += 1.5 * len(used_ranges)
        if prev_amp and amps:
            score += 0.3 * abs(_mean_amp(amps) - prev_amp) / 100
        return 0, duration, avg, score

    k = max(1, min(len(speeds), math.ceil(length_ms / WINDOW_MS)))
    prefix, prefix_sq = [0.0], [0.0]
    for s in speeds:
        prefix.append(prefix[-1] + s)
        prefix_sq.append(prefix_sq[-1] + s * s)

    best = None
    last_start = (duration - length_ms) // WINDOW_MS
    for i in range(0, int(last_start) + 1):
        j = min(i + k, len(speeds))
        n = j - i
        avg = (prefix[j] - prefix[i]) / n
        var = max(0.0, (prefix_sq[j] - prefix_sq[i]) / n - avg * avg)
        start = i * WINDOW_MS
        end = min(start + length_ms, duration)
        # prefer matching speed, then steady speed, and avoid parts already used this session
        score = abs(avg - target) / target + 0.4 * math.sqrt(var) / target
        overlap = sum(max(0, min(end, e) - max(start, s)) for s, e in used_ranges)
        score += 1.5 * overlap / max(1, end - start)
        if max_speed and max(speeds[i:j]) > max_speed:
            score += 3.0                                     # avoid parts above the speed cap
        score += _quality_penalty(speeds[i:j])
        if prev_amp and amps:
            score += 0.3 * abs(_mean_amp(amps[i:j]) - prev_amp) / 100
        if duration > 3 * length_ms and (start < duration * 0.04 or end > duration * 0.96):
            score += 0.25                                    # intros and credits
        if best is None or score < best[3]:
            best = (start, end, avg, score)
    return best


SNAP_MS = 2500  # how far a clip edge may move to reach a natural cut point


def _cut_points(actions):
    """Times where a cut feels natural: stroke turning points and the start of pauses."""
    points = []
    for (a0, p0), (a1, p1), (a2, p2) in zip(actions, actions[1:], actions[2:]):
        if (p1 - p0) * (p2 - p1) < 0 or a2 - a1 > 800:
            points.append((a1, p1))
    return points


def snap_clip(actions, start, end, duration, prefer_pos=None, keep_end=False):
    """Move a clip's start/end (at most SNAP_MS) to natural cut points.

    The start prefers a point whose position is close to `prefer_pos` (where the previous
    clip ended), so the device barely has to move between clips."""
    points = _cut_points(actions)
    if not points:
        return start, end
    near_start = [(t, p) for t, p in points if abs(t - start) <= SNAP_MS and 0 <= t < end - MIN_CLIP_MS]
    if near_start:
        def cost(point):
            t, pos = point
            c = abs(t - start) / SNAP_MS
            if prefer_pos is not None:
                c += abs(pos - prefer_pos) / 50
            return c
        start = min(near_start, key=cost)[0]
    if not keep_end:
        near_end = [t for t, _ in points if abs(t - end) <= SNAP_MS and start + MIN_CLIP_MS < t <= duration]
        if near_end:
            end = min(near_end, key=lambda t: abs(t - end))
    return int(start), int(end)


def rebuild_session(session, clips, scripts, vib_scripts):
    """Re-lay `clips` end to end and rebuild the stroke and vibration tracks, with the
    session's original settings (smooth transitions, speed cap). Used after editing clips."""
    if not clips:
        raise ValueError("En session skal have mindst ét klip")
    params = session.get("params", {})
    laid, offset = [], 0
    for clip in clips:
        start, end = int(clip["startMs"]), int(clip["endMs"])
        if end <= start:
            raise ValueError("Ugyldigt klip")
        laid.append({**clip, "startMs": start, "endMs": end, "offsetMs": offset})
        offset += end - start
    if callable(scripts):
        scripts = {vid: scripts(vid) for vid in {c["videoId"] for c in laid}}
    actions, vib, vib2 = build_tracks(
        laid, scripts, params.get("smooth", True) is not False,
        float(params["maxSpeed"]) if params.get("maxSpeed") else None,
        params.get("vibMode", "derive"), vib_scripts)
    return {**session, "clips": laid, "actions": actions, "vib": vib, "vib2": vib2,
            "totalMs": offset}


def find_replacement(videos, session, index, seed=None, scripts=None, taste=None):
    """Another clip of the same length and similar speed to replace clip `index`, preferably
    from a video that isn't in the session yet. Never returns the clip it replaces."""
    clips = session["clips"]
    clip = clips[index]
    params = session.get("params", {})
    max_speed = float(params["maxSpeed"]) if params.get("maxSpeed") else None
    picker = ClipPicker(eligible_videos(videos, params.get("vibMode", "derive")),
                        scripts or {}, max_speed, seed, taste)
    for c in clips:
        picker.mark_used(c)
    picker.usage = {k: n * 3 for k, n in picker.usage.items()}  # really prefer something new
    target = clip.get("targetSpeed") or clip["speed"] or 100.0
    prev = clips[index - 1] if index > 0 else None
    new = picker.pick(clip["endMs"] - clip["startMs"], target, prev,
                      keep_end=index == len(clips) - 1, warmup=bool(clip.get("warmup")))
    new.pop("endPos", None)
    return new

def _same_content(v):
    """Versions of the same video (eg. "TV" and "Side by Side") share an identical script;
    treat them as one video so the same scene isn't picked twice."""
    return (round(v["avgSpeed"]), v["actionCount"], round(v["durationMs"] / 10000))


def _related(a, b):
    """Same category, or a shared genre/actor: makes the next clip feel like a follow-up."""
    if a.get("category") and a.get("category") == b.get("category"):
        return True
    shared = {x.lower() for x in a.get("genres", []) + a.get("actors", [])} & \
             {x.lower() for x in b.get("genres", []) + b.get("actors", [])} - {"handy"}
    return bool(shared)


def eligible_videos(videos, vib_mode="derive"):
    eligible = [v for v in videos if v["hasScript"] and v["playable"] and v["durationMs"] > 0
                and v.get("rating", 0) >= 0]
    if vib_mode == "only":
        eligible = [v for v in eligible if v.get("hasVib")]
        if not eligible:
            raise ValueError("Ingen af de valgte videoer har et .vib-script")
    if not eligible:
        raise ValueError("Ingen afspillelige videoer med funscript i biblioteket")
    return eligible


class ClipPicker:
    """Chooses clips one at a time: matching speed, similar stroke length, natural cut points,
    a related follow-up, and what the user has shown to like (`taste`). Used to build
    sessions and to re-pick the upcoming clips while one plays (live steering).

    `taste` maps video id -> {"score": -1..1, "avoid": [(start, end), ...]}: liked videos get
    a bonus, and parts the user skipped or swapped away count as already used."""

    def __init__(self, eligible, scripts, max_speed=None, seed=None, taste=None):
        self.eligible = eligible
        self.by_id = {v["id"]: v for v in eligible}
        self.scripts = scripts
        self.max_speed = max_speed
        self.rng = random.Random(seed)
        self.taste = taste or {}
        self.usage, self.used, self.cache = {}, {}, {}
        for vid, info in self.taste.items():
            if vid in self.by_id:
                self.used.setdefault(_same_content(self.by_id[vid]), []).extend(info.get("avoid", []))

    def actions_of(self, video_id):
        if video_id not in self.cache:
            self.cache[video_id] = (self.scripts(video_id) if callable(self.scripts)
                                    else (self.scripts or {}).get(video_id, []))
        return self.cache[video_id]

    def mark_used(self, clip, count=True):
        v = self.by_id.get(clip["videoId"])
        if not v:
            return
        key = _same_content(v)
        self.used.setdefault(key, []).append((clip["startMs"], clip["endMs"]))
        if count:
            self.usage[key] = self.usage.get(key, 0) + 1

    def pick(self, length, target, prev=None, keep_end=False, warmup=False):
        prev_video = self.by_id.get(prev["videoId"]) if prev else None
        prev_amp = prev.get("amp") if prev else None
        prev_pos = None
        if prev:
            prev_pos = prev.get("endPos")
            if prev_pos is None:
                prev_pos = interpolate(self.actions_of(prev["videoId"]), prev["endMs"])

        best = None
        for v in self.eligible:
            key = _same_content(v)
            start, end, avg, score = _best_window(v, length, target, self.used.get(key, []),
                                                  self.max_speed, prev_amp)
            if abs(avg - target) / target > SPEED_TOLERANCE:
                score += 2.0                                  # only if nothing else fits
            if v.get("rating", 0) > 0:
                score -= 0.12                                 # favourites first
            score -= 0.05 * self.taste.get(v["id"], {}).get("score", 0)  # learned: softer than ★
            if prev_video is not None and v["id"] != prev_video["id"] and _related(v, prev_video):
                score -= 0.05                                 # a natural follow-up
            score += 0.15 * self.usage.get(key, 0)            # spread over many videos
            score += 0.02 * min(v["playCount"], 10)           # favour less-played videos
            score += self.rng.random() * 0.08                 # variety between builds
            if best is None or score < best[0]:
                best = (score, v, start, end, avg)

        _, v, start, end, avg = best
        actions = self.actions_of(v["id"])
        start, end = snap_clip(actions, start, end, v["durationMs"], prefer_pos=prev_pos,
                               keep_end=keep_end)
        w0, w1 = start // WINDOW_MS, max(start // WINDOW_MS + 1, end // WINDOW_MS)
        clip = {
            "videoId": v["id"], "name": v["name"],
            "startMs": int(start), "endMs": int(end), "offsetMs": 0,
            "speed": round(avg, 1), "targetSpeed": round(target, 1),
            **({"warmup": True} if warmup else {}),
            "amp": round(_mean_amp((v.get("amps") or [])[w0:w1]), 1),
            "endPos": interpolate(actions, end),
        }
        self.mark_used(clip)
        return clip


def build_session(videos, total_ms, clip_ms=None, curve="constant", target=None,
                  seed=None, scripts=None, max_speed=None, smooth=True,
                  vib_scripts=None, vib_mode="derive", lang="da", avoid=None, warmup_ms=0,
                  taste=None, surprises=False):
    """Pick clips from `videos` so they add up to `total_ms` at a matching speed.

    `warmup_ms` adds a warm-up before the session: calm video clips while the device stays
    still (no script); the session itself starts after it.

    `scripts` maps video id -> [(at, pos)] (or is a function that loads them) and is used
    to assemble the combined script. `max_speed` (u/s) avoids faster parts and caps every
    stroke in the combined script. Videos rated -1 are never used, +1 are preferred.
    """
    eligible = eligible_videos(videos, vib_mode)
    if curve not in CURVES:
        curve = "constant"
    max_speed = float(max_speed) if max_speed else None

    if not target:
        speeds = sorted(v["avgSpeed"] for v in eligible)
        target = speeds[len(speeds) // 2]
    target = max(float(target), 10.0)
    if max_speed:
        target = min(target, max_speed * 0.85)

    if not clip_ms:
        clip_ms = max(total_ms / len(eligible), AUTO_MIN_CLIP_MS)
    min_clip = min(MIN_CLIP_MS, total_ms)
    clip_ms = int(max(min_clip, min(clip_ms, total_ms)))

    picker = ClipPicker(eligible, scripts, max_speed, seed, taste)
    # "build similar": treat the previous session's clips as already used, so new parts are picked
    for clip in avoid or []:
        picker.mark_used(clip, count=False)

    clips = []
    elapsed = 0
    warmup_ms = int(max(0, warmup_ms or 0))
    # "surprises": now and then the session swerves - a burst, a sudden pause or an extra edge
    surprise_rng = random.Random(f"{seed}-surprise")
    surprise = {"next": None, "cooldown": 2}

    def surprise_factor(progress):
        if surprise["next"]:                      # second half of an extra edge: stop
            kind, surprise["next"] = surprise["next"], None
            return kind, SURPRISES[kind]
        surprise["cooldown"] -= 1
        if surprise["cooldown"] > 0 or not 0.1 < progress < 0.85 or surprise_rng.random() > 0.4:
            return None, 1.0
        surprise["cooldown"] = 3
        kind = surprise_rng.choice(["burst", "pause", "edge"])
        if kind == "edge":
            surprise["next"] = "edge_stop"
        return kind, SURPRISES[kind]

    def fill(until, warmup):
        nonlocal elapsed
        span_start = elapsed
        kind = None
        while until - elapsed > 1000 and len(clips) < 500:
            remaining = until - elapsed
            length = min(clip_ms, remaining)
            if remaining - length < min(min_clip, until - span_start):
                length = remaining
            if warmup:  # calm-looking clips; the device doesn't move anyway
                clip_target = target * 0.6
            else:
                progress = (elapsed - warmup_ms + length / 2) / total_ms
                clip_target = target * CURVES[curve](progress)
                kind, factor = surprise_factor(progress) if surprises else (None, 1.0)
                clip_target *= factor
            if max_speed:
                clip_target = min(clip_target, max_speed * 0.9)
            # the last clip of a span keeps its exact end, so the session length stays right
            clip = picker.pick(length, clip_target, clips[-1] if clips else None,
                               keep_end=length >= remaining, warmup=warmup)
            clip["offsetMs"] = int(elapsed)
            if not warmup and kind:
                clip["surprise"] = kind
            clips.append(clip)
            elapsed += clip["endMs"] - clip["startMs"]

    fill(warmup_ms, warmup=True)
    fill(warmup_ms + total_ms, warmup=False)

    scripts = {vid: picker.actions_of(vid) for vid in {c["videoId"] for c in clips}}
    for clip in clips:  # internal helpers, not part of the saved clip
        clip.pop("endPos", None)
    actions, vib, vib2 = build_tracks(clips, scripts, smooth, max_speed, vib_mode, vib_scripts)
    mins = round(total_ms / 60000)
    warm_label = ""
    if warmup_ms:
        warm_min = round(warmup_ms / 60000)
        warm_label = f" · +{warm_min} min {'warm-up' if lang == 'en' else 'opvarmning'}"
    return {
        "name": f"{mins} min · {(CURVE_LABELS_EN if lang == 'en' else CURVE_LABELS)[curve]}"
                f" · {round(target)} u/s"
                + (f" · {'max' if lang == 'en' else 'maks'} {round(max_speed)}" if max_speed else "")
                + warm_label,
        "totalMs": int(elapsed),
        "params": {"minutes": total_ms / 60000, "clipMs": clip_ms, "curve": curve,
                   "targetSpeed": round(target, 1), "seed": seed, "maxSpeed": max_speed,
                   "smooth": bool(smooth), "vibMode": vib_mode, "warmupMs": warmup_ms,
                   "surprises": bool(surprises)},
        "vib": vib,
        "vib2": vib2,
        "clips": clips,
        "actions": actions,
    }


SURPRISES = {"burst": 1.4, "pause": 0.45, "edge": 1.3, "edge_stop": 0.45}

STEER_FACTOR = 1.15     # ▲/▼ change the upcoming clips' speed by 15%
FINISH_MS = 120000      # "finish now": about two minutes of finale


def steer_session(session, from_index, videos, mode, scripts, vib_scripts, seed=None, taste=None):
    """Re-pick the clips after `from_index` while that clip keeps playing.

    mode "more"/"less": same lengths, 15% faster/slower. mode "finish": replace the rest
    with a short finale. Clips up to and including `from_index` stay exactly as they are,
    so playback continues without a jump."""
    params = session.get("params", {})
    clips = session["clips"]
    if not 0 <= from_index < len(clips):
        raise ValueError("Ugyldigt klip")
    keep, rest = clips[:from_index + 1], clips[from_index + 1:]
    max_speed = float(params["maxSpeed"]) if params.get("maxSpeed") else None
    pool = videos
    if params.get("videoIds"):
        wanted = set(params["videoIds"])
        pool = [v for v in videos if v["id"] in wanted] or videos
    picker = ClipPicker(eligible_videos(pool, params.get("vibMode", "derive")),
                        scripts, max_speed, seed, taste)
    for clip in clips:
        picker.mark_used(clip, count=clip in keep)

    def capped(speed):
        speed = max(30.0, speed)
        return min(speed, max_speed * 0.9) if max_speed else speed

    new = []
    prev = keep[-1]
    if mode == "finish":
        rest_ms = sum(c["endMs"] - c["startMs"] for c in rest if not c.get("warmup"))
        total = max(30000, min(FINISH_MS, rest_ms or FINISH_MS))
        target = capped((params.get("targetSpeed") or prev.get("targetSpeed") or 200) * 1.45)
        left = total
        while left > 1000:
            length = min(60000, left)
            if left - length < MIN_CLIP_MS:
                length = left
            clip = picker.pick(length, target, prev, keep_end=length >= left)
            new.append(clip)
            left -= clip["endMs"] - clip["startMs"]
            prev = clip
    elif mode in ("more", "less"):
        factor = STEER_FACTOR if mode == "more" else 1 / STEER_FACTOR
        for old in rest:
            if old.get("warmup"):  # the warm-up stays still, whatever the speed
                new.append(old)
                prev = old
                continue
            length = old["endMs"] - old["startMs"]
            clip = picker.pick(length, capped(old.get("targetSpeed", old["speed"]) * factor), prev,
                               keep_end=True)
            new.append(clip)
            prev = clip
    else:
        raise ValueError("Ugyldig styring")
    for clip in new:
        clip.pop("endPos", None)
    return rebuild_session(session, keep + new, picker.actions_of, vib_scripts)


def build_tracks(clips, scripts, smooth, max_speed, vib_mode, vib_loader):
    """Stroke and vibration tracks for laid-out clips. Warm-up clips get no motion:
    the stroke track holds still and vibration stays off while they play."""
    active = [c for c in clips if not c.get("warmup")]
    still = [(c["offsetMs"], c["offsetMs"] + c["endMs"] - c["startMs"]) for c in clips if c.get("warmup")]
    actions = assemble_script(active, scripts, bridge_ms=BRIDGE_MS if smooth else 0)
    if max_speed:
        actions = limit_speed(actions, max_speed)
    actions = _hold_still(actions, still)
    # "none": stroke-only session (eg. just a Handy) - no vibration tracks or .vib files
    vib, vib2 = ([], []) if vib_mode == "none" else assemble_vib(active, scripts, vib_loader)
    vib = _hold_still(vib, still, level=0) if vib else vib
    vib2 = _hold_still(vib2, still, level=0) if vib2 else vib2
    return actions, vib, vib2


def _hold_still(actions, spans, level=None):
    """No motion during `spans`: hold the position the track has at the start of each span
    (or a fixed `level`, eg. 0 for vibration)."""
    out = [dict(a) for a in actions]
    for start, end in spans:
        points = [(a["at"], a["pos"]) for a in out]
        pos = level if level is not None else (interpolate(points, start) if points else 50)
        out = [a for a in out if not start < a["at"] < end]
        hold_end = end - 1 if level is not None else end  # vibration switches on right at the end
        out += [{"at": int(start), "pos": int(pos)}, {"at": int(hold_end), "pos": int(pos)}]
    out.sort(key=lambda a: a["at"])
    deduped = []
    for a in out:
        if deduped and deduped[-1]["at"] == a["at"]:
            continue
        deduped.append(a)
    return deduped


def assemble_vib(clips, strokes, vib_loader):
    """Combined vibration tracks for the session: (vib, vib2).

    Each clip uses its video's own .vib script when there is one (marked clip["vib"] =
    "original"), otherwise intensity derived from its stroke script ("afledt").
    vib2 (second motor) is only returned when some clip has an original second-motor script;
    clips without one reuse their primary track.
    """
    primary, secondary, original = {}, {}, set()
    any_secondary = False
    for vid in {c["videoId"] for c in clips}:
        v1, v2 = vib_loader(vid) if vib_loader else ([], [])
        if v1:
            primary[vid] = v1
            secondary[vid] = v2 or v1
            original.add(vid)
            any_secondary = any_secondary or bool(v2)
        else:
            primary[vid] = secondary[vid] = derive_vib(strokes.get(vid, []))
    for clip in clips:
        clip["vib"] = "original" if clip["videoId"] in original else "afledt"
    vib = assemble_script(clips, primary, bridge_ms=0)
    vib2 = assemble_script(clips, secondary, bridge_ms=0) if any_secondary else []
    return vib, vib2


def limit_speed(actions, max_speed):
    """Shorten strokes that would move faster than `max_speed` u/s (timing is kept)."""
    out = []
    for action in actions:
        if not out:
            out.append(dict(action))
            continue
        prev = out[-1]
        max_move = max_speed * (action["at"] - prev["at"]) / 1000.0
        delta = action["pos"] - prev["pos"]
        pos = action["pos"]
        if abs(delta) > max_move:
            pos = prev["pos"] + math.copysign(math.floor(max_move), delta)
        out.append({"at": action["at"], "pos": int(round(max(0, min(100, pos))))})
    return out


def assemble_script(clips, scripts, bridge_ms=BRIDGE_MS):
    """Cut each clip out of its video's script and lay them end to end.

    With bridge_ms=0 every stroke is exactly the original; the device then moves from where
    one clip ended straight to the next clip's first original stroke.
    """
    out = []

    def push(at, pos):
        if out and at <= out[-1]["at"]:
            return
        out.append({"at": int(at), "pos": int(pos)})

    for index, clip in enumerate(clips):
        actions = scripts.get(clip["videoId"], [])
        start, end, offset = clip["startMs"], clip["endMs"], clip["offsetMs"]
        # Between clips, glide from where the last clip ended to where this one is after
        # bridge_ms instead of jumping straight to its first stroke.
        resume = start + (bridge_ms if index else 0)
        push(resume - start + offset, interpolate(actions, resume))
        for at, pos in actions:
            if resume < at < end:
                push(at - start + offset, pos)
        push(end - start + offset, interpolate(actions, end))
    return out
