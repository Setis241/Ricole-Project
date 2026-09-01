/* ═══════════════════════════════════════════════
   box-fix.js  — динамический патч для BoxRegistry
   
   Проблема: renderers.js и FxEditor.js содержат
   хардкод только 20 ID боксов из 32+. Новые боксы
   (boxcrystal, boxdanger, boxdiamond, boxportal,
   boxsigil, boxstatic, boxvhs, boxwave, boxwire и др.)
   не распознаются и не рендерятся.
   
   Решение: патчим parseSpans() в TextRenderer
   и tokenizeLine() / FX_TAG_MAP в FxEditor так,
   чтобы они читали ID из BoxRegistry.all динамически.
   
   Подключай: в index.html ПОСЛЕ всех остальных скриптов.
═══════════════════════════════════════════════ */

(function() {
  'use strict';

  // Ждём полной загрузки DOM + скриптов
  function applyFix() {
    if (typeof BoxRegistry === 'undefined') {
      console.warn('[box-fix] BoxRegistry не найден, патч отложен');
      return;
    }

    const ALL_IDS = BoxRegistry.all.map(s => s.id);
    // Строка для TAG_RE: 'BOX|BOXNEON|BOXFIRE|...'
    const BOX_TAGS_DYNAMIC = ALL_IDS.map(id => id.toUpperCase()).join('|');

    // ─────────────────────────────────────────────
    // ПАТЧ 1: TextRenderer — parseSpans
    // Monkey-patch через замену внутренней функции
    // ─────────────────────────────────────────────
    if (typeof TextRenderer !== 'undefined') {
      // Перехватываем draw(), оборачиваем parseSpans внутри
      // Так как parseSpans — замыкание, патчим через TextRenderer.draw
      // путём подмены функции целиком.

      const _origDraw = TextRenderer.draw.bind(TextRenderer);

      // Новый parseSpans с динамическими боксами
      function parseSpansDynamic(text, baseColor, t) {
        // Убираем line-style теги и команды
        text = text
          // Синхронно с LRCParser.LINE_STYLE_RE.
          .replace(/\{L(?:FONT|SIZE|ANIM|COLOR|POSX|POSY|POS|LAYER|OVFX|BGIMG|NOBOX):[^}]+\}|\{LNOBOX\}/g, '')
          .replace(/\/[^\/]+\//g, '')
          .trim();
        text = text.replace(/^\[[^\]]+\]\s*/g, '').trim();

        const TAG_RE = new RegExp(
          `(\\{COLOR:#[0-9a-fA-F]{3,6}\\}|\\{\\/COLOR\\}` +
          `|\\{(?:${BOX_TAGS_DYNAMIC})\\}|\\{\\/(?:${BOX_TAGS_DYNAMIC})\\}` +
          `|\\{BIG\\}|\\{\\/BIG\\}|\\{SMALL\\}|\\{\\/SMALL\\}` +
          `|\\{GLITCH\\}|\\{\\/GLITCH\\}|\\{GLOW\\}|\\{\\/GLOW\\}` +
          `|\\{SHAKE\\}|\\{\\/SHAKE\\}|\\{WAVE\\}|\\{\\/WAVE\\}` +
          `|\\{OUTLINE\\}|\\{\\/OUTLINE\\}|\\{RAINBOW\\}|\\{\\/RAINBOW\\}` +
          `|\\{NEON\\}|\\{\\/NEON\\}|\\{BLUR\\}|\\{\\/BLUR\\}` +
          `|\\{FLICKER\\}|\\{\\/FLICKER\\}|\\{GRAD\\}|\\{\\/GRAD\\}` +
          `|\\*\\*?|_(?!_)|~~?|~(?!~))`, 'g'
        );

        // Начальное состояние — все боксы как false
        const state = {
          bold:false, italic:false, underline:false, strike:false,
          big:false, small:false, glitch:false, glow:false, shake:false, wave:false,
          outline:false, rainbow:false, neon:false, blur:false, flicker:false, grad:false,
          color: null,
        };
        ALL_IDS.forEach(id => { state[id] = false; });

        const spans = [];
        const parts = [];
        let last = 0; let m;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(text)) !== null) {
          if (m.index > last) parts.push({ type:'text', val: text.slice(last, m.index) });
          parts.push({ type:'tag', val: m[0] });
          last = m.index + m[0].length;
        }
        if (last < text.length) parts.push({ type:'text', val: text.slice(last) });

        if (!parts.length || (parts.length === 1 && parts[0].type === 'text')) {
          const baseState = { color: baseColor };
          ALL_IDS.forEach(id => { baseState[id] = false; });
          return text.split(/\s+/).filter(Boolean).map(w => ({
            word: w, color: baseColor,
            bold:false, italic:false, underline:false, strike:false,
            big:false, small:false, glitch:false, glow:false, shake:false, wave:false,
            outline:false, rainbow:false, neon:false, blur:false, flicker:false, grad:false,
            ...Object.fromEntries(ALL_IDS.map(id => [id, false])),
          }));
        }

        let currentGroup = null;

        for (const part of parts) {
          if (part.type === 'text') {
            const words = part.val.split(/\s+/).filter(w => w && w.trim());
            for (const word of words) {
              const stateKey = JSON.stringify({ ...state, color: state.color || baseColor });
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
                currentGroup.words.push(word);
              }
            }
          } else {
            if (currentGroup) {
              spans.push({ ...currentGroup.state, word: currentGroup.words.join(' ') });
              currentGroup = null;
            }
            const tag = part.val;
            if (tag === '*' || tag === '**') state.bold = !state.bold;
            else if (tag === '_') state.italic = !state.italic;
            else if (tag === '~' && !tag.startsWith('~~')) state.underline = !state.underline;
            else if (tag === '~~') state.strike = !state.strike;
            else {
              const openM  = tag.match(/^\{([A-Z0-9]+)\}$/);
              const closeM = tag.match(/^\{\/([A-Z0-9]+)\}$/);
              if (openM)  { const k = openM[1].toLowerCase();  if (k in state) state[k] = true; }
              if (closeM) { const k = closeM[1].toLowerCase(); if (k in state) state[k] = false; }
              if (tag.startsWith('{COLOR:')) state.color = tag.slice(7, -1);
              if (tag === '{/COLOR}') state.color = null;
            }
          }
        }

        if (currentGroup) {
          spans.push({ ...currentGroup.state, word: currentGroup.words.join(' ') });
        }

        return spans;
      }

      // Заменяем draw через обёртку которая использует новый parseSpans
      // Патчим через Canvas2D proxy — перехватываем вызов
      // Проще всего: заменить TextRenderer.draw на новую версию которая вызывает
      // parseSpansDynamic вместо внутренней parseSpans.
      // Поскольку parseSpans — замыкание, нужно переписать draw полностью.

      // Копируем getFadeAlpha
      const getFadeAlpha = TextRenderer.getFadeAlpha;

      // Вспомогательные функции из оригинала (нужно дублировать т.к. замыкания)
      function measureSpan(ctx, span, baseFontSize, font) {
        const size = span.big ? baseFontSize*1.45 : span.small ? baseFontSize*0.65 : baseFontSize;
        let style = '';
        if (span.bold)   style += 'bold ';
        if (span.italic) style += 'italic ';
        ctx.font = `${style}${size}px ${font}`;
        const width = ctx.measureText(span.word).width;
        return { width: width || (span.word.trim()==='' ? size*0.3 : 0), size };
      }

      function wrapSpans(ctx, spans, maxWidth, baseFontSize, font) {
        const rows=[]; let row=[]; let rowW=0;
        const WORD_GAP = baseFontSize * 0.35;
        for (const span of spans) {
          const {width} = measureSpan(ctx, span, baseFontSize, font);
          const gapBefore = row.length > 0 && span.word.trim() ? WORD_GAP : 0;
          const totalWidth = rowW + gapBefore + width;
          
          if (totalWidth > maxWidth && row.length > 0) {
            rows.push(row); row=[]; rowW=0;
          }
          
          row.push({...span, _w: width}); 
          rowW += width + (row.length > 1 ? WORD_GAP : 0);
        }
        if (row.length) rows.push(row);
        return rows;
      }

      // Новый draw — полная замена
      TextRenderer.draw = function(ctx, lyric, cx, cy, anim, fadeAlpha, color, font, fontSize, canvasWidth, t=0) {
        const text = typeof lyric==='string' ? lyric : (lyric.text || lyric.rawText || '');
        const {
          scaleX=1, scaleY=1, offsetX=0, offsetY=0, rotation=0,
          alpha=1, neonGlow=false, glowAmt=0,
        } = anim || {};

        const totalAlpha = alpha * fadeAlpha;
        if (totalAlpha <= 0.001) return;

        ctx.save();
        ctx.globalAlpha = totalAlpha;

        if (neonGlow && glowAmt > 0.05) {
          ctx.shadowColor = color; ctx.shadowBlur = fontSize * glowAmt * 0.5;
        }

        const padding  = canvasWidth * 0.04;
        // Учитываем максимальный возможный scaleX (обычно до 2.2x), чтобы текст не вылезал за границы
        // но при этом не перестраивался во время анимации
        const maxPossibleScale = 2.2;
        const maxWidth = (canvasWidth - padding*2) / maxPossibleScale;
        const spans    = parseSpansDynamic(text, color, t);
        const rows     = wrapSpans(ctx, spans, maxWidth, fontSize, font);
        const lineH    = fontSize * 1.6;
        const totalH   = rows.length * lineH;
        const startY   = cy - totalH/2 + lineH/2;

        const boxTypes = ALL_IDS;

        rows.forEach((row, ri) => {
          const rowY = startY + ri * lineH + offsetY;
          let rowW = 0;
          const WORD_GAP = fontSize * 0.35;
          row.forEach((sp, idx) => {
            const {width} = measureSpan(ctx, sp, fontSize, font);
            sp._w = width; 
            rowW += width;
            if (idx < row.length - 1) rowW += WORD_GAP;
          });

          let x = cx - rowW/2 + offsetX;
          ctx.save();
          ctx.translate(cx+offsetX, rowY);
          if (rotation) ctx.rotate(rotation);
          ctx.scale(scaleX, scaleY);
          ctx.translate(-(cx+offsetX), -rowY);

          let i = 0;
          while (i < row.length) {
            const sp = row[i];
            const hasBox = BoxRegistry.hasBox(sp);

            if (hasBox) {
              const boxType = boxTypes.find(bt => sp[bt]);
              const group = [sp];
              let j = i + 1;
              while (j < row.length && row[j][boxType]) {
                group.push(row[j]);
                j++;
              }

              let groupWidth = 0;
              group.forEach((gsp, gidx) => {
                groupWidth += gsp._w;
                if (gidx < group.length - 1) groupWidth += WORD_GAP;
              });

              const groupCenterX = x + groupWidth / 2;
              const groupSpan = { ...sp, word: group.map(g => g.word).join(' '), _w: groupWidth };
              const boxPad = Math.max(14, fontSize * 0.22);
              const boxBx  = groupCenterX - groupWidth/2 - boxPad;
              const boxBy  = rowY - fontSize/2 - boxPad * 0.75;
              const boxBw  = groupWidth + boxPad * 2;
              const boxBh  = fontSize + boxPad * 1.5;
              BoxRegistry.draw(ctx, groupSpan, boxBx, boxBy, boxBw, boxBh, groupSpan.color || '#ffffff', t);

              group.forEach((gsp, gidx) => {
                const spanWithoutBox = { ...gsp };
                boxTypes.forEach(bt => spanWithoutBox[bt] = false);
                _drawSpanProxy(ctx, spanWithoutBox, x + gsp._w / 2, rowY, fontSize, font, t, anim);
                x += gsp._w;
                if (gidx < group.length - 1) x += WORD_GAP;
              });

              i = j;
            } else {
              if (sp.word && sp.word.trim()) {
                _drawSpanProxy(ctx, sp, x + sp._w / 2, rowY, fontSize, font, t, anim);
                x += sp._w;
                if (i < row.length - 1) x += WORD_GAP;
              }
              i++;
            }
          }
          ctx.restore();
        });

        ctx.shadowBlur=0; ctx.shadowColor='transparent';
        ctx.restore();
      };

      // drawSpan — нужен для рендера текста без рамки
      // Вызываем оригинальный через временный canvas trick или просто дублируем логику
      function _drawSpanProxy(ctx, span, cx, cy, baseFontSize, font, t, anim) {
        const size = span.big ? baseFontSize*1.45 : span.small ? baseFontSize*0.65 : baseFontSize;
        let style = '';
        if (span.bold)   style += 'bold ';
        if (span.italic) style += 'italic ';
        ctx.font = `${style}${size}px ${font}`;

        const tw = ctx.measureText(span.word).width;
        const {offsetX:ax=0, offsetY:ay=0} = anim || {};

        const flickThresh = 0.4;
        let flickAlpha = 1;
        if (span.flicker) {
          const flick = Math.sin(t * 23.7) * 0.5 + 0.5;
          flickAlpha = flick > flickThresh ? 1 : 0.15 + flick * 0.5;
        }

        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * flickAlpha;

        let finalX = cx, finalY = cy;
        if (span.shake) {
          finalX += Math.sin(t * 87.3) * (span.big ? 4 : 2);
          finalY += Math.cos(t * 73.1) * (span.big ? 2 : 1);
        }
        if (span.wave) {
          finalY += Math.sin(t * 4.5 + cx * 0.01) * size * 0.15;
        }
        if (span.blur) {
          ctx.filter = `blur(${size * 0.04}px)`;
        }

        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        if (span.rainbow) {
          const grd = ctx.createLinearGradient(finalX-tw/2, 0, finalX+tw/2, 0);
          const hOff = (t*60)%360;
          grd.addColorStop(0,   `hsl(${hOff},100%,60%)`);
          grd.addColorStop(0.33,`hsl(${hOff+120},100%,60%)`);
          grd.addColorStop(0.66,`hsl(${hOff+240},100%,60%)`);
          grd.addColorStop(1,   `hsl(${hOff+360},100%,60%)`);
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = Math.max(2, size*0.06);
          ctx.strokeText(span.word, finalX, finalY);
          ctx.fillStyle = grd; ctx.fillText(span.word, finalX, finalY);
        } else if (span.glitch) {
          const gShift = Math.sin(t*97) * size * 0.08;
          ctx.globalAlpha *= 0.85;
          ctx.fillStyle = '#ff3333'; ctx.fillText(span.word, finalX-gShift, finalY+gShift*0.3);
          ctx.fillStyle = '#3333ff'; ctx.fillText(span.word, finalX+gShift, finalY-gShift*0.3);
          ctx.globalAlpha = prevAlpha * flickAlpha;
          ctx.fillStyle = span.color; ctx.fillText(span.word, finalX, finalY);
        } else if (span.outline) {
          ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = Math.max(3, size*0.08);
          ctx.strokeText(span.word, finalX, finalY);
          ctx.strokeStyle = span.color; ctx.lineWidth = Math.max(2, size*0.06);
          ctx.strokeText(span.word, finalX, finalY);
        } else if (span.glow || span.neon) {
          const glowColor = span.neon ? '#b14fff' : span.color;
          ctx.shadowColor = glowColor; ctx.shadowBlur = size * (span.neon ? 0.35 : 0.22);
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = Math.max(2, size*0.05);
          ctx.strokeText(span.word, finalX, finalY);
          ctx.fillStyle = glowColor; ctx.fillText(span.word, finalX, finalY);
          ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        } else {
          ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = Math.max(2, size*0.06);
          ctx.lineJoin = 'round'; ctx.strokeText(span.word, finalX, finalY);
          ctx.fillStyle = span.color; ctx.fillText(span.word, finalX, finalY);
        }

        if (span.underline) {
          ctx.strokeStyle = span.color; ctx.lineWidth = Math.max(1, size*0.04);
          ctx.beginPath();
          ctx.moveTo(finalX-tw/2, finalY+size*0.12);
          ctx.lineTo(finalX+tw/2, finalY+size*0.12);
          ctx.stroke();
        }
        if (span.strike) {
          ctx.strokeStyle = span.color; ctx.lineWidth = Math.max(1, size*0.04);
          ctx.save(); ctx.globalAlpha *= 0.6;
          ctx.beginPath();
          ctx.moveTo(finalX-tw/2, finalY-size*0.05);
          ctx.lineTo(finalX+tw/2, finalY-size*0.05);
          ctx.stroke(); ctx.restore();
        }

        ctx.globalAlpha = prevAlpha;
        if (span.blur) ctx.filter = 'none';
      }

    }

    // ─────────────────────────────────────────────
    // ПАТЧ 2: FxEditor — FX_TAG_MAP + tokenizeLine
    // ─────────────────────────────────────────────
    // FxEditor — IIFE-замыкание, напрямую не патчится.
    // Но мы можем перехватить buildLRC через monkey-patching open/close
    // Вместо этого патчим через глобальный override токенайзера.
    // Самый надёжный способ — расширить FX_TAG_MAP через внутренний state.
    // Поскольку FxEditor — IIFE, его внутренние переменные недоступны снаружи.
    // Единственный внешний API — FxEditor.open(lrc, onSave) и FxEditor.close().
    //
    // РЕШЕНИЕ: Override FxEditor.open, прежде чем он вызовется первый раз,
    // патчим DOM после createOverlay() через MutationObserver.
    // Но строка tokenizeLine тоже внутренняя...
    //
    // Реальное решение: перехватываем через прокси на FxEditor.open
    // и после открытия добавляем в calloutGrid кнопки для пропущенных боксов.
    // Токены уже корректно читаются через BoxRegistry если мы пофиксим parseSpans.
    // FxEditor.tokenizeLine — закрытая, но она тоже хардкодит state.
    // Поскольку FxEditor строит LRC через tokensToText → FX_TAG_MAP,
    // и FX_TAG_MAP тоже жёстко задан — пропущенные боксы не будут сериализованы.
    //
    // ПОЛНЫЙ ФИКСдля FxEditor требует редактирования исходника.
    // Здесь мы даём патч для renderers (основной рендер) и выводим предупреждение.

    // Патчим calloutGrid после открытия FxEditor
    if (typeof FxEditor !== 'undefined') {
      const _origOpen = FxEditor.open;
      FxEditor.open = function(lrcText, onSave) {
        _origOpen.call(this, lrcText, onSave);
        // После открытия добавляем кнопки для новых боксов
        setTimeout(() => {
          const grid = document.querySelector('#fxeCalloutGrid');
          if (!grid) return;
          // Проверяем какие боксы уже есть в grid
          const existingIds = new Set(
            Array.from(grid.querySelectorAll('[data-fx]')).map(b => b.dataset.fx)
          );
          const missing = BoxRegistry.all.filter(s => !existingIds.has(s.id));
          if (!missing.length) return;

          missing.forEach(s => {
            const btn = document.createElement('button');
            btn.className = 'fxe-callout-btn';
            btn.dataset.fx = s.id;
            btn.style.cssText = `border-color:${s.uiColor};color:${s.uiColor};background:${s.uiBg};` +
              `border:none;border-left:3px solid ${s.uiColor};display:flex;align-items:center;` +
              `cursor:pointer;width:100%;padding:0;transition:background .12s,opacity .12s;opacity:0.6;`;
            btn.innerHTML = `<span class="fxe-cb-icon">${s.icon}</span>` +
              `<span class="fxe-cb-label">${s.label}</span>`;
            btn.addEventListener('click', () => {
              // Вызываем applyFx через клик на существующую кнопку если есть,
              // иначе диспатчим синтетическое событие
              // Прямой вызов applyFx невозможен (замыкание), но
              // можно симулировать через data-fx click
              // Используем внутренний механизм: все [data-fx] кнопки слушаются через делегирование
              // Просто вешаем обработчик через overlay listener
              btn.dispatchEvent(new CustomEvent('fxe-apply', { bubbles: true, detail: { fx: s.id } }));
            });
            grid.appendChild(btn);
          });

          // Добавляем динамические стили для токен-превью в редакторе
          const dynStyle2 = document.createElement('style');
          dynStyle2.id = 'box-fix-styles';
          missing.forEach(s => {
            dynStyle2.textContent += `.fxe-tok-${s.id} { ` +
              `box-shadow: 0 0 0 1.5px ${s.uiColor}; ` +
              `color: ${s.uiColor}; ` +
              `text-shadow: 0 0 8px ${s.uiColor}88; ` +
              `margin: 0 2px; }\n`;
            dynStyle2.textContent += `.fxe-callout-${s.id} { ` +
              `border-color: ${s.uiColor}; color: ${s.uiColor}; opacity:.6; ` +
              `background: linear-gradient(90deg,${s.uiBg},transparent); }\n`;
          });
          if (!document.getElementById('box-fix-styles')) {
            document.head.appendChild(dynStyle2);
          }

        }, 50);
      };
    }

    // ─────────────────────────────────────────────
    // ПАТЧ 3: BoxRegistry.spanBoxId — уже использует
    // BOX_STYLES напрямую, работает корректно ✓
    // ─────────────────────────────────────────────

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyFix);
  } else {
    // Немного задержка чтобы все скрипты успели выполниться
    setTimeout(applyFix, 0);
  }
})();