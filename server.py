import json
import math
import mimetypes
import os
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from funlib import (Library, remux_dir, build_session, session_funscript, rebuild_session,
                    find_replacement, steer_session)

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
LIBRARY = Library(os.environ.get("FUNSCRIPT_DB", ROOT / "funscript.db"), ROOT / "videos")

VIDEO_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4",
    ".mkv": "video/x-matroska", ".webm": "video/webm",
}
CHUNK = 1024 * 1024

# English versions of the (Danish) messages the server and library can send to the browser.
# Messages with details keep them: only the Danish prefix is translated.
MESSAGES_EN = {
    "Mappen findes ikke: ": "Folder not found: ",
    "Angiv en fuld sti, fx D:\Sessioner": "Enter a full path, eg. D:\Sessions",
    "Gem ikke sessioner inde i videobiblioteket": "Don't save sessions inside the video library",
    "Kan ikke bruge mappen: ": "Can't use the folder: ",
    "Ugyldigt klip": "Invalid clip",
    "Ugyldig ændring": "Invalid change",
    "Kunne ikke omdøbe filen: ": "Couldn't rename the file: ",
    "Ugyldigt navn": "Invalid name",
    "Ugyldig rating": "Invalid rating",
    "En session skal have mindst ét klip": "A session needs at least one clip",
    "Fandt ikke noget klip at bytte med": "Found no clip to swap with",
    "Ingen af de valgte videoer har et .vib-script": "None of the chosen videos has a .vib script",
    "Ingen afspillelige videoer med funscript i biblioteket": "No playable videos with a funscript in the library",
    "ffmpeg blev ikke fundet i PATH": "ffmpeg was not found in PATH",
    "Ukendt feedback": "Unknown feedback",
    "Ugyldig feedback": "Invalid feedback",
    "Ugyldig styring": "Invalid steering",
}


def translate_message(message, lang):
    if lang != "en" or not isinstance(message, str):
        return message
    for danish, english in MESSAGES_EN.items():
        if message == danish or (danish.endswith(": ") and message.startswith(danish)):
            return english + message[len(danish):] if danish.endswith(": ") else english
    return message
REMUX_LOCK = threading.Lock()


def generate_session_actions(file_name: str, minutes: int = 10):
    """Synthetic script used by the legacy prototype pages."""
    total_ms = minutes * 60 * 1000
    phase = (sum(ord(ch) for ch in file_name) % 1000) / 1000.0
    action_count = 900
    actions = []
    for i in range(action_count + 1):
        at = int((i / action_count) * total_ms)
        t = at / 1000.0
        pos = (50 + 18 * math.sin(t / 4.5 + phase * 9) + 16 * math.sin(t / 1.9 + phase * 13 + 1.2)
               + 8 * math.sin(t / 0.8 + phase * 21 + 2.3) + 12 * math.sin(t * 2.7 + phase * 31))
        actions.append({"at": at, "pos": int(round(max(0, min(100, pos))))})
    return {"version": "1.0", "actions": actions}


def run_scan(folder=None):
    try:
        LIBRARY.scan(folder)
    except Exception as exc:  # reported through /api/scan/status
        LIBRARY.scan_state = {"running": False, "done": 0, "total": 0, "message": "", "error": str(exc)}
        return
    start_audio_measuring()


AUDIO_LOCK = threading.Lock()


