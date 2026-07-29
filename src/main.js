import { startCapture, micIsHeld } from './audio/capture.js';
import { Analyzer } from './audio/analyzer.js';
import { NoteSegmenter } from './analysis/notes.js';
import { Recorder } from './audio/recording.js';
import { Tuner } from './ui/tuner.js';
import { renderFreeReview, hideReport } from './ui/report.js';
import {
  saveRecording, listRecordings, loadRecording, deleteRecording, renameRecording,
  createFolder, listFolders, renameFolder, deleteFolder, setRecordingFolder,
} from './store/db.js';
import { toggleDroneNote, retuneDrones, activeDroneNotes, setDroneTimbre } from './audio/drone.js';
import { encodeWav } from './audio/wav.js';
import { getVolume, setVolume } from './audio/context.js';
import { fftMagnitudes } from './audio/fft.js';
import { RingBuffer } from './audio/ring-buffer.js';
import { Metronome, tempoName } from './audio/metronome.js';
import { nameToMidi } from './analysis/note-utils.js';
import { intonationStatus } from './ui/chart-utils.js';
import { initLiquidTabs } from './ui/liquid-tabs.js';
import { initControls, actionMenu, toggleMenu, refreshRangeFill } from './ui/controls.js';
import { renderCoach } from './ui/coach.js';
import { initSettings } from './ui/settings.js';

initSettings(document); // theme first: the canvases read their colours from it

// Safari raises gesture events for any two-finger pinch — trackpad included —
// and zooming the whole app is never what's wanted here: the charts do their
// own zooming, and everything else is already sized for the screen. Skipped
// while the page is somehow already zoomed, so pinching out still works.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => {
    if ((window.visualViewport?.scale ?? 1) <= 1.01) e.preventDefault();
  }, { passive: false });
}

const tuner = new Tuner(document);
const startBtn = document.querySelector('#start');
const statusEl = document.querySelector('#status');
const notesRow = document.querySelector('#notes-row');
const saveBar = document.querySelector('#save-bar');

const MAX_CHIPS = 24;

let capture = null;       // active mic session
let lastTake = null;      // finished recording awaiting save/discard
let tunerStarting = false; // declared before tabs init — onShown fires during it

// --- tabs ------------------------------------------------------------------

const tabs = initLiquidTabs({
  nav: document.querySelector('nav[role="tablist"]'),
  panes: document.querySelector('#panes'),
  order: ['tuner', 'analyze', 'library', 'coach', 'metronome'],
  initial: localStorage.getItem('tab') ?? 'tuner',
  onShown: (name) => {
    localStorage.setItem('tab', name);
    if (name === 'coach') renderCoach(document); // fresh habits every visit
    // deferred a tick: the initial onShown fires while this module is still
    // initializing, and beginCapture reads consts declared further down
    if (name === 'tuner') queueMicrotask(autoStartTuner); // the tuner just runs here
    else autoStopTuner();
  },
});
const showTab = (name) => tabs.show(name);

// --- calibration -----------------------------------------------------------

const a4Input = document.querySelector('#a4');
a4Input.value = localStorage.getItem('a4') ?? '440';

function currentA4() {
  const v = Number(a4Input.value);
  return Number.isFinite(v) && v >= 400 && v <= 450 ? v : 440;
}

// Applied on every keystroke, not just committed changes — the drone and
// tuner must follow the calibration the moment it reads 442.
function applyA4() {
  const a4 = currentA4();
  localStorage.setItem('a4', String(a4));
  tuner.a4 = a4;
  if (capture?.segmenter) capture.segmenter.a4 = a4;
  if (capture?.chord) capture.chord.segmenter.a4 = a4;
  retuneDrones(droneFrequency);
}
a4Input.addEventListener('input', applyA4);
a4Input.addEventListener('change', () => { a4Input.value = String(currentA4()); applyA4(); });
tuner.a4 = currentA4();

// --- pitch pipe (chord-capable drone) ---------------------------------------

const PIPE_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const pitchPipe = document.querySelector('#pitch-pipe');
const droneOctSel = document.querySelector('#drone-octave');

function droneFrequency(name) {
  const midi = nameToMidi(name + droneOctSel.value);
  return currentA4() * 2 ** ((midi - 69) / 12);
}

