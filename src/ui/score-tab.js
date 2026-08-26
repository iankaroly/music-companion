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

// The tab holds two things and shows one of them: the shelf of pieces, or the
// review of a take read against the music. A review arriving takes the screen;
// leaving it (the ← on the review, or closing the piece) gives the shelf back.
export function showReviewCard(hasReview) {
  const review = el('score-review');
  const browser = el('score-browser');
  if (review) review.hidden = !hasReview;
  if (browser) browser.hidden = hasReview;
}

export function showBrowser() {
  showReviewCard(false);
}

// --- borrowing the playback panel ------------------------------------------

// The controls AND THE GRAPH.
//
// #chart-scroll was deliberately left behind for a long time, on the reasoning
// that the graph is what the Record tab IS and taking it away would leave that
// tab a row of buttons over nothing. That reasoning is about two tabs being
// visible at once, and they never are: the panel is borrowed when this tab is
// shown and handed straight back when it is hidden, so the Record tab has its
// graph whenever anybody is looking at the Record tab.
//
// What the missing half cost is the thing the score and the graph are for
// together — "below the score, we can have the whole audio wave thing like it
// is now. When I click on one of the bars, it will go to that time in the wave
// as well." A bar you press moves the playhead; without the graph here there
// was nothing for it to move on, and the two halves of one take lived on two
// screens.
const BORROWED = ['clip-head', 'chart-scroll', 'note-zoom', 'playback-controls'];

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
  // …and the pitch/waveform switch comes with it now that there is a chart
  // under it. It lives inside #clip-head, which is borrowed, so it only has to
  // stop being hidden.
  const mode = el('chart-mode');
  if (mode) mode.hidden = false;
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

// WHO IS DRIVING THE SCROLL.
//
// Following the playhead and reading the graph under the music are the same
// gesture from the app's side — both are "the page is at a different scroll
// offset now" — and only one of them is the player's. While a take is running,
// the light moves down the page every few notes, and each time it leaves the
// middle of the view the page is pulled back to it. So a hand reaching PAST the
// music for the pause button or the trace was overruled a second later, every
// second: "when it's playing and I try to scroll down on the score while it's
// still playing to pause it or go to one of the graphs, it just automatically
// scrolls back up to the score, which I don't like."
//
// So a hand that SCROLLS takes the wheel and keeps it. Latched on the gesture
// — a `wheel`, or a finger that has actually moved — and deliberately NOT on
// the `scroll` event, because `keepInView` scrolls, `scroll` fires, and a latch
// listening for that would trip on its own footsteps and stop following on the
// very first note.
//
// AND NOT ON `pointerdown` OR `touchstart` EITHER, which is what this listened
// for first. A finger sends pointerdown before click, so every press of a bar
// or of the play button armed the latch a moment BEFORE the take started, and
// the score then never followed at all. MEASURED, and only measurable with a
// real tap: `review:follow` used `.click()`, which sends no pointer events, and
// the step passed with the thing under test untouched. Through
// `page.touchscreen.tap` it read 214 follow ticks and 0 scrolls.
//
// A tap is not a scroll. `touchmove` is.
//
// It is given back at a SEEK, which is the other half of the sentence: pressing
// a bar, or the graph, or ↺ means "take me there", and being taken there is the
// whole point of the press. A seek is recognised from the followed time itself
// — a jump backwards, or forward by more than a bar's worth — so this stays on
// the receiving end of report.js's one-way arrangement and does not need the
// player to announce anything.
let scrollIsOurs = true;
let followedAt = null;
// Counted so a check can state the three-way fact rather than the absence of a
// symptom: while nobody has touched the page the follower scrolls it, after a
// touch the follower keeps arriving and stops scrolling it, and a seek starts
// it again. See tools/review-follow-check.mjs.
let follows = 0;
let scrolls = 0;
const SEEK_JUMP = 1.5;   // seconds; playback advances by a frame, a seek does not

const handOverScroll = () => { scrollIsOurs = false; };
// Passive: neither is prevented, and saying so keeps the listener off the
// scrolling critical path.
for (const kind of ['wheel', 'touchmove']) {
  window.addEventListener(kind, handOverScroll, { passive: true, capture: true });
}

// Keep the sounding bar on screen without yanking the page around: only scroll
// when the note has actually left the comfortable middle of the view.
//
// The frame is the window: the stage is as tall as the whole score and the page
// scrolls past it, so measuring against the stage would have said every note
// was comfortably in view and quietly stopped following.
function keepInView(element) {
  if (!scrollIsOurs) return;
  const stage = el('score-stage');
  if (!stage) return;
  const frame = { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  const box = element.getBoundingClientRect();
  // A mark on a page that is not the one being shown has no box at all — the
  // scanned review now shows one page at a time (scan-view.js). Scrolling to it
  // cannot work and must not be counted as following: `scrollIntoView` on a
  // hidden element does nothing, so this used to tick `scrolls` up every frame
  // the take spent on another page.
  if (!box.width && !box.height) return;
  const margin = Math.min(120, frame.height * 0.25);
  if (box.top >= frame.top + margin && box.bottom <= frame.bottom - margin) return;
  scrolls += 1;
  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

/** What the follower has done and who has the scroll — for checks. */
export function followState() {
  return { ours: scrollIsOurs, at: followedAt, follows, scrolls };
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
//
// The MOMENT is passed on too, as the second argument, and it is optional on
// purpose. An engraved score is a map from note objects to noteheads and
// ignores it (score-view.js:indexNoteheads). A photograph has no note objects
// in it — its noteheads are places the page reader measured — so the scanned
// page answers from the time instead, through scan-sync.js's headAt(t), which
// is the only direction that can say "nothing is sounding here" rather than
// leaving the last note lit. Both views are asked the same question; each
// answers with what it actually knows.
export function follow(noteheadFor) {
  unfollow?.();
  clearSounding();
  scrollIsOurs = true;
  followedAt = null;
  follows = 0;
  scrolls = 0;
  unfollow = followPlayback((note, time) => {
    // A SEEK GIVES THE SCROLL BACK. Playing forwards advances the followed time
    // by a frame at a time; pressing a bar or the trace moves it in one step,
    // which is somebody asking to be shown a different part of the music.
    //
    // `time` is null between clips and inside a silence, and that is NOT a
    // seek — so the last real second is kept rather than cleared, and a stop
    // followed by a start in the same place leaves the scroll where the player
    // put it. Which is right: pausing to look at the graph and pressing play
    // again is not a request to be taken back to the music.
    if (Number.isFinite(time)) {
      // …and the FIRST second of a freshly mounted review arms it too. Without
      // this the opening tick has nothing to compare against, so a review whose
      // very first gesture was a scroll would never follow at all.
      if (followedAt === null
        || time < followedAt || time - followedAt > SEEK_JUMP) {
        scrollIsOurs = true;
      }
      followedAt = time;
    }
    follows += 1;
    const next = noteheadFor?.(note, time) ?? null;
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
  followedAt = null;
  // The next take starts by following again, so the latch does not carry a
  // scroll somebody did during the last one into it.
  scrollIsOurs = true;
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
