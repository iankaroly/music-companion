// The Score tab: the review, read off the page instead of off a graph.
//
// It is deliberately NOT a second review. report.js holds one review at a time
// — one selected note, one playhead, one set of drones — and this tab is a
// second window onto that same one. Play on the Record tab, switch here, and
// the music is already moving; select a note here and the tile is lit over
// there. Two independent reviews would mean two of everything to keep in step,
// and they would not stay in step.
//
// The playback controls are ONE panel in the document. This tab borrows it
// while it is showing and hands it back on the way out — a DOM node lives in
// exactly one place anyway, so moving it is both the simplest thing and the
// only thing that keeps the element ids unique that report.js queries by.

import { followPlayback } from './report.js';

let stage = null;      // #score-stage — where the engraved page is mounted
let unfollow = null;
let borrowed = null;   // { node, home, nextSibling } for putting the panel back
let sounding = null;   // the notehead currently lit

const el = (id) => document.querySelector(`#${id}`);

// --- the tab button appears with the score ---------------------------------

export function setScoreTabVisible(visible) {
  const btn = document.querySelector('.tab-btn[data-tab="score"]');
  if (btn) btn.hidden = !visible;
}

// --- borrowing the playback panel ------------------------------------------

// The controls, and deliberately NOT #chart-scroll: the graph is what the
// Record tab IS, and taking it away would leave that tab a row of buttons over
// nothing. The score is the graph's counterpart here, not its companion.
const BORROWED = ['clip-head', 'note-zoom', 'playback-controls'];

export function borrowPanel() {
  const dock = el('score-dock');
  if (!dock || borrowed) return;
  borrowed = [];
  for (const id of BORROWED) {
    const node = el(id);
    if (!node) continue;
    // Remember exactly where each sat, so handing them back cannot reorder the
    // Record tab's review.
    borrowed.push({ node, home: node.parentNode, nextSibling: node.nextSibling });
    dock.append(node);
  }
  // The controls belong to a review; with no take loaded there is nothing for
  // them to control and #playback is hidden, so the dock follows it.
  dock.hidden = el('playback')?.hidden ?? true;
  // A pitch/waveform switch with no chart under it is a button that does
  // nothing visible.
  const mode = el('chart-mode');
  if (mode) mode.hidden = true;
}

export function returnPanel() {
  if (!borrowed) return;
  for (const { node, home, nextSibling } of borrowed) {
    if (nextSibling && nextSibling.parentNode === home) home.insertBefore(node, nextSibling);
    else home.append(node);
  }
  borrowed = null;
  const mode = el('chart-mode');
  if (mode) mode.hidden = false;
}

// showOverview flips #playback when a review opens or closes; the dock has to
// follow it while the controls are living here.
export function syncDockVisibility() {
  const dock = el('score-dock');
  if (dock && borrowed) dock.hidden = el('playback')?.hidden ?? true;
}

// --- following the playhead -------------------------------------------------

function clearSounding() {
  if (sounding) sounding.classList.remove('sounding');
  sounding = null;
}

// Keep the sounding bar on screen without yanking the page around: only scroll
// when the note has actually left the comfortable middle of the view.
function keepInView(element) {
  const scroller = el('score-stage');
  if (!scroller) return;
  const box = element.getBoundingClientRect();
  const frame = scroller.getBoundingClientRect();
  const margin = Math.min(120, frame.height * 0.25);
  if (box.top >= frame.top + margin && box.bottom <= frame.bottom - margin) return;
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

// noteheadFor: played note → the SVG element drawn for it.
export function follow(noteheadFor) {
  unfollow?.();
  clearSounding();
  unfollow = followPlayback((note) => {
    const next = note ? noteheadFor(note) : null;
    if (next === sounding) return;
    clearSounding();
    if (!next) return;
    sounding = next;
    next.classList.add('sounding');
    keepInView(next);
  });
}

export function stopFollowing() {
  unfollow?.();
  unfollow = null;
  clearSounding();
}

// --- mounting ---------------------------------------------------------------

// The engraved page is built by score.js and handed here; this module owns
// where it sits and what happens around it, not how it is drawn.
export function mountScore(page, summary) {
  stage = el('score-stage');
  if (!stage) return null;
  stage.replaceChildren(page);
  const line = el('score-tab-summary');
  if (line) line.textContent = summary ?? '';
  return stage;
}

export function clearScoreTab() {
  stopFollowing();
  returnPanel();
  setScoreTabVisible(false);
  el('score-stage')?.replaceChildren();
  const line = el('score-tab-summary');
  if (line) line.textContent = '';
}

// Called by the tab machinery when this tab is shown or left.
export function onScoreTabShown() {
  borrowPanel();
}

export function onScoreTabHidden() {
  returnPanel();
}

export function scoreTabIsShowing() {
  return !!document.querySelector('#tab-score')?.classList.contains('active');
}
