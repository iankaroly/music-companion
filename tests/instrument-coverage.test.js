import { describe, test, expect, afterEach } from 'vitest';
import {
  INSTRUMENTS, setInstrument, segmentation, instrumentById,
} from '../src/analysis/instruments.js';
import { TIMBRES } from '../src/audio/drone.js';
import { NoteSegmenter } from '../src/analysis/notes.js';
import { leapBand } from '../src/analysis/landing.js';

// instruments.test.js checks that each profile is well-formed. This checks the
// two places a profile has to agree with something outside itself: the drone
// that plays its timbre, and the segmenter that reads its notes. Both were
// asserted against copies of the truth rather than the truth.

afterEach(() => setInstrument('strings'));

describe('every profile reaches a drone that exists', () => {
  test('each timbre names a real recipe, not just a plausible word', () => {
    // The old assertion compared against a hardcoded list of names, so a new
    // profile with a timbre nobody had written would have passed it and then
    // played nothing.
    for (const i of INSTRUMENTS) {
      expect(Object.keys(TIMBRES)).toContain(i.timbre);
      expect(Array.isArray(TIMBRES[i.timbre])).toBe(true);
      expect(TIMBRES[i.timbre].length).toBeGreaterThan(1);
    }
  });

  test('no recipe leads with a DC term', () => {
    for (const i of INSTRUMENTS) expect(TIMBRES[i.timbre][0]).toBe(0);
  });
});

// A sung note: one pitch, with a vibrato wide enough that every swing crosses
// the segmenter's split threshold. This is the shape that used to come back as
// forty-eight notes, and it is the reason the voice profile exists.
// ±60 cents at 6 Hz is the case the voice profile was tuned against and the
// one its comment in instruments.js describes. Measured limits either side of
// it are pinned further down.
function vibratoNote({ midi = 69, cents = 60, hz = 6, seconds = 2, hop = 1 / 86 } = {}) {
  const frames = [];
  for (let t = 0; t < seconds; t += hop) {
    const deviation = (cents / 100) * Math.sin(2 * Math.PI * hz * t);
    frames.push({
      time: t,
      frequency: 440 * 2 ** ((midi + deviation - 69) / 12),
      confidence: 0.9,
      rms: 0.05,
    });
  }
  // silence long enough to close the note under any profile's silenceFrames
  for (let k = 0; k < 8; k++) {
    frames.push({ time: seconds + k * hop, frequency: null, confidence: 0, rms: 0 });
  }
  return frames;
}

// Two notes a semitone apart, both with vibrato and NO silence between them,
// so the only thing that can tell them apart is the split threshold itself.
function steppedPhrase({ from = 69, to = 70, cents = 60, hz = 5, each = 0.5, hop = 1 / 86 }) {
  const frames = [];
  let clock = 0;
  for (const midi of [from, to]) {
    for (let t = 0; t < each; t += hop) {
      const deviation = (cents / 100) * Math.sin(2 * Math.PI * hz * t);
      frames.push({
        time: clock + t,
        frequency: 440 * 2 ** ((midi + deviation - 69) / 12),
        confidence: 0.9,
        rms: 0.05,
      });
    }
    clock += each;
  }
  for (let k = 0; k < 8; k++) {
    frames.push({ time: clock + k * hop, frequency: null, confidence: 0, rms: 0 });
  }
  return frames;
}

function notesHeard(profileId, frames) {
  setInstrument(profileId);
  const seg = new NoteSegmenter({ ...segmentation() });
  const out = [];
  for (const f of frames) out.push(...seg.push(f));
  return out;
}

describe('the profile reaches the segmenter, not just the settings sheet', () => {
  const frames = vibratoNote();

  test('an ordinary vibrato is one note whichever profile is chosen', () => {
    // Both profiles get this right now that the defaults carry a swing
    // tolerance. It is the floor, not the differentiator.
    expect(notesHeard('voice', frames).length).toBe(1);
    expect(notesHeard('strings', frames).length).toBe(1);
  });

  test('a voice still hears a very wide vibrato the defaults cannot', () => {
    // Same audio, same code, different profile — this is what notices if the
    // profile ever stops reaching the segmenter. ±90 cents is past what the
    // tolerance alone can absorb, so holdFrames is doing the work here.
    const wide = vibratoNote({ cents: 90 });
    expect(notesHeard('voice', wide).length).toBe(1);
    expect(notesHeard('strings', wide).length).toBeGreaterThan(1);
  });

  test('a voice reads the note it was actually given', () => {
    // averaging the swing back to its centre, not landing on a peak
    const [note] = notesHeard('voice', frames);
    expect(note.midi ?? Math.round(note.midiFloat)).toBe(69);
  });

  test('every profile survives the same audio without throwing or hearing nothing', () => {
    for (const i of INSTRUMENTS) {
      const heard = notesHeard(i.id, frames);
      expect(heard.length).toBeGreaterThan(0);
    }
  });
});

// What the voice profile actually withstands, measured rather than assumed.
// The width it was tuned for holds; the RATE it was tuned for does not
// generalise, and that is a live defect rather than a property worth keeping.
describe('the edges of the voice profile', () => {
  const heard = (cents, hz) => notesHeard('voice', vibratoNote({ cents, hz })).length;

  test('a moderate vibrato is one note at any ordinary rate', () => {
    for (const hz of [4, 5, 6, 7]) expect(heard(40, hz)).toBe(1);
  });

  test('the tuned case holds: 60 cents at 6 Hz is one note', () => {
    expect(heard(60, 6)).toBe(1);
  });

  // This was filed as a known defect and skipped, then fixed. The cause was
  // not the one the name suggests: it was the split reference, not the hold.
  // A note that begins halfway up a swing has a median that leans until a full
  // vibrato period has passed, and at 4-5 Hz the opposite swing arrives first.
  // The numbers in the comments are what these returned before the fix.
  // The upper guard on swingTolerance, and it has to be this exact shape.
  // Wider tolerance stops a vibrato fragmenting, so the temptation is always to
  // raise it — but the tolerance is subtracted from the app's ability to hear a
  // real step, and a semitone is the smallest step there is. At 0.6 these two
  // notes merge into one and the app reports a phrase that was never sung.
  // Verified to fail at 0.6 rather than assumed to: the coarser cases are
  // insensitive to it, which is why this one is pinned at 5 Hz on the profile
  // whose holdFrames makes it hardest.
  test('the tolerance is not wide enough to swallow a sung semitone step', () => {
    const phrase = steppedPhrase({ hz: 5, cents: 60 });
    expect(notesHeard('voice', phrase).length).toBe(2);
    expect(notesHeard('voice', steppedPhrase({ hz: 5, cents: 70 })).length).toBe(2);
  });

  test('a slower vibrato of the same width is still one note', () => {
    expect(heard(60, 5)).toBe(1); // was 19
    expect(heard(60, 4)).toBe(1); // was 16
    expect(heard(70, 6)).toBe(1); // was 8
    expect(heard(70, 4)).toBe(1); // was 16
  });
});

describe('every profile can describe every distance it will be asked about', () => {
  test('no family leaves a band unnamed across the whole interval range', () => {
    // leapBand is asked for a label on every landing chart the coach draws;
    // an unnamed band renders as "undefined" in a sentence about your playing.
    for (const i of INSTRUMENTS) {
      for (let semitones = 0; semitones <= 24; semitones++) {
        const band = leapBand(semitones, instrumentById(i.id).motion);
        expect(typeof band.label).toBe('string');
        expect(band.label).not.toContain('undefined');
        expect(band.plural).not.toContain('undefined');
      }
    }
  });
});
