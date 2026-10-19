import base64
import html
import json
import os
import pathlib
import re
import webbrowser

from . import package, png

HERE = os.path.dirname(os.path.abspath(__file__))
PLAYER = os.path.join(HERE, "player")
PREVIEWER = os.path.join(os.path.dirname(HERE), "previewer")
TIMES = ("day", "evening", "night")

DEFAULT = "Default"
VARIANT = "{label}: {value}"
ON = "On"
OFF = "Off"


def _text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _coded(data):
    return base64.b64encode(data).decode("ascii")


def label(app, variant):
    if variant["key"] is None:
        return DEFAULT
    setting = next(s for s in app.manifest["settings"] if s["key"] == variant["key"])
    value = variant["value"]
    if isinstance(value, bool):
        value = ON if value else OFF
    return VARIANT.format(label=setting["label"], value=value)


def page(app):
    variants = []
    for variant in package.variants(app):
        entry = {"label": label(app, variant)}
        if app.manifest.get("layers"):
            frames = package.compose(app, variant["values"])
            stacked = png.encode(package.W, package.H * len(frames), b"".join(rgb for rgb, _ in frames), squeeze=True)
            entry.update(png=_coded(stacked), delays=[ms for _, ms in frames])
        else:
            entry.update(gif=_coded(app.gif))
        variants.append(entry)
    clips = {}
    for time in TIMES:
        with open(os.path.join(PLAYER, time + ".png"), "rb") as f:
            clips[time] = _coded(f.read())
    data = {"duration": app.manifest["duration"], "variants": variants, "clips": clips}
    parts = {"<!--name-->": html.escape(app.manifest["name"]),
             "/*style*/": _text(os.path.join(PREVIEWER, "style.css")) + _text(os.path.join(PLAYER, "player.css")),
             "/*data*/": json.dumps(data).replace("<", "\\u003c"),
             "/*previewer*/": _text(os.path.join(PREVIEWER, "previewer.js")).replace("</", "<\\/"),
             "/*player*/": _text(os.path.join(PLAYER, "player.js")).replace("</", "<\\/")}
    marker = re.compile("|".join(re.escape(key) for key in parts))
    return marker.sub(lambda found: parts[found.group(0)], _text(os.path.join(PLAYER, "player.html")))


def write(built):
    with open(built.package, "rb") as f:
        app = package.read(f.read())
    path = os.path.join(os.path.dirname(built.package), "play.html")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(page(app))
    return path


def show(path):
    webbrowser.open(pathlib.Path(os.path.abspath(path)).as_uri())
