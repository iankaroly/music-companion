// Joining our reading of the score to the engraver's reading of the same file.
//
// Two parsers read the same MusicXML and produce two different lists, ON
// PURPOSE. Ours is the stream a player plays: chord members dropped, second
// voices skipped, ties collapsed into one sounding note, grace notes given no
// duration, repeats written out twice. The engraver's is what goes on the page:
// every notehead once, in notated order. Walking the two lists side by side
// would work on a scale and put every annotation one notehead out on anything
// real.
//
// So they are matched by what a note IS — which bar, which beat of it, which
// pitch. That is enough to be unambiguous, and it degrades honestly: a note
// that finds no notehead is reported rather than guessed at, because an
// annotation on the wrong note is worse than no annotation at all.

// Beats arrive as thirds and sevenths of a bar from one side and as decimals
// from the other; 1/3 must not miss 0.33333333333.
function keyOf(measure, beatInMeasure, midi) {
  return `${measure}|${Math.round(beatInMeasure * 960)}|${midi}`;
}

export function reconcile(scoreNotes, engravedNotes) {
  const available = new Map();
  for (const note of engravedNotes ?? []) {
    const key = keyOf(note.measure, note.beatInMeasure, note.midi);
    if (!available.has(key)) available.set(key, []);
    available.get(key).push(note);
  }

  const map = new Map();
  const unmatched = [];

  for (const note of scoreNotes ?? []) {
    // A repeated bar is played twice and drawn once, so the second pass wants
    // the notehead the first pass already found — not a second one.
    if (map.has(note.id)) continue;

    const candidates = available.get(keyOf(note.measure, note.beatInMeasure, note.midi));
    const found = candidates?.shift();
    if (found) map.set(note.id, found);
    else unmatched.push(note.id);
  }

  return { map, unmatched, ok: unmatched.length === 0 };
}
