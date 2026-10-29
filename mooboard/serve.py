"""Local live preview backed by the firmware's native runtime."""
import base64
import datetime
import http.server
import json
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

from . import live, png
from .native import Runtime


def context(start, clock24=False, seconds=True):
    now = datetime.datetime.now().astimezone()
    return {"monoMs": int(time.monotonic() * 1000) % 2 ** 32,
            "elapsedMs": int((time.monotonic() - start) * 1000), "epochSec": int(now.timestamp()),
            "hour": now.hour, "minute": now.minute, "second": now.second,
            "year": now.year, "month": now.month, "day": now.day, "weekday": now.isoweekday() % 7,
            "clock24": clock24, "seconds": seconds, "night": False, "timeValid": True, "online": True}


def resolve(template, settings, secrets, url=False):
    def replace(match):
        group, key = match.groups()
        value = (settings if group == "settings" else secrets).get(key)
        if value is None or (url and group == "secrets"):
            raise ValueError("Configure the data source and its credentials")
        value = ("true" if value else "false") if isinstance(value, bool) else str(value)
        return urllib.parse.quote(value, safe="") if url and match.group() != template else value
    result = live.TOKEN.sub(replace, template)
    if "{" in result or "}" in result or "\r" in result or "\n" in result:
        raise ValueError("Invalid source template")
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


class Preview:
    def __init__(self, folder, use_live=False):
        self.folder = Path(folder).resolve()
        self.manifest = live.check(json.loads((self.folder / "mooboard.json").read_text(encoding="utf-8")))
        self.settings = {s["key"]: s["default"] for s in self.manifest.get("settings", [])}
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.live = use_live
        self.secrets = {key[len("MOOBOARD_SECRET_"):].lower(): value for key, value in os.environ.items() if key.startswith("MOOBOARD_SECRET_")}
        self.feeds, self.due, self.backoff = {}, {}, {}
        self.error = None
        self.start = time.monotonic()
        self.source = (self.folder / "app.lua").read_bytes()
        self.runtime = Runtime(self.source, self.settings)
        self.active, self.locked, self.rotation = True, False, True
        self.clock24, self.seconds = False, True
        fixture = self.folder / "sample-data.json"
        self.fixture = json.loads(fixture.read_text(encoding="utf-8")) if fixture.exists() else {}
        self.runtime.json("data", self.fixture)
        self.runtime.event("data")
        self.thread = threading.Thread(target=self.poll, daemon=True)
        self.thread.start()

    def poll(self):
        opener = urllib.request.build_opener(NoRedirect)
        while not self.stop.wait(0.2):
            with self.lock:
                if not self.live:
                    continue
                settings = dict(self.settings)
            for source in self.manifest.get("sources", []):
                key = source["key"]
                if time.monotonic() < self.due.get(key, 0):
                    continue
                feed = dict(self.feeds.get(key, {}))
                try:
                    url = resolve(source["url"], settings, self.secrets, True)
                    parsed = urllib.parse.urlsplit(url)
                    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
                        raise ValueError("Configure an HTTPS data source")
                    headers = {name: resolve(value, settings, self.secrets) for name, value in source.get("headers", {}).items()}
                    headers["Accept"] = "application/json"
                    request = urllib.request.Request(url, headers=headers)
                    with opener.open(request, timeout=5) as response:
                        body = response.read(16385)
                        if len(body) > 16384:
                            raise ValueError("Data source response exceeds 16 KB")
                        value = json.loads(body)
                    feed.update(value=value, status="ok", error="", updatedAt=int(time.time()))
                    self.backoff[key] = source["refresh"]
                except (OSError, ValueError, urllib.error.HTTPError):
                    feed.update(status="error", error="Data source unavailable; check its URL and credentials")
                    self.backoff[key] = min(3600, max(30, self.backoff.get(key, source["refresh"]) * 2))
                self.due[key] = time.monotonic() + self.backoff[key]
                with self.lock:
                    if self.stop.is_set():
                        return
                    self.feeds[key] = feed
                    if len(json.dumps(self.feeds).encode()) > 32768:
                        feed.pop("value", None)
                        feed.update(status="error", error="Data source value exceeds snapshot budget")
                    try:
                        self.runtime.json("data", self.feeds)
                        self.runtime.event("data")
                    except RuntimeError as error:
                        self.error = str(error)

    def frame(self):
        with self.lock:
            source = (self.folder / "app.lua").read_bytes()
            if source != self.source:
                replacement = Runtime(source, self.settings, self.runtime.state())
                replacement.json("data", self.feeds if self.live else self.fixture)
                replacement.event("data")
                self.runtime.event("stop")
                self.runtime.close()
                self.runtime, self.source = replacement, source
                self.error = None
            if self.error:
                raise RuntimeError(self.error)
            rgb = self.runtime.frame(context(self.start, self.clock24, self.seconds))
            return png.encode(128, 32, rgb)

    def change(self, path, body):
        with self.lock:
            if not isinstance(body, dict):
                raise ValueError("Send a JSON object")
            if path == "/settings":
                allowed = {s["key"] for s in self.manifest.get("settings", [])}
                if not isinstance(body, dict) or set(body) - allowed:
                    raise ValueError("Unknown app setting")
                values = dict(self.settings, **body)
                candidate = dict(self.manifest)
                candidate["settings"] = [dict(s, default=values[s["key"]]) for s in self.manifest.get("settings", [])]
                live.check(candidate)
                self.settings = values
                self.runtime.json("settings", values)
                self.runtime.event("settings")
                self.due.clear()
            elif path == "/input":
                if not isinstance(body, dict):
                    raise ValueError("Input must be an object")
                self.runtime.event("input", body)
            elif path == "/mode":
                if "live" in body:
                    self.live = bool(body["live"])
                    self.due.clear()
                    self.runtime.json("data", self.feeds if self.live else self.fixture)
                    self.runtime.event("data")
                self.clock24 = bool(body.get("clock24", self.clock24))
                self.seconds = bool(body.get("seconds", self.seconds))
                if "active" in body:
                    self.active = bool(body["active"])
                    self.runtime.event("resume" if self.active else "pause")
                if "locked" in body:
                    if body["locked"] and not self.locked:
                        self.before_lock = self.rotation
                    self.locked = bool(body["locked"])
                    self.rotation = False if self.locked else getattr(self, "before_lock", self.rotation)
                if "rotation" in body:
                    self.rotation = bool(body["rotation"])
                    if self.rotation:
                        self.locked = False
            else:
                raise ValueError("Unknown preview operation")

    def close(self):
        self.stop.set()
        self.thread.join(timeout=6)
        with self.lock:
            try:
                self.runtime.event("stop")
            finally:
                self.runtime.close()


