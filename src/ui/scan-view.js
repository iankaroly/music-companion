// The photograph, on the review, with every note on it live.
//
// The engraved side of this app has always had one thing the scanned side did
// not: a page you can sit in front of. Not the full-screen reader — that is for
// a music stand, and being thrown into it the moment you stop recording is the
// app deciding you have finished thinking — but the score IN the review, under
// the transport, beside the graph, with the note you are hearing lit and every
// note clickable for a drone and a close-up of how it landed.
//
// A scan could not have that for a structural reason: the engraved page is
// SVG, so a notehead is an element, and an element can be given a class, a
// click handler and a scroll-into-view. A photograph is pixels. There are no
// noteheads in it to hold on to.
//
// So they are made. The page reader already says where every notehead sits —
// that is what rings them in the reader — and those positions become real
// elements laid over the picture: one absolutely-positioned button per note
// played. After that the scanned page is the engraved page as far as the rest
// of the app is concerned. `noteheadFor` answers the same question, `.sounding`
// means the same thing, follow() and keepInView() and the note options all work
// without knowing which kind of score they are looking at, and none of it had
// to be written twice.

import { openPaper } from './paper.js';
import { notesInOrder } from '../analysis/scan-read.js';
import { pitchOf } from '../analysis/scan-notes.js';
import { NO_KEY } from '../analysis/scan-key.js';
import { intonationHue } from './chart-utils.js';
import { findStart } from '../analysis/scan-align.js';
import { alignScore } from '../analysis/align-score.js';
import { syncTake } from '../analysis/scan-sync.js';
import { midiToName } from '../analysis/note-utils.js';
import { stopWrittenPitch } from '../audio/written-pitch.js';

// Every notehead the page reader found, in reading order, carrying the page it
// is on and the staff space it was measured against.
export function headsOf(layout) {
  const all = [];
  for (const [page, read] of (layout ?? []).entries()) {
    if (!read) continue;
    const space = read.space ?? 0.01;
    for (const note of notesInOrder(read)) {
      // THE PITCH THE PAGE READ, not a second and worse one computed here.
      //
      // This line used to be `pitchOf(note.step, note.clef, NO_KEY)`, under a
      // comment saying "NO_KEY until the signature detector lands". It landed.
      // notesInOrder already prices every head through the clef IN FORCE at its
      // x, the page's agreed key signature, and the accidentals of its own bar
      // (applyAccidentals) — and this threw all three away and re-priced the
      // head as if the page were in C major. On a study in three sharps that is
      // a semitone on every F, C and G of the reference the aligner is handed.
      //
      // MEASURED, npm run scan:align — 32 engraved cello studies, 4 seeded
      // synthetic takes each, played from the MusicXML and not from what the
      // reader saw, scored as WHICH NOTEHEAD each played note landed on. Over
      // the 120 takes whose page could still establish a key: 93.3% -> 94.8% of
      // played notes on the right head, and 156 -> 118 of them on the WRONG
      // head, a quarter of the misplacements gone. It reproduces on a second
      // seed — --seed 29 gives 96.4% -> 97.5% and 78 -> 52 wrong heads, a third
      // of them gone — and the misplacement count is the robust half of it; the
      // percentage moves by a point either way with the seed. Nothing was read
      // as a WRONG key on the way: 42 stave signatures read right, 0 wrong, 8
      // unread, across the 27 studies that print one.
      //
      // The gain is NOT the semitone being fixed for its own sake — alignScore
      // runs with nearMiss, so a semitone already cost 0.6 rather than 1.4.
      // It is that a reference wrong on three degrees out of seven stops
      // TELLING ONE HEAD FROM ITS NEIGHBOUR, so a dropped note or a squeak
      // slides the whole path by one and nothing pulls it back. The
      // misplacement histogram is the evidence: the -1 column falls 68 -> 51
      // and -2 falls 18 -> 8, while +1 barely moves, 41 -> 42.
      //
      // NULL PROPAGATES, AND IT COSTS SOMETHING HERE — say it out loud rather
      // than let the mean hide it. NO_KEY has an `alter` array, so under the
      // old line EVERY head with a readable clef got a confident pitch and no
      // page ever took the contour route for want of a key. Now a page whose
      // signature could not be established prices its heads null and pairNotes
      // drops it to contour, which on those pages refuses outright: 8 of the
      // 128 takes, both of the two studies that PRINT NO SIGNATURE AT ALL and
      // have a single system (C-major-arpeggio, A-minor-arpeggio), where
      // agreeNoKey needs more than one witness before it will call a page bare.
      // Across all 128 takes that reads as 93.3% -> 91.3%, and those two pages
      // are the whole of the fall — they were being answered correctly by
      // accident, because C major is what NO_KEY happens to be. That is rule 5
      // working, not failing: a key nobody read is unknown, and the fix belongs
      // in agreeNoKey on a one-system page, not in a default here.
      //
      // AND ON A PAGE THE READER STRUGGLES WITH IT IS WORSE THAN THAT — the
      // number to read before believing this change is safe everywhere.
      // `npm run scan:align -- --phone` degrades the same studies the way
      // scan:key-read spoils its signatures, and most staves then fail to read
      // their signature at all: 95.9% -> 65.3% on the right head, 30 -> 119 on
      // the WRONG head, 71 -> 728 played notes left unmarked, and 40 of 128
      // takes dropping to the contour route. The mechanism is not the null
      // itself but what alignByPitch does with it — an unpriced head is
      // FILTERED OUT of the window, so a page where only some staves read a key
      // hands the aligner a reference with holes in it, and every note played
      // over those systems has nowhere to land.
      //
      // AND THE FLIP FAILS TWO OPPOSITE WAYS. On clean paper a flipped take
      // refuses outright — findStart is not sure, no marks. On a photographed
      // page it IS sure enough, pairByShape runs, and the wrong-head count on
      // the flipped takes goes 8 -> 102. So the contour route is quiet on one
      // kind of page and loud on the other, and degrading instead of deleting —
      // keeping an unpriced head in the window rather than removing it — was
      // the obvious next move. IT HAS SINCE BEEN MADE, in alignByPitch below,
      // and it recovers most of the --phone collapse: over the 88 takes whose
      // page still prices something, 81.1% -> 92.3% on the right head and
      // 299 -> 54 unmarked. The numbers above are the state BEFORE it and are
      // left standing because they are what the fall cost; the window's own
      // table is in alignByPitch.
      //
      // WHAT SAVES THE REAL PAGES IS THE PAGE-AGREED KEY, and that is measured
      // rather than hoped: `npm run scan:align -- --real` on the three marked
      // photographs reads ten staves and ten clefs on each, agrees ONE SHARP
      // for the page off 5, 5 and 9 of those staves, and prices 324 of 324,
      // 335 of 335 and 439 of 439 heads — identical to what NO_KEY priced, not
      // one head lost. The --phone collapse is a property of pages of one to
      // three systems, where agreeKey cannot get a quorum; a photograph of a
      // real part carries ten or eleven.
      // AND A SECOND PITCH THAT IS ONLY EVER FOR MATCHING, never for naming.
      //
      // `midi` is what the page READ: the clef in force, the page's agreed key
      // signature and the accidentals of the bar. It is null when any of those
      // could not be established, and it stays null — a note named off a key
      // nobody read is the failure rule 5 exists for.
      //
      // But the ALIGNER does not need to know a note's name. It needs to tell
      // one notehead from its neighbour, and the clef alone does that: two
      // heads a third apart are a third apart in any key. `matchMidi` is the
      // head priced through its clef with NO key at all, and where the page
      // could not agree a signature it is the difference between the pitch
      // route and no route.
      //
      // MEASURED, `npm run scan:align -- --unpriced` (every head's read pitch
      // stripped, which is what a page with no agreed key hands the pairing):
      // the contour route puts 130 notes of 2672 on the right notehead and 307
      // on the WRONG one. Matching on the clef alone is the BEFORE column of
      // the same tool — the reference priced NO_KEY — at 44.4% right and 55
      // wrong. Neither is the 91.3% a page that reads its key gets, and one of
      // them is nine times the other.
      //
      // What is withheld with it: a mark placed on an estimated head carries
      // the verdict `unpriced`, so nothing tells the player their note was
      // wrong on the strength of a key nobody read. See alignByPitch.
      all.push({
        ...note,
        page,
        space,
        midi: note.midi ?? null,
        matchMidi: note.midi ?? (pitchOf(note.step, note.clef, NO_KEY)?.midi ?? null),
      });
    }
  }
  return all;
}

