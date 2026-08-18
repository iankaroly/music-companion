import { describe, test, expect } from 'vitest';
import {
  keyFromCount, SHARP_ORDER, FLAT_ORDER,
  classifyKeyGlyph, keyGlyphStep, readKeySignature, agreeKey, agreeKeyCount,
  agreeKeyReach, findKeyBand, scanKeyBand, agreeNoKey, bareKey,
} from '../src/analysis/scan-key.js';
import { pitchOf } from '../src/analysis/scan-notes.js';

describe('key signatures', () => {
  test('no accidentals is C major — nothing altered', () => {
    const k = keyFromCount(0, 'sharp');
    expect(k.alter).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test('two sharps raises F and C', () => {
    const k = keyFromCount(2, 'sharp');
    expect(k.sharps).toBe(2);
    expect(k.alter[3]).toBe(1); // F
    expect(k.alter[0]).toBe(1); // C
    expect(k.alter[4]).toBe(0); // G untouched
  });

  test('three flats lowers B, E and A', () => {
    const k = keyFromCount(3, 'flat');
    expect(k.flats).toBe(3);
    expect(k.alter[6]).toBe(-1); // B
    expect(k.alter[2]).toBe(-1); // E
    expect(k.alter[5]).toBe(-1); // A
    expect(k.alter[3]).toBe(0); // F untouched
  });

  test('the orders are the orders an engraver writes them in', () => {
    expect(SHARP_ORDER).toEqual([3, 0, 4, 1, 5, 2, 6]); // F C G D A E B
    expect(FLAT_ORDER).toEqual([6, 2, 5, 1, 4, 0, 3]); // B E A D G C F
  });

  test('seven of either alters every degree', () => {
    expect(keyFromCount(7, 'sharp').alter).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(keyFromCount(7, 'flat').alter).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });

  test('more than seven is not a key signature', () => {
    expect(keyFromCount(8, 'sharp')).toBeNull();
    expect(keyFromCount(-1, 'flat')).toBeNull();
    expect(keyFromCount(2.5, 'sharp')).toBeNull();
    expect(keyFromCount(2, 'both')).toBeNull();
  });
});

describe('telling the accidentals apart', () => {
  // The two diagonal corners of the glyph's box, as findKeyBand measures them:
  // rt3 is how much of the top third reaches into the right third, lb3 how much
  // of the bottom third reaches into the left. A sharp fills both, a flat only
  // the bottom-left, a natural neither. The numbers are the middle of each
  // measured range — see the table above classifyKeyGlyph.
  const sharp = { rt3: 0.95, lb3: 0.9 };
  const flat = { rt3: 0.0, lb3: 0.9 };
  const natural = { rt3: 0.3, lb3: 0.3 };

  test('both corners inked is a sharp', () => {
    expect(classifyKeyGlyph(sharp)).toBe('sharp');
  });

  test('an empty top right with a full bottom left is a flat', () => {
    expect(classifyKeyGlyph(flat)).toBe('flat');
  });

  test('two empty corners is a natural', () => {
    expect(classifyKeyGlyph(natural)).toBe('natural');
  });

  test('a run with no shape measured cannot be named', () => {
    expect(classifyKeyGlyph(null)).toBeNull();
    expect(classifyKeyGlyph({ x0: 1, x1: 9 })).toBeNull();
  });

  // THE FOURTH ANSWER, and the reason it has to exist: the three corner
  // patterns above are a PARTITION, so before this every run was one of the
  // three and a plain notehead was an accidental. A down-stemmed crotchet puts
  // its head in the top third of its own box — both corners inked — and its
  // stem down the left of the bottom third, which is a sharp's pattern to the
  // digit. Measured on 288 bare staves with one crotchet where the signature
  // would be, 26 came back with a key and 22 of those said ONE SHARP.
  //
  // What separates it is the STEM leaving the shape window, not the shape: an
  // accidental is printed on the stave and its ink stops inside 2.4 spaces of
  // it, a stem is 3.2 spaces long and does not. Zero of 1331 drawn accidentals
  // reach the bound against 51 of 138 crotchets.
  test('ink that walked out of the window is a notehead, whatever its corners', () => {
    const looksExactlyLikeASharp = { rt3: 0.95, lb3: 0.9 };
    expect(classifyKeyGlyph(looksExactlyLikeASharp)).toBe('sharp');
    expect(classifyKeyGlyph({ ...looksExactlyLikeASharp, ran: true })).toBe('notehead');
  });
});

describe('where an accidental stands', () => {
  // A stave of ten pixels a space with its bottom line at y = 100, so a step is
  // five pixels and step 4 — the middle line — is y = 80.
  const space = 10;
  const bottomY = 100;

  test('a sharp is read from the centre of its ink', () => {
    const step = keyGlyphStep({ inkY: 80, rightY: 80 }, 'sharp', bottomY, space);
    expect(Math.round(step)).toBe(4);
  });

  test('a flat is read from its BOWL, not from its ink', () => {
    // A flat on the middle line: the bowl sits at y = 80, and because the
    // ascender runs about two spaces above it the centre of ALL the flat's ink
    // is up at y = 76 — most of a step high. Reading that would call B flat a C
    // flat and put the semitone on the wrong degree of every bar of the page.
    const glyph = { inkY: 76, rightY: 80 };
    expect(Math.round(keyGlyphStep(glyph, 'flat', bottomY, space))).toBe(4);
    expect(Math.round(keyGlyphStep(glyph, 'sharp', bottomY, space))).toBe(5);
  });
});

describe('reading a whole signature', () => {
  const space = 10;
  const lineY = (k) => 60 + k * 10;        // bottom line at y = 100
  const at = (step, shape) => ({ ...shape, inkY: 100 - step * 5, rightY: 100 - step * 5 });
  const SHARP = { rt3: 0.95, lb3: 0.9 };
  const FLAT = { rt3: 0.0, lb3: 0.9 };
  const NATURAL = { rt3: 0.3, lb3: 0.3 };
  const band = (glyphs) => ({ x0: 0, x1: 40, count: glyphs.length, glyphs });

  test('two sharps in treble are F sharp then C sharp', () => {
    // F5 is the top line, step 8; C5 the third space, step 5.
    const key = readKeySignature(band([at(8, SHARP), at(5, SHARP)]), lineY, space, 'treble');
    expect(key.sharps).toBe(2);
    expect(key.degrees).toEqual([3, 0]);      // F, C
    expect(key.alter[3]).toBe(1);
  });

  test('the same two sharps in BASS sit two steps lower and still read F and C', () => {
    // F3 is the fourth line, step 6; C3 the second space, step 3. Different
    // places on the page, the same two degrees — which is the whole reason the
    // check is made against the degree and not against the step.
    const key = readKeySignature(band([at(6, SHARP), at(3, SHARP)]), lineY, space, 'bass');
    expect(key.sharps).toBe(2);
    expect(key.degrees).toEqual([3, 0]);
  });

  // TENOR, WHICH IS CORE CELLO REPERTOIRE AND WAS WRONG BY TWO DEGREES.
  //
  // A C-clef in tenor position puts middle C on the FOURTH line, so the five
  // lines read D3 F3 A3 C4 E4 and the bottom one is D3, degree 1. The table said
  // degree 3 with a comment claiming F3, which is the second line.
  //
  // The first of these two is the fix and the second is the failure it removes,
  // and the second is the one worth having: the old table did not go quiet on a
  // tenor page, it answered "one sharp, F sharp" — the commonest signature in
  // print, and therefore the answer least likely to be questioned — for a glyph
  // standing on D.
  test('two sharps in TENOR are F sharp then C sharp, two degrees off where bass puts them', () => {
    // F3 is the second line, step 2; C4 the fourth line, step 6.
    const key = readKeySignature(band([at(2, SHARP), at(6, SHARP)]), lineY, space, 'tenor');
    expect(key.sharps).toBe(2);
    expect(key.degrees).toEqual([3, 0]);      // F, C
  });

  test('a lone sharp standing on D in tenor is refused, not read as F sharp', () => {
    // Step 0 is the bottom line, D3. Under the old table it came back
    // { degrees: [3] } — one sharp, F sharp — and so did step 7, an octave up.
    expect(readKeySignature(band([at(0, SHARP)]), lineY, space, 'tenor')).toBeNull();
    expect(readKeySignature(band([at(7, SHARP)]), lineY, space, 'tenor')).toBeNull();
    // …and the two steps that ARE F in tenor both read it, because the check is
    // made on the degree mod 7 and not on the step.
    expect(readKeySignature(band([at(2, SHARP)]), lineY, space, 'tenor').degrees).toEqual([3]);
    expect(readKeySignature(band([at(9, SHARP)]), lineY, space, 'tenor').degrees).toEqual([3]);
  });

  test('two flats in treble are B flat then E flat', () => {
    const key = readKeySignature(band([at(4, FLAT), at(7, FLAT)]), lineY, space, 'treble');
    expect(key.flats).toBe(2);
    expect(key.degrees).toEqual([6, 2]);      // B, E
    expect(key.alter[6]).toBe(-1);
  });

  test('degrees out of the engraver’s order are refused', () => {
    // G sharp before F sharp is not a key signature anybody prints, so it is a
    // scan that has gone wrong — and a wrong key is worse than none.
    expect(readKeySignature(band([at(9, SHARP), at(8, SHARP)]), lineY, space, 'treble')).toBeNull();
  });

  test('a signature that starts at the second sharp is refused', () => {
    expect(readKeySignature(band([at(5, SHARP)]), lineY, space, 'treble')).toBeNull();
  });

  test('a natural is a key CHANGE and this reader has no notion of one', () => {
    // Naturals cancelling two sharps stand exactly where those sharps stood, so
    // the order test cannot catch them: they must be refused on their shape.
    expect(readKeySignature(band([at(8, NATURAL), at(5, NATURAL)]), lineY, space, 'treble')).toBeNull();
  });

  test('a notehead in the band refuses the whole signature', () => {
    // One sharp, correctly placed and correctly shaped, except that its ink ran
    // out of the window on a stem. Without this the page reads G major off a
    // bar of music.
    expect(readKeySignature(band([{ ...at(8, SHARP), ran: true }]), lineY, space, 'treble')).toBeNull();
    // …and it refuses the signature rather than merely dropping the glyph, so a
    // note standing after two real sharps cannot shorten the key to two.
    const withNote = band([at(8, SHARP), at(5, SHARP), { ...at(9, SHARP), ran: true }]);
    expect(readKeySignature(withNote, lineY, space, 'treble')).toBeNull();
  });

  // A CUT SIGNATURE IS A VALID PREFIX, which is the one hole the order check
  // cannot see: four sharps cut to three still reads F, C, G in order. So the
  // scan reports whether it ENDED or was cut off, and a cut band is refused
  // before a degree is read off it. All four of the drawn signatures that used
  // to come back as the WRONG key were cut ones.
  test('a signature the scan cut short is refused, prefix or not', () => {
    const good = band([at(8, SHARP), at(5, SHARP)]);
    expect(readKeySignature(good, lineY, space, 'treble').sharps).toBe(2);
    expect(readKeySignature({ ...good, cut: true }, lineY, space, 'treble')).toBeNull();
  });

  test('a sharp and a flat in one signature is not a signature', () => {
    expect(readKeySignature(band([at(8, SHARP), at(7, FLAT)]), lineY, space, 'treble')).toBeNull();
  });

  test('a clef that could not be named names no line either', () => {
    expect(readKeySignature(band([at(8, SHARP)]), lineY, space, null)).toBeNull();
    expect(readKeySignature(null, lineY, space, 'treble')).toBeNull();
  });

  test('confidence falls as a glyph drifts off its degree', () => {
    const square = readKeySignature(band([at(8, SHARP)]), lineY, space, 'treble');
    const drifted = readKeySignature(band([{ ...SHARP, inkY: 60 - 2, rightY: 60 - 2 }]), lineY, space, 'treble');
    // Not 1: a sharp's ink sits a measured 0.13 of a step above its degree, and
    // that bias is subtracted rather than pretended away, so a glyph dead on its
    // line still leaves a trace of a residual.
    expect(square.confidence).toBeGreaterThan(0.7);
    expect(drifted.confidence).toBeLessThan(square.confidence);
  });
});

describe('how many accidentals the page agrees on', () => {
  // THE STATISTIC USED TO BE THE MINIMUM IN DISGUISE. It indexed the sorted
  // counts at floor((n - 1) * 0.25), which is ZERO for n = 1, 2, 3 and 4 — so
  // any page of four or fewer reporting systems agreed on its lowest reader.
  test('four systems reading 2, 4, 4, 4 agree on FOUR, not on two', () => {
    // An E major page where one system's scan came up short. Under the old
    // index every system's band was trimmed to two glyphs and the third and
    // fourth sharps came back as false circles on all four of them.
    expect(agreeKeyCount([2, 4, 4, 4])).toBe(4);
  });

  test('the low quartile still holds on a long page, which is what it is for', () => {
    // Over-reading is the failure a long page shows, and one system running on
    // into the music must not widen the whole page's suppression.
    expect(agreeKeyCount([1, 1, 1, 1, 1, 3, 4, 5])).toBe(1);
    expect(agreeKeyCount([1, 1, 1, 1, 2, 2, 2, 2, 3, 4])).toBe(1);
  });

  test('a single outlier either way cannot carry a page of eight', () => {
    expect(agreeKeyCount([4, 4, 4, 4, 4, 4, 4, 1])).toBe(4);
    expect(agreeKeyCount([1, 1, 1, 1, 1, 1, 1, 7])).toBe(1);
  });

  test('below four witnesses there is no quorum, and the answer is the narrowest', () => {
    // Three quarters of three, rounded up, is three — so this statistic cannot
    // be anything but the minimum here. It is declared rather than discovered,
    // and the minimum is the safe direction: the trim can only narrow a band.
    expect(agreeKeyCount([2, 4, 4])).toBe(2);
    expect(agreeKeyCount([1, 5])).toBe(1);
    expect(agreeKeyCount([3])).toBe(3);
  });

  test('systems that found no band at all do not count as witnesses', () => {
    expect(agreeKeyCount([0, 0, 0, 0])).toBeNull();
    expect(agreeKeyCount([])).toBeNull();
    // …and four zeros beside four fours is a page of four witnesses, not eight.
    expect(agreeKeyCount([0, 0, 0, 0, 2, 4, 4, 4])).toBe(4);
  });
});

describe('agreeing across the page', () => {
  const oneSharp = { kind: 'sharp', sharps: 1, flats: 0, count: 1, alter: [0, 0, 0, 1, 0, 0, 0] };
  const twoSharps = { kind: 'sharp', sharps: 2, flats: 0, count: 2, alter: [1, 0, 0, 1, 0, 0, 0] };
  const oneFlat = { kind: 'flat', sharps: 0, flats: 1, count: 1, alter: [0, 0, 0, 0, 0, 0, -1] };

  test('eleven systems agreeing is reported with the count that says so', () => {
    const out = agreeKey(new Array(11).fill(oneSharp));
    expect(out.key.sharps).toBe(1);
    expect(out.systems).toBe(11);
    expect(out.read).toBe(11);
    expect(out.agreed).toBe(11);
  });

  // THIS TEST USED TO ASSERT THE OPPOSITE and the contract is what changed, not
  // the arithmetic. It read "one system of eleven is still an answer", because
  // the majority test `best * 2 <= read.length` is `2 <= 1` for a single reader
  // — false — so one system carried the page and "unanimous" was reported for
  // it. That is the route a phantom key takes onto a page: a bare stave with a
  // down-stemmed crotchet at the head of it reads one sharp at confidence up to
  // 0.99, and one such system was enough to put a semitone on every F.
  //
  // A key signature is printed on EVERY system, so a second witness is free on
  // a page that has one — the three marked pages read 4 of 4, 7 of 7 and 10 of
  // 10 in agreement. One system reading something ten others do not confirm is
  // not a page in that key.
  test('one system of eleven is NOT an answer — a page needs a second witness', () => {
    const out = agreeKey([oneSharp, ...new Array(10).fill(null)]);
    expect(out.key).toBeNull();
    expect(out.read).toBe(1);
    expect(out.agreed).toBe(0);
    expect(out.systems).toBe(11);
  });

  test('two systems of eleven agreeing IS an answer', () => {
    const out = agreeKey([oneSharp, oneSharp, ...new Array(9).fill(null)]);
    expect(out.key.sharps).toBe(1);
    expect(out.read).toBe(2);
    expect(out.agreed).toBe(2);
  });

  test('a page whose systems disagree has no key, not the commoner half', () => {
    expect(agreeKey([oneSharp, oneSharp, twoSharps, twoSharps]).key).toBeNull();
    expect(agreeKey([oneSharp, twoSharps, oneFlat]).key).toBeNull();
  });

  test('a majority of what was read carries it', () => {
    const out = agreeKey([oneSharp, oneSharp, oneSharp, twoSharps, null]);
    expect(out.key.sharps).toBe(1);
    expect(out.agreed).toBe(3);
    expect(out.read).toBe(4);
  });

  test('a page where nothing read a signature has no key', () => {
    const out = agreeKey([null, null, null]);
    expect(out.key).toBeNull();
    expect(out.read).toBe(0);
  });
});

// THE BAND MAY EAT FURNITURE. IT MAY NEVER EAT MUSIC.
//
// dropFurniture deletes every notehead whose x falls inside the band
// findKeyBand returns, so a note the band covers is a note gone from the page.
// These two are the pixel-level regressions behind that property, drawn into an
// ink array rather than rendered, so they run in the unit suite with no browser
// and no font. The corpus-scale version is `npm run scan:key-safety`.
describe('the band never eats music', () => {
  const space = 12;
  const W = 260;
  const H = 190;
  const lineY = (k) => 60 + k * space;

  const page = (w = W, h = H) => new Uint8Array(w * h);
  const put = (ink, x, y, w = W, h = H) => {
    if (x >= 0 && x < w && y >= 0 && y < h) ink[y * w + x] = 1;
  };
  const staff = (ink, from = 0, w = W, h = H) => {
    for (let k = 0; k < 5; k++) for (let x = from; x < w; x++) put(ink, x, lineY(k), w, h);
  };
  // A crotchet: a solid ellipse with a stem up its right-hand side.
  const crotchet = (ink, hx, hy, w = W, h = H) => {
    const rx = space * 0.62;
    const ry = space * 0.46;
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) put(ink, hx + dx, hy + dy, w, h);
      }
    }
    const sx = hx + Math.round(rx);
    for (let k = 0; k <= Math.round(space * 3.5); k++) {
      put(ink, sx, hy - k, w, h); put(ink, sx + 1, hy - k, w, h);
    }
  };

  // The reviewer's own fixture. The stave's lines are at y = 60..108, so the
  // scan's window runs 46 to 122; the note's ink runs 84 to 132, four spaces.
  // Measured inside the window alone it came back 85 to 122 — clipped at the
  // window's own edge — which is 3.17 spaces against GLYPH_TALL's ceiling of
  // 3.2, so the height test took the note for an accidental. The two-pixel
  // fleck at x = 92 is what walks the scan across the blank paper to it.
  test('a fleck of grain does not hand the first note to the key band', () => {
    const ink = page();
    staff(ink);
    crotchet(ink, 96, lineY(4) + 18);
    put(ink, 92, 84);
    put(ink, 92, 85);
    const band = findKeyBand(ink, W, H, lineY, space, 78);
    // Either no band at all, or one that stops short of the note. The property
    // is about the NOTE, not about whether the fleck is reported.
    if (band) expect(96 < band.x0 || 96 > band.x1).toBe(true);
    else expect(band).toBeNull();
  });

  // The same note with no fleck at all. A CONTROL — it passes on the old code
  // as well, and that is the point of it: it says the test above is about the
  // fleck walking the scan across the paper, so that nobody "fixes" the one
  // above by making the scan refuse to step over grain, which is the change
  // that took the key bands from 6 systems of 11 to 29 of 32.
  test('a note two spaces past the clef is not a key signature', () => {
    const ink = page();
    staff(ink);
    crotchet(ink, 96, lineY(4) + 18);
    expect(findKeyBand(ink, W, H, lineY, space, 78)).toBeNull();
  });

  // The same question at the other end of the window — a note hung ABOVE the
  // stave, whose stem tip is at y = 6 against a window top of 46.
  //
  // A CONTROL, and it is labelled one because it passes on the old code too:
  // clipping a note from ABOVE leaves the head and most of the stem inside the
  // window, so what is left still measures over the ceiling and the height test
  // ended the scan on it as designed. It is the bottom of the window that was
  // dangerous, because a note hanging below it leaves only stem inside. Kept so
  // that a future change to the window is measured at both ends.
  test('a note above the stave measures its own height, not the window\'s', () => {
    const ink = page();
    staff(ink);
    crotchet(ink, 96, lineY(0) - 12);
    put(ink, 92, 84);
    put(ink, 92, 85);
    const band = findKeyBand(ink, W, H, lineY, space, 78);
    if (band) expect(96 < band.x0 || 96 > band.x1).toBe(true);
  });

  // THE CLEF-OVERHANG WALK READ THE NEXT ROW'S PIXELS.
  //
  // `limit` is clamped to w - 1 and the overhang walk was not, so on a stave
  // whose left edge is within two spaces of the right edge of the image — a
  // crop, or a fragment — `column` was called with x >= w and indexed
  // ink[y * w + x] straight into row y + 1.
  //
  // ASSERTED AS AN OUT-OF-BOUNDS READ AND NOT AS A CHANGED BAND, because it
  // cannot be a changed band and that is worth writing down. A walk that
  // reaches the right-hand edge leaves `from` at w or past it, and `limit` is
  // itself clamped to w - 1, so the glyph loop never runs and findKeyBand
  // returns null with the clamp and without it. The defect is real and silent:
  // it reads pixels belonging to another row of the image and decides how far
  // to step over the clef on them. So the ink is handed over behind a proxy
  // that refuses any index past the end of the page, and the page is cut off
  // one row below the scan's own window so that a wrapped read lands there.
  test('the clef-overhang walk does not read past the end of the page', () => {
    const w = 92;
    const h = 123;                       // bottom of the scan window is 122 = h - 1
    const raw = new Uint8Array(w * h);
    for (let k = 0; k < 5; k++) for (let x = 0; x < w; x++) put(raw, x, lineY(k), w, h);
    // Ink taller than any accidental, running to the right-hand edge, so the
    // walk keeps stepping and reaches it. The scan opens at 78 and the walk is
    // entitled to two spaces, which is x = 102 on a page only 92 wide.
    for (let x = 78; x < w; x++) for (let y = 50; y <= 120; y++) put(raw, x, y, w, h);
    const guarded = new Proxy(raw, {
      get(t, prop) {
        if (typeof prop === 'string' && /^[0-9]+$/.test(prop) && Number(prop) >= t.length) {
          throw new Error(`read past the end of the page: index ${prop} of ${t.length}`);
        }
        return Reflect.get(t, prop);
      },
    });
    expect(() => findKeyBand(guarded, w, h, lineY, space, 78)).not.toThrow();
  });
});

