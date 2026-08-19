// What a language model is given about a take.
//
// The temptation is to hand the model the recording. It cannot have it: the
// Messages API takes text, images and PDFs, and there is no audio content
// block — so "an AI that has listened to you" is, in every product that claims
// it today, an AI reading numbers somebody else extracted. This app already
// extracts far better numbers than a generic audio model would: every note's
// centre pitch to the cent, its onset against a pulse inferred from the playing
// itself, and how it arrived before it was corrected. So the model reads THOSE.
//
// The whole reason this is a separate module from the panel that displays it:
// a digest is a pure function of a take, so it can be tested without a browser,
// a network or a key — see test/digest.test.js.
//
// MEASURED cost, on a 63-second take of 142 notes: 2.4 KB, about 900 tokens.
// A 600-note take runs to roughly 4k. That is nothing against a 1M window, and
// it is why the per-note table is included whole rather than summarised: a
// question like "was the C sharp in the third phrase flat every time" cannot be
// answered from aggregates, and a summary that drops the notes silently turns
// that question into a confident wrong answer.
import { rhythmReport } from '../analysis/rhythm.js';
import { landingReport } from '../analysis/landing.js';

// Above this many notes the per-note table is trimmed to the outliers. It is
// not a budget — 2000 notes is still only ~30k tokens — it is a legibility
// floor: past here the take is a whole practice session rather than a passage,
// and the notes that matter are the ones that went wrong. The trim is ALWAYS
// declared in the text, because a model that cannot see the elision will answer
// "there are 600 notes" as though it had counted them.
const FULL_TABLE_LIMIT = 600;

// How far a pitch class has to lean before it is worth naming as a tendency.
// Under this the number is the detector's own spread, not the player's hand.
const LEAN_CENTS = 5;

const round = (x, places = 1) => (Number.isFinite(x)
  ? Number(x.toFixed(places))
  : null);

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function median(list) {
  const xs = list.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Intonation, which the rest of the app calls "cents": how far the note's
// SUSTAINED centre sat from equal temperament. Signed, so a take that is
// uniformly sharp reads as a bias rather than as scattered error.
function intonationOf(notes, tolerance) {
  if (notes.length === 0) return null;
  const cents = notes.map((n) => n.cents).filter(Number.isFinite);
  if (cents.length === 0) return null;

  const mean = cents.reduce((a, c) => a + c, 0) / cents.length;
  const meanAbs = cents.reduce((a, c) => a + Math.abs(c), 0) / cents.length;
  const within = cents.filter((c) => Math.abs(c) <= tolerance).length / cents.length;

  // Per pitch class rather than per note name, because "every F sharp is sharp"
  // is a fingering habit and "the F sharp at 12.4 s was sharp" is an accident.
  // Only classes played at least three times are named, for the same reason the
  // coach's tendencies need a minimum count: two notes is not a habit.
  const byClass = PITCH_CLASSES.map((pc, i) => {
    const inClass = notes.filter((n) => Number.isFinite(n.midi) && n.midi % 12 === i
      && Number.isFinite(n.cents));
    if (inClass.length < 3) return null;
    const bias = inClass.reduce((a, n) => a + n.cents, 0) / inClass.length;
    return { pc, count: inClass.length, bias };
  }).filter(Boolean).sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias));

  const worst = [...notes]
    .filter((n) => Number.isFinite(n.cents))
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
    .slice(0, 8);

  return { mean, meanAbs, within, byClass, worst };
}

// Signed, and never "-0": a bias rounded away to nothing must not read as a
// direction. A player who sees "F# -0c" believes the app found something there.
const signed = (x, places = 0) => {
  const v = Number(x.toFixed(places));
  return `${v >= 0 ? '+' : ''}${v.toFixed(places)}`;
};

/**
 * A take as text a model can answer questions about.
 *
 * Everything is optional except `notes`; the sections that cannot be computed
 * are omitted rather than filled with nulls, and the header says which ones
 * were left out, so the model can say "the recording does not carry that"
 * instead of inventing it.
 */
