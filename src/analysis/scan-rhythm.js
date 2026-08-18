// The honest join: a per-note rhythm verdict where the page can be believed,
// and a bar-level one where it cannot.
//
// Two files already exist on either side of this and neither could reach the
// other. score-timing.js gives the verdict a player can act on — "you rushed
// the dotted quaver" — and it needs a WRITTEN duration for every note, which
// until now meant MusicXML. scan-timing.js works on a photograph and gives
// "that BAR was late", because a photograph's note values were not read. They
// are read now (scan-stems.js) and scan-values.js decides, BAR BY BAR, whether
// they may be believed. This module is the wire between those three, and the
// whole of its design is in what it does with the bars scan-values refuses.
//
// THE RULE IT IS BUILT AROUND: a refused bar gets a COARSER answer, never a
// wrong one. It does not get the neighbouring bar's beats, it does not get an
// average bar, and it does not get a per-note verdict computed from durations
// that did not add up. It gets the bar-level report scan-timing.js already
// makes, and the returned data says which of the two every single verdict came
// from, so a UI can word them differently instead of blending them into one
// confident-looking number.
//
// WHAT IT WILL SAY ON A REAL PAGE TODAY, so that nobody reads the code and
// assumes otherwise. MEASURED, npm run scan:values: validateValues believes
// ZERO bars on all three photographs in this repo — 0 of 39 (Bach), 0 of 38
// (Mozart), 0 of 37 (Scanned) — so the written branch below does not fire on
// any of them and every take falls entirely down the bar-level route. That is
// not a bug in this file and it is not the beam counting either: the Bach page
// reads 315 of its 318 marked heads as semiquavers on a page that is twenty
// bars of sixteen semiquavers (99.1%) and is still refused, because the bar
// GROUPING is roughly doubled upstream in notesInOrder and because chords are
// summed as two notes on one onset. The join is built anyway, because the
// alternative is that the day one of those two is fixed there is still nothing
// that turns a believed bar into a verdict — and because the branch that DOES
// fire, the refusal, is the one a user meets and it needs to be deliberate
// rather than accidental.
//
// AND HERE IS WHAT THE GROUPING IS COSTING, measured rather than asserted. The
// Bach photograph really is twenty bars of sixteen semiquavers. Run the join
// over that page's own 324 heads and its own read values, with nothing changed
// except the bars regrouped to the sixteen heads the print actually puts in
// one — which is a probe, not a fix, and it is only valid on that page because
// only that page is uniform:
//
//     as the reader bars it   0 of 36 bars believed, 0 notes judged, 321 even
//     regrouped to 16/bar    16 of 20 bars believed, 256 notes on the written
//                            route (252 judged in 4 runs, 4 anchors), 64 even
//
// So the values on that page are already good enough to carry a per-note
// verdict for four notes in five, and the only thing standing between a player
// and it is where the barlines were counted. Regrouping Mozart and Scanned the
// same way changes nothing (0 of 21 and 0 of 28) and is not evidence about
// them: neither page is uniform, so sixteen heads is not their bar either.

import { scanTiming, barValues } from './scan-timing.js';
import { validateValues, beatsFor } from './scan-values.js';
import { scoreTiming } from './score-timing.js';

// Nothing could be established. Every question answers null and the arrays are
// empty rather than absent, so a caller needs no branch — the same shape the
// time bridge settled on, and for the same reason: a missing field reads as
// "not asked" and an empty one reads as "asked, and the answer is none".
function nothing(why) {
  return {
    placed: false,
    why,
    timing: null,
    bars: [],
    barsBelieved: 0,
    barsRefused: 0,
    beatsPerBar: null,
    coverage: null,
    valuesWhy: why,
    perNote: [],
    runs: [],
    notesFromWritten: 0,
    notesJudged: 0,
    notesAnchored: 0,
    notesFromEven: 0,
    meanAbsMsWritten: null,
    meanOffMsEven: null,
  };
}

