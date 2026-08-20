// The score model -> MusicXML.
//
// WHY THIS EXISTS: an engine that reads one page at a time returns one document
// per page, each of which believes it is a whole piece starting at bar 1. The
// person who scanned a twelve-page part wants ONE file they can open in
// MuseScore — not page 1, and not twelve files to paste together by hand.
//
// So a multi-page conversion is written out from the joined model instead. That
// is a real trade and worth being explicit about: the file is then OURS, not
// the engine's. Anything the model does not carry — beams, slurs, stem
// directions, ornaments, dynamics, the engine's own layout hints — is not in
// it, because it was never parsed. What is in it is every note, its pitch, its
// length, its voice and staff, the bar it belongs to, and the key, time, clef
// and repeat structure around it. That is what a player needs to correct the
// rhythm in MuseScore and re-upload, and it is exactly what the alignment API
// works from.
//
// When the engine gave us a single document, the pipeline keeps THAT file
// instead and never comes here. Provenance beats round-tripping when both are
// available.

/**
 * Ticks per quarter note used in the output.
 *
 * 768 = 2^8 x 3, so halves, quarters, eighths down to 256ths AND triplets,
 * sextuplets and dotted anything all land on whole numbers. A duration that
 * still does not is rounded, and rounding a hundredth of a beat is invisible;
 * choosing a divisions value that cannot express a triplet is not.
 */
const DIVISIONS = 768;

const TYPE_BY_QUARTERS = [
  [8, 'breve'], [4, 'whole'], [2, 'half'], [1, 'quarter'], [0.5, 'eighth'],
  [0.25, '16th'], [0.125, '32nd'], [0.0625, '64th'], [0.03125, '128th'],
];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const ticks = (quarters) => Math.max(0, Math.round(quarters * DIVISIONS));

/** The written note type closest to a duration, for a score that has none. */
function typeFor(quarters) {
  if (!(quarters > 0)) return null;
  let best = TYPE_BY_QUARTERS[0];
  let bestGap = Infinity;
  for (const entry of TYPE_BY_QUARTERS) {
    // Compare against the plain and the dotted length of each type.
    for (const length of [entry[0], entry[0] * 1.5]) {
      const gap = Math.abs(length - quarters);
      if (gap < bestGap) { bestGap = gap; best = entry; }
    }
  }
  return best[1];
}

function noteXml(note, lines) {
  lines.push('      <note>');
  // <grace> comes before <chord> in the DTD's order, and only matters when a
  // grace note is part of a chord — but a reader that validates will refuse the
  // file over it, so it costs nothing to be right.
  if (note.grace) lines.push('        <grace/>');
  if (note.chord) lines.push('        <chord/>');
  if (note.rest) lines.push('        <rest/>');
  else if (note.pitch) {
    lines.push('        <pitch>');
    lines.push(`          <step>${escape(note.pitch.step)}</step>`);
    if (note.pitch.alter) lines.push(`          <alter>${note.pitch.alter}</alter>`);
    lines.push(`          <octave>${note.pitch.octave}</octave>`);
    lines.push('        </pitch>');
  } else {
    // A note the engine found but could not name. It still takes time, and a
    // rest of the right length keeps every bar after it in the right place —
    // which matters far more to an alignment than the pitch of one note.
    lines.push('        <rest/>');
  }

  // Grace notes carry no <duration> — that is what makes them grace notes.
  if (!note.grace) lines.push(`        <duration>${ticks(note.durationQuarters)}</duration>`);

  if (note.tieStop) lines.push('        <tie type="stop"/>');
  if (note.tieStart) lines.push('        <tie type="start"/>');

  lines.push(`        <voice>${escape(note.voice ?? '1')}</voice>`);
  const type = note.type ?? typeFor(note.durationQuarters);
  if (type) lines.push(`        <type>${escape(type)}</type>`);
  for (let i = 0; i < (note.dots ?? 0); i += 1) lines.push('        <dot/>');
  if (note.staff && note.staff !== 1) lines.push(`        <staff>${note.staff}</staff>`);

  if (note.tieStart || note.tieStop) {
    lines.push('        <notations>');
    if (note.tieStop) lines.push('          <tied type="stop"/>');
    if (note.tieStart) lines.push('          <tied type="start"/>');
    lines.push('        </notations>');
  }
  lines.push('      </note>');
}

