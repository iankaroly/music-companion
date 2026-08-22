// Tap a bar on the photograph, hear that moment of the take.
//
// WHY THIS EXISTS BESIDE THE REVIEW RATHER THAN INSIDE IT.
//
// The review marks a take onto a page by NAMING every notehead: read the clef,
// read the key, name the heads, match the names against the pitches the
// microphone heard. When it works it is the better thing — it can say which
// note was flat. When any step of it fails they all fail together, and the
// review draws nothing at all: a page of BWV 1007 whose first system was read
// in the wrong clef places no marks anywhere, and the player is left with a
// photograph and a sentence.
//
// This asks a smaller question that does not go through a single note. A bar is
// a rectangle on a page; a moment is a second of a recording; and a player who
// taps the bar they are hearing has said how the two line up more reliably than
// any recogniser has managed. Two taps and every other bar follows. It works on
// a page the review refused, on a page with no clef, on a page whose key could
// not be read — none of those is a rectangle.
//
// WHAT IT DOES NOT DO. It does not listen. The anchors come from somebody
// tapping, and between them the answer is a straight line — see bar-map.js,
// which says the same thing about the arithmetic. Guessing the anchors from the
// audio is the next piece of work and a much larger one; a version of this that
// guessed would be a version that is confidently wrong in the middle of a
// rubato, and the whole point of the design is that it is exactly right
// wherever somebody has said so.

import {
  barsInReadingOrder, barAtPoint, timeOfBar, barAtTime, sayMap,
} from '../analysis/bar-map.js';

/**
 * Put the bar layer over the pages a scan view has already drawn.
 *
 * @param {HTMLElement} container holding `.scan-page` elements with a data-page
 * @param {object} options
 * @param {Array} options.layout what the reader measured, one entry a page
 * @param {Function} options.play `(seconds) => boolean` — plays the take
 * @param {Function} options.follow `(fn) => off` — calls back with the moment being heard
 * @param {Function} [options.onSay] a line of narration for the player
 * @param {Array} [options.anchors] marks made earlier
 * @param {Function} [options.onAnchors] called whenever they change, to keep them
 * @returns {object|null} `{ bars, anchors, destroy }`, or null with nothing to draw
 */
export function attachBarSync(container, {
  layout, play, follow, onSay = null, anchors: given = [], onAnchors = null,
} = {}) {
  const bars = barsInReadingOrder(layout);
  if (!container || !bars.length) return null;

  let anchors = [...(given ?? [])];
  let marking = anchors.length < 2;     // nothing marked yet: marking is the job
  let heard = 0;                        // the moment the take is at, in seconds
  let lit = -1;
  const boxes = new Map();              // bar index -> the element drawn for it

  // The strip says what it is for, in its own element, because a caller that has
  // to find somewhere to put the sentence is a caller that will not bother.
  const line = document.createElement('p');
  line.className = 'bar-sync-say';
  const say = () => {
    // `sayMap` already tells somebody what to do while there is no map yet, so
    // adding an instruction here as well says it twice — "play the take and tap
    // the bar you are hearing — tap the bar you can hear", which is what it did
    // the first time it was drawn on a real page.
    const base = sayMap(anchors, bars);
    const words = marking ? base : `${base} — tap a bar to hear it`;
    line.textContent = words;
    onSay?.(words);
  };

  // --- the strip of controls ----------------------------------------------
  const strip = document.createElement('div');
  strip.className = 'bar-sync-bar';
  const mark = document.createElement('button');
  mark.type = 'button';
  mark.className = 'ctl';
  const showMode = () => {
    mark.textContent = marking ? 'Done marking' : 'Mark where you are';
    mark.setAttribute('aria-pressed', String(marking));
    strip.classList.toggle('marking', marking);
    for (const box of boxes.values()) box.classList.toggle('marking', marking);
    say();
  };
  mark.addEventListener('click', () => {
    // Marking cannot be finished before there is a map: one anchor is not a
    // line, and leaving it would put the player in a mode where every tap
    // silently does nothing.
    if (marking && anchors.length < 2) { say(); return; }
    marking = !marking;
    showMode();
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'ctl';
  clear.textContent = 'Start again';
  clear.addEventListener('click', () => {
    anchors = [];
    marking = true;
    for (const box of boxes.values()) box.classList.remove('marked');
    onAnchors?.(anchors);
    showMode();
  });
  strip.append(mark, clear, line);
  container.prepend(strip);

  // --- a box over every bar -------------------------------------------------
  const layers = [];
  for (const holder of container.querySelectorAll('.scan-page')) {
    const page = Number(holder.dataset.page);
    const layer = document.createElement('div');
    layer.className = 'scan-bars';
    holder.append(layer);
    layers.push(layer);
    for (const bar of bars.filter((one) => one.page === page)) {
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'scan-bar';
      box.style.left = `${bar.left * 100}%`;
      box.style.top = `${bar.top * 100}%`;
      box.style.width = `${(bar.right - bar.left) * 100}%`;
      box.style.height = `${(bar.bottom - bar.top) * 100}%`;
      box.setAttribute('aria-label', `Bar ${bar.index + 1}`);
      box.addEventListener('click', () => press(bar));
      layer.append(box);
      boxes.set(bar.index, box);
    }
  }

  function press(bar) {
    if (marking) {
      // WHERE YOU ARE NOW, said by tapping it. The moment recorded is the one
      // being HEARD rather than the one the clock is at — `follow` hands back
      // the latency-corrected time for exactly this reason (see report.js).
      anchors = [...anchors.filter((one) => Math.abs(one.at - bar.at) > 1e-4),
        { at: bar.at, time: heard }];
      boxes.get(bar.index)?.classList.add('marked');
      onAnchors?.(anchors);
      // Two marks is a map; there is nothing to be gained by making somebody
      // press a button to find that out.
      if (anchors.length === 2) { marking = false; showMode(); return; }
      say();
      return;
    }
    const at = timeOfBar(anchors, bar);
    if (at === null) { marking = true; showMode(); return; }
    play?.(at);
  }

  // --- the light that follows ------------------------------------------------
  const off = follow?.((note, time) => {
    if (Number.isFinite(time)) heard = time;
    const now = barAtTime(bars, anchors, heard);
    if (now === lit) return;
    boxes.get(lit)?.classList.remove('sounding');
    boxes.get(now)?.classList.add('sounding');
    lit = now;
  });

  for (const one of anchors) {
    const bar = bars.find((b) => Math.abs(b.at - one.at) < 1e-4);
    if (bar) boxes.get(bar.index)?.classList.add('marked');
  }
  showMode();

  return {
    bars,
    get anchors() { return [...anchors]; },
    destroy() {
      off?.();
      strip.remove();
      for (const layer of layers) layer.remove();
      boxes.clear();
    },
  };
}

/** Which bar a point on a page is in — re-exported so a caller needs one import. */
export { barAtPoint };
