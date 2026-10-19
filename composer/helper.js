/* the mooboard helper's drawing and the build's checks, in the browser, pixel for pixel and byte for byte */
(function (root) {
  'use strict';

  const W = 128, H = 32;
  const SAFE = [1, 1, W - 2, H - 2];
  const SIZES = [6, 8, 9, 11, 13];
  const FONTS = ['nunito', 'outfit', 'inter', 'figtree', 'albert-sans'];
  const ALIGNS = ['left', 'center', 'right'];
  const ELEMENTS = ['text', 'sprite', 'image', 'rect', 'line', 'scroll'];
  const MAX_FRAMES = 100;
  const SCROLL_MS = 30;
  const SCROLL_STEP = 2;
  const LOWEST_LIT = 5;
  const WHITE = [255, 255, 255];
  const DAYS = 'MON TUE WED THU FRI SAT SUN'.split(/\s+/);

  const MAX_PACKAGE = 352 * 1024;
  const MANIFEST_CAP = 8 * 1024;
  const GIF_CAP = 256 * 1024;
  const PNG_CAP = 8 * 1024;
  const MAX_IMAGES = 8;
  const MAX_SETTINGS = 8;
  const MAX_LAYERS = 8;
  const MAX_COMBINATIONS = 512;
  const ICON = 32;
  const FIELDS = ['mooboard', 'id', 'name', 'author', 'refresh', 'duration'];
  const EXTRAS = ['settings', 'layers'];
  const BUILT = ['frames', 'built'];
  const SETTING_FIELDS = { text: ['max'], color: [], toggle: [], choice: ['options'] };
  const TEXT_LAYER = ['type', 'text', 'size', 'font', 'color', 'x', 'y', 'align', 'show'];
  const IMAGE_LAYER = ['type', 'src', 'x', 'y', 'show'];
  const SETTING_ORDER = ['key', 'type', 'label', 'default', 'max', 'options'];
  const LAYER_ORDER = ['type', 'text', 'src', 'x', 'y', 'size', 'font', 'color', 'align', 'show'];
  const VARIANT_COLORS = ['#77edd7', '#ffb7c9'];
  const ID = /^[a-z0-9-]{3,32}$/;
  const AUTHOR = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
  const KEY = /^[a-z][a-z0-9_]{0,15}$/;
  const COLOR = /^#[0-9a-fA-F]{6}$/;
  const IMAGE = /^images\/[a-z0-9-]{1,32}\.png$/;
  const STAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
  const WORD = /\{([^{}]*)\}/g;
  const OTHER = /\p{C}/u;

  const WORDS = {
    color: 'Colors are #rrggbb or (r, g, b)',
    size: 'Sizes are 6, 8, 9, 11 and 13',
    font: 'Fonts are nunito, outfit, inter, figtree and albert-sans',
    align: 'Align is left, center or right',
    long: 'Too long for the screen: {words}',
    sprite: 'No sprite named {name}',
    image: 'Can’t read {path}',
    element: 'Elements are text, sprite, image, rect, line, scroll and time',
    frameSize: 'A frame must be {w}×{h}',
    noFrames: 'No frames to save',
    frames: 'More than 100 frames',
    needs: 'mooboard.json needs {key}',
    unknown: 'Unknown key in mooboard.json: {key}',
    version: 'mooboard must be 1',
    id: 'id must be 3 to 32 lowercase letters, digits or dashes',
    name: 'name must be 1 to 24 characters',
    nameLink: 'name can’t be a link',
    author: 'author must be a GitHub user name',
    refresh: 'refresh must be 300 to 86400 seconds',
    duration: 'duration must be 5 to 60 seconds',
    settings: 'settings must be a list of up to 8',
    setting: 'Setting {name} needs a key, a type, a label of up to 24 characters and a default',
    settingTwice: 'Two settings have the key {name}',
    settingText: 'Setting {name} needs a max of 1 to 32 and a default no longer than it',
    settingColor: 'Setting {name} needs a default color like #ffb7c9',
    settingToggle: 'Setting {name} needs a default of true or false',
    settingChoice: 'Setting {name} needs 2 to 8 different options of 1 to 16 characters and one as its default',
    layers: 'layers must be a list of up to 8',
    layer: 'Layer {number} is not a text or image layer',
    layerSetting: 'Layer {number} can’t use {key}',
    layerImage: 'Layer {number} uses {src}, which the app does not have',
    layerFit: 'Layer {number} is too long for the screen with {words}',
    layerMany: 'Layer {number} uses too many choices at once',
    bytes: 'app.gif is over 256 KB',
    edge: 'Lit pixels in the edge ring',
    dim: 'Colors too dim to light',
    imageBig: '{name} must be a PNG of up to 128×32 and 8 KB',
    icon: 'icon.png must be a 32×32 PNG of up to 8 KB',
    packageBig: 'The package is over 352 KB',
    packageBad: 'Not a mooboard package',
  };
  const SETTING_TYPE = { text: WORDS.settingText, color: WORDS.settingColor, toggle: WORDS.settingToggle,
                         choice: WORDS.settingChoice };

  // a line with its {names} filled in
  function fill(line, values) {
    return line.replace(/\{(\w+)\}/g, (found, name) => (name in values ? String(values[name]) : found));
  }

  class TooLong extends Error {}

  class Refused extends Error {
    constructor(line) {
      super(line);
      this.line = line;
    }
  }

  function same(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function bytesOfHex(text) {
    const out = new Uint8Array(text.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16);
    return out;
  }

  // ---- text, as mooboard/text.py ----

  class Atlas {
    constructor(text) {
      this.tracking = 0;
      this.glyphs = new Map();
      this.subs = new Map();
      this.left = new Map();
      this.right = new Map();
      this.cells = new Map();
      for (const line of text.split('\n')) {
        const parts = line.trim().split(/\s+/);
        const tag = parts[0];
        if (tag === 'glyphs') {
          this.tracking = Number(parts[3]);
        } else if (tag === 'g') {
          const n = parts.slice(1, 7).map(Number);
          this.glyphs.set(n[0], [n[1], n[2], n[3], n[4], n[5], parts.length > 7 ? bytesOfHex(parts[7]) : new Uint8Array(0)]);
        } else if (tag === 'l' || tag === 'r') {
          const side = tag === 'l' ? this.left : this.right;
          for (const cp of parts.slice(2)) side.set(Number(cp), Number(parts[1]));
        } else if (tag === 'k') {
          this.cells.set(parts[1] + ' ' + parts[2], Number(parts[3]));
        } else if (tag === 's') {
          this.subs.set(Number(parts[1]), parts.slice(2).map(Number));
        }
      }
    }

    kern(left, right) {
      const a = this.left.get(left), b = this.right.get(right);
      return a === undefined || b === undefined ? 0 : this.cells.get(a + ' ' + b) || 0;
    }

    resolve(cp) {
      return this.glyphs.has(cp) ? [cp] : this.subs.get(cp) || [];
    }
  }

  function layout(face, words) {
    let pen = 0, previous = null;
    const spans = [];
    for (const ch of String(words)) {
      for (const cp of face.resolve(ch.codePointAt(0))) {
        if (previous !== null) pen += face.kern(previous, cp) + face.tracking;
        spans.push([pen, cp]);
        pen += face.glyphs.get(cp)[0];
        previous = cp;
      }
    }
    return [spans, pen];
  }

  function ink(face, spans) {
    let box = null;
    for (const [pen, cp] of spans) {
      const g = face.glyphs.get(cp);
      if (g[3] <= 0 || g[4] <= 0) continue;
      const left = pen + g[1], right = pen + g[1] + g[3] - 1, top = g[2], bottom = g[2] + g[4] - 1;
      box = box === null ? [left, right, top, bottom]
        : [Math.min(box[0], left), Math.max(box[1], right), Math.min(box[2], top), Math.max(box[3], bottom)];
    }
    return box;
  }

  function drawText(canvas, face, spans, x, baseline, color) {
    for (const [pen, cp] of spans) {
      const [, xoff, yoff, w, h, alpha] = face.glyphs.get(cp);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const a = alpha[row * w + col];
          if (a) canvas.blend(x + pen + xoff + col, baseline + yoff + row, color, a / 255);
        }
      }
    }
  }

  // ---- the canvas and the screen, as mooboard/screen.py ----

  function blend(px, at, color, t) {
    if (t <= 0) return;
    for (let k = 0; k < 3; k++) {
      const d = px[at + k];
      px[at + k] = t >= 1 ? color[k] : Math.trunc(d + (color[k] - d) * t + 0.5);
    }
  }

  function colorOf(value) {
    if (typeof value === 'string') {
      if (COLOR.test(value)) return [1, 3, 5].map((i) => parseInt(value.substr(i, 2), 16));
    } else if (Array.isArray(value) && value.length === 3 &&
               value.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) {
      return value.slice();
    }
    throw new Error(WORDS.color);
  }

  class Canvas {
    constructor() {
      this.px = new Uint8Array(W * H * 3);
      this.clip = [0, 0, W - 1, H - 1];
    }

    inside(x, y) {
      return this.clip[0] <= x && x <= this.clip[2] && this.clip[1] <= y && y <= this.clip[3];
    }

    set(x, y, color) {
      if (this.inside(x, y)) this.px.set(color, (y * W + x) * 3);
    }

    blend(x, y, color, t) {
      if (this.inside(x, y)) blend(this.px, (y * W + x) * 3, color, t);
    }
  }

  // records what layers draw once so every frame replays the same writes
  class Recorder extends Canvas {
    constructor() {
      super();
      this.ops = [];
    }

    set(x, y, color) {
      this.blend(x, y, color, 1);
    }

    blend(x, y, color, t) {
      if (this.inside(x, y)) this.ops.push([(y * W + x) * 3, color, t]);
    }
  }

  // a place left out or None, as the helper takes x, y and a ticker's y
  function given(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }

  // a value left out takes the default, as a python keyword does, while a None stays a value the checks refuse
  function absent(value, fallback) {
    return value === undefined ? fallback : value;
  }

  function face(kit, size, font) {
    if (!SIZES.includes(size)) throw new Error(WORDS.size);
    if (!FONTS.includes(font)) throw new Error(WORDS.font);
    return kit.atlas(font, size);
  }

  class Screen {
    constructor(kit) {
      this.kit = kit;
      this.canvas = new Canvas();
      this.list = [];
    }

    rgb() {
      return this.canvas.px.slice();
    }

    frames() {
      return this.list.map((f) => [f[0], f[1]]);
    }

    clear(color) {
      const c = colorOf(absent(color, [0, 0, 0]));
      for (let i = 0; i < W * H; i++) this.canvas.px.set(c, i * 3);
    }

    pixel(a) {
      this.canvas.set(Math.trunc(a.x), Math.trunc(a.y), colorOf(a.color));
    }

    rect(a) {
      const c = colorOf(a.color);
      const x = Math.trunc(a.x), y = Math.trunc(a.y), w = Math.trunc(a.w), h = Math.trunc(a.h);
      for (let yy = Math.max(y, 0); yy < Math.min(y + h, H); yy++) {
        for (let xx = Math.max(x, 0); xx < Math.min(x + w, W); xx++) this.canvas.set(xx, yy, c);
      }
    }

    // Bresenham's own pixels, worked out only for the steps that land on the canvas, in whole numbers of any size
    line(a) {
      const c = colorOf(a.color);
      const [x0, y0, x1, y1] = [a.x0, a.y0, a.x1, a.y1].map((v) => BigInt(Math.trunc(v)));
      const dx = x1 > x0 ? x1 - x0 : x0 - x1, dy = y1 > y0 ? y1 - y0 : y0 - y1;
      const sx = x0 < x1 ? 1n : -1n, sy = y0 < y1 ? 1n : -1n;
      const big = (n) => BigInt(n), most = (p, q) => (p > q ? p : q), least = (p, q) => (p < q ? p : q);
      const steps = (start, step, size, length) => (step > 0n ? [most(0n, -start), least(length, big(size - 1) - start)]
        : [most(0n, start - big(size - 1)), least(length, start)]);
      if (dx >= dy) {
        const [low, high] = steps(x0, sx, W, dx);
        for (let i = low; i <= high; i++) {
          this.canvas.set(Number(x0 + sx * i), Number(y0 + sy * (dx ? (2n * dy * i + dx) / (2n * dx) : 0n)), c);
        }
      } else {
        const [low, high] = steps(y0, sy, H, dy);
        for (let j = low; j <= high; j++) {
          this.canvas.set(Number(x0 + sx * ((2n * dx * j + dy) / (2n * dy))), Number(y0 + sy * j), c);
        }
      }
    }

    // the size the text took, the largest board size at or under the one asked whose ink stays in the safe area
    place(a) {
      const words = String(a.words), size = absent(a.size, 9), font = absent(a.font, 'nunito');
      const align = absent(a.align, 'left'), x = given(a.x, null), y = given(a.y, null);
      face(this.kit, size, font);
      if (!ALIGNS.includes(align)) throw new Error(WORDS.align);
      for (const s of [size].concat(SIZES.slice().reverse().filter((z) => z < size))) {
        const f = this.kit.atlas(font, s);
        const spans = layout(f, words)[0];
        const box = ink(f, spans);
        if (box === null) return { size: s, face: f, spans: spans, box: null };
        const [left, right, top, bottom] = box;
        let pen;
        if (x === null) pen = Math.floor((W - (right - left + 1)) / 2) - left;
        else if (align === 'left') pen = Math.trunc(x) - left;
        else if (align === 'right') pen = Math.trunc(x) - right;
        else pen = Math.trunc(x) - Math.floor((left + right) / 2);
        const base = y === null ? Math.floor(H / 2) + Math.floor(s / 2) : Math.trunc(y);
        if (SAFE[0] <= pen + left && pen + right <= SAFE[2] && SAFE[1] <= base + top && base + bottom <= SAFE[3]) {
          return { size: s, face: f, spans: spans, box: [pen + left, pen + right, base + top, base + bottom], pen: pen,
                   base: base };
        }
      }
      throw new TooLong(fill(WORDS.long, { words: words }));
    }

    text(a) {
      const c = colorOf(absent(a.color, WHITE));
      const placed = this.place(a);
      if (placed.box !== null) drawText(this.canvas, placed.face, placed.spans, placed.pen, placed.base, c);
      return placed.size;
    }

    scroll(a) {
      const words = String(a.words), c = colorOf(absent(a.color, WHITE));
      const size = absent(a.size, 9), f = face(this.kit, size, absent(a.font, 'nunito'));
      const spans = layout(f, words)[0];
      const box = ink(f, spans);
      if (box === null) return;
      const [left, right, top, bottom] = box;
      const base = given(a.y, null) === null ? Math.floor(H / 2) + Math.floor(size / 2) : Math.trunc(a.y);
      if (base + top < SAFE[1] || base + bottom > SAFE[3]) throw new TooLong(fill(WORDS.long, { words: words }));
      const width = right - left + 1;
      const room = MAX_FRAMES - this.list.length;
      if (room <= 0) throw new Error(WORDS.frames);
      const step = Math.max(SCROLL_STEP, Math.ceil((SAFE[2] - SAFE[0] + 1 + width) / room));
      const under = this.canvas.px.slice();
      this.canvas.clip = SAFE;
      try {
        for (let k = 1; SAFE[2] + 1 - k * step + width - 1 >= SAFE[0]; k++) {
          this.canvas.px.set(under);
          drawText(this.canvas, f, spans, SAFE[2] + 1 - k * step - left, base, c);
          this.frame(SCROLL_MS);
        }
      } finally {
        this.canvas.clip = [0, 0, W - 1, H - 1];
        this.canvas.px.set(under);
      }
    }

    imageRgba(w, h, rgba, x, y) {
      const x0 = Math.trunc(x), y0 = Math.trunc(y);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const i = (row * w + col) * 4;
          if (rgba[i + 3]) this.canvas.blend(x0 + col, y0 + row, [rgba[i], rgba[i + 1], rgba[i + 2]], rgba[i + 3] / 255);
        }
      }
    }

    sprite(a) {
      const s = this.kit.sprite(a.name);
      if (!s) throw new Error(fill(WORDS.sprite, { name: a.name }));
      this.imageRgba(s.width, s.height, s.rgba, a.x, a.y);
    }

    image(a) {
      const p = this.kit.image(a.path);
      if (!p) throw new Error(fill(WORDS.image, { path: a.path }));
      this.imageRgba(p.width, p.height, p.rgba, a.x, a.y);
    }

    frame(ms) {
      const rgb = this.canvas.px.slice(), last = this.list[this.list.length - 1];
      if (last && same(last[0], rgb)) {
        last[1] += given(ms, 1000);
        return;
      }
      if (this.list.length >= MAX_FRAMES) throw new Error(WORDS.frames);
      this.list.push([rgb, given(ms, 1000)]);
    }

    call(element, now) {
      const args = Object.assign({}, element);
      let kind = args.type;
      if (kind === 'time') {
        args.words = clockWords(args.shows, args.hours, now || clockNow());
        kind = 'text';
      }
      if (!ELEMENTS.includes(kind)) throw new Error(WORDS.element);
      return this[kind](args);
    }

    // problems, when given, collects what fails instead of stopping, as the page shows it
    compose(frames, now, problems) {
      const at = now || clockNow();
      for (let f = 0; f < frames.length; f++) {
        this.clear();
        const elements = frames[f].elements;
        for (let e = 0; e < elements.length; e++) {
          try {
            this.call(elements[e], at);
          } catch (error) {
            if (!problems) throw error;
            problems.push({ frame: f, element: e, line: error.message });
            if (error.message === WORDS.frames) return;
          }
        }
        try {
          this.frame(frames[f].ms);
        } catch (error) {
          if (!problems) throw error;
          problems.push({ frame: f, element: -1, line: error.message });
          return;
        }
      }
    }
  }

  // ---- the board's clock ----

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function clockWords(shows, hours, now) {
    const clock = hours === 24 ? pad(now.hour) + ':' + pad(now.minute) : ((now.hour + 11) % 12 + 1) + ':' + pad(now.minute);
    const date = DAYS[now.weekday] + ' ' + now.day;
    return shows === 'time' ? clock : shows === 'date' ? date : clock + ' ' + date;
  }

  function clockNow() {
    const d = new Date();
    return { hour: d.getHours(), minute: d.getMinutes(), weekday: (d.getDay() + 6) % 7, day: d.getDate() };
  }

  // ---- bytes ----

  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }

  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function adler32(data) {
    let a = 1, b = 0;
    for (let i = 0; i < data.length; i++) {
      a = (a + data[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  class Bytes {
    constructor() {
      this.parts = [];
      this.length = 0;
    }

    add(data) {
      const part = data instanceof Uint8Array ? data : Uint8Array.from(data);
      this.parts.push(part);
      this.length += part.length;
      return this;
    }

    le16(v) {
      return this.add([v & 255, (v >>> 8) & 255]);
    }

    le32(v) {
      return this.add([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
    }

    be32(v) {
      return this.add([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
    }

    done() {
      const out = new Uint8Array(this.length);
      let at = 0;
      for (const part of this.parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    }
  }

  const utf8 = (text) => new TextEncoder().encode(text);

  // ---- gif, as the encoder in mooboard/gif.py ----

  function hundredths(ms) {
    return Math.max(3, Math.min(65535, Math.trunc(ms / 10 + 0.5)));
  }

  function colorAt(rgb, i) {
    return (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
  }

  function channel(c, k) {
    return (c >> (16 - 8 * k)) & 255;
  }

  function changed(shown, rgb) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      let left = -1, right = -1;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        if (shown[i] !== rgb[i] || shown[i + 1] !== rgb[i + 1] || shown[i + 2] !== rgb[i + 2]) {
          if (left < 0) left = x;
          right = x;
        }
      }
      if (left < 0) continue;
      y0 = Math.min(y0, y);
      y1 = y;
      x0 = Math.min(x0, left);
      x1 = Math.max(x1, right);
    }
    return y1 < 0 ? [0, 0, 1, 1] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }

  function cropColors(rgb, box) {
    const [x, y, bw, bh] = box, out = [];
    for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) out.push(colorAt(rgb, (y + r) * W + x + c));
    return out;
  }

  function paste(shown, box, part) {
    const [x, y, bw, bh] = box, out = shown.slice();
    for (let r = 0; r < bh; r++) {
      for (let c = 0; c < bw; c++) {
        const v = part[r * bw + c], o = ((y + r) * W + x + c) * 3;
        out[o] = v >> 16;
        out[o + 1] = (v >> 8) & 255;
        out[o + 2] = v & 255;
      }
    }
    return out;
  }

  function sortedColors(colors) {
    return Array.from(new Set(colors)).sort((a, b) => a - b);
  }

  function boxOf(items) {
    const spans = [0, 1, 2].map((k) => {
      let lo = 255, hi = 0;
      for (const [c] of items) {
        const v = channel(c, k);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return hi - lo;
    });
    let total = 0;
    for (const [, n] of items) total += n;
    return { key: [Math.max(...spans), total], spans: spans, items: items };
  }

  function medianCut(counts, budget) {
    const boxes = [boxOf(Array.from(counts.entries()).sort((a, b) => a[0] - b[0]))];
    while (boxes.length < budget) {
      let best = -1;
      boxes.forEach((b, i) => {
        if (b.items.length > 1 && (best < 0 || b.key[0] > boxes[best].key[0] ||
                                   (b.key[0] === boxes[best].key[0] && b.key[1] > boxes[best].key[1]))) best = i;
      });
      if (best < 0) break;
      const taken = boxes.splice(best, 1)[0];
      const axis = taken.spans.indexOf(Math.max(...taken.spans));
      const items = taken.items.slice().sort((a, b) => channel(a[0], axis) - channel(b[0], axis) || a[0] - b[0]);
      let total = 0;
      for (const [, n] of items) total += n;
      let run = 0, cut = 1;
      for (let j = 0; j < items.length - 1; j++) {
        run += items[j][1];
        cut = j + 1;
        if (run * 2 >= total) break;
      }
      boxes.splice(best, 0, boxOf(items.slice(0, cut)), boxOf(items.slice(cut)));
    }
    return boxes.map((b) => b.items);
  }

  // more than 256 colors to 256 or fewer, black kept as black and nothing lit turned black
  function quantize(pixels) {
    const counts = new Map();
    for (const c of pixels) counts.set(c, (counts.get(c) || 0) + 1);
    const black = counts.has(0);
    counts.delete(0);
    const mapping = new Map();
    if (black) mapping.set(0, 0);
    for (const box of medianCut(counts, 256 - (black ? 1 : 0))) {
      let total = 0;
      const sums = [0, 0, 0];
      for (const [c, n] of box) {
        total += n;
        for (let k = 0; k < 3; k++) sums[k] += channel(c, k) * n;
      }
      let mean = (Math.trunc(sums[0] / total + 0.5) << 16) | (Math.trunc(sums[1] / total + 0.5) << 8) |
        Math.trunc(sums[2] / total + 0.5);
      if (mean === 0) {
        let most = box[0];
        for (const item of box) if (item[1] > most[1] || (item[1] === most[1] && item[0] > most[0])) most = item;
        mean = most[0];
      }
      for (const [c] of box) mapping.set(c, mean);
    }
    return mapping;
  }

  function colorTable(colors) {
    let bits = 1;
    while ((1 << bits) < colors.length) bits++;
    const table = new Uint8Array((1 << bits) * 3);
    colors.forEach((c, i) => table.set([c >> 16, (c >> 8) & 255, c & 255], i * 3));
    return [bits, table];
  }

  function lzwEncode(indices, minSize) {
    const clear = 1 << minSize, end = clear + 1, table = new Map(), out = [];
    let size = minSize + 1, next = end + 1, acc = 0, bits = 0;
    const put = (code, width) => {
      acc |= code << bits;
      bits += width;
      while (bits >= 8) {
        out.push(acc & 255);
        acc >>>= 8;
        bits -= 8;
      }
    };
    put(clear, size);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i], key = (prefix << 8) | k, code = table.get(key);
      if (code !== undefined) {
        prefix = code;
        continue;
      }
      put(prefix, size);
      if (next < 4096) {
        table.set(key, next);
        next++;
        if (next > 1 << size && size < 12) size++;
      } else {
        put(clear, size);
        table.clear();
        size = minSize + 1;
        next = end + 1;
      }
      prefix = k;
    }
    put(prefix, size);
    if (next < 4096 && next + 1 > 1 << size && size < 12) size++;
    put(end, size);
    if (bits) out.push(acc & 255);
    return out;
  }

  function subBlocks(data) {
    const out = [];
    for (let i = 0; i < data.length; i += 255) {
      const part = data.slice(i, i + 255);
      out.push(part.length);
      for (const v of part) out.push(v);
    }
    out.push(0);
    return out;
  }

  const NETSCAPE = [0x21, 0xff, 0x0b].concat(Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), [3, 1, 0, 0, 0]);

  // the frames as a looping gif, with each frame as a decoder shows it
  function encodeGif(frames) {
    const merged = [];
    for (const [rgb, ms] of frames) {
      if (rgb.length !== W * H * 3) throw new Error(fill(WORDS.frameSize, { w: W, h: H }));
      const last = merged[merged.length - 1];
      if (last && same(last[0], rgb)) last[1] += ms;
      else merged.push([rgb, ms]);
    }
    if (!merged.length) throw new Error(WORDS.noFrames);
    const every = new Set();
    for (const [rgb] of merged) for (let i = 0; i < W * H; i++) every.add(colorAt(rgb, i));
    const shared = every.size <= 256 ? Array.from(every).sort((a, b) => a - b) : null;
    const out = new Bytes().add(utf8('GIF89a')).le16(W).le16(H);
    let bits = 0, index = null;
    if (shared !== null) {
      const [b, table] = colorTable(shared);
      bits = b;
      out.add([0xf0 | (bits - 1), 0, 0]).add(table);
      index = new Map(shared.map((c, i) => [c, i]));
    } else {
      out.add([0x70, 0, 0]);
    }
    out.add(NETSCAPE);
    let shown = null;
    const seen = [];
    for (const [rgb, ms] of merged) {
      const box = shown === null ? [0, 0, W, H] : changed(shown, rgb);
      let part = cropColors(rgb, box), local = null;
      if (shared === null) {
        let colors = sortedColors(part);
        if (colors.length > 256) {
          const mapping = quantize(part);
          part = part.map((c) => mapping.get(c));
          colors = sortedColors(part);
        }
        const [b, table] = colorTable(colors);
        bits = b;
        local = table;
        index = new Map(colors.map((c, i) => [c, i]));
      }
      out.add([0x21, 0xf9, 0x04, 1 << 2]).le16(hundredths(ms)).add([0, 0]);
      out.add([0x2c]).le16(box[0]).le16(box[1]).le16(box[2]).le16(box[3]).add([local ? 0x80 | (bits - 1) : 0]);
      if (local) out.add(local);
      const minSize = Math.max(2, bits);
      out.add([minSize]).add(subBlocks(lzwEncode(part.map((c) => index.get(c)), minSize)));
      shown = paste(shown || new Uint8Array(W * H * 3), box, part);
      seen.push(shown);
    }
    out.add([0x3b]);
    return { bytes: out.done(), shown: seen, delays: merged.map(([, ms]) => hundredths(ms) * 10) };
  }

  // ---- png, stored deflate so the same pixels are the same bytes ----

  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

  function pngChunk(out, kind, body) {
    const typed = new Bytes().add(utf8(kind)).add(body).done();
    out.be32(body.length).add(typed).be32(crc32(typed));
  }

  function zlibStored(raw) {
    const out = new Bytes().add([0x78, 0x01]);
    for (let at = 0; at < raw.length; at += 65535) {
      const part = raw.subarray(at, at + 65535), n = part.length;
      out.add([at + 65535 >= raw.length ? 1 : 0, n & 255, n >> 8, (n ^ 0xffff) & 255, (n ^ 0xffff) >> 8]).add(part);
    }
    return out.be32(adler32(raw)).done();
  }

  function png(width, height, depth, kind, rows, extra) {
    const out = new Bytes().add(PNG_SIGNATURE);
    pngChunk(out, 'IHDR', new Bytes().be32(width).be32(height).add([depth, kind, 0, 0, 0]).done());
    for (const [name, body] of extra) pngChunk(out, name, body);
    pngChunk(out, 'IDAT', zlibStored(rows));
    pngChunk(out, 'IEND', new Uint8Array(0));
    return out.done();
  }

  function filtered(width, height, bytesPerPixel, at) {
    const rows = new Uint8Array(height * (1 + width * bytesPerPixel));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) at(rows, y * (1 + width * bytesPerPixel) + 1 + x * bytesPerPixel, y * width + x);
    }
    return rows;
  }

  // png.encode in the helper: 8 bit color and no alpha
  function encodePng(width, height, rgb) {
    return png(width, height, 8, 2, filtered(width, height, 3, (rows, o, i) => rows.set(rgb.subarray(i * 3, i * 3 + 3), o)), []);
  }

  // a picture with its alpha: a palette when it has 256 colors or fewer, else 8 bit color and alpha
  function encodePngRgba(width, height, rgba) {
    const value = (i) => ((rgba[i * 4 + 3] << 24) | (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]) >>> 0;
    const colors = new Set();
    for (let i = 0; i < width * height && colors.size <= 256; i++) colors.add(value(i));
    if (colors.size > 256) {
      const rows = filtered(width, height, 4, (out, o, i) => out.set(rgba.subarray(i * 4, i * 4 + 4), o));
      return png(width, height, 8, 6, rows, []);
    }
    const palette = Array.from(colors).sort((a, b) => a - b);
    const index = new Map(palette.map((c, i) => [c, i]));
    const plte = new Uint8Array(palette.length * 3);
    palette.forEach((c, i) => plte.set([(c >>> 16) & 255, (c >>> 8) & 255, c & 255], i * 3));
    const alphas = palette.map((c) => c >>> 24);
    let clear = alphas.length;
    while (clear > 0 && alphas[clear - 1] === 255) clear--;
    const extra = [['PLTE', plte]];
    if (clear) extra.push(['tRNS', Uint8Array.from(alphas.slice(0, clear))]);
    return png(width, height, 8, 3, filtered(width, height, 1, (rows, o, i) => { rows[o] = index.get(value(i)); }), extra);
  }

  // ---- zip, stored entries as package.write lays them out ----

  const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
  const ZIP_DATE = 0x21, REGULAR = 0o100644, MADE_BY = (3 << 8) | 20;

  function writeZip(entries) {
    const local = new Bytes(), central = new Bytes();
    for (const [name, data] of entries) {
      const raw = utf8(name), crc = crc32(data), offset = local.length;
      const header = () => new Bytes().le16(10).le16(0).le16(0).le16(0).le16(ZIP_DATE).le32(crc).le32(data.length)
        .le32(data.length).done();
      local.le32(LOCAL).add(header()).le16(raw.length).le16(0).add(raw).add(data);
      central.le32(CENTRAL).le16(MADE_BY).add(header()).le16(raw.length).le16(0).le16(0).le16(0).le16(0)
        .le32(REGULAR * 65536).le32(offset).add(raw);
    }
    const end = new Bytes().le32(END).le16(0).le16(0).le16(entries.length).le16(entries.length).le32(central.length)
      .le32(local.length).le16(0);
    return new Bytes().add(local.done()).add(central.done()).add(end.done()).done();
  }

  function u16At(b, p) {
    return b[p] | (b[p + 1] << 8);
  }

  function u32At(b, p) {
    return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  }

  // a zip's entries with their bytes as stored, method 8 left for the caller to inflate
  function readZip(data) {
    let end = -1;
    for (let p = data.length - 22; p >= Math.max(0, data.length - 22 - 65535); p--) {
      if (u32At(data, p) === END) {
        end = p;
        break;
      }
    }
    if (end < 0) throw new Error('not a zip');
    const count = u16At(data, end + 10);
    let p = u32At(data, end + 16);
    const out = [];
    for (let n = 0; n < count; n++) {
      if (u32At(data, p) !== CENTRAL) throw new Error('not a zip');
      const method = u16At(data, p + 10), stored = u32At(data, p + 20), size = u32At(data, p + 24);
      const nameLength = u16At(data, p + 28), offset = u32At(data, p + 42);
      const name = new TextDecoder().decode(data.subarray(p + 46, p + 46 + nameLength));
      p += 46 + nameLength + u16At(data, p + 30) + u16At(data, p + 32);
      if (u32At(data, offset) !== LOCAL) throw new Error('not a zip');
      const start = offset + 30 + u16At(data, offset + 26) + u16At(data, offset + 28);
      out.push({ name: name, method: method, data: data.subarray(start, start + stored), size: size });
    }
    return out;
  }

  // ---- the package, as mooboard/package.py and mooboard/build.py ----

  function isNumber(value, low, high) {
    return Number.isInteger(value) && low <= value && value <= high;
  }

  function points(text) {
    return Array.from(text);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function checkSettings(items) {
    if (!Array.isArray(items) || items.length > MAX_SETTINGS) throw new Refused(WORDS.settings);
    const found = new Map();
    items.forEach((setting, i) => {
      const object = isObject(setting);
      const key = object ? setting.key : undefined, kind = object ? setting.type : undefined;
      const label = object ? setting.label : undefined;
      const name = typeof key === 'string' ? key : '#' + (i + 1);
      const known = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(SETTING_FIELDS, kind);
      if (!known || typeof key !== 'string' || !KEY.test(key) || typeof label !== 'string' ||
          points(label).length < 1 || points(label).length > 24 || !('default' in setting) ||
          Object.keys(setting).some((k) => !['key', 'type', 'label', 'default'].includes(k) &&
                                           !SETTING_FIELDS[kind].includes(k))) {
        throw new Refused(fill(WORDS.setting, { name: name }));
      }
      if (found.has(key)) throw new Refused(fill(WORDS.settingTwice, { name: name }));
      const value = setting.default;
      let good;
      if (kind === 'text') {
        good = typeof value === 'string' && isNumber(setting.max, 1, 32) && points(value).length >= 1 &&
          points(value).length <= setting.max;
      } else if (kind === 'color') {
        good = typeof value === 'string' && COLOR.test(value);
      } else if (kind === 'toggle') {
        good = typeof value === 'boolean';
      } else {
        const options = setting.options;
        good = Array.isArray(options) && options.length >= 2 && options.length <= 8 &&
          options.every((o) => typeof o === 'string' && points(o).length >= 1 && points(o).length <= 16) &&
          new Set(options).size === options.length && options.includes(value);
      }
      if (!good) throw new Refused(fill(SETTING_TYPE[kind], { name: name }));
      found.set(key, setting);
    });
    return found;
  }

  function wordsIn(text) {
    return Array.from(text.matchAll(WORD), (m) => m[1]);
  }

  function shown(layer, values) {
    if (layer.show === undefined || layer.show === null) return true;
    const at = layer.show.indexOf('=');
    if (at < 0) return Boolean(values[layer.show]);
    const option = layer.show.slice(at + 1);
    return option ? values[layer.show.slice(0, at)] === option : Boolean(values[layer.show.slice(0, at)]);
  }

  function checkLayers(items, settings, images) {
    if (!Array.isArray(items) || items.length > MAX_LAYERS) throw new Refused(WORDS.layers);
    items.forEach((layer, i) => {
      const number = i + 1, kind = isObject(layer) ? layer.type : undefined;
      const keys = kind ? Object.keys(layer) : [];
      let good;
      if (kind === 'text') {
        good = ['type', 'text', 'size'].every((k) => keys.includes(k)) && keys.every((k) => TEXT_LAYER.includes(k)) &&
          typeof layer.text === 'string' && SIZES.includes(layer.size) && FONTS.includes(absent(layer.font, 'nunito')) &&
          ALIGNS.includes(absent(layer.align, 'left')) && typeof absent(layer.color, '#ffffff') === 'string';
      } else if (kind === 'image') {
        good = ['type', 'src', 'x', 'y'].every((k) => keys.includes(k)) && keys.every((k) => IMAGE_LAYER.includes(k)) &&
          typeof layer.src === 'string' && IMAGE.test(layer.src);
      } else {
        good = false;
      }
      good = good && [['x', W - 1], ['y', H - 1]].every(([axis, top]) => given(layer[axis], null) === null ||
                                                                        isNumber(layer[axis], 0, top));
      good = good && typeof absent(layer.show, '') === 'string';
      if (!good) throw new Refused(fill(WORDS.layer, { number: number }));
      const uses = [];
      if (kind === 'text') {
        for (const key of wordsIn(layer.text)) uses.push([key, ['text', 'choice']]);
        const color = absent(layer.color, '#ffffff');
        if (!COLOR.test(color)) {
          const found = /^\{([^{}]*)\}$/.exec(color);
          uses.push([found ? found[1] : color, ['color']]);
        }
      }
      for (const [key, want] of uses) {
        if (!settings.has(key) || !want.includes(settings.get(key).type)) {
          throw new Refused(fill(WORDS.layerSetting, { number: number, key: key }));
        }
      }
      if ('show' in layer) {
        const at = layer.show.indexOf('=');
        const key = at < 0 ? layer.show : layer.show.slice(0, at), option = at < 0 ? '' : layer.show.slice(at + 1);
        const setting = settings.get(key);
        const fine = option ? setting !== undefined && setting.type === 'choice' && setting.options.includes(option)
          : setting !== undefined && setting.type === 'toggle';
        if (!fine) throw new Refused(fill(WORDS.layerSetting, { number: number, key: layer.show }));
      }
      if (kind === 'image' && images !== null && images !== undefined && !images.has(layer.src)) {
        throw new Refused(fill(WORDS.layerImage, { number: number, src: layer.src }));
      }
    });
  }

  function defaults(settings) {
    const out = {};
    for (const [key, s] of settings) out[key] = s.default;
    return out;
  }

  function settingsOf(manifest) {
    return new Map((manifest.settings || []).map((s) => [s.key, s]));
  }

  function fitSets(layer, settings, number) {
    const keys = Array.from(new Set(wordsIn(layer.text).filter((k) => settings.get(k).type === 'choice'))).sort();
    let total = 1;
    for (const key of keys) total *= settings.get(key).options.length;
    if (total > MAX_COMBINATIONS) throw new Refused(fill(WORDS.layerMany, { number: number }));
    let sets = [defaults(settings)];
    for (const key of keys) {
      const next = [];
      for (const set of sets) {
        for (const option of settings.get(key).options) next.push(Object.assign({}, set, { [key]: option }));
      }
      sets = next;
    }
    return sets;
  }

  function wordsOf(layer, values) {
    const known = (key) => Object.prototype.hasOwnProperty.call(values, key);
    return layer.text.replace(WORD, (found, key) => (known(key) ? String(values[key]) : found));
  }

  function fits(kit, layer, words) {
    try {
      new Screen(kit).place({ words: words, x: layer.x, y: layer.y, size: layer.size, font: absent(layer.font, 'nunito'),
                              align: absent(layer.align, 'left') });
      return true;
    } catch (error) {
      if (error instanceof TooLong) return false;
      throw error;
    }
  }

  // options: kit for the text, built for a package's own manifest, images the names an image layer may use
  function checkManifest(manifest, options) {
    const built = Boolean(options.built), images = options.images === undefined ? null : options.images;
    for (const key of FIELDS.concat(built ? BUILT : [])) {
      if (!(key in manifest)) throw new Refused(fill(WORDS.needs, { key: key }));
    }
    const allowed = FIELDS.concat(EXTRAS, built ? BUILT : []);
    for (const key of Object.keys(manifest)) {
      if (!allowed.includes(key)) throw new Refused(fill(WORDS.unknown, { key: key }));
    }
    if (!isNumber(manifest.mooboard, 1, 1)) throw new Refused(WORDS.version);
    if (typeof manifest.id !== 'string' || !ID.test(manifest.id)) throw new Refused(WORDS.id);
    const name = manifest.name;
    if (typeof name !== 'string' || points(name).length < 1 || points(name).length > 24 || !name.trim() ||
        OTHER.test(name)) throw new Refused(WORDS.name);
    if (name.includes('://')) throw new Refused(WORDS.nameLink);
    if (typeof manifest.author !== 'string' || !AUTHOR.test(manifest.author)) throw new Refused(WORDS.author);
    if (!isNumber(manifest.refresh, 300, 86400)) throw new Refused(WORDS.refresh);
    if (!isNumber(manifest.duration, 5, 60)) throw new Refused(WORDS.duration);
    if (built && (!isNumber(manifest.frames, 1, MAX_FRAMES) || typeof manifest.built !== 'string' ||
                  !STAMP.test(manifest.built))) throw new Refused(WORDS.packageBad);
    const settings = checkSettings(manifest.settings === undefined ? [] : manifest.settings);
    const layers = manifest.layers === undefined ? [] : manifest.layers;
    checkLayers(layers, settings, images);
    layers.forEach((layer, i) => {
      if (layer.type !== 'text') return;
      for (const values of fitSets(layer, settings, i + 1)) {
        const words = wordsOf(layer, values);
        if (!fits(options.kit, layer, words)) throw new Refused(fill(WORDS.layerFit, { number: i + 1, words: words }));
      }
    });
    return manifest;
  }

  function lit(rgb, i) {
    return Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) >= LOWEST_LIT;
  }

  function ringLit(rgb) {
    for (let x = 0; x < W; x++) if (lit(rgb, x) || lit(rgb, (H - 1) * W + x)) return true;
    for (let y = 1; y < H - 1; y++) if (lit(rgb, y * W) || lit(rgb, y * W + W - 1)) return true;
    return false;
  }

  function dim(rgb) {
    for (let i = 0; i < W * H; i++) {
      const top = Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
      if (top <= 0 || top >= LOWEST_LIT) continue;
      const x = i % W, y = Math.floor(i / W);
      let beside = false;
      for (let dx = -1; dx <= 1 && !beside; dx++) {
        for (let dy = -1; dy <= 1 && !beside; dy++) {
          if ((dx || dy) && x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && lit(rgb, (y + dy) * W + x + dx)) {
            beside = true;
          }
        }
      }
      if (!beside) return true;
    }
    return false;
  }

  // the edge ring refuses and dim colors warn, as package.check_frames
  function checkFrames(frames) {
    if (frames.some(([rgb]) => ringLit(rgb))) throw new Refused(WORDS.edge);
    return frames.some(([rgb]) => dim(rgb)) ? [WORDS.dim] : [];
  }

  // the layers drawn over every frame at the given values, as package.compose
  function composeLayers(frames, manifest, images, values, kit) {
    const settings = settingsOf(manifest);
    const at = Object.assign(defaults(settings), values || {});
    const screen = new Screen(kit), recorder = new Recorder();
    screen.canvas = recorder;
    for (const layer of manifest.layers || []) {
      if (!shown(layer, at)) continue;
      if (layer.type === 'image') {
        const p = images[layer.src];
        screen.imageRgba(p.width, p.height, p.rgba, layer.x, layer.y);
        continue;
      }
      let color = absent(layer.color, '#ffffff');
      if (!COLOR.test(color)) color = at[color.slice(1, -1)];
      try {
        screen.text({ words: wordsOf(layer, at), x: layer.x, y: layer.y, size: layer.size, color: color,
                      font: absent(layer.font, 'nunito'), align: absent(layer.align, 'left') });
      } catch (error) {
        if (!(error instanceof TooLong)) throw error;
      }
    }
    return frames.map(([rgb, ms]) => {
      const px = rgb.slice();
      for (const [o, color, t] of recorder.ops) blend(px, o, color, t);
      return [px, ms];
    });
  }

  function textVariant(manifest, setting, kit) {
    const layers = (manifest.layers || []).filter((l) => l.type === 'text' && l.text.includes('{' + setting.key + '}'));
    const base = defaults(settingsOf(manifest));
    let words = points(setting.label).slice(0, setting.max);
    const fitsAll = () => layers.every((l) => fits(kit, l, wordsOf(l, Object.assign({}, base,
                                                                                     { [setting.key]: words.join('') }))));
    while (words.length > 1 && !fitsAll()) words = words.slice(0, -1);
    return words.join('');
  }

  // the defaults, then each setting changed alone, as package.variants
  function variants(manifest, kit) {
    const settings = settingsOf(manifest), base = defaults(settings);
    const out = [{ key: null, value: null, values: Object.assign({}, base) }];
    for (const [key, s] of settings) {
      let changes;
      if (s.type === 'toggle') changes = [!s.default];
      else if (s.type === 'color') changes = [VARIANT_COLORS.find((c) => c !== s.default.toLowerCase())];
      else if (s.type === 'choice') changes = s.options.filter((o) => o !== s.default);
      else changes = [textVariant(manifest, s, kit)];
      for (const value of changes) out.push({ key: key, value: value, values: Object.assign({}, base, { [key]: value }) });
    }
    return out;
  }

  // a 32 by 32 crop around what the first frame lights, as package.default_icon
  function defaultIcon(rgb) {
    let minX = W, maxX = -1, minY = H, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      if (!lit(rgb, i)) continue;
      const x = i % W, y = Math.floor(i / W);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const cx = maxX < 0 ? W / 2 : Math.floor((minX + maxX + 1) / 2), cy = maxY < 0 ? H / 2 : Math.floor((minY + maxY + 1) / 2);
    const x0 = Math.min(Math.max(cx - ICON / 2, 0), W - ICON), y0 = Math.min(Math.max(cy - ICON / 2, 0), H - ICON);
    const crop = new Uint8Array(ICON * ICON * 3);
    for (let y = 0; y < ICON; y++) crop.set(rgb.subarray(((y0 + y) * W + x0) * 3, ((y0 + y) * W + x0 + ICON) * 3), y * ICON * 3);
    return encodePng(ICON, ICON, crop);
  }

  function canonical(manifest) {
    const pick = (object, keys) => {
      const out = {};
      for (const key of keys) if (key in object) out[key] = object[key];
      return out;
    };
    const out = pick(manifest, FIELDS);
    if ('settings' in manifest) out.settings = manifest.settings.map((s) => pick(s, SETTING_ORDER));
    if ('layers' in manifest) out.layers = manifest.layers.map((layer) => pick(layer, LAYER_ORDER));
    return Object.assign(out, pick(manifest, BUILT));
  }

  // the one way the writer lays a manifest out, as package.manifest_bytes
  function manifestBytes(manifest) {
    return utf8(JSON.stringify(canonical(manifest), null, 2) + '\n');
  }

  function writePackage(manifest, gif, icon, images) {
    const entries = [['mooboard.json', manifestBytes(manifest)], ['app.gif', gif], ['icon.png', icon]];
    for (const name of Object.keys(images).sort()) entries.push([name, images[name]]);
    return writeZip(entries);
  }

  function pngSize(data) {
    return [((data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]) >>> 0,
            ((data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]) >>> 0];
  }

  // app holds the author's manifest, the frames of a compose that met no failure, every picture in images/ by its
  // path with its png and pixels, the built stamp and the kit for text
  function build(app) {
    const kit = app.kit;
    const manifest = checkManifest(app.manifest, { images: new Set(Object.keys(app.images)), kit: kit });
    const encoded = encodeGif(app.frames);
    if (encoded.bytes.length > GIF_CAP) throw new Refused(WORDS.bytes);
    const frames = encoded.shown.map((rgb, i) => [rgb, encoded.delays[i]]);
    const warnings = checkFrames(frames);
    const images = {}, pictures = {};
    for (const layer of manifest.layers || []) {
      if (layer.type !== 'image' || layer.src in images) continue;
      const p = app.images[layer.src], [w, h] = pngSize(p.png);
      if (p.png.length > PNG_CAP || w < 1 || w > W || h < 1 || h > H) {
        throw new Refused(fill(WORDS.imageBig, { name: layer.src }));
      }
      images[layer.src] = p.png;
      pictures[layer.src] = p;
    }
    const whole = {};
    for (const key of FIELDS.concat(EXTRAS)) if (key in manifest) whole[key] = manifest[key];
    whole.frames = frames.length;
    whole.built = app.built;
    const icon = defaultIcon(composeLayers(frames.slice(0, 1), whole, pictures, null, kit)[0][0]);
    const data = writePackage(whole, encoded.bytes, icon, images);
    if (data.length > MAX_PACKAGE) throw new Refused(WORDS.packageBig);
    if (manifestBytes(whole).length > MANIFEST_CAP || Object.keys(images).length > MAX_IMAGES) {
      throw new Refused(WORDS.packageBad);
    }
    checkManifest(whole, { built: true, images: new Set(Object.keys(images)), kit: kit });
    if (icon.length > PNG_CAP) throw new Refused(WORDS.icon);
    for (const variant of variants(whole, kit)) {
      for (const warning of checkFrames(composeLayers(frames, whole, pictures, variant.values, kit))) {
        if (!warnings.includes(warning)) warnings.push(warning);
      }
    }
    return { package: data, gif: encoded.bytes, icon: icon, manifest: whole, frames: frames, warnings: warnings };
  }

  function stamp(date) {
    return date.toISOString().slice(0, 19) + 'Z';
  }

  const api = { W, H, SAFE, SIZES, FONTS, ALIGNS, MAX_FRAMES, WORDS, DAYS, fill, TooLong, Refused, Atlas, layout, ink,
                drawText, blend, colorOf, Canvas, Screen, clockWords, clockNow, crc32, adler32, encodeGif, encodePng,
                encodePngRgba, writeZip, readZip, checkManifest, checkSettings, checkLayers, checkFrames, composeLayers, variants,
                defaultIcon,
                manifestBytes, writePackage, build, stamp, ringLit, shown };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mooboardHelper = api;
})(typeof window !== 'undefined' ? window : this);
