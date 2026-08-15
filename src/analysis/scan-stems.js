// How long each note is, read off the page.
//
// A notehead's duration is written in three things and this reads all three:
// whether the head is filled or hollow, whether it has a stem, and how many
// beams cross that stem. Nothing else about the note is needed — a semibreve
// is the hollow one with no stem, a minim the hollow one with a stem, and
// everything filled is a crotchet halved once per beam.
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
 *
 * Kept because it is a cheap way for anything downstream to ask where the
 * beams roughly are. The counting below does NOT use it, and that is the
 * oldest lesson in this file: beamMask takes a beam out by finding a long
 * horizontal run of ink no taller than a notehead, and a stack of two or three
 * beams IS a notehead tall, so the stacks survive it. The layer therefore
 * holds the lone quaver beams that say the least and none of the stacks that
 * say the most. On a page of semiquavers it is empty.
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
  // How far a stem may be followed. NOT the length of one note's stem: a beam
  // is drawn clear of the HIGHEST head in the group, so the LOWEST head in the
  // same group has a stem that spans its own three-and-a-bit spaces plus the
  // whole pitch spread of the group. A reach set to one stem's length silently
  // truncates its neighbours' — and since the count below stops where the stem
  // stops, every low note in a beamed group then lost its topmost beam. That
  // one number was two thirds of every wrong beam count on an undamaged page:
  // semiquavers read as quavers, demisemiquavers as semiquavers, exactly the
  // notes whose stems reach furthest. The walk stops at white anyway, so a
  // generous reach costs nothing on the pages measured — but see the gap
  // tolerance below: between them, a dotted chain of ink above the stem could
  // in principle carry the walk further than nine spaces of clean stem would.
  // Nothing on this corpus does (systems are sixteen spaces apart), and the
  // count reads DOWN from the topmost band so an overshoot into a second voice
  // or a slur costs a beam rather than the note. Worth knowing all the same.
  const reach = Math.round(space * 9);
  // How much white the walk will step over. A stem is the thinnest line an
  // engraver draws — a tenth of a staff space — and a photograph of one, once
  // it has been dimmed, blurred and downscaled, is a hairline that binarises
  // in pieces. Stopping at the first clear row found NO STEM AT ALL on forty
  // of the hundred and eighteen notes of the photographed page, and a note
  // with no stem is a crotchet whatever is drawn above it. A stem is still
  // required to be mostly there; it is only allowed to be dotted.
  const gapMax = Math.max(2, Math.round(space * 0.5));
  const best = { dir: 0, x: 0, length: 0 };
  for (const [side, dir] of [[1, -1], [-1, 1]]) {
    // Up on the right, down on the left: the usual engraving, and the only
    // place worth looking.
    const x = head.x + side * Math.round(space * 0.55);
    if (x < 1 || x >= w - 1) continue;
    let length = 0;
    let missed = 0;
    for (let k = 1; k <= reach; k++) {
      const y = head.y + dir * k;
      if (y < 0 || y >= h) break;
      // A stem wanders a pixel either way on a photographed page.
      if (ink[y * w + x] || ink[y * w + x - 1] || ink[y * w + x + 1]) { length = k; missed = 0; }
      else if (k > space * 0.8 && ++missed > gapMax) break;
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

// The ink along a stem, as a PROFILE rather than as a series of yes/no tests.
//
// The count below used to walk out sideways from the stem and ask how many
// pixels of unbroken ink it met: thirteen or more and the row was a beam. On a
// drawn page that is exact. On a photograph it is a trap, because "unbroken"
// is a promise the page cannot keep — one pixel of JPEG ringing in the middle
// of a beam ends the run at six and the row scores nothing. Thirty-seven of
// the hundred and four notes read off the photographed page came back with NO
// beam at all, not because the beams were faint but because they were nicked.
//
// A fraction has no such cliff. Count the inked pixels in a short window round
// the stem and divide: a beam fills nearly all of it however holed it is, a
// bare stem fills a tenth of it, and everything in between degrades smoothly
// instead of falling off an edge. The window is kept NARROWER than the gap
// between two noteheads (a beamed group sets its notes about two spaces
// apart), so the head next door can never wander into it, while a beam — which
// runs the whole width of the group — fills it whatever part of it is sampled.
//
// Staff lines are the one other thing that fills the window, and they must not
// be left in: the stem crosses five of them and each would read as a beam.
// They are not skipped, though. Skipping DELETES the row from the profile, and
// a deleted row welds the beams on either side of it into one band — which is
// how a stack of two came back as one whenever a staff line happened to run
// through the gap. Instead the staff line's own ink is taken out and the row is
// kept: a line is a thin horizontal stroke, so a pixel is only believed if the
// ink it belongs to runs deeper than a line does. A beam lying across a line is
// thicker than the line and survives that test; the line to either side of the
// beam does not.
//
// HOW THICK A STAFF LINE IS, IS MEASURED OFF THE PAGE AND NOT ASSUMED.
//
// This is the whole difficulty. An engraver draws a staff line a tenth of a
// space thick and a beam a quarter, so on paper any threshold between them
// separates the two, and a fraction of the staff space looks like the obvious
// way to write one down. It is not, because blur is not proportional. A camera
// adds roughly the same pixel or two to everything it photographs, so a beam
// that should be two and a half times a line's thickness comes back only half
// again as thick, and the fraction that is right for one page is wrong for the
// next. Measured on the corpus, sweeping that fraction: at 0.28 the ten
// spoilings score 95% and unbeamed crotchets on a photograph 22%; at 0.32 the
// crotchets jump to 75% and the ten spoilings fall to 86%. There is no value
// that is right for both, and there cannot be.
//
// But the page knows. A staff line is the thinnest horizontal stroke on it and
// there are five per stave running the whole width, so they are also the most
// plentiful thing to measure — and they have been through exactly the same
// camera as the beams they must be told apart from. Measuring them costs one
// pass and removes the constant entirely.
//
// This matters more than a stripping detail sounds. The old code asked the
// stave MODEL where its lines were and stripped only there. The model fits a
// curve across the page, and on a page that is bent and turned a degree — every
// page held open under a phone — the fit drifts; where it drifts more than a
// third of a space the line beneath is not recognised, is not stripped, and
// fills the window. A full window is exactly what a beam looks like. That is
// what put a quaver beam on nineteen of the twenty-four plain crotchets of a
// photographed page.

// The vertical run of ink through (x, y), giving up at `cap`.
function inkDepth(ink, w, h, x, y, cap) {
  let deep = 1;
  for (let yy = y - 1; yy >= 0 && ink[yy * w + x] && deep < cap; yy--) deep++;
  for (let yy = y + 1; yy < h && ink[yy * w + x] && deep < cap; yy++) deep++;
  return deep;
}

// How thick this stave's staff lines come out, in pixels, after whatever the
// camera did to them.
//
// Sampled at the modelled line positions but not trusting them: the nearest
// inked row within half a space is measured, so the same drift that defeated
// the old stripping is harmless here. Noteheads, stems and beams cross the
// lines too and read thicker; they are a small minority of the samples and the
// median ignores them.
function lineThickness(ink, w, h, heads, space, lineAt) {
  if (!lineAt || !heads.length) return 0;
  const xs = heads.map((head) => Math.round(head.x));
  const from = Math.min(...xs);
  const to = Math.max(...xs);
  const near = Math.max(1, Math.round(space * 0.5));
  const cap = Math.max(4, Math.round(space));
  const depths = [];
  for (let x = from; x <= to; x += Math.max(1, Math.round(space))) {
    if (x < 1 || x >= w - 1) continue;
    for (const line of lineAt(x)) {
      const at = Math.round(line);
      let found = -1;
      for (let d = 0; d <= near && found < 0; d++) {
        if (at - d > 0 && ink[(at - d) * w + x]) found = at - d;
        else if (at + d < h && ink[(at + d) * w + x]) found = at + d;
      }
      if (found >= 0) depths.push(inkDepth(ink, w, h, x, found, cap));
    }
  }
  return depths.length >= 8 ? quantile(depths, 0.5) : 0;
}

// THE WINDOW FOLLOWS THE BEAM'S SLOPE, AND IT HAS TO.
//
// A beam is not horizontal. An engraver slopes it with the notes it covers —
// a group rising a sixth gets a beam rising about half that — and a window
// nearly two staff spaces wide, sampled flat, cuts across a sloped band
// diagonally. The band then appears in the profile smeared over every row the
// slope carried it through: longer than the beam is thick, by roughly the
// slope times the window's width. The count divides a band's length by the beam
// pitch, so a smeared band reads as one beam too many.
//
// This was invisible for a long time because the pages being measured had no
// sloped beams on them. Their four notes returned to the step they started
// from, so every beam drawn was exactly parallel to the stave, and a whole
// tournament of changes was scored against pages with the one shape that cannot
// show the defect. On the commonest shape in music — four notes descending,
// stems down — it cost twenty points.
//
// The slope is not known in advance, so it is searched: the profile is taken at
// each of a few slopes and the sharpest wins. Sharpest means the highest peak,
// which is exactly the sheared window that lies ALONG a band rather than across
// it — flat on a flat beam, sloped on a sloped one, and on a bare stem it makes
// no difference which is chosen because there is no band to be sharp about.
const SLOPES = [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6];
// How much sharper a sloped window must read before it is believed over a flat
// one. Swept across the whole corpus: nought and 0.03 score 81, 0.06 scores 83,
// 0.10 scores 82 and 0.15 scores 81, so it is a gentle optimum rather than a
// tuned edge. Too small and bare stems find slopes that flatter staff lines;
// too large and genuinely steep beams are read flat and smear again.
const SLOPE_MARGIN = 0.06;

function profileAt(ink, w, h, head, stem, space, lineDeep, slope, from, to, win) {
  const p = [];
  for (let k = from; k <= to; k++) {
    const base = head.y + stem.dir * k;
    if (base < 1 || base >= h - 1) break;
    let n = 0;
    for (let dx = -win; dx <= win; dx++) {
      const x = stem.x + dx;
      const y = base + Math.round(slope * dx);
      if (x < 0 || x >= w || y < 0 || y >= h || !ink[y * w + x]) continue;
      // Thicker than a staff line, or it is a staff line. The stem's own
      // pixels are a long vertical run and pass this easily; so does a beam,
      // which is drawn two and a half times a line's thickness however much
      // the camera has flattened that ratio.
      if (inkDepth(ink, w, h, x, y, lineDeep) < lineDeep) continue;
      n += 1;
    }
    p.push(n / (win * 2 + 1));
  }
  return p;
}

function stemProfile(ink, w, h, head, stem, space, lineDeep) {
  const win = Math.max(2, Math.round(space * 0.85));
  const from = Math.max(1, Math.round(space * 0.7));
  // A little past where the stem was last seen: on a blurred page the stem's
  // ink fades a row or two before the top beam's far edge, and a scan that
  // stops dead at the last inked row clips it.
  const to = stem.length + Math.max(2, Math.round(space * 0.6));
  const flat = profileAt(ink, w, h, head, stem, space, lineDeep, 0, from, to, win);
  let best = flat;
  let bestPeak = flat.length ? Math.max(...flat) : 0;
  for (const slope of SLOPES) {
    if (!slope) continue;
    const p = profileAt(ink, w, h, head, stem, space, lineDeep, slope, from, to, win);
    const peak = p.length ? Math.max(...p) : 0;
    // A slope must EARN its place, by a margin, and not merely tie. Taking the
    // sharpest of seven slopes with no margin is a search for structure, and a
    // search for structure finds some: on a bare stem, where there is no band
    // to sharpen, one of the seven sheared windows will always line up with a
    // staff line better than a flat one does, and the crotchets that had just
    // been rescued started growing beams again. A real sloped beam clears this
    // easily — it goes from a smear to a full window — and a stem with nothing
    // on it cannot clear it at all, so it keeps the flat reading and its zero.
    if (peak > bestPeak + SLOPE_MARGIN) { bestPeak = peak; best = p; }
  }
  return best;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
}

// The stack of beams at the far end of the stem, as a span of the profile.
//
// Thresholded against the profile's OWN floor and ceiling rather than against
// any fixed level, because a faint page and a black one differ by a factor of
// three in how dark a beam is and not at all in how much darker a beam is than
// the stem beside it. The floor is taken low down the distribution instead of
// as a minimum, so one white row does not set it.
//
// The span may contain gaps: two beams with clear paper between them are two
// runs, and they are one stack. A gap wider than about half a space is not a
// beam gap, it is the end of the stack, and the walk stops there — which is
// what keeps a beam above from swallowing a slur or a ledger line below.
function beamStack(p, space) {
  if (p.length < 2) return null;
  const lo = quantile(p, 0.2);
  const hi = Math.max(...p);
  // A bare stem fills about a tenth of the window and nothing else on it does.
  // Both tests are needed: the difference alone would call a broken stem a
  // beam, and the height alone would call a fat blot one.
  if (hi < 0.45 || hi - lo < 0.22) return null;
  // Set high up the range, not halfway, because of what a staff line leaves
  // behind. Stripping the line's own ink out of the row is never quite clean —
  // a blurred line binarises three pixels deep in one column and four in the
  // next, and the deep ones are kept — so a line shows in the profile as a low
  // swell rather than as nothing. Halfway up the range that swell clears the
  // bar and is counted as a beam, which put a phantom quaver under the notes
  // whose stems happen to end just above a line. A beam fills the window; a
  // remnant does not, and two thirds of the way up separates them. Not a
  // knife edge: every fraction from 0.56 to 0.78 scores the same on all ten
  // conditions, and it is only below about half that the remnants come back.
  const level = lo + (hi - lo) * 0.62;
  let end = -1;
  for (let i = p.length - 1; i >= 0; i--) if (p[i] >= level) { end = i; break; }
  if (end < 0) return null;
  const gapMax = Math.max(1, Math.round(space * 0.5));
  const runs = [];
  let i = end;
  while (i >= 0) {
    if (p[i] < level) {
      let j = i;
      while (j >= 0 && p[j] < level) j -= 1;
      if (j < 0 || i - j > gapMax) break;         // past the bottom of the stack
      i = j;
      continue;
    }
    let start = i;
    while (start >= 0 && p[start] >= level) start -= 1;
    runs.push({ start: start + 1, length: i - start });
    i = start;
  }
  runs.reverse();
  return { runs };
}

/**
 * Read a duration for every notehead on a PAGE.
 *
 * `staves` is one entry per stave: { heads, space, lineAt }. Returns one array
 * of values per stave, each entry in the same order as that stave's heads:
 * { beams, stem, hollow, beats }. `beats` is in crotchets. Nothing here decides
 * whether to believe it — that is scan-values.js, deliberately.
 *
 * A page and not a stave, because of the calibration below. A stave carries
 * twenty or so notes and on a bad photograph most of them show a stack blurred
 * into one band; three of the photographed page's seven staves had no resolved
 * pair on them at all, fell back on the guessed pitch, and read every
 * demisemiquaver on those staves as a semiquaver. That was a sixth of the page.
 * The engraving is one engraving across all of it, so the whole page measures
 * it and every stave is counted against the same figures.
 */
export function readValues(ink, beams, w, h, staves) {
  // First pass: measure every stem, count nothing yet.
  //
  // Counting needs to know how far apart two beams are drawn and how thick one
  // of them is, and neither can be assumed. Engraving practice varies — the
  // thickness of a beam and the paper under it are house style — and this is a
  // photograph of it besides: blur fattens every band by a pixel at each edge,
  // so even a known house style would come out wrong here. But the page can
  // say. Wherever two beams ARE resolved into separate bands, and on any page
  // some are, the distance between their leading edges IS the pitch; and a
  // band shorter than that pitch can only be one beam, which measures the
  // thickness. Both are learnt from the same blurred ink they will be used on,
  // so the fattening cancels instead of accumulating.
  //
  // How thick a staff line is, is measured first and pooled across the page for
  // the same reason the beam pitch is: it is one printing and one camera, and a
  // stave whose lines happen to be crossed by more beams than most would
  // otherwise measure itself thick and then strip nothing.
  const thicks = staves
    .map(({ heads, space, lineAt }) => lineThickness(ink, w, h, heads, space, lineAt))
    .filter((t) => t > 0);
  // Two pixels if the page would not say — the thinnest a line can be and still
  // be ink at all, which strips nothing and leaves the profile as it was.
  const lineDeep = Math.max(2, Math.round(thicks.length ? quantile(thicks, 0.5) : 2) + 1);
  const measured = staves.map(({ heads, space }) => heads.map((head) => {
    const at = { x: Math.round(head.x), y: Math.round(head.y) };
    const stem = findStem(ink, w, h, at, space);
    const hollow = !!head.hollow;
    if (!stem || hollow) return { at, stem, hollow, stack: null };
    const p = stemProfile(ink, w, h, at, stem, space, lineDeep);
    const stack = beamStack(p, space);
    return { at, stem, hollow, stack };
  }));

  // Gathered in staff spaces rather than in pixels, so that a page whose
  // staves are photographed at slightly different sizes — which is every page
  // held in a book — still pools into one measurement.
  const pitches = [];
  const singles = [];
  for (const [s, rows] of measured.entries()) {
    const { space } = staves[s];
    for (const m of rows) {
      const runs = m.stack?.runs ?? [];
      for (let i = 1; i < runs.length; i++) pitches.push((runs[i].start - runs[i - 1].start) / space);
    }
  }
  // A page with no resolved pair anywhere cannot calibrate itself, and then a
  // plain engraving proportion has to do: a beam about half a space thick with
  // a quarter space of paper under it.
  const pitchPer = pitches.length >= 2 ? quantile(pitches, 0.5) : 0.75;
  for (const [s, rows] of measured.entries()) {
    const { space } = staves[s];
    for (const m of rows) {
      // Shorter than the pitch is one beam: two beams are a thickness plus a
      // whole pitch, whatever the gap between them has been blurred into.
      for (const run of m.stack?.runs ?? []) {
        if (run.length / space < pitchPer * 0.95) singles.push(run.length / space);
      }
    }
  }
  const thickPer = singles.length ? quantile(singles, 0.5) : pitchPer * 0.6;

  return measured.map((rows, s) => {
    const { space } = staves[s];
    const pitch = Math.max(1, pitchPer * space);
    const thick = Math.max(1, thickPer * space);
    const raw = rows.map((m) => {
      if (!m.stem) {
        // No stem: a semibreve if it is hollow, and if it is filled then
        // something has gone wrong with the stem rather than with the note —
        // call it a crotchet and let the bar sum have an opinion.
        return { beams: 0, stem: false, hollow: m.hollow, beats: m.hollow ? 4 : 1 };
      }
      if (m.hollow) return { beams: 0, stem: true, hollow: m.hollow, beats: 2 };
      let count = 0;
      // Band by band, not stack by stack. The whole stack's height divided by
      // the pitch looks like the same sum and is not: the errors of three
      // bands and two gaps all land on one rounding, and a stack of three
      // sitting a rounding's width over the halfway mark came back as four on
      // every faintly printed page. A band is at most a beam or two long, so
      // its own rounding has nowhere near that far to travel.
      for (const run of m.stack?.runs ?? []) {
        count += Math.max(1, Math.round((run.length - thick) / pitch) + 1);
      }
      count = Math.min(4, count);
      return {
        beams: count, stem: true, hollow: false, beats: BY_BEAMS[count] ?? 0.0625,
        x: m.at.x, dir: m.stem.dir,
        // A stem barely over the length it takes to be called one, with no
        // beam anywhere along it, is not evidence of anything — least of all
        // of which way the note is stemmed, since a scrap of ink on the wrong
        // side of the head wins that comparison as easily as the real stem
        // does. Flagged so the vote below can decline to let it speak, and more
        // importantly decline to let it interrupt.
        weak: !m.stack && m.stem.length < space * 2.6,
        // The opposite case, and it needs a name of its own: a FULL stem —
        // three spaces of it, the length an engraver draws when nothing is
        // going to be attached to the end — with no band anywhere along it.
        // That is not a note whose beam was missed. It is a crotchet, and the
        // page has said so about as plainly as a page can.
        //
        // The distinction is the whole difference between a zero that means
        // "saw nothing" and a zero that means "there is nothing", and the vote
        // below used to have only the first. A crotchet standing next to a
        // beamed group — which is what most bars of music look like — joined
        // the group on proximity, abstained from the tally because it had no
        // beams to offer, and was then overwritten with the group's answer. On
        // a page of beamed groups and crotchets set as a bar sets them, every
        // single crotchet came back as a quaver, a semiquaver or a
        // demisemiquaver, according to whichever group it stood beside.
        sure: !m.stack && m.stem.length >= space * 2.6,
      };
    });
    return voteWithinGroups(raw, space);
  });
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
    //
    // A weak reading may not break the run either. This cost more than
    // anything else on the photographed page: one note in a group of four
    // whose real stem had faded and whose "stem" was a scrap of ink on the
    // other side of the head came back pointing DOWN, the run split at it, and
    // the three notes around it were left as groups of one with nobody to vote
    // with. Two of the four then kept a reading of no beams at all. A note
    // that has nothing to say about which way it is stemmed should not be
    // allowed to say it loudly enough to break the group up.
    //
    // A note that is SURE it has no beam is the exception, and it ends the run
    // rather than joining it. A beam is what makes a group a group; a crotchet
    // with three clean spaces of stem and nothing across them is not under this
    // beam, however close it stands, and a group that reaches through it to the
    // notes on the far side is not a group either.
    const joins = value.stem && current && !value.sure
      && (value.weak || current.dir === null || current.dir === value.dir)
      && Math.abs(value.x - current.lastX) <= space * 4.5;
    if (!joins) {
      // A group opened by a weak note has no direction yet; the first note
      // with a real stem gives it one. A sure note opens nothing: it has its
      // answer and there is no group for it to be in.
      current = value.stem && !value.sure
        ? { dir: value.weak ? null : value.dir, lastX: value.x, members: [i] }
        : null;
      if (current) groups.push(current);
      continue;
    }
    if (current.dir === null && !value.weak) current.dir = value.dir;
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
    for (const [count, n] of tally) {
      // A tie goes to the LOWER count. The point is mostly that it must not go
      // to the higher one. That rule was tried, on the reasoning that
      // wrong counts are undercounts because ink goes missing and nothing
      // invents a beam that is not there. The reasoning was sound and the
      // premise was false, and it was false for a reason worth recording: the
      // only pages that had ever been measured drew their beams exactly
      // parallel to the stave, by an accident of the shape they drew, and on a
      // page whose beams SLOPE the errors are overcounts — the profile window
      // is nearly two spaces wide, a sloping band drifts across it, and the
      // band reads longer than it is. On a plain descending group with down
      // stems the rule cost twenty points; on the pages that suggested it, it
      // was worth nothing at all. It is not a tie-break that is wanted here but
      // a better profile, and until there is one, the smaller claim is the
      // safer one: a bar of quavers that should have been semiquavers fails to
      // add up, which is a refusal, and a bar of semiquavers that should have
      // been quavers adds up to the wrong thing, which is a wrong answer.
      if (n > best || (n === best && count < winner)) { best = n; winner = count; }
    }
    for (const i of group.members) {
      values[i] = { ...values[i], beams: winner, beats: BY_BEAMS[winner] ?? 0.0625 };
    }
  }
  return values;
}
