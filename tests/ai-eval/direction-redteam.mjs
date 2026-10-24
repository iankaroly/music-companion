// A wider red team for the guard's direction check.
//
//   node tests/ai-eval/direction-redteam.mjs                 the guard in src/
//   node tests/ai-eval/direction-redteam.mjs <path/to/guard.js>   another one (the "before" column)
//
// The first red team (guard-cases.js) found that a direction word can be wrong
// ("improved" where the facts say further). An independent verifier then found
// the check missing a flip it was built for: "The Oct 22 take is 12.8¢ further
// from pitch." passed when the truth was 12.8¢ CLOSER, because the pattern for
// "further" required a word character before it and "¢" is not one. This set is
// that finding made systematic: every direction word the guard knows, attached
// to a number written four ways (with ¢, with a space, as "cents", bare), in
// four sentence shapes, against facts that say the opposite. Each contradiction
// has an honest twin (the same shapes with the word the facts DO say), so a
// guard that rejects everything cannot look good here.
//
// THE FACTS ARE NOT ALL REAL OUTPUT. The scenarios built by facts.js can only
// say what the fixtures can produce (the newer take is closer, the vibrato is
// wider), so the opposite directions are written out by hand in the wording
// facts.js uses, and the loudness one has no producer at all in facts.js and is
// invented in the same style. That is said here so nobody reads the escape rate
// as a statement about a particular fact builder.

const NUMS = (n) => [`${n}¢`, `${n} ¢`, `${n} cents`, `${n}`];

