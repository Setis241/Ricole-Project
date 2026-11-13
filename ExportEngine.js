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

  /* ── Предрасчёт FFT для каждого кадра ──────
     Воспроизводит AnalyserNode.getByteFrequencyData() 1-в-1,
     чтобы bands.bass в экспорте совпадал с превью:
       • окно Blackman (Web Audio spec), не Hann
       • смещение НАЗАД (последние N сэмплов), не центрированное
       • нормализация магнитуды на fftSize (не на fftSize/2)
       • smoothingTimeConstant = 0.75 на линейных магнитудах
       • dB-диапазон [-100, -30] (дефолты Web Audio)
     Именно отсутствие smoothing'а + неверный dB-диапазон делали
     спектр в экспорте «шипастым» и music-zoom — непохожим на превью.
  */
  function precomputeFreqFrames(audioBuffer, fps, fftSize = 1024) {
    const sr    = audioBuffer.sampleRate;
    const total = Math.ceil(audioBuffer.duration * fps);

    // Моно-даунмикс
    const mono = new Float32Array(audioBuffer.length);
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      const ch = audioBuffer.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / audioBuffer.numberOfChannels;
    }

    // Blackman window — именно его использует Web Audio AnalyserNode.
    // w(n) = 0.42 − 0.5·cos(2πn/(N−1)) + 0.08·cos(4πn/(N−1))
    const win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const x = 2 * Math.PI * i / (fftSize - 1);
      win[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
    }

    // Параметры, идентичные AudioEngine.analyser:
    //   smoothingTimeConstant = 0.75
    //   minDecibels/maxDecibels = -100 / -30 (дефолты Web Audio)
    const TAU      = 0.75;
    const MIN_DB   = -100;
    const MAX_DB   = -30;
    const DB_RANGE = MAX_DB - MIN_DB;

    // Персистентный сглаженный магнитудный спектр между кадрами —
    // эмулирует внутреннее состояние AnalyserNode.
    const prevMag = new Float32Array(fftSize >> 1);

    const frames = [];
    for (let f = 0; f < total; f++) {
      // Web Audio берёт ПОСЛЕДНИЕ N сэмплов (окно смотрит назад).
      // Центрированное окно сдвигало бы тайминг бас-атак на ~11 мс вперёд.
      const end   = Math.round(f * sr / fps);
      const start = Math.max(0, end - fftSize);

      const re = new Float32Array(fftSize);
      const im = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        re[i] = (idx < mono.length ? mono[idx] : 0) * win[i];
      }
      computeFFT(re, im);

      const freq = new Uint8Array(fftSize >> 1);
      for (let i = 0; i < (fftSize >> 1); i++) {
        // Нормализация на fftSize (как в AnalyserNode), не на fftSize/2
        const raw = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / fftSize;

        // Межкадровое сглаживание (AnalyserNode.smoothingTimeConstant) —
        // ключевой шаг, которого не было. Без него экспортный спектр
        // в разы «шипастее» превью и зум реагирует иначе.
        const smoothed = TAU * prevMag[i] + (1 - TAU) * raw;
        prevMag[i] = smoothed;

        const db   = 20 * Math.log10(smoothed + 1e-9);
        const byte = ((db - MIN_DB) / DB_RANGE) * 255;
        freq[i] = Math.max(0, Math.min(255, byte));
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
  // offUs — сдвиг всех меток (трек внутри альбома), forceCh — число каналов потока
  async function encodeAudio(audioBuffer, abr, muxer, offUs, forceCh) {
    offUs = offUs || 0;
    if (typeof AudioEncoder === 'undefined') {
      console.warn('AudioEncoder недоступен, аудио пропущено');
      return;
    }
    const sr  = audioBuffer.sampleRate;
    const nch = forceCh || Math.min(audioBuffer.numberOfChannels, 2);
    const FRAME_SZ = 1024;

    const encoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta, chunk.timestamp + offUs),
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

    // ── ENDING fade: если задан ending.time — затухаем аудио по smoothstep ──
    const _endMarker = (BackgroundEngine.getEndingMarker && BackgroundEngine.getEndingMarker()) || null;
    const _endStartSec = _endMarker ? _endMarker.time : null;
    const _endFadeSec  = _endMarker ? _endMarker.duration * (_endMarker.fadeFrac || 0.35) : 0;

    for (let offset = 0; offset < audioBuffer.length; offset += FRAME_SZ) {
      const sz   = Math.min(FRAME_SZ, audioBuffer.length - offset);
      const data = new Float32Array(sz * nch);

      // Коэффициенты затухания на нужных сэмплах (smootherstep — совпадает с визуальным fade)
      const _gainAt = (sampleIdx) => {
        if (_endStartSec == null) return 1;
        const tSec = sampleIdx / sr;
        const dt = tSec - _endStartSec;
        if (dt <= 0) return 1;
        if (dt >= _endFadeSec) return 0;
        const k = dt / _endFadeSec;
        // smootherstep: k³·(k·(k·6-15)+10)
        const s = k * k * k * (k * (k * 6 - 15) + 10);
        return 1 - s;
      };

      if (nch === 1) {
        const src = audioBuffer.getChannelData(0);
        for (let i = 0; i < sz; i++) {
          const g = _gainAt(offset + i);
          data[i] = (src[offset + i] || 0) * g;
        }
      } else {
        const ch0 = audioBuffer.getChannelData(0);
        const ch1 = audioBuffer.getChannelData(Math.min(1, audioBuffer.numberOfChannels - 1));
        for (let i = 0; i < sz; i++) {
          const g = _gainAt(offset + i);
          data[i * 2]     = (ch0[offset + i] || 0) * g;
          data[i * 2 + 1] = (ch1[offset + i] || 0) * g;
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

      // Backpressure: ждём пока очередь освободится, но НЕ flush'ом —
      // flush в середине потока сбрасывает межкадровое предсказание Opus,
      // что даёт слышимые щелчки/глитчи на стыках. Просто yield'им event loop.
      while (encoder.encodeQueueSize > 20) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Единственный flush — в конце, чтобы добить хвост очереди перед close
    await encoder.flush();
    encoder.close();
  }

  /* ── Основной рендер ─────────────────────── */
  async function doRender(preset, appState, opts) {
    const { lyrics, params } = appState;
    const audioBuffer = AudioEngine.buffer;

    if (!audioBuffer) {
      alert('Загрузи аудио-файл перед экспортом!'); return;
    }
    // Текст не обязателен: без него видео ведут визуализатор и карта песни
    if (typeof VideoEncoder === 'undefined') {
      alert('Твой браузер не поддерживает WebCodecs.\nИспользуй Chrome или Edge 94+.'); return;
    }
    if (!window.WebMMuxer) {
      alert('webm-muxer.js не найден!\nПоложи webm-muxer.js рядом с index.html.'); return;
    }

    // КРИТИЧНО: останавливаем живой рендер-луп на время экспорта.
    // Иначе он параллельно вызывает BackgroundEngine.draw() с bands.bass=0
    // (т.к. аудио не играет во время offline-рендера) и разбалтывает
    // musicZoomSpring / _musicZoomBassSmooth — зум получается не таким,
    // как в превью. Возобновляем в finally ниже.
    const appInstance = (typeof App !== 'undefined') ? App : null;
    appInstance?.pauseLoop?.();

    try {
      return await _doRenderCore(preset, appState, opts);
    } finally {
      appInstance?.resumeLoop?.();
    }
  }

  // opts.keep — не скачивать, вернуть { blob, seconds } (пакетный экспорт альбома)
  async function _doRenderCore(preset, appState, opts) {
    const { lyrics, params } = appState;
    const audioBuffer = AudioEngine.buffer;

    const { w, h, fps, vbr, abr } = preset;
    const dt          = 1 / fps;
    const duration    = audioBuffer.duration;
    // Lead-in карты (CardDeck): кадры до нуля песни — карта вставляется, музыка ещё не идёт
    const lead        = typeof CardDeck !== 'undefined' ? CardDeck.lead() : 0;
    const totalFrames = Math.ceil((duration + lead) * fps);
    const sr          = audioBuffer.sampleRate;
    const nch         = Math.min(audioBuffer.numberOfChannels, 2);

    // ── Прелоад шрифтов ─────────────────────────────────────────
    // Без этого первые ~100-300 кадров рендерятся в дефолтном sans-serif:
    // canvas.fillText() не ждёт загрузки кастомного шрифта, молча подставляя
    // fallback. Браузер скачает шрифт где-то к середине трека → в видео
    // видно как текст переключается со стандартного на нужный прямо в кадре.
    // Лечится принудительной загрузкой всех font/size комбинаций ДО рендера.
    setProgress(0, 'Загрузка шрифтов…');
    await tick();

    if (document.fonts) {
      const fontSpecs = new Set();
      const addFont = (size, family) => {
        if (size && family) fontSpecs.add(`${size}px "${family}"`);
      };

      addFont(params.fontSize, params.font);
      if (params.showTranslation) {
        const trSize = Math.max(14, Math.round(params.fontSize * (params.translationRatio || 0.40)));
        addFont(trSize, params.font);
      }
      for (const lyric of lyrics) {
        const ls = lyric.lineStyle || {};
        addFont(ls.fontSize || params.fontSize, ls.font || params.font);
      }

      await Promise.all([...fontSpecs].map(spec =>
        document.fonts.load(spec).catch(() => {/* недоступный шрифт — пускай fallback */})
      ));
      await document.fonts.ready;
    }

    setProgress(2, 'Анализ звука…');
    await tick();
    const freqFrames = precomputeFreqFrames(audioBuffer, fps);
    // Та же карта событий, что и в превью (обычно уже посчитана при загрузке)
    const hasEv = typeof AudioAnalysis !== 'undefined' && !!AudioAnalysis.get(audioBuffer);
    if (typeof CardDeck !== 'undefined') await CardDeck.ready();
    const silentFreq = new Uint8Array(freqFrames[0] ? freqFrames[0].length : 512);

    const offCanvas = document.createElement('canvas');
    offCanvas.width = w; offCanvas.height = h;
    const offCtx = offCanvas.getContext('2d', { willReadFrequently: false });

    /* opts.sink — общий поток альбома: один muxer пишет прямо в файл на диске,
       трек за треком со сдвигом меток (offUs). Звук трека кодируется ДО
       кадров: тогда muxer сразу сбрасывает кадры в файл, а не копит их в
       памяти до звука — длина альбома памяти не стоит. */
    const sink = opts && opts.sink;
    const { Muxer, ArrayBufferTarget } = window.WebMMuxer;
    const target = sink ? null : new ArrayBufferTarget();
    if (sink && !sink.muxer) {
      sink.sr = sr;
      sink.muxer = new Muxer({
        target: sink.target,
        video: { codec: 'V_VP9', width: w, height: h, frameRate: fps },
        audio: { codec: 'A_OPUS', sampleRate: sr, numberOfChannels: 2, bitrate: abr },
        firstTimestampBehavior: 'permissive',
      });
    }
    if (sink && sink.sr !== sr) throw new Error('частота звука трека ' + sr + ' ≠ ' + sink.sr + ' у альбома');
    const muxer  = sink ? sink.muxer : new Muxer({
      target,
      video: { codec: 'V_VP9', width: w, height: h, frameRate: fps },
      audio: { codec: 'A_OPUS', sampleRate: sr, numberOfChannels: nch, bitrate: abr },
      firstTimestampBehavior: 'permissive',
    });
    const offUs = sink ? sink.offUs : 0;
    if (sink) {
      setProgress(4, 'Звук трека…');
      await tick();
      const trackAudio = typeof CardDeck !== 'undefined' ? await CardDeck.renderAudio(audioBuffer) : audioBuffer;
      await encodeAudio(trackAudio, abr, muxer, offUs, 2);
    }

    // VP9 level выбирается по фактическому разрешению/fps согласно спеке:
    //   5.1 — 4K60 (3840×2160 @ 60fps)
    //   5.0 — 4K30 (3840×2160 @ 30fps)  ← раньше тут ошибочно стоял 4.1
    //   4.1 — 1080p60
    //   3.1 — всё что ниже
    let vp9Codec;
    if (w >= 3840)                    vp9Codec = fps >= 60 ? 'vp09.00.51.08' : 'vp09.00.50.08';
    else if (w >= 1920 && fps >= 60)  vp9Codec = 'vp09.00.41.08';
    else                              vp9Codec = 'vp09.00.31.08';

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta, chunk.timestamp + offUs),
      error:  e => { console.error('VideoEncoder:', e); throw e; },
    });
    videoEncoder.configure({
      codec: vp9Codec, width: w, height: h, bitrate: vbr, framerate: fps,
      // VBR — использует битрейт умнее: больше на сложных кадрах, меньше на статике.
      // При том же среднем битрейте картинка чище чем у CBR.
      bitrateMode: 'variable',
      latencyMode: 'quality',
    });

    const localSprings = {
      scale:   new SpringPhysics({ stiffness: 0.15,       damping: 0.35,       initial: 1 }),
      offsetY: new SpringPhysics({ stiffness: 0.15 * 0.7, damping: 0.35 * 1.1, initial: 0 }),
      offsetX: new SpringPhysics({ stiffness: 0.15 * 0.8, damping: 0.35,       initial: 0 }),
    };
    const localBands = makeLocalBands();

    if (typeof BackgroundEngine !== 'undefined') {
      BackgroundEngine.resetCamera();
      // КРИТИЧНО: Принудительно пересоздаём springs для чистого старта экспорта
      // Это гарантирует что экспорт начинается с нулевого состояния
      if (BackgroundEngine._forceResetSprings) {
        BackgroundEngine._forceResetSprings();
      }
    }
    if (typeof BackgroundManager !== 'undefined' && BackgroundManager._forceReset) {
      // Сбрасываем runtime-state менеджера фонов (KB позиции, scroll, smoothing)
      BackgroundManager._forceReset();
    }
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

      const T        = fi * dt - lead;          // время песни; < 0 — lead-in
      const t        = Math.max(0, T);
      const freqData = T < 0 ? silentFreq : freqFrames[Math.min(freqFrames.length - 1, Math.round(t * fps))];
      const bands    = localBands.analyze(freqData, sr, 1024, dt);
      bands.ev = hasEv ? AudioAnalysis.at(audioBuffer, t) : null;
      // Тот же спектр, что и в превью, иначе венец в экспорте не поедет.
      if (BackgroundEngine.setSpectrum) BackgroundEngine.setSpectrum(freqData);

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
          lyrics[activeIdx].bgCommands.forEach(cmd => {
            BackgroundEngine.applyBackgroundCommand(cmd);
            if (typeof BackgroundManager !== 'undefined' && BackgroundManager.hasEntries) BackgroundManager.applyFxCommand(cmd);
          });
        }

        // Кам-сцена при экспорте — анимация на весь contiguous-блок (как в realtime)
        const _curLyricE = lyrics[activeIdx];
        const _sceneAssignE = (BackgroundEngine.findCamSceneForLine
          ? BackgroundEngine.findCamSceneForLine(activeIdx) : null);
        if (_curLyricE && _sceneAssignE) {
          let _runStart = activeIdx, _runEnd = activeIdx;
          while (_runStart > 0 &&
                 BackgroundEngine.findCamSceneForLine(_runStart - 1) === _sceneAssignE) _runStart--;
          while (_runEnd < lyrics.length - 1 &&
                 BackgroundEngine.findCamSceneForLine(_runEnd + 1) === _sceneAssignE) _runEnd++;
          const _blockStart = lyrics[_runStart].time;
          const _blockEnd   = (_runEnd + 1 < lyrics.length)
            ? lyrics[_runEnd + 1].time
            : lyrics[_runEnd].time + 4;
          BackgroundEngine.setLineCamScene(_sceneAssignE, _blockStart, _blockEnd - _blockStart, {
            currentLineIdx: activeIdx,
            blockStartLine: _runStart,
            blockEndLine:   _runEnd,
          });
        } else if (BackgroundEngine.clearLineCamScene) {
          BackgroundEngine.clearLineCamScene();
        }
      }

      localSprings.scale.update(dt);
      localSprings.offsetY.update(dt);
      localSprings.offsetX.update(dt);

      // КРИТИЧНО: BackgroundManager.tick ДО любых seek и draw — потому что
      // он определяет _activeId, от которого зависит _activeVideos() ниже.
      // Без этого на первом кадре _activeId === null, и видео никогда не
      // получит seek → экспорт показывает чёрный фон (или зависший первый кадр).
      if (typeof BackgroundManager !== 'undefined' && BackgroundManager.hasEntries) {
        BackgroundManager.tick(activeIdx, dt);
      }

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

      // BackgroundManager видео: seek активных video-entries (если есть)
      // Теперь вызывается ПОСЛЕ tick, поэтому _activeVideos() возвращает корректный набор.
      if (typeof BackgroundManager !== 'undefined' && BackgroundManager.hasEntries && BackgroundManager._activeVideos) {
        const actVids = BackgroundManager._activeVideos();
        for (const { video } of actVids) {
          if (video.readyState >= 2) {
            const drift = Math.abs(video.currentTime - t);
            if (drift > dt * 0.5 || fi % (fps * 2) === 0) {
              video.currentTime = t;
              if (drift > dt * 3) await new Promise(r => { const s = () => { video.removeEventListener('seeked', s); r(); }; video.addEventListener('seeked', s); });
            }
          }
        }
      }

      // КРИТИЧНО: Сбрасываем состояние canvas перед каждым кадром
      offCtx.save();
      offCtx.globalAlpha = 1;
      offCtx.globalCompositeOperation = 'source-over';
      offCtx.filter = 'none';
      offCtx.shadowBlur = 0;
      offCtx.shadowColor = 'transparent';

      // ═══════════════════════════════════════════════
      // Сначала считаем AnimMode для получения cameraOverride (montage и пр.).
      // Сохраняем результат в _exportAnim, чтобы повторно использовать при
      // рендере текста ниже.
      // ═══════════════════════════════════════════════
      let _exportAnim = null, _exportLyric = null;
      let _exportFadeA = 0, _exportFont = params.font, _exportSize = params.fontSize;
      let _exportColor = params.color, _exportPos = 'center';
      let _exportAnchorX = null, _exportAnchorY = null;
      let _exportElapsed = 0, _exportDur = 0;

      if (activeIdx >= 0 && activeIdx < lyrics.length) {
        _exportLyric   = lyrics[activeIdx];
        _exportElapsed = t - _exportLyric.time;
        _exportDur     = activeIdx + 1 < lyrics.length
          ? lyrics[activeIdx + 1].time - _exportLyric.time : 4;
        _exportFadeA = TextRenderer.getFadeAlpha(_exportElapsed, _exportDur, params.fadeDur);
        const _ls    = _exportLyric.lineStyle || {};
        _exportFont  = _ls.font     || params.font;
        _exportSize  = _ls.fontSize || params.fontSize;
        _exportColor = _ls.color    || params.color;
        const animKey = _ls.animMode || params.animMode;
        _exportPos   = _ls.position || params.textPosition || 'center';
        // Числовой якорь строки — см. App.js
        _exportAnchorX = (_ls.anchorX != null) ? _ls.anchorX : null;
        _exportAnchorY = (_ls.anchorY != null) ? _ls.anchorY : null;
        const modeFn = AnimModes[animKey] || AnimModes.pulse;

        const words  = _exportLyric.text
          ? _exportLyric.text.replace(/\{[^}]+\}/g, '').split(/\s+/).filter(Boolean)
          : [];
        // Ширина колонки строки — формула обязана совпадать с App.js,
        // иначе перенос в файле разойдётся с превью.
        const _expAnchorX  = (_ls.anchorX != null) ? _ls.anchorX : 50;
        const _expMaxLineW = w * (2 * Math.min(_expAnchorX, 100 - _expAnchorX) / 100) * 0.95;

        _exportAnim = modeFn({
          bands, t, params, springs: localSprings,
          words,
          canvasW:  w,
          canvasH:  h,
          elapsed:  _exportElapsed,
          duration: _exportDur,
          fontSize: _exportSize,
          ctx:      offCtx,
          font:     _exportFont,
          maxLineW: _expMaxLineW,
        });

        // ── Camera override к фону (montage, drift) ──
        // Длинный cameraK (600мс ramp-up, 500мс ramp-out) с smoothstep
        // даёт мягкое "вплывание" эффекта. Без этого фон резко прыгает
        // в zoom за 200мс (fadeA), что выглядит хлопком. Описание логики
        // идентично App.js.
        if (_exportAnim && _exportAnim.cameraOverride && BackgroundEngine.setTextDrivenCamera) {
          const co = _exportAnim.cameraOverride;
          const FADE_IN_CAM  = 0.60;
          const FADE_OUT_CAM = 0.50;
          const inProg  = Math.min(_exportElapsed / FADE_IN_CAM, 1);
          const outProg = _exportDur > 0
            ? Math.min((_exportDur - _exportElapsed) / FADE_OUT_CAM, 1) : 1;
          const rawK    = Math.max(0, Math.min(inProg, outProg, 1));
          const cameraK = rawK * rawK * (3 - 2 * rawK);
          BackgroundEngine.setTextDrivenCamera({
            zoomMul: 1 + (co.zoomMul - 1) * cameraK,
            panX:    co.panX * cameraK,
            panY:    co.panY * cameraK,
          });
        }
      }

      // Тик blend сцены — независимо от источника фона (см. App.js)
      if (BackgroundEngine.tickLineScene) BackgroundEngine.tickLineScene(dt);
      // textCam decay тикается ПОСЛЕ отрисовки фона (см. ниже).

      // Сценический transform поверх любого фонового рендера (как viewport-камера)
      const _exportSceneApplied = BackgroundEngine.applySceneTransform
        ? BackgroundEngine.applySceneTransform(offCtx, w, h, bands, t)
        : false;
      const _vizBg = typeof Visualizer !== 'undefined' && Visualizer.applyCamera(offCtx, w, h, bands.ev, 1, t);

      // ── ENDING: затухание контента ─────────────────────────
      const _exportEnding = BackgroundEngine.getEndingState
        ? BackgroundEngine.getEndingState(t)
        : { active: false, contentAlpha: 1, audioVolume: 1 };
      const _exportContentSaved = _exportEnding.active && _exportEnding.contentAlpha < 1;
      if (_exportContentSaved) {
        offCtx.save();
        offCtx.globalAlpha = _exportEnding.contentAlpha;
      }

      if (typeof Album !== 'undefined' && Album.drawBackground(offCtx, w, h, T, duration)) {
        // Песня из библиотеки: свой чистый фон
      } else if (typeof BackgroundManager !== 'undefined' && BackgroundManager.hasEntries) {
        // Менеджер фонов: tick уже сделан выше до seek; здесь только рисуем активный entry.
        BackgroundManager.draw(offCtx, w, h, bands, t, dt);
        // Оверлеи затемнения/осветления из FX Editor работают поверх BackgroundManager
        BackgroundEngine.drawFxOverlay(offCtx, w, h, dt);
      } else if (BackgroundEngine.hasMedia) {
        BackgroundEngine.draw(offCtx, w, h, bands, t, dt);
      } else {
        offCtx.fillStyle = '#0a0a0a';
        offCtx.fillRect(0, 0, w, h);
      }
      // Decay text-driven camera ПОСЛЕ отрисовки фона (matches legacy timing)
      if (BackgroundEngine.tickTextDrivenCamera) BackgroundEngine.tickTextDrivenCamera(dt);

      if (_vizBg) offCtx.restore();
      if (_exportSceneApplied) offCtx.restore();

      // Тот же дуотон на фон, что и в превью (см. App.js) — иначе файл разойдётся с окном.
      TextRenderer.drawColorWash(offCtx, w, h, _exportColor);

      // Flash-overlay для рок/strobe пресетов (см. App.js)
      if (BackgroundEngine.applySceneFlash) {
        BackgroundEngine.applySceneFlash(offCtx, w, h, bands, t);
      }
      if (typeof Visualizer !== 'undefined') Visualizer.drawSpectrum(offCtx, w, h, bands.ev, freqData);

      const currentLyric = _exportLyric;

      // Передний план едет с той же камерой, ослабленной — см. App.js.
      // Коэффициент обязан совпадать с App.js, иначе превью и файл разойдутся.
      // Базовую матрицу отдаём движку по той же причине, что и в App.js:
      // без неё объект с ov.camFollow (персонаж) поедет в экспорте иначе,
      // чем в превью.
      if (BackgroundEngine.setForegroundCam) {
        BackgroundEngine.setForegroundCam(
          (offCtx.getTransform ? offCtx.getTransform() : null), 0.28);
      }
      const _exportFgApplied = BackgroundEngine.applySceneTransform
        ? BackgroundEngine.applySceneTransform(offCtx, w, h, bands, t, 0.28)
        : false;
      const _vizFg = typeof Visualizer !== 'undefined' && Visualizer.applyCamera(offCtx, w, h, bands.ev, 0.28, t);

      (typeof Album !== 'undefined' && Album.clean ? (c1, c2, c3, c4, c5, c6, c7, c8, cb) => cb() : BackgroundEngine.drawOverlaysAll)(offCtx, w, h, bands, t, dt, activeIdx, currentLyric, (pass) => {
        // КРИТИЧНО: Сбрасываем globalAlpha перед рендером текста
        offCtx.globalAlpha = 1;

        if (_exportLyric && _exportAnim) {
          // 9-позиционная сетка: см. App.js
          // Сетка — относительно внутренней области кадра (см. App.js)
          const safe = BackgroundEngine.getTextSafeArea
            ? BackgroundEngine.getTextSafeArea(w, h)
            : { x: 0, y: 0, w, h };

          let textX = safe.x + safe.w / 2;
          let textY = safe.y + safe.h / 2;
          const pp = _exportPos || 'center';
          if (pp.endsWith('-left'))  textX = safe.x + safe.w * 0.15;
          if (pp.endsWith('-right')) textX = safe.x + safe.w * 0.85;
          if (pp.startsWith('top'))    textY = safe.y + safe.h * 0.15;
          if (pp.startsWith('bottom')) textY = safe.y + safe.h * 0.85;
          // Числовой якорь перебивает сетку — как и в превью (App.js)
          if (_exportAnchorX != null) textX = w * (_exportAnchorX / 100);
          if (_exportAnchorY != null) textY = h * (_exportAnchorY / 100);

          // Тот же силуэт, что и в превью: без него экспорт положит строку
          // поверх персонажа, хотя на экране она его обходила.
          const _expShape = BackgroundEngine.getCharacterShape
            ? BackgroundEngine.getCharacterShape(w, h, activeIdx) : null;

          const mainBottom = TextRenderer.draw(
            offCtx, _exportLyric, textX, textY,
            _exportAnim, _exportFadeA,
            _exportColor, _exportFont, _exportSize, w, t, params.globalBoxId, safe, _expShape, pass
          );

          // Перевод — часть читаемого набора, см. App.js: в ghost-проходе
          // его нет, иначе он уйдёт под фигуру и продублируется.
          if (pass === 'ghost') { offCtx.globalAlpha = 1; return; }

          // ── Перевод строки ──────────────────────────
          if (params.showTranslation && _exportLyric.translation) {
            const trSize = Math.max(14, Math.round(_exportSize * (params.translationRatio || 0.40)));
            const trY    = (mainBottom ?? textY + _exportSize) + trSize * 0.9;
            TextRenderer.drawTranslation(
              offCtx, _exportLyric.translation,
              textX, trY,
              _exportFadeA,
              params.translationColor || '#999999', _exportFont, trSize, w,
              safe, _expShape
            );
          }
        }

        // КРИТИЧНО: Сбрасываем globalAlpha после текста
        offCtx.globalAlpha = 1;
      });

      if (_vizFg) offCtx.restore();
      if (_exportFgApplied) offCtx.restore();

      // Letterbox поверх всего
      BackgroundEngine.drawLetterboxLayer(offCtx, w, h, bands, dt);

      if (typeof Visualizer !== 'undefined') Visualizer.post(offCtx, w, h, bands.ev, t);

      // Карта песни в считывателе — как в превью
      if (typeof CardDeck !== 'undefined') CardDeck.draw(offCtx, w, h, T, duration, freqData);

      // Закрываем content-alpha обёртку (ending fade)
      if (_exportContentSaved) offCtx.restore();

      // ── ENDING overlay: финальная анимация прощания ────────
      if (_exportEnding.active && BackgroundEngine.drawEnding) {
        BackgroundEngine.drawEnding(offCtx, w, h, t);
      }

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
    if (sink) return { seconds: totalFrames / fps };   // звук уже в потоке, файл закроет альбом

    setProgress(90, 'Кодирование звука…');
    await tick();
    // Дорожка с lead-in и звуками карты (шорох, защёлка, писк, выброс)
    const outAudio = typeof CardDeck !== 'undefined' ? await CardDeck.renderAudio(audioBuffer) : audioBuffer;
    await encodeAudio(outAudio, abr, muxer);

    setProgress(97, 'Упаковка WebM…');
    await tick();
    muxer.finalize();

    const blob = new Blob([target.buffer], { type: 'video/webm' });
    if (opts && opts.keep) return { blob: blob, seconds: totalFrames / fps };
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

  /* Пакетный рендер без модалки: Album гонит треки по очереди.
     Оверлей прогресса — свой на каждый трек, подпись — label. */
  async function renderBlob(presetKey, appState, label) {
    const preset = PRESETS.find(p => p.key === presetKey) || PRESETS[0];
    showOverlay(preset);
    if (label) setProgress(0, label);
    try { return await doRender(preset, appState, { keep: true }); }
    finally { hideOverlay(); }
  }

  /* Общий поток альбома: openSink(writable) → renderInto(…) на каждый трек
     (sink.offUs сдвигается на длину трека) → closeSink → writable.close(). */
  function openSink(writable) {
    const { FileSystemWritableFileStreamTarget } = window.WebMMuxer;
    return { target: new FileSystemWritableFileStreamTarget(writable, { chunkSize: 16 * 1024 * 1024 }), muxer: null, offUs: 0, sr: 0 };
  }
  async function renderInto(presetKey, appState, sink, label) {
    const preset = PRESETS.find(p => p.key === presetKey) || PRESETS[0];
    showOverlay(preset);
    if (label) setProgress(0, label);
    try {
      const r = await doRender(preset, appState, { sink: sink });
      if (r) sink.offUs += Math.round(r.seconds * 1_000_000);
      return r;
    } finally { hideOverlay(); }
  }
  function closeSink(sink) { if (sink.muxer) sink.muxer.finalize(); }

  return { showModal, renderBlob, renderInto, openSink, closeSink, PRESETS };
})();