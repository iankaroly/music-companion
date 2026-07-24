import { RingBuffer } from './ring-buffer.js';
import { yin } from './yin.js';
import { detectTwoPitches } from './dual-pitch.js';

// Consumes arbitrary-size audio chunks, emits a pitch reading every hopSize
// samples once windowSize samples have accumulated. Pure logic — the same
// path runs on mic input and on synthesized demo audio.
export class Analyzer {
  constructor(sampleRate, options = {}) {
    const { windowSize = 4096, hopSize = 1024, dual = false, fastWindow = 2048, yinOptions = {} } = options;
    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.hopSize = hopSize;
    this.dual = dual;
    this.fastWindow = Math.min(fastWindow, windowSize);
    this.yinOptions = yinOptions;
    this.hopIndex = 0;
    this.cachedPair = null;
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
    const time = this.totalSamples / this.sampleRate;

    if (this.dual) {
      // Double stops need the full window (a third's common fundamental has
      // a very long period); fast runs need a short one (a long window
      // smears across note boundaries). So: probe for a pair on the full
      // window every other hop, and when no second string is sounding,
      // track the primary from the freshest short sub-window instead.
      if (this.hopIndex++ % 2 === 0) {
        this.cachedPair = detectTwoPitches(window, this.sampleRate, this.yinOptions);
      }
      const pair = this.cachedPair;
      if (pair?.secondary) {
        return { frequency: pair.primary.frequency, confidence: pair.primary.confidence, rms, time, secondary: pair.secondary };
      }
      const fast = yin(window.subarray(this.windowSize - this.fastWindow), this.sampleRate, this.yinOptions);
      return { frequency: fast.frequency, confidence: fast.confidence, rms, time, secondary: null };
    }
    const { frequency, confidence } = yin(window, this.sampleRate, this.yinOptions);
    return { frequency, confidence, rms, time, secondary: null };
  }
}
