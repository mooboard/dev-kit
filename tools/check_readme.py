#!/usr/bin/env python3
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIME_LIMIT = 900

OK = "readme: ok"
FAILED = "readme: this line failed: {line}"
NO_STEPS = "readme: no sh block that starts with git clone and cd"
NO_CHANGE = "readme: no line that says what to change"
NOT_MADE = "readme: {path} was not made"
SAME = "readme: the change did not change the app"
EDITED = "readme: {path} no longer says {word}. git checkout {path} puts it back."


def steps(readme):
    found = re.search(r"```sh\n(.*?)```", readme, re.S)
    lines = [line.strip() for line in found.group(1).splitlines() if line.strip()] if found else []
    if len(lines) < 3 or not lines[0].startswith("git clone ") or not lines[1].startswith("cd "):
        return None
    return lines[1][3:].strip(), lines[2:]


def built(folder):
    with open(os.path.join(folder, "mooboard.json"), encoding="utf-8") as f:
        name = json.load(f)["id"]
    made = [os.path.join(folder, "build", name + ".mooboard"), os.path.join(folder, "build", "play.html")]
    for path in made:
        if not os.path.isfile(path):
            raise LookupError(path)
    with zipfile.ZipFile(made[0]) as package:
        return package.read("app.gif")


def main():
    with open(os.path.join(KIT, "README.md"), encoding="utf-8") as f:
        readme = f.read()
    found = steps(readme)
    if found is None:
        print(NO_STEPS)
        return 1
    folder, lines = found
    change = re.search(r"Change `([^`]+)` in (\S+?\.py)", readme)
    if change is None:
        print(NO_CHANGE)
        return 1
    word, path = change.groups()
    if not os.path.isfile(os.path.join(KIT, path)):
        print(NO_CHANGE)
        return 1
    with open(os.path.join(KIT, path), encoding="utf-8") as f:
        if '"%s"' % word not in f.read():
            print(EDITED.format(path=path, word=word))
            return 1
    with tempfile.TemporaryDirectory(prefix="readme-") as work:
        clone = os.path.join(work, folder)
        shutil.copytree(KIT, clone, ignore=shutil.ignore_patterns(".git", "build", "__pycache__"))
        tools = os.path.join(work, "bin")
        os.makedirs(tools)
        with open(os.path.join(tools, "python3"), "w") as f:
            f.write('#!/bin/sh\nexec "%s" "$@"\n' % sys.executable)
        os.chmod(os.path.join(tools, "python3"), 0o755)
        # on a Mac open shows a page in the browser, here the page only has to be there
        with open(os.path.join(tools, "open"), "w") as f:
            f.write('#!/bin/sh\nfor page in "$@"; do test -e "$page" || exit 1; done\n')
        os.chmod(os.path.join(tools, "open"), 0o755)
        env = dict(os.environ, PATH=tools + os.pathsep + os.environ.get("PATH", ""), BROWSER="true",
                   PYTHONDONTWRITEBYTECODE="1")

        def run(line):
            done = subprocess.run(["sh", "-c", line], cwd=clone, env=env, timeout=TIME_LIMIT, capture_output=True,
                                  text=True)
            if done.returncode != 0:
                sys.stderr.write(done.stdout + done.stderr)
                print(FAILED.format(line=line))
                return False
            return True

        if not all(run(line) for line in lines):
            return 1
        app = os.path.join(clone, lines[-1].split()[-1])
        try:
            before = built(app)
        except LookupError as missing:
            print(NOT_MADE.format(path=os.path.relpath(str(missing), clone)))
            return 1
        target = os.path.join(clone, path)
        with open(target, encoding="utf-8") as f:
            code = f.read()
        with open(target, "w", encoding="utf-8") as f:
            f.write(code.replace('"%s"' % word, '"%s"' % "Moo", 1))
        if not run(lines[-1]):
            return 1
        if built(app) == before:
            print(SAME)
            return 1
    print(OK)
    return 0


if __name__ == "__main__":
    sys.exit(main())
