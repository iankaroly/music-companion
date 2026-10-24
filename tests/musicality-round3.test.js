import { describe, test, expect } from 'vitest';
import { musicalityOf, compareMusicality } from '../src/analysis/musicality.js';
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

  test('the same notes with a real vibrato that opens up are still read as opening', () => {
    const m = read({ phrases: 6, perPhrase: 8, period: 2.0, articulation: 1.0, shape: 'flat', vibrato: 'grows', breath: 0.1 });
    expect(d(m, 'vibrato-growth').measured).toBe(true);
    expect(d(m, 'vibrato-growth').value).toBeGreaterThanOrEqual(80);
  });
});
