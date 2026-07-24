export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
    this.writeIndex = 0;
    this.written = 0;
  }

  write(chunk) {
    // Only the tail of an oversized chunk can survive anyway.
    const start = Math.max(0, chunk.length - this.capacity);
    for (let i = start; i < chunk.length; i++) {
      this.buffer[this.writeIndex] = chunk[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
    }
    this.written = Math.min(this.written + chunk.length, this.capacity);
  }

  latest(n) {
    const out = new Float32Array(n);
    const available = Math.min(n, this.written);
    for (let i = 0; i < available; i++) {
      const idx = (this.writeIndex - available + i + this.capacity * 2) % this.capacity;
      out[n - available + i] = this.buffer[idx];
    }
    return out;
  }

  get filled() {
    return this.written;
  }
}
