import { describe, test, expect } from 'vitest';
import { checkReply } from '../src/ai/guard.js';

// A measured number given to the wrong measurement. The number rules ask whether
// the digit and its unit exist in the facts, and the topic rule asks whether the
// sentence is about the same sort of thing, so a number from the right sentence
// and the wrong clause went through: "Vibrato is on 88% of notes" (88 is the
// clarity, which the "88 out of 100" allowance also turned into a percentage),
// "neighbouring notes differ by 12 dB" (12 is the range, the step is 1.8),
// "spread ±14¢, D3 runs 2¢" (the two swapped). The words next to a number in the
// reply must be the words next to it in the facts, or at least must not be the
// words next to a DIFFERENT number of the same unit.

const TONE = [
  'Pitch steadiness inside held notes (without vibrato): 3.1¢ of wander in the middle note.',
  'Vibrato is on 70% of notes held 0.4 s or longer, at about 5.4 Hz and 27¢ wide.',
  'Loudness range is 12 dB between the quietest and loudest tenth of notes; neighbouring notes differ by 1.8 dB.',
  'Tone clarity reads 88.0 out of 100 (lower can mean breathy or rough).',
  'Brightness: the sound\'s centre sits around the 3.5th harmonic.',
  '78% of notes arrive in tune within 60 ms; the median note takes 90 ms to settle.',
];
const HABIT = ['Across 3 takes: D3 runs 14¢ sharp (spread ±2¢, 12 times); A3 runs 12¢ flat (spread ±2¢, 8 times).'];
const SUMMARY = ['"Bach prelude" (Oct 19): 24 notes heard, 9¢ off pitch on average, 80% of notes within 10¢.'];
const run = (reply, facts, takeCount = 1) => checkReply(reply, facts, '', { takeCount });

describe('a number is used for what the facts say it is', () => {
  test.each([
    ['Vibrato is on 88% of notes.', TONE],
    ['Vibrato is on 78% of notes held 0.4 s or longer.', TONE],
    ['Tone clarity reads 88%.', TONE],
    ['Neighbouring notes differ by 12 dB.', TONE],
    ['The loudness range is 1.8 dB.', TONE],
    ['The median note takes 60 ms to settle.', TONE],
    ['Your notes arrive in tune within 90 ms.', TONE],
    ['Across the take, D3 runs 2¢ sharp with a spread of ±14¢.', HABIT],
    ['A3 runs 14¢ flat.', HABIT],
    ['D3 runs 12¢ flat.', HABIT],
    ['Your pitch was 10¢ off on average.', SUMMARY],
  ])('rejects %s', (reply, facts) => {
    const v = run(reply, facts);
    expect(v.ok, reply).toBe(false);
  });

  test.each([
    ['Vibrato is on 70% of notes held 0.4 s or longer.', TONE],
    ['The vibrato is 27¢ wide at about 5.4 Hz.', TONE],
    ['Tone clarity reads 88 out of 100.', TONE],
    ['The loudness range is 12 dB, and neighbouring notes differ by 1.8 dB.', TONE],
    ['Neighbouring notes differ by 1.8 dB.', TONE],
    ['The step between neighbouring notes is 1.8 dB.', TONE],
    ['Your dynamics span 12 dB from quietest to loudest.', TONE],
    ['The median note takes 90 ms to settle.', TONE],
    ['78% of notes arrive in tune within 60 ms.', TONE],
    ['D3 runs 14¢ sharp, with a spread of ±2¢.', HABIT],
    ['A3 runs 12¢ flat over 8 times.', HABIT],
    ['Your pitch was 9¢ off on average, and 80% of notes were within 10¢.', SUMMARY],
    ['80% of your notes were within 10¢.', SUMMARY],
  ])('accepts the honest twin %s', (reply, facts) => {
    const v = run(reply, facts);
    expect(v.ok, `${reply} -> ${v.problems.map((p) => `${p.kind}:${p.text}`)}`).toBe(true);
  });

  // what this does not see, said where it can be found: two numbers composed
  // into one claim whose words carry no label of their own ("80% of notes were
  // 9¢ off" takes the 80 from "within 10¢" and the 9 from the average).
  test('a composition of two true numbers into one false claim is a known gap', () => {
    expect(run('80% of notes were 9¢ off.', SUMMARY).ok).toBe(true);
  });

  test('"88 out of 100" is no longer a percentage said another way', () => {
    expect(run('Tone clarity reads 88 out of 100.', TONE).ok).toBe(true);
    expect(run('88% of notes have vibrato.', TONE).ok).toBe(false);
  });
});