def serve(folder, port=0, use_live=False, open_browser=True):
    preview = Preview(folder, use_live)
    page = Path(__file__).with_name("player") / "live.html"

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def answer(self, status, content_type, body):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            try:
                if self.path == "/":
                    self.answer(200, "text/html; charset=utf-8", page.read_bytes())
                elif self.path.startswith("/frame"):
                    self.answer(200, "image/png", preview.frame())
                elif self.path == "/state":
                    with preview.lock:
                        state=preview.runtime.state()
                    self.answer(200, "application/json", json.dumps(state).encode())
                elif self.path == "/info":
                    body = {"manifest": preview.manifest, "settings": preview.settings, "live": preview.live, "role": live.role(preview.manifest["category"])}
                    self.answer(200, "application/json", json.dumps(body).encode())
                else:
                    self.answer(404, "text/plain", b"Not found")
            except (ValueError, RuntimeError, OSError) as error:
                self.answer(400, "application/json", json.dumps({"error": str(error)}).encode())

        def do_POST(self):
            try:
                origin = self.headers.get("Origin")
                if origin and origin != "http://" + self.headers.get("Host", ""):
                    raise ValueError("Preview requests must come from this page")
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096 or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("Send a JSON object of at most 4 KB")
                preview.change(self.path, json.loads(self.rfile.read(size)))
                with preview.lock:
                    result = {"ok": True, "active": preview.active, "locked": preview.locked, "rotation": preview.rotation}
                self.answer(200, "application/json", json.dumps(result).encode())
            except (ValueError, RuntimeError) as error:
                self.answer(400, "application/json", json.dumps({"error": str(error)}).encode())

    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        preview.close()
        raise
    address = "http://127.0.0.1:%d" % server.server_port
    print(address, flush=True)
    if open_browser:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        preview.close()
