// The coach: turns the library's saved takes into personal intonation
// habits. Pure functions over lightweight note stats — no audio needed.
//
// sessions: [{ date: ms-epoch, noteStats: [{ midi, name, cents }],
//              landingStats: [{ midi, band, onsetCents, settleMs }] }]

import { LEAP_BANDS, named } from './landing.js';

const VERDICT_CENTS = 6; // a mean past this reads as a real habit, not noise

export function aggregateTendencies(sessions, { minCount = 3 } = {}) {
  const byMidi = new Map();
  for (const s of sessions) {
    for (const n of s.noteStats ?? []) {
      if (!Number.isFinite(n?.midi) || !Number.isFinite(n?.cents)) continue;
      if (!byMidi.has(n.midi)) byMidi.set(n.midi, { midi: n.midi, name: n.name, cents: [] });
      byMidi.get(n.midi).cents.push(n.cents);
    }
  }
  const rows = [];
  for (const e of byMidi.values()) {
    if (e.cents.length < minCount) continue; // too few samples to call a habit
    const meanCents = e.cents.reduce((a, b) => a + b, 0) / e.cents.length;
    const absMeanCents = e.cents.reduce((a, b) => a + Math.abs(b), 0) / e.cents.length;
    // Spread, not just direction. A player whose D3 is 15¢ sharp half the time
    // and 15¢ flat the other half has a mean of zero and a real problem; for
    // anyone past the beginner stage this is the number that still moves.
    const variance = e.cents.reduce((a, c) => a + (c - meanCents) ** 2, 0) / e.cents.length;
    rows.push({
      midi: e.midi,
      name: e.name,
      count: e.cents.length,
      meanCents,
      absMeanCents,
      spreadCents: Math.sqrt(variance),
      verdict: meanCents >= VERDICT_CENTS ? 'sharp'
        : meanCents <= -VERDICT_CENTS ? 'flat'
        : 'centered',
    });
  }
  return rows.sort((a, b) => b.midi - a.midi); // high notes first, like a fingerboard
}

