/* ══════════════════════════════════════════════════════════════
   SongLibrary — песни из Квантора.

   Читает библиотеку радио игры прямо из папки проекта:
     Quantifier/client/game/music/
       index.json      [{ title, artist, file, lrc?, img? }]
       playlists.json  [{ name, songs: [file, …] }]
   Папка выбирается один раз и запоминается (Chrome хранит доступ);
   список читается заново при каждом открытии — песни, добавленные
   в редакторе песен игры (songs.bat), появляются сразу, без копий.

   Название, исполнитель, текст (.lrc) и картинка берутся из игры:
   карта в видео выходит той же, что в радио (оттенок — от title|artist).

   ▶ — слушать в чистой сцене (фон песни, визуал, карта; проект не
   трогается, «↩ Мой проект» возвращает его); 🖼 — картинка песни
   (фон кадра и карта); + — в альбом; плейлист — целиком.
══════════════════════════════════════════════════════════════ */
const SongLibrary = (function () {
  'use strict';

  /* ── Где лежит папка ───────────────────────── */
  // Запомненный handle — в своей маленькой базе
  const DB = 'ricole_qlib';
  function kv(mode, fn) {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore('kv');
      r.onerror = e => rej(e.target.error);
      r.onsuccess = e => {
        const d = e.target.result, t = d.transaction('kv', mode), s = t.objectStore('kv');
        let out;
        const q = fn(s);
        if (q) q.onsuccess = () => { out = q.result; };
        t.oncomplete = () => { d.close(); res(out); };
        t.onerror = ev => { d.close(); rej(ev.target.error); };
      };
    });
  }
  const saveHandle = h => kv('readwrite', s => s.put(h, 'music')).catch(() => {});
  const loadHandle = () => kv('readonly', s => s.get('music')).catch(() => null);

  /* Источник: что угодно с readText(path) и file(path).
     Путь — относительно папки music (как в index.json). */
  function dirSource(dir) {
    const walk = async (path) => {
      const parts = path.split('/').filter(Boolean);
      let d = dir;
      for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]);
      return (await d.getFileHandle(parts[parts.length - 1])).getFile();
    };
    return { name: dir.name, file: walk, readText: async p => (await walk(p)).text() };
  }
  // Запасной путь (без showDirectoryPicker): <input webkitdirectory>
  function listSource(files) {
    const all = Array.from(files);
    const idx = all.find(f => /(^|\/)index\.json$/.test(f.webkitRelativePath || f.name) &&
      all.some(g => (g.webkitRelativePath || '').startsWith((f.webkitRelativePath || '').replace(/index\.json$/, '')) && /\.(ogg|mp3|m4a|wav|opus)$/i.test(g.name)));
    if (!idx) return null;
    const root = (idx.webkitRelativePath || '').replace(/index\.json$/, '');
    const by = new Map(all.map(f => [(f.webkitRelativePath || f.name).slice(root.length), f]));
    const file = async p => { const f = by.get(p); if (!f) throw new Error('нет файла ' + p); return f; };
    return { name: root.replace(/\/$/, '').split('/').pop() || 'music', file: file, readText: async p => (await file(p)).text() };
  }

  // Выбрали корень Квантора или client/game — спускаемся до music
  async function findMusic(dir) {
    for (const path of [[], ['music'], ['game', 'music'], ['client', 'game', 'music']]) {
      try {
        let d = dir;
        for (const p of path) d = await d.getDirectoryHandle(p);
        await d.getFileHandle('index.json');
        return d;
      } catch (e) { /* не тут */ }
    }
    return null;
  }

  let src = null, songs = [], lists = [], err = '';

  async function read() {
    err = '';
    if (!src) { songs = []; lists = []; return; }
    try {
      const list = JSON.parse(await src.readText('index.json'));
      songs = (Array.isArray(list) ? list : []).filter(x => x && x.file).map(x => ({
        file: x.file, title: x.title || x.file, artist: x.artist || '', lrc: x.lrc || '', img: x.img || '',
      }));
    } catch (e) { songs = []; err = 'Не читается index.json: ' + (e.message || e); }
    try {
      const pl = JSON.parse(await src.readText('playlists.json'));
      const have = new Set(songs.map(s => s.file));
      lists = (Array.isArray(pl) ? pl : []).map(p => ({ name: String(p.name || ''), songs: (p.songs || []).filter(f => have.has(f)) }))
        .filter(p => p.name && p.songs.length);
    } catch (e) { lists = []; }
  }

  // Подключиться к запомненной папке (доступ Chrome спрашивает по клику)
  async function reconnect(ask) {
    const h = await loadHandle();
    if (!h || !h.queryPermission) return false;
    let p = await h.queryPermission({ mode: 'read' });
    if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'read' });
    if (p !== 'granted') return false;
    src = dirSource(h);
    await read();
    return true;
  }

  async function pickFolder() {
    if (window.showDirectoryPicker) {
      let dir;
      try { dir = await window.showDirectoryPicker({ mode: 'read', id: 'quantifier-music' }); }
      catch (e) { return false; }
      const music = await findMusic(dir);
      if (!music) { err = 'В этой папке нет music/index.json — выбери Quantifier/client/game/music'; return false; }
      await saveHandle(music);
      src = dirSource(music);
      await read();
      return true;
    }
    return null;   // нет API — панель покажет выбор через webkitdirectory
  }

  async function useFiles(files) {
    const s = listSource(files);
    if (!s) { err = 'В выбранной папке нет index.json с песнями'; return false; }
    src = s; await read();
    return true;
  }

  /* ── Песня → файл, текст, карта ────────────── */
  async function fetchSong(s) {
    const f = await src.file(s.file);
    const audio = new File([f], s.file, { type: f.type || (/\.ogg$/i.test(s.file) ? 'audio/ogg' : 'audio/mpeg') });
    let lrc = '';
    if (s.lrc) { try { lrc = await src.readText(s.lrc); } catch (e) { console.warn('[SongLibrary] нет текста', s.lrc); } }
    // Карточка: те же название/исполнитель, что в радио игры (свои правки не трогаем)
    if (typeof CardDeck !== 'undefined') {
      const was = CardDeck.settings.tracks[s.file] || {};
      CardDeck.setMetaFor(s.file, { title: was.title || s.title, artist: was.artist != null && was.artist !== '' ? was.artist : s.artist });
    }
    // Картинка из игры — если своей для песни ещё не ставили
    let img = null;
    if (s.img && !(await Album.getArt(s.file))) {
      try { img = await src.file(s.img); } catch (e) { console.warn('[SongLibrary] нет картинки', s.img); }
    }
    return { audio: audio, lrc: lrc, img: img };
  }

  // ▶ — открыть в чистой сцене и сразу слушать
  async function openInEditor(s) {
    const r = await fetchSong(s);
    if (r.img) await Album.setArt(s.file, r.img);
    if (typeof CardDeck !== 'undefined') CardDeck.settings.playlist = 'Радио';
    await Album.openSong(r.audio, r.lrc, { play: true });
  }

  async function addToAlbum(list, status) {
    let n = 0;
    for (const s of list) {
      if (status) status('В альбом: ' + (n + 1) + ' / ' + list.length + ' — ' + s.title);
      const r = await fetchSong(s);
      if (r.img) await Album.setArt(s.file, r.img);
      if (await Album.addTrack(r.audio, r.lrc)) n++;
    }
    if (Album.renderList) Album.renderList();
    return n;
  }

  /* ── Панель ─────────────────────────────────── */
  let panelEl = null;
  const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sb = 'style="background:#161616;border:1px solid #333;color:#ccc;padding:2px 7px;font:inherit;cursor:pointer;"';

  function inAlbum() {
    return new Set((typeof Album !== 'undefined' ? Album.tracks : []).map(t => t.name));
  }

  function render() {
    if (!panelEl) return;
    const $ = q => panelEl.querySelector(q);
    const have = inAlbum();
    const cur = typeof Album !== 'undefined' ? Album.current : '';
    $('[data-k="mine"]').style.display = cur ? '' : 'none';
    $('[data-k="src"]').innerHTML = src
      ? `Папка: <b style="color:#eee;">${esc(src.name)}</b> · ${songs.length} песен · ${lists.length} плейлистов`
      : 'Папка не выбрана — укажи <b style="color:#eee;">Quantifier/client/game/music</b> (один раз)';
    $('[data-k="err"]').textContent = err;
    $('[data-k="pl"]').innerHTML = lists.map((p, i) =>
      `<div style="display:flex;gap:6px;align-items:center;"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">▤ ${esc(p.name)}</span><span style="color:#666;">${p.songs.length}</span><button ${sb} data-a="pl" data-i="${i}">+ в альбом</button></div>`).join('');
    $('[data-k="list"]').innerHTML = songs.map((s, i) =>
      `<div style="display:flex;gap:6px;align-items:center;padding:3px 4px;border-top:1px solid #1c1c1c;${cur === s.file ? 'background:#1a1d10;' : ''}">
        <span style="flex:1;min-width:0;"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee;">${esc(s.title)}</span>
        <span style="color:#666;font-size:10px;">${esc(s.artist)}${s.lrc ? ' · текст' : ''}${s.img ? ' · картинка' : ''}</span></span>
        <button ${sb} data-a="open" data-i="${i}" title="Слушать (чистая сцена: фон песни, визуал, карта)">${cur === s.file ? '♪' : '▶'}</button>
        <button ${sb} data-a="art" data-i="${i}" title="Картинка песни: фон кадра и карта">🖼</button>
        ${have.has(s.file) ? '<span style="color:#e8ff00;width:28px;text-align:center;">✓</span>' : `<button ${sb} data-a="add" data-i="${i}" title="В альбом">+</button>`}
      </div>`).join('');
  }

  function toggle() {
    if (panelEl) { panelEl.remove(); panelEl = null; return; }
    const p = document.createElement('div');
    p.style.cssText = "position:fixed;top:52px;right:16px;z-index:10000;width:380px;max-height:84vh;overflow-y:auto;background:#0d0d0d;border:1px solid #333;padding:14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#bbb;box-shadow:0 12px 40px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:9px;";
    p.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;"><b style="color:#00e5ff;letter-spacing:2px;">♫ ПЕСНИ КВАНТОРА</b><button data-k="x" style="background:none;border:0;color:#888;cursor:pointer;font-size:14px;">✕</button></div>` +
      `<div data-k="src"></div><div data-k="err" style="color:#ff2d55;"></div>` +
      `<div style="display:flex;gap:6px;"><button ${sb} data-k="pick">Выбрать папку…</button><button ${sb} data-k="refresh">↻ Обновить</button><button ${sb} data-k="all">+ Все в альбом</button></div>` +
      `<input type="file" data-k="dir" webkitdirectory multiple hidden><input type="file" data-k="artf" accept="image/*" hidden>` +
      `<button data-k="mine" style="background:#e8ff00;color:#000;border:0;padding:6px;font:inherit;font-weight:700;cursor:pointer;">↩ МОЙ ПРОЕКТ — вернуть свой трек, текст и сцену</button>` +
      `<div data-k="pl" style="display:flex;flex-direction:column;gap:4px;"></div>` +
      `<div data-k="list"></div><div data-k="st" style="color:#aaa;"></div>`;
    document.body.appendChild(p);
    panelEl = p;
    const $ = q => p.querySelector(q);
    const status = s => { $('[data-k="st"]').textContent = s; };
    const busy = async (fn) => { try { await fn(); } catch (e) { console.error('[SongLibrary]', e); err = String(e.message || e); } render(); };
    $('[data-k="x"]').onclick = toggle;
    $('[data-k="pick"]').onclick = () => busy(async () => {
      const r = await pickFolder();
      if (r === null) $('[data-k="dir"]').click();
    });
    $('[data-k="dir"]').onchange = e => busy(async () => { await useFiles(e.target.files || []); e.target.value = ''; });
    $('[data-k="refresh"]').onclick = () => busy(async () => { if (src) await read(); else await reconnect(true); });
    $('[data-k="all"]').onclick = () => busy(async () => { const n = await addToAlbum(songs, status); status('Добавлено в альбом: ' + n); });
    $('[data-k="pl"]').onclick = e => {
      const b = e.target.closest('button[data-a="pl"]'); if (!b) return;
      const pl = lists[+b.dataset.i];
      busy(async () => {
        const by = new Map(songs.map(s => [s.file, s]));
        const n = await addToAlbum(pl.songs.map(f => by.get(f)), status);
        if (typeof Album !== 'undefined') Album.setName(pl.name);
        status('«' + pl.name + '»: добавлено ' + n + ' — название альбома взято из плейлиста');
      });
    };
    let artFor = null;
    $('[data-k="artf"]').onchange = e => {
      const f = e.target.files[0], s = artFor; e.target.value = '';
      if (f && s) busy(async () => { await Album.setArt(s.file, f); status('Картинка для «' + s.title + '» стоит: фон и карта'); });
    };
    $('[data-k="mine"]').onclick = () => busy(async () => { await Album.myProject(); status('Вернул твой проект'); });
    $('[data-k="list"]').onclick = e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const s = songs[+b.dataset.i];
      if (b.dataset.a === 'art') { artFor = s; $('[data-k="artf"]').click(); return; }
      busy(async () => {
        if (b.dataset.a === 'open') { status('Открываю…'); await openInEditor(s); status('Играет: ' + s.title); }
        else { await addToAlbum([s], status); status('В альбоме: ' + s.title); }
      });
    };
    render();
    if (typeof Album !== 'undefined') Album.reload().then(render).catch(() => {});
    // Запомненная папка: без клика доступ может быть «спросить» — тогда ↻
    busy(async () => { if (!src) { const ok = await reconnect(false); if (!ok && await loadHandle()) err = 'Нажми ↻ — Chrome спросит доступ к папке ещё раз'; } else await read(); });
  }

  function buildUI() {
    const header = document.querySelector('header') || document.querySelector('.header');
    if (!header || document.getElementById('qlibBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'qlibBtn';
    btn.style.cssText = "background:transparent;border:1px solid #00e5ff;color:#00e5ff;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;padding:6px 12px;cursor:pointer;margin-right:6px;";
    btn.textContent = '♫ КВАНТОР';
    btn.title = 'Песни радио игры: папка Quantifier/client/game/music';
    const anchor = document.getElementById('albumBtn');
    if (anchor && anchor.parentNode === header) header.insertBefore(btn, anchor); else header.appendChild(btn);
    btn.addEventListener('click', toggle);
  }

  return {
    buildUI: buildUI, toggle: toggle, refresh: () => render(), useFiles: useFiles, read: read,
    openInEditor: openInEditor, addToAlbum: addToAlbum,
    get songs() { return songs; }, get playlists() { return lists; },
  };
})();
