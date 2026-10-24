// REPAIR: the router and the sentences built from its choice.
//
// Each test names a way the question was misread or the wrong take answered, and
// each was written against the code at ceab50d, where it fails.
import { describe, test, expect } from 'vitest';
import { plan, scopeOf, intentsOf } from '../src/ai/router.js';
import { factsFor } from '../src/ai/facts.js';
import { answerQuestion } from '../src/ai/assistant.js';
import { weeklyReport } from '../src/analysis/coach.js';
import { rec, NOW, DAY } from './ai-eval/fixtures.js';

const name = (lib, p) => p.takeIds.map((id) => lib.find((t) => t.id === id).name);
const stub = (text) => ({ availability: async () => ({ available: true }), respond: async () => ({ text }) });

describe('a numbered take is named by its number', () => {
  const lib = [rec(1, 'Etude 1', 0.2, 9), rec(2, 'Etude 2', 1, 22), rec(3, 'Etude 3', 2, 5)];

  test('"etude 3" is Etude 3, not the newest take that shares the word', () => {
    expect(name(lib, plan('how was etude 3', lib, NOW))).toEqual(['Etude 3']);
  });
  test('"Etude 3 vs Etude 1" compares those two', () => {
    expect(name(lib, plan('Etude 3 vs Etude 1', lib, NOW)).sort()).toEqual(['Etude 1', 'Etude 3']);
  });
  test('"take 12" is not "take 1"', () => {
    const l = [rec(1, 'Take 1', 3, 9), rec(2, 'Take 12', 5, 22)];
    expect(name(l, plan('how was take 12', l, NOW))).toEqual(['Take 12']);
    expect(name(l, plan('how was take 1', l, NOW))).toEqual(['Take 1']);
  });
  test('a number that is not there is not found, instead of answering about another take', () => {
    expect(plan('how was my etude 4', lib, NOW).scope).toMatchObject({ kind: 'notfound', label: 'etude 4' });
    const l = [rec(1, 'Take 1', 3, 9), rec(2, 'Take 3', 5, 22)];
    expect(plan('how was take 2', l, NOW).scope.kind).toBe('notfound');
  });
  test('a count is not a name: "my last 3 etude takes" still reads all three', () => {
    expect(name(lib, plan('how were my last 3 etude takes', lib, NOW))).toHaveLength(3);
  });
  test('no number asked: the word alone still finds the newest', () => {
    expect(name(lib, plan('how was my etude', lib, NOW))).toEqual(['Etude 1']);
  });
  test('a reply that gives Etude 1\'s figure to "Etude 3" is set aside, not shown', async () => {
    const r = await answerQuestion({ question: 'how was etude 3', library: lib, model: stub('Your Etude 3 was 9 cents off pitch on average, with half of your notes within 10 cents.'), now: NOW });
    expect(r.source).toBe('measurements');
    expect(r.facts.join(' ')).toMatch(/"Etude 3"/);
  });
});

describe('a date typed as a month and day is read', () => {
  const lib = [rec(1, 'Bach prelude', 6, 22), rec(2, 'Bach prelude', 1, 9)];
  test.each(['how was my take on October 14', 'how was my take on Oct 14', 'how was my take on 14 october', 'how was my take on the 14th'])('%s', (q) => {
    const p = plan(q, lib, NOW);
    expect(p.scope.kind).toBe('answer');
    expect(p.takeIds).toEqual([1]);
  });
  test('a day with no take is not found, and "Oct" is not taken for a take called Oct', () => {
    expect(plan('how was my take on October 3', lib, NOW).scope).toMatchObject({ kind: 'notfound' });
    expect(plan('how was my take on Oct 3', lib, NOW).scope.label).toBe('oct 3');
  });
  test('a reply that gives the Oct 19 take\'s figure to the October 14 take is set aside', async () => {
    const r = await answerQuestion({ question: 'how was my take on October 14', library: lib, model: stub('Your October 14 take was 9 cents off pitch on average.'), now: NOW });
    expect(r.source).toBe('measurements');
    expect(r.facts.join(' ')).toMatch(/22¢ off pitch/);
  });
  test('a position is not a day of the month', () => {
    for (const q of ['how was the 3rd bar', 'compare the 1st and 2nd takes', 'how is the 5th note', 'how was the 2nd take']) {
      expect(plan(q, lib, NOW).scope.kind, q).toBe('answer');
    }
  });
  test('a month word beside a count is not a date', () => {
    expect(plan('how were my last 5 takes in may 3 times', lib, NOW).scope.kind).not.toBe('notfound');
  });
});

