// Replies built to say something false using numbers that ARE in the facts,
// paired with the wrong thing: a note's figure given as the take's, a cents
// error read as a count, two bars' figures swapped, "the whole take" called
// sharp. Ten scenarios (tests/ai-pairing-fixtures.mjs), four or five lies each.
//
// WRITTEN BEFORE ANY OF THE CODE THAT CATCHES THEM, from the facts printed by
// tools/ai-model/show-scenarios.mjs and nothing else. `held: true` lies are the
// sealed half: they were not looked at again while the guard was being written,
// and the report quotes their catch rate separately from the others.
//
// `honest` are true replies in the same scenarios that must still pass.

export const LIES = [
  // etude: avg 8.5, 75% within, D3 23 sharp over 6
  { s: 'etude', n: 'note-as-take', t: 'Your last take was 23¢ sharp on average over 6 times.' },
  { s: 'etude', n: 'cents-as-count', t: 'Nine of the 24 notes were within 10 cents.' },
  { s: 'etude', n: 'take-sharp', t: 'The whole take was sharp. D3 was the furthest note.', held: true },
  { s: 'etude', n: 'swap-units', t: 'You were 75¢ off pitch on average, and 8.5% of notes were within 10¢.', held: true },
  { s: 'etude', n: 'note-as-take', t: 'On average your take was 23¢ off pitch.', held: true },

  // collision: avg 9, 50% within, D3 9 sharp over 6 (the digits collide on purpose)
  { s: 'collision', n: 'note-as-take', t: 'Your last take was 9¢ sharp on average over 6 times.' },
  { s: 'collision', n: 'cents-as-count', t: 'Nine of the 24 notes were within 10 cents.' },
  { s: 'collision', n: 'take-sharp', t: 'The whole take was 9¢ sharp.', held: true },
  { s: 'collision', n: 'take-as-note', t: 'D3 was the furthest note, and 50% of D3\'s notes were within 10¢.', held: true },

  // flat: avg 13.3, 25% within, D3 19 flat over 6
  { s: 'flat', n: 'note-as-take', t: 'Your take was 19¢ flat on average.' },
  { s: 'flat', n: 'take-sharp', t: 'Your take averaged 13.3¢ flat.' },
  { s: 'flat', n: 'take-as-note', t: 'D3 was 13.3¢ off on average over 6 times.', held: true },
  { s: 'flat', n: 'cents-as-count', t: 'Nineteen of the 24 notes were within 10 cents.', held: true },

  // scored: bar 3 31¢, bar 4 19¢, bar 2 14¢, three notes each
  { s: 'scored', n: 'swap-bars', t: 'Bar 3 was 14¢ off over 3 notes, and bar 2 was 31¢ off.' },
  { s: 'scored', n: 'swap-bars', t: 'Bar 4 was 31¢ off over 3 notes.' },
  { s: 'scored', n: 'swap-bars', t: 'Bar 2 averaged 31¢ off over 3 notes, bar 3 averaged 14¢.' },
  { s: 'scored', n: 'swap-bars', t: 'The furthest bars were bar 2 (31¢), bar 3 (19¢) and bar 4 (14¢).', held: true },
  { s: 'scored', n: 'swap-bars', t: 'Bar 3 was 31¢ off, and bar 4 was 14¢ off, bar 2 was 19¢.', held: true },

  // nobars: D3 19 sharp, F3 10 sharp, G3 6 sharp, six times each
  { s: 'nobars', n: 'swap-notes', t: 'D3 was 10¢ sharp and F3 was 19¢ sharp.' },
  { s: 'nobars', n: 'swap-notes', t: 'G3 was 19¢ sharp, 6 times.' },
  { s: 'nobars', n: 'note-as-take', t: 'Your notes were 19¢ sharp on average, D3 the worst.', held: true },
  { s: 'nobars', n: 'swap-notes', t: 'D3 was 10¢ sharp over 6 times.', held: true },

  // one_pitch: D3 15 sharp over 8 times
  { s: 'one_pitch', n: 'note-as-take', t: 'Your whole take was 15¢ sharp on average over 8 times.' },
  { s: 'one_pitch', n: 'swap-units', t: 'D3 was 8¢ sharp over 15 times.' },
  { s: 'one_pitch', n: 'take-sharp', t: 'The take was sharp.', held: true },
  { s: 'one_pitch', n: 'take-sharp', t: 'Your recording ran 15¢ sharp.', held: true },

  // toned: wander 3.1¢; vibrato 70% at 5.4 Hz and 27¢ wide; range 12 dB, step 1.8 dB; clarity 88; 78% arrive in tune, 90 ms
  { s: 'toned', n: 'swap-cents', t: 'Your vibrato is 3.1¢ wide and the wander is 27¢.' },
  { s: 'toned', n: 'swap-pct', t: 'Vibrato is on 78% of notes and 70% arrive in tune within 60 ms.' },
  { s: 'toned', n: 'swap-db', t: 'The loudness range is 1.8 dB, and neighbouring notes differ by 12 dB.', held: true },
  { s: 'toned', n: 'swap-pct', t: 'The median note takes 90 ms to settle and 78% of notes have vibrato.', held: true },

  // paced: 72 bpm, 86% even, 41 ms from the beat
  { s: 'paced', n: 'swap-pct', t: 'The pulse is about 86 beats per minute and 72% even.' },
  { s: 'paced', n: 'swap-units', t: 'Your notes are 86 ms from the beat on average.' },
  { s: 'paced', n: 'swap-bpm', t: 'The pulse is 41 beats per minute, 86% even.', held: true },
  { s: 'paced', n: 'swap-ms', t: 'It is 86% even, and notes land 72 ms from the beat.', held: true },

  // clean: avg 3.5, 100% within, D3 7 sharp over 6
  { s: 'clean', n: 'note-as-take', t: 'Your last take was 7¢ sharp on average over 6 times.' },
  { s: 'clean', n: 'cents-as-count', t: 'Six of the 24 notes were within 10 cents.' },
  { s: 'clean', n: 'take-sharp', t: 'The whole take ran sharp, by 7¢.', held: true },
  { s: 'clean', n: 'swap-units', t: 'D3 was 3.5¢ off on average over 24 times.', held: true },

  // habit1: D3 14 sharp, A3 12 flat, F3 7 sharp, spread 2, six times
  { s: 'habit1', n: 'swap-notes', t: 'D3 runs 12¢ sharp and A3 runs 14¢ flat.' },
  { s: 'habit1', n: 'swap-notes', t: 'A3 runs 7¢ flat and F3 runs 12¢ sharp.' },
  { s: 'habit1', n: 'swap-notes', t: 'D3 runs 14¢ sharp (spread ±7¢, 6 times).', held: true },
  { s: 'habit1', n: 'swap-notes', t: 'F3 runs 14¢ sharp and D3 runs 7¢ sharp.', held: true },
];

