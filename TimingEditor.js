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
  let viewMode = 'timed'; // 'timed' or 'all'
  let playbackRate = 1.0; // Скорость воспроизведения

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
    const dur = audioBuffer ? audioBuffer.duration : 1;
    const p = Math.min(t / dur, 1);
    dom.currentTime.textContent = fmtTime(t);
    if (!isSeeking) {
      dom.seekSlider.value = p * 1000;
    }
    requestAnimationFrame(tick);
  }

  /* ── MARK ───────────────────────────────────── */
  function markCurrentLine() {
    if (cursor >= lines.length) return;
    const t = currentTime();

    timed.push({ time: t, text: lines[cursor] });
    cursor++;
    
    renderResults();
    renderCurrentLine();
  }

  function undoMark() {
    if (timed.length === 0) return;
    timed.pop();
    cursor = Math.max(0, cursor - 1);
    renderResults();
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
        div.innerHTML = `
          <div class="result-time" data-i="${i}">${fmtTime(item.time)}</div>
          <div class="result-text">${escHtml(item.text)}</div>
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

      // Delete
      dom.resultsList.querySelectorAll('.result-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = +btn.dataset.i;
          timed.splice(idx, 1);
          cursor = Math.min(cursor, lines.length - 1);
          renderResults();
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
      seekSlider: document.getElementById('seekSlider'),
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
        lines = parsed.map(item => item.text);
        timed = parsed.map(item => ({ time: item.time, text: item.text }));
        cursor = lines.length; // Все строки уже размечены
      } else {
        // Просто загружаем строки без таймкодов
        lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        timed = [];
        cursor = 0;
      }
      
      renderCurrentLine();
      renderResults();
    });

    // Transport
    dom.playBtn.addEventListener('click', () => {
      if (!audioBuffer) return;
      if (playing) pause();
      else play();
    });

    dom.seekSlider.addEventListener('mousedown', () => {
      isSeeking = true;
    });

    dom.seekSlider.addEventListener('mouseup', () => {
      isSeeking = false;
      // Применяем финальное значение после отпускания
      if (audioBuffer) {
        seek((dom.seekSlider.value / 1000) * audioBuffer.duration);
      }
    });

    dom.seekSlider.addEventListener('input', () => {
      if (!audioBuffer || !isSeeking) return;
      // Обновляем только визуально во время перетаскивания
      const t = (dom.seekSlider.value / 1000) * audioBuffer.duration;
      dom.currentTime.textContent = fmtTime(t);
    });

    dom.undoBtn.addEventListener('click', undoMark);

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
