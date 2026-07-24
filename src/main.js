import { startCapture } from './audio/capture.js';
import { Analyzer } from './audio/analyzer.js';
import { Tuner } from './ui/tuner.js';

const tuner = new Tuner(document);
const startBtn = document.querySelector('#start');
const demoBtn = document.querySelector('#demo');
const statusEl = document.querySelector('#status');

let capture = null;
let demoTimer = null;

function feedAnalyzer(analyzer, chunk) {
  for (const reading of analyzer.push(chunk)) tuner.update(reading);
}

startBtn.addEventListener('click', async () => {
  if (capture) {
    capture.stop();
    capture = null;
    startBtn.textContent = 'Start tuner';
    statusEl.textContent = '';
    tuner.update({ frequency: null, confidence: 0, rms: 0 });
    return;
  }
  stopDemo();
  try {
    let analyzer = null;
    capture = await startCapture((chunk) => feedAnalyzer(analyzer, chunk));
    analyzer = new Analyzer(capture.sampleRate);
    startBtn.textContent = 'Stop';
    statusEl.textContent = 'listening to mic';
  } catch (err) {
    statusEl.textContent = `mic unavailable: ${err.message}`;
  }
});

// Demo mode: synthesizes a sawtooth sweeping through cello open strings and
// feeds it through the exact same Analyzer path as the mic. Works with no
// instrument, no mic permission, even in a headless browser.
const OPEN_STRINGS = [65.41, 98.0, 146.83, 220.0];

demoBtn.addEventListener('click', () => {
  if (demoTimer) {
    stopDemo();
    return;
  }
  const sr = 44100;
  const analyzer = new Analyzer(sr);
  let sample = 0;
  let stringIndex = 0;
  demoBtn.textContent = 'Stop demo';
  statusEl.textContent = `demo: open ${['C', 'G', 'D', 'A'][stringIndex]} string`;

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
    feedAnalyzer(analyzer, chunk);
    if (sample % (sr * 2) < 2048 && sample > 2048) {
      stringIndex = (stringIndex + 1) % OPEN_STRINGS.length;
      statusEl.textContent = `demo: open ${['C', 'G', 'D', 'A'][stringIndex]} string`;
    }
  }, 46); // ~2048 samples of real time per tick
});

function stopDemo() {
  if (!demoTimer) return;
  clearInterval(demoTimer);
  demoTimer = null;
  demoBtn.textContent = 'Demo tone';
  statusEl.textContent = '';
  tuner.update({ frequency: null, confidence: 0, rms: 0 });
}
