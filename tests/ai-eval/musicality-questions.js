// Questions about HOW A TAKE IS SHAPED, added when the musicality measurements
// were wired into the router (src/analysis/musicality.js).
//
// Honest status: these were written by the person wiring the intent, AFTER
// reading the new router pattern, so they are a DEVELOPMENT set. They show the
// wiring does what it was built to do and that the old refusals still refuse;
// they say nothing about phrasings nobody thought of. The first-run result
// before any router change is in the commit message.

import { LIBRARIES } from './fixtures.js';

const cases = [];
const c = (lib, q, spec = {}) => cases.push({ lib, q, scope: 'answer', ...spec });
const unm = (lib, q) => c(lib, q, { scope: 'unmeasurable' });

const SHAPE = /reads as|Not measured|phrase|detached|connected|could not be measured/;
const CAVEAT = /not a judgement of taste/;

c('phrased', 'how is my phrasing', { i: ['musicality'], t: [2], must: [SHAPE, CAVEAT, /"Bach prelude"/], not: [/off pitch on average/] });
c('phrased', 'does it sound musical', { i: ['musicality'], t: [2], must: [SHAPE, CAVEAT], not: [/Vibrato is on/, /off pitch on average/] });
c('phrased', 'am I playing with feeling', { i: ['musicality'], t: [2], must: [SHAPE, CAVEAT] });
c('phrased', 'is it too flat or mechanical', { i: ['musicality'], t: [2], must: [SHAPE, CAVEAT], not: [/runs \d+¢ (sharp|flat)/] });
c('phrased', 'how is my articulation', { i: ['musicality'], t: [2], must: [/detached|connected|articulation|legato/i, CAVEAT] });
c('phrased', 'am I playing legato or staccato', { i: ['musicality'], t: [2], must: [/separated|detached|connected|legato/i] });
c('phrased', 'how is the shaping of my last phrases', { i: ['musicality'], t: [2], must: [SHAPE] });
c('phrased', 'do I use rubato', { i: ['musicality'], t: [2], must: [SHAPE, /tempo/] });
// a comparison that names shaping gets the shaping comparison, with both takes
c('phrased', 'compare my phrasing with last time', { i: ['compare', 'musicality'], t: [2, 1], must: [/more detached|more connected|phrase|loudness/i, CAVEAT] });
// a plain comparison folds the largest shaping differences in, behind the pitch ones
c('phrased', 'compare my last two bach takes', { i: ['compare'], t: [2, 1], must: [/Average pitch error/, /more detached|more connected|phrases|loudness|tempo/i] });
// shaping not read for the take: said plainly, not guessed
c('phrased', 'how is the phrasing in my scales', { i: ['musicality'], t: [3], must: [/could not be measured/] });
// a plain pitch question is untouched
c('phrased', 'how was my last take', { i: ['summary'], t: [2], must: [/9¢ off pitch on average/], not: [CAVEAT, /phrase/] });
c('phrased', 'how is my vibrato', { i: ['tone'], t: [2], not: [CAVEAT] });
c('phrased', 'do I rush', { i: ['tempo'], t: [2], not: [CAVEAT] });
c('phrased', 'am I flat on the D', { i: ['habits'], t: [2], not: [CAVEAT] });
// still refused: a verdict on taste or on the player, not a description of the shaping
unm('phrased', 'am I musical');
unm('phrased', 'is my phrasing expressive');
unm('phrased', 'is my interpretation of the Bach right');
unm('phrased', 'is my playing emotional');
unm('phrased', 'do I have talent');
unm('phrased', 'is it beautiful');

export const MUSICALITY_QUESTIONS = cases.map((q, n) => ({ n: n + 1, ...q, library: LIBRARIES[q.lib] }));
