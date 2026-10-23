import { describe, test, expect } from 'vitest';
import { musicalityOf, compareMusicality } from '../src/analysis/musicality.js';
import { musicalityFacts, compareMusicalityFacts, topicsOf, MUSICALITY_PATTERN } from '../src/ai/musicality-facts.js';
import { checkReply, numbersIn } from '../src/ai/guard.js';
import { buildSpec, idealTake } from './helpers/musicality-synth.js';

// Every take here is built with KNOWN shaping and handed over as the notes and
// readings a perfect Analyzer would give. The same specifications are pushed
// through the real Analyzer + NoteSegmenter by tools/musicality-synth-check.mjs,
// which is where the thresholds' noise floors were measured; these tests hold
// the module's own logic.
const slow = { period: 0.5, perPhrase: 10, phrases: 6 };
const read = (opts) => musicalityOf(idealTake(buildSpec({ ...slow, ...opts })));
const d = (m, key) => m.descriptors[key];

describe('phrases', () => {
  test('finds the breaths the take was built with', () => {
    const m = read({ shape: 'flat' });
    expect(d(m, 'phrase-count').value).toBe(6);
    expect(m.phrases).toHaveLength(6);
    expect(m.phrases[0]).toMatchObject({ from: 0, to: 9 });
  });

  test('a take with no breaths is one continuous stretch and says phrase measures are not available', () => {
    const m = read({ shape: 'flat', breath: 0 });
    expect(d(m, 'phrase-count').value).toBe(1);
    expect(d(m, 'phrase-definition').measured).toBe(false);
    expect(d(m, 'phrase-shape').measured).toBe(false);
    expect(d(m, 'phrase-shape').reason).toMatch(/phrase/);
    // but contrast across the take can still be said, as stretches and not phrases
    expect(d(m, 'stretch-contrast').phrase).toMatch(/not phrases/);
  });
});

describe('dynamic shaping', () => {
  test('arched, flat, building and jumping loudness are told apart', () => {
    expect(d(read({ shape: 'arch' }), 'phrase-shape').detail.dominant).toBe('arch');
    expect(d(read({ shape: 'flat' }), 'phrase-shape').detail.dominant).toBe('level');
    expect(d(read({ shape: 'build' }), 'phrase-shape').detail.dominant).toBe('build');
    expect(d(read({ shape: 'jump', peakDb: 6 }), 'phrase-shape').detail.dominant).toBe('uneven');
  });

  test('louder and quieter phrases are contrast; equal phrases are none', () => {
    const lively = d(read({ shape: 'flat', phraseGainDb: [0, 6, -3] }), 'phrase-contrast').value;
    const level = d(read({ shape: 'flat' }), 'phrase-contrast').value;
    expect(lively).toBeGreaterThan(2);
    expect(level).toBeLessThan(0.5);
  });
});

