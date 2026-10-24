import { describe, test, expect } from 'vitest';
import { checkReply } from '../src/ai/guard.js';

// Verdicts with no digit in them. "Your intonation is solid" has nothing for the
// number rules to read and no direction word for the direction rules, and the
// taste check knew "good", "great" and "fine" but not "solid", "accurate" or
// "clean". A skeptic's replies of this kind got through. The rule: an evaluative
// predicate (is / was / sounds / came out + an adjective, a "too X", "nailed
// it", "no problems") is rejected unless the FACTS say it, and for "X is ADJ"
// the facts must say ADJ in a sentence that is about X. "Your vocal range is
// wide" must not ride on "27¢ wide" (that is the vibrato), and "your playing was
// in tune" must not ride on "notes arrive in tune within 60 ms".

const SUMMARY = [
  '"Bach prelude" (Oct 19): 24 notes heard, 9¢ off pitch on average, 80% of notes within 10¢.',
  'The note furthest from pitch was D3, 14¢ sharp on average over 6 times.',
];
const TONE = [
  'Pitch steadiness inside held notes (without vibrato): 3.1¢ of wander in the middle note.',
  'Vibrato is on 70% of notes held 0.4 s or longer, at about 5.4 Hz and 27¢ wide.',
  'Loudness range is 12 dB between the quietest and loudest tenth of notes; neighbouring notes differ by 1.8 dB.',
  'Tone clarity reads 88.0 out of 100 (lower can mean breathy or rough).',
  'Brightness: the sound\'s centre sits around the 3.5th harmonic.',
  '78% of notes arrive in tune within 60 ms; the median note takes 90 ms to settle.',
];
const run = (reply, facts) => checkReply(reply, facts, '', { takeCount: 1 });

describe('a digit-free verdict is rejected', () => {
  // the nine the skeptic wrote
  const SKEPTIC = [
    'Your intonation is solid.',
    'Your pitch is accurate.',
    'No problems here.',
    'You nailed it.',
    'Your tone is warm.',
    'You are making steady progress.',
    'Your vibrato is too fast.',
    'Your playing was in tune.',
    'Your vocal range is wide.',
  ];
  // written after the rule, to see whether it is the rule or the nine
  const UNSEEN = [
    'Your tuning came out clean.',
    'Your pitch looks solid.',
    'That take sounded accurate.',
    'It was spot on.',
    'Your rhythm is reliable.',
    'You played it accurately.',
    'Your intonation is pretty consistent.',
    'There are no issues with your tuning.',
    'Your timing is tight.',
    'Your sound is full and rich.',
    'Your vibrato is too slow.',
    'You have clean intonation.',
    'Everything is in tune.',
    'You are on the right track.',
    'Your tone is not warm.',
  ];
  test.each([...SKEPTIC, ...UNSEEN])('%s', (reply) => {
    for (const facts of [SUMMARY, [...SUMMARY, ...TONE]]) expect(run(reply, facts).ok, reply).toBe(false);
  });

  test('the reason names a verdict, not a number', () => {
    const v = run('Your intonation is solid.', SUMMARY);
    expect(v.problems[0].kind).toBe('verdict');
  });
});

describe('the honest twin is still accepted', () => {
  const HONEST = [
    ['Your vibrato is 27¢ wide at about 5.4 Hz.', TONE],
    ['Vibrato is on 70% of notes, at about 5.4 Hz and 27¢ wide.', TONE],
    ['78% of notes arrive in tune within 60 ms.', TONE],
    ['78% of your notes are in tune within 60 ms.', TONE],
    ['The pitch was 9¢ off on average, with 80% of notes within 10¢.', SUMMARY],
    ['The furthest note was D3, 14¢ sharp.', SUMMARY],
    ['The tone clarity reads 88 out of 100.', TONE],
    ['The brightness sits around the 3.5th harmonic.', TONE],
    ['Your vibrato is wide: 27¢.', TONE],
    ['Loudness range is 12 dB.', TONE],
    ['Pitch steadiness inside held notes is 3.1¢ of wander.', TONE],
    ['Your take was 9¢ off pitch on average.', SUMMARY],
    ['The take is off pitch by 9¢ on average.', SUMMARY],
    // a word being asked about is not a word being asserted (found on the saved
    // real replies: "so I cannot say whether your playing is even")
    ['No steady pulse was found, so I cannot say whether your playing is even.', SUMMARY],
    ['I cannot tell if your vibrato is wide.', SUMMARY],
  ];
  test.each(HONEST)('%s', (reply, facts) => {
    const v = run(reply, facts);
    expect(v.ok, `${reply} -> ${v.problems.map((p) => `${p.kind}:${p.text}`)}`).toBe(true);
  });

  test('a word the facts themselves use is allowed about the thing the facts use it for', () => {
    expect(run('Your vibrato is wide.', TONE).ok).toBe(true);
    expect(run('Your tone is breathy.', TONE).ok).toBe(false); // "breathy" is in a caveat about what a low clarity can mean
    expect(run('Your vocal range is wide.', TONE).ok).toBe(false);
  });
});
