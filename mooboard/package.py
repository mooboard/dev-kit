import collections
import itertools
import json
import re
import struct
import unicodedata
import zlib

from . import gif, png, text
from .screen import Canvas, Screen, TooLong, blend

W, H = 128, 32
MAX_PACKAGE = 352 * 1024
MAX_ENTRIES = 11
MANIFEST_CAP = 8 * 1024
GIF_CAP = 256 * 1024
DECODE_CAP = 4 * 1024 * 1024
ICON_CAP = 8 * 1024
IMAGE_CAP = 8 * 1024
MAX_IMAGES = 8
MAX_FRAMES = 100
SHORTEST_MS = 30
LOWEST_LIT = 5
MAX_SETTINGS = 8
MAX_LAYERS = 8
MAX_DEPTH = 4
MAX_COMBINATIONS = 512
ICON = 32
FIELDS = ("mooboard", "id", "name", "author", "refresh", "duration")
EXTRAS = ("settings", "layers")
BUILT = ("frames", "built")
REQUIRED = ("mooboard.json", "app.gif", "icon.png")
SETTING_FIELDS = {"text": {"max"}, "color": set(), "toggle": set(), "choice": {"options"}}
TEXT_LAYER = {"type", "text", "size", "font", "color", "x", "y", "align", "show"}
SETTING_ORDER = ("key", "type", "label", "default", "max", "options")
LAYER_ORDER = ("type", "text", "src", "x", "y", "size", "font", "color", "align", "show")
IMAGE_LAYER = {"type", "src", "x", "y", "show"}
VARIANT_COLORS = ("#77edd7", "#ffb7c9")
ID = re.compile(r"[a-z0-9-]{3,32}")
# the store's own app ids and every built in renderer's name + a board refuses a gif app with one at install
# + the catalog renderers and built-in messages app
RESERVED_IDS = ("prayer", "countdowns", "countdown", "sketch", "life", "plasma", "starfield", "fireplace", "pong",
                "snake", "blocks", "maze", "aquarium", "lava", "aurora", "rain", "sunmoon", "word", "quotes",
                "habits", "timer", "pomodoro", "scoreboard", "dice", "breakout", "invaders", "flappy", "cycles",
                "fireworks", "nightcity", "snowglobe", "raincode", "oktowake", "chores", "facts", "jokes",
                "intervals", "chessclock", "wheel", "tally", "vfdstereo", "microracer", "pixelpinball", "microrogue",
                "spacelander", "messages")
AUTHOR = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}")
KEY = re.compile(r"[a-z][a-z0-9_]{0,15}")
COLOR = re.compile(r"#[0-9a-fA-F]{6}")
IMAGE = re.compile(r"images/[a-z0-9-]{1,32}\.png")
STAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
WORD = re.compile(r"\{([^{}]*)\}")
LOCAL, CENTRAL, END = 0x04034B50, 0x02014B50, 0x06054B50
ZIP_DATE = 0x21
UNIX = 3
MADE_BY = (UNIX << 8) | 20
NEEDED = 10
REGULAR = 0o100644

MANIFEST_MISSING = "No mooboard.json"
MANIFEST_JSON = "mooboard.json is not a JSON object"
MANIFEST_DEEP = "mooboard.json is nested too deep"
MANIFEST_ESCAPE = "mooboard.json has an escape that is not a whole character"
MANIFEST_PLAIN = "mooboard.json has a hidden or control character"
NEEDS = "mooboard.json needs {key}"
UNKNOWN = "Unknown key in mooboard.json: {key}"
VERSION = "mooboard must be 1"
ID_WORDS = "id must be 3 to 32 lowercase letters, digits or dashes"
ID_TAKEN = "id {id} is taken by a mooboard app"
NAME = "name must be 1 to 24 characters"
NAME_LINK = "name can’t be a link"
AUTHOR_WORDS = "author must be a GitHub username"
REFRESH = "refresh must be 300 to 86400 seconds"
DURATION = "duration must be 5 to 60 seconds"
SETTINGS = "settings must be a list of up to 8"
SETTING = "Setting {name} needs a key, a type, a label of up to 24 characters and a default"
SETTING_TWICE = "Two settings have the key {name}"
SETTING_TYPE = {"text": "Setting {name} needs a max of 1 to 32 and a default no longer than it", "color": "Setting {name} needs a default color like #ffb7c9",
                "toggle": "Setting {name} needs a default of true or false", "choice": "Setting {name} needs 2 to 8 different options of 1 to 16 characters and one as its default"}
