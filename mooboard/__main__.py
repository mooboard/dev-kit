import os
import sys

from . import build

USAGE = "Usage: python3 -m mooboard play APP or python3 -m mooboard build APP"
BUILT = "{path}: {frames} frames in {kb} KB"
BUILT_ONE = "{path}: 1 frame in {kb} KB"


def shown(path):
    near = os.path.relpath(path)
    return path if near.startswith("..") else near


def main(argv):
    if len(argv) != 2 or argv[0] not in ("build", "play"):
        print(USAGE, file=sys.stderr)
        return 2
    try:
        built = build.build(argv[1])
    except build.Refused as refused:
        print(refused.line, file=sys.stderr)
        return 1
    for warning in built.warnings:
        print(warning)
    size = os.path.getsize(built.package)
    frames = built.manifest["frames"]
    print((BUILT_ONE if frames == 1 else BUILT).format(path=shown(built.package), frames=frames, kb=(size + 1023) // 1024))
    if argv[0] == "play":
        from . import play
        path = play.write(built)
        print(shown(path))
        play.show(path)
    return 0


sys.exit(main(sys.argv[1:]))
