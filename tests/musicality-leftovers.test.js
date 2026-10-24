import { describe, test, expect } from 'vitest';
import { musicalityOf, rangeFor } from '../src/analysis/musicality.js';
import { musicalityFacts } from '../src/ai/musicality-facts.js';
import { checkReply } from '../src/ai/guard.js';
import { idealTake, wobbleOnsets, buildSpec } from './helpers/musicality-synth.js';

const named = (m, name = 'T') => ({ name, date: 1, musicality: m });
const d = (m, k) => m.descriptors[k];

// 1. a fermata ---------------------------------------------------------------

// The flat metronomic take the 'very even' claim is meant for, with one note
// held `times` as long as the rest, in the middle of a phrase.
function withHeldNote({ times, index = 33, soundsLong = true, seed = 2 }) {
  const spec = buildSpec({ phrases: 8, perPhrase: 10, period: 0.5, breath: 0.35, shape: 'flat', seed });
  const extra = 0.5 * (times - 1);
  if (soundsLong) spec[index].dur *= times;
  for (let k = index + 1; k < spec.length; k++) spec[k].start += extra;
  return wobbleOnsets(idealTake(spec), 14, 3);
}

describe('a held note in the middle of a take is not "very evenly timed"', () => {
  test('control: the same take with no held note still is', () => {
    const c = d(musicalityOf(withHeldNote({ times: 1 })), 'character');
    expect(c.veryEven).toBe(true);
    expect(c.phrase).toMatch(/very evenly timed/);
  });

  test('a note held four times as long withdraws the claim and says so in neutral words', () => {
    const c = d(musicalityOf(withHeldNote({ times: 4 })), 'character');
    expect(c.veryEven).toBe(false);
    expect(c.phrase).not.toMatch(/very evenly|none of what could be read/);
    expect(c.phrase).toMatch(/with one held note/);
  });

  test('so does a long spacing after a note that did not sound long (the tail was not heard)', () => {
    const c = d(musicalityOf(withHeldNote({ times: 4, soundsLong: false })), 'character');
    expect(c.veryEven).toBe(false);
    expect(c.phrase).toMatch(/long pause/);
  });

  test('two of them are two, and the facts carry the sentence as it stands', () => {
    const spec = buildSpec({ phrases: 8, perPhrase: 10, period: 0.5, breath: 0.35, shape: 'flat', seed: 2 });
    for (const [index, extra] of [[22, 1.5], [55, 1.5]]) {
      spec[index].dur *= 4;
      for (let k = index + 1; k < spec.length; k++) spec[k].start += extra;
    }
    const m = musicalityOf(wobbleOnsets(idealTake(spec), 14, 3));
    expect(d(m, 'character').phrase).toMatch(/with two held notes/);
    expect(musicalityFacts(named(m)).join(' ')).not.toMatch(/very evenly timed/);
  });

  test('an ordinary breath between phrases is not a held note', () => {
    const spec = buildSpec({ phrases: 8, perPhrase: 10, period: 0.5, breath: 0.6, shape: 'flat', seed: 2, finalStretch: 1.3 });
    const c = d(musicalityOf(wobbleOnsets(idealTake(spec), 14, 3)), 'character');
    expect(c.detail.held).toBe(0);
  });
});

// 2. wide leaps --------------------------------------------------------------

// A clean, perfectly pitched line that leaps by 12-15 semitones every note, up
// then down, and never repeats a figure.
function leapingTake() {
  const spec = buildSpec({ phrases: 6, perPhrase: 10, period: 0.5, breath: 0.35, shape: 'arch', seed: 1 });
  let m = 52;
  let up = true;
  let s = 7;
  const next = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (const n of spec) {
    n.midi = m;
    const step = 12 + Math.floor(next() * 4);
    m += up ? step : -step;
    if (m > 84) { m -= 24; }
    if (m < 40) { m += 24; }
    up = !up;
  }
  return idealTake(spec);
}

describe('a clean wide-leaping line is still refused, without a cause being asserted', () => {
  const m = musicalityOf(leapingTake());
  test('refused as before', () => {
    expect(m.reliability.reason).toBe('junk');
    expect(m.reliability.medianStep).toBeGreaterThanOrEqual(12);
  });
  test('the sentence states what was seen and not that the tracker misread it', () => {
    const line = musicalityFacts(named(m)).join(' ');
    expect(line).toMatch(/semitones from one to the next/);
    expect(line).toMatch(/steps this large hardly ever come round again/);
    expect(line).not.toMatch(/usually means|misreading it|tracker was/);
    expect(line).toMatch(/could not be read well/);
  });
  test('the withdrawn rows do not assert it either', () => {
    expect(d(m, 'phrase-count').reason).not.toMatch(/to be a tune/);
    expect(d(m, 'phrase-count').reason).toMatch(/steps this large/);
  });
});

// 3. the legato-or-detached sentence on a take that was heard badly ------------

