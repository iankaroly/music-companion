// How a note ARRIVES, as opposed to where it ended up.
//
// Every tuner in existence reports the pitch of a note once it is sounding. For
// a player whose sustained intonation is already good, that number stops being
// informative — the mean error is small and stays small, and the report says
// "centred" forever. What separates a good player from an excellent one is the
// first tenth of a second: whether the note was in tune the moment it spoke, or
// arrived flat and was corrected into place.
//
// That correction is audible. On a cello it's the scoop after a shift; on a
// flute it's the embouchure settling on an entry. Neither shows up anywhere in
// a sustained-pitch reading, because by the time the note is steady the
// evidence is gone. It IS in the pitch trace this app already records, at every
// hop, for every take ever saved.
//
//   onset   — where the note spoke, before any correction
//   settle  — how long until it stayed inside the in-tune band
//   approach— which side it came from, sharp or flat
//
// The resolution is bounded by the analysis window (~46 ms of audio per
// reading) and by the segmenter's estimate of where the note began, so these
// are honest to a few tens of milliseconds and no finer. Everything downstream
// reports bands rather than exact figures for that reason.

const CONFIDENCE_FLOOR = 0.5; // attacks are noisy; the chart's 0.6 drops too many
const ONSET_SEC = 0.05;       // the opening of the note: about one analysis window
const HOLD_SEC = 0.09;        // must stay in tune this long to count as settled

// How wide a leap the player had to make to get here. Landing a step is a
// different skill from landing a tenth, and lumping them together hides the
// only part of this a player can act on.
// The distances are the same for everyone; only the words differ. A cellist
// covers a tenth with a SHIFT — a left-hand motion along a fingerboard — and a
// flutist covering the same tenth does nothing of the kind. The names come from
// the instrument profile so the report reads as though it were written for the
// person holding the instrument.
export const LEAP_BANDS = [
  { key: 'same', max: 0 },
  { key: 'step', max: 2 },
  { key: 'leap', max: 7 },
  { key: 'shift', max: Infinity },
];

export function named(band, motion = null) {
  if (!motion) return band;
  return {
    ...band,
    label: motion[band.key] ?? band.key,
    plural: motion[`${band.key}Plural`] ?? motion[band.key] ?? band.key,
  };
}

