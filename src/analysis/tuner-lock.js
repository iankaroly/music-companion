import { PitchCenterTracker } from './vibrato.js';

// WHAT THE TUNER SHOWS, which is not every reading the analyzer makes.
//
// "It bugs back and forth and doesn't register the pitch a lot of the time."
// MEASURED on real playing (Apple's violin and trumpet loops through the
// tuner's own Analyzer, `npm run tuner:check`): the reading at a bow change or
// a change of note is one to four frames of nonsense — an octave down, a
// phantom common fundamental under two notes (235 Hz under 702 and 791), a
// "double stop" whose two halves swap places every other frame — and an attack
// whose confidence dips under the floor for a frame or two. The dial used to
// paint every one of those, and blank itself to "listening" on every dip:
// about three visible jumps a second on a player who was doing nothing but
// play.
//
// So:
//
//   - a reading far from the pitch on the dial (more than WIDE semitones — an
//     octave, a fifth, a phantom) is a CANDIDATE, and only replaces it once it
//     has said the same thing for SWITCH_S: longer than any glitch measured,
//     short enough that a real leap lands at once;
//   - a double stop's second voice counts: if the analyzer hands the note on
//     the dial back as the SECONDARY, that is the same note still sounding;
//   - silence, or a reading nobody believes, HOLDS the last note for HOLD_S
//     before the dial goes back to listening, so a bow change or a consonant
//     is not a blank.
//
// And WHERE the pitch is depends on whether it is moving on purpose:
//
//   - with VIBRATO, the centre of the last ~0.35s — a listener hears the middle
//     of the swing, and a needle following the swing reads as out of tune;
//   - WITHOUT it, the last SHORT_S. A voice slides and drifts all the time, and
//     a 0.35s average of a hum that had moved from B3 to C4 still said "B3
//     +45" a quarter of a second later. MEASURED against pYIN on a real
//     recording of somebody humming a tune: see the commit that brought this
//     in for the before and after.
//
// The NAME changes when the pitch is past the halfway line by HYSTERESIS, so a
// note sung right on the boundary between two names does not flicker between
// them. Cents are measured from the name shown, so they can read a little past
// ±50 in that band — which is the truth about where the note is.
//
// Pure: readings in, a display state out. Both tuners — the tab and the strip
// over a page of music — read the same lock, so they cannot disagree.

const FIND_CONFIDENCE = 0.6;   // to start believing a pitch
const KEEP_CONFIDENCE = 0.45;  // to go on believing the one already shown
// Quiet enough for a flute across a room or a phone on a music stand a metre
// away. It was 0.005, which a soft note on a phone never reached — the tuner
// sat on "listening" through the whole note. Confidence and the switch delay,
// not loudness, are what keep room noise off the dial.
const RMS_FLOOR = 0.0012;
// Within this of the pitch on the dial, a reading is the same line of singing
// or playing — vibrato up to ±100¢, a slide, a scoop. Past it, it is a leap or
// a glitch, and has to prove itself.
const WIDE = 1.5;
const SWITCH_S = 0.06;
// …unless it is NEAR. Every glitch measured lands an octave or more away (the
// octave below, a third of the pitch, a phantom under two notes), and a sung
// or played step rarely goes past a fourth. Holding a step to the full
// SWITCH_S cost a hummed tune a third of every note: MEASURED against pYIN on
// five real recordings of solo singing, the note on the dial was the note being
// sung at that instant 85% of the time with 60ms, 89% with 20ms here — and the
// violin and trumpet loops still show no flashes.
const NEAR = 6.5;
const NEAR_S = 0.02;
// 90ms and not shorter: 60ms bought another point and a half on the singers
// and put the flashes back on the violin loop.
const SHORT_S = 0.09;
const HYSTERESIS = 0.12;       // semitones past the halfway line
const HOLD_S = 0.35;
const SECOND_SHOW_S = 0.04;
const SECOND_HOLD_S = 0.2;

const toMidi = (frequency, a4) => 69 + 12 * Math.log2(frequency / a4);

export class TunerLock {
  constructor() {
    this.tracker = new PitchCenterTracker({ resetSemitones: WIDE });
    this.reset();
  }

  reset() {
    this.tracker.reset();
    this.locked = false;
    this.lastGood = -Infinity;
    this.candidate = null;     // { midiFloat, since, frames: [...] }
    this.recent = [];          // the last SHORT_S of frames on the dial's line
    this.second = null;        // { frequency, midiFloat, since, last, shown }
    this.named = null;         // the integer note the dial is showing
    this.last = null;
    this.seen = undefined;
  }

