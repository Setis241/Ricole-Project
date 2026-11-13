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
     3. Решения принимаются ПО ЧАСТЯМ ПЕСНИ, а не по строкам: внутри
        части кадр ведёт себя одинаково, смена части — склейка. Припев
        одинаков на всех припевах (крупнее, удар на входе, пульс на долю),
        последний — сильнее.
     4. Фон и камера построчно не переключаются: их ведёт визуализатор
        «Сюжет» по таймлайну частей (timeline).
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

  /* ── Части песни: таймлайн [{ t, type, last }] ──────────────
     Метки ([Куплет], [Предприпев], [Припев], [Бридж], [Проигрыш]…)
     главнее всего: часть длится до следующей метки. Меток нет —
     detectParts: повторы строк + громкость трека. Сверху — длинные паузы без слов: это
     проигрыш, даже если метки нет (там текст пропадает, и кадр должен
     жить сам). Последний припев помечен last — он бьёт сильнее. */
  function typeOf(label) {
    const l = String(label || '').toLowerCase();
    if (/пред|pre|подвод|build/.test(l)) return 'prechorus';      // до «припев»: «предприпев»
    if (/припев|chorus|refrain|hook|хор/.test(l)) return 'chorus';
    if (/бридж|bridge|перебив|middle/.test(l)) return 'bridge';
    if (/вступ|intro|интро/.test(l)) return 'intro';
    if (/инстр|instr|проигр|solo|соло|break|брейк|drop|дроп/.test(l)) return 'instrumental';
    if (/конц|outro|аутро|финал|ending|\bend\b/.test(l)) return 'outro';
    return 'verse';
  }

  const GAP = 12, HOLD = 5;   // пауза, после которой начинается проигрыш; сколько держится последняя строка

  /* ── Части БЕЗ разметки ──────────────────────────────────────
     Два сигнала, оба есть без меток:
       • повтор строк: припев — то, что возвращается. Строки сравниваются
         по первым трём словам — «Fifty thousand volts, is that enough?» и
         «Fifty thousand volts of company love» одна строка припева;
       • громкость трека (AudioAnalysis.energy, ±3 с): из нескольких
         повторяющихся групп припев — самая громкая.
     Повторяющиеся строки идут блоками (подряд, допускается одна
     «чужая» строка внутри). Блоки с общими строками — одна семья.
     Семья с наибольшей громкостью × числом строк — припев; другая
     повторяющаяся семья прямо перед припевом — подводка. Уникальный
     блок после второго припева и перед последним — бридж (если там не громче
     припева).
     Повторов нет вовсе — припевом считаются громкие места (energy ≥ 0.8
     на двух строках подряд). */
  function keyOf(text) {
    const w = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
    return w.length >= 4 ? w.slice(0, 3).join(' ') : w.join(' ');
  }

  function detectParts(sung, D) {
    const n = sung.length;
    if (!n) return [];
    const buf = typeof AudioEngine !== 'undefined' ? AudioEngine.buffer : null;
    const hasAudio = !!(buf && typeof AudioAnalysis !== 'undefined' && AudioAnalysis.get(buf));
    const energyAt = (t0, t1) => {
      if (!buf || typeof AudioAnalysis === 'undefined' || !AudioAnalysis.get(buf)) return 0.5;
      let sum = 0, k = 0;
      for (let t = t0; t < t1; t += 0.5) { const ev = AudioAnalysis.at(buf, t); if (ev) { sum += ev.energy; k++; } }
      return k ? sum / k : 0.5;
    };
    const L = sung.map((e, i) => {
      const end = i + 1 < n ? Math.min(sung[i + 1].time, e.time + 6) : Math.min(D || e.time + 4, e.time + 6);
      return { t: e.time, end: end, key: keyOf(e.text), e: energyAt(e.time, Math.max(end, e.time + 0.5)) };
    });
    const count = {};
    L.forEach(l => { if (l.key) count[l.key] = (count[l.key] || 0) + 1; });
    L.forEach(l => { l.rep = l.key ? count[l.key] : 0; });

    // Блоки повторяющихся строк
    const blocks = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const hook = L[i].rep >= 2;
      // одна неповторяющаяся строка между повторами — часть блока
      const bridgeOne = !hook && cur && i + 1 < n && L[i + 1].rep >= 2 && L[i + 1].t - L[i].t < 8;
      if (hook || bridgeOne) {
        if (cur && L[i].t - L[i - 1].t < 12) cur.to = i;
        else { cur = { from: i, to: i }; blocks.push(cur); }
      } else cur = null;
    }
    const good = blocks.filter(b => b.to > b.from || L[b.from].rep >= 3);

    // Семьи: блоки с общими строками
    const fam = [];
    good.forEach(b => {
      b.keys = new Set(); for (let i = b.from; i <= b.to; i++) if (L[i].rep >= 2) b.keys.add(L[i].key);
      let f = fam.find(F => [...b.keys].some(k => F.keys.has(k)));
      if (!f) { f = { keys: new Set(), blocks: [] }; fam.push(f); }
      b.keys.forEach(k => f.keys.add(k)); f.blocks.push(b);
    });
    fam.forEach(F => {
      let sum = 0, k = 0;
      F.blocks.forEach(b => { for (let i = b.from; i <= b.to; i++) { sum += L[i].e; k++; } });
      F.energy = k ? sum / k : 0; F.lines = k;
      F.score = F.energy * Math.sqrt(k) * (F.blocks.length >= 2 ? 1.3 : 1);
    });
    fam.sort((a, b) => b.score - a.score);

    const type = new Array(n).fill('verse');
    if (fam.length) {
      const chorus = fam[0];
      chorus.blocks.forEach(b => { for (let i = b.from; i <= b.to; i++) type[i] = 'chorus'; });
      // Подводка: блок другой семьи, кончающийся прямо перед припевом
      fam.slice(1).forEach(F => F.blocks.forEach(b => {
        const next = b.to + 1;
        if (next < n && type[next] === 'chorus' && L[next].t - L[b.to].t < 10 && F.energy <= chorus.energy + 0.05)
          for (let i = b.from; i <= b.to; i++) type[i] = 'prechorus';
      }));
    } else {
      // Повторов нет — громкие места
      for (let i = 0; i + 1 < n; i++) if (L[i].e >= 0.8 && L[i + 1].e >= 0.8) { type[i] = 'chorus'; type[i + 1] = 'chorus'; }
    }
    // Бридж: уникальный тихий блок после второго припева и перед последним
    const runs = [];
    for (let i = 0; i < n; i++) {
      if (!runs.length || runs[runs.length - 1].type !== type[i]) runs.push({ type: type[i], from: i, to: i });
      else runs[runs.length - 1].to = i;
    }
    const chRuns = runs.filter(r => r.type === 'chorus');
    if (chRuns.length >= 3) {
      const chE = chRuns.reduce((a, r) => a + L[r.from].e, 0) / chRuns.length;
      runs.forEach((r, k) => {
        if (r.type !== 'verse' || r.from < chRuns[1].to || r.to > chRuns[chRuns.length - 1].from) return;
        let uniq = true, e = 0;
        for (let i = r.from; i <= r.to; i++) { if (L[i].rep > 1) uniq = false; e += L[i].e; }
        e /= (r.to - r.from + 1);
        // Без звука громкость неизвестна (везде 0.5) — хватает места в песне
        // Место в песне (между последними припевами, свои строки) — главный признак;
        // звук только отменяет бридж, если там заметно громче припева
        if (uniq && (!hasAudio || e <= chE + 0.03)) for (let i = r.from; i <= r.to; i++) type[i] = 'bridge';
      });
    }
    // Границы частей — по началам строк
    const tl = [];
    for (let i = 0; i < n; i++) {
      if (i === 0 || type[i] !== type[i - 1] || (type[i] === 'chorus' && L[i].t - L[i - 1].t > 12))
        tl.push({ t: L[i].t - 0.05, type: type[i] });
    }
    return tl;
  }

  function timeline(entries, duration) {
    entries = (entries || []).filter(e => e && isFinite(e.time));
    const sung = entries.filter(e => e.text);
    const D = duration || (entries.length ? entries[entries.length - 1].time + 8 : 0);
    let tl = [];
    if (!sung.length) return [{ t: 0, type: 'instrumental' }];
    if (entries.some(e => e.section)) {
      let cur = 'verse';
      entries.forEach(e => { if (e.section) { cur = typeOf(e.section); tl.push({ t: e.time, type: cur }); } });
      if (!tl.length || tl[0].t > sung[0].time) tl.unshift({ t: sung[0].time, type: 'verse' });
    } else {
      tl = detectParts(sung, D);
    }
    if (!tl.length) tl.push({ t: sung[0].time, type: 'verse' });
    // Вступление до первой строки и концовка после последней
    if (sung[0].time > 3) tl.unshift({ t: 0, type: 'intro' });
    else tl[0].t = 0;
    const lastSung = sung[sung.length - 1].time;
    // Длинные паузы без слов — проигрыш, потом возврат к своей части.
    // 12 с между началами строк: сама строка держится до ~6 с, остальное — тишина.
    const extra = [];
    for (let i = 0; i < sung.length - 1; i++) {
      const gap = sung[i + 1].time - sung[i].time;
      if (gap > GAP) {
        const at = sung[i].time + HOLD;
        const back = typeAt(tl, sung[i + 1].time - 0.01);
        extra.push({ t: at, type: 'instrumental' }, { t: sung[i + 1].time - 0.4, type: back.type, resume: true });
      }
    }
    if (D - lastSung > 10) extra.push({ t: lastSung + HOLD, type: 'outro' });
    tl = tl.concat(extra).sort((a, b) => a.t - b.t);
    // Возврат из проигрыша и метка части рядом (меньше 1.5 с) — одна граница, по метке
    tl = tl.filter((s, i) => !(s.resume && tl[i + 1] && tl[i + 1].t - s.t < 1.5));
    // Подряд одинаковые — одна часть (кроме припева: повтор припева — новый удар)
    tl = tl.filter((s, i) => i === 0 || s.type !== tl[i - 1].type || (s.type === 'chorus' && !s.resume));
    for (let i = tl.length - 1; i >= 0; i--) if (tl[i].type === 'chorus') { tl[i].last = true; break; }
    tl.forEach((s, i) => { s.end = i + 1 < tl.length ? tl[i + 1].t : D; });
    return tl;
  }
  function typeAt(tl, t) {
    let r = tl[0] || { t: 0, type: 'verse' };
    for (const s of tl) { if (s.t <= t) r = s; else break; }
    return r;
  }

  const stampOf = m => { const t = m.match(/\[(\d{1,2}):(\d{2})[.:](\d{2,3})\]/); return t ? +t[1] * 60 + +t[2] + +('0.' + t[3]) : -1; };

  /* Режиссура целиком.
     mode 'live' (по умолчанию) — «по частям песни»: у каждой части свой
       характер, внутри части ничего не дёргается; смена части — монтажная
       склейка (вспышка, удар камеры). Припев — крупнее, с ударом на входе
       строки и пульсом на сильную долю; фон на припеве раскрывается
       (затемнение снимается), на куплете и бридже — приглушён; бридж —
       мягкое проявление строк. Камеру и пост ведёт визуализатор «Сюжет».
     mode 'calm' — прежний спокойный вариант: одна подача, припев крупнее. */
  function run(opts) {
    opts = opts || {};
    const live = opts.mode !== 'calm';
    const el = document.getElementById('lyricsInput');
    const raw = el ? el.value : '';
    const report = { lines: 0, chorus: 0, cleaned: 0, sections: 0 };

    if (raw.trim()) {
      const cleaned = clean(raw);
      report.cleaned = (raw.match(/\{[^}]*\}/g) || []).length + (raw.match(/\/[^\/{}<>]+\//g) || []).length;
      const entries = typeof LRCParser !== 'undefined' ? LRCParser.parse(cleaned) : [];
      const D = typeof AudioEngine !== 'undefined' && AudioEngine.duration ? AudioEngine.duration : 0;
      const tl = timeline(entries, D);
      report.sections = tl.length;
      const params = typeof App !== 'undefined' ? App.getState().params : {};
      const big = Math.round((params.fontSize || 96) * 1.12);
      let prevType = null, dark = null;
      const lrc = cleaned.split('\n').map(line => {
        const m = line.match(TIME_RE);
        if (!m) return line;
        const body = m[2];
        if (!body.replace(/^\s*\[[^\]]*\]\s*/, '').trim()) return line;   // метка части / пустая
        report.lines++;
        const sec = typeAt(tl, stampOf(m[1]) + 0.01);
        let tags = '';
        if (sec.type === 'chorus') { report.chorus++; tags += '{LSIZE:' + big + '}' + (live ? '{LANIM:lyricpop}' : ''); }
        else if (live && sec.type === 'bridge') tags += '{LANIM:lyricsoft}';
        // Фон — только на границе части: припев раскрывается, остальное приглушено
        if (live && sec.type !== prevType) {
          const want = !(sec.type === 'chorus' || sec.type === 'instrumental' || sec.type === 'intro');
          if (want !== dark) { tags += want ? '/НАЧАЛО ЗАТУХАНИЯ/' : '/КОНЕЦ ЗАТУХАНИЯ/'; dark = want; }
        }
        prevType = sec.type;
        if (!tags) return line;
        const lead = body.match(/^\s*\[[^\]]*\]\s*/);
        return lead ? m[1] + lead[0] + tags + body.slice(lead[0].length) : m[1] + tags + body;
      }).join('\n');
      // Текст держится до следующей строки — на проигрыше и в конце кадр
      // освобождается пустой строкой: там выходит спектр
      let out = lrc;
      if (live) {
        const f = s => '[' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + (s % 60).toFixed(2).padStart(5, '0') + ']';
        const times = entries.map(e => e.time);
        const blanks = tl.filter(s => (s.type === 'instrumental' || s.type === 'outro') && s.t > 0.5 &&
          !times.some(x => Math.abs(x - s.t) < 1)).map(s => s.t);
        if (blanks.length) {
          // Вставка на место по времени; строки без таймкода стоят где стояли
          const res = [];
          let bi = 0;
          lrc.split('\n').forEach(line => {
            const ts = stampOf(line);
            while (ts >= 0 && bi < blanks.length && blanks[bi] < ts) res.push(f(blanks[bi++]));
            res.push(line);
          });
          while (bi < blanks.length) res.push(f(blanks[bi++]));
          out = res.join('\n');
          report.cleared = blanks.length;
        }
      }
      const lrcFinal = out;
      if (typeof App !== 'undefined' && App.setLyricsText) App.setLyricsText(lrcFinal);
      else if (el) { el.value = lrcFinal; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }

    // ── Подача текста и фон без построчной дёрганины
    if (typeof PresetManager !== 'undefined' && PresetManager.applyState) {
      PresetManager.applyState({
        params: { animMode: 'lyric' },
        fxState: { chromatic: false, letterboxReactive: false },
        camState: { musicZoom: { enabled: false, invert: false, amount: 0.4 } },
      });
    }
    if (typeof AutoDirector !== 'undefined') {
      if (AutoDirector.clearDirectorScenes) AutoDirector.clearDirectorScenes();
      if (AutoDirector.clearCharacterPlan) AutoDirector.clearCharacterPlan();
    }
    if (typeof Visualizer !== 'undefined' && Visualizer.settings.preset !== 'off') {
      Visualizer.set({ preset: live ? 'story' : 'calm', amount: Math.min(Visualizer.settings.amount || 1, 1) });
    }
    if (typeof PresetManager !== 'undefined' && PresetManager.scheduleAutosave) PresetManager.scheduleAutosave();
    return report;
  }

  return { run: run, clean: clean, timeline: timeline, typeAt: typeAt, typeOf: typeOf };
})();