for (const name of PIPE_NOTES) {
  const btn = document.createElement('button');
  btn.textContent = name;
  btn.addEventListener('click', () => {
    const on = toggleDroneNote(name, droneFrequency(name));
    btn.classList.toggle('active', on);
  });
  pitchPipe.append(btn);
}
droneOctSel.addEventListener('change', () => retuneDrones(droneFrequency));
const timbreSel = document.querySelector('#drone-timbre');
timbreSel.addEventListener('change', () => {
  setDroneTimbre(timbreSel.value);
  localStorage.setItem('timbre', timbreSel.value);
});
timbreSel.value = localStorage.getItem('timbre') ?? 'strings';
setDroneTimbre(timbreSel.value);

// --- tuner display: transposition & temperament ------------------------------

const transposeSel = document.querySelector('#transpose');
const temperamentSel = document.querySelector('#temperament');
const temperamentRootSel = document.querySelector('#temperament-root');
for (const name of PIPE_NOTES) {
  const opt = document.createElement('option');
  opt.value = String(PIPE_NOTES.indexOf(name));
  opt.textContent = `root ${name}`;
  temperamentRootSel.append(opt);
}
function applyTunerSettings() {
  tuner.transpose = Number(transposeSel.value);
  tuner.temperament = temperamentSel.value;
  tuner.temperamentRoot = Number(temperamentRootSel.value);
  localStorage.setItem('tunerSettings',
    JSON.stringify([transposeSel.value, temperamentSel.value, temperamentRootSel.value]));
}
for (const sel of [transposeSel, temperamentSel, temperamentRootSel]) {
  sel.addEventListener('change', applyTunerSettings);
}
try {
  const saved = JSON.parse(localStorage.getItem('tunerSettings'));
  if (saved) [transposeSel.value, temperamentSel.value, temperamentRootSel.value] = saved;
} catch { /* fresh install */ }
applyTunerSettings();

// --- volume ------------------------------------------------------------------

const volumeSlider = document.querySelector('#volume');
volumeSlider.value = String(getVolume());
volumeSlider.addEventListener('input', () => setVolume(Number(volumeSlider.value)));

// The settings sheet owns a second copy of some of these controls; it
// announces rather than reaching in, so everything that cares updates here.
document.addEventListener('settings-change', (e) => {
  if (e.detail?.key === 'volume') {
    volumeSlider.value = String(getVolume());
    refreshRangeFill(volumeSlider);
  }
  if (e.detail?.key === 'tolerance') tuner.refreshZones();
  if (e.detail?.key === 'library') refreshLibrary(); // a restore just landed
});

// --- shared display helpers ------------------------------------------------

function addNoteChip(note) {
  const chip = document.createElement('div');
  chip.className = note.chord ? 'note-chip chord' : 'note-chip';
  chip.dataset.state = intonationStatus(note.cents);
  const cents = `${note.cents >= 0 ? '+' : ''}${note.cents.toFixed(0)}`;
  chip.innerHTML = `${note.chord ? '+' : ''}${note.name}<small>${cents}¢</small>`;
  notesRow.append(chip);
  while (notesRow.children.length > MAX_CHIPS) notesRow.firstChild.remove();
}

function handleNote(note) {
  if (!capture?.listen) addNoteChip(note);
  capture?.collected?.push(note);
}

function feed(analyzer, segmenter, chunk, onNote = handleNote, readings = null, chord = null) {
  for (const reading of analyzer.push(chunk)) {
    tuner.update(reading);
    readings?.push(reading);
    for (const note of segmenter.push(reading)) onNote(note);
    if (chord) {
      // The second string of a double stop gets its own segmentation, so
      // chords land in the note boxes too.
      const sec = reading.secondary;
      const secReading = {
        frequency: sec?.frequency ?? null,
        confidence: sec?.confidence ?? 0,
        rms: reading.rms,
        time: reading.time,
      };
      for (const note of chord.segmenter.push(secReading)) chord.onNote(note);
    }
  }
}

function stopEverything() {
  stopSpectrum();
  if (capture) {
    capture.stop();
    capture = null;
  }
  startBtn.textContent = 'Record';
  statusEl.textContent = '';
  tuner.update({ frequency: null, confidence: 0, rms: 0 });
}

