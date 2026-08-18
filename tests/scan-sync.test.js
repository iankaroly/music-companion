import { describe, it, expect } from 'vitest';
import { pairNotes } from '../src/ui/scan-view.js';
import { syncTake } from '../src/analysis/scan-sync.js';
import { buildEmphasizedClip } from '../src/audio/clips.js';
import {
  BACH_OPENING, bachHeads, bachPlayed, bachTake, wrongPieceTake,
  synthRecording, matchesTruthFiles,
} from '../src/fixtures/take-fixture.js';

// The fixture is a COPY of 32 hand-marked noteheads and their names. A copy can
// go stale, and a stale one measures a page that no longer exists while every
// test built on it still passes. So it is checked against the files it came
// from, first, before anything else here is worth reading.
describe('the take fixture is still the page it says it is', () => {
  it('matches pages/truth/bach.truth.json and pages/truth/bach.pitch.json', async () => {
    const { ok, problems } = await matchesTruthFiles();
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
  });

  // 0=G2, 4=D3, 5=E3, 8=A3, 9=B3, 10=C4 — the pitch file's own words, priced
  // through pitchOf, which is what headsOf uses. Bar 1 is G D B A B D B D.
  it('prices the opening bar as the pitch file names it', () => {
    const heads = bachHeads();
    expect(heads.length).toBe(32);
    expect(heads.slice(0, 8).map((h) => h.midi)).toEqual([43, 50, 59, 57, 59, 50, 59, 50]);
    expect(heads[16].midi).toBe(43);           // bar 2 opens on the same G2
    expect(heads[18].midi).toBe(60);           // …up to C4
    expect(heads.every((h) => h.clef === 'bass')).toBe(true);
    expect(heads.every((h) => h.space === BACH_OPENING.space)).toBe(true);
  });

  // The reason this fixture exists at all: a clip, without a microphone. This
  // is the surface every other agent in this workflow needs, so it is asserted
  // against the real Recorder and the real clip builder rather than described.
  it('gives buildEmphasizedClip something real to work on', () => {
    const played = bachPlayed();
    const recording = synthRecording(played);
    const note = played[8];
    const clip = buildEmphasizedClip(recording, note.start, note.end);
    expect(clip.sampleRate).toBe(recording.sampleRate);
    expect(clip.samples.length).toBeGreaterThan(0);
    // 1.2 s of context in front, and the note starts well past that.
    expect(clip.targetOffset).toBeCloseTo(1.2, 5);
    // The note is actually audible in there, which a fixture of silence would
    // pass every other assertion without being.
    const peak = clip.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.05);
  });
});

describe('a notehead knows when it was played', () => {
  const take = bachTake();
  const pairing = pairNotes(take.heads, take.played);
  const bridge = syncTake({ heads: take.heads, played: take.played, pairing });

  it('joins every mark back to the head it was spread from', () => {
    expect(bridge.placed).toBe(true);
    expect(bridge.spans.length).toBe(32);
    expect(bridge.unjoined).toBe(0);
    expect(bridge.unheard).toEqual([]);
    expect(bridge.silent).toEqual([]);
    expect(bridge.spans.map((s) => s.headIndex)).toEqual([...Array(32).keys()]);
  });

  it('answers in recording seconds, by head object or by index', () => {
    // The grid is 0.75 + i/2, sounding for 0.4.
    expect(bridge.timeOf(take.heads[0])).toEqual({ start: 0.75, end: 1.15 });
    expect(bridge.timeOf(0)).toEqual({ start: 0.75, end: 1.15 });
    expect(bridge.timeOf(take.heads[31])).toEqual({ start: 16.25, end: 16.65 });
  });

  it('says null for a notehead nobody played', () => {
    // The page has 32 heads and the take only reaches the first 16 of them.
    const short = bachPlayed();
    short.length = 16;
    const half = syncTake({
      heads: take.heads, played: short, pairing: pairNotes(take.heads, short),
    });
    expect(half.spans.length).toBe(16);
    expect(half.timeOf(take.heads[20])).toBeNull();
    expect(half.timesOf(take.heads[20])).toEqual([]);
    expect(half.silent).toEqual([...Array(16).keys()].map((i) => i + 16));
  });
});

