import { audioContext, masterOut } from './context.js';

// Lookahead-scheduled metronome: clicks are placed on the AudioContext
// clock ahead of time (the setInterval only tops up the schedule), so
// timing stays solid even when the UI thread stutters.

const LOOKAHEAD_SEC = 0.12;
const TICK_MS = 25;

function makeNoiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.04), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Sub-click positions within one beat, as fractions of the beat length.
export function subdivisionOffsets(name) {
  switch (name) {
    case 'eighth': return [0.5];
    case 'triplet': return [1 / 3, 2 / 3];
    case 'sixteenth': return [0.25, 0.5, 0.75];
    case 'shuffle': return [2 / 3]; // swung off-beat
    default: return [];
  }
}

export class Metronome {
  constructor(onBeat) {
    this.bpm = 80;
    this.beatsPerBar = 4;
    this.subdivision = 'quarter';
    this.accentFirst = true;
    this.trainerStep = 0;      // bpm added every trainerBars bars (0 = off)
    this.trainerBars = 4;
    this.onTempo = null;
    this.barCount = 0;
    this.onBeat = onBeat;
    this.ctx = null;
    this.timer = null;
    this.nextTime = 0;
    this.count = 0;
  }

  get running() {
    return this.timer !== null;
  }

  start() {
    if (this.running) return;
    this.ctx = audioContext();
    this.nextTime = this.ctx.currentTime + 0.1;
    this.count = 0;
    this.barCount = 0;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  schedule() {
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD_SEC) {
      const beat = this.count % this.beatsPerBar;
      // tempo trainer: step the tempo up at each Nth barline
      if (beat === 0 && this.count > 0) {
        this.barCount++;
        if (this.trainerStep > 0 && this.barCount % this.trainerBars === 0) {
          this.bpm = Math.min(260, this.bpm + this.trainerStep);
          this.onTempo?.(this.bpm);
        }
      }
      const beatLength = 60 / this.bpm;
      this.click(this.nextTime, beat === 0 && this.accentFirst ? 'accent' : 'beat');
      for (const offset of subdivisionOffsets(this.subdivision)) {
        this.click(this.nextTime + offset * beatLength, 'sub');
      }
      const delayMs = Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000);
      const scheduledBeat = beat;
      setTimeout(() => { if (this.running) this.onBeat?.(scheduledBeat); }, delayMs);
      this.nextTime += beatLength;
      this.count++;
    }
  }

  click(time, kind) {
    const [freq, level] =
      kind === 'accent' ? [1760, 1.5] :
      kind === 'beat' ? [1174.7, 1.05] :
      [880, 0.5];
    // Body: square wave — dense harmonics read far louder than a sine blip
    // on small speakers; the master limiter keeps the peaks clean.
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(gain).connect(masterOut());
    osc.start(time);
    osc.stop(time + 0.09);
    // Attack: a band-passed noise tick gives the click a percussive edge
    // that cuts through playing.
    this.noiseBuffer ??= makeNoiseBuffer(this.ctx);
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2;
    bp.Q.value = 1;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(level * 0.9, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
    noise.connect(bp).connect(ng).connect(masterOut());
    noise.start(time);
    noise.stop(time + 0.03);
  }
}

const TEMPO_NAMES = [
  [45, 'Grave'], [60, 'Largo'], [73, 'Adagio'], [93, 'Andante'],
  [113, 'Moderato'], [126, 'Allegretto'], [153, 'Allegro'],
  [177, 'Vivace'], [221, 'Presto'], [Infinity, 'Prestissimo'],
];

export function tempoName(bpm) {
  for (const [limit, name] of TEMPO_NAMES) {
    if (bpm < limit) return name;
  }
  return 'Prestissimo';
}
