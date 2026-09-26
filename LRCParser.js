/* ═══════════════════════════════════════════════
   js/LRCParser.js  v2
   Парсит LRC-файлы с командами фона, камеры и стилями строк

   КОМАНДЫ ФОНА:
   /НАЧАЛО ЗАТУХАНИЯ/ — затемнить фон
   /КОНЕЦ ЗАТУХАНИЯ/  — вернуть фон
   /ЯРКИЙ ФОН/        — осветлить фон
   /КОНЕЦ ЯРКОСТИ/    — вернуть яркость фона
   /РАЗМЫТИЕ/         — размыть фон
   /ЧЕТКОСТЬ/         — убрать размытие

   КОМАНДЫ КАМЕРЫ (новые):
   /ZOOM IN/          — музыкальный зум ВОВНУТРЬ (реакция на бас)
   /ZOOM OUT/         — музыкальный зум НАРУЖУ
   /ZOOM STOP/        — остановить музыкальный зум
   /SCROLL LEFT/      — прокрутка фона влево
   /SCROLL RIGHT/     — прокрутка фона вправо
   /SCROLL UP/        — прокрутка фона вверх
   /SCROLL DOWN/      — прокрутка фона вниз
   /SCROLL STOP/      — остановить прокрутку
   /CAMERA RESET/     — сбросить все параметры камеры

   ПОСЛОВНЫЕ ТАЙМИНГИ (Enhanced LRC):
   [00:12.00] <00:12.00>Я <00:12.35>иду <00:12.90>домой
   Строчный таймкод остаётся ведущим, теги <mm:ss.cc> — опциональная
   разметка слов внутри строки. Файл без них разбирается как раньше:
   wordTimes просто равен null.

   СТИЛИ СТРОК (per-line overrides):
   {LFONT:'Bebas Neue', cursive}  — шрифт строки
   {LSIZE:120}                    — размер шрифта строки
   {LANIM:glitch}                 — режим анимации строки
   {LCOLOR:#ff2d55}               — цвет текста строки
   {LPOS:top}                     — позиция текста (top/center/bottom + -left/-right)
═══════════════════════════════════════════════ */
const LRCParser = (() => {
  const LRC_RE = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/;
  const WORD_TAG_RE   = /<(\d{1,2}):(\d{2})[.:](\d{2,3})>/g;
  const LINE_STYLE_RE = /\{L(?:FONT|SIZE|ANIM|COLOR|BGIMG|POS|POSX|POSY|LAYER|OVFX|NOBOX):[^}]+\}|\{LNOBOX\}/g;

  // Извлекает per-line стиль из rawText
  function extractLineStyle(text) {
    const ls = {};
    const fontM  = text.match(/\{LFONT:([^}]+)\}/);
    const sizeM  = text.match(/\{LSIZE:(\d+)\}/);
    const animM  = text.match(/\{LANIM:([^}]+)\}/);
    const colorM = text.match(/\{LCOLOR:(#[0-9a-fA-F]{3,6})\}/);
    const bgImgM = text.match(/\{LBGIMG:([^}]+)\}/);
    const posM   = text.match(/\{LPOS:(top-left|top-right|top|center-left|center-right|center|bottom-left|bottom-right|bottom)\}/i);
    // Числовой якорь строки в % кадра. Сетка из девяти позиций годится для
    // субтитра, но не для композиции: чтобы поставить текст относительно
    // фигуры в кадре, нужна произвольная точка, а не 15/50/85.
    const posXM  = text.match(/\{LPOSX:(\d{1,3}(?:\.\d+)?)\}/i);
    const posYM  = text.match(/\{LPOSY:(\d{1,3}(?:\.\d+)?)\}/i);
    const layerM = text.match(/\{LLAYER:(above|below)\}/i);
    const ovfxM  = text.match(/\{LOVFX:(static|sway|pulse|stretch|float|shake|bounce|spin)\}/i);
    const noBoxM = text.match(/\{LNOBOX\}/i);
    if (fontM)  ls.font       = fontM[1].trim();
    if (sizeM)  ls.fontSize   = parseInt(sizeM[1], 10);
    if (animM)  ls.animMode   = animM[1].trim();
    if (colorM) ls.color      = colorM[1];
    if (bgImgM) ls.bgImageKey = bgImgM[1].trim();
    if (posM)   ls.position   = posM[1].toLowerCase();
    if (posXM)  ls.anchorX    = Math.max(0, Math.min(100, parseFloat(posXM[1])));
    if (posYM)  ls.anchorY    = Math.max(0, Math.min(100, parseFloat(posYM[1])));
    if (layerM) ls.layer      = layerM[1].toLowerCase();
    if (ovfxM)  ls.overlayEffect = ovfxM[1].toLowerCase();
    if (noBoxM) ls.noBox      = true;
    return ls;
  }

  // Извлекает все команды фона и камеры из текста
  function extractBackgroundCommands(text) {
    const commands = [];
    // Фигурные скобки исключены: иначе пара закрывающих тегов
    // ({/GLOW}{/BOXSUB}) читается как команда и текст ломается.
    const commandRE = /\/([^\/{}]+)\//g;
    let match;

    while ((match = commandRE.exec(text)) !== null) {
      const cmd = match[1].trim().toUpperCase();

      // ── Команды фона ──────────────────────────
      if (cmd.includes('ЗАТУХАН') || cmd.includes('ТЕМН') || cmd.includes('МРАЧН')) {
        if (cmd.includes('НАЧАЛО') || cmd.includes('START')) {
          commands.push({ type: 'darken', value: true });
        } else if (cmd.includes('КОНЕЦ') || cmd.includes('END') || cmd.includes('СТОП')) {
          commands.push({ type: 'darken', value: false });
        }
      }
      if (cmd.includes('ЯРКИЙ') || cmd.includes('ЯРКОСТ') || cmd.includes('СВЕТЛ') || cmd.includes('BRIGHT')) {
        if (cmd.includes('КОНЕЦ') || cmd.includes('END') || cmd.includes('СТОП')) {
          commands.push({ type: 'brighten', value: false });
        } else {
          commands.push({ type: 'brighten', value: true });
        }
      }
      if ((cmd.includes('РАЗМЫТ') || cmd === 'BLUR') && !cmd.includes('ЧЕТК') && !cmd.includes('SHARP')) {
        commands.push({ type: 'blur', value: true });
      }
      if (cmd.includes('ЧЕТК') || cmd.includes('SHARP') || cmd.includes('CLEAR')) {
        commands.push({ type: 'blur', value: false });
      }
      if (cmd.includes('LETTERBOX')) {
        // Унифицированная семантика: один тег = одно состояние.
        //   /LETTERBOX OFF/         → bars off, reactive off
        //   /LETTERBOX REACTIVE/    → bars on, reactive on
        //   /LETTERBOX/             → bars on, reactive off
        if (cmd.includes('OFF')) {
          commands.push({ type: 'letterbox', value: false });
          commands.push({ type: 'letterboxReactive', value: false });
        } else if (cmd.includes('REACTIVE')) {
          commands.push({ type: 'letterbox', value: true });
          commands.push({ type: 'letterboxReactive', value: true });
        } else {
          commands.push({ type: 'letterbox', value: true });
          commands.push({ type: 'letterboxReactive', value: false });
        }
      }

      // ── Команды камеры: зум ───────────────────
      if (cmd === 'ZOOM IN')   commands.push({ type: 'zoomIn'   });
      if (cmd === 'ZOOM OUT')  commands.push({ type: 'zoomOut'  });
      if (cmd === 'ZOOM STOP') commands.push({ type: 'zoomStop' });
      // Per-line сила зума: /ZOOM AMT 0.7/
      const amtMatch = cmd.match(/^ZOOM AMT (\d*\.?\d+)$/);
      if (amtMatch) commands.push({ type: 'zoomAmount', value: parseFloat(amtMatch[1]) });

      // ── Команды камеры: прокрутка ─────────────
      if (cmd === 'SCROLL LEFT')  commands.push({ type: 'scrollLeft'  });
      if (cmd === 'SCROLL RIGHT') commands.push({ type: 'scrollRight' });
      if (cmd === 'SCROLL UP')    commands.push({ type: 'scrollUp'    });
      if (cmd === 'SCROLL DOWN')  commands.push({ type: 'scrollDown'  });
      if (cmd === 'SCROLL STOP')  commands.push({ type: 'scrollStop'  });

      // ── Полный сброс камеры ───────────────────
      if (cmd === 'CAMERA RESET') commands.push({ type: 'cameraReset' });
    }

    return commands;
  }

  // Извлекает метку секции [Verse 1], [Chorus] и т.д.
  function extractSectionLabel(text) {
    const match = text.match(/^\[([^\]]+)\]/);
    return match ? match[1].trim() : null;
  }

  // Проверяет, является ли строка ending-маркером (концом видео).
  // Распознаёт секции [конец], [конец видео], [end], [ending], [finale], [outro]
  // и команды /КОНЕЦ ВИДЕО/, /THE END/, /ENDING/, /FINALE/, /OUTRO/
  const ENDING_KEYWORDS = ['конец', 'конец видео', 'окончание', 'финал',
                           'end', 'ending', 'the end', 'finale', 'outro'];
  function isEndingMarker(text) {
    const section = extractSectionLabel(text);
    if (section && ENDING_KEYWORDS.includes(section.trim().toLowerCase())) return true;
    const cmdMatch = text.match(/\/([^\/]+)\//);
    if (cmdMatch) {
      const c = cmdMatch[1].trim().toLowerCase();
      if (c === 'конец видео' || c === 'the end' || c === 'ending' || c === 'outro' || c === 'finale') return true;
    }
    return false;
  }

  // Маркеры "пустой" строки — пользователь явно ставит их когда не хочет показывать
  // ни текст, ни рамку (например при чисто инструментальных проигрышах).
  // Поддерживается несколько форм: (пусто), (empty), —, ---, ... и т.д.
  const EMPTY_MARKERS = /^(\(пусто\)|\(empty\)|\(нет\)|\(none\)|—|–|-{2,}|\.{3,})$/i;
  function _stripIfEmptyMarker(s) {
    if (s && EMPTY_MARKERS.test(s.trim())) return '';
    return s;
  }

  // Очищает текст от команд, меток секций и line-style тегов.
  // Перевод (всё после >>>) убирается здесь — он хранится в поле translation.
  function cleanText(text) {
    const sepIdx = text.indexOf('>>>');
    if (sepIdx !== -1) text = text.slice(0, sepIdx);
    const cleaned = text
      .replace(WORD_TAG_RE, '')
      .replace(LINE_STYLE_RE, '')
      .replace(/\/[^\/{}]+\//g, '')
      .replace(/^\[[^\]]+\]\s*/g, '')
      .trim();
    return _stripIfEmptyMarker(cleaned);
  }

  // Извлекает перевод из rawText (текст после >>>)
  function extractTranslation(text) {
    const sepIdx = text.indexOf('>>>');
    if (sepIdx === -1) return null;
    // Очищаем перевод от line-style тегов и команд, но оставляем сам текст
    const cleaned = text.slice(sepIdx + 3)
      .replace(WORD_TAG_RE, '')
      .replace(LINE_STYLE_RE, '')
      .replace(/\/[^\/{}]+\//g, '')
      .trim();
    const stripped = _stripIfEmptyMarker(cleaned);
    return stripped || null;
  }

  /* Пословные тайминги строки.

     Метка ставится ПЕРЕД словом и действует до следующей метки, поэтому
     чанк между двумя тегами — это не обязательно одно слово: файл, набранный
     руками, вправе пометить целую фразу. Возвращаем то, что реально
     записано ({t, text}), а не выдуманное разбиение по пробелам — иначе
     половина слов получила бы фальшивое время.

     Строка без тегов → null, а не пустой массив: потребителю важно
     отличать «разметки нет» от «разметка есть и она пустая». */
  function extractWordTimes(text) {
    const sepIdx = text.indexOf('>>>');
    const main = sepIdx === -1 ? text : text.slice(0, sepIdx);
    if (!WORD_TAG_RE.test(main)) { WORD_TAG_RE.lastIndex = 0; return null; }
    WORD_TAG_RE.lastIndex = 0;

    // Команды и стилевые теги убираем, но пословные — оставляем.
    const stripped = main
      .replace(LINE_STYLE_RE, '')
      .replace(/\/[^\/{}]+\//g, '')
      .replace(/^\[[^\]]+\]\s*/g, '');

    const out = [];
    const re = /<(\d{1,2}):(\d{2})[.:](\d{2,3})>([^<]*)/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const ms = m[3].length === 2 ? parseInt(m[3], 10) * 10 : parseInt(m[3], 10);
      const chunk = m[4].trim();
      if (!chunk) continue;
      out.push({ t: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + ms / 1000, text: chunk });
    }
    return out.length ? out.sort((a, b) => a.t - b.t) : null;
  }

  function parse(raw) {
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
    const hasTimecodes = lines.some(l => LRC_RE.test(l));

    if (hasTimecodes) {
      /* Метка секции ОТДЕЛЬНОЙ строкой — [Припев] без тайминга.
         Так её и пишут от руки, и так она нагляднее всего: заголовок стоит
         НАД куском, а не приклеен к первой строке. Но строка без тайминга
         не проходит LRC_RE и раньше молча выбрасывалась — то есть разметка
         не работала вовсе, и пользователь об этом никак не узнавал.
         Теперь такая метка запоминается и достаётся СЛЕДУЮЩЕЙ строке с
         таймингом: именно с неё и начинается размеченная секция. */
      let pendingSection = null;
      return lines
        .map(line => {
          const m = line.match(LRC_RE);
          if (!m) {
            const bare = extractSectionLabel(line);
            // Только если в строке НИЧЕГО, кроме метки: «[Chorus] и дальше
            // текст» без тайминга — это потерянная строка, а не заголовок.
            if (bare && line.trim() === '[' + bare + ']') pendingSection = bare;
            return null;
          }
          const mins = parseInt(m[1], 10);
          const secs = parseInt(m[2], 10);
          const ms   = m[3].length === 2
            ? parseInt(m[3], 10) * 10
            : parseInt(m[3], 10);

          const rawText     = m[4] || '';
          const bgCommands  = extractBackgroundCommands(rawText);
          let   section     = extractSectionLabel(rawText);
          if (!section && pendingSection) section = pendingSection;
          pendingSection = null;
          const lineStyle   = extractLineStyle(rawText);
          const text        = cleanText(rawText);
          const translation = extractTranslation(rawText);
          const isEnding    = isEndingMarker(rawText);
          const wordTimes   = extractWordTimes(rawText);

          return {
            time: mins * 60 + secs + ms / 1000,
            text,
            rawText,
            bgCommands,  // включает и camera-команды
            section,
            lineStyle,
            translation, // null или строка перевода
            isEnding,    // true если эта строка — маркер конца видео
            wordTimes,   // null или [{t, text}] — пословная разметка строки
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.time - b.time);
    } else {
      return lines.map((text, i) => ({
        time:       i * 2,
        text:       cleanText(text),
        rawText:    text,
        bgCommands: extractBackgroundCommands(text),
        section:    extractSectionLabel(text),
        lineStyle:  extractLineStyle(text),
        translation: extractTranslation(text),
        isEnding:   isEndingMarker(text),
        wordTimes:  extractWordTimes(text),
      }));
    }
  }

  /* Обратная операция: вписывает пословные метки в rawText.

     Наивная замена «слово → <t>слово» здесь не годится: в rawText вперемешку
     лежат стилевые теги {LSIZE:120}, команды /ZOOM IN/ и метка секции — их
     нельзя ни помечать временем, ни сбивать нумерацию слов о них. Поэтому
     строка разбирается на токены, и метки получают только настоящие слова.

     Перевод после >>> не трогаем: он показывается как отдельная строка и
     собственных таймингов не имеет. */
  const TOKEN_RE = /(\{[^}]*\}|\/[^\/{}]+\/|<\d{1,2}:\d{2}[.:]\d{2,3}>|\s+)/;
  function injectWordTimes(rawText, wordTimes) {
    if (!wordTimes || !wordTimes.length) return rawText;

    const sepIdx = rawText.indexOf('>>>');
    let main = sepIdx === -1 ? rawText : rawText.slice(0, sepIdx);
    const tail = sepIdx === -1 ? '' : rawText.slice(sepIdx);

    // Метка секции в начале — часть служебной разметки, а не слово.
    let head = '';
    const secM = main.match(/^\s*\[[^\]]+\]\s*/);
    if (secM) { head = secM[0]; main = main.slice(secM[0].length); }

    let wi = 0;
    const out = main.split(TOKEN_RE).map(tok => {
      if (!tok) return '';
      // Старые пословные метки выбрасываем — их заменяет новая разметка.
      if (/^<\d{1,2}:\d{2}[.:]\d{2,3}>$/.test(tok)) return '';
      if (/^\s+$/.test(tok) || /^\{/.test(tok) || /^\//.test(tok)) return tok;
      const wt = wordTimes[wi++];
      return wt ? fmtTag(wt.t) + tok : tok;
    }).join('');

    return head + out + tail;
  }

  function fmtTag(t) {
    const m  = Math.floor(t / 60);
    const s  = Math.floor(t % 60);
    const cs = Math.round((t % 1) * 100);
    return `<${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}>`;
  }

  // Сериализует массив [{time, rawText, text}] обратно в LRC-строку
  function serialize(entries) {
    return entries
      .sort((a, b) => a.time - b.time)
      .map(({ time, rawText, text, wordTimes }) => {
        const m   = Math.floor(time / 60);
        const s   = Math.floor(time % 60);
        const cs  = Math.round((time % 1) * 100);
        const content = injectWordTimes(rawText || text, wordTimes);
        return `[${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}] ${content}`;
      })
      .join('\n');
  }

  return { parse, serialize, extractBackgroundCommands, extractLineStyle,
           extractTranslation, isEndingMarker, extractWordTimes, injectWordTimes };
})();