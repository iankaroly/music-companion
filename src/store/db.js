// IndexedDB glue.
// 'recordings'      — listing metadata: { id, date, duration, sampleRate, noteCount }
// 'recording-data'  — heavy payload keyed by the same id: { id, audio, notes, readings, a4 }
// Split so listing the library never loads audio.

const DB_NAME = 'music-companion';
const VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('recording-data')) {
        db.createObjectStore('recording-data', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecording({ date, duration, sampleRate, audio, notes, readings, a4 }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['recordings', 'recording-data'], 'readwrite');
    const metaReq = tx.objectStore('recordings').add({
      date, duration, sampleRate, noteCount: notes.length,
    });
    metaReq.onsuccess = () => {
      tx.objectStore('recording-data').add({ id: metaReq.result, audio, notes, readings, a4 });
    };
    tx.oncomplete = () => resolve(metaReq.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listRecordings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('recordings', 'readonly').objectStore('recordings').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.date - a.date));
    req.onerror = () => reject(req.error);
  });
}

export async function loadRecording(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('recording-data', 'readonly').objectStore('recording-data').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecording(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['recordings', 'recording-data'], 'readwrite');
    tx.objectStore('recordings').delete(id);
    tx.objectStore('recording-data').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
