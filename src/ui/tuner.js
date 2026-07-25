import { freqToNote, midiToName } from '../analysis/note-utils.js';
import { PitchCenterTracker } from '../analysis/vibrato.js';

const CONFIDENCE_FLOOR = 0.6;
const RMS_FLOOR = 0.005;

// Gauge geometry: pivot at (150,150) in a 300×170 viewBox; ±50 cents maps
// to ±50° of needle sweep, like the hand of a clock.
const SVG_NS = 'http://www.w3.org/2000/svg';
const INK = '#1c2230';
const MUTED = '#6d7688';
const TICK_MINOR = '#c7cfdd';
const HUB_ACCENT = '#3056d3';
const ZONES = [
  [-50, -25, '#d64545'],
  [-25, -8, '#e08a1e'],
  [-8, 8, '#2e9e63'],
  [8, 25, '#e08a1e'],
  [25, 50, '#d64545'],
];

function polar(radius, deg) {
  const a = (deg * Math.PI) / 180;
  return [150 + radius * Math.sin(a), 150 - radius * Math.cos(a)];
}

function svgEl(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function buildGauge(svg) {
  for (const [c1, c2, color] of ZONES) {
    const [x1, y1] = polar(108, c1);
    const [x2, y2] = polar(108, c2);
    svg.append(svgEl('path', {
      d: `M ${x1} ${y1} A 108 108 0 0 1 ${x2} ${y2}`,
      stroke: color, 'stroke-width': 5, fill: 'none',
      'stroke-linecap': 'round', opacity: 0.55,
    }));
  }
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0;
    const [x1, y1] = polar(118, c);
    const [x2, y2] = polar(major ? 103 : 110, c);
    svg.append(svgEl('line', {
      x1, y1, x2, y2,
      stroke: major ? INK : TICK_MINOR,
      'stroke-width': major ? 2 : 1.2,
    }));
  }
  for (const c of [-50, -25, 0, 25, 50]) {
    const [x, y] = polar(131, c);
    const label = svgEl('text', {
      x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 11, fill: MUTED, 'font-family': 'system-ui, sans-serif',
    });
    label.textContent = c > 0 ? `+${c}` : String(c);
    svg.append(label);
  }
  const needle = svgEl('g', { id: 'needle-g' });
  needle.append(svgEl('line', {
    x1: 150, y1: 150, x2: 150, y2: 52,
    stroke: INK, 'stroke-width': 3, 'stroke-linecap': 'round',
  }));
  needle.append(svgEl('circle', { cx: 150, cy: 150, r: 7, fill: INK }));
  needle.append(svgEl('circle', { cx: 150, cy: 150, r: 2.5, fill: HUB_ACCENT }));
  svg.append(needle);
  return needle;
}

// Live tuner: analog gauge (note in the middle, needle sweeping the cents
// dial), vibrato-aware — it shows the pitch center a listener hears and
// labels the vibrato instead of reading its swing as intonation error.
export class Tuner {
  constructor(root) {
    this.noteEl = root.querySelector('#note');
    this.centsEl = root.querySelector('#cents');
    this.secondEl = root.querySelector('#second');
    this.freqEl = root.querySelector('#freq');
    this.needle = buildGauge(root.querySelector('#gauge-svg'));
    this.tracker = new PitchCenterTracker();
    this.a4 = 440;
  }

  setNeedle(cents) {
    const deg = Math.max(-50, Math.min(50, cents));
    this.needle.style.transform = `rotate(${deg}deg)`;
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
      this.setNeedle(0);
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
    this.setNeedle(cents);

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