async function beginCapture(extra = {}) {
  let analyzer = null;
  let recorder = null;
  const readings = [];
  const segmenter = new NoteSegmenter({ a4: currentA4() });
  const chord = {
    segmenter: new NoteSegmenter({ a4: currentA4(), minDuration: 0.12 }),
    onNote: (note) => { note.chord = true; handleNote(note); },
  };
  const session = await startCapture((chunk) => {
    recorder?.push(chunk);
    spectrumRing.write(chunk);
    feed(analyzer, segmenter, chunk, handleNote, readings, chord);
  }, {
    // A phone call mid-take used to truncate it in silence while the button
    // still said "Stop & review". Now the take is closed off and offered for
    // review with what was actually captured, and the reason is said out loud.
    onInterrupted: (reason) => {
      if (!capture) return;
      if (capture.listen) { stopEverything(); showListenButton(true); }
      else finishRecording(`${reason} — here's the take up to that point`);
      statusEl.textContent = reason;
    },
  });
  startSpectrum();
  // Fine 11.6ms hop for fast passages; the long window plus a fast
  // sub-window keeps double-stop detection AND fast mono tracking.
  analyzer = new Analyzer(session.sampleRate, { dual: true, hopSize: 512 });
  recorder = new Recorder(session.sampleRate);
  session.segmenter = segmenter;
  session.chord = chord;
  session.recorder = recorder;
  session.readings = readings;
  Object.assign(session, extra);
  return session;
}

// --- live tuner: runs while the tuner tab is open ----------------------------
//
// It used to start itself the moment the app opened, which meant the browser's
// microphone prompt was the first thing you saw on every launch — and on iOS
// Safari a permission granted to a plain web page doesn't survive the page
// being closed, so "every launch" was literal. Nothing here can persist that
// grant; what it can do is stop asking unbidden. So: if the browser already
// holds the permission we start silently, and if it doesn't, the tuner waits
// behind a button and the prompt arrives when you ask for it.

const listenBtn = document.querySelector('#tuner-listen');
let micGranted = null; // null = not asked the browser yet

async function permissionGranted() {
  if (micGranted !== null) return micGranted;
  try {
    // Not in every browser, and 'microphone' is not in every implementation
    // that does have it — an unknown name rejects, which reads as "ask first".
    const status = await navigator.permissions.query({ name: 'microphone' });
    micGranted = status.state === 'granted';
    status.onchange = () => { micGranted = status.state === 'granted'; };
  } catch {
    micGranted = false;
  }
  return micGranted;
}

function showListenButton(show) {
  listenBtn.hidden = !show;
  if (show) document.querySelector('#cents').textContent = '';
}

async function startTuner() {
  if (capture || tunerStarting) return;
  tunerStarting = true;
  showListenButton(false);
  document.querySelector('#cents').textContent = 'listening';
  try {
    capture = await beginCapture({ listen: true });
    micGranted = true; // whatever the Permissions API said, we have it now
  } catch (err) {
    statusEl.textContent = `mic unavailable: ${err.message}`;
    showListenButton(true);
  } finally {
    tunerStarting = false;
  }
  // the user may have left the tab while the mic was being granted
  if (capture?.listen && tabs.current !== 'tuner') stopEverything();
}

async function autoStartTuner() {
  // an active recording already feeds the tuner display — don't touch it
  if (capture || tunerStarting) return;
  // Already granted, or already granted earlier in this visit (the parked
  // stream in capture.js means restarting costs nothing): just listen.
  if (micIsHeld() || await permissionGranted()) startTuner();
  else showListenButton(true);
}

function autoStopTuner() {
  if (capture?.listen) stopEverything();
}

listenBtn.addEventListener('click', startTuner);

// --- record → review → save or discard -------------------------------------

function clearTake() {
  lastTake = null;
  saveBar.hidden = true;
  hideReport(document);
  notesRow.replaceChildren();
}

// Close off the take and put the review up. Shared by the Stop button and by
// an interruption, which has to leave the player with what they played rather
// than with a screen that still claims to be recording.
function finishRecording(note = null) {
  if (!capture || capture.listen) return;
  const { segmenter, chord, collected, recorder, readings } = capture;
  for (const n of segmenter.flush()) collected.push(n);
  for (const n of chord.segmenter.flush()) chord.onNote(n);
  stopEverything();
  if (collected.length === 0) {
    statusEl.textContent = note ?? 'nothing detected — recording discarded';
    return;
  }
  lastTake = { recorder, notes: collected, readings, a4: currentA4() };
  notesRow.replaceChildren(); // chips are redundant once the review is up
  renderFreeReview(document, collected, recorder, { readings, a4: lastTake.a4 });
  saveBar.hidden = false;
  if (note) statusEl.textContent = note;
}