// THE PAGE THAT PRINTS NO KEY SIGNATURE AT ALL.
//
// These pin the shape of the rule rather than the pixels: what a system has to
// report before it counts as a witness for bare paper, and what a page has to
// hold before it may name itself C major. The pixels are gated by the third
// block of `npm run scan:key-safety`, which draws whole pages through readPage,
// because a rule that needs two systems cannot be seen one stave at a time —
// the same reason the widening has a block there.
describe('a page with no key signature', () => {
  const space = 12;
  const W = 260;
  const H = 190;
  const lineY = (k) => 60 + k * space;
  const page = () => new Uint8Array(W * H);
  const put = (ink, x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) ink[y * W + x] = 1; };
  const staff = (ink) => {
    for (let k = 0; k < 5; k++) for (let x = 0; x < W; x++) put(ink, x, lineY(k));
  };
  const crotchet = (ink, hx, hy) => {
    const rx = space * 0.62;
    const ry = space * 0.46;
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) put(ink, hx + dx, hy + dy);
      }
    }
    const sx = hx + Math.round(rx);
    for (let k = 0; k <= Math.round(space * 3.5); k++) { put(ink, sx, hy - k); put(ink, sx + 1, hy - k); }
  };

  // The distinguishing measurement itself. Bare paper past the clef with the
  // music well clear of it is the ONE case that counts as evidence, and it is
  // distinguished by the SCAN'S OWN VERDICT rather than by any threshold on
  // ink — see the note above scanKeyBand for why every ink test tried failed on
  // a bass clef, whose two dots stand where the first sharp of every sharp
  // signature stands.
  test('bare paper past the clef reports itself empty', () => {
    const ink = page();
    staff(ink);
    crotchet(ink, 150, lineY(4) + 18);          // six spaces clear of the scan's start
    const scan = scanKeyBand(ink, W, H, lineY, space, 78);
    expect(scan.band).toBeNull();
    expect(scan.why).toBe('gap');
    expect(scan.empty).toBe(true);
  });

  // …and the case that must NOT count, which is the whole of the difference
  // between this and "the band came back null". A note standing where the
  // signature would be is ink in the signature's own place that could not be
  // identified, and calling that bare paper is how a page in five flats gets
  // named C major.
  test('a note standing where the signature would be is not bare paper', () => {
    const ink = page();
    staff(ink);
    crotchet(ink, 96, lineY(4) + 18);           // inside KEY_ADJACENT of the scan's start
    const scan = scanKeyBand(ink, W, H, lineY, space, 78);
    expect(scan.band).toBeNull();               // the same null findKeyBand returns
    expect(scan.empty).toBe(false);             // and emphatically not bare paper
  });

  test('findKeyBand still returns exactly the band, and null for both', () => {
    const ink = page();
    staff(ink);
    crotchet(ink, 150, lineY(4) + 18);
    expect(findKeyBand(ink, W, H, lineY, space, 78)).toBeNull();
  });

  // ONE SYSTEM IS NOT A PAGE. The measured price of allowing it is one drawn
  // page in two sharps, photographed, naming itself C major — see the sweep
  // above agreeNoKey.
  test('one bare system does not name a page', () => {
    expect(agreeNoKey([{ scanned: true, empty: true, key: null }]).bare).toBe(false);
  });

  test('two bare systems do', () => {
    const say = agreeNoKey([
      { scanned: true, empty: true, key: null },
      { scanned: true, empty: true, key: null },
    ]);
    expect(say.bare).toBe(true);
    expect(say.scanned).toBe(2);
    expect(say.empty).toBe(2);
  });

  // The Bach's system 3 in miniature: a system that ran the scan over a plainly
  // printed sharp and accepted nothing. One such system among bare ones must
  // stop the page, which is why the test is "every system that looked", not
  // "most of them".
  test('one system that looked and did not find bare paper stops the page', () => {
    expect(agreeNoKey([
      { scanned: true, empty: true, key: null },
      { scanned: true, empty: true, key: null },
      { scanned: true, empty: false, key: null },
    ]).bare).toBe(false);
  });

  // A system that never ran the scan — no left edge, or no clef to measure the
  // band from — is not a witness either way, so it neither helps nor blocks.
  test('a system that never ran the scan is not a witness', () => {
    expect(agreeNoKey([
      { scanned: true, empty: true, key: null },
      { scanned: true, empty: true, key: null },
      { scanned: false, empty: false, key: null },
    ]).bare).toBe(true);
    expect(agreeNoKey([
      { scanned: true, empty: true, key: null },
      { scanned: false, empty: false, key: null },
    ]).bare).toBe(false);
  });

  // Stated separately from the line above because it is the property that
  // matters and a later change to `empty` must not be able to lose it quietly.
  test('a page where anything read a key is never bare', () => {
    expect(agreeNoKey([
      { scanned: true, empty: true, key: null },
      { scanned: true, empty: true, key: { kind: 'sharp', count: 1 } },
    ]).bare).toBe(false);
  });

  test('a page with no staves at all is not C major', () => {
    expect(agreeNoKey([]).bare).toBe(false);
    expect(agreeNoKey(undefined).bare).toBe(false);
  });

  // What such a page's key IS. C major alters nothing, and it says so with a
  // kind of its own so that a caller can tell "read as empty" from "not
  // decided" — pitchOf needs `alter`, and null is still never defaulted.
  test('the key it names alters nothing and says where it came from', () => {
    const k = bareKey();
    expect(k.alter).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(k.count).toBe(0);
    expect(k.kind).toBe('none');
    expect(pitchOf(0, 'bass', k).midi).toBe(43);   // the bottom line of a bass stave is G2
  });

  // NO_KEY is a module-level constant, so a page carrying a key that shares its
  // array would let one caller's mutation reach every page ever read.
  test('each page gets its own alter array', () => {
    expect(bareKey().alter).not.toBe(bareKey().alter);
  });
});