LAYERS = "layers must be a list of up to 8"
LAYER = "Layer {number} is not a text or image layer"
LAYER_SETTING = "Layer {number} can’t use {key}"
LAYER_IMAGE = "Layer {number} uses {src}, which the app does not have"
LAYER_FIT = "Layer {number} is too long for the screen with {words}"
LAYER_MANY = "Layer {number} uses too many choices at once"
UNREADABLE = "Can’t read {name}"
SIZE = "Not 128×32"
FRAMES = "More than 100 frames"
BYTES = "app.gif is over 256 KB"
FAST = "Frames shorter than 30 ms"
EDGE = "Lit pixels in the edge ring"
DIM = "Colors too dim to light"
ICON_WORDS = "icon.png must be a 32×32 PNG of up to 8 KB"
IMAGE_WORDS = "{name} must be a PNG of up to 128×32 and 8 KB"
PACKAGE_BIG = "The package is over 352 KB"
PACKAGE_BAD = "Not a mooboard package"
PACKAGE_MISSING = "The package has no {name}"

Picture = collections.namedtuple("Picture", "frames warnings")
App = collections.namedtuple("App", "manifest gif frames icon images warnings")


class Refused(Exception):
    def __init__(self, line):
        super().__init__(line)
        self.line = line


def _number(value, low, high):
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def _unique(pairs):
    keys = [key for key, _ in pairs]
    if len(set(keys)) != len(keys):
        raise ValueError(keys)
    return dict(pairs)


def _settings(items):
    if not isinstance(items, list) or len(items) > MAX_SETTINGS:
        raise Refused(SETTINGS)
    found = {}
    for number, setting in enumerate(items, 1):
        key = setting.get("key") if isinstance(setting, dict) else None
        name = key if isinstance(key, str) else "#%d" % number
        kind = setting.get("type") if isinstance(setting, dict) else None
        label = setting.get("label") if isinstance(setting, dict) else None
        if (not isinstance(kind, str) or kind not in SETTING_FIELDS or not isinstance(key, str) or not KEY.fullmatch(key)
                or not isinstance(label, str) or not 1 <= len(label) <= 24 or "default" not in setting
                or set(setting) - {"key", "type", "label", "default"} - SETTING_FIELDS[kind]):
            raise Refused(SETTING.format(name=name))
        if key in found:
            raise Refused(SETTING_TWICE.format(name=name))
        default = setting["default"]
        if kind == "text":
            limit = setting.get("max")
            good = isinstance(default, str) and _number(limit, 1, 32) and 1 <= len(default) <= limit
        elif kind == "color":
            good = isinstance(default, str) and COLOR.fullmatch(default) is not None
        elif kind == "toggle":
            good = isinstance(default, bool)
        else:
            options = setting.get("options")
            good = (isinstance(options, list) and 2 <= len(options) <= 8
                    and all(isinstance(o, str) and 1 <= len(o) <= 16 for o in options)
                    and len(set(options)) == len(options) and default in options)
        if not good:
            raise Refused(SETTING_TYPE[kind].format(name=name))
        found[key] = setting
    return found


def _shown(layer, values):
    show = layer.get("show")
    if show is None:
        return True
    key, _, option = show.partition("=")
    return values.get(key) == option if option else bool(values.get(key))


