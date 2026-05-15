/* ═══════════════════════════════════════════════════════════════════════════
   js/BackgroundManagerStorage.js   v1
   ─────────────────────────────────────────────────────────────────────────
   Хранилище для BackgroundManager: фоны и их настройки переживают
   перезагрузку страницы. Аналог AudioStorage.js, но на массив записей.

   Структура IndexedDB (база chromatype_bgm, версия 1):
     · object store 'files'    — каждая запись: {name, type, data: ArrayBuffer}
                                  под ключом entry.id
     · object store 'settings' — один JSON-массив всех настроек под ключом 'all'

   API:
     await BackgroundManagerStorage.saveFile(id, file)     → void
     await BackgroundManagerStorage.loadFile(id)           → File | null
     await BackgroundManagerStorage.deleteFile(id)         → void
     await BackgroundManagerStorage.listFileIds()          → string[]
     await BackgroundManagerStorage.saveSettings(arr)      → void
     await BackgroundManagerStorage.loadSettings()         → Array | null
     await BackgroundManagerStorage.clearAll()             → void
═══════════════════════════════════════════════════════════════════════════ */
const BackgroundManagerStorage = (() => {
  const DB_NAME       = 'chromatype_bgm';
  const DB_VERSION    = 1;
  const STORE_FILES   = 'files';
  const STORE_SETTING = 'settings';
  const SETTINGS_KEY  = 'all';

  function _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_FILES))   db.createObjectStore(STORE_FILES);
        if (!db.objectStoreNames.contains(STORE_SETTING)) db.createObjectStore(STORE_SETTING);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  /* ── Файлы ────────────────────────────────────────────────────────────── */
  async function saveFile(id, file) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      tx.objectStore(STORE_FILES).put({ name: file.name, type: file.type, data: buf }, id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = e  => { db.close(); reject(e.target.error); };
    });
  }

  async function loadFile(id) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_FILES, 'readonly');
      const req = tx.objectStore(STORE_FILES).get(id);
      req.onsuccess = e => {
        db.close();
        const rec = e.target.result;
        if (!rec) { resolve(null); return; }
        try {
          const f = new File([rec.data], rec.name || id, { type: rec.type || '' });
          resolve(f);
        } catch (err) {
          // Fallback для старых браузеров без File ctor
          const blob = new Blob([rec.data], { type: rec.type || '' });
          blob.name = rec.name || id;
          resolve(blob);
        }
      };
      req.onerror = e => { db.close(); reject(e.target.error); };
    });
  }

  async function deleteFile(id) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      tx.objectStore(STORE_FILES).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = e  => { db.close(); reject(e.target.error); };
    });
  }

  async function listFileIds() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_FILES, 'readonly');
      const req = tx.objectStore(STORE_FILES).getAllKeys();
      req.onsuccess = e => { db.close(); resolve(e.target.result || []); };
      req.onerror   = e => { db.close(); reject(e.target.error); };
    });
  }

  /* ── Настройки ────────────────────────────────────────────────────────── */
  async function saveSettings(arr) {
    if (!Array.isArray(arr)) return;
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTING, 'readwrite');
      tx.objectStore(STORE_SETTING).put(arr, SETTINGS_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = e  => { db.close(); reject(e.target.error); };
    });
  }

  async function loadSettings() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_SETTING, 'readonly');
      const req = tx.objectStore(STORE_SETTING).get(SETTINGS_KEY);
      req.onsuccess = e => { db.close(); resolve(e.target.result || null); };
      req.onerror   = e => { db.close(); reject(e.target.error); };
    });
  }

  /* ── Полный сброс ─────────────────────────────────────────────────────── */
  async function clearAll() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_FILES, STORE_SETTING], 'readwrite');
      tx.objectStore(STORE_FILES).clear();
      tx.objectStore(STORE_SETTING).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = e  => { db.close(); reject(e.target.error); };
    });
  }

  return { saveFile, loadFile, deleteFile, listFileIds, saveSettings, loadSettings, clearAll };
})();
