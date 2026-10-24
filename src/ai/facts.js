// The measured facts a reply may state, as plain sentences.
//
// A fact is a string with its numbers already in it. That is the whole trick:
// the guard in guard.js reads the numbers back OUT of these sentences, so a
// number can only reach the player if a function here wrote it. Nothing in this
// file calls a model, and every sentence is complete enough to be shown to the
// player as it stands — which is exactly what happens when no model is
// available.
//
// takes: [{ id, name, date, duration, noteStats, landingStats, scoreStats,
//           quality?, rhythm? }]  — quality and rhythm only when loaded.

import { aggregateTendencies, dailyScores, weeklyReport } from '../analysis/coach.js';
import { compareQuality } from '../analysis/quality.js';
import { compareTakes } from '../analysis/score-history.js';
import { intentsOf, mentionsTake } from './router.js';
import { takeLabel as label, whenOf as when, pairLabels } from './labels.js';
import { musicalityFacts, compareMusicalityFacts, CAVEAT as MUSICALITY_CAVEAT } from './musicality-facts.js';

const round0 = (v) => Math.round(v);
const round1 = (v) => (Math.round(v * 10) / 10).toString();

function mean(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ---- slots: what each number in a sentence IS -------------------------------
//
// A fact is a string, and the guard reads the numbers back out of it as a bag:
// it knows "9" is in the facts with the unit cents, and not whether that 9 is
// the whole take's average error, one note's, or a count. That is how "Your
// last take was 9¢ sharp on average over 6 times" (a note's figure given as the
// take's), "Nine of the 24 notes were within 10 cents" (an error read as a
// count) and "bar 3 was 11¢ off, bar 2 was 32¢" (two bars swapped) got through
// a guard that is otherwise strict about every digit. A slot says it outright.
// The builders below push one beside each figure they write, so the table and
// the sentence are made in the same place from the same variable and cannot
// drift, and the text itself carries no new digits.
//
//   v      the figure as the sentence shows it (rounded the way it is shown)
//   unit   the guard's own unit names: cents, pct, notes, times, ms, bpm ...
//   kind   what it is: take-average-cents, note-cents, count-of-notes ...
//   scope  'take' (the whole take), 'note' (one pitch), 'bar' (one bar) or
//          'any' (a tone or pulse reading that has no other figure to be
//          mistaken for a take's average)
//   row    for a figure that belongs to one row of a list ("bar 3", "D3"); a
//          question whose slots name more than one row is not given to the
//          model (see rowsOf, assistant.js)
//   dir    'sharp' | 'flat' when the sentence gives the figure a direction
const slot = (sink, v, unit, kind, scope, extra = {}) => { if (sink) sink.push({ v: Number(v), unit, kind, scope, ...extra }); };

// How many distinct rows of a list (bars, pitches) a set of slots names.
export function rowsOf(slots = []) {
  return new Set(slots.filter((s) => s.row).map((s) => s.row)).size;
}

const noteWord = (n) => `${n} note${n === 1 ? '' : 's'}`;
const absMean = (cents) => mean(cents.map(Math.abs));

function summaryFacts(take, sink) {
  const stats = take.noteStats ?? [];
  const cents = stats.map((n) => Math.abs(n.cents)).filter(Number.isFinite);
  if (cents.length === 0) return [`No notes were measured in "${label(take)}".`];
  const within = cents.filter((c) => c <= 10).length;
  slot(sink, 0, 'name', 'take-label', 'take', { name: label(take) });
  slot(sink, cents.length, 'notes', 'count-of-notes', 'take');
  slot(sink, round1(mean(cents)), 'cents', 'take-average-cents', 'take');
  slot(sink, round0((within / cents.length) * 100), 'pct', 'percent-within-10-cents', 'take');
  slot(sink, 10, 'cents', 'threshold', 'any');
  const out = [
    `"${label(take)}"${when(take) ? ` (${when(take)})` : ''}: ${noteWord(cents.length)} heard, ${round1(mean(cents))}¢ off pitch on average, `
    + `${round0((within / cents.length) * 100)}% of notes within 10¢.`,
  ];
  const byName = new Map();
  for (const n of stats) {
    if (!Number.isFinite(n.cents) || !n.name) continue;
    if (!byName.has(n.name)) byName.set(n.name, []);
    byName.get(n.name).push(n.cents);
  }
  const rows = [...byName].filter(([, c]) => c.length >= 2).map(([name, c]) => pitchRow(name, c));
  if (rows.length) {
    const worst = rows.sort((a, b) => b.off - a.off)[0];
    if (worst.off >= 6) {
      slot(sink, round0(worst.off), 'cents', 'note-cents', 'note', { row: worst.name, ...(worst.dir ? { dir: worst.dir } : {}) });
      slot(sink, worst.n, 'times', 'note-times', 'note', { row: worst.name });
      out.push(`The note furthest from pitch was ${worst.name}, ${worst.dir ? `${round0(worst.off)}¢ ${worst.dir}` : `${round0(worst.off)}¢ off, ${BOTH_WAYS},`} on average over ${worst.n} times.`);
    }
  }
  return out;
}

// How far a pitch is from pitch is how far its notes ARE, not where their
// average falls: a note 30¢ off every time, half sharp and half flat, averages
// to 0 and was ranked as the best note and printed "0¢ flat" under a heading
// that said furthest from pitch. So a pitch is ranked by the mean of its
// absolute errors, and it is called sharp or flat only when its notes agree
// (the signed mean is most of the absolute one); otherwise it is said to go
// both ways.
const BOTH_WAYS = 'sometimes above and sometimes below the pitch';
function pitchRow(name, cents) {
  const signed = mean(cents);
  const off = absMean(cents);
  const agree = off > 0 && Math.abs(signed) >= 0.6 * off;
  return { name, off, n: cents.length, dir: agree ? (signed > 0 ? 'sharp' : 'flat') : null };
}

function perPitch(take) {
  const m = new Map();
  for (const n of take.noteStats ?? []) {
    if (!Number.isFinite(n.cents) || !n.name) continue;
    if (!m.has(n.name)) m.set(n.name, []);
    m.get(n.name).push(n.cents);
  }
  return m;
}

function compareFacts(a, b, { explicit = false } = {}) {
  // a is the newer take. Two takes of one piece share a name, so the date has
  // to tell them apart or the sentence reads "Bach 9¢, Bach 22¢"; two taken on
  // one day need the time as well (labels.js).
  const [la, lb] = pairLabels(a, b);
  const out = [];
  // A comparison the player did not name ("how does my last take compare with
  // the one before") can land on two different pieces, and an Etude set beside a
  // Bach prelude says little about either. It is still answered, and says so.
  if (!explicit && label(a) !== label(b)) {
    out.push('These two takes have different names, so a difference between them may come from the music and not only from the playing.');
  }
  const cA = (a.noteStats ?? []).map((n) => Math.abs(n.cents));
  const cB = (b.noteStats ?? []).map((n) => Math.abs(n.cents));
  const mA = mean(cA);
  const mB = mean(cB);
  if (mA !== null && mB !== null) {
    const d = mA - mB;
    out.push(
      `Average pitch error: "${la}" ${round1(mA)}¢, "${lb}" ${round1(mB)}¢`
      + (Math.abs(d) < 1 ? ' — about the same.' : `, so "${la}" is ${round1(Math.abs(d))}¢ ${d < 0 ? 'closer to pitch' : 'further from pitch'}.`),
    );
  }

  // Same piece with a score behind it: note for note, which is the strong comparison.
  if (a.scoreStats && b.scoreStats) {
    const cmp = compareTakes(a.scoreStats, b.scoreStats);
    if (cmp && cmp.perNote.length >= 5) {
      out.push(`Note for note against the score (${cmp.perNote.length} notes in both): ${cmp.better} note${cmp.better === 1 ? '' : 's'} landed closer, ${cmp.worse} note${cmp.worse === 1 ? '' : 's'} landed further, the rest about the same.`);
    }
    if (Number.isFinite(cmp?.msDelta)) {
      // a delta that rounds to 0 ms is not a direction
      if (round0(Math.abs(cmp.msDelta)) === 0) out.push('Timing against the beat is about the same in both takes.');
      else out.push(`Timing against the beat is ${round0(Math.abs(cmp.msDelta))} ms ${cmp.msDelta < 0 ? 'tighter' : 'looser'} on average.`);
    }
  } else {
    const pa = perPitch(a);
    const pb = perPitch(b);
    const moved = [];
    for (const [name, ca] of pa) {
      const cb = pb.get(name);
      if (!cb || ca.length < 2 || cb.length < 2) continue;
      const da = absMean(ca);
      const db = absMean(cb);
      moved.push({ name, delta: da - db, da, db });
    }
    moved.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    const top = moved.filter((m) => Math.abs(m.delta) >= 4).slice(0, 2);
    for (const m of top) {
      out.push(`${m.name} moved from ${round1(m.db)}¢ to ${round1(m.da)}¢ off on average (${m.delta < 0 ? 'closer' : 'further'}).`);
    }
  }

  if (a.quality && b.quality) {
    const rows = compareQuality(b.quality, a.quality).filter((r) => r.verdict !== 'unmeasured' && r.verdict !== 'about the same');
    for (const r of rows.slice(0, 4)) {
      // Clarity is 0 to 1 in the measurement and "88 out of 100" in the
      // single-take sentence; shown to a tenth on the small scale, .80 and .84
      // both read 0.8 ("0.8 before, 0.8 now — a clearer, purer tone"). It is
      // written on the scale the other sentence uses. Units sit against the
      // figure for the symbols (4.3¢, 40%) and apart for the words (12 dB).
      const scale = r.key === 'clarity' ? 100 : 1;
      const fig = (v) => (r.key === 'clarity' ? `${round1(v * scale)} out of 100` : `${round1(v)}${!r.unit ? '' : /^[¢%]$/.test(r.unit) ? r.unit : ` ${r.unit}`}`);
      out.push(`${r.label}: ${fig(r.before)} before, ${fig(r.after)} now — ${r.verdict}.`);
    }
    if (rows.length === 0) out.push('Tone, vibrato and loudness measured about the same in both takes.');
  } else {
    out.push('Tone and vibrato could not be measured for both takes, so I cannot compare them.');
  }
  return out;
}

// How the two takes are SHAPED, folded into a general comparison. Only the few
// largest differences, because a plain "how does this compare" should not turn
// into a lecture on phrasing, and nothing at all when either take's shaping was
// not read (a comparison that says "could not be measured" twice is noise; the
// player who asked about phrasing is told, by the musicality intent itself).
//
// Only the DIFFERENCES are folded in. Two lines of the shaping comparison say
// that nothing was found ("are shaped about the same on everything that could
// be measured in both", "could not be compared because it was not measured in
// both"), and in a general comparison they landed straight after the pitch and
// tone differences, so one answer said the takes were 13¢ closer, steadier and
// wider and then that they were "about the same on everything". A plain
// comparison has no use for a negative about a part it was not asked about.
const SHAPING_NOTHING = /are shaped about the same on |so I cannot say whether they are shaped alike\.$|^Could not be compared because it was not measured in both takes/;
function shapingFolded(a, b) {
  if (!a.musicality || !b.musicality) return [];
  const rows = compareMusicalityFacts(a, b, { max: 3 });
  // drop the standing caveat; it is added once by the musicality intent when
  // the question was about shaping, and a pitch comparison does not need it
  return rows.filter((r) => r !== MUSICALITY_CAVEAT && !SHAPING_NOTHING.test(r));
}

// When the question IS about shaping and the takes are shaped alike, that is
// the answer. The sentence names the shaping rows it is about (it used to say
// "on everything that could be measured", which was false whenever nothing had
// been measured in both and was a claim about the pitch and the tone too, which
// the same answer had just listed as differing); here it only gets a pointer to
// the differences above when there are some.
const DIFFERENCE_WORDS = /\b(closer|further|steadier|shakier|wider|narrower|faster|slower|tighter|looser|clearer|brighter|darker|more notes|fewer notes)\b/;
function scopedSame(rows, earlier) {
  const differences = earlier.some((f) => DIFFERENCE_WORDS.test(f));
  // The line now names the shaping rows it is about, so it is no longer an
  // "everything" claim; all that is left to add is the pointer to differences
  // that were found elsewhere in the same answer.
  return rows.map((r) => (differences ? r.replace(/(are shaped about the same on .*)\.$/, '$1; the differences above are not about shaping.') : r));
}

function worstFacts(take, sink) {
  const per = take.scoreStats?.perNote ?? [];
  const bars = new Map();
  for (const n of per) {
    if (!Number.isFinite(n.cents) || !Number.isFinite(n.measure)) continue;
    if (!bars.has(n.measure)) bars.set(n.measure, []);
    bars.get(n.measure).push(Math.abs(n.cents));
  }
  const rows = [...bars].filter(([, c]) => c.length >= 2).map(([bar, c]) => ({ bar, m: mean(c), n: c.length }));
  if (rows.length >= 3) {
    const top = rows.sort((x, y) => y.m - x.m).slice(0, 3);
    slot(sink, 0, 'name', 'take-label', 'take', { name: label(take) });
    for (const r of top) {
      slot(sink, r.bar, 'bar', 'bar-number', 'bar', { row: `bar ${r.bar}` });
      slot(sink, round1(r.m), 'cents', 'bar-cents', 'bar', { row: `bar ${r.bar}` });
      slot(sink, r.n, 'notes', 'bar-notes', 'bar', { row: `bar ${r.bar}` });
    }
    return [`In "${label(take)}", the bars furthest from pitch were: ${top.map((r) => `bar ${r.bar} (${round1(r.m)}¢ off over ${r.n} notes)`).join(', ')}.`];
  }
  const pitches = [...perPitch(take)]
    .filter(([, c]) => c.length >= 2)
    .map(([name, c]) => pitchRow(name, c))
    .sort((x, y) => y.off - x.off)
    .slice(0, 3);
  if (pitches.length === 0) return [`There are too few repeated notes in "${label(take)}" to say which are weakest.`];
  slot(sink, 0, 'name', 'take-label', 'take', { name: label(take) });
  for (const p of pitches) {
    slot(sink, round0(p.off), 'cents', 'note-cents', 'note', { row: p.name, ...(p.dir ? { dir: p.dir } : {}) });
    slot(sink, p.n, 'times', 'note-times', 'note', { row: p.name });
  }
  return [
    `This take has no score attached, so I can name notes but not bars. The notes furthest from pitch in "${label(take)}": `
    + `${pitches.map((p) => `${p.name} (${round0(p.off)}¢ ${p.dir ?? 'off, ' + BOTH_WAYS}, ${p.n} times)`).join(', ')}.`,
  ];
}

function habitFacts(takes, sink) {
  const sessions = takes.map((t) => ({ date: t.date, noteStats: t.noteStats ?? [] }));
  const rows = aggregateTendencies(sessions, { minCount: 3 }).filter((r) => r.verdict !== 'centered');
  if (rows.length === 0) return [`No note leans sharp or flat by more than 6¢ across ${takes.length} take${takes.length === 1 ? '' : 's'}.`];
  const top = rows.sort((a, b) => Math.abs(b.meanCents) - Math.abs(a.meanCents)).slice(0, 3);
  for (const r of top) {
    slot(sink, round0(Math.abs(r.meanCents)), 'cents', 'note-cents', 'note', { row: r.name, dir: r.verdict });
    slot(sink, round0(r.spreadCents), 'cents', 'note-spread-cents', 'note', { row: r.name });
    slot(sink, r.count, 'times', 'note-times', 'note', { row: r.name });
  }
  slot(sink, takes.length, 'take', 'count-of-takes', 'any');
  return [
    `Across ${takes.length} take${takes.length === 1 ? '' : 's'}: ${top.map((r) => `${r.name} runs ${round0(Math.abs(r.meanCents))}¢ ${r.verdict} (spread ±${round0(r.spreadCents)}¢, ${r.count} times)`).join('; ')}.`,
  ];
}

function toneFacts(take, sink) {
  const q = take.quality;
  if (!q) return [`Tone and vibrato could not be measured for "${label(take)}".`];
  const out = [];
  if (Number.isFinite(q.steadinessCents)) {
    slot(sink, round1(q.steadinessCents), 'cents', 'steadiness-cents', 'any');
    out.push(`Pitch steadiness inside held notes (without vibrato): ${round1(q.steadinessCents)}¢ of wander in the middle note.`);
  }
  if (q.vibrato) {
    const v = q.vibrato;
    slot(sink, round0(v.share * 100), 'pct', 'vibrato-share-pct', 'any');
    if (Number.isFinite(v.rateHz) && Number.isFinite(v.widthCents)) {
      slot(sink, round1(v.rateHz), 'hz', 'vibrato-rate-hz', 'any');
      slot(sink, round0(v.widthCents), 'cents', 'vibrato-width-cents', 'any');
    }
    out.push(
      `Vibrato is on ${round0(v.share * 100)}% of notes held 0.4 s or longer`
      + (Number.isFinite(v.rateHz) && Number.isFinite(v.widthCents)
        ? `, at about ${round1(v.rateHz)} Hz and ${round0(v.widthCents)}¢ wide.` : '.'),
    );
  }
  if (q.dynamics) {
    slot(sink, round0(q.dynamics.rangeDb), 'db', 'loudness-range-db', 'any');
    slot(sink, round1(q.dynamics.stepDb), 'db', 'loudness-step-db', 'any');
    out.push(`Loudness range is ${round0(q.dynamics.rangeDb)} dB between the quietest and loudest tenth of notes; neighbouring notes differ by ${round1(q.dynamics.stepDb)} dB.`);
  }
  slot(sink, 0.4, 'sec', 'threshold', 'any');
  slot(sink, 60, 'ms', 'threshold', 'any');
  slot(sink, 100, 'scale', 'threshold', 'any');
  if (Number.isFinite(q.clarity)) slot(sink, round1(q.clarity * 100), 'scale', 'clarity-out-of-100', 'any');
  if (Number.isFinite(q.brightness)) slot(sink, round1(q.brightness), 'harmonic', 'brightness-harmonic', 'any');
  if (Number.isFinite(q.clarity)) out.push(`Tone clarity reads ${round1(q.clarity * 100)} out of 100 (lower can mean breathy or rough).`);
  if (Number.isFinite(q.brightness)) out.push(`Brightness: the sound's centre sits around the ${round1(q.brightness)}th harmonic.`);
  if (q.landing) {
    slot(sink, round0(q.landing.cleanShare * 100), 'pct', 'arrive-in-tune-pct', 'any');
    slot(sink, round0(q.landing.medianSettleMs ?? 0), 'ms', 'settle-ms', 'any');
    out.push(`${round0(q.landing.cleanShare * 100)}% of notes arrive in tune within 60 ms; the median note takes ${round0(q.landing.medianSettleMs ?? 0)} ms to settle.`);
  }
  return out.length ? out : [`Not enough long notes in "${label(take)}" to read its tone.`];
}

function tempoFacts(take, sink) {
  const r = take.rhythm;
  if (!r) return [`No steady pulse could be found in "${label(take)}", so I cannot say whether it rushes or drags.`];
  slot(sink, round0(r.bpm), 'bpm', 'pulse-bpm', 'any');
  slot(sink, round0(r.evenness * 100), 'pct', 'evenness-pct', 'any');
  slot(sink, round0(r.meanAbsMs), 'ms', 'beat-offset-ms', 'any');
  const out = [
    `Pulse of "${label(take)}": about ${round0(r.bpm)} beats per minute, ${round0(r.evenness * 100)}% even, notes ${round0(r.meanAbsMs)} ms from the beat on average.`,
  ];
  if (r.verdict === 'rushing') out.push('Over the take the tempo speeds up (rushing).');
  else if (r.verdict === 'dragging') out.push('Over the take the tempo slows down (dragging).');
  return out;
}

function trendFacts(takes, now) {
  const sessions = takes.map((t) => ({ date: t.date, noteStats: t.noteStats ?? [] }));
  const days = dailyScores(sessions);
  if (days.length === 0) return ['There are no measured takes to show a trend from.'];
  const w = weeklyReport(sessions, now);
  const out = [`Practised on ${w.daysPracticed} of the last 7 days; current streak ${w.streak} day${w.streak === 1 ? '' : 's'}.`];
  if (w.avgError !== null && w.prevAvgError !== null) {
    const d = w.avgError - w.prevAvgError;
    out.push(`Average pitch error this week ${round1(w.avgError)}¢, the week before ${round1(w.prevAvgError)}¢${Math.abs(d) < 1 ? ' — about the same.' : ` — ${round1(Math.abs(d))}¢ ${d < 0 ? 'closer to pitch' : 'further from pitch'}.`}`);
  } else if (days.length >= 2) {
    out.push(`First measured day ${round1(days[0].absMean)}¢ off, latest ${round1(days.at(-1).absMean)}¢ off.`);
  }
  return out;
}

// How many takes' measurements a set of sentences holds. The guard checks a
// reply against the sentences as a bag of words and numbers; it has no way to
// tell which take a claim is about, so "the Oct 14 take is 13¢ closer" passes
// when it is the Oct 19 take (both dates and the 13 are in the facts). A reply
// built from one take has nothing to confuse it with, so the number that decides
// whether the model may word an answer is this one. It counts what the sentences
// were BUILT from, not what the player named: a trend and a habit read the whole
// library even when one take is chosen, and a summary or tone question about
// "my last 2 takes" reads two.
const hasNotes = (t) => (t.noteStats?.length ?? 0) > 0;
function takesBehind(intents, chosen, all) {
  let most = 0;
  for (const intent of intents) {
    let n = 0;
    if (intent === 'summary' || intent === 'tone' || intent === 'musicality') n = chosen.length;
    else if (intent === 'compare') n = Math.min(chosen.length, 2);
    else if (intent === 'worst' || intent === 'tempo') n = 1;
    else if (intent === 'habits') n = (chosen.length > 1 ? chosen : all ?? []).filter(hasNotes).length;
    else if (intent === 'trend') n = (all ?? []).filter(hasNotes).length;
    most = Math.max(most, n);
  }
  return most;
}

// Everything the plan asked for. `all` is every take in the library (for
// habits and trend); `chosen` are the ones the question is about.
export function factsFor({ question, intents = intentsOf(question), chosen, all, now = 0 }) {
  const facts = [];
  const used = [];
  const slots = [];
  if (chosen.length === 0) return { facts: ['There are no saved takes with measured notes yet, so there is nothing to answer from.'], used, takesInFacts: 0, slots, rows: 0 };

  // `used` is the "based on" list under the answer: the takes whose
  // measurements are in the sentences, and no others. It used to name every take
  // the question chose while the builders read the first two ("my last 3 takes"
  // listed three and answered for two). Each builder below says which it read.
  const readSet = new Set();
  const note = (ts) => { for (const t of ts) readSet.add(t); };

  for (const intent of intents) {
    if (intent === 'summary') { note(chosen); for (const t of chosen) facts.push(...summaryFacts(t, slots)); }
    else if (intent === 'compare') {
      if (chosen.length >= 2) {
        note(chosen.slice(0, 2));
        facts.push(...compareFacts(chosen[0], chosen[1], { explicit: mentionsTake(question, chosen[0]) && mentionsTake(question, chosen[1]) }));
        if (chosen.length > 2) facts.push('Only two takes can be compared at a time, so this compares the latest two of the takes asked about.');
        if (!intents.includes('musicality')) facts.push(...shapingFolded(chosen[0], chosen[1]));
      } else {
        note(chosen);
        // Said of the question, not of the library: a comparison that names a
        // take with no sibling ("compare my scales with last time") used to
        // announce that only one take was saved, with dozens in the library.
        const lonely = (all ?? []).filter(hasNotes).length <= 1;
        facts.push(lonely
          ? 'Only one take is saved, so there is nothing to compare it with.'
          : `Only one saved take matches the question ("${label(chosen[0])}"), so there is nothing to compare it with.`, ...summaryFacts(chosen[0], slots));
      }
    } else if (intent === 'worst') { note(chosen.slice(0, 1)); facts.push(...worstFacts(chosen[0], slots)); }
    else if (intent === 'habits') { note(chosen); facts.push(...habitFacts(chosen.length > 1 ? chosen : all, slots)); }
    else if (intent === 'tone') {
      if (!intents.includes('compare') || chosen.length < 2) { note(chosen); for (const t of chosen) facts.push(...toneFacts(t, slots)); }
    } else if (intent === 'tempo') { note(chosen.slice(0, 1)); facts.push(...tempoFacts(chosen[0], slots)); }
    else if (intent === 'musicality') {
      if (intents.includes('compare') && chosen.length >= 2) { note(chosen.slice(0, 2)); facts.push(...scopedSame(compareMusicalityFacts(chosen[0], chosen[1], { question }), facts)); }
      else { note(chosen); for (const t of chosen) facts.push(...musicalityFacts(t, { question })); }
    } else if (intent === 'trend') { note(chosen); facts.push(...trendFacts(all, now)); }
  }
  // in the order the player named them (newest first), one entry per take read
  for (const t of chosen) if (readSet.has(t)) used.push(label(t));
  if (used.length === 0) used.push(label(chosen[0]));
  // The same sentence twice is never an answer. (Two intents that both reach the
  // same builder can produce it; today none does, and this is the net.)
  return { facts: [...new Set(facts)], used, takesInFacts: takesBehind(intents, chosen, all), slots, rows: rowsOf(slots) };
}