def _layers(items, settings, images):
    if not isinstance(items, list) or len(items) > MAX_LAYERS:
        raise Refused(LAYERS)
    kinds = {key: s["type"] for key, s in settings.items()}
    for number, layer in enumerate(items, 1):
        kind = layer.get("type") if isinstance(layer, dict) else None
        if kind == "text":
            good = ({"type", "text", "size"} <= set(layer) <= TEXT_LAYER and isinstance(layer["text"], str)
                    and _number(layer["size"], 0, 99) and layer["size"] in text.SIZES
                    and layer.get("font", "nunito") in text.FONTS
                    and layer.get("align", "left") in ("left", "center", "right")
                    and isinstance(layer.get("color", "#ffffff"), str))
        elif kind == "image":
            good = {"type", "src", "x", "y"} <= set(layer) <= IMAGE_LAYER and isinstance(layer["src"], str)
            good = good and IMAGE.fullmatch(layer["src"]) is not None
        else:
            good = False
        # a null x or y is a value the board refuses + only a missing one means the middle
        good = good and all(axis not in layer or _number(layer[axis], 0, top)
                            for axis, top in (("x", W - 1), ("y", H - 1)))
        good = good and isinstance(layer.get("show", ""), str)
        if not good:
            raise Refused(LAYER.format(number=number))
        uses = []
        if kind == "text":
            uses += [(key, ("text", "choice")) for key in WORD.findall(layer["text"])]
            color = layer.get("color", "#ffffff")
            if not COLOR.fullmatch(color):
                # a color setting is named in braces as the board reads it + a bare name is refused
                found = WORD.fullmatch(color)
                if not found:
                    raise Refused(LAYER_SETTING.format(number=number, key=color))
                uses.append((found.group(1), ("color",)))
        for key, want in uses:
            if kinds.get(key) not in want:
                raise Refused(LAYER_SETTING.format(number=number, key=key))
        if "show" in layer:
            key, _, option = layer["show"].partition("=")
            if option:
                good = kinds.get(key) == "choice" and option in settings[key]["options"]
            else:
                good = kinds.get(key) == "toggle"
            if not good:
                raise Refused(LAYER_SETTING.format(number=number, key=layer["show"]))
        if kind == "image" and images is not None and layer["src"] not in images:
            raise Refused(LAYER_IMAGE.format(number=number, src=layer["src"]))


def _defaults(settings):
    return {key: s["default"] for key, s in settings.items()}


def _fit_sets(layer, settings, number):
    """every set of values a text layer can show + its choices in every combination with the rest at default"""
    keys = sorted({key for key in WORD.findall(layer["text"]) if settings[key]["type"] == "choice"})
    total = 1
    for key in keys:
        total *= len(settings[key]["options"])
    if total > MAX_COMBINATIONS:
        raise Refused(LAYER_MANY.format(number=number))
    defaults = _defaults(settings)
    return [dict(defaults, **dict(zip(keys, chosen)))
            for chosen in itertools.product(*(settings[key]["options"] for key in keys))]


def _words(layer, values):
    return WORD.sub(lambda found: str(values[found.group(1)]), layer["text"])


def _fits(layer, words):
    try:
        Screen().text(words, x=layer.get("x"), y=layer.get("y"), size=layer["size"],
                      font=layer.get("font", "nunito"), align=layer.get("align", "left"))
    except TooLong:
        return False
    return True


def _depth(value):
    deepest, stack = 0, [(value, 1)]
    while stack and deepest <= MAX_DEPTH:
        item, level = stack.pop()
        if isinstance(item, (dict, list)):
            deepest = max(deepest, level)
            stack.extend((v, level + 1) for v in (item.values() if isinstance(item, dict) else item))
    return deepest


def _texts(value):
    """every key and text in value"""
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            stack.extend(item)
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, str):
            yield item


