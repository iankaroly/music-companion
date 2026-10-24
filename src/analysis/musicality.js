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
// it was measured from. A comparison says what moved and in which direction
// ("more alike", "less alike") and NEVER which way is better: whether sameness
// of two matching five-note patterns is what a piece asks for is the player's
// and the teacher's to say, and a sequence the composer wrote differently twice
// would be marked down for being played as written.
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
const STRETCH_NOTES = 8;        // notes in one stretch of the loudness-between-stretches reading
const MIN_STRETCHES = 4;        // fewest stretches that give a quartile spread a middle
const MIN_CONF = 0.6;          // the same pitched-frame floor quality.js and the segmenter use

// Thresholds. See the header: set from the synthetic noise floors, in advance
// of the real recordings, and written down in docs/musicality.md.
export const LIMITS = {
  restGapSec: 0.05,          // a silence this much longer than the take's usual one (and long against the tempo) can end a phrase; a small floor only: the bar is the take's own spacing (restGapBeats)
  restGapBeats: 0.35,        //   …as a share of the local note spacing
  breathGapSec: 0.12,        // a silence this much longer than usual is a breath on its own; a floor under the take's own spacing (breathGapBeats), not the bar itself
  breathGapBeats: 0.4,       //   …as a share of the local note spacing (0.5 missed a breath of 0.6 of a note at every tempo under 0.35 s a note; 0.35 cut a ragged take once in 150; see the header of segmentPhrases)
  longNote: 1.7,             // a note spaced this many times the local spacing is a long note
  levelReset: 4,             // dB: loudness steps up after a fall = a new start
  flatPhraseDb: 2.5,         // a phrase whose loudness moves less than this is level
  jumpyStepDb: 3.2,          // mean dB change from one note to the next above which a phrase is uneven, whatever its outline
  noisyShortShare: 0.25,     // share of heard notes under 80 ms above which every descriptor is low confidence
  scatterPct: 8,             // note-to-note timing scatter (%) above which no tempo is read from a score-free take
  shapeDb: 2,                // how far loudness must climb and fall to be an arch
  steadyTempo: 4,            // % spread of the local tempo that still reads as steady (at least; see floorsFor)
  freeTempo: 9,              // % spread above which the tempo is clearly moving (at least)
  driftPct: 8,               // % faster or slower at the end than the start (the whole-curve trend, backed by a second reading) = drift
  driftR2: 0.4,              // share of the movement of the smoothed tempo curve a straight line must explain for it to be a drift and not a wave
  leanPct: 4,                //   …and from here to driftPct a slight drift; under it the tempo ends where it began
  legato: 0.85,              // sounding length / spacing at or above = connected
  detached: 0.55,            // at or below = clearly separated
  evenArticulation: 0.12,    // spread (quartile range) of that ratio that reads as even (at least; see floorsFor)
  flatStretchDb: 1,          // spread (standard deviation, dB) of stretch or phrase loudness under which the loudness is level; flat synthetic takes read 0.0
  wideStretchDb: 3,          //   …and at or above which the contrast between stretches is wide
  flatLengthening: 1.25,     // phrase-final note sounding this many times the notes before it or more is a lengthening; metronomic takes read up to 1.17 through the real pipeline
  minCoverage: 0.5,          // share of the loud sound that must have been heard as notes; below it most of the take was not heard
  junkPatterned: 0.2,        // …and fewer than this share of five-note windows have their steps again elsewhere in the take (a drill repeats; noise does not)
  junkStep: 9,               // median semitones between neighbouring notes at or above which, with no patterned repeats, the pitches are not a tune (random pitches read 11-14)
  outOfRangeShare: 0.25,     // share of notes outside the range the caller gives, at or above which confidence is low throughout
  unbrokenQuiet: 0.02,       // share of readings more than 12 dB under the loud level below which the sound never stopped at all (real cello: 8.5-21%, a 60 Hz hum: 0-0.3%)
  unbrokenSpreadDb: 3,       //   …AND under which the 10th percentile of the loudness sits under the 90th: a hum is within 1.7 dB, a long slur that swells and fades is 6.9 dB, real cello 11-14 dB
  unbrokenReadings: 100,     // readings (about 2.3 s) needed before that is a statement about the take
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
  // Sample (n-1) form: the population one reads small on the handful of phrases
  // a short take has, so the same playing read lower the shorter the take.
  return Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1));
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

  // THE BREATH BAR IS THE TAKE'S OWN SPACING, not a number of seconds. The first
  // version asked for a silence of at least 0.2 s (and 0.1 s for half a cue), so
  // the same performance scaled in time found its phrases at 0.4 s a note and
  // lost them at 0.3: with a breath of 0.6 of a note, eight phrases of eight
  // came back as 8 at 0.4 s, 2-5 by seed at 0.35 s and 1 at 0.3 s, and 136 of
  // 240 pairs of one player at two tempos said "more, shorter phrases" (16
  // seeds, six tempos from 0.3 to 0.7 s, through the real Analyzer and
  // segmenter). The bar is now 0.4 of the local spacing beyond the take's usual
  // silence, with a floor of 0.12 s. 0.5 of a note was tried first and still
  // missed the breath below 0.35 s (9 of 16 takes right at 0.3 s); 0.35 and 0.3
  // cut a ragged breath-free take (one in 150, two in 150). At 0.4: no false cut
  // in 150 ragged, stretched, uneven and arched breath-free takes, none in 112
  // through the real pipeline from 0.12 to 0.6 s a note, and 16 of 16 right from
  // 0.3 s a note. THE FLOOR WAS 0.08 s FIRST (all 16 right from 0.25 s) and was
  // raised because real cello is full of silences of 0.08-0.2 s beyond the usual
  // one (11-33 in 45 s of each of seven excerpts, against 0-9 of 0.2 s or more)
  // that are bow changes and not breaths: the seven excerpts came to 136 phrase
  // cuts at 0.08 s, 125 at 0.1, 117 at 0.12, 99 at 0.2, against 79 before this
  // change; 0.12 keeps every tempo of 0.3 s a note and slower. Below that the
  // instrument cannot see a breath of 0.6 of a note (see FASTEST_BEAT_SEC), and the
  // comparison says nothing about phrases. WHETHER 117 IS RIGHT FOR THE REAL
  // PLAYING IS NOT KNOWN: the labels of MusicNet are continuous (no silence of 0.12 s
  // anywhere in the seven excerpts), so they say nothing about where the
  // phrases end.

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

    // The spread of the phrase levels as a standard deviation, which does not
    // grow with the number of phrases the way loudest-minus-quietest does. (That
    // was the first version's second sentence.)
    const means = usable.map((x) => mean(x.lv));
    const contrast = sd(means);
    out.push(got('phrase-contrast', 'loudness contrast between phrases', contrast, 'dB',
      `the phrases vary in loudness by about ${Math.round(contrast * 10) / 10} dB (the standard deviation of their levels)`,
      usable.length, { ok: 3, good: 6 }));
  }

  // The take read in stretches of eight notes. This is NOT phrasing — it is
  // what can still be said about contrast when the playing is continuous and
  // no phrase breaks exist, and it is labelled as stretches for that reason.
  //
  // THE STATISTIC IS THE STANDARD DEVIATION OF THE STRETCH LEVELS (n-1 form),
  // not loudest minus quietest. The range of N draws grows with N: the same
  // random loudness read 0.8 dB at 20 notes, 2.9 at 40 and 5.9 at 640, so a
  // long take always looked more dynamic than a short one of the same playing.
  // A standard deviation estimates a fixed property of the playing. A quartile
  // spread (p75-p25) was tried first, as the more robust choice, and is NOT flat
  // either: with only a few stretches it reads about 0.6 of its long-take value
  // (1.0 dB at 32 notes against 1.64 at 640, the same playing), the n-1
  // standard deviation reads 1.06 against 1.21. Four stretches (32 notes) is
  // the fewest that gives it any spread at all.
  const finite = levels.map((l, i) => ({ l, i })).filter((x) => Number.isFinite(x.l));
  if (finite.length >= STRETCH_NOTES * MIN_STRETCHES) {
    const stretch = [];
    for (let i = 0; i + STRETCH_NOTES <= finite.length; i += STRETCH_NOTES) stretch.push(mean(finite.slice(i, i + STRETCH_NOTES).map((x) => x.l)));
    const spread = sd(stretch);
    out.push(got('stretch-contrast', 'loudness between stretches of the take', spread, 'dB',
      `the runs of eight notes vary in loudness by about ${Math.round(spread * 10) / 10} dB (the standard deviation of their levels; read in runs of eight notes, not phrases)`,
      stretch.length, { ok: 4, good: 8 }));
  } else {
    out.push(missing('stretch-contrast', 'loudness between stretches of the take',
      `fewer than ${STRETCH_NOTES * MIN_STRETCHES} notes with a loudness reading, which is the fewest that makes four runs of eight`, finite.length));
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
      //
      //
      // THAT RESET CAN LAND ON A LONG NOTE (or half of one), after which the
      // follower runs at twice or half the true period for the rest of the take:
      // a take with NO drift read 'ends 52% faster' (the period stepping 0.5 ->
      // 1.0 s after a breath). TRIED AND WRONG: re-finding the beat at the
      // octave nearest the last accepted period (the spacing divided by the rung
      // that lands within a quarter of it). It stopped the lock and broke the
      // follower on a tempo wave: of 60 takes with a 15% wave and 4% jitter,
      // 12 were still read and 48 refused as mixed note values, against 56 read
      // with the plain reset, because the rung chosen for a breath's spacing put
      // the reference 10% off and the next beats missed the window in a cascade.
      // The lock is caught afterwards instead (tempoRefusal, below).
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

// THE FOLLOWER CAN BE WRONG ABOUT THE BEAT AND NOT KNOW IT. Four ways, each
// measured on takes built with no drift at all (jitter of 4-20% on every
// spacing, 20 seeds at each of 6, 12 and 24 phrases; see docs/musicality.md):
// it locks on half or double the beat after a breath (a step of an exact factor
// of two in the period); it locks on a rung that is NOT a factor of two (two
// thirds or three quarters of a beat: a run of spacings that came out short
// snaps to the 1.5 or 4/3 rung and the track stays there for 14 notes, then
// slips back, which read 'free, 23%' of a metronomic take); it random-walks,
// because each spacing is judged against the last two accepted and the track
// wanders by more than the playing does (false drifts of 13-21% at 20% jitter);
// and a small sample of noisy spacings gives a difference between the start and
// the end that is inside its own noise. So a drift is claimed only when (1) the
// period never steps by a rung's ratio between neighbouring runs, (2) a SECOND
// reading, every spacing snapped against one fixed reference with no following at
// all, finds a trend of the same sign and about the same size, and (3) that second
// reading's trend is at least three and a half times its own standard error. The
// standard error is taken from the SECOND reading because its spacings are
// independent draws; the follower's track is autocorrelated, so a standard error
// computed on it was too small (measured at 8% jitter: the z score of a
// zero-drift take had a standard deviation of 1.9 to 4.2 where it should have
// been 1, and reached 28).
// Fail (1) or (2) and neither the shape nor the flexibility is printed, because
// a track that jumped or wandered has a spread that is the follower's.
const SNAP_FIXED = 0.25;   // octaves; wider than SNAP because no following keeps the reference near

// THE TREND IS THE WHOLE CURVE, NOT ITS THIRDS. The drift was the difference of
// the medians of the first and last third of the smoothed curve with an 8% bar.
// A steady acceleration of 11% from first note to last differs by two thirds of
// that between its thirds (7.3%), under the bar, so the take was 'steady' (8 of
// 20 takes through the real pipeline) or 'returns' (6 of 20) and said so in
// words that mean it ends where it began. 'Slowing by 9%' read 'returns' in 11
// of 20. The line through the whole curve (least squares of the log period on
// time, read as the change from the first note to the last along that line)
// recovers the 11%, and a standard error comes with it.
function trendOf(pts) {
  const n = pts.length;
  if (n < 8) return null;
  const mt = mean(pts.map((p) => p.t));
  const my = mean(pts.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) { sxx += (p.t - mt) ** 2; sxy += (p.t - mt) * (p.y - my); }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  let rss = 0;
  for (const p of pts) rss += (p.y - my - slope * (p.t - mt)) ** 2;
  const se = Math.sqrt(rss / (n - 2) / sxx);
  const span = pts[n - 1].t - pts[0].t;
  // positive = faster at the end (a shorter period)
  const drift = (2 ** (-slope * span) - 1) * 100;
  return { drift, z: se > 0 ? Math.abs(slope) / se : Infinity, seDrift: se * span * Math.LN2 * 100 };
}

// How much of the movement of the smoothed curve a straight line through it
// explains. A drift is one-way and a line explains most of it (an 11% speed-up
// with 4% jitter: 0.8); a wave is not, and a line through a few cycles of one
// explains next to none of it however the cycles happen to end (a 15% wave:
// under 0.1), which is what keeps a tempo wave from being called a drift
// because it stopped at a different phase from where it started.
function lineR2(ts, ys) {
  const mt = mean(ts);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < ts.length; i++) { sxx += (ts[i] - mt) ** 2; sxy += (ts[i] - mt) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
}

function fixedReference(notes) {
  const valid = [];
  for (let i = 0; i + 1 < notes.length; i++) {
    const v = notes[i + 1].start - notes[i].start;
    if (v > 0.04) valid.push({ t: notes[i].start, v });
  }
  const ref = median(valid.map((x) => x.v));
  if (!ref) return null;
  // Only the spacings of the take's own commonest length, not the whole
  // ladder: with every rung allowed, a breath's spacing (1.7-1.9 beats) snapped
  // to the 1.5 or 2 rung and was read as a note a tenth off the beat, and the
  // handful of them in each third made one zero-drift take in a hundred 'end
  // 15% slower' at 20% jitter.
  const pts = [];
  for (const x of valid) if (Math.abs(Math.log2(x.v / ref)) <= SNAP_FIXED) pts.push({ t: x.t, y: Math.log2(x.v) });
  if (pts.length < MIN_NOTES || pts.length < 0.5 * valid.length) return null;
  const main = trendOf(pts);
  if (!main) return null;
  // REPLICATION: the same trend must show in the even-numbered spacings and in
  // the odd-numbered ones taken alone, each of which is an independent half of
  // the data. One zero-drift take in sixty at 20% jitter passed everything else
  // (-15%, a step half way along that its own sample noise produced).
  const halves = [pts.filter((_, i) => i % 2 === 0), pts.filter((_, i) => i % 2 === 1)].map(trendOf);
  return { ...main, replicates: halves.every((h) => h && Math.sign(h.drift) === Math.sign(main.drift) && Math.abs(h.drift) >= 0.4 * LIMITS.leanPct) };
}

// A trend is only worth a word when the independent reading backs it. A scored
// take has no second reading to ask: each spacing is already over its written
// beats, so its own line is the evidence.
const trendBacked = (t, scored) => !!t && t.z >= 3.5 && (scored || t.replicates);

// THE FOLLOWER ON THE WRONG RUNG, CHECKED ON THE PERIOD TRACK ITSELF. Only a step
// of an exact factor of two between neighbouring runs of four was caught before,
// and some of 100,000 random constant-tempo takes read 'free' at 12-32% from a
// lock on 2/3 or 3/4 of a beat: a run of short spacings made the follower take
// the next ones for a dotted value, and its period sat 30% low for 14 notes. TRIED
// AND WRONG: refusing any step of 0.32-0.69 of an octave (the size of a ratio
// between two rungs) between neighbouring runs: a tempo wave of 15% steps by up
// to 0.41 between them, as far as a lock does, so waves went (the test that 'a
// 15% wave is still a wave' failed). TRIED AND WRONG TOO: requiring the step to
// arrive at one note (a jump of 0.25 or more between neighbouring spacings),
// because the spacing after a breath is divided by the 1.5 or 2 rung and jumps
// that much in an ordinary take.
// What a lock does that nothing else does is take the take's COMMONEST spacing
// for something other than one beat. Every spacing within a quarter of an octave
// of the median spacing is what the take's own beat looks like (a tempo wave
// of 15% keeps its spacings inside that), so three in a row that the follower
// assigned any other rung to is the follower being on the wrong one.
function tempoRefusal(notes, kept, trendMain, fixedRef) {
  const lg = kept.map((k) => Math.log2(k.period));
  const W = 4;
  for (let k = W; k + W <= lg.length; k++) {
    const step = median(lg.slice(k, k + W)) - median(lg.slice(k - W, k));
    if (Math.abs(Math.abs(step) - 1) <= 0.2) {
      return 'the beat the follower kept jumped by a factor of two part way through, which is how it loses a half or double beat, so no tempo shape is claimed';
    }
  }
  const spacings = [];
  for (let i = 0; i + 1 < notes.length; i++) {
    const v = notes[i + 1].start - notes[i].start;
    if (v > 0.04) spacings.push(v);
  }
  const common = median(spacings);
  let run = 0;
  for (const k of kept) {
    const own = Math.abs(Math.log2(k.period * k.rung / common)) <= SNAP_FIXED;
    run = own && k.rung !== 1 ? run + 1 : 0;
    if (run >= 3) {
      return 'the follower took the take\'s commonest spacing for a different note value (two thirds, three quarters, half or double of a beat) for several notes running, which is how it loses the beat, so no tempo shape is claimed';
    }
  }
  const fixed = fixedRef ? fixedRef.drift : null;
  const main = trendMain ? trendMain.drift : null;
  // The two readings pointing opposite ways by more than a few per cent is the
  // estimate disagreeing with itself. A follower that merely claims more than
  // the fixed reading backs is not refused: it just does not get to say 'drift'
  // (see trendBacked). TRIED AND WRONG: refusing whenever they differed by more
  // than a third; a 15% tempo wave, which is exactly the give this module is
  // for, was refused in 14-52% of takes at 4-8% jitter, because a wave's first
  // and last third differ by an amount that depends on its phase.
  if (fixed !== null && main !== null && Math.abs(main) >= 4 && Math.abs(fixed) >= 4 && Math.sign(fixed) !== Math.sign(main)) {
    return 'the tempo estimate disagreed with itself between two ways of reading the same spacings, so no tempo shape is claimed';
  }
  return null;
}

// TEMPO FLEXIBILITY DOES NOT DEPEND ON HOW LONG THE TAKE IS. It was the spread
// between the 10th and 90th percentile of the smoothed curve, which for a
// quantile of N points reaches further the more points there are: the same
// playing (each spacing off by up to 2%) read 1.2% at 14 notes and 2.0% at 672,
// and at +-9% a player was called steady in 76% of 14-note takes and 0% of 672-note
// ones. It is now read in windows of 24 spacings (smoothed inside each window,
// half a window apart), pooled as a variance: every window is the same
// estimator whatever the length, and a take with fewer than 24 spacings is
// refused rather than read at a length where the number is not stable. The
// number also carries its standard error (about 1 over the square root of
// two thirds of the spacings, as measured: 29% at 28 notes, 5% at 672), and the
// WORD is only 'steady' or 'gives a little' when the whole of the number plus or
// minus that is on one side of the line; otherwise it says it is on the edge.
const FLEX_WINDOW = 24;

function flexOf(logs) {
  const n = logs.length;
  if (n < FLEX_WINDOW) return null;
  const starts = [];
  for (let s = 0; s + FLEX_WINDOW <= n; s += FLEX_WINDOW / 2) starts.push(s);
  if (starts.at(-1) + FLEX_WINDOW < n) starts.push(n - FLEX_WINDOW);
  const vars = starts.map((s) => {
    const w = logs.slice(s, s + FLEX_WINDOW);
    const sm = w.map((x, k) => median(w.slice(Math.max(0, k - 2), k + 3)));
    const m = mean(sm);
    return sm.reduce((a, x) => a + (x - m) ** 2, 0) / (sm.length - 1);
  });
  const spreadOct = 1.2816 * Math.sqrt(mean(vars));
  const pct = (2 ** spreadOct - 1) * 100;
  return { pct, se: pct / Math.sqrt((2 * n) / 3), windows: starts.length };
}

// The word for a flexibility, with its uncertainty.
function flexWord(flex, fl) {
  const lo = flex.pct - flex.se;
  const hi = flex.pct + flex.se;
  if (hi < fl.steadyBelow) return 'steady';
  if (lo >= fl.freeAbove) return 'free';
  if (lo >= fl.steadyBelow && hi < fl.freeAbove) return 'gives';
  // the band reaches across a line: say which line the number is nearer to
  return Math.abs(flex.pct - fl.steadyBelow) <= Math.abs(flex.pct - fl.freeAbove) ? 'edge-steady' : 'edge-free';
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
    const trendMain = trendOf(kept.map((k) => ({ t: k.t, y: Math.log2(k.period) })));
    const fixedRef = scored ? null : fixedReference(notes);
    const refusal = scored ? null : tempoRefusal(notes, kept, trendMain, fixedRef);
    if (refusal) {
      out.push(missing('tempo-flexibility', 'how much the tempo moves', refusal, kept.length));
      out.push(missing('tempo-shape', 'whether the tempo returns or drifts', refusal, kept.length));
    } else {
      const flex = flexOf(logs);
      const word = flex ? flexWord(flex, fl) : null;
      const f = flex ? Math.round(flex.pct) : null;
      // The trend that is believed: the independent reading's when there is one.
      const trend = scored ? trendMain : fixedRef;
      const backed = trendBacked(trend, scored);
      const drift = trend ? trend.drift : trendMain ? trendMain.drift : 0;
      const big = Math.abs(drift);
      const sm = logs.map((x, k) => median(logs.slice(Math.max(0, k - 2), k + 3)));
      const driftLike = lineR2(kept.map((k) => k.t), sm) >= LIMITS.driftR2;
      // How far the end of the curve is from its start, medians of the first and
      // last sixth of the smoothed curve: what "comes back to where it began"
      // is checked against.
      const edge = Math.max(3, Math.floor(sm.length / 6));
      const endGap = (2 ** (median(sm.slice(0, edge)) - median(sm.slice(-edge))) - 1) * 100;
      const apart = Math.abs(endGap);
      // A wave: the tempo moves by more than steady playing does (so there is a
      // movement for the end to differ by) and no line explains it. A curve that
      // is steady and still seems to end 4% or more from its start is a drift that
      // was not backed, or noise, and is not described as ending where it began.
      const waveLike = !!flex && word !== 'steady' && word !== 'edge-steady' && !driftLike;
      // A drift the second reading does not back is NOT called a return or
      // steady either: "comes back to where it began" of a take that did end 15%
      // faster is as false as a drift that never happened (the first cut of an
      // earlier fix did exactly that: of 100 takes with a true 20% drift at 12%
      // jitter, 33 read 'returns' or 'steady' against 5 before). So a curve a
      // line explains (driftLike) that seems to end 4% or more away from where it
      // began, which nothing backs, is refused. A wave is not driftLike and is
      // judged by where it ends: 'comes back' only within 4% of the start.
      let kind = null;
      let phrase = '';
      if (backed && driftLike && big >= LIMITS.driftPct) {
        kind = drift > 0 ? 'speeds-up' : 'slows-down';
        phrase = `the tempo ends ${Math.round(big)}% ${drift > 0 ? 'faster' : 'slower'} than it began (it drifts rather than returns)`;
      } else if (backed && driftLike && big >= LIMITS.leanPct) {
        kind = drift > 0 ? 'leans-faster' : 'leans-slower';
        phrase = `the tempo ends ${Math.round(big)}% ${drift > 0 ? 'faster' : 'slower'} than it began (a slight drift, not a return)`;
      } else if ((driftLike || !waveLike) && Math.max(big, Math.abs(trendMain?.drift ?? 0)) >= LIMITS.leanPct) {
        kind = null;
      } else if (!flex) {
        kind = null;
      } else if (word === 'steady') {
        kind = 'steady';
        phrase = `the tempo ends where it began (within ${Math.max(Math.round(apart), 1)}%) and stays steady throughout`;
      } else if (apart >= LIMITS.leanPct) {
        kind = 'moves';
        phrase = `the tempo moves by about ${f}% around its middle, and its end differs from its start by about ${Math.round(apart)}%, so it is not said to come back to where it began`;
      } else if (word === 'edge-steady') {
        kind = 'level';
        phrase = `the tempo ends within ${Math.max(Math.round(apart), 1)}% of where it began, and how much it moves in between (about ${f}%) is on the edge between steady and giving a little`;
      } else {
        kind = 'returns';
        phrase = `the tempo moves by about ${f}% around its middle and comes back to where it began (it ends within ${Math.max(Math.round(apart), 1)}% of the start)`;
      }
      if (flex) {
        // The spread is read inside windows of 24 spacings, so a steady
        // acceleration is invisible to it; say so beside it, not after it.
        const drifting = kind === 'speeds-up' || kind === 'slows-down' || kind === 'leans-faster' || kind === 'leans-slower';
        const flexPhrase = {
          steady: `the tempo is steady from one short stretch to the next, within about ${f}% of its middle (a slow movement over the whole take is not counted here)`,
          gives: `the tempo gives a little, by about ${f}% around its middle`,
          free: `the tempo is free, moving by about ${f}% around its middle`,
          'edge-steady': `the tempo moves by about ${f}% around its middle, which is on the edge between steady and giving a little`,
          'edge-free': `the tempo moves by about ${f}% around its middle, which is on the edge between giving a little and free`,
        }[word] + (drifting ? ' (not counting its drift through the take)' : '');
        out.push(got('tempo-flexibility', 'how much the tempo moves', flex.pct, '%', flexPhrase, kept.length,
          { ok: 12, good: 30, detail: { word, se: flex.se, windows: flex.windows, keptShare: kept.length / total, steadyBelow: fl.steadyBelow, freeAbove: fl.freeAbove } }));
      } else {
        out.push(missing('tempo-flexibility', 'how much the tempo moves',
          `only ${kept.length} steady spacings; the spread of the tempo is read in windows of ${FLEX_WINDOW} so that it does not depend on how long the take is, and needs at least that many`, kept.length));
      }
      out.push(kind
        ? got('tempo-shape', 'whether the tempo returns or drifts', drift, '%', phrase, kept.length, { ok: 12, good: 30, detail: { kind } })
        : missing('tempo-shape', 'whether the tempo returns or drifts',
          (driftLike || !waveLike) && Math.max(big, Math.abs(trendMain?.drift ?? 0)) >= LIMITS.leanPct
            ? `the tempo seems to end ${(Math.abs(trendMain?.drift ?? 0) > big ? trendMain.drift : drift) > 0 ? 'faster' : 'slower'} than it began, but a second reading of the same spacings did not back that, so no tempo shape is claimed`
            : `no drift was found, but with only ${kept.length} steady spacings the spread of the tempo is not read, so whether it returns or holds is not claimed`,
          kept.length));
    }
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
      `phrase-final notes are ${m.toFixed(1)} times as long as the notes before them (a written long note counts too without a score)`,
      ratios.length, { ok: 3, good: 6 }));
  } else {
    out.push(missing('phrase-final-lengthening', 'lengthening at phrase ends', `only ${ratios.length} phrase ends with enough notes before them; needs at least three`, ratios.length));
  }
  return out;
}

