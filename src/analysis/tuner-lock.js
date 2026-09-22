import { PitchCenterTracker } from './vibrato.js';

// WHAT THE TUNER SHOWS, which is not every reading the analyzer makes.
//
// "It bugs back and forth and doesn't register the pitch a lot of the time."
// MEASURED on real playing (Apple's violin and trumpet loops through the
// tuner's own Analyzer, `node tools/tuner-check.mjs`): the reading at a bow
// change or a change of note is one to four frames of nonsense — an octave
// down, a phantom common fundamental under two notes (235 Hz under 702 and
// 791), a "double stop" whose two halves swap places every other frame — and
// an attack whose confidence dips under the floor for a frame or two. The dial
// used to paint every one of those, and blank itself to "listening" on every
// dip: about three visible jumps a second on a player who was doing nothing
// but play.
//
// So a note is LOCKED, the way a hardware tuner locks:
//
//   - a reading that agrees with the locked note (within ACCEPT semitones)
//     keeps it, and is allowed a lower confidence than it takes to find one;
//   - a reading that disagrees is a CANDIDATE, and only replaces the note once
//     it has said the same thing for SWITCH_S — longer than any of the glitches
//     measured, short enough that a real change of note lands at once;
//   - a double stop's second voice counts: if the analyzer hands the note we
//     are locked on back as the SECONDARY, that is the same note still sounding;
//   - silence, or a reading nobody believes, HOLDS the last note for HOLD_S
//     before the dial goes back to listening, so a bow change is not a blank.
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
const ACCEPT = 0.6;            // semitones: past this, a frame is not ON the note
// …but it can still be the same note. A singer's vibrato swings ±60-100¢ and
// a gate at ±0.6 clipped its peaks: MEASURED, ±60¢ read 15-22¢ off-centre, and
// ±100¢ flipped between neighbouring semitones 28 times in three seconds. So
// anything within WIDE is fed to the average whole, and a move to the NEXT
// semitone has to sit past the halfway line, on one side, for STEP_S — longer
// than a vibrato spends out there (about 55ms of each cycle at ±100¢ and
// 5.5 Hz) and still under a tenth of a second for a real half step.
const WIDE = 1.5;
const STEP_S = 0.09;
const SWITCH_S = 0.06;         // a bigger jump: a new note, or a glitch
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
    this.drift = null;         // the same, for a half step off the locked note
    this.second = null;        // { frequency, midiFloat, since, last, shown }
    this.last = null;
    this.seen = undefined;
  }

  // reading: { frequency, confidence, rms, time, secondary }. A reading with no
  // time is the app saying "stop" rather than a frame of audio.
  //
  // Returns null when there is no note to show, otherwise
  // { centerMidiFloat, vibrato, frequency, held, secondary }.
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
      const center = this.tracker.center();
      used = voices.find((v) => v.confidence >= KEEP_CONFIDENCE
        && Math.abs(toMidi(v.frequency, a4) - center) <= WIDE);
      if (used) {
        this.lastGood = time;
        this.candidate = null;
        this.stepped(toMidi(used.frequency, a4), used.frequency, time, center);
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
      held: this.lastGood < time,
      secondary: this.secondVoice(reading, used, time),
    };
  }

  // A half step up or down, told apart from vibrato by staying there.
  //
  // The frames past the halfway line are HELD BACK from the average while the
  // question is open. Fed straight in, they dragged the average toward the new
  // note until the new note was no longer past the halfway line from it — the
  // run cancelled itself, and a quick half step (E to F at six notes a second)
  // was never named at all. If the pitch comes back, they were vibrato peaks and
  // go into the average after all; if it stays, they ARE the new note.
  stepped(midiFloat, frequency, time, center) {
    const off = midiFloat - center;
    const d = this.drift;
    if (Math.abs(off) <= ACCEPT) {
      this.settle();
      this.feed(midiFloat, frequency, time);
      return;
    }
    if (d && Math.sign(off) !== d.side) this.settle();
    if (!this.drift) this.drift = { side: Math.sign(off), since: time, frames: [] };
    this.drift.frames.push({ midiFloat, time, frequency });
    if (time - this.drift.since < STEP_S) return;
    const frames = this.drift.frames;
    this.drift = null;
    this.tracker.reset();
    for (const f of frames) this.feed(f.midiFloat, f.frequency, f.time);
  }

  // Held-back frames that turned out to be the same note after all.
  settle() {
    for (const f of this.drift?.frames ?? []) this.feed(f.midiFloat, f.frequency, f.time);
    this.drift = null;
  }

  feed(midiFloat, frequency, time) {
    this.last = { ...this.tracker.push({ midiFloat, time }), frequency };
  }

  consider(midiFloat, frequency, time) {
    const c = this.candidate;
    if (c && Math.abs(midiFloat - c.midiFloat) <= ACCEPT) {
      c.frames.push({ midiFloat, time, frequency });
      c.midiFloat = c.frames.reduce((s, f) => s + f.midiFloat, 0) / c.frames.length;
    } else {
      this.candidate = { midiFloat, since: time, frames: [{ midiFloat, time, frequency }] };
    }
    const now = this.candidate;
    if (time - now.since < SWITCH_S) return;
    // Taken: the new note starts from what the candidate heard, not from one
    // frame, so its first cents reading is already an average.
    this.tracker.reset();
    for (const f of now.frames) this.feed(f.midiFloat, f.frequency, f.time);
    this.locked = true;
    this.lastGood = time;
    this.candidate = null;
    this.drift = null;
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
      if (other && Math.abs(toMidi(other, 440) - toMidi(this.last.frequency, 440)) <= ACCEPT) other = null;
    }
    const s = this.second;
    if (other) {
      const m = toMidi(other, 440);
      if (s && Math.abs(m - s.midiFloat) <= ACCEPT) {
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