/**
 * Rhythm for a take placed on a scanned page.
 *
 * `marks` is the pairing's marks — one per played note, carrying the head it
 * landed on (`beats`, `bar`, `staff`, `page`) and the note itself (`note.start`
 * and `note.end`, in seconds in the recording).
 *
 * Returns a report whose two halves are kept apart on purpose:
 *
 *   bars[]     one entry per bar the take passed through, each saying whether
 *              its written values were BELIEVED, what it summed to, how long it
 *              actually took and how that compares with the take's typical bar.
 *              This is the coarse answer and it exists for every bar.
 *   perNote[]  one entry per note that could be judged, each carrying `from`:
 *              'written' — the bar was believed, the note was measured against
 *              the duration printed on the page, and `verdict` is the same
 *              early/on/late an engraved score gets;
 *              'even'    — the bar was refused and the take was found evenly
 *              spaced, so the note is measured against an EQUAL division of its
 *              bar. That is a different claim and it gets no early/late word:
 *              `offFromEqualMs` says how far from an equal division it fell,
 *              and nothing here knows whether an equal division is what
 *              was written.
 *
 * THE TWO ROUTES DO NOT SHARE A NUMBER, and there is deliberately no field a
 * UI can colour both with. `deviationMs` (written route only) is score-timing's
 * measure and it is LOCAL — the note against the one before it plus the tempo
 * around them, which is the whole argument in that file's header: shift once
 * and stay shifted and it reports the one entry that moved. `offFromEqualMs`
 * (even route only) is ABSOLUTE — the note against its place in an equal
 * division of its own bar, so the same shifted take marks every note after the
 * shift. On one scale those two would be the same colour meaning opposite
 * things. The two means are reported separately for the same reason and are
 * never averaged together.
 */