export function digestTake({
  notes = [],
  readings = [],
  a4 = 440,
  duration = null,
  date = null,
  name = null,
  scoreName = null,
  bpm = null,
  subdivision = 1,
  tolerance = 10,
  instrument = null,
  maxNotes = FULL_TABLE_LIMIT,
} = {}) {
  const ordered = [...notes].filter((n) => Number.isFinite(n?.start))
    .sort((a, b) => a.start - b.start);

  const lines = [];
  const head = ['TAKE'];
  if (name) head.push(JSON.stringify(name));
  if (date) head.push(new Date(date).toISOString().slice(0, 16).replace('T', ' '));
  if (Number.isFinite(duration)) head.push(`${round(duration)} s`);
  head.push(`${ordered.length} notes`);
  head.push(`A4=${a4} Hz`);
  if (instrument) head.push(instrument);
  if (scoreName) head.push(`playing from ${JSON.stringify(scoreName)}`);
  lines.push(head.join(' · '));
  lines.push(`In-tune tolerance the player has set: ${tolerance} cents.`);
  lines.push('');

  if (ordered.length === 0) {
    lines.push('No notes were detected in this take.');
    return lines.join('\n');
  }

  const tune = intonationOf(ordered, tolerance);
  if (tune) {
    lines.push('INTONATION (cents from equal temperament, + is sharp; the note\'s sustained centre, vibrato averaged out)');
    lines.push(`  mean absolute error ${round(tune.meanAbs)} c · bias ${signed(tune.mean, 1)} c · ${Math.round(tune.within * 100)}% within ${tolerance} c`);
    // Only a class that is actually leaning is named. A list that includes
    // "D -0c (4x)" reads as a finding about D, and there is no finding about D.
    const leaning = tune.byClass.filter((c) => Math.abs(c.bias) >= LEAN_CENTS).slice(0, 6);
    if (leaning.length) {
      lines.push(`  pitch classes that lean: ${leaning
        .map((c) => `${c.pc} ${signed(c.bias)}c (${c.count}x)`).join(', ')}`);
    }
    // Same rule for the worst list: a "furthest out" of eight notes all within
    // a cent of the centre is a take with nothing wrong in it, said as though
    // something were.
    const out = tune.worst.filter((n) => Math.abs(n.cents) > tolerance);
    lines.push(out.length
      ? `  furthest out: ${out.map((n) => `${round(n.start, 2)}s ${n.name} ${signed(n.cents)}c`).join(' · ')}`
      : `  no note sat further than ${tolerance} c from its centre.`);
    lines.push('');
  }

  // The pulse is inferred from the player's own onsets — there is no metronome
  // track to score against — so a take with too few notes has no timing section
  // at all rather than a fabricated tempo.
  const rhythm = rhythmReport(ordered, { bpm, subdivision });
  if (rhythm) {
    lines.push('TIMING (the pulse is inferred from the playing itself unless a tempo was locked)');
    lines.push(`  implied ${Math.round(rhythm.bpm)} bpm${rhythm.locked ? ' (locked by the metronome)' : ''} · ${rhythm.verdict}`);
    lines.push(`  mean absolute offset ${Math.round(rhythm.meanAbsMs)} ms · ${Math.round(rhythm.onBeat * 100)}% on the beat · drift ${signed(rhythm.drift * 100, 1)}% (positive = slowed down)`);
    if (rhythm.worst.length) {
      lines.push(`  notes worth naming: ${rhythm.worst
        .map((p) => `${round(p.start, 2)}s ${p.name} ${signed(p.deviationMs)}ms`).join(' · ')}`);
    } else if (rhythm.drifting) {
      lines.push('  no individual note is named: the tempo moved under the whole take, so a single note cannot be blamed for it.');
    }
    lines.push('');
  } else {
    lines.push('TIMING: not reported — too few onsets to infer a pulse.');
    lines.push('');
  }

  // Landing needs the raw frame-by-frame readings, which the library keeps
  // beside the audio. A take opened without them gets no landing section.
  const landing = readings?.length ? landingReport(ordered, readings, a4, { tolerance }) : null;
  if (landing) {
    lines.push('LANDING (how the note arrived, BEFORE it was corrected — the part a sustained reading hides)');
    lines.push(`  ${Math.round(landing.cleanShare * 100)}% arrived clean · ${landing.counts.settled} settled late · ${landing.counts.unsettled} never settled`);
    if (Number.isFinite(landing.medianSettleMs)) lines.push(`  median settle ${Math.round(landing.medianSettleMs)} ms · median arrival ${signed(landing.medianOnsetCents)} c${landing.approachBias ? ` · approaches from ${landing.approachBias}` : ''}`);
    if (landing.byBand.length) {
      lines.push(`  by leap: ${landing.byBand
        .map((b) => `${b.label ?? b.key} ${Math.round(b.cleanShare * 100)}% clean (${b.count}x)`).join(', ')}`);
    }
    lines.push('');
  }

  // The per-note table. One line per note, in the order they were played, with
  // the three numbers every question comes back to: what it was, how far out of
  // tune, and how far off the beat.
  const byIndex = new Map((rhythm?.notes ?? []).map((p) => [p.index, p]));
  const settleByStart = new Map((landing?.rows ?? []).map((r) => [r.start, r]));
  const row = (n, i) => {
    const timing = byIndex.get(i);
    const land = settleByStart.get(n.start);
    return [
      `${round(n.start, 2)}s`,
      n.name,
      `${signed(n.cents)}c`,
      timing ? `${signed(timing.deviationMs)}ms` : '—',
      `${round(n.end - n.start, 2)}s`,
      land ? (land.settled ? `settled ${Math.round(land.settleMs)}ms` : 'never settled') : '',
    ].filter(Boolean).join(' ');
  };

  const full = ordered.length <= maxNotes;
  lines.push(full
    ? 'EVERY NOTE, in order: time, name, cents out, milliseconds off the beat, duration, how it landed'
    : `THE NOTES THAT WENT WRONG. This take has ${ordered.length} notes, more than the ${maxNotes} that are listed whole, so ONLY the outliers are below — do not answer questions that need the full list without saying that the list was trimmed.`);
  const shown = full ? ordered.map((n, i) => [n, i])
    : ordered.map((n, i) => [n, i]).filter(([n, i]) => Math.abs(n.cents) > tolerance
      || Math.abs(byIndex.get(i)?.deviationMs ?? 0) > 50);
  for (const [n, i] of shown) lines.push(`  ${row(n, i)}`);

  return lines.join('\n');
}

