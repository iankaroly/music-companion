// The join between a notehead on a photograph and a moment in the recording.
//
// Both halves of this have existed for a while and nothing put them together.
// scan-view.js:pairNotes says WHICH notehead each played note landed on — by
// pitch through alignScore where the page read its own clef, by contour
// through findStart where it did not. notes.js:closeCurrent says WHEN each
// played note happened: `start` and `end`, in seconds in the recording. So the
// answer to "when was this notehead played" is one hop through the pairing and
// the answer to "which notehead is sounding now" is the same hop backwards,
// and neither was available to anything.
//
// What that unlocks is the whole point of the scanned side: follow-along on a
// photograph (score-view.js already does it on engraved SVG — `paint` lights
// the sounding notehead off exactly this kind of map), click-a-notehead-to-hear
// -that-moment (buildEmphasizedClip wants targetStart and targetEnd in
// recording seconds, which is what this hands out), and a playhead that means
// something on a page made of pixels.
//
// WHAT THIS MODULE REFUSES TO DO, AND WHY
//
// It does not align. It is handed a pairing and joins it to time. Putting an
// alignment in here would be the second copy of alignByPitch in the tree, and
// the two would drift; worse, it would hide the one thing a caller most needs
// to see, which is that the pairing has its own idea of confidence and its own
// refusal (`placed: false`) that this module must PROPAGATE rather than paper
// over.
//
// It does not guess. Rule 3 of CLAUDE.md is that null propagates and is never
// defaulted, and here that has teeth in four separate places, all of which
// happen on real pages:
//
//   - A notehead nobody played has NO TIME. The reader finds roughly one head
//     in seven that is not there, and a take rarely covers a whole page
//     anyway. `timeOf` returns null and `timesOf` returns an empty array. It
//     does not return the time of the nearest head that WAS played, which is
//     the plausible guess that would make a follow-along look smooth and lie
//     about which note you are hearing.
//   - A moment with nothing sounding has NO HEAD. Between two notes, before
//     the first and after the last, `headAt` returns null. It does not hold
//     the last head lit, because "the note you played four seconds ago" and
//     "the note you are playing" are different claims and only one of them is
//     true.
//   - A played note that landed on no notehead has no head either. That is the
//     reader having MISSED a head, and it is counted (`unheard`) rather than
//     attached to whichever head is nearest in time.
//   - A pairing that refused (`placed: false`) yields a bridge where every
//     answer is null. Not a throw, and not an empty object a caller could
//     mistake for "not loaded yet" — a real structure that says no to every
//     question, so that a UI written against it says "I could not tell where
//     this take is on the page" without a special case.

// A head may be visited more than once — see `timesOf`. The array is the API
// even where the reader can only ever fill one slot of it, because the day
// repeats are expanded is not the day to change every caller.
const NEVER = Object.freeze([]);

// The pairing's marks carry a COPY of the head, spread with `...`. All three
// of pairNotes' routes now also carry `headIndex` — the aligner's own answer to
// "which notehead", which used to die inside `marks.push({ ...heads[id], … })`
// because the spread takes the HEAD and not the window entry. Where that index
// is present and CHECKS OUT the join is free; where it is missing (a hand-built
// pairing in a test, an older mark) the head is found again by place.
//
// It is found on the exact triple (page, x, y), with no tolerance at all,
// because those three fields were copied by value out of the very object being
// searched for — this is an identity test wearing different clothes, not a
// nearest-neighbour search, and a tolerance would only let it match the WRONG
// head on a page where two heads sit at the same place.
//
// MEASURED, on the Bach opening fixture: 32 of 32 marks join, every one to the
// head at its own index. On the wrong-piece fixture 20 of 20 join. Both still
// join to the same indices with the carried index in front of the place-join,
// which is the check that says the two agree rather than the new one merely
// being quieter.
function indexHeads(heads) {
  const byIdentity = new Map();
  const byPlace = new Map();
  const ambiguous = new Set();
  for (const [i, head] of heads.entries()) {
    if (!head) continue;
    if (!byIdentity.has(head)) byIdentity.set(head, i);
    const key = `${head.page ?? 0}|${head.x}|${head.y}`;
    if (byPlace.has(key)) ambiguous.add(key);
    else byPlace.set(key, i);
  }
  return { byIdentity, byPlace, ambiguous };
}

