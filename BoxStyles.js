/* ═══════════════════════════════════════════════
   BoxStyles.js  v4 — РАЗНЫЕ ФОРМЫ + БЕЗОПАСНЫЙ ТЕКСТ
   ─────────────────────────────────────────────────
   Каждая форма имеет свой `padMultiplier`, вычисленный
   из её геометрии так, чтобы инскрибированный прямоугольник
   всегда вмещал текст. Декор не лезет в центр — только края,
   углы и выносы наружу bounding-box.

   API стиля:
   { id, label, icon, uiColor, uiBg, padMultiplier?, draw(ctx,bx,by,bw,bh,col,t) }
   bx,by = верхний-левый угол bounding-box
   bw,bh = размеры bounding-box (уже с учётом padMultiplier)
   col   = цвет текста
   t     = время (секунды)
═══════════════════════════════════════════════ */

const _τ = Math.PI * 2;

/* ─────────────────────────────────────────────
   ПРИМИТИВЫ ФОРМ (пути)
───────────────────────────────────────────── */

function _rect(ctx, bx, by, bw, bh, r = 0) {
  r = Math.max(0, Math.min(r, Math.min(bw, bh) / 2));
  ctx.beginPath();
  if (r === 0) { ctx.rect(bx, by, bw, bh); ctx.closePath(); return; }
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
}

function _cut(ctx, bx, by, bw, bh, c) {
  c = Math.max(0, Math.min(c, Math.min(bw, bh) / 2.2));
  ctx.beginPath();
  ctx.moveTo(bx + c, by);
  ctx.lineTo(bx + bw - c, by);
  ctx.lineTo(bx + bw, by + c);
  ctx.lineTo(bx + bw, by + bh - c);
  ctx.lineTo(bx + bw - c, by + bh);
  ctx.lineTo(bx + c, by + bh);
  ctx.lineTo(bx, by + bh - c);
  ctx.lineTo(bx, by + c);
  ctx.closePath();
}

function _skew(ctx, bx, by, bw, bh, s) {
  ctx.beginPath();
  ctx.moveTo(bx + s, by);
  ctx.lineTo(bx + bw, by);
  ctx.lineTo(bx + bw - s, by + bh);
  ctx.lineTo(bx, by + bh);
  ctx.closePath();
}

function _fray(ctx, bx, by, bw, bh, jagH, t, seed = 0) {
  const segs = 10;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  for (let i = 0; i <= segs; i++) {
    const x = bx + (bw * i) / segs;
    const j = i % 2 === 1 ? -Math.abs(Math.sin(t * 2 + i * 1.7 + seed)) * jagH : 0;
    ctx.lineTo(x, by + j);
  }
  ctx.lineTo(bx + bw, by + bh);
  for (let i = segs; i >= 0; i--) {
    const x = bx + (bw * i) / segs;
    const j = i % 2 === 1 ? Math.abs(Math.sin(t * 1.7 + i * 2.1 + seed)) * jagH : 0;
    ctx.lineTo(x, by + bh + j);
  }
  ctx.closePath();
}

function _wave(ctx, bx, by, bw, bh, amp, t, freq = 0.06) {
  ctx.beginPath();
  ctx.moveTo(bx, by);
  for (let x = 0; x <= bw; x += 2) {
    const y = Math.sin(x * freq + t * 1.5) * amp;
    ctx.lineTo(bx + x, by + y);
  }
  ctx.lineTo(bx + bw, by + bh);
  for (let x = bw; x >= 0; x -= 2) {
    const y = Math.sin(x * freq - t * 1.5 + 1.5) * amp;
    ctx.lineTo(bx + x, by + bh - y);
  }
  ctx.closePath();
}

function _deckle(ctx, bx, by, bw, bh, amp, t, seed = 0) {
  const rnd = (i) => {
    const s = Math.sin((i + seed) * 12.9898 + t * 0.3) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const segs = 12;
  ctx.beginPath();
  ctx.moveTo(bx + rnd(0) * amp, by + rnd(1) * amp);
  for (let i = 1; i <= segs; i++) {
    ctx.lineTo(bx + (bw * i) / segs + rnd(i * 2) * amp, by + rnd(i * 2 + 1) * amp);
  }
  for (let i = 1; i <= segs; i++) {
    ctx.lineTo(bx + bw + rnd(100 + i * 2) * amp, by + (bh * i) / segs + rnd(100 + i * 2 + 1) * amp);
  }
  for (let i = segs - 1; i >= 0; i--) {
    ctx.lineTo(bx + (bw * i) / segs + rnd(200 + i * 2) * amp, by + bh + rnd(200 + i * 2 + 1) * amp);
  }
  for (let i = segs - 1; i >= 0; i--) {
    ctx.lineTo(bx + rnd(300 + i * 2) * amp, by + (bh * i) / segs + rnd(300 + i * 2 + 1) * amp);
  }
  ctx.closePath();
}

/* ─────────────────────────────────────────────
   АКЦЕНТЫ
───────────────────────────────────────────── */

function _fillSoft(ctx, bx, by, bw, bh, c1, c2) {
  const g = ctx.createLinearGradient(bx, by, bx, by + bh);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fill();
}

function _glow(ctx, col, lw, blur) {
  ctx.strokeStyle = col; ctx.lineWidth = lw;
  ctx.shadowColor = col; ctx.shadowBlur = blur;
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
}

function _brackets(ctx, bx, by, bw, bh, col, len, lw = 1.5, off = 3) {
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'square';
  const x1 = bx - off, y1 = by - off, x2 = bx + bw + off, y2 = by + bh + off;
  ctx.beginPath();
  ctx.moveTo(x1, y1 + len); ctx.lineTo(x1, y1); ctx.lineTo(x1 + len, y1);
  ctx.moveTo(x2 - len, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + len);
  ctx.moveTo(x2, y2 - len); ctx.lineTo(x2, y2); ctx.lineTo(x2 - len, y2);
  ctx.moveTo(x1 + len, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y2 - len);
  ctx.stroke();
}

function _cornerDots(ctx, bx, by, bw, bh, col, r) {
  ctx.fillStyle = col;
  [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]]
    .forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, _τ); ctx.fill(); });
}

function _scanLine(ctx, bx, by, bw, bh, col, t, speed = 0.3) {
  const sy = by + ((t * speed * bh * 2) % bh);
  ctx.save();
  _rect(ctx, bx, by, bw, bh, 0); ctx.clip();
  const g = ctx.createLinearGradient(bx, sy - 3, bx, sy + 3);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, col);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha *= 0.28;
  ctx.fillStyle = g; ctx.fillRect(bx, sy - 3, bw, 6);
  ctx.globalAlpha /= 0.28;
  ctx.restore();
}

