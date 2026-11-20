"""Remote control from a phone on the home network.

A second, small web server (port 8001 by default) listens on the network, but only serves the
remote page and two remote calls, and only with the secret key from the link. The app itself
(library, files, settings) stays on 127.0.0.1. Commands are handed to the player page in the
browser on the PC through a long-poll; the page reports its state back for the phone to show.

The same server lets a TV (the TvFin app) play saved sessions: the TV asks to pair, shows a
4-digit code, and gets the key only after the user presses "Allow" in the app on the PC.
With the key it can list sessions and stream their videos (read-only, /tv/...).
"""
import json
import os
import re
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

VIDEO_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4",
    ".mkv": "video/x-matroska", ".webm": "video/webm",
}
CHUNK = 1024 * 1024
PAIR_TTL = 300  # seconds a TV pairing request stays open


def stream_file(handler, file_path, extra_headers=None):
    """Stream a video with HTTP Range support so players can seek."""
    size = file_path.stat().st_size
    ctype = VIDEO_TYPES.get(file_path.suffix.lower(), "application/octet-stream")
    start, end = 0, size - 1
    m = re.match(r"bytes=(\d*)-(\d*)", handler.headers.get("Range") or "")
    if m and (m.group(1) or m.group(2)):
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:  # suffix range: last N bytes
            start = max(0, size - int(m.group(2)))
        end = min(end, size - 1)
        if start > end:
            handler.send_response(416)
            handler.send_header("Content-Range", f"bytes */{size}")
            handler.end_headers()
            return
        handler.send_response(206)
        handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    else:
        handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Accept-Ranges", "bytes")
    handler.send_header("Content-Length", str(end - start + 1))
    for name, value in (extra_headers or {}).items():
        handler.send_header(name, value)
    handler.end_headers()
    try:
        with open(file_path, "rb") as fh:
            fh.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = fh.read(min(CHUNK, remaining))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                remaining -= len(chunk)
    except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
        pass  # player cancelled the request (normal when seeking)

COMMANDS = {"toggle", "next", "prev", "more", "less", "finish", "faster", "slower",
            "louder", "quieter", "hold", "edge", "mark"}


