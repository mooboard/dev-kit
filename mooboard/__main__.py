import os
import sys

from . import build

USAGE = "Usage: python3 -m mooboard build APP, play APP, new APP --uses RENDERER --author USER, or renderers"
BUILT = "{path}: {frames} frames in {kb} KB"
BUILT_ONE = "{path}: 1 frame in {kb} KB"


def shown(path):
    near = os.path.relpath(path)
    return path if near.startswith("..") else near


def main(argv):
    if argv and argv[0] in ("new", "renderers"):
        import argparse
        from . import catalog
        if argv[0] == "renderers":
            for key in catalog.CATEGORIES:
                print(catalog.CATEGORY_LABELS[key] + ": " + (", ".join(catalog.GROUPS[key]) or "firmware integration pending"))
            return 0 if len(argv) == 1 else 2
        parser = argparse.ArgumentParser(prog="python3 -m mooboard new")
        parser.add_argument("app")
        parser.add_argument("--uses", required=True)
        parser.add_argument("--author", required=True)
        parser.add_argument("--category")
        args = parser.parse_args(argv[1:])
        try:
            print(shown(catalog.create(args.app, args.uses, args.author, args.category)))
        except build.Refused as refused:
            print(refused.line, file=sys.stderr)
            return 1
        return 0
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
    if built.manifest.get("format") == 2:
        print("{path}: live {uses} app in {kb} KB".format(path=shown(built.package), uses=built.manifest["uses"], kb=(size + 1023) // 1024))
        print("This is a store package. Submit it through the apps repository. Add from file currently accepts GIF apps only.")
        if argv[0] == "play":
            print("Live renderer preview is not available in this draft. Test the installed app on compatible firmware. The GIF player cannot simulate it.", file=sys.stderr)
            return 1
        return 0
    frames = built.manifest["frames"]
    print((BUILT_ONE if frames == 1 else BUILT).format(path=shown(built.package), frames=frames, kb=(size + 1023) // 1024))
    if argv[0] == "play":
        from . import play
        path = play.write(built)
        print(shown(path))
        play.show(path)
    return 0


sys.exit(main(sys.argv[1:]))
