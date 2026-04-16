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
  // Отдельный сглаживатель баса для музыкального зума —
  // более медленный чем основной FrequencyBands, убирает острые пики
  let _musicZoomBassSmooth = 0;

  function ensureMusicZoomSpring() {
    if (!musicZoomSpring) {
      musicZoomSpring = new SpringPhysics({
        stiffness: 0.08,  // медленно, кинематографично
        damping:   0.78,  // overdamped — плавное затухание без колебаний
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
    musicZoomAmount: 0,   // 0 = зум выключен, 1 = зум активен
    scrollXAmount:   0,   // 0 = прокрутка X выключена, 1 = активна
    scrollYAmount:   0,   // 0 = прокрутка Y выключена, 1 = активна
  };
  const CAM_TRANSITION_SPEED = 2.0; // скорость перехода камеры (быстрее чем фон)

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

  async function registerOverlay(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const id = `ov_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        const ov = {
          id, img, url,
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
          opacity:   1.0,
          enabled:   true,
          // Fade система: всегда начинаем с 0 — fade-in проиграет плавно
          fadeAlpha: 0,
          fadeTarget: 1,
        };
        overlays.push(ov);
        resolve(ov);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function updateOverlay(id, props) {
    const ov = overlays.find(o => o.id === id);
    if (ov) Object.assign(ov, props);
  }

  function removeOverlay(id) {
    const idx = overlays.findIndex(o => o.id === id);
    if (idx >= 0) { URL.revokeObjectURL(overlays[idx].url); overlays.splice(idx, 1); }
  }

  function _drawOverlayItem(ctx, ov, cw, ch, bands, t, effectOverride = null) {
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
    }

    const drawW = baseW * scaleX;
    const drawH = baseH * scaleY;
    
    if (effect === 'spin') {
      ctx.translate(baseX + offX, baseY + offY);
      ctx.rotate(rotation);
      ctx.drawImage(ov.img, -drawW / 2, -drawH / 2, drawW, drawH);
    } else {
      ctx.drawImage(ov.img, baseX - drawW / 2 + offX, baseY - drawH / 2 + offY, drawW, drawH);
    }
    
    ctx.restore();
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
    const FADE_SPEED = 5.0; // скорость fade out (единиц в секунду)
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
      
      // Определяем эффект для этого объекта на текущей строке
      let effectiveEffect = ov.effect || 'static';
      if (currentLyric && currentLyric.lineStyle && currentLyric.lineStyle.overlayEffect) {
        effectiveEffect = currentLyric.lineStyle.overlayEffect;
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
      if (ov.scope === 'global') {
        // Global: плавный fade-in при первом появлении, затем остаётся на 1
        ov.fadeTarget = 1;
        if (ov.fadeAlpha < 1) {
          ov.fadeAlpha = Math.min(1, ov.fadeAlpha + FADE_SPEED * dtSafe);
        }
      } else {
        if (shouldBeVisible) {
          // Появление — плавный fade in (0.25 сек = FADE_SPEED шагов)
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
      _drawOverlayItem(tempCtx, ov, cw, ch, bands, t, effectiveEffect);
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
    
    // Сбрасываем переходы камеры
    camTransitions.musicZoomAmount = 0;
    camTransitions.scrollXAmount = 0;
    camTransitions.scrollYAmount = 0;
    
    // Сбрасываем fadeAlpha у timeline-оверлеев чтобы они не мелькали при повторном старте
    overlays.forEach(ov => {
      if (ov.scope === 'timeline') {
        ov.fadeAlpha  = 0;
        ov.fadeTarget = 0;
      }
    });
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
      if (cmd.value) fx.letterboxReactive = false;
    }
    if (cmd.type === 'letterboxReactive') {
      fx.letterboxReactive = cmd.value;
      if (cmd.value) fx.letterbox = false;
    }

    // ── Камера: музыкальный зум ───────────────
    if (cmd.type === 'zoomIn')   { cam.musicZoom.enabled = true;  cam.musicZoom.invert = false; }
    if (cmd.type === 'zoomOut')  { cam.musicZoom.enabled = true;  cam.musicZoom.invert = true;  }
    if (cmd.type === 'zoomStop') { cam.musicZoom.enabled = false; }

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
    if (fx.kenBurns && !cam.zoom.enabled && camTransitions.musicZoomAmount < 0.5) {
      // Плавно убираем KB-дыхание по мере нарастания musicZoom
      const kbFade = 1 - camTransitions.musicZoomAmount * 2;
      zoom += (bands.bass * 0.03 + Math.sin(t * 0.21) * 0.015) * kbFade;
    }

    // 3. Музыкальный зум — реакция на бас
    //
    // Принципы:
    //  - LP-фильтр баса с фиксированной τ=80ms (frame-rate independent)
    //  - Spring overdamped (k=0.06, d=0.82) — никаких колебаний
    //  - Максимальная амплитуда ±0.12 при amount=0.4 (ощутимый зум)
    //  - Направление: zoomIn = положительно, zoomOut = отрицательно
    //  - Базовый зум 0.15 + реакция на бас
    if (camTransitions.musicZoomAmount > 0.001) {
      ensureMusicZoomSpring();

      // Базовый зум когда включён музыкальный зум
      const baseZoomOffset = 0.15;

      // LP-фильтр баса: τ=80ms, frame-rate independent через формулу 1-exp(-dt/τ)
      // Это НЕ зависит от FPS, одинаково работает в реалтайме и при экспорте
      const TAU_BASS = 0.08; // 80ms — быстрая реакция, без острых пиков
      const bassAlpha = 1 - Math.exp(-Math.max(dt, 0.001) / TAU_BASS);
      _musicZoomBassSmooth += (bands.bass - _musicZoomBassSmooth) * bassAlpha;

      // Амплитуда реакции: увеличена для более заметного зума
      // Диапазон ползунка 0.1–1.5 → зум от ~0.05 до ~0.75
      const maxAmp = 0.2 * (cam.musicZoom.amount / 0.4);
      const dir    = cam.musicZoom.invert ? -1 : 1;
      const target = dir * _musicZoomBassSmooth * maxAmp * camTransitions.musicZoomAmount;

      musicZoomSpring.target = target;
      musicZoomSpring.update(dt);

      zoom += baseZoomOffset * camTransitions.musicZoomAmount + musicZoomSpring.value;
    } else if (musicZoomSpring) {
      // Плавно гасим spring когда зум выключается
      musicZoomSpring.target = 0;
      musicZoomSpring.update(dt);
      if (Math.abs(musicZoomSpring.value) > 0.0005) zoom += musicZoomSpring.value;
      else { musicZoomSpring.reset(0); _musicZoomBassSmooth = 0; }
    }

    // Гарантируем минимум — изображение всегда покрывает холст
    zoom = Math.max(1.0, zoom);

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
      const shouldScroll = camTransitions.scrollXAmount > 0.01 || camTransitions.scrollYAmount > 0.01;
      if (shouldScroll) {
        const tilesX = camTransitions.scrollXAmount > 0.01 ? 3 : 1;
        const tilesY = camTransitions.scrollYAmount > 0.01 ? 3 : 1;
        const scrollOffsetX = camTransitions.scrollXAmount > 0.01 ? cam.scrollX.position : 0;
        const scrollOffsetY = camTransitions.scrollYAmount > 0.01 ? cam.scrollY.position : 0;
        for (let ty = 0; ty < tilesY; ty++) {
          for (let tx = 0; tx < tilesX; tx++) {
            const dx = baseDx - kbPanX + (tx - 1) * drawW - scrollOffsetX;
            const dy = baseDy - kbPanY + (ty - 1) * drawH - scrollOffsetY;
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
    const transitionSpeed = 3.5; // единиц в секунду (быстрее чем было)
    const step = transitionSpeed * (dt || 0.016);
    
    if (bgTransitions.letterboxAmount < targetAmount) {
      bgTransitions.letterboxAmount = Math.min(targetAmount, bgTransitions.letterboxAmount + step);
    } else if (bgTransitions.letterboxAmount > targetAmount) {
      bgTransitions.letterboxAmount = Math.max(targetAmount, bgTransitions.letterboxAmount - step);
    }
    
    if (bgTransitions.letterboxAmount < 0.01) return;
    
    // Базовая высота полос (10% от высоты экрана)
    let barHeight = ch * 0.1;
    
    // Если реактивный режим, полосы пульсируют с басом (с плавным сглаживанием)
    if (fx.letterboxReactive) {
      ensureLetterboxBassSpring();
      // Обновляем spring с текущим значением баса
      letterboxBassSpring.update(bands.bass || 0, dt || 0.016);
      const bassSmooth = letterboxBassSpring.value;
      barHeight = ch * (0.08 + bassSmooth * 0.05);
    }
    
    const actualHeight = barHeight * bgTransitions.letterboxAmount;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, actualHeight);                    // верхняя полоса
    ctx.fillRect(0, ch - actualHeight, cw, actualHeight);    // нижняя полоса
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
    
    // Музыкальный зум
    const musicZoomTarget = cam.musicZoom.enabled ? 1 : 0;
    if (camTransitions.musicZoomAmount < musicZoomTarget) {
      camTransitions.musicZoomAmount = Math.min(musicZoomTarget, camTransitions.musicZoomAmount + camTransitionStep);
    } else if (camTransitions.musicZoomAmount > musicZoomTarget) {
      camTransitions.musicZoomAmount = Math.max(musicZoomTarget, camTransitions.musicZoomAmount - camTransitionStep);
    }
    
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

  // Отдельная функция для рисования letterbox (вызывается из App.js после overlays)
  function drawLetterboxLayer(ctx, cw, ch, bands, dt) {
    drawLetterbox(ctx, cw, ch, bands, dt);
  }

  return {
    load, draw, playVideo, stopVideo, pauseVideo,
    setFX, setCamParam, resetCamera, applyBackgroundCommand,
    registerBgImage, setLineBackground, clearLineBackground,
    getBgImageUrl, getBgImageName,
    registerOverlay, updateOverlay, removeOverlay, drawOverlays,
    drawLetterboxLayer,
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