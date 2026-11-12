"""Remote control from a phone on the home network.

A second, small web server (port 8001 by default) listens on the network, but only serves the
remote page and two remote calls, and only with the secret key from the link. The app itself
(library, files, settings) stays on 127.0.0.1. Commands are handed to the player page in the
browser on the PC through a long-poll; the page reports its state back for the phone to show.
"""
import json
import os
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

COMMANDS = {"toggle", "next", "prev", "more", "less", "finish", "faster", "slower",
            "louder", "quieter", "hold"}


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
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlparse(self.path)
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
            if url.path != "/api/cmd" or not self._authorised(url):
                return self._json({"error": "Forkert eller manglende nøgle"}, 403)
            try:
                length = min(int(self.headers.get("Content-Length", "0")), 1000)
                data = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                data = {}
            command = data.get("cmd") if isinstance(data, dict) else None
            if command not in COMMANDS:
                return self._json({"error": "Ukendt kommando"}, 400)
            remote.phone_at = time.time()
            remote.push(command)
            return self._json({"ok": True})

        def log_message(self, format, *args):
            return

    return RemoteHandler
