import { describe, test, expect } from 'vitest';
import { intentsOf, plan } from '../src/ai/router.js';
import { numbersIn, checkReply } from '../src/ai/guard.js';
import { answerQuestion } from '../src/ai/assistant.js';
import { qualityOf } from '../src/analysis/quality.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 20, 12).getTime();

// A take whose notes sit `bias` cents away from pitch, so the true answer to
// "how far off was it" is known before any code runs.
function rec(id, name, daysAgo, bias, { scoreStats = null } = {}) {
  const names = ['D3', 'A3', 'F3', 'G3'];
  const noteStats = Array.from({ length: 24 }, (_, i) => ({
    midi: 50 + (i % 4), name: names[i % 4], cents: bias + (i % 2 ? 2 : -2),
  }));
  return { id, name, date: NOW - daysAgo * DAY, duration: 30, noteStats, landingStats: [], scoreStats };
}

const library = [
  rec(1, 'Bach prelude', 6, 22),
  rec(2, 'Bach prelude', 1, 9),
  rec(3, 'Scales', 3, 5),
];

describe('router', () => {
  test('reads the question for what it needs', () => {
    expect(intentsOf('how does this compare to last time?')).toContain('compare');
    expect(intentsOf('which notes am I worst at')).toContain('worst');
    expect(intentsOf('is my vibrato getting wider')).toContain('tone');
    expect(intentsOf('do I rush?')).toContain('tempo');
    expect(intentsOf('tell me something')).toEqual(['summary']);
  });

  test('a comparison picks the two latest takes of the same piece, not the latest two of anything', () => {
    const lib = [...library, rec(4, 'Bach prelude', 0.2, 6)];
    const p = plan('compare my last take with the one before', lib);
    expect(p.takeIds).toEqual([4, 2]);
    const p2 = plan('compare my takes', library);
    expect(p2.takeIds).toEqual([2, 1]);
  });

  test('a take named in the question is the one asked about', () => {
    expect(plan('how were my scales', library).takeIds).toEqual([3]);
  });
});

describe('guard', () => {
  const facts = ['Average pitch error: "Bach prelude" 9¢, "Bach prelude" 22¢, so it is 13¢ closer to pitch.'];
  test('a reply that only uses the measured numbers passes, rounding allowed', () => {
    expect(checkReply('You are 13 cents closer: 9 now against 22 before.', facts).ok).toBe(true);
  });
  test('an invented number is caught', () => {
    const r = checkReply('You improved by 40 cents.', facts);
    expect(r.ok).toBe(false);
    expect(r.stray).toEqual([40]);
  });
  test('numbers the player typed are allowed back', () => {
    expect(checkReply('Over the last 3 takes, 9 now.', facts, 'my last 3 takes', { takeCount: 3 }).ok).toBe(true);
  });
  test('empty and runaway replies fail', () => {
    expect(checkReply('', facts).ok).toBe(false);
    expect(checkReply('x'.repeat(2000), facts).ok).toBe(false);
  });
  test('numbersIn finds decimals and ignores words', () => {
    expect(numbersIn('about 12.5¢ over 3 times, twice')).toEqual([12.5, 3]);
  });
});

