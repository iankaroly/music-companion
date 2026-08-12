// IndexedDB glue.
// 'recordings'      — listing metadata: { id, date, duration, sampleRate, noteCount, folderId }
// 'recording-data'  — heavy payload keyed by the same id: { id, audio, notes, readings, a4 }
// 'passages'        — named spans: { id, name, recordingId, startSec, endSec, date, stats }
// 'folders'         — { id, name, date }; a recording's folderId points here,
//                     and undefined/null means it sits at the top level
// Split so listing the library never loads audio; passages are their own store
// so the coach can read every attempt without touching a recording.

import { landingStats } from '../analysis/landing.js';
import { encodeStoredAudio, decodeStoredAudio, storedBytes } from '../audio/codec.js';

// The app is called Practice Partner now. This is NOT — and the backup format
// string below is not either. Both are keys, not names: renaming the database
// points the app at an empty one and every take anybody has ever recorded is
// still sitting in the old one, unreachable. Renaming the format string makes
// every backup file already saved unimportable. They stay as they are.
const DB_NAME = 'music-companion';
const VERSION = 9;
const STORES = ['sessions', 'recordings', 'recording-data', 'passages', 'folders', 'scores',
  'annotations', 'score-pages', 'setlists'];

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
  if (!db.objectStoreNames.contains('scores')) {
    db.createObjectStore('scores', { keyPath: 'id', autoIncrement: true });
  }
  // What you wrote on the music: keyed by the score it was written on, one
  // record per piece. Kept apart from the score itself so re-reading a page
  // never carries the megabyte of MusicXML with it.
  if (!db.objectStoreNames.contains('annotations')) {
    db.createObjectStore('annotations', { keyPath: 'scoreId' });
  }
  // A programme: the pieces you are playing, in the order you are playing them.
  if (!db.objectStoreNames.contains('setlists')) {
    db.createObjectStore('setlists', { keyPath: 'id', autoIncrement: true });
  }
  // A scanned or downloaded part: the PDF's bytes, or one image per page.
  // Split off the listing the same way audio is split off a recording — the
  // shelf reads every score on every refresh and must not drag megabytes of
  // paper through memory to draw a list of names.
  if (!db.objectStoreNames.contains('score-pages')) {
    db.createObjectStore('score-pages', { keyPath: 'scoreId' });
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

// Every write below settles on all three of complete, error and ABORT.
//
// The abort is the one that mattered and the one that was missing. A
// transaction that aborts — the quota running out mid-save, or the connection
// being closed because another tab started an upgrade, which openDB above does
// deliberately — does not necessarily fire an error event, so a promise
// awaiting only complete-or-error simply never settles. For saveRecording that
// is the worst shape a bug can take: the take is gone, the button waits
// forever, and nothing anywhere says so.

// Lightweight per-note stats live in the META record so the coach can
// aggregate habits across every take without ever loading audio.
function statsOf(notes) {
  return (notes ?? []).map((n) => ({ midi: n.midi, name: n.name, cents: n.cents }));
}

// --- scores -----------------------------------------------------------------
// The MusicXML a take was played from. Uploaded once and reused for every
// attempt at that piece, which is also what lets the coach line attempts up
// by real bar numbers instead of a name somebody typed.

export async function saveScore({ name, xml, partIndex = 0, parts = [] }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readwrite');
    const req = tx.objectStore('scores')
      .add({ name, xml, partIndex, parts, kind: 'engraved', date: Date.now() });
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

// A score that is PAPER rather than notation: a PDF, or a page per photograph.
// It can be read, paged through and written on; it cannot be marked up against
// a take, because nothing in a picture of a page says which note is which.
export async function savePagesScore({
  name, source, pageCount, data = null, pages = null, password = null, raws = null,
}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['scores', 'score-pages'], 'readwrite');
    const req = tx.objectStore('scores').add({
      name, kind: 'pages', source, pageCount, date: Date.now(),
    });
    req.onsuccess = () => {
      // `raws` is the photograph behind each page, before it was squared up.
      // Kept because changing the edges later means going back to it: a crop of
      // a crop cannot return what the first one cut off. It roughly doubles
      // what a scanned part takes up, and is what makes the pages editable.
      tx.objectStore('score-pages').put({ scoreId: req.result, source, data, pages, password, raws });
    };
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

// Pairing a scan with notation. The player reads the photograph they know; the
// analysis reads the MusicXML behind it. Nothing in the app can turn one into
// the other — that is optical music recognition, and it does not run in a
// browser — but a player who has the file can say "these two are the same
// piece" and get both halves at once.
// Where you keep stopping: the start of the development, the passage that needs
// the metronome, the page you always fumble. Stored on the score row because
// there are never many and they are always wanted with it.
export async function saveBookmarks(scoreId, bookmarks) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readwrite');
    const store = tx.objectStore('scores');
    const req = store.get(scoreId);
    req.onsuccess = () => {
      const row = req.result;
      if (!row) return;
      if (bookmarks?.length) row.bookmarks = bookmarks;
      else delete row.bookmarks;
      store.put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

export async function pairScoreNotation(paperId, notationId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readwrite');
    const store = tx.objectStore('scores');
    const req = store.get(paperId);
    req.onsuccess = () => {
      const row = req.result;
      if (!row) return;
      if (notationId === null) delete row.notationId;
      else row.notationId = notationId;
      store.put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

// --- setlists ----------------------------------------------------------------
//
// A recital, a lesson, an audition list: the pieces in the order they happen.
// It holds score ids rather than copies, so renaming a piece renames it here
// too, and deleting one leaves a gap that the list quietly steps over.

export async function listSetlists() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('setlists', 'readonly').objectStore('setlists').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.date - a.date));
    req.onerror = () => reject(req.error);
  });
}

