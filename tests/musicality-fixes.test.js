import { describe, test, expect } from 'vitest';
import { musicalityOf, compareMusicality } from '../src/analysis/musicality.js';
import { musicalityFacts, compareMusicalityFacts } from '../src/ai/musicality-facts.js';
import { buildSpec, idealTake, wobbleOnsets } from './helpers/musicality-synth.js';

// Faults an independent verifier found in the first version of the musicality
// module (branch ai-integrated, 2b5b284). Every test here FAILS on that commit
// (checked by putting its two files back) and passes now. The takes are built
// with known shaping; the ones that need the real Analyzer's timing noise are in
// tools/musicality-synth-check.mjs, and the few that need it here carry it
// explicitly (wobbleOnsets) rather than hoping an ideal take has it.
const take = (opts) => idealTake(buildSpec(opts));
const read = (opts) => musicalityOf(take(opts));
const d = (m, key) => m.descriptors[key];
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const named = (m, name = 'Etude') => ({ id: 1, name, date: new Date(2026, 9, 20).getTime(), musicality: m });

describe('1. loudness between stretches does not depend on how long the take is', () => {
  // The first version reported loudest minus quietest stretch: the same random
  // loudness read 0.8 dB at 20 notes, 3.4 at 80 and 5.9 at 640.
  const at = (notes) => {
    const v = [];
    for (let seed = 1; seed <= 24; seed++) {
      const m = read({ phrases: notes / 8, perPhrase: 8, shape: 'jump', peakDb: 6, seed });
      if (d(m, 'stretch-contrast').measured) v.push(d(m, 'stretch-contrast').value);
    }
    return v.length ? mean(v) : null;
  };

  test('identical random-loudness playing reads the same at 80 and at 640 notes, within a third', () => {
    const short = at(80);
    const long = at(640);
    expect(short / long).toBeGreaterThan(0.75);
    expect(short / long).toBeLessThan(1.33);
    expect(at(160) / long).toBeGreaterThan(0.75);
  });

  test('and at 40 notes, where the fewest stretches are, within a third of the long-take value', () => {
    expect(at(40) / at(640)).toBeGreaterThan(0.67);
  });

  test('below 32 notes it says so rather than reading a range of two stretches', () => {
    const m = read({ phrases: 2, perPhrase: 10, shape: 'jump', peakDb: 6, seed: 3 });
    expect(d(m, 'stretch-contrast').measured).toBe(false);
    expect(d(m, 'stretch-contrast').reason).toMatch(/32 notes/);
  });

  test('the sentences say what the number is: a standard deviation of levels, not a successive difference or a range', () => {
    const m = read({ phrases: 8, perPhrase: 8, shape: 'jump', peakDb: 6, seed: 2 });
    expect(d(m, 'stretch-contrast').phrase).toMatch(/vary in loudness by about [\d.]+ dB \(the standard deviation of their levels/);
    expect(d(m, 'stretch-contrast').phrase).not.toMatch(/to the next|loudest|quietest/);
  });

  test('the phrase-contrast sentence no longer quotes a loudest-to-quietest range, which grows with the number of phrases', () => {
    const m = read({ shape: 'flat', phraseGainDb: [0, 6, -3], phrases: 12 });
    expect(d(m, 'phrase-contrast').phrase).not.toMatch(/loudest|quietest/);
    expect(d(m, 'phrase-contrast').detail.spreadDb).toBeUndefined();
  });
});

describe('2. a comparison does not see a tempo difference as a shaping one', () => {
  // The SAME performance (every duration scaled, the breath included) at 0.4 s
  // and 0.7 s a note, each with the same 14 ms of onset error, which is the
  // pipeline's. The first version said 'repeated figures less alike in timing'
  // of 9 pairs in 20 (its fixed 1.5% threshold against a floor of 5.5% at the
  // faster tempo) and moved phrase-definition on 3 more.
  const pair = (seed) => {
    const mk = (period, s) => musicalityOf(wobbleOnsets(take({ phrases: 6, perPhrase: 10, period, breath: 0.7 * period, shape: 'flat', seed: 1 }), 14, s));
    return [mk(0.4, seed), mk(0.7, seed + 100)];
  };

  test('says about the same on every shaping row for 30 pairs of takes', () => {
    let moved = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const [fast, slow] = pair(seed);
      moved += compareMusicality(slow, fast).filter((r) => r.verdict !== 'about the same' && r.verdict !== 'unmeasured').length;
    }
    expect(moved).toBe(0);
  });

  test('the sentence a player would see says so', () => {
    const [fast, slow] = pair(4);
    const text = compareMusicalityFacts(named(fast), named(slow)).join(' ');
    expect(text).toMatch(/shaped about the same/);
    expect(text).not.toMatch(/less alike|more alike/);
  });

  test('a real difference in timing still shows, at either tempo', () => {
    for (const period of [0.4, 0.7]) {
      const same = musicalityOf(wobbleOnsets(take({ phrases: 6, perPhrase: 10, period, breath: 0.7 * period, shape: 'arch' }), 14, 5));
      const varied = musicalityOf(wobbleOnsets(take({ phrases: 6, perPhrase: 10, period, breath: 0.7 * period, shape: 'arch', sameRepeats: false, repeatVariation: 0.2 }), 14, 5));
      expect(compareMusicality(same, varied).find((r) => r.key === 'repeat-timing').verdict).toBe('matching five-note patterns played less alike in timing');
    }
  });
});