startBtn.addEventListener('click', async () => {
  if (capture && !capture.listen) {
    finishRecording();
    return;
  }
  stopEverything();
  clearTake();
  try {
    capture = await beginCapture({ collected: [] });
    startBtn.textContent = 'Stop & review';
    statusEl.textContent = 'recording';
  } catch (err) {
    statusEl.textContent = `mic unavailable: ${err.message}`;
  }
});

document.querySelector('#save-rec').addEventListener('click', async () => {
  if (!lastTake) return;
  const { recorder, notes, readings, a4 } = lastTake;
  try {
    const id = await saveRecording({
      date: Date.now(),
      duration: recorder.duration,
      sampleRate: recorder.sampleRate,
      audio: recorder.extract(0, recorder.duration).buffer,
      notes,
      readings,
      a4,
    });
    saveBar.hidden = true;
    lastTake = null;
    statusEl.textContent = 'saved to library';
    // Re-render the same review now that the take has an id, so passages can
    // be marked without reopening it from the library.
    renderFreeReview(document, notes, recorder, { readings, a4, recordingId: id });
    refreshLibrary();
  } catch (err) {
    statusEl.textContent = `could not save: ${err.message}`;
  }
});

document.querySelector('#discard-rec').addEventListener('click', () => {
  clearTake();
  statusEl.textContent = 'recording discarded';
});

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// A filename someone else can make sense of when it lands in their downloads.
function takeFilename(name, when, extension) {
  const stamp = new Date(when).toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const safe = String(name ?? '').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 40);
  return `${safe ? `${safe}-` : ''}${stamp}.${extension}`;
}

function downloadWav(samples, sampleRate, name, when) {
  saveBlob(new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' }),
    takeFilename(name, when, 'wav'));
}