// --- repeated figures ---------------------------------------------------------

const FIGURE = 5;   // notes in a figure
const REPEAT_PAIRS_PER_INDEPENDENT = 4;   // see repeatDescriptors: with 1 the carried error was half of the number's real spread across seeds (200 seeds, 20 to 96 notes, four jitters), with 4 it matches

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
    const why = `only ${timing.length} pair${timing.length === 1 ? '' : 's'} of matching five-note patterns found (five notes with the same steps, wherever they come); needs at least four`;
    out.push(missing('repeat-timing', 'timing of matching five-note patterns', why, timing.length));
    out.push(missing('repeat-loudness', 'loudness of matching five-note patterns', why, loud.length));
    return out;
  }
  // WHAT THIS IS AND IS NOT. A 'match' is any two runs of five notes with the
  // same steps, so a scale, a sequence or an arpeggio counts, and so does a
  // figure the composer wrote differently twice that happens to share its steps.
  // It is not 'a repeated passage', and nothing here says whether being alike is
  // what the music asks for: that is the player's and the teacher's to say.
  const t = median(timing);
  // THE WORD CARRIES ITS UNCERTAINTY, like the tempo's. The median of the pairs'
  // timing differences does not move with the length of the take (3.8-4.05% at +-4%
  // jitter from 16 notes to 320), but its spread does, and a player near the line
  // was 'alike' in 80% of 28-note takes and 98% of 672-note ones (+-6% jitter) and
  // 45% against 23% (+-9%): the word flipped on identical playing. The standard
  // error of a median (1.25 sd over the square root of the pairs, with the pairs
  // counted at REPEAT_PAIRS_PER_INDEPENDENT of them to the independent one because
  // neighbouring pairs share notes) is carried, and a number within one of it of
  // the line is 'on the edge' and not either word.
  const se = timing.length > 1 ? (1.2533 * sd(timing)) / Math.sqrt(timing.length / REPEAT_PAIRS_PER_INDEPENDENT) : 0;
  const word = t + se < fl.sameBelow ? 'alike' : t - se >= fl.sameBelow ? 'different' : 'edge';
  const tShown = Math.round(t * 10) / 10;
  out.push(got('repeat-timing', 'timing of matching five-note patterns', t, '%',
    {
      alike: `matching five-note patterns are timed nearly alike each time (timing differs by about ${tShown}%)`,
      different: `matching five-note patterns are timed differently each time (timing differs by about ${tShown}%)`,
      edge: `matching five-note patterns are timed on the edge between alike and different each time (timing differs by about ${tShown}%)`,
    }[word],
    timing.length, { ok: 4, good: 10, detail: { paceDiffPct: median(pace), sameBelow: fl.sameBelow, word, se } }));
  if (loud.length >= 4) {
    const l = median(loud);
    out.push(got('repeat-loudness', 'loudness of matching five-note patterns', l, 'dB',
      l < LIMITS.sameLoudnessDb
        ? `matching five-note patterns have nearly the same loudness shape each time (differing by about ${Math.round(l * 10) / 10} dB)`
        : `matching five-note patterns are shaped differently in loudness each time (differing by about ${Math.round(l * 10) / 10} dB)`,
      loud.length, { ok: 4, good: 10 }));
  } else out.push(missing('repeat-loudness', 'loudness of matching five-note patterns', `only ${loud.length} matching five-note patterns with a loudness reading; needs at least four`, loud.length));
  return out;
}

