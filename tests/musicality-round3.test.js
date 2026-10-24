import { describe, test, expect } from 'vitest';
import { musicalityOf, compareMusicality, GENERIC_RANGE, rangeFor } from '../src/analysis/musicality.js';
import { musicalityFacts, compareMusicalityFacts } from '../src/ai/musicality-facts.js';
import { buildSpec, idealTake, wobbleOnsets } from './helpers/musicality-synth.js';

// Round 3: faults a skeptic found in the musicality module after round 2
// (branch ai-fix-musicality, 26c4196). Every test here FAILS on 26c4196 (checked
// by putting the old src files back) and passes now. Takes are built with known
// shaping; what needs the real Analyzer is in tools/musicality-synth-check.mjs.
const take = (opts) => idealTake(buildSpec(opts));
const read = (opts) => musicalityOf(take(opts));
const noisy = (opts, ms, seed) => musicalityOf(wobbleOnsets(take(opts), ms, seed));
const d = (m, key) => m.descriptors[key];
const named = (m, name = 'Etude', day = 20) => ({ id: day, name, date: new Date(2026, 9, day).getTime(), musicality: m });

describe('1. "about the same" is said only of rows that were measured in both, and names them', () => {
  test('two takes that were both too quiet to read are NOT said to be shaped about the same', () => {
    // most of the loud sound is not inside any heard note: refused as too quiet, every descriptor withdrawn
    const dead = (seed) => {
      const t = take({ phrases: 6, perPhrase: 10, seed });
      // readings carry the loudness; a take whose loud sound is mostly unheard is refused
      return musicalityOf({ notes: t.notes.slice(0, 12), readings: t.readings });
    };
    const a = dead(1);
    const b = dead(2);
    expect(a.reliability.reason).toBe('quiet');
    const text = compareMusicalityFacts(named(a, 'A', 20), named(b, 'B', 19)).join(' ');
    expect(text).not.toMatch(/about the same/);
    expect(text).toMatch(/cannot say whether/);
  });

  test('a 14-note take against an 80-note one names only the rows that were measured in both', () => {
    const short = read({ phrases: 1, perPhrase: 14, shape: 'flat', articulation: 0.9 });
    const long = read({ phrases: 8, perPhrase: 10, shape: 'flat', articulation: 0.9 });
    const rows = compareMusicality(short, long);
    const measuredBoth = rows.filter((r) => r.verdict !== 'unmeasured');
    const text = compareMusicalityFacts(named(short, 'Short', 20), named(long, 'Long', 19)).join(' ');
    const line = text.match(/are shaped about the same on ([^.]*)\./);
    if (measuredBoth.length === 0) {
      expect(line).toBeNull();
    } else {
      expect(line).not.toBeNull();
      for (const r of measuredBoth.filter((x) => x.verdict === 'about the same')) expect(line[1]).toContain(r.label);
      for (const r of rows.filter((x) => x.verdict === 'unmeasured')) expect(line[1]).not.toContain(r.label);
    }
    expect(text).not.toMatch(/everything/);
  });

  test('a topic that hides a row that differed does not turn into "the same on everything"', () => {
    const connected = read({ shape: 'flat', articulation: 0.98 });
    const detached = read({ shape: 'flat', articulation: 0.45 });
    const all = compareMusicalityFacts(named(connected, 'Etude', 20), named(detached, 'Etude', 19)).join(' ');
    expect(all).toMatch(/more detached|more connected/);
    const phrasing = compareMusicalityFacts(named(connected, 'Etude', 20), named(detached, 'Etude', 19), { question: 'how are my phrases' }).join(' ');
    // the articulation row differs but is not asked about: the line names what it IS about
    expect(phrasing).toMatch(/shaped about the same on phrases found/);
    expect(phrasing).not.toMatch(/everything|legato or detached/);
  });

  test('when no wanted row was read in both, the line says nothing could be compared', () => {
    const none = read({ phrases: 1, perPhrase: 6 });
    const text = compareMusicalityFacts(named(none, 'A', 20), named(none, 'B', 19)).join(' ');
    expect(text).not.toMatch(/about the same/);
    expect(text).toMatch(/was measured in both takes, so I cannot say whether they are shaped alike/);
  });
});

