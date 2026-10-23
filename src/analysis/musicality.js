// How a take is SHAPED, beyond whether the pitch was right: where its phrases
// fall, how loudness rises and falls inside them, how connected or detached the
// notes are, how the tempo gives and returns, whether a repeated figure is
// played the same way twice, and how the pitch leans and the vibrato opens.
//
// THESE ARE DESCRIPTIONS, AND NOTHING HERE GRADES TASTE. There is no labelled
// data in this repo for "good phrasing" or "beautiful tone", and a number that
// pretended to be one would be an invention with a decimal point. What is
// measured is what performance research finds listeners HEAR as shaping —
// loudness arches over a phrase, lengthening before a phrase end, the ratio of
// a note's sounding length to the time until the next, tempo that gives and
// comes back — each reported as a number, a plain phrase, and how many things
// it was measured from. The one place a comparison says "more alike" as a
// good thing is a repeated figure played the same way twice, where sameness is
// the point; even there it says alike, not better.
//
// Pure: notes and pitch readings in, plain descriptors out. Notes are what
// NoteSegmenter emits ({start, end, midi, cents}); readings are what the
// Analyzer emits ({time, frequency, confidence, rms}). The readings carry the
// loudness, so the audio itself is not needed here.
//
// THE FLOORS. Note ends are the last confident pitch frame and the Analyzer's
// window is ~93 ms, so a fixed few tens of milliseconds of error sit on every
// onset and every end whatever the tempo. On a slow movement that is a few
// percent of a note; on a fast one it is a large part of it. Every threshold
// below that turns a number into a word was therefore set from what a
// metronomic, perfectly flat synthetic take reads THROUGH THE REAL PIPELINE at
// a slow and at a fast tempo (tools/musicality-synth-check.mjs), not from how
// a recording looked. See docs/musicality.md for the numbers.

const MIN_NOTES = 12;           // below this a median is a handful of notes' opinion
const MIN_PHRASE_NOTES = 3;
const LONG_NOTE_SEC = 0.8;      // a note long enough to show vibrato opening up
const MIN_CONF = 0.6;           // the same pitched-frame floor quality.js and the segmenter use

// Thresholds. See the header: set from the synthetic noise floors, in advance
// of the real recordings, and written down in docs/musicality.md.
export const LIMITS = {
  restGapSec: 0.1,           // a silence this much longer than the take's usual one (and long against the tempo) can end a phrase
  restGapBeats: 0.35,        //   …as a share of the local note spacing
  breathGapSec: 0.2,         // a silence this much longer than usual is a breath on its own
  breathGapBeats: 0.5,
  longNote: 1.7,             // a note spaced this many times the local spacing is a long note
  levelReset: 4,             // dB: loudness steps up after a fall = a new start
  flatPhraseDb: 2.5,         // a phrase whose loudness moves less than this is level
  jumpyStepDb: 3.2,          // mean dB change from one note to the next above which a phrase is uneven, whatever its outline
  noisyShortShare: 0.25,     // share of heard notes under 80 ms above which every descriptor is low confidence
  scatterPct: 8,             // note-to-note timing scatter (%) above which no tempo is read from a score-free take
  shapeDb: 2,                // how far loudness must climb and fall to be an arch
  steadyTempo: 4,            // % spread of the local tempo that still reads as steady (at least; see floorsFor)
  freeTempo: 9,              // % spread above which the tempo is clearly moving (at least)
  driftPct: 8,               // % faster or slower at the end than the start = drift
  legato: 0.85,              // sounding length / spacing at or above = connected
  detached: 0.55,            // at or below = clearly separated
  evenArticulation: 0.12,    // spread (quartile range) of that ratio that reads as even (at least; see floorsFor)
  flatStretchDb: 2,          // loudest vs quietest stretch of the take
  sameTimingPct: 4,          // a repeated figure whose timing differs by less than this is the same (at least)
  sameLoudnessDb: 1.5,
  leanCents: 4,              // difference in where notes sit after rising vs falling steps
};

// THE NOISE FLOOR, IN MILLISECONDS. Measured through the real Analyzer +
// NoteSegmenter on metronomic flat synthetic takes (tools/musicality-synth-check.mjs):
// a perfectly steady take reads a tempo spread of 1.1-1.7% at 0.6 s a note and
// 3.4% at 0.15 s, a repeated figure 'differing' by 2-3% and 7-12%, and an
// articulation spread of 0.02 and 0.11-0.16. Those are the SAME few
// milliseconds of onset wobble divided by a shorter note, so every threshold
// that turns a timing number into a word is the larger of a fixed floor and
// this many milliseconds over the take's own typical note spacing. A fast
// movement therefore needs a bigger movement to count as free, which is the
// honest statement: the instrument cannot see less.
const NOISE_MS = { tempo: 10, repeat: 22, articulation: 28, endBias: 16 };

function floorsFor(beat) {
  const per = (ms) => (beat > 0 ? ms / 1000 / beat : 0);
  const steady = Math.max(LIMITS.steadyTempo, 100 * per(NOISE_MS.tempo));
  return {
    steadyBelow: steady,
    freeAbove: Math.max(LIMITS.freeTempo, steady + 5),
    evenBelow: Math.max(LIMITS.evenArticulation, per(NOISE_MS.articulation)),
    sameBelow: Math.max(LIMITS.sameTimingPct, 100 * per(NOISE_MS.repeat)),
    // A detached note is read ~16 ms longer than it was played (its decay is
    // still above the pitch floor), which is a bigger share of a short note.
    detachedAt: LIMITS.detached + per(NOISE_MS.endBias),
  };
}

function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function quantile(values, q) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.min(v.length - 1, Math.round((v.length - 1) * q))];
}

const mean = (values) => {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

const sd = (values) => {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length);
};

const confidenceOf = (n, ok, good) => (n >= good ? 'good' : n >= ok ? 'ok' : 'low');

// One descriptor. `measured: false` is a plain statement that this could not be
// read from this take, with the reason, and carries no number — a caller must
// never have to guess whether a null means zero.
function got(key, label, value, unit, phrase, n, { ok = 6, good = 12, detail = {} } = {}) {
  return { key, label, measured: true, value, unit, phrase, n, confidence: confidenceOf(n, ok, good), detail };
}

