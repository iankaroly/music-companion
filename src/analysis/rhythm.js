// Timing: how the playing sat against a steady pulse.
//
// No metronome is required and none is assumed — the pulse is inferred from
// the note onsets themselves, which means every take already in the library
// can be read for timing retroactively.
//
//   onsets → autocorrelation → grid period → least-squares fit → deviations
//
// Two periods matter and they are not the same thing. The GRID is the finest
// pulse the onsets actually land on (the eighth, say); the TACTUS is the beat
// a musician would count and tap, and it's the tactus that gets reported as
// BPM. Scoring deviations against the grid is what keeps a run of eighths from
// reading as "every other note is 250 ms late".

const BIN = 0.01;          // 10 ms onset train — finer than any human error
const MIN_GRID = 0.11;     // ~545 bpm of grid: below this it's a trill, not rhythm
const MAX_GRID = 1.6;
const TACTUS_CENTER = 0.6; // ~100 bpm: where an unprimed listener hears the beat
const TACTUS_SIGMA = 0.55; // in log space, so 60–200 bpm all stay plausible
const TACTUS_MULTIPLES = [1, 2, 3, 4, 6];
const MIN_ONSETS = 4;

// A "musical" preference for beat periods near walking pace. Parncutt's
// resonance idea: without it, any integer division of the pulse fits equally
// well and the tempo readout lands on an arbitrary multiple.
function tactusPrior(period) {
  const z = Math.log(period / TACTUS_CENTER) / TACTUS_SIGMA;
  return Math.exp(-0.5 * z * z);
}

// Onsets as a smoothed impulse train, so correlation at a lag doesn't hinge on
// two onsets falling in exactly the same bin.
function onsetTrain(onsets, bin = BIN) {
  const t0 = onsets[0];
  const span = onsets.at(-1) - t0;
  const train = new Float32Array(Math.ceil(span / bin) + 3);
  for (const t of onsets) {
    const pos = (t - t0) / bin;
    const i = Math.floor(pos);
    const frac = pos - i;
    // linear spread across the two neighbouring bins
    if (i >= 0 && i < train.length) train[i] += 1 - frac;
    if (i + 1 < train.length) train[i + 1] += frac;
  }
  return train;
}

function autocorrelate(train, minLag, maxLag) {
  const out = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < train.length; i++) sum += train[i] * train[i + lag];
    // normalised by the overlap so long lags aren't punished for having
    // fewer pairs to add up
    out.push({ lag, value: sum / Math.max(1, train.length - lag) });
  }
  return out;
}

function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function localPeaks(curve) {
  const peaks = [];
  for (let i = 1; i < curve.length - 1; i++) {
    if (curve[i].value > curve[i - 1].value && curve[i].value >= curve[i + 1].value) {
      peaks.push(curve[i]);
    }
  }
  return peaks;
}

// Refine a coarse period into the best straight line through the onsets:
// t_i ≈ phase + grid·k_i for integer beat indices k_i. Re-assigning the
// indices and re-fitting a couple of times settles it, like a tiny k-means.
export function fitGrid(onsets, coarseGrid, rounds = 3) {
  let grid = coarseGrid;
  let phase = onsets[0];
  let ks = [];
  for (let round = 0; round < rounds; round++) {
    ks = onsets.map((t) => Math.round((t - phase) / grid));
    // least squares on (k, t)
    const n = onsets.length;
    const meanK = ks.reduce((a, b) => a + b, 0) / n;
    const meanT = onsets.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (ks[i] - meanK) * (onsets[i] - meanT);
      den += (ks[i] - meanK) ** 2;
    }
    if (den === 0) break;
    const nextGrid = num / den;
    if (!Number.isFinite(nextGrid) || nextGrid <= 0) break;
    grid = nextGrid;
    phase = meanT - grid * meanK;
  }
  const deviations = onsets.map((t, i) => t - (phase + grid * ks[i]));
  return { grid, phase, beatIndices: ks, deviations };
}

// Per-note deviation from the LOCAL pulse.
//
// One straight line through a whole take is the wrong ruler for human playing:
// timing errors carry forward (a player who enters late continues from there),
// so a global fit charges every later note for drift that already happened. The
// question a player actually asks is "was that note early or late compared with
// what was going on around it", so each note is measured against a pulse fitted
// to its own neighbourhood. Take-wide drift is reported separately, by the
// tempo curve.
export function fitLocal(onsets, grid, window = 9) {
  const half = Math.floor(window / 2);
  const deviations = [];
  const gridTimes = [];
  for (let i = 0; i < onsets.length; i++) {
    const from = Math.max(0, Math.min(i - half, onsets.length - window));
    const slice = onsets.slice(Math.max(0, from), Math.max(0, from) + window);
    const local = fitGrid(slice, grid);
    const k = Math.round((onsets[i] - local.phase) / local.grid);
    const gridTime = local.phase + local.grid * k;
    gridTimes.push(gridTime);
    deviations.push(onsets[i] - gridTime);
  }
  return { deviations, gridTimes };
}