describe('a moment knows which notehead is sounding', () => {
  const take = bachTake();
  const bridge = syncTake({
    heads: take.heads, played: take.played, pairing: pairNotes(take.heads, take.played),
  });

  it('finds the head under a moment inside a note', () => {
    expect(bridge.headAt(0.9).headIndex).toBe(0);
    expect(bridge.headAt(1.3).headIndex).toBe(1);   // second note, 1.25-1.65
    expect(bridge.headAt(16.6).headIndex).toBe(31);
  });

  // Half-open, [start, end). The instant a note ends is not a moment it is
  // sounding — otherwise on a grid two notes would both claim it.
  it('takes the interval half-open at both ends of a note', () => {
    expect(bridge.headAt(0.75).headIndex).toBe(0);  // the instant it begins
    expect(bridge.headAt(1.15)).toBeNull();         // the instant it ends
    expect(bridge.headAt(1.25).headIndex).toBe(1);
  });

  it('says null in silence rather than holding the last note lit', () => {
    expect(bridge.headAt(0.5)).toBeNull();          // before the take starts
    expect(bridge.headAt(1.2)).toBeNull();          // in the gap between notes
    expect(bridge.headAt(17)).toBeNull();           // after the last note ends
    expect(bridge.headAt(NaN)).toBeNull();
    expect(bridge.headAt(undefined)).toBeNull();
  });
});

describe('the three things that actually go wrong on a page', () => {
  const take = bachTake();

  // A NOTEHEAD THE READER MISSED: the note was played, no head exists for it.
  // Simulated by taking a real pairing apart — the mark for note 5 is removed,
  // which is precisely the state the aligner leaves when it spends an insert.
  it('counts a played note that landed on no notehead, and lights nothing at its time', () => {
    const pairing = pairNotes(take.heads, take.played);
    const marks = pairing.marks.filter((m) => m.index !== 5);
    const bridge = syncTake({
      heads: take.heads, played: take.played, pairing: { ...pairing, marks },
    });
    expect(bridge.spans.length).toBe(31);
    expect(bridge.unheard.map((u) => u.playedIndex)).toEqual([5]);
    expect(bridge.unheard[0].played).toBe(take.played[5]);
    // 3.25-3.65 is note 5. Nothing is claimed to be sounding there, because
    // nothing on the page is known to be.
    expect(bridge.headAt(3.4)).toBeNull();
    expect(bridge.silent).toEqual([5]);
  });

  // A NOTEHEAD THAT IS NOT THERE: the head exists, nobody played it. Covered
  // above by `silent`; this pins the null down at a head in the MIDDLE of a
  // take rather than off its end, which is the case a "nearest played note"
  // default would silently fill in.
  it('leaves a hole where a head inside the take was never played', () => {
    const pairing = pairNotes(take.heads, take.played);
    const marks = pairing.marks.filter((m) => m.index !== 5);
    const bridge = syncTake({
      heads: take.heads, played: take.played, pairing: { ...pairing, marks },
    });
    expect(bridge.timeOf(take.heads[5])).toBeNull();
    expect(bridge.timeOf(take.heads[4])).toEqual({ start: 2.75, end: 3.15 });
    expect(bridge.timeOf(take.heads[6])).toEqual({ start: 3.75, end: 4.15 });
  });

  // A REPEAT: one head, two times. The representation is supported and this
  // proves it; nothing in the scanned route PRODUCES it yet, which is why the
  // pairing here is hand-built rather than taken from pairNotes. See the note
  // on timesOf.
  it('returns every time a head sounded, in order, when a pairing gives it two', () => {
    const heads = bachHeads();
    const played = bachPlayed();
    const marks = [
      // Deliberately out of time order, to prove the sort is the bridge's and
      // not the pairing's.
      { ...heads[3], note: played[20], index: 20, verdict: 'match', pass: 1 },
      { ...heads[3], note: played[3], index: 3, verdict: 'match', pass: 0 },
    ];
    const bridge = syncTake({ heads, played, pairing: { placed: true, marks } });
    const times = bridge.timesOf(heads[3]);
    expect(times.map((s) => s.start)).toEqual([2.25, 10.75]);
    expect(times.map((s) => s.pass)).toEqual([0, 1]);
    // timeOf is the FIRST of them, never a merge of the two.
    expect(bridge.timeOf(heads[3])).toEqual({ start: 2.25, end: 2.65 });
    expect(bridge.headAt(10.9).headIndex).toBe(3);
  });
});

