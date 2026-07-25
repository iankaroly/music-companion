import { audioContext, masterOut } from './context.js';

// Pitch pipe / drone generator (TonalEnergy-style): any number of chromatic
// notes can sound at once, so whole chords can be held and tuned against.
// Softened sawtooth-ish timbre, smooth on/off ramps, live-retunable.

const HARMONICS = 8;
const LEVEL = 0.3;
const RAMP = 0.12;

const active = new Map(); // note name -> { osc, gain }

function makeWave(ctx) {
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let h = 1; h <= HARMONICS; h++) imag[h] = 1 / h ** 1.5;
  return ctx.createPeriodicWave(real, imag);
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

// Re-pitch every sounding note (octave or A4 change).
export function retuneDrones(frequencyFor) {
  const ctx = audioContext();
  for (const [name, voice] of active) {
    voice.osc.frequency.setTargetAtTime(frequencyFor(name), ctx.currentTime, 0.03);
  }
}

export function activeDroneNotes() {
  return new Set(active.keys());
}
