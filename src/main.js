import { startCapture } from './audio/capture.js';
import { Analyzer } from './audio/analyzer.js';
import { NoteSegmenter } from './analysis/notes.js';
import { Tuner } from './ui/tuner.js';

const tuner = new Tuner(document);
const startBtn = document.querySelector('#start');
const demoBtn = document.querySelector('#demo');
const statusEl = document.querySelector('#status');
const notesRow = document.querySelector('#notes-row');

const MAX_CHIPS = 12;

let capture = null;
let demoTimer = null;

function addNoteChip(note) {
  const chip = document.createElement('div');
  chip.className = 'note-chip';
  chip.dataset.state = Math.abs(note.cents) < 8 ? 'good' : 'off';
  const cents = `${note.cents >= 0 ? '+' : ''}${note.cents.toFixed(0)}`;
  chip.innerHTML = `${note.name}<small>${cents}¢</small>`;
  notesRow.append(chip);
  while (notesRow.children.length > MAX_CHIPS) notesRow.firstChild.remove();
}

function feed(analyzer, segmenter, chunk) {
  for (const reading of analyzer.push(chunk)) {
    tuner.update(reading);
    for (const note of segmenter.push(reading)) addNoteChip(note);
  }
}

function resetDisplay(segmenter) {
  for (const note of segmenter?.flush() ?? []) addNoteChip(note);
  tuner.update({ frequency: null, confidence: 0, rms: 0 });
}

startBtn.addEventListener('click', async () => {
  if (capture) {
    capture.stop();
    resetDisplay(capture.segmenter);
    capture = null;
    startBtn.textContent = 'Start tuner';
    statusEl.textContent = '';
    return;
  }
  stopDemo();
  try {
    let analyzer = null;
    const segmenter = new NoteSegmenter();
    capture = await startCapture((chunk) => feed(analyzer, segmenter, chunk));
    capture.segmenter = segmenter;
    analyzer = new Analyzer(capture.sampleRate);
    notesRow.replaceChildren();
    startBtn.textContent = 'Stop';
    statusEl.textContent = 'listening to mic';
  } catch (err) {
    statusEl.textContent = `mic unavailable: ${err.message}`;
  }
});

// Demo mode: synthesizes the open strings and feeds them through the exact
// same Analyzer → NoteSegmenter path as the mic. Works with no instrument,
// no mic permission, even in a headless browser.
const OPEN_STRINGS = [65.41, 98.0, 146.83, 220.0];
const STRING_NAMES = ['C', 'G', 'D', 'A'];

demoBtn.addEventListener('click', () => {
  if (demoTimer) {
    stopDemo();
    return;
  }
  const sr = 44100;
  const analyzer = new Analyzer(sr);
  const segmenter = new NoteSegmenter();
  let sample = 0;
  let stringIndex = 0;
  notesRow.replaceChildren();
  demoBtn.textContent = 'Stop demo';
  demoBtn.segmenter = segmenter;
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
    feed(analyzer, segmenter, chunk);
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
  resetDisplay(demoBtn.segmenter);
  demoBtn.segmenter = null;
  demoBtn.textContent = 'Demo tone';
  statusEl.textContent = '';
}