function _dashedEdge(ctx, bx, by, bw, bh, col, dash, gap, off, r = 0) {
  ctx.save();
  ctx.setLineDash([dash, gap]); ctx.lineDashOffset = -off;
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  _rect(ctx, bx, by, bw, bh, r); ctx.stroke();
  ctx.restore();
}


/* ═══════════════════════════════════════════════
   BOX_STYLES
═══════════════════════════════════════════════ */
const BOX_STYLES = [

  /* 1. ПРИЦЕЛ — параллелограмм + сканлиния + брекеты снаружи */
  {
    id: 'box', label: 'ПРИЦЕЛ', icon: '⊕',
    uiColor: '#00e5ff', uiBg: 'rgba(0,229,255,.08)',
    padMultiplier: 1.2,
    draw(ctx, bx, by, bw, bh, col, t) {
      const s = bh * 0.14;
      _skew(ctx, bx, by, bw, bh, s);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(0,15,25,0.6)', 'rgba(0,5,15,0.55)');

      _scanLine(ctx, bx + s, by, bw - s * 2, bh, '#00e5ff', t, 0.25);

      _skew(ctx, bx, by, bw, bh, s);
      _glow(ctx, '#00e5ff', 1.5, 10);

      _brackets(ctx, bx, by, bw, bh, '#00e5ff', Math.min(bw, bh) * 0.18, 2, 2);
    }
  },

  /* 2. НЕОН — восьмиугольник с фаской + пульсирующее свечение */
  {
    id: 'boxneon', label: 'НЕОН', icon: '◈',
    uiColor: '#c678ff', uiBg: 'rgba(198,120,255,.08)',
    padMultiplier: 1.15,
    draw(ctx, bx, by, bw, bh, col, t) {
      const p = 0.78 + Math.sin(t * 2.5) * 0.22;
      const c = Math.min(bw, bh) * 0.12;

      _cut(ctx, bx, by, bw, bh, c);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(35,10,55,0.75)', 'rgba(15,5,30,0.75)');

      _cut(ctx, bx, by, bw, bh, c);
      _glow(ctx, '#c678ff', 2.5, 20 * p);

      _cut(ctx, bx + 4, by + 4, bw - 8, bh - 8, Math.max(0, c - 4));
      ctx.strokeStyle = `rgba(255,255,255,${0.3 * p})`;
      ctx.lineWidth = 0.75; ctx.stroke();
    }
  },

  /* 3. СТЕКЛО — скруглённая плашка с глянцевым бликом сверху */
  {
    id: 'boxglass', label: 'СТЕКЛО', icon: '▱',
    uiColor: '#cce8ff', uiBg: 'rgba(200,235,255,.08)',
    draw(ctx, bx, by, bw, bh, col, t) {
      const r = Math.min(bw, bh) * 0.25;
      _rect(ctx, bx, by, bw, bh, r);
      const g = ctx.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0, 'rgba(220,240,255,0.22)');
      g.addColorStop(1, 'rgba(150,195,240,0.14)');
      ctx.fillStyle = g; ctx.fill();

      ctx.save(); _rect(ctx, bx, by, bw, bh, r); ctx.clip();
      const hg = ctx.createLinearGradient(bx, by, bx, by + bh * 0.5);
      hg.addColorStop(0, 'rgba(255,255,255,0.4)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg; ctx.fillRect(bx, by, bw, bh * 0.5);
      ctx.restore();

      _rect(ctx, bx, by, bw, bh, r);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx + r + 3, by + 1.5); ctx.lineTo(bx + bw - r - 3, by + 1.5);
      ctx.stroke();
    }
  },

  /* 4. ХРОМ — металлическая плашка с объёмной тенью (3D-эффект) */
  {
    id: 'boxshadow', label: 'ХРОМ', icon: '◧',
    uiColor: '#cccccc', uiBg: 'rgba(150,150,150,.08)',
    draw(ctx, bx, by, bw, bh, col, t) {
      const d = Math.max(5, bh * 0.11);

      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      _rect(ctx, bx + d, by + d, bw, bh, 2); ctx.fill();

      // Нижняя «грань»
      ctx.beginPath();
      ctx.moveTo(bx, by + bh); ctx.lineTo(bx + d, by + bh + d);
      ctx.lineTo(bx + bw + d, by + bh + d); ctx.lineTo(bx + bw, by + bh);
      ctx.closePath();
      const bg = ctx.createLinearGradient(bx, by + bh, bx, by + bh + d);
      bg.addColorStop(0, 'rgba(45,45,50,0.95)');
      bg.addColorStop(1, 'rgba(15,15,20,0.98)');
      ctx.fillStyle = bg; ctx.fill();

      // Правая «грань»
      ctx.beginPath();
      ctx.moveTo(bx + bw, by); ctx.lineTo(bx + bw + d, by + d);
      ctx.lineTo(bx + bw + d, by + bh + d); ctx.lineTo(bx + bw, by + bh);
      ctx.closePath();
      const rg = ctx.createLinearGradient(bx + bw, by, bx + bw + d, by);
      rg.addColorStop(0, 'rgba(60,60,65,0.92)');
      rg.addColorStop(1, 'rgba(25,25,30,0.96)');
      ctx.fillStyle = rg; ctx.fill();

      // Передняя грань
      _rect(ctx, bx, by, bw, bh, 2);
      const fg = ctx.createLinearGradient(bx, by, bx, by + bh);
      fg.addColorStop(0, 'rgba(85,85,90,0.92)');
      fg.addColorStop(0.5, 'rgba(45,45,50,0.9)');
      fg.addColorStop(1, 'rgba(20,20,25,0.92)');
      ctx.fillStyle = fg; ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(bx + 2, by + 1, bw - 4, 1);

      _rect(ctx, bx, by, bw, bh, 2);
      ctx.strokeStyle = 'rgba(200,200,210,0.85)'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 5. ЛЕНТА — плёнка с перфорацией сверху и снизу + наклонный кадр */
  {
    id: 'boxtape', label: 'ЛЕНТА', icon: '⊟',
    uiColor: '#e8ff00', uiBg: 'rgba(232,255,0,.06)',
    padMultiplier: 1.15,
    draw(ctx, bx, by, bw, bh, col, t) {
      const strip = Math.max(7, bh * 0.22);

      ctx.fillStyle = 'rgba(10,8,5,0.95)';
      ctx.fillRect(bx - 6, by - strip, bw + 12, strip);
      ctx.fillRect(bx - 6, by + bh, bw + 12, strip);

      const holeW = Math.max(5, strip * 0.5);
      const holeH = Math.max(4, strip * 0.4);
      const gap = holeW * 2.6;
      ctx.fillStyle = '#e8ff00';
      ctx.globalAlpha *= 0.8;
      for (let hx = bx; hx < bx + bw - holeW; hx += gap) {
        ctx.beginPath();
        ctx.roundRect(hx + 2, by - strip + (strip - holeH) / 2, holeW, holeH, 1.5);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(hx + 2, by + bh + (strip - holeH) / 2, holeW, holeH, 1.5);
        ctx.fill();
      }
      ctx.globalAlpha /= 0.8;

      const s = bh * 0.05;
      _skew(ctx, bx, by, bw, bh, s);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(22,18,10,0.9)', 'rgba(12,10,6,0.92)');
      _skew(ctx, bx, by, bw, bh, s);
      _glow(ctx, '#e8ff00', 1.5, 6);

      ctx.globalAlpha *= 0.04; ctx.fillStyle = '#fff';
      for (let i = 0; i < 30; i++) {
        ctx.fillRect(
          bx + Math.abs(Math.sin(i * 7.3 + t) * bw),
          by + Math.abs(Math.cos(i * 13.7 + t) * bh), 1.5, 1.5
        );
      }
      ctx.globalAlpha /= 0.04;
    }
  },

  /* 6. МАРКЕР — параллелограмм с неровным маркерным штрихом */
  {
    id: 'boxrough', label: 'МАРКЕР', icon: '⋈',
    uiColor: '#ff9f00', uiBg: 'rgba(255,159,0,.08)',
    padMultiplier: 1.2,
    draw(ctx, bx, by, bw, bh, col, t) {
      const hash = (x) => { const s = Math.sin(x * 12.9898) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
      const s = bh * 0.12;

      _skew(ctx, bx, by, bw, bh, s);
      ctx.fillStyle = '#ff9f00'; ctx.globalAlpha *= 0.1; ctx.fill(); ctx.globalAlpha /= 0.1;

      ctx.strokeStyle = '#ff9f00'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = '#ff9f00'; ctx.shadowBlur = 4;
      for (let pass = 0; pass < 3; pass++) {
        ctx.globalAlpha *= 0.45; ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(bx + s + hash(pass * 7), by + hash(pass * 11));
        ctx.lineTo(bx + bw + hash(pass * 13), by + hash(pass * 17));
        ctx.lineTo(bx + bw - s + hash(pass * 19), by + bh + hash(pass * 23));
        ctx.lineTo(bx + hash(pass * 29), by + bh + hash(pass * 31));
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha /= 0.45;
      }
      ctx.shadowBlur = 0;
    }
  },

  /* 7. ОГОНЬ — плашка с пламенем НАД верхним краем */
  {
    id: 'boxfire', label: 'ОГОНЬ', icon: '🔥',
    uiColor: '#ff5500', uiBg: 'rgba(255,85,0,.08)',
    draw(ctx, bx, by, bw, bh, col, t) {
      const flameH = Math.max(8, bh * 0.45);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const fx = bx + (i / steps) * bw;
        const h = (0.5 + 0.5 * Math.sin(i * 1.1)) *
                  (0.65 + 0.35 * Math.sin(t * 5 + i * 2.3));
        ctx.lineTo(fx, by - h * flameH);
      }
      ctx.lineTo(bx + bw, by);
      ctx.closePath();
      const fg = ctx.createLinearGradient(bx, by, bx, by - flameH);
      fg.addColorStop(0, 'rgba(255,200,0,0.85)');
      fg.addColorStop(0.5, 'rgba(255,70,0,0.55)');
      fg.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = fg; ctx.fill();
      ctx.restore();

      _rect(ctx, bx, by, bw, bh, 2);
      const bg = ctx.createLinearGradient(bx, by, bx, by + bh);
      bg.addColorStop(0, 'rgba(80,20,0,0.88)');
      bg.addColorStop(1, 'rgba(35,10,0,0.92)');
      ctx.fillStyle = bg; ctx.fill();

      _rect(ctx, bx, by, bw, bh, 2);
      ctx.strokeStyle = '#ff6622'; ctx.lineWidth = 1.5;
      ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 10; ctx.stroke();
      ctx.shadowBlur = 0;
    }
  },

  /* 8. ЛЁД — плашка с ЛЕДЯНЫМИ ШИПАМИ сверху снаружи */
  {
    id: 'boxice', label: 'ЛЁД', icon: '❄',
    uiColor: '#88ddff', uiBg: 'rgba(136,221,255,.08)',
    draw(ctx, bx, by, bw, bh, col, t) {
      const spikeH = Math.max(8, bh * 0.4);
      const spikes = 7;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      for (let i = 0; i < spikes; i++) {
        const x1 = bx + (bw * i) / spikes;
        const x2 = bx + (bw * (i + 0.5)) / spikes;
        const x3 = bx + (bw * (i + 1)) / spikes;
        const h = (0.4 + 0.6 * Math.sin(i * 3.7 + 1)) * spikeH;
        ctx.lineTo(x1, by);
        ctx.lineTo(x2, by - h);
        ctx.lineTo(x3, by);
      }
      ctx.closePath();
      const sg = ctx.createLinearGradient(bx, by - spikeH, bx, by);
      sg.addColorStop(0, 'rgba(220,240,255,0.95)');
      sg.addColorStop(1, 'rgba(100,170,220,0.6)');
      ctx.fillStyle = sg; ctx.fill();
      ctx.strokeStyle = 'rgba(230,245,255,0.8)';
      ctx.lineWidth = 0.75; ctx.stroke();
      ctx.restore();

      const c = Math.min(bw, bh) * 0.08;
      _cut(ctx, bx, by, bw, bh, c);
      const bg = ctx.createLinearGradient(bx, by, bx, by + bh);
      bg.addColorStop(0, 'rgba(150,200,240,0.4)');
      bg.addColorStop(1, 'rgba(35,80,140,0.45)');
      ctx.fillStyle = bg; ctx.fill();

      _cut(ctx, bx, by, bw, bh, c);
      _glow(ctx, '#88ddff', 1.5, 10);
    }
  },

  /* 9. ГОЛО — восьмиугольник с хроматическим сдвигом */
  {
    id: 'boxholo', label: 'ГОЛО', icon: '◉',
    uiColor: '#00ffcc', uiBg: 'rgba(0,255,200,.08)',
    padMultiplier: 1.1,
    draw(ctx, bx, by, bw, bh, col, t) {
      const c = Math.min(bw, bh) * 0.1;
      const phase = (t * 40) % 360;

      _cut(ctx, bx, by, bw, bh, c);
      const bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      bg.addColorStop(0, `hsla(${phase},70%,55%,0.22)`);
      bg.addColorStop(0.5, `hsla(${phase + 120},70%,55%,0.18)`);
      bg.addColorStop(1, `hsla(${phase + 240},70%,55%,0.22)`);
      ctx.fillStyle = bg; ctx.fill();

      _scanLine(ctx, bx, by, bw, bh, '#ffffff', t, 0.45);

      _cut(ctx, bx, by, bw, bh, c);
      const sg = ctx.createLinearGradient(bx, by, bx + bw, by);
      sg.addColorStop(0, `hsl(${phase},100%,65%)`);
      sg.addColorStop(0.5, `hsl(${phase + 180},100%,65%)`);
      sg.addColorStop(1, `hsl(${phase + 360},100%,65%)`);
      ctx.strokeStyle = sg; ctx.lineWidth = 1.5; ctx.stroke();
    }
  },

  /* 10. ЗОЛОТО — параллелограмм с золотым бевелем */
  {
    id: 'boxgold', label: 'ЗОЛОТО', icon: '✦',
    uiColor: '#f0c040', uiBg: 'rgba(240,192,64,.08)',
    padMultiplier: 1.15,
    draw(ctx, bx, by, bw, bh, col, t) {
      const s = bh * 0.1;
      _skew(ctx, bx, by, bw, bh, s);
      const g = ctx.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0, 'rgba(255,225,140,0.95)');
      g.addColorStop(0.45, 'rgba(210,160,50,0.92)');
      g.addColorStop(0.55, 'rgba(160,110,25,0.94)');
      g.addColorStop(1, 'rgba(225,185,85,0.92)');
      ctx.fillStyle = g; ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bx + s + 3, by + 1); ctx.lineTo(bx + bw - 3, by + 1);
      ctx.strokeStyle = 'rgba(255,255,220,0.8)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();

      _skew(ctx, bx + 3, by + 3, bw - 6, bh - 6, s * 0.85);
      ctx.strokeStyle = 'rgba(120,80,10,0.55)'; ctx.lineWidth = 0.75; ctx.stroke();

      _skew(ctx, bx, by, bw, bh, s);
      ctx.strokeStyle = 'rgba(180,125,25,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  },

  /* 11. КИБЕР — восьмиугольник с глубокой фаской + угловые метки */
  {
    id: 'boxcyber', label: 'КИБЕР', icon: '⬡',
    uiColor: '#ff2d78', uiBg: 'rgba(255,45,120,.08)',
    padMultiplier: 1.2,
    draw(ctx, bx, by, bw, bh, col, t) {
      const c = Math.min(bw, bh) * 0.18;
      _cut(ctx, bx, by, bw, bh, c);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(45,5,25,0.85)', 'rgba(20,0,15,0.85)');

      _cut(ctx, bx, by, bw, bh, c);
      _glow(ctx, '#ff2d78', 2, 14);

      ctx.strokeStyle = '#ff2d78'; ctx.lineWidth = 1.5;
      ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 6;
      const d = c * 0.5;
      ctx.beginPath();
      ctx.moveTo(bx + c, by); ctx.lineTo(bx + c - d, by - d);
      ctx.moveTo(bx, by + c); ctx.lineTo(bx - d, by + c - d);
      ctx.moveTo(bx + bw - c, by); ctx.lineTo(bx + bw - c + d, by - d);
      ctx.moveTo(bx + bw, by + c); ctx.lineTo(bx + bw + d, by + c - d);
      ctx.moveTo(bx + bw - c, by + bh); ctx.lineTo(bx + bw - c + d, by + bh + d);
      ctx.moveTo(bx + bw, by + bh - c); ctx.lineTo(bx + bw + d, by + bh - c + d);
      ctx.moveTo(bx + c, by + bh); ctx.lineTo(bx + c - d, by + bh + d);
      ctx.moveTo(bx, by + bh - c); ctx.lineTo(bx - d, by + bh - c + d);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  },

  /* 12. РАДУГА — скруглённая плашка с анимированным хроматическим кантом */
  {
    id: 'boxrainbow', label: 'РАДУГА', icon: '◌',
    uiColor: '#ff88ff', uiBg: 'rgba(255,136,255,.06)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 6);
      ctx.fillStyle = 'rgba(10,5,20,0.78)'; ctx.fill();

      _rect(ctx, bx, by, bw, bh, 6);
      const phase = (t * 60) % 360;
      const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      g.addColorStop(0, `hsl(${phase},100%,65%)`);
      g.addColorStop(0.33, `hsl(${phase + 120},100%,65%)`);
      g.addColorStop(0.66, `hsl(${phase + 240},100%,65%)`);
      g.addColorStop(1, `hsl(${phase + 360},100%,65%)`);
      ctx.strokeStyle = g; ctx.lineWidth = 2.5;
      ctx.shadowColor = `hsl(${phase},100%,65%)`; ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  },

  /* 13. РЕТРО — CRT: скругление + скан-линии + подсветка */
  {
    id: 'boxretro', label: 'РЕТРО', icon: '▦',
    uiColor: '#44ff88', uiBg: 'rgba(68,255,136,.08)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 4);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(0,25,12,0.92)', 'rgba(0,10,5,0.92)');

      ctx.save(); _rect(ctx, bx, by, bw, bh, 4); ctx.clip();
      ctx.globalAlpha *= 0.13;
      ctx.fillStyle = '#44ff88';
      for (let y = by; y < by + bh; y += 3) ctx.fillRect(bx, y, bw, 1);
      ctx.globalAlpha /= 0.13;

      const g = ctx.createLinearGradient(bx, by, bx, by + bh * 0.3);
      g.addColorStop(0, 'rgba(68,255,136,0.14)');
      g.addColorStop(1, 'rgba(68,255,136,0)');
      ctx.fillStyle = g; ctx.fillRect(bx, by, bw, bh * 0.3);
      ctx.restore();

      _rect(ctx, bx, by, bw, bh, 4);
      _glow(ctx, '#44ff88', 1.5, 11);
    }
  },

  /* 14. АУРА — скруглённая плашка в белом ореоле */
  {
    id: 'boxaura', label: 'АУРА', icon: '○',
    uiColor: '#ffffff', uiBg: 'rgba(255,255,255,.05)',
    padMultiplier: 1.3,
    draw(ctx, bx, by, bw, bh, col, t) {
      const pulse = 0.75 + Math.sin(t * 1.8) * 0.25;
      for (let i = 4; i >= 1; i--) {
        const o = i * 5;
        _rect(ctx, bx - o, by - o, bw + o * 2, bh + o * 2, 10 + o);
        ctx.fillStyle = `rgba(255,255,255,${0.03 * pulse * i})`;
        ctx.fill();
      }
      _rect(ctx, bx, by, bw, bh, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fill();
      _rect(ctx, bx, by, bw, bh, 8);
      ctx.strokeStyle = `rgba(255,255,255,${0.45 * pulse})`;
      ctx.lineWidth = 1;
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 14 * pulse;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  },

  /* 15. МАТРИЦА — плашка + цифровой дождь ПО БОКАМ снаружи */
  {
    id: 'boxmatrix', label: 'МАТРИЦА', icon: '⬣',
    uiColor: '#00ff41', uiBg: 'rgba(0,255,65,.06)',
    draw(ctx, bx, by, bw, bh, col, t) {
      const chSize = Math.max(9, bh * 0.25);
      ctx.save();
      ctx.font = `${chSize}px monospace`;
      ctx.fillStyle = '#00ff41';
      ctx.textAlign = 'center';
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < 2; i++) {
          const baseX = side === 0
            ? bx - chSize * (1.2 + i * 0.9)
            : bx + bw + chSize * (1.2 + i * 0.9);
          const streamOff = i * 17 + side * 31;
          for (let j = 0; j < 3; j++) {
            const y = by + (((t * (12 + i * 4) + j * 18 + streamOff) % (bh + 40)) - 20);
            const ch = String.fromCharCode(0x30A0 + ((t * 2 + i * 5 + j * 7) | 0) % 96);
            ctx.globalAlpha = Math.max(0, 0.6 * (1 - j / 3));
            ctx.fillText(ch, baseX, y);
          }
        }
      }
      ctx.restore();

      _rect(ctx, bx, by, bw, bh, 0);
      ctx.fillStyle = 'rgba(0,15,5,0.9)'; ctx.fill();

      _rect(ctx, bx, by, bw, bh, 0);
      _glow(ctx, '#00ff41', 1.25, 9);
    }
  },


  /* 16. ДЫМКА — полупрозрачная плашка с мягким fade по краям */
  {
    id: 'boxsmoke', label: 'ДЫМКА', icon: '◎',
    uiColor: '#aabbcc', uiBg: 'rgba(170,187,204,.07)',
    padMultiplier: 1.1,
    draw(ctx, bx, by, bw, bh, col, t) {
      const swirl = Math.sin(t * 0.8) * 0.15;
      _rect(ctx, bx, by, bw, bh, 8);
      const g = ctx.createRadialGradient(bx + bw / 2, by + bh / 2, 0,
                                          bx + bw / 2, by + bh / 2, Math.max(bw, bh) / 1.5);
      g.addColorStop(0, `rgba(100,110,120,${0.55 + swirl * 0.2})`);
      g.addColorStop(0.7, `rgba(60,70,80,${0.42 + swirl * 0.15})`);
      g.addColorStop(1, 'rgba(30,35,40,0.15)');
      ctx.fillStyle = g; ctx.fill();

      _rect(ctx, bx, by, bw, bh, 8);
      ctx.strokeStyle = 'rgba(180,195,210,0.35)';
      ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 17. ПЛАЗМА — пульсирующий фиолетовый glow без внутренних орнаментов */
  {
    id: 'boxplasma', label: 'ПЛАЗМА', icon: '⚡',
    uiColor: '#7744ff', uiBg: 'rgba(119,68,255,.08)',
    draw(ctx, bx, by, bw, bh, col, t) {
      const pulse = 0.7 + Math.sin(t * 3) * 0.3;
      _rect(ctx, bx, by, bw, bh, 3);
      const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      g.addColorStop(0, `rgba(60,20,120,${0.75 * pulse})`);
      g.addColorStop(1, `rgba(120,40,200,${0.6 * pulse})`);
      ctx.fillStyle = g; ctx.fill();

      // Два слоя glow
      _rect(ctx, bx, by, bw, bh, 3);
      _glow(ctx, '#7744ff', 2.5, 20 * pulse);
      _rect(ctx, bx, by, bw, bh, 3);
      ctx.strokeStyle = `rgba(200,180,255,${0.85 * pulse})`;
      ctx.lineWidth = 0.75; ctx.stroke();
    }
  },

  /* 18. ТАТУ — чёрная плашка с жирной коралловой окантовкой */
  {
    id: 'boxtattoo', label: 'ТАТУ', icon: '✿',
    uiColor: '#ff6644', uiBg: 'rgba(255,102,68,.08)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      ctx.fillStyle = 'rgba(5,5,5,0.92)'; ctx.fill();

      // Двойная окантовка: внешняя толстая, внутренняя тонкая
      _rect(ctx, bx, by, bw, bh, 0);
      ctx.strokeStyle = '#ff6644'; ctx.lineWidth = 3; ctx.stroke();
      _rect(ctx, bx + 4, by + 4, bw - 8, bh - 8, 0);
      ctx.strokeStyle = '#ff6644'; ctx.lineWidth = 0.75; ctx.stroke();

      // Угловые точки
      _cornerDots(ctx, bx, by, bw, bh, '#ff6644', 2.5);
    }
  },

  /* 19. ЗАКАТ — горизонтальный тёплый градиент */
  {
    id: 'boxsunset', label: 'ЗАКАТ', icon: '◐',
    uiColor: '#ff8844', uiBg: 'rgba(255,136,68,.07)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 3);
      const g = ctx.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0, 'rgba(255,200,100,0.75)');
      g.addColorStop(0.4, 'rgba(255,100,80,0.75)');
      g.addColorStop(0.75, 'rgba(160,40,120,0.75)');
      g.addColorStop(1, 'rgba(60,20,90,0.75)');
      ctx.fillStyle = g; ctx.fill();

      // Тонкая линия горизонта (по центру — но ОНА ПРОСТО СТРИП, не декор)
      // Нет. Уберём — пусть просто градиент.

      _rect(ctx, bx, by, bw, bh, 3);
      ctx.strokeStyle = 'rgba(255,220,180,0.65)'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 20. ГЛЯНЕЦ — ярко-красная плашка с глянцевой верхней половиной */
  {
    id: 'boxlacquer', label: 'ГЛЯНЕЦ', icon: '◆',
    uiColor: '#ff1155', uiBg: 'rgba(255,17,85,.08)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 3);
      const g = ctx.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0, 'rgba(255,50,90,0.95)');
      g.addColorStop(0.5, 'rgba(200,15,60,0.95)');
      g.addColorStop(1, 'rgba(120,5,30,0.95)');
      ctx.fillStyle = g; ctx.fill();

      // Глянцевый блик на верхней половине
      ctx.save(); _rect(ctx, bx, by, bw, bh, 3); ctx.clip();
      const hg = ctx.createLinearGradient(bx, by, bx, by + bh * 0.45);
      hg.addColorStop(0, 'rgba(255,255,255,0.35)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg; ctx.fillRect(bx, by, bw, bh * 0.45);
      ctx.restore();

      _rect(ctx, bx, by, bw, bh, 3);
      ctx.strokeStyle = 'rgba(255,120,150,0.75)'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 21. БРИЛЛИАНТ — чистый прямоугольник с фаской и зеркальным блеском */
  {
    id: 'boxdiamond', label: 'БРИЛЛИАНТ', icon: '◇',
    uiColor: '#a8edff', uiBg: 'rgba(168,237,255,.07)',
    padMultiplier: 1.1,
    draw(ctx, bx, by, bw, bh, col, t) {
      const c = Math.min(bw, bh) * 0.12;
      const shine = 0.7 + Math.sin(t * 1.5) * 0.3;

      _cutRect(ctx, bx, by, bw, bh, c);
      const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      g.addColorStop(0, 'rgba(10,30,50,0.85)');
      g.addColorStop(0.5, 'rgba(20,50,80,0.75)');
      g.addColorStop(1, 'rgba(10,25,45,0.85)');
      ctx.fillStyle = g; ctx.fill();

      // Блик — диагональная полоса, через clip, очень узкая и по верху
      ctx.save(); _cutRect(ctx, bx, by, bw, bh, c); ctx.clip();
      const bg = ctx.createLinearGradient(bx, by, bx + bw, by);
      const p = (t * 0.15) % 1;
      bg.addColorStop(Math.max(0, p - 0.08), 'rgba(255,255,255,0)');
      bg.addColorStop(p, `rgba(255,255,255,${0.4 * shine})`);
      bg.addColorStop(Math.min(1, p + 0.08), 'rgba(255,255,255,0)');
      ctx.fillStyle = bg; ctx.fillRect(bx, by, bw, 2);
      ctx.restore();

      _cutRect(ctx, bx, by, bw, bh, c);
      _glow(ctx, '#a8edff', 1.5, 12 * shine);
    }
  },

  /* 22. VHS — плашка с RGB-сдвигом ПО КРАЯМ и датой СНАРУЖИ СВЕРХУ */
  {
    id: 'boxvhs', label: 'VHS', icon: '▶',
    uiColor: '#ff66aa', uiBg: 'rgba(255,102,170,.07)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      ctx.fillStyle = 'rgba(10,5,12,0.88)'; ctx.fill();

      // Скан-линии
      ctx.save(); _rect(ctx, bx, by, bw, bh, 0); ctx.clip();
      ctx.globalAlpha *= 0.06;
      for (let y = by; y < by + bh; y += 2) {
        ctx.fillStyle = '#fff'; ctx.fillRect(bx, y, bw, 1);
      }
      ctx.globalAlpha /= 0.06;

      // Одна RGB-полоса (не поперёк всего, небольшая)
      const barY = by + ((t * 18) % bh);
      ctx.globalAlpha *= 0.25;
      ctx.fillStyle = '#ff0044'; ctx.fillRect(bx + 3, barY, bw, 2);
      ctx.fillStyle = '#00ffff'; ctx.fillRect(bx - 3, barY, bw, 2);
      ctx.globalAlpha /= 0.25;
      ctx.restore();

      // «REC●» ВНЕ бокса, сверху слева
      const labelSize = Math.max(7, bh * 0.18);
      ctx.font = `bold ${labelSize}px monospace`;
      ctx.fillStyle = '#ff66aa'; ctx.globalAlpha *= 0.65;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('REC●', bx, by - 2);
      ctx.globalAlpha /= 0.65;

      _rect(ctx, bx, by, bw, bh, 0);
      ctx.strokeStyle = '#ff66aa'; ctx.lineWidth = 1.5;
      ctx.shadowColor = '#ff0066'; ctx.shadowBlur = 6; ctx.stroke();
      ctx.shadowBlur = 0;
    }
  },

  /* 23. СИГИЛ — плашка + единственная угловая руна (не в центре) */
  {
    id: 'boxsigil', label: 'СИГИЛ', icon: '⛧',
    uiColor: '#9944ff', uiBg: 'rgba(153,68,255,.07)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(25,5,50,0.85)', 'rgba(10,0,25,0.9)');

      // Руна в верхнем-правом углу — маленькая, снаружи текста
      const rs = Math.min(bw, bh) * 0.15;
      const rcx = bx + bw - rs * 0.6;
      const rcy = by + rs * 0.6;
      ctx.save();
      ctx.translate(rcx, rcy);
      ctx.rotate(t * 0.5);
      ctx.strokeStyle = '#9944ff';
      ctx.shadowColor = '#9944ff'; ctx.shadowBlur = 8;
      ctx.lineWidth = 1.25;
      // Пентагональная звезда
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * _τ - Math.PI / 2;
        const x = Math.cos(a) * rs * 0.5;
        const y = Math.sin(a) * rs * 0.5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
      ctx.restore();

      _rect(ctx, bx, by, bw, bh, 0);
      _glow(ctx, '#9944ff', 1.5, 12);
    }
  },

  /* 24. ПЛАТА — плашка + PCB-дорожки по периметру (снаружи) */
  {
    id: 'boxwire', label: 'ПЛАТА', icon: '⬢',
    uiColor: '#00ff88', uiBg: 'rgba(0,255,136,.06)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      ctx.fillStyle = 'rgba(0,15,5,0.88)'; ctx.fill();

      // Дорожки по внешнему периметру
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 1;
      ctx.shadowColor = '#00ff88'; ctx.shadowBlur = 4;
      const traceOff = 3;
      ctx.beginPath();
      // Верхняя
      ctx.moveTo(bx + bw * 0.15, by - traceOff);
      ctx.lineTo(bx + bw * 0.35, by - traceOff);
      ctx.lineTo(bx + bw * 0.35 + 3, by - traceOff - 3);
      ctx.lineTo(bx + bw * 0.75, by - traceOff - 3);
      // Правая
      ctx.moveTo(bx + bw + traceOff, by + bh * 0.2);
      ctx.lineTo(bx + bw + traceOff, by + bh * 0.8);
      // Нижняя
      ctx.moveTo(bx + bw * 0.8, by + bh + traceOff);
      ctx.lineTo(bx + bw * 0.3, by + bh + traceOff);
      // Левая
      ctx.moveTo(bx - traceOff, by + bh * 0.75);
      ctx.lineTo(bx - traceOff, by + bh * 0.25);
      ctx.stroke();

      // Контактные точки на концах
      ctx.fillStyle = '#00ff88';
      [[bx + bw * 0.15, by - traceOff], [bx + bw * 0.75, by - traceOff - 3],
       [bx + bw + traceOff, by + bh * 0.2], [bx + bw + traceOff, by + bh * 0.8],
       [bx + bw * 0.8, by + bh + traceOff], [bx + bw * 0.3, by + bh + traceOff],
       [bx - traceOff, by + bh * 0.75], [bx - traceOff, by + bh * 0.25]]
        .forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 1.5, 0, _τ); ctx.fill(); });
      ctx.shadowBlur = 0;

      _rect(ctx, bx, by, bw, bh, 0);
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 25. ПОРТАЛ — плашка с вращающимся радиальным градиентом ПО КАЙМЕ */
  {
    id: 'boxportal', label: 'ПОРТАЛ', icon: '◯',
    uiColor: '#ff8800', uiBg: 'rgba(255,136,0,.07)',
    padMultiplier: 1.15,
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 6);
      ctx.fillStyle = 'rgba(15,5,0,0.85)'; ctx.fill();

      // Вращающийся хроматический контур
      _rect(ctx, bx, by, bw, bh, 6);
      ctx.save();
      const cx = bx + bw / 2, cy = by + bh / 2;
      const g = ctx.createConicGradient ? ctx.createConicGradient(t * 1.5, cx, cy) : null;
      if (g) {
        g.addColorStop(0,    '#ff8800');
        g.addColorStop(0.25, '#ffcc44');
        g.addColorStop(0.5,  '#ff4400');
        g.addColorStop(0.75, '#ffaa00');
        g.addColorStop(1,    '#ff8800');
        ctx.strokeStyle = g;
      } else {
        ctx.strokeStyle = '#ff8800';
      }
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ff8800'; ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  },

  /* 26. ВОЛНА — плашка с волнистым нижним краем (снаружи) */
  {
    id: 'boxwave', label: 'ВОЛНА', icon: '∿',
    uiColor: '#00ccff', uiBg: 'rgba(0,204,255,.07)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 2);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(0,30,50,0.85)', 'rgba(0,15,35,0.9)');

      // Волна СНАРУЖИ — над и под плашкой
      ctx.strokeStyle = '#00ccff'; ctx.lineWidth = 1.5;
      ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 6;
      [by - 4, by + bh + 4].forEach((wy, idx) => {
        ctx.beginPath();
        for (let x = bx; x <= bx + bw; x += 2) {
          const yy = wy + Math.sin((x - bx) * 0.08 + t * 3 + idx * Math.PI) * 2.5;
          x === bx ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;

      _rect(ctx, bx, by, bw, bh, 2);
      ctx.strokeStyle = '#00ccff'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 27. ОПАСНОСТЬ — чёрно-жёлтая предупредительная лента ПО ПЕРИМЕТРУ (тонкая) */
  {
    id: 'boxdanger', label: 'ОПАСНОСТЬ', icon: '⚠',
    uiColor: '#ffcc00', uiBg: 'rgba(255,204,0,.07)',
    padMultiplier: 1.1,
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      ctx.fillStyle = 'rgba(15,12,0,0.9)'; ctx.fill();

      // Тонкая hazard-полоса поверх контура (сверху и снизу)
      ctx.save(); _rect(ctx, bx, by, bw, bh, 0); ctx.clip();
      const stripeH = Math.max(4, bh * 0.08);
      const sw = 10;
      const off = (t * 30) % (sw * 2);
      ctx.fillStyle = '#ffcc00';
      for (let sx = bx - sw * 2; sx < bx + bw + sw * 2; sx += sw * 2) {
        [by, by + bh - stripeH].forEach(sy => {
          ctx.beginPath();
          ctx.moveTo(sx + off, sy);
          ctx.lineTo(sx + off + sw, sy);
          ctx.lineTo(sx + off + sw + stripeH, sy + stripeH);
          ctx.lineTo(sx + off + stripeH, sy + stripeH);
          ctx.closePath(); ctx.fill();
        });
      }
      ctx.restore();

      _rect(ctx, bx, by, bw, bh, 0);
      ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 28. КРИСТАЛЛ — прямоугольник с фасеточным рисунком по углам */
  {
    id: 'boxcrystal', label: 'КРИСТАЛЛ', icon: '✧',
    uiColor: '#dd88ff', uiBg: 'rgba(221,136,255,.07)',
    padMultiplier: 1.1,
    draw(ctx, bx, by, bw, bh, col, t) {
      const c = Math.min(bw, bh) * 0.14;
      _cutRect(ctx, bx, by, bw, bh, c);
      const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      g.addColorStop(0, 'rgba(50,20,70,0.85)');
      g.addColorStop(1, 'rgba(30,10,50,0.85)');
      ctx.fillStyle = g; ctx.fill();

      // Короткие диагонали ВНУТРИ углов (только короткие штрихи, не через центр)
      ctx.save(); _cutRect(ctx, bx, by, bw, bh, c); ctx.clip();
      ctx.strokeStyle = 'rgba(255,200,255,0.35)'; ctx.lineWidth = 0.75;
      const facetLen = c * 1.2;
      // От срезов — короткая линия внутрь
      [[bx + c, by, 1, 1], [bx + bw - c, by, -1, 1],
       [bx + bw, by + c, -1, 1], [bx + bw, by + bh - c, -1, -1],
       [bx + bw - c, by + bh, -1, -1], [bx + c, by + bh, 1, -1],
       [bx, by + bh - c, 1, -1], [bx, by + c, 1, 1]]
        .forEach(([x, y, dx, dy]) => {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + dx * facetLen, y + dy * facetLen);
          ctx.stroke();
        });
      ctx.restore();

      _cutRect(ctx, bx, by, bw, bh, c);
      _glow(ctx, '#dd88ff', 1.5, 12);
    }
  },

  /* 29. ПОМЕХИ — шумовой прямоугольник */
  {
    id: 'boxstatic', label: 'ПОМЕХИ', icon: '⋯',
    uiColor: '#cccccc', uiBg: 'rgba(200,200,200,.05)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      ctx.fillStyle = 'rgba(20,20,20,0.85)'; ctx.fill();

      // Псевдослучайный шум (лёгкий, детерминированный по t)
      ctx.save(); _rect(ctx, bx, by, bw, bh, 0); ctx.clip();
      ctx.globalAlpha *= 0.18;
      const seed = (t * 30) | 0;
      for (let i = 0; i < 40; i++) {
        const rx = (((i * 9301 + 49297 + seed * 13) % 233280) / 233280) * bw;
        const ry = (((i * 41 + seed * 7) % 233280) / 233280) * bh;
        ctx.fillStyle = i % 2 ? '#fff' : '#888';
        ctx.fillRect(bx + rx, by + ry, 2, 1);
      }
      ctx.globalAlpha /= 0.18;
      // Одна горизонтальная интерференционная полоса
      const barY = by + ((t * 40) % bh);
      ctx.globalAlpha *= 0.2;
      ctx.fillStyle = '#fff'; ctx.fillRect(bx, barY, bw, 1);
      ctx.globalAlpha /= 0.2;
      ctx.restore();

      _rect(ctx, bx, by, bw, bh, 0);
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 30. ТУШЬ — неровный белый штрих по периметру */
  {
    id: 'boxink', label: 'ТУШЬ', icon: '✺',
    uiColor: '#ffffff', uiBg: 'rgba(255,255,255,.04)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.88)'; ctx.fill();

      // Неровный штрих (3 прохода с разной альфой)
      ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const jitter = (seed) => {
        const s = Math.sin(seed * 12.9898 + t * 0.3) * 43758.5453;
        return (s - Math.floor(s)) * 2 - 1;
      };
      for (let p = 0; p < 3; p++) {
        ctx.globalAlpha *= 0.3; ctx.lineWidth = 2 + p * 0.5;
        ctx.beginPath();
        ctx.moveTo(bx + jitter(p), by + jitter(p + 10));
        ctx.lineTo(bx + bw + jitter(p + 1), by + jitter(p + 11));
        ctx.lineTo(bx + bw + jitter(p + 2), by + bh + jitter(p + 12));
        ctx.lineTo(bx + jitter(p + 3), by + bh + jitter(p + 13));
        ctx.closePath(); ctx.stroke();
        ctx.globalAlpha /= 0.3;
      }

      // Брызги ТОЛЬКО за пределами бокса (снаружи, маленькие точки)
      ctx.fillStyle = '#fff'; ctx.globalAlpha *= 0.6;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * _τ + t * 0.1;
        const dist = 6 + Math.abs(Math.sin(i + t)) * 3;
        const px = bx + bw / 2 + Math.cos(ang) * (bw / 2 + dist);
        const py = by + bh / 2 + Math.sin(ang) * (bh / 2 + dist);
        ctx.beginPath(); ctx.arc(px, py, 1, 0, _τ); ctx.fill();
      }
      ctx.globalAlpha /= 0.6;
    }
  },

  /* 31. РАЗЛОМ — прямоугольник с трещиной по ВЕРХНЕМУ ИЛИ НИЖНЕМУ КРАЮ */
  {
    id: 'boxfault', label: 'РАЗЛОМ', icon: '⚡',
    uiColor: '#ff4400', uiBg: 'rgba(255,68,0,.07)',
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(30,10,0,0.88)', 'rgba(20,5,0,0.9)');

      // Трещина: зигзаг ПО НИЖНЕМУ краю, чуть заходит снаружи
      ctx.strokeStyle = '#ff4400'; ctx.lineWidth = 1.5;
      ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 8;
      ctx.beginPath();
      const segs = 8;
      let cx = bx;
      ctx.moveTo(cx, by + bh - 1);
      for (let i = 1; i <= segs; i++) {
        const nx = bx + (bw * i / segs);
        const ny = by + bh - 1 + (Math.sin(i * 2.3 + t * 3) * 4);
        ctx.lineTo(nx, ny);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      _rect(ctx, bx, by, bw, bh, 0);
      ctx.strokeStyle = '#ff4400'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  /* 32. ВИНЬЕТКА — прямоугольник с затемнением по краям */
  {
    id: 'boxvignette', label: 'ВИНЬЕТКА', icon: '◉',
    uiColor: '#888888', uiBg: 'rgba(120,120,120,.08)',
    padMultiplier: 1.15,
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 4);
      const g = ctx.createRadialGradient(bx + bw / 2, by + bh / 2, 0,
                                          bx + bw / 2, by + bh / 2, Math.max(bw, bh) / 1.4);
      g.addColorStop(0, 'rgba(80,80,80,0.7)');
      g.addColorStop(0.6, 'rgba(40,40,40,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0.95)');
      ctx.fillStyle = g; ctx.fill();

      _rect(ctx, bx, by, bw, bh, 4);
      ctx.strokeStyle = 'rgba(180,180,180,0.4)'; ctx.lineWidth = 0.75; ctx.stroke();
    }
  },

  /* 33. ВИРУС — плашка с биохазард-символами ТОЛЬКО В УГЛАХ */
  {
    id: 'boxvirus', label: 'ВИРУС', icon: '☣',
    uiColor: '#88ff44', uiBg: 'rgba(136,255,68,.06)',
    padMultiplier: 1.15,
    draw(ctx, bx, by, bw, bh, col, t) {
      _rect(ctx, bx, by, bw, bh, 0);
      _fillSoft(ctx, bx, by, bw, bh, 'rgba(5,20,5,0.88)', 'rgba(0,10,0,0.92)');

      // Штриховая окантовка — подчёркивает «карантин»
      _dashedEdge(ctx, bx, by, bw, bh, '#88ff44', 8, 5, t * 10);

      _rect(ctx, bx, by, bw, bh, 0);
      ctx.strokeStyle = '#88ff44'; ctx.lineWidth = 1; ctx.stroke();

      // Биохазард в верхнем-левом и нижнем-правом углу (маленький, снаружи)
      const sym = Math.max(8, Math.min(bw, bh) * 0.14);
      ctx.font = `${sym}px sans-serif`;
      ctx.fillStyle = '#88ff44';
      ctx.shadowColor = '#88ff44'; ctx.shadowBlur = 6;
      ctx.globalAlpha *= 0.7;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('☣', bx - sym * 0.4, by - sym * 0.4);
      ctx.fillText('☣', bx + bw + sym * 0.4, by + bh + sym * 0.4);
      ctx.globalAlpha /= 0.7;
      ctx.shadowBlur = 0;
    }
  },

];

/* ═══════════════════════════════════════════════
   BoxRegistry — API для FxEditor и renderers
═══════════════════════════════════════════════ */
const BoxRegistry = (() => {
  const _map = new Map(BOX_STYLES.map(s => [s.id, s]));

  return {
    get all() { return BOX_STYLES; },
    get(id) { return _map.get(id) || null; },

    draw(ctx, span, bx, by, bw, bh, col, t) {
      const id = BoxRegistry.spanBoxId(span);
      if (!id) return;
      const style = _map.get(id);
      if (!style) return;
      ctx.save();
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

    buildButtonsHTML() {
      return BOX_STYLES.map(s => `
        <button class="fxe-callout-btn" data-fx="${s.id}"
          style="border-color:${s.uiColor};color:${s.uiColor};background:${s.uiBg};">
          <span class="fxe-cb-icon">${s.icon}</span>
          <span class="fxe-cb-label">${s.label}</span>
        </button>`).join('');
    },
  };
})();