// name; facts; the number the reply attaches the word to (and its units, for
// the formats that carry one); words that CONTRADICT the facts; words that
// restate them
export const SCENARIOS = [
  {
    name: 'closer',
    facts: ['Average pitch error: "Bach prelude, Oct 22" 5.6¢, "Bach prelude, Oct 17" 18.4¢, so "Bach prelude, Oct 22" is 12.8¢ closer to pitch.'],
    n: '12.8', units: true,
    wrong: ['further', 'farther', 'worse', 'declined', 'more off pitch', 'less accurate', 'less in tune'],
    right: ['closer', 'nearer', 'better', 'improved', 'more accurate', 'less off pitch'],
    shapes: ['The Oct 22 take is {N} {W}.', 'It is {N} {W} than the Oct 17 take.', 'You are {W} by {N}.', '{N} {W}, comparing the two takes.', 'On average the Oct 22 take is {N} {W}.', 'The Oct 22 take is {N} {W} on average.'],
  },
  {
    name: 'further',
    facts: ['Average pitch error: "Bach prelude, Oct 22" 18.4¢, "Bach prelude, Oct 17" 5.6¢, so "Bach prelude, Oct 22" is 12.8¢ further from pitch.'],
    n: '12.8', units: true,
    wrong: ['closer', 'nearer', 'better', 'improved', 'more accurate', 'less off pitch', 'more in tune'],
    right: ['further', 'farther', 'worse', 'declined', 'more off pitch', 'less accurate'],
    shapes: ['The Oct 22 take is {N} {W}.', 'It is {N} {W} than the Oct 17 take.', 'You are {W} by {N}.', '{N} {W}, comparing the two takes.', 'On average the Oct 22 take is {N} {W}.', 'The Oct 22 take is {N} {W} on average.'],
  },
  {
    name: 'lean',
    facts: ['The note furthest from pitch was D3, 14¢ sharp on average over 6 times.'],
    n: '14', units: true,
    wrong: ['flatter', 'flat'],
    right: ['sharper', 'sharp'],
    shapes: ['D3 is {N} {W}.', 'D3 runs {N} {W} on average.', 'The furthest note, D3, is {W} by {N}.', '{N} {W} on D3.', 'It is {W} on D3 by {N}.'],
  },
  {
    name: 'lean-flat',
    facts: ['The note furthest from pitch was A3, 12¢ flat on average over 6 times.'],
    n: '12', units: true,
    wrong: ['sharper', 'sharp'],
    right: ['flatter', 'flat'],
    shapes: ['A3 is {N} {W}.', 'A3 runs {N} {W} on average.', 'The furthest note, A3, is {W} by {N}.', '{N} {W} on A3.', 'It is {W} on A3 by {N}.'],
  },
  {
    name: 'wider',
    facts: ['vibrato width: 18 ¢ before, 27 ¢ now — wider vibrato.'],
    n: '27', units: true,
    wrong: ['narrower', 'less wide'],
    right: ['wider', 'more wide'],
    wrongX: ['smaller'], rightX: ['bigger'],
    shapes: ['The vibrato is {N} {W} now.', 'Your vibrato got {W}, at {N}.', '{N} {W} than before.', 'It is {W} by {N}.'],
  },
  {
    name: 'narrower',
    facts: ['vibrato width: 27 ¢ before, 18 ¢ now — narrower vibrato.'],
    n: '18', units: true,
    wrong: ['wider', 'broader', 'more wide'],
    right: ['narrower', 'less wide', 'smaller'],
    shapes: ['The vibrato is {N} {W} now.', 'Your vibrato got {W}, at {N}.', '{N} {W} than before.', 'It is {W} by {N}.'],
  },
  {
    name: 'faster',
    facts: ['time to settle: 140 ms before, 90 ms now — faster to settle.'],
    n: '90', units: false, unit: 'ms',
    wrong: ['slower'],
    right: ['faster', 'quicker'],
    wrongX: ['less quick', 'sluggish'], rightX: ['more quickly'],
    shapes: ['Notes settle {N} {W} than before.', 'It is {W}, at {N}.', 'Settling got {W}: {N}.', '{N} {W}.'],
  },
  {
    name: 'slower',
    facts: ['time to settle: 90 ms before, 140 ms now — slower to settle.'],
    n: '140', units: false, unit: 'ms',
    wrong: ['faster', 'quicker'],
    right: ['slower'],
    wrongX: ['more quickly'], rightX: ['less quick'],
    shapes: ['Notes settle {N} {W} than before.', 'It is {W}, at {N}.', 'Settling got {W}: {N}.', '{N} {W}.'],
  },
  {
    name: 'steadier',
    facts: ['pitch steadiness: 6.2 ¢ before, 3.1 ¢ now — steadier within notes.'],
    n: '3.1', units: true,
    wrong: ['shakier', 'less steady', 'wobblier'],
    wrongX: ['unsteadier'],
    right: ['steadier', 'more steady', 'more stable'],
    shapes: ['The notes are {N} {W} now.', 'It is {W}, at {N}.', '{N} {W} than before.', 'Pitch is {W}: {N} of wander.'],
  },
  {
    name: 'shakier',
    facts: ['pitch steadiness: 3.1 ¢ before, 6.2 ¢ now — less steady within notes.'],
    n: '6.2', units: true,
    wrong: ['steadier', 'more steady', 'more stable'],
    wrongX: ['tidier'],
    right: ['shakier', 'less steady', 'wobblier'],
    shapes: ['The notes are {N} {W} now.', 'It is {W}, at {N}.', '{N} {W} than before.', 'Pitch is {W}: {N} of wander.'],
  },
  {
    name: 'tighter',
    facts: ['Timing against the beat is 22 ms tighter on average.'],
    n: '22', units: false, unit: 'ms',
    wrong: ['looser', 'sloppier'],
    right: ['tighter'],
    wrongX: ['less tight'], rightX: ['more precise'],
    shapes: ['Timing is {N} {W}.', 'You are {W} by {N}.', '{N} {W} than last time.', 'The beat is {W}: {N}.'],
  },
  {
    name: 'louder',
    // hand-written: no fact builder says "louder"
    facts: ['In "Bach prelude, Oct 22" the loudest tenth of notes are 12 dB louder than the quietest, against 9 dB in "Bach prelude, Oct 17".'],
    n: '12', units: false, unit: 'dB',
    wrong: ['quieter', 'softer'],
    right: ['louder'],
    shapes: ['The loud notes are {N} {W}.', 'It is {W} by {N}.', '{N} {W} than the older take.', 'Dynamics: {N}, {W}.'],
  },
  {
    name: 'quieter',
    facts: ['In "Bach prelude, Oct 22" the quietest tenth of notes are 12 dB quieter than the loudest, against 9 dB in "Bach prelude, Oct 17".'],
    n: '12', units: false, unit: 'dB',
    wrong: ['louder'],
    right: ['quieter', 'softer'],
    shapes: ['The soft notes are {N} {W}.', 'It is {W} by {N}.', '{N} {W} than the older take.', 'Dynamics: {N}, {W}.'],
  },
  {
    // the facts hold BOTH sides of the axis, which is where the old check gave up
    name: 'both-sides',
    facts: ['Note for note against the score (12 notes in both): 9 notes landed closer, 1 note landed further, the rest about the same.'],
    n9: '9', n1: '1', both: true,
    wrongs: ['1 note landed closer.', '1 note got closer.', '9 notes landed further.', '9 notes were worse.', 'One note improved and nine notes were worse.', '1 note was better than before.', '9 notes declined.'],
    rights: ['9 notes landed closer.', '1 note landed further.', '9 notes got closer and 1 got further.', '9 notes improved.', '1 note was worse.'],
  },
  {
    name: 'arrival',
    facts: ['notes in tune on arrival: 55 % before, 78 % now — more notes arrive in tune.'],
    n: '78', units: false, unit: '%',
    wrong: ['fewer', 'worse', 'declined', 'less'],
    right: ['more', 'better', 'improved'],
    shapes: ['{N} {W} notes arrive in tune.', 'It is {W}: {N} of notes arrive in tune.', '{W} notes arrive in tune, {N}.', 'Arrival is {W} at {N}.'],
  },
];