describe('how far the page prints its key signature', () => {
  const sharp = { kind: 'sharp', sharps: 1, flats: 0, count: 1 };

  test('the upper middle, not the lower — the Bach page, to the digit', () => {
    // Its four witnesses reach 4.87, 4.88, 5.20 and 5.46 staff spaces past the
    // stave's left end, and its false circles on the unread systems stand at
    // x = 93 where the lower middle puts the band's end at 93.0. Under-reading
    // is the failure being repaired, so the short witnesses are the broken ones
    // and a statistic they can decide buys nothing.
    const reach = agreeKeyReach([
      { key: sharp, reach: 5.46 },
      { key: sharp, reach: 4.87 },
      { key: sharp, reach: 5.20 },
      { key: sharp, reach: 4.88 },
    ]);
    expect(reach).toBeCloseTo(5.20, 5);
  });

  test('a system that read no key is not a witness to where the signature ends', () => {
    // Its band is exactly the thing that went wrong, so its reach is evidence
    // about nothing. Three systems here, only two of them read anything.
    expect(agreeKeyReach([
      { key: null, reach: 0.4 },
      { key: sharp, reach: 6.4 },
      { key: sharp, reach: 6.6 },
    ])).toBeCloseTo(6.6, 5);
  });

  test('one witness is not a page agreeing with itself', () => {
    expect(agreeKeyReach([{ key: sharp, reach: 6.4 }, { key: null, reach: 0.4 }])).toBe(null);
    expect(agreeKeyReach([])).toBe(null);
    expect(agreeKeyReach([null, null])).toBe(null);
  });

  test('a system with no left edge, and a band of no width, are not witnesses', () => {
    // A reach of NaN is a system whose edge was never found; zero or less is a
    // band that ends at or before the stave's own start, which is not a
    // measurement of anything. Neither may drag the page's answer.
    expect(agreeKeyReach([
      { key: sharp, reach: NaN },
      { key: sharp, reach: 0 },
      { key: sharp, reach: 6.4 },
    ])).toBe(null);
  });
});