def lan_ip():
    """This PC's address on the home network (no packets are sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return socket.gethostbyname(socket.gethostname())


class Remote:
    def __init__(self, library, web_dir, port):
        self.library = library
        self.page = Path(web_dir) / "remote.html"
        self.port = port
        self.cond = threading.Condition()
        self.commands = []
        self.status = {}
        self.status_at = 0.0
        self.pairings = {}  # TV pairing requests: id -> {code, name, created, status, handy}
        self.pair_lock = threading.Lock()
        self.server = None
        self.error = ""
        self.key = library.get_setting("remote_key") or self.new_key()

    def new_key(self):
        self.key = secrets.token_urlsafe(6)
        self.library.set_setting("remote_key", self.key)
        return self.key

    # ------------------------------------------------------------ on / off
    @property
    def enabled(self):
        return self.server is not None

    def start(self):
        if self.server:
            return
        try:
            host = os.environ.get("FUNSCRIPT_REMOTE_HOST", "0.0.0.0")  # tests use 127.0.0.1
            self.server = ThreadingHTTPServer((host, self.port), _handler(self))
        except OSError as exc:
            self.error = f"Kunne ikke starte fjernbetjeningen på port {self.port}: {exc}"
            self.server = None
            return
        self.error = ""
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        server, self.server = self.server, None
        if server:
            threading.Thread(target=lambda: (server.shutdown(), server.server_close()), daemon=True).start()

    def info(self):
        return {"enabled": self.enabled, "url": f"http://{lan_ip()}:{self.port}/?k={self.key}",
                "error": self.error, "phoneSeen": time.time() - getattr(self, "phone_at", 0) < 10}

    # ------------------------------------------------------------ commands and state
    def push(self, command):
        with self.cond:
            self.commands.append(command)
            self.cond.notify_all()

    def wait(self, timeout=20):
        """Commands for the player page; blocks until one arrives or the timeout passes."""
        with self.cond:
            self.cond.wait_for(lambda: self.commands, timeout)
            out, self.commands = self.commands, []
        return out

    def set_status(self, status):
        self.status = status if isinstance(status, dict) else {}
        self.status_at = time.time()

    # ------------------------------------------------------------ TV pairing
    def _prune(self):
        now = time.time()
        for pid in [p for p, v in self.pairings.items() if now - v["created"] > PAIR_TTL]:
            del self.pairings[pid]

    def pair_request(self, name):
        """A TV asks to pair; it shows the returned code so the user can recognise it on the PC."""
        with self.pair_lock:
            self._prune()
            pending = sorted((v["created"], p) for p, v in self.pairings.items() if v["status"] == "pending")
            for _, pid in pending[:max(0, len(pending) - 4)]:  # at most 5 open requests
                del self.pairings[pid]
            pid = secrets.token_urlsafe(12)
            code = f"{secrets.randbelow(10000):04d}"
            self.pairings[pid] = {"code": code, "name": str(name or "TV")[:40], "created": time.time(),
                                  "status": "pending", "handy": None}
            return {"id": pid, "code": code}

    def pending_pairings(self):
        with self.pair_lock:
            self._prune()
            return [{"id": p, "code": v["code"], "name": v["name"]}
                    for p, v in self.pairings.items() if v["status"] == "pending"]

    def answer_pairing(self, pid, allow, handy=None):
        with self.pair_lock:
            entry = self.pairings.get(pid)
            if not entry or entry["status"] != "pending":
                return False
            entry["status"] = "approved" if allow else "denied"
            if allow and isinstance(handy, dict) and handy.get("appId") and handy.get("key"):
                entry["handy"] = {"appId": str(handy["appId"])[:200], "key": str(handy["key"])[:200]}
            return True

    def pair_status(self, pid):
        """What the TV polls. An answer is handed out once, then forgotten."""
        with self.pair_lock:
            self._prune()
            entry = self.pairings.get(pid)
            if not entry:
                return {"status": "expired"}
            if entry["status"] == "pending":
                return {"status": "pending"}
            del self.pairings[pid]
            if entry["status"] == "denied":
                return {"status": "denied"}
            return {"status": "approved", "key": self.key, "handy": entry["handy"]}

    def public_status(self):
        return {**self.status, "online": time.time() - self.status_at < 4}


def _handler(remote):
    class RemoteHandler(BaseHTTPRequestHandler):
        def _authorised(self, url):
            key = (parse_qs(url.query).get("k") or [""])[0]
            return secrets.compare_digest(key.encode(), remote.key.encode())

        def _json(self, payload, status=200):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            if urlparse(self.path).path.startswith("/tv/"):
                self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):  # CORS preflight from the TV app
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _tv_get(self, url):
            """Read-only endpoints for the TV app (TvFin)."""
            path = url.path
            if path == "/tv/hello":  # lets TvFin find this PC on the network; reveals nothing else
                return self._json({"app": "Funscript Session", "name": socket.gethostname()})
            m = re.fullmatch(r"/tv/pair/([\w-]{8,40})", path)
            if m:
                return self._json(remote.pair_status(m.group(1)))
            if not self._authorised(url):
                return self._json({"error": "Forkert eller manglende nøgle"}, 403)
            lib = remote.library
            if path == "/tv/info":
                return self._json({"ok": True, "app": "Funscript Session"})
            if path == "/tv/resume":  # where the last session was left (shared with the PC)
                resume = json.loads(lib.get_setting("resume", "null") or "null")
                s = lib.session(resume["sessionId"]) if resume else None
                if not s:
                    return self._json({"resume": None})
                return self._json({"resume": {**resume, "name": s["name"], "totalMs": s["totalMs"]}})
            if path == "/tv/sessions":
                items = []
                for s in lib.sessions():
                    full = lib.session(s["id"])
                    first = full["clips"][0]["videoId"] if full and full["clips"] else None
                    items.append({k: s[k] for k in ("id", "name", "createdAt", "totalMs", "clipCount", "playCount")}
                                 | {"thumbVideoId": first})
                return self._json({"sessions": items})
            m = re.fullmatch(r"/tv/sessions/(\d+)", path)
            if m:
                s = lib.session(int(m.group(1)))
                if not s:
                    return self._json({"error": "Ukendt session"}, 404)
                # vib/vib2: vibrator tracks (motor 1 / motor 2) for Intiface devices driven from the TV
                return self._json({k: s.get(k) or [] if k in ("vib", "vib2") else s[k]
                                   for k in ("id", "name", "totalMs", "clips", "actions", "vib", "vib2")})
            m = re.fullmatch(r"/tv/media/(\d+)", path)
            if m:
                media = lib.media_path(int(m.group(1)))
                if not media or not media.is_file():
                    return self._json({"error": "Video not found"}, 404)
                return stream_file(self, media, {"Access-Control-Allow-Origin": "*"})
            m = re.fullmatch(r"/tv/thumb/(\d+)", path)
            if m:
                thumb = lib.thumbnail(int(m.group(1)))
                if not thumb:
                    return self._json({"error": "No thumbnail"}, 404)
                body = thumb.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Cache-Control", "max-age=86400")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            return self._json({"error": "Not found"}, 404)

        def _tv_post(self, path, data):
            """What the TV reports back: played sessions, played time and where it stopped."""
            lib = remote.library
            m = re.fullmatch(r"/tv/sessions/(\d+)/played", path)
            if m:
                return self._json({"ok": lib.mark_played(int(m.group(1)))})
            if path == "/tv/stats/tick":
                lib.add_play_seconds(data.get("seconds", 0))
                return self._json({"ok": True})
            if path == "/tv/resume":  # same place as the PC keeps it, so either can go on
                try:
                    value = {"sessionId": int(data["sessionId"]), "ms": max(0, int(data["ms"])), "at": time.time()}
                except (KeyError, TypeError, ValueError):
                    value = None  # finished or dismissed
                lib.set_setting("resume", json.dumps(value))
                return self._json({"ok": True})
            return self._json({"error": "Not found"}, 404)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path.startswith("/tv/"):
                return self._tv_get(url)
            if url.path in ("/", "/remote"):
                body = remote.page.read_bytes()  # the page itself holds no data; calls need the key
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if url.path == "/api/status":
                if not self._authorised(url):
                    return self._json({"error": "Forkert eller manglende nøgle"}, 403)
                remote.phone_at = time.time()
                return self._json(remote.public_status())
            self.send_error(404)

        def do_POST(self):
            url = urlparse(self.path)
            if url.path == "/tv/pair":  # a TV asks to pair; the user allows it in the app on the PC
                name = (parse_qs(url.query).get("name") or ["TV"])[0]
                return self._json(remote.pair_request(name))
            if not self._authorised(url):
                return self._json({"error": "Forkert eller manglende nøgle"}, 403)
            try:
                length = min(int(self.headers.get("Content-Length", "0")), 1000)
                data = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                data = {}
            if not isinstance(data, dict):
                data = {}
            if url.path.startswith("/tv/"):
                return self._tv_post(url.path, data)
            if url.path != "/api/cmd":
                return self._json({"error": "Not found"}, 404)
            command = data.get("cmd") if isinstance(data, dict) else None
            if command not in COMMANDS:
                return self._json({"error": "Ukendt kommando"}, 400)
            remote.phone_at = time.time()
            remote.push(command)
            return self._json({"ok": True})

        def log_message(self, format, *args):
            return

    return RemoteHandler