export async function saveSetlist({ id = null, name, items = [] }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('setlists', 'readwrite');
    const store = tx.objectStore('setlists');
    const row = { name, items, date: Date.now() };
    const req = id === null ? store.add(row) : store.put({ ...row, id });
    tx.oncomplete = () => resolve(id ?? req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

export async function deleteSetlist(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('setlists', 'readwrite');
    tx.objectStore('setlists').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

// Jumps taped to the page: a repeat back to the top, a coda across three pages,
// the cut your teacher wants. Stored with the score because there are never
// many and they are meaningless without it.
export async function saveLinks(scoreId, links) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readwrite');
    const store = tx.objectStore('scores');
    const req = store.get(scoreId);
    req.onsuccess = () => {
      const row = req.result;
      if (!row) return;
      if (links?.length) row.links = links;
      else delete row.links;
      store.put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

export async function renameScore(id, name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readwrite');
    const store = tx.objectStore('scores');
    const req = store.get(id);
    req.onsuccess = () => {
      const row = req.result;
      if (!row) return;
      row.name = String(name ?? '').trim() || row.name;
      store.put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

// What was read off the pages: staves, bars and noteheads, one entry per page.
// It lives with the pages rather than with the score row because it is big and
// is only ever wanted when the pages themselves are.
// …along with the two measurements the reader needs before it can lay a single
// page out: where the music sits on each page, and how big each page is.
//
// Those were worked out every time a score was opened, and working them out
// means RENDERING every page — a twenty-one page part rendered twenty-one times
// before the first page appeared. They cannot change once the pages are stored,
// so they are written down here with the layout and never computed twice.
// Two things write these now — the pass at import and the reader itself, when
// it opens a score that pass never finished — and a whole-array assignment lets
// whichever finishes second throw the other one's work away. Both writers are a
// read, an await, then a write, so "second" is not a thing either can know.
//
// So the arrays are merged a page at a time, and the rule is that a measurement
// already written down wins. Nothing here can change: page 4 of a stored PDF is
// page 4 of a stored PDF, and every writer that measures it gets the same
// answer. A gap — a null, or an array that stops short because the pass was
// interrupted — is the only thing that can be filled.
//
// Which is also how a page is UNmeasured: replaceOnePage nulls that one entry,
// and the next pass over it fills the hole without disturbing its neighbours.
export function fillGaps(existing, incoming) {
  if (!incoming?.length) return existing ?? null;
  const out = Array.isArray(existing) ? existing.slice() : [];
  // Grown to the length of what arrived even where what arrived is nothing:
  // "these nine pages were looked at and none of them could be read" is an
  // ANSWER, and it has to be told apart from "nobody has looked yet". Collapsed
  // to null, as it was, a part with no readable staves on it — a scan of
  // something that is not music, a photograph too dark to make out — was read
  // from end to end again on every single launch, for ever, to be told the same
  // thing.
  while (out.length < incoming.length) out.push(null);
  for (let i = 0; i < incoming.length; i++) {
    if (incoming[i] == null || out[i] != null) continue;
    out[i] = incoming[i];
  }
  return out.length ? out : null;
}

export async function saveScoreLayout(scoreId, layout, measurements = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('score-pages', 'readwrite');
    const store = tx.objectStore('score-pages');
    const req = store.get(scoreId);
    req.onsuccess = () => {
      const row = req.result;
      if (!row) return;
      row.layout = fillGaps(row.layout, layout);
      row.crops = fillGaps(row.crops, measurements?.crops);
      row.sizes = fillGaps(row.sizes, measurements?.sizes);
      store.put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

// Pages reordered or thrown away. A scan comes off a camera in the order it was
// shot, which is usually right and occasionally not — a page taken twice, or
// one taken out of turn.
// The pages of a scan, replaced by better copies of themselves — straightened,
// unlit — with everything else about the score left alone. Its layout is
// cleared, because where the staves are is a fact about the OLD pictures.
export async function replacePages(scoreId, pages) {
  const db = await openDB();
  const row = await loadScorePages(scoreId);
  if (!row || row.source === 'pdf') return null;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['score-pages'], 'readwrite');
    tx.objectStore('score-pages').put({ ...row, pages, layout: null });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
  return pages.length;
}

// One page of a scan, taken again with different edges. Everything else about
// the score is left alone, and only THAT page's measurements are forgotten —
// where its staves are, where the music sits on it — because they are facts
// about the picture that has just been replaced.
export async function replaceOnePage(scoreId, index, file) {
  const db = await openDB();
  const row = await loadScorePages(scoreId);
  if (!row?.pages?.[index]) return null;
  const next = { ...row };
  next.pages = row.pages.map((page, i) => (i === index ? file : page));
  if (row.layout) next.layout = row.layout.map((page, i) => (i === index ? null : page));
  if (row.crops) next.crops = row.crops.map((crop, i) => (i === index ? null : crop));
  if (row.sizes) next.sizes = row.sizes.map((size, i) => (i === index ? null : size));
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['score-pages'], 'readwrite');
    tx.objectStore('score-pages').put(next);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
  return index;
}

export async function savePageOrder(scoreId, order) {
  const db = await openDB();
  const row = await loadScorePages(scoreId);
  if (!row) return null;
  const kept = order.map((i) => i);
  const next = { ...row };
  if (row.pages) next.pages = kept.map((i) => row.pages[i]).filter(Boolean);
  if (row.layout) next.layout = kept.map((i) => row.layout[i] ?? null);
  if (row.source === 'pdf') return null;   // a PDF keeps its own page order
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['score-pages', 'scores'], 'readwrite');
    tx.objectStore('score-pages').put(next);
    const scores = tx.objectStore('scores');
    const req = scores.get(scoreId);
    req.onsuccess = () => {
      const score = req.result;
      if (!score) return;
      score.pageCount = next.pages?.length ?? score.pageCount;
      scores.put(score);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
  return next.pages?.length ?? null;
}

export async function loadScorePages(scoreId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('score-pages', 'readonly').objectStore('score-pages').get(scoreId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

// Without the XML, so a picker can list twenty pieces without holding twenty
// scores in memory.
export async function listScores() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('scores', 'readonly').objectStore('scores').getAll();
    req.onsuccess = () => resolve(req.result
      .map(({ xml, ...rest }) => rest)
      .sort((a, b) => b.date - a.date));
    req.onerror = () => reject(req.error);
  });
}

export async function loadScore(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('scores', 'readonly').objectStore('scores').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteScore(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    // The ink goes with the paper it was written on, and so does the paper.
    const tx = db.transaction(['scores', 'annotations', 'score-pages'], 'readwrite');
    tx.objectStore('annotations').delete(id);
    tx.objectStore('score-pages').delete(id);
    tx.objectStore('scores').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

// --- what you wrote on the page ---------------------------------------------
//
// Strokes are stored against BARS, not against pixels: each point is an offset
// from the top-left corner of the bar it was drawn over, in the engraver's own
// units. Turn the phone and the music re-flows — different page breaks, wider
// systems, a different number of bars per line — and the ink goes with the bar
// it was written on instead of sliding off into the margin.

export async function saveAnnotations(scoreId, strokes) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('annotations', 'readwrite');
    const store = tx.objectStore('annotations');
    if (strokes?.length) store.put({ scoreId, strokes, date: Date.now() });
    else store.delete(scoreId); // an erased page is not an empty record
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

export async function loadAnnotations(scoreId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('annotations', 'readonly').objectStore('annotations').get(scoreId);
    req.onsuccess = () => resolve(req.result?.strokes ?? []);
    req.onerror = () => reject(req.error);
  });
}

// Alignment happens after the fact, so a score can be attached to a take that
// was recorded before anyone thought to pick the piece.
export async function setRecordingScore(id, scoreId, scoreStats = undefined) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    const store = tx.objectStore('recordings');
    const req = store.get(id);
    req.onsuccess = () => {
      const row = req.result;
      if (!row) return;
      if (scoreId === null) delete row.scoreId;
      else row.scoreId = scoreId;
      // The note-by-note reading, when the caller has one. Attaching a piece to
      // a take that is already in the library is the same event as saving it
      // with the piece chosen, and it should leave the same record behind.
      if (scoreStats !== undefined) row.scoreStats = scoreStats;
      store.put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}

// Every saved take of one score, oldest first — the history of practising that
// piece. The stats ride along in the listing metadata, so drawing the history
// never loads a single second of audio.
export async function listRecordingsForScore(scoreId) {
  const all = await listRecordings();
  return all.filter((r) => r.scoreId === scoreId).sort((a, b) => a.date - b.date);
}

export async function saveRecording({
  date, duration, sampleRate, audio, notes, readings, a4, scoreId = null, scoreStats = null,
}) {
  const db = await openDB();
  // Compressed before it ever reaches the store — see audio/codec.js for why
  // raw Float32 was not an option for a library you keep forever.
  const stored = await encodeStoredAudio(new Float32Array(audio), sampleRate);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['recordings', 'recording-data'], 'readwrite');
    const metaReq = tx.objectStore('recordings').add({
      date,
      duration,
      sampleRate,
      noteCount: notes.length,
      noteStats: statsOf(notes),
      landingStats: landingStats(notes, readings, a4) ?? [],
      ...(scoreId === null ? {} : { scoreId }),
      // Per-note cents against the written pitch. Kept in the META record, not
      // the payload, so comparing this take with the last one never decodes
      // audio or re-runs the alignment.
      ...(scoreStats === null ? {} : { scoreStats }),
    });
    metaReq.onsuccess = () => {
      tx.objectStore('recording-data').add({ id: metaReq.result, audio: stored, notes, readings, a4 });
    };
    tx.oncomplete = () => resolve(metaReq.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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

// The payload row without decoding the audio in it.
//
// The notes and readings a take was saved with are plain fields on this row;
// only the audio needs the codec. Anything that wants the analysis and not the
// sound — the coach's backfill below, most obviously — should stop here, or it
// pays a full decode and a hundred megabytes of Float32 per take to read a list
// of numbers that were sitting right there.
async function loadRecordingRow(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('recording-data', 'readonly').objectStore('recording-data').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadRecording(id) {
  const row = await loadRecordingRow(id);
  if (!row) return row;
  // Recordings written before compression existed hold a bare Float32 buffer;
  // decodeStoredAudio reads both, so nothing in the library goes stale.
  const { samples, sampleRate } = await decodeStoredAudio(row.audio);
  return { ...row, audio: samples.buffer, sampleRate, samples };
}

// How much of the device this library is using, and the browser's own numbers
// for how much it is allowed.
export async function storageReport() {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction('recording-data', 'readonly').objectStore('recording-data').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const audioBytes = rows.reduce((a, r) => a + storedBytes(r.audio), 0);
  let quota = null;
  let usage = null;
  try {
    const est = await navigator.storage?.estimate?.();
    quota = est?.quota ?? null;
    usage = est?.usage ?? null;
  } catch { /* not supported */ }
  return { takes: rows.length, audioBytes, usage, quota };
}

// Ask the browser not to evict this. Script-writable storage is fair game for
// cleanup otherwise, and the coach's whole value is the takes from months ago.
export async function requestPersistence() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// --- backup ----------------------------------------------------------------
//
// Everything except the audio. That is a deliberate trade: the audio is by far
// the biggest thing here and it is the LEAST valuable to keep — a take you can
// no longer listen to still carries every note, every cent of error and every
// landing, which is what the coach reads and what took months to accumulate.
// A year of practice history fits in a file small enough to email; a year of
// audio does not. Individual takes can be shared as WAV from the library.

// Scores come along WITH their XML. It is text — a movement is tens of
// kilobytes against a take's megabytes — and a restored history whose takes
// point at pieces that are no longer there loses the annotation the moment it
// is reopened.
async function allScores() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('scores', 'readonly').objectStore('scores').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function allOf(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function exportLibrary() {
  const [recordings, passages, folders, scores] = await Promise.all([
    listRecordings(), listPassages(), listFolders(), allScores(),
  ]);
  return {
    format: 'music-companion-backup',
    version: 1,
    exported: Date.now(),
    note: 'Practice history: notes, timing, landings, passages, folders and scores. Audio is not included.',
    recordings,
    passages,
    folders,
    scores,
  };
}

// Additive by design: a restore onto a device that has been practising must not
// throw away what is already there. Takes are matched on their date, which is
// the one thing about a recording that is already unique.
export async function importLibrary(backup) {
  if (backup?.format !== 'music-companion-backup') {
    throw new Error('that file is not a Practice Partner backup');
  }
  const db = await openDB();
  const existing = await listRecordings();
  const seen = new Set(existing.map((r) => r.date));
  const folders = await listFolders();
  const folderByName = new Map(folders.map((f) => [f.name, f.id]));

  let added = 0;
  for (const folder of backup.folders ?? []) {
    if (folderByName.has(folder.name)) continue;
    folderByName.set(folder.name, await createFolder(folder.name));
  }
  const oldFolderName = new Map((backup.folders ?? []).map((f) => [f.id, f.name]));

  // Same additive rule for scores, keyed on name and date together — two
  // people's arrangements of the same sonata are two different scores.
  const scores = await allScores();
  const scoreByKey = new Map(scores.map((s) => [`${s.name}|${s.date}`, s.id]));
  const scoreIdMap = new Map();
  for (const score of backup.scores ?? []) {
    const key = `${score.name}|${score.date}`;
    if (!scoreByKey.has(key)) {
      const { id, ...rest } = score;
      // eslint-disable-next-line no-await-in-loop
      scoreByKey.set(key, await saveScore(rest));
    }
    scoreIdMap.set(score.id, scoreByKey.get(key));
  }

  for (const rec of backup.recordings ?? []) {
    if (seen.has(rec.date)) continue;
    const { id, folderId, scoreId, ...rest } = rec;
    const mappedScore = scoreId != null ? scoreIdMap.get(scoreId) : undefined;
    const meta = mappedScore === undefined ? rest : { ...rest, scoreId: mappedScore };
    const mapped = folderId != null ? folderByName.get(oldFolderName.get(folderId)) : undefined;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      tx.objectStore('recordings').add(mapped ? { ...meta, folderId: mapped } : meta);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
    });
    added++;
  }
  return { added, skipped: (backup.recordings ?? []).length - added };
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
    // the row, not the decoded take: this loop runs over every old recording
    const data = await loadRecordingRow(r.id);
    r.noteStats ??= statsOf(data?.notes);
    r.landingStats ??= landingStats(data?.notes, data?.readings, data?.a4 ?? 440) ?? [];
    await new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite');
      tx.objectStore('recordings').put(r);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
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
    tx.onabort = () => reject(tx.error ?? new Error('the database stopped mid-write'));
  });
}
