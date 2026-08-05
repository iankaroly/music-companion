import { midiToName } from './note-utils.js';

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Turns the Analyzer's per-hop readings into discrete notes.
//
// Splitting rules:
// - Silence/low confidence for `silenceFrames` consecutive frames closes the note.
// - A pitch jump must be sustained for `holdFrames` consecutive agreeing frames
//   to split — a single deviating frame is an octave glitch and is discarded.
// - A note's pitch is the median over its frames, so vibrato averages to
//   the perceived center instead of reading as bad intonation.
//
// How long the jump must be held is what tells a new note from a wide vibrato,
// and it is the difference between the app hearing a sung phrase and hearing
// forty-seven notes. A vibrato excursion RETURNS — at 6 Hz it is past any
// sensible threshold for a few tens of milliseconds and then comes back — while
// a real change of note stays where it went. Two frames (23 ms) cannot tell
// those apart on a voice, and the failure compounds: the moment one vibrato
// peak splits the note, the new note's median IS that peak, so the opposite
// peak is now a whole tone away and splits again, and again.
export class NoteSegmenter {
  constructor(options = {}) {
    const {
      minDuration = 0.04,       // seconds; short enough for fast semiquaver runs
      splitSemitones = 0.6,     // sustained deviation that starts a new note
      confidenceFloor = 0.6,
      rmsFloor = 0.005,
      silenceFrames = 2,
      holdFrames = 2,           // how long that deviation must last to count
      swingTolerance = 0.4,     // how much of a note's own wobble widens its threshold
      a4 = 440,               // reference pitch for note naming and cents
    } = options;
    Object.assign(this, {
      minDuration, splitSemitones, confidenceFloor, rmsFloor, silenceFrames,
      holdFrames, swingTolerance, a4,
    });
    this.current = null;   // { frames: [{time, midiFloat}] }
    this.pending = null;   // frames of a possible pitch change, not yet committed
    this.silentRun = 0;
  }

  push(reading) {
    const out = [];
    const voiced =
      reading.frequency !== null &&
      reading.confidence >= this.confidenceFloor &&
      reading.rms >= this.rmsFloor;

    if (!voiced) {
      this.pending = null;
      this.silentRun++;
      if (this.silentRun >= this.silenceFrames && this.current) {
        const note = this.closeCurrent();
        if (note) out.push(note);
      }
      return out;
    }

    this.silentRun = 0;
    const midiFloat = 69 + 12 * Math.log2(reading.frequency / this.a4);
    const frame = { time: reading.time, midiFloat };

    if (!this.current) {
      this.current = { frames: [frame] };
      return out;
    }

    const values = this.current.frames.map((f) => f.midiFloat);
    const center = median(values);
    if (Math.abs(midiFloat - center) > this.splitThreshold(values)) {
      // agreeing with the candidate, not merely with being far from the centre:
      // a wobble that wanders is not a note, it is a wobble
      if (this.pending && Math.abs(midiFloat - this.pending[0].midiFloat) <= this.splitSemitones) {
        this.pending.push(frame);
        if (this.pending.length >= this.holdFrames) {
          const note = this.closeCurrent();
          if (note) out.push(note);
          this.current = { frames: this.pending };
          this.pending = null;
        }
      } else {
        this.pending = [frame];
      }
    } else {
      // Came back. A swing that returns is part of this note and its frames go
      // in, or the median leans toward whichever side of the vibrato happened
      // not to trip the threshold. An octave slip is not a swing and is still
      // thrown away — that is what this branch was always for.
      if (this.pending) {
        for (const p of this.pending) {
          if (Math.abs(p.midiFloat - center) < 2) this.current.frames.push(p);
        }
        this.pending = null;
      }
      this.current.frames.push(frame);
    }
    return out;
  }

  // How far a frame must sit from the note's centre before it is even a
  // candidate for a new note.
  //
  // A fixed distance is wrong for a note that is visibly wobbling, and the way
  // it was wrong was not the obvious one. The centre is the median of the note
  // SO FAR, and a note that began halfway up a vibrato swing has not yet seen
  // both sides of it — so its median sits off true centre, by as much as a
  // third of a semitone, until a full period has gone by. At 6 Hz a period is
  // 14 frames and the median settles before it can do any harm. At 4 Hz it is
  // 21, and the opposite swing arrives while the centre is still leaning: the
  // note splits on a wobble that never actually crossed the threshold from
  // where the note really was. One sung note came back as nineteen.
  //
  // So a note's own swing widens its threshold. Measured from the note, so it
  // costs nothing on a steady tone and grows only for a player who vibrates.
  // Capped, because the tolerance must never reach a semitone — a singer with
  // a wide vibrato still sings semitone steps, and a threshold that swallowed
  // one would trade this bug for a worse one.
  //
  // This is a DEFAULT and not a voice-only profile because a voice was never
  // the only instrument affected, only the loudest about it. Measured on the
  // defaults as they stood: a held note with ±50 cent vibrato — ordinary on a
  // cello, and this app was written by a cellist — came back as twenty-four
  // notes, and a two-note semitone step under the same vibrato as ten. Every
  // intonation number the app has ever shown for a vibrated note was computed
  // over fragments of it.
  //
  // 0.4 was chosen by sweep, not by taste. Below 0.35 a semitone step sung
  // with a wide vibrato still fragments; at 0.6 the tolerance grows far enough
  // to swallow that step and report one note where there were two. The whole
  // safe band is 0.35 to 0.5 and this sits in the middle of it.
  splitThreshold(values) {
    if (!this.swingTolerance) return this.splitSemitones;
    const swing = (Math.max(...values) - Math.min(...values)) / 2;
    return this.splitSemitones + Math.min(swing, this.swingTolerance);
  }

  flush() {
    this.pending = null;
    const note = this.closeCurrent();
    return note ? [note] : [];
  }

  closeCurrent() {
    if (!this.current) return null;
    const { frames } = this.current;
    this.current = null;

    const start = frames[0].time;
    const end = frames.at(-1).time;
    if (end - start < this.minDuration) return null;

    const centerMidi = median(frames.map((f) => f.midiFloat));
    const midi = Math.round(centerMidi);
    return {
      start,
      end,
      midi,
      name: midiToName(midi),
      cents: (centerMidi - midi) * 100,
    };
  }
}
