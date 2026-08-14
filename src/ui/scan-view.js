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

// Every notehead the page reader found, in reading order, carrying the page it
// is on and the staff space it was measured against.
export function headsOf(layout) {
  const all = [];
  for (const [page, read] of (layout ?? []).entries()) {
    if (!read) continue;
    const space = read.space ?? 0.01;
    for (const note of notesInOrder(read)) all.push({ ...note, page, space });
  }
  return all;
}

// One mark per note PLAYED, in order, from wherever the take begins.
//
// The order is still the order you played in — nothing here reorders anything
// or copes with a repeat taken twice. What it no longer assumes is that you
// started at the top of the piece.
export function pairNotes(heads, played) {
  // Where the take begins, found from the shape of it — see scan-align.js.
  //
  // This used to start at zero, always. Open a part whose first page is a
  // title page, play the music on page two, and every ring landed on page one
  // among noteheads nobody had touched. The offset is the whole of that bug,
  // and it is found by sliding what was played along what is written and
  // seeing where the ups and downs agree.
  const start = findStart(heads, played);
  // Refused rather than guessed. A take that cannot be placed gets no marks at
  // all, because a ring is now a control with a drone and a close-up behind it:
  // eighty of them in the wrong place is eighty specific false claims, and
  // "I could not tell where this starts" is a better thing to say than any of
  // them.
  if (!start.sure) {
    return {
      marks: [], heads: heads.length, played: played.length,
      unmarked: played.length, spare: heads.length, placed: false, why: start.why,
    };
  }
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
      dot.addEventListener('click', () => onPickNote?.(mark.note));
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
