/* ═══════════════════════════════════════════════
   TimingEditor.js
   Интуитивный редактор таймкодов
═══════════════════════════════════════════════ */
const TimingEditor = (() => {

  let audioCtx, audioSource, audioBuffer;
  let lines = [];
  let timed = [];
  let cursor = 0;
  let startT = 0;
  let playing = false;
  let pauseOffset = 0;
  let dom = {};
  let isSeeking = false;
  let seekFraction = 0;
  let draggingMarker = null;
  let viewMode = 'timed'; // 'timed' or 'all'
  let playbackRate = 1.0; // Скорость воспроизведения
  let wordPass = null;    // индекс строки в timed, открытой для пословной разметки
  let wordSel = 0;        // выделенное слово внутри этой строки
  let wordDrag = null;    // индекс перетаскиваемой пословной метки

  /* ── AUDIO ─────────────────────────────────── */
  async function loadAudio(file) {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const ab = await file.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(ab);

    dom.audioDropZone.classList.add('loaded');
    dom.audioDropZone.textContent = '✓ ' + file.name;
    dom.totalTime.textContent = fmtTime(audioBuffer.duration);
    dom.playBtn.disabled = false;
    dom.loadLyricsBtn.disabled = false;
  }

  function currentTime() {
    if (!audioCtx || !playing) return pauseOffset;
    // Учитываем скорость воспроизведения при расчёте времени
    return (audioCtx.currentTime - startT) * playbackRate;
  }

  function setPlaybackRate(rate) {
    playbackRate = Math.max(0.25, Math.min(1.0, rate));
    dom.speedValue.textContent = playbackRate.toFixed(1) + 'x';
    dom.speedSlider.value = Math.round(playbackRate * 100);
    
    // Если воспроизводится, применяем изменение скорости
    if (playing && audioSource) {
      const currentT = currentTime();
      // Останавливаем текущий источник
      if (audioSource) {
        try { 
          audioSource.onended = null;
          audioSource.stop(); 
        } catch(e){}
      }
      
      // Создаем новый источник с новой скоростью
      audioSource = audioCtx.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.playbackRate.value = playbackRate;
      audioSource.connect(audioCtx.destination);
      audioSource.start(0, Math.max(0, currentT));
      startT = audioCtx.currentTime - currentT / playbackRate;
      
      audioSource.onended = () => {
        playing = false;
        dom.playBtn.textContent = '▶ PLAY';
      };
    }
  }

  function play(offset = pauseOffset) {
    if (!audioBuffer) return;
    if (audioSource) { try { audioSource.stop(); } catch(e){} }
    
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.playbackRate.value = playbackRate; // Устанавливаем скорость
    audioSource.connect(audioCtx.destination);
    audioSource.start(0, Math.max(0, offset));
    startT = audioCtx.currentTime - offset / playbackRate; // Учитываем скорость
    playing = true;
    
    audioSource.onended = () => {
      playing = false;
      dom.playBtn.textContent = '▶ PLAY';
    };
    
    dom.playBtn.textContent = '⏸ PAUSE';
    tick();
  }

  function pause() {
    pauseOffset = currentTime();
    if (audioSource) { try { audioSource.stop(); } catch(e){} }
    playing = false;
    dom.playBtn.textContent = '▶ PLAY';
  }

  function seek(t) {
    pauseOffset = t;
    dom.currentTime.textContent = fmtTime(t);
    
    if (playing) {
      // Останавливаем текущий источник
      if (audioSource) {
        try { 
          audioSource.onended = null; // Убираем обработчик
          audioSource.stop(); 
        } catch(e){}
      }
      
      // Создаем новый источник с новой позиции
      audioSource = audioCtx.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.playbackRate.value = playbackRate; // Устанавливаем скорость
      audioSource.connect(audioCtx.destination);
      audioSource.start(0, Math.max(0, t));
      startT = audioCtx.currentTime - t / playbackRate; // Учитываем скорость
      
      audioSource.onended = () => {
        playing = false;
        dom.playBtn.textContent = '▶ PLAY';
      };
    }
  }

  function tick() {
    if (!playing) return;
    const t = currentTime();
    dom.currentTime.textContent = fmtTime(t);
    if (!isSeeking && draggingMarker === null) {
      const dur = audioBuffer ? audioBuffer.duration : 1;
      seekFraction = Math.min(t / dur, 1);
    }
    drawSeek();
    requestAnimationFrame(tick);
  }

  function getCanvasPct(clientX) {
    const rect = dom.seekCanvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function findMarkerAt(clientX) {
    if (!audioBuffer) return -1;
    const rect = dom.seekCanvas.getBoundingClientRect();
    const x = clientX - rect.left;
    for (let i = 0; i < timed.length; i++) {
      const mx = (timed[i].time / audioBuffer.duration) * rect.width;
      if (Math.abs(x - mx) <= 7) return i;
    }
    return -1;
  }

  function drawSeek() {
    const canvas = dom.seekCanvas;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const trackY = h / 2;
    const trackH = 6;

    // Track bg
    ctx.fillStyle = '#1a1a1a';
    fillRoundRect(ctx, 0, trackY - trackH / 2, w, trackH, 3);

    if (!audioBuffer) return;
    const dur = audioBuffer.duration;
    const p = seekFraction;

    // Progress
    ctx.fillStyle = '#383838';
    fillRoundRect(ctx, 0, trackY - trackH / 2, w * p, trackH, 3);

    // Markers
    timed.forEach((item, i) => {
      const mx = Math.min(item.time / dur, 1) * w;
      ctx.fillStyle = draggingMarker === i ? '#fff' : 'rgba(232,255,0,0.85)';
      fillRoundRect(ctx, mx - 2, trackY - 11, 4, 22, 2);
    });

    // Thumb
    ctx.fillStyle = '#e8ff00';
    ctx.beginPath();
    ctx.arc(w * p, trackY, 8, 0, Math.PI * 2);
    ctx.fill();

    drawWordCanvas();
  }

  function fillRoundRect(ctx, x, y, w, h, r) {
    if (w <= 0) return;
    ctx.beginPath();
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
    ctx.fill();
  }

  /* ── MARK ───────────────────────────────────── */
  function markCurrentLine() {
    if (cursor >= lines.length) return;
    const t = currentTime();
    timed.push({ time: t, text: lines[cursor] });
    cursor++;

    renderResults();
    renderMarkers();
    renderCurrentLine();
  }

  function undoMark() {
    if (timed.length === 0) return;
    timed.pop();
    cursor = Math.max(0, cursor - 1);
    renderResults();
    renderMarkers();
    renderCurrentLine();
  }

  /* ── RENDER ─────────────────────────────────── */
  function renderCurrentLine() {
    if (lines.length === 0) {
      dom.lineCounter.textContent = 'LOAD LYRICS TO START';
      dom.currentLine.textContent = '—';
      dom.nextLine.textContent = '';
      dom.markHint.classList.remove('visible');
      updateProgress();
      return;
    }

    if (cursor >= lines.length) {
      dom.lineCounter.textContent = '✓ ALL LINES TIMED';
      dom.currentLine.textContent = 'Done!';
      dom.nextLine.textContent = '';
      dom.markHint.classList.remove('visible');
      updateProgress();
      return;
    }

    dom.lineCounter.textContent = `LINE ${cursor + 1} / ${lines.length}`;
    dom.currentLine.textContent = lines[cursor];
    dom.nextLine.textContent = lines[cursor + 1] ? `Next: ${lines[cursor + 1]}` : '';
    dom.markHint.classList.add('visible');
    updateProgress();
  }
  
  function updateProgress() {
    const total = lines.length;
    const current = timed.length;
    
    dom.progressCurrent.textContent = current;
    dom.progressTotal.textContent = total;
  }

  function renderResults() {
    dom.resultsList.innerHTML = '';
    
    if (viewMode === 'timed') {
      // Показываем размеченные строки с таймкодами
      dom.resultsCount.textContent = timed.length;
      dom.viewToggle.textContent = '⏱️';
      dom.viewToggle.title = 'Showing timed lines. Click to show all text';

      timed.forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'result-item';
        const hasWords = item.wordTimes && item.wordTimes.length;
        div.className = 'result-item' + (wordPass === i ? ' current' : '');
        div.innerHTML = `
          <div class="result-time" data-i="${i}">${fmtTime(item.time)}</div>
          <div class="result-text">${escHtml(item.text)}</div>
          <button class="word-open${hasWords ? ' has-words' : ''}" data-i="${i}"
                  title="Word pass — расставить слова внутри строки">🔤</button>
          <button class="result-delete" data-i="${i}">×</button>
        `;
        dom.resultsList.appendChild(div);
      });

      // Edit time on click
      dom.resultsList.querySelectorAll('.result-time').forEach(timeEl => {
        timeEl.addEventListener('click', () => {
          const idx = +timeEl.dataset.i;
          const currentTime = timed[idx].time;
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'result-time-input';
          input.value = fmtTime(currentTime);
          
          timeEl.replaceWith(input);
          input.focus();
          input.select();

          const save = () => {
            const val = input.value.trim();
            const parsed = parseTime(val);
            if (parsed !== null) {
              timed[idx].time = parsed;
              timed.sort((a, b) => a.time - b.time);
              renderResults();
            } else {
              renderResults();
            }
          };

          input.addEventListener('blur', save);
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') renderResults();
          });
        });
      });

      // Word pass
      dom.resultsList.querySelectorAll('.word-open').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const idx = +btn.dataset.i;
          if (wordPass === idx) closeWordPass();
          else openWordPass(idx);
        });
      });

      // Delete
      dom.resultsList.querySelectorAll('.result-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.i;
          if (wordPass !== null) closeWordPass();
          timed.splice(idx, 1);
          cursor = timed.length;
          renderResults();
          renderMarkers();
          renderCurrentLine();
        });
      });
    } else {
      // Показываем все строки текста
      dom.resultsCount.textContent = lines.length;
      dom.viewToggle.textContent = '📝';
      dom.viewToggle.title = 'Showing all text. Click to show timed lines only';

      lines.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'result-item clickable';
        if (i === cursor) {
          div.classList.add('current');
        }
        
        // Проверяем есть ли таймкод для этой строки
        const timedItem = timed.find(t => t.text === line);
        const timeDisplay = timedItem ? fmtTime(timedItem.time) : '—:—.—';
        const timeClass = timedItem ? 'result-time-readonly' : 'result-time-readonly dimmed';
        
        div.innerHTML = `
          <div class="${timeClass}">${timeDisplay}</div>
          <div class="result-text">${escHtml(line)}</div>
        `;
        
        // Клик по строке переключает курсор на эту строку
        div.addEventListener('click', () => {
          cursor = i;
          renderCurrentLine();
          renderResults();
        });
        
        dom.resultsList.appendChild(div);
      });
    }
  }

  /* ── WORD PASS ──────────────────────────────────
     Второй проход: строки уже размечены, здесь расставляются слова внутри
     строки. Метки сначала раскладываются автоматически по длине слов —
     это лишь заготовка, попадающая примерно; дальше их двигают руками.
  ──────────────────────────────────────────────── */

  function lineBounds(i) {
    const start = timed[i].time;
    let end = (i + 1 < timed.length) ? timed[i + 1].time : start + 4;
    if (audioBuffer) end = Math.min(end, audioBuffer.duration);
    if (!(end > start)) end = start + 0.5;
    return { start, end };
  }

  function wordsOf(i) {
    return (timed[i].text || '')
      .replace(/\{[^}]+\}/g, '')
      .split(/\s+/).filter(Boolean);
  }

  /* Заготовка: вес слова — его длина плюс пауза после знака препинания.
     Равные доли на слово читаются заметно хуже: «я» и «безнадёжность»
     висели бы одинаково, и правки требовала бы каждая метка. */
  function autoWordTimes(i) {
    const words = wordsOf(i);
    if (!words.length) return [];
    const { start, end } = lineBounds(i);
    const weights = words.map(w =>
      w.length + 1 + (/[,.!?;:—–]$/.test(w) ? 2.5 : 0)
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    return words.map((w, k) => {
      const t = start + (end - start) * (acc / total);
      acc += weights[k];
      return { t, text: w };
    });
  }

  /* Приводит разметку к «одна метка на слово».

     В файле метка могла стоять перед целой фразой — тогда слов больше, чем
     меток, и запись обратно съехала бы на слово. Первое слово чанка берёт
     его время, остальные распределяются до следующей метки. */
  function ensureWordTimes(i) {
    const words = wordsOf(i);
    const have = timed[i].wordTimes;
    if (!have || !have.length) {
      timed[i].wordTimes = autoWordTimes(i);
      return timed[i].wordTimes;
    }
    if (have.length === words.length && have.every(x => x && x.text)) return have;

    const { end } = lineBounds(i);
    const out = [];
    let wi = 0;
    for (let c = 0; c < have.length && wi < words.length; c++) {
      const chunkWords = String(have[c].text || '').split(/\s+/).filter(Boolean).length || 1;
      const t0 = have[c].t;
      const t1 = (c + 1 < have.length) ? have[c + 1].t : end;
      for (let k = 0; k < chunkWords && wi < words.length; k++) {
        out.push({ t: t0 + (t1 - t0) * (k / chunkWords), text: words[wi] });
        wi++;
      }
    }
    // Слова, до которых меток не хватило, дотягиваем до конца строки.
    const rest = words.length - wi;
    if (rest > 0) {
      const t0 = out.length ? out[out.length - 1].t : lineBounds(i).start;
      for (let k = 1; k <= rest; k++) {
        out.push({ t: t0 + (end - t0) * (k / (rest + 1)), text: words[wi++] });
      }
    }
    timed[i].wordTimes = out;
    return out;
  }

  function openWordPass(i) {
    if (i < 0 || i >= timed.length) return;
    if (!wordsOf(i).length) return;
    wordPass = i;
    wordSel = 0;
    ensureWordTimes(i);
    seek(lineBounds(i).start);
    renderWordPanel();
    renderResults();
  }

  function closeWordPass() {
    wordPass = null;
    wordDrag = null;
    dom.wordPanel.classList.remove('visible');
    renderResults();
  }

  /* Метки держим по возрастанию и внутри строки: слово, уехавшее за соседа,
     на экспорте дало бы порядок, которого в строке нет. */
  function clampWordTimes(i) {
    const wt = timed[i].wordTimes;
    if (!wt || !wt.length) return;
    const { start, end } = lineBounds(i);
    for (let k = 0; k < wt.length; k++) {
      const lo = k === 0 ? start : wt[k - 1].t;
      wt[k].t = Math.max(lo, Math.min(end, wt[k].t));
    }
  }

  function renderWordPanel() {
    if (wordPass === null) {
      dom.wordPanel.classList.remove('visible');
      return;
    }
    const i = wordPass;
    const wt = ensureWordTimes(i);
    dom.wordPanel.classList.add('visible');
    dom.wordPanelTitle.textContent =
      'Word pass — line ' + (i + 1) + ' · ' + fmtTime(lineBounds(i).start);

    dom.wordChips.innerHTML = '';
    wt.forEach((w, k) => {
      const chip = document.createElement('div');
      chip.className = 'word-chip' + (k === wordSel ? ' active' : '');
      chip.innerHTML =
        '<div class="word-chip-word">' + escHtml(w.text) + '</div>' +
        '<div class="word-chip-time" data-k="' + k + '">' + fmtTime(w.t) + '</div>';
      chip.addEventListener('click', e => {
        if (e.target.classList.contains('word-chip-time')) return;
        wordSel = k;
        renderWordPanel();
      });
      dom.wordChips.appendChild(chip);
    });

    // Правка времени слова руками — тем же жестом, что и у строки.
    dom.wordChips.querySelectorAll('.word-chip-time').forEach(el => {
      el.addEventListener('click', () => {
        const k = +el.dataset.k;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'word-chip-input';
        input.value = fmtTime(wt[k].t);
        el.replaceWith(input);
        input.focus();
        input.select();
        const save = () => {
          const parsed = parseTime(input.value.trim());
          if (parsed !== null) { wt[k].t = parsed; clampWordTimes(i); }
          renderWordPanel();
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
          e.stopPropagation();
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') renderWordPanel();
        });
      });
    });

    drawWordCanvas();
  }

  function wordCanvasPct(clientX) {
    const rect = dom.wordCanvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function wordTimeAt(clientX) {
    const { start, end } = lineBounds(wordPass);
    return start + (end - start) * wordCanvasPct(clientX);
  }

  function findWordMarkerAt(clientX) {
    if (wordPass === null) return -1;
    const wt = timed[wordPass].wordTimes || [];
    const { start, end } = lineBounds(wordPass);
    const rect = dom.wordCanvas.getBoundingClientRect();
    const x = clientX - rect.left;
    for (let k = 0; k < wt.length; k++) {
      const mx = ((wt[k].t - start) / (end - start)) * rect.width;
      if (Math.abs(x - mx) <= 8) return k;
    }
    return -1;
  }

  function drawWordCanvas() {
    if (wordPass === null || !dom.wordCanvas) return;
    const canvas = dom.wordCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { start, end } = lineBounds(wordPass);
    const span = end - start;
    const wt = timed[wordPass].wordTimes || [];
    const xOf = t => ((t - start) / span) * w;

    ctx.fillStyle = '#111';
    fillRoundRect(ctx, 0, 8, w, h - 16, 4);

    // Доля каждого слова — полоса до следующей метки: так видно, какое
    // слово висит слишком долго, ещё до проигрывания.
    wt.forEach((word, k) => {
      const x0 = xOf(word.t);
      const x1 = k + 1 < wt.length ? xOf(wt[k + 1].t) : w;
      ctx.fillStyle = k === wordSel ? 'rgba(232,255,0,0.18)' : (k % 2 ? '#151515' : '#1b1b1b');
      ctx.fillRect(x0, 8, Math.max(0, x1 - x0), h - 16);
    });

    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    wt.forEach((word, k) => {
      const x = xOf(word.t);
      ctx.fillStyle = k === wordSel ? '#fff' : 'rgba(232,255,0,0.85)';
      ctx.fillRect(x - 1, 8, 2, h - 16);
      const x1 = k + 1 < wt.length ? xOf(wt[k + 1].t) : w;
      if (x1 - x > 18) {
        ctx.fillStyle = k === wordSel ? '#e8ff00' : '#777';
        ctx.fillText(word.text, x + 4, h / 2);
      }
    });

    // Курсор воспроизведения — только пока он внутри строки.
    const t = currentTime();
    if (t >= start && t <= end) {
      ctx.fillStyle = '#e8ff00';
      const px = xOf(t);
      ctx.fillRect(px - 1, 0, 2, h);
      ctx.beginPath();
      ctx.arc(px, 4, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── MARKERS ────────────────────────────────── */
  function renderMarkers() {
    drawSeek();
  }

  /* ── EXPORT ─────────────────────────────────── */
  function exportLRC() {
    if (timed.length === 0) return '';
    return LRCParser.serialize(timed);
  }

  function downloadLRC() {
    const lrc = exportLRC();
    const blob = new Blob([lrc], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lyrics.lrc';
    a.click();
  }

  function copyLRC() {
    const lrc = exportLRC();
    navigator.clipboard.writeText(lrc).then(() => {
      const orig = dom.copyBtn.textContent;
      dom.copyBtn.textContent = '✓ COPIED!';
      setTimeout(() => dom.copyBtn.textContent = orig, 1500);
    });
  }

  /* ── INIT ───────────────────────────────────── */
  function init() {
    dom = {
      audioDropZone: document.getElementById('audioDropZone'),
      audioFile: document.getElementById('audioFile'),
      lyricsInput: document.getElementById('lyricsInput'),
      loadLyricsBtn: document.getElementById('loadLyricsBtn'),
      playBtn: document.getElementById('playBtn'),
      seekCanvas: document.getElementById('seekCanvas'),
      currentTime: document.getElementById('currentTime'),
      totalTime: document.getElementById('totalTime'),
      undoBtn: document.getElementById('undoBtn'),
      lineCounter: document.getElementById('lineCounter'),
      currentLine: document.getElementById('currentLine'),
      nextLine: document.getElementById('nextLine'),
      markHint: document.getElementById('markHint'),
      resultsList: document.getElementById('resultsList'),
      resultsCount: document.getElementById('resultsCount'),
      copyBtn: document.getElementById('copyBtn'),
      downloadBtn: document.getElementById('downloadBtn'),
      viewToggle: document.getElementById('viewToggle'),
      progressCurrent: document.getElementById('progressCurrent'),
      progressTotal: document.getElementById('progressTotal'),
      speedSlider: document.getElementById('speedSlider'),
      speedValue: document.getElementById('speedValue'),
      wordPanel: document.getElementById('wordPanel'),
      wordPanelTitle: document.getElementById('wordPanelTitle'),
      wordCanvas: document.getElementById('wordCanvas'),
      wordChips: document.getElementById('wordChips'),
      wordPlayBtn: document.getElementById('wordPlayBtn'),
      wordAutoBtn: document.getElementById('wordAutoBtn'),
      wordCloseBtn: document.getElementById('wordCloseBtn'),
    };

    // Audio file
    dom.audioDropZone.addEventListener('click', () => dom.audioFile.click());
    dom.audioFile.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) loadAudio(f);
    });
    
    // Drag and drop for audio
    dom.audioDropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dom.audioDropZone.style.borderColor = '#e8ff00';
      dom.audioDropZone.style.background = 'rgba(232, 255, 0, 0.1)';
    });
    
    dom.audioDropZone.addEventListener('dragleave', e => {
      e.preventDefault();
      if (!dom.audioDropZone.classList.contains('loaded')) {
        dom.audioDropZone.style.borderColor = '';
        dom.audioDropZone.style.background = '';
      }
    });
    
    dom.audioDropZone.addEventListener('drop', e => {
      e.preventDefault();
      dom.audioDropZone.style.borderColor = '';
      dom.audioDropZone.style.background = '';
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('audio/')) {
        loadAudio(f);
      }
    });

    // Load lyrics
    dom.lyricsInput.addEventListener('input', () => {
      const hasText = dom.lyricsInput.value.trim().length > 0;
      dom.loadLyricsBtn.disabled = !hasText;
    });
    
    dom.loadLyricsBtn.addEventListener('click', () => {
      const raw = dom.lyricsInput.value.trim();
      if (!raw) return;
      
      // Проверяем есть ли уже таймкоды в формате LRC
      const lrcPattern = /\[(\d+):(\d+)\.(\d+)\]\s*(.+)/;
      const hasTimecodes = raw.split('\n').some(line => lrcPattern.test(line));
      
      if (hasTimecodes) {
        // Парсим существующие таймкоды
        const parsed = LRCParser.parse(raw);
        // Сохраняем ВСЕ записи в timed (включая [Chorus] и т.д.) для корректного экспорта
        timed = parsed.map(item => ({
          time: item.time, text: item.text, rawText: item.rawText,
          wordTimes: item.wordTimes,
        }));
        // В lines — только строки с реальным текстом (без секционных меток)
        lines = parsed.filter(item => item.text.trim() !== '').map(item => item.text);
        // Ставим курсор на первую ещё не размеченную строку
        const timedTexts = new Set(timed.map(t => t.text));
        cursor = lines.findIndex(line => !timedTexts.has(line));
        if (cursor === -1) cursor = lines.length; // все промаркированы → Done!
      } else {
        // Просто загружаем строки без таймкодов
        lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        timed = [];
        cursor = 0;
      }
      
      closeWordPass();
      renderCurrentLine();
      renderResults();
      renderMarkers();
    });

    // Transport
    dom.playBtn.addEventListener('click', () => {
      if (!audioBuffer) return;
      if (playing) pause();
      else play();
    });

    dom.seekCanvas.addEventListener('mousedown', e => {
      if (!audioBuffer) return;
      const mi = findMarkerAt(e.clientX);
      if (mi >= 0) {
        draggingMarker = mi;
      } else {
        isSeeking = true;
        seekFraction = getCanvasPct(e.clientX);
        dom.currentTime.textContent = fmtTime(seekFraction * audioBuffer.duration);
        drawSeek();
      }
    });

    dom.seekCanvas.addEventListener('mousemove', e => {
      if (!audioBuffer) return;
      const mi = findMarkerAt(e.clientX);
      dom.seekCanvas.style.cursor = mi >= 0 ? 'ew-resize' : 'pointer';
    });

    // Пословная дорожка: тянем метку, а по пустому месту — перематываем.
    dom.wordCanvas.addEventListener('mousedown', e => {
      if (wordPass === null) return;
      e.stopPropagation();
      const k = findWordMarkerAt(e.clientX);
      if (k >= 0) {
        wordDrag = k;
        wordSel = k;
        renderWordPanel();
      } else {
        seek(wordTimeAt(e.clientX));
        drawSeek();
      }
    });

    dom.wordCanvas.addEventListener('mousemove', e => {
      if (wordPass === null) return;
      dom.wordCanvas.style.cursor = findWordMarkerAt(e.clientX) >= 0 ? 'ew-resize' : 'pointer';
    });

    document.addEventListener('mousemove', e => {
      if (wordDrag !== null && wordPass !== null) {
        timed[wordPass].wordTimes[wordDrag].t = wordTimeAt(e.clientX);
        clampWordTimes(wordPass);
        renderWordPanel();
        return;
      }
      if (draggingMarker !== null && audioBuffer) {
        timed[draggingMarker].time = getCanvasPct(e.clientX) * audioBuffer.duration;
        drawSeek();
        return;
      }
      if (!isSeeking || !audioBuffer) return;
      seekFraction = getCanvasPct(e.clientX);
      dom.currentTime.textContent = fmtTime(seekFraction * audioBuffer.duration);
      drawSeek();
    });

    document.addEventListener('mouseup', e => {
      if (wordDrag !== null) {
        wordDrag = null;
        renderWordPanel();
        renderResults();
        return;
      }
      if (draggingMarker !== null) {
        timed.sort((a, b) => a.time - b.time);
        draggingMarker = null;
        renderResults();
        drawSeek();
        return;
      }
      if (!isSeeking) return;
      isSeeking = false;
      if (audioBuffer) {
        seekFraction = getCanvasPct(e.clientX);
        seek(seekFraction * audioBuffer.duration);
      }
    });

    dom.undoBtn.addEventListener('click', undoMark);

    // Word pass controls
    dom.wordPlayBtn.addEventListener('click', () => {
      if (wordPass === null) return;
      const { start } = lineBounds(wordPass);
      seek(start);
      if (!playing) play(start);
    });

    dom.wordAutoBtn.addEventListener('click', () => {
      if (wordPass === null) return;
      timed[wordPass].wordTimes = autoWordTimes(wordPass);
      wordSel = 0;
      renderWordPanel();
      renderResults();
    });

    dom.wordCloseBtn.addEventListener('click', closeWordPass);

    // Speed control
    dom.speedSlider.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    
    dom.speedSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      const rate = dom.speedSlider.value / 100;
      setPlaybackRate(rate);
    });
    
    dom.speedSlider.addEventListener('change', (e) => {
      e.stopPropagation();
    });

    // Keyboard
    document.addEventListener('keydown', e => {
      // Ignore if typing in textarea
      if (document.activeElement === dom.lyricsInput) return;
      
      /* В режиме word pass пробел ставит не строку, а выделенное слово: в
         этот момент строки уже размечены, и старое действие только мешало бы. */
      if (wordPass !== null) {
        const wt = timed[wordPass].wordTimes || [];
        if (e.code === 'Space') {
          e.preventDefault();
          if (wt[wordSel]) {
            wt[wordSel].t = currentTime();
            clampWordTimes(wordPass);
            wordSel = Math.min(wordSel + 1, wt.length - 1);
            renderWordPanel();
            renderResults();
          }
          return;
        }
        if (e.code === 'Tab') {
          e.preventDefault();
          wordSel = (wordSel + (e.shiftKey ? wt.length - 1 : 1)) % Math.max(wt.length, 1);
          renderWordPanel();
          return;
        }
        if (e.code === 'Escape') {
          e.preventDefault();
          closeWordPass();
          return;
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (cursor < lines.length) markCurrentLine();
      }
      if (e.key === 'z' && e.ctrlKey) {
        e.preventDefault();
        undoMark();
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seek(Math.max(0, currentTime() - 2));
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        seek(Math.min(audioBuffer?.duration || 0, currentTime() + 2));
      }
      if (e.code === 'BracketLeft') {
        e.preventDefault();
        setPlaybackRate(playbackRate - 0.1);
      }
      if (e.code === 'BracketRight') {
        e.preventDefault();
        setPlaybackRate(playbackRate + 0.1);
      }
    });

    // Export
    dom.copyBtn.addEventListener('click', copyLRC);
    dom.downloadBtn.addEventListener('click', downloadLRC);
    
    // View toggle
    dom.viewToggle.addEventListener('click', () => {
      viewMode = viewMode === 'timed' ? 'all' : 'timed';
      renderResults();
    });
  }

  /* ── UTILS ──────────────────────────────────── */
  function fmtTime(s) {
    if (isNaN(s)) return '00:00.00';
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    const cs = Math.round((s % 1) * 100);
    return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  }
  
  function parseTime(str) {
    // Parse format: MM:SS.CC or MM:SS
    const match = str.match(/^(\d+):(\d+)(?:\.(\d+))?$/);
    if (!match) return null;
    const m = parseInt(match[1], 10);
    const s = parseInt(match[2], 10);
    const cs = match[3] ? parseInt(match[3].padEnd(2, '0').slice(0, 2), 10) : 0;
    return m * 60 + s + cs / 100;
  }
  
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => TimingEditor.init());
