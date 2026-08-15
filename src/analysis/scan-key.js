// The key signature, which is the second half of turning a position into a note.
//
// A clef says which line is which note. A key signature says which of those
// notes are sharp or flat for the whole page — and unlike an accidental, which
// stands against one notehead in a crowd of fingerings, slurs and bowings, it
// stands alone at the head of the stave, in a fixed order, on fixed lines, with
// fifteen possible answers and nothing overlapping it. It is the easiest thing
// on the page to read and it is worth a whole semitone on every note it touches.
//
// Degrees are indexed C=0, D=1, E=2, F=3, G=4, A=5, B=6 — the diatonic degree
// rather than the pitch, because a degree is what a step on a stave gives you
// and a pitch is what this and scan-clef.js together turn it into.

// F C G D A E B — the order sharps are written in, and the reason a key with
// three sharps has F, C and G sharp rather than any other three.
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
// B E A D G C F — the same run backwards, which is why flats undo sharps.
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/**
 * The alterations a signature of `count` sharps or flats applies.
 *
 * Returns { sharps, flats, alter }, where `alter[degree]` is +1, 0 or -1.
 *
 * Returns null for a count that is not a key signature. Eight sharps is not a
 * page in an unusual key, it is a reading that has gone wrong — and altering
 * seven degrees because eight symbols were counted where there are five would
 * put a semitone on notes nothing on the page ever touched.
 */
export function keyFromCount(count, kind) {
  if (!Number.isInteger(count) || count < 0 || count > 7) return null;
  if (kind !== 'sharp' && kind !== 'flat') return null;
  const alter = [0, 0, 0, 0, 0, 0, 0];
  const order = kind === 'sharp' ? SHARP_ORDER : FLAT_ORDER;
  const delta = kind === 'sharp' ? 1 : -1;
  for (let i = 0; i < count; i++) alter[order[i]] = delta;
  return {
    sharps: kind === 'sharp' ? count : 0,
    flats: kind === 'flat' ? count : 0,
    alter,
  };
}

// A page with nothing at the head of the stave, which is also what an unread
// signature falls back to. Named rather than written out at each call site so
// the places that are ASSUMING C major can be found by grepping for it.
export const NO_KEY = keyFromCount(0, 'sharp');
