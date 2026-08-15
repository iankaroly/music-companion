// How long each note is, read off the page.
//
// A notehead's duration is written in three things and this reads all three:
// whether the head is filled or hollow, whether it has a stem, and how many
// beams cross that stem. Nothing else about the note is needed — a semibreve
// is the hollow one with no stem, a minim the hollow one with a stem, and
// everything filled is a crotchet halved once per beam.
//
// The beams come free. beamMask already finds them, because finding them is
// how it stops them being mistaken for noteheads: it returns the page with the
// beams taken OUT, so the pixels it removed — the ones in the original and not
// in the result — are the beams themselves. Nothing has to look for them twice.
//
// WHAT IS NOT READ, AND WHAT HAPPENS INSTEAD
//
// A flag — the curl on a single unbeamed quaver — is not read. It is a shape
// next to the stem end, and telling it from a slur or a tie is a different and
// much less certain job than counting the bars crossing a stem. So an unbeamed
// filled head is called a crotchet, and where that is wrong the bar it is in
// will not add up and will be refused. Dots are not read either, with the same
// consequence. Both of those are the bar sum's problem, and the bar sum is
// built to have exactly that problem — see scan-values.js.

// Crotchet beats, by how many beams cross the stem.
const BY_BEAMS = [1, 0.5, 0.25, 0.125, 0.0625];

/**
 * The beams, as their own layer: everything beamMask took out.
 *
 * A slur long and thin enough to be removed lands in here too, which is why a
 * beam is only counted where it crosses a STEM — a slur does not.
 */
export function beamLayer(ink, body) {
  const beams = new Uint8Array(ink.length);
  for (let i = 0; i < ink.length; i++) beams[i] = ink[i] && !body[i] ? 1 : 0;
  return beams;
}

// Which way the stem goes, and how far. Looked for at both sides of the head,
// because a stem is drawn up on the right and down on the left, and a page has
// both on every line.
function findStem(ink, w, h, head, space) {
  const reach = Math.round(space * 4.5);
  const inset = Math.max(1, Math.round(space * 0.5));
  const best = { dir: 0, x: 0, length: 0 };
  for (const [side, dir] of [[1, -1], [-1, 1]]) {
    // Up on the right, down on the left: the usual engraving, and the only
    // place worth looking.
    const x = head.x + side * Math.round(space * 0.55);
    if (x < 1 || x >= w - 1) continue;
    let length = 0;
    for (let k = 1; k <= reach; k++) {
      const y = head.y + dir * k;
      if (y < 0 || y >= h) break;
      // A stem wanders a pixel either way on a photographed page.
      if (ink[y * w + x] || ink[y * w + x - 1] || ink[y * w + x + 1]) length = k;
      else if (k > space * 0.8) break;
    }
    if (length > best.length) { best.dir = dir; best.x = x; best.length = length; }
  }
  // Shorter than about a staff space is not a stem, it is the head's own edge
  // or a ledger line. Not much more than that, though: a beamed group is drawn
  // with SHORT stems — the beam does the reaching — and a threshold set for the
  // long stem of a lone crotchet throws away every note in a run of
  // semiquavers, which is most of the notes on a fast page.
  return best.length >= space * 1.1 ? best : null;
}

// How many beams the stem passes through, counted at the far end of it.
//
// NOT taken from what beamMask removed, which was the first thing tried and is
// exactly wrong. beamMask takes out a beam by finding a long horizontal run no
// taller than a notehead — and a stack of two or three beams is a notehead
// tall, so the stacks survive it. Those stacks are precisely the beams worth
// counting: a lone quaver beam is removed and a semiquaver's pair is not, so
// the removed layer holds the beams that say the least and none of the ones
// that say the most. On a page of semiquavers it found nothing at all.
//
// So a beam is recognised where it is: ink that runs WIDE at the stem. A stem
// is two or three pixels across and a beam is most of the way to the next note,
// which is the same test that keeps beams from being read as noteheads, used
// here for the opposite purpose.
function countBeams(ink, w, h, head, stem, space, lineYs) {
  const wide = Math.max(3, Math.round(space * 1.4));
  const from = Math.round(space * 0.75);
  const to = stem.length;
  // Which rows along the stem are beam rows.
  const rows = [];
  for (let k = from; k <= to; k++) {
    const y = head.y + stem.dir * k;
    if (y < 1 || y >= h - 1) break;
    // A staff line is the widest ink on the page and the stem crosses five of
    // them. Left in, every line under a note counted as a beam and a page of
    // semiquavers came back as demisemiquavers throughout — the widest thing
    // there is, mistaken for the thing being looked for.
    if (lineYs.some((line) => Math.abs(y - line) <= Math.max(1, space * 0.18))) continue;
    let across = 0;
    for (let x = stem.x; x >= 0 && ink[y * w + x]; x--) across += 1;
    for (let x = stem.x + 1; x < w && ink[y * w + x]; x++) across += 1;
    rows.push(across >= wide);
  }
  // Bands of them, one band per beam — and a band far thicker than a beam is
  // two that touch, which a photograph produces constantly.
  const thick = Math.max(1, space * 0.34);
  let bands = 0;
  let run = 0;
  for (const on of [...rows, false]) {
    if (on) { run += 1; continue; }
    if (run) bands += Math.min(4, Math.max(1, Math.round(run / thick)));
    run = 0;
  }
  return Math.min(4, bands);
}