describe('a take that could not be placed', () => {
  const take = bachTake();

  // Rule 3, as a structure rather than as a promise. A refusal is answerable:
  // every question returns null and nothing throws, so a caller needs no
  // special case to be honest.
  it('answers null to everything, and carries the pairing’s own reason', () => {
    const bridge = syncTake({
      heads: take.heads,
      played: take.played,
      pairing: { placed: false, marks: [], why: 'too few notes to place' },
    });
    expect(bridge.placed).toBe(false);
    expect(bridge.why).toBe('too few notes to place');
    expect(bridge.spans).toEqual([]);
    expect(bridge.timeOf(take.heads[0])).toBeNull();
    expect(bridge.timesOf(take.heads[0])).toEqual([]);
    expect(bridge.headAt(1)).toBeNull();
    // Not empty. Empty would read as "every notehead was played and every note
    // found one", which is the most confident pair of sentences this structure
    // can say and both false here.
    expect(bridge.silent.length).toBe(take.heads.length);
    expect(bridge.unheard.length).toBe(take.played.length);
  });

  it('refuses a missing pairing rather than throwing', () => {
    const bridge = syncTake({ heads: take.heads, played: take.played });
    expect(bridge.placed).toBe(false);
    expect(bridge.headAt(1)).toBeNull();
    expect(syncTake().placed).toBe(false);
  });

  // THE FINDING THIS TEST USED TO PIN HAS BEEN FIXED, and the assertion is
  // turned over rather than deleted so the history stays legible.
  //
  // It used to read `expect(pairing.placed).toBe(true)` under a comment saying
  // pairNotes does NOT refuse a wrong piece "and it cannot". MEASURED at the
  // time, on this same fixture (two octaves of D major twice, against the BWV
  // 1007 opening): placed:true, 20 marks of 24 notes, verdicts
  // { match: 6, wrong: 6, octave: 7, near: 1 }.
  //
  // pairNotes now has a confidence floor derived in `npm run scan:floor` — the
  // share of judgeable marks whose pitch agreed EXACTLY, against 0.70. This
  // fixture scores 6 of 20, so it is refused with a reason, and the marks that
  // asserted a wrong piece are not drawn at all.
  it('refuses the wrong piece outright, with a reason', () => {
    const wrong = wrongPieceTake();
    const pairing = pairNotes(wrong.heads, wrong.played);
    expect(pairing.placed).toBe(false);
    expect(pairing.marks).toEqual([]);
    expect(pairing.why).toMatch(/does not match/i);
    // The number it refused on is reported rather than hidden, and it is a
    // fraction of something that was actually judgeable.
    expect(pairing.exactAgreement).toBeLessThan(0.7);
    expect(pairing.judged).toBeGreaterThanOrEqual(8);
  });

  // And what the BRIDGE guarantees on a refusal, which is the other half of the
  // old test: nothing is attached to anything, and every played note is
  // accounted for as unheard rather than quietly dropped.
  it('gives the bridge nothing to attach when the pairing is refused', () => {
    const wrong = wrongPieceTake();
    const pairing = pairNotes(wrong.heads, wrong.played);
    const bridge = syncTake({ heads: wrong.heads, played: wrong.played, pairing });
    expect(bridge.placed).toBe(false);
    expect(bridge.spans.length).toBe(0);
    expect(bridge.headAt(0.5)).toBeNull();
  });

  // `mark.index` is counted against whichever played array pairNotes was given.
  // Handed a different one, the bridge must not report a confident wrong index.
  it('does not trust a mark index that points at a different note', () => {
    const heads = bachHeads();
    const played = bachPlayed();
    const marks = [
      // Right note, wrong index — the shape of a take that has been round the
      // store and come back with a note trimmed off the front.
      { ...heads[4], note: played[4], index: 9 },
      // A note that is not in this take at all.
      { ...heads[5], note: { midi: 43, cents: 0, start: 40, end: 40.4 }, index: 5 },
    ];
    const bridge = syncTake({ heads, played, pairing: { placed: true, marks } });
    const [recovered, orphan] = bridge.spans.sort((a, b) => a.headIndex - b.headIndex);
    expect(recovered.headIndex).toBe(4);
    expect(recovered.playedIndex).toBe(4);        // recovered, not 9
    expect(orphan.playedIndex).toBeNull();        // refused, not 5
    // Note 4 is the one that was placed; note 9 is not, and must still be
    // counted as unplaced.
    expect(bridge.unheard.map((u) => u.playedIndex)).toContain(9);
    expect(bridge.unheard.map((u) => u.playedIndex)).not.toContain(4);
  });

  // A mark that cannot be joined back to a head is dropped and COUNTED, never
  // guessed at. This is the failure mode the (page, x, y) join has if
  // alignByPitch ever stops copying those fields by value.
  it('counts a mark it cannot find a head for instead of inventing one', () => {
    const heads = bachHeads();
    const played = bachPlayed();
    const marks = [
      { ...heads[0], note: played[0], index: 0 },
      { x: 0.999, y: 0.999, page: 0, note: played[1], index: 1 },
    ];
    const bridge = syncTake({ heads, played, pairing: { placed: true, marks } });
    expect(bridge.spans.length).toBe(1);
    expect(bridge.unjoined).toBe(1);
    expect(bridge.unheard.map((u) => u.playedIndex)).toContain(1);
  });
});

