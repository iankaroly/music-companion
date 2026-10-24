import { describe, test, expect } from 'vitest';
import { checkReply } from '../src/ai/guard.js';
import { measure } from './ai-eval/direction-redteam.mjs';

// Direction words the lexicon did not hold, and what the guard does with a word
// it has never heard of. Two parts, and the second matters more:
//
//  1. verbs and synonyms a skeptic found (went up/down, widened, narrowed, grew,
//     shrank, dropped, rose, decelerates, lags, behind, ahead, smaller, larger,
//     less quick, sluggish, more quickly, "off target ... more than"), each on the
//     axis it speaks of, which a word like "dropped" or "smaller" gets from what
//     the sentence is about (the error, the vibrato, the settling time).
//  2. a CONSERVATIVE DEFAULT. A lexicon will never hold the next word. Beside a
//     number whose twin in the facts carries a direction, a word that looks like
//     a direction (a comparative, "more X", a verb of change) and that neither the
//     guard nor the facts know is refused. Its cost is an honest paraphrase in a
//     word the guard has not heard of, which falls back to the facts.

const CLOSER = ['Average pitch error: "Bach prelude, Oct 22" 5.6¢, "Bach prelude, Oct 17" 18.4¢, so "Bach prelude, Oct 22" is 12.8¢ closer to pitch.'];
const WIDER = ['vibrato width: 18 ¢ before, 27 ¢ now — wider vibrato.'];
const SETTLE_FASTER = ['time to settle: 140 ms before, 90 ms now — faster to settle.'];
const SETTLE_SLOWER = ['time to settle: 90 ms before, 140 ms now — slower to settle.'];
const ok = (r, f) => checkReply(r, f, '', { takeCount: 2 }).ok;

describe('words the lexicon was missing', () => {
  test.each([
    ['The pitch error went up by 12.8¢.', CLOSER],
    ['The error grew by 12.8¢ since Oct 17.', CLOSER],
    ['The error rose 12.8¢.', CLOSER],
    ['Oct 22 is 12.8¢ behind Oct 17.', CLOSER],
    ['Oct 22 lags Oct 17 by 12.8¢.', CLOSER],
    ['The Oct 22 take is off target by 12.8¢ more than the Oct 17 take.', CLOSER],
    ['The vibrato narrowed to 27¢.', WIDER],
    ['The vibrato shrank to 27¢.', WIDER],
    ['The vibrato width went down to 27¢.', WIDER],
    ['27¢ smaller than before.', WIDER],
    ['It is smaller by 27¢.', WIDER],
    ['Notes settle 90 ms more slowly than before.', SETTLE_FASTER],
    ['Settling got sluggish: 90 ms.', SETTLE_FASTER],
    ['Settling decelerates to 90 ms.', SETTLE_FASTER],
    ['Settling got less quick: 90 ms.', SETTLE_FASTER],
    ['Notes settle 140 ms more quickly than before.', SETTLE_SLOWER],
    ['The time to settle dropped to 140 ms.', SETTLE_SLOWER],
  ])('rejects %s', (reply, facts) => {
    expect(ok(reply, facts), reply).toBe(false);
  });

  test.each([
    ['The pitch error went down by 12.8¢.', CLOSER],
    ['The error dropped 12.8¢ since Oct 17.', CLOSER],
    ['The error shrank by 12.8¢ since Oct 17.', CLOSER],
    ['Oct 22 is 12.8¢ ahead of Oct 17.', CLOSER],
    ['The Oct 22 take is off target by 12.8¢ less than the Oct 17 take.', CLOSER],
    ['The vibrato widened by 27¢.', WIDER],
    ['The vibrato grew to 27¢.', WIDER],
    ['The vibrato width went up to 27¢.', WIDER],
    ['27¢ larger than before.', WIDER],
    ['27¢ bigger than before.', WIDER],
    ['Notes settle 90 ms faster than before.', SETTLE_FASTER],
    ['The time to settle dropped to 90 ms.', SETTLE_FASTER],
    ['Notes settle 140 ms more slowly than before.', SETTLE_SLOWER],
    ['Settling got sluggish: 140 ms.', SETTLE_SLOWER],
    ['Settling got less quick: 140 ms.', SETTLE_SLOWER],
  ])('accepts the honest twin %s', (reply, facts) => {
    const v = checkReply(reply, facts, '', { takeCount: 2 });
    expect(v.ok, `${reply} -> ${v.problems.map((p) => `${p.kind}:${p.text}`)}`).toBe(true);
  });
});

