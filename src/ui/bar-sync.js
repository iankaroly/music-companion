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
  unplacedSystems, isGuessedAt,
} from '../analysis/bar-map.js';
import { placeSystems } from '../analysis/scan-align.js';
import {
  placeRuns, goesAt, sayRuns, samePassage, compareGoes, sayComparison,
} from '../analysis/practice-runs.js';

/** The anchors the shape-matcher found, and the systems it could not place. */
function guessFrom(layout, notes) {
  const placements = placeSystems(systemsOf(layout), notes);
  return { anchors: guessedAnchors(placements), unplaced: unplacedSystems(placements) };
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
  // THE STRETCHES THE MAP IS ONLY RUNNING ACROSS.
  //
  // Every large error a bar press makes is in one of these — measured, see
  // unplacedSystems in bar-map.js — and the app has always known which they
  // were and thrown the list away at `guessedAnchors`. Kept now, so the bars
  // inside one can look different from the bars an anchor vouches for, and so
  // a press in one can say what it is answering from.
  let unplaced = [];
  // THE GOES THIS TAKE IS MADE OF. A practice recording is not one pass down the
  // page: it is a dozen partial ones, and a bar played six times has six
  // answers. Where there is more than one go, every press is answered from the
  // goes rather than from a single climbing map — see practice-runs.js.
  let runs = [];
  try {
    if (notes?.length) {
      const systems = systemsOf(layout);
      runs = placeRuns(systems, notes).filter((one) => one.sure);
      ({ anchors: guessed, unplaced } = guessFrom(layout, notes));
      // A GAP IS ONLY A GAP IN A MAP THAT HAS SOMETHING IN IT. Where the
      // matcher placed nothing at all — a page it could not read, a take too
      // short to compare — every system is "unplaced" and the map is the even
      // spread from end to end. The strip already says that in one sentence,
      // and tinting every bar on the page as a guess adds nothing to it except
      // noise on the one screen that is supposed to be music.
      if (!guessed.length) unplaced = [];
    }
  } catch { guessed = []; unplaced = []; runs = []; }
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
  //
  // WHERE THE TAKE BEGINS, which is the argument evenAnchors now takes.
  //
  // ONE SOURCE, AND IT IS THE PLAYER. A bar somebody tapped to say "I started
  // here" is somebody reporting what they did; failing that, the top of the
  // page, which is what this did before any of it and is kept as the floor —
  // a page that opens inert is the thing the spread exists to prevent.
  //
  // THE MATCHER WAS TRIED FOR THIS AND IS NOT GOOD ENOUGH, which is worth
  // writing down because it is the obvious thing to reach for. `placeRuns`
  // gives each go an `at` — its first sure anchor walked back by the number of
  // notes played before it — and taking it as the start is exactly the shape of
  // this fix. MEASURED, on the two-page fixture `npm run score:follow` builds,
  // with a take that runs the whole part from the very first note: the run came
  // back `at: 3` on a part of eight systems, off its own guessed anchors at
  // systems 3, 4 and 5 for seconds 0.6, 5.1 and 10.05. The opening of the take
  // placed three systems in. Spreading from there put bar 1 at second zero and
  // lit nothing at all when it was pressed.
  //
  // What saves that map today is the even anchor at the top of the page: it
  // pins the first note where it belongs and the wrong guesses bend the line
  // only in the middle. Handing the same guesses the START as well removes the
  // one thing holding them honest. Placing the entry point automatically is the
  // aligner's job — a single subsequence alignment over the whole part with a
  // free entry — and not something this matcher can be asked for.
  const sounded = (notes ?? []).filter((one) => Number.isFinite(one?.start));
  const firstStart = sounded.length ? Math.min(...sounded.map((one) => one.start)) : null;
  /** The mark that says where the playing started, if one was made. */
  const startMark = () => hand.find((one) => one?.start === true) ?? null;
  const beganAt = () => {
    const mine = startMark();
    if (Number.isFinite(mine?.at)) return mine.at;
    return null;
  };
  const spreadNow = () => {
    try {
      if (!notes?.length || runs.length > 1) return [];
      // No `to`: where a take STOPPED has the same problem as where it began
      // and no mark yet says it, so the end of the part stands.
      return evenAnchors(bars, notes, { from: beganAt() });
    } catch { return []; }
  };
  let even = spreadNow();
  // Everything the map runs on: the taps win, and see mergeAnchors for why they
  // win over the guesses BETWEEN them as well as the ones on top of them. The
  // even pair goes UNDER the shape guesses, so a system the matcher was sure
  // about overrules the straight line at that place and the ends stay pinned.
  const anchorsNow = () => {
    // A START MARK CONTRADICTS EVERY GUESS ABOVE IT. Somebody saying they began
    // at bar 9 is saying bars 1 to 8 were never played, so a system the matcher
    // placed up there is placing music that is not in the take.
    //
    // It also breaks the map if it is left in. The anchors are sorted by PLACE
    // and nothing makes their times climb with them, so a guess above the start
    // carrying a second after the first note gives a line that runs backwards —
    // and `placeAtTime` then searches on a sequence that is not in order at all.
    const began = beganAt();
    const found = Number.isFinite(began)
      ? guessed.filter((one) => one.at >= began - 1e-9)
      : guessed;
    return mergeAnchors(hand, [...even, ...found]);
  };
  let anchors = anchorsNow();
  // The spread depends on the marks — a start mark moves where it begins — so
  // the two are recomputed together and never one without the other.
  const remap = () => { even = spreadNow(); anchors = anchorsNow(); paintUnsure(); };
  // Marking is the job only when nothing — tapped, guessed, spread, or worked
  // out from the goes — has produced an answer. A page the app has placed for
  // itself opens ready to play from.
  let marking = anchors.length < 2 && runs.length < 1;
  let heard = 0;                        // the moment the take is at, in seconds
  // …and whether anything has ever been heard. `heard` starts at 0 and 0 is a
  // real second, so a mark made before the take has been played back once used
  // to be written down as "this bar sounded at second zero" — a wrong anchor,
  // silently, and then a second one made the map and left marking mode. Nothing
  // has been heard yet means the only moment there is to mark is the start.
  let heardEver = false;
  let starting = false;                 // the next tap says where the take began
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
    // WHERE YOU STARTED, where that is the only thing marked. The map is then
    // the spread run from that bar rather than from the top of the page, and
    // which bar it was run from is the fact a player cannot see by looking.
    const began = startMark();
    if (began && hand.length === 1) {
      const bar = bars.find((b) => Math.abs(b.at - began.at) < 1e-4);
      const words = bar ? `started at bar ${bar.index + 1}` : 'started where you marked';
      line.textContent = words;
      onSay?.(words);
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
    // …and how much of the map is running across a system nothing placed. It
    // is a count, not an instruction: the bars it applies to are already drawn
    // differently, and this says how many there are to look for.
    const blind = unplaced.length && anchors.length >= 2
      ? ` — ${unplaced.length} system${unplaced.length === 1 ? '' : 's'} nothing could place`
      : '';
    line.textContent = `${found}${base}${blind}`;
    onSay?.(line.textContent);
  };

  // --- the strip of controls ----------------------------------------------
  const strip = document.createElement('div');
  strip.className = 'bar-sync-bar';
  const mark = document.createElement('button');
  mark.type = 'button';
  mark.className = 'ctl';
  // NAMED, so nothing has to count. A check reached "Start again" as
  // `.ctl:nth-child(2)`, and putting a third button in the strip silently made
  // that the new one — so the step that meant to clear the marks armed the
  // start mode instead and the state it left behind was blamed on the graph.
  mark.dataset.bar = 'where';
  const started = document.createElement('button');
  started.type = 'button';
  started.className = 'ctl';
  started.textContent = 'Started here';
  started.dataset.bar = 'start';
  // Nothing to pin a start to without a take: the mark is that bar and the
  // second of the FIRST NOTE, and with no notes there is no such second.
  started.hidden = firstStart === null;
  const showMode = () => {
    mark.textContent = marking ? 'Done marking' : 'Mark where you are';
    mark.setAttribute('aria-pressed', String(marking));
    started.setAttribute('aria-pressed', String(starting));
    const asking = marking || starting;
    strip.classList.toggle('marking', asking);
    for (const box of boxes.values()) box.classList.toggle('marking', asking);
    say();
  };
  started.addEventListener('click', () => {
    starting = !starting;
    // The two modes ask for different taps, so only one of them may be on.
    if (starting) marking = false;
    showMode();
  });
  mark.addEventListener('click', () => {
    // Marking cannot be finished before there is a map: one anchor is not a
    // line, and leaving it would put the player in a mode where every tap
    // silently does nothing.
    if (marking && anchorsNow().length < 2) { say(); return; }
    marking = !marking;
    // The two modes ask for different taps, so only one of them may be on.
    if (marking) starting = false;
    showMode();
  });
  // NO "START AGAIN". It threw every mark away at once, which is a thing you
  // want about once and a thing you can hit by accident any time — and neither
  // mark needs it to be corrected: marking a bar again replaces the anchor at
  // that place, and marking a different bar as the start replaces the start.
  // Two buttons that each undo themselves do not need a third that undoes both.
  strip.append(mark, started, line);
  // AND NOT ALSO A TAP ON THE MUSIC. `score-tab.js:initScoreFullScreen` opens
  // the full-screen reader on a click anywhere in the stage, and this strip is
  // inside it — so pressing "Mark where you are" armed the mode and then threw
  // the part over the top of the page you were about to mark on. The bar boxes
  // have stopped their own click since they were built, for the same reason;
  // the strip never did. One listener on the strip covers every control in it,
  // including any added later.
  strip.addEventListener('click', (event) => event.stopPropagation());
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

  /**
   * The bars the map is only running ACROSS, drawn so you can see them.
   *
   * Not a warning and not a refusal — a press still plays, and it still plays
   * the map's best answer. What it is is the difference between a control that
   * is sometimes wrong and a control that is sometimes wrong AND says which
   * times, which is the whole of why one is usable and the other is not.
   */
  function paintUnsure() {
    for (const bar of bars) {
      const box = boxes.get(bar.index);
      if (!box) continue;
      box.classList.toggle('unsure', isGuessedAt(anchors, unplaced, bar.at));
    }
  }

  /** The marks, drawn from `hand` — the one place that knows what was marked. */
  function paintMarks() {
    for (const box of boxes.values()) box.classList.remove('marked', 'started');
    for (const one of hand) {
      if (!Number.isFinite(one?.at)) continue;
      const bar = bars.find((b) => Math.abs(b.at - one.at) < 1e-4);
      const box = bar ? boxes.get(bar.index) : null;
      if (!box) continue;
      box.classList.add('marked');
      if (one.start === true) box.classList.add('started');
    }
  }

  /**
   * WHERE THE PLAYING STARTED, said by pointing at it.
   *
   * It needs no clock and no listening back: the second is the take's own first
   * note, which is known the moment the recording stops. That is the whole
   * difference from "mark where you are", which is a timing gesture — play the
   * take, hear a bar, tap it — and cannot be performed at all until the take has
   * been played back once.
   *
   * The mark is an ordinary hand anchor carrying a flag, so everything
   * downstream — mergeAnchors, timeOfBar, the store — takes it as it already
   * takes a tap, and it OUTRANKS the spread at the same place by being at the
   * same place: mergeAnchors keeps only the guesses outside the hand span, and
   * the spread's own start is run from this bar (see beganAt) so the two
   * coincide and tidyAnchors keeps one of them.
   */
  function markStart(bar) {
    if (firstStart === null) return;
    hand = [
      ...hand.filter((one) => one?.start !== true && Math.abs(one.at - bar.at) > 1e-4),
      { at: bar.at, time: firstStart, start: true },
    ];
    starting = false;
    remap();
    paintMarks();
    onAnchors?.(hand);
    // One mark is a map now, because the spread supplies the other end.
    if (anchors.length >= 2) marking = false;
    showMode();
  }

  function press(bar) {
    // Asked for outright, or asked for by the only thing a tap can mean: with
    // nothing heard yet there is no moment to pin a bar to except the first.
    if (starting || (marking && !heardEver && firstStart !== null)) {
      markStart(bar);
      return;
    }
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
      remap();
      paintMarks();
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
    // SAID ON THE PRESS, not only on the page. The bar is already tinted, but
    // the tint is something you have to have noticed; this is the answer to
    // "why did that not start where I pointed", at the moment it happens.
    if (isGuessedAt(anchors, unplaced, bar.at)) {
      line.textContent = `bar ${bar.index + 1} — nothing was placed near it, so this second is worked out`;
    } else say();
    play?.(at);
  }

  // --- the light that follows ------------------------------------------------
  const off = follow?.((note, time) => {
    if (Number.isFinite(time)) { heard = time; heardEver = true; }
    const now = barAtTime(bars, anchors, heard);
    if (now === lit) return;
    boxes.get(lit)?.classList.remove('sounding');
    boxes.get(now)?.classList.add('sounding');
    lit = now;
  });

  // A place somebody TAPPED and a place the app worked out are both anchors and
  // are not the same claim, so they do not look the same: a tap is somebody
  // saying what they heard, and a guess is the app saying what it thinks.
  //
  // Painted from `hand` every time rather than added to as taps arrive, because
  // a start mark MOVES — marking a different bar has to take the class off the
  // old one, and a handler that only ever adds leaves two bars claiming to be
  // where the take began.
  paintMarks();
  paintUnsure();
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
