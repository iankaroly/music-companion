// The sharp standing in front of a note, which is the last thing between a
// position and a pitch.
//
// WHY THIS EXISTS
//
// scan-clef.js says which line is which note. scan-key.js says which of those
// names the signature has altered. Between them they name every notehead on the
// page — and they are both wrong about any note that carries an accidental of
// its own, because an accidental in a bar overrides the signature for that note
// and for the rest of that bar. A B flat in a page of one sharp is a B flat, and
// until this file existed the reader called it a B.
//
// It is the same object as an accidental in a key signature: the same three
// glyphs, from the same font, at the same size, printed on the same lines. The
// only differences are WHERE it stands — hard against the left of its notehead
// rather than in a row after the clef — and that it is about ONE note rather
// than a degree of the whole page. So it is read with the same measurements:
// describeGlyph reports the shape and classifyKeyGlyph names it, both lifted out
// of scan-key.js for this.
//
// WHAT AN ACCIDENTAL IN A BAR MEANS, which is a rule about music and not about
// ink, and is the part worth getting right:
//
//   - it applies to the note it stands in front of;
//   - and to every later note in THAT BAR at the same letter AND the same
//     octave — not to the same letter an octave away, which is a real
//     distinction and the one most implementations get wrong;
//   - and it stops at the barline, after which the signature is back in charge.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not look for an accidental that
// is not immediately in front of a notehead. Editorial accidentals over the
// stave, cautionary ones in brackets and the ficta of an urtext edition are all
// real and none of them is worth the false positives: the reader already circles
// three accidentals per page as noteheads, and a scan that hunts for accidentals
// in open paper would find those and more. An accidental is recognised by its
// POSITION relative to a head it belongs to, which is a much stronger claim than
// its shape alone.

import { headPatch } from './head-model.js';
import { accidentalScores } from './acc-model.js';

// WHERE AN ACCIDENTAL SITS relative to the note it belongs to, in staff spaces
// left of the note's centre. An engraver puts it one glyph width plus a hair
// clear of the head, which at every size tools/engrave.mjs draws comes to about
// a third over one space. This is the centre of the patch the model reads, and
// the patch is 4.8 spaces across, so nothing depends on the number being exact.
export const ACC_OFFSET = 1.35;
// How sure the model has to be. Half, which is where the three binary fits were
// measured — 93.8% of accidentals found and 1.13% of plain notes given one.
const ACC_SURE = 0.5;

/**
 * The accidental standing in front of one notehead, or null.
 *
 * `mark(x, y)` is the ink with the staff lines discounted, the same predicate
 * findKeyBand measures its glyphs through. `bottomY` is the y of the stave's
 * bottom line under this head, so a step can be turned back into a y.
 *
 * Returns { kind, alter, step, x0, x1 } — kind being 'sharp', 'flat' or
 * 'natural' — or null when there is nothing there, which is most notes.
 */
export function accidentalFor(gray, background, w, h, space, head, bottomY) {
  if (!(space > 0) || !head) return null;
  const cx = Math.round(head.x - space * ACC_OFFSET);
  const cy = Math.round(head.y);
  if (cx < 1 || cx >= w - 1 || cy < 1 || cy >= h - 1) return null;

  const scores = accidentalScores(headPatch(gray, background, w, h, space, cx, cy));
  let kind = null;
  let best = ACC_SURE;
  for (const k of ['sharp', 'flat', 'natural']) {
    if (scores[k] > best) { best = scores[k]; kind = k; }
  }
  if (!kind) return null;

  return {
    kind,
    alter: kind === 'sharp' ? 1 : kind === 'flat' ? -1 : 0,
    // An accidental belongs to the note it stands in front of and takes its
    // step from it. It is printed ON the note's own line or space — that is what
    // an accidental IS — so there is nothing here to measure separately, and the
    // reading that tried to measure it is the one this replaced.
    step: bottomY == null ? null : Math.round((bottomY - head.y) / (space / 2)),
    confidence: +best.toFixed(3),
  };
}

/**
 * Apply the accidentals of a bar to the notes in it.
 *
 * `notes` is one bar's worth, in reading order, each carrying `degree` and
 * `midi` as scan-notes.js computed them from the clef and the SIGNATURE, plus
 * the `accidental` this file found for it. Returns the same notes with `midi`
 * corrected and `alteredBy` saying which of the two decided it.
 *
 * The carry is per letter AND per octave, and stops at the barline — the caller
 * passes one bar at a time, which is what makes that true rather than asserted.
 */
export function applyAccidentals(notes) {
  const carried = new Map();
  return (notes ?? []).map((note) => {
    if (note.midi == null || note.degree == null) return note;
    // KEYED ON THE POSITION ON THE STAVE, which is exactly "the same letter in
    // the same octave" and needs no octave arithmetic to say so. Two notes share
    // a step when and only when they are the same line or space of the same
    // stave — a C sharp does not alter the C an octave above it, and that falls
    // out rather than being enforced.
    const slot = note.step;
    if (note.accidental) {
      // An accidental REPLACES the signature for this degree, it does not add to
      // it. A natural in a page of one sharp is a natural, and adding zero to a
      // sharpened F would leave it sharp.
      const fromKey = note.keyAlter ?? 0;
      const midi = note.midi - fromKey + note.accidental.alter;
      carried.set(slot, note.accidental.alter);
      return { ...note, midi, alteredBy: 'accidental' };
    }
    if (carried.has(slot)) {
      const fromKey = note.keyAlter ?? 0;
      return { ...note, midi: note.midi - fromKey + carried.get(slot), alteredBy: 'carried' };
    }
    return { ...note, alteredBy: note.keyAlter ? 'key' : null };
  });
}
