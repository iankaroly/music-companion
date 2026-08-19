// A page of real music, drawn, for the checks that need a page they know the
// answer to.
//
// WHY THIS EXISTS, and it is a story worth keeping. Four of this repo's browser
// checks — score:playback, score:review, score:scan and score:agree — built
// their pages out of drawn ELLIPSES: five staff lines, a stem, an oval. No clef.
// That was fine while the review would place a take on any page it could find
// noteheads on, and it stopped being fine the day that changed: a page with no
// clef prices no head, so the pairing has nothing to match on, and the review
// now refuses rather than putting rings somewhere they might not belong (see
// `pairByShape` in scan-view.js — the contour route put 70% of its marks on the
// WRONG notehead, measured over 32 studies).
//
// So twenty-nine assertions about the REVIEW — the rings, their colours, the
// press that opens a close-up, the light that follows the playback, the two
// views agreeing note for note — were all failing for one reason, and the
// reason was the fixture rather than the app. A check that has been red for
// weeks measures nothing, and the surface it stopped measuring is the one a
// player complains about most.
//
// The answer is not to soften the app back. It is to give the fixture what a
// page of music has: a clef, a key signature, and noteheads printed in Bravura
// where a reader can find them. `score:follow` has drawn its pages this way all
// along and reads them on the PITCH route; this is that builder, lifted out so
// the others share one engraving rather than four hand-drawn approximations of
// one.

const GLYPH = {
  black: '\u{E0A4}',
  fClef: '\u{E062}',
  gClef: '\u{E050}',
  sharp: '\u{E262}',
};

/** Bravura, from bytes the tool read off disk. Idempotent. */
export async function useBravura(base64) {
  if (typeof document === 'undefined') return false;
  const face = new FontFace('Bravura', `url(data:font/otf;base64,${base64})`);
  await face.load();
  document.fonts.add(face);
  return true;
}

// A line with a shape: a walk that moves by a step or a third and turns around
// at the edges, so what is written is neither a scale nor a scatter. Written
// down as STEPS on the stave, which is what the reader measures.
function stepsOf(seedStart, count) {
  let seed = seedStart;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const out = [];
  let at = 2;
  for (let i = 0; i < count; i++) {
    const r = rnd();
    at += (rnd() < 0.5 ? -1 : 1) * (r < 0.5 ? 1 : (r < 0.85 ? 2 : 3));
    at = Math.max(-2, Math.min(9, at));
    out.push(at);
  }
  return out;
}

/**
 * One page. Returns the canvas and where every notehead was PRINTED, in the
 * page's own 0-1 terms, with the step it sits on.
 *
 * The clef is a bass clef by default because a cello part is one; the key is
 * one sharp because a page with a clef and NO signature prices no head either —
 * agreeKey cannot agree a signature nobody printed, and rule 5 says an unknown
 * key is null rather than C major.
 */
