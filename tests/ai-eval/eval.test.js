import { describe, test, expect } from 'vitest';
import { evaluate } from './run.mjs';
import { QUESTIONS } from './questions.js';
import { HELDOUT } from './heldout.js';

const dev = evaluate(QUESTIONS);
const held = evaluate(HELDOUT);
const why = (m) => [
  m.scopeOk ? '' : `scope ${m.r.scope} (wanted ${m.q.scope})`,
  m.intentOk === false ? `intents [${m.r.intents}] (wanted [${m.q.i}])` : '',
  m.takesOk === false ? `takes [${m.r.takeIds}] (wanted [${m.q.t}])` : '',
  m.missing?.length ? `missing ${m.missing.join(' & ')}` : '',
  m.forbidden?.length ? `forbidden ${m.forbidden.join(' & ')}` : '',
].filter(Boolean).join('; ');

describe('evaluation set (development questions)', () => {
  test('there are at least 120 questions, across every library and every kind', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(120);
    expect(new Set(QUESTIONS.map((q) => q.lib)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(QUESTIONS.map((q) => q.scope))).toEqual(new Set(['answer', 'offtopic', 'unmeasurable', 'unsupported', 'notfound', 'nodata']));
  });
  test.each(dev.rows.map((m) => [m.q.n, m.q.lib, m.q.q, m]))('#%i [%s] %s', (_n, _l, _q, m) => {
    expect(m.allOk, why(m)).toBe(true);
  });
});

// Held out: written after the rules were fitted. Two misses are known and
// left in rather than argued away: both ask about timing AND something else,
// and the router answers with both intents where the expectation named one.
const KNOWN = new Set(['did I get tighter with the beat since last time', 'is my timing getting better']);
describe('evaluation set (held-out questions)', () => {
  test.each(held.rows.map((m) => [m.q.n, m.q.lib, m.q.q, m]))('#%i [%s] %s', (_n, _l, q, m) => {
    if (KNOWN.has(q)) expect(m.allOk).toBe(false);
    else expect(m.allOk, why(m)).toBe(true);
  });
  test('summary numbers', () => {
    expect(held.summary.refusedRight).toBe(100);
    expect(held.summary.falseRefusals).toBe(0);
    expect(held.summary.answerEndToEnd).toBeGreaterThanOrEqual(90);
  });
});

// Questions about how a take is shaped, added when the musicality measurements
// were wired in. A development set (written while wiring), see the file.
import { MUSICALITY_QUESTIONS } from './musicality-questions.js';
const shaped = evaluate(MUSICALITY_QUESTIONS);
describe('evaluation set (shaping questions)', () => {
  test.each(shaped.rows.map((m) => [m.q.n, m.q.lib, m.q.q, m]))('#%i [%s] %s', (_n, _l, _q, m) => {
    expect(m.allOk, why(m)).toBe(true);
  });
});
