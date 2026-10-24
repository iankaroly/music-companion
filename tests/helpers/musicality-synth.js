// Takes built with KNOWN shaping, so the musicality descriptors can be checked
// against what was put in rather than against how they look on a recording.
//
// Two doors on the same specification:
//   idealTake   notes and readings written straight from the spec — no audio,
//               no segmenter — for unit tests of the module's own logic.
//   renderAudio audio of the same spec, which tools/musicality-synth-check.mjs
//               pushes through the REAL Analyzer + NoteSegmenter. That is the
//               one that matters for thresholds: it carries the ~93 ms window
//               and the onset jitter that a hand-written note list does not.

import { Analyzer } from '../../src/audio/analyzer.js';
import { NoteSegmenter } from '../../src/analysis/notes.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CYCLE = [0, 2, 4, 2, 0, 2, 4, 5];       // a small tune whose five-note figures come round again
const db = (x) => 10 ** (x / 20);

// -> [{ midi, start, dur, amp, vib, phrase, pos }]
export function buildSpec({
  phrases = 6, perPhrase = 10, period = 0.5,
  shape = 'arch',            // 'arch' | 'flat' | 'build' | 'jump'
  peakDb = 7,
  phraseGainDb = null,       // extra dB per phrase, for contrast between phrases
  articulation = 0.95,       // sounding length / spacing
  articulationJitter = 0,    // random +- on that ratio
  breath = 0.35,             // silence between phrases, seconds
  finalStretch = 1,          // last note of a phrase this many times as long
  wave = 0,                  // tempo wave, fraction of the period
  drift = 0,                 // fractional change of tempo from first to last note
  sameRepeats = true,        // repeated figures identical, or varied in timing/loudness
  repeatVariation = 0.12,
  vibrato = 'none',          // 'none' | 'steady' | 'grows'
  baseDb = -26, seed = 1,
  jitter = 0,                // random +- fraction on each note's spacing ONLY (loudness and pitch untouched): a player's own unsteadiness
  midiShift = 0,             // transposes the whole take; timing must not care
  drone = false,             // every note the same pitch
  randomPitch = false,       // pitches drawn at random across a wide range: junk, not a tune
  gainDb = 0,                // whole-take level shift, for a quiet recording
  decay = null,              // seconds: a struck or plucked tone (piano, guitar, harp) whose level falls away exponentially with this time constant, instead of holding
  swell = 0,                 // dB: each note starts this far under its peak and rises to it over the first 60% of its length (messa di voce); only idealTake uses it
  tailWobble = 0,            // cents: how far the pitch tracker's reading of a decaying note wanders once its level is well below its peak (only idealTake uses it; the audio path wobbles by itself)
  pattern = null,            // semitone offsets that repeat instead of the small tune (an octave drill is [0, 12], a wide arpeggio [0, 12, 24, 12])
} = {}) {
  const rand = rng(seed);
  const spec = [];
  let t = 0;
  const total = phrases * perPhrase;
  let index = 0;
  for (let p = 0; p < phrases; p++) {
    const transpose = [0, 3, 5, 2, 7, 4][p % 6];
    for (let k = 0; k < perPhrase; k++, index++) {
      const u = perPhrase > 1 ? k / (perPhrase - 1) : 0;
      let local = period * (1 + wave * Math.sin((2 * Math.PI * index) / 17)) * (1 - drift * (index / total));
      if (k === perPhrase - 1) local *= finalStretch;
      if (!sameRepeats) local *= 1 + (rand() - 0.5) * 2 * repeatVariation;
      if (jitter) local *= 1 + (rand() - 0.5) * 2 * jitter;
      let level = baseDb;
      if (shape === 'arch') level += peakDb * Math.sin(Math.PI * u);
      else if (shape === 'build') level += peakDb * u;
      else if (shape === 'jump') level += (rand() - 0.5) * 2 * peakDb;
      if (phraseGainDb) level += phraseGainDb[p % phraseGainDb.length];
      if (!sameRepeats) level += (rand() - 0.5) * 2 * repeatVariation * 12;
      level += gainDb;
      const ratio = Math.min(1, Math.max(0.1, articulation + (rand() - 0.5) * 2 * articulationJitter));
      const long = k === perPhrase - 1 || ratio * local > 0.8;
      spec.push({
        midi: midiShift + (drone ? 55 : randomPitch ? 40 + Math.floor(rand() * 40) : pattern ? 48 + pattern[index % pattern.length] : 55 + transpose + CYCLE[index % CYCLE.length]),
        start: t, dur: ratio * local, amp: db(level), phrase: p, pos: k,
        vib: vibrato === 'none' || !long ? null : { depth: 28, rate: 5.8, grows: vibrato === 'grows' },
        decay, wobble: tailWobble, swell,
      });
      t += local + (k === perPhrase - 1 ? breath : 0);
    }
  }
  return spec;
}

function pitchAt(n, tt) {
  const f0 = 440 * 2 ** ((n.midi - 69) / 12);
  if (!n.vib) return f0;
  const into = tt - n.start;
  const open = n.vib.grows ? Math.min(1, Math.max(0, (into - 0.15 * n.dur) / (0.5 * n.dur))) : 1;
  const cents = n.vib.depth * open * Math.sin(2 * Math.PI * n.vib.rate * into);
  return f0 * 2 ** (cents / 1200);
}