def _whole(value):
    """every key and text in value is whole characters + an escape of half a surrogate pair is not"""
    for text in _texts(value):
        try:
            text.encode("utf-8")
        except UnicodeEncodeError:
            return False
    return True


def _hidden(cp):
    """a control, format, bidi, private use or noncharacter code point as the board refuses it in any text"""
    if cp < 0x20 or 0x7F <= cp <= 0x9F:
        return True
    if (cp == 0xAD or 0x600 <= cp <= 0x605 or cp in (0x61C, 0x6DD, 0x70F, 0x890, 0x891, 0x8E2, 0x180E)
            or 0x200B <= cp <= 0x200F or 0x202A <= cp <= 0x202E or 0x2060 <= cp <= 0x2064
            or 0x2066 <= cp <= 0x206F or cp == 0xFEFF or 0xFFF9 <= cp <= 0xFFFB or cp in (0x110BD, 0x110CD)
            or 0x13430 <= cp <= 0x1343F or 0x1BCA0 <= cp <= 0x1BCA3 or 0x1D173 <= cp <= 0x1D17A or cp == 0xE0001
            or 0xE0020 <= cp <= 0xE007F):
        return True
    if 0xE000 <= cp <= 0xF8FF or cp >= 0xF0000:
        return True
    return 0xFDD0 <= cp <= 0xFDEF or (cp & 0xFFFE) == 0xFFFE


def _plain(value):
    """no key or text in value holds a hidden or control character"""
    return not any(_hidden(ord(ch)) for text in _texts(value) for ch in text)


def check_manifest(data, built=False, images=None):
    try:
        manifest = json.loads(bytes(data).decode("utf-8"), object_pairs_hook=_unique)
    except RecursionError:
        raise Refused(MANIFEST_DEEP)
    except ValueError:
        raise Refused(MANIFEST_JSON)
    if _depth(manifest) > MAX_DEPTH:
        raise Refused(MANIFEST_DEEP)
    if not isinstance(manifest, dict):
        raise Refused(MANIFEST_JSON)
    if not _whole(manifest):
        raise Refused(MANIFEST_ESCAPE)
    if not _plain(manifest):
        raise Refused(MANIFEST_PLAIN)
    for key in FIELDS + (BUILT if built else ()):
        if key not in manifest:
            raise Refused(NEEDS.format(key=key))
    allowed = set(FIELDS) | set(EXTRAS) | (set(BUILT) if built else set())
    for key in manifest:
        if key not in allowed:
            raise Refused(UNKNOWN.format(key=key))
    if not _number(manifest["mooboard"], 1, 1):
        raise Refused(VERSION)
    if not isinstance(manifest["id"], str) or not ID.fullmatch(manifest["id"]):
        raise Refused(ID_WORDS)
    if manifest["id"] in RESERVED_IDS:
        raise Refused(ID_TAKEN.format(id=manifest["id"]))
    name = manifest["name"]
    if (not isinstance(name, str) or not 1 <= len(name) <= 24 or not name.strip()
            or any(unicodedata.category(ch)[0] == "C" for ch in name)):
        raise Refused(NAME)
    if "://" in name:
        raise Refused(NAME_LINK)
    if not isinstance(manifest["author"], str) or not AUTHOR.fullmatch(manifest["author"]):
        raise Refused(AUTHOR_WORDS)
    if not _number(manifest["refresh"], 300, 86400):
        raise Refused(REFRESH)
    if not _number(manifest["duration"], 5, 60):
        raise Refused(DURATION)
    if built and (not _number(manifest["frames"], 1, MAX_FRAMES) or not isinstance(manifest["built"], str)
                  or not STAMP.fullmatch(manifest["built"])):
        raise Refused(PACKAGE_BAD)
    settings = _settings(manifest.get("settings", []))
    layers = manifest.get("layers", [])
    _layers(layers, settings, images)
    for number, layer in enumerate(layers, 1):
        if layer["type"] != "text":
            continue
        for values in _fit_sets(layer, settings, number):
            if not _fits(layer, _words(layer, values)):
                raise Refused(LAYER_FIT.format(number=number, words=_words(layer, values)))
    return manifest


