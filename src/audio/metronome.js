import { audioContext, masterOut, clickLevel, clickPitch, holdAudio, releaseAudio } from './context.js';

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

let noiseBuffer = null;

// One click at one moment on the audio clock. Exported because the timing
// panel plays a take back against the pulse it measured, and that click has to
// be the same click — a second, slightly different one would read as an
// artefact rather than as the metronome.
// Which pitch a click of each kind sounds at, and how loud it sits before the
// level trim. Pure, and the shift is an argument rather than a read, so the
// arithmetic can be tested without a browser — but it defaults to the stored
// preference, which is what keeps the timing panel's click identical to the
// metronome's without either of them having to know the setting exists.
//
// A downbeat is a fifth over the beat and the beat a fifth over the sub. That
// spacing is doing the work of telling them apart, so a shift moves all three
// together and never rearranges them.
export function clickVoice(kind, semitones = clickPitch()) {
  const [freq, base] =
    kind === 'accent' ? [880, 2.5] :
    kind === 'beat' ? [587.33, 1.9] :
    [440, 0.95];
  return { freq: freq * 2 ** (semitones / 12), base };
}

export function scheduleClick(ctx, time, kind = 'beat') {
  // An octave below where this started: a mechanical metronome is a wooden
  // tock, not a beep, and the old pitches (A6 over a D6 beat) were shrill
  // over a cello. Still comfortably above the instrument's range, so the
  // pulse stays audible while you play. Where those pitches sit is now a
  // preference — see CLICK_PITCH_MIN in context.js for how far it may move.
  const { freq, base } = clickVoice(kind);
  const level = base * clickLevel();
  // Body: square wave — dense harmonics read far louder than a sine blip
  // on small speakers; the master limiter keeps the peaks clean. A lowpass
  // just above the fundamental keeps the loudness of those harmonics while
  // dropping the ones that made it piercing.
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = freq * 2.4;
  tone.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(level, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
  osc.connect(tone).connect(gain).connect(masterOut());
  osc.start(time);
  osc.stop(time + 0.09);
  // Attack: a band-passed noise tick gives the click a percussive edge that
  // cuts through playing — centred nearer the fundamental than before, so
  // it reads as wood rather than as hiss.
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = makeNoiseBuffer(ctx);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 1.4;
  bp.Q.value = 1.2;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(level * 0.85, time);
  ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.018);
  noise.connect(bp).connect(ng).connect(masterOut());
  noise.start(time);
  noise.stop(time + 0.03);
  // Both nodes come back so a caller that scheduled a whole click track ahead
  // of time can call stop() on them and cancel what hasn't sounded yet.
  return [osc, noise];
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
    this.ctx = holdAudio('metronome');
    this.nextTime = this.ctx.currentTime + 0.1;
    this.count = 0;
    this.barCount = 0;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    releaseAudio('metronome');
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
    scheduleClick(this.ctx, time, kind);
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
