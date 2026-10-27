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
from mooboard import catalog


def main():
    with tempfile.TemporaryDirectory(prefix="mooboard-live-") as work:
        for uses in catalog.rules.CATALOG_USES:
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
    print("live apps: %d starters build with repeatable packages" % len(catalog.rules.CATALOG_USES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