describe('the conservative default for a word nobody listed', () => {
  test.each([
    'The Oct 22 take sagged by 12.8¢.',
    'The Oct 22 take dipped 12.8¢ from the Oct 17 take.',
    'It slumped, 12.8¢ from before.',
    'The take tailed off: 12.8¢ against before.',
    'The Oct 22 take is 12.8¢ messier.',
    'The Oct 22 take is 12.8¢ more erratic.',
  ])('refuses %s', (reply) => {
    const v = checkReply(reply, CLOSER, '', { takeCount: 2 });
    expect(v.ok, reply).toBe(false);
    expect(v.problems.map((p) => p.kind)).toContain('direction');
  });

  test('a word the FACTS use is not unknown, wherever it sits', () => {
    const facts = ['Average pitch error: "Bach" 5.6¢, "Bach" 18.4¢, so it is 12.8¢ tighter than before.'];
    expect(ok('It is 12.8¢ tighter than before.', facts)).toBe(true);
  });

  test('nouns that end the way comparatives do, and plain verbs, are not taken for directions', () => {
    const facts = ['Pitch steadiness: 3.1¢ of wander in the middle note; the average pitch error is 9¢, 12.8¢ closer to pitch than before.'];
    expect(ok('The wander is 3.1¢ and the error is 9¢, 12.8¢ closer than before.', facts)).toBe(true);
    expect(ok('Compared with before, the average error measured 9¢, which is 12.8¢ closer.', facts)).toBe(true);
  });

  test('a number whose twin carries no direction is left alone', () => {
    const facts = ['"Bach prelude" (Oct 19): 24 notes heard, 9¢ off pitch on average, 80% of notes within 10¢.'];
    expect(checkReply('The take was 9¢ off on average and sagged little.', facts, '', { takeCount: 1 }).problems.map((p) => p.kind)).not.toContain('direction');
  });
});

describe('the red team, tier by tier', () => {
  const m = measure(checkReply);
  const tier = async (t) => {
    const r = await m;
    return {
      adv: r.adversarial.filter((c) => c.tier === t), esc: r.escapes.filter((c) => c.tier === t),
      hon: r.honest.filter((c) => c.tier === t), rej: r.falseRejects.filter((c) => c.tier === t),
    };
  };
  test('the synonym tier went from 52 of 96 escaping to under 10, with no honest twin rejected', async () => {
    const t = await tier('synonym');
    expect(t.adv).toHaveLength(96);
    expect(t.esc.length, t.esc.slice(0, 3).map((c) => c.reply).join(' / ')).toBeLessThan(10);
    expect(t.rej).toHaveLength(0);
  });
  test('every hand-written phrasing is caught and no honest one is rejected', async () => {
    const t = await tier('freeform');
    expect(t.esc.map((c) => c.reply)).toEqual([]);
    expect(t.rej).toHaveLength(0);
  });
  test('the tier written before the fix, in words no list holds: under 10% escape, and the price is stated', async () => {
    const t = await tier('unseen');
    expect(t.adv.length).toBeGreaterThan(300);
    // 24 of 345 escape, all of them words with no shape a direction has
    // ("came right", "homed in"); measured at the time this was written
    expect(t.esc.length).toBeLessThan(t.adv.length * 0.1);
    // ... and 312 of 336 HONEST twins in words the guard has never heard of are
    // refused with them. That is the conservative default doing what it says:
    // it cannot tell an unknown right word from an unknown wrong one.
    expect(t.rej.length).toBeGreaterThan(t.hon.length * 0.5);
  });
  test('the listed words keep their record: nothing escapes, nothing honest is rejected', async () => {
    const t = await tier('listed');
    expect(t.esc).toHaveLength(0);
    expect(t.rej).toHaveLength(0);
  });
});
