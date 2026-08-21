// Lining a take up against the score it was meant to be.
//
// scoring.js:alignScale is the ancestor of this: same belief that a re-bowed
// note, a skipped one and a stray squeak are all normal playing rather than
// errors to choke on. But that one walks forward greedily, and a greedy walk
// cannot undo a decision — play the opening twice, or hold a wrong note where
// the right one belonged, and every note after it lands on the wrong degree.
// Real music has both, so this is a full edit distance with a traceback: it
// sees the whole take before deciding what anything was.
//
// The costs are the whole design. They encode what is more likely: that you
// played the written note badly (cheap), that you played a different note
// (dearer), or that a note is missing or extra entirely (dearest). Reading a
// wrong note as an insert plus a delete would lose the one thing worth saying
// about it — WHICH note it should have been.

const COST = {
  match: 0,
  octave: 0.5, // right note, wrong register — still tells you something
  // A semitone, when the SCORE ITSELF is a reading rather than a file.
  //
  // Off a photograph a missed accidental puts a written note a semitone from
  // where it really is, and nothing on the page catches it. The PAIRING was
  // never at risk — wrong (1.4) already sits under insert + delete (2.0), so
  // such a note is matched rather than skipped — but the VERDICT was, and the
  // verdict is what gets shown to somebody about their own playing. Calling a
  // correctly-played note wrong because the reference was misread is the exact
  // failure this whole route exists to avoid.
  //
  // The cheaper cost also settles the closer calls: where shifting the whole
  // alignment by one would buy a few exact matches, near-misses at 0.6 hold the
  // true path down where at 1.4 they were nearly worth abandoning.
  //
  // Off MusicXML this stays OFF. There a semitone IS a wrong note.
  near: 0.6,
  wrong: 1.4, // must stay under insert + delete, or wrong notes derail the path
  insert: 1.0, // a played note the score does not have
  delete: 1.0, // a score note that never sounded
  // A score note whose PITCH COULD NOT BE READ — degrade, do not delete.
  //
  // Off a photograph a stave whose clef or key signature would not read prices
  // its heads null (rule 5). Those heads used to be FILTERED OUT of the
  // aligner's window in scan-view.js:alignByPitch, and deleting them from the
  // reference is far worse than admitting they are unreadable: every note
  // played over such a system has nowhere to land, so it is consumed as an
  // insert, gets no mark, AND the sequence either side of the hole shifts.
  // MEASURED, `npm run scan:align -- --phone` (32 engraved studies degraded to
  // 0.72 scale, 1px blur, 0.62 contrast, jpeg 0.6; 4 seeded takes each): with
  // the heads deleted, 65.3% of played notes on the right head, 119 on the
  // WRONG head, 728 unmarked, against 95.9% / 30 / 71 when every head was
  // priced from a C-major assumption.
  //
  // So the head STAYS in the window carrying midi null, and this is what a
  // played note pays to sit on it. It has to be under insert + delete = 2.0 or
  // the path steps around the hole exactly as the filter did; and it has to be
  // over match = 0, near = 0.6 and octave = 0.5 or an unpriced head would
  // outbid a head that was read and agrees. That leaves the window (0.6, 2.0),
  // and where in it was SWEPT rather than argued — the whole table is in the
  // note above `substitutionCost`. 1.4 (the cost a non-finite midi fell to by
  // accident, through `wrong`, if this branch were simply left out) is in that
  // table as its own row, and it is not the best cell on either seed.
  unpriced: 0.7,
};

const DIAGONAL = 0;
const UP = 1; // consume a score note, nothing played
const LEFT = 2; // consume a played note, nothing written