describe('articulation and tempo', () => {
  test('detached and connected playing are told apart, and uneven articulation shows as uneven', () => {
    expect(d(read({ articulation: 0.45 }), 'articulation').value).toBeLessThan(0.55);
    expect(d(read({ articulation: 0.98 }), 'articulation').value).toBeGreaterThan(0.9);
    const mixed = read({ articulation: 0.7, articulationJitter: 0.25 });
    expect(d(mixed, 'articulation-evenness').value).toBeGreaterThan(d(mixed, 'articulation-evenness').detail.evenBelow);
    expect(d(read({ articulation: 0.7 }), 'articulation-evenness').value).toBeLessThan(0.05);
  });

  test('stretching phrase ends reads as lengthening', () => {
    expect(d(read({ finalStretch: 1.5 }), 'phrase-final-lengthening').value).toBeGreaterThan(1.3);
    expect(d(read({}), 'phrase-final-lengthening').value).toBeLessThan(1.1);
  });

  test('a tempo wave returns, a drift does not, steady is steady', () => {
    expect(d(read({ wave: 0.15 }), 'tempo-shape').detail.kind).toBe('returns');
    expect(d(read({ drift: 0.2 }), 'tempo-shape').detail.kind).toBe('speeds-up');
    expect(d(read({}), 'tempo-shape').detail.kind).toBe('steady');
    expect(d(read({ wave: 0.15 }), 'tempo-flexibility').value).toBeGreaterThan(d(read({}), 'tempo-flexibility').value + 5);
  });

  test('a score-free take with mixed note values refuses a tempo rather than guessing one', () => {
    // alternate a short and a dotted spacing: the ladder reads a 1.5 as written, so nothing can be said about give
    const notes = [];
    let t = 0;
    for (let i = 0; i < 40; i++) {
      notes.push({ start: t, end: t + 0.2, midi: 55 + (i % 5), cents: 0 });
      t += [0.25, 0.5, 0.75, 0.25, 1.0][i % 5];
    }
    const m = musicalityOf({ notes, readings: [] });
    expect(d(m, 'tempo-flexibility').measured).toBe(false);
    expect(d(m, 'tempo-flexibility').reason).toMatch(/mixed/);
  });

  test('with the written lengths the tempo comes from the score, not from a guess', () => {
    const notes = [];
    let t = 0;
    for (let i = 0; i < 40; i++) {
      const beats = [0.5, 1, 0.5, 1.5, 0.5][i % 5];
      const period = 0.5 * (1 + 0.1 * Math.sin(i / 3));
      notes.push({ start: t, end: t + 0.2, midi: 55 + (i % 5), cents: 0, beats });
      t += beats * period;
    }
    const m = musicalityOf({ notes, readings: [] });
    expect(d(m, 'tempo-flexibility').measured).toBe(true);
    expect(d(m, 'tempo-flexibility').value).toBeGreaterThan(5);
  });
});

describe('repeated figures and pitch expression', () => {
  test('identical repeats are alike, varied repeats are less alike', () => {
    const same = d(read({ shape: 'arch' }), 'repeat-timing').value;
    const varied = d(read({ shape: 'arch', sameRepeats: false }), 'repeat-timing').value;
    expect(same).toBeLessThan(1);
    expect(varied).toBeGreaterThan(same + 3);
  });

  test('vibrato that opens up on long notes is told from steady vibrato', () => {
    const long = { period: 1.1, articulation: 0.98, shape: 'flat' };
    expect(d(read({ ...long, vibrato: 'grows' }), 'vibrato-growth').value).toBeGreaterThanOrEqual(60);
    expect(d(read({ ...long, vibrato: 'steady' }), 'vibrato-growth').value).toBeLessThanOrEqual(25);
    expect(d(read({ ...long, vibrato: 'none' }), 'vibrato-growth').measured).toBe(false);
  });

  test('notes that sit higher after a step up than after a step down are a lean, not an error', () => {
    const notes = [];
    let t = 0;
    let midi = 60;
    for (let i = 0; i < 60; i++) {
      const up = i % 2 === 0;
      midi += up ? 1 : -1;
      notes.push({ start: t, end: t + 0.3, midi, cents: up ? 6 : -6 });
      t += 0.4;
    }
    const m = musicalityOf({ notes, readings: [] });
    expect(d(m, 'pitch-lean').value).toBeCloseTo(12, 0);
    expect(d(m, 'pitch-lean').phrase).toMatch(/higher/);
    expect(d(m, 'pitch-lean').phrase).not.toMatch(/wrong|error|out of tune/);
  });
});