// Placed by the ALIGNER, on pitches read off the page.
//
// The route below asks two questions in the wrong order. findStart guesses
// where the take began from the shape of the line alone, then fitPitches works
// out the clef from the take that has just been placed — so the page's notes
// depend on the take and the take depends on the page's notes, and neither can
// check the other. On a photographed page the reader misses or invents roughly
// one notehead in seven, which breaks the shape sequence every few notes, so
// the offset findStart returned was whichever one the noise happened to favour.
// It reported that as sure, and eighty rings landed on notes nobody had played.
//
// With a clef read off the paper (scan-clef.js) there is nothing to guess.
// alignScore sees the whole take against the whole page and decides everything
// at once, including where the take begins — that is what a traceback is for.
// Its edit distance is built for exactly the errors the reader makes: an
// invented notehead costs one delete, 1.0, against the 1.4 per note of staying
// shifted, so it resyncs after a single note instead of never.
//
// DEGRADE INSTEAD OF DELETE — the window is every head, priced or not.
//
// This used to be `.filter((head) => Number.isFinite(head.midi))`, and that
// filter was the whole of the --phone collapse. A head whose stave would not
// give up its clef or its signature is priced null (rule 5), and removing it
// from the window does not just lose that head: it CLOSES THE GAP, so the
// heads either side become neighbours in the reference and the notes played
// over the missing system have nowhere to land at all. They are consumed as
// inserts, get no mark, and the sequence around them shifts.
//
// MEASURED, `npm run scan:align -- --phone` — 32 engraved studies degraded the
// way scan:studies degrades them, 4 seeded takes each, scored as WHICH
// NOTEHEAD. Raw counts beside the percentage, because `scorable` excludes
// heads the reader never found and --phone loses far more of them, so a
// percentage can move without the alignment moving at all:
//
//   PHONE, all 128 takes            right head        WRONG   unmarked   route
//   deleted (the filter)          65.3% (1593/2439)     119      728     88/128
//   degraded (this)               72.9% (1779/2439)     177      483     88/128
//
//   PHONE, the 88 takes still on the pitch route — the ones the window can move
//   deleted (the filter)          81.1% (1357/1673)      17      299     88/88
//   degraded (this)               92.3% (1544/1673)      75       54     88/88
//   the same, --seed 29           81.3% -> 93.8%      32 -> 61   282 -> 43
//
// The denominator is IDENTICAL either side — 1673 scorable played notes, the
// same 88 takes on the same route — so this is a real move and not the
// artefact where `scorable` shrinks because the reader found fewer heads.
//
// THE OTHER 40 TAKES ARE NOT TOUCHED BY THIS AND MUST NOT BE READ AS IF THEY
// WERE. Their pages priced NO head at all, so `pairNotes` sends them to the
// contour route whatever this window does, and they are why the all-takes row
// is still 72.9% against the 95.9% a C-major assumption used to buy. That is
// agreeKey's quorum on a one-to-three-system page, and it is somebody else's
// entry.
//
// AND THE PLAIN RUN DOES NOT MOVE — 91.3% (2439/2672), 118 on the wrong head,
// 115 unmarked, 120/128 on the pitch route, digit for digit what it was before
// this change, on both seeds. On clean paper a page either reads its key and
// prices every head or reads none and takes the contour route, so there are
// almost no half-priced references for the window to keep.
//
// The head stays with `midi: null` on it, and `align-score.js` charges
// COST.unpriced to sit a played note on it — see the sweep table there. Its
// verdict comes back 'unpriced', which is carried to the review and never
// laundered into 'match' or 'wrong'.
function alignByPitch(heads, played) {
  // The reference the aligner walks: the page's own pitch where it has one, and
  // the clef-only estimate where it does not. `estimated` travels with the head
  // so the verdict can be withheld on exactly those marks.
  const window = heads.map((head, id) => ({
    ...head,
    id,
    midi: head.midi ?? head.matchMidi ?? null,
    estimated: !Number.isFinite(head.midi) && Number.isFinite(head.matchMidi),
  }));
  if (window.length < 2 || (played?.length ?? 0) < 2) return null;

  let attempts = null;
  try {
    // nearMiss, because this reference is a READING. A missed accidental is a
    // semitone, and a semitone must not be reported as a wrong note when the
    // page rather than the player may be what is wrong.
    ({ attempts } = alignScore(played, window, { nearMiss: true }));
  } catch {
    return null;
  }

  const seen = new Set();
  const marks = [];
  for (const attempt of attempts) {
    if (!attempt?.played || !attempt.score) continue;
    const at = played.indexOf(attempt.played);
    if (at < 0 || seen.has(at)) continue;
    seen.add(at);
    marks.push({
      ...heads[attempt.score.id],
      note: attempt.played,
      index: at,
      // WHICH NOTEHEAD, as an index into `heads`, carried rather than left to
      // be found again.
      //
      // This line spreads the HEAD, not the window entry, so `attempt.score.id`
      // — the only place the aligner's own answer to "which notehead" exists —
      // died here. scan-sync.js then had to recover it by matching the exact
      // (page, x, y) triple back onto the heads array, which is an identity
      // test wearing different clothes and which cannot answer at all where two
      // heads sit at the same place. Two modules held two ideas of the same
      // fact; now one of them is told. The place-join stays in scan-sync as the
      // fallback because it is what the CONTOUR route's marks still need and
      // because a hand-built pairing in a test carries no index.
      headIndex: attempt.score.id,
      // Carried through so the review can WITHHOLD on a note whose reference
      // was only nearly right. A ring saying "read as a semitone out" is
      // honest; one saying "you played this 100 cents flat" is not.
      //
      // …AND WITHHELD ENTIRELY where the reference was ESTIMATED. A head priced
      // through its clef with no key signature is a position, not a name: it
      // can say which notehead this is and it cannot say what the note was, so
      // the verdict it produced is replaced by `unpriced` rather than shown.
      verdict: attempt.score.estimated ? 'unpriced' : attempt.verdict,
      estimated: !!attempt.score.estimated,
      // What the aligner actually decided, kept apart from what is shown: the
      // confidence statistic is computed off this and not off the withheld one,
      // or a page with no key would refuse every take for want of judgements.
      matchVerdict: attempt.verdict,
    });
  }
  marks.sort((a, b) => a.index - b.index);
  // Counted here rather than recomputed by the caller, because this is the only
  // place that has both the verdict and the deduplicated mark. `unpriced` is
  // kept apart from the rest and is NOT evidence in either direction — see
  // `confidenceOf`.
  // Tallied on what the ALIGNER decided, and with one allowance for an
  // estimated reference: a semitone. A page whose key could not be read is
  // being matched as if it were in C, so every degree the signature alters
  // comes back `near` rather than `match` — three of seven on a page in three
  // sharps. Counting those as disagreement would refuse a perfectly good take
  // on a page that simply would not give up its signature. Nothing else moves:
  // on a page that DID read its key no mark is estimated and this is the same
  // tally it always was.
  const tally = { match: 0, near: 0, octave: 0, wrong: 0, unpriced: 0 };
  for (const mark of marks) {
    const verdict = mark.estimated && mark.matchVerdict === 'near' ? 'match' : mark.matchVerdict;
    if (verdict in tally) tally[verdict] += 1;
  }
  return { marks, tally };
}

