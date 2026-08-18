import { describe, expect, it } from 'vitest';
import { scanRhythm } from '../src/analysis/scan-rhythm.js';
import { scanTiming } from '../src/analysis/scan-timing.js';
import { bachHeads, bachPlayed } from '../src/fixtures/take-fixture.js';

// THE FIXTURE, AND WHAT IT IS AND IS NOT CLAIMING.
//
// The heads and the played notes are the real ones: 32 noteheads of the BWV
// 1007 opening, x/y copied out of pages/truth/bach.truth.json, and 32 played
// notes on the fixture's own half-second grid. What this file ADDS is a note
// value per head and a bar every four heads, so that scan-values.js can believe
// something. THE BACH PAGE IS REALLY SIXTEEN SEMIQUAVERS TO A BAR — this is a
// fixture of the JOIN, not a claim about that photograph, and on the photograph
// itself validateValues believes no bar at all (npm run scan:values: 0 of 39).
// Four crotchets to a bar is chosen because it is the smallest arrangement of
// 32 notes that gives validateValues the three bars it needs and gives the join
// enough bars to break into runs.
const PER_BAR = 4;

function marksOf({
  beats = () => 1,
  perBar = PER_BAR,
  page = () => 0,
  nudge = () => 0,
} = {}) {
  const heads = bachHeads();
  const played = bachPlayed();
  return heads.map((head, i) => {
    const note = played[i];
    const start = note.start + nudge(i);
    return {
      ...head,
      page: page(i),
      staff: 0,
      bar: Math.floor(i / perBar),
      beats: beats(i),
      note: { ...note, start, end: start + (note.end - note.start) },
      index: i,
      verdict: 'match',
    };
  });
}