describe('own-take questions are not general knowledge', () => {
  test.each(["what's the difference between my last two takes", 'what is the difference between my takes', 'what was my mean error'])('%s is answered', (q) => {
    expect(scopeOf(q, [rec(1, 'A', 1, 5), rec(2, 'A', 2, 8)], NOW).kind).toBe('answer');
  });
  test('the definitions are still refused, however politely they are asked', () => {
    for (const q of ['what is a semitone', "what's the difference between sharp and flat notes", 'what does vibrato mean',
      'Can you tell me what vibrato means', "what does a cent mean, I'm confused", "what's the average price of a violin", 'what does mean error mean for me']) {
      expect(scopeOf(q, [rec(1, 'A', 1, 5)], NOW).kind, q).toBe('offtopic');
    }
  });
});

describe('every way of asking for a comparison is one', () => {
  const lib = [rec(1, 'Bach prelude', 6, 22), rec(2, 'Bach prelude', 1, 9), rec(3, 'Scales', 3, 5)];
  test.each([
    'how do my last two takes differ', 'what differs between my last two bach takes', 'contrast my last two takes', 'how do these two takes differ on vibrato and tone',
  ])('%s', (q) => {
    expect(intentsOf(q, lib)).toContain('compare');
    expect(plan(q, lib, NOW).takeIds.length).toBe(2);
  });
});

describe('a keyword inside another word is not the keyword', () => {
  test.each([
    ['roughly how in tune am I', ['summary']],
    ['how was my intonation throughout the take', ['summary']],
    ['how were my last seven takes', ['summary']],
    ['am I bragging', ['summary']],
    ['I am sharp even in the low notes', ['habits']],
    ['my baritone', ['summary']],
    ['does my vibrato flutter', ['tone']],
  ])('%s', (q, want) => {
    expect(intentsOf(q, [])).toEqual(want);
  });
  test('the real words still work', () => {
    expect(intentsOf('is my tone rough')).toEqual(['tone']);
    expect(intentsOf('do my notes land in tune')).toContain('tone');
    expect(intentsOf('am I rushing')).toContain('tempo');
    expect(intentsOf('how evenly timed am I')).toContain('tempo');
    expect(intentsOf('is my pulse even')).toContain('tempo');
  });
});

describe('a take named after a measurement is not chosen by the measurement', () => {
  const lib = [rec(1, 'Long tones', 3, 9), rec(2, 'Bach', 0, 5)];
  test.each(['is my tone clear', 'how is my tone', 'how long are my notes'])('%s answers about the latest take', (q) => {
    expect(name(lib, plan(q, lib, NOW))).toEqual(['Bach']);
  });
  test('typing the whole name still finds it', () => {
    expect(name(lib, plan('how were my long tones', lib, NOW))).toEqual(['Long tones']);
  });
});

describe('a comparison does not say only one take is saved when many are', () => {
  const lib = [rec(1, 'Bach prelude', 6, 22), rec(2, 'Bach prelude', 1, 9), rec(3, 'Scales', 3, 5)];
  const factsOf = (q, l = lib) => {
    const p = plan(q, l, NOW);
    return factsFor({ question: q, intents: p.intents, chosen: p.takeIds.map((id) => l.find((t) => t.id === id)), all: l, now: NOW }).facts.join(' ');
  };
  test('a named take with no sibling', () => {
    const f = factsOf('compare my scales with last time');
    expect(f).not.toMatch(/Only one take is saved/);
    expect(f).toMatch(/Only one saved take matches the question \("Scales"\)/);
  });
  test('a library that really has one take keeps the plain sentence', () => {
    expect(factsOf('compare to last time', [rec(1, 'Bach', 1, 5)])).toMatch(/Only one take is saved/);
  });
  test('"what changed since yesterday" compares yesterday\'s take with the latest', () => {
    const l = [rec(1, 'Bach prelude', 0.1, 9), rec(2, 'Bach prelude', 1, 22)];
    const p = plan('what changed since yesterday', l, NOW);
    expect(p.takeIds).toEqual([1, 2]);
  });
  test('two different pieces are compared only with a word that they are different', () => {
    const l = [rec(1, 'Etude', 0.5, 9), rec(2, 'Bach prelude', 6, 22)];
    expect(factsOf('how does my last take compare with the one before', l)).toMatch(/different names/);
    expect(factsOf('compare my etude with my bach prelude', l)).not.toMatch(/different names/);
  });
});

