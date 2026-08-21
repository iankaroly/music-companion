// Does a take line up with a score the recogniser read?
//
// Not "does the aligner run" — whether a performance of a page lands on the
// right noteheads, at the right times, and is described honestly afterwards.
// It is checked against a score read off a photograph, because that is the hard
// case and the one this app is for: bars that do not add up, notes the reader
// missed, accidentals it invented.
//
// The take is synthesised from the score itself, so the truth is known: every
// note played, in order, at a steady tempo, with the jitter of a real player.
//
//   npm run score:sync
//
import { readFileSync } from 'node:fs';
import { parseScore } from '../src/analysis/musicxml.js';
import { alignScore } from '../src/analysis/align-score.js';
import { scoreTiming } from '../src/analysis/score-timing.js';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const XML = arg('xml', new URL('../test/fixtures/recognised-page.musicxml', import.meta.url).pathname);
const BPM = Number(arg('bpm', 84));
const JITTER = Number(arg('jitter', 0.012));      // seconds, either side

const xml = readFileSync(XML, 'utf8');
const score = parseScore(xml, { partIndex: 0, steadyBars: true }).notes;

// A performance OF THAT SCORE: every note, in order, at a steady tempo, each
// landing a few milliseconds off the way a person does.
let seed = 7;
const wobble = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return ((seed / 2147483648) * 2 - 1) * JITTER;
};
const spb = 60 / BPM;
// A played note as the analysis makes one: see notes.js — `start` and `end` in
// seconds, and the midi it heard. Getting these names wrong is how a check ends
// up measuring nothing and calling it a pass.
const played = score.map((n) => {
  const start = n.onsetBeats * spb + wobble();
  return {
    midi: n.midi,
    start,
    end: start + Math.max(0.05, n.durBeats * spb * 0.9),
  };
});

const report = (label, aligned, timing) => {
  const paired = aligned.attempts.filter((a) => a.played);
  const rightHead = paired.filter((a, i) => a.scoreNoteId === score[aligned.attempts.indexOf(a)]?.id).length;
  // scoreTiming reports a row per note, with deviationMs against the pulse it
  // found (or against the target, when one is set) — see perNote there.
  const rows = (timing?.perNote ?? []).filter((n) => n.deviationMs !== null && n.deviationMs !== undefined);
  const off = rows.filter((n) => Math.abs(n.deviationMs) > 60).length;
  const total = rows.length;
  console.log(`${label.padEnd(22)} paired ${String(paired.length).padStart(3)}/${score.length}`
    + `  wrong ${String(aligned.wrong).padStart(3)}`
    + `  semitone-out ${String(aligned.near ?? 0).padStart(3)}`
    + `  missed ${String(aligned.missed).padStart(3)}`
    + `  extra ${String(aligned.extra).padStart(3)}`
    + `  more than 60ms out ${String(off).padStart(3)}/${total}`
    + (timing?.bpm ? `  read as ${timing.bpm.toFixed(1)}bpm` : ''));
  return { paired: paired.length, wrong: aligned.wrong, near: aligned.near ?? 0,
    missed: aligned.missed, extra: aligned.extra, off, total };
};

// The ways a take actually differs from the page, one at a time.
const takeOf = (notes, atBpm = BPM) => {
  const beat = 60 / atBpm;
  return notes.map((n) => {
    const start = n.onsetBeats * beat + wobble();
    return { midi: n.midi, start, end: start + Math.max(0.05, n.durBeats * beat * 0.9) };
  });
};

console.log(`${score.length} notes, played at ${BPM}bpm with ${Math.round(JITTER * 1000)}ms of wobble\n`);

const cases = [];
const add = (label, take, expect) => {
  const aligned = alignScore(take, score, { nearMiss: true });
  const timing = scoreTiming(aligned.attempts, expect.target ? { targetBpm: BPM } : {});
  cases.push({ label, ...report(label, aligned, timing), expect, aligned });
};

add('the whole page', played, { paired: score.length, wrong: 0, missed: 0, target: false });
add('the whole page, target', played, { paired: score.length, wrong: 0, missed: 0, target: true });

// A passage out of the middle, which is what practising is.
const passage = score.slice(40, 72);
add('one passage', takeOf(passage), { paired: passage.length, wrong: 0, missed: 0, target: false });

// Three notes played wrong. They should be named, and nothing else disturbed.
const fumbled = takeOf(score).map((n, i) => ([15, 44, 90].includes(i) ? { ...n, midi: n.midi + 1 } : n));
// On a score read off a page a semitone is not called wrong — the reading may
// be the thing that is wrong — but it must not vanish either.
add('three semitones out', fumbled, { paired: score.length, wrong: 0, near: 3, missed: 0, target: false });

// Two notes skipped entirely.
const skipped = takeOf(score).filter((_, i) => i !== 30 && i !== 31);
add('two notes skipped', skipped, { paired: score.length - 2, wrong: 0, missed: 2, target: false });

// Speeding up through the page, which every player does. The time of a beat is
// the tempo integrated up to it — scaling each note's position by the tempo AT
// that note is not an accelerando, it is a warped clock, and it makes the check
// wrong rather than the app.
const endBpm = BPM + 16;
const lastBeat = Math.max(...score.map((n) => n.onsetBeats)) || 1;
const secondsAt = (beat) => {
  // bpm rises linearly with the beat; time is the integral of 60/bpm.
  const k = (endBpm - BPM) / lastBeat;
  return k === 0 ? (beat * 60) / BPM : (60 / k) * Math.log((BPM + k * beat) / BPM);
};
const rushing = score.map((n) => {
  const start = secondsAt(n.onsetBeats) + wobble();
  return { midi: n.midi, start, end: start + 0.2 };
});
add('speeding up', rushing, { paired: score.length, wrong: 0, missed: 0, target: false });

let bad = 0;
for (const c of cases) {
  const wanted = c.expect;
  const wrongCount = wanted.wrong ?? 0;
  const missedCount = wanted.missed ?? 0;
  const problems = [];
  if (c.paired !== wanted.paired) problems.push(`paired ${c.paired}, wanted ${wanted.paired}`);
  if (c.wrong !== wrongCount) problems.push(`wrong ${c.wrong}, wanted ${wrongCount}`);
  if ((wanted.near ?? 0) !== (c.near ?? 0)) problems.push(`semitone-out ${c.near}, wanted ${wanted.near ?? 0}`);
  if (c.missed !== missedCount) problems.push(`missed ${c.missed}, wanted ${missedCount}`);
  // A timing report with nothing in it passes by accident — that is how a
  // metric that measures nothing gets mistaken for a green light.
  if (c.total === 0) problems.push('nothing was timed at all');
  if (c.off > Math.ceil(c.total * 0.02)) problems.push(`${c.off} of ${c.total} more than 60ms out`);
  if (problems.length) { bad += 1; console.log(`   ${c.label}: ${problems.join('; ')}`); }
}
console.log(bad === 0
  ? '\nPASS — every take lands on the notes it was played from'
  : `\nFAIL — ${bad} of ${cases.length} takes do not line up`);
process.exit(bad === 0 ? 0 : 1);
