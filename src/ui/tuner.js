import { freqToNote, midiToName } from '../analysis/note-utils.js';
import { PitchCenterTracker } from '../analysis/vibrato.js';
import { temperamentOffsetCents } from '../analysis/temperaments.js';
import { intonationTolerance } from './chart-utils.js';

const CONFIDENCE_FLOOR = 0.6;
const RMS_FLOOR = 0.005;

// Gauge geometry: pivot at (150,150) in a 300×170 viewBox; ±50 cents maps
// to ±50° of needle sweep, like the hand of a clock.
const SVG_NS = 'http://www.w3.org/2000/svg';
// The dial is painted by class, not by literal colour, so the palette in the
// stylesheet — and therefore the theme — is the single source of truth. The
// green band is exactly the in-tune tolerance from settings, so the dial and
// the note colour can never disagree about what counts as in tune.
function zones() {
  const t = intonationTolerance();
  return [
    [-50, -25, 'g-bad'],
    [-25, -t, 'g-off'],
    [-t, t, 'g-good'],
    [t, 25, 'g-off'],
    [25, 50, 'g-bad'],
  ];
}

function polar(radius, deg) {
  const a = (deg * Math.PI) / 180;
  return [150 + radius * Math.sin(a), 150 - radius * Math.cos(a)];
}

function svgEl(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function zoneArcs(svg) {
  const arcs = [];
  for (const [c1, c2, zoneClass] of zones()) {
    const [x1, y1] = polar(108, c1);
    const [x2, y2] = polar(108, c2);
    const path = svgEl('path', {
      d: `M ${x1} ${y1} A 108 108 0 0 1 ${x2} ${y2}`,
      class: `g-zone ${zoneClass}`, 'stroke-width': 5, fill: 'none',
      'stroke-linecap': 'round',
    });
    svg.append(path);
    arcs.push(path);
  }
  return arcs;
}

function buildGauge(svg) {
  const arcs = zoneArcs(svg);
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0;
    const [x1, y1] = polar(118, c);
    const [x2, y2] = polar(major ? 103 : 110, c);
    svg.append(svgEl('line', {
      x1, y1, x2, y2,
      class: major ? 'g-tick-major' : 'g-tick',
      'stroke-width': major ? 2 : 1.2,
    }));
  }
  for (const c of [-50, -25, 0, 25, 50]) {
    const [x, y] = polar(131, c);
    const label = svgEl('text', {
      x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 11, class: 'g-label', 'font-family': 'system-ui, sans-serif',
    });
    label.textContent = c > 0 ? `+${c}` : String(c);
    svg.append(label);
  }
  const needle = svgEl('g', { id: 'needle-g' });
  needle.append(svgEl('line', {
    x1: 150, y1: 150, x2: 150, y2: 52,
    class: 'g-needle', 'stroke-width': 3, 'stroke-linecap': 'round',
  }));
  needle.append(svgEl('circle', { cx: 150, cy: 150, r: 7, class: 'g-hub' }));
  needle.append(svgEl('circle', { cx: 150, cy: 150, r: 2.5, class: 'g-hub-dot' }));
  svg.append(needle);
  return { needle, arcs };
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
    const gauge = buildGauge(root.querySelector('#gauge-svg'));
    this.needle = gauge.needle;
    this.arcs = gauge.arcs;
    this.tracker = new PitchCenterTracker();
    this.a4 = 440;
    this.transpose = 0;          // semitones added to DISPLAYED names (Bb instr = +2)
    this.temperament = 'equal';  // 'equal' | 'just' | 'pythagorean'
    this.temperamentRoot = 0;    // pitch class of the tonic
  }

  // Re-draw the coloured bands after the in-tune tolerance changes.
  refreshZones() {
    zones().forEach(([c1, c2], i) => {
      const [x1, y1] = polar(108, c1);
      const [x2, y2] = polar(108, c2);
      this.arcs[i]?.setAttribute('d', `M ${x1} ${y1} A 108 108 0 0 1 ${x2} ${y2}`);
    });
  }

  setNeedle(cents) {
    const target = Math.max(-50, Math.min(50, cents));
    // light smoothing (updates arrive ~86×/s) so the needle glides
    this._deg = this._deg === undefined ? target : this._deg + (target - this._deg) * 0.35;
    // SVG-attribute rotation with an explicit pivot: CSS transform-origin
    // on SVG children is measured off-center by Safari once the svg is
    // scaled, which made the needle disagree with the cents readout.
    this.needle.setAttribute('transform', `rotate(${this._deg.toFixed(2)} 150 150)`);
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
    // In a non-equal temperament, "in tune" sits offset from ET by the
    // degree's historical ratio — the needle centers on THAT target.
    const cents = (centerMidiFloat - midi) * 100
      - temperamentOffsetCents(this.temperament, this.temperamentRoot, midi);

    this.noteEl.textContent = midiToName(midi + this.transpose);
    this.noteEl.dataset.state = Math.abs(cents) < intonationTolerance() ? 'good' : 'off';
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