// The grid and the tactus. Returns null when there aren't enough onsets to
// claim a pulse exists at all.
export function inferGrid(onsets) {
  if (!Array.isArray(onsets) || onsets.length < MIN_ONSETS) return null;
  const sorted = [...onsets].sort((a, b) => a - b);
  const span = sorted.at(-1) - sorted[0];
  if (span <= 0) return null;

  const train = onsetTrain(sorted);
  const minLag = Math.max(1, Math.round(MIN_GRID / BIN));
  const maxLag = Math.min(train.length - 2, Math.round(Math.min(MAX_GRID, span / 2) / BIN));
  if (maxLag <= minLag) return null;

  const peaks = localPeaks(autocorrelate(train, minLag, maxLag));
  if (peaks.length === 0) return null;
  const best = peaks.reduce((a, b) => (b.value > a.value ? b : a));

  // Which period is the grid can't be read off correlation strength alone. In a
  // long–short dotted figure the bar-length lag has twice the support of the
  // short note, so the strongest peak isn't the pulse the notes sit on.
  //
  // The grid is instead the COARSEST period that still explains every onset —
  // the simplest reading of the rhythm. Finer always fits (a grid of nothing
  // fits anything), so without "coarsest" the search would collapse; without
  // "explains every onset" it would stop at the bar.
  const candidates = new Set();
  for (const p of peaks.filter((q) => q.value >= best.value * 0.45)) {
    for (let k = 1; k <= 8; k++) {
      const period = (p.lag * BIN) / k;
      if (period >= MIN_GRID) candidates.add(Math.round(period * 1000) / 1000);
    }
  }
  const iois = [];
  for (let i = 1; i < sorted.length; i++) iois.push(sorted[i] - sorted[i - 1]);
  const medianIOI = median(iois);

  const ordered = [...candidates]
    .filter((c) => c >= medianIOI / 6) // no grid so fine that notes span a bar of it
    .sort((a, b) => b - a);            // coarsest first

  // A candidate is judged on the gaps BETWEEN notes rather than on the fitted
  // residuals: does every gap come out as a whole number of grid steps? Gaps
  // are phase-independent, so a grid that is half a step wrong can't hide by
  // shifting until its error straddles the beat, which is exactly how a
  // long–short figure otherwise gets read at bar length.
  const EXPLAINED = 0.15;  // 90th-percentile gap error, in grid steps
  const MAX_MED_STEP = 3;  // note-to-note motion is a step or three, not ten

  const gapError = (grid) => {
    const errs = [];
    const steps = [];
    for (const gap of iois) {
      const ratio = gap / grid;
      const k = Math.round(ratio);
      if (k < 1) return null; // this grid is coarser than a gap that really happened
      errs.push(Math.abs(ratio - k));
      steps.push(k);
    }
    return { spread: percentile(errs, 0.9), medStep: median(steps) };
  };

  let fit = null;
  for (const candidate of ordered) {
    const scored = gapError(candidate);
    if (!scored || scored.spread > EXPLAINED || scored.medStep > MAX_MED_STEP) continue;
    const trial = fitGrid(sorted, candidate);
    if (!Number.isFinite(trial.grid) || trial.grid < MIN_GRID * 0.5) continue;
    fit = trial;
    break;
  }
  // Nothing explained the onsets — free playing, or a tempo that moved too far
  // for one grid to cover. Fall back to the typical gap between notes so the
  // deviations stay honest instead of inventing a pulse that happens to fit.
  if (!fit) fit = fitGrid(sorted, medianIOI);
  if (!Number.isFinite(fit.grid) || fit.grid < MIN_GRID * 0.5) return null;

  // The beat is whichever multiple of the grid a listener would tap along to.
  const support = new Map(peaks.map((p) => [p.lag, p.value]));
  const nearestSupport = (period) => {
    const lag = Math.round(period / BIN);
    let bestVal = 0;
    for (let d = -2; d <= 2; d++) bestVal = Math.max(bestVal, support.get(lag + d) ?? 0);
    return bestVal;
  };
  let tactus = fit.grid;
  let bestScore = -Infinity;
  for (const k of TACTUS_MULTIPLES) {
    const period = fit.grid * k;
    if (period > MAX_GRID * 2) continue;
    // k = 1 always "has support" by construction; the others must earn it.
    // The prior leads and support only nudges: every integer multiple of the
    // grid correlates to some degree, and which multiple happens to correlate
    // best is easily decided by phrase structure rather than by the pulse.
    const backing = k === 1 ? best.value : nearestSupport(period);
    const score = tactusPrior(period) * (0.7 + 0.3 * (backing / best.value));
    if (score > bestScore) { bestScore = score; tactus = period; }
  }

  return {
    grid: fit.grid,
    phase: fit.phase,
    tactus,
    bpm: 60 / tactus,
    strength: best.value,
  };
}

