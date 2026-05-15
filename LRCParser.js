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

   СТИЛИ СТРОК (per-line overrides):
   {LFONT:'Bebas Neue', cursive}  — шрифт строки
   {LSIZE:120}                    — размер шрифта строки
   {LANIM:glitch}                 — режим анимации строки
   {LCOLOR:#ff2d55}               — цвет текста строки
   {LPOS:top}                     — позиция текста (top/center/bottom + -left/-right)
═══════════════════════════════════════════════ */
const LRCParser = (() => {
  const LRC_RE = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/;
  const LINE_STYLE_RE = /\{L(?:FONT|SIZE|ANIM|COLOR|BGIMG|POS|LAYER|OVFX|NOBOX):[^}]+\}|\{LNOBOX\}/g;

  // Извлекает per-line стиль из rawText
  function extractLineStyle(text) {
    const ls = {};
    const fontM  = text.match(/\{LFONT:([^}]+)\}/);
    const sizeM  = text.match(/\{LSIZE:(\d+)\}/);
    const animM  = text.match(/\{LANIM:([^}]+)\}/);
    const colorM = text.match(/\{LCOLOR:(#[0-9a-fA-F]{3,6})\}/);
    const bgImgM = text.match(/\{LBGIMG:([^}]+)\}/);
    const posM   = text.match(/\{LPOS:(top-left|top-right|top|center-left|center-right|center|bottom-left|bottom-right|bottom)\}/i);
    const layerM = text.match(/\{LLAYER:(above|below)\}/i);
    const ovfxM  = text.match(/\{LOVFX:(static|sway|pulse|stretch|float|shake|bounce|spin)\}/i);
    const noBoxM = text.match(/\{LNOBOX\}/i);
    if (fontM)  ls.font       = fontM[1].trim();
    if (sizeM)  ls.fontSize   = parseInt(sizeM[1], 10);
    if (animM)  ls.animMode   = animM[1].trim();
    if (colorM) ls.color      = colorM[1];
    if (bgImgM) ls.bgImageKey = bgImgM[1].trim();
    if (posM)   ls.position   = posM[1].toLowerCase();
    if (layerM) ls.layer      = layerM[1].toLowerCase();
    if (ovfxM)  ls.overlayEffect = ovfxM[1].toLowerCase();
    if (noBoxM) ls.noBox      = true;
    return ls;
  }

  // Извлекает все команды фона и камеры из текста
  function extractBackgroundCommands(text) {
    const commands = [];
    const commandRE = /\/([^\/]+)\//g;
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

  // Очищает текст от команд, меток секций и line-style тегов.
  // Перевод (всё после >>>) убирается здесь — он хранится в поле translation.
  function cleanText(text) {
    const sepIdx = text.indexOf('>>>');
    if (sepIdx !== -1) text = text.slice(0, sepIdx);
    return text
      .replace(LINE_STYLE_RE, '')
      .replace(/\/[^\/]+\//g, '')
      .replace(/^\[[^\]]+\]\s*/g, '')
      .trim();
  }

  // Извлекает перевод из rawText (текст после >>>)
  function extractTranslation(text) {
    const sepIdx = text.indexOf('>>>');
    if (sepIdx === -1) return null;
    // Очищаем перевод от line-style тегов и команд, но оставляем сам текст
    return text.slice(sepIdx + 3)
      .replace(LINE_STYLE_RE, '')
      .replace(/\/[^\/]+\//g, '')
      .trim() || null;
  }

  function parse(raw) {
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
    const hasTimecodes = lines.some(l => LRC_RE.test(l));

    if (hasTimecodes) {
      return lines
        .map(line => {
          const m = line.match(LRC_RE);
          if (!m) return null;
          const mins = parseInt(m[1], 10);
          const secs = parseInt(m[2], 10);
          const ms   = m[3].length === 2
            ? parseInt(m[3], 10) * 10
            : parseInt(m[3], 10);

          const rawText     = m[4] || '';
          const bgCommands  = extractBackgroundCommands(rawText);
          const section     = extractSectionLabel(rawText);
          const lineStyle   = extractLineStyle(rawText);
          const text        = cleanText(rawText);
          const translation = extractTranslation(rawText);

          return {
            time: mins * 60 + secs + ms / 1000,
            text,
            rawText,
            bgCommands,  // включает и camera-команды
            section,
            lineStyle,
            translation, // null или строка перевода
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
      }));
    }
  }

  // Сериализует массив [{time, rawText, text}] обратно в LRC-строку
  function serialize(entries) {
    return entries
      .sort((a, b) => a.time - b.time)
      .map(({ time, rawText, text }) => {
        const m   = Math.floor(time / 60);
        const s   = Math.floor(time % 60);
        const cs  = Math.round((time % 1) * 100);
        const content = rawText || text;
        return `[${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}] ${content}`;
      })
      .join('\n');
  }

  return { parse, serialize, extractBackgroundCommands, extractLineStyle, extractTranslation };
})();