import { RingBuffer } from './ring-buffer.js';
import { yin } from './yin.js';
import { detectTwoPitches } from './dual-pitch.js';

// Consumes arbitrary-size audio chunks, emits a pitch reading every hopSize
// samples once windowSize samples have accumulated. Pure logic — the same
// path runs on mic input and on synthesized demo audio.
// What counts as the start of a sound: a block this much louder than the block
// before it, and loud enough not to be the room. Both are deliberately blunt —
// this is not trying to name the attack of a note, only to say which
// millisecond it began at, and everything downstream of it can already tell a
// note from a noise.
// …AND THE FLOOR FOLLOWS THE ROOM, rather than being a number.
//
// A fixed floor of 0.01 is right for a cello a foot from the microphone and
// wrong for everything else: a flute across a room, a phone in a case, anything
// recorded quietly has every real attack under it, and one note in six kept the
// late time because of it. MEASURED, `npm run audio:fast`, ninth decile of the
// onset error: 18-28ms with the fixed floor, and the notes that made it up were
// the quiet ones.
//
// So the floor is the quietest thing heard lately, times a margin — with an
// absolute minimum underneath so that silence itself cannot make every hiss an
// attack.
const ATTACK_QUIETEST = 0.0015;   // the floor's own floor
const ATTACK_OVER = 3;            // …and how far over the room a sound must be
const ATTACK_JUMP = 2.2;

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
    // The tail of the energy trace, kept across hops so a rise that straddles
    // the join between two of them is still one rise. See `attackIn`.
    this.wasLoud = 0;
    // The quietest block heard lately — the room, near enough — which is what
    // an attack has to stand out from. It follows quiet down at once and back
    // up very slowly, so a loud passage does not raise it.
    this.roomIs = 1;
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

  // WHERE THE SOUND STARTED, which is not where the PITCH became certain.
  //
  // A note is opened by the segmenter on the first frame whose pitch it
  // believes, and believing a pitch takes a window: 4096 samples of it, plus
  // however many hops the attack takes to settle. MEASURED, `npm run
  // audio:fast`, scales synthesised with a 4ms attack: every note came back
  // 16-31ms LATE, with a spread of ±20-30ms around that — a quarter of a note
  // at semiquavers-at-180, and exactly what "the highlight is a bit behind"
  // is made of.
  //
  // Energy does not need a window. The attack of a note is a step in loudness
  // and it can be found to a millisecond or two, so each hop is walked in small
  // blocks and the sharpest RISE in it is reported alongside the pitch. The
  // segmenter then opens its note THERE rather than where it happened to become
  // sure — see `attackFor` in notes.js.
  //
  // What this deliberately does NOT do is invent an attack. A slurred note, a
  // bow change under a slur, a note that grows out of the one before it: none
  // of them has a step in loudness, and `rise` comes back null. A note with no
  // attack keeps the time it was heard at, which is the honest answer.
  attackIn(window) {
    const from = Math.max(0, window.length - this.hopSize);
    const BLOCK = Math.max(16, Math.round(this.sampleRate / 700));   // ~1.4ms
    let best = null;
    let before = this.wasLoud;
    for (let at = from; at < window.length; at += BLOCK) {
      const end = Math.min(window.length, at + BLOCK);
      let sum = 0;
      for (let i = at; i < end; i++) sum += window[i] * window[i];
      const loud = Math.sqrt(sum / Math.max(1, end - at));
      // AGAINST THE BLOCK BEFORE IT, and the FIRST one that jumps.
      //
      // Both halves were got wrong first and each cost the same thing — the
      // note came back late again. Measured against a slowly-adapting floor
      // instead, every block of a loud note beats a quiet floor, so the biggest
      // ratio in the hop is wherever the note is loudest and not where it
      // began: median lag went from 0ms back to 8-27ms. And taking the biggest
      // jump rather than the first takes the peak of the attack rather than its
      // start.
      this.roomIs = loud < this.roomIs ? loud : this.roomIs * 0.999 + loud * 0.001;
      const floor = Math.max(ATTACK_QUIETEST, this.roomIs * ATTACK_OVER);
      if (!best && loud > floor && loud > before * ATTACK_JUMP) {
        best = { rise: loud / Math.max(1e-4, before), at: (this.totalSamples - (window.length - at)) / this.sampleRate };
      }
      before = loud;
    }
    this.wasLoud = before;
    return best;
  }

  analyze() {
    const window = this.ring.latest(this.windowSize);
    const attack = this.attackIn(window);
    let sumSq = 0;
    for (let i = 0; i < window.length; i++) sumSq += window[i] * window[i];
    const rms = Math.sqrt(sumSq / window.length);
    // WHEN THIS READING IS OF, which is the middle of the window and not the
    // end of it.
    //
    // `totalSamples` is every sample fed in so far, so stamping a reading with
    // it says "this pitch was true at the instant the window closed" — and the
    // window is 4096 samples, 85 ms at 48 kHz. The pitch the window reports is
    // an average over all of it, so the honest instant is its middle, and
    // stamping the end put every note's onset about 40 ms late. Everything
    // downstream inherits that: where a mark sits on the page, when the light
    // comes on, which side of the beat a note is called. It is half a
    // semiquaver at 120, which is what "I need the playing to sync perfectly
    // with the score" is made of at speed.
    //
    // Durations do not move — start and end shift together — so nothing about
    // how long a note was called changes.
    const time = (this.totalSamples - this.windowSize / 2) / this.sampleRate;

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
        return {
          frequency: pair.primary.frequency,
          confidence: pair.primary.confidence,
          rms,
          time,
          attack,
          secondary: pair.secondary,
        };
      }
      const fast = yin(window.subarray(this.windowSize - this.fastWindow), this.sampleRate, this.yinOptions);
      return {
        frequency: fast.frequency, confidence: fast.confidence, rms, time, attack, secondary: null,
      };
    }
    const { frequency, confidence } = yin(window, this.sampleRate, this.yinOptions);
    return { frequency, confidence, rms, time, attack, secondary: null };
  }
}
