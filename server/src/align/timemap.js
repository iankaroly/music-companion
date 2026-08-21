// The map between musical time and clock time.
//
// This is the seam the whole "sync a recording to the page" feature turns on,
// and it is deliberately the smallest thing that can work: a piecewise-linear,
// strictly increasing function from PERFORMANCE QUARTERS to SECONDS, defined by
// a list of anchors.
//
// WHY PIECEWISE LINEAR RATHER THAN A TEMPO CURVE: an anchor list is what every
// possible producer can emit. A person tapping the bar lines produces anchors.
// A metronome-locked take produces two. A DTW alignment against a reference
// rendering produces a few hundred. An onset detector plus a note matcher
// produces one per note. Every one of them drops into the same structure, so
// the audio work that comes later never has to change this file or the API on
// top of it — it just posts better anchors.
//
// WHY IT IS DATA, NOT A CLOSURE: a timemap is stored, served as JSON, and
// evaluated in the browser as well as here. Functions here take the timemap as
// their first argument so the same numbers work on both sides of the wire.

export class AlignmentError extends Error {}

export const SANE_BPM = { min: 5, max: 400 };

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Quarters per second <-> quarter-note BPM. */
const bpmFromRate = (quartersPerSecond) => round6(quartersPerSecond * 60);
const rateFromBpm = (bpm) => bpm / 60;

/**
 * Build a timemap from anchors.
 *
 * @param {{quarter:number, time:number, label?:string}[]} anchors
 *   `quarter` is a position on the PERFORMANCE clock (see timeline.js),
 *   `time` is seconds into the recording.
 * @param {{quarterBpm?:number, totalQuarters?:number}} [options]
 *   `quarterBpm` is used when there is only one anchor (a single sync point
 *   plus a known tempo is a complete alignment) and for extrapolating before
 *   the first and after the last anchor.
 * @returns {object} a plain, serialisable timemap
 */
export function buildTimemap(anchors, options = {}) {
  const cleaned = [...(anchors ?? [])]
    .map((a) => ({
      quarter: Number(a.quarter),
      time: Number(a.time),
      label: a.label ?? null,
    }))
    .filter((a) => Number.isFinite(a.quarter) && Number.isFinite(a.time))
    .sort((a, b) => a.quarter - b.quarter);

  if (cleaned.length === 0) {
    throw new AlignmentError('an alignment needs at least one anchor');
  }

  // Two anchors at the same musical position, or time running backwards, would
  // make the map non-invertible — and a non-invertible map means the cursor
  // jumps backwards mid-bar, which reads as a bug in the audio, not the data.
  for (let i = 1; i < cleaned.length; i += 1) {
    const prev = cleaned[i - 1];
    const here = cleaned[i];
    if (here.quarter === prev.quarter) {
      if (Math.abs(here.time - prev.time) < 1e-6) { cleaned.splice(i, 1); i -= 1; continue; }
      throw new AlignmentError(
        `two anchors put quarter ${here.quarter} at ${prev.time}s and ${here.time}s`,
      );
    }
    if (here.time <= prev.time) {
      throw new AlignmentError(
        `anchors go backwards in time: quarter ${prev.quarter} at ${prev.time}s, `
        + `then quarter ${here.quarter} at ${here.time}s`,
      );
    }
  }

  const segments = [];
  for (let i = 1; i < cleaned.length; i += 1) {
    const from = cleaned[i - 1];
    const to = cleaned[i];
    const rate = (to.quarter - from.quarter) / (to.time - from.time); // quarters per second

    // A TEMPO HAS TO BE A TEMPO HERE TOO.
    //
    // The guard above asks only whether time moves FORWARD between anchors,
    // never how far. Two taps a ten-millionth of a second apart pass it and
    // give a segment running at forty million quarters a second; because that
    // is the last segment, everything after the final anchor maps to the same
    // instant and the cursor freezes on the last bar. The other extreme rounds
    // the tempo to zero and every extrapolated answer becomes infinity. Both
    // come from real producers — a double tap, a tap on a bar the reader
    // measured as a quarter long.
    const bpm = rate * 60;
    if (!Number.isFinite(bpm) || bpm < SANE_BPM.min || bpm > SANE_BPM.max) {
      throw new AlignmentError(
        `anchors at quarter ${from.quarter} (${from.time}s) and ${to.quarter} (${to.time}s) `
        + `imply ${Math.round(bpm)} quarters a minute, which is not a tempo anybody plays`,
      );
    }
    segments.push({
      fromQuarter: from.quarter,
      toQuarter: to.quarter,
      fromTime: from.time,
      toTime: to.time,
      quarterBpm: bpmFromRate(rate),
    });
  }

  // The tempo used outside the anchored span. With one anchor it is the only
  // tempo there is, so it is required rather than guessed.
  let edgeBpm = options.quarterBpm ?? null;
  // A tempo has to be a tempo. constantTimemap already refuses nonsense here;
  // this path took whatever it was handed, so a single anchor and a quarterBpm
  // of 0, -60 or NaN built a map that ran backwards or resolved to NaN, and
  // every answer taken off it was wrong without ever saying so.
  if (options.quarterBpm != null
    && (!Number.isFinite(options.quarterBpm) || options.quarterBpm <= 0)) {
    throw new AlignmentError(`quarterBpm must be a positive number, not ${options.quarterBpm}`);
  }
  if (segments.length === 0 && !edgeBpm) {
    throw new AlignmentError(
      'a single anchor cannot define a tempo — send a second anchor, or quarterBpm',
    );
  }

  return {
    schemaVersion: 1,
    anchors: cleaned,
    segments,
    // Head and tail tempi: constant extrapolation off the ends of the anchored
    // region, so asking for bar 1 when the first anchor is bar 5 still answers.
    //
    // A TEMPO THE CALLER GAVE US WINS. It says so in this function's own
    // documentation, and it was used only when there were no segments at all —
    // so somebody who knew the piece's tempo and anchored an interior span got
    // bar 1 extrapolated from whatever rubato happened between their first two
    // taps, and everything after the last one from the final ritardando, which
    // is the worst estimate available for the music that follows it.
    headBpm: edgeBpm ?? (segments.length ? segments[0].quarterBpm : null),
    tailBpm: edgeBpm ?? (segments.length ? segments[segments.length - 1].quarterBpm : null),
    startQuarter: cleaned[0].quarter,
    endQuarter: cleaned[cleaned.length - 1].quarter,
    totalQuarters: options.totalQuarters ?? null,
  };
}

