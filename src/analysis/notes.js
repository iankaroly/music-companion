import { midiToName } from './note-utils.js';

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Turns the Analyzer's per-hop readings into discrete notes.
//
// Splitting rules:
// - Silence/low confidence for 2+ consecutive frames closes the note.
// - A pitch jump must be sustained for 2 consecutive agreeing frames to
//   split — a single deviating frame is an octave glitch and is discarded.
// - A note's pitch is the median over its frames, so vibrato averages to
//   the perceived center instead of reading as bad intonation.
export class NoteSegmenter {
  constructor(options = {}) {
    const {
      minDuration = 0.06,       // seconds; short enough for fast sixteenth runs
      splitSemitones = 0.6,     // sustained deviation that starts a new note
      confidenceFloor = 0.6,
      rmsFloor = 0.005,
      silenceFrames = 2,
      a4 = 440,               // reference pitch for note naming and cents
    } = options;
    Object.assign(this, { minDuration, splitSemitones, confidenceFloor, rmsFloor, silenceFrames, a4 });
    this.current = null;   // { frames: [{time, midiFloat}] }
    this.pending = null;   // first frame of a possible pitch change
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
      if (this.pending && Math.abs(midiFloat - this.pending.midiFloat) <= this.splitSemitones) {
        const note = this.closeCurrent();
        if (note) out.push(note);
        this.current = { frames: [this.pending, frame] };
        this.pending = null;
      } else {
        this.pending = frame;
      }
    } else {
      this.pending = null;
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
