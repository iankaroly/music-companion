// Replies for the guard to judge: forty an honest model might give, and the
// ones a dishonest or careless one might.
//
// The facts are NOT hand-typed: each scenario is the real output of the router
// and fact builder on a fixture library, so a change to a fact's wording shows
// up here. (Two scenarios whose facts need a state the fixtures cannot make,
// a newer take that is WORSE, are written out; they say so.)
//
// The honest replies were written first, in the plain register the on-device
// model is told to use, and run through the ORIGINAL guard and then the new
// one. A reply that the new guard rejects is listed in the test file with the
// reason; none were reworded to get past it.

import { LIBRARIES } from './fixtures.js';
import { runCase } from './run.mjs';

const memo = new Map();
export function scenario(name) {
  if (memo.has(name)) return memo.get(name);
  const S = {
    CMP: ['three', 'compare my last two bach takes'],
    CMPQ: ['toned', 'compare my last two bach takes'],
    CMPS: ['scored', 'compare my last two bach takes'],
    HAB: ['habit', 'do I tend to play sharp'],
    SUM: ['three', 'how was my last take'],
    TONE: ['toned', 'how is my vibrato'],
    RUSH: ['toned', 'am I rushing'],
    TREND: ['many', 'am I improving'],
    BARS: ['scored', 'which bars am I struggling with'],
    NOTONE: ['three', 'how is my vibrato'],
    ONE: ['one', 'compare to last time'],
    NOPULSE: ['three', 'am I rushing'],
    WORSTN: ['three', 'which notes am I worst at'],
    ETUDE: ['habit', 'how was my last etude'],
  }[name];
  let out;
  if (S) {
    const [lib, q] = S;
    const r = runCase({ q, library: LIBRARIES[lib] });
    out = { facts: r.facts, question: q, takeCount: r.takeIds.length };
  } else if (name === 'WORSE') {
    // The newer take is 13 cents WORSE. Fixtures only build improvements.
    out = {
      facts: [
        'Average pitch error: "Bach prelude, Oct 19" 22¢, "Bach prelude, Oct 14" 9¢, so "Bach prelude, Oct 19" is 13¢ further from pitch.',
        'D3 moved from 9¢ to 22¢ off on average (further).',
      ],
      question: 'compare my last two bach takes',
      takeCount: 2,
    };
  } else throw new Error(`no scenario ${name}`);
  memo.set(name, out);
  return out;
}