function missing(key, label, reason, n = 0) {
  return { key, label, measured: false, value: null, unit: '', phrase: '', n, confidence: 'none', reason, detail: {} };
}

// --- loudness per note --------------------------------------------------------

function levelsOf(notes, readings) {
  const rs = (readings ?? []).filter((r) => Number.isFinite(r?.time) && r.rms > 0);
  let from = 0;
  return notes.map((note) => {
    while (from < rs.length && rs[from].time < note.start) from++;
    const inside = [];
    for (let k = from; k < rs.length && rs[k].time < note.end; k++) inside.push(rs[k].rms);
    let rms = median(inside);
    if (rms === null) {
      // A note shorter than one hop has no reading inside it; the nearest one
      // within a tenth of a second is the best evidence there is.
      const mid = (note.start + note.end) / 2;
      let best = null;
      for (let k = Math.max(0, from - 2); k < Math.min(rs.length, from + 3); k++) {
        if (best === null || Math.abs(rs[k].time - mid) < Math.abs(best.time - mid)) best = rs[k];
      }
      if (best && Math.abs(best.time - mid) <= 0.1) rms = best.rms;
    }
    return rms === null ? null : 20 * Math.log10(Math.max(1e-6, rms));
  });
}

// --- phrases ------------------------------------------------------------------

// A phrase ends where several independent things agree: a silence that is long
// for the tempo, a note held longer than its neighbours, a loudness that
// starts over. One cue alone is not enough, because a bow change leaves a
// small silence and a long note can sit in the middle of a line.
function segmentPhrases(notes, levels) {
  const n = notes.length;
  const ioi = [];
  for (let i = 0; i + 1 < n; i++) ioi.push(notes[i + 1].start - notes[i].start);

  const local = (i) => {
    const near = [];
    for (let k = Math.max(0, i - 4); k <= Math.min(ioi.length - 1, i + 4); k++) if (k !== i) near.push(ioi[k]);
    return median(near) ?? median(ioi);
  };

  // A silence is long relative to the take's OWN usual silence between notes,
  // not to the beat: a legato player leaves ~20 ms between notes and a detached
  // one ~300 ms, and a 350 ms breath is a phrase end in the first and nothing
  // in the second. (Measured on the first version, which compared the gap to
  // the beat: a 0.35 s breath at 0.6 s a note was not found at all.)
  const usual = Math.max(0, median(notes.slice(0, -1).map((x, i) => notes[i + 1].start - x.end)) ?? 0);

  const cuts = [];
  for (let i = 0; i + 1 < n; i++) {
    const gap = notes[i + 1].start - notes[i].end - usual;
    const beat = local(i);
    const cues = [];
    let score = 0;
    if (gap >= Math.max(LIMITS.breathGapSec, LIMITS.breathGapBeats * beat)) { cues.push('rest'); score += 2; }
    else if (gap >= Math.max(LIMITS.restGapSec, LIMITS.restGapBeats * beat)) { cues.push('rest'); score += 1; }
    if (ioi[i] >= LIMITS.longNote * beat && ioi[i] >= 0.25) { cues.push('long'); score += 1; }
    const a = [levels[i - 1], levels[i]].filter(Number.isFinite);
    const b = [levels[i + 1], levels[i + 2]].filter(Number.isFinite);
    if (a.length && b.length && mean(b) - mean(a) >= LIMITS.levelReset) { cues.push('reset'); score += 1; }
    if (score >= 2) cuts.push({ after: i, cues, score });
  }

  // A phrase of one or two notes is an ornament or a stumble, not a phrase: the
  // weakest boundary that makes one is dropped until none is left.
  for (;;) {
    const starts = [0, ...cuts.map((c) => c.after + 1)];
    const ends = [...cuts.map((c) => c.after), n - 1];
    const short = starts.map((s, k) => ({ k, len: ends[k] - s + 1 })).filter((p) => p.len < MIN_PHRASE_NOTES);
    if (short.length === 0 || cuts.length === 0) break;
    const k = short[0].k;
    // Phrase k lies between boundary k-1 and boundary k; drop the weaker of them.
    const candidates = [k - 1, k].filter((c) => c >= 0 && c < cuts.length);
    candidates.sort((x, y) => cuts[x].score - cuts[y].score || y - x);
    cuts.splice(candidates[0], 1);
  }

  const starts = [0, ...cuts.map((c) => c.after + 1)];
  const phrases = starts.map((from, k) => ({ from, to: k < cuts.length ? cuts[k].after : n - 1 }));
  return { phrases, cuts };
}

function phraseDescriptors(notes, seg) {
  const { phrases, cuts } = seg;
  const out = [];
  const lens = phrases.map((p) => p.to - p.from + 1);
  const secs = phrases.map((p) => notes[p.to].end - notes[p.from].start);
  out.push(got('phrase-count', 'phrases found', phrases.length, '',
    phrases.length === 1
      ? 'no clear phrase breaks were found; the take plays as one continuous stretch'
      : `${phrases.length} phrases of about ${Math.round(median(lens))} notes each`,
    phrases.length, { ok: 3, good: 6, detail: { medianNotes: median(lens), medianSeconds: median(secs) } }));

  if (cuts.length === 0) {
    out.push(missing('phrase-definition', 'how clearly phrases are marked', 'no phrase breaks were found'));
    return out;
  }
  // How firmly each end is marked: a real breath is two points, a held note or
  // a fresh start one each, and three is as clear as it gets.
  const firm = mean(cuts.map((c) => Math.min(1, c.score / 3))) * 100;
  const pct = Math.round(firm);
  out.push(got('phrase-definition', 'how clearly phrases are marked', firm, '%',
    firm >= 85 ? `phrase ends are clearly marked (${pct}% on a scale where a breath plus a held note or fresh start is 100)`
      : firm >= 60 ? `phrase ends are marked, mostly by a breath (${pct}% on a scale where a breath plus a held note or fresh start is 100)`
        : `phrase ends are only lightly marked (${pct}% on a scale where a breath plus a held note or fresh start is 100)`,
    cuts.length, { ok: 3, good: 6 }));
  return out;
}

