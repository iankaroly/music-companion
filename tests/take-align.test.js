// THE WHOLE TAKE AGAINST THE WHOLE PAGE, note by note.
//
// The map a bar press reads is anchors and a straight line between them, and
// until now the anchors came one to a system at best — so between two of them
// the line assumed the tempo did not move, and a player's tempo moves. This is
// the pass that gives an anchor a BAR instead, which is a short enough distance
// for a straight line to be an interpolation rather than an assumption.
//
// What is held down here is the part that would fail silently: that it finds
// the right stretch of the page when the take starts half way down, that it
// survives notes left out and notes played wrong, and — most of all — that it
// REFUSES a take that is not this music, because a dense wrong map is worse
// than a sparse right one. Every bar of it looks equally confident.
import { describe, it, expect } from 'vitest';
import { alignTake, anchorsFromPath } from '../src/analysis/take-align.js';

// A page of noteheads: a walk in staff positions, one entry a head, carrying
// where it sits in the piece the way headsInReadingOrder measures it.
function pageOf(count, seed = 7) {
  let step = 0;
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const heads = [];
  for (let i = 0; i < count; i += 1) {
    step += Math.round((rnd() - 0.5) * 5);
    step = Math.max(-4, Math.min(12, step));
    heads.push({ step, at: i / 20 });          // twenty heads to a system
  }
  return heads;
}

// The take: a stretch of the page played, a step turned into a semitone through
// a major scale so the two vocabularies line up the way they do in real
// playing. Nothing under test ever sees this mapping.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const toMidi = (step) => 48 + 12 * Math.floor(step / 7) + MAJOR[((step % 7) + 7) % 7];

function playOf(heads, fromIndex, count, { drop = 0, wrong = 0, seed = 3, pace = () => 0.5 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = [];
  let t = 0;
  for (let k = 0; k < count; k += 1) {
    const head = heads[fromIndex + k];
    if (!head) break;
    t += pace(k);
    if (rnd() < drop) continue;
    const off = rnd() < wrong ? (rnd() < 0.5 ? 1 : -1) : 0;
    out.push({ midi: toMidi(head.step) + off, start: t });
  }
  return out;
}

describe('lining a take up against a page, note by note', () => {
  const heads = pageOf(200);

  it('finds the stretch a take was played from, when it starts half way down', () => {
    const played = playOf(heads, 90, 60);
    const out = alignTake(heads, played);
    expect(out.placed).toBe(true);
    // The first pair is the first note of the take, on the head it was played
    // from — the entry point, found with nothing said about where it began.
    expect(Math.abs(out.pairs[0].head.at - heads[91].at)).toBeLessThan(0.6);
    expect(out.matched).toBeGreaterThan(40);
  });

  it('follows a take whose tempo moves, which a straight line cannot', () => {
    // Slowing steadily from a half-second a note to a second and a half.
    const played = playOf(heads, 40, 70, { pace: (k) => 0.5 + k * 0.015 });
    const out = alignTake(heads, played);
    expect(out.placed).toBe(true);
    // Every pair is on its own head: the path does not care about tempo at all,
    // because it compares intervals and never a second.
    const slipped = out.pairs.filter((one, k) => k > 0
      && Math.abs(one.head.at - out.pairs[k - 1].head.at) > 1.5);
    expect(slipped.length).toBe(0);
  });

  it('survives notes left out and notes played wrong', () => {
    const played = playOf(heads, 20, 80, { drop: 0.1, wrong: 0.05 });
    const out = alignTake(heads, played);
    expect(out.placed).toBe(true);
    expect(out.share).toBeGreaterThan(0.5);
  });

  it('refuses a take that is not this music', () => {
    // The same length and the same range, and none of it is on the page.
    let s = 11;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const played = Array.from({ length: 60 }, (_, i) => ({
      midi: 48 + Math.floor(rnd() * 24), start: i * 0.5,
    }));
    const out = alignTake(heads, played);
    expect(out.placed).toBe(false);
    expect(out.why).toMatch(/does not follow the shape/);
  });

  it('refuses rather than guessing on too little of anything', () => {
    expect(alignTake(heads, playOf(heads, 0, 5)).placed).toBe(false);
    expect(alignTake(pageOf(6), playOf(heads, 0, 40)).placed).toBe(false);
    expect(alignTake(null, null).placed).toBe(false);
  });

  it('runs forwards, which the map it feeds cannot check for itself', () => {
    const played = playOf(heads, 30, 60);
    const out = alignTake(heads, played);
    for (let k = 1; k < out.pairs.length; k += 1) {
      expect(out.pairs[k].time).toBeGreaterThanOrEqual(out.pairs[k - 1].time);
      expect(out.pairs[k].at).toBeGreaterThanOrEqual(out.pairs[k - 1].at);
    }
  });
});

describe('thinning a path to one anchor a bar', () => {
  // Four bars, half a system each.
  const bars = [
    { at: 0, to: 0.5 }, { at: 0.5, to: 1 }, { at: 1, to: 1.5 }, { at: 1.5, to: 2 },
  ];
  const pairs = [];
  for (let i = 0; i < 40; i += 1) pairs.push({ at: i / 20, time: i * 0.5 });

  it('gives one anchor a bar and no more', () => {
    const out = anchorsFromPath(pairs, bars);
    expect(out.length).toBe(4);
  });

  it('takes a real pair rather than an average of two', () => {
    const out = anchorsFromPath(pairs, bars);
    for (const one of out) {
      expect(pairs.some((p) => p.at === one.at && p.time === one.time)).toBe(true);
    }
  });

  it('climbs, so the map it feeds is in order', () => {
    const out = anchorsFromPath(pairs, bars);
    for (let k = 1; k < out.length; k += 1) {
      expect(out[k].at).toBeGreaterThan(out[k - 1].at);
      expect(out[k].time).toBeGreaterThan(out[k - 1].time);
    }
  });

  it('says nothing about bars the path never reached', () => {
    const short = pairs.filter((p) => p.at < 1);
    expect(anchorsFromPath(short, bars).length).toBe(2);
    expect(anchorsFromPath([], bars)).toEqual([]);
  });
});
