import { setAudioSessionType } from './context.js';

// Mic capture: getUserMedia → AudioWorklet → onChunk(Float32Array).
// Returns { sampleRate, stop }.
export async function startCapture(onChunk) {
  // record-capable session only while the mic is live — it halves iOS
  // output volume, so playback-only features must not inherit it
  setAudioSessionType('play-and-record');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const ctx = new AudioContext();
  // auto-started tuners run outside a user gesture — nudge the context awake
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  await ctx.audioWorklet.addModule(new URL('./capture-processor.js', import.meta.url));

  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, 'capture-processor');
  worklet.port.onmessage = (e) => onChunk(e.data);
  source.connect(worklet);

  return {
    sampleRate: ctx.sampleRate,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      setAudioSessionType('playback');
    },
  };
}
