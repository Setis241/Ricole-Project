/* ══════════════════════════════════════════════════════════════
   CardDeck — карта памяти в считывателе, как в радио игры
   (Quantifier client/game/radio.js swap()).

   В начале видео: пустой считыватель выезжает, карта песни
   прилетает снизу, щёлкает в щель, огонёк читает — и только тогда
   пошла музыка (lead-in перед треком). Пока песня играет — виджет
   «сейчас играет»: карта в щели, мерцает чип, полоски спектра,
   название, исполнитель, прогресс. В конце карта выезжает и
   улетает. Звуки (шорох, защёлка, писк считывателя, выброс) —
   тот же синтез, что в игре: в превью играют вживую, в экспорт
   подмешиваются в дорожку (renderAudio).

   Всё — функция времени T (секунды песни; до нуля — lead-in),
   поэтому превью и экспорт совпадают кадр в кадр.

   Карточка трека (название, исполнитель, номер, картинка)
   запоминается по имени файла — песни можно добавлять по ходу.

   API:
     CardDeck.lead()                         секунд lead-in (0 — выкл.)
     CardDeck.draw(ctx, w, h, T, dur, freq)  T == null — статичный вид
     CardDeck.tickSfx(T0, T1, dur)           звуки событий между кадрами (превью)
     CardDeck.renderAudio(buffer)            Promise<AudioBuffer> с lead-in и звуками
     CardDeck.setTrack(fileName)             выбрать карточку по имени файла
     CardDeck.ready()                        Promise: шрифты и картинка готовы
══════════════════════════════════════════════════════════════ */
const CardDeck = (function () {
  'use strict';

  /* ── Настройки и карточки треков ───────────── */
  const LS = 'ricole.cardDeck';
  const DEF = {
    on: true,
    corner: 'bl',        // bl | br | tl | tr | bc
    size: 0.16,          // ширина карты от высоты кадра
    panel: 0.55,         // плотность подложки (0 — без неё)
    speed: 1.25,         // 1 — как в игре; больше — медленнее, читабельнее в видео
    eject: true,         // в конце карта выезжает
    playlist: 'Радио',
    tracks: {},          // имя файла → { title, artist, n, img (dataURL) }
  };
  const st = (function () {
    try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(LS) || '{}')); }
    catch (e) { return Object.assign({}, DEF); }
  })();
  function save() {
    try { localStorage.setItem(LS, JSON.stringify(st)); }
    catch (e) { console.warn('[CardDeck] не сохранилось (картинка слишком большая?)', e); }
  }

  let file = '';                 // текущий файл
  // Место трека в альбоме: в середине считыватель не уезжает между треками —
  // конец одного файла (выброс) и начало следующего (вставка) склеиваются в swap
  let album = { first: true, last: true };
  function setAlbum(a) { album = { first: a ? !!a.first : true, last: a ? !!a.last : true }; }
  let img = null, imgSrc = '';   // картинка карты
  let cardCache = null, cardKey = '';

  // Тот же хеш, что в radio.js: оттенок и узор карты совпадают с игрой
  function hash(s) {
    let h = 2166136261; s = String(s);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // «Исполнитель - Название.mp3» → { artist, title }
  function fromName(name) {
    const base = String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
    const m = base.split(/\s+[-–—]\s+/);
    return m.length > 1 ? { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() }
                        : { artist: '', title: base.trim() };
  }

  function meta() {
    const m = st.tracks[file] || {};
    const d = fromName(file);
    const title = m.title != null && m.title !== '' ? m.title : d.title || 'Без названия';
    const artist = m.artist != null ? m.artist : d.artist;
    const h = hash(title + '|' + (artist || ''));
    return { title: title, artist: artist, n: m.n || 1, img: m.img || '', hue: h % 360, pat: (h >>> 9) % 4 };
  }

  function setTrack(name) {
    file = String(name || '').replace(/^↺\s*/, '');
    loadImg();
    if (panelEl) fillPanel();
  }
  function setMeta(patch) {
    st.tracks[file] = Object.assign({}, st.tracks[file], patch);
    save();
    if ('img' in patch) loadImg();
    cardKey = '';
  }

  function loadImg() {
    const src = meta().img;
    if (src === imgSrc) return;
    imgSrc = src; img = null; cardKey = '';
    if (!src) return;
    const im = new Image();
    im.onload = () => { if (imgSrc === src) { img = im; cardKey = ''; } };
    im.src = src;
  }

  function ready() {
    const jobs = [];
    if (document.fonts && document.fonts.load) {
      ['700 40px Rajdhani', '600 20px "JetBrains Mono"', '500 20px Inter'].forEach(f =>
        jobs.push(document.fonts.load(f).catch(() => {})));
    }
    if (imgSrc && !img) jobs.push(new Promise(r => {
      const t = setInterval(() => { if (img || !imgSrc) { clearInterval(t); r(); } }, 50);
      setTimeout(() => { clearInterval(t); r(); }, 3000);
    }));
    return Promise.all(jobs);
  }

  /* ── Цвета игры (game.css) ─────────────────── */
  const C = {
    t1: 'hsl(200 30% 94%)', t3: 'hsl(212 14% 54%)', t4: 'hsl(214 16% 36%)',
    te: 'hsl(186 30% 58%)', gold: 'hsl(40 48% 62%)',
    metal: 'hsl(206 12% 15%)', metalHi: 'hsl(204 10% 27%)', edge: 'hsl(200 14% 34%)',
    slot: 'hsl(210 30% 2%)', read: 'hsl(34 95% 58%)', fill: 'hsl(214 34% 8%)',
  };
  const FD = 'Rajdhani, "Exo 2", sans-serif';
  const FM = '"JetBrains Mono", monospace';

  /* ── Время: тайминги radio.js × speed ──────── */
  function T_() {
    const s = st.speed;
    const T = {};
    T.appear = 0.30;                 // считыватель выезжает
    T.fly = 0.44 * s;                // из-за кадра к щели
    T.ins = 0.15 * s;                // в щель
    T.bounce = 0.11 * s;             // щелчок
    T.read = 0.32;                   // огонёк читает
    T.gap = 0.05;
    T.lead = T.appear + T.gap + T.fly + T.ins + T.bounce + T.read;
    T.out = 0.22 * s;                // выезд из щели
    T.away = 0.38 * s;               // улетает
    T.fade = 0.30;
    return T;
  }
  function lead() { return st.on ? T_().lead : 0; }

  // События lead-in (от T = −lead) и конца трека — для звука
  function events(dur) {
    if (!st.on) return [];
    const T = T_(), L = T.lead;
    const f0 = -L + T.appear + T.gap, i0 = f0 + T.fly, r0 = i0 + T.ins + T.bounce;
    const ev = [{ t: f0, k: 'lift' }, { t: i0, k: 'insert' }, { t: r0, k: 'read' }];
    if (st.eject && dur > 4) ev.push({ t: dur - (T.out + T.away + T.fade), k: 'eject' });
    return ev;
  }

  /* ── cubic-bezier, как в CSS ───────────────── */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = t => ((ax * t + bx) * t + cx) * t, Y = t => ((ay * t + by) * t + cy) * t;
    const dX = t => (3 * ax * t + 2 * bx) * t + cx;
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 6; i++) { const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= (X(t) - x) / d; }
      t = Math.max(0, Math.min(1, t));
      return Y(t);
    };
  }
  const E = {
    fly: bezier(.25, .7, .25, 1), ins: bezier(.6, 0, .9, .5), out: bezier(.3, 0, .2, 1),
    away: bezier(.42, 0, .58, 1), bounce: bezier(0, 0, .58, 1), appear: bezier(.2, .8, .2, 1),
  };
  // Ключевые кадры WAAPI: easing на весь эффект, кадры поровну по времени
  function keys(ps, p) {
    const n = ps.length - 1, x = Math.max(0, Math.min(1, p)) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
    const a = ps[i], b = ps[i + 1], o = {};
    for (const k of ['x', 'y', 's', 'r', 'o']) {
      const va = a[k] == null ? (k === 's' || k === 'o' ? 1 : 0) : a[k];
      const vb = b[k] == null ? (k === 's' || k === 'o' ? 1 : 0) : b[k];
      o[k] = va + (vb - va) * f;
    }
    return o;
  }

  /* ── Геометрия ─────────────────────────────── */
  function cutPath(ctx, x, y, w, h, c) {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c);
    ctx.closePath();
  }
  // CSS linear-gradient(<deg>) по прямоугольнику
  function cssGrad(ctx, x, y, w, h, deg, stops) {
    const a = deg * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    const L = Math.abs(w * dx) + Math.abs(h * dy), cx = x + w / 2, cy = y + h / 2;
    const g = ctx.createLinearGradient(cx - dx * L / 2, cy - dy * L / 2, cx + dx * L / 2, cy + dy * L / 2);
    stops.forEach(s => g.addColorStop(s[0], s[1]));
    return g;
  }
  // «Нарезанная» рамка игры: кант градиентом, внутри заливка
  function frame(ctx, x, y, w, h, cut, k, edge, fill) {
    cutPath(ctx, x, y, w, h, cut); ctx.fillStyle = edge; ctx.fill();
    const b = Math.max(1, k);
    cutPath(ctx, x + b, y + b, w - 2 * b, h - 2 * b, Math.max(0, cut - b * 0.586)); ctx.fillStyle = fill; ctx.fill();
  }
  function fitText(ctx, s, maxW) {
    if (ctx.measureText(s).width <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
    return s.slice(0, lo) + '…';
  }
  function spaced(ctx, px, em) { try { ctx.letterSpacing = (px * em).toFixed(2) + 'px'; } catch (e) { /* старый браузер */ } }

  /* ── Узор карты без картинки (как .rdk-art в game.css) ── */
  function pattern(c, w, h, hue, pat, k) {
    const H = d => (hue + d + 360) % 360;
    const rad = (x, y, r, col) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col); g.addColorStop(1, 'hsla(0,0%,0%,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    };
    const far = Math.hypot(w, h);
    if (pat === 0) {
      c.fillStyle = cssGrad(c, 0, 0, w, h, 160, [[0, `hsl(${hue} 45% 22%)`], [1, `hsl(${H(40)} 50% 7%)`]]); c.fillRect(0, 0, w, h);
      rad(w * .72, h * .3, far * .62, `hsla(${hue},85%,58%,.75)`);
      c.strokeStyle = `hsla(${hue},80%,62%,.5)`; c.lineWidth = 1.5 * k;
      for (let r = 8 * k; r < far; r += 8 * k) { c.beginPath(); c.arc(w * .72, h * .3, r, 0, 7); c.stroke(); }
    } else if (pat === 1) {
      c.fillStyle = cssGrad(c, 0, 0, w, h, 200, [[0, `hsl(${hue} 50% 20%)`], [1, `hsl(${hue} 40% 6%)`]]); c.fillRect(0, 0, w, h);
      rad(w * .2, h * .9, far * .6, `hsla(${H(-30)},85%,55%,.7)`);
      c.save(); c.translate(w / 2, h / 2); c.rotate(25 * Math.PI / 180);
      c.fillStyle = `hsla(${hue},85%,62%,.45)`;
      for (let x = -far; x < far; x += 9 * k) c.fillRect(x, -far, 2 * k, 2 * far);
      c.restore();
    } else if (pat === 2) {
      c.fillStyle = cssGrad(c, 0, 0, w, h, 180, [[0, `hsl(${hue} 40% 8%)`], [1, `hsl(${hue} 45% 16%)`]]); c.fillRect(0, 0, w, h);
      rad(w * .5, h * 1.1, far * .62, `hsla(${hue},90%,58%,.85)`);
      c.fillStyle = `hsla(${hue},70%,60%,.28)`;
      for (let x = 0; x < w; x += 11 * k) c.fillRect(x, 0, Math.max(1, k), h);
      for (let y = 0; y < h; y += 11 * k) c.fillRect(0, y, w, Math.max(1, k));
    } else {
      c.fillStyle = cssGrad(c, 0, 0, w, h, 180, [[0, `hsl(${hue} 45% 7%)`], [1, `hsl(${hue} 45% 18%)`]]); c.fillRect(0, 0, w, h);
      rad(w * .5, h * 1.15, far * .55, `hsla(${H(30)},90%,62%,.8)`);
      c.fillStyle = `hsla(${hue},85%,62%,.4)`;
      const ox = w * .5, oy = h * 1.15;
      for (let a = 0; a < 360; a += 13) {
        const a0 = (a - 90) * Math.PI / 180, a1 = (a + 5 - 90) * Math.PI / 180;
        c.beginPath(); c.moveTo(ox, oy); c.arc(ox, oy, far * 2, a0, a1); c.closePath(); c.fill();
      }
    }
  }

  /* ── Карта целиком — в свой холст, раз на размер/трек ── */
  function cardCanvas(W, H, k, m) {
    const key = [W, H, m.title, m.artist, m.n, m.hue, m.pat, img ? imgSrc.length : 0].join('|');
    if (cardCache && cardKey === key) return cardCache;
    const cv = cardCache || document.createElement('canvas');
    cv.width = Math.ceil(W); cv.height = Math.ceil(H);
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    const h = m.hue;
    frame(c, 0, 0, W, H, 12 * k, k,
      cssGrad(c, 0, 0, W, H, 160, [[0, `hsl(${h} 55% 64%)`], [.55, `hsl(${h} 28% 30%)`], [1, `hsl(${h} 40% 46%)`]]), C.fill);

    // Картинка / узор: верх 54%, срезан угол
    const ax = 5 * k, ay = 5 * k, aw = W - 10 * k, ah = H * .54;
    c.save();
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + aw - 9 * k, ay); c.lineTo(ax + aw, ay + 9 * k);
    c.lineTo(ax + aw, ay + ah); c.lineTo(ax, ay + ah); c.closePath(); c.clip();
    c.translate(ax, ay);
    if (img) {
      const s = Math.max(aw / img.width, ah / img.height);
      c.fillStyle = C.fill; c.fillRect(0, 0, aw, ah);
      c.drawImage(img, (aw - img.width * s) / 2, (ah - img.height * s) / 2, img.width * s, img.height * s);
    } else pattern(c, aw, ah, h, m.pat, k);
    c.restore();

    // Чип
    const cx = 8 * k, cy = H * .54 + 12 * k, cw = 21 * k, ch = 13 * k;
    c.save(); c.globalAlpha = .85;
    c.fillStyle = 'hsl(40 30% 22%)'; c.fillRect(cx, cy, cw, ch);
    c.fillStyle = C.gold; for (let x = 0; x < cw; x += 4 * k) c.fillRect(cx + x, cy, Math.min(2 * k, cw - x), ch);
    c.strokeStyle = 'hsl(40 40% 30%)'; c.lineWidth = Math.max(1, k); c.strokeRect(cx + .5 * k, cy + .5 * k, cw - k, ch - k);
    c.restore();

    // Номер
    c.font = `600 ${9 * k}px ${FM}`; c.textAlign = 'right'; c.textBaseline = 'top';
    spaced(c, 9 * k, .1); c.fillStyle = `hsl(${h} 45% 66%)`;
    c.fillText(String(m.n).padStart(2, '0'), W - 9 * k, H * .54 + 13 * k);

    // Подпись
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const tp = Math.max(10.5 * k, W * .124);
    c.font = `700 ${tp}px ${FD}`; spaced(c, tp, .05); c.fillStyle = C.t1;
    const sp = Math.max(9 * k, W * .095);
    c.fillText(fitText(c, m.title.toUpperCase(), W - 16 * k), 8 * k, H - 7 * k - sp * 1.25);
    c.font = `500 ${sp}px Inter, sans-serif`; spaced(c, sp, 0); c.fillStyle = C.t3;
    c.fillText(fitText(c, m.artist || '', W - 16 * k), 8 * k, H - 7 * k);
    spaced(c, 0, 0);

    cardCache = cv; cardKey = key;
    return cv;
  }

  /* ── Кадр ──────────────────────────────────── */
  const bars = new Float32Array(16);

  function draw(ctx, w, h, T, dur, freq) {
    if (!st.on || !ctx) return;
    const m = meta(), Tm = T_();
    const k = (h * st.size) / 112;       // 1 = размер карты в окне игры (112 px)
    const cw = 112 * k, chh = cw * 1.4;
    const pad = 18 * k;
    const bay = { x: pad, y: pad, w: cw + 28 * k, h: chh + 26 * k };
    const Hx = bay.x + 14 * k, Hy = bay.y;
    const slit = bay.y + chh * .54 + 34 * k;
    const metaX = bay.x + bay.w + 20 * k, metaW = cw * 2.1;
    const PW = metaX + metaW + pad, PH = bay.y + bay.h + pad;
    const M = h * .04;
    const ox = st.corner === 'br' || st.corner === 'tr' ? w - PW - M : st.corner === 'bc' ? (w - PW) / 2 : M;
    const oy = st.corner === 'tl' || st.corner === 'tr' ? M : h - PH - M;

    // ── Фаза
    const L = Tm.lead, live = T != null;
    const t = live ? T : 1e9;                  // статичный вид — «играет»
    const D = dur || 0;
    let a = 1, slide = 0;                      // появление/уход виджета
    let card = null, inSlot = true, status = 'Играет', led = 'play', want = 0, shine = -1, metaA = 1;

    const rest = { x: Hx, y: Hy, s: 1, r: 0 };
    const up = { x: Hx, y: slit - chh - 6 * k, s: 1, r: 0 };
    const p0 = { x: Hx + cw * 1.35, y: h - oy + 20 * k, s: .92, r: 0 };   // из-за нижнего края кадра
    const mid = { x: (p0.x + up.x) / 2, y: Math.min(p0.y, up.y) - 30 * k, s: (p0.s + 1) / 2 * 1.06, r: p0.x > up.x ? -7 : 7 };

    const f0 = -L + Tm.appear + Tm.gap, i0 = f0 + Tm.fly, b0 = i0 + Tm.ins, r0 = b0 + Tm.bounce;
    const e0 = D - (Tm.out + Tm.away + Tm.fade), w0 = e0 + Tm.out, g0 = w0 + Tm.away;

    if (live && L > 0 && t < r0 + Tm.read) {
      metaA = 0;
      if (album.first && t < -L + Tm.appear) { const p = E.appear((t + L) / Tm.appear); a = p; slide = (1 - p) * 14 * k; }
      if (t < f0) { status = 'Пусто'; led = 'off'; }
      else if (t < i0) {
        const p = (t - f0) / Tm.fly;
        card = keys([p0, mid, up], E.fly(p)); inSlot = false; status = 'Вставка'; led = 'off';
        want = Math.max(0, (p - .4) / .6); shine = p;
      } else if (t < b0) {
        card = keys([up, rest], E.ins((t - i0) / Tm.ins)); status = 'Вставка'; led = 'off'; want = 1;
      } else if (t < r0) {
        card = keys([rest, { x: rest.x, y: rest.y + 3 * k }, rest], E.bounce((t - b0) / Tm.bounce)); status = 'Вставка'; led = 'off';
      } else {
        card = rest; status = 'Чтение'; led = 'read'; metaA = (t - r0) / Tm.read;
      }
    } else if (live && st.eject && D > 4 && t >= e0) {
      const hi = { x: rest.x, y: slit - chh - 10 * k, s: 1, r: -2 };
      status = 'Пусто'; led = 'off';
      metaA = Math.max(0, 1 - (t - e0) / Tm.out);
      if (t < w0) { card = keys([rest, hi], E.out((t - e0) / Tm.out)); }
      else if (t < g0) {
        card = keys([hi, { x: rest.x + 260 * k, y: up.y + 40 * k, s: .8, r: 14, o: 0 }], E.away((t - w0) / Tm.away));
        inSlot = false;
      } else if (album.last) { const p = Math.min(1, (t - g0) / Tm.fade); a = 1 - p; slide = p * 14 * k; }
    } else card = rest;
    if (a <= 0.001) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.translate(ox, oy + slide);
    ctx.globalAlpha = a;

    // ── Подложка
    if (st.panel > 0) {
      ctx.save(); ctx.globalAlpha = a * st.panel;
      frame(ctx, 0, 0, PW, PH, 14 * k, k, C.edge, 'hsl(214 30% 6%)');
      ctx.restore();
    }

    // ── Пустая щель: пунктир силуэта
    if (!card || !inSlot || status === 'Пусто') {
      ctx.save(); ctx.globalAlpha = a * .5;
      ctx.strokeStyle = 'hsla(0,0%,100%,.25)'; ctx.lineWidth = Math.max(1, k);
      ctx.setLineDash([4 * k, 4 * k]); ctx.strokeRect(Hx, Hy, cw, chh);
      ctx.restore();
    }

    const cardCv = cardCanvas(cw, chh, k, m);
    const putCard = (P) => {
      ctx.save();
      ctx.globalAlpha = a * (P.o == null ? 1 : P.o);
      ctx.translate(P.x + P.s * cw / 2, P.y + P.s * chh / 2);
      ctx.rotate((P.r || 0) * Math.PI / 180);
      ctx.scale(P.s, P.s);
      ctx.drawImage(cardCv, -cw / 2, -chh / 2, cw, chh);
      // Блик по картинке в полёте (.rdk-card.fly .rdk-art::after)
      if (shine >= 0) {
        const ax = -cw / 2 + 5 * k, ay = -chh / 2 + 5 * k, aw = cw - 10 * k, ah = chh * .54;
        const sx = ax + aw * (-.75 + 1.5 * Math.min(1, shine / .9));
        ctx.beginPath(); ctx.rect(ax, ay, aw, ah); ctx.clip();
        const g = ctx.createLinearGradient(sx - aw * .4, ay, sx + aw * .4, ay + ah * .5);
        g.addColorStop(0, 'hsla(0,0%,100%,0)'); g.addColorStop(.47, 'hsla(0,0%,100%,.2)');
        g.addColorStop(.53, `hsla(${m.hue},90%,80%,.12)`); g.addColorStop(1, 'hsla(0,0%,100%,0)');
        ctx.fillStyle = g; ctx.fillRect(ax, ay, aw, ah);
      }
      // Чип «читается»: бегущий отсвет, пока играет
      if (inSlot && led === 'play' && live) {
        const cx = -cw / 2 + 8 * k, cy = -chh / 2 + chh * .54 + 12 * k, w2 = 21 * k, h2 = 13 * k;
        const ph = ((t % 1.6) + 1.6) % 1.6 / 1.6;
        const sx = cx + w2 * (1.5 - 2 * ph);
        ctx.beginPath(); ctx.rect(cx, cy, w2, h2); ctx.clip();
        const g = ctx.createLinearGradient(sx - w2 * .4, 0, sx + w2 * .4, 0);
        g.addColorStop(0, 'hsla(0,0%,100%,0)'); g.addColorStop(.5, 'hsla(0,0%,100%,.55)'); g.addColorStop(1, 'hsla(0,0%,100%,0)');
        ctx.fillStyle = g; ctx.fillRect(cx, cy, w2, h2);
      }
      ctx.restore();
    };

    // Карта в щели — под панелью считывателя
    if (card && inSlot) {
      ctx.save(); ctx.beginPath(); ctx.rect(bay.x - 40 * k, -h, bay.w + 80 * k, slit + h); ctx.clip();
      putCard(card); ctx.restore();
    }

    // ── Панель считывателя (.rdk-lip)
    const lx = bay.x, ly = slit, lw = bay.w, lh = bay.y + bay.h - slit;
    frame(ctx, lx, ly, lw, lh, 10 * k, k,
      cssGrad(ctx, lx, ly, lw, lh, 180, [[0, C.edge], [1, C.metal]]),
      cssGrad(ctx, lx, ly, lw, lh, 180, [[0, C.metalHi], [.45, C.metal], [1, C.metal]]));
    // Щель: светится, когда карта на подлёте
    ctx.save();
    ctx.fillStyle = C.slot; ctx.fillRect(lx + 9 * k, ly, lw - 18 * k, 5 * k);
    if (want > 0) {
      ctx.globalAlpha = a * want; ctx.shadowColor = `hsla(${m.hue},70%,55%,.8)`; ctx.shadowBlur = 14 * k;
      ctx.fillStyle = `hsl(${m.hue} 60% 55%)`; ctx.fillRect(lx + 9 * k, ly, lw - 18 * k, 5 * k);
    }
    ctx.restore();

    // Полоски спектра (radio.js viz: 16 полос, степень 1.8)
    const vx = lx + 12 * k, vw = Math.min(96 * k, lw - 24 * k), vh = 22 * k;
    const sty = ly + lh - 8 * k - 9.5 * k, vy = sty - 5 * k - vh;
    if (led === 'play' && live && freq && freq.length) {
      const n = 16, bw = vw / n, len = freq.length;
      ctx.fillStyle = `hsl(${m.hue} 70% 62%)`;
      for (let i = 0; i < n; i++) {
        const lo = Math.floor(Math.pow(i / n, 1.8) * len * .7), hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.8) * len * .7));
        let mx = 0; for (let j = lo; j < hi; j++) mx = Math.max(mx, freq[j]);
        const bh = Math.max(k, (mx / 255) * vh);
        ctx.fillRect(vx + i * bw + k, vy + vh - bh, bw - 2 * k, bh);
      }
    }

    // Огонёк + статус
    const blink = (per) => (((t % per) + per) % per) < per / 2 ? 1 : .2;
    const ledCol = led === 'read' ? C.read : led === 'play' ? C.te : C.t4;
    ctx.save();
    ctx.globalAlpha = a * (led === 'read' ? blink(.14) : 1);
    if (led !== 'off') { ctx.shadowColor = ledCol; ctx.shadowBlur = (led === 'read' ? 10 : 8) * k; }
    ctx.fillStyle = ledCol; ctx.beginPath(); ctx.arc(vx + 3 * k, sty + 4.75 * k, 3 * k, 0, 7); ctx.fill();
    ctx.restore();
    ctx.font = `600 ${9.5 * k}px ${FM}`; spaced(ctx, 9.5 * k, .22);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = led === 'read' ? 'hsl(205 20% 74%)' : C.t3;
    ctx.fillText(status.toUpperCase(), vx + 13 * k, sty + 4.75 * k);

    // Карта в полёте — поверх всего
    if (card && !inSlot) putCard(card);

    // ── Сейчас играет: шапка, название, исполнитель, прогресс
    if (metaA > 0) {
      ctx.save(); ctx.globalAlpha = a * Math.min(1, metaA);
      const tx = metaX, tw = metaW;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = `600 ${10 * k}px ${FM}`; spaced(ctx, 10 * k, .22); ctx.fillStyle = C.t4;
      ctx.fillText(fitText(ctx, (st.playlist + ' · ' + String(m.n).padStart(2, '0')).toUpperCase(), tw), tx, bay.y + 2 * k);
      ctx.font = `700 ${26 * k}px ${FD}`; spaced(ctx, 26 * k, .04); ctx.fillStyle = C.t1;
      ctx.fillText(fitText(ctx, m.title.toUpperCase(), tw), tx, bay.y + 17 * k);
      ctx.font = `500 ${13 * k}px Inter, sans-serif`; spaced(ctx, 0, 0); ctx.fillStyle = C.t3;
      ctx.fillText(fitText(ctx, m.artist || '', tw), tx, bay.y + 49 * k);
      // Прогресс
      if (D > 0) {
        const py = bay.y + bay.h - 24 * k, p = live ? Math.max(0, Math.min(1, t / D)) : 0;
        ctx.fillStyle = 'hsla(0,0%,100%,.08)'; ctx.fillRect(tx, py, tw, 4 * k);
        ctx.fillStyle = `hsl(${m.hue} 60% 60%)`; ctx.fillRect(tx, py, tw * p, 4 * k);
        ctx.font = `600 ${11 * k}px ${FM}`; spaced(ctx, 0, 0); ctx.fillStyle = C.t3;
        const fm = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
        ctx.fillText(fm(live ? Math.max(0, t) : 0) + ' / ' + fm(D), tx, py + 11 * k);
      }
      ctx.restore();
    }
    spaced(ctx, 0, 0);
    ctx.restore();
  }

  /* ── Звук: синтез из radio.js, в любой контекст ── */
  const noiseOf = new WeakMap();
  function sfx(ac, dest, kind, n) {
    let noise = noiseOf.get(ac);
    if (!noise) {
      noise = ac.createBuffer(1, Math.floor(ac.sampleRate * .4), ac.sampleRate);
      const d = noise.getChannelData(0);
      let s = 12345;   // детерминированный шум: экспорт всегда звучит одинаково
      for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
      noiseOf.set(ac, noise);
    }
    const burst = (at, dur, f, q, v, f1) => {
      const s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noise; bp.type = 'bandpass'; bp.frequency.setValueAtTime(f, at);
      if (f1) bp.frequency.exponentialRampToValueAtTime(f1, at + dur); bp.Q.value = q;
      g.gain.setValueAtTime(v, at); g.gain.exponentialRampToValueAtTime(.001, at + dur);
      s.connect(bp); bp.connect(g); g.connect(dest); s.start(at); s.stop(at + dur + .02);
    };
    const tone = (at, dur, f0, f1, v, type) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, at); if (f1) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(v, at + .004); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
      o.connect(g); g.connect(dest); o.start(at); o.stop(at + dur + .02);
    };
    if (kind === 'lift') burst(n, .2, 1600, .9, .1, 5200);
    else if (kind === 'eject') { burst(n, .03, 3600, 2, .5); tone(n, .06, 700, 260, .14, 'square'); burst(n + .03, .2, 1200, 1.1, .16, 4000); }
    else if (kind === 'insert') { burst(n, .11, 2600, .9, .14, 900); tone(n + .09, .14, 150, 52, .4); burst(n + .09, .025, 4200, 3, .55); burst(n + .15, .02, 2500, 4, .35); }
    else if (kind === 'read') [0, .06, .12, .24].forEach((d, i) => tone(n + d, .04, [1760, 2350, 1980, 2640][i], 0, .035, 'square'));
  }

  // Превью: события, попавшие между прошлым и этим кадром
  function tickSfx(T0, T1, dur) {
    if (!st.on || T1 <= T0 || T1 - T0 > .25) return;
    const ac = AudioEngine.ctx, bus = AudioEngine.bus;
    if (!ac || !bus) return;
    events(dur).forEach(e => { if (e.t > T0 && e.t <= T1) sfx(ac, bus, e.k, ac.currentTime + .005); });
  }

  // Экспорт: дорожка = lead-in тишины + песня + звуки карты
  async function renderAudio(buffer) {
    const L = lead(), ev = events(buffer.duration);
    if (!L && !ev.length) return buffer;
    const sr = buffer.sampleRate, nch = Math.min(2, buffer.numberOfChannels);
    const oc = new OfflineAudioContext(nch, Math.ceil((buffer.duration + L) * sr), sr);
    const src = oc.createBufferSource(); src.buffer = buffer; src.connect(oc.destination); src.start(L);
    const g = oc.createGain(); g.gain.value = .7; g.connect(oc.destination);   // как master радио (vol .5 × .7 ≈ на слух)
    ev.forEach(e => sfx(oc, g, e.k, Math.max(0, e.t + L)));
    return oc.startRendering();
  }

  /* ══════════════════════════════════════════════
     Панель настроек (кнопка в шапке)
  ══════════════════════════════════════════════ */
  let panelEl = null;
  function fillPanel() {
    if (!panelEl) return;
    const m = meta(), raw = st.tracks[file] || {};
    const $ = s => panelEl.querySelector(s);
    $('[data-k="file"]').textContent = file || '— трек не загружен —';
    $('[data-k="title"]').value = raw.title != null ? raw.title : '';
    $('[data-k="title"]').placeholder = m.title;
    $('[data-k="artist"]').value = raw.artist != null ? raw.artist : '';
    $('[data-k="artist"]').placeholder = fromName(file).artist || 'Исполнитель';
    $('[data-k="n"]').value = m.n;
    $('[data-k="img"]').textContent = m.img ? 'Картинка ✓ (сменить)' : 'Картинка карты…';
  }

  function buildUI() {
    const header = document.querySelector('header') || document.querySelector('.header');
    if (!header || document.getElementById('cardDeckBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'cardDeckBtn';
    btn.style.cssText = "background:transparent;border:1px solid #00e5ff;color:#00e5ff;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;padding:6px 12px;cursor:pointer;margin-right:6px;";
    btn.textContent = '▣ КАРТА';
    btn.title = 'Карта песни вставляется в считыватель, как в радио игры';
    const anchor = document.getElementById('autoDirectorBtn') || document.getElementById('factoryPresetBtn');
    if (anchor && anchor.parentNode === header) header.insertBefore(btn, anchor); else header.appendChild(btn);
    btn.addEventListener('click', toggle);
  }

  function toggle() {
    if (panelEl) { panelEl.remove(); panelEl = null; return; }
    const p = document.createElement('div');
    p.style.cssText = "position:fixed;top:52px;right:16px;z-index:9999;width:300px;max-height:80vh;overflow-y:auto;background:#0d0d0d;border:1px solid #333;padding:14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#ddd;box-shadow:0 12px 40px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:9px;";
    const row = (label, html) => `<label style="display:flex;flex-direction:column;gap:4px;"><span style="color:#888;letter-spacing:1px;text-transform:uppercase;font-size:9px;">${label}</span>${html}</label>`;
    const inp = 'style="background:#161616;border:1px solid #333;color:#eee;padding:5px 6px;font:inherit;"';
    p.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;"><b style="color:#00e5ff;letter-spacing:2px;">▣ КАРТА В СЧИТЫВАТЕЛЕ</b><button data-k="x" style="background:none;border:0;color:#888;cursor:pointer;font-size:14px;">✕</button></div>` +
      `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" data-k="on"${st.on ? ' checked' : ''}> Включено (lead-in ${T_().lead.toFixed(1)} с перед песней)</label>` +
      `<div style="color:#666;font-size:10px;" data-k="file"></div>` +
      row('Название', `<input data-k="title" ${inp}>`) +
      row('Исполнитель', `<input data-k="artist" ${inp}>`) +
      row('Номер карты', `<input data-k="n" type="number" min="1" max="99" ${inp}>`) +
      `<button data-k="img" ${inp.replace('style="', 'style="cursor:pointer;')}></button><input type="file" accept="image/*" data-k="imgf" hidden>` +
      `<button data-k="imgx" ${inp.replace('style="', 'style="cursor:pointer;color:#888;')}>Без картинки — узор по названию</button>` +
      row('Плейлист (шапка)', `<input data-k="playlist" value="" ${inp}>`) +
      row('Угол', `<select data-k="corner" ${inp}>${[['bl', 'низ-лево'], ['br', 'низ-право'], ['bc', 'низ-центр'], ['tl', 'верх-лево'], ['tr', 'верх-право']].map(o => `<option value="${o[0]}"${st.corner === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`) +
      row('Размер', `<input type="range" data-k="size" min="0.07" max="0.25" step="0.005" value="${st.size}">`) +
      row('Подложка', `<input type="range" data-k="panel" min="0" max="1" step="0.05" value="${st.panel}">`) +
      row('Скорость (1 — как в игре)', `<input type="range" data-k="speed" min="1" max="2" step="0.05" value="${st.speed}">`) +
      `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" data-k="eject"${st.eject ? ' checked' : ''}> В конце карта выезжает</label>`;
    document.body.appendChild(p);
    panelEl = p;
    const $ = s => p.querySelector(s);
    $('[data-k="playlist"]').value = st.playlist;
    fillPanel();
    $('[data-k="x"]').onclick = toggle;
    $('[data-k="on"]').onchange = e => { st.on = e.target.checked; save(); };
    $('[data-k="eject"]').onchange = e => { st.eject = e.target.checked; save(); };
    $('[data-k="title"]').oninput = e => setMeta({ title: e.target.value });
    $('[data-k="artist"]').oninput = e => setMeta({ artist: e.target.value });
    $('[data-k="n"]').oninput = e => setMeta({ n: Math.max(1, Math.min(99, +e.target.value || 1)) });
    $('[data-k="playlist"]').oninput = e => { st.playlist = e.target.value; save(); };
    $('[data-k="corner"]').onchange = e => { st.corner = e.target.value; save(); };
    ['size', 'panel', 'speed'].forEach(n => { $(`[data-k="${n}"]`).oninput = e => { st[n] = +e.target.value; save(); cardKey = ''; }; });
    $('[data-k="img"]').onclick = () => $('[data-k="imgf"]').click();
    $('[data-k="imgx"]').onclick = () => { setMeta({ img: '' }); fillPanel(); };
    $('[data-k="imgf"]').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      // Ужимаем до 512 px: карточка хранится в localStorage
      const im = new Image(), url = URL.createObjectURL(f);
      im.onload = () => {
        const s = Math.min(1, 512 / Math.max(im.width, im.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        setMeta({ img: cv.toDataURL('image/jpeg', .85) }); fillPanel();
      };
      im.src = url;
    };
  }

  return {
    lead: lead, draw: draw, tickSfx: tickSfx, renderAudio: renderAudio, events: events,
    setTrack: setTrack, setMeta: setMeta, setAlbum: setAlbum, meta: meta, ready: ready, buildUI: buildUI, toggle: toggle,
    get settings() { return st; },
  };
})();
