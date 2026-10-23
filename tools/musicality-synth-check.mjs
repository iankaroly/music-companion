// CAN THE MUSICALITY DESCRIPTORS RECOVER SHAPING THAT WAS PUT IN?
//
// Takes are synthesised with KNOWN shaping — arched loudness, a stretch before
// each phrase end, a tempo wave, a drift, detached against legato, vibrato that
// opens up, repeated figures played identically or varied — rendered to audio,
// and sent through the REAL Analyzer + NoteSegmenter, no browser, no
// microphone. The question is whether src/analysis/musicality.js says what was
// built, and above all whether it calls a metronomic flat take 'very evenly timed
// and not of any shaped one.
//
// Then the other half, which is what the thresholds were set from: the NOISE
// FLOOR. A perfectly steady take is not read as perfectly steady, because the
// pipeline's own onset and end errors are a fixed few milliseconds; this prints
// what a flat take reads at a slow and at a fast note length, so a number from
// a recording can be held against the floor for ITS tempo and not against a
// constant.
//
//   node tools/musicality-synth-check.mjs [--ideal] [--heavy]
//
// --ideal skips the audio and feeds the module the notes straight from the
// spec, which is what tests/musicality.test.js does. --heavy adds the 20-seed
// false-drift sweep through the real pipeline (several minutes).
import { buildSpec, renderAudio, hear, idealTake } from '../tests/helpers/musicality-synth.js';
import { musicalityOf, compareMusicality } from '../src/analysis/musicality.js';

const ideal = process.argv.includes('--ideal');
const heavy = process.argv.includes('--heavy');   // the 20-seed false-drift sweep through the real pipeline: minutes, not seconds
const run = (opts) => {
  const spec = buildSpec(opts);
  return musicalityOf(ideal ? idealTake(spec) : hear(renderAudio(spec), 44100));
};
const d = (m, k) => m.descriptors[k];
const fmt = (m, k) => (d(m, k)?.measured ? `${d(m, k).value.toFixed(2)}${d(m, k).unit}` : '-');

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   (${detail})` : ''}`);
};

const slow = { period: 0.5, perPhrase: 10, phrases: 6 };

console.log(`\n== recover known shaping (${ideal ? 'ideal notes' : 'real Analyzer + NoteSegmenter'}) ==`);
const arch = run({ ...slow, shape: 'arch' });
check('arched loudness reads as swell-and-fade phrases', d(arch, 'phrase-shape').measured && d(arch, 'phrase-shape').value >= 80, `arch share ${fmt(arch, 'phrase-shape')}`);
const flat = run({ ...slow, shape: 'flat' });
check('flat loudness reads as level phrases', d(flat, 'phrase-shape').measured && d(flat, 'phrase-shape').detail.dominant === 'level', d(flat, 'phrase-shape').phrase);
const build = run({ ...slow, shape: 'build' });
check('rising loudness reads as building phrases', d(build, 'phrase-shape').detail.dominant === 'build', d(build, 'phrase-shape').phrase);
const jump = run({ ...slow, shape: 'jump', peakDb: 6 });
check('random loudness jumps read as uneven, not arched', d(jump, 'phrase-shape').detail.dominant === 'uneven', d(jump, 'phrase-shape').phrase);
const contrast = run({ ...slow, shape: 'flat', phraseGainDb: [0, 6, -3] });
check('louder and quieter phrases read as contrast', d(contrast, 'phrase-contrast').value >= 2 && d(flat, 'phrase-contrast').value < 0.5, `${fmt(contrast, 'phrase-contrast')} against flat ${fmt(flat, 'phrase-contrast')}`);

const stretch = run({ ...slow, shape: 'flat', finalStretch: 1.5 });
check('stretching each phrase end reads as lengthening', d(stretch, 'phrase-final-lengthening').value >= 1.3 && d(flat, 'phrase-final-lengthening').value < 1.2, `${fmt(stretch, 'phrase-final-lengthening')} against flat ${fmt(flat, 'phrase-final-lengthening')}`);

const wave = run({ ...slow, shape: 'flat', wave: 0.15 });
check('a tempo wave reads as moving tempo that returns', d(wave, 'tempo-flexibility').measured && d(wave, 'tempo-flexibility').value >= d(wave, 'tempo-flexibility').detail.steadyBelow && d(wave, 'tempo-shape').detail.kind === 'returns', `${fmt(wave, 'tempo-flexibility')}, ${d(wave, 'tempo-shape').detail.kind}`);
const drift = run({ ...slow, shape: 'flat', drift: 0.2 });
check('a tempo drift reads as a drift', d(drift, 'tempo-shape').detail.kind === 'speeds-up', `${fmt(drift, 'tempo-shape')}`);

