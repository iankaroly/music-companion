// IndexedDB glue.
// 'recordings'      — listing metadata: { id, date, duration, sampleRate, noteCount, folderId }
// 'recording-data'  — heavy payload keyed by the same id: { id, audio, notes, readings, a4 }
// 'passages'        — named spans: { id, name, recordingId, startSec, endSec, date, stats }
// 'folders'         — { id, name, date }; a recording's folderId points here,
//                     and undefined/null means it sits at the top level
// Split so listing the library never loads audio; passages are their own store
// so the coach can read every attempt without touching a recording.

import { landingStats } from '../analysis/landing.js';

const DB_NAME = 'music-companion';
const VERSION = 4;
const STORES = ['sessions', 'recordings', 'recording-data', 'passages', 'folders'];

// Every branch is `if (!contains)`, so this is safe to re-run at any version.
function createStores(db) {
  if (!db.objectStoreNames.contains('sessions')) {
    db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
  }
  if (!db.objectStoreNames.contains('recordings')) {
    db.createObjectStore('recordings', { keyPath: 'id', autoIncrement: true });
  }
  if (!db.objectStoreNames.contains('recording-data')) {
    db.createObjectStore('recording-data', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('passages')) {
    const passages = db.createObjectStore('passages', { keyPath: 'id', autoIncrement: true });
    passages.createIndex('recordingId', 'recordingId');
  }
  if (!db.objectStoreNames.contains('folders')) {
    db.createObjectStore('folders', { keyPath: 'id', autoIncrement: true });
  }
}

function openAt(version) {
  return new Promise((resolve, reject) => {
    // No version means "whatever is already there" (and version 1 if nothing
    // is). Asking for a LOWER version than exists is a VersionError, so the
    // current version has to be discovered rather than assumed.
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => createStores(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function connect() {
  let db = await openAt();
  if (db.version < VERSION) {
    db.close();
    db = await openAt(VERSION);
  }
  const missing = STORES.filter((s) => !db.objectStoreNames.contains(s));
  if (missing.length === 0) return db;
  // A database sitting at its version with a store missing — an upgrade that
  // was interrupted, or a version stamped by a build that didn't finish
  // shipping its stores — would otherwise never be repaired, since
  // onupgradeneeded only fires on a version change. Reopening one version
  // higher re-runs the guards above and heals it, without touching the data.
  const next = db.version + 1;
  db.close();
  return openAt(next);
}

// One connection for the tab, so the checks above run once rather than on
// every read. A failed open isn't cached — the next call retries.
let connection = null;
function openDB() {
  connection ??= connect().then((db) => {
    // With the app open in two tabs, a held-open connection would block the
    // other tab's upgrade indefinitely. Step aside and reconnect on demand.
    db.onversionchange = () => {
      db.close();
      connection = null;
    };
    db.onclose = () => { connection = null; };
    return db;
  }).catch((err) => { connection = null; throw err; });
  return connection;
}

// Lightweight per-note stats live in the META record so the coach can
// aggregate habits across every take without ever loading audio.
function statsOf(notes) {
  return (notes ?? []).map((n) => ({ midi: n.midi, name: n.name, cents: n.cents }));
}

export async function saveRecording({ date, duration, sampleRate, audio, notes, readings, a4 }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['recordings', 'recording-data'], 'readwrite');
    const metaReq = tx.objectStore('recordings').add({
      date,
      duration,
      sampleRate,
      noteCount: notes.length,
      noteStats: statsOf(notes),
      landingStats: landingStats(notes, readings, a4) ?? [],
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

// Recordings saved before a given stat existed get it computed once from the
// heavy payload and written back, so later coach visits stay cheap.
//
// The guard has to name every stat, not just test that SOME summary exists:
// every take saved since the coach shipped already has noteStats, so a check
// for `!rec.noteStats` would skip all of them forever and the newer panels
// would only ever show data for takes recorded after this line was written.
function needsBackfill(rec) {
  return !rec.noteStats || !rec.landingStats;
}

export async function listRecordingsWithStats() {
  const db = await openDB();
  const recordings = await listRecordings();
  for (const r of recordings.filter(needsBackfill)) {
    const data = await loadRecording(r.id);
    r.noteStats ??= statsOf(data?.notes);
    r.landingStats ??= landingStats(data?.notes, data?.readings, data?.a4 ?? 440) ?? [];
    await new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      tx.objectStore('recordings').put(r);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  return recordings;
}

export async function renameRecording(id, name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    const store = tx.objectStore('recordings');
    const req = store.get(id);
    req.onsuccess = () => {
      const meta = req.result;
      if (!meta) return;
      if (name) meta.name = name;
      else delete meta.name; // cleared names fall back to the date
      store.put(meta);
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteRecording(id) {
  const db = await openDB();
  const passages = await listPassages();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['recordings', 'recording-data', 'passages'], 'readwrite');
    tx.objectStore('recordings').delete(id);
    tx.objectStore('recording-data').delete(id);
    // A passage points into audio that's about to disappear, so it goes too.
    const store = tx.objectStore('passages');
    for (const p of passages.filter((p) => p.recordingId === id)) store.delete(p.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- folders ---------------------------------------------------------------
//
// A folder is a name and nothing else: recordings point at it, so grouping a
// take is one field on a record that already exists rather than a move. That
// also means deleting a folder can never take recordings with it — see below.

export async function createFolder(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    const req = tx.objectStore('folders').add({ name, date: Date.now() });
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listFolders() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('folders', 'readonly').objectStore('folders').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
    req.onerror = () => reject(req.error);
  });
}

export async function renameFolder(id, name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    const store = tx.objectStore('folders');
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result && name) store.put({ ...req.result, name });
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Deleting a folder turns its recordings loose rather than deleting them.
// Losing a take because a label was tidied away is not a recoverable mistake,
// and nothing in the UI would have warned that it was about to happen.
export async function deleteFolder(id) {
  const db = await openDB();
  const recordings = await listRecordings();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['folders', 'recordings'], 'readwrite');
    tx.objectStore('folders').delete(id);
    const store = tx.objectStore('recordings');
    for (const r of recordings.filter((rec) => rec.folderId === id)) {
      const { folderId, ...rest } = r;
      store.put(rest);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function setRecordingFolder(id, folderId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    const store = tx.objectStore('recordings');
    const req = store.get(id);
    req.onsuccess = () => {
      const meta = req.result;
      if (!meta) return;
      if (folderId === null || folderId === undefined) delete meta.folderId;
      else meta.folderId = folderId;
      store.put(meta);
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// --- passages --------------------------------------------------------------

export async function savePassage({ name, recordingId, startSec, endSec, stats, date }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('passages', 'readwrite');
    const req = tx.objectStore('passages').add({
      name, recordingId, startSec, endSec, stats, date: date ?? Date.now(),
    });
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listPassages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('passages', 'readonly').objectStore('passages').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.date - a.date));
    req.onerror = () => reject(req.error);
  });
}

export async function deletePassage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('passages', 'readwrite');
    tx.objectStore('passages').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