describe('2. the phrase count is not compared between takes of different lengths', () => {
  // One player who phrases in tens of notes, 3 to 12 phrases a take, 80 pairs:
  // 26c4196 said "more, shorter phrases" of 72 of them.
  const tk = (phrases, seed) => musicalityOf(wobbleOnsets(take({ phrases, perPhrase: 10, period: 0.5, shape: 'flat', articulation: 0.9, jitter: 0.04, seed }), 12, seed));
  const lens = [3, 4, 6, 8, 12];

  test('no row of any pair of one player at different lengths says the phrases changed', () => {
    let pairs = 0;
    const moved = [];
    for (let seed = 1; seed <= 4; seed++) {
      for (let i = 0; i < lens.length; i++) for (let j = i + 1; j < lens.length; j++) {
        pairs++;
        for (const r of compareMusicality(tk(lens[i], seed), tk(lens[j], seed + 100))) {
          if (/phrase-(count|length)/.test(r.key) && r.verdict !== 'about the same') moved.push(`${lens[i]} v ${lens[j]}: ${r.verdict}`);
        }
      }
    }
    expect(pairs).toBe(40);
    expect(moved).toEqual([]);
  });

  test('the count row is left out when the takes differ in length by more than a fifth, and kept when they do not', () => {
    expect(compareMusicality(tk(3, 1), tk(8, 2)).some((r) => r.key === 'phrase-count')).toBe(false);
    expect(compareMusicality(tk(6, 1), tk(6, 2)).some((r) => r.key === 'phrase-count')).toBe(true);
  });

  test('a player who really does phrase in shorter pieces is still told so, at any take length', () => {
    const short = musicalityOf(wobbleOnsets(take({ phrases: 12, perPhrase: 5, period: 0.5, shape: 'flat', articulation: 0.9, jitter: 0.04, seed: 3 }), 12, 3));
    const long = tk(6, 4);
    const row = compareMusicality(long, short).find((r) => r.key === 'phrase-length');
    expect(row.verdict).toBe('shorter phrases');
    expect(row.before).toBe(10);
    expect(row.after).toBe(5);
    const text = compareMusicalityFacts(named(short, 'Etude', 20), named(long, 'Etude', 19)).join(' ');
    expect(text).toMatch(/Typical phrase length: "Etude, Oct 19" 10 notes, "Etude, Oct 20" 5 notes/);
  });
});

describe('3. phrases are found at the take\'s own spacing, not at a number of seconds', () => {
  // The same performance (breath 0.6 of a note, eight phrases of eight) scaled
  // in time, each with 14 ms of onset error: on 26c4196 it was 8 phrases at
  // 0.4 s a note and 1-3 at 0.3 s.
  const at = (period, seed) => musicalityOf(wobbleOnsets(take({ phrases: 8, perPhrase: 8, period, breath: 0.6 * period, shape: 'flat', articulation: 0.97, jitter: 0.06, seed }), 14, seed));

  test('eight phrases of eight are found at 0.3, 0.35, 0.4 and 0.7 s a note, 10 seeds each', () => {
    for (const period of [0.3, 0.35, 0.4, 0.7]) {
      const counts = Array.from({ length: 10 }, (_, i) => d(at(period, i + 1), 'phrase-count').value);
      expect(counts, `period ${period}`).toEqual(Array(10).fill(8));
    }
  });

  test('the same performance at two tempos compares as the same on every phrase row, 10 seeds, 3 pairs of tempos', () => {
    for (const [fast, slow] of [[0.3, 0.7], [0.35, 0.5], [0.4, 0.7]]) {
      for (let seed = 1; seed <= 10; seed++) {
        const moved = compareMusicality(at(slow, seed + 50), at(fast, seed)).filter((r) => /^phrase-/.test(r.key) && r.verdict !== 'about the same' && r.verdict !== 'unmeasured');
        expect(moved.map((r) => r.verdict), `${fast} v ${slow} seed ${seed}`).toEqual([]);
      }
    }
  });

  test('a take with no breath in it is still one phrase at any tempo, whatever its articulation, loudness or phrase-end stretch', () => {
    for (const period of [0.15, 0.25, 0.4, 0.7, 1.1]) {
      for (const o of [{ articulation: 0.7, articulationJitter: 0.25 }, { shape: 'jump', peakDb: 6 }, { finalStretch: 1.5 }, { shape: 'arch' }]) {
        const m = musicalityOf(wobbleOnsets(take({ phrases: 6, perPhrase: 10, period, breath: 0, shape: 'flat', articulation: 0.9, jitter: 0.04, seed: 3, ...o }), 15, 3));
        expect(d(m, 'phrase-count').value, `${period} ${JSON.stringify(o)}`).toBe(1);
      }
    }
  });

  test('a take faster than the pipeline can see breaths in is not compared on its phrases at all', () => {
    const fastTake = musicalityOf(wobbleOnsets(take({ phrases: 8, perPhrase: 8, period: 0.2, breath: 0.12, shape: 'flat', articulation: 0.97, jitter: 0.06, seed: 1 }), 14, 1));
    const rows = compareMusicality(at(0.5, 2), fastTake);
    expect(rows.filter((r) => /^phrase-(count|length)$/.test(r.key))).toEqual([]);
    expect(rows.some((r) => r.key === 'articulation')).toBe(true);
  });
});