def _lit(rgb, i):
    return max(rgb[i * 3:i * 3 + 3]) >= LOWEST_LIT


def _ring_lit(rgb):
    return any(_lit(rgb, y * W + x) for y in range(H) for x in range(W) if x in (0, W - 1) or y in (0, H - 1))


def _dim(rgb):
    for i in range(W * H):
        top = max(rgb[i * 3:i * 3 + 3])
        if 0 < top < LOWEST_LIT:
            x, y = i % W, i // W
            if not any(0 <= x + dx < W and 0 <= y + dy < H and _lit(rgb, (y + dy) * W + x + dx)
                       for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy):
                return True
    return False


def check_frames(frames):
    if any(_ring_lit(rgb) for rgb, _ in frames):
        raise Refused(EDGE)
    return [DIM] if any(_dim(rgb) for rgb, _ in frames) else []


def check_picture(data):
    data = bytes(data)
    if len(data) < 13 or data[:3] != b"GIF":
        raise Refused(UNREADABLE.format(name="app.gif"))
    if struct.unpack("<HH", data[6:10]) != (W, H):
        raise Refused(SIZE)
    if len(data) > DECODE_CAP:
        raise Refused(BYTES)
    try:
        _, _, frames = gif.decode(data, whole=True)
    except gif.Unreadable:
        raise Refused(UNREADABLE.format(name="app.gif"))
    if len(frames) > MAX_FRAMES:
        raise Refused(FRAMES)
    if len(data) > GIF_CAP:
        raise Refused(BYTES)
    if len(frames) > 1 and any(ms < SHORTEST_MS for _, ms in frames):
        raise Refused(FAST)
    return Picture(frames, check_frames(frames))


def _png_within(data, cap, fits, line):
    try:
        if len(data) > cap or not fits(*png.size(data)):
            raise png.Unreadable()
        return png.decode(data)
    except png.Unreadable:
        raise Refused(line)


def check_icon(data):
    return _png_within(data, ICON_CAP, lambda w, h: (w, h) == (ICON, ICON), ICON_WORDS)


def check_image(name, data):
    return _png_within(data, IMAGE_CAP, lambda w, h: 1 <= w <= W and 1 <= h <= H, IMAGE_WORDS.format(name=name))


class _Recorder(Canvas):
    def __init__(self):
        super().__init__()
        self.ops = []

    def set(self, x, y, color):
        self.blend(x, y, color, 1.0)

    def blend(self, x, y, color, t):
        if self.clip[0] <= x <= self.clip[2] and self.clip[1] <= y <= self.clip[3]:
            self.ops.append(((y * W + x) * 3, tuple(color), t))


def _overlay(app, values):
    screen = Screen()
    screen._canvas = recorder = _Recorder()
    for layer in app.manifest.get("layers", []):
        if not _shown(layer, values):
            continue
        if layer["type"] == "image":
            screen.image_rgba(*app.images[layer["src"]], layer["x"], layer["y"])
            continue
        color = layer.get("color", "#ffffff")
        if not COLOR.fullmatch(color):
            color = values[color[1:-1]]
        try:
            screen.text(_words(layer, values), x=layer.get("x"), y=layer.get("y"), size=layer["size"],
                        color=color, font=layer.get("font", "nunito"), align=layer.get("align", "left"))
        except TooLong:
            continue
    return recorder.ops


def compose(app, values=None):
    settings = {s["key"]: s for s in app.manifest.get("settings", [])}
    ops = _overlay(app, dict(_defaults(settings), **(values or {})))
    out = []
    for rgb, ms in app.frames:
        px = bytearray(rgb)
        for at, color, t in ops:
            px[at:at + 3] = bytes(blend(px[at:at + 3], color, t))
        out.append((bytes(px), ms))
    return out