// WHY THE UNPRICED TEST COMES FIRST, and what the sweep said.
//
// Before the arithmetic, because `played.midi - null` is NaN and every
// comparison below a NaN is false, so an unpriced head would fall through to
// `wrong` — 1.4 — silently. That is a real answer and it is in the table, but
// it must be CHOSEN rather than arrived at by the absence of a branch.
//
// MEASURED, `npm run scan:align -- --phone`, over the 88 of 128 takes whose
// page could still establish a key somewhere and so stayed on the pitch route
// (the other 40 have no priced head at all and take the contour route either
// way, so the constant cannot move them). Raw counts, not only percentages,
// because `scorable` excludes heads the reader never found and --phone loses
// far more of them:
//
//   cost       right head     WRONG head    unmarked      seed 29, right head
//   deleted      81.1% (1357)      17          299          81.3% (1362)
//   0.65         90.9% (1521)     105           47
//   0.70         92.3% (1544)      75           54          93.8% (1572)  <- shipped
//   0.80         88.9% (1488)     141           44
//   0.90         90.3% (1510)     114           49
//   1.00         89.8% (1503)     111           59          89.4% (1498)
//   1.20         91.2% (1525)      97           51
//   1.40         91.5% (1531)      96           46          93.0% (1558)
//   1.80         91.9% (1537)      89           47          90.8% (1521)
//
// READ THE FIRST ROW BEFORE THE REST OF THE TABLE. The whole of the effect is
// deleted-against-not-deleted: every value in the legal window buys eight to
// eleven points over the filter, and the spread WITHIN the window is 88.9% to
// 92.3%, which is three points and not monotone. So the constant is not where
// the result comes from, and anybody re-tuning it is polishing noise. What it
// is NOT free to do is leave the window: under 0.6 an unreadable head outbids
// a head that was read and agrees to a semitone, and at 2.0 the path steps
// around the hole exactly as the filter did.
//
// 0.70 is what ships because it is the best cell on BOTH seeds — 92.3% and
// 93.8% — and 1.00 is the worst on both, which is the only ordering in the
// table that reproduces. The wrong-head count is the robust half of it and it
// tells the honest story: 17 -> 75 wrong heads is the price of 299 -> 54
// unmarked notes. Those 299 were not right, they were ABSENT — a note played
// over a system nobody could read used to get no ring at all, and now it gets
// one, four times in five on the head it was played from.
//
// Kept numeric and object-free: this is called once per cell, and a movement
// against a ten-minute take is millions of cells. The verdict is worked out
// only along the traceback, which visits each score note once.
function substitutionCost(scoreNote, playedNote, nearMiss) {
  if (!Number.isFinite(scoreNote.midi)) return COST.unpriced;
  const distance = playedNote.midi - scoreNote.midi;
  if (distance === 0) return COST.match;
  if (distance % 12 === 0) return COST.octave;
  if (nearMiss && Math.abs(distance) === 1) return COST.near;
  return COST.wrong;
}

function verdictFor(scoreNote, playedNote, nearMiss) {
  // Its own word, and never 'match', 'near' or 'wrong'. A head whose pitch the
  // page would not give up can say WHERE a note was played and nothing
  // whatever about whether it was right, and the difference has to survive all
  // the way to the review — `wrong` and `octave` are counted into the review's
  // "you played N wrong notes", and an unreadable reference must not appear
  // there in either direction. Rule 5: null propagates, and this is what it
  // looks like once it has reached a verdict.
  if (!Number.isFinite(scoreNote.midi)) return 'unpriced';
  const distance = playedNote.midi - scoreNote.midi;
  if (distance === 0) return 'match';
  if (distance % 12 === 0) return 'octave';
  // Its own verdict, never folded into 'match': a note a semitone from a
  // reference nobody is sure of is a note nothing can judge, and the caller has
  // to be able to WITHHOLD rather than approve.
  if (nearMiss && Math.abs(distance) === 1) return 'near';
  return 'wrong';
}

// Contiguous runs of the same pass above zero. A run nobody played is a repeat
// that was not taken, which is a choice — not the same as missing the notes.
function repeatRuns(scoreNotes) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= scoreNotes.length; i++) {
    const pass = scoreNotes[i]?.pass ?? 0;
    if (pass > 0 && start === -1) start = i;
    else if (!(pass > 0) && start !== -1) {
      runs.push([start, i]);
      start = -1;
    }
  }
  return runs;
}