describe('5. a range is always checked, and a sound that never stops is not read as phrases', () => {
  // A 60 Hz hum through the real Analyzer + segmenter is 130-230 'notes' a pitch
  // tracker drew along its drift, abutting, with the loudness never dipping:
  // tools/musicality-synth-check.mjs makes that one. Here the same shape by hand.
  const hum = (count, { dips = false, base = 35 } = {}) => {
    const notes = [];
    const readings = [];
    let t = 0;
    let m = base;
    for (let i = 0; i < count; i++) {
      m = Math.max(base - 3, Math.min(base + 3, m + [1, -1, 0, 1, -1, -1, 1][i % 7]));
      const dur = 0.4 + 0.1 * (i % 5);
      notes.push({ start: t, end: t + dur, midi: m, cents: 0 });
      for (let r = t; r < t + dur; r += 0.0232) readings.push({ time: r, frequency: 440 * 2 ** ((m - 69) / 12), confidence: 0.9, rms: 0.03 });
      if (dips) for (let r = t + dur; r < t + dur + 0.08; r += 0.0232) readings.push({ time: r, frequency: 0, confidence: 0, rms: 0.0004 });
      t += dur + (dips ? 0.08 : 0);
    }
    return { notes, readings };
  };

  test('a hum is said to be unreadable, not "one continuous stretch" or a number of phrases', () => {
    const m = musicalityOf(hum(60));
    expect(m.reliability.reason).toBe('unbroken');
    expect(d(m, 'phrase-count').measured).toBe(false);
    expect(d(m, 'phrase-count').reason).toMatch(/never dropped between notes/);
    for (const k of ['phrase-shape', 'tempo-flexibility', 'articulation', 'stretch-contrast']) expect(d(m, k).measured, k).toBe(false);
    expect(d(m, 'character').measured).toBe(false);
  });

  test('the sentence a player sees says the phrases cannot be read from it', () => {
    const text = musicalityFacts({ id: 1, name: 'Hum', date: Date.UTC(2026, 9, 20), musicality: musicalityOf(hum(60)) }, { question: 'how is my phrasing' }).join(' ');
    expect(text).toMatch(/stayed within a few dB and never dropped between notes/);
    expect(text).toMatch(/hum or a held tone/);
    expect(text).not.toMatch(/not what playing is like/);
    expect(text).not.toMatch(/continuous stretch|phrases of about/);
  });

  test('a long slur with no breath in it that swells and fades is NOT unbroken (a first cut of the gate withdrew it whole)', () => {
    // continuous sound, no silence anywhere, but the loudness moves by 7 dB: 1.2% of its readings are 12 dB down
    // through the real pipeline, which tripped a gate that looked at that alone
    const slur = read({ phrases: 6, perPhrase: 10, period: 0.5, articulation: 1.0, breath: 0, shape: 'arch', peakDb: 7 });
    expect(slur.reliability.reason).toBe(null);
    expect(slur.reliability.levelSpreadDb).toBeGreaterThan(3);
    expect(d(slur, 'articulation').measured).toBe(true);
  });

  test('the same notes with a quiet gap after each are an ordinary take and are still read', () => {
    const m = musicalityOf(hum(60, { dips: true }));
    expect(m.reliability.reason).toBe(null);
    expect(d(m, 'articulation').measured).toBe(true);
  });

  test('with no range given, pitch no instrument makes is checked against the generic range', () => {
    const rumble = hum(60, { base: 14, dips: true });          // 20 Hz: below any instrument or voice
    const m = musicalityOf(rumble);
    expect(m.reliability.outOfRange).toBe(true);
    expect(m.reliability.rangeGiven).toBe(false);
    expect(musicalityOf(hum(60, { base: 50, dips: true })).reliability.outOfRange).toBe(false);
    expect(GENERIC_RANGE.lowMidi).toBeLessThanOrEqual(28);
    // and the facts say so without naming an instrument that nobody gave
    const text = musicalityFacts({ id: 1, name: 'Rumble', date: Date.UTC(2026, 9, 20), musicality: m }).join(' ');
    expect(text).toMatch(/outside any instrument's or voice's range/);
  });

  test('a caller that knows the family passes its range and gets the tighter check', () => {
    // a take heard an octave and more too low for a voice: fine for a double bass
    const low = hum(60, { base: 30, dips: true });
    expect(musicalityOf({ ...low, range: rangeFor('voice') }).reliability.outOfRange).toBe(true);
    expect(musicalityOf({ ...low, range: rangeFor('strings') }).reliability.outOfRange).toBe(false);
    expect(musicalityOf({ ...low, range: rangeFor('voice') }).reliability.rangeGiven).toBe(true);
    expect(rangeFor('nothing')).toEqual(GENERIC_RANGE);
  });
});

