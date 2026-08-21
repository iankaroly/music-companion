// Correcting what the recogniser got wrong, in the file itself.
//
// Reading a photograph of a page is not going to be perfect — it finds most of
// the notes and some of them are wrong, and there is no version of that which
// ends in "100%". What there is, is a minute of somebody's time: tap the note
// that is wrong and fix it, and the correction is permanent, because it is
// written into the MusicXML the app keeps.
//
// WHY TEXT AND NOT A DOM. The app has no XML writer and no dependency that
// brings one, and a browser's DOMParser cannot be used in the tests. So an edit
// is surgery on the file's own text, addressed by the id every note already
// carries — `${partId}-m${measureIndex}-n${noteIndex}` — which is exactly the
// three coordinates needed to find one: which part, which bar of it, which note
// of that bar. Everything outside the note being edited is left byte for byte
// as it was, so the engraving, the layout and every other note survive an edit
// untouched.

/** The three coordinates in a note's id, or null if it is not one. */
export function addressOf(noteId) {
  const found = /^(.+)-m(\d+)-n(\d+)$/.exec(String(noteId ?? ''));
  if (!found) return null;
  return { partId: found[1], measure: Number(found[2]), note: Number(found[3]) };
}

/** The span of `<tag ...> … </tag>` blocks in a string, in document order. */
function blocks(xml, tag) {
  const out = [];
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'g');
  let match = open.exec(xml);
  while (match) {
    const from = match.index;
    const close = xml.indexOf(`</${tag}>`, open.lastIndex);
    if (close === -1) break;
    const to = close + `</${tag}>`.length;
    out.push({ from, to, text: xml.slice(from, to) });
    open.lastIndex = to;
    match = open.exec(xml);
  }
  return out;
}

