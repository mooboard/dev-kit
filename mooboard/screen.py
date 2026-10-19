import datetime
import os

from . import gif, png, text

W, H = 128, 32
SAFE = (1, 1, W - 2, H - 2)
SIZES = text.SIZES
FONTS = text.FONTS
MAX_FRAMES = 100
SCROLL_MS = 30
SCROLL_STEP = 2
WHITE = (255, 255, 255)
SPRITES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sprites")

COLOR_WORDS = "Colors are #rrggbb or (r, g, b)"
SIZE_WORDS = "Sizes are 6, 8, 9, 11 and 13"
FONT_WORDS = "Fonts are nunito, outfit, inter, figtree and albert-sans"
ALIGN_WORDS = "Align is left, center or right"
LONG_WORDS = "Too long for the screen: {words}"
SPRITE_WORDS = "No sprite named {name}"
IMAGE_WORDS = "Can’t read {path}"
FRAMES_WORDS = "More than 100 frames"
ELEMENT_WORDS = "Elements are text, sprite, image, rect, line, scroll and time"
DAYS = "MON TUE WED THU FRI SAT SUN".split()
ELEMENTS = ("text", "sprite", "image", "rect", "line", "scroll")


class TooLong(ValueError):
    pass


def clock_words(shows, hours, now):
    clock = "%02d:%02d" % (now.hour, now.minute) if hours == 24 else "%d:%02d" % ((now.hour + 11) % 12 + 1, now.minute)
    date = "%s %d" % (DAYS[now.weekday()], now.day)
    return {"time": clock, "date": date}.get(shows, clock + " " + date)


def blend(dst, color, t):
    if t <= 0:
        return tuple(dst)
    if t >= 1:
        return tuple(color)
    return tuple(int(d + (c - d) * t + 0.5) for d, c in zip(dst, color))


def color_of(value):
    if isinstance(value, str):
        digits = value[1:] if value.startswith("#") else ""
        if len(digits) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in digits):
            return int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)
    elif isinstance(value, (tuple, list)) and len(value) == 3:
        if all(isinstance(c, int) and not isinstance(c, bool) and 0 <= c <= 255 for c in value):
            return tuple(value)
    raise ValueError(COLOR_WORDS)


def _face(size, font):
    if size not in SIZES:
        raise ValueError(SIZE_WORDS)
    if font not in FONTS:
        raise ValueError(FONT_WORDS)
    return text.atlas(font, size)


def measure(words, size=9, font="nunito"):
    face = _face(size, font)
    box = text.ink(face, text.layout(face, str(words))[0])
    if box is None:
        return 0, 0
    return box[1] - box[0] + 1, box[3] - box[2] + 1


class Canvas:
    def __init__(self):
        self.px = bytearray(W * H * 3)
        self.clip = (0, 0, W - 1, H - 1)

    def set(self, x, y, color):
        if self.clip[0] <= x <= self.clip[2] and self.clip[1] <= y <= self.clip[3]:
            i = (y * W + x) * 3
            self.px[i:i + 3] = bytes(color)

    def blend(self, x, y, color, t):
        if self.clip[0] <= x <= self.clip[2] and self.clip[1] <= y <= self.clip[3]:
            i = (y * W + x) * 3
            self.px[i:i + 3] = bytes(blend(self.px[i:i + 3], color, t))