def _text_variant(app, setting):
    layers = [layer for layer in app.manifest.get("layers", [])
              if layer["type"] == "text" and "{%s}" % setting["key"] in layer["text"]]
    defaults = _defaults({s["key"]: s for s in app.manifest.get("settings", [])})
    words = setting["label"][:setting["max"]]
    while len(words) > 1 and not all(_fits(layer, _words(layer, dict(defaults, **{setting["key"]: words})))
                                     for layer in layers):
        words = words[:-1]
    return words


def variants(app):
    settings = {s["key"]: s for s in app.manifest.get("settings", [])}
    defaults = _defaults(settings)
    out = [{"key": None, "value": None, "values": dict(defaults)}]
    for key, s in settings.items():
        if s["type"] == "toggle":
            changed = [not s["default"]]
        elif s["type"] == "color":
            changed = [next(c for c in VARIANT_COLORS if c != s["default"].lower())]
        elif s["type"] == "choice":
            changed = [o for o in s["options"] if o != s["default"]]
        else:
            changed = [_text_variant(app, s)]
        out += [{"key": key, "value": value, "values": dict(defaults, **{key: value})} for value in changed]
    return out


def canonical(manifest):
    out = {key: manifest[key] for key in FIELDS if key in manifest}
    if "settings" in manifest:
        out["settings"] = [{key: s[key] for key in SETTING_ORDER if key in s} for s in manifest["settings"]]
    if "layers" in manifest:
        out["layers"] = [{key: layer[key] for key in LAYER_ORDER if key in layer} for layer in manifest["layers"]]
    out.update((key, manifest[key]) for key in BUILT if key in manifest)
    return out


