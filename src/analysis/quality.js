// How a take SOUNDS beyond whether the pitch was right: how steady each note
// is, how much vibrato and how wide, how clear and how bright the tone, how
// much the loudness moves, how quickly a note arrives in tune.
//
// These are DESCRIPTIONS, not grades. Nothing here knows what a good tone is —
// there is no labelled data in this repo to learn that from — so the one place
// that says "better" is pitch steadiness and arrival, where lower is plainly
// closer to correct. Everything else is reported as a difference ("brighter",
// "wider vibrato") and left to the player and the teacher to value.
//
// Pure: notes and readings in, plain numbers out. Audio is optional; without it
// brightness is simply absent rather than guessed.

import { PitchCenterTracker } from './vibrato.js';
import { noteLanding } from './landing.js';
import { fftMagnitudes } from '../audio/fft.js';

const MIN_CONF = 0.6;          // the same floor the segmenter uses for a pitched frame
const MIN_NOTES = 5;           // below this a median is a single note's opinion
const VIBRATO_MIN_SEC = 0.4;   // a shorter note cannot show a vibrato cycle
const BRIGHT_MIN_SEC = 0.15;
const FFT_SIZE = 4096;
const BRIGHT_TOP_HZ = 8000;

function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function quantile(values, q) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.min(v.length - 1, Math.round((v.length - 1) * q))];
}

const needEnough = (values) => (values.filter(Number.isFinite).length >= MIN_NOTES ? median(values) : null);

function framesOf(note, readings, a4) {
  const out = [];
  for (const r of readings ?? []) {
    if (r.time < note.start) continue;
    if (r.time >= note.end) break;
    if (!(r.frequency > 0) || !(r.confidence >= MIN_CONF)) continue;
    out.push({ time: r.time, midiFloat: 69 + 12 * Math.log2(r.frequency / a4), conf: r.confidence, rms: r.rms });
  }
  return out;
}

// Centroid of the spectrum over the note's own pitch: 4 means the energy sits
// around the fourth harmonic. Dividing by the pitch is what lets a low note and
// a high note be compared, and a bright take and a dull one.
function brightnessOf(note, audio, sampleRate) {
  if (!audio || note.end - note.start < BRIGHT_MIN_SEC) return null;
  const mid = Math.floor(((note.start + note.end) / 2) * sampleRate);
  const from = mid - FFT_SIZE / 2;
  if (from < 0 || from + FFT_SIZE > audio.length) return null;
  const win = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    win[i] = audio[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }
  const mags = fftMagnitudes(win);
  const binHz = sampleRate / FFT_SIZE;
  const top = Math.min(mags.length - 1, Math.floor(BRIGHT_TOP_HZ / binHz));
  let num = 0;
  let den = 0;
  for (let k = 1; k <= top; k++) { num += k * binHz * mags[k]; den += mags[k]; }
  if (den <= 0) return null;
  const f0 = 440 * 2 ** ((note.midi - 69) / 12);
  return num / den / f0;
}

export function qualityOf({ notes, readings, audio = null, sampleRate = 44100, a4 = 440 } = {}) {
  const list = (notes ?? []).filter((n) => Number.isFinite(n?.start) && Number.isFinite(n?.end));
  if (list.length === 0) return null;

  const wobble = [];      // pitch wander of notes with no vibrato, in cents
  const vibWidth = [];
  const vibRate = [];
  let vibratoNotes = 0;
  let longNotes = 0;
  const clarity = [];
  const level = [];
  const bright = [];
  const onsetAbs = [];
  const settle = [];
  let clean = 0;
  let landed = 0;

  for (const n of list) {
    const fr = framesOf(n, readings, a4);
    if (fr.length >= 4) {
      clarity.push(fr.reduce((s, f) => s + f.conf, 0) / fr.length);
      const db = 20 * Math.log10(Math.max(1e-6, median(fr.map((f) => f.rms))));
      level.push(db);

      let vib = null;
      if (n.end - n.start >= VIBRATO_MIN_SEC) {
        longNotes++;
        const tracker = new PitchCenterTracker();
        for (const f of fr) {
          const out = tracker.push({ time: f.time, midiFloat: f.midiFloat });
          if (out.vibrato) vib = out.vibrato;
        }
      }
      if (vib) {
        vibratoNotes++;
        vibWidth.push(vib.widthCents);
        vibRate.push(vib.rateHz);
      } else {
        const centre = median(fr.map((f) => f.midiFloat));
        const sd = Math.sqrt(fr.reduce((s, f) => s + (f.midiFloat - centre) ** 2, 0) / fr.length) * 100;
        wobble.push(sd);
      }
    }
    const b = brightnessOf(n, audio, sampleRate);
    if (b !== null) bright.push(b);

    const land = noteLanding(n, readings, a4);
    if (land) {
      landed++;
      onsetAbs.push(Math.abs(land.onsetCents));
      if (land.settled) settle.push(land.settleMs);
      if (land.settled && land.settleMs <= 60) clean++;
    }
  }

  const jumps = [];
  for (let i = 1; i < level.length; i++) jumps.push(Math.abs(level[i] - level[i - 1]));

  return {
    noteCount: list.length,
    steadinessCents: needEnough(wobble),
    vibrato: longNotes >= MIN_NOTES
      ? {
        share: vibratoNotes / longNotes,
        widthCents: vibWidth.length >= 3 ? median(vibWidth) : null,
        rateHz: vibRate.length >= 3 ? median(vibRate) : null,
      }
      : null,
    clarity: needEnough(clarity),
    dynamics: level.length >= MIN_NOTES
      ? {
        medianDb: median(level),
        rangeDb: quantile(level, 0.9) - quantile(level, 0.1),
        stepDb: median(jumps),
      }
      : null,
    brightness: needEnough(bright),
    landing: landed >= MIN_NOTES
      ? {
        cleanShare: clean / landed,
        medianSettleMs: median(settle),
        medianOnsetCents: median(onsetAbs),
      }
      : null,
  };
}

