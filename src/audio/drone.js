import { audioContext, masterOut } from './context.js';

// Pitch pipe / drone generator (TonalEnergy-style): any number of chromatic
// notes can sound at once, so whole chords can be held and tuned against.
// Softened sawtooth-ish timbre, smooth on/off ramps, live-retunable.

const LEVEL = 0.3;
const RAMP = 0.12;

// Synthesized instrument voices: harmonic recipes rather than samples.
const TIMBRES = {
  strings: Array.from({ length: 9 }, (_, h) => (h === 0 ? 0 : 1 / h ** 1.5)),
  reed: Array.from({ length: 10 }, (_, h) => (h % 2 === 1 ? 1 / h : 0)), // odd harmonics, clarinet-like
  organ: [0, 1, 0.6, 0.9, 0.5, 0, 0.4, 0, 0.3],
  pure: [0, 1],
};

let timbre = 'strings';

export function setDroneTimbre(name) {
  if (!TIMBRES[name]) return;
  timbre = name;
  // sounding drones morph to the new voice immediately — no retoggle needed
  if (active.size) {
    const wave = makeWave(audioContext());
    for (const voice of active.values()) voice.osc.setPeriodicWave(wave);
  }
}

const active = new Map(); // note name -> { osc, gain }

function makeWave(ctx) {
  const recipe = TIMBRES[timbre];
  const real = new Float32Array(recipe.length);
  return ctx.createPeriodicWave(real, Float32Array.from(recipe));
}

export function toggleDroneNote(name, frequency) {
  if (active.has(name)) {
    stopDroneNote(name);
    return false;
  }
  const ctx = audioContext();
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(makeWave(ctx));
  osc.frequency.value = frequency;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + RAMP);
  osc.connect(gain).connect(masterOut());
  osc.start();
  active.set(name, { osc, gain });
  return true;
}

function stopDroneNote(name) {
  const voice = active.get(name);
  if (!voice) return;
  active.delete(name);
  const ctx = audioContext();
  voice.gain.gain.setTargetAtTime(0, ctx.currentTime, RAMP / 3);
  setTimeout(() => voice.osc.stop(), RAMP * 2000);
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
    }
  }
}

// Glide one sounding voice to a new pitch (no-op if it isn't sounding).
export function retuneDroneNote(name, frequency) {
  const voice = active.get(name);
  if (voice && Number.isFinite(frequency) && frequency > 0) {
    voice.osc.frequency.setTargetAtTime(frequency, audioContext().currentTime, 0.03);
  }
}

export function activeDroneNotes() {
  return new Set(active.keys());
}