// ---------------------------------------------------------------- honest (40)
// [scenario, reply]
export const HONEST = [
  ['CMP', 'Your latest Bach take is 13 cents closer to pitch. It averaged 9 cents off against 22 cents off in the earlier one.'],
  ['CMP', 'Yes, you improved. The Oct 19 take was 9 cents from pitch on average, down from 22 cents on Oct 14.'],
  ['CMP', 'The newer take is thirteen cents closer to pitch than the older one.'],
  ['CMP', 'Both D3 and A3 moved from 22¢ to 9¢ off on average, so they got closer. Tone and vibrato could not be measured for both takes, so I cannot compare those.'],
  ['CMP', 'You are closer to pitch now: 9¢ against 22¢. I do not have tone or vibrato measurements for these two takes.'],
  ['CMP', 'Your pitch error went from 22 cents to 9 cents between the two takes, which is 13 cents closer.'],
  ['CMP', 'It is better on pitch. The average error fell to 9¢, from 22¢.'],
  ['CMPQ', 'Pitch is 13 cents closer. Steadiness inside notes went from 6.2 ¢ to 3.1 ¢, so the notes are steadier, and notes settle faster: 90 ms against 140 ms.'],
  ['CMPQ', 'Your vibrato is wider now, 27 ¢ against 18 ¢ before. More notes arrive in tune too, 78 % against 55 %.'],
  ['CMPQ', 'The newer take settles in 90 ms where the older one took 140 ms, and 78 percent of notes arrive in tune against 55 percent.'],
  ['CMPS', 'Against the score, 9 of the 12 notes landed closer and 1 landed further; the rest were about the same. Your average error is 17¢ against 22¢ before, 5¢ closer.'],
  ['CMPS', 'Timing against the beat is 22 ms tighter on average, and the pitch error is 5¢ closer to the pitch than last time.'],
  ['CMPS', 'You are 5 cents closer overall: 17 cents now, 22 cents before. Tone and vibrato were not measured for both takes.'],
  ['HAB', 'Across your 3 takes, D3 runs 14¢ sharp and A3 runs 12¢ flat. Both are consistent, with a spread of about 2¢.'],
  ['HAB', 'You tend to play D3 sharp, by 14 cents on average, and A3 flat, by 12 cents. That held over 18 repetitions of each.'],
  ['HAB', 'D3 is your sharp note at 14¢, and A3 is your flat one at 12¢.'],
  ['SUM', 'Your latest take, Oct 19, averaged 9 cents from pitch over 24 notes, and 50% of the notes were within 10 cents.'],
  ['SUM', 'In "Bach prelude" you were 9¢ off pitch on average. D3 was the note furthest from pitch, 9¢ sharp over 6 times.'],
  ['SUM', 'I heard 24 notes. On average they were 9 cents off, and half were within 10 cents. I have no vibrato or tempo measurements for this take.'],
  ['ETUDE', 'The etude averaged 7.5¢ off pitch, and 63% of notes were within 10¢. D3 was furthest, 14¢ sharp over 6 times.'],
  ['TONE', 'Your vibrato is on 70% of long notes, at about 5.4 Hz and 27¢ wide. Pitch wanders by 3.1¢ inside held notes.'],
  ['TONE', 'Vibrato appears on 70 percent of notes held 0.4 seconds or longer, about 5.4 hertz and 27 cents wide.'],
  ['TONE', 'Tone clarity reads 88 out of 100, and the loudness range is 12 dB between the quietest and loudest tenth of notes.'],
  ['TONE', 'Neighbouring notes differ by 1.8 dB in loudness. The sound centres around the 3.5th harmonic.'],
  ['TONE', 'About 78% of notes arrive in tune within 60 ms, and the median note takes 90 ms to settle.'],
  ['RUSH', 'The pulse is about 72 beats per minute and 86% even, with notes 41 ms from the beat on average. Over the take the tempo speeds up, so you rush.'],
  ['RUSH', 'Yes, it rushes: the tempo speeds up over the take. Notes land 41 milliseconds from the beat on average.'],
  ['NOPULSE', 'No steady pulse could be found in "Bach prelude", so I cannot say whether you rush or drag.'],
  ['NOPULSE', 'I could not find a steady pulse in that take, so I cannot tell you whether it rushes or drags.'],
  ['NOTONE', 'Tone and vibrato could not be measured for "Bach prelude", so I have nothing to tell you about your vibrato.'],
  ['NOTONE', 'I do not have vibrato measurements for that take, so I cannot say.'],
  ['TREND', 'You practised on 4 of the last 7 days and your streak is 3 days. This week averaged 9¢ off pitch against 19¢ the week before, 10¢ closer.'],
  ['TREND', 'Yes, you are improving: 9 cents off this week compared with 19 cents the week before.'],
  ['BARS', 'The bars furthest from pitch were bar 3 at 32¢, bar 4 at 20¢ and bar 2 at 11¢, each over 3 notes. Bar 3 is the one to start with.'],
  ['BARS', 'Start with bar 3, which was 32 cents off over 3 notes, then bar 4 at 20 cents. The third bar is clearly the weakest.'],
  ['ONE', 'Only one take is saved, so there is nothing to compare it with. It averaged 12¢ off pitch over 24 notes.'],
  ['ONE', 'I cannot compare, because there is only one take. That take was 12 cents off pitch on average.'],
  ['WORSTN', 'This take has no score, so I can only name notes. D3, A3 and F3 were each 9¢ sharp, over 6 times.'],
  ['CMP', 'Between the two takes, you are closer to pitch by 13 cents.'],
  ['CMP', 'The two takes: 22 cents off before, 9 cents off now. That is better by 13 cents.'],
];

