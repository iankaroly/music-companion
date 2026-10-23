// Small, deterministic libraries the evaluation questions run against.
//
// Every number a question can be answered with is chosen here by hand, so the
// right answer is known before any code runs: a take built with `bias` 9 has
// every pitch averaging 9 cents off, a take whose per-note scores are listed
// below has exactly nine notes that got closer. Nothing is random and nothing
// is derived from the code under test.

export const DAY = 24 * 60 * 60 * 1000;
export const NOW = new Date(2026, 9, 20, 12).getTime(); // Tue 20 Oct 2026, noon

const NAMES = ['D3', 'A3', 'F3', 'G3'];

// 24 notes, six of each pitch. Each pitch alternates bias-2 / bias+2, so its
// mean is exactly bias + its own offset and its spread is exactly 2.
export function rec(id, name, daysAgo, bias, { offsets = {}, scoreStats = null, quality = null, rhythm = null, empty = false } = {}) {
  const noteStats = empty ? [] : Array.from({ length: 24 }, (_, i) => {
    const pitch = NAMES[i % 4];
    return { midi: 50 + (i % 4), name: pitch, cents: bias + (offsets[pitch] ?? 0) + (Math.floor(i / 4) % 2 ? 2 : -2) };
  });
  return {
    id, name, date: NOW - daysAgo * DAY, duration: 30, noteStats, landingStats: [], scoreStats,
    // What loading the stored audio would have produced. The runner attaches
    // these only when the router asked for them, as assistant.js does.
    _quality: quality, _rhythm: rhythm,
  };
}

// Per-note scores against a score: 12 notes in 4 bars of 3. These are absolute
// cents per note, so the comparison is known by hand: 9 notes closer by more
// than the 3-cent noise floor, 1 further, 2 the same.
const NOW_C = [4, 5, 3, 10, 12, 11, 30, 34, 32, 18, 22, 20];
const WAS_C = [5, 9, 3, 18, 21, 18, 42, 28, 42, 23, 26, 26];
const perNote = (cents) => cents.map((c, i) => ({ scoreNoteId: i + 1, measure: Math.floor(i / 3) + 1, cents: c }));

const QUALITY_OLD = {
  steadinessCents: 6.2,
  vibrato: { share: 0.4, widthCents: 18, rateHz: 5.1 },
  clarity: 0.81, brightness: 3.4,
  dynamics: { medianDb: -20, rangeDb: 9, stepDb: 2.4 },
  landing: { cleanShare: 0.55, medianSettleMs: 140, medianOnsetCents: 12 },
};
const QUALITY_NEW = {
  steadinessCents: 3.1,
  vibrato: { share: 0.7, widthCents: 27, rateHz: 5.4 },
  clarity: 0.88, brightness: 3.5,
  dynamics: { medianDb: -18, rangeDb: 12, stepDb: 1.8 },
  landing: { cleanShare: 0.78, medianSettleMs: 90, medianOnsetCents: 7 },
};

export const LIBRARIES = {
  // two takes of one piece and a scale, no score behind any of them
  three: [
    rec(1, 'Bach prelude', 6, 22),
    rec(2, 'Bach prelude', 1, 9),
    rec(3, 'Scales', 3, 5),
  ],
  // the same three with the tone and rhythm that loading the audio would give
  toned: [
    rec(1, 'Bach prelude', 6, 22, { quality: QUALITY_OLD, rhythm: { bpm: 70.2, evenness: 0.74, meanAbsMs: 63, verdict: 'steady' } }),
    rec(2, 'Bach prelude', 1, 9, { quality: QUALITY_NEW, rhythm: { bpm: 71.6, evenness: 0.86, meanAbsMs: 41, verdict: 'rushing' } }),
    rec(3, 'Scales', 3, 5, { quality: QUALITY_NEW, rhythm: null }),
  ],
  one: [rec(1, 'Sarabande', 2, 12)],
  empty: [],
  // takes exist but nothing was heard in them
  silent: [rec(1, 'Warmup', 1, 0, { empty: true })],
  // two takes of one piece WITH per-note scoreStats, so bars can be named
  scored: [
    rec(1, 'Bach prelude', 7, 22, { scoreStats: { absMeanCents: 21.75, meanAbsMs: 60, targetBpm: 72, perNote: perNote(WAS_C) } }),
    rec(2, 'Bach prelude', 1, 17, { scoreStats: { absMeanCents: 16.75, meanAbsMs: 38, targetBpm: 72, perNote: perNote(NOW_C) } }),
    rec(3, 'Scales', 2, 5),
  ],
  // three takes of one etude with a real habit: D3 sharp, A3 flat
  habit: [
    rec(1, 'Etude', 5, 0, { offsets: { D3: 14, A3: -12, F3: 2, G3: -1 } }),
    rec(2, 'Etude', 3, 0, { offsets: { D3: 14, A3: -12, F3: 2, G3: -1 } }),
    rec(3, 'Etude', 1, 0, { offsets: { D3: 14, A3: -12, F3: 2, G3: -1 } }),
  ],
  // eight takes over nineteen days: two full weeks to compare
  many: [
    rec(1, 'Bach prelude', 19, 30),
    rec(2, 'Bach prelude', 12, 20),
    rec(3, 'Bach prelude', 5, 12),
    rec(4, 'Bach prelude', 0.3, 8),
    rec(5, 'Scales', 16, 14),
    rec(6, 'Scales', 2, 6),
    rec(7, 'Elgar concerto', 9, 18),
    rec(8, 'Kol Nidrei', 1, 10),
  ],
  // takes the player never named: they can only be told apart by when
  unnamed: [
    rec(1, '', 5, 20),
    rec(2, '', 1, 11),
    rec(3, '', 0.2, 7),
  ],
};
