import { setAudioSessionType, releaseCaptureSession } from './context.js';

// Mic capture: getUserMedia → AudioWorklet → onChunk(Float32Array).
// Returns { sampleRate, stop }.
//
// The stream is handed back as soon as nothing is listening. A held stream is
// quicker to restart and stops a browser re-prompting, but it also keeps iOS's
// orange microphone indicator lit for as long as the app is open — which tells
// the person holding the phone that it is listening when it is not. Installed
// on a phone the system remembers the grant, so there is nothing to save by
// holding on; it stays available as a preference and defaults to off.

const KEY = 'micRetain';

let held = null;      // { stream, ctx, worklet, source } parked between uses
let inUse = false;
let primed = null;    // context built during a user gesture, waiting for open()

// Off unless asked for. Holding the stream between uses keeps iOS's orange
// microphone indicator lit the whole time the app is open — on the tuner, on
// the metronome, sitting on the home screen — which says the app is listening
// when it is not. The prompt this was avoiding is a web problem; installed on a
// phone the system remembers the grant, so letting go costs nothing.
export function micRetains() {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setMicRetains(on) {
  try {
    globalThis.localStorage?.setItem(KEY, on ? 'on' : 'off');
  } catch { /* survivable */ }
  if (!on) releaseMic();
}

// Hand the hardware back for real: the browser's mic indicator goes out and
// the next start asks again.
export function releaseMic() {
  if (!held || inUse) return;
  held.stream.getTracks().forEach((t) => t.stop());
  held.ctx.close().catch(() => {});
  held = null;
  releaseCaptureSession();
}

export function micIsHeld() {
  return held !== null;
}

// A parked session can still have been revoked (the user pulled permission, a
// headset was unplugged, iOS interrupted us) — those tracks read as 'ended'.
function usable(session) {
  return session?.stream.getTracks().some((t) => t.readyState === 'live');
}

// Call this synchronously from inside a user gesture, BEFORE any await.
//
// iOS lets an AudioContext run only if it was constructed while the tap that
// asked for it was still live. Everything capture used to do first outlives
// that window — the permission sheet sits there until the user reads it, and a
// count-in is seconds long — so a context built afterwards is born suspended
// and resume() is refused. The worklet then never runs: no chunks arrive, the
// screen says "recording", and the take is silent. That was the whole of the
// "I allowed the microphone and it still didn't hear me" bug on iPad.
//
// Building the context at the tap costs nothing if capture never starts (it is
// reused by the next attempt) and is what makes the first recording work.
export function prepareCapture() {
  const ctx = held?.ctx ?? (primed ??= newCaptureContext()).ctx;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

function newCaptureContext() {
  const ctx = new AudioContext();
  // start fetching the worklet now too; open() awaits it later
  const module = ctx.audioWorklet.addModule(new URL('./capture-processor.js', import.meta.url));
  return { ctx, module };
}

async function open() {
  // A caller outside a gesture still gets a context — just one that may refuse
  // to run, which startCapture reports rather than swallowing.
  const { ctx, module } = primed ?? newCaptureContext();
  primed = null;
  // Asked before it is used, so the answer is a sentence rather than "undefined
  // is not an object". A page served over plain http has no microphone at all,
  // and neither does a web app iOS has decided is not allowed one.
  if (!navigator.mediaDevices?.getUserMedia) {
    ctx.close().catch(() => {});
    throw new Error(
      'this device will not open the microphone for the app as installed'
      + ' — open the site in Safari itself and record there, or add it to the home screen again',
    );
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    await module;
    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'capture-processor');
    source.connect(worklet);
    return { stream, ctx, source, worklet };
  } catch (err) {
    ctx.close().catch(() => {});
    throw err;
  }
}

// Settle the permission ahead of time and park the stream without listening to
// it. Recording then has nothing left to negotiate: no prompt arriving in the
// middle of a count-in, and prepareCapture() at the Record tap resumes a
// context that already exists rather than building one too late to run.
export async function ensureMic() {
  if (held && usable(held)) return;
  if (held) {
    held.ctx.close().catch(() => {});
    held = null;
  }
  setAudioSessionType('play-and-record');
  const session = await open();
  held = session;
  session.parked = true;
  session.stream.getTracks().forEach((t) => { t.enabled = false; });
  session.ctx.suspend().catch(() => {});
  releaseCaptureSession();
}

// Something took the microphone away mid-session: a phone call, Siri, AirPods
// disconnecting, the OS reclaiming the input. The track ends and the chunks
// simply stop — which used to look exactly like a quiet passage, so a take
// silently truncated while the screen still said "recording". Callers pass
// onInterrupted so they can stop and say what happened.
//
// The screen going dark is NOT one of those things, and it used to be treated
// as one. A locked screen suspends the audio context and mutes the input track
// exactly the way an interruption does, so putting the phone face down mid-take
// — or simply letting it dim while playing a long movement — ended the
// recording and threw up "recording was interrupted". So a suspend or a mute
// that arrives while the app is out of sight is taken as a pause: nothing is
// said, nothing is stopped, and coming back resumes it (see the
// visibilitychange handler at the bottom). Only a track that has actually ENDED
// is an interruption on the spot — that one never comes back.
function watchForInterruption(session, onInterrupted) {
  const fire = (reason) => {
    if (session.interrupted) return;
    session.interrupted = true;
    onInterrupted?.(reason);
  };
  session.fire = fire;
  // "Wait for it to come back" rather than "stop and say so": only for a take,
  // and only while the app is out of sight.
  const waits = () => session.throughLock
    && globalThis.document?.visibilityState === 'hidden';
  for (const track of session.stream.getTracks()) {
    track.onended = () => fire('the microphone was taken by something else');
    track.onmute = () => { if (!waits()) fire('the microphone went silent'); };
  }
  session.ctx.onstatechange = () => {
    if (session.ctx.state !== 'suspended' || session.parked) return;
    // Ask for it back first. In the foreground this is the audio session being
    // re-activated under us and the resume takes; if it does not, something
    // really has taken the microphone.
    session.ctx.resume().then(
      () => { if (session.ctx.state !== 'running' && !waits()) fire('recording was interrupted'); },
      () => { if (!waits()) fire('recording was interrupted'); },
    );
  };
}

// Back from a locked screen or another app. Whatever was suspended or muted
// while we were away is picked back up, and only a microphone that will not
// come back at all is reported as an interruption.
function resumeAfterHiding() {
  const session = held;
  if (!session || !inUse || session.parked || session.interrupted) return;
  const live = session.stream.getTracks().some((t) => t.readyState === 'live');
  if (!live) {
    session.fire?.('the microphone was taken by something else');
    return;
  }
  session.stream.getTracks().forEach((t) => { t.enabled = true; });
  if (session.ctx.state !== 'running') {
    session.ctx.resume().catch(() => session.fire?.('recording was interrupted'));
  }
  // A mute that was forgiven on the way out has to be checked on the way back:
  // if the input is still silent a moment after returning, it is not coming
  // back on its own and saying nothing would be the old silent-truncation bug
  // in a new place.
  setTimeout(() => {
    if (!inUse || session.parked || session.interrupted) return;
    if (session.stream.getTracks().some((t) => t.muted)) {
      session.fire?.('the microphone went silent');
    }
  }, 800);
}

// throughLock: this session is a TAKE, so it survives the screen locking and
// the app being put away — see watchForInterruption. A tuner reading nobody is
// looking at gets no such protection: it hands the microphone back like it
// always did, indicator and all.
export async function startCapture(onChunk, { onInterrupted, throughLock = false } = {}) {
  // record-capable session only while the mic is live — it halves iOS
  // output volume, so playback-only features must not inherit it
  setAudioSessionType('play-and-record');

  if (held && !usable(held)) {
    held.ctx.close().catch(() => {});
    held = null;
  }
  const session = held ?? await open();
  held = session;
  inUse = true;

  session.parked = false;
  session.interrupted = false;
  session.throughLock = throughLock;
  session.stream.getTracks().forEach((t) => { t.enabled = true; });
  // auto-started tuners run outside a user gesture — nudge the context awake
  if (session.ctx.state !== 'running') await session.ctx.resume().catch(() => {});
  // A context that will not run produces no chunks at all, which used to look
  // exactly like a player who wasn't playing. Say so instead: the callers turn
  // this into a visible message and a button that asks again from a real tap.
  if (session.ctx.state !== 'running') {
    inUse = false;
    session.parked = true;
    throw new Error('audio is blocked until you tap again');
  }
  session.worklet.port.onmessage = (e) => onChunk(e.data);
  watchForInterruption(session, onInterrupted);

  let stopped = false;
  return {
    sampleRate: session.ctx.sampleRate,
    stop: () => {
      if (stopped) return;
      stopped = true;
      inUse = false;
      session.parked = true; // our own suspend, not an interruption
      session.throughLock = false; // nothing is being recorded to protect now
      session.worklet.port.onmessage = null;
      session.ctx.onstatechange = null;
      session.stream.getTracks().forEach((t) => { t.onended = null; t.onmute = null; });
      if (micRetains()) {
        // Parked, not closed: the chunks stop arriving and the context is
        // suspended, so nothing is being listened to, but the permission
        // grant survives to the next start.
        session.stream.getTracks().forEach((t) => { t.enabled = false; });
        session.ctx.suspend().catch(() => {});
        releaseCaptureSession();
      } else {
        releaseMic();
      }
    },
  };
}

// Leaving the page for good hands the mic back rather than letting a
// backgrounded tab sit on it.
//
// It no longer forces the release out from under a take. pagehide fires when a
// webview is frozen as well as when it is torn down, and clearing inUse first
// meant a recording that outlived a screen lock had its microphone taken away
// by its own app. A page that is genuinely going away takes the stream with it.
globalThis.addEventListener?.('pagehide', () => {
  if (!held?.throughLock) inUse = false;
  releaseMic();
});

// Swiped away or sent to the home screen. releaseMic bows out while a take is
// actually recording, so this hands back a parked stream without cutting one
// short — and the indicator goes out, because by then nothing is listening.
// Coming back picks up anything the system suspended while we were gone.
globalThis.addEventListener?.('visibilitychange', () => {
  if (globalThis.document?.visibilityState === 'hidden') releaseMic();
  else resumeAfterHiding();
});