// Notes and readings straight from the spec: what a perfect Analyzer and
// segmenter would hand over. Readings every 1024 samples at 44.1 kHz.
export function idealTake(spec, hop = 1024 / 44100) {
  const notes = spec.map((n) => ({ start: n.start, end: n.start + n.dur, midi: n.midi, cents: 0 }));
  const readings = [];
  const end = spec.at(-1).start + spec.at(-1).dur + 0.2;
  const wrand = rng(4242);
  let ar = 0;
  let k = 0;
  for (let t = 0; t < end; t += hop) {
    while (k < spec.length && spec[k].start + spec[k].dur <= t) k++;
    const n = spec[k];
    const on = n && t >= n.start;
    if (!on) {
      readings.push({ time: t, frequency: 0, confidence: 0, rms: 0.0003 });
      continue;
    }
    // A decaying note loses level exponentially, and a pitch tracker's reading
    // of the quiet end of it wanders: slow noise (about 6 zero crossings a
    // second, the rate a vibrato has) whose width grows as the level falls
    // below -6 dB of the peak. Nothing is played there; it is the tracker's.
    const fall = n.decay ? Math.exp(-(t - n.start) / n.decay) : 1;
    let f = pitchAt(n, t);
    if (n.decay && n.wobble) {
      ar = 0.9 * ar + (wrand() - 0.5) * 2 * Math.sqrt(3) * Math.sqrt(1 - 0.81);
      const weight = Math.min(1, Math.max(0, (-20 * Math.log10(fall) - 6) / 12));
      f *= 2 ** ((n.wobble * weight * ar) / 1200);
    }
    const rise = n.swell ? 10 ** (-(n.swell * Math.max(0, 1 - (t - n.start) / (0.6 * (spec[k].dur)))) / 20) : 1;
    readings.push({ time: t, frequency: f, confidence: 0.92, rms: (n.amp * fall * rise) / Math.SQRT2 });
  }
  return { notes, readings };
}

// The same note list with every onset and end moved by a random few
// milliseconds, the SAME milliseconds at any tempo: the pipeline's own error is
// a fixed time, so this is what makes an identical performance at two tempos
// read differently in the share-of-a-note measures. (An ideal take has none, and
// so cannot show a threshold that ignores the tempo.)
export function wobbleOnsets(take, ms, seed) {
  const rand = rng(seed);
  const notes = take.notes.map((n) => {
    const j = ((rand() - 0.5) * 2 * ms) / 1000;
    return { ...n, start: n.start + j, end: n.end + j + (((rand() - 0.5) * 2 * ms) / 1000) * 0.5 };
  });
  return { notes, readings: take.readings };
}

// opts.noiseDb: a broadband noise floor at this level (dB re full scale), the
//   room. opts.reverb: { rt60, wetDb } a bank of feedback combs, the cheap hall
//   (a real impulse response convolved directly over 30 s of audio takes
//   minutes). Both are what make a struck or staccato note's tail wobble in
//   pitch once it has fallen near the floor.
export function renderAudio(spec, sr = 44100, opts = {}) {
  const tail = opts.reverb ? opts.reverb.rt60 * 0.6 : 0;
  const end = spec.at(-1).start + spec.at(-1).dur + 0.4 + tail;
  const out = new Float32Array(Math.round(end * sr));
  for (const n of spec) {
    const from = Math.round(n.start * sr);
    const len = Math.round(n.dur * sr);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const tt = n.start + i / sr;
      const f = pitchAt(n, tt);
      phase += (2 * Math.PI * f) / sr;
      const fall = n.decay ? Math.exp(-(i / sr) / n.decay) : 1;
      const env = Math.min(1, i / (sr * 0.008)) * (n.decay ? 1 : Math.min(1, (len - i) / (sr * 0.015))) * fall;
      out[from + i] += n.amp * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)) / 1.75;
    }
  }
  if (opts.reverb) {
    const dry = Float32Array.from(out);
    const wet = 10 ** (opts.reverb.wetDb / 20);
    for (const ms of [29.7, 37.1, 41.1, 43.7, 53.3]) {
      const D = Math.round((ms / 1000) * sr);
      const g = 10 ** ((-3 * (ms / 1000)) / opts.reverb.rt60);
      const y = new Float32Array(out.length);
      for (let i = 0; i < y.length; i++) y[i] = dry[i] + (i >= D ? g * y[i - D] : 0);
      for (let i = 0; i < y.length; i++) out[i] += (wet * y[i]) / 5;
    }
  }
  if (opts.noiseDb !== undefined && opts.noiseDb !== null) {
    const rand = rng(99);
    const level = 10 ** (opts.noiseDb / 20);
    for (let i = 0; i < out.length; i++) out[i] += level * (rand() - 0.5) * 3.46;
  }
  return out;
}

// The real detection path, as tools/fast-check.mjs drives it.
export function hear(samples, sr = 44100) {
  const analyzer = new Analyzer(sr, { windowSize: 4096, hopSize: 1024 });
  const segmenter = new NoteSegmenter();
  const notes = [];
  const readings = [];
  for (let at = 0; at < samples.length; at += 1024) {
    for (const r of analyzer.push(samples.subarray(at, Math.min(samples.length, at + 1024)))) {
      readings.push(r);
      for (const n of segmenter.push(r)) notes.push(n);
    }
  }
  for (const n of segmenter.flush()) notes.push(n);
  return { notes, readings };
}