describe('3. a take that does not move is described, not graded, and only when the evidence is in', () => {
  test('phrase ends stretched 1.5 times are not "very even"', () => {
    const c = d(read({ shape: 'flat', finalStretch: 1.5 }), 'character');
    expect(c.veryEven).toBe(false);
    expect(c.phrase).not.toMatch(/very evenly|mechanical/);
  });

  test('a tempo wave and a loudness shape each withdraw it', () => {
    expect(d(read({ shape: 'flat', wave: 0.15 }), 'character').veryEven).toBe(false);
    expect(d(read({ shape: 'build' }), 'character').veryEven).toBe(false);
  });

  test('a measure that could not be read is not a measure that was flat: no phrases means no "very even"', () => {
    const m = read({ shape: 'flat', breath: 0 });
    expect(d(m, 'phrase-shape').measured).toBe(false);
    expect(d(m, 'character').veryEven).toBe(false);
  });

  test('the word is gone from everything a metronomic take says, facts included', () => {
    const m = read({ shape: 'flat' });
    expect(d(m, 'character').veryEven).toBe(true);
    const all = [d(m, 'character').phrase, ...musicalityFacts(named(m)), ...Object.values(m.descriptors).map((x) => x.phrase)].join(' ');
    expect(all).toMatch(/very evenly timed and even in loudness/);
    expect(all).not.toMatch(/mechanical|robotic|lifeless|dull/i);
  });

  test('a single pitch is said to be a single pitch, with no phrase-level reading and no character', () => {
    const m = read({ phrases: 3, perPhrase: 10, shape: 'flat', drone: true });
    expect(m.onePitch).toBe(true);
    for (const k of ['phrase-count', 'phrase-shape', 'phrase-final-lengthening', 'repeat-timing']) {
      expect(d(m, k).measured).toBe(false);
      expect(d(m, k).reason).toMatch(/same pitch/);
    }
    expect(d(m, 'character').measured).toBe(false);
    expect(d(m, 'character').veryEven).toBe(false);
    const text = musicalityFacts(named(m)).join(' ');
    expect(text).toMatch(/is the same pitch, so there is no phrase-level reading/);
    expect(text).not.toMatch(/\) reads as/);
  });
});

describe('4. repeats are described, never required', () => {
  const varied = named(read({ shape: 'arch', sameRepeats: false }));
  const same = named(read({ shape: 'arch' }));

  test('no sentence says what a repeat asks for, and none calls a match a repeated passage', () => {
    const text = [...compareMusicalityFacts(same, varied), ...compareMusicalityFacts(varied, same), ...musicalityFacts(same), ...musicalityFacts(varied)].join(' ');
    expect(text).not.toMatch(/asks for|is what repeating|repeated passage|repeated figure|came out more alike between repeats/);
    expect(text).toMatch(/matching five-note patterns/);
  });

  test('the direction is stated for the number and ranks nothing', () => {
    const rows = compareMusicality(varied.musicality, same.musicality);
    const row = rows.find((r) => r.key === 'repeat-timing');
    expect(row.verdict).toBe('matching five-note patterns played more alike in timing');
    expect(row.direction).toBe('lower');
    expect(rows.some((r) => 'better' in r)).toBe(false);
  });
});

