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
    layerFit: 'Layer {number} is too long for the screen with {words}',
    packageBad: 'Not a mooboard package',
    icon: 'icon.png must be a 32×32 PNG of up to 8 KB',
    image: '{name} must be a PNG of up to 128×32 and 8 KB',
    gifUnreadable: 'Can’t read {name}',
    bytes: 'app.gif is over 256 KB',
    frames: 'More than 100 frames',
    noCheck: 'This browser can’t check the pictures in a .mooboard file',
    textLength: 'Must be 1 to {max} characters',
    textHidden: 'Must not hold hidden characters',
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

  // the bytes a png's rows take in every pass + a stream that inflates past them is refused before it decodes
  function pngRows(info) {
    const bits = info.channels * info.depth;
    let total = 0;
    for (const pass of info.interlace === 1 ? ADAM7 : [[0, 0, 1, 1]]) {
      const pw = Math.ceil((info.width - pass[0]) / pass[2]), ph = Math.ceil((info.height - pass[1]) / pass[3]);
      if (pw > 0 && ph > 0) total += ph * (1 + Math.ceil((pw * bits) / 8));
    }
    return total;
  }

  // a png's rows inflated by `inflate` up to one byte past them + refused when there is more + inflate is called as
  // the composer's is with its zlib bytes, no format and the most it need give
  function pngRaw(info, inflate) {
    const rows = pngRows(info);
    return inflate(info.idat, undefined, rows).then((raw) => {
      if (raw.length > rows) throw new Error('png inflates past its rows');
      return raw;
    });
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
      return pngRaw(info, inflate).then((raw) => pngImage(info, raw));
    });
  }

  // ---- an app file ----

  const ZIP_LOCAL = 0x04034b50, ZIP_CENTRAL = 0x02014b50, ZIP_END = 0x06054b50;
  const MAX_PACKAGE = 8 * 1024 * 1024;   // the biggest package any board takes

  function uint32Le(b, p) {
    return b[p] + (b[p + 1] << 8) + (b[p + 2] << 16) + b[p + 3] * 16777216;
  }

  function uint16Le(b, p) {
    return b[p] | (b[p + 1] << 8);
  }

  function isZip(b) {
    return b.length >= 4 && uint32Le(b, 0) === ZIP_LOCAL;
  }

  const KIT_CAP = 352 * 1024;               // a gif app's package
  const KIT_ENTRIES = 11;
  const STORE_ENTRIES = 202;
  const DATA_CAP = 512 * 1024;              // a store app's data entry
  const FILE_CAP = 8 * 1024;                // the manifest and the icon
  // the store's renderers in the board's order + a store app names one the firmware draws
  const RENDERERS = ['prayer', 'countdown', 'sketch', 'life', 'plasma', 'starfield', 'fireplace'];
  const FORMAT_2 = ['format', 'id', 'name', 'version', 'by', 'description', 'category', 'uses', 'minFirmware', 'boards'];
  const SEMVER = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(-(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

  // a package the board would refuse + its line is the build's own
  class Refusal extends Error {}

  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }

  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function kitName(name) {
    return ['mooboard.json', 'app.gif', 'icon.png'].includes(name) || /^images\/[a-z0-9-]{1,32}\.png$/.test(name);
  }

  // a data entry's path as the board takes it + three folders deep at most and never under local
  function dataName(name) {
    const found = /^data\/([A-Za-z0-9_-]{1,58}(?:\/[A-Za-z0-9_-]{1,58}){0,2})\.(?:json|bin)$/.exec(name);
    return found !== null && !/^local\//i.test(found[1]);
  }

  // a stored zip's entries by name in the order they sit as the board reads one + every header field the kit's writer
  // puts there and no byte between them
  function storedEntries(b, most) {
    const bad = () => new Refusal(WORDS.packageBad);
    if (b.length < 22) throw bad();
    const end = b.length - 22, at16 = (p) => uint16Le(b, p), at32 = (p) => uint32Le(b, p);
    const total = at16(end + 10), cdSize = at32(end + 12), cdAt = at32(end + 16);
    if (at32(end) !== ZIP_END || at16(end + 4) || at16(end + 6) || at16(end + 8) !== total || total > most || at16(end + 20) ||
        cdAt + cdSize !== end) throw bad();
    const files = new Map();
    let p = cdAt, expected = 0;
    for (let n = 0; n < total; n++) {
      const c = p;
      if (c + 46 > end || at32(c) !== ZIP_CENTRAL) throw bad();
      const head = [at16(c + 6), at16(c + 8), at16(c + 10), at16(c + 12), at16(c + 14), at32(c + 16), at32(c + 20), at32(c + 24)];
      const nameLength = at16(c + 28), offset = at32(c + 42), raw = b.subarray(c + 46, c + 46 + nameLength);
      p = c + 46 + nameLength;
      if (at16(c + 4) !== 0x314 || head[0] !== 10 || head[1] || head[2] || head[3] || head[4] !== 0x21 ||
          head[6] !== head[7] || at16(c + 30) || at16(c + 32) || at16(c + 34) || at16(c + 36) ||
          at32(c + 38) !== 0o100644 * 65536 || p > end) throw bad();
      const name = String.fromCharCode.apply(null, raw);
      if (!nameLength || nameLength > 128 || raw.some((c) => c >= 0x80) || !(kitName(name) || dataName(name)) ||
          files.has(name)) throw bad();
      if (offset !== expected || offset + 30 > cdAt || at32(offset) !== ZIP_LOCAL || at16(offset + 28)) throw bad();
      for (let k = 0; k < 8; k++) {
        if ((k < 5 ? at16(offset + 4 + 2 * k) : at32(offset + 14 + 4 * (k - 5))) !== head[k]) throw bad();
      }
      const localLength = at16(offset + 26), start = offset + 30 + localLength;
      if (start > cdAt || String.fromCharCode.apply(null, b.subarray(offset + 30, start)) !== name) throw bad();
      if (start + head[7] > cdAt) throw bad();
      const data = b.subarray(start, start + head[7]);
      if (crc32(data) !== head[5]) throw bad();
      expected = start + head[7];
      files.set(name, data);
    }
    if (p !== end || expected !== cdAt) throw bad();
    return files;
  }

  function iconOk(icon) {
    return icon !== undefined && icon.length >= 33 && icon.length <= FILE_CAP && isPng(icon) && uint32At(icon, 8) === 13 &&
      String.fromCharCode(icon[12], icon[13], icon[14], icon[15]) === 'IHDR' && uint32At(icon, 16) === 32 &&
      uint32At(icon, 20) === 32;
  }

  // a control, format, bidi, private use or noncharacter code point as the board's otherCategory flags it
  function hidden(cp) {
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
    if (cp === 0xad || (cp >= 0x600 && cp <= 0x605) || [0x61c, 0x6dd, 0x70f, 0x890, 0x891, 0x8e2, 0x180e].includes(cp) ||
        (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2064) ||
        (cp >= 0x2066 && cp <= 0x206f) || cp === 0xfeff || (cp >= 0xfff9 && cp <= 0xfffb) || cp === 0x110bd ||
        cp === 0x110cd || (cp >= 0x13430 && cp <= 0x1343f) || (cp >= 0x1bca0 && cp <= 0x1bca3) ||
        (cp >= 0x1d173 && cp <= 0x1d17a) || cp === 0xe0001 || (cp >= 0xe0020 && cp <= 0xe007f)) return true;
    if ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000) return true;
    return (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe;
  }

  // the white space the board takes as blank as python's isspace has it
  function space(cp) {
    return cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) || (cp >= 0x1c && cp <= 0x1f) || [0x85, 0xa0, 0x1680].includes(cp) ||
      (cp >= 0x2000 && cp <= 0x200a) || [0x2028, 0x2029, 0x202f, 0x205f, 0x3000].includes(cp);
  }

  // the text a store app's label takes as the board reads it + one line of plain characters and no link
  function plain(text, most) {
    if (typeof text !== 'string' || text.includes('://') || /[\ud800-\udfff]/.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) {
      return false;
    }
    const points = Array.from(text, (ch) => ch.codePointAt(0));
    return points.length >= 1 && points.length <= most && !points.some(hidden) && !points.every(space);
  }

  // a store app's manifest as the board takes one from the store + its keys in order and its bytes the writer's own
  function checkStore(manifest, bytes) {
    const bad = new Refusal(WORDS.packageBad);
    if (Object.keys(manifest).some((key) => !FORMAT_2.includes(key))) throw bad;
    const boards = manifest.boards === undefined ? ['s3', 'p4'] : manifest.boards;
    const good = manifest.format === 2 && typeof manifest.id === 'string' && /^[a-z0-9-]{1,32}$/.test(manifest.id) &&
      plain(manifest.name, 24) &&
      typeof manifest.version === 'string' && SEMVER.test(manifest.version) && plain(manifest.by, 32) &&
      plain(manifest.description, 160) && typeof manifest.category === 'string' &&
      /^[A-Z][A-Za-z]{0,23}$/.test(manifest.category) && RENDERERS.includes(manifest.uses) &&
      (manifest.minFirmware === undefined || (typeof manifest.minFirmware === 'string' && SEMVER.test(manifest.minFirmware))) &&
      Array.isArray(boards) && boards.length > 0 && boards.every((board, i) => ['s3', 'p4'].includes(board) &&
                                                                          (i === 0 || (boards[i - 1] === 's3' && board === 'p4')));
    if (!good) throw bad;
    const ordered = {};
    for (const key of FORMAT_2) if (key in manifest) ordered[key] = manifest[key];
    const want = new TextEncoder().encode(JSON.stringify(ordered, null, 2) + '\n');
    if (want.length !== bytes.length || want.some((v, i) => v !== bytes[i])) throw bad;
  }

  // ---- a gif app's pictures as the board checks them ----

  // the bytes a picture would be written as compared with the picture as it goes + no copy is made
  function sameAs(b) {
    let at = 0, same = true;
    return {
      put(bytes) {
        if (!same) return;
        if (at + bytes.length > b.length) {
          same = false;
          return;
        }
        for (let i = 0; i < bytes.length; i++) {
          if (bytes[i] !== b[at + i]) {
            same = false;
            return;
          }
        }
        at += bytes.length;
      },
      whole() { return same && at === b.length; },
    };
  }

  // where a run of sub-blocks ends after its zero + -1 when it runs off the end
  function blocksEnd(b, p) {
    for (;;) {
      if (p >= b.length) return -1;
      if (b[p] === 0) return p + 1;
      p += b[p] + 1;
    }
  }

  const take = (b, p, n) => Array.from({ length: n }, (_, i) => b[p + i]);
  const LOOP = [0xff, 0x0b, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 0x03, 0x01];

  // a gif that is only its header, its colors, its frames with one graphic control each, one loop block and its
  // trailer as the kit's strip leaves one + true for one it cannot read so the picture's own check says so
  function gifClean(b) {
    if (b.length < 13 || b[0] !== 71 || b[1] !== 73 || b[2] !== 70) return true;
    let p = 13 + (b[10] & 0x80 ? 3 * (2 << (b[10] & 7)) : 0), control = null, looped = false;
    const out = sameAs(b);
    out.put(take(b, 0, Math.min(p, b.length)));
    while (p < b.length) {
      const tag = b[p];
      let end;
      if (tag === 0x3b) {
        out.put([0x3b]);
        return out.whole();
      }
      if (tag === 0x21 && p + 1 < b.length) {
        end = blocksEnd(b, p + 2);
        if (end < 0) return true;
        if (b[p + 1] === 0xf9 && b[p + 2] >= 4) {
          control = take(b, p + 3, 4);
        } else if (p + 16 <= b.length && LOOP.every((v, i) => b[p + 1 + i] === v) && !looped) {
          out.put(take(b, p, 18));
          out.put([0]);
          looped = true;
        }
      } else if (tag === 0x2c && p + 10 < b.length) {
        const table = b[p + 9] & 0x80 ? 3 * (2 << (b[p + 9] & 7)) : 0;
        end = blocksEnd(b, p + 11 + table);
        if (end < 0) return true;
        if (control !== null) out.put([0x21, 0xf9, 0x04].concat(control, [0]));
        out.put(take(b, p, end - p));
        control = null;
      } else {
        return true;
      }
      p = end;
    }
    return true;
  }

  const CHUNKS = ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'];

  function chunkKind(b, p) {
    return String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
  }

  // a png that is only the chunks a decoder needs with nothing after its end + true for one it cannot read
  function pngClean(b) {
    if (!isPng(b)) return true;
    const out = sameAs(b);
    out.put(take(b, 0, 8));
    let p = 8;
    while (p + 12 <= b.length) {
      const end = p + 12 + uint32At(b, p), kind = chunkKind(b, p);
      if (end > b.length) break;
      if (CHUNKS.includes(kind)) out.put(take(b, p, end - p));
      if (kind === 'IEND') return out.whole();
      p = end;
    }
    return true;
  }

  // a png's chunks as the board reads them + its size or null + IHDR first and once, PLTE and tRNS once, every crc
  // right, an IDAT and an empty IEND
  function pngChunks(b) {
    if (!isPng(b)) return null;
    const once = new Set();
    let p = 8, width = 0, height = 0, idat = false;
    while (p + 12 <= b.length) {
      const length = uint32At(b, p), end = p + 8 + length, kind = chunkKind(b, p);
      if (end + 4 > b.length || uint32At(b, end) !== crc32(b.subarray(p + 4, end))) return null;
      if ((p === 8) !== (kind === 'IHDR')) return null;
      if (['IHDR', 'PLTE', 'tRNS'].includes(kind)) {
        if (once.has(kind)) return null;
        once.add(kind);
      }
      if (kind === 'IHDR') {
        if (length !== 13) return null;
        width = uint32At(b, p + 8);
        height = uint32At(b, p + 12);
      } else if (kind === 'IDAT') {
        idat = true;
      } else if (kind === 'IEND') {
        return length === 0 && idat ? { width: width, height: height } : null;
      }
      p = end + 4;
    }
    return null;
  }

  // app.gif read whole as the board reads it + every frame inside the screen and all its pixels there, its blocks
  // ended and the trailer there + the kit's line or null and the frames it has
  function gifRefusal(b) {
    const unreadable = WORDS.gifUnreadable.replace('{name}', 'app.gif');
    if (b.length < 13 || b[0] !== 71 || b[1] !== 73 || b[2] !== 70) return { line: unreadable };
    if ((b[6] | (b[7] << 8)) !== PANEL_W || (b[8] | (b[9] << 8)) !== PANEL_H) return { line: WORDS.size };
    if (b[3] !== 56 || (b[4] !== 55 && b[4] !== 57) || b[5] !== 97) return { line: unreadable };
    let p = 13, global = false, count = 0, ended = false;
    if (b[10] & 0x80) {
      global = true;
      p += 3 * (2 << (b[10] & 7));
    }
    while (p < b.length) {
      const tag = b[p++];
      if (tag === 0x3b) {
        ended = true;
        break;
      }
      if (tag === 0x21) {
        if (p >= b.length) break;
        p = subBlocks(b, p + 1).end;
        continue;
      }
      if (tag !== 0x2c) return { line: unreadable };
      if (p + 10 > b.length) break;
      const fx = b[p] | (b[p + 1] << 8), fy = b[p + 2] | (b[p + 3] << 8), fw = b[p + 4] | (b[p + 5] << 8);
      const fh = b[p + 6] | (b[p + 7] << 8), flags = b[p + 8];
      p += 9;
      if (flags & 0x80) p += 3 * (2 << (flags & 7));
      else if (!global) return { line: unreadable };
      const minSize = p < b.length ? b[p] : 0;
      p++;
      if (minSize < 2 || minSize > 11 || fx + fw > PANEL_W || fy + fh > PANEL_H) return { line: unreadable };
      const end = blocksEnd(b, p);
      if (end < 0) return { line: unreadable };
      if (count >= 100) return { line: WORDS.frames };
      if (lzw(subBlocks(b, p).data, minSize, fw * fh).length < fw * fh) return { line: unreadable };
      p = end;
      count++;
    }
    if (!ended || count === 0) return { line: unreadable };
    if (b.length > 256 * 1024) return { line: WORDS.bytes };
    const image = decodeGif(b), found = warnings(image);
    if (found.includes('fast')) return { line: WORDS.fast };
    if (found.includes('edge')) return { line: WORDS.edge };
    return { line: null, frames: count };
  }

  // a gif app's pictures as the board checks them before anything is shown + the build's line or null
  function pictureRefusal(gif, icon, images, manifest) {
    if (!gifClean(gif) || !pngClean(icon) || Array.from(images.values()).some((png) => !pngClean(png))) {
      return WORDS.packageBad;
    }
    const picture = gifRefusal(gif);
    if (picture.line) return picture.line;
    if (picture.frames !== manifest.frames) return WORDS.packageBad;
    const size = pngChunks(icon);
    if (icon.length > FILE_CAP || size === null || size.width !== ICON || size.height !== ICON) return WORDS.icon;
    for (const [name, png] of images) {
      const box = pngChunks(png);
      if (png.length > FILE_CAP || box === null || box.width < 1 || box.height < 1 || box.width > PANEL_W ||
          box.height > PANEL_H) return WORDS.image.replace('{name}', name);
    }
    return null;
  }

  // a .mooboard as the board reads it + its manifest's name and format and its icon and the picture a gif app shows +
  // a store app has none since the board draws it + a gif app's manifest rules wait for the kit's helper
  function readPackage(b) {
    const bad = () => new Refusal(WORDS.packageBad);
    if (b.length > MAX_PACKAGE) throw bad();
    const files = storedEntries(b, STORE_ENTRIES), names = Array.from(files.keys());
    const json = files.get('mooboard.json'), icon = files.get('icon.png'), gif = files.get('app.gif');
    if (!json || json.length > FILE_CAP) throw bad();
    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
    } catch (error) {
      throw bad();
    }
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw bad();
    const store = 'format' in manifest;
    const images = new Map();
    if (store) {
      const data = names.slice(2);
      if (names[0] !== 'mooboard.json' || names[1] !== 'icon.png' || data.some((n, i) => !dataName(n) ||
          (i > 0 && !(data[i - 1] < n)) || data.slice(0, i).some((m) => m.toLowerCase() === n.toLowerCase()) ||
          files.get(n).length > DATA_CAP)) throw bad();
      checkStore(manifest, json);
      if ((manifest.uses === 'prayer') !== (data.length > 0) || (data.length && !data.includes('data/pack.json'))) {
        throw bad();
      }
    } else {
      const pictures = names.slice(3);
      if (b.length > KIT_CAP || names.length > KIT_ENTRIES || names[0] !== 'mooboard.json' || names[1] !== 'app.gif' ||
          names[2] !== 'icon.png' || pictures.some((n, i) => !n.startsWith('images/') || (i > 0 && !(pictures[i - 1] < n)))) {
        throw bad();
      }
      for (const n of pictures) images.set(n, files.get(n));
      const line = pictureRefusal(gif, icon, images, manifest);
      if (line) throw new Refusal(line);
    }
    if (!iconOk(icon)) throw new Refusal(WORDS.icon);
    const name = typeof manifest.name === 'string' ? manifest.name : '';
    return { format: store ? 2 : 1, name: name, icon: icon, gif: store ? null : gif, manifest: manifest, bytes: json,
             images: images };
  }

  // a gif app's manifest as the board takes it + the kit's own rules from its helper with the writer's exact bytes and
  // every picture used + the line the build says or null
  function kitRefusal(helper, kit, app) {
    try {
      helper.checkManifest(app.manifest, { kit: kit, built: true, images: new Set(app.files.keys()) });
    } catch (error) {
      if (error instanceof helper.Refused) return error.line || error.message;
      return WORDS.packageBad;
    }
    const want = helper.manifestBytes(app.manifest), used = new Set((app.manifest.layers || []).map((l) => l.src));
    if (want.length !== app.bytes.length || want.some((v, i) => v !== app.bytes[i])) return WORDS.packageBad;
    if (Array.from(app.files.keys()).some((n) => !used.has(n))) return WORDS.packageBad;
    // the layers over every frame at the defaults and with each setting changed alone keep the ring dark
    if ((app.manifest.layers || []).some((l) => l.type === 'image')) {
      const frames = app.frames.map((f) => [f.rgb, f.delay]);
      for (const variant of helper.variants(app.manifest, kit)) {
        const drawn = helper.composeLayers(frames, app.manifest, app.images, variant.values, kit);
        if (drawn.some(([rgb]) => helper.ringLit(rgb))) return WORDS.edge;
      }
    }
    return null;
  }

  // ---- an app's settings and the frames they draw ----

  // the fonts the kit has + a text layer names one of these or the board refuses it
  const FONTS = ['nunito', 'outfit', 'inter', 'figtree', 'albert-sans'];

  // a gif app's settings as its manifest lists them + a store app keeps its own on the board
  function settingsList(manifest) {
    return manifest && manifest.mooboard === 1 && Array.isArray(manifest.settings) ? manifest.settings : [];
  }

  function defaultValues(manifest) {
    const out = {};
    for (const s of settingsList(manifest)) out[s.key] = s.default;
    return out;
  }

  function textLayers(manifest) {
    return (manifest && Array.isArray(manifest.layers) ? manifest.layers : []).filter((l) => l && l.type === 'text');
  }

  // the kit's fonts a manifest's text layers draw with + never a name outside the kit's list
  function fontsUsed(manifest) {
    return Array.from(new Set(textLayers(manifest).map((l) => l.font || 'nunito'))).filter((f) => FONTS.includes(f));
  }

  // the words a text layer shows at these values
  function layerWords(layer, values) {
    return layer.text.replace(/\{([^{}]*)\}/g, (found, key) => String(values[key]));
  }

  // the first text layer naming this setting that fits at no size with these values + its line as the build says it
  // or null + a board refuses to save such words
  function tooLong(helper, kit, manifest, values, key) {
    const layers = manifest.layers || [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer || layer.type !== 'text' || !layer.text.includes('{' + key + '}')) continue;
      const words = layerWords(layer, values);
      try {
        new helper.Screen(kit).place({ words: words, x: layer.x, y: layer.y, size: layer.size, font: layer.font,
                                       align: layer.align });
      } catch (error) {
        if (!(error instanceof helper.TooLong)) throw error;
        return WORDS.layerFit.replace('{number}', String(i + 1)).replace('{words}', words);
      }
    }
    return null;
  }

  // the app's frames with its layers drawn over them at these values as the board draws them + by the kit's helper
  function appFrames(helper, kit, app, values) {
    if (!(app.manifest.layers || []).length) return app.frames;
    return helper.composeLayers(app.frames.map((f) => [f.rgb, f.delay]), app.manifest, app.images, values, kit)
      .map(([rgb, ms]) => ({ rgb: rgb, delay: ms }));
  }

  // ---- home as the board's web app shows it ----

  // the web app's palette and home icons + each 12 by 12 in two frames at rest and in its idle move + kept equal to
  // the board's own by the kit's tests
  const ICON_PAL = {
    t: [119, 237, 215], w: [255, 255, 255], m: [255, 184, 28], p: [255, 46, 136], c: [245, 233, 214],
    o: [255, 122, 33], g: [120, 130, 140], d: [60, 64, 72], k: [255, 183, 201], b: [60, 170, 255], n: [150, 82, 36],
    l: [205, 210, 215],
  };
  const BLANK = '............';
  const ICONS = {
    system: [['............', '...gg..gg...', '...gggggg...', '.gggggggggg.', '.gggg..gggg.', '..gg....gg..', '..gg....gg..', '.gggg..gggg.', '.gggggggggg.', '...gggggg...', '...gg..gg...', '............'],
      ['............', '...gg..gg...', '...gggggg...', '.gggggggggg.', '.gggg..gggg.', '..gg.tt.gg..', '..gg.tt.gg..', '.gggg..gggg.', '.gggggggggg.', '...gggggg...', '...gg..gg...', '............']],
    media: [['............', '......t.....', '......tt....', '......ttt...', '......t.tt..', '......t..t..', '......t..t..', '......t.....', '...tttt.....', '..ttttt.....', '..tttt......', '............'],
      ['......t.....', '......tt....', '......ttt...', '......t.tt..', '......t..t..', '......t..t..', '......t.....', '...tttt.....', '..ttttt.....', '..tttt......', '............', '............']],
    calendar: [['............', '...w....w...', '.pppppppppp.', '.pppppppppp.', '.wwwwwwwwww.', '.w..g..g..w.', '.w..g..g..w.', '.wggggggggw.', '.w..gttg..w.', '.w..gttg..w.', '.wwwwwwwwww.', '............'],
      ['............', '...w....w...', '.pppppppppp.', '.pppppppppp.', '.wwwwwwwwww.', '.w..g..g..w.', '.w..g..g..w.', '.wggggggggw.', '.w..g..gttw.', '.w..g..gttw.', '.wwwwwwwwww.', '............']],
    lights: [['............', '....cccc....', '...c....c...', '..c......c..', '..c......c..', '..c......c..', '...c....c...', '....c..c....', '....gggg....', '....gggg....', '.....gg.....', '............'],
      ['............', '.m..mmmm..m.', '...mmmmmm...', '..mmmmmmmm..', 'm.mmmmmmmm.m', '..mmmmmmmm..', '...mmmmmm...', '.m..mmmm..m.', '....gggg....', '....gggg....', '.....gg.....', '............']],
    sports: [['............', '............', '............', '...nnnnnn...', '..nnwnnwnn..', '.nnwwwwwwnn.', '.nnnwnnwnnn.', '..nnnnnnnn..', '...nnnnnn...', '............', '............', '............'],
      ['............', '...nnnnnn...', '..nnwnnwnn..', '.nnwwwwwwnn.', '.nnnwnnwnnn.', '..nnnnnnnn..', '...nnnnnn...', '............', '............', '............', '...dddddd...', '............']],
    behavior: [[BLANK, BLANK, BLANK, '..dddddddd..', '.ddwwdddddd.', '.dwwwwddddd.', '.dwwwwddddd.', '.ddwwdddddd.', '..dddddddd..', BLANK, BLANK, BLANK],
      [BLANK, BLANK, BLANK, '..tttttttt..', '.ttttttwwtt.', '.tttttwwwwt.', '.tttttwwwwt.', '.ttttttwwtt.', '..tttttttt..', BLANK, BLANK, BLANK]],
    messages: [[BLANK, BLANK, '..tttttttt..', '.tttttttttt.', '.twwtwwtwwt.', '.twwtwwtwwt.', '.tttttttttt.',
      '..tttttttt..', '..ttt.......', '..t.........', BLANK, BLANK],
      [BLANK, BLANK, '..tttttttt..', '.tttttttttt.', '.twwtddtddt.', '.twwtddtddt.', '.tttttttttt.',
      '..tttttttt..', '..ttt.......', '..t.........', BLANK, BLANK]],
  };
  // the clock icon's ring about cell 5 5 and its hands along the four clean directions of the first quarter
  const CLOCK_FACE = ['....www.....', '..ww...ww...', '.w.......w..', '.w.......w..', 'w.........w.', 'w.........w.',
                      'w.........w.', '.w.......w..', '.w.......w..', '..ww...ww...', '....www.....', '............'];
  const CLOCK_HANDS = {
    minute: [[[0, -1], [0, -2], [0, -3]], [[0, -1], [1, -2], [1, -3]], [[1, -1], [2, -2]], [[1, 0], [2, -1], [3, -1]]],
    hour: [[[0, -1], [0, -2]], [[0, -1], [1, -2]], [[1, -1]], [[1, 0], [2, -1]]],
  };
  const CLOCK_ANGLES = [0, 26.57, 45, 63.43];
  // home's built in apps in the board's first order + tv shows only while something feeds it
  const HOME_APPS = ['media', 'calendar', 'sports', 'lights', 'clock', 'behavior', 'system', 'messages'];
  const HOME_NAMES = {
    media: 'Media', calendar: 'Calendar', sports: 'Sports',
    lights: 'Lights', clock: 'Clock', behavior: 'Behavior',
    system: 'System', messages: 'Messages',
  };
  const ICON = 32;            // an app's own icon is 32 by 32
  const ICON_SCALE = 8;       // the web app paints a home icon 8 pixels an led

  // a hand at this many degrees clockwise from 12 snapped to the nearest of the 16 clean directions
  function handCells(hand, degrees) {
    let best = 0, bestOff = 360;
    for (let i = 0; i < 16; i++) {
      const off = Math.abs((degrees - Math.floor(i / 4) * 90 - CLOCK_ANGLES[i % 4] + 540) % 360 - 180);
      if (off < bestOff) {
        best = i;
        bestOff = off;
      }
    }
    let cells = hand[best % 4];
    for (let turn = 0; turn < Math.floor(best / 4); turn++) cells = cells.map((cell) => [-cell[1], cell[0]]);
    return cells;
  }

  // the clock icon at this date with its hub led in this color
  function clockIcon(date, hub) {
    const rows = CLOCK_FACE.map((row) => row.split(''));
    const minutes = date.getMinutes();
    handCells(CLOCK_HANDS.minute, minutes * 6)
      .concat(handCells(CLOCK_HANDS.hour, (date.getHours() % 12) * 30 + minutes / 2))
      .forEach((cell) => { rows[5 + cell[1]][5 + cell[0]] = 't'; });
    rows[5][5] = hub;
    return rows.map((row) => row.join(''));
  }

  // both frames of a home icon + the clock's from this date
  function homeIcon(key, date) {
    return key === 'clock' ? [clockIcon(date, 'w'), clockIcon(date, 't')] : ICONS[key];
  }

  // rows of palette letters as a picture + a dot is off
  function iconPicture(rows) {
    const w = rows[0].length, h = rows.length, rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = ICON_PAL[rows[y].charAt(x)];
        if (c) rgb.set(c, (y * w + x) * 3);
      }
    }
    return { width: w, height: h, rgb: rgb };
  }

  // the 32 by 32 square round the first frame's lit leds as the kit's build picks an app's icon when it has none
  function defaultIcon(image) {
    const w = image.width, h = image.height, rgb = image.frames[0].rgb;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!litAt(rgb, w, h, x, y)) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    const cx = x1 < 0 ? w >> 1 : (x0 + x1 + 1) >> 1, cy = y1 < 0 ? h >> 1 : (y0 + y1 + 1) >> 1;
    const left = Math.min(Math.max(cx - ICON / 2, 0), Math.max(0, w - ICON));
    const top = Math.min(Math.max(cy - ICON / 2, 0), Math.max(0, h - ICON));
    const out = new Uint8Array(ICON * ICON * 3);
    for (let y = 0; y < ICON && top + y < h; y++) {
      for (let x = 0; x < ICON && left + x < w; x++) {
        const s = ((top + y) * w + left + x) * 3;
        out.set(rgb.subarray(s, s + 3), (y * ICON + x) * 3);
      }
    }
    return { width: ICON, height: ICON, rgb: out };
  }

  // ---- the page ----

  // zlib bytes inflated by the browser + it stops a byte past `limit` when one is given so nothing inflates far
  function browserInflate(data, format, limit) {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const parts = [];
    let size = 0;
    const next = () => reader.read().then(({ done, value }) => {
      if (done) return null;
      parts.push(value);
      size += value.length;
      if (limit !== undefined && size > limit) return reader.cancel().catch(() => {});
      return next();
    });
    return next().then(() => {
      const out = new Uint8Array(limit === undefined ? size : Math.min(size, limit + 1));
      let at = 0;
      for (const part of parts) {
        const piece = part.subarray(0, out.length - at);
        out.set(piece, at);
        at += piece.length;
        if (at === out.length) break;
      }
      return out;
    });
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

  // what a dropped file shows on the board and its tile on home + a picture's tile is named after the file + a store
  // app's sits in the apps row with no picture
  function readFile(bytes, fileName) {
    if (!isZip(bytes)) {
      return decodeInPage(bytes).then((image) => ({
        image: image, tile: { name: fileName.replace(/\.[^.]*$/, '') || fileName, icon: defaultIcon(image), store: false },
      }));
    }
    // a browser with no inflater of its own cannot hold a package's pictures to the board's rules so it gives no tile
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Refusal(WORDS.noCheck));
    // a picture that will not decode or inflates past its rows gets the build's own line for it
    const refuse = (line) => () => { throw new Refusal(line); };
    return Promise.resolve().then(() => readPackage(bytes)).then((app) => Promise.all([
      decodeInPage(app.icon).catch(refuse(WORDS.icon)), app.gif ? decodeInPage(app.gif) : null,
      Promise.all(Array.from(app.images, ([src, data]) => decodeRgba(data).then((picture) => [src, picture],
                                                                              refuse(WORDS.image.replace('{name}', src))))),
    ]).then(([icon, image, pictures]) => {
      if (icon.width !== ICON || icon.height !== ICON) throw new Error('not an icon');
      const tile = { name: app.name, icon: { width: ICON, height: ICON, rgb: icon.frames[0].rgb }, store: app.format === 2 };
      const made = image && { manifest: app.manifest, bytes: app.bytes, files: app.images, frames: image.frames,
                              images: Object.fromEntries(pictures), values: defaultValues(app.manifest), drawn: new Map() };
      return { image: image, tile: tile, app: made };
    }));
  }

  // a layer's picture with its own alpha as the board draws it over the frames
  function decodeRgba(bytes) {
    return Promise.resolve().then(() => {
      const info = parsePng(bytes);
      return pngRaw(info, browserInflate).then((raw) => pngRgba(info, raw));
    });
  }

  // each led a round dot with its glow as the web app paints its home icons
  function paintDots(canvas, picture, size) {
    canvas.width = picture.width * size;
    canvas.height = picture.height * size;
    const context = canvas.getContext('2d'), r = size * 0.4, rgb = picture.rgb;
    for (let y = 0; y < picture.height; y++) {
      for (let x = 0; x < picture.width; x++) {
        const k = (y * picture.width + x) * 3, lit = rgb[k] + rgb[k + 1] + rgb[k + 2] > 0;
        context.fillStyle = lit ? 'rgb(' + rgb[k] + ',' + rgb[k + 1] + ',' + rgb[k + 2] + ')' : '#1b1920';
        context.beginPath();
        context.arc((x + 0.5) * size, (y + 0.5) * size, r, 0, 6.2832);
        context.fill();
        if (!lit) continue;
        context.globalAlpha = 0.28;
        context.beginPath();
        context.arc((x + 0.5) * size, (y + 0.5) * size, r * 1.9, 0, 6.2832);
        context.fill();
        context.globalAlpha = 1;
      }
    }
  }

  // an app's own 32 by 32 icon one pixel an led as the web app shows a store app's
  function paintIconPixels(canvas, picture) {
    canvas.width = picture.width;
    canvas.height = picture.height;
    const flat = new Uint8ClampedArray(picture.width * picture.height * 4);
    for (let i = 0, k = 0; i < picture.rgb.length; i += 3, k += 4) {
      flat.set(picture.rgb.subarray(i, i + 3), k);
      flat[k + 3] = 255;
    }
    canvas.getContext('2d').putImageData(new ImageData(flat, picture.width, picture.height), 0, 0);
  }

  function start(doc) {
    const byId = (id) => doc.getElementById(id);
    const pick = byId('pick'), drop = byId('drop'), stage = byId('stage'), board = byId('board');
    const leds = byId('leds'), glow = byId('glow'), ring = byId('ring'), list = byId('warnings');
    const night = byId('night'), low = byId('low'), high = byId('high'), ringToggle = byId('ringToggle');
    const home = byId('home'), grid = byId('apps'), storeApps = byId('storeApps'), devRow = byId('devRow');
    const devApps = byId('devApps'), page = byId('appPage'), title = byId('appTitle'), back = byId('back');
    const toggles = doc.querySelector('.toggles');
    const devCard = byId('devCard'), storeCard = byId('storeCard'), storeTitle = byId('storeTitle');
    const saveRow = byId('saveRow'), fields = byId('settingsFields');
    const scripts = new Map(), atlases = new Map();
    let image = null, frame = 0, timer = 0, scale = 0, opened = 0, resizing = 0, clockTimer = 0;
    let app = null, tile = null, tools = null;

    function cell(name, box, tag) {
      const out = doc.createElement('div'), icon = doc.createElement(tag || 'span'), label = doc.createElement('span');
      out.className = 'app-cell';
      icon.className = 'app-icon';
      label.className = 'app-icon__name';
      label.textContent = name;
      box.className = 'app-icon__box';
      icon.append(box, label);
      out.appendChild(icon);
      return out;
    }

    // home's grid of built in apps with the board's own icons in their two frames
    function buildGrid() {
      for (const key of HOME_APPS) {
        const box = doc.createElement('span'), led = doc.createElement('span');
        led.className = 'app-icon__led';
        led.append(doc.createElement('canvas'), doc.createElement('canvas'));
        box.appendChild(led);
        const made = cell(HOME_NAMES[key], box);
        made.dataset.key = key;
        grid.appendChild(made);
      }
      tickClock();
    }

    function paintGrid() {
      const now = new Date();
      for (const made of grid.children) {
        homeIcon(made.dataset.key, now).forEach((rows, i) => {
          paintDots(made.querySelectorAll('canvas')[i], iconPicture(rows), ICON_SCALE);
        });
      }
    }

    // the clock icon shows the time here and turns with the minute as the web app's does
    function tickClock() {
      clearTimeout(clockTimer);
      paintGrid();
      clockTimer = setTimeout(tickClock, 60000 - Date.now() % 60000 + 20);
    }

    // the dropped app's tile in its row + a gif app in developer apps and a store app before add + a tap opens its page
    function showTile(next) {
      tile = next;
      for (const old of home.querySelectorAll('[data-app]')) old.remove();
      const box = doc.createElement('span'), canvas = doc.createElement('canvas');
      canvas.className = 'app-icon__img';
      paintIconPixels(canvas, tile.icon);
      box.appendChild(canvas);
      const made = cell(tile.name, box, 'button');
      made.dataset.app = tile.store ? 'store' : 'developer';
      made.firstChild.type = 'button';
      made.firstChild.addEventListener('click', openPage);
      if (tile.store) storeApps.insertBefore(made, storeApps.lastElementChild);
      else devApps.appendChild(made);
      devRow.hidden = tile.store;
      page.hidden = true;
      home.hidden = false;
    }

    // ---- the app's page ----

    function loadScript(src) {
      if (!scripts.has(src)) {
        scripts.set(src, new Promise((resolve, reject) => {
          const tag = doc.createElement('script');
          tag.src = src;
          tag.onload = resolve;
          tag.onerror = reject;
          doc.head.appendChild(tag);
        }));
      }
      return scripts.get(src);
    }

    // the composer's helper and fonts that draw an app's layers + the kit's own files beside this page
    function loadTools(manifest) {
      const fonts = fontsUsed(manifest);
      return Promise.all(['../composer/helper.js'].concat(
        fonts.map((font) => '../composer/fonts/' + font + '.js')).map(loadScript)).then(() => ({
        helper: root.mooboardHelper,
        kit: {
          atlas(font, size) {
            const key = font + '-' + size;
            if (!atlases.has(key)) atlases.set(key, new root.mooboardHelper.Atlas(root['mooboardFonts_' + font.replace(/-/g, '_')][size]));
            return atlases.get(key);
          },
          sprite() { return null; },
        },
      }));
    }

    // the frames the board shows at the app's values + each set drawn once
    function drawnFrames() {
      const key = JSON.stringify(settingsList(app.manifest).map((s) => app.values[s.key]));
      if (!app.drawn.has(key)) app.drawn.set(key, appFrames(tools.helper, tools.kit, app, app.values));
      return app.drawn.get(key);
    }

    function showFrames() {
      setImage({ width: PANEL_W, height: PANEL_H, frames: drawnFrames() });
    }

    // a setting changed on the page + the board above shows that set of values as the board would
    function change(key, value) {
      app.values = Object.assign({}, app.values, { [key]: value });
      if (tools) showFrames();
    }

    function make(tag, props, kids) {
      const out = doc.createElement(tag);
      for (const [key, value] of Object.entries(props || {})) {
        if (key === 'text') out.textContent = value;
        else if (key in out && typeof value !== 'string') out[key] = value;
        else out.setAttribute(key, value);
      }
      for (const kid of kids || []) out.appendChild(kid);
      return out;
    }

    // one setting as the board's web app draws it + a text field with its max then inline a colour picker a switch or
    // a segmented choice each with its error line under it
    function settingField(s, i) {
      const id = 'setting-' + i, value = app.values[s.key];
      const err = make('p', { class: 'field__err', hidden: true });
      const label = make(s.type === 'choice' || s.type === 'toggle' ? 'span' : 'label',
                         { class: 'field__label', id: id + '-label', text: s.label });
      const field = make('div', { class: s.type === 'text' ? 'field' : 'field field--inline' }, [label]);
      let control;
      if (s.type === 'choice') {
        control = make('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': label.id }, s.options.map((option) => {
          const input = make('input', { type: 'radio', name: id, value: option, checked: option === value });
          input.addEventListener('change', () => change(s.key, option));
          return make('label', {}, [input, make('span', { text: option })]);
        }));
      } else if (s.type === 'toggle') {
        const input = make('input', { type: 'checkbox', id: id, role: 'switch', 'aria-labelledby': label.id, checked: value === true });
        input.addEventListener('change', () => change(s.key, input.checked));
        control = make('label', { class: 'switch' }, [input, make('span')]);
      } else {
        label.setAttribute('for', id);
        control = make('input', { type: s.type === 'color' ? 'color' : 'text', id: id, value: String(value) });
        if (s.type === 'color') {
          control.value = String(value).toLowerCase();
          control.addEventListener('input', () => change(s.key, control.value));
        } else {
          control.setAttribute('maxlength', String(s.max));
          control.setAttribute('autocomplete', 'off');
          // words the board would not save get its line and change nothing + 1 to max characters of plain text +
          // words that fit at no size are kept as the board keeps them with that layer undrawn and the build's line
          // as a note
          control.addEventListener('input', () => {
            const words = control.value, points = Array.from(words, (ch) => ch.codePointAt(0));
            const line = points.length < 1 || points.length > s.max ? WORDS.textLength.replace('{max}', String(s.max))
              : points.some(hidden) ? WORDS.textHidden : null;
            err.textContent = line || '';
            err.hidden = !line;
            control.setAttribute('aria-invalid', line ? 'true' : 'false');
            if (line) {
              note.hidden = true;
              return;
            }
            change(s.key, words);
            const fit = tools ? tooLong(tools.helper, tools.kit, app.manifest, app.values, s.key) : null;
            note.textContent = fit || '';
            note.hidden = !fit;
          });
        }
      }
      const note = make('p', { class: 'field__hint', hidden: true });
      field.append(control, err, note);
      return field;
    }

    // the app's page in home's place as the board's sheet + a gif app's settings with show in the rotation first and
    // save + a store app's name and switch + remove app under either
    function openPage() {
      title.textContent = tile.name;
      fields.textContent = '';
      const settings = app ? settingsList(app.manifest) : [];
      settings.forEach((s, i) => fields.appendChild(settingField(s, i)));
      devCard.hidden = tile.store;
      storeCard.hidden = !tile.store;
      storeTitle.textContent = tile.name;
      saveRow.hidden = settings.length === 0;
      home.hidden = true;
      page.hidden = false;
      back.focus();
    }

    function closePage() {
      page.hidden = true;
      home.hidden = false;
      const opener = home.querySelector('[data-app] button');
      if (opener) opener.focus();
    }

    function say(keys) {
      sayLines(keys.map((key) => WORDS[key]));
    }

    function sayLines(lines) {
      list.textContent = '';
      for (const words of lines) {
        const line = doc.createElement('li');
        line.textContent = words;
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

    function setImage(next) {
      clearTimeout(timer);
      image = next;
      board.hidden = image === null;
      toggles.hidden = image === null;
      if (image === null) {
        say([]);
        return;
      }
      frame = 0;
      scale = 0;
      glow.width = image.width;
      glow.height = image.height;
      say(warnings(image));
      fit();
      draw();
      play();
    }

    // a gif app with settings or layers shows at its defaults as the board draws it + its raw picture if the kit's
    // helper is not beside this page
    // a gif app shows at its defaults as the board draws it once the kit's helper finds the board would take it + a
    // package the board would refuse gets no tile and the build's line + without the helper beside this page its raw
    // picture shows
    function show(next) {
      app = next.app || null;
      tools = null;
      if (!app) {
        showTile(next.tile);
        return setImage(next.image);
      }
      const shown = app;
      return loadTools(app.manifest).then((loaded) => {
        if (app !== shown) return;
        const line = kitRefusal(loaded.helper, loaded.kit, app);
        if (line) return fail(line);
        tools = loaded;
        showTile(next.tile);
        return showFrames();
      }, () => {
        if (app !== shown) return;
        showTile(next.tile);
        setImage(next.image);
      });
    }

    function fail(line) {
      clearTimeout(timer);
      image = null;
      app = null;
      board.hidden = true;
      toggles.hidden = false;
      home.hidden = true;
      page.hidden = true;
      for (const old of home.querySelectorAll('[data-app]')) old.remove();
      sayLines([line || WORDS.unreadable]);
    }

    function open(file) {
      if (!file) return;
      const mine = ++opened;
      file.arrayBuffer().then((buffer) => readFile(new Uint8Array(buffer), file.name)).then(
        (next) => (mine === opened ? show(next) : null)).catch((error) => {
        if (mine === opened) fail(error instanceof Refusal ? error.message : null);
      });
    }

    back.addEventListener('click', closePage);

    buildGrid();

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
                lowBrightness, warnings, isPng, isGif, parsePng, pngRgba, pngImage, decodeGif, decode, isZip, storedEntries,
                readPackage, ICON_PAL, ICONS, CLOCK_FACE, CLOCK_HANDS, CLOCK_ANGLES, HOME_APPS, HOME_NAMES, clockIcon,
                homeIcon, iconPicture, defaultIcon, FONTS, settingsList, defaultValues, fontsUsed, layerWords, tooLong,
                appFrames, Refusal, RENDERERS, crc32, kitRefusal, paintDots, gifClean, pngClean, pngChunks, gifRefusal,
                pictureRefusal, pngRows, readFile };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mooboardPreviewer = api;
  if (typeof document !== 'undefined' && document.getElementById('pick') !== null) start(document);
})(typeof window !== 'undefined' ? window : this);