// --- pitch expression ---------------------------------------------------------

// The pitch frames inside a note. Each carries its loudness, because what a
// pitch tracker reports from the near-silent tail of a note is not pitch.
function framesIn(note, readings, a4) {
  const out = [];
  for (const r of readings ?? []) {
    if (r.time < note.start) continue;
    if (r.time >= note.end) break;
    if (!(r.frequency > 0) || !(r.confidence >= MIN_CONF)) continue;
    out.push({ t: r.time, c: 1200 * Math.log2(r.frequency / a4), rms: r.rms });
  }
  return out;
}

// THE VIBRATO MEASURE'S OWN CONFIDENCE. A stretch of pitch is a vibrato when a
// single steady sine wave at a vibrato's rate (3.5-9.5 Hz) explains at least
// half of how the pitch moves about its own slope (r2), and the wave is at least
// 10 cents wide. The first version asked only for a wide enough swing that
// crossed its middle at about a vibrato's rate, which random wobble does by
// chance: calibrated on simulated stretches of 16, 24 and 40 frames, white
// wobble of 8 cents passed 0.5%, 0.1% and 0% of the time at an r2 of 0.5, and a
// real 28-cent vibrato with 5 cents of noise 100% of the time (a vibrato that
// opens up from nothing, the hardest real case, 96-99.5%).
const VIB_R2 = 0.5;
const VIB_CENTS = 10;