describe('scanRhythm — the join between believed values and the bar-level fallback', () => {
  it('gives a per-note verdict for every believed bar', () => {
    const report = scanRhythm(marksOf());
    expect(report.placed).toBe(true);
    expect(report.barsBelieved).toBe(8);
    expect(report.barsRefused).toBe(0);
    expect(report.beatsPerBar).toBe(4);
    expect(report.notesFromWritten).toBe(32);
    expect(report.notesFromEven).toBe(0);
    // 31 judged and one anchor: the first note of the run has nothing before it.
    expect(report.notesJudged).toBe(31);
    expect(report.notesAnchored).toBe(1);
    expect(report.perNote.every((n) => n.from === 'written' && n.believed)).toBe(true);
    expect(report.runs).toHaveLength(1);
  });

  it('calls a late note late, from the written duration', () => {
    const report = scanRhythm(marksOf({ nudge: (i) => (i === 9 ? 0.2 : 0) }));
    const notes = report.perNote.filter((n) => n.from === 'written');
    expect(notes[9].verdict).toBe('late');
    expect(notes[9].deviationMs).toBeGreaterThan(150);
    expect(notes[0].verdict).toBe('anchor');
    expect(notes[0].deviationMs).toBeNull();
  });

  it('measures a note against its WRITTEN length, not against an equal division', () => {
    // A bar of quaver, quaver, minim: 0.5, 0.5, 2, 1 — four beats, unequal.
    // Played to match at half a second per crotchet, so every note is on time
    // even though the notes are nowhere near evenly spaced. An equal-division
    // reading of the same take would call three of the four notes wrong.
    const beatsAt = [0.5, 0.5, 2, 1];
    const onsets = [0, 0.5, 1, 3];
    const marks = marksOf().map((mark, i) => {
      const bar = Math.floor(i / PER_BAR);
      const start = 0.75 + bar * 2 + onsets[i % PER_BAR] * 0.5;
      return {
        ...mark,
        beats: beatsAt[i % PER_BAR],
        note: { ...mark.note, start, end: start + 0.2 },
      };
    });
    const report = scanRhythm(marks);
    expect(report.barsBelieved).toBe(8);
    const notes = report.perNote.filter((n) => n.from === 'written');
    expect(notes.filter((n) => n.verdict === 'on')).toHaveLength(31);
    expect(report.meanAbsMsWritten).toBeLessThan(5);

    // AND THE SAME TAKE, READ AS AN EQUAL DIVISION OF ITS BARS, is 188 ms out
    // per note on average — measured here rather than asserted in prose. That
    // gap is what believing a bar buys: a perfectly played uneven bar is
    // reported as perfect from the written values and as a fifth of a second
    // adrift from the fallback.
    const equal = [];
    for (const bar of report.timing.perBar) {
      for (const [k, note] of bar.notes.entries()) {
        equal.push(Math.abs(note.start - (bar.from + (k / bar.count) * bar.length)) * 1000);
      }
    }
    const meanEqual = equal.reduce((a, b) => a + b, 0) / equal.length;
    expect(Math.round(meanEqual)).toBe(188);
  });

  it('refuses a bar whose values do not add up, and gives that bar no written verdict', () => {
    // One note of bar 3 read as a quaver where the rest are crotchets: the bar
    // sums to 3.5 against a page of 4s, and validateValues drops that bar only.
    const report = scanRhythm(marksOf({ beats: (i) => (i === 15 ? 0.5 : 1) }));
    expect(report.barsBelieved).toBe(7);
    expect(report.barsRefused).toBe(1);
    const refused = report.bars.filter((b) => !b.believed);
    expect(refused).toHaveLength(1);
    expect(refused[0].beats).toBe(3.5);
    expect(refused[0].beatsPerBar).toBe(4);
    expect(refused[0].why).toMatch(/do not add up/);
    // Its four notes are in the report, and every one of them is labelled as
    // coming from the coarse route with no early/late word on it.
    const from = new Map();
    for (const note of report.perNote) from.set(note.bar, note.from);
    expect(from.get(refused[0].key)).toBe('even');
    // and they can still be drawn: a fallback note carries its own notehead.
    const fallen = report.perNote.filter((n) => n.from === 'even');
    expect(fallen.every((n) => n.mark && n.mark.note === n.note)).toBe(true);
    expect(fallen.every((n) => n.page === 0 && n.staff === 0)).toBe(true);
    expect(report.perNote.filter((n) => n.bar === refused[0].key)
      .every((n) => n.verdict === null && n.believed === false)).toBe(true);
    expect(report.notesFromWritten).toBe(28);
    expect(report.notesFromEven).toBe(4);
  });

  it('splits the run at a refused bar rather than measuring across it', () => {
    const report = scanRhythm(marksOf({ beats: (i) => (i === 15 ? 0.5 : 1) }));
    // Bars 0-2 and bars 4-7: two runs, so two anchors, and no note is ever
    // measured against a note on the far side of a bar of unknown length.
    expect(report.runs.map((r) => r.bars)).toEqual([3, 4]);
    expect(report.notesAnchored).toBe(2);
    expect(report.notesJudged).toBe(26);
  });

  it('splits the run at a page turn, which is a pause nobody wrote', () => {
    const report = scanRhythm(marksOf({ page: (i) => (i < 16 ? 0 : 1) }));
    expect(report.barsBelieved).toBe(8);
    expect(report.runs.map((r) => r.bars)).toEqual([4, 4]);
    expect(report.notesAnchored).toBe(2);
  });

  it('refuses a bar that sums right around a value it could not read', () => {
    // 1, 1, 2, 0 comes to four beats and validateValues trusts the sum. The
    // zero is a head whose value was not read, and placing the notes after it
    // from that bar's own values would put every one of them in the wrong
    // place — so the join declines the bar even though the arithmetic passed.
    const report = scanRhythm(marksOf({
      beats: (i) => (i < 4 ? [1, 1, 2, 0][i] : 1),
    }));
    expect(report.bars[0].believed).toBe(false);
    // AND ITS SUM IS NULL, NOT 4. This asserted 4 while barValues filled an
    // unread value with a zero: the bar "came to four beats" because the hole
    // was worth nothing. Both consumers already declined such a bar (each
    // guards on values.every(v => v > 0)), so what the zero really bought was a
    // vote in validateValues' modal-bar tally and a sum shown to a player. A
    // bar holding a value nobody read has no length, and now says so.
    expect(report.bars[0].beats).toBeNull();
    expect(report.bars[0].why).toMatch(/no value the reader could read/);
    expect(report.barsBelieved).toBe(7);
  });

  it('falls back entirely when the page cannot say how long a bar is', () => {
    // Every bar a different length: no mode clears validateValues' coverage
    // gate, so nothing is believed and nothing throws.
    const lengths = [1, 0.5, 0.25, 2, 4, 0.125, 3, 1.5];
    const report = scanRhythm(marksOf({ beats: (i) => lengths[Math.floor(i / PER_BAR)] }));
    expect(report.barsBelieved).toBe(0);
    expect(report.barsRefused).toBe(8);
    expect(report.notesFromWritten).toBe(0);
    expect(report.notesJudged).toBe(0);
    expect(report.meanAbsMsWritten).toBeNull();
    expect(report.valuesWhy).toMatch(/do not agree|not a bar/);
    expect(report.perNote.every((n) => n.from === 'even' && n.verdict === null)).toBe(true);
    expect(report.runs).toEqual([]);
  });

  it('reads no values at all as a refusal, not as a page of crotchets', () => {
    // What headsOf hands over when scan-stems.js read nothing: beats null on
    // every mark. THIS IS THE STATE OF ALL THREE REAL PAGES' ARITHMETIC in the
    // sense that matters — no bar is believed — and the answer must be the
    // coarse one rather than a made-up duration.
    const report = scanRhythm(marksOf({ beats: () => null }));
    expect(report.barsBelieved).toBe(0);
    expect(report.notesFromWritten).toBe(0);
    expect(report.valuesWhy).toBe('too few bars to tell');
    // beats null rather than 0: nothing was read, so the bar has no length —
    // 0 was the old filled-in answer and reads as "an empty bar", which is a
    // different page from "a bar nobody could measure".
    expect(report.bars.every((b) => b.beats === null && b.believed === false)).toBe(true);
  });

  it('never blends the two routes into one number', () => {
    const report = scanRhythm(marksOf({ beats: (i) => (i === 15 ? 0.5 : 1) }));
    expect(report.notesJudged + report.notesFromEven).toBe(30);
    expect(report.meanAbsMsWritten).not.toBeNull();
    expect(report.meanOffMsEven).not.toBeNull();
    // There is no single mean over both, on purpose.
    expect(Object.keys(report)).not.toContain('meanAbsMs');
    expect(Object.keys(report)).not.toContain('meanOffMs');
    // …and no field a UI could colour both routes with: the written route's
    // deviation is measured against the note before it and the even route's is
    // measured against an absolute place in the bar, so one scale over both
    // would give the same colour to two different claims.
    const written = report.perNote.filter((n) => n.from === 'written');
    const even = report.perNote.filter((n) => n.from === 'even');
    expect(written.every((n) => n.offFromEqualMs === null)).toBe(true);
    expect(even.every((n) => n.deviationMs === null)).toBe(true);
  });

  it('every bar of the take is reported whether or not it was believed', () => {
    const report = scanRhythm(marksOf({ beats: (i) => (i === 15 ? 0.5 : 1) }));
    expect(report.bars).toHaveLength(8);
    expect(report.bars.every((b) => Number.isFinite(b.length) && Number.isFinite(b.ratio))).toBe(true);
    expect(report.bars.filter((b) => b.worst)).toHaveLength(1);
  });

  it('reports the notes in the order they were played, whichever route they took', () => {
    const report = scanRhythm(marksOf({ beats: (i) => (i === 15 ? 0.5 : 1) }));
    const starts = report.perNote.map((n) => n.note.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // …and no bar is on both routes at once: a bar is believed or it is not.
    const routes = new Map();
    for (const note of report.perNote) {
      routes.set(note.bar, (routes.get(note.bar) ?? new Set()).add(note.from));
    }
    expect([...routes.values()].every((set) => set.size === 1)).toBe(true);
  });

  it('answers null to everything when there is not enough take to speak about', () => {
    for (const marks of [null, undefined, [], marksOf().slice(0, 6)]) {
      const report = scanRhythm(marks);
      expect(report.placed).toBe(false);
      expect(report.timing).toBeNull();
      expect(report.bars).toEqual([]);
      expect(report.perNote).toEqual([]);
      expect(report.barsBelieved).toBe(0);
      expect(report.meanAbsMsWritten).toBeNull();
      expect(report.why).toMatch(/three bars/);
    }
  });
});

describe('scanTiming still says what score.js reads off it', () => {
  // score.js:960 reads bars, steadiness, verdict, evenNotes and meanOffMs, and
  // that file belongs to another session. perBar was ADDED for the join; none
  // of the rest may have moved.
  const report = scanTiming(marksOf());

  it('keeps its own fields', () => {
    expect(report.bars).toBe(8);
    expect(report.steadiness).toBeGreaterThan(0.9);
    expect(report.verdict).toBe('steady');
    expect(report.evenNotes).toBe(true);
    expect(Number.isFinite(report.meanOffMs)).toBe(true);
    expect(Number.isFinite(report.barsPerMinute)).toBe(true);
  });

  it('adds one bar entry per bar it kept, in the same order', () => {
    expect(report.perBar).toHaveLength(report.bars);
    expect(report.perBar.map((b) => b.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(report.perBar.every((b) => b.marks.length === b.count)).toBe(true);
  });
});
