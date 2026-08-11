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
//
// What "the view" is depends on which reader is up. Full screen, the stage IS
// the scroller and its box is the frame. Inline it is not a scroller at all any
// more — it is as tall as the whole score and the page scrolls past it — so the
// frame is the window, and measuring against the stage would have said every
// note was comfortably in view and quietly stopped following.
function keepInView(element) {
  const stage = el('score-stage');
  if (!stage) return;
  const full = stage.classList.contains('full');
  const frame = full
    ? stage.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  const box = element.getBoundingClientRect();
  const margin = Math.min(120, frame.height * 0.25);
  if (box.top >= frame.top + margin && box.bottom <= frame.bottom - margin) return;
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

// --- full screen -------------------------------------------------------------
//
// Tap the music, get the whole screen — the gesture every score reader and half
// the sports apps have trained everyone to expect. The stage itself becomes the
// sheet: same node, same engraving, so the overlay marks stay exactly on the
// noteheads they were measured against. Escape, the ✕, or a tap on the paper
// brings it back.
//
// It is lifted to <body> while it is open, and that is not decoration. The card
// it normally sits in carries a backdrop-filter, and a filtered element becomes
// the containing block for any fixed-position descendant — so "inset: 0" inside
// the card means the card, not the screen, and full screen came out as a
// hundred-pixel window in the middle of the page. Whatever is moved out is put
// back exactly where it was.

let stageHome = null; // { parent, next } while the sheet is lifted out

function setFullScreen(on) {
  const stage = el('score-stage');
  if (!stage || stage.classList.contains('full') === on) return;
  const button = el('score-expand');
  if (on) {
    stageHome = { parent: stage.parentNode, next: stage.nextSibling };
    document.body.append(stage);
    if (button) document.body.append(button); // fixed, for the same reason
    document.documentElement.dataset.scoreFull = 'yes';
  } else {
    if (stageHome) {
      const { parent, next } = stageHome;
      if (next && next.parentNode === parent) parent.insertBefore(stage, next);
      else parent.append(stage);
    }
    stageHome = null;
    if (button) el('score-tab-summary')?.append(button);
    delete document.documentElement.dataset.scoreFull;
  }
  stage.classList.toggle('full', on);
  if (button) {
    button.textContent = on ? '✕' : '⤢';
    button.setAttribute('aria-label', on ? 'Close the full-screen score' : 'Read the score full screen');
  }
  if (on) stage.scrollTop = 0;
}

// Built once, and hung beside the summary line rather than on the music: a
// long title runs the full width of the page, and a button floating over the
// top-right corner of it sits on the composer's name.
let expandBtn = null;

function fullScreenButton() {
  if (expandBtn) return expandBtn;
  const stage = el('score-stage');
  if (!stage) return null;
  expandBtn = document.createElement('button');
  expandBtn.id = 'score-expand';
  expandBtn.type = 'button';
  expandBtn.textContent = '⤢';
  expandBtn.setAttribute('aria-label', 'Read the score full screen');
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setFullScreen(!stage.classList.contains('full'));
  });
  return expandBtn;
}

export function initScoreFullScreen() {
  const stage = el('score-stage');
  if (!stage || stage.dataset.wired === 'yes') return;
  stage.dataset.wired = 'yes';
  // A tap on the page toggles. Noteheads stop the event (score-view.js), so
  // choosing a note still just chooses a note.
  stage.addEventListener('click', () => setFullScreen(!stage.classList.contains('full')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setFullScreen(false);
  });
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
  setFullScreen(false); // nothing to read full screen once the page has gone
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
  setFullScreen(false); // never leave the dock hidden behind a tab nobody is on
}

export function scoreTabIsShowing() {
  return !!document.querySelector('#tab-score')?.classList.contains('active');
}
