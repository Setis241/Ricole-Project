/* ═══════════════════════════════════════════════
   js/renderers.js  v4
   TextRenderer — поддержка inline FX-тегов + рамки:
     *bold* _italic_ ~underline~ ~~strike~~
     {BIG}…{/BIG} {SMALL}…{/SMALL}
     {GLITCH}…{/GLITCH} {GLOW}…{/GLOW}
     {WAVE}…{/WAVE} {OUTLINE}…{/OUTLINE}
     {RAINBOW}…{/RAINBOW} {NEON}…{/NEON}
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
      .replace(/\{L(?:FONT|SIZE|ANIM|COLOR|LAYER|POS|BGIMG|OVFX):[^}]+\}/g, '') // убрать line-style теги
      .replace(/\/[^\/]+\//g, '')                           // убрать ВСЕ /КОМАНДЫ/ включая /ZOOM IN/
      .trim();
    // После зачистки section-метка оказывается в начале — убираем
    text = text.replace(/^\[[^\]]+\]\s*/g, '').trim();

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
    while ((m = TAG_RE.exec(text)) !== null) {
      if (m.index > last) parts.push({ type:'text', val:text.slice(last,m.index) });
      parts.push({ type:'tag', val:m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ type:'text', val:text.slice(last) });

    if (!parts.length || (parts.length===1 && parts[0].type==='text')) {
      return text.split(/\s+/).filter(Boolean).map(w=>({
        word:w, color:baseColor,
        bold:false,italic:false,underline:false,strike:false,
        big:false,small:false,glitch:false,glow:false,shake:false,wave:false,
        outline:false,rainbow:false,neon:false,blur:false,flicker:false,
        box:false,boxneon:false,boxglass:false,boxshadow:false,boxtape:false,boxrough:false,boxfire:false,boxice:false,boxholo:false,boxgold:false,boxcyber:false,boxrainbow:false,boxretro:false,boxaura:false,boxmatrix:false,boxsmoke:false,boxplasma:false,boxtattoo:false,boxsunset:false,boxlacquer:false,boxcrystal:false,boxdanger:false,boxdiamond:false,boxfault:false,boxink:false,boxportal:false,boxsigil:false,boxstatic:false,boxvhs:false,boxvirus:false,boxwave:false,boxwire:false,
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
    ctx.font = `${style}${size}px ${font}`;
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
    ctx.font = `${fontStyle}${size}px ${font}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur   = 0;
    ctx.shadowColor  = 'transparent';
    ctx.filter       = 'none';

    let dx=0, dy=0;
    if (span.wave) dy += Math.sin(t*4 + x*0.02)*4;
    if (span.blur) ctx.filter = 'blur(3px)';

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

    } else if (span.glitch) {
      const gShift=Math.sin(t*97)*size*0.08;
      ctx.globalAlpha*=0.85;
      ctx.fillStyle='#ff3333'; ctx.fillText(span.word,finalX-gShift,finalY+gShift*0.3);
      ctx.fillStyle='#3333ff'; ctx.fillText(span.word,finalX+gShift,finalY-gShift*0.3);
      ctx.globalAlpha=prevAlpha*flickAlpha;
      ctx.fillStyle=span.color; ctx.fillText(span.word,finalX,finalY);

    } else if (span.outline) {
      ctx.strokeStyle='rgba(0,0,0,0.8)'; ctx.lineWidth=Math.max(3,size*0.08);
      ctx.strokeText(span.word,finalX,finalY);
      ctx.strokeStyle=span.color; ctx.lineWidth=Math.max(2,size*0.06);
      ctx.strokeText(span.word,finalX,finalY);

    } else if (span.glow||span.neon) {
      const glowColor = span.neon ? '#b14fff' : span.color;
      ctx.shadowColor=glowColor; ctx.shadowBlur=size*(span.neon?0.35:0.22);
      ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=Math.max(2,size*0.05);
      ctx.strokeText(span.word,finalX,finalY);
      ctx.fillStyle=glowColor; ctx.fillText(span.word,finalX,finalY);
      ctx.shadowBlur=0; ctx.shadowColor='transparent';

    } else {
      ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.lineWidth=Math.max(2,size*0.06);
      ctx.lineJoin='round'; ctx.strokeText(span.word,finalX,finalY);
      ctx.fillStyle=span.color; ctx.fillText(span.word,finalX,finalY);
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
  function drawWordLayout(ctx, lyric, cx, cy, anim, fadeAlpha, color, font, fontSize, canvasWidth, t, globalBoxId) {
    const totalAlpha = (anim.alpha ?? 1) * fadeAlpha;
    if (totalAlpha <= 0.001) return;

    // ── Global box для word-layout ──────────────────────────────────────
    // Вычисляем bbox по всем словам с учётом их индивидуальных позиций и scale
    if (globalBoxId && typeof BoxRegistry !== 'undefined') {
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
          if (wAlpha < SETTLED_THRESHOLD || !wData.word || !wData.word.trim()) continue;
          const wScale    = wData.scale ?? 1;
          const wFontSize = fontSize * wScale;
          if (wFontSize < 2) continue;
          ctx.font = `${wFontSize}px ${font}`;
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

    // ── Парсим rawText чтобы получить FX-стили для каждого слова ──
    // parseSpans группирует слова по стилю; разворачиваем их в
    // пословный массив, сохраняя FX-состояние каждого токена.
    const rawText  = typeof lyric === 'string' ? lyric : (lyric.rawText || lyric.text || '');
    const spans    = parseSpans(rawText, color, t);
    const wordSpans = [];               // один элемент = одно слово + его стиль
    for (const sp of spans) {
      const ws = sp.word.split(/\s+/).filter(Boolean);
      for (const w of ws) wordSpans.push({ ...sp, word: w });
    }

    ctx.save();
    ctx.globalAlpha = totalAlpha;

    for (let wi = 0; wi < anim.words.length; wi++) {
      const wData = anim.words[wi];
      if (!wData.word || !wData.word.trim()) continue;
      const wAlpha = wData.alpha ?? 1;
      if (wAlpha <= 0.001) continue;

      const wScale    = wData.scale ?? 1;
      const wRot      = wData.rotation ?? 0;
      const wFontSize = fontSize * wScale;
      if (wFontSize < 2) continue;

      // Берём соответствующий span (или дефолт без эффектов)
      const span = wordSpans[wi] ?? { word: wData.word, color, bold: false, italic: false };
      // Обновляем word на случай расхождения (напр. после чистки rawText)
      const spanForDraw = { ...span, word: wData.word };

      ctx.save();
      ctx.globalAlpha *= wAlpha;
      ctx.translate(cx + wData.x, cy + wData.y);
      if (wRot) ctx.rotate(wRot);

      // Предварительно меряем ширину при нужном размере
      const fontStyle = (spanForDraw.bold ? 'bold ' : '') + (spanForDraw.italic ? 'italic ' : '');
      const drawSize  = spanForDraw.big   ? wFontSize * 1.45
                      : spanForDraw.small ? wFontSize * 0.65
                      : wFontSize;
      ctx.font        = `${fontStyle}${drawSize}px ${font}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      spanForDraw._w  = ctx.measureText(spanForDraw.word).width;

      // Рисуем через drawSpan — он обработает все FX (box, glow, glitch, …)
      // Координаты (0,0) т.к. уже сделали translate выше
      drawSpan(ctx, spanForDraw, 0, 0, wFontSize, font, t, anim);

      ctx.restore();
    }

    ctx.restore();

    // Возвращаем нижнюю границу последнего слова (для позиционирования перевода)
    let wlBottom = cy;
    for (const wData of anim.words) {
      const absY = cy + (wData.y ?? 0) + fontSize * (wData.scale ?? 1) * 0.5;
      if (absY > wlBottom) wlBottom = absY;
    }
    return wlBottom;
  }

  /* ── Main draw ── */
  function draw(ctx, lyric, cx, cy, anim, fadeAlpha, color, font, fontSize, canvasWidth, t=0, globalBoxId=null) {
    // lyric.text уже очищен (без /commands/, без {LFONT:...}), rawText — сырой с тегами
    const text = typeof lyric==='string' ? lyric : (lyric.text||lyric.rawText||'');
    const {
      scaleX=1,scaleY=1,offsetX=0,offsetY=0,rotation=0,
      alpha=1,neonGlow=false,glowAmt=0,
    } = anim||{};

    // ── Word Layout (kinetic per-word positioning) ──
    if (anim && anim.wordLayout && Array.isArray(anim.words)) {
      return drawWordLayout(ctx, lyric, cx, cy, anim, fadeAlpha, color, font, fontSize, canvasWidth, t, globalBoxId);
    }

    const totalAlpha = alpha*fadeAlpha;
    if (totalAlpha<=0.001) return;

    ctx.save();
    ctx.globalAlpha = totalAlpha;

    if (neonGlow && glowAmt>0.05) {
      ctx.shadowColor=color; ctx.shadowBlur=fontSize*glowAmt*0.5;
    }

    const padding  = canvasWidth*0.04;
    // Учитываем максимальный возможный scaleX (обычно до 2.2x), чтобы текст не вылезал за границы
    // но при этом не перестраивался во время анимации
    const maxPossibleScale = 2.2;
    const maxWidth = (canvasWidth - padding*2) / maxPossibleScale;
    const spans    = parseSpans(text, color, t);
    const rows     = wrapSpans(ctx, spans, maxWidth, fontSize, font);
    const lineH    = fontSize*1.6;
    const totalH   = rows.length*lineH;
    const startY   = cy - totalH/2 + lineH/2;

    // ── Global box fallback: если у строки нет своего бокса —
    //    рисуем один общий бокс под весь текст ──────────────
    if (globalBoxId && typeof BoxRegistry !== 'undefined') {
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
              ctx.font = `${fontStyle}${spSize}px ${font}`;
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
      ctx.scale(scaleX,scaleY);
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

    // Возвращаем реальную нижнюю границу текста в canvas-координатах.
    // Центр последней строки = cy + totalH/2 - lineH/2, её визуальный низ
    // учитывает scaleY анимации и offsetY от пружин.
    const lastRowCenterY = cy + totalH / 2 - lineH / 2;
    const bottomY = lastRowCenterY + offsetY + (fontSize * scaleY) * 0.55;
    return bottomY;
  }

  return { draw, getFadeAlpha };
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
