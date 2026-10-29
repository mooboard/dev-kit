
(function (root) {
  'use strict';

  const preview = root.mooboardPreviewer || require('../../previewer/previewer.js');

  const FRAME_MS = 33;
  const FADE_MS = 400;
  const LEAD_MS = Math.min(FRAME_MS, FADE_MS / 2);
  const CLOCK_MS = 3000;

  function stateAt(i, turns) {
    let lo = 0, hi = turns.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (turns[mid].from <= i) lo = mid;
      else hi = mid - 1;
    }
    const cur = turns[lo];
    const sceneFrame = i - cur.from;
    if (lo === 0) return { scene: cur.scene, sceneFrame: sceneFrame, prev: null, prevFrame: 0, mix: 1 };
    const prev = turns[lo - 1];
    const elapsed = sceneFrame * FRAME_MS + LEAD_MS;
    return { scene: cur.scene, sceneFrame: sceneFrame, prev: prev.scene, prevFrame: cur.from - 1 - prev.from,
             mix: elapsed >= FADE_MS ? 1 : Math.fround(elapsed / FADE_MS) };
  }


  function crossfade(from, to, mix) {
    const f = Math.fround;
    const out = new Uint8Array(to.length);
    for (let k = 0; k < to.length; k++) out[k] = Math.trunc(f(f((to[k] - from[k]) * mix + from[k]) + 0.5));
    return out;
  }

  function frameAt(i, turns, draw) {
    const s = stateAt(i, turns);
    const rgb = draw(s.scene, s.sceneFrame);
    return s.mix < 1 ? crossfade(draw(s.prev, s.prevFrame), rgb, s.mix) : rgb;
  }

  function gifFrameAt(delays, ms) {
    const held = delays.map((d) => Math.max(FRAME_MS, d));
    const total = held.reduce((a, b) => a + b, 0);
    let t = ms % total;
    for (let k = 0; k < held.length; k++) {
      if (t < held[k]) return k;
      t -= held[k];
    }
    return 0;
  }

  function cycleTurns(durationMs, cycles) {
    const clock = Math.round(CLOCK_MS / FRAME_MS), app = Math.ceil(durationMs / FRAME_MS);
    const turns = [];
    for (let k = 0, at = 0; k < cycles; k++) {
      turns.push({ scene: 'clock', from: at });
      at += clock;
      turns.push({ scene: 'app', from: at });
      at += app;
    }
    return turns;
  }

  function drawer(show, when) {
    const tinted = new Map();
    return (scene, frame) => {
      if (scene === 'clock') {
        const clip = show.clips[when];
        return clip[frame % clip.length];
      }
      const k = gifFrameAt(show.delays, frame * FRAME_MS);
      if (when !== 'night') return show.app[k];
      if (!tinted.has(k)) tinted.set(k, preview.nightTint(show.app[k], preview.NIGHT_LEVEL));
      return tinted.get(k);
    };
  }

  function look(rgb, when) {
    return when === 'day' ? rgb : preview.lowBrightness(rgb);
  }



  function inflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }

  function bytesOf(text) {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  }


  function stack(text) {
    return preview.decode(bytesOf(text), inflate).then((image) => {
      const rgb = image.frames[0].rgb, size = preview.PANEL_W * preview.PANEL_H * 3, frames = [];
      for (let at = 0; at + size <= rgb.length; at += size) frames.push(rgb.subarray(at, at + size));
      return frames;
    });
  }

  function variant(v) {
    if (v.gif) {
      const image = preview.decodeGif(bytesOf(v.gif));
      return Promise.resolve({ app: image.frames.map((f) => f.rgb), delays: image.frames.map((f) => f.delay) });
    }
    return stack(v.png).then((frames) => ({ app: frames, delays: v.delays }));
  }

  function start(doc) {
    const byId = (id) => doc.getElementById(id);
    const data = JSON.parse(byId('data').textContent);
    const stage = byId('stage'), board = byId('board'), leds = byId('leds'), glow = byId('glow');
    const picker = byId('variant'), times = ['day', 'evening', 'night'];
    const turns = cycleTurns(data.duration * 1000, 2000);
    let show = null, shows = [], scale = 0, last = -1, t0 = 0, held = null;

    function fit() {
      const ratio = root.devicePixelRatio || 1;
      const room = Math.max(64, stage.clientWidth - 20);
      const tall = Math.max(64, root.innerHeight * 0.6);
      const next = Math.max(1, Math.min(64, Math.floor(Math.min(room / 128, tall / 32) * ratio)));
      if (next !== scale) {
        scale = next;
        leds.width = 128 * scale;
        leds.height = 32 * scale;
      }
      board.style.width = (128 * scale) / ratio + 'px';
      board.style.height = (32 * scale) / ratio + 'px';
      board.style.setProperty('--led', scale / ratio + 'px');
    }

    function when() {
      return times.find((t) => byId(t).checked) || 'day';
    }

    function paint(i) {
      const w = when();
      const rgb = look(frameAt(i, turns, drawer(show, w)), w);
      leds.getContext('2d').putImageData(new ImageData(preview.ledLook(rgb, 128, 32, scale), 128 * scale, 32 * scale), 0, 0);
      const flat = new Uint8ClampedArray(128 * 32 * 4);
      for (let k = 0, j = 0; k < rgb.length; k += 3, j += 4) {
        flat[j] = rgb[k];
        flat[j + 1] = rgb[k + 1];
        flat[j + 2] = rgb[k + 2];
        flat[j + 3] = 255;
      }
      glow.getContext('2d').putImageData(new ImageData(flat, 128, 32), 0, 0);
    }

    function tick(now) {
      const i = held !== null ? held : Math.floor((now - t0) / FRAME_MS);
      if (i !== last) {
        last = i;
        paint(i);
      }
      root.requestAnimationFrame(tick);
    }

    const clips = Promise.all(times.map((t) => stack(data.clips[t])));
    Promise.all([clips, Promise.all(data.variants.map(variant))]).then(([decoded, variants]) => {
      const byTime = { day: decoded[0], evening: decoded[1], night: decoded[2] };
      shows = variants.map((v) => ({ app: v.app, delays: v.delays, clips: byTime }));
      show = shows[0];
      data.variants.forEach((v, k) => {
        const option = doc.createElement('option');
        option.value = String(k);
        option.textContent = v.label;
        picker.appendChild(option);
      });
      byId('settings').hidden = shows.length < 2;
      picker.addEventListener('change', () => { show = shows[Number(picker.value)]; last = -1; });
      for (const t of times) byId(t).addEventListener('change', () => { last = -1; });
      glow.width = 128;
      glow.height = 32;
      fit();
      root.addEventListener('resize', () => { fit(); last = -1; });
      api.paintAt = (i) => { held = last = i; paint(i); };
      t0 = root.performance.now();
      root.requestAnimationFrame(tick);
    });
  }

  const api = { FRAME_MS, FADE_MS, LEAD_MS, CLOCK_MS, stateAt, crossfade, frameAt, gifFrameAt, cycleTurns, drawer,
                look };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mooboardPlayer = api;
  if (typeof document !== 'undefined' && document.getElementById('data') !== null) start(document);
})(typeof window !== 'undefined' ? window : this);
