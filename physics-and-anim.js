/* ═══════════════════════════════════════════════
   js/physics-and-anim.js  (v2 — retimed & improved)
═══════════════════════════════════════════════ */

/* ── FrequencyBands ─────────────────────────── */
const FrequencyBands = (() => {
  let smooth = { bass: 0, mid: 0, high: 0, overall: 0 };

  function hzToBin(hz, sr, fftSize) {
    return Math.floor(hz / (sr / fftSize));
  }

  function bandEnergy(data, lo, hi, sr, fftSize) {
    const a = hzToBin(lo, sr, fftSize);
    const b = Math.min(hzToBin(hi, sr, fftSize), data.length - 1);
    let sum = 0;
    for (let i = a; i <= b; i++) sum += data[i];
    return sum / ((b - a + 1) * 255);
  }

  function analyze(data, sr = 44100, fftSize = 1024, dt = 1 / 60) {
    const raw = {
      bass:    bandEnergy(data,   20,   200, sr, fftSize),
      mid:     bandEnergy(data,  200,  4000, sr, fftSize),
      high:    bandEnergy(data, 4000, 16000, sr, fftSize),
      overall: bandEnergy(data,   20, 20000, sr, fftSize),
    };
    // Время-доменное сглаживание: alpha = 1 - exp(-dt/tau).
    // Tau подобраны так, чтобы при dt=1/60 давать те же значения alpha,
    // что и старые пофреймовые коэффициенты (0.35/0.08/0.45/0.12).
    // Результат одинаков при любом fps — в превью и в экспорте.
    //   bass attack  0.35 @ 60fps → tau ≈ 0.039s
    //   bass decay   0.08 @ 60fps → tau ≈ 0.200s
    //   other attack 0.45 @ 60fps → tau ≈ 0.028s
    //   other decay  0.12 @ 60fps → tau ≈ 0.131s
    for (const k in raw) {
      const tau = raw[k] > smooth[k]
        ? (k === 'bass' ? 0.039 : 0.028)
        : (k === 'bass' ? 0.200 : 0.131);
      const alpha = 1 - Math.exp(-dt / tau);
      smooth[k] += (raw[k] - smooth[k]) * alpha;
    }
    return { ...smooth };
  }

  return { analyze };
})();


/* ── SpringPhysics ──────────────────────────── */
class SpringPhysics {
  constructor({ stiffness = 0.25, damping = 0.45, initial = 0 } = {}) {
    this.k        = stiffness;
    this.d        = damping;
    this.value    = initial;
    this.velocity = 0;
    this.target   = initial;
  }

  update(dt = 0.016) {
    // Frame-rate independent: нормализуем к 60fps-шагам через суб-шаги.
    // Коэффициенты k и d рассчитаны под шаг 1/60s.
    // При 30fps → 2 суб-шага по 1/60s → результат идентичен 60fps.
    // При 120fps → 0.5 шага (s=0.5) → точно половина 60fps-шага.
    // Старый код: value += velocity * dt * 60
    //   при 30fps: velocity * 2.0 — пружина прыгает в 2× дальше → дёрганье в экспорте.
    const dtNorm = dt * 60;                        // 1.0 @ 60fps, 2.0 @ 30fps
    const steps  = Math.max(1, Math.round(dtNorm));
    const s      = dtNorm / steps;                 // дробный шаг на суб-итерацию
    for (let i = 0; i < steps; i++) {
      const disp     = this.value - this.target;
      const accel    = -this.k * disp - this.d * this.velocity;
      this.velocity += accel * s;
      this.value    += this.velocity * s;
    }
    return this.value;
  }

  reset(val) {
    this.value    = val ?? this.target;
    this.velocity = 0;
  }

  impulse(v) { this.velocity += v; }
}


/* ── AnimModes ──────────────────────────────── */

/**
 * Точный замер ширины слов через Canvas API.
 * Используется кинетическими режимами (impact, parallax) для корректной
 * горизонтальной раскладки. Без реального измерения слова накладываются
 * друг на друга в кириллице и любых пропорциональных шрифтах.
 *
 * Если ctx или font не переданы (напр. старый вызывающий код) —
 * возвращает приблизительную ширину. Это fallback, но в нормальных
 * условиях App.js и ExportEngine передают оба параметра.
 */
function _measureWordsPx(ctx, words, fontSize, font) {
  if (!ctx || typeof ctx.measureText !== 'function' || !font) {
    return words.map(w => w.length * fontSize * 0.55);   // fallback
  }
  const prevFont = ctx.font;
  ctx.font = `${fontSize}px ${font}`;
  const widths = words.map(w => ctx.measureText(w).width);
  ctx.font = prevFont;
  return widths;
}

/**
 * Горизонтальная раскладка слов В СТРОКУ.
 * Используется режимами которые работают с единой камерой над строкой
 * (montage, drift). Без этого слова раскидываются по 2D-сетке на весь
 * canvas и строка становится нечитаемой — камера физически не может
 * показать 5 слов в разных углах одновременно.
 *
 * Возвращает:
 *   positions[i] = { x, y, w }  — позиция центра слова в world-space (0,0 = центр строки)
 *   totalW                      — общая ширина строки
 *   gap                         — зазор между слов, используется для layout-capacity
 *
 * yRhythm ∈ [0..1] — сила вертикального "ритма" (seeded jitter).
 *   0 = идеально ровная строка, 1 = жирный ритм (±0.5 fontSize).
 *   По умолчанию 0.28 — небольшая игра без потери читаемости.
 */
function _horizontalLineLayout(ctx, words, fontSize, font, hashFn, yRhythm = 0.28) {
  const n = words.length;
  const widths = _measureWordsPx(ctx, words, fontSize, font);
  const gap    = fontSize * 0.55;
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * Math.max(n - 1, 0);

  const positions = [];
  let cursor = -totalW / 2;
  for (let i = 0; i < n; i++) {
    const w = widths[i];
    const cx = cursor + w / 2;
    // Y-ритм: seeded (если hashFn передан) или 0. ±0.14 fs при yRhythm=0.28.
    const cy = hashFn
      ? (hashFn(i + 1, 11) - 0.5) * fontSize * yRhythm
      : 0;
    positions.push({ x: cx, y: cy, w });
    cursor += w + gap;
  }
  return { positions, totalW, gap };
}

