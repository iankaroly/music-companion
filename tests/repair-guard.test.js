// REPAIR: replies the guard let through, and honest ones it refused. Every
// "refused" case below passed at ceab50d; every "passes" case was refused.
import { describe, test, expect, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkReply } from '../src/ai/guard.js';
import { factsFor } from '../src/ai/facts.js';
import { answerQuestion } from '../src/ai/assistant.js';
import { whenOf } from '../src/ai/labels.js';
import { rec, NOW } from './ai-eval/fixtures.js';

const why = (v) => v.problems.map((p) => `${p.kind}:${p.text}`).join(' | ');
const stub = (text) => ({ availability: async () => ({ available: true }), respond: async () => ({ text }) });
const viaModel = (library, question, text) => answerQuestion({ question, library, model: stub(text), now: NOW });

describe('one note\'s figure given as the take\'s', () => {
  // "Bach prelude": 24 notes, 9¢ off on average, 75% within 10¢; A3 is the furthest note, 11¢ sharp over 6 times
  const lib = [rec(1, 'Bach prelude', 1, 9, { offsets: { D3: -1, A3: 2, F3: 0, G3: -1 } })];
  const f = factsFor({ question: 'how was my last take', intents: ['summary'], chosen: lib, all: lib, now: NOW });
  const check = (t) => checkReply(t, f.facts, 'how was my last take', { takeCount: 1, slots: f.slots });

  test('the facts are what the lies below are built against', () => {
    expect(f.facts.join(' ')).toMatch(/9¢ off pitch on average, 75% of notes within 10¢/);
    expect(f.facts.join(' ')).toMatch(/A3, 11¢ sharp on average over 6 times/);
  });
  test.each([
    'You were 11 cents off on average.',
    'Your average error was 11¢.',
    'Your last take averaged 11 off pitch.',
    'You are 11¢ sharp on average.',
    '11 ct off on average.',
    '11c off on average.',
    'Your average was 11 cents.',
    'Average error was 75 off pitch.',
    'Of the 24 notes, 75 were within 10 cents.',
    '24 of the 24 notes were within 10 cents.',
    'None of your notes were within 10 cents.',
    'Every note was within 10 cents.',
  ])('refused: %s', (t) => {
    expect(check(t).ok).toBe(false);
  });
  test.each([
    'Your last take averaged 9 cents off pitch, with 75% of your notes within 10 cents.',
    'The note furthest from pitch was A3, 11¢ sharp on average over 6 times.',
    'On average you were 9¢ off.',
    'A3 was 11¢ sharp on average, over 6 times in this take.',
    'The furthest note, A3, averaged +11¢ over 6 times.',
    'You were 9 cents off on average, and A3 was the furthest at 11¢ sharp.',
  ])('passes: %s', (t) => {
    const v = check(t);
    expect(v.ok, why(v)).toBe(true);
  });
  test('a minus sign is allowed only for a flat note and a plus only for a sharp one', () => {
    expect(check('The furthest note, A3, averaged -11¢ over 6 times.').ok).toBe(false);
  });
});

describe('words in a take\'s name are not measurements', () => {
  test.each([
    ['Better Together', 'You have improved, now 9 cents off pitch on average.'],
    ['Closer', 'You got closer, 9 cents off pitch on average.'],
    ['Lovely Day', 'Your lovely take averaged 9 cents off pitch.'],
  ])('a take called %s', async (name, text) => {
    const r = await viaModel([rec(1, name, 1, 9)], 'how was my last take', text);
    expect(r.source, r.note).toBe('measurements');
  });
  test('quoting the name is still fine, and so is a pitch name inside it', async () => {
    expect((await viaModel([rec(1, 'Better Together', 1, 9)], 'how was my last take', '"Better Together" averaged 9 cents off pitch.')).source).toBe('model');
    // a take this close to pitch has no "furthest note" sentence, so D3 is only in the name
    const r = await viaModel([rec(1, 'D3 drone', 1, 4)], 'how was my last take', 'Your D3 drone take was 4 cents off pitch on average.');
    expect(r.source, r.note).toBe('model');
  });
});

