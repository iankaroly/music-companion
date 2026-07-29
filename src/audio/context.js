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
// routing), so we claim 'playback' — full media volume, still beats the
// silent switch — and only switch to 'play-and-record' while the mic runs.
//
// But claiming it is not free, and claiming it CONSTANTLY was a bug the user
// felt on every app switch: a running context holding a 'playback' session is
// the system's definition of an app playing media. It routes the hardware
// volume keys to media, which is what made iOS play its mute/unmute blip and
// flash the speaker HUD in the notch every time the app was swiped away, and
// it puts the app on the lock screen as though a track were paused there.
//
// So the session is a claim we make while sound is actually happening and give
// back when it isn't. Anything that produces sound takes a hold (holdAudio) and
// drops it when it stops; when the last hold goes the context is suspended and
// the session handed back to the system. Nothing is claimed at rest — which is
// most of the time, since a tuner and a chart make no sound at all.

const IDLE_MS = 1200;   // grace period, so gaps between notes don't churn it
const IDLE_TYPE = 'auto'; // "no opinion" — the system stops calling us a player

let sessionType = null;
let idleTimer = null;
const holds = new Set();

export function setAudioSessionType(type) {
  // Re-assigning the same type still re-activates the session on iOS, and this
  // used to run on every single audioContext() call. Assign only on a change.
  if (type === sessionType) return;
  sessionType = type;
  if (navigator.audioSession) {
    try { navigator.audioSession.type = type; } catch { /* older iOS */ }
  }
}

export function audioContext() {
  audioContext.ctx ??= new AudioContext();
  return audioContext.ctx;
}

// Called the moment anything audible is wired up. Claims the session, wakes
// the context, and cancels any pending sleep.
export function wakeAudio() {
  const ctx = audioContext();
  clearTimeout(idleTimer);
  idleTimer = null;
  // never downgrade the mic's session while it is capturing
  if (sessionType !== 'play-and-record') setAudioSessionType('playback');
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

function sleepAudio() {
  idleTimer = null;
  if (holds.size || sessionType === 'play-and-record') return;
  audioContext.ctx?.suspend().catch(() => {});
  setAudioSessionType(IDLE_TYPE);
  // Some browsers surface a paused Web Audio app to the lock screen through
  // the Media Session API; say plainly that there is nothing to show.
  try {
    if (navigator.mediaSession) {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    }
  } catch { /* not supported */ }
}

function scheduleSleep(delay = IDLE_MS) {
  clearTimeout(idleTimer);
  idleTimer = holds.size ? null : setTimeout(sleepAudio, delay);
}

// Anything that makes a sound holds the session for as long as it lasts:
// 'drone', 'metronome', 'playback'. Re-holding the same key is a no-op, so
// callers can be sloppy about matching every start with exactly one stop.
export function holdAudio(key) {
  holds.add(key);
  return wakeAudio();
}

export function releaseAudio(key) {
  holds.delete(key);
  scheduleSleep();
}

export function audioIsHeld() {
  return holds.size > 0;
}

// The mic gives the session back when it stops capturing. It must NOT hand it
// back as 'playback' — that is a claim to be playing media, and the tuner
// stopping is precisely a moment when nothing is.
export function releaseCaptureSession() {
  setAudioSessionType(holds.size ? 'playback' : IDLE_TYPE);
  if (holds.size === 0) sleepAudio();
}

// Swiping away with nothing playing should leave no trace of us behind, and
// there is no reason to wait out the grace period for it.
globalThis.addEventListener?.('visibilitychange', () => {
  if (globalThis.document?.visibilityState === 'hidden' && holds.size === 0) sleepAudio();
});

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
  // Everything audible connects here, so this is the one place guaranteed to
  // run at the moment a sound is created — the safe place to wake up.
  const ctx = wakeAudio();
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