const stac = run({ ...slow, shape: 'flat', articulation: 0.45 });
const leg = run({ ...slow, shape: 'flat', articulation: 0.98 });
check('staccato reads detached and legato reads connected', d(stac, 'articulation').value < 0.6 && d(leg, 'articulation').value > 0.85, `${fmt(stac, 'articulation')} and ${fmt(leg, 'articulation')}`);
const ragged = run({ ...slow, shape: 'flat', articulation: 0.7, articulationJitter: 0.25 });
check('mixed articulation reads as uneven', d(ragged, 'articulation-evenness').value > d(ragged, 'articulation-evenness').detail.evenBelow, `${fmt(ragged, 'articulation-evenness')} against flat ${fmt(flat, 'articulation-evenness')}`);

const same = run({ ...slow, shape: 'arch' });
const varied = run({ ...slow, shape: 'arch', sameRepeats: false });
check('varied repeats read as less alike than identical ones', d(varied, 'repeat-timing').value > d(same, 'repeat-timing').value + 2, `${fmt(varied, 'repeat-timing')} against ${fmt(same, 'repeat-timing')}`);

const grows = run({ ...slow, period: 1.1, shape: 'flat', articulation: 0.98, vibrato: 'grows' });
const steady = run({ ...slow, period: 1.1, shape: 'flat', articulation: 0.98, vibrato: 'steady' });
check('vibrato that opens reads as opening, steady vibrato does not', d(grows, 'vibrato-growth').measured && d(grows, 'vibrato-growth').value >= 60 && d(steady, 'vibrato-growth').measured && d(steady, 'vibrato-growth').value <= 25, `${fmt(grows, 'vibrato-growth')} and ${fmt(steady, 'vibrato-growth')}`);

console.log('\n== "very evenly timed and even in loudness": said of takes that do not move, and of no others ==');
for (const [name, opts] of [
  ['slow legato flat', { ...slow, period: 0.6, shape: 'flat', articulation: 0.97 }],
  ['slow detached flat', { ...slow, period: 0.6, shape: 'flat', articulation: 0.5 }],
  ['fast legato flat', { phrases: 6, perPhrase: 24, period: 0.15, shape: 'flat', articulation: 0.97 }],
  ['fast detached flat', { phrases: 6, perPhrase: 24, period: 0.15, shape: 'flat', articulation: 0.5 }],
]) {
  const m = run(opts);
  // An unmeasured measure is not a flat one: where the real pipeline cannot read a tempo (0.15 s legato
  // scatters too much) the take is NOT called very even, which the first version did call; where it can, it is.
  const tempoRead = d(m, 'tempo-flexibility').measured;
  check(`${name} is ${tempoRead ? 'described as very even' : 'not claimed (tempo unreadable at this speed)'}`, m.descriptors.character.veryEven === tempoRead, m.descriptors.character.phrase || '(no character)');
}
for (const [name, opts] of [
  ['arched loudness', { ...slow, shape: 'arch' }],
  ['tempo wave', { ...slow, shape: 'flat', wave: 0.15 }],
  ['stretched phrase ends + arch', { ...slow, shape: 'arch', finalStretch: 1.5 }],
  ['stretched phrase ends only (flat)', { ...slow, shape: 'flat', finalStretch: 1.5 }],
  ['vibrato opening up', { ...slow, period: 1.1, shape: 'flat', articulation: 0.98, vibrato: 'grows' }],
  ['mixed articulation', { ...slow, shape: 'flat', articulation: 0.7, articulationJitter: 0.25 }],
]) {
  const m = run(opts);
  check(`${name} is NOT called very even`, !m.descriptors.character.veryEven, m.descriptors.character.phrase);
}
const drone = run({ phrases: 3, perPhrase: 10, period: 0.5, shape: 'flat', drone: true });
check('a single pitch is not described as a take with character', !drone || !drone.descriptors.character.measured, drone ? 'one pitch' : 'segmenter merged it into fewer than 12 notes');

console.log('\n== loudness between stretches is the same at any length (random loudness +-6 dB, 8 seeds each) ==');
{
  const at = (notes) => {
    const v = [];
    for (let seed = 1; seed <= 8; seed++) {
      const m = run({ phrases: notes / 8, perPhrase: 8, period: 0.4, shape: 'jump', peakDb: 6, seed });
      if (d(m, 'stretch-contrast')?.measured) v.push(d(m, 'stretch-contrast').value);
    }
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
  };
  const rows = [40, 80, 160, 320].map((n) => [n, at(n)]);
  console.log('  notes  ' + rows.map(([n]) => String(n).padStart(6)).join(''));
  console.log('  dB     ' + rows.map(([, v]) => (v === null ? '-' : v.toFixed(2)).padStart(6)).join(''));
  const vals = rows.map(([, v]) => v).filter((v) => v !== null);
  check('the length sweep is flat within a third', Math.max(...vals) / Math.min(...vals) < 1.33, `max/min ${(Math.max(...vals) / Math.min(...vals)).toFixed(2)}`);
}