describe('6. the tempo shape is judged on the whole curve and never says "comes back" of a take that did not', () => {
  const tk = (extra, seed) => noisy({ phrases: 6, perPhrase: 10, period: 0.5, breath: 0.35, shape: 'flat', articulation: 0.9, jitter: 0.04, seed, ...extra }, 15, seed);
  const kinds = (extra) => {
    const k = {};
    for (let seed = 1; seed <= 20; seed++) {
      const t = d(tk(extra, seed), 'tempo-shape');
      const name = t.measured ? t.detail.kind : 'refused';
      k[name] = (k[name] ?? 0) + 1;
    }
    return k;
  };

  test('a real +11% accelerando (20 takes) is a drift or a slight one and is never "steady" or "returns"', () => {
    const k = kinds({ drift: 0.1 });
    expect((k.returns ?? 0) + (k.steady ?? 0) + (k.level ?? 0), JSON.stringify(k)).toBe(0);
    expect((k['speeds-up'] ?? 0) + (k['leans-faster'] ?? 0), JSON.stringify(k)).toBeGreaterThanOrEqual(18);
  });

  test('a real -9% ritardando is the same, the other way', () => {
    const k = kinds({ drift: -0.1 });
    expect((k.returns ?? 0) + (k.steady ?? 0) + (k.level ?? 0), JSON.stringify(k)).toBe(0);
    expect((k['slows-down'] ?? 0) + (k['leans-slower'] ?? 0), JSON.stringify(k)).toBeGreaterThanOrEqual(18);
  });

  test('a constant tempo is still steady, 20 of 20', () => {
    expect(kinds({})).toEqual({ steady: 20 });
  });

  test('"comes back to where it began" is only said of a curve that ends within 4% of its start', () => {
    let returns = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const wave of [0.08, 0.15]) {
        const t = d(tk({ wave, phrases: 8 }, seed), 'tempo-shape');
        if (t.measured && t.detail.kind === 'returns') {
          returns++;
          expect(Number(t.phrase.match(/ends within (\d+)% of the start/)[1]), t.phrase).toBeLessThanOrEqual(4);
        }
      }
    }
    expect(returns).toBeGreaterThan(5);
    // and a wave that stops somewhere else is not said to come back at all
    const off = d(read({ wave: 0.15, phrases: 12, perPhrase: 10 }), 'tempo-shape');
    expect(off.detail.kind).toBe('moves');
    expect(off.phrase).not.toMatch(/comes back/);
  });

  test('a follower on two thirds of the beat for 14 notes is refused, not read as a free tempo of 22%', () => {
    // seed 2700 of the random constant-tempo family: 26c4196 printed "the tempo is free, moving by about 22%" and
    // "comes back to where it began" of a player who never changed tempo
    const m = tk({ perPhrase: 16, jitter: 0.12, articulation: 0.97, seed: 2700 }, 2700);
    expect(d(m, 'tempo-flexibility').measured).toBe(false);
    expect(d(m, 'tempo-flexibility').reason).toMatch(/commonest spacing for a different note value/);
    expect(d(m, 'tempo-shape').measured).toBe(false);
  });

  test('an accelerando against a steady take of the same piece is a difference, in the numbers and in the sentence', () => {
    // 26c4196 compared no row about drift, and said "shaped about the same on how much the tempo moves"
    const accel = tk({ drift: 0.1 }, 3);
    const steady = tk({}, 3);
    const row = compareMusicality(steady, accel).find((r) => r.key === 'tempo-drift');
    expect(row.verdict).toBe('the tempo drifts faster over the take');
    expect(row.direction).toBe('higher');
    expect(compareMusicality(accel, steady).find((r) => r.key === 'tempo-drift').verdict).toBe('the tempo drifts slower over the take');
    expect(compareMusicality(steady, tk({}, 4)).find((r) => r.key === 'tempo-drift').verdict).toBe('about the same');
    const text = compareMusicalityFacts(named(accel, 'Etude', 20), named(steady, 'Etude', 19), { question: 'did my tempo change' }).join(' ');
    expect(text).toMatch(/Whether the tempo drifts: .*level.*speeding up/);
    expect(text).not.toMatch(/about the same on how much the tempo moves/);
  });

  test('the take that speeds up is described as speeding up in its character, and its spread is not left saying "steady" alone', () => {
    const accel = tk({ drift: 0.1 }, 3);
    expect(d(accel, 'character').phrase).toMatch(/getting faster through the take/);
    expect(d(accel, 'character').phrase).not.toMatch(/steady in tempo/);
    expect(d(accel, 'tempo-flexibility').phrase).toMatch(/not counting its drift through the take/);
  });

  test('a true 15% wave is still read as a moving tempo in at least 30 of 40 takes', () => {
    let moving = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const f = d(tk({ wave: 0.15, phrases: 8, jitter: [0.02, 0.04, 0.08][seed % 3] }, seed), 'tempo-flexibility');
      if (f.measured && f.detail.word !== 'steady') moving++;
    }
    expect(moving).toBeGreaterThanOrEqual(30);
  });
});