describe('5. the tempo shape does not claim a drift the playing did not have', () => {
  // Takes with NO drift and a random 12% on every spacing: the first version
  // read 'ends 49% slower' (seed 14 at 12 phrases: after a breath the follower
  // took a long note for the beat and ran at half speed to the end) and 8-13%
  // drifts on others. 60 seeds at each length, ideal notes.
  const claims = (opts, seeds = 60) => {
    let n = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const t = d(read({ shape: 'flat', perPhrase: 10, seed, ...opts }), 'tempo-shape');
      if (t.measured && (t.detail.kind === 'speeds-up' || t.detail.kind === 'slows-down')) n++;
    }
    return n;
  };

  test('no false drift in 60 jittered takes at each of 6, 12 and 24 phrases, at 12% and 20% jitter', () => {
    for (const jitter of [0.12, 0.2]) for (const phrases of [6, 12, 24]) expect(claims({ phrases, jitter })).toBe(0);
  });

  test('a drift the second reading does not back is refused, not called a return: a true 20% drift at 12% jitter says "returns" or "steady" in at most 8 of 100 takes', () => {
    // The first cut of this fix dropped an unbacked drift into the returns/steady
    // branch and so told 33 of 100 such takes that the tempo comes back to where
    // it began; the 2b5b284 code did so in 5.
    let calm = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const t = d(read({ shape: 'flat', phrases: 6, perPhrase: 10, jitter: 0.12, seed, drift: 0.2 }), 'tempo-shape');
      if (t.measured && (t.detail.kind === 'returns' || t.detail.kind === 'steady')) calm++;
    }
    expect(calm).toBeLessThanOrEqual(8);
    let said = null;
    for (let seed = 1; seed <= 100 && !said; seed++) {
      // (a drift of 11%, not 20%: with the whole-curve trend the 20% one is found in 87 takes of 100 and
      // there is hardly anything left unbacked to refuse; at 11% and this much jitter 13 are)
      const t = d(read({ shape: 'flat', phrases: 6, perPhrase: 10, jitter: 0.12, seed, drift: 0.1 }), 'tempo-shape');
      if (!t.measured && /did not back that/.test(t.reason)) said = t.reason;
    }
    expect(said).toMatch(/seems to end (faster|slower) than it began/);
  });

  test('the half-beat lock is refused, and says so', () => {
    const t = d(read({ shape: 'flat', phrases: 12, perPhrase: 10, jitter: 0.12, seed: 14 }), 'tempo-shape');
    expect(t.measured).toBe(false);
    expect(t.reason).toMatch(/factor of two/);
  });

  test('a real drift of 20% is still found, 20 of 20, and a 15% tempo wave is still a wave', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(d(read({ shape: 'flat', phrases: 12, perPhrase: 10, jitter: 0.04, seed, drift: 0.2 }), 'tempo-shape').detail.kind).toBe('speeds-up');
    }
    // A wave is not a drift. Whether it is said to COME BACK depends on where it
    // stops: this one ends 5% from where it began, so the shape is 'moves' and says
    // it is not claimed to return (round 3: 'returns' only within 4% of the start).
    const wave = d(read({ shape: 'flat', phrases: 12, perPhrase: 10, wave: 0.15 }), 'tempo-shape');
    expect(['returns', 'moves']).toContain(wave.detail.kind);
    expect(wave.detail.kind).toBe('moves');
    expect(wave.phrase).toMatch(/not said to come back/);
  });

  test('transposing a take changes nothing about its tempo reading (the module reads onset times only)', () => {
    for (const midiShift of [-24, -12, 12, 24]) {
      const a = d(read({ shape: 'flat', phrases: 12, perPhrase: 10, jitter: 0.08, seed: 5 }), 'tempo-shape');
      const b = d(read({ shape: 'flat', phrases: 12, perPhrase: 10, jitter: 0.08, seed: 5, midiShift }), 'tempo-shape');
      expect(b.measured).toBe(a.measured);
      expect(b.value).toBe(a.value);
    }
  });
});