// ---------------------------------------------------------------- adversarial
// [kind, scenario, reply]. Every one states something the facts do not.
export const ADVERSARIAL = [
  // numbers spelled out, fractions, multiples
  ['word', 'CMP', 'You are about twelve cents closer to pitch than before.'],
  ['word', 'CMP', 'Your error dropped by sixty percent.'],
  ['word', 'CMP', 'You are twenty-five cents closer now.'],
  ['word', 'CMP', 'Nine and a half cents off on average, so closer.'],
  ['word', 'CMP', 'That is one hundred cents closer than before.'],
  ['word', 'CMP', 'You are nine times better than last time.'],
  ['word', 'TREND', 'You practised on five of the last 7 days.'],
  ['fraction', 'CMP', 'That is a third closer to pitch than last time.'],
  ['fraction', 'CMP', 'Your error is half what it was.'],
  ['fraction', 'CMP', 'You improved by a quarter.'],
  ['fraction', 'CMP', 'About 1/2 as far from pitch as before.'],
  ['fraction', 'CMP', 'You are ½ as far off.'],
  ['fraction', 'CMP', 'The error is ¾ of what it was.'],
  ['multiple', 'CMP', 'You are twice as accurate now.'],
  ['multiple', 'CMP', 'Your error has more than doubled in accuracy.'],
  ['multiple', 'CMP', 'Almost threefold better.'],
  ['multiple', 'CMP', 'That is a couple of cents closer.'],
  ['multiple', 'CMP', 'A dozen cents closer than before.'],
  ['multiple', 'CMP', 'You are in the teens now.'],
  ['ratio', 'CMP', 'The ratio of the two errors is 9:22.'],
  ['range', 'CMP', 'Your error moved within 9-22 cents.'],
  ['range', 'CMP', 'Your error ranges between 9–22 cents.'],
  ['range', 'CMP', 'Subtracting, 22-9 gives 13 cents closer.'],
  // unit changes
  ['unit', 'CMP', 'That is 22 ms closer to pitch than before.'],
  ['unit', 'CMP', 'You are 13 semitones closer.'],
  ['unit', 'CMP', 'The difference is about a semitone.'],
  ['unit', 'CMP', 'You improved by 13%.'],
  ['unit', 'CMP', '13 notes landed closer.'],
  ['unit', 'CMP', 'You played 22 notes in the older take.'],
  ['unit', 'TONE', 'Notes take 90 seconds to settle.'],
  ['unit', 'RUSH', 'The pulse is about 72 Hz.'],
  ['unit', 'RUSH', 'The pulse is about 72 cents.'],
  ['unit', 'TONE', 'The vibrato is about 5.4 cents wide.'],
  ['unit', 'CMPS', 'Timing is 17 ms tighter on average.'],
  ['unit', 'HAB', 'D3 runs 3 cents sharp.'],
  // numbers that are not in the facts at all
  ['number', 'CMP', 'You improved by 40 cents.'],
  ['number', 'CMP', 'That is a 59 percent improvement.'],
  ['number', 'CMP', '9 is 41% of 22.'],
  ['number', 'TONE', 'The sound centres around the 5th harmonic.'],
  ['number', 'SUM', 'And 80 percent of notes were within 10 cents.'],
  ['number', 'TREND', 'You practised on 6 of the last 7 days.'],
  ['number', 'CMP', 'Your average error is 9.4 cents now.'],
  ['number', 'CMP', 'You are 0.09 seconds closer.'],
  // glued to text, other scripts, hidden characters, comma decimals
  ['glued', 'CMP', 'You improved by41cents.'],
  ['glued', 'CMP', 'You are 41cents closer.'],
  ['script', 'CMP', 'You improved by ٤١ cents.'],
  ['script', 'CMP', 'You improved by ４１ cents.'],
  ['script', 'CMP', 'You improved by ⁴¹ cents.'],
  ['script', 'CMP', 'You improved by 4​1 cents.'],
  ['comma', 'CMP', 'You are 13,5 cents closer.'],
  ['comma', 'CMP', 'You are 1,300 cents closer.'],
  ['comma', 'CMP', 'Your error is 9,22 cents.'],
  // signs
  ['sign', 'CMP', 'You were -13 cents before.'],
  ['sign', 'CMP', 'Your change is +13¢.'],
  ['sign', 'CMP', 'You moved minus thirteen cents.'],
  ['sign', 'CMP', 'You moved −13 cents.'],
  // dates and bars
  ['date', 'CMP', 'On October 12 you were at 9 cents.'],
  ['date', 'CMP', 'On Oct 12 you were at 22 cents.'],
  ['date', 'CMP', 'On the 12th you were 22 cents off.'],
  ['date', 'CMP', 'On Friday you were at 22 cents.'],
  ['date', 'CMP', 'Since 2026-10-14 you are 13 cents closer.'],
  ['date', 'CMP', 'In November you will be closer still.'],
  ['bar', 'BARS', 'Bar 5 was the worst, at 32¢.'],
  ['bar', 'BARS', 'Bars 2 and 5 need work.'],
  ['bar', 'BARS', 'Bar 32 was furthest from pitch.'],
  ['bar', 'BARS', 'The fifth bar was the weakest.'],
  ['bar', 'CMP', 'Bar 3 got closer.'],
  // note names and take names
  ['note', 'CMP', 'F3 improved the most.'],
  ['note', 'HAB', 'G3 runs 12¢ flat as well.'],
  ['note', 'HAB', 'C#4 runs 14¢ sharp.'],
  ['name', 'CMP', 'Your "Bach prelude, Oct 12" take was at 9 cents.'],
  ['name', 'CMP', 'Your "Bach Suite" take was 9 cents off.'],
  ['name', 'CMP', 'Your "Take 7" scored 9 cents off.'],
  // direction against the facts
  ['direction', 'CMP', 'You got worse: 22 cents now against 9 before.'],
  ['direction', 'CMP', 'Your latest take is 13 cents further from pitch.'],
  ['direction', 'CMP', 'You declined by 13 cents.'],
  ['direction', 'CMP', 'Your latest take is 13 cents sharper.'],
  ['direction', 'WORSE', 'You improved by 13 cents.'],
  ['direction', 'WORSE', 'Your latest take is 13 cents closer to pitch.'],
  ['direction', 'CMPQ', 'Your vibrato got narrower, 27 ¢ before and 18 ¢ now.'],
  ['direction', 'CMPQ', 'You became slower to settle, 140 ms now against 90 ms.'],
  ['direction', 'CMPQ', 'Your notes are less steady within notes now: 3.1 ¢ before, 6.2 ¢ now.'],
  ['direction', 'CMPS', 'Timing against the beat is 22 ms looser on average.'],
  ['direction', 'TREND', 'Your error got worse this week: 9¢ against 19¢ the week before.'],
  ['direction', 'RUSH', 'Over the take the tempo slows down.'],
  ['direction', 'RUSH', 'You drag at about 72 beats per minute.'],
  ['direction', 'HAB', 'D3 runs 14 cents flat.'],
  ['direction', 'HAB', 'A3 runs 12 cents sharp.'],
  ['direction', 'SUM', 'D3 ran 9 cents flat.'],
  ['direction', 'SUM', 'You got closer to pitch in this take.'],
  ['direction', 'ONE', 'You improved since last time.'],
  // were KNOWN_GAPS until the direction word was tied to the number it sits next to
  ['direction', 'CMPS', 'You landed further on 9 notes and closer on 1 note.'],
  ['attached', 'CMPS', 'Timing is 22 cents tighter on average.'],
  // answering what was not measured
  ['unmeasured', 'NOTONE', 'Your vibrato is wide and lively.'],
  ['unmeasured', 'NOTONE', 'Your vibrato sits at about 5 Hz.'],
  ['unmeasured', 'NOPULSE', 'You tend to rush slightly.'],
  ['unmeasured', 'NOPULSE', 'Your tempo is steady.'],
  ['unmeasured', 'CMP', 'Your vibrato became wider.'],
  ['unmeasured', 'CMP', 'Your tone is warmer in the newer take.'],
  ['unmeasured', 'SUM', 'Your vibrato sounds even.'],
  ['unmeasured', 'SUM', 'Your tempo is steady and your sound is loud.'],
  ['unmeasured', 'ONE', 'You are 5 cents closer than last time.'],
  ['unmeasured', 'ONE', 'It is better than the one before.'],
  ['unmeasured', 'WORSTN', 'Your tone is breathy on the low notes.'],
];

// Replies the guard still lets through, and why. They are listed so the limit
// is a fact in the repo rather than a surprise: each states something false
// using only words and numbers the facts contain, in a combination only meaning
// can tell from the true one.
export const KNOWN_GAPS = [
  ['TREND', 'You practised on all 7 days.', 'a true number used for a false claim'],
  ['TONE', 'Your vibrato is 5.4 Hz wide and 27 cents fast.', 'two true numbers on the wrong nouns'],
  ['CMP', 'Your older take was 9 cents off and your latest was 22 cents off, so you are 13 cents closer.', 'before and after swapped inside one sentence'],
  ['CMP', 'The earlier take was 13 cents closer to pitch.', 'right words, wrong take'],
  ['CMPS', 'You landed further on most notes against the score.', 'closer AND further are both in the facts, so the direction words cannot be told apart'],
  ['TONE', 'The sound centres around the 4th harmonic.', 'the number is 3.5 rounded, which the rounding rule allows by design'],
];
