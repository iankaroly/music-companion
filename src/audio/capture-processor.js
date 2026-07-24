// AudioWorklet processor: forwards raw 128-sample mic chunks to the main
// thread, where the tested Analyzer pipeline runs. Kept import-free because
// worklet module graphs are the least portable part of the platform.
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
