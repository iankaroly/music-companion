// Passages: a named span inside a take, tracked across takes.
//
// The name IS the identity — mark the same four bars in tomorrow's session,
// give it the same name, and the two attempts line up. That's deliberate: it
// mirrors how pieces are grouped in coach.js, and it means no score, no
// alignment and no pitch matching has to be right for the tracking to work.

import { rhythmReport } from './rhythm.js';

// Everything the coach needs about one attempt at a passage. Notes belong to
// the span by their onset, so a note held past the end still counts as played
// inside it and no note is ever counted twice.
export function passageStats(notes, startSec, endSec) {
  const inside = (notes ?? []).filter((n) => n.start >= startSec && n.start <= endSec);
  if (inside.length === 0) return null;

  const cents = inside.map((n) => Math.abs(n.cents)).filter(Number.isFinite);
  const absMeanCents = cents.length
    ? cents.reduce((a, b) => a + b, 0) / cents.length
    : null;

  // A short span has no pulse to read; better to say so than to guess.
  const timing = rhythmReport(inside);

  return {
    noteCount: inside.length,
    absMeanCents,
    bpm: timing?.bpm ?? null,
    meanAbsMs: timing?.meanAbsMs ?? null,
    evenness: timing?.evenness ?? null,
  };
}

// Attempts grouped by name, with the change since the first attempt.
export function passageProgress(passages) {
  const byName = new Map();
  for (const p of passages ?? []) {
    const name = p?.name?.trim();
    if (!name || !p.stats) continue;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    if (!byName.has(key)) byName.set(key, { name, attempts: [] });
    byName.get(key).attempts.push({
      date: p.date,
      recordingId: p.recordingId,
      absMeanCents: p.stats.absMeanCents,
      meanAbsMs: p.stats.meanAbsMs,
      bpm: p.stats.bpm,
      noteCount: p.stats.noteCount,
    });
  }

  const rows = [];
  for (const group of byName.values()) {
    const attempts = [...group.attempts].sort((a, b) => a.date - b.date);
    const first = attempts[0];
    const latest = attempts.at(-1);
    const delta = (key) => (attempts.length >= 2 && Number.isFinite(first[key]) && Number.isFinite(latest[key])
      ? latest[key] - first[key]
      : null);
    const centsDelta = delta('absMeanCents');
    const msDelta = delta('meanAbsMs');
    rows.push({
      name: group.name,
      attempts,
      latestCents: latest.absMeanCents,
      latestMs: latest.meanAbsMs,
      latestBpm: latest.bpm,
      centsDelta,
      msDelta,
      // Improving means less error than when this passage was first marked —
      // in tuning, in timing, or in both.
      improving: (centsDelta !== null && centsDelta < 0) || (msDelta !== null && msDelta < 0),
    });
  }
  return rows.sort((a, b) => b.attempts.at(-1).date - a.attempts.at(-1).date);
}