function dayKey(ms) {
  const d = new Date(ms);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// One point per practice day: how far off (in |cents|) the average note ran.
export function dailyScores(sessions) {
  const byDay = new Map();
  for (const s of sessions) {
    const key = dayKey(s.date);
    if (!byDay.has(key)) byDay.set(key, []);
    for (const n of s.noteStats ?? []) {
      if (Number.isFinite(n?.cents)) byDay.get(key).push(Math.abs(n.cents));
    }
  }
  return [...byDay.entries()]
    .filter(([, cents]) => cents.length > 0)
    .map(([day, cents]) => ({
      day,
      absMean: cents.reduce((a, b) => a + b, 0) / cents.length,
      noteCount: cents.length,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The last 7 days vs the 7 before, plus the practice streak.
// `now` is injected so the week boundary is testable.
export function weeklyReport(sessions, now) {
  const days = dailyScores(sessions);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const inWindow = (offsetStart, offsetEnd) => {
    const collected = [];
    for (let o = offsetStart; o <= offsetEnd; o++) {
      const d = byDay.get(dayKey(now - o * DAY_MS));
      if (d) collected.push(d);
    }
    return collected;
  };
  const avg = (list) => {
    const notes = list.reduce((a, d) => a + d.noteCount, 0);
    if (notes === 0) return null;
    return list.reduce((a, d) => a + d.absMean * d.noteCount, 0) / notes;
  };
  const week = inWindow(0, 6);
  const prev = inWindow(7, 13);

  // streak: consecutive practice days counting back from today (a day off
  // today doesn't break it yet — the streak survives until tomorrow)
  let streak = 0;
  let offset = byDay.has(dayKey(now)) ? 0 : 1;
  while (byDay.has(dayKey(now - offset * DAY_MS))) {
    streak++;
    offset++;
  }

  return {
    daysPracticed: week.length,
    noteCount: week.reduce((a, d) => a + d.noteCount, 0),
    avgError: avg(week),
    prevAvgError: avg(prev),
    streak,
  };
}

// Takes grouped into pieces by their (trimmed, case-folded) name. Unnamed
// takes stay out — naming a take in the library is what makes it a piece.
export function pieceProgress(sessions) {
  const byPiece = new Map();
  for (const s of sessions) {
    const name = s.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byPiece.has(key)) byPiece.set(key, { name, takes: [] });
    const cents = (s.noteStats ?? []).map((n) => Math.abs(n.cents)).filter(Number.isFinite);
    if (cents.length === 0) continue;
    byPiece.get(key).takes.push({
      date: s.date,
      absMean: cents.reduce((a, b) => a + b, 0) / cents.length,
      noteCount: cents.length,
    });
  }
  const pieces = [];
  for (const p of byPiece.values()) {
    if (p.takes.length === 0) continue;
    p.takes.sort((a, b) => a.date - b.date);
    pieces.push({
      name: p.name,
      takes: p.takes,
      latest: p.takes.at(-1).absMean,
      delta: p.takes.length >= 2 ? p.takes.at(-1).absMean - p.takes[0].absMean : null,
    });
  }
  return pieces.sort((a, b) => b.takes.at(-1).date - a.takes.at(-1).date);
}

// --- landings across the library -------------------------------------------
//
// Same idea as the tendency map, applied to how notes are arrived at rather
// than where they end up. Reads `landingStats` off each session's metadata, so
// it costs nothing and covers every take ever saved.


const CLEAN_MS = 60;

export function aggregateLandings(sessions, { minCount = 5, motion = null } = {}) {
  const rows = [];
  for (const s of sessions) {
    for (const l of s.landingStats ?? []) {
      if (!Number.isFinite(l?.onsetCents)) continue;
      rows.push({ ...l, date: s.date });
    }
  }
  if (rows.length < minCount) return null;

  const cleanOf = (list) =>
    list.filter((l) => Number.isFinite(l.settleMs) && l.settleMs <= CLEAN_MS).length / list.length;

  const byBand = LEAP_BANDS.map((band) => {
    const inBand = rows.filter((l) => l.band === band.key);
    if (inBand.length < minCount) return null;
    const onsets = inBand.map((l) => l.onsetCents);
    return {
      ...named(band, motion),
      count: inBand.length,
      cleanShare: cleanOf(inBand),
      meanOnsetCents: onsets.reduce((a, b) => a + b, 0) / onsets.length,
    };
  }).filter(Boolean);

  // The band you land worst — what a practice session should actually open with
  const weakest = [...byBand].sort((a, b) => a.cleanShare - b.cleanShare)[0] ?? null;

  return {
    count: rows.length,
    cleanShare: cleanOf(rows),
    meanOnsetCents: rows.reduce((a, l) => a + l.onsetCents, 0) / rows.length,
    byBand,
    weakest,
  };
}

// Clean-landing share per practice day, for the trend line.
export function dailyLandings(sessions) {
  const byDay = new Map();
  for (const s of sessions) {
    const key = dayKey(s.date);
    if (!byDay.has(key)) byDay.set(key, []);
    for (const l of s.landingStats ?? []) {
      if (Number.isFinite(l?.onsetCents)) byDay.get(key).push(l);
    }
  }
  return [...byDay.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([day, list]) => ({
      day,
      cleanShare: list.filter((l) => Number.isFinite(l.settleMs) && l.settleMs <= CLEAN_MS).length
        / list.length,
      count: list.length,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

// The notes most worth drilling: strongest directional habits first.
export function pickDrills(tendencies, n = 3) {
  return tendencies
    .filter((t) => t.verdict !== 'centered')
    .sort((a, b) => Math.abs(b.meanCents) - Math.abs(a.meanCents))
    .slice(0, n);
}
