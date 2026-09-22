// DOES THE TUNER HOLD A NOTE.
//
// "It bugs back and forth and doesn't register the pitch a lot of the time."
// Both halves of that are countable, so this counts them: audio is put through
// the tuner's REAL path — Analyzer exactly as main.js builds it for the tuner,
// then Tuner.update, the same object that paints the dial — and what the
// screen would say is read back off it, reading by reading.
//
//   shown    of the readings taken while a note was sounding, how many put a
//            note on the screen rather than "–" / "listening"
//   right    …and how many of those named the note that was played
//   flips    how many times the big note changed during one held note
//   blank    how many times it dropped to "–" in the middle of a held note
//   sd¢      how much the cents readout wandered on a note that did not move
//
// Two kinds of audio. Synthesised bowed tones with a KNOWN pitch, low cello to
// high violin, at levels from a phone across the room to one on the stand. And
// real playing — Apple's loops for violin, flute, trumpet and sax — where the
// pitch is not known, so only the flicker is scored: a note that shows, goes,
// and comes back within a few readings.
//
//   node tools/tuner-check.mjs [--loops <dir of 48k mono wavs>]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The tuner paints an SVG; nothing here needs one to exist.
const el = () => ({
  textContent: '', dataset: {}, setAttribute() {}, append() {}, querySelector: () => el(),
});
globalThis.document = { createElementNS: el };
const { Tuner } = await import('../src/ui/tuner.js');
const { Analyzer } = await import('../src/audio/analyzer.js');
const { midiToName } = await import('../src/analysis/note-utils.js');

const SR = 48000;
const argv = process.argv.slice(2);
const loopsDir = argv.includes('--loops') ? argv[argv.indexOf('--loops') + 1] : null;

// A seeded generator, so a change to the tuner is measured on the same noise.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

// A bowed string, roughly. A sawtooth's harmonics (a bow drags the string
// into a Helmholtz corner), a fundamental that a phone's microphone has mostly
// thrown away below ~150 Hz, a bow whose pressure wanders, a little pitch
// jitter, rosin noise, and the room.
function bowed(midi, seconds, { gain = 0.1, vibrato = 0, noise = 0.02 } = {}) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const H = Math.min(30, Math.floor(8000 / f0));
  const amps = [];
  for (let h = 1; h <= H; h++) {
    const f = f0 * h;
    const micRollOff = (f / 150) ** 2 / (1 + (f / 150) ** 2);
    amps.push((1 / h) * micRollOff * (0.6 + 0.8 * rand()));
  }
  const phases = amps.map(() => rand() * 2 * Math.PI);
  let phase = 0;
  let bow = 1;
  let jitter = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    bow += (1 - bow) * 0.0005 + (rand() - 0.5) * 0.01;
    jitter += (rand() - 0.5) * 0.02 - jitter * 0.001;
    const cents = jitter + vibrato * Math.sin(2 * Math.PI * 5.5 * t);
    phase += (2 * Math.PI * f0 * 2 ** (cents / 1200)) / SR;
    let v = 0;
    for (let h = 0; h < amps.length; h++) v += amps[h] * Math.sin((h + 1) * phase + phases[h]);
    const env = Math.min(1, t / 0.08) * Math.min(1, (seconds - t) / 0.05);
    out[i] = gain * env * bow * v + gain * noise * (rand() * 2 - 1) + 0.0004 * (rand() * 2 - 1);
  }
  return out;
}

function silence(seconds) {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = 0.0004 * (rand() * 2 - 1);
  return out;
}

// Feed the audio in 128-sample blocks, as the worklet does, and read the
// screen back after every reading.
function run(audio) {
  const tuner = new Tuner({ querySelector: () => el() });
  const analyzer = new Analyzer(SR, { dual: true, hopSize: 512 });
  const shown = [];
  for (let at = 0; at < audio.length; at += 128) {
    for (const reading of analyzer.push(audio.subarray(at, at + 128))) {
      tuner.update(reading);
      const note = tuner.noteEl.textContent;
      const c = parseFloat(tuner.centsEl.textContent);
      shown.push({ time: reading.time, note: note === '–' ? null : note, cents: c, rms: reading.rms });
    }
  }
  return shown;
}

function scoreHeld(shown, name, from, to) {
  const held = shown.filter((s) => s.time >= from && s.time <= to);
  const on = held.filter((s) => s.note);
  const right = on.filter((s) => s.note === name);
  let flips = 0;
  let blanks = 0;
  for (let i = 1; i < held.length; i++) {
    if (held[i].note && held[i - 1].note && held[i].note !== held[i - 1].note) flips++;
    if (!held[i].note && held[i - 1].note) blanks++;
  }
  const cs = right.map((s) => s.cents).filter(Number.isFinite);
  const mean = cs.reduce((a, b) => a + b, 0) / Math.max(1, cs.length);
  const sd = Math.sqrt(cs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, cs.length));
  return {
    shown: on.length / held.length, right: right.length / Math.max(1, held.length), flips, blanks, sd, mean,
  };
}

const pct = (x) => `${(100 * x).toFixed(0).padStart(3)}%`;
let worst = { shown: 1, right: 1, flips: 0, blanks: 0 };
let total = { n: 0, shown: 0, right: 0, flips: 0, blanks: 0 };

