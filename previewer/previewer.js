/* mooboard previewer: a picture shown as the board's LEDs, all in this browser */
(function (root) {
  'use strict';

  const PANEL_W = 128;
  const PANEL_H = 32;
  const LOWEST_LIT = 5;        // a channel below the panel's lowest step lights nothing
  const MIN_FRAME_MS = 33;     // the board's frame
  const SHORTEST_GIF_MS = 30;  // the shortest gif frame that keeps up with the board
  const NIGHT_LEVEL = 40;      // the night clock's red out of the box
  const LOW_SHARE = 0.6;       // the evening dimming's share of the light out of the box
  const MAX_PIXELS = 1 << 24;  // the most one file may decode to over all its frames

  const WORDS = {
    size: 'Not 128×32',
    edge: 'Lit pixels in the edge ring',
    dim: 'Colors too dim to light',
    fast: 'Frames shorter than 30 ms',
    unreadable: 'Can’t read this file',
  };

  // ---- the led look as the simulator draws it ----

  // the pixels of each LED's block that its round dot lights, summed in float32 like the simulator
  function dotMask(scale) {
    const f = Math.fround;
    const half = f(scale / 2);
    const radius = f(f(0.45) * scale);
    const r2 = f(radius * radius);
    const mask = new Uint8Array(scale * scale);
    for (let j = 0; j < scale; j++) {
      const dy = f(f(j + 0.5) - half);
      for (let i = 0; i < scale; i++) {
        const dx = f(f(i + 0.5) - half);
        mask[j * scale + i] = f(f(dx * dx) + f(dy * dy)) <= r2 ? 1 : 0;
      }
    }
    return mask;
  }

  // one pixel per LED in, scale pixels per LED out, black between the dots
  function ledLook(rgb, width, height, scale) {
    const mask = dotMask(scale);
    const outW = width * scale;
    const out = new Uint8ClampedArray(outW * height * scale * 4);
    for (let k = 3; k < out.length; k += 4) out[k] = 255;
    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        const s = (cy * width + cx) * 3;
        const r = rgb[s], g = rgb[s + 1], b = rgb[s + 2];
        if (r === 0 && g === 0 && b === 0) continue;
        for (let j = 0; j < scale; j++) {
          const row = ((cy * scale + j) * outW + cx * scale) * 4;
          for (let i = 0; i < scale; i++) {
            if (mask[j * scale + i] === 0) continue;
            const o = row + i * 4;
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
          }
        }
      }
    }
    return out;
  }

  // ---- the night tint as the firmware applies it ----

  // every lit LED in the night clock's red, its brightest channel scaled to the level
  function nightTint(rgb, level) {
    const out = new Uint8Array(rgb.length);
    for (let k = 0; k < rgb.length; k += 3) {
      const top = Math.max(rgb[k], rgb[k + 1], rgb[k + 2]);
      out[k] = Math.floor((top * level + 127) / 255);
    }
    return out;
  }

  // ---- brightness ----

  function toLinear(v) {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function toSrgb(light) {
    const c = light <= 0.0031308 ? light * 12.92 : 1.055 * Math.pow(light, 1 / 2.4) - 0.055;
    return Math.round(c * 255);
  }

  const LOW_TABLE = new Uint8Array(256);
  for (let v = 0; v < 256; v++) LOW_TABLE[v] = toSrgb(toLinear(v) * LOW_SHARE);

  // each led at the evening's share of its light
  function lowBrightness(rgb) {
    const out = new Uint8Array(rgb.length);
    for (let k = 0; k < rgb.length; k++) out[k] = LOW_TABLE[rgb[k]];
    return out;
  }

  // ---- the warnings ----

  function litAt(rgb, w, h, x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const k = (y * w + x) * 3;
    return Math.max(rgb[k], rgb[k + 1], rgb[k + 2]) >= LOWEST_LIT;
  }

  // a faint pixel next to a lit one is antialiased ink, and losing it changes nothing
  function besideLit(rgb, w, h, x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx !== 0 || dy !== 0) && litAt(rgb, w, h, x + dx, y + dy)) return true;
      }
    }
    return false;
  }

  // the rules a picture breaks in the order the page lists them
  function warnings(image) {
    const found = [];
    const w = image.width, h = image.height;
    // the other checks only make sense for a 128 by 32 picture
    if (w !== PANEL_W || h !== PANEL_H) return ['size'];
    let edge = false, dim = false;
    for (const frame of image.frames) {
      const rgb = frame.rgb;
      for (let y = 0; y < h; y++) {
        const ringRow = y === 0 || y === h - 1;
        for (let x = 0; x < w; x++) {
          const k = (y * w + x) * 3;
          const top = Math.max(rgb[k], rgb[k + 1], rgb[k + 2]);
          if (top === 0) continue;
          if (top >= LOWEST_LIT) {
            if (ringRow || x === 0 || x === w - 1) edge = true;
          } else if (!dim && !besideLit(rgb, w, h, x, y)) {
            dim = true;
          }
        }
      }
      if (edge && dim) break;
    }
    if (edge) found.push('edge');
    if (dim) found.push('dim');
    if (image.frames.length > 1 && image.frames.some((frame) => frame.delay < SHORTEST_GIF_MS)) found.push('fast');
    return found;
  }

  function over(c, a) {
    return a === 255 ? c : Math.floor((c * a + 127) / 255);
  }

  // ---- png ----

  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

  function isPng(b) {
    return b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);
  }

  function uint32At(b, p) {
    return b[p] * 16777216 + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
  }

  function uint16At(b, p) {
    return (b[p] << 8) | b[p + 1];
  }

  // the chunks a png is drawn from, its rows still compressed
  function parsePng(b) {
    if (!isPng(b)) throw new Error('not a png');
    let p = 8, info = null, palette = null, trns = null, size = 0;
    const parts = [];
    while (p + 12 <= b.length) {
      const length = uint32At(b, p);
      const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      const start = p + 8, end = start + length;
      if (end + 4 > b.length) throw new Error('truncated png');
      if (type === 'IHDR' && length >= 13) {
        info = { width: uint32At(b, start), height: uint32At(b, start + 4), depth: b[start + 8],
                 colorType: b[start + 9], interlace: b[start + 12] };
      } else if (type === 'PLTE') palette = b.subarray(start, end);
      else if (type === 'tRNS') trns = b.subarray(start, end);
      else if (type === 'IDAT') {
        parts.push(b.subarray(start, end));
        size += length;
      } else if (type === 'IEND') break;
      p = end + 4;
    }
    if (info === null || parts.length === 0) throw new Error('no png picture');
    const depths = DEPTHS[info.colorType];
    if (depths === undefined || depths.indexOf(info.depth) < 0 || info.interlace > 1) throw new Error('unsupported png');
    if (info.width < 1 || info.height < 1 || info.width * info.height > MAX_PIXELS) throw new Error('png too large');
    if (info.colorType === 3 && palette === null) throw new Error('png without its palette');
    const idat = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      idat.set(part, at);
      at += part.length;
    }
    info.channels = CHANNELS[info.colorType];
    info.palette = palette;
    info.trns = trns;
    info.idat = idat;
    return info;
  }

  function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  // unfilters one pass's rows in place and returns where the next pass starts
  function unfilter(raw, at, rowBytes, rows, bpp) {
    let prev = -1;
    for (let y = 0; y < rows; y++) {
      if (at + 1 + rowBytes > raw.length) throw new Error('truncated png');
      const type = raw[at], row = at + 1;
      if (type > 4) throw new Error('bad png filter');
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= bpp ? raw[row + i - bpp] : 0;
        const up = prev >= 0 ? raw[prev + i] : 0;
        const corner = prev >= 0 && i >= bpp ? raw[prev + i - bpp] : 0;
        let x = raw[row + i];
        if (type === 1) x += left;
        else if (type === 2) x += up;
        else if (type === 3) x += (left + up) >> 1;
        else if (type === 4) x += paeth(left, up, corner);
        raw[row + i] = x & 255;
      }
      prev = row;
      at = row + rowBytes;
    }
    return at;
  }

  function sampleAt(raw, row, index, depth) {
    if (depth === 8) return raw[row + index];
    if (depth === 16) return (raw[row + index * 2] << 8) | raw[row + index * 2 + 1];
    const bit = index * depth;
    return (raw[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  }

  // raw values with their alpha, without gamma or color profiles, as the board decodes them
  function pngRgba(info, raw) {
    const w = info.width, h = info.height, depth = info.depth, ch = info.channels, type = info.colorType;
    const bits = ch * depth, bpp = Math.max(1, bits >> 3);
    const max = depth === 16 ? 65535 : (1 << depth) - 1;
    const to8 = depth === 16 ? (v) => v >> 8 : depth === 8 ? (v) => v : (v) => Math.round((v * 255) / max);
    let key = null;
    if (info.trns !== null && type === 0) key = [uint16At(info.trns, 0)];
    if (info.trns !== null && type === 2) key = [uint16At(info.trns, 0), uint16At(info.trns, 2), uint16At(info.trns, 4)];
    const rgba = new Uint8Array(w * h * 4);
    const s = [0, 0, 0, 0];
    let at = 0;
    for (const pass of info.interlace === 1 ? ADAM7 : [[0, 0, 1, 1]]) {
      const pw = Math.ceil((w - pass[0]) / pass[2]), ph = Math.ceil((h - pass[1]) / pass[3]);
      if (pw <= 0 || ph <= 0) continue;
      const rowBytes = Math.ceil((pw * bits) / 8);
      const first = at;
      at = unfilter(raw, at, rowBytes, ph, bpp);
      for (let y = 0; y < ph; y++) {
        const row = first + y * (rowBytes + 1) + 1;
        for (let x = 0; x < pw; x++) {
          for (let c = 0; c < ch; c++) s[c] = sampleAt(raw, row, x * ch + c, depth);
          let r = 0, g = 0, b = 0, a = 255;
          if (type === 3) {
            const i = s[0] * 3;
            if (i + 2 < info.palette.length) {
              r = info.palette[i];
              g = info.palette[i + 1];
              b = info.palette[i + 2];
            }
            if (info.trns !== null && s[0] < info.trns.length) a = info.trns[s[0]];
          } else if (type === 0 || type === 4) {
            r = g = b = to8(s[0]);
            if (type === 4) a = to8(s[1]);
            else if (key !== null && s[0] === key[0]) a = 0;
          } else {
            r = to8(s[0]);
            g = to8(s[1]);
            b = to8(s[2]);
            if (type === 6) a = to8(s[3]);
            else if (key !== null && s[0] === key[0] && s[1] === key[1] && s[2] === key[2]) a = 0;
          }
          const o = ((pass[1] + y * pass[3]) * w + pass[0] + x * pass[2]) * 4;
          rgba[o] = r;
          rgba[o + 1] = g;
          rgba[o + 2] = b;
          rgba[o + 3] = a;
        }
      }
    }
    return { width: w, height: h, rgba: rgba };
  }

  // the picture over black, as the board shows it
  function pngImage(info, raw) {
    const p = pngRgba(info, raw), rgba = p.rgba;
    const rgb = new Uint8Array(p.width * p.height * 3);
    for (let i = 0, k = 0; i < rgba.length; i += 4, k += 3) {
      rgb[k] = over(rgba[i], rgba[i + 3]);
      rgb[k + 1] = over(rgba[i + 1], rgba[i + 3]);
      rgb[k + 2] = over(rgba[i + 2], rgba[i + 3]);
    }
    return { width: p.width, height: p.height, frames: [{ rgb: rgb, delay: 0 }] };
  }

  // ---- gif ----

  const INTERLACE = [[0, 8], [4, 8], [2, 4], [1, 2]];

  function isGif(b) {
    return b.length >= 6 && b[0] === 71 && b[1] === 73 && b[2] === 70 && b[3] === 56 &&
      (b[4] === 55 || b[4] === 57) && b[5] === 97;
  }

  // a run of sub-blocks joined, and where they end
  function subBlocks(b, p) {
    const parts = [];
    let size = 0;
    while (p < b.length) {
      const n = b[p++];
      if (n === 0) break;
      const part = b.subarray(p, Math.min(b.length, p + n));
      parts.push(part);
      size += part.length;
      p += n;
    }
    const data = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      data.set(part, at);
      at += part.length;
    }
    return { data: data, end: Math.min(p, b.length) };
  }

  // one frame's lzw codes as color indices, fewer than count when the stream ends early
  function lzw(data, minSize, count) {
    const clear = 1 << minSize, end = clear + 1;
    const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
    for (let i = 0; i < clear; i++) suffix[i] = i;
    const out = new Uint8Array(count);
    let size = minSize + 1, next = end + 1, old = -1, first = 0, acc = 0, bits = 0, pos = 0, n = 0;
    while (n < count) {
      while (bits < size && pos < data.length) {
        acc |= data[pos++] << bits;
        bits += 8;
      }
      if (bits < size) break;
      let code = acc & ((1 << size) - 1);
      acc >>>= size;
      bits -= size;
      if (code === clear) {
        size = minSize + 1;
        next = end + 1;
        old = -1;
        continue;
      }
      if (code === end) break;
      if (old === -1) {
        if (code >= clear) break;
        out[n++] = code;
        old = first = code;
        continue;
      }
      const inCode = code;
      let sp = 0;
      if (code >= next) {
        if (code > next) break;
        stack[sp++] = first;
        code = old;
      }
      while (code > end) {
        stack[sp++] = suffix[code];
        code = prefix[code];
      }
      first = code;
      stack[sp++] = code;
      if (next < 4096) {
        prefix[next] = old;
        suffix[next] = first;
        next++;
        if (next === 1 << size && size < 12) size++;
      }
      while (sp > 0 && n < count) out[n++] = stack[--sp];
      old = inCode;
    }
    return n === count ? out : out.subarray(0, n);
  }

  function interlacedRows(h) {
    const rows = [];
    for (const [from, step] of INTERLACE) for (let y = from; y < h; y += step) rows.push(y);
    return rows;
  }

  function clearRect(canvas, w, h, r) {
    for (let y = r.y; y < Math.min(h, r.y + r.h); y++) {
      for (let x = r.x; x < Math.min(w, r.x + r.w); x++) canvas.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
    }
  }

  // every frame as the gif spec composes it, with LEDs no frame drew left off
  function decodeGif(b) {
    if (!isGif(b) || b.length < 13) throw new Error('not a gif');
    const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8), flags = b[10];
    if (w < 1 || h < 1) throw new Error('empty gif');
    if (w * h > MAX_PIXELS) throw new Error('gif too large');
    let p = 13, global = null;
    if (flags & 0x80) {
      const n = 2 << (flags & 7);
      global = b.subarray(p, p + n * 3);
      p += n * 3;
    }
    let canvas = new Uint8Array(w * h * 4);
    const frames = [];
    let control = null, last = null;
    while (p < b.length) {
      const tag = b[p++];
      if (tag === 0x3b) break;
      if (tag === 0x21) {
        const label = b[p++];
        if (label === 0xf9 && p + 4 < b.length && b[p] >= 4) {
          const packed = b[p + 1];
          control = { disposal: (packed >> 2) & 7, delay: (b[p + 2] | (b[p + 3] << 8)) * 10,
                      transparent: packed & 1 ? b[p + 4] : -1 };
        }
        p = subBlocks(b, p).end;
        continue;
      }
      if (tag !== 0x2c) {
        if (frames.length > 0) break;
        throw new Error('bad gif block');
      }
      if (p + 10 > b.length) break;
      const fx = b[p] | (b[p + 1] << 8), fy = b[p + 2] | (b[p + 3] << 8);
      const fw = b[p + 4] | (b[p + 5] << 8), fh = b[p + 6] | (b[p + 7] << 8), fflags = b[p + 8];
      p += 9;
      let table = global;
      if (fflags & 0x80) {
        const n = 2 << (fflags & 7);
        table = b.subarray(p, p + n * 3);
        p += n * 3;
      }
      if (table === null) throw new Error('gif without colors');
      const minSize = b[p++];
      if (minSize < 2 || minSize > 11) throw new Error('bad gif code size');
      const blocks = subBlocks(b, p);
      p = blocks.end;
      if ((frames.length + 1) * w * h > MAX_PIXELS || fw * fh > MAX_PIXELS) throw new Error('gif too large');
      if (last !== null && last.disposal === 2) clearRect(canvas, w, h, last);
      else if (last !== null && last.disposal === 3 && last.saved !== null) canvas = last.saved;
      const use = control || { disposal: 0, delay: 0, transparent: -1 };
      control = null;
      const saved = use.disposal === 3 ? canvas.slice() : null;
      const indices = lzw(blocks.data, minSize, fw * fh);
      const rows = fflags & 0x40 ? interlacedRows(fh) : null;
      for (let i = 0; i < fh; i++) {
        const y = fy + (rows !== null ? rows[i] : i);
        if (y >= h) continue;
        for (let x = 0; x < fw; x++) {
          const cx = fx + x;
          if (cx >= w || i * fw + x >= indices.length) break;   // what never arrived stays as it was
          const index = indices[i * fw + x];
          if (index === use.transparent || index * 3 + 2 >= table.length) continue;
          const o = (y * w + cx) * 4;
          canvas[o] = table[index * 3];
          canvas[o + 1] = table[index * 3 + 1];
          canvas[o + 2] = table[index * 3 + 2];
          canvas[o + 3] = 255;
        }
      }
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0, k = 0; i < canvas.length; i += 4, k += 3) {
        rgb[k] = canvas[i];
        rgb[k + 1] = canvas[i + 1];
        rgb[k + 2] = canvas[i + 2];
      }
      frames.push({ rgb: rgb, delay: use.delay });
      last = { disposal: use.disposal, x: fx, y: fy, w: fw, h: fh, saved: saved };
    }
    if (frames.length === 0) throw new Error('gif without frames');
    return { width: w, height: h, frames: frames };
  }

  // a png or gif as frames, inflate turning zlib data into bytes
  function decode(bytes, inflate) {
    return Promise.resolve().then(() => {
      if (isGif(bytes)) return decodeGif(bytes);
      if (!isPng(bytes)) throw new Error('not a png or gif');
      const info = parsePng(bytes);
      return inflate(info.idat).then((raw) => pngImage(info, raw));
    });
  }

  // ---- the page ----

  // zlib bytes inflated by the browser
  function browserInflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }

  // a png through the browser's own decoder when DecompressionStream is missing
  function canvasImage(bytes) {
    return createImageBitmap(new Blob([bytes], { type: 'image/png' }),
                             { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).then((bitmap) => {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const d = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb = new Uint8Array(canvas.width * canvas.height * 3);
      for (let i = 0, k = 0; i < d.length; i += 4, k += 3) {
        rgb[k] = over(d[i], d[i + 3]);
        rgb[k + 1] = over(d[i + 1], d[i + 3]);
        rgb[k + 2] = over(d[i + 2], d[i + 3]);
      }
      return { width: canvas.width, height: canvas.height, frames: [{ rgb: rgb, delay: 0 }] };
    });
  }

  function decodeInPage(bytes) {
    if (isPng(bytes) && typeof DecompressionStream !== 'function') return canvasImage(bytes);
    return decode(bytes, browserInflate);
  }

  function start(doc) {
    const byId = (id) => doc.getElementById(id);
    const pick = byId('pick'), drop = byId('drop'), stage = byId('stage'), board = byId('board');
    const leds = byId('leds'), glow = byId('glow'), ring = byId('ring'), list = byId('warnings');
    const night = byId('night'), low = byId('low'), high = byId('high'), ringToggle = byId('ringToggle');
    let image = null, frame = 0, timer = 0, scale = 0, opened = 0, resizing = 0;

    function say(keys) {
      list.textContent = '';
      for (const key of keys) {
        const line = doc.createElement('li');
        line.textContent = WORDS[key];
        list.appendChild(line);
      }
    }

    function fit() {
      const ratio = root.devicePixelRatio || 1;
      const room = Math.max(64, stage.clientWidth - 20);   // the frame's 10 px each side
      const tall = Math.max(64, root.innerHeight * 0.6);
      const next = Math.max(1, Math.min(64, Math.floor(Math.min(room / image.width, tall / image.height) * ratio)));
      if (next !== scale) {
        scale = next;
        leds.width = image.width * scale;
        leds.height = image.height * scale;
      }
      // a picture bigger than the window shrinks whole so it is never squashed
      const shrink = Math.min(1, room / ((image.width * scale) / ratio), tall / ((image.height * scale) / ratio));
      board.style.width = ((image.width * scale) / ratio) * shrink + 'px';
      board.style.height = ((image.height * scale) / ratio) * shrink + 'px';
      board.style.setProperty('--led', (scale / ratio) * shrink + 'px');
    }

    function draw() {
      ring.hidden = !ringToggle.checked;
      if (image === null) return;
      let rgb = image.frames[frame].rgb;
      if (night.checked) rgb = nightTint(rgb, NIGHT_LEVEL);
      if (low.checked) rgb = lowBrightness(rgb);
      const w = image.width, h = image.height;
      leds.getContext('2d').putImageData(new ImageData(ledLook(rgb, w, h, scale), w * scale, h * scale), 0, 0);
      const flat = new Uint8ClampedArray(w * h * 4);
      for (let i = 0, k = 0; i < rgb.length; i += 3, k += 4) {
        flat[k] = rgb[i];
        flat[k + 1] = rgb[i + 1];
        flat[k + 2] = rgb[i + 2];
        flat[k + 3] = 255;
      }
      glow.getContext('2d').putImageData(new ImageData(flat, w, h), 0, 0);
    }

    function play() {
      clearTimeout(timer);
      if (image === null || image.frames.length < 2) return;
      const shown = image;
      const step = () => {
        if (image !== shown) return;
        frame = (frame + 1) % image.frames.length;
        draw();
        timer = setTimeout(step, Math.max(MIN_FRAME_MS, image.frames[frame].delay));
      };
      timer = setTimeout(step, Math.max(MIN_FRAME_MS, image.frames[frame].delay));
    }

    function show(next) {
      image = next;
      frame = 0;
      scale = 0;
      glow.width = image.width;
      glow.height = image.height;
      board.hidden = false;
      say(warnings(image));
      fit();
      draw();
      play();
    }

    function fail() {
      clearTimeout(timer);
      image = null;
      board.hidden = true;
      say(['unreadable']);
    }

    function open(file) {
      if (!file) return;
      const mine = ++opened;
      file.arrayBuffer().then((buffer) => decodeInPage(new Uint8Array(buffer))).then(
        (next) => { if (mine === opened) show(next); },
        () => { if (mine === opened) fail(); });
    }

    pick.addEventListener('change', () => open(pick.files[0]));
    doc.addEventListener('dragover', (event) => {
      event.preventDefault();
      drop.classList.add('is-over');
    });
    doc.addEventListener('dragleave', (event) => {
      if (event.relatedTarget === null) drop.classList.remove('is-over');
    });
    doc.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('is-over');
      open(event.dataTransfer.files[0]);
    });
    // night on the board always comes with the evening dimming, and the earlier choice returns after
    let picked = null;
    night.addEventListener('change', () => {
      if (night.checked) {
        if (picked === null) picked = low.checked ? low : high;
        low.checked = true;
      } else if (picked !== null) {
        picked.checked = true;
        picked = null;
      }
      low.disabled = high.disabled = night.checked;
    });
    for (const input of [night, low, high, ringToggle]) input.addEventListener('change', draw);
    root.addEventListener('resize', () => {
      cancelAnimationFrame(resizing);
      resizing = requestAnimationFrame(() => {
        if (image === null) return;
        fit();
        draw();
      });
    });
  }

  const api = { PANEL_W, PANEL_H, LOWEST_LIT, MIN_FRAME_MS, SHORTEST_GIF_MS, NIGHT_LEVEL, LOW_TABLE, WORDS, dotMask, ledLook, nightTint,
                lowBrightness, warnings, isPng, isGif, parsePng, pngRgba, pngImage, decodeGif, decode };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mooboardPreviewer = api;
  if (typeof document !== 'undefined' && document.getElementById('pick') !== null) start(document);
})(typeof window !== 'undefined' ? window : this);
