
(function (root) {
  'use strict';

  const helper = root.mooboardHelper || require('./helper.js');

  const W = helper.W, H = helper.H, SAFE = helper.SAFE;
  const FRAME_MS = 1000;
  const SHORTEST_MS = 30;
  const PIXELS = 16;
  const OPEN_CAP = 4 * 1024 * 1024;
  const FILE_CAPS = { 'mooboard.json': 8 * 1024, 'app.py': 1024 * 1024 };
  const PICTURE_CAP = 64 * 1024;
  const SLICE = 4096;
  const GITHUB_USERS = 'https://api.github.com/users/';
  const GITHUB_WAIT_MS = 3000;

  const WORDS = {
    defaultName: 'My app',
    text: 'Text',
    sprite: 'Sprite',
    picture: 'Picture',
    box: 'Box',
    line: 'Line',
    pixels: 'Pixels',
    time: 'Time',
    ticker: 'Ticker',
    frame: 'Frame {number}',
    ms: 'ms',
    everyFrame: 'Every frame',
    words: 'Words',
    size: 'Size',
    fits: 'Fits at {size}',
    font: 'Font',
    color: 'Color',
    custom: 'Any color',
    align: 'Align',
    left: 'Left',
    center: 'Center',
    right: 'Right',
    x: 'X',
    y: 'Y',
    width: 'Width',
    height: 'Height',
    from: 'From',
    to: 'To',
    shows: 'Shows',
    date: 'Date',
    timeAndDate: 'Time and date',
    hours: 'Hours',
    hours12: '12 h',
    hours24: '24 h',
    timeNote: 'Shows the time the app is built. GitHub builds it in UTC.',
    paint: 'Paint',
    erase: 'Erase',
    show: 'Show',
    always: 'Always',
    setting: 'Setting',
    none: 'None',
    toggle: 'Toggle',
    choice: 'Choice',
    label: 'Label',
    default: 'Default',
    max: 'Max letters',
    options: 'Options',
    delete: 'Delete',
    play: 'Play',
    stop: 'Stop',
    pictureBig: 'A picture can be up to 128×32',
    hello: 'Hello',
    morning: 'Good morning from your mooboard',
    small: 'Small',
    large: 'Large',
    variant: '{label}: {value}',
    unreadable: 'Can’t read {name}',
    unreadableFile: 'Can’t read this file',
    authorMissing: 'GitHub username not found.',
  };



  function slug(text) {
    const base = String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
    return base.length >= 3 ? base : base ? base + '-app' : 'app';
  }

  function newApp() {
    return { name: WORDS.defaultName, id: slug(WORDS.defaultName), author: '', refresh: 3600, duration: 10, category: '',
             settings: [],
             layers: [], frames: [{ ms: FRAME_MS, elements: [] }], next: 0 };
  }


  const blank = (v) => v === null || v === undefined;
  const clampX = (v) => Math.min(W - 1, Math.max(0, Math.trunc(v)));
  const clampY = (v) => Math.min(H - 1, Math.max(0, Math.trunc(v)));

  function baseOf(size) {
    return Math.floor(H / 2) + Math.floor(size / 2);
  }


  function measure(kit, words, size, font) {
    if (!helper.SIZES.includes(size) || !helper.FONTS.includes(font)) return null;
    const face = kit.atlas(font, size);
    const box = helper.ink(face, helper.layout(face, words)[0]);
    return box === null ? null : { left: box[0], width: box[1] - box[0] + 1, top: box[2], bottom: box[3] };
  }

  function wordsOf(element, now, values) {
    if (element.type === 'time') return helper.clockWords(element.shows, element.hours, now || helper.clockNow());
    const known = (key) => Object.prototype.hasOwnProperty.call(values, key);
    return values ? element.words.replace(/\{([^{}]*)\}/g, (found, key) => (known(key) ? String(values[key]) : found))
      : element.words;
  }

  function makeElement(app, kind, options) {
    const kit = options.kit, at = options.at || null;
    let e;
    if (kind === 'text') {
      e = { type: 'text', words: WORDS.hello, x: null, y: null, size: 9, font: 'nunito', color: '#ffffff', align: 'left' };
    } else if (kind === 'time') {
      e = { type: 'time', shows: 'time', hours: 12, x: null, y: null, size: 13, font: 'nunito', color: '#ffffff',
            align: 'left' };
    } else if (kind === 'ticker') {
      e = { type: 'scroll', words: WORDS.morning, y: null, size: 9, font: 'nunito', color: '#ffffff' };
    } else if (kind === 'sprite') {
      const s = kit.sprite('cow-rest');
      e = { type: 'sprite', name: 'cow-rest', x: Math.floor((W - s.width) / 2), y: Math.floor((H - s.height) / 2) };
    } else if (kind === 'box') {
      e = { type: 'rect', x: (W - 16) / 2, y: (H - 8) / 2, w: 16, h: 8, color: '#77edd7' };
    } else if (kind === 'line') {
      e = { type: 'line', x0: W / 2 - 20, y0: H / 2, x1: W / 2 + 19, y1: H / 2, color: '#ffb81c' };
    } else if (kind === 'pixels' || kind === 'picture') {
      let id = options.image;
      if (kind === 'pixels') id = addImage(options.store, 'pixels', PIXELS, PIXELS, new Uint8Array(PIXELS * PIXELS * 4));
      const p = options.store.get(id);
      e = { type: 'image', image: id, x: Math.floor((W - p.width) / 2), y: Math.floor((H - p.height) / 2) };
    } else {
      throw new Error('no element ' + kind);
    }
    e.uid = 'e' + (++app.next);
    return at ? placeAt(e, at, kit, options.store) : e;
  }


  function placeAt(element, at, kit, store, now) {
    const e = element;
    if (e.type === 'line') {
      const half = Math.floor((e.x1 - e.x0) / 2);
      return Object.assign(e, { x0: clampX(at[0] - half), x1: clampX(at[0] - half + (e.x1 - e.x0)), y0: clampY(at[1]),
                                y1: clampY(at[1] + e.y1 - e.y0) });
    }
    if (e.type === 'text' || e.type === 'time' || e.type === 'scroll') {
      const m = measure(kit, wordsOf(e, now), e.size, e.font);
      const y = m ? at[1] - Math.floor((m.top + m.bottom) / 2) : at[1];
      if (e.type !== 'scroll') {
        e.align = 'left';
        e.x = clampX(m ? at[0] - Math.floor(m.width / 2) : at[0]);
      }
      e.y = clampY(y);
      return e;
    }
    const box = boxOf(e, kit, store);
    e.x = clampX(at[0] - Math.floor((box[1] - box[0] + 1) / 2));
    e.y = clampY(at[1] - Math.floor((box[3] - box[2] + 1) / 2));
    return e;
  }

  function insertElement(list, element) {
    if (element.type === 'scroll') return list.push(element) - 1;
    let at = list.findIndex((e) => e.type === 'scroll');
    if (at < 0) at = list.length;
    list.splice(at, 0, element);
    return at;
  }


  function moveElement(list, index, delta) {
    const to = index + delta;
    if (to < 0 || to >= list.length || (list[to].type === 'scroll') !== (list[index].type === 'scroll')) return -1;
    [list[index], list[to]] = [list[to], list[index]];
    return to;
  }

  function findElement(app, frame, uid) {
    for (const [list, layer] of [[app.layers, true], [app.frames[frame].elements, false]]) {
      const index = list.findIndex((e) => e.uid === uid);
      if (index >= 0) return { list: list, index: index, element: list[index], layer: layer };
    }
    return null;
  }

  function ledAt(x, y, rect) {
    return [clampX(Math.floor(((x - rect.left) * W) / rect.width)), clampY(Math.floor(((y - rect.top) * H) / rect.height))];
  }

  function keyStep(key, shift) {
    const s = shift ? 8 : 1;
    return { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[key] || null;
  }


  function placeText(element, kit, now, values) {
    const words = wordsOf(element, now, values);
    const args = { words: words, x: element.x, y: element.y, size: element.size, font: element.font, align: element.align };
    try {
      const placed = new helper.Screen(kit).place(args);
      if (placed.box !== null) return { size: placed.size, box: placed.box, pen: placed.pen, base: placed.base, fits: true };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    const m = measure(kit, words, element.size, element.font);
    const base = blank(element.y) ? baseOf(element.size) : element.y;
    if (m === null) {
      const x = blank(element.x) ? W / 2 : element.x;
      return { size: element.size, box: [x, x, base - 1, base], pen: x, base: base, fits: true };
    }
    let pen;
    if (blank(element.x)) pen = Math.floor((W - m.width) / 2) - m.left;
    else if (element.align === 'left') pen = element.x - m.left;
    else if (element.align === 'right') pen = element.x - (m.left + m.width - 1);
    else pen = element.x - Math.floor((2 * m.left + m.width - 1) / 2);
    return { size: element.size, box: [pen + m.left, pen + m.left + m.width - 1, base + m.top, base + m.bottom], pen: pen,
             base: base, fits: false };
  }

  function boxOf(element, kit, store, now, values) {
    const e = element;
    if (e.type === 'text' || e.type === 'time') return placeText(e, kit, now, values).box;
    if (e.type === 'scroll') {
      const m = measure(kit, e.words, e.size, e.font), base = blank(e.y) ? baseOf(e.size) : e.y;
      return m === null ? [SAFE[0], SAFE[2], base - 1, base] : [SAFE[0], SAFE[2], base + m.top, base + m.bottom];
    }
    if (e.type === 'line') return [Math.min(e.x0, e.x1), Math.max(e.x0, e.x1), Math.min(e.y0, e.y1), Math.max(e.y0, e.y1)];
    if (e.type === 'rect') return [e.x, e.x + Math.max(1, e.w) - 1, e.y, e.y + Math.max(1, e.h) - 1];
    const p = e.type === 'sprite' ? kit.sprite(e.name) : store.get(e.image);
    return p ? [e.x, e.x + p.width - 1, e.y, e.y + p.height - 1] : [e.x, e.x, e.y, e.y];
  }

  function movedBy(element, dx, dy, kit, store, now, values) {
    const e = Object.assign({}, element);
    if (e.type === 'line') {
      return Object.assign(e, { x0: clampX(e.x0 + dx), y0: clampY(e.y0 + dy), x1: clampX(e.x1 + dx), y1: clampY(e.y1 + dy) });
    }
    if (e.type === 'scroll') {
      e.y = clampY((blank(e.y) ? baseOf(e.size) : e.y) + dy);
      return e;
    }
    if ((e.type === 'text' || e.type === 'time') && (blank(e.x) || blank(e.y))) {
      const placed = placeText(e, kit, now, values);
      if (blank(e.x)) {
        e.x = e.align === 'left' ? placed.box[0] : e.align === 'right' ? placed.box[1]
          : Math.floor((placed.box[0] + placed.box[1]) / 2);
      }
      if (blank(e.y)) e.y = placed.base;
    }
    e.x = clampX(e.x + dx);
    e.y = clampY(e.y + dy);
    return e;
  }

  function settingValues(app) {
    const out = {};
    for (const s of app.settings) out[s.key] = s.default;
    return out;
  }

  function hitTest(app, frame, x, y, kit, store, now) {
    const values = settingValues(app);
    for (const list of [app.layers, app.frames[frame].elements]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const b = boxOf(list[i], kit, store, now, values);
        if (b[0] <= x && x <= b[1] && b[2] <= y && y <= b[3]) return list[i].uid;
      }
    }
    return null;
  }



  function addFrame(app, at) {
    if (app.frames.length >= helper.MAX_FRAMES) throw new Error(helper.WORDS.frames);
    app.frames.splice(at + 1, 0, { ms: FRAME_MS, elements: [] });
    return at + 1;
  }

  function copyFrame(app, at) {
    if (app.frames.length >= helper.MAX_FRAMES) throw new Error(helper.WORDS.frames);
    const from = app.frames[at];
    const elements = from.elements.map((e) => Object.assign({}, e, { uid: 'e' + (++app.next) }));
    app.frames.splice(at + 1, 0, { ms: from.ms, elements: elements });
    return at + 1;
  }

  function deleteFrame(app, at) {
    if (app.frames.length < 2) return -1;
    app.frames.splice(at, 1);
    return Math.min(at, app.frames.length - 1);
  }

  function moveFrame(app, at, delta) {
    const to = at + delta;
    if (to < 0 || to >= app.frames.length) return -1;
    [app.frames[at], app.frames[to]] = [app.frames[to], app.frames[at]];
    return to;
  }

  function timeOf(text) {
    const ms = Math.round(Number(text));
    return Number.isFinite(ms) ? Math.max(SHORTEST_MS, ms) : SHORTEST_MS;
  }



  class History {
    constructor(limit) {
      this.limit = limit || 200;
      this.undos = [];
      this.redos = [];
    }

    record(state) {
      this.undos.push(state);
      if (this.undos.length > this.limit) this.undos.shift();
      this.redos = [];
    }

    undo(current) {
      if (!this.undos.length) return null;
      this.redos.push(current);
      return this.undos.pop();
    }

    redo(current) {
      if (!this.redos.length) return null;
      this.undos.push(current);
      return this.redos.pop();
    }
  }



  function addImage(store, name, width, height, rgba) {
    const id = 'i' + (store.size + 1);
    store.set(id, { name: name, width: width, height: height, rgba: rgba });
    return id;
  }


  function cleared(rgba) {
    const out = Uint8Array.from(rgba);
    for (let i = 0; i < out.length; i += 4) if (out[i + 3] === 0) out.fill(0, i, i + 4);
    return out;
  }


  function paint(store, element, points, rgba) {
    const p = store.get(element.image), out = Uint8Array.from(p.rgba);
    for (const [x, y] of points) if (x >= 0 && y >= 0 && x < p.width && y < p.height) out.set(rgba, (y * p.width + x) * 4);
    element.image = addImage(store, p.name, p.width, p.height, cleared(out));
    return element;
  }

  function resized(store, element, width, height) {
    const p = store.get(element.image), out = new Uint8Array(width * height * 4);
    for (let y = 0; y < Math.min(height, p.height); y++) {
      out.set(p.rgba.subarray(y * p.width * 4, (y * p.width + Math.min(width, p.width)) * 4), y * width * 4);
    }
    element.image = addImage(store, p.name, width, height, out);
    return element;
  }



  function keyOf(label) {
    const base = String(label).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '').slice(0, 16).replace(/_+$/, '');
    return base || 'setting';
  }

  function freeKey(app, base, except) {
    const taken = new Set(app.settings.filter((s) => s !== except).map((s) => s.key));
    let key = base, n = 2;
    while (taken.has(key)) key = base.slice(0, 15 - String(n).length) + '_' + n++;
    return key;
  }

  function addSetting(app, type) {
    const label = { text: WORDS.text, color: WORDS.color, toggle: WORDS.toggle, choice: WORDS.choice }[type];
    const s = { key: freeKey(app, keyOf(label)), type: type, label: label };
    if (type === 'text') Object.assign(s, { default: WORDS.hello, max: 16 });
    else if (type === 'color') s.default = '#ffb7c9';
    else if (type === 'toggle') s.default = true;
    else Object.assign(s, { default: WORDS.large, options: [WORDS.small, WORDS.large] });
    app.settings.push(s);
    return s;
  }

  function settingOf(app, key) {
    return app.settings.find((s) => s.key === key) || null;
  }

  function showKey(show) {
    return show.split('=')[0];
  }

  function tied(app, e) {
    if (e.show !== undefined) return true;
    if (e.type !== 'text') return false;
    const keys = new Set(app.settings.map((s) => s.key));
    return Array.from(e.words.matchAll(/\{([^{}]*)\}/g)).some((m) => keys.has(m[1])) || /^\{[^{}]*\}$/.test(e.color);
  }


  function relocate(app, frame, found) {
    const wants = tied(app, found.element);
    if (wants === found.layer) return;
    found.list.splice(found.index, 1);
    if (wants) app.layers.push(found.element);
    else insertElement(app.frames[frame].elements, found.element);
  }

  function untieWords(app, e, key) {
    const s = settingOf(app, key);
    e.words = e.words.split('{' + key + '}').join(s ? String(s.default) : '');
  }

  function bind(app, frame, uid, change) {
    const found = findElement(app, frame, uid), e = found.element;
    if ('words' in change) {
      for (const m of Array.from(e.words.matchAll(/\{([^{}]*)\}/g))) if (settingOf(app, m[1])) untieWords(app, e, m[1]);
      const s = change.words ? settingOf(app, change.words) : null;
      if (s) {
        if (s.type === 'text') {
          const words = Array.from(e.words).slice(0, 32).join('');
          if (words) s.default = words;
          s.max = Math.max(s.max, Array.from(s.default).length);
        }
        e.words = '{' + s.key + '}';
      }
    }
    if ('color' in change) {
      const was = /^\{([^{}]*)\}$/.exec(e.color), old = was ? settingOf(app, was[1]) : null;
      if (old) e.color = old.default;
      const s = change.color ? settingOf(app, change.color) : null;
      if (s) {
        if (/^#[0-9a-fA-F]{6}$/.test(e.color)) s.default = e.color.toLowerCase();
        e.color = '{' + s.key + '}';
      }
    }
    if ('show' in change) {
      if (change.show) e.show = change.show;
      else delete e.show;
    }
    relocate(app, frame, found);
    return e;
  }

  function relabel(app, key, label) {
    const s = settingOf(app, key);
    s.label = label;
    const next = freeKey(app, keyOf(label), s);
    if (next === key) return s;
    s.key = next;
    for (const e of app.layers) {
      if (e.type === 'text') {
        e.words = e.words.split('{' + key + '}').join('{' + next + '}');
        if (e.color === '{' + key + '}') e.color = '{' + next + '}';
      }
      if (e.show !== undefined && showKey(e.show) === key) e.show = next + e.show.slice(key.length);
    }
    return s;
  }

  function removeSetting(app, key, frame) {
    const s = settingOf(app, key);
    for (const e of app.layers) {
      if (e.type === 'text') {
        untieWords(app, e, key);
        if (e.color === '{' + key + '}') e.color = s.type === 'color' ? s.default : '#ffffff';
      }
      if (e.show !== undefined && showKey(e.show) === key) delete e.show;
    }
    app.settings.splice(app.settings.indexOf(s), 1);
    for (const e of app.layers.slice()) relocate(app, frame, findElement(app, frame, e.uid));
  }



  function usedFonts(app) {
    const out = new Set(['nunito']);
    for (const e of allElements(app)) if (helper.FONTS.includes(e.font)) out.add(e.font);
    return Array.from(out);
  }

  function allElements(app) {
    const out = app.layers.slice();
    for (const f of app.frames) out.push(...f.elements);
    return out;
  }

  function fileName(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') ||
      'picture';
  }


  function exportNames(app, store) {
    const taken = new Set(), images = new Map(), sprites = new Map();
    const claim = (base) => {
      let name = base, n = 2;
      while (taken.has(name)) name = base.slice(0, 31 - String(n).length) + '-' + n++;
      taken.add(name);
      return 'images/' + name + '.png';
    };
    for (const e of app.layers) if (e.type === 'sprite' && !sprites.has(e.name)) sprites.set(e.name, claim(fileName(e.name)));
    for (const e of allElements(app)) {
      if (e.type === 'image' && !images.has(e.image)) images.set(e.image, claim(fileName(store.get(e.image).name)));
    }
    return { images: images, sprites: sprites };
  }

  function settingJson(s) {
    const out = { key: s.key, type: s.type, label: s.label, default: s.default };
    if (s.type === 'text') out.max = s.max;
    if (s.type === 'choice') out.options = s.options.slice();
    return out;
  }

  function layerJson(e, names) {
    let out;
    if (e.type === 'text') {
      out = { type: 'text', text: e.words };
      if (!blank(e.x)) out.x = e.x;
      if (!blank(e.y)) out.y = e.y;
      Object.assign(out, { size: e.size, font: e.font, color: e.color, align: e.align });
    } else {
      out = { type: 'image', src: e.type === 'sprite' ? names.sprites.get(e.name) : names.images.get(e.image), x: e.x, y: e.y };
    }
    if (e.show !== undefined) out.show = e.show;
    return out;
  }


  function fieldsOf(app) {
    const out = { mooboard: 1, id: app.id, name: app.name, author: app.author, refresh: app.refresh, duration: app.duration };
    if (app.category) out.category = app.category;
    return out;
  }

  function manifestOf(app, names, fields) {
    const m = Object.assign({}, fields || fieldsOf(app));
    if (app.settings.length) m.settings = app.settings.map(settingJson);
    if (app.layers.length) m.layers = app.layers.map((e) => layerJson(e, names));
    return m;
  }


  const NEEDS = { text: ['words'], time: ['shows', 'hours'], scroll: ['words'], sprite: ['name', 'x', 'y'],
                  image: ['path', 'x', 'y'], rect: ['x', 'y', 'w', 'h', 'color'], line: ['x0', 'y0', 'x1', 'y1', 'color'] };


  const NUMBERS = ['x', 'y', 'w', 'h', 'x0', 'y0', 'x1', 'y1', 'size', 'hours'];

  const CALL_KEYS = {
    text: ['type', 'words', 'x', 'y', 'size', 'font', 'color', 'align'],
    time: ['type', 'shows', 'hours', 'x', 'y', 'size', 'font', 'color', 'align'],
    scroll: ['type', 'words', 'y', 'size', 'font', 'color'],
    sprite: ['type', 'name', 'x', 'y'],
    image: ['type', 'path', 'x', 'y'],
    rect: ['type', 'x', 'y', 'w', 'h', 'color'],
    line: ['type', 'x0', 'y0', 'x1', 'y1', 'color'],
  };


  function callOf(e, names) {
    const out = {};
    for (const key of CALL_KEYS[e.type]) {
      if (key === 'path') out.path = names.images.get(e.image);
      else if (e[key] !== undefined) out[key] = e[key];
    }
    return out;
  }

  function framesOf(app, names) {
    return app.frames.map((f) => ({ ms: f.ms, elements: f.elements.map((e) => callOf(e, names)) }));
  }

  function python(value) {
    if (value === null) return 'None';
    if (value === true) return 'True';
    if (value === false) return 'False';
    return JSON.stringify(value);
  }

  function appSource(frames) {
    const lines = ['from mooboard import Screen', '', 'FRAMES = ['];
    for (const f of frames) {
      lines.push('    {"ms": ' + f.ms + ', "elements": [');
      for (const e of f.elements) {
        lines.push('        {' + Object.keys(e).map((k) => JSON.stringify(k) + ': ' + python(e[k])).join(', ') + '},');
      }
      lines.push('    ]},');
    }
    lines.push(']', '', 'screen = Screen()', 'screen.compose(FRAMES)', 'screen.save()', '');
    return lines.join('\n');
  }

  const utf8 = (text) => new TextEncoder().encode(text);


  function picturesOf(app, store, kit, names) {
    const out = {};
    for (const [name, path] of names.sprites) {
      const s = kit.sprite(name);
      if (!s) continue;
      out[path] = { png: helper.encodePngRgba(s.width, s.height, s.rgba), width: s.width, height: s.height, rgba: s.rgba };
    }
    for (const [id, path] of names.images) {
      const p = store.get(id);
      out[path] = { png: helper.encodePngRgba(p.width, p.height, p.rgba), width: p.width, height: p.height, rgba: p.rgba };
    }
    return out;
  }

  function appFiles(app, store, kit) {
    const names = exportNames(app, store), pictures = picturesOf(app, store, kit, names);
    const files = [['mooboard.json', utf8(JSON.stringify(manifestOf(app, names), null, 2) + '\n')],
                   ['app.py', utf8(appSource(framesOf(app, names)))]];
    for (const path of Object.keys(pictures).sort()) files.push([path, pictures[path].png]);
    return files;
  }


  function exportZip(app, store, kit) {
    return helper.writeZip(appFiles(app, store, kit).map(([name, data]) => [slug(app.id) + '/' + name, data]));
  }



  function skip(text, at) {
    for (;;) {
      while (at < text.length && /\s/.test(text[at])) at++;
      if (text[at] !== '#') return at;
      while (at < text.length && text[at] !== '\n') at++;
    }
  }

  const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"' };

  function stringAt(text, at) {
    const quote = text[at];
    let out = '';
    for (at++; at < text.length && text[at] !== quote; at++) {
      if (text[at] === '\n') break;
      if (text[at] !== '\\') {
        out += text[at];
        continue;
      }
      const c = text[++at];
      if (c in ESCAPES) out += ESCAPES[c];
      else if (c === 'x' || c === 'u' || c === 'U') {
        const n = { x: 2, u: 4, U: 8 }[c], digits = text.substr(at + 1, n);
        if (!/^[0-9a-fA-F]+$/.test(digits) || digits.length !== n) throw new Error('bad escape');
        out += String.fromCodePoint(parseInt(digits, 16));
        at += n;
      } else {
        out += '\\' + c;
      }
    }
    if (text[at] !== quote) throw new Error('open string');
    return [out, at + 1];
  }


  function valueAt(text, at) {
    at = skip(text, at);
    const c = text[at];
    if (c === '[' || c === '{') {
      const list = c === '[', out = list ? [] : {}, close = list ? ']' : '}';
      for (at++; ;) {
        at = skip(text, at);
        if (text[at] === close) return [out, at + 1];
        let key = null;
        if (!list) {
          [key, at] = valueAt(text, at);
          at = skip(text, at);
          if (typeof key !== 'string' || text[at] !== ':') throw new Error('bad dict');
          at++;
        }
        let value;
        [value, at] = valueAt(text, at);
        if (list) out.push(value);
        else out[key] = value;
        at = skip(text, at);
        if (text[at] === ',') at++;
        else if (text[at] !== close) throw new Error('bad list');
      }
    }
    if (c === '"' || c === "'") return stringAt(text, at);
    const word = /^(-?[0-9]+|True|False|None)(?![A-Za-z0-9_.])/.exec(text.slice(at, at + 40));
    if (!word) throw new Error('not a literal');
    const value = { True: true, False: false, None: null }[word[1]];
    return [value === undefined ? Number(word[1]) : value, at + word[1].length];
  }

  function parseLiteral(text) {
    const [value, at] = valueAt(text, 0);
    if (skip(text, at) !== text.length) throw new Error('more after the literal');
    return value;
  }

  function framesIn(source) {
    const found = /^FRAMES\s*=\s*/m.exec(source);
    return found ? valueAt(source, found.index + found[0].length)[0] : null;
  }


  function appEntries(entries) {
    const found = entries.filter((e) => /(^|\/)mooboard\.json$/.test(e.name)).sort((a, b) => a.name.length - b.name.length)[0];
    if (!found) return [];
    const prefix = found.name.slice(0, -'mooboard.json'.length), out = [];
    for (const e of entries) {
      if (!e.name.startsWith(prefix)) continue;
      const path = e.name.slice(prefix.length);
      const cap = Object.prototype.hasOwnProperty.call(FILE_CAPS, path) ? FILE_CAPS[path]
        : /^images\/[^/]+\.png$/.test(path) ? PICTURE_CAP : 0;
      if (cap) out.push(Object.assign({}, e, { path: path, cap: cap }));
    }
    return out;
  }


  async function inflate(data, format, limit) {
    const stream = new DecompressionStream(format || 'deflate');
    const writer = stream.writable.getWriter(), reader = stream.readable.getReader();
    let stopped = false;
    const feeding = (async () => {
      for (let at = 0; at < data.length && !stopped; at += SLICE) await writer.write(data.subarray(at, at + SLICE));
      if (!stopped) await writer.close();
    })().catch(() => {});
    const parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
      if (limit !== undefined && size > limit) {
        stopped = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }
    await feeding;
    const out = new Uint8Array(limit === undefined ? size : Math.min(size, limit + 1));
    let at = 0;
    for (const part of parts) {
      const piece = part.subarray(0, out.length - at);
      out.set(piece, at);
      at += piece.length;
      if (at === out.length) break;
    }
    return out;
  }


  async function unzip(bytes) {
    const out = [];
    let total = 0;
    for (const e of appEntries(helper.readZip(bytes))) {
      const refuse = new helper.Refused(helper.fill(WORDS.unreadable, { name: e.path }));
      if ((e.method !== 0 && e.method !== 8) || e.size > e.cap || (e.method === 0 && e.data.length > e.cap)) throw refuse;
      const data = e.method === 8 ? await inflate(e.data, 'deflate-raw', e.cap) : e.data;
      total += data.length;
      if (data.length > e.cap || total > OPEN_CAP) throw refuse;
      out.push(Object.assign({}, e, { data: data }));
    }
    return out;
  }

  function samePixels(a, b) {
    return a.width === b.width && a.height === b.height && a.rgba.every((v, i) => v === b.rgba[i]);
  }


  async function readApp(entries, decode, kit) {
    const found = entries.filter((e) => /(^|\/)mooboard\.json$/.test(e.name)).sort((a, b) => a.name.length - b.name.length)[0];
    if (!found) throw new helper.Refused(helper.fill(WORDS.unreadable, { name: 'mooboard.json' }));
    const prefix = found.name.slice(0, -'mooboard.json'.length);
    const files = new Map(entries.filter((e) => e.name.startsWith(prefix)).map((e) => [e.name.slice(prefix.length), e.data]));
    const text = (name) => new TextDecoder().decode(files.get(name));
    let manifest, frames;
    try {
      manifest = JSON.parse(text('mooboard.json'));
      if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('not an object');
    } catch (error) {
      throw new helper.Refused(helper.fill(WORDS.unreadable, { name: 'mooboard.json' }));
    }
    try {
      frames = files.has('app.py') ? framesIn(text('app.py')) : [{ ms: FRAME_MS, elements: [] }];
      if (!Array.isArray(frames)) throw new Error('no frames');
    } catch (error) {
      throw new helper.Refused(helper.fill(WORDS.unreadable, { name: 'app.py' }));
    }
    const store = new Map(), byPath = new Map();
    for (const [name, data] of files) {
      if (!/^images\/[^/]+\.png$/.test(name)) continue;
      const p = await decode(data);
      byPath.set(name, addImage(store, name.slice(7, -4), p.width, p.height, cleared(p.rgba)));
    }

    const settings = helper.checkSettings(manifest.settings === undefined ? [] : manifest.settings);
    helper.checkLayers(manifest.layers === undefined ? [] : manifest.layers, settings, new Set(byPath.keys()));
    const app = newApp();
    for (const key of ['id', 'name', 'author', 'refresh', 'duration']) if (key in manifest) app[key] = manifest[key];
    if (helper.CATEGORIES.includes(manifest.category)) app.category = manifest.category;
    app.settings = (manifest.settings || []).map((s) => JSON.parse(JSON.stringify(s)));
    const known = (e) => {
      const strings = ['words', 'name'].filter((key) => e && key in e);
      const numbers = NUMBERS.filter((key) => e && key in e && !(e[key] === null && (key === 'x' || key === 'y')));
      if (!e || !CALL_KEYS[e.type] || NEEDS[e.type].some((key) => !(key in e)) ||
          strings.some((key) => typeof e[key] !== 'string') || numbers.some((key) => !Number.isSafeInteger(e[key]))) {
        throw new helper.Refused(helper.fill(WORDS.unreadable, { name: 'app.py' }));
      }
      const out = { uid: 'e' + (++app.next) };
      for (const key of CALL_KEYS[e.type]) if (key !== 'path' && key in e) out[key] = e[key];
      if (e.type === 'image') {
        out.image = byPath.get(e.path);
        if (out.image === undefined) throw new helper.Refused(helper.fill(WORDS.unreadable, { name: e.path }));
      }
      return out;
    };
    if (frames.some((f) => !f || typeof f !== 'object' || !Number.isSafeInteger(f.ms))) {
      throw new helper.Refused(helper.fill(WORDS.unreadable, { name: 'app.py' }));
    }
    app.frames = frames.map((f) => ({ ms: timeOf(f.ms), elements: (f.elements || []).map(known) }));
    app.layers = (manifest.layers || []).map((l) => {
      let e;
      if (l.type === 'text') {
        e = { type: 'text', words: l.text, x: l.x === undefined ? null : l.x, y: l.y === undefined ? null : l.y, size: l.size,
              font: l.font || 'nunito', color: l.color || '#ffffff', align: l.align || 'left' };
      } else {
        const id = byPath.get(l.src), name = l.src.slice(7, -4), s = kit.sprite(name);
        if (id === undefined) throw new helper.Refused(helper.fill(WORDS.unreadable, { name: l.src }));
        e = s && samePixels(s, store.get(id)) ? { type: 'sprite', name: name, x: l.x, y: l.y }
          : { type: 'image', image: id, x: l.x, y: l.y };
      }
      if (l.show !== undefined) e.show = l.show;
      e.uid = 'e' + (++app.next);
      return e;
    });
    return { app: app, store: store };
  }




  function kitFor(kit, store, names) {
    const byPath = new Map();
    for (const [id, path] of names.images) byPath.set(path, store.get(id));
    return { atlas: kit.atlas, sprite: kit.sprite, image: (path) => byPath.get(path) || null };
  }

  function composeApp(app, store, kit, now, problems) {
    const names = exportNames(app, store), screen = new helper.Screen(kitFor(kit, store, names));
    screen.compose(framesOf(app, names), now, problems);
    return screen.frames();
  }

  function layerPictures(app, store, kit, names) {
    const out = {};
    for (const [path, p] of Object.entries(picturesOf(app, store, kit, names))) out[path] = p;
    return out;
  }


  function tickerStart(screen, e, kit) {
    if (!helper.SIZES.includes(e.size) || !helper.FONTS.includes(e.font)) return;
    const face = kit.atlas(e.font, e.size), spans = helper.layout(face, e.words)[0], box = helper.ink(face, spans);
    if (box === null) return;
    const base = blank(e.y) ? baseOf(e.size) : e.y;
    if (base + box[2] < SAFE[1] || base + box[3] > SAFE[3]) return;
    screen.canvas.clip = SAFE;
    helper.drawText(screen.canvas, face, spans, SAFE[0] - box[0], base, helper.colorOf(e.color));
    screen.canvas.clip = [0, 0, W - 1, H - 1];
  }


  function frameView(app, store, kit, index, now) {
    const names = exportNames(app, store), all = kitFor(kit, store, names), screen = new helper.Screen(all);
    for (const e of app.frames[index].elements) {
      try {
        if (e.type === 'scroll') tickerStart(screen, e, all);
        else screen.call(callOf(e, names), now);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
      }
    }
    const layers = manifestOf(app, names, {});
    return helper.composeLayers([[screen.rgb(), 0]], layers, layerPictures(app, store, kit, names), null, all)[0][0];
  }

  const STAND_IN = { mooboard: 1, id: 'check', name: 'Check', author: 'mooboard', refresh: 3600, duration: 10 };

  function refusal(run) {
    try {
      run();
      return null;
    } catch (error) {
      if (error instanceof helper.Refused) return error.line;
      throw error;
    }
  }


  function authorRefusal(author) {
    return refusal(() => helper.checkManifest(Object.assign({}, STAND_IN, { author: author }), {}));
  }



  class GitHubUsers {
    constructor(fetcher, waitMs) {
      this.fetcher = fetcher;
      this.waitMs = waitMs === undefined ? GITHUB_WAIT_MS : waitMs;
      this.answers = new Map();
      this.asking = new Map();
    }

    known(name) {
      return this.answers.get(String(name).toLowerCase()) || null;
    }

    ask(name) {
      const key = String(name).toLowerCase();
      if (this.answers.has(key)) return Promise.resolve(this.answers.get(key));
      if (!this.asking.has(key)) {
        const answer = Promise.resolve()
          .then(() => this.fetcher(GITHUB_USERS + encodeURIComponent(name)))
          .then((reply) => (reply.status === 200 ? 'found' : reply.status === 404 ? 'missing' : 'unknown'), () => 'unknown')
          .then((said) => {
            if (said !== 'unknown') this.answers.set(key, said);
            return said;
          });
        let timer = 0;
        const waited = new Promise((done) => { timer = setTimeout(() => done('unknown'), this.waitMs); });
        this.asking.set(key, Promise.race([answer, waited]).then((said) => {
          clearTimeout(timer);
          this.asking.delete(key);
          return said;
        }));
      }
      return this.asking.get(key);
    }
  }


  function authorMissing(author, users) {
    if (author === '') return false;
    return authorRefusal(author) !== null || users.known(author) === 'missing';
  }


  function check(app, store, kit, now) {
    const out = { app: null, author: null, settings: null, screen: [], warnings: [], frames: 0, ok: false };
    out.app = refusal(() => helper.checkManifest(Object.assign(fieldsOf(app), { author: STAND_IN.author }), { kit: kit }));
    out.author = authorRefusal(app.author);
    const names = exportNames(app, store), all = kitFor(kit, store, names);
    out.settings = refusal(() => helper.checkManifest(Object.assign({}, STAND_IN, app.settings.length
      ? { settings: app.settings.map(settingJson) } : {}), { kit: all }));
    const problems = [];
    const frames = composeApp(app, store, kit, now, problems);
    out.frames = frames.length;
    for (const p of problems) if (!out.screen.includes(p.line)) out.screen.push(p.line);
    if (out.settings === null) {
      const manifest = manifestOf(app, names, STAND_IN), pictures = picturesOf(app, store, kit, names);
      const line = refusal(() => {
        if (problems.length) {
          helper.checkManifest(manifest, { kit: all, images: new Set(Object.keys(pictures)) });
          out.warnings = helper.checkFrames(helper.composeLayers(frames, manifest, pictures, null, all));
        } else {
          out.warnings = helper.build({ manifest: manifest, frames: frames, images: pictures, built: '2026-01-01T00:00:00Z',
                                        kit: all }).warnings;
        }
      });
      if (line !== null && !out.screen.includes(line)) out.screen.push(line);
    }
    out.ok = out.app === null && out.author === null && out.settings === null && out.screen.length === 0;
    return out;
  }

  function buildPackage(app, store, kit, date, now) {
    const names = exportNames(app, store), all = kitFor(kit, store, names);
    const built = helper.build({ manifest: manifestOf(app, names), frames: composeApp(app, store, kit, now),
                                 images: picturesOf(app, store, kit, names), built: helper.stamp(date), kit: all });
    return { name: app.id + '.mooboard', bytes: built.package, warnings: built.warnings };
  }

  const api = { W, H, SHORTEST_MS, OPEN_CAP, WORDS, appEntries, inflate, unzip, blank, slug, newApp, makeElement, insertElement,
                moveElement, findElement, ledAt, keyStep, wordsOf, placeText, boxOf, movedBy, hitTest, addFrame,
                copyFrame, deleteFrame, moveFrame, timeOf, History, addImage, cleared, paint, resized, addSetting,
                settingOf, bind, relabel, removeSetting, settingValues, usedFonts, allElements, exportNames,
                manifestOf, picturesOf, appFiles, exportZip, parseLiteral, framesIn, readApp, kitFor, composeApp,
                frameView, check, buildPackage, GitHubUsers, authorMissing };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mooboardApp = api;
})(typeof window !== 'undefined' ? window : this);
