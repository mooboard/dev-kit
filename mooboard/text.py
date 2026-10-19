import os

FONTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
SIZES = (6, 8, 9, 11, 13)
FONTS = ("nunito", "outfit", "inter", "figtree", "albert-sans")
_atlases = {}


class Atlas:
    def __init__(self, path):
        self.tracking = 0
        self.glyphs = {}
        self.subs = {}
        self._left, self._right, self._cells = {}, {}, {}
        with open(path, encoding="ascii") as f:
            for line in f:
                parts = line.split()
                if not parts:
                    continue
                tag = parts[0]
                if tag == "glyphs":
                    self.tracking = int(parts[3])
                elif tag == "g":
                    cp, advance, xoff, yoff, w, h = (int(p) for p in parts[1:7])
                    alpha = bytes.fromhex(parts[7]) if len(parts) > 7 else b""
                    self.glyphs[cp] = (advance, xoff, yoff, w, h, alpha)
                elif tag in ("l", "r"):
                    side = self._left if tag == "l" else self._right
                    for cp in parts[2:]:
                        side[int(cp)] = int(parts[1])
                elif tag == "k":
                    self._cells[(int(parts[1]), int(parts[2]))] = int(parts[3])
                elif tag == "s":
                    self.subs[int(parts[1])] = tuple(int(p) for p in parts[2:])

    def kern(self, left, right):
        a, b = self._left.get(left), self._right.get(right)
        return 0 if a is None or b is None else self._cells.get((a, b), 0)

    def resolve(self, cp):
        if cp in self.glyphs:
            return (cp,)
        return self.subs.get(cp, ())


def atlas(font, size):
    key = (font, size)
    if key not in _atlases:
        _atlases[key] = Atlas(os.path.join(FONTS_DIR, "%s-%d.txt" % key))
    return _atlases[key]


def layout(face, words):
    pen, previous, spans = 0, None, []
    for ch in words:
        for cp in face.resolve(ord(ch)):
            if previous is not None:
                pen += face.kern(previous, cp) + face.tracking
            spans.append((pen, cp))
            pen += face.glyphs[cp][0]
            previous = cp
    return spans, pen


def ink(face, spans):
    box = None
    for pen, cp in spans:
        _, xoff, yoff, w, h, _ = face.glyphs[cp]
        if w <= 0 or h <= 0:
            continue
        left, right, top, bottom = pen + xoff, pen + xoff + w - 1, yoff, yoff + h - 1
        if box is None:
            box = (left, right, top, bottom)
        else:
            box = (min(box[0], left), max(box[1], right), min(box[2], top), max(box[3], bottom))
    return box


def draw(canvas, face, spans, x, baseline, color):
    for pen, cp in spans:
        _, xoff, yoff, w, h, alpha = face.glyphs[cp]
        for row in range(h):
            for col in range(w):
                a = alpha[row * w + col]
                if a:
                    canvas.blend(x + pen + xoff + col, baseline + yoff + row, color, a / 255.0)
