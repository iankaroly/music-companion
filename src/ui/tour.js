// The tour.
//
// The welcome screen says what the app is and asks what you play; it does not
// say what to DO. A new player closed it and was looking at a tuner dial and
// six words along the bottom, and "what is Coach?" was the first question every
// one of them asked. Ten coach marks, shown once, each over a real control on
// the tab it lives on, in the order the tab bar meets them: the dial, Record
// and its count-in, the Library, the three buttons on the Score shelf, Coach,
// the metronome and the gear. It is a tour and not a manual — one or two
// sentences per stop and a way out on every card.
//
// It began as four stops and grew to seven, then to ten, when the reader had
// become the reason to keep the phone on the stand and none of it was said:
// a player who had taken the tour still did not know a page could turn by
// itself or that a take could be recorded from the page. On a first run no
// part exists, so the reader's stops frame the shelf that will hold one and
// say what happens once it does.
//
// WHAT IT DOES NOT DO. It never asks for the microphone or the camera itself.
// Switching to the Tuner tab starts the tuner exactly as pressing that tab
// would, and that is the app's own behaviour, not the tour's; the tour draws a
// hole and a card and nothing else. The scanner is pointed AT, never opened.
//
// HOW THE HOLE IS CUT. One element sits over the control, and its box-shadow
// is the dimming — a shadow spread wider than any screen, so the element's own
// rectangle is the one place the shadow is not. A clip-path or an SVG mask
// would do the same; the shadow is one rule, follows border-radius for free,
// and can be moved from stop to stop with a transition that the reduced-motion
// rule at the bottom of index.html already knows how to turn off.

// Stored beside the app's other flags, so restoring default settings leaves it
// alone (a tour is not a preference). It is written when the tour ends, however
// it ends, and only the welcome screen's Start button reads it — an install
// that already chose an instrument before the tour existed never sees the
// welcome screen again, so it never gets the tour by surprise on a launch; it
// is there in Settings for whoever wants it.
const KEY = 'tourSeen';

export function tourSeen(storage = globalThis.localStorage) {
  try {
    return !!storage?.getItem(KEY);
  } catch {
    return false;
  }
}

export function markTourSeen(storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, '1');
  } catch { /* survivable */ }
}

export function forgetTour(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(KEY);
  } catch { /* survivable */ }
}

