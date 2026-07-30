import { setAudioSessionType, releaseCaptureSession } from './context.js';

// Mic capture: getUserMedia → AudioWorklet → onChunk(Float32Array).
// Returns { sampleRate, stop }.
//
// Every getUserMedia call is a fresh permission decision for the browser, and
// the app asks for the mic constantly — the tuner starts itself on every visit
// to its tab, and Record asks again. Handing the same stream back instead of
// tearing it down is what stops the prompt (and the "recording" chrome)
// reappearing on each of those. The trade-off is that iOS keeps a
// record-capable route open while a track is live, which historically cost
// output volume, so it's a preference: see MIC_KEY below and the settings sheet.

const KEY = 'micRetain';

let held = null;      // { stream, ctx, worklet, source } parked between uses
let inUse = false;
let primed = null;    // context built during a user gesture, waiting for open()

export function micRetains() {
  try {
    return globalThis.localStorage?.getItem(KEY) !== 'off';
  } catch {
    return true;
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
function watchForInterruption(session, onInterrupted) {
  const fire = (reason) => {
    if (session.interrupted) return;
    session.interrupted = true;
    onInterrupted?.(reason);
  };
  for (const track of session.stream.getTracks()) {
    track.onended = () => fire('the microphone was taken by something else');
    track.onmute = () => fire('the microphone went silent');
  }
  session.ctx.onstatechange = () => {
    // iOS suspends the capture context when the audio session is interrupted
    if (session.ctx.state === 'suspended' && !session.parked) {
      fire('recording was interrupted');
    }
  };
}

export async function startCapture(onChunk, { onInterrupted } = {}) {
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
globalThis.addEventListener?.('pagehide', () => {
  inUse = false;
  releaseMic();
});