// --- loudness shaping ---------------------------------------------------------

function smooth3(v) {
  return v.map((x, i) => median([v[i - 1], x, v[i + 1]].filter(Number.isFinite)));
}

function shapeOf(levels) {
  const s = smooth3(levels);
  const range = Math.max(...s) - Math.min(...s);
  if (range < LIMITS.flatPhraseDb) return { shape: 'level', range };
  // A line whose loudness jumps note to note is not an arch even if its smoothed
  // outline happens to rise and fall: random jumps of +-6 dB drew a swell on
  // two phrases in six.
  const steps = levels.slice(1).map((x, i) => Math.abs(x - levels[i]));
  if (mean(steps) >= LIMITS.jumpyStepDb) return { shape: 'uneven', range };
  const peakAt = s.indexOf(Math.max(...s));
  const pos = peakAt / (s.length - 1);
  const head = mean(s.slice(0, 2));
  const tail = mean(s.slice(-2));
  const peak = s[peakAt];
  if (pos > 0.15 && pos < 0.85 && peak - head >= LIMITS.shapeDb && peak - tail >= LIMITS.shapeDb) return { shape: 'arch', range };
  if (tail - head >= LIMITS.flatPhraseDb) return { shape: 'build', range };
  if (head - tail >= LIMITS.flatPhraseDb) return { shape: 'fade', range };
  return { shape: 'uneven', range };
}

function dynamicsDescriptors(notes, levels, seg) {
  const out = [];
  const usable = seg.phrases
    .map((p) => ({ p, lv: levels.slice(p.from, p.to + 1) }))
    .filter((x) => x.lv.length >= 5 && x.lv.every(Number.isFinite));

  if (usable.length < 3) {
    out.push(missing('phrase-shape', 'loudness shape of phrases', `only ${usable.length} phrase${usable.length === 1 ? '' : 's'} of five or more notes; needs at least three`, usable.length));
    out.push(missing('phrase-contrast', 'loudness contrast between phrases', `only ${usable.length} phrase${usable.length === 1 ? '' : 's'} of five or more notes; needs at least three`, usable.length));
  } else {
    const shapes = usable.map((x) => shapeOf(x.lv));
    const count = (name) => shapes.filter((s) => s.shape === name).length;
    const counts = { arch: count('arch'), build: count('build'), fade: count('fade'), level: count('level'), uneven: count('uneven') };
    const total = shapes.length;
    const bits = [];
    if (counts.arch) bits.push(`${counts.arch} swell and fade`);
    if (counts.build) bits.push(`${counts.build} build`);
    if (counts.fade) bits.push(`${counts.fade} die away`);
    if (counts.level) bits.push(`${counts.level} stay level`);
    if (counts.uneven) bits.push(`${counts.uneven} move unevenly`);
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    out.push(got('phrase-shape', 'loudness shape of phrases', (counts.arch / total) * 100, '%',
      `of ${total} phrases, ${bits.join(', ')}`, total,
      { ok: 3, good: 6, detail: { counts, dominant: dominant[0], medianRangeDb: median(shapes.map((s) => s.range)) } }));

    const means = usable.map((x) => mean(x.lv));
    const contrast = sd(means);
    const spread = Math.max(...means) - Math.min(...means);
    out.push(got('phrase-contrast', 'loudness contrast between phrases', contrast, 'dB',
      `phrases differ in loudness by about ${Math.round(contrast * 10) / 10} dB on average, loudest to quietest ${Math.round(spread * 10) / 10} dB`,
      usable.length, { ok: 3, good: 6, detail: { spreadDb: spread } }));
  }

  // The take read in stretches of eight notes. This is NOT phrasing — it is
  // what can still be said about contrast when the playing is continuous and
  // no phrase breaks exist, and it is labelled as stretches for that reason.
  const finite = levels.map((l, i) => ({ l, i })).filter((x) => Number.isFinite(x.l));
  if (finite.length >= 16) {
    const stretch = [];
    for (let i = 0; i + 8 <= finite.length; i += 8) stretch.push(mean(finite.slice(i, i + 8).map((x) => x.l)));
    if (stretch.length >= 2) {
      const range = Math.max(...stretch) - Math.min(...stretch);
      out.push(got('stretch-contrast', 'loudness between stretches of the take', range, 'dB',
        `the loudest stretch is ${Math.round(range * 10) / 10} dB above the quietest (read in runs of eight notes, not phrases)`,
        stretch.length, { ok: 2, good: 5 }));
    }
  } else {
    out.push(missing('stretch-contrast', 'loudness between stretches of the take', 'fewer than sixteen notes with a loudness reading', finite.length));
  }
  return out;
}

// --- articulation -------------------------------------------------------------

function articulationDescriptors(notes, seg, fl) {
  const cutAfter = new Set(seg.cuts.map((c) => c.after));
  const ratios = [];
  const gaps = [];
  for (let i = 0; i + 1 < notes.length; i++) {
    if (cutAfter.has(i)) continue;                      // the silence between phrases is not articulation
    const ioi = notes[i + 1].start - notes[i].start;
    if (!(ioi > 0.04)) continue;
    const prev = notes[i - 1] ? notes[i].start - notes[i - 1].start : ioi;
    if (ioi > 2.2 * Math.max(prev, 0.04) && ioi > 0.6) continue;   // a rest, not a separation
    ratios.push(Math.min(1.2, (notes[i].end - notes[i].start) / ioi));
    gaps.push(notes[i + 1].start - notes[i].end);
  }
  if (ratios.length < MIN_NOTES) {
    const why = `only ${ratios.length} note-to-note links; needs at least ${MIN_NOTES}`;
    return [missing('articulation', 'legato or detached', why, ratios.length), missing('articulation-evenness', 'how even the articulation is', why, ratios.length)];
  }
  const mid = median(ratios);
  const iqr = quantile(ratios, 0.75) - quantile(ratios, 0.25);
  const detachedShare = ratios.filter((r) => r <= fl.detachedAt).length / ratios.length;
  const word = mid >= LIMITS.legato ? 'connected (notes run into each other)'
    : mid <= fl.detachedAt ? 'detached (clear space between notes)' : 'lightly separated';
  const gapMs = Math.round(median(gaps) * 1000);
  return [
    got('articulation', 'legato or detached', mid, 'of the spacing',
      `notes sound for ${Math.round(mid * 100)}% of the time to the next note, which reads as ${word}`,
      ratios.length, { ok: 12, good: 30, detail: { medianGapMs: gapMs, detachedShare, detachedAt: fl.detachedAt } }),
    got('articulation-evenness', 'how even the articulation is', iqr, '',
      iqr <= fl.evenBelow
        ? `articulation is even from note to note (middle half of notes within ${Math.round(iqr * 100)}% of each other)`
        : `articulation varies between notes (middle half of notes spread over ${Math.round(iqr * 100)}%)`,
      ratios.length, { ok: 12, good: 30, detail: { evenBelow: fl.evenBelow } }),
  ];
}

