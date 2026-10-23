// CAN THE MUSICALITY DESCRIPTORS RECOVER SHAPING THAT WAS PUT IN?
//
// Takes are synthesised with KNOWN shaping — arched loudness, a stretch before
// each phrase end, a tempo wave, a drift, detached against legato, vibrato that
// opens up, repeated figures played identically or varied — rendered to audio,
// and sent through the REAL Analyzer + NoteSegmenter, no browser, no
// microphone. The question is whether src/analysis/musicality.js says what was
// built, and above all whether it says MECHANICAL of a metronomic flat take
// and not of any shaped one.
//
// Then the other half, which is what the thresholds were set from: the NOISE
// FLOOR. A perfectly steady take is not read as perfectly steady, because the
// pipeline's own onset and end errors are a fixed few milliseconds; this prints
// what a flat take reads at a slow and at a fast note length, so a number from
// a recording can be held against the floor for ITS tempo and not against a
// constant.
//
//   node tools/musicality-synth-check.mjs [--ideal]
//
// --ideal skips the audio and feeds the module the notes straight from the
// spec, which is what tests/musicality.test.js does.
import { buildSpec, renderAudio, hear, idealTake } from '../tests/helpers/musicality-synth.js';
import { musicalityOf, compareMusicality } from '../src/analysis/musicality.js';

const ideal = process.argv.includes('--ideal');
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

console.log('\n== the word MECHANICAL ==');
for (const [name, opts] of [
  ['slow legato flat', { ...slow, period: 0.6, shape: 'flat', articulation: 0.97 }],
  ['slow detached flat', { ...slow, period: 0.6, shape: 'flat', articulation: 0.5 }],
  ['fast legato flat', { phrases: 6, perPhrase: 24, period: 0.15, shape: 'flat', articulation: 0.97 }],
  ['fast detached flat', { phrases: 6, perPhrase: 24, period: 0.15, shape: 'flat', articulation: 0.5 }],
]) {
  const m = run(opts);
  check(`${name} is called mechanical`, m.descriptors.character.mechanical, m.descriptors.character.phrase);
}
for (const [name, opts] of [
  ['arched loudness', { ...slow, shape: 'arch' }],
  ['tempo wave', { ...slow, shape: 'flat', wave: 0.15 }],
  ['stretched phrase ends + arch', { ...slow, shape: 'arch', finalStretch: 1.5 }],
  ['vibrato opening up', { ...slow, period: 1.1, shape: 'flat', articulation: 0.98, vibrato: 'grows' }],
  ['mixed articulation', { ...slow, shape: 'flat', articulation: 0.7, articulationJitter: 0.25 }],
]) {
  const m = run(opts);
  check(`${name} is NOT called mechanical`, !m.descriptors.character.mechanical, m.descriptors.character.phrase);
}

console.log('\n== comparison says what changed ==');
const cmp = compareMusicality(flat, arch);
const row = (k) => cmp.find((r) => r.key === k);
check('flat -> arched: more phrasing contrast in shape', row('phrase-shape').verdict.includes('more phrases that swell'), row('phrase-shape').verdict);
const cmp2 = compareMusicality(same, varied);
check('identical -> varied repeats: marked less alike and not better', row2(cmp2, 'repeat-timing').verdict.includes('less alike') && row2(cmp2, 'repeat-timing').better === false, row2(cmp2, 'repeat-timing').verdict);
function row2(c, k) { return c.find((r) => r.key === k); }

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
