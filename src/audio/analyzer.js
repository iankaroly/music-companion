import { RingBuffer } from './ring-buffer.js';
import { yin } from './yin.js';

// Consumes arbitrary-size audio chunks, emits a pitch reading every hopSize
// samples once windowSize samples have accumulated. Pure logic — the same
// path runs on mic input and on synthesized demo audio.
export class Analyzer {
  constructor(sampleRate, options = {}) {
    const { windowSize = 4096, hopSize = 1024, yinOptions = {} } = options;
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.hopSize = hopSize;
    this.yinOptions = yinOptions;
    this.ring = new RingBuffer(windowSize);
    this.totalSamples = 0;
    this.sinceLastHop = 0;
  }

  push(chunk) {
    const readings = [];
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(this.hopSize - this.sinceLastHop, chunk.length - offset);
      this.ring.write(chunk.subarray(offset, offset + take));
      this.totalSamples += take;
      this.sinceLastHop += take;
      offset += take;

      if (this.sinceLastHop === this.hopSize) {
        this.sinceLastHop = 0;
        if (this.totalSamples >= this.windowSize) {
          readings.push(this.analyze());
        }
      }
    }
    return readings;
  }

  analyze() {
    const window = this.ring.latest(this.windowSize);
    let sumSq = 0;
    for (let i = 0; i < window.length; i++) sumSq += window[i] * window[i];
    const rms = Math.sqrt(sumSq / window.length);
    const { frequency, confidence } = yin(window, this.sampleRate, this.yinOptions);
    return { frequency, confidence, rms, time: this.totalSamples / this.sampleRate };
  }
}
