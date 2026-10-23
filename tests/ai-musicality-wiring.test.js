import { describe, test, expect } from 'vitest';
import { answerQuestion, instructionsFor, INSTRUCTIONS } from '../src/ai/assistant.js';
import { intentsOf, needsOf, plan } from '../src/ai/router.js';
import { checkReply } from '../src/ai/guard.js';
import { qualityOf } from '../src/analysis/quality.js';
import { buildSpec, idealTake } from './helpers/musicality-synth.js';
import { runCase } from './ai-eval/run.mjs';
import { LIBRARIES, NOW } from './ai-eval/fixtures.js';

// The real shaping code, the real router, the real assistant: only the stored
// audio is replaced by notes and readings a perfect analyzer would hand over.
const flat = idealTake(buildSpec({ shape: 'flat', articulation: 0.95, phrases: 6, perPhrase: 10, period: 0.5 }));
const arch = idealTake(buildSpec({ shape: 'arch', articulation: 0.6, finalStretch: 1.5, phrases: 6, perPhrase: 10, period: 0.5 }));
const lib = LIBRARIES.three;

function counted(byId) {
  const calls = [];
  const load = async (id) => { calls.push(id); return { ...byId[id], sampleRate: 44100, a4: 440 }; };
  return { load, calls };
}

describe('questions about shaping reach the musicality intent', () => {
  test.each([
    'how is my phrasing',
    'does it sound musical',
    'am I playing with feeling',
    'is it too flat or mechanical',
    'how is my articulation',
    'am I playing legato or staccato',
  ])('%s', (q) => {
    expect(intentsOf(q)).toEqual(['musicality']);
  });

  test('the pitch, tone and pulse questions keep their own meaning', () => {
    expect(intentsOf('how was my last take')).toEqual(['summary']);
    expect(intentsOf('how is my vibrato')).toEqual(['tone']);
    expect(intentsOf('do I rush')).toEqual(['tempo']);
    expect(intentsOf('am I sharp on the D')).toEqual(['habits']);
    expect(intentsOf('how is my dynamic range')).toEqual(['tone']);
  });

  test('verdicts on taste and on the player are still refused, not described', () => {
    for (const q of ['am I musical', 'is my phrasing expressive', 'is my playing emotional', 'do I have talent']) {
      expect(plan(q, lib, NOW).scope.kind, q).toBe('unmeasurable');
    }
  });

  test('shaping needs the take loaded, a plain comparison loads it too, a summary does not', () => {
    expect(needsOf(['musicality']).musicality).toBe(true);
    expect(needsOf(['musicality']).quality).toBe(false);
    expect(needsOf(['compare']).musicality).toBe(true);
    expect(needsOf(['summary']).musicality).toBe(false);
  });
});

describe('answerQuestion loads a take once and computes everything from that one load', () => {
  test('a comparison loads each take exactly once and gets both tone and shaping', async () => {
    const { load, calls } = counted({ 1: flat, 2: arch });
    const r = await answerQuestion({
      question: 'compare my last two bach takes', library: lib, load, qualityOf, rhythmReport: () => null,
      model: { availability: async () => ({ available: false, reason: 'off' }) }, now: NOW,
    });
    expect(calls.sort()).toEqual([1, 2]);
    const text = r.facts.join(' ');
    expect(text).toMatch(/Average pitch error/);
    expect(text).toMatch(/more detached|less alike|phrases that swell/);
  });

  test('a shaping question loads the one take, runs no tone analysis, and says it is not a judgement', async () => {
    const { load, calls } = counted({ 2: arch });
    let qualityCalls = 0;
    const r = await answerQuestion({
      question: 'how is my phrasing', library: lib, load, qualityOf: () => { qualityCalls++; return null; }, rhythmReport: () => null,
      model: { availability: async () => ({ available: false, reason: 'off' }) }, now: NOW,
    });
    expect(calls).toEqual([2]);
    expect(qualityCalls).toBe(0);
    expect(r.source).toBe('measurements');
    expect(r.facts.join(' ')).toMatch(/not a judgement of taste/);
  });

  test('the musicality rule is in the model instructions only when shaping facts are', () => {
    expect(instructionsFor(['summary'])).toBe(INSTRUCTIONS);
    expect(instructionsFor(['musicality'])).toMatch(/Never say a take is more musical/);
    expect(instructionsFor(['compare'])).toMatch(/Never say a take is more musical/);
  });

  test('a take that cannot be loaded gives a plain "could not be measured", not a guess', async () => {
    const r = await answerQuestion({
      question: 'how is my phrasing', library: lib, load: async () => { throw new Error('gone'); }, qualityOf, rhythmReport: () => null,
      model: { availability: async () => ({ available: false, reason: 'off' }) }, now: NOW,
    });
    expect(r.facts.join(' ')).toMatch(/could not be measured/);
  });

  test('a model that calls the phrasing beautiful is set aside and the measurements are shown', async () => {
    const { load } = counted({ 2: arch });
    const model = { availability: async () => ({ available: true }), respond: async () => ({ text: 'Your phrasing is beautiful and very musical.' }) };
    const r = await answerQuestion({ question: 'how is my phrasing', library: lib, load, qualityOf, rhythmReport: () => null, model, now: NOW });
    expect(r.source).toBe('measurements');
    expect(r.note).toMatch(/taste/);
    expect(r.text).toBe(r.facts.join(' '));
  });
});

