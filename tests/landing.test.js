import { describe, test, expect } from 'vitest';
import { noteLanding, landingReport, leapBand } from '../src/analysis/landing.js';
import { Analyzer } from '../src/audio/analyzer.js';
import { NoteSegmenter } from '../src/analysis/notes.js';

const SR = 44100;
const A4 = 440;
const HOP = 512 / SR; // the live hop, ~11.6 ms

// A synthetic pitch trace: cents(t) in, readings out. Lets the unit tests state
// exactly what the player did without going through audio.
function traceReadings(note, centsAt, { confidence = 0.9 } = {}) {
  const out = [];
  for (let t = note.start; t <= note.end; t += HOP) {
    const cents = centsAt(t - note.start);
    const midiFloat = note.midi + cents / 100;
    out.push({
      time: t,
      frequency: A4 * 2 ** ((midiFloat - 69) / 12),
      confidence,
      rms: 0.1,
    });
  }
  return out;
}

const noteAt = (midi, start, end, name = 'A3') => ({ midi, name, start, end, cents: 0 });

describe('noteLanding', () => {
  test('a note that speaks in tune and stays there lands clean', () => {
    const note = noteAt(57, 1, 1.8);
    const l = noteLanding(note, traceReadings(note, () => 2), A4);
    expect(l.approach).toBe('centred');
    expect(l.settled).toBe(true);
    expect(l.settleMs).toBeLessThanOrEqual(20);
    expect(Math.abs(l.onsetCents)).toBeLessThan(5);
  });

  test('a note that arrives flat and is corrected reports both the arrival and the delay', () => {
    // 30 cents flat, gliding to centre over 200 ms
    const note = noteAt(57, 1, 2);
    const l = noteLanding(note, traceReadings(note, (dt) => -30 + 30 * Math.min(1, dt / 0.2)), A4);
    expect(l.approach).toBe('flat');
    expect(l.onsetCents).toBeLessThan(-15);
    expect(l.settled).toBe(true);
    expect(l.settleMs).toBeGreaterThan(120);
    expect(l.settleMs).toBeLessThan(230);
    expect(l.travelCents).toBeGreaterThan(15); // it travelled upward to get there
  });

  test('passing through the centre does not count as landing on it', () => {
    // a continuous slide straight past the note: momentarily in tune, never settled
    const note = noteAt(57, 1, 1.6);
    const l = noteLanding(note, traceReadings(note, (dt) => -60 + 200 * dt), A4);
    expect(l.settled).toBe(false);
    expect(l.settleMs).toBeNull();
  });

  test('a note that never gets in tune reports no settle', () => {
    const note = noteAt(57, 1, 1.8);
    const l = noteLanding(note, traceReadings(note, () => -28), A4);
    expect(l.settled).toBe(false);
    expect(l.approach).toBe('flat');
  });

  test('the in-tune band is the one from settings', () => {
    const note = noteAt(57, 1, 1.8);
    const readings = traceReadings(note, () => 10);
    expect(noteLanding(note, readings, A4, { tolerance: 8 }).settled).toBe(false);
    expect(noteLanding(note, readings, A4, { tolerance: 12 }).settled).toBe(true);
  });

  test('returns null rather than guessing when the detector lost the note', () => {
    const note = noteAt(57, 1, 1.8);
    expect(noteLanding(note, traceReadings(note, () => 0, { confidence: 0.2 }), A4)).toBeNull();
    expect(noteLanding(note, [], A4)).toBeNull();
  });
});

describe('leapBand', () => {
  test('sorts the distance a player had to cover', () => {
    expect(leapBand(0).key).toBe('same');
    expect(leapBand(2).key).toBe('step');
    expect(leapBand(-2).key).toBe('step');
    expect(leapBand(7).key).toBe('leap');
    expect(leapBand(-12).key).toBe('shift');
  });
});

