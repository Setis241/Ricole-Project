/* ═══════════════════════════════════════════════
   js/AudioEngine.js
   Web Audio API: decode, analyse, playback
═══════════════════════════════════════════════ */
const AudioEngine = (() => {
  let ctx, analyser, source, buffer;
  let startTime = 0;
  let _isPlaying = false;

  const FFT_SIZE = 1024; // 512 бинов

  async function loadBuffer(arrayBuffer) {
    if (ctx) ctx.close();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    // 0.75 = хороший баланс: быстрая реакция + нет моргания
    analyser.smoothingTimeConstant = 0.75;
    analyser.connect(ctx.destination);
    buffer = await ctx.decodeAudioData(arrayBuffer);
    return buffer.duration;
  }

  function play(offset = 0) {
    if (!buffer || !ctx) return null;
    if (source) { try { source.stop(); } catch (e) {} }
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.start(0, Math.max(0, offset));
    startTime = ctx.currentTime - offset;
    _isPlaying = true;
    source.onended = () => { _isPlaying = false; };
    return source;
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

  function getCurrentTime() {
    if (!_isPlaying || !ctx) return 0;
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
    loadBuffer, play, stop, pause,
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