describe('7. tempo flexibility does not depend on how long the take is', () => {
  const at = (notes, seed, jitter) => noisy({ phrases: notes / 14, perPhrase: 14, period: 0.4, breath: 0.28, shape: 'flat', articulation: 0.9, jitter, seed: seed * 7 + notes }, 15, seed + notes);

  test('under 24 steady spacings the spread is refused instead of being read from a length where it is not stable', () => {
    const m = at(14, 3, 0.04);
    expect(d(m, 'tempo-flexibility').measured).toBe(false);
    expect(d(m, 'tempo-flexibility').reason).toMatch(/windows of 24/);
  });

  test('the same playing (spacings off by up to 4%) reads within 8% of itself at 28 and at 448 notes', () => {
    const mean = (notes) => {
      const v = [];
      for (let seed = 1; seed <= 40; seed++) { const f = d(at(notes, seed, 0.04), 'tempo-flexibility'); if (f.measured) v.push(f.value); }
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    const short = mean(28);
    const long = mean(448);
    expect(Math.abs(short - long) / long).toBeLessThan(0.08);
  });

  test('a player at +-9% a spacing is not called "steady" by a short take and "gives a little" by a long one', () => {
    // (the word 26c4196 would have printed is derived from the number and its fixed line, so this fails there too)
    const wordOf = (f) => (!f.measured ? null : f.detail.word ?? (f.value < f.detail.steadyBelow ? 'steady' : f.value >= f.detail.freeAbove ? 'free' : 'gives'));
    const steadyAt = (notes) => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) if (wordOf(d(at(notes, seed, 0.09), 'tempo-flexibility')) === 'steady') n++;
      return n;
    };
    // 26c4196 said "steady" of 12 of 40 takes of 56 notes and none of 40 takes of 448
    expect(steadyAt(56)).toBeLessThanOrEqual(4);
    expect(steadyAt(448)).toBeLessThanOrEqual(1);
  });

  test('a number near a line says it is on the edge, with the standard error it was judged by', () => {
    let edge = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const f = d(at(56, seed, 0.09), 'tempo-flexibility');
      if (f.measured && /edge between steady and giving a little/.test(f.phrase)) edge++;
      if (f.measured) expect(f.detail.se).toBeGreaterThan(0);
    }
    expect(edge).toBeGreaterThan(10);
  });

  test('two takes of the same playing at 28 and 448 notes do not compare as a change of tempo flexibility', () => {
    let moved = 0;
    for (let seed = 1; seed <= 20; seed++) {
      moved += compareMusicality(at(28, seed, 0.09), at(448, seed, 0.09)).filter((r) => r.key === 'tempo-flexibility' && r.verdict !== 'about the same' && r.verdict !== 'unmeasured').length;
    }
    expect(moved).toBe(0);
  });
});

