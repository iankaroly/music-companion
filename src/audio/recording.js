const MAX_SECONDS = 600;

// Keeps the session's raw audio in memory so the report can play back the
// exact moment a note was out of tune. Mono Float32 at the capture rate:
// ten minutes ≈ 100 MB ceiling, a normal scale session is a few MB.
export class Recorder {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.chunks = [];
    this.length = 0;
  }

  push(chunk) {
    if (this.length >= MAX_SECONDS * this.sampleRate) return;
    this.chunks.push(chunk.slice(0));
    this.length += chunk.length;
  }

  get duration() {
    return this.length / this.sampleRate;
  }

  // Returns the samples between two times (seconds), clamped to bounds.
  extract(start, end) {
    const startSample = Math.max(0, Math.floor(start * this.sampleRate));
    const endSample = Math.min(this.length, Math.ceil(end * this.sampleRate));
    if (endSample <= startSample) return new Float32Array(0);

    const out = new Float32Array(endSample - startSample);
    let chunkStart = 0;
    for (const chunk of this.chunks) {
      const chunkEnd = chunkStart + chunk.length;
      if (chunkEnd > startSample && chunkStart < endSample) {
        const from = Math.max(0, startSample - chunkStart);
        const to = Math.min(chunk.length, endSample - chunkStart);
        out.set(chunk.subarray(from, to), chunkStart + from - startSample);
      }
      chunkStart = chunkEnd;
      if (chunkStart >= endSample) break;
    }
    return out;
  }
}
