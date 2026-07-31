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
      a4 = 440,               // reference pitch for note naming and cents
    } = options;
    Object.assign(this, {
      minDuration, splitSemitones, confidenceFloor, rmsFloor, silenceFrames, holdFrames, a4,
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

    const center = median(this.current.frames.map((f) => f.midiFloat));
    if (Math.abs(midiFloat - center) > this.splitSemitones) {
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