describe('"my last 3 takes" lists the takes it read', () => {
  const lib = [rec(1, 'Scales', 9, 9), rec(2, 'Bach prelude', 3, 5), rec(3, 'Etude', 1, 7)];
  test('all three are answered for, and named', () => {
    const q = 'how were my last 3 takes';
    const p = plan(q, lib, NOW);
    const f = factsFor({ question: q, intents: p.intents, chosen: p.takeIds.map((id) => lib.find((t) => t.id === id)), all: lib, now: NOW });
    expect(f.used).toEqual(['Etude', 'Bach prelude', 'Scales']);
    for (const n of ['Etude', 'Bach prelude', 'Scales']) expect(f.facts.join(' ')).toContain(`"${n}"`);
  });
  test('a comparison of three says it compares two, and names two', () => {
    const q = 'compare my last 3 takes';
    const p = plan(q, lib, NOW);
    const f = factsFor({ question: q, intents: p.intents, chosen: p.takeIds.map((id) => lib.find((t) => t.id === id)), all: lib, now: NOW });
    expect(f.used).toHaveLength(2);
    expect(f.facts.join(' ')).toMatch(/Only two takes can be compared at a time/);
  });
});

describe('two takes of one name on one day are told apart', () => {
  test('by the time of day', () => {
    const at = (id, h, bias) => ({ ...rec(id, 'Bach', 0, bias), date: new Date(2026, 9, 20, h).getTime() });
    const lib = [at(1, 9, 22), at(2, 12, 9)];
    const q = 'compare my last two takes';
    const p = plan(q, lib, NOW);
    const text = factsFor({ question: q, intents: p.intents, chosen: p.takeIds.map((id) => lib.find((t) => t.id === id)), all: lib, now: NOW }).facts[0];
    const labels = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(labels).size).toBe(2);
    expect(text).toMatch(/12:00 PM/);
    expect(text).toMatch(/9:00 AM/);
  });
  test('unnamed takes on one day do not read "Oct 20, Oct 20"', () => {
    const at = (id, h, bias) => ({ ...rec(id, '', 0, bias), date: new Date(2026, 9, 20, h).getTime() });
    const lib = [at(1, 9, 22), at(2, 12, 9)];
    const p = plan('compare my last two takes', lib, NOW);
    const text = factsFor({ question: 'compare my last two takes', intents: p.intents, chosen: p.takeIds.map((id) => lib.find((t) => t.id === id)), all: lib, now: NOW }).facts[0];
    expect(text).not.toMatch(/Oct 20, Oct 20/);
    expect(new Set([...text.matchAll(/"([^"]+)"/g)].map((m) => m[1])).size).toBe(2);
  });
});

describe('days are counted on the calendar, not in 24-hour steps', () => {
  // The harness's clock zone is whatever the machine has, so the zone is set for
  // the duration of each test. A spring-forward Sunday is 23 hours long: 00:30
  // on the Monday is 24 hours after 01:30 on the Saturday, not on the Sunday.
  const withZone = (tz, f) => {
    const was = process.env.TZ;
    process.env.TZ = tz;
    try { f(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
  };
  const mk = (id, y, m, d, h) => ({ id, name: 'Bach', date: new Date(y, m, d, h).getTime(), noteStats: [{ name: 'A3', cents: 5 }] });
  test('"yesterday" at 00:30 the day after spring forward is Sunday', () => {
    withZone('America/New_York', () => {
      const lib = [mk(1, 2026, 2, 7, 12), mk(2, 2026, 2, 8, 12)];
      const now = new Date(2026, 2, 9, 0, 30).getTime();
      expect(plan('how did I do yesterday', lib, now).takeIds).toEqual([2]);
    });
  });
  test('the streak and the week window count the same days', () => {
    withZone('America/New_York', () => {
      const sessions = [new Date(2026, 2, 7, 12), new Date(2026, 2, 8, 12)].map((d) => ({ date: d.getTime(), noteStats: [{ cents: 5 }] }));
      const now = new Date(2026, 2, 9, 0, 30).getTime();
      expect(weeklyReport(sessions, now).streak).toBe(2);
    });
  });
  test('the last hour of a day after a fall back still reaches six days back', () => {
    withZone('America/New_York', () => {
      // 23:30 on Mon 2 Nov is 144 hours after 00:30 on Wed 28 Oct, so counting in
      // 24-hour steps six days back lands on the 28th and the 27th is never looked at
      const sessions = [{ date: new Date(2026, 9, 27, 12).getTime(), noteStats: [{ cents: 5 }] }];
      const now = new Date(2026, 10, 2, 23, 30).getTime();
      expect(weeklyReport(sessions, now).daysPracticed).toBe(1);
    });
  });
});

describe('the DAY constant the fixtures use is still a day', () => {
  test('sanity', () => { expect(DAY).toBe(86400000); });
});