// Local tempo across the take, one point per interval.
//
// Each gap is divided by how many grid steps it spans, so a held note reads as
// one slow beat rather than as the tempo collapsing. Deliberately local: any
// window that accumulates elapsed time against a single global grid falls apart
// exactly where it matters — inside an accelerando.
export function tempoCurve(onsets, grid, window = 4) {
  const sorted = [...onsets].sort((a, b) => a - b);
  if (sorted.length < 2 || !(grid > 0)) return [];
  const periods = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1] - sorted[i];
    if (gap <= 0) { periods.push(null); continue; }
    const steps = Math.max(1, Math.round(gap / grid));
    periods.push(gap / steps);
  }
  const out = [];
  for (let i = 0; i < periods.length; i++) {
    const from = Math.max(0, i - Math.floor((window - 1) / 2));
    const slice = periods.slice(from, from + window).filter((p) => p !== null);
    if (slice.length === 0) continue;
    // Median, not mean: one botched entry shifts two intervals in opposite
    // directions, and averaging turns that into a tempo spike that never
    // happened. Tempo is what the surrounding notes agree on.
    out.push({ time: sorted[i], bpm: 60 / median(slice) });
  }
  return out;
}

const ON_MS = 30;    // inside this, a listener hears the note as on the beat
const WORST_MS = 45; // past this it's worth pointing at

function verdictFor(deviationMs) {
  if (Math.abs(deviationMs) <= ON_MS) return 'on';
  return deviationMs > 0 ? 'late' : 'early';
}

// The whole timing story for one take.
export function rhythmReport(notes, { gridHint = null } = {}) {
  const usable = (notes ?? []).filter((n) => Number.isFinite(n?.start));
  if (usable.length < MIN_ONSETS) return null;
  const onsets = usable.map((n) => n.start);

  const inferred = gridHint
    ? { ...fitGrid(onsets, gridHint), tactus: gridHint, bpm: 60 / gridHint }
    : inferGrid(onsets);
  if (!inferred) return null;

  const grid = inferred.grid;
  const local = fitLocal(onsets, grid);
  const perNote = usable.map((n, i) => {
    const deviationMs = local.deviations[i] * 1000;
    return {
      index: i,
      name: n.name,
      start: n.start,
      gridTime: local.gridTimes[i],
      deviationMs,
      verdict: verdictFor(deviationMs),
    };
  });

  const absMs = perNote.map((p) => Math.abs(p.deviationMs));
  const meanAbsMs = absMs.reduce((a, b) => a + b, 0) / absMs.length;

  // Drift: how the local tempo at the end compares with the start. Negative
  // means the intervals shrank — rushing.
  //
  // tempoCurve counts in grid steps; the curve is rescaled to the beat so it
  // shares units with the reported bpm and can be plotted against it.
  const toTactus = grid / inferred.tactus;
  const curve = tempoCurve(onsets, grid).map((p) => ({ time: p.time, bpm: p.bpm * toTactus }));
  const third = Math.max(1, Math.floor(curve.length / 3));
  const avg = (list) => list.reduce((a, p) => a + p.bpm, 0) / Math.max(1, list.length);
  const startBpm = avg(curve.slice(0, third));
  const endBpm = avg(curve.slice(-third));
  const drift = startBpm > 0 ? (startBpm - endBpm) / startBpm : 0;

  // Evenness as a fraction of the beat: 1 means every onset landed on the
  // grid, 0 means the deviations are as big as the grid step itself.
  const rms = Math.sqrt(absMs.reduce((a, d) => a + d * d, 0) / absMs.length) / 1000;
  const evenness = Math.max(0, 1 - rms / grid);

  const DRIFT_LIMIT = 0.04; // 4% across the take reads as a real direction
  const drifting = Math.abs(drift) > DRIFT_LIMIT;
  const verdict = drift < -DRIFT_LIMIT ? 'rushing'
    : drift > DRIFT_LIMIT ? 'dragging'
      : meanAbsMs <= ON_MS ? 'steady'
        : 'uneven';

  // Naming individual notes only makes sense against a pulse that held still.
  // Once the tempo has moved — a rubato phrase, an accelerando, or just a take
  // that ran away — even a local fit charges notes for the movement around
  // them, and calling the 22nd note "211 ms late" when the tempo simply
  // changed is worse than saying nothing. The drift verdict and the tempo
  // curve carry that story instead.
  const worst = drifting ? [] : [...perNote]
    .filter((p) => Math.abs(p.deviationMs) >= WORST_MS)
    .sort((a, b) => Math.abs(b.deviationMs) - Math.abs(a.deviationMs))
    .slice(0, 5);

  return {
    bpm: 60 / inferred.tactus,
    grid,
    tactus: inferred.tactus,
    evenness,
    drift,
    drifting,
    meanAbsMs,
    verdict,
    notes: perNote,
    worst,
    curve,
  };
}
