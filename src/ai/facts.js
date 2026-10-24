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
import { intentsOf } from './router.js';
import { musicalityFacts, compareMusicalityFacts, CAVEAT as MUSICALITY_CAVEAT } from './musicality-facts.js';

const round0 = (v) => Math.round(v);
const round1 = (v) => (Math.round(v * 10) / 10).toString();

function mean(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function label(take) {
  return take.name?.trim() || new Date(take.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function when(take) {
  return new Date(take.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function summaryFacts(take) {
  const stats = take.noteStats ?? [];
  const cents = stats.map((n) => Math.abs(n.cents)).filter(Number.isFinite);
  if (cents.length === 0) return [`No notes were measured in "${label(take)}".`];
  const within = cents.filter((c) => c <= 10).length;
  const out = [
    `"${label(take)}" (${when(take)}): ${cents.length} notes heard, ${round1(mean(cents))}¢ off pitch on average, `
    + `${round0((within / cents.length) * 100)}% of notes within 10¢.`,
  ];
  const byName = new Map();
  for (const n of stats) {
    if (!Number.isFinite(n.cents)) continue;
    if (!byName.has(n.name)) byName.set(n.name, []);
    byName.get(n.name).push(n.cents);
  }
  const rows = [...byName].filter(([, c]) => c.length >= 2).map(([name, c]) => ({ name, c: mean(c), n: c.length }));
  if (rows.length) {
    const worst = rows.sort((a, b) => Math.abs(b.c) - Math.abs(a.c))[0];
    if (Math.abs(worst.c) >= 6) {
      out.push(`The note furthest from pitch was ${worst.name}, ${round0(Math.abs(worst.c))}¢ ${worst.c > 0 ? 'sharp' : 'flat'} on average over ${worst.n} times.`);
    }
  }
  return out;
}

function perPitch(take) {
  const m = new Map();
  for (const n of take.noteStats ?? []) {
    if (!Number.isFinite(n.cents)) continue;
    if (!m.has(n.name)) m.set(n.name, []);
    m.get(n.name).push(n.cents);
  }
  return m;
}

function compareFacts(a, b) {
  // a is the newer take. Two takes of one piece share a name, so the date has
  // to tell them apart or the sentence reads "Bach 9¢, Bach 22¢".
  const same = label(a) === label(b);
  const la = same ? `${label(a)}, ${when(a)}` : label(a);
  const lb = same ? `${label(b)}, ${when(b)}` : label(b);
  const out = [];
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
      out.push(`Timing against the beat is ${round0(Math.abs(cmp.msDelta))} ms ${cmp.msDelta < 0 ? 'tighter' : 'looser'} on average.`);
    }
  } else {
    const pa = perPitch(a);
    const pb = perPitch(b);
    const moved = [];
    for (const [name, ca] of pa) {
      const cb = pb.get(name);
      if (!cb || ca.length < 2 || cb.length < 2) continue;
      const da = Math.abs(mean(ca));
      const db = Math.abs(mean(cb));
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
      out.push(`${r.label}: ${round1(r.before)}${r.unit ? ` ${r.unit}` : ''} before, ${round1(r.after)}${r.unit ? ` ${r.unit}` : ''} now — ${r.verdict}.`);
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
const SHAPING_NOTHING = /are shaped about the same on everything|^Could not be compared because it was not measured in both takes/;
function shapingFolded(a, b) {
  if (!a.musicality || !b.musicality) return [];
  const rows = compareMusicalityFacts(a, b, { max: 3 });
  // drop the standing caveat; it is added once by the musicality intent when
  // the question was about shaping, and a pitch comparison does not need it
  return rows.filter((r) => r !== MUSICALITY_CAVEAT && !SHAPING_NOTHING.test(r));
}

// When the question IS about shaping and the takes are shaped alike, that is
// the answer, but "on everything that could be measured" is a claim about the
// pitch and the tone too, and the same answer has just listed those differing.
// Said about the shaping measurements by name it is true, and with a pointer to
// the differences above when there are some. (The sentence is built in
// musicality-facts.js; it is reworded here, where the other facts are known.)
const DIFFERENCE_WORDS = /\b(closer|further|steadier|shakier|wider|narrower|faster|slower|tighter|looser|clearer|brighter|darker|more notes|fewer notes)\b/;
function scopedSame(rows, earlier) {
  const differences = earlier.some((f) => DIFFERENCE_WORDS.test(f));
  return rows.map((r) => r.replace(
    /are shaped about the same on everything that could be measured in both\.$/,
    `are shaped about the same on the shaping measurements (phrasing, articulation, tempo and repeated figures)${differences ? '; the differences above are not about shaping' : ''}.`,
  ));
}

function worstFacts(take) {
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
    return [`In "${label(take)}", the bars furthest from pitch were: ${top.map((r) => `bar ${r.bar} (${round1(r.m)}¢ off over ${r.n} notes)`).join(', ')}.`];
  }
  const pitches = [...perPitch(take)]
    .filter(([, c]) => c.length >= 2)
    .map(([name, c]) => ({ name, m: mean(c), n: c.length }))
    .sort((x, y) => Math.abs(y.m) - Math.abs(x.m))
    .slice(0, 3);
  if (pitches.length === 0) return [`There are too few repeated notes in "${label(take)}" to say which are weakest.`];
  return [
    `This take has no score attached, so I can name notes but not bars. The notes furthest from pitch in "${label(take)}": `
    + `${pitches.map((p) => `${p.name} (${round0(Math.abs(p.m))}¢ ${p.m > 0 ? 'sharp' : 'flat'}, ${p.n} times)`).join(', ')}.`,
  ];
}

function habitFacts(takes) {
  const sessions = takes.map((t) => ({ date: t.date, noteStats: t.noteStats ?? [] }));
  const rows = aggregateTendencies(sessions, { minCount: 3 }).filter((r) => r.verdict !== 'centered');
  if (rows.length === 0) return [`No note leans sharp or flat by more than 6¢ across ${takes.length} take${takes.length === 1 ? '' : 's'}.`];
  const top = rows.sort((a, b) => Math.abs(b.meanCents) - Math.abs(a.meanCents)).slice(0, 3);
  return [
    `Across ${takes.length} take${takes.length === 1 ? '' : 's'}: ${top.map((r) => `${r.name} runs ${round0(Math.abs(r.meanCents))}¢ ${r.verdict} (spread ±${round0(r.spreadCents)}¢, ${r.count} times)`).join('; ')}.`,
  ];
}

function toneFacts(take) {
  const q = take.quality;
  if (!q) return [`Tone and vibrato could not be measured for "${label(take)}".`];
  const out = [];
  if (Number.isFinite(q.steadinessCents)) {
    out.push(`Pitch steadiness inside held notes (without vibrato): ${round1(q.steadinessCents)}¢ of wander in the middle note.`);
  }
  if (q.vibrato) {
    const v = q.vibrato;
    out.push(
      `Vibrato is on ${round0(v.share * 100)}% of notes held 0.4 s or longer`
      + (Number.isFinite(v.rateHz) && Number.isFinite(v.widthCents)
        ? `, at about ${round1(v.rateHz)} Hz and ${round0(v.widthCents)}¢ wide.` : '.'),
    );
  }
  if (q.dynamics) {
    out.push(`Loudness range is ${round0(q.dynamics.rangeDb)} dB between the quietest and loudest tenth of notes; neighbouring notes differ by ${round1(q.dynamics.stepDb)} dB.`);
  }
  if (Number.isFinite(q.clarity)) out.push(`Tone clarity reads ${round1(q.clarity * 100)} out of 100 (lower can mean breathy or rough).`);
  if (Number.isFinite(q.brightness)) out.push(`Brightness: the sound's centre sits around the ${round1(q.brightness)}th harmonic.`);
  if (q.landing) {
    out.push(`${round0(q.landing.cleanShare * 100)}% of notes arrive in tune within 60 ms; the median note takes ${round0(q.landing.medianSettleMs ?? 0)} ms to settle.`);
  }
  return out.length ? out : [`Not enough long notes in "${label(take)}" to read its tone.`];
}

function tempoFacts(take) {
  const r = take.rhythm;
  if (!r) return [`No steady pulse could be found in "${label(take)}", so I cannot say whether it rushes or drags.`];
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
    if (intent === 'summary' || intent === 'compare' || intent === 'tone' || intent === 'musicality') n = Math.min(chosen.length, 2);
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
  if (chosen.length === 0) return { facts: ['There are no saved takes with measured notes yet, so there is nothing to answer from.'], used, takesInFacts: 0 };

  for (const t of chosen) used.push(label(t));

  for (const intent of intents) {
    if (intent === 'summary') for (const t of chosen.slice(0, 2)) facts.push(...summaryFacts(t));
    else if (intent === 'compare') {
      if (chosen.length >= 2) {
        facts.push(...compareFacts(chosen[0], chosen[1]));
        if (!intents.includes('musicality')) facts.push(...shapingFolded(chosen[0], chosen[1]));
      }
      else facts.push('Only one take is saved, so there is nothing to compare it with.', ...summaryFacts(chosen[0]));
    } else if (intent === 'worst') facts.push(...worstFacts(chosen[0]));
    else if (intent === 'habits') facts.push(...habitFacts(chosen.length > 1 ? chosen : all));
    else if (intent === 'tone') {
      if (!intents.includes('compare') || chosen.length < 2) for (const t of chosen.slice(0, 2)) facts.push(...toneFacts(t));
    } else if (intent === 'tempo') facts.push(...tempoFacts(chosen[0]));
    else if (intent === 'musicality') {
      if (intents.includes('compare') && chosen.length >= 2) facts.push(...scopedSame(compareMusicalityFacts(chosen[0], chosen[1], { question }), facts));
      else for (const t of chosen.slice(0, 2)) facts.push(...musicalityFacts(t, { question }));
    } else if (intent === 'trend') facts.push(...trendFacts(all, now));
  }
  // The same sentence twice is never an answer. (Two intents that both reach the
  // same builder can produce it; today none does, and this is the net.)
  return { facts: [...new Set(facts)], used, takesInFacts: takesBehind(intents, chosen, all) };
}