function sineFit(frames, rates) {
  const n = frames.length;
  const t0 = frames[0].t;
  const t = frames.map((f) => f.t - t0);
  const mt = mean(t);
  const mc = mean(frames.map((f) => f.c));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) { num += (t[i] - mt) * (frames[i].c - mc); den += (t[i] - mt) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const dev = frames.map((f, i) => f.c - mc - slope * (t[i] - mt));
  const total = dev.reduce((x, y) => x + y * y, 0);
  let best = { r2: 0, amp: 0, rate: 0 };
  for (const rate of rates) {
    let ss = 0; let cc = 0; let sc = 0; let ys = 0; let yc = 0;
    for (let i = 0; i < n; i++) {
      const w = 2 * Math.PI * rate * t[i];
      const si = Math.sin(w);
      const co = Math.cos(w);
      ss += si * si; cc += co * co; sc += si * co; ys += dev[i] * si; yc += dev[i] * co;
    }
    const det = ss * cc - sc * sc;
    if (Math.abs(det) < 1e-9) continue;
    const p = (ys * cc - yc * sc) / det;
    const q = (yc * ss - ys * sc) / det;
    const r2 = total > 0 ? (p * ys + q * yc) / total : 0;
    if (r2 > best.r2) best = { r2, amp: Math.hypot(p, q), rate };
  }
  return { ...best, dev, t };
}

