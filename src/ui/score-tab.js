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

// The tab is always in the dock, so the panel must always have something to
// say. With no score open it shows how to open one; with a score open it shows
// the review.
export function showReviewCard(hasReview) {
  const review = el('score-review');
  const empty = el('score-empty');
  if (review) review.hidden = !hasReview;
  if (empty) empty.hidden = hasReview;
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
  // Nor does comparing this note with the other times you played it belong at
  // the bottom of a page of music; it is a thing you do to a note on the graph.
  const compare = el('compare');
  if (compare) compare.dataset.borrowed = 'yes';
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
  const compare = el('compare');
  if (compare) delete compare.dataset.borrowed;
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
//
// The frame is the window: the stage is as tall as the whole score and the page
// scrolls past it, so measuring against the stage would have said every note
// was comfortably in view and quietly stopped following.
function keepInView(element) {
  const stage = el('score-stage');
  if (!stage) return;
  const frame = { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  const box = element.getBoundingClientRect();
  const margin = Math.min(120, frame.height * 0.25);
  if (box.top >= frame.top + margin && box.bottom <= frame.bottom - margin) return;
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

// --- reading it full screen ---------------------------------------------------
//
// A tap on the music opens the reader (ui/reader.js): the part on its own, page
// by page, at the size of the screen. It used to be this file's job — the stage
// took a class, went fixed, and scrolled — and that was a full-screen scroll of
// a panel-shaped engraving, which in landscape left a third of the screen empty
// under a page laid out for a phone held upright. The reader engraves for the
// screen it is on instead, and this file just opens it.

let expandBtn = null;
let onExpand = null;

function fullScreenButton() {
  if (expandBtn) return expandBtn;
  expandBtn = document.createElement('button');
  expandBtn.id = 'score-expand';
  expandBtn.type = 'button';
  expandBtn.textContent = '⤢';
  expandBtn.setAttribute('aria-label', 'Read the score full screen');
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onExpand?.();
  });
  return expandBtn;
}

export function initScoreFullScreen(handler = null) {
  if (handler) onExpand = handler;
  const stage = el('score-stage');
  if (!stage || stage.dataset.wired === 'yes') return;
  stage.dataset.wired = 'yes';
  // A tap anywhere on the page opens it. Noteheads stop the event
  // (score-view.js), so choosing a note still just chooses a note.
  stage.addEventListener('click', () => onExpand?.());
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
  initScoreFullScreen();
  stage.replaceChildren(page);
  const line = el('score-tab-summary');
  if (line) {
    line.textContent = summary ?? '';
    const button = fullScreenButton();
    if (button) line.append(button);
  }
  return stage;
}

export function clearScoreTab() {
  stopFollowing();
  returnPanel();
  showReviewCard(false);
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
