// HOW FAST CAN YOU PLAY BEFORE THE APP STOPS HEARING THE NOTES.
//
// A player asked whether a fast piece can stay in step with the page, and the
// answer has two halves. The PLAYBACK half — the light against the recording —
// is arithmetic, and `score:follow` holds it to five milliseconds over sixteen
// seconds. The other half is the one nobody had measured: what the pitch reader
// makes of a fast run in the first place. Every note the app knows about comes
// out of Analyzer + NoteSegmenter, and a note it never heard cannot be lit at
// the right moment, marked in the right place, or paired with anything.
//
// So: scales synthesised at a run of tempi, put through the REAL detection path
// (no browser, no microphone — the analyzer is plain arithmetic), and scored
// against the notes that were synthesised. It reports, per tempo:
//
//   heard        how many of the notes came back at all
//   right        …with the right pitch
//   onset        how far the note's reported start is from where it was played,
//                which is what a light being "in step" actually means
//   merged/split more notes or fewer than were played
//
//   node tools/fast-check.mjs [--midi 72] [--sr 44100]
//
import { Analyzer } from '../src/audio/analyzer.js';
import { NoteSegmenter } from '../src/analysis/notes.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(`--${name}`)
  ? Number(argv[argv.indexOf(`--${name}`) + 1]) : fallback);
const SR = flag('sr', 44100);
const BASE = flag('midi', 72);         // C5 — a flute sits around here
const HARMONICS = flag('harmonics', 1);

// A scale, played at a given number of notes per second, as audio. Each note is
// a sine with a short attack and release — not an instrument, but the thing the
// pitch reader is looking at is the periodicity, and that is honest.
function scale(notesPerSecond, count = 24) {
  const step = SR / notesPerSecond;
  const gap = Math.round(step * 0.12);          // a little air between notes
  const samples = new Float32Array(Math.round(step * count) + SR);
  const played = [];
  const STEPS = [0, 2, 4, 5, 7, 9, 11, 12];
  for (let i = 0; i < count; i++) {
    const midi = BASE + STEPS[i % STEPS.length] + 12 * Math.floor(i / STEPS.length / 2);
    const from = Math.round(i * step);
    const len = Math.round(step) - gap;
    const hz = 440 * 2 ** ((midi - 69) / 12);
    for (let k = 0; k < len; k++) {
      const t = k / SR;
      // A short attack and decay, so a note has an edge to find.
      const env = Math.min(1, k / (SR * 0.004)) * Math.min(1, (len - k) / (SR * 0.01));
      let v = Math.sin(2 * Math.PI * hz * t);
      // …and, optionally, a strong second harmonic — which is what a flute is,
      // and why a flute is the instrument that gets heard an octave high.
      for (let h = 2; h <= HARMONICS + 1; h++) v += Math.sin(2 * Math.PI * hz * h * t) / h;
      samples[from + k] += 0.5 * env * v;
    }
    played.push({ midi, start: from / SR, end: (from + len) / SR });
  }
  return { samples, played };
}

function hear(samples) {
  const analyzer = new Analyzer(SR, { windowSize: 4096, hopSize: 1024 });
  const segmenter = new NoteSegmenter();
  const heard = [];
  const CHUNK = 1024;
  for (let at = 0; at < samples.length; at += CHUNK) {
    for (const reading of analyzer.push(samples.subarray(at, Math.min(samples.length, at + CHUNK)))) {
      // `push` returns an ARRAY of notes that CLOSED on this reading — usually
      // empty. Treating its return as one note is how a scale of 24 comes back
      // as 556.
      for (const note of segmenter.push(reading)) heard.push(note);
    }
  }
  for (const note of segmenter.flush()) heard.push(note);
  return heard;
}

// Each played note against the nearest heard one, in time — the same
// nearest-first pairing the rest of this repo scores with.
function score(played, heard) {
  const pairs = [];
  for (const [pi, p] of played.entries()) {
    for (const [hi, h] of heard.entries()) {
      const d = Math.abs(h.start - p.start);
      if (d < 0.2) pairs.push({ pi, hi, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const tookP = new Set();
  const tookH = new Set();
  const matched = [];
  for (const pair of pairs) {
    if (tookP.has(pair.pi) || tookH.has(pair.hi)) continue;
    tookP.add(pair.pi);
    tookH.add(pair.hi);
    matched.push({ played: played[pair.pi], heard: heard[pair.hi], off: pair.d });
  }
  const right = matched.filter((m) => m.heard.midi === m.played.midi);
  const octave = matched.filter((m) => m.heard.midi !== m.played.midi
    && Math.abs(m.heard.midi - m.played.midi) % 12 === 0);
  const offsets = matched.map((m) => m.heard.start - m.played.start).sort((a, b) => a - b);
  const median = offsets.length ? offsets[Math.floor(offsets.length / 2)] : NaN;
  const worst = offsets.length ? Math.max(...offsets.map((o) => Math.abs(o - median))) : NaN;
  return {
    heard: heard.length,
    matched: matched.length,
    right: right.length,
    octave: octave.length,
    lag: median,
    spread: worst,
  };
}

const PACES = [2, 4, 6, 8, 10, 12, 16];
console.log(`\nHOW FAST BEFORE THE NOTES STOP BEING HEARD — sine at midi ${BASE},`
  + ` ${SR / 1000}kHz, 4096-sample window (${(4096 / SR * 1000).toFixed(0)}ms)`
  + `${HARMONICS ? `, with ${HARMONICS} added harmonic(s)` : ''}\n`);
console.log('  notes/s   note length   played  heard  on the right pitch  octave out   lag    spread');
for (const pace of PACES) {
  const { samples, played } = scale(pace);
  const got = score(played, hear(samples));
  const ms = (n) => `${(n * 1000).toFixed(0)}ms`;
  console.log(`  ${String(pace).padStart(5)}   ${ms(1 / pace).padStart(11)}`
    + `${String(played.length).padStart(9)}${String(got.heard).padStart(7)}`
    + `${`${got.right} of ${got.matched}`.padStart(20)}`
    + `${String(got.octave).padStart(12)}`
    + `${(Number.isFinite(got.lag) ? ms(got.lag) : '—').padStart(8)}`
    + `${(Number.isFinite(got.spread) ? `±${ms(got.spread)}` : '—').padStart(10)}`);
}
console.log('\n  lag is how late the note is reported against when it was played — a constant'
  + '\n  lag shifts the light evenly and is correctable; the SPREAD is what cannot be'
  + '\n  corrected, because it is different for every note.');