// A one-line-per-take index of the library, so a question about practice over
// time ("am I getting better at this piece") can be answered without loading
// every take's notes. Reads the META records only — no audio is decoded.
export function digestLibrary(recordings = [], { limit = 60 } = {}) {
  const rows = [...recordings].sort((a, b) => b.date - a.date).slice(0, limit);
  if (rows.length === 0) return 'The library is empty.';
  const lines = [`LIBRARY: ${recordings.length} saved takes, ${rows.length} most recent listed.`];
  for (const r of rows) {
    const cents = (r.noteStats ?? []).map((s) => s.cents).filter(Number.isFinite);
    const meanAbs = cents.length
      ? cents.reduce((a, c) => a + Math.abs(c), 0) / cents.length : null;
    const clean = (r.landingStats ?? []).filter((s) => s.settled);
    lines.push([
      `  #${r.id}`,
      new Date(r.date).toISOString().slice(0, 10),
      r.name ? JSON.stringify(r.name) : '(unnamed)',
      `${round(r.duration)}s`,
      `${r.noteCount} notes`,
      meanAbs === null ? '' : `mean |error| ${round(meanAbs)}c`,
      r.landingStats?.length ? `${Math.round((clean.length / r.landingStats.length) * 100)}% settled` : '',
    ].filter(Boolean).join(' · '));
  }
  lines.push('Ask for a take by its id number to get every note of it.');
  return lines.join('\n');
}

export { median as _median };