export function scanRhythm(marks, { toleranceMs = 50 } = {}) {
  const timing = scanTiming(marks);
  if (!timing) return nothing('the take did not reach three bars on the page, so there is nothing to compare');

  const perBar = timing.perBar ?? [];
  const values = perBar.map(barValues);
  const decision = validateValues(values);

  // Which bars may be spoken about note by note.
  //
  // validateValues' own `trusted` is necessary and not sufficient, and the two
  // extra clauses are the same ones scan-timing.js applies: a bar needs one
  // value per note (a mark without a head's `beats` leaves a hole) and every
  // one of them positive. A zero in the middle of a bar that happens to sum
  // right anyway would put every note after it in the wrong place, which is
  // precisely the confident wrong answer this join exists to avoid.
  const believed = perBar.map((bar, i) => decision.ok
    && decision.trusted.has(i)
    && values[i].length === bar.count
    && values[i].every((v) => v > 0));

  const placed = beatsFor(values, decision.ok
    ? decision
    : { beatsPerBar: null, trusted: new Set() });

  const perNote = [];
  const runs = [];

  // RUNS OF BELIEVED BARS, and each run is measured on its own.
  //
  // beatsFor numbers bars from the start of the page and prices every bar at
  // the agreed length, believed or not. Inside a run of bars that were ALL
  // believed that arithmetic is exact — each of them was believed precisely
  // because it summed to that length. Across a refused bar it is a guess about
  // how long that bar was, and score-timing.js measures every note against the
  // one before it, so the guess would land as a confident early-or-late on the
  // first note after the gap. So the run stops there.
  //
  // It also stops at a PAGE change and at a discarded bar. A page turn is a
  // pause that is not written in the music, and a bar the runt filter threw
  // away is a hole of unknown length; in both cases the note on the far side
  // has nothing trustworthy behind it to be late against.
  let run = null;
  for (const [i, bar] of perBar.entries()) {
    const joins = believed[i] && run
      && perBar[i - 1]?.page === bar.page
      && perBar[i - 1]?.order === bar.order - 1;
    if (!believed[i]) { run = null; continue; }
    if (!joins) { run = { bars: [] }; runs.push(run); }
    run.bars.push(i);
  }

  // Where each bar's notes start in the flat list beatsFor returned.
  //
  // A NULL BAR CONTRIBUTES NOTHING, and this has to match beatsFor exactly or
  // every bar after it is read off the wrong entries. barValues returns null
  // for a bar holding a value it could not read (see the note there), and
  // beatsFor iterates `bar ?? []`, so such a bar pushes no entries at all.
  // Advancing by its note count instead would slide `placed` under every later
  // bar by that many notes — a silent off-by-n in exactly the direction that
  // reports the wrong note as late.
  const startOf = [];
  let at = 0;
  for (const bar of values) { startOf.push(at); at += bar?.length ?? 0; }

  for (const entry of runs) {
    // The shape score-timing.js speaks: a played note, and where the page says
    // it belongs. Nothing else about the note is needed or offered.
    const attempts = [];
    for (const b of entry.bars) {
      const bar = perBar[b];
      for (const [k, note] of bar.notes.entries()) {
        attempts.push({
          played: note,
          score: {
            onsetBeats: placed[startOf[b] + k]?.onsetBeats ?? null,
            measure: placed[startOf[b] + k]?.measure ?? null,
          },
          verdict: bar.marks?.[k]?.verdict ?? null,
          bar,
          barIndex: b,
          mark: bar.marks?.[k] ?? null,
          beats: values[b][k],
        });
      }
    }
    const report = scoreTiming(attempts, { toleranceMs });
    entry.notes = attempts.length;
    entry.bpm = report.bpm;

    // THE FIRST NOTE OF A RUN IS AN ANCHOR, NOT AN ON-TIME NOTE.
    //
    // score-timing.js measures a note against the one before it, so its first
    // note has nothing to be early or late against and comes back with a
    // deviation of exactly zero — which reads as a verdict of 'on'. On an
    // engraved score that happens once in a take and is harmless. Here a page
    // can break into a dozen short runs of believed bars, and a dozen free
    // 'on's is a page telling a player they nailed a note nobody measured.
    // Named instead: 'anchor', deviation null, counted apart.
    // …and only if there was a measurement at all. A run score-timing.js could
    // not read a tempo from returns every note blank, and the first of those is
    // not an anchor — the run simply failed, and calling it an anchor would say
    // the note was the one everything else was measured against.
    const measured = Number.isFinite(report.bpm) && report.bpm > 0;
    const first = measured
      ? attempts.findIndex((a) => Number.isFinite(a.score.onsetBeats)
        && Number.isFinite(a.played?.start))
      : -1;
    for (const [k, judged] of report.perNote.entries()) {
      const attempt = attempts[k];
      const anchor = k === first;
      perNote.push({
        note: attempt.played,
        mark: attempt.mark,
        bar: attempt.bar.key,
        page: attempt.bar.page,
        staff: attempt.bar.staff,
        beats: attempt.beats,
        from: 'written',
        believed: true,
        onsetBeats: attempt.score.onsetBeats,
        expectedSec: anchor ? null : judged.expectedSec,
        deviationMs: anchor ? null : judged.deviationMs,
        offFromEqualMs: null,
        // 'anchor' where there is nothing behind it, and NULL — not a word —
        // where score-timing.js could not place the note at all: a run of one
        // note, or a note with no start. score-timing.js calls that 'unknown',
        // which is a fine word inside a report that also carries a bpm and
        // reads as a verdict once it is standing next to 'late'.
        verdict: anchor ? 'anchor' : (judged.verdict === 'unknown' ? null : judged.verdict),
      });
    }
  }

  // THE FALLBACK, and it is the branch every real page in this repo takes.
  //
  // A refused bar gets its bar-level numbers below and no per-note verdict from
  // the written values — there are none to be had, that is what refused means.
  // What it can still get is scan-timing.js's own even-spacing reading, and
  // only where scan-timing.js itself judged the take evenly spaced. It is
  // carried through here rather than recomputed, it is labelled `from: 'even'`,
  // and it deliberately has NO early/late word: how far a note fell from an
  // equal division of its bar is a fact; calling it late means claiming the
  // page wrote equal notes, and nothing here read that.
  //
  // These entries carry their notehead like the written ones do. The fallback
  // is the branch every real page in this repo takes — 321, 329 and 433 of the
  // three photographs' notes by the probe in this file's header — so an entry a
  // UI cannot put a ring on would make the coarse route unusable exactly where
  // it is the only route. Located by the IDENTITY of the played note, not by
  // its `${page}|${staff}|${bar}` key: barsOf starts a new group whenever that
  // key changes, so the same key can legitimately occur twice on one take, and
  // a lookup by key would then hand back one of the two.
  const where = new Map();
  for (const bar of perBar) {
    for (const [k, note] of bar.notes.entries()) where.set(note, { bar, k });
  }
  for (const note of timing.notes ?? []) {
    if (note.fromWritten) continue;
    const at = where.get(note.note) ?? null;
    perNote.push({
      note: note.note,
      mark: at?.bar.marks?.[at.k] ?? null,
      bar: note.bar,
      page: at?.bar.page ?? null,
      staff: at?.bar.staff ?? null,
      beats: null,
      from: 'even',
      believed: false,
      onsetBeats: null,
      expectedSec: note.wanted,
      deviationMs: null,
      offFromEqualMs: note.offBy * 1000,
      verdict: null,
    });
  }

  const bars = perBar.map((bar, i) => ({
    index: i,
    key: bar.key,
    page: bar.page,
    staff: bar.staff,
    notes: bar.count,
    believed: believed[i],
    // What its values came to, against what the page's bars agreed on. Both
    // numbers, so "this bar came to 3.5 where the page's bars are 4" can be
    // said without the reader having to guess which note was missed.
    //
    // NULL WHERE A VALUE WAS NOT READ AT ALL, because barValues refuses the
    // whole bar in that case. Summing only the values that WERE read would put
    // a smaller number in front of a player as this bar's length — the
    // reader's own hole, shown as the page's rhythm.
    beats: values[i]?.reduce((a, b) => a + b, 0) ?? null,
    beatsPerBar: decision.ok ? decision.beatsPerBar : null,
    why: believed[i] ? null : (values[i] == null
      ? 'a note in this bar has no value the reader could read, so the bar cannot be added up'
      : decision.ok
        ? 'the values read for this bar do not add up to a bar'
        : decision.why),
    // The bar-level verdict, and it stays a number for the reason written over
    // `perBar` in scan-timing.js: there is no hand-marked rhythm in this repo
    // to measure a rushed/dragged cutoff against.
    length: bar.length,
    ratio: bar.ratio,
    worst: bar.worst,
    // Seconds in the recording. Named `startsAt`/`endsAt` and not `from`/`to`
    // because a perNote entry's `from` is a ROUTE — 'written' or 'even' — and
    // one field name meaning a time on one shape and a provenance on the other
    // is how a UI ends up printing "this bar came from 14.75".
    startsAt: bar.from,
    endsAt: bar.to,
  }));

  // In the order they were played, not written-route first and fallback after.
  // A caller drawing the take walks this array; two routes concatenated would
  // draw the page twice.
  perNote.sort((a, b) => (a.note?.start ?? Infinity) - (b.note?.start ?? Infinity));

  const written = perNote.filter((n) => n.from === 'written');
  const judged = written.filter((n) => Number.isFinite(n.deviationMs));
  const even = perNote.filter((n) => n.from === 'even');
  const mean = (list, pick) => (list.length
    ? list.reduce((s, n) => s + Math.abs(pick(n)), 0) / list.length : null);
  // Each mean's denominator is a count already in this report and is named in
  // the comment beside it rather than repeated as a second field — two fields
  // holding the same number is how they end up disagreeing.

  return {
    placed: true,
    why: null,
    // The whole bar-level report, unchanged, because it is the answer on every
    // page measured so far and a caller must not have to reassemble it.
    timing,
    bars,
    barsBelieved: believed.filter(Boolean).length,
    barsRefused: believed.filter((b) => !b).length,
    beatsPerBar: decision.ok ? decision.beatsPerBar : null,
    coverage: decision.coverage,
    valuesWhy: decision.ok ? null : decision.why,
    perNote,
    runs: runs.map((r) => ({ bars: r.bars.length, notes: r.notes ?? 0, bpm: r.bpm ?? null })),
    notesFromWritten: written.length,
    notesJudged: judged.length,
    notesAnchored: written.filter((n) => n.verdict === 'anchor').length,
    notesFromEven: even.length,
    // TWO MEANS, NEVER ONE. A single number over both routes would average a
    // verdict against a printed duration with a verdict against an assumption
    // about the printing, and the result would look like one measurement of one
    // thing.
    //
    // Over `notesJudged` notes: how far each was from where the page's own
    // durations put it, against the note before it.
    meanAbsMsWritten: mean(judged, (n) => n.deviationMs),
    // Over `notesFromEven` notes: how far each was from an equal division of
    // its bar. A different question about a different set of notes.
    meanOffMsEven: mean(even, (n) => n.offFromEqualMs),
  };
}