/**
 * Serialise a parsed score back to MusicXML text.
 *
 * @param {object} score from parseMusicXml / joinScores
 * @param {{software?:string}} [options]
 * @returns {string}
 */
export function scoreToMusicXml(score, options = {}) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
    + '"http://www.musicxml.org/dtds/partwise.dtd">');
  lines.push('<!-- Written from the recognised score, page by page joined into one. '
    + 'Notes, rhythm, keys, times, clefs and repeats only: engraving was never parsed. -->');
  lines.push('<score-partwise version="4.0">');

  if (score.title) {
    lines.push('  <work>');
    lines.push(`    <work-title>${escape(score.title)}</work-title>`);
    lines.push('  </work>');
  }
  lines.push('  <identification>');
  if (score.composer) lines.push(`    <creator type="composer">${escape(score.composer)}</creator>`);
  lines.push('    <encoding>');
  lines.push(`      <software>${escape(options.software ?? 'score-pipeline')}</software>`);
  lines.push('    </encoding>');
  lines.push('  </identification>');

  lines.push('  <part-list>');
  for (const part of score.parts) {
    lines.push(`    <score-part id="${escape(part.id)}">`);
    lines.push(`      <part-name>${escape(part.name ?? part.id)}</part-name>`);
    if (part.instrument) {
      lines.push(`      <score-instrument id="${escape(part.id)}-I1">`);
      lines.push(`        <instrument-name>${escape(part.instrument)}</instrument-name>`);
      lines.push('      </score-instrument>');
    }
    lines.push('    </score-part>');
  }
  lines.push('  </part-list>');

  for (const part of score.parts) {
    lines.push(`  <part id="${escape(part.id)}">`);
    let previous = null;

    for (const measure of part.measures) {
      lines.push(`    <measure number="${escape(measure.number)}"${measure.implicit ? ' implicit="yes"' : ''}>`);

      // Page and system breaks, so a reader can lay it out as it was scanned.
      const page = measure.layout?.page ?? 1;
      const system = measure.layout?.system ?? 1;
      if (!previous) lines.push(`      <print page-number="${page}"/>`);
      else if (page !== (previous.layout?.page ?? 1)) lines.push(`      <print new-page="yes" page-number="${page}"/>`);
      else if (system !== (previous.layout?.system ?? 1)) lines.push('      <print new-system="yes"/>');

      // Attributes, written only when they change — the way MusicXML expects.
      const attributes = [];
      if (!previous) attributes.push(`        <divisions>${DIVISIONS}</divisions>`);
      const key = measure.key ?? { fifths: 0 };
      if (!previous || key.fifths !== (previous.key?.fifths ?? 0)) {
        attributes.push('        <key>');
        attributes.push(`          <fifths>${key.fifths ?? 0}</fifths>`);
        if (key.mode) attributes.push(`          <mode>${escape(key.mode)}</mode>`);
        attributes.push('        </key>');
      }
      const time = measure.time ?? { beats: 4, beatType: 4 };
      if (!previous || time.beats !== previous.time?.beats || time.beatType !== previous.time?.beatType) {
        attributes.push('        <time>');
        attributes.push(`          <beats>${time.beats}</beats>`);
        attributes.push(`          <beat-type>${time.beatType}</beat-type>`);
        attributes.push('        </time>');
      }
      const clefsChanged = JSON.stringify(measure.clefs ?? []) !== JSON.stringify(previous?.clefs ?? null);
      if (measure.clefs?.length && clefsChanged) {
        if (measure.staves > 1) attributes.push(`        <staves>${measure.staves}</staves>`);
        for (const clef of measure.clefs) {
          attributes.push(`        <clef${measure.clefs.length > 1 ? ` number="${clef.staff}"` : ''}>`);
          attributes.push(`          <sign>${escape(clef.sign)}</sign>`);
          attributes.push(`          <line>${clef.line}</line>`);
          if (clef.octaveChange) attributes.push(`          <clef-octave-change>${clef.octaveChange}</clef-octave-change>`);
          attributes.push('        </clef>');
        }
      }
      if (attributes.length) {
        lines.push('      <attributes>');
        lines.push(...attributes);
        lines.push('      </attributes>');
      }

      if (measure.barlines?.repeatForward) {
        lines.push('      <barline location="left"><bar-style>heavy-light</bar-style>'
          + '<repeat direction="forward"/></barline>');
      }
      for (const ending of measure.barlines?.endings ?? []) {
        if (ending.location !== 'left') continue;
        lines.push(`      <barline location="left"><ending number="${ending.numbers.join(',')}" `
          + `type="${escape(ending.type)}"/></barline>`);
      }

      // A note of zero length is not a note. OMR produces them — a rest with
      // <duration>0</duration> and no type came back from a real scan — and
      // they take no time, carry no pitch, and make a strict reader refuse the
      // whole file ("The provided duration is not valid"). Dropping them
      // changes nothing about when anything sounds.
      const playable = measure.notes.filter((n) => n.grace || n.durationQuarters > 0);

      // A bar with nothing left in it still has to occupy its time, or every
      // bar after it moves. That is what a whole-measure rest is for.
      if (playable.length === 0) {
        lines.push('      <note>');
        lines.push('        <rest measure="yes"/>');
        lines.push(`        <duration>${ticks(measure.durationQuarters || measure.nominalQuarters || 4)}</duration>`);
        lines.push('        <voice>1</voice>');
        lines.push('      </note>');
        lines.push('    </measure>');
        previous = measure;
        continue;
      }

      // The notes, in the order they were read — which is the order MusicXML
      // requires, with a <backup> whenever a voice starts again earlier in the
      // bar than the cursor has reached.
      let cursor = 0;
      for (const note of playable) {
        const start = note.measureQuarter;
        if (ticks(start) < ticks(cursor) && !note.chord) {
          lines.push('      <backup>');
          lines.push(`        <duration>${ticks(cursor) - ticks(start)}</duration>`);
          lines.push('      </backup>');
          cursor = start;
        } else if (ticks(start) > ticks(cursor)) {
          lines.push('      <forward>');
          lines.push(`        <duration>${ticks(start) - ticks(cursor)}</duration>`);
          lines.push('      </forward>');
          cursor = start;
        }
        noteXml(note, lines);
        if (!note.chord && !note.grace) cursor = start + note.durationQuarters;
      }

      const rightEndings = (measure.barlines?.endings ?? []).filter((e) => e.location !== 'left');
      if (measure.barlines?.repeatBackward || rightEndings.length) {
        lines.push('      <barline location="right">');
        lines.push('        <bar-style>light-heavy</bar-style>');
        for (const ending of rightEndings) {
          lines.push(`        <ending number="${ending.numbers.join(',')}" type="${escape(ending.type)}"/>`);
        }
        if (measure.barlines?.repeatBackward) {
          const times = measure.barlines.repeatTimes;
          lines.push(`        <repeat direction="backward"${times && times !== 2 ? ` times="${times}"` : ''}/>`);
        }
        lines.push('      </barline>');
      }

      lines.push('    </measure>');
      previous = measure;
    }
    lines.push('  </part>');
  }

  lines.push('</score-partwise>');
  return `${lines.join('\n')}\n`;
}

