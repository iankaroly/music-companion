// One take of a piece, and what has happened to it since the last one.
//
// The score gives every note a stable identity — the same notehead on the same
// page — so two takes of the same piece can be compared note for note without
// anyone naming anything. That is what makes "am I actually getting better at
// this" answerable rather than a feeling.
//
// Pure: attempts and timing in, plain numbers out. What is stored, when, and
// how it is drawn all live elsewhere.

const NOISE_CENTS = 3; // below this a change is measurement, not playing

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// What one take did, note by note — small enough to keep forever alongside the
// recording, and all the comparison below needs.
export function takeStats(attempts, timing, { targetBpm = null } = {}) {
  const list = attempts ?? [];
  if (list.length === 0) return null;

  const timingById = new Map(
    (timing?.perNote ?? []).filter((n) => n.scoreNoteId).map((n) => [n.scoreNoteId, n]),
  );

  const perNote = [];
  let missed = 0;
  for (const a of list) {
    if (!a.played) { missed++; continue; }
    perNote.push({
      scoreNoteId: a.scoreNoteId,
      measure: a.score?.measure ?? null,
      cents: a.played.cents,
      deviationMs: timingById.get(a.scoreNoteId)?.deviationMs ?? null,
      verdict: a.verdict,
    });
  }
  if (perNote.length === 0) return null;

  const deviations = perNote.map((n) => n.deviationMs).filter(Number.isFinite);
  return {
    noteCount: list.length,
    played: perNote.length,
    missed,
    // A missed note has no cents; counting it as zero would make giving up on a
    // note look like playing it perfectly.
    absMeanCents: mean(perNote.map((n) => Math.abs(n.cents))),
    meanAbsMs: deviations.length ? mean(deviations.map(Math.abs)) : null,
    // Stored because it changes what meanAbsMs MEANS: against a target the
    // deviation is from a fixed grid, without one it is from your own pulse.
    // Two takes recorded under different settings are not the same
    // measurement, and comparing them would invent a change that never
    // happened. Cents are unaffected either way.
    targetBpm: targetBpm ?? null,
    perNote,
  };
}

// This take against an earlier one. Negative deltas are improvements — every
// number here is a distance from correct, so smaller is better.
export function compareTakes(now, before) {
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
    // Only when both were measured the same way — see targetBpm above.
    msDelta: (now.targetBpm ?? null) === (before.targetBpm ?? null)
      && Number.isFinite(now.meanAbsMs) && Number.isFinite(before.meanAbsMs)
      ? now.meanAbsMs - before.meanAbsMs : null,
    improved: centsDelta < 0,
    perNote,
    better: perNote.filter((n) => n.verdict === 'better').length,
    worse: perNote.filter((n) => n.verdict === 'worse').length,
  };
}

// Every take of this piece, oldest first, and what the journey looks like.
export function takeHistory(records) {
  const takes = [...(records ?? [])]
    .filter((r) => Number.isFinite(r?.scoreStats?.absMeanCents))
    .sort((a, b) => a.date - b.date);

  if (takes.length === 0) {
    return { takes: [], series: [], first: null, latest: null, best: null, sinceFirst: null, sinceLast: null };
  }

  const series = takes.map((t) => t.scoreStats.absMeanCents);
  const latest = series.at(-1);
  return {
    takes,
    series,
    first: series[0],
    latest,
    best: Math.min(...series),
    sinceFirst: series.length > 1 ? latest - series[0] : null,
    sinceLast: series.length > 1 ? latest - series.at(-2) : null,
  };
}
