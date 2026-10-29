import collections
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time

from . import gif, package, png
from .package import Refused

TIME_LIMIT = 300
KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NO_APP = "No app.py, app.gif or app.png"
APP_FAILED = "app.py failed"
APP_SLOW = "app.py took over 5 minutes"
APP_NOTHING = "app.py saved no app.gif"

Built = collections.namedtuple("Built", "package release manifest warnings")


def stamp():
    given = os.environ.get("SOURCE_DATE_EPOCH", "")
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(given) if given.isdigit() else int(time.time())))


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _stripped(codec, data):
    try:
        return codec.strip(data)
    except (gif.Unreadable, png.Unreadable):
        return data


def make_picture(app_dir):
    if os.path.isfile(os.path.join(app_dir, "app.py")):
        with tempfile.TemporaryDirectory(prefix="mooboard-") as out:
            path = os.environ.get("PYTHONPATH")
            env = dict(os.environ, MOOBOARD_OUT=out, PYTHONPATH=KIT + (os.pathsep + path if path else ""))
            try:
                done = subprocess.run([sys.executable, "app.py"], cwd=app_dir, env=env, timeout=TIME_LIMIT)
            except subprocess.TimeoutExpired:
                raise Refused(APP_SLOW)
            if done.returncode != 0:
                raise Refused(APP_FAILED)
            saved = os.path.join(out, "app.gif")
            if not os.path.isfile(saved):
                raise Refused(APP_NOTHING)
            return _read(saved)
    if os.path.isfile(os.path.join(app_dir, "app.gif")):
        return _read(os.path.join(app_dir, "app.gif"))
    if os.path.isfile(os.path.join(app_dir, "app.png")):
        try:
            w, h, rgba = png.decode(_read(os.path.join(app_dir, "app.png")))
        except png.Unreadable:
            raise Refused(package.UNREADABLE.format(name="app.png"))
        if (w, h) != (package.W, package.H):
            raise Refused(package.SIZE)
        return gif.encode([(png.over_black(rgba), 1000)])
    raise Refused(NO_APP)


def build(app_dir, out_dir=None):
    app_dir = os.path.abspath(app_dir)
    path = os.path.join(app_dir, "mooboard.json")
    if not os.path.isfile(path):
        raise Refused(package.MANIFEST_MISSING)
    try:
        manifest_kind = json.loads(_read(path))
    except (ValueError, UnicodeError, RecursionError):
        manifest_kind = None
    if isinstance(manifest_kind, dict) and "format" in manifest_kind:
        if manifest_kind.get("format") == 3:
            from . import live
            return live.build(app_dir, out_dir)
        from . import catalog
        return catalog.build(app_dir, out_dir)
    folder = os.path.join(app_dir, "images")
    available = ({"images/" + n for n in os.listdir(folder) if n.endswith(".png")
                  and os.path.isfile(os.path.join(folder, n))} if os.path.isdir(folder) else set())
    manifest = package.check_manifest(_read(path), images=available)
    gif_bytes = _stripped(gif, make_picture(app_dir))
    picture = package.check_picture(gif_bytes)
    images = {}
    for layer in manifest.get("layers", []):
        if layer["type"] == "image" and layer["src"] not in images:
            images[layer["src"]] = _stripped(png, _read(os.path.join(app_dir, layer["src"])))
            package.check_image(layer["src"], images[layer["src"]])
    whole = {key: manifest[key] for key in package.FIELDS + package.EXTRAS if key in manifest}
    whole.update(frames=len(picture.frames), built=stamp())
    icon_path = os.path.join(app_dir, "icon.png")
    if os.path.isfile(icon_path):
        icon = _stripped(png, _read(icon_path))
        package.check_icon(icon)
    else:
        decoded = {name: package.check_image(name, data) for name, data in images.items()}
        first = package.compose(package.App(whole, gif_bytes, picture.frames[:1], None, decoded, []))[0][0]
        icon = package.default_icon(first)
    data = package.write(whole, gif_bytes, icon, images)
    app = package.read(data)
    out = out_dir or os.path.join(app_dir, "build")
    os.makedirs(out, exist_ok=True)
    package_path = os.path.join(out, "%s.mooboard" % manifest["id"])
    with open(package_path, "wb") as f:
        f.write(data)
    release = {key: manifest[key] for key in package.FIELDS}
    release.update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), built=whole["built"])
    release_path = os.path.join(out, "mooboard.json")
    with open(release_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(release, ensure_ascii=False, indent=2) + "\n")
    return Built(package_path, release_path, whole, app.warnings)