// IS THIS EVEN THE RIGHT MUSIC — the number, and why it is this number.
//
// `alignScore` has no refusal in it. It is an edit distance, so it always
// returns a path, and the path is the cheapest one whether or not the take has
// anything to do with the page. MEASURED, before this existed: two octaves of D
// major over the two engraved Bach pages of `score:follow` came back
// `placed: true` with 24 marks, 26 rings on the photograph, and the sentence
// "26 notes played onto 50 noteheads, in the order you played them". The app
// asserted a wrong piece in words.
//
// The statistic is the share of JUDGEABLE marks whose pitch agreed exactly.
//
// Judgeable means: a mark, on a head the page priced, so there was something to
// agree with. Three things are deliberately outside the numerator:
//   - `unpriced`, which is a head whose stave would not read (rule 5). It is
//     not evidence for the take and it is not evidence against it, and leaving
//     it in the DENOMINATOR would make this floor move every time
//     COST.unpriced moves — two numbers tuned against each other, which is not
//     a measurement of either.
//   - `octave`, which is very nearly free. `distance % 12 === 0` fires on any
//     transposition, and the wrong-piece example above scored 7 octaves of 20
//     marks precisely because D major over G major shares a great deal. Adding
//     octave and near to the numerator moves that take from 30% to 70% and puts
//     it inside the right-pairing distribution.
//   - `near`, for the same reason at a semitone.
// Both are still WORTH SOMETHING to the player and are still shown; they are
// simply not allowed to vouch for the take being this piece at all.
//
// THE COST OF THIS TO SOMEBODY PLAYING AN OCTAVE DOWN, said out loud because
// nothing here measures it. scan-align.js's own header calls playing the whole
// line an octave lower "normal playing", and match-only scores such a take at
// zero. No take in `scan:align`'s corpus is octave-displaced wholesale — its
// builder shifts INDIVIDUAL notes by twelve at 2% and never the line — so this
// floor has never been tested against one and would refuse it. That is a known
// hole with a name, not an unmeasured hope.
//
// WHERE THE NUMBER COMES FROM — `npm run scan:floor`, both distributions on the
// same corpus, the same engraver and the same take builder as `scan:align`.
// 32 studies; for each, 4 takes played from ITS OWN music (RIGHT) and 4 played
// from a DIFFERENT study (WRONG). The crossings are chosen hardest-first — the
// foreign studies that share this one's clef AND key signature come first — so
// this is not a table about telling a bass part from a treble one.
//
//   CLEAN            n     min   10th   median   90th   max
//   RIGHT          120     77%    79%     93%    100%   100%
//   WRONG          120      0%    21%     54%     79%   100%
//
//   PHOTOGRAPHED (--phone)
//   RIGHT           88     64%    79%     91%    100%   100%
//   WRONG           76      0%    18%     64%     91%   100%
//
//   in tenths, 0.0-0.1 … 0.9-1.0, and 1.0 exactly in the last cell
//   clean RIGHT      0   0   0   0   0   0   0  14  39  25  42
//   clean WRONG      7   4   7  15  17  20  25  16   3   0   6
//   phone RIGHT      0   0   0   0   0   0   1   8  26  31  22
//   phone WRONG      5   3   6   6   8   8   8  16   8   3   5
//
// THE TRADE CURVE, which is the thing to read and not the point taken off it.
// RIGHT pairings refused against WRONG pairings refused, clean / phone:
//
//   floor    RIGHT refused            WRONG refused
//   0.50      0/120    0/88            50/120 (42%)   28/76 (37%)
//   0.60      0/120    0/88            70/120 (58%)   36/76 (47%)
//   0.65      0/120    1/88 (1.1%)     83/120 (69%)   40/76 (53%)
//   0.70      0/120    1/88 (1.1%)     96/120 (80%)   47/76 (62%)   <- shipped
//   0.75      0/120    5/88 (5.7%)    102/120 (85%)   56/76 (74%)
//   0.80     14/120   10/88 (11.4%)   113/120 (94%)   60/76 (79%)
//   0.85     34/120   23/88 (26.1%)   113/120 (94%)   67/76 (88%)
//   0.90     53/120   35/88 (39.8%)   114/120 (95%)   68/76 (90%)
//
// 0.70 IS PLACED IN A GAP, not on a round number. The lower tail of the RIGHT
// distribution on a photographed page runs 64%, 73%, 73%, 75%, 75%, 78%, … —
// 0.64 to 0.73 is the widest hole in it, and 0.70 sits inside that hole. It is
// the largest floor that costs ONE good pairing in 208 across both modes; the
// next step up, 0.75, costs five more, and one good take in eighteen told "this
// is not the music on these pages" is worse than the wrong pieces it catches.
//
// WHAT SURVIVES IT, AND WHY NO FLOOR ON THIS STATISTIC CAN CATCH THEM. The
// WRONG pairings scoring 100% are not the aligner failing. They are:
//
//   C-major-arpeggio over C-major-scale     an arpeggio's notes are a
//   G-major-arpeggio over G-major-scale     SUBSEQUENCE of its own scale
//   B-minor-scale over D-major-scale        a relative minor is the SAME SEVEN
//   G-major-scale over E-minor-scale        NOTES as its relative major
//   F-major-scale over D-minor-scale
//
// Six such crossings clean and five --phone. Every note of those takes really
// is on that page, in that order, and a statistic made of pitch agreement is
// blind to them BY CONSTRUCTION — the piece is wrong and the notes are right.
// What would tell them apart is rhythm or the shape of the line, and neither is
// in this number. Written down rather than tuned around: raising the floor does
// not touch them, it only costs good takes.
//
// AND ON REAL PAPER, which the engraved corpus cannot speak for. The three
// marked photographs, each taken by the walk's own take — 28 consecutive
// noteheads played from the reader's own midi — and then by two octaves of D
// major, 24 notes, over the same page:
//
//   page       heads/priced   the walk's take        two octaves of D major
//   Bach        324 / 324     1.00, 28 marks         0.58, REFUSED  (14/24 exact)
//   Mozart      335 / 335     1.00, 28 marks         0.29, REFUSED  ( 7/24 exact)
//   Scanned     439 / 439     1.00, 28 marks         0.33, REFUSED  ( 8/24 exact)
//
// READ THE MIDDLE COLUMN FOR WHAT IT IS. That take is synthesised FROM the
// reference, so 1.00 is a tautology about pitch and says only that the floor
// does not refuse it — which is the question being asked, since a floor that
// refused the app's own walk would be unshippable. `PHOTO=0`, `1` and `2 npm
// run score:follow` all place 28 marks of 28 notes and pass, INCLUDING the
// Concerto, where only 11 of those 28 marks land on the very notehead they were
// built from. That is the point worth carrying: this floor does not measure
// WHERE a mark went, only whether the notes belong to the page, and it cannot
// catch a take that is on the right page in the wrong place.
//
// The Bach's 0.58 is the thinnest margin anywhere in this note — D major
// against a page in G major shares six notes of seven — and it is 12 points
// under the floor, not two. A floor of 0.55 would have believed it.
// RAISED TO 0.75 THIS ROUND, and the sweep that says so is the same one that
// set it at 0.70. Matching on a clef-only estimate where the key would not read
// (see `matchMidi` in headsOf) puts every take back on the pitch route, and the
// two distributions moved apart rather than together — `npm run scan:floor`,
// 128 right pairings and 106 wrong:
//
//   floor    RIGHT refused        WRONG refused
//    0.70     0 of 128 (0.0%)      96 of 106 (90.6%)   <- here
//    0.75     0 of 128 (0.0%)      98 of 106 (92.5%)
//    0.80    16 of 128 (12.5%)    105 of 106 (99.1%)
//
// AND IT STAYS AT 0.70, which 0.75 looked free on that table and is not. The
// table is drawn on pages the reader read WELL. On a page it read badly —
// `node tools/align-check.mjs --miss 0.5`, half the noteheads never found,
// which is the page a user actually photographed — 0.75 refuses takes the
// agreement statistic can no longer vouch for: 52.7% of played notes on the
// right head falls to 44.3%, and 691 unmarked notes become 831. Two more wrong
// pairings caught of 106 is not worth 140 notes losing their notehead on the
// pages this is for.
const FLOOR = 0.70;

