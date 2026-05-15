/* ═══════════════════════════════════════════════
   js/AudioStorage.js
   Сохранение аудио-файла в IndexedDB,
   чтобы он переживал перезагрузку страницы.

   API:
     AudioStorage.save(file)           → Promise<void>
     AudioStorage.load()               → Promise<File | null>
     AudioStorage.clear()              → Promise<void>
     AudioStorage.hasSaved()           → Promise<boolean>
═══════════════════════════════════════════════ */
const AudioStorage = (() => {
  const DB_NAME    = 'chromatype_db';
  const DB_VERSION = 1;
  const STORE      = 'audio';
  const KEY        = 'current_audio';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function save(file) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      // Сохраняем {name, type, data} чтобы потом восстановить File
      const reader = new FileReader();
      reader.onload = () => {
        store.put({ name: file.name, type: file.type, data: reader.result }, KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = e  => { db.close(); reject(e.target.error); };
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function load() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req   = store.get(KEY);
      req.onsuccess = e => {
        db.close();
        const rec = e.target.result;
        if (!rec) { resolve(null); return; }
        // Восстанавливаем File из сохранённых данных
        const file = new File([rec.data], rec.name, { type: rec.type });
        resolve(file);
      };
      req.onerror = e => { db.close(); reject(e.target.error); };
    });
  }

  async function clear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.delete(KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = e  => { db.close(); reject(e.target.error); };
    });
  }

  async function hasSaved() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req   = store.getKey(KEY);
      req.onsuccess = e => { db.close(); resolve(e.target.result !== undefined); };
      req.onerror   = e => { db.close(); reject(e.target.error); };
    });
  }

  return { save, load, clear, hasSaved };
})();
