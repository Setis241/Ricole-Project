/* ═══════════════════════════════════════════════════════════════════════════
   js/BackgroundManager.js   v1
   ─────────────────────────────────────────────────────────────────────────
   Менеджер множественных фоновых картинок/видео.
   Каждый фон имеет полный набор настроек как у объектов в FX Editor:
     · scope: глобальный / для конкретных строк (timeline)
     · fit-режим (cover/contain/fill/stretch) + position offset
     · Ken Burns (амплитуда), Music Zoom (бас-реакция), Scroll X/Y
     · Blur, brightness/saturation/contrast/hue, vignette, tint
     · Chromatic aberration, pulse (бас), shake (бас)
     · Crossfade in/out (секунды) между активными фонами
   ─────────────────────────────────────────────────────────────────────────
   API:
     BackgroundManager.init()                       — создаёт DOM и подключает события
     BackgroundManager.open()                       — открыть модалку
     BackgroundManager.close()                      — закрыть модалку
     BackgroundManager.addEntry(file)               — добавить фон из File
     BackgroundManager.removeEntry(id)              — удалить
     BackgroundManager.updateEntry(id, props)       — обновить параметры
     BackgroundManager.tick(activeLineIdx, dt)      — каждый кадр перед draw()
     BackgroundManager.draw(ctx, cw, ch, b, t, dt)  — отрисовка активного фона
     BackgroundManager.playVideos() / stopVideos() / pauseVideos()
     BackgroundManager.hasEntries                   — getter (boolean)
     BackgroundManager.entries                      — getter (array)
     BackgroundManager.setLines(lines)              — список строк лирики (для timeline-скоупа)
═══════════════════════════════════════════════════════════════════════════ */
const BackgroundManager = (() => {

  /* ── State ────────────────────────────────────────────────────────────── */
  const entries = [];           // массив BG-сущностей
  let lyricLines = [];          // [{time, text}] — для UI выбора строк
  let modalEl = null;           // корень модалки
  let _selectedEntryId = null;  // выделенный для превью
  const _collapsed = new Set(); // id свёрнутых карточек

  // Транзишены
  let _activeId   = null;       // текущий «активный» entry.id
  let _outgoing   = null;       // { entry, fade, fadeSpeed, snapshot? }
  let _activeFade = 0;          // 0..1 fade-in для нового активного
  let _activeFadeSpeed = 0;

  // Off-screen buffer для пост-обработки (blur и chromatic)
  let _offCanvas = null, _offCtx = null;
  let _ghostCanvas = null, _ghostCtx = null;

  let _onChange = null;

  // Временные оверрайды камеры от тегов FX Editor (/ZOOM IN/, /SCROLL LEFT/ и т.д.)
  // null = использовать настройку самого entry; true/false/число = принудительное значение
  let _fxCamOverride = {
    musicZoom: null, musicZoomInvert: null,
    scrollX: null, scrollXDir: null,
    scrollY: null, scrollYDir: null,
  };

  // ── Persistence: подавляем autosave во время restore (иначе перепишем) ──
  let _restoring = false;
  let _autosaveTimer = null;
  const AUTOSAVE_DEBOUNCE_MS = 300;

  /* ── Defaults для новой записи ───────────────────────────────────────── */
  function defaults(file, type) {
    return {
      id:        `bg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name:      file ? file.name : 'BG',
      type:      type || 'image',     // 'image' | 'video'
      media:     null,
      url:       null,
      enabled:   true,

      // ── Видимость ──
      scope:         'global',        // 'global' | 'timeline'
      selectedLines: [],

      // ── Геометрия ──
      fitMode:   'cover',             // 'cover' | 'contain' | 'fill' | 'stretch'
      scale:     1.0,                 // 1..3 (поверх cover-fit)
      offsetX:   0,                   // -50..50 %
      offsetY:   0,
      rotation:  0,                   // -180..180 deg

      // ── Камера: Ken Burns ──
      kenBurns:        true,
      kenBurnsAmount:  0.5,           // 0..1 (амплитуда дыхания + пана)

      // ── Камера: Music Zoom (реакция на бас) ──
      musicZoom:       false,
      musicZoomAmount: 0.4,           // 0..1.5
      musicZoomInvert: false,

      // ── Камера: Scroll ──
      scrollX:         false,
      scrollXSpeed:    0.05,          // 0.005..0.5
      scrollXDir:      1,             // +1 / -1
      scrollY:         false,
      scrollYSpeed:    0.05,
      scrollYDir:      1,

      // ── Цветокор / Blur ──
      opacity:    1.0,                // 0..1
      blur:       0,                  // 0..1 (×30px)
      brightness: 100,                // 0..200
      saturation: 100,                // 0..200
      contrast:   100,                // 0..200
      hue:        0,                  // -180..180 deg

      // ── Эффекты-наложения ──
      vignette:        false,
      vignetteAmount:  0.5,
      tint:            '#000000',
      tintAmount:      0,             // 0..1
      chromatic:       false,
      chromaticAmount: 0.5,

      // ── Аудио-реактивные ──
      pulse:           false,
      pulseAmount:     0.3,
      shake:           false,
      shakeAmount:     0.3,

      // ── Crossfade (секунды) ──
      fadeIn:   0.5,
      fadeOut:  0.5,

      // ── Runtime state (не сериализуется в presets) ──
      _kbX: 0, _kbY: 0,
      _kbVx: 0.00025 + Math.random() * 0.0002,
      _kbVy: 0.00018 + Math.random() * 0.00015,
      _scrollPosX: 0,
      _scrollPosY: 0,
      _bassSmooth: 0,
      _zoomSmooth: 0,
    };
  }

  /* ── Notify внешним подписчикам ──────────────────────────────────────── */
  // ВАЖНО: Мы НЕ дёргаем PresetManager.scheduleAutosave отсюда. У PresetManager
  // своё автосохранение (lyrics + overlays + общие настройки), оно завязано на
  // DOM-listeners и работает независимо. Если мы будем триггерить его из _notify,
  // получаем гонку при restore: наш восстановленный entry → _notify() →
  // scheduleAutosave() читает текущее (пустое) состояние lyrics/overlays и
  // перетирает ими сохранённые. У BackgroundManager своя отдельная IDB-база
  // (chromatype_bgm) — больше никаких взаимодействий не нужно.
  function setOnChangeCallback(cb) { _onChange = cb; }
  function _notify() {
    if (typeof _onChange === 'function') { try { _onChange(); } catch(e) {} }
    // Перерисовываем превью при любом изменении настроек
    if (modalEl && modalEl.style.display === 'flex') {
      if (_previewAnim) {
        // Анимация запущена — если цикл вдруг завис (ошибка убила RAF),
        // перезапускаем его; иначе следующий кадр сам подхватит изменение
        if (!_previewRaf) {
          _previewLastT = 0;
          _previewT0    = 0;
          _previewLoop();
        }
      } else {
        // Анимация не запущена — рисуем статично прямо сейчас
        try { _drawPreviewStatic(); } catch(err) { console.error('[BGM] _notify drawStatic error:', err); }
      }
    }
    // Авто-сохранение настроек ТОЛЬКО в нашу IDB-базу (debounced).
    if (!_restoring && typeof BackgroundManagerStorage !== 'undefined') {
      if (_autosaveTimer) clearTimeout(_autosaveTimer);
      _autosaveTimer = setTimeout(() => {
        _autosaveTimer = null;
        try {
          BackgroundManagerStorage.saveSettings(toJSON())
            .catch(err => console.warn('[BGM] saveSettings fail:', err));
        } catch(err) { console.warn('[BGM] saveSettings throw:', err); }
      }, AUTOSAVE_DEBOUNCE_MS);
    }
  }

  /* ── Сериализация / десериализация (для Preset/Autosave) ───────────────── */
  // Возвращает массив plain-JS объектов с настройками всех entry.
  // Сами медиафайлы (img/video) НЕ сериализуются — они должны быть отдельно
  // (как у BackgroundEngine: пресет хранит исходный File, переподнимает media).
  function toJSON() {
    return entries.map(e => ({
      id:               e.id,
      name:             e.name,
      type:             e.type,
      enabled:          e.enabled,
      scope:            e.scope,
      selectedLines:    Array.from(e.selectedLines || []),
      fitMode:          e.fitMode,
      scale:            e.scale,
      offsetX:          e.offsetX,
      offsetY:          e.offsetY,
      rotation:         e.rotation,
      kenBurns:         e.kenBurns,
      kenBurnsAmount:   e.kenBurnsAmount,
      musicZoom:        e.musicZoom,
      musicZoomAmount:  e.musicZoomAmount,
      musicZoomInvert:  e.musicZoomInvert,
      scrollX:          e.scrollX,
      scrollXSpeed:     e.scrollXSpeed,
      scrollXDir:       e.scrollXDir,
      scrollY:          e.scrollY,
      scrollYSpeed:     e.scrollYSpeed,
      scrollYDir:       e.scrollYDir,
      opacity:          e.opacity,
      blur:             e.blur,
      brightness:       e.brightness,
      saturation:       e.saturation,
      contrast:         e.contrast,
      hue:              e.hue,
      vignette:         e.vignette,
      vignetteAmount:   e.vignetteAmount,
      tint:             e.tint,
      tintAmount:       e.tintAmount,
      chromatic:        e.chromatic,
      chromaticAmount:  e.chromaticAmount,
      pulse:            e.pulse,
      pulseAmount:      e.pulseAmount,
      shake:            e.shake,
      shakeAmount:      e.shakeAmount,
      fadeIn:           e.fadeIn,
      fadeOut:          e.fadeOut,
    }));
  }

  // Применяет сохранённые настройки к УЖЕ ЗАГРУЖЕННЫМ entry.
  // Вызывается ПОСЛЕ того как addEntry загрузит файлы — настройки
  // применяются по индексу (порядок entries должен совпадать).
  // Не пересоздаёт записи — просто обновляет props.
  function fromJSON(arr) {
    if (!Array.isArray(arr)) return;
    arr.forEach((cfg, i) => {
      const e = entries[i];
      if (!e) return;
      Object.keys(cfg).forEach(key => {
        if (key === 'id' || key === 'type' || key === 'name') return; // не трогаем
        if (cfg[key] !== undefined) e[key] = cfg[key];
      });
    });
    _notify();
  }

  // Полный сброс — удаляет все entry (с освобождением URL'ов)
  // opts.wipeStorage = true → также чистит IndexedDB (по умолчанию true)
  async function clear(opts = {}) {
    const wipeStorage = opts.wipeStorage !== false;
    while (entries.length) {
      const e = entries.pop();
      if (e && e.url) try { URL.revokeObjectURL(e.url); } catch(_) {}
      if (e && e.type === 'video' && e.media) { try { e.media.pause(); } catch(_) {} }
    }
    _activeId = null; _outgoing = null;
    _activeFade = 0; _activeFadeSpeed = 0;
    _selectedEntryId = null;
    if (wipeStorage && typeof BackgroundManagerStorage !== 'undefined') {
      try { await BackgroundManagerStorage.clearAll(); } catch(err) { console.warn('[BGM] clearAll fail:', err); }
    }
    _notify();
    if (modalEl) renderEntryList();
    updateUiBadge();
  }

  /* ── Восстановление из IndexedDB после перезагрузки страницы ───────────── */
  // Идея:
  //   1. Загружаем массив настроек (по 'all').
  //   2. Для каждой настройки вытаскиваем файл из store по entry.id.
  //   3. Регистрируем entry с preserveId/skipPersist (чтобы не пересохранять).
  //   4. Применяем настройки через прямую мутацию (порядок entries совпадает
  //      с порядком в settings JSON).
  //   5. Снимаем _restoring и зовём _notify один раз.
  async function restoreFromStorage() {
    if (typeof BackgroundManagerStorage === 'undefined') return false;

    let settings;
    try { settings = await BackgroundManagerStorage.loadSettings(); }
    catch(err) { console.warn('[BGM] loadSettings fail:', err); return false; }

    if (!Array.isArray(settings) || !settings.length) return false;

    _restoring = true;
    try {
      for (const cfg of settings) {
        if (!cfg || !cfg.id) continue;
        let file;
        try { file = await BackgroundManagerStorage.loadFile(cfg.id); }
        catch(err) { console.warn('[BGM] loadFile fail for', cfg.id, err); continue; }
        if (!file) continue;

        try {
          const e = await addEntry(file, { preserveId: cfg.id, skipPersist: true });
          // Применяем все settings (кроме id/type/name — уже выставлены)
          Object.keys(cfg).forEach(key => {
            if (key === 'id' || key === 'type' || key === 'name') return;
            if (cfg[key] !== undefined) e[key] = cfg[key];
          });
        } catch(err) {
          console.warn('[BGM] addEntry during restore fail:', err);
        }
      }
    } finally {
      _restoring = false;
    }

    _notify();
    if (modalEl) renderEntryList();
    updateUiBadge();
    return entries.length > 0;
  }

  /* ── Сброс runtime-состояния для чистого старта экспорта ──────────────── */
  // Не удаляет entry, только обнуляет KB позиции, scroll-позиции, smoothing'и.
  // Это аналог BackgroundEngine._forceResetSprings — гарантирует что экспорт
  // начинается с того же визуального состояния, что и превью с нуля.
  function _forceReset() {
    entries.forEach(e => {
      e._kbX = 0; e._kbY = 0;
      e._kbVx = 0.00025 + Math.random() * 0.0002;
      e._kbVy = 0.00018 + Math.random() * 0.00015;
      e._scrollPosX = 0;
      e._scrollPosY = 0;
      e._bassSmooth = 0;
      e._zoomSmooth = 0;
      // Сбрасываем видео в начало
      if (e.type === 'video' && e.media) {
        try { e.media.pause(); e.media.currentTime = 0; } catch(_) {}
      }
    });
    _activeId = null; _outgoing = null;
    _activeFade = 0; _activeFadeSpeed = 0;
    _fxCamOverride.musicZoom = null; _fxCamOverride.musicZoomInvert = null;
    _fxCamOverride.scrollX   = null; _fxCamOverride.scrollXDir      = null;
    _fxCamOverride.scrollY   = null; _fxCamOverride.scrollYDir      = null;
  }

  /* ── Активные видео-элементы (для seek в экспорте) ────────────────────── */
  // Возвращает массив { entry, video } для всех entry с type='video',
  // у которых сейчас идёт fade-in или fade-out (т.е. "видны на экране").
  // ExportEngine сам решает что seek'ать.
  function _activeVideos() {
    const out = [];
    if (_activeId) {
      const e = entries.find(x => x.id === _activeId);
      if (e && e.type === 'video' && e.media) out.push({ entry: e, video: e.media });
    }
    if (_outgoing && _outgoing.entry) {
      const e = _outgoing.entry;
      if (e.type === 'video' && e.media) out.push({ entry: e, video: e.media });
    }
    return out;
  }

  /* ── Регистрация контекста лирики ─────────────────────────────────────── */
  function setLines(lines) {
    lyricLines = Array.isArray(lines) ? lines : [];
    // Обновляем UI если открыт line-selector
    if (modalEl && modalEl.style.display === 'flex') {
      const lsPanel = modalEl.querySelector('#bgmLsPanel');
      if (lsPanel && lsPanel.style.display === 'flex') {
        renderLineSelector();
      }
    }
  }

  /* ── Public: добавление фона ─────────────────────────────────────────── */
  // opts.preserveId — для restore: использовать сохранённый id вместо нового
  // opts.skipPersist — для restore: не сохранять файл обратно в IndexedDB
  async function addEntry(file, opts = {}) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const isVideo = (file.type || '').startsWith('video/');
      const finish = (e) => {
        if (opts.preserveId) e.id = opts.preserveId;
        entries.push(e);
        // Сохраняем сам файл в IndexedDB (если не restore)
        if (!opts.skipPersist && typeof BackgroundManagerStorage !== 'undefined') {
          BackgroundManagerStorage.saveFile(e.id, file)
            .catch(err => console.warn('[BGM] saveFile fail:', err));
        }
        _notify();
        if (modalEl && modalEl.style.display === 'flex') renderEntryList();
        updateUiBadge();
        resolve(e);
      };
      if (isVideo) {
        const vid = document.createElement('video');
        vid.src = url;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'auto';
        vid.onloadeddata = () => {
          const e = defaults(file, 'video');
          e.media = vid; e.url = url;
          finish(e);
        };
        vid.onerror = reject;
      } else {
        const img = new Image();
        img.onload = () => {
          const e = defaults(file, 'image');
          e.media = img; e.url = url;
          finish(e);
        };
        img.onerror = reject;
        img.src = url;
      }
    });
  }

  // Заменяет медиа (картинку или видео) существующей entry на новое из файла.
  // Сохраняет все настройки (scale, offsetX/Y, kenBurns, blur, scope, selectedLines, etc.) — меняется только media/url/name/type.
  async function replaceEntryMedia(id, file) {
    return new Promise((resolve, reject) => {
      const entry = entries.find(x => x.id === id);
      if (!entry) { reject(new Error('entry not found')); return; }
      const url = URL.createObjectURL(file);
      const isVideo = (file.type || '').startsWith('video/');
      const oldUrl = entry.url;
      const oldMedia = entry.media;
      const finish = (newMedia, newType) => {
        // Освобождаем старое
        if (oldUrl) { try { URL.revokeObjectURL(oldUrl); } catch (_) {} }
        if (oldMedia && oldMedia.tagName === 'VIDEO') {
          try { oldMedia.pause(); oldMedia.src = ''; oldMedia.load(); } catch (_) {}
        }
        entry.media = newMedia;
        entry.url = url;
        entry.name = file.name;
        entry.type = newType;
        // Сбрасываем runtime-state, чтобы не было артефактов от старого медиа
        entry._kbX = 0; entry._kbY = 0; entry._scrollPosX = 0; entry._scrollPosY = 0;
        // Сохраняем новый файл в IndexedDB
        if (typeof BackgroundManagerStorage !== 'undefined') {
          BackgroundManagerStorage.saveFile(id, file)
            .catch(err => console.warn('[BGM] saveFile (replace) fail:', err));
        }
        _notify();
        if (modalEl && modalEl.style.display === 'flex') renderEntryList();
        updateUiBadge();
        resolve(entry);
      };
      if (isVideo) {
        const vid = document.createElement('video');
        vid.src = url;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'auto';
        vid.onloadeddata = () => finish(vid, 'video');
        vid.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      } else {
        const img = new Image();
        img.onload = () => finish(img, 'image');
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
      }
    });
  }

  function removeEntry(id) {
    const idx = entries.findIndex(e => e.id === id);
    if (idx < 0) return;
    const e = entries[idx];
    if (e.url) try { URL.revokeObjectURL(e.url); } catch(_) {}
    if (e.type === 'video' && e.media) { try { e.media.pause(); } catch(_) {} }
    entries.splice(idx, 1);
    if (_activeId === id) _activeId = null;
    if (_selectedEntryId === id) _selectedEntryId = null;
    // Удаляем файл из IndexedDB
    if (typeof BackgroundManagerStorage !== 'undefined') {
      BackgroundManagerStorage.deleteFile(id).catch(err => console.warn('[BGM] deleteFile fail:', err));
    }
    _notify();
    if (modalEl) renderEntryList();
    updateUiBadge();
  }

  function updateEntry(id, props) {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    Object.assign(e, props);
    _notify();
  }

  function moveEntry(id, delta) {
    const idx = entries.findIndex(e => e.id === id);
    if (idx < 0) return;
    const target = Math.max(0, Math.min(entries.length - 1, idx + delta));
    if (target === idx) return;
    const [item] = entries.splice(idx, 1);
    entries.splice(target, 0, item);
    _notify();
    renderEntryList();
  }

  /* ── Резолв активного entry ──────────────────────────────────────────── */
  function _resolveActive(activeLineIdx) {
    // Идём с КОНЦА списка — последний eligible побеждает.
    // (визуально верх списка = "более старый" фон, низ списка — "поверх")
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (!e.enabled) continue;
      if (e.scope === 'timeline') {
        if (!Array.isArray(e.selectedLines) || e.selectedLines.length === 0) continue;
        if (!e.selectedLines.includes(activeLineIdx)) continue;
        return e;
      }
      // global
      return e;
    }
    return null;
  }

  /* ── Обновление видеоэлементов — играет только активный ─────────────── */
  function _syncVideoPlayback() {
    entries.forEach(e => {
      if (e.type !== 'video' || !e.media) return;
      const isActive = (e.id === _activeId) || (_outgoing && _outgoing.entry.id === e.id);
      if (isActive) {
        if (e.media.paused) e.media.play().catch(() => {});
      } else {
        if (!e.media.paused) e.media.pause();
      }
    });
  }

  function playVideos() {
    if (_activeId) {
      const e = entries.find(x => x.id === _activeId);
      if (e && e.type === 'video' && e.media) e.media.play().catch(() => {});
    }
  }
  function stopVideos() {
    entries.forEach(e => {
      if (e.type === 'video' && e.media) {
        try { e.media.pause(); e.media.currentTime = 0; } catch(_) {}
      }
    });
  }
  function pauseVideos() {
    entries.forEach(e => {
      if (e.type === 'video' && e.media) { try { e.media.pause(); } catch(_) {} }
    });
  }

  /* ── Tick: вызывается из render loop в App.js перед draw ─────────────── */
  function tick(activeLineIdx, dt) {
    const next = _resolveActive(activeLineIdx);
    const nextId = next ? next.id : null;

    if (nextId !== _activeId) {
      // Старый — на «выход»
      const oldEntry = _activeId ? entries.find(e => e.id === _activeId) : null;
      if (oldEntry) {
        const fadeOutSec = Math.max(0.001, oldEntry.fadeOut || 0.001);
        _outgoing = {
          entry: oldEntry,
          fade: _activeFade,         // продолжаем с текущего значения
          fadeSpeed: 1 / fadeOutSec,
        };
      } else {
        _outgoing = null;
      }
      // Новый — на «вход»
      _activeId = nextId;
      _activeFade = 0;
      _activeFadeSpeed = next ? (1 / Math.max(0.001, next.fadeIn || 0.001)) : 0;
    }

    // Тикаем fade-in
    if (_activeFade < 1) {
      _activeFade = Math.min(1, _activeFade + _activeFadeSpeed * Math.max(dt, 0.001));
    }
    // Тикаем fade-out
    if (_outgoing) {
      _outgoing.fade -= _outgoing.fadeSpeed * Math.max(dt, 0.001);
      if (_outgoing.fade <= 0) _outgoing = null;
    }

    _syncVideoPlayback();
  }

  /* ── Off-screen buffers ──────────────────────────────────────────────── */
  function _ensureOff(cw, ch) {
    if (!_offCanvas || _offCanvas.width !== cw || _offCanvas.height !== ch) {
      _offCanvas = document.createElement('canvas');
      _offCanvas.width = cw; _offCanvas.height = ch;
      _offCtx = _offCanvas.getContext('2d');
    }
  }
  function _ensureGhost(cw, ch) {
    if (!_ghostCanvas || _ghostCanvas.width !== cw || _ghostCanvas.height !== ch) {
      _ghostCanvas = document.createElement('canvas');
      _ghostCanvas.width = cw; _ghostCanvas.height = ch;
      _ghostCtx = _ghostCanvas.getContext('2d');
    }
  }

  /* ── Рендер одного entry (возвращает true если нарисовал) ─────────────── */
  function _drawEntry(targetCtx, e, alpha, cw, ch, bands, t, dt) {
    if (!e || !e.media) return false;
    if (alpha <= 0.001) return false;

    const m  = e.media;
    const mw = e.type === 'video' ? m.videoWidth  : m.naturalWidth;
    const mh = e.type === 'video' ? m.videoHeight : m.naturalHeight;
    if (!mw || !mh) return false;

    // Сглаживание баса для этой записи (с её собственным state)
    e._bassSmooth += (bands.bass - e._bassSmooth) * Math.min(1, dt * 10);
    e._zoomSmooth += (bands.bass - e._zoomSmooth) * Math.min(1, dt * (bands.bass > e._zoomSmooth ? 50 : 4));

    // Эффективные настройки камеры: оверрайды от FX Editor тегов поверх entry
    const _mz     = _fxCamOverride.musicZoom       !== null ? _fxCamOverride.musicZoom       : e.musicZoom;
    const _mzInv  = _fxCamOverride.musicZoomInvert  !== null ? _fxCamOverride.musicZoomInvert : e.musicZoomInvert;
    const _sx     = _fxCamOverride.scrollX          !== null ? _fxCamOverride.scrollX         : e.scrollX;
    const _sxDir  = _fxCamOverride.scrollXDir       !== null ? _fxCamOverride.scrollXDir      : e.scrollXDir;
    const _sy     = _fxCamOverride.scrollY          !== null ? _fxCamOverride.scrollY         : e.scrollY;
    const _syDir  = _fxCamOverride.scrollYDir       !== null ? _fxCamOverride.scrollYDir      : e.scrollYDir;

    // ── Базовый масштаб от fit-режима ────────────────────────────────────
    let baseScale;
    let stretchW = mw, stretchH = mh;
    switch (e.fitMode) {
      case 'contain':
        baseScale = Math.min(cw / mw, ch / mh);
        break;
      case 'fill':
        baseScale = Math.max(cw / mw, ch / mh);
        break;
      case 'stretch':
        // Принудительно растягиваем под холст
        baseScale = 1;
        stretchW = cw;
        stretchH = ch;
        break;
      default: // cover
        baseScale = Math.max(cw / mw, ch / mh);
    }

    // ── Зум ──────────────────────────────────────────────────────────────
    let zoom = e.scale || 1.0;

    // Ken Burns "дыхание"
    if (e.kenBurns && e.fitMode !== 'stretch') {
      const amp = (e.kenBurnsAmount || 0.5);
      zoom += amp * 0.06 + amp * bands.bass * 0.03 + amp * Math.sin(t * 0.21) * 0.015;
    }

    // Music Zoom (бас-реакция)
    if (_mz) {
      const amt = (e.musicZoomAmount || 0.4);
      const dir = _mzInv ? -1 : 1;
      const baseOffset = 0.18 * (amt / 0.4);
      zoom += baseOffset + dir * e._zoomSmooth * 1.0 * (amt / 0.4);
    }

    // Pulse (бас-реакция, отдельный от zoom — общий scale-bump)
    let pulseScale = 1;
    if (e.pulse) {
      pulseScale = 1 + e._bassSmooth * 0.18 * (e.pulseAmount || 0.3);
    }

    // Гарантия покрытия
    if (e.fitMode !== 'stretch') zoom = Math.max(1.0, zoom);

    // ── Размеры финального изображения ───────────────────────────────────
    let drawW, drawH;
    if (e.fitMode === 'stretch') {
      drawW = stretchW * zoom * pulseScale;
      drawH = stretchH * zoom * pulseScale;
    } else {
      const total = baseScale * zoom * pulseScale;
      drawW = mw * total;
      drawH = mh * total;
    }

    // ── Ken Burns пан ────────────────────────────────────────────────────
    let kbX = 0, kbY = 0;
    if (e.kenBurns && e.fitMode !== 'stretch') {
      const amp = (e.kenBurnsAmount || 0.5);
      if (!_sx) {
        e._kbX += e._kbVx * amp;
        if (Math.abs(e._kbX) > 0.04) e._kbVx *= -1;
        kbX = e._kbX * Math.max(0, drawW - cw) * 0.5;
      }
      if (!_sy) {
        e._kbY += e._kbVy * amp;
        if (Math.abs(e._kbY) > 0.04) e._kbVy *= -1;
        kbY = e._kbY * Math.max(0, drawH - ch) * 0.5;
      }
    }

    // ── Scroll позиции ───────────────────────────────────────────────────
    if (_sx) {
      e._scrollPosX += _sxDir * (e.scrollXSpeed || 0.05) * drawW * dt;
      if (drawW > 0) {
        if (e._scrollPosX < 0) e._scrollPosX += drawW;
        e._scrollPosX = e._scrollPosX % drawW;
      }
    }
    if (_sy) {
      e._scrollPosY += _syDir * (e.scrollYSpeed || 0.05) * drawH * dt;
      if (drawH > 0) {
        if (e._scrollPosY < 0) e._scrollPosY += drawH;
        e._scrollPosY = e._scrollPosY % drawH;
      }
    }

    // ── Shake (мгновенный джиттер от баса) ───────────────────────────────
    let shakeX = 0, shakeY = 0;
    if (e.shake) {
      const sa = (e.shakeAmount || 0.3) * 30;
      shakeX = (Math.random() - 0.5) * e._bassSmooth * sa;
      shakeY = (Math.random() - 0.5) * e._bassSmooth * sa;
    }

    // ── Position offset (в % от холста) ──────────────────────────────────
    const offX = (e.offsetX || 0) * cw / 100;
    const offY = (e.offsetY || 0) * ch / 100;

    // ── Целевой контекст: если нужен blur — рисуем сначала на off-screen.
    // ВАЖНО: _ensureOff() должен выполниться ДО того как мы захватим drawCtx,
    // иначе _offCtx === null и любая запись свойств бросит ошибку.
    const needsBlur = (e.blur || 0) > 0.001;
    if (needsBlur) {
      _ensureOff(cw, ch);
      _offCtx.clearRect(0, 0, cw, ch);
    }
    const drawCtx = needsBlur ? _offCtx : targetCtx;

    // ── Применяем CSS-фильтры (brightness/saturation/contrast/hue/blur) ──
    const filterParts = [];
    if (e.brightness !== 100) filterParts.push(`brightness(${e.brightness}%)`);
    if (e.saturation !== 100) filterParts.push(`saturate(${e.saturation}%)`);
    if (e.contrast   !== 100) filterParts.push(`contrast(${e.contrast}%)`);
    if (e.hue        !== 0)   filterParts.push(`hue-rotate(${e.hue}deg)`);
    if (filterParts.length) drawCtx.filter = filterParts.join(' ');
    else drawCtx.filter = 'none';

    drawCtx.save();
    drawCtx.globalAlpha = e.opacity * (needsBlur ? 1 : alpha);

    // Базовые координаты для центрирования
    const baseDx = (cw - drawW) / 2 + offX + shakeX - kbX;
    const baseDy = (ch - drawH) / 2 + offY + shakeY - kbY;

    // Поворот вокруг центра холста
    if (e.rotation) {
      drawCtx.translate(cw / 2, ch / 2);
      drawCtx.rotate(e.rotation * Math.PI / 180);
      drawCtx.translate(-cw / 2, -ch / 2);
    }

    // Хроматическая аберрация: 3 прохода (R/G/B сдвиги)
    if (e.chromatic && bands.high > 0.05 && e.fitMode !== 'stretch') {
      const offset = (e.chromaticAmount || 0.5) * bands.high * 8;
      drawCtx.globalCompositeOperation = 'lighter';
      drawCtx.fillStyle = 'rgba(0,0,0,0)';
      // Простая версия: рисуем 3 раза с цветовыми каналами через filter
      drawCtx.save();
      drawCtx.filter = (filterParts.length ? filterParts.join(' ') + ' ' : '') + 'sepia(1) hue-rotate(0deg) saturate(8)';
      _drawTiled(drawCtx, e, m, baseDx + offset, baseDy, drawW, drawH);
      drawCtx.restore();
      drawCtx.save();
      drawCtx.filter = (filterParts.length ? filterParts.join(' ') + ' ' : '') + 'sepia(1) hue-rotate(120deg) saturate(8)';
      _drawTiled(drawCtx, e, m, baseDx, baseDy, drawW, drawH);
      drawCtx.restore();
      drawCtx.save();
      drawCtx.filter = (filterParts.length ? filterParts.join(' ') + ' ' : '') + 'sepia(1) hue-rotate(240deg) saturate(8)';
      _drawTiled(drawCtx, e, m, baseDx - offset, baseDy, drawW, drawH);
      drawCtx.restore();
      drawCtx.globalCompositeOperation = 'source-over';
    } else {
      _drawTiled(drawCtx, e, m, baseDx, baseDy, drawW, drawH);
    }

    drawCtx.restore();
    drawCtx.filter = 'none';
    drawCtx.globalAlpha = 1;

    // ── Если нужен blur — multi-pass box blur через смещения ────────────
    if (needsBlur) {
      const blurPx = Math.round(30 * e.blur);
      const passes = 3;
      const step   = blurPx / passes;
      const passA  = 1 / (passes * 2 + 1);
      targetCtx.save();
      // Применяем итоговый alpha (entry.opacity * fade) при композите
      targetCtx.globalAlpha = e.opacity * alpha * passA;
      targetCtx.drawImage(_offCanvas, 0, 0);
      for (let p = 1; p <= passes; p++) {
        const o = Math.round(step * p);
        targetCtx.drawImage(_offCanvas,  o,  0);
        targetCtx.drawImage(_offCanvas, -o,  0);
        targetCtx.drawImage(_offCanvas,  0,  o);
        targetCtx.drawImage(_offCanvas,  0, -o);
      }
      targetCtx.globalAlpha = 1;
      targetCtx.restore();
    }

    // ── Tint overlay (поверх фона) ───────────────────────────────────────
    if ((e.tintAmount || 0) > 0.001) {
      targetCtx.save();
      targetCtx.fillStyle = e.tint || '#000000';
      targetCtx.globalAlpha = e.tintAmount * alpha;
      targetCtx.fillRect(0, 0, cw, ch);
      targetCtx.globalAlpha = 1;
      targetCtx.restore();
    }

    // ── Vignette ─────────────────────────────────────────────────────────
    if (e.vignette) {
      const amt = (e.vignetteAmount || 0.5);
      const innerR = Math.min(cw, ch) * (0.45 - bands.bass * 0.08 * amt);
      const outerR = Math.sqrt(cw * cw + ch * ch) / 2;
      const grad = targetCtx.createRadialGradient(cw / 2, ch / 2, innerR, cw / 2, ch / 2, outerR);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${0.55 * amt + bands.bass * 0.15 * amt})`);
      targetCtx.save();
      targetCtx.globalAlpha = alpha;
      targetCtx.fillStyle = grad;
      targetCtx.fillRect(0, 0, cw, ch);
      targetCtx.restore();
    }

    return true;
  }

  // Помощник: рисует медиа с учётом scroll (тайлинг по активным осям)
  function _drawTiled(ctx, e, m, dx, dy, dw, dh) {
    const effX = _fxCamOverride.scrollX !== null ? _fxCamOverride.scrollX : e.scrollX;
    const effY = _fxCamOverride.scrollY !== null ? _fxCamOverride.scrollY : e.scrollY;
    if (!effX && !effY) {
      ctx.drawImage(m, dx, dy, dw, dh);
      return;
    }
    const txMin = effX ? -1 : 0;
    const txMax = effX ?  1 : 0;
    const tyMin = effY ? -1 : 0;
    const tyMax = effY ?  1 : 0;
    const sx = effX ? e._scrollPosX : 0;
    const sy = effY ? e._scrollPosY : 0;
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        ctx.drawImage(m, dx + tx * dw - sx, dy + ty * dh - sy, dw, dh);
      }
    }
  }

  /* ── Public draw ─────────────────────────────────────────────────────── */
  function draw(ctx, cw, ch, bands, t, dt) {
    // Чистим холст в чёрный
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);

    // Outgoing entry (плавно затухает)
    if (_outgoing && _outgoing.entry && _outgoing.fade > 0.001) {
      _drawEntry(ctx, _outgoing.entry, _outgoing.fade, cw, ch, bands, t, dt);
    }

    // Активный entry (плавно нарастает)
    const active = _activeId ? entries.find(e => e.id === _activeId) : null;
    if (active) {
      _drawEntry(ctx, active, _activeFade, cw, ch, bands, t, dt);
    }
  }

  /* ───────────────────────────────────────────────────────────────────────
     UI: модалка менеджера
  ─────────────────────────────────────────────────────────────────────────*/
  function init() {
    if (modalEl) return;
    _injectStyles();
    _createModal();
  }

  function open() {
    if (!modalEl) init();
    modalEl.style.display = 'flex';
    renderEntryList();
  }

  function close() {
    if (modalEl) modalEl.style.display = 'none';
  }

  function _createModal() {
    modalEl = document.createElement('div');
    modalEl.id = 'bgManagerOverlay';
    modalEl.innerHTML = `
<div class="bgm-backdrop"></div>
<div class="bgm-modal">

  <div class="bgm-header">
    <span class="bgm-title">МЕНЕДЖЕР ФОНОВ</span>
    <span class="bgm-sub">// несколько фонов с богатой настройкой · scope глобальный или per-line · crossfade · автосохранение</span>
    <div class="bgm-hdr-right">
      <button class="bgm-btn bgm-btn-accent" id="bgmAddBtn">+ Добавить фон</button>
      <input type="file" id="bgmAddFile" accept="image/*,video/*" multiple style="display:none" />
      <button class="bgm-btn bgm-btn-ghost" id="bgmClearAllBtn" title="Удалить все фоны и настройки">🗑 Очистить</button>
      <button class="bgm-btn bgm-btn-ghost" id="bgmCloseBtn">✕</button>
    </div>
  </div>

  <div class="bgm-body">
    <div class="bgm-list-wrap">
      <div class="bgm-list" id="bgmList"></div>
    </div>
    <div class="bgm-preview-wrap">
      <canvas id="bgmPreviewCanvas" width="1920" height="1080"></canvas>
      <div class="bgm-preview-hint" id="bgmPreviewHint">← Выберите фон в списке для предпросмотра</div>
      <div class="bgm-preview-controls" id="bgmPreviewControls" style="display:none;">
        <span class="bgm-preview-name" id="bgmPreviewName"></span>
        <button class="bgm-btn bgm-btn-accent bgm-preview-anim" id="bgmPreviewAnim">▶ Анимация</button>
        <button class="bgm-btn bgm-btn-ghost  bgm-preview-stop" id="bgmPreviewStop" style="display:none;">■ Стоп</button>
      </div>
    </div>
  </div>

  <!-- LINE SELECTOR PANEL (slide-out) -->
  <div class="bgm-ls-backdrop" id="bgmLsBackdrop" style="display:none;"></div>
  <div class="bgm-ls-panel" id="bgmLsPanel" style="display:none;">
    <div class="bgm-ls-header">
      <span class="bgm-ls-title">ВЫБОР СТРОК</span>
      <button class="bgm-btn bgm-btn-ghost" id="bgmLsClose">✕</button>
    </div>
    <div class="bgm-ls-toolbar">
      <button class="bgm-btn bgm-btn-ghost" id="bgmLsAll">✓ Все</button>
      <button class="bgm-btn bgm-btn-ghost" id="bgmLsNone">✕ Снять</button>
      <span class="bgm-ls-counter" id="bgmLsCounter">0 / 0</span>
    </div>
    <div class="bgm-ls-list" id="bgmLsList"></div>
  </div>

</div>`;
    document.body.appendChild(modalEl);

    // Wire up handlers
    modalEl.querySelector('#bgmCloseBtn').addEventListener('click', close);
    modalEl.querySelector('.bgm-backdrop').addEventListener('click', close);

    const addBtn  = modalEl.querySelector('#bgmAddBtn');
    const addFile = modalEl.querySelector('#bgmAddFile');
    addBtn.addEventListener('click', () => addFile.click());
    addFile.addEventListener('change', async e => {
      for (const f of Array.from(e.target.files)) {
        try { await addEntry(f); } catch(err) { console.error('addEntry failed:', err); }
      }
      addFile.value = '';
    });

    // Clear all button
    const clearAllBtn = modalEl.querySelector('#bgmClearAllBtn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async () => {
        if (!entries.length) return;
        if (!confirm(`Удалить все фоны (${entries.length}) и сбросить сохранённые настройки?`)) return;
        await clear({ wipeStorage: true });
      });
    }

    // Line-selector handlers
    modalEl.querySelector('#bgmLsClose').addEventListener('click', closeLineSelector);
    modalEl.querySelector('#bgmLsBackdrop').addEventListener('click', closeLineSelector);

    modalEl.querySelector('#bgmLsAll').addEventListener('click', () => {
      const e = entries.find(x => x.id === _lsCurrentId);
      if (!e) return;
      e.selectedLines = lyricLines.map((_, i) => i);
      _notify();
      renderLineSelector();
    });
    modalEl.querySelector('#bgmLsNone').addEventListener('click', () => {
      const e = entries.find(x => x.id === _lsCurrentId);
      if (!e) return;
      e.selectedLines = [];
      _notify();
      renderLineSelector();
    });

    // Preview anim controls
    const animBtn  = modalEl.querySelector('#bgmPreviewAnim');
    const animStop = modalEl.querySelector('#bgmPreviewStop');
    animBtn.addEventListener('click', () => {
      _previewAnim = true;
      animBtn.style.display = 'none';
      animStop.style.display = '';
      _previewLoop();
    });
    animStop.addEventListener('click', () => {
      _previewAnim = false;
      animBtn.style.display = '';
      animStop.style.display = 'none';
      if (_previewRaf) { cancelAnimationFrame(_previewRaf); _previewRaf = null; }
      _drawPreviewStatic();
    });

    document.addEventListener('keydown', (ev) => {
      if (modalEl.style.display !== 'flex') return;
      if (ev.key === 'Escape') {
        const ls = modalEl.querySelector('#bgmLsPanel');
        if (ls.style.display === 'flex') closeLineSelector();
        else close();
      }
    });
  }

  /* ── UI: Render список карточек ───────────────────────────────────────── */
  function renderEntryList() {
    if (!modalEl) return;
    const list = modalEl.querySelector('#bgmList');
    list.innerHTML = '';

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'bgm-empty';
      empty.textContent = '— Нет фонов. Нажмите «+ Добавить фон» —';
      list.appendChild(empty);
      _drawPreviewStatic();
      return;
    }

    entries.forEach((e, idx) => {
      const isCollapsed = _collapsed.has(e.id);
      const isSel = _selectedEntryId === e.id;

      const card = document.createElement('div');
      card.className = 'bgm-card'
        + (e.enabled ? '' : ' disabled')
        + (isCollapsed ? ' collapsed' : '')
        + (isSel ? ' selected' : '');

      // ── HEADER ─────────────────────────────────────────────────────────
      const header = document.createElement('div');
      header.className = 'bgm-card-header';
      header.addEventListener('click', (ev) => {
        if (ev.target.closest('button, input, select, textarea')) return;
        if (_selectedEntryId !== e.id) _selectedEntryId = e.id;
        if (_collapsed.has(e.id)) _collapsed.delete(e.id);
        else _collapsed.add(e.id);
        renderEntryList();
      });

      const collBtn = document.createElement('button');
      collBtn.className = 'bgm-coll-btn';
      collBtn.textContent = isCollapsed ? '▸' : '▾';
      collBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (_collapsed.has(e.id)) _collapsed.delete(e.id);
        else _collapsed.add(e.id);
        renderEntryList();
      });
      header.appendChild(collBtn);

      // Z-up/down
      const zBadge = document.createElement('span');
      zBadge.className = 'bgm-zbadge';
      zBadge.textContent = `#${idx + 1}`;
      header.appendChild(zBadge);

      const zUp = document.createElement('button');
      zUp.className = 'bgm-zbtn';
      zUp.textContent = '▲';
      zUp.title = 'Выше в списке';
      zUp.disabled = idx === 0;
      zUp.addEventListener('click', (ev) => { ev.stopPropagation(); moveEntry(e.id, -1); });
      header.appendChild(zUp);

      const zDn = document.createElement('button');
      zDn.className = 'bgm-zbtn';
      zDn.textContent = '▼';
      zDn.title = 'Ниже в списке (приоритет, если scope=global)';
      zDn.disabled = idx === entries.length - 1;
      zDn.addEventListener('click', (ev) => { ev.stopPropagation(); moveEntry(e.id, +1); });
      header.appendChild(zDn);

      // Thumb (кликабельный → заменить медиа)
      const thumb = document.createElement('div');
      thumb.className = 'bgm-thumb bgm-thumb-replaceable';
      thumb.title = 'Кликни, чтобы заменить картинку/видео';
      if (e.type === 'image' && e.url) {
        const img = document.createElement('img');
        img.src = e.url;
        thumb.appendChild(img);
      } else if (e.type === 'video') {
        thumb.textContent = '▶';
        thumb.classList.add('bgm-thumb-video');
      }
      // Overlay-hint при hover (↻)
      const replaceHint = document.createElement('div');
      replaceHint.className = 'bgm-thumb-replace-hint';
      replaceHint.textContent = '↻';
      thumb.appendChild(replaceHint);
      // Hidden file input
      const fileInp = document.createElement('input');
      fileInp.type = 'file';
      fileInp.accept = 'image/*,video/*';
      fileInp.style.display = 'none';
      fileInp.addEventListener('change', async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        try {
          await replaceEntryMedia(e.id, f);
          renderEntryList();
        } catch (err) {
          console.warn('[BGM] replaceEntryMedia failed', err);
        }
      });
      thumb.appendChild(fileInp);
      thumb.addEventListener('click', (ev) => {
        ev.stopPropagation();
        fileInp.click();
      });
      header.appendChild(thumb);

      const nameEl = document.createElement('span');
      nameEl.className = 'bgm-card-name';
      nameEl.textContent = e.name;
      header.appendChild(nameEl);

      // Scope chip in header
      const scopeChip = document.createElement('span');
      scopeChip.className = 'bgm-scope-chip ' + (e.scope === 'timeline' ? 'tl' : 'gl');
      scopeChip.textContent = e.scope === 'timeline' ? `⏱ ${(e.selectedLines||[]).length}` : '♾ ВЕЗДЕ';
      header.appendChild(scopeChip);

      const enBtn = document.createElement('button');
      enBtn.className = 'bgm-en-btn' + (e.enabled ? ' on' : '');
      enBtn.textContent = e.enabled ? 'ВКЛ' : 'ВЫКЛ';
      enBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        updateEntry(e.id, { enabled: !e.enabled });
        renderEntryList();
      });
      header.appendChild(enBtn);

      const remBtn = document.createElement('button');
      remBtn.className = 'bgm-rem-btn';
      remBtn.textContent = '✕';
      remBtn.title = 'Удалить';
      remBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeEntry(e.id);
      });
      header.appendChild(remBtn);

      card.appendChild(header);

      // ── BODY ───────────────────────────────────────────────────────────
      const body = document.createElement('div');
      body.className = 'bgm-card-body';

      // SECTION: Видимость
      body.appendChild(_section('Видимость / scope', sec => {
        const row = document.createElement('div');
        row.className = 'bgm-row';
        const gBtn = _chip(e.scope === 'global' ? 'on' : '', '♾ Везде', () => {
          updateEntry(e.id, { scope: 'global' });
          renderEntryList();
        });
        const tBtn = _chip(e.scope === 'timeline' ? 'on' : '', '⏱ Таймлайн', () => {
          updateEntry(e.id, { scope: 'timeline' });
          renderEntryList();
        });
        row.appendChild(gBtn); row.appendChild(tBtn);
        sec.appendChild(row);

        if (e.scope === 'timeline') {
          const cnt = (e.selectedLines || []).length;
          const total = lyricLines.length;
          const openBtn = document.createElement('button');
          openBtn.className = 'bgm-chip bgm-chip-wide';
          openBtn.textContent = `📋 Выбрать строки (${cnt}/${total})`;
          openBtn.addEventListener('click', () => openLineSelector(e.id));
          sec.appendChild(openBtn);
        }
      }));

      // SECTION: Геометрия
      body.appendChild(_section('Геометрия', sec => {
        const row = document.createElement('div');
        row.className = 'bgm-row';
        ['cover','contain','fill','stretch'].forEach(mode => {
          const btn = _chip(e.fitMode === mode ? 'on' : '', mode, () => {
            updateEntry(e.id, { fitMode: mode }); renderEntryList();
          });
          row.appendChild(btn);
        });
        sec.appendChild(row);
        sec.appendChild(_slider('Масштаб',  e.id, 'scale',    1.0, 3.0, 0.01, e.scale));
        sec.appendChild(_slider('Сдвиг X %', e.id, 'offsetX', -50, 50, 1, e.offsetX));
        sec.appendChild(_slider('Сдвиг Y %', e.id, 'offsetY', -50, 50, 1, e.offsetY));
        sec.appendChild(_slider('Поворот', e.id, 'rotation', -180, 180, 1, e.rotation));
      }));

      // SECTION: Камера
      body.appendChild(_section('Камера и анимация', sec => {
        sec.appendChild(_toggleRow('Ken Burns (дыхание + пан)', e.kenBurns, v => {
          updateEntry(e.id, { kenBurns: v });
          renderEntryList();
        }));
        if (e.kenBurns)
          sec.appendChild(_slider('   ⤷ амплитуда', e.id, 'kenBurnsAmount', 0, 1, 0.01, e.kenBurnsAmount));

        sec.appendChild(_toggleRow('Music Zoom (бас)', e.musicZoom, v => {
          updateEntry(e.id, { musicZoom: v });
          renderEntryList();
        }));
        if (e.musicZoom) {
          sec.appendChild(_slider('   ⤷ сила', e.id, 'musicZoomAmount', 0.05, 1.5, 0.05, e.musicZoomAmount));
          sec.appendChild(_toggleRow('   ⤷ инверсия (наружу)', e.musicZoomInvert, v => {
            updateEntry(e.id, { musicZoomInvert: v });
          }));
        }

        // Scroll X
        sec.appendChild(_toggleRow('Прокрутка X', e.scrollX, v => {
          updateEntry(e.id, { scrollX: v }); renderEntryList();
        }));
        if (e.scrollX) {
          const r = document.createElement('div');
          r.className = 'bgm-row';
          r.appendChild(_chip(e.scrollXDir === -1 ? 'on' : '', '←', () => {
            updateEntry(e.id, { scrollXDir: -1 }); renderEntryList();
          }));
          r.appendChild(_chip(e.scrollXDir === 1  ? 'on' : '', '→', () => {
            updateEntry(e.id, { scrollXDir: 1 }); renderEntryList();
          }));
          sec.appendChild(r);
          sec.appendChild(_slider('   ⤷ скорость', e.id, 'scrollXSpeed', 0.005, 0.5, 0.005, e.scrollXSpeed));
        }
        // Scroll Y
        sec.appendChild(_toggleRow('Прокрутка Y', e.scrollY, v => {
          updateEntry(e.id, { scrollY: v }); renderEntryList();
        }));
        if (e.scrollY) {
          const r = document.createElement('div');
          r.className = 'bgm-row';
          r.appendChild(_chip(e.scrollYDir === -1 ? 'on' : '', '↑', () => {
            updateEntry(e.id, { scrollYDir: -1 }); renderEntryList();
          }));
          r.appendChild(_chip(e.scrollYDir === 1  ? 'on' : '', '↓', () => {
            updateEntry(e.id, { scrollYDir: 1 }); renderEntryList();
          }));
          sec.appendChild(r);
          sec.appendChild(_slider('   ⤷ скорость', e.id, 'scrollYSpeed', 0.005, 0.5, 0.005, e.scrollYSpeed));
        }
      }));

      // SECTION: Цветокор / blur
      body.appendChild(_section('Цвет, blur, прозрачность', sec => {
        sec.appendChild(_slider('Прозрачность', e.id, 'opacity',    0,    1,    0.01, e.opacity));
        sec.appendChild(_slider('Blur',          e.id, 'blur',       0,    1,    0.01, e.blur));
        sec.appendChild(_slider('Яркость %',    e.id, 'brightness', 0,    200,  1,    e.brightness));
        sec.appendChild(_slider('Насыщ. %',     e.id, 'saturation', 0,    200,  1,    e.saturation));
        sec.appendChild(_slider('Контраст %',   e.id, 'contrast',   0,    200,  1,    e.contrast));
        sec.appendChild(_slider('Тон (deg)',    e.id, 'hue',       -180,  180,  1,    e.hue));
      }));

      // SECTION: Эффекты-наложения
      body.appendChild(_section('Эффекты-наложения', sec => {
        sec.appendChild(_toggleRow('Виньетка', e.vignette, v => {
          updateEntry(e.id, { vignette: v }); renderEntryList();
        }));
        if (e.vignette)
          sec.appendChild(_slider('   ⤷ сила', e.id, 'vignetteAmount', 0, 1, 0.01, e.vignetteAmount));

        // Tint
        const tintRow = document.createElement('div');
        tintRow.className = 'bgm-color-row';
        const tintLbl = document.createElement('span');
        tintLbl.className = 'bgm-row-label';
        tintLbl.textContent = 'Тинт';
        tintRow.appendChild(tintLbl);
        const tintInp = document.createElement('input');
        tintInp.type = 'color'; tintInp.value = e.tint || '#000000';
        tintInp.className = 'bgm-color-chip';
        tintInp.addEventListener('input', () => updateEntry(e.id, { tint: tintInp.value }));
        tintRow.appendChild(tintInp);
        const tintAmt = document.createElement('input');
        tintAmt.type = 'range'; tintAmt.min = 0; tintAmt.max = 1; tintAmt.step = 0.01;
        tintAmt.value = e.tintAmount;
        tintAmt.className = 'bgm-slider';
        const tintVal = document.createElement('span');
        tintVal.className = 'bgm-val';
        tintVal.textContent = (+e.tintAmount).toFixed(2);
        tintAmt.addEventListener('input', () => {
          tintVal.textContent = (+tintAmt.value).toFixed(2);
          updateEntry(e.id, { tintAmount: +tintAmt.value });
        });
        tintRow.appendChild(tintAmt); tintRow.appendChild(tintVal);
        sec.appendChild(tintRow);

        sec.appendChild(_toggleRow('Хроматическая аберрация', e.chromatic, v => {
          updateEntry(e.id, { chromatic: v }); renderEntryList();
        }));
        if (e.chromatic)
          sec.appendChild(_slider('   ⤷ сила', e.id, 'chromaticAmount', 0, 1, 0.01, e.chromaticAmount));
      }));

      // SECTION: Аудио-реактивные
      body.appendChild(_section('Аудио-реактивные', sec => {
        sec.appendChild(_toggleRow('Pulse (бас → масштаб)', e.pulse, v => {
          updateEntry(e.id, { pulse: v }); renderEntryList();
        }));
        if (e.pulse)
          sec.appendChild(_slider('   ⤷ сила', e.id, 'pulseAmount', 0, 1, 0.01, e.pulseAmount));

        sec.appendChild(_toggleRow('Shake (бас → джиттер)', e.shake, v => {
          updateEntry(e.id, { shake: v }); renderEntryList();
        }));
        if (e.shake)
          sec.appendChild(_slider('   ⤷ сила', e.id, 'shakeAmount', 0, 1, 0.01, e.shakeAmount));
      }));

      // SECTION: Crossfade
      body.appendChild(_section('Crossfade', sec => {
        sec.appendChild(_slider('Fade-in (сек)',  e.id, 'fadeIn',  0.05, 5, 0.05, e.fadeIn));
        sec.appendChild(_slider('Fade-out (сек)', e.id, 'fadeOut', 0.05, 5, 0.05, e.fadeOut));
      }));

      card.appendChild(body);
      list.appendChild(card);
    });

    _drawPreviewStatic();
  }

  /* ── Helpers для UI ───────────────────────────────────────────────────── */
  function _section(title, builder) {
    const sec = document.createElement('div');
    sec.className = 'bgm-section';
    if (title) {
      const h = document.createElement('div');
      h.className = 'bgm-section-label';
      h.textContent = '// ' + title;
      sec.appendChild(h);
    }
    builder(sec);
    return sec;
  }

  function _slider(label, entryId, key, min, max, step, val) {
    const row = document.createElement('div');
    row.className = 'bgm-slider-row';
    const lbl = document.createElement('span');
    lbl.className = 'bgm-slider-label';
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.value = val;
    inp.className = 'bgm-slider';
    const v = document.createElement('span');
    v.className = 'bgm-val';
    const fmt = x => {
      const n = +x;
      if (step >= 1) return Math.round(n).toString();
      const dec = step.toString().includes('.') ? step.toString().split('.')[1].length : 2;
      return n.toFixed(dec);
    };
    v.textContent = fmt(val);
    inp.addEventListener('input', () => {
      v.textContent = fmt(inp.value);
      updateEntry(entryId, { [key]: +inp.value });
    });
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(v);
    return row;
  }

  function _chip(activeCls, label, onClick) {
    const b = document.createElement('button');
    b.className = 'bgm-chip' + (activeCls ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function _toggleRow(label, checked, onChange) {
    const row = document.createElement('div');
    row.className = 'bgm-toggle-row';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    const sw = document.createElement('div');
    sw.className = 'bgm-toggle' + (checked ? ' on' : '');
    sw.addEventListener('click', () => {
      const nv = !sw.classList.contains('on');
      sw.classList.toggle('on', nv);
      onChange(nv);
    });
    row.appendChild(lbl); row.appendChild(sw);
    return row;
  }

  /* ── Line selector ────────────────────────────────────────────────────── */
  let _lsCurrentId = null;
  function openLineSelector(id) {
    _lsCurrentId = id;
    const panel    = modalEl.querySelector('#bgmLsPanel');
    const backdrop = modalEl.querySelector('#bgmLsBackdrop');
    panel.style.display = 'flex';
    backdrop.style.display = 'block';
    renderLineSelector();
  }
  function closeLineSelector() {
    if (!modalEl) return;
    const panel    = modalEl.querySelector('#bgmLsPanel');
    const backdrop = modalEl.querySelector('#bgmLsBackdrop');
    panel.style.display = 'none';
    backdrop.style.display = 'none';
    _lsCurrentId = null;
  }
  function renderLineSelector() {
    if (!modalEl || !_lsCurrentId) return;
    const e = entries.find(x => x.id === _lsCurrentId);
    if (!e) return;
    const list = modalEl.querySelector('#bgmLsList');
    const counter = modalEl.querySelector('#bgmLsCounter');
    list.innerHTML = '';
    const sel = new Set(e.selectedLines || []);
    counter.textContent = `${sel.size} / ${lyricLines.length}`;

    if (!lyricLines.length) {
      const empty = document.createElement('div');
      empty.className = 'bgm-empty';
      empty.style.padding = '20px';
      empty.textContent = 'Сначала загрузите строки лирики на главном экране';
      list.appendChild(empty);
      return;
    }

    lyricLines.forEach((l, idx) => {
      const item = document.createElement('div');
      item.className = 'bgm-ls-item' + (sel.has(idx) ? ' selected' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = sel.has(idx);
      cb.addEventListener('change', () => {
        const cur = new Set(e.selectedLines || []);
        if (cb.checked) cur.add(idx); else cur.delete(idx);
        e.selectedLines = Array.from(cur).sort((a,b) => a - b);
        item.classList.toggle('selected', cb.checked);
        counter.textContent = `${cur.size} / ${lyricLines.length}`;
        _notify();
        renderEntryList();
      });
      const num = document.createElement('span');
      num.className = 'bgm-ls-num';
      num.textContent = String(idx + 1).padStart(2, '0');
      const tm = document.createElement('span');
      tm.className = 'bgm-ls-time';
      tm.textContent = _fmtT(l.time);
      const tx = document.createElement('span');
      tx.className = 'bgm-ls-text';
      tx.textContent = (l.text || '').slice(0, 60);
      item.appendChild(cb); item.appendChild(num); item.appendChild(tm); item.appendChild(tx);
      list.appendChild(item);
    });
  }
  function _fmtT(s) {
    if (isNaN(s)) return '00:00';
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  /* ── Preview ──────────────────────────────────────────────────────────── */
  let _previewAnim = false;
  let _previewRaf  = null;
  let _previewT0   = 0;
  let _previewLastT = 0;

  function _drawPreviewStatic() {
    if (!modalEl) return;
    const cv = modalEl.querySelector('#bgmPreviewCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = cv.width, h = cv.height;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const e = _selectedEntryId ? entries.find(x => x.id === _selectedEntryId) : null;
    const hint = modalEl.querySelector('#bgmPreviewHint');
    const ctrls = modalEl.querySelector('#bgmPreviewControls');
    const nm = modalEl.querySelector('#bgmPreviewName');
    if (hint) hint.style.display = e ? 'none' : '';
    if (ctrls) ctrls.style.display = e ? 'flex' : 'none';
    if (nm && e) nm.textContent = e.name;

    if (!e) return;

    // Сетка-подложка
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    for (let x = 0; x < w; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // Один рендер с тестовыми bands
    const fakeBands = { bass: 0.35, mid: 0.25, high: 0.15 };
    try {
      _drawEntry(ctx, e, 1, w, h, fakeBands, 0, 0.016);
    } catch(err) {
      console.error('[BGM] _drawPreviewStatic error:', err);
      try { ctx.restore(); } catch(_) {}
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
    }

    // Подпись «SAMPLE TEXT»
    ctx.save();
    ctx.font = `bold 96px 'Bebas Neue', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 16;
    ctx.fillText('SAMPLE TEXT', w / 2, h / 2);
    ctx.restore();
  }

  function _previewLoop() {
    if (!_previewAnim || !modalEl) { _previewRaf = null; return; }
    const cv = modalEl.querySelector('#bgmPreviewCanvas');
    if (!cv) { _previewAnim = false; _previewRaf = null; return; }
    const ctx = cv.getContext('2d');
    if (!ctx) { _previewAnim = false; _previewRaf = null; return; }
    const w = cv.width, h = cv.height;

    const now = performance.now();
    if (!_previewT0)   _previewT0 = now;
    if (!_previewLastT) _previewLastT = now;
    const t  = (now - _previewT0) / 1000;
    const dt = Math.min(0.05, (now - _previewLastT) / 1000);
    _previewLastT = now;

    // Планируем следующий кадр ДО рисования — цикл не умрёт даже при ошибке
    _previewRaf = requestAnimationFrame(_previewLoop);

    try {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      const e = _selectedEntryId ? entries.find(x => x.id === _selectedEntryId) : null;
      if (e) {
        // Симуляция баса
        const bass = 0.35 + 0.4 * Math.abs(Math.sin(t * 2.4));
        const mid  = 0.25 + 0.25 * Math.abs(Math.sin(t * 1.7));
        const high = 0.15 + 0.3 * Math.abs(Math.sin(t * 3.2));
        const fakeBands = { bass, mid, high };
        _drawEntry(ctx, e, 1, w, h, fakeBands, t, dt);
      }

      ctx.save();
      ctx.font = `bold 96px 'Bebas Neue', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 16;
      ctx.fillText('SAMPLE TEXT', w / 2, h / 2);
      ctx.restore();
    } catch(err) {
      console.error('[BGM] _previewLoop render error:', err);
      // Сброс состояния контекста после ошибки
      try { ctx.restore(); } catch(_) {}
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
    }
  }

  /* ── UI badge на главной странице ─────────────────────────────────────── */
  function updateUiBadge() {
    const badge = document.getElementById('bgCountBadge');
    if (badge) {
      badge.textContent = entries.length ? `(${entries.length})` : '';
    }
  }

  /* ── CSS ──────────────────────────────────────────────────────────────── */
  function _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
#bgManagerOverlay {
  position: fixed; inset: 0; z-index: 9999;
  display: none; align-items: center; justify-content: center;
}
.bgm-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.92); }
.bgm-modal {
  position: relative; width: 96vw; max-width: 1500px; height: 92vh;
  background: #0d0d0d; border: 1px solid #222; display: flex; flex-direction: column;
  overflow: hidden; border-radius: 6px;
}

.bgm-header {
  display: flex; align-items: center; gap: 12px;
  padding: 0 16px; height: 52px;
  background: #111; border-bottom: 1px solid #222; flex-shrink: 0;
}
.bgm-title  { font-family: 'Bebas Neue', cursive; font-size: 22px; letter-spacing: 4px; color: #e8ff00; }
.bgm-sub    { font-family: 'JetBrains Mono', 'Space Mono', monospace; font-size: 8px; letter-spacing: 1px; color: #444; text-transform: uppercase; }
.bgm-hdr-right { margin-left: auto; display: flex; gap: 6px; }

.bgm-btn {
  font-family: 'JetBrains Mono', 'Space Mono', monospace;
  font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
  padding: 8px 14px; cursor: pointer; border: 1px solid;
  display: inline-flex; align-items: center; gap: 6px;
  border-radius: 4px; transition: all .15s;
}
.bgm-btn:disabled { opacity: .25; cursor: not-allowed; pointer-events: none; }
.bgm-btn-accent { background: #e8ff00; color: #000; border-color: #e8ff00; }
.bgm-btn-accent:hover { background: transparent; color: #e8ff00; }
.bgm-btn-ghost  { background: transparent; color: #999; border-color: #2a2a2a; }
.bgm-btn-ghost:hover { color: #fff; border-color: #444; }

.bgm-body {
  display: grid; grid-template-columns: minmax(440px, 580px) 1fr; flex: 1;
  overflow: hidden;
}
.bgm-list-wrap {
  border-right: 1px solid #1a1a1a; overflow-y: auto; padding: 12px;
  background: #0a0a0a;
}
.bgm-list-wrap::-webkit-scrollbar { width: 6px; }
.bgm-list-wrap::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }

.bgm-empty {
  font-family: 'JetBrains Mono','Space Mono',monospace; font-size: 10px; color: #444;
  text-align: center; padding: 60px 20px; letter-spacing: 1.5px; text-transform: uppercase;
}

.bgm-card {
  background: #0e0e0e; border: 1px solid #1c1c1c; border-radius: 6px;
  margin-bottom: 8px; overflow: hidden; transition: border-color .15s;
}
.bgm-card:hover { border-color: #2a2a2a; }
.bgm-card.disabled { opacity: 0.4; }
.bgm-card.selected { border-color: #e8ff00; box-shadow: 0 0 0 1px rgba(232,255,0,0.12); }
.bgm-card.collapsed .bgm-card-body { display: none; }
.bgm-card.collapsed .bgm-card-header { border-bottom: none; }

.bgm-card-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: #111; border-bottom: 1px solid #1a1a1a;
  cursor: pointer; user-select: none; min-height: 50px;
}
.bgm-card-header:hover { background: #141414; }
.bgm-card-header > * { cursor: default; }
.bgm-card-header > button { cursor: pointer; }

.bgm-coll-btn, .bgm-zbtn {
  background: transparent; border: 1px solid #2a2a2a; color: #888;
  font-family: monospace; font-size: 11px; padding: 3px 6px;
  border-radius: 3px; transition: all .12s;
}
.bgm-coll-btn:hover, .bgm-zbtn:hover { color: #e8ff00; border-color: #444; }
.bgm-zbtn:disabled { opacity: 0.25; }

.bgm-zbadge {
  font-family: monospace; font-size: 9px; color: #666;
  background: #1a1a1a; padding: 3px 6px; border-radius: 3px;
  min-width: 26px; text-align: center;
}

.bgm-thumb {
  width: 36px; height: 36px; flex-shrink: 0;
  background: #050505; border: 1px solid #222; overflow: hidden;
  border-radius: 3px; display: flex; align-items: center; justify-content: center;
  color: #555; font-size: 14px;
  position: relative;
}
.bgm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bgm-thumb-video { color: #e8ff00; background: #1a1a1a; }
/* Замена медиа: thumb-replaceable + hover-индикатор */
.bgm-thumb-replaceable { cursor: pointer; transition: border-color .12s; }
.bgm-thumb-replaceable:hover { border-color: #e8ff00; }
.bgm-thumb-replaceable:hover img { filter: brightness(0.35); }
.bgm-thumb-replace-hint {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: #e8ff00; font-size: 18px; font-weight: 700;
  text-shadow: 0 0 4px #000;
  opacity: 0; pointer-events: none;
  transition: opacity .12s;
}
.bgm-thumb-replaceable:hover .bgm-thumb-replace-hint { opacity: 1; }

.bgm-card-name {
  font-family: 'JetBrains Mono','Space Mono',monospace; font-size: 10px;
  color: #ccc; flex: 1; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; letter-spacing: .3px;
}

.bgm-scope-chip {
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 8px; letter-spacing: 1px; padding: 4px 8px; border-radius: 3px;
  white-space: nowrap;
}
.bgm-scope-chip.gl { background: rgba(232,255,0,0.1); color: #e8ff00; border: 1px solid rgba(232,255,0,0.3); }
.bgm-scope-chip.tl { background: rgba(0,229,255,0.1); color: #00e5ff; border: 1px solid rgba(0,229,255,0.3); }

.bgm-en-btn {
  font-family: monospace; font-size: 8px; letter-spacing: 1px;
  padding: 4px 8px; border-radius: 3px;
  background: transparent; border: 1px solid #333; color: #666;
  transition: all .12s;
}
.bgm-en-btn.on { background: #e8ff00; color: #000; border-color: #e8ff00; }
.bgm-en-btn:hover:not(.on) { color: #ccc; border-color: #555; }

.bgm-rem-btn {
  font-family: monospace; font-size: 12px;
  background: none; border: none; color: #555; padding: 4px 6px;
  cursor: pointer; border-radius: 3px;
}
.bgm-rem-btn:hover { color: #ff2d55; background: rgba(255,45,85,0.1); }

.bgm-card-body {
  padding: 8px; display: flex; flex-direction: column; gap: 6px;
  background: #0a0a0a;
}

.bgm-section {
  background: #0d0d0d; border: 1px solid #181818; border-radius: 4px;
  padding: 8px; display: flex; flex-direction: column; gap: 6px;
}
.bgm-section-label {
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 8px; letter-spacing: 1.5px; color: #555; text-transform: uppercase;
  margin-bottom: 4px;
}

.bgm-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.bgm-row-label {
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 9px; color: #777; min-width: 60px; letter-spacing: .5px;
}

.bgm-chip {
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 9px; letter-spacing: .8px; padding: 5px 10px;
  background: transparent; color: #999;
  border: 1px solid #2a2a2a; border-radius: 3px;
  cursor: pointer; transition: all .12s; text-transform: uppercase;
}
.bgm-chip:hover { color: #fff; border-color: #444; }
.bgm-chip.on { background: rgba(232,255,0,0.15); color: #e8ff00; border-color: #e8ff00; }
.bgm-chip-wide { width: 100%; padding: 8px 10px; font-size: 10px; }

.bgm-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 2px;
}
.bgm-toggle-row span {
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 10px; color: #aaa; flex: 1;
}
.bgm-toggle {
  width: 32px; height: 18px; background: #1a1a1a; border: 1px solid #2a2a2a;
  border-radius: 9px; position: relative; cursor: pointer; transition: all .15s;
  flex-shrink: 0;
}
.bgm-toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px; background: #555; border-radius: 50%;
  transition: all .15s;
}
.bgm-toggle.on { background: rgba(232,255,0,0.2); border-color: #e8ff00; }
.bgm-toggle.on::after { left: 16px; background: #e8ff00; }

.bgm-slider-row {
  display: grid; grid-template-columns: 100px 1fr 40px;
  gap: 8px; align-items: center;
}
.bgm-slider-label {
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 9px; color: #777; letter-spacing: .3px;
}
.bgm-slider {
  -webkit-appearance: none; appearance: none;
  height: 4px; background: #1a1a1a; border-radius: 2px;
  outline: none; cursor: pointer; padding: 0;
}
.bgm-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 12px; height: 12px; background: #e8ff00;
  cursor: pointer; border-radius: 50%;
}
.bgm-slider::-moz-range-thumb {
  width: 12px; height: 12px; background: #e8ff00;
  cursor: pointer; border: none; border-radius: 50%;
}
.bgm-val {
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 9px; color: #e8ff00; text-align: right;
}

.bgm-color-row {
  display: grid; grid-template-columns: 60px 32px 1fr 40px;
  gap: 6px; align-items: center;
}
.bgm-color-chip {
  width: 32px; height: 22px; padding: 0; border: 1px solid #2a2a2a;
  background: #050505; cursor: pointer; border-radius: 3px;
}

.bgm-preview-wrap {
  position: relative; flex: 1; padding: 16px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  overflow: hidden; background: #050505;
}
#bgmPreviewCanvas {
  max-width: 100%; max-height: 100%; width: auto; height: auto;
  border: 1px solid #1a1a1a; background: #000;
  display: block; object-fit: contain;
  aspect-ratio: 16/9;
}
.bgm-preview-hint {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-family: 'JetBrains Mono','Space Mono',monospace; font-size: 11px;
  color: #444; letter-spacing: 2px; text-transform: uppercase;
  pointer-events: none;
}
.bgm-preview-controls {
  position: absolute; bottom: 16px; left: 16px; right: 16px;
  display: flex; align-items: center; gap: 10px;
  background: rgba(13,13,13,0.85); backdrop-filter: blur(8px);
  padding: 10px 14px; border: 1px solid #222; border-radius: 4px;
}
.bgm-preview-name {
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 11px; color: #e8ff00; flex: 1; letter-spacing: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Line selector slide-out panel */
.bgm-ls-backdrop {
  position: absolute; inset: 0; background: rgba(0,0,0,0.5); z-index: 5;
}
.bgm-ls-panel {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 380px; background: #0d0d0d; border-left: 1px solid #222;
  z-index: 6; display: flex; flex-direction: column;
}
.bgm-ls-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid #222; background: #111;
}
.bgm-ls-title {
  font-family: 'Bebas Neue', cursive; font-size: 16px;
  letter-spacing: 3px; color: #e8ff00; flex: 1;
}
.bgm-ls-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-bottom: 1px solid #1a1a1a; background: #0a0a0a;
}
.bgm-ls-counter {
  margin-left: auto;
  font-family: 'JetBrains Mono','Space Mono',monospace;
  font-size: 9px; color: #e8ff00; letter-spacing: 1px;
}
.bgm-ls-list { flex: 1; overflow-y: auto; padding: 8px; }
.bgm-ls-list::-webkit-scrollbar { width: 6px; }
.bgm-ls-list::-webkit-scrollbar-thumb { background: #2a2a2a; }
.bgm-ls-item {
  display: grid; grid-template-columns: 18px 28px 50px 1fr;
  gap: 8px; align-items: center;
  padding: 8px 10px; border: 1px solid #1a1a1a; border-radius: 3px;
  margin-bottom: 4px; cursor: pointer; transition: all .12s;
}
.bgm-ls-item:hover { border-color: #2a2a2a; background: #111; }
.bgm-ls-item.selected { background: rgba(232,255,0,0.05); border-color: rgba(232,255,0,0.3); }
.bgm-ls-num {
  font-family: monospace; font-size: 9px; color: #555; text-align: center;
}
.bgm-ls-time {
  font-family: monospace; font-size: 9px; color: #e8ff00; letter-spacing: .5px;
}
.bgm-ls-text {
  font-size: 11px; color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
`;
    document.head.appendChild(s);
  }

  // Сбрасывает все FX-оверрайды камеры (вызывается при стопе/перемотке из App.js)
  function resetFxOverrides() {
    _fxCamOverride.musicZoom = null; _fxCamOverride.musicZoomInvert = null;
    _fxCamOverride.scrollX   = null; _fxCamOverride.scrollXDir      = null;
    _fxCamOverride.scrollY   = null; _fxCamOverride.scrollYDir      = null;
  }

  // Применяет команду камеры из FX Editor поверх настроек активного entry
  function applyFxCommand(cmd) {
    if (cmd.type === 'zoomIn')      { _fxCamOverride.musicZoom = true;  _fxCamOverride.musicZoomInvert = false; }
    if (cmd.type === 'zoomOut')     { _fxCamOverride.musicZoom = true;  _fxCamOverride.musicZoomInvert = true;  }
    if (cmd.type === 'zoomStop')    { _fxCamOverride.musicZoom = false; }
    if (cmd.type === 'scrollLeft')  { _fxCamOverride.scrollX = true;   _fxCamOverride.scrollXDir = -1; }
    if (cmd.type === 'scrollRight') { _fxCamOverride.scrollX = true;   _fxCamOverride.scrollXDir =  1; }
    if (cmd.type === 'scrollUp')    { _fxCamOverride.scrollY = true;   _fxCamOverride.scrollYDir = -1; }
    if (cmd.type === 'scrollDown')  { _fxCamOverride.scrollY = true;   _fxCamOverride.scrollYDir =  1; }
    if (cmd.type === 'scrollStop')  { _fxCamOverride.scrollX = false;  _fxCamOverride.scrollY = false; }
    if (cmd.type === 'cameraReset') {
      _fxCamOverride.musicZoom = null; _fxCamOverride.musicZoomInvert = null;
      _fxCamOverride.scrollX = null;   _fxCamOverride.scrollXDir = null;
      _fxCamOverride.scrollY = null;   _fxCamOverride.scrollYDir = null;
    }
  }

  /* ── Public ──────────────────────────────────────────────────────────── */
  return {
    init, open, close,
    addEntry, removeEntry, replaceEntryMedia, updateEntry, moveEntry,
    tick, draw, applyFxCommand, resetFxOverrides,
    playVideos, stopVideos, pauseVideos,
    setLines, setOnChangeCallback,
    updateUiBadge,
    toJSON, fromJSON, clear, _forceReset, _activeVideos,
    restoreFromStorage,
    get hasEntries() { return entries.length > 0; },
    get entries()    { return entries; },
    get isOpen()     { return modalEl && modalEl.style.display === 'flex'; },
  };
})();
