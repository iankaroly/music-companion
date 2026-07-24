import { startCapture } from './audio/capture.js';
import { Analyzer } from './audio/analyzer.js';
import { NoteSegmenter } from './analysis/notes.js';
import { buildScale } from './analysis/scales.js';
import { Tuner } from './ui/tuner.js';
import { renderReport, hideReport } from './ui/report.js';

const tuner = new Tuner(document);
const startBtn = document.querySelector('#start');
const demoBtn = document.querySelector('#demo');
const statusEl = document.querySelector('#status');
const notesRow = document.querySelector('#notes-row');
const scaleStartBtn = document.querySelector('#scale-start');
const scaleDemoBtn = document.querySelector('#scale-demo');

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
});
tuner.a4 = currentA4();

// --- scale picker ----------------------------------------------------------

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const keySelect = document.querySelector('#key');
for (const k of KEYS) {
  const opt = document.createElement('option');
  opt.value = opt.textContent = k;
  if (k === 'D') opt.selected = true;
  keySelect.append(opt);
}

function currentScale() {
  const tonic = keySelect.value + document.querySelector('#start-octave').value;
  return buildScale({
    tonic,
    type: document.querySelector('#scale-type').value,
    octaves: Number(document.querySelector('#scale-octaves').value),
  });
}

// --- shared display helpers ------------------------------------------------

function addNoteChip(note) {
  const chip = document.createElement('div');
  chip.className = 'note-chip';
  chip.dataset.state = Math.abs(note.cents) < 8 ? 'good' : 'off';
  const cents = `${note.cents >= 0 ? '+' : ''}${note.cents.toFixed(0)}`;
  chip.innerHTML = `${note.name}<small>${cents}¢</small>`;
  notesRow.append(chip);
  while (notesRow.children.length > MAX_CHIPS) notesRow.firstChild.remove();
}

function handleNote(note) {
  addNoteChip(note);
  capture?.collected?.push(note);
}

function feed(analyzer, segmenter, chunk, onNote = handleNote) {
  for (const reading of analyzer.push(chunk)) {
    tuner.update(reading);
    for (const note of segmenter.push(reading)) onNote(note);
  }
}

function stopEverything() {
  stopDemo();
  if (capture) {
    capture.stop();
    capture = null;
  }
  startBtn.textContent = 'Start tuner';
  scaleStartBtn.textContent = 'Start scale';
  statusEl.textContent = '';
  tuner.update({ frequency: null, confidence: 0, rms: 0 });
}

async function beginCapture(extra = {}) {
  let analyzer = null;
  const segmenter = new NoteSegmenter({ a4: currentA4() });
  const session = await startCapture((chunk) => feed(analyzer, segmenter, chunk));
  analyzer = new Analyzer(session.sampleRate);
  session.segmenter = segmenter;
  Object.assign(session, extra);
  return session;
}

// --- free tuner ------------------------------------------------------------

startBtn.addEventListener('click', async () => {
  if (capture && !capture.scale) {
    stopEverything();
    return;
  }
  stopEverything();
  hideReport(document);
  try {
    notesRow.replaceChildren();
    capture = await beginCapture();
    startBtn.textContent = 'Stop';
    statusEl.textContent = 'listening to mic';
  } catch (err) {
    statusEl.textContent = `mic unavailable: ${err.message}`;
  }
});

// --- scale practice --------------------------------------------------------

scaleStartBtn.addEventListener('click', async () => {
  if (capture?.scale) {
    // finish: flush the last note, align, report
    const { segmenter, scale, collected } = capture;
    for (const note of segmenter.flush()) collected.push(note);
    stopEverything();
    renderReport(document, scale, collected);
    return;
  }
  stopEverything();
  hideReport(document);
  try {
    notesRow.replaceChildren();
    capture = await beginCapture({ scale: currentScale(), collected: [] });
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
  const scale = currentScale();
  const analyzer = new Analyzer(sr);
  const segmenter = new NoteSegmenter({ a4 });
  const collected = [];
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
  for (let i = 0; i < audio.length; i += 2048) {
    feed(analyzer, segmenter, audio.subarray(i, i + 2048), onNote);
  }
  for (const note of segmenter.flush()) onNote(note);

  renderReport(document, scale, collected);
  statusEl.textContent = `demo: ${keySelect.value} ${document.querySelector('#scale-type').value}, degree ${SHARP_DEGREE + 1} played sharp on purpose`;
});

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