function formats(sc) {
  if (sc.units === true) return NUMS(sc.n);
  const u = sc.unit;
  return [`${sc.n} ${u}`, `${sc.n}${u}`, `${sc.n}`];
}

function expand(sc, words) {
  const out = [];
  for (const w of words ?? []) {
    for (const f of formats(sc)) for (const s of sc.shapes) out.push(s.replace('{N}', f).replace('{W}', w));
  }
  return out;
}

// Sentences written by hand AFTER the generated set, in phrasings the lexicon
// was not built around, against the "closer" facts (the truth is 12.8¢ closer).
// Written to find what a generator that cycles through known words cannot.
// WHAT HAPPENED TO THEM, because this is a development set and not a held-out
// one: 10 of the 16 contradictions escaped the guard at 2b5b284; 7 escaped it
// after the work on the generated set; five of those 7 were then fixed BY
// LOOKING AT THEM (a negation ending at a decimal point, "more out of tune",
// "lost ... accuracy", "accuracy/intonation fell"), which leaves 2 of 16 and
// makes that 2 the only number here that was not tuned against. Those two are
// pinned in tests/ai-guard-fixes.test.js.
const CLOSER_FACTS = SCENARIOS[0].facts;
export const FREEFORM_WRONG = [
  'Compared with Oct 17, the Oct 22 take sits 12.8¢ further out.',
  'The Oct 22 take lost 12.8¢ of accuracy.',
  'Oct 22 is worse by 12.8¢.',
  'The pitch error grew by 12.8¢ since Oct 17.',
  'The error rose 12.8¢ from the Oct 17 take.',
  'The Oct 22 take is 12.8¢ more out of tune.',
  'It slipped by 12.8¢.',
  'The Oct 22 take went backwards by 12.8¢.',
  'You regressed 12.8¢ between the takes.',
  'Accuracy dropped 12.8¢ on Oct 22.',
  'The Oct 22 take is off pitch by 12.8¢ more than the Oct 17 take.',
  'Intonation fell by 12.8¢.',
  'The newer take is not 12.8¢ closer.',
  'You gained nothing: the newer take is 12.8¢ worse.',
  'On Oct 22 you were 12.8¢ more off.',
  'Oct 22 is 12.8¢ behind Oct 17.',
];
export const FREEFORM_RIGHT = [
  'Compared with Oct 17, the Oct 22 take sits 12.8¢ closer.',
  'The Oct 22 take gained 12.8¢ of accuracy.',
  'Oct 22 is better by 12.8¢.',
  'The pitch error shrank by 12.8¢ since Oct 17.',
  'The error fell 12.8¢ from the Oct 17 take.',
  'The Oct 22 take is 12.8¢ more in tune.',
  'It improved by 12.8¢.',
  'The Oct 22 take is not 12.8¢ further.',
  'Accuracy rose 12.8¢ on Oct 22.',
  'Oct 22 is 12.8¢ ahead of Oct 17.',
  'The Oct 22 take is 12.8¢ less out of tune.',
];

// THE UNSEEN TIER. Written at the start of round 3, BEFORE the direction lexicon
// was extended and before the conservative default for unknown words existed,
// from words that appear in no list in guard.js ("dipped", "sagged", "ballooned",
// "dawdled", "frayed"). Adding "smaller" and "sluggish" to the lexicon closes the
// synonym tier above by construction, which says nothing about the next word a
// model or a skeptic reaches for; this is the tier that does. The honest twins
// here are honest and use words the guard has never heard of, so a guard that
// rejects every unknown word beside a measured number is allowed to reject them:
// that is the price of the conservative default, and it is counted, not hidden.
// The words are NOT to be added to the lexicon after the fact.
const UNSEEN_SHAPES = ['The take {W} by {N}.', 'The take {W}: {N} against before.', 'It {W}, {N} from before.'];
const UNSEEN = {
  closer: { wrong: ['sagged', 'slumped', 'dipped', 'tailed off'], right: ['cleaned up', 'came right', 'homed in'] },
  further: { wrong: ['cleaned up', 'came right', 'homed in'], right: ['sagged', 'slumped', 'dipped', 'tailed off'] },
  wider: { wrong: ['pinched in', 'tapered', 'slimmed', 'contracted'], right: ['ballooned', 'flared', 'opened out'] },
  narrower: { wrong: ['ballooned', 'flared', 'opened out'], right: ['pinched in', 'tapered', 'slimmed', 'contracted'] },
  faster: { wrong: ['dawdled', 'crawled', 'plodded'], right: ['hurried', 'sped along', 'snapped to it'] },
  slower: { wrong: ['hurried', 'sped along', 'snapped to it'], right: ['dawdled', 'crawled', 'plodded'] },
  steadier: { wrong: ['jittered', 'quivered', 'frayed'], right: ['calmed', 'firmed up'] },
  shakier: { wrong: ['calmed', 'firmed up'], right: ['jittered', 'quivered', 'frayed'] },
  tighter: { wrong: ['strayed', 'scattered', 'frayed'], right: ['locked in', 'snapped to the beat'] },
  louder: { wrong: ['faded', 'receded'], right: ['swelled', 'boomed'] },
  quieter: { wrong: ['swelled', 'boomed'], right: ['faded', 'receded'] },
};
function unseenSet(sc, words) {
  const out = [];
  for (const w of words ?? []) for (const f of formats(sc)) for (const s of UNSEEN_SHAPES) out.push(s.replace('{N}', f).replace('{W}', w));
  return out;
}