// The least a take can be and still be JUDGED at all — the same argument as
// ENOUGH in scan-align.js, in the other currency. A four-note take scores 100%
// by accident often enough that a floor believing it is not a floor.
//
// THIS IS THE ONE PLACE THE TWO FIXES OF THIS ROUND CAN FIGHT, so it is written
// down beside the constant rather than left to be rediscovered. It counts
// JUDGED marks — marks on heads the page priced — and a mark on an unpriced
// head counts for nothing here BY DESIGN (see the note above FLOOR). So on a
// page where most systems would not read, `alignByPitch` can now place a take
// that `alignByPitch` used to lose entirely, and this line can then refuse it
// for want of evidence: (D) rescues the marks and (C) declines to vouch for
// them. MEASURED, `npm run scan:floor -- --phone`: it fires on 0 of the 88
// right pairings and on 12 of the 88 wrong ones, so today it only ever refuses
// music that does not belong to the page. Anybody raising either constant
// should look at the other one first.
const ENOUGH_JUDGED = 8;

// The least of a take that has to find a notehead at all. See the sweep beside
// the test that uses it, in pairNotes.
const COVER_FLOOR = 0.45;

// The share of judgeable marks whose pitch agreed EXACTLY.
//
// null, not a number, where there is nothing to compute it from. Rule 5: the
// caller has to be able to tell "this take disagrees with the page" from "there
// was not enough here to ask".
function agreementOf(tally) {
  const judged = tally.match + tally.near + tally.octave + tally.wrong;
  if (judged < ENOUGH_JUDGED) return null;
  return tally.match / judged;
}