export function leapBand(semitones, motion = null) {
  const distance = Math.abs(semitones);
  return named(LEAP_BANDS.find((b) => distance <= b.max) ?? LEAP_BANDS.at(-1), motion);
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// First index whose time is >= t. Readings arrive in time order, so the window
// for a note is found by bisection rather than by scanning: this runs once per
// note, and a ten-minute take has ~1,100 notes over ~52,000 readings — scanning
// made opening its report tens of millions of iterations.
function lowerBound(readings, t) {
  let lo = 0;
  let hi = readings.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (readings[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Cents away from this note's nominal pitch, at each reading inside it.
function traceOf(note, readings, a4) {
  const out = [];
  for (let i = lowerBound(readings, note.start); i < readings.length; i++) {
    const r = readings[i];
    if (r.time > note.end) break;
    if (r.frequency === null || r.confidence < CONFIDENCE_FLOOR) continue;
    const cents = (69 + 12 * Math.log2(r.frequency / a4) - note.midi) * 100;
    // A reading an octave out is the detector slipping, not the player
    if (Math.abs(cents) > 250) continue;
    out.push({ time: r.time - note.start, cents });
  }
  return out;
}

// One note's arrival. Returns null when there isn't enough of a trace to say
// anything — a note too short to have an inside, or one the detector lost.
export function noteLanding(note, readings, a4 = 440, { tolerance = 8 } = {}) {
  const trace = traceOf(note, readings, a4);
  if (trace.length < 3) return null;

  const onsetSamples = trace.filter((p) => p.time <= ONSET_SEC);
  // A note shorter than the onset window is all onset.
  const onsetCents = median((onsetSamples.length ? onsetSamples : trace.slice(0, 3))
    .map((p) => p.cents));

  // Settled = from here on, every reading in the next HOLD_SEC is in tune.
  // Requiring it to HOLD is what separates landing the note from passing
  // through the centre on the way somewhere else.
  let settleSec = null;
  for (let i = 0; i < trace.length; i++) {
    if (Math.abs(trace[i].cents) >= tolerance) continue;
    const until = trace[i].time + HOLD_SEC;
    let held = true;
    let sawEnd = false;
    for (let j = i; j < trace.length && trace[j].time <= until; j++) {
      if (Math.abs(trace[j].cents) >= tolerance) { held = false; break; }
      if (trace[j].time >= until - 0.02) sawEnd = true;
    }
    // the note ending while still in tune counts as settled
    if (held && (sawEnd || trace.at(-1).time < until)) { settleSec = trace[i].time; break; }
  }

  const steadyCents = median(trace.filter((p) => p.time >= ONSET_SEC).map((p) => p.cents))
    ?? onsetCents;

  return {
    onsetCents,
    steadyCents,
    settleMs: settleSec === null ? null : Math.round(settleSec * 1000),
    settled: settleSec !== null,
    // where it came from, only when it started outside the band
    approach: Math.abs(onsetCents) < tolerance ? 'centred'
      : onsetCents > 0 ? 'sharp' : 'flat',
    travelCents: steadyCents - onsetCents,
  };
}

// Clean = in tune the moment it spoke, or within a hair of it. This is the
// number a player watches; it moves long before the average cents error does.
const CLEAN_MS = 60;

export function isClean(landing) {
  return landing.settled && landing.settleMs <= CLEAN_MS;
}

// Every note in a take, plus what they add up to.
export function landingReport(notes, readings, a4 = 440, { tolerance = 8, motion = null } = {}) {
  const rows = [];
  const ordered = [...(notes ?? [])].sort((a, b) => a.start - b.start);
  ordered.forEach((note, i) => {
    const landing = noteLanding(note, readings ?? [], a4, { tolerance });
    if (!landing) return;
    const previous = ordered[i - 1];
    rows.push({
      index: i,
      note,
      name: note.name,
      start: note.start,
      // the first note of a take was not arrived at from anywhere
      band: previous ? leapBand(note.midi - previous.midi, motion) : null,
      ...landing,
    });
  });
  if (rows.length < 3) return null;

  const clean = rows.filter(isClean);
  const settledLate = rows.filter((r) => r.settled && !isClean(r));
  const never = rows.filter((r) => !r.settled);

  const byBand = LEAP_BANDS.map((band) => {
    const inBand = rows.filter((r) => r.band?.key === band.key);
    if (inBand.length === 0) return null;
    return {
      ...named(band, motion),
      count: inBand.length,
      cleanShare: inBand.filter(isClean).length / inBand.length,
      medianSettleMs: median(inBand.filter((r) => r.settled).map((r) => r.settleMs)),
      medianOnsetCents: median(inBand.map((r) => r.onsetCents)),
    };
  }).filter(Boolean);

  const offCentre = rows.filter((r) => r.approach !== 'centred');
  const sharp = offCentre.filter((r) => r.approach === 'sharp').length;
  const flat = offCentre.length - sharp;

  return {
    rows,
    cleanShare: clean.length / rows.length,
    counts: { clean: clean.length, settled: settledLate.length, unsettled: never.length },
    medianSettleMs: median(settledLate.map((r) => r.settleMs)),
    medianOnsetCents: median(rows.map((r) => r.onsetCents)),
    // a bias worth naming needs both a direction and most of the misses in it
    approachBias: offCentre.length < 3 ? null
      : sharp >= offCentre.length * 0.65 ? 'sharp'
        : flat >= offCentre.length * 0.65 ? 'flat' : null,
    byBand,
    // the ones worth hearing: latest to settle first, then never-settled
    worst: [...rows]
      .filter((r) => !isClean(r))
      .sort((a, b) => (b.settleMs ?? 9999) - (a.settleMs ?? 9999))
      .slice(0, 6),
  };
}

// Per-note figures small enough to live in a recording's metadata, so the coach
// can read every take's landings without ever loading audio.
export function landingStats(notes, readings, a4 = 440, opts = {}) {
  const report = landingReport(notes, readings, a4, opts);
  if (!report) return null;
  return report.rows.map((r) => ({
    midi: r.note.midi,
    band: r.band?.key ?? null,
    onsetCents: Math.round(r.onsetCents * 10) / 10,
    settleMs: r.settleMs,
  }));
}