describe('the guard on shaping replies', () => {
  const Q = 'how is my phrasing';
  const facts = runCase({ q: Q, library: LIBRARIES.phrased }).facts;
  const ok = (reply, f = facts, q = Q) => checkReply(reply, f, q, { takeCount: 1 }).ok;

  test('keeps honest replies, in digits, spelled out and in the words of the facts', () => {
    expect(ok('Your Bach prelude has six phrases of about ten notes each, and the phrase ends are clearly marked.')).toBe(true);
    expect(ok('The 6 phrases all swell and fade, and the phrase-final notes are 1.5 times as long as the notes before them.')).toBe(true);
    expect(ok('The loudest stretch is 1.4 dB above the quietest, so the loudness barely moves.')).toBe(true);
    expect(ok('It reads as lightly separated, evenly articulated and steady in tempo.')).toBe(true);
  });

  test('drops numbers the shaping facts never held, in the shaping units too', () => {
    expect(ok('The phrase-final notes are 3 times as long as the notes before them.')).toBe(false);
    expect(ok('Your phrases are 2 dB louder in the middle than at the edges.')).toBe(false);
    expect(ok('The tempo is steady, within about 4% of its middle.')).toBe(false);
  });

  test('drops a verdict on taste that has no digit in it', () => {
    for (const bad of ['Your phrasing is beautiful and very musical.', 'This sounds mechanical and lifeless.', 'Your playing is more expressive than before.']) {
      expect(ok(bad), bad).toBe(false);
    }
  });

  test('the caveat sentence does not itself license the word "beautiful"', () => {
    expect(ok('The tone is beautiful.')).toBe(false);
  });

  test('"mechanical" is allowed exactly when the measurements called the take that', () => {
    const f = ['"Bach" (Oct 19) reads as mechanical: steady in tempo; every shaping measure that could be read here is flat.', 'These describe the shaping of the playing from what could be measured; they are not a judgement of taste or of how beautiful the tone is.'];
    expect(checkReply('It reads as mechanical because every shaping measure is flat.', f, 'is it mechanical').ok).toBe(true);
    expect(checkReply('It reads as mechanical.', facts, Q).ok).toBe(false);
  });

  test('a question about pitch is not subject to the taste rule', () => {
    const f = ['"Bach" (Oct 19): 24 notes heard, 9¢ off pitch on average, 40% of notes within 10¢.'];
    expect(checkReply('Your tuning is lovely, 9¢ off on average.', f, 'how was my last take').ok).toBe(true);
  });

  // KNOWN GAP, pinned: a claim about a shaping measure that the facts say was
  // not measured gets through when it has no digit. The older clause-level rule
  // only knows tone, dynamics and tempo as topics.
  test('KNOWN GAP: "vibrato opens up nicely" passes although the facts say that was not measured', () => {
    expect(ok('Your vibrato opens up nicely on long notes.')).toBe(true);
  });
});