// One mark per note PLAYED, in order, from wherever the take begins.
//
// Two routes in, and which one runs is decided by whether the page managed to
// read its own clef. The order is still the order you played in; what it no
// longer assumes is that you started at the top of the piece.
export function pairNotes(heads, played) {
  // The page read its own clef, so the aligner can be given real notes — or at
  // least real POSITIONS, which is what `matchMidi` is. See headsOf.
  if ((heads ?? []).some((h) => Number.isFinite(h?.midi) || Number.isFinite(h?.matchMidi))) {
    // A TAKE AN OCTAVE FROM THE PAGE IS STILL THIS PAGE.
    //
    // `exactAgreement` counts marks whose pitch agreed EXACTLY, and it excludes
    // octaves on purpose — `distance % 12 === 0` fires on any transposition, so
    // letting octaves vouch for a take would let a wrong piece in. That is
    // right for a stray note and catastrophic for a WHOLE TAKE displaced by
    // one: every mark scores `octave`, the agreement comes out at zero, and the
    // review tells somebody who played the page perfectly that none of their
    // notes matched it. The handover has carried this as a known hole with a
    // name since the floor was built ("no take in scan:align's corpus is
    // octave-displaced wholesale … this floor has never been tested against one
    // and would refuse it"), and a player found it: "i played the exact notes on
    // the score … it said that none of the notes i played matched the score."
    //
    // TWO THINGS PUT A TAKE AN OCTAVE OUT and neither is a wrong piece. A part
    // can be played 8va — a cellist reading a treble line down, a flute reading
    // a part written for another instrument. And the READER of the recording
    // can hear the octave rather than the fundamental, which is ordinary on a
    // flute, whose second harmonic is often stronger than its first.
    //
    // So the take is offered to the page as played FIRST, and only where that
    // is refused is it offered an octave and two octaves either way. The best
    // reading wins, the shift is carried out with the pairing so the review can
    // say which, and nothing about the floor itself moves: a wrong piece has to
    // clear the same bar, in every register.
    // AND A SHIFT HAS TO EARN ITS PLACE, because five chances at one floor is
    // five times the chance a wrong piece slips through it. MEASURED,
    // `npm run scan:floor` with the octave search and no margin: the takes of
    // OTHER studies that survive go from 11 of 128 to 17, six of them by an
    // octave shift.
    //
    // What separates the two is the SIZE OF THE JUMP. A take of this page
    // played an octave out scores nothing at written pitch — every mark is an
    // `octave`, which the statistic deliberately does not count — and 93% once
    // moved, a leap of most of the scale. A take of a DIFFERENT piece already
    // scores something at written pitch (a wrong piece shares plenty of notes)
    // and a shift nudges it: 50% to 70%. So a shift must both clear the floor
    // and clear the unshifted reading by a wide margin. SWEPT, `scan:floor`,
    // 128 takes of each page's own music played 8va and 8vb against 128 takes
    // of other studies:
    //
    //   leap    displaced takes placed    wrong takes surviving (of 128)
    //   none         128 of 128            17, six of them by a shift
    //   0.35         128 of 128            15, four of them by a shift
    //   0.50         128 of 128            12, ONE of them by a shift   <- here
    //
    // Eleven of those twelve survive at written pitch and have nothing to do
    // with this; the search costs exactly one, and buys back every take a
    // player plays or a microphone hears in the wrong register.
    const LEAP = 0.5;
    const shifts = [0, 12, -12, 24, -24];
    let fit = null;
    let shift = 0;
    let plain = 0;
    for (const by of shifts) {
      const heard = by === 0 ? played
        : played.map((n) => (Number.isFinite(n?.midi) ? { ...n, midi: n.midi + by } : n));
      const tried = alignByPitch(heads, heard);
      const scored = tried?.marks?.length ? agreementOf(tried.tally) : null;
      // The first reading is the one to beat, and it keeps its own marks: a
      // mark carries the note that was PLAYED, and a shifted copy is not it.
      if (by === 0) {
        fit = tried;
        plain = scored ?? 0;
        if (scored !== null && scored >= FLOOR) break;
        continue;
      }
      if (scored === null || scored < FLOOR || scored - plain < LEAP) continue;
      const before = fit?.marks?.length ? agreementOf(fit.tally) : null;
      if (before !== null && before >= scored) continue;
      // Back to the notes the player actually played. Only the reference moved.
      fit = {
        ...tried,
        marks: tried.marks.map((mark) => ({ ...mark, note: played[mark.index] ?? mark.note })),
      };
      shift = by;
    }
    if (fit?.marks?.length) {
      // `exactAgreement`, spelled out, because two other numbers in this file
      // would answer to a shorter name and mean something else: pairByShape
      // returns `confidence`, which is findStart's SHAPE score, and fitPitches
      // returns `agreement`, which is how well an estimated clef fits. Three
      // statistics sharing a name is how a consumer ends up comparing one
      // against another's threshold.
      const exactAgreement = agreementOf(fit.tally);
      const judged = fit.tally.match + fit.tally.near + fit.tally.octave + fit.tally.wrong;
      const common = {
        heads: heads.length,
        played: played.length,
        readPitch: true,
        exactAgreement,
        judged,
        tally: fit.tally,
        // How far the take had to be moved before the page recognised it, in
        // semitones — 0 almost always, ±12 or ±24 where it was played or heard
        // in another register. The review says it out loud; nothing here
        // decides which of the two it was, because nothing here can know.
        octaveShift: shift,
      };
      // REFUSED, AND TERMINALLY. Not `return null` and fall through to
      // pairByShape: on a photographed page the contour route is sure enough to
      // run, and a wrong piece put through it lands 102 notes on wrong heads
      // (handover, "AND THE FLIP FAILS TWO OPPOSITE WAYS"). Falling through
      // would launder the refusal into a different wrong answer.
      if (exactAgreement === null) {
        return {
          ...common,
          marks: [], unmarked: played.length, spare: heads.length, placed: false,
          // WORDED AFTER THE TAKE, NOT AFTER THE PAGE. The commonest way to
          // land here is a SHORT take — six notes over a page whose every head
          // was priced — and telling somebody their page could not be read
          // when the page read perfectly is blaming the wrong thing.
          // pairByShape's own floor already says "too few notes to place".
          why: 'too few notes to tell whether this is the same music',
        };
      }
      if (exactAgreement < FLOOR) {
        return {
          ...common,
          marks: [], unmarked: played.length, spare: heads.length, placed: false,
          why: 'what was played does not match the notes on these pages',
        };
      }
      // …AND HOW MUCH OF THE TAKE FOUND A NOTEHEAD AT ALL, which is a different
      // question from whether the notes it did find agreed.
      //
      // `exactAgreement` is a share of the marks that were MADE. A take of a
      // different piece can put a mark on eight notes, agree on all eight and
      // leave the other thirty with nowhere to go, and that scores 100% — the
      // statistic never sees the thirty. This is the other half of the same
      // question and it costs one division.
      //
      // WHY IT COULD NOT BE ASKED BEFORE STEM_BODY. On a page carrying phantom
      // circles a wrong take marks nearly all of itself, because there is
      // always some spare circle near enough to take a note: `scan:floor`
      // measured wrong takes covering 77% at worst, against right takes' 92%,
      // and no cut through that is worth having. With the phantoms gone the
      // wrong takes fall to 40% and the lever opens up.
      //
      // SWEPT, and the number that decides is not on a clean page. `scan:floor`
      // now takes `--miss`, the knob `align-check.mjs` has always had, because
      // a coverage floor is dangerous in exactly the way the note above FLOOR
      // describes: on a page half of whose noteheads were never found, a RIGHT
      // take has fewer heads to mark and its coverage falls for a reason that
      // is not its fault. RIGHT refused / WRONG refused, at three read
      // qualities:
      //
      //   floor   clean page     half the heads gone   two thirds gone
      //    0.40    0 /  0 of 49       0 / 7 of 13         0 / 4 of 11
      //    0.45    0 /  7 of 49       0 / 7 of 13         0 / 4 of 11
      //    0.50    0 / 14 of 49       0 / 7 of 13         3 / 6 of 11
      //    0.55    0 / 18 of 49       0 / 7 of 13        29 / 10 of 11
      //    0.90    0 / 31 of 49     113 / 11 of 13        82 / 11 of 11
      //
      // 0.90 is what the clean page alone would have chosen and it refuses
      // EVERY right take on a page the reader read badly — which is the page
      // this is for. 0.45 is the last value that refuses none of them anywhere
      // measured, including a page two-thirds of which was never found, and
      // that is why it is 0.45 rather than the 0.50 that catches twice as many
      // on clean paper and costs three right takes at the far end.
      //
      // WHAT IT BUYS, AND WHAT IT DOES NOT. Wrong-piece takes surviving both
      // floors: 42 of 128 against 49, and on a half-read page 6 against 13. It
      // costs nothing anywhere that has been measured — `scan:align` is
      // byte-identical with it in and out at both read qualities, so it only
      // ever fires on music that does not belong to the page.
      //
      // IT IS NOT THE REPAIR FOR THE SEVEN. The note beside STEM_BODY in
      // scan-read.js records that seven wrong takes got through because
      // ENOUGH_JUDGED used to refuse them for want of judgeable marks, their
      // marks having landed on phantom circles the page never priced. Every one
      // of the seven THIS catches was refused by the AGREEMENT floor before,
      // not by that gate, and all seven of the ENOUGH escapees still survive —
      // checked by dumping every crossing's verdict in all three states and
      // diffing, not inferred from two totals moving by the same number, which
      // they did. Those seven are still open and this is not what closes them.
      if (fit.marks.length < played.length * COVER_FLOOR) {
        return {
          ...common,
          marks: [], unmarked: played.length, spare: heads.length, placed: false,
          // The notes it DID find agreed — saying "does not match" would be
          // wrong about what was measured. Most of the take found nothing.
          why: 'most of what was played is not on these pages',
        };
      }
      return {
        ...common,
        marks: fit.marks,
        unmarked: Math.max(0, played.length - fit.marks.length),
        spare: Math.max(0, heads.length - fit.marks.length),
        placed: true,
        aligned: true,
      };
    }
  }
  return pairByShape(heads, played);
}

