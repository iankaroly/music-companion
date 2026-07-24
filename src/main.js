import { startCapture } from './audio/capture.js';
import { Analyzer } from './audio/analyzer.js';
import { NoteSegmenter } from './analysis/notes.js';
import { Recorder } from './audio/recording.js';
import { buildScale } from './analysis/scales.js';
import { bestAlignment } from './analysis/scoring.js';
import { avgAbsCents, tempoStats } from './analysis/scoring.js';
import { Tuner } from './ui/tuner.js';
import { renderReport, renderFreeReview, hideReport } from './ui/report.js';
import { renderHistory } from './ui/history.js';
import { saveSession, listSessions } from './store/db.js';
import { startDrone, stopDrone, droneActive } from './audio/drone.js';
import { Metronome, tempoName } from './audio/metronome.js';
import { nameToMidi } from './analysis/note-utils.js';
import { intonationStatus } from './ui/chart-utils.js';

const tuner = new Tuner(document);
const startBtn = document.querySelector('#start');
const listenBtn = document.querySelector('#listen');
const demoBtn = document.querySelector('#demo');
const statusEl = document.querySelector('#status');
const notesRow = document.querySelector('#notes-row');
const scaleStartBtn = document.querySelector('#scale-start');
const scaleDemoBtn = document.querySelector('#scale-demo');

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

const MAX_CHIPS = 24;

let capture = null;      // active mic session { stop, segmenter, scale? , collected? }
let demoTimer = null;

// --- calibration -----------------------------------------------------------

const a4Input = document.querySelector('#a4');
a4Input.value = localStorage.getItem('a4') ?? '440';

function currentA4() {
  const v = Number(a4Input.value);
  return Number.isFinite(v) && v >= 400 && v <= 450 ? v : 440;
}

a4Input.addEventListener('change', () => {
  const a4 = currentA4();
  a4Input.value = String(a4);
  localStorage.setItem('a4', String(a4));
  tuner.a4 = a4;
  if (capture?.segmenter) capture.segmenter.a4 = a4;
  if (droneActive()) startDrone(droneFrequency());
});
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

// --- scale picker ----------------------------------------------------------

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const keySelect = document.querySelector('#key');
for (const k of KEYS) {
  const opt = document.createElement('option');
  opt.value = opt.textContent = k;
  if (k === 'D') opt.selected = true;
  keySelect.append(opt);
}

// What to practice — the register is detected from the playing, not chosen.
function currentSpec() {
  return {
    key: keySelect.value,
    type: document.querySelector('#scale-type').value,
    octaves: Number(document.querySelector('#scale-octaves').value),
  };
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
  stopDemo();
  if (capture) {
    capture.stop();
    capture = null;
  }
  startBtn.textContent = 'Record';
  listenBtn.textContent = 'Start tuner';
  scaleStartBtn.textContent = 'Start scale';
  statusEl.textContent = '';
  tuner.update({ frequency: null, confidence: 0, rms: 0 });
}