// What changed between two takes, in words that do not pretend to know taste.
// `good` is set only where lower or higher is plainly closer to correct.
const DESCRIPTORS = [
  {
    key: 'steadiness', label: 'pitch steadiness', unit: '¢',
    get: (q) => q.steadinessCents, small: 1.5, good: 'lower',
    up: 'less steady within notes', down: 'steadier within notes',
  },
  {
    key: 'landing', label: 'notes in tune on arrival', unit: '%',
    get: (q) => (q.landing ? q.landing.cleanShare * 100 : null), small: 8, good: 'higher',
    up: 'more notes arrive in tune', down: 'fewer notes arrive in tune',
  },
  {
    key: 'settle', label: 'time to settle', unit: 'ms',
    get: (q) => q.landing?.medianSettleMs ?? null, small: 20, good: 'lower',
    up: 'slower to settle', down: 'faster to settle',
  },
  {
    key: 'vibrato-width', label: 'vibrato width', unit: '¢',
    get: (q) => q.vibrato?.widthCents ?? null, small: 5, good: null,
    up: 'wider vibrato', down: 'narrower vibrato',
  },
  {
    key: 'vibrato-rate', label: 'vibrato speed', unit: 'Hz',
    get: (q) => q.vibrato?.rateHz ?? null, small: 0.5, good: null,
    up: 'faster vibrato', down: 'slower vibrato',
  },
  {
    key: 'vibrato-share', label: 'long notes with vibrato', unit: '%',
    get: (q) => (q.vibrato ? q.vibrato.share * 100 : null), small: 15, good: null,
    up: 'vibrato on more long notes', down: 'vibrato on fewer long notes',
  },
  {
    key: 'clarity', label: 'tone clarity', unit: '',
    get: (q) => q.clarity, small: 0.03, good: null,
    up: 'a clearer, purer tone', down: 'a rougher or breathier tone',
  },
  {
    key: 'brightness', label: 'brightness', unit: '× the pitch',
    get: (q) => q.brightness, small: 0.08, relative: true, good: null,
    up: 'a brighter sound', down: 'a darker sound',
  },
  {
    key: 'dynamic-range', label: 'loudness range', unit: 'dB',
    get: (q) => q.dynamics?.rangeDb ?? null, small: 2, good: null,
    up: 'more contrast in loudness', down: 'a more even loudness',
  },
  {
    key: 'loudness-step', label: 'jump in loudness between notes', unit: 'dB',
    get: (q) => q.dynamics?.stepDb ?? null, small: 1, good: null,
    up: 'bigger loudness jumps from note to note', down: 'smoother loudness from note to note',
  },
];

export function describeQuality() {
  return DESCRIPTORS.map(({ key, label, unit }) => ({ key, label, unit }));
}

export function compareQuality(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const d of DESCRIPTORS) {
    const a = d.get(before);
    const b = d.get(after);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      out.push({ key: d.key, label: d.label, unit: d.unit, before: a ?? null, after: b ?? null, change: null, verdict: 'unmeasured' });
      continue;
    }
    const delta = b - a;
    const size = d.relative ? Math.abs(delta) / Math.max(1e-9, Math.abs(a)) : Math.abs(delta);
    const verdict = size < d.small ? 'about the same' : delta > 0 ? d.up : d.down;
    const row = { key: d.key, label: d.label, unit: d.unit, before: a, after: b, change: delta, verdict };
    if (size >= d.small && d.good) row.better = (delta < 0) === (d.good === 'lower');
    out.push(row);
  }
  return out;
}