// The route for a page whose clef could not be read — WHICH NO LONGER PLACES A
// NOTE ON A NOTEHEAD, and this is the most important comment in this file.
//
// WHAT IT USED TO DO. `findStart` guessed where the take began from the shape
// of the line alone, `fitPitches` estimated a pitch for every head from the
// take itself, `alignScore` walked the two, and where that fit was poor the
// notes were simply COUNTED OFF from the starting head — played note i onto
// head i. All of it drew rings you could press, and pressing a ring plays that
// note's own moment of the recording.
//
// WHY IT IS GONE. It is wrong far more often than it is right, and nothing in
// this repo had ever asked it the question. `npm run scan:align -- --unpriced`
// strips the pitch off every head — which is exactly what a page whose clef or
// key would not read hands the pairing — and scores WHICH NOTEHEAD each played
// note landed on, over 32 studies and 128 takes:
//
//   route         right head   WRONG head   unmarked   takes counted off
//   contour        130 (4.9%)         307       2233     20 of 128
//   …and with half the page's heads never found (--unpriced --miss 0.5)
//   contour          8 (0.5%)          21       1497      2 of 128
//
// Seventy per cent of the marks it placed were on the wrong notehead. The pitch
// route on the same corpus, with the same half of the heads missing, is
// 52.7% right against 31 wrong — 96% of what it places is right, because it has
// something real to match on.
//
// AND THIS IS THE BUG A USER REPORTED, in their words: "I would click on a note
// that was out of tune, and it would play audio from a different part of the
// music." That is not a sync bug in the audio and it is not the clock. It is a
// ring drawn on a notehead the player never played, over a page the reader
// could not price, with a recording behind it that belongs somewhere else. One
// wrong answer of that kind costs every right one its credibility, because
// nothing on screen tells them apart.
//
// So: no pitch on the page, no marks. The take is still reviewed — the graph,
// the tuning, the evenness, all of which need no page at all — and the page is
// still shown. What is withheld is the CLAIM that a particular notehead is a
// particular moment of the recording.
//
// WHAT WOULD BRING IT BACK. Not a better threshold: the shape score does not
// separate the two populations (see the table above — the takes it was SURE
// about are in it). What would is evidence the page currently cannot give —
// a clef read where there is one to read, or a second witness such as the
// notation this scan is paired with. `pairWithNotation` in score.js already
// exists for exactly that, and a paired scan takes the MusicXML route, which is
// where a page nobody can price should be sent.
function pairByShape(heads, played) {
  // `findStart` is still asked, and only so the refusal can be specific about
  // which of the two failures happened: a take that cannot even be located on
  // the page is a different sentence from one that can be located and still
  // cannot be placed note for note.
  const start = findStart(heads, played);
  return {
    marks: [],
    heads: heads?.length ?? 0,
    played: played?.length ?? 0,
    unmarked: played?.length ?? 0,
    spare: heads?.length ?? 0,
    placed: false,
    readPitch: false,
    aligned: false,
    confidence: start?.score ?? null,
    // What the player can DO about it is the second half, because this refusal
    // is the one with an answer: a scan paired with its notation is read
    // through the notation and does not need the page's own clef at all.
    why: start?.sure
      ? 'the clef on these pages could not be read, so which notehead each note was'
        + ' played from cannot be told — pair this scan with its notation if you have it'
      : (start?.why ?? 'this take could not be found on these pages'),
  };
}

// How wide the picture may be drawn, in device pixels. A review panel is not a
// music stand and the page does not have to be readable at arm's length; what
// it has to be is quick, because this is drawn while somebody is waiting to see
// their take.
const MAX_ACROSS = 1400;

// What to say, and what to sound, when somebody presses a notehead NOBODY
// PLAYED. This is the one place in the scanned review where the obvious
// implementation is a lie, so it is a function of its own with a name, and it
// is exported so a unit test can pin both of its branches.
//
// A page holds a few hundred noteheads and a take covers a few dozen of them,
// so most of what can be pressed has no audio anywhere in the recording. The
// three things that must never happen are all the same mistake: playing the
// nearest recorded note, playing the note the aligner ALMOST put here, and
// saying nothing at all so that a press looks like a bug. What happens instead
// is that the page's own reading of the notehead is sounded as a synthesised
// tone and labelled as one — and where the page could not read it, the answer
// is a refusal in words with no sound at all.
//
// `head.midi` is null exactly when scan-read.js could not price the head: no
// clef in force, or no key the page could agree on (see the long note in
// headsOf). That is CLAUDE.md rule 5 arriving here from four modules away, and
// the right thing to do with it is repeat it, not fill it in.
export function writtenPitchSay(head) {
  if (Number.isFinite(head?.midi)) {
    return {
      midi: head.midi,
      text: `Not played — ${midiToName(head.midi)} is what is written here,`
        + ' sounded as a synthesised tone.',
      label: `notehead you did not play, written ${midiToName(head.midi)}`,
    };
  }
  return {
    midi: null,
    text: 'Not played — and the page could not name this notehead,'
      + ' so there is nothing to sound.',
    label: 'notehead you did not play, pitch unread',
  };
}

// How far either side of the take its unplayed neighbours are drawn, in
// noteheads.
//
// NOT the whole page, and the number that settles it is this repo's own:
// `npm run scan:align -- --real` reads 324, 335 and 439 noteheads off the
// three marked photographs. A take is a few dozen notes. Marking every other
// head on the page would put four hundred finger-sized controls over a
// photograph — a wall of circles that is no longer a review of a take, and
// which would take the presses meant for the rings that ARE the take. Inside
// the passage you played, an unplayed notehead is the interesting thing on the
// page (a note you skipped, or one the aligner could not place); a hundred
// heads further on it is just the rest of the piece.
// The controls for noteheads nobody played, built by a function that CANNOT
// REACH THE RECORDING.
//
// This signature is the feature. It is handed noteheads and a callback and
// nothing else — no take, no Recorder, no spans, no pairing — so there is no
// path from a press on a silent notehead to a played note, and the failure
// this whole task is about is impossible here rather than merely avoided. Any
// future edit that wants to play "something" for one of these has to widen
// this signature first, which is a thing a reviewer can see in a diff.
// A MARK, NOT A CONTROL — and that is the change, not an oversight.
//
// These used to be buttons: press a notehead nobody played and hear the pitch
// printed there, synthesised. It is gone from the scanned page at his asking:
// "I don't want to be able to press the note head. If you press the note head,
// I just want to start at the beginning of that bar… No going to individual
// notes, because I know that's not possible."
//
// He is right that it is not possible, and the two failures `score:hear` had
// been reporting say so with numbers: pressing head 116 lit heads 121, 122 and
// 123. A photograph gives the reader roughly one notehead where the paper has
// one, but not reliably THE one, so a note-level control on a scan is a control
// that is confidently about the wrong note some of the time. A bar is a
// rectangle and is not wrong.
//
// The rings STAY, because as a mark they are exactly right — green where you
// were in tune, hollow where you never played it — and none of that depends on
// being able to press them. What went is the press.
//
// (The notation review is untouched: a part imported as MusicXML knows which
// note is which by construction, and there a note-level control is honest.)
function silentMarkers(layer, heads, indices) {
  const nodes = [];
  for (const at of indices) {
    const head = heads[at];
    if (!head) continue;
    const dot = document.createElement('span');
    dot.className = 'scan-quiet';
    dot.dataset.head = String(at);
    dot.style.left = `${(head.x * 100).toFixed(3)}%`;
    dot.style.top = `${(head.y * 100).toFixed(3)}%`;
    dot.style.setProperty('--ring', `${(head.space * 100 * 1.5).toFixed(3)}%`);
    const said = writtenPitchSay(head);
    dot.title = said.midi === null ? 'not played, pitch unread' : `not played — written ${midiToName(said.midi)}`;
    dot.setAttribute('aria-label', said.label);
    layer.append(dot);
    nodes.push(dot);
  }
  return nodes;
}

