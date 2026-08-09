// Timing measured against the rhythm that was written.
//
// rhythm.js already measures how EVEN a take is — the spacing between onsets,
// with no idea what the spacing was supposed to be. That is the best you can do
// without a score, and it cannot tell a dotted rhythm from a rushed one. With
// the score aligned, the notated duration of every note is known, so for the
// first time the app can say "you rushed the dotted eighth" instead of "your
// spacing was uneven". This module is that difference.
//
// Two things are deliberately robust rather than exact:
//
//   * Tempo comes from the MEDIAN of the note-to-note slopes, not a least
//     squares line. Stop for six seconds to turn a page and least squares
//     rewrites the tempo of the whole take; a median does not notice.
//   * A note is measured against WHERE THE PREVIOUS NOTE PUT IT — the note
//     before it, plus the local tempo times the written gap. Measuring against
//     an absolute grid instead sounds more rigorous and is worse: come in late
//     once and carry on from there and every remaining note in the piece is
//     reported late, which is both useless and untrue. What a player can act on
//     is the entry that moved, and this reports exactly that one.
//     Drift across the whole take is not lost — it is what `curve` and
//     `driftBpm` are for.

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Seconds per beat between each pair of neighbouring notes.
function slopesBetween(points, from, to) {
  const out = [];
  for (let i = Math.max(1, from); i <= Math.min(points.length - 1, to); i++) {
    const beats = points[i].beats - points[i - 1].beats;
    if (beats <= 0) continue; // grace notes and chord members share a moment
    out.push((points[i].start - points[i - 1].start) / beats);
  }
  return out;
}

const EMPTY = { bpm: null, secondsPerBeat: null, curve: [], driftBpm: null, worst: [] };

