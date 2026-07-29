import { audioContext, masterOut, droneLevel, holdAudio, releaseAudio } from './context.js';

// Pitch pipe / drone generator (TonalEnergy-style): any number of chromatic
// notes can sound at once, so whole chords can be held and tuned against.
// Softened sawtooth-ish timbre, smooth on/off ramps, live-retunable.

// Set so one drone lands just at the master ceiling's knee: as loud as this
// can be before the shaper starts working on it.
const LEVEL = 0.38;
const RAMP = 0.12;

// Synthesized instrument voices: harmonic recipes rather than samples.
// Sixteen partials rather than nine: the default drone octave puts the
// fundamental near 110 Hz, and on a phone speaker a tone that low is carried
// almost entirely by its upper harmonics — the ones that used to run out.
const TIMBRES = {
  strings: Array.from({ length: 17 }, (_, h) => (h === 0 ? 0 : 1 / h ** 1.5)),
  reed: Array.from({ length: 18 }, (_, h) => (h % 2 === 1 ? 1 / h : 0)), // odd harmonics, clarinet-like
  organ: [0, 1, 0.6, 0.9, 0.5, 0, 0.4, 0, 0.3, 0, 0.22, 0, 0.16, 0, 0.12, 0, 0.09],
  pure: [0, 1],
};

// A phone speaker is a few millimetres across and puts out essentially nothing
// below ~400 Hz, so a low drone reaches the ear only through whatever it has in
// the band the speaker can actually move. Low fundamentals therefore get their
// mid partials lifted — the tone stays the same pitch and reads as the same
// instrument, it just stops disappearing on the device it's played on.
function presence(fundamental, harmonic) {
  if (fundamental >= 320) return 1; // already in the speaker's range
  const deficit = Math.min(1, (320 - fundamental) / 240); // 0 at 320 Hz, 1 at 80
  const hz = fundamental * harmonic;
  if (hz < 400 || hz > 3500) return 1;
  return 1 + deficit * 2.2;
}

let timbre = 'strings';

export function setDroneTimbre(name) {
  if (!TIMBRES[name]) return;
  timbre = name;
  // sounding drones morph to the new voice immediately — no retoggle needed
  for (const voice of active.values()) {
    voice.osc.setPeriodicWave(makeWave(audioContext(), voice.osc.frequency.value));
  }
}

const active = new Map(); // note name -> { osc, gain }

function makeWave(ctx, frequency) {
  const recipe = TIMBRES[timbre];
  const real = new Float32Array(recipe.length);
  const imag = new Float32Array(recipe.length);
  for (let h = 1; h < recipe.length; h++) imag[h] = recipe[h] * presence(frequency, h);
  return ctx.createPeriodicWave(real, imag);
}

// The lift above depends on the fundamental, so a voice that moves a long way
// — an octave switch, or the cursor drone crossing strings — needs its wave
// rebuilt as well as its frequency set. A few semitones isn't worth the churn.
function reshape(voice, frequency) {
  if (Math.abs(Math.log2(frequency / (voice.shaped || frequency))) < 0.25) return;
  voice.shaped = frequency;
  voice.osc.setPeriodicWave(makeWave(audioContext(), frequency));
}

export function toggleDroneNote(name, frequency) {
  if (active.has(name)) {
    stopDroneNote(name);
    return false;
  }
  const ctx = audioContext();
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(makeWave(ctx, frequency));
  osc.frequency.value = frequency;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(LEVEL * droneLevel(), ctx.currentTime + RAMP);
  osc.connect(gain).connect(masterOut());
  osc.start();
  active.set(name, { osc, gain, shaped: frequency });
  holdAudio('drone');
  return true;
}

function stopDroneNote(name) {
  const voice = active.get(name);
  if (!voice) return;
  active.delete(name);
  const ctx = audioContext();
  voice.gain.gain.setTargetAtTime(0, ctx.currentTime, RAMP / 3);
  setTimeout(() => voice.osc.stop(), RAMP * 2000);
  // the fade has to finish before the context may be suspended under it
  if (active.size === 0) setTimeout(() => releaseAudio('drone'), RAMP * 2000);
}

export function stopAllDrones() {
  for (const name of [...active.keys()]) stopDroneNote(name);
}

// Re-pitch every sounding note (octave or A4 change). Voices whose key the
// mapper can't resolve (e.g. the coach's drill drones) keep their pitch.
export function retuneDrones(frequencyFor) {
  const ctx = audioContext();
  for (const [name, voice] of active) {
    let f = null;
    try { f = frequencyFor(name); } catch { /* not a pipe note */ }
    if (Number.isFinite(f) && f > 0) {
      voice.osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.03);
      reshape(voice, f);
    }
  }
}

// Glide one sounding voice to a new pitch (no-op if it isn't sounding).
export function retuneDroneNote(name, frequency) {
  const voice = active.get(name);
  if (voice && Number.isFinite(frequency) && frequency > 0) {
    voice.osc.frequency.setTargetAtTime(frequency, audioContext().currentTime, 0.03);
    reshape(voice, frequency);
  }
}

// The settings sheet's drone trim, applied to whatever is already sounding.
export function refreshDroneLevel() {
  const ctx = audioContext();
  for (const voice of active.values()) {
    voice.gain.gain.setTargetAtTime(LEVEL * droneLevel(), ctx.currentTime, 0.05);
  }
}

export function activeDroneNotes() {
  return new Set(active.keys());
}
