// Vibrato-aware pitch display. Instantaneous pitch under vibrato swings
// ±20–50 cents at 5–7 Hz, which a naive tuner reads as "out of tune".
// This tracker averages over a rolling window about one vibrato cycle long
// and reports the center — what a listener actually hears as the pitch —
// plus the vibrato's width and rate when a genuine oscillation is present.
export class PitchCenterTracker {
  constructor(options = {}) {
    const {
      windowSec = 0.35,       // ≈ 2 vibrato cycles at 6 Hz
      resetSemitones = 0.6,   // a jump this big is a new note, not vibrato
      minWidthCents = 10,     // half-swing below this is just noise
      minRateHz = 3.5,        // slower than vibrato: drift or wobble
      maxRateHz = 9.5,
    } = options;
    Object.assign(this, { windowSec, resetSemitones, minWidthCents, minRateHz, maxRateHz });
    this.frames = [];
  }

  reset() {
    this.frames = [];
  }

  push(frame) {
    if (this.frames.length > 0) {
      const center = this.center();
      if (Math.abs(frame.midiFloat - center) > this.resetSemitones) this.frames = [];
    }
    this.frames.push(frame);
    const cutoff = frame.time - this.windowSec;
    while (this.frames[0].time < cutoff) this.frames.shift();

    return { centerMidiFloat: this.center(), vibrato: this.detectVibrato() };
  }

  center() {
    return this.frames.reduce((s, f) => s + f.midiFloat, 0) / this.frames.length;
  }

  detectVibrato() {
    if (this.frames.length < 6) return null;
    const span = this.frames.at(-1).time - this.frames[0].time;
    if (span < this.windowSec * 0.7) return null;

    const center = this.center();
    const deviations = this.frames.map((f) => f.midiFloat - center);
    const widthCents = ((Math.max(...deviations) - Math.min(...deviations)) / 2) * 100;
    if (widthCents < this.minWidthCents) return null;

    let crossings = 0;
    for (let i = 1; i < deviations.length; i++) {
      if (Math.sign(deviations[i]) !== Math.sign(deviations[i - 1])) crossings++;
    }
    const rateHz = crossings / 2 / span;
    if (rateHz < this.minRateHz || rateHz > this.maxRateHz) return null;

    return { widthCents, rateHz };
  }
}
