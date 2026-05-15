/* ═══════════════════════════════════════════════
   BoxStyles.js  v5.5 — LYRIC VIDEO TOOLKIT

   v5.5: оба opening-бокса теперь НЕ прямоугольники.
     • ВСТУПЛЕНИЕ — асимметричный octagon (pennant),
       верхние срезы 30%, нижние 12%. Все декор-элементы
       привязаны к контуру формы.
     • АВГУРИЯ — vesica piscis (миндалевидная линза,
       пересечение двух окружностей). Звёзды и астролябия
       clip'нуты по форме. Острые концы слева/справа.

   v5.4 (сохранено): убран хардкод-текст «PROLOGUE».
   v5.3 (сохранено): жёсткий padding + уменьшенная
     выступающая геометрия у всех рамок, кавычка цитаты
     теперь маленькая в углу.
   • `col` игнорируется — каждая рамка своим цветом.

   17 рамок в UI:
     [БЕЗ РАМКИ]
     // opening · 2  → ВСТУПЛЕНИЕ (gold pennant)
                     → АВГУРИЯ    (silver vesica piscis)
     // clean · 10   → СУБТИТР, НИЖН.ТРЕТЬ, ПЛАШКА, МАРКЕР,
                       ЛЕНТА, ПОДПИСЬ, ЦИТАТА, ПОДЧЁРК,
                       БЕГ.СТРОКА, ХЛОПУШКА
     // sci-fi · 5   → ГЕКСАГОН, СТЕЛС, СЛЭШ, ШЕВРОН, ПРИЦЕЛ
═══════════════════════════════════════════════ */

