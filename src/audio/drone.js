import { audioContext } from './context.js';

// Sustained reference drone (TonalEnergy-style tone generator, minimal
// version): a softened sawtooth-ish timbre with smooth on/off ramps and
// live-retunable frequency, for practicing intonation against a held pitch.

let ctx = null;
let osc = null;
let gain = null;

const HARMONICS = 8;
const LEVEL = 0.16;
const RAMP = 0.12;

export function startDrone(frequency) {
  ctx = audioContext();
  if (osc) {
    osc.frequency.setTargetAtTime(frequency, ctx.currentTime, 0.03);
    return;
  }
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let h = 1; h <= HARMONICS; h++) imag[h] = 1 / h ** 1.5;

  osc = ctx.createOscillator();
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
  osc.frequency.value = frequency;
  gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + RAMP);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
}

export function stopDrone() {
  if (!osc) return;
  const stopping = osc;
  gain.gain.setTargetAtTime(0, ctx.currentTime, RAMP / 3);
  setTimeout(() => stopping.stop(), RAMP * 2000);
  osc = null;
  gain = null;
}

export function droneActive() {
  return osc !== null;
}