const VIB_RATES = Array.from({ length: 25 }, (_, k) => 3.5 + 0.25 * k);

// The width of the wave at a GIVEN rate in a part of the note (the rate is the
// whole note's: a half of a note is too short to find its own).
function widthAt(part, rate) {
  const t0 = part[0].t;
  const m = mean(part.map((f) => f.c));
  let ss = 0; let cc = 0; let sc = 0; let ys = 0; let yc = 0;
  for (const f of part) {
    const w = 2 * Math.PI * rate * (f.t - t0);
    const si = Math.sin(w);
    const co = Math.cos(w);
    const y = f.c - m;
    ss += si * si; cc += co * co; sc += si * co; ys += y * si; yc += y * co;
  }
  const det = ss * cc - sc * sc;
  if (Math.abs(det) < 1e-9) return 0;
  return Math.hypot((ys * cc - yc * sc) / det, (yc * ss - ys * sc) / det);
}

// A QUIET TAIL IS NOT PITCH. A struck or plucked note (piano, guitar, harp) dies
// away, and so does a note in a hall once the bow has stopped, and the pitch
// tracker's reading from the last of it wanders by 10-20 cents at no vibrato's
// rate in particular. The first version read that wander as a vibrato that was
// plain for the first half of the note and wide for the second: 7 of 12 long
// notes of a staccato line in a 3 s hall said "opens up". Frames more than about
// 9 dB below the note's own peak are therefore left out, and the note needs 16
// frames (0.37 s) left, and a sine wave that explains half of what is left.
const QUIET_TAIL = 0.35;   // of the note's own peak level (about -9 dB)

