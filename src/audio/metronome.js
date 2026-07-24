// Lookahead-scheduled metronome: clicks are placed on the AudioContext
// clock ahead of time (the setInterval only tops up the schedule), so
// timing stays solid even when the UI thread stutters.

const LOOKAHEAD_SEC = 0.12;
const TICK_MS = 25;

export class Metronome {
  constructor(onBeat) {
    this.bpm = 80;
    this.beatsPerBar = 4;
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
    this.ctx ??= new AudioContext();
    this.nextTime = this.ctx.currentTime + 0.1;
    this.count = 0;
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
      this.click(this.nextTime, beat === 0);
      const delayMs = Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000);
      const scheduledBeat = beat;
      setTimeout(() => { if (this.running) this.onBeat?.(scheduledBeat); }, delayMs);
      this.nextTime += 60 / this.bpm;
      this.count++;
    }
  }

  click(time, accent) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1174.7; // A6 downbeat, D6 elsewhere
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.08);
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