// The carried index, BELIEVED ONLY WHERE IT CAN BE CHECKED.
//
// `heads` and `pairing` arrive as separate arguments and nothing makes them the
// same page reading — a caller can hand this a mark list built against one
// layout and a heads array built against another, and an index taken on trust
// would then be a span attributed to a notehead nobody looked at. That is the
// silent misattribution the rest of this module spends forty lines refusing, so
// the index is only used when the head it points at is the head the mark itself
// is a copy of, on the same exact triple the place-join matches on. Where it
// disagrees it is thrown away rather than preferred, and the place-join answers
// — which is also what makes this change impossible to notice from outside.
function carried(heads, mark) {
  const at = mark?.headIndex;
  if (!Number.isInteger(at) || at < 0 || at >= heads.length) return -1;
  const head = heads[at];
  if (!head) return -1;
  if ((head.page ?? 0) !== (mark.page ?? 0)) return -1;
  if (head.x !== mark.x || head.y !== mark.y) return -1;
  return at;
}

function lookup(index, head) {
  if (head === null || head === undefined) return -1;
  if (typeof head === 'number') return Number.isInteger(head) ? head : -1;
  const direct = index.byIdentity.get(head);
  if (direct !== undefined) return direct;
  const key = `${head.page ?? 0}|${head.x}|${head.y}`;
  // Two heads at the same place is not a head this can answer for. Saying
  // "one of these two" is the defaulting rule 3 forbids.
  if (index.ambiguous.has(key)) return -1;
  const found = index.byPlace.get(key);
  return found === undefined ? -1 : found;
}

// A bridge that says no to everything, for a take that could not be placed.
//
// Every field is present and every answer is null, so the caller that draws a
// follow-along needs no branch for "there is no pairing" — it asks the same
// questions and gets nulls, and rule 3 holds without anybody having to
// remember it.
//
// `silent` and `unheard` are FILLED IN rather than left empty, and that is the
// same rule wearing different clothes. Empty ones would read as "no notehead
// went unplayed" and "every note you played found a head", which are the two
// most confident sentences this structure can say and both of them false on a
// take nobody could place. A panel rendering "12 of 32 noteheads were never
// played" off those fields has to get the refusal right without asking a
// second question, or the branch this function exists to remove comes back.
function refused(why, heads = [], played = []) {
  return {
    placed: false,
    why: why ?? null,
    spans: [],
    // Nothing was placed, so nothing was heard and every head is silent.
    unheard: played.map((note, playedIndex) => ({ played: note, playedIndex })),
    silent: heads.map((_, i) => i),
    unjoined: 0,
    timesOf: () => NEVER,
    timeOf: () => null,
    headAt: () => null,
  };
}

