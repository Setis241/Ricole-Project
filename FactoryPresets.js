/* ══════════════════════════════════════════════════════════════
   FactoryPresets — встроенная библиотека готовых стилей.
   Один клик = шрифт + размер + позиция + анимация + рамка +
   FX + камера. Применяется через PresetManager.applyState().
   Пользовательские пресеты (PresetManager) не трогаются.
══════════════════════════════════════════════════════════════ */
const FactoryPresets = (function() {
  'use strict';

  /* Базовые значения — на них накладывается каждый стиль,
     чтобы пресет всегда давал предсказуемый результат целиком,
     а не мешался с предыдущим. */
  const BASE_PARAMS = {
    bassSens: 1.2, maxScale: 2.0, fadeDur: 0.2,
    fontSize: 96, font: "'Bebas Neue', cursive", color: '#ffffff',
    animMode: 'pulse', textPosition: 'center', globalBoxId: null,
    showTranslation: true, translationRatio: 0.40,
    translationColor: '#999999', translationGap: 0.85,
  };

  const BASE_FX = {
    kenBurns: false, colorGrade: false, vignette: false,
    chromatic: false, letterbox: false, letterboxReactive: false,
  };

  const BASE_CAM = {
    zoom:      { enabled: false, value: 1.3 },
    musicZoom: { enabled: false, invert: false, amount: 0.4 },
    scrollX:   { enabled: false, speed: 0.05, direction: 1, position: 0 },
    scrollY:   { enabled: false, speed: 0.05, direction: 1, position: 0 },
  };

  /* ══════════════════════════════════════════════
     Каталог стилей
  ══════════════════════════════════════════════ */
  const PRESETS = [
    {
      id: 'trailer', accent: '#ffffff', icon: '🎞', name: 'КИНОТРЕЙЛЕР',
      desc: 'Широкие полосы, медленный наезд, холодный грейд. Универсальная «дорогая» база.',
      params: { font: "'Oswald', sans-serif", fontSize: 112, color: '#f2f2f2',
                animMode: 'cinematic', textPosition: 'center', globalBoxId: 'boxthird',
                translationColor: '#8a8a8a', translationRatio: 0.36 },
      fx:  { kenBurns: true, vignette: true, colorGrade: true, letterbox: true },
      cam: { zoom: { enabled: true, value: 1.18 } },
    },
    {
      id: 'neon', accent: '#00e5ff', icon: '🌃', name: 'НЕОН-КЛУБ',
      desc: 'Жёсткий бит-зум вовнутрь и хроматика. Для танцевальных и электронных треков.',
      params: { font: "'Russo One', sans-serif", fontSize: 104, color: '#ffffff',
                animMode: 'impact', textPosition: 'center', globalBoxId: 'boxstealth',
                translationColor: '#00e5ff', translationRatio: 0.38 },
      fx:  { chromatic: true, vignette: true, colorGrade: true, letterboxReactive: true },
      cam: { musicZoom: { enabled: true, invert: false, amount: 0.75 } },
    },
    {
      id: 'punch', accent: '#e8ff00', icon: '🥊', name: 'ХИП-ХОП ПАНЧ',
      desc: 'Огромный шрифт, удар по центру на каждое слово. Читается даже в превью.',
      params: { font: "'Impact', sans-serif", fontSize: 150, color: '#ffffff',
                animMode: 'flash', textPosition: 'center', globalBoxId: 'boxslash',
                translationColor: '#e8ff00', translationRatio: 0.34 },
      fx:  { vignette: true, letterbox: true },
      cam: { musicZoom: { enabled: true, invert: false, amount: 0.9 } },
    },
    {
      id: 'lofi', accent: '#ffd9a0', icon: '🌙', name: 'ЛО-ФАЙ ЧИЛ',
      desc: 'Мягкий дрейф камеры, ничего не дёргается. Для спокойных и вечерних треков.',
      params: { font: "'Comfortaa', cursive", fontSize: 78, color: '#f4ece2',
                animMode: 'drift', textPosition: 'bottom', globalBoxId: 'boxcaption',
                translationColor: '#a89b8c', translationRatio: 0.42 },
      fx:  { kenBurns: true, vignette: true, colorGrade: true },
      cam: { scrollX: { enabled: true, speed: 0.012, direction: 1, position: 0 } },
    },
    {
      id: 'cipher', accent: '#c8ffdd', icon: '🔐', name: 'КИБЕР-ДЕКОД',
      desc: 'Расшифровка текста как в Matrix, прицельная рамка. Techno / dark / DnB.',
      params: { font: "'Space Mono', monospace", fontSize: 82, color: '#7dffb0',
                animMode: 'cipher', textPosition: 'center', globalBoxId: 'boxreticle',
                translationColor: '#2f8f5c', translationRatio: 0.40 },
      fx:  { chromatic: true, vignette: true, letterbox: true },
      cam: { zoom: { enabled: true, value: 1.12 },
             musicZoom: { enabled: true, invert: true, amount: 0.35 } },
    },
    {
      id: 'epic', accent: '#ffe6a8', icon: '⚔️', name: 'ЭПИК-ОРКЕСТР',
      desc: 'Крупный план каждого слова + реактивные полосы. Для драматичных припевов.',
      params: { font: "'Oswald', sans-serif", fontSize: 128, color: '#ffffff',
                animMode: 'nova', textPosition: 'center', globalBoxId: 'boxquote',
                translationColor: '#9a9a9a', translationRatio: 0.36 },
      fx:  { kenBurns: true, vignette: true, colorGrade: true, letterboxReactive: true },
      cam: { zoom: { enabled: true, value: 1.25 },
             musicZoom: { enabled: true, invert: false, amount: 0.5 } },
    },
    {
      id: 'minimal', accent: '#ffffff', icon: '▬', name: 'МИНИМАЛ-СУБТИТР',
      desc: 'Чистая нижняя подача лесенкой. Когда важен фон, а не текст.',
      params: { font: "'Montserrat', sans-serif", fontSize: 64, color: '#ffffff',
                animMode: 'cascade', textPosition: 'bottom', globalBoxId: 'boxsub',
                translationColor: '#b0b0b0', translationRatio: 0.46 },
      fx:  { vignette: true },
      cam: {},
    },
    {
      id: 'rock', accent: '#ff8a3d', icon: '🎸', name: 'РОК-СЦЕНА',
      desc: 'Разлёт слов и отдача камеры наружу на бит. Живая грязная энергия.',
      params: { font: "'Oswald', sans-serif", fontSize: 116, color: '#ffe9d6',
                animMode: 'scatter', textPosition: 'center', globalBoxId: 'boxtape',
                translationColor: '#c96a3f', translationRatio: 0.36 },
      fx:  { chromatic: true, vignette: true, colorGrade: true },
      cam: { musicZoom: { enabled: true, invert: true, amount: 0.8 } },
    },
    {
      id: 'dream', accent: '#e6c9ff', icon: '💧', name: 'ДРИМ-ПОП',
      desc: 'Рябь по буквам и очень медленный вертикальный увод. Мечтательно и мягко.',
      params: { font: "'Raleway', sans-serif", fontSize: 88, color: '#fdf6ff',
                animMode: 'ripple', textPosition: 'center', globalBoxId: 'boxunderline',
                translationColor: '#b9a7d6', translationRatio: 0.42 },
      fx:  { kenBurns: true, vignette: true, colorGrade: true },
      cam: { scrollY: { enabled: true, speed: 0.010, direction: -1, position: 0 } },
    },
    {
      id: 'retrowave', accent: '#5ee0ff', icon: '🌅', name: 'РЕТРОВЕЙВ',
      desc: 'Орбитальная посадка слов, хроматика и полосы. Synthwave / 80-е.',
      params: { font: "'Exo 2', sans-serif", fontSize: 100, color: '#ff5ec7',
                animMode: 'orbit', textPosition: 'center', globalBoxId: 'boxhex',
                translationColor: '#5ee0ff', translationRatio: 0.38 },
      fx:  { chromatic: true, colorGrade: true, vignette: true, letterbox: true },
      cam: { zoom: { enabled: true, value: 1.15 },
             musicZoom: { enabled: true, invert: false, amount: 0.45 } },
    },
    {
      id: 'shorts', accent: '#e8ff00', icon: '📱', name: 'ВЕРТИКАЛЬ / SHORTS',
      desc: 'Крупно, сверху, тетрис-склейка. Расчёт на маленький экран и звук по умолчанию.',
      params: { font: "'Rubik', sans-serif", fontSize: 132, color: '#ffffff',
                animMode: 'snap', textPosition: 'top', globalBoxId: 'boxmark',
                translationColor: '#e8ff00', translationRatio: 0.44 },
      fx:  { vignette: true },
      cam: { musicZoom: { enabled: true, invert: false, amount: 0.55 } },
    },
    {
      id: 'doc', accent: '#ffffff', icon: '🎥', name: 'ДОКУМЕНТАЛКА',
      desc: '2.5D-глубина и постоянный ход камеры. Спокойный «репортажный» вид.',
      params: { font: "'Play', sans-serif", fontSize: 72, color: '#f0f0f0',
                animMode: 'parallax', textPosition: 'bottom-left', globalBoxId: 'boxthird',
                translationColor: '#909090', translationRatio: 0.44 },
      fx:  { kenBurns: true, colorGrade: true, letterbox: true },
      cam: { scrollX: { enabled: true, speed: 0.020, direction: -1, position: 0 } },
    },
  ];

  /* ══════════════════════════════════════════════
     Применение
  ══════════════════════════════════════════════ */
  function _merge(base, over) {
    const out = JSON.parse(JSON.stringify(base));
    Object.keys(over || {}).forEach(function(k) {
      const v = over[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v))
        ? Object.assign(out[k] || {}, v)
        : v;
    });
    return out;
  }

  function get(id) {
    return PRESETS.filter(function(p) { return p.id === id; })[0] || null;
  }

  function apply(id) {
    const preset = get(id);
    if (!preset) return false;
    if (typeof PresetManager === 'undefined' || !PresetManager.applyState) return false;

    // Лирику и загруженные файлы не трогаем — только внешний вид.
    PresetManager.applyState({
      params:   _merge(BASE_PARAMS, preset.params),
      fxState:  _merge(BASE_FX,     preset.fx),
      camState: _merge(BASE_CAM,    preset.cam),
    });

    _syncGlobalBoxUI(preset.params.globalBoxId || null);

    if (PresetManager.scheduleAutosave) PresetManager.scheduleAutosave();
    return true;
  }

  /* applyState не подсвечивает выбранную глобальную рамку — делаем сами. */
  function _syncGlobalBoxUI(boxId) {
    const container = document.getElementById('globalBoxList');
    if (!container) return;
    const want = boxId || '';
    container.querySelectorAll('.global-box-btn').forEach(function(b) {
      b.classList.toggle('active', (b.dataset.boxId || '') === want);
    });
  }

  function random() {
    const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    apply(p.id);
    return p;
  }

  /* ══════════════════════════════════════════════
     UI
  ══════════════════════════════════════════════ */
  let _panel = null;

  function _closePanel() {
    if (_panel) { _panel.remove(); _panel = null; }
    document.removeEventListener('click', _outsideClick, true);
  }

  function _outsideClick(e) {
    if (!_panel) return;
    if (_panel.contains(e.target) || e.target.id === 'factoryPresetBtn') return;
    _closePanel();
  }

  function _openPanel() {
    if (_panel) { _closePanel(); return; }

    _panel = document.createElement('div');
    _panel.id = 'factoryPresetPanel';
    _panel.style.cssText = [
      'position:fixed','top:52px','right:16px','z-index:9999',
      'width:340px','max-height:76vh','overflow-y:auto',
      'background:#0d0d0d','border:1px solid #333','padding:14px',
      "font-family:'Space Mono',monospace",'color:#ddd',
      'box-shadow:0 12px 40px rgba(0,0,0,.7)',
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
    head.innerHTML =
      '<span style="font-size:10px;letter-spacing:2px;color:#e8ff00;">ГОТОВЫЕ СТИЛИ</span>';

    const rnd = document.createElement('button');
    rnd.textContent = '🎲 СЛУЧАЙНЫЙ';
    rnd.style.cssText = 'background:transparent;border:1px solid #333;color:#888;' +
      "font-family:'Space Mono',monospace;font-size:8px;letter-spacing:1px;padding:4px 8px;cursor:pointer;";
    rnd.addEventListener('click', function() {
      const p = random();
      _flash('Стиль: ' + p.name);
    });
    head.appendChild(rnd);
    _panel.appendChild(head);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:8px;color:#666;line-height:1.5;margin-bottom:12px;letter-spacing:.5px;';
    hint.textContent = 'Один клик задаёт шрифт, размер, позицию, анимацию, рамку, эффекты и камеру. Лирика, аудио и фон не меняются.';
    _panel.appendChild(hint);

    PRESETS.forEach(function(p) {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid #262626;padding:9px 10px;margin-bottom:7px;cursor:pointer;transition:border-color .15s,background .15s;';
      card.innerHTML =
        '<div style="font-size:10px;letter-spacing:1.5px;color:#eee;">' + p.icon + '  ' + p.name + '</div>' +
        '<div style="font-size:8px;color:#777;line-height:1.5;margin-top:4px;">' + p.desc + '</div>';

      card.addEventListener('mouseenter', function() {
        card.style.borderColor = '#e8ff00'; card.style.background = '#141400';
      });
      card.addEventListener('mouseleave', function() {
        card.style.borderColor = '#262626'; card.style.background = 'transparent';
      });
      card.addEventListener('click', function() {
        if (apply(p.id)) _flash('Стиль: ' + p.name);
      });
      _panel.appendChild(card);
    });

    document.body.appendChild(_panel);
    setTimeout(function() { document.addEventListener('click', _outsideClick, true); }, 0);
  }

  let _toast = null;
  function _flash(text) {
    if (!_toast) {
      _toast = document.createElement('div');
      _toast.style.cssText = [
        'position:fixed','bottom:24px','left:50%','transform:translateX(-50%)',
        'background:#e8ff00','color:#000','padding:8px 16px','z-index:10000',
        "font-family:'Space Mono',monospace",'font-size:9px','letter-spacing:2px',
        'pointer-events:none','transition:opacity .25s',
      ].join(';');
      document.body.appendChild(_toast);
    }
    _toast.textContent = text.toUpperCase();
    _toast.style.opacity = '1';
    clearTimeout(_toast._t);
    _toast._t = setTimeout(function() { if (_toast) _toast.style.opacity = '0'; }, 1600);
  }

  function buildUI() {
    const header = document.querySelector('header') || document.querySelector('.header');
    if (!header || document.getElementById('factoryPresetBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'factoryPresetBtn';
    btn.style.cssText = [
      'background:transparent','border:1px solid #333','color:#e8ff00',
      "font-family:'Space Mono',monospace",
      'font-size:9px','letter-spacing:2px','text-transform:uppercase',
      'padding:6px 12px','cursor:pointer','margin-right:6px',
    ].join(';');
    btn.textContent = '🎬 СТИЛИ';
    btn.title = 'Готовые стили: шрифт, анимация, рамка, эффекты и камера за один клик';

    const presetBtn = document.getElementById('presetBtn');
    if (presetBtn && presetBtn.parentNode === header) header.insertBefore(btn, presetBtn);
    else {
      const nav = header.querySelector('nav') || header.querySelector('a');
      if (nav) header.insertBefore(btn, nav); else header.appendChild(btn);
    }

    btn.addEventListener('click', _openPanel);
  }

  return {
    buildUI: buildUI,
    list:    function() { return PRESETS.map(function(p) {
               return { id: p.id, name: p.name, icon: p.icon, desc: p.desc }; }); },
    get:     get,
    apply:   apply,
    random:  random,
  };
})();
