/* ═══════════════════════════════════════════════
   js/PresetManager.js  v4 — Supabase storage
   Сохраняет / загружает пресеты CHROMATYPE
   в Supabase (включая аудио и фон как base64)
═══════════════════════════════════════════════ */
const PresetManager = (() => {

  const IDX_KEY      = 'chromatype:index';
  const MAX_PRESETS  = 20;
  const MAX_FILE_MB  = 4.5;

  /* ── Supabase REST adapter ───────────────────── */
  const _SB_URL   = 'https://iqjmtirmhnyyhkygmspb.supabase.co';
  const _SB_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxam10aXJtaG55eWhreWdtc3BiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjcwMTksImV4cCI6MjA4ODMwMzAxOX0.Od_EiI2wPOBuoQ8kWaGcY3mgsN_S1gRc-LK5Lhhk6fU';
  const _SB_TABLE = 'chromatype_presets';

  function _sbHeaders(extra) {
    // Supabase REST requires apikey + Authorization headers.
    // Use the anon/public JWT key from: Project Settings → API → anon public
    return Object.assign({
      'Content-Type': 'application/json',
      'apikey': _SB_KEY,
      'Authorization': 'Bearer ' + _SB_KEY,
    }, extra || {});
  }

  async function _storageGet(key) {
    try {
      const res = await fetch(
        _SB_URL + '/rest/v1/' + _SB_TABLE + '?key=eq.' + encodeURIComponent(key) + '&select=value&limit=1',
        { headers: _sbHeaders() }
      );
      if (!res.ok) {
        console.error('[PresetManager] storageGet FAILED:', res.status, key, await res.text());
        return null;
      }
      const rows = await res.json();
      return rows.length ? rows[0].value : null;
    } catch (e) {
      console.warn('[PresetManager] storageGet failed:', key, e);
      return null;
    }
  }

  async function _storageSet(key, value) {
    try {
      const payload = { key: key, value: value, updated_at: new Date().toISOString() };
      // Try PATCH (update existing row) first
      const patchRes = await fetch(
        _SB_URL + '/rest/v1/' + _SB_TABLE + '?key=eq.' + encodeURIComponent(key),
        {
          method: 'PATCH',
          headers: _sbHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify({ value: value, updated_at: new Date().toISOString() }),
        }
      );
      if (patchRes.ok) {
        const patched = await patchRes.json();
        if (patched && patched.length > 0) return true; // row existed, updated
      }
      // Row didn't exist — INSERT
      const postRes = await fetch(
        _SB_URL + '/rest/v1/' + _SB_TABLE,
        {
          method: 'POST',
          headers: _sbHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify(payload),
        }
      );
      if (!postRes.ok) {
        const err = await postRes.text();
        console.error('[PresetManager] storageSet FAILED:', postRes.status, key, err);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[PresetManager] storageSet error:', key, e);
      return false;
    }
  }

  async function _storageDel(key) {
    try {
      await fetch(
        _SB_URL + '/rest/v1/' + _SB_TABLE + '?key=eq.' + encodeURIComponent(key),
        { method: 'DELETE', headers: _sbHeaders() }
      );
    } catch {}
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
      const imgData = await _overlayImgToBase64(ov);
      if (!imgData) continue;
      result.push({
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
      });
    }
    return result;
  }

  // Восстанавливает оверлеи из сохранённых данных
  async function _restoreOverlays(data) {
    if (!data || !data.length || typeof BackgroundEngine === 'undefined') return;
    // Удаляем текущие оверлеи
    const existing = [...BackgroundEngine.overlays];
    existing.forEach(function(ov) { BackgroundEngine.removeOverlay(ov.id); });

    for (var i = 0; i < data.length; i++) {
      var item = data[i];
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
        });
      } catch (e) {
        console.warn('[PresetManager] overlay restore error', item.name, e);
      }
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
      const mb = _mb(_sessionAudio.file);
      if (mb > MAX_FILE_MB) {
        _showToast('⚠ Аудио ' + mb.toFixed(1) + ' МБ — слишком большой, пропущен', 3000);
      } else {
        try {
          const b64 = await _fileToBase64(_sessionAudio.file);
          await _storageSet(audioKey, JSON.stringify({ data: b64, mime: _sessionAudio.mime, name: _sessionAudio.name }));
          hasAudio = true;
        } catch(e) { console.warn('[PresetManager] audio save error', e); }
      }
    } else if (!withAudio) {
      await _storageDel(audioKey);
    }

    let hasBg = false; let bgType = null;
    if (withBg && _sessionBg) {
      const mb = _mb(_sessionBg.file);
      if (mb > MAX_FILE_MB) {
        _showToast('⚠ Фон ' + mb.toFixed(1) + ' МБ — слишком большой, пропущен', 3000);
      } else {
        try {
          const b64 = await _fileToBase64(_sessionBg.file);
          await _storageSet(bgKey, JSON.stringify({ data: b64, mime: _sessionBg.mime, name: _sessionBg.name }));
          hasBg = true;
          bgType = _sessionBg.mime.startsWith('video/') ? 'video' : 'image';
        } catch(e) { console.warn('[PresetManager] bg save error', e); }
      }
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
    const key = name
      ? await _storageGet('chromatype:preset:' + name + ':settings')
      : JSON.stringify(await _collectSettingsAll());
    if (!key) return;
    const blob = new Blob([key], { type: 'application/json' });
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
      await _storageSet('chromatype:preset:' + name + ':settings', JSON.stringify(state));
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
  let _autoTimer = null;

  function scheduleAutosave() {
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(_doAutosave, 2000);
  }

  async function _doAutosave() {
    await _storageSet('chromatype:autosave:settings', JSON.stringify(_collectSettings()));

    if (_sessionAudio && _mb(_sessionAudio.file) <= MAX_FILE_MB) {
      try {
        const b64 = await _fileToBase64(_sessionAudio.file);
        await _storageSet('chromatype:autosave:audio', JSON.stringify({ data: b64, mime: _sessionAudio.mime, name: _sessionAudio.name }));
      } catch(e) {}
    }

    if (_sessionBg && _mb(_sessionBg.file) <= MAX_FILE_MB) {
      try {
        const b64 = await _fileToBase64(_sessionBg.file);
        await _storageSet('chromatype:autosave:bg', JSON.stringify({ data: b64, mime: _sessionBg.mime, name: _sessionBg.name }));
      } catch(e) {}
    }

    // Автосохранение оверлеев
    try {
      const serializedOverlays = await _serializeOverlays();
      if (serializedOverlays.length) {
        await _storageSet('chromatype:autosave:overlays', JSON.stringify(serializedOverlays));
      }
    } catch(e) {}
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
          '<span style="font-size:8px;color:#00e5ff;letter-spacing:1px;">&#9729; SUPABASE</span>',
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

    setTimeout(async function() {
      if (await hasAutosave()) {
        if (confirm('🔄 Обнаружено автосохранение (с файлами). Восстановить?')) {
          await loadAutosave();
        }
      }
    }, 800);
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
