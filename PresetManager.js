/* ═══════════════════════════════════════════════
   js/PresetManager.js  v6 — IndexedDB + localStorage
   Настройки/индекс → localStorage, бинарники → IndexedDB
═══════════════════════════════════════════════ */
const PresetManager = (() => {

  const IDX_KEY      = 'chromatype:index';
  const MAX_PRESETS  = 20;
  const MAX_FILE_MB  = 4.5;

  /* ── Storage adapter: IndexedDB + localStorage ──
     Лёгкие JSON-данные (настройки, индекс, лирика) → localStorage.
     Тяжёлые бинарники (аудио, фон, оверлеи с imgData) → IndexedDB
     который не имеет жёсткого лимита объёма.

     Ключи с суффиксами :audio :bg :overlays → IndexedDB.
     Все остальные → localStorage.
  ──────────────────────────────────────────────── */

  const _IDB_NAME    = 'chromatype_store';
  const _IDB_VERSION = 1;
  const _IDB_STORE   = 'kv';

  // Суффиксы ключей которые хранятся в IndexedDB (тяжёлые бинарники)
  function _isHeavyKey(key) {
    return key.endsWith(':audio') || key.endsWith(':bg') || key.endsWith(':overlays');
  }

  // Открытие/переиспользование соединения с IndexedDB
  let _idbPromise = null;
  function _openIDB() {
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise(function(resolve, reject) {
      const req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
      req.onupgradeneeded = function(e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(_IDB_STORE)) {
          db.createObjectStore(_IDB_STORE);
        }
      };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror   = function(e) { reject(e.target.error); _idbPromise = null; };
    });
    return _idbPromise;
  }

  function _idbGet(key) {
    return _openIDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx  = db.transaction(_IDB_STORE, 'readonly');
        const req = tx.objectStore(_IDB_STORE).get(key);
        req.onsuccess = function() { resolve(req.result !== undefined ? req.result : null); };
        req.onerror   = function() { resolve(null); };
      });
    }).catch(function() { return null; });
  }

  function _idbSet(key, value) {
    return _openIDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx  = db.transaction(_IDB_STORE, 'readwrite');
        const req = tx.objectStore(_IDB_STORE).put(value, key);
        req.onsuccess = function() { resolve(true); };
        req.onerror   = function() { resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function _idbDel(key) {
    return _openIDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(_IDB_STORE, 'readwrite');
        tx.objectStore(_IDB_STORE).delete(key);
        tx.oncomplete = function() { resolve(); };
        tx.onerror    = function() { resolve(); };
      });
    }).catch(function() {});
  }

  // ── Единый интерфейс: автоматически выбирает хранилище ──
  function _storageGet(key) {
    if (_isHeavyKey(key)) return _idbGet(key);
    try {
      const val = localStorage.getItem(key);
      return Promise.resolve(val !== null ? val : null);
    } catch (e) {
      console.warn('[PresetManager] storageGet failed:', key, e);
      return Promise.resolve(null);
    }
  }

  function _storageSet(key, value) {
    if (_isHeavyKey(key)) return _idbSet(key, value);
    try {
      localStorage.setItem(key, value);
      return Promise.resolve(true);
    } catch (e) {
      console.warn('[PresetManager] storageSet failed:', key, e);
      return Promise.resolve(false);
    }
  }

  function _storageDel(key) {
    if (_isHeavyKey(key)) return _idbDel(key);
    try { localStorage.removeItem(key); } catch (e) {}
    return Promise.resolve();
  }

  /* ── Индекс пресетов ─────────────────────── */
  async function _readIndex() {
    const raw = await _storageGet(IDX_KEY);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  }

  async function _writeIndex(arr) {
    await _storageSet(IDX_KEY, JSON.stringify(arr));
  }

  /* ── File → base64 ───────────────────────── */
  function _fileToBase64(file) {
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload  = function() { resolve(reader.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function _base64ToBlob(b64, mime) {
    const bytes = atob(b64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function _base64ToFile(b64, mime, filename) {
    return new File([_base64ToBlob(b64, mime)], filename, { type: mime });
  }

  function _mb(file) { return file.size / (1024 * 1024); }

  /* ── Overlay helpers ─────────────────────── */

  // Конвертирует HTMLImageElement оверлея в base64-строку PNG через canvas
  async function _overlayImgToBase64(ov) {
    try {
      const img = ov.img;
      if (!img || !img.naturalWidth) return null;
      const c   = document.createElement('canvas');
      c.width   = img.naturalWidth;
      c.height  = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    } catch (e) {
      console.warn('[PresetManager] overlay → base64 fail', e);
      return null;
    }
  }

  // Сериализует все текущие оверлеи (настройки + изображение)
  async function _serializeOverlays() {
    const ovs = (typeof BackgroundEngine !== 'undefined') ? BackgroundEngine.overlays : [];
    if (!ovs || !ovs.length) return [];
    const result = [];
    for (const ov of ovs) {
      // ── Text overlay: без imgData, сохраняем текстовые поля ──
      if (ov.type === 'text') {
        result.push({
          type:          'text',
          name:          ov.name,
          text:          ov.text || '',
          font:          ov.font,
          fontSize:      ov.fontSize,
          color:         ov.color,
          bold:          !!ov.bold,
          italic:        !!ov.italic,
          boxStyle:      ov.boxStyle || '',
          strokeEnabled: !!ov.strokeEnabled,
          strokeColor:   ov.strokeColor || '',
          strokeWidth:   ov.strokeWidth || 0,
          shadowEnabled: !!ov.shadowEnabled,
          shadowColor:   ov.shadowColor || '',
          shadowBlur:    ov.shadowBlur  || 0,
          layer:         ov.layer,
          scope:         ov.scope,
          startLine:     ov.startLine,
          endLine:       ov.endLine,
          selectedLines: ov.selectedLines || [],
          positionMode:  ov.positionMode,
          x:             ov.x,
          y:             ov.y,
          width:         ov.width,
          effect:        ov.effect,
          effectAmt:     ov.effectAmt,
          opacity:       ov.opacity,
          enabled:       ov.enabled,
          fadeSpeed:     ov.fadeSpeed,
        });
        continue;
      }

      // ── Effect overlay: процедурный эффект, чисто JSON ──
      if (ov.type === 'effect') {
        result.push({
          type:          'effect',
          name:          ov.name,
          effectType:    ov.effectType    || 'rain',
          intensity:     ov.intensity     ?? 0.5,
          fxColor:       ov.fxColor       || '#ffffff',
          layer:         ov.layer,
          scope:         ov.scope,
          startLine:     ov.startLine,
          endLine:       ov.endLine,
          selectedLines: ov.selectedLines || [],
          positionMode:  ov.positionMode,
          x:             ov.x,
          y:             ov.y,
          width:         ov.width,
          opacity:       ov.opacity,
          enabled:       ov.enabled,
          fadeSpeed:     ov.fadeSpeed,
        });
        continue;
      }

      // ── Card overlay (композиция: рамка + текстовые блоки) ──
      if (ov.type === 'card') {
        result.push({
          type:           'card',
          name:           ov.name,
          // Сама карточка
          cardW:          ov.cardW         ?? 60,
          cardAspect:     ov.cardAspect    ?? 0.5625,
          cardRotation:   ov.cardRotation  ?? 0,
          // Параметры рамки внутри карточки
          frameStyle:     ov.frameStyle    || 'titlecard',
          frameColor:     ov.frameColor    || '#ffffff',
          frameThickness: ov.frameThickness ?? 3,
          frameDetail:    ov.frameDetail   ?? 6,
          framePad:       ov.framePad      ?? 0,
          frameRotation:  ov.frameRotation ?? 0,
          frameAnimMode:  ov.frameAnimMode || 'none',
          frameAnimAmt:   ov.frameAnimAmt  ?? 0.5,
          frameAnimSpeed: ov.frameAnimSpeed ?? 1.0,
          // Текстовые блоки — сериализуем все поля
          blocks: (Array.isArray(ov.blocks) ? ov.blocks : []).map(b => {
            const k = b.kind || 'text';
            const base = { id: b.id, kind: k, x: b.x ?? 50, y: b.y ?? 50, opacity: b.opacity ?? 1 };
            if (k === 'image') {
              return {
                ...base,
                imgData:      b.imgData || null,        // base64 data URL
                widthPct:     b.widthPct     ?? 30,
                rotation:     b.rotation     ?? 0,
                border:       !!b.border,
                borderColor:  b.borderColor  || '#ffffff',
                borderWidth:  b.borderWidth  ?? 2,
                cornerRadius: b.cornerRadius ?? 0,
              };
            }
            if (k === 'divider') {
              return {
                ...base,
                orientation: b.orientation || 'horizontal',
                lengthPct:   b.lengthPct ?? 50,
                thickness:   b.thickness ?? 2,
                color:       b.color || '#ffffff',
              };
            }
            // text
            return {
              ...base,
              text:          b.text || '',
              font:          b.font || "'Bebas Neue', cursive",
              sizePct:       b.sizePct ?? 8,
              color:         b.color   || '#ffffff',
              bold:          !!b.bold,
              italic:        !!b.italic,
              letterSpacing: b.letterSpacing ?? 0,
              align:         b.align || 'center',
              maxWidthPct:   b.maxWidthPct ?? 90,
              shadow:        !!b.shadow,
              shadowColor:   b.shadowColor || '#000000',
              shadowBlur:    b.shadowBlur ?? 8,
            };
          }),
          // Общие
          layer:          ov.layer,
          scope:          ov.scope,
          startLine:      ov.startLine,
          endLine:        ov.endLine,
          selectedLines:  ov.selectedLines || [],
          positionMode:   ov.positionMode,
          x:              ov.x,
          y:              ov.y,
          width:          ov.width,
          opacity:        ov.opacity,
          enabled:        ov.enabled,
          fadeSpeed:      ov.fadeSpeed,
        });
        continue;
      }

      // ── Frame overlay: чисто JSON, без изображений ──
      if (ov.type === 'frame') {
        result.push({
          type:          'frame',
          name:          ov.name,
          frameStyle:    ov.frameStyle    || 'nexus',
          frameColor:    ov.frameColor    || '#d4a84b',
          frameThickness:ov.frameThickness ?? 3,
          frameDetail:   ov.frameDetail   ?? 6,
          framePad:      ov.framePad      ?? 0,
          frameAnimMode: ov.frameAnimMode || 'none',
          frameAnimAmt:  ov.frameAnimAmt  ?? 0.5,
          layer:         ov.layer,
          scope:         ov.scope,
          startLine:     ov.startLine,
          endLine:       ov.endLine,
          selectedLines: ov.selectedLines || [],
          positionMode:  ov.positionMode,
          x:             ov.x,
          y:             ov.y,
          width:         ov.width,
          effect:        ov.effect,
          effectAmt:     ov.effectAmt,
          opacity:       ov.opacity,
          enabled:       ov.enabled,
          fadeSpeed:     ov.fadeSpeed,
        });
        continue;
      }

      // ── Image overlay: как раньше ──
      const imgData = await _overlayImgToBase64(ov);
      if (!imgData) continue;
      result.push({
        type:          'image',
        name:          ov.name,
        imgData:       imgData,
        layer:         ov.layer,
        scope:         ov.scope,
        startLine:     ov.startLine,
        endLine:       ov.endLine,
        selectedLines: ov.selectedLines || [],
        positionMode:  ov.positionMode,
        x:             ov.x,
        y:             ov.y,
        width:         ov.width,
        effect:        ov.effect,
        effectAmt:     ov.effectAmt,
        opacity:       ov.opacity,
        enabled:       ov.enabled,
        strokeEnabled: !!ov.strokeEnabled,
        strokeColor:   ov.strokeColor || '#ffffff',
        strokeWidth:   ov.strokeWidth || 2,
        shadowEnabled: !!ov.shadowEnabled,
        shadowColor:   ov.shadowColor || '#000000',
        shadowBlur:    ov.shadowBlur  || 10,
        fadeSpeed:     ov.fadeSpeed   || 2.5,
      });
    }
    return result;
  }

  // Восстанавливает оверлеи из сохранённых данных
    // Восстанавливает оверлеи из сохранённых данных
  async function _restoreOverlays(data) {
    if (!data || !data.length || typeof BackgroundEngine === 'undefined') return;
    // Удаляем текущие оверлеи
    const existing = [...BackgroundEngine.overlays];
    existing.forEach(function(ov) { BackgroundEngine.removeOverlay(ov.id); });

    for (var i = 0; i < data.length; i++) {
      var item = data[i];

      // ── Text overlay ──
      if (item.type === 'text') {
        if (typeof BackgroundEngine.registerTextOverlay !== 'function') {
          console.warn('[PresetManager] registerTextOverlay not available, skipping text overlay');
          continue;
        }
        try {
          var tov = BackgroundEngine.registerTextOverlay(item.text || 'TEXT');
          BackgroundEngine.updateOverlay(tov.id, {
            name:          item.name !== undefined ? item.name : (item.text || 'TEXT').slice(0, 24),
            text:          item.text         !== undefined ? item.text         : 'TEXT',
            font:          item.font         !== undefined ? item.font         : "'Bebas Neue', cursive",
            fontSize:      item.fontSize     !== undefined ? item.fontSize     : 96,
            color:         item.color        !== undefined ? item.color        : '#ffffff',
            bold:          item.bold         !== undefined ? !!item.bold       : true,
            italic:        item.italic       !== undefined ? !!item.italic     : false,
            boxStyle:      item.boxStyle     !== undefined ? item.boxStyle     : '',
            strokeEnabled: item.strokeEnabled !== undefined ? !!item.strokeEnabled : false,
            strokeColor:   item.strokeColor  !== undefined ? item.strokeColor  : '#ffffff',
            strokeWidth:   item.strokeWidth  !== undefined ? item.strokeWidth  : 2,
            shadowEnabled: item.shadowEnabled !== undefined ? !!item.shadowEnabled : false,
            shadowColor:   item.shadowColor  !== undefined ? item.shadowColor  : '#000000',
            shadowBlur:    item.shadowBlur   !== undefined ? item.shadowBlur   : 10,
            layer:         item.layer        !== undefined ? item.layer        : 'above',
            scope:         item.scope        !== undefined ? item.scope        : 'global',
            startLine:     item.startLine    !== undefined ? item.startLine    : 0,
            endLine:       item.endLine      !== undefined ? item.endLine      : 999,
            selectedLines: item.selectedLines || [],
            positionMode:  item.positionMode !== undefined ? item.positionMode : 'center',
            x:             item.x            !== undefined ? item.x            : 50,
            y:             item.y            !== undefined ? item.y            : 50,
            width:         item.width        !== undefined ? item.width        : 25,
            effect:        item.effect       !== undefined ? item.effect       : 'static',
            effectAmt:     item.effectAmt    !== undefined ? item.effectAmt    : 0.5,
            opacity:       item.opacity      !== undefined ? item.opacity      : 1.0,
            enabled:       item.enabled      !== false,
            fadeSpeed:     item.fadeSpeed    !== undefined ? item.fadeSpeed    : 2.5,
          });
        } catch (e) {
          console.warn('[PresetManager] text overlay restore error', item.name, e);
        }
        continue;
      }

      // ── Effect overlay ──
      if (item.type === 'effect') {
        if (typeof BackgroundEngine.registerEffectOverlay !== 'function') {
          console.warn('[PresetManager] registerEffectOverlay not available, skipping effect overlay');
          continue;
        }
        try {
          var eov = BackgroundEngine.registerEffectOverlay(item.effectType || 'rain');
          BackgroundEngine.updateOverlay(eov.id, {
            name:          item.name          !== undefined ? item.name          : eov.name,
            effectType:    item.effectType    !== undefined ? item.effectType    : 'rain',
            intensity:     item.intensity     !== undefined ? item.intensity     : 0.5,
            fxColor:       item.fxColor       !== undefined ? item.fxColor       : '#ffffff',
            layer:         item.layer         !== undefined ? item.layer         : 'above',
            scope:         item.scope         !== undefined ? item.scope         : 'global',
            startLine:     item.startLine     !== undefined ? item.startLine     : 0,
            endLine:       item.endLine       !== undefined ? item.endLine       : 999,
            selectedLines: item.selectedLines || [],
            positionMode:  item.positionMode  !== undefined ? item.positionMode  : 'fill',
            x:             item.x             !== undefined ? item.x             : 50,
            y:             item.y             !== undefined ? item.y             : 50,
            width:         item.width         !== undefined ? item.width         : 100,
            opacity:       item.opacity       !== undefined ? item.opacity       : 1.0,
            enabled:       item.enabled       !== false,
            fadeSpeed:     item.fadeSpeed     !== undefined ? item.fadeSpeed     : 2.5,
          });
        } catch (e) {
          console.warn('[PresetManager] effect overlay restore error', item.name, e);
        }
        continue;
      }

      // ── Card overlay (композиция) ──
      if (item.type === 'card') {
        if (typeof BackgroundEngine.registerCardOverlay !== 'function') {
          console.warn('[PresetManager] registerCardOverlay not available, skipping card overlay');
          continue;
        }
        try {
          var cov = BackgroundEngine.registerCardOverlay();
          BackgroundEngine.updateOverlay(cov.id, {
            name:           item.name           !== undefined ? item.name           : 'Композиция',
            // Карточка
            cardW:          item.cardW          !== undefined ? item.cardW          : 60,
            cardAspect:     item.cardAspect     !== undefined ? item.cardAspect     : 0.5625,
            cardRotation:   item.cardRotation   !== undefined ? item.cardRotation   : 0,
            // Рамка
            frameStyle:     item.frameStyle     !== undefined ? item.frameStyle     : 'titlecard',
            frameColor:     item.frameColor     !== undefined ? item.frameColor     : '#ffffff',
            frameThickness: item.frameThickness !== undefined ? item.frameThickness : 3,
            frameDetail:    item.frameDetail    !== undefined ? item.frameDetail    : 6,
            framePad:       item.framePad       !== undefined ? item.framePad       : 0,
            frameRotation:  item.frameRotation  !== undefined ? item.frameRotation  : 0,
            frameAnimMode:  item.frameAnimMode  !== undefined ? item.frameAnimMode  : 'none',
            frameAnimAmt:   item.frameAnimAmt   !== undefined ? item.frameAnimAmt   : 0.5,
            frameAnimSpeed: item.frameAnimSpeed !== undefined ? item.frameAnimSpeed : 1.0,
            // Блоки — приводим к корректной структуре с дефолтами по типу
            blocks: (Array.isArray(item.blocks) ? item.blocks : []).map(function(b) {
              var k = b.kind || 'text';
              var newId = b.id || ('blk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 4));
              var base = {
                id: newId, kind: k,
                x: b.x !== undefined ? b.x : 50,
                y: b.y !== undefined ? b.y : 50,
                opacity: b.opacity !== undefined ? b.opacity : 1,
              };
              if (k === 'image') {
                return Object.assign({}, base, {
                  imgData:      b.imgData || null,
                  widthPct:     b.widthPct     !== undefined ? b.widthPct     : 30,
                  rotation:     b.rotation     !== undefined ? b.rotation     : 0,
                  border:       !!b.border,
                  borderColor:  b.borderColor  || '#ffffff',
                  borderWidth:  b.borderWidth  !== undefined ? b.borderWidth  : 2,
                  cornerRadius: b.cornerRadius !== undefined ? b.cornerRadius : 0,
                });
              }
              if (k === 'divider') {
                return Object.assign({}, base, {
                  orientation: b.orientation || 'horizontal',
                  lengthPct:   b.lengthPct !== undefined ? b.lengthPct : 50,
                  thickness:   b.thickness !== undefined ? b.thickness : 2,
                  color:       b.color || '#ffffff',
                });
              }
              // text
              return Object.assign({}, base, {
                text:          b.text !== undefined ? b.text : '',
                font:          b.font || "'Bebas Neue', cursive",
                sizePct:       b.sizePct !== undefined ? b.sizePct : 8,
                color:         b.color || '#ffffff',
                bold:          !!b.bold,
                italic:        !!b.italic,
                letterSpacing: b.letterSpacing !== undefined ? b.letterSpacing : 0,
                align:         b.align || 'center',
                maxWidthPct:   b.maxWidthPct !== undefined ? b.maxWidthPct : 90,
                shadow:        !!b.shadow,
                shadowColor:   b.shadowColor || '#000000',
                shadowBlur:    b.shadowBlur !== undefined ? b.shadowBlur : 8,
              });
            }),
            // Общие
            layer:          item.layer          !== undefined ? item.layer          : 'above',
            scope:          item.scope          !== undefined ? item.scope          : 'global',
            startLine:      item.startLine      !== undefined ? item.startLine      : 0,
            endLine:        item.endLine        !== undefined ? item.endLine        : 999,
            selectedLines:  item.selectedLines  || [],
            positionMode:   item.positionMode   !== undefined ? item.positionMode   : 'center',
            x:              item.x              !== undefined ? item.x              : 50,
            y:              item.y              !== undefined ? item.y              : 50,
            width:          item.width          !== undefined ? item.width          : 25,
            opacity:        item.opacity        !== undefined ? item.opacity        : 1.0,
            enabled:        item.enabled        !== false,
            fadeSpeed:      item.fadeSpeed      !== undefined ? item.fadeSpeed      : 2.5,
          });
        } catch (e) {
          console.warn('[PresetManager] card overlay restore error', item.name, e);
        }
        continue;
      }

      // ── Frame overlay ──
      if (item.type === 'frame') {
        if (typeof BackgroundEngine.registerFrameOverlay !== 'function') {
          console.warn('[PresetManager] registerFrameOverlay not available, skipping frame overlay');
          continue;
        }
        try {
          var fov = BackgroundEngine.registerFrameOverlay();
          BackgroundEngine.updateOverlay(fov.id, {
            name:          item.name          !== undefined ? item.name          : 'Рамка',
            frameStyle:    item.frameStyle     !== undefined ? item.frameStyle    : 'nexus',
            frameColor:    item.frameColor     !== undefined ? item.frameColor    : '#d4a84b',
            frameThickness:item.frameThickness !== undefined ? item.frameThickness: 3,
            frameDetail:   item.frameDetail    !== undefined ? item.frameDetail   : 6,
            framePad:      item.framePad       !== undefined ? item.framePad      : 0,
            frameAnimMode: item.frameAnimMode  !== undefined ? item.frameAnimMode : 'none',
            frameAnimAmt:  item.frameAnimAmt   !== undefined ? item.frameAnimAmt  : 0.5,
            layer:         item.layer          !== undefined ? item.layer         : 'below',
            scope:         item.scope          !== undefined ? item.scope         : 'global',
            startLine:     item.startLine      !== undefined ? item.startLine     : 0,
            endLine:       item.endLine        !== undefined ? item.endLine       : 999,
            selectedLines: item.selectedLines  || [],
            positionMode:  item.positionMode   !== undefined ? item.positionMode  : 'fill',
            x:             item.x              !== undefined ? item.x             : 50,
            y:             item.y              !== undefined ? item.y             : 50,
            width:         item.width          !== undefined ? item.width         : 95,
            effect:        item.effect         !== undefined ? item.effect        : 'static',
            effectAmt:     item.effectAmt      !== undefined ? item.effectAmt     : 0.5,
            opacity:       item.opacity        !== undefined ? item.opacity       : 1.0,
            enabled:       item.enabled        !== false,
            fadeSpeed:     item.fadeSpeed      !== undefined ? item.fadeSpeed     : 2.5,
          });
        } catch (e) {
          console.warn('[PresetManager] frame overlay restore error', item.name, e);
        }
        continue;
      }

      // ── Image overlay (со старыми пресетами — type может отсутствовать) ──
      if (!item.imgData) continue;
      try {
        var blob = _base64ToBlob(item.imgData, 'image/png');
        var file = new File([blob], item.name || 'overlay.png', { type: 'image/png' });
        var ov   = await BackgroundEngine.registerOverlay(file);
        BackgroundEngine.updateOverlay(ov.id, {
          layer:         item.layer         !== undefined ? item.layer         : 'above',
          scope:         item.scope         !== undefined ? item.scope         : 'global',
          startLine:     item.startLine     !== undefined ? item.startLine     : 0,
          endLine:       item.endLine       !== undefined ? item.endLine       : 999,
          selectedLines: item.selectedLines || [],
          positionMode:  item.positionMode  !== undefined ? item.positionMode  : 'center',
          x:             item.x             !== undefined ? item.x             : 50,
          y:             item.y             !== undefined ? item.y             : 50,
          width:         item.width         !== undefined ? item.width         : 25,
          effect:        item.effect        !== undefined ? item.effect        : 'static',
          effectAmt:     item.effectAmt     !== undefined ? item.effectAmt     : 0.5,
          opacity:       item.opacity       !== undefined ? item.opacity       : 1.0,
          enabled:       item.enabled       !== false,
          strokeEnabled: item.strokeEnabled !== undefined ? !!item.strokeEnabled : false,
          strokeColor:   item.strokeColor   !== undefined ? item.strokeColor   : '#ffffff',
          strokeWidth:   item.strokeWidth   !== undefined ? item.strokeWidth   : 2,
          shadowEnabled: item.shadowEnabled !== undefined ? !!item.shadowEnabled : false,
          shadowColor:   item.shadowColor   !== undefined ? item.shadowColor   : '#000000',
          shadowBlur:    item.shadowBlur    !== undefined ? item.shadowBlur    : 10,
          fadeSpeed:     item.fadeSpeed     !== undefined ? item.fadeSpeed     : 2.5,
        });
      } catch (e) {
        console.warn('[PresetManager] overlay restore error', item.name, e);
      }
    }

    // Регидрируем image-блоки карточек: base64 → HTMLImageElement
    if (typeof BackgroundEngine !== 'undefined' &&
        typeof BackgroundEngine.rehydrateCardImageBlocks === 'function') {
      try { await BackgroundEngine.rehydrateCardImageBlocks(); }
      catch (e) { console.warn('[PresetManager] image rehydrate error', e); }
    }
  }

  /* ── Активные File-объекты сессии ─────────── */
  let _sessionAudio = null;
  let _sessionBg    = null;

  function notifyAudioLoaded(file) {
    if (file) _sessionAudio = { file: file, name: file.name, mime: file.type };
  }

  function notifyBgLoaded(file) {
    if (file) _sessionBg = { file: file, name: file.name, mime: file.type };
  }

  /* ══════════════════════════════════════════════
     Сбор текущего состояния
  ══════════════════════════════════════════════ */
  function _collectSettings() {
    const appState = App.getState ? App.getState() : {};
    const params   = appState.params || {};

    let camState = null;
    try { camState = JSON.parse(JSON.stringify(BackgroundEngine.camState)); } catch(e) {}

    let fxState = null;
    try { fxState = JSON.parse(JSON.stringify(BackgroundEngine.fxState)); } catch(e) {}

    const lyricsEl = document.getElementById('lyricsInput');
    const lyrics   = lyricsEl ? lyricsEl.value : '';

    return { version: 4, savedAt: Date.now(), params: Object.assign({}, params), lyrics: lyrics, camState: camState, fxState: fxState };
  }

  /* ══════════════════════════════════════════════
     Применение состояния к UI
  ══════════════════════════════════════════════ */
  function _applySettings(state) {
    if (!state) return;

    const p  = state.params || {};
    const ap = App.getState ? App.getState().params : null;
    if (ap) Object.assign(ap, p);

    _sync('fontSelect',        p.font,             'value');
    _sync('fontSize',          p.fontSize,         'value');
    _sync('fontSizeVal',       p.fontSize,         'textContent');
    _sync('textColor',         p.color,            'value');
    _sync('animMode',          p.animMode,         'value');
    _sync('textPosition',      p.textPosition,     'value');
    _sync('translationColor',  p.translationColor, 'value');

    if (p.translationRatio !== undefined) {
      const pct = Math.round(p.translationRatio * 100);
      _sync('translationSize',    pct,        'value');
      _sync('translationSizeVal', pct + '%',  'textContent');
    }

    const trToggle = document.getElementById('translationToggle');
    if (trToggle) trToggle.classList.toggle('on', !!p.showTranslation);

    if (state.lyrics !== undefined) {
      const el = document.getElementById('lyricsInput');
      if (el) el.value = state.lyrics;
    }

    if (state.fxState && BackgroundEngine.setFX) {
      const fx = state.fxState;
      ['kenBurns','colorGrade','vignette','chromatic','letterbox','letterboxReactive'].forEach(function(name) {
        if (fx[name] !== undefined) {
          BackgroundEngine.setFX(name, fx[name]);
          const el = document.getElementById('fx-' + name);
          if (el) el.classList.toggle('on', fx[name]);
        }
      });
    }

    if (state.camState && BackgroundEngine.setCamParam) {
      const cam = state.camState;
      if (cam.zoom) {
        BackgroundEngine.setCamParam('zoom', 'enabled', cam.zoom.enabled);
        BackgroundEngine.setCamParam('zoom', 'value',   cam.zoom.value);
        _sync('camZoomVal',      cam.zoom.value,              'value');
        _sync('camZoomValLabel', cam.zoom.value != null ? cam.zoom.value.toFixed(2) : null, 'textContent');
        const btn = document.getElementById('camZoomToggle');
        if (btn) btn.classList.toggle('active', cam.zoom.enabled);
      }
      if (cam.musicZoom) {
        BackgroundEngine.setCamParam('musicZoom', 'enabled', cam.musicZoom.enabled);
        BackgroundEngine.setCamParam('musicZoom', 'invert',  cam.musicZoom.invert);
        BackgroundEngine.setCamParam('musicZoom', 'amount',  cam.musicZoom.amount);
        _sync('camMusicZoomAmt',      cam.musicZoom.amount,             'value');
        _sync('camMusicZoomAmtLabel', cam.musicZoom.amount != null ? cam.musicZoom.amount.toFixed(2) : null, 'textContent');
        const btn    = document.getElementById('camMusicZoomToggle');
        const dirBtn = document.getElementById('camMusicZoomDir');
        if (btn)    btn.classList.toggle('active', cam.musicZoom.enabled);
        if (dirBtn) dirBtn.textContent = cam.musicZoom.invert ? '← наружу' : '→ вовнутрь';
      }
      ['scrollX','scrollY'].forEach(function(axis) {
        if (!cam[axis]) return;
        BackgroundEngine.setCamParam(axis, 'enabled',   cam[axis].enabled);
        BackgroundEngine.setCamParam(axis, 'direction', cam[axis].direction);
        BackgroundEngine.setCamParam(axis, 'speed',     cam[axis].speed);
      });
      if (cam.scrollX) {
        _sync('camScrollXSpeed',      cam.scrollX.speed,             'value');
        _sync('camScrollXSpeedLabel', cam.scrollX.speed != null ? cam.scrollX.speed.toFixed(3) : null, 'textContent');
      }
      if (cam.scrollY) {
        _sync('camScrollYSpeed',      cam.scrollY.speed,             'value');
        _sync('camScrollYSpeedLabel', cam.scrollY.speed != null ? cam.scrollY.speed.toFixed(3) : null, 'textContent');
      }
    }
  }

  function _sync(id, value, prop) {
    if (value === undefined || value === null) return;
    const el = document.getElementById(id);
    if (el) el[prop] = value;
  }

  /* ══════════════════════════════════════════════
     Сохранение пресета
  ══════════════════════════════════════════════ */
  async function save(name, opts) {
    const withAudio = opts && opts.withAudio !== undefined ? opts.withAudio : true;
    const withBg    = opts && opts.withBg    !== undefined ? opts.withBg    : true;
    name = (name || '').trim();
    if (!name) return false;

    const idx = await _readIndex();

    if (idx.length >= MAX_PRESETS && !idx.find(function(e) { return e.name === name; })) {
      alert('Максимум ' + MAX_PRESETS + ' пресетов. Удали старые.');
      return false;
    }

    _showToast('Сохранение…', 0);

    const settingsKey = 'chromatype:preset:' + name + ':settings';
    const audioKey    = 'chromatype:preset:' + name + ':audio';
    const bgKey       = 'chromatype:preset:' + name + ':bg';
    const overlaysKey = 'chromatype:preset:' + name + ':overlays';

    await _storageSet(settingsKey, JSON.stringify(_collectSettings()));

    // Сохраняем оверлеи (объекты-картинки с настройками)
    try {
      const serializedOverlays = await _serializeOverlays();
      if (serializedOverlays.length) {
        await _storageSet(overlaysKey, JSON.stringify(serializedOverlays));
      } else {
        await _storageDel(overlaysKey);
      }
    } catch(e) { console.warn('[PresetManager] overlays save error', e); }

    let hasAudio = false;
    if (withAudio && _sessionAudio) {
      try {
        const b64 = await _fileToBase64(_sessionAudio.file);
        await _storageSet(audioKey, JSON.stringify({ data: b64, mime: _sessionAudio.mime, name: _sessionAudio.name }));
        hasAudio = true;
      } catch(e) { console.warn('[PresetManager] audio save error', e); }
    } else if (!withAudio) {
      await _storageDel(audioKey);
    }

    let hasBg = false; let bgType = null;
    if (withBg && _sessionBg) {
      try {
        const b64 = await _fileToBase64(_sessionBg.file);
        await _storageSet(bgKey, JSON.stringify({ data: b64, mime: _sessionBg.mime, name: _sessionBg.name }));
        hasBg = true;
        bgType = _sessionBg.mime.startsWith('video/') ? 'video' : 'image';
      } catch(e) { console.warn('[PresetManager] bg save error', e); }
    } else if (!withBg) {
      await _storageDel(bgKey);
    }

    const existing = idx.findIndex(function(e) { return e.name === name; });
    const entry = { name: name, savedAt: Date.now(), hasAudio: hasAudio, hasBg: hasBg, bgType: bgType };
    if (existing >= 0) idx[existing] = entry;
    else idx.push(entry);
    await _writeIndex(idx);

    _showToast('✓ Пресет сохранён', 2000);
    return true;
  }

  /* ══════════════════════════════════════════════
     Загрузка пресета
  ══════════════════════════════════════════════ */
  async function load(name) {
    _showToast('Загрузка…', 0);

    const settingsKey = 'chromatype:preset:' + name + ':settings';
    const audioKey    = 'chromatype:preset:' + name + ':audio';
    const bgKey       = 'chromatype:preset:' + name + ':bg';
    const overlaysKey = 'chromatype:preset:' + name + ':overlays';

    const settingsRaw = await _storageGet(settingsKey);
    if (!settingsRaw) { _showToast('Пресет не найден', 2000); return false; }
    try { _applySettings(JSON.parse(settingsRaw)); } catch(e) { console.warn(e); }

    // Восстанавливаем оверлеи
    const overlaysRaw = await _storageGet(overlaysKey);
    if (overlaysRaw) {
      try { await _restoreOverlays(JSON.parse(overlaysRaw)); } catch(e) { console.warn('[PresetManager] overlays restore error', e); }
    }

    const audioRaw = await _storageGet(audioKey);
    if (audioRaw) {
      try {
        const parsed = JSON.parse(audioRaw);
        const file = _base64ToFile(parsed.data, parsed.mime, parsed.name || 'audio');
        const arrayBuffer = await file.arrayBuffer();
        await AudioEngine.loadBuffer(arrayBuffer);
        _sessionAudio = { file: file, name: parsed.name, mime: parsed.mime };

        const dropEl = document.getElementById('audioDrop');
        const nameEl = dropEl && dropEl.querySelector('.drop-name');
        if (nameEl) nameEl.textContent = parsed.name || 'Аудио загружено';
        if (dropEl) dropEl.classList.add('loaded');

        ['playBtn','stopBtn','recBtn','exportBtn'].forEach(function(id) {
          const b = document.getElementById(id);
          if (b) b.disabled = false;
        });
        const statusEl = document.getElementById('statusText');
        if (statusEl) statusEl.textContent = 'READY — ' + _fmtDuration(AudioEngine.duration);
      } catch(e) { console.warn('[PresetManager] audio restore error', e); }
    }

    const bgRaw = await _storageGet(bgKey);
    if (bgRaw) {
      try {
        const parsed = JSON.parse(bgRaw);
        const file = _base64ToFile(parsed.data, parsed.mime, parsed.name || 'background');
        const bgType = await BackgroundEngine.load(file);
        _sessionBg = { file: file, name: parsed.name, mime: parsed.mime };

        const dropEl  = document.getElementById('bgDrop');
        const nameEl  = dropEl && dropEl.querySelector('.drop-name');
        const badgeEl = document.getElementById('bgTypeBadge');
        if (nameEl) nameEl.textContent = parsed.name || 'Фон загружен';
        if (dropEl) dropEl.classList.add('loaded');
        if (badgeEl) badgeEl.textContent = bgType.toUpperCase();
      } catch(e) { console.warn('[PresetManager] bg restore error', e); }
    }

    _showToast('✓ Пресет загружен', 2000);
    return true;
  }

  /* ══════════════════════════════════════════════
     Удаление пресета
  ══════════════════════════════════════════════ */
  async function remove(name) {
    await _storageDel('chromatype:preset:' + name + ':settings');
    await _storageDel('chromatype:preset:' + name + ':audio');
    await _storageDel('chromatype:preset:' + name + ':bg');
    await _storageDel('chromatype:preset:' + name + ':overlays');
    const idx = await _readIndex();
    await _writeIndex(idx.filter(function(e) { return e.name !== name; }));
  }

  /* ══════════════════════════════════════════════
     Список пресетов
  ══════════════════════════════════════════════ */
  async function list() {
    const idx = await _readIndex();
    return idx.map(function(e) {
      return {
        name:     e.name,
        savedAt:  e.savedAt ? new Date(e.savedAt).toLocaleString('ru') : '—',
        hasAudio: !!e.hasAudio,
        hasBg:    !!e.hasBg,
        bgType:   e.bgType || null,
      };
    });
  }

  /* ══════════════════════════════════════════════
     Экспорт / Импорт
  ══════════════════════════════════════════════ */
  async function exportFile(name) {
    let exportData;
    if (name) {
      // Экспорт одного пресета: объединяем settings + overlays в один объект
      const settingsRaw  = await _storageGet('chromatype:preset:' + name + ':settings');
      if (!settingsRaw) return;
      const settings = JSON.parse(settingsRaw);
      
      // Подтягиваем оверлеи из хранилища (если есть) и вшиваем в экспорт
      const overlaysRaw = await _storageGet('chromatype:preset:' + name + ':overlays');
      if (overlaysRaw) {
        try { settings._overlays = JSON.parse(overlaysRaw); } catch(e) {}
      }
      exportData = JSON.stringify(settings);
    } else {
      exportData = JSON.stringify(await _collectSettingsAll());
    }
    const blob = new Blob([exportData], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = name ? name + '.json' : 'chromatype-presets.json';
    a.click();
  }

  async function _collectSettingsAll() {
    const idx    = await _readIndex();
    const result = {};
    for (const item of idx) {
      const raw = await _storageGet('chromatype:preset:' + item.name + ':settings');
      if (raw) { try { result[item.name] = JSON.parse(raw); } catch(e) {} }
    }
    return result;
  }

  async function importFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    const names = [];

    const presets = data.version
      ? { [file.name.replace(/\.json$/, '')]: data }
      : data;

    const idx = await _readIndex();
    for (const [name, state] of Object.entries(presets)) {
      // Если в экспорте есть вшитые оверлеи — сохраняем их отдельным ключом
      if (state._overlays && Array.isArray(state._overlays)) {
        await _storageSet('chromatype:preset:' + name + ':overlays', JSON.stringify(state._overlays));
        // Удаляем из объекта настроек чтобы не засорять settings-ключ
        const stateClean = Object.assign({}, state);
        delete stateClean._overlays;
        await _storageSet('chromatype:preset:' + name + ':settings', JSON.stringify(stateClean));
      } else {
        await _storageSet('chromatype:preset:' + name + ':settings', JSON.stringify(state));
      }
      const existing = idx.findIndex(function(e) { return e.name === name; });
      const entry = { name: name, savedAt: state.savedAt || Date.now(), hasAudio: false, hasBg: false };
      if (existing >= 0) idx[existing] = entry;
      else idx.push(entry);
      names.push(name);
    }
    await _writeIndex(idx);
    return names;
  }

  /* ══════════════════════════════════════════════
     Автосохранение
  ══════════════════════════════════════════════ */
  let _autoTimer   = null;
  let _autoSaving  = false;   // guard: не запускать параллельный autosave

  function scheduleAutosave() {
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(_doAutosave, 800); // увеличили с 500 → 800ms
  }

  async function _doAutosave() {
    if (_autoSaving) return; // предыдущий ещё не завершился — пропускаем
    _autoSaving = true;
    try {
      await _storageSet('chromatype:autosave:settings', JSON.stringify(_collectSettings()));

      if (_sessionAudio) {
        try {
          const b64 = await _fileToBase64(_sessionAudio.file);
          await _storageSet('chromatype:autosave:audio', JSON.stringify({ data: b64, mime: _sessionAudio.mime, name: _sessionAudio.name }));
        } catch(e) { console.warn('[PresetManager] autosave audio failed', e); }
      }

      if (_sessionBg) {
        try {
          const b64 = await _fileToBase64(_sessionBg.file);
          await _storageSet('chromatype:autosave:bg', JSON.stringify({ data: b64, mime: _sessionBg.mime, name: _sessionBg.name }));
        } catch(e) { console.warn('[PresetManager] autosave bg failed', e); }
      }

      // Автосохранение оверлеев (включая текстовые)
      try {
        const serializedOverlays = await _serializeOverlays();
        if (serializedOverlays.length) {
          await _storageSet('chromatype:autosave:overlays', JSON.stringify(serializedOverlays));
        } else {
          await _storageDel('chromatype:autosave:overlays');
        }
      } catch(e) {}
    } finally {
      _autoSaving = false;
    }
  }

  async function hasAutosave() {
    const v = await _storageGet('chromatype:autosave:settings');
    return !!v;
  }

  async function loadAutosave() {
    const raw = await _storageGet('chromatype:autosave:settings');
    if (!raw) return false;

    try { _applySettings(JSON.parse(raw)); } catch(e) {}

    const audioRaw = await _storageGet('chromatype:autosave:audio');
    if (audioRaw) {
      try {
        const parsed = JSON.parse(audioRaw);
        const file = _base64ToFile(parsed.data, parsed.mime, parsed.name || 'audio');
        await AudioEngine.loadBuffer(await file.arrayBuffer());
        _sessionAudio = { file: file, name: parsed.name, mime: parsed.mime };
        const dropEl = document.getElementById('audioDrop');
        const nameEl = dropEl && dropEl.querySelector('.drop-name');
        if (nameEl) nameEl.textContent = parsed.name || 'Аудио';
        if (dropEl) dropEl.classList.add('loaded');
        ['playBtn','stopBtn','recBtn','exportBtn'].forEach(function(id) {
          const b = document.getElementById(id); if (b) b.disabled = false;
        });
      } catch(e) {}
    }

    const bgRaw = await _storageGet('chromatype:autosave:bg');
    if (bgRaw) {
      try {
        const parsed = JSON.parse(bgRaw);
        const file = _base64ToFile(parsed.data, parsed.mime, parsed.name || 'background');
        const bgType = await BackgroundEngine.load(file);
        _sessionBg = { file: file, name: parsed.name, mime: parsed.mime };
        const dropEl  = document.getElementById('bgDrop');
        const nameEl  = dropEl && dropEl.querySelector('.drop-name');
        const badgeEl = document.getElementById('bgTypeBadge');
        if (nameEl)  nameEl.textContent = parsed.name || 'Фон';
        if (dropEl)  dropEl.classList.add('loaded');
        if (badgeEl) badgeEl.textContent = bgType.toUpperCase();
      } catch(e) {}
    }

    // Восстанавливаем оверлеи из автосохранения
    const overlaysRaw = await _storageGet('chromatype:autosave:overlays');
    if (overlaysRaw) {
      try { await _restoreOverlays(JSON.parse(overlaysRaw)); } catch(e) {}
    }

    return true;
  }

  /* ══════════════════════════════════════════════
     Утилиты
  ══════════════════════════════════════════════ */
  function _fmtDuration(s) {
    if (isNaN(s)) return '00:00';
    return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(Math.floor(s%60)).padStart(2,'0');
  }

  let _toastEl = null; let _toastTimeout = null;
  function _showToast(msg, duration) {
    if (duration === undefined) duration = 2000;
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.style.cssText = [
        'position:fixed','bottom:20px','left:50%','transform:translateX(-50%)',
        'background:#111','border:1px solid #e8ff00','color:#e8ff00',
        "font-family:'Space Mono',monospace",'font-size:10px','letter-spacing:2px',
        'padding:8px 18px','border-radius:3px','z-index:99999',
        'pointer-events:none','white-space:nowrap','transition:opacity .25s',
      ].join(';');
      document.body.appendChild(_toastEl);
    }
    clearTimeout(_toastTimeout);
    _toastEl.textContent = msg.toUpperCase();
    _toastEl.style.opacity = '1';
    if (duration > 0) {
      _toastTimeout = setTimeout(function() { _toastEl.style.opacity = '0'; }, duration);
    }
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ══════════════════════════════════════════════
     Панель пресетов (UI)
  ══════════════════════════════════════════════ */
  let _panel = null;

  function openPanel() {
    if (_panel) { _panel.remove(); _panel = null; document.removeEventListener('click', _outsideClick); return; }

    _panel = document.createElement('div');
    _panel.id = 'presetPanel';
    _panel.style.cssText = [
      'position:fixed','top:52px','right:16px',
      'width:340px','max-height:calc(100vh - 80px)',
      'background:#111','border:1px solid #2a2a2a',
      'display:flex','flex-direction:column',
      'z-index:9999',
      "font-family:'Space Mono',monospace",'font-size:11px','color:#eee',
      'box-shadow:0 12px 50px rgba(0,0,0,.9)',
    ].join(';');

    _panel.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #222;">',
        '<span style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#e8ff00;">&#128190; ПРЕСЕТЫ</span>',
        '<div style="display:flex;align-items:center;gap:8px;">',
          '<span style="font-size:8px;color:#00e5ff;letter-spacing:1px;">&#128190; IDB</span>',
          '<button id="presetPanelClose" style="background:none;border:none;color:#666;font-size:16px;cursor:pointer;padding:0;">&#10005;</button>',
        '</div>',
      '</div>',

      '<div style="padding:12px 14px;border-bottom:1px solid #1a1a1a;display:flex;gap:8px;">',
        '<input id="presetNameInput" type="text" placeholder="Название пресета…"',
          'style="flex:1;background:#0a0a0a;border:1px solid #333;color:#fff;font-family:inherit;font-size:10px;padding:7px 10px;outline:none;" />',
        '<button id="presetSaveBtn"',
          'style="background:#e8ff00;color:#000;border:none;font-family:inherit;font-size:9px;font-weight:700;letter-spacing:1px;padding:7px 12px;cursor:pointer;text-transform:uppercase;flex-shrink:0;">',
          'СОХРАНИТЬ',
        '</button>',
      '</div>',

      '<div style="padding:8px 14px;border-bottom:1px solid #1a1a1a;display:flex;gap:16px;align-items:center;">',
        '<span style="font-size:8px;color:#555;letter-spacing:1px;text-transform:uppercase;">Сохранить:</span>',
        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:9px;color:#aaa;">',
          '<input type="checkbox" id="saveWithAudio" checked style="accent-color:#e8ff00;" /> &#127925; Аудио',
        '</label>',
        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:9px;color:#aaa;">',
          '<input type="checkbox" id="saveWithBg" checked style="accent-color:#e8ff00;" /> &#128444; Фон',
        '</label>',
      '</div>',

      '<div style="flex:1;overflow-y:auto;padding:8px 6px;" id="presetList">',
        '<div style="color:#444;font-size:9px;text-align:center;padding:24px;">ЗАГРУЗКА…</div>',
      '</div>',

      '<div style="display:flex;gap:8px;padding:10px 14px;border-top:1px solid #1a1a1a;">',
        '<button id="presetExportAll"',
          'style="flex:1;background:transparent;border:1px solid #333;color:#888;font-family:inherit;font-size:9px;letter-spacing:1px;padding:7px;cursor:pointer;text-transform:uppercase;">',
          '&#8593; ЭКСПОРТ',
        '</button>',
        '<label style="flex:1;display:flex;align-items:center;justify-content:center;',
          'background:transparent;border:1px solid #333;color:#888;font-family:inherit;font-size:9px;',
          'letter-spacing:1px;padding:7px;cursor:pointer;text-transform:uppercase;">',
          '&#8595; ИМПОРТ',
          '<input type="file" id="presetImportFile" accept=".json" style="display:none;" />',
        '</label>',
      '</div>',
    ].join('');

    document.body.appendChild(_panel);

    _panel.querySelector('#presetPanelClose').addEventListener('click', _closePanel);

    _panel.querySelector('#presetSaveBtn').addEventListener('click', async function() {
      const name      = _panel.querySelector('#presetNameInput').value.trim();
      const withAudio = _panel.querySelector('#saveWithAudio').checked;
      const withBg    = _panel.querySelector('#saveWithBg').checked;
      if (!name) { _showToast('Введи название', 2000); return; }
      const btn = _panel.querySelector('#presetSaveBtn');
      btn.disabled = true;
      await save(name, { withAudio: withAudio, withBg: withBg });
      btn.disabled = false;
      await _renderList();
    });

    _panel.querySelector('#presetNameInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') _panel.querySelector('#presetSaveBtn').click();
    });

    _panel.querySelector('#presetExportAll').addEventListener('click', function() { exportFile(); });

    _panel.querySelector('#presetImportFile').addEventListener('change', async function(e) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const names = await importFile(f);
        await _renderList();
        _showToast('Импорт: ' + names.join(', '), 3000);
      } catch(err) {
        _showToast('Ошибка импорта', 3000);
        console.error(err);
      }
      e.target.value = '';
    });

    _renderList();

    setTimeout(function() {
      document.addEventListener('click', _outsideClick);
    }, 50);
  }

  function _closePanel() {
    if (_panel) { _panel.remove(); _panel = null; }
    document.removeEventListener('click', _outsideClick);
  }

  function _outsideClick(e) {
    const btn = document.getElementById('presetBtn');
    if (_panel && !_panel.contains(e.target) && e.target !== btn && !(btn && btn.contains(e.target))) {
      _closePanel();
    }
  }

  async function _renderList() {
    const container = _panel && _panel.querySelector('#presetList');
    if (!container) return;

    const items = await list();

    if (!items.length) {
      container.innerHTML = '<div style="color:#444;font-size:9px;text-align:center;padding:24px;">Нет сохранённых пресетов</div>';
      return;
    }

    container.innerHTML = items.map(function(item) {
      return [
        '<div class="preset-item" data-name="' + _esc(item.name) + '"',
          'style="display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid #1a1a1a;">',
          '<div style="flex:1;overflow:hidden;" title="' + _esc(item.name) + '">',
            '<div style="font-size:10px;color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(item.name) + '</div>',
            '<div style="font-size:8px;color:#444;margin-top:2px;">',
              item.savedAt,
              '<span style="color:#555;margin-left:6px;">',
                (item.hasAudio ? '&#127925;' : '<span style="opacity:.2">&#127925;</span>'),
                ' ',
                (item.hasBg    ? '&#128444;' : '<span style="opacity:.2">&#128444;</span>'),
              '</span>',
            '</div>',
          '</div>',
          '<button class="preset-load-btn" data-name="' + _esc(item.name) + '"',
            'style="background:#e8ff00;color:#000;border:none;font-family:inherit;font-size:8px;font-weight:700;',
            'letter-spacing:1px;padding:5px 10px;cursor:pointer;text-transform:uppercase;flex-shrink:0;">',
            'ЗАГРУЗИТЬ',
          '</button>',
          '<button class="preset-export-btn" data-name="' + _esc(item.name) + '" title="Экспорт настроек в .json"',
            'style="background:none;border:1px solid #333;color:#666;font-family:inherit;font-size:10px;',
            'padding:4px 7px;cursor:pointer;flex-shrink:0;">&#8593;</button>',
          '<button class="preset-del-btn" data-name="' + _esc(item.name) + '" title="Удалить"',
            'style="background:none;border:none;color:#444;font-family:inherit;font-size:14px;',
            'padding:0 4px;cursor:pointer;flex-shrink:0;">&#10005;</button>',
        '</div>',
      ].join('');
    }).join('');

    container.querySelectorAll('.preset-load-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        btn.textContent = '…';
        btn.disabled = true;
        await load(btn.dataset.name);
        btn.textContent = '✓';
        setTimeout(function() { if (btn) { btn.textContent = 'ЗАГРУЗИТЬ'; btn.disabled = false; } }, 1500);
      });
    });

    container.querySelectorAll('.preset-export-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); exportFile(btn.dataset.name); });
    });

    container.querySelectorAll('.preset-del-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (!confirm('Удалить пресет «' + btn.dataset.name + '»?')) return;
        await remove(btn.dataset.name);
        await _renderList();
      });
    });
  }

  /* ══════════════════════════════════════════════
     Инициализация
  ══════════════════════════════════════════════ */
  function buildUI() {
    const header = document.querySelector('header') || document.querySelector('.header');
    if (!header) return;

    const btn = document.createElement('button');
    btn.id = 'presetBtn';
    btn.style.cssText = [
      'background:transparent','border:1px solid #333','color:#e8ff00',
      "font-family:'Space Mono',monospace",
      'font-size:9px','letter-spacing:2px','text-transform:uppercase',
      'padding:6px 12px','cursor:pointer',
    ].join(';');
    btn.textContent = '💾 ПРЕСЕТЫ';
    btn.title = 'Сохранить / загрузить настройки, файлы и лирику';

    const nav = header.querySelector('nav') || header.querySelector('a');
    if (nav) header.insertBefore(btn, nav);
    else header.appendChild(btn);

    btn.addEventListener('click', openPanel);

    _attachAutosaveListeners();

    const audioInput = document.getElementById('audioFile');
    if (audioInput) {
      audioInput.addEventListener('change', function(e) {
        const f = e.target.files[0];
        if (f) notifyAudioLoaded(f);
      });
    }

    const bgInput = document.getElementById('bgFile');
    if (bgInput) {
      bgInput.addEventListener('change', function(e) {
        const f = e.target.files[0];
        if (f) notifyBgLoaded(f);
      });
    }

    // Задержка 1500ms: даём странице полностью загрузиться и убеждаемся
    // что никакой autosave запрос не идёт параллельно с проверкой наличия автосохранения.
    setTimeout(async function() {
      // Ждём если вдруг autosave уже в процессе
      if (_autoSaving) {
        await new Promise(function(r) { setTimeout(r, 2000); });
      }
      if (await hasAutosave()) {
        if (confirm('🔄 Обнаружено автосохранение (с файлами). Восстановить?')) {
          await loadAutosave();
        }
      }
    }, 1500);
  }

  function _attachAutosaveListeners() {
    var ids = [
      'fontSelect','fontSize','textColor','animMode','textPosition',
      'translationSize','translationColor','lyricsInput',
      'camZoomVal','camMusicZoomAmt','camScrollXSpeed','camScrollYSpeed',
    ];
    ids.forEach(function(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input',  scheduleAutosave);
      el.addEventListener('change', scheduleAutosave);
    });
    ['translationToggle','fx-kenBurns','fx-colorGrade','fx-vignette','fx-chromatic',
     'camZoomToggle','camMusicZoomToggle'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', scheduleAutosave);
    });

    // ── Хук от BackgroundEngine на любые изменения overlays ──
    // Добавление/удаление/изменение любого оверлея (и текстового, и image)
    // автоматически триггерит автосейв.
    if (typeof BackgroundEngine !== 'undefined' &&
        typeof BackgroundEngine.setOverlayChangeCallback === 'function') {
      BackgroundEngine.setOverlayChangeCallback(scheduleAutosave);
    }
  }

  /* ══════════════════════════════════════════════
     Public API
  ══════════════════════════════════════════════ */
  return {
    buildUI:           buildUI,
    save:              save,
    load:              load,
    remove:            remove,
    list:              list,
    exportFile:        exportFile,
    importFile:        importFile,
    scheduleAutosave:  scheduleAutosave,
    loadAutosave:      loadAutosave,
    hasAutosave:       hasAutosave,
    notifyAudioLoaded: notifyAudioLoaded,
    notifyBgLoaded:    notifyBgLoaded,
    collectState:      _collectSettings,
    applyState:        _applySettings,
  };

})();