/**
 * A constant-tempo alignment: the recording starts at `offsetSeconds` and never
 * changes speed. The common case for a click-track take, and the sensible
 * default before any audio analysis exists.
 */
export function constantTimemap({ quarterBpm, offsetSeconds = 0, totalQuarters = null }) {
  if (!Number.isFinite(quarterBpm) || quarterBpm <= 0) {
    throw new AlignmentError('quarterBpm must be a positive number');
  }
  const spanQuarters = totalQuarters && totalQuarters > 0 ? totalQuarters : 4;
  return buildTimemap([
    { quarter: 0, time: offsetSeconds, label: 'start' },
    { quarter: spanQuarters, time: offsetSeconds + spanQuarters / rateFromBpm(quarterBpm), label: 'end' },
  ], { quarterBpm, totalQuarters });
}

/** Seconds into the recording for a performance-quarter position. */
export function secondsAt(timemap, quarter) {
  const { segments } = timemap;
  // With a single anchor there are no segments and both branches below are
  // pure extrapolation from it at the given tempo — which is a complete,
  // correct alignment, not a degenerate one.
  if (quarter <= timemap.startQuarter) {
    const rate = rateFromBpm(timemap.headBpm);
    return round6(timemap.anchors[0].time - (timemap.startQuarter - quarter) / rate);
  }
  if (quarter >= timemap.endQuarter) {
    const rate = rateFromBpm(timemap.tailBpm);
    const last = timemap.anchors[timemap.anchors.length - 1];
    return round6(last.time + (quarter - timemap.endQuarter) / rate);
  }
  const seg = findSegment(segments, quarter, 'fromQuarter', 'toQuarter');
  if (!seg) return round6(timemap.anchors[0].time);
  const fraction = (quarter - seg.fromQuarter) / (seg.toQuarter - seg.fromQuarter);
  return round6(seg.fromTime + fraction * (seg.toTime - seg.fromTime));
}

/** The inverse: performance-quarter position at a moment in the recording. */
export function quarterAtSeconds(timemap, seconds) {
  const { segments } = timemap;
  const first = timemap.anchors[0];
  const last = timemap.anchors[timemap.anchors.length - 1];
  if (seconds <= first.time) {
    return round6(first.quarter - (first.time - seconds) * rateFromBpm(timemap.headBpm));
  }
  if (seconds >= last.time) {
    return round6(last.quarter + (seconds - last.time) * rateFromBpm(timemap.tailBpm));
  }
  const seg = findSegment(segments, seconds, 'fromTime', 'toTime');
  if (!seg) return round6(timemap.anchors[0].quarter);
  const fraction = (seconds - seg.fromTime) / (seg.toTime - seg.fromTime);
  return round6(seg.fromQuarter + fraction * (seg.toQuarter - seg.fromQuarter));
}

/** Binary search for the segment containing `value` on the given axis. */
function findSegment(segments, value, fromKey, toKey) {
  if (segments.length === 0) return null;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value < segments[mid][fromKey]) hi = mid - 1;
    else if (value >= segments[mid][toKey]) lo = mid + 1;
    else return segments[mid];
  }
  return segments[Math.max(0, Math.min(lo, segments.length - 1))];
}

/**
 * Least-squares constant tempo through a set of anchors.
 *
 * Useful in two places: showing the player "you averaged 92 bpm", and taking a
 * handful of noisy taps and turning them into one clean line instead of a
 * timemap that lurches at every tap.
 *
 * @returns {{quarterBpm:number, offsetSeconds:number, rmsSeconds:number}}
 */
export function fitConstantTempo(anchors) {
  const points = anchors.filter((a) => Number.isFinite(a.quarter) && Number.isFinite(a.time));
  if (points.length < 2) throw new AlignmentError('fitting a tempo needs at least two anchors');

  // time = a * quarter + b, so seconds-per-quarter is the slope.
  const n = points.length;
  const sumQ = points.reduce((s, p) => s + p.quarter, 0);
  const sumT = points.reduce((s, p) => s + p.time, 0);
  const sumQQ = points.reduce((s, p) => s + p.quarter * p.quarter, 0);
  const sumQT = points.reduce((s, p) => s + p.quarter * p.time, 0);
  const denominator = n * sumQQ - sumQ * sumQ;
  if (Math.abs(denominator) < 1e-9) throw new AlignmentError('all anchors sit at the same musical position');

  const slope = (n * sumQT - sumQ * sumT) / denominator; // seconds per quarter
  const intercept = (sumT - slope * sumQ) / n;
  if (slope <= 0) throw new AlignmentError('these anchors imply a tempo of zero or less');

  const rms = Math.sqrt(
    points.reduce((s, p) => s + (p.time - (slope * p.quarter + intercept)) ** 2, 0) / n,
  );
  return {
    quarterBpm: round6(60 / slope),
    offsetSeconds: round6(intercept),
    rmsSeconds: round6(rms),
  };
}
