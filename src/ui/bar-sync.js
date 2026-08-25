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
  systemsOf, guessedAnchors, mergeAnchors, evenAnchors,
} from '../analysis/bar-map.js';
import { placeSystems } from '../analysis/scan-align.js';
import {
  placeRuns, goesAt, sayRuns, samePassage, compareGoes, sayComparison,
} from '../analysis/practice-runs.js';

/** The anchors the shape-matcher found, if it found any. */
function guessFrom(layout, notes) {
  return guessedAnchors(placeSystems(systemsOf(layout), notes));
}

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
  layout, play, follow, onSay = null, anchors: given = [], onAnchors = null, notes = null,
} = {}) {
  const bars = barsInReadingOrder(layout);
  if (!container || !bars.length) return null;

  // WHAT THE APP WORKED OUT FOR ITSELF, before anybody taps anything.
  //
  // Every system of the page is slid along the take by shape alone — see
  // placeSystems — and the ones that land somewhere unmistakable become
  // anchors. It reads no note: a clef moves every note by the same amount and
  // changes no direction, so this survives the misreading that puts a whole
  // system a thirteenth out. Systems it cannot place contribute nothing and the
  // map runs straight across them, which is what it did before any of this.
  let guessed = [];
  // THE GOES THIS TAKE IS MADE OF. A practice recording is not one pass down the
  // page: it is a dozen partial ones, and a bar played six times has six
  // answers. Where there is more than one go, every press is answered from the
  // goes rather than from a single climbing map — see practice-runs.js.
  let runs = [];
  try {
    if (notes?.length) {
      const systems = systemsOf(layout);
      runs = placeRuns(systems, notes).filter((one) => one.sure);
      guessed = guessFrom(layout, notes);
    }
  } catch { guessed = []; runs = []; }
  const practising = runs.length > 1;
  // The goes that are the same music, compared with each other — worked out
  // once, because it is the same answer however many times a bar is pressed.
  let passages = [];
  try {
    passages = practising
      ? samePassage(runs).map((group) => ({ ...group, said: sayComparison(compareGoes(group, notes)) }))
      : [];
  } catch { passages = []; }
  // Which go was offered last for each bar, so pressing the same bar again
  // walks back through the earlier ones instead of replaying the same second.
  const offered = new Map();

  let hand = [...(given ?? [])];
  // THE TAKE SPREAD EVENLY ACROSS THE PAGE, when nothing else placed it.
  //
  // Before this, a page the shape-matcher could not place opened asking to be
  // tapped twice, and until somebody did, every bar on it was inert. That is a
  // gesture nobody performs on a page they have just played once: the whole
  // point of pressing a bar is to hear it, and being told to first find the
  // moment by ear and tap it is being asked to do the job by hand.
  //
  // AND IT PINS THE ENDS EVEN WHERE THE MATCHER DID PLACE THE PAGE, which it
  // did not at first and which was wrong. The shape matcher places the systems
  // it is SURE of and says nothing about the rest, so a page whose first sure
  // system is the seventh has no anchor before it — and everything above it is
  // extrapolated backwards off two anchors in the middle of the page. MEASURED
  // on the Bärenreiter Bach photograph: pressing BAR 1 played from the start of
  // the take (the map's answer was negative and got clamped to zero) while the
  // light said BAR 16, because the two halves of the map agreed with each other
  // and both disagreed with the page. The first note heard is the start of the
  // music and the last is the end of it; those two facts are free, they are
  // always true of one pass down a page, and a guess in between still
  // overrules them.
  //
  // NOT ON A TAKE WITH SEVERAL GOES, and that gate stays. A practice take is
  // not one pass down the page — he played bar 3 six times — and spreading it
  // would answer every press with a confident wrong second. Those are answered
  // from the goes instead (see `practising` below). See evenAnchors for why it
  // is two anchors rather than a division by the number of boxes.
  let even = [];
  try {
    if (notes?.length && runs.length <= 1) even = evenAnchors(bars, notes);
  } catch { even = []; }
  // Everything the map runs on: the taps win, and see mergeAnchors for why they
  // win over the guesses BETWEEN them as well as the ones on top of them. The
  // even pair goes UNDER the shape guesses, so a system the matcher was sure
  // about overrules the straight line at that place and the ends stay pinned.
  const anchorsNow = () => mergeAnchors(hand, [...even, ...guessed]);
  let anchors = anchorsNow();
  // Marking is the job only when nothing — tapped, guessed, spread, or worked
  // out from the goes — has produced an answer. A page the app has placed for
  // itself opens ready to play from.
  let marking = anchors.length < 2 && runs.length < 1;
  let heard = 0;                        // the moment the take is at, in seconds
  let lit = -1;
  const boxes = new Map();              // bar index -> the element drawn for it

  // The strip says what it is for, in its own element, because a caller that has
  // to find somewhere to put the sentence is a caller that will not bother.
  const line = document.createElement('p');
  line.className = 'bar-sync-say';
  // WHAT THIS LINE IS FOR, now that it is not for instructions.
  //
  // It used to end every sentence with "— tap a bar to hear it", and open with
  // "play the take and tap the bar you are hearing". That is the app teaching
  // its own surface, over and over, on a screen where the bars are already
  // drawn on the music and pressing one is the only thing there is to do.
  //
  // What is left is what the app FOUND: how many goes at this music, how many
  // places it placed by itself, how wide the widest guess is, and — from
  // press() — the answers to a press that could not be honoured. Facts a
  // player could not work out by looking, and nothing else.
  const say = () => {
    const base = sayMap(anchors, bars);
    if (practising) {
      const again = passages.length
        ? `, ${passages.length} of them played more than once`
        : '';
      line.textContent = `${sayRuns(runs)}${again}`;
      onSay?.(line.textContent);
      return;
    }
    const found = guessed.length && !hand.length
      ? `found ${guessed.length} place${guessed.length === 1 ? '' : 's'} in this take by itself — `
      : '';
    // The even spread still says so, because a bar that plays a little out is
    // otherwise a bug rather than a stated approximation — but it says it as a
    // fact about the map and not as a thing to go and do about it.
    if (even.length && !hand.length && !guessed.length) {
      const words = 'the take spread evenly over the page';
      line.textContent = words;
      onSay?.(words);
      return;
    }
    line.textContent = `${found}${base}`;
    onSay?.(line.textContent);
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
    if (marking && anchorsNow().length < 2) { say(); return; }
    marking = !marking;
    showMode();
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'ctl';
  clear.textContent = 'Start again';
  clear.addEventListener('click', () => {
    // The taps go; what the app worked out for itself stays, because "start
    // again" is about the marks somebody made and not about the reading.
    hand = [];
    anchors = anchorsNow();
    marking = anchors.length < 2;
    for (const box of boxes.values()) box.classList.remove('marked');
    onAnchors?.(hand);
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
      // Where this box sits in the piece, in systems, so a check can state what
      // it expects of a press instead of assuming every box is the same amount
      // of music — which is the assumption bar-map.js exists to avoid.
      box.dataset.at = String(bar.at);
      box.dataset.to = String(bar.to);
      // AND NOT ALSO A TAP ON THE SCORE. `score-tab.js` listens for a click
      // anywhere on #score-stage and opens the full-screen reader, and these
      // boxes cover almost all of it — so pressing a bar played the moment and
      // then threw the page full screen on top of what it had just started.
      // "when I click on the score after recording, instead of it opening into
      // a full-screen score, it should just go to that bar." The ⤢ button is
      // still the way to the stand.
      box.addEventListener('click', (event) => {
        event.stopPropagation();
        press(bar);
      });
      layer.append(box);
      boxes.set(bar.index, box);
    }
  }

  function press(bar) {
    if (marking) {
      // WHERE YOU ARE NOW, said by tapping it. The moment recorded is the one
      // being HEARD rather than the one the clock is at — `follow` hands back
      // the latency-corrected time for exactly this reason (see report.js).
      // A tap says "this bar was sounding at this second", which pins the GO
      // that second falls in rather than the page as a whole — on a take with
      // several goes there is no single map for it to pin.
      const mine = runs.find((one) => heard >= one.from && heard <= one.to);
      if (mine) {
        mine.anchors = [...mine.anchors.filter((one) => Math.abs(one.at - bar.at) > 1e-4),
          { at: bar.at, time: heard }].sort((a, b) => a.at - b.at);
      }
      hand = [...hand.filter((one) => Math.abs(one.at - bar.at) > 1e-4),
        { at: bar.at, time: heard }];
      anchors = anchorsNow();
      boxes.get(bar.index)?.classList.add('marked');
      onAnchors?.(hand);
      // Two marks is a map; there is nothing to be gained by making somebody
      // press a button to find that out. One is enough where the app has
      // already placed the page for itself.
      if (anchors.length >= 2) { marking = false; showMode(); return; }
      say();
      return;
    }
    if (practising) {
      const goes = goesAt(runs, bar);
      if (!goes.length) {
        // A PRESS IS ALWAYS ANSWERED WITH SOUND.
        //
        // "Even if it's playing somewhere else in the score, I should click the
        // bar and it starts from that bar." A practice take is a dozen partial
        // passes and the goes only cover the music that was actually played —
        // so a bar in the middle of a passage he skipped had no go, and the
        // press produced a sentence and silence. Which is the app refusing a
        // press it can very nearly honour: the goes it DID place say where the
        // take is at every bar around this one.
        //
        // So: the map first, which the guesses and the taps still feed even on
        // a practice take; and failing that, the nearest bar anything was
        // played at — said out loud, because landing somewhere other than where
        // a finger pointed is a thing a player has to be told rather than left
        // to notice.
        const mapped = timeOfBar(anchors, bar);
        if (mapped !== null) { play?.(mapped); return; }
        let near = null;
        for (const other of bars) {
          const found = goesAt(runs, other);
          if (!found.length) continue;
          const away = Math.abs(other.at - bar.at);
          if (!near || away < near.away) near = { away, bar: other, time: found.at(-1).time };
        }
        if (!near) {
          line.textContent = 'nothing in this take was found on these pages';
          return;
        }
        line.textContent = `nothing was played at that bar — from bar ${near.bar.index + 1}, the nearest that was`;
        play?.(near.time);
        return;
      }
      // THE LAST GO FIRST, because it is the one after you fixed whatever was
      // wrong — and then backwards, one press at a time, round to the start.
      const was = offered.get(bar.index);
      const next = was === undefined ? goes.length - 1 : (was - 1 + goes.length) % goes.length;
      offered.set(bar.index, next);
      const which = goes.length - next;
      const playing = goes.length === 1
        ? 'one go at this bar'
        : `${goes.length} goes at this bar — playing the `
          + `${which === 1 ? 'last' : `${which}${which === 2 ? 'nd' : which === 3 ? 'rd' : 'th'} from last`}`
          + '; press again for the one before';
      // …and how those goes compared, where this bar is in a passage that was
      // played more than once. It is the same sentence every time, so it is
      // worked out once and only chosen here.
      const mine = passages.find((group) => bar.at >= group.at - 1e-9 && bar.at <= group.until + 1e-9);
      line.textContent = mine?.said ? `${playing}. ${mine.said}` : playing;
      play?.(goes[next].time);
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

  // A place somebody TAPPED and a place the app worked out are both anchors and
  // are not the same claim, so they do not look the same: a tap is somebody
  // saying what they heard, and a guess is the app saying what it thinks.
  for (const one of hand) {
    const bar = bars.find((b) => Math.abs(b.at - one.at) < 1e-4);
    if (bar) boxes.get(bar.index)?.classList.add('marked');
  }
  for (const one of guessed) {
    const bar = bars.find((b) => Math.abs(b.at - one.at) < 1e-4);
    if (bar) boxes.get(bar.index)?.classList.add('found');
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
