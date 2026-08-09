// A few bars of a piece, followed across every session you play them.
//
// passages.js already does this for a span of a RECORDING, keyed on a name you
// type. With a score there is something better to key on: the bars themselves.
// Bars 9–16 of this piece are the same bars tomorrow without anyone naming
// anything, so an attempt at them is recorded every time the piece is played
// and the history builds itself.
//
// Everything here is pure: attempts and timing in, plain numbers out. What is
// stored, when it is stored, and how it is drawn all live elsewhere.

const NOISE_CENTS = 3; // below this a change is measurement, not playing

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// The aligned attempts whose written note falls in these bars, ends included.
export function passageRange(attempts, fromMeasure, toMeasure) {
  const lo = Math.min(fromMeasure, toMeasure);
  const hi = Math.max(fromMeasure, toMeasure);
  return (attempts ?? []).filter((a) => {
    const bar = a?.score?.measure;
    return Number.isFinite(bar) && bar >= lo && bar <= hi;
  });
}

// One session's attempt at those bars.
export function passageAttempt(attempts, timing, fromMeasure, toMeasure) {
  const inside = passageRange(attempts, fromMeasure, toMeasure);
  if (inside.length === 0) return null;

  const timingById = new Map(
    (timing?.perNote ?? []).filter((n) => n.scoreNoteId).map((n) => [n.scoreNoteId, n]),
  );

  const perNote = [];
  let missed = 0;
  for (const a of inside) {
    if (!a.played) { missed++; continue; }
    perNote.push({
      scoreNoteId: a.scoreNoteId,
      measure: a.score.measure,
      cents: a.played.cents,
      deviationMs: timingById.get(a.scoreNoteId)?.deviationMs ?? null,
      verdict: a.verdict,
    });
  }
  if (perNote.length === 0) return null;

  const deviations = perNote.map((n) => n.deviationMs).filter(Number.isFinite);
  return {
    fromMeasure: Math.min(fromMeasure, toMeasure),
    toMeasure: Math.max(fromMeasure, toMeasure),
    noteCount: inside.length,
    played: perNote.length,
    missed,
    // A missed note has no cents; counting it as zero would make giving up on a
    // note look like playing it perfectly.
    absMeanCents: mean(perNote.map((n) => Math.abs(n.cents))),
    meanAbsMs: deviations.length ? mean(deviations.map(Math.abs)) : null,
    perNote,
  };
}

// This attempt against an earlier one. Negative deltas are improvements —
// every number here is a distance from correct, so smaller is better.
export function comparePassages(now, before) {
  if (!now || !before) return null;

  const previous = new Map((before.perNote ?? []).map((n) => [n.scoreNoteId, n]));
  const perNote = [];
  for (const note of now.perNote ?? []) {
    const was = previous.get(note.scoreNoteId);
    if (!was) continue; // a note with no counterpart is not a comparison
    const delta = Math.abs(note.cents) - Math.abs(was.cents);
    perNote.push({
      scoreNoteId: note.scoreNoteId,
      measure: note.measure,
      cents: note.cents,
      wasCents: was.cents,
      delta,
      verdict: Math.abs(delta) < NOISE_CENTS ? 'same' : delta < 0 ? 'better' : 'worse',
    });
  }

  const centsDelta = (now.absMeanCents ?? 0) - (before.absMeanCents ?? 0);
  return {
    centsDelta,
    msDelta: Number.isFinite(now.meanAbsMs) && Number.isFinite(before.meanAbsMs)
      ? now.meanAbsMs - before.meanAbsMs : null,
    improved: centsDelta < 0,
    perNote,
    better: perNote.filter((n) => n.verdict === 'better').length,
    worse: perNote.filter((n) => n.verdict === 'worse').length,
  };
}

// Every attempt at these bars, oldest first, and what the journey looks like.
export function passageHistory(records) {
  const attempts = [...(records ?? [])]
    .filter((r) => Number.isFinite(r?.stats?.absMeanCents))
    .sort((a, b) => a.date - b.date);

  if (attempts.length === 0) {
    return { attempts: [], series: [], first: null, latest: null, best: null, sinceFirst: null, sinceLast: null };
  }

  const series = attempts.map((a) => a.stats.absMeanCents);
  const latest = series.at(-1);
  return {
    attempts,
    series,
    first: series[0],
    latest,
    best: Math.min(...series),
    sinceFirst: series.length > 1 ? latest - series[0] : null,
    sinceLast: series.length > 1 ? latest - series.at(-2) : null,
  };
}