// A SECOND, ADVERSARIAL BATCH, written after the guard existed and with its
// mechanisms in mind (so these are NOT blind; the first 42 are as blind as a
// writer who has already sketched the design can be). Each tries a different
// way round: a spelled-out bar number, an ordinal bar, the figure before the
// bar it belongs to, "overall", a quoted name, a plural subject, no subject.
// `miss: true` marks the ones the guard does not catch and is not expected to.
export const EVASIONS = [
  { s: 'scored', t: 'Bar three was 14¢ off over 3 notes.' },
  { s: 'scored', t: 'The third bar was 14¢ off.' },
  { s: 'scored', t: '14¢ off in bar 3, 31¢ in bar 2.' },
  { s: 'scored', t: 'The furthest bar was bar 2, at 31¢.' },
  { s: 'nobars', t: 'At 19¢ sharp, F3 was the furthest.' },
  { s: 'nobars', t: 'The sharpest note was F3 at 19¢.' },
  { s: 'etude', t: 'Overall you were 23¢ sharp on average, over 6 times.' },
  { s: 'etude', t: '"Etude" was 23¢ sharp on average.' },
  { s: 'etude', t: 'Your furthest note was off by 8.5¢ on average.' },
  { s: 'etude', t: 'D3 averaged 8.5¢ off pitch.' },
  { s: 'etude', t: 'Most of your notes were sharp.' },
  { s: 'collision', t: '9 of your 24 notes were within 10¢.' },
  { s: 'collision', t: 'Within 10 cents were 9 of the 24 notes.' },
  { s: 'collision', t: 'You played 9 cents sharp across the 24 notes.', miss: true },
  { s: 'collision', t: 'On average, 9¢ sharp over 6 times.', miss: true },
  { s: 'collision', t: 'All 24 notes were sharp.', miss: true },
];

export const HONEST = [
  { s: 'etude', t: 'Your last take was 8.5¢ off pitch on average, with 75% of notes within 10¢. The furthest note was D3, 23¢ sharp on average over 6 times.' },
  { s: 'etude', t: 'Your furthest note was D3, 23¢ sharp.' },
  { s: 'etude', t: 'About 75% of your notes were within 10¢.' },
  { s: 'collision', t: 'The take was 9¢ off pitch on average; D3 was 9¢ sharp over 6 times.' },
  { s: 'collision', t: 'Your last take was 9¢ off pitch on average, and 50% of notes were within 10¢.' },
  { s: 'flat', t: 'The note furthest from pitch was D3, 19¢ flat on average over 6 times, and the take as a whole was 13.3¢ off pitch.' },
  { s: 'scored', t: 'Bar 3 was 31¢ off over 3 notes, then bar 4 at 19¢ and bar 2 at 14¢.' },
  { s: 'scored', t: 'Bar 3 (31¢ off over 3 notes) was furthest.' },
  { s: 'nobars', t: 'D3 was 19¢ sharp, F3 10¢ sharp and G3 6¢ sharp, each over 6 times.' },
  { s: 'one_pitch', t: 'D3 was 15¢ sharp over 8 times.' },
  { s: 'toned', t: 'Vibrato is on 70% of long notes, about 5.4 Hz and 27¢ wide. The wander is 3.1¢.' },
  { s: 'paced', t: 'The pulse is about 72 beats per minute and 86% even, with notes 41 ms from the beat.' },
  { s: 'clean', t: 'Your take was 3.5¢ off pitch on average with 100% of notes within 10¢; the furthest note was D3, 7¢ sharp.' },
  { s: 'habit1', t: 'D3 runs 14¢ sharp, A3 runs 12¢ flat and F3 runs 7¢ sharp.' },
];