async function beginCapture(extra = {}) {
  let analyzer = null;
  let recorder = null;
  const readings = [];
  const segmenter = new NoteSegmenter({ a4: currentA4() });
  // Free play listens for double stops (scale mode stays monophonic for
  // clean alignment data) and segments the second string as chord notes.
  const chord = extra.scale ? null : {
    segmenter: new NoteSegmenter({ a4: currentA4(), minDuration: 0.12 }),
    onNote: (note) => { note.chord = true; handleNote(note); },
  };
  const session = await startCapture((chunk) => {
    recorder?.push(chunk);
    feed(analyzer, segmenter, chunk, handleNote, readings, chord);
  });
  // Fine 11.6ms hop for fast passages. Scale mode also shortens the
  // analysis window (mono tracking responds faster); free play keeps the
  // long window for double-stop detection and uses its fast sub-window
  // for mono runs.
  analyzer = extra.scale
    ? new Analyzer(session.sampleRate, { windowSize: 2048, hopSize: 512 })
    : new Analyzer(session.sampleRate, { dual: true, hopSize: 512 });
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

// --- record & review -------------------------------------------------------

startBtn.addEventListener('click', async () => {
  if (capture && !capture.scale && !capture.listen) {
    // finish free play: review everything played, with replay
    const { segmenter, chord, collected, recorder, readings } = capture;
    for (const note of segmenter.flush()) collected.push(note);
    for (const note of chord?.segmenter.flush() ?? []) chord.onNote(note);
    stopEverything();
    if (collected.length > 0) {
      renderFreeReview(document, collected, recorder, { readings, a4: currentA4() });
    }
    return;
  }
  stopEverything();
  hideReport(document);
  try {
    notesRow.replaceChildren();
    capture = await beginCapture({ collected: [] });
    startBtn.textContent = 'Stop & review';
    statusEl.textContent = 'recording';
  } catch (err) {
    statusEl.textContent = `mic unavailable: ${err.message}`;
  }
});

// --- scale practice --------------------------------------------------------

scaleStartBtn.addEventListener('click', async () => {
  if (capture?.scale) {
    // finish: flush the last note, detect the register, align, report
    const { segmenter, scale, collected, recorder, readings } = capture;
    for (const note of segmenter.flush()) collected.push(note);
    stopEverything();
    const best = bestAlignment(scale, collected);
    if (best) {
      renderReport(document, best, recorder, { readings, a4: currentA4() });
      recordSession(scale, best);
    } else {
      statusEl.textContent = 'no notes detected — try again closer to the mic';
    }
    return;
  }
  stopEverything();
  hideReport(document);
  try {
    notesRow.replaceChildren();
    capture = await beginCapture({ scale: currentSpec(), collected: [] });
    scaleStartBtn.textContent = 'Finish scale';
    statusEl.textContent = 'play the scale, then press finish';
  } catch (err) {
    statusEl.textContent = `mic unavailable: ${err.message}`;
  }
});

// Demo scale: synthesizes the selected scale through the real pipeline —
// one degree deliberately 25 cents sharp so the report has something to
// catch. Runs instantly; no mic or instrument needed.
scaleDemoBtn.addEventListener('click', () => {
  stopEverything();
  hideReport(document);
  notesRow.replaceChildren();

  const sr = 44100;
  const a4 = currentA4();
  const spec = currentSpec();
  const scale = buildScale({ tonic: `${spec.key}3`, type: spec.type, octaves: spec.octaves });
  const analyzer = new Analyzer(sr);
  const segmenter = new NoteSegmenter({ a4 });
  const collected = [];
  const demoReadings = [];
  const onNote = (note) => { addNoteChip(note); collected.push(note); };

  const SHARP_DEGREE = 3, SHARP_CENTS = 25;
  const samples = [];
  scale.forEach((midi, idx) => {
    let freq = a4 * 2 ** ((midi - 69) / 12);
    if (idx === SHARP_DEGREE) freq *= 2 ** (SHARP_CENTS / 1200);
    const n = Math.floor(0.35 * sr);
    const startSample = samples.length;
    for (let i = 0; i < n; i++) {
      const t = (startSample + i) / sr;
      let v = 0;
      for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * freq * h * t) / h;
      samples.push(v * 0.3);
    }
    for (let i = 0; i < Math.floor(0.12 * sr); i++) samples.push(0);
  });

  const audio = Float32Array.from(samples);
  const recorder = new Recorder(sr);
  recorder.push(audio);
  for (let i = 0; i < audio.length; i += 2048) {
    feed(analyzer, segmenter, audio.subarray(i, i + 2048), onNote, demoReadings);
  }
  for (const note of segmenter.flush()) onNote(note);

  const best = bestAlignment(spec, collected);
  if (best) renderReport(document, best, recorder, { readings: demoReadings, a4 });
  statusEl.textContent = `demo: ${spec.key} ${spec.type}, degree ${SHARP_DEGREE + 1} played sharp on purpose`;
});

// --- session history -------------------------------------------------------

function specKey(spec) {
  return `${spec.key} ${spec.type} ×${spec.octaves}`;
}

async function refreshHistory() {
  try {
    renderHistory(document, await listSessions(), specKey(currentSpec()));
  } catch { /* private browsing or blocked IndexedDB — history just stays hidden */ }
}

async function recordSession(spec, alignment) {
  const onsets = alignment.degrees.filter((d) => d.played).map((d) => d.played.start);
  const tempo = tempoStats(onsets);
  try {
    await saveSession({
      date: Date.now(),
      specKey: specKey(spec),
      tonic: alignment.tonic,
      matched: alignment.matched,
      total: alignment.degrees.length,
      avgAbsCents: avgAbsCents(alignment.degrees),
      evenness: tempo?.evenness ?? null,
      bpm: tempo?.bpm ?? null,
    });
  } catch { /* same: history is best-effort */ }
  refreshHistory();
}

for (const sel of ['#key', '#scale-type', '#scale-octaves']) {
  document.querySelector(sel).addEventListener('change', refreshHistory);
}
refreshHistory();

// --- open-strings demo tone ------------------------------------------------

const OPEN_STRINGS = [65.41, 98.0, 146.83, 220.0];
const STRING_NAMES = ['C', 'G', 'D', 'A'];

demoBtn.addEventListener('click', () => {
  if (demoTimer) {
    stopDemo();
    statusEl.textContent = '';
    tuner.update({ frequency: null, confidence: 0, rms: 0 });
    return;
  }
  stopEverything();
  hideReport(document);
  const sr = 44100;
  const analyzer = new Analyzer(sr);
  const segmenter = new NoteSegmenter({ a4: currentA4() });
  let sample = 0;
  let stringIndex = 0;
  notesRow.replaceChildren();
  demoBtn.textContent = 'Stop demo';
  statusEl.textContent = `demo: open ${STRING_NAMES[stringIndex]} string`;

  demoTimer = setInterval(() => {
    const freq = OPEN_STRINGS[stringIndex];
    const chunk = new Float32Array(2048);
    for (let i = 0; i < chunk.length; i++) {
      const t = (sample + i) / sr;
      let v = 0;
      for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * freq * h * t) / h;
      chunk[i] = v * 0.3;
    }
    sample += chunk.length;
    feed(analyzer, segmenter, chunk, addNoteChip);
    if (sample % (sr * 2) < 2048 && sample > 2048) {
      stringIndex = (stringIndex + 1) % OPEN_STRINGS.length;
      statusEl.textContent = `demo: open ${STRING_NAMES[stringIndex]} string`;
    }
  }, 46); // ~2048 samples of real time per tick
});

function stopDemo() {
  if (!demoTimer) return;
  clearInterval(demoTimer);
  demoTimer = null;
  demoBtn.textContent = 'Demo tone';
}

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
