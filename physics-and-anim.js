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

};
