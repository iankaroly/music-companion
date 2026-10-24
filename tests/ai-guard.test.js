import { describe, test, expect } from 'vitest';
import { checkReply, numbersIn, clean } from '../src/ai/guard.js';
import { checkReply as legacy } from './ai-eval/legacy-guard.js';
import { HONEST, ADVERSARIAL, KNOWN_GAPS, scenario } from './ai-eval/guard-cases.js';
import { HONEST_2, ADVERSARIAL_2, DERIVED_HONEST } from './ai-eval/guard-heldout.js';

const judge = (fn, s, reply) => {
  const sc = scenario(s);
  return fn(reply, sc.facts, sc.question, { takeCount: sc.takeCount });
};
const kinds = (s, reply) => judge(checkReply, s, reply).problems.map((p) => p.kind);

describe('the guard still does what the first version did', () => {
  const facts = ['Average pitch error: "Bach prelude" 9¢, "Bach prelude" 22¢, so it is 13¢ closer to pitch.'];
  test('measured numbers pass, with rounding', () => {
    expect(checkReply('You are 13 cents closer: 9 now against 22 before.', facts).ok).toBe(true);
  });
  test('an invented number is caught and reported as stray', () => {
    const r = checkReply('You improved by 40 cents.', facts);
    expect(r.ok).toBe(false);
    expect(r.stray).toEqual([40]);
  });
  test('numbers the player typed are allowed back', () => {
    // The facts above hold two takes. "last 3 takes" is the player's own number
    // for how many he asked about; it is allowed back only when that many takes
    // were in the facts (tests/ai-guard-counts.test.js has the other side).
    expect(checkReply('Over the last 3 takes, 9 now.', facts, 'my last 3 takes', { takeCount: 3 }).ok).toBe(true);
    expect(checkReply('Over the last 3 takes, 9 now.', facts, 'my last 3 takes', { takeCount: 2 }).ok).toBe(false);
  });
  test('empty and runaway replies fail', () => {
    expect(checkReply('', facts).ok).toBe(false);
    expect(checkReply('x'.repeat(2000), facts).ok).toBe(false);
  });
  test('numbersIn reads decimals, comma decimals and thousands, and skips note names', () => {
    expect(numbersIn('about 12.5¢ over 3 times, twice')).toEqual([12.5, 3]);
    expect(numbersIn('12,5¢ and 1,300 cents')).toEqual([12.5, 1300]);
    expect(numbersIn('D3 and F#4 and Bb2')).toEqual([]);
  });
  test('clean folds other scripts, fullwidth and hidden characters into plain digits', () => {
    expect(clean('٤١ ４１ ⁴¹ 4​1')).toBe('41 41 41 41');
  });
});

