"""Build packages for the live renderers present in board firmware."""
import hashlib
import json
import os
import shutil
import tempfile

from . import catalog_rules as rules, package
from .build import Built

from pathlib import Path
CATEGORIES = tuple(json.loads(Path(__file__).with_name("categories.json").read_text(encoding="utf-8")))
CATEGORY_LABELS = {key: key for key in CATEGORIES}
GROUPS = {key:tuple(value) for key,value in json.loads(Path(__file__).with_name("presets.json").read_text(encoding="utf-8")).items()}
RECENT = {"vfdstereo", "microracer", "pixelpinball", "microrogue", "spacelander"}
SAMPLES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples", "live")


def category_key(value):
    for key in CATEGORIES:
        if value.casefold().replace(" ", "") == key.casefold().replace(" ", ""):
            return key
    raise package.Refused("Use a current store category: " + ", ".join(CATEGORIES))


def check_category(category, uses):
    if category not in CATEGORIES:
        raise package.Refused("Use a current store category: " + ", ".join(CATEGORIES))
    if category in ("Clock", "Clock Faces"):
        raise package.Refused("Create a custom clock with --template clock; renderer presets do not install clock faces")
    if uses not in GROUPS[category]:
        raise package.Refused("%s does not provide a %s app. Choose a renderer listed by python3 -m mooboard renderers" % (uses, CATEGORY_LABELS[category]))


def _manifest(app_dir):
    path = os.path.join(app_dir, "mooboard.json")
    try:
        with open(path, "rb") as f:
            body = f.read(rules.MANIFEST_CAP + 1)
        man = json.loads(body.decode("utf-8"), object_pairs_hook=rules._unique)
        if not isinstance(man, dict) or not all(isinstance(man.get(k), str) for k in ("name", "uses", "category")):
            raise ValueError()
        # Apply the same whole-string check as the GIF reader, including hidden characters in values.
        if not package._plain(man):
            raise package.Refused(package.MANIFEST_PLAIN)
        check_category(man["category"], man["uses"])
        checked = rules.check_manifest(body, man["category"], man["name"])
        minimum = "0.3.2" if man["uses"] in RECENT else "0.3.1"
        if tuple(map(int, checked.get("minFirmware", "0.0.0").split("."))) < tuple(map(int, minimum.split("."))):
            raise package.Refused("%s needs minFirmware %s or later" % (man["uses"], minimum))
        return checked
    except rules.Refused as error:
        raise package.Refused(str(error))
    except (OSError, ValueError, TypeError, RecursionError, KeyError, UnicodeError) as error:
        raise package.Refused("Cannot read mooboard.json as a live app manifest") from error


def _no_links(app_dir):
    for folder, dirs, files in os.walk(app_dir, followlinks=False):
        if folder == app_dir:
            dirs[:] = [name for name in dirs if name not in ("build", ".git", "__pycache__")]
        for name in dirs + files:
            if os.path.islink(os.path.join(folder, name)):
                raise package.Refused("An app must contain its files directly, without symbolic links")


def build(app_dir, out_dir=None):
    app_dir = os.path.abspath(app_dir)
    manifest = _manifest(app_dir)
    _no_links(app_dir)
    try:
        man, icon, data, boards, count, *_ = rules.load_app("", manifest["category"], manifest["name"], app_dir=app_dir)
    except (rules.Refused, OSError, ValueError, TypeError, RecursionError, UnicodeError, KeyError) as error:
        raise package.Refused(str(error)) from error
    out = os.path.abspath(out_dir or os.path.join(app_dir, "build"))
    os.makedirs(out, exist_ok=True)
    name = "%s-%s.mooboard" % (man["id"], man["version"])
    package_path = os.path.join(out, name)
    with open(package_path, "wb") as f:
        f.write(data)
    release = {key: man[key] for key in ("id", "name", "version", "by", "description", "category", "uses", "minFirmware")}
    release.update(boards=boards, file=name, size=len(data), sha256=hashlib.sha256(data).hexdigest())
    release_path = os.path.join(out, "mooboard.json")
    with open(release_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(release, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return Built(package_path, release_path, man, [])


def create(app_dir, uses, author, category=None):
    if uses not in rules.CATALOG_USES:
        raise package.Refused("Unknown renderer. Run python3 -m mooboard renderers")
    category = category_key(category) if category else next(key for key in GROUPS if uses in GROUPS[key])
    check_category(category, uses)
    app_dir = os.path.abspath(app_dir)
    if os.path.lexists(app_dir):
        raise package.Refused("The app folder already exists. Choose a new folder")
    name = os.path.basename(app_dir)
    app_id = "-".join("".join(ch if ch.isascii() and ch.isalnum() else " " for ch in name.lower()).split())
    if not app_id or len(app_id) > 32:
        raise package.Refused("Choose an app name that gives an id of 1 to 32 letters, digits, and hyphens")
    parent = os.path.dirname(app_dir)
    os.makedirs(parent, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".mooboard-", dir=parent) as scratch:
        staged = os.path.join(scratch, "app")
        shutil.copytree(os.path.join(SAMPLES, uses), staged,
                        ignore=shutil.ignore_patterns("build", "__pycache__", ".git", ".DS_Store"))
        with open(os.path.join(staged, "mooboard.json"), encoding="utf-8") as f:
            man = json.load(f)
        man.update(id=app_id, name=name, by=author, category=category, version="1.0.0")
        with open(os.path.join(staged, "mooboard.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(man, f, ensure_ascii=False, indent=2)
            f.write("\n")
        _manifest(staged)
        os.rename(staged, app_dir)
    return app_dir