// --- tempo --------------------------------------------------------------------

// Without a score, the spacing between notes mixes written note values with
// the player's own give. The written part is taken out by reading each spacing
// as a simple multiple of the local beat (half, one, one and a half, two, ...),
// and what is left after that is the player's. Triplets are deliberately NOT
// rungs: a phrase-final stretch of 1.3 would be read as a triplet value and
// vanish, which is exactly the thing being looked for. A spacing that fits no
// rung is left out and counted, and if too many are left out the take is said
// to have note values too irregular to read.
const LADDER = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8];
// WIDENING THIS FOR SHORT NOTES WAS TRIED AND WRONG. Legato notes at 0.15 s
// come back with start errors of 0-46 ms (the start is where a pitch change was
// first believed, quantised to a 23 ms hop), so the spacings scatter by +-25%;
// a tolerance wide enough to take them in snapped them to the wrong rungs and a
// perfectly metronomic take read a 33% tempo spread and a 60% drift. Left at
// 12%, such a take is refused with 'too irregular to read', which is the honest
// answer: the instrument cannot see the tempo of a fast legato line.
const SNAP = 0.17;   // in octaves, ~12%: 0.12 lost a 15% tempo wave behind a 13% step after a breath

function localTempo(notes) {
  // WITH THE SCORE, no ladder is needed: a note that carries its written length
  // in beats (`beats`) gives its own local period, spacing over beats. Notes
  // whose spacing is more than 1.6 times or less than 0.6 of the middle one are
  // rests, ornaments or mis-heard notes, and are left out and counted.
  if (notes.length >= MIN_NOTES && notes.filter((n) => n.beats > 0).length >= 0.8 * notes.length) {
    const all = [];
    for (let i = 0; i + 1 < notes.length; i++) {
      const v = notes[i + 1].start - notes[i].start;
      if (v > 0.04 && notes[i].beats > 0) all.push({ i, t: notes[i].start, period: v / notes[i].beats, rung: 1 });
    }
    const mid = median(all.map((x) => x.period));
    return { kept: all.filter((x) => x.period < mid * 1.6 && x.period > mid / 1.6), total: all.length, scored: true };
  }
  const ioi = [];
  for (let i = 0; i + 1 < notes.length; i++) ioi.push({ i, t: notes[i].start, v: notes[i + 1].start - notes[i].start });
  const valid = ioi.filter((x) => x.v > 0.04);
  let ref = median(valid.map((x) => x.v));
  const kept = [];
  const recent = [];
  let dropped = 0;
  for (const x of valid) {
    const r = x.v / ref;
    let best = null;
    for (const rung of LADDER) {
      const d = Math.abs(Math.log2(r / rung));
      if (d <= SNAP && (best === null || d < best.d)) best = { rung, d };
    }
    if (!best) {
      // The beat is followed from the last TWO spacings that fitted, not a
      // longer median: a tempo that moves 5% a note (a 15% wave over 17 notes)
      // outruns a median of six and the follower stopped accepting anything
      // (31 of 59 fitted). And after three misses in a row the beat is simply
      // taken from the note in hand, as a player re-finds it after a rest.
      if (++dropped >= 3) { ref = x.v; recent.length = 0; dropped = 0; }
      continue;
    }
    dropped = 0;
    const period = x.v / best.rung;
    kept.push({ i: x.i, t: x.t, period, rung: best.rung });
    recent.push(period);
    if (recent.length > 2) recent.shift();
    ref = median(recent);
  }
  return { kept, total: valid.length, scored: false };
}

// The smoothed local-tempo curve the descriptors are read from, for drawing and
// for checking against a score's own tempo. period is seconds per beat-unit.
export function tempoCurveOf(notes) {
  const { kept } = localTempo(notes);
  const logs = kept.map((k) => Math.log2(k.period));
  return kept.map((k, i) => ({ t: k.t, period: k.period, smooth: 2 ** median(logs.slice(Math.max(0, i - 2), i + 3)) }));
}