export function scoreTiming(attempts, { toleranceMs = 50, window = 4, targetBpm = null } = {}) {
  const list = attempts ?? [];

  const points = [];
  for (let i = 0; i < list.length; i++) {
    const played = list[i]?.played;
    const beats = list[i]?.score?.onsetBeats;
    if (!played || !Number.isFinite(beats) || !Number.isFinite(played.start)) continue;
    points.push({ index: i, beats, start: played.start });
  }

  const blank = () => list.map((attempt, index) => ({
    index,
    attempt,
    scoreNoteId: attempt?.scoreNoteId ?? null,
    measure: attempt?.score?.measure ?? null,
    expectedSec: null,
    deviationMs: null,
    verdict: attempt?.played ? 'unknown' : (attempt?.verdict ?? 'missed'),
  }));

  const overall = median(slopesBetween(points, 1, points.length - 1));
  if (points.length < 2 || !overall || overall <= 0) {
    return { ...EMPTY, targetBpm: targetBpm ?? null, perNote: list.length ? blank() : [] };
  }

  // A tempo you set is a grid that does NOT move to follow you. That is the
  // whole difference: without a target the report finds the pulse you actually
  // played and reads each entry against its neighbours, so a phrase that shifts
  // and stays shifted is one late entry. Against a target, the beat stays where
  // the metronome would have put it, so a phrase that shifts is late from there
  // on — which is exactly what you want to see when you are trying to hold a
  // tempo rather than play evenly.
  //
  // The grid starts where you started: the phase is taken from the opening few
  // notes rather than from the whole take, so playing steadily faster than the
  // target reads as running away from it, not as being early at the start and
  // late at the end of some average.
  if (targetBpm) {
    const targetSpb = 60 / targetBpm;
    const opening = points.slice(0, Math.min(4, points.length))
      .map((p) => p.start - targetSpb * p.beats);
    const phase = median(opening) ?? 0;

    const perNoteTargeted = blank();
    const curveTargeted = [];
    for (let k = 0; k < points.length; k++) {
      const lo = Math.max(0, k - window);
      const hi = Math.min(points.length - 1, k + window);
      const localSlope = median(slopesBetween(points, lo + 1, hi)) ?? overall;
      const expected = phase + targetSpb * points[k].beats;
      const deviationMs = (points[k].start - expected) * 1000;
      const entry = perNoteTargeted[points[k].index];
      entry.expectedSec = expected;
      entry.deviationMs = deviationMs;
      entry.verdict = Math.abs(deviationMs) <= toleranceMs
        ? 'on' : deviationMs > 0 ? 'late' : 'early';
      curveTargeted.push({ beats: points[k].beats, sec: points[k].start, bpm: 60 / localSlope });
    }

    const beatsSpanned = points.at(-1).beats - points[0].beats;
    const timedT = perNoteTargeted.filter((n) => n.deviationMs !== null);
    return {
      bpm: 60 / overall,
      secondsPerBeat: overall,
      targetBpm,
      // Positive = you got there before the metronome would have.
      driftFromTargetMs: (targetSpb - overall) * beatsSpanned * 1000,
      aheadOfTarget: overall < targetSpb,
      perNote: perNoteTargeted,
      curve: curveTargeted,
      driftBpm: curveTargeted.length > 1
        ? curveTargeted.at(-1).bpm - curveTargeted[0].bpm : 0,
      worst: perNoteTargeted
        .filter((n) => n.deviationMs !== null && n.verdict !== 'on')
        .sort((a, b) => Math.abs(b.deviationMs) - Math.abs(a.deviationMs))
        .slice(0, 10),
      onBeat: perNoteTargeted.filter((n) => n.verdict === 'on').length,
      counted: timedT.length,
      meanAbsMs: timedT.length
        ? timedT.reduce((s, n) => s + Math.abs(n.deviationMs), 0) / timedT.length : null,
    };
  }

  const perNote = blank();
  const curve = [];

  for (let k = 0; k < points.length; k++) {
    const lo = Math.max(0, k - window);
    const hi = Math.min(points.length - 1, k + window);

    // The local tempo. Pairs touching this note stay in — a median of eight
    // shrugs off the one or two a single displaced note disturbs.
    const localSlope = median(slopesBetween(points, lo + 1, hi)) ?? overall;

    const previous = points[k - 1];
    const expected = previous
      ? previous.start + localSlope * (points[k].beats - previous.beats)
      : points[k].start; // nothing before the first note to be early or late against

    points[k].expected = expected;
    points[k].deviationMs = (points[k].start - expected) * 1000;
    curve.push({ beats: points[k].beats, sec: points[k].start, bpm: 60 / localSlope });
  }

  // One displaced note produces two readings: late going in, and exactly as
  // early coming back out. The second is not a second mistake — it is the
  // player returning to the beat, which is the right thing to do. Cancel it.
  // A shift that PERSISTS has no rebound, so it survives this untouched and
  // stays reported as the single late entry it was.
  for (let k = 0; k < points.length - 1; k++) {
    const here = points[k].deviationMs;
    const next = points[k + 1].deviationMs;
    if (Math.abs(here) > toleranceMs && Math.abs(here + next) <= toleranceMs) {
      points[k + 1].deviationMs = 0;
    }
  }

  for (const point of points) {
    const entry = perNote[point.index];
    entry.expectedSec = point.expected;
    entry.deviationMs = point.deviationMs;
    entry.verdict = Math.abs(point.deviationMs) <= toleranceMs
      ? 'on'
      : point.deviationMs > 0 ? 'late' : 'early';
  }

  const worst = perNote
    .filter((n) => n.deviationMs !== null && n.verdict !== 'on')
    .sort((a, b) => Math.abs(b.deviationMs) - Math.abs(a.deviationMs))
    .slice(0, 10);

  const onBeat = perNote.filter((n) => n.verdict === 'on').length;
  const timed = perNote.filter((n) => n.deviationMs !== null);

  return {
    bpm: 60 / overall,
    secondsPerBeat: overall,
    targetBpm: null,
    driftFromTargetMs: null,
    aheadOfTarget: null,
    perNote,
    curve,
    driftBpm: curve.length > 1 ? curve[curve.length - 1].bpm - curve[0].bpm : 0,
    worst,
    onBeat,
    counted: timed.length,
    meanAbsMs: timed.length
      ? timed.reduce((sum, n) => sum + Math.abs(n.deviationMs), 0) / timed.length
      : null,
  };
}
