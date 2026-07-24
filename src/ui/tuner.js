import { freqToNote, midiToName } from '../analysis/note-utils.js';
import { PitchCenterTracker } from '../analysis/vibrato.js';

const CONFIDENCE_FLOOR = 0.6;
const RMS_FLOOR = 0.005;

// Live tuner display: big note name, cents needle, frequency readout.
// Vibrato-aware: shows the pitch center a listener hears, and labels the
// vibrato explicitly instead of reading its swing as intonation error.
export class Tuner {
  constructor(root) {
    this.noteEl = root.querySelector('#note');
    this.centsEl = root.querySelector('#cents');
    this.secondEl = root.querySelector('#second');
    this.freqEl = root.querySelector('#freq');
    this.needleEl = root.querySelector('#needle');
    this.tracker = new PitchCenterTracker();
    this.a4 = 440;
  }

  update(reading) {
    const { frequency, confidence, rms } = reading;
    const heard = frequency !== null && confidence >= CONFIDENCE_FLOOR && rms >= RMS_FLOOR;
    if (!heard) {
      this.tracker.reset();
      this.noteEl.textContent = '–';
      this.noteEl.dataset.state = 'idle';
      this.centsEl.textContent = 'listening';
      this.freqEl.textContent = '';
      this.secondEl.textContent = '';
      this.needleEl.style.setProperty('--cents', '0');
      return;
    }

    const midiFloat = 69 + 12 * Math.log2(frequency / this.a4);
    const { centerMidiFloat, vibrato } = this.tracker.push({ midiFloat, time: reading.time });
    const midi = Math.round(centerMidiFloat);
    const cents = (centerMidiFloat - midi) * 100;

    this.noteEl.textContent = midiToName(midi);
    this.noteEl.dataset.state = Math.abs(cents) < 8 ? 'good' : 'off';
    const centsText = `${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cents`;
    this.centsEl.textContent = vibrato
      ? `${centsText} · vibrato ±${vibrato.widthCents.toFixed(0)}¢ @ ${vibrato.rateHz.toFixed(1)} Hz`
      : centsText;
    this.freqEl.textContent = `${frequency.toFixed(1)} Hz`;
    this.needleEl.style.setProperty('--cents', String(Math.max(-50, Math.min(50, cents))));

    // Double stop: show the second string's note alongside.
    const sec = reading.secondary;
    if (sec?.frequency && sec.confidence >= CONFIDENCE_FLOOR) {
      const s = freqToNote(sec.frequency, this.a4);
      this.secondEl.textContent =
        `double stop: + ${s.name} ${s.cents >= 0 ? '+' : ''}${s.cents.toFixed(0)}¢`;
    } else {
      this.secondEl.textContent = '';
    }
  }
}
