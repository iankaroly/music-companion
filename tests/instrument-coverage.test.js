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

function notesHeard(profileId, frames) {
  setInstrument(profileId);
  const seg = new NoteSegmenter({ ...segmentation() });
  const out = [];
  for (const f of frames) out.push(...seg.push(f));
  return out;
}

describe('the profile reaches the segmenter, not just the settings sheet', () => {
  const frames = vibratoNote();

  test('a voice hears one note where the default settings hear several', () => {
    // The assertion that matters is the difference: same audio, same code,
    // different profile. If profile ever stops reaching the segmenter this
    // is what notices.
    const asVoice = notesHeard('voice', frames);
    const asStrings = notesHeard('strings', frames);
    expect(asVoice.length).toBe(1);
    expect(asStrings.length).toBeGreaterThan(asVoice.length);
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

  // KNOWN DEFECT — not the behaviour anyone wants, recorded so that fixing it
  // has a test to turn green rather than a bug report to rediscover.
  //
  // holdFrames is a count of frames, so it is a duration: 6 frames is about
  // 70 ms. A slower vibrato spends LONGER past the split threshold on each
  // swing, so the same width that survives at 6 Hz splits at 5 Hz — and once
  // one swing has split, the new note's median sits on that peak and the
  // opposite peak is a whole tone away, which is the cascade the segmenter
  // comment already describes. 4-5 Hz is an ordinary singer's vibrato.
  test.skip('a slower vibrato of the same width should still be one note', () => {
    expect(heard(60, 5)).toBe(1); // currently 19
    expect(heard(60, 4)).toBe(1); // currently 16
    expect(heard(70, 6)).toBe(1); // currently 8 — width past the tuned point
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
