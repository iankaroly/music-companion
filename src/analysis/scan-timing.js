import { validateValues } from './scan-values.js';

// Your timing, against the bars on the page.
//
// A take against a scan could say how steady your own pulse was, and that is a
// real thing to know, but it is not the thing a page of music offers. The page
// has BARS on it — the reader finds the barlines — and bars are the unit a
// player thinks in: this one rushed, that one is where it always falls apart,
// the second half is faster than the first. None of that needs a written tempo
// and none of it needs to know a crotchet from a quaver.
//
// WHAT THIS DOES NOT READ
//
// Note values. Whether a notehead is a crotchet or a semiquaver is written in
// its stem, its flags and the beams above it, and none of those are read. So
// this cannot say "that quaver was late" — it can say "that BAR was late", and
// where a bar's notes are evenly spread it can say which note inside it drifted.
//
// The even-spread assumption is the load-bearing one and it is CHECKED rather
// than assumed. A page of continuous semiquavers satisfies it completely; a
// page with a dotted rhythm or a held note does not, and on that page a
// per-note verdict would be confidently wrong. So the take is asked whether it
// looks evenly spaced, and if it does not, only the bars are reported.

// How uneven a bar's notes may be and still be called even. A bar of equal
// notes played by a person comes in around 0.1; a dotted rhythm is 0.4 and up.
const EVEN_ENOUGH = 0.28;

// Bars shorter than this are a barline the reader saw that is not there — a
// stave end, a repeat sign counted twice — and they would wreck an average.
const RUNT = 0.35;

function spread(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!(mean > 0)) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

// The bars a take passed through, in the order it played them.
//
// Grouped by the bar CHANGING rather than by a bar number, deliberately. The
// page reader numbers bars within a stave and starts again on the next one, so
// a global number has to be built by adding up barlines across staves and
// pages — and an off-by-one there gives timing that looks perfectly plausible
// and is wrong. Consecutive notes in the same bar of the same stave of the same
// page are the same bar; the moment any of those changes, so is the bar. That
// needs no arithmetic and cannot drift.
export function barsOf(marks) {
  const bars = [];
  let current = null;
  for (const mark of marks ?? []) {
    const start = mark?.note?.start;
    if (!Number.isFinite(start)) continue;
    const key = `${mark.page}|${mark.staff}|${mark.bar}`;
    if (!current || current.key !== key) {
      current = { key, page: mark.page, staff: mark.staff, notes: [], marks: [] };
      bars.push(current);
    }
    current.notes.push(mark.note);
    current.marks.push(mark);
  }
  return bars;
}

/**
 * How the take sat against the bars the page reader found.
 *
 * Everything here comes from WHEN notes were played and WHICH bar the page
 * says they are in. No written tempo, no note values, no clef.
 *
 * Returns null when there is not enough to say anything — one bar cannot be
 * compared with anything, and a take that never reached a second barline has
 * no rhythm to report that its own pulse does not already cover.
 */
