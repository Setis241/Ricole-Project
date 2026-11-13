/* ══════════════════════════════════════════════════════════════
   AutoDirector — авто-режиссёр.

   Читает декодированный аудиобуфер и текущую лирику, и сам
   решает как должно выглядеть видео:

     1. АУДИО   — BPM, сетка битов, энергия по полосам,
                  кривая новизны → границы секций.
     2. ЛИРИКА  — слоги, длительность строки, плотность
                  (слогов/сек), нормализация и поиск повторов
                  → кандидаты в припев.
     3. СТРУКТУРА — совмещение границ аудио и лирики,
                  разметка intro / verse / prechorus / chorus /
                  bridge / break / outro.
     4. ПАРТИТУРА — выбирается базовый стиль (FactoryPresets)
                  под темп и энергию трека, а поверх в LRC
                  дописываются per-line теги {LSIZE}{LANIM}{LPOS}
                  {LCOLOR} и команды камеры/фона на границах.

   Ничего не рендерит сам: результат — новый текст лирики,
   который понимает существующий LRCParser.
══════════════════════════════════════════════════════════════ */
const AutoDirector = (function() {
  'use strict';

  /* ══════════════════════════════════════════════
     FFT (итеративный radix-2, in-place)
  ══════════════════════════════════════════════ */
  function _fft(re, im) {
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
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k],        ui = im[i + k];
          const vr = re[i + k + len/2] * cr - im[i + k + len/2] * ci;
          const vi = re[i + k + len/2] * ci + im[i + k + len/2] * cr;
          re[i + k] = ur + vr;  im[i + k] = ui + vi;
          re[i + k + len/2] = ur - vr;  im[i + k + len/2] = ui - vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;  cr = ncr;
        }
      }
    }
  }

  /* ══════════════════════════════════════════════
     1. АНАЛИЗ АУДИО
  ══════════════════════════════════════════════ */
  const WIN = 1024;
  const HOP = 512;

  function analyzeAudio(buffer) {
    const sr  = buffer.sampleRate;
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    const N   = ch0.length;

    // Моно-даунмикс
    const mono = new Float32Array(N);
    for (let i = 0; i < N; i++) mono[i] = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];

    // Окно Ханна
    const win = new Float32Array(WIN);
    for (let i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN);

    const frameCount = Math.max(1, Math.floor((N - WIN) / HOP));
    const fps        = sr / HOP;               // ~86 кадров/сек
    const bins       = WIN / 2;
    const hzPerBin   = sr / WIN;

    const idx = function(hz) { return Math.min(bins - 1, Math.max(0, Math.round(hz / hzPerBin))); };
    const LO = [idx(20),   idx(160)];
    const MD = [idx(160),  idx(2000)];
    const HI = [idx(2000), idx(8000)];

    const low  = new Float32Array(frameCount);
    const mid  = new Float32Array(frameCount);
    const high = new Float32Array(frameCount);
    const rms  = new Float32Array(frameCount);
    const flux = new Float32Array(frameCount);

    const re = new Float32Array(WIN), im = new Float32Array(WIN);
    let prevMag = new Float32Array(bins);
    const mag   = new Float32Array(bins);

    for (let f = 0; f < frameCount; f++) {
      const off = f * HOP;
      let sum2 = 0;
      for (let i = 0; i < WIN; i++) {
        const s = mono[off + i];
        re[i] = s * win[i];
        im[i] = 0;
        sum2 += s * s;
      }
      rms[f] = Math.sqrt(sum2 / WIN);

      _fft(re, im);

      let l = 0, m = 0, h = 0, fl = 0;
      for (let b = 0; b < bins; b++) {
        const v = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        mag[b] = v;
        const d = v - prevMag[b];
        if (d > 0) fl += d;
        if (b >= LO[0] && b < LO[1]) l += v;
        else if (b >= MD[0] && b < MD[1]) m += v;
        else if (b >= HI[0] && b < HI[1]) h += v;
      }
      low[f] = l; mid[f] = m; high[f] = h; flux[f] = fl;
      const tmp = prevMag; prevMag = mag.slice(); void tmp;
    }

    const tempo      = _detectTempo(flux, fps);
    const boundaries = _detectBoundaries(low, mid, high, fps, buffer.duration);

    return {
      sampleRate: sr,
      duration:   buffer.duration,
      fps:        fps,
      bpm:        tempo.bpm,
      bpmConfidence: tempo.confidence,
      beatOffset: tempo.offset,
      frames:     { low: low, mid: mid, high: high, rms: rms, flux: flux },
      boundaries: boundaries,
      // Энергия 0..1 в произвольном интервале времени
      energyAt: function(t0, t1) { return _meanNorm(rms, fps, t0, t1); },
      bassAt:   function(t0, t1) { return _meanNorm(low, fps, t0, t1); },
      brightAt: function(t0, t1) { return _meanNorm(high, fps, t0, t1); },
    };
  }

  function _meanNorm(arr, fps, t0, t1) {
    const a = Math.max(0, Math.floor(t0 * fps));
    const b = Math.min(arr.length, Math.ceil(t1 * fps));
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) s += arr[i];
    const local = s / (b - a);
    let g = 0;
    for (let i = 0; i < arr.length; i++) g += arr[i];
    const global = g / arr.length || 1;
    // 1.0 = средний уровень трека; клампим в 0..2 и жмём в 0..1
    return Math.max(0, Math.min(1, (local / global) / 2));
  }

  /* ── Темп: автокорреляция огибающей онсетов ── */
  function _detectTempo(flux, fps) {
    const n = flux.length;
    if (n < fps * 4) return { bpm: 0, confidence: 0, offset: 0 };

    // Убираем медленный тренд (скользящее среднее ~0.4 с)
    const w = Math.max(1, Math.round(fps * 0.4));
    const env = new Float32Array(n);
    let run = 0;
    for (let i = 0; i < n; i++) {
      run += flux[i];
      if (i >= w) run -= flux[i - w];
      env[i] = Math.max(0, flux[i] - run / Math.min(i + 1, w));
    }

    const minLag = Math.round(fps * 60 / 190);   // 190 BPM
    const maxLag = Math.round(fps * 60 / 60);    //  60 BPM
    let bestLag = 0, bestScore = -1, total = 0;
    const scores = [];

    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
      s /= (n - lag);
      // Лёгкое предпочтение «человеческому» диапазону 90–140 BPM
      const bpm = 60 * fps / lag;
      s *= 1 + 0.18 * Math.exp(-Math.pow((bpm - 115) / 45, 2));
      scores.push(s); total += s;
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }

    const mean = total / scores.length || 1;
    const confidence = Math.max(0, Math.min(1, (bestScore / mean - 1) / 1.5));

    // Фаза: где импульсная гребёнка с этим периодом даёт максимум
    let bestPhase = 0, bestSum = -1;
    for (let p = 0; p < bestLag; p++) {
      let s = 0;
      for (let i = p; i < n; i += bestLag) s += env[i];
      if (s > bestSum) { bestSum = s; bestPhase = p; }
    }

    let bpm = 60 * fps / bestLag;
    // Нормализация октавы темпа в 70–160
    while (bpm < 70)  bpm *= 2;
    while (bpm > 160) bpm /= 2;

    return { bpm: Math.round(bpm * 10) / 10, confidence: confidence, offset: bestPhase / fps };
  }

  /* ── Границы секций: новизна по тембровому профилю ── */
  function _detectBoundaries(low, mid, high, fps, duration) {
    const step = Math.max(1, Math.round(fps));          // блок = 1 сек
    const blocks = Math.floor(low.length / step);
    if (blocks < 8) return [];

    const prof = [];
    for (let b = 0; b < blocks; b++) {
      let l = 0, m = 0, h = 0;
      for (let i = b * step; i < (b + 1) * step; i++) { l += low[i]; m += mid[i]; h += high[i]; }
      const sum = l + m + h || 1;
      prof.push([l / sum, m / sum, h / sum, Math.log10(1 + sum / step)]);
    }

    // Новизна: расстояние между средним профилем слева и справа (окно 8 с)
    const W = 8;
    const nov = new Float32Array(blocks);
    for (let b = W; b < blocks - W; b++) {
      const a = [0,0,0,0], c = [0,0,0,0];
      for (let k = 1; k <= W; k++)
        for (let d = 0; d < 4; d++) { a[d] += prof[b - k][d]; c[d] += prof[b + k][d]; }
      let s = 0;
      for (let d = 0; d < 4; d++) { const diff = (a[d] - c[d]) / W; s += diff * diff; }
      nov[b] = Math.sqrt(s);
    }

    // Пики новизны с минимальным расстоянием 12 с
    let mean = 0;
    for (let i = 0; i < blocks; i++) mean += nov[i];
    mean /= blocks || 1;
    let sd = 0;
    for (let i = 0; i < blocks; i++) sd += Math.pow(nov[i] - mean, 2);
    sd = Math.sqrt(sd / (blocks || 1));

    const thr = mean + sd * 0.7;
    const picks = [];
    for (let b = W; b < blocks - W; b++) {
      if (nov[b] < thr) continue;
      if (nov[b] < nov[b - 1] || nov[b] < nov[b + 1]) continue;
      if (picks.length && b - picks[picks.length - 1] < 12) {
        if (nov[b] > nov[picks[picks.length - 1]]) picks[picks.length - 1] = b;
        continue;
      }
      picks.push(b);
    }
    return picks.map(function(b) { return Math.min(duration, b); });
  }

  /* ══════════════════════════════════════════════
     2. АНАЛИЗ ЛИРИКИ
  ══════════════════════════════════════════════ */
  const VOWELS_RU = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';
  const VOWELS_EN = 'aeiouyAEIOUY';

  function countSyllables(text) {
    if (!text) return 0;
    let n = 0, prevVowel = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const isRu = VOWELS_RU.indexOf(c) !== -1;
      const isEn = VOWELS_EN.indexOf(c) !== -1;
      const isVowel = isRu || isEn;
      // В кириллице каждая гласная — слог; в латинице группы гласных считаем за одну
      if (isRu) { n++; prevVowel = true; }
      else if (isEn) { if (!prevVowel) n++; prevVowel = true; }
      else prevVowel = false;
      void isVowel;
    }
    return n;
  }

  function _normalize(text) {
    return (text || '').toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function analyzeLyrics(entries, duration) {
    const lines = entries
      .map(function(e, i) {
        const next = entries[i + 1];
        // Строка не висит вечно: максимум 6 с, дальше — инструментальная пауза.
        const end  = next ? Math.min(next.time, e.time + 6)
                          : Math.min(duration || e.time + 4, e.time + 6);
        const syl  = countSyllables(e.text);
        const dur  = Math.max(0.2, end - e.time);
        return {
          index: i, time: e.time, end: end, dur: dur,
          text: e.text, entry: e,
          syllables: syl,
          density: syl / dur,          // слогов в секунду
          words: (e.text || '').split(/\s+/).filter(Boolean).length,
          norm: _normalize(e.text),
          repeats: 1,
          isEmpty: !e.text,
        };
      });

    // Повторы (точные + по 4-словному префиксу — ловит вариации припева)
    const exact = {}, prefix = {};
    lines.forEach(function(l) {
      if (!l.norm) return;
      exact[l.norm] = (exact[l.norm] || 0) + 1;
      const p = l.norm.split(' ').slice(0, 4).join(' ');
      if (p) prefix[p] = (prefix[p] || 0) + 1;
    });
    lines.forEach(function(l) {
      if (!l.norm) { l.repeats = 0; return; }
      const p = l.norm.split(' ').slice(0, 4).join(' ');
      l.repeats = Math.max(exact[l.norm] || 1, prefix[p] || 1);
    });

    // Инструментальные паузы между строками
    const gaps = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const g = lines[i + 1].time - lines[i].end;
      if (g > 4) gaps.push({ start: lines[i].end, end: lines[i + 1].time, after: i });
    }

    const syls = lines.filter(function(l) { return l.syllables > 0; });
    const avgSyl = syls.length ? syls.reduce(function(a, l) { return a + l.syllables; }, 0) / syls.length : 0;
    const avgDen = syls.length ? syls.reduce(function(a, l) { return a + l.density; }, 0) / syls.length : 0;

    return {
      lines: lines,
      gaps: gaps,
      avgSyllables: avgSyl,     // «размер» строки
      avgDensity:   avgDen,     // темп подачи текста
      maxRepeats:   lines.reduce(function(a, l) { return Math.max(a, l.repeats); }, 0),
    };
  }

  /* ══════════════════════════════════════════════
     2b. АНАЛИЗ ФОНА — синергия текста с картинкой
     Цвет текста и акцент выводятся из самой картинки,
     а не берутся из фиксированной палитры стиля.
  ══════════════════════════════════════════════ */
  function analyzeBackground() {
    const media = (typeof BackgroundEngine !== 'undefined') ? BackgroundEngine.mediaElement : null;
    if (!media || typeof document === 'undefined' || !document.createElement) return null;

    let data;
    try {
      const S = 64;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const c = cv.getContext('2d');
      if (!c) return null;
      c.drawImage(media, 0, 0, S, S);
      data = c.getImageData(0, 0, S, S).data;
    } catch (e) {
      console.warn('[AutoDirector] фон не читается', e);
      return null;
    }

    let sumL = 0, sumL2 = 0, n = 0;
    let hx = 0, hy = 0, sumS = 0;
    // Центральная полоса — там, где реально лежит текст
    let midL = 0, midN = 0;

    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sumL += L; sumL2 += L * L; n++;
        if (y >= 20 && y < 48) { midL += L; midN++; }

        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (d > 0.04) {
          let h;
          if (mx === r)      h = ((g - b) / d + 6) % 6;
          else if (mx === g) h = (b - r) / d + 2;
          else               h = (r - g) / d + 4;
          h *= 60;
          const sat = mx === 0 ? 0 : d / mx;
          hx += Math.cos(h * Math.PI / 180) * sat;
          hy += Math.sin(h * Math.PI / 180) * sat;
          sumS += sat;
        }
      }
    }

    const luma    = sumL / n;
    const variance = Math.max(0, sumL2 / n - luma * luma);
    const hue     = (Math.atan2(hy, hx) * 180 / Math.PI + 360) % 360;
    const sat     = sumS / n;

    return {
      luma:      luma,                       // 0..1 общая яркость
      centerLuma: midN ? midL / midN : luma, // яркость там, где текст
      hue:       hue,                        // доминирующий тон
      saturation: sat,
      busy:      Math.sqrt(variance),        // разброс яркости = «пестрота»
      /* Акцент — ФИКСИРОВАННЫЙ, от фона не считается.
         Была формула (hue + 180) при насыщенности 0.85: «комплемент
         гарантированно не сливается». Не сливаться — половина задачи, и
         решалась она ценой второй. Комплемент слеп к тому, что он выдаёт:
         на бирюзовом кадре это розовый, на бирюзово-золотом — ядовитая
         зелень. Кадр меняется, формула не думает, и в набор каждый раз
         влетает цвет, которого в картинке нет и который к ней никак не
         относится.
         Акцент берётся из того же семейства, что и сам набор: дуотон уводит
         белую букву в #3a2f52, и акцент — это тот же фиолетовый, поднятый
         в светлоту. Строка выделяется, но остаётся частью одного набора, а
         не заплаткой поверх него. */
      accent:    luma > 0.62 ? '#4a3a72' : '#c3b0f0',
      // Основной текст: на тёмном фоне белый, на светлом — почти чёрный
      textColor: luma > 0.62 ? '#12100c' : '#ffffff',
    };
  }

  function _hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = function(k) {
      const kk = (k + h / 30) % 12;
      const v = l - a * Math.max(-1, Math.min(Math.min(kk - 3, 9 - kk), 1));
      return Math.round(255 * v).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  /* ══════════════════════════════════════════════
     3. СТРУКТУРА ПРОИЗВЕДЕНИЯ
  ══════════════════════════════════════════════ */
  /* Метка секции → тип. Пишут их и по-русски (редактор), и по-английски
     (готовые .lrc из сети), с номером и без: «Куплет 2», «Chorus», «Solo». */
  const LABEL_TYPE = [
    [/^(интро|вступлен|intro)/i,                       'intro'],
    [/^(предприпев|пред-?припев|pre-?\s*chorus|pre)/i,  'prechorus'],
    [/^(припев|chorus|hook|refrain)/i,                  'chorus'],
    [/^(куплет|верс|verse)/i,                           'verse'],
    [/^(бридж|bridge|мост)/i,                           'bridge'],
    [/^(инструментал|инструм|instrumental|solo|соло)/i, 'instrumental'],
    [/^(проигрыш|пауза|break|interlude)/i,              'break'],
    [/^(концовк|аутро|outro|ending|финал)/i,            'outro'],
  ];
  function _typeOfLabel(label) {
    if (!label) return null;
    const s = String(label).trim();
    for (let i = 0; i < LABEL_TYPE.length; i++) {
      if (LABEL_TYPE[i][0].test(s)) return LABEL_TYPE[i][1];
    }
    return null;
  }

  function buildStructure(audio, lyr) {
    const duration = audio ? audio.duration : (lyr.lines.length ? lyr.lines[lyr.lines.length - 1].end : 0);
    const lines = lyr.lines;
    if (!lines.length) return [];

    /* ── РУЧНАЯ РАЗМЕТКА ГЛАВНЕЕ АВТОМАТИЧЕСКОЙ ────────────
       Метки [Припев] / [Инструментал] редактор писал в текст, парсер их
       исправно доставал в entry.section — и здесь они НЕ ЧИТАЛИСЬ ни разу.
       Структуру целиком угадывали повторы строк и энергия, поэтому
       поставленная руками метка не меняла в клипе ничего: пользователь
       размечал песню, а режиссёр играл по-своему.
       Теперь при наличии меток границы и типы берутся из них, а из аудио
       остаются только метрики (энергия, бас, яркость). Автоопределение
       работает как раньше — но лишь там, где меток нет. */
    const marks = [];
    lines.forEach(function(l) {
      const t = _typeOfLabel(l.entry && l.entry.section);
      if (t) marks.push({ time: l.time, type: t });
    });
    const manual = marks.length >= 2;

    // Кандидаты границ: пики новизны из аудио + длинные паузы в лирике +
    // переходы между повторяющимся и неповторяющимся текстом.
    // Последнее работает даже без аудио: припев — это то, что повторяется.
    let cuts = [];
    if (manual) cuts = marks.map(function(m) { return m.time; });
    if (!manual && audio) cuts = cuts.concat(audio.boundaries);
    if (!manual) {
      lyr.gaps.forEach(function(g) { cuts.push(g.end); });
      cuts.push(lines[0].time);
    }

    /* ГРАНИЦЫ ПРОИГРЫША. Подряд идущие строки БЕЗ слов (служебные метки,
       пустые такты) — это отдельный эпизод, инструментал. Без этих засечек
       он не появлялся вовсе: границы брались только из аудио и из пауз
       между спетыми строками, поэтому бессловесный кусок просто прилипал к
       соседнему припеву, и вся секция считалась спетой. */
    if (!manual) for (let i = 0; i < lines.length; i++) {
      const has     = !!lines[i].text;
      const prevHas = i ? !!lines[i - 1].text : true;
      if (has !== prevHas) cuts.push(lines[i].time);
    }

    const repeatThr0 = Math.max(2, lyr.maxRepeats * 0.35);
    const sung = lines.filter(function(l) { return !!l.text; });
    const flags = sung.map(function(l) { return l.repeats >= repeatThr0; });
    // Морфологическое замыкание: одиночная неповторяющаяся строка внутри
    // припева («не отпускай» между четырьмя «гори со мной») не должна рвать
    // секцию, но сами повторяющиеся строки границу не теряют.
    const sm = flags.map(function(v, i) {
      if (v) return true;
      return i > 0 && i < flags.length - 1 && flags[i - 1] && flags[i + 1];
    });
    for (let i = 1; i < sung.length; i++) {
      if (sm[i] !== sm[i - 1]) cuts.push(sung[i].time);
    }

    // Границу притягиваем к началу ближайшей строки (в пределах 3 с)
    cuts = cuts.map(function(t) {
      let best = null, bd = 3.0;
      lines.forEach(function(l) {
        const d = Math.abs(l.time - t);
        if (d < bd) { bd = d; best = l.time; }
      });
      return best !== null ? best : t;
    });

    cuts = cuts.filter(function(t, i, a) { return a.indexOf(t) === i; }).sort(function(a, b) { return a - b; });
    /* Слишком частые границы убираем (секция минимум 8 с) — но ТОЛЬКО в
       автоматическом режиме. Размеченную руками границу этот фильтр молча
       съедал: короткий предприпев на шесть секунд перед припевом склеивался
       с ним в одну секцию, и метка [Припев] пропадала вместе со своим
       типом. Пользователь разметил — значит там граница. */
    if (!manual) cuts = cuts.reduce(function(acc, t) {
      if (!acc.length || t - acc[acc.length - 1] >= 8) acc.push(t);
      return acc;
    }, []);

    /* ── ТИП СЕКЦИИ ИЗ МЕТКИ ──────────────────────────────
       Здесь была дыра, из-за которой ручная разметка не работала вовсе.
       Метки давали ГРАНИЦЫ (cuts выше) — и на этом всё: секция создавалась с
       type:null и уходила в автоопределение, которое размечает по повторам
       и энергии. То есть [Вступление], [Припев], [Соло] и [Концовка]
       превращались в «куплет, куплет, куплет, куплет», а вместе с типом
       терялась ВСЯ режиссура секции: манера набора, камера, мизансцена,
       полосы. Отсюда и одинаковые на вид вступление, куплет и концовка —
       они и были одним и тем же типом.
       Теперь тип берётся с метки, стоящей на начале секции. */
    const typeAt = {};
    marks.forEach(function(m) { typeAt[m.time] = m.type; });

    // Собираем секции
    const sections = [];
    if (lines[0].time > 3) sections.push({ start: 0, end: lines[0].time, lines: [], type: 'intro' });

    for (let i = 0; i < cuts.length; i++) {
      const start = cuts[i];
      const end   = (i + 1 < cuts.length) ? cuts[i + 1] : duration;
      const secLines = lines.filter(function(l) { return l.time >= start - 0.01 && l.time < end; });
      /* ВОТ ЗДЕСЬ ТЕРЯЛОСЬ ВСТУПЛЕНИЕ.
         Секции короче двух секунд отбрасывались целиком, а их строки
         доставались следующей секции. Ровно так и устроено большинство
         разметок: [Вступление] стоит на 00:00, первая строка куплета — на
         00:01, то есть вступление живёт секунду. Оно выбрасывалось, строка
         «1%» уезжала в куплет и получала куплетную режиссуру — поэтому
         никакие правки вступления в кадре не появлялись вообще.
         Порог оставлен только для автоматических границ (там двухсекундный
         огрызок — артефакт поиска склеек). Размеченная руками секция, в
         которой есть хотя бы одна строка, живёт всегда. */
      if (end - start < 2 && !(manual && secLines.length)) continue;
      sections.push({
        start: start, end: end, lines: secLines,
        type: manual ? (typeAt[start] || null) : null,
      });
    }

    // Метрики секции
    sections.forEach(function(s) {
      s.energy  = audio ? audio.energyAt(s.start, s.end) : 0.5;
      s.bass    = audio ? audio.bassAt(s.start, s.end)   : 0.5;
      s.bright  = audio ? audio.brightAt(s.start, s.end) : 0.5;
      s.repeats = s.lines.length
        ? s.lines.reduce(function(a, l) { return a + l.repeats; }, 0) / s.lines.length : 0;
      s.density = s.lines.length
        ? s.lines.reduce(function(a, l) { return a + l.density; }, 0) / s.lines.length : 0;
      s.hasText = s.lines.some(function(l) { return !!l.text; });
    });

    // Разметка типов
    const energies = sections.map(function(s) { return s.energy; }).sort(function(a, b) { return a - b; });
    const medEnergy = energies[Math.floor(energies.length / 2)] || 0.5;
    const repeatThr = Math.max(2, lyr.maxRepeats * 0.35);

    let chorusSeen = 0;
    sections.forEach(function(s, i) {
      /* Тип, пришедший с метки, не переопределяем ничем: разметка автора
         главнее догадки по повторам. Считаем только припевы — они нужны
         ниже для распознавания бриджа в секциях без метки. */
      if (s.type) { if (s.type === 'chorus') chorusSeen++; return; }
      if (!s.hasText) {
        /* Кусок без слов посреди песни — это не «пауза», а ИНСТРУМЕНТАЛ:
           самостоятельный эпизод со своей режиссурой. Раньше всё бессловесное
           валилось в 'break' — камера cineStill, фигура стоит в центре, фон
           ползёт: то есть на проигрыше в клипе не происходило ровно ничего.
           'break' остаётся только для коротких провалов (<6 с), где эпизод
           ставить не из чего. */
        s.type = (i === sections.length - 1) ? 'outro'
               : (i === 0 ? 'intro'
               : ((s.end - s.start >= 8) ? 'instrumental' : 'break'));
        return;
      }
      if (s.repeats >= repeatThr && s.energy >= medEnergy * 0.9) { s.type = 'chorus'; chorusSeen++; return; }
      if (s.repeats >= repeatThr) { s.type = 'chorus'; chorusSeen++; return; }
      if (chorusSeen >= 2 && s.energy < medEnergy && s.repeats < 1.5) { s.type = 'bridge'; return; }
      s.type = 'verse';
    });

    /* Куплет прямо перед припевом с растущей энергией → предприпев.
       Только при наличии аудио: без него энергия неизвестна и гадать нельзя.
       И только без ручной разметки: если автор написал [Куплет 2], то это
       куплет, даже если энергия перед припевом растёт. */
    if (audio && !manual) sections.forEach(function(s, i) {
      const nxt = sections[i + 1];
      if (s.type === 'verse' && nxt && nxt.type === 'chorus' &&
          s.energy > medEnergy * 1.02 && s.end - s.start < 20) s.type = 'prechorus';
    });

    /* Метка [Инструментал] на одну-две секунды — это отбивка, а не эпизод.
       Проигрыш ставится как номер: удар камерой, шоты, фигура крупно
       (см. planStage / planCamera). На секунде из этого получается рывок
       кадра и мгновенный отскок назад — то есть брак, а не режиссура.
       Такую метку отдаём в 'break': короткий провал, кадр стоит. */
    sections.forEach(function(s) {
      if (s.type === 'instrumental' && s.end - s.start < 4) s.type = 'break';
    });

    /* Хвостовые доводки — только там, где типы угаданы. Размеченный руками
       финальный [Соло] обязан остаться соло, а не стать концовкой. */
    if (!manual && sections.length &&
        (sections[sections.length - 1].type === 'break' ||
         sections[sections.length - 1].type === 'instrumental'))
      sections[sections.length - 1].type = 'outro';

    // Короткий финальный кусок после долгой паузы — это концовка, а не куплет.
    const last = sections[sections.length - 1];
    if (!manual && last && last.type === 'verse' && last.end - last.start < 25) {
      const gapBefore = lyr.gaps.some(function(g) {
        return g.end <= last.start + 0.5 && g.end - g.start > 6;
      });
      if (gapBefore) last.type = 'outro';
    }

    return sections;
  }

  /* ══════════════════════════════════════════════
     4. ПАРТИТУРА
  ══════════════════════════════════════════════ */

  /* Базовый стиль под характер трека — берём из FactoryPresets. */
  function pickBaseStyle(audio, lyr) {
    const bpm    = audio ? audio.bpm : 100;
    const energy = audio ? audio.energyAt(0, audio.duration) : 0.5;
    const bright = audio ? audio.brightAt(0, audio.duration) : 0.5;
    const dense  = lyr.avgDensity;

    if (dense > 5.0)                    return 'punch';      // речитатив
    if (bpm >= 140 && energy > 0.45)    return 'neon';
    if (bpm >= 122 && bright > 0.45)    return 'retrowave';
    if (bpm >= 122)                     return 'rock';
    if (bpm <= 85  && energy < 0.42)    return 'lofi';
    if (bpm <= 95  && dense < 2.2)      return 'dream';
    if (energy > 0.55)                  return 'epic';
    return 'trailer';
  }

  /* Анимации по типу секции, с учётом плотности текста:
     чем быстрее подача, тем спокойнее должна быть анимация,
     иначе строку физически не успеть прочитать. */
  /* Куплет и предприпев держатся на ПОСТРОЧНЫХ анимациях: строка едет
     целиком, её можно спокойно прочитать и можно надеть рамку.
     Кинетика (слова разлетаются по кадру) — только там, где она работает
     как акцент: припев и бридж. */
  const WHOLE_LINE = new Set(['pulse', 'bounce', 'shake', 'zoom', 'spin', 'cinematic']);

  /* Партитура анимаций.
     Раньше здесь было восемь режимов из тридцати двух, что есть в движке,
     причём куплет, интро, бридж, брейк и аутро — то есть большая часть
     хронометража — сидели на одном 'cinematic'. Это построчный режим: строка
     едет целиком, слова внутри неподвижны. Вся «режиссура» сводилась к тому,
     что строка появлялась то выше, то ниже — набор субтитров, а не клип.

     Теперь основа — пословная кинетика, а построчные режимы оставлены там,
     где текст надо именно ЧИТАТЬ (брейк, длинные спокойные куплеты).

     Значение — либо режим, либо пара: тогда соседние строки чередуются и
     куплет перестаёт быть четырьмя одинаковыми выездами.

     ВАЖНО — чередование идёт ВНУТРИ одного семейства движения:

       сборка   domino, stack, cascade, snap   слова слетаются в строку
       всплеск  impact, nova, shockwave        удар из центра наружу
       волна    ripple, liquid                 бегущая волна по строке
       ход      drift, montage, orbit          мягкое движение камеры

     Смешивать семейства в одной секции нельзя: 'drift' рядом с 'domino' —
     это плавный проезд камеры сразу после падения костяшек, соседние строки
     читаются как куски из разных клипов. Раньше таблица так и была собрана,
     плюс в припев затесался 'shatter' (побуквенный, теряет per-word стили).
     Теперь секция = одно семейство, а разница между строками — в деталях
     движения, а не в его характере. Смена семейства происходит только на
     границе секции, где она и должна читаться как режиссёрский приём.

     Пары ставятся так, чтобы более «собранный» режим приходился на нечётные
     строки: см. mult в buildScore, где они же идут мельче.

     Отбор проверен покадровым прогоном (см. правку рваности в
     physics-and-anim). Не используются:

       drift, montage, orbit   рвут скоростью В СЕРЕДИНЕ движения — это не
                               приём, а дефект: камера идёт по сплайну, и на
                               стыках сегментов ломается производная;
       shatter, cipher         тоже рвут, и вдобавок побуквенные;
       pendulum_wave           слова висят на нитках от верха кадра и качаются
                               каждое со своим периодом — строка расползается
                               по высоте и читается лианой, а не текстом;
       ripple, liquid          плавные, но ПОБУКВЕННЫЕ: строка из 8 слов даёт
                               37 элементов вместо 8, и каждый проходит через
                               полную отрисовку с обводкой. Раньше стояли в
                               бридже — отсюда и были тормоза.

     Резкость на приземлении (stack, domino, impact, snap) — это замысел,
     удар в конце падения, а не рваность. */
  const ANIM = {
    /* ВСТУПЛЕНИЕ — единственная секция со СВОИМИ манерами, не
       встречающимися больше нигде.
       Здесь стояли parallax/cascade/snap — ровно то же, чем идут концовка и
       половина куплетов. То есть первые секунды клипа ничем не объявляли,
       что клип начался: та же строка, приехавшая тем же способом. Начало
       обязано отличаться от середины, иначе его нет.
       Вступление — это ТИТР, а не куплет.
       Следующей попыткой были tracking/stack (и poster на коротких
       строках) — и титра всё равно не вышло: в кадре стояла строка одним
       кеглем посреди пустого кадра. Разрядка и крупный кегль делали её
       аккуратнее, но не оформленнее: ни сетки, ни иерархии, ни одного
       элемента, кроме самих букв.
       'title' верстает строку заглавной карточкой: слово-герой во всю
       меру, остальная фраза мелкими прописными в разрядку над ним и под
       ним, волосяные линейки, из-за которых набор выходит (см.
       AnimModes.title). Манера одна на все регистры — вступление обязано
       узнаваться всегда, а разницу между строками даёт сам текст: где
       стоит герой и сколько подписи вокруг него. */
    intro:     { calm: 'title', normal: 'title', fast: 'title' },
    // сборка — куплет надо читать. 'domino' стоял здесь в normal/fast —
    // слово в буквальном смысле ПЕРЕВОРАЧИВАЕТСЯ (стоит вертикально,
    // падает в горизонталь), и на восьми строках куплета эта переворачи-
    // вающаяся типографика идёт по кругу и читается трюком, а не текстом.
    // 'headline' — обычный абзацный набор без поворотов слов: то, что
    // нужно куплету, который несёт историю, а не удар.
    // 'headline'/'stack' держали текст читаемым, но манера у них одна на
    // всех — «слова приезжают на место», и на четырёх куплетах подряд она
    // читается как одна и та же заставка. Здесь набор работает СОБСТВЕННЫМИ
    // приёмами: tracking собирает разрядку, ragged набирает флагом влево
    // лесенкой, justify выключает абзац по формату. Все три переносят
    // строки сами (см. WRAPPING), то есть держат и длинный куплет.
    /* Плакат, а не набор. tracking/ragged/justify держат ТИПОГРАФИКУ, но у
       всех троих слова одного кегля стоят ровным блоком — то есть с двух
       шагов это по-прежнему субтитр, просто аккуратный. Композиция
       начинается там, где внутри строки есть ИЕРАРХИЯ: слово-герой во всю
       полосу и на обрез (poster). Один «спокойный» режим в паре оставлен
       нарочно — подряд четыре плаката читаются как реклама, а не как
       куплет. */
    /* По ТРИ манеры на регистр, а не по две: список перебирается по
       секциям, и на паре куплет №3 повторял куплет №1 — то есть период
       чередования совпадал с периодом песни и разнообразие съедалось.
       Внутри самой манеры раскладка ещё раз варьируется по тексту строки
       (см. _variantOf), поэтому соседние строки одной секции тоже не
       выглядят копиями друг друга. */
    /* ОБОЕВ В КУПЛЕТЕ НЕТ.
       Здесь стояли backdrop и echo — манеры, кроющие ВЕСЬ кадр повторами
       фразы, да ещё и требующие полосы-плашки под читаемую строку, иначе
       она теряется среди собственных дублей. Куплет занимает бо́льшую часть
       хронометража, значит бо́льшую часть клипа фон был закрыт текстурой из
       того же самого текста, а поперёк кадра лежал чёрный прямоугольник.
       Обе сняты с производства (см. AnimModes.backdrop/echo).
       Остаётся чистая типографика: флаг влево (ragged), выключка по формату
       (justify) и слово-герой на обрез (poster). 'tracking' отдан
       концовке и в куплете не участвует — иначе конец клипа перестанет
       отличаться от его середины. */
    /* Куплет не должен быть «просто строкой». ragged/justify держат
       типографику, но обе только проявляют готовый блок — на трёх куплетах
       подряд это ровный субтитр. Ведёт куплет 'poster': слово-герой во всю
       полосу и на обрез, остальная фраза колонкой рядом — блок собирается
       на глазах и имеет иерархию. Спокойный регистр остаётся набором
       (флаг влево), плотный — ударной сборкой. */
    verse:     { calm:   ['poster', 'ragged'],
                 normal: ['poster', 'justify'],
                 fast:   ['impact', 'poster'] },
    // сборка, но плотнее и жёстче — подводка к припеву
    /* ПОДВОДКА — это СЖАТИЕ, а не «припев потише».
       Здесь в списке стоял 'impact' — та же сборка с ударом, что ведёт
       припев, и на слух пары «предприпев → припев» получалось одно и то же
       движение дважды подряд, только второй раз крупнее. Разницы не читалось
       вообще: обе секции шли по центру, обе со свечением, обе с наездом.
       Удар — слово ПРИПЕВА, и в подводке его быть не должно.
       Подводка набирается вертикально (stack/cascade/domino) — слова
       ложатся друг на друга и копят столбик, кадр тесно́т; припев этот
       столбик разворачивает в горизонтальный плакат. Тогда переход виден
       не по громкости, а по СМЕНЕ ГЕОМЕТРИИ. */
    /* ПОДВОДКА НАБИРАЕТСЯ РОВНО. Никаких лесенок.
       Здесь стояли 'escalator' (каждое следующее слово крупнее и выше
       предыдущего — фраза лезет по диагонали вверх) и 'ratchet' (набор
       стягивается к центру щелчками). Механика в них честная, а в кадре обе
       читаются трюком: слова разного кегля скачут по высоте, строка теряет
       базовую линию, и вместо нарастания получается прыгающий текст. Убраны
       из партитуры обе.
       Нарастание в подводке делают не буквы, а ТРИ ДРУГИЕ ВЕЩИ, и все они
       уже есть: кегль здесь самый мелкий в клипе (SIZE.prechorus 0.86 —
       кадр физически поджимается перед раскрытием), камера идёт наездом с
       разгоном и с ramp по строкам (cineLift, см. planCamera), а последняя
       строка дожимается 'snap' (см. isLast ниже). Сам набор при этом стоит
       ровным абзацем — 'headline' переносит строки по реальной ширине
       полосы, слова одного кегля, ничего не летает. Больше 'headline' нигде
       не ведёт секцию: у припева своя иерархия (anthem), у куплета свой
       набор. */
    prechorus: 'headline',
    // всплеск — единственное место, где кадр бьёт. 'nova' раньше стоял
    // здесь первым и на длинном припеве (6-8 слов) рассыпал строку по
    // случайной сетке с поворотом до ±28° на слово — на постере из двух
    // слов это акцент, на восьми это каша без переносов строк, то есть
    // не типографика. 'headline' переносит строки как абзац и не крутит
    // слова — держит припев читаемым при любом объёме текста, а удар и
    // масштаб хука остаются от bass-пульса и увеличенной последней строки.
    /* 'anthem' — единственная манера с ИЕРАРХИЕЙ внутри блока: хук
       набирается крупнее (×1.34), верхние ряды уходят в надзаголовок с
       разрядкой, блок всё время идёт на зрителя, а бас бьёт только по хуку.
       Она написана под припев и до сих пор не была включена — припев шёл
       ровным блоком headline, то есть аккуратным абзацем. */
    chorus:    { calm: ['anthem', 'impact'],    normal: ['anthem', 'impact'],       fast: ['impact', 'anthem'] },
    /* Бридж — типографика, а не аттракцион.
       Здесь стоял 'pendulum_wave': каждое слово висело на своей нитке от
       верха кадра и качалось с собственным периодом. На бумаге это опыт с
       маятниками, в кадре — строка, болтающаяся как лиана: слова разъезжаются
       по высоте, читаются не подряд, и весь бридж превращается в один
       затянутый трюк. Убран совсем.

       На бридже фигура уходит на край и текст остаётся один в кадре
       (BLOCKING.bridge) — то есть это единственное место, где работать может
       сам НАБОР. Готовые манеры бридж не вытянули: tracking/ragged/poster
       собирают блок и ЗАМИРАЮТ — движение у них живёт только на заезде,
       первые полсекунды из трёх. В куплете это правильно (там движется
       камера и фигура), а в бридже, где текст в кадре один, после заезда не
       остаётся вообще ничего — отсюда и «слабо».
       'rift' сделан под это место: строки блока идут ВСТРЕЧНО и продолжают
       разъезжаться по шву всю строку, у каждой своя встречная тень. Он
       ведёт бридж во всех регистрах, в пару к нему остаются набор (calm) и
       плакат (fast) — чтобы бридж не стал одним приёмом на всю секцию.
       Дубль под набором остался только здесь и только как ОДНА встречная
       тень на ряд: поле повторов во весь кадр (backdrop/echo) снято. */
    bridge:    { calm:   ['rift', 'ragged'],
                 normal: ['rift', 'poster'],
                 fast:   ['rift', 'poster'] },
    // текста нет — построчный режим, кадр живёт фоном
    break:     { calm: 'cinematic',             normal: 'cinematic',                fast: 'cinematic' },
    // текста нет по определению — манера не применяется ни к чему
    instrumental: { calm: 'cinematic',          normal: 'cinematic',                fast: 'cinematic' },
    /* КОНЦОВКА КОЛЬЦУЕТ КЛИП СО ВСТУПЛЕНИЕМ — той же разрядкой.
       Здесь стояли 'parallax' и 'cascade', и обе на короткой строке
       концовки не показывают текст:
         • parallax раскладывает слова по трём планам ГЛУБИНЫ — дальние
           стоят на alpha 0.42 и кегле 0.46 и остаются такими до конца
           строки. На десяти словах это глубина, на четырёх — половина
           фразы, которую физически не прочитать;
         • cascade выводит слова по одному с задержкой: на строке в две
           секунды последние слова успевают появиться к самому её концу, а
           часто и не успевают.
       Именно это и было видно на концовке: перевод есть, а самой строки в
       кадре нет. Концовку надо ЧИТАТЬ — она последнее, что остаётся.
       'tracking' показывает всю фразу сразу и полным тоном. Раньше он же
       вёл и вступление, и клип закрывался тем приёмом, которым открылся;
       вступление с тех пор ушло в 'title', концовка осталась разрядкой.
       'parallax' остаётся там, где он и нужен, — на длинных строках
       (LONG_LINE_ANIM). */
    outro:     { calm: 'tracking', normal: 'tracking', fast: ['tracking', 'ragged'] },
  };

  /* Куда падают длинные строки.
     Раньше любая строка длиннее девяти слов уходила в 'cinematic' — то есть
     в построчный субтитр. На плотном тексте это была БОЛЬШАЯ часть клипа, и
     именно отсюда бралось ощущение «сплошные субтитры»: чем длиннее текст,
     тем меньше в нём режиссуры.

     Но кинетика ломается на длинной строке не сама по себе, а от того, что
     слова не влезают в один ряд. 'parallax' раскладывает слова по трём планам
     глубины и переносам — он как раз рассчитан на много слов и остаётся
     ПОСЛОВНЫМ. Поэтому длинная строка теперь уходит туда, а 'cinematic'
     остаётся только для совсем экстремальных строк (>14 слов), где не
     справляется уже ничего. */
  const LONG_LINE_ANIM = 'parallax';

  /* Режимы, которые САМИ переносят слова по строкам по реальной ширине
     полосы. Длинный текст для них — штатный случай, а не поломка: подменять
     их на parallax нельзя, иначе они выключаются ровно там, где нужны
     больше всего. Кегль им тоже считается по многорядной раскладке. */
  /* backdrop/echo сняты, но остаются в списке: в проектах прежней версии
     их теги стоят в строках, а отдаются они headline и poster — то есть
     переносят строки сами, как и раньше. */
  const WRAPPING = new Set(['headline', 'tracking', 'ragged', 'justify',
                            'poster', 'backdrop', 'echo', 'rift',
                            'anthem', 'monolith', 'title']);

  /* Сколько процентов кадра крупный набор заходит ЗА фигуру.
     Фигура работает маской, но маска — это перекрытый хвост слова, а не
     закрытое слово: при заходе на половину от строки остаются первые три
     буквы. 14% — заметное пересечение, дающее глубину, и при этом основная
     масса букв остаётся на свободной стороне кадра. */
  const MASK_OVERLAP = 14;


  /* Режимы, которые выкладывают слова стопкой сверху вниз или показывают
     по одному слову за раз. Для них ширину кадра ограничивает длина самого
     длинного слова, а не всей строки — см. подгонку кегля в buildScore.
     Остальные кинетические режимы (domino, impact, nova, shockwave, cascade…)
     раскладывают слова в строку по горизонтали. */
  const VERTICAL_ANIM = new Set(['stack', 'flash', 'snap']);

  /* Разворачивает значение ANIM в конкретный режим для строки. */
  /* nth — номер повтора секции этого типа. Список манер перебирается ПО
     СЕКЦИЯМ: первый куплет играет одним способом целиком, второй — другим.
     Так у эпизода есть свой голос, а разница между эпизодами слышна. */
  function _pickAnim(type, tier, nth) {
    const row = ANIM[type] || ANIM.verse;
    const v   = row[tier] || row.normal;
    return Array.isArray(v) ? v[nth % v.length] : v;
  }

  /* Позиция. ВАЖНО: 'bottom' рисуется на 0.85 высоты кадра, а перевод
     уходит ещё ниже (translationGap × fontSize) и обрезается краем кадра.
     Поэтому низ используем только когда перевод выключен — см. _safePos(). */
  const POS = {
    /* Подводка остаётся по центру НЕ потому, что она как припев: у неё
       кинетика (stack/cascade/domino), а кинетика всегда работает от
       центрального якоря — смещённый якорь уводит разлёт слов за край
       (см. VERSE_FLOW ниже). Разницу с припевом держат геометрия набора
       (столбик против плаката), кегль, свечение и камера, а не позиция. */
    intro: 'center', verse: 'bottom', prechorus: 'center',
    chorus: 'center', bridge: 'center-left', break: 'center', outro: 'center',
    instrumental: 'center',
  };

  /* Композиция.
     VERSE_FLOW гонял строки по кадру лесенкой (center-left → center-right →
     top-left…). При построчных режимах это была единственная доступная
     «режиссура», и выглядела она как перекладывание субтитра с места на
     место. При пословной кинетике она ещё и мешает: режим сам расставляет
     слова относительно якоря строки, и смещённый якорь уводит весь разлёт
     к краю кадра.

     Поэтому лесенка осталась только для построчных режимов, где двигать
     нечего кроме самой строки. Кинетика всегда работает от центра. */
  const VERSE_FLOW = ['center-left', 'center-right', 'top-left', 'center-right'];

  function _compose(type, idxInSec, isLast, anim) {
    if (!WHOLE_LINE.has(anim)) return 'center';
    if (type === 'verse' || type === 'prechorus' || type === 'outro') {
      if (isLast) return 'center';
      return VERSE_FLOW[idxInSec % VERSE_FLOW.length];
    }
    return POS[type] || 'center';
  }

  function _safePos(p, hasTranslation, size) {
    if (p.indexOf('bottom') === 0 && (hasTranslation || size > 110)) {
      p = p === 'bottom' ? 'center' : p.replace('bottom', 'center');
    }
    return p;
  }

  /* Рамка под тип секции — per-line тегом {BOXNAME}…{/BOXNAME}.
     Только лёгкие, не заливающие кадр рамки: подчёркивание, субтитр,
     подпись. Плашки со сплошной заливкой убивают фон.
     ВАЖНО: рамка ставится ТОЛЬКО при построчной анимации — см. WHOLE_LINE.
     На пословной кинетике движок либо растягивает одну рамку на весь
     разлёт слов, либо рисует по рамке на каждое слово. */
  const BOX = {
    intro: null, verse: 'BOXUNDERLINE', prechorus: 'BOXUNDERLINE',
    chorus: null, bridge: null, break: null, outro: null, instrumental: null,
  };

  /* ── Подгонка кегля под ширину кадра ─────────
     Без этого длинная строка уезжает за край: размер считался только
     от числа слогов и ширину кадра не видел вовсе.
     Средняя ширина знака в долях кегля — шрифты очень разные. */
  const CHAR_W = {
    'Bebas Neue': 0.38, 'Oswald': 0.44, 'Impact': 0.45, 'Russo One': 0.55,
    'Exo 2': 0.50, 'Montserrat': 0.56, 'Raleway': 0.52, 'Rubik': 0.54,
    'Jura': 0.52, 'Play': 0.52, 'Comfortaa': 0.58, 'Space Mono': 0.60,
  };

  function _charWidth(fontDecl) {
    for (const name in CHAR_W) if (fontDecl && fontDecl.indexOf(name) !== -1) return CHAR_W[name];
    return 0.52;
  }

  /* ── Настоящий замер строки ───────────────────────────
     CHAR_W выше — таблица средних значений, а не измерение. Она и была
     причиной наложения на скриншоте: она занижала реальную ширину против
     canvas-метрик, поэтому кегль подбирался завышенным и однострочная фраза
     печаталась шире своей полосы, хоть якорь и стоял правильно — renderers.js
     не переносит строку, пока она не превысит ВСЮ ширину кадра, а не полосу.

     Меряем тем же canvas API, что и renderers.js: сумма ширины слов плюс
     зазор fontSize*0.35 между ними (см. WORD_GAP в renderers.js). Меряем
     один раз на опорном кегле и масштабируем линейно — ctx.measureText при
     смене font-size даёт при этом достаточную точность, а не гонять реальный
     замер на каждый кандидат размера. */
  let _measureCtx = null;
  function _getMeasureCtx() {
    if (_measureCtx !== null) return _measureCtx;
    _measureCtx = false;
    try {
      if (typeof document !== 'undefined' && document.createElement) {
        const cv = document.createElement('canvas');
        const c  = cv.getContext && cv.getContext('2d');
        if (c && typeof c.measureText === 'function') _measureCtx = c;
      }
    } catch (e) { _measureCtx = false; }
    return _measureCtx;
  }

  const REF_SIZE = 100;
  function _measuredWidthRatio(text, font) {
    const ctx = _getMeasureCtx();
    if (!ctx) return null;
    const words = (text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return 0;
    ctx.font = REF_SIZE + 'px ' + (font || 'sans-serif');
    let w = 0;
    words.forEach(function(word, i) {
      w += ctx.measureText(word).width;
      if (i < words.length - 1) w += REF_SIZE * 0.35;
    });
    return w / REF_SIZE;   // ширина в долях кегля — как CHAR_W, но настоящая
  }

  function _canvasWidth() {
    if (typeof document === 'undefined' || !document.getElementById) return 1280;
    const cv = document.getElementById('mainCanvas');
    return (cv && cv.width) || 1280;
  }

  function _canvasHeight() {
    if (typeof document === 'undefined' || !document.getElementById) return 720;
    const cv = document.getElementById('mainCanvas');
    return (cv && cv.height) || 720;
  }

  /* Строка должна занимать не больше FILL от ширины кадра, оставляя поля. */
  /* widthPx — бюджет ширины в пикселях (полоса или кадр), fill — доля от
     него, которую строка вправе занять.

     Сперва пробуем настоящий замер (_measuredWidthRatio): он и словил
     наложение на скриншоте — эвристика chars*charW не видела реальных
     метрик шрифта и не видела зазоров между словами при пословной
     раскладке, поэтому кегль получался завышенным. Без canvas (тесты,
     SSR) остаётся старая оценка по числу символов — хуже, но не падает. */
  function _fitSize(text, wanted, widthPx, charW, fill, font) {
    const real = _measuredWidthRatio(text, font);
    let widthPerSize;
    if (real != null) {
      widthPerSize = real;
    } else {
      const chars = (text || '').length;
      if (!chars) return wanted;
      widthPerSize = chars * charW;
    }
    if (!widthPerSize) return wanted;
    const maxByWidth = (widthPx * fill) / widthPerSize;
    return Math.max(28, Math.min(wanted, Math.round(maxByWidth)));
  }

  /* Словесные эффекты. Главная задача — читаемость поверх пёстрого фона:
     обводка/свечение отделяют букву от картинки. */
  /* OUTLINE снят отовсюду: базовая отрисовка слова в renderers уже кладёт
     тёмную обводку под заливку, поэтому отдельный тег ничего не добавлял к
     читаемости, зато навязывал всему клипу один и тот же «мультяшный» контур.
     Остаётся только свечение на подводке и припеве — как акцент, а не как
     обязательное оформление каждой строки. */
  /* Служебные слова. Акцент на предлоге или связке — это не типография,
     это случайность. Список короткий намеренно: он отсекает заведомый мусор,
     а не пытается изображать морфологию. */
  const STOP = new Set(('и а но да же ли бы не ни то как что чтобы когда где ' +
    'в во на за под над при про для из от до по о об с со у к ко без через ' +
    'я ты он она оно мы вы они мне тебе ему ей нам вам им меня тебя его её ' +
    'нас вас их мой твой свой этот тот эта та это те был была было были ' +
    'быть есть уже ещё вот там тут так вся весь все всё ' +
    'the a an and or but if of in on at to for from with by as is are am was ' +
    'were be been being do does did i you he she it we they me him her us them ' +
    'my your his its our their this that these those not no so up out ' +
    'oh yeah ooh la na hey').split(/\s+/));

  /* ── КЛЮЧЕВОЕ СЛОВО СТРОКИ ────────────────────────────
     Раньше бралось просто самое длинное слово. Длина не значит важность:
     акцент садился на случайное слово, и типографика читалась как сбой,
     а не как замысел. Ухо в песне цепляется за две вещи — за слово, на
     которое строка ложится (последнее знаменательное, рифменная позиция),
     и за слово, которое в песне повторяется (хук). По ним и выбираем.

     freq — сколько раз слово встречается во всём тексте; считается один
     раз на весь клип, см. _wordFreq. */
  function _keyWord(main, freq, maxFreq) {
    const words = main.split(/\s+/);
    const bare  = words.map(function(w) {
      return w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    });
    // Последнее знаменательное слово — рифменная позиция строки.
    let lastContent = -1;
    for (let i = words.length - 1; i >= 0; i--) {
      if (bare[i].length > 2 && !STOP.has(bare[i])) { lastContent = i; break; }
    }
    let best = -1, bestScore = 0;
    words.forEach(function(w, i) {
      const b = bare[i];
      if (b.length < 3 || STOP.has(b)) return;
      let sc = 0;
      // Хук: слово, на котором держится песня. Самый сильный признак.
      if (maxFreq > 1) sc += ((freq[b] || 1) - 1) / (maxFreq - 1) * 3;
      // Рифменная позиция — то, чем строка заканчивается.
      if (i === lastContent) sc += 2;
      // Длина осталась, но как слабый разрешитель ничьей, а не как критерий.
      sc += Math.min(b.length, 12) / 12 * 0.5;
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    return best;
  }

  /* Частотность слов по всему тексту — основа для выбора хука. */
  function _wordFreq(lyr) {
    const freq = {};
    let maxFreq = 1;
    lyr.lines.forEach(function(l) {
      (l.text || '').split(/\s+/).forEach(function(w) {
        const b = w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
        if (b.length < 3 || STOP.has(b)) return;
        freq[b] = (freq[b] || 0) + 1;
        if (freq[b] > maxFreq) maxFreq = freq[b];
      });
    });
    return { freq: freq, maxFreq: maxFreq };
  }

  const WORDFX = {
    /* Свечение снято с подводки НАРОЧНО. Оно стояло и там и там, и вместе
       с общим центром это давало «припев дважды». Теперь GLOW — признак
       ровно одной секции: загорелось — значит припев. */
    intro: null, verse: null, prechorus: null,
    chorus: 'GLOW', bridge: null, break: null, outro: null, instrumental: null,
  };

  // Множитель размера от типа секции
  const SIZE = {
    /* Подводка была 1.02 против припева 1.30 — четверть разницы, на глаз
       почти ничего, особенно после того как строка подводки ещё и росла на
       замыкающей (×1.22 ниже). Подводка теперь МЕЛЬЧЕ куплета: кадр
       поджимается перед раскрытием, и прыжок в припев становится вдвое
       больше — 0.86 → 1.34. */
    /* Вступление набирается КРУПНО. 0.95 — это кегль рядовой куплетной
       строки, то есть титульная карточка выглядела как обычный субтитр,
       просто первый по счёту. Титр обязан быть заявлением. */
    intro: 1.34, verse: 0.90, prechorus: 0.86,
    chorus: 1.34, bridge: 0.85, break: 0.90, outro: 0.95, instrumental: 0.90,
  };

  /* ── УДАРНОСТЬ СТРОКИ 0..1 ────────────────────────────
     Связующее звено всех слоёв кадра. Короткая строка на громком месте,
     да ещё и повторяющаяся (хук) — бьёт; длинная плотная строка в тихом
     куплете — не бьёт, её надо читать. От этой величины зависят фон,
     камера, персонаж и размер текста, поэтому она считается ОТДЕЛЬНО и
     ДО партитуры: разметка сцены должна быть известна раньше, чем в неё
     ставится текст. */
  function _punchOf(l, s, lyr, type, isLast) {
    if (l._punch != null) return l._punch;
    const relSyl = (l.syllables && lyr.avgSyllables)
      ? l.syllables / lyr.avgSyllables : 1;
    let punch = 0;
    punch += Math.max(0, Math.min(1, (1.4 - relSyl) / 0.9)) * 0.35;   // чем короче — тем ударнее
    punch += ((s && s.energy != null) ? s.energy : 0.5) * 0.30;       // громкость места
    punch += Math.min(1, (l.repeats || 1) / Math.max(2, lyr.maxRepeats)) * 0.20;
    if (isLast) punch += 0.15;                                        // замыкающая — точка
    if (type === 'chorus') punch = Math.min(1, punch + 0.20);
    if (type === 'bridge' || type === 'verse') punch *= 0.85;
    punch = Math.max(0, Math.min(1, punch));
    l._punch = punch;
    return punch;
  }

  /* Длина бессловесного прогона, начиная со строки i: до ближайшей спетой
     строки, а если её нет — до конца последней строки. */
  function _gapLen(lines, i) {
    const from = lines[i] ? lines[i].time : 0;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].text) return lines[j].time - from;
    }
    const last = lines[lines.length - 1];
    return Math.max(0, (last ? (last.end || last.time) : from) - from);
  }
  /* Провал короче этого — не эпизод, а пауза: кадр её не замечает.
     4 секунды = примерно два такта на средних темпах; всё, что короче,
     зритель воспринимает как продолжение той же фразы. */
  const SHORT_GAP = 4;

  function _tier(density) {
    if (density >= 5.0) return 'fast';
    if (density <= 2.2) return 'calm';
    return 'normal';
  }

  /* Собирает готовый LRC-текст с тегами и командами. */
  function buildScore(audio, lyr, sections, opts) {
    opts = opts || {};
    /* Сцена приходит вторым проходом: чтобы её посчитать, нужны габариты
       строк, а они рождаются здесь же. Первый проход идёт без сцены и даёт
       габариты, второй — уже знает, где стоит фигура. */
    const stage = opts.stage || {};
    // Частотность — на весь клип, а не на строку: хук виден только целиком.
    const WF = _wordFreq(lyr);
    const baseId    = opts.styleId || pickBaseStyle(audio, lyr);
    const baseStyle = (typeof FactoryPresets !== 'undefined') ? FactoryPresets.get(baseId) : null;
    const baseSize  = (baseStyle && baseStyle.params.fontSize) || 96;
    // Цвета берём из фона, если он есть: так текст и картинка звучат вместе,
    // а не спорят. Без фона — палитра выбранного стиля.
    const bg        = opts.bg || null;
    const baseColor = (bg && bg.textColor) || (baseStyle && baseStyle.params.color) || '#ffffff';
    const accent    = (bg && bg.accent)    || (baseStyle && baseStyle.accent) || '#e8ff00';

    const canvasW = _canvasWidth();
    const fontDecl = (baseStyle && baseStyle.params.font) || '';
    const charW   = _charWidth(fontDecl);

    const bySection = new Map();
    const posInSec  = new Map();   // индекс строки внутри секции
    const lastInSec = new Map();   // последняя строка секции — на неё приходится акцент
    /* Порядковый номер ПОВТОРА своего типа: первый куплет, второй куплет…
       По нему выбирается манера секции. Раньше выбор шёл по номеру строки
       внутри секции — то есть манера переключалась КАЖДУЮ строку, и куплет
       из четырёх строк играл domino/stack/domino/stack. Это не режиссура,
       а мельтешение: у эпизода не оставалось собственного голоса. */
    const nthOfType = new Map();
    const seenType  = {};
    sections.forEach(function(s) {
      const sung = s.lines.filter(function(l) { return !!l.text; });
      s.lines.forEach(function(l) { bySection.set(l.index, s); });
      sung.forEach(function(l, i) { posInSec.set(l.index, i); });
      if (sung.length) lastInSec.set(sung[sung.length - 1].index, true);
      const t = s.type || 'verse';
      seenType[t] = (seenType[t] == null ? 0 : seenType[t] + 1);
      s.lines.forEach(function(l) { nthOfType.set(l.index, seenType[t]); });
    });

    const out = [];
    const posByLine = {};
    const boxByLine = {};
    let scrollDir = 1;

    /* Состояние фона, уже выставленное предыдущими строками.
       Команды в LRC — переключатели: они держатся, пока их не отменят.
       Раньше они выставлялись ТОЛЬКО на границе секции, поэтому внутри
       куплета из восьми строк фон был мёртвым все восемь строк, что бы в
       этих строках ни происходило. Теперь для КАЖДОЙ строки считается
       желаемое состояние фона, а в LRC уходит только разница — фон
       реагирует построчно, но команды не дублируются.

       Начальные значения — заведомо недостижимая строка: на первой строке
       клипа состояние выставляется целиком и явно. Иначе фон стартовал бы
       с тем, что осталось от предыдущего проигрывания (включённый зум,
       незакрытые полосы), и первая секция выглядела бы случайно. */
    const UNSET = '@unset';
    const bgNow = { dark: UNSET, blur: UNSET, letterbox: UNSET,
                    zoom: UNSET, zoomAmt: null, scroll: UNSET };
    // Была ли предыдущая строка без слов — см. runStart ниже.
    let prevTextless = false;

    lyr.lines.forEach(function(l, li) {
      const s    = bySection.get(l.index) || { type: 'verse', energy: 0.5 };
      const type = s.type || 'verse';
      const cmds = [];

      /* Служебная метка секции — [Chorus], [Pre-Chorus], [Куплет 2].
         Это разметка структуры, а не слова песни: в кадре её быть не должно.
         LRCParser её из .text вырезает, поэтому вся партитура (hasText,
         кегль, ударность) уже считает такую строку инструментальной — а вот
         в кадр она до сих пор попадала, см. правку `main` ниже.

         markerOnly — строка, в которой КРОМЕ метки ничего нет. Она приходится
         ровно на монтажную склейку, и вместо надписи «Chorus» тут ставится
         то, чем склейка и должна читаться: камера сбрасывается в исходное,
         а на первой спетой строке новой секции отрабатывает вход арки
         (припев — удар-наезд, куплет — общий план). Зритель
         видит смену сцены, а не служебное слово. */
      const markerOnly = !l.text && !!(l.entry && l.entry.section);
      /* Первая ли это бессловесная строка подряд. Проигрыш размечен НЕ одной
         меткой, а всеми служебными строками своего куска, и раньше каждая из
         них считалась отдельной склейкой: /CAMERA RESET/ выходил каждые три
         секунды и обнулял только что начатую проводку, а направление
         прокрутки на каждой строке переворачивалось. Проигрыш от этого не
         ехал никуда — он дёргался на месте. Склейка — только первая строка
         прогона; остальные продолжают начатое движение. */
      const runStart = !prevTextless;
      /* Длина бессловесного прогона, в который попала строка: от неё до
         ближайшей спетой строки. Короткий прогон (меньше SHORT_GAP) кадр
         не переключает — см. holdFrame ниже. */
      const holdFrame = !l.text && (_gapLen(lyr.lines, li) < SHORT_GAP);

      // ── Per-line стиль ──
      const tier     = _tier(l.density || lyr.avgDensity);
      const idxInSec = posInSec.get(l.index) || 0;
      const isLast   = !!lastInSec.get(l.index);

      const punch = _punchOf(l, s, lyr, type, isLast);

      // Плотная длинная строка — фону надо отступить, иначе её не прочитать.
      const wordsN = (l.text || '').split(/\s+/).filter(Boolean).length;
      const heavy  = !!l.text && (wordsN >= 8 || tier === 'fast');

      /* ── Желаемое состояние фона на ЭТОЙ строке ──────── */
      const hasText = !!l.text;
      /* Пороги фона — от типа секции, а не одни на весь клип.
         Куплету _punchOf домножает ударность на 0.85, поэтому со общими
         порогами (зум 0.55, полосы 0.72) в куплете не срабатывало НИЧЕГО:
         ни зума, ни полос, ни блюра, ни прокрутки — фон стоял мёртвым все
         восемь строк. Куплет от этого не «спокойный», а пустой.
         Отдельные пороги возвращают фону реакцию внутри куплета, но
         оставляют припеву запас: там ударность выше и без поблажек, так
         что разница между куплетом и припевом сохраняется. */
      const isVerseLike = (type === 'verse' || type === 'outro');
      const zoomThr = isVerseLike ? 0.34 : 0.55;
      const lbThr   = isVerseLike ? 0.58 : 0.72;
      const want = {
        // Под текстом фон приглушён — крупные буквы иначе тонут в картинке.
        dark:      hasText,
        // Блюр — не «оформление бриджа», а ответ на нечитаемость. Держать
        // его на каждой длинной строке нельзя: длинных строк в куплете
        // большинство, и фон оказывается размытым весь куплет — то есть
        // выключенным. Поэтому блюр только там, где текст реально забивает
        // кадр: скороговорка на длинной строке, либо бридж, где картинка
        // намеренно уходит из фокуса.
        blur:      hasText && ((heavy && tier === 'fast') || type === 'bridge'),
        // Полосы включаются на хуках: кадр сжимается в киноформат ровно там,
        // где строка бьёт. На остальном — выключены.
        /* Полосы. Порог 0.72 срабатывал редко и вразнобой, поэтому
           «киноформат» не был признаком чего-то конкретного. Теперь он
           закреплён за раскрытием: припев сжимается в кино ВСЕГДА, подводка
           — НИКОГДА (кадр перед раскрытием держится открытым), инструментал
           уходит в кино целиком. Остальное — по ударности, как раньше. */
        /* Вступление идёт в полосах ЦЕЛИКОМ — вместе с крупным кеглем и
           разрядкой это титульная карточка, а не первая строка куплета:
           кадр сжат в киноформат ровно до тех пор, пока песня не началась
           словами. На первой же строке куплета полосы уходят, и открытие
           кадра само работает склейкой. */
        letterbox: type === 'chorus'     ? true
                 : type === 'intro'      ? true
                 : type === 'prechorus'  ? false
                 : type === 'instrumental' ? true
                 : (hasText && punch > lbThr),
        /* Музыкальный зум. В куплете он теперь ВКЛЮЧЁН ВСЕГДА, где есть
           текст, а не по порогу ударности. Порог был бинарным выключателем:
           типичная куплетная строка даёт punch ≈ 0.17–0.30 (ударность
           куплета домножена на 0.85), то есть на четырёх строках из шести
           зума не было ВООБЩЕ — фон стоял мёртвым, и синхронизировать
           фигуре было не с чем. «Тише» должно означать МЕНЬШУЮ АМПЛИТУДУ,
           а не отсутствие движения; за амплитуду отвечает zoomAmt ниже,
           и она по-прежнему идёт от ударности строки. */
        /* Инструментал — единственное место, где кадр едет без текста:
           длинный наезд на всю секцию, чтобы пустой кадр не стоял. */
        zoom:      type === 'instrumental' ? 'in'
                   : !hasText ? null
                   : (isVerseLike || punch > zoomThr) ? 'in'
                   : (type === 'prechorus' ? 'out' : null),
        // Сила зума — прямо пропорциональна ударности строки.
        zoomAmt:   Math.round((0.22 + punch * 0.85) * 100) / 100,
        // Прокрутка — только там, где текста нет: под строкой она уезжает
        // из-под букв и читается как брак.
        // Внутри одного бессловесного прогона направление не меняется.
        /* Прокрутка — только для бессловесных провалов (break). На
           проигрыше её нет намеренно: там работает камера сценами
           (punchIn / whipPan / vertigo, см. SECTION_BODY.instrumental), а
           прокрутка поверх них — это второе, независимое движение того же
           фона. Вместе они и давали то самое «фон гоняет из стороны в
           сторону»: кадр всё время шевелится и при этом никуда не идёт. */
        scroll:    (hasText || type === 'instrumental') ? null
                   : (runStart ? (scrollDir > 0 ? 'right' : 'left') : bgNow.scroll),
      };
      if (!hasText) want.dark = false;
      /* ИНСТРУМЕНТАЛ. Слов нет, фигуры нет (см. BLOCKING.instrumental) —
         в кадре остаётся только картинка, и она должна работать в полную
         силу: затемнение снято (оно существует ради читаемости букв, а
         букв тут нет), размытия нет, полосы включены, кадр едет наездом и
         панорамой одновременно. Это и есть «проигрыш» как эпизод, а не
         пауза между эпизодами. */
      if (type === 'instrumental') {
        want.dark    = false;
        want.blur    = false;
        /* МУЗЫКАЛЬНЫЙ ЗУМ НА ПРОИГРЫШЕ ПРИТУШЕН.
           Здесь стояло 0.55…1.00 — максимум шкалы. Этот зум тянет ФОН и
           почти не тянет фигуру (передний план идёт с коэффициентом 0.28,
           см. FOREGROUND_CAM в App.js), поэтому на полной силе картинка
           раздувалась вдвое, превращалась в мутный фрагмент без композиции,
           а фигура на её фоне съёживалась в наклейку. Ровно это и было
           видно на проигрыше.
           Крупность на проигрыше теперь задают шоты камеры (planCamera,
           потолок SOLO_CEIL), а музыкальный зум остаётся тем, чем он и
           должен быть, — дыханием на бас. */
        want.zoomAmt = Math.round((0.26 + (s.energy || 0.5) * 0.22) * 100) / 100;
      }

      /* ── КОРОТКИЙ БЕССЛОВЕСНЫЙ ПРОВАЛ: КАДР ПРОСТО ПРОДОЛЖАЕТСЯ ──
         Пауза в одну-две секунды между строками — это дыхание певца, а не
         эпизод. Раньше на неё выходил полный набор смены состояния: снять
         затемнение (фон вспыхивает), сбросить камеру (кадр прыгает в
         исходное), остановить зум — и через секунду всё вернуть обратно.
         В кадре это выглядело как чужая склейка посреди куплета: картинка
         дёрнулась, посветлела и вернулась.
         Теперь на таком провале НЕ МЕНЯЕТСЯ НИЧЕГО: команды не пишутся,
         состояние фона остаётся тем, каким его оставила спетая строка.
         Провал становится тем, чем он и является, — паузой. */
      if (holdFrame) {
        // состояние не трогаем: bgNow остаётся как есть, cmds пуст
      } else {
      // ── Диффим состояние и пишем только изменения ──
      if (want.dark !== bgNow.dark) {
        cmds.push(want.dark ? '/НАЧАЛО ЗАТУХАНИЯ/' : '/КОНЕЦ ЗАТУХАНИЯ/');
        bgNow.dark = want.dark;
      }
      if (want.blur !== bgNow.blur) {
        cmds.push(want.blur ? '/РАЗМЫТИЕ/' : '/ЧЕТКОСТЬ/');
        bgNow.blur = want.blur;
      }
      /* Склейка на месте служебной метки. Сбрасывать камеру нужно ДО того,
         как поедет прокрутка новой секции: иначе новая сцена начинается с
         остатков зума и наклона предыдущей, и вход в припев теряет удар —
         бить уже некуда, кадр и так наехан. */
      if (markerOnly && runStart) {
        cmds.push('/CAMERA RESET/');
        bgNow.zoom = null; bgNow.zoomAmt = null; bgNow.scroll = null;
      }
      if (want.letterbox !== bgNow.letterbox) {
        cmds.push(want.letterbox ? '/LETTERBOX REACTIVE/' : '/LETTERBOX OFF/');
        bgNow.letterbox = want.letterbox;
      }
      if (want.zoom !== bgNow.zoom) {
        cmds.push(want.zoom === 'in' ? '/ZOOM IN/' : want.zoom === 'out' ? '/ZOOM OUT/' : '/ZOOM STOP/');
        bgNow.zoom = want.zoom;
        bgNow.zoomAmt = null;   // сила задаётся заново под новый режим
      }
      // Силу зума обновляем и внутри одного режима: на серии ударных строк
      // припева каждая следующая бьёт со своей силой, а не с одной на всех.
      if (want.zoom && Math.abs((want.zoomAmt || 0) - (bgNow.zoomAmt || 0)) > 0.08) {
        cmds.push('/ZOOM AMT ' + want.zoomAmt.toFixed(2) + '/');
        bgNow.zoomAmt = want.zoomAmt;
      }
      if (want.scroll !== bgNow.scroll) {
        cmds.push(want.scroll === 'right' ? '/SCROLL RIGHT/'
                : want.scroll === 'left'  ? '/SCROLL LEFT/' : '/SCROLL STOP/');
        if (want.scroll) scrollDir = -scrollDir;
        bgNow.scroll = want.scroll;
      }
      }

      // Манера — свойство ЭПИЗОДА, а не строки: внутри секции она одна.
      let anim = _pickAnim(type, tier, nthOfType.get(l.index) || 0);
      // Замыкающая строка секции — смысловая точка, её собираем ударно.
      // Раньше здесь стояли 'zoom' и 'bounce', то есть ЛЮБАЯ кинетика в
      // куплете тут же затиралась построчными режимами и куплет опять
      // становился однородным. Теперь акцент тоже пословный.
      // 'impact' — та же сборка слов в строку, что и в куплете, но с ударом
      // на приземлении. Семейство движения не меняется, меняется только его
      // резкость; смена семейства здесь была бы лишней, потому что акцент уже
      // несут кегль (mult ниже) и цвет ({LCOLOR}).
      /* Замыкающая строка. 'impact' — точка КУПЛЕТА. В подводке он стоял
         тоже, и последняя строка перед припевом играла ровно тем приёмом,
         которым потом весь припев и шёл: удар, ещё удар, только крупнее.
         В подводке точку ставит 'snap' — то же семейство сжатия (слово за
         словом в столбик), но резко и в один такт: пружина дожимается, а
         разжимает её уже припев. */
      /* ПЛАКАТ НЕ СТРОИТСЯ НА ОДНОЙ БУКВЕ.
         'poster' делает героем ПЕРВОЕ слово строки и растягивает его во всю
         полосу на обрез. Когда строка начинается с «I», «И», «А», «Он» —
         в кадр во весь рост встаёт одна буква, то есть вертикальная палка,
         а сама фраза ютится сбоку мелочью. Это не композиция, это сбой
         раскладки. Такие строки набираем флагом (ragged): иерархия там от
         длины строк, а не от одного слова. */
      const _w1 = ((l.text || '').trim().split(/\s+/)[0] || '')
                    .replace(/[^\p{L}\p{N}]/gu, '');
      /* Оговорка про число слов важна. Беда была не в короткой первой
         строке как таковой, а в том, что герой съедает полосу, а ОСТАЛЬНАЯ
         фраза ютится рядом мелочью. Если в строке одно-два слова, никакой
         «остальной фразы» нет: герой и есть строка, и во весь кадр она
         читается плакатом, а не палкой. */
      if (anim === 'poster' && _w1.length <= 2 && wordsN > 2) anim = 'ragged';

      /* Здесь короткое вступление (одно-три слова) переводилось в 'poster'.
         Теперь вступление целиком идёт манерой 'title', и она сама
         справляется с любой длиной: одно слово — герой между линейками,
         длинная фраза — герой с подписями. */
      if (isLast && type === 'verse')     anim = 'impact';
      if (isLast && type === 'prechorus') anim = 'snap';
      // Длинную строку горизонтальная кинетика не вмещает — слова налезают
      // друг на друга. Но это повод сменить РЕЖИМ, а не выключить кинетику:
      // 'parallax' раскладывает слова по планам глубины и переносам.
      // 'headline' переносить не надо: он САМ переносит слова по строкам по
      // реальной ширине — длинный текст это его прямая задача, ради неё он и
      // сделан. Без этой оговорки на строке от 10 слов он тут же подменялся
      // на parallax, то есть ровно там, где нужен больше всего.
      const _wordCount = (l.text || '').split(/\s+/).filter(Boolean).length;
      if (!WHOLE_LINE.has(anim) && !WRAPPING.has(anim) && _wordCount > 9) {
        anim = _wordCount > 14 ? 'cinematic' : LONG_LINE_ANIM;
      }

      let mult = SIZE[type] || 1;
      // Короткая ударная строка в припеве — крупнее; длинная — мельче,
      // чтобы физически поместиться в кадр.
      if (l.syllables && lyr.avgSyllables) {
        const rel = l.syllables / lyr.avgSyllables;
        if (rel < 0.6) mult *= 1.18;
        else if (rel > 1.5) mult *= 0.82;
      }
      if (tier === 'fast') mult *= 0.88;
      // Иерархия внутри куплета: рядовые строки тише, замыкающая — крупнее.
      // Без этого все четыре строки одного кегля и куплет читается плоско.
      if (type === 'verse' || type === 'prechorus') {
        mult *= isLast ? 1.22 : (idxInSec % 2 === 1 ? 0.88 : 0.96);
      }
      // Энергия секции даёт ±10 %
      mult *= 0.95 + (s.energy || 0.5) * 0.1;

      let size = Math.max(28, Math.min(200, Math.round(baseSize * mult)));

      /* Ширина кадра — жёсткое ограничение. Но мерить надо то, что режим
         реально выкладывает в строку, иначе кегль считается не от той длины.

         И мерить надо СВОЮ полосу, а не весь кадр. Пока здесь стоял canvasW,
         строка подгонялась под всю ширину, спокойно вылезала из отведённой ей
         половины и уезжала под фигуру — в припеве, где фигура на переднем
         плане, слова просто пропадали за ней. Делёжка кадра без этого не
         работала вовсе: полосу считали, а текст её не соблюдал. */
      const _stg  = stage[l.index];
      /* Плакатным режимам колонка не режется — фигура им маска, а не
         сосед по кадру (см. {LPOSX} ниже и planStage). Кегль им считается
         от полного кадра, иначе крупный набор ужимается в узкую полосу
         ради конфликта, которого уже нет. */
      /* 'echo' в списке потому, что снятая манера отдаётся poster (см.
         AnimModes) — строка со старым тегом должна считаться так же, как
         то, чем она реально рисуется. 'backdrop' отдаётся headline, то есть
         обычному набору, и маски ему не нужно. */
      const _masked = (anim === 'poster' || anim === 'echo');
      const fitW  = (_stg && _stg.place === 'side' && _stg.textBand)
        ? canvasW * ((_stg.textBand.b - _stg.textBand.a) + (_masked ? MASK_OVERLAP : 0)) / 100
        : canvasW;
      const centerFill = (type === 'chorus') ? 0.88 : 0.78;
      if (VERTICAL_ANIM.has(anim)) {
        // Слова идут стопкой (или по одному) — в ширину кадра должно влезть
        // самое длинное СЛОВО, а не вся строка. Раньше длинную строку жало
        // до нечитаемого кегля даже там, где в кадре одновременно одно слово.
        const longest = (l.text || '').split(/\s+/)
          .reduce(function(a, w) { return w.length > a.length ? w : a; }, '');
        size = _fitSize(longest, size, fitW, charW, centerFill, fontDecl);
      } else if (WRAPPING.has(anim)) {
        /* Переносящий режим ломает слова на строки сам, поэтому кегль считаем не «вся фраза
           в один ряд», а «фраза в НЕСКОЛЬКО рядов своей полосы»: иначе
           длинный текст ужимается до нечитаемого — ровно та беда, ради
           которой режим и заводился.
           Ряда ДВА, а не три: перенос идёт по fitW (ту же ширину получает
           анимация через maxLineW, см. App.js), и трёхрядный бюджет задирал
           кегль настолько, что блок переставал держаться в отведённой
           колонке. Два ряда — предел, при котором ширина полосы и высота
           кадра ещё сходятся. */
        size = _fitSize(l.text, size, fitW * 2, charW, centerFill, fontDecl);
      } else if (!WHOLE_LINE.has(anim)) {
        // Горизонтальная кинетика раскладывает слова с зазором ≈0.5 кегля,
        // то есть занимает заметно больше места, чем та же строка сплошняком.
        // Настоящий замер (_measuredWidthRatio) уже включает этот зазор —
        // он меряет ТУ ЖЕ раскладку, что и renderers.js. Поправка нужна
        // только эвристике-фолбэку, у которой зазора в оценке нет вовсе.
        const wordCount = Math.max(1, (l.text || '').split(/\s+/).length);
        const gapFactor = _measuredWidthRatio('x', fontDecl) != null ? 1 :
          1 + 0.5 * (wordCount - 1) / Math.max(1, (l.text || '').length * charW);
        size = _fitSize(l.text, size, fitW, charW, centerFill / gapFactor, fontDecl);
      } else {
        size = _fitSize(l.text, size, fitW, charW, centerFill, fontDecl);
      }

      // Боковой якорь: текст центрируется на 0.15 (или 0.85) ширины кадра,
      // значит строка физически влезает только если она уже 30% кадра.
      // Поэтому вбок уходят лишь короткие строки, длинные остаются в центре —
      // иначе строка уезжает за край.
      let wantPos = _compose(type, idxInSec, isLast, anim);
      if (wantPos.indexOf('-left') !== -1 || wantPos.indexOf('-right') !== -1) {
        const w = (l.text || '').length * charW * size;
        if (w > canvasW * 0.28) wantPos = wantPos.indexOf('top') === 0 ? 'top' : 'center';
      }

      // Исходная строка без прошлой разметки; перевод отделяем — его
      // нельзя заворачивать ни в рамку, ни в словесный эффект.
      const raw = l.entry.rawText || l.text || '';
      const stripped = raw
        .replace(/\{L(?:FONT|SIZE|ANIM|COLOR|BGIMG|POS|LAYER|OVFX|NOBOX):[^}]+\}/g, '')
        .replace(/\{LNOBOX\}/g, '')
        .replace(/\{\/?[A-Z]+\}/g, '')      // прошлые рамки и словесные эффекты
        .replace(/\/[^\/]+\//g, '');

      const sep    = stripped.indexOf('>>>');
      let   main   = (sep === -1 ? stripped : stripped.slice(0, sep)).trim();
      /* Метка секции вырезается ЗДЕСЬ, а не полагается на рендер.
         Раньше её снимал только renderers.parseSpans — и снимал регуляркой
         с якорем ^, то есть исключительно в самом начале строки. Партитура
         же ставит перед текстом свои теги ({LANIM}{LSIZE}{LPOS}…), после
         чего строка начинается не со скобки, якорь не срабатывает, и
         «[Pre-Chorus]» уезжало в кадр как обычное слово — да ещё получало
         акцентный эффект и рамку наравне с текстом песни. */
      main = main.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
      const transl = sep === -1 ? '' : stripped.slice(sep + 3).trim();
      const hasTr  = !!transl;

      const pos = _safePos(wantPos, hasTr, size);

      const tags = [];
      tags.push('{LANIM:' + anim + '}');
      tags.push('{LSIZE:' + size + '}');
      tags.push('{LPOS:' + pos + '}');
      /* Строка встаёт в полосу, которую оставила фигура, — это и есть
         делёжка кадра. Без этого текст центрируется сам по себе, фигура
         стоит сама по себе, и композиции нет: два независимых слоя.
         Ставим только там, где полоса реально уже кадра (place='side');
         в 'center'/'edge' текст по замыслу идёт поверх фигуры.

         Плакатным режимам полоса РАСШИРЯЕТСЯ в сторону фигуры, а не
         отменяется. Фигура им маска (см. planStage), и пересечение — приём,
         но приём этот работает, пока за фигуру уходит ХВОСТ слова. Когда
         полосу отменили совсем, крупный набор занял весь кадр, фигура
         накрыла его правую половину, и от «Comic» осталось «Com» — не
         композиция, а закрытый текст. Поэтому за фигуру заходит ровно
         OVERLAP кадра, остальное слово остаётся на виду. */
      if (_stg && _stg.place === 'side' && _stg.textBand) {
        let bandA = _stg.textBand.a, bandB = _stg.textBand.b;
        if (_masked) {
          // Расширяем в ту сторону, где стоит фигура: свободная зона
          // прижата к одному краю кадра, фигура — к противоположному.
          if (bandA <= 100 - bandB) bandB = Math.min(100, bandB + MASK_OVERLAP);
          else                      bandA = Math.max(0, bandA - MASK_OVERLAP);
        }
        // Половина реальной ширины строки в % кадра. Якорь — это ЦЕНТР
        // строки, поэтому его мало поставить в середину полосы: надо ещё
        // не дать строке вывалиться за её границы.
        // Та же настоящая мера, что и в _fitSize выше — иначе якорь и кегль
        // считают ширину по-разному, и один из двух расчётов лжёт полосе.
        const realW  = _measuredWidthRatio(main || l.text, fontDecl);
        const widthPerSize = realW != null ? realW : (l.text || '').length * charW;
        const halfW = widthPerSize * size / canvasW * 100 / 2;
        let mid = (bandA + bandB) / 2;
        mid = Math.max(bandA + halfW, Math.min(bandB - halfW, mid));
        // Если строка шире полосы — прижимаем к её середине и не двигаем
        // дальше: уводить центр наружу хуже, чем симметричный выход.
        if (halfW * 2 > bandB - bandA) mid = (bandA + bandB) / 2;
        tags.push('{LPOSX:' + Math.round(mid * 10) / 10 + '}');
      }
      if (type === 'chorus' && l.repeats >= 3) tags.push('{LCOLOR:' + accent + '}');
      else if (isLast && (type === 'verse' || type === 'prechorus')) tags.push('{LCOLOR:' + accent + '}');
      else if (type === 'bridge') tags.push('{LCOLOR:' + baseColor + '}');

      /* ── Акцент на ключевом слове ───────────────────────
         Равномерная обработка всей строки — это оформление субтитра; в клипе
         выделяют ОДНО слово. Ключевым считаем самое длинное слово от 4 букв:
         короткие служебные слова акцентировать бессмысленно.

         Раньше акцент ставился только на ПОСТРОЧНЫХ режимах, и обоснованно:
         {BIG} меняет ширину слова уже после того, как кинетический режим
         разложил слова по местам, — слово вылезает и наезжает на соседа.
         Но из этого следует не «на кинетике акцента нет», а «на кинетике
         акцент не должен менять метрику». Свечение, неон, глитч и цвет
         рисуются в тех же габаритах, что и обычное слово, — раскладка их не
         замечает. Поэтому на кинетике ключевое слово получает эффект, а не
         кегль, и пословная иерархия появляется наконец везде. */
      /* Акцент есть В КАЖДОЙ спетой строке. Условие выше пускало сюда
         припев и подводку целиком, а из куплета — только замыкающую строку:
         поэтому куплет и выглядел постным. У строки всегда есть слово, на
         которое она ложится; вопрос не «выделять ли», а НАСКОЛЬКО громко.

         Громкость и задаёт регистр эффекта. Куплет получает тихие приёмы,
         которые работают на читаемость, а не на крик: обводку и лёгкое
         свечение. Крикливое (неон, глитч) остаётся припеву и быстрым местам —
         иначе выделено окажется всё, а значит ничего. */
      let keyWordFx = null;
      /* Титру акцент не ставится: иерархию в нём уже задаёт герой во всю
         меру. {GLOW} же рисуется своей веткой — с тёмным штрихом и без
         градиента, — и попав на героя, превратил бы главное слово карточки
         в неоновую наклейку, а попав на подпись — в светящуюся мелочь. */
      if (main && anim !== 'title') {
        const words = main.split(/\s+/);
        const ki = _keyWord(main, WF.freq, WF.maxFreq);
        if (ki !== -1) {
          const loud = (type === 'chorus' || type === 'prechorus' ||
                        isLast || punch > 0.6);
          // Построчный режим — можно менять кегль, раскладка от этого не рвётся.
          // Кинетика — только эффект, не трогающий габариты слова.
          const tagName = !loud
                          // Тихий регистр куплета: обводка отделяет слово от
                          // фона, ничего не крича; на длинных строках, где
                          // свечение сливается в кашу, — только она.
                        ? (_wordCount > 6 ? 'OUTLINE' : 'GLOW')
                          /* NEON, GLITCH и FLICKER отсюда убраны. Все три
                             МЕНЯЮТ ЦВЕТ слова: неон заливает его своим
                             ярким тоном, глитч разносит красным и синим.
                             В результате внутри одной строки половина слов
                             белая, а ключевое — фиолетовое или с цветной
                             бахромой. Это не иерархия, а разнобой: набор
                             перестаёт быть одним набором.
                             Выделять слово нужно тем же цветом, что и вся
                             строка: кеглем там, где раскладка это позволяет,
                             и свечением там, где нельзя трогать габариты. */
                        : WHOLE_LINE.has(anim) ? 'BIG'
                        : 'GLOW';
          words[ki] = '{' + tagName + '}' + words[ki] + '{/' + tagName + '}';
          main = words.join(' ');
          keyWordFx = tagName;
        }
      }

      // Словесный эффект на всю строку — ради читаемости поверх фона.
      // Но только если акцентного слова нет: вкладывать {GLOW} внутрь
      // {GLOW} нельзя, и вдобавок эффект на всей строке съедает акцент —
      // выделено то, что отличается, а не то, что светится вместе со всем.
      const wfx = keyWordFx ? null : WORDFX[type];
      if (main && wfx) main = '{' + wfx + '}' + main + '{/' + wfx + '}';

      // Цвет строки: на фоне, который спорит с текстом, ведём основной
      // цвет от картинки, а не от палитры стиля.
      const alreadyColored = tags.some(function(x) { return x.indexOf('{LCOLOR:') === 0; });
      if (bg && !alreadyColored) tags.push('{LCOLOR:' + baseColor + '}');

      // Рамка строки — только если анимация построчная. На кинетике
      // рамка либо растягивается на весь разлёт слов, либо дублируется
      // на каждом слове; и то и другое выглядит сломанным.
      const box = WHOLE_LINE.has(anim) ? BOX[type] : null;
      if (main && box) main = '{' + box + '}' + main + '{/' + box + '}';
      if (main && !box) tags.push('{LNOBOX}');   // глобальная рамка не лезет туда, где не нужна

      /* Метка секции переписывается обратно в строку. Партитура собирает
         строку заново из команд, тегов и текста — а метку, которую ставил
         пользователь на вкладке «Секции», в этот набор никто не клал, и
         каждый прогон режиссёра стирал всю разметку структуры. Стоит она
         первой: extractSectionLabel читает её только в начале строки. */
      const sect = (l.entry && l.entry.section) ? '[' + l.entry.section + ']' : '';
      const content = (sect ? sect + ' ' : '') +
                      (cmds.length ? cmds.join('') + ' ' : '') +
                      (main ? tags.join('') + ' ' : '') + main +
                      (hasTr ? ' >>> ' + transl : '');

      /* Габарит строки в кадре — доля ширины, которую она реально занимает.
         Нужен, чтобы персонаж вставал В СВОБОДНОЕ МЕСТО, а не «сбоку вообще»:
         иначе спрайт и текст просто сосуществуют в кадре, ничего друг о друге
         не зная, и кадр читается как две наклейки. Считаем по той же модели,
         по какой выше подгонялся кегль. */
      let frac;
      if (VERTICAL_ANIM.has(anim)) {
        const longest = (main || '').split(/\s+/)
          .reduce(function(a, w) { return w.length > a.length ? w : a; }, '');
        frac = (longest.length * charW * size) / canvasW;
      } else if (_masked) {
        /* Плакатные режимы НЕ претендуют на место в кадре: фигура им маска,
           они уходят ей за спину (см. planStage и MASK_OVERLAP).

           Здесь была ловушка, которая и съедала слово. Габарит репортился
           как «полоса целиком» (frac = 1.0). Планировщик читал это как
           «строке не хватает даже половины кадра», уводил фигуру в режим
           'edge' — а в 'edge' полоса текста равна ВСЕМУ кадру. Дальше
           расширять было нечего, крупный набор растягивался на всю ширину,
           фигура накрывала его половину, и от «Comic» оставалось «Com».
           Причём в первом проходе (probe) сцены ещё нет, fitW равен кадру,
           так что frac выходил единицей ВСЕГДА — режим гарантированно
           выталкивал фигуру на край сам себе во вред.

           Ноль означает «этой строке отдельная колонка не нужна»: фигура
           встаёт в свою обычную мизансцену, а текст занимает свободную
           часть кадра плюс заход за фигуру. */
        frac = 0;
      } else if (WRAPPING.has(anim)) {
        /* Переносящий режим не тянется в одну линию — он переносит слова, и шире
           СВОЕЙ ПОЛОСЫ не станет. Поэтому габарит = меньшее из «длины
           фразы» и ширины полосы. Потолок именно fitW, а не 0.82 кадра:
           0.82 заявляло планировщику, что текст занял почти весь кадр, тот
           отодвигал фигуру к краю и раздувал её — а строка на деле спокойно
           укладывалась в свою колонку. Два расчёта врали друг другу, и
           композиция разъезжалась. */
        const wcH = Math.max(1, (l.text || '').split(/\s+/).length);
        const flat = ((l.text || '').length * charW * size + (wcH - 1) * size * 0.5) / canvasW;
        frac = Math.min(flat, fitW / canvasW);
      } else if (!WHOLE_LINE.has(anim)) {
        const wc = Math.max(1, (l.text || '').split(/\s+/).length);
        frac = ((l.text || '').length * charW * size + (wc - 1) * size * 0.5) / canvasW;
      } else {
        frac = ((l.text || '').length * charW * size) / canvasW;
      }
      posByLine[l.index] = pos;
      boxByLine[l.index] = { pos: pos, frac: Math.max(0, Math.min(1, frac)), anim: anim };
      out.push({ time: l.time, rawText: content, text: l.text });
      prevTextless = !hasText;
    });

    return {
      lrc: LRCParser.serialize(out),
      styleId: baseId,
      // Позиции строк нужны хореографии персонажа: он встаёт в противовес
      // тексту, значит должен знать, куда текст встал.
      positions: posByLine,
      // Габариты строк — чтобы персонаж вставал в свободное место кадра.
      boxes: boxByLine,
    };
  }

  /* ══════════════════════════════════════════════
     5. РАБОТА КАМЕРЫ — кино-сцены на строки
     Главный «клиповый» слой: команды /ZOOM IN/ дают лишь общий
     характер, а настоящее движение кадра задают сцены из
     SCENE_PRESETS, назначенные на конкретные строки.
  ══════════════════════════════════════════════ */

  /* Для каждого типа секции — набор сцен по нарастанию энергии.
     Берём тем жёстче, чем громче секция. */
  /* ══════════════════════════════════════════════
     КАМЕРА: АРКА СЕКЦИИ ВМЕСТО СПИСКА ПРЕСЕТОВ

     Раньше здесь лежала таблица SCENES: на каждый тип секции — список
     пресетов, и строка i получала list[i % list.length]. Это и было
     источником рассыпающегося кадра, причём независимо от того, какие
     пресеты в списке лежат. Список не знает ни где строка стоит в
     секции, ни на какой крупности закончилась предыдущая, ни что будет
     дальше. Он перебирает. Поэтому куплет выглядел как нарезка из
     четырёх разных клипов, а между строками не было ни одного
     сохраняющегося параметра.

     Теперь секция планируется как ФРАЗА. Правил ровно четыре, и они
     общие для всех типов:

       • ВХОД. Первая строка секции всегда объявляет новую крупность:
         спокойная секция открывается с общего плана (cineEstablish),
         припев — ударом на крупный (cineHit), подводка — разгоном
         (cineLift). Это монтажная склейка, слышимая в музыке.
       • ПАРА. Дальше строки идут парами «вопрос — ответ»: наезд
         (cinePush) и отпускание (cineSettle). cineSettle стартует ровно
         с той крупности, на которой cinePush закончил, — стык не виден.
       • ДЫХАНИЕ. Каждая третья пара заменяется проводкой (cineGlide):
         крупность замирает, движется только кадр. Без этого шесть
         наездов подряд превращаются в одно длинное «ползёт».
       • ВЫХОД. Последняя строка секции отпускает кадр в общий план
         (cineRelease) — чтобы следующая секция могла начать со своего
         входа, а не продолжить с середины чужого движения.

     Все переходы согласованы по лестнице крупности из BackgroundEngine
     (1.06 общий / 1.20 средний / 1.34 крупный), поэтому строка
     передаёт следующей кадр, а не бросает его. */

  /* Вход в секцию — единственная строка, которой позволено сменить
     крупность рывком. */
  const SECTION_ENTRY = {
    chorus:    'cineHit',
    prechorus: 'cineLift',
    verse:     'cineEstablish',
    bridge:    'cineEstablish',
    /* Вступление открывается НЕ тем же кадром, что куплет и бридж.
       cineEstablish — общий план с едва заметным подходом; он правильный
       для секции, которая продолжает рассказ, и никакой для секции, которая
       его начинает. 'slowDrift' — медленный наезд по диагонали через весь
       титр: движение, которого больше нигде в клипе нет. */
    intro:     'slowDrift',
    outro:     'cineEstablish',
    break:     'cineStill',
    /* ПРОИГРЫШ ОТКРЫВАЕТСЯ УДАРОМ.
       Здесь стоял 'cineRelease' — выдох в общий план, то есть ровно то
       движение, которым секции ЗАКАНЧИВАЮТСЯ. Проигрыш от этого начинался
       как затухание: голос замолчал, кадр отъехал, дальше двенадцать секунд
       ничего. Но в песне это не пауза между куплетами, а место, где играет
       инструмент — самая громкая часть трека. Она и должна врубаться:
       'crashZoom' — стремительный наезд с отдачей. */
    instrumental: 'crashZoom',
  };

  /* Тело секции: пара «наезд — ответ» и то, чем заменяется каждая
     третья пара, чтобы фраза дышала. */
  const SECTION_BODY = {
    chorus:    { push: 'cineDrive', answer: 'cineSettle', breath: 'cineHit'   },
    prechorus: { push: 'cineLift',  answer: 'cineLift',   breath: 'cineGlide' },
    verse:     { push: 'cinePush',  answer: 'cineSettle', breath: 'cineGlide' },
    bridge:    { push: 'cineGlide', answer: 'cineSettle', breath: 'cineStill' },
    intro:     { push: 'cineGlide', answer: 'cineStill',  breath: 'cineStill' },
    outro:     { push: 'cineStill', answer: 'cineGlide',  breath: 'cineStill' },
    break:     { push: 'cineStill', answer: 'cineStill',  breath: 'cineGlide' },
    /* Проигрыш — единственная секция, где кадром распоряжается ТОЛЬКО
       камера: слов нет, и сдерживать её нечем. Пресеты cine* сделаны под
       строку — они держат крупность и не мешают читать, поэтому проигрыш на
       них выглядел как длинный ровный проезд ни к чему. Здесь работает
       монтаж: хлёсткий пан (whipPan), пошаговый наезд со щелчками
       (staircase) и падение в точку (plunge). Каждая служебная метка
       секции — отдельный ШОТ, а не продолжение предыдущего.
       Вращения нет ни в одном: крутящийся фон — заставка, а не съёмка. */
    instrumental: { push: 'whipPan', answer: 'staircase', breath: 'plunge' },
  };

  /* Строит последовательность сцен на секцию: по одной на спетую строку.
     n — сколько строк, type — тип секции, tail — отпускать ли кадр в
     конце (последняя строка перед сменой секции).
     Возвращает массив имён пресетов. */
  function buildArc(type, n, tail) {
    const entry = SECTION_ENTRY[type] || SECTION_ENTRY.verse;
    const body  = SECTION_BODY[type]  || SECTION_BODY.verse;
    const out   = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) { out.push(entry); continue; }
      // Последняя строка секции — выдох, но только если секции есть куда
      // передавать кадр и строка не единственная после входа.
      if (tail && i === n - 1 && n > 2) { out.push('cineRelease'); continue; }
      // Пары: чётный шаг — наезд, нечётный — ответ. Каждая третья пара
      // (шаги 4-5, 10-11, ...) заменяется дыханием.
      const step = i - 1;
      const pair = Math.floor(step / 2);
      // Дыхание заменяет ТОЛЬКО первую строку пары: подряд идущие
      // одинаковые сцены допустимы для проводки и паузы, но не для удара —
      // два cineHit друг за другом снова читались бы как перебор.
      if (pair % 3 === 2 && step % 2 === 0) { out.push(body.breath); continue; }
      out.push((step % 2 === 0) ? body.push : body.answer);
    }
    return out;
  }

  const DIRECTOR_TAG = '[авто] ';

  /* Снимает сцены, поставленные прошлым прогоном, чтобы они не копились. */
  function clearDirectorScenes() {
    if (typeof BackgroundEngine === 'undefined' || !BackgroundEngine.camScenes) return 0;
    const mine = BackgroundEngine.camScenes.filter(function(s) {
      return s.name && s.name.indexOf(DIRECTOR_TAG) === 0;
    });
    mine.forEach(function(s) { BackgroundEngine.removeCamScene(s.id); });
    return mine.length;
  }

  /* Крупность шота на проигрыше. Пары [база, прибавка на единицу силы]
     сняты с формул самих пресетов в BackgroundEngine. */
  const SOLO_ZOOM = {
    crashZoom: [1.00, 1.35],
    whipPan:   [1.25, 0.30],
    staircase: [1.00, 0.85],
    plunge:    [1.00, 1.40],
  };
  const SOLO_CEIL = 1.45;
  function _soloIntensity(preset, energy) {
    const g = SOLO_ZOOM[preset];
    // Пресет не из набора шотов (хвостовой cineRelease) — сила как раньше.
    if (!g) return Math.max(0.55, Math.min(1, 0.55 + energy * 0.40));
    const need = (SOLO_CEIL - g[0]) / g[1];
    /* Энергия секции двигает крупность в пределах ±8 %: тихий проигрыш
       чуть спокойнее громкого, но ни один не выходит за потолок. */
    return Math.round(Math.max(0.20, Math.min(1, need * (0.94 + energy * 0.14))) * 100) / 100;
  }

  /* Планирует сцены. Возвращает список для показа в отчёте
     (и ставит их, если apply=true). */
  function planCamera(sections, lyr, bg, apply, charPlan) {
    const plan = [];
    if (!sections.length) return plan;

    // Точка фокуса — чуть выше центра: в кадре обычно герой/горизонт,
    // а не геометрический центр.
    const fx = 50;
    const fy = bg && bg.centerLuma > 0.5 ? 42 : 46;

    /* Если персонаж в кадре есть — камера наводится НА НЕГО.
       Это третья связка кадра: фон едет не «куда-то», а к фигуре, фигура
       смотрит на текст, текст стоит в свободной от фигуры части кадра.
       Без этого фокус камеры был просто болтанкой ±6% вокруг центра,
       никак не соотнесённой с тем, что в кадре нарисовано. */
    const charAt = {};
    if (charPlan) charPlan.forEach(function(c) { charAt[c.line] = c; });

    sections.forEach(function(s, si) {
      const energy = s.energy != null ? s.energy : 0.5;

      /* ИНСТРУМЕНТАЛ. Секция без спетых строк раньше вылетала отсюда по
         `if (!sung.length) return` — то есть на проигрыше камера не получала
         НИ ОДНОЙ сцены и просто доигрывала остатки предыдущей. Отсюда и
         ощущение провала в клипе.
         Сцены ставятся на служебные метки секции — каждая метка это шот
         (вход ударом, дальше пан / ступенчатый наезд / падение в точку,
         см. SECTION_BODY.instrumental). Фокус идёт НА ФИГУРУ: на проигрыше
         она одна в кадре и играет соло (planStage), значит камера смотрит
         туда же, куда смотрит зритель, а не в пустую половину кадра. */
      if (s.type === 'instrumental') {
        const marks = s.lines.length ? s.lines : [];
        const arcI  = buildArc('instrumental', Math.max(1, marks.length),
                               si < sections.length - 1);
        marks.forEach(function(l, i) {
          const preset = arcI[i] || 'whipPan';
          plan.push({
            preset: preset,
            /* СИЛА СЧИТАЕТСЯ ОТ ПРЕСЕТА, А НЕ ОДНИМ ЧИСЛОМ НА СЕКЦИЮ.
               Общая «сила 0.8» давала на разных пресетах совершенно разную
               крупность: whipPan уезжал на 1.49, а crashZoom — на 2.08.
               При двукратном увеличении фон перестаёт быть картинкой: в
               кадре остаётся её мутный фрагмент, а фигура на его фоне
               читается наклейкой, хоть и следует за зумом. Отсюда и разница
               между двумя проигрышами в одном клипе — один смотрелся, второй
               был кашей.
               Теперь для каждого пресета сила подбирается так, чтобы ПИК
               крупности вышел один и тот же — SOLO_CEIL. Потолок взят из
               того же расчёта, что и у cine-пресетов (см. BackgroundEngine):
               выше 1.45 передний план начинает выпадать из кадра. Характер
               шота при этом сохраняется целиком: удар, хлыст и ступени
               остаются, выравнивается только крупность. */
            intensity: _soloIntensity(preset, energy),
            lines: [l.index],
            focusX: Math.round(charAt[l.index] ? charAt[l.index].x
                                               : fx + ((si % 2) ? -12 : 12)),
            focusY: Math.round(fy - 2),
            why: 'инструментал #' + (si + 1) + ' — шот ' + (i + 1) +
                 (i === 0 ? ' (врубается)' : ''),
          });
        });
        return;
      }

      const sung = s.lines.filter(function(l) { return !!l.text; });
      if (!sung.length) return;

      /* Сцены берутся аркой на всю секцию сразу, а не выбираются на
         каждой строке по отдельности: только так строка знает, на какой
         крупности её оставила предыдущая. tail — есть ли следующая
         секция, которой надо передать кадр в общем плане. */
      const tail = si < sections.length - 1;
      const arc  = buildArc(s.type, sung.length, tail);

      sung.forEach(function(l, i) {
        const preset = arc[i];

        /* Сила движения. Раньше она пересчитывалась на каждой строке
           с нуля из energy и punch и могла прыгнуть с 0.3 на 0.95 между
           соседними строками — кадр дёргался по амплитуде даже там, где
           пресет не менялся. Теперь ударность строки лишь ОТКЛОНЯЕТ
           уровень секции, максимум на ±0.18: внутри секции камера
           работает в одном регистре, а разницу между секциями по-прежнему
           слышно. */
        const punch = (l._punch != null) ? l._punch : 0.5;
        const base  = 0.42 + energy * 0.34;
        let   inten = Math.max(0.15, Math.min(1, base + (punch - 0.5) * 0.36));

        /* Подводка — единственное место, где сила обязана расти по
           строкам: cineLift каждую строку стартует с одной и той же
           средней крупности, и без нарастания шесть одинаковых наездов
           дали бы плато вместо набора. Ramp от 0.62 к 1.0 по длине
           секции — каждая следующая строка доезжает заметно дальше
           предыдущей, и на входе в припев кадр уже на крупном плане. */
        if (s.type === 'prechorus' && sung.length > 1) {
          inten = Math.min(1, inten * (0.62 + 0.38 * (i / (sung.length - 1))));
        }

        /* Фокус. На персонажа, если он в этой строке в кадре, иначе — на
           ту же точку интереса, что и у соседних строк секции. Прежний
           код дёргал фокус ±6% по чётности строки: движение без причины,
           из-за него проводка каждую строку меняла направление. Смещение
           теперь одно на секцию — направление проводки внутри фразы
           держится, и меняется только при смене секции. */
        const c = charAt[l.index];
        let cfx, cfy;
        if (c) {
          // Не в саму фигуру, а чуть в сторону центра кадра: иначе на
          // сильном зуме персонаж упирается в край.
          cfx = Math.max(22, Math.min(78, c.x + (c.x < 50 ? 6 : -6)));
          cfy = fy - (c.asPlane ? 0 : 2);
        } else {
          cfx = fx + ((si % 2) ? 7 : -7);
          cfy = fy + ((si % 4 < 2) ? -3 : 3);
        }

        let why = s.type + ' #' + (si + 1) +
                  (i === 0 ? ' — вход' :
                   (preset === 'cineRelease' ? ' — выдох' : ' — строка ' + (i + 1)));

        plan.push({
          preset: preset, intensity: inten, lines: [l.index],
          focusX: Math.round(cfx),
          focusY: Math.round(cfy),
          why: why + (c ? ' → на персонажа' : ''),
        });
      });
    });

    if (apply && typeof BackgroundEngine !== 'undefined' && BackgroundEngine.addCamScene) {
      clearDirectorScenes();
      plan.forEach(function(p, i) {
        BackgroundEngine.addCamScene({
          name:          DIRECTOR_TAG + p.why,
          preset:        p.preset,
          intensity:     p.intensity,
          focusX:        p.focusX,
          focusY:        p.focusY,
          selectedLines: p.lines,
        });
        void i;
      });
    }
    return plan;
  }

  /* ══════════════════════════════════════════════
     6. ПЕРСОНАЖ — третий слой кадра

     Картинка-спрайт (PNG с прозрачностью), загруженная как image-объект,
     сама по себе остаётся мебелью: стоит в одной точке весь клип с одним
     эффектом. Здесь она превращается в участника — потому что её положение,
     размер, слой и движение выводятся ровно из той же партитуры, что текст
     и фон:

       • отход к краю         — от ГАБАРИТА строки: широкая строка выталкивает
                                фигуру к краю, короткая пускает ближе к центру;
       • масштаб              — растёт вместе с кеглем текста (масштабная
                                рифма) и с ударностью строки;
       • слой                 — глубина вместо расстояния: на хуке фигура
                                перед текстом, на проходной строке за ним;
       • зеркало (flipX)      — персонаж развёрнут ЛИЦОМ к тексту;
       • эффект               — из семейства движения секции.

     Перекрытие текста фигурой — не дефект, а сам приём: в постерной
     кинетике слои пересекаются, а разделяет их порядок отрисовки.

     Ставится через ov.lineOverrides / ov.lineAnimations — построчные
     оверрайды в BackgroundEngine.
  ══════════════════════════════════════════════ */

  /* Как двигается персонаж в каждом типе секции.

     ТРЯСКИ ЗДЕСЬ НЕТ, И ЭТО НЕ ВКУСОВЩИНА. 'shake' и 'glitch' у объектов
     считают смещение от синусов на частотах ~50–100 Гц и от Math.random() —
     то есть меняют позицию КАЖДЫЙ КАДР на случайную величину. У камеры это
     работает: трясётся весь кадр целиком, глаз читает движение сцены.
     У спрайта трясётся одна вырезанная фигура на неподвижном фоне, без
     сглаживания и без motion blur — получается не удар, а дребезг растра,
     который вдобавок подсвечивает края вырезки.

     Удар на припеве даёт 'zoom' (bass-реактивный наезд с атакой на бит) и
     'pulse'/'bounce' — они меняют масштаб и высоту, а не позицию по шуму,
     и на приземлении читаются как акцент. */
  /* Движение фигуры — одно на весь эпизод. Рассказчик не меняет манеру
     держаться от строки к строке; менять её каждую строку — то же самое,
     что дёргать спрайт по кадру, только незаметнее.

     'breathe' стоял здесь на ВСЕ секции — и это ровно то, из-за чего
     фигура в куплете читалась как зацикленная PNG-картинка: у 'breathe'
     амплитуда не зависит от bands вообще, один и тот же синус крутится
     что на тихом месте, что на плотном, и глаз это считывает как gif,
     а не как присутствие. 'presence' — тоже органичное, тихое движение
     (куплет слушает, а не жестикулирует), но амплитуда держится на
     mid/overall микса, так что на паузе фигура почти замирает, а не
     продолжает ровно дышать сама по себе.

     'bounce' убран из припева намеренно: подпрыгивающая фигура читается
     стикером, а не исполнителем. В припеве фигура выходит вперёд для
     хука (см. BLOCKING.chorus.front) — там её реакция и должна бить в
     такт, поэтому 'heartbeat' вместо ровного дыхания. */
  const CHAR_FX = {
    intro:     'breathe',
    verse:     'presence',
    // Подводка: то же тихое присутствие, но фигура уже развёрнута и растёт
    // масштабом (см. BLOCKING) — реакцию в такт бережём для припева.
    prechorus: 'presence',
    chorus:    'heartbeat',
    bridge:    'sway',
    break:     'float',
    outro:     'breathe',
    /* Проигрыш: играет она, значит и бьёт в такт она. 'heartbeat' —
       единственная реакция, которая отбивает удар, а не колышется. */
    instrumental: 'heartbeat',
  };

  /* Базовая ширина спрайта (% ширины кадра) по типу секции.
     Считается от ШИРИНЫ, а высота выходит из пропорций картинки: у фигуры
     в полный рост (2:3) ширина 34% кадра 16:9 — это уже почти вся высота
     кадра. Поэтому потолок низкий: всё, что выше, просто обрезается рамкой
     и перестаёт читаться как фигура. */
  const CHAR_W_BASE = {
    intro: 26, verse: 24, prechorus: 28,
    /* Проигрыш — самый крупный план клипа: в кадре, кроме фигуры, нет
       вообще ничего, и она обязана этот кадр держать. 44 против 34 в
       припеве — разница читается сразу, а не «кажется». */
    chorus: 34, bridge: 26, break: 30, outro: 26, instrumental: 44,
  };
  const CHAR_W_MAX = 46;

  /* Находит спрайт среди объектов: сначала по имени, потом — самая крупная
     картинка. Рамки, карточки, текст и процедурные эффекты не в счёт. */
  function findCharacterOverlay() {
    if (typeof BackgroundEngine === 'undefined' || !BackgroundEngine.overlays) return null;
    const imgs = BackgroundEngine.overlays.filter(function(o) {
      return o && o.type === 'image' && o.img;
    });
    if (!imgs.length) return null;
    const NAMED = /(герой|персонаж|char|hero|sprite|actor|model)/i;
    const named = imgs.filter(function(o) { return NAMED.test(o.name || ''); });
    const pool  = named.length ? named : imgs;
    return pool.reduce(function(a, o) { return (o.width || 0) > (a.width || 0) ? o : a; }, pool[0]);
  }

  /* ══ РАЗМЕТКА СЦЕНЫ ═══════════════════════════════════
     Считается ДО партитуры и не знает про текст — наоборот, текст потом
     встаёт в то, что здесь размечено. Это и есть композиция: кадр сначала
     делится между фигурой и строкой, и только затем каждый слой заполняет
     свою часть. Пока делёжки не было, слои просто рисовались поверх друг
     друга из своих собственных соображений — отсюда и ощущение трёх
     несвязанных видео.

     Возвращает для каждой строки, где стоит фигура И какую полосу кадра
     она оставляет тексту (textBand). */
  /* ── Мизансцена по типу секции ────────────────────────
     Персонаж — рассказчик и икона клипа, а не подвижный элемент оформления.
     Поэтому его положение закрепляется ЗА СЕКЦИЕЙ и внутри неё не меняется:
     он «выходит на позицию» на монтажной склейке и стоит там весь эпизод.
     Внутри секции меняются только реакции — дыхание, план (перед текстом
     или за ним) и плотность цвета.

     place: 'center' — один в кадре, текста нет или он мелкий;
            'side'   — стоит сбоку, текст занимает вторую половину;
            'edge'   — на краю, крупно, текст идёт поверх.
     mass:  доля ширины кадра. */
  const BLOCKING = {
    /* ВСТУПЛЕНИЕ — БЕЗ ФИГУРЫ.
       Она стояла тут по центру, «представлялась зрителю», и вступление от
       этого ничем не отличалось от любой другой секции: тот же спрайт в
       том же месте, только текста поменьше. Вступление — это ТИТР: кадр,
       картинка и название. Фигура выходит на первой спетой строке первого
       куплета, и её появление читается как выход, потому что до этого её в
       кадре не было. place:'none' обрабатывается отдельной веткой ниже. */
    intro:     { place: 'none',   mass: 0,    front: false },
    /* Куплет: отходит вбок и назад, кадр отдан тексту — она слушает.
       mass был 0.26 — при secPunch куплета это ≈26% ширины кадра против
       ≈39% в припеве, то есть фигура становилась в полтора раза мельче и
       переставала читаться персонажем: в кадре оставалась вырезка в углу.
       «Отойти назад» должно означать план и порядок отрисовки, а не потерю
       половины размера — иначе куплет выглядит не спокойнее, а беднее. 0.32 всё
       ещё заметно меньше припева, но это уже фигура, а не наклейка. */
    verse:     { place: 'side',   mass: 0.32, front: false },
    /* Подводка: отступает и СЖИМАЕТСЯ вместе с кадром. Было 0.34 против
       0.36 в припеве — два процента ширины, то есть фигура выглядела ровно
       так же, как в припеве, и «выход вперёд» на хуке не читался ничем.
       Теперь подводка — самое тесное место клипа (0.28), а припев — самое
       просторное (0.40): между секциями фигура прибавляет почти половину. */
    prechorus: { place: 'side',   mass: 0.28, front: false },
    // Припев: выходит вперёд и КРУПНО — хук произносит она.
    chorus:    { place: 'side',   mass: 0.40, front: true  },
    // Бридж: уходит на край и в тень, текст один в кадре.
    bridge:    { place: 'edge',   mass: 0.30, front: false },
    // Проигрыш: снова одна — держит кадр, пока нет слов.
    break:     { place: 'center', mass: 0.36, front: true  },
    // Концовка: возвращается в позицию вступления — кольцо.
    outro:     { place: 'center', mass: 0.32, front: false },
    /* ИНСТРУМЕНТАЛ: фигура ОДНА В КАДРЕ И КРУПНО.
       Здесь стояло place:'none' — фигура уходила за рамку на всю секцию.
       Замысел был «её возвращение прочитается как выход», а получилось
       прямо обратное: на самой громкой части трека из кадра убирали
       единственный объект, который в нём есть, и оставался фон с камерой.
       Соло — это место, где играют, а не где никого нет. Фигура выходит
       вперёд, занимает кадр и отбивает такт (CHAR_FX.instrumental). */
    instrumental: { place: 'center', mass: 0.44, front: true },
  };

  function planStage(sections, lyr, bg, boxes) {
    const stage = {};
    const EDGE = 2;      // поле кадра для ТЕКСТА, %
    /* ФИГУРА ИГРАЕТ ОТ КРАЯ, А НЕ ОТ ПОЛЯ.
       Здесь было поле: сначала EDGE = 2 (фигура впритык к рамке), потом
       CHAR_EDGE = 14 (фигура с запасом на камеру). Оба варианта решали
       одну задачу — «уместить фигуру целиком» — и оба неверны, потому что
       задача другая.

       Целиком фигура в кадре стоять и не должна. Снизу её уже режет край
       (BLEED в planCharacter ниже), и именно поэтому низ читается: срез
       делает РАМКА, а не картинка. Ровно то же самое нужно сбоку. Пока
       фигура вписана в кадр с полем, у неё есть собственный вертикальный
       край — прямая линия вырезки, которая и читается наклейкой; а на
       наезде камера этот край ещё и вытаскивает на середину.

       Поэтому внешний край фигуры уходит ЗА рамку на SIDE_BLEED. Тогда
       обрез по боку — такой же кадровый, как по низу, и композиция
       перестаёт зависеть от того, наехала камера или нет.

       Величина считается, а не подбирается: камера переднего плана
       (App.js, FOREGROUND_CAM = 0.28) может тянуть передний план К ЦЕНТРУ
       паном по фокусу до 0.5 * ZOOM_CEIL * 0.28 = 7.7% ширины. Меньший
       вылет она бы «втащила» обратно в кадр, и край вылез бы. Округляем
       вверх: 10. */
    const SIDE_BLEED = 10;
    const GAP  = 4;      // зазор между фигурой и колонкой текста, %
    boxes = boxes || {};

    // Сторона меняется НА СКЛЕЙКЕ — то есть между секциями, а не строками.
    // Внутри эпизода фигура стоит.
    let side = -1;
    let prevType = null;
    /* Последняя выставленная разметка фигуры — её продолжают короткие
       паузы между секциями (см. ниже). */
    let lastEntry = null;

    sections.forEach(function(s) {
      const sung = s.lines.filter(function(l) { return !!l.text; });

      /* ═══ ИНСТРУМЕНТАЛ — СОЛО, А НЕ ПАУЗА ═══════════════
         Раньше фигура здесь уходила за рамку (x за кадром, opacity 0), и на
         проигрыше не оставалось НИЧЕГО: фон, камера и всё. Самая громкая
         часть трека была единственной, где из кадра убран его единственный
         объект.

         Теперь проигрыш ставится как СОЛО. Фигура одна в кадре, крупно,
         перед всем остальным, бьёт в такт (CHAR_FX.instrumental =
         'heartbeat'), а камера идёт монтажом отдельных шотов
         (SECTION_BODY.instrumental).

         И это единственное место, где фигуре РАЗРЕШЕНО менять положение
         между метками. В спетых секциях она стоит: там рассказчик, и прыжки
         читались бы браком монтажа. Здесь рассказа нет — здесь номер, и
         метки секции работают монтажными склейками: чётная — фигура по
         центру кадра, нечётная — прижата к краю с вылетом за рамку, и
         сторона каждый раз переворачивается. Крупность при этом НЕ скачет
         (она и так предельная): разницу между шотами делает камера —
         crashZoom, whipPan и staircase дают на одной и той же фигуре
         совершенно разные кадры. */
      if ((s.type || '') === 'instrumental') {
        const eI    = (s.energy != null) ? s.energy : 0.5;
        // Ширина от энергии секции: тихий проигрыш крупный, громкий — очень.
        const baseW = CHAR_W_BASE.instrumental * (0.94 + eI * 0.24);
        const tintI = (typeof TextRenderer !== 'undefined' && TextRenderer.textShade)
                        ? TextRenderer.textShade((bg && bg.textColor) || '#ffffff')
                        : (bg ? bg.accent : null);
        let sideI = side;
        s.lines.forEach(function(l, i) {
          const atEdge = (i % 2) === 1;
          if (atEdge) sideI = -sideI;
          /* По центру фигура стоит целиком в кадре, поэтому вылет за рамку
             в ширину не входит: SIDE_BLEED — это то, что уезжает за край, и
             он нужен только краевому шоту. Иначе центральный кадр выходил
             на десять процентов крупнее краевого при одинаковой задумке. */
          const w    = Math.round(Math.min(CHAR_W_MAX, baseW))
                     + (atEdge ? SIDE_BLEED : 0);
          const half = w / 2;
          stage[l.index] = {
            line: l.index, punch: 1, side: sideI,
            x: atEdge
                 ? (sideI < 0 ? Math.round(half - SIDE_BLEED)
                              : Math.round(100 + SIDE_BLEED - half))
                 : 50,
            y: 56,
            width: w,
            flipX: sideI < 0,
            // Текста в секции нет — «поверх текста» перекрывать нечего,
            // а передний план даёт фигуре полную плотность и резкость.
            layer: 'above',
            opacity: 1,
            /* Подмеса цвета фона нет вовсе: воздушная перспектива уводит
               фигуру вглубь, а здесь она и есть кадр. tint остаётся —
               по нему движок красит волну резонанса. */
            tint: tintI, tintAmt: 0,
            feather: 0.10,
            // Удар расходится от фигуры контуром — на соло в полную силу.
            resonance: 0.9,
            inFront: true, textSplit: false,
            textBand: { a: EDGE, b: 100 - EDGE },
            place: 'center',
            effect: CHAR_FX.instrumental,
            effectAmt: Math.round((0.42 + eI * 0.28) * 100) / 100,
            why: 'инструментал · соло, ' + (atEdge ? 'край' : 'центр') +
                 ', метка ' + (i + 1),
          };
          lastEntry = stage[l.index];
        });
        side = sideI;
        prevType = 'instrumental';
        return;
      }

      const type0 = s.type || 'verse';
      /* ФИГУРЫ В КАДРЕ НЕТ (place:'none' — сейчас это вступление).
         Прячем не прозрачностью: полупрозрачный персонаж читается
         призраком. Спрайт уводится ЗА рамку — x за границей кадра плюс
         opacity 0. Ширина остаётся ненулевой: 0 делит на ноль в расчётах
         габаритов. */
      if ((BLOCKING[type0] || {}).place === 'none') {
        s.lines.forEach(function(l, i) {
          stage[l.index] = {
            line: l.index, punch: 0, side: side,
            x: side < 0 ? -40 : 140, y: 56,
            width: 20, flipX: side < 0,
            layer: 'below', opacity: 0,
            tint: null, tintAmt: 0, feather: 0,
            inFront: false, textSplit: false,
            textBand: { a: EDGE, b: 100 - EDGE },
            place: 'none', effect: 'float', effectAmt: 0.2,
            why: type0 + ' · фигуры в кадре нет, строка ' + (i + 1),
          };
        });
        prevType = type0;
        return;
      }

      /* Секция без спетых строк, которая НЕ проигрыш (короткий провал,
         отбивка): своей мизансцены у неё нет. Раньше на такие строки не
         писалось ничего — и движок брал для спрайта ГЛОБАЛЬНЫЕ настройки,
         то есть на одну секунду фигура прыгала в свой базовый размер и
         положение, а потом возвращалась. Именно это и было видно на
         коротких проигрышах: посреди клипа спрайт внезапно другой.
         Копируем последнюю живую разметку: пауза продолжает предыдущий
         кадр, а не показывает третий вариант композиции. */
      if (!sung.length) {
        if (lastEntry) s.lines.forEach(function(l, i) {
          stage[l.index] = Object.assign({}, lastEntry, {
            line: l.index,
            why: (s.type || 'пауза') + ' · пауза, кадр продолжается (строка ' + (i + 1) + ')',
          });
        });
        return;
      }
      const type  = type0;
      const blk   = BLOCKING[type] || BLOCKING.verse;
      const secFx = CHAR_FX[type] || CHAR_FX.verse;
      const lastIdx = sung[sung.length - 1].index;

      // Средняя ударность секции — характер эпизода целиком. Именно она,
      // а не отдельная строка, задаёт масштаб фигуры: рассказчик не должен
      // прыгать в размере от строки к строке.
      let secPunch = 0;
      sung.forEach(function(l) {
        secPunch += _punchOf(l, s, lyr, type, l.index === lastIdx);
      });
      secPunch /= sung.length;

      // Новый эпизод — новая мизансцена. Куплеты чередуют стороны, чтобы
      // два соседних не выглядели одним планом.
      if (type !== prevType || type === 'verse') side = -side;
      prevType = type;

      /* Самая широкая строка эпизода — то, под что подгоняется мизансцена.
         Считаем по секции, а не по строке: колонка текста одна на весь
         эпизод, и прыгать её ширине не от чего. */
      let need = 0;
      sung.forEach(function(l) {
        const b = boxes[l.index];
        if (b && b.frac > need) need = b.frac;
      });
      need = need * 100;   // % ширины кадра

      let place = blk.place;
      let mass  = blk.mass;
      /* Если строка не влезает в оставшуюся половину — фигура уступает:
         сначала сжимается, а когда и этого мало, уходит на край и пускает
         текст поверх себя. Кадр принадлежит тому, кто в нём говорит. */
      if (place === 'side') {
        // В кадре фигура занимает свою ширину МИНУС вылет за рамку.
        const free = 100 - 2 * EDGE - GAP - (mass * 100 - SIDE_BLEED);
        if (need > free) {
          const fit = (100 - 2 * EDGE - GAP - need) / 100;
          if (fit >= 0.18) mass = fit;
          else             place = 'edge';
        }
      }

      /* Ширина — полная, вместе с той частью, что уйдёт за рамку.
         В кадре останется width - SIDE_BLEED. */
      const width = Math.round(Math.max(16, Math.min(CHAR_W_MAX,
        mass * 100 * (0.92 + secPunch * 0.28) + SIDE_BLEED)));
      const half  = width / 2;

      let x, textBand;
      if (place === 'center') {
        x = 50;
        // Одна в кадре: текст, если он есть, идёт поверх неё по центру.
        textBand = { a: EDGE, b: 100 - EDGE };
      } else if (place === 'edge') {
        /* Фигура прижата к краю, но целиком в кадре. Обрез рамкой даёт
           прямую вертикаль по контуру — именно она читается наклейкой,
           а не композицией. Присутствие гасим планом и цветом, не обрезкой. */
        x = side < 0 ? Math.round(half - SIDE_BLEED) : Math.round(100 + SIDE_BLEED - half);
        textBand = { a: EDGE, b: 100 - EDGE };
      } else {
        x = side < 0 ? Math.round(half - SIDE_BLEED) : Math.round(100 + SIDE_BLEED - half);
        // Текст занимает вторую половину кадра — колонка, а не «остаток».
        textBand = side < 0
          ? { a: x + half + GAP, b: 100 - EDGE }
          : { a: EDGE,           b: x - half - GAP };
      }

      /* Вписывание в сцену: чем дальше фигура от переднего плана, тем
         сильнее она забирает цвет фона — так работает воздушная
         перспектива. Плюс мягкий край: вырезанный PNG иначе читается
         прямоугольной наклейкой. */
      /* Цвет подмеса берём ИЗ ПАЛИТРЫ ТЕКСТА, а не из комплементарного
         акцента фона. Акцент считается как «тон фона + 180°», то есть
         подобран так, чтобы НЕ совпадать ни с фоном, ни, заодно, с
         набором: фигура получала цвет, которого в кадре больше нигде нет,
         и читалась покрашенной отдельно от всего.

         Текст же красится градиентом, уходящим в _deepShade своего цвета, —
         это и есть цветовой строй кадра. Фигура берёт его же: тогда тень на
         ней и тень в букве одного тона, и слои держатся вместе.

         Сам цвет текста (почти всегда белый) в подмес не годится — белым
         фигуру только выбелит; поэтому спрашиваем именно теневой тон. */
      const _textBase = (bg && bg.textColor) || '#ffffff';
      const tint    = (typeof TextRenderer !== 'undefined' && TextRenderer.textShade)
                        ? TextRenderer.textShade(_textBase)
                        : (bg ? bg.accent : null);
      /* Было 0.26 на дальнем плане — четверть фигуры замешивалась в цвет
         фона. На красном фоне серый скафандр от этого уходил в тот же
         красный, и фигура переставала быть отдельным объектом кадра.
         Воздушная перспектива — это лёгкая дымка, а не растворение:
         0.16 её сохраняет, но фигура остаётся собой. */
      const tintFar = 0.16, tintNear = 0.10;

      sung.forEach(function(l, i) {
        const punch   = _punchOf(l, s, lyr, type, l.index === lastIdx);
        /* Вперёд фигура выходит по СМЫСЛУ секции — но только там, где это
           физически не режет текст. 'layer: above' означает «рисуется ПОСЛЕ
           текста», то есть буквально поверх букв (см. drawOverlaysAll в
           BackgroundEngine). При 'side' текст и фигура стоят в разных
           колонках кадра — тут «вперёд» безопасно, это про свет и резкость.
           При 'center' и 'edge' у текста нет своей колонки: textBand — это
           весь кадр, и фигура делит с текстом ОДНО И ТО ЖЕ место. Именно
           здесь blk.front=true с 'above' рисовало фигуру физически поверх
           строки — та самая надпись, срезанная спрайтом на скриншоте.
           Смысл «вперёд» в этих режимах несёт масштаб и резкость (см. tint
           ниже), а не перекрытие текста — текст должен быть виден всегда. */
        let inFront = (place === 'side') && blk.front;

        /* ── Фигура как МАСКА для крупного набора ──
           Для плакатных режимов (poster, backdrop) фигура ставится ПОВЕРХ
           текста намеренно. Это базовый приём монтажа: крупная надпись идёт
           через весь кадр, а герой её перекрывает — и текст отделяется от
           героя органически, глубиной, а не тем, что его отодвинули в
           сторонку.

           До этого крупный набор и фигуру разводили по разным колонкам: под
           текст резалась узкая полоса, слово в ней ужималось, а с другой
           стороны кадра оставалась пустота. Маска снимает конфликт целиком —
           текст берёт весь кадр, потому что пересечение с фигурой перестало
           быть проблемой и стало приёмом.

           Работает это только с крупным кеглем: у мелкой строки фигура
           съест значимую долю букв и читать будет нечего. Поэтому список
           именно плакатный, а не «все режимы». */
        const lineAnim = (boxes[l.index] || {}).anim;
        if (lineAnim === 'poster' || lineAnim === 'echo') inFront = true;

        /* Режимы со СВОИМ служебным слоем: подложка-стена (backdrop), поле
           повторов (echo), встречная тень (rift). У них набор состоит из
           двух частей, и класть обе по одну сторону от фигуры неправильно
           в обе стороны: спереди — дубль лезет на лицо и спорит с текстом,
           сзади — за фигурой пропадает сам текст, ровно тот, который надо
           читать. Поэтому фигура встаёт МЕЖДУ ними: дубль работает глубиной
           за её спиной, читаемый набор идёт перед ней.
           Флаг уходит в lineOverrides и обрабатывается в drawOverlaysAll. */
        /* Остался один 'rift': backdrop и echo сняты, служебного слоя под
           набором у них больше нет, и разводить фигурой нечего. */
        const GHOSTED = (lineAnim === 'rift');
        if (GHOSTED) inFront = true;

        const isHook  = punch > 0.7;

        stage[l.index] = {
          line:    l.index,
          punch:   punch,
          side:    side,
          // Позиция ФИКСИРОВАНА на всю секцию — рассказчик стоит.
          x:       x,
          y:       56,
          // Реакция на ударную строку — только масштаб, и небольшая.
          // Прибавка на ударной строке не должна выпихивать фигуру за рамку:
          // обрез контура рамкой — ровно то, что читается наклейкой.
          /* Зажима по рамке здесь больше нет, и это не упущение: он и
             делал ту самую вписанность, от которой фигура читалась
             наклейкой. Вылет за край задан SIDE_BLEED и постоянен. */
          width:   Math.round(width * (isHook && inFront ? 1.06 : 1)),
          flipX:   side < 0,
          layer:   inFront ? 'above' : 'below',
          /* Глубину задают ПЛАН и ПОРЯДОК ОТРИСОВКИ, а не выцветание.
             Формула 0.66 + punch*0.26 давала в куплете ≈0.74 — фигура
             стояла полупрозрачной, сквозь неё просвечивал фон, и вместе с
             подмесом tintFar это и читалось «на отъебись». Полупрозрачный
             персонаж — это призрак, а не дальний план: дальний план решается
             тем, что он МЕНЬШЕ и что текст рисуется поверх него (layer:
             'below'), и то и другое здесь уже есть. */
          opacity: Math.round((inFront ? 1 : 0.88 + punch * 0.12) * 100) / 100,
          tint:    tint,
          tintAmt: Math.round((inFront ? tintNear : tintFar) * 100) / 100,
          // Мягкий край снимает прямой срез картинки.
          feather: 0.10,
          /* Резонанс: от фигуры на удар расходится её собственный контур
             (см. _drawResonance). Цвет НЕ задаём — движок берёт ov.tint, а
             тот идёт за цветом строки (tintFromText), и волна оказывается
             одного тона со строкой, которая сейчас в кадре.
             За текстом фигура тише: там волна не должна спорить с набором. */
          resonance: Math.round((0.30 + punch * 0.45) * (inFront ? 1 : 0.65) * 100) / 100,
          inFront: inFront,
          // Фигура делит набор надвое: дубль под ней, текст над ней.
          textSplit: GHOSTED,
          textBand: textBand,
          place:   place,
          effect:  secFx,
          // Сила движения держится в мягкой части диапазона: у объекта
          // amt=0.9 на zoom — это ±50% масштаба за такт, фигура начинает
          // «дышать» на пол-кадра. Акцент даёт план и масштаб, а не амплитуда.
          // Амплитуда — от характера ЭПИЗОДА. От построчной фигура дышала
          // рывками: каждая строка меняла размах, и ровное движение
          // рассыпалось на несвязанные подёргивания.
          effectAmt: Math.round((0.20 + secPunch * 0.30) * 100) / 100,
          why:     type + ' · ' + blk.place + (inFront ? ' · перед' : ' · за') +
                   ' текстом, строка ' + (i + 1) +
                   (place !== blk.place ? ' (уступила тексту)' : ''),
        };
        lastEntry = stage[l.index];
      });
    });
    return stage;
  }

  /* Применяет разметку сцены к спрайту. apply=false — только отчёт. */
  function planCharacter(sections, lyr, bg, apply, stage) {
    const ov = findCharacterOverlay();
    const plan = [];
    if (!ov || !sections.length) return { overlay: ov, plan: plan };

    const st = stage || planStage(sections, lyr, bg);
    Object.keys(st).forEach(function(k) { plan.push(st[k]); });
    plan.sort(function(a, b) { return a.line - b.line; });

    /* ── НИЗ ФИГУРЫ ОБЯЗАН УХОДИТЬ ЗА КРАЙ КАДРА ──────────────
       y=56 стояло константой, и для типичной фигуры (высота ≈85% кадра)
       низ приходился на 98.5% высоты — то есть собственный прямой срез PNG
       заканчивался на полтора процента выше нижней границы и был ВИДЕН как
       горизонтальная линия. А дальше его возила анимация: 'presence' меняет
       масштаб, из-за чего этот срез ползал вверх-вниз через границу кадра.
       Стоящую фигуру в кино всегда режет край кадра — режет, а не «почти
       достаёт до него»: именно зазор превращает персонажа в наклейку.

       Считаем y так, чтобы низ гарантированно ушёл за границу с запасом
       BLEED, который заведомо больше амплитуды дыхания (макс. ≈3% высоты
       при amt=0.5). Тогда срез физически вне кадра, и его не видно никогда
       — ни в статике, ни на пике анимации. */
    const _cw = _canvasWidth(), _ch = _canvasHeight();
    const _aspect = (ov.img && ov.img.naturalWidth && ov.img.naturalHeight)
      ? (ov.img.naturalWidth / ov.img.naturalHeight) : null;
    if (_aspect) {
      /* 6 хватало ровно на дыхание фигуры (≈3%) и ни на что больше.
         По вертикали работает та же камера переднего плана, что и по
         горизонтали (см. SIDE_BLEED в planStage): пан по фокусу тянет
         передний план вверх до ~7.7% высоты, и низ фигуры на 106%
         возвращался в кадр — прямой срез PNG становился виден именно
         на движении, то есть там, где его сложнее всего списать.
         12 = 3 (дыхание) + 7.7 (пан) с округлением вверх. */
      const BLEED = 12;     // % высоты кадра — низ за границей
      const TOP_MIN = 2;    // % — макушка не должна вылезать за верх
      plan.forEach(function(p) {
        const hPct = ((p.width / 100) * _cw / _aspect) / _ch * 100;
        /* Фигура ниже половины кадра до низа не достанет при разумном y —
           тянуть её вниз ради «обреза» значило бы утопить её в кадре.
           Такую оставляем как есть: у неё срез и так далеко от границы и
           маскируется мягким краем (feather ниже). */
        if (hPct < 55) return;
        let y = 100 + BLEED - hPct / 2;
        // Макушку из кадра не выпускаем: если фигура выше кадра, поднимаем
        // ровно настолько, чтобы голова осталась внутри.
        const top = y - hPct / 2;
        if (top < TOP_MIN) y += (TOP_MIN - top);
        p.y = Math.round(y * 10) / 10;
        /* Низ ушёл за кадр — значит гасить его градиентом больше не нужно,
           а вредно: feather размывает ВСЕ четыре края бокса, и на фигуре в
           полный рост он съедал макушку и растворял ноги. Срез теперь
           прячет сам кадр, это честнее любой растушёвки. */
        p.feather = 0;
      });
    }

    if (apply && typeof BackgroundEngine !== 'undefined' && BackgroundEngine.updateOverlay) {
      const lineOverrides = {}, lineAnimations = {};
      plan.forEach(function(p) {
        /* feather / tint / tintAmt СЧИТАЛИСЬ в planStage и здесь молча
           терялись — в lineOverrides уходила только геометрия. То есть всё
           «вписывание фигуры в сцену», ради которого они и заведены (мягкий
           край вместо прямого среза + подмес света сцены, см. большой
           комментарий в _drawOverlayItem), НИ РАЗУ не доезжало до движка, и
           спрайт всё это время рисовался голой вырезкой с жёсткой границей.
           Вот откуда «наклейка»: дело было не в настройках, а в том, что
           посчитанные настройки не применялись.
           lineOverrides копирует любые ключи (см. цикл for..in в
           drawOverlays), так что достаточно их сюда положить. */
        lineOverrides[p.line] = {
          x: p.x, y: p.y, width: p.width, flipX: p.flipX,
          layer: p.layer, opacity: p.opacity, effectAmt: p.effectAmt,
          feather: p.feather, tint: p.tint, tintAmt: p.tintAmt,
          resonance: p.resonance,
          // Фигура делит набор надвое — см. planStage и drawOverlaysAll.
          textSplit: p.textSplit,
        };
        lineAnimations[p.line] = p.effect;
      });
      BackgroundEngine.updateOverlay(ov.id, {
        lineOverrides:  lineOverrides,
        lineAnimations: lineAnimations,
        /* Цвет фигуры идёт за цветом строки, которая сейчас в кадре, а не
           за одним тоном на весь клип. Тон, посчитанный ниже в tint,
           остаётся запасным — на случай строки без своего цвета. */
        tintFromText:   true,
        // Запасное значение на строки без разметки — построчное сильнее.
        resonance:      0.35,
        // Персонаж живёт весь клип — прятать его построчно нечем и незачем,
        // хореография и так меняет его от строки к строке.
        scope:          'global',
        audioReactive:  true,
        /* Фигура зумится ровно как фон: 1.0 — полная синхронность.
           Опасности «уехать из кадра» тут нет: движок применяет к объекту
           с camFollow ТОЛЬКО зум и вокруг точки самой фигуры, без переноса
           по фокусу относительно центра кадра (см. drawOverlaysAll). Именно
           перенос, а не зум, выбрасывал её за правый край в прошлый раз. */
        camFollow:      1.0,
      });
    }

    return { overlay: ov, plan: plan };
  }

  /* Снимает построчную хореографию — чтобы прогоны не наслаивались. */
  function clearCharacterPlan() {
    const ov = findCharacterOverlay();
    if (!ov || typeof BackgroundEngine === 'undefined' || !BackgroundEngine.updateOverlay) return false;
    BackgroundEngine.updateOverlay(ov.id, { lineOverrides: null, lineAnimations: null, resonance: 0 });
    return true;
  }

  /* ══════════════════════════════════════════════
     ГЛАВНЫЙ ПРОГОН
  ══════════════════════════════════════════════ */
  function analyze() {
    const el = document.getElementById('lyricsInput');
    const rawLyrics = el ? el.value : '';
    // Без текста режиссировать нечего — видео ведёт визуализатор по битам трека
    if (!rawLyrics.trim()) {
      if (typeof Visualizer !== 'undefined') {
        if (Visualizer.settings.preset === 'off') Visualizer.set({ preset: 'auto' });
        return { error: 'Текста нет — видео ведёт визуализатор по музыке (◉ ВИЗУАЛ), режим «' +
          (Visualizer.settings.preset === 'auto' ? 'авто' : Visualizer.settings.preset) + '».' };
      }
      return { error: 'Лирика пустая — вставь текст с таймкодами.' };
    }

    const entries = LRCParser.parse(rawLyrics);
    if (!entries.length) return { error: 'Не удалось разобрать лирику.' };

    const buffer = (typeof AudioEngine !== 'undefined') ? AudioEngine.buffer : null;
    const audio  = buffer ? analyzeAudio(buffer) : null;
    const dur    = audio ? audio.duration : entries[entries.length - 1].time + 5;

    const lyr        = analyzeLyrics(entries, dur);
    const sections   = buildStructure(audio, lyr);
    const bg         = analyzeBackground();
    /* Порядок обязателен и именно такой:
         1. партитура — задаёт ударность строк и габариты текста в кадре;
         2. персонаж  — встаёт в свободное от текста место;
         3. камера    — наводится на персонажа.
       Каждый следующий слой строится на предыдущем. Раньше все три
       считались независимо и совпадали только по таймкодам — отсюда и
       ощущение трёх отдельных видео, наложенных друг на друга. */
    // 1-й проход — габариты строк; 2-й — партитура, знающая мизансцену.
    const probe      = buildScore(audio, lyr, sections, { bg: bg });
    const stage      = planStage(sections, lyr, bg, probe.boxes);
    const score      = buildScore(audio, lyr, sections, { bg: bg, stage: stage });
    const character  = planCharacter(sections, lyr, bg, false, stage);
    const camera     = planCamera(sections, lyr, bg, false, character.plan);

    return { audio: audio, lyrics: lyr, sections: sections, bg: bg,
             score: score, camera: camera, character: character,
             stage: stage, entries: entries };
  }

  /* Применяет результат: базовый стиль + партитура в поле лирики. */
  function applyResult(result) {
    if (!result || result.error) return false;
    if (typeof FactoryPresets !== 'undefined') FactoryPresets.apply(result.score.styleId);

    // Хореография персонажа — построчные оверрайды на его image-объекте
    // Сцена уже посчитана в analyze — берём ту же, иначе фигура и текст
    // разъедутся: партитура ставилась под одну мизансцену, а фигура — под другую.
    const ch = planCharacter(result.sections, result.lyrics, result.bg, true,
                             result.stage);
    // Кино-сцены камеры — ставятся объектами в движок, а не тегами в лирику.
    // Ставятся ПОСЛЕ персонажа: фокус камеры наводится на него.
    planCamera(result.sections, result.lyrics, result.bg, true, ch.plan);

    const el = document.getElementById('lyricsInput');
    if (el) {
      el.value = result.score.lrc;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof PresetManager !== 'undefined' && PresetManager.scheduleAutosave)
      PresetManager.scheduleAutosave();
    return true;
  }

  function run() {
    const r = analyze();
    if (r.error) return r;
    applyResult(r);
    return r;
  }

  /* ══════════════════════════════════════════════
     UI
  ══════════════════════════════════════════════ */
  /* Названия и цвета типов секций, форматирование таймкода и раскладка
     полосок энергии жили здесь ради подробного отчёта. Отчёт сведён к двум
     строкам статуса (см. _renderReport), и всё это осталось без единого
     вызова — удалено, чтобы не выглядело работающей частью UI. */

  let _panel = null;
  let _last  = null;

  function _closePanel() { if (_panel) { _panel.remove(); _panel = null; } }

  function _openPanel() {
    if (_panel) { _closePanel(); return; }

    _panel = document.createElement('div');
    _panel.style.cssText = [
      'position:fixed','top:52px','right:16px','z-index:9999',
      'width:300px','max-height:78vh','overflow-y:auto',
      'background:#0d0d0d','border:1px solid #333','padding:14px',
      "font-family:'Space Mono',monospace",'color:#ddd',
      'box-shadow:0 12px 40px rgba(0,0,0,.7)',
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
    head.innerHTML = '<span style="font-size:10px;letter-spacing:2px;color:#e8ff00;">АВТО-РЕЖИССЁР</span>';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.cssText = 'background:transparent;border:none;color:#666;cursor:pointer;font-size:12px;';
    close.addEventListener('click', _closePanel);
    head.appendChild(close);
    _panel.appendChild(head);

    const body = document.createElement('div');
    body.id = 'autoDirectorBody';
    body.style.cssText = 'font-size:9px;color:#888;line-height:1.6;';
    body.textContent = 'Анализирую трек и лирику…';
    _panel.appendChild(body);

    document.body.appendChild(_panel);

    // Даём кадр на отрисовку — анализ синхронный и тяжёлый
    setTimeout(function() {
      let r;
      try { r = analyze(); }
      catch (e) { console.error('[AutoDirector]', e); r = { error: 'Ошибка анализа: ' + e.message }; }
      _last = r;
      _renderReport(body, r);
    }, 50);
  }

  /* Отчёт намеренно КОРОТКИЙ.
     Раньше здесь печаталась вся партитура: темп, плотность, базовый стиль,
     цвета фона, список секций с полосками энергии, все сцены камеры и карта
     поз персонажа на 24 строки. Всё это — то, что режиссёр и так сделает
     сам; читать простыню перед нажатием «Применить» никто не будет, а
     решение по ней всё равно не принимается. Панель отвечает ровно на два
     вопроса, ради которых её и открывают: нашёлся ли текст и нашёлся ли
     спрайт. Подробности при необходимости лежат в _last (см. window). */
  function _renderReport(body, r) {
    body.innerHTML = '';
    if (r.error) {
      body.innerHTML = '<div style="color:#ff5c5c;font-size:9px;">' + r.error + '</div>';
      return;
    }

    function status(label, ok, text) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:baseline;padding:5px 0;font-size:10px;';
      row.innerHTML =
        '<span style="width:64px;color:#666;letter-spacing:1px;">' + label + '</span>' +
        '<span style="flex:1;color:' + (ok ? '#7dffb0' : '#ff9a4a') + ';">' +
          (ok ? '✔ ' : '✕ ') + text + '</span>';
      body.appendChild(row);
    }

    // Считаем ПОЮЩИЕСЯ строки: техничеcкие и пустые попадают в разбор, но
    // «нашёлся текст» — это про то, что есть чему играть.
    const nLines = (r.lyrics && r.lyrics.lines)
      ? r.lyrics.lines.filter(function(l) { return l.text && l.text.trim(); }).length
      : 0;
    status('ТЕКСТ', nLines > 0,
      nLines > 0 ? ('найден, ' + nLines + ' стр.') : 'не найден');

    const ch = r.character;
    const hasCh = !!(ch && ch.overlay && ch.plan && ch.plan.length);
    status('СПРАЙТ', hasCh,
      hasCh ? ('найден: ' + (ch.overlay.name || ch.overlay.id)) : 'не найден');

    if (!hasCh) {
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:8px;color:#666;line-height:1.5;margin:2px 0 8px 72px;';
      hint.textContent = 'Загрузи PNG с прозрачностью как объект — режиссёр сам ' +
        'расставит его по строкам. Если объектов несколько, назови нужный ' +
        '«герой» / «hero» / «char».';
      body.appendChild(hint);
    }

    const note = document.createElement('div');
    note.style.cssText = 'font-size:8px;color:#666;line-height:1.5;margin:10px 0;';
    note.textContent = 'Применение перезапишет поле лирики: текст и таймкоды сохранятся.';
    body.appendChild(note);

    /* Основной путь — спокойный режиссёр лирик-видео (LyricDirector):
       текст на одном месте, одна подача, припев чуть крупнее, движение —
       от визуализатора. Старая партитура осталась вторым пунктом. */
    if (typeof LyricDirector !== 'undefined') {
      const calm = document.createElement('button');
      calm.textContent = '✅ ЛИРИК-ВИДЕО (СПОКОЙНО)';
      calm.title = 'Текст на одном месте, плавное появление, припев чуть крупнее; фон и камера не дёргаются построчно. Твой шрифт, рамка и перевод остаются.';
      calm.style.cssText = 'width:100%;background:#e8ff00;border:none;color:#000;' +
        "font-family:'Space Mono',monospace;font-size:9px;letter-spacing:2px;padding:9px;cursor:pointer;margin-bottom:6px;";
      calm.addEventListener('click', function() {
        const rep = LyricDirector.run();
        calm.textContent = '✔ ГОТОВО: строк ' + rep.lines + ', припев ' + rep.chorus;
        calm.style.background = '#7dffb0';
        setTimeout(_closePanel, 1200);
      });
      body.appendChild(calm);
      const calmNote = document.createElement('div');
      calmNote.style.cssText = 'font-size:8px;color:#666;line-height:1.5;margin:0 0 10px;';
      calmNote.textContent = 'Уберёт построчные теги и команды фона. Таймкоды, слова, метки частей, перевод и конец видео останутся.';
      body.appendChild(calmNote);
    }

    const apply = document.createElement('button');
    apply.textContent = 'СТАРАЯ ПАРТИТУРА (ЭКСПЕРИМЕНТ)';
    apply.style.cssText = 'width:100%;background:transparent;border:1px solid #444;color:#888;' +
      "font-family:'Space Mono',monospace;font-size:9px;letter-spacing:2px;padding:7px;cursor:pointer;";
    apply.addEventListener('click', function() {
      applyResult(_last);
      apply.textContent = '✔ ПРИМЕНЕНО';
      apply.style.background = '#7dffb0';
      setTimeout(_closePanel, 700);
    });
    body.appendChild(apply);
  }

  function buildUI() {
    const header = document.querySelector('header') || document.querySelector('.header');
    if (!header || document.getElementById('autoDirectorBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'autoDirectorBtn';
    btn.style.cssText = [
      'background:transparent','border:1px solid #e8ff00','color:#e8ff00',
      "font-family:'Space Mono',monospace",
      'font-size:9px','letter-spacing:2px','text-transform:uppercase',
      'padding:6px 12px','cursor:pointer','margin-right:6px',
    ].join(';');
    btn.textContent = '🎛 АВТО-РЕЖИССЁР';
    btn.title = 'Проанализировать темп, структуру и размер лирики и собрать видео автоматически';

    const anchor = document.getElementById('factoryPresetBtn') || document.getElementById('presetBtn');
    if (anchor && anchor.parentNode === header) header.insertBefore(btn, anchor);
    else header.appendChild(btn);

    btn.addEventListener('click', _openPanel);
  }

  return {
    buildUI:        buildUI,
    analyze:        analyze,
    run:            run,
    applyResult:    applyResult,
    analyzeAudio:   analyzeAudio,
    analyzeLyrics:  analyzeLyrics,
    analyzeBackground: analyzeBackground,
    buildStructure: buildStructure,
    buildScore:     buildScore,
    countSyllables: countSyllables,
    planCamera:     planCamera,
    clearDirectorScenes: clearDirectorScenes,
    planStage:      planStage,
    planCharacter:  planCharacter,
    clearCharacterPlan: clearCharacterPlan,
    findCharacterOverlay: findCharacterOverlay,
  };
})();
