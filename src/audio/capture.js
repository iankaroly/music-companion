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

async function open() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(new URL('./capture-processor.js', import.meta.url));
  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, 'capture-processor');
  source.connect(worklet);
  return { stream, ctx, source, worklet };
}

export async function startCapture(onChunk) {
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

  session.stream.getTracks().forEach((t) => { t.enabled = true; });
  // auto-started tuners run outside a user gesture — nudge the context awake
  if (session.ctx.state !== 'running') await session.ctx.resume().catch(() => {});
  session.worklet.port.onmessage = (e) => onChunk(e.data);

  let stopped = false;
  return {
    sampleRate: session.ctx.sampleRate,
    stop: () => {
      if (stopped) return;
      stopped = true;
      inUse = false;
      session.worklet.port.onmessage = null;
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
