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
import { intonationHue } from './chart-utils.js';
import { findStart } from '../analysis/scan-align.js';
import { fitPitches } from '../analysis/scan-pitch.js';
import { alignScore } from '../analysis/align-score.js';
import { pitchOf } from '../analysis/scan-notes.js';
import { NO_KEY } from '../analysis/scan-key.js';

// Every notehead the page reader found, in reading order, carrying the page it
// is on and the staff space it was measured against.
export function headsOf(layout) {
  const all = [];
  for (const [page, read] of (layout ?? []).entries()) {
    if (!read) continue;
    const space = read.space ?? 0.01;
    for (const note of notesInOrder(read)) {
      // Priced in pitch here, where the clef the stave was read with is still
      // attached. A head whose stave had no readable clef gets midi null and
      // takes the shape-matching route with the rest of its page.
      //
      // NO_KEY until the signature detector lands: the alignment is right
      // without it — a page in two sharps is out by a semitone on its F's and
      // C's, which is what the aligner's near-miss tier is for — but a VERDICT
      // is not, and verdicts are gated on confidence anyway.
      const pitch = pitchOf(note.step, note.clef, NO_KEY);
      all.push({ ...note, page, space, midi: pitch?.midi ?? null });
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
function alignByPitch(heads, played) {
  const window = heads
    .map((head, id) => ({ ...head, id }))
    .filter((head) => Number.isFinite(head.midi));
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
      // Carried through so the review can WITHHOLD on a note whose reference
      // was only nearly right. A ring saying "read as a semitone out" is
      // honest; one saying "you played this 100 cents flat" is not.
      verdict: attempt.verdict,
    });
  }
  marks.sort((a, b) => a.index - b.index);
  return marks;
}

// One mark per note PLAYED, in order, from wherever the take begins.
//
// Two routes in, and which one runs is decided by whether the page managed to
// read its own clef. The order is still the order you played in; what it no
// longer assumes is that you started at the top of the piece.
export function pairNotes(heads, played) {
  // The page read its own clef, so the aligner can be given real notes.
  if ((heads ?? []).some((h) => Number.isFinite(h?.midi))) {
    const marks = alignByPitch(heads, played);
    if (marks?.length) {
      return {
        marks,
        heads: heads.length,
        played: played.length,
        unmarked: Math.max(0, played.length - marks.length),
        spare: Math.max(0, heads.length - marks.length),
        placed: true,
        aligned: true,
        readPitch: true,
      };
    }
  }
  return pairByShape(heads, played);
}

// The route for a page whose clef could not be read: shape-matched, then
// pitch-fitted from the take. Kept because a page it cannot read is commoner
// than it should be, and half an answer beats none — but it is the fallback
// now, not the way in.
function pairByShape(heads, played) {
  // Where the take begins, found from the shape of it — see scan-align.js.
  //
  // This used to start at zero, always. Open a part whose first page is a
  // title page, play the music on page two, and every ring landed on page one
  // among noteheads nobody had touched.
  const start = findStart(heads, played);
  // Refused rather than guessed. A take that cannot be placed gets no marks at
  // all, because a ring is a control with a drone and a close-up behind it:
  // eighty of them in the wrong place is eighty specific false claims, and
  // "I could not tell where this starts" is a better thing to say than any of
  // them.
  if (!start.sure) {
    return {
      marks: [], heads: heads.length, played: played.length,
      unmarked: played.length, spare: heads.length, placed: false, why: start.why,
      readPitch: false,
    };
  }

  // …and then the notes are lined up PROPERLY, rather than counted off.
  //
  // Knowing where a take starts is not the same as knowing which notehead each
  // note landed on. Pairing them off in order — first with first, second with
  // second — is right until the first slip, and then it is wrong for the whole
  // rest of the take: repeat a bar, drop a note, put in one that is not there,
  // and every mark after that point is on the wrong notehead, silently.
  //
  // The app already has an aligner that survives all three, written for
  // MusicXML: a full edit distance with a traceback that sees the whole take
  // before deciding anything. It wants written pitches, which a photograph does
  // not have — so they are ESTIMATED (see scan-pitch.js) and handed to it. Its
  // verdicts are not used and must not be: an estimated pitch cannot say a note
  // was wrong. Only its PATH is taken, which is the answer to "which notehead
  // is this note on", and that path is what a slip in the middle needs.
  const fit = fitPitches(heads, played, start.offset);
  if (!fit || fit.agreement < 0.6) {
    return positional(heads, played, start);
  }

  // Only the stretch of the page the take could be on. Aligning forty notes
  // against a twenty-page part is both slower and looser than it needs to be.
  const from = start.offset;
  const to = Math.min(fit.notes.length, from + Math.ceil(played.length * 1.6) + 16);
  const window = fit.notes.slice(from, to).map((n, i) => ({ ...n, id: i }));
  if (window.length < 2) return positional(heads, played, start);

  let attempts = null;
  try {
    attempts = alignScore(played, window).attempts;
  } catch {
    return positional(heads, played, start);
  }

  const seen = new Set();
  const marks = [];
  for (const attempt of attempts) {
    if (!attempt?.played || !attempt.score) continue;
    const at = played.indexOf(attempt.played);
    if (at < 0 || seen.has(at)) continue;
    seen.add(at);
    marks.push({ ...heads[from + attempt.score.id], note: attempt.played, index: at });
  }
  marks.sort((a, b) => a.index - b.index);
  return {
    marks,
    heads: heads.length,
    played: played.length,
    unmarked: Math.max(0, played.length - marks.length),
    spare: Math.max(0, heads.length - marks.length),
    placed: true,
    offset: from,
    confidence: start.score,
    aligned: true,
    readPitch: false,
  };
}