describe('red team: every adversarial reply is rejected', () => {
  test.each([...ADVERSARIAL, ...ADVERSARIAL_2].map(([kind, s, r]) => [kind, s, r]))('%s [%s] %s', (kind, s, reply) => {
    const v = judge(checkReply, s, reply);
    expect(v.ok, `the guard let through: ${reply}`).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  test('the specific reason is named for the escapes that matter most', () => {
    expect(kinds('CMP', 'You are about twelve cents closer.')).toContain('number');
    expect(kinds('CMP', 'That is 22 ms closer to pitch than before.')).toContain('unit');
    expect(kinds('CMP', 'About 1/2 as far from pitch as before.')).toContain('joined');
    expect(kinds('CMP', 'You were -13 cents before.')).toContain('sign');
    expect(kinds('CMP', 'Your error is half what it was.')).toContain('multiplier');
    expect(kinds('BARS', 'Bar 5 was the worst, at 32¢.')).toContain('bar');
    expect(kinds('HAB', 'C#4 runs 14¢ sharp.')).toContain('note');
    expect(kinds('CMP', 'Your "Take 7" scored 9 cents off.')).toContain('name');
    expect(kinds('WORSE', 'You improved by 13 cents.')).toContain('direction');
    expect(kinds('NOTONE', 'Your vibrato is wide and lively.')).toContain('unmeasured');
  });

  test('the original check let most of them through', () => {
    const all = [...ADVERSARIAL, ...ADVERSARIAL_2];
    const passed = all.filter(([, s, r]) => judge(legacy, s, r).ok);
    // recorded on the first run: 24 of 102 and 7 of 48 were caught by the
    // original, i.e. 119 of 150 got through it
    expect(passed.length).toBeGreaterThan(all.length * 0.7);
  });
});

describe('honest replies are not thrown away', () => {
  test.each([...HONEST, ...HONEST_2])('[%s] %s', (s, reply) => {
    const v = judge(checkReply, s, reply);
    expect(v.ok, v.problems.map((p) => `${p.kind}: ${p.text}`).join('; ')).toBe(true);
  });

  test('false-reject rate is at most 5% and the catch rate at least 95%', () => {
    const honest = [...HONEST, ...HONEST_2];
    const adv = [...ADVERSARIAL, ...ADVERSARIAL_2];
    const falseRejects = honest.filter(([s, r]) => !judge(checkReply, s, r).ok).length / honest.length;
    const caught = adv.filter(([, s, r]) => !judge(checkReply, s, r).ok).length / adv.length;
    expect(falseRejects).toBeLessThanOrEqual(0.05);
    expect(caught).toBeGreaterThanOrEqual(0.95);
  });

  test('honest replies that DERIVE a number are rejected on purpose', () => {
    // "never calculate, estimate or round": a correct 75% worked out from 9 of 12
    // is still a number the app did not measure.
    for (const [s, r] of DERIVED_HONEST) expect(judge(checkReply, s, r).ok).toBe(false);
  });
});

describe('the limits are written down', () => {
  // These are false statements the guard cannot see, because they use only
  // words and numbers the facts contain. If one of them starts being caught,
  // good: move it to ADVERSARIAL.
  test.each(KNOWN_GAPS.map(([s, r, why]) => [s, r, why]))('[%s] %s (%s)', (s, reply) => {
    expect(judge(checkReply, s, reply).ok).toBe(true);
  });
});

describe('particular rules', () => {
  const facts = [
    '"Take 2" (Oct 19): 24 notes heard, 9¢ off pitch on average, 50% of notes within 10¢.',
    'The note furthest from pitch was D3, 14¢ sharp on average over 6 times.',
  ];
  test('a number in a take name is allowed only with the name', () => {
    expect(checkReply('"Take 2" was 9 cents off.', facts).ok).toBe(true);
    expect(checkReply('Your "Take 3" was 9 cents off.', facts).ok).toBe(false);
    expect(checkReply('It was 2 cents off.', facts).ok).toBe(false);
  });
  test('the digit in a note name does not license a number', () => {
    expect(checkReply('D3 was 3 cents off.', facts).ok).toBe(false);
    expect(checkReply('D3 was 14 cents sharp.', facts).ok).toBe(true);
  });
  test('a number word is allowed exactly when its digit is', () => {
    expect(checkReply('Fourteen cents sharp on D3.', facts).ok).toBe(true);
    expect(checkReply('Fifteen cents sharp on D3.', facts).ok).toBe(false);
    expect(checkReply('Take one of the notes: D3.', facts).ok).toBe(true);
  });
  test('"half" is allowed for a 50% in the facts and not otherwise', () => {
    expect(checkReply('Half the notes were within 10 cents.', facts).ok).toBe(true);
    expect(checkReply('A quarter of the notes were within 10 cents.', facts).ok).toBe(false);
  });
  test('the number of takes used is allowed, any other is not', () => {
    expect(checkReply('The two takes differ.', ['A. B.'], '', { takeCount: 2 }).ok).toBe(true);
    expect(checkReply('The three takes differ.', ['A. B.'], '', { takeCount: 2 }).ok).toBe(false);
  });
  test('negation turns a direction round', () => {
    const f = ['"A" 9¢, "B" 22¢, so "A" is 13¢ closer to pitch.'];
    expect(checkReply('It is not worse.', f).ok).toBe(true);
    expect(checkReply('It is not closer.', f).ok).toBe(false);
  });
  test('hedging in one clause does not cover a claim in the next', () => {
    const f = ['Tone and vibrato could not be measured for "A".'];
    expect(checkReply('Vibrato could not be measured for it.', f).ok).toBe(true);
    expect(checkReply('Vibrato could not be measured; the vibrato is wide.', f).ok).toBe(false);
  });
});