function tempoDescriptors(notes, seg, fl) {
  if (notes.length < MIN_NOTES) {
    const why = `only ${notes.length} notes; needs at least ${MIN_NOTES}`;
    return [missing('tempo-flexibility', 'how much the tempo moves', why, notes.length),
      missing('tempo-shape', 'whether the tempo returns or drifts', why, notes.length),
      missing('phrase-final-lengthening', 'lengthening at phrase ends', why, notes.length)];
  }
  const out = [];
  const { kept, total, scored } = localTempo(notes);
  // Mixed note values with no score behind them: a spacing of 1.4 beats could be
  // a dotted figure or a player's give, and the ladder cannot tell. Measured on
  // the score-aligned onsets of a real gigue it read a 33% spread where the
  // written beats gave 12.8%, so the descriptor refuses unless one note value
  // dominates.
  const shares = new Map();
  for (const k of kept) shares.set(k.rung, (shares.get(k.rung) ?? 0) + 1);
  const dominant = kept.length ? Math.max(...shares.values()) / kept.length : 0;
  // How scattered the notes are around their own smoothed curve. A real player's
  // note-to-note scatter is a few percent; a take whose scatter is far above
  // that is one the pipeline timed too coarsely to follow (MEASURED: a perfectly
  // metronomic legato line at 0.15 s a note, timed by the real Analyzer, scatters
  // by ~15-20% and read a 27% 'free' tempo before this gate), and a spread
  // taken from it is the instrument's, not the player's.
  const lgs = kept.map((k) => Math.log2(k.period));
  const smo = lgs.map((x, k) => median(lgs.slice(Math.max(0, k - 2), k + 3)));
  const resid = lgs.map((x, k) => x - smo[k]);
  const scatter = (2 ** ((quantile(resid, 0.75) - quantile(resid, 0.25)) / 1.35) - 1) * 100;
  if (kept.length >= MIN_NOTES && kept.length >= 0.6 * total && !scored && scatter > LIMITS.scatterPct) {
    const why = `note-to-note timing scatters by ${Math.round(scatter)}% around its own trend, more than this pipeline can separate a tempo from at this note length`;
    out.push(missing('tempo-flexibility', 'how much the tempo moves', why, kept.length));
    out.push(missing('tempo-shape', 'whether the tempo returns or drifts', why, kept.length));
  } else if (kept.length >= MIN_NOTES && kept.length >= 0.6 * total && !scored && dominant < 0.6) {
    const why = `the note values are mixed (only ${Math.round(dominant * 100)}% of spacings are the same length), and without the score the written values cannot be told from the player's own give`;
    out.push(missing('tempo-flexibility', 'how much the tempo moves', why, kept.length));
    out.push(missing('tempo-shape', 'whether the tempo returns or drifts', why, kept.length));
  } else if (kept.length < MIN_NOTES || kept.length < 0.6 * total) {
    const why = `only ${kept.length} of ${total} note spacings fit a regular beat; the note values or the timing are too irregular to read a tempo from`;
    out.push(missing('tempo-flexibility', 'how much the tempo moves', why, kept.length));
    out.push(missing('tempo-shape', 'whether the tempo returns or drifts', why, kept.length));
  } else {
    const logs = kept.map((k) => Math.log2(k.period));
    const sm = logs.map((x, k) => median(logs.slice(Math.max(0, k - 2), k + 3)));
    const spreadOct = (quantile(sm, 0.9) - quantile(sm, 0.1)) / 2;
    const flexPct = (2 ** spreadOct - 1) * 100;
    // Positive drift = faster at the end (shorter period).
    const third = Math.max(3, Math.floor(sm.length / 3));
    const drift = (2 ** (median(sm.slice(0, third)) - median(sm.slice(-third))) - 1) * 100;
    let kind;
    let phrase;
    const f = Math.round(flexPct);
    if (Math.abs(drift) >= LIMITS.driftPct) {
      kind = drift > 0 ? 'speeds-up' : 'slows-down';
      phrase = `the tempo ends ${Math.round(Math.abs(drift))}% ${drift > 0 ? 'faster' : 'slower'} than it began (it drifts rather than returns)`;
    } else if (flexPct >= fl.steadyBelow) {
      kind = 'returns';
      phrase = `the tempo moves by about ${f}% around its middle and comes back to where it began`;
    } else {
      kind = 'steady';
      phrase = `the tempo stays steady, within about ${f}% of its middle`;
    }
    out.push(got('tempo-flexibility', 'how much the tempo moves', flexPct, '%',
      flexPct >= fl.freeAbove ? `the tempo is free, moving by about ${f}% around its middle`
        : flexPct >= fl.steadyBelow ? `the tempo gives a little, by about ${f}% around its middle`
          : `the tempo is steady, within about ${f}% of its middle`,
      kept.length, { ok: 12, good: 30, detail: { keptShare: kept.length / total, steadyBelow: fl.steadyBelow, freeAbove: fl.freeAbove } }));
    out.push(got('tempo-shape', 'whether the tempo returns or drifts', drift, '%', phrase, kept.length,
      { ok: 12, good: 30, detail: { kind } }));
  }

  // Phrase-final lengthening: how long the last note of each phrase SOUNDS
  // against the notes before it. Sounding length rather than the spacing,
  // because the spacing after a phrase's last note includes the breath. Without
  // a score a WRITTEN long note counts too, so this number is for comparing two
  // takes of one piece (where the written values cancel), and the phrase says
  // so.
  const ratios = [];
  for (const c of seg.cuts) {
    const i = c.after;
    const prev = [];
    for (let k = Math.max(0, i - 4); k < i; k++) prev.push(notes[k].end - notes[k].start);
    const own = notes[i].end - notes[i].start;
    if (prev.length >= 3 && own > 0) ratios.push(own / median(prev));
  }
  if (ratios.length >= 3) {
    const m = median(ratios);
    out.push(got('phrase-final-lengthening', 'lengthening at phrase ends', m, '×',
      `phrase-final notes are ${Math.round(m * 10) / 10} times as long as the notes before them (a written long note counts too without a score)`,
      ratios.length, { ok: 3, good: 6 }));
  } else {
    out.push(missing('phrase-final-lengthening', 'lengthening at phrase ends', `only ${ratios.length} phrase ends with enough notes before them; needs at least three`, ratios.length));
  }
  return out;
}

// --- repeated figures ---------------------------------------------------------

const FIGURE = 5;   // notes in a figure

