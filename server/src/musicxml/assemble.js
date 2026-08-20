// Joining one MusicXML document per page into one score.
//
// Engines that read a page at a time (oemer, and any model-based OMR) return N
// separate documents, each of which thinks it is a whole piece starting at bar
// 1. Downstream, none of that can be true: measure numbers must run through,
// every note needs a unique id, and the quarter clock must be continuous or the
// alignment will restart at every page turn.
//
// Joining is done on the PARSED model, not on the XML text, because merging two
// XML documents correctly means reconciling their <divisions>, their key and
// their time signature anyway — which is exactly what parsing already did.
//
// Parts are matched by position, not by id: oemer names every part "P1", so
// matching by id would fold a two-stave piano score into one stave.

const q = (value) => Math.round(value * 1e6) / 1e6;

/**
 * @param {object[]} scores parsed scores, in page order
 * @param {{renumberMeasures?:boolean}} [options]
 * @returns {object} one score
 */
export function joinScores(scores, options = {}) {
  const usable = scores.filter((s) => s && s.parts.length);
  if (usable.length === 0) throw new Error('nothing to join — every page failed to parse');
  if (usable.length === 1) return usable[0];

  const partCount = Math.max(...usable.map((s) => s.parts.length));
  const partCounts = [...new Set(usable.map((s) => s.parts.length))].sort((a, b) => a - b);

  // PARTS MUST STAY IN LOCKSTEP. In a partwise score, measure N of every part
  // is the same bar of music. Pages disagree about how many parts they hold —
  // Audiveris returns a photographed page as two parts, the engine that rescued
  // the next page returns one — and simply concatenating what each page had
  // leaves a 230-bar part beside a 120-bar one, where bar 5 of the two is not
  // the same moment. That is wrong in the model, not merely untidy in the file:
  // OpenSheetMusicDisplay renders such a score truncated to the SHORTEST part
  // and says nothing.
  //
  // So a page that is missing a part contributes SILENT BARS to it, matching
  // the bars the page's other parts brought.
  const parts = Array.from({ length: partCount }, () => ({ measures: [], tempoMarks: [] }));
  const identity = Array.from({ length: partCount }, (_, i) => usable.find((s) => s.parts[i])?.parts[i]);
  let clock = 0;

  for (const page of usable) {
    const reference = page.parts[0];
    const startIndex = parts[0].measures.length;

    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const source = page.parts[partIndex];
      const measures = source ? source.measures : reference.measures.map(silentCopy);
      let localClock = clock;

      for (const [offset, measure] of measures.entries()) {
        const index = startIndex + offset;
        const startQuarter = q(localClock);
        // Re-stamp the ids: they encode the measure index, and two pages both
        // holding a "m0" would make an alignment ambiguous about which bar it
        // was pointing at.
        const notes = measure.notes.map((note, noteIndex) => ({
          ...note,
          id: `${identity[partIndex]?.id ?? `P${partIndex + 1}`}-m${index}-v${note.voice}-n${noteIndex}`,
          measureIndex: index,
          startQuarter: q(startQuarter + note.measureQuarter),
        }));
        parts[partIndex].measures.push({
          ...measure,
          index,
          number: options.renumberMeasures === false ? measure.number : String(index + 1),
          startQuarter,
          notes,
        });
        localClock = q(localClock + measure.durationQuarters);
      }

      if (source) {
        for (const mark of source.tempoMarks) {
          parts[partIndex].tempoMarks.push({ ...mark, measureIndex: startIndex + mark.measureIndex });
        }
      }
    }

    // Every part advanced over the same bars, so one clock serves them all.
    clock = q(clock + reference.measures.reduce((n, m) => n + m.durationQuarters, 0));
  }

  const joined = parts.map((part, partIndex) => ({
    ...(identity[partIndex] ?? {}),
    id: identity[partIndex]?.id ?? `P${partIndex + 1}`,
    index: partIndex,
    measures: part.measures,
    tempoMarks: part.tempoMarks,
    totalQuarters: q(clock),
  }));

  return {
    ...usable[0],
    parts: joined,
    totalQuarters: q(clock),
    measureCount: Math.max(...joined.map((p) => p.measures.length)),
    joinedFrom: usable.length,
    // Recorded even though the parts are now the same length, because it says
    // the OMR disagreed with itself across pages — which is worth knowing when
    // a part turns out to be half silence.
    partCountMismatch: partCounts.length > 1 ? partCounts : null,
  };
}

/** The same bar, with the music taken out: it keeps its place and its length. */
function silentCopy(measure) {
  return {
    ...measure,
    notes: [],
    noteCount: 0,
    irregular: false,
  };
}
