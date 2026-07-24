// Mic capture: getUserMedia → AudioWorklet → onChunk(Float32Array).
// Returns { sampleRate, stop }.
export async function startCapture(onChunk) {
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
  worklet.port.onmessage = (e) => onChunk(e.data);
  source.connect(worklet);

  return {
    sampleRate: ctx.sampleRate,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