// Send a take to a teacher.
//
// Playing something and having someone hear it is the whole point of a practice
// recording, and until now a take could only leave the app as a file you then
// had to find. The share sheet puts it into Messages or Mail in two taps; where
// there is no share sheet (desktop) it falls back to a download.
async function shareTake(r) {
  const data = await loadRecording(r.id);
  if (!data) return;
  const samples = data.samples ?? new Float32Array(data.audio);
  const rate = data.sampleRate ?? r.sampleRate;
  const filename = takeFilename(r.name, r.date, 'wav');
  const file = new File([encodeWav(samples, rate)], filename, { type: 'audio/wav' });
  const title = r.name || 'Practice take';
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${title} — ${formatDuration(r.duration)}` });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // they changed their mind
    }
  }
  downloadWav(samples, rate, r.name, r.date);
  statusEl.textContent = 'saved as a WAV file';
}

// --- library ---------------------------------------------------------------

const libraryList = document.querySelector('#library-list');
const libraryEmpty = document.querySelector('#library-empty');
const renameDialog = document.querySelector('#rename-dialog');
const renameInput = document.querySelector('#rename-input');
let renameId = null;

renameDialog.addEventListener('close', async () => {
  if (renameDialog.returnValue !== 'save' || renameId === null) return;
  await renameRecording(renameId, renameInput.value.trim());
  renameId = null;
  refreshLibrary();
});

function formatWhen(date) {
  return new Date(date).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function openRecording(r) {
  const data = await loadRecording(r.id);
  if (!data) return;
  clearTake();
  // The decoded rate, not the rate it was captured at — compressed takes come
  // back at the codec's own rate. Everything downstream is in seconds, so the
  // note and reading times still line up.
  const rec = new Recorder(data.sampleRate ?? r.sampleRate);
  rec.push(data.samples ?? new Float32Array(data.audio));
  showTab('analyze');
  renderFreeReview(document, data.notes, rec, {
    readings: data.readings, a4: data.a4, recordingId: r.id,
  });
}

// --- folders ---------------------------------------------------------------
//
// A folder here is a label on a take, not a place a file was moved to: the
// library shows folders first, opening one filters the list to its takes, and
// deleting one only removes the label. Named by piece, it's how a player finds
// "every attempt at the Elgar" without scrolling a month of dates.

let openFolder = null;   // folder id, or null for the top level
let folders = [];
const folderDialog = document.querySelector('#folder-dialog');
const folderInput = document.querySelector('#folder-name');
let folderPending = null; // { mode: 'create' | 'rename', id, then }

folderDialog.addEventListener('close', async () => {
  const pending = folderPending;
  folderPending = null;
  const name = folderInput.value.trim();
  if (folderDialog.returnValue !== 'save' || !name || !pending) return;
  if (pending.mode === 'rename') await renameFolder(pending.id, name);
  else {
    const id = await createFolder(name);
    await pending.then?.(id);
  }
  refreshLibrary();
});

function askFolderName(mode, { id = null, current = '', then = null } = {}) {
  folderPending = { mode, id, then };
  folderInput.value = current;
  document.querySelector('#folder-dialog h2').textContent =
    mode === 'rename' ? 'Rename this folder' : 'Name this folder';
  folderDialog.showModal();
}

function moveMenu(button, r) {
  const rows = folders
    .filter((f) => f.id !== r.folderId)
    .map((f) => ({
      label: f.name,
      onPick: async () => { await setRecordingFolder(r.id, f.id); refreshLibrary(); },
    }));
  rows.push({
    label: '＋ New folder…',
    onPick: () => askFolderName('create', {
      then: (id) => setRecordingFolder(r.id, id),
    }),
  });
  if (r.folderId !== undefined && r.folderId !== null) {
    rows.push({
      label: 'Take out of folder',
      onPick: async () => { await setRecordingFolder(r.id, null); refreshLibrary(); },
    });
  }
  actionMenu(button, rows);
}

function folderRow(folder, count) {
  const li = document.createElement('li');
  li.className = 'lib-item';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const icon = document.createElement('span');
  icon.className = 'lib-folder';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h9A1.5 1.5 0 0 1 21 9.7v8.8A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = folder.name;
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  sub.textContent = `${count} ${count === 1 ? 'take' : 'takes'}`;
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(icon, text, chev);
  open.addEventListener('click', () => { openFolder = folder.id; refreshLibrary(); });

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'lib-more';
  more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-label', `More actions for the folder ${folder.name}`);
  more.addEventListener('click', () => actionMenu(more, [
    {
      label: 'Rename',
      onPick: () => askFolderName('rename', { id: folder.id, current: folder.name }),
    },
    {
      label: 'Delete folder',
      danger: true,
      onPick: async () => {
        await deleteFolder(folder.id);
        if (openFolder === folder.id) openFolder = null;
        statusEl.textContent = 'folder deleted — its takes are back in the library';
        refreshLibrary();
      },
    },
  ]));

  li.append(open, more);
  return li;
}

// One library row: the row itself opens the take, so the name gets the width
// it deserves and the rarer actions sit behind ⋯.
function libraryRow(r) {
  const li = document.createElement('li');
  li.className = 'lib-item';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = r.name || formatWhen(r.date);
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  sub.textContent = r.name
    ? `${formatWhen(r.date)} · ${formatDuration(r.duration)} · ${r.noteCount} notes`
    : `${formatDuration(r.duration)} · ${r.noteCount} notes`;
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(text, chev);
  open.addEventListener('click', () => openRecording(r));

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'lib-more';
  more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-label', `More actions for ${r.name || formatWhen(r.date)}`);
  more.addEventListener('click', () => actionMenu(more, [
    {
      label: 'Rename',
      onPick: () => {
        renameId = r.id;
        renameInput.value = r.name ?? '';
        renameDialog.showModal();
      },
    },
    {
      label: 'Share…',
      onPick: () => shareTake(r),
    },
    {
      label: 'Move to folder…',
      onPick: () => moveMenu(more, r),
    },
    {
      label: 'Download WAV',
      onPick: async () => {
        const data = await loadRecording(r.id);
        if (data) {
          downloadWav(data.samples ?? new Float32Array(data.audio),
            data.sampleRate ?? r.sampleRate, r.name ?? r.date, r.date);
        }
      },
    },
    {
      label: 'Delete',
      danger: true,
      onPick: async () => {
        await deleteRecording(r.id);
        refreshLibrary();
      },
    },
  ]));

  li.append(open, more);
  return li;
}

const libraryBack = document.querySelector('#library-back');
const libraryTitle = document.querySelector('#library-title');

libraryBack.addEventListener('click', () => { openFolder = null; refreshLibrary(); });
document.querySelector('#new-folder').addEventListener('click', () => askFolderName('create'));

async function refreshLibrary() {
  try {
    const [recordings, allFolders] = await Promise.all([listRecordings(), listFolders()]);
    folders = allFolders;
    // A folder deleted in another tab shouldn't leave this one inside it.
    if (openFolder !== null && !folders.some((f) => f.id === openFolder)) openFolder = null;

    const inFolder = openFolder !== null;
    libraryBack.hidden = !inFolder;
    libraryTitle.textContent = inFolder
      ? folders.find((f) => f.id === openFolder)?.name ?? 'Folder'
      : 'Library';

    const shown = inFolder
      ? recordings.filter((r) => r.folderId === openFolder)
      : recordings.filter((r) => r.folderId === undefined || r.folderId === null);

    libraryList.replaceChildren();
    if (!inFolder) {
      const counts = new Map();
      for (const r of recordings) {
        if (r.folderId != null) counts.set(r.folderId, (counts.get(r.folderId) ?? 0) + 1);
      }
      for (const f of folders) libraryList.append(folderRow(f, counts.get(f.id) ?? 0));
    }
    for (const r of shown) libraryList.append(libraryRow(r));

    libraryEmpty.style.display = libraryList.children.length ? 'none' : 'block';
    libraryEmpty.textContent = inFolder
      ? 'Nothing in this folder yet — move a take in from ⋯'
      : 'Nothing here yet — record a take and save it 🎶';
  } catch { /* blocked IndexedDB — library stays empty */ }
}
refreshLibrary();

// --- metronome -------------------------------------------------------------

const bpmDisplay = document.querySelector('#bpm-display');
const tempoNameEl = document.querySelector('#tempo-name');
const bpmSlider = document.querySelector('#bpm-slider');
const beatsSelect = document.querySelector('#beats-per-bar');
const beatDots = document.querySelector('#beat-dots');
const metroToggle = document.querySelector('#metro-toggle');

const metronome = new Metronome((beat) => {
  beatDots.querySelectorAll('.beat-dot').forEach((dot, i) => {
    dot.classList.toggle('on', i === beat);
  });
});

function setBpm(bpm) {
  metronome.bpm = Math.max(20, Math.min(260, Math.round(bpm)));
  bpmDisplay.textContent = String(metronome.bpm);
  tempoNameEl.textContent = tempoName(metronome.bpm);
  bpmSlider.value = String(metronome.bpm);
  refreshRangeFill(bpmSlider); // tap tempo and the trainer move it from code
  localStorage.setItem('bpm', String(metronome.bpm));
}

function rebuildBeatDots() {
  beatDots.replaceChildren();
  for (let i = 0; i < metronome.beatsPerBar; i++) {
    const dot = document.createElement('div');
    dot.className = i === 0 ? 'beat-dot downbeat' : 'beat-dot';
    beatDots.append(dot);
  }
}

bpmSlider.addEventListener('input', () => setBpm(Number(bpmSlider.value)));
document.querySelector('#bpm-down').addEventListener('click', () => setBpm(metronome.bpm - 2));
document.querySelector('#bpm-up').addEventListener('click', () => setBpm(metronome.bpm + 2));

beatsSelect.addEventListener('change', () => {
  metronome.beatsPerBar = Number(beatsSelect.value);
  localStorage.setItem('beatsPerBar', beatsSelect.value);
  rebuildBeatDots();
});

const taps = [];
document.querySelector('#tap-tempo').addEventListener('click', () => {
  const now = performance.now();
  if (taps.length && now - taps.at(-1) > 3000) taps.length = 0;
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length >= 2) {
    const intervals = taps.slice(1).map((t, i) => t - taps[i]);
    setBpm(60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length));
  }
});

// subdivisions, downbeat accent, practice timer (iMusic-School-style)
const subdivisionSel = document.querySelector('#subdivision');
subdivisionSel.addEventListener('change', () => {
  metronome.subdivision = subdivisionSel.value;
  localStorage.setItem('subdivision', subdivisionSel.value);
});
subdivisionSel.value = localStorage.getItem('subdivision') ?? 'quarter';
metronome.subdivision = subdivisionSel.value;

const accentBtn = document.querySelector('#accent-toggle');
accentBtn.addEventListener('click', () => {
  metronome.accentFirst = !metronome.accentFirst;
  accentBtn.classList.toggle('active', metronome.accentFirst);
});

const timerSel = document.querySelector('#timer-mins');
const timerDisplay = document.querySelector('#timer-display');
let timerInterval = null;
let timerEnd = 0;

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerDisplay.textContent = '';
}

function startTimer(minutes) {
  timerEnd = Date.now() + minutes * 60000;
  const tick = () => {
    const left = Math.max(0, timerEnd - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    timerDisplay.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (left === 0) stopMetronome();
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

function stopMetronome() {
  metronome.stop();
  metroToggle.textContent = 'Start';
  beatDots.querySelectorAll('.beat-dot').forEach((d) => d.classList.remove('on'));
  stopTimer();
}

metroToggle.addEventListener('click', () => {
  if (metronome.running) {
    stopMetronome();
  } else {
    metronome.start();
    metroToggle.textContent = 'Stop';
    const minutes = Number(timerSel.value);
    if (minutes > 0) startTimer(minutes);
  }
});

// Backgrounding stops the metronome rather than letting it fall apart.
//
// The scheduler tops up a 120 ms lookahead from a 25 ms setInterval, and a
// backgrounded web view throttles timers to seconds — so the click doesn't keep
// time in the background, it drifts and then stalls. Scheduling far enough
// ahead to survive that would mean minutes of clicks committed to the audio
// clock, which then can't respond to the tempo slider. Stopping is the honest
// behaviour, and it also means the app never sits on the lock screen ticking.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && metronome.running) {
    stopMetronome();
    statusEl.textContent = 'metronome stopped when the app went to the background';
  }
});

setBpm(Number(localStorage.getItem('bpm') ?? 80));
beatsSelect.value = localStorage.getItem('beatsPerBar') ?? '4';
metronome.beatsPerBar = Number(beatsSelect.value);
rebuildBeatDots();


// --- live spectrum (hand-rolled FFT) -----------------------------------------

const spectrumRing = new RingBuffer(2048);
const spectrumCanvas = document.querySelector('#spectrum');
let spectrumFrame = 0;

function drawSpectrum() {
  const dpr = window.devicePixelRatio || 1;
  const w = spectrumCanvas.clientWidth;
  const h = spectrumCanvas.clientHeight;
  if (spectrumCanvas.width !== w * dpr) {
    spectrumCanvas.width = w * dpr;
    spectrumCanvas.height = h * dpr;
  }
  const ctx = spectrumCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (vizMode === 'wave') {
    const wave = spectrumRing.latest(1024);
    ctx.strokeStyle = '#6d4ef6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = (i / wave.length) * w;
      const y = h / 2 - wave[i] * (h / 2 - 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    spectrumFrame = requestAnimationFrame(drawSpectrum);
    return;
  }

  const windowed = spectrumRing.latest(2048);
  for (let i = 0; i < windowed.length; i++) {
    windowed[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowed.length - 1)));
  }
  const mags = fftMagnitudes(windowed);
  const sr = capture?.sampleRate ?? 44100;
  const maxBin = Math.min(mags.length - 1, Math.ceil(2200 / (sr / 2048)));
  const bars = 56;
  const barW = w / bars;
  ctx.fillStyle = '#6d4ef6';
  for (let b = 0; b < bars; b++) {
    const bin = 1 + Math.floor((b / bars) * maxBin);
    const mag = Math.min(1, mags[bin] * 14);
    const barH = Math.max(1, mag * (h - 2));
    ctx.globalAlpha = 0.25 + 0.75 * mag;
    ctx.fillRect(b * barW + 1, h - barH, barW - 2, barH);
  }
  ctx.globalAlpha = 1;
  spectrumFrame = requestAnimationFrame(drawSpectrum);
}

function startSpectrum() {
  cancelAnimationFrame(spectrumFrame);
  spectrumFrame = requestAnimationFrame(drawSpectrum);
}

function stopSpectrum() {
  cancelAnimationFrame(spectrumFrame);
  spectrumCanvas?.getContext('2d').clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
}

// --- metronome tempo trainer wiring ------------------------------------------

const trainerStepSel = document.querySelector('#trainer-step');
const trainerBarsSel = document.querySelector('#trainer-bars');
function applyTrainer() {
  metronome.trainerStep = Number(trainerStepSel.value);
  metronome.trainerBars = Number(trainerBarsSel.value);
  localStorage.setItem('trainer', JSON.stringify([trainerStepSel.value, trainerBarsSel.value]));
}
trainerStepSel.addEventListener('change', applyTrainer);
trainerBarsSel.addEventListener('change', applyTrainer);
try {
  const savedTrainer = JSON.parse(localStorage.getItem('trainer'));
  if (savedTrainer) [trainerStepSel.value, trainerBarsSel.value] = savedTrainer;
} catch { /* fresh install */ }
applyTrainer();
metronome.onTempo = (bpm) => setBpm(bpm);


// --- spectrum / waveform toggle ----------------------------------------------

let vizMode = localStorage.getItem('vizMode') ?? 'spectrum';
for (const btn of document.querySelectorAll('#viz-toggle button')) {
  btn.classList.toggle('active', btn.dataset.viz === vizMode);
  btn.addEventListener('click', () => {
    vizMode = btn.dataset.viz;
    localStorage.setItem('vizMode', vizMode);
    for (const b of document.querySelectorAll('#viz-toggle button')) {
      b.classList.toggle('active', b === btn);
    }
  });
}

// --- presets: named snapshots of every setting --------------------------------

// What a named setup is made of. The levels and the in-tune tolerance belong
// here — they're part of "how I have this set for the cello" — while the
// microphone, screen and timing-pulse preferences are about the device and the
// take in front of you, not the instrument, so they stay out.
const PRESET_KEYS = ['a4', 'volume', 'droneLevel', 'clickLevel', 'tolerance',
  'tunerSettings', 'timbre', 'bpm', 'beatsPerBar', 'subdivision', 'trainer', 'vizMode'];
const presetSel = document.querySelector('#preset-list');

function refreshPresets() {
  const presets = JSON.parse(localStorage.getItem('presets') ?? '{}');
  presetSel.replaceChildren(new Option('presets…', ''));
  for (const name of Object.keys(presets)) presetSel.append(new Option(name, name));
}

const presetDialog = document.querySelector('#preset-dialog');
const presetName = document.querySelector('#preset-name');

document.querySelector('#preset-save').addEventListener('click', () => {
  presetName.value = '';
  presetDialog.showModal();
});

presetDialog.addEventListener('close', () => {
  const name = presetName.value.trim();
  if (presetDialog.returnValue !== 'save' || !name) return;
  const presets = JSON.parse(localStorage.getItem('presets') ?? '{}');
  presets[name] = Object.fromEntries(
    PRESET_KEYS.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null));
  localStorage.setItem('presets', JSON.stringify(presets));
  refreshPresets();
  presetSel.value = name;
  presetSel.dispatchEvent(new Event('refresh-label'));
});

presetSel.addEventListener('change', () => {
  if (!presetSel.value) return;
  const presets = JSON.parse(localStorage.getItem('presets') ?? '{}');
  const preset = presets[presetSel.value];
  if (!preset) return;
  for (const [k, v] of Object.entries(preset)) localStorage.setItem(k, v);
  location.reload(); // simplest way to apply every setting consistently
});
refreshPresets();

// --- free drone: any note, layered over whatever else is sounding --------------

// One button: tapping it opens the note grid, and tapping notes there stacks
// them up as drones. Any number can sound at once, so a chord to play against
// is a few taps rather than a control each.
const anyDroneBtn = document.querySelector('#any-drone');
const FREE = 'free-'; // key prefix, so these voices are told apart from the pipe's

const freeDroneNames = () =>
  [...activeDroneNotes()].filter((k) => k.startsWith(FREE)).map((k) => k.slice(FREE.length));

function refreshDroneButton() {
  const on = freeDroneNames();
  anyDroneBtn.textContent = on.length ? `Drone · ${on.join(' ')}` : 'Drone';
  anyDroneBtn.classList.toggle('active', on.length > 0);
}

function freeDroneFrequency(name) {
  return currentA4() * 2 ** ((nameToMidi(name) - 69) / 12);
}

anyDroneBtn.addEventListener('click', () => {
  const sounding = new Set(freeDroneNames());
  const rows = [];
  for (let oct = 2; oct <= 5; oct++) {
    for (const name of PIPE_NOTES) {
      const full = `${name}${oct}`;
      rows.push({
        label: full,
        on: sounding.has(full),
        onPick: () => {
          const nowOn = toggleDroneNote(FREE + full, freeDroneFrequency(full));
          if (nowOn) {
            sounding.add(full);
            localStorage.setItem('anyDrone', full); // remembered as the default
          } else {
            sounding.delete(full);
          }
          refreshDroneButton();
        },
      });
    }
  }
  toggleMenu(anyDroneBtn, () => rows.map((r) => ({ ...r, on: sounding.has(r.label) })), { columns: true });
});
refreshDroneButton();

// --- custom pickers replace every native select --------------------------------

initControls(document);

// --- installable app: register the service worker -----------------------------

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