/**
 * Read a duration for every notehead on a stave.
 *
 * Returns one entry per head, in the same order: { beams, stem, hollow, beats }.
 * `beats` is in crotchets. Nothing here decides whether to believe it — that is
 * scan-values.js, deliberately.
 */
export function readValues(ink, beams, w, h, heads, space, lineAt = null) {
  const raw = heads.map((head) => {
    const at = { x: Math.round(head.x), y: Math.round(head.y) };
    const stem = findStem(ink, w, h, at, space);
    const hollow = !!head.hollow;
    if (!stem) {
      // No stem: a semibreve if it is hollow, and if it is filled then
      // something has gone wrong with the stem rather than with the note —
      // call it a crotchet and let the bar sum have an opinion.
      return { beams: 0, stem: false, hollow, beats: hollow ? 4 : 1 };
    }
    if (hollow) return { beams: 0, stem: true, hollow, beats: 2 };
    const lineYs = lineAt ? lineAt(at.x) : [];
    const count = countBeams(ink, w, h, at, stem, space, lineYs);
    return { beams: count, stem: true, hollow, beats: BY_BEAMS[count] ?? 0.0625, x: at.x, dir: stem.dir };
  });
  return voteWithinGroups(raw, space);
}

// Notes under one beam agree, because one beam is what they are under.
//
// Counted note by note this is right about four times in five, which sounds
// respectable and is useless: a bar of sixteen semiquavers needs all sixteen
// right before the bar adds up, and four-fifths sixteen times over is two per
// cent of bars. The errors are not independent of each other though — they are
// misreadings of the SAME beam, seen from different stems — so the group can
// outvote them. A run of notes joined by a beam takes the count most of them
// saw, and four-fifths per note becomes very nearly certain per group.
//
// Grouped by the thing that actually joins them: neighbouring notes, close
// together, whose stems point the same way and reach a beam at all. A rest or a
// wide gap ends the group, which is what a beam does too.
function voteWithinGroups(values, space) {
  const groups = [];
  let current = null;
  for (const [i, value] of values.entries()) {
    // Joined by being NEXT to each other under one beam, not by having each
    // seen the beam. A note whose own count came back zero is the one the
    // group is most use to — excluded, it broke the run in two and then kept
    // its wrong answer, which made the vote worse than no vote at all.
    const joins = value.stem && current
      && current.dir === value.dir
      && Math.abs(value.x - current.lastX) <= space * 4.5;
    if (!joins) {
      current = value.stem ? { dir: value.dir, lastX: value.x, members: [i] } : null;
      if (current) groups.push(current);
      continue;
    }
    current.members.push(i);
    current.lastX = value.x;
  }
  for (const group of groups) {
    if (group.members.length < 2) continue;
    // Only the members that saw a beam get a vote — a note that saw none is
    // abstaining, not voting for "no beam". A group where nobody saw one is
    // left alone: those are unbeamed notes standing next to each other.
    const tally = new Map();
    let voters = 0;
    for (const i of group.members) {
      if (!(values[i].beams > 0)) continue;
      voters += 1;
      tally.set(values[i].beams, (tally.get(values[i].beams) ?? 0) + 1);
    }
    if (!voters) continue;
    let winner = 0;
    let best = 0;
    for (const [count, n] of tally) if (n > best) { best = n; winner = count; }
    for (const i of group.members) {
      values[i] = { ...values[i], beams: winner, beats: BY_BEAMS[winner] ?? 0.0625 };
    }
  }
  return values;
}