describe('the facts\' own caveat can be copied', () => {
  const toned = [{ ...rec(1, 'Aria', 1, 6), quality: {
    steadinessCents: 3.1, vibrato: { share: 0.7, widthCents: 27, rateHz: 5.4 }, clarity: 0.88, brightness: 3.5,
    dynamics: { medianDb: -18, rangeDb: 12, stepDb: 1.8 }, landing: { cleanShare: 0.78, medianSettleMs: 90, medianOnsetCents: 7 } } }];
  test('"(lower can mean breathy or rough)" after the clarity figure', async () => {
    const r = await viaModel(toned, 'is my tone clear', 'Tone clarity reads 88 out of 100 (lower can mean breathy or rough).');
    expect(r.source, r.note).toBe('model');
  });
  test.each([
    ['Held notes drift 27¢ in the middle.', false],
    ['Vibrato is 3.1¢ wide.', false],
    ['Loudness varies by 12 dB between neighbouring notes.', false],
    ['Your vibrato is about 27¢ wide.', true],
    ['Held notes wander 3.1¢ in the middle.', true],
    ['Loudness ranges 12 dB between the quietest and loudest notes, and neighbouring notes differ by 1.8 dB.', true],
  ])('%s', async (text, passes) => {
    const r = await viaModel(toned, 'how is my tone', text);
    expect(r.source === 'model', r.note).toBe(passes);
  });
});

describe('dates are English, because the sentences around them are', () => {
  test.each(['de_DE', 'ja_JP', 'ar_SA'])('a device set to %s still prints "Oct 19" and "Your Oct 19 take" passes', (locale) => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const code = `
      const { answerQuestion } = await import(${JSON.stringify(`${root}src/ai/assistant.js`)});
      const { rec, NOW } = await import(${JSON.stringify(`${root}tests/ai-eval/fixtures.js`)});
      const model = { availability: async () => ({ available: true }), respond: async () => ({ text: 'Your Oct 19 take was 9 cents off pitch on average.' }) };
      const r = await answerQuestion({ question: 'how was my last take', library: [rec(1, '', 1, 9)], model, now: NOW });
      console.log(JSON.stringify({ source: r.source, first: r.facts[0].slice(0, 12) }));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, LC_ALL: locale, LANG: locale }, encoding: 'utf8' });
    expect(JSON.parse(out.trim().split('\n').at(-1))).toEqual({ source: 'model', first: '"Oct 19" (Oc' });
  });
  test('the date is asked for in English', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    whenOf({ date: NOW });
    expect(spy.mock.calls.at(-1)[0]).toBe('en-US');
    spy.mockRestore();
    expect(whenOf({ date: new Date(2026, 9, 19, 12).getTime() })).toBe('Oct 19');
  });
});

describe('the AI module loads on the oldest iOS the app supports', () => {
  // iOS 15 to 16.3 ship a WebKit without regex lookbehind; a literal that uses
  // one throws a SyntaxError when the module loads, and the card then never gets
  // the no-model path either. Lookbehind needs Safari 16.4.
  test('no lookbehind in the code the Ask card loads', async () => {
    const files = [];
    for (const d of ['src/ai', 'src/ui/ask.js', 'src/analysis/quality.js', 'src/analysis/musicality.js', 'src/analysis/coach.js']) {
      const path = new URL(`../${d}`, import.meta.url);
      if (d.endsWith('.js')) files.push([d, await readFile(path, 'utf8')]);
      else for (const f of await readdir(path)) if (f.endsWith('.js')) files.push([`${d}/${f}`, await readFile(new URL(`../${d}/${f}`, import.meta.url), 'utf8')]);
    }
    for (const [name, src] of files) {
      // comments are prose; only code can throw
      const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      expect(/\(\?<[!=]/.test(code), name).toBe(false);
    }
  });
});