describe('landingReport', () => {
  // eight notes: the steps land clean, the big shifts arrive flat and scoop
  function take() {
    const midis = [57, 59, 57, 69, 57, 59, 57, 69];
    const notes = [];
    const readings = [];
    midis.forEach((midi, i) => {
      const note = noteAt(midi, i * 0.9, i * 0.9 + 0.7);
      notes.push(note);
      const previous = midis[i - 1];
      const isShift = previous !== undefined && Math.abs(midi - previous) > 7;
      readings.push(...traceReadings(note, (dt) => (isShift
        ? -35 + 35 * Math.min(1, dt / 0.25) // arrives flat, corrects
        : 2)));
    });
    return { notes, readings };
  }

  test('separates landing clean from correcting into tune', () => {
    const { notes, readings } = take();
    const r = landingReport(notes, readings, A4);
    // five steps and repeats land clean; the three octave jumps scoop
    expect(r.counts.clean).toBe(5);
    expect(r.counts.settled).toBe(3);
    expect(r.cleanShare).toBeCloseTo(5 / 8, 2);
    expect(r.medianSettleMs).toBeGreaterThan(150);
  });

  test('names the direction the misses come from', () => {
    const { notes, readings } = take();
    expect(landingReport(notes, readings, A4).approachBias).toBe('flat');
  });

  test('breaks the habit down by how far the player had to move', () => {
    const { notes, readings } = take();
    const r = landingReport(notes, readings, A4);
    const shifts = r.byBand.find((b) => b.key === 'shift');
    const steps = r.byBand.find((b) => b.key === 'step');
    expect(shifts.cleanShare).toBe(0);
    expect(steps.cleanShare).toBe(1);
    expect(shifts.medianOnsetCents).toBeLessThan(-15);
  });

  test('the first note is not blamed on an interval it did not come from', () => {
    const { notes, readings } = take();
    expect(landingReport(notes, readings, A4).rows[0].band).toBeNull();
  });

  test('returns null on a take too short to have a habit', () => {
    const note = noteAt(57, 0, 0.5);
    expect(landingReport([note], traceReadings(note, () => 0), A4)).toBeNull();
  });
});

// The point of this one: everything above feeds noteLanding a perfect trace.
// This asks whether the REAL analyzer — a 46 ms window, YIN losing confidence
// through the attack, the segmenter guessing where the note began — leaves
// enough behind to still see a scoop. If it doesn't, the feature is measuring
// its own smoothing.
describe('landing survives the real analysis pipeline', () => {
  function render(centsAt, seconds, midi) {
    const base = A4 * 2 ** ((midi - 69) / 12);
    const n = Math.floor(seconds * SR);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const freq = base * 2 ** (centsAt(t) / 1200);
      phase += (2 * Math.PI * freq) / SR;
      let v = 0;
      for (let h = 1; h <= 12; h++) v += Math.sin(phase * h) / h;
      out[i] = v * 0.3;
    }
    return out;
  }

  function analyse(audio) {
    const analyzer = new Analyzer(SR, { dual: true, hopSize: 512 });
    const segmenter = new NoteSegmenter();
    const notes = [];
    const readings = [];
    for (let i = 0; i < audio.length; i += 128) {
      for (const r of analyzer.push(audio.subarray(i, i + 128))) {
        readings.push(r);
        notes.push(...segmenter.push(r));
      }
    }
    notes.push(...segmenter.flush());
    return { notes, readings };
  }

  test('a 30-cent scoop over 150 ms is still visible after the analyzer', () => {
    const scoop = (t) => (t < 0.15 ? -30 + (30 * t) / 0.15 : 0);
    const { notes, readings } = analyse(render(scoop, 1.2, 57));
    expect(notes).toHaveLength(1);
    const l = noteLanding(notes[0], readings, A4);
    expect(l).not.toBeNull();
    // the direction and the fact of a correction must survive
    expect(l.approach).toBe('flat');
    expect(l.onsetCents).toBeLessThan(-8);
    expect(l.travelCents).toBeGreaterThan(8);
    expect(l.settled).toBe(true);
    // the window smears the timing, so this is a band, not a stopwatch
    expect(l.settleMs).toBeGreaterThan(40);
    expect(l.settleMs).toBeLessThan(320);
  });

  test('a clean attack on the same note is told apart from the scoop', () => {
    const { notes, readings } = analyse(render(() => 0, 1.2, 57));
    const l = noteLanding(notes[0], readings, A4);
    expect(l.approach).toBe('centred');
    expect(l.settleMs).toBeLessThan(60);
  });
});
