import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { checkReply, numbersIn } from '../src/ai/guard.js';
import { answerQuestion, whyNotModel, modelMaySpeak } from '../src/ai/assistant.js';
import { rowsOf } from '../src/ai/facts.js';
import { show } from '../src/ui/ask.js';
import { qualityOf } from '../src/analysis/quality.js';
import { LIBRARIES, NOW, rec } from './ai-eval/fixtures.js';
import { factsOf, SCENARIOS } from './ai-pairing-fixtures.mjs';
import { LIES, EVASIONS, HONEST } from './ai-pairing-lies.mjs';

// Numbers that are all REAL, paired with the wrong thing. The guard used to ask
// whether a number was in the facts and whether the words beside it were about
// the same sort of thing; it could not ask what the number WAS. Each test below
// fails on the guard at a7305c3 because the facts carried no slots to ask with.

const INTENT = { etude: ['summary'], collision: ['summary'], flat: ['summary'], scored: ['worst'], nobars: ['worst'], one_pitch: ['worst'], toned: ['tone'], paced: ['tempo'], clean: ['summary'], habit1: ['habits'] };
const verdict = (s, text, q = 'how was my last take') => {
  const f = factsOf(s, INTENT[s]);
  return checkReply(text, f.facts, q, { takeCount: 1, slots: f.slots });
};
const why = (v) => v.problems.map((p) => `${p.kind}:${p.text}`).join(' | ');

describe('the four lies, on the exact facts the model is given', () => {
  // "Bach prelude": 24 notes, 9¢ off on average, 50% within 10¢, furthest note D3 9¢ sharp over 6 times
  test('a note\'s figure given as the take\'s', () => {
    const v = verdict('collision', 'Your last take was 9¢ sharp on average over 6 times.');
    expect(v.ok, why(v)).toBe(false);
    expect(v.problems.some((p) => p.kind === 'pairing')).toBe(true);
  });

  test('a cents error read as a count of notes', () => {
    const v = verdict('collision', 'Nine of the 24 notes were within 10 cents.');
    expect(v.ok, why(v)).toBe(false);
    expect(v.problems.some((p) => p.kind === 'pairing')).toBe(true);
  });

  test('two bars\' figures swapped', () => {
    const v = verdict('scored', 'Bar 3 was 14¢ off over 3 notes, and bar 2 was 31¢ off.');
    expect(v.ok, why(v)).toBe(false);
    expect(v.problems.filter((p) => p.kind === 'pairing')).toHaveLength(2);
  });

  test('"the whole take was sharp" for one note', () => {
    const v = verdict('one_pitch', 'The take was sharp.');
    expect(v.ok, why(v)).toBe(false);
    expect(v.problems[0].kind).toBe('pairing');
  });

  test('the same numbers used for what they are pass', () => {
    for (const t of [
      'Your last take was 9¢ off pitch on average. The furthest note was D3, 9¢ sharp over 6 times.',
      'Bar 3 was 31¢ off over 3 notes, and bar 2 was 14¢ off.',
      'D3 was 15¢ sharp over 8 times.',
    ]) {
      const s = t.includes('Bar') ? 'scored' : t.includes('8 times') ? 'one_pitch' : 'collision';
      const v = verdict(s, t);
      expect(v.ok, `${t} -> ${why(v)}`).toBe(true);
    }
  });
});

describe('ten scenarios, forty-two mispairing lies', () => {
  test.each(LIES.map((l) => [`${l.s}/${l.n}${l.held ? ' (sealed half)' : ''}: ${l.t}`, l]))('%s', (_n, l) => {
    const v = verdict(l.s, l.t);
    expect(v.ok, 'this lie got through').toBe(false);
  });

  test('every scenario names a library that exists', () => {
    for (const l of LIES) expect(SCENARIOS[l.s], l.s).toBeTruthy();
    expect(LIES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(LIES.map((l) => l.s)).size).toBe(10);
  });

  test.each(EVASIONS.map((e) => [`${e.miss ? '(known miss) ' : ''}${e.t}`, e]))('adversarial: %s', (_n, e) => {
    expect(verdict(e.s, e.t).ok).toBe(!!e.miss);
  });

  test.each(HONEST.map((h) => [h.t, h]))('honest twin passes: %s', (_n, h) => {
    const v = verdict(h.s, h.t);
    expect(v.ok, why(v)).toBe(true);
  });
});

