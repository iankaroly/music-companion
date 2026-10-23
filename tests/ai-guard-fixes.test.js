import { describe, test, expect } from 'vitest';
import { checkReply } from '../src/ai/guard.js';
import { scenario } from './ai-eval/guard-cases.js';
import { measure, SCENARIOS, FREEFORM_WRONG } from './ai-eval/direction-redteam.mjs';
import { runCase } from './ai-eval/run.mjs';
import { LIBRARIES } from './ai-eval/fixtures.js';

// What an independent verifier found in the guard at 2b5b284, one describe per
// finding. Every test here was run against that guard first and the ones that
// say they fail there did (the numbers are in the commit message).

const verdict = (s, reply, question) => {
  const sc = scenario(s);
  return checkReply(reply, sc.facts, question ?? sc.question, { takeCount: sc.takeCount });
};
const kinds = (v) => v.problems.map((p) => p.kind);

describe('direction: a word that says the opposite of the number it is next to', () => {
  const closer = ['Average pitch error: "Bach prelude, Oct 22" 5.6¢, "Bach prelude, Oct 17" 18.4¢, so "Bach prelude, Oct 22" is 12.8¢ closer to pitch.'];

  test('the verifier\'s sentence: "12.8¢ further" when the truth is 12.8¢ closer', () => {
    // fails at 2b5b284: "further" needed a word character before it, and "¢" is not one
    const v = checkReply('The Oct 22 take is 12.8¢ further from pitch.', closer);
    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain('direction');
  });

  test('and the true sentence still passes, with or without the unit', () => {
    for (const r of ['The Oct 22 take is 12.8¢ closer to pitch.', 'The Oct 22 take is 12.8 cents closer.', 'It is closer by 12.8.', '12.8 closer, comparing the two takes.']) {
      expect(checkReply(r, closer, '', { takeCount: 2 }).ok, r).toBe(true);
    }
  });

  test('a true "further" is read as a direction in the FACTS too (it used to be invisible there)', () => {
    const further = ['Average pitch error: "Bach prelude, Oct 22" 18.4¢, "Bach prelude, Oct 17" 5.6¢, so "Bach prelude, Oct 22" is 12.8¢ further from pitch.'];
    expect(checkReply('The Oct 22 take is 12.8¢ further from pitch.', further).ok).toBe(true);
    expect(checkReply('The Oct 22 take is 12.8¢ closer to pitch.', further).ok).toBe(false);
  });

  test('"further on average" and "further on D3" are directions (found by review: an exclusion for "further on in the piece" hid them)', () => {
    expect(checkReply('The Oct 22 take is 12.8¢ further on average.', closer, '', { takeCount: 2 }).ok).toBe(false);
    expect(checkReply('On average the Oct 22 take is 12.8¢ further.', closer, '', { takeCount: 2 }).ok).toBe(false);
    const lean = ['The note furthest from pitch was D3, 14¢ sharp on average over 6 times.'];
    expect(checkReply('D3 is 14¢ flatter on D3.', lean).ok).toBe(false);
    expect(checkReply('D3 is 14¢ sharper on average.', lean).ok).toBe(true);
    expect(checkReply('Further on in the piece, the Oct 22 take is 12.8¢ closer.', closer).ok).toBe(true);
  });

  test('"further" as a connective is not a direction', () => {
    expect(checkReply('Further, the Oct 22 take is 12.8¢ closer.', closer).ok).toBe(true);
    expect(checkReply('For further detail, see the 12.8¢ difference: closer.', closer).ok).toBe(true);
  });

  test('a negation survives a decimal point between it and the word', () => {
    // fails at 2b5b284 in the other direction: "not 12.8¢ closer" read the "." as a full stop
    expect(checkReply('The Oct 22 take is not 12.8¢ closer.', closer).ok).toBe(false);
    const further = ['Average pitch error: "A" 18.4¢, "B" 5.6¢, so "A" is 12.8¢ further from pitch.'];
    expect(checkReply('"A" is not 12.8¢ further.', further).ok).toBe(false);
  });

  test('when the facts hold BOTH directions the words still go with their numbers', () => {
    // fails at 2b5b284: the axis check gives up when the facts lean both ways
    const both = scenario('CMPS').facts;
    expect(checkReply('9 notes landed closer and 1 note landed further.', both, '', { takeCount: 2 }).ok).toBe(true);
    for (const r of ['1 note landed closer.', '9 notes landed further.', '9 notes were worse.', '1 note was better than before.']) {
      expect(checkReply(r, both, '', { takeCount: 2 }).ok, r).toBe(false);
    }
  });

  describe('red team: every direction word beside a number, four formats, four sentence shapes', () => {
    const m = measure(checkReply);
    test('the sixteen words asked for (closer further sharper flatter wider narrower louder quieter faster slower more less fewer better worse improved declined)', async () => {
      const r = await m;
      const listed = (list) => list.filter((c) => c.tier === 'listed');
      expect(listed(r.adversarial).length).toBeGreaterThan(600);
      expect(listed(r.escapes), listed(r.escapes).slice(0, 5).map((c) => c.reply).join(' / ')).toHaveLength(0);
      expect(listed(r.falseRejects), listed(r.falseRejects).slice(0, 5).map((c) => c.reply).join(' / ')).toHaveLength(0);
    });
    test('every scenario has contradictions and honest twins, so a guard that rejects everything cannot pass', async () => {
      const r = await m;
      expect(r.honest.length).toBeGreaterThan(500);
      for (const sc of SCENARIOS) {
        expect(r.adversarial.some((c) => c.scenario === sc.name), sc.name).toBe(true);
        expect(r.honest.some((c) => c.scenario === sc.name), sc.name).toBe(true);
      }
    });
    test('synonyms outside that list are NOT all caught, and the honest ones are not rejected', async () => {
      // "smaller", "less quick", "sluggish", "more quickly", "less tight": no
      // lexicon for them on purpose (see the comment on AXES); pinned so a
      // change in either direction is noticed
      const r = await m;
      const adv = r.adversarial.filter((c) => c.tier === 'synonym');
      const esc = r.escapes.filter((c) => c.tier === 'synonym');
      expect(esc.length).toBeGreaterThan(0);
      expect(esc.length).toBeLessThan(adv.length);
      expect(r.falseRejects.filter((c) => c.tier === 'synonym')).toHaveLength(0);
    });
    test('hand-written phrasings: all but the two that need a word with two meanings are caught', async () => {
      const r = await m;
      const esc = r.escapes.filter((c) => c.tier === 'freeform').map((c) => c.reply);
      expect(FREEFORM_WRONG.length - esc.length).toBeGreaterThanOrEqual(14);
      expect(esc.sort()).toEqual([
        'Oct 22 is 12.8¢ behind Oct 17.', // "behind" is also behind the beat
        'The Oct 22 take is off pitch by 12.8¢ more than the Oct 17 take.', // the "more" is after the noun it modifies
      ]);
      expect(r.falseRejects.filter((c) => c.tier === 'freeform')).toHaveLength(0);
    });
  });
});