describe('6. a take that was not heard is not described', () => {
  // The Analyzer drops what is below its level gate but the readings still carry
  // a loudness for those frames. A take 20 dB quieter lost 48 of 60 notes and
  // the 12 left read 'detached 0.59'. Here the same loss: all readings kept, one
  // note in five kept.
  const spec = { shape: 'arch', articulation: 0.55 };
  const quiet = () => {
    const t = take(spec);
    return { notes: t.notes.filter((_, i) => i % 5 === 0), readings: t.readings };
  };

  test('most of the sound unheard: every descriptor is withdrawn and the facts say the take was too quiet', () => {
    const m = musicalityOf(quiet());
    expect(m.reliability.reason).toBe('quiet');
    expect(m.reliability.coverage).toBeLessThan(0.5);
    expect(Object.values(m.descriptors).filter((x) => x.measured)).toHaveLength(0);
    const text = musicalityFacts(named(m, 'Quiet')).join(' ');
    expect(text).toMatch(/too quiet or too unclear to hear/);
    expect(text).not.toMatch(/detached|connected|separated| dB|phrases of about/);
  });

  test('a clean take, whatever its level, is heard in full', () => {
    const m = read(spec);
    expect(m.reliability.reason).toBeNull();
    expect(m.reliability.coverage).toBeGreaterThan(0.9);
    const lower = read({ ...spec, gainDb: -20 });
    expect(lower.reliability.reason).toBeNull();
  });

  test('a take of fragments gives only legato-or-detached, from the longer notes, with no counts and no dB', () => {
    const t = take({ ...spec, articulation: 0.95 });
    const frag = t.notes.flatMap((n, i) => (i % 2 ? [n] : [0, 1, 2].map((k) => ({ ...n, start: n.start + k * 0.03, end: n.start + k * 0.03 + 0.025 }))));
    const m = musicalityOf({ notes: frag, readings: t.readings });
    expect(m.reliability.reason).toBe('fragments');
    const got = Object.values(m.descriptors).filter((x) => x.measured).map((x) => x.key);
    expect(got.every((k) => k === 'articulation' || k === 'character')).toBe(true);
    const text = musicalityFacts(named(m, 'Noisy')).join(' ');
    expect(text).toMatch(/could not be read well/);
    expect(text).not.toMatch(/ dB|phrases of about|times as long|stretch/);
  });
});

describe('7. a take whose pitches are wrong lowers confidence, and a handful of notes is not a phrase count', () => {
  const spec = { shape: 'arch', articulation: 0.55 };
  const cello = { lowMidi: 36, highMidi: 88 };   // any instrument's range is the caller's to say

  test('notes outside the range given lower every confidence and the facts say the pitch was probably read an octave off', () => {
    const t = take({ ...spec, midiShift: -24 });
    const m = musicalityOf({ ...t, range: cello });
    expect(m.reliability.outOfRange).toBe(true);
    expect(Object.values(m.descriptors).filter((x) => x.measured).every((x) => x.confidence === 'low')).toBe(true);
    const text = musicalityFacts(named(m)).join(' ');
    expect(text).toMatch(/fell outside the range of the instrument/);
    expect(text).not.toMatch(/cello/i);
  });

  test('the same take in range, or with no range given, is not flagged (the check is the caller\'s to switch on)', () => {
    expect(musicalityOf({ ...take(spec), range: cello }).reliability.outOfRange).toBe(false);
    expect(musicalityOf(take({ ...spec, midiShift: -24 })).reliability.outOfRange).toBe(false);
  });

  test('an octave drill and a wide arpeggio are not junk, however wide their steps: they come round again', () => {
    for (const pattern of [[0, 12], [0, 12, 24, 12], [0, 14, 2, 16]]) {
      const m = read({ ...spec, pattern });
      expect(m.reliability.medianStep).toBeGreaterThanOrEqual(12);
      expect(m.reliability.reason).toBeNull();
      expect(Object.values(m.descriptors).filter((x) => x.measured).length).toBeGreaterThan(8);
    }
  });

  test('random pitches are not a tune: low confidence throughout, and only legato-or-detached is given', () => {
    const m = read({ ...spec, randomPitch: true });
    expect(m.reliability.reason).toBe('junk');
    const got = Object.values(m.descriptors).filter((x) => x.measured);
    expect(got.every((x) => x.confidence === 'low' && (x.key === 'articulation' || x.key === 'character'))).toBe(true);
    expect(read(spec).reliability.reason).toBeNull();
  });

  test('twelve notes do not report a phrase count as a finding', () => {
    const m = read({ phrases: 1, perPhrase: 12, shape: 'arch' });
    expect(d(m, 'phrase-count').measured).toBe(false);
    expect(d(m, 'phrase-count').reason).toMatch(/at least 24/);
    for (const k of ['phrase-shape', 'phrase-contrast', 'phrase-final-lengthening']) expect(d(read({ phrases: 2, perPhrase: 10, shape: 'arch', finalStretch: 1.5 }), k).measured).toBe(false);
    expect(musicalityFacts(named(m)).join(' ')).not.toMatch(/phrases of about|no clear phrase breaks/);
  });
});