describe('the slot table is parallel to the sentences, not new digits in them', () => {
  test.each(Object.keys(INTENT))('%s: every number a sentence states has a slot with that value', (key) => {
    const f = factsOf(key, INTENT[key]);
    expect(f.slots.length).toBeGreaterThan(0);
    for (const fact of f.facts) {
      // quoted names and dates are checked on their own by the guard
      const body = fact.replace(/"[^"]*"/g, ' ').replace(/\([A-Z][a-z]{2} \d+\)/g, ' ');
      for (const n of numbersIn(body)) {
        expect(f.slots.some((s) => Math.abs(s.v - n) < 0.051 || (Number.isInteger(n) && Math.round(s.v) === n)), `${n} in "${fact}"`).toBe(true);
      }
    }
  });

  test('every slot says what it is', () => {
    for (const key of Object.keys(INTENT)) {
      for (const s of factsOf(key, INTENT[key]).slots) {
        expect(s.kind).toBeTruthy();
        expect(['take', 'note', 'bar', 'any']).toContain(s.scope);
        expect(Number.isFinite(s.v)).toBe(true);
      }
    }
  });

  test('bar and pitch rows are named, and a summary names exactly one', () => {
    expect(rowsOf(factsOf('etude', ['summary']).slots)).toBe(1);
    expect(rowsOf(factsOf('scored', ['worst']).slots)).toBe(3);
    expect(rowsOf(factsOf('nobars', ['worst']).slots)).toBe(3);
    expect(rowsOf(factsOf('one_pitch', ['worst']).slots)).toBe(1);
    expect(rowsOf(factsOf('toned', ['tone']).slots)).toBe(0);
  });
});

describe('a list is written by the app, not the model', () => {
  const noteLib = [rec(1, 'Etude', 1, 4, { offsets: { D3: 19, A3: -5, F3: 2, G3: -1 } })];
  const counting = (text) => {
    const m = { calls: 0, availability: async () => ({ available: true }), respond: async () => { m.calls += 1; return { text }; } };
    return m;
  };
  const ask = (question, library, model) => answerQuestion({ question, library, now: NOW, model, qualityOf, rhythmReport: null, load: null });

  test('the decision counts rows as well as takes', () => {
    expect(whyNotModel(1, 0)).toBe(null);
    expect(whyNotModel(1, 1)).toBe(null);
    expect(whyNotModel(1, 2)).toBe('several-rows');
    expect(whyNotModel(2, 3)).toBe('several-takes');
    expect(modelMaySpeak(1, 3)).toBe(false);
    expect(modelMaySpeak(1)).toBe(true);
  });

  test.each([
    ['bars', 'where am I worst', LIBRARIES.scored],
    ['pitches', 'which notes am I worst at', noteLib],
  ])('worst %s: the model is never asked, and the card says why', async (_k, question, library) => {
    const model = counting('You are worst on bar 3.');
    const r = await ask(question, library, model);
    expect(model.calls).toBe(0);
    expect(r.source).toBe('measurements');
    expect(r.why).toBe('several-rows');
    expect(r.note).toMatch(/list of bars or notes/);
    expect(r.note).not.toMatch(/more than one take|set aside|failed/i);
    expect(r.text).toMatch(/\d+¢/);
  });

  test('a summary has one furthest note, so it still goes to the model', async () => {
    const model = counting('Your last take was 8.5¢ off pitch on average.');
    const r = await ask('how was my last take', noteLib, model);
    expect(model.calls).toBe(1);
    expect(r.source).toBe('model');
  });

  test('a worst-notes question with a single repeated pitch is one row and goes to the model', async () => {
    const lib = SCENARIOS.one_pitch.map((t) => ({ ...t }));
    const model = counting('D3 was 15¢ sharp over 8 times.');
    const r = await ask('which notes am I worst at', lib, model);
    expect(model.calls).toBe(1);
    expect(r.source).toBe('model');
  });

  test('a model that gives the note\'s figure to the take is set aside, and the player gets the sentences', async () => {
    const lib = SCENARIOS.collision.map((t) => ({ ...t }));
    const model = counting('Your last take was 9¢ sharp on average over 6 times.');
    const r = await ask('how was my last take', lib, model);
    expect(model.calls).toBe(1);
    expect(r.source).toBe('measurements');
    expect(r.note).toMatch(/set aside/);
    expect(r.text).toContain('24 notes heard');
  });

  test('the card for a routed-away list reads as one sentence of its own', async () => {
    class El {
      constructor(tag = 'div') { this.tag = tag; this.children = []; this.hidden = false; this.dataset = {}; this._text = ''; this.open = false; }
      replaceChildren(...c) { this.children = c; this._text = ''; }
      append(...c) { this.children.push(...c); }
      set textContent(v) { this._text = String(v); this.children = []; }
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(' '); }
    }
    const ids = ['#ask-out', '#ask-answer', '#ask-wait', '#ask-based', '#ask-based-list', '#ask-from', '#ask-note', '#ask-model'];
    const els = Object.fromEntries(ids.map((id) => [id, new El(id === '#ask-based-list' ? 'ul' : 'div')]));
    const real = globalThis.document;
    globalThis.document = { createElement: (t) => new El(t) };
    try {
      const r = await ask('where am I worst', LIBRARIES.scored, counting('x'));
      show({ querySelector: (id) => els[id] }, r, { available: true });
      expect(els['#ask-answer'].textContent).toContain('bar 3');
      expect(els['#ask-note'].hidden).toBe(false);
      expect(els['#ask-note'].textContent).toBe(`Showing the measurements directly. ${r.note}`);
    } finally {
      globalThis.document = real;
    }
  });
});
