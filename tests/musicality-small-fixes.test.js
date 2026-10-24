import { describe, test, expect } from 'vitest';
import { musicalityOf } from '../src/analysis/musicality.js';
import { musicalityFacts } from '../src/ai/musicality-facts.js';
import { idealTake, wobbleOnsets, buildSpec } from './helpers/musicality-synth.js';

const take = (opts) => idealTake(buildSpec(opts));
const named = (m, name = 'T') => ({ name, date: 1, musicality: m });

describe('notes too close together are not read for articulation or tempo wobble', () => {
  test.each([0.1, 0.15, 0.25])('a metronome at %s s a note says nothing about legato or tempo flexibility', (period) => {
    const m = musicalityOf(wobbleOnsets(take({ phrases: 6, perPhrase: 10, period, breath: 0.7 * period, shape: 'flat', seed: 1 }), 14, 3));
    for (const k of ['articulation', 'articulation-evenness', 'tempo-flexibility', 'tempo-shape', 'phrase-shape']) {
      expect(m.descriptors[k].measured).toBe(false);
    }
  });
  test('the same playing at a readable speed still is', () => {
    const m = musicalityOf(wobbleOnsets(take({ phrases: 6, perPhrase: 10, period: 0.5, breath: 0.35, shape: 'flat', seed: 1 }), 14, 3));
    expect(m.descriptors.articulation.measured).toBe(true);
  });
});

describe('"steady" says what it does not count', () => {
  test('a steady take is steady stretch to stretch, not over the whole take', () => {
    const m = musicalityOf(wobbleOnsets(take({ phrases: 8, perPhrase: 12, period: 0.5, breath: 0.35, shape: 'flat', seed: 2 }), 14, 3));
    const d = m.descriptors['tempo-flexibility'];
    if (d.measured && /steady/.test(d.phrase)) expect(d.phrase).toMatch(/slow movement over the whole take is not counted/);
  });
});

describe('the descriptor cap is said out loud', () => {
  test('when more readings were measured than are printed, the facts say how many were left out', () => {
    const m = musicalityOf(wobbleOnsets(take({ phrases: 8, perPhrase: 12, period: 0.5, breath: 0.35, shape: 'arch', seed: 2 }), 14, 3));
    const all = Object.values(m.descriptors).filter((d) => d.measured && d.key !== 'character').length;
    const lines = musicalityFacts(named(m), { max: 2 });
    if (all > 2) expect(lines.join(' ')).toMatch(new RegExp(`${all - 2} more measured reading`));
  });
});