/**
 * Put a title into MusicXML that already exists, changing nothing else.
 *
 * The pipeline hands back the engine's own file whenever it read the whole
 * score in one go — that provenance is worth keeping. But oemer names every
 * score after the image it was given, so the file a player opens is called
 * "Page-001", and that is not a title, it is a temporary filename. Rewriting
 * that ONE element is a fair trade: every note, every mark and every layout
 * hint the engine wrote is untouched.
 *
 * @param {string} xml
 * @param {string} title
 * @returns {string}
 */
export function withTitle(xml, title) {
  if (!title) return xml;
  const escaped = escape(title);

  if (/<work-title>[\s\S]*?<\/work-title>/.test(xml)) {
    return xml.replace(/<work-title>[\s\S]*?<\/work-title>/, `<work-title>${escaped}</work-title>`);
  }
  if (/<work>\s*<\/work>/.test(xml)) {
    return xml.replace(/<work>\s*<\/work>/, `<work><work-title>${escaped}</work-title></work>`);
  }
  // No <work> at all: it goes first inside <score-partwise>, where the schema
  // puts it. If the root tag cannot be found, leave the document alone rather
  // than write something that will not parse.
  const root = xml.match(/<score-partwise[^>]*>/);
  if (!root) return xml;
  return xml.replace(root[0], `${root[0]}\n  <work><work-title>${escaped}</work-title></work>`);
}
