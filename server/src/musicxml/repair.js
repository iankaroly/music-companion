// Making an engine's own MusicXML safe to draw, without rewriting it.
//
// The pipeline hands the engine's file through whenever it read the book in one
// pass, because that file carries the engraving — where the systems break,
// where every notehead sits on the page — and re-serialising the parsed model
// would throw all of it away. The cost is that it is the ENGINE's file, and
// Audiveris writes things about a page it could not read that no engraver can
// draw:
//
//   <note><rest measure="yes"/><duration>93</duration></note>
//
// A whole-measure rest of three and seven-eighths quarters, with no <type> to
// say what to draw. VexFlow raises "The provided duration is not valid" and
// refuses THE WHOLE SCORE — so one unreadable bar cost every other bar on the
// page, and a player got an empty panel with no idea why.
//
// The repair is the smallest one that works: those rests are told what they
// are, and nothing else is touched. The durations stay exactly as the engine
// measured them, so the timeline and the alignment see what they always saw.

/** A whole-measure rest with no type: the one thing that breaks engraving. */
const MEASURE_REST = /<note\b[^>]*>[\s\S]*?<\/note>/g;

/**
 * @param {string} xml the engine's MusicXML
 * @returns {{xml:string, repaired:number}}
 */
export function repairForEngraving(xml) {
  if (typeof xml !== 'string' || !xml.includes('measure="yes"')) {
    return { xml, repaired: 0 };
  }
  let repaired = 0;
  const out = xml.replace(MEASURE_REST, (note) => {
    if (!/<rest\b[^>]*measure="yes"/.test(note) || /<type>/.test(note)) return note;
    repaired += 1;
    // A whole rest is what a bar of silence is drawn as, whatever the bar's
    // measured length turned out to be. `<type>` is a drawing instruction; the
    // <duration> beside it is what the music is worth, and that is left alone.
    return note.replace(/<\/note>\s*$/, '  <type>whole</type>\n      </note>');
  });
  return { xml: out, repaired };
}
