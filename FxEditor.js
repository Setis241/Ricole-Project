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
  const LINE_STYLE_RE = /\{L(?:FONT|SIZE|ANIM|COLOR|POS|LAYER|OVFX):[^}]+\}/g;

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

  /* ── Line-style helpers ─────────────────────── */
  function extractLineStyle(raw) {
    const text = raw || '';
    const ls = {};
    const fontM  = text.match(/\{LFONT:([^}]+)\}/);
    const sizeM  = text.match(/\{LSIZE:(\d+)\}/);
    const animM  = text.match(/\{LANIM:([^}]+)\}/);
    const colorM = text.match(/\{LCOLOR:(#[0-9a-fA-F]{3,6})\}/);
    const posM   = text.match(/\{LPOS:(top|center|bottom)\}/i);
    const layerM = text.match(/\{LLAYER:(above|below)\}/i);
    const ovfxM  = text.match(/\{LOVFX:(static|sway|pulse|stretch|float|shake|bounce|spin)\}/i);
    if (fontM)  ls.font     = fontM[1].trim();
    if (sizeM)  ls.fontSize = parseInt(sizeM[1], 10);
    if (animM)  ls.animMode = animM[1].trim();
    if (colorM) ls.color    = colorM[1];
    if (posM)   ls.position = posM[1].toLowerCase();
    if (layerM) ls.layer    = layerM[1].toLowerCase();
    if (ovfxM)  ls.overlayEffect = ovfxM[1].toLowerCase();
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
    return parts.length ? parts.join('') + ' ' : '';
  }

  function hasLineStyle(ls) {
    return ls && (ls.font || ls.fontSize || ls.animMode || ls.color || ls.position || ls.layer || ls.overlayEffect);
  }

  /* ── BG CMD helpers ─────────────────────────── */
  function parseBgCmds(raw) {
    const txt = (raw || '').toUpperCase();
    return {
      darken:              (txt.includes('НАЧАЛО ЗАТУХАНИЯ') || txt.includes('НАЧАЛО ТЕМНОТЫ') || txt.includes('МРАЧНЫЙ ФОН')),
      brighten:            txt.includes('ЯРКИЙ ФОН') && !txt.includes('КОНЕЦ ЯРКОСТИ'),
      blur:                txt.includes('РАЗМЫТИЕ') && !txt.includes('ЧЕТКОСТЬ'),
      undarken:            (txt.includes('КОНЕЦ ЗАТУХАНИЯ') || txt.includes('КОНЕЦ ТЕМНОТЫ')),
      unbrighten:          txt.includes('КОНЕЦ ЯРКОСТИ'),
      unblur:              txt.includes('ЧЕТКОСТЬ'),
      letterbox:           txt.includes('LETTERBOX') && !txt.includes('REACTIVE') && !txt.includes('OFF'),
      letterboxReactive:   txt.includes('LETTERBOX REACTIVE') && !txt.includes('OFF'),
      unletterbox:         txt.includes('LETTERBOX OFF') && !txt.includes('REACTIVE'),
      unletterboxReactive: txt.includes('LETTERBOX REACTIVE OFF'),
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
    if (cmds.letterbox)           s += '/LETTERBOX/';
    if (cmds.unletterbox)         s += '/LETTERBOX OFF/';
    if (cmds.letterboxReactive)   s += '/LETTERBOX REACTIVE/';
    if (cmds.unletterboxReactive) s += '/LETTERBOX REACTIVE OFF/';
    return s ? s + ' ' : '';
  }

  // ── Camera command helpers ───────────────────
  function parseCamCmds(raw) {
    const txt = (raw || '').toUpperCase();
    return {
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
  }

  function camCmdsToString(cmds) {
    if (!cmds) return '';
    const parts = [];
    if (cmds.zoomIn)      parts.push('/ZOOM IN/');
    if (cmds.zoomOut)     parts.push('/ZOOM OUT/');
    if (cmds.zoomStop)    parts.push('/ZOOM STOP/');
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

    const BOX_TAGS = typeof BoxRegistry !== 'undefined' ? BoxRegistry.all.map(s=>s.id.toUpperCase()).join('|') : 'BOX|BOXNEON|BOXGLASS|BOXSHADOW|BOXTAPE|BOXROUGH|BOXFIRE|BOXICE|BOXHOLO|BOXGOLD|BOXCYBER|BOXRAINBOW|BOXRETRO|BOXAURA|BOXMATRIX|BOXSMOKE|BOXPLASMA|BOXTATTOO|BOXSUNSET|BOXLACQUER|BOXCRYSTAL|BOXDANGER|BOXDIAMOND|BOXFAULT|BOXINK|BOXPORTAL|BOXSIGIL|BOXSTATIC|BOXVHS|BOXVIRUS|BOXWAVE|BOXWIRE';
    const TAG_RE = new RegExp(
      `(\\{COLOR:#[0-9a-fA-F]{3,6}\\}|\\{\\/COLOR\\}` +
      `|\\{(?:${BOX_TAGS})\\}|\\{\\/(?:${BOX_TAGS})\\}` +
      `|\\{BIG\\}|\\{\\/BIG\\}|\\{SMALL\\}|\\{\\/SMALL\\}` +
      `|\\{GLITCH\\}|\\{\\/GLITCH\\}|\\{GLOW\\}|\\{\\/GLOW\\}` +
      `|\\{SHAKE\\}|\\{\\/SHAKE\\}|\\{WAVE\\}|\\{\\/WAVE\\}` +
      `|\\{OUTLINE\\}|\\{\\/OUTLINE\\}|\\{RAINBOW\\}|\\{\\/RAINBOW\\}` +
      `|\\{NEON\\}|\\{\\/NEON\\}|\\{BLUR\\}|\\{\\/BLUR\\}` +
      `|\\{FLICKER\\}|\\{\\/FLICKER\\}` +
      `|\\*\\*?|_(?!_)|~~?|~(?!~))`, 'g'
    );

    const state = {
      bold:false,italic:false,underline:false,strike:false,
      big:false,small:false,glitch:false,glow:false,shake:false,wave:false,
      outline:false,rainbow:false,neon:false,blur:false,flicker:false,
      box:false,boxneon:false,boxglass:false,boxshadow:false,boxtape:false,boxrough:false,boxfire:false,boxice:false,boxholo:false,boxgold:false,boxcyber:false,boxrainbow:false,boxretro:false,boxaura:false,boxmatrix:false,boxsmoke:false,boxplasma:false,boxtattoo:false,boxsunset:false,boxlacquer:false,boxcrystal:false,boxdanger:false,boxdiamond:false,boxfault:false,boxink:false,boxportal:false,boxsigil:false,boxstatic:false,boxvhs:false,boxvirus:false,boxwave:false,boxwire:false,
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
    
    // Список всех box-эффектов
    const boxFxList = typeof BoxRegistry !== 'undefined'
      ? BoxRegistry.all.map(s => s.id)
      : ['box','boxneon','boxglass','boxshadow','boxtape','boxrough','boxfire','boxice','boxholo','boxgold','boxcyber','boxrainbow','boxretro','boxaura','boxmatrix','boxsmoke','boxplasma','boxtattoo','boxsunset','boxlacquer','boxcrystal','boxdanger','boxdiamond','boxfault','boxink','boxportal','boxsigil','boxstatic','boxvhs','boxvirus','boxwave','boxwire'];
    
    // Группируем соседние токены с одинаковым набором эффектов и цветом,
    // НО: если токен содержит box-эффект, НЕ группируем его с соседями
    const groups = [];
    for (const tok of tokens) {
      if (!tok || !tok.word) continue;
      const hasBox = (tok.effects || []).some(fx => boxFxList.includes(fx));
      const fxKey = [...(tok.effects||[])].sort().join(',') + '|' + (tok.color || '');
      const last  = groups[groups.length - 1];
      
      // Группируем только если нет box-эффектов ни у текущего, ни у предыдущего токена
      const lastHasBox = last && last.effects.some(fx => boxFxList.includes(fx));
      if (last && last.fxKey === fxKey && !hasBox && !lastHasBox) {
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
    if (overlay) overlay.style.display = 'none';
    selectedToks = [];
  }

  function openOverlayManager() {
    // Открываем FxEditor сразу на вкладке объектов
    if (!overlay) createOverlay();
    
    // Пытаемся загрузить строки из текущего текста песни
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
    } else if (lines.length === 0) {
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
      <span class="fxe-ov-hint">Объекты рисуются поверх или под текстом с аудио-реактивными эффектами</span>
    </div>
    <div class="fxe-ov-content">
      <div class="fxe-ov-left">
        <div class="fxe-ov-list" id="fxeOvList"></div>
      </div>
      <div class="fxe-ov-right">
        <div class="fxe-ov-preview-wrap">
          <canvas id="fxeOvPreviewCanvas" width="1920" height="1080"></canvas>
          <div class="fxe-ov-preview-label">// ПРЕВЬЮ ОБЪЕКТОВ (реальный размер холста)</div>
        </div>
      </div>
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
  transition: background .12s, opacity .12s;
}
.fxe-callout-btn:hover { opacity: 1 !important; }
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
  margin-bottom:12px;border:1px solid #1a1a1a;background:#0d0d0d;
}
.fxe-line-wrap:hover { border-color:#2a2a2a; }

/* Actions row (time + bg commands + util buttons) */
.fxe-line-actions {
  display:flex;align-items:center;gap:4px;padding:5px 8px;
  background:#111;border-bottom:1px solid #1a1a1a;flex-wrap:wrap;
}
.fxe-time-inp {
  font-family:'Space Mono',monospace;font-size:9px;
  background:#0a0a0a;border:1px solid #333;color:#e8ff00;
  padding:3px 6px;width:70px;flex-shrink:0;
}
.fxe-bg-toggles { display:flex;gap:3px;flex-wrap:wrap; }
.fxe-bg-tog {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;text-transform:uppercase;
  padding:3px 6px;cursor:pointer;background:transparent;border:1px solid #2a2a2a;color:#444;
  transition:all .15s;
}
.fxe-bg-tog:hover { border-color:#888;color:#ccc; }
.fxe-bg-tog.on-darken     { background:#1a1030;border-color:#6644bb;color:#b18fff; }
.fxe-bg-tog.on-brighten   { background:#1a1800;border-color:#886600;color:#e8cc00; }
.fxe-bg-tog.on-blur             { background:#001a1a;border-color:#006666;color:#00cccc; }
.fxe-bg-tog.on-undarken         { background:#1a1030;border-color:#6644bb;color:#b18fff;text-decoration:line-through; }
.fxe-bg-tog.on-unbrighten       { background:#1a1800;border-color:#886600;color:#e8cc00;text-decoration:line-through; }
.fxe-bg-tog.on-unblur           { background:#001a1a;border-color:#006666;color:#00cccc;text-decoration:line-through; }
.fxe-bg-tog.on-letterbox        { background:#1a1a1a;border-color:#555;color:#ccc; }
.fxe-bg-tog.on-unletterbox      { background:#1a1a1a;border-color:#555;color:#ccc;text-decoration:line-through; }
.fxe-bg-tog.on-letterboxReactive{ background:#2a1a1a;border-color:#aa5555;color:#ffaaaa; }
.fxe-bg-tog.on-unletterboxReactive{ background:#2a1a1a;border-color:#aa5555;color:#ffaaaa;text-decoration:line-through; }

/* Camera row */
.fxe-cam-row {
  display:flex;align-items:center;gap:3px;padding:3px 8px;
  background:#060608;border-bottom:1px solid #141414;flex-wrap:wrap;
}
.fxe-cam-label {
  font-family:'Space Mono',monospace;font-size:6px;letter-spacing:2px;text-transform:uppercase;
  color:#222;flex-shrink:0;margin-right:3px;user-select:none;
}
.fxe-cam-tog {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:0px;
  padding:2px 5px;cursor:pointer;background:transparent;border:1px solid #1a1a1a;color:#2a2a2a;
  transition:all .12s;white-space:nowrap;
}
.fxe-cam-tog:hover { border-color:#666;color:#aaa; }
.fxe-cam-tog.on-zoomIn     { background:#001500;border-color:#007700;color:#00ee44; }
.fxe-cam-tog.on-zoomOut    { background:#150000;border-color:#770000;color:#ee4444; }
.fxe-cam-tog.on-zoomStop   { background:#111100;border-color:#777700;color:#eeee00; }
.fxe-cam-tog.on-scrollLeft  { background:#000018;border-color:#0000aa;color:#4466ff; }
.fxe-cam-tog.on-scrollRight { background:#000018;border-color:#0000aa;color:#4466ff; }
.fxe-cam-tog.on-scrollUp    { background:#001510;border-color:#007755;color:#00ffaa; }
.fxe-cam-tog.on-scrollDown  { background:#001510;border-color:#007755;color:#00ffaa; }
.fxe-cam-tog.on-scrollStop  { background:#151515;border-color:#777;color:#ccc; }
.fxe-cam-tog.on-cameraReset { background:#150800;border-color:#884400;color:#ff9900; }
.fxe-cam-sep { width:1px;height:10px;background:#1f1f1f;flex-shrink:0;margin:0 2px; }

/* Section badge */
.fxe-section-badge {
  font-family:'Space Mono',monospace;font-size:7px;padding:2px 6px;
  background:rgba(232,255,0,.12);color:#e8ff00;border:1px solid rgba(232,255,0,.3);
  flex-shrink:0;
}

/* ── Per-line style bar ─────────────────────── */
.fxe-line-style {
  display:flex;align-items:center;gap:5px;padding:5px 8px;
  background:#080808;border-top:1px solid #181818;flex-wrap:wrap;
}
.fxe-ls-label {
  font-family:'Space Mono',monospace;font-size:6px;letter-spacing:2px;text-transform:uppercase;
  color:#2a2a2a;flex-shrink:0;user-select:none;
}
.fxe-ls-label.active { color:#e8ff00; }
.fxe-ls-sel {
  background:#0d0d0d;border:1px solid #252525;color:#444;
  font-family:'Space Mono',monospace;font-size:8px;padding:2px 4px;cursor:pointer;
  outline:none;max-width:110px;
}
.fxe-ls-sel.on { border-color:#e8ff00;color:#e8ff00; }
.fxe-ls-num {
  background:#0d0d0d;border:1px solid #252525;color:#444;
  font-family:'Space Mono',monospace;font-size:8px;padding:2px 4px;
  width:46px;outline:none;
}
.fxe-ls-num.on { border-color:#e8ff00;color:#e8ff00; }
.fxe-ls-color-wrap {
  display:flex;align-items:center;gap:3px;
}
.fxe-ls-color-swatch {
  width:16px;height:16px;border:1px solid #252525;cursor:pointer;
  flex-shrink:0;position:relative;overflow:hidden;
}
.fxe-ls-color-swatch.on { border-color:#e8ff00; }
.fxe-ls-color-inp {
  position:absolute;inset:-4px;opacity:0;cursor:pointer;width:200%;height:200%;
}
.fxe-ls-clear-style {
  font-family:'Space Mono',monospace;font-size:7px;
  background:transparent;border:1px solid #1a1a1a;color:#2a2a2a;
  padding:2px 5px;cursor:pointer;transition:all .15s;flex-shrink:0;
}
.fxe-ls-clear-style:hover { border-color:#ff2d55;color:#ff2d55; }
.fxe-ls-divider {
  width:1px;height:12px;background:#1f1f1f;flex-shrink:0;
}

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
.fxe-ov-panel {
  flex:1;display:flex;flex-direction:column;overflow:hidden;
}
.fxe-ov-toolbar {
  display:flex;align-items:center;gap:12px;padding:10px 16px;
  background:#111;border-bottom:1px solid #1a1a1a;flex-shrink:0;
}
.fxe-ov-hint {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;color:#333;
  text-transform:uppercase;
}
.fxe-ov-content {
  flex:1;display:flex;gap:0;overflow:hidden;
}
.fxe-ov-left {
  width:400px;flex-shrink:0;display:flex;flex-direction:column;
  border-right:1px solid #1a1a1a;background:#0a0a0a;
}
.fxe-ov-right {
  flex:1;display:flex;flex-direction:column;overflow:hidden;
}
.fxe-ov-preview-wrap {
  flex:1;position:relative;background:#0a0a0a;
  padding:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;
}
.fxe-ov-preview-label {
  position:absolute;top:4px;left:8px;
  font-family:'Space Mono',monospace;font-size:6px;letter-spacing:2px;
  color:#222;text-transform:uppercase;z-index:1;
}
#fxeOvPreviewCanvas {
  width:100%;height:100%;object-fit:contain;border:1px solid #1a1a1a;
}
.fxe-ov-list {
  flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px;
}
.fxe-ov-list::-webkit-scrollbar{width:3px}
.fxe-ov-list::-webkit-scrollbar-thumb{background:#222}

/* Overlay card */
.fxe-ov-card {
  background:#0d0d0d;border:1px solid #1e1e1e;padding:0;overflow:hidden;
  transition:border-color .15s;
}
.fxe-ov-card:hover { border-color:#2a2a2a; }
.fxe-ov-card.disabled { opacity:.4; }

.fxe-ov-card-header {
  display:flex;align-items:center;gap:10px;padding:8px 12px;
  background:#111;border-bottom:1px solid #1a1a1a;
}
.fxe-ov-thumb {
  width:48px;height:32px;object-fit:cover;border:1px solid #222;flex-shrink:0;
}
.fxe-ov-card-name {
  font-family:'Space Mono',monospace;font-size:9px;color:#888;
  flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.fxe-ov-card-body {
  padding:10px 12px;display:flex;flex-direction:column;gap:8px;
}

/* Card rows */
.fxe-ov-row {
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
}
.fxe-ov-row-label {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:2px;text-transform:uppercase;
  color:#333;flex-shrink:0;width:64px;
}

/* Toggle chip buttons */
.fxe-ov-chip {
  font-family:'Space Mono',monospace;font-size:7px;letter-spacing:1px;text-transform:uppercase;
  padding:3px 9px;cursor:pointer;background:transparent;border:1px solid #222;color:#444;
  transition:all .12s;white-space:nowrap;
}
.fxe-ov-chip:hover { border-color:#666;color:#ccc; }
.fxe-ov-chip.active-layer-above  { background:#101a10;border-color:#44aa44;color:#88ff88; }
.fxe-ov-chip.active-layer-below  { background:#1a1010;border-color:#aa4444;color:#ff8888; }
.fxe-ov-chip.active-scope-global { background:#0a0a1a;border-color:#4444aa;color:#8888ff; }
.fxe-ov-chip.active-scope-tl     { background:#1a0a0a;border-color:#aa6600;color:#ffaa44; }
.fxe-ov-chip.active-enabled      { background:#101510;border-color:#44bb44;color:#88ee88; }
.fxe-ov-chip.active-pos          { background:#1a1a0a;border-color:#e8ff00;color:#e8ff00; }
.fxe-ov-pos-preset { font-size:8px; }

/* Custom position controls */
.fxe-ov-custom-pos {
  flex-direction:column;gap:8px;padding:8px 0;
}
.fxe-ov-pos-grid {
  display:grid;grid-template-columns:repeat(3, 1fr);gap:4px;width:fit-content;
}
.fxe-ov-arrow-btn {
  width:32px;height:32px;font-size:14px;cursor:pointer;
  background:#0a0a0a;border:1px solid #222;color:#666;
  transition:all .12s;display:flex;align-items:center;justify-content:center;
}
.fxe-ov-arrow-btn:hover {
  background:#1a1a1a;border-color:#e8ff00;color:#e8ff00;
}
.fxe-ov-arrow-btn:active {
  background:#e8ff00;color:#000;
}
.fxe-ov-pos-values {
  font-family:'Space Mono',monospace;font-size:8px;color:#666;
  letter-spacing:1px;text-align:center;
}

/* Timeline range inputs */
.fxe-ov-tl-range {
  display:flex;align-items:center;gap:4px;flex-shrink:0;
}
.fxe-ov-tl-range span {
  font-family:'Space Mono',monospace;font-size:7px;color:#444;
}
.fxe-ov-num {
  font-family:'Space Mono',monospace;font-size:9px;color:#e8ff00;
  background:#0a0a0a;border:1px solid #333;padding:2px 6px;width:44px;text-align:center;
}

/* Timeline lines selector */
.fxe-ov-tl-lines {
  display:flex;flex-direction:column;gap:6px;margin-top:8px;width:100%;
}
.fxe-ov-tl-header {
  font-family:'Space Mono',monospace;font-size:7px;color:#666;
  text-transform:uppercase;letter-spacing:1px;padding:4px 0;
  display:flex;align-items:center;gap:8px;
}
.fxe-ov-tl-header span {
  flex:1;
}
.fxe-ov-tl-btn {
  font-family:'Space Mono',monospace;font-size:7px;
  background:#1a1a1a;border:1px solid #333;color:#999;
  padding:4px 8px;cursor:pointer;border-radius:2px;
  text-transform:uppercase;letter-spacing:1px;
  transition:all .12s;
}
.fxe-ov-tl-btn:hover {
  background:#222;border-color:#e8ff00;color:#e8ff00;
}
.fxe-ov-lines-list {
  display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto;
  background:#0a0a0a;border:1px solid #1a1a1a;border-radius:3px;padding:4px;
}
.fxe-ov-lines-list::-webkit-scrollbar { width:4px; }
.fxe-ov-lines-list::-webkit-scrollbar-thumb { background:#333;border-radius:2px; }
.fxe-ov-line-item {
  display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;
  background:#111;border:1px solid #1a1a1a;border-radius:2px;
  transition:all .12s;
}
.fxe-ov-line-item:hover {
  background:#161616;border-color:#333;
}
.fxe-ov-line-check {
  flex-shrink:0;width:14px;height:14px;cursor:pointer;
  accent-color:#e8ff00;
}
.fxe-ov-line-text {
  font-family:'Space Mono',monospace;font-size:8px;color:#999;
  flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  letter-spacing:0.5px;
}

/* Open selector button */
.fxe-ov-open-selector {
  margin-top:8px;
  width:100%;
  padding:10px 12px !important;
  font-size:11px !important;
  background:#1a1a1a !important;
  border:1px solid #333 !important;
  color:#e8ff00 !important;
  cursor:pointer;
  transition:all .15s;
}
.fxe-ov-open-selector:hover {
  background:#222 !important;
  border-color:#e8ff00 !important;
  transform:translateX(2px);
}

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
    const bodyEl   = overlay.querySelector('#fxeBodyText');
    const ovPanel  = overlay.querySelector('#fxeOvPanel');
    const tabText  = overlay.querySelector('#fxeTabText');
    const tabObjs  = overlay.querySelector('#fxeTabObjects');

    function switchTab(tab) {
      fxeTab = tab;
      if (tab === 'text') {
        bodyEl.style.display   = '';
        ovPanel.style.display  = 'none';
        tabText.classList.add('active');
        tabObjs.classList.remove('active');
      } else {
        bodyEl.style.display   = 'none';
        ovPanel.style.display  = 'flex';
        tabObjs.classList.add('active');
        tabText.classList.remove('active');
        renderOverlayPanel();
      }
    }
    tabText.addEventListener('click',  () => switchTab('text'));
    tabObjs.addEventListener('click',  () => switchTab('objects'));

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

    // ── Line Selector Panel handlers ─────────────
    const lsClose = overlay.querySelector('#fxeLsClose');
    const lsBackdrop = overlay.querySelector('#fxeLsBackdrop');
    const lsSelectAll = overlay.querySelector('#fxeLsSelectAll');
    const lsClearAll = overlay.querySelector('#fxeLsClearAll');
    
    lsClose.addEventListener('click', closeLineSelectorPanel);
    lsBackdrop.addEventListener('click', closeLineSelectorPanel);
    
    lsSelectAll.addEventListener('click', () => {
      if (!currentOverlayId) return;
      BackgroundEngine.updateOverlay(currentOverlayId, { 
        selectedLines: lines.map((_, idx) => idx) 
      });
      openLineSelectorPanel(currentOverlayId); // Refresh
    });
    
    lsClearAll.addEventListener('click', () => {
      if (!currentOverlayId) return;
      BackgroundEngine.updateOverlay(currentOverlayId, { selectedLines: [] });
      openLineSelectorPanel(currentOverlayId); // Refresh
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
      { value:'static',  label:'Статика'       },
      { value:'sway',    label:'Покачивание'    },
      { value:'pulse',   label:'Пульс (бас)'    },
      { value:'stretch', label:'Растяжение'     },
      { value:'float',   label:'Плавание'       },
      { value:'shake',   label:'Тряска'         },
      { value:'bounce',  label:'Отскок'         },
      { value:'spin',    label:'Вращение'       },
    ];

    ovs.forEach(ov => {
      const card = document.createElement('div');
      card.className = 'fxe-ov-card' + (ov.enabled ? '' : ' disabled');

      // ── Card header ─────────────────────────────
      const header = document.createElement('div');
      header.className = 'fxe-ov-card-header';

      const thumb = document.createElement('img');
      thumb.className = 'fxe-ov-thumb';
      thumb.src = ov.url;
      header.appendChild(thumb);

      const nameEl = document.createElement('span');
      nameEl.className = 'fxe-ov-card-name';
      nameEl.textContent = ov.name;
      header.appendChild(nameEl);

      // Enable toggle
      const enBtn = document.createElement('button');
      enBtn.className = 'fxe-ov-chip' + (ov.enabled ? ' active-enabled' : '');
      enBtn.textContent = ov.enabled ? 'ВКЛ' : 'ВЫКЛ';
      enBtn.addEventListener('click', () => {
        BackgroundEngine.updateOverlay(ov.id, { enabled: !ov.enabled });
        renderOverlayPanel();
      });
      header.appendChild(enBtn);

      // Remove button
      const remBtn = document.createElement('button');
      remBtn.className = 'fxe-ov-rem';
      remBtn.textContent = '✕ удалить';
      remBtn.addEventListener('click', () => {
        BackgroundEngine.removeOverlay(ov.id);
        renderOverlayPanel();
      });
      header.appendChild(remBtn);

      card.appendChild(header);

      // ── Card body ────────────────────────────────
      const body = document.createElement('div');
      body.className = 'fxe-ov-card-body';

      // ── ROW 1: Layer (above/below) ───────────────
      const rowLayer = document.createElement('div');
      rowLayer.className = 'fxe-ov-row';
      const layerLbl = document.createElement('span');
      layerLbl.className = 'fxe-ov-row-label';
      layerLbl.textContent = 'Слой';
      rowLayer.appendChild(layerLbl);

      [['above','⬆ Выше текста'], ['below','⬇ Ниже текста']].forEach(([val, label]) => {
        const btn = document.createElement('button');
        btn.className = 'fxe-ov-chip' + (ov.layer === val ? ` active-layer-${val}` : '');
        btn.textContent = label;
        btn.addEventListener('click', () => {
          BackgroundEngine.updateOverlay(ov.id, { layer: val });
          renderOverlayPanel();
        });
        rowLayer.appendChild(btn);
      });
      body.appendChild(rowLayer);

      // ── ROW 2: Scope (global/timeline) ───────────
      const rowScope = document.createElement('div');
      rowScope.className = 'fxe-ov-row';
      const scopeLbl = document.createElement('span');
      scopeLbl.className = 'fxe-ov-row-label';
      scopeLbl.textContent = 'Видим.';
      rowScope.appendChild(scopeLbl);

      const btnGlobal = document.createElement('button');
      btnGlobal.className = 'fxe-ov-chip' + (ov.scope === 'global' ? ' active-scope-global' : '');
      btnGlobal.textContent = '♾ Везде';
      btnGlobal.addEventListener('click', () => {
        BackgroundEngine.updateOverlay(ov.id, { scope: 'global' });
        renderOverlayPanel();
      });
      rowScope.appendChild(btnGlobal);

      const btnTl = document.createElement('button');
      btnTl.className = 'fxe-ov-chip' + (ov.scope === 'timeline' ? ' active-scope-tl' : '');
      btnTl.textContent = '⏱ Таймлайн';
      btnTl.addEventListener('click', () => {
        BackgroundEngine.updateOverlay(ov.id, { scope: 'timeline' });
        renderOverlayPanel();
      });
      rowScope.appendChild(btnTl);

      // Timeline line selector button (shown only if scope=timeline)
      if (ov.scope === 'timeline') {
        const selectedCount = (ov.selectedLines || []).length;
        
        const btnOpenSelector = document.createElement('button');
        btnOpenSelector.className = 'fxe-ov-chip fxe-ov-open-selector';
        btnOpenSelector.textContent = `📋 Выбрать строки (${selectedCount}/${lines.length})`;
        btnOpenSelector.addEventListener('click', () => {
          openLineSelectorPanel(ov.id);
        });
        rowScope.appendChild(btnOpenSelector);
      }
      body.appendChild(rowScope);

      // ── ROW 3: Position presets + custom ─────────
      const rowPosPresets = document.createElement('div');
      rowPosPresets.className = 'fxe-ov-row';
      const posLbl = document.createElement('span');
      posLbl.className = 'fxe-ov-row-label';
      posLbl.textContent = 'Позиция';
      rowPosPresets.appendChild(posLbl);

      const positionMode = ov.positionMode || 'custom';
      const PRESETS = [
        { id: 'center',       label: '⊙ Центр',      x: 50,  y: 50  },
        { id: 'top',          label: '↑ Верх',       x: 50,  y: 15  },
        { id: 'bottom',       label: '↓ Низ',        x: 50,  y: 85  },
        { id: 'left',         label: '← Лево',       x: 15,  y: 50  },
        { id: 'right',        label: '→ Право',      x: 85,  y: 50  },
        { id: 'top-left',     label: '↖ Верх-лево',  x: 15,  y: 15  },
        { id: 'top-right',    label: '↗ Верх-право', x: 85,  y: 15  },
        { id: 'bottom-left',  label: '↙ Низ-лево',   x: 15,  y: 85  },
        { id: 'bottom-right', label: '↘ Низ-право',  x: 85,  y: 85  },
        { id: 'custom',       label: '✦ Произвольно', x: null, y: null },
      ];

      PRESETS.forEach(preset => {
        const btn = document.createElement('button');
        btn.className = 'fxe-ov-chip fxe-ov-pos-preset' + (positionMode === preset.id ? ' active-pos' : '');
        btn.textContent = preset.label;
        btn.addEventListener('click', () => {
          if (preset.id === 'custom') {
            // Переключаемся в произвольный режим, сохраняя текущие координаты
            BackgroundEngine.updateOverlay(ov.id, { positionMode: 'custom' });
          } else {
            // Применяем пресет
            BackgroundEngine.updateOverlay(ov.id, { 
              positionMode: preset.id,
              x: preset.x, 
              y: preset.y 
            });
          }
          renderOverlayPanel();
        });
        rowPosPresets.appendChild(btn);
      });
      body.appendChild(rowPosPresets);

      // ── ROW 4: Custom position controls (arrows) ─
      if (positionMode === 'custom') {
        const rowCustomPos = document.createElement('div');
        rowCustomPos.className = 'fxe-ov-row fxe-ov-custom-pos';
        
        const posGrid = document.createElement('div');
        posGrid.className = 'fxe-ov-pos-grid';
        
        // Создаём сетку 3x3 для стрелочек
        const arrows = [
          { dir: '↖', dx: -1, dy: -1 },
          { dir: '↑', dx:  0, dy: -1 },
          { dir: '↗', dx:  1, dy: -1 },
          { dir: '←', dx: -1, dy:  0 },
          { dir: '⊙', dx:  0, dy:  0 },
          { dir: '→', dx:  1, dy:  0 },
          { dir: '↙', dx: -1, dy:  1 },
          { dir: '↓', dx:  0, dy:  1 },
          { dir: '↘', dx:  1, dy:  1 },
        ];
        
        arrows.forEach(arrow => {
          const btn = document.createElement('button');
          btn.className = 'fxe-ov-arrow-btn';
          btn.textContent = arrow.dir;
          btn.addEventListener('click', () => {
            const step = 0.5; // шаг в процентах
            const newX = Math.max(0, Math.min(100, ov.x + arrow.dx * step));
            const newY = Math.max(0, Math.min(100, ov.y + arrow.dy * step));
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
        body.appendChild(rowCustomPos);
      }

      // ── ROW 5: Size + Opacity ─────────────────────
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
        val.textContent = initVal;
        sl.addEventListener('input', () => {
          val.textContent = sl.value;
          BackgroundEngine.updateOverlay(ov.id, { [key]: parseFloat(sl.value) });
        });
        row.appendChild(label); row.appendChild(sl); row.appendChild(val);
        return row;
      }

      const rowSize = document.createElement('div');
      rowSize.className = 'fxe-ov-row';
      rowSize.appendChild(makeSlider('Размер', 'width',   2,   200, 0.5,  ov.width));
      rowSize.appendChild(makeSlider('Alpha',  'opacity', 0,   1,   0.01, ov.opacity));
      body.appendChild(rowSize);

      // ── ROW 5: Effect type + amount ───────────────
      const rowFx = document.createElement('div');
      rowFx.className = 'fxe-ov-row';

      const fxLbl = document.createElement('span');
      fxLbl.className = 'fxe-ov-row-label';
      fxLbl.textContent = 'Эффект';
      rowFx.appendChild(fxLbl);

      const fxSel = document.createElement('select');
      fxSel.className = 'fxe-ov-select';
      EFFECTS.forEach(ef => {
        const o = document.createElement('option');
        o.value = ef.value; o.textContent = ef.label;
        if (ef.value === ov.effect) o.selected = true;
        fxSel.appendChild(o);
      });
      fxSel.addEventListener('change', () => {
        BackgroundEngine.updateOverlay(ov.id, { effect: fxSel.value });
      });
      rowFx.appendChild(fxSel);
      rowFx.appendChild(makeSlider('Сила', 'effectAmt', 0, 1, 0.01, ov.effectAmt));
      body.appendChild(rowFx);

      card.appendChild(body);
      list.appendChild(card);
    });
    
    // Update overlay preview canvas
    updateOverlayPreview();
  }

  /* ── Overlay Preview Canvas ─────────────────── */
  function updateOverlayPreview() {
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
    
    // Clear with dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    
    // Draw grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    
    // Draw sample text in center
    ctx.save();
    ctx.font = "48px 'Bebas Neue', sans-serif";
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SAMPLE TEXT', w / 2, h / 2);
    ctx.restore();
    
    // Draw all enabled overlays
    const ovs = BackgroundEngine.overlays.filter(ov => ov.enabled);
    const t = performance.now() / 1000;
    
    ovs.forEach(ov => {
      if (!ov.img || !ov.img.complete) return;
      
      ctx.save();
      ctx.globalAlpha = ov.opacity;
      
      // Calculate position (% to pixels) - КАК В ОСНОВНОМ РЕНДЕРЕ
      const baseX = (ov.x / 100) * w;
      const baseY = (ov.y / 100) * h;
      const baseW = (ov.width / 100) * w;  // ИСПОЛЬЗУЕМ ШИРИНУ ХОЛСТА, НЕ MIN!
      const baseH = baseW / (ov.img.naturalWidth / ov.img.naturalHeight);
      
      // Apply effect transform
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
      }
      
      const drawW = baseW * scaleX;
      const drawH = baseH * scaleY;
      
      ctx.translate(baseX + offsetX, baseY + offsetY);
      if (rotation) ctx.rotate(rotation);
      
      // Draw image centered
      ctx.drawImage(ov.img, -drawW / 2, -drawH / 2, drawW, drawH);
      
      ctx.restore();
    });
    
    // Animate preview
    if (ovs.length > 0 && fxeTab === 'objects') {
      requestAnimationFrame(updateOverlayPreview);
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
        if (!ov.img || !ov.img.complete) continue;
        
        const baseX = (ov.x / 100) * canvas.width;
        const baseY = (ov.y / 100) * canvas.height;
        const baseW = (ov.width / 100) * canvas.width;
        const baseH = baseW / (ov.img.naturalWidth / ov.img.naturalHeight);
        
        // Проверяем попадание в прямоугольник объекта
        if (canvasX >= baseX - baseW / 2 && canvasX <= baseX + baseW / 2 &&
            canvasY >= baseY - baseH / 2 && canvasY <= baseY + baseH / 2) {
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
          if (!ov.img || !ov.img.complete) continue;
          
          const baseX = (ov.x / 100) * canvas.width;
          const baseY = (ov.y / 100) * canvas.height;
          const baseW = (ov.width / 100) * canvas.width;
          const baseH = baseW / (ov.img.naturalWidth / ov.img.naturalHeight);
          
          if (canvasX >= baseX - baseW / 2 && canvasX <= baseX + baseW / 2 &&
              canvasY >= baseY - baseH / 2 && canvasY <= baseY + baseH / 2) {
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

  function openLineSelectorPanel(overlayId) {
    currentOverlayId = overlayId;
    const panel = overlay.querySelector('#fxeLineSelectorPanel');
    const backdrop = overlay.querySelector('#fxeLsBackdrop');
    const list = overlay.querySelector('#fxeLsList');
    const counter = overlay.querySelector('#fxeLsCounter');
    
    const ov = BackgroundEngine.overlays.find(o => o.id === overlayId);
    if (!ov) return;
    
    backdrop.style.display = 'block';
    panel.style.display = 'flex';
    
    // Render lines
    list.innerHTML = '';
    lines.forEach((line, idx) => {
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
          BackgroundEngine.updateOverlay(overlayId, { selectedLines: newSelected });
          
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
            
            BackgroundEngine.updateOverlay(overlayId, { selectedLines: selected });
            
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
      
      // Добавляем кнопки выше/ниже и селектор анимации для каждой строки
      const controls = document.createElement('div');
      controls.className = 'fxe-ls-line-controls';
      
      // Получаем текущую настройку lineStyle для этой строки
      const currentLayer = (line.lineStyle && line.lineStyle.layer) || null;
      const currentAnim = (line.lineStyle && line.lineStyle.animMode) || '';
      
      // Селектор эффекта объекта
      const animSelect = document.createElement('select');
      animSelect.className = 'fxe-ls-line-anim-select';
      animSelect.innerHTML = `
        <option value="">— эффект —</option>
        <option value="static">Статика</option>
        <option value="sway">Покачивание</option>
        <option value="pulse">Пульс (бас)</option>
        <option value="stretch">Растяжение</option>
        <option value="float">Плавание</option>
        <option value="shake">Тряска</option>
        <option value="bounce">Отскок</option>
        <option value="spin">Вращение</option>
      `;
      const currentEffect = (line.lineStyle && line.lineStyle.overlayEffect) || '';
      if (currentEffect) animSelect.value = currentEffect;
      
      animSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        saveHistory();
        lines[idx].lineStyle = lines[idx].lineStyle || {};
        lines[idx].lineStyle.overlayEffect = animSelect.value || null;
        renderEditor();
        renderOutput();
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
    });
    
    // Update counter
    counter.textContent = `${(ov.selectedLines || []).length} / ${lines.length}`;
  }

  function closeLineSelectorPanel() {
    const panel = overlay.querySelector('#fxeLineSelectorPanel');
    const backdrop = overlay.querySelector('#fxeLsBackdrop');
    panel.style.display = 'none';
    backdrop.style.display = 'none';
    currentOverlayId = null;
    renderOverlayPanel(); // Refresh main panel to show updated count
  }

  /* ── Render ─────────────────────────────────── */
  function renderEditor() {
    const scroll = overlay.querySelector('#fxeEditorScroll');
    scroll.innerHTML = '';

    lines.forEach((line, li) => {
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

      // BG command toggles
      const bgRow = document.createElement('div');
      bgRow.className = 'fxe-bg-toggles';
      bgRow.style.cssText = 'padding:5px 8px;background:#0a0a0a;border-bottom:1px solid #141414;';

      const bgCmds = line.bgCmds || {};

      const TOGGLES = [
        { key:'darken',              label:'🌑 ЗАТЕМН',         tip:'Затемнить фон с этой строки' },
        { key:'undarken',            label:'🌕 ОТМ.ЗАТЕМ',      tip:'Снять затемнение с этой строки' },
        { key:'brighten',            label:'☀ ЯРКО',            tip:'Яркий фон с этой строки' },
        { key:'unbrighten',          label:'🌙 ОТМ.ЯРКО',       tip:'Снять яркость с этой строки' },
        { key:'blur',                label:'💫 БЛЮР',            tip:'Размытие фона с этой строки' },
        { key:'unblur',              label:'✨ РЕЗК',            tip:'Убрать размытие с этой строки' },
        { key:'letterbox',           label:'🎬 ЛЕТТЕРБОКС',     tip:'Включить кинематографические полосы' },
        { key:'unletterbox',         label:'🎬 ОТМ.ЛЕТТЕР',     tip:'Выключить кинематографические полосы' },
        { key:'letterboxReactive',   label:'🎬 ЛЕТТЕР.РЕАКТ',   tip:'Включить реактивные полосы' },
        { key:'unletterboxReactive', label:'🎬 ОТМ.ЛЕТТЕР.Р',   tip:'Выключить реактивные полосы' },
      ];

      TOGGLES.forEach(({ key, label, tip }) => {
        const tog = document.createElement('button');
        tog.className = 'fxe-bg-tog';
        if (bgCmds[key]) tog.classList.add(`on-${key}`);
        tog.textContent = label;
        tog.title = tip;
        tog.addEventListener('click', () => {
          saveHistory();
          lines[li].bgCmds = lines[li].bgCmds || {};
          lines[li].bgCmds[key] = !lines[li].bgCmds[key];
          if (key==='darken'              && lines[li].bgCmds[key]) lines[li].bgCmds.undarken            = false;
          if (key==='undarken'            && lines[li].bgCmds[key]) lines[li].bgCmds.darken              = false;
          if (key==='brighten'            && lines[li].bgCmds[key]) lines[li].bgCmds.unbrighten          = false;
          if (key==='unbrighten'          && lines[li].bgCmds[key]) lines[li].bgCmds.brighten            = false;
          if (key==='blur'                && lines[li].bgCmds[key]) lines[li].bgCmds.unblur              = false;
          if (key==='unblur'              && lines[li].bgCmds[key]) lines[li].bgCmds.blur                = false;
          if (key==='letterbox'           && lines[li].bgCmds[key]) lines[li].bgCmds.unletterbox         = false;
          if (key==='unletterbox'         && lines[li].bgCmds[key]) lines[li].bgCmds.letterbox           = false;
          if (key==='letterboxReactive'   && lines[li].bgCmds[key]) lines[li].bgCmds.unletterboxReactive = false;
          if (key==='unletterboxReactive' && lines[li].bgCmds[key]) lines[li].bgCmds.letterboxReactive   = false;
          renderEditor();
          renderOutput();
        });
        bgRow.appendChild(tog);
      });

      expandable.appendChild(bgRow);

      expandable.appendChild(bgRow);

      // ── Camera commands row ────────────────────
      const camRow = document.createElement('div');
      camRow.className = 'fxe-cam-row';

      const camLabel = document.createElement('span');
      camLabel.className = 'fxe-cam-label';
      camLabel.textContent = '📷 камера:';
      camRow.appendChild(camLabel);

      const camCmds = line.camCmds || {};

      CAM_TOGGLES.forEach(({ key, label, tip, group }, idx) => {
        // Разделители между группами
        const groupBoundaries = [2, 4, 6]; // после zoomStop, scrollRight, scrollDown
        if (groupBoundaries.includes(idx)) {
          const sep = document.createElement('div');
          sep.className = 'fxe-cam-sep';
          camRow.appendChild(sep);
        }

        const tog = document.createElement('button');
        tog.className = 'fxe-cam-tog';
        if (camCmds[key]) tog.classList.add(`on-${key}`);
        tog.textContent = label;
        tog.title = tip;

        tog.addEventListener('click', () => {
          saveHistory();
          lines[li].camCmds = lines[li].camCmds || {};
          lines[li].camCmds[key] = !lines[li].camCmds[key];

          // Взаимоисключение внутри группы zoom
          if (group === 'zoom' && lines[li].camCmds[key]) {
            CAM_TOGGLES.filter(t => t.group === 'zoom' && t.key !== key)
              .forEach(t => { lines[li].camCmds[t.key] = false; });
          }
          // Взаимоисключение внутри группы scrollX
          if (group === 'scrollX' && lines[li].camCmds[key]) {
            CAM_TOGGLES.filter(t => t.group === 'scrollX' && t.key !== key)
              .forEach(t => { lines[li].camCmds[t.key] = false; });
          }
          // Взаимоисключение внутри группы scrollY
          if (group === 'scrollY' && lines[li].camCmds[key]) {
            CAM_TOGGLES.filter(t => t.group === 'scrollY' && t.key !== key)
              .forEach(t => { lines[li].camCmds[t.key] = false; });
          }

          renderEditor();
          renderOutput();
        });
        camRow.appendChild(tog);
      });

      expandable.appendChild(camRow);
      wrap.appendChild(expandable);

      // Toggle expandable on button click
      expandBtn.addEventListener('click', () => {
        const isHidden = expandable.style.display === 'none';
        expandable.style.display = isHidden ? 'block' : 'none';
        expandBtn.textContent = isHidden ? '⚙✓' : '⚙';
      });

      // ── Per-line style bar ─────────────────────
      const ls = line.lineStyle || {};
      const hasStyle = hasLineStyle(ls);

      const styleBar = document.createElement('div');
      styleBar.className = 'fxe-line-style';

      // Label
      const lsLabel = document.createElement('span');
      lsLabel.className = 'fxe-ls-label' + (hasStyle ? ' active' : '');
      lsLabel.textContent = '↳ стиль:';
      styleBar.appendChild(lsLabel);

      // ── Font select
      const fontSel = document.createElement('select');
      fontSel.className = 'fxe-ls-sel' + (ls.font ? ' on' : '');
      fontSel.title = 'Шрифт строки (override)';
      FONT_OPTIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === (ls.font || '')) o.selected = true;
        fontSel.appendChild(o);
      });
      fontSel.addEventListener('change', e => {
        saveHistory();
        lines[li].lineStyle = lines[li].lineStyle || {};
        lines[li].lineStyle.font = e.target.value || null;
        renderEditor();
        renderOutput();
      });
      styleBar.appendChild(fontSel);

      const div1 = document.createElement('div');
      div1.className = 'fxe-ls-divider';
      styleBar.appendChild(div1);

      // ── Font size input
      const sizeInp = document.createElement('input');
      sizeInp.type = 'number';
      sizeInp.className = 'fxe-ls-num' + (ls.fontSize ? ' on' : '');
      sizeInp.placeholder = 'px';
      sizeInp.title = 'Размер шрифта строки (override)';
      sizeInp.min = 12; sizeInp.max = 400;
      if (ls.fontSize) sizeInp.value = ls.fontSize;
      sizeInp.addEventListener('change', e => {
        saveHistory();
        lines[li].lineStyle = lines[li].lineStyle || {};
        const v = parseInt(e.target.value, 10);
        lines[li].lineStyle.fontSize = (v > 0) ? v : null;
        renderEditor();
        renderOutput();
      });
      styleBar.appendChild(sizeInp);

      const div2 = document.createElement('div');
      div2.className = 'fxe-ls-divider';
      styleBar.appendChild(div2);

      // ── Anim mode select
      const animSel = document.createElement('select');
      animSel.className = 'fxe-ls-sel' + (ls.animMode ? ' on' : '');
      animSel.title = 'Режим анимации строки (override)';
      ANIM_OPTIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.disabled) { o.disabled = true; o.style.color = '#555'; }
        if (opt.value === (ls.animMode || '')) o.selected = true;
        animSel.appendChild(o);
      });
      animSel.addEventListener('change', e => {
        saveHistory();
        lines[li].lineStyle = lines[li].lineStyle || {};
        lines[li].lineStyle.animMode = e.target.value || null;
        renderEditor();
        renderOutput();
      });
      styleBar.appendChild(animSel);

      const div3 = document.createElement('div');
      div3.className = 'fxe-ls-divider';
      styleBar.appendChild(div3);

      // ── Position select
      const posSel = document.createElement('select');
      posSel.className = 'fxe-ls-sel' + (ls.position ? ' on' : '');
      posSel.title = 'Позиция текста строки (override)';
      [
        { label: '— global —', value: '' },
        { label: 'Центр',      value: 'center' },
        { label: 'Верх',       value: 'top' },
        { label: 'Низ',        value: 'bottom' },
      ].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === (ls.position || '')) o.selected = true;
        posSel.appendChild(o);
      });
      posSel.addEventListener('change', e => {
        saveHistory();
        lines[li].lineStyle = lines[li].lineStyle || {};
        lines[li].lineStyle.position = e.target.value || null;
        renderEditor();
        renderOutput();
      });
      styleBar.appendChild(posSel);

      const div4 = document.createElement('div');
      div4.className = 'fxe-ls-divider';
      styleBar.appendChild(div4);

      // ── Line color swatch + hidden color input
      const colorWrap = document.createElement('div');
      colorWrap.className = 'fxe-ls-color-wrap';

      const colorSwatch = document.createElement('div');
      colorSwatch.className = 'fxe-ls-color-swatch' + (ls.color ? ' on' : '');
      colorSwatch.title = 'Цвет текста строки (override)';
      colorSwatch.style.background = ls.color || '#333';

      const colorInp = document.createElement('input');
      colorInp.type = 'color';
      colorInp.className = 'fxe-ls-color-inp';
      colorInp.value = ls.color || '#ffffff';
      colorInp.addEventListener('input', e => {
        colorSwatch.style.background = e.target.value;
        colorSwatch.classList.add('on');
      });
      colorInp.addEventListener('change', e => {
        saveHistory();
        lines[li].lineStyle = lines[li].lineStyle || {};
        lines[li].lineStyle.color = e.target.value;
        renderEditor();
        renderOutput();
      });

      colorSwatch.appendChild(colorInp);
      colorWrap.appendChild(colorSwatch);

      // Small label
      const colorLabel = document.createElement('span');
      colorLabel.style.cssText = 'font-family:Space Mono,monospace;font-size:7px;color:' + (ls.color ? '#e8ff00' : '#2a2a2a');
      colorLabel.textContent = 'цвет';
      colorWrap.appendChild(colorLabel);

      styleBar.appendChild(colorWrap);

      // ── Clear line style button
      if (hasStyle) {
        const div4 = document.createElement('div');
        div4.className = 'fxe-ls-divider';
        styleBar.appendChild(div4);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'fxe-ls-clear-style';
        clearBtn.textContent = '✕ сбросить';
        clearBtn.title = 'Убрать все стили этой строки (вернуть к глобальным)';
        clearBtn.addEventListener('click', () => {
          saveHistory();
          lines[li].lineStyle = {};
          renderEditor();
          renderOutput();
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
    
    console.log('Preview selected tokens:', selectedTokens);
    console.log('Preview text:', selectedText);
    
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
    
    console.log('Preview render params:', { font: effectiveFont, size: effectiveSize, color: effectiveColor });
    
    // Рендерим текст через TextRenderer
    const anim = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, alpha: 1 };
    const fadeAlpha = 1;
    const t = performance.now() / 1000;
    
    try {
      TextRenderer.draw(
        ctx, tempLyric,
        w / 2, h / 2,
        anim, fadeAlpha,
        effectiveColor, effectiveFont, effectiveSize, w, t
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
    saveHistory();
    const boxFxList = typeof BoxRegistry !== 'undefined'
      ? BoxRegistry.all.map(s => s.id)
      : ['box','boxneon','boxglass','boxshadow','boxtape','boxrough'];
    const isBox = boxFxList.includes(fx);
    selectedToks.forEach(({li,ti}) => {
      const tok = lines[li]?.tokens[ti];
      if (!tok) return;
      const has = tok.effects.includes(fx);
      if (isBox && !has) tok.effects = tok.effects.filter(f=>!boxFxList.includes(f));
      tok.effects = has ? tok.effects.filter(f=>f!==fx) : [...tok.effects, fx];
    });
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
