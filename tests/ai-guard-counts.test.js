import { describe, test, expect } from 'vitest';
import { checkReply } from '../src/ai/guard.js';

// Counts of days and takes. A day count in a reply used to be held only to "is
// that number in the facts, with the unit days", and the facts say "3 of the
// last 7 days", so "not practised in 7 days" passed: the 7 is the length of the
// window, not a gap. The same shape for takes: the player's own "last 3 takes"
// was licensed back by the question, so "over the last 3 takes" passed on
// facts built from one. Each reply below is paired with an honest twin that
// uses the same numbers for what they are.

const PRACTICE = ['Practised on 3 of the last 7 days; current streak 2 days.'];
const ok = (r, f = PRACTICE, q = '', o = {}) => checkReply(r, f, q, { takeCount: 1, ...o });

describe('a number of days means what the facts mean by it', () => {
  test.each([
    'You have not practised in 7 days.',
    'It has been 7 days since you practised.',
    'You did not play for 7 days.',
    'You practised 7 days ago.',
    'Your streak is 3 days.',
    'You practised on 7 days.',
    'You are on a 3 day streak.',
  ])('rejects %j', (reply) => {
    expect(ok(reply).ok, reply).toBe(false);
  });

  test.each([
    'You practised on 3 of the last 7 days.',
    'In the last 7 days you practised on 3 days.',
    'Your current streak is 2 days.',
    'You are on a 2 day streak.',
    'You have practised 2 days in a row.',
    'You practised on 3 days out of the past 7 days.',
  ])('accepts the honest twin %j', (reply) => {
    const v = ok(reply);
    expect(v.ok, `${reply} -> ${v.problems.map((p) => `${p.kind}:${p.text}`)}`).toBe(true);
  });
});

describe('a count of takes is no larger than the takes the facts were built from', () => {
  const ONE = ['"Bach prelude" (Oct 19): 24 notes heard, 9¢ off pitch on average, 80% of notes within 10¢.'];
  const asked = 'how were my last 3 takes of the Bach prelude';

  test('the player\'s own "last 3 takes" does not license it back when the facts hold one', () => {
    expect(checkReply('Over the last 3 takes of Bach prelude you were 9¢ off.', ONE, asked, { takeCount: 1 }).ok).toBe(false);
    expect(checkReply('Over your last three takes you were 9¢ off.', ONE, asked, { takeCount: 1 }).ok).toBe(false);
    expect(checkReply('Across 3 recordings you were 9¢ off.', ONE, asked, { takeCount: 1 }).ok).toBe(false);
  });

  test('honest twins: the count the facts were built from, or none', () => {
    expect(checkReply('Your last take was 9¢ off.', ONE, asked, { takeCount: 1 }).ok).toBe(true);
    expect(checkReply('In your 1 take you were 9¢ off.', ONE, asked, { takeCount: 1 }).ok).toBe(true);
    const THREE = ['Across 3 takes: D3 runs 8¢ sharp (spread ±2¢, 12 times).'];
    expect(checkReply('Across 3 takes, D3 runs 8¢ sharp.', THREE, asked, { takeCount: 3 }).ok).toBe(true);
  });

  test('a question that names a number of takes still has its numbers licensed when they are not takes', () => {
    // "20 cents" typed by the player is still the player's number
    expect(checkReply('It was 9¢ off pitch on average, against the 20 cents you asked about.', ONE, 'was I 20 cents off', { takeCount: 1 }).ok).toBe(true);
  });
});