/** Where in `xml` the note with this id lives, or null. */
export function findNote(xml, noteId) {
  const at = addressOf(noteId);
  if (!at) return null;
  const part = blocks(xml, 'part')
    .find((p) => new RegExp(`<part\\s+id="${at.partId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(p.text));
  if (!part) return null;
  const measure = blocks(part.text, 'measure')[at.measure];
  if (!measure) return null;
  const note = blocks(measure.text, 'note')[at.note];
  if (!note) return null;
  const from = part.from + measure.from + note.from;
  return { from, to: from + note.text.length, text: note.text };
}

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// Quarters per note type, and the type per quarters, for making a note longer
// or shorter. Only the plain values: a dotted note is halved to a plain one,
// which is a change somebody asked for rather than a surprise.
const TYPES = [
  ['whole', 4], ['half', 2], ['quarter', 1], ['eighth', 0.5],
  ['16th', 0.25], ['32nd', 0.125], ['64th', 0.0625],
];

const textIn = (xml, tag) => {
  const found = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml);
  return found ? found[1].trim() : null;
};

function setText(xml, tag, value) {
  const has = new RegExp(`(<${tag}(?:\\s[^>]*)?>)([^<]*)(</${tag}>)`);
  return has.test(xml) ? xml.replace(has, `$1${value}$3`) : xml;
}

/** The divisions in force — the last one declared at or before this point. */
export function divisionsAt(xml, offset) {
  let divisions = 1;
  const all = /<divisions(?:\s[^>]*)?>(\d+)<\/divisions>/g;
  let match = all.exec(xml);
  while (match && match.index < offset) {
    divisions = Number(match[1]);
    match = all.exec(xml);
  }
  return divisions || 1;
}

/**
 * Move a pitched note up or down.
 *
 * `steps` counts lines and spaces, which is what a player means by "that one is
 * a step too low" and what the eye checks against the page — semitones are the
 * wrong unit for a mistake in reading a stave. An accidental is a separate
 * change: see `alter`.
 */
function movePitch(note, steps) {
  const step = textIn(note, 'step');
  const octave = Number(textIn(note, 'octave'));
  if (!step || !Number.isFinite(octave)) return note;
  const at = STEPS.indexOf(step.toUpperCase());
  if (at === -1) return note;
  const moved = at + steps;
  const shift = Math.floor(moved / STEPS.length);
  const landed = ((moved % STEPS.length) + STEPS.length) % STEPS.length;
  return setText(setText(note, 'step', STEPS[landed]), 'octave', String(octave + shift));
}

/** Sharpen or flatten. Removes the accidental when it comes back to natural. */
function alter(note, by) {
  const current = Number(textIn(note, 'alter') ?? 0);
  const wanted = Math.max(-2, Math.min(2, current + by));
  if (wanted === 0) {
    return note.replace(/\s*<alter(?:\s[^>]*)?>[^<]*<\/alter>/, '');
  }
  if (textIn(note, 'alter') !== null) return setText(note, 'alter', String(wanted));
  // MusicXML wants <alter> between <step> and <octave>.
  return note.replace(/(<\/step>)/, `$1<alter>${wanted}</alter>`);
}

/** Halve or double what the note is worth, type and duration together. */
function stretch(note, factor, divisions) {
  const duration = Number(textIn(note, 'duration'));
  if (!Number.isFinite(duration) || duration <= 0) return note;
  const wanted = Math.max(1, Math.round(duration * factor));
  const quarters = wanted / divisions;
  const type = TYPES.reduce((best, entry) => (
    Math.abs(entry[1] - quarters) < Math.abs(best[1] - quarters) ? entry : best
  ), TYPES[0]);
  let out = setText(note, 'duration', String(wanted));
  out = textIn(out, 'type') !== null
    ? setText(out, 'type', type[0])
    : out.replace(/(<\/duration>)/, `$1<type>${type[0]}</type>`);
  // A dot is a lie once the length has been set outright.
  return out.replace(/\s*<dot\s*\/>/g, '').replace(/\s*<dot><\/dot>/g, '');
}

/**
 * Apply one correction to a score.
 *
 * @param {string} xml the score
 * @param {string} noteId as parsed notes carry it
 * @param {{steps?:number, alter?:number, longer?:boolean, shorter?:boolean,
 *          rest?:boolean, remove?:boolean}} change
 * @returns {{xml:string, changed:boolean, what:string}}
 */
export function editNote(xml, noteId, change) {
  const found = findNote(xml, noteId);
  if (!found) return { xml, changed: false, what: 'that note is not in this score' };
  const before = found.text;
  let note = before;
  let what = '';

  if (change.remove) {
    // The bar keeps its length: what was a note becomes a rest of the same
    // length, so nothing after it moves. Deleting the time as well is a
    // different edit and a much easier one to make by accident.
    note = note.replace(/<pitch>[\s\S]*?<\/pitch>/, '<rest/>')
      .replace(/<notations>[\s\S]*?<\/notations>/, '');
    if (!/<rest\s*\/>|<rest>/.test(note)) return { xml, changed: false, what: 'that is already a rest' };
    what = 'taken out';
  } else if (change.steps) {
    if (!/<pitch>/.test(note)) return { xml, changed: false, what: 'a rest has no pitch to move' };
    note = movePitch(note, change.steps);
    what = change.steps > 0 ? 'up' : 'down';
  } else if (change.alter) {
    if (!/<pitch>/.test(note)) return { xml, changed: false, what: 'a rest cannot be sharpened' };
    note = alter(note, change.alter);
    what = change.alter > 0 ? 'sharper' : 'flatter';
  } else if (change.longer || change.shorter) {
    note = stretch(note, change.longer ? 2 : 0.5, divisionsAt(xml, found.from));
    what = change.longer ? 'longer' : 'shorter';
  } else {
    return { xml, changed: false, what: 'nothing to change' };
  }

  if (note === before) return { xml, changed: false, what: 'nothing changed' };
  return { xml: xml.slice(0, found.from) + note + xml.slice(found.to), changed: true, what };
}
