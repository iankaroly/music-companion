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

console.log('\n== round 3: faults a skeptic found in round 2 ==');
{
  // 1-3. the same performance at six tempos: nothing about the phrases may move (26c4196: 136 of 240 pairs said "more, shorter phrases")
  const tempos = [0.3, 0.35, 0.4, 0.5, 0.6, 0.7];
  let pairs = 0;
  let falsePhrase = 0;
  const found = {};
  for (let seed = 1; seed <= 4; seed++) {
    const takes = tempos.map((P) => run({ phrases: 8, perPhrase: 8, period: P, breath: 0.6 * P, shape: 'flat', articulation: 0.97, jitter: 0.06, seed }));
    tempos.forEach((P, i) => { found[P] = (found[P] ?? []).concat(d(takes[i], 'phrase-count').measured ? d(takes[i], 'phrase-count').value : '-'); });
    for (let i = 0; i < takes.length; i++) for (let j = i + 1; j < takes.length; j++) {
      pairs++;
      if (compareMusicality(takes[i], takes[j]).some((r) => /^phrase-/.test(r.key) && r.verdict !== 'about the same' && r.verdict !== 'unmeasured')) falsePhrase++;
    }
  }
  console.log('  phrases found (8 played), 4 seeds: ' + tempos.map((P) => `${P}s: ${found[P].join('')}`).join('   '));
  check('one performance at six tempos: no pair says the phrases changed', falsePhrase === 0, `${falsePhrase} of ${pairs} pairs`);
  let cuts = 0;
  let tried = 0;
  for (const P of [0.12, 0.2, 0.3, 0.6]) for (const art of [0.5, 0.95]) {
    const m = run({ phrases: 6, perPhrase: 10, period: P, breath: 0, shape: 'flat', articulation: art, jitter: 0.04, seed: 2 });
    tried++;
    if (d(m, 'phrase-count').measured && d(m, 'phrase-count').value > 1) cuts++;
  }
  check('takes with no breath in them are not cut into phrases at any of 0.12-0.6 s a note', cuts === 0, `${cuts} of ${tried} cut`);

  // 6. a real accelerando, and a constant tempo
  const kinds = { drift: 0, calm: 0, other: 0 };
  for (let seed = 1; seed <= 10; seed++) {
    const t = d(run({ phrases: 6, perPhrase: 10, period: 0.5, shape: 'flat', articulation: 0.9, jitter: 0.04, drift: 0.1, seed }), 'tempo-shape');
    const k = t.measured ? t.detail.kind : 'refused';
    if (k === 'speeds-up' || k === 'leans-faster') kinds.drift++;
    else if (k === 'returns' || k === 'steady' || k === 'level') kinds.calm++;
    else kinds.other++;
  }
  check('a real +11% accelerando is a drift and never "steady" or "returns" (10 takes)', kinds.calm === 0 && kinds.drift >= 8, JSON.stringify(kinds));
  const slowing = { drift: 0, calm: 0 };
  for (let seed = 1; seed <= 10; seed++) {
    const t = d(run({ phrases: 6, perPhrase: 10, period: 0.5, shape: 'flat', articulation: 0.9, jitter: 0.04, drift: -0.1, seed }), 'tempo-shape');
    const k = t.measured ? t.detail.kind : 'refused';
    if (k === 'slows-down' || k === 'leans-slower') slowing.drift++;
    else if (k === 'returns' || k === 'steady' || k === 'level') slowing.calm++;
  }
  check('a real -9% ritardando is a drift and never "steady" or "returns" (10 takes)', slowing.calm === 0 && slowing.drift >= 8, JSON.stringify(slowing));

  if (!ideal) {
    // 4. quiet tails: a decaying tone with a little room noise, and a staccato line in a hall
    const decaying = hear(renderAudio(buildSpec({ phrases: 4, perPhrase: 8, period: 2.0, articulation: 1.0, shape: 'flat', decay: 0.8, breath: 0.1, baseDb: -18 }), 44100, { noiseDb: -44 }), 44100);
    const vd = musicalityOf(decaying).descriptors['vibrato-growth'];
    check('a decaying tone with room noise does not report vibrato opening up (26c4196: 14 of 14 long notes "open up")', !(vd.measured && vd.value >= 50), vd.measured ? vd.phrase : vd.reason);
    const hall = hear(renderAudio(buildSpec({ phrases: 4, perPhrase: 8, period: 1.0, articulation: 0.25, shape: 'flat', breath: 0.1, baseDb: -18 }), 44100, { reverb: { rt60: 3, wetDb: -4 }, noiseDb: -70 }), 44100);
    const vh = musicalityOf(hall).descriptors['vibrato-growth'];
    check('a staccato line in a 3 s hall does not report vibrato opening up (26c4196: 7 of 12 long notes)', !(vh.measured && vh.value >= 50), vh.measured ? vh.phrase : vh.reason);

    // 5. a 60 Hz hum with a little drift: 130-230 'notes' and no silence
    const sr = 44100;
    const humAudio = new Float32Array(60 * sr);
    let seedH = 7;
    for (let i = 0; i < humAudio.length; i++) {
      seedH = (seedH * 1664525 + 1013904223) >>> 0;
      const t = i / sr;
      const f = 60 * (1 + 0.004 * Math.sin(2 * Math.PI * 0.3 * t));
      humAudio[i] = 0.05 * (1 + 0.1 * Math.sin(2 * Math.PI * 0.2 * t)) * (Math.sin(2 * Math.PI * f * t) + 0.7 * Math.sin(4 * Math.PI * f * t) + 0.4 * Math.sin(6 * Math.PI * f * t)) + 0.003 * (seedH / 4294967296 - 0.5);
    }
    const slur = run({ phrases: 6, perPhrase: 10, period: 0.5, articulation: 0.98, breath: 0, shape: 'arch' });
    check('a long slur with no breath that swells and fades is NOT called unbroken (a first cut of the gate withdrew it)', slur.reliability.reason !== 'unbroken' && d(slur, 'articulation').measured, `quiet share ${(slur.reliability.quietShare * 100).toFixed(1)}%, loudness spread ${slur.reliability.levelSpreadDb.toFixed(1)} dB`);
    const hum = musicalityOf(hear(humAudio, sr));
    check('a 60 Hz hum with drift is unreadable, not "one continuous stretch" (26c4196)', hum.reliability.reason === 'unbroken' && !d(hum, 'phrase-count').measured && !hum.descriptors.character.measured, `${hum.noteCount} notes, quiet share ${(hum.reliability.quietShare * 100).toFixed(1)}%`);
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