describe('taste and praise on every question, not only the shaping ones', () => {
  const VERDICT = 'Your playing was beautiful and very musical, with lovely feeling.';
  const ALL = ['CMP', 'CMPQ', 'CMPS', 'HAB', 'SUM', 'TONE', 'RUSH', 'TREND', 'BARS', 'NOTONE', 'ONE', 'NOPULSE', 'WORSTN', 'ETUDE'];

  test.each(ALL)('[%s] a taste verdict with no digit is set aside', (s) => {
    // fails at 2b5b284 on every scenario whose facts do not carry the shaping caveat
    const v = verdict(s, VERDICT);
    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain('taste');
  });

  test.each([
    'Great job, that was excellent playing.',
    'Wonderful work this week, keep it up.',
    'Your intonation was good.',
    'Your practice went well this week.',
    'That take sounds fantastic.',
    'Nicely done: a really impressive result.',
    'Good phrasing and great intonation.',
    'It was a perfect take.',
  ])('praise is a verdict the app never made: %s', (reply) => {
    for (const s of ['SUM', 'TREND', 'CMP', 'HAB']) expect(kinds(verdict(s, reply)), s).toContain('taste');
  });

  test('restating what a fact says is not taste', () => {
    expect(verdict('CMPQ', 'Pitch is 13 cents closer, and the notes are steadier: 6.2 ¢ before, 3.1 ¢ now.').ok).toBe(true);
    expect(verdict('CMP', 'You are 13 cents closer to pitch.').ok).toBe(true);
    expect(verdict('CMPQ', 'Notes settle faster, 140 ms before and 90 ms now, and more notes arrive in tune.').ok).toBe(true);
  });

  test('a word is allowed when the FACTS use it, and the question never licenses it', () => {
    const f = ['"Bach" (Oct 19) reads as mechanical: steady in tempo; every shaping measure that could be read here is flat.'];
    expect(checkReply('It reads as mechanical.', f, 'is it mechanical').ok).toBe(true);
    expect(checkReply('It is lovely.', f, 'is it lovely').ok).toBe(false);
  });

  test('a take whose NAME holds a praise word may still be called by it', () => {
    const f = ['"Wonderful Tonight" (Oct 19): 24 notes heard, 9¢ off pitch on average.'];
    expect(checkReply('"Wonderful Tonight" averaged 9¢ off pitch.', f).ok).toBe(true);
  });
});