if (!ideal) {   // the Analyzer's own level gate is what loses the notes; an ideal take has none
  console.log('\n== a quiet take that loses its notes is not described ==');
  const spec = buildSpec({ ...slow, shape: 'arch', articulation: 0.55, gainDb: -20 });
  const m = musicalityOf(ideal ? idealTake(spec) : hear(renderAudio(spec), 44100));
  check('20 dB quieter: refused as too quiet, nothing measured', !m || (m.reliability.reason === 'quiet' && Object.values(m.descriptors).every((x) => !x.measured)), m ? `coverage ${m.reliability.coverage?.toFixed(2)}, ${m.noteCount} of 60 notes` : 'no notes heard at all');
  const ok = run({ ...slow, shape: 'arch', articulation: 0.55, gainDb: -12 });
  check('12 dB quieter is still read in full', ok.reliability.reason === null, `coverage ${ok.reliability.coverage?.toFixed(2)}`);
}

console.log('\n== comparison says what changed ==');
const cmp = compareMusicality(flat, arch);
const row = (k) => cmp.find((r) => r.key === k);
check('flat -> arched: more phrasing contrast in shape', row('phrase-shape').verdict.includes('more phrases that swell'), row('phrase-shape').verdict);
const cmp2 = compareMusicality(same, varied);
check('identical -> varied repeats: marked less alike, ranked nothing', row2(cmp2, 'repeat-timing').verdict.includes('less alike') && !('better' in row2(cmp2, 'repeat-timing')), row2(cmp2, 'repeat-timing').verdict);
{
  // The same performance at two tempos, scaled in time, through the real pipeline. Nothing should move.
  const A = run({ phrases: 6, perPhrase: 10, period: 0.4, breath: 0.28, shape: 'flat' });
  const B = run({ phrases: 6, perPhrase: 10, period: 0.7, breath: 0.49, shape: 'flat' });
  const moved = compareMusicality(B, A).filter((r) => r.verdict !== 'about the same' && r.verdict !== 'unmeasured');
  check('the same flat performance at 0.4 s and 0.7 s a note compares as about the same', moved.length === 0, moved.map((r) => r.key + ': ' + r.verdict).join('; ') || 'no row moved');
}
function row2(c, k) { return c.find((r) => r.key === k); }

if (heavy) {
  console.log('\n== FALSE DRIFTS: takes with NO drift and a random jitter on every spacing, through the real pipeline, 20 seeds ==');
  for (const jitter of [0.04, 0.08, 0.12, 0.2]) {
    for (const phrases of [6, 12, 24]) {
      let measured = 0;
      let claimed = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const t = d(run({ phrases, perPhrase: 10, shape: 'flat', jitter, seed }), 'tempo-shape');
        if (t.measured) { measured++; if (t.detail.kind === 'speeds-up' || t.detail.kind === 'slows-down') claimed++; }
      }
      check(`jitter ${jitter * 100}% at ${phrases} phrases claims no drift`, claimed === 0, `${measured} of 20 read, ${claimed} claimed a drift`);
    }
  }
}

if (!ideal) {
  console.log('\n== NOISE FLOOR: metronomic flat takes through the real pipeline ==');
  console.log('what a perfectly steady take reads, by note length. A recording is held against the floor for ITS tempo.');
  console.log('note length  articulation   tempo spread   repeat timing   art. spread   phrase-end ratio');
  for (const [period, perPhrase] of [[0.6, 10], [0.3, 16], [0.15, 24]]) {
    for (const art of [0.97, 0.5]) {
      const m = run({ phrases: 6, perPhrase, period, shape: 'flat', articulation: art });
      console.log(`${String(period).padEnd(4)} s  ${(art === 0.97 ? 'legato  ' : 'detached').padEnd(9)}  ${fmt(m, 'articulation').padEnd(14)} ${fmt(m, 'tempo-flexibility').padEnd(14)} ${fmt(m, 'repeat-timing').padEnd(15)} ${fmt(m, 'articulation-evenness').padEnd(13)} ${fmt(m, 'phrase-final-lengthening')}`);
    }
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
