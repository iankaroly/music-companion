import { startCapture } from './audio/capture.js';
import { Analyzer } from './audio/analyzer.js';
import { NoteSegmenter } from './analysis/notes.js';
import { Recorder } from './audio/recording.js';
import { Tuner } from './ui/tuner.js';
import { renderFreeReview, hideReport } from './ui/report.js';
import { saveRecording, listRecordings, loadRecording, deleteRecording } from './store/db.js';
import { startDrone, stopDrone, droneActive } from './audio/drone.js';
import { Metronome, tempoName } from './audio/metronome.js';
import { nameToMidi } from './analysis/note-utils.js';
import { intonationStatus } from './ui/chart-utils.js';

const tuner = new Tuner(document);
const startBtn = document.querySelector('#start');
const listenBtn = document.querySelector('#listen');
const statusEl = document.querySelector('#status');
const notesRow = document.querySelector('#notes-row');
const saveBar = document.querySelector('#save-bar');

const MAX_CHIPS = 24;

let capture = null;   // active mic session
let lastTake = null;  // finished recording awaiting save/discard

// --- tabs ------------------------------------------------------------------

const tabButtons = document.querySelectorAll('.tab-btn');
function showTab(name) {
  for (const btn of tabButtons) btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.id === `tab-${name}`);
  }
  localStorage.setItem('tab', name);
}
for (const btn of tabButtons) btn.addEventListener('click', () => showTab(btn.dataset.tab));
showTab(localStorage.getItem('tab') ?? 'tuner');

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
  if (droneActive()) startDrone(droneFrequency());
}
a4Input.addEventListener('input', applyA4);
a4Input.addEventListener('change', () => { a4Input.value = String(currentA4()); applyA4(); });
tuner.a4 = currentA4();

// --- drone -----------------------------------------------------------------

const droneNoteSel = document.querySelector('#drone-note');
const droneOctSel = document.querySelector('#drone-octave');
const droneBtn = document.querySelector('#drone-toggle');
for (const k of ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) {
  const opt = document.createElement('option');
  opt.value = opt.textContent = k;
  if (k === 'A') opt.selected = true;
  droneNoteSel.append(opt);
}

function droneFrequency() {
  const midi = nameToMidi(droneNoteSel.value + droneOctSel.value);
  return currentA4() * 2 ** ((midi - 69) / 12);
}

droneBtn.addEventListener('click', () => {
  if (droneActive()) {
    stopDrone();
    droneBtn.textContent = 'Play';
    droneBtn.classList.remove('active');
  } else {
    startDrone(droneFrequency());
    droneBtn.textContent = 'Stop';
    droneBtn.classList.add('active');
  }
});
for (const sel of [droneNoteSel, droneOctSel]) {
  sel.addEventListener('change', () => { if (droneActive()) startDrone(droneFrequency()); });
}

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
  if (capture) {
    capture.stop();
    capture = null;
  }
  startBtn.textContent = 'Record';
  listenBtn.textContent = 'Start tuner';
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
    feed(analyzer, segmenter, chunk, handleNote, readings, chord);
  });
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

// --- live tuner (listen only, no review) -----------------------------------

listenBtn.addEventListener('click', async () => {
  if (capture?.listen) {
    stopEverything();
    return;
  }
  stopEverything();
  try {
    capture = await beginCapture({ listen: true });
    listenBtn.textContent = 'Stop';
    statusEl.textContent = 'listening';
  } catch (err) {
    statusEl.textContent = `mic unavailable: ${err.message}`;
  }
});

// --- record → review → save or discard -------------------------------------

function clearTake() {
  lastTake = null;
  saveBar.hidden = true;
  hideReport(document);
  notesRow.replaceChildren();
}

startBtn.addEventListener('click', async () => {
  if (capture && !capture.listen) {
    // finish: flush, review, offer save/discard
    const { segmenter, chord, collected, recorder, readings } = capture;
    for (const note of segmenter.flush()) collected.push(note);
    for (const note of chord.segmenter.flush()) chord.onNote(note);
    stopEverything();
    if (collected.length === 0) {
      statusEl.textContent = 'nothing detected — recording discarded';
      return;
    }
    lastTake = { recorder, notes: collected, readings, a4: currentA4() };
    renderFreeReview(document, collected, recorder, { readings, a4: lastTake.a4 });
    saveBar.hidden = false;
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
    await saveRecording({
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
    refreshLibrary();
  } catch (err) {
    statusEl.textContent = `could not save: ${err.message}`;
  }
});

document.querySelector('#discard-rec').addEventListener('click', () => {
  clearTake();
  statusEl.textContent = 'recording discarded';
});

// --- library ---------------------------------------------------------------

const libraryList = document.querySelector('#library-list');
const libraryEmpty = document.querySelector('#library-empty');

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

async function refreshLibrary() {
  try {
    const recordings = await listRecordings();
    libraryEmpty.style.display = recordings.length ? 'none' : 'block';
    libraryList.replaceChildren();
    for (const r of recordings) {
      const li = document.createElement('li');
      li.className = 'lib-item';
      const meta = document.createElement('div');
      meta.className = 'lib-meta';
      meta.innerHTML = `<b>${formatWhen(r.date)}</b>${formatDuration(r.duration)} · ${r.noteCount} notes`;
      const actions = document.createElement('div');
      actions.className = 'lib-actions';
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', async () => {
        const data = await loadRecording(r.id);
        if (!data) return;
        clearTake();
        const rec = new Recorder(r.sampleRate);
        rec.push(new Float32Array(data.audio));
        showTab('analyze');
        renderFreeReview(document, data.notes, rec, { readings: data.readings, a4: data.a4 });
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await deleteRecording(r.id);
        refreshLibrary();
      });
      actions.append(openBtn, delBtn);
      li.append(meta, actions);
      libraryList.append(li);
    }
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
  metronome.bpm = Math.max(30, Math.min(240, Math.round(bpm)));
  bpmDisplay.textContent = String(metronome.bpm);
  tempoNameEl.textContent = tempoName(metronome.bpm);
  bpmSlider.value = String(metronome.bpm);
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

metroToggle.addEventListener('click', () => {
  if (metronome.running) {
    metronome.stop();
    metroToggle.textContent = 'Start';
    beatDots.querySelectorAll('.beat-dot').forEach((d) => d.classList.remove('on'));
  } else {
    metronome.start();
    metroToggle.textContent = 'Stop';
  }
});

setBpm(Number(localStorage.getItem('bpm') ?? 80));
beatsSelect.value = localStorage.getItem('beatsPerBar') ?? '4';
metronome.beatsPerBar = Number(beatsSelect.value);
rebuildBeatDots();
