// One shared output AudioContext for the whole app.
//
// iOS specifics this solves:
// - The ring/silent switch mutes Web Audio unless the page declares a
//   playback-capable audio session (iOS 16.4+ API).
// - Contexts start suspended and get interrupted when the mic session
//   ends; resume() must be called from inside the user gesture.
// - Safari caps the number of live AudioContexts — sharing one keeps us
//   under it alongside the mic capture context.
// iOS plays 'play-and-record' sessions at a much lower output level (call
// routing), so we stay in 'playback' — full media volume, still beats the
// silent switch — and only switch to 'play-and-record' while the mic runs.
let sessionType = 'playback';

export function setAudioSessionType(type) {
  sessionType = type;
  if (navigator.audioSession) {
    try { navigator.audioSession.type = type; } catch { /* older iOS */ }
  }
}

export function audioContext() {
  setAudioSessionType(sessionType);
  audioContext.ctx ??= new AudioContext();
  if (audioContext.ctx.state !== 'running') audioContext.ctx.resume();
  return audioContext.ctx;
}

// Everything audible routes through masterGain → limiter → makeup → ceiling →
// speakers, so the volume slider can push well past 1.0 without clipping.
//
// The makeup stage is not optional, and its absence was the bug behind both
// "the drone is too quiet on max volume" and "the metronome is too soft". A
// DynamicsCompressorNode has no makeup gain of its own, so a limiter in front
// of the destination is pure attenuation: at threshold −6 dB and ratio 12 a
// sustained drone came out at 0.64 peak / 0.46 RMS however far the volume
// slider was pushed. Putting the removed gain back after the limiter is worth
// about 5 dB on everything the app plays.
//
// The ceiling is what makes that safe. Peaks past full scale are truncated by
// the hardware — which the old chain was already doing to the metronome click,
// measured at 1.08 — and a square edge is the worst-sounding way to lose them.
// The shaper below is exactly linear up to 0.7 and bends smoothly to 1.0 after
// it, so ordinary playing is untouched, a chord of six drones runs out of
// headroom gracefully instead of buzzing, and nothing can ever leave here
// above full scale.
const THRESHOLD_DB = -4;
const RATIO = 12;
const KNEE = 0.7;
// what the limiter does to a full-scale peak, undone
const MAKEUP = 10 ** (-(THRESHOLD_DB + (0 - THRESHOLD_DB) / RATIO) / 20) * 0.96;

function ceilingCurve(n = 4096) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= KNEE
      ? x
      : Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
  }
  return curve;
}

let masterGain = null;

export function masterOut() {
  const ctx = audioContext();
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = getVolume();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = THRESHOLD_DB;
    limiter.knee.value = 2;
    limiter.ratio.value = RATIO;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    const makeup = ctx.createGain();
    makeup.gain.value = MAKEUP;
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = ceilingCurve();
    ceiling.oversample = '4x'; // the bend makes harmonics; don't fold them back
    masterGain.connect(limiter).connect(makeup).connect(ceiling).connect(ctx.destination);
  }
  return masterGain;
}

export function getVolume() {
  const v = Number(localStorage.getItem('volume'));
  return Number.isFinite(v) && v > 0 ? v : 1.6;
}

export function setVolume(v) {
  localStorage.setItem('volume', String(v));
  if (masterGain) masterGain.gain.setTargetAtTime(v, audioContext().currentTime, 0.02);
}

// Per-source trims that ride on top of the master. Kept here rather than in
// each module so the settings sheet has one place to set them and everything
// picks the new value up on its next note.
function trim(key, fallback) {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const droneLevel = () => trim('droneLevel', 1);
export const clickLevel = () => trim('clickLevel', 1);
