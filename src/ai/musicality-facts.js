// Musicality measurements as plain sentences, in the same shape as facts.js.
//
// Same contract: a fact is a string with its numbers already in it, so the
// guard can read them back out and a model's reply can only repeat numbers a
// function here wrote. Nothing in this file measures anything — src/analysis/
// musicality.js did that — and nothing in it grades. A descriptor that could
// not be measured is said so, once, with its reason, and never turned into a
// default.
//
// Wording rule, because the guard reads every digit: no digits inside the
// descriptive words ("16th", "2nd" would be numbers the measurements never
// held). Counts of notes are spelled out in the phrases in musicality.js, and
// every figure is written through round0/round1 here, as in facts.js.

import { compareMusicality } from '../analysis/musicality.js';

const round0 = (v) => Math.round(v);
const round1 = (v) => (Math.round(v * 10) / 10).toString();

function label(take) {
  return take.name?.trim() || new Date(take.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function when(take) {
  return new Date(take.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// For the router: questions that are about shaping and not about pitch. Kept
// here beside the sentences they lead to; wiring it in is one line in router.js.
export const MUSICALITY_PATTERN = /musical|phras|express|articulat|legato|staccato|detach|connected|smooth|rubato|tempo (flex|give|free)|shap(e|ing)|contrast|swell|crescendo|diminuendo|character|mechanical|robotic|stiff|alike|consisten|same way|leaning|vibrato (start|open|grow)|interpret/;

// A line for assistant.js INSTRUCTIONS when these facts are in the prompt.
export const MUSICALITY_INSTRUCTION = 'Musicality measurements describe how a take is shaped, not how good it is. Say what was measured and what changed. Never say a take is more musical, better phrased, more expressive or has a nicer tone, and never give advice about taste.';

export const CAVEAT = 'These describe the shaping of the playing from what could be measured; they are not a judgement of taste or of how beautiful the tone is.';

const GROUPS = {
  phrasing: ['phrase-count', 'phrase-definition', 'phrase-shape', 'phrase-contrast', 'stretch-contrast', 'phrase-final-lengthening'],
  articulation: ['articulation', 'articulation-evenness'],
  tempo: ['tempo-flexibility', 'tempo-shape', 'phrase-final-lengthening'],
  repeats: ['repeat-timing', 'repeat-loudness'],
  expression: ['vibrato-growth', 'pitch-lean'],
};

// Which groups a question is about; none named means all of them.
export function topicsOf(question) {
  const q = String(question ?? '').toLowerCase();
  const found = [];
  if (/phras|contrast|shap|swell|crescendo|diminuendo|dynamic|loud|arch/.test(q)) found.push('phrasing');
  if (/articulat|legato|staccato|detach|connected|smooth/.test(q)) found.push('articulation');
  if (/tempo|rubato|rush|drag|free|stiff|rigid|steady/.test(q)) found.push('tempo');
  if (/alike|consisten|same way|repeat|again/.test(q)) found.push('repeats');
  if (/vibrato|leaning|express/.test(q)) found.push('expression');
  return found.length ? found : Object.keys(GROUPS);
}

function show(d) {
  const v = d.value;
  if (d.key === 'articulation' || d.key === 'articulation-evenness') return `${round0(v * 100)}%`;
  if (d.unit === 'dB') return `${round1(v)} dB`;
  if (d.unit === '×') return `${round1(v)}×`;
  if (d.unit === '¢') return `${round1(v)}¢`;
  if (d.unit === '%') return `${round0(v)}%`;
  return round1(v);
}

const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Why a take could not be trusted, in the take's own words. The first three are
// reasons the shaping was not read (or only its legato-or-detached part was);
// the last only lowers confidence.
function noisyNote(take, m) {
  const r = m.reliability;
  const name = label(take);
  const lines = [];
  if (r.reason === 'quiet') {
    lines.push(`Only about ${round0(r.coverage * 100)}% of the sound in "${name}" was heard as notes (${m.noteCount} notes), so most of this take was too quiet or too unclear to hear and how it is shaped could not be measured.`);
  } else if (r.reason === 'junk') {
    lines.push(`The notes heard in "${name}" jump about by a median of ${round0(r.medianStep)} semitones from one to the next and the steps hardly ever come round again, which is rare in a tune and usually means the pitch tracker was misreading it, so this take could not be read well: only whether the notes run together or are separated is given, from the longer notes, and the rest of how it is shaped was not measured.`);
  } else if (r.reason === 'fragments') {
    lines.push(`${round0(r.shortNoteShare * 100)}% of the notes heard in "${name}" were very short, which usually means the pitch was misread (double stops and very fast runs do this), so this take could not be read well: only whether the notes run together or are separated is given, from the longer notes, and the rest of how it is shaped was not measured.`);
  }
  if (r.outOfRange) {
    lines.push(`${round0(r.outOfRangeShare * 100)}% of the notes heard in "${name}" fell outside the range of the instrument, which usually means the pitch was read an octave off, so treat what follows as rough.`);
  }
  return lines;
}

// Facts for one take. `take.musicality` is the result of musicalityOf.
export function musicalityFacts(take, { question = '', max = 8 } = {}) {
  const m = take.musicality;
  if (!m) return [`The shaping of "${label(take)}" (phrasing, articulation, tempo) could not be measured.`];

  const wanted = new Set(topicsOf(question).flatMap((g) => GROUPS[g]));
  const out = [];
  const c = m.descriptors.character;
  if (m.reliability?.noisy) out.push(...noisyNote(take, m));
  if (m.reliability?.unreadable) {
    // Nothing else is said: a description of a take that was not heard is a description of the misreading.
    return [out[0], CAVEAT];
  }
  if (m.onePitch) out.push(`Every note in "${label(take)}" is the same pitch, so there is no phrase-level reading of it; only its timing and articulation are described.`);
  if (c?.measured) {
    out.push(sentence(`"${label(take)}" (${when(take)}) reads as ${c.phrase}`));
  }
  const measured = Object.values(m.descriptors).filter((d) => d.measured && d.key !== 'character' && wanted.has(d.key));
  for (const d of measured.slice(0, max)) {
    const base = `In "${label(take)}", ${d.phrase}`;
    // A take already flagged as misheard says so once, above; its low confidence
    // is not about how many things the number was counted from.
    const lightly = m.reliability?.noisy ? ' (take it lightly)' : ` (based on only ${d.n}, so take it lightly)`;
    out.push(sentence(d.confidence === 'low' ? `${base}${lightly}` : base));
  }
  const missing = Object.values(m.descriptors).filter((d) => !d.measured && d.key !== 'character' && wanted.has(d.key));
  if (measured.length === 0) {
    out.length = 0;
    out.push(`Too little of "${label(take)}" could be read to describe how it is shaped (${missing[0]?.reason ?? c?.reason ?? 'not enough notes'}).`);
  } else if (missing.length) {
    // The same reason often covers several descriptors; say each reason once.
    const reasons = [...new Set(missing.map((d) => d.reason))].slice(0, 2);
    out.push(`Not measured for "${label(take)}": ${missing.slice(0, 4).map((d) => d.label).join(', ')} (${reasons.join('; ')}).`);
  }
  out.push(CAVEAT);
  return out;
}

// a is the newer take, as in facts.js compareFacts.
export function compareMusicalityFacts(a, b, { question = '', max = 6 } = {}) {
  if (!a.musicality || !b.musicality) {
    return ['The shaping of both takes could not be measured, so I cannot compare how they are phrased.'];
  }
  const same = label(a) === label(b);
  const la = same ? `${label(a)}, ${when(a)}` : label(a);
  const lb = same ? `${label(b)}, ${when(b)}` : label(b);
  const wanted = new Set(topicsOf(question).flatMap((g) => GROUPS[g]));
  const rows = compareMusicality(b.musicality, a.musicality).filter((r) => wanted.has(r.key));
  const real = rows.filter((r) => r.verdict !== 'unmeasured' && r.verdict !== 'about the same');
  const out = [];
  for (const t of [a, b]) if (t.musicality.reliability?.noisy) out.push(...noisyNote(t, t.musicality));
  for (const r of real.slice(0, max)) {
    const d = (a.musicality.descriptors[r.key] ?? b.musicality.descriptors[r.key]);
    const before = show({ ...d, value: r.before });
    const after = show({ ...d, value: r.after });
    // The verdict is a phrase on its own ("more detached", "matching five-note
    // patterns played less alike in timing"), so it goes in brackets rather than after a verb it
    // would not fit. These sentences reach the player as they stand when no
    // model is available.
    out.push(`${cap(r.label)}: "${lb}" ${before}, "${la}" ${after} (${r.verdict} in "${la}").`);
  }
  if (real.length === 0) {
    out.push(`"${la}" and "${lb}" are shaped about the same on everything that could be measured in both.`);
  }
  const skipped = rows.filter((r) => r.verdict === 'unmeasured');
  if (skipped.length) {
    out.push(`Could not be compared because it was not measured in both takes: ${skipped.slice(0, 4).map((r) => r.label).join(', ')}.`);
  }
  // No row says which way is better. Whether two matching five-note patterns
  // should be played alike is for the player and the teacher to say.
  out.push(CAVEAT);
  return out;
}