function vibratoGrowth(notes, readings, a4) {
  const rows = [];
  let longNotes = 0;
  for (const note of notes) {
    if (note.end - note.start < LONG_NOTE_SEC) continue;
    longNotes++;
    // The first and last sixth of a note are scoop and release, not vibrato.
    const trim = (note.end - note.start) / 6;
    const all = framesIn(note, readings, a4);
    const lit = all.filter((f) => Number.isFinite(f.rms));
    const peak = Math.max(0, ...lit.map((f) => f.rms));
    // ONLY AFTER THE PEAK. A note that swells into its loudest part (messa di
    // voce, a crescendo with a vibrato that opens) is quiet at its start and its
    // plain early half is the half that shows the vibrato opening; the tail that
    // is dropped is the one after the note has been at its loudest.
    const peakAt = lit.length ? lit.reduce((best, f) => (f.rms > best.rms ? f : best)).t : note.start;
    const fr = all.filter((f) => f.t >= note.start + trim && f.t < note.end - trim && (!(peak > 0) || f.t <= peakAt || !(f.rms < QUIET_TAIL * peak)));
    if (fr.length < 16) continue;
    const whole = sineFit(fr, VIB_RATES);
    if (!(whole.r2 >= VIB_R2)) continue;
    const half = Math.floor(fr.length / 2);
    const early = { vib: false, width: widthAt(fr.slice(0, half), whole.rate) };
    const late = { vib: false, width: widthAt(fr.slice(half), whole.rate) };
    early.vib = early.width >= VIB_CENTS;
    late.vib = late.width >= VIB_CENTS;
    if (!early.vib && !late.vib) continue;
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
  const drift = g('tempo-shape');
  const dyn = g('stretch-contrast');
  const art = g('articulation');
  const even = g('articulation-evenness');
  const shape = g('phrase-shape');
  const contrast = g('phrase-contrast');
  const ends = g('phrase-final-lengthening');
  const vib = g('vibrato-growth');
  const rep = g('repeat-timing');
  const repLoud = g('repeat-loudness');

  if (art) parts.push(art.value >= LIMITS.legato ? 'connected' : art.value <= (art.detail.detachedAt ?? LIMITS.detached) ? 'detached' : 'lightly separated');
  if (even && art) parts.push(even.value <= even.detail.evenBelow ? 'evenly articulated' : 'varied in articulation');
  const driftKind = drift?.detail?.kind;
  if (driftKind === 'speeds-up' || driftKind === 'leans-faster') parts.push('getting faster through the take');
  else if (driftKind === 'slows-down' || driftKind === 'leans-slower') parts.push('getting slower through the take');
  else if (tempo) {
    parts.push({
      steady: 'steady in tempo',
      gives: 'giving a little in tempo',
      free: 'free in tempo',
      'edge-steady': 'steady to slightly giving in tempo',
      'edge-free': 'giving a little to free in tempo',
    }[tempo.detail.word]);
  }
  if (shape) {
    const top = shape.detail.dominant;
    if (top === 'arch' && shape.detail.counts.arch / shape.n >= 0.4) parts.push('with phrases that swell and fade');
    else if (top === 'level') parts.push('with phrases held at one level');
  }
  if (dyn && !shape) parts.push(dyn.value >= LIMITS.wideStretchDb ? 'with wide loudness contrast between stretches' : dyn.value < LIMITS.flatStretchDb ? 'with very little loudness contrast' : 'with moderate loudness contrast');
  if (vib && vib.value >= 50) parts.push('vibrato that opens up on long notes');

  // 'VERY EVENLY TIMED AND EVEN IN LOUDNESS' is said only when the shaping
  // measures that would show a player SHAPING were all read AND all sit at the
  // noise floor. It replaces a word, 'mechanical', that graded a take as
  // lifeless (a taste verdict this module promises never to give) and fired
  // wrongly: for a take with every phrase end stretched 1.5 times, because the
  // tempo ladder reads a stretched final note as a longer written value and
  // removes it, and for a drone, whose nothing-to-measure it read as all flat.
  // So: tempo, phrase shape AND phrase-final lengthening must each have been
  // MEASURED (an unmeasured one is not a flat one), and each must show no
  // movement: steady tempo with no drift or wave, phrases that all stay level,
  // phrase ends no longer than the notes before them within what a metronomic
  // take reads through the real pipeline (up to 1.17, so 1.25), no contrast
  // between phrases or stretches, even articulation, matching patterns alike.
  const moves = [];
  if (tempo && tempo.detail.word !== 'steady') moves.push('tempo');
  if (drift && drift.detail.kind !== 'steady' && drift.detail.kind !== 'level') moves.push('tempo');
  if (shape && shape.detail.counts.level !== shape.n) moves.push('phrase shape');
  if (ends && ends.value >= LIMITS.flatLengthening) moves.push('phrase ends');
  if (contrast && contrast.value >= LIMITS.flatStretchDb) moves.push('phrase loudness');
  if (dyn && dyn.value >= LIMITS.flatStretchDb) moves.push('loudness');
  if (even && even.value > even.detail.evenBelow) moves.push('articulation');
  if (rep && rep.detail.word !== 'alike') moves.push('matching patterns');
  if (repLoud && repLoud.value >= LIMITS.sameLoudnessDb) moves.push('matching patterns');
  if (vib && vib.value >= 25) moves.push('vibrato');
  const veryEven = !!(tempo && shape && ends) && moves.length === 0;
  const checked = [tempo && 'tempo', shape && 'phrase shape', ends && 'phrase ends', (dyn || contrast) && 'loudness', even && 'articulation', rep && 'matching patterns', vib && 'vibrato'].filter(Boolean);

  const measured = Object.values(by).filter((d) => d.measured).length;
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
  return {
    key: 'character',
    label: 'overall character',
    measured: parts.length > 0,
    veryEven,
    // The number is how many measured pieces the sentence was assembled from.
    value: parts.length > 0 ? parts.length : null,
    unit: 'pieces',
    phrase: veryEven
      ? `very evenly timed and even in loudness: ${words}; none of what could be read here moves (${checked.join(', ')})`
      : words,
    n: measured,
    confidence: confidenceOf(measured, 4, 8),
    detail: { from: parts.length },
    reason: parts.length ? undefined : 'too little could be measured to describe the character',
  };
}

// --- how far to trust what was heard ------------------------------------------

// Whether the Analyzer and segmenter HEARD this take as notes. Three ways it can
// not have, each found by a verifier and each producing confident sentences
// from a misreading before this:
//
// QUIET: a take 20 dB below the others lost 48 of its 60 notes (the Analyzer
// gates on level) and the 12 left read 'detached 0.59'. The readings still carry
// a loudness for the frames nothing was heard in, so the share of the sound that
// was heard as notes can be counted without any threshold in dB: 'the sound' is
// the readings within 20 dB of the take's own loud level (its 90th percentile),
// which does not move when the whole take is quieter.
//
// JUNK: random pitches (median step 11-13 semitones between neighbours) are not a
// tune, and a tune's median step is a tone or two. A take like that is treated
// as the FRAGMENTS case below (only legato against detached is given, low
// confidence), not withdrawn, because the same statistic reads 12-19 on every
// one of four real cello excerpts the segmenter mis-heard (octave errors and
// double-stop fragments alternating): it cannot tell random notes from a real
// take heard badly, and on the real ones the legato-against-detached gap was the
// one thing that survived dropping the fragments.
//
// RANGE: a take read an octave too low (30-43% of the notes of a real sarabande
// were below any cello's range) makes every pitch-dependent descriptor, and the
// matching of patterns, the tracker's. This check was DEAD IN PRODUCTION: it ran
// only on a `range` the caller passed, and the assistant passed none. Without
// one it now uses GENERIC_RANGE (below), which only catches pitch no instrument
// or voice makes; a caller that knows the instrument family passes rangeFor(id)
// and gets the tighter, honest check.
//
// UNBROKEN: a 60 Hz hum, run through the real Analyzer and segmenter, comes back
// as 130-230 'notes' a pitch tracker drew along its drift (midi 20-47), with no
// silence anywhere, and was described as 'one continuous stretch' (in one take of
// four as eight phrases of ten notes, from the loudness wobbling a little). The
// sound of a hum does not get quiet between notes, and music does: the share of
// readings more than 12 dB under the take's loud level is 8.5-21% on seven real
// cello excerpts and 0-0.3% on four hum takes. THAT ALONE WAS TOO WIDE: a long
// slur with no breath in it that swells and fades has 1.2% of its readings that
// quiet, and was withdrawn whole and called 'not what playing is like'. So the
// loudness must also stay within 3 dB between its 10th and 90th percentile (hum
// 1.7, the swelling slur 6.9, real cello 11-14). Where both hold there is no
// breath, rest or restart to find a phrase from, and the phrases are said to be
// unreadable, and so is the rest of the shaping. WHAT STILL TRIPS IT, and is
// listed as such: a perfectly constant-level legato line with no dip at all (a
// synthetic one; a held organ note or a drone); the sentence says only what was
// measured and not that it was not playing.
const ACTIVE_BELOW_DB = 20;

function coverageOf(list, readings) {
  const rs = (readings ?? []).filter((r) => Number.isFinite(r?.time) && r.rms > 0);
  if (rs.length < 40) return null;
  const level = quantile(rs.map((r) => r.rms), 0.9);
  const active = rs.filter((r) => r.rms >= level / 10 ** (ACTIVE_BELOW_DB / 20));
  if (active.length === 0) return null;
  let heard = 0;
  let k = 0;
  for (const r of active) {
    while (k < list.length && list[k].end <= r.time) k++;
    if (k < list.length && r.time >= list[k].start) heard++;
  }
  return heard / active.length;
}

// Share of the five-note windows whose steps occur again elsewhere in the take.
function matchingShare(list) {
  const keys = [];
  for (let i = 0; i + 5 <= list.length; i++) keys.push(list.slice(i, i + 5).map((n, k, a) => (k ? Math.round(n.midi) - Math.round(a[k - 1].midi) : 0)).join(','));
  const count = new Map();
  for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
  return keys.length ? keys.filter((k) => count.get(k) > 1).length / keys.length : 0;
}

// What a caller who does not know the instrument should expect: from the lowest
// double bass string (E1) to the top of a piccolo or a piano (G7). Wide on
// purpose, so that it catches only pitch no instrument or voice makes (a pitch
// tracker following mains hum or a rumble); the families below are the tighter
// ranges for a caller that knows which is held.
export const GENERIC_RANGE = { lowMidi: 28, highMidi: 103 };
export const RANGE_BY_FAMILY = {
  strings: { lowMidi: 28, highMidi: 100 },   // double bass E1 to violin E7
  winds: { lowMidi: 34, highMidi: 108 },     // bassoon Bb1 to piccolo C8
  brass: { lowMidi: 28, highMidi: 96 },      // tuba E1 to a high trumpet
  voice: { lowMidi: 36, highMidi: 96 },      // bass C2 to a soprano's top
  keys: { lowMidi: 21, highMidi: 108 },      // the piano
};
export function rangeFor(familyId) {
  return RANGE_BY_FAMILY[familyId] ?? GENERIC_RANGE;
}
// A solo line almost never leaves its own median by three octaves; a take whose
// notes do is being followed badly. Used only when no range was given.
const SPREAD_SEMITONES = 36;

// Share of readings more than 12 dB under the take's own loud level (the 90th
// percentile). A reading with no loudness at all is silence.
function quietShare(readings) {
  const rs = (readings ?? []).filter((r) => Number.isFinite(r?.time));
  if (rs.length < LIMITS.unbrokenReadings) return null;
  const rms = rs.map((r) => (r.rms > 0 ? r.rms : 0));
  const level = quantile(rms, 0.9);
  if (!(level > 0)) return null;
  const low = quantile(rms, 0.1);
  return {
    share: rs.filter((r) => !(r.rms >= level / 10 ** (12 / 20))).length / rs.length,
    spreadDb: low > 0 ? 20 * Math.log10(level / low) : Infinity,
  };
}

function reliabilityOf(list, readings, range) {
  const shortShare = list.filter((n) => n.end - n.start < 0.08).length / list.length;
  const coverage = coverageOf(list, readings);
  const steps = [];
  for (let i = 0; i + 1 < list.length; i++) steps.push(Math.abs(list[i + 1].midi - list[i].midi));
  const medianStep = median(steps);
  // Wide steps that REPEAT are a drill, an octave exercise or a wide arpeggio,
  // and every singer and wind player has them; wide steps that never come round
  // again are noise (or a take the tracker could not follow). So "junk" needs both.
  const patterned = matchingShare(list);
  const given = !!range && Number.isFinite(range.lowMidi) && Number.isFinite(range.highMidi);
  const bounds = given ? range : GENERIC_RANGE;
  const centre = median(list.map((n) => n.midi));
  const outside = list.filter((n) => {
    const m = Math.round(n.midi);
    return m < bounds.lowMidi || m > bounds.highMidi || (!given && Math.abs(n.midi - centre) > SPREAD_SEMITONES);
  }).length / list.length;
  const quiet = quietShare(readings);
  let reason = null;
  if (coverage !== null && coverage < LIMITS.minCoverage) reason = 'quiet';
  else if (medianStep >= LIMITS.junkStep && patterned < LIMITS.junkPatterned) reason = 'junk';
  else if (shortShare >= LIMITS.noisyShortShare) reason = 'fragments';
  else if (quiet !== null && quiet.share < LIMITS.unbrokenQuiet && quiet.spreadDb < LIMITS.unbrokenSpreadDb) reason = 'unbroken';
  const outOfRange = outside >= LIMITS.outOfRangeShare;
  return {
    shortNoteShare: shortShare,
    quietShare: quiet ? quiet.share : null,
    levelSpreadDb: quiet ? quiet.spreadDb : null,
    rangeGiven: given,
    coverage,
    medianStep,
    patternedShare: patterned,
    outOfRangeShare: outside,
    reason,
    outOfRange,
    noisy: reason !== null || outOfRange,
    unreadable: reason === 'quiet' || reason === 'unbroken',   // every descriptor withdrawn
  };
}

// The take with every descriptor withdrawn, for a take that was not heard.
function withdrawn(by, why) {
  const out = {};
  for (const [k, d] of Object.entries(by)) out[k] = missing(k, d.label, why, 0);
  out.character = { ...missing('character', 'overall character', why, 0), veryEven: false };
  return out;
}

// The whole take. -> null when there is nothing to read.
export function musicalityOf({ notes, readings, a4 = 440, range = null } = {}) {
  const list = (notes ?? []).filter((n) => Number.isFinite(n?.start) && Number.isFinite(n?.end) && Number.isFinite(n?.midi))
    .sort((a, b) => a.start - b.start);
  if (list.length === 0) return null;

  const KEYS = [
    ['phrase-count', 'phrases found'], ['phrase-definition', 'how clearly phrases are marked'],
    ['phrase-shape', 'loudness shape of phrases'], ['phrase-contrast', 'loudness contrast between phrases'],
    ['stretch-contrast', 'loudness between stretches of the take'], ['articulation', 'legato or detached'],
    ['articulation-evenness', 'how even the articulation is'], ['tempo-flexibility', 'how much the tempo moves'],
    ['tempo-shape', 'whether the tempo returns or drifts'], ['phrase-final-lengthening', 'lengthening at phrase ends'],
    ['repeat-timing', 'timing of matching five-note patterns'], ['repeat-loudness', 'loudness of matching five-note patterns'],
    ['vibrato-growth', 'vibrato opening up on long notes'], ['pitch-lean', 'pitch leaning on steps'],
  ];
  if (list.length < MIN_NOTES) {
    const why = `only ${list.length} note${list.length === 1 ? '' : 's'}; needs at least ${MIN_NOTES} to read how a take is shaped`;
    const by = Object.fromEntries(KEYS.map(([k, l]) => [k, missing(k, l, why, list.length)]));
    by.character = { ...missing('character', 'overall character', why, list.length), veryEven: false };
    return { noteCount: list.length, durationSec: list.at(-1).end - list[0].start, descriptors: by, phrases: [] };
  }

  const reliability = reliabilityOf(list, readings, range);
  const levels = levelsOf(list, readings);
  const seg = segmentPhrases(list, levels);
  const beatSec = median(list.slice(1).map((n, i) => n.start - list[i].start));
  const fl = floorsFor(beatSec);
  const all = [
    ...phraseDescriptors(list, seg),
    ...dynamicsDescriptors(list, levels, seg),
    ...articulationDescriptors(list, seg, fl),
    ...tempoDescriptors(list, seg, fl),
    ...repeatDescriptors(list, levels, seg, fl),
    ...expressionDescriptors(list, readings, seg, a4),
  ];
  let by = Object.fromEntries(all.map((d) => [d.key, d]));

  // TWELVE NOTES ARE NOT A COUNT OF PHRASES. At the fewest notes the module
  // reads at all, 'phrase-count' was the one thing it could say, and it said it
  // as a finding ('1 phrase, no breaks') of a take of one breath.
  if (list.length < 2 * MIN_NOTES) {
    const why = `only ${list.length} notes; the number, marking, shape and ending of phrases needs at least ${2 * MIN_NOTES}`;
    for (const k of ['phrase-count', 'phrase-definition', 'phrase-shape', 'phrase-contrast', 'phrase-final-lengthening']) by[k] = missing(k, by[k].label, why, list.length);
  }

  // NOTES TOO CLOSE TOGETHER TO READ THE SHAPING OF. Under about 0.3 s a note
  // the pipeline's own timing error (a few tens of milliseconds on each onset)
  // is as large as the gaps and the tempo wobble being measured: a perfect
  // metronome at 0.25 s a note read 'the tempo gives a little, by about 5%', and
  // legato-or-detached read 0.27 at 0.1 s and 0.52 at 0.5 s for the same
  // playing. The phrase rows were already left out of comparisons for this
  // (FASTEST_BEAT_SEC); these four were not.
  const fast = beatSec < FASTEST_BEAT_SEC;
  if (fast) {
    const why = 'the notes are less than about a third of a second apart, which is too fast for the timing of this app to tell a short gap or a small tempo change from its own error';
    // With the score the tempo comes from the written lengths, not from the
    // spacing alone, so its two rows stay.
    const scoredTake = list.filter((n) => n.beats > 0).length >= 0.8 * list.length;
    const rows = scoredTake ? ['articulation', 'articulation-evenness', 'phrase-shape'] : ['articulation', 'articulation-evenness', 'tempo-flexibility', 'tempo-shape', 'phrase-shape'];
    for (const k of rows) by[k] = missing(k, by[k].label, why, list.length);
  }

  // ONE PITCH has no phrases to speak of: a breath in a drone is a breath, not
  // a phrase end, and nothing about melody can be said. The timing and the
  // articulation of the repeated note are still read.
  const onePitch = new Set(list.map((n) => Math.round(n.midi))).size === 1;
  if (onePitch) {
    const why = 'every note is the same pitch, so there is no phrase-level reading of it';
    for (const k of ['phrase-count', 'phrase-definition', 'phrase-shape', 'phrase-contrast', 'phrase-final-lengthening', 'repeat-timing', 'repeat-loudness', 'pitch-lean', 'vibrato-growth']) {
      by[k] = missing(k, by[k].label, why, 0);
    }
  }

  by.character = onePitch
    ? { ...missing('character', 'overall character', 'every note is the same pitch, so there is no phrase-level reading of it', 0), veryEven: false }
    : characterOf(by);

  if (reliability.unreadable) {
    by = withdrawn(by, reliability.reason === 'unbroken'
      ? 'the loudness stayed within a few dB and never dropped between notes, so there are no breaths or restarts to read how the take is shaped from (a hum or a held tone does this)'
      : 'most of the take was too quiet or unclear to hear as notes');
  } else if (reliability.reason === 'fragments' || reliability.reason === 'junk') {
    // WHAT SURVIVES FRAGMENT-DROPPING ON REAL DATA is whether the notes run
    // together or are separated (legato against detached, from the notes of 80 ms
    // or longer only); phrase-end lengthening, articulation spread, the loudness
    // contrasts and the phrase counts did not (docs/musicality.md). Those are
    // withdrawn, not printed at low confidence.
    const why = reliability.reason === 'junk'
      ? 'the notes heard jump about too widely to be a tune, so this could not be read well'
      : 'too many of the notes heard were fragments for this to be read well';
    const solid = list.filter((n) => n.end - n.start >= 0.08);
    const keep = {};
    if (solid.length >= MIN_NOTES) {
      const lv = levelsOf(solid, readings);
      const sg = segmentPhrases(solid, lv);
      const art = articulationDescriptors(solid, sg, floorsFor(median(solid.slice(1).map((n, i) => n.start - solid[i].start))))[0];
      if (art.measured && !fast) keep.articulation = { ...art, confidence: 'low' };
    }
    by = withdrawn(by, why);
    Object.assign(by, keep);
    by.character = { ...characterOf(by), veryEven: false };
  }
  if (reliability.noisy) for (const x of Object.values(by)) if (x.measured) x.confidence = 'low';

  return {
    noteCount: list.length,
    durationSec: list.at(-1).end - list[0].start,
    beatSec,
    floors: fl,
    onePitch,
    reliability,
    descriptors: by,
    phrases: seg.phrases.map((p) => ({ from: p.from, to: p.to, start: list[p.from].start, end: list[p.to].end })),
    levels,
  };
}

// --- comparison ---------------------------------------------------------------

// Every row is a difference in shaping and NONE is marked better or worse: a
// teacher or the player decides whether more contrast, or two matching
// five-note patterns played more alike, is what the piece wants. A row that
// moved carries `direction` ('higher' | 'lower', of the number) and nothing
// that ranks it. (The first version marked repeated figures played more alike
// as `better`, and its facts said that is what repeating a figure asks for;
// 'repeated figure' was any five notes with the same steps, so a sequence the
// composer wrote differently twice was graded for being played as written.)
// HOW MANY PHRASES IS A FACT ABOUT HOW LONG THE TAKE IS. A player who phrases in
// tens of notes finds 3 phrases in a 30-note take and 8 in an 80-note one, and
// the comparison called every such pair "more, shorter phrases" (72 of 80 pairs
// of one simulated player at 3, 4, 6, 8 and 12 phrases, every phrase ten notes).
// The count is therefore compared only between takes of about the same number of
// notes (within a fifth), and what is compared otherwise is the typical phrase
// length in notes, which does not grow with the take. A row that cannot be
// compared fairly is left out altogether: it is not "unmeasured" (it was
// measured) and not "about the same" (nothing was shown to be the same).
const LENGTH_WITHIN = 1.25;
const lengthsComparable = (a, b) => {
  const hi = Math.max(a.noteCount, b.noteCount);
  const lo = Math.min(a.noteCount, b.noteCount);
  return lo > 0 && hi / lo <= LENGTH_WITHIN && breathsVisible(a, b);
};
// BREATHS TOO SHORT TO SEE. At a note spacing under about 0.3 s the pipeline's
// own timing error (a few tens of milliseconds on each onset) is as large as a
// breath of 0.6 of a note, so the same performance finds 1-8 phrases by seed at
// 0.2 s a note and all 8 from 0.3 s on (16 seeds each; 70 of 448 tempo-only
// pairs said "more, shorter phrases" with a 0.2 s take in them). Two takes are
// compared on their phrases only when neither is faster than that.
const FASTEST_BEAT_SEC = 0.28;
const breathsVisible = (a, b) => !(a.beatSec < FASTEST_BEAT_SEC || b.beatSec < FASTEST_BEAT_SEC);
// With one phrase found, "the phrase length" is the length of the take.
const phraseLengthOf = (m) => {
  const d = m.descriptors['phrase-count'];
  return d?.measured && d.value >= 2 ? d.detail.medianNotes : null;
};

// +1 speeding up, -1 slowing, 0 neither; null for a tempo that moves with no
// drift to speak of (a wave that stopped somewhere else), which is no reading.
const driftClassOf = (m) => {
  const d = m.descriptors['tempo-shape'];
  if (!d?.measured) return null;
  const k = d.detail.kind;
  if (k === 'speeds-up' || k === 'leans-faster') return 1;
  if (k === 'slows-down' || k === 'leans-slower') return -1;
  return k === 'moves' ? null : 0;
};

const COMPARE = [
  { key: 'phrase-count', small: 1.5, abs: true, up: 'more, shorter phrases', down: 'fewer, longer phrases', onlyIf: lengthsComparable },
  // The typical phrase length in notes. Its own unit and its own floor: two
  // notes or a quarter, whichever is more, because one cut more or less in a
  // phrase of ten moves the median by one or two.
  { key: 'phrase-length', src: 'phrase-count', label: 'typical phrase length', unit: 'notes', valueFrom: phraseLengthOf, onlyIf: breathsVisible, small: 2, rel: 0.25, up: 'longer phrases', down: 'shorter phrases' },
  // 30, not 20: phrase-definition moves in steps of a third of a point per phrase
  // end, and 14 ms of onset error on one performance at two tempos moved it by
  // 20 (three ends of five losing a cue) and, twice in sixty pairs, by 27.
  // It is the mean of one score per phrase end, each 67 or 100 in practice
  // (a breath alone, or a breath and a second cue), so with two or three phrase
  // ends one end more or less cued moves it by 33 or 17. The same player,
  // transposed or at a lower level, differed by 30 or more in 21 of 144 pairs
  // through the real pipeline, and every one of them had fewer than five ends.
  // The bar now grows with how few ends there are (seFrom, 2 standard errors).
  { key: 'phrase-definition', small: 30, seFrom: (d) => 17 / Math.sqrt(Math.max(1, d.n)), up: 'more clearly marked phrase ends', down: 'less clearly marked phrase ends' },
  { key: 'phrase-shape', small: 20, up: 'more phrases that swell and fade', down: 'fewer phrases that swell and fade' },
  { key: 'phrase-contrast', small: 0.8, up: 'more phrasing contrast', down: 'less phrasing contrast' },
  { key: 'stretch-contrast', small: 1, up: 'more loudness contrast across the take', down: 'less loudness contrast across the take' },
  { key: 'articulation', small: 0.1, up: 'more connected', down: 'more detached' },
  { key: 'articulation-evenness', small: 0.06, up: 'less even articulation', down: 'more even articulation' },
  { key: 'tempo-flexibility', small: 2.5, up: 'a freer tempo', down: 'a steadier tempo' },
  // Whether the tempo drifts through the take was not compared at all: an
  // accelerando against a steady take came out "shaped about the same on how much
  // the tempo moves". It is compared as a class (speeding up, level, slowing),
  // never as the number, which for a wave is only where it happened to stop.
  { key: 'tempo-drift', src: 'tempo-shape', label: 'whether the tempo drifts', unit: '', valueFrom: driftClassOf, small: 0.5, up: 'the tempo drifts faster over the take', down: 'the tempo drifts slower over the take' },
  // (phrase ends are found from breaths, so this row is as blind as the count under FASTEST_BEAT_SEC)
  { key: 'phrase-final-lengthening', small: 0.25, up: 'more lengthening at phrase ends', down: 'less lengthening at phrase ends', onlyIf: breathsVisible },
  { key: 'repeat-timing', small: 1.5, up: 'matching five-note patterns played less alike in timing', down: 'matching five-note patterns played more alike in timing' },
  { key: 'repeat-loudness', small: 0.8, up: 'matching five-note patterns played less alike in loudness', down: 'matching five-note patterns played more alike in loudness' },
  { key: 'vibrato-growth', small: 25, up: 'vibrato opens up more on long notes', down: 'vibrato opens up less on long notes' },
  { key: 'pitch-lean', small: 3, up: 'pitch leans more with the direction of travel', down: 'pitch leans less with the direction of travel' },
];

// The smallest difference a comparison may call a difference, per key, from the
// noise floors of BOTH takes. The single-take sentences already apply floorsFor
// (a fast take needs a bigger tempo movement to count as free); the comparison
// used fixed numbers and so said 'repeated figures less alike in timing' of one
// identical flat performance at 0.4 s and at 0.7 s a note (1.6% against 3.6%,
// 1.5 apart, a floor of 5.5% at the faster tempo). The larger of the two floors
// is used, because the instrument cannot see less than that in either take.
const FLOOR_OF = {
  'repeat-timing': (fl) => fl.sameBelow,
  'tempo-flexibility': (fl) => fl.steadyBelow,
  'articulation-evenness': (fl) => fl.evenBelow,
  'articulation': (fl) => fl.detachedAt - LIMITS.detached,   // the bias that short notes read longer
};

export function compareMusicality(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const c of COMPARE) {
    if (c.onlyIf && !c.onlyIf(before, after)) continue;
    const a = before.descriptors[c.src ?? c.key];
    const b = after.descriptors[c.src ?? c.key];
    const label = c.label ?? (b ?? a)?.label ?? c.key;
    const unit = c.unit ?? (b ?? a)?.unit ?? '';
    const va = c.valueFrom ? c.valueFrom(before) : (a?.measured ? a.value : null);
    const vb = c.valueFrom ? c.valueFrom(after) : (b?.measured ? b.value : null);
    if (va === null || vb === null) {
      // A phrase length of a take with a single phrase is no reading at all
      // (see phraseLengthOf), not an unmeasured one: nothing is said.
      if (c.valueFrom && a?.measured && b?.measured) continue;
      out.push({ key: c.key, label, unit, before: va, after: vb, change: null, verdict: 'unmeasured' });
      continue;
    }
    const delta = vb - va;
    const floorOf = FLOOR_OF[c.key];
    const floor = floorOf ? Math.max(0, ...[before, after].map((m) => (m.floors ? floorOf(m.floors) : 0))) : 0;
    // A reading that carries its own standard error (the tempo's spread: 29%
    // of itself at 28 notes, 5% at 672) cannot call a difference smaller than
    // one and a half times the two errors together: the same playing at two
    // lengths is not a change.
    const se = Math.hypot(a?.detail?.se ?? 0, b?.detail?.se ?? 0);
    const seRow = c.seFrom ? Math.hypot(c.seFrom(a), c.seFrom(b)) : 0;
    const small = Math.max(c.small, floor, 1.5 * se, 2 * seRow, c.rel ? c.rel * ((Math.abs(va) + Math.abs(vb)) / 2) : 0);
    const moved = Math.abs(delta) >= small;
    const verdict = !moved ? 'about the same' : delta > 0 ? c.up : c.down;
    const row = { key: c.key, label, unit, before: va, after: vb, change: delta, verdict };
    if (moved) row.direction = delta > 0 ? 'higher' : 'lower';
    out.push(row);
  }
  return out;
}

export function describeMusicality() {
  return COMPARE.map((c) => ({ key: c.key }));
}