console.log('note  level    vib   shown right flips blank  sd¢   mean¢');
for (const midi of [36, 43, 50, 57, 62, 69, 76, 81]) {
  for (const gain of [0.004, 0.05]) {
    for (const vibrato of [0, 25, 60, 100]) {
      const audio = new Float32Array([...silence(0.5), ...bowed(midi, 3, { gain, vibrato }), ...silence(0.5)]);
      const shown = run(audio);
      // Scored from a quarter-second in — the tuner is allowed to take a
      // moment to find a note — to a little before the bow leaves.
      const r = scoreHeld(shown, midiToName(midi), 0.5 + 0.25, 0.5 + 3 - 0.15);
      total.n++;
      total.shown += r.shown; total.right += r.right; total.flips += r.flips; total.blanks += r.blanks;
      worst = {
        shown: Math.min(worst.shown, r.shown), right: Math.min(worst.right, r.right),
        flips: Math.max(worst.flips, r.flips), blanks: Math.max(worst.blanks, r.blanks),
      };
      console.log(`${midiToName(midi).padEnd(5)} ${String(gain).padEnd(6)} ${String(vibrato).padStart(4)}¢  ${pct(r.shown)} ${pct(r.right)} ${String(r.flips).padStart(5)} ${String(r.blanks).padStart(5)} ${r.sd.toFixed(1).padStart(5)} ${r.mean.toFixed(1).padStart(6)}`);
    }
  }
}
console.log(`\nSYNTH mean: shown ${pct(total.shown / total.n)} right ${pct(total.right / total.n)} flips ${(total.flips / total.n).toFixed(2)}/note blanks ${(total.blanks / total.n).toFixed(2)}/note`);
console.log(`SYNTH worst: shown ${pct(worst.shown)} right ${pct(worst.right)} flips ${worst.flips} blanks ${worst.blanks}`);

// A NOTE THAT CHANGES MUST STILL CHANGE THE DIAL. Holding on through glitches
// is only half a tuner; the other half is letting go when the player really
// moves. A scale bowed note by note with no air between the notes, at a
// steady-note pace, a quick one and a soft one, scored as how long after each new
// note began the dial named it — and whether it ever did.
{
  console.log('\nscale        notes  named  median lag  worst lag');
  for (const [label, perSec, gainS] of [['slow  2/s', 2, 0.05], ['quick 6/s', 6, 0.05], ['soft  4/s', 4, 0.004]]) {
    const STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0];
    const parts = [silence(0.5)];
    const starts = [];
    let t = 0.5;
    for (const step of STEPS) {
      parts.push(bowed(48 + step, 1 / perSec, { gain: gainS, vibrato: 10 }));
      starts.push({ midi: 48 + step, at: t });
      t += 1 / perSec;
    }
    parts.push(silence(0.5));
    const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { audio.set(p, o); o += p.length; }
    const shown = run(audio);
    const lags = [];
    let missed = 0;
    starts.forEach((s, i) => {
      const end = s.at + 1 / perSec;
      const hit = shown.find((r) => r.time >= s.at - 0.05 && r.time < end && r.note === midiToName(s.midi)
        && (i === 0 || r.time > starts[i - 1].at + 0.02));
      if (hit) lags.push(Math.max(0, hit.time - s.at)); else missed++;
    });
    lags.sort((a, b) => a - b);
    const ms = (x) => `${Math.round(1000 * x)}ms`;
    console.log(`${label.padEnd(12)} ${String(STEPS.length).padStart(5)} ${String(STEPS.length - missed).padStart(6)}  ${ms(lags[lags.length >> 1] ?? NaN).padStart(10)} ${ms(lags.at(-1) ?? NaN).padStart(10)}`);
  }
}

// NOTHING PLAYED, NOTHING SHOWN. The floor is lower than it was, so a room
// with a fan in it and a bit of hiss has to be proved to stay on "listening".
{
  const n = 5 * SR;
  const room = new Float32Array(n);
  let brown = 0;
  for (let i = 0; i < n; i++) {
    brown = brown * 0.995 + (rand() * 2 - 1) * 0.02;
    room[i] = 0.01 * (rand() * 2 - 1) + brown * 0.3;
  }
  const shown = run(room);
  console.log(`\nroom noise   ${shown.filter((s) => s.note).length} of ${shown.length} readings showed a note`);
}

// Real playing: pitch unknown, so what is scored is flicker — while the
// recording is clearly sounding, how often the screen blanks, and how often a
// note appears for a reading or two and is replaced by the one it interrupted.
function readWav(path) {
  const buf = readFileSync(path);
  let p = 12;
  while (p < buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'data') {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(p + 8 + 2 * i) / 32768;
      return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`no data in ${path}`);
}

if (loopsDir) {
  console.log('\nrecording                     loud  shown  blips  blank');
  for (const file of readdirSync(loopsDir).filter((f) => f.endsWith('.wav'))) {
    const shown = run(readWav(join(loopsDir, file)));
    const peak = Math.max(...shown.map((s) => s.rms));
    const loud = shown.filter((s) => s.rms > peak * 0.15);
    let blips = 0;
    let blanks = 0;
    for (let i = 1; i < shown.length - 2; i++) {
      const [a, b, c, d] = [shown[i - 1], shown[i], shown[i + 1], shown[i + 2]];
      if (!(b.rms > peak * 0.15)) continue;
      if (a.note && b.note && b.note !== a.note && (c.note === a.note || d.note === a.note)) blips++;
      if (a.note && !b.note && (c.note || d.note)) blanks++;
    }
    const on = loud.filter((s) => s.note).length / loud.length;
    const secs = loud.length * 512 / SR;
    console.log(`${file.padEnd(28)} ${secs.toFixed(1).padStart(5)}s ${pct(on)}  ${(blips / secs).toFixed(2).padStart(5)}/s ${(blanks / secs).toFixed(2).padStart(5)}/s`);
  }
}