describe('number words, and a number used for something it is not', () => {
  const facts = [
    'Average pitch error: "A" 9¢, "B" 22¢, so "A" is 13¢ closer to pitch.',
    'Vibrato is on 70% of notes held 0.4 s or longer, at about 5.4 Hz and 12¢ wide.',
    'pitch steadiness: 6.2 ¢ before, 3.1 ¢ now — steadier within notes.',
  ];

  test('number words are mapped to digits and checked', () => {
    expect(checkReply('Thirteen cents closer.', facts).ok).toBe(true);
    expect(checkReply('Fourteen cents closer.', facts).ok).toBe(false);
    expect(checkReply('Twenty-two cents before.', facts).ok).toBe(true);
    expect(checkReply('Twenty-one cents before.', facts).ok).toBe(false);
    expect(checkReply('Six point two cents before and three point one now.', facts).ok).toBe(true);
    expect(checkReply('Six point three cents before.', facts).ok).toBe(false);
    expect(checkReply('Five point four hertz.', facts).ok).toBe(true);
    expect(checkReply('A dozen cents closer.', facts).ok).toBe(false);
  });

  test('"twelve cents closer" uses the 12 that belongs to the vibrato', () => {
    // fails at 2b5b284: 12 is in the facts, with the right unit, so every number rule was satisfied
    for (const r of ['You are twelve cents closer.', 'You are 12 cents closer.', 'Pitch is 12¢ closer than before.']) {
      const v = checkReply(r, facts);
      expect(v.ok, r).toBe(false);
      expect(kinds(v), r).toContain('attached');
    }
    expect(checkReply('The vibrato is twelve cents wide.', facts).ok).toBe(true);
    expect(checkReply('You are 13 cents closer and the vibrato is 12¢ wide.', facts).ok).toBe(true);
  });

  test('9¢ from the pitch error used as the vibrato\'s width', () => {
    const f = ['"A" (Oct 19): 24 notes heard, 9¢ off pitch on average.', 'Vibrato is on 70% of notes held 0.4 s or longer, at about 5.4 Hz and 27¢ wide.'];
    expect(checkReply('Your vibrato is 9¢ wide.', f).ok).toBe(false);
    expect(checkReply('Your vibrato is 27¢ wide and you are 9¢ off pitch.', f).ok).toBe(true);
  });

  test('what stays uncatchable is pinned: the right topic, the wrong take or the wrong figure', () => {
    // both numbers are about pitch and both are in the facts; swapped, nothing here can tell
    expect(checkReply('"A" was 22¢ off pitch and "B" was 9¢.', ['Average pitch error: "A" 9¢, "B" 22¢, so "A" is 13¢ closer to pitch.']).ok).toBe(true);
    // and a number in a clause with no topic word in it is not asked about
    expect(checkReply('There were 3 of them.', ['Average pitch error: "A" 9¢, "B" 22¢, so "A" is 13¢ closer to pitch. Practised on 3 of the last 7 days.']).ok).toBe(true);
  });
});

