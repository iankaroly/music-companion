import { startCapture } from './audio/capture.js';
import { Analyzer } from './audio/analyzer.js';
import { NoteSegmenter } from './analysis/notes.js';
import { Recorder } from './audio/recording.js';
import { Tuner } from './ui/tuner.js';
import { renderFreeReview, hideReport } from './ui/report.js';
import { saveRecording, listRecordings, loadRecording, deleteRecording } from './store/db.js';
import { toggleDroneNote, retuneDrones, setDroneTimbre } from './audio/drone.js';
import { encodeWav } from './audio/wav.js';
import { getVolume, setVolume } from './audio/context.js';
import { fftMagnitudes } from './audio/fft.js';
import { RingBuffer } from './audio/ring-buffer.js';
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
    spectrumRing.write(chunk);
    feed(analyzer, segmenter, chunk, handleNote, readings, chord);
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
    notesRow.replaceChildren(); // chips are redundant once the review is up
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

function downloadWav(samples, sampleRate, when) {
  const blob = new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `music-companion-${new Date(when).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

document.querySelector('#export-rec').addEventListener('click', () => {
  if (!lastTake) return;
  const { recorder } = lastTake;
  downloadWav(recorder.extract(0, recorder.duration), recorder.sampleRate, Date.now());
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
      const wavBtn = document.createElement('button');
      wavBtn.textContent = 'WAV';
      wavBtn.addEventListener('click', async () => {
        const data = await loadRecording(r.id);
        if (data) downloadWav(new Float32Array(data.audio), r.sampleRate, r.date);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await deleteRecording(r.id);
        refreshLibrary();
      });
      actions.append(openBtn, wavBtn, delBtn);
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
  metronome.bpm = Math.max(20, Math.min(260, Math.round(bpm)));
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
    ctx.strokeStyle = '#3056d3';
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
  ctx.fillStyle = '#3056d3';
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

const PRESET_KEYS = ['a4', 'volume', 'tunerSettings', 'timbre', 'bpm', 'beatsPerBar',
  'subdivision', 'trainer', 'vizMode'];
const presetSel = document.querySelector('#preset-list');

function refreshPresets() {
  const presets = JSON.parse(localStorage.getItem('presets') ?? '{}');
  presetSel.replaceChildren(new Option('presets…', ''));
  for (const name of Object.keys(presets)) presetSel.append(new Option(name, name));
}

document.querySelector('#preset-save').addEventListener('click', () => {
  const name = prompt('Preset name:');
  if (!name) return;
  const presets = JSON.parse(localStorage.getItem('presets') ?? '{}');
  presets[name] = Object.fromEntries(
    PRESET_KEYS.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null));
  localStorage.setItem('presets', JSON.stringify(presets));
  refreshPresets();
  presetSel.value = name;
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

// --- installable app: register the service worker -----------------------------

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
