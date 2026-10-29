"""custom apps + deterministic package builds"""
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import struct
import time
import urllib.parse
import urllib.request
import zlib

from . import package, png
from .build import Built

ORDER = ("format", "id", "name", "version", "by", "description", "category", "runtime", "minFirmware", "boards", "settings", "controls", "sources")
SETTING_ORDER = ("key", "type", "label", "default", "max", "options")
CONTROL_ORDER = ("key", "type", "label", "arg", "min", "max", "chars", "add")
SOURCE_ORDER = ("key", "url", "refresh", "headers")
KEY = re.compile(r"[a-z][a-z0-9_]{0,15}\Z")
TOKEN = re.compile(r"\{(settings|secrets)\.([a-z][a-z0-9_]{0,15})\}")
VERSION = re.compile(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\Z")
CAP = 352 * 1024


def categories():
    path = Path(__file__).with_name("categories.json")
    return tuple(json.loads(path.read_text(encoding="utf-8")))


def role(category):
    return "clock" if category in ("Clock", "Clock Faces") else "ambiance" if category == "Ambiance" else "app"


def text(value, maximum):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum and package._plain(value)


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise package.Refused("Duplicate manifest field: " + key)
        result[key] = value
    return result


def refuse(condition, message):
    if condition:
        raise package.Refused(message)


def check(man):
    refuse(not isinstance(man, dict), "The live manifest must be an object")
    refuse(set(man) - set(ORDER), "Unknown live manifest field")
    refuse(type(man.get("format")) is not int or man["format"] != 3, "A custom live app uses format 3")
    refuse(not isinstance(man.get("id"), str) or not re.fullmatch(r"[a-z0-9-]{3,32}", man["id"]), "App id must be 3 to 32 letters, numbers and hyphens")
    refuse(man["id"] in package.RESERVED_IDS, "Choose your own app id")
    for field, limit in (("name", 24), ("by", 32), ("description", 160)):
        refuse(not text(man.get(field), limit), "%s must be 1 to %d plain characters" % (field, limit))
    for field in ("version", "minFirmware"):
        refuse(not isinstance(man.get(field), str) or not VERSION.fullmatch(man[field]), field + " must be a semantic version")
    refuse(man.get("runtime") != "lua54", "The live runtime is lua54")
    refuse(man.get("category") not in categories(), "Use a current store category: " + ", ".join(categories()))
    boards = man.get("boards", ["s3", "p4"])
    refuse(boards not in (["s3"], ["p4"], ["s3", "p4"]), "Boards must be s3, p4, or both in that order")
    settings = man.get("settings", [])
    refuse(not isinstance(settings, list) or len(settings) > 8, "An app has at most 8 settings")
    seen = set()
    for setting in settings:
        refuse(not isinstance(setting, dict) or set(setting) - set(SETTING_ORDER), "Invalid setting fields")
        key, kind, default = setting.get("key"), setting.get("type"), setting.get("default")
        refuse(not isinstance(key, str) or not KEY.fullmatch(key) or key in seen, "Setting keys must be unique")
        seen.add(key)
        refuse(not text(setting.get("label"), 24), "A setting needs a label of at most 24 characters")
        if kind == "text":
            maximum = setting.get("max")
            refuse(type(maximum) is not int or not 1 <= maximum <= 256 or not text(default, maximum), "A text setting needs a default and max of 1 to 256")
        elif kind == "toggle":
            refuse(type(default) is not bool, "A toggle default must be true or false")
        elif kind == "color":
            refuse(not isinstance(default, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", default), "A color default must be #rrggbb")
        elif kind == "choice":
            options = setting.get("options")
            refuse(not isinstance(options, list) or not 2 <= len(options) <= 8 or any(not text(v, 16) for v in options), "A choice needs 2 to 8 options")
            refuse(len(set(options)) != len(options) or default not in options, "A choice needs unique options and a matching default")
        else:
            raise package.Refused("Setting types are text, toggle, color and choice")
        allowed = {"key", "type", "label", "default"} | ({"max"} if kind == "text" else {"options"} if kind == "choice" else set())
        refuse(set(setting) != allowed, "A setting has fields for another type")
    controls = man.get("controls", [])
    refuse(not isinstance(controls, list) or len(controls) > 16, "An app has at most 16 controls")
    seen_controls = set()
    for control in controls:
        refuse(not isinstance(control, dict) or set(control) - set(CONTROL_ORDER), "Invalid control fields")
        key, kind = control.get("key"), control.get("type")
        refuse(not isinstance(key, str) or not KEY.fullmatch(key) or key in seen_controls, "Control keys must be unique")
        seen_controls.add(key)
        refuse(kind not in ("button", "stepper", "readout", "list"), "Unknown control type")
        refuse(not text(control.get("label"), 24), "A control needs a label")
        allowed = {"key", "type", "label"} | ({"arg"} if kind == "button" and "arg" in control else {"min", "max"} if kind == "stepper" else {"max", "chars", "add"} if kind == "list" else set())
        refuse(set(control) != allowed, "A control has fields for another type")
        for field in re.findall(r"\{([^{}]+)\}", control["label"]):
            refuse(not any(s["key"] == field and s["type"] == "text" for s in settings), "Control labels refer only to text settings")
        if kind == "stepper":
            low, high = control.get("min"), control.get("max")
            refuse(type(low) is not int or type(high) is not int or not -99999 <= low < high <= 99999, "A stepper needs min and max")
        if kind == "button" and "arg" in control:
            refuse(type(control["arg"]) is not int or not 0 <= control["arg"] <= 86400, "Button arg must be 0 to 86400")
        if kind == "list":
            refuse(type(control.get("max")) is not int or not 1 <= control["max"] <= 8 or type(control.get("chars")) is not int or not 1 <= control["chars"] <= 16 or not text(control.get("add"), 24), "A list needs max, chars and add")
    sources = man.get("sources", [])
    refuse(not isinstance(sources, list) or len(sources) > 4, "An app has at most 4 data sources")
    seen_sources = set()
    for source in sources:
        refuse(not isinstance(source, dict) or set(source) - set(SOURCE_ORDER), "Invalid source fields")
        key, url, refresh = source.get("key"), source.get("url"), source.get("refresh")
        refuse(not isinstance(key, str) or not KEY.fullmatch(key) or key in seen_sources, "Data source keys must be unique")
        seen_sources.add(key)
        refuse(not isinstance(url, str) or not 1 <= len(url) <= 512 or not package._plain(url), "A source needs a URL or a setting placeholder")
        for group, field in TOKEN.findall(url):
            refuse(group != "settings" or field not in seen, "Source URLs may refer only to declared settings")
        sample = TOKEN.sub("sample", url)
        refuse("{" in sample or "}" in sample, "Invalid source URL placeholder")
        refuse(not (url.startswith("https://") or re.fullmatch(r"\{settings\.[a-z][a-z0-9_]{0,15}\}", url)), "Sources use HTTPS")
        refuse(type(refresh) is not int or not 15 <= refresh <= 86400, "Source refresh must be 15 to 86400 seconds")
        headers = source.get("headers", {})
        refuse(not isinstance(headers, dict) or len(headers) > 4, "A source has at most 4 headers")
        for key, value in headers.items():
            refuse(not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,47}", key) or key.lower() in ("host", "content-length", "connection", "cookie"), "Unsupported source header")
            refuse(not isinstance(value, str) or len(value) > 512 or not package._plain(value), "Invalid source header value")
            refuse(not TOKEN.search(value), "Put API credentials in local secrets, never in the package")
            for group, field in TOKEN.findall(value):
                refuse(group == "settings" and field not in seen, "Header settings must be declared")
            sample = TOKEN.sub("sample", value)
            refuse("{" in sample or "}" in sample, "Invalid source header placeholder")
    return man


def canonical(man):
    result = {key: man[key] for key in ORDER if key in man}
    for field, order in (("settings", SETTING_ORDER), ("controls", CONTROL_ORDER), ("sources", SOURCE_ORDER)):
        if field in result:
            result[field] = [{key: item[key] for key in order if key in item} for item in result[field]]
    return (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def zip_bytes(entries):

    local, central = bytearray(), bytearray()
    for name, body in entries:
        encoded = name.encode("ascii")
        crc, size, offset = zlib.crc32(body), len(body), len(local)
        local.extend(struct.pack("<I5H3I2H", 0x04034b50, 10, 0, 0, 0, 0x21, crc, size, size, len(encoded), 0) + encoded + body)
        central.extend(struct.pack("<I6H3I5H2I", 0x02014b50, 0x314, 10, 0, 0, 0, 0x21, crc, size, size, len(encoded), 0, 0, 0, 0, 0o100644 << 16, offset) + encoded)
    return bytes(local + central + struct.pack("<I4H2IH", 0x06054b50, 0, 0, len(entries), len(entries), len(central), len(local), 0))


def build(app_dir, out_dir=None):
    folder = Path(app_dir).resolve()
    try:
        man = check(json.loads((folder / "mooboard.json").read_text(encoding="utf-8"), object_pairs_hook=unique))
        source = (folder / "app.lua").read_bytes()
        refuse(not 0 < len(source) <= 65536 or source.startswith(b"\x1b"), "App source must be UTF-8 Lua text of at most 64 KB")
        source.decode("utf-8")
        from .native import Runtime
        runtime = Runtime(source, {s["key"]: s["default"] for s in man.get("settings", [])})
        runtime.frame({"monoMs": 0, "elapsedMs": 0, "epochSec": 0, "hour": 12, "minute": 0, "second": 0, "timeValid": False, "clock24": False, "seconds": True, "night": False, "online": False})
        runtime.state()
        runtime.close()
        icon = (folder / "icon.png").read_bytes() if (folder / "icon.png").exists() else png.encode(32, 32, bytes([119, 237, 215]) * 1024)
        package.check_icon(icon)
        manifest = canonical(man)
        refuse(len(manifest) > 8192, "The built manifest exceeds 8 KB")
        body = zip_bytes((("mooboard.json", manifest), ("app.lua", source), ("icon.png", icon)))
        refuse(len(body) > CAP, "The live package exceeds 352 KB")
        output = Path(out_dir).resolve() if out_dir else folder / "build"
        output.mkdir(parents=True, exist_ok=True)
        path = output / (man["id"] + ".mooboard")
        path.write_bytes(body)
        row = {"mooboard": 1, "id": man["id"], "name": man["name"], "refresh": 300,
               "duration": 15, "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "built": "2026-01-01T00:00:00Z"}
        release = output / "mooboard.json"
        release.write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
        return Built(str(path), str(release), man, [])
    except package.Refused:
        raise
    except (OSError, ValueError, TypeError, RuntimeError, RecursionError, KeyError) as error:
        raise package.Refused(str(error)) from error


def install(built, board, password=None):
    refuse(built.manifest.get("format") == 2, "Native renderer presets use the store submission path. File installation supports custom Lua apps and picture apps")
    address = urllib.parse.urlsplit(board if "://" in board else "http://" + board)
    refuse(address.scheme not in ("http", "https") or not address.hostname or address.username or address.password or address.path not in ("", "/") or address.query or address.fragment, "Use the board's local address")
    root = urllib.parse.urlunsplit((address.scheme, address.netloc, "", "", ""))
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(path, body=None, content_type="application/json"):
        headers = {"X-Mooboard": "1", "Content-Type": content_type}
        req = urllib.request.Request(root + path, body, headers, method="POST" if body is not None else "GET")
        with opener.open(req, timeout=15) as response:
            result = json.load(response)
        refuse(not isinstance(result, dict), "The board returned an invalid response")
        return result
    password = password if password is not None else os.environ.get("MOOBOARD_PASSWORD")
    if password:
        request("/api/login", json.dumps({"password": password}).encode())
    capability = request("/api/developer")
    refuse(not capability.get("enabled"), "Enable Developer mode in the board's Settings before installing")
    refuse(built.manifest.get("format") == 3 and capability.get("runtime") != "lua54", "Install compatible v3 firmware on the board before installing a custom app")
    request("/api/apps/upload", Path(built.package).read_bytes(), "application/zip")
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        result = request("/api/apps/install")
        state = result.get("state")
        if state == "done":
            refuse(result.get("id") != built.manifest["id"], "Another install replaced this job. Check the app list on the board")
            return result
        refuse(state in ("error", "failed", "idle"), "Installation did not finish: " + str(result.get("error") or result.get("message") or state))
        time.sleep(0.25)
    raise package.Refused("Installation is still pending. Check the app list on the board")


def create(app_dir, author, category=None, template="tool"):
    import shutil
    destination = Path(app_dir).resolve()
    refuse(destination.exists(), "Choose a new app folder")
    source = Path(__file__).resolve().parent.parent / "samples" / "custom" / template
    refuse(not source.is_dir(), "Templates are data, clock, ambiance, game and tool")
    category = category or {"clock": "Clock Faces", "ambiance": "Ambiance", "game": "Games"}.get(template, "Tools")
    refuse(category not in categories(), "Choose a current store category")
    name = destination.name
    app_id = "-".join("".join(ch if ch.isascii() and ch.isalnum() else " " for ch in name.lower()).split())
    refuse(not 3 <= len(app_id) <= 32, "Choose a name with 3 to 32 letters, numbers and hyphens")
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns("build", "__pycache__"))
    manifest = json.loads((destination / "mooboard.json").read_text(encoding="utf-8"))
    manifest.update(id=app_id, name=name, by=author, category=category)
    try:
        check(manifest)
        (destination / "mooboard.json").write_bytes(canonical(manifest))
    except Exception:
        shutil.rmtree(destination)
        raise
    return str(destination)