  // reading: { frequency, confidence, rms, time, secondary }. A reading with no
  // time is the app saying "stop" rather than a frame of audio.
  //
  // Returns null when there is no note to show, otherwise
  // { midi, centerMidiFloat, vibrato, frequency, held, secondary }, where
  // `midi` is the note to NAME and centerMidiFloat - midi is the cents.
  push(reading, a4 = 440) {
    if (!reading || !Number.isFinite(reading.time)) {
      this.reset();
      return null;
    }
    const { time } = reading;
    // TIME WENT BACKWARDS: a new capture, whose analyzer counts from zero
    // again. Without this the strip's lock — which lives as long as the page —
    // held the last session's note for good (time minus lastGood is negative,
    // so the hold never ran out) and averaged its old frames into the new one.
    if (this.seen !== undefined && time < this.seen) this.reset();
    this.seen = time;

    const loud = (reading.rms ?? 0) >= RMS_FLOOR;
    const voices = [];
    if (loud && reading.frequency) voices.push({ frequency: reading.frequency, confidence: reading.confidence });
    const sec = reading.secondary;
    if (loud && sec?.frequency) voices.push({ frequency: sec.frequency, confidence: sec.confidence });

    let used = null;
    if (this.locked) {
      const center = this.last.centerMidiFloat;
      used = voices.find((v) => v.confidence >= KEEP_CONFIDENCE
        && Math.abs(toMidi(v.frequency, a4) - center) <= WIDE);
      if (used) {
        this.lastGood = time;
        this.candidate = null;
        this.feed(toMidi(used.frequency, a4), used.frequency, time);
      }
    }

    if (!used) {
      const fresh = voices[0]?.confidence >= FIND_CONFIDENCE ? voices[0] : null;
      if (fresh) this.consider(toMidi(fresh.frequency, a4), fresh.frequency, time);
      // A frame nobody believes neither builds a candidate nor breaks one.
    }

    if (this.locked && time - this.lastGood > HOLD_S) this.reset();
    if (!this.locked) return null;

    return {
      ...this.last,
      midi: this.named,
      held: this.lastGood < time,
      secondary: this.secondVoice(reading, used, time),
    };
  }

  feed(midiFloat, frequency, time) {
    const { vibrato } = this.tracker.push({ midiFloat, time });
    this.recent.push({ midiFloat, time });
    while (this.recent[0].time < time - SHORT_S) this.recent.shift();
    const centerMidiFloat = vibrato
      ? this.tracker.center()
      : this.recent.reduce((s, f) => s + f.midiFloat, 0) / this.recent.length;
    if (this.named === null || Math.abs(centerMidiFloat - this.named) > 0.5 + HYSTERESIS) {
      this.named = Math.round(centerMidiFloat);
    }
    this.last = { centerMidiFloat, vibrato, frequency };
  }

  consider(midiFloat, frequency, time) {
    const c = this.candidate;
    if (c && Math.abs(midiFloat - c.midiFloat) <= WIDE) {
      c.frames.push({ midiFloat, time, frequency });
      c.midiFloat = c.frames.reduce((s, f) => s + f.midiFloat, 0) / c.frames.length;
    } else {
      this.candidate = { midiFloat, since: time, frames: [{ midiFloat, time, frequency }] };
    }
    const now = this.candidate;
    const from = this.locked ? this.last.centerMidiFloat : null;
    const near = from !== null && Math.abs(now.midiFloat - from) <= NEAR;
    if (time - now.since < (near ? NEAR_S : SWITCH_S)) return;
    // Taken: the new note starts from what the candidate heard, not from one
    // frame, so its first cents reading is already an average.
    this.tracker.reset();
    this.recent = [];
    this.named = null;
    for (const f of now.frames) this.feed(f.midiFloat, f.frequency, f.time);
    this.locked = true;
    this.lastGood = time;
    this.candidate = null;
    this.second = null;
  }

  // The second string of a double stop, shown once it has been there for a
  // moment and kept for a moment after it drops out — the analyzer only
  // re-checks for a pair every other frame, and a line that appeared and
  // vanished at that rate was unreadable.
  secondVoice(reading, used, time) {
    const sec = reading.secondary;
    // Whichever of the pair is NOT the note on the dial.
    let other = null;
    if (sec?.frequency && sec.confidence >= FIND_CONFIDENCE && (reading.rms ?? 0) >= RMS_FLOOR) {
      other = used?.frequency === sec.frequency ? reading.frequency : sec.frequency;
      if (other && Math.abs(toMidi(other, 440) - toMidi(this.last.frequency, 440)) <= 0.6) other = null;
    }
    const s = this.second;
    if (other) {
      const m = toMidi(other, 440);
      if (s && Math.abs(m - s.midiFloat) <= 0.6) {
        s.frequency = other;
        s.midiFloat = m;
        s.last = time;
        if (time - s.since >= SECOND_SHOW_S) s.shown = true;
      } else {
        this.second = { frequency: other, midiFloat: m, since: time, last: time, shown: false };
      }
    } else if (s && time - s.last > SECOND_HOLD_S) {
      this.second = null;
    }
    return this.second?.shown ? { frequency: this.second.frequency } : null;
  }
}