describe('answerQuestion', () => {
  const base = { library, now: NOW, load: null, qualityOf, rhythmReport: null };
  const honest = { availability: async () => ({ available: true }), respond: async () => ({ text: 'The latest take is 13 cents closer to pitch: 9 now against 22 before.' }) };
  const liar = { availability: async () => ({ available: true }), respond: async () => ({ text: 'You improved by 41 cents, great work.' }) };
  const broken = { availability: async () => ({ available: true }), respond: async () => { throw new Error('model session failed'); } };
  const absent = { availability: async () => ({ available: false, reason: 'Apple Intelligence is off.' }), respond: async () => { throw new Error('never called'); } };

  test('the facts carry the true numbers: 22 -> 9 is 13 closer', async () => {
    const r = await answerQuestion({ ...base, question: 'compare my last two bach takes', model: absent });
    expect(r.source).toBe('measurements');
    expect(r.text).toMatch(/"Bach prelude, [^"]+" 9¢/);
    expect(r.text).toMatch(/22¢/);
    expect(r.text).toMatch(/13¢ closer to pitch/);
  });

  // A comparison spans two takes and is answered by the sentences alone
  // (tests/ai-routing.test.js), so the model paths are exercised on one take.
  const honestOne = { availability: async () => ({ available: true }), respond: async () => ({ text: 'Your last take was 9 cents off pitch on average.' }) };

  test('an honest model reply is shown', async () => {
    const r = await answerQuestion({ ...base, question: 'how was my last take', model: honestOne });
    expect(r.source).toBe('model');
    expect(r.text).toMatch(/9 cents/);
  });

  test('a comparison is never sent to the model, honest or not', async () => {
    const r = await answerQuestion({ ...base, question: 'compare my last two bach takes', model: honest });
    expect(r.source).toBe('measurements');
    expect(r.text).toMatch(/13¢ closer to pitch/);
  });

  test('a reply with a made-up number is replaced by the measurements', async () => {
    const r = await answerQuestion({ ...base, question: 'how was my last take', model: liar });
    expect(r.source).toBe('measurements');
    expect(r.stray).toContain(41);
    expect(r.text).not.toMatch(/41/);
  });

  test('a model that throws, or is switched off, still answers', async () => {
    expect((await answerQuestion({ ...base, question: 'compare my last two bach takes', model: broken })).source).toBe('measurements');
    const off = await answerQuestion({ ...base, question: 'compare my last two bach takes', model: absent });
    expect(off.note).toMatch(/Apple Intelligence/);
  });

  test('an empty library says so instead of inventing', async () => {
    const r = await answerQuestion({ ...base, library: [], question: 'how am I doing', model: honest });
    expect(r.source).toBe('measurements');
    expect(r.text).toMatch(/no saved takes/);
  });

  test('tone facts come only from loaded audio and say so when missing', async () => {
    const r = await answerQuestion({ ...base, question: 'how is my vibrato', model: absent });
    expect(r.text).toMatch(/could not be measured/);
  });

  test('a reply that prints the prompt back or stops mid-sentence is set aside', async () => {
    const say = (text) => ({ availability: async () => ({ available: true }), respond: async () => ({ text }) });
    const echo = await answerQuestion({ ...base, question: 'how was my last take', model: say('MEASUREMENTS:\n- "Scales" (Oct 17): 24 notes heard, 5¢ off pitch on average.\nYour last take was 5¢ off.') });
    expect(echo.source).toBe('measurements');
    expect(echo.note).toMatch(/repeated the prompt/);
    const cut = await answerQuestion({ ...base, question: 'how was my last take', model: say('Your last take was 9¢ off pitch on average, and 24 notes') });
    expect(cut.source).toBe('measurements');
    expect(cut.note).toMatch(/cut off/);
  });

  test('a prompt over the context budget is never sent to the model', async () => {
    let called = false;
    const spy = { availability: async () => ({ available: true }), respond: async () => { called = true; return { text: 'Fine.' }; } };
    // a take named with 8000 characters is the cheapest way to make the facts longer than the window
    const huge = rec(9, `Etude ${'x'.repeat(8000)}`, 0.1, 4);
    const r = await answerQuestion({ ...base, library: [huge], question: 'how was my last take', model: spy });
    expect(called).toBe(false);
    expect(r.source).toBe('measurements');
    expect(r.note).toMatch(/too much/);
  });

  test('a one-take library cannot be compared and says so', async () => {
    const r = await answerQuestion({ ...base, library: [library[0]], question: 'compare to last time', model: absent });
    expect(r.text).toMatch(/Only one take/);
  });
});
