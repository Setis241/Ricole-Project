/* ═══════════════════════════════════════════════
   LyricsEditor — полноэкранный редактор текста

   Поле «Контент» на панели — это textarea в четыре строки, в которую
   складывается ВСЯ разметка: тайминги, теги стиля {LSIZE:130}, команды
   /LETTERBOX REACTIVE/, метки секций и сам текст. После авторежиссёра на
   одну строку песни приходится по 6-8 служебных токенов, и в четырёх
   видимых строках не читается ничего: ни где кончается одна реплика,
   ни что за теги на ней стоят.

   Здесь то же самое поле открывается на весь экран с подсветкой: тайминг,
   метка секции, теги, команды и САМ ТЕКСТ окрашены по-разному, поэтому
   реплика видна сразу, а разметка перестаёт быть сплошной кашей.

   ВАЖНО: единственный источник правды — по-прежнему #lyricsInput. Его
   читают AutoDirector, FxEditor, TimingEditor и PresetManager, поэтому
   редактор не заводит своей копии текста: он пишет в то же поле и шлёт
   событие 'input', как будто печатали в него. Иначе пришлось бы
   синхронизировать пять модулей вместо одного.
═══════════════════════════════════════════════ */
(function () {
  'use strict';

  let root = null, ta = null, hl = null, gutter = null, counter = null;
  let dim = false, wrap = true;

  function _src() { return document.getElementById('lyricsInput'); }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  function _esc(s) { return s.replace(/[&<>]/g, function (c) { return ESC[c]; }); }

  /* Подсветка строки.
     Токены разбираются ОДНИМ проходом по регулярке с чередованием, а не
     последовательными replace: последовательные заменяли бы уже вставленную
     HTML-разметку (класс «tag» внутри своего же span) и красили её повторно. */
  const TOKEN = /(\[\d{1,2}:\d{2}[.:]\d{1,3}\])|(\[[^\]]+\])|(\{[^}]*\})|(\/[^/\n]+\/)|(<\d{1,2}:\d{2}[.:]\d{1,3}>)|(>>>.*$)/g;

  function _highlight(text) {
    return text.split('\n').map(function (line) {
      let out = '', last = 0, m;
      TOKEN.lastIndex = 0;
      while ((m = TOKEN.exec(line)) !== null) {
        out += '<span class="le-t">' + _esc(line.slice(last, m.index)) + '</span>';
        const cls = m[1] ? 'le-time'   : m[2] ? 'le-sect'
                  : m[3] ? 'le-tag'    : m[4] ? 'le-cmd'
                  : m[5] ? 'le-wtime'  : 'le-tr';
        out += '<span class="' + cls + '">' + _esc(m[0]) + '</span>';
        last = m.index + m[0].length;
      }
      out += '<span class="le-t">' + _esc(line.slice(last)) + '</span>';
      // Пустая строка должна занимать высоту ряда — иначе подсветка
      // разъезжается с textarea ровно на число пустых строк.
      return out || '&nbsp;';
    }).join('\n');
  }

  function _sync() {
    const text = ta.value;
    hl.innerHTML = _highlight(text) + '\n';
    const n = text ? text.split('\n').length : 1;
    let g = '';
    for (let i = 1; i <= n; i++) g += i + '\n';
    gutter.textContent = g;
    const timed = (text.match(/^\s*\[\d{1,2}:\d{2}/gm) || []).length;
    counter.textContent = n + ' строк · ' + timed + ' с таймингом';
  }

  /* Правка уходит в #lyricsInput сразу, а не по кнопке «Применить»:
     «применить» здесь нечего — поле и есть документ, а лишний шаг только
     плодит расхождение между тем, что на экране, и тем, что в проекте. */
  function _push() {
    const src = _src();
    if (!src) return;
    src.value = ta.value;
    src.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function _build() {
    root = document.createElement('div');
    root.className = 'le-root';
    root.innerHTML =
      '<div class="le-win">' +
        '<div class="le-head">' +
          '<div class="le-title">Текст и разметка</div>' +
          '<div class="le-count" id="le-count"></div>' +
          '<div class="le-tabs">' +
            '<button class="le-tab le-tab-on" data-view="text">Текст</button>' +
            '<button class="le-tab" data-view="sect">Секции</button>' +
          '</div>' +
          '<div class="le-tools">' +
            '<button class="le-btn" id="le-dim">Приглушить разметку</button>' +
            '<button class="le-btn" id="le-wrap">Перенос: вкл</button>' +
            '<button class="le-btn le-btn-x" id="le-close">Готово</button>' +
          '</div>' +
        '</div>' +
        '<div class="le-body">' +
          '<pre class="le-gutter" id="le-gutter"></pre>' +
          '<div class="le-pane">' +
            '<pre class="le-hl" id="le-hl"></pre>' +
            '<textarea class="le-ta" id="le-ta" spellcheck="false"></textarea>' +
          '</div>' +
        '</div>' +
        '<div class="le-sect-body" id="le-sect">' +
          '<div class="le-sect-hint">' +
            '<b>⚡ Разметить автоматически</b> — первый проход по повторам, ' +
            'дальше только поправить. Вручную: стрелки ↑↓ ведут курсор, ' +
            'цифра 1-7 ставит метку и сразу переводит на строку ниже, ' +
            'Backspace снимает. Метка держится до следующей — размечать ' +
            'надо только НАЧАЛА секций.' +
          '</div>' +
          '<div class="le-rows" id="le-rows"></div>' +
          '<div class="le-picker" id="le-picker"></div>' +
        '</div>' +
        '<div class="le-legend">' +
          '<span class="le-time">[00:00.00]</span> тайминг' +
          '<span class="le-sect">[Припев]</span> секция' +
          '<span class="le-tag">{TAG}</span> стиль' +
          '<span class="le-cmd">/КОМАНДА/</span> фон и камера' +
          '<span class="le-tr">&gt;&gt;&gt;</span> перевод' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    ta      = root.querySelector('#le-ta');
    hl      = root.querySelector('#le-hl');
    gutter  = root.querySelector('#le-gutter');
    counter = root.querySelector('#le-count');

    ta.addEventListener('input', function () { _sync(); _push(); });
    /* Скролл ведёт textarea, подсветка и нумерация идут за ней. Обратной
       связи нет нарочно: два элемента, синхронизирующие друг друга,
       начинают дёргаться на инерционном скролле. */
    ta.addEventListener('scroll', function () {
      hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    });
    // Tab внутри редактора — отступ, а не уход фокуса на кнопку.
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
        _sync(); _push();
      }
    });

    _renderPicker();

    // Переключение вкладок
    root.querySelectorAll('.le-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        const v = b.dataset.view;
        root.querySelectorAll('.le-tab').forEach(function (x) {
          x.classList.toggle('le-tab-on', x === b);
        });
        root.classList.toggle('le-view-sect', v === 'sect');
        if (v === 'sect') _renderSect(); else ta.focus();
      });
    });

    // Клик по строке — поставить выбранный тип
    root.querySelector('#le-rows').addEventListener('click', function (e) {
      const row = e.target.closest('.le-row');
      if (!row) return;
      const idx = +row.dataset.i;
      const rows = _rows();
      const hit = rows.filter(function (r) { return r.i === idx; })[0];
      cur = idx;
      // Повторный клик тем же типом снимает метку — иначе промах
      // исправляется только через отдельную кнопку.
      _setLabel(idx, (hit && hit.label === pick) ? null : pick);
    });

    root.querySelector('#le-picker').addEventListener('click', function (e) {
      const b = e.target.closest('.le-pick');
      if (b) { pick = b.dataset.key || pick; _renderPicker(); return; }
      if (e.target.id === 'le-guess') { _autoMark(); return; }
      if (e.target.id === 'le-auto') {
        if (!confirm('Снять все метки секций?')) return;
        ta.value = ta.value.split(NL).map(function (l) {
          const m = l.match(LRC_LINE);
          if (!m) return l;
          const rest = m[2].replace(/^\[[^\]]+\]\s*/, '');
          return m[1] + (rest ? ' ' + rest : '');
        }).join(NL);
        _sync(); _push(); _renderSect();
      }
    });

    root.querySelector('#le-close').addEventListener('click', close);
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });

    root.querySelector('#le-dim').addEventListener('click', function () {
      dim = !dim;
      root.classList.toggle('le-dimmed', dim);
      this.textContent = dim ? 'Показать разметку' : 'Приглушить разметку';
    });
    root.querySelector('#le-wrap').addEventListener('click', function () {
      wrap = !wrap;
      root.classList.toggle('le-nowrap', !wrap);
      this.textContent = 'Перенос: ' + (wrap ? 'вкл' : 'выкл');
    });

    document.addEventListener('keydown', function (e) {
      if (!root || !root.classList.contains('le-open')) return;
      if (e.key === 'Escape') { close(); return; }
      /* Цифры переключают ТИП на вкладке секций. В тексте их трогать
         нельзя — там ими набирают. */
      if (!root.classList.contains('le-view-sect')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { _move(1);  e.preventDefault(); return; }
      if (e.key === 'ArrowUp'   || e.key === 'k') { _move(-1); e.preventDefault(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { _markCur(null); e.preventDefault(); return; }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= TYPES.length) {
        /* Цифра — это и выбор типа, и постановка метки. Разделять их
           (сначала выбрать, потом кликнуть) значит два действия на каждую
           секцию вместо одного. */
        pick = TYPES[n - 1].key;
        _renderPicker();
        _markCur(pick);
        e.preventDefault();
      }
    });
  }

  function open() {
    if (!root) _build();
    const src = _src();
    ta.value = src ? src.value : '';
    root.classList.add('le-open');
    _sync();
    ta.focus();
  }

  function close() {
    if (!root) return;
    _push();
    root.classList.remove('le-open');
  }


  /* ═══════════ ВКЛАДКА «СЕКЦИИ» ═══════════
     Ставить метки руками в тексте невозможно: строка после авторежиссёра
     на 90 % состоит из тегов, и найти в ней начало припева — отдельная
     работа. Здесь текст показан ЧИСТЫМ (только слова и тайминг), а метка
     ставится одним кликом. Пишется она в ту же строку сразу после
     тайминга — это форма, которую читают и парсер, и режиссёр.

     Размечаются только НАЧАЛА секций: метка действует до следующей. */
  const TYPES = [
    { key: 'Куплет',      cls: 'verse'  },
    { key: 'Предприпев',  cls: 'pre'    },
    { key: 'Припев',      cls: 'chorus' },
    { key: 'Бридж',       cls: 'bridge' },
    { key: 'Проигрыш',    cls: 'break'  },
    { key: 'Инструментал', cls: 'inst'   },
    { key: 'Вступление',  cls: 'intro'  },
    { key: 'Концовка',    cls: 'outro'  },
  ];
  let pick = 'Припев';
  /* Курсор по строкам. Мышью размечать песню долго: типов семь, начал
     секций у песни десяток, и каждый раз надо попасть в нужную строку.
     С клавиатуры это один проход сверху вниз: стрелки ведут курсор,
     цифра ставит метку И СРАЗУ переводит на строку ниже. */
  let cur = 0;
  const NL = String.fromCharCode(10);

  const LRC_LINE = /^(\[\d{1,2}:\d{2}[.:]\d{1,3}\])\s*(.*)$/;

  /* Чистый текст строки: без тегов, команд, пословных меток и перевода.
     Именно его пользователь ищет глазами, когда размечает песню. */
  function _clean(rest) {
    return rest
      .replace(/^\[[^\]]+\]/, '')
      .replace(/>>>.*$/, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\/[^/\n]+\//g, '')
      .replace(/<\d{1,2}:\d{2}[.:]\d{1,3}>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _rows() {
    return ta.value.split('\n').map(function (line, i) {
      const m = line.match(LRC_LINE);
      if (!m) return null;
      const lab = (m[2].match(/^\[([^\]]+)\]/) || [])[1] || null;
      return { i: i, time: m[1], rest: m[2], label: lab, text: _clean(m[2]) };
    }).filter(Boolean);
  }

  /* Метка пишется/снимается ровно в одном месте — сразу после тайминга.
     Остальную разметку строки не трогаем: там стоят теги и команды,
     которые ставил авторежиссёр. */
  function _setLabel(lineIdx, label) {
    const arr = ta.value.split('\n');
    const m = arr[lineIdx].match(LRC_LINE);
    if (!m) return;
    let rest = m[2].replace(/^\[[^\]]+\]\s*/, '');
    arr[lineIdx] = m[1] + (label ? '[' + label + ']' : '') + (rest ? ' ' + rest : '');
    ta.value = arr.join('\n');
    _sync(); _push(); _renderSect();
  }

  function _renderSect() {
    const box = root.querySelector('#le-rows');
    const rows = _rows();
    let cur = null;
    box.innerHTML = rows.map(function (r) {
      if (r.label) cur = r.label;
      const t = TYPES.filter(function (x) { return x.key === r.label; })[0];
      const inh = TYPES.filter(function (x) { return x.key === cur; })[0];
      return '<div class="le-row' + (r.label ? ' le-row-mark' : '') +
             (r.i === cur ? ' le-row-cur' : '') + '" data-i="' + r.i + '">' +
               '<span class="le-row-bar le-c-' + (inh ? inh.cls : 'none') + '"></span>' +
               '<span class="le-row-time">' + r.time.slice(1, -1) + '</span>' +
               (r.label
                 ? '<span class="le-chip le-c-' + (t ? t.cls : 'none') + '">' + r.label + '</span>'
                 : '') +
               '<span class="le-row-text">' + _esc(r.text || '(без текста)') + '</span>' +
             '</div>';
    }).join('') || '<div class="le-sect-hint">Текста с таймингом нет.</div>';
    const c = box.querySelector('.le-row-cur');
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  }

  /* Перевод курсора на следующую/предыдущую строку С ТАЙМИНГОМ:
     строки без тайминга разметку не несут, и вставать на них незачем. */
  function _move(dir) {
    const rows = _rows();
    if (!rows.length) return;
    let k = rows.findIndex(function (r) { return r.i === cur; });
    if (k === -1) k = 0; else k = Math.max(0, Math.min(rows.length - 1, k + dir));
    cur = rows[k].i;
    _renderSect();
  }

  function _markCur(label) {
    const rows = _rows();
    if (!rows.length) return;
    if (!rows.some(function (r) { return r.i === cur; })) cur = rows[0].i;
    _setLabel(cur, label);
    if (label) _move(1);            // разметил — сразу ниже, руки не отрываются
  }

  /* ── Автоматическая разметка ──
     Тот же разбор структуры, которым пользуется сам режиссёр (повторы
     строк и паузы; без аудио — только по тексту). Он ошибается на границах,
     но ставит 8-10 меток за раз, и остаётся ПОДПРАВИТЬ две-три, а не
     забивать всё руками. */
  const RU = { intro: 'Вступление', verse: 'Куплет', prechorus: 'Предприпев',
               chorus: 'Припев', bridge: 'Бридж', break: 'Проигрыш',
               instrumental: 'Инструментал', outro: 'Концовка' };

  function _autoMark() {
    if (typeof AutoDirector === 'undefined' || typeof LRCParser === 'undefined') {
      alert('Авторазметка недоступна: не загружен AutoDirector.');
      return;
    }
    const entries = LRCParser.parse(ta.value);
    if (!entries.length) return;
    const dur = entries[entries.length - 1].time + 5;
    const lyr = AutoDirector.analyzeLyrics(entries, dur);
    const sections = AutoDirector.buildStructure(null, lyr);

    const arr = ta.value.split(NL);
    const rows = _rows();
    let placed = 0;
    sections.forEach(function (sec) {
      const name = RU[sec.type];
      if (!name) return;
      // Строка, с которой секция начинается: первая с текстом и таймингом.
      const row = rows.filter(function (r) {
        const m = arr[r.i].match(LRC_LINE);
        if (!m) return false;
        const t = _toSec(m[1]);
        return t >= sec.start - 0.01 && t < sec.end;
      })[0];
      if (!row) return;
      const m = arr[row.i].match(LRC_LINE);
      const rest = m[2].replace(/^\[[^\]]+\]\s*/, '');
      arr[row.i] = m[1] + '[' + name + ']' + (rest ? ' ' + rest : '');
      placed++;
    });
    ta.value = arr.join(NL);
    _sync(); _push(); _renderSect();
    if (!placed) alert('Структура не распозналась — размечай вручную.');
  }

  function _toSec(stamp) {
    const m = stamp.match(/(\d{1,2}):(\d{2})[.:](\d{1,3})/);
    if (!m) return 0;
    const fr = m[3].length === 2 ? +m[3] / 100 : +m[3] / 1000;
    return +m[1] * 60 + +m[2] + fr;
  }

  function _renderPicker() {
    const box = root.querySelector('#le-picker');
    box.innerHTML = TYPES.map(function (t, k) {
      return '<button class="le-pick le-c-' + t.cls + (t.key === pick ? ' le-pick-on' : '') +
             '" data-key="' + t.key + '"><b>' + (k + 1) + '</b> ' + t.key + '</button>';
    }).join('') +
    '<button class="le-pick le-pick-del" data-key=""><b>⌫</b> снять метку</button>' +
    '<button class="le-btn le-btn-x" id="le-guess">⚡ Разметить автоматически</button>' +
    '<button class="le-btn" id="le-auto">Очистить все метки</button>';
  }

  const CSS = [
'.le-root{position:fixed;inset:0;z-index:10050;display:none;background:rgba(0,0,0,.88);',
'  padding:32px}',
'.le-root.le-open{display:flex;align-items:center;justify-content:center}',
'.le-win{width:min(1100px,100%);height:100%;display:flex;flex-direction:column;',
'  background:var(--panel,#121212);border:1px solid var(--border,#2a2a2a);',
'  border-radius:var(--radius,6px);box-shadow:0 24px 64px rgba(0,0,0,.6);overflow:hidden}',
'.le-head{display:flex;align-items:center;gap:16px;padding:14px 18px;',
'  border-bottom:1px solid var(--border,#2a2a2a);background:var(--surface,#1a1a1a)}',
'.le-title{font-family:var(--display,sans-serif);font-size:20px;letter-spacing:1.5px}',
'.le-count{font-family:var(--mono,monospace);font-size:11px;color:var(--muted,#666)}',
'.le-tools{margin-left:auto;display:flex;gap:8px}',
'.le-btn{font-family:var(--mono,monospace);font-size:11px;letter-spacing:.5px;',
'  padding:7px 12px;background:transparent;color:var(--text,#fff);cursor:pointer;',
'  border:1px solid var(--border,#2a2a2a);border-radius:4px}',
'.le-btn:hover{border-color:var(--accent,#e8ff00);color:var(--accent,#e8ff00)}',
'.le-btn-x{background:var(--accent,#e8ff00);color:#0a0a0a;border-color:var(--accent,#e8ff00);font-weight:700}',
'.le-btn-x:hover{color:#0a0a0a;filter:brightness(1.1)}',
'.le-body{flex:1;display:flex;min-height:0;background:#0d0d0d}',
/* Нумерация, подсветка и ввод обязаны иметь ОДНУ метрику — иначе строки
   разъезжаются по вертикали и подсветка стоит не под своим текстом. */
'.le-gutter,.le-hl,.le-ta{font-family:var(--mono,monospace);',
'  font-size:13px;line-height:1.65;tab-size:2;margin:0;border:0}',
'.le-gutter{flex:0 0 56px;padding:16px 10px 16px 0;text-align:right;color:#3a3a3a;',
'  background:#0a0a0a;border-right:1px solid var(--border,#2a2a2a);overflow:hidden;',
'  white-space:pre;user-select:none}',
'.le-pane{position:relative;flex:1;min-width:0}',
'.le-hl,.le-ta{position:absolute;inset:0;padding:16px 18px;overflow:auto;',
'  white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal}',
'.le-root.le-nowrap .le-hl,.le-root.le-nowrap .le-ta{white-space:pre;overflow-wrap:normal}',
'.le-hl{pointer-events:none;z-index:1}',
/* Текст ввода прозрачный: видно раскрашенный слой под ним, а каретка,
   выделение и всё поведение остаются родными для textarea. */
'.le-ta{z-index:2;background:transparent;color:transparent;caret-color:var(--accent,#e8ff00);',
'  resize:none;outline:none}',
'.le-ta::selection{background:rgba(232,255,0,.22)}',
'.le-t{color:#f2f2f2}',
'.le-time{color:#00e5ff}',
'.le-sect{color:#e8ff00;font-weight:700}',
'.le-tag{color:#9d7bff}',
'.le-cmd{color:#ff7ab8}',
'.le-wtime{color:#3f8f9c}',
'.le-tr{color:#6a9c6a}',
/* Приглушение: текст песни остаётся в полной силе, служебное уходит в фон.
   Это режим ЧТЕНИЯ — увидеть реплики, не выключая разметку совсем. */
'.le-root.le-dimmed .le-time,.le-root.le-dimmed .le-tag,',
'.le-root.le-dimmed .le-cmd,.le-root.le-dimmed .le-wtime{opacity:.28}',
'.le-legend{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;',
'  padding:10px 18px;border-top:1px solid var(--border,#2a2a2a);',
'  background:var(--surface,#1a1a1a);font-size:11px;color:var(--muted,#666)}',
'.le-legend span{font-family:var(--mono,monospace);margin-right:6px}',
'.le-tabs{display:flex;gap:4px;margin-left:12px}',
'.le-tab{font-family:var(--mono,monospace);font-size:11px;padding:6px 14px;cursor:pointer;',
'  background:transparent;color:var(--muted,#666);border:1px solid transparent;border-radius:4px}',
'.le-tab-on{color:var(--accent,#e8ff00);border-color:var(--border,#2a2a2a);background:#0d0d0d}',
/* Вкладки — это два взаимоисключающих вида одного документа, поэтому
   переключаются показом, а не пересборкой: состояние ввода не теряется. */
'.le-sect-body{display:none;flex:1;min-height:0;flex-direction:column;background:#0d0d0d}',
'.le-root.le-view-sect .le-body,.le-root.le-view-sect .le-legend{display:none}',
'.le-root.le-view-sect .le-sect-body{display:flex}',
'.le-sect-hint{padding:10px 18px;font-size:11px;color:var(--muted,#666);',
'  border-bottom:1px solid var(--border,#2a2a2a);line-height:1.6}',
'.le-rows{flex:1;overflow:auto;padding:6px 0}',
'.le-row{display:flex;align-items:center;gap:12px;padding:5px 18px 5px 0;cursor:pointer}',
'.le-row:hover{background:#161616}',
'.le-row-mark{background:#141400}',
'.le-row-cur{outline:1px solid var(--accent,#e8ff00);outline-offset:-1px}',
'.le-row-bar{flex:0 0 4px;align-self:stretch;background:#222}',
'.le-row-time{font-family:var(--mono,monospace);font-size:11px;color:#00e5ff;flex:0 0 62px}',
'.le-row-text{font-size:13px;color:#f2f2f2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'.le-chip{font-family:var(--mono,monospace);font-size:10px;letter-spacing:.5px;',
'  padding:2px 8px;border-radius:3px;color:#0a0a0a;font-weight:700;flex:0 0 auto}',
'.le-picker{display:flex;flex-wrap:wrap;gap:6px;padding:12px 18px;',
'  border-top:1px solid var(--border,#2a2a2a);background:var(--surface,#1a1a1a)}',
'.le-pick{font-family:var(--mono,monospace);font-size:11px;padding:7px 12px;cursor:pointer;',
'  background:transparent;color:var(--text,#fff);border:1px solid var(--border,#2a2a2a);border-radius:4px}',
'.le-pick b{opacity:.5;margin-right:4px}',
'.le-pick-on{border-width:2px;padding:6px 11px}',
'.le-pick-del{color:var(--muted,#666)}',
/* Цвет типа один и тот же в трёх местах: полоса слева (какая секция идёт
   сейчас), чип метки и кнопка выбора. Так разметка читается сплошным
   столбцом, не читая подписей. */
'.le-c-verse{background:#5a6a7a}  .le-pick.le-c-verse{background:transparent;border-color:#5a6a7a;color:#9fb4c7}',
'.le-c-pre{background:#b07a2a}    .le-pick.le-c-pre{background:transparent;border-color:#b07a2a;color:#e0a86a}',
'.le-c-chorus{background:#e8ff00} .le-pick.le-c-chorus{background:transparent;border-color:#e8ff00;color:#e8ff00}',
'.le-c-bridge{background:#9d7bff} .le-pick.le-c-bridge{background:transparent;border-color:#9d7bff;color:#c5b0ff}',
'.le-c-break{background:#3f8f9c}  .le-pick.le-c-break{background:transparent;border-color:#3f8f9c;color:#7fc3ce}',
'.le-c-inst{background:#8f7a3f}   .le-pick.le-c-inst{background:transparent;border-color:#8f7a3f;color:#d6bc72}',
'.le-c-intro{background:#4a8f5a}  .le-pick.le-c-intro{background:transparent;border-color:#4a8f5a;color:#8fd0a0}',
'.le-c-outro{background:#a05a7a}  .le-pick.le-c-outro{background:transparent;border-color:#a05a7a;color:#d79bb8}',
'.le-c-none{background:#222}',
  ].join('\n');

  function _css() {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  document.addEventListener('DOMContentLoaded', function () {
    _css();
    const btn = document.getElementById('lyricsEditorBtn');
    if (btn) btn.addEventListener('click', open);
  });

  /* Вставка по курсору из внешних кнопок (команды фона и камеры в App.js).
     Возвращает true, только если редактор открыт и вставка реально
     произошла — иначе вызывающий делает по-старому. */
  function insert(cmd) {
    if (!root || !root.classList.contains('le-open') || !ta) return false;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + cmd + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + cmd.length;
    _sync(); _push(); ta.focus();
    return true;
  }

  window.LyricsEditor = { open: open, close: close, insert: insert };
})();