export function syncTake({ heads, played, pairing } = {}) {
  const all = heads ?? [];
  const take = played ?? [];
  if (!pairing) return refused('no pairing was made', all, take);
  // The pairing's own refusal, carried through unchanged. pairByShape returns
  // this when findStart could not say where the take begins, and its `why` is
  // the sentence a UI should be showing.
  if (pairing.placed === false || !pairing.marks?.length) {
    return refused(pairing.why ?? 'the take could not be placed on these pages', all, take);
  }

  const index = indexHeads(all);
  const spans = [];
  const heard = new Set();
  let unjoined = 0;

  for (const mark of pairing.marks) {
    const note = mark?.note;
    const found = carried(all, mark);
    const headIndex = found >= 0 ? found : lookup(index, mark);
    // A mark whose head cannot be found is dropped and COUNTED, never guessed
    // at. A span attributed to the wrong notehead is a specific false claim
    // about a specific note, and this module exists to make such claims.
    if (headIndex < 0 || headIndex >= all.length) { unjoined += 1; continue; }
    // A played note with no start or end is not a moment. The segmenter always
    // gives both (notes.js:closeCurrent builds them from the frame times), but
    // a note that has been to the store and back is a copy, and a copy that
    // lost a field must not become a span at time zero.
    if (!Number.isFinite(note?.start) || !Number.isFinite(note?.end)) { unjoined += 1; continue; }

    // The mark's own index is CHECKED against this take before it is believed.
    //
    // `played` and `pairing` arrive as separate arguments, and `mark.index` was
    // counted by pairNotes against whichever array IT was handed. Pass a
    // different one — a take round-tripped through the store, a filtered copy,
    // the wrong session's notes — and every span would carry an index pointing
    // at a different note from its own `span.played`, while `heard` marked the
    // wrong note as placed, so `unheard` would name notes that WERE played and
    // omit ones that were not. Silent misattribution, which is the one thing
    // this module refuses everywhere else. So the index is used only where it
    // lands on this note; otherwise the note is looked up, and where it is not
    // in this take at all the index is null rather than a number.
    const claimed = Number.isInteger(mark.index) ? mark.index : -1;
    const playedIndex = take[claimed] === note ? claimed : take.indexOf(note);
    if (playedIndex >= 0) heard.add(playedIndex);
    spans.push({
      headIndex,
      head: all[headIndex],
      start: note.start,
      end: note.end,
      played: note,
      playedIndex: playedIndex >= 0 ? playedIndex : null,
      // Carried, not judged. alignByPitch's verdict already withholds on a
      // near-miss because the reference is a READING; this module has nothing
      // to add to that and must not launder it into a confidence of its own.
      verdict: mark.verdict ?? null,
      // Which time through, where anything ever expands a repeat. Today
      // nothing does — see `timesOf`.
      pass: mark.pass ?? 0,
    });
  }

  // Sorted by when, because that is the order the time direction reads in and
  // the order a playhead moves through. The pairing's own order is the order
  // the notes were PLAYED, which is the same thing today and would not be if a
  // future pairing ever emitted a head's several passes together.
  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  const byHead = new Map();
  for (const span of spans) {
    if (!byHead.has(span.headIndex)) byHead.set(span.headIndex, []);
    byHead.get(span.headIndex).push(span);
  }

  const unheard = [];
  for (const [i, note] of take.entries()) {
    if (heard.has(i)) continue;
    // A played note on no notehead. Either the reader missed a head, or the
    // player put in a note that is not written. Both are real and this module
    // cannot tell them apart — the pairing knows only that the aligner spent an
    // insert on it — so it says which note and stops there.
    unheard.push({ played: note, playedIndex: i });
  }

  const silent = [];
  for (let i = 0; i < all.length; i++) if (!byHead.has(i)) silent.push(i);

  const starts = spans.map((s) => s.start);

  return {
    placed: true,
    why: null,
    spans,
    unheard,
    silent,
    unjoined,

    // HEAD -> TIME. Every time it sounded, in order.
    //
    // An array rather than one span, and that is a decision about repeats
    // rather than a convenience. Written music sends you over the same
    // noteheads twice — a repeat, a da capo, a first and second time bar — and
    // when it does, one head has several times and any API returning a single
    // span has to pick one and be wrong about the other.
    //
    // WHAT IS SUPPORTED: the representation. Hand this module a pairing whose
    // marks put two played notes on one head and both come back here, sorted.
    // The `pass` field rides along for the same reason.
    //
    // WHAT IS REFUSED: inventing them. Nothing in the scanned route expands a
    // repeat — headsOf walks notesInOrder once per page and never sets `pass`,
    // alignByPitch's window is one entry per notehead, and alignScore's
    // repeatRuns only fires on `pass > 0`, which comes off MusicXML and never
    // off a photograph. Grepped, not assumed. So today a head gets at most one
    // span, the second time through a repeated section becomes `extras` in the
    // aligner and lands here in `unheard`, and this module will NOT pair those
    // orphans up with the heads they probably belong to by proximity. That
    // guess is the exact shape of the errors this reader already makes.
    timesOf(head) {
      const at = lookup(index, head);
      return byHead.get(at) ?? NEVER;
    },

    // The same question where the caller wants one answer: the FIRST time this
    // head sounded, or null. Null is the answer for a head nobody played, and
    // a head nobody played is the common case — a take covers a few bars of a
    // page that holds a few hundred noteheads.
    timeOf(head) {
      const spansHere = byHead.get(lookup(index, head));
      if (!spansHere?.length) return null;
      return { start: spansHere[0].start, end: spansHere[0].end };
    },

    // TIME -> HEAD. What is sounding at t, or null.
    //
    // The interval is HALF-OPEN, [start, end): a note ends at the instant the
    // next one begins on a grid, and closed intervals would have both of them
    // claiming that instant. At t exactly equal to a note's end, nothing is
    // sounding — which is also the honest answer, because the segmenter's `end`
    // is the last frame that carried the pitch.
    //
    // Where two spans overlap — which the segmenter does not produce, since it
    // closes one note before opening the next, but which a future pairing
    // could — the one that started LATER wins, on the grounds that the newer
    // note is the one being played. Written down because a tiebreak left to
    // sort order is a tiebreak nobody chose.
    headAt(t) {
      if (!Number.isFinite(t) || !spans.length) return null;
      // The last span that has begun at t. Binary search, because a
      // follow-along asks this every animation frame against a take that can
      // be thousands of notes long.
      let lo = 0;
      let hi = starts.length - 1;
      let at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= t) { at = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (at < 0) return null;
      // Silence between notes is silence. Walking back to the last span that
      // ENDED would light a notehead through every rest and every gap, which
      // is the plausible-looking lie rule 3 is about.
      const span = spans[at];
      return t < span.end ? span : null;
    },
  };
}
