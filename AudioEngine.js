/* ═══════════════════════════════════════════════
   js/AudioEngine.js
   Web Audio API: decode, analyse, playback
═══════════════════════════════════════════════ */
const AudioEngine = (() => {
  let ctx, analyser, source, buffer, gainNode;
  let startTime = 0;
  let _isPlaying = false;
  /* Доснятое время ПЕРЕД песней. Клип с карточкой вступления должен
     начинаться раньше трека: на песнях, где вокал идёт с первой секунды,
     иначе титру просто негде встать. Источник стартует позже, а часы
     уходят в минус — то есть отрицательное время это и есть вступление.
     Ниже по цепочке ничего чинить не надо: поиск активной строки идёт по
     `t >= line.time`, и до нуля активной строки просто нет. */
  let _leadIn = 0;

  const FFT_SIZE = 1024; // 512 бинов

  async function loadBuffer(arrayBuffer) {
    if (ctx) ctx.close();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    // 0.75 = хороший баланс: быстрая реакция + нет моргания
    analyser.smoothingTimeConstant = 0.75;
    // Цепь: source → gainNode → analyser → destination
    gainNode = ctx.createGain();
    gainNode.gain.value = 1;
    gainNode.connect(analyser);
    analyser.connect(ctx.destination);
    buffer = await ctx.decodeAudioData(arrayBuffer);
    return buffer.duration;
  }

  function play(offset = 0) {
    if (!buffer || !ctx) return null;
    if (source) { try { source.stop(); } catch (e) {} }
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode || analyser);
    /* Задержку даём только при старте с начала. Resume с середины — это
       продолжение уже идущего клипа, вступление там давно позади. */
    const delay = (offset > 0) ? 0 : _leadIn;
    source.start(ctx.currentTime + delay, Math.max(0, offset));
    startTime = ctx.currentTime + delay - offset;
    _isPlaying = true;
    source.onended = () => { _isPlaying = false; };
    return source;
  }

  // Плавно меняет громкость без щелчков (целевое значение 0..1)
  function setGain(value) {
    if (!gainNode || !ctx) return;
    const v = Math.max(0, Math.min(1, value));
    // Маленькая ramp для подавления щелчков
    try {
      gainNode.gain.cancelScheduledValues(ctx.currentTime);
      gainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
    } catch (e) {
      gainNode.gain.value = v;
    }
  }

  function stop() {
    if (source) { try { source.stop(); } catch (e) {} }
    _isPlaying = false;
  }

  function pause() {
    const offset = getCurrentTime();
    stop();
    return offset; // возвращает позицию для resume
  }

  function setLeadIn(sec) { _leadIn = Math.max(0, sec || 0); }
  function getLeadIn()      { return _leadIn; }

  function getCurrentTime() {
    if (!_isPlaying || !ctx) return _leadIn ? -_leadIn : 0;
    return ctx.currentTime - startTime;
  }

  // Uint8Array[512] — амплитуды по бинам (0-255)
  function getFrequencyData() {
    if (!analyser) return new Uint8Array(FFT_SIZE / 2);
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    return data;
  }

  // Для Recorder: MediaStreamAudioDestination
  function getAudioDestination() {
    if (!ctx) return null;
    const dest = ctx.createMediaStreamDestination();
    analyser.connect(dest);
    return dest;
  }

  return {
    loadBuffer, play, stop, pause, setGain,
    setLeadIn, getLeadIn,
    getCurrentTime, getFrequencyData, getAudioDestination,
    get isPlaying()  { return _isPlaying; },
    get sampleRate() { return ctx ? ctx.sampleRate : 44100; },
    get fftSize()    { return FFT_SIZE; },
    get duration()   { return buffer ? buffer.duration : 0; },
    get ctx()        { return ctx; },
    // ExportEngine использует сырой буфер для offline FFT
    get buffer()     { return buffer; },
  };
})();
