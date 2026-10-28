#!/usr/bin/env python3
"""Build every live starter twice and check package integrity using Python's independent ZIP reader."""
import hashlib
import json
import os
import sys
import tempfile
import zipfile

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KIT)
from mooboard import catalog, live


def main():
    with tempfile.TemporaryDirectory(prefix="mooboard-live-") as work:
        for uses in (name for group in catalog.GROUPS.values() for name in group):
            folder = catalog.create(os.path.join(work, "My " + uses.title()), uses, "octocat")
            first = catalog.build(folder)
            with open(first.package, "rb") as f:
                before = f.read()
            second = catalog.build(folder)
            with open(second.package, "rb") as f:
                if f.read() != before:
                    raise ValueError("package changed on a second build: " + uses)
            with zipfile.ZipFile(second.package) as archive:
                if archive.testzip() is not None:
                    raise ValueError("ZIP integrity failed: " + uses)
                manifest = json.loads(archive.read("mooboard.json"))
                if manifest["uses"] != uses or manifest["format"] != 2:
                    raise ValueError("renderer changed: " + uses)
                if archive.namelist()[:2] != ["mooboard.json", "icon.png"]:
                    raise ValueError("entry order changed: " + uses)
            with open(second.release, encoding="utf-8") as f:
                row = json.load(f)
            if row["sha256"] != hashlib.sha256(before).hexdigest() or row["size"] != len(before):
                raise ValueError("release digest or size differs: " + uses)
    custom = 0
    from pathlib import Path
    for folder in sorted((Path(KIT) / "samples" / "custom").iterdir()):
        with tempfile.TemporaryDirectory(prefix="mooboard-custom-") as work:
            one = live.build(folder, work)
            before = Path(one.package).read_bytes()
            two = live.build(folder, work)
            if before != Path(two.package).read_bytes():
                raise ValueError("custom package changed on a second build")
            with zipfile.ZipFile(two.package) as archive:
                if archive.namelist() != ["mooboard.json", "app.lua", "icon.png"] or archive.testzip():
                    raise ValueError("custom package has incorrect entries")
                if json.loads(archive.read("mooboard.json"))["format"] != 3:
                    raise ValueError("custom app format changed")
            custom += 1
    print("live apps: %d native presets and %d custom starters build with repeatable packages" % (sum(map(len,catalog.GROUPS.values())), custom))
    return 0


if __name__ == "__main__":
    sys.exit(main())