describe('character, and the word mechanical', () => {
  test('a metronomic flat take is called mechanical, legato or detached', () => {
    for (const articulation of [0.97, 0.5]) {
      const c = d(read({ shape: 'flat', articulation }), 'character');
      expect(c.mechanical).toBe(true);
      expect(c.phrase).toMatch(/^mechanical/);
    }
  });

  test('any one sign of shaping withdraws it', () => {
    for (const opts of [{ shape: 'arch' }, { shape: 'flat', wave: 0.15 }, { shape: 'flat', articulation: 0.7, articulationJitter: 0.25 },
      { shape: 'flat', finalStretch: 1.5, phraseGainDb: [0, 5, -3] }]) {
      expect(d(read(opts), 'character').mechanical).toBe(false);
    }
  });

  test('the character is assembled from measured pieces only, so an unmeasured piece is absent from it', () => {
    const m = read({ shape: 'flat', breath: 0 });          // no phrases: phrase shape unmeasured
    expect(d(m, 'phrase-shape').measured).toBe(false);
    expect(d(m, 'character').phrase).not.toMatch(/swell|phrases held/);
  });
});

describe('too little to read', () => {
  test('under twelve notes every descriptor says it could not be measured, with a reason and no number', () => {
    const notes = Array.from({ length: 6 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, midi: 55 + i, cents: 0 }));
    const m = musicalityOf({ notes, readings: [] });
    for (const x of Object.values(m.descriptors)) {
      expect(x.measured).toBe(false);
      expect(x.value).toBeNull();
      expect(x.reason).toMatch(/only 6 notes/);
    }
    expect(m.descriptors.character.mechanical).toBe(false);
    expect(musicalityOf({ notes: [], readings: [] })).toBeNull();
  });
});

describe('mis-heard takes', () => {
  test('a take full of fragments shorter than the analyzer can resolve is read with low confidence throughout, and says so in the facts', () => {
    const spec = buildSpec({ ...slow, shape: 'arch' });
    const take = idealTake(spec);
    // split every second note into three 30 ms fragments, as a double stop or a bow noise does
    const notes = take.notes.flatMap((n, i) => (i % 2 ? [n] : [0, 1, 2].map((k) => ({ ...n, start: n.start + k * 0.03, end: n.start + k * 0.03 + 0.025 }))));
    const m = musicalityOf({ notes, readings: take.readings });
    expect(m.reliability.noisy).toBe(true);
    expect(Object.values(m.descriptors).filter((x) => x.measured).every((x) => x.confidence === 'low')).toBe(true);
    const facts = musicalityFacts({ name: 'Noisy', date: 0, musicality: m });
    expect(facts[0]).toMatch(/were very short/);
    expect(read({ shape: 'arch' }).reliability.noisy).toBe(false);
  });
});

describe('comparison', () => {
  const flat = read({ shape: 'flat' });
  const arch = read({ shape: 'arch' });

  test('says what changed in neutral words and grades nothing about loudness shape', () => {
    const rows = compareMusicality(flat, arch);
    const shape = rows.find((r) => r.key === 'phrase-shape');
    expect(shape.verdict).toBe('more phrases that swell and fade');
    expect(shape.better).toBeUndefined();
    expect(rows.filter((r) => r.better !== undefined).every((r) => r.key.startsWith('repeat'))).toBe(true);
  });

  test('a repeated figure played more alike the second time is marked as closer, and the reverse as further', () => {
    const varied = read({ shape: 'arch', sameRepeats: false });
    const same = read({ shape: 'arch' });
    const toSame = compareMusicality(varied, same).find((r) => r.key === 'repeat-timing');
    const toVaried = compareMusicality(same, varied).find((r) => r.key === 'repeat-timing');
    expect(toSame.better).toBe(true);
    expect(toVaried.better).toBe(false);
  });

  test('something unmeasured in either take is reported as unmeasured, never as a change', () => {
    const none = read({ shape: 'flat', breath: 0 });
    const row = compareMusicality(none, arch).find((r) => r.key === 'phrase-shape');
    expect(row.verdict).toBe('unmeasured');
    expect(row.change).toBeNull();
  });
});