export function engravePage({
  space = 14, systems = 4, perSystem = 12, seed = 20260818, clef = 'bass',
} = {}) {
  const steps = stepsOf(seed, perSystem * systems);
  const W = Math.round(space * 62);
  const H = Math.round(space * (10 + systems * 13 + 6));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#111';
  const em = space * 4;
  const put = (ch, x, y) => {
    g.font = `${em}px Bravura`;
    g.textBaseline = 'alphabetic';
    g.fillText(ch, x, y);
    return g.measureText(ch).width;
  };
  const wid = (ch) => { g.font = `${em}px Bravura`; return g.measureText(ch).width; };
  const thick = Math.max(1, space * 0.1);
  const places = [];
  for (let sys = 0; sys < systems; sys++) {
    const base = space * 8 + sys * space * 13;
    const lineY = (l) => base + l * space;
    const stepY = (st) => lineY(4) - st * (space / 2);
    for (let l = 0; l < 5; l++) g.fillRect(space * 2, lineY(l), W - space * 4, thick);
    let x = space * 3;
    x += put(clef === 'treble' ? GLYPH.gClef : GLYPH.fClef,
      x, clef === 'treble' ? lineY(3) : lineY(1)) + space * 0.5;
    // The one sharp, where that clef prints it.
    x += put(GLYPH.sharp, x, stepY(clef === 'treble' ? 8 : 6)) + space * 0.6;
    const startX = x + space;
    const usable = (W - space * 3) - startX;
    const gap = usable / (perSystem + 0.6);
    for (let i = 0; i < perSystem; i++) {
      const st = steps[sys * perSystem + i];
      const cx = startX + gap * (i + 0.6);
      const y = stepY(st);
      const gw = wid(GLYPH.black);
      for (let s2 = 10; s2 <= st; s2 += 2) g.fillRect(cx - gw * 0.75, stepY(s2), gw * 1.5, thick);
      for (let s2 = -2; s2 >= st; s2 -= 2) g.fillRect(cx - gw * 0.75, stepY(s2), gw * 1.5, thick);
      put(GLYPH.black, cx - gw / 2, y);
      const up = st < 4;
      const sx = up ? cx + gw / 2 - thick : cx - gw / 2;
      g.fillRect(sx, up ? y - space * 3.2 : y, Math.max(1, thick), space * 3.2);
      // A barline every four notes, so the page has bars to be timed against.
      if (i % 4 === 3 && i !== perSystem - 1) {
        g.fillRect(cx + gap * 0.5, lineY(0), Math.max(1, thick * 1.2), lineY(4) - lineY(0));
      }
      places.push({ x: cx / W, y: y / H, step: st });
    }
    g.fillRect(W - space * 2.4, lineY(0), Math.max(1, thick * 1.6), lineY(4) - lineY(0));
  }
  return { canvas: c, places, width: W, height: H };
}

/**
 * A whole part: `pages` engraved pages, stored as a score, with what is WRITTEN
 * on them priced through the app's own pitchOf — so a take built from `written`
 * is a take of that page by construction, and the check is measuring the review
 * rather than an argument between two ideas of what the page says.
 */
export async function engravePart({
  base64, name = 'Engraved part', pages = 2, clef = 'bass', seed = 20260818, ...rest
} = {}) {
  if (base64) await useBravura(base64);
  const { pitchOf } = await import('../analysis/scan-notes.js');
  const { keyFromCount } = await import('../analysis/scan-key.js');
  const KEY = keyFromCount(1, 'sharp');
  const drawn = [];
  for (let i = 0; i < pages; i++) {
    drawn.push(engravePage({ ...rest, clef, seed: seed + i * 7919 }));
  }
  const blobs = await Promise.all(drawn
    .map((p) => new Promise((done) => p.canvas.toBlob(done, 'image/png'))));
  const { savePagesScore } = await import('../store/db.js');
  const scoreId = await savePagesScore({
    name, source: 'images', pageCount: blobs.length, pages: blobs,
  });
  const written = drawn.flatMap((p, page) => p.places.map((place) => ({
    ...place,
    page,
    midi: pitchOf(place.step, clef, KEY)?.midi ?? null,
  })));
  return { scoreId, written, pages: drawn.length };
}

/**
 * A take played FROM what is written: `count` notes from `from`, at `spacing`
 * seconds apart, with the notes at `skip` (indices into the run) left out — the
 * player turning two pages and missing a few, which is what a review has to
 * survive.
 */
export function takeFromWritten(written, {
  from = 0, count = 40, spacing = 0.4, sounding = 0.3, lead = 0.6, skip = [],
} = {}) {
  const run = written.slice(from, from + count).filter((w) => Number.isFinite(w.midi));
  const notes = [];
  run.forEach((w, i) => {
    if (skip.includes(i)) return;
    const start = lead + notes.length * spacing;
    notes.push({
      midi: w.midi,
      name: null,
      cents: ((i * 29) % 41) - 20,
      start,
      end: start + sounding,
      frequency: 440 * 2 ** ((w.midi - 69) / 12),
    });
  });
  return notes;
}
