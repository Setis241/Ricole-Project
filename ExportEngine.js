/* ═══════════════════════════════════════════════
   js/ExportEngine.js
   Offline renderer — покадровый рендер без лагов.
   Аналог "Add to Render Queue" в After Effects.

   Требует Chrome/Edge 94+ (WebCodecs API).
   Требует webm-muxer.js рядом с index.html.
   Зависит от: AudioEngine, BackgroundEngine,
               TextRenderer, AnimModes, SpringPhysics
═══════════════════════════════════════════════ */
const ExportEngine = (() => {

  /* ── Пресеты ─────────────────────────────── */
  const PRESETS = [
    {
      key:  'yt_1080_60', icon: '▶',
      label: 'YouTube 1080p 60fps', badge: 'РЕКОМЕНДУЕТСЯ',
      sub:  '1920 × 1080 · 60 fps · 12 Mbps',
      w: 1920, h: 1080, fps: 60, vbr: 12_000_000, abr: 192_000,
    },
    {
      key:  'yt_1080', icon: '▷',
      label: 'YouTube 1080p 30fps', badge: '',
      sub:  '1920 × 1080 · 30 fps · 8 Mbps',
      w: 1920, h: 1080, fps: 30, vbr: 8_000_000, abr: 192_000,
    },
    {
      key:  'yt_4k', icon: '4K',
      label: 'YouTube 4K 30fps', badge: '',
      sub:  '3840 × 2160 · 30 fps · 35 Mbps',
      w: 3840, h: 2160, fps: 30, vbr: 35_000_000, abr: 320_000,
    },
    {
      key:  'reels', icon: '↕',
      label: 'Reels / TikTok', badge: 'ВЕРТИКАЛЬ',
      sub:  '1080 × 1920 · 30 fps · 8 Mbps',
      w: 1080, h: 1920, fps: 30, vbr: 8_000_000, abr: 192_000,
    },
    {
      key:  'sq', icon: '■',
      label: 'Instagram Square', badge: '',
      sub:  '1080 × 1080 · 30 fps · 6 Mbps',
      w: 1080, h: 1080, fps: 30, vbr: 6_000_000, abr: 192_000,
    },
    {
      key:  'twitter', icon: '𝕏',
      label: 'Twitter / X', badge: '',
      sub:  '1280 × 720 · 30 fps · 5 Mbps',
      w: 1280, h: 720, fps: 30, vbr: 5_000_000, abr: 128_000,
    },
    {
      key:  'draft', icon: '⚡',
      label: 'Draft (быстро)', badge: 'БЫСТРЫЙ',
      sub:  '854 × 480 · 30 fps · 2 Mbps',
      w: 854, h: 480, fps: 30, vbr: 2_000_000, abr: 128_000,
    },
  ];

  /* ── FFT (Cooley-Tukey) ──────────────────── */
  function computeFFT(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cRe = 1, cIm = 0;
        for (let j = 0; j < (len >> 1); j++) {
          const uR = re[i+j], uI = im[i+j];
          const vR = re[i+j+(len>>1)]*cRe - im[i+j+(len>>1)]*cIm;
          const vI = re[i+j+(len>>1)]*cIm + im[i+j+(len>>1)]*cRe;
          re[i+j] = uR+vR; im[i+j] = uI+vI;
          re[i+j+(len>>1)] = uR-vR; im[i+j+(len>>1)] = uI-vI;
          [cRe, cIm] = [cRe*wRe - cIm*wIm, cRe*wIm + cIm*wRe];
        }
      }
    }
  }

  /* ── Предрасчёт FFT для каждого кадра ────── */
  function precomputeFreqFrames(audioBuffer, fps, fftSize = 1024) {
    const sr    = audioBuffer.sampleRate;
    const total = Math.ceil(audioBuffer.duration * fps);

    const mono = new Float32Array(audioBuffer.length);
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const ch = audioBuffer.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / audioBuffer.numberOfChannels;
    }

    const hann = Float32Array.from({length: fftSize},
      (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize)));

    const frames = [];
    for (let f = 0; f < total; f++) {
      const center = Math.round(f * sr / fps);
      const start  = Math.max(0, center - (fftSize >> 1));
      const re = new Float32Array(fftSize);
      const im = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) re[i] = (mono[start + i] || 0) * hann[i];
      computeFFT(re, im);

      const freq = new Uint8Array(fftSize >> 1);
      for (let i = 0; i < (fftSize >> 1); i++) {
        const mag = Math.sqrt(re[i]*re[i] + im[i]*im[i]) / (fftSize >> 1);
        const db  = 20 * Math.log10(mag + 1e-9);
        freq[i] = Math.max(0, Math.min(255, ((db + 90) / 90) * 255));
      }
      frames.push(freq);
    }
    return frames;
  }

  /* ── Локальный FrequencyBands ─────────────── */
  function makeLocalBands() {
    let smooth = { bass: 0, mid: 0, high: 0, overall: 0 };
    function hzToBin(hz, sr, fftSize) { return Math.floor(hz / (sr / fftSize)); }
    function bandEnergy(data, lo, hi, sr, fftSize) {
      const a = hzToBin(lo, sr, fftSize);
      const b = Math.min(hzToBin(hi, sr, fftSize), data.length - 1);
      let sum = 0;
      for (let i = a; i <= b; i++) sum += data[i];
      return sum / ((b - a + 1) * 255);
    }
    return {
      // dt обязателен — передаётся из основного цикла рендера (1/fps для экспорта)
      analyze(data, sr = 44100, fftSize = 1024, dt = 1 / 60) {
        const raw = {
          bass:    bandEnergy(data,   20,   200, sr, fftSize),
          mid:     bandEnergy(data,  200,  4000, sr, fftSize),
          high:    bandEnergy(data, 4000, 16000, sr, fftSize),
          overall: bandEnergy(data,   20, 20000, sr, fftSize),
        };
        // Идентичная логика с physics-and-anim.js FrequencyBands.analyze():
        // время-доменные tau, frame-rate independent.
        for (const k in raw) {
          const tau = raw[k] > smooth[k]
            ? (k === 'bass' ? 0.039 : 0.028)
            : (k === 'bass' ? 0.200 : 0.131);
          const alpha = 1 - Math.exp(-dt / tau);
          smooth[k] += (raw[k] - smooth[k]) * alpha;
        }
        return { ...smooth };
      }
    };
  }

  /* ── Seek видео фона ─────────────────────── */
  function seekVideo(video, t) {
    return new Promise(resolve => {
      if (!video || video.readyState < 1) { resolve(); return; }
      if (Math.abs(video.currentTime - t) < 1 / 60) { resolve(); return; }
      const done = () => { video.removeEventListener('seeked', done); resolve(); };
      video.addEventListener('seeked', done);
      video.currentTime = t;
    });
  }

  /* ── Аудио-энкодер ───────────────────────── */
  async function encodeAudio(audioBuffer, abr, muxer) {
    if (typeof AudioEncoder === 'undefined') {
      console.warn('AudioEncoder недоступен, аудио пропущено');
      return;
    }
    const sr  = audioBuffer.sampleRate;
    const nch = Math.min(audioBuffer.numberOfChannels, 2);
    const FRAME_SZ = 1024;

    const encoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error:  e => console.error('AudioEncoder:', e),
    });

    encoder.configure({
      codec:            'opus',
      sampleRate:       sr,
      numberOfChannels: nch,
      bitrate:          abr,
    });

    // ── Opus pre-skip fix ────────────────────────────────────────────────────
    // Opus-энкодер имеет встроенный "encoder delay" (pre-skip) ~312 сэмплов при 48kHz.
    // Эти первые сэмплы — мусор от инициализации кодека. Декодер должен их выбросить:
    // количество задаётся в поле pre-skip Opus ID-заголовка, который muxer пишет
    // в CodecPrivate из decoderConfig.description первого чанка.
    //
    // НО: данный webm-muxer не поддерживает CodecDelay и не принимает отрицательные
    // timestamps. Поэтому единственный рабочий способ — прекодировать фрейм тишины
    // ровно на opusPreSkip сэмплов ДО реального аудио. Декодер выбрасывает pre-skip
    // из тишины (не слышно), а реальное аудио идёт чистым с самого начала.
    const opusPreSkip = Math.round(sr * 0.0065); // ~6.5ms при любом sr
    let timestampOffset = 0;

    {
      const silenceData  = new Float32Array(opusPreSkip * nch); // нули = тишина
      const silenceFrame = new AudioData({
        format:           'f32',
        sampleRate:       sr,
        numberOfFrames:   opusPreSkip,
        numberOfChannels: nch,
        timestamp:        0,
        data:             silenceData,
      });
      encoder.encode(silenceFrame);
      silenceFrame.close();
      // Сдвигаем все реальные timestamp'ы вперёд на длину тишины
      timestampOffset = opusPreSkip;
    }

    // Soft limiter: tanh с headroom -0.5 dBFS предотвращает клиппинг и
    // звуковые артефакты ("пердёж") при пиках выше 1.0 в исходнике.
    // tanh(x) никогда не выходит за [-1, 1], при этом до ~0.9 почти линейна.
    const LIMIT_GAIN = 0.9441; // -0.5 dBFS headroom
    const softLimit = v => Math.tanh(v * LIMIT_GAIN);

    for (let offset = 0; offset < audioBuffer.length; offset += FRAME_SZ) {
      const sz   = Math.min(FRAME_SZ, audioBuffer.length - offset);
      const data = new Float32Array(sz * nch);

      if (nch === 1) {
        const src = audioBuffer.getChannelData(0);
        for (let i = 0; i < sz; i++) data[i] = softLimit(src[offset + i] || 0);
      } else {
        const ch0 = audioBuffer.getChannelData(0);
        const ch1 = audioBuffer.getChannelData(Math.min(1, audioBuffer.numberOfChannels - 1));
        for (let i = 0; i < sz; i++) {
          data[i * 2]     = softLimit(ch0[offset + i] || 0);
          data[i * 2 + 1] = softLimit(ch1[offset + i] || 0);
        }
      }

      // Точный timestamp в микросекундах
      const timestamp = Math.floor((timestampOffset / sr) * 1_000_000);

      const ad = new AudioData({
        format:           'f32',
        sampleRate:       sr,
        numberOfFrames:   sz,
        numberOfChannels: nch,
        timestamp,
        data,
      });
      encoder.encode(ad);
      ad.close();

      timestampOffset += sz;

      if (encoder.encodeQueueSize > 20) await encoder.flush();
    }

    await encoder.flush();
    encoder.close();
  }

  /* ── Основной рендер ─────────────────────── */
  async function doRender(preset, appState) {
    const { lyrics, params } = appState;
    const audioBuffer = AudioEngine.buffer;

    if (!audioBuffer) {
      alert('Загрузи аудио-файл перед экспортом!'); return;
    }
    if (!lyrics || lyrics.length === 0) {
      alert('Нет текста. Введи LRC и нажми «Загрузить» перед экспортом!'); return;
    }
    if (typeof VideoEncoder === 'undefined') {
      alert('Твой браузер не поддерживает WebCodecs.\nИспользуй Chrome или Edge 94+.'); return;
    }
    if (!window.WebMMuxer) {
      alert('webm-muxer.js не найден!\nПоложи webm-muxer.js рядом с index.html.'); return;
    }

    const { w, h, fps, vbr, abr } = preset;
    const dt          = 1 / fps;
    const duration    = audioBuffer.duration;
    const totalFrames = Math.ceil(duration * fps);
    const sr          = audioBuffer.sampleRate;
    const nch         = Math.min(audioBuffer.numberOfChannels, 2);

    setProgress(0, 'Анализ звука…');
    await tick();
    const freqFrames = precomputeFreqFrames(audioBuffer, fps);

    const offCanvas = document.createElement('canvas');
    offCanvas.width = w; offCanvas.height = h;
    const offCtx = offCanvas.getContext('2d', { willReadFrequently: false });

    const { Muxer, ArrayBufferTarget } = window.WebMMuxer;
    const target = new ArrayBufferTarget();
    const muxer  = new Muxer({
      target,
      video: { codec: 'V_VP9', width: w, height: h, frameRate: fps },
      audio: { codec: 'A_OPUS', sampleRate: sr, numberOfChannels: nch, bitrate: abr },
      firstTimestampBehavior: 'permissive',
    });

    // VP9 профиль: level 4.1 для 1080p60/4K, 3.1 для остального
    const needsHighLevel = (w >= 1920 && fps >= 60) || w >= 3840;
    const vp9Codec = needsHighLevel ? 'vp09.00.41.08' : 'vp09.00.31.08';

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error:  e => { console.error('VideoEncoder:', e); throw e; },
    });
    videoEncoder.configure({
      codec: vp9Codec, width: w, height: h, bitrate: vbr, framerate: fps,
      bitrateMode: 'constant',
      latencyMode: 'quality',
    });

    const localSprings = {
      scale:   new SpringPhysics({ stiffness: 0.15,       damping: 0.35,       initial: 1 }),
      offsetY: new SpringPhysics({ stiffness: 0.15 * 0.7, damping: 0.35 * 1.1, initial: 0 }),
      offsetX: new SpringPhysics({ stiffness: 0.15 * 0.8, damping: 0.35,       initial: 0 }),
    };
    const localBands = makeLocalBands();

    if (typeof BackgroundEngine !== 'undefined') BackgroundEngine.resetCamera();
    const bgMedia   = BackgroundEngine?.mediaElement;
    const isBgVideo = bgMedia instanceof HTMLVideoElement;
    if (isBgVideo) { bgMedia.pause(); bgMedia.currentTime = 0; }

    // Для видео-фона: ждём seeked один раз в начале, потом идём пофреймово
    // Дёргать currentTime каждый кадр без await seeked — норма для offline render,
    // т.к. видео декодируется синхронно в offscreen контексте при drawImage
    let videoSeeked = false;
    if (isBgVideo) {
      await seekVideo(bgMedia, 0);
      videoSeeked = true;
    }

    let activeIdx = -1;
    // Прогресс обновляем не чаще чем раз в 30 кадров чтобы не тормозить event loop
    const TICK_INTERVAL = 30;
    setProgress(5, `Рендер кадров…`);
    await tick();

    for (let fi = 0; fi < totalFrames; fi++) {
      if (fi % TICK_INTERVAL === 0) {
        setProgress(5 + Math.round(fi / totalFrames * 78), `Кадр ${fi} / ${totalFrames}`);
        await tick();
      }

      const t        = fi * dt;
      const freqData = freqFrames[fi];
      const bands    = localBands.analyze(freqData, sr, 1024, dt);

      let newIdx = -1;
      for (let i = lyrics.length - 1; i >= 0; i--) {
        if (t >= lyrics[i].time) { newIdx = i; break; }
      }
      if (newIdx !== activeIdx) {
        activeIdx = newIdx;
        // НЕ сбрасываем scale для плавности зума между строками
        // localSprings.scale.reset(1);
        localSprings.offsetY.reset(0);
        localSprings.offsetX.reset(0);
        if (activeIdx >= 0 && lyrics[activeIdx]?.bgCommands) {
          lyrics[activeIdx].bgCommands.forEach(
            cmd => BackgroundEngine.applyBackgroundCommand(cmd)
          );
        }
      }

      localSprings.scale.update(dt);
      localSprings.offsetY.update(dt);
      localSprings.offsetX.update(dt);

      // Видео-фон: seek с ожиданием каждые N кадров для точной синхронизации
      // Между seek'ами браузер сам движет currentTime при drawImage
      if (isBgVideo && bgMedia.readyState >= 2) {
        const targetT = t;
        const drift = Math.abs(bgMedia.currentTime - targetT);
        // Принудительный seek если дрейф > половины кадра или каждые 2 секунды
        if (drift > dt * 0.5 || fi % (fps * 2) === 0) {
          bgMedia.currentTime = targetT;
          // Короткое ожидание только при значительном дрейфе
          if (drift > dt * 3) await new Promise(r => { const s = () => { bgMedia.removeEventListener('seeked', s); r(); }; bgMedia.addEventListener('seeked', s); });
        }
      }

      // КРИТИЧНО: Сбрасываем состояние canvas перед каждым кадром
      offCtx.save();
      offCtx.globalAlpha = 1;
      offCtx.globalCompositeOperation = 'source-over';
      offCtx.filter = 'none';
      offCtx.shadowBlur = 0;
      offCtx.shadowColor = 'transparent';

      if (BackgroundEngine.hasMedia) {
        BackgroundEngine.draw(offCtx, w, h, bands, t, dt);
      } else {
        offCtx.fillStyle = '#0a0a0a';
        offCtx.fillRect(0, 0, w, h);
      }

      const currentLyric = (activeIdx >= 0 && activeIdx < lyrics.length) ? lyrics[activeIdx] : null;
      BackgroundEngine.drawOverlays('below', offCtx, w, h, bands, t, dt, activeIdx, currentLyric);

      // КРИТИЧНО: Сбрасываем globalAlpha перед рендером текста
      offCtx.globalAlpha = 1;

      if (activeIdx >= 0 && activeIdx < lyrics.length) {
        const lyric   = lyrics[activeIdx];
        const elapsed = t - lyric.time;
        const dur     = activeIdx + 1 < lyrics.length
          ? lyrics[activeIdx + 1].time - lyric.time : 4;

        const fadeA  = TextRenderer.getFadeAlpha(elapsed, dur, params.fadeDur);
        const ls     = lyric.lineStyle || {};
        const font   = ls.font     || params.font;
        const size   = ls.fontSize || params.fontSize;
        const color  = ls.color    || params.color;
        const anim   = ls.animMode || params.animMode;
        const pos    = ls.position || params.textPosition || 'center';
        const modeFn = AnimModes[anim] || AnimModes.pulse;
        
        // Для кинетических layout-режимов передаём слова и размеры холста
        const words  = lyric.text
          ? lyric.text.replace(/\{[^}]+\}/g, '').split(/\s+/).filter(Boolean)
          : [];
        const tr     = modeFn({
          bands, t, params, springs: localSprings,
          words,
          canvasW:  w,
          canvasH:  h,
          elapsed,
          duration: dur,
          fontSize: size,
        });

        // Вычисляем Y позицию
        let textY = h / 2;
        if (pos === 'top') {
          textY = h * 0.15;
        } else if (pos === 'bottom') {
          textY = h * 0.85;
        }

        const mainBottom = TextRenderer.draw(offCtx, lyric, w/2, textY, tr, fadeA, color, font, size, w, t);

        // ── Перевод строки ──────────────────────────
        if (params.showTranslation && lyric.translation) {
          const trSize = Math.max(14, Math.round(size * (params.translationRatio || 0.40)));
          const trY    = (mainBottom ?? textY + size) + trSize * 0.9;
          const trAnim = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0, alpha: 1 };
          TextRenderer.draw(
            offCtx, { text: lyric.translation },
            w / 2, trY,
            trAnim, fadeA,
            params.translationColor || '#999999', font, trSize, w, t
          );
        }
      }

      // КРИТИЧНО: Сбрасываем globalAlpha перед рендером верхних overlays
      offCtx.globalAlpha = 1;

      BackgroundEngine.drawOverlays('above', offCtx, w, h, bands, t, dt, activeIdx, currentLyric);

      // Letterbox поверх всего
      BackgroundEngine.drawLetterboxLayer(offCtx, w, h, bands, dt);

      // КРИТИЧНО: Восстанавливаем состояние canvas после кадра
      offCtx.restore();

      const vf = new VideoFrame(offCanvas, {
        timestamp: Math.round(fi * 1_000_000 / fps),
        duration:  Math.round(1_000_000 / fps),
      });
      // Keyframe каждые 3 секунды (оптимально для YouTube / seekability)
      videoEncoder.encode(vf, { keyFrame: fi % (fps * 3) === 0 });
      vf.close();

      // Flush только если очередь реально переполняется — не тормозим зря
      if (videoEncoder.encodeQueueSize > 60) await videoEncoder.flush();
    }

    setProgress(85, 'Финализация видео…');
    await tick();
    await videoEncoder.flush();
    videoEncoder.close();

    setProgress(90, 'Кодирование звука…');
    await tick();
    await encodeAudio(audioBuffer, abr, muxer);

    setProgress(97, 'Упаковка WebM…');
    await tick();
    muxer.finalize();

    const blob = new Blob([target.buffer], { type: 'video/webm' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `chromatype_${preset.key}_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setProgress(100, 'Готово! Файл сохранён ✓');
    await new Promise(r => setTimeout(r, 2500));
    hideOverlay();
  }

  /* ── Утилиты ─────────────────────────────── */
  function tick() { return new Promise(r => setTimeout(r, 0)); }

  let overlayEl = null;

  function showOverlay(preset) {
    hideOverlay();
    overlayEl = document.createElement('div');
    overlayEl.innerHTML = `
      <style>
        #expOv {
          position:fixed;inset:0;background:rgba(0,0,0,.9);
          display:flex;align-items:center;justify-content:center;
          z-index:9999;font-family:'Space Mono',monospace;
        }
        #expOv .box {
          background:#111;border:1px solid #2a2a2a;border-radius:12px;
          padding:40px 56px;text-align:center;min-width:420px;
        }
        #expOv .eico  { font-size:42px;line-height:1;margin-bottom:12px; }
        #expOv .etit  { font-size:18px;letter-spacing:5px;color:#e8ff00;margin-bottom:4px; }
        #expOv .esub  { font-size:9px;color:#333;letter-spacing:2px;margin-bottom:30px; }
        #expOv .track { background:#1a1a1a;border-radius:3px;height:4px;overflow:hidden;margin-bottom:14px; }
        #expOv .fill  { height:100%;background:#e8ff00;width:0%;transition:width .3s linear; }
        #expOv .emsg  { font-size:9px;color:#444;letter-spacing:2px; }
      </style>
      <div id="expOv"><div class="box">
        <div class="eico">${preset.icon}</div>
        <div class="etit">РЕНДЕР</div>
        <div class="esub">${preset.sub}</div>
        <div class="track"><div class="fill" id="expFill"></div></div>
        <div class="emsg" id="expMsg">ИНИЦИАЛИЗАЦИЯ…</div>
      </div></div>
    `;
    document.body.appendChild(overlayEl);
  }

  function setProgress(pct, msg) {
    const fill  = document.getElementById('expFill');
    const msgEl = document.getElementById('expMsg');
    if (fill)  fill.style.width = pct + '%';
    if (msgEl) msgEl.textContent = msg.toUpperCase();
  }

  function hideOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  }

  /* ── Модальное окно ─────────────────────── */
  function showModal(appState) {
    const existing = document.getElementById('exportModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'exportModal';
    modal.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.85);' +
      'display:flex;align-items:center;justify-content:center;' +
      'z-index:9998;font-family:"Space Mono",monospace;';

    const cards = PRESETS.map(p => `
      <button class="exp-card" data-key="${p.key}">
        <span class="ec-icon">${p.icon}</span>
        <span class="ec-label">${p.label}</span>
        ${p.badge ? `<span class="ec-badge">${p.badge}</span>` : ''}
        <span class="ec-sub">${p.sub}</span>
      </button>
    `).join('');

    modal.innerHTML = `
      <style>
        #exportModal .wrap {
          background:#111;border:1px solid #2a2a2a;border-radius:14px;
          padding:32px 36px;max-width:720px;width:94%;
        }
        #exportModal .hdr {
          display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;
        }
        #exportModal .hdr-title { font-size:22px;letter-spacing:5px;color:#e8ff00; }
        #exportModal .hdr-sub   { font-size:8px;color:#333;letter-spacing:2px;margin-top:4px; }
        #exportModal .close-btn {
          background:none;border:1px solid #222;color:#444;padding:7px 16px;
          cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px;
          border-radius:4px;transition:color .15s,border-color .15s;flex-shrink:0;
        }
        #exportModal .close-btn:hover { color:#e8ff00;border-color:#e8ff00; }
        #exportModal .info-bar {
          background:#0a0a0a;border:1px solid #1a1a1a;border-radius:4px;
          padding:9px 14px;margin-bottom:20px;font-size:8px;
          color:#333;letter-spacing:1px;line-height:2;
        }
        #exportModal .info-bar b { color:#555; }
        #exportModal .grid { display:grid;grid-template-columns:repeat(3,1fr);gap:10px; }
        .exp-card {
          background:#0d0d0d;border:1px solid #1e1e1e;border-radius:8px;
          padding:18px 14px;cursor:pointer;text-align:left;
          display:flex;flex-direction:column;gap:6px;
          transition:border-color .15s,background .15s;
          font-family:inherit;position:relative;
        }
        .exp-card:hover { border-color:#e8ff00;background:#131300; }
        .ec-icon  { font-size:24px;line-height:1; }
        .ec-label { font-size:12px;color:#e8ff00;letter-spacing:1px;font-weight:700; }
        .ec-badge {
          position:absolute;top:10px;right:10px;font-size:7px;letter-spacing:1px;
          color:#000;background:#e8ff00;padding:2px 6px;border-radius:2px;font-weight:700;
        }
        .ec-sub { font-size:8px;color:#333;letter-spacing:.5px; }
        #exportModal .footer { font-size:8px;color:#222;letter-spacing:1px;text-align:center;margin-top:16px; }
        @media(max-width:600px){
          #exportModal .grid{ grid-template-columns:repeat(2,1fr); }
          #exportModal .wrap { padding:20px; }
        }
      </style>
      <div class="wrap">
        <div class="hdr">
          <div>
            <div class="hdr-title">ЭКСПОРТ</div>
            <div class="hdr-sub">ВЫБЕРИ ПРЕСЕТ — РЕНДЕР НАЧНЁТСЯ АВТОМАТИЧЕСКИ</div>
          </div>
          <button class="close-btn" id="expClose">✕ ESC</button>
        </div>
        <div class="info-bar">
          ⚡ <b>OFFLINE RENDER</b> — покадровый рендер, без лагов и записи экрана<br>
          Формат: <b>WebM (VP9 + Opus)</b> · Требуется <b>Chrome / Edge 94+</b>
        </div>
        <div class="grid">${cards}</div>
        <div class="footer">WebCodecs API · webm-muxer · Chromatype Export Engine</div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('expClose').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', esc); }
    });

    modal.querySelectorAll('.exp-card').forEach(card => {
      card.addEventListener('click', async () => {
        const preset = PRESETS.find(p => p.key === card.dataset.key);
        modal.remove();
        showOverlay(preset);
        try {
          await doRender(preset, appState);
        } catch (err) {
          console.error('Export failed:', err);
          setProgress(0, 'Ошибка: ' + String(err.message || err).slice(0, 70));
          await new Promise(r => setTimeout(r, 5000));
          hideOverlay();
        }
      });
    });
  }

  return { showModal };
})();