// Each stop: the tab it needs, the control it points at, and what to say. The
// copy says what the control actually does — the dial follows vibrato rather
// than flagging it (tuner.js), a take is kept the moment it ends and comes back
// as a box per note with its cents over the pitch trace (report.js,
// pitch-chart.js), "＋ Score" offers Scan, PDF and Choose file (main.js), the
// reader's menu rows are Half-page turns, Turn pages by itself, Transpose,
// Lock the page and Record a take (reader.js openMenu), and the coach compares
// this week's error with last week's (coach.js renderWeek). NOTHING HERE SAYS
// A TAKE IS MARKED ONTO THE PAGE: that is not ready, and a promise on a tour
// card is the first one a new player tests.
export const STOPS = [
  {
    tab: 'tuner',
    // On a first run the microphone has not been granted, so the tuner shows
    // "Tap to listen" under the dial (autoStartTuner in main.js) — and a hole
    // around the dial alone left a blue sliver of that button peeking out from
    // under the card, which is what the first screenshot showed. The stop
    // frames both while the button is there, and says the tap; once the mic
    // has been granted the button is hidden and only the dial is framed.
    target: ['#gauge-wrap', '#tuner-listen'],
    text: (doc) => (doc.querySelector('#tuner-listen')?.hidden === false
      ? 'Tap to listen, then play a note. '
      : 'Play a note. ')
      + 'The needle shows how far from centre you are, and the dial follows '
      + 'your vibrato instead of calling it out of tune.',
  },
  {
    tab: 'analyze',
    target: '#start',
    text: 'Press Record, play something, press Stop. The take is kept the '
      + 'moment it ends.',
  },
  {
    tab: 'analyze',
    // No take exists on a first run, so the review itself cannot be framed;
    // the count-in is the one control on this tab that is about the take to
    // come, and the card says what will appear under it. The <select> itself
    // is hidden — controls.js draws it as a segmented group carrying the
    // select's aria-label — so the group is what gets framed; pointing at
    // #count-in measured a 0x0 hole in the middle of the screen. The word
    // "count-in" beside it is framed too: with the group alone the hole's
    // edge cut the label in half, which the 390x844 screenshot showed.
    target: ['#tab-analyze .mini-label', '.seg[aria-label="Count-in before recording"]'],
    text: 'A count-in gives you a bar or two before the take. Afterwards every '
      + 'note comes back as a box — its name, and how far sharp or flat in '
      + 'cents — over a graph of your pitch through the take. Tap a note to '
      + 'hear it again.',
  },
  {
    tab: 'library',
    // The list is empty on a first run, so the frame is around the Library's
    // own controls rather than the nothing underneath them.
    target: ['#new-folder', '#library-search'],
    text: 'Every take you keep lands in the Library, filed under the piece it '
      + 'was played from. Folders and setlists keep a programme together, and '
      + 'search finds a take by name.',
  },
  {
    tab: 'score',
    target: '#score-load',
    text: 'Put your part on the stand: scan it with the camera, or bring in a '
      + 'PDF or MusicXML.',
  },
  {
    tab: 'score',
    target: ['#score-sets', '#score-folder'],
    text: 'Folders keep the parts of a piece together, and a setlist puts a '
      + 'programme in playing order.',
  },
  {
    tab: 'score',
    // The shelf is empty on a first run, so the stop frames the search box
    // and the empty-shelf note and says what the reader does once a part is
    // on it. Two sentences, one for reading and one for marking: the longest
    // card on the tour, and it still fits above the shelf at 320 wide.
    target: ['#score-search', '#score-list-empty'],
    text: 'Open a part and it fills the screen: turn with a tap or a swipe, '
      + 'half a page at a time, or let it turn by itself — and lock the page '
      + 'for a performance. Mark it up with a pencil or a finger, transpose an '
      + 'engraved part, and record a take straight from the page.',
  },
  {
    tab: 'coach',
    target: '.tab-btn[data-tab="coach"]',
    text: 'Come back after a few takes. The coach shows which notes you pull '
      + 'sharp or flat, what to drill, and how this week compares with last.',
  },
  {
    tab: 'metronome',
    target: ['#bpm-display', '#bpm-slider'],
    text: 'Set a tempo here, choose subdivisions and accents below, and the '
      + 'trainer can nudge the speed up every few bars while you play.',
  },
  {
    tab: 'tuner',
    // The gear is on every tab; the tour ends back where it began.
    target: '#settings-btn',
    text: 'Settings holds your instrument, the A you tune to, and this tour, '
      + 'if you ever want to see it again.',
  },
];

// The gap between a control and the edge of its hole, and between the hole and
// the card. Enough that the control reads as framed rather than clipped.
const PAD = 8;
const GAP = 12;
const EDGE = 8;

let starter = null;

// Wired once from main.js, which owns the tab switcher. `showTab` is asked to
// switch WITHOUT the slide: the card is placed by measuring the control, and a
// control that is still travelling measures wrong. The dimmed screen changing
// under the card is all the transition the tour needs.
export function initTour(doc = document, { showTab, currentTab } = {}) {
  starter = () => startTour(doc, { showTab, currentTab });
  return { start: starter };
}

// The Settings sheet's "Show the tour again", which has no tab switcher of its
// own — so it asks whoever wired the tour to run it.
export function replayTour() {
  starter?.();
}