describe('7b. the word for repeat timing does not flip with the length of the take', () => {
  // The median does not move with length (3.8-4.05% at +-4% jitter from 16 notes to 320), its spread does, and a
  // player near the line was "alike" in 80% of 28-note takes and 98% of 672-note ones at +-6% jitter
  const at = (notes, seed) => noisy({ phrases: 1, perPhrase: notes, period: 0.4, breath: 0, shape: 'flat', articulation: 0.9, jitter: 0.06, seed: seed * 13 + notes }, 15, seed);
  const wordOf = (r) => (!r.measured ? null : r.detail.word ?? (r.value < r.detail.sameBelow ? 'alike' : 'different'));

  test('a +-6% player is "timed differently" in at most 6 of 100 takes of 32 notes (20 of 100 on 26c4196)', () => {
    let different = 0;
    for (let seed = 1; seed <= 100; seed++) if (wordOf(d(at(32, seed), 'repeat-timing')) === 'different') different++;
    expect(different).toBeLessThanOrEqual(6);
  });

  test('the number carries its standard error, which falls as the take gets longer, and a number near the line says so', () => {
    const se = (notes) => { const r = d(at(notes, 3), 'repeat-timing'); return r.detail.se; };
    expect(se(24)).toBeGreaterThan(se(96));
    let edge = 0;
    for (let seed = 1; seed <= 100; seed++) { const r = d(at(32, seed), 'repeat-timing'); if (/on the edge between alike and different/.test(r.phrase)) edge++; }
    expect(edge).toBeGreaterThan(20);
  });
});

describe('4. pitch wander in the quiet tail of a decaying note is not a vibrato that opens up', () => {
  // Piano, guitar and harp notes die away, and a pitch tracker's reading of the
  // last of one wanders by 10-20 cents at about a vibrato's rate: the plain
  // first half and wandering second half read as "starts plain and opens up".
  // (A staccato line in a 3 s hall does the same through the real pipeline:
  // 7 of 12 long notes; tools/musicality-synth-check.mjs.)
  const decaying = (seed, extra = {}) => read({ phrases: 6, perPhrase: 8, period: 2.0, articulation: 1.0, decay: 1.0, tailWobble: 14, shape: 'flat', breath: 0.1, seed, ...extra });

  test('4 takes of a decaying tone do not report vibrato opening up', () => {
    for (const seed of [1, 2, 3, 4]) {
      const v = d(decaying(seed), 'vibrato-growth');
      expect(v.measured && v.value >= 50, `seed ${seed}: ${v.phrase}`).toBe(false);
    }
  });

  test('a note that swells into its peak keeps its quiet start, so a vibrato that opens up on it still reads as opening', () => {
    // 36 dB up over the first 60% of each note (messa di voce): the first cut of the tail filter dropped every frame
    // under -9 dB wherever it fell, which took the plain early half away and read "about the same width" (48 of 48)
    const swell = (vibrato) => read({ phrases: 6, perPhrase: 8, period: 2.0, articulation: 0.9, breath: 0.1, shape: 'flat', vibrato, swell: 36 });
    expect(d(swell('grows'), 'vibrato-growth').value).toBeGreaterThanOrEqual(80);
    expect(d(swell('steady'), 'vibrato-growth').value).toBeLessThanOrEqual(20);
  });

  test('the same notes with a real vibrato that opens up are still read as opening', () => {
    const m = read({ phrases: 6, perPhrase: 8, period: 2.0, articulation: 0.9, shape: 'flat', vibrato: 'grows', breath: 0.1 });
    expect(d(m, 'vibrato-growth').measured).toBe(true);
    expect(d(m, 'vibrato-growth').value).toBeGreaterThanOrEqual(80);
  });
});
