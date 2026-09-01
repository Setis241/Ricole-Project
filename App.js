/* ═══════════════════════════════════════════════
   js/App.js
   Главный контроллер CHROMATYPE.
   Склеивает все модули и управляет render-loop.
═══════════════════════════════════════════════ */
const App = (() => {

  // ── Canvas
  const canvas   = document.getElementById('mainCanvas');
  const ctx      = canvas.getContext('2d');
  const spectrum = document.getElementById('spectrumCanvas');
  const spCtx    = spectrum.getContext('2d');

  // ── Пружины для текстовых трансформаций
  const springs = {
    scale:   new SpringPhysics({ stiffness: 0.15, damping: 0.35, initial: 1 }),
    offsetY: new SpringPhysics({ stiffness: 0.10, damping: 0.40, initial: 0 }),
    offsetX: new SpringPhysics({ stiffness: 0.10, damping: 0.40, initial: 0 }),
  };

  // ── Параметры анимации (синхронизированы с UI)
  const params = {
    bassSens:  1.2,
    maxScale:  2.0,
    fadeDur:   0.2,   // секунды
    fontSize:  96,
    font:      "'Bebas Neue', cursive",
    color:     '#ffffff',
    animMode:  'pulse',
    textPosition: 'center', // 'center' | 'top' | 'bottom'
    globalBoxId:        null,   // id из BoxRegistry или null — без рамки
    // ── Перевод ───────────────────────────────
    showTranslation:    true,
    translationRatio:   0.40,   // доля от основного размера шрифта
    translationColor:   '#999999',
    translationGap:     0.85,   // отступ вниз в единицах основного fontSize
  };

  // ── Лирика
  let lyrics    = [];
  let activeIdx = -1;
  let entryTime = 0;

  // ── Loop state
  let rafId     = null;
  let lastT     = 0;

  /* Снимок последнего отрисованного кадра — для window.RicoleDebug().
     Объявлен на уровне модуля, а не внутри цикла: иначе функция-читалка
     существует только когда играет строка, и позвать её в нужный момент
     невозможно. */
  let _debugSnap = null;
  if (typeof window !== 'undefined') {
    window.RicoleDebug = function() {
      const g = (typeof TextRenderer !== 'undefined') ? TextRenderer.lastFrameGuard : null;
      if (!_debugSnap) return 'кадр с текстом ещё не рисовался — включи воспроизведение';
      const j = (typeof TextRenderer !== 'undefined') ? TextRenderer.ghostJumps : null;
      return Object.assign({}, _debugSnap, {
        страховкаКадра: g,
        // Скачки фонового слоя: что именно дёрнулось и на смене ли строки.
        скачкиФона: j && j.length ? j : 'скачков не зафиксировано',
      });
    };
  }

  // ── Resolution map
  const RES = {
    '3840x2160': [3840, 2160],
    '1920x1080': [1920, 1080],
    '1280x720':  [1280, 720],
    '1080x1080': [1080, 1080],
    '1080x1920': [1080, 1920],
  };

  function setResolution(key) {
    const [w, h] = RES[key] || [1280, 720];
    canvas.width  = w;
    canvas.height = h;

    // Меряем по .canvas-area (дедушка) — у него стабильный размер от грид-сетки.
    // Если мерять по .canvas-wrap (родитель), он сам подстраивается под канвас и
    // даёт обратную связь: чем меньше канвас, тем меньше wrap, тем меньше канвас…
    const area      = canvas.closest('.canvas-area') || canvas.parentElement;
    const controls  = area.querySelector('.controls-row');
    const ctrlH     = controls ? controls.getBoundingClientRect().height : 0;
    const areaStyle = getComputedStyle(area);
    const padX = parseFloat(areaStyle.paddingLeft)   + parseFloat(areaStyle.paddingRight);
    const padY = parseFloat(areaStyle.paddingTop)    + parseFloat(areaStyle.paddingBottom);
    const gap  = parseFloat(areaStyle.rowGap || areaStyle.gap || 0);

    const maxW = area.clientWidth  - padX;
    const maxH = area.clientHeight - padY - ctrlH - gap;
    const s    = Math.min(maxW / w, maxH / h, 1);
    canvas.style.width  = `${Math.round(w * s)}px`;
    canvas.style.height = `${Math.round(h * s)}px`;
  }

  /* ── RENDER LOOP ──────────────────────────── */
  function render(now) {
    rafId = requestAnimationFrame(render);

    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT    = now;

    springs.scale.update(dt);
    springs.offsetY.update(dt);
    springs.offsetX.update(dt);

    // ── Audio analysis
    const freqData = AudioEngine.getFrequencyData();
    const bands    = FrequencyBands.analyze(freqData, AudioEngine.sampleRate, AudioEngine.fftSize, dt);

    const t = AudioEngine.getCurrentTime();

    // ── Лирика: найти активную строку
    if (lyrics.length > 0 && AudioEngine.isPlaying) {
      let newIdx = -1;
      for (let i = lyrics.length - 1; i >= 0; i--) {
        if (t >= lyrics[i].time) { newIdx = i; break; }
      }
      if (newIdx !== activeIdx) {
        activeIdx = newIdx;
        entryTime = t;
        springs.scale.reset(1);
        springs.offsetY.reset(0);
        springs.offsetX.reset(0);
        highlightLyricList(activeIdx);

        // Применяем команды фона
        if (lyrics[activeIdx] && lyrics[activeIdx].bgCommands) {
          lyrics[activeIdx].bgCommands.forEach(cmd => {
            BackgroundEngine.applyBackgroundCommand(cmd);
            if (BackgroundManager.hasEntries) BackgroundManager.applyFxCommand(cmd);
          });
        }

        // Активируем кам-сцену из коллекции (если строка приписана к одной).
        // Анимация играется один раз на весь contiguous-блок строк, привязанных
        // к ТОЙ ЖЕ сцене (а не перезапускается на каждой строке).
        const _curLyric = lyrics[activeIdx];
        const _sceneAssign = (BackgroundEngine.findCamSceneForLine
          ? BackgroundEngine.findCamSceneForLine(activeIdx) : null);
        if (_curLyric && _sceneAssign) {
          let _runStart = activeIdx, _runEnd = activeIdx;
          while (_runStart > 0 &&
                 BackgroundEngine.findCamSceneForLine(_runStart - 1) === _sceneAssign) _runStart--;
          while (_runEnd < lyrics.length - 1 &&
                 BackgroundEngine.findCamSceneForLine(_runEnd + 1) === _sceneAssign) _runEnd++;
          const _blockStart = lyrics[_runStart].time;
          const _blockEnd   = (_runEnd + 1 < lyrics.length)
            ? lyrics[_runEnd + 1].time
            : lyrics[_runEnd].time + 4;
          BackgroundEngine.setLineCamScene(_sceneAssign, _blockStart, _blockEnd - _blockStart, {
            currentLineIdx: activeIdx,
            blockStartLine: _runStart,
            blockEndLine:   _runEnd,
          });
        } else if (BackgroundEngine.clearLineCamScene) {
          BackgroundEngine.clearLineCamScene();
        }
      }
    }

    // ── Background
    const cw = canvas.width, ch = canvas.height;

    // ═══════════════════════════════════════════════
    // ВАЖНО: сначала считаем AnimMode, чтобы получить cameraOverride
    // (например montage зумит фон вместе с текстом). Потом применяем
    // override к BackgroundEngine и только после этого рисуем фон.
    // Переменные: _animResult, _lyric, _elapsed, _dur, _fadeA, _ls
    // валидны только если есть активная лирика — используем их позже.
    // ═══════════════════════════════════════════════
    let _animResult = null, _lyric = null, _elapsed = 0, _dur = 0;
    let _fadeA = 0, _ls = null;
    let _effectiveFont = params.font, _effectiveSize = params.fontSize;
    let _effectiveColor = params.color, _effectivePos = params.textPosition;
    // Где строка реально стоит. Считается один раз (см. ниже) и используется
    // и для ширины полосы, и для отрисовки.
    let _textX = 0, _textY = 0;
    // Безопасная зона кадра: и сетка позиций, и bounds для TextRenderer.
    let _safe = { x: 0, y: 0, w: cw, h: ch };
    // Силуэт персонажа: маска, которую построчный путь вычитает из зоны.
    let _shapeAt = null;

    if (activeIdx >= 0 && activeIdx < lyrics.length) {
      _lyric   = lyrics[activeIdx];
      _elapsed = t - _lyric.time;
      _dur     = activeIdx + 1 < lyrics.length
        ? lyrics[activeIdx + 1].time - _lyric.time
        : 4;
      _fadeA = TextRenderer.getFadeAlpha(_elapsed, _dur, params.fadeDur);
      _ls    = _lyric.lineStyle || {};
      _effectiveFont  = _ls.font      || params.font;
      _effectiveSize  = _ls.fontSize  || params.fontSize;
      _effectiveColor = _ls.color     || params.color;
      const _effectiveAnim = _ls.animMode || params.animMode;
      _effectivePos   = _ls.position  || params.textPosition;

      const modeFn = AnimModes[_effectiveAnim] || AnimModes.pulse;
      const words  = _lyric.text
        ? _lyric.text.replace(/\{[^}]+\}/g, '').split(/\s+/).filter(Boolean)
        : [];
      /* Ширина колонки, отведённой строке — симметричная полоса вокруг той
         точки, где строка РЕАЛЬНО стоит.

         Здесь была прямая ошибка: полоса считалась от {LPOSX} с дефолтом 50
         («строка по центру кадра»), а фактический центр брался ниже совсем
         из другого места — из сетки {LPOS}, где 'center-left' это 0.15
         ширины. Полоса шириной 0.95 кадра вокруг точки 0.15 выходит за
         левый край на треть кадра. Режим честно держался полосы — и текст
         всё равно вываливался за рамку, потому что врала сама полоса.

         Поэтому позиция строки вычисляется ОДИН раз и до раскладки, и
         полоса выводится из неё. Дальше эта же _textX/_textY уходит в
         отрисовку — двух источников правды о том, где стоит строка, быть
         не должно. */
      /* Сетка отсчитывается от ВНУТРЕННЕЙ области кадра, а не от холста:
         иначе 0.15 ширины — это точка под линией рамки. */
      _safe = BackgroundEngine.getTextSafeArea
        ? BackgroundEngine.getTextSafeArea(cw, ch)
        : { x: 0, y: 0, w: cw, h: ch };

      _textX = _safe.x + _safe.w / 2; _textY = _safe.y + _safe.h / 2;
      {
        const p = _effectivePos || 'center';
        if (p.endsWith('-left'))  _textX = _safe.x + _safe.w * 0.15;
        if (p.endsWith('-right')) _textX = _safe.x + _safe.w * 0.85;
        if (p.startsWith('top'))    _textY = _safe.y + _safe.h * 0.15;
        if (p.startsWith('bottom')) _textY = _safe.y + _safe.h * 0.85;
        // Числовой якорь перебивает сетку: он ставит строку относительно
        // фигуры в кадре, а не «в позицию кадра».
        if (_ls && _ls.anchorX != null) _textX = cw * (_ls.anchorX / 100);
        if (_ls && _ls.anchorY != null) _textY = ch * (_ls.anchorY / 100);
        /* Якорь загоняем в зону здесь, а не оставляем это рендереру.
           Рендерер и так клампит центр блока, но _maxLineW считается тут:
           точка снаружи зоны дала бы нулевую полосу и раскладку в столбик. */
        _textX = Math.min(Math.max(_textX, _safe.x), _safe.x + _safe.w);
        _textY = Math.min(Math.max(_textY, _safe.y), _safe.y + _safe.h);
      }
      /* Полоса выводится из той же точки и обрезается по безопасной зоне —
         теперь и при числовом якоре, который сетку перебивает. */
      const _maxLineW = 2 * Math.min(
        Math.max(_textX - _safe.x, 0),
        Math.max(_safe.x + _safe.w - _textX, 0)
      ) * 0.95;

      /* Силуэт фигуры для этой строки. Режим получает не прямоугольник, а
         функцию «что занято на этой высоте» и строит набор по ФОРМЕ: над
         головой и под плечом место есть, на уровне корпуса — нет. Фигуры
         нет или профиль не читается — режимы работают как раньше, по
         полосе. */
      _shapeAt = (typeof BackgroundEngine !== 'undefined' &&
                  BackgroundEngine.getCharacterShape)
        ? BackgroundEngine.getCharacterShape(cw, ch, activeIdx) : null;

      /* Диагностика кадра. Спорить о том, что происходит с текстом, по
         скриншотам нельзя: пиксель на скриншоте не измеришь, а масштаб
         превью меняется от размера окна. Здесь копится снимок ФАКТИЧЕСКИХ
         чисел кадра; читать его — window.RicoleDebug() в консоли. */
      _debugSnap = {
        кадр:            cw + '×' + ch,
        строка:          (_lyric && _lyric.text) || '',
        режимСтроки:     (_ls && _ls.animMode) || ('из списка: ' + params.animMode),
        кегльLSIZE:      _effectiveSize,
        точкаСтроки:     Math.round(_textX) + ',' + Math.round(_textY),
        полосаMaxLineW:  Math.round(_maxLineW),
        силуэтНайден:    !!_shapeAt,
        силуэтНаВысотеСтроки: _shapeAt
          ? (function() {
              const sp = _shapeAt(_textY);
              return sp ? ('занято ' + Math.round(sp.x0) + '…' + Math.round(sp.x1))
                        : 'на этой высоте фигуры нет';
            })()
          : 'профиль не построен',
      };

      _animResult = modeFn({
        bands, t, params, springs,
        words,
        canvasW:  cw,
        canvasH:  ch,
        elapsed:  _elapsed,
        duration: _dur,
        fontSize: _effectiveSize,
        ctx,
        font:     _effectiveFont,
        maxLineW: _maxLineW,
        // Раскладка ведётся от точки строки, а профиль — от кадра:
        // отдаём режиму и точку, чтобы он мог перевести одно в другое.
        originX:  _textX,
        originY:  _textY,
        shapeAt:  _shapeAt,
      });

      // ── Применяем camera override к фону (montage и др.) ──
      // КЛЮЧЕВОЙ МОМЕНТ: camera-эффект имеет ОТДЕЛЬНЫЙ длинный fade
      // (600мс) вместо короткого fadeA (200мс). Почему:
      //   - fadeA короткий для читаемости текста (200мс не мешает чтению)
      //   - но если фон резко зумится с 1.0 до 1.8 за 200мс — это хлопок
      //     Особенно заметно когда предыдущая строка была БЕЗ montage,
      //     и фон был в состоянии zoom=1.0. Переход 1.0 → 1.8 за 200мс
      //     выглядит как эффект-удар, а не кинематография.
      // Решение: cameraK растёт 600мс с smoothstep easing, давая плавное
      // "вплывание" камеры. На выходе — 500мс smoothstep out.
      if (_animResult && _animResult.cameraOverride && BackgroundEngine.setTextDrivenCamera) {
        const co = _animResult.cameraOverride;
        const FADE_IN_CAM  = 0.60;
        const FADE_OUT_CAM = 0.50;
        const inProg  = Math.min(_elapsed / FADE_IN_CAM, 1);
        const outProg = _dur > 0 ? Math.min((_dur - _elapsed) / FADE_OUT_CAM, 1) : 1;
        const rawK    = Math.max(0, Math.min(inProg, outProg, 1));
        // Smoothstep 3x²-2x³: медленный старт и мягкая посадка
        const cameraK = rawK * rawK * (3 - 2 * rawK);
        BackgroundEngine.setTextDrivenCamera({
          zoomMul: 1 + (co.zoomMul - 1) * cameraK,
          panX:    co.panX * cameraK,
          panY:    co.panY * cameraK,
        });
      }
    }

    // КРИТИЧНО: тикаем blend сцены КАЖДЫЙ кадр, независимо от источника фона.
    // Иначе при использовании BackgroundManager (per-line bg) BackgroundEngine.draw
    // не вызывается, blend застревает на 0 и сцена не видна.
    if (BackgroundEngine.tickLineScene) BackgroundEngine.tickLineScene(dt);
    // textCam decay тикается ПОСЛЕ отрисовки фона (см. ниже) — чтобы
    // setTextDrivenCamera({k=1}) → draw читает k=1 (как в legacy drawMedia),
    // и только потом decay для следующего кадра.

    // Оборачиваем рендер фона сценическим transform (если активна кам-сцена).
    // Эффект применяется ОДИНАКОВО и к BackgroundManager, и к BackgroundEngine,
    // как viewport-камера поверх любого фонового рендера.
    const _sceneApplied = BackgroundEngine.applySceneTransform
      ? BackgroundEngine.applySceneTransform(ctx, cw, ch, bands, t)
      : false;

    // ── ENDING SEQUENCE: получаем состояние затухания и громкости ──
    const endingState = BackgroundEngine.getEndingState
      ? BackgroundEngine.getEndingState(t)
      : { active: false, contentAlpha: 1, audioVolume: 1 };
    // Применяем громкость к audio
    if (AudioEngine.setGain) AudioEngine.setGain(endingState.audioVolume);
    // Если ending активен, оборачиваем весь рендер контента в globalAlpha=contentAlpha
    const _contentSaved = endingState.active && endingState.contentAlpha < 1;
    if (_contentSaved) {
      ctx.save();
      ctx.globalAlpha = endingState.contentAlpha;
    }

    if (BackgroundManager.hasEntries) {
      // Менеджер фонов: тикаем + рисуем активный entry с per-bg настройками
      BackgroundManager.tick(activeIdx, dt);
      BackgroundManager.draw(ctx, cw, ch, bands, t, dt);
      // Оверлеи затемнения/осветления из FX Editor работают поверх BackgroundManager
      BackgroundEngine.drawFxOverlay(ctx, cw, ch, dt);
    } else if (BackgroundEngine.hasMedia) {
      BackgroundEngine.draw(ctx, cw, ch, bands, t, dt);
    } else {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, cw, ch);
    }
    // Decay text-driven camera ПОСЛЕ отрисовки фона: рендер этого кадра
    // прочитал _decay=1 (свежий), а decay подготавливает следующий кадр.
    // Если на следующем кадре setTextDrivenCamera снова вызовется — _decay
    // опять станет 1. Если нет — за ~150мс плавно затухнет до 0.
    if (BackgroundEngine.tickTextDrivenCamera) BackgroundEngine.tickTextDrivenCamera(dt);

    if (_sceneApplied) ctx.restore();

    // Flash-overlay сцены (вспышки/затемнения по басу) — поверх фона, но
    // перед текстом, чтобы лирика не моргала.
    if (BackgroundEngine.applySceneFlash) {
      BackgroundEngine.applySceneFlash(ctx, cw, ch, bands, t);
    }

    // ── Overlays + Text в правильном z-порядке ──
    // drawOverlaysAll рендерит объекты в порядке массива,
    // вставляя текст между последним 'below' и первым 'above' объектом.
    const currentLyric = _lyric;

    // ── Передний план едет с той же камерой, что и фон ──
    // Раньше сцена камеры оборачивала ТОЛЬКО фон: объекты и текст висели на
    // неподвижной плоскости, и кадр читался как два несвязанных слоя —
    // сзади кино, спереди наклейки. Камера снимает сцену целиком, поэтому
    // передний план получает ту же трансформацию, но ослабленную: тот же
    // ритм и та же фаза удара, меньшая амплитуда. Это и есть параллакс —
    // и именно он склеивает фон, спрайт и текст в один кадр.
    // Персонаж стоит В СЦЕНЕ, а не поверх неё, поэтому он едет с камерой
    // почти как фон — за это отвечает ov.camFollow. Чтобы движок мог
    // применить свою камеру к такому объекту, ему нужна матрица холста ДО
    // общей камеры переднего плана: отсюда и передаём.
    const FOREGROUND_CAM = 0.28;
    if (BackgroundEngine.setForegroundCam) {
      BackgroundEngine.setForegroundCam(
        (ctx.getTransform ? ctx.getTransform() : null), FOREGROUND_CAM);
    }
    const _fgApplied = BackgroundEngine.applySceneTransform
      ? BackgroundEngine.applySceneTransform(ctx, cw, ch, bands, t, FOREGROUND_CAM)
      : false;

    BackgroundEngine.drawOverlaysAll(ctx, cw, ch, bands, t, dt, activeIdx, currentLyric, (pass) => {
      // ── Text ──────────────────────────────────
      if (_lyric && _animResult) {
        // 9-позиционная сетка: top/center/bottom × left/center/right
        /* Позиция уже посчитана до раскладки — там же, где из неё выведена
           ширина полосы (_maxLineW) и где сетка отсчитана от безопасной
           зоны. Считать её здесь второй раз значит завести второй источник
           правды: именно так полоса и разошлась с фактическим местом
           строки. */
        const textX = _textX, textY = _textY;
        const safe = _safe;  // та же зона уходит в TextRenderer как bounds

        const mainBottom = TextRenderer.draw(
          ctx, _lyric,
          textX, textY,
          _animResult, _fadeA,
          _effectiveColor, _effectiveFont, _effectiveSize, cw, t,
          params.globalBoxId, safe, _shapeAt, pass
        );

        /* Перевод — часть читаемого набора, а не декорация: в ghost-проходе
           его рисовать нельзя, иначе он ляжет под фигуру и продублируется
           вторым проходом. */
        if (pass === 'ghost') return;

        // ── Перевод строки ──────────────────────
        if (params.showTranslation && _lyric.translation) {
          const trSize = Math.max(14, Math.round(_effectiveSize * params.translationRatio));
          const trY    = (mainBottom ?? textY + _effectiveSize) + trSize * 0.9;
          const trAnim = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, alpha: 1 };
          /* Перевод встаёт в ТУ ЖЕ колонку, что и основная строка, а не
             раскладывается заново по всей безопасной зоне. Колонку и центр
             отдаёт сам рендерер (lastLayout) — после маски и клампинга,
             то есть там, где строка реально стоит. Маску переводу второй
             раз считать нельзя: у него своя высота и свой кегль, профиль
             фигуры на его высоте другой, и половины набора разъезжаются. */
          /* Колонка годится только если основной набор в этом кадре
               действительно рисовался: при пустом тексте или нулевой
               альфе draw выходит раньше, и lastLayout остался от прошлой
               строки. */
            const lay = (mainBottom != null) ? TextRenderer.lastLayout : null;
          TextRenderer.draw(
            ctx, { text: _lyric.translation },
            (lay ? lay.cx : textX), trY,
            trAnim, _fadeA,
            params.translationColor, _effectiveFont, trSize, cw, t,
            null, (lay ? lay.area : safe), (lay ? null : _shapeAt)
          );
        }
      }
    });

    // Снимаем камеру переднего плана — леттербокс и ending рисуются
    // по краям кадра и двигаться вместе со сценой не должны.
    if (_fgApplied) ctx.restore();

    // ── Letterbox (поверх всего)
    BackgroundEngine.drawLetterboxLayer(ctx, cw, ch, bands, dt);

    // Закрываем content-alpha обёртку, начатую перед фоном (для ending fade)
    if (_contentSaved) ctx.restore();

    // ── ENDING OVERLAY (поверх всего, не подверженный fade) ──
    if (endingState.active && BackgroundEngine.drawEnding) {
      BackgroundEngine.drawEnding(ctx, cw, ch, t);
    }

    // ── VU & Spectrum
    updateMeters(bands, freqData, t);
  }

  function updateMeters(bands, freqData, t) {
    document.getElementById('vuBass').style.height = `${bands.bass * 100}%`;
    document.getElementById('vuMid' ).style.height = `${bands.mid  * 100}%`;
    document.getElementById('vuHigh').style.height = `${bands.high * 100}%`;

    // Spectrum mini
    const W = spectrum.width, H = spectrum.height;
    spCtx.fillStyle = '#0a0a0a';
    spCtx.fillRect(0, 0, W, H);
    const count = Math.min(80, freqData.length);
    const barW  = W / count;
    for (let i = 0; i < count; i++) {
      const v   = freqData[Math.floor(i * freqData.length / count)] / 255;
      const bh  = v * H;
      const hue = 120 - (i / count) * 120;
      spCtx.fillStyle = `hsl(${hue},90%,55%)`;
      spCtx.fillRect(i * barW, H - bh, barW - 1, bh);
    }

    // Time
    const m  = Math.floor(t / 60);
    const s  = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);
    document.getElementById('timeDisplay').textContent =
      `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  }

  /* ── LYRIC LIST ────────────────────────────── */
  function highlightLyricList(idx) {
    document.querySelectorAll('#lyricList li').forEach((li, i) => {
      li.classList.toggle('active', i === idx);
      if (i === idx) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function parseLyrics() {
    const raw = document.getElementById('lyricsInput').value.trim();
    if (!raw) return;
    lyrics    = LRCParser.parse(raw);
    activeIdx = -1;
    renderLyricList();
    // Передаём в BackgroundManager для UI выбора строк (timeline-scope)
    if (typeof BackgroundManager !== 'undefined') {
      BackgroundManager.setLines(lyrics);
    }
    // Ищем ending-маркер ([конец] / [end] / /КОНЕЦ ВИДЕО/) и регистрируем в Engine
    if (BackgroundEngine.setEndingMarker) {
      const end = lyrics.find(l => l.isEnding);
      if (end) BackgroundEngine.setEndingMarker(end.time);
      else     BackgroundEngine.clearEndingMarker();
    }
  }

  function renderLyricList() {
    const list = document.getElementById('lyricList');
    list.innerHTML = lyrics.map((l, i) => {
      const sectionLabel = l.section
        ? `<span style="color:var(--accent);font-size:9px;margin-right:4px;">[${l.section}]</span>`
        : '';
      // Показываем иконку стиля если строка имеет per-line overrides
      const ls = l.lineStyle || {};
      const hasStyle = ls.font || ls.fontSize || ls.animMode || ls.color;
      const styleIcon = hasStyle ? `<span title="Свой стиль" style="color:var(--accent);margin-right:3px;">✦</span>` : '';
      // Кам-сцена, если строка приписана к одной из них
      const camScene = (typeof BackgroundEngine !== 'undefined' && BackgroundEngine.findCamSceneForLine)
        ? BackgroundEngine.findCamSceneForLine(i) : null;
      const camIcon  = camScene
        ? `<span title="Кам. сцена: ${camScene.name} (${camScene.preset})" style="color:#00e5ff;margin-right:3px;">📷</span>`
        : '';
      return `<li data-index="${i}">${styleIcon}${camIcon}${sectionLabel}<span class="ts">${fmtTime(l.time)}</span><span class="txt">${escHtml(l.text)}</span></li>`;
    }).join('');
    
    // Добавляем обработчики кликов
    list.querySelectorAll('li').forEach((li, i) => {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        if (lyrics[i]) {
          // Костыль: сначала стоп, потом плей
          AudioEngine.stop();
          BackgroundEngine.stopVideo();
          if (typeof BackgroundManager !== 'undefined') { BackgroundManager.stopVideos(); BackgroundManager.resetFxOverrides(); }
          BackgroundEngine.resetCamera();
          activeIdx = -1;

          // Небольшая задержка перед запуском
          setTimeout(() => {
            AudioEngine.play(lyrics[i].time);
            BackgroundEngine.playVideo();
            if (typeof BackgroundManager !== 'undefined') BackgroundManager.playVideos();
            BackgroundEngine.resetCamera();
            resetSprings();
            setStatus('playing', 'Playing');
            setStatusDot('play');
          }, 50);
        }
      });
    });
  }

  /* ── UI INIT ───────────────────────────────── */
  function initUI() {
    // Range слайдеры
    const rangeMap = [
      ['bassSens',  'bassSensVal',  v => params.bassSens  = +v],
      ['maxScale',  'maxScaleVal',  v => params.maxScale  = +v],
      ['fadeDur',   'fadeDurVal',   v => params.fadeDur   = +v / 1000],
      ['fontSize',  'fontSizeVal',  v => params.fontSize  = +v],
      // Проценты в UI, доля в движке — зона живёт в BackgroundEngine,
      // чтобы превью и ExportEngine читали одно и то же значение.
      ['safeInset', 'safeInsetVal', v => BackgroundEngine.setTextSafeInset(+v / 100)],
    ];
    rangeMap.forEach(([id, valId, cb]) => {
      const el  = document.getElementById(id);
      const val = document.getElementById(valId);
      if (!el) return;
      el.addEventListener('input', () => { 
        val.textContent = el.value; 
        cb(el.value);
      });
    });

    bind('fontSelect',  'change', e => { params.font = e.target.value; });
    bind('textColor',   'input',  e => { params.color = e.target.value; });
    bind('animMode',    'change', e => { params.animMode = e.target.value; resetSprings(); });
    bind('textPosition', 'change', e => { params.textPosition = e.target.value; });

    // ── Перевод
    bind('translationToggle', 'click', () => {
      params.showTranslation = !params.showTranslation;
      const el = document.getElementById('translationToggle');
      if (el) el.classList.toggle('on', params.showTranslation);
    });
    const trSizeSlider = document.getElementById('translationSize');
    const trSizeVal    = document.getElementById('translationSizeVal');
    if (trSizeSlider) {
      trSizeSlider.addEventListener('input', () => {
        params.translationRatio = +trSizeSlider.value / 100;
        if (trSizeVal) trSizeVal.textContent = trSizeSlider.value + '%';
      });
    }
    bind('translationColor', 'input', e => { params.translationColor = e.target.value; });
    bind('resolution',  'change', e => { setResolution(e.target.value); });

    // ── Background FX toggles
    ['kenBurns','colorGrade','vignette','chromatic'].forEach(name => {
      const el = document.getElementById(`fx-${name}`);
      if (!el) return;
      el.classList.toggle('on', BackgroundEngine.fxState[name]);
      el.addEventListener('click', () => {
        const val = !BackgroundEngine.fxState[name];
        BackgroundEngine.setFX(name, val);
        el.classList.toggle('on', val);
      });
    });

    // ── Audio
    document.getElementById('audioFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      setStatus('loading', 'Loading audio…');
      const el = document.getElementById('audioDrop');
      el.querySelector('.drop-name').textContent = f.name;
      try {
        await AudioEngine.loadBuffer(await f.arrayBuffer());
        el.classList.add('loaded');
        ['playBtn','stopBtn','recBtn','exportBtn'].forEach(id => {
          const b = document.getElementById(id);
          if (b) b.disabled = false;
        });
        setStatus('ready', `Ready — ${fmtTime(AudioEngine.duration)}`);
        // Сохраняем аудио в IndexedDB для восстановления после перезагрузки
        if (typeof AudioStorage !== 'undefined') {
          AudioStorage.save(f).catch(err => console.warn('AudioStorage.save failed:', err));
        }
      } catch(err) {
        setStatus('error', 'Decode error');
        console.error(err);
      }
    });

    // ── Background image/video — quick-add к менеджеру фонов ──
    document.getElementById('bgFile').addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const el = document.getElementById('bgDrop');
      const dropName = el.querySelector('.drop-name');
      try {
        for (const f of files) {
          await BackgroundManager.addEntry(f);
        }
        el.classList.add('loaded');
        const count = BackgroundManager.entries.length;
        if (dropName) dropName.textContent = `+ Добавить ещё (всего: ${count})`;
        BackgroundManager.updateUiBadge();
        // Клир инпута чтобы можно было заново выбрать те же файлы
        e.target.value = '';
      } catch(err) { console.error('BG add error', err); }
    });

    // ── LRC file upload
    const lrcFileInput = document.getElementById('lrcFile');
    const lrcLoadBtn = document.getElementById('lrcLoadBtn');
    const lrcClearFileBtn = document.getElementById('lrcClearFileBtn');

    lrcLoadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      lrcFileInput.click();
    });

    lrcClearFileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      lrcFileInput.value = '';
      lrcLoadBtn.textContent = '📄 Загрузить';
    });

    lrcFileInput.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      const lyricsInput = document.getElementById('lyricsInput');

      try {
        const text = await f.text();
        lyricsInput.value = text;
        lrcLoadBtn.textContent = `📄 ${f.name}`;
        parseLyrics();
        // Очищаем input чтобы можно было загрузить тот же файл снова
        lrcFileInput.value = '';
      } catch(err) {
        console.error('LRC load error:', err);
      }
    });

    // ── Command buttons
    const lyricsInput = document.getElementById('lyricsInput');

    function insertCommand(cmd) {
      const start = lyricsInput.selectionStart;
      const end   = lyricsInput.selectionEnd;
      const text  = lyricsInput.value;
      lyricsInput.value = text.substring(0, start) + cmd + text.substring(end);
      lyricsInput.selectionStart = lyricsInput.selectionEnd = start + cmd.length;
      lyricsInput.focus();
    }

    bind('cmdSection', 'click', () => {
      const name = prompt('Название секции (например: Verse 1, Chorus):', 'Verse 1');
      if (name) insertCommand(`[${name}]`);
    });

    // ── FX Editor
    bind('fxEditorBtn', 'click', () => {
      const raw = document.getElementById('lyricsInput').value.trim();
      if (!raw) { alert('Сначала введи текст песни!'); return; }
      FxEditor.open(raw, (updatedLRC) => {
        document.getElementById('lyricsInput').value = updatedLRC;
        parseLyrics();
        setStatus('ready', 'FX Applied');
      });
    });

    // ── Overlay Manager
    bind('overlayManagerBtn', 'click', () => {
      FxEditor.openOverlayManager();
    });

    // ── Background Manager
    if (typeof BackgroundManager !== 'undefined') {
      BackgroundManager.init();
      bind('bgManagerBtn', 'click', () => {
        // Передаём актуальный список строк в менеджер (для timeline-скоупа)
        BackgroundManager.setLines(lyrics);
        BackgroundManager.open();
      });
      // Восстанавливаем сохранённые фоны из IndexedDB после перезагрузки
      if (typeof BackgroundManagerStorage !== 'undefined') {
        BackgroundManager.restoreFromStorage()
          .then(restored => {
            if (restored) {
              // Обновляем UI: галочка-loaded на drop-зоне + бэйдж количества
              const dropEl = document.getElementById('bgDrop');
              if (dropEl) {
                dropEl.classList.add('loaded');
                const dn = dropEl.querySelector('.drop-name');
                const n = BackgroundManager.entries.length;
                if (dn) dn.textContent = `↺ Восстановлено: ${n}. + Добавить ещё`;
              }
              BackgroundManager.updateUiBadge();
            }
          })
          .catch(err => console.warn('[BGM] restore fail:', err));
      }
    }

    // ── Lyrics
    bind('parseLyricsBtn', 'click', parseLyrics);
    bind('clearLyricsBtn', 'click', () => {
      document.getElementById('lyricsInput').value = '';
      lyrics = []; activeIdx = -1;
      document.getElementById('lyricList').innerHTML = '';
    });

    // ── Transport
    bind('playBtn', 'click', () => {
      parseLyrics();
      AudioEngine.play(0);
      BackgroundEngine.playVideo();
      if (typeof BackgroundManager !== 'undefined') { BackgroundManager.playVideos(); BackgroundManager.resetFxOverrides(); }
      BackgroundEngine.resetCamera();
      activeIdx = -1;
      resetSprings();
      setStatus('playing', 'Playing');
      setStatusDot('play');
    });

    bind('stopBtn', 'click', () => {
      AudioEngine.stop();
      BackgroundEngine.stopVideo();
      if (typeof BackgroundManager !== 'undefined') { BackgroundManager.stopVideos(); BackgroundManager.resetFxOverrides(); }
      BackgroundEngine.resetCamera();  // Сбрасываем все эффекты и камеру
      if (Recorder.isRecording) Recorder.stop();
      activeIdx = -1;
      setStatus('idle', 'Stopped');
      setStatusDot('');
    });

    bind('recBtn', 'click', async () => {
      const btn = document.getElementById('recBtn');
      if (Recorder.isRecording) {
        await Recorder.stop();
        btn.textContent = '⏺ REC WEBM';
        setStatusDot('play');
        setStatus('playing', 'Saved');
      } else {
        const audioDest = AudioEngine.getAudioDestination();
        Recorder.start(canvas, audioDest);
        btn.textContent = '⏹ STOP REC';
        setStatusDot('rec');
        setStatus('rec', 'Recording…');
      }
    });

    // ── Export button
    bind('exportBtn', 'click', () => {
      ExportEngine.showModal({ lyrics, params });
    });

    // ── Resolve initial res & start loop
    setResolution('1920x1080');
    lastT = performance.now();
    render(lastT);

    // ── Preset Manager UI
    if (typeof PresetManager !== 'undefined') {
      PresetManager.buildUI();
    }

    // ── Восстанавливаем аудио из IndexedDB после перезагрузки
    if (typeof AudioStorage !== 'undefined') {
      AudioStorage.load().then(async file => {
        if (!file) return;
        const el = document.getElementById('audioDrop');
        setStatus('loading', 'Restoring audio…');
        try {
          await AudioEngine.loadBuffer(await file.arrayBuffer());
          if (el) {
            el.classList.add('loaded');
            el.querySelector('.drop-name').textContent = '↺ ' + file.name;
          }
          ['playBtn','stopBtn','recBtn','exportBtn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.disabled = false;
          });
          setStatus('ready', `Restored — ${fmtTime(AudioEngine.duration)}`);
        } catch(err) {
          console.warn('Audio restore failed:', err);
          setStatus('idle', 'Ready');
        }
      }).catch(err => console.warn('AudioStorage.load failed:', err));
    }

    // ── Global Box selector
    buildGlobalBoxUI();
  }

  function buildGlobalBoxUI() {
    const container = document.getElementById('globalBoxList');
    if (!container || typeof BoxRegistry === 'undefined') return;

    // Кнопка «Нет» (по умолчанию)
    const noneBtn = document.createElement('button');
    noneBtn.className = 'global-box-btn active';
    noneBtn.dataset.boxId = '';
    noneBtn.textContent = '✕ Нет';
    noneBtn.title = 'Без глобальной рамки';
    container.appendChild(noneBtn);

    BoxRegistry.all.forEach(style => {
      const btn = document.createElement('button');
      btn.className = 'global-box-btn';
      btn.dataset.boxId = style.id;
      btn.textContent = `${style.icon} ${style.label}`;
      btn.title = style.label;
      btn.style.setProperty('--gbx-col', style.uiColor);
      container.appendChild(btn);
    });

    container.addEventListener('click', e => {
      const btn = e.target.closest('.global-box-btn');
      if (!btn) return;
      container.querySelectorAll('.global-box-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      params.globalBoxId = btn.dataset.boxId || null;
    });
  }

  /* ── HELPERS ───────────────────────────────── */
  function bind(id, ev, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  }

  function resetSprings() {
    Object.values(springs).forEach(s => s.reset(s.target));
  }

  function setStatus(type, text) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = text.toUpperCase();
  }

  function setStatusDot(cls) {
    const el = document.getElementById('statusDot');
    if (el) el.className = `status-dot ${cls}`;
  }

  function fmtTime(s) {
    if (isNaN(s)) return '00:00';
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Loop control (для ExportEngine: останавливаем живой рендер
  //    на время экспорта, чтобы его draw()-вызовы не мутировали
  //    глобальный state BackgroundEngine — musicZoomSpring и пр.)
  function pauseLoop() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }
  function resumeLoop() {
    if (rafId == null) {
      lastT = performance.now();
      rafId = requestAnimationFrame(render);
    }
  }

  return {
    init: initUI,
    getState: () => ({ lyrics, params }),
    pauseLoop,
    resumeLoop,
  };
})();