def start_audio_measuring():
    """Measure loudness of new/changed videos in the background (one job at a time)."""
    def job():
        if not AUDIO_LOCK.acquire(blocking=False):
            return
        try:
            LIBRARY.measure_audio_all()
        except Exception as exc:  # never take the server down for this
            print(f"Lydmåling fejlede: {exc}")
        finally:
            AUDIO_LOCK.release()
    threading.Thread(target=job, daemon=True).start()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    # ------------------------------------------------------------ routing
    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/api/health":
            return self.send_json({"status": "ok", "root": str(ROOT)})
        if path == "/api/settings":
            return self.send_json({"libraryPath": LIBRARY.library_folder(),
                                   "exportPath": str(LIBRARY.export_folder())})
        if path == "/api/library":
            return self.send_json({"folder": LIBRARY.library_folder(), "videos": LIBRARY.videos()})
        if path == "/api/audio/status":
            return self.send_json(LIBRARY.audio_state)
        if path == "/api/scan/status":
            return self.send_json(LIBRARY.scan_state)
        if path == "/api/sessions":
            return self.send_json({"sessions": LIBRARY.sessions()})
        if path == "/api/resume":  # where the last session was left, if it still exists
            resume = json.loads(LIBRARY.get_setting("resume", "null") or "null")
            session = LIBRARY.session(resume["sessionId"]) if resume else None
            if not session:
                return self.send_json({"resume": None})
            return self.send_json({"resume": {**resume, "name": session["name"],
                                              "totalMs": session["totalMs"]}})
        if path == "/api/remux/status":
            return self.send_json({**LIBRARY.remux_state, "cacheDir": str(remux_dir())})

        m = re.fullmatch(r"/api/sessions/(\d+)", path)
        if m:
            session = LIBRARY.session(int(m.group(1)))
            return self.send_json(session) if session else self.send_error(404)

        m = re.fullmatch(r"/api/sessions/(\d+)/funscript", path)
        if m:
            session = LIBRARY.session(int(m.group(1)))
            if not session:
                return self.send_error(404)
            track = (parse_qs(url.query).get("track") or [""])[0]
            if track in ("vib", "vib2") and not session.get(track):
                return self.send_error(404, "No such track")
            actions = session[track] if track in ("vib", "vib2") else None
            body = json.dumps(session_funscript(session, actions)).encode("utf-8")
            filename = re.sub(r"[^\w\- ]+", "", session["name"]).strip() or "session"
            if actions is not None:
                filename += f".{track}"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Disposition",
                             f"attachment; filename*=UTF-8''{quote(filename)}.funscript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        m = re.fullmatch(r"/api/videos/(\d+)/script", path)
        if m:
            actions = LIBRARY.script_actions(int(m.group(1)))
            return self.send_json({"actions": [{"at": a, "pos": p} for a, p in actions]})

        m = re.fullmatch(r"/thumb/(\d+)", path)
        if m:
            thumb = LIBRARY.thumbnail(int(m.group(1)))
            if not thumb:
                return self.send_error(404, "No thumbnail")
            body = thumb.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "max-age=86400")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        m = re.fullmatch(r"/media/(\d+)", path)
        if m:
            media = LIBRARY.media_path(int(m.group(1)))
            if not media or not media.is_file():
                return self.send_error(404, "Video not found")
            return self.send_video(media)

        if path.startswith("/legacy/") or path == "/sample.funscript":
            return self.send_static(ROOT / path.lstrip("/"))

        self.static_file = True  # app files: always check for a newer version (see end_headers)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        data = self.read_json()
        if data is None:
            return self.send_error(400, "Invalid JSON payload")

        if path == "/api/settings":
            if "libraryPath" in data:
                folder = str(data.get("libraryPath", "")).strip()
                if not folder or not Path(folder).expanduser().is_dir():
                    return self.send_json({"error": f"Mappen findes ikke: {folder}"}, 400)
                LIBRARY.set_setting("library_path", str(Path(folder).expanduser()))
            if "exportPath" in data:
                export = Path(str(data.get("exportPath", "")).strip()).expanduser()
                if not export.is_absolute():
                    return self.send_json({"error": "Angiv en fuld sti, fx D:\\Sessioner"}, 400)
                if Path(LIBRARY.library_folder()).resolve() in [export.resolve(), *export.resolve().parents]:
                    return self.send_json({"error": "Gem ikke sessioner inde i videobiblioteket"}, 400)
                try:
                    export.mkdir(parents=True, exist_ok=True)
                except OSError as exc:
                    return self.send_json({"error": f"Kan ikke bruge mappen: {exc}"}, 400)
                LIBRARY.set_setting("export_path", str(export))
                LIBRARY.export_missing()
            return self.send_json({"libraryPath": LIBRARY.library_folder(),
                                   "exportPath": str(LIBRARY.export_folder())})

        if path == "/api/scan":
            if LIBRARY.scan_state.get("running"):
                return self.send_json({"started": False, "status": LIBRARY.scan_state})
            LIBRARY.scan_state = {"running": True, "done": 0, "total": 0, "message": ""}
            threading.Thread(target=run_scan, daemon=True).start()
            return self.send_json({"started": True})

        if path == "/api/remux":
            with REMUX_LOCK:
                if LIBRARY.remux_state.get("running"):
                    return self.send_json({"started": False, "status": LIBRARY.remux_state})
                LIBRARY.remux_state = {**LIBRARY.remux_state, "running": True, "done": 0, "total": 0}
            threading.Thread(target=LIBRARY.remux_all, args=(data.get("videoIds") or None,),
                             daemon=True).start()
            return self.send_json({"started": True})

        if path == "/api/sessions/build":
            return self.build_and_save(data)

        m = re.fullmatch(r"/api/sessions/(\d+)/similar", path)
        if m:  # same settings and video selection, new clips
            session = LIBRARY.session(int(m.group(1)))
            if not session:
                return self.send_error(404)
            p = session["params"]
            return self.build_and_save({
                "minutes": p.get("minutes", session["totalMs"] / 60000),
                "clipSeconds": (p["clipMs"] / 1000) if p.get("clipMs") else None,
                "curve": p.get("curve", "constant"), "targetSpeed": p.get("targetSpeed"),
                "maxSpeed": p.get("maxSpeed"), "smooth": p.get("smooth", True),
                "vibMode": p.get("vibMode", "derive"), "videoIds": p.get("videoIds"),
                "seed": data.get("seed"), "avoid": session["clips"],
                "warmupMinutes": (p.get("warmupMs") or 0) / 60000,
            })

        if path == "/api/resume":
            if data.get("sessionId") and data.get("ms") is not None:
                value = {"sessionId": int(data["sessionId"]), "ms": max(0, int(data["ms"])),
                         "at": time.time()}
                LIBRARY.set_setting("resume", json.dumps(value))
            else:  # finished or dismissed
                LIBRARY.set_setting("resume", "null")
            return self.send_json({"ok": True})

        if path == "/api/feedback":  # learning: watched to the end / skipped / swapped / removed
            try:
                LIBRARY.add_feedback(data["videoId"], data.get("startMs", 0), data.get("endMs", 0),
                                     data.get("kind"))
            except (KeyError, TypeError, ValueError) as exc:
                return self.send_json({"error": str(exc) or "Ugyldig feedback"}, 400)
            return self.send_json({"ok": True})
        if path == "/api/feedback/reset":
            LIBRARY.reset_taste()
            return self.send_json({"ok": True})

        m = re.fullmatch(r"/api/sessions/(\d+)/steer", path)
        if m:  # live steering: re-pick the clips after the one playing now
            session = LIBRARY.session(int(m.group(1)))
            if not session:
                return self.send_error(404)
            try:
                rebuilt = steer_session(session, int(data.get("fromIndex", -1)), LIBRARY.videos(),
                                        data.get("mode"), LIBRARY.script_actions, LIBRARY.vib_actions,
                                        data.get("seed"), LIBRARY.taste())
            except (KeyError, TypeError, ValueError) as exc:
                return self.send_json({"error": str(exc) or "Ugyldig styring"}, 400)
            return self.send_json(LIBRARY.update_session(rebuilt))

        m = re.fullmatch(r"/api/sessions/(\d+)/(edit|swap)", path)
        if m:
            session = LIBRARY.session(int(m.group(1)))
            if not session:
                return self.send_error(404)
            videos = {v["id"]: v for v in LIBRARY.videos()}
            try:
                if m.group(2) == "swap":
                    index = int(data.get("index", -1))
                    if not 0 <= index < len(session["clips"]):
                        raise ValueError("Ugyldigt klip")
                    wanted = {int(i) for i in data.get("videoIds") or []}
                    pool = [v for v in videos.values() if not wanted or v["id"] in wanted]
                    clips = list(session["clips"])
                    clips[index] = find_replacement(pool, session, index, data.get("seed"),
                                                    LIBRARY.script_actions, LIBRARY.taste())
                else:  # edit: new order / removed clips, each must be a real part of a video
                    clips = []
                    for c in data.get("clips") or []:
                        v = videos.get(int(c["videoId"]))
                        start, end = int(c["startMs"]), int(c["endMs"])
                        if not v or not 0 <= start < end <= v["durationMs"] + 1000:
                            raise ValueError("Ugyldigt klip")
                        clips.append({k: c[k] for k in ("videoId", "name", "startMs", "endMs",
                                                        "speed", "targetSpeed") if k in c})
                rebuilt = rebuild_session(session, clips, LIBRARY.script_actions, LIBRARY.vib_actions)
            except (KeyError, TypeError, ValueError) as exc:
                return self.send_json({"error": str(exc) or "Ugyldig ændring"}, 400)
            return self.send_json(LIBRARY.update_session(rebuilt))

        m = re.fullmatch(r"/api/sessions/(\d+)/rename", path)
        if m:
            try:
                name = LIBRARY.rename_session(int(m.group(1)), data.get("name", ""))
            except OSError as exc:
                return self.send_json({"error": f"Kunne ikke omdøbe filen: {exc}"}, 400)
            if not name:
                return self.send_json({"error": "Ugyldigt navn"}, 400)
            return self.send_json({"name": name})

        m = re.fullmatch(r"/api/videos/(\d+)/rating", path)
        if m:
            try:
                rating = LIBRARY.set_rating(int(m.group(1)), data.get("rating", 0))
            except (TypeError, ValueError):
                return self.send_json({"error": "Ugyldig rating"}, 400)
            return self.send_json({"rating": rating})

        m = re.fullmatch(r"/api/sessions/(\d+)/played", path)
        if m:
            return self.send_json({"ok": LIBRARY.mark_played(int(m.group(1)))})

        if path == "/api/session":  # legacy prototype endpoint
            file_name = str(data.get("fileName") or data.get("file") or "session")
            return self.send_json(generate_session_actions(file_name, int(data.get("minutes", 10))))

        self.send_error(404, "Not found")

    def do_DELETE(self):
        m = re.fullmatch(r"/api/sessions/(\d+)", urlparse(self.path).path)
        if not m:
            return self.send_error(404)
        LIBRARY.delete_session(int(m.group(1)))
        self.send_json({"ok": True})

    # ------------------------------------------------------------ helpers
    def build_and_save(self, data):
        """Build a session from builder settings, save it, export its files and reply."""
        try:
            minutes = float(data.get("minutes", 15))
            clip_seconds = data.get("clipSeconds")
            video_ids = data.get("videoIds") or None
            videos = LIBRARY.videos()
            if video_ids:
                wanted = {int(i) for i in video_ids}
                videos = [v for v in videos if v["id"] in wanted]
            session = build_session(
                videos, int(minutes * 60000),
                clip_ms=float(clip_seconds) * 1000 if clip_seconds else None,
                curve=data.get("curve", "constant"),
                target=data.get("targetSpeed") or None,
                seed=data.get("seed"),
                scripts=LIBRARY.script_actions,
                max_speed=data.get("maxSpeed") or None,
                smooth=data.get("smooth", True) is not False,
                vib_scripts=LIBRARY.vib_actions,
                vib_mode=data.get("vibMode") if data.get("vibMode") in ("only", "none") else "derive",
                lang=self.lang(),
                avoid=data.get("avoid"),
                warmup_ms=min(10.0, max(0.0, float(data.get("warmupMinutes") or 0))) * 60000,
                taste=LIBRARY.taste(),
            )
        except (KeyError, ValueError, TypeError) as exc:
            return self.send_json({"error": str(exc)}, 400)
        # remember the selection so "build similar" can reuse it later
        session["params"]["videoIds"] = sorted(int(i) for i in video_ids) if video_ids else None
        if data.get("name"):
            session["name"] = str(data["name"])[:120]
        saved = LIBRARY.save_session(session)
        try:
            saved["file"] = str(LIBRARY.export_session(saved))
        except OSError as exc:
            saved["file"] = None
            saved["exportError"] = str(exc)
        return self.send_json(saved)

    def lang(self):
        return "en" if (self.headers.get("X-Lang") or "").lower() == "en" else "da"

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = self.rfile.read(length).decode("utf-8") if length else ""
            data = json.loads(payload or "{}")
            return data if isinstance(data, dict) else None
        except (ValueError, UnicodeDecodeError):
            return None

    def send_json(self, payload, status=200):
        if isinstance(payload, dict) and payload.get("error"):
            payload = {**payload, "error": translate_message(payload["error"], self.lang())}
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, file_path):
        file_path = file_path.resolve()
        if ROOT not in file_path.parents or not file_path.is_file():
            return self.send_error(404)
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_video(self, file_path):
        """Stream a video with HTTP Range support so the browser can seek."""
        size = file_path.stat().st_size
        ctype = VIDEO_TYPES.get(file_path.suffix.lower(), "application/octet-stream")
        start, end = 0, size - 1
        range_header = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", range_header or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:  # suffix range: last N bytes
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        try:
            with open(file_path, "rb") as fh:
                fh.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = fh.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass  # browser cancelled the request (normal when seeking)

    def end_headers(self):
        # Without this the browser may keep using an old app.js/style.css after an update.
        if getattr(self, "static_file", False):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    HOST = "127.0.0.1"
    PORT = int(os.environ.get("FUNSCRIPT_PORT", 8000))
    (ROOT / "videos").mkdir(exist_ok=True)
    try:
        written = LIBRARY.export_missing()
        if written:
            print(f"Gemte {written} session(er) som .funscript i {LIBRARY.export_folder()}")
    except OSError as exc:
        print(f"Kunne ikke gemme sessioner som filer: {exc}")
    start_audio_measuring()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Funscript Session Player kører på http://{HOST}:{PORT}")
    httpd.serve_forever()
