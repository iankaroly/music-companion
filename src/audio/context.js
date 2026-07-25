// One shared output AudioContext for the whole app.
//
// iOS specifics this solves:
// - The ring/silent switch mutes Web Audio unless the page declares a
//   playback-capable audio session (iOS 16.4+ API).
// - Contexts start suspended and get interrupted when the mic session
//   ends; resume() must be called from inside the user gesture.
// - Safari caps the number of live AudioContexts — sharing one keeps us
//   under it alongside the mic capture context.
export function audioContext() {
  if (navigator.audioSession) {
    try { navigator.audioSession.type = 'play-and-record'; } catch { /* older iOS */ }
  }
  audioContext.ctx ??= new AudioContext();
  if (audioContext.ctx.state !== 'running') audioContext.ctx.resume();
  return audioContext.ctx;
}

// Everything audible routes through masterGain → limiter → speakers, so
// the volume slider can push well past 1.0 without clipping distortion.
let masterGain = null;

export function masterOut() {
  const ctx = audioContext();
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = getVolume();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    masterGain.connect(limiter).connect(ctx.destination);
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
