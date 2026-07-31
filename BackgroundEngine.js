/* ═══════════════════════════════════════════════
   js/BackgroundEngine.js  v2
   Управляет фоном (картинка / видео) и применяет
   аудио-реактивные эффекты + система управления камерой.

   ВСТРОЕННЫЕ ЭФФЕКТЫ:
   1. Ken Burns  — медленный зум + пан, амплитуда от баса
   2. Color Grade — насыщенность и яркость от баса
   3. Vignette   — радиальное затемнение, пульсирует с битом
   4. Chromatic  — лёгкое хроматическое расщепление от хаёв

   КАМЕРА (новое):
   5. Static Zoom   — фиксированный зум, настраивается ползунком
   6. Music Zoom    — зум реагирует на бас (вовнутрь / наружу)
   7. Scroll X      — горизонтальная прокрутка с настраиваемой скоростью
   8. Scroll Y      — вертикальная прокрутка с настраиваемой скоростью

   Все эффекты управляются через UI-ползунки и через
   LRC-команды в FX Editor (per-line).
═══════════════════════════════════════════════ */
const BackgroundEngine = (() => {
  let media     = null;
  let mediaType = null;

  // ── Ken Burns state ──────────────────────────
  let kb = {
    x: 0, y: 0,
    vx: 0.0003, vy: 0.0002,
    scale: 1.06,
  };

  // ── Spring для плавного музыкального зума ────
  let musicZoomSpring = null;
  // Spring для плавного включения/выключения эффекта зума
  let musicZoomTransitionSpring = null;
  // Отдельный сглаживатель баса для музыкального зума —
  // более медленный чем основной FrequencyBands, убирает острые пики
  let _musicZoomBassSmooth = 0;

  function ensureMusicZoomSpring() {
    if (!musicZoomSpring) {
      musicZoomSpring = new SpringPhysics({
        stiffness: 0.15,   // быстрее реагирует на биты
        damping:   0.82,   // overdamped — плавное затухание без колебаний
        initial:   0
      });
    }
  }

  function ensureMusicZoomTransitionSpring() {
    if (!musicZoomTransitionSpring) {
      musicZoomTransitionSpring = new SpringPhysics({
        stiffness: 0.12,   // плавное включение/выключение
        damping:   0.88,   // сильно overdamped — без колебаний
        initial:   0
      });
    }
  }

  // ── Spring для плавной реакции letterbox на бас ────
  let letterboxBassSpring = null;
  function ensureLetterboxBassSpring() {
    if (!letterboxBassSpring) {
      letterboxBassSpring = new SpringPhysics({
        stiffness: 0.25,  // быстрая реакция
        damping: 0.65,    // хорошее сглаживание
        initial: 0
      });
    }
  }

  // ── Audio-reactive FX toggles ────────────────
  const fx = {
    kenBurns:   true,
    colorGrade: false,
    vignette:   false,
    chromatic:  false,
    letterbox:  false,        // статичные черные полосы
    letterboxReactive: false, // реактивные полосы (реагируют на музыку)
  };

  // ── Camera controls ──────────────────────────
  // Все значения напрямую мутируются через setCamParam() и applyBackgroundCommand()
  const cam = {
    // Статичный зум (ручной множитель поверх cover-fit)
    zoom: {
      enabled: false,
      value:   1.3,     // 1.0 – 3.0
    },
    // Музыкальный зум (реакция на бас)
    musicZoom: {
      enabled: false,
      invert:  false,   // false = зум вовнутрь на бит, true = наружу
      amount:  0.4,     // 0.1 – 1.5, сила реакции
    },
    // Горизонтальная прокрутка
    scrollX: {
      enabled:   false,
      speed:     0.05,  // нормализованных единиц / сек (0.005 – 0.5)
      direction: 1,     //  1 = вправо, -1 = влево
      position:  0,     // текущее положение [-1 .. 1]
    },
    // Вертикальная прокрутка
    scrollY: {
      enabled:   false,
      speed:     0.05,
      direction: 1,     //  1 = вниз, -1 = вверх
      position:  0,
    },
  };

  // ── Состояние команд фона ────────────────────
  const bgState = {
    darken:  false,
    brighten: false,
    blur:    false,
  };

  // ═══════════════════════════════════════════════
  //  PER-LINE CAMERA SCENE (cinematic) — пресеты камеры
  //  с прогрессом 0..1 от длительности блока строк.
  //  Когда blend>0, scene частично перебивает baseline-камеру.
  // ═══════════════════════════════════════════════
  const lineScene = {
    active:        false,
    preset:        'hold',
    intensity:     0.5,
    focusX:        50,
    focusY:        50,
    lineStartTime: 0,
    lineDuration:  1.0,
    blend:         0,
    // Появление / исчезновение — настраивается per-scene
    fadeIn:        0.4,
    fadeOut:       0.4,
    fadeEasing:    'smooth',  // 'smooth' | 'linear' | 'snap'
    // Multi-line context — какая строка из блока активна сейчас
    currentLineIdx: 0,
    blockStartLine: 0,
    blockEndLine:   0,
  };
  const SCENE_BLEND_SPEED = 5.0;

  const sceneEase = {
    linear: t => t,
    inOut:  t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    out:    t => 1 - Math.pow(1 - t, 3),
    in:     t => t * t,
    sinIn:  t => 1 - Math.cos((t * Math.PI) / 2),
  };

  function _csClampNum(v, lo, hi, def) {
    if (v == null || isNaN(v)) return def;
    return Math.max(lo, Math.min(hi, +v));
  }
  function _csLerp(a, b, t) { return a + (b - a) * t; }

  // Каждый пресет принимает (p, scene, bands, t) и возвращает:
  // { zoom, focusX, focusY, rot, shakeX, shakeY }
  const SCENE_PRESETS = {
    // 🎯 Punch In — мощный удар-зум в начале + лёгкое дыхание
    punchIn(p, s, bands, t) {
      const kick = sceneEase.out(Math.max(0, 1 - p * 4));
      const hold = 1 + 0.06 * Math.sin(t * 1.3);
      const z    = (1 + s.intensity * (1.10 * kick + 0.30)) * hold;
      return { zoom: z, focusX: s.focusX, focusY: s.focusY, rot: 0, shakeX: 0, shakeY: 0 };
    },
    // 🌊 Slow Drift — плавный наезд по диагонали
    slowDrift(p, s) {
      const e = sceneEase.inOut(p);
      const z = 1 + s.intensity * 0.60 * e;
      let dx = (s.focusX - 50);
      let dy = (s.focusY - 50);
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) { dx = 14; dy = 10; }
      const fx = 50 + dx * e;
      const fy = 50 + dy * e;
      return { zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0 };
    },
    // 💨 Whip Pan — резкий хлёсткий пан с противоположной стороны
    whipPan(p, s) {
      const e = sceneEase.out(Math.min(1, p * 2.0));
      const startX = 100 - s.focusX;
      const startY = 100 - s.focusY;
      const fx = startX + (s.focusX - startX) * e;
      const fy = startY + (s.focusY - startY) * e;
      const overshoot = (1 - Math.abs(p - 0.55) * 4);
      const wobble = overshoot > 0 ? Math.sin(p * 32) * overshoot * s.intensity * 9 : 0;
      const z = 1.25 + s.intensity * 0.30;
      return { zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: wobble, shakeY: 0 };
    },
    // 🌀 Vertigo — Hitchcock dolly: зум растёт, точка фокуса дрейфует
    vertigo(p, s) {
      const e = sceneEase.inOut(p);
      const z = 1 + s.intensity * 1.10 * e;
      let dx = (s.focusX - 50);
      let dy = (s.focusY - 50);
      // Дефолтный дрейф если focus в центре — иначе сцена была бы только зумом
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) { dx = 18; dy = 12; }
      return {
        zoom: z,
        focusX: 50 + dx * (1 - e * 0.5),
        focusY: 50 + dy * (1 - e * 0.5),
        rot: 0, shakeX: 0, shakeY: 0,
      };
    },
    // 🌍 Earthquake — землетрясение с пиком в середине
    earthquake(p, s, bands, t) {
      const peak = sceneEase.out(1 - Math.abs(p - 0.5) * 2);
      const k    = s.intensity * peak;
      const sx = (Math.sin(t * 47.3) + Math.cos(t * 31.7)) * k * 32;
      const sy = (Math.sin(t * 37.1) + Math.cos(t * 53.9)) * k * 24;
      const z  = 1.22 + bands.bass * 0.14 * k;
      const r  = Math.sin(t * 23) * k * 0.045;
      return { zoom: z, focusX: 50, focusY: 50, rot: r, shakeX: sx, shakeY: sy };
    },
    // 🪐 Orbit — облёт точки
    orbit(p, s) {
      const ang = sceneEase.inOut(p) * Math.PI * 2 * Math.max(0.5, s.intensity);
      const radius = 16 + s.intensity * 18;
      const fx = s.focusX + Math.cos(ang) * radius;
      const fy = s.focusY + Math.sin(ang) * radius * 0.6;
      const z  = 1.25 + s.intensity * 0.20;
      const r  = Math.sin(ang) * 0.08 * s.intensity;
      return { zoom: z, focusX: fx, focusY: fy, rot: r, shakeX: 0, shakeY: 0 };
    },
    // 🔭 Zoom Out — большое раскрытие к концу строки
    zoomOut(p, s) {
      const e = sceneEase.inOut(p);
      const z = (1 + s.intensity * 0.85) - s.intensity * 0.85 * e;
      const fx = s.focusX + (50 - s.focusX) * e;
      const fy = s.focusY + (50 - s.focusY) * e;
      return { zoom: Math.max(1, z), focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0 };
    },
    // 💓 Pulse — зум пульсирует на бас
    pulse(p, s, bands) {
      const z = 1.15 + bands.bass * s.intensity * 0.65;
      return { zoom: z, focusX: s.focusX, focusY: s.focusY, rot: 0, shakeX: 0, shakeY: 0 };
    },
    // 🎯 Focus Point — наезд на конкретную точку с удержанием
    focusPoint(p, s) {
      const e = sceneEase.out(Math.min(1, p * 2.2));
      const z = 1 + s.intensity * 0.65 * e;
      const fx = 50 + (s.focusX - 50) * e;
      const fy = 50 + (s.focusY - 50) * e;
      return { zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0 };
    },
    // 💥 Crash Zoom — стремительный наезд + удар-встряска
    crashZoom(p, s, bands, t) {
      const e = sceneEase.in(Math.min(1, p * 1.4));
      const z = 1 + s.intensity * 1.35 * e;
      const settle = Math.max(0, 1 - Math.abs(p - 0.65) * 7);
      const sx = Math.sin(t * 91) * s.intensity * 18 * settle;
      const sy = Math.cos(t * 73) * s.intensity * 14 * settle;
      return { zoom: z, focusX: s.focusX, focusY: s.focusY, rot: 0, shakeX: sx, shakeY: sy };
    },
    // ⏸ Hold — фриз камеры
    hold(p, s) {
      return { zoom: 1, focusX: 50, focusY: 50, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // ═══ НОВЫЕ ПРЕСЕТЫ ═══

    // 💗 Heartbeat — двойной пульс «пум-пум, пум-пум»
    heartbeat(p, s, bands, t) {
      // Цикл 1.5 Гц = 90 BPM (типовой ритм сердца)
      const phase = (t * 1.5) % 1;
      const beat1 = Math.max(0, 1 - phase * 8);                  // острый пик в начале
      const beat2 = Math.max(0, 1 - Math.abs(phase - 0.18) * 7);  // второй чуть позже
      const pump  = (beat1 + beat2 * 0.7) * s.intensity;
      const z = 1.10 + bands.bass * 0.08 + pump * 0.32;
      return { zoom: z, focusX: s.focusX, focusY: s.focusY, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // 💢 Shockwave — взрывной ZOOM-OUT на бас + хаотичная встряска
    shockwave(p, s, bands, t) {
      const burst = Math.pow(bands.bass, 1.2) * s.intensity;
      const z = Math.max(1, 1.30 - burst * 0.55);  // на удар отъезжает сильнее
      const sx = (Math.sin(t * 41.7) + Math.cos(t * 67.3)) * burst * 36;
      const sy = (Math.sin(t * 53.1) + Math.cos(t * 79.9)) * burst * 28;
      const r  = Math.sin(t * 29) * burst * 0.06;
      return { zoom: z, focusX: 50, focusY: 50, rot: r, shakeX: sx, shakeY: sy };
    },

    // 🌪 Spiral In — гипнотическая спираль (зум + поворот вместе)
    spiralIn(p, s) {
      const e = sceneEase.inOut(p);
      const z = 1 + s.intensity * 0.85 * e;
      const rot = e * Math.PI * 0.45 * s.intensity; // до ~80° при intensity=1
      return { zoom: z, focusX: s.focusX, focusY: s.focusY, rot, shakeX: 0, shakeY: 0 };
    },

    // 🌀 Whirl — быстрая непрерывная закрутка
    whirl(p, s, bands, t) {
      const baseRot = t * (1.0 + s.intensity * 1.8);
      const rot = baseRot + bands.bass * s.intensity * 0.4;
      const z = 1.20 + Math.sin(t * 4) * 0.06 * s.intensity + bands.bass * 0.08;
      return { zoom: z, focusX: 50, focusY: 50, rot, shakeX: 0, shakeY: 0 };
    },

    // 🎢 Roller Coaster — волна: зум, фокус и поворот качаются синхронно
    rollerCoaster(p, s, bands, t) {
      const z = 1.20 + Math.sin(t * 1.7) * 0.18 * s.intensity + bands.bass * 0.10;
      const fx = 50 + Math.sin(t * 0.9) * 28 * s.intensity;
      const fy = 50 + Math.cos(t * 1.3) * 18 * s.intensity;
      const rot = Math.sin(t * 1.1) * 0.06 * s.intensity;
      return { zoom: z, focusX: fx, focusY: fy, rot, shakeX: 0, shakeY: 0 };
    },

    // ⚡ Glitch Cut — резкие скачки на разные точки + зум-вспышки
    glitchCut(p, s, bands, t) {
      // Скачки 3-4 раза в секунду
      const seg = Math.floor(t * 3.5);
      const h1 = ((seg * 9301 + 49297) % 233280) / 233280;
      const h2 = (((seg + 7) * 9301 + 49297) % 233280) / 233280;
      const fx = s.focusX + (h1 - 0.5) * 70 * s.intensity;
      const fy = s.focusY + (h2 - 0.5) * 50 * s.intensity;
      // Резкий пик зума при каждом скачке
      const segPhase = (t * 3.5) % 1;
      const flash = Math.max(0, 1 - segPhase * 7);
      const z = 1.30 + flash * 0.35 * s.intensity + bands.bass * 0.08;
      const rot = (h1 - 0.5) * 0.08 * s.intensity * flash;
      // Микро-шейк между скачками
      const sx = (Math.sin(t * 87) * 4 * s.intensity * (1 - flash));
      return { zoom: z, focusX: fx, focusY: fy, rot, shakeX: sx, shakeY: 0 };
    },

    // 🎬 Tilt Shift — стильный наклон + зум (ось наклона зависит от focusX)
    tiltShift(p, s) {
      const e = sceneEase.inOut(p);
      const z = 1 + s.intensity * 0.55 * e;
      const dir = s.focusX < 50 ? -1 : (s.focusX > 50 ? 1 : 0.5);
      const rot = e * 0.13 * s.intensity * dir;
      const fx = 50 + (s.focusX - 50) * e * 0.7;
      const fy = 50 + (s.focusY - 50) * e * 0.7;
      return { zoom: z, focusX: fx, focusY: fy, rot, shakeX: 0, shakeY: 0 };
    },

    // 🌫 Breathe — медленное дыхание (тонкий зум-цикл, для лирики)
    breathe(p, s, bands, t) {
      // Цикл ~6 секунд = 10 «вдохов» в минуту, очень спокойно
      const breathPhase = (Math.sin(t * (Math.PI / 3)) + 1) / 2; // 0..1
      const z = 1 + s.intensity * (0.10 + 0.18 * breathPhase) + bands.bass * 0.04;
      return { zoom: z, focusX: s.focusX, focusY: s.focusY, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // ═══ ПРОДВИНУТЫЕ ═══

    // ⤡ Diagonal Scroll — равномерный диагональный пролёт (drone-shot).
    //   Минимальный зум, акцент на ДВИЖЕНИЕ. Linear easing — равномерная
    //   скорость без замедления в начале/конце.
    //   focusX/Y задаёт направление вектора (длина нормализуется).
    diagScroll(p, s) {
      let dirX = (s.focusX - 50);
      let dirY = (s.focusY - 50);
      // Дефолт когда фокус в центре — диагональ вправо-вниз
      if (Math.abs(dirX) < 8 && Math.abs(dirY) < 8) {
        dirX = 50; dirY = 35;
      }
      // Нормализованный единичный вектор направления
      const len = Math.hypot(dirX, dirY) || 1;
      const ux = dirX / len;
      const uy = dirY / len;
      // ЛИНЕЙНОЕ движение через весь возможный slack:
      // focus идёт от (50 - 50·u) до (50 + 50·u), проходя через (50, 50).
      // Это прокручивает фон от одной грани к другой по выбранной оси.
      const fx = 50 + (p - 0.5) * 100 * ux;
      const fy = 50 + (p - 0.5) * 100 * uy;
      // СКРОМНЫЙ зум — ровно столько, чтобы был slack для пана.
      // Меньше зума → больше акцент на горизонтальное движение.
      const z = 1.18 + s.intensity * 0.22;   // 1.18–1.40 max
      return { zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // 🗺 Tour Three — обход 3 точек вокруг focusX/Y (как осмотр фона).
    //   В каждой точке пауза (40% сегмента), потом плавный переход.
    //   Радиус увеличен — точки заметно разнесены по фону.
    tourThree(p, s) {
      const r = 30 * Math.max(0.5, s.intensity);
      const cx = s.focusX, cy = s.focusY;
      const pts = [
        { x: cx,             y: cy - r * 0.7  },  // верх
        { x: cx + r,         y: cy + r * 0.55 },  // правее ниже
        { x: cx - r * 0.85,  y: cy + r * 0.65 },  // левее ниже
      ];
      const phaseRaw = p * 3;
      const phase = Math.min(2, Math.floor(phaseRaw));
      const next  = (phase + 1) % 3;
      const sub = phaseRaw - phase;
      // 40% hold + 60% transition (более быстрые переходы → видно движение)
      const e = sub < 0.4 ? 0 : sceneEase.inOut((sub - 0.4) / 0.6);
      const fx = pts[phase].x + (pts[next].x - pts[phase].x) * e;
      const fy = pts[phase].y + (pts[next].y - pts[phase].y) * e;
      const z = 1.45 + s.intensity * 0.15;
      return { zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // 🎚 Rack Focus — резкие переключения между двумя дальними точками.
    //   При focusX/Y в центре — переключаемся между left и right (25/75).
    rackFocus(p, s) {
      let pA = { x: 100 - s.focusX, y: 100 - s.focusY };
      let pB = { x: s.focusX,        y: s.focusY };
      // Если focus в центре — дефолтная пара точек
      if (Math.abs(s.focusX - 50) < 8 && Math.abs(s.focusY - 50) < 8) {
        pA = { x: 22, y: 50 };
        pB = { x: 78, y: 50 };
      }
      const phaseRaw = p * 4;
      const phase = Math.floor(phaseRaw) % 2;
      const next  = (phase + 1) % 2;
      const sub = phaseRaw - Math.floor(phaseRaw);
      const e = sub < 0.25 ? sceneEase.out(sub / 0.25) : 1; // быстрый щелчок
      const start = phase === 0 ? pA : pB;
      const end   = next  === 0 ? pA : pB;
      const fx = start.x + (end.x - start.x) * e;
      const fy = start.y + (end.y - start.y) * e;
      const z = 1.55 + s.intensity * 0.20;
      return { zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // ⏎ Push-Pull — наезд в первой половине, отъезд во второй.
    //   При focus в центре — дефолтное смещение в правый верх (для разнообразия).
    pushPull(p, s) {
      const e = p < 0.5 ? sceneEase.inOut(p * 2) : sceneEase.inOut((1 - p) * 2);
      const z = 1 + s.intensity * 0.95 * e;
      let dx = (s.focusX - 50);
      let dy = (s.focusY - 50);
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) { dx = 18; dy = -18; }
      const fx = 50 + dx * e;
      const fy = 50 + dy * e;
      return { zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // 🪶 Float — плавное «парение» (наложенные синусы дают 3D-ощущение).
    float(p, s, bands, t) {
      const fx = 50 + (s.focusX - 50) * 0.5
                  + Math.sin(t * 0.7) * 9 * s.intensity
                  + Math.sin(t * 1.3) * 4 * s.intensity;
      const fy = 50 + (s.focusY - 50) * 0.5
                  + Math.cos(t * 0.9) * 7 * s.intensity
                  + Math.cos(t * 1.5) * 3 * s.intensity;
      const z = 1.20 + Math.sin(t * 0.5) * 0.06 * s.intensity;
      const rot = Math.sin(t * 0.6) * 0.018 * s.intensity;
      return { zoom: z, focusX: fx, focusY: fy, rot, shakeX: 0, shakeY: 0 };
    },

    // 🎥 Handheld — натуральная ручная камера: микро-шейк + дрейф.
    handheld(p, s, bands, t) {
      const sx = (Math.sin(t * 11.3) + Math.cos(t * 7.7) + Math.sin(t * 23) * 0.5) * s.intensity * 5;
      const sy = (Math.cos(t * 13.1) + Math.sin(t * 9.5) + Math.cos(t * 19) * 0.5) * s.intensity * 4;
      const driftX = Math.sin(t * 0.4) * 6 * s.intensity;
      const driftY = Math.cos(t * 0.6) * 5 * s.intensity;
      const z = 1.20 + bands.bass * 0.05;
      const rot = Math.sin(t * 0.8) * 0.014 * s.intensity;
      return {
        zoom: z,
        focusX: 50 + (s.focusX - 50) * 0.5 + driftX,
        focusY: 50 + (s.focusY - 50) * 0.5 + driftY,
        rot, shakeX: sx, shakeY: sy,
      };
    },

    // 🪂 Plunge — стремительное «падение» в точку фокуса.
    plunge(p, s) {
      const e = sceneEase.in(p);
      const z = 1 + s.intensity * 1.4 * e;
      const fx = 50 + (s.focusX - 50) * Math.min(1, p * 1.5);
      const fy = 50 + (s.focusY - 50) * Math.min(1, p * 1.5);
      return { zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // 🎨 Dutch Tilt — «голландский угол»: удерживаемый наклон + лёгкий зум.
    //   Сторона наклона зависит от focusX (<50 = влево, >50 = вправо).
    dutchTilt(p, s) {
      const e = sceneEase.inOut(p);
      const tiltDir = ((s.focusX - 50) / 50) || 0.5;
      const rot = tiltDir * 0.22 * s.intensity * e;
      const z = 1 + s.intensity * 0.32 * e;
      const fx = 50 + (s.focusX - 50) * 0.7 * e;
      const fy = 50 + (s.focusY - 50) * 0.7 * e;
      return { zoom: z, focusX: fx, focusY: fy, rot, shakeX: 0, shakeY: 0 };
    },

    // 🪜 Staircase — пошаговый зум: 4 ступени с микро-щелчком на каждой.
    staircase(p, s, bands, t) {
      const steps = 4;
      const stepProg = p * steps;
      const cur = Math.min(steps, Math.floor(stepProg));
      const stepPhase = stepProg - Math.floor(stepProg);
      const flash = Math.max(0, 1 - stepPhase * 7);
      const z = 1 + (cur / steps) * s.intensity * 0.85 + flash * 0.06 * s.intensity;
      const sx = Math.sin(t * 80) * flash * s.intensity * 6;
      return { zoom: z, focusX: s.focusX, focusY: s.focusY, rot: 0, shakeX: sx, shakeY: 0 };
    },

    // ═══ ЭКСПРЕССИВНЫЕ ═══

    // 🕰 Swing — маятник: мощное качание ротации + лёгкий зум-пульс.
    //   Подходит для куплетов и тревожных моментов.
    swing(p, s, bands, t) {
      const phase = Math.sin(t * 1.3);
      const rot = phase * 0.32 * s.intensity;        // до ~18° в каждую сторону
      const z = 1.20 + Math.abs(phase) * 0.18 * s.intensity + bands.bass * 0.05;
      const fx = 50 + phase * 8 * s.intensity;        // лёгкий swing по X
      const fy = 50 + Math.abs(phase) * 5 * s.intensity;
      return { zoom: z, focusX: fx, focusY: fy, rot, shakeX: 0, shakeY: 0 };
    },

    // ⬇ Drop Down — вертикальный пролёт сверху вниз с микро-отскоком.
    //   Как «падающий заголовок» в anime/vocaloid.
    dropDown(p, s) {
      // Большая часть пути — за первые 60% блока, потом пружинный отскок
      const e = sceneEase.out(Math.min(1, p * 1.7));
      const fy = 8 + (s.focusY - 8) * e;              // с верха к фокусу
      // Лёгкий отскок: после p=0.6 малая обратная амплитуда
      const bounce = p > 0.6 ? Math.sin((p - 0.6) * Math.PI * 4) * (1 - p) * 8 * s.intensity : 0;
      const fx = s.focusX;
      const z = 1.30 + s.intensity * 0.20 * e;
      return { zoom: z, focusX: fx, focusY: fy + bounce, rot: 0, shakeX: 0, shakeY: 0 };
    },

    // 🎁 Reveal — драматичное раскрытие из крупного плана.
    //   Старт ОЧЕНЬ зум-ин на focusX/Y, к концу плавный выход в общий план + лёгкий поворот.
    reveal(p, s) {
      const e = sceneEase.inOut(p);
      const startZoom = 2.0 + s.intensity * 0.6;     // экстремально близко
      const z = startZoom - (startZoom - 1.05) * e;  // к концу — почти full
      const fx = s.focusX + (50 - s.focusX) * e;
      const fy = s.focusY + (50 - s.focusY) * e;
      const rot = -0.06 * (1 - e) * s.intensity;     // микро-наклон в начале, выпрямляется
      return { zoom: z, focusX: fx, focusY: fy, rot, shakeX: 0, shakeY: 0 };
    },

    // 🔮 Prism — встречно-вращающиеся фазы зума и поворота, гипнотический эффект.
    prism(p, s, bands, t) {
      // Зум пульсирует с одной частотой, поворот — с другой, противофаза
      const z = 1.25 + Math.sin(t * 2.1) * 0.18 * s.intensity + bands.bass * 0.06;
      const rot = Math.sin(t * 1.4 + Math.PI / 2) * 0.28 * s.intensity;
      const fx = 50 + Math.cos(t * 1.7) * 14 * s.intensity;
      const fy = 50 + Math.sin(t * 1.1) * 10 * s.intensity;
      return { zoom: z, focusX: fx, focusY: fy, rot, shakeX: 0, shakeY: 0 };
    },

    // ═══ РОКОВЫЕ ═══

    // 🤘 Strobe — белые вспышки на каждый бас-удар + микро-зум-кик. Дискотека.
    strobe(p, s, bands, t) {
      const beat = Math.pow(bands.bass, 1.4) * s.intensity;
      const z = 1.20 + beat * 0.18;
      const sx = (Math.sin(t * 33) + Math.cos(t * 51)) * beat * 6;
      const sy = (Math.cos(t * 37) + Math.sin(t * 47)) * beat * 5;
      return {
        zoom: z, focusX: 50, focusY: 50, rot: 0, shakeX: sx, shakeY: sy,
        flashAlpha: beat * 0.55,         // яркая вспышка на удар
        flashColor: '#ffffff',
        flashBlend: 'lighten',
      };
    },

    // ⬛ Pulse Black — резкое затемнение на бас-удар (театральный black-out).
    pulseBlack(p, s, bands, t) {
      const beat = Math.pow(bands.bass, 1.5) * s.intensity;
      const z = 1.18 + beat * 0.10;
      return {
        zoom: z, focusX: 50, focusY: 50, rot: 0, shakeX: 0, shakeY: 0,
        flashAlpha: beat * 0.65,
        flashColor: '#000000',
        flashBlend: 'source-over',       // прямое затемнение
      };
    },

    // 🤯 Headbang — жёсткий вертикальный пан синхронно с басом, как кивает голова.
    headbang(p, s, bands, t) {
      const beat = Math.pow(bands.bass, 1.3) * s.intensity;
      // Жёсткое наклонение «вниз-вверх» при ударе
      const fy = 50 + beat * 20;       // на удар camera ныряет вниз
      const z = 1.30 + beat * 0.22;
      const rot = beat * 0.06;
      return {
        zoom: z, focusX: 50, focusY: fy, rot, shakeX: 0, shakeY: 0,
        flashAlpha: beat * 0.18,
        flashColor: '#ffffff',
        flashBlend: 'lighten',
      };
    },

    // 🩸 Mosh — хаос: тряска + поворот + красная вспышка на удар. Punk/metal.
    mosh(p, s, bands, t) {
      const beat = Math.pow(bands.bass, 1.2) * s.intensity;
      const k = beat * 1.2;
      const sx = (Math.sin(t * 73) + Math.cos(t * 91)) * (s.intensity * 8 + k * 18);
      const sy = (Math.cos(t * 67) + Math.sin(t * 83)) * (s.intensity * 6 + k * 14);
      const rot = (Math.sin(t * 11) + Math.sin(t * 23) * 0.5) * s.intensity * 0.05 + k * 0.10;
      const z = 1.30 + k * 0.20 + Math.sin(t * 17) * 0.05 * s.intensity;
      return {
        zoom: z, focusX: 50, focusY: 50, rot, shakeX: sx, shakeY: sy,
        flashAlpha: beat * 0.45,
        flashColor: '#ff2030',
        flashBlend: 'lighten',
      };
    },

    // 🎸 Riot — жёсткие случайные cuts: новый кадр каждые ~0.18с, белая вспышка
    //   между. Как клиповая нарезка под рок-припев.
    riot(p, s, bands, t) {
      const slots = 18; // ~4-5 cut/сек на 4-сек блоке
      const slot = Math.floor(p * slots);
      const h1 = ((slot * 9301 + 49297) % 233280) / 233280;
      const h2 = (((slot + 11) * 9301 + 49297) % 233280) / 233280;
      const h3 = (((slot + 21) * 9301 + 49297) % 233280) / 233280;
      const fx = s.focusX + (h1 - 0.5) * 60 * s.intensity;
      const fy = s.focusY + (h2 - 0.5) * 45 * s.intensity;
      const z = 1 + (0.35 + h3 * 0.55) * s.intensity;
      const rot = (h1 - 0.5) * 0.18 * s.intensity;
      // Белая вспышка короткая в начале каждого слота
      const slotPhase = (p * slots) % 1;
      const flash = Math.max(0, 1 - slotPhase * 18);
      return {
        zoom: z, focusX: fx, focusY: fy, rot, shakeX: 0, shakeY: 0,
        flashAlpha: flash * 0.55 * s.intensity,
        flashColor: '#ffffff',
        flashBlend: 'lighten',
      };
    },

    // 🔍 Scan — multi-line: фокус движется по строкам блока (одна строка = одна точка).
    //   Если строк блока 4 — фокус: 20% → 40% → 60% → 80%. С зумом + лёгкой вспышкой.
    scan(p, s, bands, t) {
      // Считаем сколько строк в блоке и какая активна сейчас
      const totalLines = Math.max(1, (s.blockEndLine - s.blockStartLine) + 1);
      const idxInBlock = Math.max(0, (s.currentLineIdx - s.blockStartLine));
      const lineFrac = totalLines > 1 ? idxInBlock / (totalLines - 1) : 0.5;
      // Распределяем фокус-X по горизонтали (15..85)
      const fx = 15 + lineFrac * 70;
      const fy = s.focusY;
      const z = 1.50 + s.intensity * 0.20;
      // Микро-вспышка в момент перехода между строками — flash при p<0.2 в каждой строке
      // Вычисляем «локальный» прогресс этой строки
      const lineDur = 1 / totalLines;
      const localP = (p - idxInBlock * lineDur) / lineDur;
      const flash = localP < 0.15 ? Math.max(0, 1 - localP / 0.15) : 0;
      return {
        zoom: z, focusX: fx, focusY: fy, rot: 0, shakeX: 0, shakeY: 0,
        flashAlpha: flash * 0.30 * s.intensity,
        flashColor: '#ffffff',
        flashBlend: 'lighten',
      };
    },

    // 📺 Flicker — дискретные «кадры» как у плёнки/глитча: 6-7 жёстких щелчков за блок.
    flicker(p, s, bands, t) {
      const slots = 7;
      const slot = Math.min(slots - 1, Math.floor(p * slots));
      // Псевдо-случайные параметры для каждого слота
      const h1 = ((slot * 9301 + 49297) % 233280) / 233280;
      const h2 = (((slot + 13) * 9301 + 49297) % 233280) / 233280;
      const h3 = (((slot + 23) * 9301 + 49297) % 233280) / 233280;
      const fx = s.focusX + (h1 - 0.5) * 50 * s.intensity;
      const fy = s.focusY + (h2 - 0.5) * 35 * s.intensity;
      const z = 1 + (0.30 + h3 * 0.50) * s.intensity;
      const rot = (h1 - 0.5) * 0.12 * s.intensity;
      // Короткая яркая «вспышка зума» в самом начале каждого слота
      const slotPhase = (p * slots) % 1;
      const flash = Math.max(0, 1 - slotPhase * 12);
      return {
        zoom: z + flash * 0.10 * s.intensity,
        focusX: fx, focusY: fy, rot,
        shakeX: 0, shakeY: 0,
      };
    },
  };

  function setLineCamScene(scene, lineStartSec, lineDurSec, meta) {
    if (!scene || !scene.preset || !SCENE_PRESETS[scene.preset]) {
      lineScene.active = false;
      return;
    }
    lineScene.preset        = scene.preset;
    lineScene.intensity     = _csClampNum(scene.intensity, 0, 1, 0.5);
    lineScene.focusX        = _csClampNum(scene.focusX, 0, 100, 50);
    lineScene.focusY        = _csClampNum(scene.focusY, 0, 100, 50);
    lineScene.lineStartTime = lineStartSec || 0;
    lineScene.lineDuration  = Math.max(0.1, lineDurSec || 1);
    // Per-scene появление/исчезновение
    const defFade = _defaultFadesForPreset ? _defaultFadesForPreset(scene.preset) : { fadeIn: 0.4, fadeOut: 0.4, fadeEasing: 'smooth' };
    lineScene.fadeIn     = _csClampNum(scene.fadeIn,  0, 3, defFade.fadeIn);
    lineScene.fadeOut    = _csClampNum(scene.fadeOut, 0, 3, defFade.fadeOut);
    lineScene.fadeEasing = ['smooth','linear','snap'].includes(scene.fadeEasing) ? scene.fadeEasing : defFade.fadeEasing;
    lineScene.active     = true;
    if (meta) {
      lineScene.currentLineIdx = meta.currentLineIdx ?? 0;
      lineScene.blockStartLine = meta.blockStartLine ?? 0;
      lineScene.blockEndLine   = meta.blockEndLine   ?? 0;
    }
  }

  function clearLineCamScene() { lineScene.active = false; }
  function getLineCamScene()   { return { ...lineScene }; }

  // Обновляет lineScene.blend независимо от источника фона (BackgroundManager
  // vs BackgroundEngine). Вызывается каждый кадр из App.js / ExportEngine.
  function tickLineScene(dt) {
    const dtSafe = Math.max(dt || 0, 0.001);
    const target = lineScene.active ? 1 : 0;
    // Скорость blend связана с per-scene fadeIn/fadeOut (а не глобальная).
    // Если fadeIn=1.0 → blend ramping over 1 секунду (а не за 200мс).
    // fadeIn=0 → step огромный = мгновенный snap.
    const fadeTime = target === 1
      ? Math.max(0, lineScene.fadeIn  ?? 0.4)
      : Math.max(0, lineScene.fadeOut ?? 0.4);
    const step = fadeTime > 0.001 ? (dtSafe / fadeTime) : 1;  // snap если 0
    if (lineScene.blend < target) {
      lineScene.blend = Math.min(target, lineScene.blend + step);
    } else if (lineScene.blend > target) {
      lineScene.blend = Math.max(target, lineScene.blend - step);
    }
  }

  // Применение easing-кривой для envelope (0..1 → 0..1)
  function _applyFadeEasing(t01, mode) {
    if (t01 <= 0) return 0;
    if (t01 >= 1) return 1;
    switch (mode) {
      case 'linear': return t01;
      case 'snap':   return t01 >= 0.5 ? 1 : 0;  // мгновенный переход на 50%
      case 'smooth':
      default:       return sceneEase.inOut(t01);
    }
  }

  // Вычисляет текущие значения сцены (для использования внешними рендерами).
  // Per-scene fadeIn/fadeOut/fadeEasing управляют скоростью blend в tickLineScene,
  // а здесь применяем easing-кривую к самому blend для визуальной плавности.
  function evaluateLineScene(bands, t) {
    if (!lineScene.active && lineScene.blend < 0.001) return null;
    const elapsed = (t || 0) - lineScene.lineStartTime;
    const p = Math.max(0, Math.min(1.0001, elapsed / lineScene.lineDuration));
    const fn = SCENE_PRESETS[lineScene.preset] || SCENE_PRESETS.hold;
    const v = fn(p, lineScene, bands || { bass: 0, mid: 0, high: 0 }, t || 0);

    // Easing-кривая применяется к самому blend (линейному ramp'у из tickLineScene)
    const easedBlend = _applyFadeEasing(lineScene.blend, lineScene.fadeEasing || 'smooth');

    return {
      blend:      easedBlend,
      zoom:       v.zoom,
      focusX:     v.focusX,
      focusY:     v.focusY,
      rot:        v.rot    || 0,
      shakeX:     v.shakeX || 0,
      shakeY:     v.shakeY || 0,
      // Flash-overlay параметры (опционально, для рок/strobe сцен) — модулируем easedBlend
      flashAlpha: (v.flashAlpha || 0) * easedBlend,
      flashColor: v.flashColor || '#ffffff',
      flashBlend: v.flashBlend || 'source-over',
    };
  }

  // Рисует полноэкранный flash-overlay (вспышка/затемнение) ПОСЛЕ фона, ДО текста.
  // Цвет/прозрачность/blend-mode задаются пресетом сцены.
  function applySceneFlash(ctx, cw, ch, bands, t) {
    const sv = evaluateLineScene(bands, t);
    if (!sv || !sv.flashAlpha || sv.flashAlpha < 0.005) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, sv.flashAlpha);
    ctx.globalCompositeOperation = sv.flashBlend;
    ctx.fillStyle = sv.flashColor;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  // Применяет сценический transform к ctx как viewport-камеру:
  //   ctx.save() + translate(center+pan) + rotate + scale(zoom) + translate(-center).
  // Вызывается ПЕРЕД рендером фона, после — обязательно ctx.restore().
  // Возвращает true если transform был применён (то есть нужен restore).
  function applySceneTransform(ctx, cw, ch, bands, t) {
    const sv = evaluateLineScene(bands, t);
    if (!sv || sv.blend < 0.001) return false;

    // Лерпим к нейтрали в зависимости от blend
    const blend = sv.blend;
    const zoom  = 1 + (sv.zoom - 1) * blend;
    if (Math.abs(zoom - 1) < 0.001 && Math.abs(sv.rot) < 0.0005 &&
        Math.abs(sv.shakeX) < 0.5 && Math.abs(sv.shakeY) < 0.5 &&
        Math.abs(sv.focusX - 50) < 0.5 && Math.abs(sv.focusY - 50) < 0.5) {
      return false; // нечего делать
    }

    // Focus-pan: при zoom>1 у нас "слабина" на холсте (zoom-1)*cw пикселей.
    // focusX=0 → видна левая часть; focusX=100 → правая.
    // tx = -(focusX-50) * cw/100 * (zoom-1) — сдвигает контент противоположно фокусу.
    const fpx = -(sv.focusX - 50) * cw / 100 * (zoom - 1);
    const fpy = -(sv.focusY - 50) * ch / 100 * (zoom - 1);

    const tx  = (fpx + sv.shakeX) * blend;
    const ty  = (fpy + sv.shakeY) * blend;
    const rot = sv.rot * blend;

    ctx.save();
    ctx.translate(cw / 2 + tx, ch / 2 + ty);
    if (Math.abs(rot) > 0.0005) ctx.rotate(rot);
    ctx.scale(zoom, zoom);
    ctx.translate(-cw / 2, -ch / 2);
    return true;
  }

  // ── Коллекция именованных сцен ──────────────
  // Каждая сцена: { id, name, preset, intensity, focusX, focusY, selectedLines, enabled }
  // Строки взаимоисключаются (одна строка ↔ одна сцена).
  // Персистенция: localStorage. Загружается при старте, сохраняется на каждое
  // изменение коллекции.
  const CAM_SCENES_LS_KEY = 'chromatype_cam_scenes_v1';
  const camScenes = [];

  function _persistCamScenes() {
    try {
      const safe = camScenes.map(s => ({
        id:            s.id,
        name:          s.name,
        preset:        s.preset,
        intensity:     s.intensity,
        focusX:        s.focusX,
        focusY:        s.focusY,
        fadeIn:        s.fadeIn,
        fadeOut:       s.fadeOut,
        fadeEasing:    s.fadeEasing,
        _fadeInTouched:  !!s._fadeInTouched,
        _fadeOutTouched: !!s._fadeOutTouched,
        _fadeEaseTouched:!!s._fadeEaseTouched,
        selectedLines: Array.isArray(s.selectedLines) ? s.selectedLines : [],
        enabled:       s.enabled !== false,
      }));
      localStorage.setItem(CAM_SCENES_LS_KEY, JSON.stringify(safe));
    } catch (e) { /* quota / disabled storage — игнорируем */ }
  }

  function _loadCamScenes() {
    try {
      const raw = localStorage.getItem(CAM_SCENES_LS_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      arr.forEach(s => {
        if (!s || !s.preset || !SCENE_PRESETS[s.preset]) return;
        const defFade = _defaultFadesForPreset(s.preset);
        camScenes.push({
          id:            s.id || `cs_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
          name:          (s.name && String(s.name).trim()) || `Сцена ${camScenes.length + 1}`,
          preset:        s.preset,
          intensity:     _csClampNum(s.intensity, 0, 1, 0.5),
          focusX:        _csClampNum(s.focusX, 0, 100, 50),
          focusY:        _csClampNum(s.focusY, 0, 100, 50),
          fadeIn:        _csClampNum(s.fadeIn,  0, 3, defFade.fadeIn),
          fadeOut:       _csClampNum(s.fadeOut, 0, 3, defFade.fadeOut),
          fadeEasing:    ['smooth','linear','snap'].includes(s.fadeEasing) ? s.fadeEasing : defFade.fadeEasing,
          _fadeInTouched:  !!s._fadeInTouched,
          _fadeOutTouched: !!s._fadeOutTouched,
          _fadeEaseTouched:!!s._fadeEaseTouched,
          selectedLines: Array.isArray(s.selectedLines) ? [...s.selectedLines] : [],
          enabled:       s.enabled !== false,
        });
      });
    } catch (e) { /* битый JSON — игнорируем */ }
  }

  // Загружаем сразу при инициализации модуля
  _loadCamScenes();

  // Дефолтные fadeIn/fadeOut по характеру пресета — резкие пресеты
  // получают мгновенный вход, плавные — длинный.
  function _defaultFadesForPreset(preset) {
    const cfg = {
      // Резкие удары — почти моментальный вход
      punchIn:      { fadeIn: 0.05, fadeOut: 0.35, fadeEasing: 'snap'   },
      crashZoom:    { fadeIn: 0.05, fadeOut: 0.30, fadeEasing: 'snap'   },
      shockwave:    { fadeIn: 0.05, fadeOut: 0.25, fadeEasing: 'snap'   },
      whipPan:      { fadeIn: 0.10, fadeOut: 0.30, fadeEasing: 'linear' },
      plunge:       { fadeIn: 0.15, fadeOut: 0.40, fadeEasing: 'smooth' },
      staircase:    { fadeIn: 0.15, fadeOut: 0.35, fadeEasing: 'snap'   },
      // Хаотичные — быстрый вход
      earthquake:   { fadeIn: 0.10, fadeOut: 0.50, fadeEasing: 'smooth' },
      glitchCut:    { fadeIn: 0.00, fadeOut: 0.00, fadeEasing: 'snap'   },
      flicker:      { fadeIn: 0.05, fadeOut: 0.10, fadeEasing: 'snap'   },
      // Плавные — долгий, дышащий вход
      slowDrift:    { fadeIn: 1.00, fadeOut: 1.00, fadeEasing: 'smooth' },
      breathe:      { fadeIn: 0.90, fadeOut: 0.90, fadeEasing: 'smooth' },
      float:        { fadeIn: 0.70, fadeOut: 0.70, fadeEasing: 'smooth' },
      handheld:     { fadeIn: 0.50, fadeOut: 0.50, fadeEasing: 'smooth' },
      tiltShift:    { fadeIn: 0.80, fadeOut: 0.80, fadeEasing: 'smooth' },
      dutchTilt:    { fadeIn: 0.60, fadeOut: 0.60, fadeEasing: 'smooth' },
      zoomOut:      { fadeIn: 0.60, fadeOut: 0.40, fadeEasing: 'smooth' },
      // Бит-зависимые
      pulse:        { fadeIn: 0.20, fadeOut: 0.40, fadeEasing: 'smooth' },
      heartbeat:    { fadeIn: 0.30, fadeOut: 0.50, fadeEasing: 'smooth' },
      // Хаотичные с поворотом
      spiralIn:     { fadeIn: 0.50, fadeOut: 0.60, fadeEasing: 'smooth' },
      whirl:        { fadeIn: 0.30, fadeOut: 0.50, fadeEasing: 'smooth' },
      vertigo:      { fadeIn: 0.50, fadeOut: 0.50, fadeEasing: 'smooth' },
      orbit:        { fadeIn: 0.40, fadeOut: 0.40, fadeEasing: 'smooth' },
      rollerCoaster:{ fadeIn: 0.30, fadeOut: 0.40, fadeEasing: 'smooth' },
      // Движение по фону
      diagScroll:   { fadeIn: 0.60, fadeOut: 0.60, fadeEasing: 'smooth' },
      tourThree:    { fadeIn: 0.40, fadeOut: 0.40, fadeEasing: 'smooth' },
      rackFocus:    { fadeIn: 0.05, fadeOut: 0.05, fadeEasing: 'snap'   },
      pushPull:     { fadeIn: 0.40, fadeOut: 0.40, fadeEasing: 'smooth' },
      focusPoint:   { fadeIn: 0.30, fadeOut: 0.50, fadeEasing: 'smooth' },
      // Спец
      hold:         { fadeIn: 0.40, fadeOut: 0.40, fadeEasing: 'snap'   },
    };
    return cfg[preset] || { fadeIn: 0.4, fadeOut: 0.4, fadeEasing: 'smooth' };
  }

  function addCamScene(props = {}) {
    const id = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const preset = (props.preset && SCENE_PRESETS[props.preset]) ? props.preset : 'punchIn';
    const defFade = _defaultFadesForPreset(preset);
    const scene = {
      id,
      name:          (props.name && String(props.name).trim()) || `Сцена ${camScenes.length + 1}`,
      preset,
      intensity:     _csClampNum(props.intensity, 0, 1, 0.5),
      focusX:        _csClampNum(props.focusX, 0, 100, 50),
      focusY:        _csClampNum(props.focusY, 0, 100, 50),
      // Появление / исчезновение (секунды)
      fadeIn:        _csClampNum(props.fadeIn,  0, 3, defFade.fadeIn),
      fadeOut:       _csClampNum(props.fadeOut, 0, 3, defFade.fadeOut),
      fadeEasing:    ['smooth','linear','snap'].includes(props.fadeEasing) ? props.fadeEasing : defFade.fadeEasing,
      selectedLines: Array.isArray(props.selectedLines) ? [...props.selectedLines] : [],
      enabled:       props.enabled !== false,
    };
    camScenes.push(scene);
    _persistCamScenes();
    return scene;
  }

  function updateCamScene(id, props = {}) {
    const s = camScenes.find(x => x.id === id);
    if (!s) return null;
    if (props.selectedLines !== undefined) {
      const newLines = Array.isArray(props.selectedLines) ? [...new Set(props.selectedLines)] : [];
      newLines.sort((a, b) => a - b);
      camScenes.forEach(other => {
        if (other.id !== id) {
          other.selectedLines = (other.selectedLines || []).filter(idx => !newLines.includes(idx));
        }
      });
      props = { ...props, selectedLines: newLines };
    }
    // Смена пресета: если пользователь не задавал fade явно, обновляем по характеру нового пресета
    if (props.preset !== undefined && SCENE_PRESETS[props.preset] && props.preset !== s.preset) {
      const defFade = _defaultFadesForPreset(props.preset);
      if (props.fadeIn  === undefined && !s._fadeInTouched)  props.fadeIn  = defFade.fadeIn;
      if (props.fadeOut === undefined && !s._fadeOutTouched) props.fadeOut = defFade.fadeOut;
      if (props.fadeEasing === undefined && !s._fadeEaseTouched) props.fadeEasing = defFade.fadeEasing;
    }
    if (props.preset !== undefined && !SCENE_PRESETS[props.preset]) delete props.preset;
    if (props.intensity !== undefined) props.intensity = _csClampNum(props.intensity, 0, 1, s.intensity);
    if (props.focusX    !== undefined) props.focusX    = _csClampNum(props.focusX,    0, 100, s.focusX);
    if (props.focusY    !== undefined) props.focusY    = _csClampNum(props.focusY,    0, 100, s.focusY);
    if (props.fadeIn    !== undefined) { props.fadeIn  = _csClampNum(props.fadeIn,  0, 3, s.fadeIn  ?? 0.4); s._fadeInTouched  = true; }
    if (props.fadeOut   !== undefined) { props.fadeOut = _csClampNum(props.fadeOut, 0, 3, s.fadeOut ?? 0.4); s._fadeOutTouched = true; }
    if (props.fadeEasing !== undefined) {
      if (!['smooth','linear','snap'].includes(props.fadeEasing)) delete props.fadeEasing;
      else s._fadeEaseTouched = true;
    }
    Object.assign(s, props);
    _persistCamScenes();
    return s;
  }

  function removeCamScene(id) {
    const i = camScenes.findIndex(s => s.id === id);
    if (i >= 0) {
      camScenes.splice(i, 1);
      _persistCamScenes();
    }
  }

  // Сбросить fadeIn/fadeOut/fadeEasing сцены к дефолтам её пресета
  function resetSceneFadesToDefaults(id) {
    const s = camScenes.find(x => x.id === id);
    if (!s) return null;
    const defFade = _defaultFadesForPreset(s.preset);
    s.fadeIn  = defFade.fadeIn;
    s.fadeOut = defFade.fadeOut;
    s.fadeEasing = defFade.fadeEasing;
    delete s._fadeInTouched;
    delete s._fadeOutTouched;
    delete s._fadeEaseTouched;
    _persistCamScenes();
    return s;
  }

  function findCamSceneForLine(lineIdx) {
    if (lineIdx == null || lineIdx < 0) return null;
    return camScenes.find(s => s.enabled && (s.selectedLines || []).includes(lineIdx)) || null;
  }

  // ═══════════════════════════════════════════════
  // Text-driven camera override
  // ═══════════════════════════════════════════════
  // Анимации текста (например montage) могут управлять зумом/паном фона.
  // Это создаёт эффект "виртуальной камеры", которая двигается вместе с текстом:
  //   - zoomMul: множитель к общему zoom (1.0 = без изменений; 2.0 = x2 zoom)
  //   - panX/panY: доп. смещение фона в пикселях (добавляется к kbPan)
  //
  // Значение сбрасывается каждый кадр — животворящей силой является сам вызов
  // setTextDrivenCamera() из render-loop. Если никто не вызывает — камера
  // возвращается к default (zoom × 1.0, pan = 0, без дёргания)
  // через плавный decay в начале drawMedia().
  const textCam = {
    zoomMul: 1.0,
    panX:    0,
    panY:    0,
    // Плавный decay к нейтралу: если overrider перестал слать, камера
    // плавно возвращается к 1.0/0/0, а не дёргается.
    _decay:  0,
  };

  function setTextDrivenCamera({ zoomMul = 1, panX = 0, panY = 0 } = {}) {
    textCam.zoomMul = zoomMul;
    textCam.panX    = panX;
    textCam.panY    = panY;
    textCam._decay  = 1;     // сигнал "свежий"
  }

  function clearTextDrivenCamera() {
    textCam.zoomMul = 1;
    textCam.panX    = 0;
    textCam.panY    = 0;
    textCam._decay  = 0;
  }

  // ── Плавные переходы для эффектов ────────────
  const bgTransitions = {
    darkenAmount:   0,    // 0 = нет затемнения, 1 = полное затемнение
    brightenAmount: 0,    // 0 = нет осветления, 1 = полное осветление
    blurAmount:     0,    // 0 = нет блюра, 1 = полный блюр
    letterboxAmount: 0,   // 0 = нет полос, 1 = полные полосы
  };
  const TRANSITION_SPEED = 1.5; // скорость перехода (единиц в секунду)

  // ── Плавные переходы для камеры ──────────────
  const camTransitions = {
    musicZoomAmount: 0,   // 0 = зум выключен, 1 = зум активен (НЕ используется напрямую, управляется через spring)
    scrollXAmount:   0,   // 0 = прокрутка X выключена, 1 = активна
    scrollYAmount:   0,   // 0 = прокрутка Y выключена, 1 = активна
  };
  const CAM_TRANSITION_SPEED = 1.5; // скорость перехода камеры для scroll (быстро включается, плавно работает)

  // ── Per-line background ──────────────────────
  // Реестр: key → { img, url, name }
  const bgImageRegistry = new Map();
  let lineMedia       = null;   // текущее per-line изображение
  let lineFadeAlpha   = 0;      // текущая прозрачность (0=прозрачно, 1=непрозрачно)
  let lineFadeTarget  = 0;      // цель
  const LINE_FADE_SPD = 3.0;    // альфа в секунду

  // Регистрация изображения для per-line bg (вызывается из FxEditor)
  function registerBgImage(key, file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload  = () => { bgImageRegistry.set(key, { img, url, name: file.name }); resolve(key); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Переключить per-line фон (вызывается из App.js при смене строки)
  function setLineBackground(key) {
    if (!key) { lineFadeTarget = 0; return; }
    const entry = bgImageRegistry.get(key);
    if (entry) {
      // Если это другое изображение — мгновенно меняем и фейдим
      if (lineMedia !== entry.img) {
        lineMedia     = entry.img;
        lineFadeAlpha = 0;      // сброс чтобы плавно проявить новое
      }
      lineFadeTarget = 1;
    } else {
      // Ключ есть, но изображение не загружено в реестр (новая сессия)
      lineFadeTarget = 0;
    }
  }

  function clearLineBackground() { lineFadeTarget = 0; }

  function getBgImageUrl(key)  { return bgImageRegistry.get(key)?.url  || null; }
  function getBgImageName(key) { return bgImageRegistry.get(key)?.name || null; }

  // ── Overlay objects ──────────────────────────
  // Массив объектов-картинок: каждый рисуется ниже или выше текста
  // с аудио-реактивными эффектами и настраиваемым таймлайном.
  const overlays = [];

  // ── Callback-хук: вызывается после любого изменения overlays ──
  // PresetManager подключается сюда, чтобы дёргать scheduleAutosave.
  let _overlayChangeCb = null;
  function setOverlayChangeCallback(cb) { _overlayChangeCb = cb; }
  function _notifyOverlayChange() {
    if (typeof _overlayChangeCb === 'function') {
      try { _overlayChangeCb(); } catch(e) {}
    }
  }

  // Заменяет картинку у существующего image-overlay (по id) на новую из файла
  async function replaceOverlayImage(id, file) {
    return new Promise((resolve, reject) => {
      const ov = overlays.find(o => o.id === id);
      if (!ov || ov.type !== 'image') { reject(new Error('overlay not found or not image')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // Освобождаем старый objectURL — но только если он не shared с другим overlay
        if (ov.url) {
          const sharedByOther = overlays.some(o => o !== ov && o.url === ov.url);
          if (!sharedByOther) { try { URL.revokeObjectURL(ov.url); } catch (e) {} }
        }
        ov.img  = img;
        ov.url  = url;
        ov.name = file.name;
        _notifyOverlayChange();
        resolve(ov);
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // Дублирует overlay по id. Поддерживает все типы: image / text / frame / effect / card.
  // Для image — Image и URL разделяются с оригиналом (replaceOverlayImage учитывает refs).
  // Для card — клонирует все блоки и регидрирует image-блоки из imgData.
  async function duplicateOverlay(id) {
    const src = overlays.find(o => o.id === id);
    if (!src) return null;

    // JSON-клон (отсекает HTMLImageElement и другие non-serializable поля)
    const clone = JSON.parse(JSON.stringify(src, (k, v) => {
      if (v instanceof HTMLImageElement) return undefined;
      return v;
    }));

    // Новый id + новое имя
    clone.id = `ov_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    if (clone.name && !/\(копия/.test(clone.name)) clone.name = `${clone.name} (копия)`;
    // Сброс fade чтобы дубликат плавно появился
    clone.fadeAlpha  = 0;
    clone.fadeTarget = 1;

    // Тип-специфическая дорабока
    if (clone.type === 'image' && src.url) {
      // Делим тот же blob URL — оба Image-объекта тянут из одного источника
      clone.url = src.url;
      clone.img = new Image();
      clone.img.src = src.url;
    }

    if (clone.type === 'card' && Array.isArray(clone.blocks)) {
      const ts = Date.now();
      clone.blocks = clone.blocks.map((b, i) => ({
        ...b,
        id: `blk_${ts}_${i}_${Math.random().toString(36).slice(2, 4)}`,
      }));
      // Регидрируем image-блоки (imgData base64 → HTMLImageElement)
      for (const blk of clone.blocks) {
        if (blk.kind === 'image' && blk.imgData) {
          try { blk.img = await _loadImageFromDataUrl(blk.imgData); }
          catch (e) { console.warn('[duplicateOverlay] block image load failed', e); }
        }
      }
    }

    // Вставляем сразу ПОСЛЕ оригинала, чтобы пара была рядом в списке
    const srcIdx = overlays.indexOf(src);
    overlays.splice(srcIdx + 1, 0, clone);
    _notifyOverlayChange();
    return clone;
  }

  async function registerOverlay(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const id = `ov_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        const ov = {
          id, img, url,
          type:      'image',    // 'image' | 'text' — тип оверлея
          name:      file.name,
          layer:     'above',    // 'above' | 'below' — слой относительно текста
          scope:     'global',   // 'global' | 'timeline' — всегда или диапазон строк
          startLine: 0,
          endLine:   999,
          selectedLines: [],     // массив индексов выбранных строк (для scope='timeline')
          positionMode: 'center', // 'center' | 'top' | 'bottom' | 'left' | 'right' | 'custom' и т.д.
          x:         50,         // % ширины холста (центр объекта)
          y:         50,         // % высоты холста
          width:     25,         // % ширины холста
          effect:    'static',   // static|sway|pulse|stretch|float|shake|bounce|spin
          effectAmt: 0.5,        // 0–1 сила эффекта
          audioReactive: true,   // если false — движение не модулируется басом (плавный скролл/sway/drift)
          opacity:   1.0,
          enabled:   true,
          // Fade система: всегда начинаем с 0 — fade-in проиграет плавно
          fadeAlpha: 0,
          fadeTarget: 1,
          fadeSpeed: 2.5,        // скорость fade (единиц в секунду)
          // Обводка и тень для image overlay
          strokeEnabled: false,
          strokeColor:   '#ffffff',
          strokeWidth:   2,
          shadowEnabled: false,
          shadowColor:   '#000000',
          shadowBlur:    10,
        };
        overlays.push(ov);
        _notifyOverlayChange();
        resolve(ov);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Регистрирует текстовый оверлей с теми же полями, что и image-overlay
  // (layer, scope, selectedLines, x/y, effect, и т.д.) + свои text-поля.
  function registerTextOverlay(initialText) {
    const id   = `ov_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const text = (initialText && String(initialText)) || 'TEXT';
    const ov = {
      id,
      type:         'text',
      name:         text.slice(0, 24),
      // ── Text-специфичные поля ───────────────
      text:         text,
      font:         "'Bebas Neue', cursive",
      fontSize:     96,            // в пикселях при высоте canvas 1080 (масштабируется)
      color:        '#ffffff',
      bold:         true,
      italic:       false,
      boxStyle:     '',            // ID рамки из BoxRegistry, '' = без рамки
      strokeEnabled: false,
      strokeColor:  '#ffffff',
      strokeWidth:  2,             // px при 1080
      shadowEnabled: false,
      shadowColor:  '#000000',
      shadowBlur:   10,            // px при 1080
      // ── Общие поля (как у image-overlay) ────
      layer:        'above',
      scope:        'global',
      startLine:    0,
      endLine:      999,
      selectedLines: [],
      positionMode: 'center',
      x:            50,
      y:            50,
      width:        25,            // не используется для текста, но сохраняем для совместимости
      effect:       'static',
      effectAmt:    0.5,
      audioReactive: true,         // см. registerOverlay
      opacity:      1.0,
      enabled:      true,
      fadeAlpha:    0,
      fadeTarget:   1,
      fadeSpeed:    2.5,           // скорость fade (единиц в секунду)
    };
    overlays.push(ov);
    _notifyOverlayChange();
    return ov;
  }

  function updateOverlay(id, props) {
    const ov = overlays.find(o => o.id === id);
    if (!ov) return;
    const oldLayer = ov.layer || 'above';
    Object.assign(ov, props);
    const newLayer = ov.layer || 'above';
    // При смене layer перемещаем объект в начало новой группы (z=1),
    // иначе он оказывается на случайной позиции внутри группы.
    if (props.layer && props.layer !== oldLayer) {
      const srcIdx = overlays.indexOf(ov);
      const firstInNewGroup = overlays.findIndex(o => o !== ov && (o.layer || 'above') === newLayer);
      if (firstInNewGroup >= 0 && firstInNewGroup !== srcIdx) {
        overlays.splice(srcIdx, 1);
        const dst = firstInNewGroup > srcIdx ? firstInNewGroup - 1 : firstInNewGroup;
        overlays.splice(dst, 0, ov);
      }
    }
    _notifyOverlayChange();
  }

  function removeOverlay(id) {
    const idx = overlays.findIndex(o => o.id === id);
    if (idx >= 0) {
      if (overlays[idx].url) URL.revokeObjectURL(overlays[idx].url);
      overlays.splice(idx, 1);
      _notifyOverlayChange();
    }
  }

  // ── Z-order: перемещение объекта в едином стеке ──
  // Все объекты — единая иерархия. ВЫШЕ/НИЖЕ ТЕКСТА влияет только на то,
  // в каком рендер-проходе объект оказывается относительно текста.
  // Перемещение свободное по всему массиву, без ограничений по layer-группе.
  //
  // delta: +1 — на 1 позицию выше в стеке (ближе к зрителю)
  //        -1 — на 1 позицию ниже (ближе к фону)
  // mode:  'front' — на самый верх стека
  //        'back'  — в самый низ стека
  function moveOverlay(id, delta, mode = null) {
    const item = overlays.find(o => o.id === id);
    if (!item) return false;

    const srcIdx = overlays.indexOf(item);
    let dstIdx;
    if (mode === 'front')     dstIdx = overlays.length - 1;
    else if (mode === 'back') dstIdx = 0;
    else                      dstIdx = srcIdx + (delta | 0);
    dstIdx = Math.max(0, Math.min(overlays.length - 1, dstIdx));
    if (dstIdx === srcIdx) return false;

    overlays.splice(srcIdx, 1);
    // После splice индексы элементов, стоявших ПОСЛЕ srcIdx, уменьшились на 1
    const adjustedDst = dstIdx > srcIdx ? dstIdx - 1 : dstIdx;
    overlays.splice(adjustedDst, 0, item);
    _notifyOverlayChange();
    return true;
  }

  // ── Регистрация КОМПОЗИЦИИ (card) — фрейм + форматированные тексты ──
  // Card = bbox (x%, y%, width%, aspectRatio) + frame style + список текст-блоков.
  // Каждый блок имеет position в % от card-bbox, свой шрифт/размер/цвет/выравнивание.
  function registerCardOverlay() {
    const id = `ov_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const ov = {
      id,
      type:          'card',
      name:          'Композиция',
      // ── Card-специфичные поля ─────────────────
      // bbox композиции на холсте (% от cw/ch)
      cardW:         60,        // ширина карточки (% от ширины холста)
      cardAspect:    0.5625,    // высота = cardW% × cardAspect (16:9 = 0.5625)
      cardRotation:  0,         // статич. поворот карточки в градусах
      // Параметры рамки (используются FrameDrawEngine'ом внутри карточки)
      frameStyle:    'titlecard',
      frameColor:    '#ffffff',
      frameThickness: 3,
      frameDetail:   6,
      framePad:      0,
      frameRotation: 0,
      frameAnimMode: 'none',
      frameAnimAmt:  0.5,
      frameAnimSpeed: 1.0,
      // Текстовые блоки внутри карточки
      blocks: [
        {
          id:           `blk_${Date.now()}_a`,
          text:         'CHAPTER',
          font:         "'Bebas Neue', cursive",
          // Размер в % от ВЫСОТЫ карточки (5 = 5% высоты карточки)
          sizePct:      14,
          color:        '#ffffff',
          bold:         true,
          italic:       false,
          letterSpacing: 6,
          // Позиция в % от bbox карточки (0..100)
          x:            50,
          y:            34,
          // Выравнивание: 'left' | 'center' | 'right'
          align:        'center',
          maxWidthPct:  90,    // макс. ширина (% от cardW), wrap при превышении
          // Тень
          shadow:       false,
          shadowColor:  '#000000',
          shadowBlur:   8,
        },
        {
          id:           `blk_${Date.now()}_b`,
          text:         'Чистая композиция',
          font:         "'Space Mono', monospace",
          sizePct:      6,
          color:        '#cccccc',
          bold:         false,
          italic:       false,
          letterSpacing: 1,
          x:            50,
          y:            58,
          align:        'center',
          maxWidthPct:  85,
          shadow:       false,
          shadowColor:  '#000000',
          shadowBlur:   6,
        },
      ],
      // ── Общие поля overlay ────────────────────
      layer:        'above',
      scope:        'global',
      startLine:    0,
      endLine:      999,
      selectedLines: [],
      positionMode: 'center',
      x:            50,        // позиция центра карточки (% холста)
      y:            50,
      width:        25,        // legacy, не используется
      effect:       'static',
      effectAmt:    0.5,
      audioReactive: true,
      opacity:      1.0,
      enabled:      true,
      fadeAlpha:    0,
      fadeTarget:   1,
      fadeSpeed:    2.5,
    };
    overlays.push(ov);
    _notifyOverlayChange();
    return ov;
  }

  // ── Загрузка картинки в image-блок карточки ──
  // file → data URL (для сохранения в пресет) + Image (для рендера).
  function _fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function _loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
  async function setCardBlockImage(cardId, blockId, file) {
    const card = overlays.find(o => o.id === cardId);
    if (!card || card.type !== 'card') return null;
    const blocks = Array.isArray(card.blocks) ? card.blocks : [];
    const blk = blocks.find(b => b.id === blockId);
    if (!blk || blk.kind !== 'image') return null;
    try {
      const dataUrl = await _fileToDataUrl(file);
      blk.imgData = dataUrl;
      blk.img = await _loadImageFromDataUrl(dataUrl);
      _notifyOverlayChange();
      return blk;
    } catch (e) {
      console.warn('[setCardBlockImage] failed', e);
      return null;
    }
  }

  // Восстанавливает image-блоки после загрузки пресета — конвертирует
  // imgData (base64) обратно в HTMLImageElement.
  async function rehydrateCardImageBlocks() {
    const cards = overlays.filter(o => o.type === 'card');
    for (const card of cards) {
      const blocks = Array.isArray(card.blocks) ? card.blocks : [];
      for (const blk of blocks) {
        if (blk.kind === 'image' && blk.imgData && !blk.img) {
          try {
            blk.img = await _loadImageFromDataUrl(blk.imgData);
          } catch (e) {
            console.warn('[rehydrateCardImageBlocks] image load failed', e);
          }
        }
      }
    }
    _notifyOverlayChange();
  }

  // ── Регистрация рамки как overlay-объекта ──
  function registerFrameOverlay() {
    const id = `ov_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const ov = {
      id,
      type:          'frame',
      name:          'Рамка',
      // ── Frame-специфичные поля ────────────────
      frameStyle:    'apex',      // ключ из FrameDrawEngine
      frameColor:    '#d4a84b',
      frameThickness: 3,          // 1–10
      frameDetail:   6,           // 1–12
      framePad:      0,           // % отступа от краёв (0–25)
      frameRotation: 0,           // статич. поворот, градусы (-180..+180)
      // Анимация рамки: anim-режим поверх обычного effect
      frameAnimMode:  'none',     // none|pulse|breathe|glitch|rainbow|sparkle|swing|rotate|flicker|chromatic|march
      frameAnimAmt:   0.5,        // 0..1 — амплитуда
      frameAnimSpeed: 1.0,        // 0.1..3 — множитель скорости анимации
      // ── Общие поля overlay ────────────────────
      layer:        'below',
      scope:        'global',
      startLine:    0,
      endLine:      999,
      selectedLines: [],
      positionMode: 'fill',       // 'fill' = весь холст (default для рамок)
      x:            50,
      y:            50,
      width:        95,           // % ширины холста
      effect:       'static',
      effectAmt:    0.5,
      audioReactive: true,        // см. registerOverlay
      opacity:      1.0,
      enabled:      true,
      fadeAlpha:    0,
      fadeTarget:   1,
      fadeSpeed:    2.5,
    };
    overlays.push(ov);
    _notifyOverlayChange();
    return ov;
  }

  // ══════════════════════════════════════════════
  //  Effect overlays — процедурные полноэкранные эффекты
  // ══════════════════════════════════════════════
  // Список доступных типов эффектов для добавления через FxEditor.
  // Каждый эффект может использовать ov.intensity (0..1) и ov.fxColor
  // (а также bands.*, t для аудио-реактивности).
  const EFFECT_TYPES = [
    { id:'rain',       name:'🌧 Дождь',          color:'#88aaff' },
    { id:'snow',       name:'❄ Снег',            color:'#ffffff' },
    { id:'vignette',   name:'⊙ Виньетка',        color:'#000000' },
    { id:'scanlines',  name:'═ Сканлайны (CRT)', color:'#000000' },
    { id:'noise',      name:'▒ Шум / зерно',     color:'#888888' },
    { id:'flash',      name:'⚡ Бас-вспышка',    color:'#ffffff' },
    { id:'lightleak',  name:'☀ Засветка',         color:'#ff8844' },
    { id:'particles',  name:'✦ Частицы (бас)',   color:'#e8ff00' },
    { id:'chromatic',  name:'⌬ Хром. аберрация', color:'#ff00ff' },
    { id:'vhsLines',   name:'📺 VHS полосы',     color:'#ffffff' },
    { id:'colorTint',  name:'🎨 Цветной фильтр', color:'#ff5588' },
    { id:'pulseRings', name:'🎯 Кольца на бас',  color:'#00e5ff' },
    { id:'lightning',  name:'⚡ Молнии',          color:'#ddeeff' },
    { id:'confetti',   name:'🎆 Конфетти',       color:'#ffffff' },
    { id:'fireflies',  name:'🪲 Светлячки',      color:'#fff4a3' },
    { id:'aurora',     name:'🌌 Северное сияние', color:'#5fffc8' },
    { id:'waveGrid',   name:'🛣 Синтвейв-сетка',  color:'#ff3eb5' },
    { id:'starWarp',   name:'🚀 Гиперпрыжок',     color:'#ffffff' },
    { id:'tunnel',     name:'🌀 Тоннель',          color:'#ff66cc' },
    { id:'plasma',     name:'🌈 Плазма',           color:'#ff3aa8' },
    // ── Градиенты и свет (плавные, не дёрганные) ──
    { id:'gradGlow',     name:'💫 Градиент сияние',  color:'#ff66cc' },
    { id:'gradStripe',   name:'▤ Градиент полоса',   color:'#00e5ff' },
    { id:'gradCorner',   name:'◤ Градиент угол',     color:'#ff8844' },
    { id:'spotlight',    name:'🔦 Прожектор',         color:'#fff6c0' },
    { id:'godRays',      name:'🌅 Лучи света',        color:'#ffe8b0' },
    { id:'lensFlare',    name:'✨ Линзовый блик',    color:'#fff0a0' },
    { id:'softBloom',    name:'☁ Мягкое свечение',   color:'#ffffff' },
    // ── Звукореактивные плавные ──
    { id:'bassAura',     name:'🌊 Бас-аура',          color:'#ff3aa8' },
    { id:'waveform',     name:'〰 Звук-волна',        color:'#00e5ff' },
    { id:'spectrumBars', name:'▮ Эквалайзер',         color:'#e8ff00' },
    { id:'pulseSphere',  name:'⚪ Дышащая сфера',     color:'#a29bfe' },
  ];

  function _initEffectState(effectType) {
    if (effectType === 'rain') {
      const drops = [];
      for (let i = 0; i < 240; i++) {
        drops.push({ x:Math.random(), y:Math.random(), len:0.02+Math.random()*0.04, sp:0.6+Math.random()*0.8 });
      }
      return { drops };
    }
    if (effectType === 'snow') {
      const flakes = [];
      for (let i = 0; i < 160; i++) {
        flakes.push({ x:Math.random(), y:Math.random(), r:1+Math.random()*3, sp:0.05+Math.random()*0.12, ph:Math.random()*Math.PI*2 });
      }
      return { flakes };
    }
    if (effectType === 'particles') {
      const parts = [];
      for (let i = 0; i < 80; i++) {
        parts.push({ x:Math.random(), y:Math.random(), vx:(Math.random()-0.5)*0.05, vy:(Math.random()-0.5)*0.05, r:1+Math.random()*3 });
      }
      return { parts };
    }
    if (effectType === 'confetti') {
      const pieces = [];
      for (let i = 0; i < 120; i++) {
        pieces.push({
          x: Math.random(),
          y: Math.random() * 1.5 - 0.5,         // лесенкой над/в кадре
          size: 4 + Math.random() * 10,
          aspect: 0.4 + Math.random() * 0.5,    // прямоугольник, не квадрат
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 4,
          vy: 0.08 + Math.random() * 0.20,
          sway: Math.random() * Math.PI * 2,
          hue: (i * 37) % 360,
        });
      }
      return { pieces };
    }
    if (effectType === 'fireflies') {
      const flies = [];
      for (let i = 0; i < 70; i++) {
        flies.push({
          x: Math.random(), y: Math.random(),
          vx: (Math.random()-0.5)*0.015, vy: (Math.random()-0.5)*0.015,
          r: 1.2 + Math.random()*2.4,
          ph: Math.random()*Math.PI*2,
          sp: 0.8 + Math.random()*1.6,
        });
      }
      return { flies };
    }
    if (effectType === 'aurora') {
      const ribbons = [];
      for (let i = 0; i < 4; i++) {
        ribbons.push({
          ph:     Math.random() * Math.PI * 2,
          sp:     0.18 + Math.random() * 0.22,
          amp:    0.06 + Math.random() * 0.06,
          yBase:  0.08 + i * 0.13,
          height: 0.28 + Math.random() * 0.12,
          hueOff: i * 26 - 32,
          freq:   1.8 + Math.random() * 1.6,
        });
      }
      return { ribbons };
    }
    if (effectType === 'waveGrid') return { gridPhase: 0, bassEnv: 0 };
    if (effectType === 'starWarp') {
      const stars = [];
      for (let i = 0; i < 220; i++) {
        const a = Math.random() * Math.PI * 2;
        stars.push({
          ang:  a,
          dist: Math.random(),         // 0 = центр, 1 = край
          sp:   0.25 + Math.random()*0.6,
          size: 0.7 + Math.random()*1.4,
        });
      }
      return { stars, bassEnv: 0 };
    }
    if (effectType === 'tunnel') return { phase: 0, bassEnv: 0, rotPh: 0 };
    if (effectType === 'plasma') {
      const blobs = [];
      for (let i = 0; i < 6; i++) {
        blobs.push({
          ph:  Math.random() * Math.PI * 2,
          sp:  0.18 + Math.random() * 0.30,
          ax:  0.25 + Math.random() * 0.20,
          ay:  0.20 + Math.random() * 0.20,
          fx:  0.6  + Math.random() * 0.7,
          fy:  0.5  + Math.random() * 0.8,
          hue: i * 60, // равномерный разброс по кругу
        });
      }
      return { phase: 0, blobs, bassEnv: 0 };
    }
    if (effectType === 'pulseRings') return { rings: [], lastBass: 0, lastTimedRing: 0 };
    if (effectType === 'lightning')  return { bolts: [], lastBass: 0 };
    if (effectType === 'flash')      return { flashEnv: 0, cooldown: 0 };
    // ── Плавные градиенты и свет ──
    if (effectType === 'gradGlow')     return { bassEnv: 0, breathe: 0 };
    if (effectType === 'gradStripe')   return { bassEnv: 0, phase: 0 };
    if (effectType === 'gradCorner')   return { bassEnv: 0 };
    if (effectType === 'spotlight')    return { phase: 0, bassEnv: 0 };
    if (effectType === 'godRays')      return { phase: 0, bassEnv: 0 };
    if (effectType === 'lensFlare')    return { bassEnv: 0 };
    if (effectType === 'softBloom')    return { bassEnv: 0 };
    if (effectType === 'bassAura')     return { bassEnv: 0 };
    if (effectType === 'waveform')     return { phase: 0, bassEnv: 0, midEnv: 0, highEnv: 0 };
    if (effectType === 'spectrumBars') return { bars: new Array(32).fill(0) };
    if (effectType === 'pulseSphere')  return { bassEnv: 0, breathe: 0 };
    return {};
  }

  // Регистрирует эффект как overlay-объект (тип 'effect')
  function registerEffectOverlay(effectType = 'rain') {
    const def = EFFECT_TYPES.find(d => d.id === effectType) || EFFECT_TYPES[0];
    const id = `ov_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const ov = {
      id,
      type:          'effect',
      name:          def.name,
      // ── Effect-специфичные поля ───────────────
      effectType:    def.id,
      intensity:     0.5,
      fxColor:       def.color,
      _fxState:      _initEffectState(def.id),
      // ── Общие поля overlay (для совместимости с системой overlays) ──
      layer:         'above',
      scope:         'global',
      startLine:     0,
      endLine:       999,
      selectedLines: [],
      positionMode:  'fill',     // эффекты полноэкранные
      x:             50,
      y:             50,
      width:         100,
      effect:        'static',
      effectAmt:     0.5,
      opacity:       1.0,
      enabled:       true,
      fadeAlpha:     0,
      fadeTarget:    1,
      fadeSpeed:     2.5,
    };
    overlays.push(ov);
    _notifyOverlayChange();
    return ov;
  }

  // ── Утилиты для эффектов ─────────────────────
  function _hexToRgb(hex) {
    let h = (hex || '#ffffff').replace('#','');
    if (h.length === 3) h = h.split('').map(c => c+c).join('');
    const n = parseInt(h, 16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  }

  // Кэш для шума — общий на все эффекты типа 'noise'
  let _fxNoiseCanvas = null, _fxNoiseCtx = null, _fxNoiseLastT = 0;

  function _drawEffectByType(ctx, ov, cw, ch, bands, t, dt) {
    const intensity = Math.max(0, Math.min(1, ov.intensity != null ? ov.intensity : 0.5));
    // ── Детектор скачка времени (рестарт / перемотка) ──
    // Эффекты с коллекциями вида { born: t } застревают, если t уехал.
    // Сбрасываем зависящие от t поля, фазы (которые только нарастают) не трогаем.
    {
      const _st = ov._fxState;
      if (_st) {
        if (_st._lastT == null) _st._lastT = t;
        const jumped = (t < _st._lastT - 0.25) || (t > _st._lastT + 1.5);
        if (jumped) {
          if (Array.isArray(_st.rings)) _st.rings.length = 0;
          if (Array.isArray(_st.bolts)) _st.bolts.length = 0;
          _st.lastTimedRing = t;
          _st.lastBass      = 0;
          _st.flashEnv      = 0;
          _st.cooldown      = 0;
          _st.bassEnv       = 0;
        }
        _st._lastT = t;
      }
    }
    const color = ov.fxColor || '#ffffff';
    const st    = ov._fxState || (ov._fxState = _initEffectState(ov.effectType));
    const c     = _hexToRgb(color);
    const dts   = Math.min(Math.max(dt || 0.016, 0.001), 0.05);

    switch (ov.effectType) {
      case 'rain': {
        ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${0.35 + intensity*0.4})`;
        ctx.lineWidth = 1 + intensity*1.5;
        const count = Math.floor(60 + intensity*240);
        for (let i = 0; i < count && i < st.drops.length; i++) {
          const d = st.drops[i];
          d.y += d.sp * dts * (0.6 + intensity);
          if (d.y > 1) { d.y = -d.len; d.x = Math.random(); }
          const x = d.x * cw, y = d.y * ch;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 4*intensity, y + d.len*ch);
          ctx.stroke();
        }
        break;
      }
      case 'snow': {
        const count = Math.floor(40 + intensity*120);
        for (let i = 0; i < count && i < st.flakes.length; i++) {
          const f = st.flakes[i];
          f.y += f.sp * dts * (0.5 + intensity*1.2);
          f.x += Math.sin(t*0.6 + f.ph) * 0.0006;
          if (f.y > 1) { f.y = -0.05; f.x = Math.random(); }
          if (f.x > 1) f.x -= 1; if (f.x < 0) f.x += 1;
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.55 + intensity*0.35})`;
          ctx.beginPath();
          ctx.arc(f.x*cw, f.y*ch, f.r*(0.7 + intensity*0.8), 0, Math.PI*2);
          ctx.fill();
        }
        break;
      }
      case 'vignette': {
        const innerR = Math.min(cw, ch) * (0.55 - intensity*0.25);
        const outerR = Math.sqrt(cw*cw + ch*ch) / 2;
        const grad = ctx.createRadialGradient(cw/2, ch/2, innerR, cw/2, ch/2, outerR);
        grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},0)`);
        grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},${0.4 + intensity*0.5 + (bands?.bass||0)*0.15})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
        break;
      }
      case 'scanlines': {
        const gap = Math.max(2, Math.round(6 - intensity*3));
        const off = Math.floor(t*20) % gap;
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.18 + intensity*0.35})`;
        for (let y = off; y < ch; y += gap) ctx.fillRect(0, y, cw, 1);
        break;
      }
      case 'noise': {
        const NW = 256, NH = 256;
        if (!_fxNoiseCanvas) {
          _fxNoiseCanvas = document.createElement('canvas');
          _fxNoiseCanvas.width = NW; _fxNoiseCanvas.height = NH;
          _fxNoiseCtx = _fxNoiseCanvas.getContext('2d');
        }
        const now = performance.now();
        if (now - _fxNoiseLastT > 33) {
          _fxNoiseLastT = now;
          const img = _fxNoiseCtx.createImageData(NW, NH);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            const v = (Math.random()*255)|0;
            d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
          }
          _fxNoiseCtx.putImageData(img, 0, 0);
        }
        const prev = ctx.globalAlpha;
        ctx.globalAlpha = prev * (0.08 + intensity*0.35);
        ctx.globalCompositeOperation = 'overlay';
        for (let y = 0; y < ch; y += NH) {
          for (let x = 0; x < cw; x += NW) ctx.drawImage(_fxNoiseCanvas, x, y);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = prev;
        break;
      }
      case 'flash': {
        // Бас-вспышка: видимая полноэкранная заливка, но с потолком и кулдауном.
        // Порог максимально низкий — реагирует на любой заметный бас.
        const bass = bands?.bass || 0;
        if (st.flashEnv == null) st.flashEnv = 0;
        if (st.cooldown == null) st.cooldown = 0;
        st.cooldown = Math.max(0, st.cooldown - dts);

        // Простой низкий порог. intensity лишь чуть-чуть его сдвигает.
        const threshold = 0.18 - intensity * 0.08; // 0.18..0.10

        if (bass > threshold && st.cooldown <= 0) {
          // Атака: чем сильнее бас тем ярче (нормализуем по диапазону 0.5).
          const power = Math.min(1, (bass - threshold) / 0.5);
          st.flashEnv = Math.max(st.flashEnv, power);
          st.cooldown = 0.15; // 150 мс между вспышками
        }
        // Плавный спад
        st.flashEnv = Math.max(0, st.flashEnv - dts * 2.0);

        // Полноэкранная заливка с умеренным потолком: 0.12..0.28 — заметно,
        // но не белит экран. На максимуме intensity всё равно мягко.
        const maxAlpha = 0.12 + intensity * 0.16;
        const a = st.flashEnv * maxAlpha;
        if (a < 0.008) break;
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${a})`;
        ctx.fillRect(0, 0, cw, ch);
        break;
      }
      case 'lightleak': {
        const cx = cw * (0.3 + Math.sin(t*0.3)*0.1);
        const cy = ch * (0.4 + Math.cos(t*0.25)*0.1);
        const r  = Math.max(cw, ch) * (0.4 + intensity*0.4);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${0.35 + intensity*0.45})`);
        grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'particles': {
        const bass = bands?.bass || 0;
        const count = Math.floor(20 + intensity*60);
        for (let i = 0; i < count && i < st.parts.length; i++) {
          const p = st.parts[i];
          p.x += p.vx * dts * (0.5 + bass*3);
          p.y += p.vy * dts * (0.5 + bass*3);
          if (p.x < 0) p.x += 1; if (p.x > 1) p.x -= 1;
          if (p.y < 0) p.y += 1; if (p.y > 1) p.y -= 1;
          const r = p.r * (0.6 + intensity*0.8 + bass*1.5);
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.4 + intensity*0.5})`;
          ctx.beginPath();
          ctx.arc(p.x*cw, p.y*ch, r, 0, Math.PI*2);
          ctx.fill();
        }
        break;
      }
      case 'chromatic': {
        const off = (2 + intensity*8) * (1 + (bands?.high || 0));
        const a = 0.18 + intensity*0.25;
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255,0,0,${a})`;
        ctx.fillRect(-off, 0, cw, ch);
        ctx.fillStyle = `rgba(0,255,255,${a})`;
        ctx.fillRect(off, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'vhsLines': {
        const count = 1 + Math.floor(intensity*3);
        for (let i = 0; i < count; i++) {
          const y = ((t * (40 + i*30)) % ch + (i*ch/count)) % ch;
          const h = 4 + intensity*18;
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.25 + intensity*0.35})`;
          ctx.fillRect(0, y, cw, h);
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.08)`;
          ctx.fillRect(0, y - h, cw, 1);
        }
        break;
      }
      case 'colorTint': {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.3 + intensity*0.5})`;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'pulseRings': {
        // Концентрические кольца, расходящиеся от центра. Триггер — пик баса
        // (производная по басу) ИЛИ таймер (если intensity высокая, чтоб эффект
        // работал и на ровных партиях).
        if (!st.rings) st.rings = [];
        const bass = bands?.bass || 0;
        const overall = bands?.overall || 0;
        if (st.lastBass == null) st.lastBass = 0;
        const bassDelta = bass - st.lastBass;
        st.lastBass = bass * 0.4 + st.lastBass * 0.6; // EMA для триггера

        // Триггер на пиках баса (мягкий порог)
        if (bassDelta > 0.10 && st.rings.length < 10) {
          st.rings.push({ born: t, str: 0.7 + bass * 0.6 });
        }
        // Также периодически добавляем кольцо, чтобы было движение всегда
        if (st.lastTimedRing == null) st.lastTimedRing = 0;
        const period = 1.6 - intensity * 0.9; // 0.7 .. 1.6 сек
        if (t - st.lastTimedRing > period && intensity > 0.25) {
          st.rings.push({ born: t, str: 0.4 * intensity + overall * 0.4 });
          st.lastTimedRing = t;
        }

        const maxR = Math.sqrt(cw*cw + ch*ch) * 0.7;
        const speed = 220 + intensity * 520;
        ctx.lineCap = 'round';
        st.rings = st.rings.filter(ring => {
          const age = t - ring.born;
          // Защита от «зомби» при перемотке времени
          if (age < 0 || age > 30) return false;
          const r = age * speed;
          if (r > maxR) return false;
          const lifeAlpha = ring.str * Math.max(0, 1 - r / maxR);
          const a = lifeAlpha * (0.45 + intensity * 0.5);
          if (a < 0.01) return age < 0.05;
          ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${Math.min(0.95, a)})`;
          ctx.lineWidth = 2 + intensity * 5;
          ctx.beginPath();
          ctx.arc(cw / 2, ch / 2, Math.max(0.01, r), 0, Math.PI * 2);
          ctx.stroke();
          return true;
        });
        break;
      }
      case 'lightning': {
        // Зигзагообразные молнии на пиках баса. Живут 0.18сек, светятся.
        if (!st.bolts) st.bolts = [];
        if (st.lastBass == null) st.lastBass = 0;
        const bass = bands?.bass || 0;
        const overall = bands?.overall || 0;

        // Триггер на резких пиках (адаптивный порог)
        const trig = bass > Math.max(0.32, st.lastBass + 0.12);
        const altTrig = overall > 0.5 && Math.random() < 0.04 * intensity; // редкая молния на общем уровне
        if ((trig || altTrig) && st.bolts.length < 4) {
          const bolt = { born: t, points: [], side: Math.random() < 0.5 ? 1 : -1 };
          // Строим ломаную сверху вниз с дрожью
          let x = cw * (0.1 + Math.random() * 0.8);
          let y = -10;
          while (y < ch + 10) {
            bolt.points.push({ x, y });
            x += (Math.random() - 0.5) * (60 + intensity * 80);
            y += 25 + Math.random() * 45;
          }
          // Опционально — ответвление
          if (Math.random() < 0.5 + intensity * 0.4) {
            const branchStart = Math.floor(bolt.points.length * (0.3 + Math.random() * 0.4));
            const bp = bolt.points[branchStart];
            const branch = [{ x: bp.x, y: bp.y }];
            let bx = bp.x, by = bp.y;
            for (let k = 0; k < 4 + Math.floor(intensity * 4); k++) {
              bx += bolt.side * (20 + Math.random() * 40);
              by += 18 + Math.random() * 30;
              branch.push({ x: bx, y: by });
            }
            bolt.branch = branch;
          }
          st.bolts.push(bolt);
        }
        st.lastBass = bass * 0.5 + st.lastBass * 0.5;

        st.bolts = st.bolts.filter(bolt => {
          const age = t - bolt.born;
          // Защита от «зомби» при перемотке
          if (age < 0 || age > 30) return false;
          const life = 0.20;
          if (age > life) return false;
          const fade = 1 - age / life;
          const a = fade * (0.6 + intensity * 0.4);
          ctx.shadowColor = `rgba(${c.r},${c.g},${c.b},${a})`;
          ctx.shadowBlur = 14 + intensity * 22;
          ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${a})`;
          ctx.lineWidth = 1.5 + intensity * 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          // Основной разряд
          ctx.beginPath();
          bolt.points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
          // Ответвление — тоньше
          if (bolt.branch) {
            ctx.lineWidth = 1 + intensity * 1.5;
            ctx.beginPath();
            bolt.branch.forEach((p, i) => {
              if (i === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
          return true;
        });
        break;
      }
      case 'confetti': {
        // Конфетти: разноцветные вращающиеся прямоугольники, летят вниз
        // с покачиванием. Скорость растёт от баса (свободно реагирует на музыку).
        if (!st.pieces || !st.pieces.length) {
          st.pieces = [];
          for (let i = 0; i < 120; i++) {
            st.pieces.push({
              x: Math.random(), y: Math.random()*1.5 - 0.5,
              size: 4 + Math.random()*10, aspect: 0.4 + Math.random()*0.5,
              rot: Math.random()*Math.PI*2, vrot: (Math.random()-0.5)*4,
              vy: 0.08 + Math.random()*0.20, sway: Math.random()*Math.PI*2,
              hue: (i*37) % 360,
            });
          }
        }
        const bass = bands?.bass || 0;
        const speedMul = 0.6 + intensity * 1.2 + bass * 1.5;
        const count = Math.floor(30 + intensity * 90);
        for (let i = 0; i < count && i < st.pieces.length; i++) {
          const p = st.pieces[i];
          p.y += p.vy * dts * speedMul;
          p.x += Math.sin(t * 1.2 + p.sway) * 0.0010 * (0.6 + intensity);
          p.rot += p.vrot * dts * (0.5 + intensity + bass);
          if (p.y > 1.08) { p.y = -0.05 - Math.random()*0.2; p.x = Math.random(); }
          if (p.x > 1) p.x -= 1; if (p.x < 0) p.x += 1;

          ctx.save();
          ctx.translate(p.x * cw, p.y * ch);
          ctx.rotate(p.rot);
          ctx.fillStyle = `hsla(${p.hue}, 85%, 60%, ${0.78 + intensity * 0.22})`;
          const sz = p.size * (0.8 + intensity * 0.6);
          ctx.fillRect(-sz/2, -sz*p.aspect/2, sz, sz*p.aspect);
          ctx.restore();
        }
        break;
      }
      case 'fireflies': {
        // Светлячки: парящие светящиеся точки с пульсацией.
        // Бас усиливает яркость и слегка ускоряет дрейф.
        if (!st.flies || !st.flies.length) {
          st.flies = [];
          for (let i = 0; i < 70; i++) {
            st.flies.push({
              x: Math.random(), y: Math.random(),
              vx: (Math.random()-0.5)*0.015, vy: (Math.random()-0.5)*0.015,
              r: 1.2 + Math.random()*2.4,
              ph: Math.random()*Math.PI*2,
              sp: 0.8 + Math.random()*1.6,
            });
          }
        }
        const bass = bands?.bass || 0;
        const count = Math.floor(20 + intensity * 80);
        const driftMul = 1 + bass * 0.6;
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < count && i < st.flies.length; i++) {
          const f = st.flies[i];
          // Лёгкое броуновское блуждание
          f.vx += (Math.random()-0.5) * 0.0008;
          f.vy += (Math.random()-0.5) * 0.0008;
          // Демпфирование, чтобы скорости не убегали
          f.vx *= 0.985; f.vy *= 0.985;
          f.x += f.vx * dts * 60 * driftMul * (0.4 + intensity);
          f.y += f.vy * dts * 60 * driftMul * (0.4 + intensity);
          // Тор: выходящие за край — возвращаются с противоположной стороны
          if (f.x < -0.02) f.x = 1.02; else if (f.x > 1.02) f.x = -0.02;
          if (f.y < -0.02) f.y = 1.02; else if (f.y > 1.02) f.y = -0.02;
          // Пульсация: каждый светлячок мигает в своей фазе
          const pulse = 0.45 + 0.55 * (0.5 + 0.5*Math.sin(t * f.sp + f.ph));
          const a = pulse * (0.55 + intensity*0.4) * (0.85 + bass*0.4);
          const radius = f.r * (1 + intensity*0.6) * (1 + bass*0.5);
          const x = f.x * cw, y = f.y * ch;
          // Светящееся гало
          const gradR = radius * 6;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, gradR);
          grad.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},${Math.min(1,a)})`);
          grad.addColorStop(0.35, `rgba(${c.r},${c.g},${c.b},${a*0.35})`);
          grad.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, gradR, 0, Math.PI*2);
          ctx.fill();
          // Яркое ядро
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a*0.9)})`;
          ctx.beginPath();
          ctx.arc(x, y, radius*0.55, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = prevComp;
        break;
      }
      case 'aurora': {
        // Северное сияние: 4 волнистые ленты в верхней части кадра,
        // плавно плывут, низкочастотный отклик на бас+mid (амплитуда),
        // mid сдвигает оттенок. Никаких частиц, никаких миганий.
        if (!st.ribbons || !st.ribbons.length) {
          st.ribbons = [];
          for (let i = 0; i < 4; i++) {
            st.ribbons.push({
              ph:     Math.random()*Math.PI*2, sp: 0.18+Math.random()*0.22,
              amp:    0.06+Math.random()*0.06, yBase: 0.08+i*0.13,
              height: 0.28+Math.random()*0.12, hueOff: i*26-32,
              freq:   1.8+Math.random()*1.6,
            });
          }
        }
        const bass = bands?.bass || 0;
        const mid  = bands?.mid  || 0;
        // Базовый оттенок из fxColor
        const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
        let baseHue = 0;
        if (max !== min) {
          const d = max - min;
          if (max === c.r)      baseHue = ((c.g - c.b)/d) % 6;
          else if (max === c.g) baseHue = (c.b - c.r)/d + 2;
          else                  baseHue = (c.r - c.g)/d + 4;
          baseHue *= 60; if (baseHue < 0) baseHue += 360;
        }
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'screen';

        for (const r of st.ribbons) {
          r.ph += dts * r.sp * (0.5 + intensity*0.7);
          const ampMul = 1 + bass*1.4 + intensity*0.5;
          const hue    = (baseHue + r.hueOff + mid*45) % 360;
          const yMid   = r.yBase * ch;
          const segs   = 64;

          // Верхняя кромка ленты
          ctx.beginPath();
          for (let s = 0; s <= segs; s++) {
            const x = (s/segs) * cw;
            const w1 = Math.sin(r.ph + s/segs * Math.PI*2 * r.freq) * r.amp * ch * ampMul;
            const w2 = Math.sin(r.ph*0.6 + s/segs * Math.PI*2 * (r.freq*0.4)) * r.amp*0.4 * ch * ampMul;
            const y = yMid + w1 + w2;
            if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          // Нижняя кромка — ниже на height
          for (let s = segs; s >= 0; s--) {
            const x = (s/segs) * cw;
            const w1 = Math.sin(r.ph + s/segs * Math.PI*2 * r.freq) * r.amp * ch * ampMul;
            const w2 = Math.sin(r.ph*0.6 + s/segs * Math.PI*2 * (r.freq*0.4)) * r.amp*0.4 * ch * ampMul;
            const y = yMid + w1 + w2 + r.height*ch;
            ctx.lineTo(x, y);
          }
          ctx.closePath();

          // Вертикальный градиент: прозрачный сверху → насыщенный → прозрачный снизу
          const grad = ctx.createLinearGradient(0, yMid - 20, 0, yMid + r.height*ch + 20);
          const sat = 70 + intensity*15;
          const lit = 55;
          const aMid = 0.32 * (0.5 + intensity*0.7) * (0.85 + bass*0.3);
          grad.addColorStop(0,    `hsla(${hue}, ${sat}%, ${lit}%, 0)`);
          grad.addColorStop(0.35, `hsla(${hue}, ${sat}%, ${lit}%, ${aMid})`);
          grad.addColorStop(0.65, `hsla(${(hue+20)%360}, ${sat}%, ${lit-5}%, ${aMid*0.85})`);
          grad.addColorStop(1,    `hsla(${(hue+40)%360}, ${sat}%, ${lit-10}%, 0)`);
          ctx.fillStyle = grad;
          ctx.fill();
        }
        ctx.globalCompositeOperation = prevComp;
        break;
      }
      case 'waveGrid': {
        // Синтвейв-сетка: перспективный «пол» с прокруткой и бас-реактивной
        // деформацией. Горизонт по середине, неоновое свечение на горизонте.
        if (st.gridPhase == null) st.gridPhase = 0;
        if (st.bassEnv   == null) st.bassEnv   = 0;
        const bass = bands?.bass || 0;
        // Сглаживаем бас (envelope) чтобы волна не дёргалась
        const target = bass;
        if (target > st.bassEnv) st.bassEnv += (target - st.bassEnv) * Math.min(1, dts * 8);
        else                     st.bassEnv += (target - st.bassEnv) * Math.min(1, dts * 3);

        st.gridPhase += dts * (0.7 + intensity*0.6);
        const horizon = ch * 0.5;
        const floorH  = ch - horizon;
        const rows    = 14;
        const cols    = 22;
        const vp      = cw / 2;

        ctx.save();
        ctx.lineWidth = 1.2;

        // Вертикальные линии (сходятся к точке схода)
        for (let i = -cols; i <= cols; i++) {
          if (i === 0) continue;
          const xNear = vp + (i / cols) * cw;
          const fade  = 1 - Math.abs(i)/cols * 0.35;
          const a     = 0.55 * fade * (0.6 + intensity*0.4);
          ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${a})`;
          ctx.beginPath();
          ctx.moveTo(vp, horizon);
          ctx.lineTo(xNear, ch);
          ctx.stroke();
        }

        // Горизонтальные линии (с перспективой и волной по басу)
        for (let i = 0; i <= rows; i++) {
          const f = ((i + st.gridPhase) % rows) / rows;
          const persp = Math.pow(f, 2.4);
          const yLine = horizon + persp * floorH;
          // Бас-волна сильнее у "ближних" линий (большой f)
          const wave  = Math.sin(st.gridPhase*1.6 + i*0.7) * st.bassEnv * 28 * intensity * (0.3 + f*0.7);
          const a     = (0.18 + 0.7*persp) * (0.55 + intensity*0.45);
          ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${a})`;
          ctx.beginPath();
          ctx.moveTo(0, yLine + wave);
          ctx.lineTo(cw, yLine + wave);
          ctx.stroke();
        }

        // Неоновое свечение на горизонте — реактивное на бас
        const glowH = 18 + st.bassEnv * 36 * intensity;
        const glowGrad = ctx.createLinearGradient(0, horizon - glowH, 0, horizon + glowH);
        const glowA = (0.18 + st.bassEnv * 0.45) * (0.5 + intensity*0.5);
        glowGrad.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},0)`);
        glowGrad.addColorStop(0.5,  `rgba(${c.r},${c.g},${c.b},${glowA})`);
        glowGrad.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.fillStyle = glowGrad;
        ctx.fillRect(0, horizon - glowH, cw, glowH * 2);

        // Тонкая яркая линия самого горизонта
        ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${0.7 * (0.6 + intensity*0.4)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, horizon);
        ctx.lineTo(cw, horizon);
        ctx.stroke();

        ctx.restore();
        break;
      }
      case 'starWarp': {
        // Звёздный гиперпрыжок: звёзды летят из центра наружу,
        // ускоряются от баса. Каждая звезда — короткий хвост (motion blur).
        if (!st.stars || !st.stars.length) {
          st.stars = [];
          for (let i = 0; i < 220; i++) {
            st.stars.push({
              ang:  Math.random()*Math.PI*2,
              dist: Math.random(),
              sp:   0.25 + Math.random()*0.6,
              size: 0.7 + Math.random()*1.4,
            });
          }
        }
        if (st.bassEnv == null) st.bassEnv = 0;
        const bass = bands?.bass || 0;
        // Сглаживаем бас для плавного ускорения
        if (bass > st.bassEnv) st.bassEnv += (bass - st.bassEnv) * Math.min(1, dts*9);
        else                   st.bassEnv += (bass - st.bassEnv) * Math.min(1, dts*3);

        const cx = cw / 2, cy = ch / 2;
        const maxR = Math.hypot(cx, cy);
        const speedMul = 0.45 + intensity*0.9 + st.bassEnv*1.6;
        const count = Math.floor(80 + intensity * 180);

        ctx.save();
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';

        for (let i = 0; i < count && i < st.stars.length; i++) {
          const s = st.stars[i];
          // Двигаем звезду наружу. Скорость растёт квадратично с dist —
          // ближние к краю летят быстрее (эффект гиперпрыжка).
          s.dist += dts * s.sp * speedMul * (0.15 + s.dist * 1.2);
          if (s.dist > 1.05) {
            s.dist = Math.random() * 0.05;
            s.ang  = Math.random() * Math.PI * 2;
          }
          const r       = s.dist * maxR;
          const x       = cx + Math.cos(s.ang) * r;
          const y       = cy + Math.sin(s.ang) * r;
          // Хвост: предыдущая позиция (чем ближе звезда к центру — короче хвост)
          const tailLen = Math.min(80, r * 0.18 * (0.4 + st.bassEnv*1.5 + intensity*0.5));
          const xTail   = cx + Math.cos(s.ang) * (r - tailLen);
          const yTail   = cy + Math.sin(s.ang) * (r - tailLen);
          // Альфа растёт с dist (дальние ярче)
          const a = Math.min(1, 0.35 + s.dist * 0.65) * (0.55 + intensity*0.45);
          // Линия с градиентом (хвост → точка)
          const grad = ctx.createLinearGradient(xTail, yTail, x, y);
          grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},0)`);
          grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},${a})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = s.size * (0.8 + s.dist * 1.2);
          ctx.beginPath();
          ctx.moveTo(xTail, yTail);
          ctx.lineTo(x, y);
          ctx.stroke();
        }

        ctx.globalCompositeOperation = prevComp;
        ctx.restore();
        break;
      }
      case 'tunnel': {
        // Неоновый тоннель: концентрические эллипсы, уходящие в перспективу.
        // Вращается, пульсирует на бас.
        if (st.phase    == null) st.phase = 0;
        if (st.rotPh    == null) st.rotPh = 0;
        if (st.bassEnv  == null) st.bassEnv = 0;
        const bass = bands?.bass || 0;
        if (bass > st.bassEnv) st.bassEnv += (bass - st.bassEnv) * Math.min(1, dts*10);
        else                   st.bassEnv += (bass - st.bassEnv) * Math.min(1, dts*2.5);

        st.phase += dts * (0.6 + intensity*0.7) * (1 + st.bassEnv*0.6);
        st.rotPh += dts * (0.15 + intensity*0.25);

        const cx = cw / 2, cy = ch / 2;
        const maxR = Math.hypot(cx, cy) * 1.05;
        const rings = 16;
        // Лёгкое искажение овала по басу — «дыхание» тоннеля
        const aspectBase = ch / cw;
        const aspect = aspectBase * (1 + Math.sin(st.rotPh*1.7) * 0.06);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(st.rotPh * 0.4);
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';

        for (let i = 0; i < rings; i++) {
          // f: 0 (далеко, маленькое) → 1 (близко, большое). Прокрутка через phase.
          const f = ((i + st.phase) % rings) / rings;
          // Перспектива — экспоненциальный рост радиуса
          const persp = Math.pow(f, 1.9);
          const rX = persp * maxR * (1 + st.bassEnv * 0.12);
          const rY = persp * maxR * aspect * (1 + st.bassEnv * 0.12);
          // Альфа: ярче ближе (большой f), но падает у самого края
          const fade = persp * (1 - Math.max(0, persp - 0.85) * 4);
          const a = fade * (0.45 + intensity*0.4) * (0.85 + st.bassEnv*0.4);
          if (a < 0.01) continue;
          // Толщина линии растёт с близостью
          ctx.lineWidth = 1 + persp * 3.5 * (0.6 + intensity*0.5);
          ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${a})`;
          ctx.beginPath();
          ctx.ellipse(0, 0, rX, rY, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Точка света в центре тоннеля
        const coreA = (0.4 + intensity*0.3) * (0.7 + st.bassEnv*0.6);
        const coreR = 30 + st.bassEnv * 60 * intensity;
        const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
        coreGrad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${Math.min(1, coreA)})`);
        coreGrad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(0, 0, coreR, 0, Math.PI*2);
        ctx.fill();

        ctx.globalCompositeOperation = prevComp;
        ctx.restore();
        break;
      }
      case 'plasma': {
        // Морфирующие цветные «капли» света. Бас раздувает радиус и яркость,
        // mid сдвигает оттенок, общая фаза медленно вращает палитру.
        if (!st.blobs || !st.blobs.length) {
          st.blobs = [];
          for (let i = 0; i < 6; i++) {
            st.blobs.push({
              ph: Math.random()*Math.PI*2, sp: 0.18+Math.random()*0.30,
              ax: 0.25+Math.random()*0.20, ay: 0.20+Math.random()*0.20,
              fx: 0.6+Math.random()*0.7,   fy: 0.5+Math.random()*0.8,
              hue: i * 60,
            });
          }
        }
        if (st.phase   == null) st.phase   = 0;
        if (st.bassEnv == null) st.bassEnv = 0;
        const bass = bands?.bass || 0;
        const mid  = bands?.mid  || 0;
        // Сглаживаем бас — резкие пики не дёргают пузыри
        if (bass > st.bassEnv) st.bassEnv += (bass - st.bassEnv) * Math.min(1, dts * 6);
        else                   st.bassEnv += (bass - st.bassEnv) * Math.min(1, dts * 2);
        st.phase += dts * (0.25 + intensity * 0.45);

        // Базовый оттенок из fxColor
        const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
        let baseHue = 0;
        if (max !== min) {
          const d = max - min;
          if (max === c.r)      baseHue = ((c.g - c.b)/d) % 6;
          else if (max === c.g) baseHue = (c.b - c.r)/d + 2;
          else                  baseHue = (c.r - c.g)/d + 4;
          baseHue = (baseHue * 60 + 360) % 360;
        }

        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';

        const baseR  = Math.min(cw, ch) * 0.42;
        const radMul = (1 + st.bassEnv * 0.45) * (0.75 + intensity * 0.5);

        for (const b of st.blobs) {
          b.ph += dts * b.sp;
          // Параметрические синусы для x/y — каждая капля по своей траектории
          const cx = (0.5 + Math.sin(b.ph * b.fx + st.phase * 0.7) * b.ax) * cw;
          const cy = (0.5 + Math.cos(b.ph * b.fy + st.phase * 0.5) * b.ay) * ch;
          const r  = baseR * radMul;
          const hue = (baseHue + b.hue + mid * 50 + st.phase * 18) % 360;
          const a = (0.30 + intensity * 0.30) * (0.80 + st.bassEnv * 0.40);

          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0,    `hsla(${hue}, 85%, 60%, ${Math.min(1, a)})`);
          grad.addColorStop(0.45, `hsla(${(hue+25)%360}, 75%, 50%, ${a*0.40})`);
          grad.addColorStop(1,    `hsla(${(hue+50)%360}, 70%, 35%, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI*2);
          ctx.fill();
        }

        ctx.globalCompositeOperation = prevComp;
        break;
      }

      // ══════════════════════════════════════════════
      //  ПЛАВНЫЕ ГРАДИЕНТЫ И СВЕТ (низкочастотные, не дёрганные)
      // ══════════════════════════════════════════════

      // 💫 Градиент-сияние: радиальный градиент в (x,y) с плавной бас-реактивностью
      case 'gradGlow': {
        const lpf = 0.88;  // сильный low-pass на бас (медленная реакция)
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        st.breathe = (st.breathe || 0) + dts * 0.7;  // плавное «дыхание»
        const cx = (ov.x / 100) * cw;
        const cy = (ov.y / 100) * ch;
        const baseR = (ov.width / 100) * Math.max(cw, ch) * 0.5;
        const r = baseR * (0.85 + Math.sin(st.breathe) * 0.07 + st.bassEnv * 0.35);
        const a0 = 0.45 * intensity + st.bassEnv * 0.25;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},${a0})`);
        grad.addColorStop(0.4,  `rgba(${c.r},${c.g},${c.b},${a0 * 0.45})`);
        grad.addColorStop(0.8,  `rgba(${c.r},${c.g},${c.b},${a0 * 0.10})`);
        grad.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      // ▤ Градиент-полоса: вертикальная полоса с центром в y%, направленная горизонтально
      case 'gradStripe': {
        const lpf = 0.85;
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        const cy = (ov.y / 100) * ch;
        const halfH = (ov.width / 100) * ch * 0.5 * (0.95 + st.bassEnv * 0.15);
        const peak = 0.55 * intensity + st.bassEnv * 0.20;
        const grad = ctx.createLinearGradient(0, cy - halfH, 0, cy + halfH);
        grad.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},0)`);
        grad.addColorStop(0.5,  `rgba(${c.r},${c.g},${c.b},${peak})`);
        grad.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      // ◤ Градиент-угол: цветной градиент исходит из позиции (x,y) (обычно угол) и затухает
      case 'gradCorner': {
        const lpf = 0.88;
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        const cx = (ov.x / 100) * cw;
        const cy = (ov.y / 100) * ch;
        const r  = (ov.width / 100) * Math.max(cw, ch) * (0.85 + st.bassEnv * 0.20);
        const a0 = 0.55 * intensity + st.bassEnv * 0.20;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},${a0})`);
        grad.addColorStop(0.35, `rgba(${c.r},${c.g},${c.b},${a0 * 0.40})`);
        grad.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      // 🔦 Прожектор: яркое пятно в (x,y) с резким затуханием — освещает выбранную область
      case 'spotlight': {
        const lpf = 0.92;
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        st.phase = (st.phase || 0) + dts * 0.3;
        const cx = (ov.x / 100) * cw;
        const cy = (ov.y / 100) * ch;
        const r = (ov.width / 100) * Math.max(cw, ch) * 0.55 * (0.95 + st.bassEnv * 0.10);
        const a0 = 0.85 * intensity + st.bassEnv * 0.15;
        const grad = ctx.createRadialGradient(cx, cy, r * 0.04, cx, cy, r);
        grad.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},${a0})`);
        grad.addColorStop(0.25, `rgba(${c.r},${c.g},${c.b},${a0 * 0.55})`);
        grad.addColorStop(0.55, `rgba(${c.r},${c.g},${c.b},${a0 * 0.18})`);
        grad.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      // 🌅 Лучи света (god rays): несколько диагональных лучей из позиции (x,y), мягкие
      case 'godRays': {
        const lpf = 0.90;
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        st.phase = (st.phase || 0) + dts * 0.25;
        const cx = (ov.x / 100) * cw;
        const cy = (ov.y / 100) * ch;
        const rayLen = Math.max(cw, ch) * 1.6;
        const numRays = 10 + Math.floor(intensity * 14);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalCompositeOperation = 'lighter';
        // Лучи направлены примерно к центру кадра (от cx,cy в сторону mid)
        const aimX = cw / 2 - cx, aimY = ch / 2 - cy;
        const baseAng = Math.atan2(aimY, aimX);
        const coneSpread = 0.7;  // ширина «веера»
        for (let i = 0; i < numRays; i++) {
          const u = (i / (numRays - 1)) - 0.5;  // -0.5 .. 0.5
          const wobble = Math.sin(st.phase + i * 0.7) * 0.05;
          const a = baseAng + (u * coneSpread + wobble);
          ctx.save();
          ctx.rotate(a);
          const w = (20 + (numRays - i) * 5) * (1 + st.bassEnv * 0.4);
          const alphaR = (0.18 * intensity) * (0.7 + st.bassEnv * 0.4);
          const g = ctx.createLinearGradient(0, 0, rayLen, 0);
          g.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${alphaR})`);
          g.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(0, -w / 2, rayLen, w);
          ctx.restore();
        }
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      // ✨ Линзовый блик (lens flare): главный источник + цепочка маленьких бликов
      case 'lensFlare': {
        const lpf = 0.92;
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        const cx = (ov.x / 100) * cw;
        const cy = (ov.y / 100) * ch;
        const mainR = (ov.width / 100) * Math.max(cw, ch) * 0.3 * (0.95 + st.bassEnv * 0.15);
        ctx.globalCompositeOperation = 'lighter';
        const a0 = 0.85 * intensity + st.bassEnv * 0.20;
        // Главный источник
        let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, mainR);
        g.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},${a0})`);
        g.addColorStop(0.2,  `rgba(${c.r},${c.g},${c.b},${a0 * 0.55})`);
        g.addColorStop(0.55, `rgba(${c.r},${c.g},${c.b},${a0 * 0.15})`);
        g.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cw, ch);
        // Цепочка вторичных бликов по линии источник→центр
        const midX = cw / 2, midY = ch / 2;
        const dx = midX - cx, dy = midY - cy;
        const flares = [
          { t: 0.30, r: 0.40, hueShift: -10 },
          { t: 0.55, r: 0.25, hueShift:  20 },
          { t: 0.80, r: 0.35, hueShift:  40 },
          { t: 1.20, r: 0.20, hueShift: -25 },
          { t: 1.55, r: 0.30, hueShift:  60 },
        ];
        for (const f of flares) {
          const fx = cx + dx * f.t;
          const fy = cy + dy * f.t;
          const fr = mainR * f.r;
          if (fr < 4) continue;
          const a = 0.35 * intensity * f.r;
          const rr = Math.max(0, Math.min(255, c.r + f.hueShift));
          const bb = Math.max(0, Math.min(255, c.b - f.hueShift));
          const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
          grad.addColorStop(0, `rgba(${rr},${c.g},${bb},${a})`);
          grad.addColorStop(1, `rgba(${rr},${c.g},${bb},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, cw, ch);
        }
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      // ☁ Мягкое свечение: общий нежный bloom на области (x,y) c радиусом
      case 'softBloom': {
        const lpf = 0.90;
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        const cx = (ov.x / 100) * cw;
        const cy = (ov.y / 100) * ch;
        const r = (ov.width / 100) * Math.max(cw, ch) * 0.8;
        const a0 = 0.18 * intensity + st.bassEnv * 0.12;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0,   `rgba(${c.r},${c.g},${c.b},${a0})`);
        grad.addColorStop(0.5, `rgba(${c.r},${c.g},${c.b},${a0 * 0.45})`);
        grad.addColorStop(1,   `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      // 🌊 Бас-аура: радиальный градиент сильно реагирующий на бас (но плавно)
      case 'bassAura': {
        // Более активная реакция чем gradGlow, но всё ещё low-pass для плавности
        const lpf = 0.78;
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        const cx = (ov.x / 100) * cw;
        const cy = (ov.y / 100) * ch;
        const baseR = (ov.width / 100) * Math.max(cw, ch) * 0.5;
        const r = baseR * (0.65 + st.bassEnv * 0.70 + intensity * 0.25);
        const a0 = 0.40 + st.bassEnv * 0.45 * intensity;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0,    `rgba(${c.r},${c.g},${c.b},${a0})`);
        grad.addColorStop(0.35, `rgba(${c.r},${c.g},${c.b},${a0 * 0.50})`);
        grad.addColorStop(0.75, `rgba(${c.r},${c.g},${c.b},${a0 * 0.15})`);
        grad.addColorStop(1,    `rgba(${c.r},${c.g},${c.b},0)`);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }

      // 〰 Звук-волна: анимированная синусоида, амплитуда = бас, частота высоких — high
      case 'waveform': {
        // Раздельные low-pass для трёх диапазонов чтобы кривая плавно отзывалась
        st.bassEnv = (st.bassEnv || 0) * 0.78 + (bands.bass || 0) * 0.22;
        st.midEnv  = (st.midEnv  || 0) * 0.75 + (bands.mid  || 0) * 0.25;
        st.highEnv = (st.highEnv || 0) * 0.70 + (bands.high || 0) * 0.30;
        st.phase = (st.phase || 0) + dts * (1.8 + st.midEnv * 1.5);

        const cy = (ov.y / 100) * ch;
        const widthPx = (ov.width / 100) * cw;
        const startX  = (ov.x / 100) * cw - widthPx / 2;
        const amp     = ch * 0.05 * (0.3 + intensity * 0.5 + st.bassEnv * 0.9);

        ctx.save();
        ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${0.75 + intensity * 0.25})`;
        ctx.lineWidth = 2 + intensity * 3;
        ctx.shadowColor = `rgba(${c.r},${c.g},${c.b},0.95)`;
        ctx.shadowBlur = 14 + intensity * 12;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const points = 80;
        for (let i = 0; i <= points; i++) {
          const u = i / points;
          const x = startX + u * widthPx;
          // Композитный сигнал: 3 частоты складываются как осциллограмма
          const y = cy + amp * (
            Math.sin(u * 6 + st.phase) * (0.5 + st.bassEnv * 0.5) +
            Math.sin(u * 14 + st.phase * 1.6) * 0.35 * st.midEnv +
            Math.sin(u * 32 + st.phase * 2.4) * 0.22 * st.highEnv
          );
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
        break;
      }

      // ▮ Эквалайзер: столбики частот с плавным затуханием
      case 'spectrumBars': {
        // Эмулируем 32 столбика — используем 3 band'а bands.bass/mid/high с интерполяцией
        const n = 32;
        const bars = st.bars;
        for (let i = 0; i < n; i++) {
          // Распределяем по частотам: 0..10 = bass, 10..22 = mid, 22..32 = high
          let target;
          if (i < 10)       target = (bands.bass || 0) * (1 - i / 10) + (bands.mid || 0) * (i / 10);
          else if (i < 22)  target = (bands.mid  || 0) * (1 - (i - 10) / 12) + (bands.high || 0) * ((i - 10) / 12);
          else              target = (bands.high || 0);
          // Низкочастотный фильтр: разная реакция вверх и вниз (быстро вверх, медленно вниз)
          const cur = bars[i];
          if (target > cur) bars[i] = cur * 0.45 + target * 0.55;  // быстро поднимаем
          else              bars[i] = cur * 0.92 + target * 0.08;  // медленно опускаем
        }

        const widthPx = (ov.width / 100) * cw;
        const startX  = (ov.x / 100) * cw - widthPx / 2;
        const bottomY = (ov.y / 100) * ch;
        const maxH    = ch * 0.20 * (0.5 + intensity * 0.7);
        const barW    = widthPx / n * 0.75;
        const gap     = widthPx / n * 0.25;

        ctx.save();
        ctx.shadowColor = `rgba(${c.r},${c.g},${c.b},0.85)`;
        ctx.shadowBlur  = 10 + intensity * 8;
        for (let i = 0; i < n; i++) {
          const h = bars[i] * maxH;
          if (h < 1) continue;
          const x = startX + i * (barW + gap);
          // Градиент столбика: ярче внизу, мягче вверху
          const g = ctx.createLinearGradient(0, bottomY - h, 0, bottomY);
          g.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${0.4 + intensity * 0.3})`);
          g.addColorStop(1, `rgba(${c.r},${c.g},${c.b},${0.85 + intensity * 0.15})`);
          ctx.fillStyle = g;
          ctx.fillRect(x, bottomY - h, barW, h);
        }
        ctx.shadowBlur = 0;
        ctx.restore();
        break;
      }

      // ⚪ Дышащая сфера: концентрические кольца ритмично пульсируют (без рывков)
      case 'pulseSphere': {
        const lpf = 0.82;
        st.bassEnv = (st.bassEnv || 0) * lpf + (bands.bass || 0) * (1 - lpf);
        st.breathe = (st.breathe || 0) + dts * 0.8;
        const cx = (ov.x / 100) * cw;
        const cy = (ov.y / 100) * ch;
        const baseR = (ov.width / 100) * Math.max(cw, ch) * 0.4;
        // Три концентрических градиента «дышат» с разной фазой
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const phase = st.breathe + i * 0.5;
          const breath = (Math.sin(phase) + 1) * 0.5;  // 0..1
          const r = baseR * (0.55 + i * 0.18 + breath * 0.15 + st.bassEnv * 0.20);
          const a = (0.35 * intensity + st.bassEnv * 0.20) * (1 - i * 0.20);
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${a})`);
          grad.addColorStop(0.6, `rgba(${c.r},${c.g},${c.b},${a * 0.30})`);
          grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, cw, ch);
        }
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
    }
  }

  // ══════════════════════════════════════════════
  //  FrameDrawEngine — полный движок рисования рамок
  //  (перенесён из frames.html)
  // ══════════════════════════════════════════════
  const FrameDrawEngine = (() => {
    const τ = Math.PI * 2;
    function line(c,x1,y1,x2,y2){c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();}
    function circle(c,x,y,r,fill=false){c.beginPath();c.arc(x,y,r,0,τ);fill?c.fill():c.stroke();}
    function dot(c,x,y,r){c.beginPath();c.arc(x,y,r,0,τ);c.fill();}
    function rect(c,x,y,w,h){c.strokeRect(x,y,w,h);}
    function oct(c,x,y,w,h,cv){c.beginPath();c.moveTo(x+cv,y);c.lineTo(x+w-cv,y);c.lineTo(x+w,y+cv);c.lineTo(x+w,y+h-cv);c.lineTo(x+w-cv,y+h);c.lineTo(x+cv,y+h);c.lineTo(x,y+h-cv);c.lineTo(x,y+cv);c.closePath();c.stroke();}
    function polygon(c,cx,cy,r,n,a0=0){c.beginPath();for(let i=0;i<n;i++){const a=a0+i*τ/n;i?c.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a)):c.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}c.closePath();c.stroke();}
    function star(c,cx,cy,r1,r2,n,a0=0){c.beginPath();for(let i=0;i<n*2;i++){const r=i%2?r2:r1,a=a0+i*Math.PI/n;i?c.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a)):c.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}c.closePath();c.stroke();}
    function dline(c,x1,y1,x2,y2,dash){c.save();c.setLineDash(dash);line(c,x1,y1,x2,y2);c.setLineDash([]);c.restore();}
    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.arcTo(x+w,y,x+w,y+r,r);c.lineTo(x+w,y+h-r);c.arcTo(x+w,y+h,x+w-r,y+h,r);c.lineTo(x+r,y+h);c.arcTo(x,y+h,x,y+h-r,r);c.lineTo(x,y+r);c.arcTo(x,y,x+r,y,r);c.closePath();c.stroke();}
    function withLW(c,lw,fn){const o=c.lineWidth;c.lineWidth=lw;fn();c.lineWidth=o;}

    function celticKnot(c,x,y,w,h,vert){
      c.save();c.translate(x,y);
      if(!vert){
        c.beginPath();c.moveTo(0,h*.5);c.bezierCurveTo(w*.12,-h*.3,w*.38,h*1.3,w*.5,h*.5);c.bezierCurveTo(w*.62,-h*.3,w*.88,h*1.3,w,h*.5);c.stroke();
        c.beginPath();c.moveTo(0,h*.5);c.bezierCurveTo(w*.12,h*1.3,w*.38,-h*.3,w*.5,h*.5);c.bezierCurveTo(w*.62,h*1.3,w*.88,-h*.3,w,h*.5);c.stroke();
      } else {
        c.beginPath();c.moveTo(w*.5,0);c.bezierCurveTo(-w*.3,h*.12,w*1.3,h*.38,w*.5,h*.5);c.bezierCurveTo(-w*.3,h*.62,w*1.3,h*.88,w*.5,h);c.stroke();
        c.beginPath();c.moveTo(w*.5,0);c.bezierCurveTo(w*1.3,h*.12,-w*.3,h*.38,w*.5,h*.5);c.bezierCurveTo(w*1.3,h*.62,-w*.3,h*.88,w*.5,h);c.stroke();
      }
      c.restore();
    }
    function gothicArch(c,x,y,w,h,th){
      c.save();c.translate(x+w/2,y);const hw=w*.44;
      c.beginPath();c.moveTo(-hw,h);c.bezierCurveTo(-hw,h*.25,0,-h*.08,0,-h*.08);c.bezierCurveTo(0,-h*.08,hw,h*.25,hw,h);c.stroke();
      withLW(c,c.lineWidth*.6,()=>{c.beginPath();c.arc(-hw*.38,h*.48,hw*.34,-Math.PI,0);c.stroke();c.beginPath();c.arc(hw*.38,h*.48,hw*.34,-Math.PI,0);c.stroke();polygon(c,0,-h*.05,hw*.18,6);});
      c.restore();
    }
    function neoArch(c,x,y,w,h,th){
      c.save();c.translate(x+w/2,y);const hw=w*.44;
      c.beginPath();c.moveTo(-hw,h);c.bezierCurveTo(-hw,h*.2,-hw*.5,-h*.05,0,-h*.08);c.bezierCurveTo(hw*.5,-h*.05,hw,h*.2,hw,h);c.stroke();
      withLW(c,c.lineWidth*.55,()=>{
        c.beginPath();c.arc(-hw*.35,h*.42,hw*.3,-Math.PI,0);c.stroke();
        c.beginPath();c.arc(hw*.35,h*.42,hw*.3,-Math.PI,0);c.stroke();
        c.beginPath();c.arc(-hw*.35,h*.42,hw*.15,-Math.PI,0);c.stroke();
        c.beginPath();c.arc(hw*.35,h*.42,hw*.15,-Math.PI,0);c.stroke();
        star(c,0,-h*.04,hw*.2,hw*.1,8,-Math.PI/8);
      });c.restore();
    }
    function meander(c,x,y,w,h){
      c.save();c.translate(x,y);
      c.beginPath();c.moveTo(0,0);c.lineTo(w*.2,0);c.lineTo(w*.2,h);c.lineTo(w*.5,h);c.lineTo(w*.5,h*.5);c.lineTo(w*.8,h*.5);c.lineTo(w*.8,0);c.lineTo(w,0);c.stroke();
      c.restore();
    }
    function rune(c,x,y,sz,type){
      c.save();c.translate(x,y);
      const s=[
        ()=>{line(c,0,-sz,0,sz);line(c,0,-sz*.2,sz*.6,sz*.2);line(c,0,sz*.2,sz*.6,-sz*.2);},
        ()=>{line(c,-sz*.4,-sz,-sz*.4,sz);line(c,-sz*.4,-sz*.5,sz*.4,0);line(c,-sz*.4,sz*.5,sz*.4,0);},
        ()=>{line(c,-sz*.3,-sz,0,0);line(c,sz*.3,-sz,0,0);line(c,0,0,0,sz);},
        ()=>{line(c,0,-sz,0,sz);line(c,-sz*.5,-sz*.3,sz*.5,sz*.3);},
        ()=>{line(c,0,-sz,0,sz);line(c,-sz*.5,0,sz*.5,-sz*.5);line(c,-sz*.5,0,sz*.5,sz*.5);},
        ()=>{line(c,-sz*.4,-sz,sz*.4,0);line(c,-sz*.4,sz,sz*.4,0);},
        ()=>{c.beginPath();c.moveTo(0,-sz);c.lineTo(sz*.5,0);c.lineTo(0,sz);c.lineTo(-sz*.5,0);c.closePath();c.stroke();},
        ()=>{line(c,-sz*.5,-sz*.5,sz*.5,-sz*.5);line(c,0,-sz*.5,0,sz);line(c,-sz*.5,sz*.4,sz*.5,sz*.4);}
      ];
      s[type%8]();c.restore();
    }
    function tribalUnit(c,x,y,w,h,vert){
      c.save();c.translate(x,y);
      if(!vert){
        c.beginPath();c.moveTo(0,0);c.lineTo(w*.5,-h*.6);c.lineTo(w,0);c.stroke();
        c.beginPath();c.moveTo(w*.15,0);c.lineTo(w*.5,-h*.3);c.lineTo(w*.85,0);c.stroke();
        dot(c,w*.5,-h*.6,c.lineWidth*.8);
      } else {
        c.beginPath();c.moveTo(0,0);c.lineTo(w*.6,h*.5);c.lineTo(0,h);c.stroke();
        c.beginPath();c.moveTo(0,h*.15);c.lineTo(w*.3,h*.5);c.lineTo(0,h*.85);c.stroke();
        dot(c,w*.6,h*.5,c.lineWidth*.8);
      }
      c.restore();
    }
    function pipeJoint(c,r,th){
      circle(c,0,0,r);circle(c,0,0,r*.55);
      for(let i=0;i<6;i++){const a=i*τ/6+Math.PI/6;dot(c,Math.cos(a)*r*.75,Math.sin(a)*r*.75,th*.6);}
    }
    function laceCell(c,x,y,w,h,th){
      c.save();c.translate(x+w/2,y+h/2);const r=Math.min(w,h)*.42;
      for(let i=0;i<4;i++){c.save();c.rotate(i*Math.PI/2);c.beginPath();c.arc(0,-r*.5,r*.5,0,τ);c.stroke();c.restore();}
      for(let i=0;i<8;i++){const a=i*τ/8+Math.PI/8;dot(c,Math.cos(a)*r*.85,Math.sin(a)*r*.85,th*.5);}
      c.restore();
    }
    function aztecGlyph(c,x,y,r,th,type){
      c.save();c.translate(x,y);
      const s=[
        ()=>{c.strokeRect(-r,-r,r*2,r*2);c.strokeRect(-r*.5,-r*.5,r,r);},
        ()=>{polygon(c,0,0,r,4,Math.PI/4);polygon(c,0,0,r*.55,4,Math.PI/4);},
        ()=>{line(c,-r,0,r,0);line(c,0,-r,0,r);line(c,-r,-r,r,r);},
        ()=>{for(let i=0;i<4;i++){const a=i*Math.PI/2;line(c,Math.cos(a)*r*.3,Math.sin(a)*r*.3,Math.cos(a)*r,Math.sin(a)*r);}circle(c,0,0,r*.3);},
        ()=>{polygon(c,0,0,r,3,-Math.PI/2);polygon(c,0,0,r*.55,3,Math.PI/6);},
        ()=>{star(c,0,0,r,r*.5,4);}
      ];
      s[type%6]();c.restore();
    }
    function arabesqueCell(c,x,y,sz){
      c.save();c.translate(x+sz/2,y+sz/2);const r=sz*.42;
      for(let i=0;i<4;i++){c.save();c.rotate(i*Math.PI/2);c.beginPath();c.moveTo(0,0);c.bezierCurveTo(r*.5,0,r,r*.3,r*.7,r*.7);c.bezierCurveTo(r*.3,r,0,r*.5,0,0);c.stroke();c.restore();}
      circle(c,0,0,r*.3);c.restore();
    }
    function circComp(c,x,y,sz,th,type){
      c.save();c.translate(x+sz/2,y);
      const h2=th*2;
      if(type==='resistor'){withLW(c,th*.8,()=>c.strokeRect(-sz*.28,-h2,sz*.56,h2*2));}
      else if(type==='cap'){withLW(c,th*.8,()=>{line(c,-sz*.35,-h2,sz*.35,-h2);line(c,-sz*.35,h2,sz*.35,h2);});}
      else if(type==='coil'){withLW(c,th*.7,()=>{for(let i=0;i<4;i++)c.beginPath()||(c.arc(-sz*.25+i*sz*.16,0,sz*.12,-Math.PI,0))||c.stroke();});}
      else if(type==='node'){dot(c,0,0,th*1.3);}
      else{withLW(c,th*.6,()=>{c.beginPath();c.moveTo(-sz*.3,h2);c.lineTo(0,-h2);c.lineTo(sz*.3,h2);c.stroke();});}
      c.restore();
    }

    // ── Frame helpers (v6 — sci-fi + brush masks) ──
    function prng(seed) {
      return ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1;
    }
    function hexRGBA(hex, a) {
      if (!hex || hex[0] !== '#') return `rgba(255,255,255,${a})`;
      const h = hex.replace('#', '');
      const r = parseInt(h.length === 3 ? h[0] + h[0] : h.substr(0, 2), 16);
      const g = parseInt(h.length === 3 ? h[1] + h[1] : h.substr(2, 2), 16);
      const b = parseInt(h.length === 3 ? h[2] + h[2] : h.substr(4, 2), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    function octPath(c, x, y, w, h, cut) {
      c.beginPath();
      c.moveTo(x + cut, y); c.lineTo(x + w - cut, y);
      c.lineTo(x + w, y + cut); c.lineTo(x + w, y + h - cut);
      c.lineTo(x + w - cut, y + h); c.lineTo(x + cut, y + h);
      c.lineTo(x, y + h - cut); c.lineTo(x, y + cut);
      c.closePath();
    }
    function hexPath(c, cx, cy, r, rot) {
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = rot + i * Math.PI / 3;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath();
    }

    // Brush stroke — a curved variable-width band, like a thick ink mark
    function brushBand(c, x1, y1, x2, y2, baseW, segs, seed, color) {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      c.save();
      c.translate(x1, y1); c.rotate(ang);
      // Build closed path using top edge then bottom edge with width-noise
      c.beginPath();
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const tt = i / segs;
        const px = tt * len;
        // taper at ends, plus mid noise
        const taper = Math.sin(tt * Math.PI);
        const widthNoise = (prng(seed + i * 7) - 0.5) * 0.6 + 0.7;
        const wHere = baseW * taper * widthNoise;
        // wobble centerline
        const wobble = (prng(seed + i * 11) - 0.5) * baseW * 0.25;
        pts.push({ x: px, top: -wHere * 0.5 + wobble, bot: wHere * 0.5 + wobble });
      }
      c.moveTo(pts[0].x, pts[0].top);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].top);
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(pts[i].x, pts[i].bot);
      c.closePath();
      c.fillStyle = color;
      c.fill();
      c.restore();
    }

    const DRAW = {

      // ══════════════════════════════════════════════════════════════
      // 1. NEXUS — sci-fi HUD brackets at corners + connecting lines
      //    with hex markers. Octagonal content area suggested.
      // ══════════════════════════════════════════════════════════════
      nexus(c, x, y, w, h, th, det, bands, t, color) {
        const ACCENT = color;
        const bs = bands.bass || 0, md = bands.mid || 0, hi = bands.high || 0;

        const unit = h * 0.012;
        const cornerS = unit * 7;
        const cut = unit * 5;

        const drawBracket = (cx, cy, sx, sy) => {
          c.save();
          c.fillStyle = ACCENT;
          c.globalAlpha = 0.85 + bs * 0.15;
          c.beginPath();
          c.moveTo(cx, cy + sy * unit * 0.0);
          c.lineTo(cx + sx * cornerS, cy);
          c.lineTo(cx + sx * (cornerS - unit * 1.2), cy + sy * unit * 1.2);
          c.lineTo(cx + sx * unit * 1.2, cy + sy * unit * 1.2);
          c.lineTo(cx, cy + sy * unit * 2.4);
          c.closePath(); c.fill();
          c.beginPath();
          c.moveTo(cx + sx * unit * 0.0, cy);
          c.lineTo(cx, cy + sy * cornerS);
          c.lineTo(cx + sx * unit * 1.2, cy + sy * (cornerS - unit * 1.2));
          c.lineTo(cx + sx * unit * 1.2, cy + sy * unit * 1.2);
          c.lineTo(cx + sx * unit * 2.4, cy);
          c.closePath(); c.fill();
          c.globalAlpha = 1;

          c.strokeStyle = ACCENT; c.lineWidth = unit * 0.4;
          c.globalAlpha = 0.7 + md * 0.3;
          c.beginPath();
          c.moveTo(cx + sx * cornerS * 0.85, cy + sy * unit * 2.0);
          c.lineTo(cx + sx * unit * 2.8, cy + sy * unit * 2.0);
          c.lineTo(cx + sx * unit * 2.0, cy + sy * unit * 2.8);
          c.lineTo(cx + sx * unit * 2.0, cy + sy * cornerS * 0.85);
          c.stroke();
          c.globalAlpha = 1;

          c.strokeStyle = ACCENT; c.lineWidth = unit * 0.2;
          c.globalAlpha = 0.5;
          c.beginPath();
          c.moveTo(cx + sx * cornerS * 0.7, cy + sy * unit * 3.0);
          c.lineTo(cx + sx * unit * 3.5, cy + sy * unit * 3.0);
          c.lineTo(cx + sx * unit * 3.0, cy + sy * unit * 3.5);
          c.lineTo(cx + sx * unit * 3.0, cy + sy * cornerS * 0.7);
          c.stroke();
          c.globalAlpha = 1;

          if (hi > 0.15) {
            c.fillStyle = '#ffffff';
            c.shadowColor = ACCENT; c.shadowBlur = 12 * hi;
            c.globalAlpha = 0.6 + hi * 0.4;
            c.beginPath(); c.arc(cx + sx * unit * 0.8, cy + sy * unit * 0.8, unit * 0.5, 0, τ); c.fill();
            c.shadowBlur = 0;
            c.globalAlpha = 1;
          }
          c.restore();
        };

        drawBracket(x,     y,     1,  1);
        drawBracket(x + w, y,    -1,  1);
        drawBracket(x,     y + h, 1, -1);
        drawBracket(x + w, y + h, -1, -1);

        const drawEdge = (x1, y1, x2, y2, isHorizontal) => {
          const len = isHorizontal ? (x2 - x1) : (y2 - y1);
          if (len < unit * 8) return;
          const midPt = isHorizontal
            ? { x: (x1 + x2) / 2, y: y1 }
            : { x: x1, y: (y1 + y2) / 2 };
          const gap = unit * 3;

          c.save();
          c.strokeStyle = ACCENT; c.lineWidth = unit * 0.35;
          c.globalAlpha = 0.55;
          if (isHorizontal) {
            c.beginPath();
            c.moveTo(x1, y1); c.lineTo(midPt.x - gap, midPt.y);
            c.moveTo(midPt.x + gap, midPt.y); c.lineTo(x2, y2);
            c.stroke();
            c.lineWidth = unit * 0.18;
            c.globalAlpha = 0.3;
            c.beginPath();
            c.moveTo(x1, y1 + unit * 1.0); c.lineTo(midPt.x - gap, midPt.y + unit * 1.0);
            c.moveTo(midPt.x + gap, midPt.y + unit * 1.0); c.lineTo(x2, y2 + unit * 1.0);
            c.stroke();
          } else {
            c.beginPath();
            c.moveTo(x1, y1); c.lineTo(midPt.x, midPt.y - gap);
            c.moveTo(midPt.x, midPt.y + gap); c.lineTo(x2, y2);
            c.stroke();
            c.lineWidth = unit * 0.18;
            c.globalAlpha = 0.3;
            c.beginPath();
            c.moveTo(x1 + unit * 1.0, y1); c.lineTo(midPt.x + unit * 1.0, midPt.y - gap);
            c.moveTo(midPt.x + unit * 1.0, midPt.y + gap); c.lineTo(x2, y2 + unit * 1.0);
            c.stroke();
          }
          c.globalAlpha = 1;

          const hexR = unit * 1.6;
          const lit = 0.55 + md * 0.45 + Math.sin(t * 3 + midPt.x * 0.01) * 0.08;
          c.strokeStyle = ACCENT; c.lineWidth = unit * 0.35;
          hexPath(c, midPt.x, midPt.y, hexR, 0); c.stroke();
          c.fillStyle = hexRGBA(ACCENT, 0.15 + md * 0.4);
          if (md > 0.3) { c.shadowColor = ACCENT; c.shadowBlur = 10; }
          hexPath(c, midPt.x, midPt.y, hexR * 0.55, 0); c.fill();
          c.shadowBlur = 0;
          c.fillStyle = ACCENT;
          c.globalAlpha = lit;
          c.beginPath(); c.arc(midPt.x, midPt.y, unit * 0.35, 0, τ); c.fill();
          c.globalAlpha = 1;
          c.restore();
        };

        drawEdge(x + cornerS, y,           x + w - cornerS, y,           true);
        drawEdge(x + cornerS, y + h,       x + w - cornerS, y + h,       true);
        drawEdge(x,           y + cornerS, x,               y + h - cornerS, false);
        drawEdge(x + w,       y + cornerS, x + w,           y + h - cornerS, false);

        const innerPad = unit * 4;
        c.save();
        c.strokeStyle = ACCENT;
        c.lineWidth = unit * 0.25;
        c.globalAlpha = 0.32 + bs * 0.18;
        octPath(c, x + innerPad, y + innerPad, w - innerPad * 2, h - innerPad * 2, cut);
        c.stroke();
        c.lineWidth = unit * 0.12;
        c.globalAlpha = 0.18;
        octPath(c, x + innerPad + unit * 0.6, y + innerPad + unit * 0.6, w - innerPad * 2 - unit * 1.2, h - innerPad * 2 - unit * 1.2, cut - unit * 0.6);
        c.stroke();
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // 2. INK — black ink brushwork frame.
      //    Thick irregular brush strokes around perimeter with breaks
      //    and gaps. Splatter of small specks. A thin sci-fi accent
      //    line laid OVER the ink (machine precision through grime).
      //    Static — no animation except very subtle.
      // ══════════════════════════════════════════════════════════════
      ink(c, x, y, w, h, th, det, bands, t, color) {
        const INK = '#000000';
        const ACCENT = color;
        const bs = bands.bass || 0, md = bands.mid || 0, hi = bands.high || 0;

        const unit = h * 0.012;

        // ─── 1. Multiple irregular brush passes per side ───
        // Each side gets 3-4 overlapping brush strokes of varying length and width
        // to give the impression of someone painting the border with thick ink.
        const brushBaseW = unit * 5;

        // Top side: 3 strokes
        const topStrokes = [
          { x1: x - unit * 1, x2: x + w * 0.42, w: brushBaseW * 1.1, seed: 7 },
          { x1: x + w * 0.35, x2: x + w * 0.78, w: brushBaseW * 0.9, seed: 23 },
          { x1: x + w * 0.62, x2: x + w + unit * 1, w: brushBaseW * 1.05, seed: 41 },
        ];
        topStrokes.forEach(s => brushBand(c, s.x1, y + brushBaseW * 0.3, s.x2, y + brushBaseW * 0.3, s.w, 24, s.seed, INK));

        // Bottom side
        const botStrokes = [
          { x1: x - unit * 1, x2: x + w * 0.46, w: brushBaseW * 1.0, seed: 53 },
          { x1: x + w * 0.32, x2: x + w * 0.71, w: brushBaseW * 1.15, seed: 71 },
          { x1: x + w * 0.58, x2: x + w + unit * 1, w: brushBaseW * 0.95, seed: 89 },
        ];
        botStrokes.forEach(s => brushBand(c, s.x1, y + h - brushBaseW * 0.3, s.x2, y + h - brushBaseW * 0.3, s.w, 24, s.seed, INK));

        // Left side
        const leftStrokes = [
          { y1: y - unit * 1, y2: y + h * 0.43, w: brushBaseW * 1.05, seed: 103 },
          { y1: y + h * 0.36, y2: y + h * 0.74, w: brushBaseW * 0.9, seed: 127 },
          { y1: y + h * 0.6, y2: y + h + unit * 1, w: brushBaseW * 1.0, seed: 149 },
        ];
        leftStrokes.forEach(s => brushBand(c, x + brushBaseW * 0.3, s.y1, x + brushBaseW * 0.3, s.y2, s.w, 24, s.seed, INK));

        // Right side
        const rightStrokes = [
          { y1: y - unit * 1, y2: y + h * 0.41, w: brushBaseW * 0.95, seed: 173 },
          { y1: y + h * 0.34, y2: y + h * 0.76, w: brushBaseW * 1.1, seed: 191 },
          { y1: y + h * 0.62, y2: y + h + unit * 1, w: brushBaseW * 1.0, seed: 211 },
        ];
        rightStrokes.forEach(s => brushBand(c, x + w - brushBaseW * 0.3, s.y1, x + w - brushBaseW * 0.3, s.y2, s.w, 24, s.seed, INK));

        // ─── 2. Corner blots — overlapping splotches at corners ───
        c.save();
        c.fillStyle = INK;
        const corners = [
          { cx: x + unit * 1.5, cy: y + unit * 1.5, seed: 311 },
          { cx: x + w - unit * 1.5, cy: y + unit * 1.5, seed: 337 },
          { cx: x + unit * 1.5, cy: y + h - unit * 1.5, seed: 359 },
          { cx: x + w - unit * 1.5, cy: y + h - unit * 1.5, seed: 379 },
        ];
        corners.forEach(corn => {
          // central blot
          c.beginPath();
          for (let i = 0; i <= 18; i++) {
            const a = i * τ / 18;
            const r = unit * (3 + prng(corn.seed + i) * 1.8);
            const px = corn.cx + Math.cos(a) * r;
            const py = corn.cy + Math.sin(a) * r;
            if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
          }
          c.closePath(); c.fill();
        });
        c.restore();

        // ─── 3. Splatter specks scattered around ink (not on content) ───
        c.save();
        c.fillStyle = INK;
        const speckN = 60;
        for (let k = 0; k < speckN; k++) {
          const seed = k * 13 + 1;
          // pick a perimeter side
          const side = Math.floor(prng(seed) * 4);
          let sx, sy;
          if (side === 0) { sx = x + prng(seed + 1) * w; sy = y + prng(seed + 2) * unit * 8 - unit * 2; }
          else if (side === 1) { sx = x + w - prng(seed + 2) * unit * 8 + unit * 2; sy = y + prng(seed + 1) * h; }
          else if (side === 2) { sx = x + prng(seed + 1) * w; sy = y + h - prng(seed + 2) * unit * 8 + unit * 2; }
          else { sx = x + prng(seed + 2) * unit * 8 - unit * 2; sy = y + prng(seed + 1) * h; }
          const r = prng(seed + 5) * unit * 0.6 + 0.4;
          c.globalAlpha = 0.5 + prng(seed + 7) * 0.5;
          c.beginPath(); c.arc(sx, sy, r, 0, τ); c.fill();
        }
        c.globalAlpha = 1;
        c.restore();

        // ─── 4. Sci-fi accent line — thin colored line laid OVER the ink ───
        // Slightly inset, broken at corners — gives "machine through grime" vibe
        c.save();
        c.strokeStyle = ACCENT;
        c.lineWidth = unit * 0.35;
        c.globalAlpha = 0.7 + bs * 0.15;
        c.shadowColor = ACCENT; c.shadowBlur = 4;
        const linePad = brushBaseW * 0.55;
        const cornerGap = unit * 3.5;
        // top
        c.beginPath();
        c.moveTo(x + linePad + cornerGap, y + linePad);
        c.lineTo(x + w - linePad - cornerGap, y + linePad);
        c.stroke();
        // right
        c.beginPath();
        c.moveTo(x + w - linePad, y + linePad + cornerGap);
        c.lineTo(x + w - linePad, y + h - linePad - cornerGap);
        c.stroke();
        // bottom
        c.beginPath();
        c.moveTo(x + w - linePad - cornerGap, y + h - linePad);
        c.lineTo(x + linePad + cornerGap, y + h - linePad);
        c.stroke();
        // left
        c.beginPath();
        c.moveTo(x + linePad, y + h - linePad - cornerGap);
        c.lineTo(x + linePad, y + linePad + cornerGap);
        c.stroke();
        c.shadowBlur = 0;
        c.restore();

        // ─── 5. Small accent corner ticks ───
        c.save();
        c.strokeStyle = ACCENT;
        c.lineWidth = unit * 0.5;
        c.globalAlpha = 0.85;
        c.shadowColor = ACCENT; c.shadowBlur = 4;
        const tickL = unit * 1.5;
        const cornerInset = brushBaseW * 0.55;
        [[x + cornerInset, y + cornerInset, 1, 1],
         [x + w - cornerInset, y + cornerInset, -1, 1],
         [x + cornerInset, y + h - cornerInset, 1, -1],
         [x + w - cornerInset, y + h - cornerInset, -1, -1]].forEach(([cx, cy, sx, sy]) => {
          c.beginPath();
          c.moveTo(cx + sx * tickL, cy);
          c.lineTo(cx, cy);
          c.lineTo(cx, cy + sy * tickL);
          c.stroke();
        });
        c.shadowBlur = 0;
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // 3. SCAN — old film/photocopy frame.
      //    Heavy uneven dark vignette around edges, vertical tracking
      //    streaks, scratches, dust grain. Soft fade to center.
      //    Sci-fi corner ticks overlaid for HUD feel.
      //    Animation: only very slow grain drift — no flashing.
      // ══════════════════════════════════════════════════════════════
      scan(c, x, y, w, h, th, det, bands, t, color) {
        const ACCENT = color;
        const VIG = '#000000';
        const bs = bands.bass || 0, md = bands.mid || 0, hi = bands.high || 0;

        const unit = h * 0.012;
        const vigDepth = unit * 9;        // soft vignette band depth

        // ─── 1. Soft fade vignette using radial-style gradients per side ───
        // Top
        c.save();
        let g = c.createLinearGradient(0, y, 0, y + vigDepth);
        g.addColorStop(0, hexRGBA(VIG, 0.95));
        g.addColorStop(0.6, hexRGBA(VIG, 0.6));
        g.addColorStop(1, hexRGBA(VIG, 0));
        c.fillStyle = g;
        c.fillRect(x, y, w, vigDepth);
        // Bottom
        g = c.createLinearGradient(0, y + h - vigDepth, 0, y + h);
        g.addColorStop(0, hexRGBA(VIG, 0));
        g.addColorStop(0.4, hexRGBA(VIG, 0.6));
        g.addColorStop(1, hexRGBA(VIG, 0.95));
        c.fillStyle = g;
        c.fillRect(x, y + h - vigDepth, w, vigDepth);
        // Left
        g = c.createLinearGradient(x, 0, x + vigDepth, 0);
        g.addColorStop(0, hexRGBA(VIG, 0.95));
        g.addColorStop(0.6, hexRGBA(VIG, 0.6));
        g.addColorStop(1, hexRGBA(VIG, 0));
        c.fillStyle = g;
        c.fillRect(x, y, vigDepth, h);
        // Right
        g = c.createLinearGradient(x + w - vigDepth, 0, x + w, 0);
        g.addColorStop(0, hexRGBA(VIG, 0));
        g.addColorStop(0.4, hexRGBA(VIG, 0.6));
        g.addColorStop(1, hexRGBA(VIG, 0.95));
        c.fillStyle = g;
        c.fillRect(x + w - vigDepth, y, vigDepth, h);
        c.restore();

        // ─── 2. Uneven dirt smudges around perimeter ───
        // Irregular grayscale blotches that sit ON TOP of vignette
        // making it not-uniform.
        c.save();
        c.fillStyle = '#000000';
        const smudgeN = 18;
        for (let k = 0; k < smudgeN; k++) {
          const seed = k * 23 + 5;
          const side = Math.floor(prng(seed) * 4);
          let cx, cy;
          if (side === 0) { cx = x + prng(seed + 1) * w; cy = y + prng(seed + 2) * vigDepth * 0.8; }
          else if (side === 1) { cx = x + w - prng(seed + 2) * vigDepth * 0.8; cy = y + prng(seed + 1) * h; }
          else if (side === 2) { cx = x + prng(seed + 1) * w; cy = y + h - prng(seed + 2) * vigDepth * 0.8; }
          else { cx = x + prng(seed + 2) * vigDepth * 0.8; cy = y + prng(seed + 1) * h; }
          // build irregular blob with multi-noise radius
          c.globalAlpha = 0.3 + prng(seed + 5) * 0.45;
          c.beginPath();
          for (let i = 0; i <= 14; i++) {
            const a = i * τ / 14;
            const r = unit * (1.5 + prng(seed + i * 3) * 4);
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
          }
          c.closePath(); c.fill();
        }
        c.globalAlpha = 1;
        c.restore();

        // ─── 3. Vertical tracking streaks (like old VHS / scan head dirt) ───
        c.save();
        c.fillStyle = '#000000';
        const streakN = 14;
        for (let k = 0; k < streakN; k++) {
          const seed = k * 31 + 2;
          const px = x + prng(seed) * w;
          const sw = unit * (0.15 + prng(seed + 1) * 0.6);
          const sy1 = y + prng(seed + 2) * vigDepth * 1.2;
          const sy2 = y + h - prng(seed + 3) * vigDepth * 1.2;
          // gradient streak — strong at top/bottom, faint in middle
          const sg = c.createLinearGradient(0, sy1, 0, sy2);
          sg.addColorStop(0, hexRGBA('#000', 0.55));
          sg.addColorStop(0.3, hexRGBA('#000', 0.0));
          sg.addColorStop(0.7, hexRGBA('#000', 0.0));
          sg.addColorStop(1, hexRGBA('#000', 0.55));
          c.fillStyle = sg;
          c.fillRect(px, sy1, sw, sy2 - sy1);
        }
        c.restore();

        // ─── 4. Hairline scratches ───
        c.save();
        c.strokeStyle = '#fff';
        c.lineCap = 'round';
        const scratchN = 7;
        for (let k = 0; k < scratchN; k++) {
          const seed = k * 41 + 3;
          const px = x + prng(seed) * w;
          const sy1 = y + prng(seed + 1) * vigDepth * 0.7;
          const sy2 = y + prng(seed + 2) * h * 0.4 + h * 0.1;
          c.lineWidth = 0.5 + prng(seed + 3) * 0.6;
          c.globalAlpha = 0.12 + prng(seed + 4) * 0.15;
          c.beginPath();
          c.moveTo(px, sy1);
          c.lineTo(px + (prng(seed + 5) - 0.5) * unit * 1.5, sy2);
          c.stroke();
        }
        c.globalAlpha = 1;
        c.restore();

        // ─── 5. Grain/dust dots — scattered around perimeter, slow drift ───
        c.save();
        const grainN = 140;
        const driftT = Math.floor(t * 1.2);   // very slow drift
        for (let k = 0; k < grainN; k++) {
          const seed = k * 7 + driftT * 0.3;
          const seedI = Math.floor(seed);
          const side = Math.floor(prng(seedI) * 4);
          let px, py;
          if (side === 0) { px = x + prng(seedI + 1) * w; py = y + prng(seedI + 2) * vigDepth * 1.4; }
          else if (side === 1) { px = x + w - prng(seedI + 2) * vigDepth * 1.4; py = y + prng(seedI + 1) * h; }
          else if (side === 2) { px = x + prng(seedI + 1) * w; py = y + h - prng(seedI + 2) * vigDepth * 1.4; }
          else { px = x + prng(seedI + 2) * vigDepth * 1.4; py = y + prng(seedI + 1) * h; }
          const r = prng(seedI + 5) * 0.9 + 0.4;
          const dark = prng(seedI + 7) > 0.5;
          c.fillStyle = dark ? '#000' : '#fff';
          c.globalAlpha = 0.2 + prng(seedI + 9) * 0.4;
          c.fillRect(px, py, r, r);
        }
        c.globalAlpha = 1;
        c.restore();

        // ─── 6. Subtle film burn at random corner ───
        c.save();
        const burnSide = Math.floor(prng(Math.floor(t * 0.05)) * 4);
        let bx, by;
        if (burnSide === 0) { bx = x + w * 0.15; by = y; }
        else if (burnSide === 1) { bx = x + w; by = y + h * 0.7; }
        else if (burnSide === 2) { bx = x + w * 0.85; by = y + h; }
        else { bx = x; by = y + h * 0.3; }
        const bg = c.createRadialGradient(bx, by, 0, bx, by, unit * 14);
        bg.addColorStop(0, hexRGBA('#000', 0.6));
        bg.addColorStop(0.5, hexRGBA('#000', 0.25));
        bg.addColorStop(1, hexRGBA('#000', 0));
        c.fillStyle = bg;
        c.beginPath(); c.arc(bx, by, unit * 14, 0, τ); c.fill();
        c.restore();

        // ─── 7. Sci-fi HUD corner ticks (overlay, the machine layer) ───
        c.save();
        c.strokeStyle = ACCENT;
        c.lineWidth = unit * 0.45;
        c.globalAlpha = 0.85;
        c.shadowColor = ACCENT; c.shadowBlur = 4;
        const tickL = unit * 3;
        const tickInset = unit * 2;
        [[x + tickInset, y + tickInset, 1, 1],
         [x + w - tickInset, y + tickInset, -1, 1],
         [x + tickInset, y + h - tickInset, 1, -1],
         [x + w - tickInset, y + h - tickInset, -1, -1]].forEach(([cx, cy, sx, sy]) => {
          c.beginPath();
          c.moveTo(cx + sx * tickL, cy);
          c.lineTo(cx, cy);
          c.lineTo(cx, cy + sy * tickL);
          c.stroke();
        });
        c.shadowBlur = 0;
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // 4. NEON — clean glowing rectangle с интенсивной аурой.
      //    detail управляет мягкостью свечения.
      // ══════════════════════════════════════════════════════════════
      neon(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        c.save();
        c.strokeStyle = color;
        c.lineWidth = th;
        c.shadowColor = color;
        c.shadowBlur = th * (6 + det * 1.2) + bs * 14;
        c.strokeRect(x, y, w, h);
        // Внутренний контур, тоньше и ближе
        c.shadowBlur = th * 2;
        c.globalAlpha = 0.4 + bs * 0.4;
        c.lineWidth = Math.max(1, th * 0.5);
        const off = th * (1.5 + det * 0.2);
        c.strokeRect(x + off, y + off, w - off * 2, h - off * 2);
        // Микро-точки в углах (детализация добавляет искры)
        if (det >= 4) {
          c.shadowBlur = th * 4;
          c.globalAlpha = 0.7 + bs * 0.3;
          const r = th * 0.8;
          [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([cx, cy]) => {
            c.beginPath(); c.arc(cx, cy, r, 0, τ); c.fill();
          });
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // 5. BRACKETS — минималистичные L-углы + опц. пунктир по сторонам
      // ══════════════════════════════════════════════════════════════
      brackets(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        const len = Math.min(w, h) * (0.05 + det * 0.012);
        c.save();
        c.strokeStyle = color;
        c.lineWidth = th * 1.4;
        c.lineCap = 'square';
        // 4 L-уголка
        const corners = [
          [x, y, 1, 1], [x + w, y, -1, 1],
          [x, y + h, 1, -1], [x + w, y + h, -1, -1],
        ];
        corners.forEach(([cx, cy, sx, sy]) => {
          c.beginPath();
          c.moveTo(cx + sx * len, cy);
          c.lineTo(cx, cy);
          c.lineTo(cx, cy + sy * len);
          c.stroke();
        });
        // Пунктир между угловыми L (если детализация ≥ 3)
        if (det >= 3) {
          c.lineWidth = Math.max(1, th * 0.55);
          c.globalAlpha = 0.35 + bs * 0.45;
          c.setLineDash([Math.max(2, th * 1.5), Math.max(2, th * 4)]);
          // Top/bottom edges
          line(c, x + len + th, y,     x + w - len - th, y);
          line(c, x + len + th, y + h, x + w - len - th, y + h);
          // Left/right edges
          line(c, x,     y + len + th, x,     y + h - len - th);
          line(c, x + w, y + len + th, x + w, y + h - len - th);
          c.setLineDash([]);
        }
        // Доп. точки в центре каждой стороны при det≥6
        if (det >= 6) {
          c.fillStyle = color;
          c.globalAlpha = 0.8 + bs * 0.2;
          dot(c, x + w / 2, y, th * 0.9);
          dot(c, x + w / 2, y + h, th * 0.9);
          dot(c, x, y + h / 2, th * 0.9);
          dot(c, x + w, y + h / 2, th * 0.9);
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // 6. MANDALA — концентрические розетки в углах + соединит. линии
      // ══════════════════════════════════════════════════════════════
      mandala(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        const r = Math.min(w, h) * 0.055;
        const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
        c.save();
        c.strokeStyle = color;
        c.fillStyle = color;
        c.lineWidth = th * 0.8;
        const rotT = t * 0.4;
        corners.forEach(([cx, cy], idx) => {
          c.save();
          c.translate(cx, cy);
          // Концентрические круги
          circle(c, 0, 0, r);
          circle(c, 0, 0, r * 0.6);
          // Лепестки по кругу
          const petals = Math.max(4, det);
          for (let i = 0; i < petals; i++) {
            const a = (i / petals) * τ + rotT * (idx % 2 === 0 ? 1 : -1);
            const px = Math.cos(a) * r * 1.35;
            const py = Math.sin(a) * r * 1.35;
            dot(c, px, py, th * (1.4 + bs * 0.5));
          }
          // Внутренняя звёздочка
          if (det >= 6) {
            star(c, 0, 0, r * 0.4, r * 0.18, Math.max(4, Math.floor(det / 2)), rotT);
          }
          c.restore();
        });
        // Соединит. линии-сегменты в центре каждой стороны
        c.lineWidth = th;
        c.globalAlpha = 0.55;
        line(c, x + r * 1.6, y,     x + w - r * 1.6, y);
        line(c, x + r * 1.6, y + h, x + w - r * 1.6, y + h);
        line(c, x,     y + r * 1.6, x,     y + h - r * 1.6);
        line(c, x + w, y + r * 1.6, x + w, y + h - r * 1.6);
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // 7. THORNS — готический шипастый бордюр (триангулярные шипы внутрь)
      // ══════════════════════════════════════════════════════════════
      thorns(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        c.save();
        c.strokeStyle = color;
        c.fillStyle = color;
        c.lineWidth = Math.max(1, th * 0.8);
        // Внешний прямоугольник
        c.strokeRect(x, y, w, h);
        // Параметры шипов
        const spikeBase = th * 1.2;
        const spikeLen  = th * (3 + det * 0.6) * (1 + bs * 0.4);
        const sxs = Math.max(8, det * 4);
        const sys = Math.max(6, Math.round(det * 3));
        const stepW = w / sxs;
        const stepH = h / sys;
        // Top/bottom spikes
        for (let i = 0; i < sxs; i++) {
          const cx = x + (i + 0.5) * stepW;
          c.beginPath();
          c.moveTo(cx - spikeBase, y);
          c.lineTo(cx, y + spikeLen);
          c.lineTo(cx + spikeBase, y);
          c.closePath(); c.fill();
          c.beginPath();
          c.moveTo(cx - spikeBase, y + h);
          c.lineTo(cx, y + h - spikeLen);
          c.lineTo(cx + spikeBase, y + h);
          c.closePath(); c.fill();
        }
        // Left/right spikes
        for (let i = 0; i < sys; i++) {
          const cy = y + (i + 0.5) * stepH;
          c.beginPath();
          c.moveTo(x, cy - spikeBase);
          c.lineTo(x + spikeLen, cy);
          c.lineTo(x, cy + spikeBase);
          c.closePath(); c.fill();
          c.beginPath();
          c.moveTo(x + w, cy - spikeBase);
          c.lineTo(x + w - spikeLen, cy);
          c.lineTo(x + w, cy + spikeBase);
          c.closePath(); c.fill();
        }
        // Угловые большие шипы
        if (det >= 5) {
          const big = spikeLen * 1.6;
          [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => {
            c.beginPath();
            c.moveTo(cx, cy);
            c.lineTo(cx + sx * big, cy + sy * big * 0.5);
            c.lineTo(cx + sx * big * 0.5, cy + sy * big);
            c.closePath(); c.fill();
          });
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // 8. VHS — VHS-полосы (ретро-видео): scanlines + chromatic углы
      // ══════════════════════════════════════════════════════════════
      vhs(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        const hi = bands.high || 0;
        c.save();
        // Основной контур
        c.strokeStyle = color;
        c.lineWidth = th;
        c.strokeRect(x, y, w, h);
        // Верхняя/нижняя полосы с скан-линиями
        const barH = Math.max(8, th * (4 + det));
        c.fillStyle = color;
        c.globalAlpha = 0.18 + bs * 0.12;
        c.fillRect(x, y, w, barH);
        c.fillRect(x, y + h - barH, w, barH);
        // Линии сканирования
        c.globalAlpha = 0.45;
        for (let i = 1; i < barH; i += 2) {
          c.fillRect(x, y + i, w, 1);
          c.fillRect(x, y + h - i - 1, w, 1);
        }
        // Хроматическая аберрация в углах: красный + циан
        c.globalAlpha = 0.65 + bs * 0.35;
        c.lineWidth = Math.max(1, th * 0.6);
        const corner = th * (3 + det * 0.4);
        const offset = Math.max(1, th * 0.7) + hi * 5;
        const drawCorner = (cx, cy, sx, sy, dx) => {
          c.beginPath();
          c.moveTo(cx + sx * corner + dx, cy);
          c.lineTo(cx + dx, cy);
          c.lineTo(cx + dx, cy + sy * corner);
          c.stroke();
        };
        c.strokeStyle = '#ff0040';
        [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => drawCorner(cx, cy, sx, sy, -offset));
        c.strokeStyle = '#00fff7';
        [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, sx, sy]) => drawCorner(cx, cy, sx, sy, offset));
        // Дополнительные графические маркеры (квадратики-индикаторы) при det≥6
        if (det >= 6) {
          c.globalAlpha = 0.85;
          c.fillStyle = color;
          const indW = th * 2.5;
          const indH = Math.max(2, th * 1.0);
          // Слева — серия из 3 квадратиков-индикаторов
          for (let i = 0; i < 3; i++) {
            c.fillRect(x + th * 2.5 + i * indW * 1.4, y + barH * 0.55, indW, indH);
          }
          // Справа — одна толстая полоска как «активный канал»
          c.fillRect(x + w - th * 2.5 - indW * 4, y + barH * 0.55, indW * 4, indH);
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // LETTERBOX — чистые кинематографические полосы.
      //   Без текста, без таймкодов — только графика.
      //   detail управляет толщиной полос и наличием акцентов.
      // ══════════════════════════════════════════════════════════════
      letterbox(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        const barH = h * (0.04 + det * 0.011);  // 5%..15% высоты
        c.save();
        // Сами чёрные полосы
        c.fillStyle = '#000';
        c.fillRect(x, y, w, barH);
        c.fillRect(x, y + h - barH, w, barH);
        // Тонкая цветная акцентная линия на стыке полосы и кадра
        c.fillStyle = color;
        c.globalAlpha = 0.55 + bs * 0.30;
        const accentH = Math.max(1, th * 0.4);
        c.fillRect(x, y + barH, w, accentH);
        c.fillRect(x, y + h - barH - accentH, w, accentH);
        // Маленькие тире-маркеры по краям полосы (det≥5) — графический акцент
        if (det >= 5) {
          c.globalAlpha = 0.45 + bs * 0.20;
          const tickW = th * (3 + det * 0.2);
          const tickH = Math.max(1, th * 0.7);
          const inset = th * 4;
          // Top bar — слева и справа
          c.fillRect(x + inset, y + barH * 0.5 - tickH * 0.5, tickW, tickH);
          c.fillRect(x + w - inset - tickW, y + barH * 0.5 - tickH * 0.5, tickW, tickH);
          // Bottom bar
          c.fillRect(x + inset, y + h - barH * 0.5 - tickH * 0.5, tickW, tickH);
          c.fillRect(x + w - inset - tickW, y + h - barH * 0.5 - tickH * 0.5, tickW, tickH);
        }
        // Точки-маркеры по центру полос (det≥7) — графический ритм
        if (det >= 7) {
          c.globalAlpha = 0.55;
          const r = Math.max(2, th * 0.55);
          c.beginPath(); c.arc(x + w * 0.5, y + barH * 0.5,     r, 0, τ); c.fill();
          c.beginPath(); c.arc(x + w * 0.5, y + h - barH * 0.5, r, 0, τ); c.fill();
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // FILMSTRIP — 35мм-плёнка: чёрные полосы сверху/снизу с
      //   перфорированными отверстиями. Очень кинематографично, без техники.
      // ══════════════════════════════════════════════════════════════
      filmStrip(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        const stripH = h * (0.06 + det * 0.008);  // 7%..18%
        c.save();
        // Чёрные полосы
        c.fillStyle = '#000';
        c.fillRect(x, y, w, stripH);
        c.fillRect(x, y + h - stripH, w, stripH);
        // Перфорация: «выбиваем» прямоугольные дырки destination-out'ом —
        // через них видно нижний слой (фон).
        const holesPerStrip = Math.max(10, det * 3);
        const segW = w / holesPerStrip;
        const holeW = segW * 0.55;
        const holeH = stripH * 0.45;
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.fillStyle = '#000';
        for (let i = 0; i < holesPerStrip; i++) {
          const cx = x + (i + 0.5) * segW - holeW / 2;
          c.fillRect(cx, y + (stripH - holeH) * 0.5,             holeW, holeH);
          c.fillRect(cx, y + h - stripH + (stripH - holeH) * 0.5, holeW, holeH);
        }
        c.restore();
        // Тонкая цветная акцентная линия по внутреннему краю полос
        c.fillStyle = color;
        c.globalAlpha = 0.65 + bs * 0.30;
        const accentH = Math.max(1, th * 0.45);
        c.fillRect(x, y + stripH, w, accentH);
        c.fillRect(x, y + h - stripH - accentH, w, accentH);
        // Кадровые тонкие тире (имитация frame numbers) при det≥6
        if (det >= 6) {
          c.fillStyle = color;
          c.globalAlpha = 0.45;
          const dashH = Math.max(1, th * 0.5);
          const dashLen = stripH * 0.18;
          for (let i = 0; i < 4; i++) {
            const cx = x + w * (0.18 + i * 0.22);
            c.fillRect(cx, y + stripH * 0.18, dashLen, dashH);
            c.fillRect(cx, y + h - stripH + stripH * 0.82 - dashH, dashLen, dashH);
          }
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // TITLECARD — графическая композиция в стиле modernist title card.
      //   Чисто геометрия, никаких подделок текста.
      //   Асимметричная сетка с акцентами справа и слева.
      // ══════════════════════════════════════════════════════════════
      titlecard(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        c.save();
        // ── Левый вертикальный слаб (узкий, длинный) ──
        const stripX = x + w * 0.04;
        const stripW = th * (2 + det * 0.35);
        const stripTop = y + h * 0.15, stripBot = y + h * 0.85;
        c.fillStyle = color;
        c.fillRect(stripX, stripTop, stripW, stripBot - stripTop);
        // «Колпачки» — горизонтальные тире выходящие за стрип
        const capH = Math.max(2, th * 0.7);
        const capW = stripW * 5;
        c.fillRect(stripX, stripTop - capH * 0.5, capW, capH);
        c.fillRect(stripX, stripBot - capH * 0.5, capW, capH);

        // ── Логомарк сверху над стрипом — большой квадратный блок ──
        if (det >= 3) {
          const sq = th * (4 + det * 0.5);
          c.fillRect(stripX - sq * 0.15, stripTop - sq - capH, sq, sq);
        }
        // ── Точка-марка снизу под стрипом ──
        if (det >= 4) {
          const dotR = Math.max(2, th * 1.0);
          c.beginPath();
          c.arc(stripX + stripW * 0.5, stripBot + capH * 2 + dotR * 1.5, dotR, 0, τ);
          c.fill();
        }

        // ── Длинные горизонтальные линии-дивайдеры ──
        c.strokeStyle = color;
        c.lineWidth = Math.max(1, th * 0.55);
        c.globalAlpha = 0.55;
        // Top divider — продолжается от логомарка вправо до правого края
        const lineY1 = stripTop;
        const lineY2 = stripBot;
        const startX = stripX + capW + th * 2;
        const endX = x + w * 0.95;
        line(c, startX, lineY1, endX, lineY1);
        line(c, startX, lineY2, endX, lineY2);

        // ── Правый вертикальный мини-слаб (контр-баланс) ──
        if (det >= 4) {
          c.globalAlpha = 1;
          c.fillStyle = color;
          const rW = th * (1.5 + det * 0.2);
          const rH = h * 0.10;
          c.fillRect(endX - rW, lineY1 - rH * 0.05, rW, rH);
          // Маленькая точка справа от него
          if (det >= 6) {
            c.beginPath();
            c.arc(endX, lineY1 + rH * 0.5, Math.max(2, th * 0.7), 0, τ);
            c.fill();
          }
        }

        // ── Нижний правый акцент — тонкая вертикалька + точка ──
        if (det >= 5) {
          c.globalAlpha = 0.7;
          c.lineWidth = Math.max(1, th * 0.5);
          line(c, endX, lineY2 - h * 0.10, endX, lineY2);
          c.fillStyle = color;
          const dotR = Math.max(2, th * 0.85);
          c.beginPath();
          c.arc(endX, lineY2 - h * 0.10, dotR, 0, τ);
          c.fill();
        }

        // ── Центральный диагональный акцент — тонкая короткая линия по
        //   средней горизонтали (только при det≥7) для дополнения композиции ──
        if (det >= 7) {
          c.globalAlpha = 0.32;
          c.lineWidth = Math.max(1, th * 0.4);
          const midY = y + h * 0.5;
          line(c, startX, midY, x + w * 0.45, midY);
          // Тонкий правый «гэп» с точкой
          c.fillStyle = color;
          c.globalAlpha = 0.55;
          c.beginPath();
          c.arc(x + w * 0.45, midY, Math.max(2, th * 0.55), 0, τ);
          c.fill();
        }

        // ── Угловой штрих сверху-справа: маленький L (det≥6) ──
        if (det >= 6) {
          c.strokeStyle = color;
          c.globalAlpha = 0.6;
          c.lineWidth = Math.max(1, th * 0.55);
          const cornL = h * 0.025;
          c.beginPath();
          c.moveTo(endX - cornL, lineY1 - cornL * 1.5);
          c.lineTo(endX,         lineY1 - cornL * 1.5);
          c.lineTo(endX,         lineY1 - cornL * 0.4);
          c.stroke();
        }

        // ── Бас-реактивный микро-блок на стрипе ──
        if (bs > 0.05) {
          c.globalAlpha = 0.6 + bs * 0.4;
          c.fillStyle = color;
          const flashH = (stripBot - stripTop) * 0.06 * bs;
          c.fillRect(stripX - stripW * 0.4, stripTop + (stripBot - stripTop) * 0.5 - flashH * 0.5, stripW * 1.8, flashH);
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // BRUTALIST — асимметричные тяжёлые блоки в духе Swiss design
      // ══════════════════════════════════════════════════════════════
      brutalist(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        c.save();
        c.fillStyle = color;
        // Top-left большой блок
        const tlW = w * 0.20;
        const tlH = th * (4 + det * 1.2);
        c.fillRect(x, y, tlW, tlH);
        // Top-right узкий блок (длиннее справа)
        const trW = w * (0.30 + det * 0.015);
        const trH = th * (1.5 + det * 0.4);
        c.fillRect(x + w - trW, y, trW, trH);
        // Bottom-right массив-полоска
        const brW = w * 0.40;
        const brH = th * (3 + det * 0.8);
        c.fillRect(x + w - brW, y + h - brH, brW, brH);
        // Bottom-left вертикальная плита
        const blW = th * (3 + det * 0.5);
        const blH = h * 0.28;
        c.fillRect(x, y + h - blH, blW, blH);
        // Маленький квадрат в правом верхнем под полоской
        const sqS = th * (3 + det * 0.4);
        c.fillRect(x + w - sqS - th, y + trH + th, sqS, sqS);
        // Текст-метка на топ-левом блоке
        if (det >= 4) {
          c.fillStyle = '#000';
          const fs = Math.max(11, tlH * 0.45);
          c.font = `bold ${fs}px "Space Mono", monospace`;
          c.textBaseline = 'middle';
          c.fillText('No.01', x + th * 1.5, y + tlH * 0.5);
          c.textBaseline = 'alphabetic';
        }
        // На bottom-right — тонкая контр-полоска того же цвета
        if (det >= 6) {
          c.globalAlpha = 0.55;
          c.fillStyle = color;
          c.fillRect(x + w - brW, y + h - brH - th * 1.5, brW * 0.3, Math.max(1, th * 0.5));
        }
        // Тонкий тире-разделитель в центре (опц.)
        if (det >= 7) {
          c.globalAlpha = 0.4;
          c.fillStyle = color;
          c.fillRect(x + w * 0.45, y + tlH * 0.5 - Math.max(1, th * 0.3), w * 0.10, Math.max(1, th * 0.6));
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // GLASSPANE — стеклянная рамка с градиентным бликом
      // ══════════════════════════════════════════════════════════════
      glasspane(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        c.save();
        // Внешний тонкий контур
        c.strokeStyle = color;
        c.globalAlpha = 0.45;
        c.lineWidth = Math.max(1, th * 0.55);
        c.strokeRect(x, y, w, h);
        // Внутренний контур
        const off = th * (1.5 + det * 0.35);
        c.globalAlpha = 0.30;
        c.strokeRect(x + off, y + off, w - off * 2, h - off * 2);
        // Толщина светящейся «фаски»
        const edge = th * (3 + det * 0.5);
        // Top edge — bright highlight
        let g = c.createLinearGradient(x, y, x, y + edge);
        g.addColorStop(0, hexRGBA('#ffffff', 0.18));
        g.addColorStop(1, hexRGBA('#ffffff', 0));
        c.fillStyle = g;
        c.globalAlpha = 1;
        c.fillRect(x, y, w, edge);
        // Left edge — secondary highlight
        g = c.createLinearGradient(x, y, x + edge, y);
        g.addColorStop(0, hexRGBA('#ffffff', 0.10));
        g.addColorStop(1, hexRGBA('#ffffff', 0));
        c.fillStyle = g;
        c.fillRect(x, y, edge, h);
        // Bottom edge — darker
        g = c.createLinearGradient(x, y + h - edge, x, y + h);
        g.addColorStop(0, hexRGBA('#000', 0));
        g.addColorStop(1, hexRGBA('#000', 0.20));
        c.fillStyle = g;
        c.fillRect(x, y + h - edge, w, edge);
        // Right edge — also dim
        g = c.createLinearGradient(x + w - edge, y, x + w, y);
        g.addColorStop(0, hexRGBA('#000', 0));
        g.addColorStop(1, hexRGBA('#000', 0.12));
        c.fillStyle = g;
        c.fillRect(x + w - edge, y, edge, h);
        // Цветовые акценты в углах (det≥4)
        if (det >= 4) {
          c.fillStyle = color;
          c.globalAlpha = 0.65 + bs * 0.30;
          const r = Math.max(2, th * 0.8);
          [[x + off, y + off], [x + w - off, y + off], [x + off, y + h - off], [x + w - off, y + h - off]
          ].forEach(([cx, cy]) => { c.beginPath(); c.arc(cx, cy, r, 0, τ); c.fill(); });
        }
        // Диагональный «свет» проходящий через стекло (det≥6)
        if (det >= 6) {
          const lg = c.createLinearGradient(x, y, x + w, y + h);
          lg.addColorStop(0, hexRGBA('#ffffff', 0));
          lg.addColorStop(0.4, hexRGBA('#ffffff', 0));
          lg.addColorStop(0.5, hexRGBA('#ffffff', 0.08 + bs * 0.06));
          lg.addColorStop(0.6, hexRGBA('#ffffff', 0));
          lg.addColorStop(1, hexRGBA('#ffffff', 0));
          c.fillStyle = lg;
          c.globalAlpha = 1;
          c.fillRect(x + off, y + off, w - off * 2, h - off * 2);
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // HALFTONE — Ben-Day точки fading inward от краёв
      // ══════════════════════════════════════════════════════════════
      halftone(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        c.save();
        c.fillStyle = color;
        const cellSize = Math.max(8, h * (0.012 + (12 - det) * 0.001));
        const maxDepth = Math.min(w, h) * (0.05 + det * 0.013);
        const cols = Math.ceil(w / cellSize) + 1;
        const rows = Math.ceil(h / cellSize) + 1;
        const offsetX = ((cols * cellSize) - w) * 0.5;
        const offsetY = ((rows * cellSize) - h) * 0.5;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            // Hex-style staggered grid
            const stagger = (row % 2) * cellSize * 0.5;
            const px = x - offsetX + col * cellSize + stagger + cellSize * 0.5;
            const py = y - offsetY + row * cellSize + cellSize * 0.5;
            // distance to nearest edge
            const dEdge = Math.min(px - x, x + w - px, py - y, y + h - py);
            if (dEdge > maxDepth) continue;
            if (dEdge < 0) continue;
            const t01 = 1 - dEdge / maxDepth;
            // Сила точки растёт нелинейно от края — степенная
            const dotR = cellSize * 0.45 * Math.pow(t01, 1.6) * (1 + bs * 0.25);
            if (dotR < 0.6) continue;
            c.beginPath();
            c.arc(px, py, dotR, 0, τ);
            c.fill();
          }
        }
        c.restore();
      },

      // ══════════════════════════════════════════════════════════════
      // 9. TAPE — 4 полоски washi-tape по углам, под наклоном
      // ══════════════════════════════════════════════════════════════
      tape(c, x, y, w, h, th, det, bands, t, color) {
        const bs = bands.bass || 0;
        c.save();
        const tapeW = Math.min(w, h) * (0.12 + det * 0.012);
        const tapeT = Math.max(8, th * (3.5 + det * 0.3));
        const corners = [
          { x: x + tapeW * 0.25, y: y + tapeW * 0.25, ang: -Math.PI / 4 },
          { x: x + w - tapeW * 0.25, y: y + tapeW * 0.25, ang: Math.PI / 4 },
          { x: x + tapeW * 0.25, y: y + h - tapeW * 0.25, ang: Math.PI / 4 },
          { x: x + w - tapeW * 0.25, y: y + h - tapeW * 0.25, ang: -Math.PI / 4 },
        ];
        corners.forEach(cn => {
          c.save();
          c.translate(cn.x, cn.y);
          c.rotate(cn.ang);
          // Основная полоска (полупрозрачная)
          c.globalAlpha = 0.72 + bs * 0.18;
          c.fillStyle = color;
          c.fillRect(-tapeW / 2, -tapeT / 2, tapeW, tapeT);
          // Тёмные края (имитация рваных концов)
          c.globalAlpha = 1;
          c.fillStyle = hexRGBA(color, 0.5);
          for (let i = 0; i < 4; i++) {
            const yo = -tapeT * 0.5 + (i / 3) * tapeT * 0.8 + (prng(i * 11) - 0.5) * 2;
            c.fillRect(-tapeW / 2 - tapeT * 0.3, yo, tapeT * 0.5, tapeT * 0.18);
            c.fillRect(tapeW / 2 - tapeT * 0.2, yo, tapeT * 0.5, tapeT * 0.18);
          }
          // Светлый блик
          c.fillStyle = 'rgba(255,255,255,0.32)';
          c.fillRect(-tapeW / 2 + tapeT * 0.15, -tapeT * 0.4, tapeW - tapeT * 0.3, tapeT * 0.18);
          // Тонкая чёрная полоска посередине (для глубины)
          c.fillStyle = 'rgba(0,0,0,0.18)';
          c.fillRect(-tapeW / 2, -tapeT * 0.05, tapeW, tapeT * 0.1);
          c.restore();
        });
        c.restore();
      },

    };

    const LEGACY_MAP = {
      // very old (v1)
      apex:       'nexus',
      neural:     'scan',
      vector:     'ink',
      sigil:      'nexus',
      ether:      'scan',
      baroque:    'ink',
      // intermediate (v2)
      cathedral:  'ink',
      obsidian:   'nexus',
      tachyon:    'scan',
      zodiac:     'nexus',
      nocturne:   'ink',
      datastream: 'scan',
      runic:      'ink',
      // v3
      carnage:    'ink',
      chains:     'nexus',
      torn:       'ink',
      stitch:     'ink',
      fault:      'scan',
      // v4
      amp:        'nexus',
      rack:       'scan',
      truss:      'ink',
      // v5
      rift:       'ink',
      circuit:    'scan',
    };

    function draw(ctx, cw, ch, ov, bands, t) {
      let styleId = ov.frameStyle;
      // 'none' — рамку не рисуем (только текстовые блоки в композициях)
      if (styleId === 'none' || styleId === '') return;
      if (!DRAW[styleId] && LEGACY_MAP[styleId]) styleId = LEGACY_MAP[styleId];
      const drawFn = DRAW[styleId] || DRAW.nexus;
      if (!drawFn) return;

      const pad    = (ov.framePad  ?? 0)  / 100;
      let   th     = (ov.frameThickness ?? 3) * (ch / 1080);
      const det    = ov.frameDetail  ?? 6;
      const color  = ov.frameColor  || '#00e5ff';
      const amode  = ov.frameAnimMode || 'none';
      const aamt   = ov.frameAnimAmt  ?? 0.5;
      const aspd   = ov.frameAnimSpeed ?? 1.0;          // множитель скорости
      const baseRot = (ov.frameRotation ?? 0) * Math.PI / 180; // статич. поворот в градусах

      const safeBands = bands || { bass: 0, mid: 0, high: 0, overall: 0 };
      const safeT = t || 0;

      let scaleF = 1;
      let extraAlpha = 1;
      let colorOverride = null;
      let extraRot = 0;
      let extraTransX = 0, extraTransY = 0;

      if (amode === 'pulse') {
        th *= 1 + safeBands.bass * aamt * 1.8;
      } else if (amode === 'breathe') {
        scaleF = 1 + Math.sin(safeT * 1.2 * aspd) * aamt * 0.04 + safeBands.bass * aamt * 0.03;
      } else if (amode === 'glitch') {
        if (safeBands.bass > 0.35) {
          extraTransX = (Math.random() - 0.5) * safeBands.bass * aamt * 30;
          extraTransY = (Math.random() - 0.5) * safeBands.bass * aamt * 15;
        }
      } else if (amode === 'rainbow') {
        const hue = ((safeT * 60 * aspd) % 360);
        colorOverride = `hsl(${hue},90%,60%)`;
      } else if (amode === 'sparkle') {
        extraAlpha = 0.5 + safeBands.bass * 0.5;
      } else if (amode === 'swing') {
        // Маятниковое качание всей рамки вокруг центра
        extraRot = Math.sin(safeT * 1.2 * aspd) * aamt * 0.12;
        scaleF = 1 + Math.sin(safeT * 1.2 * aspd) * aamt * 0.02;
      } else if (amode === 'rotate') {
        // Непрерывное вращение
        extraRot = safeT * aspd * (0.4 + aamt * 1.0);
      } else if (amode === 'flicker') {
        // Случайные альфа-вспышки (CRT-style)
        const r = Math.sin(safeT * 13.7 * aspd) * Math.cos(safeT * 7.3 * aspd);
        const fk = Math.abs(r);
        if (fk < 0.15 * aamt) extraAlpha = 0.15;
        else if (fk < 0.35 * aamt) extraAlpha = 0.55;
        else extraAlpha = 0.85 + safeBands.bass * 0.15;
      } else if (amode === 'chromatic') {
        // RGB-смещение на бас (через несколько проходов цвета)
        // Эмулируем сдвиг через colorOverride + horizontal jitter
        extraTransX = Math.sin(safeT * 11 * aspd) * safeBands.bass * aamt * 14;
        extraAlpha = 0.85 + safeBands.bass * 0.15;
      } else if (amode === 'march') {
        // «Marching ants» — пунктир со смещением (только для линейных стилей)
        ctx.setLineDash([Math.max(2, th * 2.2), Math.max(2, th * 1.3)]);
        ctx.lineDashOffset = -safeT * (5 + aamt * 30) * aspd;
      }

      ctx.save();
      // Применяем динамический поворот + статический baseRot вокруг центра
      const totalRot = baseRot + extraRot;
      if (scaleF !== 1 || Math.abs(totalRot) > 0.0005 || extraTransX || extraTransY) {
        ctx.translate(cw / 2 + extraTransX, ch / 2 + extraTransY);
        if (Math.abs(totalRot) > 0.0005) ctx.rotate(totalRot);
        if (scaleF !== 1) ctx.scale(scaleF, scaleF);
        ctx.translate(-cw / 2, -ch / 2);
      }
      if (extraAlpha < 1) ctx.globalAlpha = extraAlpha;

      const mg = Math.min(cw, ch) * pad;
      const finalColor = colorOverride || color;
      ctx.strokeStyle = finalColor;
      ctx.fillStyle   = finalColor;
      ctx.lineWidth   = th;

      drawFn(ctx, mg, mg, cw - mg * 2, ch - mg * 2, th, det, safeBands, safeT, finalColor);

      // Сбрасываем dash после draw
      if (amode === 'march') ctx.setLineDash([]);

      ctx.restore();
    }

    const STYLES = [
      // Без рамки — для голого текста на фоне
      { id:'none',       label:'БЕЗ РАМКИ',  icon:'∅', desc:'только текстовые блоки' },
      // Кинематографические / типографические
      { id:'letterbox',  label:'LETTERBOX',  icon:'▬', desc:'чистые кино-полосы 2.35:1' },
      { id:'filmStrip',  label:'FILMSTRIP',  icon:'▥', desc:'35мм плёнка с перфорацией' },
      { id:'titlecard',  label:'TITLECARD',  icon:'▌', desc:'modernist title card' },
      { id:'brutalist',  label:'BRUTALIST',  icon:'▰', desc:'асимм. блоки, swiss style' },
      { id:'glasspane',  label:'GLASS',      icon:'❒', desc:'стеклянная рамка с бликом' },
      { id:'halftone',   label:'HALFTONE',   icon:'⠿', desc:'Ben-Day точки от краёв' },
      // Стилистические
      { id:'nexus',      label:'NEXUS',      icon:'◤', desc:'sci-fi HUD скобки' },
      { id:'ink',        label:'INK',        icon:'❖', desc:'чернильный мазок' },
      { id:'scan',       label:'SCAN',       icon:'▦', desc:'сканирующая сетка' },
      { id:'neon',       label:'NEON',       icon:'▣', desc:'неон + glow' },
      { id:'brackets',   label:'BRACKETS',   icon:'⌐', desc:'минимальные L-углы' },
      { id:'vhs',        label:'VHS',        icon:'▤', desc:'ретро-видео + хром.' },
    ];

    return { draw, STYLES, LEGACY_MAP };
  })();

  function _drawOverlayItem(ctx, ov, cw, ch, bands, t, effectOverride = null, dt = 0.016) {
    // Если пользователь отключил аудио-реактивность для объекта — обнуляем bands.
    // Тогда движения (scroll_*, sway, drift, float, ...) идут с константной скоростью,
    // а bass-зависимые эффекты (pulse/shake/heartbeat) становятся статикой.
    // Не применяем к процедурным эффектам (rain/snow/lightning/...) — они теряют смысл без баса.
    if (ov.audioReactive === false && ov.type !== 'effect') {
      bands = { bass: 0, mid: 0, high: 0, overall: 0 };
    }
    // Рамки рендерим отдельной функцией
    if (ov.type === 'frame') {
      FrameDrawEngine.draw(ctx, cw, ch, ov, bands, t);
      return;
    }
    // Текстовые оверлеи рендерим отдельной функцией
    if (ov.type === 'text') {
      _drawTextOverlayItem(ctx, ov, cw, ch, bands, t, effectOverride);
      return;
    }
    // Композиция (frame + текстовые блоки)
    if (ov.type === 'card') {
      _drawCardComposition(ctx, ov, cw, ch, bands, t);
      return;
    }
    // Процедурные эффекты (дождь, снег, виньетка и т.д.)
    if (ov.type === 'effect') {
      _drawEffectByType(ctx, ov, cw, ch, bands, t, dt);
      return;
    }

    if (!ov.img || !ov.img.naturalWidth) {
      console.warn('[OVERLAY] Image not loaded or invalid:', ov.name);
      return;
    }
    
    // КРИТИЧНО: Изолируем состояние для каждого эффекта
    ctx.save();
    
    const baseX = (ov.x     / 100) * cw;
    const baseY = (ov.y     / 100) * ch;
    const baseW = (ov.width / 100) * cw;
    const baseH = baseW / (ov.img.naturalWidth / ov.img.naturalHeight);
    const amt   = ov.effectAmt;
    const effect = effectOverride || ov.effect || 'static';
    let offX = 0, offY = 0, scaleX = 1, scaleY = 1, rotation = 0;
    // Для scroll_*-режимов: смещение дубликата для бесшовного wrap
    let scrollDupeDx = 0, scrollDupeDy = 0;

    switch (effect) {
      case 'sway':
        offX = Math.sin(t * 1.4) * bands.mid  * amt * 70 + Math.sin(t * 2.3) * bands.bass * amt * 30;
        offY = Math.sin(t * 1.0 + 1.5) * bands.bass * amt * 40 + Math.cos(t * 1.8) * bands.mid  * amt * 20;
        break;
      case 'pulse':
        scaleX = scaleY = 1 + bands.bass * amt * 0.40;
        break;
      case 'stretch':
        scaleX = 1 + bands.bass * amt * 0.35;
        scaleY = 1 - bands.bass * amt * 0.18;
        break;
      case 'float':
        offY = Math.sin(t * 0.85) * amt * 32 + Math.sin(t * 1.7) * amt * 12;
        break;
      case 'shake': {
        const intensity = bands.bass > 0.2 ? bands.bass : 0;
        offX = Math.sin(t * 97.3) * Math.cos(t * 43.1) * intensity * amt * 40;
        offY = Math.sin(t * 71.7) * Math.cos(t * 53.9) * intensity * amt * 20;
        break;
      }
      case 'bounce':
        offY = -Math.abs(Math.sin(t * 3.1 + bands.bass * 4)) * bands.bass * amt * 60;
        break;
      case 'spin':
        rotation = t * (0.6 + bands.mid * 3.5) * amt;
        break;
      // ── Новые эффекты v2 ────────────────────────────────────────────
      case 'zoom':
        // Bass-реактивный зум объекта — аналог musicZoom, но per-object.
        // Быстрая атака (мгновенно на бит), медленный релиз (0.25s LP-фильтр).
        scaleX = scaleY = 1 + bands.bass * amt * 0.55 + bands.mid * amt * 0.15;
        break;
      case 'breathe':
        // Медленный органический пульс (не в такт музыке — похож на дыхание).
        scaleX = scaleY = 1 + Math.sin(t * 0.9) * amt * 0.12 + Math.sin(t * 2.3) * amt * 0.05;
        break;
      case 'glitch': {
        // Цифровой сбой: резкие случайные смещения на пиках баса.
        const g = bands.bass > 0.45 ? bands.bass : 0;
        offX = (Math.random() > 0.5 ? 1 : -1) * g * amt * 55;
        offY = (Math.random() > 0.7 ? 1 : -1) * g * amt * 20;
        scaleX = 1 + (Math.random() > 0.6 ? 1 : -1) * g * amt * 0.12;
        scaleY = 1 - g * amt * 0.06;
        break;
      }
      case 'orbit': {
        // Круговое вращение вокруг базовой точки — как спутник.
        const radius = amt * 70;
        offX = Math.cos(t * 1.2) * radius;
        offY = Math.sin(t * 1.2) * radius * 0.55; // немного сплюснуто по Y
        break;
      }
      case 'pendulum':
        // Маятник: поворот на угол, реагирующий на mid-частоты.
        rotation = Math.sin(t * 1.6) * amt * 0.55 + Math.sin(t * 0.9) * bands.mid * amt * 0.35;
        break;
      case 'vortex':
        // Спираль + пульс: объект вращается И пульсирует на бас.
        rotation = t * amt * 0.8;
        scaleX = scaleY = 1 + bands.bass * amt * 0.30;
        break;
      case 'heartbeat': {
        // Двойной удар как сердцебиение — резкий пик на бас, потом меньший отскок.
        const hb = bands.bass;
        const beat = hb > 0.4 ? hb : 0;
        const echo = hb > 0.25 ? hb * 0.45 : 0;
        scaleX = scaleY = 1 + beat * amt * 0.50 + echo * amt * 0.20;
        offY = -beat * amt * 22;
        break;
      }
      case 'drift': {
        // Медленный дрейф: плывёт и слегка виляет, чуть реагирует на бас.
        offX = Math.sin(t * 0.4) * amt * 55 + Math.sin(t * 1.1) * bands.mid * amt * 18;
        offY = Math.cos(t * 0.55) * amt * 35 + Math.cos(t * 1.3) * bands.bass * amt * 14;
        break;
      }
      // ── Адаптации режимов текста лирики для объектов ─────────────
      case 'cinematic': {
        // Медленный zoom + микро-дрифт камеры (как из physics-and-anim.cinematic)
        const scBase = 1 + bands.overall * amt * 0.25;
        scaleX = scaleY = scBase;
        offX = (Math.sin(t * 1.3) * 0.4 + Math.sin(t * 2.7) * 0.3) * (1 + bands.bass * 2) * amt * 20;
        offY = (Math.cos(t * 1.1) * 0.3 + Math.cos(t * 2.3) * 0.2) * (1 + bands.bass * 2) * amt * 18;
        rotation = Math.sin(t * 0.9) * amt * 0.015;
        break;
      }
      case 'flash': {
        // Резкая вспышка: сильный зум-шип на пике баса, затем отпускает.
        const f = bands.bass > 0.35 ? bands.bass : 0;
        scaleX = scaleY = 1 + f * amt * 0.75;
        break;
      }
      case 'impact': {
        // Вбивание: scale squash + shake на бас (single-object аналог text-impact).
        const hit = bands.bass > 0.3 ? bands.bass : 0;
        scaleX = 1 + hit * amt * 0.35;
        scaleY = 1 - hit * amt * 0.18;
        const sh = hit * amt * 30;
        offX = Math.sin(t * 87.1) * sh;
        offY = Math.cos(t * 91.7) * sh * 0.6;
        break;
      }
      case 'parallax': {
        // 2.5D-глубина: bass-зум + медленный камерный drift с лёгким tilt.
        const depth = 1 + bands.bass * amt * 0.22 + bands.mid * amt * 0.08;
        scaleX = scaleY = depth;
        offX = Math.sin(t * 0.35) * amt * 40 + Math.sin(t * 0.9) * bands.mid * amt * 14;
        offY = Math.cos(t * 0.45) * amt * 25 + Math.cos(t * 1.05) * bands.bass * amt * 10;
        rotation = Math.sin(t * 0.55) * amt * 0.025;
        break;
      }
      case 'path': {
        // Движение по синусоидальной траектории (mid-реактивная амплитуда).
        const freq = 0.9;
        offX = Math.sin(t * freq) * amt * 90;
        offY = Math.sin(t * freq * 2 + 0.7) * amt * (28 + bands.mid * 40);
        rotation = Math.cos(t * freq) * amt * 0.12;
        break;
      }
      // ── Scroll-режимы: непрерывная прокрутка объекта ─────────────
      case 'scroll_left': {
        const speed = (amt * 150 + bands.overall * amt * 120);
        const wrapW = Math.max(baseW * 1.4, cw * 0.7);
        offX = -((t * speed) % wrapW);
        scrollDupeDx = wrapW;
        break;
      }
      case 'scroll_right': {
        const speed = (amt * 150 + bands.overall * amt * 120);
        const wrapW = Math.max(baseW * 1.4, cw * 0.7);
        offX = ((t * speed) % wrapW);
        scrollDupeDx = -wrapW;
        break;
      }
      case 'scroll_up': {
        const speed = (amt * 120 + bands.overall * amt * 90);
        const wrapH = Math.max(baseH * 1.4, ch * 0.7);
        offY = -((t * speed) % wrapH);
        scrollDupeDy = wrapH;
        break;
      }
      case 'scroll_down': {
        const speed = (amt * 120 + bands.overall * amt * 90);
        const wrapH = Math.max(baseH * 1.4, ch * 0.7);
        offY = ((t * speed) % wrapH);
        scrollDupeDy = -wrapH;
        break;
      }
      case 'scroll_diag_dr': {
        const speed = (amt * 130 + bands.overall * amt * 100);
        const wrapW = Math.max(baseW * 1.4, cw * 0.7);
        const wrapH = Math.max(baseH * 1.4, ch * 0.6);
        offX = ((t * speed) % wrapW);
        offY = ((t * speed * 0.6) % wrapH);
        scrollDupeDx = -wrapW;
        scrollDupeDy = -wrapH;
        break;
      }
      case 'scroll_diag_ul': {
        const speed = (amt * 130 + bands.overall * amt * 100);
        const wrapW = Math.max(baseW * 1.4, cw * 0.7);
        const wrapH = Math.max(baseH * 1.4, ch * 0.6);
        offX = -((t * speed) % wrapW);
        offY = -((t * speed * 0.6) % wrapH);
        scrollDupeDx = wrapW;
        scrollDupeDy = wrapH;
        break;
      }
    }

    const drawW = baseW * scaleX;
    const drawH = baseH * scaleY;
    
    // Масштаб для stroke/shadow (относительно высоты canvas)
    const scaleRef = ch / 1080;
    
    // Тень для изображения
    if (ov.shadowEnabled && ov.shadowColor && ov.shadowBlur > 0) {
      ctx.shadowColor = ov.shadowColor;
      ctx.shadowBlur  = ov.shadowBlur * scaleRef;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    
    // Лямбда рисования: off — дополнительное смещение для scroll-wrap дубликата
    const drawAt = (addX, addY) => {
      if (effect === 'spin' || rotation !== 0) {
        ctx.save();
        ctx.translate(baseX + offX + addX, baseY + offY + addY);
        ctx.rotate(rotation);
        ctx.drawImage(ov.img, -drawW / 2, -drawH / 2, drawW, drawH);
        if (ov.strokeEnabled && ov.strokeColor && ov.strokeWidth > 0) {
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.strokeStyle = ov.strokeColor;
          ctx.lineWidth = ov.strokeWidth * scaleRef;
          ctx.lineJoin = 'miter';
          ctx.strokeRect(-drawW / 2, -drawH / 2, drawW, drawH);
        }
        ctx.restore();
      } else {
        const dx = baseX - drawW / 2 + offX + addX;
        const dy = baseY - drawH / 2 + offY + addY;
        ctx.drawImage(ov.img, dx, dy, drawW, drawH);
        if (ov.strokeEnabled && ov.strokeColor && ov.strokeWidth > 0) {
          ctx.save();
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.strokeStyle = ov.strokeColor;
          ctx.lineWidth = ov.strokeWidth * scaleRef;
          ctx.lineJoin = 'miter';
          ctx.strokeRect(dx, dy, drawW, drawH);
          ctx.restore();
        }
      }
    };

    drawAt(0, 0);
    // Для scroll-режимов: рисуем дубликат с противоположной стороны
    // (бесшовная прокрутка — когда одна копия уходит за край, другая появляется).
    if (scrollDupeDx !== 0 || scrollDupeDy !== 0) {
      drawAt(scrollDupeDx, scrollDupeDy);
    }

    ctx.restore();
  }

  // ── Per-word режимы из physics-and-anim.js ──────────────
  // Для text-объектов: эти режимы разбивают текст на слова/буквы и
  // анимируют каждое отдельно (cascade — лесенка, scatter — хаос и т.д.).
  // Для image-объектов не применимы.
  const _PER_WORD_MODES = new Set([
    'cascade', 'snap', 'scatter', 'shatter', 'cipher', 'ripple'
  ]);

  // Рендерит text-overlay в per-word режиме, используя AnimModes из
  // physics-and-anim.js. Эффект проигрывается циклически с длиной
  // ov.loopDuration (по умолчанию 4с).
  function _drawTextOverlayPerWord(ctx, ov, cw, ch, bands, t, effect,
                                    fontSize, font, weight, style, scaleRef,
                                    lines, baseX, baseY, amt) {
    // Собираем все строки в один поток слов (\n превращаем в пробел —
    // per-word layout сам раскладывает слова в сетку/цепочку).
    const rawText = lines.join(' ');
    const words = rawText.split(/\s+/).filter(Boolean);
    if (!words.length) return;

    // Per-overlay springs (кэшируются в самом объекте, переживают
    // перерисовки, сбрасываются при смене effect).
    if (!ov._springs || ov._springEffect !== effect) {
      ov._springs = {
        scale:   new SpringPhysics({ stiffness: 0.35, damping: 0.55, initial: 1 }),
        offsetY: new SpringPhysics({ stiffness: 0.25, damping: 0.45, initial: 0 }),
      };
      ov._springEffect = effect;
      ov._lastT = t;
    }
    const dt = Math.min(Math.max(t - (ov._lastT || t), 0.001), 0.05);
    ov._lastT = t;
    ov._springs.scale.update(dt);
    ov._springs.offsetY.update(dt);

    // Циклическая эмуляция elapsed/duration (у overlay нет "строки лирики",
    // эффект играется бесконечным циклом — хорошо подходит для фоновых акцентов).
    const duration = ov.loopDuration || 4;
    const elapsed  = t % duration;

    // Параметры, аналогичные тем что FxEditor передаёт в текст лирики.
    // effectAmt регулирует bassSens — сила реакции на бас.
    const params = {
      bassSens: 0.5 + (amt != null ? amt : 0.5) * 1.0,
      maxScale: 2.0,
    };

    let result;
    try {
      result = AnimModes[effect]({
        bands, t, params,
        springs: ov._springs,
        words,
        canvasW: cw,
        canvasH: ch,
        elapsed,
        duration,
        fontSize,
        ctx, font,
      });
    } catch (e) {
      console.warn('[per-word text overlay]', effect, 'error:', e);
      return;
    }

    if (!result || !result.wordLayout || !Array.isArray(result.words)) return;

    // ── Настраиваем ctx для рендера текста ──
    ctx.translate(baseX, baseY);
    ctx.font         = `${style} ${weight} ${fontSize}px ${font}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    const fillColor = ov.color || '#ffffff';
    const hasStroke = ov.strokeEnabled && ov.strokeColor && ov.strokeWidth > 0;
    if (hasStroke) {
      ctx.strokeStyle = ov.strokeColor;
      ctx.lineWidth   = ov.strokeWidth * scaleRef;
      ctx.lineJoin    = 'round';
      ctx.miterLimit  = 2;
    }
    if (ov.shadowEnabled && ov.shadowColor && ov.shadowBlur > 0) {
      ctx.shadowColor = ov.shadowColor;
      ctx.shadowBlur  = ov.shadowBlur * scaleRef;
    }

    // Глобальные трансформы из результата (scaleX/Y, offsetX/Y, rotation) —
    // если они есть, применяются ПОВЕРХ per-word layout.
    if (result.offsetX || result.offsetY) {
      ctx.translate(result.offsetX || 0, result.offsetY || 0);
    }
    if (result.rotation) ctx.rotate(result.rotation);
    const rSx = result.scaleX != null ? result.scaleX : 1;
    const rSy = result.scaleY != null ? result.scaleY : 1;
    if (rSx !== 1 || rSy !== 1) ctx.scale(rSx, rSy);

    // Рисуем каждое слово/букву
    for (const w of result.words) {
      if (!w || !w.word) continue;
      const a = (w.alpha != null) ? w.alpha : 1;
      if (a <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, a));
      ctx.translate(w.x || 0, w.y || 0);
      if (w.rotation) ctx.rotate(w.rotation);
      const sc = (w.scale != null) ? w.scale : 1;
      if (sc !== 1) ctx.scale(sc, sc);
      // Поддержка per-word цвета (например cipher выдаёт свой цвет)
      ctx.fillStyle = w.color || fillColor;
      if (hasStroke) ctx.strokeText(w.word, 0, 0);
      ctx.fillText(w.word, 0, 0);
      ctx.restore();
    }
  }

  // ── Рендер текстового оверлея ──────────────
  // Полностью повторяет логику эффектов image-оверлея, только рисует текст.
  // ══════════════════════════════════════════════
  //  CARD COMPOSITION — frame + многоблочный форматированный текст
  // ══════════════════════════════════════════════
  function _drawCardComposition(ctx, ov, cw, ch, bands, t) {
    // Размеры карточки
    const cardW = (ov.cardW || 60) / 100 * cw;
    const cardH = cardW * (ov.cardAspect || 0.5625);
    const centerX = (ov.x || 50) / 100 * cw;
    const centerY = (ov.y || 50) / 100 * ch;
    const rotDeg = ov.cardRotation || 0;

    ctx.save();
    // Поворот карточки вокруг её центра
    if (Math.abs(rotDeg) > 0.001) {
      ctx.translate(centerX, centerY);
      ctx.rotate(rotDeg * Math.PI / 180);
      ctx.translate(-centerX, -centerY);
    }

    // bbox карточки в координатах холста
    const cardX = centerX - cardW / 2;
    const cardY = centerY - cardH / 2;

    // ── 1. Рисуем рамку ВНУТРИ bbox карточки ──
    // FrameDrawEngine.draw ожидает полноэкранный ctx, поэтому подменяем размеры
    // через временный transform.
    if (ov.frameStyle && FrameDrawEngine && FrameDrawEngine.draw) {
      ctx.save();
      ctx.translate(cardX, cardY);
      // Prepare a fake "canvas size" — рамка нарисуется на области cardW×cardH.
      // FrameDrawEngine использует cw/ch для расчёта размеров — передаём ему
      // размеры карточки, не холста.
      FrameDrawEngine.draw(ctx, cardW, cardH, ov, bands, t);
      ctx.restore();
    }

    // ── 2. Рисуем все блоки (диспетчер по kind: text/image/divider) ──
    const blocks = Array.isArray(ov.blocks) ? ov.blocks : [];
    blocks.forEach(blk => {
      if (!blk) return;
      const kind = blk.kind || 'text';
      if (kind === 'image')   _drawCardImageBlock(ctx, blk, cardX, cardY, cardW, cardH);
      else if (kind === 'divider') _drawCardDividerBlock(ctx, blk, cardX, cardY, cardW, cardH);
      else if (blk.text != null)   _drawCardTextBlock(ctx, blk, cardX, cardY, cardW, cardH);
    });

    ctx.restore();
  }

  // ── Image block: загруженная картинка (логотип) ─────────
  function _drawCardImageBlock(ctx, blk, cardX, cardY, cardW, cardH) {
    if (!blk.img || !blk.img.naturalWidth) return;
    const widthPx = Math.max(2, (blk.widthPct || 30) / 100 * cardW);
    const aspect = blk.img.naturalWidth / blk.img.naturalHeight;
    const heightPx = widthPx / aspect;
    const cx = cardX + (blk.x || 50) / 100 * cardW;
    const cy = cardY + (blk.y || 50) / 100 * cardH;
    const left = cx - widthPx / 2;
    const top  = cy - heightPx / 2;

    ctx.save();

    // Static rotation вокруг центра
    if (blk.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate((blk.rotation || 0) * Math.PI / 180);
      ctx.translate(-cx, -cy);
    }

    ctx.globalAlpha = blk.opacity != null ? blk.opacity : 1;

    // Скруглённые углы (clip path)
    const r = Math.max(0, Math.min(Math.min(widthPx, heightPx) / 2, blk.cornerRadius || 0));
    if (r > 0.5) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(left + r, top);
      ctx.arcTo(left + widthPx, top,             left + widthPx, top + heightPx, r);
      ctx.arcTo(left + widthPx, top + heightPx, left,           top + heightPx, r);
      ctx.arcTo(left,           top + heightPx, left,           top,            r);
      ctx.arcTo(left,           top,             left + widthPx, top,            r);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(blk.img, left, top, widthPx, heightPx);
      ctx.restore();
    } else {
      ctx.drawImage(blk.img, left, top, widthPx, heightPx);
    }

    // Рамка (если включена)
    if (blk.border) {
      ctx.strokeStyle = blk.borderColor || '#ffffff';
      ctx.lineWidth = Math.max(1, blk.borderWidth || 2);
      if (r > 0.5) {
        ctx.beginPath();
        ctx.moveTo(left + r, top);
        ctx.arcTo(left + widthPx, top,             left + widthPx, top + heightPx, r);
        ctx.arcTo(left + widthPx, top + heightPx, left,           top + heightPx, r);
        ctx.arcTo(left,           top + heightPx, left,           top,            r);
        ctx.arcTo(left,           top,             left + widthPx, top,            r);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(left, top, widthPx, heightPx);
      }
    }

    ctx.restore();
  }

  // ── Divider block: горизонтальная / вертикальная линия ──
  function _drawCardDividerBlock(ctx, blk, cardX, cardY, cardW, cardH) {
    const cx = cardX + (blk.x || 50) / 100 * cardW;
    const cy = cardY + (blk.y || 50) / 100 * cardH;
    const isHorz = (blk.orientation || 'horizontal') === 'horizontal';
    const lengthPx = Math.max(2, (blk.lengthPct || 50) / 100 * (isHorz ? cardW : cardH));
    const thickness = Math.max(1, blk.thickness || 2);
    ctx.save();
    ctx.fillStyle = blk.color || '#ffffff';
    ctx.globalAlpha = blk.opacity != null ? blk.opacity : 1;
    if (isHorz) {
      ctx.fillRect(cx - lengthPx / 2, cy - thickness / 2, lengthPx, thickness);
    } else {
      ctx.fillRect(cx - thickness / 2, cy - lengthPx / 2, thickness, lengthPx);
    }
    ctx.restore();
  }

  function _drawCardTextBlock(ctx, blk, cardX, cardY, cardW, cardH) {
    const text = String(blk.text || '');
    if (!text) return;

    ctx.save();

    // Размер шрифта в % от высоты карточки
    const fontPx = Math.max(4, (blk.sizePct || 6) / 100 * cardH);
    const weight = blk.bold ? '700' : '400';
    const style  = blk.italic ? 'italic' : 'normal';
    const font   = blk.font || "'Bebas Neue', cursive";

    ctx.font = `${style} ${weight} ${fontPx}px ${font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = blk.align || 'center';
    if (blk.letterSpacing != null && 'letterSpacing' in ctx) {
      ctx.letterSpacing = `${blk.letterSpacing}px`;
    }

    // Тень
    if (blk.shadow) {
      ctx.shadowColor = blk.shadowColor || '#000000';
      ctx.shadowBlur = (blk.shadowBlur || 8);
    }

    // Позиция блока в координатах холста
    const blockCx = cardX + (blk.x || 50) / 100 * cardW;
    const blockCy = cardY + (blk.y || 50) / 100 * cardH;
    const maxW = (blk.maxWidthPct || 90) / 100 * cardW;

    ctx.fillStyle = blk.color || '#ffffff';

    // Простая многострочная (по \n) или word-wrap по maxW
    const explicitLines = text.split('\n');
    const finalLines = [];
    explicitLines.forEach(line => {
      if (!line) { finalLines.push(''); return; }
      // Word-wrap (если строка шире maxW — переносим по словам)
      const words = line.split(' ');
      let cur = '';
      for (const w of words) {
        const test = cur ? cur + ' ' + w : w;
        const wpx = ctx.measureText(test).width;
        if (wpx > maxW && cur) {
          finalLines.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) finalLines.push(cur);
    });

    // Рисуем строки центрированно по вертикали относительно blockCy
    const lineGap = fontPx * 1.18;
    const totalH = lineGap * finalLines.length;
    const startY = blockCy - (totalH - lineGap) / 2;

    finalLines.forEach((line, i) => {
      ctx.fillText(line, blockCx, startY + i * lineGap);
    });

    ctx.restore();
  }

  function _drawTextOverlayItem(ctx, ov, cw, ch, bands, t, effectOverride = null) {
    const rawText = (ov.text == null ? '' : String(ov.text));
    if (!rawText) return;

    ctx.save();

    // Масштаб от высоты канваса (опорное 1080)
    const scaleRef = ch / 1080;
    const fontSize = Math.max(4, (ov.fontSize || 64) * scaleRef);

    const weight = ov.bold   ? '700'    : '400';
    const style  = ov.italic ? 'italic' : 'normal';
    const font   = ov.font || "'Bebas Neue', cursive";
    ctx.font         = `${style} ${weight} ${fontSize}px ${font}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Поддержка многострочности (\n)
    const lines     = rawText.split('\n');
    const lineGap   = fontSize * 1.15;
    const totalH    = lineGap * lines.length;

    const baseX = (ov.x / 100) * cw;
    const baseY = (ov.y / 100) * ch;
    const amt   = ov.effectAmt;
    const effect = effectOverride || ov.effect || 'static';

    // ── Per-word режимы (из текста лирики) ─────────────────────
    // Если выбран per-word режим — делегируем отдельной функции, она сама
    // рисует каждое слово/букву через AnimModes из physics-and-anim.js.
    if (_PER_WORD_MODES.has(effect)
        && typeof AnimModes !== 'undefined'
        && typeof SpringPhysics !== 'undefined'
        && typeof AnimModes[effect] === 'function') {
      _drawTextOverlayPerWord(ctx, ov, cw, ch, bands, t, effect,
                              fontSize, font, weight, style, scaleRef,
                              lines, baseX, baseY, amt);
      ctx.restore();
      return;
    }

    let offX = 0, offY = 0, scaleX = 1, scaleY = 1, rotation = 0;
    // Для scroll_*-режимов: смещение дубликата для бесшовного wrap
    let scrollDupeDx = 0, scrollDupeDy = 0;

    switch (effect) {
      case 'sway':
        offX = Math.sin(t * 1.4) * bands.mid  * amt * 70 + Math.sin(t * 2.3) * bands.bass * amt * 30;
        offY = Math.sin(t * 1.0 + 1.5) * bands.bass * amt * 40 + Math.cos(t * 1.8) * bands.mid  * amt * 20;
        break;
      case 'pulse':
        scaleX = scaleY = 1 + bands.bass * amt * 0.40;
        break;
      case 'stretch':
        scaleX = 1 + bands.bass * amt * 0.35;
        scaleY = 1 - bands.bass * amt * 0.18;
        break;
      case 'float':
        offY = Math.sin(t * 0.85) * amt * 32 + Math.sin(t * 1.7) * amt * 12;
        break;
      case 'shake': {
        const intensity = bands.bass > 0.2 ? bands.bass : 0;
        offX = Math.sin(t * 97.3) * Math.cos(t * 43.1) * intensity * amt * 40;
        offY = Math.sin(t * 71.7) * Math.cos(t * 53.9) * intensity * amt * 20;
        break;
      }
      case 'bounce':
        offY = -Math.abs(Math.sin(t * 3.1 + bands.bass * 4)) * bands.bass * amt * 60;
        break;
      case 'spin':
        rotation = t * (0.6 + bands.mid * 3.5) * amt;
        break;
      // ── Новые эффекты v2 ────────────────────────────────────────────
      case 'zoom':
        scaleX = scaleY = 1 + bands.bass * amt * 0.55 + bands.mid * amt * 0.15;
        break;
      case 'breathe':
        scaleX = scaleY = 1 + Math.sin(t * 0.9) * amt * 0.12 + Math.sin(t * 2.3) * amt * 0.05;
        break;
      case 'glitch': {
        const g = bands.bass > 0.45 ? bands.bass : 0;
        offX = (Math.random() > 0.5 ? 1 : -1) * g * amt * 55;
        offY = (Math.random() > 0.7 ? 1 : -1) * g * amt * 20;
        scaleX = 1 + (Math.random() > 0.6 ? 1 : -1) * g * amt * 0.12;
        scaleY = 1 - g * amt * 0.06;
        break;
      }
      case 'orbit': {
        const radius = amt * 70;
        offX = Math.cos(t * 1.2) * radius;
        offY = Math.sin(t * 1.2) * radius * 0.55;
        break;
      }
      case 'pendulum':
        rotation = Math.sin(t * 1.6) * amt * 0.55 + Math.sin(t * 0.9) * bands.mid * amt * 0.35;
        break;
      case 'vortex':
        rotation = t * amt * 0.8;
        scaleX = scaleY = 1 + bands.bass * amt * 0.30;
        break;
      case 'heartbeat': {
        const hb = bands.bass;
        const beat = hb > 0.4 ? hb : 0;
        const echo = hb > 0.25 ? hb * 0.45 : 0;
        scaleX = scaleY = 1 + beat * amt * 0.50 + echo * amt * 0.20;
        offY = -beat * amt * 22;
        break;
      }
      case 'drift': {
        offX = Math.sin(t * 0.4) * amt * 55 + Math.sin(t * 1.1) * bands.mid * amt * 18;
        offY = Math.cos(t * 0.55) * amt * 35 + Math.cos(t * 1.3) * bands.bass * amt * 14;
        break;
      }
      // ── Адаптации режимов текста лирики ──────────────────────────
      case 'cinematic': {
        const scBase = 1 + bands.overall * amt * 0.25;
        scaleX = scaleY = scBase;
        offX = (Math.sin(t * 1.3) * 0.4 + Math.sin(t * 2.7) * 0.3) * (1 + bands.bass * 2) * amt * 20;
        offY = (Math.cos(t * 1.1) * 0.3 + Math.cos(t * 2.3) * 0.2) * (1 + bands.bass * 2) * amt * 18;
        rotation = Math.sin(t * 0.9) * amt * 0.015;
        break;
      }
      case 'flash': {
        const f = bands.bass > 0.35 ? bands.bass : 0;
        scaleX = scaleY = 1 + f * amt * 0.75;
        break;
      }
      case 'impact': {
        const hit = bands.bass > 0.3 ? bands.bass : 0;
        scaleX = 1 + hit * amt * 0.35;
        scaleY = 1 - hit * amt * 0.18;
        const sh = hit * amt * 30;
        offX = Math.sin(t * 87.1) * sh;
        offY = Math.cos(t * 91.7) * sh * 0.6;
        break;
      }
      case 'parallax': {
        const depth = 1 + bands.bass * amt * 0.22 + bands.mid * amt * 0.08;
        scaleX = scaleY = depth;
        offX = Math.sin(t * 0.35) * amt * 40 + Math.sin(t * 0.9) * bands.mid * amt * 14;
        offY = Math.cos(t * 0.45) * amt * 25 + Math.cos(t * 1.05) * bands.bass * amt * 10;
        rotation = Math.sin(t * 0.55) * amt * 0.025;
        break;
      }
      case 'path': {
        const freq = 0.9;
        offX = Math.sin(t * freq) * amt * 90;
        offY = Math.sin(t * freq * 2 + 0.7) * amt * (28 + bands.mid * 40);
        rotation = Math.cos(t * freq) * amt * 0.12;
        break;
      }
      // ── Scroll-режимы: непрерывная прокрутка текста ──────────────
      case 'scroll_left': {
        const speed = (amt * 150 + bands.overall * amt * 120);
        const wrapW = cw * 0.75;
        offX = -((t * speed) % wrapW);
        scrollDupeDx = wrapW;
        break;
      }
      case 'scroll_right': {
        const speed = (amt * 150 + bands.overall * amt * 120);
        const wrapW = cw * 0.75;
        offX = ((t * speed) % wrapW);
        scrollDupeDx = -wrapW;
        break;
      }
      case 'scroll_up': {
        const speed = (amt * 120 + bands.overall * amt * 90);
        const wrapH = ch * 0.75;
        offY = -((t * speed) % wrapH);
        scrollDupeDy = wrapH;
        break;
      }
      case 'scroll_down': {
        const speed = (amt * 120 + bands.overall * amt * 90);
        const wrapH = ch * 0.75;
        offY = ((t * speed) % wrapH);
        scrollDupeDy = -wrapH;
        break;
      }
      case 'scroll_diag_dr': {
        const speed = (amt * 130 + bands.overall * amt * 100);
        const wrapW = cw * 0.75;
        const wrapH = ch * 0.6;
        offX = ((t * speed) % wrapW);
        offY = ((t * speed * 0.6) % wrapH);
        scrollDupeDx = -wrapW;
        scrollDupeDy = -wrapH;
        break;
      }
      case 'scroll_diag_ul': {
        const speed = (amt * 130 + bands.overall * amt * 100);
        const wrapW = cw * 0.75;
        const wrapH = ch * 0.6;
        offX = -((t * speed) % wrapW);
        offY = -((t * speed * 0.6) % wrapH);
        scrollDupeDx = wrapW;
        scrollDupeDy = wrapH;
        break;
      }
    }

    // Измеряем текст один раз (нужно для рамки)
    let maxW = 0;
    lines.forEach(ln => {
      const m = ctx.measureText(ln);
      if (m.width > maxW) maxW = m.width;
    });

    // Лямбда: рисует ОДИН экземпляр текстового overlay в (baseX+offX+addX, baseY+offY+addY)
    const renderOnce = (addX, addY) => {
      ctx.save();
      ctx.translate(baseX + offX + addX, baseY + offY + addY);
      if (rotation) ctx.rotate(rotation);
      if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);

      // Рамка
      if (ov.boxStyle && typeof BoxRegistry !== 'undefined') {
        const boxDef = BoxRegistry.get(ov.boxStyle);
        if (boxDef) {
          const padH = fontSize * 0.35;
          const padV = fontSize * 0.25;
          const bx = -maxW / 2 - padH;
          const by = -totalH / 2 - padV;
          const bw = maxW + padH * 2;
          const bh = totalH + padV * 2;
          BoxRegistry.draw(ctx, {[ov.boxStyle]: true}, bx, by, bw, bh, ov.color, t);
        }
      }

      // Тень
      if (ov.shadowEnabled && ov.shadowColor && ov.shadowBlur > 0) {
        ctx.shadowColor = ov.shadowColor;
        ctx.shadowBlur  = ov.shadowBlur * scaleRef;
      }

      // Обводка
      const hasStroke = ov.strokeEnabled && ov.strokeColor && ov.strokeWidth > 0;
      if (hasStroke) {
        ctx.strokeStyle = ov.strokeColor;
        ctx.lineWidth   = ov.strokeWidth * scaleRef;
        ctx.lineJoin    = 'round';
        ctx.miterLimit  = 2;
      }
      ctx.fillStyle = ov.color || '#ffffff';

      const startY = -totalH / 2 + lineGap / 2;
      lines.forEach((ln, i) => {
        const y = startY + i * lineGap;
        if (hasStroke) ctx.strokeText(ln, 0, y);
        ctx.fillText(ln, 0, y);
      });

      ctx.restore();
    };

    renderOnce(0, 0);
    if (scrollDupeDx !== 0 || scrollDupeDy !== 0) {
      renderOnce(scrollDupeDx, scrollDupeDy);
    }

    ctx.restore();
  }

  // Утилита: вычислить ширину/высоту текстового оверлея в пикселях канваса.
  // Нужна для хит-теста (drag&drop) и предпросмотра.
  function measureTextOverlay(ov, cw, ch) {
    if (!ov || ov.type !== 'text') return { w: 0, h: 0 };
    const scaleRef = ch / 1080;
    const fontSize = Math.max(4, (ov.fontSize || 64) * scaleRef);
    const weight = ov.bold   ? '700'    : '400';
    const style  = ov.italic ? 'italic' : 'normal';
    const font   = ov.font || "'Bebas Neue', cursive";

    // Используем off-screen canvas для измерения (не трогаем текущий ctx)
    if (!measureTextOverlay._c) {
      measureTextOverlay._c   = document.createElement('canvas');
      measureTextOverlay._ctx = measureTextOverlay._c.getContext('2d');
    }
    const mctx = measureTextOverlay._ctx;
    mctx.font = `${style} ${weight} ${fontSize}px ${font}`;

    const text  = (ov.text == null ? '' : String(ov.text));
    const lines = text.split('\n');
    let maxW = 0;
    for (const ln of lines) {
      const m = mctx.measureText(ln);
      if (m.width > maxW) maxW = m.width;
    }
    const lineGap = fontSize * 1.15;
    const h = lineGap * Math.max(1, lines.length);
    return { w: maxW, h };
  }

  // Временный canvas для изоляции overlay (создаётся один раз)
  let tempOverlayCanvas = null;
  let tempOverlayCtx = null;

  function ensureTempCanvas(w, h) {
    if (!tempOverlayCanvas || tempOverlayCanvas.width !== w || tempOverlayCanvas.height !== h) {
      tempOverlayCanvas = document.createElement('canvas');
      tempOverlayCanvas.width = w;
      tempOverlayCanvas.height = h;
      tempOverlayCtx = tempOverlayCanvas.getContext('2d');
    }
    return { canvas: tempOverlayCanvas, ctx: tempOverlayCtx };
  }

  // Рисует все оверлеи нужного слоя (вызывается из App.js до и после TextRenderer)
  function drawOverlays(layer, ctx, cw, ch, bands, t, dt, activeLineIdx, currentLyric = null) {
    const dtSafe = Math.min(Math.max(dt, 0.001), 0.05);
    
    overlays.forEach(ov => {
      if (!ov.enabled) return;
      
      // Определяем слой для этого объекта на текущей строке
      let effectiveLayer = ov.layer;
      if (currentLyric && currentLyric.lineStyle && currentLyric.lineStyle.layer) {
        effectiveLayer = currentLyric.lineStyle.layer;
      }
      
      // Проверяем соответствие слоя
      if (effectiveLayer !== layer) return;
      
      // Определяем эффект для этого объекта на текущей строке.
      // Приоритет: ov.lineAnimations[activeLineIdx] (per-object, per-line)
      // → ov.effect (глобальный для объекта)
      // Старый {LOVFX} в lineStyle строки намеренно ИГНОРИРУЕТСЯ:
      // он применялся ко всем объектам сразу, что было багом.
      let effectiveEffect = ov.effect || 'static';
      if (ov.lineAnimations && activeLineIdx >= 0 && ov.lineAnimations[activeLineIdx]) {
        effectiveEffect = ov.lineAnimations[activeLineIdx];
      }
      
      // Определяем, должен ли объект быть видимым
      let shouldBeVisible = false;
      
      if (ov.scope === 'global') {
        shouldBeVisible = true;
      } else if (ov.scope === 'timeline') {
        // activeLineIdx === -1 означает "воспроизведение ещё не началось" —
        // считаем НЕ видимым, но НЕ трогаем fadeAlpha пока не запустилось (t === 0)
        if (activeLineIdx >= 0) {
          if (ov.selectedLines && ov.selectedLines.length > 0) {
            shouldBeVisible = ov.selectedLines.includes(activeLineIdx);
          } else {
            shouldBeVisible = activeLineIdx >= ov.startLine && activeLineIdx <= ov.endLine;
          }
        }
        // При activeLineIdx === -1 shouldBeVisible остаётся false,
        // но мы не начинаем fade out пока не началось воспроизведение
      }
      
      // Обновляем fadeAlpha
      const FADE_SPEED = ov.fadeSpeed || 2.5;
      if (ov.scope === 'global') {
        // Global: плавный fade-in при первом появлении, затем остаётся на 1
        ov.fadeTarget = 1;
        if (ov.fadeAlpha < 1) {
          ov.fadeAlpha = Math.min(1, ov.fadeAlpha + FADE_SPEED * dtSafe);
        }
      } else {
        if (shouldBeVisible) {
          // Появление — плавный fade in
          ov.fadeTarget = 1;
          if (ov.fadeAlpha < 1) {
            ov.fadeAlpha = Math.min(1, ov.fadeAlpha + FADE_SPEED * dtSafe);
          }
        } else if (activeLineIdx >= 0) {
          // Исчезновение — плавный fade out, но только когда плей уже идёт
          ov.fadeTarget = 0;
          if (ov.fadeAlpha > 0) {
            ov.fadeAlpha = Math.max(0, ov.fadeAlpha - FADE_SPEED * dtSafe);
          }
        }
        // При activeLineIdx === -1 (до старта / после стопа) — не трогаем fadeAlpha
      }
      
      // Не рисуем если полностью прозрачный
      if (ov.fadeAlpha < 0.01) return;
      
      // КРИТИЧНО: Гарантируем что opacity и fadeAlpha валидны
      const finalOpacity = Math.max(0, Math.min(1, ov.opacity || 1));
      const finalFadeAlpha = Math.max(0, Math.min(1, ov.fadeAlpha || 1));
      const finalAlpha = finalOpacity * finalFadeAlpha;
      
      // РАДИКАЛЬНОЕ РЕШЕНИЕ: Рисуем на временном canvas с полной непрозрачностью
      const { canvas: tempCanvas, ctx: tempCtx } = ensureTempCanvas(cw, ch);
      
      // Очищаем временный canvas
      tempCtx.clearRect(0, 0, cw, ch);
      
      // КРИТИЧНО: Сбрасываем все трансформации
      tempCtx.setTransform(1, 0, 0, 1, 0, 0);
      
      // Рисуем overlay на временном canvas с полной непрозрачностью
      tempCtx.save();
      tempCtx.globalAlpha = 1;
      tempCtx.globalCompositeOperation = 'source-over';
      tempCtx.filter = 'none';
      tempCtx.shadowBlur = 0;
      tempCtx.shadowColor = 'transparent';
      _drawOverlayItem(tempCtx, ov, cw, ch, bands, t, effectiveEffect, dt);
      tempCtx.restore();
      
      // КРИТИЧНО: Снова сбрасываем трансформации после отрисовки
      tempCtx.setTransform(1, 0, 0, 1, 0, 0);
      
      // Копируем с временного canvas на основной с нужной прозрачностью
      ctx.save();
      ctx.globalAlpha = finalAlpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
    });
  }

  // ── drawOverlaysAll: два прохода — сначала 'below', потом текст, потом 'above' ──────────
  // Порядок внутри каждой группы сохраняется (порядок массива).
  // Per-line lyric override (currentLyric.lineStyle.layer):
  //   'above' → текст рисуем ДО всех объектов (все объекты выше текста)
  //   'below' → текст рисуем ПОСЛЕ всех объектов (все объекты ниже текста)
  //   null    → стандартно: 'below'-объекты, текст, 'above'-объекты
  function drawOverlaysAll(ctx, cw, ch, bands, t, dt, activeLineIdx, currentLyric, drawTextCb) {
    const dtSafe = Math.min(Math.max(dt, 0.001), 0.05);

    const lyricLayerOverride = currentLyric && currentLyric.lineStyle && currentLyric.lineStyle.layer;

    function _renderOv(ov) {
      if (!ov.enabled) return;

      let effectiveEffect = ov.effect || 'static';
      if (ov.lineAnimations && activeLineIdx >= 0 && ov.lineAnimations[activeLineIdx]) {
        effectiveEffect = ov.lineAnimations[activeLineIdx];
      }

      let shouldBeVisible = false;
      if (ov.scope === 'global') {
        shouldBeVisible = true;
      } else if (ov.scope === 'timeline') {
        if (activeLineIdx >= 0) {
          if (ov.selectedLines && ov.selectedLines.length > 0) {
            shouldBeVisible = ov.selectedLines.includes(activeLineIdx);
          } else {
            shouldBeVisible = activeLineIdx >= ov.startLine && activeLineIdx <= ov.endLine;
          }
        }
      }

      const FADE_SPEED = ov.fadeSpeed || 2.5;
      if (ov.scope === 'global') {
        ov.fadeTarget = 1;
        if (ov.fadeAlpha < 1) ov.fadeAlpha = Math.min(1, ov.fadeAlpha + FADE_SPEED * dtSafe);
      } else {
        if (shouldBeVisible) {
          ov.fadeTarget = 1;
          if (ov.fadeAlpha < 1) ov.fadeAlpha = Math.min(1, ov.fadeAlpha + FADE_SPEED * dtSafe);
        } else if (activeLineIdx >= 0) {
          ov.fadeTarget = 0;
          if (ov.fadeAlpha > 0) ov.fadeAlpha = Math.max(0, ov.fadeAlpha - FADE_SPEED * dtSafe);
        }
      }

      if (ov.fadeAlpha < 0.01) return;

      const finalAlpha = Math.max(0, Math.min(1, (ov.opacity || 1) * (ov.fadeAlpha || 1)));
      const { canvas: tempCanvas, ctx: tempCtx } = ensureTempCanvas(cw, ch);
      tempCtx.clearRect(0, 0, cw, ch);
      tempCtx.setTransform(1, 0, 0, 1, 0, 0);
      tempCtx.save();
      tempCtx.globalAlpha = 1;
      tempCtx.globalCompositeOperation = 'source-over';
      tempCtx.filter = 'none';
      tempCtx.shadowBlur = 0;
      tempCtx.shadowColor = 'transparent';
      _drawOverlayItem(tempCtx, ov, cw, ch, bands, t, effectiveEffect, dt);
      tempCtx.restore();
      tempCtx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.globalAlpha = finalAlpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
    }

    const _drawText = () => { if (typeof drawTextCb === 'function') drawTextCb(); };
    const _renderAll = () => {
      for (let i = 0; i < overlays.length; i++) _renderOv(overlays[i]);
    };

    // Все оверлеи рендерятся строго в порядке массива (единая иерархия).
    // ov.layer на рендер НЕ влияет — это отдельный флаг лирики.
    // Позиция текста определяется ТОЛЬКО кнопкой лирики (lyricLayerOverride):
    //   'above' = "объекты выше текста" → текст ДО всех объектов (текст внизу)
    //   'below' = "объекты ниже текста" → текст ПОСЛЕ всех объектов (текст сверху)
    //   default → текст сверху (на всех объектах)
    if (lyricLayerOverride === 'above') {
      _drawText();
      _renderAll();
    } else {
      _renderAll();
      _drawText();
    }
  }

  // ── Безопасная зона для лирики (внутренняя область кадра/рамок) ──────────
  // Возвращает прямоугольник {x,y,w,h} в пикселях холста, внутри которого
  // текст гарантированно не наезжает на линии рамки и её декор.
  // Учитываются все включённые и видимые frame-оверлеи (берётся пересечение).
  // Если рамок нет — возвращается весь холст.
  function getTextSafeArea(cw, ch) {
    let left = 0, top = 0, right = cw, bottom = ch;

    for (let i = 0; i < overlays.length; i++) {
      const ov = overlays[i];
      if (!ov || !ov.enabled || ov.type !== 'frame') continue;
      // Рамка полностью выцвела (scope=timeline вне диапазона) — не ограничивает текст
      if ((ov.fadeAlpha || 0) < 0.05 || (ov.opacity != null && ov.opacity < 0.05)) continue;
      const styleId = ov.frameStyle;
      if (styleId === 'none' || styleId === '') continue;

      // Те же величины, что и в FrameDrawEngine.draw
      const pad = (ov.framePad ?? 0) / 100;
      const th  = (ov.frameThickness ?? 3) * (ch / 1080);
      const mg  = Math.min(cw, ch) * pad;
      // Отступ внутрь: сама линия рамки + запас на её декор (углы, скобки, точки)
      const inset = mg + th * 3 + Math.min(cw, ch) * 0.035;

      left   = Math.max(left,   inset);
      top    = Math.max(top,    inset);
      right  = Math.min(right,  cw - inset);
      bottom = Math.min(bottom, ch - inset);
    }

    // Защита от вырожденной зоны (очень толстая рамка / большой framePad)
    const minW = cw * 0.30, minH = ch * 0.20;
    if (right - left < minW) {
      const c = cw / 2; left = c - minW / 2; right = c + minW / 2;
    }
    if (bottom - top < minH) {
      const c = ch / 2; top = c - minH / 2; bottom = c + minH / 2;
    }

    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  // ── Offscreen буфер для chromatic ───────────
  let offscreen = null, offCtx = null;

  /* ─────────────────────────────────────────────
     Сеттеры
  ───────────────────────────────────────────── */
  function setFX(name, val) { fx[name] = val; }

  // setCamParam('zoom', 'enabled', true)
  // setCamParam('scrollX', 'speed', 0.08)
  function setCamParam(group, key, val) {
    if (cam[group] !== undefined) cam[group][key] = val;
  }

  // Сброс позиции прокрутки и KB при старте/стопе
  function resetCamera() {
    cam.scrollX.position = 0;
    cam.scrollY.position = 0;
    kb.x = 0; kb.y = 0;
    kb.vx = 0.0003; kb.vy = 0.0002;
    
    // Сбрасываем spring музыкального зума
    if (musicZoomSpring) {
      musicZoomSpring.reset(0);
    }
    if (musicZoomTransitionSpring) {
      musicZoomTransitionSpring.reset(0);
    }
    _musicZoomBassSmooth = 0;
    
    // Сбрасываем spring letterbox bass
    if (letterboxBassSpring) {
      letterboxBassSpring.reset(0);
    }
    
    // Сбрасываем состояние эффектов
    bgState.darken = false;
    bgState.brighten = false;
    bgState.blur = false;
    
    // Сбрасываем переходы
    bgTransitions.darkenAmount = 0;
    bgTransitions.brightenAmount = 0;
    bgTransitions.blurAmount = 0;
    bgTransitions.letterboxAmount = 0;
    
    // Сбрасываем состояние FX
    fx.letterbox = false;
    fx.letterboxReactive = false;
    
    // Сбрасываем состояние камеры
    cam.musicZoom.enabled = false;
    cam.scrollX.enabled = false;
    cam.scrollY.enabled = false;
    
    // Сбрасываем переходы камеры (scroll только, zoom через spring)
    camTransitions.scrollXAmount = 0;
    camTransitions.scrollYAmount = 0;

    // Сбрасываем text-driven camera (montage и пр.)
    textCam.zoomMul = 1;
    textCam.panX    = 0;
    textCam.panY    = 0;
    textCam._decay  = 0;
    
    // Сбрасываем fadeAlpha у timeline-оверлеев чтобы они не мелькали при повторном старте
    overlays.forEach(ov => {
      if (ov.scope === 'timeline') {
        ov.fadeAlpha  = 0;
        ov.fadeTarget = 0;
      }
    });

    // Сбрасываем per-line scene
    lineScene.active = false;
    lineScene.blend  = 0;
  }

  /* ─────────────────────────────────────────────
     Обработчик команд из LRC (через App.js)
  ───────────────────────────────────────────── */
  function applyBackgroundCommand(cmd) {
    // ── Фоновые команды ──────────────────────
    if (cmd.type === 'darken')   {
      bgState.darken = cmd.value;
      if (cmd.value) bgState.brighten = false;
    }
    if (cmd.type === 'brighten') {
      bgState.brighten = cmd.value;
      if (cmd.value) bgState.darken = false;
    }
    if (cmd.type === 'blur') { bgState.blur = cmd.value; }
    
    if (cmd.type === 'letterbox') {
      fx.letterbox = cmd.value;
      // OFF леттербокса автоматически гасит реактивный режим.
      if (!cmd.value) fx.letterboxReactive = false;
    }
    if (cmd.type === 'letterboxReactive') {
      fx.letterboxReactive = cmd.value;
      // ON реактивного режима подразумевает, что полосы видны.
      if (cmd.value) fx.letterbox = true;
    }

    // ── Камера: музыкальный зум ───────────────
    if (cmd.type === 'zoomIn')   { cam.musicZoom.enabled = true;  cam.musicZoom.invert = false; }
    if (cmd.type === 'zoomOut')  { cam.musicZoom.enabled = true;  cam.musicZoom.invert = true;  }
    if (cmd.type === 'zoomStop') { cam.musicZoom.enabled = false; }
    // Per-line сила музыкального зума (override на длительность строки)
    if (cmd.type === 'zoomAmount' && cmd.value != null) {
      cam.musicZoom.amount = Math.max(0.05, Math.min(2.0, +cmd.value));
    }

    // ── Камера: прокрутка ─────────────────────
    if (cmd.type === 'scrollLeft')  { cam.scrollX.enabled = true;  cam.scrollX.direction = -1; }
    if (cmd.type === 'scrollRight') { cam.scrollX.enabled = true;  cam.scrollX.direction =  1; }
    if (cmd.type === 'scrollUp')    { cam.scrollY.enabled = true;  cam.scrollY.direction = -1; }
    if (cmd.type === 'scrollDown')  { cam.scrollY.enabled = true;  cam.scrollY.direction =  1; }
    if (cmd.type === 'scrollStop')  {
      cam.scrollX.enabled = false;
      cam.scrollY.enabled = false;
    }

    // ── Камера: полный сброс ──────────────────
    if (cmd.type === 'cameraReset') {
      cam.scrollX.enabled  = false; cam.scrollX.position = 0;
      cam.scrollY.enabled  = false; cam.scrollY.position = 0;
      cam.musicZoom.enabled = false;
    }
  }

  /* ─────────────────────────────────────────────
     Загрузка медиа
  ───────────────────────────────────────────── */
  async function load(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      if (file.type.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.src = url; vid.loop = true; vid.muted = true; vid.playsInline = true;
        vid.onloadeddata = () => { media = vid; mediaType = 'video'; resolve('video'); };
        vid.onerror = reject;
      } else {
        const img = new Image();
        img.onload  = () => { media = img; mediaType = 'image'; resolve('image'); };
        img.onerror = reject;
        img.src = url;
      }
    });
  }

  function playVideo()  { if (mediaType === 'video' && media) media.play().catch(() => {}); }
  function stopVideo()  { if (mediaType === 'video' && media) { media.pause(); media.currentTime = 0; } }
  function pauseVideo() { if (mediaType === 'video' && media) media.pause(); }

  function ensureOffscreen(w, h) {
    if (!offscreen || offscreen.width !== w || offscreen.height !== h) {
      offscreen = document.createElement('canvas');
      offscreen.width = w; offscreen.height = h;
      offCtx = offscreen.getContext('2d');
    }
  }

  /* ─────────────────────────────────────────────
     Основной рендер медиа (вызывается каждый кадр)
     dt — delta-time в секундах (передаётся из App.js)
  ───────────────────────────────────────────── */
  function drawMedia(ctx, cw, ch, bands, t, dt) {
    if (!media) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      return;
    }

    const mw = mediaType === 'video' ? media.videoWidth  : media.naturalWidth;
    const mh = mediaType === 'video' ? media.videoHeight : media.naturalHeight;
    if (!mw || !mh) return;

    // ── Cover-fit базовый масштаб ────────────────
    const coverScale = Math.max(cw / mw, ch / mh);

    // ══ ЗУМ ══════════════════════════════════════
    // 1. База: статичный зум (если включён) или Ken Burns база
    let zoom = cam.zoom.enabled ? cam.zoom.value : kb.scale;

    // 2. Ken Burns breathing (только если нет статичного зума И нет музыкального зума)
    if (fx.kenBurns && !cam.zoom.enabled && musicZoomTransitionSpring && musicZoomTransitionSpring.value < 0.5) {
      // Плавно убираем KB-дыхание по мере нарастания musicZoom
      const kbFade = 1 - musicZoomTransitionSpring.value * 2;
      zoom += (bands.bass * 0.03 + Math.sin(t * 0.21) * 0.015) * kbFade;
    }

    // 3. Музыкальный зум — реакция на бас
    //
    // Принципы (Attack/Release как в аудио-компрессоре):
    //  - Быстрая атака (40ms) — мгновенная реакция на бит
    //  - Медленный релиз (220ms) — плавное затухание без дёрганья
    //  - Spring overdamped (k=0.08, d=0.85) — сглаживает без колебаний
    //  - Spring для включения/выключения (k=0.12, d=0.88) — плавный fade in/out
    //  - Максимальная амплитуда ±0.12 при amount=0.4 (ощутимый зум)
    //  - Направление: zoomIn = положительно, zoomOut = отрицательно
    //  - Базовый зум 0.15 + реакция на бас
    
    // Обновляем spring перехода включения/выключения
    ensureMusicZoomTransitionSpring();
    musicZoomTransitionSpring.target = cam.musicZoom.enabled ? 1 : 0;
    musicZoomTransitionSpring.update(dt);
    const transitionAmount = musicZoomTransitionSpring.value;
    
    if (transitionAmount > 0.001) {
      ensureMusicZoomSpring();

      // Базовый зум когда включён музыкальный зум — увеличен для видимого качания
      const baseZoomOffset = 0.35;

      // Attack/Release LP-фильтр баса: очень быстрая атака для чётких битов, медленный релиз
      // Это НЕ зависит от FPS, одинаково работает в реалтайме и при экспорте
      const isAttack = bands.bass > _musicZoomBassSmooth;
      const TAU_BASS = isAttack ? 0.018 : 0.25; // 18ms атака (почти мгновенно), 250ms релиз
      const bassAlpha = 1 - Math.exp(-Math.max(dt, 0.001) / TAU_BASS);
      _musicZoomBassSmooth += (bands.bass - _musicZoomBassSmooth) * bassAlpha;

      // DEBUG: Выводим каждые 30 кадров
      if (typeof window !== 'undefined' && window._debugZoomFrame === undefined) window._debugZoomFrame = 0;
      if (typeof window !== 'undefined') {
        window._debugZoomFrame++;
        // Debug zoom logging disabled
      }

      // Амплитуда реакции: максимальная для мощных битов
      // Диапазон ползунка 0.1–1.5 → зум от ~0.32 до ~4.8
      const maxAmp = 1.28 * (cam.musicZoom.amount / 0.4);
      const dir    = cam.musicZoom.invert ? -1 : 1;
      const target = dir * _musicZoomBassSmooth * maxAmp * transitionAmount;

      musicZoomSpring.target = target;
      musicZoomSpring.update(dt);

      // Базовый зум + качание от баса
      zoom += baseZoomOffset * transitionAmount + musicZoomSpring.value;
    } else if (musicZoomSpring && Math.abs(musicZoomSpring.value) > 0.0005) {
      // Плавно гасим spring когда зум выключается
      musicZoomSpring.target = 0;
      musicZoomSpring.update(dt);
      zoom += musicZoomSpring.value;
    } else if (musicZoomSpring) {
      musicZoomSpring.reset(0);
      _musicZoomBassSmooth = 0;
    }

    // Гарантируем минимум — изображение всегда покрывает холст
    zoom = Math.max(1.0, zoom);

    // ══ TEXT-DRIVEN CAMERA OVERRIDE ══════════════
    // Анимация текста (montage и пр.) управляет зумом/паном фона через
    // setTextDrivenCamera(). Здесь применяем накопленное значение с
    // плавным decay: когда источник перестал звать, эффект за 150мс
    // возвращается к нейтралу (zoomMul=1, pan=0).
    //
    // k — текущая "сила" эффекта (0..1). При активном источнике _decay=1.
    // _decay списывается КАЖДЫЙ кадр на dt/0.15; если источник снова звал
    // setTextDrivenCamera() — _decay опять = 1 (в setTextDrivenCamera).
    let textPanX = 0, textPanY = 0;
    if (textCam._decay > 0) {
      const k = textCam._decay;
      // LERP от нейтрала к override. Когда k=1 — полный эффект,
      // когда k→0 — плавное возвращение к zoom × 1.
      const effectiveZoomMul = 1 + (textCam.zoomMul - 1) * k;
      zoom *= effectiveZoomMul;
      zoom = Math.max(1.0, zoom);
      textPanX = textCam.panX * k;
      textPanY = textCam.panY * k;
      // Списываем decay — на следующем кадре эффект будет слабее если
      // источник не позвал setTextDrivenCamera() повторно.
      textCam._decay -= Math.max(dt, 0.001) / 0.15;
      if (textCam._decay < 0) textCam._decay = 0;
    }

    // Итоговый размер (вычисляем один раз)
    const totalScale = coverScale * zoom;
    const drawW = mw * totalScale;
    const drawH = mh * totalScale;

    // ══ ПАН ══════════════════════════════════════
    // Ken Burns auto-pan — работает только для осей без ручной прокрутки
    if (fx.kenBurns) {
      if (!cam.scrollX.enabled) {
        kb.x += kb.vx;
        if (Math.abs(kb.x) > 0.04) kb.vx *= -1;
      }
      if (!cam.scrollY.enabled) {
        kb.y += kb.vy;
        if (Math.abs(kb.y) > 0.04) kb.vy *= -1;
      }
    }

    // Ручная прокрутка — обновляем позиции в пикселях (с плавным переходом)
    if (camTransitions.scrollXAmount > 0.01 || camTransitions.scrollYAmount > 0.01) {
      if (camTransitions.scrollXAmount > 0.01) {
        // Скорость в пикселях в секунду, умноженная на силу перехода
        const speedPx = drawW * cam.scrollX.speed * camTransitions.scrollXAmount;
        const delta = cam.scrollX.direction * speedPx * dt;
        cam.scrollX.position += delta;
        // Зацикливаем по ширине изображения
        if (cam.scrollX.position < 0) cam.scrollX.position += drawW;
        cam.scrollX.position = cam.scrollX.position % drawW;
      }
      if (camTransitions.scrollYAmount > 0.01) {
        const speedPx = drawH * cam.scrollY.speed * camTransitions.scrollYAmount;
        cam.scrollY.position += cam.scrollY.direction * speedPx * dt;
        // Зацикливаем по высоте изображения
        if (cam.scrollY.position < 0) cam.scrollY.position += drawH;
        cam.scrollY.position = cam.scrollY.position % drawH;
      }
    }

    // Ken Burns пан (только для осей без прокрутки)
    let kbPanX = 0, kbPanY = 0;
    if (fx.kenBurns) {
      if (!cam.scrollX.enabled) {
        kbPanX = kb.x * (drawW - cw) * 0.5;
      }
      if (!cam.scrollY.enabled) {
        kbPanY = kb.y * (drawH - ch) * 0.5;
      }
    }

    // Text-driven pan (montage и пр.) — добавляется поверх kbPan.
    // Используем уже интерполированные значения textPanX/textPanY
    // (посчитаны выше с учётом decay). Инвертирован: если камера
    // "смотрит вправо", фон смещается влево.
    if (textCam._decay > 0 || textPanX !== 0 || textPanY !== 0) {
      kbPanX -= textPanX;
      kbPanY -= textPanY;
    }

    // Базовая позиция для центрирования
    const baseDx = (cw - drawW) / 2;
    const baseDy = (ch - drawH) / 2;

    // ══ ЦВЕТОКОРРЕКЦИЯ ════════════════════════════
    let filterParts = [];
    let bri = 100;

    // Для затемнения/осветления НЕ используем brightness-фильтр (он дает бандинг)
    // Вместо этого используем overlay в drawDarkenOverlay()
    if (fx.colorGrade) {
      // Только для colorGrade применяем brightness
      bri = 100 + bands.mid * 6;
      const sat = 100 + bands.bass * 30;
      const con = 100 + bands.bass * 5;
      filterParts.push(`saturate(${sat}%)`);
      filterParts.push(`brightness(${bri}%)`);
      filterParts.push(`contrast(${con}%)`);
    }

    // CSS blur заменён на multi-pass box blur через drawImage со смещениями.
    // CSS filter='blur()' в OffscreenCanvas при WebCodecs-экспорте даёт
    // пикселизацию на границах — VP9 кодирует края filter-буфера как артефакты.
    const needsBlur = bgTransitions.blurAmount > 0.001;

    ctx.filter = filterParts.length ? filterParts.join(' ') : 'none';
    ctx.save();
    
    // ── Вспомогательная функция: рисует медиа в нужное место ──
    const drawMediaFrame = (targetCtx) => {
      const needScrollX = camTransitions.scrollXAmount > 0.01;
      const needScrollY = camTransitions.scrollYAmount > 0.01;
      if (needScrollX || needScrollY) {
        const txMin = needScrollX ? -1 : 0;
        const txMax = needScrollX ?  1 : 0;
        const tyMin = needScrollY ? -1 : 0;
        const tyMax = needScrollY ?  1 : 0;
        const scrollOffsetX = needScrollX ? cam.scrollX.position : 0;
        const scrollOffsetY = needScrollY ? cam.scrollY.position : 0;
        for (let ty = tyMin; ty <= tyMax; ty++) {
          for (let tx = txMin; tx <= txMax; tx++) {
            const dx = baseDx - kbPanX + tx * drawW - scrollOffsetX;
            const dy = baseDy - kbPanY + ty * drawH - scrollOffsetY;
            targetCtx.drawImage(media, dx, dy, drawW, drawH);
          }
        }
      } else {
        targetCtx.drawImage(media, baseDx - kbPanX, baseDy - kbPanY, drawW, drawH);
      }
    };

    if (needsBlur) {
      // Multi-pass box blur: рисуем медиа на временный offscreen canvas,
      // затем накладываем его на основной несколько раз со смещением и
      // пониженной alpha — получаем аппроксимацию Gaussian без CSS filter.
      // Это 100% совместимо с WebCodecs и не даёт артефактов VP9.
      const blurPx = Math.round(8 * bgTransitions.blurAmount);
      const passes = 3;   // больше проходов = мягче, но медленнее
      const step   = blurPx / passes;
      const passA  = 1 / (passes * 2 + 1); // суммарная alpha = 1

      // Временный буфер для исходного кадра
      if (!BackgroundEngine._blurBuf ||
          BackgroundEngine._blurBuf.width  !== cw ||
          BackgroundEngine._blurBuf.height !== ch) {
        BackgroundEngine._blurBuf    = document.createElement('canvas');
        BackgroundEngine._blurBuf.width  = cw;
        BackgroundEngine._blurBuf.height = ch;
        BackgroundEngine._blurBufCtx = BackgroundEngine._blurBuf.getContext('2d');
      }
      const bc  = BackgroundEngine._blurBuf;
      const bcc = BackgroundEngine._blurBufCtx;
      bcc.clearRect(0, 0, cw, ch);
      // Применяем только colorGrade-фильтр на исходнике (без blur)
      bcc.filter = filterParts.length ? filterParts.join(' ') : 'none';
      drawMediaFrame(bcc);
      bcc.filter = 'none';

      // Сбрасываем filter на основном ctx (blur рисуем вручную)
      ctx.filter = 'none';
      // Центральный проход (полный вес)
      ctx.globalAlpha = passA;
      ctx.drawImage(bc, 0, 0);
      // Смещённые проходы
      for (let p = 1; p <= passes; p++) {
        const o = Math.round(step * p);
        ctx.globalAlpha = passA;
        ctx.drawImage(bc,  o,  0); ctx.drawImage(bc, -o,  0);
        ctx.drawImage(bc,  0,  o); ctx.drawImage(bc,  0, -o);
      }
      ctx.globalAlpha = 1;
    } else {
      // Без blur — обычный рендер
      drawMediaFrame(ctx);
    }
    
    ctx.restore();
    ctx.filter = 'none';
    ctx.globalAlpha = 1;

    // ── Per-line background overlay ──────────────
    // Рисуем поверх основного фона с плавным crossfade
    if (lineMedia && lineFadeAlpha > 0.01) {
      const lmw = lineMedia.naturalWidth;
      const lmh = lineMedia.naturalHeight;
      if (lmw && lmh) {
        const lScale = Math.max(cw / lmw, ch / lmh);
        const ldx = (cw - lmw * lScale) / 2;
        const ldy = (ch - lmh * lScale) / 2;
        ctx.save();
        ctx.globalAlpha = lineFadeAlpha;
        // Применяем тот же filter что и у основного фона
        if (filterParts.length) ctx.filter = filterParts.join(' ');
        ctx.drawImage(lineMedia, ldx, ldy, lmw * lScale, lmh * lScale);
        ctx.restore();
        ctx.filter = 'none';
      }
    }
  }

  // Радиальная виньетка
  function drawVignette(ctx, cw, ch, bands) {
    if (!fx.vignette) return;
    const innerR = Math.min(cw, ch) * (0.45 - bands.bass * 0.08);
    const outerR = Math.sqrt(cw * cw + ch * ch) / 2;
    const grad = ctx.createRadialGradient(cw/2, ch/2, innerR, cw/2, ch/2, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${0.55 + bands.bass * 0.2})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);
  }

  // Кинематографические черные полосы (letterbox)
  function drawLetterbox(ctx, cw, ch, bands, dt) {
    // Плавный переход на основе времени (не кадров)
    const targetAmount = (fx.letterbox || fx.letterboxReactive) ? 1 : 0;
    const transitionSpeed = 1.8; // единиц в секунду — медленнее для кинематографичности
    const step = transitionSpeed * (dt || 0.016);

    if (bgTransitions.letterboxAmount < targetAmount) {
      bgTransitions.letterboxAmount = Math.min(targetAmount, bgTransitions.letterboxAmount + step);
    } else if (bgTransitions.letterboxAmount > targetAmount) {
      bgTransitions.letterboxAmount = Math.max(targetAmount, bgTransitions.letterboxAmount - step);
    }

    if (bgTransitions.letterboxAmount < 0.001) return;

    // Smoothstep easing: плавное ускорение в начале и торможение в конце
    const t = bgTransitions.letterboxAmount;
    const eased = t * t * (3 - 2 * t);

    // Базовая высота полос (10% от высоты экрана)
    let barHeight = ch * 0.1;

    // Реактивный режим: полосы заметно пульсируют с басом.
    // Диапазон 7%..20% — явно видно что пульсирует, но текст не закрывается.
    if (fx.letterboxReactive) {
      ensureLetterboxBassSpring();
      const bassRaw = (bands && typeof bands.bass === 'number') ? bands.bass : 0;
      letterboxBassSpring.update(bassRaw, dt || 0.016);
      const bassSmooth = letterboxBassSpring.value;
      barHeight = ch * (0.07 + bassSmooth * 0.13);
    }

    const actualHeight = barHeight * eased;

    // Рисуем полосы с мягким внутренним градиентом для плавного края
    const gradH = Math.max(4, actualHeight * 0.25); // высота мягкого края

    // Верхняя полоса
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, actualHeight - gradH);
    const gradTop = ctx.createLinearGradient(0, actualHeight - gradH, 0, actualHeight);
    gradTop.addColorStop(0, 'rgba(0,0,0,1)');
    gradTop.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradTop;
    ctx.fillRect(0, actualHeight - gradH, cw, gradH);

    // Нижняя полоса
    const yBot = ch - actualHeight;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, yBot + gradH, cw, actualHeight - gradH);
    const gradBot = ctx.createLinearGradient(0, yBot, 0, yBot + gradH);
    gradBot.addColorStop(0, 'rgba(0,0,0,0)');
    gradBot.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradBot;
    ctx.fillRect(0, yBot, cw, gradH);
  }

  // Overlay для команд затемнения/осветления (с плавными переходами и dithering)
  function drawDarkenOverlay(ctx, cw, ch) {
    if (bgTransitions.darkenAmount > 0.001) {
      ctx.save();
      
      // Создаем градиент с dithering для устранения бандинга
      const alpha = 0.7 * bgTransitions.darkenAmount; // увеличили с 0.65 до 0.7
      
      // Рисуем несколько слоев с небольшим смещением для сглаживания
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = alpha * 0.4;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, cw, ch);
      
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillRect(0, 0, cw, ch);
      
      ctx.globalAlpha = alpha * 0.3;
      ctx.fillRect(0, 0, cw, ch);
      
      ctx.restore();
    } else if (bgTransitions.brightenAmount > 0.001) {
      ctx.save();
      
      // Осветление через screen blend mode
      const alpha = 0.2 * bgTransitions.brightenAmount;
      
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillRect(0, 0, cw, ch);
      
      ctx.restore();
    }
  }

  // Хроматическое расщепление
  function drawChromaticPass(ctx, cw, ch, bands, t, dt) {
    if (!fx.chromatic || bands.high < 0.05) return;
    ensureOffscreen(cw, ch);
    const offset = bands.high * 4;
    offCtx.clearRect(0, 0, cw, ch);
    drawMedia(offCtx, cw, ch, bands, t, dt);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.5; ctx.drawImage(offscreen, -offset, 0);
    ctx.globalAlpha = 0.5; ctx.drawImage(offscreen,  offset, 0);
    ctx.restore();
  }

  /* ─────────────────────────────────────────────
     Главная функция — вызывается каждый кадр из App.js
     draw(ctx, cw, ch, bands, t, dt)
  ───────────────────────────────────────────── */
  function draw(ctx, cw, ch, bands, t, dt = 0) {
    // Обновляем fade per-line bg каждый кадр
    if (lineFadeAlpha !== lineFadeTarget) {
      const step = LINE_FADE_SPD * Math.max(dt, 0.001);
      if (lineFadeAlpha < lineFadeTarget) {
        lineFadeAlpha = Math.min(lineFadeTarget, lineFadeAlpha + step);
      } else {
        lineFadeAlpha = Math.max(lineFadeTarget, lineFadeAlpha - step);
        if (lineFadeAlpha <= 0) lineMedia = null;
      }
    }

    // Обновляем плавные переходы эффектов
    const dtSafe = Math.max(dt, 0.001);
    const transitionStep = TRANSITION_SPEED * dtSafe;
    
    // Затемнение
    const darkenTarget = bgState.darken ? 1 : 0;
    if (Math.abs(bgTransitions.darkenAmount - darkenTarget) > 0.001) {
      if (bgTransitions.darkenAmount < darkenTarget) {
        bgTransitions.darkenAmount = Math.min(darkenTarget, bgTransitions.darkenAmount + transitionStep);
      } else {
        bgTransitions.darkenAmount = Math.max(darkenTarget, bgTransitions.darkenAmount - transitionStep);
      }
    }
    
    // Осветление
    const brightenTarget = bgState.brighten ? 1 : 0;
    if (Math.abs(bgTransitions.brightenAmount - brightenTarget) > 0.001) {
      if (bgTransitions.brightenAmount < brightenTarget) {
        bgTransitions.brightenAmount = Math.min(brightenTarget, bgTransitions.brightenAmount + transitionStep);
      } else {
        bgTransitions.brightenAmount = Math.max(brightenTarget, bgTransitions.brightenAmount - transitionStep);
      }
    }
    
    // Блюр
    const blurTarget = bgState.blur ? 1 : 0;
    if (bgTransitions.blurAmount < blurTarget) {
      bgTransitions.blurAmount = Math.min(blurTarget, bgTransitions.blurAmount + transitionStep);
    } else if (bgTransitions.blurAmount > blurTarget) {
      bgTransitions.blurAmount = Math.max(blurTarget, bgTransitions.blurAmount - transitionStep);
    }

    // Обновляем плавные переходы камеры
    const camTransitionStep = CAM_TRANSITION_SPEED * Math.max(dt, 0.001);
    
    // Музыкальный зум теперь управляется через spring (см. drawMedia)
    // camTransitions.musicZoomAmount больше не используется напрямую
    
    // Прокрутка X
    const scrollXTarget = cam.scrollX.enabled ? 1 : 0;
    if (camTransitions.scrollXAmount < scrollXTarget) {
      camTransitions.scrollXAmount = Math.min(scrollXTarget, camTransitions.scrollXAmount + camTransitionStep);
    } else if (camTransitions.scrollXAmount > scrollXTarget) {
      camTransitions.scrollXAmount = Math.max(scrollXTarget, camTransitions.scrollXAmount - camTransitionStep);
    }
    
    // Прокрутка Y
    const scrollYTarget = cam.scrollY.enabled ? 1 : 0;
    if (camTransitions.scrollYAmount < scrollYTarget) {
      camTransitions.scrollYAmount = Math.min(scrollYTarget, camTransitions.scrollYAmount + camTransitionStep);
    } else if (camTransitions.scrollYAmount > scrollYTarget) {
      camTransitions.scrollYAmount = Math.max(scrollYTarget, camTransitions.scrollYAmount - camTransitionStep);
    }

    if (fx.chromatic && bands.high > 0.05 && media) {
      drawChromaticPass(ctx, cw, ch, bands, t, dt);
    } else {
      drawMedia(ctx, cw, ch, bands, t, dt);
    }
    drawDarkenOverlay(ctx, cw, ch);
    drawVignette(ctx, cw, ch, bands);
    // Letterbox теперь рисуется отдельно после overlays
  }

  // Обновляет переходы и рисует оверлей затемнения/осветления.
  // Вызывается из App.js когда BackgroundManager заменяет BackgroundEngine.draw().
  function drawFxOverlay(ctx, cw, ch, dt) {
    const dtSafe = Math.max(dt, 0.001);
    const transitionStep = TRANSITION_SPEED * dtSafe;

    const darkenTarget = bgState.darken ? 1 : 0;
    if (Math.abs(bgTransitions.darkenAmount - darkenTarget) > 0.001) {
      if (bgTransitions.darkenAmount < darkenTarget) {
        bgTransitions.darkenAmount = Math.min(darkenTarget, bgTransitions.darkenAmount + transitionStep);
      } else {
        bgTransitions.darkenAmount = Math.max(darkenTarget, bgTransitions.darkenAmount - transitionStep);
      }
    }

    const brightenTarget = bgState.brighten ? 1 : 0;
    if (Math.abs(bgTransitions.brightenAmount - brightenTarget) > 0.001) {
      if (bgTransitions.brightenAmount < brightenTarget) {
        bgTransitions.brightenAmount = Math.min(brightenTarget, bgTransitions.brightenAmount + transitionStep);
      } else {
        bgTransitions.brightenAmount = Math.max(brightenTarget, bgTransitions.brightenAmount - transitionStep);
      }
    }

    const blurTarget = bgState.blur ? 1 : 0;
    if (bgTransitions.blurAmount < blurTarget) {
      bgTransitions.blurAmount = Math.min(blurTarget, bgTransitions.blurAmount + transitionStep);
    } else if (bgTransitions.blurAmount > blurTarget) {
      bgTransitions.blurAmount = Math.max(blurTarget, bgTransitions.blurAmount - transitionStep);
    }

    // Blur-оверлей: размываем всё что нарисовано до этой точки (фон),
    // текст будет отрисован сверху без размытия.
    if (bgTransitions.blurAmount > 0.001) {
      const blurPx = Math.round(8 * bgTransitions.blurAmount);
      const passes = 3;
      const step   = blurPx / passes;
      const passA  = 1 / (passes * 2 + 1);

      if (!BackgroundEngine._fxBlurBuf ||
          BackgroundEngine._fxBlurBuf.width  !== cw ||
          BackgroundEngine._fxBlurBuf.height !== ch) {
        BackgroundEngine._fxBlurBuf    = document.createElement('canvas');
        BackgroundEngine._fxBlurBuf.width  = cw;
        BackgroundEngine._fxBlurBuf.height = ch;
        BackgroundEngine._fxBlurBufCtx = BackgroundEngine._fxBlurBuf.getContext('2d');
      }
      const bc  = BackgroundEngine._fxBlurBuf;
      const bcc = BackgroundEngine._fxBlurBufCtx;

      // Снимаем текущее содержимое canvas на буфер
      bcc.clearRect(0, 0, cw, ch);
      bcc.drawImage(ctx.canvas, 0, 0);

      // Затираем фон и накладываем размытые копии со смещением
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = passA;
      ctx.drawImage(bc, 0, 0);
      for (let p = 1; p <= passes; p++) {
        const o = Math.round(step * p);
        ctx.drawImage(bc,  o,  0); ctx.drawImage(bc, -o,  0);
        ctx.drawImage(bc,  0,  o); ctx.drawImage(bc,  0, -o);
      }
      ctx.globalAlpha = 1;
    }

    drawDarkenOverlay(ctx, cw, ch);
  }

  // Отдельная функция для рисования letterbox (вызывается из App.js после overlays)
  function drawLetterboxLayer(ctx, cw, ch, bands, dt) {
    drawLetterbox(ctx, cw, ch, bands, dt);
  }

  // Принудительный сброс springs для экспорта (вызывается из ExportEngine)
  function _forceResetSprings() {
    // КРИТИЧНО: Пересоздаём springs с актуальными параметрами
    // Это гарантирует что экспорт использует те же параметры что и превью
    musicZoomSpring = new SpringPhysics({
      stiffness: 0.15,   // быстрее реагирует на биты
      damping:   0.82,   // overdamped — плавное затухание без колебаний
      initial:   0
    });
    
    musicZoomTransitionSpring = new SpringPhysics({
      stiffness: 0.12,   // плавное включение/выключение
      damping:   0.88,   // сильно overdamped — без колебаний
      initial:   0
    });
    
    letterboxBassSpring = new SpringPhysics({
      stiffness: 0.25,  // быстрая реакция
      damping: 0.65,    // хорошее сглаживание
      initial: 0
    });
    
    _musicZoomBassSmooth = 0;
    
    // Сбрасываем состояние Ken Burns
    kb.x = 0;
    kb.y = 0;
    kb.vx = 0.0003;
    kb.vy = 0.0002;
    kb.scale = 1.06;
    
    // Сбрасываем позиции прокрутки
    cam.scrollX.position = 0;
    cam.scrollY.position = 0;
  }

  return {
    load, draw, playVideo, stopVideo, pauseVideo,
    setFX, setCamParam, resetCamera, applyBackgroundCommand,
    setTextDrivenCamera, clearTextDrivenCamera,
    registerBgImage, setLineBackground, clearLineBackground,
    getBgImageUrl, getBgImageName,
    registerOverlay, registerTextOverlay, registerFrameOverlay, registerEffectOverlay, registerCardOverlay, replaceOverlayImage, duplicateOverlay, updateOverlay, removeOverlay, moveOverlay, drawOverlays, drawOverlaysAll,
    setCardBlockImage, rehydrateCardImageBlocks,
    _previewDrawCard: (ctx, ov, cw, ch, bands, t) => _drawCardComposition(ctx, ov, cw, ch, bands, t),
    get effectTypes() { return EFFECT_TYPES; },
    get FrameDrawEngine() { return FrameDrawEngine; },
    measureTextOverlay, setOverlayChangeCallback, getTextSafeArea,
    drawFxOverlay, drawLetterboxLayer,
    _forceResetSprings, // для ExportEngine
    // Per-line cinematic camera scenes
    setLineCamScene, clearLineCamScene, getLineCamScene,
    tickLineScene, evaluateLineScene, applySceneTransform, applySceneFlash,
    addCamScene, updateCamScene, removeCamScene, findCamSceneForLine, resetSceneFadesToDefaults,
    get camScenes()    { return camScenes; },
    get scenePresets() { return Object.keys(SCENE_PRESETS); },
    get overlays()     { return overlays; },
    get hasMedia()     { return !!media; },
    get fxState()      { return fx; },
    get bgState()      { return bgState; },
    get camState()     { return cam; },
    // ExportEngine: нужен прямой доступ к элементу для seek
    get mediaElement() { return media; },
    get mediaType()    { return mediaType; },
  };
})();