function repeatDescriptors(notes, levels, seg, fl) {
  const cutAfter = new Set(seg.cuts.map((c) => c.after));
  const found = new Map();
  for (let i = 0; i + FIGURE <= notes.length; i++) {
    let inside = true;
    for (let k = i; k < i + FIGURE - 1; k++) if (cutAfter.has(k)) inside = false;
    if (!inside) continue;
    const steps = [];
    for (let k = i; k < i + FIGURE - 1; k++) steps.push(notes[k + 1].midi - notes[k].midi);
    if (steps.every((s) => s === 0)) continue;
    const key = steps.join(',');
    if (!found.has(key)) found.set(key, []);
    found.get(key).push(i);
  }
  const pairs = [];
  for (const starts of found.values()) {
    let last = null;
    for (const s of starts) {
      if (last !== null && s >= last + FIGURE) pairs.push([last, s]);
      if (last === null || s >= last + FIGURE) last = s;
    }
  }
  const timing = [];
  const loud = [];
  const pace = [];
  for (const [a, b] of pairs.slice(0, 60)) {
    const sp = (s) => Array.from({ length: FIGURE - 1 }, (_, k) => notes[s + k + 1].start - notes[s + k].start);
    const A = sp(a);
    const B = sp(b);
    const ta = A.reduce((x, y) => x + y, 0);
    const tb = B.reduce((x, y) => x + y, 0);
    if (!(ta > 0 && tb > 0) || tb / ta > 1.5 || ta / tb > 1.5) continue;   // a different pace is a different statement, not a repeat
    timing.push(mean(A.map((x, k) => Math.abs(x / ta - B[k] / tb))) * 100 * (FIGURE - 1));
    pace.push(Math.abs(tb / ta - 1) * 100);
    const la = levels.slice(a, a + FIGURE);
    const lb = levels.slice(b, b + FIGURE);
    if (la.every(Number.isFinite) && lb.every(Number.isFinite)) {
      const ma = mean(la);
      const mb = mean(lb);
      loud.push(Math.sqrt(mean(la.map((x, k) => (x - ma - (lb[k] - mb)) ** 2))));
    }
  }
  const out = [];
  if (timing.length < 4) {
    const why = `only ${timing.length} repeated figure${timing.length === 1 ? '' : 's'} found (a figure is five notes with the same steps); needs at least four`;
    out.push(missing('repeat-timing', 'repeated figures: timing', why, timing.length));
    out.push(missing('repeat-loudness', 'repeated figures: loudness', why, loud.length));
    return out;
  }
  const t = median(timing);
  out.push(got('repeat-timing', 'repeated figures: timing', t, '%',
    t < fl.sameBelow
      ? `repeated figures keep nearly the same rhythm each time (timing differs by about ${Math.round(t * 10) / 10}%)`
      : `repeated figures are timed differently each time (timing differs by about ${Math.round(t * 10) / 10}%)`,
    timing.length, { ok: 4, good: 10, detail: { paceDiffPct: median(pace), sameBelow: fl.sameBelow } }));
  if (loud.length >= 4) {
    const l = median(loud);
    out.push(got('repeat-loudness', 'repeated figures: loudness', l, 'dB',
      l < LIMITS.sameLoudnessDb
        ? `repeated figures keep the same loudness shape each time (differing by about ${Math.round(l * 10) / 10} dB)`
        : `repeated figures are shaped differently in loudness each time (differing by about ${Math.round(l * 10) / 10} dB)`,
      loud.length, { ok: 4, good: 10 }));
  } else out.push(missing('repeat-loudness', 'repeated figures: loudness', `only ${loud.length} repeated figures with a loudness reading; needs at least four`, loud.length));
  return out;
}

// --- pitch expression ---------------------------------------------------------

function framesIn(note, readings, a4) {
  const out = [];
  for (const r of readings ?? []) {
    if (r.time < note.start) continue;
    if (r.time >= note.end) break;
    if (!(r.frequency > 0) || !(r.confidence >= MIN_CONF)) continue;
    out.push({ t: r.time, c: 1200 * Math.log2(r.frequency / a4) });
  }
  return out;
}

