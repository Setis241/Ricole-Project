/* ══════════════════════════════════════════════════════════════
   LyricDirector — спокойный режиссёр под лирик-видео YouTube.

   Старый AutoDirector менял почти всё почти на каждой строке: место
   строки, кегль, манеру появления, затемнение/размытие/полосы/зум фона,
   сцены камеры, позу фигуры. Каждое решение по отдельности объяснимо,
   вместе — кадр дёргается всё время.

   Здесь правила лирик-видео:
     1. Текст стоит на ОДНОМ месте всю песню (то, что выставлено в
        настройках). Никаких перескоков строки по кадру.
     2. Один шрифт, один цвет, одна подача ('lyric': плавное появление,
        дальше строка стоит). Пословной кинетики нет.
     3. Припев отличается одинаково на всех припевах: чуть крупнее
        (×1.12). Больше ничего.
     4. Фон и камера не переключаются построчно. Жизнь кадру даёт
        визуализатор («Спокойно»): дыхание на бас, мягкая вспышка на
        смене части песни.
     5. Фигуру не гоняет: стоит там, где поставил ты.
     6. Твой стиль (шрифт, рамка, цвет, перевод, позиция) не трогается.

   Из лирики убираются построчные теги {…} и команды /…/, которые
   наставил старый режиссёр или ты. Остаются: таймкоды, слова, пословная
   разметка <mm:ss.cc>, метки частей [Припев], перевод (>>>), конец видео.
══════════════════════════════════════════════════════════════ */
const LyricDirector = (function () {
  'use strict';

  const ENDING = /^(конец|конец видео|окончание|финал|end|ending|the end|finale|outro)$/i;
  const TIME_RE = /^(\[\d{1,2}:\d{2}[.:]\d{2,3}\])(.*)$/;

  // Строка лирики без режиссёрских тегов и команд
  function cleanLine(body) {
    let main = body, tr = '';
    const k = body.indexOf('>>>');
    if (k >= 0) { main = body.slice(0, k); tr = body.slice(k); }
    main = main
      .replace(/\{[^}]*\}/g, '')                                       // {LSIZE:..} {BOXNEON} {/COLOR} …
      .replace(/\/([^\/{}<>]+)\//g, (m, c) => ENDING.test(c.trim()) ? m : '')   // /ZOOM IN/ …, кроме конца видео
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^\s+|\s+$/g, '');
    return main + (tr ? ' ' + tr.trim() : '');
  }

  function clean(raw) {
    return String(raw || '').split(/\r?\n/).map(line => {
      const m = line.match(TIME_RE);
      return m ? m[1] + cleanLine(m[2]) : line;
    }).join('\n');
  }

  /* Какие строки — припев. Метки частей ([Припев], [Chorus]…) главнее
     всего: часть длится до следующей метки. Меток нет — структура
     AutoDirector (повторы строк + звук). */
  const CHORUS = /припев|chorus|refrain|hook|хор/i;
  function chorusTimes(raw) {
    const out = new Set();
    if (typeof LRCParser === 'undefined') return out;
    const entries = LRCParser.parse(raw);
    if (!entries.length) return out;
    if (entries.some(e => e.section)) {
      let inChorus = false;
      entries.forEach(e => {
        if (e.section) inChorus = CHORUS.test(e.section);
        if (inChorus && e.text) out.add(Math.round(e.time * 100));
      });
      return out;
    }
    if (typeof AutoDirector === 'undefined') return out;
    try {
      const buf = typeof AudioEngine !== 'undefined' ? AudioEngine.buffer : null;
      const audio = buf ? AutoDirector.analyzeAudio(buf) : null;
      const dur = audio ? audio.duration : entries[entries.length - 1].time + 5;
      const lyr = AutoDirector.analyzeLyrics(entries, dur);
      const sections = AutoDirector.buildStructure(audio, lyr);
      sections.forEach(s => {
        if (s.type !== 'chorus') return;
        s.lines.forEach(l => { if (l.text) out.add(Math.round(l.time * 100)); });
      });
    } catch (e) { console.warn('[LyricDirector] структура не посчиталась', e); }
    return out;
  }

  const fmtStamp = m => { const t = m.match(/\[(\d{1,2}):(\d{2})[.:](\d{2,3})\]/); return t ? Math.round((+t[1] * 60 + +t[2] + +('0.' + t[3])) * 100) : -1; };

  /* Режиссура целиком. Возвращает отчёт для панели. */
  function run(opts) {
    opts = opts || {};
    const el = document.getElementById('lyricsInput');
    const raw = el ? el.value : '';
    const report = { lines: 0, chorus: 0, cleaned: 0 };

    // ── Текст
    if (raw.trim()) {
      const cleaned = clean(raw);
      report.cleaned = (raw.match(/\{[^}]*\}/g) || []).length + (raw.match(/\/[^\/{}<>]+\//g) || []).length;
      const chorus = opts.chorus === false ? new Set() : chorusTimes(cleaned);
      const params = typeof App !== 'undefined' ? App.getState().params : {};
      const big = Math.round((params.fontSize || 96) * 1.12);
      const lrc = cleaned.split('\n').map(line => {
        const m = line.match(TIME_RE);
        if (!m) return line;
        const body = m[2];
        if (!body.replace(/^\s*\[[^\]]*\]\s*/, '').trim()) return line;   // метка части / пустая
        report.lines++;
        if (!chorus.has(fmtStamp(m[1]))) return line;
        report.chorus++;
        // Тег ставится ПОСЛЕ метки части, если она есть в начале строки
        const lead = body.match(/^\s*\[[^\]]*\]\s*/);
        return lead ? m[1] + lead[0] + '{LSIZE:' + big + '}' + body.slice(lead[0].length)
                    : m[1] + '{LSIZE:' + big + '}' + body;
      }).join('\n');
      if (typeof App !== 'undefined' && App.setLyricsText) App.setLyricsText(lrc);
      else if (el) { el.value = lrc; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }

    // ── Подача текста и спокойный фон: только то, что дёргало
    if (typeof PresetManager !== 'undefined' && PresetManager.applyState) {
      PresetManager.applyState({
        params: { animMode: 'lyric' },
        fxState: { chromatic: false, letterboxReactive: false },
        camState: { musicZoom: { enabled: false, invert: false, amount: 0.4 } },
      });
    }
    // ── Сцены камеры и хореография фигуры от старого режиссёра — долой
    if (typeof AutoDirector !== 'undefined') {
      if (AutoDirector.clearDirectorScenes) AutoDirector.clearDirectorScenes();
      if (AutoDirector.clearCharacterPlan) AutoDirector.clearCharacterPlan();
    }
    // ── Движение — визуализатор «Спокойно» (если ты его не выключил)
    if (typeof Visualizer !== 'undefined' && Visualizer.settings.preset !== 'off') {
      Visualizer.set({ preset: 'calm', amount: Math.min(Visualizer.settings.amount || 1, 1) });
    }
    if (typeof PresetManager !== 'undefined' && PresetManager.scheduleAutosave) PresetManager.scheduleAutosave();
    return report;
  }

  return { run: run, clean: clean };
})();
