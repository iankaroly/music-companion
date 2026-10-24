// Single-take libraries for the pairing tests. Every figure is chosen so that a
// take's average, a note's figure and a count are DIFFERENT numbers unless a
// scenario is deliberately a collision, so that a lie which swaps them is a lie
// and not an accident of equal digits.
import { rec, NOW } from './ai-eval/fixtures.js';
import { factsFor } from '../src/ai/facts.js';

const perNote = (cents) => cents.map((c, i) => ({ scoreNoteId: i + 1, measure: Math.floor(i / 3) + 1, cents: c }));

export const SCENARIOS = {
  // 1 a take whose average, furthest note (D3, sharp) and within-10 share are all different
  etude: [rec(1, 'Etude', 1, 4, { offsets: { D3: 19, A3: -5, F3: 2, G3: -1 } })],
  // 2 the collision: average and furthest note are both 9
  collision: [rec(1, 'Bach prelude', 1, 9)],
  // 3 a flat take
  flat: [rec(1, 'Sarabande', 1, -13, { offsets: { D3: -6, A3: 3, F3: 0, G3: 2 } })],
  // 4 per-bar scores
  scored: [rec(1, 'Bach prelude', 1, 17, { scoreStats: { absMeanCents: 18, meanAbsMs: 38, targetBpm: 72, perNote: perNote([4, 9, 11, 10, 12, 20, 30, 34, 29, 18, 22, 17]) } })],
  // 5 pitches, no score
  nobars: [rec(1, 'Scales', 1, 6, { offsets: { D3: 13, A3: -11, F3: 4, G3: 0 } })],
  // 6 one repeated pitch only
  one_pitch: [{ ...rec(1, 'Drone', 1, 0), noteStats: Array.from({ length: 8 }, (_, i) => ({ midi: 50, name: 'D3', cents: 15 + (i % 2 ? 1 : -1) })) }],
  // 7 tone
  toned: [rec(1, 'Aria', 1, 6, { quality: {
    steadinessCents: 3.1, vibrato: { share: 0.7, widthCents: 27, rateHz: 5.4 }, clarity: 0.88, brightness: 3.5,
    dynamics: { medianDb: -18, rangeDb: 12, stepDb: 1.8 }, landing: { cleanShare: 0.78, medianSettleMs: 90, medianOnsetCents: 7 } } })],
  // 8 tempo
  paced: [rec(1, 'Gigue', 1, 6, { rhythm: { bpm: 72, evenness: 0.86, meanAbsMs: 41, verdict: 'rushing' } })],
  // 9 a clean take with a small furthest-note figure
  clean: [rec(1, 'Long tones', 1, 2, { offsets: { D3: 5, A3: 0, F3: -1, G3: 1 } })],
  // 10 three repeated pitches in one take
  habit1: [rec(1, 'Etude', 1, 0, { offsets: { D3: 14, A3: -12, F3: 7, G3: -1 } })],
};

export function factsOf(key, intents, question = 'how was my last take') {
  const lib = SCENARIOS[key].map((t) => ({ ...t }));
  const chosen = lib.map((t) => ({ ...t, quality: t._quality, rhythm: t._rhythm, musicality: t._musicality }));
  return factsFor({ question, intents, chosen, all: lib, now: NOW });
}
