#!/usr/bin/env python3
# Checks a kit for what must not be public: paths, keys, tokens, addresses and hidden text.
# Usage: python3 tools/check_clean.py [folder], the folder above this script by default.
# Each finding prints as path:line: rule and never shows the text it found.
# In a git clone it skips what git ignores, such as the samples' build folders, as git never publishes them.
import os
import re
import struct
import subprocess
import sys
import zlib

MAX_BYTES = 2 * 1024 * 1024
ALLOWED_TYPES = {".png", ".gif", ".svg", ".gpl", ".txt", ".md", ".ttf", ".html", ".js", ".css", ".yml", ".py"}
ALLOWED_NAMES = {"LICENSE", ".gitignore", "mooboard.json"}
TEXT_TYPES = {".svg", ".gpl", ".txt", ".md", ".html", ".js", ".css", ".yml", ".py", ".json", ""}
SKIP_DIRS = {".git"}

# each pattern is written so this file passes its own check
RULES = (
    ("home path", re.compile(r"/User[s]/|/hom[e]/|[A-Za-z]:\\User[s]\\|(?<![\w~])[~]/|-User[s]-")),
    ("temp path", re.compile(r"(?<![\w.])/(?:privat[e]/)?(?:tm[p]|va[r])/")),
    ("key file", re.compile(r"[.]pe[m]\b", re.I)),
    ("private key", re.compile(r"BEGI[N] (?:[A-Z]+ )*PRIVATE KEY")),
    ("token", re.compile(r"\bghp_[A-Za-z0-9]{20,}|\bgithub_pa[t]_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b"
                         r"|\bxox[abprs]-[A-Za-z0-9-]{8,}")),
    ("web hook", re.compile(r"web[h]ooks?\b|hooks[.]slack[.]com", re.I)),
    ("email address", re.compile(r"[\w.+-]{1,64}@[\w-]+(?:[.][\w-]+)*[.][A-Za-z]{2,}")),
    ("mac address", re.compile(r"\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b")),
)
INFLATE_MAX = 1 << 20   # the most a compressed text chunk may grow to


def rules_in(text, rules=RULES):
    return [name for name, pattern in rules if pattern.search(text)]


def inflate(data):
    try:
        return zlib.decompressobj().decompress(data, INFLATE_MAX)
    except zlib.error:
        return b""


def png_texts(data):
    texts, p = [], 8
    while p + 12 <= len(data):
        length, kind = struct.unpack(">I4s", data[p:p + 8])
        body = data[p + 8:p + 8 + length]
        keyword, _, rest = body.partition(b"\0")
        if kind == b"tEXt":
            texts.append(keyword + b" " + rest)
        elif kind == b"zTXt" and rest:
            texts.append(keyword + b" " + inflate(rest[1:]))
        elif kind == b"iTXt" and len(rest) >= 2:
            language, _, rest2 = rest[2:].partition(b"\0")
            translated, _, words = rest2.partition(b"\0")
            texts.append(b" ".join((keyword, language, translated, inflate(words) if rest[0] else words)))
        elif kind == b"IEND":
            break
        p += 12 + length
    return texts


def sub_blocks(data, p):
    out = bytearray()
    while p < len(data) and data[p]:
        out += data[p + 1:p + 1 + data[p]]
        p += data[p] + 1
    return bytes(out), p + 1


def gif_texts(data):
    texts = []
    if len(data) < 13:
        return texts
    p = 13 + (3 * (2 << (data[10] & 7)) if data[10] & 0x80 else 0)
    while p < len(data):
        tag = data[p]
        if tag == 0x21 and p + 1 < len(data):
            label = data[p + 1]
            words, p = sub_blocks(data, p + 2)
            if label in (0xFE, 0x01):
                texts.append(words)
        elif tag == 0x2C and p + 10 <= len(data):
            flags = data[p + 9]
            p += 10 + (3 * (2 << (flags & 7)) if flags & 0x80 else 0) + 1
            _, p = sub_blocks(data, p)
        else:
            break
    return texts


def picture_texts(path, ext):
    with open(path, "rb") as f:
        data = f.read()
    found = png_texts(data) if ext == ".png" else gif_texts(data)
    return [t.decode("latin-1") for t in found]


def text_lines(path):
    with open(path, "rb") as f:
        data = f.read()
    try:
        text, good = data.decode("utf-8"), b"\0" not in data
    except UnicodeDecodeError:
        text, good = data.decode("utf-8", errors="replace"), False
    return text.splitlines(), good


def ignored(root):
    def git(*args):
        return subprocess.run(["git", "-C", root] + list(args), capture_output=True, timeout=60)

    try:
        top = git("rev-parse", "--show-toplevel")
        if top.returncode or os.path.realpath(top.stdout.decode("utf-8", "replace").strip()) != os.path.realpath(root):
            return set()
        listed = git("ls-files", "--others", "--ignored", "--exclude-standard", "-z")
    except (OSError, subprocess.SubprocessError):
        return set()
    return set(listed.stdout.decode("utf-8", "replace").split("\0")) - {""} if listed.returncode == 0 else set()


def scan(root, rules=RULES, skip=()):
    findings, unpublished = [], ignored(root)
    for folder, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not os.path.islink(os.path.join(folder, d)))
        for name in sorted(files):
            path = os.path.join(folder, name)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            if rel in unpublished:
                continue
            findings += [(rel, 0, rule) for rule in rules_in(rel, rules)]
            if os.path.islink(path) or rel.startswith(tuple(skip)):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext in TEXT_TYPES:
                for number, line in enumerate(text_lines(path)[0], 1):
                    findings += [(rel, number, rule) for rule in rules_in(line, rules)]
            elif ext in (".png", ".gif"):
                for words in picture_texts(path, ext):
                    findings += [(rel, 0, rule) for rule in rules_in(words, rules)]
    return findings


def check(root):
    findings, count, unpublished = [], 0, ignored(root)
    for folder, dirs, files in os.walk(root):
        for d in sorted(dirs):
            if os.path.islink(os.path.join(folder, d)):
                findings.append((os.path.relpath(os.path.join(folder, d), root).replace(os.sep, "/"), 0, "symlink"))
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not os.path.islink(os.path.join(folder, d)))
        for name in sorted(files):
            path = os.path.join(folder, name)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            if rel in unpublished:
                continue
            count += 1
            if os.path.islink(path):
                findings.append((rel, 0, "symlink"))
                continue
            ext = os.path.splitext(name)[1].lower()
            if name not in ALLOWED_NAMES and ext not in ALLOWED_TYPES:
                findings.append((rel, 0, "file type"))
            if os.path.getsize(path) > MAX_BYTES:
                findings.append((rel, 0, "file over 2 MB"))
            if ext in TEXT_TYPES and not text_lines(path)[1]:
                findings.append((rel, 0, "text encoding"))
    return count, findings + scan(root)


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(args[0] if args else os.path.join(here, ".."))
    count, findings = check(root)
    for rel, line, rule in findings:
        print("%s:%d: %s" % (rel, line, rule) if line else "%s: %s" % (rel, rule))
    if findings:
        print("not clean: %d finding%s in %d files" % (len(findings), "" if len(findings) == 1 else "s", count))
        return 1
    print("clean: %d files" % count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