// The aligner's own answer to "which notehead", carried on the mark instead of
// being reconstructed. Two modules used to hold this fact — scan-view.js knew
// it and threw it away, scan-sync.js found it again by matching (page, x, y) —
// and the tests below are what says the two agree rather than that the newer
// one is merely quieter.
describe('the head index the pairing carries', () => {
  it('is on every mark, and points at the head the mark is a copy of', () => {
    const { heads, played } = bachTake();
    const pairing = pairNotes(heads, played);
    expect(pairing.marks.length).toBeGreaterThan(0);
    for (const mark of pairing.marks) {
      expect(Number.isInteger(mark.headIndex)).toBe(true);
      expect(heads[mark.headIndex].x).toBe(mark.x);
      expect(heads[mark.headIndex].y).toBe(mark.y);
    }
  });

  it('joins to exactly the same spans the place-join found', () => {
    const { heads, played } = bachTake();
    const pairing = pairNotes(heads, played);
    const withIndex = syncTake({ heads, played, pairing });
    // The same pairing with the carried index stripped off every mark — which
    // is character for character what this module saw before, and what a
    // hand-built pairing in a test still hands it.
    const stripped = {
      ...pairing,
      marks: pairing.marks.map(({ headIndex, ...rest }) => rest),
    };
    const byPlace = syncTake({ heads, played, pairing: stripped });
    expect(withIndex.spans.map((s) => s.headIndex)).toEqual(byPlace.spans.map((s) => s.headIndex));
    expect(withIndex.unjoined).toBe(byPlace.unjoined);
  });

  it('is thrown away rather than believed when it points at a different head', () => {
    const heads = bachHeads();
    const played = bachPlayed();
    // The index says head 20 and the mark is a copy of head 3. An index taken
    // on trust would put this note on a notehead nobody looked at.
    const marks = [{ ...heads[3], note: played[0], index: 0, headIndex: 20 }];
    const bridge = syncTake({ heads, played, pairing: { placed: true, marks } });
    expect(bridge.spans[0].headIndex).toBe(3);
    expect(bridge.unjoined).toBe(0);
  });

  it('and an index that is not an index at all falls back to the place join', () => {
    const heads = bachHeads();
    const played = bachPlayed();
    for (const bad of [-1, 1e6, 2.5, null, undefined, NaN, '4']) {
      const marks = [{ ...heads[7], note: played[0], index: 0, headIndex: bad }];
      const bridge = syncTake({ heads, played, pairing: { placed: true, marks } });
      expect(bridge.spans[0].headIndex).toBe(7);
    }
  });
});
