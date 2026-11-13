/* ══════════════════════════════════════════════════════════════
   AudioAnalysis — карта музыкальных событий трека.

   Трек прогоняется ОДИН раз целиком (при загрузке), и дальше
   эффекты берут готовые значения по времени кадра t:

     bass/mid/high/rms — полосы 0..1, нормированы по самому треку
                         (98-й перцентиль = 1), быстрая атака,
                         медленный спад;
     onset / kick      — удары: пики spectral flux (всё / только бас);
     beat / downbeat   — сетка долей: темп автокорреляцией, сами доли
                         динамическим программированием (Ellis 2007),
                         поэтому сетка идёт за музыкой, а не по линейке;
     section           — смены частей песни (новизна тембра), прилипают
                         к ближайшей сильной доле.

   Значение зависит только от t, поэтому превью и экспорт дают одно
   и то же. Новый трек → новая карта сама: AudioEngine.loadBuffer
   зовёт prepare(), кеш по объекту буфера.

   API:
     AudioAnalysis.prepare(buffer)   отложенный расчёт (не блокирует UI)
     AudioAnalysis.get(buffer)       карта (считает синхронно, если нет)
     AudioAnalysis.at(buffer, t)     события на момент t или null
     AudioAnalysis.drawDebug(ctx, w, h, buffer, t)   оверлей (Shift+B)
══════════════════════════════════════════════════════════════ */
const AudioAnalysis = (function () {
  'use strict';

  const WIN = 2048;     // ~43 мс: бас различим (≈23 Гц на бин)
  const HOP = 512;      // ~94 кадра/с при 48 кГц

  /* ── FFT (radix-2, in-place) ── */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr; im[b] = im[a] - vi;
          re[a] += vr;        im[a] += vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  function percentile(arr, p) {
    const s = Float32Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 1e-9;
  }

  // Делит на перцентиль и клампит в 0..1
  function normalize(arr, p) {
    const k = 1 / percentile(arr, p);
    for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, arr[i] * k);
    return arr;
  }

  // Огибающая: мгновенная атака, экспоненциальный спад (release, сек)
  function envelope(arr, fps, release) {
    const out = new Float32Array(arr.length);
    const k = Math.exp(-1 / (fps * release));
    let v = 0;
    for (let i = 0; i < arr.length; i++) { v = Math.max(arr[i], v * k); out[i] = v; }
    return out;
  }

  /* Пики онсетов: выше локального среднего (±win) с запасом, локальный
     максимум, не чаще minGap. Сила — высота пика над средним, 0..1. */
  function pickPeaks(env, fps, minGap, win, delta) {
    const n = env.length, w = Math.round(win * fps), g = Math.round(minGap * fps);
    const times = [], str = [];
    let run = 0, cnt = 0, lo = 0, hi = -1, last = -1e9;
    for (let i = 0; i < n; i++) {
      while (hi < Math.min(n - 1, i + w)) { run += env[++hi]; cnt++; }
      while (lo < i - w) { run -= env[lo++]; cnt--; }
      const mean = run / cnt, v = env[i];
      if (v < mean + delta) continue;
      if ((i > 0 && v < env[i - 1]) || (i < n - 1 && v <= env[i + 1])) continue;
      if (i - last < g) {
        // Слишком близко — оставляем более сильный
        if (str.length && v - mean > str[str.length - 1]) {
          times[times.length - 1] = i / fps; str[str.length - 1] = v - mean; last = i;
        }
        continue;
      }
      times.push(i / fps); str.push(v - mean); last = i;
    }
    const top = str.length ? percentile(str, 0.95) : 1;
    return {
      times: Float32Array.from(times),
      strength: Float32Array.from(str, s => Math.min(1, s / top)),
    };
  }

  /* ── Темп: автокорреляция огибающей онсетов, мягкий приоритет ~120 BPM ── */
  function tempo(env, fps) {
    const n = env.length;
    const minLag = Math.round(fps * 60 / 200), maxLag = Math.round(fps * 60 / 55);
    let best = 0, bestLag = Math.round(fps / 2);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
      s /= (n - lag);
      const bpm = 60 * fps / lag;
      s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      if (s > best) { best = s; bestLag = lag; }
    }
    return bestLag;
  }

  /* ── Доли: динамическое программирование (Ellis 2007) ──
     score[i] = env[i] + max_j (score[j] − α·log²((i−j)/P)), j ∈ [i−2P, i−P/2].
     Сетка сама подстраивается под живой темп и сбивки. */
  function trackBeats(env, fps, period) {
    const n = env.length, ALPHA = 400;
    const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
    const lo = Math.round(period / 2), hi = Math.round(period * 2);
    // Вес отклонения от периода, заранее по каждому шагу
    const pen = new Float32Array(hi + 1);
    for (let d = lo; d <= hi; d++) pen[d] = ALPHA * Math.pow(Math.log(d / period), 2);
    let mean = 0;
    for (let i = 0; i < n; i++) mean += env[i];
    mean = mean / n || 1;
    for (let i = 0; i < n; i++) {
      const local = env[i] / mean;
      let bestV = 0, bestJ = -1;
      for (let d = lo; d <= hi && i - d >= 0; d++) {
        const v = score[i - d] - pen[d];
        if (bestJ < 0 || v > bestV) { bestV = v; bestJ = i - d; }
      }
      score[i] = local + (bestJ >= 0 ? Math.max(0, bestV) : 0);
      back[i] = bestJ >= 0 && bestV > 0 ? bestJ : -1;
    }
    // Конец цепочки — лучший счёт в последнем периоде
    let end = n - 1;
    for (let i = Math.max(0, n - period); i < n; i++) if (score[i] > score[end]) end = i;
    const beats = [];
    for (let i = end; i >= 0; i = back[i]) beats.push(i);
    beats.reverse();
    return beats;
  }

  /* ── Части песни: новизна тембрового профиля (окно 8 с, шаг 1 с) ── */
  function sections(bass, mid, high, rms, fps, duration) {
    const step = Math.round(fps), blocks = Math.floor(bass.length / step), W = 8;
    if (blocks < W * 2 + 2) return [];
    const prof = [];
    for (let b = 0; b < blocks; b++) {
      let l = 0, m = 0, h = 0, r = 0;
      for (let i = b * step; i < (b + 1) * step; i++) { l += bass[i]; m += mid[i]; h += high[i]; r += rms[i]; }
      prof.push([l / step, m / step, h / step, r / step]);
    }
    const nov = new Float32Array(blocks);
    for (let b = W; b < blocks - W; b++) {
      let s = 0;
      for (let d = 0; d < 4; d++) {
        let a = 0, c = 0;
        for (let k = 1; k <= W; k++) { a += prof[b - k][d]; c += prof[b + k - 1][d]; }
        s += Math.pow((a - c) / W, 2);
      }
      nov[b] = Math.sqrt(s);
    }
    let mean = 0, sd = 0;
    for (const v of nov) mean += v;
    mean /= blocks;
    for (const v of nov) sd += (v - mean) * (v - mean);
    sd = Math.sqrt(sd / blocks);
    const picks = [];
    for (let b = W; b < blocks - W; b++) {
      if (nov[b] < mean + sd || nov[b] < nov[b - 1] || nov[b] < nov[b + 1]) continue;
      if (picks.length && b - picks[picks.length - 1] < 12) {
        if (nov[b] > nov[picks[picks.length - 1]]) picks[picks.length - 1] = b;
        continue;
      }
      picks.push(b);
    }
    return picks.map(b => Math.min(duration, b));
  }

  /* ══════════════════════════════════════════════
     Анализ целиком
  ══════════════════════════════════════════════ */
  function analyze(buffer) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const sr = buffer.sampleRate, nch = buffer.numberOfChannels;
    const len = buffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < nch; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / nch;
    }

    const win = new Float32Array(WIN);
    for (let i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN);
    const fps = sr / HOP, bins = WIN / 2, hz = sr / WIN;
    const bin = f => Math.max(1, Math.min(bins - 1, Math.round(f / hz)));
    const B0 = bin(30), B1 = bin(150), M1 = bin(2000), H1 = bin(10000);

    // Кадр f смотрит назад, как AnalyserNode: окно кончается на f·HOP
    const n = Math.max(1, Math.ceil(len / HOP));
    const bass = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n);
    const rms = new Float32Array(n), flux = new Float32Array(n), kflux = new Float32Array(n);
    const re = new Float32Array(WIN), im = new Float32Array(WIN);
    let prev = new Float32Array(bins), cur = new Float32Array(bins);

    for (let f = 0; f < n; f++) {
      const end = f * HOP + HOP, start = end - WIN;
      let s2 = 0;
      for (let i = 0; i < WIN; i++) {
        const k = start + i, s = k >= 0 && k < len ? mono[k] : 0;
        re[i] = s * win[i]; im[i] = 0; s2 += s * s;
      }
      rms[f] = Math.sqrt(s2 / WIN);
      fft(re, im);
      let l = 0, m = 0, h = 0, fl = 0, kf = 0;
      for (let b = 1; b < H1; b++) {
        // Логарифмическое сжатие: тихие удары тоже видны, громкий бас не душит всё
        const v = Math.log1p(100 * Math.sqrt(re[b] * re[b] + im[b] * im[b]) / WIN);
        cur[b] = v;
        const d = v - prev[b];
        if (b >= B0) {
          if (d > 0) fl += d;
          if (b < B1) { l += v; if (d > 0) kf += d; }
          else if (b < M1) m += v;
          else h += v;
        }
      }
      bass[f] = l / (B1 - B0); mid[f] = m / (M1 - B1); high[f] = h / (H1 - M1);
      flux[f] = fl; kflux[f] = kf;
      const tmp = prev; prev = cur; cur = tmp;
    }

    normalize(bass, 0.98); normalize(mid, 0.98); normalize(high, 0.98); normalize(rms, 0.98);
    normalize(flux, 0.99); normalize(kflux, 0.99);

    const onsets = pickPeaks(flux, fps, 0.08, 0.25, 0.08);
    const kicks  = pickPeaks(kflux, fps, 0.15, 0.30, 0.12);

    const period = tempo(flux, fps);
    const beatFrames = trackBeats(flux, fps, period);
    const beats = Float32Array.from(beatFrames, f => f / fps);

    // Сильная доля: из 4 фаз та, где бочка бьёт чаще всего (4/4)
    const ph = [0, 0, 0, 0];
    beatFrames.forEach((f, i) => {
      let v = 0;
      for (let d = -2; d <= 2; d++) v = Math.max(v, kflux[f + d] || 0);
      ph[i % 4] += v;
    });
    const phase = ph.indexOf(Math.max.apply(null, ph));
    const downbeats = beats.filter((_, i) => i % 4 === phase);

    // Части: границы притягиваются к ближайшей сильной доле (±1.5 с)
    const raw = sections(bass, mid, high, rms, fps, buffer.duration);
    const secStarts = [0];
    raw.forEach(t => {
      let best = t, dist = 1.5;
      for (const d of downbeats) { const e = Math.abs(d - t); if (e < dist) { dist = e; best = d; } }
      if (best - secStarts[secStarts.length - 1] > 4) secStarts.push(best);
    });
    // Громкость каждой части относительно самой громкой — «припев громче куплета»
    const secEnergy = secStarts.map((s, i) => {
      const a = Math.floor(s * fps), b = Math.floor((secStarts[i + 1] || buffer.duration) * fps);
      let sum = 0;
      for (let k = a; k < b && k < n; k++) sum += rms[k];
      return sum / Math.max(1, b - a);
    });
    const eMax = Math.max.apply(null, secEnergy) || 1;

    // Энергия трека: громкость, усреднённая по ±3 с — «где поднимается».
    // Плавная, без ступенек на границах частей; 1 = самый громкий участок.
    const energy = new Float32Array(n), ew = Math.round(fps * 3);
    {
      let run = 0, lo = 0, hi = -1;
      for (let i = 0; i < n; i++) {
        while (hi < Math.min(n - 1, i + ew)) run += rms[++hi];
        while (lo < i - ew) run -= rms[lo++];
        energy[i] = run / (hi - lo + 1);
      }
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, energy[i]);
      for (let i = 0; i < n; i++) energy[i] /= mx || 1;
    }

    const bpm = beats.length > 8
      ? 60 * (beats.length - 1) / (beats[beats.length - 1] - beats[0])
      : 60 * fps / period;

    const map = {
      duration: buffer.duration, fps: fps, bpm: Math.round(bpm * 10) / 10,
      // Огибающие — то, что «дышит»: быстрая атака, спад 150–250 мс
      bass: envelope(bass, fps, 0.18), mid: envelope(mid, fps, 0.15),
      high: envelope(high, fps, 0.10), rms: envelope(rms, fps, 0.25),
      onsets: onsets, kicks: kicks,
      beats: beats, downbeats: downbeats, beatPhase: phase,
      sections: Float32Array.from(secStarts),
      energy: energy,
      density: onsets.times.length / Math.max(1, buffer.duration),   // ударов в секунду
      sectionEnergy: Float32Array.from(secEnergy, e => e / eMax),
      ms: Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t0),
      _out: {},
    };
    return map;
  }

  /* ══════════════════════════════════════════════
     Запросы по времени
  ══════════════════════════════════════════════ */
  // Индекс последнего события ≤ t (или −1)
  function lastIdx(times, t) {
    let lo = 0, hi = times.length - 1, r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (times[m] <= t) { r = m; lo = m + 1; } else hi = m - 1;
    }
    return r;
  }

  function sample(arr, fps, t) {
    const x = t * fps, i = Math.floor(x);
    if (i < 0) return arr[0] || 0;
    if (i >= arr.length - 1) return arr[arr.length - 1] || 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  // Импульс 1 → 0 после события: exp-спад с постоянной decay (сек)
  function pulse(dt, decay) { return dt < 0 ? 0 : Math.exp(-dt / decay); }

  /* Один объект на карту: кадр читает его и не мусорит в GC.
     Поля:
       bass mid high rms         0..1 огибающие
       onset kick                импульс удара × сила
       beat downbeat             импульс доли / сильной доли
       beatPhase barPhase        0..1 положение внутри доли / такта
       beatIndex bar             номер доли / такта (−1 до первого)
       section sectionPhase      номер части, 0..1 внутри неё
       sectionPulse              импульс смены части (спад ~1 с)
       sectionEnergy             громкость части 0..1 (1 — самая громкая)
       energy                    плавная энергия (±3 с), 0..1
       bpm                                                            */
  function query(map, t) {
    const o = map._out;
    o.t = t; o.bpm = map.bpm;
    o.bass = sample(map.bass, map.fps, t);
    o.mid  = sample(map.mid,  map.fps, t);
    o.high = sample(map.high, map.fps, t);
    o.rms  = sample(map.rms,  map.fps, t);
    o.energy = sample(map.energy, map.fps, t);

    let i = lastIdx(map.onsets.times, t);
    o.onset = i < 0 ? 0 : map.onsets.strength[i] * pulse(t - map.onsets.times[i], 0.15);
    i = lastIdx(map.kicks.times, t);
    o.kick = i < 0 ? 0 : map.kicks.strength[i] * pulse(t - map.kicks.times[i], 0.12);

    const B = map.beats, bi = lastIdx(B, t);
    const per = 60 / (map.bpm || 120);
    o.beatIndex = bi;
    o.beat = bi < 0 ? 0 : pulse(t - B[bi], per * 0.25);
    o.beatPhase = bi < 0 ? 0 : Math.min(1, (t - B[bi]) / ((B[bi + 1] || B[bi] + per) - B[bi]));

    const D = map.downbeats, di = lastIdx(D, t);
    o.bar = di;
    o.downbeat = di < 0 ? 0 : pulse(t - D[di], per * 0.5);
    o.barPhase = di < 0 ? 0 : Math.min(1, (t - D[di]) / ((D[di + 1] || D[di] + per * 4) - D[di]));

    const S = map.sections, si = Math.max(0, lastIdx(S, t));
    const sEnd = S[si + 1] || map.duration;
    o.section = si;
    o.sectionPhase = Math.min(1, Math.max(0, (t - S[si]) / (sEnd - S[si] || 1)));
    o.sectionPulse = si === 0 ? 0 : pulse(t - S[si], 1.0);
    o.sectionEnergy = map.sectionEnergy[si];
    return o;
  }

  /* ══════════════════════════════════════════════
     Кеш: карта живёт, пока жив буфер
  ══════════════════════════════════════════════ */
  const cache = new WeakMap();
  const pending = new WeakSet();

  function get(buffer) {
    if (!buffer) return null;
    let m = cache.get(buffer);
    if (!m) {
      m = analyze(buffer);
      cache.set(buffer, m);
      console.log('[AudioAnalysis] ' + m.bpm + ' BPM · долей ' + m.beats.length +
        ' · ударов ' + m.onsets.times.length + ' · бочка ' + m.kicks.times.length +
        ' · частей ' + m.sections.length + ' · ' + m.ms + ' мс');
    }
    return m;
  }

  // Отложенно, чтобы статус «загружено» успел отрисоваться
  function prepare(buffer) {
    if (!buffer || cache.has(buffer) || pending.has(buffer)) return;
    pending.add(buffer);
    setTimeout(function () {
      try { get(buffer); } catch (e) { console.warn('[AudioAnalysis] сбой анализа', e); }
      pending.delete(buffer);
    }, 50);
  }

  // В реальном времени — только готовая карта, без синхронного расчёта в кадре
  function at(buffer, t) {
    const m = buffer && cache.get(buffer);
    return m ? query(m, t) : null;
  }

  /* ══════════════════════════════════════════════
     Отладочный оверлей: окно ±4 с вокруг t
  ══════════════════════════════════════════════ */
  let debugOn = false;
  try { debugOn = localStorage.getItem('ricole.beatDebug') === '1'; } catch (e) { /* нет хранилища */ }

  function setDebug(v) {
    debugOn = !!v;
    try { localStorage.setItem('ricole.beatDebug', debugOn ? '1' : '0'); } catch (e) { /* нет хранилища */ }
  }

  function drawDebug(ctx, w, h, buffer, t) {
    if (!debugOn || !ctx) return;
    const m = buffer && cache.get(buffer);
    const H = Math.round(h * 0.26), Y = h - H, SPAN = 8;
    const x = tt => (tt - t + SPAN / 2) / SPAN * w;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, Y, w, H);
    ctx.font = Math.round(H * 0.075) + 'px monospace';
    ctx.textBaseline = 'top';
    if (!m) {
      ctx.fillStyle = '#ccc';
      ctx.fillText(buffer ? 'анализ трека…' : 'нет трека', 10, Y + 8);
      ctx.restore();
      return;
    }
    const t0 = t - SPAN / 2, t1 = t + SPAN / 2;

    // Части
    ctx.fillStyle = 'rgba(255,200,60,0.9)';
    for (const s of m.sections) if (s > t0 && s < t1) ctx.fillRect(x(s) - 2, Y, 4, H);

    // Доли (сильные — ярче и выше)
    for (let k = 0; k < m.beats.length; k++) {
      const b = m.beats[k];
      if (b < t0 || b > t1) continue;
      const down = (k % 4) === m.beatPhase;
      ctx.fillStyle = down ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)';
      ctx.fillRect(x(b) - (down ? 1.5 : 0.5), Y + H * (down ? 0.22 : 0.3), down ? 3 : 1, H);
    }

    // Кривые: бас / середина / верх
    const curve = (arr, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      for (let px = 0; px <= w; px += 3) {
        const v = sample(arr, m.fps, t0 + px / w * SPAN);
        const yy = Y + H - 4 - v * (H * 0.45);
        px ? ctx.lineTo(px, yy) : ctx.moveTo(px, yy);
      }
      ctx.stroke();
    };
    curve(m.high, 'rgba(120,200,255,0.8)');
    curve(m.mid,  'rgba(140,255,140,0.8)');
    curve(m.bass, 'rgba(255,90,90,0.95)');

    // Удары: онсеты сверху, бочка ниже — высота = сила
    const ticks = (ev, color, top) => {
      ctx.fillStyle = color;
      for (let k = 0; k < ev.times.length; k++) {
        const e = ev.times[k];
        if (e < t0 || e > t1) continue;
        ctx.fillRect(x(e) - 1.5, Y + top, 3, ev.strength[k] * H * 0.14 + 2);
      }
    };
    ticks(m.onsets, 'rgba(255,255,255,0.95)', H * 0.24);
    ticks(m.kicks,  'rgba(255,60,60,1)',      H * 0.38);

    // Плейхед
    ctx.fillStyle = '#ff3';
    ctx.fillRect(w / 2 - 1, Y, 2, H);

    // Текущие значения: импульсы как полоски справа
    const q = query(m, t);
    const bars = [['beat', q.beat], ['down', q.downbeat], ['onset', q.onset], ['kick', q.kick], ['sect', q.sectionPulse]];
    const bw = w * 0.07, bh = H * 0.07;
    bars.forEach(([name, v], k) => {
      const yy = Y + 6 + k * (bh + 3), xx = w - bw - 10;
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(xx, yy, bw, bh);
      ctx.fillStyle = '#ff3'; ctx.fillRect(xx, yy, bw * v, bh);
      ctx.fillStyle = '#ddd'; ctx.textAlign = 'right'; ctx.fillText(name, xx - 6, yy);
      ctx.textAlign = 'left';
    });

    ctx.fillStyle = '#fff';
    ctx.fillText(m.bpm + ' BPM   доля ' + (q.beatIndex + 1) + '   такт ' + (q.bar + 1) +
      '   часть ' + (q.section + 1) + '/' + m.sections.length +
      ' (громк. ' + Math.round(q.sectionEnergy * 100) + '%)', 10, Y + 8);
    ctx.fillStyle = '#aaa';
    ctx.fillText('красн — бас/бочка · зел — середина · син — верх · бел — удары · жёлт — части · Shift+B', 10, Y + 8 + H * 0.11);
    ctx.restore();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', function (e) {
      if (!e.shiftKey || e.code !== 'KeyB') return;
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      setDebug(!debugOn);
    });
  }

  return {
    analyze: analyze, get: get, prepare: prepare, at: at, query: query,
    drawDebug: drawDebug, setDebug: setDebug,
    get debug() { return debugOn; },
  };
})();

if (typeof module !== 'undefined') module.exports = AudioAnalysis;
