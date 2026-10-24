import { describe, test, expect, afterEach } from 'vitest';
import { answerQuestion, rangeFor, GENERIC_RANGE } from '../src/ai/assistant.js';
import { setInstrument } from '../src/analysis/instruments.js';
import { qualityOf } from '../src/analysis/quality.js';
import { buildSpec, idealTake } from './helpers/musicality-synth.js';
import { LIBRARIES, NOW } from './ai-eval/fixtures.js';

// musicalityOf has a reliability check for a take whose notes sit outside any
// instrument's range (a cello take read two octaves low, 30-43% of the notes of
// a real sarabande), and it is silent unless the caller passes the range. The
// assistant passed none, so the check was dead code: the facts for a take the
// tracker had plainly mis-heard described its phrasing with full confidence.
//
// WHAT A TAKE KNOWS: nothing about its instrument. Stored takes carry no
// instrument or range field (the family is one setting for the whole app,
// src/analysis/instruments.js), so the range is the player's family where they
// have chosen one and otherwise the widest range any instrument here reaches,
// the piano's A0 to C8. Notes outside THAT are impossible on anything the app
// serves, so the net cannot flag a legitimate take of any instrument.

const spec = { shape: 'arch', articulation: 0.6, finalStretch: 1.5, phrases: 6, perPhrase: 10, period: 0.5 };
const asks = (take) => answerQuestion({
  question: 'how is my phrasing', library: LIBRARIES.three, now: NOW, qualityOf, rhythmReport: () => null,
  load: async () => ({ ...take, sampleRate: 44100, a4: 440 }),
  model: { availability: async () => ({ available: false, reason: 'off' }) },
});

afterEach(() => { setInstrument('strings'); delete globalThis.localStorage; });

describe('the out-of-range check is switched on', () => {
  test('a take read two octaves too low is reported as mis-heard, and the phrasing is not described with confidence', async () => {
    const r = await asks(idealTake(buildSpec({ ...spec, midiShift: -44 })));
    const text = r.facts.join(' ');
    expect(text).toMatch(/fell outside the range of the instrument/);
  });

  test('the same take in range is not flagged, so the net is not a blanket', async () => {
    const r = await asks(idealTake(buildSpec(spec)));
    expect(r.facts.join(' ')).not.toMatch(/outside the range/);
  });
});

describe('the range is the best the app knows', () => {
  test('with no instrument chosen it is the widest any instrument here reaches', () => {
    expect(rangeFor({})).toEqual(GENERIC_RANGE);
    expect(GENERIC_RANGE).toEqual({ lowMidi: 21, highMidi: 108 });
  });

  test('a range stored with the take wins', () => {
    expect(rangeFor({ range: { lowMidi: 40, highMidi: 80 } })).toEqual({ lowMidi: 40, highMidi: 80 });
  });

  test('a chosen family narrows it, a voice does not reach a piano\'s bottom octave', () => {
    globalThis.localStorage = { getItem: (k) => (k === 'instrument' ? 'voice' : null) };
    setInstrument('voice');
    const voice = rangeFor({});
    expect(voice.lowMidi).toBeGreaterThan(GENERIC_RANGE.lowMidi);
    expect(voice.highMidi).toBeLessThan(GENERIC_RANGE.highMidi);
  });
});