describe('facts for the assistant', () => {
  const DAY = 86400000;
  const mk = (id, name, opts, daysAgo) => ({ id, name, date: new Date(2026, 9, 20).getTime() - daysAgo * DAY, musicality: read(opts) });
  const a = mk(2, 'Bach prelude', { shape: 'arch', wave: 0.15 }, 1);
  const b = mk(1, 'Bach prelude', { shape: 'flat' }, 6);

  test('every figure in a sentence is a figure the measurement holds, so the guard can trace it', () => {
    const facts = musicalityFacts(a);
    expect(facts.length).toBeGreaterThan(3);
    const paraphrase = `In "Bach prelude", ${Math.round(d(a.musicality, 'tempo-flexibility').value)} percent is how far the tempo moves, across ${d(a.musicality, 'phrase-count').value} phrases.`;
    expect(checkReply(paraphrase, facts).ok).toBe(true);
    expect(checkReply('The tempo moves by 77 percent.', facts).ok).toBe(false);
  });

  test('no digits hide inside descriptive words', () => {
    for (const f of [...musicalityFacts(a), ...compareMusicalityFacts(a, b)]) {
      expect(f).not.toMatch(/\d(st|nd|rd|th)\b/);
      expect(numbersIn(f).every(Number.isFinite)).toBe(true);
    }
  });

  test('a comparison names both takes, the direction in neutral words, and carries the no-taste caveat', () => {
    const facts = compareMusicalityFacts(a, b);
    const text = facts.join(' ');
    expect(text).toMatch(/swell and fade/);
    expect(text).toMatch(/not a judgement of taste/);
    expect(text).not.toMatch(/\bbetter\b|\bworse\b|more musical|more expressive/);
  });

  test('a comparison sentence reads as a sentence for every kind of verdict, since a player may see it verbatim', () => {
    const connected = { id: 4, name: 'Etude', date: a.date, musicality: read({ articulation: 0.98 }) };
    const detached = { id: 5, name: 'Etude', date: a.date - DAY, musicality: read({ articulation: 0.45 }) };
    const text = compareMusicalityFacts(detached, connected).join(' ');
    expect(text).toMatch(/Legato or detached: "Etude, [^"]+" 98%, "Etude, [^"]+" 45% \(more detached in "Etude, [^"]+"\)\./);
    expect(text).not.toMatch(/ has (more|less|fewer|repeated|a )/);
    const varied = { id: 6, name: 'Etude', date: a.date, musicality: read({ shape: 'arch', sameRepeats: false }) };
    const same = { id: 7, name: 'Etude', date: a.date - DAY, musicality: read({ shape: 'arch' }) };
    expect(compareMusicalityFacts(varied, same).join(' ')).toMatch(/\(repeated figures less alike in timing in /);
  });

  test('a take that could not be measured is said so, not described', () => {
    const none = { id: 3, name: 'Short', date: a.date, musicality: musicalityOf({ notes: [{ start: 0, end: 0.4, midi: 60, cents: 0 }], readings: [] }) };
    const facts = musicalityFacts(none);
    expect(facts.join(' ')).toMatch(/Too little of "Short"/);
    expect(facts.join(' ')).not.toMatch(/mechanical/);
    expect(compareMusicalityFacts({ ...a, musicality: null }, b)[0]).toMatch(/could not be measured/);
  });

  test('the question narrows which measurements are put in front of the model', () => {
    expect(topicsOf('is my articulation even?')).toEqual(['articulation']);
    expect(topicsOf('tell me about the interpretation')).toHaveLength(5);
    const facts = musicalityFacts(a, { question: 'is my articulation even?' }).join(' ');
    expect(facts).toMatch(/articulation/);
    expect(facts).not.toMatch(/vibrato|pitch leans/);
  });

  test('the router pattern catches shaping questions and not pitch ones', () => {
    for (const q of ['how is my phrasing', 'did I play more legato', 'is it too mechanical', 'are my repeats consistent', 'how is my rubato']) {
      expect(MUSICALITY_PATTERN.test(q)).toBe(true);
    }
    for (const q of ['which notes are flat', 'what is my average pitch error', 'how many days did I practise']) {
      expect(MUSICALITY_PATTERN.test(q)).toBe(false);
    }
  });
});
