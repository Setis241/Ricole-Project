/* ══════════════════════════════════════════════════════════════
   Album — длинное видео: альбом / сборник.

   Список треков (песня + текст .lrc по желанию + свой фон по
   желанию) живёт в IndexedDB — песни можно докидывать по ходу,
   переживает перезагрузку.

   Экспорт альбома — по файлу на трек (так браузер не держит час
   видео в памяти): каждый файл начинается со вставки своей карты и
   кончается её выбросом, поэтому на стыке получается тот же swap,
   что в радио игры (CardDeck.setAlbum: в середине считыватель не
   уезжает). Рядом пишутся:
     chapters.txt — главы для описания YouTube (00:00 Название);
     concat.txt + join.bat / join.sh (+ README-join.txt) — ffmpeg склеивает файлы
       в один без перекодирования видео.

   API: Album.buildUI(), Album.drawBackground(ctx, w, h, T, dur),
        Album.onAudio(name)
══════════════════════════════════════════════════════════════ */
const Album = (function () {
  'use strict';

  /* ── Настройки ─────────────────────────────── */
  const LS = 'ricole.album';
  const st = (function () {
    try { return Object.assign({ name: 'Альбом', preset: 'yt_1080_60' }, JSON.parse(localStorage.getItem(LS) || '{}')); }
    catch (e) { return { name: 'Альбом', preset: 'yt_1080_60' }; }
  })();
  function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* нет хранилища */ } }

  /* ── IndexedDB: треки ──────────────────────── */
  const DB = 'ricole_album', STORE = 'tracks';
  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = e => res(e.target.result);
      r.onerror = e => rej(e.target.error);
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => { d.close(); res(out); };
      t.onerror = e => { d.close(); rej(e.target.error); };
    });
  }
  const putRec = rec => tx('readwrite', s => { s.put(rec); });
  const delRec = id => tx('readwrite', s => { s.delete(id); });
  const allRecs = () => tx('readonly', s => new Promise(r => { const q = s.getAll(); q.onsuccess = () => r(q.result || []); }));

  let tracks = [];          // [{ id, order, name, type, data, lrc, bgType, bgData, duration }]
  async function reload() {
    tracks = (await allRecs()).sort((a, b) => a.order - b.order);
    return tracks;
  }
  async function renumber() {
    tracks.forEach((t, i) => { t.order = i; });
    for (const t of tracks) await putRec(t);
  }

  const base = n => String(n || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  const fileOf = t => new File([t.data], t.name, { type: t.type || 'audio/mpeg' });

  function probeDuration(blob) {
    return new Promise(res => {
      const a = new Audio(), url = URL.createObjectURL(blob);
      const done = d => { URL.revokeObjectURL(url); res(d || 0); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => done(0);
      setTimeout(() => done(0), 8000);
      a.src = url;
    });
  }

  // Один трек в конец альбома (повтор по имени файла — пропускаем)
  async function addTrack(f, lrc) {
    if (!tracks.length) await reload();
    if (tracks.some(t => t.name === f.name)) return null;
    const rec = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      order: tracks.length, name: f.name, type: f.type,
      data: await f.arrayBuffer(), lrc: lrc || '', bgType: '', bgData: null,
      duration: await probeDuration(f),
    };
    tracks.push(rec); await putRec(rec);
    return rec;
  }

  // Песни и тексты одним выбором: .lrc садится к песне с тем же именем
  async function addFiles(files) {
    const audio = [], lrc = [], imgs = [];
    for (const f of files) {
      if (/\.(lrc|txt)$/i.test(f.name)) lrc.push(f);
      else if (/^image\//.test(f.type)) imgs.push(f);
      else audio.push(f);
    }
    for (const f of audio) await addTrack(f);
    for (const f of lrc.concat(imgs)) {
      const t = tracks.find(x => base(x.name) === base(f.name));
      if (!t) continue;
      if (/\.(lrc|txt)$/i.test(f.name)) t.lrc = await f.text();
      else { t.bgType = f.type; t.bgData = await f.arrayBuffer(); }
      await putRec(t);
    }
  }

  /* ── Время и главы ─────────────────────────── */
  const lead = () => (typeof CardDeck !== 'undefined' ? CardDeck.lead() : 0);
  function fmt(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0');
  }
  function titleOf(t) {
    if (typeof CardDeck === 'undefined') return base(t.name);
    const was = CardDeck.settings.tracks[t.name] || {};
    if (was.title) return was.title;
    const b = t.name.replace(/\.[a-z0-9]+$/i, '');
    const m = b.split(/\s+[-–—]\s+/);
    return m.length > 1 ? m.slice(1).join(' - ') : b;
  }
  function chapters(lengths) {
    let at = 0;
    return tracks.map((t, i) => {
      const line = fmt(at) + ' ' + titleOf(t);
      at += lengths ? lengths[i] : (t.duration || 0) + lead();
      return line;
    });
  }

  /* ── Картинка песни (одна на песню: фон кадра + карта) ──
     Хранится по имени файла — та же песня в альбоме и в библиотеке. */
  function artDb(mode, fn) {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ricole_art', 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore('art');
      r.onerror = e => rej(e.target.error);
      r.onsuccess = e => {
        const d = e.target.result, t = d.transaction('art', mode), q = fn(t.objectStore('art'));
        let out; if (q) q.onsuccess = () => { out = q.result; };
        t.oncomplete = () => { d.close(); res(out); };
        t.onerror = ev => { d.close(); rej(ev.target.error); };
      };
    });
  }
  const getArt = name => artDb('readonly', s => s.get(name)).catch(() => null);
  async function setArt(name, blob) {
    await artDb('readwrite', s => blob ? s.put(blob, name) : s.delete(name));
    // Карта — уменьшенная копия той же картинки
    if (typeof CardDeck !== 'undefined') CardDeck.setMetaFor(name, { img: blob ? await thumb(blob) : '' });
    if (cur && cur.name === name) { curImg = blob ? await toImage(blob) : null; }
  }
  function toImage(blob) {
    const url = URL.createObjectURL(blob);
    return new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = url; });
  }
  async function thumb(blob) {
    const im = await toImage(blob); if (!im) return '';
    const k = Math.min(1, 512 / Math.max(im.width, im.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
    cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  }

  /* ── Режим песни ───────────────────────────────
     Песня из библиотеки/альбома открывается в ЧИСТОЙ сцене: свой фон
     (картинка песни или тёмный градиент цвета её карты), визуализатор,
     текст, карта. Фон и объекты твоего проекта не рисуются и не
     трогаются: автосохранение на это время выключено, «↩ Мой проект»
     возвращает всё как было (звук, текст, сцену). */
  let cur = null, curImg = null, stash = null;

  function blockAutosave(v) { if (typeof PresetManager !== 'undefined' && PresetManager.blockAutosave) PresetManager.blockAutosave(v); }

  async function openSong(file, lrc, opts) {
    opts = opts || {};
    if (!cur) {
      // Входим в режим песни — запоминаем текст своего проекта
      stash = { lyrics: document.getElementById('lyricsInput').value };
      blockAutosave(true);
    }
    cur = { name: file.name };          // до загрузки: onAudio увидит «свою» песню
    await App.loadAudioFile(file, false);
    App.setLyricsText(lrc || '');
    let blob = await getArt(file.name);
    if (!blob && opts.bg) blob = opts.bg;
    curImg = blob ? await toImage(blob) : null;
    if (blob && typeof CardDeck !== 'undefined' && !(CardDeck.settings.tracks[file.name] || {}).img)
      CardDeck.setMetaFor(file.name, { img: await thumb(blob) });
    if (typeof CardDeck !== 'undefined') CardDeck.setAlbum(opts.album || null);
    if (opts.play !== false) document.getElementById('playBtn')?.click();
    if (typeof SongLibrary !== 'undefined' && SongLibrary.refresh) SongLibrary.refresh();
  }

  // Песню загрузили обычным способом (свой файл) — выходим из режима песни
  function onAudio(name) {
    if (cur && cur.name === name) return;
    if (cur) leave(false);
  }

  function leave(restoreLyrics) {
    cur = null; curImg = null;
    if (typeof CardDeck !== 'undefined') CardDeck.setAlbum(null);
    if (stash && restoreLyrics !== false) App.setLyricsText(stash.lyrics);
    stash = null;
    blockAutosave(false);
    if (typeof SongLibrary !== 'undefined' && SongLibrary.refresh) SongLibrary.refresh();
  }

  // ↩ Мой проект: последний свой трек (AudioStorage), свой текст, своя сцена
  async function myProject() {
    if (!cur) return;
    const lyr = stash ? stash.lyrics : null;
    if (AudioEngine.isPlaying) document.getElementById('stopBtn')?.click();
    cur = null; curImg = null;
    const f = typeof AudioStorage !== 'undefined' ? await AudioStorage.load().catch(() => null) : null;
    if (f) await App.loadAudioFile(f, false);
    if (lyr != null) App.setLyricsText(lyr);
    stash = null;
    if (typeof CardDeck !== 'undefined') CardDeck.setAlbum(null);
    blockAutosave(false);
    if (typeof SongLibrary !== 'undefined' && SongLibrary.refresh) SongLibrary.refresh();
  }

  async function loadTrack(i, play) {
    const t = tracks[i];
    if (!t) return;
    if (typeof CardDeck !== 'undefined') CardDeck.settings.playlist = st.name;
    await openSong(fileOf(t), t.lrc, {
      bg: t.bgData ? new Blob([t.bgData], { type: t.bgType || 'image/jpeg' }) : null,
      album: { first: i === 0, last: i === tracks.length - 1 }, play: !!play,
    });
    if (typeof CardDeck !== 'undefined') CardDeck.setMeta({ n: i + 1 });
  }

  /* Фон песни: картинка целиком с медленным наездом или градиент цвета
     карты. Возвращает true — фон нарисован, сцену проекта не рисовать.
     На стыке треков альбома — через тёмное. */
  function drawBackground(ctx, w, h, T, dur) {
    if (!cur) return false;
    const L = lead(), t = T == null ? 0 : T, D = dur || 1;
    let a = 1;
    if (T != null) a = Math.max(0, Math.min(1, (t + L) / 0.6, (D - t) / 0.6));
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha *= a;
    if (curImg) {
      const z = 1.04 + 0.06 * Math.max(0, Math.min(1, (t + L) / (D + L)));
      const s = Math.max(w / curImg.width, h / curImg.height) * z;
      ctx.drawImage(curImg, (w - curImg.width * s) / 2, (h - curImg.height * s) / 2, curImg.width * s, curImg.height * s);
    } else {
      const hue = typeof CardDeck !== 'undefined' ? CardDeck.meta().hue : 210;
      const g = ctx.createRadialGradient(w * 0.7, h * 0.3, 0, w * 0.7, h * 0.3, Math.hypot(w, h) * 0.75);
      g.addColorStop(0, `hsl(${hue} 45% 22%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360} 50% 5%)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
    return true;
  }

  /* ── Экспорт альбома ───────────────────────── */
  const safe = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'track';

  async function writeFile(dir, name, data) {
    if (dir) {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data); await w.close();
      return;
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    await new Promise(r => setTimeout(r, 400));   // браузер не любит пачку загрузок разом
  }

  let busy = false;
  async function exportAll(status) {
    if (busy || !tracks.length) return;
    let dir = null;
    if (window.showDirectoryPicker) {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
      catch (e) { if (e && e.name === 'AbortError') return; dir = null; }   // не дали папку — пишем загрузками
    }
    busy = true;
    const files = [], lengths = [];
    try {
      for (let i = 0; i < tracks.length; i++) {
        status('Трек ' + (i + 1) + ' / ' + tracks.length + ': ' + titleOf(tracks[i]));
        await loadTrack(i, false);
        const r = await ExportEngine.renderBlob(st.preset, App.getState(), 'Трек ' + (i + 1) + ' / ' + tracks.length + ' — ' + titleOf(tracks[i]));
        if (!r) throw new Error('экспорт не запустился (WebCodecs?)');
        const name = String(i + 1).padStart(2, '0') + ' - ' + safe(titleOf(tracks[i])) + '.webm';
        await writeFile(dir, name, r.blob);
        files.push(name); lengths.push(r.seconds);
      }
      const out = safe(st.name) + '.webm';
      const ch = chapters(lengths);
      await writeFile(dir, 'chapters.txt', ch.join('\n') + '\n\n' +
        '# Главы для описания YouTube. Нужно минимум 3 главы по 10+ секунд, первая — 00:00.\n');
      await writeFile(dir, 'concat.txt', files.map(f => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n') + '\n');
      // Видео склеивается как есть, звук перекодируется — так стыки Opus без щелчков
      const cmd = 'ffmpeg -y -f concat -safe 0 -i concat.txt -c:v copy -c:a libopus -b:a 192k "' + out + '"';
      // Команда — и текстом (браузер вправе не дать сохранить .bat), и скриптами
      await writeFile(dir, 'README-join.txt', 'Склеить треки в один файл (нужен ffmpeg), в этой папке:\n\n' + cmd + '\n\nИли запусти join.bat (Windows) / join.sh.\n');
      for (const [n, body] of [['join.bat', '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\n' + cmd + '\r\npause\r\n'],
                               ['join.sh', '#!/bin/sh\ncd "$(dirname "$0")"\n' + cmd + '\n']]) {
        try { await writeFile(dir, n, body); } catch (e) { console.warn('[Album] ' + n + ' не записан', e); }
      }
      status('Готово: ' + files.length + ' файлов, общая длина ' + fmt(lengths.reduce((a, b) => a + b, 0)) + '. Склеить: join.bat (или команда из README-join.txt).');
      return { files: files, lengths: lengths, chapters: ch };
    } catch (e) {
      console.error('[Album] экспорт', e);
      status('Ошибка: ' + (e.message || e));
    } finally {
      busy = false;
      if (typeof CardDeck !== 'undefined') CardDeck.setAlbum(null);
    }
  }

  /* ── Панель ─────────────────────────────────── */
  let panelEl = null;
  const inp = 'style="background:#161616;border:1px solid #333;color:#eee;padding:5px 6px;font:inherit;"';
  const sb = 'style="background:#161616;border:1px solid #333;color:#ccc;padding:2px 6px;font:inherit;cursor:pointer;"';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderList() {
    if (!panelEl) return;
    const $ = s => panelEl.querySelector(s);
    const total = tracks.reduce((a, t) => a + (t.duration || 0) + lead(), 0);
    $('[data-k="list"]').innerHTML = tracks.length ? tracks.map((t, i) =>
      `<div style="display:flex;flex-direction:column;gap:4px;padding:6px 0;border-top:1px solid #222;">
        <div style="display:flex;gap:6px;align-items:baseline;">
          <b style="color:#00e5ff;">${String(i + 1).padStart(2, '0')}</b>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(t.name)}">${esc(titleOf(t))}</span>
          <span style="color:#666;">${fmt(t.duration || 0)}</span>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          <button ${sb} data-a="play" data-i="${i}" title="Открыть и слушать">▶ слушать</button>
          <button ${sb} data-a="lrc" data-i="${i}">${t.lrc ? 'текст ✓' : '+ текст'}</button>
          <button ${sb} data-a="bg" data-i="${i}" title="Картинка песни: фон кадра и карта">🖼 картинка</button>
          ${t.lrc ? `<button ${sb} data-a="nolrc" data-i="${i}" title="Убрать текст">− текст</button>` : ''}
          <span style="flex:1"></span>
          <button ${sb} data-a="up" data-i="${i}">▲</button><button ${sb} data-a="down" data-i="${i}">▼</button>
          <button ${sb} data-a="del" data-i="${i}" title="Убрать из альбома">✕</button>
        </div></div>`).join('') : '<div style="color:#666;">Пусто — добавь песни (можно вместе с .lrc и картинками с теми же именами).</div>';
    $('[data-k="sum"]').textContent = tracks.length ? `${tracks.length} треков · ~${fmt(total)} с вставками карт` : '';
    $('[data-k="ch"]').value = tracks.length ? chapters().join('\n') : '';
  }

  function toggle() {
    if (panelEl) { panelEl.remove(); panelEl = null; return; }
    const p = document.createElement('div');
    p.style.cssText = "position:fixed;top:52px;right:16px;z-index:9999;width:360px;max-height:84vh;overflow-y:auto;background:#0d0d0d;border:1px solid #333;padding:14px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#ddd;box-shadow:0 12px 40px rgba(0,0,0,.7);display:flex;flex-direction:column;gap:9px;";
    const presets = (typeof ExportEngine !== 'undefined' && ExportEngine.PRESETS) || [];
    p.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;"><b style="color:#e8ff00;letter-spacing:2px;">▤ АЛЬБОМ</b><button data-k="x" style="background:none;border:0;color:#888;cursor:pointer;font-size:14px;">✕</button></div>` +
      `<label style="display:flex;flex-direction:column;gap:4px;"><span style="color:#888;font-size:9px;letter-spacing:1px;">НАЗВАНИЕ (ШАПКА КАРТЫ, ИМЯ ФАЙЛА)</span><input data-k="name" ${inp}></label>` +
      `<button data-k="add" ${inp.replace('style="', 'style="cursor:pointer;')}>+ Песни / .lrc / картинки…</button><input type="file" data-k="files" multiple accept="audio/*,.lrc,.txt,image/*" hidden>` +
      `<input type="file" data-k="one" hidden>` +
      `<div data-k="list"></div>` +
      `<div data-k="sum" style="color:#888;"></div>` +
      `<label style="display:flex;flex-direction:column;gap:4px;"><span style="color:#888;font-size:9px;letter-spacing:1px;">ГЛАВЫ (ПРИМЕРНО; ТОЧНЫЕ — В chapters.txt ПОСЛЕ ЭКСПОРТА)</span><textarea data-k="ch" rows="4" readonly ${inp}></textarea></label>` +
      `<label style="display:flex;flex-direction:column;gap:4px;"><span style="color:#888;font-size:9px;letter-spacing:1px;">КАЧЕСТВО</span><select data-k="preset" ${inp}>${presets.map(x => `<option value="${x.key}"${st.preset === x.key ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>` +
      `<button data-k="go" style="background:#e8ff00;color:#000;border:0;padding:8px;font:inherit;font-weight:700;letter-spacing:1px;cursor:pointer;">ЭКСПОРТ АЛЬБОМА</button>` +
      `<div data-k="st" style="color:#aaa;"></div>` +
      `<div style="color:#555;font-size:10px;">Файл на трек + chapters.txt + join.bat (нужен ffmpeg). Chrome спросит папку; без неё — обычными загрузками.</div>`;
    document.body.appendChild(p);
    panelEl = p;
    const $ = s => p.querySelector(s);
    const status = s => { $('[data-k="st"]').textContent = s; };
    $('[data-k="name"]').value = st.name;
    $('[data-k="x"]').onclick = toggle;
    $('[data-k="name"]').oninput = e => { st.name = e.target.value; save(); };
    $('[data-k="preset"]').onchange = e => { st.preset = e.target.value; save(); };
    $('[data-k="add"]').onclick = () => $('[data-k="files"]').click();
    $('[data-k="files"]').onchange = async e => {
      status('Добавляю…');
      await addFiles(Array.from(e.target.files || []));
      e.target.value = ''; status(''); renderList();
    };
    let pickFor = null;
    $('[data-k="one"]').onchange = async e => {
      const f = e.target.files[0], t = pickFor && pickFor.t; e.target.value = '';
      if (!f || !t) return;
      if (pickFor.kind === 'lrc') { t.lrc = await f.text(); await putRec(t); }
      else await setArt(t.name, f);
      renderList();
    };
    $('[data-k="list"]').onclick = async e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const i = +b.dataset.i, t = tracks[i], a = b.dataset.a;
      if (a === 'play') { status('Открываю…'); await loadTrack(i, true); status('Играет: ' + titleOf(t) + ' · ↩ Мой проект — вернуться к своему'); }
      else if (a === 'lrc' || a === 'bg') {
        pickFor = { t: t, kind: a };
        const one = $('[data-k="one"]'); one.accept = a === 'lrc' ? '.lrc,.txt' : 'image/*'; one.click();
      }
      else if (a === 'nolrc') { t.lrc = ''; await putRec(t); }
      else if (a === 'del') { tracks.splice(i, 1); await delRec(t.id); await renumber(); }
      else if (a === 'up' && i > 0) { tracks.splice(i - 1, 0, tracks.splice(i, 1)[0]); await renumber(); }
      else if (a === 'down' && i < tracks.length - 1) { tracks.splice(i + 1, 0, tracks.splice(i, 1)[0]); await renumber(); }
      renderList();
    };
    $('[data-k="go"]').onclick = () => exportAll(status).then(renderList);
    reload().then(renderList);
  }

  function buildUI() {
    const header = document.querySelector('header') || document.querySelector('.header');
    if (!header || document.getElementById('albumBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'albumBtn';
    btn.style.cssText = "background:transparent;border:1px solid #e8ff00;color:#e8ff00;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;padding:6px 12px;cursor:pointer;margin-right:6px;";
    btn.textContent = '▤ АЛЬБОМ';
    btn.title = 'Длинное видео из нескольких песен: карты меняются, как в радио; главы для YouTube';
    const anchor = document.getElementById('vizBtn') || document.getElementById('cardDeckBtn');
    if (anchor && anchor.parentNode === header) header.insertBefore(btn, anchor); else header.appendChild(btn);
    btn.addEventListener('click', toggle);
  }

  return {
    buildUI: buildUI, toggle: toggle, drawBackground: drawBackground, onAudio: onAudio,
    addFiles: addFiles, addTrack: addTrack, reload: reload, renderList: () => renderList(), loadTrack: loadTrack, exportAll: exportAll, chapters: chapters,
    setName: n => { st.name = n; save(); },
    openSong: openSong, myProject: myProject, setArt: setArt, getArt: getArt,
    get clean() { return !!cur; }, get current() { return cur ? cur.name : ''; },
    get tracks() { return tracks; }, get settings() { return st; },
  };
})();
