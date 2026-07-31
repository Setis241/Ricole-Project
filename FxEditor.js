/* ═══════════════════════════════════════════════
   js/FxEditor.js  v4
   — Команды фона встроены в редактор (на строку)
   — Рамки / боксы для текста
   — Per-line стили: шрифт, размер, анимация, цвет, позиция
     Сериализуются как {LFONT:...}{LSIZE:...}{LANIM:...}{LCOLOR:...}{LPOS:...}
═══════════════════════════════════════════════ */
const FxEditor = (() => {

  // ── Font options (label → full CSS value) ───
  const FONT_OPTIONS = [
    { label: '— global —',    value: '' },
    // Классические жирные шрифты с кириллицей
    { label: 'Bebas Neue',    value: "'Bebas Neue', cursive" },
    { label: 'Oswald',        value: "'Oswald', sans-serif" },
    { label: 'Montserrat',    value: "'Montserrat', sans-serif" },
    { label: 'Russo One',     value: "'Russo One', sans-serif" },
    { label: 'Exo 2',         value: "'Exo 2', sans-serif" },
    { label: 'Raleway',       value: "'Raleway', sans-serif" },
    { label: 'Rubik',         value: "'Rubik', sans-serif" },
    // Футуристичные/техно шрифты
    { label: 'Jura',          value: "'Jura', sans-serif" },
    { label: 'Play',          value: "'Play', sans-serif" },
    { label: 'Comfortaa',     value: "'Comfortaa', cursive" },
    // Моноширинный
    { label: 'Space Mono',    value: "'Space Mono', monospace" },
    // Системные
    { label: 'Impact',        value: "'Impact', sans-serif" },
    { label: 'Arial Black',   value: "'Arial Black', sans-serif" },
    { label: 'Georgia',       value: "'Georgia', serif" },
  ];

  // ── Animation modes list ─────────────────────
  const ANIM_OPTIONS = [
    { label: '— global —',      value: '' },
    { label: 'Пульс',           value: 'pulse' },
    { label: 'Прыжок',          value: 'bounce' },
    { label: 'Тряска',          value: 'shake' },
    { label: 'Зум',             value: 'zoom' },
    { label: 'Вращение',        value: 'spin' },
    { label: 'Кино',            value: 'cinematic' },
    { label: '── Кинетика ──',  value: '',       disabled: true },
    { label: '⚡ Flash',        value: 'flash' },
    { label: '🪜 Cascade',      value: 'cascade' },
    { label: '🧲 Snap',         value: 'snap' },
    { label: '💥 Scatter',      value: 'scatter' },
    { label: '〜 Path',         value: 'path' },
    { label: '💥 Impact',       value: 'impact' },
    { label: '🌌 Parallax',     value: 'parallax' },
    { label: '✨ Shatter',      value: 'shatter' },
    { label: '🔐 Cipher',       value: 'cipher' },
    { label: '🪐 Orbit',        value: 'orbit' },
    { label: '💧 Ripple',       value: 'ripple' },
    { label: '🌟 Nova',         value: 'nova' },
    { label: '📰 Headline',     value: 'headline' },
    { label: '🅰 Tracking',      value: 'tracking' },
    { label: '📐 Ragged',        value: 'ragged' },
    { label: '▦ Justify',       value: 'justify' },
    { label: '🅿 Poster',        value: 'poster' },
    { label: '▩ Backdrop',      value: 'backdrop' },
    { label: '⧉ Echo',          value: 'echo' },
    { label: '⇹ Rift',          value: 'rift' },
    { label: '🎬 Montage',      value: 'montage' },
    { label: '🌊 Drift',        value: 'drift' },
    { label: '── Прокрутка ──', value: '',       disabled: true },
    { label: '← Scroll Left',   value: 'scroll_left' },
    { label: '→ Scroll Right',  value: 'scroll_right' },
    { label: '↑ Scroll Up',     value: 'scroll_up' },
    { label: '↓ Scroll Down',   value: 'scroll_down' },
    { label: '↗ Scroll Diag',   value: 'scroll_diag_ul' },
    { label: '↘ Scroll Diag',   value: 'scroll_diag_dr' },
    { label: '── Физика ──',    value: '',       disabled: true },
    { label: '🗞 Stack',         value: 'stack' },
    { label: '💣 Shockwave',     value: 'shockwave' },
    { label: '🎳 Domino',        value: 'domino' },
    { label: '🌊 Pendulum Wave', value: 'pendulum_wave' },
    { label: '💧 Liquid',        value: 'liquid' },
  ];

  // ── Word-level FX ────────────────────────────
  const FX_TAG_MAP = {
    bold:      ['*',           '*'],
    italic:    ['_',           '_'],
    underline: ['~',           '~'],
    strike:    ['~~',          '~~'],
    big:       ['{BIG}',       '{/BIG}'],
    small:     ['{SMALL}',     '{/SMALL}'],
    glitch:    ['{GLITCH}',    '{/GLITCH}'],
    glow:      ['{GLOW}',      '{/GLOW}'],
    shake:     ['{SHAKE}',     '{/SHAKE}'],
    wave:      ['{WAVE}',      '{/WAVE}'],
    outline:   ['{OUTLINE}',   '{/OUTLINE}'],
    rainbow:   ['{RAINBOW}',   '{/RAINBOW}'],
    grad:      ['{GRAD}',      '{/GRAD}'],
    neon:      ['{NEON}',      '{/NEON}'],
    blur:      ['{BLUR}',      '{/BLUR}'],
    flicker:   ['{FLICKER}',   '{/FLICKER}'],
    box:       ['{BOX}',       '{/BOX}'],
    boxneon:   ['{BOXNEON}',   '{/BOXNEON}'],
    boxglass:  ['{BOXGLASS}',  '{/BOXGLASS}'],
    boxshadow: ['{BOXSHADOW}', '{/BOXSHADOW}'],
    boxtape:   ['{BOXTAPE}',   '{/BOXTAPE}'],
    boxrough:  ['{BOXROUGH}',  '{/BOXROUGH}'],
    // Динамические боксы из BoxRegistry — добавляются ниже при инициализации
    boxfire:   ['{BOXFIRE}',   '{/BOXFIRE}'],
    boxice:    ['{BOXICE}',    '{/BOXICE}'],
    boxholo:   ['{BOXHOLO}',   '{/BOXHOLO}'],
    boxgold:   ['{BOXGOLD}',   '{/BOXGOLD}'],
    boxcyber:  ['{BOXCYBER}',  '{/BOXCYBER}'],
    boxrainbow:['{BOXRAINBOW}','{/BOXRAINBOW}'],
    boxretro:  ['{BOXRETRO}',  '{/BOXRETRO}'],
    boxaura:   ['{BOXAURA}',   '{/BOXAURA}'],
    boxmatrix: ['{BOXMATRIX}', '{/BOXMATRIX}'],
    boxsmoke:  ['{BOXSMOKE}',  '{/BOXSMOKE}'],
    boxplasma: ['{BOXPLASMA}', '{/BOXPLASMA}'],
    boxtattoo: ['{BOXTATTOO}', '{/BOXTATTOO}'],
    boxsunset: ['{BOXSUNSET}', '{/BOXSUNSET}'],
    boxlacquer:['{BOXLACQUER}','{/BOXLACQUER}'],
    boxcrystal: ['{BOXCRYSTAL}', '{/BOXCRYSTAL}'],
    boxdanger:  ['{BOXDANGER}',  '{/BOXDANGER}'],
    boxdiamond: ['{BOXDIAMOND}', '{/BOXDIAMOND}'],
    boxfault:   ['{BOXFAULT}',   '{/BOXFAULT}'],
    boxink:     ['{BOXINK}',     '{/BOXINK}'],
    boxportal:  ['{BOXPORTAL}',  '{/BOXPORTAL}'],
    boxsigil:   ['{BOXSIGIL}',   '{/BOXSIGIL}'],
    boxstatic:  ['{BOXSTATIC}',  '{/BOXSTATIC}'],
    boxvhs:     ['{BOXVHS}',     '{/BOXVHS}'],
    boxvirus:   ['{BOXVIRUS}',   '{/BOXVIRUS}'],
    boxwave:    ['{BOXWAVE}',    '{/BOXWAVE}'],
    boxwire:    ['{BOXWIRE}',    '{/BOXWIRE}'],
    // ── v5 boxes (lyric-video toolkit) ─────────
    boxsub:        ['{BOXSUB}',        '{/BOXSUB}'],
    boxthird:      ['{BOXTHIRD}',      '{/BOXTHIRD}'],
    boxmark:       ['{BOXMARK}',       '{/BOXMARK}'],
    boxcaption:    ['{BOXCAPTION}',    '{/BOXCAPTION}'],
    boxquote:      ['{BOXQUOTE}',      '{/BOXQUOTE}'],
    boxticker:     ['{BOXTICKER}',     '{/BOXTICKER}'],
    boxslate:      ['{BOXSLATE}',      '{/BOXSLATE}'],
    boxunderline:  ['{BOXUNDERLINE}',  '{/BOXUNDERLINE}'],
    // ── v5.1 sci-fi shaped boxes ───────────────
    boxhex:        ['{BOXHEX}',        '{/BOXHEX}'],
    boxstealth:    ['{BOXSTEALTH}',    '{/BOXSTEALTH}'],
    boxslash:      ['{BOXSLASH}',      '{/BOXSLASH}'],
    boxchevron:    ['{BOXCHEVRON}',    '{/BOXCHEVRON}'],
    boxreticle:    ['{BOXRETICLE}',    '{/BOXRETICLE}'],
    // ── v5.3 special opening ───────────────────
    boxintro:      ['{BOXINTRO}',      '{/BOXINTRO}'],
    // ── v5.4 second opening ────────────────────
    boxaugury:     ['{BOXAUGURY}',     '{/BOXAUGURY}'],
  };

  const COLORS = [
    { hex: '#ffffff', name: 'белый'    },
    { hex: '#e8ff00', name: 'акцент'   },
    { hex: '#ff2d55', name: 'красный'  },
    { hex: '#00e5ff', name: 'синий'    },
    { hex: '#ff9f00', name: 'оранж'    },
    { hex: '#b14fff', name: 'фиолет'   },
    { hex: '#00ff87', name: 'зелёный'  },
    { hex: '#ff6eb4', name: 'розовый'  },
  ];

  // ── Camera commands per line ─────────────────
  const CAM_TOGGLES = [
    { key:'zoomIn',      label:'🔍 ЗУМ+', tip:'ZOOM IN — зум вовнутрь на бас с этой строки',  group:'zoom'    },
    { key:'zoomOut',     label:'🔍 ЗУМ−', tip:'ZOOM OUT — зум наружу на бас с этой строки',   group:'zoom'    },
    { key:'zoomStop',    label:'🔍 ✕',    tip:'ZOOM STOP — остановить музыкальный зум',        group:'zoom'    },
    { key:'scrollLeft',  label:'← ПАН',  tip:'SCROLL LEFT — прокрутка фона влево',             group:'scrollX' },
    { key:'scrollRight', label:'→ ПАН',  tip:'SCROLL RIGHT — прокрутка фона вправо',           group:'scrollX' },
    { key:'scrollUp',    label:'↑ ПАН',  tip:'SCROLL UP — прокрутка фона вверх',               group:'scrollY' },
    { key:'scrollDown',  label:'↓ ПАН',  tip:'SCROLL DOWN — прокрутка фона вниз',              group:'scrollY' },
    { key:'scrollStop',  label:'⏹ ПАН',  tip:'SCROLL STOP — остановить прокрутку',             group:'stop'    },
    { key:'cameraReset', label:'📷 ↺',   tip:'CAMERA RESET — сбросить камеру в начало',        group:'reset'   },
  ];

  // ── Regex for line-style tags ────────────────
  const LINE_STYLE_RE = /\{L(?:FONT|SIZE|ANIM|COLOR|POS|LAYER|OVFX|BGIMG):[^}]+\}|\{LNOBOX\}/g;

  // ── Camera scene presets (для UI вкладки СЦЕНЫ) ──
  // Сгруппированы по характеру эффекта. В UI рисуются как сетка с заголовками.
  const CAM_SCENE_GROUPS = [
    {
      name: 'УДАРЫ',
      desc: 'Резкий вход в кадр',
      presets: [
        { value: 'punchIn',    icon: '🎯', label: 'Punch In',    hint: 'удар-зум' },
        { value: 'crashZoom',  icon: '💥', label: 'Crash',       hint: 'резкий + встряска' },
        { value: 'whipPan',    icon: '💨', label: 'Whip Pan',    hint: 'хлыст-пан' },
        { value: 'dropDown',   icon: '⬇',  label: 'Drop',        hint: 'вертикальное падение' },
      ],
    },
    {
      name: 'ДВИЖЕНИЕ ПО ФОНУ',
      desc: 'Камера путешествует',
      presets: [
        { value: 'diagScroll', icon: '⤡',  label: 'Diagonal',    hint: 'диагональ через центр' },
        { value: 'tourThree',  icon: '🗺',  label: 'Tour 3',      hint: 'обход 3 точек' },
        { value: 'rackFocus',  icon: '🎚',  label: 'Rack',        hint: 'pull-focus left↔right' },
        { value: 'orbit',      icon: '🪐',  label: 'Orbit',       hint: 'облёт точки' },
      ],
    },
    {
      name: 'РАСКРЫТИЕ',
      desc: 'Драматичные открывашки',
      presets: [
        { value: 'reveal',     icon: '🎁',  label: 'Reveal',      hint: 'из крупного плана' },
        { value: 'zoomOut',    icon: '🔭',  label: 'Zoom Out',    hint: 'плавное раскрытие' },
        { value: 'vertigo',    icon: '🌀',  label: 'Vertigo',     hint: 'Hitchcock dolly' },
      ],
    },
    {
      name: 'ПЛАВНЫЕ',
      desc: 'Для куплетов и тишины',
      presets: [
        { value: 'slowDrift',  icon: '🌊',  label: 'Slow Drift',  hint: 'плавный наезд' },
        { value: 'breathe',    icon: '🌫',  label: 'Breathe',     hint: 'дыхание-пульс' },
        { value: 'handheld',   icon: '🎥',  label: 'Handheld',    hint: 'ручная камера' },
        { value: 'dutchTilt',  icon: '🎨',  label: 'Dutch Tilt',  hint: 'голл. угол' },
      ],
    },
    {
      name: 'НА БИТ',
      desc: 'Реагирует на бас',
      presets: [
        { value: 'pulse',      icon: '💓',  label: 'Pulse',       hint: 'пульс на бас' },
        { value: 'heartbeat',  icon: '💗',  label: 'Heartbeat',   hint: 'двойной удар' },
        { value: 'shockwave',  icon: '💢',  label: 'Shockwave',   hint: 'взрыв-отъезд' },
      ],
    },
    {
      name: 'РОК / ПУНК',
      desc: 'Вспышки + агрессия',
      presets: [
        { value: 'strobe',     icon: '🤘', label: 'Strobe',      hint: 'белые вспышки на бас' },
        { value: 'pulseBlack', icon: '⬛', label: 'Pulse Black', hint: 'затемнение на удар' },
        { value: 'headbang',   icon: '🤯', label: 'Headbang',    hint: 'вертикальный кивок' },
        { value: 'mosh',       icon: '🩸', label: 'Mosh',        hint: 'хаос + красная вспышка' },
        { value: 'riot',       icon: '🎸', label: 'Riot',        hint: 'клиповая нарезка' },
        { value: 'scan',       icon: '🔍', label: 'Scan',        hint: 'фокус по строкам' },
      ],
    },
    {
      name: 'ХАОТИЧНЫЕ',
      desc: 'Для припева и драмы',
      presets: [
        { value: 'earthquake', icon: '🌍',  label: 'Earthquake',  hint: 'землетрясение' },
        { value: 'whirl',      icon: '🌪',  label: 'Whirl',       hint: 'закрутка' },
        { value: 'swing',      icon: '🕰',  label: 'Swing',       hint: 'маятник' },
        { value: 'prism',      icon: '🔮',  label: 'Prism',       hint: 'встречные фазы' },
        { value: 'glitchCut',  icon: '⚡',  label: 'Glitch',      hint: 'случайные скачки' },
        { value: 'flicker',    icon: '📺',  label: 'Flicker',     hint: 'плёночные кадры' },
      ],
    },
    {
      name: 'СПЕЦ',
      desc: 'Заморозка',
      presets: [
        { value: 'hold',       icon: '⏸',   label: 'Hold',        hint: 'фриз камеры' },
      ],
    },
  ];

  // Плоский список — сохранён для обратной совместимости (валидация)
  const CAM_SCENE_PRESETS = CAM_SCENE_GROUPS.flatMap(g => g.presets.map(p => ({
    value: p.value, label: `${p.label} · ${p.hint}`, icon: p.icon,
  })));

  // ── BG commands per line ─────────────────────
  const BG_COMMANDS = [
    { id: 'darken',           label: '🌑 ЗАТЕМН',      onCmd: '/НАЧАЛО ЗАТУХАНИЯ/',  offCmd: '/КОНЕЦ ЗАТУХАНИЯ/',      color: '#334' },
    { id: 'brighten',         label: '☀️ ЯРКО',        onCmd: '/ЯРКИЙ ФОН/',         offCmd: '/КОНЕЦ ЯРКОСТИ/',        color: '#443' },
    { id: 'blur',             label: '💫 БЛЮР',        onCmd: '/РАЗМЫТИЕ/',          offCmd: '/ЧЕТКОСТЬ/',             color: '#344' },
    { id: 'letterbox',        label: '🎬 ЛЕТТЕРБОКС',  onCmd: '/LETTERBOX/',         offCmd: '/LETTERBOX OFF/',        color: '#222' },
    { id: 'letterboxReactive',label: '🎬 ЛЕТТЕР.РЕАКТ',onCmd: '/LETTERBOX REACTIVE/',offCmd: '/LETTERBOX REACTIVE OFF/',color: '#422' },
  ];

  let lines        = [];   // [{time, rawText, tokens, bgCmds, lineStyle}]
  let selectedToks = [];
  let history      = [];
  let overlay      = null;
  let onSaveCb     = null;
  let fxeTab       = 'text'; // 'text' | 'objects'

  // UI-state: какие overlay-карточки свёрнуты (ключ — ov.id).
  // Хранится вне модели данных, чтобы не засорять экспортируемые пресеты.
  const _collapsedOverlays = new Set();

  // drag-and-drop state для реордера карточек
  const _ovDrag = { id: null };

  // ── Preview selection & animation state ─────
  // Только выбранный объект рисуется в превью. Анимация запускается вручную.
  let _previewSelectedOvId = null; // id объекта, выбранного для превью
  let _previewAnimActive   = false; // true = анимация запущена
  let _previewRafHandle    = null;  // requestAnimationFrame handle

  /* ── Line-style helpers ─────────────────────── */
  function extractLineStyle(raw) {
    const text = raw || '';
    const ls = {};
    const fontM  = text.match(/\{LFONT:([^}]+)\}/);
    const sizeM  = text.match(/\{LSIZE:(\d+)\}/);
    const animM  = text.match(/\{LANIM:([^}]+)\}/);
    const colorM = text.match(/\{LCOLOR:(#[0-9a-fA-F]{3,6})\}/);
    const posM   = text.match(/\{LPOS:(top-left|top-right|top|center-left|center-right|center|bottom-left|bottom-right|bottom)\}/i);
    const layerM = text.match(/\{LLAYER:(above|below)\}/i);
    const ovfxM  = text.match(/\{LOVFX:(static|sway|pulse|stretch|float|shake|bounce|spin)\}/i);
    const noBoxM = text.match(/\{LNOBOX\}/i);
    if (fontM)  ls.font     = fontM[1].trim();
    if (sizeM)  ls.fontSize = parseInt(sizeM[1], 10);
    if (animM)  ls.animMode = animM[1].trim();
    if (colorM) ls.color    = colorM[1];
    if (posM)   ls.position = posM[1].toLowerCase();
    if (layerM) ls.layer    = layerM[1].toLowerCase();
    if (ovfxM)  ls.overlayEffect = ovfxM[1].toLowerCase();
    if (noBoxM) ls.noBox    = true;
    return ls;
  }

  function lineStyleToTags(ls) {
    if (!ls) return '';
    const parts = [];
    if (ls.font)     parts.push(`{LFONT:${ls.font}}`);
    if (ls.fontSize) parts.push(`{LSIZE:${ls.fontSize}}`);
    if (ls.animMode) parts.push(`{LANIM:${ls.animMode}}`);
    if (ls.color)    parts.push(`{LCOLOR:${ls.color}}`);
    if (ls.position) parts.push(`{LPOS:${ls.position}}`);
    if (ls.layer)    parts.push(`{LLAYER:${ls.layer}}`);
    if (ls.overlayEffect) parts.push(`{LOVFX:${ls.overlayEffect}}`);
    if (ls.noBox)    parts.push(`{LNOBOX}`);
    return parts.length ? parts.join('') + ' ' : '';
  }

  function hasLineStyle(ls) {
    return ls && (ls.font || ls.fontSize || ls.animMode || ls.color || ls.position || ls.layer || ls.overlayEffect || ls.noBox);
  }

  /* ── BG CMD helpers ─────────────────────────── */
  function parseBgCmds(raw) {
    const txt = (raw || '').toUpperCase();
    const has = (cmd) => txt.indexOf('/' + cmd + '/') !== -1;
    // Леттербокс — единый тег. Реактивность — sub-флаг.
    // /LETTERBOX OFF/  и старый  /LETTERBOX REACTIVE OFF/  → unletterbox=true
    const lbOff      = has('LETTERBOX OFF') || has('LETTERBOX REACTIVE OFF');
    const lbReactive = has('LETTERBOX REACTIVE') && !lbOff;
    const lbBasic    = has('LETTERBOX') && !lbOff;
    return {
      darken:              (txt.includes('НАЧАЛО ЗАТУХАНИЯ') || txt.includes('НАЧАЛО ТЕМНОТЫ') || txt.includes('МРАЧНЫЙ ФОН')),
      brighten:            txt.includes('ЯРКИЙ ФОН') && !txt.includes('КОНЕЦ ЯРКОСТИ'),
      blur:                txt.includes('РАЗМЫТИЕ') && !txt.includes('ЧЕТКОСТЬ'),
      undarken:            (txt.includes('КОНЕЦ ЗАТУХАНИЯ') || txt.includes('КОНЕЦ ТЕМНОТЫ')),
      unbrighten:          txt.includes('КОНЕЦ ЯРКОСТИ'),
      unblur:              txt.includes('ЧЕТКОСТЬ'),
      letterbox:           lbBasic || lbReactive,
      unletterbox:         lbOff,
      letterboxReactive:   lbReactive,
      unletterboxReactive: false, // deprecated: гасится через unletterbox
    };
  }

  function bgCmdsToString(cmds) {
    let s = '';
    if (cmds.darken)              s += '/НАЧАЛО ЗАТУХАНИЯ/';
    if (cmds.undarken)            s += '/КОНЕЦ ЗАТУХАНИЯ/';
    if (cmds.brighten)            s += '/ЯРКИЙ ФОН/';
    if (cmds.unbrighten)          s += '/КОНЕЦ ЯРКОСТИ/';
    if (cmds.blur)                s += '/РАЗМЫТИЕ/';
    if (cmds.unblur)              s += '/ЧЕТКОСТЬ/';
    // Леттербокс — ровно ОДНА команда на строку.
    if (cmds.unletterbox)              s += '/LETTERBOX OFF/';
    else if (cmds.letterboxReactive)   s += '/LETTERBOX REACTIVE/';
    else if (cmds.letterbox)           s += '/LETTERBOX/';
    return s ? s + ' ' : '';
  }

  // ── Camera command helpers ───────────────────
  function parseCamCmds(raw) {
    const txt = (raw || '').toUpperCase();
    const result = {
      zoomIn:      txt.includes('/ZOOM IN/'),
      zoomOut:     txt.includes('/ZOOM OUT/'),
      zoomStop:    txt.includes('/ZOOM STOP/'),
      scrollLeft:  txt.includes('/SCROLL LEFT/'),
      scrollRight: txt.includes('/SCROLL RIGHT/'),
      scrollUp:    txt.includes('/SCROLL UP/'),
      scrollDown:  txt.includes('/SCROLL DOWN/'),
      scrollStop:  txt.includes('/SCROLL STOP/'),
      cameraReset: txt.includes('/CAMERA RESET/'),
    };
    // Сила зума: /ZOOM AMT 0.7/
    const amtM = txt.match(/\/ZOOM AMT (\d*\.?\d+)\//);
    if (amtM) result.zoomAmount = parseFloat(amtM[1]);
    return result;
  }

  function camCmdsToString(cmds) {
    if (!cmds) return '';
    const parts = [];
    if (cmds.zoomIn)      parts.push('/ZOOM IN/');
    if (cmds.zoomOut)     parts.push('/ZOOM OUT/');
    if (cmds.zoomStop)    parts.push('/ZOOM STOP/');
    if (cmds.zoomAmount != null) parts.push(`/ZOOM AMT ${(+cmds.zoomAmount).toFixed(2)}/`);
    if (cmds.scrollLeft)  parts.push('/SCROLL LEFT/');
    if (cmds.scrollRight) parts.push('/SCROLL RIGHT/');
    if (cmds.scrollUp)    parts.push('/SCROLL UP/');
    if (cmds.scrollDown)  parts.push('/SCROLL DOWN/');
    if (cmds.scrollStop)  parts.push('/SCROLL STOP/');
    if (cmds.cameraReset) parts.push('/CAMERA RESET/');
    return parts.length ? parts.join('') + ' ' : '';
  }

  /* ── Tokenize / serialise ───────────────────── */
  function tokenizeLine(rawText) {
    // Чистим от LRC-команд, секций и line-style тегов перед токенизацией
    let clean = rawText
      .replace(LINE_STYLE_RE, '')             // убрать {LFONT:...} etc
      .replace(/\/[A-Za-zА-Яа-яЁё][^\/]*\//g, '')   // убрать все /КОМАНДЫ/ (рус. и лат.)
      .replace(/^\[[^\]]+\]\s*/g, '')
      .trim();

    if (!clean) return [{ word: '(пусто)', effects: [], color: null }];

    // BOX_TAGS: активные (из BoxRegistry) + RETIRED (старые имена из v4-архивов).
    // Retired-теги должны матчиться регекспом, чтобы не оставаться в тексте буквально
    // (ситуация «{BOXSIGIL} показывается как слово»). Но в state их НЕТ, поэтому эффект
    // не применится — тег просто тихо съедается при парсинге.
    const RETIRED_BOX_IDS = (typeof BoxRegistry !== 'undefined' && BoxRegistry.retired)
      ? BoxRegistry.retired
      : ['boxneon','boxglass','boxshadow','boxrough','boxfire','boxice','boxholo','boxgold','boxcyber','boxrainbow','boxretro','boxaura','boxmatrix','boxsmoke','boxplasma','boxtattoo','boxsunset','boxlacquer','boxcrystal','boxdanger','boxdiamond','boxfault','boxink','boxportal','boxsigil','boxstatic','boxvhs','boxvirus','boxwave','boxwire'];
    const _activeBoxIds = typeof BoxRegistry !== 'undefined'
      ? BoxRegistry.all.map(s => s.id)
      : ['box','boxsub','boxthird','boxmark','boxtape','boxcaption','boxquote','boxunderline','boxticker','boxslate','boxhex','boxstealth','boxslash','boxchevron','boxreticle','boxintro','boxaugury'];
    const BOX_TAGS = [..._activeBoxIds, ...RETIRED_BOX_IDS].map(s => s.toUpperCase()).join('|');
    const TAG_RE = new RegExp(
      `(\\{COLOR:#[0-9a-fA-F]{3,6}\\}|\\{\\/COLOR\\}` +
      `|\\{(?:${BOX_TAGS})\\}|\\{\\/(?:${BOX_TAGS})\\}` +
      `|\\{BIG\\}|\\{\\/BIG\\}|\\{SMALL\\}|\\{\\/SMALL\\}` +
      `|\\{GLITCH\\}|\\{\\/GLITCH\\}|\\{GLOW\\}|\\{\\/GLOW\\}` +
      `|\\{SHAKE\\}|\\{\\/SHAKE\\}|\\{WAVE\\}|\\{\\/WAVE\\}` +
      `|\\{OUTLINE\\}|\\{\\/OUTLINE\\}|\\{RAINBOW\\}|\\{\\/RAINBOW\\}` +
      `|\\{NEON\\}|\\{\\/NEON\\}|\\{BLUR\\}|\\{\\/BLUR\\}` +
      `|\\{FLICKER\\}|\\{\\/FLICKER\\}|\\{GRAD\\}|\\{\\/GRAD\\}` +
      `|\\*\\*?|_(?!_)|~~?|~(?!~))`, 'g'
    );

    const state = {
      bold:false,italic:false,underline:false,strike:false,
      big:false,small:false,glitch:false,glow:false,shake:false,wave:false,
      outline:false,rainbow:false,neon:false,blur:false,flicker:false,grad:false,
      // ── активные рамки v5.4 (17 шт) ────────────
      box:false,boxtape:false,
      boxsub:false,boxthird:false,boxmark:false,boxcaption:false,boxquote:false,boxticker:false,boxslate:false,boxunderline:false,
      boxhex:false,boxstealth:false,boxslash:false,boxchevron:false,boxreticle:false,
      boxintro:false,boxaugury:false,
      color:null,
    };

    const parts = [];
    let last = 0; let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(clean)) !== null) {
      if (m.index > last) parts.push({ type:'text', val:clean.slice(last,m.index) });
      parts.push({ type:'tag', val:m[0] });
      last = m.index + m[0].length;
    }
    if (last < clean.length) parts.push({ type:'text', val:clean.slice(last) });

    if (!parts.length || (parts.length===1 && parts[0].type==='text')) {
      return clean.split(/\s+/).filter(Boolean).map(w=>({word:w,effects:[],color:null}));
    }

    const tokens = [];
    for (const part of parts) {
      if (part.type === 'text') {
        const words = part.val.split(/\s+/).filter(w=>w&&w.trim());
        for (const word of words) {
          const effects = Object.keys(state).filter(k => k!=='color' && state[k]);
          tokens.push({ word, effects:[...effects], color:state.color });
        }
      } else {
        const tag = part.val;
        if (tag==='*'||tag==='**') state.bold=!state.bold;
        else if (tag==='_') state.italic=!state.italic;
        else if (tag==='~'&&!tag.startsWith('~~')) state.underline=!state.underline;
        else if (tag==='~~') state.strike=!state.strike;
        else {
          const openM  = tag.match(/^\{([A-Z0-9]+)\}$/);
          const closeM = tag.match(/^\{\/([A-Z0-9]+)\}$/);
          if (openM)  { const k=openM[1].toLowerCase();  if (k in state) state[k]=true; }
          if (closeM) { const k=closeM[1].toLowerCase(); if (k in state) state[k]=false; }
          if (tag.startsWith('{COLOR:')) state.color=tag.slice(7,-1);
          if (tag==='{/COLOR}') state.color=null;
        }
      }
    }

    return tokens.length ? tokens : [{ word:'(пусто)', effects:[], color:null }];
  }

  function tokensToText(tokens) {
    if (!tokens || !tokens.length) return '';
    
    // Список всех box-эффектов (нужен только для FX_TAG_MAP lookup / совместимости)
    const boxFxList = typeof BoxRegistry !== 'undefined'
      ? BoxRegistry.all.map(s => s.id)
      : ['box','boxneon','boxglass','boxshadow','boxtape','boxrough','boxfire','boxice','boxholo','boxgold','boxcyber','boxrainbow','boxretro','boxaura','boxmatrix','boxsmoke','boxplasma','boxtattoo','boxsunset','boxlacquer','boxcrystal','boxdanger','boxdiamond','boxfault','boxink','boxportal','boxsigil','boxstatic','boxvhs','boxvirus','boxwave','boxwire'];
    
    // Группируем соседние токены с одинаковым набором эффектов и цветом.
    // Box-эффекты ТОЖЕ группируются: рендерер (renderers.js) сам склеивает
    // соседние спаны с одинаковым box-типом в одну общую рамку, так что
    // per-word обёртки просто раздувают LRC и ведут к наложениям при редактировании.
    const groups = [];
    for (const tok of tokens) {
      if (!tok || !tok.word) continue;
      const fxKey = [...(tok.effects||[])].sort().join(',') + '|' + (tok.color || '');
      const last  = groups[groups.length - 1];
      
      if (last && last.fxKey === fxKey) {
        last.words.push(tok.word);
      } else {
        groups.push({ fxKey, effects: tok.effects || [], color: tok.color || null, words: [tok.word] });
      }
    }
    
    return groups.map(g => {
      let w = g.words.join(' ');
      g.effects.forEach(fx => {
        const map = FX_TAG_MAP[fx];
        if (map) w = map[0] + w + map[1];
      });
      if (g.color) w = `{COLOR:${g.color}}${w}{/COLOR}`;
      return w;
    }).filter(Boolean).join(' ');
  }

  function buildLRC() {
    return lines.map(line => {
      const tagged   = tokensToText(line.tokens);
      const section  = line.section ? `[${line.section}] ` : '';
      const bgStr    = bgCmdsToString(line.bgCmds || {});
      const camStr   = camCmdsToString(line.camCmds || {});
      const styleStr = lineStyleToTags(line.lineStyle);
      // порядок: timestamp → bg команды → camera команды → section → line-style → текст
      return `[${line.time}] ${bgStr}${camStr}${section}${styleStr}${tagged}`;
    }).join('\n');
  }

  /* ── State ──────────────────────────────────── */
  function saveHistory() {
    history.push(JSON.stringify(lines));
    if (history.length > 40) history.shift();
  }

  function undo() {
    if (!history.length) return;
    lines = JSON.parse(history.pop());
    selectedToks = [];
    renderEditor();
  }

  /* ── Open / Close ───────────────────────────── */
  function open(lrcText, onSave) {
    onSaveCb = onSave;
    const parsed = LRCParser.parse(lrcText);
    lines = parsed.map(l => ({
      time:      fmtTime(l.time),
      rawText:   l.rawText || l.text,
      section:   l.section || null,
      tokens:    tokenizeLine(l.rawText || l.text),
      bgCmds:    parseBgCmds(l.rawText || ''),
      camCmds:   parseCamCmds(l.rawText || ''),
      lineStyle: l.lineStyle || {},
    }));
    selectedToks = [];
    history      = [];
    if (!overlay) createOverlay();
    overlay.style.display = 'flex';
    renderEditor();
  }

  function close() {
    _stopPreviewAnim();
    if (overlay) overlay.style.display = 'none';
    selectedToks = [];
  }

  function openOverlayManager() {
    // Открываем FxEditor сразу на вкладке объектов
    if (!overlay) createOverlay();
    
    // Загружаем строки из lyricsInput ТОЛЬКО если lines ещё не заполнен
    // (т.е. FxEditor не был открыт через open() с уже разобранным LRC).
    // Это предотвращает затирание правок, сделанных на вкладке «Текст».
    if (lines.length === 0) {
      const lyricsInput = document.getElementById('lyricsInput');
      if (lyricsInput && lyricsInput.value.trim()) {
        const raw = lyricsInput.value.trim();
        const parsed = LRCParser.parse(raw);
        lines = parsed.map(l => ({
          time:      fmtTime(l.time),
          rawText:   l.rawText || l.text,
          section:   l.section || null,
          tokens:    tokenizeLine(l.rawText || l.text),
          bgCmds:    parseBgCmds(l.rawText || ''),
          camCmds:   parseCamCmds(l.rawText || ''),
          lineStyle: l.lineStyle || {},
        }));
      }
    }

    if (lines.length === 0) {
      // Если нет текста и lines пустой, создаём минимальный набор
      lines = [{ 
        time: '00:00', 
        rawText: 'Строка 1', 
        section: null, 
        tokens: [],
        bgCmds: {}, 
        camCmds: {},
        lineStyle: {}
      }];
    }
    
    selectedToks = [];
    history = [];
    overlay.style.display = 'flex';
    
    // Переключаемся на вкладку объектов
    setTimeout(() => {
      const bodyEl   = overlay.querySelector('#fxeBodyText');
      const ovPanel  = overlay.querySelector('#fxeOvPanel');
      const tabText  = overlay.querySelector('#fxeTabText');
      const tabObjs  = overlay.querySelector('#fxeTabObjects');
      
      if (bodyEl && ovPanel && tabText && tabObjs) {
        fxeTab = 'objects';
        bodyEl.style.display   = 'none';
        ovPanel.style.display  = 'flex';
        tabText.classList.remove('active');
        tabObjs.classList.add('active');
        renderOverlayPanel();
      }
    }, 50);
  }

  /* ── DOM: create overlay ────────────────────── */
  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'fxEditorOverlay';
    overlay.innerHTML = `
<div class="fxe-backdrop"></div>
<div class="fxe-modal">

  <div class="fxe-header">
    <span class="fxe-title">FX EDITOR</span>
    <span class="fxe-sub">// выдели слова → нажми эффект · стили строк — на каждой строке · ctrl+z — отмена</span>
    <div class="fxe-hdr-right">
      <button class="fxe-btn fxe-btn-ghost" id="fxeUndo">↩ отмена</button>
      <button class="fxe-btn fxe-btn-accent" id="fxeSave">✓ СОХРАНИТЬ</button>
      <button class="fxe-btn fxe-btn-ghost" id="fxeClose">✕</button>
    </div>
  </div>

  <div class="fxe-tab-bar">
    <button class="fxe-tab active" id="fxeTabText">✦ ТЕКСТ</button>
    <button class="fxe-tab" id="fxeTabObjects">🖼 ОБЪЕКТЫ</button>
    <button class="fxe-tab" id="fxeTabScenes">📷 СЦЕНЫ</button>
    <button class="fxe-tab" id="fxeTabCards">🎴 КОНСТРУКТОР</button>
  </div>

  <div class="fxe-body" id="fxeBodyText">

    <!-- SIDEBAR: эффекты текста -->
    <div class="fxe-sidebar">
      <div class="fxe-slabel">// стиль текста</div>
      <div class="fxe-fxgrid" id="fxeBtns">
        <button class="fxe-fxbtn" data-fx="bold">    <b>B</b> жирный</button>
        <button class="fxe-fxbtn" data-fx="italic">  <i>I</i> курсив</button>
        <button class="fxe-fxbtn" data-fx="underline"><u>U</u> подчёрк</button>
        <button class="fxe-fxbtn" data-fx="strike">  <s>S</s> зачёрк</button>
        <button class="fxe-fxbtn" data-fx="big">     Aa BIG</button>
        <button class="fxe-fxbtn" data-fx="small">   aa small</button>
      </div>
      <div class="fxe-slabel">// анимация слова</div>
      <div class="fxe-fxgrid">
        <button class="fxe-fxbtn fxe-glow"    data-fx="glow">✦ СВЕЧЕНИЕ</button>
        <button class="fxe-fxbtn fxe-shake"   data-fx="shake">◎ ТРЯСКА</button>
        <button class="fxe-fxbtn fxe-outline" data-fx="outline">○ КОНТУР</button>
        <button class="fxe-fxbtn fxe-rainbow" data-fx="rainbow">✦ РАДУГА</button>
        <button class="fxe-fxbtn fxe-grad"    data-fx="grad">▨ ГРАДИЕНТ</button>
        <button class="fxe-fxbtn fxe-flicker" data-fx="flicker">↯ МЕРЦАНИЕ</button>
        <button class="fxe-fxbtn fxe-blur2"   data-fx="blur">◌ БЛЮР</button>
      </div>

      <div class="fxe-slabel">// callout · highlight · box</div>
      <div class="fxe-callout-grid" id="fxeCalloutGrid"></div>

      <div class="fxe-slabel">// цвет слова</div>
      <div class="fxe-colorrow" id="fxeColors"></div>
      <div class="fxe-slabel" style="margin-top:2px;">//</div>
      <div style="padding:8px 10px;">
        <button class="fxe-btn fxe-btn-ghost fxe-btn-full" id="fxeClearFx">✕ снять эффекты</button>
      </div>
      <div class="fxe-hint">shift+клик — диапазон<br>ctrl+клик — мульти<br>ctrl+z — отмена</div>
    </div>

    <!-- CENTER: редактор строк -->
    <div class="fxe-center">
      <div class="fxe-editor-scroll" id="fxeEditorScroll"></div>
      <div class="fxe-center-footer">
        <button class="fxe-addline" id="fxeAddLine">+ добавить строку</button>
        <button class="fxe-btn fxe-btn-ghost" id="fxeBulkEditBtn" style="margin-left:8px;">⚙ Массовое редактирование</button>
      </div>
    </div>

    <!-- RIGHT: вывод + превью -->
    <div class="fxe-right">
      <div class="fxe-slabel">// превью эффектов</div>
      <div class="fxe-preview-canvas-wrap">
        <canvas id="fxePreviewCanvas" width="1920" height="400"></canvas>
        <div class="fxe-preview-hint">выдели слова для превью</div>
      </div>
      <div class="fxe-slabel">// lrc вывод</div>
      <div class="fxe-output" id="fxeOutput"></div>
      <div class="fxe-selinfo" id="fxeSelInfo">выдели слова, потом эффект</div>
    </div>

  </div>

  <!-- OVERLAY OBJECTS PANEL -->
  <div class="fxe-ov-panel" id="fxeOvPanel" style="display:none;">
    <div class="fxe-ov-toolbar">
      <button class="fxe-btn fxe-btn-accent" id="fxeAddOvBtn">+ Добавить объект</button>
      <input type="file" id="fxeAddOvFile" accept="image/*" style="display:none" multiple />
      <button class="fxe-btn fxe-btn-accent" id="fxeAddTxtBtn" style="margin-left:6px;">+ Добавить текст</button>
      <button class="fxe-btn fxe-btn-accent" id="fxeAddFrameBtn" style="margin-left:6px;">⬡ Добавить рамку</button>
      <button class="fxe-btn fxe-btn-accent" id="fxeAddEffectBtn" style="margin-left:6px;">✨ Добавить эффект</button>
      <span class="fxe-ov-hint">Объекты / тексты / рамки / эффекты рисуются поверх или под текстом с аудио-реактивными эффектами</span>
    </div>
    <div class="fxe-ov-content">
      <div class="fxe-ov-left">
        <div class="fxe-ov-list" id="fxeOvList"></div>
      </div>
      <div class="fxe-ov-right">
        <div class="fxe-ov-preview-wrap">
          <canvas id="fxeOvPreviewCanvas" width="1920" height="1080"></canvas>
          <div class="fxe-ov-preview-label">// ПРЕВЬЮ ОБЪЕКТОВ (реальный размер холста)</div>
          <div class="fxe-ov-preview-hint-sel" id="fxeOvPreviewHint">← Нажми на объект в списке чтобы увидеть его в превью</div>
          <div class="fxe-ov-preview-controls" id="fxeOvPreviewControls" style="display:none;">
            <span class="fxe-ov-preview-name" id="fxeOvPreviewName"></span>
            <button class="fxe-btn fxe-btn-accent fxe-ov-anim-btn" id="fxeOvAnimBtn">▶ Анимация</button>
            <button class="fxe-btn fxe-btn-ghost fxe-ov-anim-stop" id="fxeOvAnimStop" style="display:none;">■ Стоп</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- CARD CONSTRUCTOR PANEL -->
  <div class="fxe-cd-panel" id="fxeCdPanel" style="display:none;">
    <div class="fxe-cd-toolbar">
      <button class="fxe-btn fxe-btn-accent" id="fxeAddCardBtn">+ Добавить композицию</button>
      <span class="fxe-cd-toolbar-hint">Композиция = рамка + форматированные текст-блоки. Параметры/анимация фрейма + независимое расположение каждого блока.</span>
    </div>
    <div class="fxe-cd-content">
      <div class="fxe-cd-list-col">
        <div class="fxe-cd-list" id="fxeCdList"></div>
      </div>
      <div class="fxe-cd-preview-col">
        <div class="fxe-cd-preview-wrap">
          <canvas id="fxeCdPreviewCanvas" width="1920" height="1080"></canvas>
          <div class="fxe-cd-preview-label">// ПРЕВЬЮ КОМПОЗИЦИИ</div>
          <div class="fxe-cd-grid-toolbar" id="fxeCdGridToolbar">
            <button class="fxe-cd-grid-toggle" id="fxeCdOutlinesToggle" title="Показать контуры всех блоков с номерами">▢ Контуры</button>
            <button class="fxe-cd-grid-toggle" id="fxeCdGridToggle" title="Сетка + snap">▦ Сетка</button>
            <div class="fxe-cd-grid-steps" id="fxeCdGridSteps" style="display:none;">
              <button data-step="20" title="Грубая 5×5">×5</button>
              <button data-step="10" title="Стандартная 10×10">×10</button>
              <button data-step="5"  title="Точная 20×20">×20</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- CAMERA SCENES PANEL -->
  <div class="fxe-cs-panel" id="fxeCsPanel" style="display:none;">
    <div class="fxe-cs-toolbar">
      <button class="fxe-btn fxe-btn-accent" id="fxeAddCsBtn">+ Добавить сцену</button>
      <span class="fxe-cs-toolbar-hint">Каждая сцена — отдельный кинематографичный пресет камеры. Назначь набор строк → сцена применится автоматически.</span>
    </div>
    <div class="fxe-cs-content">
      <div class="fxe-cs-list" id="fxeCsList"></div>
    </div>
  </div>

  <!-- LINE SELECTOR SIDE PANEL -->
  <div class="fxe-line-selector-backdrop" id="fxeLsBackdrop" style="display:none;"></div>
  <div class="fxe-line-selector-panel" id="fxeLineSelectorPanel" style="display:none;">
    <div class="fxe-ls-header">
      <span class="fxe-ls-title">ВЫБОР СТРОК</span>
      <button class="fxe-btn fxe-btn-ghost fxe-btn-sm" id="fxeLsClose">✕</button>
    </div>
    <div class="fxe-ls-toolbar">
      <button class="fxe-btn fxe-btn-ghost fxe-btn-sm" id="fxeLsSelectAll">✓ Все</button>
      <button class="fxe-btn fxe-btn-ghost fxe-btn-sm" id="fxeLsClearAll">✕ Снять</button>
      <span class="fxe-ls-counter" id="fxeLsCounter">0 / 0</span>
    </div>
    
    <!-- НАСТРОЙКИ ОБЪЕКТА -->
    <div class="fxe-ls-settings" id="fxeLsSettings">
      <div class="fxe-ls-settings-title">// настройки объекта</div>
      
      <div class="fxe-ls-setting-row">
        <label class="fxe-ls-setting-label">Слой объекта:</label>
        <div class="fxe-ls-layer-btns">
          <button class="fxe-ls-layer-btn" data-layer="above" id="fxeLsLayerAbove">⬆ Выше текста</button>
          <button class="fxe-ls-layer-btn" data-layer="below" id="fxeLsLayerBelow">⬇ Ниже текста</button>
        </div>
      </div>
      
      <div class="fxe-ls-hint">Для каждой строки: выбери анимацию и слой объекта (⬆ выше / ⬇ ниже текста)</div>
    </div>
    
    <div class="fxe-ls-list" id="fxeLsList"></div>
  </div>

</div>`;

    document.body.appendChild(overlay);

    // ── Styles ──────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
#fxEditorOverlay {
  position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;
}
.fxe-backdrop {
  position:absolute;inset:0;background:rgba(0,0,0,.9);
}
.fxe-modal {
  position:relative;width:97vw;max-width:1400px;height:90vh;
  background:#0d0d0d;border:1px solid #222;display:flex;flex-direction:column;overflow:hidden;
}
.fxe-header {
  display:flex;align-items:center;gap:12px;padding:0 16px;height:48px;
  background:#111;border-bottom:1px solid #222;flex-shrink:0;
}
.fxe-title { font-family:'Bebas Neue',cursive;font-size:22px;letter-spacing:4px;color:#e8ff00; }
.fxe-sub   { font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;color:#444;text-transform:uppercase; }
.fxe-hdr-right { margin-left:auto;display:flex;gap:6px; }
.fxe-body {
  display:grid;grid-template-columns:210px 1fr 270px;flex:1;overflow:hidden;
}

/* ── Sidebar ── */
.fxe-sidebar {
  background:#111;border-right:1px solid #222;overflow-y:auto;
}
.fxe-sidebar::-webkit-scrollbar{width:2px}
.fxe-sidebar::-webkit-scrollbar-thumb{background:#222}
.fxe-slabel {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:3px;text-transform:uppercase;
  color:#444;padding:8px 10px 5px;border-bottom:1px solid #1a1a1a;
}
.fxe-fxgrid { display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:6px; }
.fxe-fxbtn {
  background:#161616;border:1px solid #222;color:#555;
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;text-transform:uppercase;
  padding:7px 4px;cursor:pointer;text-align:center;transition:all .12s;white-space:nowrap;overflow:hidden;
}
.fxe-fxbtn:hover { border-color:#e8ff00;color:#e8ff00; }

/* Text FX */
.fxe-glitch  { color:#ff3333!important; }
.fxe-glow    { color:#e8ff00!important;text-shadow:0 0 6px #e8ff00; }
.fxe-outline { -webkit-text-stroke:1px #e8ff00;color:transparent!important; }
.fxe-rainbow { background:linear-gradient(90deg,#f90,#f3f,#3cf);-webkit-background-clip:text;-webkit-text-fill-color:transparent; }
.fxe-grad    { background:linear-gradient(105deg,#7ad1ff,#fff,#ffcf6a);-webkit-background-clip:text;-webkit-text-fill-color:transparent; }
.fxe-neon    { color:#b14fff!important;text-shadow:0 0 8px #b14fff; }
.fxe-flicker { animation:fxeFlick .4s step-end infinite; }
@keyframes fxeFlick { 0%,100%{opacity:1} 50%{opacity:.2} }
.fxe-blur2   { filter:blur(1px); }

/* Box token previews — callout style */
.fxe-tok-box {
  border-left: 2.5px solid #00e5ff !important;
  padding: 1px 6px 1px 7px !important;
  background: linear-gradient(90deg, rgba(0,229,255,0.10), rgba(0,229,255,0.02)) !important;
  color: #00e5ff !important;
  margin: 0 2px;
}
.fxe-tok-boxneon {
  border-left: 2.5px solid #c678ff !important;
  padding: 1px 6px 1px 7px !important;
  background: linear-gradient(90deg, rgba(198,120,255,0.13), rgba(198,120,255,0.02)) !important;
  color: #c678ff !important;
  text-shadow: 0 0 10px #c678ff88;
  margin: 0 2px;
}
.fxe-tok-boxglass {
  border-left: 2.5px solid rgba(255,255,255,0.6) !important;
  border-top: 1px solid rgba(255,255,255,0.15) !important;
  border-bottom: 1px solid rgba(255,255,255,0.06) !important;
  padding: 1px 6px 1px 7px !important;
  background: linear-gradient(135deg, rgba(200,240,255,0.16), rgba(255,255,255,0.04)) !important;
  color: #d8f0ff !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
  margin: 0 2px;
}
.fxe-tok-boxshadow {
  border-left: 2.5px solid #aaa !important;
  padding: 1px 6px 1px 7px !important;
  background: linear-gradient(135deg, rgba(80,80,80,0.5), rgba(20,20,20,0.7)) !important;
  color: #e8e8e8 !important;
  box-shadow: 3px 3px 0 rgba(0,0,0,0.85);
  transform: translate(-1px,-1px);
  margin: 0 2px;
}
.fxe-tok-boxtape {
  border-top: 2px solid #e8ff00 !important;
  border-bottom: 2px solid #e8ff00 !important;
  border-left: 1px solid rgba(232,255,0,0.4) !important;
  border-right: 1px solid rgba(232,255,0,0.4) !important;
  padding: 1px 6px !important;
  background: repeating-linear-gradient(90deg, transparent 0px, transparent 5px, rgba(232,255,0,0.07) 5px, rgba(232,255,0,0.07) 7px) !important;
  color: #e8ff00 !important;
  text-shadow: 0 0 6px rgba(232,255,0,0.5);
  margin: 0 2px;
}
.fxe-tok-boxrough {
  border-left: 2.5px dashed #ff9f00 !important;
  padding: 1px 6px 1px 7px !important;
  background: linear-gradient(90deg, rgba(255,159,0,0.09), rgba(255,159,0,0.01)) !important;
  color: #ff9f00 !important;
  transform: rotate(-0.5deg);
  display: inline-block;
  margin: 0 2px;
}

/* Callout buttons */
.fxe-callout-grid {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px;
}
.fxe-callout-btn {
  display: flex;
  align-items: center;
  border: none;
  border-left: 3px solid;
  background: transparent;
  cursor: pointer;
  width: 100%;
  padding: 0;
  opacity: .72;
  transition: background .12s, opacity .12s, transform .12s;
}
.fxe-callout-btn:hover { opacity: 1 !important; }
.fxe-callout-btn:active { transform: translateX(1px); }
.fxe-callout-none:hover {
  background: repeating-linear-gradient(45deg,transparent 0,transparent 4px,rgba(255,255,255,.06) 4px,rgba(255,255,255,.06) 5px) !important;
  color: #bbb !important;
  border-color: #666 !important;
}
.fxe-cb-icon {
  font-size: 12px;
  width: 28px;
  min-width: 28px;
  text-align: center;
  padding: 7px 0;
  flex-shrink: 0;
}
.fxe-cb-label {
  font-family: 'Space Mono', monospace;
  font-size: 7.5px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  font-weight: 700;
  padding: 7px 8px 7px 4px;
  flex: 1;
}
.fxe-callout-box      { border-color:#00e5ff; color:#00e5ff; opacity:.6; background:linear-gradient(90deg,rgba(0,229,255,.08),transparent); }
.fxe-callout-box:hover      { background:linear-gradient(90deg,rgba(0,229,255,.18),transparent) !important; }
.fxe-callout-boxneon      { border-color:#c678ff; color:#c678ff; opacity:.6; background:linear-gradient(90deg,rgba(198,120,255,.08),transparent); }
.fxe-callout-boxneon:hover  { background:linear-gradient(90deg,rgba(198,120,255,.18),transparent) !important; }
.fxe-callout-boxglass      { border-color:rgba(255,255,255,.55); color:#cce8ff; opacity:.6; background:linear-gradient(90deg,rgba(200,235,255,.10),transparent); }
.fxe-callout-boxglass:hover { background:linear-gradient(90deg,rgba(200,235,255,.22),transparent) !important; }
.fxe-callout-boxshadow      { border-color:#999; color:#ddd; opacity:.6; background:linear-gradient(90deg,rgba(140,140,140,.08),transparent); }
.fxe-callout-boxshadow:hover { background:linear-gradient(90deg,rgba(140,140,140,.18),transparent) !important; }
.fxe-callout-boxtape      { border-color:#e8ff00; color:#e8ff00; opacity:.6; background:repeating-linear-gradient(90deg,transparent,transparent 5px,rgba(232,255,0,.05) 5px,rgba(232,255,0,.05) 7px); }
.fxe-callout-boxtape:hover  { opacity:1 !important; }
.fxe-callout-boxrough      { border-color:#ff9f00; border-style:dashed; color:#ff9f00; opacity:.6; background:linear-gradient(90deg,rgba(255,159,0,.08),transparent); }
.fxe-callout-boxrough:hover { background:linear-gradient(90deg,rgba(255,159,0,.18),transparent) !important; }
/* Color swatches */
.fxe-colorrow { display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px; }
.fxe-cswatch {
  width:18px;height:18px;border:1px solid #333;cursor:pointer;transition:transform .1s,border-color .1s;
}
.fxe-cswatch:hover { transform:scale(1.2);border-color:#fff; }
.fxe-cswatch.active { border-color:#fff;transform:scale(1.15);border-width:2px; }
.fxe-hint {
  font-family:'Space Mono',monospace;font-size:7px;color:#333;text-align:center;
  padding:8px;letter-spacing:1px;line-height:1.8;
}

/* ── Center ── */
.fxe-center {
  display:flex;flex-direction:column;overflow:hidden;background:#0a0a0a;
}
.fxe-editor-scroll {
  flex:1;overflow-y:auto;padding:12px 16px;
}
.fxe-editor-scroll::-webkit-scrollbar{width:2px}
.fxe-editor-scroll::-webkit-scrollbar-thumb{background:#222}

/* Line wrap */
.fxe-line-wrap {
  margin-bottom:10px;border:1px solid #181818;background:#0c0c0c;
  border-radius:4px;overflow:hidden;
  transition:border-color .15s, box-shadow .15s;
}
.fxe-line-wrap:hover {
  border-color:#2c2c2c;
  box-shadow:0 0 0 1px rgba(232,255,0,.04);
}

/* Actions row (time + bg commands + util buttons) */
.fxe-line-actions {
  display:flex;align-items:center;gap:5px;padding:7px 10px;
  background:#0e0e0e;border-bottom:1px solid #1a1a1a;flex-wrap:wrap;
}
.fxe-time-inp {
  font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.5px;
  background:#050505;border:1px solid #2a2a2a;color:#e8ff00;
  padding:4px 8px;width:78px;flex-shrink:0;border-radius:3px;
  transition:border-color .15s;
}
.fxe-time-inp:focus { border-color:#e8ff00;outline:none; }
/* Expandable раздел (BG + Camera) */
.fxe-expandable {
  background:#050505;border-bottom:1px solid #1a1a1a;
}
.fxe-cmd-section {
  padding:8px 12px;display:flex;flex-direction:column;gap:5px;
}
.fxe-cmd-section + .fxe-cmd-section {
  border-top:1px solid #131313;
}
.fxe-cmd-section-title {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:2px;
  text-transform:uppercase;color:#3a3a3a;margin-bottom:3px;user-select:none;
}
.fxe-cmd-row {
  display:grid;grid-template-columns:130px 1fr;align-items:center;gap:10px;
}
.fxe-cmd-label {
  font-family:'Space Mono',monospace;font-size:9px;color:#666;
  display:inline-flex;align-items:center;gap:6px;letter-spacing:.4px;
  user-select:none;white-space:nowrap;
}
.fxe-cmd-label-icon { font-size:11px;line-height:1; }
.fxe-cmd-row-inline {
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
}

/* Per-line strength slider (зум сила) */
.fxe-cmd-amt-box {
  display:inline-flex;align-items:center;gap:6px;
  background:#0a0a0a;border:1px solid #1f1f1f;
  border-radius:13px;padding:0 10px;height:22px;
}
.fxe-cmd-amt-lbl {
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:1.5px;
  color:#444;text-transform:uppercase;user-select:none;cursor:context-menu;
}
.fxe-cmd-amt-lbl:hover { color:#888; }
.fxe-cmd-amt-slider {
  -webkit-appearance:none;width:90px;height:3px;
  background:#1a1a1a;outline:none;cursor:pointer;border-radius:2px;
}
.fxe-cmd-amt-slider::-webkit-slider-thumb {
  -webkit-appearance:none;width:9px;height:9px;background:#666;
  border-radius:50%;cursor:pointer;
}
.fxe-cmd-amt-slider.on::-webkit-slider-thumb { background:#00ee44; box-shadow:0 0 4px #00ee44; }
.fxe-cmd-amt-slider::-moz-range-thumb {
  width:9px;height:9px;background:#666;border:none;border-radius:50%;cursor:pointer;
}
.fxe-cmd-amt-slider.on::-moz-range-thumb { background:#00ee44; box-shadow:0 0 4px #00ee44; }
.fxe-cmd-amt-val {
  font-family:'Space Mono',monospace;font-size:9px;color:#888;
  min-width:28px;text-align:right;
}
.fxe-cmd-amt-slider.on + .fxe-cmd-amt-val { color:#00ee44; }
/* Сегментированный контрол: [ON | — | OFF] */
.fxe-seg {
  display:inline-flex;background:#0a0a0a;border:1px solid #1f1f1f;
  border-radius:13px;overflow:hidden;height:22px;flex-shrink:0;
}
.fxe-seg-btn {
  border:0;background:transparent;color:#3a3a3a;
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:1px;
  text-transform:uppercase;cursor:pointer;transition:all .12s;
  padding:0 12px;min-width:54px;
}
.fxe-seg-btn:not(:last-child) { border-right:1px solid #1a1a1a; }
.fxe-seg-btn:hover { background:#131313;color:#aaa; }
.fxe-seg-btn.active {
  background:var(--seg-bg, rgba(232,255,0,.10));
  color:var(--seg-fg, #e8ff00);
  font-weight:600;
}
.fxe-seg-btn.active.seg-none { color:#888;background:#1a1a1a;font-weight:400; }
/* Одиночный chip-кнопка (для STOP/RESET) */
.fxe-cmd-chip {
  display:inline-flex;align-items:center;gap:5px;
  height:22px;padding:0 10px;
  background:#0a0a0a;border:1px solid #1f1f1f;border-radius:11px;
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:.8px;
  text-transform:uppercase;color:#3a3a3a;cursor:pointer;
  transition:all .15s;flex-shrink:0;
}
.fxe-cmd-chip:hover { border-color:#444;color:#aaa;background:#111; }
.fxe-cmd-chip.active {
  border-color:var(--chip-fg, #e8ff00);
  color:var(--chip-fg, #e8ff00);
  background:var(--chip-bg, rgba(232,255,0,.10));
}

/* Section badge */
.fxe-section-badge {
  font-family:'Space Mono',monospace;font-size:7px;padding:2px 6px;
  background:rgba(232,255,0,.12);color:#e8ff00;border:1px solid rgba(232,255,0,.3);
  flex-shrink:0;
}

/* ── Per-line style bar (chip-based) ──────────── */
.fxe-line-style {
  display:flex;align-items:center;gap:6px;padding:7px 10px 7px 8px;
  background:linear-gradient(180deg,#070707 0%,#0a0a0a 100%);
  border-top:1px solid #161616;flex-wrap:wrap;
}
/* Маркер слева — горит жёлтым если есть переопределение */
.fxe-ls-marker {
  width:3px;height:18px;background:#1a1a1a;border-radius:2px;flex-shrink:0;
  transition:background .2s, box-shadow .2s;
}
.fxe-ls-marker.active {
  background:#e8ff00;box-shadow:0 0 6px rgba(232,255,0,.5);
}
/* Базовый chip-контейнер */
.fxe-ls-chip {
  display:inline-flex;align-items:center;gap:5px;
  height:24px;padding:0 8px;
  background:#0c0c0c;border:1px solid #1c1c1c;border-radius:12px;
  font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.4px;
  color:#3e3e3e;cursor:pointer;
  transition:all .14s ease;position:relative;
  user-select:none;
}
.fxe-ls-chip:hover {
  border-color:#3a3a3a;color:#aaa;background:#131313;
}
.fxe-ls-chip.active {
  border-color:rgba(232,255,0,.55);color:#e8ff00;background:rgba(232,255,0,.07);
  box-shadow:0 0 0 1px rgba(232,255,0,.12) inset, 0 0 8px rgba(232,255,0,.10);
}
.fxe-ls-chip-icon {
  font-size:11px;line-height:1;opacity:.55;flex-shrink:0;
}
.fxe-ls-chip.active .fxe-ls-chip-icon { opacity:1; }
.fxe-ls-chip select, .fxe-ls-chip input {
  background:transparent;border:0;outline:0;margin:0;padding:0;
  font-family:inherit;font-size:9px;color:inherit;cursor:pointer;
  letter-spacing:.4px;
}
.fxe-ls-chip select {
  appearance:none;-webkit-appearance:none;
  padding-right:11px;min-width:34px;max-width:120px;
  text-overflow:ellipsis;
  background-image:
    linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(-45deg, currentColor 50%, transparent 50%);
  background-position:calc(100% - 4px) 60%, calc(100% - 1px) 60%;
  background-size:3px 3px;background-repeat:no-repeat;
}
.fxe-ls-chip input { width:36px;text-align:center;cursor:text; }
.fxe-ls-chip select option { background:#0a0a0a;color:#ccc; }
.fxe-ls-chip select option:disabled { color:#444; }
/* Цветовой chip — квадратик-сэмпл */
.fxe-ls-color-chip {
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;padding:3px;
  background:#0c0c0c;border:1px solid #1c1c1c;border-radius:5px;
  cursor:pointer;position:relative;transition:all .14s ease;flex-shrink:0;
}
.fxe-ls-color-chip:hover { border-color:#3a3a3a; }
.fxe-ls-color-chip.active {
  border-color:rgba(232,255,0,.55);
  box-shadow:0 0 0 1px rgba(232,255,0,.12) inset, 0 0 8px rgba(232,255,0,.10);
}
.fxe-ls-color-fill {
  width:100%;height:100%;border-radius:3px;background:#222;position:relative;overflow:hidden;
}
.fxe-ls-color-fill.empty {
  background:
    repeating-linear-gradient(45deg, #1a1a1a 0 4px, #0a0a0a 4px 8px);
}
.fxe-ls-color-chip input[type="color"] {
  position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0;
}
/* Reset кнопка */
.fxe-ls-reset {
  height:24px;padding:0 10px;margin-left:auto;
  background:transparent;border:1px solid #1a1a1a;border-radius:12px;
  color:#444;font-family:'Space Mono',monospace;font-size:8px;letter-spacing:.5px;
  cursor:pointer;transition:all .15s;flex-shrink:0;
}
.fxe-ls-reset:hover {
  border-color:#ff2d55;color:#ff2d55;background:rgba(255,45,85,.06);
}
/* Тонкий разделитель между группами */
.fxe-ls-sep {
  width:1px;height:14px;background:#1a1a1a;flex-shrink:0;margin:0 1px;
}
/* Старые классы оставляем для совместимости (line selector использует .fxe-ls-label etc) */
.fxe-ls-label {
  font-family:'Space Mono',monospace;font-size:6px;letter-spacing:2px;text-transform:uppercase;
  color:#2a2a2a;flex-shrink:0;user-select:none;display:none;
}
.fxe-ls-label.active { color:#e8ff00; }
.fxe-ls-divider { display:none; }

/* Token line */
.fxe-token-line {
  display:flex;flex-wrap:wrap;gap:3px;padding:8px 10px;
  min-height:38px;align-items:center;cursor:default;
  position:relative;
}
.fxe-sel-all-btn {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;text-transform:uppercase;
  background:transparent;border:1px solid #2a2a2a;color:#444;
  padding:3px 8px;cursor:pointer;transition:all .15s;flex-shrink:0;
}
.fxe-sel-all-btn:hover { border-color:#e8ff00;color:#e8ff00; }
.fxe-tok {
  font-family:'Space Mono',monospace;font-size:11px;padding:2px 7px;
  cursor:pointer;border:1px solid transparent;transition:all .1s;user-select:none;position:relative;
}
.fxe-tok:hover  { border-color:#444; }
.fxe-tok.sel    { border-color:#e8ff00;background:rgba(232,255,0,.1); }
.fxe-tok.hasfx  { border-bottom:2px solid #e8ff00; }
.fxe-tok.hasc   { border-bottom:2px solid var(--tc,#fff); }
.fxe-tok-bold      { font-weight:700; }
.fxe-tok-italic    { font-style:italic; }
.fxe-tok-underline { text-decoration:underline; }
.fxe-tok-strike    { text-decoration:line-through;opacity:.6; }
.fxe-tok-big       { font-size:15px; }
.fxe-tok-small     { font-size:8px;opacity:.7; }
.fxe-tok-glitch    { color:#ff3333;text-shadow:1px 0 0 #33f,-1px 0 0 #f33; }
.fxe-tok-glow      { text-shadow:0 0 10px #e8ff00;color:#e8ff00; }
.fxe-tok-shake     { animation:fxeShk .08s infinite; }
.fxe-tok-wave      { animation:fxeWav .9s ease-in-out infinite; }
.fxe-tok-outline   { -webkit-text-stroke:1px #e8ff00;color:transparent; }
.fxe-tok-rainbow   { background:linear-gradient(90deg,#f90,#f3f,#3cf);-webkit-background-clip:text;-webkit-text-fill-color:transparent; }
.fxe-tok-grad      { background:linear-gradient(105deg,#7ad1ff,#fff,#ffcf6a);-webkit-background-clip:text;-webkit-text-fill-color:transparent; }
.fxe-tok-neon      { color:#b14fff;text-shadow:0 0 10px #b14fff; }
.fxe-tok-blur      { filter:blur(2px); }
.fxe-tok-flicker   { animation:fxeFlick .4s step-end infinite; }
/* Box token previews */
.fxe-tok-box       { position:relative; }
.fxe-tok-box::before, .fxe-tok-box::after {
  content:'';position:absolute;width:5px;height:5px;pointer-events:none;
}
.fxe-tok-box::before { top:-1px;left:-1px;border-top:1.5px solid #00e5ff;border-left:1.5px solid #00e5ff; }
.fxe-tok-box::after  { bottom:-1px;right:-1px;border-bottom:1.5px solid #00e5ff;border-right:1.5px solid #00e5ff; }
.fxe-tok-boxneon   { box-shadow:0 0 6px #c678ff66,0 0 0 1px #c678ff;text-shadow:0 0 6px #c678ff;color:#c678ff; }
.fxe-tok-boxglass  { background:linear-gradient(160deg,rgba(200,240,255,.18),rgba(255,255,255,.04));box-shadow:0 0 0 1px rgba(255,255,255,.3),inset 0 1px 0 rgba(255,255,255,.2); }
.fxe-tok-boxshadow { box-shadow:3px 3px 0 #000,3px 3px 0 1px rgba(255,255,255,.06);transform:translate(-1px,-1px);color:#e0e0e0; }
.fxe-tok-boxtape   { border-top:2px solid #e8ff00;border-bottom:2px solid #e8ff00;color:#e8ff00;background:repeating-linear-gradient(90deg,transparent 0,transparent 5px,rgba(232,255,0,.08) 5px,rgba(232,255,0,.08) 7px); }
.fxe-tok-boxrough  { box-shadow:0 0 0 1.5px #ff9f00;transform:rotate(-0.5deg);color:#ff9f00; }
@keyframes fxeShk { 0%,100%{transform:translate(0)} 25%{transform:translate(-2px,1px)} 75%{transform:translate(2px,-1px)} }
@keyframes fxeWav { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }

.fxe-addline {
  margin:0 16px 12px;background:transparent;border:1px dashed #222;color:#444;
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;
  padding:7px;cursor:pointer;transition:all .15s;flex-shrink:0;
}
.fxe-addline:hover{border-color:#e8ff00;color:#e8ff00;}
.fxe-center-footer {
  display:flex;
  align-items:center;
  padding:0 16px 12px;
  gap:8px;
}
.fxe-center-footer .fxe-addline {
  margin:0;
  flex:1;
}

/* ── Right panel ── */
.fxe-right {
  background:#111;border-left:1px solid #222;display:flex;flex-direction:column;overflow:hidden;
}
.fxe-preview-canvas-wrap {
  position:relative;background:#0a0a0a;border-bottom:1px solid #1a1a1a;
  padding:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  min-height:180px;
}
.fxe-preview-canvas-wrap::before {
  content:'// ПРЕВЬЮ ЭФФЕКТОВ';
  position:absolute;top:6px;left:10px;
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:2px;
  color:#222;text-transform:uppercase;
}
#fxePreviewCanvas {
  max-width:100%;height:auto;border:1px solid #1a1a1a;
}
.fxe-preview-hint {
  position:absolute;
  font-family:'Space Mono',monospace;font-size:11px;letter-spacing:2px;
  color:#333;text-transform:uppercase;pointer-events:none;
}
.fxe-output {
  flex:1;overflow-y:auto;padding:8px;
}
.fxe-output::-webkit-scrollbar{width:2px}
.fxe-output::-webkit-scrollbar-thumb{background:#222}
.fxe-out-line {
  font-family:'Space Mono',monospace;font-size:8px;color:#444;
  padding:4px 6px;border-bottom:1px solid #1a1a1a;line-height:1.6;word-break:break-all;
}
.fxe-out-time   { color:#00e5ff; }
.fxe-out-tag    { color:#e8ff00; }
.fxe-out-bgcmd  { color:#b14fff; }
.fxe-out-camcmd { color:#00ff88; }
.fxe-out-lstyle { color:#ff9f00; }
.fxe-selinfo {
  font-family:'Space Mono',monospace;font-size:8px;color:#444;padding:6px 10px;
  border-top:1px solid #1a1a1a;flex-shrink:0;min-height:28px;
}
.fxe-selinfo .hi { color:#e8ff00; }

/* ── Buttons ── */
.fxe-btn {
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;
  padding:7px 12px;cursor:pointer;border:1px solid;transition:all .12s;
  display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;
}
.fxe-btn-sm {
  font-size:clamp(9px, 2vw, 11px);
  padding:8px 14px;
  letter-spacing:1.5px;
}
.fxe-btn-ghost  { background:transparent;color:#555;border-color:#222; }
.fxe-btn-ghost:hover  { color:#efefef;border-color:#555; }
.fxe-btn-accent { background:#e8ff00;color:#000;border-color:#e8ff00;font-weight:700; }
.fxe-btn-accent:hover { background:transparent;color:#e8ff00; }
.fxe-btn-danger { background:transparent;color:#ff2d55;border-color:#ff2d55; }
.fxe-btn-danger:hover { background:#ff2d55;color:#fff; }
.fxe-btn-full   { width:100%; }

/* ── Tab bar ── */
.fxe-tab-bar {
  display:flex;gap:0;flex-shrink:0;
  background:#080808;border-bottom:1px solid #222;
}
.fxe-tab {
  font-family:'Space Mono',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;
  padding:10px 20px;cursor:pointer;background:transparent;border:none;
  color:#444;border-bottom:2px solid transparent;transition:all .15s;
}
.fxe-tab:hover { color:#999; }
.fxe-tab.active { color:#e8ff00;border-bottom-color:#e8ff00; }

/* ── Overlay panel ── */
.fxe-ov-panel{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
.fxe-ov-toolbar{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#111;border-bottom:1px solid #1a1a1a;flex-shrink:0}
.fxe-ov-hint{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;color:#333;text-transform:uppercase}
.fxe-ov-content{flex:1;display:flex;gap:0;overflow:hidden;min-height:0}
.fxe-ov-left{width:400px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid #1a1a1a;background:#090909;overflow:hidden;min-height:0}
.fxe-ov-right{flex:1;display:flex;flex-direction:column;overflow:hidden}
.fxe-ov-preview-wrap{flex:1;position:relative;background:#0a0a0a;padding:12px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.fxe-ov-preview-label{position:absolute;top:4px;left:8px;font-family:'Space Mono',monospace;font-size:6px;letter-spacing:2px;color:#222;text-transform:uppercase;z-index:1}
.fxe-ov-preview-hint-sel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-family:'Space Mono',monospace;font-size:9px;letter-spacing:1px;color:#333;text-align:center;pointer-events:none;z-index:2;line-height:1.6;text-transform:uppercase}
.fxe-ov-preview-controls{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;z-index:3;background:rgba(9,9,9,.9);padding:6px 12px;border:1px solid #222}
.fxe-ov-preview-name{font-family:'Space Mono',monospace;font-size:8px;letter-spacing:2px;color:#666;text-transform:uppercase;white-space:nowrap;overflow:hidden;max-width:120px;text-overflow:ellipsis}
.fxe-ov-anim-btn,.fxe-ov-anim-stop{font-size:8px!important;letter-spacing:1px;padding:5px 12px!important}
.fxe-ov-card.preview-selected{border-color:#e8ff00;box-shadow:0 0 0 1px rgba(232,255,0,.12)}
.fxe-ov-card.preview-selected .fxe-ov-card-header{background:rgba(232,255,0,.03)}
#fxeOvPreviewCanvas{width:100%;height:100%;object-fit:contain;border:1px solid #1a1a1a}

/* List */
.fxe-ov-list{flex:1;overflow-y:auto;padding:10px;min-height:0;max-height:100%;display:block}
.fxe-ov-list::-webkit-scrollbar{width:4px}
.fxe-ov-list::-webkit-scrollbar-thumb{background:#222;border-radius:2px}
.fxe-ov-list::-webkit-scrollbar-track{background:transparent}

/* Card */
.fxe-ov-card{background:#0e0e0e;border:1px solid #1c1c1c;border-radius:6px;overflow:hidden;transition:border-color .15s;margin-bottom:8px}
.fxe-ov-card:hover{border-color:#2a2a2a}
.fxe-ov-card.disabled{opacity:.35}
.fxe-ov-card-text{border-color:#252510}
.fxe-ov-card-text .fxe-ov-card-header{background:#111108}
.fxe-ov-card-text.preview-selected{border-color:#e8ff00}

/* Header */
.fxe-ov-card-header{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#111;border-bottom:1px solid #1a1a1a;cursor:pointer;user-select:none;min-height:48px;transition:background .12s}
.fxe-ov-card-header:hover{background:#141414}
.fxe-ov-card.collapsed .fxe-ov-card-body{display:none}
.fxe-ov-card.collapsed .fxe-ov-card-header{border-bottom:none}
.fxe-ov-card-header>button,.fxe-ov-card-header .fxe-ov-zbtn,.fxe-ov-card-header .fxe-ov-collapse{cursor:pointer}

.fxe-ov-collapse{width:18px;height:18px;background:none;border:none;color:#444;font-size:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;transition:color .12s}
.fxe-ov-collapse:hover{color:#e8ff00}

.fxe-ov-zbadge{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;color:#333;background:#0a0a0a;border:1px solid #1c1c1c;padding:2px 5px;flex-shrink:0}

.fxe-ov-zctrls{display:flex;flex-direction:column;gap:2px;flex-shrink:0}
.fxe-ov-zbtn{width:18px;height:14px;background:none;border:1px solid #222;color:#444;font-size:7px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:all .12s}
.fxe-ov-drag-handle{width:20px;height:28px;display:flex;align-items:center;justify-content:center;cursor:grab;color:#333;font-size:14px;flex-shrink:0;border-radius:3px;transition:color .12s,background .12s;user-select:none;margin-right:2px}
.fxe-ov-drag-handle:hover{color:#e8ff00;background:#1a1a00}
.fxe-ov-drag-handle:active{cursor:grabbing}
.fxe-ov-card.drag-dragging{opacity:.35;outline:1px dashed #e8ff00}
.fxe-ov-card.drag-over-above{border-top:2px solid #e8ff00 !important}
.fxe-ov-card.drag-over-below{border-bottom:2px solid #e8ff00 !important}
.fxe-ov-zbtn:hover:not(:disabled){border-color:#e8ff00;color:#e8ff00;background:rgba(232,255,0,.05)}
.fxe-ov-zbtn:disabled{opacity:.2;cursor:not-allowed}

.fxe-ov-thumb{width:44px;height:30px;object-fit:cover;border:1px solid #222;border-radius:3px;flex-shrink:0;display:block}
.fxe-ov-thumb-wrap {
  position:relative;width:44px;height:30px;flex-shrink:0;cursor:pointer;
  border-radius:3px;overflow:hidden;
}
.fxe-ov-thumb-wrap:hover .fxe-ov-thumb { filter:brightness(0.4); }
.fxe-ov-thumb-replace-hint {
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#e8ff00;font-size:18px;font-weight:700;opacity:0;
  text-shadow:0 0 4px #000;pointer-events:none;
  transition:opacity .12s;
}
.fxe-ov-thumb-wrap:hover .fxe-ov-thumb-replace-hint { opacity:1; }
.fxe-ov-text-icon{display:flex;align-items:center;justify-content:center;background:#141408;border:1px solid #2a2a10;border-radius:3px;color:#e8ff00;font-family:'Bebas Neue',cursive;font-size:18px;letter-spacing:1px;width:44px;height:30px;flex-shrink:0}

.fxe-ov-card-name{font-family:'Space Mono',monospace;font-size:10px;color:#999;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.5px}

.fxe-ov-chip-enable{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1.5px;text-transform:uppercase;padding:3px 8px;background:#0a0a0a;border:1px solid #222;color:#444;cursor:pointer;white-space:nowrap;transition:all .12s;flex-shrink:0}
.fxe-ov-chip-enable.active-enabled{background:#0d1a0d;border-color:#2a6a2a;color:#6dcc6d}
.fxe-ov-chip-enable:hover{border-color:#555;color:#ccc}

.fxe-ov-rem{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;text-transform:uppercase;padding:3px 8px;background:none;border:1px solid #1a1a1a;color:#333;cursor:pointer;white-space:nowrap;transition:all .12s;flex-shrink:0}
.fxe-ov-dup{font-family:'Space Mono',monospace;font-size:11px;padding:2px 7px;background:none;border:1px solid #1a1a1a;color:#558;cursor:pointer;white-space:nowrap;transition:all .12s;flex-shrink:0;line-height:1}
.fxe-ov-dup:hover{border-color:#00e5ff;color:#00e5ff;background:rgba(0,229,255,0.06)}
.fxe-ov-rem:hover{border-color:#cc3333;color:#cc3333;background:rgba(200,50,50,.06)}

/* Body */
.fxe-ov-card-body{padding:0;display:flex;flex-direction:column}

/* Section — named group of controls */
.fxe-ov-section{padding:10px 12px;border-bottom:1px solid #141414;display:flex;flex-direction:column;gap:8px}
.fxe-ov-section:last-child{border-bottom:none}
.fxe-ov-section-label{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:2px;text-transform:uppercase;color:#2e2e2e;padding-bottom:4px;border-bottom:1px solid #141414;margin-bottom:2px}

/* Row */
.fxe-ov-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fxe-ov-row-full{flex-direction:column;align-items:stretch;gap:6px}
.fxe-ov-row-label{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1.5px;text-transform:uppercase;color:#3a3a3a;flex-shrink:0;width:56px}

/* Slider — proper grid layout: label | track | value */
.fxe-ov-slider-row{display:grid;grid-template-columns:52px 1fr 36px;align-items:center;gap:8px}
.fxe-ov-slider-label{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;text-transform:uppercase;color:#3a3a3a;white-space:nowrap}
.fxe-ov-slider{-webkit-appearance:none;appearance:none;height:3px;background:#1c1c1c;border-radius:2px;outline:none;cursor:pointer;width:100%}
.fxe-ov-slider::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#e8ff00;cursor:pointer;border:2px solid #090909;box-shadow:0 0 0 1px #e8ff00;transition:transform .1s}
.fxe-ov-slider::-webkit-slider-thumb:hover{transform:scale(1.2)}
.fxe-ov-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#e8ff00;cursor:pointer;border:2px solid #090909}
.fxe-ov-slider:focus::-webkit-slider-thumb{box-shadow:0 0 0 3px rgba(232,255,0,.25)}
.fxe-ov-val{font-family:'Space Mono',monospace;font-size:9px;color:#e8ff00;text-align:right;min-width:32px}

/* Color row: [checkbox][chip][slider][value] */
.fxe-ov-color-row{display:grid;grid-template-columns:16px 24px 1fr 36px;align-items:center;gap:8px}

/* Chips */
.fxe-ov-chip-group{display:flex;gap:4px;flex-wrap:wrap}
.fxe-ov-chip{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;text-transform:uppercase;padding:4px 10px;cursor:pointer;background:transparent;border:1px solid #1e1e1e;color:#3a3a3a;border-radius:3px;transition:all .12s;white-space:nowrap}
.fxe-ov-chip:hover{border-color:#555;color:#aaa}
.fxe-ov-chip.active-layer-above{background:#0a160a;border-color:#2d6e2d;color:#6dcc6d}
.fxe-ov-chip.active-layer-below{background:#160a0a;border-color:#6e2d2d;color:#cc6d6d}
.fxe-ov-chip.active-scope-global{background:#0a0a16;border-color:#2d2d6e;color:#6d6dcc}
.fxe-ov-chip.active-scope-tl{background:#160d0a;border-color:#885500;color:#ffaa44}
.fxe-ov-chip.active-enabled{background:#0a1508;border-color:#2a6e22;color:#6dc668}
.fxe-ov-chip.active-pos{background:#141400;border-color:#e8ff00;color:#e8ff00}
.fxe-ov-chip.active-box{background:#141400;border-color:#e8ff00;color:#e8ff00}
.fxe-ov-chip-sq{width:26px;height:26px;padding:0;font-size:11px;display:inline-flex;align-items:center;justify-content:center;border-radius:3px;flex-shrink:0}
.fxe-ov-pos-preset{font-size:7.5px}

/* Color chip */
.fxe-ov-color-chip{position:relative;display:inline-block;width:24px;height:24px;border-radius:50%;border:1px solid #333;cursor:pointer;flex-shrink:0;box-shadow:inset 0 0 0 2px #090909;transition:transform .1s,border-color .12s}
.fxe-ov-color-chip:hover{border-color:#e8ff00;transform:scale(1.15)}
.fxe-ov-color-chip.none{background:repeating-linear-gradient(45deg,#1e1e1e 0,#1e1e1e 3px,#090909 3px,#090909 6px)!important}
.fxe-ov-color-chip.none::after{content:'✕';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555;font-size:9px}
.fxe-ov-color-chip input[type=color]{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;padding:0}

/* Style row (B / I / colors) */
.fxe-ov-style-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.fxe-ov-style-sep{width:1px;height:20px;background:#1c1c1c;margin:0 2px;flex-shrink:0}

/* Checkbox */
.fxe-ov-checkbox{width:14px;height:14px;cursor:pointer;accent-color:#e8ff00;flex-shrink:0}

/* Textarea */
.fxe-ov-textarea{width:100%;background:#080808;border:1px solid #1c1c1c;border-radius:4px;color:#ddd;font-family:'Space Mono',monospace;font-size:11px;padding:7px 10px;resize:vertical;min-height:32px;max-height:120px;outline:none;line-height:1.5;transition:border-color .15s}
.fxe-ov-textarea:focus{border-color:#e8ff00}
.fxe-ov-textarea::placeholder{color:#2a2a2a}

/* Select */
.fxe-ov-select{font-family:'Space Mono',monospace;font-size:9px;background:#080808;border:1px solid #1c1c1c;border-radius:4px;color:#999;padding:5px 8px;cursor:pointer;outline:none;transition:border-color .15s}
.fxe-ov-select:hover,.fxe-ov-select:focus{border-color:#333;color:#ccc}
.fxe-ov-select-full{width:100%}

/* Position grid */
.fxe-ov-pos-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;width:fit-content}
.fxe-ov-arrow-btn{width:28px;height:28px;font-size:12px;cursor:pointer;background:#0a0a0a;border:1px solid #1c1c1c;border-radius:3px;color:#444;transition:all .12s;display:flex;align-items:center;justify-content:center}
.fxe-ov-arrow-btn:hover{background:#141414;border-color:#e8ff00;color:#e8ff00}
.fxe-ov-arrow-btn:active{background:#e8ff00;color:#000}
.fxe-ov-pos-values{font-family:'Space Mono',monospace;font-size:8px;color:#555;letter-spacing:1px}
.fxe-ov-custom-pos{display:flex;align-items:center;gap:12px}

/* Box grid */
.fxe-ov-box-grid{display:flex;flex-wrap:wrap;gap:4px}
.fxe-ov-box-btn{font-family:'Space Mono',monospace;font-size:7px;letter-spacing:.5px;text-transform:uppercase;padding:4px 8px;background:transparent;border:1px solid #1e1e1e;color:#3a3a3a;cursor:pointer;border-radius:3px;transition:all .12s;white-space:nowrap}
.fxe-ov-box-btn:hover{filter:brightness(1.5)}
.fxe-ov-box-btn.active-box{filter:brightness(1.8)}

/* Open selector */
.fxe-ov-open-selector{font-family:'Space Mono',monospace;font-size:9px!important;letter-spacing:1px;text-transform:uppercase;padding:8px 12px!important;background:#0e0e0e!important;border:1px solid #1e1e1e!important;color:#666!important;cursor:pointer;border-radius:4px;transition:all .15s;width:100%;text-align:left}
.fxe-ov-open-selector:hover{border-color:#e8ff00!important;color:#e8ff00!important;background:rgba(232,255,0,.03)!important}

/* Legacy — kept for compatibility */
.fxe-ov-row-tight{gap:5px;padding:0}
.fxe-ov-row-tight .fxe-ov-slider-row{flex:1;min-width:0}
.fxe-ov-row-tight .fxe-ov-slider-label{font-size:7px;letter-spacing:1px;color:#555}
.fxe-ov-color{width:28px;height:24px;background:transparent;border:1px solid #222;cursor:pointer;padding:0;flex-shrink:0}
.fxe-ov-color:hover{border-color:#666}
.fxe-ov-num{font-family:'Space Mono',monospace;font-size:9px;color:#e8ff00;background:#0a0a0a;border:1px solid #333;padding:2px 6px;width:44px;text-align:center}

/* Timeline lines */
.fxe-ov-tl-range{display:flex;align-items:center;gap:4px;flex-shrink:0}
.fxe-ov-tl-range span{font-family:'Space Mono',monospace;font-size:7px;color:#444}
.fxe-ov-tl-lines{display:flex;flex-direction:column;gap:6px;margin-top:8px;width:100%}
.fxe-ov-tl-header{font-family:'Space Mono',monospace;font-size:7px;color:#666;text-transform:uppercase;letter-spacing:1px;padding:4px 0;display:flex;align-items:center;gap:8px}
.fxe-ov-tl-header span{flex:1}
.fxe-ov-tl-btn{font-family:'Space Mono',monospace;font-size:7px;background:#1a1a1a;border:1px solid #333;color:#999;padding:4px 8px;cursor:pointer;border-radius:2px;text-transform:uppercase;letter-spacing:1px;transition:all .12s}
.fxe-ov-tl-btn:hover{background:#222;border-color:#e8ff00;color:#e8ff00}
.fxe-ov-lines-list{display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto;background:#080808;border:1px solid #1a1a1a;border-radius:3px;padding:4px}
.fxe-ov-lines-list::-webkit-scrollbar{width:3px}
.fxe-ov-lines-list::-webkit-scrollbar-thumb{background:#222;border-radius:2px}
.fxe-ov-line-item{display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;background:#0e0e0e;border:1px solid #141414;border-radius:2px;transition:all .12s}
.fxe-ov-line-item:hover{background:#141414;border-color:#222}
.fxe-ov-line-check{flex-shrink:0;width:13px;height:13px;cursor:pointer;accent-color:#e8ff00}
.fxe-ov-line-text{font-family:'Space Mono',monospace;font-size:8px;color:#888;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Card Constructor panel ──────────────── */
/* Скроллит весь fxe-cd-panel целиком (как обычная страница).
   Toolbar — sticky сверху, preview-col — sticky сбоку, чтобы
   при прокрутке списка карточек превью оставалось видимым. */
.fxe-cd-panel {
  flex:1;
  display:flex;flex-direction:column;
  background:#0a0a0a;
  min-height:0;
  overflow-y:auto;
  overflow-x:hidden;
}
.fxe-cd-panel::-webkit-scrollbar { width:10px; }
.fxe-cd-panel::-webkit-scrollbar-track { background:#0a0a0a; }
.fxe-cd-panel::-webkit-scrollbar-thumb { background:#2a3a55; border-radius:5px; }
.fxe-cd-panel::-webkit-scrollbar-thumb:hover { background:#00e5ff; }

.fxe-cd-toolbar {
  display:flex;align-items:center;gap:12px;padding:10px 16px;
  background:#111;border-bottom:1px solid #1a1a1a;
  position:sticky;top:0;z-index:5;
}
.fxe-cd-toolbar-hint {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;color:#333;
  text-transform:uppercase;
}

/* Контент — обычная flex-row, растёт под содержимое */
.fxe-cd-content {
  display:flex;
  align-items:flex-start;     /* колонки не растягиваются по высоте, у каждой своя высота */
  min-height:100%;
}
.fxe-cd-list-col {
  border-right:1px solid #1a1a1a;
  background:#0c0c0c;
  display:flex;flex-direction:column;
  width:480px;min-width:420px;max-width:520px;
  flex-shrink:0;
}
.fxe-cd-list {
  padding:14px;display:flex;flex-direction:column;gap:10px;
}

/* Preview — sticky чтобы оставаться видимым при прокрутке */
.fxe-cd-preview-col {
  flex:1;min-width:0;
  display:flex;flex-direction:column;
  background:#08080c;padding:14px;
  position:sticky;top:54px;        /* под toolbar (≈54px) */
  align-self:flex-start;
  max-height:calc(100vh - 200px);  /* не больше экрана, чтобы preview-wrap имел границы */
  box-sizing:border-box;
}
.fxe-cd-preview-wrap {
  flex:1;position:relative;border:1px solid #1a1a1a;
  display:flex;align-items:center;justify-content:center;overflow:hidden;
}
#fxeCdPreviewCanvas { max-width:100%; max-height:100%; object-fit:contain; }
.fxe-cd-preview-label {
  position:absolute;top:6px;left:8px;
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:2px;
  color:#222;text-transform:uppercase;
}

/* Grid toolbar в правом верхнем углу превью */
.fxe-cd-grid-toolbar {
  position:absolute;top:6px;right:8px;
  display:flex;gap:4px;align-items:center;
  z-index:3;
}
.fxe-cd-grid-toggle {
  font-family:'Space Mono',monospace;font-size:9px;letter-spacing:2px;
  background:rgba(10,10,15,0.85);
  border:1px solid #2a3a55;color:#88c0e0;
  padding:5px 10px;cursor:pointer;
  text-transform:uppercase;font-weight:700;
  transition:all .12s;
}
.fxe-cd-grid-toggle:hover { border-color:#00e5ff;color:#00e5ff; }
.fxe-cd-grid-toggle.on {
  background:rgba(0,229,255,0.15);
  border-color:#00e5ff;color:#00e5ff;
  box-shadow:0 0 8px rgba(0,229,255,0.25);
}
.fxe-cd-grid-steps {
  display:flex;gap:2px;
  background:rgba(10,10,15,0.85);
  border:1px solid #2a3a55;
}
.fxe-cd-grid-steps button {
  font-family:'Space Mono',monospace;font-size:9px;
  background:transparent;border:none;color:#556;
  padding:5px 7px;cursor:pointer;font-weight:700;
}
.fxe-cd-grid-steps button:hover { color:#88c0e0; }
.fxe-cd-grid-steps button.on {
  background:rgba(0,229,255,0.18);color:#00e5ff;
}

/* Card item */
.fxe-cd-card {
  background:#0d0d10;border:1px solid #1a1f2a;overflow:hidden;
  transition:border-color .15s, opacity .15s;
}
.fxe-cd-card:hover { border-color:#2a3a55; }
.fxe-cd-card.disabled { opacity:.45; }
.fxe-cd-card.expanded { border-color:#00e5ff; }

.fxe-cd-card-head {
  display:flex;align-items:center;gap:6px;padding:9px 10px;cursor:pointer;
  background:linear-gradient(180deg, #11161f, #0c0f17);
  border-bottom:1px solid #1a1f2a;
  user-select:none;
}
.fxe-cd-card-head:hover { background:linear-gradient(180deg, #14202d, #0e131c); }
.fxe-cd-style-pill {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1.5px;
  background:#0a0a0a;border:1px solid #2a2a2a;color:#aaa;
  padding:3px 6px;flex-shrink:0;
}
.fxe-cd-blocks-pill {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1.5px;
  background:rgba(0,229,255,0.08);border:1px solid #1a3a55;color:#88c0e0;
  padding:3px 6px;flex-shrink:0;
}

.fxe-cd-card-body {
  padding:0;
  background:#06080c;
}
.fxe-cd-section {
  padding:10px 12px;
  border-bottom:1px solid #11161f;
}
.fxe-cd-section-label {
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:2.5px;
  color:#445;text-transform:uppercase;margin-bottom:8px;
}
.fxe-cd-section-sublabel {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1.5px;
  color:#445;text-transform:uppercase;margin:8px 0 4px;
}
.fxe-cd-grid { display:grid;grid-template-columns:1fr;gap:3px; }

.fxe-cd-row {
  display:flex;align-items:center;gap:8px;padding:3px 0;
}
.fxe-cd-row-label {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1.2px;
  text-transform:uppercase;color:#556677;width:96px;flex-shrink:0;
}
.fxe-cd-row-val {
  font-family:'Space Mono',monospace;font-size:9px;color:#00e5ff;
  min-width:40px;text-align:right;flex-shrink:0;
}
.fxe-cd-range {
  flex:1;-webkit-appearance:none;height:3px;background:#1a1f2a;
  outline:none;cursor:pointer;border-radius:1px;
}
.fxe-cd-range::-webkit-slider-thumb {
  -webkit-appearance:none;width:10px;height:10px;background:#00e5ff;
  border-radius:50%;cursor:pointer;box-shadow:0 0 4px #00e5ff;
}
.fxe-cd-range::-moz-range-thumb {
  width:10px;height:10px;background:#00e5ff;border:none;
  border-radius:50%;cursor:pointer;box-shadow:0 0 4px #00e5ff;
}
.fxe-cd-color-inp {
  flex:1;height:24px;background:transparent;border:1px solid #2a2a2a;
  cursor:pointer;padding:0;
}
.fxe-cd-anim-row {
  display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;
}

/* Block editor */
.fxe-cd-block {
  background:#0a0d12;border:1px solid #1a2a3a;padding:10px;margin-bottom:10px;
  display:flex;flex-direction:column;gap:8px;
}
.fxe-cd-block-head {
  display:flex;align-items:center;gap:5px;
}
.fxe-cd-block-num {
  font-family:'Space Mono',monospace;font-size:9px;font-weight:700;
  background:#00e5ff;color:#000;
  padding:2px 7px;border-radius:2px;
  flex-shrink:0;
}
.fxe-cd-block-preview {
  font-family:'Space Mono',monospace;font-size:10px;color:#778;
  flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  padding-left:4px;
}
.fxe-cd-block-btn {
  width:24px;height:24px;font-size:11px;
  background:#0a0a0a;border:1px solid #2a3a55;color:#88c0e0;cursor:pointer;
  display:flex;align-items:center;justify-content:center;padding:0;
  flex-shrink:0;
}
.fxe-cd-block-btn:hover { background:#14202d;border-color:#00e5ff;color:#00e5ff; }
.fxe-cd-block-text {
  width:100%;
  background:#0a0a0d;border:1px solid #2a3a55;
  color:#ffffff;
  font-family:'Space Mono',monospace;font-size:13px;line-height:1.4;
  padding:8px 10px;
  resize:vertical;outline:none;min-height:46px;
  letter-spacing:0.3px;
}
.fxe-cd-block-text:focus { border-color:#00e5ff; box-shadow:0 0 0 2px rgba(0,229,255,0.12); }
.fxe-cd-block-text::placeholder { color:#445;font-style:italic; }

/* Главный ряд (font + size +/- + color) */
.fxe-cd-block-main-row {
  display:flex;align-items:center;gap:5px;
}
.fxe-cd-block-font {
  flex:1;min-width:0;
  background:#0a0a0d;border:1px solid #2a2a2a;color:#bbc;
  font-family:'Space Mono',monospace;font-size:11px;padding:6px 8px;cursor:pointer;outline:none;
  height:30px;
}
.fxe-cd-block-font:hover { border-color:#3a4a55; color:#ddf; }

.fxe-cd-step-box {
  display:flex;align-items:center;
  background:#0a0a0d;border:1px solid #2a2a2a;
  height:30px;flex-shrink:0;
}
.fxe-cd-step-btn {
  width:24px;height:28px;background:transparent;border:none;
  color:#88c0e0;font-size:14px;cursor:pointer;font-weight:700;
}
.fxe-cd-step-btn:hover { background:#14202d;color:#00e5ff; }
.fxe-cd-step-val {
  width:42px;height:28px;
  background:transparent;border:none;
  color:#00e5ff;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;
  text-align:center;outline:none;
  padding:0;
  -moz-appearance:textfield;
}
.fxe-cd-step-val::-webkit-outer-spin-button,
.fxe-cd-step-val::-webkit-inner-spin-button { -webkit-appearance:none;margin:0; }

.fxe-cd-block-color {
  width:32px;height:30px;
  background:transparent;border:1px solid #2a2a2a;
  cursor:pointer;padding:0;flex-shrink:0;
}

.fxe-cd-block-tog {
  font-family:'Space Mono',monospace;font-size:11px;letter-spacing:0.5px;
  background:#0a0a0a;border:1px solid #2a2a2a;color:#556;
  padding:5px 10px;cursor:pointer;flex-shrink:0;transition:all .12s;
  font-weight:700;height:30px;
  display:flex;align-items:center;justify-content:center;min-width:30px;
}
.fxe-cd-block-tog:hover { border-color:#666;color:#aaa; }
.fxe-cd-block-tog.on {
  background:#0a1a14;border-color:#00aa66;color:#00ee99;
  box-shadow:0 0 4px rgba(0,238,153,0.18);
}
.fxe-cd-block-sep {
  width:1px;height:18px;background:#2a2a2a;margin:0 4px;flex-shrink:0;
}

/* Подробнее ▾ */
.fxe-cd-block-more-btn {
  width:100%;
  background:transparent;border:1px dashed #1a2a3a;
  color:#445566;font-family:'Space Mono',monospace;font-size:9px;
  letter-spacing:1px;text-transform:uppercase;
  padding:6px;cursor:pointer;transition:all .12s;
}
.fxe-cd-block-more-btn:hover { border-color:#3a4a55;color:#88c0e0; }
.fxe-cd-block-adv {
  display:grid;grid-template-columns:1fr;gap:3px;
  padding:4px 6px;background:#06080c;
  border:1px solid #11161f;border-radius:2px;
}

/* Sci-fi подпись с акцентом */
.fxe-cd-scifi-label {
  color:#00e5ff !important;
  letter-spacing:2px !important;
  font-weight:700;
}
/* Sci-fi grid выделен сильнее */
.fxe-cd-scifi-grid { gap:7px; }
.fxe-cd-scifi-btn {
  background:linear-gradient(160deg, #0c1620, #050a14) !important;
  border-width:1.5px !important;
  box-shadow:inset 0 0 8px rgba(0,229,255,0.08);
}
.fxe-cd-scifi-btn:hover {
  box-shadow:0 0 12px currentColor, inset 0 0 12px rgba(0,229,255,0.18);
  filter:brightness(1.2);
}

/* Templates grid: 3 в ряд, иконка + название */
.fxe-cd-tpl-grid {
  display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;margin-bottom:8px;
}
.fxe-cd-tpl-btn {
  display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:10px 6px;
  background:linear-gradient(160deg, #0d1620, #0a0d14);
  border:1px solid #2a3a55;color:#88c0e0;
  cursor:pointer;transition:all .15s;
  font-family:'Space Mono',monospace;
}
.fxe-cd-tpl-btn:hover {
  background:linear-gradient(160deg, #14202d, #0e131c);
  border-color:#00e5ff;color:#00e5ff;
  box-shadow:0 0 8px rgba(0,229,255,0.15);
}
.fxe-cd-tpl-icon { font-size:18px;line-height:1; }
.fxe-cd-tpl-label {
  font-size:8.5px;letter-spacing:1px;text-transform:uppercase;font-weight:700;
  text-align:center;line-height:1.2;
}

.fxe-cd-add-row {
  display:flex;gap:5px;margin-top:8px;
}
.fxe-cd-add-block-btn {
  flex:1;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:1.5px;
  background:transparent;border:1px dashed #2a3a55;color:#88c0e0;
  padding:10px 6px;cursor:pointer;text-transform:uppercase;font-weight:700;
}
.fxe-cd-add-block-btn:hover { border-color:#00e5ff;color:#00e5ff;background:rgba(0,229,255,0.04); }

/* Окраска номера блока по типу */
.fxe-cd-block-num-text    { background:#00e5ff; color:#000; }
.fxe-cd-block-num-image   { background:#a29bfe; color:#000; }
.fxe-cd-block-num-divider { background:#55efc4; color:#000; }
.fxe-cd-block-image   { border-color:#3a2a5a; }
.fxe-cd-block-image:hover  { border-color:#a29bfe; }
.fxe-cd-block-divider { border-color:#1a3a2a; }
.fxe-cd-block-divider:hover { border-color:#55efc4; }

/* Image block thumbnail */
.fxe-cd-img-thumb-row {
  display:flex;align-items:center;gap:8px;
}
.fxe-cd-img-thumb {
  width:64px;height:64px;flex-shrink:0;
  border:1px solid #2a3a55;background:#0a0a0d;
  display:flex;align-items:center;justify-content:center;
  overflow:hidden;border-radius:3px;
}
.fxe-cd-img-thumb.empty { color:#445;font-size:24px; }
.fxe-cd-img-thumb img {
  max-width:100%;max-height:100%;object-fit:contain;
  image-rendering:auto;
}

/* ── Camera Scenes panel ────────────────── */
.fxe-cs-panel { flex:1;display:flex;flex-direction:column;overflow:hidden;background:#0a0a0a;min-height:0; }
.fxe-cs-toolbar {
  display:flex;align-items:center;gap:12px;padding:10px 16px;
  background:#111;border-bottom:1px solid #1a1a1a;flex-shrink:0;
}
.fxe-cs-toolbar-hint {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;
  color:#333;text-transform:uppercase;
}
.fxe-cs-content { flex:1;overflow:hidden; }
.fxe-cs-list {
  height:100%;overflow-y:auto;padding:14px 16px;display:grid;
  grid-template-columns:repeat(auto-fill, minmax(360px, 1fr));gap:12px;
  align-content:flex-start;
}
.fxe-cs-list::-webkit-scrollbar{width:3px}
.fxe-cs-list::-webkit-scrollbar-thumb{background:#222}
.fxe-cs-empty {
  grid-column:1/-1;
  font-family:'Space Mono',monospace;font-size:10px;color:#3a3a3a;
  text-align:center;padding:60px;letter-spacing:2px;text-transform:uppercase;
}
.fxe-cs-card {
  background:linear-gradient(160deg, #0d1018, #0a0a0e);
  border:1px solid #1a1f2a;padding:0;overflow:hidden;
  transition:border-color .15s, opacity .15s;
}
.fxe-cs-card:hover { border-color:#2a3a55; }
.fxe-cs-card.disabled { opacity:.45; }
.fxe-cs-card-head {
  display:flex;align-items:center;gap:8px;padding:9px 12px;
  background:linear-gradient(180deg, #11161f, #0c0f17);
  border-bottom:1px solid #1a1f2a;
}
.fxe-cs-en-chip {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1.5px;
  background:#0a0a0a;border:1px solid #2a2a2a;color:#555;
  padding:4px 7px;cursor:pointer;flex-shrink:0;transition:all .12s;
}
.fxe-cs-en-chip.on {
  background:#0a1a14;border-color:#00aa66;color:#00ee99;
  box-shadow:0 0 6px rgba(0,238,153,0.18);
}
.fxe-cs-name-inp {
  flex:1;background:transparent;border:1px solid transparent;color:#cce8ff;
  font-family:'Space Mono',monospace;font-size:11px;letter-spacing:1px;
  padding:4px 6px;outline:none;
}
.fxe-cs-name-inp:hover  { border-color:#1a2a3a; }
.fxe-cs-name-inp:focus  { border-color:#00e5ff;color:#00e5ff; }
.fxe-cs-rem-btn {
  font-family:'Space Mono',monospace;font-size:9px;
  background:transparent;border:1px solid #2a1a1a;color:#553333;
  padding:3px 7px;cursor:pointer;flex-shrink:0;transition:all .12s;
}
.fxe-cs-rem-btn:hover { border-color:#ff2d55;color:#ff2d55; }
.fxe-cs-row { display:flex;align-items:center;gap:8px;padding:6px 12px; }
.fxe-cs-row + .fxe-cs-row { border-top:1px solid #11161f; }
.fxe-cs-row-label {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1.5px;
  text-transform:uppercase;color:#445;width:64px;flex-shrink:0;
}
.fxe-cs-row-val {
  font-family:'Space Mono',monospace;font-size:9px;color:#00e5ff;
  min-width:40px;text-align:right;flex-shrink:0;
}
.fxe-cs-preset-sel {
  flex:1;background:#0a0a0d;border:1px solid #1a2a3a;color:#88c0d0;
  font-family:'Space Mono',monospace;font-size:9px;padding:4px 6px;cursor:pointer;outline:none;
}
.fxe-cs-preset-sel:hover  { border-color:#00e5ff;color:#00e5ff; }
.fxe-cs-preset-sel option { background:#111;color:#ccc; }

/* ── Preset header ────────────────────────── */
.fxe-cs-preset-header {
  display:flex;align-items:center;gap:10px;padding:10px 12px;
  background:linear-gradient(90deg, rgba(0,229,255,0.06), transparent);
  border-bottom:1px solid #11161f;
}
.fxe-cs-preset-icon {
  font-size:22px;flex-shrink:0;width:36px;height:36px;
  display:flex;align-items:center;justify-content:center;
  background:#0a0f18;border:1px solid #1a2a3a;border-radius:4px;
}
.fxe-cs-preset-info { flex:1; min-width:0; }
.fxe-cs-preset-name {
  font-family:'Bebas Neue',cursive;font-size:14px;letter-spacing:2px;color:#00e5ff;
  text-transform:uppercase;line-height:1;
}
.fxe-cs-preset-hint {
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:1px;color:#556677;
  text-transform:uppercase;margin-top:2px;
}
.fxe-cs-preset-toggle {
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:1px;
  background:#0a0a0a;border:1px solid #2a3a55;color:#88c0e0;
  padding:5px 8px;cursor:pointer;flex-shrink:0;transition:all .12s;
  text-transform:uppercase;
}
.fxe-cs-preset-toggle:hover { border-color:#00e5ff;color:#00e5ff; }

/* ── Preset grid (groups + buttons) ──────── */
.fxe-cs-preset-grid {
  display:flex;flex-direction:column;gap:10px;padding:10px 12px;
  background:#06080c;border-bottom:1px solid #11161f;
  max-height:340px;overflow-y:auto;
}
.fxe-cs-preset-grid::-webkit-scrollbar      { width:4px; }
.fxe-cs-preset-grid::-webkit-scrollbar-thumb{ background:#1a2a3a; border-radius:2px; }

.fxe-cs-preset-group { display:flex;flex-direction:column;gap:4px; }
.fxe-cs-preset-group-head {
  display:flex;align-items:baseline;gap:8px;
  padding:2px 0;border-bottom:1px solid #11161f;
}
.fxe-cs-preset-group-head .g-name {
  font-family:'Bebas Neue',cursive;font-size:11px;letter-spacing:3px;color:#88c0e0;
}
.fxe-cs-preset-group-head .g-desc {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;color:#334;
  text-transform:uppercase;
}
.fxe-cs-preset-buttons {
  display:grid;grid-template-columns:repeat(2, 1fr);gap:4px;padding:2px 0 4px;
}
.fxe-cs-preset-btn {
  display:flex;flex-direction:column;align-items:flex-start;gap:1px;
  padding:6px 8px;cursor:pointer;
  background:#0a0d12;border:1px solid #1a1f2a;
  font-family:'Space Mono',monospace;color:#9bb;
  text-align:left;transition:all .15s;
  min-height:46px;
}
.fxe-cs-preset-btn:hover {
  background:#0d141d;border-color:#3a5575;color:#ccc;
  transform:translateY(-1px);
}
.fxe-cs-preset-btn.active {
  background:linear-gradient(135deg, #0d2230, #102530);
  border-color:#00e5ff;color:#00e5ff;
  box-shadow:0 0 8px rgba(0,229,255,0.25), inset 0 0 4px rgba(0,229,255,0.15);
}
.fxe-cs-preset-btn .p-icon {
  font-size:13px;line-height:1;
}
.fxe-cs-preset-btn .p-label {
  font-size:9.5px;letter-spacing:0.5px;font-weight:700;line-height:1.1;
}
.fxe-cs-preset-btn .p-hint {
  font-size:7px;letter-spacing:0.5px;color:#556;
  text-transform:uppercase;line-height:1.1;
}
.fxe-cs-preset-btn.active .p-hint { color:#5a8; }
.fxe-cs-range {
  flex:1;-webkit-appearance:none;height:3px;background:#1a1f2a;
  outline:none;cursor:pointer;border-radius:1px;
}
.fxe-cs-range::-webkit-slider-thumb {
  -webkit-appearance:none;width:11px;height:11px;background:#00e5ff;
  border-radius:50%;cursor:pointer;box-shadow:0 0 5px #00e5ff;
}
.fxe-cs-range::-moz-range-thumb {
  width:11px;height:11px;background:#00e5ff;border:none;
  border-radius:50%;cursor:pointer;box-shadow:0 0 5px #00e5ff;
}
.fxe-cs-lines-row {
  padding:8px 12px;border-top:1px solid #11161f;
  background:rgba(0,229,255,0.03);
}
/* Per-scene fade controls */
.fxe-cs-section-sublabel {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:2px;
  text-transform:uppercase;color:#445;
  padding:8px 12px 4px;border-top:1px dashed #1a2a3a;margin-top:4px;
}
.fxe-cs-ease-wrap {
  display:flex;gap:3px;flex:1;
}
.fxe-cs-ease-btn {
  flex:1;
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:1px;
  background:#0a0a0d;border:1px solid #1a2a3a;color:#556;
  padding:5px 6px;cursor:pointer;transition:all .12s;
  text-transform:uppercase;
}
.fxe-cs-ease-btn:hover { border-color:#3a4a55;color:#88c0e0; }
.fxe-cs-ease-btn.on {
  background:rgba(0,229,255,0.15);border-color:#00e5ff;color:#00e5ff;
  font-weight:700;
}
.fxe-cs-fade-reset {
  display:block;width:calc(100% - 24px);margin:6px 12px 4px;
  background:transparent;border:1px dashed #2a3a55;color:#556;
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;
  text-transform:uppercase;padding:5px;cursor:pointer;transition:all .12s;
}
.fxe-cs-fade-reset:hover { border-color:#00e5ff;color:#00e5ff;background:rgba(0,229,255,0.04); }

.fxe-cs-lines-btn {
  width:100%;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:1.5px;
  background:#0d1822;border:1px solid #1a3a55;color:#88c0e0;
  padding:8px 10px;cursor:pointer;text-align:left;transition:all .12s;
}
.fxe-cs-lines-btn:hover { background:#0f2030;border-color:#00e5ff;color:#00e5ff; }
.fxe-cs-lines-btn b { color:#00e5ff;font-weight:700; }


/* LINE SELECTOR SIDE PANEL */
.fxe-line-selector-backdrop {
  position:fixed;
  inset:0;
  background:rgba(0,0,0,0.6);
  z-index:9999;
  animation:fadeIn 0.2s ease-out;
}
@keyframes fadeIn {
  from { opacity:0; }
  to { opacity:1; }
}
.fxe-line-selector-panel {
  position:fixed;
  top:0;
  right:0;
  width:min(500px, 90vw);
  height:100vh;
  background:#0d0d0d;
  border-left:2px solid #e8ff00;
  z-index:10000;
  display:flex;
  flex-direction:column;
  box-shadow:-4px 0 20px rgba(0,0,0,0.8);
  animation:slideInRight 0.2s ease-out;
}
@keyframes slideInRight {
  from { transform:translateX(100%); }
  to { transform:translateX(0); }
}
.fxe-ls-header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:16px 20px;
  background:#111;
  border-bottom:2px solid #222;
  flex-shrink:0;
}
.fxe-ls-title {
  font-family:'Bebas Neue',cursive;
  font-size:clamp(18px, 3vw, 24px);
  letter-spacing:3px;
  color:#e8ff00;
}
.fxe-ls-toolbar {
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px 20px;
  background:#0a0a0a;
  border-bottom:1px solid #1a1a1a;
  flex-shrink:0;
}
.fxe-ls-counter {
  margin-left:auto;
  font-family:'Space Mono',monospace;
  font-size:clamp(11px, 2vw, 13px);
  color:#e8ff00;
  background:rgba(232,255,0,0.1);
  padding:6px 12px;
  border-radius:4px;
  font-weight:700;
}
.fxe-ls-settings {
  padding:16px 20px;
  background:#0a0a0a;
  border-bottom:2px solid #1a1a1a;
  flex-shrink:0;
}
.fxe-ls-settings-title {
  font-family:'Space Mono',monospace;
  font-size:9px;
  letter-spacing:2px;
  text-transform:uppercase;
  color:#666;
  margin-bottom:12px;
}
.fxe-ls-hint {
  font-family:'Space Mono',monospace;
  font-size:9px;
  color:#555;
  line-height:1.5;
  margin-top:10px;
  padding:8px;
  background:#111;
  border-left:2px solid #333;
}
.fxe-ls-setting-row {
  display:flex;
  align-items:center;
  gap:12px;
  margin-bottom:10px;
}
.fxe-ls-setting-label {
  font-family:'Space Mono',monospace;
  font-size:11px;
  color:#999;
  min-width:80px;
}
.fxe-ls-setting-select {
  flex:1;
  padding:8px 10px;
  background:#111;
  border:1px solid #222;
  border-radius:4px;
  color:#e8ff00;
  font-family:'Space Mono',monospace;
  font-size:11px;
  cursor:pointer;
}
.fxe-ls-setting-select:hover {
  border-color:#e8ff00;
}
.fxe-ls-setting-select:focus {
  outline:none;
  border-color:#e8ff00;
  box-shadow:0 0 0 2px rgba(232,255,0,0.1);
}
.fxe-ls-layer-btns {
  flex:1;
  display:flex;
  gap:6px;
}
.fxe-ls-layer-btn {
  flex:1;
  padding:8px 10px;
  background:#111;
  border:1px solid #222;
  border-radius:4px;
  color:#666;
  font-family:'Space Mono',monospace;
  font-size:10px;
  cursor:pointer;
  transition:all .15s;
}
.fxe-ls-layer-btn:hover {
  border-color:#e8ff00;
  color:#e8ff00;
}
.fxe-ls-layer-btn.active {
  background:#1a1a0a;
  border-color:#e8ff00;
  color:#e8ff00;
}
.fxe-ls-list {
  flex:1;
  overflow-y:auto;
  padding:12px;
}
.fxe-ls-list::-webkit-scrollbar { width:8px; }
.fxe-ls-list::-webkit-scrollbar-track { background:#0a0a0a; }
.fxe-ls-list::-webkit-scrollbar-thumb { background:#333;border-radius:4px; }
.fxe-ls-list::-webkit-scrollbar-thumb:hover { background:#444; }

.fxe-ls-line-item {
  display:flex;
  align-items:flex-start;
  gap:12px;
  padding:12px 14px;
  margin-bottom:8px;
  background:#111;
  border:1px solid #1a1a1a;
  border-radius:4px;
  cursor:pointer;
  transition:all .15s;
}
.fxe-ls-line-item:hover {
  background:#161616;
  border-color:#333;
  transform:translateX(2px);
}
.fxe-ls-line-item.selected {
  background:#1a1a0a;
  border-color:#e8ff00;
}
.fxe-ls-line-check {
  flex-shrink:0;
  width:clamp(16px, 3vw, 20px);
  height:clamp(16px, 3vw, 20px);
  cursor:pointer;
  accent-color:#e8ff00;
  margin-top:2px;
}
.fxe-ls-line-content {
  flex:1;
  min-width:0;
}
.fxe-ls-line-time {
  font-family:'Space Mono',monospace;
  font-size:clamp(10px, 2vw, 12px);
  color:#e8ff00;
  font-weight:700;
  margin-bottom:4px;
  letter-spacing:1px;
}
.fxe-ls-line-text {
  font-family:'Space Mono',monospace;
  font-size:clamp(11px, 2.2vw, 14px);
  color:#ccc;
  line-height:1.5;
  word-wrap:break-word;
  letter-spacing:0.3px;
  margin-bottom:8px;
}
.fxe-ls-line-controls {
  display:flex;
  gap:6px;
  margin-top:8px;
  align-items:center;
}
.fxe-ls-line-anim-select {
  flex:1;
  padding:6px 8px;
  background:#0a0a0a;
  border:1px solid #222;
  border-radius:3px;
  color:#999;
  font-family:'Space Mono',monospace;
  font-size:9px;
  cursor:pointer;
  transition:all .15s;
}
.fxe-ls-line-anim-select:hover {
  border-color:#e8ff00;
  color:#e8ff00;
}
.fxe-ls-line-anim-select:focus {
  outline:none;
  border-color:#e8ff00;
  color:#e8ff00;
}
.fxe-ls-line-layer-btns {
  display:flex;
  gap:4px;
  flex-shrink:0;
}
.fxe-ls-line-layer-btn {
  width:32px;
  height:28px;
  padding:0;
  background:#0a0a0a;
  border:1px solid #222;
  border-radius:3px;
  color:#666;
  font-family:'Space Mono',monospace;
  font-size:14px;
  cursor:pointer;
  transition:all .15s;
  display:flex;
  align-items:center;
  justify-content:center;
}
.fxe-ls-line-layer-btn:hover {
  border-color:#e8ff00;
  color:#e8ff00;
}
.fxe-ls-line-layer-btn.active {
  background:#1a1a0a;
  border-color:#e8ff00;
  color:#e8ff00;
  font-weight:700;
}

/* Slider row */
.fxe-ov-slider-row {
  display:flex;align-items:center;gap:8px;flex:1;min-width:0;
}
.fxe-ov-slider-label {
  font-family:'Space Mono',monospace;font-size:7px;color:#333;
  flex-shrink:0;width:56px;text-transform:uppercase;letter-spacing:1px;
}
.fxe-ov-slider {
  flex:1;-webkit-appearance:none;height:2px;background:#1e1e1e;
  outline:none;cursor:pointer;border-radius:1px;
}
.fxe-ov-slider::-webkit-slider-thumb {
  -webkit-appearance:none;width:10px;height:10px;background:#e8ff00;border-radius:50%;cursor:pointer;
}
.fxe-ov-slider::-moz-range-thumb {
  width:10px;height:10px;background:#e8ff00;border-radius:50%;border:none;cursor:pointer;
}
.fxe-ov-val {
  font-family:'Space Mono',monospace;font-size:8px;color:#e8ff00;
  min-width:32px;text-align:right;flex-shrink:0;
}

/* Effect select */
.fxe-ov-select {
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:1px;
  background:#0a0a0a;border:1px solid #333;color:#e8ff00;padding:4px 8px;
  cursor:pointer;flex-shrink:0;
}
.fxe-ov-select option { background:#111; }

/* Remove button */
.fxe-ov-rem {
  font-family:'Space Mono',monospace;font-size:8px;padding:3px 8px;
  background:transparent;border:1px solid #2a1a1a;color:#4a2222;cursor:pointer;
  transition:all .12s;flex-shrink:0;margin-left:auto;
}
.fxe-ov-rem:hover { border-color:#cc4444;color:#ff6666; }

/* ── Collapsible cards + z-order controls ─────── */
.fxe-ov-card.collapsed .fxe-ov-card-body { display:none; }
.fxe-ov-card.collapsed .fxe-ov-card-header { border-bottom:none; }
.fxe-ov-card-header { cursor:pointer; user-select:none; }
.fxe-ov-card-header > * { cursor:default; }
.fxe-ov-card-header > button,
.fxe-ov-card-header .fxe-ov-zbtn,
.fxe-ov-card-header .fxe-ov-collapse { cursor:pointer; }

.fxe-ov-collapse {
  background:transparent;border:1px solid #222;color:#666;
  font-family:'Space Mono',monospace;font-size:10px;
  width:22px;height:22px;display:flex;align-items:center;justify-content:center;
  padding:0;flex-shrink:0;transition:all .12s;
}
.fxe-ov-collapse:hover { border-color:#e8ff00;color:#e8ff00; }

.fxe-ov-zbadge {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;
  color:#e8ff00;background:#1a1a0a;border:1px solid #3a3a10;
  padding:2px 5px;flex-shrink:0;text-transform:uppercase;
}

.fxe-ov-zctrls {
  display:flex;flex-direction:column;gap:1px;flex-shrink:0;
}
.fxe-ov-zbtn {
  font-family:'Space Mono',monospace;font-size:8px;
  background:transparent;border:1px solid #222;color:#666;
  padding:0;width:22px;height:11px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;transition:all .12s;line-height:1;
}
.fxe-ov-zbtn:hover:not(:disabled) { border-color:#e8ff00;color:#e8ff00; }
.fxe-ov-zbtn:disabled { opacity:.2;cursor:not-allowed; }

/* Box selection grid */
.fxe-ov-box-grid {
  display:flex;flex-wrap:wrap;gap:6px;
}
.fxe-ov-box-btn {
  font-family:'Space Mono',monospace;font-size:8px;letter-spacing:1px;
  padding:5px 10px;cursor:pointer;background:transparent;
  border:1px solid #222;color:#666;transition:all .12s;
  text-transform:uppercase;white-space:nowrap;
}
.fxe-ov-box-btn:hover {
  filter:brightness(1.3);
}
.fxe-ov-box-btn.active-box {
  font-weight:700;
  filter:brightness(1.5);
  box-shadow:0 0 8px currentColor;
}

/* ── Frame overlay UI ────────────────────────── */
.fxe-ov-card-frame .fxe-ov-card-header { background:#0e0e0a; }
.fxe-ov-card-frame { border-color:#2a2a18; }
.fxe-ov-card-frame.preview-selected { border-color:#d4a84b; }
.fxe-ov-frame-style-grid {
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:4px;
  margin-bottom:4px;
}
.fxe-ov-frame-style-btn {
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:2px;
  padding:5px 3px;
  background:transparent;
  border:1px solid #1e1e1e;
  color:#555;
  cursor:pointer;
  border-radius:3px;
  transition:all .12s;
  font-family:'Space Mono',monospace;
}
.fxe-ov-frame-style-btn:hover {
  border-color:#555;
  color:#ccc;
  background:#111;
}
.fxe-ov-frame-style-btn.active-frame-style {
  border-color:#d4a84b;
  color:#d4a84b;
  background:rgba(212,168,75,.08);
  box-shadow:0 0 6px rgba(212,168,75,.3);
}
.fxe-ov-frame-style-icon { font-size:14px; line-height:1; }
.fxe-ov-frame-style-label {
  font-size:7px;
  letter-spacing:.3px;
  text-transform:uppercase;
  text-align:center;
  line-height:1.1;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  width:100%;
}
.fxe-ov-frame-color-swatch {
  width:14px;
  height:14px;
  border-radius:50%;
  cursor:pointer;
  flex-shrink:0;
  transition:transform .12s;
}
.fxe-ov-frame-color-swatch:hover { transform:scale(1.3); }
`;

    document.head.appendChild(style);

    // Динамически генерируем CSS для токенов всех боксов из BoxRegistry
    if (typeof BoxRegistry !== 'undefined') {
      const dynStyle = document.createElement('style');
      dynStyle.textContent = BoxRegistry.all.map(s => {
        // Пропускаем базовые — они уже заданы в статических стилях
        const base = ['box','boxneon','boxglass','boxshadow','boxtape','boxrough'];
        if (base.includes(s.id)) return '';
        const c = s.uiColor;
        return `.fxe-tok-${s.id} { box-shadow: 0 0 0 1.5px ${c}; color: ${c}; text-shadow: 0 0 8px ${c}88; margin: 0 2px; }`;
      }).join('\n');
      document.head.appendChild(dynStyle);
    }

    // ── Bind static buttons ──────────────────────
    overlay.querySelector('#fxeSave').addEventListener('click', () => {
      const lrc = buildLRC();
      if (onSaveCb) onSaveCb(lrc);
      // Дёргаем автосейв PresetManager, чтобы объекты (оверлеи) из вкладки
      // «Объекты» тоже немедленно попали в хранилище, а не только LRC-текст.
      if (typeof PresetManager !== 'undefined' &&
          typeof PresetManager.scheduleAutosave === 'function') {
        PresetManager.scheduleAutosave();
      }
      close();
    });
    overlay.querySelector('#fxeClose').addEventListener('click', close);
    overlay.querySelector('.fxe-backdrop').addEventListener('click', close);
    overlay.querySelector('#fxeUndo').addEventListener('click', undo);
    overlay.querySelector('#fxeClearFx').addEventListener('click', clearFx);
    overlay.querySelector('#fxeAddLine').addEventListener('click', addLine);
    
    // Кнопка массового редактирования
    const bulkEditBtn = overlay.querySelector('#fxeBulkEditBtn');
    if (bulkEditBtn) {
      bulkEditBtn.addEventListener('click', () => {
        // Создаем временный overlay ID для работы с текстовыми строками
        if (!currentOverlayId) {
          // Если нет активного overlay, создаем временный
          const tempOv = {
            id: 'temp-bulk-edit',
            selectedLines: []
          };
          if (!BackgroundEngine.overlays.find(o => o.id === 'temp-bulk-edit')) {
            BackgroundEngine.overlays.push(tempOv);
          }
          openLineSelectorPanel('temp-bulk-edit');
        } else {
          openLineSelectorPanel(currentOverlayId);
        }
      });
    }

    // ── Tab switching ────────────────────────────
    const bodyEl    = overlay.querySelector('#fxeBodyText');
    const ovPanel   = overlay.querySelector('#fxeOvPanel');
    const csPanel   = overlay.querySelector('#fxeCsPanel');
    const cdPanel   = overlay.querySelector('#fxeCdPanel');
    const tabText   = overlay.querySelector('#fxeTabText');
    const tabObjs   = overlay.querySelector('#fxeTabObjects');
    const tabScenes = overlay.querySelector('#fxeTabScenes');
    const tabCards  = overlay.querySelector('#fxeTabCards');

    function switchTab(tab) {
      fxeTab = tab;
      if (tab !== 'objects' && tab !== 'cards') _stopPreviewAnim();
      bodyEl.style.display  = (tab === 'text')    ? ''     : 'none';
      ovPanel.style.display = (tab === 'objects') ? 'flex' : 'none';
      if (csPanel) csPanel.style.display = (tab === 'scenes') ? 'flex' : 'none';
      if (cdPanel) cdPanel.style.display = (tab === 'cards')  ? 'flex' : 'none';
      tabText.classList.toggle('active',   tab === 'text');
      tabObjs.classList.toggle('active',   tab === 'objects');
      if (tabScenes) tabScenes.classList.toggle('active', tab === 'scenes');
      if (tabCards)  tabCards.classList.toggle('active',  tab === 'cards');
      if (tab === 'objects') renderOverlayPanel();
      if (tab === 'scenes')  renderScenesPanel();
      if (tab === 'cards')   renderCardsPanel();
    }
    tabText.addEventListener('click',  () => switchTab('text'));
    tabObjs.addEventListener('click',  () => switchTab('objects'));
    if (tabScenes) tabScenes.addEventListener('click', () => switchTab('scenes'));
    if (tabCards)  tabCards.addEventListener('click',  () => switchTab('cards'));

    // Add scene button
    const addCsBtn = overlay.querySelector('#fxeAddCsBtn');
    if (addCsBtn) {
      addCsBtn.addEventListener('click', () => {
        BackgroundEngine.addCamScene({});
        renderScenesPanel();
      });
    }

    // Add card composition button
    const addCardBtn = overlay.querySelector('#fxeAddCardBtn');
    if (addCardBtn) {
      addCardBtn.addEventListener('click', () => {
        BackgroundEngine.registerCardOverlay();
        renderCardsPanel();
      });
    }

    // Outlines toggle (показать все блоки цветными контурами)
    const outlinesToggle = overlay.querySelector('#fxeCdOutlinesToggle');
    if (outlinesToggle) {
      outlinesToggle.addEventListener('click', () => {
        _cdShowOutlines = !_cdShowOutlines;
        outlinesToggle.classList.toggle('on', _cdShowOutlines);
      });
    }

    // Grid toggle + step selector
    const gridToggle = overlay.querySelector('#fxeCdGridToggle');
    const gridSteps  = overlay.querySelector('#fxeCdGridSteps');
    if (gridToggle) {
      gridToggle.addEventListener('click', () => {
        _cdShowGrid = !_cdShowGrid;
        gridToggle.classList.toggle('on', _cdShowGrid);
        if (gridSteps) gridSteps.style.display = _cdShowGrid ? 'flex' : 'none';
      });
    }
    if (gridSteps) {
      gridSteps.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          _cdGridStep = parseFloat(b.dataset.step) || 5;
          gridSteps.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        });
      });
      // По умолчанию — 10% (стандарт)
      const def = gridSteps.querySelector('[data-step="10"]');
      if (def) def.classList.add('on');
      _cdGridStep = 10;
    }

    // ── Add overlay file input ───────────────────
    const addOvBtn  = overlay.querySelector('#fxeAddOvBtn');
    const addOvFile = overlay.querySelector('#fxeAddOvFile');
    addOvBtn.addEventListener('click', () => addOvFile.click());
    addOvFile.addEventListener('change', async e => {
      for (const file of Array.from(e.target.files)) {
        await BackgroundEngine.registerOverlay(file);
      }
      addOvFile.value = '';
      renderOverlayPanel();
    });

    // ── Add frame overlay button ─────────────────
    const addFrameBtn = overlay.querySelector('#fxeAddFrameBtn');
    if (addFrameBtn) {
      addFrameBtn.addEventListener('click', () => {
        if (typeof BackgroundEngine.registerFrameOverlay !== 'function') {
          console.warn('[FxEditor] BackgroundEngine.registerFrameOverlay is not available');
          return;
        }
        BackgroundEngine.registerFrameOverlay();
        renderOverlayPanel();
      });
    }

    // ── Add text overlay button ──────────────────
    const addTxtBtn = overlay.querySelector('#fxeAddTxtBtn');
    if (addTxtBtn) {
      addTxtBtn.addEventListener('click', () => {
        if (typeof BackgroundEngine.registerTextOverlay !== 'function') {
          console.warn('[FxEditor] BackgroundEngine.registerTextOverlay is not available');
          return;
        }
        BackgroundEngine.registerTextOverlay('NEW TEXT');
        renderOverlayPanel();
      });
    }

    // ── Add effect overlay button ────────────────
    const addEffectBtn = overlay.querySelector('#fxeAddEffectBtn');
    if (addEffectBtn) {
      addEffectBtn.addEventListener('click', () => {
        if (typeof BackgroundEngine.registerEffectOverlay !== 'function') {
          console.warn('[FxEditor] BackgroundEngine.registerEffectOverlay is not available');
          return;
        }
        // Добавляем эффект-«дождь» по умолчанию; тип меняется в карточке
        BackgroundEngine.registerEffectOverlay('rain');
        renderOverlayPanel();
      });
    }

    // ── Line Selector Panel handlers ─────────────
    const lsClose = overlay.querySelector('#fxeLsClose');
    const lsBackdrop = overlay.querySelector('#fxeLsBackdrop');
    const lsSelectAll = overlay.querySelector('#fxeLsSelectAll');
    const lsClearAll = overlay.querySelector('#fxeLsClearAll');
    
    lsClose.addEventListener('click', closeLineSelectorPanel);
    lsBackdrop.addEventListener('click', closeLineSelectorPanel);
    
    lsSelectAll.addEventListener('click', () => {
      if (!lsTargetId) return;
      _lsUpdate({ selectedLines: lines.map((_, idx) => idx) });
      openLineSelectorPanel(lsMode, lsTargetId); // Refresh
    });

    lsClearAll.addEventListener('click', () => {
      if (!lsTargetId) return;
      _lsUpdate({ selectedLines: [] });
      openLineSelectorPanel(lsMode, lsTargetId); // Refresh
    });
    
    // Обработчик для кнопок слоя объекта
    const lsLayerAbove = overlay.querySelector('#fxeLsLayerAbove');
    const lsLayerBelow = overlay.querySelector('#fxeLsLayerBelow');
    
    if (lsLayerAbove && lsLayerBelow) {
      lsLayerAbove.addEventListener('click', () => {
        if (!currentOverlayId) return;
        BackgroundEngine.updateOverlay(currentOverlayId, { layer: 'above' });
        lsLayerAbove.classList.add('active');
        lsLayerBelow.classList.remove('active');
        renderOverlayPanel();
      });
      
      lsLayerBelow.addEventListener('click', () => {
        if (!currentOverlayId) return;
        BackgroundEngine.updateOverlay(currentOverlayId, { layer: 'below' });
        lsLayerBelow.classList.add('active');
        lsLayerAbove.classList.remove('active');
        renderOverlayPanel();
      });
      
      // Установить активную кнопку при открытии панели
      if (currentOverlayId) {
        const ov = BackgroundEngine.overlays.find(o => o.id === currentOverlayId);
        if (ov) {
          if (ov.layer === 'above') {
            lsLayerAbove.classList.add('active');
          } else if (ov.layer === 'below') {
            lsLayerBelow.classList.add('active');
          }
        }
      }
    }

    // Генерируем кнопки боксов из BoxRegistry
    const calloutGrid = overlay.querySelector('#fxeCalloutGrid');
    if (calloutGrid && typeof BoxRegistry !== 'undefined') {
      calloutGrid.innerHTML = BoxRegistry.buildButtonsHTML();
    }

    overlay.querySelectorAll('.fxe-fxbtn[data-fx], .fxe-callout-btn[data-fx], #fxeCalloutGrid button[data-fx]').forEach(btn => {
      btn.addEventListener('click', () => applyFx(btn.dataset.fx));
    });

    // Color swatches
    const colorRow = overlay.querySelector('#fxeColors');
    COLORS.forEach(c => {
      const sw = document.createElement('div');
      sw.className = 'fxe-cswatch';
      sw.style.background = c.hex;
      sw.dataset.color = c.hex;
      sw.title = c.name;
      sw.addEventListener('click', () => applyColor(c.hex, sw));
      colorRow.appendChild(sw);
    });

    overlay.addEventListener('keydown', e => {
      if ((e.ctrlKey||e.metaKey) && e.key==='z') { e.preventDefault(); undo(); }
      if (e.key==='Escape') {
        const lsPanel = overlay.querySelector('#fxeLineSelectorPanel');
        if (lsPanel.style.display === 'flex') {
          closeLineSelectorPanel();
        } else {
          close();
        }
      }
    });
  }

  /* ── Card Composition Panel Render ──────────── */
  // Композиции хранятся в общем массиве BackgroundEngine.overlays с type='card'.
  function renderCardsPanel() {
    const list = overlay.querySelector('#fxeCdList');
    if (!list) return;
    list.innerHTML = '';

    const cards = BackgroundEngine.overlays.filter(o => o.type === 'card');
    if (!cards.length) {
      const empty = document.createElement('div');
      empty.className = 'fxe-cs-empty';
      empty.innerHTML = '— нет композиций —<br><span style="opacity:.6;font-size:8px;">нажми "+ Добавить композицию", чтобы создать первую</span>';
      list.appendChild(empty);
      _renderCardPreview(null);
      return;
    }

    cards.forEach((card, idx) => {
      const cardEl = _buildCardEditor(card, idx);
      list.appendChild(cardEl);
    });

    // Превью первой развёрнутой карточки (если есть текущая выбранная)
    const expanded = cards.find(c => _expandedCardId === c.id) || cards[0];
    _renderCardPreview(expanded);
  }

  let _expandedCardId = null;

  function _buildCardEditor(card, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'fxe-cd-card' + (card.enabled ? '' : ' disabled');
    if (card.id === _expandedCardId) wrap.classList.add('expanded');

    // ── Header (свернутая шапка) ──
    const head = document.createElement('div');
    head.className = 'fxe-cd-card-head';

    const enChip = document.createElement('button');
    enChip.className = 'fxe-cs-en-chip' + (card.enabled ? ' on' : '');
    enChip.textContent = card.enabled ? '● ВКЛ' : '○ ВЫКЛ';
    enChip.title = 'Вкл / выкл композицию';
    enChip.addEventListener('click', e => {
      e.stopPropagation();
      BackgroundEngine.updateOverlay(card.id, { enabled: !card.enabled });
      renderCardsPanel();
    });
    head.appendChild(enChip);

    const nameInp = document.createElement('input');
    nameInp.className = 'fxe-cs-name-inp';
    nameInp.value = card.name || 'Композиция';
    nameInp.placeholder = 'имя композиции';
    nameInp.addEventListener('click', e => e.stopPropagation());
    nameInp.addEventListener('change', () => {
      BackgroundEngine.updateOverlay(card.id, { name: nameInp.value || `Композиция ${idx + 1}` });
    });
    head.appendChild(nameInp);

    const stylePill = document.createElement('span');
    stylePill.className = 'fxe-cd-style-pill';
    stylePill.textContent = (card.frameStyle || 'titlecard').toUpperCase();
    head.appendChild(stylePill);

    const blocksPill = document.createElement('span');
    blocksPill.className = 'fxe-cd-blocks-pill';
    blocksPill.textContent = `${(card.blocks || []).length} блок${_pluralize((card.blocks||[]).length)}`;
    head.appendChild(blocksPill);

    const remBtn = document.createElement('button');
    remBtn.className = 'fxe-cs-rem-btn';
    remBtn.textContent = '✕';
    remBtn.title = 'Удалить композицию';
    remBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`Удалить «${card.name}»?`)) return;
      BackgroundEngine.removeOverlay(card.id);
      if (_expandedCardId === card.id) _expandedCardId = null;
      renderCardsPanel();
    });
    head.appendChild(remBtn);

    head.addEventListener('click', () => {
      _expandedCardId = (_expandedCardId === card.id) ? null : card.id;
      renderCardsPanel();
    });
    wrap.appendChild(head);

    // ── Тело редактора (только если развёрнуто) ──
    if (card.id === _expandedCardId) {
      const body = document.createElement('div');
      body.className = 'fxe-cd-card-body';

      // Position + size группа (тонкие настройки за expand)
      body.appendChild(_makeCardSection('// положение и размер', () => {
        const grp = document.createElement('div');
        grp.className = 'fxe-cd-grid';
        grp.appendChild(_mkSlider(card, 'x',          'X %',         0,   100, 1,    50));
        grp.appendChild(_mkSlider(card, 'y',          'Y %',         0,   100, 1,    50));
        grp.appendChild(_mkSlider(card, 'cardW',      'Ширина %',    10,  100, 1,    60));
        grp.appendChild(_mkSlider(card, 'cardAspect', 'Аспект H/W',  0.2, 2,   0.05, 0.5625));
        // Подробнее → rotation, opacity
        const advKey = `${card.id}::pos`;
        const advOpen = _blockAdvancedOpen.has(advKey);
        const moreBtn = document.createElement('button');
        moreBtn.className = 'fxe-cd-block-more-btn';
        moreBtn.textContent = advOpen ? 'свернуть ▴' : 'поворот / прозрачность ▾';
        moreBtn.addEventListener('click', () => {
          if (_blockAdvancedOpen.has(advKey)) _blockAdvancedOpen.delete(advKey);
          else _blockAdvancedOpen.add(advKey);
          renderCardsPanel();
        });
        grp.appendChild(moreBtn);
        if (advOpen) {
          grp.appendChild(_mkSlider(card, 'cardRotation','Поворот°',     -180, 180, 1,    0));
          grp.appendChild(_mkSlider(card, 'opacity',     'Прозрачность',  0,   1,   0.05, 1));
        }
        return grp;
      }));

      // Frame: только сетка стилей + цвет; параметры/анимация — за expand
      body.appendChild(_makeCardSection('// рамка', () => {
        const cont = document.createElement('div');
        // Сетка стилей (включая 'none' = БЕЗ РАМКИ)
        const styleGrid = document.createElement('div');
        styleGrid.className = 'fxe-ov-frame-style-grid';
        const FDE = BackgroundEngine.FrameDrawEngine;
        const styles = (FDE && FDE.STYLES) || [];
        styles.forEach(s => {
          const btn = document.createElement('button');
          btn.className = 'fxe-ov-frame-style-btn' + ((card.frameStyle || 'none') === s.id ? ' active-frame-style' : '');
          btn.innerHTML = `<span class="fxe-ov-frame-style-icon">${s.icon}</span><span class="fxe-ov-frame-style-label">${s.label}</span>`;
          btn.title = s.label + (s.desc ? ` · ${s.desc}` : '');
          btn.addEventListener('click', () => {
            BackgroundEngine.updateOverlay(card.id, { frameStyle: s.id });
            renderCardsPanel();
          });
          styleGrid.appendChild(btn);
        });
        cont.appendChild(styleGrid);

        const isNone = (card.frameStyle || 'none') === 'none';
        if (isNone) return cont;   // если рамки нет — не показываем настройки

        // Цвет — единственный параметр всегда видимый
        const colorRow = document.createElement('div');
        colorRow.className = 'fxe-cd-row';
        const cLab = document.createElement('span');
        cLab.className = 'fxe-cd-row-label';
        cLab.textContent = 'Цвет';
        colorRow.appendChild(cLab);
        const cInp = document.createElement('input');
        cInp.type = 'color';
        cInp.value = card.frameColor || '#ffffff';
        cInp.className = 'fxe-cd-color-inp';
        cInp.addEventListener('change', () => {
          BackgroundEngine.updateOverlay(card.id, { frameColor: cInp.value });
          renderCardsPanel();
        });
        colorRow.appendChild(cInp);
        cont.appendChild(colorRow);

        // ── Слоты редактируемых текстов (для постер-стилей) ──
        const slotSchema = (FDE && FDE.FRAME_SLOTS_SCHEMA && FDE.FRAME_SLOTS_SCHEMA[card.frameStyle]) || null;
        if (slotSchema && slotSchema.length) {
          const slotsLab = document.createElement('div');
          slotsLab.className = 'fxe-cd-section-sublabel';
          slotsLab.textContent = '✎ тексты рамки';
          slotsLab.style.cssText = 'margin-top:10px;font-size:9px;letter-spacing:2px;color:#e8ff00;text-transform:uppercase;';
          cont.appendChild(slotsLab);

          const slotsCur = card.frameSlots || {};
          slotSchema.forEach(sl => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:6px;';
            const lab = document.createElement('label');
            lab.textContent = sl.label;
            lab.style.cssText = 'font-size:9px;color:#888;letter-spacing:0.5px;';
            row.appendChild(lab);
            const inp = document.createElement('textarea');
            inp.className = 'fxe-ov-textarea';
            inp.rows = (sl.def && sl.def.length > 40) ? 2 : 1;
            inp.placeholder = sl.def || '';
            inp.value = (slotsCur[sl.key] != null) ? slotsCur[sl.key] : '';
            inp.addEventListener('input', () => {
              const next = { ...(card.frameSlots || {}) };
              next[sl.key] = inp.value;
              BackgroundEngine.updateOverlay(card.id, { frameSlots: next });
            });
            row.appendChild(inp);
            cont.appendChild(row);
          });

          // Reset to defaults
          const resetBtn = document.createElement('button');
          resetBtn.className = 'fxe-cd-block-more-btn';
          resetBtn.textContent = '↺ сбросить все тексты';
          resetBtn.style.cssText = 'margin-top:4px;font-size:9px;';
          resetBtn.addEventListener('click', () => {
            BackgroundEngine.updateOverlay(card.id, { frameSlots: {} });
            renderCardsPanel();
          });
          cont.appendChild(resetBtn);
        }

        // Подробнее → толщина, детализация, отступ, поворот, анимация
        const advKey = `${card.id}::frame`;
        const advOpen = _blockAdvancedOpen.has(advKey);
        const moreBtn = document.createElement('button');
        moreBtn.className = 'fxe-cd-block-more-btn';
        moreBtn.textContent = advOpen ? 'свернуть ▴' : 'параметры и анимация ▾';
        moreBtn.addEventListener('click', () => {
          if (_blockAdvancedOpen.has(advKey)) _blockAdvancedOpen.delete(advKey);
          else _blockAdvancedOpen.add(advKey);
          renderCardsPanel();
        });
        cont.appendChild(moreBtn);

        if (advOpen) {
          const params = document.createElement('div');
          params.className = 'fxe-cd-grid';
          params.appendChild(_mkSlider(card, 'frameThickness', 'Толщина',    1,    10,  1, 3));
          params.appendChild(_mkSlider(card, 'frameDetail',    'Детали',     1,    12,  1, 6));
          params.appendChild(_mkSlider(card, 'framePad',       'Отступ %',   0,    25,  1, 0));
          params.appendChild(_mkSlider(card, 'frameRotation',  'Поворот°', -180, 180, 1, 0));
          cont.appendChild(params);

          // Чекбокс «Скрывать на пустых строках» — карточка прячется на технических строках
          const hideRow = document.createElement('label');
          hideRow.className = 'fxe-cd-toggle-row';
          hideRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 2px;cursor:pointer;font-size:10px;color:#bbb;user-select:none;';
          hideRow.title = 'Не показывать карточку на технических строках (только команды, без текста)';
          const hideCb = document.createElement('input');
          hideCb.type = 'checkbox';
          hideCb.className = 'fxe-ov-checkbox';
          hideCb.checked = card.hideOnEmptyLyric !== false;
          hideCb.addEventListener('change', () => {
            BackgroundEngine.updateOverlay(card.id, { hideOnEmptyLyric: hideCb.checked });
          });
          const hideTxt = document.createElement('span');
          hideTxt.textContent = 'Прятать на пустых (технических) строках';
          hideRow.appendChild(hideCb);
          hideRow.appendChild(hideTxt);
          cont.appendChild(hideRow);

          // Анимация
          const animLab = document.createElement('div');
          animLab.className = 'fxe-cd-section-sublabel';
          animLab.textContent = 'анимация';
          cont.appendChild(animLab);
          const animRow = document.createElement('div');
          animRow.className = 'fxe-cd-anim-row';
          const animModes = [
            ['none','✕ Нет'], ['pulse','⚡ Пульс'], ['breathe','🫁 Дыхание'],
            ['glitch','📡 Глитч'], ['rainbow','🌈 Радуга'], ['sparkle','✨ Мерцание'],
            ['swing','🕰 Swing'], ['rotate','🔄 Вращение'],
            ['flicker','📺 Мигание'], ['chromatic','🩻 Хром.'], ['march','🐜 Ants'],
          ];
          animModes.forEach(([val, label]) => {
            const btn = document.createElement('button');
            btn.className = 'fxe-ov-chip' + ((card.frameAnimMode || 'none') === val ? ' active-enabled' : '');
            btn.textContent = label;
            btn.style.fontSize = '8px';
            btn.addEventListener('click', () => {
              BackgroundEngine.updateOverlay(card.id, { frameAnimMode: val });
              renderCardsPanel();
            });
            animRow.appendChild(btn);
          });
          cont.appendChild(animRow);
          if ((card.frameAnimMode || 'none') !== 'none') {
            const animParams = document.createElement('div');
            animParams.className = 'fxe-cd-grid';
            animParams.appendChild(_mkSlider(card, 'frameAnimAmt',   'Сила',     0,   1, 0.05, 0.5));
            animParams.appendChild(_mkSlider(card, 'frameAnimSpeed', 'Скорость', 0.1, 3, 0.1,  1.0));
            cont.appendChild(animParams);
          }
        }
        return cont;
      }));

      // Блоки (text / image / divider) + шаблоны композиций
      body.appendChild(_makeCardSection('// блоки', () => {
        const cont = document.createElement('div');
        const blocks = card.blocks || [];
        blocks.forEach((blk, bi) => {
          const blkEl = _buildBlockEditor(card, blk, bi);
          cont.appendChild(blkEl);
        });

        // Универсальный обработчик клика по шаблону (применяет blocks + cardSettings)
        const applyTemplate = (tpl) => {
          const result = _instantiateTemplate(tpl.id);
          if (!result) return;
          if (blocks.length > 0 &&
              !confirm(`Заменить текущие ${blocks.length} блок${_pluralize(blocks.length)} на шаблон «${tpl.label}»?`)) return;
          const updates = { blocks: result.blocks };
          if (result.cardSettings) Object.assign(updates, result.cardSettings);
          BackgroundEngine.updateOverlay(card.id, updates);
          renderCardsPanel();
          // Image-блок → file picker
          const firstImg = result.blocks.find(bk => bk.kind === 'image');
          if (firstImg) {
            setTimeout(() => {
              const fileInp = overlay.querySelector(`#fxeImgFile_${firstImg.id}`);
              if (fileInp) fileInp.click();
            }, 60);
          }
        };

        // ── SCI-FI ПЛАШКИ (готовые композиции с рамкой и стилем) ──
        const sciLabel = document.createElement('div');
        sciLabel.className = 'fxe-cd-section-sublabel fxe-cd-scifi-label';
        sciLabel.textContent = '🚀 sci-fi плашки (рамка + лого + текст)';
        cont.appendChild(sciLabel);

        const sciGrid = document.createElement('div');
        sciGrid.className = 'fxe-cd-tpl-grid fxe-cd-scifi-grid';
        SCIFI_TEMPLATES.forEach(tpl => {
          const b = document.createElement('button');
          b.className = 'fxe-cd-tpl-btn fxe-cd-scifi-btn';
          b.title = tpl.hint;
          b.innerHTML = `<span class="fxe-cd-tpl-icon">${tpl.icon}</span><span class="fxe-cd-tpl-label">${tpl.label}</span>`;
          // Подсветка кнопки в цвет своей плашки для предпросмотра стиля
          const tint = tpl.cardSettings && tpl.cardSettings.frameColor;
          if (tint) {
            b.style.borderColor = tint;
            b.style.color = tint;
          }
          b.addEventListener('click', () => applyTemplate(tpl));
          sciGrid.appendChild(b);
        });
        cont.appendChild(sciGrid);

        // ── ОБЫЧНЫЕ ШАБЛОНЫ (без рамки) ──
        const tplLabel = document.createElement('div');
        tplLabel.className = 'fxe-cd-section-sublabel';
        tplLabel.textContent = '⚡ обычные шаблоны (только блоки, рамка не меняется)';
        cont.appendChild(tplLabel);

        const tplGrid = document.createElement('div');
        tplGrid.className = 'fxe-cd-tpl-grid';
        CARD_TEMPLATES.forEach(tpl => {
          const b = document.createElement('button');
          b.className = 'fxe-cd-tpl-btn';
          b.title = tpl.hint;
          b.innerHTML = `<span class="fxe-cd-tpl-icon">${tpl.icon}</span><span class="fxe-cd-tpl-label">${tpl.label}</span>`;
          b.addEventListener('click', () => applyTemplate(tpl));
          tplGrid.appendChild(b);
        });
        cont.appendChild(tplGrid);

        // ── ОТДЕЛЬНЫЕ БЛОКИ ──
        const sepLabel = document.createElement('div');
        sepLabel.className = 'fxe-cd-section-sublabel';
        sepLabel.textContent = '+ отдельный блок (добавляется к текущим)';
        cont.appendChild(sepLabel);

        const addRow = document.createElement('div');
        addRow.className = 'fxe-cd-add-row';
        const mkAdd = (label, kind) => {
          const b = document.createElement('button');
          b.className = 'fxe-cd-add-block-btn';
          b.textContent = label;
          b.addEventListener('click', () => {
            const newBlocks = [...blocks, _newDefaultBlock(kind)];
            BackgroundEngine.updateOverlay(card.id, { blocks: newBlocks });
            renderCardsPanel();
            if (kind === 'image') {
              setTimeout(() => {
                const last = newBlocks[newBlocks.length - 1];
                const fileInp = overlay.querySelector(`#fxeImgFile_${last.id}`);
                if (fileInp) fileInp.click();
              }, 50);
            }
          });
          return b;
        };
        addRow.appendChild(mkAdd('+ Текст',    'text'));
        addRow.appendChild(mkAdd('+ Картинка', 'image'));
        addRow.appendChild(mkAdd('+ Линия',    'divider'));
        cont.appendChild(addRow);
        return cont;
      }));

      // Layer / scope / lines
      body.appendChild(_makeCardSection('// показ', () => {
        const cont = document.createElement('div');
        const layerRow = document.createElement('div');
        layerRow.className = 'fxe-cd-anim-row';
        [['above','⬆ Выше текста'],['below','⬇ Ниже текста']].forEach(([val, lbl]) => {
          const b = document.createElement('button');
          b.className = 'fxe-ov-chip' + ((card.layer || 'above') === val ? ' active-enabled' : '');
          b.textContent = lbl;
          b.style.fontSize = '9px';
          b.addEventListener('click', () => {
            BackgroundEngine.updateOverlay(card.id, { layer: val });
            renderCardsPanel();
          });
          layerRow.appendChild(b);
        });
        cont.appendChild(layerRow);
        const scopeRow = document.createElement('div');
        scopeRow.className = 'fxe-cd-anim-row';
        [['global','🌐 Всегда'],['timeline','⏱ Только на выбранных строках']].forEach(([val, lbl]) => {
          const b = document.createElement('button');
          b.className = 'fxe-ov-chip' + ((card.scope || 'global') === val ? ' active-enabled' : '');
          b.textContent = lbl;
          b.style.fontSize = '9px';
          b.addEventListener('click', () => {
            BackgroundEngine.updateOverlay(card.id, { scope: val });
            renderCardsPanel();
          });
          scopeRow.appendChild(b);
        });
        cont.appendChild(scopeRow);
        if ((card.scope || 'global') === 'timeline') {
          const linesBtn = document.createElement('button');
          linesBtn.className = 'fxe-cs-lines-btn';
          linesBtn.style.marginTop = '6px';
          const cnt = (card.selectedLines || []).length;
          linesBtn.innerHTML = cnt > 0
            ? `🎯 Строк: <b>${cnt}</b> · нажми чтобы изменить`
            : `🎯 Назначить строки`;
          linesBtn.addEventListener('click', () => openLineSelectorPanel(card.id));
          cont.appendChild(linesBtn);
        }
        return cont;
      }));

      wrap.appendChild(body);
    }

    return wrap;
  }

  // ── Готовые шаблоны композиций ──
  // Каждый возвращает массив блоков с продуманным расположением, ожидает что
  // карточка имеет аспект ~0.5625 (16:9). Если image-шаблон — после вставки
  // открываем файл-пикер для первого image-блока.
  const CARD_TEMPLATES = [
    {
      id:    'logoLeft',
      icon:  '🪪',
      label: 'Лого слева',
      hint:  'картинка-логотип слева + название и слоган справа',
      build() {
        return [
          {
            kind: 'image', widthPct: 22, x: 22, y: 50,
            rotation: 0, opacity: 1, border: false,
            borderColor: '#ffffff', borderWidth: 2, cornerRadius: 4,
          },
          {
            kind: 'text', text: 'BRAND',
            font: "'Bebas Neue', cursive", sizePct: 16,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 4, x: 62, y: 42, align: 'center',
            maxWidthPct: 60, shadow: false,
            shadowColor: '#000000', shadowBlur: 8,
          },
          {
            kind: 'text', text: 'короткий слоган',
            font: "'Space Mono', monospace", sizePct: 5,
            color: '#aaaaaa', bold: false, italic: false,
            letterSpacing: 2, x: 62, y: 60, align: 'center',
            maxWidthPct: 60, shadow: false,
            shadowColor: '#000000', shadowBlur: 6,
          },
        ];
      },
    },
    {
      id:    'logoTop',
      icon:  '🎴',
      label: 'Лого сверху',
      hint:  'картинка по центру + название + подзаголовок снизу',
      build() {
        return [
          {
            kind: 'image', widthPct: 28, x: 50, y: 32,
            rotation: 0, opacity: 1, border: false,
            borderColor: '#ffffff', borderWidth: 2, cornerRadius: 4,
          },
          {
            kind: 'text', text: 'BRAND',
            font: "'Bebas Neue', cursive", sizePct: 12,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 6, x: 50, y: 65, align: 'center',
            maxWidthPct: 85, shadow: false,
            shadowColor: '#000000', shadowBlur: 8,
          },
          {
            kind: 'text', text: 'tagline',
            font: "'Space Mono', monospace", sizePct: 4,
            color: '#888888', bold: false, italic: false,
            letterSpacing: 4, x: 50, y: 80, align: 'center',
            maxWidthPct: 70, shadow: false,
            shadowColor: '#000000', shadowBlur: 6,
          },
        ];
      },
    },
    {
      id:    'titleCard',
      icon:  '📰',
      label: 'Титул',
      hint:  'крупный заголовок + разделитель + подзаголовок',
      build() {
        return [
          {
            kind: 'text', text: 'НАЗВАНИЕ',
            font: "'Bebas Neue', cursive", sizePct: 18,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 6, x: 50, y: 36, align: 'center',
            maxWidthPct: 90, shadow: false,
            shadowColor: '#000000', shadowBlur: 8,
          },
          {
            kind: 'divider', orientation: 'horizontal',
            lengthPct: 18, thickness: 2, color: '#ffffff',
            opacity: 0.8, x: 50, y: 53,
          },
          {
            kind: 'text', text: 'подзаголовок строки',
            font: "'Space Mono', monospace", sizePct: 5,
            color: '#cccccc', bold: false, italic: false,
            letterSpacing: 2, x: 50, y: 66, align: 'center',
            maxWidthPct: 80, shadow: false,
            shadowColor: '#000000', shadowBlur: 6,
          },
        ];
      },
    },
    {
      id:    'quote',
      icon:  '📜',
      label: 'Цитата',
      hint:  'курсивная цитата + разделитель + автор',
      build() {
        return [
          {
            kind: 'text', text: '«Здесь будет цитата»',
            font: "'Bebas Neue', cursive", sizePct: 11,
            color: '#ffffff', bold: false, italic: true,
            letterSpacing: 1, x: 50, y: 42, align: 'center',
            maxWidthPct: 85, shadow: false,
            shadowColor: '#000000', shadowBlur: 6,
          },
          {
            kind: 'divider', orientation: 'horizontal',
            lengthPct: 10, thickness: 1, color: '#cccccc',
            opacity: 0.55, x: 50, y: 62,
          },
          {
            kind: 'text', text: '— автор',
            font: "'Space Mono', monospace", sizePct: 4,
            color: '#aaaaaa', bold: false, italic: false,
            letterSpacing: 3, x: 50, y: 72, align: 'center',
            maxWidthPct: 60, shadow: false,
            shadowColor: '#000000', shadowBlur: 4,
          },
        ];
      },
    },
    {
      id:    'photoCaption',
      icon:  '🖼',
      label: 'Фото + подпись',
      hint:  'большая картинка + подпись под ней',
      build() {
        return [
          {
            kind: 'image', widthPct: 70, x: 50, y: 38,
            rotation: 0, opacity: 1, border: false,
            borderColor: '#ffffff', borderWidth: 2, cornerRadius: 6,
          },
          {
            kind: 'text', text: 'Подпись к изображению',
            font: "'Space Mono', monospace", sizePct: 4,
            color: '#aaaaaa', bold: false, italic: true,
            letterSpacing: 1, x: 50, y: 84, align: 'center',
            maxWidthPct: 85, shadow: false,
            shadowColor: '#000000', shadowBlur: 4,
          },
        ];
      },
    },
    {
      id:    'splitView',
      icon:  '⚔',
      label: 'Текст + Картинка',
      hint:  'текст слева, картинка справа (классическая лого-компоновка)',
      build() {
        return [
          {
            kind: 'text', text: 'TITLE',
            font: "'Bebas Neue', cursive", sizePct: 18,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 4, x: 28, y: 42, align: 'center',
            maxWidthPct: 45, shadow: false,
            shadowColor: '#000000', shadowBlur: 8,
          },
          {
            kind: 'text', text: 'описание двумя строками',
            font: "'Space Mono', monospace", sizePct: 4.5,
            color: '#bbbbbb', bold: false, italic: false,
            letterSpacing: 1, x: 28, y: 62, align: 'center',
            maxWidthPct: 45, shadow: false,
            shadowColor: '#000000', shadowBlur: 6,
          },
          {
            kind: 'divider', orientation: 'vertical',
            lengthPct: 50, thickness: 1.5, color: '#ffffff',
            opacity: 0.4, x: 50, y: 50,
          },
          {
            kind: 'image', widthPct: 30, x: 72, y: 50,
            rotation: 0, opacity: 1, border: false,
            borderColor: '#ffffff', borderWidth: 2, cornerRadius: 4,
          },
        ];
      },
    },
  ];

  // Создаёт {blocks, cardSettings} с уникальными ID для каждого блока шаблона
  function _instantiateTemplate(tplId) {
    let tpl = CARD_TEMPLATES.find(t => t.id === tplId);
    if (!tpl) tpl = SCIFI_TEMPLATES.find(t => t.id === tplId);
    if (!tpl) return null;
    const ts = Date.now();
    const blocks = tpl.build().map((b, i) => ({
      ...b,
      id: `blk_${ts}_${i}_${Math.random().toString(36).slice(2, 4)}`,
    }));
    return {
      blocks,
      cardSettings: tpl.cardSettings || null,
    };
  }

  // ── SCI-FI ПЛАШКИ ──
  // Полностью оформленные композиции: задают и frameStyle, и frameColor,
  // и расположение блоков. Дают мгновенный "профи-вид".
  const SCIFI_TEMPLATES = [
    {
      id:    'hudRecon',
      icon:  '🛡',
      label: 'HUD Recon',
      hint:  'cyan nexus + лого слева + tech-данные справа (как в Mass Effect/Cyberpunk)',
      cardSettings: {
        frameStyle: 'nexus', frameColor: '#00e5ff',
        frameThickness: 4, frameDetail: 8, framePad: 0, frameAnimMode: 'none',
        cardW: 65, cardAspect: 0.4,
      },
      build() {
        return [
          {
            kind: 'image', widthPct: 20, x: 22, y: 50,
            rotation: 0, opacity: 1,
            border: true, borderColor: '#00e5ff', borderWidth: 2,
            cornerRadius: 2,
          },
          {
            kind: 'text', text: 'RECON · 01',
            font: "'Space Mono', monospace", sizePct: 6,
            color: '#00e5ff', bold: true, italic: false,
            letterSpacing: 5, x: 62, y: 28, align: 'center',
            maxWidthPct: 60, shadow: false,
          },
          {
            kind: 'text', text: 'CIPHER',
            font: "'Bebas Neue', cursive", sizePct: 18,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 6, x: 62, y: 46, align: 'center',
            maxWidthPct: 60, shadow: false,
          },
          {
            kind: 'divider', orientation: 'horizontal',
            lengthPct: 22, thickness: 1.5, color: '#00e5ff',
            opacity: 0.75, x: 62, y: 62,
          },
          {
            kind: 'text', text: 'STATUS · ACTIVE',
            font: "'Space Mono', monospace", sizePct: 4,
            color: '#88c0e0', bold: false, italic: false,
            letterSpacing: 4, x: 62, y: 75, align: 'center',
            maxWidthPct: 60, shadow: false,
          },
        ];
      },
    },
    {
      id:    'neonDrop',
      icon:  '⚡',
      label: 'Neon Drop',
      hint:  'magenta neon + крупное лого центром + glow-имя',
      cardSettings: {
        frameStyle: 'neon', frameColor: '#ff2ad8',
        frameThickness: 3, frameDetail: 9, framePad: 0, frameAnimMode: 'sparkle',
        frameAnimAmt: 0.4, frameAnimSpeed: 1.0,
        cardW: 55, cardAspect: 0.65,
      },
      build() {
        return [
          {
            kind: 'image', widthPct: 28, x: 50, y: 32,
            rotation: 0, opacity: 1,
            border: false, borderColor: '#ff2ad8', borderWidth: 2,
            cornerRadius: 14,
          },
          {
            kind: 'text', text: 'NEON',
            font: "'Bebas Neue', cursive", sizePct: 16,
            color: '#ff2ad8', bold: true, italic: false,
            letterSpacing: 10, x: 50, y: 62, align: 'center',
            maxWidthPct: 80, shadow: true,
            shadowColor: '#ff2ad8', shadowBlur: 18,
          },
          {
            kind: 'text', text: 'release · 2087',
            font: "'Space Mono', monospace", sizePct: 4.5,
            color: '#ffffff', bold: false, italic: false,
            letterSpacing: 6, x: 50, y: 80, align: 'center',
            maxWidthPct: 70, shadow: true,
            shadowColor: '#ff2ad8', shadowBlur: 8,
          },
        ];
      },
    },
    {
      id:    'scanFrame',
      icon:  '▓',
      label: 'Scan Frame',
      hint:  'зелёная сканирующая рамка + лого + tech-метки',
      cardSettings: {
        frameStyle: 'scan', frameColor: '#55efc4',
        frameThickness: 3, frameDetail: 7, framePad: 0, frameAnimMode: 'march',
        frameAnimAmt: 0.6, frameAnimSpeed: 0.8,
        cardW: 50, cardAspect: 0.8,
      },
      build() {
        return [
          {
            kind: 'image', widthPct: 30, x: 50, y: 32,
            rotation: 0, opacity: 1,
            border: true, borderColor: '#55efc4', borderWidth: 2,
            cornerRadius: 0,
          },
          {
            kind: 'text', text: 'SCAN · 042',
            font: "'Space Mono', monospace", sizePct: 4.5,
            color: '#55efc4', bold: true, italic: false,
            letterSpacing: 6, x: 50, y: 58, align: 'center',
            maxWidthPct: 80, shadow: false,
          },
          {
            kind: 'text', text: 'CORTEX',
            font: "'Bebas Neue', cursive", sizePct: 14,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 8, x: 50, y: 72, align: 'center',
            maxWidthPct: 80, shadow: false,
          },
          {
            kind: 'divider', orientation: 'horizontal',
            lengthPct: 18, thickness: 1, color: '#55efc4',
            opacity: 0.55, x: 50, y: 86,
          },
          {
            kind: 'text', text: 'lvl ▰▰▰▱▱',
            font: "'Space Mono', monospace", sizePct: 3.5,
            color: '#88e0a8', bold: false, italic: false,
            letterSpacing: 3, x: 50, y: 92, align: 'center',
            maxWidthPct: 80, shadow: false,
          },
        ];
      },
    },
    {
      id:    'targetIntel',
      icon:  '▲',
      label: 'Target Intel',
      hint:  'жёлтые угловые brackets + цель/имя/статус',
      cardSettings: {
        frameStyle: 'brackets', frameColor: '#e8ff00',
        frameThickness: 4, frameDetail: 8, framePad: 0, frameAnimMode: 'none',
        cardW: 60, cardAspect: 0.5,
      },
      build() {
        return [
          {
            kind: 'text', text: '▲ TARGET',
            font: "'Space Mono', monospace", sizePct: 5,
            color: '#e8ff00', bold: true, italic: false,
            letterSpacing: 8, x: 50, y: 22, align: 'center',
            maxWidthPct: 80, shadow: false,
          },
          {
            kind: 'image', widthPct: 20, x: 25, y: 56,
            rotation: 0, opacity: 1,
            border: true, borderColor: '#e8ff00', borderWidth: 2,
            cornerRadius: 0,
          },
          {
            kind: 'text', text: 'CODENAME',
            font: "'Bebas Neue', cursive", sizePct: 16,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 5, x: 62, y: 46, align: 'center',
            maxWidthPct: 55, shadow: false,
          },
          {
            kind: 'divider', orientation: 'horizontal',
            lengthPct: 30, thickness: 1.5, color: '#e8ff00',
            opacity: 0.7, x: 62, y: 62,
          },
          {
            kind: 'text', text: 'CLEARANCE · 7',
            font: "'Space Mono', monospace", sizePct: 4,
            color: '#aaa888', bold: false, italic: false,
            letterSpacing: 5, x: 62, y: 74, align: 'center',
            maxWidthPct: 60, shadow: false,
          },
        ];
      },
    },
    {
      id:    'vhsFile',
      icon:  '📡',
      label: 'VHS File',
      hint:  'ретро-эстетика VHS + красный REC + лого + данные',
      cardSettings: {
        frameStyle: 'vhs', frameColor: '#e8e8e8',
        frameThickness: 3, frameDetail: 8, framePad: 0, frameAnimMode: 'flicker',
        frameAnimAmt: 0.3, frameAnimSpeed: 0.7,
        cardW: 65, cardAspect: 0.45,
      },
      build() {
        return [
          {
            kind: 'image', widthPct: 22, x: 26, y: 50,
            rotation: 0, opacity: 1,
            border: false, borderColor: '#ffffff', borderWidth: 1,
            cornerRadius: 2,
          },
          {
            kind: 'text', text: '● REC',
            font: "'Space Mono', monospace", sizePct: 5,
            color: '#ff2030', bold: true, italic: false,
            letterSpacing: 4, x: 62, y: 28, align: 'center',
            maxWidthPct: 50, shadow: false,
          },
          {
            kind: 'text', text: 'TAPE 087',
            font: "'Bebas Neue', cursive", sizePct: 14,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 6, x: 62, y: 48, align: 'center',
            maxWidthPct: 60, shadow: false,
          },
          {
            kind: 'divider', orientation: 'horizontal',
            lengthPct: 26, thickness: 1, color: '#ffffff',
            opacity: 0.55, x: 62, y: 64,
          },
          {
            kind: 'text', text: 'archive · 1987',
            font: "'Space Mono', monospace", sizePct: 4,
            color: '#cccccc', bold: false, italic: false,
            letterSpacing: 4, x: 62, y: 76, align: 'center',
            maxWidthPct: 60, shadow: false,
          },
        ];
      },
    },
    {
      id:    'splitData',
      icon:  '◧',
      label: 'Split Data',
      hint:  'двусторонняя панель: лого + статус слева, данные справа',
      cardSettings: {
        frameStyle: 'titlecard', frameColor: '#00e5ff',
        frameThickness: 4, frameDetail: 7, framePad: 0, frameAnimMode: 'none',
        cardW: 70, cardAspect: 0.42,
      },
      build() {
        return [
          {
            kind: 'image', widthPct: 18, x: 22, y: 50,
            rotation: 0, opacity: 1,
            border: true, borderColor: '#00e5ff', borderWidth: 2,
            cornerRadius: 4,
          },
          {
            kind: 'text', text: 'ID · 01',
            font: "'Space Mono', monospace", sizePct: 4,
            color: '#00e5ff', bold: true, italic: false,
            letterSpacing: 4, x: 22, y: 80, align: 'center',
            maxWidthPct: 30, shadow: false,
          },
          {
            kind: 'divider', orientation: 'vertical',
            lengthPct: 55, thickness: 1, color: '#00e5ff',
            opacity: 0.4, x: 42, y: 50,
          },
          {
            kind: 'text', text: 'OPERATIVE',
            font: "'Space Mono', monospace", sizePct: 4,
            color: '#88c0e0', bold: false, italic: false,
            letterSpacing: 6, x: 70, y: 30, align: 'center',
            maxWidthPct: 55, shadow: false,
          },
          {
            kind: 'text', text: 'NOVA',
            font: "'Bebas Neue', cursive", sizePct: 20,
            color: '#ffffff', bold: true, italic: false,
            letterSpacing: 8, x: 70, y: 52, align: 'center',
            maxWidthPct: 55, shadow: false,
          },
          {
            kind: 'divider', orientation: 'horizontal',
            lengthPct: 18, thickness: 1.5, color: '#00e5ff',
            opacity: 0.6, x: 70, y: 74,
          },
          {
            kind: 'text', text: 'rank · agent',
            font: "'Space Mono', monospace", sizePct: 3.5,
            color: '#88c0e0', bold: false, italic: false,
            letterSpacing: 5, x: 70, y: 84, align: 'center',
            maxWidthPct: 55, shadow: false,
          },
        ];
      },
    },
  ];

  function _newDefaultBlock(kind = 'text') {
    const id = `blk_${Date.now()}_${Math.random().toString(36).slice(2,4)}`;
    if (kind === 'image') {
      return {
        id, kind: 'image',
        // imgData (base64) и img (HTMLImageElement) добавляются при загрузке
        widthPct:     30,
        x:            50, y: 50,
        rotation:     0,
        opacity:      1,
        border:       false,
        borderColor:  '#ffffff',
        borderWidth:  2,
        cornerRadius: 0,
      };
    }
    if (kind === 'divider') {
      return {
        id, kind: 'divider',
        orientation: 'horizontal',
        lengthPct:   60,
        thickness:   2,
        color:       '#ffffff',
        opacity:     1,
        x:           50, y: 50,
      };
    }
    // text (default)
    return {
      id, kind: 'text',
      text: 'Новый текст',
      font: "'Bebas Neue', cursive",
      sizePct: 8,
      color: '#ffffff',
      bold: false,
      italic: false,
      letterSpacing: 0,
      x: 50, y: 50,
      align: 'center',
      maxWidthPct: 90,
      shadow: false,
      shadowColor: '#000000',
      shadowBlur: 8,
    };
  }

  // Какие блоки развёрнуты в "Подробнее"
  const _blockAdvancedOpen = new Set();

  function _buildBlockEditor(card, blk, idx) {
    const blocks = card.blocks || [];
    const kind = blk.kind || 'text';
    const wrap = document.createElement('div');
    wrap.className = 'fxe-cd-block' + ` fxe-cd-block-${kind}`;

    // ── Шапка: номер + тип + превью + кнопки управления ──
    const head = document.createElement('div');
    head.className = 'fxe-cd-block-head';
    const lbl = document.createElement('span');
    lbl.className = 'fxe-cd-block-num fxe-cd-block-num-' + kind;
    const kindIcon = kind === 'image' ? '🖼' : kind === 'divider' ? '─' : 'T';
    lbl.textContent = `${kindIcon}${idx + 1}`;
    head.appendChild(lbl);
    // Превью
    const prev = document.createElement('span');
    prev.className = 'fxe-cd-block-preview';
    if (kind === 'image') {
      prev.textContent = blk.imgData ? `картинка ${blk.widthPct ?? 30}%` : 'не загружена';
    } else if (kind === 'divider') {
      prev.textContent = `линия ${blk.orientation === 'vertical' ? 'верт.' : 'гор.'} ${blk.lengthPct ?? 50}%`;
    } else {
      prev.textContent = (blk.text || '').split('\n')[0].slice(0, 28) || '—';
    }
    head.appendChild(prev);

    const updBtn = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'fxe-cd-block-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    head.appendChild(updBtn('▲', 'Выше', () => {
      if (idx === 0) return;
      const newBlocks = [...blocks];
      [newBlocks[idx-1], newBlocks[idx]] = [newBlocks[idx], newBlocks[idx-1]];
      BackgroundEngine.updateOverlay(card.id, { blocks: newBlocks });
      renderCardsPanel();
    }));
    head.appendChild(updBtn('▼', 'Ниже', () => {
      if (idx === blocks.length - 1) return;
      const newBlocks = [...blocks];
      [newBlocks[idx+1], newBlocks[idx]] = [newBlocks[idx], newBlocks[idx+1]];
      BackgroundEngine.updateOverlay(card.id, { blocks: newBlocks });
      renderCardsPanel();
    }));
    head.appendChild(updBtn('⧉', 'Дублировать', () => {
      const dup = JSON.parse(JSON.stringify(blk));
      dup.id = `blk_${Date.now()}_${Math.random().toString(36).slice(2,4)}`;
      const newBlocks = [...blocks.slice(0, idx + 1), dup, ...blocks.slice(idx + 1)];
      BackgroundEngine.updateOverlay(card.id, { blocks: newBlocks });
      renderCardsPanel();
    }));
    head.appendChild(updBtn('✕', 'Удалить', () => {
      const newBlocks = blocks.filter((_, i) => i !== idx);
      BackgroundEngine.updateOverlay(card.id, { blocks: newBlocks });
      renderCardsPanel();
    }));
    wrap.appendChild(head);

    // ════════════════════════════════════════════════
    // ДИСПЕТЧЕР по типу блока: image / divider / text
    // ════════════════════════════════════════════════
    if (kind === 'image') {
      _buildImageBlockBody(wrap, card, blk, idx);
      return wrap;
    }
    if (kind === 'divider') {
      _buildDividerBlockBody(wrap, card, blk, idx);
      return wrap;
    }
    // ── text (по умолчанию) ──

    // ── БОЛЬШОЕ ТЕКСТОВОЕ ПОЛЕ ──
    const txt = document.createElement('textarea');
    txt.className = 'fxe-cd-block-text';
    txt.value = blk.text || '';
    txt.rows = Math.max(2, Math.min(5, (blk.text || '').split('\n').length + 1));
    txt.placeholder = 'Текст… (Enter — новая строка)';
    txt.addEventListener('input', () => {
      _updateBlockField(card, idx, 'text', txt.value);
      prev.textContent = (txt.value || '').split('\n')[0].slice(0, 28) || '—';
    });
    wrap.appendChild(txt);

    // ── РЯД 1: шрифт + размер +/- + цвет ──
    const row1 = document.createElement('div');
    row1.className = 'fxe-cd-block-main-row';

    const fontSel = document.createElement('select');
    fontSel.className = 'fxe-cd-block-font';
    FONT_OPTIONS.filter(o => o.value).forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === blk.font) o.selected = true;
      fontSel.appendChild(o);
    });
    fontSel.addEventListener('change', () => {
      _updateBlockField(card, idx, 'font', fontSel.value);
    });
    row1.appendChild(fontSel);

    // Size +/- стиль вместо слайдера
    const sizeBox = document.createElement('div');
    sizeBox.className = 'fxe-cd-step-box';
    const sizeMinus = document.createElement('button');
    sizeMinus.className = 'fxe-cd-step-btn';
    sizeMinus.textContent = '−';
    const sizeVal = document.createElement('input');
    sizeVal.className = 'fxe-cd-step-val';
    sizeVal.type = 'number';
    sizeVal.min = 1; sizeVal.max = 80; sizeVal.step = 0.5;
    sizeVal.value = blk.sizePct ?? 8;
    const sizePlus = document.createElement('button');
    sizePlus.className = 'fxe-cd-step-btn';
    sizePlus.textContent = '+';
    sizeMinus.addEventListener('click', () => {
      const v = Math.max(1, parseFloat(sizeVal.value) - 1);
      sizeVal.value = v;
      _updateBlockField(card, idx, 'sizePct', v);
    });
    sizePlus.addEventListener('click', () => {
      const v = Math.min(80, parseFloat(sizeVal.value) + 1);
      sizeVal.value = v;
      _updateBlockField(card, idx, 'sizePct', v);
    });
    sizeVal.addEventListener('change', () => {
      const v = Math.max(1, Math.min(80, parseFloat(sizeVal.value) || 8));
      sizeVal.value = v;
      _updateBlockField(card, idx, 'sizePct', v);
    });
    sizeBox.appendChild(sizeMinus);
    sizeBox.appendChild(sizeVal);
    sizeBox.appendChild(sizePlus);
    row1.appendChild(sizeBox);

    const colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.value = blk.color || '#ffffff';
    colorInp.className = 'fxe-cd-block-color';
    colorInp.title = 'Цвет текста';
    colorInp.addEventListener('change', () => {
      _updateBlockField(card, idx, 'color', colorInp.value);
    });
    row1.appendChild(colorInp);
    wrap.appendChild(row1);

    // ── РЯД 2: B I + 3 align + shadow toggle ──
    const row2 = document.createElement('div');
    row2.className = 'fxe-cd-block-main-row';
    const mkToggle = (label, key, title) => {
      const b = document.createElement('button');
      b.className = 'fxe-cd-block-tog' + (blk[key] ? ' on' : '');
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener('click', () => {
        _updateBlockField(card, idx, key, !blk[key]);
      });
      return b;
    };
    row2.appendChild(mkToggle('B', 'bold', 'Жирный'));
    row2.appendChild(mkToggle('I', 'italic', 'Курсив'));
    row2.appendChild(mkToggle('S', 'shadow', 'Тень'));
    // separator
    const sep = document.createElement('div');
    sep.className = 'fxe-cd-block-sep';
    row2.appendChild(sep);
    // Align
    [['left','◀'], ['center','■'], ['right','▶']].forEach(([al, sym]) => {
      const b = document.createElement('button');
      b.className = 'fxe-cd-block-tog' + (blk.align === al ? ' on' : '');
      b.textContent = sym;
      b.title = `Выравнивание: ${al}`;
      b.addEventListener('click', () => {
        _updateBlockField(card, idx, 'align', al);
      });
      row2.appendChild(b);
    });
    wrap.appendChild(row2);

    // ── ПОДРОБНЕЕ ▾ (раскрывается по клику) ──
    const advKey = `${card.id}::${blk.id}`;
    const advOpen = _blockAdvancedOpen.has(advKey);

    const moreBtn = document.createElement('button');
    moreBtn.className = 'fxe-cd-block-more-btn';
    moreBtn.textContent = advOpen ? 'свернуть ▴' : 'тонкие настройки ▾';
    moreBtn.addEventListener('click', () => {
      if (_blockAdvancedOpen.has(advKey)) _blockAdvancedOpen.delete(advKey);
      else _blockAdvancedOpen.add(advKey);
      renderCardsPanel();
    });
    wrap.appendChild(moreBtn);

    if (advOpen) {
      const adv = document.createElement('div');
      adv.className = 'fxe-cd-block-adv';
      adv.appendChild(_mkBlockSlider(card, idx, 'x',             'X %',          0,   100, 1));
      adv.appendChild(_mkBlockSlider(card, idx, 'y',             'Y %',          0,   100, 1));
      adv.appendChild(_mkBlockSlider(card, idx, 'maxWidthPct',   'Ширина %',     10,  100, 1));
      adv.appendChild(_mkBlockSlider(card, idx, 'letterSpacing', 'Трекинг',     -2,   30,  0.5));
      if (blk.shadow) {
        adv.appendChild(_mkBlockSlider(card, idx, 'shadowBlur',  'Блюр тени',    0,   40,  1));
      }
      wrap.appendChild(adv);
    }

    return wrap;
  }

  // ════════════════════════════════════════════════
  // Image block editor
  // ════════════════════════════════════════════════
  function _buildImageBlockBody(wrap, card, blk, idx) {
    // Скрытый file input
    const fileInp = document.createElement('input');
    fileInp.type = 'file';
    fileInp.accept = 'image/*';
    fileInp.id = `fxeImgFile_${blk.id}`;
    fileInp.style.display = 'none';
    fileInp.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await BackgroundEngine.setCardBlockImage(card.id, blk.id, file);
      renderCardsPanel();
    });
    wrap.appendChild(fileInp);

    // Preview thumbnail + upload button
    const thumbRow = document.createElement('div');
    thumbRow.className = 'fxe-cd-img-thumb-row';
    const thumb = document.createElement('div');
    thumb.className = 'fxe-cd-img-thumb';
    if (blk.imgData) {
      const img = document.createElement('img');
      img.src = blk.imgData;
      thumb.appendChild(img);
    } else {
      thumb.classList.add('empty');
      thumb.textContent = '🖼';
    }
    thumbRow.appendChild(thumb);

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'fxe-cd-add-block-btn';
    uploadBtn.style.flex = '1';
    uploadBtn.style.marginBottom = '0';
    uploadBtn.textContent = blk.imgData ? '↻ Заменить картинку' : '↑ Загрузить картинку';
    uploadBtn.addEventListener('click', () => fileInp.click());
    thumbRow.appendChild(uploadBtn);
    wrap.appendChild(thumbRow);

    // Размер + opacity на одной строке
    const sizeRow = document.createElement('div');
    sizeRow.className = 'fxe-cd-grid';
    sizeRow.appendChild(_mkBlockSlider(card, idx, 'widthPct', 'Ширина %', 5, 100, 1));
    sizeRow.appendChild(_mkBlockSlider(card, idx, 'opacity', 'Прозрачн.', 0, 1, 0.05));
    sizeRow.appendChild(_mkBlockSlider(card, idx, 'rotation', 'Поворот°', -180, 180, 1));
    sizeRow.appendChild(_mkBlockSlider(card, idx, 'cornerRadius', 'Скругл.', 0, 80, 1));
    wrap.appendChild(sizeRow);

    // Граница (checkbox + цвет + толщина)
    const borderRow = document.createElement('div');
    borderRow.className = 'fxe-cd-block-main-row';
    const borderTog = document.createElement('button');
    borderTog.className = 'fxe-cd-block-tog' + (blk.border ? ' on' : '');
    borderTog.textContent = '◧ Рамка';
    borderTog.addEventListener('click', () => {
      _updateBlockField(card, idx, 'border', !blk.border);
    });
    borderRow.appendChild(borderTog);
    if (blk.border) {
      const colorInp = document.createElement('input');
      colorInp.type = 'color';
      colorInp.value = blk.borderColor || '#ffffff';
      colorInp.className = 'fxe-cd-block-color';
      colorInp.title = 'Цвет рамки';
      colorInp.addEventListener('change', () => {
        _updateBlockField(card, idx, 'borderColor', colorInp.value);
      });
      borderRow.appendChild(colorInp);
      // толщина — компактный +/-
      const tBox = document.createElement('div');
      tBox.className = 'fxe-cd-step-box';
      const minus = document.createElement('button');
      minus.className = 'fxe-cd-step-btn'; minus.textContent = '−';
      const val = document.createElement('input');
      val.className = 'fxe-cd-step-val'; val.type = 'number';
      val.min = 1; val.max = 20; val.value = blk.borderWidth ?? 2;
      const plus = document.createElement('button');
      plus.className = 'fxe-cd-step-btn'; plus.textContent = '+';
      minus.addEventListener('click', () => {
        const v = Math.max(1, parseFloat(val.value) - 1);
        val.value = v; _updateBlockField(card, idx, 'borderWidth', v);
      });
      plus.addEventListener('click', () => {
        const v = Math.min(20, parseFloat(val.value) + 1);
        val.value = v; _updateBlockField(card, idx, 'borderWidth', v);
      });
      val.addEventListener('change', () => {
        _updateBlockField(card, idx, 'borderWidth', Math.max(1, Math.min(20, parseFloat(val.value) || 2)));
      });
      tBox.appendChild(minus); tBox.appendChild(val); tBox.appendChild(plus);
      borderRow.appendChild(tBox);
    }
    wrap.appendChild(borderRow);

    // Подробнее ▾ для X/Y
    const advKey = `${card.id}::${blk.id}`;
    const advOpen = _blockAdvancedOpen.has(advKey);
    const moreBtn = document.createElement('button');
    moreBtn.className = 'fxe-cd-block-more-btn';
    moreBtn.textContent = advOpen ? 'свернуть ▴' : 'позиция X / Y ▾';
    moreBtn.addEventListener('click', () => {
      if (_blockAdvancedOpen.has(advKey)) _blockAdvancedOpen.delete(advKey);
      else _blockAdvancedOpen.add(advKey);
      renderCardsPanel();
    });
    wrap.appendChild(moreBtn);
    if (advOpen) {
      const adv = document.createElement('div');
      adv.className = 'fxe-cd-block-adv';
      adv.appendChild(_mkBlockSlider(card, idx, 'x', 'X %', 0, 100, 1));
      adv.appendChild(_mkBlockSlider(card, idx, 'y', 'Y %', 0, 100, 1));
      wrap.appendChild(adv);
    }
  }

  // ════════════════════════════════════════════════
  // Divider block editor
  // ════════════════════════════════════════════════
  function _buildDividerBlockBody(wrap, card, blk, idx) {
    // Ориентация
    const orientRow = document.createElement('div');
    orientRow.className = 'fxe-cd-block-main-row';
    [['horizontal','— Горизонт'], ['vertical','│ Вертикал.']].forEach(([val, lbl]) => {
      const b = document.createElement('button');
      b.className = 'fxe-cd-block-tog' + ((blk.orientation || 'horizontal') === val ? ' on' : '');
      b.textContent = lbl;
      b.addEventListener('click', () => {
        _updateBlockField(card, idx, 'orientation', val);
      });
      orientRow.appendChild(b);
    });
    // Цвет
    const colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.value = blk.color || '#ffffff';
    colorInp.className = 'fxe-cd-block-color';
    colorInp.title = 'Цвет линии';
    colorInp.addEventListener('change', () => {
      _updateBlockField(card, idx, 'color', colorInp.value);
    });
    orientRow.appendChild(colorInp);
    wrap.appendChild(orientRow);

    // Длина / толщина / прозрачность
    const sliderGrid = document.createElement('div');
    sliderGrid.className = 'fxe-cd-grid';
    sliderGrid.appendChild(_mkBlockSlider(card, idx, 'lengthPct', 'Длина %',   5,   100, 1));
    sliderGrid.appendChild(_mkBlockSlider(card, idx, 'thickness', 'Толщина',  1,   30,  0.5));
    sliderGrid.appendChild(_mkBlockSlider(card, idx, 'opacity',   'Прозрач.', 0,   1,   0.05));
    wrap.appendChild(sliderGrid);

    // Подробнее ▾ для X/Y
    const advKey = `${card.id}::${blk.id}`;
    const advOpen = _blockAdvancedOpen.has(advKey);
    const moreBtn = document.createElement('button');
    moreBtn.className = 'fxe-cd-block-more-btn';
    moreBtn.textContent = advOpen ? 'свернуть ▴' : 'позиция X / Y ▾';
    moreBtn.addEventListener('click', () => {
      if (_blockAdvancedOpen.has(advKey)) _blockAdvancedOpen.delete(advKey);
      else _blockAdvancedOpen.add(advKey);
      renderCardsPanel();
    });
    wrap.appendChild(moreBtn);
    if (advOpen) {
      const adv = document.createElement('div');
      adv.className = 'fxe-cd-block-adv';
      adv.appendChild(_mkBlockSlider(card, idx, 'x', 'X %', 0, 100, 1));
      adv.appendChild(_mkBlockSlider(card, idx, 'y', 'Y %', 0, 100, 1));
      wrap.appendChild(adv);
    }
  }

  function _updateBlockField(card, blockIdx, key, val) {
    const blocks = (card.blocks || []).map((b, i) =>
      i === blockIdx ? { ...b, [key]: val } : b
    );
    BackgroundEngine.updateOverlay(card.id, { blocks });
    // Не делаем full re-render для текстового ввода — только превью обновим
    if (key === 'text' || key === 'color' || key === 'font' || key === 'shadowBlur') {
      _renderCardPreview(BackgroundEngine.overlays.find(o => o.id === card.id));
      _refreshCardHeadPills(card.id);
    } else {
      renderCardsPanel();
    }
  }

  function _refreshCardHeadPills(cardId) {
    const card = BackgroundEngine.overlays.find(o => o.id === cardId);
    if (!card) return;
    // (no-op, шапки уже рендерятся при renderCardsPanel)
  }

  function _makeCardSection(label, builder) {
    const sec = document.createElement('div');
    sec.className = 'fxe-cd-section';
    const lbl = document.createElement('div');
    lbl.className = 'fxe-cd-section-label';
    lbl.textContent = label;
    sec.appendChild(lbl);
    sec.appendChild(builder());
    return sec;
  }

  function _mkSlider(card, key, lbl, min, max, step, def) {
    const row = document.createElement('div');
    row.className = 'fxe-cd-row';
    const l = document.createElement('span');
    l.className = 'fxe-cd-row-label';
    l.textContent = lbl;
    row.appendChild(l);
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min; inp.max = max; inp.step = step;
    inp.value = card[key] != null ? card[key] : def;
    inp.className = 'fxe-cd-range';
    const val = document.createElement('span');
    val.className = 'fxe-cd-row-val';
    const fmt = v => step >= 1 ? Math.round(v) : parseFloat(v).toFixed(2);
    val.textContent = fmt(inp.value);
    inp.addEventListener('input', () => {
      val.textContent = fmt(inp.value);
      BackgroundEngine.updateOverlay(card.id, { [key]: parseFloat(inp.value) });
      _renderCardPreview(BackgroundEngine.overlays.find(o => o.id === card.id));
    });
    row.appendChild(inp);
    row.appendChild(val);
    return row;
  }

  function _mkBlockSlider(card, blockIdx, key, lbl, min, max, step) {
    const row = document.createElement('div');
    row.className = 'fxe-cd-row';
    const l = document.createElement('span');
    l.className = 'fxe-cd-row-label';
    l.textContent = lbl;
    row.appendChild(l);
    const blk = (card.blocks || [])[blockIdx] || {};
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min; inp.max = max; inp.step = step;
    inp.value = blk[key] != null ? blk[key] : 0;
    inp.className = 'fxe-cd-range';
    const val = document.createElement('span');
    val.className = 'fxe-cd-row-val';
    const fmt = v => step >= 1 ? Math.round(v) : parseFloat(v).toFixed(2);
    val.textContent = fmt(inp.value);
    inp.addEventListener('input', () => {
      val.textContent = fmt(inp.value);
      const blocks = (card.blocks || []).map((b, i) =>
        i === blockIdx ? { ...b, [key]: parseFloat(inp.value) } : b
      );
      BackgroundEngine.updateOverlay(card.id, { blocks });
      _renderCardPreview(BackgroundEngine.overlays.find(o => o.id === card.id));
    });
    row.appendChild(inp);
    row.appendChild(val);
    return row;
  }

  function _pluralize(n) {
    if (n === 1) return '';
    if (n >= 2 && n <= 4) return 'а';
    return 'ов';
  }

  // Превью одной карточки на собственном canvas + interactive drag блоков
  let _cdPreviewRaf = null;
  let _cdPreviewCard = null;       // активная карточка показанная в превью
  let _cdSelectedBlockIdx = -1;    // выделенный блок (для подсветки)
  let _cdDragState = null;         // {blockIdx, mouseStartX, mouseStartY, blockStartX, blockStartY}
  let _cdHoverBlockIdx = -1;
  let _cdDragMode = 'block';       // 'block' | 'card'
  let _cdShowGrid = false;         // показывать ли сетку (вкл = и snap включён)
  let _cdGridStep = 5;             // шаг сетки в % (5 / 10 / 20)
  let _cdShowOutlines = false;     // показывать контуры всех блоков с номерами

  function _snapPct(v) {
    if (!_cdShowGrid) return v;
    const step = _cdGridStep || 5;
    return Math.round(v / step) * step;
  }

  // ── Offscreen canvas для измерения текста (singleton) ──
  let _cdMeasureCanvas = null;
  function _cdGetMeasureCtx() {
    if (!_cdMeasureCanvas) {
      _cdMeasureCanvas = document.createElement('canvas');
      _cdMeasureCanvas.width = 1; _cdMeasureCanvas.height = 1;
    }
    return _cdMeasureCanvas.getContext('2d');
  }

  // ── Точная hit-bbox для блока (используется и для hit-теста, и для контуров) ──
  // Возвращает { halfW, halfH } в пикселях относительно центра блока.
  function _cdBlockHitBox(blk, cardW, cardH) {
    const kind = blk.kind || 'text';
    if (kind === 'image') {
      const widthPx = Math.max(2, (blk.widthPct || 30) / 100 * cardW);
      // Высота из реальной картинки если загружена, иначе квадрат
      let aspect = 1;
      if (blk.img && blk.img.naturalWidth && blk.img.naturalHeight) {
        aspect = blk.img.naturalWidth / blk.img.naturalHeight;
      }
      const heightPx = widthPx / aspect;
      return { halfW: widthPx / 2, halfH: heightPx / 2 };
    }
    if (kind === 'divider') {
      const isHorz = (blk.orientation || 'horizontal') === 'horizontal';
      const lengthPx = (blk.lengthPct || 50) / 100 * (isHorz ? cardW : cardH);
      const thickness = Math.max(1, blk.thickness || 2);
      // Минимальная hit-зона для удобства клика по тонкой линии
      const minHit = 12;
      if (isHorz) return { halfW: lengthPx / 2, halfH: Math.max(minHit / 2, thickness / 2) };
      return { halfW: Math.max(minHit / 2, thickness / 2), halfH: lengthPx / 2 };
    }
    // text — измеряем реальную ширину
    const text = String(blk.text || '');
    if (!text) return { halfW: 30, halfH: 16 };
    const ctx = _cdGetMeasureCtx();
    const fontPx = Math.max(4, (blk.sizePct || 6) / 100 * cardH);
    const weight = blk.bold ? '700' : '400';
    const style  = blk.italic ? 'italic' : 'normal';
    const font   = blk.font || "'Bebas Neue', cursive";
    ctx.font = `${style} ${weight} ${fontPx}px ${font}`;
    const lines = text.split('\n');
    let maxLineW = 0;
    lines.forEach(l => {
      const w = ctx.measureText(l).width;
      if (w > maxLineW) maxLineW = w;
    });
    // Прибавляем letter-spacing (приблизительно — кол-во символов × spacing)
    const ls = blk.letterSpacing || 0;
    if (ls > 0) {
      const maxChars = Math.max(...lines.map(l => l.length));
      maxLineW += ls * Math.max(0, maxChars - 1);
    }
    // Cap на maxWidthPct (учитывая возможный word-wrap)
    const maxW = (blk.maxWidthPct || 90) / 100 * cardW;
    const actualW = Math.min(maxLineW + fontPx * 0.2, maxW);
    const lineGap = fontPx * 1.18;
    const totalH  = lineGap * lines.length;
    return {
      halfW: Math.max(20, actualW / 2),
      halfH: Math.max(10, totalH / 2 + fontPx * 0.1),
    };
  }

  function _setupCardPreviewInteraction() {
    const canvas = overlay.querySelector('#fxeCdPreviewCanvas');
    if (!canvas || canvas.dataset.boundDrag) return;
    canvas.dataset.boundDrag = '1';

    function getMousePos(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / rect.width * canvas.width,
        y: (e.clientY - rect.top) / rect.height * canvas.height,
      };
    }

    function findBlockAt(card, x, y) {
      if (!card || !Array.isArray(card.blocks)) return -1;
      const w = canvas.width, h = canvas.height;
      const cw = (card.cardW || 60) / 100 * w;
      const ch_ = cw * (card.cardAspect || 0.5625);
      const cardX = (card.x || 50) / 100 * w - cw / 2;
      const cardY = (card.y || 50) / 100 * h - ch_ / 2;
      // Проверяем сверху-вниз (последний блок имеет приоритет — рисуется поверх)
      for (let i = card.blocks.length - 1; i >= 0; i--) {
        const b = card.blocks[i];
        const cx = cardX + (b.x || 50) / 100 * cw;
        const cy = cardY + (b.y || 50) / 100 * ch_;
        const { halfW, halfH } = _cdBlockHitBox(b, cw, ch_);
        if (Math.abs(x - cx) <= halfW && Math.abs(y - cy) <= halfH) return i;
      }
      return -1;
    }

    function isInsideCard(card, x, y) {
      if (!card) return false;
      const w = canvas.width, h = canvas.height;
      const cw = (card.cardW || 60) / 100 * w;
      const ch_ = cw * (card.cardAspect || 0.5625);
      const cardX = (card.x || 50) / 100 * w - cw / 2;
      const cardY = (card.y || 50) / 100 * h - ch_ / 2;
      return x >= cardX && x <= cardX + cw && y >= cardY && y <= cardY + ch_;
    }

    canvas.addEventListener('mousedown', e => {
      if (!_cdPreviewCard) return;
      const m = getMousePos(e);
      const idx = findBlockAt(_cdPreviewCard, m.x, m.y);
      if (idx >= 0) {
        _cdSelectedBlockIdx = idx;
        _cdDragMode = 'block';
        const b = _cdPreviewCard.blocks[idx];
        _cdDragState = {
          blockIdx: idx,
          startMouseX: m.x, startMouseY: m.y,
          startBlockX: b.x, startBlockY: b.y,
        };
        canvas.style.cursor = 'grabbing';
      } else if (isInsideCard(_cdPreviewCard, m.x, m.y)) {
        // Drag самой карточки (если кликнули внутри карточки, но не в блок)
        _cdSelectedBlockIdx = -1;
        _cdDragMode = 'card';
        _cdDragState = {
          startMouseX: m.x, startMouseY: m.y,
          startCardX: _cdPreviewCard.x, startCardY: _cdPreviewCard.y,
        };
        canvas.style.cursor = 'grabbing';
      }
      e.preventDefault();
    });

    canvas.addEventListener('mousemove', e => {
      const m = getMousePos(e);
      if (_cdDragState && _cdPreviewCard) {
        if (_cdDragMode === 'block') {
          const w = canvas.width, h = canvas.height;
          const cw = (_cdPreviewCard.cardW || 60) / 100 * w;
          const ch_ = cw * (_cdPreviewCard.cardAspect || 0.5625);
          const dxPxToPct = 100 / cw;
          const dyPxToPct = 100 / ch_;
          const dx = (m.x - _cdDragState.startMouseX) * dxPxToPct;
          const dy = (m.y - _cdDragState.startMouseY) * dyPxToPct;
          const rawX = Math.max(0, Math.min(100, _cdDragState.startBlockX + dx));
          const rawY = Math.max(0, Math.min(100, _cdDragState.startBlockY + dy));
          const newX = _snapPct(rawX);
          const newY = _snapPct(rawY);
          const blocks = (_cdPreviewCard.blocks || []).map((b, i) =>
            i === _cdDragState.blockIdx ? { ...b, x: +newX.toFixed(1), y: +newY.toFixed(1) } : b
          );
          BackgroundEngine.updateOverlay(_cdPreviewCard.id, { blocks });
          _cdPreviewCard = BackgroundEngine.overlays.find(o => o.id === _cdPreviewCard.id);
        } else if (_cdDragMode === 'card') {
          const w = canvas.width, h = canvas.height;
          const dx = (m.x - _cdDragState.startMouseX) * 100 / w;
          const dy = (m.y - _cdDragState.startMouseY) * 100 / h;
          const rawX = Math.max(0, Math.min(100, _cdDragState.startCardX + dx));
          const rawY = Math.max(0, Math.min(100, _cdDragState.startCardY + dy));
          const newX = _snapPct(rawX);
          const newY = _snapPct(rawY);
          BackgroundEngine.updateOverlay(_cdPreviewCard.id, { x: +newX.toFixed(1), y: +newY.toFixed(1) });
          _cdPreviewCard = BackgroundEngine.overlays.find(o => o.id === _cdPreviewCard.id);
        }
      } else {
        // Hover detection
        const idx = _cdPreviewCard ? findBlockAt(_cdPreviewCard, m.x, m.y) : -1;
        if (idx !== _cdHoverBlockIdx) {
          _cdHoverBlockIdx = idx;
          canvas.style.cursor = idx >= 0 ? 'grab' :
            (isInsideCard(_cdPreviewCard, m.x, m.y) ? 'move' : 'default');
        }
      }
    });

    const endDrag = () => {
      if (_cdDragState) {
        _cdDragState = null;
        canvas.style.cursor = _cdHoverBlockIdx >= 0 ? 'grab' : 'default';
        // Полный re-render списка чтобы слайдеры X/Y подтянули новые значения
        renderCardsPanel();
      }
    };
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', endDrag);
  }

  function _renderCardPreview(card) {
    const canvas = overlay.querySelector('#fxeCdPreviewCanvas');
    if (!canvas) return;

    // ── СИНХРОНИЗАЦИЯ С РЕАЛЬНЫМ РАЗРЕШЕНИЕМ ХОЛСТА ──
    // Главный канвас может быть 1920×1080 / 1280×720 / 1080×1080 / 1080×1920.
    // Если превью внутри редактора рендерим в фиксированном 1920×1080, то
    // композиция выглядит иначе чем на реальном export'е. Синхронизируем.
    const mainCanvas = document.getElementById('mainCanvas');
    if (mainCanvas && (canvas.width !== mainCanvas.width || canvas.height !== mainCanvas.height)) {
      canvas.width  = mainCanvas.width;
      canvas.height = mainCanvas.height;
    }

    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    _cdPreviewCard = card;
    _setupCardPreviewInteraction();

    cancelAnimationFrame(_cdPreviewRaf);
    const startT = performance.now() / 1000;
    const tick = () => {
      const now = performance.now() / 1000 - startT;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);
      // Шахматный фон чтобы видно было прозрачные части
      ctx.fillStyle = '#0f0f0f';
      const gs = 30;
      for (let y = 0; y < h; y += gs) {
        for (let x = 0; x < w; x += gs) {
          if (((x / gs) + (y / gs)) % 2 === 0) ctx.fillRect(x, y, gs, gs);
        }
      }

      // Текущая карточка (могла обновиться при drag)
      const liveCard = card ? BackgroundEngine.overlays.find(o => o.id === card.id) : null;
      _cdPreviewCard = liveCard;

      if (liveCard && liveCard.type === 'card') {
        // Синтетические bands ~100 BPM для preview — без них bass-driven анимации
        // (pulse/glitch/sparkle/chromatic) выглядят статично.
        const beatT = (now * 100 / 60) % 1;
        const bands = {
          bass:    Math.pow(1 - beatT, 3) * 0.85,
          mid:     (Math.sin(now * 3.2) * 0.5 + 0.5) * 0.55,
          high:    (Math.sin(now * 11)  * 0.5 + 0.5) * 0.4,
          overall: 0.5,
        };
        if (BackgroundEngine._previewDrawCard) {
          BackgroundEngine._previewDrawCard(ctx, liveCard, w, h, bands, now);
        }

        // ── СЕТКА (поверх композиции, полупрозрачная) ──
        if (_cdShowGrid) {
          ctx.save();
          const step = _cdGridStep || 5;          // % шаг
          const cellPxX = w * step / 100;
          const cellPxY = h * step / 100;
          // Тонкие линии каждого шага
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.10)';
          ctx.lineWidth = 1;
          for (let p = step; p < 100; p += step) {
            const x = (p / 100) * w;
            const y = (p / 100) * h;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          }
          // Сильнее: 25% / 75%
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.22)';
          ctx.lineWidth = 1;
          [25, 75].forEach(p => {
            ctx.beginPath(); ctx.moveTo((p/100)*w, 0); ctx.lineTo((p/100)*w, h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, (p/100)*h); ctx.lineTo(w, (p/100)*h); ctx.stroke();
          });
          // Rule-of-thirds (зелёные пунктирные)
          ctx.strokeStyle = 'rgba(85, 239, 196, 0.40)';
          ctx.setLineDash([4, 6]);
          [33.33, 66.66].forEach(p => {
            ctx.beginPath(); ctx.moveTo((p/100)*w, 0); ctx.lineTo((p/100)*w, h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, (p/100)*h); ctx.lineTo(w, (p/100)*h); ctx.stroke();
          });
          ctx.setLineDash([]);
          // Сильно: центральные оси 50%
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
          ctx.restore();
        }

        // ── Bbox карточки (тонкая голубая рамка) ──
        const cw = (liveCard.cardW || 60) / 100 * w;
        const ch_ = cw * (liveCard.cardAspect || 0.5625);
        const cardX = (liveCard.x || 50) / 100 * w - cw / 2;
        const cardY = (liveCard.y || 50) / 100 * h - ch_ / 2;
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(cardX, cardY, cw, ch_);
        ctx.setLineDash([]);
        ctx.restore();

        // ── Контуры всех блоков (диагностический режим) ──
        if (_cdShowOutlines) {
          const palette = ['#00e5ff', '#a29bfe', '#55efc4', '#ffa502', '#ff6b9d', '#ffe66d', '#ff7675', '#74b9ff'];
          (liveCard.blocks || []).forEach((b, i) => {
            const cx = cardX + (b.x || 50) / 100 * cw;
            const cy = cardY + (b.y || 50) / 100 * ch_;
            const kind = b.kind || 'text';
            const { halfW, halfH } = _cdBlockHitBox(b, cw, ch_);
            const col = palette[i % palette.length];
            ctx.save();
            // Полупрозрачная заливка
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.06;
            ctx.fillRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
            // Контур
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
            ctx.setLineDash([]);
            // Бейдж с номером + типом в углу
            const badgeW = 64, badgeH = 16;
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.95;
            ctx.fillRect(cx - halfW, cy - halfH - badgeH, badgeW, badgeH);
            ctx.fillStyle = '#000';
            ctx.font = 'bold 10px "Space Mono", monospace';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            const tag = kind === 'image' ? '🖼' : kind === 'divider' ? '─' : 'T';
            ctx.fillText(`${tag} #${i + 1}`, cx - halfW + 5, cy - halfH - badgeH / 2);
            ctx.restore();
          });
        }

        // ── Маркеры блоков (точки + хит-зона при hover/select) ──
        (liveCard.blocks || []).forEach((b, i) => {
          const cx = cardX + (b.x || 50) / 100 * cw;
          const cy = cardY + (b.y || 50) / 100 * ch_;
          const isSelected = i === _cdSelectedBlockIdx;
          const isHover = i === _cdHoverBlockIdx;
          ctx.save();
          // Хит-зона при hover/select (используем точный bbox как для hit-теста)
          if (isSelected || isHover) {
            const { halfW, halfH } = _cdBlockHitBox(b, cw, ch_);
            ctx.strokeStyle = isSelected ? '#00e5ff' : 'rgba(0,229,255,0.4)';
            ctx.lineWidth = isSelected ? 2 : 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
            ctx.setLineDash([]);
          }
          // Точка-якорь
          ctx.fillStyle = isSelected ? '#00e5ff' : (isHover ? '#88e0ff' : 'rgba(0, 229, 255, 0.55)');
          ctx.strokeStyle = '#0a0a0a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, isSelected ? 6 : 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Номер блока
          if (isSelected || isHover) {
            ctx.fillStyle = '#00e5ff';
            ctx.font = 'bold 11px "Space Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`#${i + 1}`, cx + 8, cy - 8);
            ctx.textAlign = 'left';
          }
          ctx.restore();
        });

        // Подсказка о drag в углу
        ctx.save();
        ctx.fillStyle = 'rgba(0, 229, 255, 0.55)';
        ctx.font = '10px "Space Mono", monospace';
        const hints = ['🖱 тяни блок — позиция'];
        if (_cdShowGrid) hints.push(`▦ ${_cdGridStep}% сетка + snap`);
        if (_cdShowOutlines) hints.push('▢ контуры');
        ctx.fillText(hints.join(' · '), 10, h - 10);
        ctx.restore();
      } else {
        ctx.fillStyle = '#333';
        ctx.font = "12px 'Space Mono', monospace";
        ctx.textAlign = 'center';
        ctx.fillText('— нет выбранной композиции —', w / 2, h / 2);
        ctx.textAlign = 'left';
      }
      _cdPreviewRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  /* ── Camera Scenes Panel Render ─────────────── */
  function renderScenesPanel() {
    const list = overlay.querySelector('#fxeCsList');
    if (!list) return;
    list.innerHTML = '';

    const scenes = BackgroundEngine.camScenes;
    if (!scenes.length) {
      const empty = document.createElement('div');
      empty.className = 'fxe-cs-empty';
      empty.innerHTML = '— нет сцен —<br><span style="opacity:.6;font-size:8px;">нажми "+ Добавить сцену" чтобы создать первый кинематографичный пресет</span>';
      list.appendChild(empty);
      return;
    }

    scenes.forEach(scene => {
      const card = document.createElement('div');
      card.className = 'fxe-cs-card' + (scene.enabled ? '' : ' disabled');

      const head = document.createElement('div');
      head.className = 'fxe-cs-card-head';

      const enChip = document.createElement('button');
      enChip.className = 'fxe-cs-en-chip' + (scene.enabled ? ' on' : '');
      enChip.textContent = scene.enabled ? '● ВКЛ' : '○ ВЫКЛ';
      enChip.title = 'Вкл / выкл сцену';
      enChip.addEventListener('click', () => {
        BackgroundEngine.updateCamScene(scene.id, { enabled: !scene.enabled });
        renderScenesPanel();
      });
      head.appendChild(enChip);

      const nameInp = document.createElement('input');
      nameInp.className = 'fxe-cs-name-inp';
      nameInp.value = scene.name;
      nameInp.placeholder = 'имя сцены';
      nameInp.addEventListener('change', () => {
        BackgroundEngine.updateCamScene(scene.id, { name: nameInp.value || `Сцена ${scenes.indexOf(scene) + 1}` });
      });
      head.appendChild(nameInp);

      const remBtn = document.createElement('button');
      remBtn.className = 'fxe-cs-rem-btn';
      remBtn.textContent = '✕';
      remBtn.title = 'Удалить сцену';
      remBtn.addEventListener('click', () => {
        if (scene.selectedLines && scene.selectedLines.length > 0) {
          if (!confirm(`Удалить "${scene.name}"? Назначено строк: ${scene.selectedLines.length}`)) return;
        }
        BackgroundEngine.removeCamScene(scene.id);
        renderScenesPanel();
      });
      head.appendChild(remBtn);

      card.appendChild(head);

      // Текущий пресет (заголовок с иконкой) + кнопка-выбора, открывающая сетку
      const presetHeader = document.createElement('div');
      presetHeader.className = 'fxe-cs-preset-header';
      const curPreset = CAM_SCENE_PRESETS.find(p => p.value === scene.preset);
      const curIcon = curPreset ? curPreset.icon : '🎯';
      const curLabel = curPreset ? curPreset.label.split(' · ')[0] : scene.preset;
      const curHint = curPreset ? (curPreset.label.split(' · ')[1] || '') : '';
      presetHeader.innerHTML = `
        <span class="fxe-cs-preset-icon">${curIcon}</span>
        <div class="fxe-cs-preset-info">
          <div class="fxe-cs-preset-name">${curLabel}</div>
          <div class="fxe-cs-preset-hint">${curHint}</div>
        </div>
        <button class="fxe-cs-preset-toggle" type="button">сменить ▾</button>
      `;
      card.appendChild(presetHeader);

      // Сетка пресетов (свернута по умолчанию)
      const presetGrid = document.createElement('div');
      presetGrid.className = 'fxe-cs-preset-grid';
      presetGrid.style.display = 'none';

      CAM_SCENE_GROUPS.forEach(group => {
        const groupEl = document.createElement('div');
        groupEl.className = 'fxe-cs-preset-group';

        const groupHead = document.createElement('div');
        groupHead.className = 'fxe-cs-preset-group-head';
        groupHead.innerHTML = `<span class="g-name">${group.name}</span><span class="g-desc">${group.desc}</span>`;
        groupEl.appendChild(groupHead);

        const buttons = document.createElement('div');
        buttons.className = 'fxe-cs-preset-buttons';
        group.presets.forEach(preset => {
          const btn = document.createElement('button');
          btn.className = 'fxe-cs-preset-btn' + (preset.value === scene.preset ? ' active' : '');
          btn.type = 'button';
          btn.title = `${preset.label} · ${preset.hint}`;
          btn.innerHTML = `
            <span class="p-icon">${preset.icon}</span>
            <span class="p-label">${preset.label}</span>
            <span class="p-hint">${preset.hint}</span>
          `;
          btn.addEventListener('click', () => {
            BackgroundEngine.updateCamScene(scene.id, { preset: preset.value });
            renderScenesPanel(); // полный rerender чтобы обновить header + active
          });
          buttons.appendChild(btn);
        });
        groupEl.appendChild(buttons);
        presetGrid.appendChild(groupEl);
      });

      card.appendChild(presetGrid);

      // Toggle expand/collapse
      const toggleBtn = presetHeader.querySelector('.fxe-cs-preset-toggle');
      toggleBtn.addEventListener('click', () => {
        const open = presetGrid.style.display === 'none';
        presetGrid.style.display = open ? 'flex' : 'none';
        toggleBtn.textContent = open ? 'свернуть ▴' : 'сменить ▾';
      });

      const mkSlider = (label, key, min, max, step, fmt) => {
        const row = document.createElement('div');
        row.className = 'fxe-cs-row';
        const lab = document.createElement('span');
        lab.className = 'fxe-cs-row-label';
        lab.textContent = label;
        row.appendChild(lab);
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = min; inp.max = max; inp.step = step;
        inp.value = scene[key];
        inp.className = 'fxe-cs-range';
        const val = document.createElement('span');
        val.className = 'fxe-cs-row-val';
        val.textContent = fmt(parseFloat(inp.value));
        inp.addEventListener('input', () => { val.textContent = fmt(parseFloat(inp.value)); });
        inp.addEventListener('change', () => {
          BackgroundEngine.updateCamScene(scene.id, { [key]: parseFloat(inp.value) });
        });
        row.appendChild(inp);
        row.appendChild(val);
        return row;
      };
      card.appendChild(mkSlider('Сила',     'intensity', 0, 1,   0.05, v => v.toFixed(2)));
      card.appendChild(mkSlider('Фокус X%', 'focusX',    0, 100, 1,    v => v.toFixed(0)));
      card.appendChild(mkSlider('Фокус Y%', 'focusY',    0, 100, 1,    v => v.toFixed(0)));

      // ── Появление / исчезновение (per-scene) ──
      const fadeLabel = document.createElement('div');
      fadeLabel.className = 'fxe-cs-section-sublabel';
      fadeLabel.textContent = 'появление · исчезновение';
      card.appendChild(fadeLabel);
      card.appendChild(mkSlider('Заход',  'fadeIn',  0, 2.0, 0.05, v => v.toFixed(2) + 'с'));
      card.appendChild(mkSlider('Выход',  'fadeOut', 0, 2.0, 0.05, v => v.toFixed(2) + 'с'));

      // Easing — 3 кнопки smooth/linear/snap
      const easeRow = document.createElement('div');
      easeRow.className = 'fxe-cs-row';
      const easeLbl = document.createElement('span');
      easeLbl.className = 'fxe-cs-row-label';
      easeLbl.textContent = 'Кривая';
      easeRow.appendChild(easeLbl);
      const easeWrap = document.createElement('div');
      easeWrap.className = 'fxe-cs-ease-wrap';
      [['smooth', 'плавно'], ['linear', 'линейно'], ['snap', 'мгновенно']].forEach(([val, label]) => {
        const b = document.createElement('button');
        b.className = 'fxe-cs-ease-btn' + ((scene.fadeEasing || 'smooth') === val ? ' on' : '');
        b.textContent = label;
        b.title = val === 'smooth' ? 'Гладкая S-кривая (ease-in-out)' :
                 val === 'linear' ? 'Линейный переход (равномерный)' :
                                    'Резкий cut в середине (cinema-style)';
        b.addEventListener('click', () => {
          BackgroundEngine.updateCamScene(scene.id, { fadeEasing: val });
          renderScenesPanel();
        });
        easeWrap.appendChild(b);
      });
      easeRow.appendChild(easeWrap);
      card.appendChild(easeRow);

      // Кнопка «сброс к дефолтам пресета»
      const resetBtn = document.createElement('button');
      resetBtn.className = 'fxe-cs-fade-reset';
      resetBtn.textContent = '↺ сбросить к дефолтам пресета';
      resetBtn.title = 'Вернуть fadeIn/fadeOut/easing к умолчанию для текущего пресета';
      resetBtn.addEventListener('click', () => {
        if (BackgroundEngine.resetSceneFadesToDefaults) {
          BackgroundEngine.resetSceneFadesToDefaults(scene.id);
        }
        renderScenesPanel();
      });
      card.appendChild(resetBtn);

      const linesRow = document.createElement('div');
      linesRow.className = 'fxe-cs-lines-row';
      const linesBtn = document.createElement('button');
      linesBtn.className = 'fxe-cs-lines-btn';
      const cnt = (scene.selectedLines || []).length;
      linesBtn.innerHTML = cnt > 0
        ? `🎯 Строк: <b>${cnt}</b> · нажми чтобы изменить`
        : `🎯 Назначить строки`;
      linesBtn.addEventListener('click', () => openLineSelectorPanel('scene', scene.id));
      linesRow.appendChild(linesBtn);
      card.appendChild(linesRow);

      list.appendChild(card);
    });
  }

  /* ── Overlay Panel Render ───────────────────── */
  function renderOverlayPanel() {
    const list = overlay.querySelector('#fxeOvList');
    if (!list) return;
    list.innerHTML = '';

    const ovs = BackgroundEngine.overlays;
    if (!ovs.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:Space Mono,monospace;font-size:9px;color:#333;text-align:center;padding:40px;letter-spacing:2px;text-transform:uppercase;';
      empty.textContent = '— Нет объектов. Нажми + Добавить объект —';
      list.appendChild(empty);
      return;
    }

    // Настраиваем drag & drop для canvas (только один раз)
    setupOverlayDrag();

    const EFFECTS = [
      { value:'static',    label:'Статика'           },
      { value:'sway',      label:'Покачивание'        },
      { value:'pulse',     label:'Пульс (бас)'        },
      { value:'zoom',      label:'⚡ Зум (бас)'       },
      { value:'heartbeat', label:'💓 Сердце (бас)'    },
      { value:'stretch',   label:'Растяжение'         },
      { value:'float',     label:'Плавание'           },
      { value:'breathe',   label:'🫁 Дыхание'         },
      { value:'presence',  label:'🫥 Присутствие'      },
      { value:'drift',     label:'🌊 Дрейф'           },
      { value:'orbit',     label:'🪐 Орбита'          },
      { value:'bounce',    label:'Отскок'             },
      { value:'shake',     label:'Тряска'             },
      { value:'glitch',    label:'📡 Глитч (бас)'     },
      { value:'pendulum',  label:'⏱ Маятник'          },
      { value:'vortex',    label:'🌀 Вортекс'         },
      { value:'spin',      label:'Вращение'           },
      // ── Кинематические режимы (из текста лирики) ──
      { value:'cinematic', label:'🎬 Кино'            },
      { value:'flash',     label:'⚡ Flash'           },
      { value:'impact',    label:'💥 Impact'          },
      { value:'parallax',  label:'🌌 Parallax'        },
      { value:'path',      label:'〜 Path'           },
      // ── Прокрутка (seamless scroll) ──
      { value:'scroll_left',    label:'← Прокрутка влево'    },
      { value:'scroll_right',   label:'→ Прокрутка вправо'   },
      { value:'scroll_up',      label:'↑ Прокрутка вверх'    },
      { value:'scroll_down',    label:'↓ Прокрутка вниз'     },
      { value:'scroll_diag_dr', label:'↘ Прокрутка диагональ'},
      { value:'scroll_diag_ul', label:'↖ Прокрутка диагональ'},
    ];
    // Per-word режимы — только для text-объектов (разбивают текст на слова).
    // Для image-объектов эти режимы не применимы (нет слов).
    const TEXT_ONLY_EFFECTS = [
      { value:'cascade',   label:'🪜 Cascade (per-word)' },
      { value:'snap',      label:'🧲 Snap (per-word)'    },
      { value:'scatter',   label:'💥 Scatter (per-word)' },
      { value:'shatter',   label:'✨ Shatter (per-letter)'},
      { value:'cipher',    label:'🔐 Cipher (per-word)'  },
      { value:'ripple',    label:'💧 Ripple (per-word)'  },
    ];

    // Рендерим карточки в ПРЯМОМ порядке массива:
    // верх списка = низ z-стека (индекс 0), низ списка = верх z-стека (последний индекс).
    // ▲ = "выше в стеке" = переместить ближе к концу массива (+1), ▼ = обратно (-1).
    ovs.forEach((ov, arrIdx) => {
      // Глобальная позиция в едином стеке — все объекты в одной иерархии.
      const isTop    = arrIdx === ovs.length - 1;
      const isBottom = arrIdx === 0;
      // zRank: 1 = самый нижний в стеке, ovs.length = самый верхний
      const zRank    = arrIdx + 1;
      // По умолчанию все карточки свёрнуты; если пользователь развернул — _collapsedOverlays.delete(ov.id)
      if (!_collapsedOverlays.has(ov.id + '__expanded')) _collapsedOverlays.add(ov.id);
      const isCollapsed = _collapsedOverlays.has(ov.id);
      // Вспомогательная функция — объявляем в начале, чтобы была доступна и для text-строк, и для общих
      function makeSlider(lbl, key, min, max, step, initVal) {
        const row = document.createElement('div');
        row.className = 'fxe-ov-slider-row';
        const label = document.createElement('span');
        label.className = 'fxe-ov-slider-label';
        label.textContent = lbl;
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step;
        sl.value = initVal;
        sl.className = 'fxe-ov-slider';
        const val = document.createElement('span');
        val.className = 'fxe-ov-val';
        // Показываем красиво округлённое значение
        const fmtVal = v => {
          const n = parseFloat(v);
          if (step >= 1) return Math.round(n).toString();
          const dec = step.toString().includes('.') ? step.toString().split('.')[1].length : 2;
          return n.toFixed(dec);
        };
        val.textContent = fmtVal(initVal);
        sl.addEventListener('input', () => {
          val.textContent = fmtVal(sl.value);
          BackgroundEngine.updateOverlay(ov.id, { [key]: parseFloat(sl.value) });
        });
        row.appendChild(label); row.appendChild(sl); row.appendChild(val);
        return row;
      }

      // Создаёт секцию-группу контролов (карточка разделена секциями)
      function makeSection(labelText) {
        const sec = document.createElement('div');
        sec.className = 'fxe-ov-section';
        if (labelText) {
          const lbl = document.createElement('div');
          lbl.className = 'fxe-ov-section-label';
          lbl.textContent = labelText;
          sec.appendChild(lbl);
        }
        return sec;
      }

      const isText   = ov.type === 'text';
      const isFrame  = ov.type === 'frame';
      const isEffect = ov.type === 'effect';
      const card = document.createElement('div');
      card.className = 'fxe-ov-card'
        + (ov.enabled    ? '' : ' disabled')
        + (isText        ? ' fxe-ov-card-text' : '')
        + (isFrame       ? ' fxe-ov-card-frame' : '')
        + (isEffect      ? ' fxe-ov-card-effect' : '')
        + (isCollapsed   ? ' collapsed' : '')
        + (_previewSelectedOvId === ov.id ? ' preview-selected' : '');

      // ── Card header ─────────────────────────────
      const header = document.createElement('div');
      header.className = 'fxe-ov-card-header';
      // Клик по пустой области хедера — выбирает объект для превью и сворачивает/разворачивает карточку.
      header.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, textarea, img')) return;
        // Выбираем объект для превью (сбрасываем анимацию если был другой)
        if (_previewSelectedOvId !== ov.id) {
          _stopPreviewAnim();
          _previewSelectedOvId = ov.id;
        }
        // Сворачиваем/разворачиваем карточку
        if (_collapsedOverlays.has(ov.id)) {
          _collapsedOverlays.delete(ov.id);
          _collapsedOverlays.add(ov.id + '__expanded');
        } else {
          _collapsedOverlays.add(ov.id);
          _collapsedOverlays.delete(ov.id + '__expanded');
        }
        renderOverlayPanel();
      });

      // ── Drag handle (ставим первым в хедере) ────
      const dragHandle = document.createElement('div');
      dragHandle.className = 'fxe-ov-drag-handle';
      dragHandle.textContent = '⠿';
      dragHandle.title = 'Перетащить для изменения порядка';
      // Ставим draggable только через ручку
      dragHandle.addEventListener('mousedown', () => { card.setAttribute('draggable', 'true'); });
      dragHandle.addEventListener('touchstart', () => { card.setAttribute('draggable', 'true'); });
      header.appendChild(dragHandle);

      card.setAttribute('draggable', 'false');
      card.dataset.ovId = ov.id;

      card.addEventListener('dragstart', (e) => {
        _ovDrag.id = ov.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ov.id);
        requestAnimationFrame(() => card.classList.add('drag-dragging'));
      });
      card.addEventListener('dragend', () => {
        card.setAttribute('draggable', 'false');
        card.classList.remove('drag-dragging');
        list.querySelectorAll('.drag-over-above,.drag-over-below')
          .forEach(el => el.classList.remove('drag-over-above','drag-over-below'));
        _ovDrag.id = null;
      });
      card.addEventListener('dragover', (e) => {
        if (!_ovDrag.id || _ovDrag.id === ov.id) return;
        e.preventDefault();
        const rect = card.getBoundingClientRect();
        list.querySelectorAll('.drag-over-above,.drag-over-below')
          .forEach(el => el.classList.remove('drag-over-above','drag-over-below'));
        card.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-above' : 'drag-over-below');
      });
      card.addEventListener('dragleave', (e) => {
        if (!card.contains(e.relatedTarget))
          card.classList.remove('drag-over-above','drag-over-below');
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over-above','drag-over-below');
        if (!_ovDrag.id || _ovDrag.id === ov.id) return;
        const ovArr = BackgroundEngine.overlays;
        const srcIdx = ovArr.findIndex(o => o.id === _ovDrag.id);
        const dstIdx = ovArr.findIndex(o => o.id === ov.id);
        if (srcIdx === -1 || dstIdx === -1) return;
        const rect = card.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        const [item] = ovArr.splice(srcIdx, 1);
        const newDst = ovArr.findIndex(o => o.id === ov.id);
        ovArr.splice(before ? newDst : newDst + 1, 0, item);
        BackgroundEngine.updateOverlay(item.id, {});
        console.log('[FxEditor] overlay reorder → new order:', BackgroundEngine.overlays.map(o => o.name || o.id));
        renderOverlayPanel();
      });

      // Collapse chevron
      const collBtn = document.createElement('button');
      collBtn.className = 'fxe-ov-collapse';
      collBtn.textContent = isCollapsed ? '▸' : '▾';
      collBtn.title = isCollapsed ? 'Развернуть' : 'Свернуть';
      collBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_collapsedOverlays.has(ov.id)) {
          _collapsedOverlays.delete(ov.id);
          _collapsedOverlays.add(ov.id + '__expanded');
        } else {
          _collapsedOverlays.add(ov.id);
          _collapsedOverlays.delete(ov.id + '__expanded');
        }
        renderOverlayPanel();
      });
      header.appendChild(collBtn);

      // Z-order badge
      const zBadge = document.createElement('span');
      zBadge.className = 'fxe-ov-zbadge';
      zBadge.textContent = `z${zRank}`;
      zBadge.title = `Позиция ${zRank} из ${ovs.length} (${zRank === 1 ? 'самый нижний' : zRank === ovs.length ? 'самый верхний' : 'средний'})`;
      header.appendChild(zBadge);

      if (isText) {
        // Для текстовых — иконка T вместо thumbnail
        const icon = document.createElement('div');
        icon.className = 'fxe-ov-thumb fxe-ov-text-icon';
        icon.textContent = 'T';
        header.appendChild(icon);
      } else if (isFrame) {
        // Для рамок — иконка ⬡
        const icon = document.createElement('div');
        icon.className = 'fxe-ov-thumb fxe-ov-text-icon';
        icon.textContent = '⬡';
        icon.style.color = ov.frameColor || '#d4a84b';
        header.appendChild(icon);
      } else if (isEffect) {
        // Для эффектов — иконка ✨ или эмодзи из имени типа
        const icon = document.createElement('div');
        icon.className = 'fxe-ov-thumb fxe-ov-text-icon';
        const firstGlyph = (ov.name || '').split(' ')[0] || '✨';
        icon.textContent = firstGlyph;
        icon.style.color = ov.fxColor || '#e8ff00';
        header.appendChild(icon);
      } else {
        // Image overlay: thumbnail кликабельный → replace, + hidden file input
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'fxe-ov-thumb-wrap';
        thumbWrap.title = 'Кликни, чтобы заменить картинку';

        const thumb = document.createElement('img');
        thumb.className = 'fxe-ov-thumb';
        thumb.src = ov.url;
        thumbWrap.appendChild(thumb);

        // Overlay-hint при hover
        const replaceHint = document.createElement('div');
        replaceHint.className = 'fxe-ov-thumb-replace-hint';
        replaceHint.textContent = '↻';
        thumbWrap.appendChild(replaceHint);

        const fileInp = document.createElement('input');
        fileInp.type = 'file';
        fileInp.accept = 'image/*';
        fileInp.style.display = 'none';
        fileInp.addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try {
            await BackgroundEngine.replaceOverlayImage(ov.id, file);
            renderOverlayPanel();
          } catch (err) {
            console.warn('[FxEditor] replaceOverlayImage failed', err);
          }
        });
        thumbWrap.appendChild(fileInp);
        thumbWrap.addEventListener('click', (e) => {
          e.stopPropagation();
          fileInp.click();
        });
        header.appendChild(thumbWrap);
      }

      const nameEl = document.createElement('span');
      nameEl.className = 'fxe-ov-card-name';
      nameEl.textContent = isText   ? (ov.text || '(пусто)').slice(0, 24)
                         : isFrame  ? `Рамка · ${(ov.frameStyle||'baroque').toUpperCase()}`
                         : isEffect ? ov.name
                         : ov.name;
      header.appendChild(nameEl);

      // Enable toggle
      const enBtn = document.createElement('button');
      enBtn.className = 'fxe-ov-chip-enable' + (ov.enabled ? ' active-enabled' : '');
      enBtn.textContent = ov.enabled ? 'ВКЛ' : 'ВЫКЛ';
      enBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        BackgroundEngine.updateOverlay(ov.id, { enabled: !ov.enabled });
        renderOverlayPanel();
      });
      header.appendChild(enBtn);

      // Duplicate button (⧉)
      const dupBtn = document.createElement('button');
      dupBtn.className = 'fxe-ov-dup';
      dupBtn.textContent = '⧉';
      dupBtn.title = 'Дублировать (создать копию рядом)';
      dupBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await BackgroundEngine.duplicateOverlay(ov.id);
          renderOverlayPanel();
        } catch (err) {
          console.warn('[FxEditor] duplicateOverlay failed', err);
        }
      });
      header.appendChild(dupBtn);

      // Remove button
      const remBtn = document.createElement('button');
      remBtn.className = 'fxe-ov-rem';
      remBtn.textContent = '✕ удалить';
      remBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _collapsedOverlays.delete(ov.id);
        BackgroundEngine.removeOverlay(ov.id);
        renderOverlayPanel();
      });
      header.appendChild(remBtn);

      card.appendChild(header);

      // ── Card body ────────────────────────────────
      const body = document.createElement('div');
      body.className = 'fxe-ov-card-body';

      // ── Helper: color-chip ─────────────────────────
      function makeColorChip(currentColor, title, onChange, allowNone = false) {
        const wrap = document.createElement('span');
        wrap.className = 'fxe-ov-color-chip';
        wrap.title = title;
        const display = currentColor || '#000000';
        const isNone = allowNone && (!currentColor || currentColor === '');
        if (isNone) wrap.classList.add('none');
        wrap.style.background = isNone ? 'transparent' : display;
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = display;
        inp.addEventListener('input', () => {
          wrap.style.background = inp.value;
          onChange(inp.value);
        });
        wrap.appendChild(inp);
        if (allowNone) {
          wrap.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            wrap.classList.add('none');
            wrap.style.background = 'transparent';
            onChange('');
          });
        }
        return wrap;
      }

      // ── Helper: checkbox toggle ────────────────────
      function makeCheckbox(checked, title, onChange) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.className = 'fxe-ov-checkbox';
        cb.title = title;
        cb.addEventListener('change', () => onChange(cb.checked));
        return cb;
      }

      // ── Helper: color row [checkbox][chip][slider][val]
      function makeColorRow(label, enabled, color, colorKey, enableKey, sliderKey, sliderMax, sliderStep, sliderVal) {
        const row = document.createElement('div');
        row.className = 'fxe-ov-color-row';
        // Checkbox
        const cb = makeCheckbox(enabled, label + ': вкл/выкл', v => {
          BackgroundEngine.updateOverlay(ov.id, { [enableKey]: v });
        });
        row.appendChild(cb);
        // Color chip
        const chip = makeColorChip(color, label + ': цвет', v => {
          BackgroundEngine.updateOverlay(ov.id, { [colorKey]: v });
        });
        row.appendChild(chip);
        // Slider
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = 0; sl.max = sliderMax; sl.step = sliderStep;
        sl.value = sliderVal; sl.className = 'fxe-ov-slider';
        const valEl = document.createElement('span');
        valEl.className = 'fxe-ov-val';
        const fmtV = v => { const n = parseFloat(v); return sliderStep >= 1 ? Math.round(n) : n.toFixed(1); };
        valEl.textContent = fmtV(sliderVal);
        sl.addEventListener('input', () => {
          valEl.textContent = fmtV(sl.value);
          BackgroundEngine.updateOverlay(ov.id, { [sliderKey]: parseFloat(sl.value) });
        });
        row.appendChild(sl);
        row.appendChild(valEl);
        return row;
      }

      // ════════════════════════════════════════════════
      // FRAME-ONLY SECTIONS
      // ════════════════════════════════════════════════
      if (isFrame) {
        // ── СЕКЦИЯ: Стиль рамки ────────────────────────
        const secFrameStyle = makeSection('Стиль рамки');
        const styleGrid = document.createElement('div');
        styleGrid.className = 'fxe-ov-frame-style-grid';

        const frameStyles = (typeof BackgroundEngine.FrameDrawEngine !== 'undefined' && BackgroundEngine.FrameDrawEngine)
          ? BackgroundEngine.FrameDrawEngine.STYLES
          : [
            { id:'nexus', label:'NEXUS', icon:'◤' },
            { id:'ink',   label:'INK',   icon:'❖' },
            { id:'scan',  label:'SCAN',  icon:'▦' },
          ];

        frameStyles.forEach(s => {
          const btn = document.createElement('button');
          btn.className = 'fxe-ov-frame-style-btn' + (ov.frameStyle === s.id ? ' active-frame-style' : '');
          btn.innerHTML = `<span class="fxe-ov-frame-style-icon">${s.icon}</span><span class="fxe-ov-frame-style-label">${s.label}</span>`;
          btn.title = s.label + (s.desc ? ` · ${s.desc}` : '');
          btn.addEventListener('click', () => {
            BackgroundEngine.updateOverlay(ov.id, { frameStyle: s.id, name: `Рамка · ${s.id}` });
            renderOverlayPanel();
          });
          styleGrid.appendChild(btn);
        });
        secFrameStyle.appendChild(styleGrid);
        body.appendChild(secFrameStyle);

        // ── СЕКЦИЯ: Цвет и параметры ───────────────────
        const secFrameParams = makeSection('Цвет и параметры');

        // Цвет
        const colorRow = document.createElement('div');
        colorRow.className = 'fxe-ov-row';
        const colorLbl = document.createElement('span');
        colorLbl.className = 'fxe-ov-row-label';
        colorLbl.textContent = 'Цвет';
        colorRow.appendChild(colorLbl);

        const colorChip = makeColorChip(ov.frameColor || '#d4a84b', 'Цвет рамки', v => {
          BackgroundEngine.updateOverlay(ov.id, { frameColor: v });
        });
        colorRow.appendChild(colorChip);

        // Quick color presets
        const frameColorPresets = ['#d4a84b','#e8e8e8','#aed6f1','#a29bfe','#fd79a8','#55efc4','#e8ff00','#ffffff','#ff2d55','#00e5ff'];
        frameColorPresets.forEach(pc => {
          const swatch = document.createElement('button');
          swatch.className = 'fxe-ov-frame-color-swatch';
          swatch.style.background = pc;
          swatch.style.border = (ov.frameColor === pc) ? '2px solid #fff' : '2px solid transparent';
          swatch.title = pc;
          swatch.addEventListener('click', () => {
            BackgroundEngine.updateOverlay(ov.id, { frameColor: pc });
            renderOverlayPanel();
          });
          colorRow.appendChild(swatch);
        });
        secFrameParams.appendChild(colorRow);

        secFrameParams.appendChild(makeSlider('Толщина',     'frameThickness', 1,  10, 1,    ov.frameThickness ?? 3));
        secFrameParams.appendChild(makeSlider('Детализация', 'frameDetail',    1,  12, 1,    ov.frameDetail    ?? 6));
        secFrameParams.appendChild(makeSlider('Отступ %',    'framePad',       0,  25, 1,    ov.framePad       ?? 0));
        secFrameParams.appendChild(makeSlider('Поворот°',    'frameRotation',  -180, 180, 1, ov.frameRotation  ?? 0));
        secFrameParams.appendChild(makeSlider('Прозрачность','opacity',        0,  1,  0.01, ov.opacity));

        // Чекбокс «Скрывать на пустых строках» — рамка прячется на технических
        // строках (когда у активной лирики нет видимого текста, только команды).
        const rowHide = document.createElement('div');
        rowHide.className = 'fxe-ov-row';
        const hideCb = makeCheckbox(ov.hideOnEmptyLyric !== false, 'Скрывать рамку когда у активной строки нет текста', v => {
          BackgroundEngine.updateOverlay(ov.id, { hideOnEmptyLyric: v });
        });
        const hideLbl = document.createElement('span');
        hideLbl.className = 'fxe-ov-row-label';
        hideLbl.textContent = 'Прятать на пустых строках';
        hideLbl.style.flex = '1';
        hideLbl.title = 'Не показывать рамку на технических строках (только команды, без текста)';
        rowHide.appendChild(hideCb);
        rowHide.appendChild(hideLbl);
        secFrameParams.appendChild(rowHide);

        body.appendChild(secFrameParams);

        // ── СЕКЦИЯ: Анимация рамки ─────────────────────
        const secFrameAnim = makeSection('Аудио-анимация рамки');

        const animRow = document.createElement('div');
        animRow.className = 'fxe-ov-row';
        animRow.style.flexWrap = 'wrap';
        const animLbl = document.createElement('span');
        animLbl.className = 'fxe-ov-row-label';
        animLbl.textContent = 'Режим';
        animRow.appendChild(animLbl);

        const frameAnimModes = [
          ['none',      '✕ Нет'],
          ['pulse',     '⚡ Пульс (бас)'],
          ['breathe',   '🫁 Дыхание'],
          ['glitch',    '📡 Глитч'],
          ['rainbow',   '🌈 Радуга'],
          ['sparkle',   '✨ Мерцание'],
          ['swing',     '🕰 Swing (маятник)'],
          ['rotate',    '🔄 Вращение'],
          ['flicker',   '📺 CRT мигание'],
          ['chromatic', '🩻 Хром. джиттер'],
          ['march',     '🐜 Marching ants'],
        ];
        frameAnimModes.forEach(([val, label]) => {
          const btn = document.createElement('button');
          btn.className = 'fxe-ov-chip' + ((ov.frameAnimMode || 'none') === val ? ' active-enabled' : '');
          btn.textContent = label;
          btn.style.fontSize = '9px';
          btn.addEventListener('click', () => {
            BackgroundEngine.updateOverlay(ov.id, { frameAnimMode: val });
            renderOverlayPanel();
          });
          animRow.appendChild(btn);
        });
        secFrameAnim.appendChild(animRow);
        secFrameAnim.appendChild(makeSlider('Сила',    'frameAnimAmt',   0,   1, 0.05, ov.frameAnimAmt   ?? 0.5));
        secFrameAnim.appendChild(makeSlider('Скорость','frameAnimSpeed', 0.1, 3, 0.1,  ov.frameAnimSpeed ?? 1.0));
        body.appendChild(secFrameAnim);
      }

      // ════════════════════════════════════════════════
      // TEXT-ONLY SECTIONS
      // ════════════════════════════════════════════════
      if (isText) {
        // ── СЕКЦИЯ: Содержимое (текст + шрифт) ────────
        const secContent = makeSection('Содержимое');

        const txtArea = document.createElement('textarea');
        txtArea.className = 'fxe-ov-textarea';
        txtArea.value = ov.text || '';
        txtArea.rows = 1;
        txtArea.placeholder = 'ваш текст…';
        txtArea.addEventListener('input', () => {
          BackgroundEngine.updateOverlay(ov.id, {
            text: txtArea.value,
            name: (txtArea.value || '(пусто)').slice(0, 24),
          });
          nameEl.textContent = (txtArea.value || '(пусто)').slice(0, 24);
        });
        secContent.appendChild(txtArea);

        const fontSel = document.createElement('select');
        fontSel.className = 'fxe-ov-select fxe-ov-select-full';
        FONT_OPTIONS.filter(f => f.value).forEach(fo => {
          const o = document.createElement('option');
          o.value = fo.value; o.textContent = fo.label;
          if (fo.value === ov.font) o.selected = true;
          fontSel.appendChild(o);
        });
        fontSel.addEventListener('change', () => {
          BackgroundEngine.updateOverlay(ov.id, { font: fontSel.value });
        });
        secContent.appendChild(fontSel);
        body.appendChild(secContent);

        // ── СЕКЦИЯ: Стиль текста ───────────────────────
        const secStyle = makeSection('Стиль текста');

        // B / I / цвет текста / обводка / тень
        const styleRow = document.createElement('div');
        styleRow.className = 'fxe-ov-style-row';

        const boldBtn = document.createElement('button');
        boldBtn.className = 'fxe-ov-chip fxe-ov-chip-sq' + (ov.bold ? ' active-enabled' : '');
        boldBtn.textContent = 'B'; boldBtn.style.fontWeight = '700'; boldBtn.title = 'Жирный';
        boldBtn.addEventListener('click', () => { BackgroundEngine.updateOverlay(ov.id, { bold: !ov.bold }); renderOverlayPanel(); });
        styleRow.appendChild(boldBtn);

        const italBtn = document.createElement('button');
        italBtn.className = 'fxe-ov-chip fxe-ov-chip-sq' + (ov.italic ? ' active-enabled' : '');
        italBtn.textContent = 'I'; italBtn.style.fontStyle = 'italic'; italBtn.title = 'Курсив';
        italBtn.addEventListener('click', () => { BackgroundEngine.updateOverlay(ov.id, { italic: !ov.italic }); renderOverlayPanel(); });
        styleRow.appendChild(italBtn);

        // sep
        const sep1 = document.createElement('span'); sep1.className = 'fxe-ov-style-sep'; styleRow.appendChild(sep1);

        // цвет текста
        styleRow.appendChild(makeColorChip(ov.color || '#ffffff', 'Цвет текста', v => BackgroundEngine.updateOverlay(ov.id, { color: v })));

        // sep
        const sep2 = document.createElement('span'); sep2.className = 'fxe-ov-style-sep'; styleRow.appendChild(sep2);

        // обводка toggle + chip
        const strokeCb = makeCheckbox(ov.strokeEnabled, 'Обводка', v => { BackgroundEngine.updateOverlay(ov.id, { strokeEnabled: v }); });
        styleRow.appendChild(strokeCb);
        styleRow.appendChild(makeColorChip(ov.strokeColor || '#ffffff', 'Цвет обводки', v => BackgroundEngine.updateOverlay(ov.id, { strokeColor: v })));

        // sep
        const sep3 = document.createElement('span'); sep3.className = 'fxe-ov-style-sep'; styleRow.appendChild(sep3);

        // тень toggle + chip
        const shadowCb = makeCheckbox(ov.shadowEnabled, 'Тень', v => { BackgroundEngine.updateOverlay(ov.id, { shadowEnabled: v }); });
        styleRow.appendChild(shadowCb);
        styleRow.appendChild(makeColorChip(ov.shadowColor || '#000000', 'Цвет тени', v => BackgroundEngine.updateOverlay(ov.id, { shadowColor: v })));

        secStyle.appendChild(styleRow);
        secStyle.appendChild(makeSlider('Размер', 'fontSize', 8, 400, 1, ov.fontSize || 96));
        secStyle.appendChild(makeSlider('Обводка', 'strokeWidth', 0, 20, 0.5, ov.strokeWidth || 0));
        secStyle.appendChild(makeSlider('Тень', 'shadowBlur', 0, 60, 1, ov.shadowBlur || 0));
        body.appendChild(secStyle);

        // ── СЕКЦИЯ: Рамка ──────────────────────────────
        if (typeof BoxRegistry !== 'undefined') {
          const secBox = makeSection('Рамка');
          const boxGrid = document.createElement('div');
          boxGrid.className = 'fxe-ov-box-grid';

          const noneBtn = document.createElement('button');
          noneBtn.className = 'fxe-ov-box-btn' + (!ov.boxStyle ? ' active-box' : '');
          noneBtn.textContent = '✕ Нет';
          noneBtn.style.borderColor = '#3a3a3a'; noneBtn.style.color = '#888';
          noneBtn.addEventListener('click', () => { BackgroundEngine.updateOverlay(ov.id, { boxStyle: '' }); renderOverlayPanel(); });
          boxGrid.appendChild(noneBtn);

          BoxRegistry.all.forEach(boxDef => {
            const btn = document.createElement('button');
            btn.className = 'fxe-ov-box-btn' + (ov.boxStyle === boxDef.id ? ' active-box' : '');
            btn.textContent = `${boxDef.icon} ${boxDef.label}`;
            btn.style.borderColor = boxDef.uiColor;
            btn.style.color = boxDef.uiColor;
            btn.style.background = boxDef.uiBg;
            btn.addEventListener('click', () => { BackgroundEngine.updateOverlay(ov.id, { boxStyle: boxDef.id }); renderOverlayPanel(); });
            boxGrid.appendChild(btn);
          });
          secBox.appendChild(boxGrid);
          body.appendChild(secBox);
        }
      }

      // ════════════════════════════════════════════════
      // IMAGE-ONLY: Размер + обводка/тень
      // ════════════════════════════════════════════════
      if (!isText && !isFrame && !isEffect) {
        const secImg = makeSection('Размер и прозрачность');
        secImg.appendChild(makeSlider('Размер', 'width', 2, 200, 0.5, ov.width));
        secImg.appendChild(makeSlider('Alpha', 'opacity', 0, 1, 0.01, ov.opacity));
        body.appendChild(secImg);

        const secImgFx = makeSection('Обводка и тень');
        secImgFx.appendChild(makeColorRow('Обводка', ov.strokeEnabled, ov.strokeColor || '#ffffff', 'strokeColor', 'strokeEnabled', 'strokeWidth', 20, 0.5, ov.strokeWidth || 0));
        secImgFx.appendChild(makeColorRow('Тень', ov.shadowEnabled, ov.shadowColor || '#000000', 'shadowColor', 'shadowEnabled', 'shadowBlur', 60, 1, ov.shadowBlur || 0));
        body.appendChild(secImgFx);
      }

      // ════════════════════════════════════════════════
      // EFFECT-ONLY: Тип эффекта, сила, цвет, прозрачность
      // ════════════════════════════════════════════════
      if (isEffect) {
        const secEff = makeSection('Параметры эффекта');

        // Тип эффекта
        const rowType = document.createElement('div');
        rowType.className = 'fxe-ov-row';
        const tLbl = document.createElement('span');
        tLbl.className = 'fxe-ov-row-label';
        tLbl.textContent = 'Тип';
        rowType.appendChild(tLbl);
        const typeSel = document.createElement('select');
        typeSel.className = 'fxe-ov-select'; typeSel.style.flex = '1';
        const types = (BackgroundEngine.effectTypes && BackgroundEngine.effectTypes.length)
          ? BackgroundEngine.effectTypes
          : [{ id:'rain', name:'🌧 Дождь', color:'#88aaff' }];
        types.forEach(et => {
          const o = document.createElement('option');
          o.value = et.id; o.textContent = et.name;
          if (et.id === ov.effectType) o.selected = true;
          typeSel.appendChild(o);
        });
        typeSel.addEventListener('change', () => {
          const def = types.find(d => d.id === typeSel.value) || types[0];
          BackgroundEngine.updateOverlay(ov.id, {
            effectType: def.id,
            name:       def.name,
            fxColor:    def.color,
            _fxState:   null, // сброс state — re-init на следующем кадре
          });
          renderOverlayPanel();
        });
        rowType.appendChild(typeSel);
        secEff.appendChild(rowType);

        // Цвет эффекта
        const rowColor = document.createElement('div');
        rowColor.className = 'fxe-ov-row';
        const cLbl = document.createElement('span');
        cLbl.className = 'fxe-ov-row-label';
        cLbl.textContent = 'Цвет';
        rowColor.appendChild(cLbl);
        rowColor.appendChild(makeColorChip(ov.fxColor || '#ffffff', 'Цвет эффекта', v => {
          BackgroundEngine.updateOverlay(ov.id, { fxColor: v });
        }));
        // Цветовые пресеты
        const fxColorPresets = ['#ffffff','#88aaff','#ff5588','#ff8844','#e8ff00','#00e5ff','#b14fff','#ff2d55','#000000'];
        fxColorPresets.forEach(pc => {
          const swatch = document.createElement('button');
          swatch.className = 'fxe-ov-frame-color-swatch';
          swatch.style.background = pc;
          swatch.style.border = (ov.fxColor === pc) ? '2px solid #fff' : '2px solid transparent';
          swatch.title = pc;
          swatch.addEventListener('click', () => {
            BackgroundEngine.updateOverlay(ov.id, { fxColor: pc });
            renderOverlayPanel();
          });
          rowColor.appendChild(swatch);
        });
        secEff.appendChild(rowColor);

        secEff.appendChild(makeSlider('Сила',         'intensity', 0, 1, 0.01, ov.intensity != null ? ov.intensity : 0.5));
        secEff.appendChild(makeSlider('Прозрачность', 'opacity',   0, 1, 0.01, ov.opacity));
        body.appendChild(secEff);
      }

      // ════════════════════════════════════════════════
      // ОБЩИЕ СЕКЦИИ: слой, видимость, позиция, эффект
      // ════════════════════════════════════════════════

      // ── СЕКЦИЯ: Слой и видимость ───────────────────
      const secLayerScope = makeSection('Слой и видимость');

      const rowLayer = document.createElement('div');
      rowLayer.className = 'fxe-ov-row';
      const layerLbl = document.createElement('span'); layerLbl.className = 'fxe-ov-row-label'; layerLbl.textContent = 'Слой';
      rowLayer.appendChild(layerLbl);
      [['above','⬆ Выше текста'], ['below','⬇ Ниже текста']].forEach(([val, label]) => {
        const btn = document.createElement('button');
        btn.className = 'fxe-ov-chip' + (ov.layer === val ? ` active-layer-${val}` : '');
        btn.textContent = label;
        btn.addEventListener('click', () => { BackgroundEngine.updateOverlay(ov.id, { layer: val }); renderOverlayPanel(); });
        rowLayer.appendChild(btn);
      });
      secLayerScope.appendChild(rowLayer);

      const rowScope = document.createElement('div');
      rowScope.className = 'fxe-ov-row';
      const scopeLbl = document.createElement('span'); scopeLbl.className = 'fxe-ov-row-label'; scopeLbl.textContent = 'Видим.';
      rowScope.appendChild(scopeLbl);
      const btnGlobal = document.createElement('button');
      btnGlobal.className = 'fxe-ov-chip' + (ov.scope === 'global' ? ' active-scope-global' : '');
      btnGlobal.textContent = '♾ Везде';
      btnGlobal.addEventListener('click', () => { BackgroundEngine.updateOverlay(ov.id, { scope: 'global' }); renderOverlayPanel(); });
      rowScope.appendChild(btnGlobal);
      const btnTl = document.createElement('button');
      btnTl.className = 'fxe-ov-chip' + (ov.scope === 'timeline' ? ' active-scope-tl' : '');
      btnTl.textContent = '⏱ Таймлайн';
      btnTl.addEventListener('click', () => { BackgroundEngine.updateOverlay(ov.id, { scope: 'timeline' }); renderOverlayPanel(); });
      rowScope.appendChild(btnTl);
      secLayerScope.appendChild(rowScope);

      if (ov.scope === 'timeline') {
        const selectedCount = (ov.selectedLines || []).length;
        const btnOpenSelector = document.createElement('button');
        btnOpenSelector.className = 'fxe-ov-chip fxe-ov-open-selector';
        btnOpenSelector.textContent = `📋 Выбрать строки (${selectedCount}/${lines.length})`;
        btnOpenSelector.addEventListener('click', () => { openLineSelectorPanel(ov.id); });
        secLayerScope.appendChild(btnOpenSelector);
      }
      body.appendChild(secLayerScope);

      // ── СЕКЦИЯ: Позиция (не нужна для полноэкранных эффектов) ──
      if (isEffect) {
        // эффект полноэкранный — пропускаем секции Позиция и Эффект-движение
        card.appendChild(body);
        list.appendChild(card);
        return;
      }
      const secPos = makeSection('Позиция');
      const positionMode = ov.positionMode || 'custom';

      const rowPosPresets = document.createElement('div');
      rowPosPresets.className = 'fxe-ov-row';
      const PRESETS = [
        { id: 'center',       label: '⊙ Центр',      x: 50,  y: 50  },
        { id: 'top',          label: '↑ Верх',       x: 50,  y: 15  },
        { id: 'bottom',       label: '↓ Низ',        x: 50,  y: 85  },
        { id: 'left',         label: '← Лево',       x: 15,  y: 50  },
        { id: 'right',        label: '→ Право',      x: 85,  y: 50  },
        { id: 'top-left',     label: '↖ В-лево',    x: 15,  y: 15  },
        { id: 'top-right',    label: '↗ В-право',   x: 85,  y: 15  },
        { id: 'bottom-left',  label: '↙ Н-лево',    x: 15,  y: 85  },
        { id: 'bottom-right', label: '↘ Н-право',   x: 85,  y: 85  },
        { id: 'custom',       label: '✦ Свободно',  x: null, y: null },
      ];
      PRESETS.forEach(preset => {
        const btn = document.createElement('button');
        btn.className = 'fxe-ov-chip fxe-ov-pos-preset' + (positionMode === preset.id ? ' active-pos' : '');
        btn.textContent = preset.label;
        btn.addEventListener('click', () => {
          if (preset.id === 'custom') {
            BackgroundEngine.updateOverlay(ov.id, { positionMode: 'custom' });
          } else {
            BackgroundEngine.updateOverlay(ov.id, { positionMode: preset.id, x: preset.x, y: preset.y });
          }
          renderOverlayPanel();
        });
        rowPosPresets.appendChild(btn);
      });
      secPos.appendChild(rowPosPresets);

      if (positionMode === 'custom') {
        const rowCustomPos = document.createElement('div');
        rowCustomPos.className = 'fxe-ov-custom-pos';
        const posGrid = document.createElement('div');
        posGrid.className = 'fxe-ov-pos-grid';
        const arrows = [
          { dir: '↖', dx: -1, dy: -1 }, { dir: '↑', dx: 0, dy: -1 }, { dir: '↗', dx: 1, dy: -1 },
          { dir: '←', dx: -1, dy: 0  }, { dir: '⊙', dx: 0, dy: 0  }, { dir: '→', dx: 1, dy: 0  },
          { dir: '↙', dx: -1, dy: 1  }, { dir: '↓', dx: 0, dy: 1  }, { dir: '↘', dx: 1, dy: 1  },
        ];
        arrows.forEach(arrow => {
          const btn = document.createElement('button');
          btn.className = 'fxe-ov-arrow-btn';
          btn.textContent = arrow.dir;
          btn.addEventListener('click', () => {
            const newX = Math.max(0, Math.min(100, ov.x + arrow.dx * 0.5));
            const newY = Math.max(0, Math.min(100, ov.y + arrow.dy * 0.5));
            BackgroundEngine.updateOverlay(ov.id, { x: newX, y: newY });
            renderOverlayPanel();
          });
          posGrid.appendChild(btn);
        });
        const posValues = document.createElement('div');
        posValues.className = 'fxe-ov-pos-values';
        posValues.textContent = `X: ${ov.x.toFixed(1)}% · Y: ${ov.y.toFixed(1)}%`;
        rowCustomPos.appendChild(posGrid);
        rowCustomPos.appendChild(posValues);
        secPos.appendChild(rowCustomPos);
      }
      body.appendChild(secPos);

      // ── СЕКЦИЯ: Alpha (только для текстовых — изображения уже выше) ──
      if (isText) {
        const secAlpha = makeSection('Прозрачность');
        secAlpha.appendChild(makeSlider('Alpha', 'opacity', 0, 1, 0.01, ov.opacity));
        body.appendChild(secAlpha);
      }

      // ── СЕКЦИЯ: Эффект ─────────────────────────────
      const secFx = makeSection('Эффект');
      const rowFxType = document.createElement('div');
      rowFxType.className = 'fxe-ov-row';
      const fxTypeLbl = document.createElement('span'); fxTypeLbl.className = 'fxe-ov-row-label'; fxTypeLbl.textContent = 'Тип';
      rowFxType.appendChild(fxTypeLbl);
      const fxSel = document.createElement('select');
      fxSel.className = 'fxe-ov-select'; fxSel.style.flex = '1';
      EFFECTS.forEach(ef => {
        const o = document.createElement('option');
        o.value = ef.value; o.textContent = ef.label;
        if (ef.value === ov.effect) o.selected = true;
        fxSel.appendChild(o);
      });
      // Per-word режимы — только для text-объектов
      if (ov.type === 'text') {
        const sep = document.createElement('option');
        sep.disabled = true; sep.textContent = '── Per-word (только текст) ──';
        fxSel.appendChild(sep);
        TEXT_ONLY_EFFECTS.forEach(ef => {
          const o = document.createElement('option');
          o.value = ef.value; o.textContent = ef.label;
          if (ef.value === ov.effect) o.selected = true;
          fxSel.appendChild(o);
        });
      }
      fxSel.addEventListener('change', () => { BackgroundEngine.updateOverlay(ov.id, { effect: fxSel.value }); });
      rowFxType.appendChild(fxSel);
      secFx.appendChild(rowFxType);
      secFx.appendChild(makeSlider('Сила', 'effectAmt', 0, 1, 0.01, ov.effectAmt));

      // Чекбокс «Реакция на бас»: если выкл, scroll/sway/drift двигаются с константной
      // скоростью (без дёрганья от ударов), а bass-эффекты (pulse/shake) становятся статикой.
      const rowReact = document.createElement('div');
      rowReact.className = 'fxe-ov-row';
      const reactCb = makeCheckbox(ov.audioReactive !== false, 'Реакция на бас: вкл/выкл', v => {
        BackgroundEngine.updateOverlay(ov.id, { audioReactive: v });
      });
      const reactLbl = document.createElement('span');
      reactLbl.className = 'fxe-ov-row-label';
      reactLbl.textContent = 'Реакция на бас';
      reactLbl.style.flex = '1';
      rowReact.appendChild(reactCb);
      rowReact.appendChild(reactLbl);
      secFx.appendChild(rowReact);

      body.appendChild(secFx);

      card.appendChild(body);
      list.appendChild(card);
    });
    
    // Если выбранный объект был удалён — сбрасываем выбор
    if (_previewSelectedOvId && !BackgroundEngine.overlays.find(o => o.id === _previewSelectedOvId)) {
      _stopPreviewAnim();
      _previewSelectedOvId = null;
    }

    // Wire up animation control buttons (once per render)
    const animBtn  = overlay.querySelector('#fxeOvAnimBtn');
    const animStop = overlay.querySelector('#fxeOvAnimStop');
    if (animBtn && !animBtn.dataset.wired) {
      animBtn.dataset.wired = '1';
      animBtn.addEventListener('click', () => {
        if (!_previewSelectedOvId) return;
        _previewAnimActive = true;
        animBtn.style.display  = 'none';
        animStop.style.display = '';
        updateOverlayPreview(true);
      });
    }
    if (animStop && !animStop.dataset.wired) {
      animStop.dataset.wired = '1';
      animStop.addEventListener('click', () => {
        _stopPreviewAnim();
        updateOverlayPreview(false); // Redraw static
      });
    }

    // Update overlay preview canvas (static frame)
    updateOverlayPreview(false);
  }

  /* ── Preview helpers ────────────────────────── */
  function _stopPreviewAnim() {
    if (_previewRafHandle !== null) {
      cancelAnimationFrame(_previewRafHandle);
      _previewRafHandle = null;
    }
    _previewAnimActive = false;
    // Update button states if controls exist
    const animBtn  = overlay && overlay.querySelector('#fxeOvAnimBtn');
    const animStop = overlay && overlay.querySelector('#fxeOvAnimStop');
    if (animBtn)  { animBtn.style.display  = ''; animBtn.textContent = '▶ Анимация'; }
    if (animStop) animStop.style.display = 'none';
  }

  /* ── Overlay Preview Canvas ─────────────────── */
  function updateOverlayPreview(animated) {
    const canvas = overlay.querySelector('#fxeOvPreviewCanvas');
    if (!canvas) return;
    
    // Получаем размер основного холста
    const mainCanvas = document.getElementById('mainCanvas');
    if (mainCanvas) {
      canvas.width = mainCanvas.width;
      canvas.height = mainCanvas.height;
    }
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    
    // ── Update hint/controls visibility ──
    const hint     = overlay.querySelector('#fxeOvPreviewHint');
    const controls = overlay.querySelector('#fxeOvPreviewControls');
    const nameEl   = overlay.querySelector('#fxeOvPreviewName');

    const selectedOv = _previewSelectedOvId
      ? BackgroundEngine.overlays.find(o => o.id === _previewSelectedOvId)
      : null;

    if (hint)     hint.style.display     = selectedOv ? 'none' : '';
    if (controls) controls.style.display = selectedOv ? 'flex' : 'none';
    if (nameEl && selectedOv) {
      nameEl.textContent = selectedOv.type === 'text'
        ? (selectedOv.text || '(текст)').slice(0, 20)
        : selectedOv.type === 'frame'
        ? `⬡ ${(selectedOv.frameStyle || 'baroque').toUpperCase()}`
        : selectedOv.type === 'effect'
        ? `✨ ${(selectedOv.effectType || 'effect').toUpperCase()}`
        : selectedOv.name;
    }

    // Clear with dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    
    // Draw grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    
    // Draw sample text in center
    ctx.save();
    ctx.font = "48px 'Bebas Neue', sans-serif";
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SAMPLE TEXT', w / 2, h / 2);
    ctx.restore();

    if (!selectedOv) return; // Нет выбранного — рисуем только фон
    
    // Draw only the selected overlay
    const ov = selectedOv;
    const isText   = ov.type === 'text';
    const isFrame  = ov.type === 'frame';
    const isEffect = ov.type === 'effect';

    // Рамки рендерим через FrameDrawEngine напрямую
    if (isFrame) {
      const t = animated ? (performance.now() / 1000) : 0;
      const bands = { bass: animated ? (0.3 + 0.3 * Math.sin(t * 3)) : 0.3, mid: 0.2, high: 0.1 };
      ctx.save();
      ctx.globalAlpha = ov.opacity || 1;
      if (typeof BackgroundEngine.FrameDrawEngine !== 'undefined') {
        BackgroundEngine.FrameDrawEngine.draw(ctx, w, h, ov, bands, t);
      }
      ctx.restore();
      if (animated) {
        _previewRafHandle = requestAnimationFrame(() => updateOverlayPreview(true));
      }
      return;
    }

    // Эффекты рисуем через общий путь drawOverlays (т.к. _drawOverlayItem
    // умеет отрисовывать тип 'effect' и обновляет fadeAlpha согласованно).
    if (isEffect) {
      const t = animated ? (performance.now() / 1000) : 0;
      const dt = animated ? 0.016 : 0;
      const bands = {
        bass: animated ? (0.3 + 0.3 * Math.sin(t * 3)) : 0.3,
        mid:  animated ? (0.2 + 0.2 * Math.sin(t * 2.4)) : 0.2,
        high: animated ? (0.15 + 0.15 * Math.sin(t * 5.1)) : 0.15,
        overall: 0.4,
      };
      ctx.save();
      ctx.globalAlpha = ov.opacity != null ? ov.opacity : 1;
      // Прямой вызов рендера эффекта — минуем fade-систему drawOverlays для превью
      if (typeof BackgroundEngine.drawOverlays === 'function') {
        // Используем upcheck: вместо того чтобы трогать общий рендер,
        // временно ставим fadeAlpha=1, рисуем через _drawOverlayItem сэмулируем
        // вручную — но проще просто инвокнуть рисующую функцию через прокси.
      }
      // Используем _drawOverlayItem косвенно через прямой кадр draw — у нас нет
      // прямого экспорта _drawEffectByType, поэтому вызовем drawOverlays на этом
      // временном холсте, передав активный индекс -1 и фейковый currentLyric.
      // Самый простой путь: эмулируем рендер через ctx — но эффекты используют
      // только intensity/fxColor/effectType, поэтому продублируем минимальную
      // логику здесь же:
      const hex = (ov.fxColor || '#ffffff').replace('#','');
      const hh = hex.length === 3 ? hex.split('').map(c=>c+c).join('') : hex;
      const rgb = parseInt(hh, 16);
      const c = { r:(rgb>>16)&255, g:(rgb>>8)&255, b:rgb&255 };
      const intensity = Math.max(0, Math.min(1, ov.intensity != null ? ov.intensity : 0.5));

      switch (ov.effectType) {
        case 'vignette': {
          const innerR = Math.min(w, h) * (0.55 - intensity*0.25);
          const outerR = Math.sqrt(w*w + h*h) / 2;
          const grad = ctx.createRadialGradient(w/2, h/2, innerR, w/2, h/2, outerR);
          grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},0)`);
          grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},${0.4 + intensity*0.5})`);
          ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
          break;
        }
        case 'scanlines': {
          const gap = Math.max(2, Math.round(6 - intensity*3));
          const off = Math.floor(t*20) % gap;
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.18 + intensity*0.35})`;
          for (let yy = off; yy < h; yy += gap) ctx.fillRect(0, yy, w, 1);
          break;
        }
        case 'flash': {
          const a = Math.max(0, bands.bass - 0.25) * intensity * 1.2;
          if (a >= 0.01) {
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${Math.min(0.85, a)})`;
            ctx.fillRect(0, 0, w, h);
          }
          break;
        }
        case 'lightleak': {
          const cx = w * (0.3 + Math.sin(t*0.3)*0.1);
          const cy = h * (0.4 + Math.cos(t*0.25)*0.1);
          const r  = Math.max(w, h) * (0.4 + intensity*0.4);
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${0.35 + intensity*0.45})`);
          grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'colorTint': {
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.3 + intensity*0.5})`;
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'rain': {
          ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${0.45 + intensity*0.4})`;
          ctx.lineWidth = 1 + intensity*1.5;
          const count = Math.floor(80 + intensity*180);
          for (let i = 0; i < count; i++) {
            const x = ((i * 37) % 100) / 100 * w + Math.sin(t*1.5 + i) * 4;
            const y = (((i * 53 + (animated ? t*200 : 0)) % h) + h) % h;
            ctx.beginPath(); ctx.moveTo(x, y);
            ctx.lineTo(x - 4*intensity, y + 16 + intensity*16);
            ctx.stroke();
          }
          break;
        }
        case 'snow': {
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.55 + intensity*0.35})`;
          const count = Math.floor(40 + intensity*100);
          for (let i = 0; i < count; i++) {
            const x = ((i * 73) % 100) / 100 * w + Math.sin(t*0.6 + i*0.3) * 18;
            const y = (((i * 41 + (animated ? t*40 : 0)) % h) + h) % h;
            ctx.beginPath(); ctx.arc(x, y, 1.2 + intensity*2.5, 0, Math.PI*2); ctx.fill();
          }
          break;
        }
        case 'particles': {
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.4 + intensity*0.5})`;
          const count = Math.floor(20 + intensity*60);
          for (let i = 0; i < count; i++) {
            const x = ((i * 67 + (animated ? t*30 : 0)) % w + w) % w;
            const y = ((i * 89 + (animated ? t*20 : 0)) % h + h) % h;
            const r = 2 + intensity*4;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
          }
          break;
        }
        case 'noise': {
          // Лёгкое зерно через случайные точки (превью)
          const prev = ctx.globalAlpha;
          ctx.globalAlpha = prev * (0.15 + intensity*0.35);
          for (let i = 0; i < 4000; i++) {
            const v = (Math.random()*255)|0;
            ctx.fillStyle = `rgba(${v},${v},${v},0.4)`;
            ctx.fillRect(Math.random()*w, Math.random()*h, 1, 1);
          }
          ctx.globalAlpha = prev;
          break;
        }
        case 'chromatic': {
          const off = (2 + intensity*8) * (1 + bands.high);
          const a = 0.18 + intensity*0.25;
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = `rgba(255,0,0,${a})`; ctx.fillRect(-off, 0, w, h);
          ctx.fillStyle = `rgba(0,255,255,${a})`; ctx.fillRect(off, 0, w, h);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'vhsLines': {
          const count = 1 + Math.floor(intensity*3);
          for (let i = 0; i < count; i++) {
            const yy = ((t * (40 + i*30)) % h + (i*h/count)) % h;
            const hh2 = 4 + intensity*18;
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${0.25 + intensity*0.35})`;
            ctx.fillRect(0, yy, w, hh2);
          }
          break;
        }
        case 'pulseRings': {
          // Превью: 3 кольца на разных стадиях
          const maxR = Math.sqrt(w*w + h*h) * 0.7;
          const speed = 220 + intensity*520;
          for (let i = 0; i < 3; i++) {
            const phase = animated ? ((t * 0.6 + i * 0.33) % 1) : (i * 0.33);
            const r = Math.max(0.01, phase * maxR);
            const a = (1 - phase) * (0.6 + intensity*0.4);
            ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${a})`;
            ctx.lineWidth = 2 + intensity*5;
            ctx.beginPath();
            ctx.arc(w/2, h/2, r, 0, Math.PI*2);
            ctx.stroke();
          }
          break;
        }
        case 'lightning': {
          // Превью: 1-2 псевдо-молнии
          ctx.shadowColor = `rgba(${c.r},${c.g},${c.b},${0.6 + intensity*0.4})`;
          ctx.shadowBlur = 14 + intensity*22;
          ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${0.7 + intensity*0.3})`;
          ctx.lineWidth = 1.5 + intensity*3;
          ctx.lineCap = 'round';
          for (let b = 0; b < 1 + Math.floor(intensity); b++) {
            ctx.beginPath();
            // Простая зигзагообразная линия — детерминированная для статичного превью
            const seed = b * 17 + (animated ? Math.floor(t*4) : 0);
            let x = w * (0.2 + ((seed * 0.37) % 1) * 0.6);
            let y = -10;
            ctx.moveTo(x, y);
            let k = 0;
            while (y < h + 10) {
              const off = ((seed * 31 + k * 7) % 100) / 100 - 0.5;
              x += off * (60 + intensity*80);
              y += 30 + ((seed * 11 + k * 13) % 30);
              ctx.lineTo(x, y);
              k++;
            }
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
          break;
        }
        case 'confetti': {
          // Превью: разноцветные конфетти (без движения если !animated)
          const count = Math.floor(30 + intensity*80);
          for (let i = 0; i < count; i++) {
            const px = ((i * 67) % 100) / 100 * w + Math.sin(t*1.2 + i*0.3) * 14;
            const py = (((i * 53) + (animated ? t*60 : 0)) % h + h) % h;
            const sz = 4 + ((i*11) % 8) + intensity*5;
            const aspect = 0.4 + ((i*7) % 5) / 10;
            const rot = (i * 0.7 + (animated ? t*1.5 : 0)) % (Math.PI*2);
            const hue = (i * 37) % 360;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(rot);
            ctx.fillStyle = `hsla(${hue}, 85%, 60%, ${0.78 + intensity*0.22})`;
            ctx.fillRect(-sz/2, -sz*aspect/2, sz, sz*aspect);
            ctx.restore();
          }
          break;
        }
      }
      ctx.restore();
      if (animated) {
        _previewRafHandle = requestAnimationFrame(() => updateOverlayPreview(true));
      }
      return;
    }

    if (!isText && (!ov.img || !ov.img.complete)) {
      // Изображение ещё не загружено — повторить через 100ms
      setTimeout(() => updateOverlayPreview(false), 100);
      return;
    }

    const t = animated ? (performance.now() / 1000) : 0;
    
    ctx.save();
    ctx.globalAlpha = ov.opacity;
    
    const baseX = (ov.x / 100) * w;
    const baseY = (ov.y / 100) * h;

    let baseW, baseH;
    if (isText) {
      const m = (typeof BackgroundEngine.measureTextOverlay === 'function')
        ? BackgroundEngine.measureTextOverlay(ov, w, h)
        : { w: 200, h: 60 };
      baseW = m.w;
      baseH = m.h;
    } else {
      baseW = (ov.width / 100) * w;
      baseH = baseW / (ov.img.naturalWidth / ov.img.naturalHeight);
    }
    
    let offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1, rotation = 0;
    const amt = ov.effectAmt;
    
    switch (ov.effect) {
      case 'sway':
        offsetX = Math.sin(t * 2) * 20 * amt;
        break;
      case 'pulse':
        scaleX = scaleY = 1 + Math.sin(t * 4) * 0.2 * amt;
        break;
      case 'float':
        offsetY = Math.sin(t * 1.5) * 15 * amt;
        break;
      case 'shake':
        offsetX = (Math.random() - 0.5) * 10 * amt;
        offsetY = (Math.random() - 0.5) * 10 * amt;
        break;
      case 'bounce':
        offsetY = Math.abs(Math.sin(t * 3)) * -30 * amt;
        break;
      case 'spin':
        rotation = t * amt;
        break;
      case 'stretch':
        scaleX = 1 + Math.sin(t * 3) * 0.3 * amt;
        scaleY = 1 - Math.sin(t * 3) * 0.15 * amt;
        break;
      // ── Новые эффекты v2 ──────────────────────────
      case 'zoom':
        // Симулируем бас синусоидой в превью
        scaleX = scaleY = 1 + Math.abs(Math.sin(t * 3.5)) * 0.45 * amt;
        break;
      case 'breathe':
        scaleX = scaleY = 1 + Math.sin(t * 0.9) * 0.12 * amt + Math.sin(t * 2.3) * 0.05 * amt;
        break;
      case 'presence': {
        // В превью реального звука нет — эмулируем БИТ (короткие удары),
        // а не плавную волну: сам эффект в движке синусов от времени не имеет.
        const simBass = Math.pow(Math.abs(Math.sin(t * 2.4)), 6);
        const kick = Math.max(0, simBass - 0.22);
        scaleX = scaleY = 1 + (kick * 0.55 + 0.12 * 0.20) * amt;
        break;
      }
      case 'glitch':
        offsetX = (Math.random() > 0.6 ? (Math.random() - 0.5) * 40 : 0) * amt;
        offsetY = (Math.random() > 0.8 ? (Math.random() - 0.5) * 15 : 0) * amt;
        scaleX = 1 + (Math.random() > 0.7 ? (Math.random() - 0.5) * 0.2 : 0) * amt;
        break;
      case 'orbit': {
        const r = amt * 50;
        offsetX = Math.cos(t * 1.2) * r;
        offsetY = Math.sin(t * 1.2) * r * 0.55;
        break;
      }
      case 'pendulum':
        rotation = Math.sin(t * 1.6) * 0.55 * amt;
        break;
      case 'vortex':
        rotation = t * amt * 0.8;
        scaleX = scaleY = 1 + Math.abs(Math.sin(t * 3)) * 0.25 * amt;
        break;
      case 'heartbeat': {
        const beat = Math.abs(Math.sin(t * 3.5)) > 0.75 ? Math.abs(Math.sin(t * 3.5)) : 0;
        scaleX = scaleY = 1 + beat * 0.45 * amt;
        offsetY = -beat * 18 * amt;
        break;
      }
      case 'drift':
        offsetX = Math.sin(t * 0.4) * 40 * amt;
        offsetY = Math.cos(t * 0.55) * 25 * amt;
        break;
      // ── Кинематические режимы (глобальные) ──────────
      case 'cinematic': {
        const scBase = 1 + Math.abs(Math.sin(t * 0.9)) * 0.2 * amt;
        scaleX = scaleY = scBase;
        offsetX = (Math.sin(t * 1.3) * 0.4 + Math.sin(t * 2.7) * 0.3) * 20 * amt;
        offsetY = (Math.cos(t * 1.1) * 0.3 + Math.cos(t * 2.3) * 0.2) * 18 * amt;
        rotation = Math.sin(t * 0.9) * 0.015 * amt;
        break;
      }
      case 'flash': {
        // Периодическая вспышка — эмулируем бас как sin²
        const beat = Math.pow(Math.abs(Math.sin(t * 2.8)), 4);
        scaleX = scaleY = 1 + beat * 0.75 * amt;
        break;
      }
      case 'impact': {
        const hit = Math.pow(Math.abs(Math.sin(t * 2.5)), 3);
        scaleX = 1 + hit * 0.35 * amt;
        scaleY = 1 - hit * 0.18 * amt;
        offsetX = Math.sin(t * 87.1) * hit * 30 * amt;
        offsetY = Math.cos(t * 91.7) * hit * 18 * amt;
        break;
      }
      case 'parallax': {
        const depth = 1 + Math.abs(Math.sin(t * 1.8)) * 0.22 * amt;
        scaleX = scaleY = depth;
        offsetX = Math.sin(t * 0.35) * 40 * amt;
        offsetY = Math.cos(t * 0.45) * 25 * amt;
        rotation = Math.sin(t * 0.55) * 0.025 * amt;
        break;
      }
      case 'path': {
        const freq = 0.9;
        offsetX = Math.sin(t * freq) * 90 * amt;
        offsetY = Math.sin(t * freq * 2 + 0.7) * 45 * amt;
        rotation = Math.cos(t * freq) * 0.12 * amt;
        break;
      }
      // ── Прокрутка (в превью показываем линейное движение, без wrap) ──
      case 'scroll_left':    offsetX = -((t * 150 * amt) % (w * 0.5)); break;
      case 'scroll_right':   offsetX =  ((t * 150 * amt) % (w * 0.5)); break;
      case 'scroll_up':      offsetY = -((t * 120 * amt) % (h * 0.5)); break;
      case 'scroll_down':    offsetY =  ((t * 120 * amt) % (h * 0.5)); break;
      case 'scroll_diag_dr': offsetX =  ((t * 130 * amt) % (w * 0.5));
                             offsetY =  ((t * 130 * amt * 0.6) % (h * 0.4)); break;
      case 'scroll_diag_ul': offsetX = -((t * 130 * amt) % (w * 0.5));
                             offsetY = -((t * 130 * amt * 0.6) % (h * 0.4)); break;
      // Per-word режимы в превью показываются как статичный текст —
      // полноценный рендер через AnimModes идёт только на главной сцене.
    }
    
    const drawW = baseW * scaleX;
    const drawH = baseH * scaleY;
    
    ctx.translate(baseX + offsetX, baseY + offsetY);
    if (rotation) ctx.rotate(rotation);
    
    if (isText) {
      if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
      const scaleRef = h / 1080;
      const fontSize = Math.max(4, (ov.fontSize || 64) * scaleRef);
      const weight = ov.bold ? '700' : '400';
      const style  = ov.italic ? 'italic' : 'normal';
      const font   = ov.font || "'Bebas Neue', cursive";
      ctx.font         = `${style} ${weight} ${fontSize}px ${font}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      const lines2   = (ov.text || '').split('\n');
      const lineGap = fontSize * 1.15;
      const totalH  = lineGap * lines2.length;

      let maxW = 0;
      lines2.forEach(ln => {
        const m = ctx.measureText(ln);
        if (m.width > maxW) maxW = m.width;
      });

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

      if (ov.shadowEnabled && ov.shadowColor && ov.shadowBlur > 0) {
        ctx.shadowColor = ov.shadowColor;
        ctx.shadowBlur  = ov.shadowBlur * scaleRef;
      }
      const hasStroke = ov.strokeEnabled && ov.strokeColor && ov.strokeWidth > 0;
      if (hasStroke) {
        ctx.strokeStyle = ov.strokeColor;
        ctx.lineWidth   = ov.strokeWidth * scaleRef;
        ctx.lineJoin    = 'round';
        ctx.miterLimit  = 2;
      }
      ctx.fillStyle = ov.color || '#ffffff';

      const startY  = -totalH / 2 + lineGap / 2;
      lines2.forEach((ln, i) => {
        const y = startY + i * lineGap;
        if (hasStroke) ctx.strokeText(ln, 0, y);
        ctx.fillText(ln, 0, y);
      });
    } else {
      ctx.drawImage(ov.img, -drawW / 2, -drawH / 2, drawW, drawH);
    }
    
    ctx.restore();

    // Continue animation loop only if active
    if (animated && _previewAnimActive) {
      _previewRafHandle = requestAnimationFrame(() => updateOverlayPreview(true));
    }
  }

  /* ── Overlay Preview Drag & Drop ────────────── */
  let dragState = {
    active: false,
    overlayId: null,
    startX: 0,
    startY: 0,
    startOvX: 0,
    startOvY: 0,
  };

  // Хелпер: возвращает границы overlay в пикселях canvas (центр, ширина, высота)
  function _getOvBounds(ov, canvasW, canvasH) {
    const baseX = (ov.x / 100) * canvasW;
    const baseY = (ov.y / 100) * canvasH;
    let baseW, baseH;
    if (ov.type === 'text') {
      const m = (typeof BackgroundEngine.measureTextOverlay === 'function')
        ? BackgroundEngine.measureTextOverlay(ov, canvasW, canvasH)
        : { w: 200, h: 60 };
      baseW = Math.max(40, m.w);      // минимум 40 px — чтобы можно было схватить пустой/узкий
      baseH = Math.max(30, m.h);
    } else {
      if (!ov.img || !ov.img.complete) return null;
      baseW = (ov.width / 100) * canvasW;
      baseH = baseW / (ov.img.naturalWidth / ov.img.naturalHeight);
    }
    return { baseX, baseY, baseW, baseH };
  }

  function setupOverlayDrag() {
    const canvas = overlay.querySelector('#fxeOvPreviewCanvas');
    if (!canvas) return;
    
    // Проверяем, не установлены ли уже обработчики
    if (canvas.dataset.dragSetup) return;
    canvas.dataset.dragSetup = 'true';
    
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;
      
      // Находим объект под курсором (проверяем с конца, чтобы верхние были приоритетнее)
      const ovs = BackgroundEngine.overlays.filter(ov => ov.enabled);
      for (let i = ovs.length - 1; i >= 0; i--) {
        const ov = ovs[i];
        const b = _getOvBounds(ov, canvas.width, canvas.height);
        if (!b) continue;
        
        // Проверяем попадание в прямоугольник объекта
        if (canvasX >= b.baseX - b.baseW / 2 && canvasX <= b.baseX + b.baseW / 2 &&
            canvasY >= b.baseY - b.baseH / 2 && canvasY <= b.baseY + b.baseH / 2) {
          // Переключаем объект в режим custom если он не в нём
          if (ov.positionMode !== 'custom') {
            BackgroundEngine.updateOverlay(ov.id, { positionMode: 'custom' });
          }
          
          dragState.active = true;
          dragState.overlayId = ov.id;
          dragState.startX = canvasX;
          dragState.startY = canvasY;
          dragState.startOvX = ov.x;
          dragState.startOvY = ov.y;
          canvas.style.cursor = 'grabbing';
          break;
        }
      }
    });
    
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (e.clientX - rect.left) * scaleX;
      const canvasY = (e.clientY - rect.top) * scaleY;
      
      if (dragState.active && dragState.overlayId) {
        // Вычисляем смещение в пикселях
        const deltaX = canvasX - dragState.startX;
        const deltaY = canvasY - dragState.startY;
        
        // Конвертируем в проценты
        const deltaXPercent = (deltaX / canvas.width) * 100;
        const deltaYPercent = (deltaY / canvas.height) * 100;
        
        // Применяем новую позицию с ограничениями
        const newX = Math.max(0, Math.min(100, dragState.startOvX + deltaXPercent));
        const newY = Math.max(0, Math.min(100, dragState.startOvY + deltaYPercent));
        
        BackgroundEngine.updateOverlay(dragState.overlayId, { x: newX, y: newY });
        renderOverlayPanel();
      } else {
        // Проверяем, находится ли курсор над объектом (для изменения курсора)
        const ovs = BackgroundEngine.overlays.filter(ov => ov.enabled);
        let overObject = false;
        
        for (let i = ovs.length - 1; i >= 0; i--) {
          const ov = ovs[i];
          const b = _getOvBounds(ov, canvas.width, canvas.height);
          if (!b) continue;
          
          if (canvasX >= b.baseX - b.baseW / 2 && canvasX <= b.baseX + b.baseW / 2 &&
              canvasY >= b.baseY - b.baseH / 2 && canvasY <= b.baseY + b.baseH / 2) {
            overObject = true;
            break;
          }
        }
        
        canvas.style.cursor = overObject ? 'grab' : 'default';
      }
    });
    
    canvas.addEventListener('mouseup', () => {
      if (dragState.active) {
        dragState.active = false;
        dragState.overlayId = null;
        canvas.style.cursor = 'grab';
      }
    });
    
    canvas.addEventListener('mouseleave', () => {
      if (dragState.active) {
        dragState.active = false;
        dragState.overlayId = null;
        canvas.style.cursor = 'default';
      }
    });
  }

  /* ── Line Selector Side Panel ───────────────── */
  let currentOverlayId = null;
  let lsMode = 'overlay';   // 'overlay' | 'scene'
  let lsTargetId = null;

  function _lsGetTarget() {
    if (lsMode === 'overlay') return BackgroundEngine.overlays.find(o => o.id === lsTargetId) || null;
    if (lsMode === 'scene')   return BackgroundEngine.camScenes.find(s => s.id === lsTargetId) || null;
    return null;
  }
  function _lsUpdate(props) {
    if (lsMode === 'overlay') return BackgroundEngine.updateOverlay(lsTargetId, props);
    if (lsMode === 'scene')   return BackgroundEngine.updateCamScene(lsTargetId, props);
  }

  // Старая сигнатура: openLineSelectorPanel(overlayId)
  // Новая:           openLineSelectorPanel('scene', sceneId)
  function openLineSelectorPanel(arg1, arg2) {
    if (arg2 !== undefined) { lsMode = arg1; lsTargetId = arg2; }
    else                    { lsMode = 'overlay'; lsTargetId = arg1; }
    currentOverlayId = (lsMode === 'overlay') ? lsTargetId : null;
    const overlayId = lsTargetId; // legacy alias for downstream code

    const panel = overlay.querySelector('#fxeLineSelectorPanel');
    const backdrop = overlay.querySelector('#fxeLsBackdrop');
    const list = overlay.querySelector('#fxeLsList');
    const counter = overlay.querySelector('#fxeLsCounter');
    const settings = overlay.querySelector('#fxeLsSettings');
    const titleEl  = overlay.querySelector('.fxe-ls-title');

    const ov = _lsGetTarget();
    if (!ov) return;

    // В режиме сцены прячем оверлейные настройки и меняем заголовок
    if (settings) settings.style.display = (lsMode === 'overlay') ? '' : 'none';
    if (titleEl) {
      titleEl.textContent = (lsMode === 'scene')
        ? `СТРОКИ ДЛЯ "${ov.name}"`
        : 'ВЫБОР СТРОК';
    }

    backdrop.style.display = 'block';
    panel.style.display = 'flex';
    
    // Render lines
    list.innerHTML = '';
    if (!Array.isArray(lines) || !lines.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:Space Mono,monospace;font-size:11px;color:#666;text-align:center;padding:24px;letter-spacing:1px;';
      empty.textContent = '— Нет строк лирики —';
      list.appendChild(empty);
      counter.textContent = `0 / 0`;
      return;
    }
    lines.forEach((line, idx) => {
      try {
      if (!line || typeof line !== 'object') return;
      if (!Array.isArray(line.tokens)) line.tokens = [{ word:'(пусто)', effects:[], color:null }];
      const item = document.createElement('div');
      item.className = 'fxe-ls-line-item';
      if ((ov.selectedLines || []).includes(idx)) {
        item.classList.add('selected');
      }
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'fxe-ls-line-check';
      checkbox.checked = (ov.selectedLines || []).includes(idx);
      checkbox.dataset.index = idx;
      
      checkbox.addEventListener('click', (e) => {
        // Shift+click для выбора диапазона
        if (e.shiftKey && window.lastCheckedIndex !== undefined && window.lastCheckedIndex !== idx) {
          e.preventDefault();
          
          const start = Math.min(window.lastCheckedIndex, idx);
          const end = Math.max(window.lastCheckedIndex, idx);
          
          // Определяем состояние на основе последнего выбранного
          const lastCheckbox = list.querySelector(`.fxe-ls-line-check[data-index="${window.lastCheckedIndex}"]`);
          const targetState = lastCheckbox ? lastCheckbox.checked : true;
          
          // Получаем текущий список выбранных
          let newSelected = [...(ov.selectedLines || [])];
          
          // Применяем состояние ко всем в диапазоне
          for (let i = start; i <= end; i++) {
            if (targetState) {
              if (!newSelected.includes(i)) {
                newSelected.push(i);
              }
            } else {
              newSelected = newSelected.filter(x => x !== i);
            }
          }
          
          newSelected.sort((a,b) => a-b);
          _lsUpdate({ selectedLines: newSelected });
          
          // Обновляем UI
          const allCheckboxes = list.querySelectorAll('.fxe-ls-line-check');
          const allItems = list.querySelectorAll('.fxe-ls-line-item');
          allCheckboxes.forEach((cb, i) => {
            if (i >= start && i <= end) {
              cb.checked = targetState;
              if (targetState) {
                allItems[i].classList.add('selected');
              } else {
                allItems[i].classList.remove('selected');
              }
            }
          });
          
          // Update counter
          counter.textContent = `${newSelected.length} / ${lines.length}`;
          
        } else {
          // Обычный клик
          setTimeout(() => {
            let selected = [...(ov.selectedLines || [])];
            
            if (checkbox.checked) {
              if (!selected.includes(idx)) {
                selected.push(idx);
                selected.sort((a,b) => a-b);
              }
              item.classList.add('selected');
            } else {
              selected = selected.filter(i => i !== idx);
              item.classList.remove('selected');
            }
            
            _lsUpdate({ selectedLines: selected });

            // Update counter
            counter.textContent = `${selected.length} / ${lines.length}`;
          }, 0);
        }
        
        // Сохраняем индекс последнего кликнутого
        window.lastCheckedIndex = idx;
      });
      
      const content = document.createElement('div');
      content.className = 'fxe-ls-line-content';
      
      const time = document.createElement('div');
      time.className = 'fxe-ls-line-time';
      time.textContent = `#${idx + 1} · ${line.time}`;
      
      const text = document.createElement('div');
      text.className = 'fxe-ls-line-text';
      text.textContent = tokensToText(line.tokens);
      
      content.appendChild(time);
      content.appendChild(text);
      
      // Добавляем кнопки выше/ниже и селектор анимации только в режиме оверлеев.
      // В режиме сцены — только чекбокс выбора строки.
      const controls = document.createElement('div');
      controls.className = 'fxe-ls-line-controls';
      if (lsMode !== 'overlay') {
        item.appendChild(checkbox);
        item.appendChild(content);
        list.appendChild(item);
        return; // skip per-line layer/anim controls
      }

      // Получаем текущую настройку lineStyle для этой строки
      const currentLayer = (line.lineStyle && line.lineStyle.layer) || null;
      const currentAnim = (line.lineStyle && line.lineStyle.animMode) || '';
      
      // Селектор эффекта объекта
      const animSelect = document.createElement('select');
      animSelect.className = 'fxe-ls-line-anim-select';
      let animOpts = `
        <option value="">— эффект —</option>
        <option value="static">Статика</option>
        <option value="sway">Покачивание</option>
        <option value="pulse">Пульс (бас)</option>
        <option value="zoom">⚡ Зум (бас)</option>
        <option value="heartbeat">💓 Сердце (бас)</option>
        <option value="stretch">Растяжение</option>
        <option value="float">Плавание</option>
        <option value="breathe">🫁 Дыхание</option>
        <option value="drift">🌊 Дрейф</option>
        <option value="orbit">🪐 Орбита</option>
        <option value="bounce">Отскок</option>
        <option value="shake">Тряска</option>
        <option value="glitch">📡 Глитч (бас)</option>
        <option value="pendulum">⏱ Маятник</option>
        <option value="vortex">🌀 Вортекс</option>
        <option value="spin">Вращение</option>
        <option value="cinematic">🎬 Кино</option>
        <option value="flash">⚡ Flash</option>
        <option value="impact">💥 Impact</option>
        <option value="parallax">🌌 Parallax</option>
        <option value="path">〜 Path</option>
        <option value="" disabled>── Прокрутка ──</option>
        <option value="scroll_left">← Прокрутка влево</option>
        <option value="scroll_right">→ Прокрутка вправо</option>
        <option value="scroll_up">↑ Прокрутка вверх</option>
        <option value="scroll_down">↓ Прокрутка вниз</option>
        <option value="scroll_diag_dr">↘ Прокрутка диаг</option>
        <option value="scroll_diag_ul">↖ Прокрутка диаг</option>
      `;
      // Per-word режимы — только для text-объектов
      if (ov.type === 'text') {
        animOpts += `
        <option value="" disabled>── Per-word (только текст) ──</option>
        <option value="cascade">🪜 Cascade</option>
        <option value="snap">🧲 Snap</option>
        <option value="scatter">💥 Scatter</option>
        <option value="shatter">✨ Shatter</option>
        <option value="cipher">🔐 Cipher</option>
        <option value="ripple">💧 Ripple</option>
        `;
      }
      animSelect.innerHTML = animOpts;
      // Читаем из ov.lineAnimations[idx] — per-object, per-line хранилище.
      // Это не затрагивает другие объекты на сцене (был баг: писалось в lineStyle строки
      // и применялось ко ВСЕМ объектам одновременно).
      const currentEffect = (ov.lineAnimations && ov.lineAnimations[idx]) || '';
      if (currentEffect) animSelect.value = currentEffect;
      
      animSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        const lineAnims = Object.assign({}, ov.lineAnimations || {});
        if (animSelect.value) {
          lineAnims[idx] = animSelect.value;
        } else {
          delete lineAnims[idx];
        }
        BackgroundEngine.updateOverlay(overlayId, { lineAnimations: lineAnims });
        // lineStyle строк не меняем — настройка принадлежит объекту, а не строке
      });
      
      controls.appendChild(animSelect);
      
      // Контейнер для кнопок слоя
      const layerBtns = document.createElement('div');
      layerBtns.className = 'fxe-ls-line-layer-btns';
      
      // Кнопка "Выше текста"
      const btnAbove = document.createElement('button');
      btnAbove.className = 'fxe-ls-line-layer-btn' + (currentLayer === 'above' ? ' active' : '');
      btnAbove.textContent = '⬆';
      btnAbove.title = 'Выше текста';
      btnAbove.addEventListener('click', (e) => {
        e.stopPropagation();
        saveHistory();
        lines[idx].lineStyle = lines[idx].lineStyle || {};
        if (lines[idx].lineStyle.layer === 'above') {
          lines[idx].lineStyle.layer = null;
          btnAbove.classList.remove('active');
        } else {
          lines[idx].lineStyle.layer = 'above';
          btnAbove.classList.add('active');
          btnBelow.classList.remove('active');
        }
        renderEditor();
        renderOutput();
      });
      
      // Кнопка "Ниже текста"
      const btnBelow = document.createElement('button');
      btnBelow.className = 'fxe-ls-line-layer-btn' + (currentLayer === 'below' ? ' active' : '');
      btnBelow.textContent = '⬇';
      btnBelow.title = 'Ниже текста';
      btnBelow.addEventListener('click', (e) => {
        e.stopPropagation();
        saveHistory();
        lines[idx].lineStyle = lines[idx].lineStyle || {};
        if (lines[idx].lineStyle.layer === 'below') {
          lines[idx].lineStyle.layer = null;
          btnBelow.classList.remove('active');
        } else {
          lines[idx].lineStyle.layer = 'below';
          btnBelow.classList.add('active');
          btnAbove.classList.remove('active');
        }
        renderEditor();
        renderOutput();
      });
      
      layerBtns.appendChild(btnAbove);
      layerBtns.appendChild(btnBelow);
      controls.appendChild(layerBtns);
      content.appendChild(controls);
      
      item.appendChild(checkbox);
      item.appendChild(content);
      list.appendChild(item);
      } catch (err) {
        console.error(`[FxEditor] Ошибка рендера строки селектора #${idx}:`, err, line);
      }
    });

    // Update counter
    counter.textContent = `${(ov.selectedLines || []).length} / ${lines.length}`;
  }

  function closeLineSelectorPanel() {
    const panel = overlay.querySelector('#fxeLineSelectorPanel');
    const backdrop = overlay.querySelector('#fxeLsBackdrop');
    panel.style.display = 'none';
    backdrop.style.display = 'none';
    const wasMode = lsMode;
    currentOverlayId = null;
    lsTargetId = null;
    if (wasMode === 'overlay') renderOverlayPanel();
    if (wasMode === 'scene')   renderScenesPanel();
    lsMode = 'overlay';
  }

  /* ── Render ─────────────────────────────────── */
  function renderEditor() {
    const scroll = overlay.querySelector('#fxeEditorScroll');
    if (!scroll) { console.error('[FxEditor] #fxeEditorScroll not found'); return; }
    scroll.innerHTML = '';

    if (!Array.isArray(lines) || !lines.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-family:Space Mono,monospace;font-size:11px;color:#666;text-align:center;padding:32px;letter-spacing:1px;';
      empty.textContent = '— Нет строк лирики. Введи текст на вкладке Текст и снова открой FX редактор —';
      scroll.appendChild(empty);
      return;
    }

    lines.forEach((line, li) => {
      try {
      // Защита от сломанной строки: создаём минимальные поля
      if (!line || typeof line !== 'object') {
        lines[li] = { time:'00:00.00', rawText:'', section:null, tokens:[{word:'(пусто)',effects:[],color:null}], bgCmds:{}, camCmds:{}, lineStyle:{} };
        line = lines[li];
      }
      if (!Array.isArray(line.tokens)) line.tokens = [{ word:'(пусто)', effects:[], color:null }];
      if (!line.bgCmds)   line.bgCmds = {};
      if (!line.camCmds)  line.camCmds = {};
      if (!line.lineStyle) line.lineStyle = {};

      const wrap = document.createElement('div');
      wrap.className = 'fxe-line-wrap';

      // ── Actions row: timestamp + BG toggles + util
      const actions = document.createElement('div');
      actions.className = 'fxe-line-actions';

      const timeInp = document.createElement('input');
      timeInp.className = 'fxe-time-inp';
      timeInp.value = line.time;
      timeInp.addEventListener('change', e => {
        saveHistory(); lines[li].time = e.target.value; renderOutput();
      });
      actions.appendChild(timeInp);

      // Section badge
      if (line.section) {
        const sec = document.createElement('span');
        sec.className = 'fxe-section-badge';
        sec.textContent = line.section;
        actions.appendChild(sec);
      }

      // Кнопка раскрытия дополнительных настроек
      const expandBtn = document.createElement('button');
      expandBtn.className = 'fxe-btn fxe-btn-ghost fxe-expand-btn';
      expandBtn.textContent = '⚙';
      expandBtn.title = 'Показать/скрыть BG и камеру';
      expandBtn.style.cssText = 'padding:3px 8px;flex-shrink:0;margin-left:auto;';
      
      // Util buttons
      const selAllBtn = document.createElement('button');
      selAllBtn.className = 'fxe-btn fxe-btn-ghost fxe-sel-all-btn';
      selAllBtn.textContent = '▣';
      selAllBtn.title = 'Выделить все слова строки';
      selAllBtn.style.cssText = 'padding:3px 8px;flex-shrink:0;font-size:9px;';
      selAllBtn.addEventListener('click', () => selectAllInLine(li));

      const dupBtn = document.createElement('button');
      dupBtn.className = 'fxe-btn fxe-btn-ghost';
      dupBtn.textContent = '⧉';
      dupBtn.title = 'Дублировать строку';
      dupBtn.style.cssText = 'padding:3px 8px;flex-shrink:0;';
      dupBtn.onclick = () => { saveHistory(); lines.splice(li+1,0,JSON.parse(JSON.stringify(line))); renderEditor(); renderOutput(); };

      const delBtn = document.createElement('button');
      delBtn.className = 'fxe-btn fxe-btn-danger';
      delBtn.textContent = '✕';
      delBtn.title = 'Удалить строку';
      delBtn.style.cssText = 'padding:3px 8px;flex-shrink:0;';
      delBtn.onclick = () => { saveHistory(); lines.splice(li,1); selectedToks=[]; renderEditor(); renderOutput(); };

      actions.appendChild(expandBtn);
      actions.appendChild(selAllBtn);
      actions.appendChild(dupBtn);
      actions.appendChild(delBtn);
      wrap.appendChild(actions);

      // ── Expandable section (BG + Camera) ────────
      const expandable = document.createElement('div');
      expandable.className = 'fxe-expandable';
      expandable.style.display = 'none';

      const bgCmds = line.bgCmds || {};
      const camCmds = line.camCmds || {};

      // Универсальный билдер сегментированного контрола tri-state.
      // states: [{ val, label, color, bg, active, onClick }]
      function buildSeg(states) {
        const seg = document.createElement('div');
        seg.className = 'fxe-seg';
        states.forEach(s => {
          const btn = document.createElement('button');
          btn.className = 'fxe-seg-btn' + (s.active ? ' active' : '') + (s.val === 'none' ? ' seg-none' : '');
          btn.textContent = s.label;
          btn.title = s.tip || '';
          if (s.active && s.color) {
            btn.style.setProperty('--seg-fg', s.color);
            btn.style.setProperty('--seg-bg', s.bg);
          }
          btn.addEventListener('click', s.onClick);
          seg.appendChild(btn);
        });
        return seg;
      }

      function buildCmdRow(label, iconSegOrChip, controlEl) {
        const row = document.createElement('div');
        row.className = 'fxe-cmd-row';
        const lbl = document.createElement('span');
        lbl.className = 'fxe-cmd-label';
        lbl.innerHTML = `<span class="fxe-cmd-label-icon">${iconSegOrChip}</span>${label}`;
        row.appendChild(lbl);
        if (Array.isArray(controlEl)) {
          const inline = document.createElement('div');
          inline.className = 'fxe-cmd-row-inline';
          controlEl.forEach(el => inline.appendChild(el));
          row.appendChild(inline);
        } else {
          row.appendChild(controlEl);
        }
        return row;
      }

      // ── BG секция ─────────────────────────────
      const bgSection = document.createElement('div');
      bgSection.className = 'fxe-cmd-section';
      const bgTitle = document.createElement('div');
      bgTitle.className = 'fxe-cmd-section-title';
      bgTitle.textContent = '// фон';
      bgSection.appendChild(bgTitle);

      const BG_GROUPS = [
        { label:'Затемнение', icon:'🌑', onKey:'darken',    offKey:'undarken',    color:'#b18fff', bg:'rgba(102,68,187,.18)' },
        { label:'Яркость',    icon:'☀',  onKey:'brighten',  offKey:'unbrighten',  color:'#e8cc00', bg:'rgba(136,102,0,.20)' },
        { label:'Размытие',   icon:'💫', onKey:'blur',      offKey:'unblur',      color:'#00cccc', bg:'rgba(0,102,102,.18)' },
        { label:'Леттербокс', icon:'🎬', onKey:'letterbox', offKey:'unletterbox', color:'#cccccc', bg:'rgba(85,85,85,.25)' },
      ];

      BG_GROUPS.forEach(g => {
        const isOn  = !!bgCmds[g.onKey];
        const isOff = !!bgCmds[g.offKey];
        const isLetterbox = g.onKey === 'letterbox';

        // Леттербокс — отдельный 4-х позиционный radio: Стат / Реакт / — / Выкл.
        // Каждое состояние однозначно соответствует одной LRC-команде.
        if (isLetterbox) {
          const isReactive = !!bgCmds.letterboxReactive;
          const isStatic   = isOn && !isReactive;

          const setLetterboxState = (state) => {
            saveHistory();
            lines[li].bgCmds = lines[li].bgCmds || {};
            // state ∈ 'static' | 'reactive' | 'none' | 'off'
            lines[li].bgCmds.letterbox          = (state === 'static' || state === 'reactive');
            lines[li].bgCmds.letterboxReactive  = (state === 'reactive');
            lines[li].bgCmds.unletterbox        = (state === 'off');
            lines[li].bgCmds.unletterboxReactive = false; // deprecated
            renderEditor(); renderOutput();
          };

          const seg = buildSeg([
            { val:'static',   label:'Стат',     color:'#cccccc', bg:'rgba(85,85,85,.25)',  active:isStatic, tip:'/LETTERBOX/ — статичные полосы',
              onClick: () => setLetterboxState(isStatic ? 'none' : 'static'),
            },
            { val:'reactive', label:'♪ Реакт',  color:'#ffaaaa', bg:'rgba(170,85,85,.22)', active:isReactive, tip:'/LETTERBOX REACTIVE/ — пульсируют на бас',
              onClick: () => setLetterboxState(isReactive ? 'none' : 'reactive'),
            },
            { val:'none',     label:'—',        active:!isOn && !isOff, tip:'Без команды на этой строке',
              onClick: () => setLetterboxState('none'),
            },
            { val:'off',      label:'Выкл',     color:'#cccccc', bg:'rgba(85,85,85,.25)',  active:isOff, tip:'/LETTERBOX OFF/ — выключить полосы',
              onClick: () => setLetterboxState(isOff ? 'none' : 'off'),
            },
          ]);
          bgSection.appendChild(buildCmdRow(g.label, g.icon, seg));
          return;
        }

        // Остальные BG-группы — стандартный tri-state.
        const seg = buildSeg([
          { val:'on',   label:'Вкл',  color:g.color, bg:g.bg, active:isOn,  tip:`Включить «${g.label}» с этой строки`,
            onClick: () => {
              saveHistory();
              lines[li].bgCmds = lines[li].bgCmds || {};
              const v = !isOn;
              lines[li].bgCmds[g.onKey]  = v;
              if (v) lines[li].bgCmds[g.offKey] = false;
              renderEditor(); renderOutput();
            },
          },
          { val:'none', label:'—',    active:!isOn && !isOff, tip:'Без команды',
            onClick: () => {
              saveHistory();
              lines[li].bgCmds = lines[li].bgCmds || {};
              lines[li].bgCmds[g.onKey]  = false;
              lines[li].bgCmds[g.offKey] = false;
              renderEditor(); renderOutput();
            },
          },
          { val:'off',  label:'Выкл', color:g.color, bg:g.bg, active:isOff, tip:`Выключить «${g.label}» с этой строки`,
            onClick: () => {
              saveHistory();
              lines[li].bgCmds = lines[li].bgCmds || {};
              const v = !isOff;
              lines[li].bgCmds[g.offKey] = v;
              if (v) lines[li].bgCmds[g.onKey] = false;
              renderEditor(); renderOutput();
            },
          },
        ]);
        bgSection.appendChild(buildCmdRow(g.label, g.icon, seg));
      });
      expandable.appendChild(bgSection);

      // ── Camera секция ─────────────────────────
      const camSection = document.createElement('div');
      camSection.className = 'fxe-cmd-section';
      const camTitle = document.createElement('div');
      camTitle.className = 'fxe-cmd-section-title';
      camTitle.textContent = '// камера';
      camSection.appendChild(camTitle);

      // Универсальный билдер для зума/прокрутки: 2 направления + «—»
      function buildDirSeg(onKey, offKey, onLbl, offLbl, color, bg, label) {
        const isOn  = !!camCmds[onKey];
        const isOff = !!camCmds[offKey];
        return buildSeg([
          { val:'on',   label:onLbl,  color, bg, active:isOn, tip:`${label}: ${onLbl}`,
            onClick: () => {
              saveHistory();
              lines[li].camCmds = lines[li].camCmds || {};
              const v = !isOn;
              lines[li].camCmds[onKey]  = v;
              if (v) lines[li].camCmds[offKey] = false;
              renderEditor(); renderOutput();
            },
          },
          { val:'none', label:'—', active:!isOn && !isOff, tip:'Без команды',
            onClick: () => {
              saveHistory();
              lines[li].camCmds = lines[li].camCmds || {};
              lines[li].camCmds[onKey]  = false;
              lines[li].camCmds[offKey] = false;
              renderEditor(); renderOutput();
            },
          },
          { val:'off',  label:offLbl, color, bg, active:isOff, tip:`${label}: ${offLbl}`,
            onClick: () => {
              saveHistory();
              lines[li].camCmds = lines[li].camCmds || {};
              const v = !isOff;
              lines[li].camCmds[offKey] = v;
              if (v) lines[li].camCmds[onKey] = false;
              renderEditor(); renderOutput();
            },
          },
        ]);
      }

      // Одиночный chip (для STOP / RESET)
      function buildCmdChip(label, key, color, bg, tip) {
        const chip = document.createElement('button');
        chip.className = 'fxe-cmd-chip' + (camCmds[key] ? ' active' : '');
        chip.textContent = label;
        chip.title = tip;
        if (camCmds[key]) {
          chip.style.setProperty('--chip-fg', color);
          chip.style.setProperty('--chip-bg', bg);
        }
        chip.addEventListener('click', () => {
          saveHistory();
          lines[li].camCmds = lines[li].camCmds || {};
          lines[li].camCmds[key] = !lines[li].camCmds[key];
          renderEditor(); renderOutput();
        });
        return chip;
      }

      // Зум: in / — / out  + STOP + слайдер силы (per-line zoom amount)
      const zoomSeg = buildDirSeg('zoomIn', 'zoomOut', 'Внутрь', 'Наружу', '#00ee44', 'rgba(0,119,0,.20)', 'Зум');
      const zoomStop = buildCmdChip('⏹ Стоп', 'zoomStop', '#eeee00', 'rgba(119,119,0,.20)', 'ZOOM STOP — остановить зум');
      const zoomAmtBox = (() => {
        const box = document.createElement('div');
        box.className = 'fxe-cmd-amt-box';
        box.title = 'Сила зума на этой строке (0.1 = чуть-чуть, 1.5 = на максимум). Применяется поверх глобальной настройки.';
        const lbl = document.createElement('span');
        lbl.className = 'fxe-cmd-amt-lbl';
        lbl.textContent = 'СИЛА';
        box.appendChild(lbl);
        const sl = document.createElement('input');
        sl.type = 'range';
        sl.min = 0.1; sl.max = 1.5; sl.step = 0.05;
        const hasAmt = camCmds.zoomAmount != null;
        sl.value = hasAmt ? camCmds.zoomAmount : 0.4;
        sl.className = 'fxe-cmd-amt-slider' + (hasAmt ? ' on' : '');
        const val = document.createElement('span');
        val.className = 'fxe-cmd-amt-val';
        val.textContent = parseFloat(sl.value).toFixed(2);
        sl.addEventListener('input', () => {
          val.textContent = parseFloat(sl.value).toFixed(2);
          sl.classList.add('on');
        });
        sl.addEventListener('change', () => {
          saveHistory();
          lines[li].camCmds = lines[li].camCmds || {};
          lines[li].camCmds.zoomAmount = parseFloat(sl.value);
          renderOutput();
        });
        box.appendChild(sl);
        box.appendChild(val);
        // RMB на «СИЛА» — сброс к глобальной (удаляем поле)
        lbl.addEventListener('contextmenu', e => {
          e.preventDefault();
          saveHistory();
          if (lines[li].camCmds) delete lines[li].camCmds.zoomAmount;
          renderEditor(); renderOutput();
        });
        return box;
      })();
      camSection.appendChild(buildCmdRow('Зум', '🔍', [zoomSeg, zoomStop, zoomAmtBox]));

      // Гор. прокрутка: left / — / right
      const sxSeg = buildDirSeg('scrollLeft', 'scrollRight', '← Влево', '→ Вправо', '#4466ff', 'rgba(0,0,170,.20)', 'Гор. прокрутка');
      camSection.appendChild(buildCmdRow('Гор. ↔', '↔', sxSeg));

      // Верт. прокрутка: up / — / down
      const sySeg = buildDirSeg('scrollUp', 'scrollDown', '↑ Вверх', '↓ Вниз', '#00ffaa', 'rgba(0,119,85,.20)', 'Верт. прокрутка');
      camSection.appendChild(buildCmdRow('Верт. ↕', '↕', sySeg));

      // Прочее: Stop pan + Camera reset
      const stopChip  = buildCmdChip('⏹ Стоп пан', 'scrollStop',  '#cccccc', 'rgba(119,119,119,.20)', 'SCROLL STOP — остановить прокрутку');
      const resetChip = buildCmdChip('📷 Сброс',    'cameraReset', '#ff9900', 'rgba(136,68,0,.22)',     'CAMERA RESET — сбросить камеру в начало');
      camSection.appendChild(buildCmdRow('Прочее', '⚙', [stopChip, resetChip]));

      expandable.appendChild(camSection);
      wrap.appendChild(expandable);

      // Toggle expandable on button click
      expandBtn.addEventListener('click', () => {
        const isHidden = expandable.style.display === 'none';
        expandable.style.display = isHidden ? 'block' : 'none';
        expandBtn.textContent = isHidden ? '⚙✓' : '⚙';
      });

      // ── Per-line style bar (chip-based) ──────────
      const ls = line.lineStyle || {};
      const hasStyle = hasLineStyle(ls);

      const styleBar = document.createElement('div');
      styleBar.className = 'fxe-line-style';

      // Левый маркер «есть переопределения»
      const marker = document.createElement('div');
      marker.className = 'fxe-ls-marker' + (hasStyle ? ' active' : '');
      marker.title = hasStyle ? 'Эта строка имеет переопределения' : 'Используются глобальные настройки';
      styleBar.appendChild(marker);

      // Универсальный билдер chip с select-ом
      const buildSelectChip = ({ icon, title, options, current, isActive, onChange }) => {
        const chip = document.createElement('label');
        chip.className = 'fxe-ls-chip' + (isActive ? ' active' : '');
        chip.title = title;
        const ic = document.createElement('span');
        ic.className = 'fxe-ls-chip-icon';
        ic.textContent = icon;
        chip.appendChild(ic);
        const sel = document.createElement('select');
        options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (opt.disabled) o.disabled = true;
          if (opt.value === (current || '')) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', e => onChange(e.target.value));
        chip.appendChild(sel);
        return chip;
      };

      // ── Шрифт
      styleBar.appendChild(buildSelectChip({
        icon: 'Aa',
        title: 'Шрифт строки (override)',
        options: FONT_OPTIONS,
        current: ls.font,
        isActive: !!ls.font,
        onChange: (v) => {
          saveHistory();
          lines[li].lineStyle = lines[li].lineStyle || {};
          lines[li].lineStyle.font = v || null;
          renderEditor(); renderOutput();
        },
      }));

      // ── Размер
      const sizeChip = document.createElement('label');
      sizeChip.className = 'fxe-ls-chip' + (ls.fontSize ? ' active' : '');
      sizeChip.title = 'Размер шрифта (override)';
      const sizeIcon = document.createElement('span');
      sizeIcon.className = 'fxe-ls-chip-icon';
      sizeIcon.textContent = '⇕';
      sizeChip.appendChild(sizeIcon);
      const sizeInp = document.createElement('input');
      sizeInp.type = 'number';
      sizeInp.placeholder = 'px';
      sizeInp.min = 12; sizeInp.max = 400;
      if (ls.fontSize) sizeInp.value = ls.fontSize;
      sizeInp.addEventListener('change', e => {
        saveHistory();
        lines[li].lineStyle = lines[li].lineStyle || {};
        const v = parseInt(e.target.value, 10);
        lines[li].lineStyle.fontSize = (v > 0) ? v : null;
        renderEditor(); renderOutput();
      });
      sizeChip.appendChild(sizeInp);
      styleBar.appendChild(sizeChip);

      // Разделитель между «типографикой» и «поведением»
      const sep1 = document.createElement('div');
      sep1.className = 'fxe-ls-sep';
      styleBar.appendChild(sep1);

      // ── Анимация
      styleBar.appendChild(buildSelectChip({
        icon: '✨',
        title: 'Режим анимации строки (override)',
        options: ANIM_OPTIONS,
        current: ls.animMode,
        isActive: !!ls.animMode,
        onChange: (v) => {
          saveHistory();
          lines[li].lineStyle = lines[li].lineStyle || {};
          lines[li].lineStyle.animMode = v || null;
          renderEditor(); renderOutput();
        },
      }));

      // ── Позиция (9-позиционная сетка)
      styleBar.appendChild(buildSelectChip({
        icon: '⌖',
        title: 'Позиция текста строки (override)',
        options: [
          { label: '— global —',        value: '' },
          { label: '↖ Верх-лево',       value: 'top-left' },
          { label: '↑ Верх-центр',      value: 'top' },
          { label: '↗ Верх-право',      value: 'top-right' },
          { label: '← Центр-лево',      value: 'center-left' },
          { label: '● Центр',           value: 'center' },
          { label: '→ Центр-право',     value: 'center-right' },
          { label: '↙ Низ-лево',        value: 'bottom-left' },
          { label: '↓ Низ-центр',       value: 'bottom' },
          { label: '↘ Низ-право',       value: 'bottom-right' },
        ],
        current: ls.position,
        isActive: !!ls.position,
        onChange: (v) => {
          saveHistory();
          lines[li].lineStyle = lines[li].lineStyle || {};
          lines[li].lineStyle.position = v || null;
          renderEditor(); renderOutput();
        },
      }));

      const sep2 = document.createElement('div');
      sep2.className = 'fxe-ls-sep';
      styleBar.appendChild(sep2);

      // ── Цвет — отдельный квадратный chip
      const colorChip = document.createElement('label');
      colorChip.className = 'fxe-ls-color-chip' + (ls.color ? ' active' : '');
      colorChip.title = 'Цвет текста строки (override). ПКМ — сбросить.';
      const colorFill = document.createElement('div');
      colorFill.className = 'fxe-ls-color-fill' + (ls.color ? '' : ' empty');
      if (ls.color) colorFill.style.background = ls.color;
      const colorInp = document.createElement('input');
      colorInp.type = 'color';
      colorInp.value = ls.color || '#ffffff';
      colorInp.addEventListener('input', e => {
        colorFill.style.background = e.target.value;
        colorFill.classList.remove('empty');
        colorChip.classList.add('active');
      });
      colorInp.addEventListener('change', e => {
        saveHistory();
        lines[li].lineStyle = lines[li].lineStyle || {};
        lines[li].lineStyle.color = e.target.value;
        renderEditor(); renderOutput();
      });
      colorChip.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!ls.color) return;
        saveHistory();
        lines[li].lineStyle = lines[li].lineStyle || {};
        lines[li].lineStyle.color = null;
        renderEditor(); renderOutput();
      });
      colorChip.appendChild(colorFill);
      colorChip.appendChild(colorInp);
      styleBar.appendChild(colorChip);

      // ── Reset (только если есть переопределения)
      if (hasStyle) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'fxe-ls-reset';
        clearBtn.textContent = '✕ СБРОС';
        clearBtn.title = 'Убрать все переопределения этой строки';
        clearBtn.addEventListener('click', () => {
          saveHistory();
          lines[li].lineStyle = {};
          renderEditor(); renderOutput();
        });
        styleBar.appendChild(clearBtn);
      }

      wrap.appendChild(styleBar);

      // ── Token line
      const tokenLine = document.createElement('div');
      tokenLine.className = 'fxe-token-line';

      // Tint background based on active BG commands
      if (bgCmds.darken)   tokenLine.style.background = 'rgba(30,20,60,.35)';
      if (bgCmds.brighten) tokenLine.style.background = 'rgba(60,55,0,.3)';
      if (bgCmds.blur)     tokenLine.style.background = 'rgba(0,40,50,.3)';

      // Apply line font to token preview if set
      if (ls.font)     tokenLine.style.fontFamily = ls.font;
      if (ls.fontSize) tokenLine.style.fontSize   = `${Math.min(ls.fontSize * 0.7, 18)}px`;
      if (ls.color)    tokenLine.style.color       = ls.color;

      // Double-click on token area = select all in line
      tokenLine.addEventListener('dblclick', e => {
        if (e.target === tokenLine) return;
        selectAllInLine(li);
      });

      // Каждое слово — отдельный кликабельный span
      line.tokens.forEach((tok, ti) => {
        const isSelected = selectedToks.some(s => s.li===li && s.ti===ti);
        const el = document.createElement('span');
        el.className = 'fxe-tok';
        tok.effects.forEach(fx => el.classList.add('fxe-tok-' + fx));
        if (tok.effects.length) el.classList.add('hasfx');
        if (tok.color) {
          el.style.color = tok.color;
          el.style.setProperty('--tc', tok.color);
          el.classList.add('hasc');
          el.classList.remove('hasfx');
        }
        if (isSelected) el.classList.add('sel');
        el.textContent = tok.word;
        el.dataset.li = li;
        el.dataset.ti = ti;
        el.addEventListener('click', e => handleTokenClick(li, ti, e));
        tokenLine.appendChild(el);
      });

      wrap.appendChild(tokenLine);
      scroll.appendChild(wrap);
      } catch (err) {
        console.error(`[FxEditor] Ошибка рендера строки #${li}:`, err, line);
        const errBox = document.createElement('div');
        errBox.className = 'fxe-line-wrap';
        errBox.style.cssText = 'border-color:#a33;color:#f88;padding:8px 10px;font-family:Space Mono,monospace;font-size:10px;';
        errBox.textContent = `⚠ Строка #${li+1} не отрисована: ${err && err.message || err}. См. консоль (F12).`;
        scroll.appendChild(errBox);
      }
    });

    updateSelInfo();
    updatePreview();
    renderOutput();
  }

  function renderOutput() {
    const area = overlay.querySelector('#fxeOutput');
    area.innerHTML = lines.map(line => {
      const section  = line.section ? `[${line.section}]` : '';
      const bg       = bgCmdsToString(line.bgCmds||{});
      const cam      = camCmdsToString(line.camCmds||{});
      const styleTag = lineStyleToTags(line.lineStyle);
      const lrc = `[${line.time}] ${section}${tokensToText(line.tokens)}${bg}${cam}${styleTag}`;
      const safe = lrc
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/(\[\d+:\d+\.\d+\])/g, '<span class="fxe-out-time">$1</span>')
        .replace(/(\{L[A-Z]+:[^}]+\})/g, '<span class="fxe-out-lstyle">$1</span>')
        .replace(/(\{[A-Z:/0-9#]+\}|\*\*?|_|~{1,2})/g, '<span class="fxe-out-tag">$1</span>')
        .replace(/(\/(ZOOM\s+\w+|SCROLL\s+\w+|CAMERA\s+\w+)\/)/g, '<span class="fxe-out-camcmd">$1</span>')
        .replace(/(\/[А-Яа-яЁё][^\/]+\/)/g, '<span class="fxe-out-bgcmd">$1</span>');
      return `<div class="fxe-out-line">${safe}</div>`;
    }).join('');
    area.scrollTop = area.scrollHeight;
  }

  function updateSelInfo() {
    const el = overlay.querySelector('#fxeSelInfo');
    if (!selectedToks.length) { el.innerHTML = 'выдели слова, потом эффект'; return; }
    const words = selectedToks.map(s=>lines[s.li]?.tokens[s.ti]?.word).filter(Boolean).join(', ');
    el.innerHTML = `выбрано: <span class="hi">${selectedToks.length}</span> — <span class="hi">${words}</span>`;
  }

  function updatePreview() {
    const canvas = overlay.querySelector('#fxePreviewCanvas');
    const hint = overlay.querySelector('.fxe-preview-hint');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    
    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    
    if (!selectedToks.length) {
      hint.style.display = 'block';
      return;
    }
    hint.style.display = 'none';
    
    const li = selectedToks[0].li;
    const line = lines[li];
    if (!line) return;
    
    // Собираем ТОЛЬКО выбранные токены в правильном порядке
    const selectedIndices = selectedToks
      .filter(({li:sli}) => sli === li)
      .map(({ti}) => ti)
      .sort((a, b) => a - b);
    
    if (!selectedIndices.length) return;
    
    // Берём только выбранные токены
    const selectedTokens = selectedIndices.map(ti => line.tokens[ti]).filter(Boolean);
    if (!selectedTokens.length) return;
    
    // Конвертируем токены обратно в текст с тегами
    const selectedText = tokensToText(selectedTokens);
    if (!selectedText.trim()) return;
    
    // Создаём временный объект лирики для рендера
    const ls = line.lineStyle || {};
    const tempLyric = {
      text: selectedText,
      rawText: selectedText,
      time: 0,
      lineStyle: ls
    };
    
    // Параметры рендера
    const effectiveFont = ls.font || "'Bebas Neue', cursive";
    const effectiveSize = ls.fontSize || 96;
    const effectiveColor = ls.color || '#ffffff';
    
    // Рендерим текст через TextRenderer
    const anim = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, alpha: 1 };
    const fadeAlpha = 1;
    const t = performance.now() / 1000;
    
    try {
      // Предпросмотр тоже уважает внутреннюю область кадра
      const safe = (typeof BackgroundEngine !== 'undefined' && BackgroundEngine.getTextSafeArea)
        ? BackgroundEngine.getTextSafeArea(w, h)
        : { x: 0, y: 0, w, h };
      TextRenderer.draw(
        ctx, tempLyric,
        safe.x + safe.w / 2, safe.y + safe.h / 2,
        anim, fadeAlpha,
        effectiveColor, effectiveFont, effectiveSize, w, t,
        null, safe
      );
    } catch(e) {
      console.error('Preview render error:', e);
    }
  }

  /* ── Selection ──────────────────────────────── */
  function selectAllInLine(li) {
    const line = lines[li];
    if (!line) return;
    selectedToks = line.tokens.map((_, ti) => ({ li, ti }));
    renderEditor();
  }

  function handleTokenClick(li, ti, e) {
    if (e.shiftKey && selectedToks.length > 0) {
      const last = selectedToks[selectedToks.length-1];
      if (last.li===li) {
        const [a,b]=[Math.min(last.ti,ti),Math.max(last.ti,ti)];
        for (let i=a;i<=b;i++)
          if (!selectedToks.some(s=>s.li===li&&s.ti===i)) selectedToks.push({li,ti:i});
      } else { selectedToks.push({li,ti}); }
    } else if (e.ctrlKey||e.metaKey) {
      const idx=selectedToks.findIndex(s=>s.li===li&&s.ti===ti);
      if (idx>=0) selectedToks.splice(idx,1); else selectedToks.push({li,ti});
    } else {
      const already=selectedToks.length===1&&selectedToks[0].li===li&&selectedToks[0].ti===ti;
      selectedToks = already ? [] : [{li,ti}];
    }
    renderEditor();
  }

  /* ── Apply FX ───────────────────────────────── */
  function applyFx(fx) {
    if (!selectedToks.length) return;
    const boxFxList = typeof BoxRegistry !== 'undefined'
      ? BoxRegistry.all.map(s => s.id)
      : ['box','boxneon','boxglass','boxshadow','boxtape','boxrough'];

    // ── Спец-эффект __none__: снять ЛЮБУЮ рамку со строк выделения.
    //    Чистит пословные box-эффекты у выбранных токенов И выставляет
    //    lineStyle.noBox=true на родительской строке каждого токена —
    //    это отключает ГЛОБАЛЬНУЮ рамку (params.globalBoxId) для этой строки.
    //    Иначе «БЕЗ РАМКИ» убирал только per-word, а глобальная продолжала рисоваться.
    if (fx === '__none__') {
      // Строки, которые затронет выделение (даже если у токенов нет per-word box —
      // всё равно надо выставить noBox, чтобы погасить глобальную рамку)
      const affectedLines = new Set(selectedToks.map(({li}) => li));
      // Если и per-word рамок нет, и noBox уже стоит у всех затронутых — делать нечего
      const anyHasBox = selectedToks.some(({li,ti}) => {
        const t = lines[li]?.tokens[ti];
        return t && t.effects.some(f => boxFxList.includes(f));
      });
      const allAlreadyNoBox = [...affectedLines].every(li => lines[li]?.lineStyle?.noBox);
      if (!anyHasBox && allAlreadyNoBox) return;
      saveHistory();
      selectedToks.forEach(({li,ti}) => {
        const tok = lines[li]?.tokens[ti];
        if (!tok) return;
        tok.effects = tok.effects.filter(f => !boxFxList.includes(f));
      });
      // Помечаем каждую затронутую строку как «без рамки»
      affectedLines.forEach(li => {
        if (!lines[li]) return;
        lines[li].lineStyle = lines[li].lineStyle || {};
        lines[li].lineStyle.noBox = true;
      });
      renderEditor();
      return;
    }

    saveHistory();
    const isBox = boxFxList.includes(fx);

    // Batch-логика: если эффект уже есть У ВСЕХ выбранных токенов — снимаем у всех,
    // иначе — добавляем всем (приводим к одному состоянию). Это предотвращает
    // инверсию при микс-состоянии («select all» + toggle → часть слов оборачивается,
    // часть разворачивается).
    const allHave = selectedToks.every(({li,ti}) => {
      const t = lines[li]?.tokens[ti];
      return t && t.effects.includes(fx);
    });

    selectedToks.forEach(({li,ti}) => {
      const tok = lines[li]?.tokens[ti];
      if (!tok) return;
      if (allHave) {
        // Снимаем у всех
        tok.effects = tok.effects.filter(f => f !== fx);
      } else {
        // Добавляем всем, у кого ещё нет
        if (!tok.effects.includes(fx)) {
          // Box-эффекты взаимоисключающие: перед добавлением чистим конфликтующие
          if (isBox) tok.effects = tok.effects.filter(f => !boxFxList.includes(f));
          tok.effects = [...tok.effects, fx];
        }
      }
    });
    // Если добавили per-word рамку, lineStyle.noBox теряет смысл —
    // снимаем его с каждой затронутой строки, иначе в LRC будет противоречие:
    // "без рамки" + одновременно {BOXSTEALTH}word{/BOXSTEALTH}.
    if (isBox && !allHave) {
      const affectedLines = new Set(selectedToks.map(({li}) => li));
      affectedLines.forEach(li => {
        if (lines[li]?.lineStyle?.noBox) {
          lines[li].lineStyle.noBox = false;
          delete lines[li].lineStyle.noBox;
        }
      });
    }
    renderEditor();
  }

  function applyColor(hex, swatchEl) {
    if (!selectedToks.length) return;
    const allSame = selectedToks.every(({li,ti})=>lines[li]?.tokens[ti]?.color===hex);
    saveHistory();
    selectedToks.forEach(({li,ti}) => {
      const tok = lines[li]?.tokens[ti];
      if (!tok) return;
      tok.color = allSame ? null : hex;
    });
    overlay.querySelectorAll('.fxe-cswatch').forEach(s=>s.classList.remove('active'));
    if (!allSame && swatchEl) swatchEl.classList.add('active');
    renderEditor();
  }

  function clearFx() {
    if (!selectedToks.length) return;
    saveHistory();
    selectedToks.forEach(({li,ti}) => {
      const tok = lines[li]?.tokens[ti];
      if (!tok) return;
      tok.effects = [];
      tok.color   = null;
    });
    renderEditor();
  }

  function addLine() {
    saveHistory();
    const last  = lines[lines.length-1];
    const lastT = last ? parseTimeStr(last.time) : 0;
    lines.push({
      time:      fmtTime(lastT+3),
      rawText:   'Новая строка',
      section:   null,
      tokens:    [{word:'Новая',effects:[],color:null},{word:'строка',effects:[],color:null}],
      bgCmds:    {},
      camCmds:   {},
      lineStyle: {},
    });
    renderEditor();
    overlay.querySelector('#fxeEditorScroll').scrollTop = 99999;
  }

  /* ── Helpers ────────────────────────────────── */
  function fmtTime(s) {
    if (isNaN(s)) return '00:00.00';
    const m  = Math.floor(s/60);
    const ss = Math.floor(s%60);
    const cs = Math.round((s%1)*100);
    return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  }

  function parseTimeStr(str) {
    const m = str.match(/^(\d+):(\d+)\.(\d+)$/);
    if (!m) return 0;
    return parseInt(m[1])*60+parseInt(m[2])+parseInt(m[3])/100;
  }

  return { open, close, openOverlayManager };
})();