describe('words from the question that the measurements never held', () => {
  const sum = scenario('SUM');

  test.each([
    ['is my Violin in tune', 'Your Violin is 9 cents off pitch on average.'],
    ['how is my Cello intonation', 'The Cello was 9¢ sharp on average over 6 times.'],
    ['how is my Soprano range', 'The Soprano range is 9¢ off pitch.'],
    ['how was my D Major scale', 'The D Major scale was 9¢ off pitch on average.'],
    ['how was the G Minor one', 'The G minor take was 9¢ off pitch on average.'],
    ['how was my F# minor etude', 'Your F# minor etude was 9¢ off pitch.'],
    ['how did my Viola take go', 'The Viola take was 9¢ off pitch on average.'],
    ['how is my tenor part', 'The tenor line was 9¢ off pitch on average.'],
    ['how was my playing in the key of E', 'In the key of E you were 9¢ off pitch on average.'],
  ])('%s -> %s', (q, reply) => {
    // fails at 2b5b284 on all of them (the first three, the key and the viola pass the number rules)
    const v = checkReply(reply, sum.facts, q, { takeCount: 1 });
    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain('premise');
  });

  test('the same words are allowed when the facts hold them (a take called that)', () => {
    const f = ['"Cello suite in G minor" (Oct 19): 24 notes heard, 9¢ off pitch on average.'];
    expect(checkReply('The Cello suite in G minor averaged 9¢ off pitch.', f, 'how was my cello take').ok).toBe(true);
  });

  test('a bare "minor", "a minor difference" and a lower-case "a major" are not keys', () => {
    for (const r of ['A minor difference: 9¢ off pitch on average.', 'There was a minor change in tuning, 9¢ off pitch on average.', 'Your major problem is not visible: 9¢ off pitch on average.']) {
      expect(kinds(checkReply(r, sum.facts, 'how was my last take', { takeCount: 1 })), r).not.toContain('premise');
    }
  });

  test('"how is my voice" and "my singing" are about the pitch summary, so a bare "Not measured." is set aside', () => {
    // routing is already right (the plan is the summary); the model answered "Not measured."
    for (const q of ['how is my voice', 'my singing', 'how is my singing', "how's my voice", 'how am I singing']) {
      const r = runCase({ q, library: LIBRARIES.three });
      expect(r.scope, q).toBe('answer');
      expect(r.intents, q).toEqual(['summary']);
      expect(r.facts.join(' '), q).toMatch(/notes heard, 9¢ off pitch/);
      // fails at 2b5b284: nothing looks at an absence claim with no topic in it
      const v = checkReply('Not measured.', r.facts, q, { takeCount: 1 });
      expect(v.ok, q).toBe(false);
      expect(kinds(v), q).toContain('absent');
    }
  });

  test('"not measured" is still allowed where the facts say so', () => {
    const none = scenario('NOTONE');
    expect(checkReply('Tone and vibrato were not measured for this take.', none.facts, none.question, { takeCount: 1 }).ok).toBe(true);
    expect(checkReply('Vibrato was not measured.', none.facts, none.question, { takeCount: 1 }).ok).toBe(true);
    expect(checkReply('I have no vibrato or tempo measurements for this take.', sum.facts, 'how is my vibrato', { takeCount: 1 }).ok).toBe(true);
    const tone = scenario('TONE');
    const v = checkReply('Tone was not measured.', tone.facts, 'how is my tone', { takeCount: 1 });
    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain('absent');
    // a hedge about one thing does not cover a different claim in the clause after "but"
    expect(checkReply('Vibrato was not measured, but the take is 9¢ off pitch on average.', sum.facts, 'how is my vibrato', { takeCount: 1 }).ok).toBe(true);
  });
});

describe('a yes or a no to a question whose premise is a judgement', () => {
  const tone = scenario('TONE');
  test('"Yes, your vibrato is 27¢ wide" to "is my vibrato too wide"', () => {
    // fails at 2b5b284: every number in it is true
    const v = checkReply('Yes, your vibrato is 27¢ wide.', tone.facts, 'is my vibrato too wide', { takeCount: 1 });
    expect(v.ok).toBe(false);
    expect(kinds(v)).toContain('premise');
    for (const r of ['No, it is not too wide.', 'Yes, it is.', 'Absolutely, 27¢ is wide.', 'Yes your vibrato is 27¢ wide.', 'Yeah it is 27¢ wide.']) expect(checkReply(r, tone.facts, 'is my vibrato too wide', { takeCount: 1 }).ok, r).toBe(false);
  });
  test('the description alone is fine, and so is a yes about something the facts state', () => {
    expect(checkReply('Your vibrato is 27¢ wide, at about 5.4 Hz.', tone.facts, 'is my vibrato too wide', { takeCount: 1 }).ok).toBe(true);
    const hab = scenario('HAB');
    expect(checkReply('Yes, you tend to play D3 sharp, by 14¢.', hab.facts, 'do I tend to play sharp', { takeCount: 3 }).ok).toBe(true);
  });
  test.each([
    ['is my timing off', 'Yes, your timing is off.'],
    ['am I playing out of tune anywhere', 'Yes, you are playing out of tune on D3.'],
    ['was my last take good', 'Yes, it was good.'],
    ['is the tuning ok', 'Yes, it is ok.'],
  ])('%s -> %s', (q, reply) => {
    expect(kinds(checkReply(reply, scenario('SUM').facts, q, { takeCount: 1 })), reply).toContain('premise');
  });
  test('a question that is not yes/no form is not held to it', () => {
    expect(checkReply('Yes, you improved. The Oct 19 take was 9 cents off.', scenario('CMP').facts, 'compare my last two bach takes', { takeCount: 2 }).ok).toBe(true);
  });
});