// Half the peak-to-peak swing of a stretch of pitch, after the slope is taken
// out, and whether it crosses its own middle at a vibrato's rate.
function swingOf(frames) {
  if (frames.length < 6) return null;
  const n = frames.length;
  const mt = mean(frames.map((f) => f.t));
  const mc = mean(frames.map((f) => f.c));
  let num = 0;
  let den = 0;
  for (const f of frames) { num += (f.t - mt) * (f.c - mc); den += (f.t - mt) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const dev = frames.map((f) => f.c - mc - slope * (f.t - mt));
  const width = (Math.max(...dev) - Math.min(...dev)) / 2;
  let crossings = 0;
  for (let i = 1; i < n; i++) if (Math.sign(dev[i]) !== Math.sign(dev[i - 1])) crossings++;
  const span = frames[n - 1].t - frames[0].t;
  const rate = span > 0 ? crossings / 2 / span : 0;
  return { width, vib: width >= 10 && rate >= 3.5 && rate <= 9.5 };
}

function vibratoGrowth(notes, readings, a4) {
  const rows = [];
  let longNotes = 0;
  for (const note of notes) {
    if (note.end - note.start < LONG_NOTE_SEC) continue;
    longNotes++;
    // The first and last sixth of a note are scoop and release, not vibrato.
    const trim = (note.end - note.start) / 6;
    const fr = framesIn({ start: note.start + trim, end: note.end - trim }, readings, a4);
    if (fr.length < 16) continue;
    const half = Math.floor(fr.length / 2);
    const early = swingOf(fr.slice(0, half));
    const late = swingOf(fr.slice(half));
    if (!early || !late || (!early.vib && !late.vib)) continue;
    const grows = late.vib && (!early.vib || late.width >= 1.4 * early.width);
    const fades = early.vib && (!late.vib || early.width >= 1.4 * late.width);
    rows.push(grows ? 'grows' : fades ? 'fades' : 'steady');
  }
  return { rows, longNotes };
}

function expressionDescriptors(notes, readings, seg, a4) {
  const out = [];
  const { rows, longNotes } = vibratoGrowth(notes, readings, a4);
  if (rows.length < 4) {
    out.push(missing('vibrato-growth', 'vibrato opening up on long notes',
      longNotes < 4 ? `only ${longNotes} notes held ${LONG_NOTE_SEC} s or longer; needs at least four`
        : `vibrato was found on only ${rows.length} of ${longNotes} long notes; needs at least four`, rows.length));
  } else {
    const c = (k) => rows.filter((r) => r === k).length;
    const grows = c('grows');
    const steady = c('steady');
    const fades = c('fades');
    const word = grows / rows.length >= 0.5 ? 'usually starts plain and opens up as the note is held'
      : steady / rows.length >= 0.5 ? 'is about the same width from the start to the end of the note'
        : fades / rows.length >= 0.5 ? 'usually starts wide and settles' : 'varies from note to note';
    out.push(got('vibrato-growth', 'vibrato opening up on long notes', (grows / rows.length) * 100, '%',
      `of ${rows.length} long notes with vibrato, the vibrato ${word} (${grows} open up, ${steady} stay steady, ${fades} settle)`,
      rows.length, { ok: 4, good: 10, detail: { grows, steady, fades } }));
  }

  // Leaning: do notes sit higher after a step UP than after a step DOWN? The
  // reference tuning cancels (both groups share it), and the segmenter's own
  // cents are used so no new pitch estimate is introduced. A lean is not an
  // error — melodic intonation leans toward where the line is going — so it is
  // reported as a lean and never as a mistake.
  const cutAfter = new Set(seg.cuts.map((c) => c.after));
  const up = [];
  const down = [];
  for (let i = 0; i + 1 < notes.length; i++) {
    if (cutAfter.has(i)) continue;
    const step = notes[i + 1].midi - notes[i].midi;
    if (!Number.isFinite(notes[i + 1].cents)) continue;
    if (step >= 1 && step <= 2) up.push(notes[i + 1].cents);
    else if (step <= -1 && step >= -2) down.push(notes[i + 1].cents);
  }
  if (up.length < 8 || down.length < 8) {
    out.push(missing('pitch-lean', 'pitch leaning on steps', `only ${up.length} rising and ${down.length} falling steps of a tone or less; needs at least eight of each`, Math.min(up.length, down.length)));
  } else {
    const lean = mean(up) - mean(down);
    const l = Math.round(Math.abs(lean) * 10) / 10;
    out.push(got('pitch-lean', 'pitch leaning on steps', lean, '¢',
      Math.abs(lean) < LIMITS.leanCents
        ? `notes sit at the same pitch whether reached by a step up or down (difference ${l}¢)`
        : lean > 0 ? `notes reached by a step up sit ${l}¢ higher than notes reached by a step down (the pitch leans in the direction of travel)`
          : `notes reached by a step up sit ${l}¢ lower than notes reached by a step down (the pitch leans back against the direction of travel)`,
      Math.min(up.length, down.length), { ok: 8, good: 20, detail: { rising: up.length, falling: down.length } }));
  }
  return out;
}

// --- character ----------------------------------------------------------------

// Assembled ONLY from the measured descriptors above: each clause is one
// descriptor's own phrase shortened, and a clause whose descriptor could not be
// measured is simply absent. Nothing is added that was not measured.
function characterOf(by) {
  const parts = [];
  const g = (k) => (by[k]?.measured ? by[k] : null);

  const tempo = g('tempo-flexibility');
  const dyn = g('stretch-contrast');
  const art = g('articulation');
  const even = g('articulation-evenness');
  const shape = g('phrase-shape');
  const vib = g('vibrato-growth');
  const rep = g('repeat-timing');

  if (art) parts.push(art.value >= LIMITS.legato ? 'connected' : art.value <= (art.detail.detachedAt ?? LIMITS.detached) ? 'detached' : 'lightly separated');
  if (even && art) parts.push(even.value <= even.detail.evenBelow ? 'evenly articulated' : 'varied in articulation');
  if (tempo) parts.push(tempo.value >= tempo.detail.freeAbove ? 'free in tempo' : tempo.value >= tempo.detail.steadyBelow ? 'giving a little in tempo' : 'steady in tempo');
  if (shape) {
    const top = shape.detail.dominant;
    if (top === 'arch' && shape.detail.counts.arch / shape.n >= 0.4) parts.push('with phrases that swell and fade');
    else if (top === 'level') parts.push('with phrases held at one level');
  }
  if (dyn && !shape) parts.push(dyn.value >= 6 ? 'with wide loudness contrast between stretches' : dyn.value < LIMITS.flatStretchDb ? 'with very little loudness contrast' : 'with moderate loudness contrast');
  if (vib && vib.value >= 50) parts.push('vibrato that opens up on long notes');

  // MECHANICAL is said only when most of the shaping measures could be read AND
  // every one of those reads as flat: steady tempo, level loudness, even
  // articulation, repeats identical. One expressive sign anywhere withdraws it.
  const checks = [];
  if (tempo) checks.push(['tempo', tempo.value < tempo.detail.steadyBelow]);
  if (dyn) checks.push(['loudness', dyn.value < LIMITS.flatStretchDb]);
  if (even) checks.push(['articulation', even.value <= even.detail.evenBelow]);
  if (rep) checks.push(['repeated figures', rep.value < rep.detail.sameBelow]);
  if (shape) checks.push(['phrase shape', shape.detail.counts.arch === 0 && shape.detail.counts.build + shape.detail.counts.fade === 0]);
  if (vib) checks.push(['vibrato', vib.value < 25]);
  const mechanical = checks.length >= 3 && checks.every((c) => c[1]);

  const measured = Object.values(by).filter((d) => d.measured).length;
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
  return {
    key: 'character',
    label: 'overall character',
    measured: parts.length > 0,
    mechanical,
    // The number is how many measured pieces the sentence was assembled from.
    value: parts.length > 0 ? parts.length : null,
    unit: 'pieces',
    phrase: mechanical
      ? `mechanical: ${words}; every shaping measure that could be read here is flat (${checks.map((c) => c[0]).join(', ')})`
      : words,
    n: measured,
    confidence: confidenceOf(measured, 4, 8),
    detail: { from: parts.length },
    reason: parts.length ? undefined : 'too little could be measured to describe the character',
  };
}

// The whole take. -> null when there is nothing to read.
export function musicalityOf({ notes, readings, a4 = 440 } = {}) {
  const list = (notes ?? []).filter((n) => Number.isFinite(n?.start) && Number.isFinite(n?.end) && Number.isFinite(n?.midi))
    .sort((a, b) => a.start - b.start);
  if (list.length === 0) return null;

  if (list.length < MIN_NOTES) {
    const why = `only ${list.length} note${list.length === 1 ? '' : 's'}; needs at least ${MIN_NOTES} to read how a take is shaped`;
    const keys = [
      ['phrase-count', 'phrases found'], ['phrase-definition', 'how clearly phrases are marked'],
      ['phrase-shape', 'loudness shape of phrases'], ['phrase-contrast', 'loudness contrast between phrases'],
      ['stretch-contrast', 'loudness between stretches of the take'], ['articulation', 'legato or detached'],
      ['articulation-evenness', 'how even the articulation is'], ['tempo-flexibility', 'how much the tempo moves'],
      ['tempo-shape', 'whether the tempo returns or drifts'], ['phrase-final-lengthening', 'lengthening at phrase ends'],
      ['repeat-timing', 'repeated figures: timing'], ['repeat-loudness', 'repeated figures: loudness'],
      ['vibrato-growth', 'vibrato opening up on long notes'], ['pitch-lean', 'pitch leaning on steps'],
    ];
    const by = Object.fromEntries(keys.map(([k, l]) => [k, missing(k, l, why, list.length)]));
    by.character = { ...missing('character', 'overall character', why, list.length), mechanical: false };
    return { noteCount: list.length, durationSec: list.at(-1).end - list[0].start, descriptors: by, phrases: [] };
  }

  const levels = levelsOf(list, readings);
  const seg = segmentPhrases(list, levels);
  const fl = floorsFor(median(list.slice(1).map((n, i) => n.start - list[i].start)));
  const all = [
    ...phraseDescriptors(list, seg),
    ...dynamicsDescriptors(list, levels, seg),
    ...articulationDescriptors(list, seg, fl),
    ...tempoDescriptors(list, seg, fl),
    ...repeatDescriptors(list, levels, seg, fl),
    ...expressionDescriptors(list, readings, seg, a4),
  ];
  const by = Object.fromEntries(all.map((d) => [d.key, d]));
  by.character = characterOf(by);
  // HOW MUCH TO TRUST WHAT WAS HEARD. Every descriptor's confidence is a count
  // of what it was measured from, and a count says nothing about whether the
  // notes were right. MEASURED on four real MusicNet cello excerpts, the
  // segmenter returned 16-39% of its notes shorter than 80 ms — which the
  // Analyzer cannot resolve as real notes (see docs: 12 notes a second is its
  // limit) — in places where the cellist was playing double stops or fast
  // runs; those are mis-heard fragments. A take with that many is read with
  // 'low' confidence throughout, whatever the counts say.
  const shortShare = list.filter((n) => n.end - n.start < 0.08).length / list.length;
  const noisy = shortShare >= LIMITS.noisyShortShare;
  if (noisy) for (const x of Object.values(by)) if (x.measured) x.confidence = 'low';
  return {
    noteCount: list.length,
    durationSec: list.at(-1).end - list[0].start,
    reliability: { shortNoteShare: shortShare, noisy },
    descriptors: by,
    phrases: seg.phrases.map((p) => ({ from: p.from, to: p.to, start: list[p.from].start, end: list[p.to].end })),
    levels,
  };
}

// --- comparison ---------------------------------------------------------------

// `good` is set only where one direction is plainly the aim: a repeated figure
// played the same way twice is closer to "the same", which is what the figure's
// own repeat asks for. Everything else is a difference in shaping, and a
// teacher or the player decides whether more contrast is what the piece wants.
const COMPARE = [
  { key: 'phrase-count', get: (m) => m.descriptors['phrase-count'], small: 1.5, abs: true, up: 'more, shorter phrases', down: 'fewer, longer phrases' },
  { key: 'phrase-definition', small: 20, up: 'more clearly marked phrase ends', down: 'less clearly marked phrase ends' },
  { key: 'phrase-shape', small: 20, up: 'more phrases that swell and fade', down: 'fewer phrases that swell and fade' },
  { key: 'phrase-contrast', small: 0.8, up: 'more phrasing contrast', down: 'less phrasing contrast' },
  { key: 'stretch-contrast', small: 1.5, up: 'more loudness contrast across the take', down: 'less loudness contrast across the take' },
  { key: 'articulation', small: 0.1, up: 'more connected', down: 'more detached' },
  { key: 'articulation-evenness', small: 0.06, up: 'less even articulation', down: 'more even articulation' },
  { key: 'tempo-flexibility', small: 2.5, up: 'a freer tempo', down: 'a steadier tempo' },
  { key: 'phrase-final-lengthening', small: 0.25, up: 'more lengthening at phrase ends', down: 'less lengthening at phrase ends' },
  { key: 'repeat-timing', small: 1.5, good: 'lower', up: 'repeated figures less alike in timing', down: 'repeated figures more alike in timing' },
  { key: 'repeat-loudness', small: 0.8, good: 'lower', up: 'repeated figures less alike in loudness', down: 'repeated figures more alike in loudness' },
  { key: 'vibrato-growth', small: 25, up: 'vibrato opens up more on long notes', down: 'vibrato opens up less on long notes' },
  { key: 'pitch-lean', small: 3, up: 'pitch leans more with the direction of travel', down: 'pitch leans less with the direction of travel' },
];

export function compareMusicality(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const c of COMPARE) {
    const a = before.descriptors[c.key];
    const b = after.descriptors[c.key];
    const label = (b ?? a)?.label ?? c.key;
    const unit = (b ?? a)?.unit ?? '';
    if (!a?.measured || !b?.measured) {
      out.push({ key: c.key, label, unit, before: a?.measured ? a.value : null, after: b?.measured ? b.value : null, change: null, verdict: 'unmeasured' });
      continue;
    }
    const delta = b.value - a.value;
    const verdict = Math.abs(delta) < c.small ? 'about the same' : delta > 0 ? c.up : c.down;
    const row = { key: c.key, label, unit, before: a.value, after: b.value, change: delta, verdict };
    if (c.good && Math.abs(delta) >= c.small) row.better = (delta < 0) === (c.good === 'lower');
    out.push(row);
  }
  return out;
}

export function describeMusicality() {
  return COMPARE.map((c) => ({ key: c.key }));
}