export async function showScanScore(container, { payload, layout, notes } = {}) {
  const played = notes ?? [];
  const heads = headsOf(layout);
  const pairing = pairNotes(heads, played);
  // Which notehead sounded when, in recording seconds — see scan-sync.js. It
  // does not align anything: it joins the pairing that has just been made to
  // the seconds the segmenter measured, and it answers null wherever there is
  // no answer, which is most of a page.
  const bridge = syncTake({ heads, played, pairing });
  // Nothing placed is a thing to SAY, not a thing to return as emptiness: the
  // caller has to be able to tell "the pages have not been read" from "the
  // pages were read and this take could not be found on them".
  // A refusal still shows the music.
  //
  // This used to return before anything was drawn, so a take the pairing could
  // not place left the Score tab holding a sentence and nothing else — the
  // player's own page, which they had just photographed and which the reader
  // had just read, was not on the screen at all. The refusal is about WHERE the
  // notes were played, not about whether the page can be looked at.
  //
  // The FIRST page only, because with no marks there is nothing to say which of
  // twenty pages the take was on, and nineteen blank photographs under a
  // refusal is not a review either.
  const refused = !pairing.marks.length;

  const pages = await openPaper(payload);
  const wrap = document.createElement('div');
  wrap.className = 'scan-score';
  container.replaceChildren(wrap);

  // WHICH PAGE TO OPEN ON — which is all this is now.
  //
  // It used to be which pages to DRAW: only the ones carrying a mark, because a
  // take of eight notes against a twenty-page part is eight rings on page one
  // and nineteen blank photographs under them is not a review, it is a scroll.
  // That argument is about the scroll, and there is no scroll any more — the
  // pages are shown one at a time with an arrow either side (see below). So all
  // of them are laid out and the take decides where you land, which is also
  // what puts a tappable bar on the pages the take never reached.
  const wanted = refused
    ? [0]
    : [...new Set(pairing.marks.map((m) => m.page))].sort((a, b) => a - b);
  const byNote = new Map();
  const nodes = [];
  // headIndex -> the ring drawn for it. This is the direction the playhead
  // reads in: scan-sync's headAt(t) hands back a span carrying a head INDEX,
  // and the light has to become an element.
  const byHead = new Map();
  const quietNodes = [];

  // The unplayed noteheads that get a control, as indices into `heads`.
  //
  // Taken from the bridge's own `silent` list — the heads no span landed on —
  // narrowed to the stretch of the part the take actually reached. On a
  // refusal `silent` is every head, which is exactly right and exactly why the
  // narrowing is by the take's own reach: with no spans there is no reach and
  // nothing is drawn, so a page that could not be placed does not sprout four
  // hundred circles claiming you played none of them.
  // EVERY notehead on the pages being shown, not only the ones beside the take.
  //
  // It used to be the take's own stretch plus REACH either side, and the reason
  // was sound — a page that could not be placed must not sprout four hundred
  // circles claiming you played none of them. That reason is about a REFUSAL,
  // and a refusal draws nothing here anyway (`refused` above). Where the take
  // IS placed, every other head on the same page is a notehead somebody can
  // press to hear what is written there, and narrowing it to the take's reach
  // is what made a page of two hundred notes offer a dozen controls.
  //
  // A user asked for exactly this, in these words: "making more of the notes
  // scanned and clickable". The claim each one makes is unchanged and still
  // true — this take did not play this note — and the sound it makes still
  // comes from written-pitch.js, which cannot reach the recording.
  const touched = bridge.spans.map((s) => s.headIndex);
  const quietWanted = new Set(touched.length ? bridge.silent : []);

  // WHAT WENT WITH THE PRESS. A line above the pages used to say "Note 12 — 8¢
  // sharp" for whichever ring you had just pressed, with the ring lit, and a
  // silent notehead sounded its written pitch into it. All of it hung off a
  // press this page no longer takes — see silentMarkers. The intonation is
  // still on the page, in the colour of every ring, and it is still in the
  // sentence over the review; what is gone is a control whose subject was the
  // wrong notehead some of the time.

  // HOW WIDE THE PAGE IS DRAWN, and it is also how wide it is SHOWN: paper.js
  // sets the canvas's CSS width to this (see sizeToBand), so a floor here is a
  // floor on the layout and not only on the quality. It read `Math.max(320,
  // …)`, and on a 320px phone the container is about 310 — so every page was
  // drawn ten pixels wider than the card it sits in and hung off the side of
  // the screen. The floor now only catches a container that has not been
  // measured at all. `npm run edge:fit`.
  const room = container.clientWidth || 360;
  const across = Math.min(MAX_ACROSS, Math.max(240, room));

  // ONE PAGE AT A TIME, WITH AN ARROW EITHER SIDE.
  //
  // The pages used to run down the screen one after the next, so a two-page
  // part was a scroll and a ten-page part was a scroll nobody reached the end
  // of. They are laid out in the same order and only one is shown.
  //
  // WHY THEY ARE HIDDEN AND NOT REBUILT, which is the whole of "move to another
  // page without the sound stopping". Turning a page here touches one attribute
  // on two elements. Nothing is created, nothing is destroyed, no view is torn
  // down and remounted — so the take carries on playing, the follower carries on
  // following, and the bar layer another module hung over these pages
  // (bar-sync.js finds them by `.scan-page`) keeps the very boxes it built.
  // Rebuilding the pages on a turn would take the audio down with it, because
  // `destroy` is what stops the tone and the paper.
  //
  // WHAT IS LAZY AND WHAT IS NOT. The picture is decoded on the first visit to
  // its page, and the page after it is decoded as soon as you land, so the
  // arrow answers instantly. The take's own rings go down eagerly, all pages at
  // once — they are one per played note, so a take bounds them — and that keeps
  // `byNote`/`byHead` complete from the start, which is what the playhead reads.
  // The SILENT noteheads are per page and lazy: `bridge.silent` is every head
  // nobody played across the whole part, which on a twenty-page part is
  // thousands of marks nobody has looked at yet.
  const total = Math.max(1, Number.isFinite(pages.count) ? pages.count : (layout?.length ?? 1));
  const holders = [];
  const quiets = [];
  for (let index = 0; index < total; index += 1) {
    const holder = document.createElement('div');
    holder.className = 'scan-page';
    holder.dataset.page = String(index);
    const canvas = document.createElement('canvas');
    holder.append(canvas);
    // The picture is laid out at its own aspect; the marks are placed against
    // the SAME box, in fractions, so they cannot drift from it at any width.
    //
    // TWO layers, and the order is load-bearing: the silent noteheads go down
    // FIRST so that the rings of the take paint over them and, more to the
    // point, take the press where the two overlap. A ring is a note you played
    // with a close-up and a drone behind it; a silent marker is a note you did
    // not. Where the reader has found two heads within a finger's width of each
    // other, the one that answers has to be the one that has something to say.
    const quiet = document.createElement('div');
    quiet.className = 'scan-marks quiet';
    holder.append(quiet);
    const box = document.createElement('div');
    box.className = 'scan-marks';
    holder.append(box);
    quiets.push(quiet);
    holders.push(holder);
    wrap.append(holder);

    for (const mark of pairing.marks) {
      if (mark.page !== index) continue;
      // A mark and not a control — see the note on silentMarkers. Every tap on
      // a scanned page goes to the bar under it.
      const dot = document.createElement('span');
      dot.className = 'scan-note';
      dot.style.left = `${(mark.x * 100).toFixed(3)}%`;
      dot.style.top = `${(mark.y * 100).toFixed(3)}%`;
      // Sized off the staff space the reader measured, so a ring is the size of
      // the notehead under it whatever the page is being shown at.
      dot.style.setProperty('--ring', `${(mark.space * 100 * 1.5).toFixed(3)}%`);
      dot.dataset.tone = intonationHue(mark.note?.cents ?? 0);
      const cents = Math.round(mark.note?.cents ?? 0);
      dot.title = `${cents > 0 ? '+' : ''}${cents}¢`;
      dot.setAttribute('aria-label', `note ${mark.index + 1}, ${cents > 0 ? '+' : ''}${cents} cents`);
      box.append(dot);
      byNote.set(mark.note, dot);
      nodes.push(dot);
    }
  }

  const drew = new Set();
  const quieted = new Set();
  async function paint(index) {
    const holder = holders[index];
    if (!holder) return;
    if (!quieted.has(index)) {
      quieted.add(index);
      quietNodes.push(...silentMarkers(
        quiets[index],
        heads,
        [...quietWanted].filter((at) => heads[at]?.page === index),
      ));
    }
    if (drew.has(index)) return;
    drew.add(index);
    try {
      await pages.draw(index, holder.querySelector('canvas'), across, across * 4);
    } catch {
      // A page that will not draw still gets its marks: the positions are
      // known, and a ring over a blank rectangle is more use than nothing.
    }
  }

  let pager = null;
  let counter = null;
  let back = null;
  let on = null;
  let shown = -1;

  function showPage(index) {
    const next = Math.max(0, Math.min(total - 1, Math.trunc(index) || 0));
    // Already here — including an arrow pressed at either end, which is why
    // this is a no-op and not a wrap round to the other end of the part.
    if (next === shown) return Promise.resolve(shown);
    shown = next;
    for (const [i, holder] of holders.entries()) holder.hidden = i !== shown;
    if (counter) counter.textContent = `${shown + 1} / ${total}`;
    if (back) back.disabled = shown === 0;
    if (on) on.disabled = shown === total - 1;
    // This one now, and the next one so the arrow answers without a decode.
    const ready = paint(shown);
    paint(shown + 1);
    return ready;
  }

  if (total > 1) {
    pager = document.createElement('div');
    pager.className = 'scan-pager';
    const turn = (glyph, label, go) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scan-turn';
      button.textContent = glyph;
      button.setAttribute('aria-label', label);
      // AND NOT ALSO A TAP ON THE SCORE — score-tab.js opens the full-screen
      // reader on a click anywhere in the stage, so an arrow that did not stop
      // its own click would turn the page and then throw the part over the top
      // of it. The bar boxes do the same, for the same reason.
      button.addEventListener('click', (event) => { event.stopPropagation(); go(); });
      return button;
    };
    back = turn('‹', 'Previous page', () => showPage(shown - 1));
    on = turn('›', 'Next page', () => showPage(shown + 1));
    counter = document.createElement('span');
    counter.className = 'scan-pager-at';
    pager.append(back, counter, on);
    wrap.append(pager);
  }

  // Landing where the take is, not at the front of the part.
  await showPage(wanted[0] ?? 0);

  // The rings, by the notehead they are ON rather than by the note that was
  // played — which is what the playhead needs, because the bridge answers
  // "what is sounding now" with a head index and not with a note.
  //
  // Built by walking the bridge's spans rather than the marks, so that the
  // element a time resolves to and the head that time was measured against are
  // the same object by construction. Where a head has several spans (a repeat,
  // the day anything expands one) the FIRST wins: there is one ring drawn per
  // played note, and lighting a later one for an earlier moment would move the
  // light backwards.
  for (const span of bridge.spans) {
    const dot = byNote.get(span.played);
    if (!dot) continue;
    dot.dataset.head = String(span.headIndex);
    if (!byHead.has(span.headIndex)) byHead.set(span.headIndex, dot);
  }

  return {
    pages: nodes,
    pairing,
    bridge,
    // The part, page by page. `showPage` is how a check turns one and how
    // anything else ever will; `page` is the one being looked at.
    pageCount: total,
    get page() { return shown; },
    showPage,
    // How many unplayed noteheads were drawn. The review says this out loud —
    // "these are the notes on the page you did not play" is a fact about the
    // take, and a page with silent markers on it that nothing explains reads
    // as a bug.
    quiet: quietNodes.length,
    // The one question the rest of the app asks a score view — now in two
    // directions.
    //
    // WITH A TIME (the playhead, every animation frame) it is answered through
    // the bridge: headAt(t) says which notehead is sounding at t, on a
    // half-open interval, and null in every gap and either side of the take.
    // Null lights NOTHING. The last head is not held on through a rest, and a
    // moment the aligner could not place lights no notehead at all — the
    // alternative is a light that glides confidently over music nobody played,
    // which is the same lie as playing the nearest note, drawn instead of
    // sounded.
    //
    // WITHOUT ONE (reader.js:5533, which has a note and no clock) it falls
    // back to identity, exactly as before.
    //
    // `byHead.size` guards the time route rather than `bridge.placed`: if
    // every mark failed to join a head — which the bridge counts as `unjoined`
    // rather than guessing at — there is no head-to-element map to answer
    // with, and the identity route is the honest remaining answer rather than
    // a page that has quietly stopped following.
    noteheadFor(note, t) {
      if (byHead.size && Number.isFinite(t)) {
        const span = bridge.headAt(t);
        return span ? byHead.get(span.headIndex) ?? null : null;
      }
      if (!note) return null;
      const direct = byNote.get(note);
      if (direct) return direct;
      // A take that has been to the store and back is a copy of itself, so
      // identity is not enough on its own.
      if (!Number.isFinite(note.start)) return null;
      for (const [key, node] of byNote) {
        if (key.start === note.start) return node;
      }
      return null;
    },
    destroy() {
      // A tone this view started outlives this view otherwise: it is a
      // timeout, not a button, so nothing else would ever switch it off.
      stopWrittenPitch();
      pages.destroy?.();
      container.replaceChildren();
    },
  };
}
