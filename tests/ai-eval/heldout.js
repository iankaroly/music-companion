// A SECOND set, written AFTER the router had been fitted to questions.js, and
// run once before anything was changed in response to it.
//
// questions.js was the development set: the router was written looking at its
// failures, so its score says the rules can express those 148 questions and
// nothing about the 149th. These are phrasings written afterwards, by hand,
// with different words, to find out how far the rules reach. Its first-run
// number is recorded in the commit message and in docs/ai-eval.md; later fixes
// to what it exposed are listed in the commit message as fixes, not as a score.

import { LIBRARIES } from './fixtures.js';

const cases = [];
const c = (lib, q, spec = {}) => cases.push({ lib, q, scope: 'answer', ...spec });
const off = (lib, q) => c(lib, q, { scope: 'offtopic' });
const unm = (lib, q) => c(lib, q, { scope: 'unmeasurable' });
const nf = (lib, q) => c(lib, q, { scope: 'notfound' });

const BACH_NOW = /"Bach prelude" \([^)]*\): 24 notes heard, 9¢ off pitch on average/;
const CMP_BACH = /9¢, "Bach prelude, [^"]+" 22¢, so "Bach prelude, [^"]+" is 13¢ closer to pitch/;

c('three', 'give me the numbers on my latest recording', { i: ['summary'], t: [2], must: [BACH_NOW] });
c('three', 'whats my pitch accuracy like', { i: ['summary'], t: [2], must: [BACH_NOW] });
c('three', 'how off was the scales run', { i: ['summary'], t: [3], must: [/5¢ off pitch/] });
c('three', 'was the prelude any good', { i: ['summary'], t: [2], must: [BACH_NOW] });
c('three', 'is the newest bach take cleaner than the older one', { i: ['compare'], t: [2, 1], must: [CMP_BACH] });
c('three', 'did the second prelude go better than the first', { i: ['compare'], t: [2, 1], must: [CMP_BACH] });
c('three', 'bach: this time vs last time', { i: ['compare'], t: [2, 1], must: [CMP_BACH] });
c('three', 'which pitches give me the most trouble', { i: ['worst'], t: [2], must: [/no score attached/] });
c('three', 'what should I fix first', { i: ['worst'], t: [2], must: [/no score attached/] });
c('three', 'am I playing out of tune anywhere in particular', { i: ['worst'], t: [2], must: [/no score attached/] });
c('three', 'do my notes drift sharp', { i: ['habits'], t: [2], must: [/runs 12¢ sharp/] });
c('three', 'am I dragging', { i: ['tempo'], t: [2], must: [/No steady pulse/] });
c('three', 'is my playing even', { i: ['tempo'], t: [2], must: [/No steady pulse/] });
c('three', 'how consistent have I been lately', { i: ['trend'], t: [2], must: [/Practised on 3 of the last 7 days/] });
c('three', 'have I practised this month', { i: ['trend'], t: [2], must: [/Practised on 3 of the last 7 days/] });
c('three', 'is the sound rough', { i: ['tone'], t: [2], must: [/could not be measured/] });

off('three', 'who is the best cellist alive');
off('three', 'what should I eat for dinner');
off('three', 'can you recommend a good movie');
off('three', 'how tall is mount everest');
off('three', 'write a python function that sorts a list');
off('three', 'what is the meaning of life');
off('three', 'tell me about your day');
off('one', 'what is the square root of 144');

unm('three', 'is my sound lovely');
unm('three', 'does my playing move people');
unm('three', 'do I have talent');
unm('three', 'is my bowing smooth');
unm('three', 'are my fingerings right');
unm('toned', 'is my vibrato emotional');
unm('three', 'am I as good as Yo-Yo Ma');
unm('three', 'is my breathing okay');

nf('three', 'how did the Mozart go');
nf('three', 'play back my Ravel take');
nf('three', 'compare my Haydn with last time');
nf('many', 'how is my Saint-Saens');
nf('three', 'my take from last friday');

c('empty', 'summary please', { scope: 'nodata', must: [/no saved takes/] });
c('empty', 'what are my habits', { scope: 'nodata', must: [/no saved takes/] });
c('silent', 'which notes are worst', { scope: 'nodata', must: [/no saved takes with measured notes/] });

c('scored', 'which measures need work', { i: ['worst'], t: [2], must: [/bar 3 \(32¢/] });
c('scored', 'did I get tighter with the beat since last time', { i: ['compare'], t: [2, 1], must: [/22 ms tighter/] });
c('habit', 'are there notes I always miss', { i: ['habits'], t: [3], must: [/D3 runs 14¢ sharp/] });
c('many', 'show me how the bach prelude has changed', { i: ['compare'], t: [4, 3], must: [/8¢, "Bach prelude, [^"]+" 12¢/] });
c('many', 'how did kol nidrei go', { i: ['summary'], t: [8], must: [/10¢ off pitch/] });
c('toned', 'how wide is my vibrato', { i: ['tone'], t: [2], must: [/27¢ wide/] });
c('toned', 'is my timing getting better', { i: ['trend'], t: [2], must: [/Practised on 3 of the last 7 days/] });
c('unnamed', 'what about this morning', { i: ['summary'], t: [3], must: [/7¢ off pitch/] });

export const HELDOUT = cases.map((q, n) => ({ n: n + 1, ...q, library: LIBRARIES[q.lib] }));
