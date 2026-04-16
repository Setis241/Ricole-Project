/* ═══════════════════════════════════════════════
   js/App.js
   Главный контроллер CHROMATYPE.
   Склеивает все модули и управляет render-loop.
═══════════════════════════════════════════════ */
const App = (() => {

  // ── Canvas
  const canvas   = document.getElementById('mainCanvas');
  const ctx      = canvas.getContext('2d');
  const spectrum = document.getElementById('spectrumCanvas');
  const spCtx    = spectrum.getContext('2d');

  // ── Пружины для текстовых трансформаций
  const springs = {
    scale:   new SpringPhysics({ stiffness: 0.15, damping: 0.35, initial: 1 }),
    offsetY: new SpringPhysics({ stiffness: 0.10, damping: 0.40, initial: 0 }),
    offsetX: new SpringPhysics({ stiffness: 0.10, damping: 0.40, initial: 0 }),
  };

  // ── Параметры анимации (синхронизированы с UI)
  const params = {
    bassSens:  1.2,
    maxScale:  2.0,
    fadeDur:   0.2,   // секунды
    fontSize:  96,
    font:      "'Bebas Neue', cursive",
    color:     '#ffffff',
    animMode:  'pulse',
    textPosition: 'center', // 'center' | 'top' | 'bottom'
    globalBoxId:        null,   // id из BoxRegistry или null — без рамки
    // ── Перевод ───────────────────────────────
    showTranslation:    true,
    translationRatio:   0.40,   // доля от основного размера шрифта
    translationColor:   '#999999',
    translationGap:     0.85,   // отступ вниз в единицах основного fontSize
  };

  // ── Лирика
  let lyrics    = [];
  let activeIdx = -1;
  let entryTime = 0;

  // ── Loop state
  let rafId     = null;
  let lastT     = 0;

  // ── Resolution map
  const RES = {
    '1920x1080': [1920, 1080],
    '1280x720':  [1280, 720],
    '1080x1080': [1080, 1080],
    '1080x1920': [1080, 1920],
  };

  function setResolution(key) {
    const [w, h] = RES[key] || [1280, 720];
    canvas.width  = w;
    canvas.height = h;
    const maxW = canvas.parentElement.clientWidth  - 32;
    const maxH = canvas.parentElement.clientHeight - 130;
    const s    = Math.min(maxW / w, maxH / h, 1);
    canvas.style.width  = `${Math.round(w * s)}px`;
    canvas.style.height = `${Math.round(h * s)}px`;
  }

  /* ── RENDER LOOP ──────────────────────────── */
  function render(now) {
    rafId = requestAnimationFrame(render);

    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT    = now;

    springs.scale.update(dt);
    springs.offsetY.update(dt);
    springs.offsetX.update(dt);

    // ── Audio analysis
    const freqData = AudioEngine.getFrequencyData();
    const bands    = FrequencyBands.analyze(freqData, AudioEngine.sampleRate, AudioEngine.fftSize, dt);

    const t = AudioEngine.getCurrentTime();

    // ── Лирика: найти активную строку
    if (lyrics.length > 0 && AudioEngine.isPlaying) {
      let newIdx = -1;
      for (let i = lyrics.length - 1; i >= 0; i--) {
        if (t >= lyrics[i].time) { newIdx = i; break; }
      }
      if (newIdx !== activeIdx) {
        activeIdx = newIdx;
        entryTime = t;
        springs.scale.reset(1);
        springs.offsetY.reset(0);
        springs.offsetX.reset(0);
        highlightLyricList(activeIdx);

        // Применяем команды фона
        if (lyrics[activeIdx] && lyrics[activeIdx].bgCommands) {
          lyrics[activeIdx].bgCommands.forEach(cmd => {
            BackgroundEngine.applyBackgroundCommand(cmd);
          });
        }
      }
    }

    // ── Background
    const cw = canvas.width, ch = canvas.height;
    if (BackgroundEngine.hasMedia) {
      BackgroundEngine.draw(ctx, cw, ch, bands, t, dt);
    } else {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, cw, ch);
    }

    // ── Overlays BELOW text
    const currentLyric = (activeIdx >= 0 && activeIdx < lyrics.length) ? lyrics[activeIdx] : null;
    BackgroundEngine.drawOverlays('below', ctx, cw, ch, bands, t, dt, activeIdx, currentLyric);

    // ── Text
    if (activeIdx >= 0 && activeIdx < lyrics.length) {
      const lyric   = lyrics[activeIdx];
      const elapsed = t - lyric.time;
      const dur     = activeIdx + 1 < lyrics.length
        ? lyrics[activeIdx + 1].time - lyric.time
        : 4;

      const fadeA = TextRenderer.getFadeAlpha(elapsed, dur, params.fadeDur);

      // ── Per-line style overrides (от FX Editor) ──
      const ls             = lyric.lineStyle || {};
      const effectiveFont  = ls.font      || params.font;
      const effectiveSize  = ls.fontSize  || params.fontSize;
      const effectiveColor = ls.color     || params.color;
      const effectiveAnim  = ls.animMode  || params.animMode;
      const effectivePos   = ls.position  || params.textPosition;

      const modeFn = AnimModes[effectiveAnim] || AnimModes.pulse;

      // Для кинетических layout-режимов передаём слова и размеры холста
      // Убираем все {FX-теги} перед разбивкой на слова —
      // сами теги нужны только parseSpans в рендерере, не AnimModes
      const words  = lyric.text
        ? lyric.text.replace(/\{[^}]+\}/g, '').split(/\s+/).filter(Boolean)
        : [];
      const anim   = modeFn({
        bands, t, params, springs,
        words,
        canvasW:  cw,
        canvasH:  ch,
        elapsed,
        duration: dur,
        fontSize: effectiveSize,
      });

      // Вычисляем Y позицию в зависимости от настройки
      let textY = ch / 2; // по умолчанию центр
      if (effectivePos === 'top') {
        textY = ch * 0.15; // 15% от верха
      } else if (effectivePos === 'bottom') {
        textY = ch * 0.85; // 85% от верха (15% от низа)
      }

      // draw() возвращает реальный нижний край отрисованного текста —
      // учитывает количество строк, scaleY анимации, offsetY пружин,
      // и позиции слов при kinetic word-layout (flash/cascade/scatter/…)
      const mainBottom = TextRenderer.draw(
        ctx, lyric,
        cw / 2, textY,
        anim, fadeA,
        effectiveColor, effectiveFont, effectiveSize, cw, t,
        params.globalBoxId
      );

      // ── Перевод строки ──────────────────────────
      if (params.showTranslation && lyric.translation) {
        const trSize = Math.max(14, Math.round(effectiveSize * params.translationRatio));
        // Встаём ровно под последней строкой основного текста
        const trY    = (mainBottom ?? textY + effectiveSize) + trSize * 0.9;
        const trAnim = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, alpha: 1 };
        TextRenderer.draw(
          ctx, { text: lyric.translation },
          cw / 2, trY,
          trAnim, fadeA,
          params.translationColor, effectiveFont, trSize, cw, t
        );
      }
    }

    // ── Overlays ABOVE text
    BackgroundEngine.drawOverlays('above', ctx, cw, ch, bands, t, dt, activeIdx, currentLyric);

    // ── Letterbox (поверх всего)
    BackgroundEngine.drawLetterboxLayer(ctx, cw, ch, bands, dt);

    // ── VU & Spectrum
    updateMeters(bands, freqData, t);
  }

  function updateMeters(bands, freqData, t) {
    document.getElementById('vuBass').style.height = `${bands.bass * 100}%`;
    document.getElementById('vuMid' ).style.height = `${bands.mid  * 100}%`;
    document.getElementById('vuHigh').style.height = `${bands.high * 100}%`;

    // Spectrum mini
    const W = spectrum.width, H = spectrum.height;
    spCtx.fillStyle = '#0a0a0a';
    spCtx.fillRect(0, 0, W, H);
    const count = Math.min(80, freqData.length);
    const barW  = W / count;
    for (let i = 0; i < count; i++) {
      const v   = freqData[Math.floor(i * freqData.length / count)] / 255;
      const bh  = v * H;
      const hue = 120 - (i / count) * 120;
      spCtx.fillStyle = `hsl(${hue},90%,55%)`;
      spCtx.fillRect(i * barW, H - bh, barW - 1, bh);
    }

    // Time
    const m  = Math.floor(t / 60);
    const s  = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);
    document.getElementById('timeDisplay').textContent =
      `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  }

  /* ── LYRIC LIST ────────────────────────────── */
  function highlightLyricList(idx) {
    document.querySelectorAll('#lyricList li').forEach((li, i) => {
      li.classList.toggle('active', i === idx);
      if (i === idx) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function parseLyrics() {
    const raw = document.getElementById('lyricsInput').value.trim();
    if (!raw) return;
    lyrics    = LRCParser.parse(raw);
    activeIdx = -1;
    renderLyricList();
  }

  function renderLyricList() {
    const list = document.getElementById('lyricList');
    list.innerHTML = lyrics.map((l, i) => {
      const sectionLabel = l.section
        ? `<span style="color:var(--accent);font-size:9px;margin-right:4px;">[${l.section}]</span>`
        : '';
      // Показываем иконку стиля если строка имеет per-line overrides
      const ls = l.lineStyle || {};
      const hasStyle = ls.font || ls.fontSize || ls.animMode || ls.color;
      const styleIcon = hasStyle ? `<span title="Свой стиль" style="color:var(--accent);margin-right:3px;">✦</span>` : '';
      return `<li data-index="${i}">${styleIcon}${sectionLabel}<span class="ts">${fmtTime(l.time)}</span><span class="txt">${escHtml(l.text)}</span></li>`;
    }).join('');
    
    // Добавляем обработчики кликов
    list.querySelectorAll('li').forEach((li, i) => {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        if (lyrics[i]) {
          // Костыль: сначала стоп, потом плей
          AudioEngine.stop();
          BackgroundEngine.stopVideo();
          BackgroundEngine.resetCamera();
          activeIdx = -1;
          
          // Небольшая задержка перед запуском
          setTimeout(() => {
            AudioEngine.play(lyrics[i].time);
            BackgroundEngine.playVideo();
            BackgroundEngine.resetCamera();
            resetSprings();
            setStatus('playing', 'Playing');
            setStatusDot('play');
          }, 50);
        }
      });
    });
  }

  /* ── UI INIT ───────────────────────────────── */
  function initUI() {
    // Range слайдеры
    const rangeMap = [
      ['bassSens',  'bassSensVal',  v => params.bassSens  = +v],
      ['maxScale',  'maxScaleVal',  v => params.maxScale  = +v],
      ['fadeDur',   'fadeDurVal',   v => params.fadeDur   = +v / 1000],
      ['fontSize',  'fontSizeVal',  v => params.fontSize  = +v],
    ];
    rangeMap.forEach(([id, valId, cb]) => {
      const el  = document.getElementById(id);
      const val = document.getElementById(valId);
      if (!el) return;
      el.addEventListener('input', () => { 
        val.textContent = el.value; 
        cb(el.value);
      });
    });

    bind('fontSelect',  'change', e => { params.font = e.target.value; });
    bind('textColor',   'input',  e => { params.color = e.target.value; });
    bind('animMode',    'change', e => { params.animMode = e.target.value; resetSprings(); });
    bind('textPosition', 'change', e => { params.textPosition = e.target.value; });

    // ── Перевод
    bind('translationToggle', 'click', () => {
      params.showTranslation = !params.showTranslation;
      const el = document.getElementById('translationToggle');
      if (el) el.classList.toggle('on', params.showTranslation);
    });
    const trSizeSlider = document.getElementById('translationSize');
    const trSizeVal    = document.getElementById('translationSizeVal');
    if (trSizeSlider) {
      trSizeSlider.addEventListener('input', () => {
        params.translationRatio = +trSizeSlider.value / 100;
        if (trSizeVal) trSizeVal.textContent = trSizeSlider.value + '%';
      });
    }
    bind('translationColor', 'input', e => { params.translationColor = e.target.value; });
    bind('resolution',  'change', e => { setResolution(e.target.value); });

    // ── Background FX toggles
    ['kenBurns','colorGrade','vignette','chromatic'].forEach(name => {
      const el = document.getElementById(`fx-${name}`);
      if (!el) return;
      el.classList.toggle('on', BackgroundEngine.fxState[name]);
      el.addEventListener('click', () => {
        const val = !BackgroundEngine.fxState[name];
        BackgroundEngine.setFX(name, val);
        el.classList.toggle('on', val);
      });
    });

    // ── Audio
    document.getElementById('audioFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      setStatus('loading', 'Loading audio…');
      const el = document.getElementById('audioDrop');
      el.querySelector('.drop-name').textContent = f.name;
      try {
        await AudioEngine.loadBuffer(await f.arrayBuffer());
        el.classList.add('loaded');
        ['playBtn','stopBtn','recBtn','exportBtn'].forEach(id => {
          const b = document.getElementById(id);
          if (b) b.disabled = false;
        });
        setStatus('ready', `Ready — ${fmtTime(AudioEngine.duration)}`);
      } catch(err) {
        setStatus('error', 'Decode error');
        console.error(err);
      }
    });

    // ── Background image/video
    document.getElementById('bgFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      const el = document.getElementById('bgDrop');
      el.querySelector('.drop-name').textContent = f.name;
      try {
        const type = await BackgroundEngine.load(f);
        el.classList.add('loaded');
        document.getElementById('bgTypeBadge').textContent = type.toUpperCase();
      } catch(err) { console.error('BG load error', err); }
    });

    // ── LRC file upload
    const lrcFileInput = document.getElementById('lrcFile');
    const lrcLoadBtn = document.getElementById('lrcLoadBtn');
    const lrcClearFileBtn = document.getElementById('lrcClearFileBtn');

    lrcLoadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      lrcFileInput.click();
    });

    lrcClearFileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      lrcFileInput.value = '';
      lrcLoadBtn.textContent = '📄 Загрузить';
    });

    lrcFileInput.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      const lyricsInput = document.getElementById('lyricsInput');

      try {
        const text = await f.text();
        lyricsInput.value = text;
        lrcLoadBtn.textContent = `📄 ${f.name}`;
        parseLyrics();
        // Очищаем input чтобы можно было загрузить тот же файл снова
        lrcFileInput.value = '';
      } catch(err) {
        console.error('LRC load error:', err);
      }
    });

    // ── Command buttons
    const lyricsInput = document.getElementById('lyricsInput');

    function insertCommand(cmd) {
      const start = lyricsInput.selectionStart;
      const end   = lyricsInput.selectionEnd;
      const text  = lyricsInput.value;
      lyricsInput.value = text.substring(0, start) + cmd + text.substring(end);
      lyricsInput.selectionStart = lyricsInput.selectionEnd = start + cmd.length;
      lyricsInput.focus();
    }

    bind('cmdSection', 'click', () => {
      const name = prompt('Название секции (например: Verse 1, Chorus):', 'Verse 1');
      if (name) insertCommand(`[${name}]`);
    });

    // ── FX Editor
    bind('fxEditorBtn', 'click', () => {
      const raw = document.getElementById('lyricsInput').value.trim();
      if (!raw) { alert('Сначала введи текст песни!'); return; }
      FxEditor.open(raw, (updatedLRC) => {
        document.getElementById('lyricsInput').value = updatedLRC;
        parseLyrics();
        setStatus('ready', 'FX Applied');
      });
    });

    // ── Overlay Manager
    bind('overlayManagerBtn', 'click', () => {
      FxEditor.openOverlayManager();
    });

    // ── Lyrics
    bind('parseLyricsBtn', 'click', parseLyrics);
    bind('clearLyricsBtn', 'click', () => {
      document.getElementById('lyricsInput').value = '';
      lyrics = []; activeIdx = -1;
      document.getElementById('lyricList').innerHTML = '';
    });

    // ── Transport
    bind('playBtn', 'click', () => {
      parseLyrics();
      AudioEngine.play(0);
      BackgroundEngine.playVideo();
      BackgroundEngine.resetCamera();
      activeIdx = -1;
      resetSprings();
      setStatus('playing', 'Playing');
      setStatusDot('play');
    });

    bind('stopBtn', 'click', () => {
      AudioEngine.stop();
      BackgroundEngine.stopVideo();
      BackgroundEngine.resetCamera();  // Сбрасываем все эффекты и камеру
      if (Recorder.isRecording) Recorder.stop();
      activeIdx = -1;
      setStatus('idle', 'Stopped');
      setStatusDot('');
    });

    bind('recBtn', 'click', async () => {
      const btn = document.getElementById('recBtn');
      if (Recorder.isRecording) {
        await Recorder.stop();
        btn.textContent = '⏺ REC WEBM';
        setStatusDot('play');
        setStatus('playing', 'Saved');
      } else {
        const audioDest = AudioEngine.getAudioDestination();
        Recorder.start(canvas, audioDest);
        btn.textContent = '⏹ STOP REC';
        setStatusDot('rec');
        setStatus('rec', 'Recording…');
      }
    });

    // ── Export button
    bind('exportBtn', 'click', () => {
      ExportEngine.showModal({ lyrics, params });
    });

    // ── Resolve initial res & start loop
    setResolution('1920x1080');
    lastT = performance.now();
    render(lastT);

    // ── Preset Manager UI
    if (typeof PresetManager !== 'undefined') {
      PresetManager.buildUI();
    }

    // ── Global Box selector
    buildGlobalBoxUI();
  }

  function buildGlobalBoxUI() {
    const container = document.getElementById('globalBoxList');
    if (!container || typeof BoxRegistry === 'undefined') return;

    // Кнопка «Нет» (по умолчанию)
    const noneBtn = document.createElement('button');
    noneBtn.className = 'global-box-btn active';
    noneBtn.dataset.boxId = '';
    noneBtn.textContent = '✕ Нет';
    noneBtn.title = 'Без глобальной рамки';
    container.appendChild(noneBtn);

    BoxRegistry.all.forEach(style => {
      const btn = document.createElement('button');
      btn.className = 'global-box-btn';
      btn.dataset.boxId = style.id;
      btn.textContent = `${style.icon} ${style.label}`;
      btn.title = style.label;
      btn.style.setProperty('--gbx-col', style.uiColor);
      container.appendChild(btn);
    });

    container.addEventListener('click', e => {
      const btn = e.target.closest('.global-box-btn');
      if (!btn) return;
      container.querySelectorAll('.global-box-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      params.globalBoxId = btn.dataset.boxId || null;
    });
  }

  /* ── HELPERS ───────────────────────────────── */
  function bind(id, ev, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  }

  function resetSprings() {
    Object.values(springs).forEach(s => s.reset(s.target));
  }

  function setStatus(type, text) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = text.toUpperCase();
  }

  function setStatusDot(cls) {
    const el = document.getElementById('statusDot');
    if (el) el.className = `status-dot ${cls}`;
  }

  function fmtTime(s) {
    if (isNaN(s)) return '00:00';
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return {
    init: initUI,
    getState: () => ({ lyrics, params }),
  };
})();