/* ── helpers ─────────────────────────────────── */
function _rect(ctx, x, y, w, h, r = 0) {
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (r === 0) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function _hexPath(ctx, bx, by, bw, bh, ins) {
  ctx.beginPath();
  ctx.moveTo(bx + ins, by);
  ctx.lineTo(bx + bw - ins, by);
  ctx.lineTo(bx + bw, by + bh / 2);
  ctx.lineTo(bx + bw - ins, by + bh);
  ctx.lineTo(bx + ins, by + bh);
  ctx.lineTo(bx, by + bh / 2);
  ctx.closePath();
}

function _octPath(ctx, bx, by, bw, bh, cut) {
  ctx.beginPath();
  ctx.moveTo(bx + cut, by);
  ctx.lineTo(bx + bw - cut, by);
  ctx.lineTo(bx + bw, by + cut);
  ctx.lineTo(bx + bw, by + bh - cut);
  ctx.lineTo(bx + bw - cut, by + bh);
  ctx.lineTo(bx + cut, by + bh);
  ctx.lineTo(bx, by + bh - cut);
  ctx.lineTo(bx, by + cut);
  ctx.closePath();
}

/* ── styles ──────────────────────────────────── */
const BOX_STYLES = [

  /* ═════════════════ OPENING ══════════════════ */

  /* 0a. ВСТУПЛЕНИЕ — GOLD ART-DECO PENNANT (octagon-форма).
     v5.5: ФОРМА, не прямоугольник. Вытянутый восьмиугольник
     с асимметричными срезами (верх шире низа) — visual pennant.
     Все элементы привязаны к контуру формы. */
  {
    id: 'boxintro', label: 'ВСТУПЛЕНИЕ', icon: '✦',
    uiColor: '#d4af37', uiBg: 'rgba(212,175,55,.1)',
    padMultiplier: 2.0,
    draw(ctx, bx, by, bw, bh, col, t) {
      const GOLD     = '#d4af37';
      const GOLD_HOT = '#f5d67a';
      const tm = t || 0;
      const cx = bx + bw / 2;

      // Octagon с асимметричными срезами: верх шире (pennant)
      const cutTopX = bw * 0.15;
      const cutBotX = bw * 0.06;
      const cutTopY = bh * 0.28;
      const cutBotY = bh * 0.2;
      const pts = [
        [bx + cutTopX,          by],
        [bx + bw - cutTopX,     by],
        [bx + bw,               by + cutTopY],
        [bx + bw,               by + bh - cutBotY],
        [bx + bw - cutBotX,     by + bh],
        [bx + cutBotX,          by + bh],
        [bx,                    by + bh - cutBotY],
        [bx,                    by + cutTopY],
      ];
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
      };

      // 1. Fill — radial dark gold-ish gradient
      path();
      const rg = ctx.createRadialGradient(cx, by + bh / 2, 0, cx, by + bh / 2, Math.max(bw, bh) * 0.6);
      rg.addColorStop(0,    'rgba(16, 10, 3, 0.94)');
      rg.addColorStop(0.75, 'rgba(8,  5, 1, 0.88)');
      rg.addColorStop(1,    'rgba(2,  1, 0, 0.78)');
      ctx.fillStyle = rg;
      ctx.fill();

      // 2. Золотой бордер ПО ФОРМЕ
      path();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.92;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 3. Внутренний hairline — scaled копия контура
      ctx.save();
      ctx.translate(cx, by + bh / 2);
      ctx.scale((bw - 8) / bw, (bh - 8) / bh);
      ctx.translate(-cx, -(by + bh / 2));
      path();
      ctx.restore();
      ctx.strokeStyle = 'rgba(245,214,122,0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 4. Diamond-медальоны в серединах диагональных срезов (4 шт)
      const diamondAt = (p1, p2, size) => {
        const mx = (p1[0] + p2[0]) / 2;
        const my = (p1[1] + p2[1]) / 2;
        ctx.beginPath();
        ctx.moveTo(mx, my - size);
        ctx.lineTo(mx + size, my);
        ctx.lineTo(mx, my + size);
        ctx.lineTo(mx - size, my);
        ctx.closePath();
        ctx.fill();
      };
      ctx.fillStyle = GOLD;
      const dSize = 3;
      diamondAt(pts[1], pts[2], dSize);
      diamondAt(pts[3], pts[4], dSize);
      diamondAt(pts[5], pts[6], dSize);
      diamondAt(pts[7], pts[0], dSize);

      // 5. Art-deco hairline-рулы с diamond-медальонами в центре
      const ruleInset = bw * 0.22;
      const ruleY1 = by + bh * 0.24;
      const ruleY2 = by + bh * 0.76;
      const gh = 6;
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(bx + ruleInset, ruleY1);        ctx.lineTo(cx - gh, ruleY1);
      ctx.moveTo(cx + gh, ruleY1);               ctx.lineTo(bx + bw - ruleInset, ruleY1);
      ctx.moveTo(bx + ruleInset, ruleY2);        ctx.lineTo(cx - gh, ruleY2);
      ctx.moveTo(cx + gh, ruleY2);               ctx.lineTo(bx + bw - ruleInset, ruleY2);
      ctx.stroke();
      ctx.fillStyle = GOLD;
      [ruleY1, ruleY2].forEach(ry => {
        ctx.beginPath();
        ctx.moveTo(cx, ry - 3); ctx.lineTo(cx + 3, ry);
        ctx.lineTo(cx, ry + 3); ctx.lineTo(cx - 3, ry);
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // 6. Shimmer (clip по форме)
      ctx.save();
      path();
      ctx.clip();
      const period = 5.5;
      const phase  = (tm % period) / period;
      const swW    = bw * 0.25;
      const swX    = bx - swW + (bw + swW * 2) * phase;
      const sg = ctx.createLinearGradient(swX, by, swX + swW, by);
      sg.addColorStop(0,    'rgba(212,175,55,0)');
      sg.addColorStop(0.5,  'rgba(245,214,122,0.12)');
      sg.addColorStop(1,    'rgba(212,175,55,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(bx, by, bw, bh);
      ctx.restore();

      // 7. Edge pulse по форме
      const pulse = 0.5 + 0.5 * Math.sin(tm * 1.4);
      path();
      ctx.strokeStyle = GOLD_HOT;
      ctx.lineWidth = 0.6;
      ctx.globalAlpha = 0.18 + pulse * 0.22;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },

  /* 0b. АВГУРИЯ — SILVER VESICA PISCIS (миндалевидная линза).
     v5.5: ФОРМА vesica piscis — пересечение двух окружностей,
     горизонтально вытянутая линза с острыми концами. Звёзды
     и астролябия clip'нуты по контуру формы. */
  {
    id: 'boxaugury', label: 'АВГУРИЯ', icon: '✴',
    uiColor: '#b8c4ff', uiBg: 'rgba(184,196,255,.08)',
    padMultiplier: 2.3,
    draw(ctx, bx, by, bw, bh, col, t) {
      const SILVER     = '#d8e4ff';
      const SILVER_DIM = 'rgba(216,228,255,0.42)';
      const CYAN       = '#8dc4ff';
      const tm = t || 0;
      const cx = bx + bw / 2;
      const cy = by + bh / 2;

      // Vesica piscis: два круга, пересечение = линза bw×bh.
      //   a = полу-ширина линзы; b = полу-высота.
      //   Радиус окружности R такой, что линза точно вписана:
      //     R = (a² + b²) / (2a)
      //   Центры окружностей смещены на ±d = R - a по X.
      const a = bw / 2;
      const b = bh / 2;
      const R = (a * a + b * b) / (2 * a);
      const d = R - a;

      // Форма: верхняя дуга (от левого круга, центр cx-d) +
      //        нижняя дуга (от правого круга, центр cx+d).
      const path = () => {
        ctx.beginPath();
        const segs = 42;
        // Верхняя граница слева направо — верхняя полудуга ЛЕВОГО круга.
        for (let i = 0; i <= segs; i++) {
          const tp = i / segs;
          const x = cx - a + bw * tp;
          const dx = x - (cx - d);
          const disc = R * R - dx * dx;
          const y = cy - Math.sqrt(Math.max(0, disc));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        // Нижняя граница справа налево — нижняя полудуга ПРАВОГО круга.
        for (let i = segs; i >= 0; i--) {
          const tp = i / segs;
          const x = cx - a + bw * tp;
          const dx = x - (cx + d);
          const disc = R * R - dx * dx;
          const y = cy + Math.sqrt(Math.max(0, disc));
          ctx.lineTo(x, y);
        }
        ctx.closePath();
      };

      // 1. Заливка формы — deep space radial
      path();
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(bw, bh) * 0.6);
      bg.addColorStop(0,   'rgba(26, 10, 46, 0.95)');
      bg.addColorStop(0.6, 'rgba(10,  4, 22, 0.92)');
      bg.addColorStop(1,   'rgba(0,   0,  0, 0.85)');
      ctx.fillStyle = bg;
      ctx.fill();

      // 2. Clip для звёзд/астролябии
      ctx.save();
      path();
      ctx.clip();

      // Star field
      const hashR = (n) => {
        const s = Math.sin(n * 12.9898) * 43758.5453;
        return s - Math.floor(s);
      };
      ctx.fillStyle = SILVER;
      for (let i = 0; i < 36; i++) {
        const sx = bx + hashR(i * 7.1 + 1) * bw;
        const sy = by + hashR(i * 7.1 + 2) * bh;
        const phase = hashR(i * 7.1 + 3) * 10;
        const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(tm * 1.8 + phase));
        const rad = 0.5 + hashR(i * 7.1 + 4) * 1.3;
        ctx.globalAlpha = twinkle * 0.72;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Astrolabe (rotating)
      const sigilR = Math.min(bw * 0.2, bh * 0.35);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tm * 0.1);
      ctx.strokeStyle = SILVER_DIM;
      ctx.lineWidth = 0.75;
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(0, 0, sigilR,         0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, sigilR * 0.68,  0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
      for (let a2 = 0; a2 < 12; a2++) {
        const ang = (a2 / 12) * Math.PI * 2 - Math.PI / 2;
        const tickLen = a2 % 3 === 0 ? 5 : 2.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * sigilR,             Math.sin(ang) * sigilR);
        ctx.lineTo(Math.cos(ang) * (sigilR + tickLen), Math.sin(ang) * (sigilR + tickLen));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      ctx.restore(); // end clip

      // 3. Серебряный бордер по vesica-контуру
      path();
      ctx.strokeStyle = SILVER;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.88;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 4. Diamond-маркеры на острых концах
      ctx.fillStyle = SILVER;
      const tipS = 3.5;
      [[bx, cy], [bx + bw, cy]].forEach(([px, py]) => {
        ctx.beginPath();
        ctx.moveTo(px, py - tipS);
        ctx.lineTo(px + tipS, py);
        ctx.lineTo(px, py + tipS);
        ctx.lineTo(px - tipS, py);
        ctx.closePath();
        ctx.fill();
      });

      // 5. Внутренний hairline — scaled копия формы
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(0.93, 0.88);
      ctx.translate(-cx, -cy);
      path();
      ctx.restore();
      ctx.strokeStyle = 'rgba(141,196,255,0.32)';
      ctx.lineWidth = 0.75;
      ctx.stroke();

      // 6. Cyan glow pulse — внешний по форме
      const pulse = 0.5 + 0.5 * Math.sin(tm * 1.2);
      path();
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.08 + pulse * 0.14;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },

  /* ═════════════════ CLEAN ═════════════════════ */

  /* 1. СУБТИТР — Netflix caption. Dark + тонкий хайлайт. */
  {
    id: 'boxsub', label: 'СУБТИТР', icon: '▬',
    uiColor: '#e6e6e6', uiBg: 'rgba(255,255,255,.05)',
    padMultiplier: 1.35,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const r = Math.max(4, bh * 0.12);
      ctx.shadowColor  = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur   = 14;
      ctx.shadowOffsetY = 3;
      _rect(ctx, bx, by, bw, bh, r);
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0; ctx.shadowOffsetY = 0;
      _rect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, Math.max(0, r - 0.5));
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  },

  /* 2. НИЖНЯЯ ТРЕТЬ — broadcast lower third */
  {
    id: 'boxthird', label: 'НИЖН.ТРЕТЬ', icon: '▮',
    uiColor: '#e8ff00', uiBg: 'rgba(232,255,0,.09)',
    padMultiplier: 1.4,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const ACCENT = '#e8ff00';
      const barW = Math.max(4, bh * 0.08);
      const subH = Math.max(2, bh * 0.07);
      ctx.fillStyle = 'rgba(16,16,16,0.94)';
      ctx.fillRect(bx + barW, by, bw - barW, bh - subH);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(bx + barW, by + bh - subH, bw - barW, subH);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(bx, by, barW, bh);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(bx + barW + 7, by + 7, 3, 3);
    }
  },

  /* 3. ПЛАШКА — ribbon c маленькой V-насечкой.
     notch уменьшена 0.10 → 0.08 bh. */
  {
    id: 'box', label: 'ПЛАШКА', icon: '❖',
    uiColor: '#e8ff00', uiBg: 'rgba(232,255,0,.18)',
    padMultiplier: 1.5,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const FILL   = '#e8ff00';
      const notchH = bh * 0.08;
      const notchW = Math.min(bh * 0.2, bw * 0.05);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + bw, by);
        ctx.lineTo(bx + bw, by + bh);
        ctx.lineTo(bx + bw / 2 + notchW, by + bh);
        ctx.lineTo(bx + bw / 2,          by + bh - notchH);
        ctx.lineTo(bx + bw / 2 - notchW, by + bh);
        ctx.lineTo(bx, by + bh);
        ctx.closePath();
      };
      const off = Math.max(2, bh * 0.06);
      ctx.save();
      ctx.translate(off, off);
      path();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.restore();
      path();
      ctx.fillStyle = FILL;
      ctx.fill();
      const g = ctx.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0,    'rgba(255,255,255,0.22)');
      g.addColorStop(0.35, 'rgba(255,255,255,0)');
      g.addColorStop(1,    'rgba(0,0,0,0.15)');
      path();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + 1, by + 1);
      ctx.lineTo(bx + bw - 1, by + 1);
      ctx.stroke();
    }
  },

  /* 4. МАРКЕР — жёлтый highlighter */
  {
    id: 'boxmark', label: 'МАРКЕР', icon: '▧',
    uiColor: '#ffee00', uiBg: 'rgba(255,238,0,.22)',
    padMultiplier: 1.3,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const HL   = '#fff200';
      const pad  = bh * 0.1;
      const segs = 18;
      const amp  = 1.4;
      const ext  = 3;
      ctx.beginPath();
      ctx.moveTo(bx - ext, by + pad);
      for (let i = 0; i <= segs; i++) {
        const x  = bx - ext + (bw + ext * 2) * (i / segs);
        const wy = by + pad + Math.sin(i * 1.2) * amp;
        ctx.lineTo(x, wy);
      }
      ctx.lineTo(bx + bw + ext, by + bh - pad);
      for (let i = segs; i >= 0; i--) {
        const x  = bx - ext + (bw + ext * 2) * (i / segs);
        const wy = by + bh - pad + Math.sin(i * 1.6 + 2) * amp;
        ctx.lineTo(x, wy);
      }
      ctx.closePath();
      ctx.fillStyle = HL;
      ctx.globalAlpha = 0.78;
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000';
      ctx.fillRect(bx - ext + 1, by + pad + 0.5,      bw + ext * 2 - 2, 1.2);
      ctx.fillRect(bx - ext + 1, by + bh - pad - 1.7, bw + ext * 2 - 2, 1.2);
      ctx.globalAlpha = 1;
    }
  },

  /* 5. ЛЕНТА — gaffer tape */
  {
    id: 'boxtape', label: 'ЛЕНТА', icon: '▰',
    uiColor: '#f4d400', uiBg: 'rgba(244,212,0,.18)',
    padMultiplier: 1.35,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const TAPE = '#f4d83e';
      ctx.translate(bx + bw / 2, by + bh / 2);
      ctx.rotate(-0.012);
      ctx.translate(-(bw / 2), -(bh / 2));
      ctx.shadowColor  = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur   = 8;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = TAPE;
      ctx.globalAlpha = 0.86;
      ctx.fillRect(0, 0, bw, bh);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let y = bh * 0.22; y < bh; y += bh * 0.28) {
        ctx.fillRect(2, y, bw - 4, 0.75);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(0, 0, bw, 1);
    }
  },

  /* 6. ПОДПИСЬ — editorial thin rule */
  {
    id: 'boxcaption', label: 'ПОДПИСЬ', icon: '⎯',
    uiColor: '#cccccc', uiBg: 'rgba(255,255,255,.03)',
    padMultiplier: 1.3,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const ACCENT = '#d4d4d4';
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.06, by + bh - 1);
      ctx.lineTo(bx + bw * 0.94, by + bh - 1);
      ctx.stroke();
      const tick = Math.min(bw, bh) * 0.09;
      const o = 2;
      ctx.beginPath();
      ctx.moveTo(bx - o, by + tick);
      ctx.lineTo(bx - o, by - o);
      ctx.lineTo(bx + tick, by - o);
      ctx.moveTo(bx + bw - tick, by - o);
      ctx.lineTo(bx + bw + o, by - o);
      ctx.lineTo(bx + bw + o, by + tick);
      ctx.stroke();
    }
  },

  /* 7. ЦИТАТА — left-rule + SMALL кавычка в углу (не лезет в текст).
     v5.3: размер кавычки 0.5 → 0.28 bh, спозиционирована в TL. */
  {
    id: 'boxquote', label: 'ЦИТАТА', icon: '❝',
    uiColor: '#ffffff', uiBg: 'rgba(255,255,255,.05)',
    padMultiplier: 1.45,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const ACCENT = '#ffffff';
      const barW   = Math.max(3, bh * 0.045);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(bx, by, barW, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(bx + barW, by, bw - barW, bh);
      // Небольшая кавычка в верхнем левом углу — не перекрывает текст
      const size = bh * 0.28;
      ctx.fillStyle = ACCENT;
      ctx.globalAlpha = 0.35;
      ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
      ctx.textBaseline = 'top';
      ctx.fillText('\u201C', bx + barW + 4, by + 2);
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic';
    }
  },

  /* 8. ПОДЧЁРК — bold underline */
  {
    id: 'boxunderline', label: 'ПОДЧЁРК', icon: '▁',
    uiColor: '#00e5ff', uiBg: 'rgba(0,229,255,.12)',
    padMultiplier: 1.2,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const ACCENT = '#00e5ff';
      const h = Math.max(3, bh * 0.07);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(bx, by + bh - h, bw, h);
      const sw = h * 1.2;
      ctx.fillRect(bx, by + bh - h * 2.2, sw, sw);
      ctx.fillRect(bx + bw - sw, by + bh - h * 2.2, sw, sw);
    }
  },

  /* 9. БЕГ.СТРОКА — news ticker */
  {
    id: 'boxticker', label: 'БЕГ.СТРОКА', icon: '≡',
    uiColor: '#ff2d55', uiBg: 'rgba(255,45,85,.11)',
    padMultiplier: 1.45,
    draw(ctx, bx, by, bw, bh, col, t) {
      const ACCENT = '#ff2d55';
      ctx.fillStyle = 'rgba(10,10,10,0.88)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(bx, by,            bw, 1.5);
      ctx.fillRect(bx, by + bh - 1.5, bw, 1.5);
      const dashLen = 12, gap = 6;
      const period = dashLen + gap;
      const shift = ((t || 0) * 38) % period;
      ctx.fillStyle = ACCENT;
      ctx.globalAlpha = 0.25;
      const y = by + bh - 5;
      for (let x = bx - shift; x < bx + bw; x += period) {
        const x0 = Math.max(x, bx);
        const x1 = Math.min(x + dashLen, bx + bw);
        if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1);
      }
      ctx.globalAlpha = 1;
      const blink = Math.sin((t || 0) * 4) > 0 ? 1 : 0.35;
      ctx.fillStyle = ACCENT;
      ctx.globalAlpha = blink;
      ctx.beginPath();
      ctx.arc(bx + 9, by + 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  /* 10. ХЛОПУШКА — cinematic slate */
  {
    id: 'boxslate', label: 'ХЛОПУШКА', icon: '⌖',
    uiColor: '#e8e8e8', uiBg: 'rgba(255,255,255,.04)',
    padMultiplier: 1.45,
    draw(ctx, bx, by, bw, bh, col, t) {
      const ACCENT = '#eaeaea';
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.75;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.globalAlpha = 1;
      const cs = Math.min(bw, bh) * 0.09;
      const o  = 3;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - o, by + cs);           ctx.lineTo(bx - o, by - o);           ctx.lineTo(bx + cs, by - o);
      ctx.moveTo(bx + bw - cs, by - o);      ctx.lineTo(bx + bw + o, by - o);      ctx.lineTo(bx + bw + o, by + cs);
      ctx.moveTo(bx - o, by + bh - cs);      ctx.lineTo(bx - o, by + bh + o);      ctx.lineTo(bx + cs, by + bh + o);
      ctx.moveTo(bx + bw - cs, by + bh + o); ctx.lineTo(bx + bw + o, by + bh + o); ctx.lineTo(bx + bw + o, by + bh - cs);
      ctx.stroke();
      ctx.fillStyle = ACCENT;
      ctx.globalAlpha = 0.5;
      ctx.font = '9px "Space Mono", monospace';
      ctx.textBaseline = 'top';
      const tm = t || 0;
      const mm = String(Math.floor(tm / 60)).padStart(2, '0');
      const ss = String(Math.floor(tm % 60)).padStart(2, '0');
      const ff = String(Math.floor((tm % 1) * 24)).padStart(2, '0');
      ctx.fillText(`${mm}:${ss}:${ff}`, bx + 7, by + 5);
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic';
    }
  },

  /* ═════════════════ SCI-FI ════════════════════ */

  /* 11. ГЕКСАГОН — ins уменьшен 0.20 → 0.15, padMult 1.65 */
  {
    id: 'boxhex', label: 'ГЕКСАГОН', icon: '⬡',
    uiColor: '#00e5ff', uiBg: 'rgba(0,229,255,.08)',
    padMultiplier: 1.65,
    draw(ctx, bx, by, bw, bh, col, t) {
      const ACCENT = '#00e5ff';
      const ins = bh * 0.15;
      _hexPath(ctx, bx, by, bw, bh, ins);
      const g = ctx.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0, 'rgba(0, 40, 55, 0.55)');
      g.addColorStop(1, 'rgba(0, 15, 25, 0.72)');
      ctx.fillStyle = g;
      ctx.fill();
      _hexPath(ctx, bx, by, bw, bh, ins);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const tm = t || 0;
      const pulse = 0.5 + 0.5 * Math.sin(tm * 2.5);
      const pts = [
        [bx + ins, by], [bx + bw - ins, by],
        [bx + bw, by + bh / 2],
        [bx + bw - ins, by + bh], [bx + ins, by + bh],
        [bx, by + bh / 2],
      ];
      ctx.fillStyle = ACCENT;
      pts.forEach(([x, y]) => {
        ctx.globalAlpha = 0.5 + pulse * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, 2 + pulse * 0.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
  },

  /* 12. СТЕЛС — cut 0.15 → 0.12 */
  {
    id: 'boxstealth', label: 'СТЕЛС', icon: '⬢',
    uiColor: '#b14fff', uiBg: 'rgba(177,79,255,.1)',
    padMultiplier: 1.4,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const ACCENT = '#b14fff';
      const cut = Math.min(bw, bh) * 0.12;
      _octPath(ctx, bx, by, bw, bh, cut);
      ctx.fillStyle = 'rgba(15, 6, 25, 0.9)';
      ctx.fill();
      _octPath(ctx, bx, by, bw, bh, cut);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      const ii = 3;
      _octPath(ctx, bx + ii, by + ii, bw - ii * 2, bh - ii * 2, Math.max(1, cut - ii));
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = ACCENT;
      const markers = [
        [bx + cut / 2 + 1, by + cut / 2 + 1],
        [bx + bw - cut / 2 - 1, by + cut / 2 + 1],
        [bx + bw - cut / 2 - 1, by + bh - cut / 2 - 1],
        [bx + cut / 2 + 1, by + bh - cut / 2 - 1],
      ];
      markers.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  },

  /* 13. СЛЭШ — slant 0.18 → 0.15 */
  {
    id: 'boxslash', label: 'СЛЭШ', icon: '▱',
    uiColor: '#ff2d55', uiBg: 'rgba(255,45,85,.1)',
    padMultiplier: 1.5,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const ACCENT = '#ff2d55';
      const slant = bh * 0.15;
      ctx.beginPath();
      ctx.moveTo(bx + slant, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw - slant, by + bh);
      ctx.lineTo(bx, by + bh);
      ctx.closePath();
      const g = ctx.createLinearGradient(bx, by, bx + bw, by);
      g.addColorStop(0, 'rgba(25, 8, 15, 0.92)');
      g.addColorStop(1, 'rgba(45, 12, 25, 0.88)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const stripeW = 4;
      ctx.beginPath();
      ctx.moveTo(bx + slant,           by);
      ctx.lineTo(bx + slant + stripeW, by);
      ctx.lineTo(bx + stripeW,         by + bh);
      ctx.lineTo(bx,                   by + bh);
      ctx.closePath();
      ctx.fillStyle = ACCENT;
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.22;
      for (let i = 1; i <= 3; i++) {
        const offset = (bw / 4) * i;
        ctx.beginPath();
        ctx.moveTo(bx + slant + offset,      by + bh * 0.25);
        ctx.lineTo(bx + slant + offset - 10, by + bh * 0.75);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  },

  /* 14. ШЕВРОН — tip значительно уменьшен, padMult 1.6 */
  {
    id: 'boxchevron', label: 'ШЕВРОН', icon: '▶',
    uiColor: '#00ff87', uiBg: 'rgba(0,255,135,.1)',
    padMultiplier: 1.6,
    draw(ctx, bx, by, bw, bh /*, col, t */) {
      const ACCENT = '#00ff87';
      const tip = Math.min(bh * 0.25, bw * 0.06);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + bw - tip, by);
        ctx.lineTo(bx + bw, by + bh / 2);
        ctx.lineTo(bx + bw - tip, by + bh);
        ctx.lineTo(bx, by + bh);
        ctx.closePath();
      };
      path();
      ctx.fillStyle = 'rgba(5, 25, 15, 0.92)';
      ctx.fill();
      path();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const pad = 4;
      ctx.beginPath();
      ctx.moveTo(bx + pad, by + pad);
      ctx.lineTo(bx + bw - tip - pad * 0.6, by + pad);
      ctx.lineTo(bx + bw - pad * 1.5, by + bh / 2);
      ctx.lineTo(bx + bw - tip - pad * 0.6, by + bh - pad);
      ctx.lineTo(bx + pad, by + bh - pad);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(bx + 4, by + bh * 0.25); ctx.lineTo(bx + 4, by + bh * 0.75);
      ctx.moveTo(bx + 7, by + bh * 0.3);  ctx.lineTo(bx + 7, by + bh * 0.7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },

  /* 15. ПРИЦЕЛ — HUD brackets */
  {
    id: 'boxreticle', label: 'ПРИЦЕЛ', icon: '⊕',
    uiColor: '#00e5ff', uiBg: 'rgba(0,229,255,.08)',
    padMultiplier: 1.35,
    draw(ctx, bx, by, bw, bh, col, t) {
      const ACCENT = '#00e5ff';
      ctx.fillStyle = 'rgba(0, 30, 40, 0.28)';
      ctx.fillRect(bx, by, bw, bh);
      const cs = Math.min(bw, bh) * 0.2;
      const o  = 2;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - o, by + cs);           ctx.lineTo(bx - o, by - o);           ctx.lineTo(bx + cs, by - o);
      ctx.moveTo(bx + bw - cs, by - o);      ctx.lineTo(bx + bw + o, by - o);      ctx.lineTo(bx + bw + o, by + cs);
      ctx.moveTo(bx - o, by + bh - cs);      ctx.lineTo(bx - o, by + bh + o);      ctx.lineTo(bx + cs, by + bh + o);
      ctx.moveTo(bx + bw - cs, by + bh + o); ctx.lineTo(bx + bw + o, by + bh + o); ctx.lineTo(bx + bw + o, by + bh - cs);
      ctx.stroke();
      ctx.lineWidth = 1;
      const mx = bx + bw / 2;
      const my = by + bh / 2;
      ctx.beginPath();
      ctx.moveTo(mx, by - o - 2);        ctx.lineTo(mx, by - o - 7);
      ctx.moveTo(mx, by + bh + o + 2);   ctx.lineTo(mx, by + bh + o + 7);
      ctx.moveTo(bx - o - 2, my);        ctx.lineTo(bx - o - 7, my);
      ctx.moveTo(bx + bw + o + 2, my);   ctx.lineTo(bx + bw + o + 7, my);
      ctx.stroke();
      const tm = t || 0;
      const pulse = 0.5 + 0.5 * Math.sin(tm * 3);
      const r = 2 + pulse * 0.8;
      ctx.fillStyle = ACCENT;
      [[bx - o, by - o], [bx + bw + o, by - o], [bx - o, by + bh + o], [bx + bw + o, by + bh + o]]
        .forEach(([x, y]) => {
          ctx.globalAlpha = 0.45 + pulse * 0.55;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        });
      ctx.globalAlpha = 1;
    }
  },

  /* 16. КВАНТУМ — Quantum tunnel portal.
     Рамка с эффектом квантового туннеля: плазменный контур по кривым
     Лиссажу, орбитальные кольца с частицами, внутренние glitch-сканлайны
     и пульсирующее ядро. Всё clip'нуто по прямоугольнику со скруглением. */
  {
    id: 'boxquantum', label: 'КВАНТУМ', icon: '⟨⟩',
    uiColor: '#39ff14', uiBg: 'rgba(57,255,20,.08)',
    padMultiplier: 1.55,
    draw(ctx, bx, by, bw, bh, col, t) {
      const tm    = t || 0;
      const cx    = bx + bw / 2;
      const cy    = by + bh / 2;
      const r     = Math.max(6, Math.min(bw, bh) * 0.06);
      const NEON  = '#39ff14';
      const PLASMA= '#00ffe0';
      const HOT   = '#ccff00';

      // helper: rounded rect path
      const rr = () => _rect(ctx, bx, by, bw, bh, r);

      // 1. Deep void fill
      rr();
      const vg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(bw, bh) * 0.7);
      vg.addColorStop(0,   'rgba(0, 18, 6, 0.97)');
      vg.addColorStop(0.5, 'rgba(0,  8, 3, 0.96)');
      vg.addColorStop(1,   'rgba(0,  0, 0, 0.92)');
      ctx.fillStyle = vg;
      ctx.fill();

      // 2. Glitch scanlines (clip to box)
      ctx.save();
      rr(); ctx.clip();
      ctx.fillStyle = 'rgba(57,255,20,0.028)';
      const lineStep = Math.max(3, bh * 0.045);
      for (let ly = by; ly < by + bh; ly += lineStep) {
        ctx.fillRect(bx, ly, bw, 1);
      }
      const glitchY = by + ((tm * 47.3) % bh);
      ctx.fillStyle = 'rgba(57,255,20,0.10)';
      ctx.fillRect(bx, glitchY, bw, 1.5);
      ctx.restore();

      // 3. Lissajous plasma border
      ctx.save();
      rr(); ctx.clip();
      const borderDepth = Math.min(bw, bh) * 0.15;
      const pts = 240;
      const a_f = 3, b_f = 2;
      const delta = tm * 0.55;
      const pulse = 0.5 + 0.5 * Math.sin(tm * 2.1);
      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const angle = (i / pts) * Math.PI * 2;
        const lx  = Math.sin(a_f * angle + delta);
        const ly2 = Math.sin(b_f * angle);
        const px = cx + (bw / 2 - borderDepth * 0.5) * Math.sign(lx) * (0.85 + 0.15 * Math.abs(lx)) + lx * borderDepth * 0.45;
        const py = cy + (bh / 2 - borderDepth * 0.5) * Math.sign(ly2) * (0.85 + 0.15 * Math.abs(ly2)) + ly2 * borderDepth * 0.45;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = PLASMA;
      ctx.lineWidth = 0.9;
      ctx.globalAlpha = 0.35 + pulse * 0.25;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      // 4. Orbital particle rings
      ctx.save();
      rr(); ctx.clip();
      const rings = [
        { rX: bw * 0.42, rY: bh * 0.38, speed:  0.9, count: 12, size: 1.6, color: NEON,   alpha: 0.75 },
        { rX: bw * 0.46, rY: bh * 0.44, speed: -0.55, count:  8, size: 2.2, color: PLASMA, alpha: 0.60 },
      ];
      rings.forEach(ring => {
        for (let i = 0; i < ring.count; i++) {
          const baseAng = (i / ring.count) * Math.PI * 2;
          const ang = baseAng + tm * ring.speed;
          const px = cx + Math.cos(ang) * ring.rX;
          const py = cy + Math.sin(ang) * ring.rY;
          const edgeDist = Math.min(
            Math.abs(px - bx), Math.abs(px - (bx + bw)),
            Math.abs(py - by), Math.abs(py - (by + bh))
          );
          const edgeFactor = Math.max(0, 1 - edgeDist / (Math.min(bw, bh) * 0.2));
          const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tm * 3.1 + baseAng * 2));
          ctx.globalAlpha = ring.alpha * tw;
          ctx.fillStyle = ring.color;
          const sz = ring.size * (1 + edgeFactor * 0.8);
          ctx.beginPath();
          ctx.arc(px, py, sz, 0, Math.PI * 2);
          ctx.fill();
          if (edgeFactor > 0.3) {
            const tx2 = cx + Math.cos(ang - 0.35 * Math.sign(ring.speed)) * ring.rX;
            const ty2 = cy + Math.sin(ang - 0.35 * Math.sign(ring.speed)) * ring.rY;
            const tg = ctx.createLinearGradient(tx2, ty2, px, py);
            tg.addColorStop(0, 'rgba(0,255,224,0)');
            tg.addColorStop(1, ring.color);
            ctx.strokeStyle = tg;
            ctx.lineWidth = sz * 0.8;
            ctx.globalAlpha = ring.alpha * tw * 0.5;
            ctx.beginPath();
            ctx.moveTo(tx2, ty2);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
        }
      });
      ctx.globalAlpha = 1;
      ctx.restore();

      // 5. Neon border glow (wide dim + thin bright)
      rr();
      ctx.strokeStyle = NEON;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.12 + pulse * 0.08;
      ctx.stroke();
      rr();
      ctx.strokeStyle = HOT;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.82;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 6. Corner quantum brackets
      const cs = Math.min(bw, bh) * 0.13;
      ctx.strokeStyle = NEON;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(bx,      by + cs);     ctx.lineTo(bx,      by);          ctx.lineTo(bx + cs,      by);
      ctx.moveTo(bx + bw - cs, by);     ctx.lineTo(bx + bw, by);          ctx.lineTo(bx + bw,      by + cs);
      ctx.moveTo(bx,      by + bh - cs);ctx.lineTo(bx,      by + bh);     ctx.lineTo(bx + cs,      by + bh);
      ctx.moveTo(bx + bw - cs, by + bh);ctx.lineTo(bx + bw, by + bh);    ctx.lineTo(bx + bw,      by + bh - cs);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 7. Pulsing quantum core dot
      const coreR = 2.5 + pulse * 2.5;
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 4);
      cg.addColorStop(0,   'rgba(204,255,0,0.35)');
      cg.addColorStop(0.4, 'rgba(57,255,20,0.12)');
      cg.addColorStop(1,   'rgba(57,255,20,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = HOT;
      ctx.globalAlpha = 0.7 + pulse * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

];

/* ── Registry ────────────────────────────────── */
// Старые id рамок (v3–v4), снятые с эксплуатации. Их нужно помнить, чтобы:
//  1) парсер renderers.js / FxEditor.js корректно «съедал» теги из легаси-LRC,
//  2) state-init не ронял `if (k in state)` на ретайредах.
// Единая точка правды — меняй здесь, если что-то снова переименуется.
const RETIRED_BOX_IDS = Object.freeze([
  'boxneon','boxglass','boxshadow','boxrough',
  'boxfire','boxice','boxholo','boxgold','boxcyber','boxrainbow','boxretro',
  'boxaura','boxmatrix','boxsmoke','boxplasma','boxtattoo','boxsunset','boxlacquer',
  'boxcrystal','boxdanger','boxdiamond','boxfault','boxink','boxportal',
  'boxsigil','boxstatic','boxvhs','boxvirus','boxwave','boxwire',
]);

const BoxRegistry = (() => {
  const _map = new Map(BOX_STYLES.map(s => [s.id, s]));
  const OPENING_IDS = new Set(['boxintro', 'boxaugury']);
  const SCIFI_IDS   = new Set(['boxhex','boxstealth','boxslash','boxchevron','boxreticle','boxquantum']);

  function _btn(s) {
    return '<button class="fxe-callout-btn" data-fx="' + s.id + '"' +
      ' style="border-color:' + s.uiColor + ';color:' + s.uiColor + ';background:' + s.uiBg + ';">' +
      '<span class="fxe-cb-icon">' + s.icon + '</span>' +
      '<span class="fxe-cb-label">' + s.label + '</span>' +
      '</button>';
  }

  function _sectionLabel(txt) {
    return '<div style="font-family:\'Space Mono\',monospace;font-size:8px;letter-spacing:2px;' +
      'color:#555;padding:10px 10px 4px;text-transform:uppercase;' +
      'border-top:1px dashed rgba(255,255,255,0.06);margin-top:6px;">' + txt + '</div>';
  }

  return {
    get all()     { return BOX_STYLES; },
    get retired() { return RETIRED_BOX_IDS; },
    get(id)   { return _map.get(id) || null; },

    draw(ctx, span, bx, by, bw, bh, col, t) {
      const id = BoxRegistry.spanBoxId(span);
      if (!id) return;
      const style = _map.get(id);
      if (!style) return;
      ctx.save();
      // col передан для совместимости, но draw() его ИГНОРИРУЕТ —
      // рамки используют свой фиксированный цвет, см. ACCENT/FILL.
      style.draw(ctx, bx, by, bw, bh, col, t);
      ctx.restore();
    },

    spanBoxId(span) {
      for (const s of BOX_STYLES) { if (span[s.id]) return s.id; }
      return null;
    },

    hasBox(span) { return !!BoxRegistry.spanBoxId(span); },

    getActiveStyle(span) {
      const id = BoxRegistry.spanBoxId(span);
      return id ? _map.get(id) : null;
    },

    /* UI layout:
       [БЕЗ РАМКИ] → // opening (1) → // clean (10) → // sci-fi (5) */
    buildButtonsHTML() {
      const none =
        '<button class="fxe-callout-btn fxe-callout-none" data-fx="__none__"' +
        ' style="border-color:#3a3a3a;color:#888;' +
        'background:repeating-linear-gradient(45deg,transparent 0,transparent 4px,rgba(255,255,255,.03) 4px,rgba(255,255,255,.03) 5px);">' +
        '<span class="fxe-cb-icon">⊘</span>' +
        '<span class="fxe-cb-label">БЕЗ РАМКИ</span>' +
        '</button>';
      const opening = BOX_STYLES.filter(s =>  OPENING_IDS.has(s.id)).map(_btn).join('');
      const clean   = BOX_STYLES.filter(s => !OPENING_IDS.has(s.id) && !SCIFI_IDS.has(s.id)).map(_btn).join('');
      const scifi   = BOX_STYLES.filter(s =>  SCIFI_IDS.has(s.id)).map(_btn).join('');
      return none
        + _sectionLabel('// opening')
        + opening
        + _sectionLabel('// clean')
        + clean
        + _sectionLabel('// sci-fi')
        + scifi;
    },
  };
})();