/* mooboard composer: an app's screens put together by hand and checked with the build's own rules, all in this browser */
(function (root) {
  'use strict';

  const helper = root.mooboardHelper || require('./helper.js');
  const preview = root.mooboardPreviewer || require('../previewer/previewer.js');
  const player = root.mooboardPlayer || require('../mooboard/player/player.js');
  const model = root.mooboardApp || require('./app.js');
  const { addFrame, addImage, addSetting, allElements, bind, blank, boxOf, buildPackage, check, cleared, composeApp,
          copyFrame, deleteFrame, exportNames, exportZip, findElement, frameView, H, History, hitTest, inflate,
          insertElement, keyStep, kitFor, ledAt, makeElement, manifestOf, movedBy, moveElement, moveFrame, newApp,
          paint, picturesOf, placeText, readApp, relabel, removeSetting, resized, settingOf, settingValues,
          SHORTEST_MS, slug, timeOf, unzip, usedFonts, W, WORDS, wordsOf } = model;

  // ---- the page ----

  function hexBytes(text) {
    const out = new Uint8Array(text.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16);
    return out;
  }

  // the bytes a png's rows take, so inflating stops there as the helper's reader does
  function rowBytes(info) {
    const bits = info.channels * info.depth, passes = info.interlace === 1
      ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
    let total = 0;
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((info.width - x0) / dx), ph = Math.ceil((info.height - y0) / dy);
      if (pw > 0 && ph > 0) total += ph * (1 + Math.ceil((pw * bits) / 8));
    }
    return total;
  }

  // a picture's pixels with their alpha, its size read from its header before anything is inflated
  function decodePng(bytes) {
    return Promise.resolve().then(() => {
      const info = preview.parsePng(bytes);
      if (info.width > W || info.height > H) throw new helper.Refused(WORDS.pictureBig);
      return inflate(info.idat, 'deflate', rowBytes(info)).then((raw) => preview.pngRgba(info, raw));
    });
  }

  function loadScript(doc, src) {
    return new Promise((resolve, reject) => {
      const tag = doc.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = reject;
      doc.head.appendChild(tag);
    });
  }

  function fontData(font) {
    return root['mooboardFonts_' + font.replace(/-/g, '_')];
  }

  function kindOf(e, store) {
    if (e.type === 'image') return store.get(e.image).name === 'pixels' ? WORDS.pixels : WORDS.picture;
    return { text: WORDS.text, time: WORDS.time, scroll: WORDS.ticker, sprite: WORDS.sprite, rect: WORDS.box,
             line: WORDS.line }[e.type];
  }

  function detailOf(e, store, now) {
    if (e.type === 'text' || e.type === 'scroll') return e.words;
    if (e.type === 'time') return wordsOf(e, now);
    if (e.type === 'sprite') return e.name;
    if (e.type === 'image') return store.get(e.image).name;
    if (e.type === 'rect') return e.w + '×' + e.h;
    return '';
  }

  function start(doc) {
    const byId = (id) => doc.getElementById(id);
    const data = root.mooboardData || { palette: [], sprites: {} };
    const board = byId('board'), stage = byId('stage'), leds = byId('leds'), glow = byId('glow'), chosen = byId('chosen');
    const strip = byId('strip'), layers = byId('layers'), sheet = byId('sheet'), fields = byId('fields');
    const warnings = byId('warnings'), playButton = byId('play'), packageButton = byId('package');
    const settingsList = byId('settings');
    const history = new History();
    const loading = new Map(), atlases = new Map(), sprites = new Map();
    let app = newApp(), store = new Map(), frame = 0, selected = null, scale = 0, checked = null, timer = 0;
    let drag = null, press = null, pressed = false, paintMode = null, paintColor = [255, 255, 255, 255];
    let playing = null, pending = null, said = [], pictureAt = null, fitsLine = null;

    const kit = {
      atlas(font, size) {
        const key = font + '-' + size;
        if (!atlases.has(key)) atlases.set(key, new helper.Atlas(fontData(font)[size]));
        return atlases.get(key);
      },
      sprite(name) {
        if (!sprites.has(name)) {
          const s = Object.prototype.hasOwnProperty.call(data.sprites, name) ? data.sprites[name] : null;
          sprites.set(name, s ? { width: s.width, height: s.height, rgba: hexBytes(s.rgba) } : null);
        }
        return sprites.get(name);
      },
    };

    function loadFont(font) {
      if (fontData(font)) return Promise.resolve();
      if (!loading.has(font)) loading.set(font, loadScript(doc, 'fonts/' + font + '.js'));
      return loading.get(font);
    }

    // runs now when every font in use is here, or once they arrive
    function withFonts(then) {
      const fonts = usedFonts(app);
      if (fonts.every(fontData)) return then();
      Promise.all(fonts.map(loadFont)).then(then, () => say([WORDS.unreadableFile]));
      return undefined;
    }

    const now = () => helper.clockNow();
    const current = () => (selected ? findElement(app, frame, selected) : null);
    const when = () => (byId('night').checked ? 'night' : byId('evening').checked ? 'evening' : 'day');

    // ---- history ----

    function snapshot() {
      return JSON.stringify({ app: app, frame: frame, selected: selected });
    }

    function restore(text) {
      const s = JSON.parse(text);
      app = s.app;
      frame = Math.min(s.frame, app.frames.length - 1);
      selected = s.selected && findElement(app, frame, s.selected) ? s.selected : null;
      refresh(true);
    }

    function act(change) {
      stop();
      said = [];
      const before = snapshot();
      change();
      if (snapshot() !== before) history.record(before);
      refresh(true);
    }

    // a field that changes the app as it is typed in and lands in undo once when it is left
    function live(input, apply) {
      input.addEventListener('focus', () => { pending = snapshot(); });
      input.addEventListener('input', () => {
        stop();
        if (pending === null) pending = snapshot();
        apply(input);
        refresh(false);
      });
      input.addEventListener('change', () => {
        if (pending !== null && pending !== snapshot()) history.record(pending);
        pending = snapshot();
        refresh(false);
      });
      input.addEventListener('blur', () => { pending = null; });
    }

    function undo() {
      const s = history.undo(snapshot());
      if (s !== null) restore(s);
    }

    function redo() {
      const s = history.redo(snapshot());
      if (s !== null) restore(s);
    }

    // ---- drawing ----

    function fit() {
      const ratio = root.devicePixelRatio || 1;
      const room = Math.max(64, stage.clientWidth - 20);
      const tall = Math.max(64, root.innerHeight * 0.42);
      const next = Math.max(1, Math.min(64, Math.floor(Math.min(room / W, tall / H) * ratio)));
      if (next !== scale) {
        scale = next;
        leds.width = W * scale;
        leds.height = H * scale;
      }
      board.style.width = (W * scale) / ratio + 'px';
      board.style.height = (H * scale) / ratio + 'px';
      board.style.setProperty('--led', scale / ratio + 'px');
    }

    function flat(rgb) {
      const out = new ImageData(W, H);
      for (let k = 0, j = 0; k < rgb.length; k += 3, j += 4) {
        out.data[j] = rgb[k];
        out.data[j + 1] = rgb[k + 1];
        out.data[j + 2] = rgb[k + 2];
        out.data[j + 3] = 255;
      }
      return out;
    }

    function paintBoard(rgb) {
      leds.getContext('2d').putImageData(new ImageData(preview.ledLook(rgb, W, H, scale), W * scale, H * scale), 0, 0);
      glow.getContext('2d').putImageData(flat(rgb), 0, 0);
    }

    // the board at the time of day picked, as the player shows an app
    function looked(rgb) {
      const w = when();
      return player.look(w === 'night' ? preview.nightTint(rgb, preview.NIGHT_LEVEL) : rgb, w);
    }

    function thumb(index, rgb) {
      const item = strip.children[index], canvas = item && item.querySelector('canvas');
      if (canvas) canvas.getContext('2d').putImageData(flat(rgb), 0, 0);
    }

    function draw() {
      if (playing) return;
      const rgb = frameView(app, store, kit, frame, now());
      paintBoard(looked(rgb));
      thumb(frame, rgb);
      const found = current();
      chosen.hidden = !found;
      if (found) {
        const b = boxOf(found.element, kit, store, now(), settingValues(app));
        const x0 = Math.max(0, b[0]), x1 = Math.min(W - 1, b[1]), y0 = Math.max(0, b[2]), y1 = Math.min(H - 1, b[3]);
        chosen.style.left = (x0 * 100) / W + '%';
        chosen.style.top = (y0 * 100) / H + '%';
        chosen.style.width = ((x1 - x0 + 1) * 100) / W + '%';
        chosen.style.height = ((y1 - y0 + 1) * 100) / H + '%';
        if (fitsLine && found.element.type !== 'image') {
          const e = found.element;
          const placed = e.type === 'text' || e.type === 'time' ? placeText(e, kit, now(), settingValues(app)) : null;
          const smaller = placed && placed.fits && placed.size !== e.size;
          fitsLine.textContent = smaller ? helper.fill(WORDS.fits, { size: placed.size }) : '';
        }
      }
    }

    function say(lines) {
      said = lines;
      showWarnings();
    }

    function showWarnings() {
      const lines = [];
      for (const line of (checked ? checked.screen.concat(checked.warnings) : []).concat(said)) {
        if (!lines.includes(line)) lines.push(line);
      }
      warnings.textContent = '';
      for (const line of lines) {
        const item = doc.createElement('li');
        item.textContent = line;
        warnings.appendChild(item);
      }
    }

    function checkNow() {
      checked = check(app, store, kit, now());
      byId('app-line').textContent = checked.app || '';
      byId('settings-line').textContent = checked.settings || '';
      packageButton.disabled = !checked.ok;
      showWarnings();
      return checked;
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => withFonts(checkNow), 150);
    }

    // ---- the lists ----

    function el(tag, props, children) {
      const node = doc.createElement(tag);
      for (const [key, value] of Object.entries(props || {})) {
        if (value === undefined) continue;
        if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else if (key === 'className') node.className = value;
        else node.setAttribute(key, value);
      }
      for (const child of children || []) node.append(child);
      return node;
    }

    function buildStrip() {
      strip.textContent = '';
      app.frames.forEach((f, i) => {
        const canvas = el('canvas', { width: String(W), height: String(H) });
        const name = helper.fill(WORDS.frame, { number: i + 1 });
        const button = el('button', { type: 'button', className: 'thumb', 'aria-label': name, 'aria-current': String(i === frame),
                                      'data-key': 'strip:frame-' + i, onclick: () => pickFrame(i) }, [canvas]);
        const input = el('input', { type: 'number', min: String(SHORTEST_MS), step: '10', value: String(f.ms),
                                    'data-key': 'strip:ms-' + i });
        live(input, () => { app.frames[i].ms = timeOf(input.value); });
        input.addEventListener('change', () => { input.value = String(app.frames[i].ms); });
        strip.appendChild(el('li', {}, [button, el('label', {}, [input, WORDS.ms])]));
        if (i !== frame) thumb(i, frameView(app, store, kit, i, now()));
      });
      const at = strip.children[frame];
      if (at && strip.scrollWidth > strip.clientWidth) at.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function pickFrame(i) {
      frame = i;
      if (selected && !findElement(app, frame, selected)) selected = null;
      refresh(true);
    }

    function buildLayers() {
      layers.textContent = '';
      const add = (e) => {
        const button = el('button', { type: 'button', className: 'layer', 'aria-pressed': String(e.uid === selected),
                                      'data-key': 'layer:' + e.uid, onclick: () => select(e.uid) },
                          [el('span', { text: kindOf(e, store) }), el('span', { text: detailOf(e, store, now()) })]);
        button.addEventListener('keydown', (event) => nudgeKey(event));
        layers.appendChild(el('li', {}, [button]));
      };
      if (app.layers.length) {
        layers.appendChild(el('li', { className: 'group', text: WORDS.everyFrame }));
        app.layers.slice().reverse().forEach(add);
      }
      app.frames[frame].elements.slice().reverse().forEach(add);
    }

    function select(uid) {
      selected = uid;
      paintMode = null;
      if (!usedFonts(app).every(fontData)) {
        withFonts(() => select(uid));
        return;
      }
      restoring(() => {
        buildLayers();
        buildSheet();
      });
      draw();
      if (uid) showBoard();
    }

    // a rebuild puts focus back on the control that had it, so the keyboard keeps its place
    function restoring(rebuild) {
      const active = doc.activeElement, key = active && active.getAttribute ? active.getAttribute('data-key') : null;
      rebuild();
      if (!key || doc.contains(active)) return;
      const again = doc.querySelector('[data-key="' + key + '"]');
      (again || board).focus({ preventScroll: true });
    }

    // on a phone the settings cover the lower half, so the board comes up above them
    function showBoard() {
      if (root.getComputedStyle(sheet).position !== 'fixed') return;
      const b = board.getBoundingClientRect(), s = sheet.getBoundingClientRect();
      if (b.top < 0 || b.bottom > s.top) root.scrollBy(0, b.top - 12);
    }

    // ---- the inspector ----

    function update(change) {
      const found = current();
      if (found) change(found.element);
    }

    function field(label, input) {
      return el('label', { className: 'field' }, [el('span', { text: label }), input]);
    }

    function textInput(value, apply, key) {
      const input = el('input', { type: 'text', value: value, autocomplete: 'off', 'data-key': key });
      live(input, apply);
      return input;
    }

    function numberInput(value, low, high, apply, key, empty) {
      const input = el('input', { type: 'number', min: String(low), max: String(high), step: '1',
                                  value: blank(value) ? '' : String(value), 'data-key': key });
      if (empty !== undefined) input.setAttribute('placeholder', empty);
      live(input, () => {
        const n = Math.round(Number(input.value));
        if (input.value === '' && empty !== undefined) apply(null);
        else if (input.value !== '' && Number.isFinite(n)) apply(Math.min(high, Math.max(low, n)));
      });
      return input;
    }

    function choices(options, value, pick, name) {
      const box = el('div', { className: 'choices', role: 'group' });
      for (const [key, label] of options) {
        box.appendChild(el('button', { type: 'button', 'aria-pressed': String(key === value), text: label,
                                       'data-key': name + '-' + key, onclick: () => act(() => update((e) => pick(e, key))) }));
      }
      return box;
    }

    function menu(options, value, pick, name) {
      const select = el('select', { 'data-key': name }, options.map(([key, label]) => {
        const option = el('option', { value: key, text: label });
        if (key === value) option.selected = true;
        return option;
      }));
      select.addEventListener('change', () => act(() => pick(select.value)));
      return select;
    }

    function colors(value, pick, name) {
      const box = el('div', { className: 'swatches', role: 'group' });
      for (const hex of data.palette) {
        box.appendChild(el('button', { type: 'button', className: 'swatch', 'aria-label': hex, style: 'background:' + hex,
                                       'aria-pressed': String(hex === String(value).toLowerCase()),
                                       'data-key': name + '-' + hex, onclick: () => act(() => pick(hex)) }));
      }
      const custom = el('input', { type: 'color', 'aria-label': WORDS.custom, 'data-key': name + '-custom',
                                   value: /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#ffffff' });
      live(custom, () => pick(custom.value));
      box.appendChild(custom);
      return box;
    }

    function settingsOfType(types) {
      return app.settings.filter((s) => types.includes(s.type));
    }

    function bindMenu(e, part, types, selectedKey) {
      const usable = settingsOfType(types);
      if (!usable.length) return null;
      return field(WORDS.setting, menu([['', WORDS.none]].concat(usable.map((s) => [s.key, s.label])), selectedKey,
                                       (key) => bind(app, frame, e.uid, { [part]: key || null }), 'sheet:setting-' + part));
    }

    function showMenu(e) {
      const options = [['', WORDS.always]];
      for (const s of app.settings) {
        if (s.type === 'toggle') options.push([s.key, s.label]);
        if (s.type !== 'choice') continue;
        for (const o of s.options) options.push([s.key + '=' + o, helper.fill(WORDS.variant, { label: s.label, value: o })]);
      }
      if (options.length < 2) return null;
      return field(WORDS.show, menu(options, e.show || '', (show) => bind(app, frame, e.uid, { show: show || null }),
                                    'sheet:show'));
    }

    function boundKey(text) {
      const found = /^\{([^{}]*)\}$/.exec(text);
      return found && settingOf(app, found[1]) ? found[1] : '';
    }

    function textFields(e, out) {
      if (e.type === 'time') {
        out.push(field(WORDS.shows, choices([['time', WORDS.time], ['date', WORDS.date], ['both', WORDS.timeAndDate]], e.shows,
                                            (t, v) => { t.shows = v; }, 'sheet:shows')));
        if (e.shows !== 'date') {
          out.push(field(WORDS.hours, choices([[12, WORDS.hours12], [24, WORDS.hours24]], e.hours, (t, v) => { t.hours = v; },
                                              'sheet:hours')));
        }
        out.push(el('p', { className: 'note', text: WORDS.timeNote }));
      } else {
        const key = e.type === 'text' ? boundKey(e.words) : '';
        const words = (input) => update((t) => { t.words = input.value; });
        if (!key) out.push(field(WORDS.words, textInput(e.words, words, 'sheet:words')));
        if (e.type === 'text') {
          const bindWords = bindMenu(e, 'words', ['text', 'choice'], key);
          if (bindWords) out.push(bindWords);
        }
      }
      const sizes = helper.SIZES.map((s) => [s, String(s)]);
      out.push(field(WORDS.size, choices(sizes, e.size, (t, v) => { t.size = v; }, 'sheet:size')));
      fitsLine = el('p', { className: 'note', role: 'status' });
      out.push(fitsLine);
      out.push(field(WORDS.font, menu(helper.FONTS.map((f) => [f, f]), e.font, (font) => update((t) => { t.font = font; }),
                                      'sheet:font')));
      const colorKey = e.type === 'text' ? boundKey(e.color) : '';
      if (!colorKey) out.push(field(WORDS.color, colors(e.color, (hex) => update((t) => { t.color = hex; }), 'sheet:color')));
      if (e.type === 'text') {
        const bindColor = bindMenu(e, 'color', ['color'], colorKey);
        if (bindColor) out.push(bindColor);
      }
      if (e.type !== 'scroll') {
        out.push(field(WORDS.align, choices([['left', WORDS.left], ['center', WORDS.center], ['right', WORDS.right]], e.align,
                                            (t, v) => { t.align = v; }, 'sheet:align')));
        out.push(el('div', { className: 'pair' }, [
          field(WORDS.x, numberInput(e.x, 0, W - 1, (v) => update((t) => { t.x = v; }), 'sheet:x', WORDS.center)),
          field(WORDS.y, numberInput(e.y, 0, H - 1, (v) => update((t) => { t.y = v; }), 'sheet:y', WORDS.center))]));
      } else {
        out.push(field(WORDS.y, numberInput(e.y, 0, H - 1, (v) => update((t) => { t.y = v; }), 'sheet:y', WORDS.center)));
      }
    }

    function placeFields(e, out) {
      out.push(el('div', { className: 'pair' }, [
        field(WORDS.x, numberInput(e.x, 0, W - 1, (v) => update((t) => { t.x = v; }), 'sheet:x')),
        field(WORDS.y, numberInput(e.y, 0, H - 1, (v) => update((t) => { t.y = v; }), 'sheet:y'))]));
    }

    function pictureFields(e, out) {
      const p = store.get(e.image);
      placeFields(e, out);
      if (p.name === 'pixels') {
        out.push(el('div', { className: 'pair' }, [
          field(WORDS.width, numberInput(p.width, 1, W, (v) => update((t) => resized(store, t, v, store.get(t.image).height)),
                                         'sheet:width')),
          field(WORDS.height, numberInput(p.height, 1, H, (v) => update((t) => resized(store, t, store.get(t.image).width, v)),
                                          'sheet:height'))]));
      }
      const modes = el('div', { className: 'choices', role: 'group' });
      for (const [mode, label] of [['paint', WORDS.paint], ['erase', WORDS.erase]]) {
        modes.appendChild(el('button', { type: 'button', 'aria-pressed': String(paintMode === mode), text: label,
                                         'data-key': 'sheet:' + mode, onclick: () => {
                                           paintMode = paintMode === mode ? null : mode;
                                           restoring(buildSheet);
                                         } }));
      }
      out.push(modes);
      if (paintMode === 'paint') {
        const hex = '#' + paintColor.slice(0, 3).map((v) => (v < 16 ? '0' : '') + v.toString(16)).join('');
        const pick = (value) => { paintColor = helper.colorOf(value).concat([255]); };
        out.push(field(WORDS.color, colors(hex, pick, 'sheet:paint')));
      }
    }

    function buildSheet() {
      const found = current();
      sheet.hidden = !found;
      doc.body.classList.toggle('sheet-open', Boolean(found));
      fitsLine = null;
      if (!found) {
        fields.textContent = '';
        return;
      }
      const e = found.element, out = [];
      byId('sheet-title').textContent = kindOf(e, store);
      if (e.type === 'text' || e.type === 'time' || e.type === 'scroll') textFields(e, out);
      else if (e.type === 'sprite') {
        out.push(field(WORDS.sprite, menu(Object.keys(data.sprites).map((n) => [n, n]), e.name,
                                          (name) => update((t) => { t.name = name; }), 'sheet:sprite')));
        placeFields(e, out);
      } else if (e.type === 'image') pictureFields(e, out);
      else if (e.type === 'rect') {
        placeFields(e, out);
        out.push(el('div', { className: 'pair' }, [
          field(WORDS.width, numberInput(e.w, 1, W, (v) => update((t) => { t.w = v; }), 'sheet:w')),
          field(WORDS.height, numberInput(e.h, 1, H, (v) => update((t) => { t.h = v; }), 'sheet:h'))]));
        out.push(field(WORDS.color, colors(e.color, (hex) => update((t) => { t.color = hex; }), 'sheet:color')));
      } else {
        for (const [label, kx, ky] of [[WORDS.from, 'x0', 'y0'], [WORDS.to, 'x1', 'y1']]) {
          out.push(el('h3', { text: label }));
          out.push(el('div', { className: 'pair' }, [
            field(WORDS.x, numberInput(e[kx], 0, W - 1, (v) => update((t) => { t[kx] = v; }), 'sheet:' + kx)),
            field(WORDS.y, numberInput(e[ky], 0, H - 1, (v) => update((t) => { t[ky] = v; }), 'sheet:' + ky))]));
        }
        out.push(field(WORDS.color, colors(e.color, (hex) => update((t) => { t.color = hex; }), 'sheet:color')));
      }
      if (e.type === 'text' || e.type === 'sprite' || e.type === 'image') {
        const shows = showMenu(e);
        if (shows) out.push(shows);
      }
      fields.textContent = '';
      for (const node of out) fields.appendChild(node);
      const list = found.list;
      const movable = (delta) => {
        const to = found.index + delta;
        return to >= 0 && to < list.length && (list[to].type === 'scroll') === (e.type === 'scroll');
      };
      byId('up').disabled = !movable(1);
      byId('down').disabled = !movable(-1);
      draw();
    }

    // ---- the app and its settings ----

    const appInputs = { name: byId('app-name'), id: byId('app-id'), author: byId('app-author'), refresh: byId('app-refresh'),
                        duration: byId('app-duration') };

    function wholeOr(text) {
      const n = Number(text);
      return text !== '' && Number.isInteger(n) ? n : text;
    }

    live(appInputs.name, (input) => {
      if (app.id === slug(app.name)) {
        app.id = slug(input.value);
        appInputs.id.value = app.id;
      }
      app.name = input.value;
    });
    live(appInputs.id, (input) => { app.id = input.value; });
    live(appInputs.author, (input) => { app.author = input.value; });
    live(appInputs.refresh, (input) => { app.refresh = wholeOr(input.value); });
    live(appInputs.duration, (input) => { app.duration = wholeOr(input.value); });

    function fillApp() {
      for (const [key, input] of Object.entries(appInputs)) if (doc.activeElement !== input) input.value = String(app[key]);
    }

    function buildSettings() {
      settingsList.textContent = '';
      for (const s of app.settings) {
        const parts = [el('div', { className: 'head' }, [
          el('span', { text: { text: WORDS.text, color: WORDS.color, toggle: WORDS.toggle, choice: WORDS.choice }[s.type] }),
          el('button', { type: 'button', text: WORDS.delete, 'data-key': 'settings:delete-' + s.key,
                         onclick: () => act(() => removeSetting(app, s.key, frame)) })])];
        const label = el('input', { type: 'text', value: s.label, maxlength: '24', autocomplete: 'off',
                                    'data-key': 'settings:label-' + s.key });
        live(label, () => { settingOf(app, s.key).label = label.value; });
        label.addEventListener('change', () => {
          relabel(app, s.key, label.value);
          if (!sheet.contains(doc.activeElement)) restoring(buildSheet);
        });
        parts.push(field(WORDS.label, label));
        const set = (value) => { settingOf(app, s.key).default = value; };
        if (s.type === 'text') {
          parts.push(field(WORDS.default, textInput(s.default, (input) => set(input.value), 'settings:default-' + s.key)));
          parts.push(field(WORDS.max, numberInput(s.max, 1, 32, (v) => { settingOf(app, s.key).max = v; },
                                                  'settings:max-' + s.key)));
        } else if (s.type === 'color') {
          parts.push(field(WORDS.default, colors(s.default, (hex) => set(hex), 'settings:default-' + s.key)));
        } else if (s.type === 'toggle') {
          const box = el('input', { type: 'checkbox', 'data-key': 'settings:default-' + s.key });
          box.checked = s.default;
          box.addEventListener('change', () => act(() => set(box.checked)));
          parts.push(el('label', { className: 'check' }, [box, WORDS.default]));
        } else {
          parts.push(field(WORDS.default, menu(s.options.map((o) => [o, o]), s.default, (o) => set(o),
                                               'settings:default-' + s.key)));
          const options = el('textarea', { rows: String(Math.max(2, s.options.length)),
                                           'data-key': 'settings:options-' + s.key });
          options.value = s.options.join('\n');
          live(options, () => {
            const now = settingOf(app, s.key);
            now.options = options.value.split('\n').map((o) => o.trim()).filter(Boolean);
            if (!now.options.includes(now.default)) now.default = now.options[0] || '';
          });
          options.addEventListener('change', () => restoring(buildSettings));
          parts.push(field(WORDS.options, options));
        }
        settingsList.appendChild(el('li', {}, parts));
      }
    }

    // ---- everything after a change ----

    function refresh(rebuild) {
      if (!usedFonts(app).every(fontData)) {
        withFonts(() => refresh(rebuild));
        return;
      }
      restoring(() => {
        if (rebuild) {
          buildStrip();
          buildSheet();
          buildSettings();
          fillApp();
        } else {
          app.frames.forEach((f, i) => { if (i !== frame) thumb(i, frameView(app, store, kit, i, now())); });
        }
        buildLayers();
      });
      byId('undo').disabled = !history.undos.length;
      byId('redo').disabled = !history.redos.length;
      byId('frame-delete').disabled = app.frames.length < 2;
      byId('frame-earlier').disabled = frame === 0;
      byId('frame-later').disabled = frame === app.frames.length - 1;
      draw();
      schedule();
    }

    // ---- adding ----

    function add(kind, at) {
      if (kind === 'picture') {
        pictureAt = at;
        byId('picture').click();
        return;
      }
      withFonts(() => {
        act(() => {
          const e = makeElement(app, kind, { kit: kit, store: store, at: at });
          insertElement(app.frames[frame].elements, e);
          selected = e.uid;
        });
        showBoard();
      });
    }

    function addPicture(file, at) {
      if (!file) return;
      file.arrayBuffer().then((buffer) => decodePng(new Uint8Array(buffer))).then((p) => {
        const name = file.name.replace(/\.png$/i, '');
        act(() => {
          const id = addImage(store, name, p.width, p.height, cleared(p.rgba));
          const e = makeElement(app, 'picture', { kit: kit, store: store, image: id, at: at });
          insertElement(app.frames[frame].elements, e);
          selected = e.uid;
        });
      }, (error) => say([error instanceof helper.Refused ? error.line : WORDS.unreadableFile]));
    }

    byId('picture').addEventListener('change', () => {
      addPicture(byId('picture').files[0], pictureAt);
      byId('picture').value = '';
    });

    for (const button of doc.querySelectorAll('[data-add]')) {
      const kind = button.getAttribute('data-add');
      button.addEventListener('pointerdown', (event) => {
        if (event.button > 0) return;
        press = { kind: kind, x: event.clientX, y: event.clientY, ghost: null };
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener('pointermove', (event) => {
        if (!press) return;
        if (!press.ghost && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) {
          press.ghost = el('div', { className: 'ghost', text: button.textContent, 'aria-hidden': 'true' });
          doc.body.appendChild(press.ghost);
        }
        if (press.ghost) {
          press.ghost.style.left = event.clientX + 'px';
          press.ghost.style.top = event.clientY + 'px';
        }
      });
      const done = (event, cancelled) => {
        if (!press) return;
        const ghost = press.ghost;
        press = null;
        if (!ghost) return;
        ghost.remove();
        pressed = true;
        const r = board.getBoundingClientRect();
        const over = event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom;
        if (over && !cancelled) add(kind, ledAt(event.clientX, event.clientY, r));
      };
      button.addEventListener('pointerup', (event) => done(event, false));
      button.addEventListener('pointercancel', (event) => done(event, true));
      button.addEventListener('click', () => {
        if (pressed) {
          pressed = false;
          return;
        }
        add(kind, null);
      });
    }

    // ---- the board: drag, paint and the keys ----

    function paintTo(e, from, to) {
      const p = store.get(e.image), rgba = paintMode === 'erase' ? [0, 0, 0, 0] : paintColor;
      let [x, y] = from;
      const dx = Math.abs(to[0] - x), sx = x < to[0] ? 1 : -1, dy = -Math.abs(to[1] - y), sy = y < to[1] ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        const px = x - e.x, py = y - e.y;
        if (px >= 0 && py >= 0 && px < p.width && py < p.height) p.rgba.set(rgba, (py * p.width + px) * 4);
        if (x === to[0] && y === to[1]) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y += sy;
        }
      }
    }

    board.addEventListener('pointerdown', (event) => {
      if (playing || event.button > 0) return;
      board.focus({ preventScroll: true });
      const at = ledAt(event.clientX, event.clientY, board.getBoundingClientRect());
      const found = current(), b = found ? boxOf(found.element, kit, store) : null;
      const onPicture = b !== null && b[0] <= at[0] && at[0] <= b[1] && b[2] <= at[1] && at[1] <= b[3];
      if (paintMode && found && found.element.type === 'image' && onPicture) {
        const before = snapshot(), e = found.element;
        paint(store, e, [], [0, 0, 0, 0]);
        paintTo(e, at, at);
        drag = { paint: true, uid: e.uid, at: at, before: before };
        board.setPointerCapture(event.pointerId);
        draw();
        return;
      }
      const uid = hitTest(app, frame, at[0], at[1], kit, store, now());
      if (uid !== selected) select(uid);
      if (!uid) return;
      const original = Object.assign({}, findElement(app, frame, uid).element);
      drag = { uid: uid, at: at, original: original, before: snapshot(), moved: false };
      board.setPointerCapture(event.pointerId);
    });

    board.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const at = ledAt(event.clientX, event.clientY, board.getBoundingClientRect());
      const found = findElement(app, frame, drag.uid);
      if (!found) return;
      if (drag.paint) {
        paintTo(found.element, drag.at, at);
        drag.at = at;
        draw();
        return;
      }
      const dx = at[0] - drag.at[0], dy = at[1] - drag.at[1];
      if (!dx && !dy && !drag.moved) return;
      found.list[found.index] = movedBy(drag.original, dx, dy, kit, store, now(), settingValues(app));
      drag.moved = true;
      draw();
    });

    const release = () => {
      if (!drag) return;
      const was = drag;
      drag = null;
      if (snapshot() !== was.before) {
        history.record(was.before);
        refresh(true);
      }
    };
    board.addEventListener('pointerup', release);
    board.addEventListener('pointercancel', release);

    function nudge(step) {
      const found = current();
      if (!found) return;
      act(() => {
        const again = current();
        again.list[again.index] = movedBy(again.element, step[0], step[1], kit, store, now(), settingValues(app));
      });
    }

    function remove() {
      act(() => {
        const found = current();
        if (found) found.list.splice(found.index, 1);
        selected = null;
      });
    }

    function nudgeKey(event) {
      const step = keyStep(event.key, event.shiftKey);
      if (step && selected) {
        event.preventDefault();
        nudge(step);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        event.preventDefault();
        remove();
      } else if (event.key === 'Escape' && selected) {
        select(null);
      }
    }

    board.addEventListener('keydown', nudgeKey);

    doc.addEventListener('keydown', (event) => {
      const t = event.target, typing = t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
        (t.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'file', 'color'].includes(t.type));
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y') && !typing) {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) redo();
        else undo();
      } else if (event.key === 'Escape' && selected && !typing) {
        select(null);
      }
    });

    for (const name of ['dragover', 'drop']) {
      doc.addEventListener(name, (event) => {
        event.preventDefault();
        if (name === 'drop' && board.contains(event.target)) {
          addPicture(event.dataTransfer.files[0], ledAt(event.clientX, event.clientY, board.getBoundingClientRect()));
        }
      });
    }

    // ---- the buttons ----

    function frameAct(change) {
      try {
        act(() => {
          const to = change();
          if (to >= 0) frame = to;
          if (selected && !findElement(app, frame, selected)) selected = null;
        });
      } catch (error) {
        say([error.message]);
      }
    }

    byId('frame-add').addEventListener('click', () => frameAct(() => addFrame(app, frame)));
    byId('frame-copy').addEventListener('click', () => frameAct(() => copyFrame(app, frame)));
    byId('frame-delete').addEventListener('click', () => frameAct(() => deleteFrame(app, frame)));
    byId('frame-earlier').addEventListener('click', () => frameAct(() => moveFrame(app, frame, -1)));
    byId('frame-later').addEventListener('click', () => frameAct(() => moveFrame(app, frame, 1)));
    byId('up').addEventListener('click', () => act(() => { const f = current(); if (f) moveElement(f.list, f.index, 1); }));
    byId('down').addEventListener('click', () => act(() => { const f = current(); if (f) moveElement(f.list, f.index, -1); }));
    byId('remove').addEventListener('click', remove);
    byId('done').addEventListener('click', () => select(null));
    byId('undo').addEventListener('click', undo);
    byId('redo').addEventListener('click', redo);
    for (const button of doc.querySelectorAll('[data-setting]')) {
      button.addEventListener('click', () => act(() => addSetting(app, button.getAttribute('data-setting'))));
    }
    for (const id of ['day', 'evening', 'night']) byId(id).addEventListener('change', () => { if (!playing) draw(); });

    function download(name, bytes, type) {
      const url = URL.createObjectURL(new Blob([bytes], { type: type }));
      const link = el('a', { href: url, download: name });
      doc.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    byId('export').addEventListener('click', () => withFonts(() => {
      download(slug(app.id) + '.zip', exportZip(app, store, kit), 'application/zip');
    }));
    packageButton.addEventListener('click', () => withFonts(() => {
      try {
        const built = buildPackage(app, store, kit, new Date(), now());
        download(built.name, built.bytes, 'application/octet-stream');
      } catch (error) {
        say([error.line || error.message]);
      }
    }));

    // an app another composer exported, its pictures under new names here so undo still finds the old ones
    function adopt(opened) {
      const ids = new Map();
      for (const [id, p] of opened.store) ids.set(id, addImage(store, p.name, p.width, p.height, p.rgba));
      for (const e of allElements(opened.app)) if (e.type === 'image') e.image = ids.get(e.image);
      act(() => {
        app = opened.app;
        frame = 0;
        selected = null;
      });
    }

    byId('open').addEventListener('change', () => {
      const file = byId('open').files[0];
      byId('open').value = '';
      if (!file) return;
      file.arrayBuffer()
        .then((buffer) => unzip(new Uint8Array(buffer)))
        .then((entries) => readApp(entries, decodePng, kit))
        .then((opened) => Promise.all(usedFonts(opened.app).map(loadFont)).then(() => adopt(opened)))
        .catch((error) => say([error instanceof helper.Refused ? error.line : WORDS.unreadableFile]));
    });

    // ---- play: the app between the clock's turns, as the player shows it ----

    function clipFrames(text) {
      return preview.decode(hexBytes(text), inflate).then((image) => {
        const size = W * H * 3, rgb = image.frames[0].rgb, out = [];
        for (let at = 0; at + size <= rgb.length; at += size) out.push(rgb.subarray(at, at + size));
        return out;
      });
    }

    function stop() {
      if (!playing) return;
      root.cancelAnimationFrame(playing.raf);
      playing = null;
      playButton.textContent = WORDS.play;
      playButton.setAttribute('aria-pressed', 'false');
      draw();
    }

    function paintAt(i) {
      playing.last = i;
      const w = when();
      paintBoard(player.look(player.frameAt(i, playing.turns, player.drawer(playing.show, w)), w));
    }

    function play() {
      if (playing) {
        stop();
        return;
      }
      const ready = root.mooboardClips ? Promise.resolve() : loadScript(doc, 'clips.js');
      ready.then(() => Promise.all(['day', 'evening', 'night'].map((t) => clipFrames(root.mooboardClips[t])))).then((clips) => {
        withFonts(() => {
          const names = exportNames(app, store), all = kitFor(kit, store, names);
          const frames = helper.composeLayers(composeApp(app, store, kit, now(), []), manifestOf(app, names, {}),
                                              picturesOf(app, store, kit, names), null, all);
          const show = { app: frames.map((f) => f[0]), delays: frames.map((f) => f[1]),
                         clips: { day: clips[0], evening: clips[1], night: clips[2] } };
          const duration = Math.min(60, Math.max(5, Number(app.duration) || 10));
          playing = { show: show, turns: player.cycleTurns(duration * 1000, 2000), t0: root.performance.now(), last: -1, raf: 0,
                      held: null };
          playButton.textContent = WORDS.stop;
          playButton.setAttribute('aria-pressed', 'true');
          chosen.hidden = true;
          const tick = (t) => {
            if (!playing) return;
            const i = playing.held !== null ? playing.held : Math.floor((t - playing.t0) / player.FRAME_MS);
            if (i !== playing.last) paintAt(i);
            playing.raf = root.requestAnimationFrame(tick);
          };
          playing.raf = root.requestAnimationFrame(tick);
        });
      }, () => say([WORDS.unreadableFile]));
    }

    playButton.addEventListener('click', play);
    for (const id of ['day', 'evening', 'night']) byId(id).addEventListener('change', () => { if (playing) playing.last = -1; });

    root.addEventListener('resize', () => {
      fit();
      if (playing) playing.last = -1;
      else draw();
    });

    glow.width = W;
    glow.height = H;
    fit();
    loadFont('nunito').then(() => refresh(true), () => say([WORDS.unreadableFile]));

    // what the page tests drive and read
    api.page = {
      state: () => ({ app: app, store: store, frame: frame, selected: selected, playing: Boolean(playing) }),
      check: () => withFonts(checkNow) || checked,
      exportZip: () => exportZip(app, store, kit),
      holdPlay: (i) => {
        if (!playing) return false;
        playing.held = i;
        paintAt(i);
        return true;
      },
    };
  }

  const api = {};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mooboardComposer = api;
  if (typeof document !== 'undefined' && document.getElementById('composer') !== null) start(document);
})(typeof window !== 'undefined' ? window : this);
