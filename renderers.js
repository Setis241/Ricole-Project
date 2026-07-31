/* ═══════════════════════════════════════════════
   js/renderers.js  v4
   TextRenderer — поддержка inline FX-тегов + рамки:
     *bold* _italic_ ~underline~ ~~strike~~
     {BIG}…{/BIG} {SMALL}…{/SMALL}
     {GLITCH}…{/GLITCH} {GLOW}…{/GLOW}
     {WAVE}…{/WAVE} {OUTLINE}…{/OUTLINE}
     {RAINBOW}…{/RAINBOW} {NEON}…{/NEON} {GRAD}…{/GRAD}
     {BLUR}…{/BLUR} {FLICKER}…{/FLICKER}
     {COLOR:#hex}…{/COLOR}
     — Рамки/боксы (работают на уровне слова) —
     {BOX}       Прицел — двойная рамка с угловыми метками
     {BOXNEON}   Неон — многослойное свечение + внутренний градиент
     {BOXGLASS}  Стекло — матовое со светом и бликами
     {BOXSHADOW} 3D экструзия — выдавленная рамка с гранями
     {BOXTAPE}   VHS-лента — перфорация и полосы кассеты
     {BOXROUGH}  Граффити — рваные угловые штрихи + чернила
═══════════════════════════════════════════════ */
const TextRenderer = (() => {

  // Fallback на системные emoji-шрифты — без него canvas рисует только
  // monochrome глифы или вообще ничего на месте 🎵 🎶 🔥 и т.п.
  // Браузер сам подбирает первый доступный из цепочки по платформе.
  const EMOJI_FB = ',"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji"';

  // Последний замер страховки кадра — читается из window.RicoleDebug()
  let _diag = null;

  /* ── Цвет: разбор и сдвиг к белому/чёрному ──
     Нужен для градиентов по букве. Всё, что не разобралось (named-цвет,
     hsl, currentColor), отдаётся назад как есть — тогда градиент просто
     вырождается в плоскую заливку и ничего не ломается. */
  function _rgb(color) {
    if (typeof color !== 'string') return null;
    const s = color.trim();
    let m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) return [0,1,2].map(i => parseInt(m[1][i]+m[1][i], 16));
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) return [0,2,4].map(i => parseInt(m[1].substr(i,2), 16));
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }
  // k > 0 — к белому, k < 0 — к чёрному. Возвращает css-цвет.
  function _shift(color, k, alpha) {
    const c = _rgb(color);
    if (!c) return color;
    const to = k > 0 ? 255 : 0, a = Math.abs(k);
    const [r,g,b] = c.map(v => Math.round(v + (to - v) * a));
    return alpha === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
  }
  // Поворот тона — для дуотона в {GRAD}: партнёрский цвет берём от самой
  // буквы, а не из палитры, иначе градиент спорит с цветом строки.
  function _hueRotate(color, deg, satBoost) {
    const c = _rgb(color);
    if (!c) return color;
    let [r,g,b] = c.map(v => v/255);
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
    let h = 0;
    if (d) {
      if (max === r)      h = ((g-b)/d) % 6;
      else if (max === g) h = (b-r)/d + 2;
      else                h = (r-g)/d + 4;
    }
    h = (h*60 + deg + 360) % 360;
    const l = (max+min)/2;
    let s = d === 0 ? 0 : d / (1 - Math.abs(2*l - 1));
    s = Math.min(1, s * (satBoost || 1));
    return `hsl(${h.toFixed(1)}, ${(s*100).toFixed(1)}%, ${(l*100).toFixed(1)}%)`;
  }

  // Насыщенность 0..1 — по ней решаем, можно ли крутить тон.
  function _sat(color) {
    const c = _rgb(color);
    if (!c) return 0;
    const [r,g,b] = c.map(v => v/255);
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
    if (!d) return 0;
    const l = (max+min)/2;
    return d / (1 - Math.abs(2*l - 1));
  }

  /* Пара «холодный/тёплый» концы градиента.
     Белый и серый — самые частые цвета строки, а поворот тона на них не
     даёт ничего: hue у ахроматичного цвета не определён, и градиент
     вырождается в серую растяжку. Поэтому на низкой насыщенности концы
     берём фиксированные (лёд → латунь) — это даёт хрому цвет, не сдвигая
     сам цвет строки. На цветном тексте концы по-прежнему выводим из него. */
  function _duoEnds(color) {
    if (_sat(color) < 0.18) return ['#a8d8ff', '#ffcf9a'];
    return [_hueRotate(color, -46, 1.35), _hueRotate(color, 44, 1.3)];
  }

  /* ── Заливка по диагонали кегля ──
     Плоский цвет читается как «текст положили поверх картинки». Перепад
     идёт по диагонали ~20°, а не строго по вертикали: вертикаль на прописных
     даёт ровные полосы, диагональ ведёт взгляд вдоль строки. Амплитуда
     заметная — слабый перепад на видео просто не виден, он съедается
     компрессией и фоном. Верх уходит почти в белый, низ — в насыщенную тень
     с поворотом тона, чтобы тень была цветной, а не грязно-серой.
     Диапазон меряем от кегля, а не от bbox: bbox прыгает от слова к слову
     («ЛОМ» против «руль»), и градиент дышал бы на каждом слове. */
  /* Глубокая тень цвета — нижний тон дуотона.
     На референсе розовый уходит не в «тот же розовый, но темнее», а в
     сине-фиолетовую глубину: тон уводится против часовой, насыщенность
     срезается, светлота падает почти в ноль. Серо-чёрный низ выглядел бы
     грязью, поэтому темнота обязана быть цветной. */
  function _deepShade(color) {
    // Не в чёрный: на тёмном кадре низ буквы иначе просто обрывается, и
    // строка теряет нижнюю линию. Глубина цветная и различимая.
    if (_sat(color) < 0.18) return '#3a2f52';
    return _shift(_hueRotate(color, -54, 0.78), -0.62);
  }

  /* ── Слежка за фоновым слоем ────────────────────────────────────────
     «Фон подстраивается» — жалоба, которую по кадру не поймать: скачок
     длится один кадр, а на скриншоте видно только его результат. Гадать
     по описанию дальше бессмысленно, поэтому фон меряется по факту.

     Каждый кадр снимаем подпись фактически нарисованного фона: сколько
     элементов, каким кеглем, от какой точки, какой habбит по краям. Если
     между соседними кадрами что-то из этого прыгнуло сильнее порога —
     запись уходит в кольцевой буфер вместе с ПРИЧИНАМИ-кандидатами
     (сменилась строка? кегль? точка? число элементов?).

     Читать: window.RicoleDebug().скачкиФона — там будет видно, что именно
     дёргается, вместо очередной догадки. */
  let _ghostPrev = null;
  const _ghostJumps = [];
  function _watchGhost(sig) {
    const p = _ghostPrev;
    _ghostPrev = sig;
    if (!p) return;
    const d = {
      кегль:  Math.abs(sig.fs - p.fs),
      точкаX: Math.abs(sig.cx - p.cx),
      точкаY: Math.abs(sig.cy - p.cy),
      левый:  Math.abs(sig.x0 - p.x0),
      правый: Math.abs(sig.x1 - p.x1),
      число:  Math.abs(sig.n  - p.n),
    };
    // Пороги: кадр к кадру фон движется на единицы пикселей. Всё, что
    // больше, — это уже не движение, а пересборка.
    const прыгнуло = d.кегль > 0.5 || d.точкаX > 6 || d.точкаY > 6 ||
                     d.левый > 24 || d.правый > 24 || d.число > 0;
    if (!прыгнуло) return;
    _ghostJumps.push({
      строкаБыла: p.line, строкаСтала: sig.line,
      сменаСтроки: p.line !== sig.line,
      кегль: p.fs.toFixed(1) + '→' + sig.fs.toFixed(1),
      точка: Math.round(p.cx) + ',' + Math.round(p.cy) + '→' +
             Math.round(sig.cx) + ',' + Math.round(sig.cy),
      край:  Math.round(p.x0) + '…' + Math.round(p.x1) + '→' +
             Math.round(sig.x0) + '…' + Math.round(sig.x1),
      элементов: p.n + '→' + sig.n,
    });
    if (_ghostJumps.length > 40) _ghostJumps.shift();
  }

  /* Состояние страховки кадра между кадрами — см. _fit в drawWordLayout. */
  let _fitSoft = 1, _fitKey = '';
  /* То же для вписывания раскладки в зону (kFit): при зуме камеры зона
     меняется каждый кадр, и без латча набор пересобирается непрерывно. */
  let _kFitSoft = 1, _kFitKey = '';

  function fillGradient(ctx, x, cy, tw, size, color) {
    if (!_rgb(color)) return color;
    const g = ctx.createLinearGradient(0, cy - size*0.62, 0, cy + size*0.46);
    const deep = _deepShade(color);
    // Перелом резкий и смещён вниз — как на референсе, где тёмная порода
    // подступает снизу и съедает цвет за короткий участок, а не плавно
    // растворяется по всей высоте.
    g.addColorStop(0,    _shift(color,  0.16));
    g.addColorStop(0.34, color);
    g.addColorStop(0.62, _shift(color, -0.30));
    g.addColorStop(0.84, _shift(deep,   0.10));
    g.addColorStop(1,    deep);
    return g;
  }

  /* ── {GRAD}: дуотон во всю высоту, чистый цвет → цветная глубина ── */
  function duotoneGradient(ctx, x, cy, tw, size, color) {
    if (!_rgb(color)) return color;
    const g = ctx.createLinearGradient(0, cy - size*0.66, 0, cy + size*0.48);
    const deep = _deepShade(color);
    g.addColorStop(0,    _shift(color,  0.34));
    g.addColorStop(0.26, _shift(color,  0.06));
    g.addColorStop(0.55, _shift(color, -0.14));
    g.addColorStop(0.78, _shift(deep,   0.18));
    g.addColorStop(1,    _shift(deep,  -0.12));
    return g;
  }

  /* ── Фактура ──
     Референс — не чистая растяжка, а порода: цвет проеден крошкой, и чем
     ниже, тем её больше. Готовим один тайл шума и красим им букву вторым
     проходом fillText — так крошка обрезается ровно по глифам. Плотность
     набираем полосами: clip по прямоугольнику дёшев, а альфа-градиент
     поверх паттерна в canvas недоступен. */
  let _grainTile = null;
  function _grainPattern(ctx) {
    if (!_grainTile) {
      const n = 128;
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d');
      const img = g.createImageData(n, n);
      for (let i = 0; i < n*n; i++) {
        const v = Math.random();
        // Крошка редкая и рваная: большая часть тайла прозрачна, иначе
        // это читается как равномерный шум видеокодека, а не как фактура.
        const a = v > 0.62 ? (v - 0.62) / 0.38 : 0;
        const o = i*4;
        img.data[o] = img.data[o+1] = img.data[o+2] = 0;
        img.data[o+3] = Math.round(a * 235);
      }
      g.putImageData(img, 0, 0);
      _grainTile = c;
    }
    return ctx.createPattern(_grainTile, 'repeat');
  }

  function drawGrain(ctx, word, x, y, tw, size, strength) {
    // Ниже ~52px крошка не читается — тайл 128px даёт на такой букве
    // считанные точки. Проход всё равно стоит fillText на слово, поэтому
    // просто не делаем его.
    if (size < 52) return;
    const pat = _grainPattern(ctx);
    if (!pat) return;
    const half = Math.max(tw, size) * 0.6;
    const top = y - size*0.7, h = size*1.25;
    ctx.save();
    ctx.fillStyle = pat;
    // Три полосы снизу вверх: у базовой линии крошки густо, к верхним
    // выносным она сходит на нет.
    // Две полосы, не три: третья добавляла проход fillText на слово и почти
    // ничего не давала глазу — крошка и так густеет к базовой линии.
    const bands = [[0.34, 0.38], [0.72, 0.70]];
    for (const [a, from] of bands) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - half, top + h*from, half*2, h*(1 - from) + 2);
      ctx.clip();
      ctx.globalAlpha = a * strength;
      ctx.fillText(word, x, y);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ── Ореол под буквой вместо обводки ──
     Строка обязана читаться на любом кадре, но strokeText утолщает штрих и
     ломает рисунок шрифта. Здесь то же самое делает мягкая тень: плотное
     тёмное пятно точно под глифом (blur ≈ 12% кегля, сдвиг вниз ≈ 4%) плюс
     широкий разрежённый подбой. Контур остаётся контуром шрифта, а контраст
     набирается за границей глифа. Два прохода вместо четырёх слоёв —
     shadowBlur считается гауссом на каждую отрисовку и стоит дорого. */
  function drawContactShadow(ctx, word, x, y, size, color, halo) {
    ctx.save();
    // ОДИН проход с тенью, не два. shadowBlur — гаусс на каждую отрисовку,
    // и цена растёт квадратично от радиуса; на плотной строке пара таких
    // проходов на слово уже видна в экспорте. Цвет ореола — глубокая тень
    // самого цвета: тёмная настолько, чтобы держать контраст на светлом
    // кадре, и цветная настолько, чтобы читаться как свечение, а не грязь.
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.shadowColor  = _shift(_deepShade(color), -0.15, 0.9);
    ctx.shadowBlur   = Math.min(30, size * (halo || 0.26));
    ctx.shadowOffsetY = size*0.03;
    ctx.globalAlpha *= 0.85;
    ctx.fillText(word, x, y);
    ctx.restore();
  }

  /* ── Блик ──
     Отдельный проход fillText градиентом «прозрачно → белый → прозрачно».
     Это способ обрезать блик ровно по глифам: пути текста в canvas нет,
     а clip() требует путь, поэтому светим второй заливкой, а не маской.
     Полоса едет по слову; фаза завязана на x, чтобы соседние слова строки
     не вспыхивали синхронно и строка не мигала одним куском. */
  function sheenGradient(ctx, x, cy, tw, size, t, strength) {
    const half = Math.max(tw, size) * 0.5;
    const g = ctx.createLinearGradient(x - half, cy + size*0.4, x + half, cy - size*0.5);
    const p = (Math.sin(t*1.15 + x*0.0035) * 0.5 + 0.5) * 0.76 + 0.12;
    const w = 0.13;
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(Math.max(0.001, p - w), 'rgba(255,255,255,0)');
    g.addColorStop(p, `rgba(255,255,255,${strength})`);
    g.addColorStop(Math.min(0.999, p + w), 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    return g;
  }

  function getFadeAlpha(elapsed, duration, fadeDur) {
    const fadeIn  = Math.min(elapsed / fadeDur, 1);
    const fadeOut = duration > 0 ? Math.min((duration - elapsed) / fadeDur, 1) : 1;
    return Math.max(0, Math.min(fadeIn, fadeOut, 1));
  }

  /* ── Deterministic jitter for boxrough ── */
  function makeJitter(seed) {
    let s = seed | 0;
    return () => {
      s = (Math.imul(1664525, s) + 1013904223) | 0;
      return (s >>> 0) / 4294967296 * 5 - 2.5;
    };
  }
  function strSeed(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) | 0;
    return h;
  }

  /* ── Parse tagged text into spans ── */
  function parseSpans(text, baseColor, t) {
    // ВАЖНО: сначала убираем line-style теги {LFONT/LSIZE/LANIM/LCOLOR/LLAYER/LOVFX},
    // потом команды фона, потом метки секций — порядок решает!
    text = text
      .replace(/\{L(?:FONT|SIZE|ANIM|COLOR|LAYER|POS|BGIMG|OVFX):[^}]+\}|\{LNOBOX\}/g, '') // убрать line-style теги
      .replace(/\/[^\/{}]+\//g, '')                         // убрать ВСЕ /КОМАНДЫ/ включая /ZOOM IN/ (скобки исключены, чтобы не съесть {/GLOW}{/BOX…})
      .trim();
    /* После зачистки section-метка оказывается в начале — убираем.
       Якорь ^ пропускает ведущие словесные теги: {LANIM}-подобные сняты
       выше, но {GLOW}/{BOX…} остаются, и метка «[Chorus]» за ними переставала
       считаться меткой — уезжала в кадр как слово песни. Ведущие теги
       сохраняем ($1), режем только саму метку. */
    text = text.replace(/^((?:\{[^}]*\}|\s)*)\[[^\]]+\]\s*/, '$1').trim();

    const spans = [];
    const BOX_TAGS = typeof BoxRegistry !== 'undefined' ? BoxRegistry.all.map(s=>s.id.toUpperCase()).join('|') : 'BOX|BOXNEON|BOXGLASS|BOXSHADOW|BOXTAPE|BOXROUGH|BOXFIRE|BOXICE|BOXHOLO|BOXGOLD|BOXCYBER|BOXRAINBOW|BOXRETRO|BOXAURA|BOXMATRIX|BOXSMOKE|BOXPLASMA|BOXTATTOO|BOXSUNSET|BOXLACQUER|BOXCRYSTAL|BOXDANGER|BOXDIAMOND|BOXFAULT|BOXINK|BOXPORTAL|BOXSIGIL|BOXSTATIC|BOXVHS|BOXVIRUS|BOXWAVE|BOXWIRE';
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

    // ── Box state init: подтягиваем ВСЕ id из BoxRegistry динамически.
    //    Хардкод отсюда убран, иначе новые рамки (boxsub/boxstealth/boxintro…)
    //    матчатся TAG_RE, но `if (k in state)` роняет их, и они не рисуются.
    //    Retired-список оставлен, чтобы легаси-LRC не ломались.
    const _ACTIVE_BOX_IDS  = typeof BoxRegistry !== 'undefined'
      ? BoxRegistry.all.map(s => s.id)
      : ['box','boxtape'];
    const _RETIRED_BOX_IDS = (typeof BoxRegistry !== 'undefined' && BoxRegistry.retired)
      ? BoxRegistry.retired
      : ['boxneon','boxglass','boxshadow','boxrough','boxfire','boxice','boxholo','boxgold','boxcyber','boxrainbow','boxretro','boxaura','boxmatrix','boxsmoke','boxplasma','boxtattoo','boxsunset','boxlacquer','boxcrystal','boxdanger','boxdiamond','boxfault','boxink','boxportal','boxsigil','boxstatic','boxvhs','boxvirus','boxwave','boxwire'];
    const state = {
      bold:false,italic:false,underline:false,strike:false,
      big:false,small:false,glitch:false,glow:false,shake:false,wave:false,
      outline:false,rainbow:false,neon:false,blur:false,flicker:false,grad:false,
      color:null,
    };
    for (const id of _ACTIVE_BOX_IDS)  state[id] = false;
    for (const id of _RETIRED_BOX_IDS) if (!(id in state)) state[id] = false;

    const parts = [];
    let last = 0; let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text)) !== null) {
      if (m.index > last) parts.push({ type:'text', val:text.slice(last,m.index) });
      parts.push({ type:'tag', val:m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type:'text', val:text.slice(last) });

    if (!parts.length || (parts.length===1 && parts[0].type==='text')) {
      // Базовая болванка spana: все активные + retired box-флаги = false.
      // Так span совместим и с BoxRegistry.spanBoxId(), и со старыми проверками в draw*.
      const _emptyBoxes = {};
      for (const id of _ACTIVE_BOX_IDS)  _emptyBoxes[id] = false;
      for (const id of _RETIRED_BOX_IDS) _emptyBoxes[id] = false;
      return text.split(/\s+/).filter(Boolean).map(w=>({
        word:w, color:baseColor,
        bold:false,italic:false,underline:false,strike:false,
        big:false,small:false,glitch:false,glow:false,shake:false,wave:false,
        outline:false,rainbow:false,neon:false,blur:false,flicker:false,grad:false,
        ..._emptyBoxes,
      }));
    }

    // Собираем слова с одинаковыми эффектами в группы
    let currentGroup = null;
    
    for (const part of parts) {
      if (part.type === 'text') {
        const words = part.val.split(/\s+/).filter(w=>w&&w.trim());
        for (const word of words) {
          // Создаём ключ состояния для группировки
          const stateKey = JSON.stringify({
            ...state,
            color: state.color || baseColor
          });
          
          // Если состояние изменилось, начинаем новую группу
          if (!currentGroup || currentGroup.stateKey !== stateKey) {
            if (currentGroup) {
              spans.push({ ...currentGroup.state, word: currentGroup.words.join(' ') });
            }
            currentGroup = {
              stateKey,
              state: { ...state, color: state.color || baseColor },
              words: [word]
            };
          } else {
            // Добавляем слово в текущую группу
            currentGroup.words.push(word);
          }
        }
      } else {
        // При встрече тега завершаем текущую группу
        if (currentGroup) {
          spans.push({ ...currentGroup.state, word: currentGroup.words.join(' ') });
          currentGroup = null;
        }
        
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
    
    // Не забываем добавить последнюю группу
    if (currentGroup) {
      spans.push({ ...currentGroup.state, word: currentGroup.words.join(' ') });
    }
    
    return spans;
  }

  /* ── Measure a span ── */
  function measureSpan(ctx, span, baseFontSize, font) {
    const size = span.big ? baseFontSize*1.45 : span.small ? baseFontSize*0.65 : baseFontSize;
    let style = '';
    if (span.bold)   style += 'bold ';
    if (span.italic) style += 'italic ';
    ctx.font = `${style}${size}px ${font}${EMOJI_FB}`;
    const width = ctx.measureText(span.word).width;
    return { width: width || (span.word.trim()==='' ? size*0.3 : 0), size };
  }

  /* ── Line-wrap spans into rows ── */
  function wrapSpans(ctx, spans, maxWidth, baseFontSize, font) {
    const rows=[]; let row=[]; let rowW=0;
    const WORD_GAP = baseFontSize * 0.35;
    for (const span of spans) {
      const {width} = measureSpan(ctx,span,baseFontSize,font);
      // Учитываем отступ перед словом при расчёте переноса
      const gapBefore = row.length > 0 && span.word.trim() ? WORD_GAP : 0;
      const totalWidth = rowW + gapBefore + width;
      
      // Переносим на новую строку если не влезает И уже есть слова в строке
      if (totalWidth > maxWidth && row.length > 0) {
        rows.push(row); 
        row=[]; 
        rowW=0;
      }
      
      row.push({...span,_w:width});
      rowW += width + (row.length > 1 ? WORD_GAP : 0);
    }
    if (row.length) rows.push(row);
    return rows;
  }

  /* ══════════════════════════════════════════════
     DRAW BOX — 10 премиальных стилей
     x,y = центр текста; w,h = размер текста
  ══════════════════════════════════════════════ */
  function drawBox(ctx, span, x, y, w, h, t) {
    ctx.save();
    
    // Определяем padding с учетом padMultiplier для специальных боксов
    let padMultiplier = 1;
    const boxEffects = Object.keys(span).filter(k => k.startsWith('box') && span[k]);
    if (boxEffects.length > 0 && typeof BoxRegistry !== 'undefined') {
      const boxStyle = BoxRegistry.all.find(s => boxEffects.includes(s.id));
      if (boxStyle && boxStyle.padMultiplier) {
        padMultiplier = boxStyle.padMultiplier;
      }
    }
    
    const pad = Math.max(14, h * 0.22) * padMultiplier;
    const bx  = x - w/2 - pad;
    const by  = y - h/2 - pad * 0.75;
    const bw  = w + pad*2;
    const bh  = h + pad * 1.5;
    const col = span.color || '#ffffff';
    const r   = Math.min(bw, bh) * 0.08; // corner radius helper

    /* ── BOX: Тактический / Прицел ─────────────────
       Угловые L-скобки + сканирующая линия         */
    if (span.box) {
      const c  = col;
      const cs = Math.min(bw, bh) * 0.32;

      // Тёмная полупрозрачная подложка
      const bgGrad = ctx.createLinearGradient(bx, by, bx, by+bh);
      bgGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
      bgGrad.addColorStop(1, 'rgba(0,0,0,0.30)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(bx, by, bw, bh);

      // Сканирующая линия (анимированная)
      const scanY = by + ((t * 60) % bh);
      const scanGrad = ctx.createLinearGradient(bx, scanY-3, bx, scanY+3);
      scanGrad.addColorStop(0, 'rgba(0,229,255,0)');
      scanGrad.addColorStop(0.5, 'rgba(0,229,255,0.5)');
      scanGrad.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(bx, scanY-3, bw, 6);

      // Угловые L-скобки
      ctx.strokeStyle = c;
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'square';
      ctx.shadowColor = c;
      ctx.shadowBlur  = 12;
      ctx.beginPath();
      [[bx,bx+cs],[bx+bw,bx+bw-cs]].forEach(([ex,ix]) => {
        [[by,by+cs],[by+bh,by+bh-cs]].forEach(([ey,iy]) => {
          ctx.moveTo(ix, ey);
          ctx.lineTo(ex, ey);
          ctx.lineTo(ex, iy);
        });
      });
      ctx.stroke();

      // Тонкая пунктирная рамка между углами
      ctx.save();
      ctx.shadowBlur  = 0;
      ctx.lineWidth   = 0.75;
      ctx.globalAlpha = 0.25;
      ctx.setLineDash([3, 7]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
      ctx.restore();

      // Центральный крест-прицел
      const cx2  = bx+bw/2, cy2 = by+bh/2;
      const tick = Math.min(bw,bh)*0.06;
      ctx.strokeStyle = c;
      ctx.lineWidth   = 1.5;
      ctx.shadowBlur  = 8;
      ctx.shadowColor = c;
      ctx.beginPath();
      ctx.moveTo(cx2-tick,cy2); ctx.lineTo(cx2+tick,cy2);
      ctx.moveTo(cx2,cy2-tick); ctx.lineTo(cx2,cy2+tick);
      ctx.stroke();

    /* ── BOXNEON: Неоновая вывеска ──────────────────
       Многослойное свечение + цветной градиент + пульс */
    } else if (span.boxneon) {
      const nc    = span.color || '#c678ff';
      const pulse = 0.85 + Math.sin(t * 3.5) * 0.15;

      // Фоновый градиент
      const bg = ctx.createLinearGradient(bx, by, bx+bw*0.3, by+bh);
      bg.addColorStop(0,   nc + '22');
      bg.addColorStop(0.5, nc + '08');
      bg.addColorStop(1,   nc + '18');
      ctx.fillStyle = bg;
      ctx.fillRect(bx, by, bw, bh);

      // Внешний широкий ореол
      ctx.save();
      ctx.shadowColor = nc;
      ctx.shadowBlur  = 40 * pulse;
      ctx.strokeStyle = nc;
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.08;
      ctx.strokeRect(bx-12, by-12, bw+24, bh+24);
      ctx.restore();

      // Средний ореол
      ctx.save();
      ctx.shadowBlur  = 20 * pulse;
      ctx.lineWidth   = 2.5;
      ctx.globalAlpha = 0.25;
      ctx.strokeRect(bx-2, by-2, bw+4, bh+4);
      ctx.restore();

      // Основная яркая линия
      ctx.save();
      ctx.shadowBlur  = 8;
      ctx.lineWidth   = 2;
      ctx.globalAlpha = pulse;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();

      // Белая внутренняя линия
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * pulse})`;
      ctx.shadowBlur  = 2;
      ctx.lineWidth   = 0.75;
      ctx.strokeRect(bx+2.5, by+2.5, bw-5, bh-5);

      // Угловые светящиеся квадраты
      ctx.save();
      const sq = 6;
      ctx.fillStyle   = nc;
      ctx.shadowBlur  = 14;
      ctx.shadowColor = nc;
      ctx.globalAlpha = pulse;
      [[bx-1,by-1],[bx+bw-sq+1,by-1],[bx-1,by+bh-sq+1],[bx+bw-sq+1,by+bh-sq+1]]
        .forEach(([cx,cy]) => ctx.fillRect(cx,cy,sq,sq));
      ctx.restore();

    /* ── BOXGLASS: Liquid Glass / Frosted ───────────
       Многослойное стекло с преломлением и бликами    */
    } else if (span.boxglass) {
      const breathe = 0.9 + Math.sin(t*1.8)*0.1;

      // Скруглённый прямоугольник
      function roundRect(x,y,w,h,r) {
        ctx.beginPath();
        ctx.moveTo(x+r,y);
        ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
        ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
        ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
        ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
        ctx.closePath();
      }

      const gr = Math.min(bw,bh)*0.12;

      // Основная матовая заливка
      roundRect(bx, by, bw, bh, gr);
      const fill = ctx.createLinearGradient(bx, by, bx+bw*0.6, by+bh);
      fill.addColorStop(0,   `rgba(220,240,255,${0.18*breathe})`);
      fill.addColorStop(0.45,`rgba(180,220,255,${0.07*breathe})`);
      fill.addColorStop(1,   `rgba(160,210,255,${0.13*breathe})`);
      ctx.fillStyle = fill;
      ctx.fill();

      // Верхний бликовый эллипс
      ctx.save();
      ctx.clip();
      const topBlur = ctx.createLinearGradient(bx, by, bx, by+bh*0.55);
      topBlur.addColorStop(0,   'rgba(255,255,255,0.35)');
      topBlur.addColorStop(0.6, 'rgba(255,255,255,0.05)');
      topBlur.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = topBlur;
      ctx.fillRect(bx, by, bw, bh*0.55);

      // Левый отблеск
      const leftBlur = ctx.createLinearGradient(bx, by, bx+bw*0.35, by);
      leftBlur.addColorStop(0, 'rgba(255,255,255,0.22)');
      leftBlur.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = leftBlur;
      ctx.fillRect(bx, by, bw*0.35, bh);
      ctx.restore();

      // Основная рамка
      roundRect(bx, by, bw, bh, gr);
      ctx.strokeStyle = `rgba(255,255,255,${0.55*breathe})`;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Тонкая внутренняя рамка (глубина)
      roundRect(bx+2, by+2, bw-4, bh-4, gr-1);
      ctx.strokeStyle = `rgba(255,255,255,${0.18*breathe})`;
      ctx.lineWidth   = 0.75;
      ctx.stroke();

      // Линия-блик сверху
      ctx.strokeStyle = `rgba(255,255,255,${0.9*breathe})`;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx+gr+4, by+1); ctx.lineTo(bx+bw-gr-4, by+1);
      ctx.stroke();

      // Нижняя тень (имитация толщины стекла)
      roundRect(bx, by+bh*0.72, bw, bh*0.28, gr);
      const botSh = ctx.createLinearGradient(bx,by+bh*0.72,bx,by+bh);
      botSh.addColorStop(0,'rgba(0,0,0,0)');
      botSh.addColorStop(1,'rgba(0,20,40,0.35)');
      ctx.fillStyle = botSh;
      ctx.fill();

    /* ── BOXSHADOW: Chrome / Металл ─────────────────
       Хромированная рамка с 3D гранями и отражениями  */
    } else if (span.boxshadow) {
      const sc    = span.color || '#ffffff';
      const depth = Math.max(10, h * 0.25);

      // Дальняя тень
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillRect(bx+depth+4, by+depth+4, bw, bh);

      // Правая грань — хром
      const rFace = ctx.createLinearGradient(bx+bw, by, bx+bw+depth, by+depth);
      rFace.addColorStop(0,   'rgba(80,80,80,0.9)');
      rFace.addColorStop(0.4, 'rgba(160,160,160,0.7)');
      rFace.addColorStop(1,   'rgba(20,20,20,0.95)');
      ctx.fillStyle = rFace;
      ctx.beginPath();
      ctx.moveTo(bx+bw,bx+bh-bx-bh+by);  // reset
      ctx.moveTo(bx+bw,       by);
      ctx.lineTo(bx+bw+depth, by+depth);
      ctx.lineTo(bx+bw+depth, by+bh+depth);
      ctx.lineTo(bx+bw,       by+bh);
      ctx.closePath();
      ctx.fill();

      // Нижняя грань — хром
      const bFace = ctx.createLinearGradient(bx, by+bh, bx+depth, by+bh+depth);
      bFace.addColorStop(0,   'rgba(40,40,40,0.95)');
      bFace.addColorStop(0.5, 'rgba(100,100,100,0.7)');
      bFace.addColorStop(1,   'rgba(15,15,15,0.98)');
      ctx.fillStyle = bFace;
      ctx.beginPath();
      ctx.moveTo(bx,          by+bh);
      ctx.lineTo(bx+depth,    by+bh+depth);
      ctx.lineTo(bx+bw+depth, by+bh+depth);
      ctx.lineTo(bx+bw,       by+bh);
      ctx.closePath();
      ctx.fill();

      // Рёбра стыка
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(bx+bw,by); ctx.lineTo(bx+bw+depth,by+depth);
      ctx.moveTo(bx,by+bh); ctx.lineTo(bx+depth,by+bh+depth);
      ctx.stroke();

      // Лицевая грань — металлический градиент
      const face = ctx.createLinearGradient(bx, by, bx+bw*0.7, by+bh);
      face.addColorStop(0,   'rgba(80,80,80,0.65)');
      face.addColorStop(0.3, 'rgba(50,50,50,0.55)');
      face.addColorStop(0.7, 'rgba(25,25,25,0.70)');
      face.addColorStop(1,   'rgba(10,10,10,0.80)');
      ctx.fillStyle = face;
      ctx.fillRect(bx, by, bw, bh);

      // Хромированная рамка лица
      const stroke = ctx.createLinearGradient(bx, by, bx+bw, by+bh);
      stroke.addColorStop(0,   'rgba(255,255,255,0.9)');
      stroke.addColorStop(0.25,'rgba(180,180,180,0.7)');
      stroke.addColorStop(0.5, sc);
      stroke.addColorStop(0.75,'rgba(100,100,100,0.6)');
      stroke.addColorStop(1,   'rgba(40,40,40,0.8)');
      ctx.strokeStyle = stroke;
      ctx.lineWidth   = 2.5;
      ctx.strokeRect(bx, by, bw, bh);

      // Блик сверху
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(bx+2,by+1.5); ctx.lineTo(bx+bw-2,by+1.5);
      ctx.stroke();

      // Тонкая внутренняя линия
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth   = 0.75;
      ctx.strokeRect(bx+3, by+3, bw-6, bh-6);

    /* ── BOXTAPE: Кинолента / Film Strip ────────────
       Настоящая перфорированная кинолента с зерном    */
    } else if (span.boxtape) {
      const tc    = span.color || '#e8ff00';
      const strip = Math.max(8, bh * 0.28);
      const filmY = by - strip;
      const filmH = bh + strip*2;

      // Тёмный фон ленты
      const filmBg = ctx.createLinearGradient(bx-6, filmY, bx-6, filmY+filmH);
      filmBg.addColorStop(0,   'rgba(10,8,5,0.95)');
      filmBg.addColorStop(0.08,'rgba(22,18,10,0.9)');
      filmBg.addColorStop(0.92,'rgba(22,18,10,0.9)');
      filmBg.addColorStop(1,   'rgba(10,8,5,0.95)');
      ctx.fillStyle = filmBg;
      ctx.fillRect(bx-6, filmY, bw+12, filmH);

      // Полосы перфорации
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(bx-6, filmY,              bw+12, strip);
      ctx.fillRect(bx-6, filmY+filmH-strip,  bw+12, strip);

      // Перфорационные отверстия (скруглённые)
      ctx.save();
      const hW = Math.max(5, strip*0.5);
      const hH = Math.max(4, strip*0.38);
      const hGap = hW * 2.8;
      const hR = 1.5;
      ctx.fillStyle = tc;
      ctx.globalAlpha = 0.7;
      for (let hx = bx+2; hx < bx+bw-hW; hx += hGap) {
        [filmY+(strip-hH)/2, filmY+filmH-strip+(strip-hH)/2].forEach(hy => {
          ctx.beginPath();
          ctx.roundRect(hx, hy, hW, hH, hR);
          ctx.fill();
        });
      }
      ctx.restore();

      // Разделительные линии
      ctx.save();
      ctx.strokeStyle = tc;
      ctx.lineWidth   = 1.5;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(bx-6, filmY+strip); ctx.lineTo(bx+bw+6, filmY+strip);
      ctx.moveTo(bx-6, filmY+filmH-strip); ctx.lineTo(bx+bw+6, filmY+filmH-strip);
      ctx.stroke();
      ctx.restore();

      // Лёгкое свечение рамки
      ctx.shadowColor = tc;
      ctx.shadowBlur  = 8;
      ctx.strokeStyle = tc;
      ctx.lineWidth   = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur  = 0;

      // Кадровые засечки по бокам
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.lineWidth    = 1;
      for (let vy = by + bh*0.2; vy < by+bh*0.9; vy += bh*0.25) {
        ctx.beginPath();
        ctx.moveTo(bx-6, vy); ctx.lineTo(bx, vy);
        ctx.moveTo(bx+bw, vy); ctx.lineTo(bx+bw+6, vy);
        ctx.stroke();
      }
      ctx.restore();

      // Зерно плёнки (шум)
      ctx.save();
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = '#fff';
      for (let i=0; i<60; i++) {
        const nx = bx + Math.abs(Math.sin(i*7.3+t)*bw);
        const ny = by + Math.abs(Math.cos(i*13.7+t)*bh);
        ctx.fillRect(nx, ny, 1.5, 1.5);
      }
      ctx.restore();

    /* ── BOXROUGH: Маркер-хайлайт ───────────────────
       Двойной неровный маркер как нарисованный от руки */
    } else if (span.boxrough) {
      const rc     = span.color || '#ff9f00';
      const jitter = makeJitter(strSeed(span.word || 'x'));

      // Широкий маркер-слой (заливка)
      ctx.save();
      ctx.fillStyle   = rc;
      ctx.globalAlpha = 0.13;
      ctx.beginPath();
      ctx.moveTo(bx+jitter()*3,       by+jitter()*2+bh*0.15);
      ctx.lineTo(bx+bw+jitter()*3,    by+jitter()*2);
      ctx.lineTo(bx+bw+jitter()*2,    by+bh+jitter()*2-bh*0.1);
      ctx.lineTo(bx+jitter()*3,       by+bh+jitter()*2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Второй слой маркера (чуть смещён)
      ctx.save();
      ctx.fillStyle   = rc;
      ctx.globalAlpha = 0.07;
      ctx.beginPath();
      ctx.moveTo(bx-2+jitter()*2,     by-1+jitter()*2+bh*0.05);
      ctx.lineTo(bx+bw+3+jitter()*2,  by+2+jitter()*2);
      ctx.lineTo(bx+bw+1+jitter()*2,  by+bh+2+jitter()*2);
      ctx.lineTo(bx-1+jitter()*2,     by+bh-1+jitter()*2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Контурный штрих (средний)
      ctx.save();
      ctx.strokeStyle = rc;
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(bx+1+jitter(),       by+jitter()*1.5);
      ctx.lineTo(bx+bw-1+jitter(),    by+1+jitter()*1.5);
      ctx.lineTo(bx+bw+jitter(),      by+bh+jitter()*1.5);
      ctx.lineTo(bx+1+jitter(),       by+bh-1+jitter()*1.5);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // Тонкий финальный контур
      ctx.save();
      ctx.lineWidth   = 1.25;
      ctx.globalAlpha = 0.85;
      ctx.shadowColor = rc;
      ctx.shadowBlur  = 3;
      ctx.beginPath();
      ctx.moveTo(bx+jitter()*1.5,     by+jitter()*1.5);
      ctx.lineTo(bx+bw+jitter()*1.5,  by+jitter()*1.5);
      ctx.lineTo(bx+bw+jitter()*1.5,  by+bh+jitter()*1.5);
      ctx.lineTo(bx+jitter()*1.5,     by+bh+jitter()*1.5);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // Угловые акцентные засечки (торчат наружу)
      ctx.lineWidth   = 4;
      ctx.lineCap     = 'round';
      ctx.shadowBlur  = 6;
      const cs2 = Math.min(bw,bh)*0.25;
      [[bx,by,1,1],[bx+bw,by,-1,1],[bx,by+bh,1,-1],[bx+bw,by+bh,-1,-1]]
        .forEach(([cx,cy,sx,sy]) => {
          ctx.beginPath();
          ctx.moveTo(cx+sx*cs2+jitter(), cy+jitter());
          ctx.lineTo(cx+jitter(),        cy+jitter());
          ctx.lineTo(cx+jitter(),        cy+sy*cs2+jitter());
          ctx.stroke();
        });
    }

    ctx.restore();
  }

  /* ── Draw a single span ── */
  function drawSpan(ctx, span, x, y, baseFontSize, font, t, anim) {
    if (!span.word || span.word.trim()==='') return;
    ctx.save();

    const size = span.big ? baseFontSize*1.45 : span.small ? baseFontSize*0.65 : baseFontSize;
    let fontStyle = '';
    if (span.bold)   fontStyle += 'bold ';
    if (span.italic) fontStyle += 'italic ';
    ctx.font = `${fontStyle}${size}px ${font}${EMOJI_FB}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur   = 0;
    ctx.shadowColor  = 'transparent';
    // filter НЕ сбрасываем в 'none': вызывающий мог выставить размытие для
    // всего элемента (расплывание подложки на басу). Раньше сброс стирал
    // его молча, и эффект просто не доезжал до холста.
    const baseFilter = (ctx.filter && ctx.filter !== 'none') ? ctx.filter : '';
    ctx.filter       = baseFilter || 'none';

    let dx=0, dy=0;
    if (span.wave) dy += Math.sin(t*4 + x*0.02)*4;
    if (span.blur) ctx.filter = baseFilter ? `${baseFilter} blur(3px)` : 'blur(3px)';

    /* Кому дуотон НЕ положен.
       — Подложка (_ghost): это декорация кадра, а не текст. Градиент с
         фактурой делает её вторым набором, она начинает спорить с передним
         и кадр читается как две строки друг на друге. Ей нужна ровная
         полупрозрачная заливка, а жизнь — от расплывания на басу.
       — Мелкий кегль: перепад светлоты на высоте 20-30px съедает половину
         штриха, и подпись становится нечитаемой. Порог 38px — ниже него
         градиент физически некуда положить. */
    const plainFill = !!span._ghost || size < 38;

    const finalX = x+dx, finalY = y+dy;
    const metrics = ctx.measureText(span.word);
    const tw = span._w || metrics.width;
    // Используем actualBoundingBox для точной высоты, с fallback на size
    const actualHeight = (metrics.actualBoundingBoxAscent || 0) + (metrics.actualBoundingBoxDescent || 0);
    const th = actualHeight > 0 ? actualHeight : size * 0.75;
    
    // Компактный padding с учетом padMultiplier для специальных боксов
    let padMultiplier = 1;
    if (typeof BoxRegistry !== 'undefined') {
      const boxStyle = BoxRegistry.getActiveStyle(span);
      if (boxStyle && boxStyle.padMultiplier) {
        padMultiplier = boxStyle.padMultiplier;
      }
    }
    const boxPadX = size * 0.2 * padMultiplier;
    const boxPadY = size * 0.15 * padMultiplier;

    // Draw box decoration BEHIND text (БЕЗ flicker-эффекта)
    const hasBox = typeof BoxRegistry !== 'undefined' ? BoxRegistry.hasBox(span) : (span.box||span.boxneon||span.boxglass||span.boxshadow||span.boxtape||span.boxrough);
    if (hasBox) {
      if (typeof BoxRegistry !== 'undefined') BoxRegistry.draw(ctx, span, finalX-tw/2-boxPadX, finalY-th/2-boxPadY, tw+boxPadX*2, th+boxPadY*2, span.color||'#ffffff', t);
      else drawBox(ctx, span, finalX, finalY, tw+boxPadX*2, th+boxPadY*2, t);
    }

    // Применяем flicker ТОЛЬКО к тексту, после отрисовки box
    const flickAlpha = span.flicker ? (0.7+Math.sin(t*8)*0.3) : 1;
    const prevAlpha  = ctx.globalAlpha;
    ctx.globalAlpha *= flickAlpha;

    if (span.rainbow) {
      const grd = ctx.createLinearGradient(finalX-tw/2,finalY,finalX+tw/2,finalY);
      const hOff = (t*60)%360;
      grd.addColorStop(0,   `hsl(${hOff},100%,60%)`);
      grd.addColorStop(0.33,`hsl(${hOff+120},100%,60%)`);
      grd.addColorStop(0.66,`hsl(${hOff+240},100%,60%)`);
      grd.addColorStop(1,   `hsl(${hOff+360},100%,60%)`);
      ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=Math.max(2,size*0.06);
      ctx.strokeText(span.word,finalX,finalY);
      ctx.fillStyle=grd; ctx.fillText(span.word,finalX,finalY);

    } else if (span.grad && !plainFill) {
      // Дуотон + бегущий блик. Отделение от фона — цветной ореол под буквой,
      // а не обводка: обводка на кегле 70+ утолщает штрих и превращает набор
      // в мультяшный стикер.
      drawContactShadow(ctx, span.word, finalX, finalY, size, span.color, 0.40);
      ctx.fillStyle=duotoneGradient(ctx,finalX,finalY,tw,size,span.color);
      ctx.fillText(span.word,finalX,finalY);
      drawGrain(ctx,span.word,finalX,finalY,tw,size,1.0);
      ctx.fillStyle=sheenGradient(ctx,finalX,finalY,tw,size,t,0.85);
      ctx.fillText(span.word,finalX,finalY);

    } else if (span.glitch) {
      const gShift=Math.sin(t*97)*size*0.08;
      ctx.globalAlpha*=0.85;
      ctx.fillStyle='#ff3333'; ctx.fillText(span.word,finalX-gShift,finalY+gShift*0.3);
      ctx.fillStyle='#3333ff'; ctx.fillText(span.word,finalX+gShift,finalY-gShift*0.3);
      ctx.globalAlpha=prevAlpha*flickAlpha;
      ctx.fillStyle=span.color; ctx.fillText(span.word,finalX,finalY);

    } else if (span.outline) {
      // Раньше здесь были два strokeText подряд и ни одного fillText — буквы
      // выходили полыми, сквозь них просвечивал фон, и на любой пёстрой
      // картинке строка разваливалась. Теперь это контур в прямом смысле:
      // тёмная обводка отделяет букву от фона, а заливка остаётся.
      ctx.lineJoin='round'; ctx.miterLimit=2;
      ctx.strokeStyle='rgba(0,0,0,0.85)'; ctx.lineWidth=Math.max(3,size*0.09);
      ctx.strokeText(span.word,finalX,finalY);
      ctx.fillStyle=span.color; ctx.fillText(span.word,finalX,finalY);

    } else if (span.glow||span.neon) {
      const glowColor = span.neon ? '#b14fff' : span.color;
      // shadowBlur — гауссово размытие на КАЖДУЮ отрисовку, и его цена растёт
      // квадратично от радиуса. Поэтому: ореол рисуем один раз (на обводке),
      // заливку — уже без тени, а радиус ограничиваем сверху. Вид тот же,
      // но проходов вдвое меньше и радиус не разрастается на крупном кегле.
      const glowR = Math.min(span.neon ? 26 : 18, size * (span.neon ? 0.35 : 0.22));
      ctx.shadowColor=glowColor; ctx.shadowBlur=glowR;
      ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=Math.max(2,size*0.05);
      ctx.strokeText(span.word,finalX,finalY);
      ctx.shadowBlur=0; ctx.shadowColor='transparent';
      ctx.fillStyle=glowColor; ctx.fillText(span.word,finalX,finalY);

    } else {
      // Базовый набор. Обводки здесь больше нет: чёрный контур в size*0.06
      // раздувал штрих и убивал рисунок шрифта — на кегле 70+ это читалось
      // как наклейка. Букву от фона отделяет мягкий ореол, форму держит
      // диагональный градиент, верхний край ловит короткий блик.
      if (plainFill) {
        // Ровная заливка. Подложке ореол не нужен вовсе — он её проявляет;
        // мелкому кеглю нужен, иначе подпись тонет в кадре.
        if (!span._ghost) {
          ctx.save();
          ctx.shadowColor='rgba(0,0,0,0.7)'; ctx.shadowBlur=Math.max(3,size*0.22);
          ctx.shadowOffsetY=size*0.05;
          ctx.fillStyle='rgba(0,0,0,0.85)';
          ctx.globalAlpha*=0.6;
          ctx.fillText(span.word,finalX,finalY);
          ctx.restore();
        }
        ctx.fillStyle=span.color;
        ctx.fillText(span.word,finalX,finalY);
      } else {
        drawContactShadow(ctx, span.word, finalX, finalY, size, span.color, 0.26);
        ctx.fillStyle=fillGradient(ctx,finalX,finalY,tw,size,span.color);
        ctx.fillText(span.word,finalX,finalY);
        drawGrain(ctx,span.word,finalX,finalY,tw,size,0.75);
        ctx.fillStyle=sheenGradient(ctx,finalX,finalY,tw,size,t,0.45);
        ctx.fillText(span.word,finalX,finalY);
      }
    }

    if (span.underline) {
      ctx.strokeStyle=span.color; ctx.lineWidth=Math.max(1,size*0.04);
      ctx.beginPath();
      ctx.moveTo(finalX-tw/2,finalY+size*0.12);
      ctx.lineTo(finalX+tw/2,finalY+size*0.12);
      ctx.stroke();
    }
    if (span.strike) {
      ctx.strokeStyle=span.color; ctx.lineWidth=Math.max(1,size*0.04);
      ctx.save(); ctx.globalAlpha*=0.6;
      ctx.beginPath();
      ctx.moveTo(finalX-tw/2,finalY-size*0.05);
      ctx.lineTo(finalX+tw/2,finalY-size*0.05);
      ctx.stroke(); ctx.restore();
    }

    ctx.restore();
  }

  /* ══════════════════════════════════════════════
     WORD LAYOUT — рендерим слова по кастомным позициям
     anim.words = [{ word, x, y, scale, alpha, rotation, fontScale? }]
     x,y — смещение от центра холста (cx, cy)
  ══════════════════════════════════════════════ */
  function drawWordLayout(ctx, lyric, cx, cy, anim, fadeAlpha, color, font, fontSize, canvasWidth, t, globalBoxId, bounds, shapeAt, pass = null) {
    const totalAlpha = (anim.alpha ?? 1) * fadeAlpha;
    if (totalAlpha <= 0.001) return;

    /* ── Фоновый слой живёт ВНЕ рамок и ВНЕ страховок ──────────────────
       Подложка, стена повторов, встречная тень — это декорация кадра, а не
       текст. Она посчитана режимом от размера КАДРА и обязана выходить за
       любые границы: в том и приём, что она кроет фон целиком и уходит на
       обрез.

       Ниже идут три поправки на кадр — сжатие позиций, сжатие кегля и
       сдвиг центра блока внутрь зоны. Позиции фона из них уже были
       исключены, а вот КЕГЛЬ и ЦЕНТР — нет: fontSize после вписывания
       общий, cx/cy тоже, и фон ехал вместе с набором. Каждый раз, когда
       страховка срабатывала (заезд слова, зум камеры, дыхание на басу),
       стена меняла размер и сдвигалась — это и читалось как «фон
       подстраивается».

       Поэтому запоминаем исходные кегль и точку строки ДО всех поправок и
       рисуем фон по ним. Фон не участвует в кадровых расчётах вообще ни
       одним числом. */
    const ghostFontSize = fontSize;
    const ghostCx = cx, ghostCy = cy;

    // ── Вписываем word-layout в безопасную зону кадра ───────────────────
    // Считаем bbox финальных позиций слов; если он шире/выше зоны —
    // сжимаем раскладку (позиции + кегль) и сдвигаем центр внутрь кадра.
    /* Маска нужна и здесь. Режим ставит слова по силуэту, но на басу они
       разгоняются масштабом — и раскладка, честная в покое, наезжает на
       фигуру на пике. Зона считается по фактической высоте разлёта слов. */
    const wlAreaFull = clipToVisible(resolveArea(bounds, canvasWidth), ctx);
    let wlArea = wlAreaFull;
    if (anim.words.length) {
      const bb0 = wlBBox(anim.words, fontSize);
      if (bb0.minX < Infinity) {
        wlArea = maskedArea(wlAreaFull, shapeAt, cy, (bb0.maxY - bb0.minY) || fontSize * 1.6);
      }
    }

    /* bbox раскладки при заданном кегле. Считается по фактическим позициям
       и ширинам слов, поэтому пересчитывать его надо после КАЖДОГО сжатия:
       позиции и ширины ужимаются разными коэффициентами. */
    function wlBBox(words, fs, settledOnly = true) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const wData of words) {
        if (!wData.word || !wData.word.trim()) continue;
        /* Слова на заезде в габарит не входят — по той же причине, по
           которой они исключены из страховки ниже. Кинетика приводит их
           из-за края полосы; пока они летят, bbox огромный, вписывание
           ужимает кегль и ДВИГАЕТ ЦЕНТР БЛОКА, а через полсекунды всё
           возвращается. Отсюда и «текст встаёт заново» на каждой строке:
           это не смена строки, это вписывание, отработавшее по словам,
           которых ещё нет на месте. Фоновый слой центр двигает вместе с
           набором, поэтому заметнее всего было именно на нём. */
        if (settledOnly && (wData.alpha ?? 1) < 0.55) continue;
        /* Фоновый слой (ghost) в замер НЕ входит — и это не мелочь.
           Стена повторов и подложка выходят за кадр НАМЕРЕННО: они кроют
           фон целиком. Если мерить габарит вместе с ними, страховка видит
           «раскладка вылезла» и ужимает ВСЮ строку вместе с фоном, а потом
           ещё и подвигает центр внутрь зоны. Результат: стена схлопывается
           в полосу посреди кадра, верх и низ остаются голыми, и вдобавок
           уезжает кегль настоящего текста. Страховка существует ради
           читаемого набора — по нему и меряем. */
        if (wData.ghost) continue;
        const wFs = fs * (wData.scale ?? 1);
        if (wFs < 2) continue;
        ctx.font = `${wFs}px ${font}${EMOJI_FB}`;
        const hw = ctx.measureText(wData.word).width / 2;
        const hh = wFs * 0.6;
        minX = Math.min(minX, (wData.x ?? 0) - hw); maxX = Math.max(maxX, (wData.x ?? 0) + hw);
        minY = Math.min(minY, (wData.y ?? 0) - hh); maxY = Math.max(maxY, (wData.y ?? 0) + hh);
      }
      return { minX, maxX, minY, maxY };
    }

    if (isFinite(wlArea.h) && anim.words.length) {
      // Пока не приземлилось ни одно слово, мерить нечего — в этот момент
      // вписывать и нечего: набора на экране ещё нет.
      let bb = wlBBox(anim.words, fontSize);
      if (bb.minX < Infinity) {
        const padW = wlArea.w * 0.04, padH = wlArea.h * 0.04;
        const availW = Math.max(1, wlArea.w - padW*2);
        const availH = Math.max(1, wlArea.h - padH*2);

        /* Сжатие раздельное, и это принципиально. Общий коэффициент с полом
           0.45 не давал раскладке ужаться сильнее — при большом разлёте слова
           уезжали за холст и строка не рисовалась ВООБЩЕ. Пропавший текст
           хуже вылезшего, поэтому:
             позиции  — жмём насколько нужно, без пола: разлёт это фантазия
                        режима, её не жалко;
             кегль    — с полом 0.45, иначе слова станут нечитаемой пылью. */
        let kFit = Math.min(1, availW / ((bb.maxX - bb.minX) || 1),
                               availH / ((bb.maxY - bb.minY) || 1));
        /* Латч вписывания. availW/availH считаются от ВИДИМОЙ области, а при
           зуме камеры она меняется каждый кадр — без латча коэффициент едет
           вместе с зумом и набор непрерывно пересобирается.

           Латч ОДНОСТОРОННИЙ: в пределах строки коэффициент только падает и
           никогда не возвращается. Сглаживание с медленным отпусканием,
           которое стояло здесь до этого, было хуже болезни: одного кадра с
           большим охватом хватало, чтобы схлопнуть набор, а потом он
           МЕДЛЕННО отрастал обратно — то самое «подстраивается», только
           растянутое на секунду. Одностороннее ужатие срабатывает один раз
           и больше себя не показывает; цена — строка может остаться чуть
           мельче, чем нужно, и это несравнимо дешевле пересборки на глазах.

           Состояние привязано к строке и на новой сбрасывается в 1. */
        const kKey = (typeof lyric === 'string' ? lyric : (lyric && lyric.text) || '') +
                     '|' + Math.round(fontSize);
        if (kKey !== _kFitKey) { _kFitKey = kKey; _kFitSoft = 1; }
        _kFitSoft = Math.min(_kFitSoft, kFit);
        kFit = _kFitSoft;
        if (kFit < 1) {
          fontSize *= Math.max(0.45, kFit);
          // Позиции фона не жмём: они посчитаны от кадра, а не от разлёта
          // слов, и сжатие оставило бы по краям голую полосу.
          anim = { ...anim, words: anim.words.map(w => w.ghost ? w : ({
            ...w, x: (w.x ?? 0) * kFit, y: (w.y ?? 0) * kFit,
          })) };
          bb = wlBBox(anim.words, fontSize);

          /* Кегль ужался слабее позиций — слова могли снова распереть bbox.
             Дожимаем одними позициями, пока не влезет. */
          for (let i = 0; i < 4; i++) {
            const kx = availW / ((bb.maxX - bb.minX) || 1);
            const ky = availH / ((bb.maxY - bb.minY) || 1);
            const k2 = Math.min(1, kx, ky);
            if (k2 >= 0.999) break;
            anim = { ...anim, words: anim.words.map(w => w.ghost ? w : ({
              ...w, x: (w.x ?? 0) * k2, y: (w.y ?? 0) * k2,
            })) };
            bb = wlBBox(anim.words, fontSize);
          }
        }

        // Сдвигаем центр так, чтобы bbox целиком лежал внутри зоны
        const L = wlArea.x + padW, R = wlArea.x + wlArea.w - padW;
        const T = wlArea.y + padH, B = wlArea.y + wlArea.h - padH;
        if (cx + bb.minX < L) cx = L - bb.minX;
        if (cx + bb.maxX > R) cx = R - bb.maxX;
        if (cy + bb.minY < T) cy = T - bb.minY;
        if (cy + bb.maxY > B) cy = B - bb.maxY;
      }
    }

    // ── FX-стили по словам ──────────────────────────────────────────────
    // parseSpans группирует слова по стилю; разворачиваем их в пословный
    // массив, сохраняя FX-состояние каждого токена.
    //
    // ЗДЕСЬ НЕЛЬЗЯ ПРАВИТЬ РАСКЛАДКУ. Был проход, который разводил
    // наложения прямо перед отрисовкой, и он давал ровно ту дёрганность,
    // ради которой затевался: ширина слова зависит от его текущего
    // анимированного масштаба, масштаб дышит на басу — значит каждый кадр
    // получались новые зазоры, соседи разъезжались, а ряд перецентровывался
    // целиком. Позиции обязан задавать режим, один раз и по своим правилам;
    // рендерер только рисует. Наложения лечатся в источнике — см. отказ от
    // {BIG} на кинетических строках в AutoDirector.
    const rawText  = typeof lyric === 'string' ? lyric : (lyric.rawText || lyric.text || '');
    const wordSpans = [];
    if (!anim.perLetter) {
      const spans = parseSpans(rawText, color, t);
      for (const sp of spans) {
        const ws = sp.word.split(/\s+/).filter(Boolean);
        for (const w of ws) wordSpans.push({ ...sp, word: w });
      }
    }

    // ── Global box для word-layout ──────────────────────────────────────
    // Вычисляем bbox по всем словам с учётом их индивидуальных позиций и scale.
    // Уважаем per-line opt-out: {LNOBOX} ⇒ lyric.lineStyle.noBox=true ⇒ пропустить.
    const _noBox = !!(lyric && typeof lyric === 'object' && lyric.lineStyle && lyric.lineStyle.noBox);
    if (globalBoxId && !_noBox && typeof BoxRegistry !== 'undefined') {
      const rawText2 = typeof lyric === 'string' ? lyric : (lyric.rawText || lyric.text || '');
      const spansCheck = parseSpans(rawText2, color, t);
      const hasAnySpanBox = spansCheck.some(sp => BoxRegistry.hasBox(sp));
      const gStyle = !hasAnySpanBox ? BoxRegistry.get(globalBoxId) : null;
      if (gStyle) {
        // Рамка вычисляется ТОЛЬКО по словам которые уже приземлились (alpha >= 0.85).
        // Слова в полёте (scatter, cascade, flash) ещё находятся вне своих финальных
        // позиций — включать их значит рамка будет постоянно «прыгать» и выходить за края.
        const SETTLED_THRESHOLD = 0.85;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let settledCount = 0;

        for (const wData of anim.words) {
          const wAlpha = wData.alpha ?? 1;
          // Служебные элементы (подложка, поле-повтор) в рамку не входят:
          // они заведомо больше набора и растянули бы её на весь кадр.
          if (wData.ghost) continue;
          if (wAlpha < SETTLED_THRESHOLD || !wData.word || !wData.word.trim()) continue;
          const wScale    = wData.scale ?? 1;
          const wFontSize = fontSize * wScale;
          if (wFontSize < 2) continue;
          ctx.font = `${wFontSize}px ${font}${EMOJI_FB}`;
          const tw = ctx.measureText(wData.word).width;
          const th = wFontSize * 0.75;
          const wx = cx + wData.x;
          const wy = cy + wData.y;
          minX = Math.min(minX, wx - tw/2);
          maxX = Math.max(maxX, wx + tw/2);
          minY = Math.min(minY, wy - th/2);
          maxY = Math.max(maxY, wy + th/2);
          settledCount++;
        }

        if (settledCount > 0) {
          // Рамка плавно появляется: когда ≥50% слов осело — начинает fade in
          const settleRatio = settledCount / Math.max(anim.words.length, 1);
          const frameAlpha  = totalAlpha * Math.min(settleRatio * 2, 1);
          if (frameAlpha > 0.01) {
            const gPadX = fontSize * 0.35;
            const gPadY = fontSize * 0.25;
            ctx.save();
            ctx.globalAlpha = frameAlpha;
            gStyle.draw(ctx, minX - gPadX, minY - gPadY, (maxX - minX) + gPadX*2, (maxY - minY) + gPadY*2, color, t);
            ctx.restore();
          }
        }
      }
    }

    // wordSpans разобран выше — до раскладки, т.к. кегль слова влияет
    // на то, сколько места оно занимает.
    //
    // anim.perLetter = true (режим shatter) — anim.words содержит БУКВЫ,
    // а не слова. Маппинг wordSpans[wi] сломался бы (первые N букв получили
    // бы стили первого слова). В этом случае FX-теги не парсятся вовсе —
    // буквы рисуются с базовым цветом строки, без per-word FX.

    /* ══ СТРАХОВКА КАДРА ══════════════════════════════════════════════
       Последний рубеж: здесь и только здесь известна НАСТОЯЩАЯ ширина
       отрисовки — тем же ctx, тем же шрифтом и тем же кеглем, которыми
       слово будет нарисовано через несколько строк.

       Режимы считают раскладку по своей мере ширины и держатся полосы,
       которую им передали. Любое расхождение между этой мерой и реальной
       отрисовкой (начертание, обводка, фолбэк шрифта, чужая полоса) даёт
       текст, вылезший за кадр, — и найти виновника по кадру невозможно,
       потому что врать может любое звено цепочки.

       Поэтому вместо поиска виновника — замер по факту: если набор не
       помещается в кадр, он ужимается целиком относительно точки строки.
       Пропорции и композиция сохраняются, теряется только размер, и то
       ровно настолько, насколько не влезло.

       Служебные элементы (ghost) в замер не входят: подложка выходит за
       кадр НАМЕРЕННО, и подгонять кадр под неё значит убить приём. */
    let _fit = 1;
    {
      /* reach — насколько далеко набор уходит от точки строки; room —
         сколько места есть до ближайшего края кадра. Обе меры берутся от
         ОДНОЙ точки, поэтому одного коэффициента хватает на обе стороны.

         Мерить надо ТЕМ ЖЕ кеглем, которым будет рисоваться слово, включая
         множители {BIG}/{SMALL}: иначе слово с {BIG} рисуется на 45% шире
         замеренного и спокойно уходит за край мимо страховки.

         POLE — обязательное поле кадра. Без него страховка лишь не давала
         ВЫЙТИ за край, и буква вставала вплотную к границе — а вплотную к
         границе выглядит точно так же сломанно, как и за ней. */
      const POLE = canvasWidth * 0.035;
      let si = 0, reach = 0;
      for (const wD of anim.words) {
        if (!wD.word || !wD.word.trim()) continue;
        const sp = wD.ghost ? null : (wordSpans[si++] || null);
        if (wD.ghost) continue;
        /* Слово на заезде в замер не идёт. Кинетика приводит слова
           ИЗДАЛЕКА — из-за края полосы, а то и из-за кадра. Пока такое слово
           летит, оно задирает reach, страховка ужимает ВЕСЬ набор, а когда
           слово приезжает — отпускает обратно. Именно это и читается как
           «размер сам перестраивается»: страховка каждый кадр пересчитывала
           композицию по слову, которого ещё нет на месте.
           Порог по прозрачности: летящее слово всегда проявляется по ходу
           заезда, поэтому непрозрачное слово — это уже приехавшее слово. */
        if ((wD.alpha ?? 1) < 0.55) continue;
        const base = fontSize * (wD.scale ?? 1);
        if (base < 2) continue;
        const st  = sp ? ((sp.bold ? 'bold ' : '') + (sp.italic ? 'italic ' : '')) : '';
        const fsz = sp && sp.big ? base * 1.45 : sp && sp.small ? base * 0.65 : base;
        ctx.font = `${st}${fsz}px ${font}${EMOJI_FB}`;
        reach = Math.max(reach, Math.abs(wD.x ?? 0) + ctx.measureText(wD.word).width / 2);
      }
      /* Место — от ЗОНЫ (с маской), а не от холста. От холста страховка
         держала слова внутри кадра и честно позволяла им лечь на фигуру:
         на басу масштаб слов растёт, разлёт вместе с ним, и раскладка,
         честная в покое, наезжает на спрайт на пике. */
      const pole = Math.min(POLE, wlArea.w * 0.05);
      const room = Math.max(8, Math.min(cx - (wlArea.x + pole),
                                        (wlArea.x + wlArea.w - pole) - cx));
      if (reach > room) _fit = room / reach;

      /* Латч страховки — односторонний, как и у вписывания выше.
         Даже после отсева летящих слов охват живёт: набор дышит на басу,
         разъезжается, меняет масштаб. Пересчитанный в лоб коэффициент
         передаёт это дыхание всему блоку — строка пульсирует размером.

         В пределах строки коэффициент только падает. Обратно он не растёт
         НИКОГДА: именно возврат и читается как «текст сам перестраивается»,
         причём читается тем заметнее, чем плавнее сделан. Ужатие же
         одноразовое — глаз ловит его как часть появления строки.

         Состояние привязано к строке: на новой строке набор другой, и
         тащить в него ужатие предыдущей нельзя. */
      const fitKey = (typeof lyric === 'string' ? lyric : (lyric && lyric.text) || '') +
                     '|' + Math.round(fontSize);
      if (fitKey !== _fitKey) { _fitKey = fitKey; _fitSoft = 1; }
      _fitSoft = Math.min(_fitSoft, _fit);
      _fit = _fitSoft;
      // Диагностика: последние ФАКТИЧЕСКИЕ числа отрисовки — их читает
      // window.RicoleDebug(). Без них спор о том, что происходит в кадре,
      // ведётся по скриншотам, а по скриншоту пиксель не измеришь.
      _diag = { путь: 'пословный', cx: Math.round(cx), кадр: canvasWidth,
                зона: Math.round(wlArea.x) + '..' + Math.round(wlArea.x + wlArea.w),
                поле: Math.round(pole), охват: Math.round(reach),
                место: Math.round(room), ужатие: +_fit.toFixed(3) };
    }

    ctx.save();
    ctx.globalAlpha = totalAlpha;

    /* Индекс span'а считается по НАСТОЯЩИМ словам, а не по элементам
       раскладки. Режим вправе положить в anim.words служебные элементы —
       подложку, поле-повтор, — и они не должны сдвигать разметку: иначе
       {GLOW} с третьего слова уезжает на дубль, а само слово остаётся без
       стиля. Такой элемент помечается ghost:true, рисуется базовым стилем
       строки и в счётчике не участвует.

       Именно это позволяет ставить подложку ПЕРЕД текстом в массиве, то
       есть рисовать её ПОД ним: раньше служебные элементы приходилось
       дописывать в хвост и они ложились поверх набора. */
    let spanIdx = 0;

    for (let wi = 0; wi < anim.words.length; wi++) {
      const wData = anim.words[wi];
      if (!wData.word || !wData.word.trim()) continue;
      const isGhost = !!wData.ghost;
      /* Фильтр прохода. Стоит ДО spanIdx++, но счётчик от этого не врёт:
         его двигают только настоящие слова, а пропускаем мы их лишь в
         ghost-проходе, где разметка вообще не нужна. В main-проходе
         отбрасываются только ghost-элементы, которые счётчика не касаются. */
      if (pass === 'ghost' && !isGhost) continue;
      if (pass === 'main'  &&  isGhost) continue;
      const mySpan  = isGhost ? null : wordSpans[spanIdx++];
      const wAlpha = wData.alpha ?? 1;
      if (wAlpha <= 0.001) continue;

      /* Кадровые поправки — только для настоящего набора. Фон рисуется
         исходным кеглем от исходной точки строки: он декорация кадра и
         вправе вылезать за любые границы (см. ghostFontSize выше). */
      const k         = isGhost ? 1 : _fit;
      const wScale    = (wData.scale ?? 1) * k;
      const wRot      = wData.rotation ?? 0;
      const wFontSize = (isGhost ? ghostFontSize : fontSize) * wScale;
      if (wFontSize < 2) continue;

      // Берём соответствующий span (или дефолт без эффектов)
      const span = mySpan ?? { word: wData.word, color, bold: false, italic: false };
      // Обновляем word на случай расхождения (напр. после чистки rawText)
      const spanForDraw = { ...span, word: wData.word };
      // Подложка рисуется базовым стилем и БЕЗ дуотона — см. plainFill.
      if (isGhost) spanForDraw._ghost = true;

      ctx.save();
      ctx.globalAlpha *= wAlpha;
      ctx.translate((isGhost ? ghostCx : cx) + wData.x * k,
                    (isGhost ? ghostCy : cy) + wData.y * k);
      if (wRot) ctx.rotate(wRot);

      // Предварительно меряем ширину при нужном размере
      const fontStyle = (spanForDraw.bold ? 'bold ' : '') + (spanForDraw.italic ? 'italic ' : '');
      const drawSize  = spanForDraw.big   ? wFontSize * 1.45
                      : spanForDraw.small ? wFontSize * 0.65
                      : wFontSize;
      ctx.font        = `${fontStyle}${drawSize}px ${font}${EMOJI_FB}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      spanForDraw._w  = ctx.measureText(spanForDraw.word).width;

      // Рисуем через drawSpan — он обработает все FX (box, glow, glitch, …)
      // Координаты (0,0) т.к. уже сделали translate выше
      drawSpan(ctx, spanForDraw, 0, 0, wFontSize, font, t, anim);

      ctx.restore();
    }

    ctx.restore();

    /* Подпись фона за этот кадр — см. _watchGhost. Снимаем в проходе, где
       фон реально рисуется: в 'main' его нет, и сравнивать было бы нечего. */
    if (pass !== 'main') {
      let n = 0, x0 = Infinity, x1 = -Infinity;
      for (const wD of anim.words) {
        if (!wD.ghost || !wD.word || !wD.word.trim()) continue;
        if ((wD.alpha ?? 1) <= 0.001) continue;
        n++;
        const hw = ghostFontSize * (wD.scale ?? 1) * wD.word.length * 0.3;
        if ((wD.x ?? 0) - hw < x0) x0 = (wD.x ?? 0) - hw;
        if ((wD.x ?? 0) + hw > x1) x1 = (wD.x ?? 0) + hw;
      }
      if (n) _watchGhost({
        line: (typeof lyric === 'string' ? lyric : (lyric && lyric.text) || '').slice(0, 24),
        fs: ghostFontSize, cx: ghostCx, cy: ghostCy, x0: x0, x1: x1, n: n,
      });
    }

    // Возвращаем нижнюю границу последнего слова (для позиционирования перевода)
    let wlBottom = cy;
    for (const wData of anim.words) {
      // Низ набора — по настоящим словам: перевод должен встать под
      // ТЕКСТОМ, а не под подложкой, которая уходит за край кадра.
      if (wData.ghost) continue;
      const absY = cy + (wData.y ?? 0) + fontSize * (wData.scale ?? 1) * 0.5;
      if (absY > wlBottom) wlBottom = absY;
    }
    return wlBottom;
  }

  /* ── Безопасная зона кадра ──────────────────────────────────────────
     bounds = {x,y,w,h} — внутренняя область рамки (BackgroundEngine.getTextSafeArea).
     Если не передана — работаем по всему холсту, как раньше. */
  function resolveArea(bounds, canvasWidth) {
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      return { x: bounds.x || 0, y: bounds.y || 0, w: bounds.w, h: bounds.h };
    }
    return { x: 0, y: 0, w: canvasWidth, h: Infinity };
  }

  /* ── Видимая область при активной камере ─────────────────────────────────
     Текст верстается в координатах холста, но камера уже наложила на
     контекст свою матрицу: на зуме в кадр попадает не весь холст, а его
     кусок. Зона, честная в координатах холста, при зуме припева оказывается
     шире экрана — и строка уезжает за край, хотя формально «внутри кадра».

     Берём прообраз вьюпорта: обратная матрица переводит углы экрана обратно
     в координаты раскладки. Для зума и сдвига это точный прямоугольник; при
     повороте берётся вписанный, то есть с запасом в свою пользу. */
  function visibleArea(ctx) {
    try {
      if (!ctx.getTransform) return null;
      const m = ctx.getTransform();
      if (!m || typeof m.inverse !== 'function') return null;
      const inv = m.inverse();
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const p = [[0,0],[W,0],[0,H],[W,H]].map(function(c) {
        const q = inv.transformPoint(new DOMPoint(c[0], c[1]));
        return [q.x, q.y];
      });
      const x0 = Math.max(p[0][0], p[2][0]), x1 = Math.min(p[1][0], p[3][0]);
      const y0 = Math.max(p[0][1], p[1][1]), y1 = Math.min(p[2][1], p[3][1]);
      if (!(x1 > x0 && y1 > y0)) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } catch (e) { return null; }
  }

  // Пересечение зоны с видимой областью. Вырожденный результат отбрасываем:
  // при экстремальном зуме лучше верстать по холсту, чем по щели.
  function clipToVisible(area, ctx) {
    const v = visibleArea(ctx);
    if (!v) return area;
    const x0 = Math.max(area.x, v.x), y0 = Math.max(area.y, v.y);
    const x1 = Math.min(area.x + area.w, v.x + v.w);
    const y1 = Math.min(area.y + area.h, isFinite(area.h) ? area.y + area.h : v.y + v.h);
    const yy1 = Math.min(y1, v.y + v.h);
    if (!(x1 - x0 > 8 && yy1 - y0 > 8)) return area;
    return { x: x0, y: y0, w: x1 - x0, h: isFinite(area.h) ? yy1 - y0 : Infinity };
  }

  /* ── Маска: вычитаем из зоны силуэт персонажа ────────────────────────────
     shapeAt(y) → {x0,x1} — занятый по горизонтали кусок на высоте y
     (BackgroundEngine.getCharacterShape). До сих пор силуэт знал только
     word-layout; построчный путь рисовал прямо сквозь героя.

     Строка занимает не одну высоту, а полосу, поэтому профиль снимается
     несколькими пробами и берётся ХУДШИЙ случай: иначе на кадре, где
     персонаж сужается, текст заедет ему на плечо.

     Из двух свободных сторон берём широкую. Если персонаж съедает почти всю
     зону, маска отключается: лучше текст поверх героя, чем нечитаемая
     колонка в два символа шириной. */
  function maskedArea(area, shapeAt, cy, blockH) {
    if (typeof shapeAt !== 'function') return area;

    /* Полоса — реальная высота блока с запасом: строка ещё будет двигаться
       по вертикали (клампинг центра, offsetY, дыхание кегля), и профиль,
       снятый впритык, промахнётся на плечо. Проб много и берётся ХУДШИЙ
       случай: одна проба у головы — это и есть «маска вроде есть, а текст
       на ней лежит». */
    const band = Math.max(blockH * 1.35, area.h * 0.12);
    let x0 = Infinity, x1 = -Infinity;
    const N = 15;
    for (let i = 0; i < N; i++) {
      const sp = shapeAt(cy - band / 2 + band * (i / (N - 1)));
      if (!sp) continue;
      x0 = Math.min(x0, sp.x0); x1 = Math.max(x1, sp.x1);
    }
    if (!(x0 < Infinity)) return area;   // на этой высоте персонажа нет

    const R = area.x + area.w;
    // Воздух до силуэта: у крупного кегля обводка и тень заметно шире буквы,
    // поэтому зазор растёт вместе с блоком, а не остаётся долей ширины кадра.
    const gap    = Math.max(area.w * 0.02, blockH * 0.12);
    const leftW  = Math.max(0, Math.min(x0, R) - area.x - gap);
    const rightW = Math.max(0, R - Math.max(x1, area.x) - gap);

    if (Math.max(leftW, rightW) < area.w * 0.25) return area;

    return leftW >= rightW
      ? { x: area.x, y: area.y, w: leftW, h: area.h }
      : { x: Math.max(x1, area.x) + gap, y: area.y, w: rightW, h: area.h };
  }

  // Максимальная ширина строки среди rows при данном размере шрифта
  function rowsMaxWidth(ctx, rows, baseFontSize, font) {
    const WORD_GAP = baseFontSize * 0.35;
    let maxW = 0;
    rows.forEach(row => {
      let rw = 0;
      row.forEach((sp, idx) => {
        rw += measureSpan(ctx, sp, baseFontSize, font).width;
        if (idx < row.length - 1) rw += WORD_GAP;
      });
      if (rw > maxW) maxW = rw;
    });
    return maxW;
  }

  /* ── Main draw ── */
  /* pass — какую часть набора рисовать:
       null / 'all' — всё (обычный случай);
       'ghost'      — только служебный слой (подложка, эхо, встречная тень);
       'main'       — только сам текст.
     Двухпроходная отрисовка нужна там, где между слоями встаёт спрайт:
     дубль уходит ЗА фигуру, читаемый текст остаётся ПЕРЕД ней. Раньше набор
     был неделим, поэтому за фигуру приходилось прятать его целиком вместе с
     дублем — и слово теряло хвост ровно там, где его надо читать. */
  function draw(ctx, lyric, cx, cy, anim, fadeAlpha, color, font, fontSize, canvasWidth, t=0, globalBoxId=null, bounds=null, shapeAt=null, pass=null) {
    // lyric.text уже очищен парсером (без /commands/, без {LFONT:...}, без empty-маркеров).
    // НИ В КОЕМ СЛУЧАЕ не фолбэчимся на rawText — пустой text это намеренное состояние
    // (техническая строка / маркер «(пусто)») и текст не должен рисоваться.
    const text = typeof lyric === 'string'
      ? lyric
      : (lyric && typeof lyric.text === 'string' ? lyric.text : '');
    if (!text || !text.trim()) {
      // Пустой текст — ничего не рисуем, рамка/бокс тоже не появятся.
      return;
    }
    const {
      scaleX=1,scaleY=1,offsetX=0,offsetY=0,rotation=0,
      alpha=1,neonGlow=false,glowAmt=0,
    } = anim||{};

    // ── Word Layout (kinetic per-word positioning) ──
    if (anim && anim.wordLayout && Array.isArray(anim.words)) {
      return drawWordLayout(ctx, lyric, cx, cy, anim, fadeAlpha, color, font, fontSize, canvasWidth, t, globalBoxId, bounds, shapeAt, pass);
    }
    /* Непословные режимы делить не на что: у них служебного слоя нет.
       Проход 'ghost' для них — пустой, иначе строка нарисуется дважды. */
    if (pass === 'ghost') return;

    const totalAlpha = alpha*fadeAlpha;
    if (totalAlpha<=0.001) return;

    ctx.save();
    ctx.globalAlpha = totalAlpha;

    if (neonGlow && glowAmt>0.05) {
      // Радиус ограничен: на крупном кегле fontSize*0.5 давало ореол в
      // десятки пикселей, а стоимость размытия растёт квадратично от радиуса.
      ctx.shadowColor=color; ctx.shadowBlur=Math.min(22, fontSize*glowAmt*0.5);
    }

    // ── Раскладка внутри безопасной зоны кадра ──────────────────────────
    // area — внутренняя область рамки (или весь холст, если рамок нет).
    // Перенос строк, авто-уменьшение шрифта и клампинг центра считаются
    // относительно неё, поэтому куплет не вылезает за пределы кадра.
    const maxPossibleScale = 2.2;
    const spans    = parseSpans(text, color, t);

    /* Маску считаем в два прохода. Профиль фигуры меряется по ВЫСОТЕ БЛОКА,
       а высота известна только после переноса — который сам зависит от
       ширины, то есть от маски. Один проход по полосе вокруг cy давал ровно
       то, что видно на кадре: у головы силуэт узкий, строка меряется по
       нему и спокойно заезжает на плечи. Поэтому: черновой перенос по
       незамаскированной зоне ради высоты — и только потом настоящая маска. */
    const areaFull = clipToVisible(resolveArea(bounds, canvasWidth), ctx);
    let blockH = fontSize * 1.6;
    {
      const mw0 = (areaFull.w - areaFull.w*0.04*2) / maxPossibleScale;
      blockH = wrapSpans(ctx, spans, mw0, fontSize, font).length * fontSize * 1.6;
    }
    const area     = maskedArea(areaFull, shapeAt, cy, blockH);
    const padding  = area.w*0.04;
    // Учитываем максимальный возможный scaleX (обычно до 2.2x), чтобы текст не вылезал за границы
    // но при этом не перестраивался во время анимации
    const maxWidth = (area.w - padding*2) / maxPossibleScale;

    // Подбор размера: если строк столько, что блок не влезает в высоту зоны —
    // уменьшаем шрифт (до 45% от исходного) и переносим заново.
    const MIN_FONT = Math.max(8, fontSize * 0.45);
    // По вертикали анимации растягивают текст слабее, чем по горизонтали
    const VERT_SCALE_RESERVE = 1.15;
    const maxHeight = isFinite(area.h)
      ? (area.h - area.h*0.04*2) / VERT_SCALE_RESERVE
      : Infinity;

    let rows   = wrapSpans(ctx, spans, maxWidth, fontSize, font);
    let lineH  = fontSize*1.6;
    let totalH = rows.length*lineH;
    for (let fit = 0; fit < 8 && totalH > maxHeight && fontSize > MIN_FONT; fit++) {
      fontSize = Math.max(MIN_FONT, fontSize * Math.max(0.82, Math.sqrt(maxHeight / totalH)));
      rows   = wrapSpans(ctx, spans, (area.w - area.w*0.04*2) / maxPossibleScale, fontSize, font);
      lineH  = fontSize*1.6;
      totalH = rows.length*lineH;
    }

    /* Пол MIN_FONT держит читаемость, но на сильном зуме припева видимая
       высота меньше, чем блок способен ужаться по этому полу, — и строка
       уезжала за экран. Обрезанный текст хуже мелкого, поэтому если после
       подбора блок всё ещё не влезает, пол снимается. Страховка кадра тут
       не поможет: она домножает масштаб глифов, а межстрочный интервал
       остаётся, и высота блока не меняется. */
    for (let fit = 0; fit < 6 && isFinite(maxHeight) && totalH > maxHeight && fontSize > 6; fit++) {
      fontSize = Math.max(6, fontSize * Math.max(0.7, maxHeight / totalH));
      rows   = wrapSpans(ctx, spans, (area.w - area.w*0.04*2) / maxPossibleScale, fontSize, font);
      lineH  = fontSize*1.6;
      totalH = rows.length*lineH;
    }

    // Клампим центр блока, чтобы он целиком оставался внутри зоны
    const blockW = rowsMaxWidth(ctx, rows, fontSize, font);
    const halfW  = blockW/2 + padding*0.5;
    if (area.w > halfW*2) {
      cx = Math.min(Math.max(cx, area.x + halfW), area.x + area.w - halfW);
    } else {
      cx = area.x + area.w/2;
    }
    const halfH = totalH/2;
    if (isFinite(area.h)) {
      if (area.h > halfH*2) {
        cy = Math.min(Math.max(cy, area.y + halfH), area.y + area.h - halfH);
      } else {
        cy = area.y + area.h/2;
      }
    }

    const startY   = cy - totalH/2 + lineH/2;

    /* ══ СТРАХОВКА КАДРА (построчный путь) ═══════════════════════════
       Такая же, как в drawWordLayout, и по той же причине — но здесь она
       нужнее. Перенос считается по maxWidth с ЗАЛОЖЕННЫМ множителем 2.2,
       то есть по догадке о будущем масштабе. Догадка врёт всегда, когда
       строка стоит не по центру кадра (cx смещён якорем), когда режим
       разгоняет scaleX выше 2.2 на басу, когда {BIG} расширяет слово уже
       после переноса или когда слово физически шире maxWidth и перенести
       его нельзя. В любом из этих случаев строка уезжает за край целиком,
       и в кадре остаётся одно слово — ровно та картинка, на которую
       жалуются.

       Поэтому здесь тоже замер по факту: меряем реальные ряды реальным
       кеглем с учётом scaleX и ужимаем всё на один коэффициент. */
    let _fitLine = 1;
    {
      const POLE = canvasWidth * 0.035;
      let widest = 0;
      for (const row of rows) {
        let rw = 0;
        row.forEach((sp, idx) => {
          const spSize = sp.big ? fontSize*1.45 : sp.small ? fontSize*0.65 : fontSize;
          const fstyle = (sp.bold ? 'bold ' : '') + (sp.italic ? 'italic ' : '');
          ctx.font = `${fstyle}${spSize}px ${font}${EMOJI_FB}`;
          rw += ctx.measureText(sp.word).width;
          if (idx < row.length-1) rw += fontSize*0.35;
        });
        if (rw > widest) widest = rw;
      }
      const half = widest * Math.abs(scaleX) / 2 + Math.abs(offsetX);
      /* Место меряется от ЗОНЫ (area), а не от холста. От холста страховка
         гарантировала только «не вылезло за кадр» — и честно пропускала
         строку сквозь персонажа и под рамку: маска сужала area, но набор
         шире area просто центровался в ней и вываливался на обе стороны.
         Страховка — последний рубеж, значит мерить она обязана по той же
         области, по которой считалась раскладка. */
      const pole  = Math.min(POLE, area.w * 0.05);
      const room  = Math.max(8, Math.min(cx - (area.x + pole),
                                         (area.x + area.w - pole) - cx));
      if (half > room) _fitLine = room / half;
      _diag = { путь: 'построчный', cx: Math.round(cx), кадр: canvasWidth,
                зона: Math.round(area.x) + '..' + Math.round(area.x + area.w),
                поле: Math.round(pole), охват: Math.round(half),
                место: Math.round(room), ужатие: +_fitLine.toFixed(3),
                масштабРежима: +Number(scaleX).toFixed(2) };
    }

    // ── Global box fallback: если у строки нет своего бокса —
    //    рисуем один общий бокс под весь текст.
    //    Per-line opt-out: {LNOBOX} ⇒ lyric.lineStyle.noBox=true ⇒ пропустить.
    const _noBoxFlag = !!(lyric && typeof lyric === 'object' && lyric.lineStyle && lyric.lineStyle.noBox);
    if (globalBoxId && !_noBoxFlag && typeof BoxRegistry !== 'undefined') {
      const hasAnySpanBox = spans.some(sp => BoxRegistry.hasBox(sp));
      if (!hasAnySpanBox) {
        const gStyle = BoxRegistry.get(globalBoxId);
        if (gStyle) {
          // Вычисляем реальную ширину каждой строки с учётом размеров шрифта
          let maxRowW = 0;
          rows.forEach(row => {
            let rw = 0;
            row.forEach((sp, idx) => {
              const spSize = sp.big ? fontSize*1.45 : sp.small ? fontSize*0.65 : fontSize;
              const fontStyle = (sp.bold ? 'bold ' : '') + (sp.italic ? 'italic ' : '');
              ctx.font = `${fontStyle}${spSize}px ${font}${EMOJI_FB}`;
              rw += ctx.measureText(sp.word).width;
              if (idx < row.length-1) rw += fontSize*0.35;
            });
            if (rw > maxRowW) maxRowW = rw;
          });

          // Применяем scaleX к ширине и scaleY к высоте — рамка повторяет
          // размер текста ПОСЛЕ анимационных трансформаций
          const scaledW   = maxRowW * scaleX;
          const scaledH   = totalH  * scaleY;
          const gPadX = fontSize * 0.35 * scaleX;
          const gPadY = fontSize * 0.25 * scaleY;
          // Центр текста смещён на offsetX/offsetY из spring-анимации
          const gCx = cx + offsetX;
          const gCy = cy + offsetY;  // стартовая Y строк уже относительно cy
          const gBx = gCx - scaledW/2 - gPadX;
          const gBy = gCy - scaledH/2 - gPadY;
          const gBw = scaledW + gPadX*2;
          const gBh = scaledH + gPadY*2;
          ctx.save();
          gStyle.draw(ctx, gBx, gBy, gBw, gBh, color, t);
          ctx.restore();
        }
      }
    }

    rows.forEach((row, ri) => {
      const rowY = startY + ri*lineH + offsetY;
      let rowW = 0;
      const WORD_GAP = fontSize * 0.35;
      row.forEach((sp, idx) => {
        const {width} = measureSpan(ctx,sp,fontSize,font);
        sp._w=width;
        rowW += width;
        if (idx < row.length - 1) rowW += WORD_GAP; // межсловный отступ
      });

      ctx.save();
      ctx.translate(cx+offsetX,rowY);
      if (rotation) ctx.rotate(rotation);
      // _fitLine — страховка кадра (см. выше): домножается к масштабу
      // режима, поэтому ужимается ВСЯ строка целиком, а не отдельные слова,
      // и композиция строки не меняется.
      ctx.scale(scaleX*_fitLine,scaleY*_fitLine);
      ctx.translate(-(cx+offsetX),-rowY);

      // Начальная позиция X для строки (центрируем относительно cx без offsetX)
      let x = cx - rowW/2;

      // Группируем последовательные span'ы с box-эффектами
      const boxTypes = typeof BoxRegistry !== 'undefined' ? BoxRegistry.all.map(s=>s.id) : ['box','boxneon','boxglass','boxshadow','boxtape','boxrough'];
      let i = 0;
      while (i < row.length) {
        const sp = row[i];
        const hasBox = typeof BoxRegistry !== 'undefined' ? BoxRegistry.hasBox(sp) : boxTypes.some(bt => sp[bt]);
        
        if (hasBox) {
          // Находим все последовательные span'ы с таким же box-эффектом
          const boxType = boxTypes.find(bt => sp[bt]);
          const group = [sp];
          let j = i + 1;
          while (j < row.length && row[j][boxType]) {
            group.push(row[j]);
            j++;
          }
          
          // Вычисляем общую ширину группы (слова + отступы между ними)
          let groupWidth = 0;
          group.forEach((gsp, gidx) => {
            groupWidth += gsp._w;
            if (gidx < group.length - 1) groupWidth += WORD_GAP;
          });
          
          // Рисуем одну общую рамку для всей группы
          const groupCenterX = x + groupWidth / 2;
          const groupSpan = { ...sp, word: group.map(g => g.word).join(' '), _w: groupWidth };
          // Компактный padding с учетом padMultiplier
          let padMultiplier = 1;
          if (typeof BoxRegistry !== 'undefined') {
            const boxStyle = BoxRegistry.getActiveStyle(groupSpan);
            if (boxStyle && boxStyle.padMultiplier) {
              padMultiplier = boxStyle.padMultiplier;
            }
          }
          const boxPadX = fontSize * 0.2 * padMultiplier;
          const boxPadY = fontSize * 0.15 * padMultiplier;
          const boxBx  = groupCenterX - groupWidth/2 - boxPadX;
          const boxBy  = rowY - fontSize/2 - boxPadY;
          const boxBw  = groupWidth + boxPadX * 2;
          const boxBh  = fontSize + boxPadY * 2;
          if (typeof BoxRegistry !== 'undefined') BoxRegistry.draw(ctx, groupSpan, boxBx, boxBy, boxBw, boxBh, groupSpan.color||'#ffffff', t);
          else drawBox(ctx, groupSpan, groupCenterX, rowY, groupWidth, fontSize, t);
          
          // Рисуем текст каждого span'а без рамки
          group.forEach((gsp, gidx) => {
            const spanWithoutBox = { ...gsp };
            boxTypes.forEach(bt => spanWithoutBox[bt] = false);
            drawSpan(ctx, spanWithoutBox, x + gsp._w / 2, rowY, fontSize, font, t, anim);
            x += gsp._w;
            if (gidx < group.length - 1) x += WORD_GAP;
          });
          
          // Отступ ПОСЛЕ box-группы перед следующим словом
          if (j < row.length) x += WORD_GAP;
          
          i = j;
        } else {
          // Обычный span без box
          if (sp.word && sp.word.trim()) {
            drawSpan(ctx, sp, x + sp._w / 2, rowY, fontSize, font, t, anim);
            x += sp._w;
            // Отступ после слова, если следующий элемент существует
            if (i < row.length - 1) x += WORD_GAP;
          }
          i++;
        }
      }
      ctx.restore();
    });

    ctx.shadowBlur=0; ctx.shadowColor='transparent';
    ctx.restore();

    // ── Scroll дубликат: seamless loop ──
    // scroll_* возвращают _scrollDupe:{dx,dy} — смещение зеркального экземпляра.
    if (anim && anim._scrollDupe) {
      const { dx, dy } = anim._scrollDupe;
      const animDupe = { ...anim, offsetX: offsetX + dx, offsetY: offsetY + dy, _scrollDupe: null };
      draw(ctx, lyric, cx, cy, animDupe, fadeAlpha, color, font, fontSize, canvasWidth, t, globalBoxId, bounds, shapeAt);
    }

    // Возвращаем реальную нижнюю границу текста в canvas-координатах.
    const lastRowCenterY = cy + totalH / 2 - lineH / 2;
    const bottomY = lastRowCenterY + offsetY + (fontSize * scaleY) * 0.55;
    return bottomY;
  }

  /* Палитра текста наружу. Нужна авторежиссёру: фигура в кадре должна
     держать ТУ ЖЕ палитру, что и набор, иначе спрайт покрашен сам по себе,
     а текст сам по себе — два слоя из разных клипов. Отдаём именно тот
     цвет, в который уходит градиент буквы, а не исходный цвет текста:
     исходный почти всегда белый, и подмешивать белое в фигуру бессмысленно. */
  return { draw, getFadeAlpha, textShade: _deepShade,
           get lastFrameGuard() { return _diag; },
           get ghostJumps() { return _ghostJumps.slice(); } };
})();


/* ═══════════════════════════════════════════════
   Recorder
═══════════════════════════════════════════════ */
const Recorder = (() => {
  let mr, chunks = [];

  function start(canvas, audioDestNode=null) {
    chunks=[];
    const videoStream=canvas.captureStream(60);
    const tracks=[...videoStream.getVideoTracks()];
    if (audioDestNode) tracks.push(...audioDestNode.stream.getAudioTracks());
    const stream=new MediaStream(tracks);
    const mimeType=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ?'video/webm;codecs=vp9':'video/webm';
    mr=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:10_000_000});
    mr.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
    mr.start(100);
  }

  function stop() {
    return new Promise(resolve => {
      mr.onstop=()=>{
        const blob=new Blob(chunks,{type:'video/webm'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url; a.download=`chromatype_${Date.now()}.webm`;
        a.click(); resolve(url);
      };
      mr.stop();
    });
  }

  return { start, stop, get isRecording() { return mr?.state==='recording'; } };
})();