/* ══════════════════════════════════════════════════════════════
   Visualizer — видео по музыке, с текстом или без.

   Модуляторы связывают события трека (AudioAnalysis → bands.ev)
   с параметрами кадра:
     { target: 'zoom', source: 'kick', amount: 0.06, energy: 0.7 }
   energy — насколько сила зависит от энергии участка: припев бьёт
   сильнее куплета, тихое вступление почти не трогает кадр. Это и есть
   «структура без текста».

   Слои:
     камера   — зум/поворот/сдвиг/тряска вокруг фона и (слабее) текста;
     спектр   — полосы снизу или кольцо в центре;
     пост     — хром. аберрация, глитч, вспышка, виньетка, зерно.

   Всё — функция t и ev, без накопленного состояния: превью и экспорт
   совпадают.

   API:
     Visualizer.applyCamera(ctx, w, h, ev, k, t)  → true, если нужен restore
     Visualizer.drawSpectrum(ctx, w, h, ev, freq)
     Visualizer.post(ctx, w, h, ev, t)
     Visualizer.set({ preset, amount, spectrum, grain })
══════════════════════════════════════════════════════════════ */
const Visualizer = (function () {
  'use strict';

  const LS = 'ricole.viz';
  const DEF = { preset: 'auto', amount: 1, spectrum: 'none', grain: true };
  const st = (function () {
    try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(LS) || '{}')); }
    catch (e) { return Object.assign({}, DEF); }
  })();
  function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* нет хранилища */ } }

  /* ── Пресеты: база + модуляторы ──────────────
     Цели: zoom (доля), rot (рад), x/y (доля ширины), shake (доля высоты),
     flash (0..1), chroma (доля ширины), glitch (0..1), vignette (0..1),
     grain (0..1), spec (усиление спектра).
     Источники: поля ev + barSin, barCos, beatAlt (доля с чередованием знака). */
  const PRESETS = {
    calm: {
      name: 'Спокойно',
      base: { vignette: 0.35, grain: 0.05, spec: 0.6 },
      mods: [
        { target: 'zoom', source: 'bass', amount: 0.025, energy: 0.5 },
        { target: 'x', source: 'barSin', amount: 0.004 },
        { target: 'rot', source: 'barCos', amount: 0.003 },
        { target: 'vignette', source: 'bass', amount: 0.12 },
        { target: 'flash', source: 'sectionPulse', amount: 0.18 },
        { target: 'spec', source: 'energy', amount: 0.5 },
      ],
    },
    drive: {
      name: 'Драйв',
      base: { vignette: 0.4, grain: 0.06, spec: 0.7 },
      mods: [
        { target: 'zoom', source: 'kick', amount: 0.05, energy: 0.8 },
        { target: 'zoom', source: 'bass', amount: 0.015, energy: 0.5 },
        // Наклон — плавно по такту, а не туда-сюда на каждую долю
        { target: 'rot', source: 'barCos', amount: 0.004, energy: 0.6 },
        { target: 'x', source: 'barSin', amount: 0.005 },
        { target: 'flash', source: 'downbeat', amount: 0.05, energy: 1, pow: 2 },
        { target: 'flash', source: 'sectionPulse', amount: 0.25 },
        { target: 'chroma', source: 'onset', amount: 0.002, energy: 0.9 },
        { target: 'glitch', source: 'sectionPulse', amount: 0.6, pow: 3 },
        { target: 'vignette', source: 'bass', amount: 0.15 },
        { target: 'spec', source: 'energy', amount: 0.6 },
      ],
    },
    heavy: {
      name: 'Тяжело',
      base: { vignette: 0.5, grain: 0.08, spec: 0.8 },
      mods: [
        { target: 'zoom', source: 'kick', amount: 0.09, energy: 0.9 },
        { target: 'rot', source: 'beatAlt', amount: 0.012, energy: 0.9 },
        { target: 'shake', source: 'kick', amount: 0.01, energy: 1 },
        { target: 'flash', source: 'downbeat', amount: 0.16, energy: 1, pow: 2 },
        { target: 'flash', source: 'sectionPulse', amount: 0.45 },
        { target: 'chroma', source: 'kick', amount: 0.007, energy: 1 },
        { target: 'glitch', source: 'sectionPulse', amount: 1, pow: 2 },
        { target: 'glitch', source: 'onset', amount: 0.35, energy: 1, pow: 3, gate: 0.8 },
        { target: 'vignette', source: 'bass', amount: 0.2 },
        { target: 'spec', source: 'energy', amount: 0.8 },
      ],
    },
  };

  /* ── «Сюжет»: свой характер у каждой части песни ──────────
     Таймлайн частей — LyricDirector.timeline() по меткам лирики (или по
     структуре). Внутри части кадр ведёт себя ровно; на границе параметры
     перетекают за 0.6 с, а вход в часть отмечен склейкой (enter):
     вспышка, удар камеры, на припеве — короткий глитч. specA — видимость
     спектра: он выходит там, где нет текста (вступление, проигрыш, конец). */
  const STORY = {
    intro: {
      base: { vignette: 0.45, grain: 0.06, spec: 0.7, specA: 1 },
      mods: [
        { target: 'zoom', source: 'secPhase', amount: 0.05 },               // медленный наезд к началу песни
        { target: 'zoom', source: 'bass', amount: 0.015 },
        { target: 'x', source: 'barSin', amount: 0.004 },
      ],
      enter: { flash: 0, zoom: 0, glitch: 0 },
    },
    verse: {
      base: { vignette: 0.38, grain: 0.05, spec: 0.5, specA: 0 },
      mods: [
        { target: 'zoom', source: 'bass', amount: 0.02, energy: 0.5 },
        { target: 'x', source: 'barSin', amount: 0.004 },
        { target: 'rot', source: 'barCos', amount: 0.002 },
      ],
      enter: { flash: 0.18, zoom: 0.025, glitch: 0 },
    },
    prechorus: {
      base: { vignette: 0.42, grain: 0.06, spec: 0.6, specA: 0 },
      mods: [
        { target: 'zoom', source: 'secPhase', amount: 0.07, pow: 2 },        // разгон к припеву
        { target: 'vignette', source: 'secPhase', amount: 0.2 },
        { target: 'zoom', source: 'kick', amount: 0.015 },
        { target: 'chroma', source: 'secPhase', amount: 0.0015, pow: 3 },
      ],
      enter: { flash: 0.15, zoom: 0.02, glitch: 0 },
    },
    chorus: {
      base: { vignette: 0.3, grain: 0.05, spec: 0.8, specA: 0 },
      mods: [
        { target: 'zoom', source: 'kick', amount: 0.045, energy: 0.6 },
        { target: 'zoom', source: 'bass', amount: 0.015 },
        { target: 'flash', source: 'downbeat', amount: 0.06, pow: 2 },
        { target: 'x', source: 'barSin', amount: 0.006 },
        { target: 'rot', source: 'barCos', amount: 0.004 },
        { target: 'chroma', source: 'kick', amount: 0.0025 },
      ],
      enter: { flash: 0.5, zoom: 0.08, glitch: 0.7 },
    },
    bridge: {
      base: { vignette: 0.55, grain: 0.11, spec: 0.4, specA: 0 },
      mods: [
        { target: 'zoom', source: 'secPhase', amount: -0.03 },             // медленный отъезд
        { target: 'rot', source: 'barSin', amount: 0.003 },
        { target: 'zoom', source: 'bass', amount: 0.01 },
      ],
      enter: { flash: 0.12, zoom: -0.03, glitch: 0.25 },
    },
    instrumental: {
      base: { vignette: 0.4, grain: 0.07, spec: 0.9, specA: 1 },
      mods: [
        { target: 'zoom', source: 'kick', amount: 0.06, energy: 0.8 },
        { target: 'flash', source: 'downbeat', amount: 0.08, pow: 2 },
        { target: 'rot', source: 'barCos', amount: 0.006 },
        { target: 'x', source: 'barSin', amount: 0.008 },
        { target: 'chroma', source: 'onset', amount: 0.003, energy: 1 },
        { target: 'glitch', source: 'downbeat', amount: 0.25, pow: 4, gate: 0.75 },
      ],
      enter: { flash: 0.35, zoom: 0.06, glitch: 0.5 },
    },
    outro: {
      base: { vignette: 0.5, grain: 0.07, spec: 0.6, specA: 1 },
      mods: [
        { target: 'zoom', source: 'secPhase', amount: -0.04 },
        { target: 'zoom', source: 'bass', amount: 0.012 },
        { target: 'vignette', source: 'secPhase', amount: 0.3 },             // кадр закрывается
      ],
      enter: { flash: 0.15, zoom: 0, glitch: 0 },
    },
  };

  let tlKey = null, tl = null;
  function storyLine() {
    if (typeof LyricDirector === 'undefined' || typeof App === 'undefined' || !App.getState) return null;
    const lyr = App.getState().lyrics, D = AudioEngine.duration || 0;
    if (tlKey && tlKey[0] === lyr && tlKey[1] === D) return tl;
    tlKey = [lyr, D];
    tl = LyricDirector.timeline(lyr, D);
    return tl;
  }

  const TMP = {};
  function accum(pr, ev, out, secPhase, mul) {
    for (const k in pr.base) out[k] += pr.base[k];
    for (const m of pr.mods) {
      if (m.gate != null && ev.energy < m.gate) continue;
      let v = m.source === 'secPhase' ? secPhase : source(ev, m.source);
      if (m.pow) v = Math.sign(v) * Math.pow(Math.abs(v), m.pow);
      const e = m.energy || 0;
      out[m.target] += m.amount * v * (1 - e + e * ev.energy) * (m.target === 'vignette' || m.target === 'grain' || m.target === 'spec' ? 1 : mul);
    }
  }

  function resolveStory(ev) {
    const line = storyLine();
    if (!line || !line.length) return false;
    let i = 0;
    for (let k = 0; k < line.length; k++) if (line[k].t <= ev.t) i = k;
    const s = line[i], prev = i > 0 ? line[i - 1] : null;
    const len = Math.max(0.5, (s.end || s.t + 1) - s.t), dt = ev.t - s.t;
    const mul = s.last ? 1.3 : 1;
    accum(STORY[s.type] || STORY.verse, ev, P, Math.max(0, Math.min(1, dt / len)), mul);
    // Перетекание из прошлой части за 0.6 с
    const X = 0.6;
    if (prev && dt < X) {
      for (const k in P) TMP[k] = 0;
      accum(STORY[prev.type] || STORY.verse, ev, TMP, 1, prev.last ? 1.3 : 1);
      const a = Math.max(0, dt / X);
      for (const k in P) P[k] = TMP[k] + (P[k] - TMP[k]) * a;
    }
    // Склейка на входе в часть
    if (prev && dt >= 0) {
      const en = (STORY[s.type] || STORY.verse).enter;
      P.flash += en.flash * Math.exp(-dt / 0.3) * mul;
      P.zoom += en.zoom * Math.exp(-dt / 0.45) * mul;
      P.glitch += en.glitch * Math.exp(-dt / 0.2);
    }
    return true;
  }

  /* «Авто»: стиль по темпу и плотности ударов трека. С текстом —
     не выше «Драйва» и только на действительно плотных треках: строку
     надо читать, а не ловить. «Тяжело» — только руками. */
  function pick(map) {
    if (st.preset !== 'auto') return PRESETS[st.preset] || null;
    if (!map) return PRESETS.calm;
    const lyr = typeof App !== 'undefined' && App.getState ? App.getState().lyrics.length > 0 : false;
    if (lyr) return map.density > 4 && map.bpm >= 120 ? PRESETS.drive : PRESETS.calm;
    if (map.density > 5.5 && map.bpm >= 125) return PRESETS.heavy;
    if (map.bpm >= 100 || map.density > 3) return PRESETS.drive;
    return PRESETS.calm;
  }

  const P = { zoom: 0, rot: 0, x: 0, y: 0, shake: 0, flash: 0, chroma: 0, glitch: 0, vignette: 0, grain: 0, spec: 0, specA: 1 };
  let lastEv = null, lastT = -1;

  function source(ev, s) {
    switch (s) {
      case 'barSin': return Math.sin(2 * Math.PI * ev.barPhase);
      case 'barCos': return Math.cos(2 * Math.PI * ev.barPhase);
      case 'beatAlt': return ev.beat * (ev.beatIndex % 2 ? 1 : -1);
      default: return ev[s] || 0;
    }
  }

  // Параметры кадра на момент ev (кешируются на кадр)
  function resolve(ev) {
    if (ev === lastEv && ev && ev.t === lastT) return P;
    for (const k in P) P[k] = 0;
    lastEv = ev; lastT = ev ? ev.t : -1;
    P.specA = 1;
    if (st.preset === 'off' || !ev) return P;
    const A = st.amount;
    if (st.preset === 'story') P.specA = 0;
    if (!(st.preset === 'story' && resolveStory(ev))) {
      const map = typeof AudioAnalysis !== 'undefined' && AudioEngine.buffer ? AudioAnalysis.get(AudioEngine.buffer) : null;
      const pr = st.preset === 'story' ? PRESETS.calm : pick(map);
      if (!pr) return P;
      P.specA = 1;
      for (const k in pr.base) P[k] = pr.base[k];
      for (const m of pr.mods) {
        if (m.gate != null && ev.energy < m.gate) continue;
        let v = source(ev, m.source);
        if (m.pow) v = Math.sign(v) * Math.pow(Math.abs(v), m.pow);
        const e = m.energy || 0;
        P[m.target] += m.amount * v * (1 - e + e * ev.energy);
      }
    }
    // Сила касается движения; виньетка/зерно — оформление, их не раздуваем
    for (const k of ['zoom', 'rot', 'x', 'y', 'shake', 'flash', 'chroma', 'glitch']) P[k] *= A;
    P.specA = Math.max(0, Math.min(1, P.specA));
    if (!st.grain) P.grain = 0;
    return P;
  }

  /* ── Камера ─────────────────────────────────── */
  function applyCamera(ctx, w, h, ev, k, t) {
    if (!ev || st.preset === 'off') return false;
    const p = resolve(ev);
    k = k == null ? 1 : k;
    if (!p.zoom && !p.rot && !p.x && !p.y && !p.shake) return false;
    // Тряска — детерминированный шум из синусов: одинаков в превью и экспорте
    const sx = (Math.sin(t * 61.7) + Math.sin(t * 37.3 + 1.3)) * 0.5;
    const sy = (Math.sin(t * 53.1 + 2.1) + Math.sin(t * 29.9 + 0.4)) * 0.5;
    ctx.save();
    ctx.translate(w / 2 + (p.x * w + sx * p.shake * h) * k, h / 2 + (p.y * w + sy * p.shake * h) * k);
    ctx.rotate(p.rot * k);
    const z = 1 + p.zoom * k;
    ctx.scale(z, z);
    ctx.translate(-w / 2, -h / 2);
    return true;
  }

  /* ── Спектр ─────────────────────────────────── */
  const N = 48;
  function bandVal(freq, i) {
    const len = freq.length;
    const lo = Math.floor(2 * Math.pow(len * 0.75 / 2, i / N)), hi = Math.max(lo + 1, Math.floor(2 * Math.pow(len * 0.75 / 2, (i + 1) / N)));
    let m = 0;
    for (let j = lo; j < hi && j < len; j++) m = Math.max(m, freq[j]);
    return m / 255;
  }
  function drawSpectrum(ctx, w, h, ev, freq) {
    // В «Сюжете» спектр выходит сам там, где нет текста (полосы, если стиль не выбран)
    const style = st.spectrum !== 'none' ? st.spectrum : (st.preset === 'story' ? 'bars' : 'none');
    if (style === 'none' || !freq || !freq.length) return;
    const p = resolve(ev);
    // Спектр, выбранный руками, не пропадает и под текстом — только тише
    const vis = st.spectrum !== 'none' ? Math.max(0.5, p.specA) : p.specA;
    if (vis <= 0.01) return;
    const g = Math.max(0.2, p.spec || 0.6);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.min(1, vis);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    if (style === 'bars') {
      const W = w * 0.6, bw = W / (N * 2), x0 = (w - W) / 2, base = h * 0.96, Hm = h * 0.14 * g;
      for (let i = 0; i < N; i++) {
        const v = Math.pow(bandVal(freq, i), 1.6), bh = Math.max(2, v * Hm);
        ctx.fillRect(x0 + W / 2 + i * bw + 1, base - bh, bw - 2, bh);
        ctx.fillRect(x0 + W / 2 - (i + 1) * bw + 1, base - bh, bw - 2, bh);
      }
    } else if (style === 'ring') {
      const cx = w / 2, cy = h / 2, R = h * 0.17 * (1 + (ev ? ev.bass : 0) * 0.08), Lm = h * 0.12 * g;
      ctx.lineWidth = Math.max(2, h * 0.004); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < N * 2; i++) {
        const v = Math.pow(bandVal(freq, i < N ? i : 2 * N - 1 - i), 1.6);
        const a = -Math.PI / 2 + (i + 0.5) / (N * 2) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a), l = Math.max(2, v * Lm);
        ctx.moveTo(cx + c * R, cy + s * R); ctx.lineTo(cx + c * (R + l), cy + s * (R + l));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── Пост ───────────────────────────────────── */
  let cp = null, cR = null, cC = null, noiseCv = null, vig = null, vigKey = '';
  function buf(c, w, h) {
    if (!c) c = document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }
  function noisePattern(ctx) {
    if (!noiseCv) {
      noiseCv = document.createElement('canvas'); noiseCv.width = noiseCv.height = 256;
      const c = noiseCv.getContext('2d'), d = c.createImageData(256, 256);
      let s = 987654321;
      for (let i = 0; i < d.data.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const v = (s >> 8) & 255;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
      }
      c.putImageData(d, 0, 0);
    }
    return ctx.createPattern(noiseCv, 'repeat');
  }

  function post(ctx, w, h, ev, t) {
    if (!ev || st.preset === 'off') return;
    const p = resolve(ev);
    const cv = ctx.canvas;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none';

    const chroma = p.chroma * w, glitch = Math.min(1, p.glitch);
    if (chroma > 0.6 || glitch > 0.03) {
      cp = buf(cp, cv.width, cv.height);
      const c0 = cp.getContext('2d');
      c0.globalCompositeOperation = 'copy'; c0.drawImage(cv, 0, 0);

      // Глитч: полосы кадра съезжают вбок; раскладка меняется 12 раз в секунду
      if (glitch > 0.03) {
        const seed = Math.floor(t * 12);
        const rnd = i => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
        const n = 3 + Math.floor(glitch * 6);
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < n; i++) {
          const y = rnd(i) * h, sh = h * (0.01 + rnd(i + 50) * 0.06), dx = (rnd(i + 100) - 0.5) * w * 0.08 * glitch;
          ctx.drawImage(cp, 0, y, w, sh, dx, y, w, sh);
        }
        if (chroma > 0.6) c0.drawImage(cv, 0, 0);
      }

      // Хром. аберрация: красный канал чуть крупнее остальных (линза)
      if (chroma > 0.6) {
        cR = buf(cR, cv.width, cv.height); cC = buf(cC, cv.width, cv.height);
        const r = cR.getContext('2d'), c = cC.getContext('2d');
        r.globalCompositeOperation = 'copy'; r.drawImage(cp, 0, 0);
        r.globalCompositeOperation = 'multiply'; r.fillStyle = '#f00'; r.fillRect(0, 0, w, h);
        c.globalCompositeOperation = 'copy'; c.drawImage(cp, 0, 0);
        c.globalCompositeOperation = 'multiply'; c.fillStyle = '#0ff'; c.fillRect(0, 0, w, h);
        const s = 1 + 2 * chroma / w;
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(cC, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(cR, (w - w * s) / 2, (h - h * s) / 2, w * s, h * s);
      }
    }

    // Вспышка
    if (p.flash > 0.005) {
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.8, p.flash).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    // Виньетка
    if (p.vignette > 0.01) {
      const key = w + 'x' + h;
      if (vigKey !== key) {
        vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
        vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,1)');
        vigKey = key;
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(0.85, p.vignette);
      ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Зерно: сдвиг узора 24 раза в секунду
    if (p.grain > 0.005) {
      const pat = noisePattern(ctx), f = Math.floor(t * 24);
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.min(0.3, p.grain);
      ctx.translate((f * 97) % 256, (f * 61) % 256);
      ctx.fillStyle = pat; ctx.fillRect(-256, -256, w + 512, h + 512);
    }
    ctx.restore();
  }

  /* ── Панель ─────────────────────────────────── */
  let panelEl = null;
  function set(patch) { Object.assign(st, patch); save(); lastEv = null; }

  function buildUI() {
    const header = document.querySelector('header') || document.querySelector('.header');
    if (!header || document.getElementById('vizBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'vizBtn';
    btn.style.cssText = "background:transparent;border:1px solid #ff2d55;color:#ff2d55;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;padding:6px 12px;cursor:pointer;margin-right:6px;";
    btn.textContent = '◉ ВИЗУАЛ';
    btn.title = 'Камера, вспышки, спектр по битам трека — работает и без текста';
    const anchor = document.getElementById('cardDeckBtn') || document.getElementById('autoDirectorBtn');
    if (anchor && anchor.parentNode === header) header.insertBefore(btn, anchor); else header.appendChild(btn);
    btn.addEventListener('click', toggle);
  }

  function toggle() {
    if (panelEl) { panelEl.remove(); panelEl = null; return; }
    const p = document.createElement('div');
    p.style.cssText = "position:fixed;top:52px;right:16px;z-index:9999;width:280px;background:#0d0d0d;border:1px solid #333;padding:14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#ddd;box-shadow:0 12px 40px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:10px;";
    const inp = 'style="background:#161616;border:1px solid #333;color:#eee;padding:5px 6px;font:inherit;"';
    const row = (label, html) => `<label style="display:flex;flex-direction:column;gap:4px;"><span style="color:#888;letter-spacing:1px;text-transform:uppercase;font-size:9px;">${label}</span>${html}</label>`;
    const opts = [['story', 'Сюжет (по частям песни)'], ['auto', 'Авто (по темпу трека)'], ['calm', PRESETS.calm.name], ['drive', PRESETS.drive.name], ['heavy', PRESETS.heavy.name], ['off', 'Выключен']];
    p.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;"><b style="color:#ff2d55;letter-spacing:2px;">◉ ВИЗУАЛИЗАТОР</b><button data-k="x" style="background:none;border:0;color:#888;cursor:pointer;font-size:14px;">✕</button></div>` +
      row('Режим', `<select data-k="preset" ${inp}>${opts.map(o => `<option value="${o[0]}"${st.preset === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`) +
      `<div data-k="auto" style="color:#666;font-size:10px;"></div>` +
      row('Сила движения', `<input type="range" data-k="amount" min="0" max="2" step="0.05" value="${st.amount}">`) +
      row('Спектр', `<select data-k="spectrum" ${inp}>${[['none', 'нет'], ['bars', 'полосы снизу'], ['ring', 'кольцо в центре']].map(o => `<option value="${o[0]}"${st.spectrum === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`) +
      `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" data-k="grain"${st.grain ? ' checked' : ''}> Зерно плёнки</label>` +
      `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" data-k="dbg"${typeof AudioAnalysis !== 'undefined' && AudioAnalysis.debug ? ' checked' : ''}> График битов (Shift+B)</label>`;
    document.body.appendChild(p);
    panelEl = p;
    const $ = s => p.querySelector(s);
    const showAuto = () => {
      const map = typeof AudioAnalysis !== 'undefined' && AudioEngine.buffer ? AudioAnalysis.get(AudioEngine.buffer) : null;
      $('[data-k="auto"]').textContent = map ? `Трек: ${map.bpm} BPM, ${map.density.toFixed(1)} удара/с → «${(pick(map) || {}).name || '—'}»` : 'Трек не загружен';
    };
    showAuto();
    $('[data-k="x"]').onclick = toggle;
    $('[data-k="preset"]').onchange = e => { set({ preset: e.target.value }); showAuto(); };
    $('[data-k="amount"]').oninput = e => set({ amount: +e.target.value });
    $('[data-k="spectrum"]').onchange = e => set({ spectrum: e.target.value });
    $('[data-k="grain"]').onchange = e => set({ grain: e.target.checked });
    $('[data-k="dbg"]').onchange = e => { if (typeof AudioAnalysis !== 'undefined') AudioAnalysis.setDebug(e.target.checked); };
  }

  return {
    applyCamera: applyCamera, drawSpectrum: drawSpectrum, post: post, resolve: resolve,
    set: set, buildUI: buildUI, toggle: toggle, PRESETS: PRESETS,
    get settings() { return st; },
  };
})();
