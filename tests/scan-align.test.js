import { describe, it, expect } from 'vitest';
import { findStart } from '../src/analysis/scan-align.js';

// A part, as steps on the stave.
//
// Long and varied on purpose. A short line is self-similar — forty-eight notes
// of anything contains its own shape several times over — and testing against
// one measures the fixture rather than the method. This is a hundred and
// twenty notes built from a fixed pseudo-random walk: reproducible, no scale
// to lean on, and about as self-similar as a real movement.
const PART = (() => {
  const out = [];
  let at = 0;
  let seed = 20260814;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 120; i++) {
    const r = next();
    // Mostly steps and thirds, the occasional leap, the occasional repeat.
    const move = r < 0.1 ? 0 : (r < 0.55 ? 1 : (r < 0.85 ? 2 : 4));
    at += next() < 0.5 ? -move : move;
    at = Math.max(-6, Math.min(12, at));
    out.push(at);
  }
  return out;
})();

const heads = (steps) => steps.map((step, i) => ({ step, x: i / steps.length, y: 0.5 }));

// A take is played AT some pitch, so the semitones are not the steps — but
// they move the same way, which is the whole premise. This turns steps into
// something a cello would produce: a diatonic-ish line, transposed, with the
// odd interval that a major scale would not give.
const played = (steps, from = 48) => steps.map((step, i) => ({
  midi: from + Math.round(step * 12 / 7), start: i * 0.4, cents: 0,
}));

describe('finding where a take starts on a scanned part', () => {
  it('places a take that begins at the beginning', () => {
    const found = findStart(heads(PART), played(PART.slice(0, 40)));
    expect(found.sure).toBe(true);
    expect(found.offset).toBe(0);
  });

  it('places a take that begins on the second page', () => {
    // The bug reported: a title page, then the music. Forty notes played from
    // the seventieth notehead of the part — everything before it is a page the
    // player never touched.
    const found = findStart(heads(PART), played(PART.slice(70, 110)));
    expect(found.sure).toBe(true);
    expect(found.offset).toBe(70);
  });

  it('places a take that begins somewhere in the middle', () => {
    const found = findStart(heads(PART), played(PART.slice(45, 90)));
    expect(found.sure).toBe(true);
    expect(found.offset).toBe(45);
  });

  it('is unmoved by the clef, because a clef changes no direction', () => {
    // The same shape written an octave and a half lower — which is what
    // reading a treble part in bass clef would do to every note at once.
    const found = findStart(heads(PART), played(PART.slice(30, 75), 36));
    expect(found.sure).toBe(true);
    expect(found.offset).toBe(30);
  });

  it('refuses a take that is not this music at all', () => {
    const nothingLike = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9, 0, 5, 1, 6, 2, 7]
      .map((step, i) => ({ midi: 48 + step, start: i * 0.4, cents: 0 }));
    const found = findStart(heads(PART), nothingLike);
    expect(found.sure).toBe(false);
    expect(found.why).toMatch(/shape|same in more than one place/);
  });

  it('refuses a passage that looks the same in two places', () => {
    // A part that literally repeats: the same thirty notes twice over. There
    // is no right answer, and inventing one puts every mark on the wrong half.
    const twice = [...PART.slice(0, 30), ...PART.slice(0, 30)];
    const found = findStart(heads(twice), played(PART.slice(0, 25)));
    expect(found.sure).toBe(false);
  });

  it('refuses to place a take too short to mean anything', () => {
    const found = findStart(heads(PART), played(PART.slice(5, 9)));
    expect(found.sure).toBe(false);
    expect(found.why).toMatch(/too few/);
  });

  it('says so when the page reader measured no positions', () => {
    const unmeasured = PART.map((_, i) => ({ x: i / PART.length, y: 0.5 }));
    const found = findStart(unmeasured, played(PART.slice(0, 40)));
    expect(found.sure).toBe(false);
    expect(found.why).toMatch(/did not measure/);
  });

  it('reports a margin, so a thin win can be refused rather than trusted', () => {
    const clear = findStart(heads(PART), played(PART.slice(70, 110)));
    expect(clear.margin).toBeGreaterThan(0.12);
  });
});