class Screen:
    def __init__(self):
        self._canvas = Canvas()
        self._frames = []

    def rgb(self):
        return bytes(self._canvas.px)

    def frames(self):
        return list(self._frames)

    def clear(self, color=(0, 0, 0)):
        self._canvas.px[:] = bytes(color_of(color)) * (W * H)

    def pixel(self, x, y, color):
        self._canvas.set(int(x), int(y), color_of(color))

    def rect(self, x, y, w, h, color):
        c = color_of(color)
        x, y, w, h = int(x), int(y), int(w), int(h)
        for yy in range(max(y, 0), min(y + h, H)):
            for xx in range(max(x, 0), min(x + w, W)):
                self._canvas.set(xx, yy, c)

    def line(self, x0, y0, x1, y1, color):
        c = color_of(color)
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        a, b = abs(x1 - x0), abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        # Bresenham's own pixels, worked out only for the steps that land on the canvas
        if a >= b:
            low, high = (max(0, -x0), min(a, W - 1 - x0)) if sx > 0 else (max(0, x0 - W + 1), min(a, x0))
            for i in range(low, high + 1):
                self._canvas.set(x0 + sx * i, y0 + sy * ((2 * b * i + a) // (2 * a) if a else 0), c)
        else:
            low, high = (max(0, -y0), min(b, H - 1 - y0)) if sy > 0 else (max(0, y0 - H + 1), min(b, y0))
            for j in range(low, high + 1):
                self._canvas.set(x0 + sx * ((2 * a * j + b) // (2 * b)), y0 + sy * j, c)

    def text(self, words, x=None, y=None, size=9, color=WHITE, font="nunito", align="left"):
        words, c = str(words), color_of(color)
        _face(size, font)
        if align not in ("left", "center", "right"):
            raise ValueError(ALIGN_WORDS)
        for s in [size] + [z for z in reversed(SIZES) if z < size]:
            face = text.atlas(font, s)
            spans, _ = text.layout(face, words)
            box = text.ink(face, spans)
            if box is None:
                return s
            left, right, top, bottom = box
            if x is None:
                pen = (W - (right - left + 1)) // 2 - left
            elif align == "left":
                pen = int(x) - left
            elif align == "right":
                pen = int(x) - right
            else:
                pen = int(x) - (left + right) // 2
            base = H // 2 + s // 2 if y is None else int(y)
            if SAFE[0] <= pen + left and pen + right <= SAFE[2] and SAFE[1] <= base + top and base + bottom <= SAFE[3]:
                text.draw(self._canvas, face, spans, pen, base, c)
                return s
        raise TooLong(LONG_WORDS.format(words=words))

    def scroll(self, words, y=None, size=9, color=WHITE, font="nunito"):
        words, c = str(words), color_of(color)
        face = _face(size, font)
        spans, _ = text.layout(face, words)
        box = text.ink(face, spans)
        if box is None:
            return
        left, right, top, bottom = box
        base = H // 2 + size // 2 if y is None else int(y)
        if base + top < SAFE[1] or base + bottom > SAFE[3]:
            raise TooLong(LONG_WORDS.format(words=words))
        width = right - left + 1
        room = MAX_FRAMES - len(self._frames)
        if room <= 0:
            raise ValueError(FRAMES_WORDS)
        step = max(SCROLL_STEP, -(-(SAFE[2] - SAFE[0] + 1 + width) // room))
        under = bytes(self._canvas.px)
        self._canvas.clip = SAFE
        try:
            k = 1
            while SAFE[2] + 1 - k * step + width - 1 >= SAFE[0]:
                self._canvas.px[:] = under
                text.draw(self._canvas, face, spans, SAFE[2] + 1 - k * step - left, base, c)
                self.frame(SCROLL_MS)
                k += 1
        finally:
            self._canvas.clip = (0, 0, W - 1, H - 1)
            self._canvas.px[:] = under

    def image_rgba(self, w, h, rgba, x, y):
        for row in range(h):
            for col in range(w):
                i = (row * w + col) * 4
                if rgba[i + 3]:
                    self._canvas.blend(int(x) + col, int(y) + row, rgba[i:i + 3], rgba[i + 3] / 255.0)

    def sprite(self, name, x, y):
        path = os.path.join(SPRITES, "%s.png" % name) if isinstance(name, str) else ""
        if not path or os.path.basename(path) != "%s.png" % name or not os.path.isfile(path):
            raise ValueError(SPRITE_WORDS.format(name=name))
        with open(path, "rb") as f:
            self.image_rgba(*png.decode(f.read()), x, y)

    def image(self, path, x, y):
        try:
            with open(path, "rb") as f:
                w, h, rgba = png.decode(f.read())
        except (OSError, png.Unreadable):
            raise ValueError(IMAGE_WORDS.format(path=path))
        self.image_rgba(w, h, rgba, x, y)

    def frame(self, ms=1000):
        rgb = bytes(self._canvas.px)
        if self._frames and self._frames[-1][0] == rgb:
            self._frames[-1] = (rgb, self._frames[-1][1] + ms)
            return
        if len(self._frames) >= MAX_FRAMES:
            raise ValueError(FRAMES_WORDS)
        self._frames.append((rgb, ms))

    def compose(self, frames, now=None):
        now = now or datetime.datetime.now()
        for frame in frames:
            self.clear()
            for element in frame["elements"]:
                args = dict(element)
                kind = args.pop("type", None)
                if kind == "time":
                    args["words"] = clock_words(args.pop("shows"), args.pop("hours"), now)
                    kind = "text"
                if kind not in ELEMENTS:
                    raise ValueError(ELEMENT_WORDS)
                getattr(self, kind)(**args)
            self.frame(frame["ms"])

    def save(self):
        if not self._frames:
            self.frame()
        out = os.environ.get("MOOBOARD_OUT") or os.path.join(os.getcwd(), "build")
        os.makedirs(out, exist_ok=True)
        path = os.path.join(out, "app.gif")
        with open(path, "wb") as f:
            f.write(gif.encode(self._frames))
        return path