def manifest_bytes(manifest):
    # the one way the writer lays a manifest out, so its order spacing and escapes hold nothing else
    return json.dumps(canonical(manifest), ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def write(manifest, gif_bytes, icon_png, images):
    body = manifest_bytes(manifest)
    entries = [("mooboard.json", body), ("app.gif", bytes(gif_bytes)), ("icon.png", bytes(icon_png))]
    entries += sorted((name, bytes(data)) for name, data in images.items())
    local, central = bytearray(), bytearray()
    for name, data in entries:
        raw = name.encode("ascii")
        crc = zlib.crc32(data) & 0xFFFFFFFF
        header = struct.pack("<HHHHHIII", NEEDED, 0, 0, 0, ZIP_DATE, crc, len(data), len(data))
        offset = len(local)
        local += struct.pack("<I", LOCAL) + header + struct.pack("<HH", len(raw), 0) + raw + data
        central += struct.pack("<IH", CENTRAL, MADE_BY) + header
        central += struct.pack("<HHHHHII", len(raw), 0, 0, 0, 0, REGULAR << 16, offset) + raw
    end = struct.pack("<IHHHHIIH", END, 0, 0, len(entries), len(entries), len(central), len(local), 0)
    return bytes(local + central + end)


def _clean(codec, data):
    try:
        return codec.strip(data) == data
    except (gif.Unreadable, png.Unreadable):
        return True


def _allowed(name):
    return name in REQUIRED or IMAGE.fullmatch(name) is not None


def _entries(data):
    bad = Refused(PACKAGE_BAD)
    if len(data) < 22:
        raise bad
    sig, disk, cd_disk, here, total, cd_size, cd_at, comment = struct.unpack("<IHHHHIIH", data[-22:])
    if sig != END or disk or cd_disk or here != total or total > MAX_ENTRIES or comment:
        raise bad
    if cd_at + cd_size != len(data) - 22:
        raise bad
    found, expected, p = {}, 0, cd_at
    for _ in range(total):
        if p + 46 > cd_at + cd_size:
            raise bad
        (sig, made_by, version, flags, method, time, date, crc, csize, usize, name_len, extra_len, comment_len,
         start_disk, internal, external, offset) = struct.unpack("<IHHHHHHIIIHHHHHII", data[p:p + 46])
        raw = data[p + 46:p + 46 + name_len]
        p += 46 + name_len
        # every field is what write puts there, so no header holds a date or another tool's mark
        if (sig != CENTRAL or made_by != MADE_BY or version != NEEDED or flags or method
                or (time, date) != (0, ZIP_DATE) or csize != usize or extra_len or comment_len or start_disk or internal
                or external != REGULAR << 16 or p > cd_at + cd_size):
            raise bad
        try:
            name = raw.decode("ascii")
        except UnicodeDecodeError:
            raise bad
        if name in found or not _allowed(name):
            raise bad
        if offset != expected or offset + 30 > cd_at:
            raise bad
        head = struct.unpack("<IHHHHHIIIHH", data[offset:offset + 30])
        if head[0] != LOCAL or head[1:9] != (version, flags, method, time, date, crc, csize, usize) or head[10]:
            raise bad
        if data[offset + 30:offset + 30 + head[9]] != raw:
            raise bad
        start = offset + 30 + head[9]
        if start + usize > cd_at:
            raise bad
        body = data[start:start + usize]
        if zlib.crc32(body) & 0xFFFFFFFF != crc:
            raise bad
        expected = start + usize
        found[name] = body
    if p != cd_at + cd_size or expected != cd_at:
        raise bad
    return found


def read(data):
    data = bytes(data)
    if len(data) > MAX_PACKAGE:
        raise Refused(PACKAGE_BIG)
    entries = _entries(data)
    for name in REQUIRED:
        if name not in entries:
            raise Refused(PACKAGE_MISSING.format(name=name))
    if len(entries["mooboard.json"]) > MANIFEST_CAP:
        raise Refused(PACKAGE_BAD)
    pictures = {name: body for name, body in entries.items() if name.startswith("images/")}
    if len(pictures) > MAX_IMAGES or list(entries) != list(REQUIRED) + sorted(pictures):
        raise Refused(PACKAGE_BAD)
    manifest = check_manifest(entries["mooboard.json"], built=True, images=set(pictures))
    if entries["mooboard.json"] != manifest_bytes(manifest):
        raise Refused(PACKAGE_BAD)
    if not _clean(gif, entries["app.gif"]) or not all(_clean(png, body) for name, body in entries.items()
                                                       if name.endswith(".png")):
        raise Refused(PACKAGE_BAD)
    picture = check_picture(entries["app.gif"])
    if manifest["frames"] != len(picture.frames):
        raise Refused(PACKAGE_BAD)
    icon = check_icon(entries["icon.png"])
    images = {name: check_image(name, body) for name, body in pictures.items()}
    used = {layer["src"] for layer in manifest.get("layers", []) if layer["type"] == "image"}
    if set(images) - used:
        raise Refused(PACKAGE_BAD)
    app = App(manifest, entries["app.gif"], picture.frames, icon, images, picture.warnings)
    warnings = list(picture.warnings)
    for variant in variants(app):
        for warning in check_frames(compose(app, variant["values"])):
            if warning not in warnings:
                warnings.append(warning)
    return app._replace(warnings=warnings)


def default_icon(rgb):
    lit = [(i % W, i // W) for i in range(W * H) if _lit(rgb, i)]
    if lit:
        cx = (min(x for x, _ in lit) + max(x for x, _ in lit) + 1) // 2
        cy = (min(y for _, y in lit) + max(y for _, y in lit) + 1) // 2
    else:
        cx, cy = W // 2, H // 2
    x0, y0 = min(max(cx - ICON // 2, 0), W - ICON), min(max(cy - ICON // 2, 0), H - ICON)
    crop = b"".join(rgb[((y0 + y) * W + x0) * 3:((y0 + y) * W + x0 + ICON) * 3] for y in range(ICON))
    return png.encode(ICON, ICON, crop)