// The old way, kept for when the pitch fit is too poor to align on: notes
// counted off from where the take starts. Right until the first slip, which is
// better than nothing and honest about being the fallback.
function positional(heads, played, start) {
  const from = start.offset;
  const count = Math.min(heads.length - from, played.length);
  const marks = [];
  for (let i = 0; i < count; i++) {
    marks.push({ ...heads[from + i], note: played[i], index: i });
  }
  return {
    marks,
    heads: heads.length,
    played: played.length,
    unmarked: Math.max(0, played.length - count),
    spare: Math.max(0, heads.length - count),
    placed: true,
    offset: from,
    confidence: start.score,
    aligned: false,
    readPitch: false,
  };
}

const HUE = { good: '--good', sharp: '--sharp', flat: '--flat' };

// How wide the picture may be drawn, in device pixels. A review panel is not a
// music stand and the page does not have to be readable at arm's length; what
// it has to be is quick, because this is drawn while somebody is waiting to see
// their take.
const MAX_ACROSS = 1400;

export async function showScanScore(container, { payload, layout, notes, onPickNote } = {}) {
  const played = notes ?? [];
  const heads = headsOf(layout);
  const pairing = pairNotes(heads, played);
  // Nothing placed is a thing to SAY, not a thing to return as emptiness: the
  // caller has to be able to tell "the pages have not been read" from "the
  // pages were read and this take could not be found on them".
  if (!pairing.marks.length) return { pairing, pages: [], noteheadFor: () => null, destroy() {} };

  const pages = await openPaper(payload);
  const wrap = document.createElement('div');
  wrap.className = 'scan-score';
  container.replaceChildren(wrap);

  // Only the pages that carry a mark. A take of eight notes against a
  // twenty-page part is eight rings on page one, and nineteen blank
  // photographs under them is not a review, it is a scroll.
  const wanted = [...new Set(pairing.marks.map((m) => m.page))].sort((a, b) => a - b);
  const byNote = new Map();
  const nodes = [];

  // Where a pressed note says how it went. Above the pages, so it does not
  // move when a long part scrolls.
  const reading = document.createElement('p');
  reading.className = 'scan-reading';
  reading.hidden = true;
  container.insertBefore(reading, wrap);

  const say = (mark) => {
    const cents = Math.round(mark.note?.cents ?? 0);
    const how = Math.abs(cents) <= 5 ? 'in tune'
      : `${Math.abs(cents)}¢ ${cents > 0 ? 'sharp' : 'flat'}`;
    reading.hidden = false;
    reading.dataset.tone = intonationHue(cents);
    reading.textContent = `Note ${mark.index + 1} — ${how}`;
    for (const other of nodes) other.classList.toggle('picked', other === byNote.get(mark.note));
  };

  const across = Math.min(MAX_ACROSS, Math.max(320, container.clientWidth || 360));
  for (const page of wanted) {
    const holder = document.createElement('div');
    holder.className = 'scan-page';
    holder.dataset.page = String(page);
    const canvas = document.createElement('canvas');
    holder.append(canvas);
    wrap.append(holder);
    try {
      await pages.draw(page, canvas, across, across * 4);
    } catch {
      // A page that will not draw still gets its marks: the positions are
      // known, and a ring over a blank rectangle is more use than nothing.
    }
    // The picture is laid out at its own aspect; the marks are placed against
    // the SAME box, in fractions, so they cannot drift from it at any width.
    const box = document.createElement('div');
    box.className = 'scan-marks';
    holder.append(box);

    for (const mark of pairing.marks) {
      if (mark.page !== page) continue;
      const dot = document.createElement('button');
      dot.type = 'button';
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
      // Stopped here on purpose, exactly as the engraved noteheads do it: a tap
      // on the page itself opens the full-screen reader (score-tab.js wires the
      // whole stage), and picking a note is not asking for that. Without this,
      // pressing a note both opened its close-up AND threw the reader over the
      // top of it — so the one thing you could not do by tapping a note was
      // look at the note.
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        // Said plainly, right here, by the mark that was pressed.
        //
        // The report has a readout of its own, but it belongs to the playhead:
        // it follows the cursor across the take and answers for wherever that
        // is, which is the right behaviour for a graph you are dragging and the
        // wrong answer to "what was THIS note". Pressing a ring should say what
        // that ring is, and the only thing that certainly knows is the ring.
        say(mark);
        onPickNote?.(mark.note);
      });
      box.append(dot);
      byNote.set(mark.note, dot);
      nodes.push(dot);
    }
  }

  return {
    pages: nodes,
    pairing,
    // The one question the rest of the app asks a score view.
    noteheadFor(note) {
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
      pages.destroy?.();
      container.replaceChildren();
    },
  };
}

export { HUE };