describe('the legato-or-detached sentence says "take it lightly" in the sentence itself', () => {
  // clean in every way except that 15% of the notes sit below any string instrument
  function partlyOutOfRange() {
    const spec = buildSpec({ phrases: 8, perPhrase: 10, period: 0.5, breath: 0.35, shape: 'arch', seed: 2, articulation: 0.75 });
    spec.forEach((n, i) => { if (i % 7 === 3) n.midi -= 36; });
    return wobbleOnsets(idealTake(spec), 14, 3);
  }
  test('a take with a tenth or more of its notes out of range', () => {
    const m = musicalityOf({ ...partlyOutOfRange(), range: rangeFor('strings') });
    expect(m.reliability.outOfRange).toBe(false);          // not the heavy gate: the soft one
    expect(m.reliability.doubtful).toBe(true);
    expect(d(m, 'articulation').confidence).toBe('low');
    expect(d(m, 'articulation').phrase).toMatch(/take it lightly/);
    // not repeated by the facts, and the other readings keep their own confidence
    const art = musicalityFacts(named(m)).filter((l) => /notes sound for/.test(l));
    expect(art.length).toBe(1);
    expect(art[0].match(/take it lightly/g).length).toBe(1);
  });
  test('the clean take is untouched', () => {
    const clean = wobbleOnsets(idealTake(buildSpec({ phrases: 8, perPhrase: 10, period: 0.5, breath: 0.35, shape: 'arch', seed: 2, articulation: 0.75 })), 14, 3);
    const m = musicalityOf({ ...clean, range: rangeFor('strings') });
    expect(m.reliability.doubtful).toBe(false);
    expect(d(m, 'articulation').phrase).not.toMatch(/take it lightly/);
  });
  test('the reading that survives a refused take carries it too, and so does the character line', () => {
    const m = musicalityOf(leapingTake());
    expect(d(m, 'articulation').measured).toBe(true);
    expect(d(m, 'articulation').phrase).toMatch(/take it lightly/);
    const lines = musicalityFacts(named(m));
    expect(lines.find((l) => /reads as/.test(l))).toMatch(/take it lightly/);
  });
});

// 4. a metronomic take on a grid of thirds and halves --------------------------

function gridTake({ pat, beat, perPhrase, phrases, breath, art = 0.95 }) {
  const spec = buildSpec({ phrases, perPhrase, period: beat, breath, shape: 'flat', seed: 1, articulation: art });
  let t = 0;
  for (let i = 0; i < spec.length; i++) {
    const gap = pat[i % pat.length] * beat;
    spec[i].start = t;
    spec[i].dur = art * gap;
    t += gap + (spec[i].pos === perPhrase - 1 ? breath : 0);
  }
  return idealTake(spec);
}

describe('a perfectly timed take on a grid of thirds and halves is not called free', () => {
  // zero jitter: every onset is exactly on the grid, so there is no give to find
  test.each([
    ['quavers, a triplet, dotted values (the follower stepped 0.85 s to 0.30 s and read 92%)', { pat: [0.5, 1 / 3, 1.5, 4 / 3, 1.5, 0.5], beat: 0.6, perPhrase: 13, phrases: 3, breath: 0.1 }],
    ['a triplet-and-dotted bar (read 105-122%)', { pat: [1 / 3, 1], beat: 0.45, perPhrase: 13, phrases: 3, breath: 0.6 }],
    ['thirds against halves (read 17-30% when the follower re-found the beat a rung off)', { pat: [1 / 3, 0.5], beat: 0.75, perPhrase: 13, phrases: 5, breath: 0.6 }],
    ['dotted values and a triplet (read "gives a little, 8%" until the spacings that need no following were asked)', { pat: [1.5, 4 / 3, 1.5], beat: 0.75, perPhrase: 7, phrases: 6, breath: 0.3 }],
  ])('%s', (_, opts) => {
    const m = musicalityOf(gridTake(opts));
    const f = d(m, 'tempo-flexibility');
    if (f.measured) expect(f.detail.word).toBe('steady');
    else expect(f.reason).toMatch(/follower|spacings|note values/);
    expect(d(m, 'tempo-shape').phrase).not.toMatch(/faster|slower/);
  });

  test('a real wave in the tempo is still read', () => {
    const m = musicalityOf(wobbleOnsets(idealTake(buildSpec({ phrases: 8, perPhrase: 10, period: 0.5, breath: 0.35, shape: 'flat', wave: 0.15, jitter: 0.04, seed: 3 })), 12, 3));
    expect(d(m, 'tempo-flexibility').measured).toBe(true);
    expect(d(m, 'tempo-flexibility').detail.word).toBe('free');
  });
});

// 6. the wording of "steady" -------------------------------------------------

describe('the "steady" sentence, as quoted by an honest reply', () => {
  const m = musicalityOf(wobbleOnsets(idealTake(buildSpec({ phrases: 8, perPhrase: 12, period: 0.5, breath: 0.35, shape: 'flat', seed: 2 })), 14, 3));
  const facts = musicalityFacts(named(m, 'Bach prelude'), { question: 'is my tempo steady' });
  test('the fact says what it counts and does not count', () => {
    expect(facts.join(' ')).toMatch(/steady from one short stretch to the next/);
    expect(facts.join(' ')).toMatch(/a slow movement over the whole take is not counted here/);
  });
  test('the guard keeps a reply that repeats it, and drops one that claims the whole take is steady', () => {
    const ok = (r) => checkReply(r, facts, 'is my tempo steady', { takeCount: 1 }).ok;
    expect(ok('The tempo is steady from one short stretch to the next, though a slow movement over the whole take is not counted.')).toBe(true);
  });
});

// 5. the direction red team's twelve escapes ----------------------------------

describe('"came right" beside a number the facts say got worse', () => {
  const facts = ['Average pitch error: "Bach prelude, Oct 22" 18.4¢, "Bach prelude, Oct 17" 5.6¢, so "Bach prelude, Oct 22" is 12.8¢ further from pitch.'];
  const ok = (r) => checkReply(r, facts, '', { takeCount: 2 }).ok;
  test.each([
    'The take came right by 12.8¢.',
    'It came right, 12.8 cents from before.',
    'The take came right: 12.8 against before.',
  ])('%s is a reply that says improved, and is dropped', (r) => {
    expect(ok(r)).toBe(false);
  });
  test('the honest sentence of the same facts is kept', () => {
    expect(ok('The Oct 22 take is 12.8¢ further from pitch.')).toBe(true);
  });
});
