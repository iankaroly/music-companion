import { describe, test, expect } from 'vitest';
import { runCase } from './ai-eval/run.mjs';
import { rec, LIBRARIES } from './ai-eval/fixtures.js';
import { musicalityOf } from '../src/analysis/musicality.js';
import { buildSpec, idealTake } from './helpers/musicality-synth.js';
import { factsFor } from '../src/ai/facts.js';
import { checkReply } from '../src/ai/guard.js';

// Two takes shaped IDENTICALLY (so the shaping comparison finds nothing) whose
// pitch and tone differ (so the rest of the comparison finds plenty).
const SAME = musicalityOf(idealTake(buildSpec({ shape: 'arch', articulation: 0.6, finalStretch: 1.5, phrases: 6, perPhrase: 10, period: 0.5 })));
const QUALITY = {
  steadinessCents: 6.2, vibrato: { share: 0.4, widthCents: 18, rateHz: 5.1 }, clarity: 0.81, brightness: 3.4,
  dynamics: { medianDb: -20, rangeDb: 9, stepDb: 2.4 }, landing: { cleanShare: 0.55, medianSettleMs: 140, medianOnsetCents: 12 },
};
const alike = [
  rec(1, 'Bach prelude', 6, 22, { musicality: SAME, quality: QUALITY }),
  rec(2, 'Bach prelude', 1, 9, { musicality: SAME, quality: { ...QUALITY, steadinessCents: 3.1 } }),
];

describe('a comparison does not contradict itself about shaping', () => {
  test('a plain comparison says nothing about shaping that did not differ', () => {
    // fails at 2b5b284: "... are shaped about the same on everything that could be
    // measured in both." landed straight after the pitch and steadiness differences
    const r = runCase({ q: 'compare my last two bach takes', library: alike });
    expect(r.intents).toEqual(['compare']);
    const text = r.facts.join('\n');
    expect(text).toMatch(/closer to pitch/);
    expect(text).not.toMatch(/about the same on everything/);
    expect(text).not.toMatch(/Could not be compared because it was not measured in both/);
  });

  test('a question about phrasing says the shaping is alike, of the shaping measurements, and points at the differences', () => {
    const r = runCase({ q: 'compare my phrasing with last time', library: alike });
    expect(r.intents).toEqual(['compare', 'musicality']);
    const same = r.facts.filter((f) => /shaped about the same/.test(f));
    expect(same).toHaveLength(1);
    expect(same[0]).not.toMatch(/on everything/);
    expect(same[0]).toMatch(/shaping measurements \(phrasing, articulation, tempo and repeated figures\); the differences above are not about shaping\.$/);
    // and the line sits after the differences it points at
    expect(r.facts.findIndex((f) => /closer to pitch/.test(f))).toBeLessThan(r.facts.indexOf(same[0]));
  });

  test('when nothing above differed the pointer is left off', () => {
    const twin = [rec(1, 'Bach prelude', 6, 9, { musicality: SAME, quality: QUALITY }), rec(2, 'Bach prelude', 1, 9, { musicality: SAME, quality: QUALITY })];
    const r = runCase({ q: 'compare my phrasing with last time', library: twin });
    const same = r.facts.find((f) => /shaped about the same/.test(f));
    expect(same).toMatch(/repeated figures\)\.$/);
  });

  test('takes whose shaping DID differ still list the differences in a plain comparison', () => {
    const r = runCase({ q: 'compare my last two bach takes', library: LIBRARIES.phrased });
    expect(r.facts.join('\n')).toMatch(/more detached|more phrases that swell and fade/);
  });

  test('the reworded line is still a sentence the guard lets a reply restate', () => {
    const r = runCase({ q: 'compare my phrasing with last time', library: alike });
    const reply = 'The two takes are shaped about the same on the shaping measurements, and you are 13 cents closer to pitch.';
    expect(checkReply(reply, r.facts, 'compare my phrasing with last time', { takeCount: 2 }).ok).toBe(true);
  });
});

describe('the same sentence is never printed twice', () => {
  test('a repeated line is dropped, in order', () => {
    const take = { id: 1, name: 'A', date: Date.UTC(2026, 9, 19), noteStats: [{ midi: 50, name: 'D3', cents: 3 }], _x: 0 };
    const { facts } = factsFor({ question: 'how was my last take', intents: ['summary', 'summary'], chosen: [take], all: [take], now: Date.UTC(2026, 9, 20) });
    expect(new Set(facts).size).toBe(facts.length);
    expect(facts.length).toBeGreaterThan(0);
  });
});