export function buildDirectionSet() {
  const adversarial = [];
  const honest = [];
  for (const sc of SCENARIOS) {
    if (sc.both) {
      for (const r of sc.wrongs) adversarial.push({ scenario: sc.name, facts: sc.facts, reply: r, tier: 'listed' });
      for (const r of sc.rights) honest.push({ scenario: sc.name, facts: sc.facts, reply: r, tier: 'listed' });
      continue;
    }
    for (const r of expand(sc, sc.wrong)) adversarial.push({ scenario: sc.name, facts: sc.facts, reply: r, tier: 'listed' });
    for (const r of expand(sc, sc.right)) honest.push({ scenario: sc.name, facts: sc.facts, reply: r, tier: 'listed' });
    for (const r of expand(sc, sc.wrongX)) adversarial.push({ scenario: sc.name, facts: sc.facts, reply: r, tier: 'synonym' });
    for (const r of expand(sc, sc.rightX)) honest.push({ scenario: sc.name, facts: sc.facts, reply: r, tier: 'synonym' });
    const u = UNSEEN[sc.name];
    if (u) {
      for (const r of unseenSet(sc, u.wrong)) adversarial.push({ scenario: sc.name, facts: sc.facts, reply: r, tier: 'unseen' });
      for (const r of unseenSet(sc, u.right)) honest.push({ scenario: sc.name, facts: sc.facts, reply: r, tier: 'unseen' });
    }
  }
  for (const r of FREEFORM_WRONG) adversarial.push({ scenario: 'freeform', facts: CLOSER_FACTS, reply: r, tier: 'freeform' });
  for (const r of FREEFORM_RIGHT) honest.push({ scenario: 'freeform', facts: CLOSER_FACTS, reply: r, tier: 'freeform' });
  return { adversarial, honest };
}

export async function measure(checkReply) {
  const { adversarial, honest } = buildDirectionSet();
  const run = (c) => checkReply(c.reply, c.facts, '', { takeCount: 2 });
  const escapes = adversarial.filter((c) => run(c).ok);
  const falseRejects = honest.filter((c) => !run(c).ok);
  return { adversarial, honest, escapes, falseRejects };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const given = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const path = given ? new URL(given, `file://${process.cwd()}/`).href : '../../src/ai/guard.js';
  const { checkReply } = await import(path);
  const m = await measure(checkReply);
  const by = {};
  for (const c of m.adversarial) by[c.scenario] = by[c.scenario] ?? { n: 0, esc: 0 };
  for (const c of m.adversarial) by[c.scenario].n += 1;
  for (const c of m.escapes) by[c.scenario].esc += 1;
  console.log(`direction red team, guard ${process.argv[2] ?? 'src/ai/guard.js'}`);
  for (const tier of ['listed', 'synonym', 'freeform', 'unseen']) {
    const a = m.adversarial.filter((c) => c.tier === tier);
    const e = m.escapes.filter((c) => c.tier === tier);
    const h = m.honest.filter((c) => c.tier === tier);
    const f = m.falseRejects.filter((c) => c.tier === tier);
    const p = (n, d) => ((100 * n) / Math.max(1, d)).toFixed(1);
    console.log(`  [${tier}] contradictions ${a.length}  escaped ${e.length} (${p(e.length, a.length)}%)   honest twins ${h.length}  wrongly rejected ${f.length} (${p(f.length, h.length)}%)`);
  }
  for (const [k, v] of Object.entries(by)) console.log(`    ${k.padEnd(12)} ${String(v.esc).padStart(3)} / ${v.n}`);
  if (process.argv.includes('--show')) {
    for (const c of m.escapes.slice(0, 400)) console.log(`  ESCAPED [${c.tier}/${c.scenario}] ${c.reply}`);
    for (const c of m.falseRejects.slice(0, 400)) console.log(`  REJECTED [${c.tier}/${c.scenario}] ${c.reply}`);
  }
}