const AnimModes = {

  pulse({ bands, t, params, springs }) {
    // Плавный масштаб от баса
    springs.scale.target = Math.min(1 + bands.bass * params.bassSens * 0.8, params.maxScale);
    
    // Лёгкое дыхание от mid-частот (медленная синусоида)
    const breathe = Math.sin(t * 1.2) * bands.mid * 0.03;
    
    // Плавное смещение по X от high-частот (вместо резкого глитча)
    springs.offsetX.target = bands.high > 0.3 ? Math.sin(t * 2.5) * bands.high * 8 : 0;
    
    return { 
      scaleX: springs.scale.value * (1 + breathe), 
      scaleY: springs.scale.value * (1 - breathe * 0.5), 
      offsetX: springs.offsetX.value, 
      offsetY: 0, 
      alpha: 1 
    };
  },

  bounce({ bands, t, params, springs }) {
    springs.scale.target   = Math.min(1 + bands.bass * params.bassSens * 0.6, params.maxScale);
    springs.offsetY.target = bands.bass > 0.35 ? -bands.bass * 55 : 0;
    return { scaleX: springs.scale.value, scaleY: springs.scale.value, offsetX: 0, offsetY: springs.offsetY.value, alpha: 1 };
  },



  shake({ bands, t, params, springs }) {
    springs.scale.target = Math.min(1 + bands.bass * params.bassSens * 0.9, params.maxScale);
    
    // Тряска только при сильном басе (порог 0.4)
    const threshold = 0.4;
    const intensity = bands.bass > threshold ? (bands.bass - threshold) / (1 - threshold) : 0;
    
    // Плавная низкочастотная тряска с использованием springs
    // Целевые значения для плавного движения
    const targetX = Math.sin(t * 3.7) * intensity * 12;
    const targetY = Math.sin(t * 2.3) * intensity * 6;
    
    // Используем springs для сглаживания (создаём плавное следование за целью)
    springs.offsetX.target = targetX;
    springs.offsetY.target = targetY;
    
    // Очень лёгкое вращение только на пиках
    const rotation = bands.bass > 0.65 ? Math.sin(t * 2.1) * (bands.bass - 0.65) * 0.04 : 0;
    
    return { 
      scaleX: springs.scale.value, 
      scaleY: springs.scale.value, 
      offsetX: springs.offsetX.value, 
      offsetY: springs.offsetY.value, 
      rotation, 
      alpha: 1 
    };
  },

  zoom({ bands, t, params, springs }) {
    // Плавный зум с минимальной амплитудой — база 0.95, макс прирост ~0.3
    springs.scale.target = Math.min(0.95 + bands.overall * params.bassSens * 0.3, params.maxScale);
    // Лёгкое дыхание для органичности
    const breathe = 1 + Math.sin(t * 1.5) * bands.mid * 0.03;
    return { scaleX: springs.scale.value * breathe, scaleY: springs.scale.value * breathe, offsetX: 0, offsetY: 0, alpha: 1 };
  },

  spin({ bands, t, params, springs }) {
    springs.scale.target = Math.min(1 + bands.bass * params.bassSens * 0.7, params.maxScale);
    const rotation = t * (0.5 + bands.mid * 3.5) * 0.3;
    return { scaleX: springs.scale.value, scaleY: springs.scale.value, offsetX: 0, offsetY: 0, rotation, alpha: 1 };
  },



  cinematic({ bands, t, params, springs }) {
    springs.scale.target = Math.min(0.92 + bands.overall * params.bassSens * 0.5, params.maxScale * 0.9);
    const camX = (Math.sin(t * 7.3) * 0.4 + Math.sin(t * 13.7) * 0.3) * (1 + bands.bass * 2);
    const camY = (Math.cos(t * 5.1) * 0.3 + Math.cos(t * 11.3) * 0.2) * (1 + bands.bass * 2);
    return { scaleX: springs.scale.value, scaleY: springs.scale.value, offsetX: camX, offsetY: camY, rotation: Math.sin(t * 3.9) * 0.005, alpha: 1 };
  },

  /* ═══════════════════════════════════════════════
     КИНЕТИЧЕСКИЕ РЕЖИМЫ — per-word позиционирование
     Возвращают { wordLayout: true, words: [...] }
     x,y — смещение от центра холста (0,0)
     scale — итоговый масштаб (НЕ умножается на fontScale в рендерере)
  ═══════════════════════════════════════════════ */

  // 1. FLASH — слова строго по центру, сменяются одно за другим
  flash({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n       = words.length;
    const wordDur = Math.max(0.08, duration / n);
    const wordIdx = Math.min(Math.floor(elapsed / wordDur), n - 1);

    const wordEntryT = elapsed - wordIdx * wordDur;
    const progress   = Math.min(wordEntryT / wordDur, 1);

    const baseScale  = 1 + bands.bass * params.bassSens * 0.5;
    const entryScale = Math.min(wordEntryT / (wordDur * 0.15), 1);
    const exitAlpha  = progress > 0.85 ? 1 - (progress - 0.85) / 0.15 : 1;

    const wl = words.map((word, i) => ({
      word,
      x:        0,
      y:        0,
      scale:    i === wordIdx ? baseScale * entryScale : 0,
      alpha:    i === wordIdx ? exitAlpha : 0,
      rotation: 0,
    }));

    return { wordLayout: true, words: wl };
  },

  // 2. CASCADE — диагональная лесенка, каждое слово на своей ступени
  cascade({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;
    // Шаг: ширина одного слова ~= fontSize * 0.65 символов в среднем
    // Делаем фиксированный шаг по X и Y независимо от длины слов
    const stepX      = fontSize * 1.1;  // горизонтальный шаг
    const stepY      = fontSize * 0.75; // вертикальный шаг
    const totalW     = stepX * (n - 1);
    const totalH     = stepY * (n - 1);
    const revealDur  = Math.min(duration * 0.7, 1.5);
    const baseScale  = 1 + bands.bass * params.bassSens * 0.2;

    const wl = words.map((word, i) => {
      const wordRevealT = (i / Math.max(n - 1, 1)) * revealDur;
      const revealed    = Math.max(0, Math.min((elapsed - wordRevealT) / 0.15, 1));
      return {
        word,
        x:        -totalW / 2 + i * stepX,
        y:        -totalH / 2 + i * stepY,
        scale:    baseScale * revealed,
        alpha:    revealed,
        rotation: 0,
      };
    });

    return { wordLayout: true, words: wl };
  },

  // 3. SNAP — зигзаг: слова разного размера, смещены влево/вправо, без поворотов
  snap({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n         = words.length;
    const revealDur = Math.min(duration * 0.65, 1.8);
    const basePulse = 1 + bands.bass * params.bassSens * 0.2;
    const lineH     = fontSize * 1.2;
    const totalH    = lineH * n;

    // Зигзаг-смещения и размеры для каждой позиции
    const xOffsets   = [0, fontSize * 2.2, -fontSize * 1.5, fontSize * 1.0, -fontSize * 2.0, fontSize * 1.8, -fontSize * 1.2];
    const sizeFactors = [1.5, 0.8, 1.15, 0.7, 1.3, 0.75, 1.0];

    const wl = words.map((word, i) => {
      const wordRevealT = (i / Math.max(n - 1, 1)) * revealDur;
      const revealed    = Math.max(0, Math.min((elapsed - wordRevealT) / 0.12, 1));
      const sf          = sizeFactors[i % sizeFactors.length];
      return {
        word,
        x:        xOffsets[i % xOffsets.length],
        y:        -totalH / 2 + i * lineH + lineH / 2,
        scale:    sf * basePulse * revealed,
        alpha:    revealed,
        rotation: 0,
      };
    });

    return { wordLayout: true, words: wl };
  },

  // 4. SCATTER — хаос: слова влетают с разных сторон, каждая строфа уникальна
  scatter({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    // ── Уникальный сид на основе содержимого строки ──────────────────
    // Каждая строфа получает свой набор позиций/углов
    let lineSeed = 0;
    for (let i = 0; i < words.length; i++) {
      const code = words[i] ? words[i].charCodeAt(0) : 0;
      lineSeed = (lineSeed * 31 + code * (i + 1) * 7 + words[i].length * 13) | 0;
    }
    lineSeed = Math.abs(lineSeed % 9973) + 1;

    function seededRand(seed) {
      let s = (seed * lineSeed * 1664525 + 1013904223) | 0;
      s ^= s >> 13; s ^= s << 17; s ^= s >> 5;
      return (s >>> 0) / 4294967296;
    }

    // ── Безопасные зоны: слова не вылетают за края ───────────────────
    const padX = fontSize * 1.8;
    const padY = fontSize * 1.2;
    const halfW = canvasW / 2 - padX;
    const halfH = canvasH / 2 - padY;

    // ── Распределение позиций: «взрывной» алгоритм ───────────────────
    // Делим экран на случайные ячейки, внутри каждой — случайная точка
    const zones = [];
    if (n === 1) {
      zones.push({ x: 0, y: 0 });
    } else if (n === 2) {
      const side = seededRand(3) > 0.5 ? 1 : -1;
      zones.push({ x: -halfW * 0.55 * side, y: (seededRand(5) - 0.5) * halfH });
      zones.push({ x:  halfW * 0.55 * side, y: (seededRand(9) - 0.5) * halfH });
    } else {
      // Сетка с дрожащими ячейками — уникальная каждый раз
      const cols = n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const cellW = (halfW * 2) / cols;
      const cellH = (halfH * 2) / rows;
      for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx  = -halfW + cellW * col + cellW / 2;
        const cy  = -halfH + cellH * row + cellH / 2;
        // Смещение занимает 55% ячейки — слова никогда не слипаются
        const jx  = (seededRand(i * 7 + 11) - 0.5) * cellW * 0.55;
        const jy  = (seededRand(i * 13 + 3) - 0.5) * cellH * 0.55;
        zones.push({ x: cx + jx, y: cy + jy });
      }
    }

    // ── Параметры входного движения ───────────────────────────────────
    const revealDur = Math.min(duration * 0.45, 0.9);
    // Каждое слово влетает с уникального угла — «взрыв» или «разлёт»
    const burstMode = seededRand(99) > 0.4; // 60% — центробежный взрыв, 40% — влёт с краёв
    const flyDist   = Math.max(canvasW, canvasH) * 0.55;

    // ── Бас-реакция ───────────────────────────────────────────────────
    const bassOver   = Math.max(0, bands.bass - 0.3) * params.bassSens;
    const bassImpact = bassOver * 14;

    const wl = words.map((word, i) => {
      const r1 = seededRand(i * 7  + 1);
      const r2 = seededRand(i * 11 + 5);
      const r3 = seededRand(i * 5  + 17);
      const r4 = seededRand(i * 17 + 9);
      const r5 = seededRand(i * 3  + 23);

      // Целевая позиция
      const tx = zones[i].x;
      const ty = zones[i].y;

      // Стартовая позиция (откуда влетает)
      let sx, sy;
      if (burstMode) {
        // Из центра наружу
        const dist = flyDist * (0.7 + r1 * 0.6);
        const angle = r2 * Math.PI * 2;
        sx = Math.cos(angle) * dist;
        sy = Math.sin(angle) * dist;
      } else {
        // С края экрана
        const edge = Math.floor(r1 * 4); // 0=top 1=right 2=bottom 3=left
        const spread = 0.8;
        if (edge === 0)      { sx = (r2 - 0.5) * canvasW * spread; sy = -halfH - fontSize * 2; }
        else if (edge === 1) { sx =  halfW + fontSize * 2; sy = (r2 - 0.5) * canvasH * spread; }
        else if (edge === 2) { sx = (r2 - 0.5) * canvasW * spread; sy =  halfH + fontSize * 2; }
        else                 { sx = -halfW - fontSize * 2; sy = (r2 - 0.5) * canvasH * spread; }
      }

      // Задержка и прогресс
      const wordRevealT = (i / Math.max(n - 1, 1)) * revealDur * 0.65;
      const rawT        = Math.max(0, elapsed - wordRevealT);
      const flyDur      = 0.22 + r3 * 0.1; // 220–320мс полёт
      const flyProg     = Math.min(rawT / flyDur, 1);
      // Ease out cubic: резкий старт, плавное приземление
      const eased       = 1 - Math.pow(1 - flyProg, 3);
      // Alpha: появляется в начале полёта
      const alpha       = Math.min(rawT / (flyDur * 0.35), 1);

      // Текущая позиция
      const x = sx + (tx - sx) * eased;
      const y = sy + (ty - sy) * eased;

      // Вращение: умеренное ±22°, с лёгким доворотом при влёте
      const baseRot  = (r4 - 0.5) * Math.PI * 0.38;       // ±22°
      const flyRot   = (1 - eased) * (r5 - 0.5) * 0.5;    // доворот при влёте
      const bassRot  = bassOver > 0.2 ? Math.sin(t * 5.3 + i * 1.8) * bassOver * 0.1 : 0;

      // Размер: разнообразный, но адекватный (0.65x – 1.6x)
      const sizeFactor = 0.65 + r5 * 0.95;

      // Бас-дёргание: каждое слово в своём направлении
      const shakeAngle = r1 * Math.PI * 2;
      const shakeX = Math.cos(shakeAngle + t * 9) * bassImpact * eased;
      const shakeY = Math.sin(shakeAngle + t * 7) * bassImpact * 0.7 * eased;

      // Лёгкое дыхание после приземления
      const breathX = eased > 0.95 ? Math.sin(t * 0.9 + r1 * 6.28) * 2.5 : 0;
      const breathY = eased > 0.95 ? Math.cos(t * 0.7 + r2 * 6.28) * 1.8 : 0;

      return {
        word,
        x:        x + shakeX + breathX,
        y:        y + shakeY + breathY,
        scale:    sizeFactor * alpha * (1 + bands.bass * params.bassSens * 0.14),
        alpha,
        rotation: baseRot + flyRot + bassRot,
      };
    });

    return { wordLayout: true, words: wl };
  },

  // 5. PATH — слова вдоль синусоидальной волны
  path({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n         = words.length;
    const revealDur = Math.min(duration * 0.7, 2.0);
    const amplitude = canvasH * 0.16 * (1 + bands.mid * 0.4);
    const pathW     = Math.min(canvasW * 0.75, fontSize * 1.2 * n);

    const wl = words.map((word, i) => {
      const progress    = n > 1 ? i / (n - 1) : 0.5;
      const px          = (progress - 0.5) * pathW;
      const phase       = progress * Math.PI * 2.5 + t * 1.2;
      const py          = Math.sin(phase) * amplitude;
      // Наклон по касательной (приглушённый)
      const dpdy        = Math.cos(phase) * amplitude * Math.PI * 2.5 / pathW;
      const angle       = Math.atan(dpdy) * 0.35;

      const wordRevealT = (i / Math.max(n - 1, 1)) * revealDur;
      const revealed    = Math.max(0, Math.min((elapsed - wordRevealT) / 0.15, 1));
      const baseScale   = 1 + bands.bass * params.bassSens * 0.25;

      return {
        word,
        x:        px,
        y:        py,
        scale:    baseScale * revealed,
        alpha:    revealed,
        rotation: angle,
      };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     6. IMPACT — «Импакт»
     Вокалоидное вбивание слов с shock-wave:
     - каждое слово staggered влетает из глубины (scale 2.8 → 0.85)
     - overshoot-bounce при приземлении (0.85 → 1.18 → 1.0)
     - соседние слова отскакивают от ударной волны только что приземлившегося
     - на бас после сборки вся строка пульсирует как от subwoofer'а
     - layout считается через ctx.measureText — слова гарантированно не слипаются
  ═══════════════════════════════════════════════ */
  impact({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    // ── ТОЧНЫЙ замер каждой слова через Canvas API (если ctx передан) ──
    // Это критически важно: без реального измерения на разных шрифтах
    // и в кириллице слова накладываются (напр. "Среди прочих космоса").
    //
    // Layout основан на СЛОТАХ: каждое слово получает слот = width × 1.22.
    // Множитель 1.22 компенсирует overshoot-scale 1.18 + запас на jitter.
    // Без этого на пике отскока края слов заезжают на соседей.
    // Плюс фиксированный wordGap = 0.35× fontSize — это гарантированный
    // пробел между слотами, визуально воспринимаемый как "пробел".
    const baseWidths = _measureWordsPx(ctx, words, fontSize, font);
    const SLOT_PAD   = 1.22;
    const slots      = baseWidths.map(w => w * SLOT_PAD);
    const wordGap    = fontSize * 0.35;
    const totalW     = slots.reduce((a, b) => a + b, 0) + wordGap * (n - 1);

    const startXs = [];
    let cursor = -totalW / 2;
    for (let i = 0; i < n; i++) {
      startXs.push(cursor + slots[i] / 2);             // центр слота
      cursor += slots[i] + wordGap;
    }

    // Длительность одного удара + шаг между словами (ритмичное вбивание)
    const impactDur     = 0.34;
    const impactStagger = Math.min(0.14, Math.max(0.05, duration * 0.18 / Math.max(n, 1)));

    // Пост-сборка: реакция всей строки на бас
    const bassOver = Math.max(0, bands.bass - 0.32) * params.bassSens;

    const wl = words.map((word, i) => {
      const wordStart = i * impactStagger;
      const wordT     = Math.max(0, elapsed - wordStart);
      const rawProg   = Math.min(wordT / impactDur, 1);

      let scale, alpha, yOffset, rot;

      if (rawProg < 0.5) {
        // Фаза 1: влёт из глубины. Резкий старт, плавная посадка.
        const p       = rawProg / 0.5;
        const easedIn = 1 - Math.pow(1 - p, 2.8);
        scale   = 2.8 - easedIn * 1.95;                                // 2.8 → 0.85
        alpha   = Math.min(p * 2.2, 1);
        yOffset = -(1 - easedIn) * fontSize * 0.45;                    // падает сверху
        rot     = (1 - easedIn) * 0.09 * (i % 2 === 0 ? 1 : -1);       // лёгкий крен
      } else if (rawProg < 0.78) {
        // Фаза 2: overshoot-bounce — пружинный отскок
        const p = (rawProg - 0.5) / 0.28;
        scale   = 0.85 + Math.sin(p * Math.PI) * 0.33;                 // up-и-вниз, пик 1.18
        alpha   = 1;
        yOffset = 0;
        rot     = 0;
      } else {
        // Фаза 3: settle
        const p = (rawProg - 0.78) / 0.22;
        scale   = 0.85 + 0.15 * (1 - Math.pow(1 - p, 2));              // плавно к 1.0
        alpha   = 1;
        yOffset = 0;
        rot     = 0;
      }

      // ── Shock-wave: если сосед только что ударил в пол, нас отталкивает ──
      // Амплитуда уменьшена до 0.06, чтобы отскок не заезжал на соседа.
      let wobble = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const jT = elapsed - j * impactStagger;
        const wavePeak = impactDur * 0.5;
        if (jT > wavePeak && jT < wavePeak + 0.18) {
          const dist    = Math.abs(i - j);
          const falloff = 1 / (1 + dist * 1.6);
          const phase   = (jT - wavePeak) / 0.18;
          const dir     = i > j ? 1 : -1;
          wobble += Math.sin(phase * Math.PI) * fontSize * 0.06 * falloff * dir;
        }
      }

      // ── Пост-сборка: ритмичное дыхание + бас-kick ──
      if (rawProg >= 1) {
        scale   *= 1 + bassOver * 0.12;      // уменьшил с 0.14 — стабильнее
        yOffset += Math.sin(i * 0.7 + t * 2.1) * 1.4;
        if (bassOver > 0.25) {
          wobble += Math.sin(t * 22 + i * 1.7) * bassOver * fontSize * 0.03;
        }
      }

      return {
        word,
        x:        startXs[i] + wobble,
        y:        yOffset,
        scale,
        alpha,
        rotation: rot,
      };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     7. PARALLAX — «Паралакс»
     Настоящий 2.5D: каждое слово живёт на своей «глубине» z.
     - дальние слова: мелкие, полупрозрачные, сверху, появляются первыми
     - ближние: крупные, яркие, внизу, появляются последними (с zoom-in)
     - «камера» плавно качается по X и слегка по Y
     - на бас — резкий push камеры; БЛИЗКИЕ слова двигаются СИЛЬНЕЕ дальних
       (это и есть классический параллакс — именно он делает 2.5D-ощущение)
     - layout через ctx.measureText с учётом scale каждого слова
  ═══════════════════════════════════════════════ */
  parallax({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    // ── Seeded random: одна строка → одна "композиция", детерминированная ──
    let contentSeed = 0;
    for (let i = 0; i < words.length; i++) {
      contentSeed = (contentSeed * 31 + words[i].charCodeAt(0) * (i + 1)) | 0;
    }
    contentSeed = Math.abs(contentSeed % 9973) + 1;

    function hash(i, salt) {
      let s = ((i * 2654435761) ^ (salt * contentSeed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    // ═══════════════════════════════════════════════
    // ТРЁХСЛОЙНАЯ СИСТЕМА (Vocaloid PV / Limbo-style 2.5D)
    // Вместо seeded random глубин — ЖЁСТКИЕ планы с чёткими характеристиками:
    //   0 = BACKGROUND  (далеко: мелкие, прозрачные, высоко, почти не двигаются)
    //   1 = MIDGROUND   (средне: базовый размер, centerline)
    //   2 = FOREGROUND  (близко: крупные, яркие, низко, сильный parallax)
    // Распределение: ~20% fg, ~40% mid, ~40% bg, но с гарантией что
    // в строке есть хотя бы один foreground (иначе нет акцента).
    // ═══════════════════════════════════════════════
    const layers = words.map((_, i) => {
      const r = hash(i + 1, 7);
      if (r < 0.20) return 2;        // foreground
      if (r < 0.58) return 0;        // background
      return 1;                      // midground (default)
    });
    // Гарантия акцента: если нет ни одного foreground — делаем его из середины
    if (!layers.includes(2) && n > 0) {
      layers[Math.floor(n / 2)] = 2;
    }

    // Параметры для каждого слоя
    const LAYER_CFG = {
      // [scale, alpha, parallaxFactor, idleAmplitude, yRangeFactor]
      0: { scale: 0.48, alpha: 0.42, pxFactor: 0.25, idleAmp: 0.35, yBias: -0.55 },  // bg
      1: { scale: 0.92, alpha: 0.82, pxFactor: 0.95, idleAmp: 0.70, yBias:  0.00 },  // mid
      2: { scale: 1.55, alpha: 1.00, pxFactor: 2.05, idleAmp: 1.00, yBias:  0.35 },  // fg
    };

    // Y-позиция: слой даёт базовый диапазон + seeded jitter внутри слоя
    const layerY = words.map((_, i) => {
      const cfg  = LAYER_CFG[layers[i]];
      const jit  = (hash(i + 13, 11) - 0.5) * fontSize * 0.45;   // индивид. jitter
      return cfg.yBias * fontSize + jit;
    });

    // ── SLOT layout: max scale с запасом на zoom-in overshoot ──
    const baseWidths = _measureWordsPx(ctx, words, fontSize, font);
    const slots = words.map((_, i) => {
      const cfg = LAYER_CFG[layers[i]];
      // foreground в момент появления делает zoom-in до 1.35× target
      const zmax = layers[i] === 2 ? 1.35 : 1.08;
      return baseWidths[i] * cfg.scale * zmax;
    });
    const wordGap = fontSize * 0.42;
    const totalW  = slots.reduce((a, b) => a + b, 0) + wordGap * (n - 1);

    const startXs = [];
    let cursor = -totalW / 2;
    for (let i = 0; i < n; i++) {
      startXs.push(cursor + slots[i] / 2);
      cursor += slots[i] + wordGap;
    }

    const revealDur = Math.min(duration * 0.55, 1.4);

    // ═══════════════════════════════════════════════
    // КАМЕРА — реально ощутимый drift + bass-push
    // ═══════════════════════════════════════════════
    const camX = Math.sin(t * 0.42) * fontSize * 0.22
               + Math.sin(t * 1.27) * fontSize * 0.10;
    const camY = Math.cos(t * 0.31) * fontSize * 0.09;

    const bassOver  = Math.max(0, bands.bass - 0.3) * params.bassSens;
    const bassPushX = Math.sin(t * 5.3) * bassOver * fontSize * 0.18;
    const bassPushY = Math.cos(t * 4.7) * bassOver * fontSize * 0.08;

    // Общий driver движения камеры (используется для proximity-zoom)
    const camDriver = (Math.abs(camX + bassPushX) + Math.abs(camY + bassPushY)) / fontSize;

    const midPulse = 1 + bands.mid * 0.08;

    const wl = words.map((word, i) => {
      const layer = layers[i];
      const cfg   = LAYER_CFG[layer];

      // ═══════════════════════════════════════════════
      // REVEAL: порядок СЛЕВА-НАПРАВО, тайминг одинаков для всех слоёв.
      // Но ХАРАКТЕР появления разный — foreground делает большой zoom-in,
      // midground плавно проявляется, background фейдится без зума.
      // ═══════════════════════════════════════════════
      const revealDelay = (i / Math.max(n - 1, 1)) * revealDur * 0.75;
      const revProg     = Math.max(0, Math.min((elapsed - revealDelay) / 0.34, 1));
      const eased       = 1 - Math.pow(1 - revProg, 2.5);

      // Характер reveal по слоям ─────────────────────────────
      let zoomFactor, entryX, entryY, entryRot;
      if (layer === 2) {
        // FOREGROUND: камера «фокусируется» на слове — zoom-in overshoot
        // стартует 1.35× → оседает к 1.0. Вход снизу-сбоку.
        zoomFactor = 1.0 + (1 - eased) * 0.35;
        entryX     = (1 - eased) * (hash(i + 41, 5) - 0.5) * fontSize * 0.5;
        entryY     = (1 - eased) * fontSize * 0.45;       // снизу
        entryRot   = (1 - eased) * (hash(i + 53, 9) - 0.5) * 0.12;
      } else if (layer === 1) {
        // MIDGROUND: стандартный reveal с лёгким зум-эффектом
        zoomFactor = 0.85 + eased * 0.15;
        entryX     = (1 - eased) * (hash(i + 41, 5) - 0.5) * fontSize * 0.25;
        entryY     = (1 - eased) * fontSize * 0.15;
        entryRot   = (1 - eased) * (hash(i + 53, 9) - 0.5) * 0.06;
      } else {
        // BACKGROUND: дальние проявляются из дымки, без движения,
        // только fade-in + едва заметный scale
        zoomFactor = 0.92 + eased * 0.08;
        entryX     = 0;
        entryY     = (1 - eased) * fontSize * -0.25;       // слегка сверху
        entryRot   = 0;
      }

      // ═══════════════════════════════════════════════
      // POSITION — классический паралакс: ближние двигаются СИЛЬНЕЕ
      // ═══════════════════════════════════════════════
      const pxAmount = cfg.pxFactor;
      const px = startXs[i] + (camX + bassPushX) * pxAmount + entryX;
      const py = layerY[i]  + (camY + bassPushY) * pxAmount + entryY;

      // ═══════════════════════════════════════════════
      // PROXIMITY-ZOOM — ключевой 2.5D-трюк.
      // Когда камера двигается, foreground-слова чуть-чуть меняют scale:
      //   камера отклоняется → ближние "проходят мимо" → их scale колеблется
      // Эффект в духе: когда ты проезжаешь на машине мимо билборда —
      // он становится всё больше, потом резко меньше. Для background этот
      // эффект почти незаметен (pxFactor мал).
      // ═══════════════════════════════════════════════
      const proximityZoom = 1 + camDriver * 0.08 * (cfg.pxFactor / 2.05);

      // ═══════════════════════════════════════════════
      // IDLE SWAY — каждый слой качается по-своему
      // ═══════════════════════════════════════════════
      const swayFreq  = 0.65 + (2 - layer) * 0.25;
      const swayPhase = t * swayFreq + i * 1.3;
      const swayAmp   = cfg.idleAmp;
      const swayX = Math.sin(swayPhase)       * fontSize * 0.05  * swayAmp * eased;
      const swayY = Math.cos(swayPhase * 1.2) * fontSize * 0.028 * swayAmp * eased;

      // Tilt: слегка следует за движением камеры (только для близких слоёв)
      const tilt = ((camX + bassPushX) / fontSize) * 0.035 * (cfg.pxFactor / 2.05)
                 + entryRot;

      return {
        word,
        x:        px + swayX,
        y:        py + swayY,
        scale:    cfg.scale * zoomFactor * midPulse * proximityZoom,
        alpha:    cfg.alpha * revProg,
        rotation: tilt,
      };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     8. SHATTER — «Сборка»
     Вокалоидная фишка: строка собирается из РАЗЛЕТАЮЩИХСЯ БУКВ.
     - каждая буква стартует в случайной точке за пределами экрана
     - вращается, медленно уменьшается, прилипает к своему месту
     - после сборки — лёгкий jitter от баса и idle sway
     - флаг perLetter: true говорит рендереру не маппить FX-теги по индексам
       (иначе буквы первого слова получили бы чужой glitch/color)
     - ширина каждой буквы замеряется через ctx.measureText — иначе в кириллице
       и пропорциональных шрифтах «Ж» и «і» становятся одной ширины и слипаются
  ═══════════════════════════════════════════════ */
  shatter({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };

    // ── Разбиваем на буквы, пробелы сохраняем как placeholder'ы ──
    const letters = [];
    words.forEach((w, wi) => {
      for (const ch of w) letters.push({ char: ch, space: false });
      if (wi < words.length - 1) letters.push({ char: ' ', space: true });
    });
    const n = letters.length;
    if (n === 0) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };

    // ── ТОЧНЫЙ замер ширины КАЖДОЙ буквы через Canvas API ──
    // Пропорциональные шрифты (Bebas Neue, Oswald и т.д.) имеют очень
    // разные ширины букв: "і" ~ 0.15× fontSize, "М" ~ 0.75× fontSize.
    // Без реального измерения буквы слипаются или разваливаются.
    let widths;
    if (ctx && typeof ctx.measureText === 'function') {
      const prevFont = ctx.font;
      ctx.font = `${fontSize}px ${font || 'sans-serif'}`;
      widths = letters.map(l => {
        if (l.space) return fontSize * 0.35;            // пробел — фиксированный
        const w = ctx.measureText(l.char).width;
        // Небольшой запас 4% чтобы буквы не впритык — это читабельнее
        return Math.max(w * 1.04, fontSize * 0.2);
      });
      ctx.font = prevFont;
    } else {
      // Fallback без ctx (теоретически не должен срабатывать, но на всякий)
      widths = letters.map(l => l.space ? fontSize * 0.35 : fontSize * 0.55);
    }

    const totalW = widths.reduce((a, b) => a + b, 0);

    // Target X для каждой буквы: центрируем по строке
    const targetXs = [];
    let cursor = -totalW / 2;
    for (let i = 0; i < n; i++) {
      targetXs.push(cursor + widths[i] / 2);
      cursor += widths[i];
    }

    // ── Seed для стабильных случайных направлений ──
    let seed = 0;
    for (const l of letters) seed = (seed * 31 + l.char.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;

    function rand(i, salt) {
      let s = ((i * 1664525) ^ (salt * seed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    // ── Тайминг ──
    const perLetterFlyDur = 0.42;
    const totalAssemble   = Math.min(duration * 0.60, 1.25);
    const stagger         = Math.max(0.015, (totalAssemble - perLetterFlyDur) / Math.max(n - 1, 1));

    const flyDist  = Math.max(canvasW, canvasH) * 0.55;
    const bassOver = Math.max(0, bands.bass - 0.35) * params.bassSens;

    const wl = letters.map((letter, i) => {
      // Пробелы — невидимки, просто держат место
      if (letter.space) {
        return { word: '', x: targetXs[i], y: 0, scale: 0, alpha: 0, rotation: 0 };
      }

      // Случайный угол и дистанция старта (из разных сторон экрана)
      const angle    = rand(i, 1) * Math.PI * 2;
      const distMul  = 0.7 + rand(i, 2) * 0.6;
      const sx       = Math.cos(angle) * flyDist * distMul;
      const sy       = Math.sin(angle) * flyDist * distMul * 0.75;
      const startRot = (rand(i, 3) - 0.5) * Math.PI * 2.6;   // до ±230°
      const startSc  = 1.6 + rand(i, 4) * 1.1;

      const letterStart = i * stagger;
      const letterT     = Math.max(0, elapsed - letterStart);
      const rawProg     = Math.min(letterT / perLetterFlyDur, 1);

      const eased = 1 - Math.pow(1 - rawProg, 4);

      const tx = targetXs[i];
      const ty = 0;
      let   x  = sx + (tx - sx) * eased;
      let   y  = sy + (ty - sy) * eased;

      let scale    = startSc + (1 - startSc) * eased;
      let rotation = startRot * (1 - eased);
      const alpha  = Math.min(rawProg * 3, 1);

      // Мини overshoot при посадке
      if (rawProg > 0.85) {
        const overP = (rawProg - 0.85) / 0.15;
        scale += Math.sin(overP * Math.PI) * 0.12;
      }

      // После сборки: bass-jitter + idle sway
      // ВАЖНО: амплитуды jitter ОЧЕНЬ маленькие, иначе буквы налезают
      // друг на друга и строка становится нечитаемой.
      if (rawProg >= 1) {
        const phase = i * 0.5 + t * 14;
        if (bassOver > 0.08) {
          x        += Math.cos(phase)         * bassOver * fontSize * 0.04;
          y        += Math.sin(phase * 1.3)   * bassOver * fontSize * 0.035;
          scale    *= 1 + bassOver * 0.06;
          rotation += Math.sin(t * 8.5 + i * 0.8) * bassOver * 0.03;
        }
        const idlePhase = i * 0.38 + t * 1.1;
        x += Math.sin(idlePhase)       * fontSize * 0.012;
        y += Math.cos(idlePhase * 1.3) * fontSize * 0.012;
      }

      return {
        word:     letter.char,
        x, y,
        scale,
        alpha,
        rotation,
      };
    });

    return { wordLayout: true, perLetter: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     9. CIPHER — «Расшифровка» (Matrix/hacker)
     Каждое слово стартует как поток случайных символов, «крутится» как
     slot-machine и фиксирует настоящие символы СЛЕВА-НАПРАВО, по одному.
     - глифы берутся из кириллицы + латиницы + цифры/символов
     - бас ускоряет расшифровку (добавляет revealImpulse)
     - после полной расшифровки строки проходит scan-line: буквы по очереди
       flash'ают (через scale+alpha pulse)
     - perLetter + individualGlyph: рендерер получает уже подставленные
       «шифр-символы» вместо настоящих
  ═══════════════════════════════════════════════ */
  cipher({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };

    // Набор глифов для «цифрового шума»
    const GLYPHS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*@!?+=<>';
    const GLY_N = GLYPHS.length;

    // Разбиваем на буквы (включая пробелы как placeholder'ы)
    const letters = [];
    words.forEach((w, wi) => {
      for (const ch of w) letters.push({ char: ch, space: false });
      if (wi < words.length - 1) letters.push({ char: ' ', space: true });
    });
    const n = letters.length;
    if (n === 0) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };

    // ── Замер ширины: берём ширину ОРИГИНАЛЬНОЙ буквы плюс запас.
    // Шифр-символы могут быть любой ширины, поэтому берём МАКСИМУМ между
    // оригиналом и средней шириной глифа — это страхует от наложения.
    let widths;
    if (ctx && typeof ctx.measureText === 'function') {
      const prevFont = ctx.font;
      ctx.font = `${fontSize}px ${font || 'sans-serif'}`;
      const avgGlyphW = ctx.measureText('М').width;                 // широкий глиф как baseline
      widths = letters.map(l => {
        if (l.space) return fontSize * 0.38;
        const orig = ctx.measureText(l.char).width;
        return Math.max(orig, avgGlyphW) * 1.08;                    // +8% гарантии против наложений
      });
      ctx.font = prevFont;
    } else {
      widths = letters.map(l => l.space ? fontSize * 0.38 : fontSize * 0.62);
    }

    const totalW = widths.reduce((a, b) => a + b, 0);
    const targetXs = [];
    let cursor = -totalW / 2;
    for (let i = 0; i < n; i++) {
      targetXs.push(cursor + widths[i] / 2);
      cursor += widths[i];
    }

    // Seed от содержимого
    let seed = 0;
    for (const l of letters) seed = (seed * 31 + l.char.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;

    // ── Тайминг ──
    // Каждая буква расшифровывается по очереди. До своего момента
    // она показывает случайные глифы с частотой ~12Гц.
    const bassOver     = Math.max(0, bands.bass - 0.32) * params.bassSens;
    const revealImpulse = bassOver * 0.35;                          // бас ускоряет расшифровку
    const decodeEach   = 0.09;                                      // одна буква расшифровывается 90мс
    const totalDecode  = Math.min(duration * 0.60, 1.4);
    const stagger      = Math.max(0.03, (totalDecode - decodeEach) / Math.max(n - 1, 1))
                         * (1 - Math.min(revealImpulse, 0.6));

    // Scan-line: после полной расшифровки
    const decodeEndT = (n - 1) * stagger + decodeEach;
    const scanT      = elapsed - decodeEndT;

    const wl = letters.map((letter, i) => {
      if (letter.space) {
        return { word: '', x: targetXs[i], y: 0, scale: 0, alpha: 0, rotation: 0 };
      }

      const letterStart = i * stagger;
      const decodeProg  = Math.min(Math.max(0, elapsed - letterStart) / decodeEach, 1);

      // ── Выбор символа для отрисовки ──
      let displayChar;
      if (decodeProg < 1) {
        // Ещё крутится. Генерируем псевдо-случайный глиф, меняющийся
        // на 12Гц — без «жёсткой» привязки к кадру (иначе мигание видно).
        const cycleSeed = Math.floor(t * 13 + i * 17 + seed) | 0;
        const idx = Math.abs(Math.imul(cycleSeed, 2654435761)) % GLY_N;
        displayChar = GLYPHS[idx];
      } else {
        displayChar = letter.char;
      }

      // ── Базовые трансформации ──
      // До начала своего окна буква невидима, в процессе — набирает alpha.
      let alpha = 0;
      let scale = 1;
      let rotation = 0;
      let x = targetXs[i];
      let y = 0;

      if (elapsed < letterStart) {
        alpha = 0;
      } else if (decodeProg < 1) {
        // Во время декодирования: вибрация + полупрозрачность
        alpha = 0.55 + decodeProg * 0.35;
        scale = 0.92 + decodeProg * 0.1;
        x    += Math.sin(t * 47 + i * 2.1) * fontSize * 0.04;
        y    += Math.cos(t * 41 + i * 1.7) * fontSize * 0.03;
        rotation = Math.sin(t * 31 + i) * 0.06;
      } else {
        // Зафиксировалась: flash в момент фиксации + idle
        const sinceFixed = elapsed - (letterStart + decodeEach);
        // Flash: первые 0.12с scale↑ и alpha 1.0
        const flashPhase = Math.min(sinceFixed / 0.12, 1);
        if (flashPhase < 1) {
          scale = 1 + (1 - flashPhase) * 0.28;
          alpha = 1;
        } else {
          scale = 1;
          alpha = 1;
        }

        // Idle: очень тонкое jitter от баса
        if (bassOver > 0.1) {
          x += Math.cos(t * 16 + i * 0.9) * bassOver * fontSize * 0.03;
          y += Math.sin(t * 13 + i * 1.2) * bassOver * fontSize * 0.025;
        }

        // ── Scan-line: проходит слева направо после всей расшифровки ──
        if (scanT > 0) {
          const scanSpeed = 3.5;                                    // буквы/сек
          const scanPos   = scanT * scanSpeed;                      // «волна» на index
          const dist      = Math.abs(scanPos - i);
          if (dist < 1.4) {
            const w = 1 - dist / 1.4;
            scale *= 1 + w * 0.35;
            alpha  = Math.min(1, alpha + w * 0.0);                  // alpha уже 1
            y     -= w * fontSize * 0.12;                           // подскок
          }
        }
      }

      return {
        word: displayChar,
        x, y,
        scale,
        alpha,
        rotation,
      };
    });

    return { wordLayout: true, perLetter: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     10. ORBIT — «Орбита»
     Слова вращаются по эллипсу вокруг центра и причаливают к своим местам
     в горизонтальной строке — как если бы они "приземлялись" из гиперпространства.
     - стартовая позиция: на эллипсе, индивидуальный угол каждого слова
     - вращаются по часовой (замедляясь), одновременно эллипс «схлопывается» в линию
     - финальный snap: последний поворот выпрямляется, слово стоит ровно
     - на бас — эллипс «пульсирует» амплитудой (визуальный driver)
  ═══════════════════════════════════════════════ */
  orbit({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    // Replay-безопасный seed
    let seed = 0;
    for (const w of words) seed = (seed * 31 + w.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;
    function hash(i, salt) {
      let s = ((i * 2654435761) ^ (salt * seed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    // ── Точные ширины + целевые позиции (на строке) ──
    const baseWidths = _measureWordsPx(ctx, words, fontSize, font);
    const wordGap    = fontSize * 0.42;
    const totalW     = baseWidths.reduce((a, b) => a + b, 0) + wordGap * (n - 1);

    const targetXs = [];
    let cursor = -totalW / 2;
    for (let i = 0; i < n; i++) {
      targetXs.push(cursor + baseWidths[i] / 2);
      cursor += baseWidths[i] + wordGap;
    }

    // ── Параметры эллипса ──
    // rx — горизонтальный радиус (45% ширины холста), ry — вертикальный (≈30% высоты)
    const baseRx = canvasW * 0.32;
    const baseRy = canvasH * 0.22;

    // Bass-реакция: эллипс пульсирует ±14%
    const bassOver = Math.max(0, bands.bass - 0.3) * params.bassSens;
    const pulse    = 1 + Math.sin(t * 3.1) * bassOver * 0.14;

    // Общее вращение строки: замедляется к концу reveal (ease-out)
    const revealDur = Math.min(duration * 0.70, 1.6);

    const wl = words.map((word, i) => {
      // ── Индивидуальный angular offset: каждое слово на своей позиции
      // эллипса. Равномерно распределены по 2π + лёгкий seeded jitter.
      const baseAngle = (i / n) * Math.PI * 2 + hash(i + 1, 3) * 0.4;

      // ── Reveal по порядку: каждое слово приземляется на своей ступени ──
      const landDelay = (i / Math.max(n - 1, 1)) * revealDur * 0.55;
      const landT     = Math.max(0, elapsed - landDelay);
      const landDur   = Math.min(0.75, duration * 0.42);
      const rawProg   = Math.min(landT / landDur, 1);
      // Ease out quart — быстрый старт, мягкая посадка
      const prog      = 1 - Math.pow(1 - rawProg, 4);

      // ── Угол вращения: стартует от baseAngle, делает ~1.8 оборота и
      // останавливается так, чтобы слово оказалось на своей target X ──
      const totalSpin = Math.PI * 3.6;                            // 1.8 полных оборотов
      const currentAngle = baseAngle + totalSpin * (1 - prog);

      // ── Радиусы эллипса схлопываются к 0 вместе с prog ──
      const rx = baseRx * (1 - prog) * pulse;
      const ry = baseRy * (1 - prog) * pulse;

      // Позиция на эллипсе
      const orbX = Math.cos(currentAngle) * rx;
      const orbY = Math.sin(currentAngle) * ry;

      // ── Финальная позиция: интерполяция orbit → target ──
      // prog=0: позиция на эллипсе; prog=1: точно в target slot
      const x = orbX + targetXs[i] * prog;
      const y = orbY * 1.0;

      // ── Scale: стартует 0.55 (издалека), растёт до 1.0 ──
      const scale = 0.55 + 0.45 * prog;
      // Alpha: появляется быстро в начале полёта
      const alpha = Math.min(rawProg * 3, 1);

      // ── Rotation: слово наклонено по касательной к эллипсу,
      // при приземлении выпрямляется ──
      const tangent  = currentAngle + Math.PI / 2;
      // Нормируем чтобы наклон был ограничен ±35°
      let tilt = Math.sin(tangent) * 0.35 * (1 - prog);
      // После приземления — idle sway + bass micro-tilt
      if (rawProg >= 1) {
        tilt += Math.sin(t * 1.4 + i * 1.1) * 0.02;
        if (bassOver > 0.15) tilt += Math.sin(t * 9 + i) * bassOver * 0.04;
      }

      return {
        word,
        x,
        y,
        scale,
        alpha,
        rotation: tilt,
      };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     11. RIPPLE — «Рябь на воде»
     Каждое слово материализуется из круга ряби, расходящейся от его позиции.
     - слова появляются staggered, центр «капли» = центр слова
     - пока рябь расходится, слово распадается на размытые/колеблющиеся буквы
       → затем фокусируется в нормальный вид
     - после сборки бас генерирует НОВЫЕ ripples, проходящие через строку
       слева-направо (волны). Буквы поднимаются как лодочки на волне.
     - perLetter: true — буквы работают индивидуально
  ═══════════════════════════════════════════════ */
  ripple({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };

    // Разбиваем на буквы
    const letters = [];
    words.forEach((w, wi) => {
      for (const ch of w) letters.push({ char: ch, space: false, wordIdx: wi });
      if (wi < words.length - 1) letters.push({ char: ' ', space: true, wordIdx: -1 });
    });
    const n = letters.length;
    if (n === 0) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };

    // Точный замер каждой буквы
    let widths;
    if (ctx && typeof ctx.measureText === 'function') {
      const prevFont = ctx.font;
      ctx.font = `${fontSize}px ${font || 'sans-serif'}`;
      widths = letters.map(l => {
        if (l.space) return fontSize * 0.35;
        return Math.max(ctx.measureText(l.char).width * 1.04, fontSize * 0.2);
      });
      ctx.font = prevFont;
    } else {
      widths = letters.map(l => l.space ? fontSize * 0.35 : fontSize * 0.55);
    }

    const totalW = widths.reduce((a, b) => a + b, 0);
    const targetXs = [];
    let cursor = -totalW / 2;
    for (let i = 0; i < n; i++) {
      targetXs.push(cursor + widths[i] / 2);
      cursor += widths[i];
    }

    // Индекс первой буквы каждого слова (для группового reveal)
    const wordFirstLetter = new Map();
    letters.forEach((l, i) => {
      if (!l.space && !wordFirstLetter.has(l.wordIdx)) {
        wordFirstLetter.set(l.wordIdx, i);
      }
    });

    // Seed
    let seed = 0;
    for (const l of letters) seed = (seed * 31 + l.char.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;
    function hash(i, salt) {
      let s = ((i * 2654435761) ^ (salt * seed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    // ── Тайминг ──
    // Reveal per word: stagger между словами ~150мс, внутри слова буквы
    // материализуются одновременно, но с лёгким внутренним jitter.
    const wordsN       = words.length;
    const wordStaggerT = Math.min(0.18, Math.max(0.08, (duration * 0.55) / wordsN));
    const materializeDur = 0.55;                                    // длительность ряби

    // ── Bass-driven travelling ripples (когда строка уже собрана) ──
    // Накапливаем «последний момент сильного баса» → волна расходится от левого края.
    // Используем детерминистичную функцию от времени, не сохраняя state.
    const bassOver = Math.max(0, bands.bass - 0.38) * params.bassSens;

    const wl = letters.map((letter, i) => {
      if (letter.space) {
        return { word: '', x: targetXs[i], y: 0, scale: 0, alpha: 0, rotation: 0 };
      }

      // ── Когда начинается reveal для этого СЛОВА ──
      const myWordStart = letter.wordIdx * wordStaggerT;
      // Внутри слова — крохотный stagger по буквам (+ jitter)
      const inWordOffset = (i - wordFirstLetter.get(letter.wordIdx)) * 0.02
                         + hash(i + 3, 7) * 0.06;
      const myStart = myWordStart + inWordOffset;
      const myT     = Math.max(0, elapsed - myStart);
      const rawProg = Math.min(myT / materializeDur, 1);

      // Ease out — рябь быстро расходится, буква медленно материализуется
      const eased = 1 - Math.pow(1 - rawProg, 2.5);

      // ── Позиция во время материализации ──
      // Буква «всплывает» снизу из капли, с колебаниями пока рябь активна
      let x = targetXs[i];
      let y = 0;

      // Всплытие: стартует на fontSize×0.5 ниже, поднимается к 0
      const riseY = (1 - eased) * fontSize * 0.5;
      y += riseY;

      // Колебания пока рябь не затухла (rawProg < 1)
      if (rawProg < 1) {
        const wavePhase = t * 10 + hash(i + 11, 5) * 6.28;
        x += Math.sin(wavePhase)     * (1 - rawProg) * fontSize * 0.08;
        y += Math.cos(wavePhase * 1.3) * (1 - rawProg) * fontSize * 0.05;
      }

      // ── Scale: стартует 0.3 (капля), распухает до 1.15 на пике (splash),
      //           оседает к 1.0
      let scale;
      if (rawProg < 0.55) {
        const p = rawProg / 0.55;
        scale = 0.3 + p * 0.85;                                   // 0.3 → 1.15
      } else {
        const p = (rawProg - 0.55) / 0.45;
        scale = 1.15 - p * 0.15;                                  // 1.15 → 1.0
      }

      // ── Alpha: появляется с ряби, к концу 1.0
      const alpha = Math.min(rawProg * 1.8, 1);

      // ── Rotation: колебания во время материализации
      let rotation = (1 - rawProg) * Math.sin(t * 7 + i * 1.3) * 0.15;

      // ═══════════════════════════════════════════════
      // После материализации: idle sway + bass-driven travelling ripples
      // ═══════════════════════════════════════════════
      if (rawProg >= 1) {
        // Idle: букву лёгко колышет «вода» — синус с фазой от позиции
        const idlePhase = t * 1.8 + (targetXs[i] / fontSize) * 0.6;
        y += Math.sin(idlePhase)       * fontSize * 0.04;
        x += Math.cos(idlePhase * 0.7) * fontSize * 0.02;

        // ── Travelling wave от баса: синусоидальная волна, идущая слева-направо ──
        // wave-phase = время × speed − позиция. Амплитуда управляется басом.
        if (bassOver > 0.05) {
          const waveSpeed = 7.5;                                   // единиц/сек
          const wavePos   = (targetXs[i] / fontSize);
          const wavePhase = t * waveSpeed - wavePos;
          // Используем cos² огибающую для «группы волн»
          const envelope  = Math.max(0, Math.cos(wavePhase * 0.35));
          const wave      = Math.sin(wavePhase) * envelope * bassOver;
          y     -= wave * fontSize * 0.18;
          rotation += wave * 0.07;
          scale *= 1 + Math.abs(wave) * 0.05;
        }
      }

      return {
        word: letter.char,
        x, y,
        scale,
        alpha,
        rotation,
      };
    });

    return { wordLayout: true, perLetter: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     12. NOVA — «Сверхновая» / Cinematic Hero Shots
     Каждое слово получает свой КРУПНЫЙ КАДР — гигантский block по центру
     (scale до 3×, заполняет треть-половину холста), потом плавно уезжает
     на свою idle-позицию в композицию. Когда появляется следующий hero,
     предыдущие на фоне затемняются, подчёркивая фокус внимания.

     Это монтаж из кинокадров, в духе вокалоидных PV Kanaria / Inabakumori /
     Sakanaction. Каждое слово получает свой "момент" — зум прямо на нём.

     Фазы жизни каждого слова (τ = elapsed - wordStart):
       τ < 0.00         → pre-spawn (invisible)
       0.00 ≤ τ < 0.08  → spawn: scale 0→0.3, alpha 0→0.3 (предчувствие)
       0.08 ≤ τ < 0.32  → BLAST-IN: scale 0.3→ heroScale × 1.08 (overshoot)
                           позиция: центр + лёгкий seeded offset
                           alpha 0.3→1.0
       0.32 ≤ τ < 0.58  → HOLD: держится ~ heroScale, реагирует на бас
       0.58 ≤ τ < 0.85  → DEPART: scale heroScale→idleScale,
                           позиция: центр → idle position на сетке
       τ ≥ 0.85         → IDLE: лёгкое покачивание на своей точке

     Dimming: idle-слова затемняются пропорционально тому, насколько
     активен любой другой hero (smooth falloff, не резкий).
  ═══════════════════════════════════════════════ */
  nova({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    // ── Seed ──
    let seed = 0;
    for (const w of words) seed = (seed * 31 + w.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;
    function hash(i, salt) {
      let s = ((i * 2654435761) ^ (salt * seed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    // ── Idle-сетка: куда слово осядет после hero-момента ──
    const aspect = canvasW / canvasH;
    const cols   = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(n * aspect))));
    const rows   = Math.max(1, Math.ceil(n / cols));
    const cellCount = cols * rows;

    // Seeded Fisher-Yates: слово i → ячейка perm[i]
    const perm = Array.from({ length: cellCount }, (_, k) => k);
    for (let k = cellCount - 1; k > 0; k--) {
      const j = Math.floor(hash(k, 13) * (k + 1));
      [perm[k], perm[j]] = [perm[j], perm[k]];
    }

    const safeW = canvasW * 0.80;
    const safeH = canvasH * 0.70;
    const cellW = safeW / cols;
    const cellH = safeH / rows;

    const baseWidths = _measureWordsPx(ctx, words, fontSize, font);

    // ── Per-word idle params — BIG variance для плакатного вида ──
    // scale 0.32-1.25 (3.9× разница — реальная иерархия в композиции)
    // rotation ±28° (плакат, не таблица)
    const idleData = words.map((_, i) => {
      const cell = perm[i] ?? i;
      const col  = cell % cols;
      const row  = Math.floor(cell / cols);
      const cellCx = -safeW / 2 + cellW * (col + 0.5);
      const cellCy = -safeH / 2 + cellH * (row + 0.5);
      // Больше jitter: ±48% от ячейки (но сама ячейка с запасом)
      const jx = (hash(i + 1, 11) - 0.5) * cellW * 0.56;
      const jy = (hash(i + 1, 17) - 0.5) * cellH * 0.52;
      // ── Scale: широкий диапазон 0.32-1.25 с нелинейным распределением ──
      // Немного слов будут очень мелкими, немного очень крупными (power curve)
      const sRaw = hash(i + 1, 23);
      const sCurved = Math.pow(sRaw, 1.4);                      // чаще мелкие, реже крупные
      let s = 0.32 + sCurved * 0.93;
      const maxFit = (cellW * 0.90) / Math.max(baseWidths[i], fontSize * 0.4);
      s = Math.min(s, maxFit);
      // Rotation: до ±28° с bimodal distribution (чаще либо почти ровно, либо сильный наклон)
      const rRaw = hash(i + 1, 29) - 0.5;              // -0.5 .. 0.5
      const rBiased = Math.sign(rRaw) * Math.pow(Math.abs(rRaw) * 2, 1.6) / 2;
      const rot = rBiased * 0.49;                      // ±28°
      return { x: cellCx + jx, y: cellCy + jy, scale: s, rotation: rot };
    });

    // ── Hero scale: reality-check по ширине И высоте холста ──
    // Слово в BLAST должно быть ЭПИЧНО, но не вылезать.
    // Целимся в 90% ширины холста, 55% высоты, максимум ×3.2.
    const heroScales = words.map((_, i) => {
      const capW = (canvasW * 0.90) / Math.max(baseWidths[i], fontSize * 0.4);
      const capH = (canvasH * 0.55) / fontSize;
      return Math.min(3.2, capW, capH);
    });

    // Bass & timing
    const bassOver = Math.max(0, bands.bass - 0.32) * params.bassSens;

    // Stagger: hero длится 0.85с, следующее приходит на фазе DEPART/late HOLD
    // предыдущего — создаётся поток без пустот.
    // При длинной строке stagger сжимается, при короткой — растягивается.
    const heroDur = 0.85;
    // Нужно: n слов × stagger + heroDur ≤ duration × 0.95
    // Но и не слишком быстро, чтобы кадр успевал "сыграть".
    let stagger = Math.max(0.32, (duration * 0.95 - heroDur) / Math.max(n - 1, 1));
    stagger = Math.min(stagger, 0.65);

    // ── Hero-intensity function: для dimming idle-слов ──
    function heroIntensity(tau) {
      if (tau < 0.08 || tau >= 0.85) return 0;
      if (tau < 0.32) return (tau - 0.08) / 0.24;          // 0 → 1 (ramp up)
      if (tau < 0.58) return 1.0;                          // HOLD
      return 1 - (tau - 0.58) / 0.27;                      // 1 → 0 (ramp down)
    }

    // ── Для каждого слова считаем "чужую" hero-активность (max over j≠i) ──
    // Idle-слова затемняются пропорционально этой активности.
    function otherHeroActivity(myI) {
      let maxAct = 0;
      for (let j = 0; j < n; j++) {
        if (j === myI) continue;
        const τj = elapsed - j * stagger;
        const act = heroIntensity(τj);
        if (act > maxAct) maxAct = act;
      }
      return maxAct;
    }

    const wl = words.map((word, i) => {
      const τ = elapsed - i * stagger;
      const idle = idleData[i];
      const heroSc = heroScales[i];

      let scale, alpha, x, y, rotation;

      if (τ < 0) {
        // Pre-spawn
        return { word, x: idle.x, y: idle.y, scale: 0, alpha: 0, rotation: idle.rotation };
      }

      if (τ < 0.08) {
        // SPAWN: hint of presence
        const p = τ / 0.08;
        scale = 0.3 * p;
        alpha = p * 0.3;
        x = (hash(i + 1, 41) - 0.5) * fontSize * 0.3;
        y = (hash(i + 1, 43) - 0.5) * fontSize * 0.4;
        rotation = (hash(i + 1, 47) - 0.5) * 0.25;
      } else if (τ < 0.32) {
        // BLAST-IN: резкий zoom с overshoot
        const p       = (τ - 0.08) / 0.24;
        const easedIn = 1 - Math.pow(1 - p, 3);
        scale  = 0.3 + easedIn * (heroSc * 1.08 - 0.3);
        alpha  = Math.min(0.3 + p * 1.4, 1);
        // Позиция: лёгкий seeded offset от центра (но не слишком большой)
        x = (hash(i + 1, 41) - 0.5) * fontSize * 0.25;
        y = (hash(i + 1, 43) - 0.5) * fontSize * 0.30;
        // Entry rotation — больше → к 0 → финально к idle.rotation
        const entryRot = (hash(i + 1, 47) - 0.5) * 0.35;
        rotation = entryRot * (1 - easedIn);
      } else if (τ < 0.58) {
        // HOLD: hero display
        const p = (τ - 0.32) / 0.26;
        // Небольшой "breathing" + сильная реакция на бас
        const breathe = 1 + Math.sin(t * 4.1) * 0.02;
        const settleOvershoot = (1 - p) * 0.08;           // overshoot остаток тает
        scale  = heroSc * (1 + settleOvershoot) * breathe * (1 + bassOver * 0.14);
        alpha  = 1;
        // Лёгкое idle-движение
        x = (hash(i + 1, 41) - 0.5) * fontSize * 0.25 + Math.sin(t * 2.7) * fontSize * 0.02;
        y = (hash(i + 1, 43) - 0.5) * fontSize * 0.30 + Math.cos(t * 3.3) * fontSize * 0.015;
        rotation = Math.sin(t * 1.9 + i) * 0.02;
        // Bass-jitter только на пиках
        if (bassOver > 0.25) {
          x += Math.sin(t * 22 + i * 1.7) * bassOver * fontSize * 0.04;
          rotation += Math.sin(t * 17 + i) * bassOver * 0.04;
        }
      } else if (τ < 0.85) {
        // DEPART: hero → idle position & size
        const p        = (τ - 0.58) / 0.27;
        const easedOut = 1 - Math.pow(1 - p, 2.2);
        scale  = heroSc + (idle.scale - heroSc) * easedOut;
        alpha  = 1;
        // Позиция интерполируется от hero-offset к idle-point
        const heroX = (hash(i + 1, 41) - 0.5) * fontSize * 0.25;
        const heroY = (hash(i + 1, 43) - 0.5) * fontSize * 0.30;
        x = heroX * (1 - easedOut) + idle.x * easedOut;
        y = heroY * (1 - easedOut) + idle.y * easedOut;
        rotation = idle.rotation * easedOut;
      } else {
        // IDLE: в финальной позиции, затемняется при активном hero
        scale    = idle.scale;
        rotation = idle.rotation;
        x = idle.x;
        y = idle.y;

        // Idle sway — у каждого своя фаза
        const swayPhase = t * (1.1 + hash(i + 1, 37) * 1.4) + i * 0.7;
        x += Math.sin(swayPhase)        * fontSize * 0.035;
        y += Math.cos(swayPhase * 1.15) * fontSize * 0.025;
        rotation += Math.sin(swayPhase * 0.6) * 0.025;

        // Bass-pulse на idle (слабее чем на hero)
        scale *= 1 + bassOver * 0.08;

        // ═══════════════════════════════════════════════
        // SHOCKWAVE: каждый активный hero отталкивает idle-слова от своего центра
        // и ненадолго контрактит их scale. Создаёт ощущение, что "hero" физически
        // давит на сцену — камера дёргается при взрыве каждого кадра.
        // ═══════════════════════════════════════════════
        let shockScaleMul = 1;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const τj = elapsed - j * stagger;
          // Пик shockwave ровно в момент BLAST-IN (τ=0.08..0.32)
          if (τj < 0.08 || τj > 0.42) continue;
          const shockPhase = (τj - 0.08) / 0.34;                 // 0..1
          const pulse      = Math.sin(shockPhase * Math.PI);     // колоколообразная
          if (pulse < 0.01) continue;

          // Вектор от hero_j (центр + небольшой jitter) к нам
          const heroX_j = (hash(j + 1, 41) - 0.5) * fontSize * 0.25;
          const heroY_j = (hash(j + 1, 43) - 0.5) * fontSize * 0.30;
          const dx = idle.x - heroX_j;
          const dy = idle.y - heroY_j;
          const dist = Math.max(fontSize * 0.5, Math.sqrt(dx * dx + dy * dy));
          const dirX = dx / dist;
          const dirY = dy / dist;

          // Амплитуда: дальше слово → слабее shockwave (inverse falloff)
          const falloff = fontSize * 3 / (fontSize * 3 + dist);
          const push    = pulse * falloff * fontSize * 0.22;

          x += dirX * push;
          y += dirY * push;
          shockScaleMul *= 1 - pulse * falloff * 0.08;            // мини-контракт scale
        }
        scale *= shockScaleMul;

        // ── DIMMING: если где-то есть активный hero, я тускнею ──
        // Плавная интерполяция 1.0 → 0.32 в зависимости от интенсивности
        const dim = otherHeroActivity(i);
        alpha = 1 - dim * 0.68;   // 1.0 при отсутствии, 0.32 при полном hero

        // Под басом слегка подсвечиваются idle
        alpha += bassOver * 0.12 * (1 - dim);
        alpha = Math.max(0, Math.min(1, alpha));
      }

      return { word, x, y, scale, alpha, rotation };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     13. MONTAGE — «Кинематографический монтаж» / Virtual Camera
     ВСЯ СЦЕНА зумится. Все слова раскиданы по canvas в seeded позициях
     и существуют одновременно. Виртуальная КАМЕРА переезжает от слова
     к слову, зумя до фокуса. Трансформация:

         finalPos   = (wordPos - cameraPos) × cameraZoom
         finalScale = wordScale × cameraZoom

     При cameraZoom > 1 и cameraPos = wordX_k, слово k оказывается
     большим по центру экрана, все остальные слова разъезжаются к краям
     и тоже увеличиваются. Это выглядит как реальное приближение камеры
     к точке пространства — именно то, чего не хватало nova.

     Фазы камеры между словами:
       HOLD    ~60% слота: камера стоит на текущем слове, zoom × 2.2
       LIFT    ~20% слота: zoom падает до × 1.3, камера начинает ехать
       SETTLE  ~20% слота: zoom растёт обратно до × 2.2, камера на след.слове

     При LIFT видно всю сцену целиком (маленькие слова повсюду — плакат),
     при HOLD — крупный план.

     Плюс:
     - bass-реактивный camera-kick (микро-shake на ударе)
     - каждое слово слегка покачивается на своей позиции (idle)
     - когда слово в фокусе — его scale и яркость slightly boost
  ═══════════════════════════════════════════════ */
  montage({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    // ── Seed ──
    let seed = 0;
    for (const w of words) seed = (seed * 31 + w.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;
    function hash(i, salt) {
      let s = ((i * 2654435761) ^ (salt * seed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    // ═══════════════════════════════════════════════
    // ГОРИЗОНТАЛЬНЫЙ LAYOUT — слова в строку, как обычный текст.
    // Ранее были разбросаны 2D-сеткой по всему canvas → нечитаемое месиво
    // когда камера не могла показать все слова одновременно.
    // Теперь строка — это строка, камера едет ВДОЛЬ неё.
    // ═══════════════════════════════════════════════
    const layout = _horizontalLineLayout(ctx, words, fontSize, font, hash, 0.25);
    const worldPos = layout.positions;         // [{x, y, w}, …] — центры слов
    const lineW    = layout.totalW;

    // Все слова одного базового scale — они визуально равноценны до того как
    // камера их увеличит. Иерархию создаёт camera zoom+position, а не per-word
    // размер (как раньше).
    const wordBaseScale = words.map(() => 1.0);

    // Rotation: семена даём лёгкий наклон ±10°, без фанатизма
    const wordRotation = words.map((_, i) => (hash(i + 1, 29) - 0.5) * 0.18);

    // ═══════════════════════════════════════════════
    // ВИРТУАЛЬНАЯ КАМЕРА
    // Траектория теперь линейная: от первого слова к последнему
    // С фазами HOLD (близко) / LIFT (отъезд, видно строку) / SETTLE (приезд)
    // на каждом слове.
    // ═══════════════════════════════════════════════
    // Z_CLOSE подбирается так, чтобы слово на котором камера, занимало
    // примерно ¼-⅓ canvas-ширины. При fontSize=96 и canvasW=1280
    // ширина слова ≈ 180px * zoom, значит zoom=2.0 даёт 360px ≈ 28% canvas.
    const Z_CLOSE = 2.0;    // зум на слове (крупный план)
    const Z_WIDE  = Math.max(1.05, Math.min(1.5, canvasW / (lineW * 1.25)));
    // Z_WIDE: на LIFT-фазе камера ОТЪЕЗЖАЕТ до такого зума чтобы ВСЯ
    // строка помещалась в кадр (с 25% полями). Если строка короткая —
    // zoom больше (иначе всё было бы слишком мелким).

    // Тайминг слотов
    const bassOver = Math.max(0, bands.bass - 0.32) * params.bassSens;
    const slotDur  = Math.max(0.55, duration * 0.92 / n);
    const holdFrac    = 0.58;          // 58% слота — hold
    const liftFrac    = 0.22;          // 22% — zoom out
    const settleFrac  = 0.20;          // 20% — zoom in на следующем

    // Reveal: первое слово появляется с коротким intro
    const introDur = 0.30;

    // Текущее состояние камеры
    let camZoom = Z_CLOSE;
    let camX = worldPos[0].x;
    let camY = worldPos[0].y;
    let focusIdx = 0;

    if (elapsed < introDur) {
      // INTRO: zoom влетает с ×0.6 до Z_CLOSE на первом слове
      const p = elapsed / introDur;
      const e = 1 - Math.pow(1 - p, 3);
      camZoom = 0.6 + (Z_CLOSE - 0.6) * e;
      camX    = worldPos[0].x;
      camY    = worldPos[0].y;
      focusIdx = 0;
    } else {
      const activeT = elapsed - introDur;
      const slotIdx = Math.min(Math.floor(activeT / slotDur), n - 1);
      const inSlot  = activeT - slotIdx * slotDur;
      const p       = inSlot / slotDur;                    // 0..1

      if (p < holdFrac) {
        // HOLD на slotIdx
        camX     = worldPos[slotIdx].x;
        camY     = worldPos[slotIdx].y;
        camZoom  = Z_CLOSE;
        focusIdx = slotIdx;
      } else if (p < holdFrac + liftFrac) {
        // LIFT: zoom выходит к Z_WIDE, камера начинает ехать
        const q        = (p - holdFrac) / liftFrac;        // 0..1
        const zoomP    = 0.5 - 0.5 * Math.cos(q * Math.PI); // smoothstep
        camZoom = Z_CLOSE + (Z_WIDE - Z_CLOSE) * zoomP;
        // Position уже начинает перемещаться — это даёт ощущение "камера увидела больше"
        const nextIdx = Math.min(slotIdx + 1, n - 1);
        const moveP   = q * 0.35;                           // 35% пути на LIFT
        camX = worldPos[slotIdx].x * (1 - moveP) + worldPos[nextIdx].x * moveP;
        camY = worldPos[slotIdx].y * (1 - moveP) + worldPos[nextIdx].y * moveP;
        focusIdx = slotIdx;
      } else {
        // SETTLE: zoom возвращается к Z_CLOSE, камера приезжает на next
        const q        = (p - holdFrac - liftFrac) / settleFrac;
        const zoomP    = 0.5 - 0.5 * Math.cos(q * Math.PI);
        camZoom = Z_WIDE + (Z_CLOSE - Z_WIDE) * zoomP;
        const nextIdx = Math.min(slotIdx + 1, n - 1);
        const moveP = 0.35 + q * 0.65;                      // остальные 65% пути
        camX = worldPos[slotIdx].x * (1 - moveP) + worldPos[nextIdx].x * moveP;
        camY = worldPos[slotIdx].y * (1 - moveP) + worldPos[nextIdx].y * moveP;
        focusIdx = nextIdx;
      }
    }

    // ── Bass camera kick (весь кадр дёргается на басу) ──
    if (bassOver > 0.05) {
      camX += Math.sin(t * 17) * bassOver * fontSize * 0.06;
      camY += Math.cos(t * 13) * bassOver * fontSize * 0.05;
      camZoom *= 1 + bassOver * 0.05;
    }

    // ── Idle camera drift (тонкое плавающее движение) ──
    camX += Math.sin(t * 0.3) * fontSize * 0.04;
    camY += Math.cos(t * 0.25) * fontSize * 0.03;

    // ── Рендерим каждое слово через трансформацию камеры ──
    const wl = words.map((word, i) => {
      const wp = worldPos[i];

      // Idle sway — слово слегка покачивается в world-space
      const swayPhase = t * (1.1 + hash(i + 1, 37) * 1.3) + i * 0.6;
      const swayX = Math.sin(swayPhase)        * fontSize * 0.03;
      const swayY = Math.cos(swayPhase * 1.15) * fontSize * 0.022;

      // Применяем виртуальную камеру
      const finalX = (wp.x + swayX - camX) * camZoom;
      const finalY = (wp.y + swayY - camY) * camZoom;

      // Base scale + focus boost (когда слово в фокусе — +15% для акцента)
      const isFocus    = (i === focusIdx);
      const focusBoost = isFocus ? 1.15 : 1.0;
      let scale = wordBaseScale[i] * camZoom * focusBoost;

      // Bass-pulse только на фокусном слове (остальные стабильно)
      if (isFocus) scale *= 1 + bassOver * 0.14;

      // Rotation: word + micro camera tilt
      let rotation = wordRotation[i]
                   + Math.sin(swayPhase * 0.6) * 0.025;
      // При LIFT-фазе небольшой dutch angle (кинематографично)
      if (elapsed >= introDur) {
        const activeT = elapsed - introDur;
        const slotIdx = Math.min(Math.floor(activeT / slotDur), n - 1);
        const inSlot  = activeT - slotIdx * slotDur;
        const p       = inSlot / slotDur;
        if (p >= holdFrac && p < holdFrac + liftFrac) {
          const q = (p - holdFrac) / liftFrac;
          rotation += Math.sin(q * Math.PI) * 0.04;      // лёгкий наклон на переходе
        }
      }

      // Alpha: off-focus слова тусклее (читаемость)
      let alpha = isFocus ? 1.0 : 0.78;
      // Depth-fade: слова далеко от камеры по X в пределах строки —
      // тускнеют. maxDist ≈ половина длины строки, это даёт ощущение
      // что слова за пределами кадра глубже в сцене.
      const worldDist = Math.abs(wp.x - camX);
      const maxDist   = Math.max(lineW * 0.5, fontSize * 2);
      const depthFade = Math.max(0.5, 1 - worldDist / maxDist);
      alpha *= depthFade;

      // Intro fade: первая секунда всё полупрозрачно
      if (elapsed < introDur) {
        alpha *= elapsed / introDur;
      }

      return {
        word,
        x: finalX,
        y: finalY,
        scale,
        alpha,
        rotation,
      };
    });

    // ═══════════════════════════════════════════════
    // CAMERA OVERRIDE — передаётся в BackgroundEngine.setTextDrivenCamera().
    // Это главная фишка montage: ФОН ЗУМИТСЯ И ПАНОРАМИРУЕТСЯ ВМЕСТЕ С ТЕКСТОМ.
    // Когда camZoom x2.15, фон тоже x2.15. Когда камера едет к слову i+1,
    // фон едет в противоположном направлении.
    //
    // Важно: camZoom здесь это множитель от base. В BackgroundEngine он
    // умножается на totalScale, который уже включает cover-fit.
    // Поэтому передаём camZoom как zoomMul, и интерпретируем camX/camY как
    // pan в пикселях canvas (1 canvas-px = 1 final-px).
    //
    // Чтобы избежать чрезмерного зума фона (фон может потерять качество),
    // зум капается на x1.8.
    const bgZoomMul = Math.min(camZoom, 1.8);
    // Pan масштабируем: если camera смотрит в worldX=100, фон должен
    // сдвинуться влево на ~100 × zoomMul. Но это должно быть видно в пикселях.
    // worldPos находится в пределах ±worldW/2 ≈ ±0.42 × canvasW.
    // С zoomMul x1.8 и worldX=0.42*cw фон сдвинется на 0.42*cw × 0.8 ≈ 0.34*cw — ОК.
    const bgPanFactor = bgZoomMul - 1;
    const cameraOverride = {
      zoomMul: bgZoomMul,
      panX:    camX * bgPanFactor,
      panY:    camY * bgPanFactor,
    };

    return { wordLayout: true, words: wl, cameraOverride };
  },

  /* ═══════════════════════════════════════════════
     14. DRIFT — «Плавная кинематографическая камера»
     Мягкая версия montage. Вместо HOLD/LIFT/SETTLE фаз с жёсткими
     cos-smoothstep переходами — ОДНА непрерывная траектория через все
     слова по catmull-rom сплайну.

     Принципы:
     1. Камера постоянно в движении — никогда не замирает
     2. Zoom почти постоянный (≈1.7×) с мягким дыханием ±0.15
        — больше нет контрастных прыжков 2.15 ↔ 1.25
     3. Длинные INTRO и OUTRO: камера плывёт к первому слову откуда-то
        слева-снизу и уходит за экран после последнего
     4. Low-frequency sway всегда присутствует (cos/sin с периодом ~15с)
        — даёт ощущение "живой" камеры
     5. Bass-реакция мягкая: лёгкое дрожание, не кик

     Этот режим читается как "тебя медленно везут через композицию",
     а не "камера прыгает между словами".
  ═══════════════════════════════════════════════ */
  drift({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    // ── Seed ──
    let seed = 0;
    for (const w of words) seed = (seed * 31 + w.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;
    function hash(i, salt) {
      let s = ((i * 2654435761) ^ (salt * seed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    // ═══════════════════════════════════════════════
    // ГОРИЗОНТАЛЬНЫЙ LAYOUT — строка, а не разбросанное месиво.
    // Камера едет ВДОЛЬ строки, а не скачет по 2D-сетке.
    // ═══════════════════════════════════════════════
    const layout = _horizontalLineLayout(ctx, words, fontSize, font, hash, 0.22);
    const worldPos = layout.positions;
    const lineW    = layout.totalW;

    // Все слова одной толщины — иерархию даёт камера, не per-word scale
    const wordBaseScale = words.map(() => 1.0);

    const wordRotation = words.map((_, i) => (hash(i + 1, 29) - 0.5) * 0.14);

    // ═══════════════════════════════════════════════
    // ВИРТУАЛЬНАЯ КАМЕРА — одна непрерывная траектория
    // Длина строки определяет зум: чем длиннее строка, тем меньше zoom
    // чтобы слова всегда читались.
    // ═══════════════════════════════════════════════
    // Базовый зум: подбирается так чтобы 2-3 слова помещались в кадр.
    // Для строки в 5 слов при fontSize=96 lineW ≈ 800px, canvasW=1280.
    // Z_MEAN ≈ canvasW / (lineW × 0.55) — видим ~55% строки.
    const Z_MEAN = Math.max(1.20, Math.min(1.70, canvasW / (lineW * 0.55)));
    const Z_DIP  = 0.15;   // отъезд при подлёте к слову — мягкий

    const introDur = Math.min(duration * 0.22, 0.60);
    const outroDur = Math.min(duration * 0.12, 0.35);
    const activeDur = Math.max(0.3, duration - introDur - outroDur);

    const bassOver = Math.max(0, bands.bass - 0.32) * params.bassSens;

    // Catmull-Rom через 4 точки. Проходит через p1 и p2, контроль — p0,p3
    function catmull(p0, p1, p2, p3, τ) {
      const τ2 = τ * τ;
      const τ3 = τ2 * τ;
      return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * τ +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * τ2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * τ3
      );
    }

    // ── Offscreen-точки: ВСЕГДА по горизонтали (слева/справа от строки),
    // поскольку сама строка теперь горизонтальна. Раньше был 2π-seeded угол,
    // из-за которого камера могла "прилетать сверху" при горизонтальной
    // строке — выглядело как случайное мотание.
    // Seed решает только с КАКОЙ стороны приходит камера (слева/справа).
    const introFromLeft = hash(0, 71) < 0.5;
    const outroToLeft   = hash(0, 89) > 0.5;   // чаще идём от intro стороны
    const sideDist = lineW / 2 + canvasW * 0.25;
    const introPoint = {
      x: introFromLeft ? -sideDist : sideDist,
      y: worldPos[0].y + (hash(0, 73) - 0.5) * fontSize * 0.15,
    };
    const outroPoint = {
      x: outroToLeft ? -sideDist : sideDist,
      y: worldPos[n - 1].y + (hash(0, 97) - 0.5) * fontSize * 0.15,
    };

    let camX, camY, camZoom, focusIdx;

    if (elapsed < introDur) {
      // ── INTRO: плывём от стороны строки к первому слову ──
      const p = elapsed / introDur;
      const e = p < 0.5
        ? 4 * p * p * p
        : 1 - Math.pow(-2 * p + 2, 3) / 2;
      camX = introPoint.x * (1 - e) + worldPos[0].x * e;
      camY = introPoint.y * (1 - e) + worldPos[0].y * e;
      // Zoom: стартуем чуть шире (1.05) и плавно выходим на Z_MEAN
      camZoom = 1.05 + (Z_MEAN - 1.05) * e;
      focusIdx = 0;
    } else if (elapsed < introDur + activeDur) {
      // ── ACTIVE: catmull-rom через все слова ──
      const activeT = elapsed - introDur;
      const normT   = activeT / activeDur;
      const floatIdx = normT * Math.max(n - 1, 1);
      const i1 = Math.min(Math.floor(floatIdx), n - 1);
      const localP = floatIdx - i1;
      const i2 = Math.min(i1 + 1, n - 1);
      const im1 = i1 > 0 ? i1 - 1 : Math.max(0, 2 * i1 - i2);
      const ip2 = i2 < n - 1 ? i2 + 1 : Math.min(n - 1, 2 * i2 - i1);

      if (n === 1) {
        camX = worldPos[0].x;
        camY = worldPos[0].y;
      } else {
        camX = catmull(worldPos[im1].x, worldPos[i1].x, worldPos[i2].x, worldPos[ip2].x, localP);
        camY = catmull(worldPos[im1].y, worldPos[i1].y, worldPos[i2].y, worldPos[ip2].y, localP);
      }

      // Zoom дышит: чуть отъезжает между словами, возвращается на слове
      const betweenFactor = Math.sin(localP * Math.PI);
      camZoom = Z_MEAN - betweenFactor * Z_DIP;

      focusIdx = localP < 0.5 ? i1 : i2;
    } else {
      // ── OUTRO: от последнего слова к стороне строки ──
      const p = (elapsed - introDur - activeDur) / outroDur;
      const e = p < 0.5
        ? 4 * p * p * p
        : 1 - Math.pow(-2 * p + 2, 3) / 2;
      camX = worldPos[n - 1].x * (1 - e) + outroPoint.x * e;
      camY = worldPos[n - 1].y * (1 - e) + outroPoint.y * e;
      camZoom = Z_MEAN - e * 0.25;
      focusIdx = n - 1;
    }

    // ══ Low-frequency sway ═══════════════════════════
    // Амплитуды уменьшены — для горизонтальной строки большой Y-sway
    // выглядит странно (текст ведь читается горизонтально).
    camX += Math.sin(t * 0.22) * fontSize * 0.12
          + Math.sin(t * 0.53) * fontSize * 0.05;
    camY += Math.cos(t * 0.19) * fontSize * 0.06
          + Math.cos(t * 0.47) * fontSize * 0.03;
    camZoom += Math.sin(t * 0.31) * 0.04;

    // ══ Soft bass response ═══════════════════════════
    if (bassOver > 0.08) {
      camX += Math.sin(t * 6.3) * bassOver * fontSize * 0.028;
      camY += Math.cos(t * 5.7) * bassOver * fontSize * 0.018;
      camZoom += bassOver * 0.03;
    }

    // ── Рендерим слова через трансформацию камеры ──
    const wl = words.map((word, i) => {
      const wp = worldPos[i];

      // Каждое слово очень мягко покачивается на своей позиции
      const swayPhase = t * (0.6 + hash(i + 1, 37) * 0.7) + i * 0.5;
      const swayX = Math.sin(swayPhase)        * fontSize * 0.022;
      const swayY = Math.cos(swayPhase * 1.15) * fontSize * 0.014;

      const finalX = (wp.x + swayX - camX) * camZoom;
      const finalY = (wp.y + swayY - camY) * camZoom;

      // Focus boost слабый
      const isFocus    = (i === focusIdx);
      const focusBoost = isFocus ? 1.05 : 1.0;
      let scale = wordBaseScale[i] * camZoom * focusBoost;

      if (isFocus) scale *= 1 + bassOver * 0.05;

      let rotation = wordRotation[i]
                   + Math.sin(swayPhase * 0.4) * 0.008;

      // ── Alpha: depth-fade по горизонтали ──
      let alpha = isFocus ? 1.0 : 0.88;
      const worldDist = Math.abs(wp.x - camX);
      const maxDist   = Math.max(lineW * 0.55, fontSize * 2);
      const depthFade = Math.max(0.65, 1 - worldDist / maxDist);
      alpha *= depthFade;

      // Intro/outro fade
      if (elapsed < introDur) {
        alpha *= elapsed / introDur;
      } else if (elapsed > introDur + activeDur) {
        const outP = (elapsed - introDur - activeDur) / outroDur;
        alpha *= 1 - outP;
      }

      return {
        word,
        x: finalX,
        y: finalY,
        scale,
        alpha,
        rotation,
      };
    });

    // ═══════════════════════════════════════════════
    // CAMERA OVERRIDE — фон зумится и панорамируется вместе с текстом
    // ═══════════════════════════════════════════════
    const bgZoomMul = Math.min(camZoom, 1.5);
    const bgPanFactor = bgZoomMul - 1;
    const cameraOverride = {
      zoomMul: bgZoomMul,
      panX:    camX * bgPanFactor,
      panY:    camY * bgPanFactor,
    };

    return { wordLayout: true, words: wl, cameraOverride };
  },

  /* ═══════════════════════════════════════════════
     SCROLL — горизонтальная/вертикальная/диагональная прокрутка текста.
     Текст бесконечно едет в заданном направлении, скорость управляется
     параметром bassSens и текущей энергией полосы.

     Реализация через простой block-offset (offsetX/offsetY):
       - скорость = bassSens * 120 + полоса * 200  пиксель/сек
       - elapsed используется для монотонного накопления сдвига
       - при выходе за пределы экрана — wrap-around незаметен
         (текст плотно — один экземпляр занимает canvasW, второй рядом)

     Вместо wrap внутри AnimModes возвращаем просто offsetX/Y.
     Рендерер сам рисует текст через ctx.translate, поэтому текст уедет
     за экран. Для loop-эффекта мы дублируем строку offsetX - canvasW/W.
     Проще: большой offsetX модулируем по ширине текста.
  ═══════════════════════════════════════════════ */
  scroll_left({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    const speed   = (params.bassSens * 120 + bands.overall * 200);
    const rawOff  = elapsed * speed;
    // Ширина строки для wrap: используем приблизительную оценку
    const approxW = words.join(' ').length * fontSize * 0.58;
    const wrapW   = Math.max(approxW, canvasW);
    const offsetX = -(rawOff % wrapW);
    springs.scale.target = 1 + bands.bass * params.bassSens * 0.15;
    return {
      scaleX:  springs.scale.value,
      scaleY:  springs.scale.value,
      offsetX,
      offsetY: 0,
      alpha: 1,
      _scrollDupe: { dx: wrapW, dy: 0 }, // сигнал рендереру дублировать
    };
  },

  scroll_right({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    const speed   = (params.bassSens * 120 + bands.overall * 200);
    const rawOff  = elapsed * speed;
    const approxW = words.join(' ').length * fontSize * 0.58;
    const wrapW   = Math.max(approxW, canvasW);
    const offsetX = rawOff % wrapW;
    springs.scale.target = 1 + bands.bass * params.bassSens * 0.15;
    return {
      scaleX:  springs.scale.value,
      scaleY:  springs.scale.value,
      offsetX,
      offsetY: 0,
      alpha: 1,
      _scrollDupe: { dx: -wrapW, dy: 0 },
    };
  },

  scroll_up({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    const speed   = (params.bassSens * 80 + bands.overall * 140);
    const rawOff  = elapsed * speed;
    const lineH   = fontSize * 1.8;
    const offsetY = -(rawOff % (canvasH + lineH));
    springs.scale.target = 1 + bands.bass * params.bassSens * 0.12;
    return {
      scaleX:  springs.scale.value,
      scaleY:  springs.scale.value,
      offsetX: 0,
      offsetY,
      alpha: 1,
      _scrollDupe: { dx: 0, dy: canvasH + lineH },
    };
  },

  scroll_down({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    const speed   = (params.bassSens * 80 + bands.overall * 140);
    const rawOff  = elapsed * speed;
    const lineH   = fontSize * 1.8;
    const offsetY = rawOff % (canvasH + lineH);
    springs.scale.target = 1 + bands.bass * params.bassSens * 0.12;
    return {
      scaleX:  springs.scale.value,
      scaleY:  springs.scale.value,
      offsetX: 0,
      offsetY,
      alpha: 1,
      _scrollDupe: { dx: 0, dy: -(canvasH + lineH) },
    };
  },

  scroll_diag_dr({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    const speed   = (params.bassSens * 100 + bands.overall * 170);
    const rawOff  = elapsed * speed;
    const approxW = words.join(' ').length * fontSize * 0.58;
    const wrapD   = Math.max(approxW, canvasW);
    const offsetX = rawOff % wrapD;
    const offsetY = (rawOff * 0.5) % (canvasH * 0.8);
    springs.scale.target = 1 + bands.bass * params.bassSens * 0.12;
    return {
      scaleX: springs.scale.value, scaleY: springs.scale.value,
      offsetX, offsetY, alpha: 1,
      _scrollDupe: { dx: -wrapD, dy: -(canvasH * 0.8) },
    };
  },

  scroll_diag_ul({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    const speed   = (params.bassSens * 100 + bands.overall * 170);
    const rawOff  = elapsed * speed;
    const approxW = words.join(' ').length * fontSize * 0.58;
    const wrapD   = Math.max(approxW, canvasW);
    const offsetX = -(rawOff % wrapD);
    const offsetY = -(rawOff * 0.5) % (canvasH * 0.8);
    springs.scale.target = 1 + bands.bass * params.bassSens * 0.12;
    return {
      scaleX: springs.scale.value, scaleY: springs.scale.value,
      offsetX, offsetY, alpha: 1,
      _scrollDupe: { dx: wrapD, dy: canvasH * 0.8 },
    };
  },

  /* ═══════════════════════════════════════════════
     STACK — «Живая пресс-доска»
     Слова разного размера падают сверху и складываются стопкой как
     газетные вырезки — каждое на своей строке, со случайным наклоном,
     как будто их бросили на стол. Бас заставляет всю стопку сотрясаться.

     Это НЕ построение строки — это коллаж, журнальный разворот.
     Каждое слово — отдельный объект в стеке, живёт в 2D.
  ═══════════════════════════════════════════════ */
  stack({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    let seed = 0;
    for (const w of words) seed = (seed * 31 + w.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;
    function hash(i, salt) {
      let s = ((i * 2654435761) ^ (salt * seed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    // Размеры: слова разного «веса» как газетные заголовки
    const scaleMult = words.map((_, i) => {
      const r = hash(i + 1, 5);
      // Бимодальное: либо крупный заголовок (1.4-2.2), либо мелкий подзаголовок (0.5-0.9)
      return r < 0.35 ? 0.5 + r * 1.14 : 1.2 + (r - 0.35) * 1.54;
    });

    const baseWidths = _measureWordsPx(ctx, words, fontSize, font);
    const bassOver   = Math.max(0, bands.bass - 0.30) * params.bassSens;

    // Укладываем слова сверху вниз: каждое слово занимает высоту = fontSize × scaleMult × 1.3
    // Центруем весь стек по высоте
    const rowHeights = scaleMult.map(s => fontSize * s * 1.35);
    const totalStackH = rowHeights.reduce((a, b) => a + b, 0);
    let stackCursor = -totalStackH / 2;

    // Bass-дрожание всей стопки: единый вектор для все слов
    const stackShakeX = bassOver > 0.2 ? Math.sin(t * 23 + 1) * bassOver * fontSize * 0.06 : 0;
    const stackShakeY = bassOver > 0.2 ? Math.cos(t * 17 + 3) * bassOver * fontSize * 0.04 : 0;
    const stackRot    = bassOver > 0.2 ? Math.sin(t * 11)     * bassOver * 0.025           : 0;

    const wl = words.map((word, i) => {
      const rowH  = rowHeights[i];
      const centerY = stackCursor + rowH / 2;
      stackCursor += rowH;

      // Reveal: слово падает сверху
      const dropDelay = (i / Math.max(n - 1, 1)) * Math.min(duration * 0.55, 1.0);
      const dropT     = Math.max(0, elapsed - dropDelay);
      const rawProg   = Math.min(dropT / 0.28, 1);
      // Ease out quart — резкий влёт, мягкая посадка
      const eased     = 1 - Math.pow(1 - rawProg, 4);

      const startY = centerY - canvasH * 0.6;
      const y      = startY + (centerY - startY) * eased;

      // Небольшое X-смещение для «небрежности»
      const xJitter  = (hash(i + 1, 11) - 0.5) * canvasW * 0.28;

      // Rotation: газетная небрежность ±18°, замирает при посадке
      const restRot  = (hash(i + 1, 17) - 0.5) * 0.32;
      const dropRot  = (1 - eased) * (hash(i + 1, 23) - 0.5) * 0.8;
      const rotation = restRot + dropRot + stackRot;

      // Мини-отскок при посадке (scale)
      let scale = scaleMult[i] * eased;
      if (rawProg > 0.78 && rawProg < 1) {
        const bounceP = (rawProg - 0.78) / 0.22;
        scale *= 1 + Math.sin(bounceP * Math.PI) * 0.12;
      }
      if (rawProg >= 1) {
        scale *= scaleMult[i] * (1 + bassOver * 0.08);
        scale  = scale / scaleMult[i]; // нормализуем обратно
        scale *= scaleMult[i];
      }

      const alpha = Math.min(rawProg * 2.5, 1);

      // Эффект «вдавливания» при посадке: краткий y-bounce
      let landY = y;
      if (rawProg > 0.82 && rawProg < 1) {
        const lp = (rawProg - 0.82) / 0.18;
        landY += Math.sin(lp * Math.PI) * fontSize * scaleMult[i] * 0.08;
      }

      return {
        word,
        x:        xJitter + stackShakeX,
        y:        landY   + stackShakeY,
        scale:    scale,
        alpha,
        rotation,
      };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     SHOCKWAVE — «Ударная волна»
     Строка целиком стартует в центре компактной «точкой» (scale 0.01),
     потом взрывается наружу одним резким импульсом — расталкивает
     слова в стороны по взрывным траекториям, они медленно возвращаются.
     Бас запускает ПОВТОРНЫЕ волны поверх основных.

     Это единственный режим где слова УЛЕТАЮТ ЗА ЭКРАН и возвращаются.
  ═══════════════════════════════════════════════ */
  shockwave({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    let seed = 0;
    for (const w of words) seed = (seed * 31 + w.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;
    function hash(i, salt) {
      let s = ((i * 2654435761) ^ (salt * seed * 1597334677)) | 0;
      s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35); s ^= s >>> 16;
      return (s >>> 0) / 4294967296;
    }

    const baseWidths = _measureWordsPx(ctx, words, fontSize, font);
    const wordGap    = fontSize * 0.42;
    const totalW     = baseWidths.reduce((a, b) => a + b, 0) + wordGap * (n - 1);
    const targetXs   = [];
    let cursor = -totalW / 2;
    for (let i = 0; i < n; i++) {
      targetXs.push(cursor + baseWidths[i] / 2);
      cursor += baseWidths[i] + wordGap;
    }

    // Главный взрыв: 0 → 0.35s
    const BLAST_DUR    = 0.35;
    const RETURN_START = 0.35;
    const RETURN_DUR   = Math.max(0.5, duration * 0.55);

    // Направление взрыва для каждого слова — расходятся от центра
    const blastAngles = words.map((_, i) => {
      // Равномерно по кругу + seeded jitter
      const base  = (i / Math.max(n - 1, 1) - 0.5) * Math.PI * 1.4;
      return base + (hash(i + 1, 7) - 0.5) * 0.9;
    });
    const blastDist = Math.max(canvasW, canvasH) * 0.65;

    const bassOver = Math.max(0, bands.bass - 0.35) * params.bassSens;

    // Периодические bass-волны после сборки
    // Считаем «последний пик баса» детерминированно через floor(t)
    const bassWavePulse = bassOver > 0.25
      ? Math.max(0, 1 - ((t % 0.3) / 0.3)) * bassOver
      : 0;

    const wl = words.map((word, i) => {
      const ang = blastAngles[i];
      let x, y, scale, alpha, rotation;

      if (elapsed < BLAST_DUR) {
        // BLAST OUT: из центра наружу
        const p     = elapsed / BLAST_DUR;
        // Быстрый разгон — ease in cubic
        const eBlast = p * p * p;
        const dist   = eBlast * blastDist * (0.7 + hash(i + 1, 3) * 0.6);
        x = Math.cos(ang) * dist;
        y = Math.sin(ang) * dist * 0.7;
        scale    = Math.max(0.01, 1 - eBlast * 0.65); // уменьшается при разлёте
        alpha    = 1 - eBlast * 0.3;
        rotation = (1 - p) * (hash(i + 1, 11) - 0.5) * 0.8 + ang * 0.2;
      } else {
        // RETURN: возвращение на целевую позицию
        const retT = elapsed - RETURN_START;
        const rawP = Math.min(retT / RETURN_DUR, 1);
        // Ease out elastic-like: overshoots
        const eRet = rawP === 1 ? 1
          : 1 - Math.pow(2, -10 * rawP) * Math.cos((rawP * 10 - 0.75) * (2 * Math.PI) / 3);

        // Текущая «орбита» возвращения
        const dist = blastDist * (0.7 + hash(i + 1, 3) * 0.6) * (1 - eRet);
        x = Math.cos(ang) * dist + targetXs[i] * eRet;
        y = Math.sin(ang) * dist * 0.7;
        scale    = 0.35 + 0.65 * eRet;
        alpha    = 0.7 + 0.3 * eRet;
        rotation = ang * 0.2 * (1 - eRet) + Math.sin(t * 1.2 + i * 0.9) * 0.015;

        // Bass-волны: кратковременный разброс от накопившегося баса
        if (bassWavePulse > 0.05 && rawP >= 1) {
          const push = bassWavePulse * fontSize * 0.9;
          x += Math.cos(ang + t * 2) * push;
          y += Math.sin(ang + t * 2) * push * 0.6;
          scale *= 1 + bassWavePulse * 0.18;
        }
      }

      return { word, x, y, scale, alpha, rotation };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     PENDULUM_WAVE — «Маятниковая волна»
     Каждое слово — маятник на своей длине. Маятники запущены синхронно,
     но с разными периодами (пропорционально позиции в строке).
     Через несколько секунд они расходятся в хаос, потом снова сходятся —
     классический эксперимент с маятниками Большого Адронного Коллайдера.

     Ось маятника — верх экрана. Слова качаются вниз-вниз.
     Бас увеличивает начальный угол отклонения.
  ═══════════════════════════════════════════════ */
  pendulum_wave({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    const baseWidths = _measureWordsPx(ctx, words, fontSize, font);

    // Длина каждого маятника: от коротких (быстрые) к длинным (медленные)
    // n маятников с периодами T_min..T_max
    const T_MIN    = 1.8;   // секунд (самый короткий маятник)
    const T_MAX    = 3.2;   // секунд (самый длинный)
    const bassOver = Math.max(0, bands.bass - 0.25) * params.bassSens;

    // Начальный угол: растёт с басом
    const baseTheta0 = 0.52 + bassOver * 0.55;  // ≈30° + bass

    // Ось подвеса: верхняя треть экрана
    const pivotY   = -canvasH * 0.38;
    // Длина маятника: от canvasH*0.28 до canvasH*0.72
    const lenMin   = canvasH * 0.28;
    const lenMax   = canvasH * 0.72;

    const wl = words.map((word, i) => {
      const norm = n > 1 ? i / (n - 1) : 0.5;
      // Период: чем правее — тем длиннее маятник и медленнее
      const T    = T_MIN + norm * (T_MAX - T_MIN);
      const len  = lenMin + norm * (lenMax - lenMin);
      const omega = (2 * Math.PI) / T;

      // Угол маятника: θ = θ₀ × cos(ω × t)
      // Reveal: первые 0.4с маятник «запускается» (amplitude нарастает)
      const revealT  = Math.min(elapsed / 0.40, 1);
      const theta0   = baseTheta0 * revealT;
      const theta    = theta0 * Math.cos(omega * elapsed);

      // Позиция конца маятника относительно оси
      const px = Math.sin(theta) * len;
      const py = pivotY + Math.cos(theta) * len;

      // Scale: слегка растёт в нижней точке (инерция)
      const velFactor = Math.abs(Math.sin(omega * elapsed));
      const scale = 0.85 + velFactor * 0.25 + bassOver * 0.08;

      // Alpha: полная при reveal
      const alpha = revealT;

      // Rotation: наклон по касательной к траектории (−theta для правдоподобия)
      const rotation = theta * 0.55;

      return { word, x: px, y: py, scale, alpha, rotation };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     DOMINO — «Домино»
     Слова стоят вертикально (повёрнуты на 90°) и по очереди падают
     как костяшки домино, толкая следующее. Когда все упали —
     они лежат горизонтально, читаемые, как обычно.

     Это анимация с чётким физическим нарративом: падение → удар → передача.
  ═══════════════════════════════════════════════ */
  domino({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };
    const n = words.length;

    const baseWidths = _measureWordsPx(ctx, words, fontSize, font);
    const wordGap    = fontSize * 0.50;
    const totalW     = baseWidths.reduce((a, b) => a + b, 0) + wordGap * (n - 1);
    const targetXs   = [];
    let cursor = -totalW / 2;
    for (let i = 0; i < n; i++) {
      targetXs.push(cursor + baseWidths[i] / 2);
      cursor += baseWidths[i] + wordGap;
    }

    const bassOver = Math.max(0, bands.bass - 0.28) * params.bassSens;

    // Каждая костяшка падает через FALL_DUR секунд после удара предыдущей
    const FALL_DUR    = 0.28;   // длительность самого падения
    const HIT_STAGGER = 0.22;   // задержка передачи удара

    const wl = words.map((word, i) => {
      const fallStart = i * HIT_STAGGER;
      const fallT     = Math.max(0, elapsed - fallStart);
      const rawProg   = Math.min(fallT / FALL_DUR, 1);

      // Ease in quad: ускорение при падении
      const easedFall  = rawProg * rawProg;

      // Угол: стоит вертикально (-π/2), падает к горизонтали (0)
      // Падает вправо (положительный угол убывает к 0)
      const startAngle = -Math.PI / 2 + 0.1;  // чуть не вертикально (уже чуть наклонена)
      const rotation   = startAngle * (1 - easedFall);

      // Позиция: центр вращения — нижний торец буквы
      // При падении вправо, верхний конец описывает дугу
      // y-смещение: когда стоит, слово «торчит вверх» на fontSize/2
      //             когда лежит, слово на обычной высоте
      const standH  = fontSize * 0.5;  // сколько торчит вверх
      const yStand  = -standH * (1 - easedFall); // убирается при падении

      // При ударе о землю — подскок следующей
      let extraY = 0;
      if (rawProg >= 1 && bassOver > 0.15) {
        extraY = -Math.sin(t * 8 + i * 0.7) * bassOver * fontSize * 0.06;
      }

      // Impact flash: при завершении падения — кратковременный scale spike
      let scale = 1;
      if (rawProg > 0.88 && rawProg <= 1) {
        const ip = (rawProg - 0.88) / 0.12;
        scale = 1 + Math.sin(ip * Math.PI) * 0.18;
      }
      if (rawProg >= 1) {
        scale *= 1 + bassOver * 0.07;
      }

      const alpha = Math.min(fallT / (FALL_DUR * 0.6), 1);

      return {
        word,
        x:        targetXs[i],
        y:        yStand + extraY,
        scale,
        alpha,
        rotation,
      };
    });

    return { wordLayout: true, words: wl };
  },

  /* ═══════════════════════════════════════════════
     LIQUID — «Жидкость»
     Буквы ведут себя как капли: каждая медленно стекает вниз,
     колышется, «слипается» с соседними. На бас — «всплеск» вверх.

     Используем perLetter: true. Каждая буква — отдельная капля с
     уникальной вязкостью (скоростью стекания).
  ═══════════════════════════════════════════════ */
  liquid({ bands, t, params, springs, words, canvasW, canvasH, elapsed, duration, fontSize, ctx, font }) {
    if (!words || !words.length) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };

    const letters = [];
    words.forEach((w, wi) => {
      for (const ch of w) letters.push({ char: ch, space: false });
      if (wi < words.length - 1) letters.push({ char: ' ', space: true });
    });
    const n = letters.length;
    if (!n) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, alpha: 1 };

    let widths;
    if (ctx && typeof ctx.measureText === 'function') {
      const prev = ctx.font;
      ctx.font = `${fontSize}px ${font || 'sans-serif'}`;
      widths = letters.map(l => l.space ? fontSize * 0.35 : Math.max(ctx.measureText(l.char).width * 1.04, fontSize * 0.2));
      ctx.font = prev;
    } else {
      widths = letters.map(l => l.space ? fontSize * 0.35 : fontSize * 0.55);
    }

    const totalW = widths.reduce((a, b) => a + b, 0);
    const txs = [];
    let cur = -totalW / 2;
    for (let i = 0; i < n; i++) { txs.push(cur + widths[i] / 2); cur += widths[i]; }

    let seed = 0;
    for (const l of letters) seed = (seed * 31 + l.char.charCodeAt(0)) | 0;
    seed = Math.abs(seed % 9973) + 1;
    function rand(i, s) {
      let v = ((i * 1664525) ^ (s * seed * 1597334677)) | 0;
      v ^= v >>> 13; v = Math.imul(v, 0xc2b2ae35); v ^= v >>> 16;
      return (v >>> 0) / 4294967296;
    }

    const bassOver = Math.max(0, bands.bass - 0.28) * params.bassSens;
    // Splash: на бас — капли взлетают вверх
    const splashAmp = bassOver * fontSize * 0.55;

    const wl = letters.map((letter, i) => {
      if (letter.space) return { word: '', x: txs[i], y: 0, scale: 0, alpha: 0, rotation: 0 };

      // «Вязкость» каждой буквы — рандомная частота стекания
      const viscosity  = 0.6 + rand(i, 3) * 0.8;   // медленные и быстрые капли
      const dropPhase  = t * viscosity + rand(i, 7) * Math.PI * 2;
      const dropOffset = rand(i, 11);

      // Основное стекание: синус с drift вниз
      const drip = Math.sin(dropPhase) * fontSize * 0.14
                 + Math.sin(dropPhase * 1.7 + 1) * fontSize * 0.06;

      // Горизонтальное «слипание» с соседними
      const sideWobble = Math.sin(dropPhase * 0.7 + i * 0.5) * fontSize * 0.04;

      // Splash вверх на бас (каждая буква в свой момент)
      const splashPhase = t * 4.5 + rand(i, 19) * Math.PI * 2;
      const splash = splashAmp > 0.5
        ? -Math.max(0, Math.sin(splashPhase)) * splashAmp * (0.5 + rand(i, 23) * 0.8)
        : 0;

      // Scale: «пухнет» в нижней точке стекания (поверхностное натяжение)
      const scaleWobble = 1 + Math.sin(dropPhase + 1.5) * 0.07;
      const scaleX_val  = scaleWobble * (1 - Math.sin(dropPhase) * 0.05);
      const scaleY_val  = scaleWobble * (1 + Math.sin(dropPhase) * 0.08);

      // Reveal: буквы проявляются как капли с потолка
      const revealT  = Math.min(elapsed / 0.45, 1);
      const revealY  = (1 - revealT) * (-fontSize * 0.4);

      return {
        word:     letter.char,
        x:        txs[i] + sideWobble,
        y:        drip + splash + revealY,
        // liquid передаёт per-axis scale через кастомное поле — рендерер использует wData.scale
        // Приближаем: берём среднее
        scale:    (scaleX_val + scaleY_val) / 2 * revealT,
        alpha:    revealT,
        rotation: Math.sin(dropPhase * 0.5) * 0.05,
      };
    });

    return { wordLayout: true, perLetter: true, words: wl };
  },

};
