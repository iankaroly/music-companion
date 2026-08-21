// Making a score safe to draw, whoever wrote it and whenever.
//
// An engraver refuses a WHOLE score over one note it cannot draw — VexFlow
// answers "The provided duration is not valid" and nothing appears — so a
// single bar a recogniser measured badly costs every other bar on the page.
// The pipeline stopped writing those (server/src/musicxml/repair.js and the
// tick floor in serialise.js), but a score read before that is already in
// somebody's library, and a file imported from anywhere else has never been
// through either.
//
// So it is repaired here as well, on the way to the engraver: the last place
// every score passes through, whatever door it came in by. Nothing is
// corrected that can be drawn as it stands.

/** A note with a duration of nothing, and a whole-measure rest with no type. */
const NOTE = /<note\b[^>]*>[\s\S]*?<\/note>/g;

/**
 * @param {string} xml
 * @returns {{xml:string, repaired:number}}
 */
export function repairForEngraving(xml) {
  if (typeof xml !== 'string' || !xml.includes('<note')) return { xml, repaired: 0 };
  let repaired = 0;
  const out = xml.replace(NOTE, (note) => {
    // A grace note carries no duration at all, and that is what makes it one.
    if (/<grace\b/.test(note)) return note;
    let fixed = note;

    // A note of no length. It takes no time, says nothing about pitch, and is
    // what the engraver chokes on: a bar the reader measured as a hundredth of
    // a quarter rounds to this.
    fixed = fixed.replace(/<duration>\s*0+\s*<\/duration>/, () => {
      repaired += 1;
      return '<duration>1</duration>';
    });

    // A whole-measure rest with no type: legal MusicXML, undrawable by an
    // engraver that wants to know which rest to draw.
    if (/<rest\b[^>]*measure="yes"/.test(fixed) && !/<type>/.test(fixed)) {
      repaired += 1;
      fixed = fixed.replace(/<\/note>\s*$/, '<type>whole</type></note>');
    }
    return fixed;
  });
  return { xml: out, repaired };
}