export function scanTiming(marks) {
  const bars = barsOf(marks);
  if (bars.length < 3) return null;

  // A bar lasts from its first note to the first note of the next: the last
  // bar has no next, so it is measured to the end of its own last note.
  const spans = [];
  for (const [i, bar] of bars.entries()) {
    const from = bar.notes[0].start;
    const next = bars[i + 1]?.notes[0]?.start;
    const to = Number.isFinite(next) ? next : (bar.notes.at(-1).end ?? bar.notes.at(-1).start);
    const length = to - from;
    if (length > 0) spans.push({ ...bar, from, to, length, count: bar.notes.length });
  }
  if (spans.length < 3) return null;

  // A bar far shorter than its neighbours is a barline that is not a bar.
  const typical = median(spans.map((s) => s.length));
  const real = spans.filter((s) => s.length >= typical * RUNT);
  if (real.length < 3) return null;

  const lengths = real.map((s) => s.length);
  const steadiness = Math.max(0, 1 - spread(lengths));

  // Rushing or dragging, as the take goes on: the last third against the
  // first. Bars getting shorter is rushing.
  const third = Math.max(1, Math.floor(real.length / 3));
  const early = median(lengths.slice(0, third));
  const late = median(lengths.slice(-third));
  const drift = early > 0 ? (late - early) / early : 0;

  // The bar that stands out most, which is the one worth looking at.
  const worst = real.reduce((a, b) => (
    Math.abs(b.length - typical) > Math.abs(a.length - typical) ? b : a), real[0]);

  // Is a per-note verdict honest on this take?
  //
  // Only if the notes inside a bar are evenly spread — which is what a page of
  // equal notes gives and what a dotted rhythm does not. Asked of the take
  // rather than assumed of the page, because the page's note values are the
  // one thing not read.
  const gaps = real
    .filter((bar) => bar.count >= 3)
    .map((bar) => spread(bar.notes.slice(1).map((n, i) => n.start - bar.notes[i].start)))
    // Everything finite, INCLUDING zero. Nought is not a missing measurement
    // here, it is the perfect one — notes exactly evenly spread — and dropping
    // it as degenerate refused a per-note verdict on precisely the takes that
    // most deserve one.
    .filter((v) => Number.isFinite(v));
  const evenNotes = gaps.length >= 3 && median(gaps) <= EVEN_ENOUGH;

  // Where each note sat inside its bar.
  //
  // Two ways of knowing, and the better one is used where it can be. If the
  // note VALUES were read off the page and the bars they make add up, then a
  // bar says exactly where each of its notes belongs — a dotted quaver is
  // three quarters of a beat in, and no assumption is needed. Where they were
  // not read, or do not add up, the fallback is that the notes of a bar are
  // equal, which is true of a page of semiquavers and false of the first
  // dotted rhythm.
  const written = validateValues(real.map((bar) => bar.notes.map((_, k) => bar.marks?.[k]?.beats ?? 0)));
  const notes = [];
  const useWritten = written.ok;
  if (useWritten || evenNotes) {
    for (const [b, bar] of real.entries()) {
      const values = bar.marks?.map((m) => m?.beats) ?? [];
      const trusted = useWritten && written.trusted.has(b)
        && values.length === bar.count && values.every((v) => v > 0);
      let at = 0;
      for (const [k, note] of bar.notes.entries()) {
        // From the written value where the bar adds up, from equal spacing
        // where it does not — and nothing at all if neither is available.
        const wanted = trusted
          ? bar.from + (at / written.beatsPerBar) * bar.length
          : (evenNotes ? bar.from + (k / bar.count) * bar.length : null);
        if (trusted) at += values[k];
        if (wanted === null) continue;
        notes.push({ note, bar: bar.key, wanted, offBy: note.start - wanted, fromWritten: trusted });
      }
    }
  }

  const offs = notes.map((n) => Math.abs(n.offBy));
  return {
    bars: real.length,
    barLength: typical,
    // Bars a minute, which is the number a player can compare to a metronome
    // even though nothing here read a tempo.
    barsPerMinute: typical > 0 ? 60 / typical : null,
    steadiness,
    drift,
    verdict: drift < -0.04 ? 'rushing' : (drift > 0.04 ? 'dragging' : 'steady'),
    worstBar: { page: worst.page, staff: worst.staff, length: worst.length, notes: worst.count },
    evenNotes,
    // Whether the per-note verdicts came from values read off the page or
    // from assuming a bar's notes are equal. A different claim, said plainly.
    fromWritten: notes.length > 0 && notes.every((n) => n.fromWritten),
    beatsPerBar: written.ok ? written.beatsPerBar : null,
    notes,
    meanOffMs: offs.length ? (offs.reduce((a, b) => a + b, 0) / offs.length) * 1000 : null,
  };
}
