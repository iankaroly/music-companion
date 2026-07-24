import { freqToNote } from '../analysis/note-utils.js';

const CONFIDENCE_FLOOR = 0.6;
const RMS_FLOOR = 0.005;

// Live tuner display: big note name, cents needle, frequency readout.
export class Tuner {
  constructor(root) {
    this.noteEl = root.querySelector('#note');
    this.centsEl = root.querySelector('#cents');
    this.freqEl = root.querySelector('#freq');
    this.needleEl = root.querySelector('#needle');
    this.smoothedCents = 0;
    this.a4 = 440;
  }

  update({ frequency, confidence, rms }) {
    const heard = frequency !== null && confidence >= CONFIDENCE_FLOOR && rms >= RMS_FLOOR;
    if (!heard) {
      this.noteEl.textContent = '–';
      this.noteEl.dataset.state = 'idle';
      this.centsEl.textContent = 'listening';
      this.freqEl.textContent = '';
      this.needleEl.style.setProperty('--cents', '0');
      return;
    }

    const { name, cents } = freqToNote(frequency, this.a4);
    this.smoothedCents = 0.7 * this.smoothedCents + 0.3 * cents;
    const c = this.smoothedCents;

    this.noteEl.textContent = name;
    this.noteEl.dataset.state = Math.abs(c) < 8 ? 'good' : 'off';
    this.centsEl.textContent = `${c >= 0 ? '+' : ''}${c.toFixed(1)} cents`;
    this.freqEl.textContent = `${frequency.toFixed(1)} Hz`;
    this.needleEl.style.setProperty('--cents', String(Math.max(-50, Math.min(50, c))));
  }
}
