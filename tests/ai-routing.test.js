import { describe, test, expect } from 'vitest';
import { answerQuestion, modelMaySpeak } from '../src/ai/assistant.js';
import { plan } from '../src/ai/router.js';
import { factsFor } from '../src/ai/facts.js';
import { qualityOf } from '../src/analysis/quality.js';
import { LIBRARIES, NOW } from './ai-eval/fixtures.js';

// The guard cannot tie a claim to the right take: "The Oct 14 take is 13¢
// closer" passes when it is the Oct 19 take, because both dates and the 13 are
// in the facts. So a question whose facts hold the measurements of more than one
// take is answered by the sentences alone, and the model is never asked. These
// tests count the calls the model receives, since a reply that is thrown away
// afterwards would still have cost the player the wait.

function counting(text = 'Your last take was 9 cents off pitch on average.') {
  const m = {
    calls: 0,
    availability: async () => ({ available: true }),
    respond: async () => { m.calls += 1; return { text }; },
  };
  return m;
}
const base = (library, model) => ({ library, now: NOW, model, qualityOf, rhythmReport: null, load: null });

describe('questions that span several takes are answered by the sentences alone', () => {
  const several = [
    ['compare', 'compare my last two bach takes'],
    ['trend', 'am I improving over time'],
    ['habits across the library', 'which notes do I tend to play sharp or flat'],
    ['last N takes', 'how were my last 3 takes'],
    ['a named comparison', 'is my latest bach take better than the one before'],
  ];
  test.each(several)('%s: the model is not asked', async (_k, question) => {
    const model = counting();
    const r = await answerQuestion({ ...base(LIBRARIES.three, model), question });
    expect(model.calls).toBe(0);
    expect(r.source).toBe('measurements');
    expect(r.why).toBe('several-takes');
    expect(r.text.length).toBeGreaterThan(20);
  });

  test('the note says what happened in plain words, not as a failure', async () => {
    const r = await answerQuestion({ ...base(LIBRARIES.three, counting()), question: 'compare my last two bach takes' });
    expect(r.note).toMatch(/more than one take/);
    expect(r.note).toMatch(/written by the app/);
    expect(r.note).not.toMatch(/set aside|could not|failed|unavailable/i);
  });

  test('a device with no model is told only the standing reason, not a second note', async () => {
    const off = { availability: async () => ({ available: false, reason: 'Apple Intelligence is off.' }), respond: async () => { throw new Error('never'); } };
    const r = await answerQuestion({ ...base(LIBRARIES.three, off), question: 'compare my last two bach takes' });
    expect(r.note).toMatch(/Apple Intelligence/);
    expect(r.why).toBeUndefined();
  });
});

describe('questions about one take still go to the model', () => {
  test('a summary of the last take', async () => {
    const model = counting();
    const r = await answerQuestion({ ...base(LIBRARIES.three, model), question: 'how was my last take' });
    expect(model.calls).toBe(1);
    expect(r.source).toBe('model');
  });

  test('"compare" with only one take saved is a single-take answer', async () => {
    const model = counting('Only one take is saved, so there is nothing to compare it with.');
    const r = await answerQuestion({ ...base([LIBRARIES.three[0]], model), question: 'compare to last time' });
    expect(model.calls).toBe(1);
    expect(r.why).toBeUndefined();
  });
});

describe('factsFor says how many takes the sentences were built from', () => {
  const asked = (question, library = LIBRARIES.three) => {
    const p = plan(question, library, NOW);
    const chosen = p.takeIds.map((id) => ({ ...library.find((t) => t.id === id) }));
    return factsFor({ question, intents: p.intents, chosen, all: library, now: NOW });
  };
  test('one for a summary, two for a comparison, the whole library for a trend or a habit', () => {
    expect(asked('how was my last take').takesInFacts).toBe(1);
    expect(asked('compare my last two bach takes').takesInFacts).toBe(2);
    expect(asked('am I improving over time').takesInFacts).toBeGreaterThan(1);
    expect(asked('which notes do I tend to play sharp or flat').takesInFacts).toBeGreaterThan(1);
    expect(asked('how were my last 2 takes').takesInFacts).toBe(2);
  });
  test('modelMaySpeak is the one decision', () => {
    expect(modelMaySpeak(0)).toBe(true);
    expect(modelMaySpeak(1)).toBe(true);
    expect(modelMaySpeak(2)).toBe(false);
  });
});

describe('the prompt\'s own scope tags never reach the player', () => {
  test.each(['[the whole take] ', '[one note only] ', '[The Whole Take]\n'])('an echoed %j is stripped from the text that is shown', async (tag) => {
    const model = counting(`${tag}Your last take was 9 cents off pitch on average.`);
    const r = await answerQuestion({ ...base(LIBRARIES.three, model), question: 'how was my last take' });
    expect(r.source).toBe('model');
    expect(r.text).toBe('Your last take was 9 cents off pitch on average.');
    expect(r.text).not.toMatch(/[\[\]]/);
  });
  test('checkReply on its own rejects a reply that still carries one', async () => {
    const { checkReply } = await import('../src/ai/guard.js');
    const v = checkReply('[the whole take] Your last take was 9 cents off.', ['"Bach" (Oct 19): 24 notes heard, 9¢ off pitch on average.']);
    expect(v.ok).toBe(false);
    expect(v.problems[0].kind).toBe('echo');
  });
});