export function alignScore(playedNotes, scoreNotes, { nearMiss = false } = {}) {
  const played = playedNotes ?? [];
  const score = scoreNotes ?? [];
  if (score.length === 0) throw new Error('the score has no notes to align against');

  const S = score.length;
  const P = played.length;
  const width = P + 1;

  // The traceback needs every cell's decision, so `from` is the full grid — one
  // byte each. The distances are only ever read one row back, so they roll in
  // two rows instead of a second full grid: at 5000 x 5000 that is 40 KB rather
  // than 100 MB, and this runs on a phone the instant Stop is pressed.
  const from = new Uint8Array((S + 1) * width);
  let above = new Float32Array(width);
  let row = new Float32Array(width);
  // The cheapest row to finish on, for the free trailing gap — see the note
  // above the fill. Row 0 is "the take ends before the score begins", which is
  // only ever the answer when nothing was played.
  let bestCost = Infinity;
  let bestRow = 0;
  let anyCost = Infinity;
  let anyRow = 0;
  // FREE ENDS ONLY WHERE THERE IS ROOM TO SLIDE.
  //
  // A take that covers all of what it is compared against has nowhere to go and
  // wants the old end-to-end reading: every score note accounted for, so a
  // fumbled last note is a WRONG NOTE and not "you stopped early and made a
  // noise". MEASURED, `tests/align-score.test.js`: on a two-note score played
  // with two notes, free ends turn ['match','wrong'] into ['missed','match']
  // plus an extra, which is a worse account of the same playing.
  //
  // A take that covers a fragment of a long part is the opposite case and is
  // the one the user hit: 28 notes over 750 noteheads, where end-to-end costs
  // the same wherever the take sits and the tie-break slides it to the front of
  // the page. Four notes of slack is the line — under it every note of the
  // score is nearly spoken for, over it the take is a passage inside something
  // longer.
  const freeEnds = S > P * 2 + 8;

  for (let j = 1; j <= P; j++) {
    above[j] = j * COST.insert;
    from[j] = LEFT;
  }

  // WHERE THE TAKE SITS IN THE PART IS FOUND, NOT ASSUMED — and this is the fix
  // for a bug a user reported in these words: "I would click on a note that was
  // out of tune, and it would play audio from a different part of the music."
  //
  // This was a GLOBAL alignment: every note of the score had to be consumed, so
  // the score notes before the take and after it were deleted at 1.0 each. That
  // sounds like a cost and is not, because it is the SAME cost wherever the
  // take sits. A take of 28 notes over a page of 750 noteheads deletes 722 of
  // them by any path, so the only thing separating one placement from another
  // was the substitutions — and a matching pitch costs 0 whether it is the
  // right notehead or one two hundred notes earlier. Every placement tied, and
  // the tie-break took the earliest.
  //
  // MEASURED, `LANDED=1 PHOTO=1 npm run score:follow`, where the take is
  // synthesised from the page's own noteheads so the answer is known: notes
  // 0-17 were dragged onto heads 2, 19, 32 … 223 while they came from 253-270,
  // and only the last ten landed right — the tail, where the page ran out of
  // room to slide. On the Bach, six of 28 slid the same way.
  //
  // So the ends are FREE: `row[0] = 0` says the score notes BEFORE the take
  // cost nothing to skip, and the traceback below starts at the cheapest row
  // rather than at the last one, which says the same about the notes after it.
  // A gap INSIDE the take still costs 1.0 a notehead, which is what makes a
  // path that leaps 250 heads and comes back expensive rather than free.
  for (let i = 1; i <= S; i++) {
    const scoreNote = score[i - 1];
    const base = i * width;
    row[0] = freeEnds ? 0 : i * COST.delete;
    from[base] = UP;

    for (let j = 1; j <= P; j++) {
      const diagonal = above[j - 1] + substitutionCost(scoreNote, played[j - 1], nearMiss);
      const up = above[j] + COST.delete;
      const left = row[j - 1] + COST.insert;

      // Ties go UP — to leaving the LATER score note unplayed. The tie that
      // actually happens is a repeat: play a repeated bar once and matching it
      // to the first pass costs exactly what matching it to the second does.
      // Preferring UP settles that the way a player would read it, as the
      // first time through with the repeat not taken. A real match still wins
      // outright, since matching costs 0 and skipping costs 1.
      let best = up;
      let step = UP;
      if (diagonal < best) { best = diagonal; step = DIAGONAL; }
      if (left < best) { best = left; step = LEFT; }
      row[j] = best;
      from[base + j] = step;
    }

    // The cheapest place for the take to END, tracked as the rows go by: the
    // cost of having consumed every played note by score note i, with whatever
    // follows i free. Ties keep the EARLIEST row, so a take that could sit in
    // two places sits in the first — the same reading a player would make.
    //
    // ONLY A ROW THE LAST PLAYED NOTE WAS MATCHED ON may end the take. Without
    // that, a take whose final note is a fumble ends one note early and the
    // fumble becomes an extra: the score note it was aimed at is then free to
    // skip (1.0 for the insert) where matching it as a wrong note costs 1.4.
    // MEASURED, `tests/align-score.test.js`: "a repeat played but fumbled is
    // still counted as taken" turned ['match','match','match','wrong'] into
    // […,'missed'], which is the review telling somebody they stopped early
    // when what they did was play the last note badly.
    // A TAKE ENDS WHERE ITS LAST NOTE WAS MATCHED, and where no row can offer
    // that, on the cheapest row of any kind.
    //
    // Both halves are load-bearing and each was measured by breaking it. Ending
    // anywhere at all lets a take of the WRONG MUSIC match a handful of notes
    // that happen to fit, drop the rest as extras and be placed on the strength
    // of the handful: `npm run score:follow` catches it — "a take of a
    // different piece is REFUSED rather than drawn" comes back placed, 8 marks
    // of 24 notes played. Ending only on a match, with the OLD global traceback
    // as the fallback, hands the sliding bug back to any take whose last sound
    // is bow noise, since a squeak is cheaper to insert (1.0) than to call a
    // wrong note (1.4) and then no row ends on a match at all.
    if (freeEnds) {
      if (row[P] < anyCost) { anyCost = row[P]; anyRow = i; }
      if (from[base + P] === DIAGONAL && row[P] < bestCost) { bestCost = row[P]; bestRow = i; }
    }

    const spent = above;
    above = row;
    row = spent;
  }

  const attempts = new Array(S);
  const extras = [];
  // Everything after the take is a score note the take NEVER REACHED, and it is
  // written in as such before the traceback so the array is complete.
  //
  // NOT 'missed'. A note is missed when somebody played through it and it did
  // not sound; a note after the end of a take is one they had not got to yet.
  // Both said 'missed', so a minute of a photographed part reported hundreds of
  // notes "never sounded" — the rest of the page, held against the player. The
  // same word covered the reader's invented noteheads, which nobody could play
  // because they are not on the paper.
  // A take with nothing in it is the exception: there is no span for a note to
  // be outside OF, so silence against a score is still notes that did not
  // sound, which is what it has always said.
  const outside = played.length ? 'not-reached' : 'missed';
  for (let k = bestRow; k < S; k++) {
    attempts[k] = {
      scoreNoteId: score[k].id,
      pass: score[k].pass ?? 0,
      score: score[k],
      played: null,
      verdict: outside,
    };
  }
  if (!Number.isFinite(bestCost)) {
    // No row ends on a match. Where the ends are free that means the take's
    // last sound was not one of the notes on the page — a squeak, a bow scrape
    // — and the cheapest row of any kind is still a placement; where they are
    // not free the take covers what it is compared against and is placed the
    // way it always was, ending at the last score note.
    bestRow = freeEnds && Number.isFinite(anyCost) ? anyRow : S;
    attempts.length = 0;
    attempts.length = S;
    for (let k = bestRow; k < S; k++) {
      attempts[k] = {
        scoreNoteId: score[k].id,
        pass: score[k].pass ?? 0,
        score: score[k],
        played: null,
        verdict: 'missed',
      };
    }
  }
  let i = bestRow;
  let j = P;
  while (i > 0 || j > 0) {
    const step = i === 0 ? LEFT : j === 0 ? UP : from[i * width + j];
    if (step === DIAGONAL) {
      const scoreNote = score[i - 1];
      const playedNote = played[j - 1];
      const verdict = verdictFor(scoreNote, playedNote, nearMiss);
      attempts[i - 1] = {
        scoreNoteId: scoreNote.id,
        pass: scoreNote.pass ?? 0,
        score: scoreNote,
        played: playedNote,
        verdict,
      };
      i--; j--;
    } else if (step === UP) {
      const scoreNote = score[i - 1];
      attempts[i - 1] = {
        scoreNoteId: scoreNote.id,
        pass: scoreNote.pass ?? 0,
        score: scoreNote,
        played: null,
        // Before the take began, this is a note nobody had reached yet — the
        // same thing as the notes after it, and not a note they played over.
        verdict: j === 0 && played.length ? 'not-reached' : 'missed',
      };
      i--;
    } else {
      extras.push(played[j - 1]);
      j--;
    }
  }
  extras.reverse();

  for (const [start, end] of repeatRuns(score)) {
    const untouched = attempts.slice(start, end).every((a) => a.played === null);
    if (!untouched) continue;
    for (let k = start; k < end; k++) attempts[k].verdict = 'not-taken';
  }

  // One notehead, however many times it is visited. The view draws the last
  // pass that actually sounded and badges the count.
  const byNote = new Map();
  const latest = new Map();
  for (const attempt of attempts) {
    if (!byNote.has(attempt.scoreNoteId)) byNote.set(attempt.scoreNoteId, []);
    byNote.get(attempt.scoreNoteId).push(attempt);
    if (attempt.played || !latest.has(attempt.scoreNoteId)) {
      latest.set(attempt.scoreNoteId, attempt);
    }
  }

  const count = (verdict) => attempts.filter((a) => a.verdict === verdict).length;
  return {
    attempts,
    byNote,
    latest,
    extras,
    matched: attempts.filter((a) => a.played !== null).length,
    wrong: count('wrong') + count('octave'),
    missed: count('missed'),
    // Score notes on either side of the take: not played, and not a failure to
    // play them. Counted so a caller can say "the rest of the page" rather than
    // "you missed 300 notes".
    notReached: count('not-reached'),
    notTaken: count('not-taken'),
    extra: extras.length,
  };
}