export function startTour(doc = document, { showTab, currentTab } = {}) {
  if (doc.querySelector('#tour')) return null;
  const startedOn = currentTab?.() ?? null;
  const before = doc.activeElement;

  const root = doc.createElement('div');
  root.id = 'tour';
  root.innerHTML = `
    <div id="tour-hole" aria-hidden="true"></div>
    <div id="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-text" tabindex="-1">
      <p id="tour-text"></p>
      <div id="tour-foot">
        <span id="tour-count" aria-live="polite"></span>
        <button id="tour-skip" class="ctl" type="button">Skip</button>
        <button id="tour-next" class="ctl primary" type="button">Next</button>
      </div>
    </div>`;
  const hole = root.querySelector('#tour-hole');
  const card = root.querySelector('#tour-card');
  const text = root.querySelector('#tour-text');
  const count = root.querySelector('#tour-count');
  const skip = root.querySelector('#tour-skip');
  const next = root.querySelector('#tour-next');
  doc.body.append(root);

  let at = 0;
  let stopped = false;

  // Where the hole and the card go for the stop being shown. Measured every
  // time rather than once: the panel may still be laying out on the frame the
  // tab arrived, and a rotation moves everything.
  const place = () => {
    if (stopped) return;
    const stop = STOPS[at];
    const targets = [].concat(stop.target).map((sel) => doc.querySelector(sel))
      .filter((el) => el && !el.hidden && el.getClientRects().length);
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    if (!targets.length) {
      // Nothing to point at (a control renamed, a panel not built): the card
      // still says its sentence, centred, rather than a hole around nothing.
      hole.style.cssText = 'width:0;height:0;left:50%;top:50%;';
      card.style.left = `${Math.max(EDGE, (vw - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.max(EDGE, (vh - card.offsetHeight) / 2)}px`;
      return;
    }
    targets[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // One rectangle round everything the stop points at.
    const box = targets.map((el) => el.getBoundingClientRect()).reduce((a, b) => ({
      left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
      right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
    }));
    // The hole hugs the control's own corners: a pill gets a pill, a square
    // dial gets a soft rectangle.
    const own = targets.length === 1 ? parseFloat(getComputedStyle(targets[0]).borderRadius) || 0 : 0;
    const radius = own > 0 ? own + PAD : 16;
    const left = Math.max(EDGE, box.left - PAD);
    const top = Math.max(0, box.top - PAD);
    const right = Math.min(vw - EDGE, box.right + PAD);
    const bottom = Math.min(vh, box.bottom + PAD);
    hole.style.left = `${left}px`;
    hole.style.top = `${top}px`;
    hole.style.width = `${right - left}px`;
    hole.style.height = `${bottom - top}px`;
    hole.style.borderRadius = `${radius}px`;

    // Below the hole when there is room, else above it, else — a control
    // taller than the screen leaves room for neither — over its lower half.
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const roomBelow = vh - bottom - GAP - EDGE;
    const roomAbove = top - GAP - EDGE;
    let cardTop;
    if (roomBelow >= ch) cardTop = bottom + GAP;
    else if (roomAbove >= ch) cardTop = top - GAP - ch;
    else cardTop = vh - EDGE - ch;
    const centre = (left + right) / 2 - cw / 2;
    const cardLeft = Math.min(Math.max(EDGE, centre), Math.max(EDGE, vw - EDGE - cw));
    card.style.left = `${Math.round(cardLeft)}px`;
    card.style.top = `${Math.round(Math.max(EDGE, cardTop))}px`;
  };

  const show = (index) => {
    at = index;
    const stop = STOPS[at];
    const last = at === STOPS.length - 1;
    text.textContent = typeof stop.text === 'function' ? stop.text(doc) : stop.text;
    count.textContent = `${at + 1} of ${STOPS.length}`;
    next.textContent = last ? 'Done' : 'Next';
    root.dataset.step = String(at + 1);
    showTab?.(stop.tab);
    // Two frames: one for the tab to become active, one for its layout to be
    // measurable. Measured on the first frame, the dial reported a rectangle
    // from before the panel was shown.
    requestAnimationFrame(() => requestAnimationFrame(place));
    place();
    card.focus({ preventScroll: true });
  };

  const end = () => {
    if (stopped) return;
    stopped = true;
    markTourSeen();
    doc.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    root.remove();
    // Back to the tab the tour was started from: after the welcome screen that
    // is the tuner, and from Settings it is wherever you were. A new player
    // left on an empty Coach tab is left looking at "save a few takes first".
    if (startedOn) showTab?.(startedOn);
    if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      end();
      return;
    }
    // Focus stays on the card: the screen behind it is dimmed and its controls
    // cannot be pressed, so tabbing onto one would be tabbing into the dark.
    if (e.key === 'Tab') {
      const stops = [skip, next];
      const i = stops.indexOf(doc.activeElement);
      if (e.shiftKey && (i === 0 || i === -1)) { e.preventDefault(); next.focus(); }
      else if (!e.shiftKey && i === stops.length - 1) { e.preventDefault(); skip.focus(); }
      else if (i === -1) { e.preventDefault(); skip.focus(); }
    }
  };

  next.addEventListener('click', () => {
    if (at < STOPS.length - 1) show(at + 1);
    else end();
  });
  skip.addEventListener('click', end);
  doc.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);

  show(0);
  return { end, get step() { return at; } };
}
