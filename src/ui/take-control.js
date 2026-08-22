// Starting and stopping a take from somewhere other than the Record tab.
//
// WHY THIS EXISTS AS A MODULE OF ITS OWN. Everything that records lives in the
// closure of main.js — the capture, the segmenter, the clock, the count-in, the
// microphone's permission dance and the analysis that runs when it stops. That
// is the right place for it and it is not moving. But main.js imports the
// reader (through score.js), so the reader cannot import main.js back without
// making a cycle, and the reader is exactly where somebody wants to press
// record: it is the screen with the music on it.
//
// So this is the wire between them, and it carries no logic at all. main.js
// hands over two functions and keeps saying what state it is in; the reader
// calls them and draws a button. Neither knows anything else about the other,
// and nothing here can record — ask it to start with nothing registered and it
// says no rather than pretending.

let control = null;
const watchers = new Set();
let state = { recording: false, busy: false, seconds: 0 };

/**
 * main.js says how to start and stop, once.
 *
 * @param {{start: Function, stop: Function}} how
 */
export function registerTakeControl(how) {
  control = how ?? null;
  takeStateChanged({});   // so a button already on screen learns it can record
}

// One shape, published everywhere.
//
// MEASURED, and it shipped invisible: `takeStateChanged` used to hand watchers
// the raw `state`, which has no `canRecord` in it, while `takeState()` added
// one. So the reader's button drew correctly the moment it was opened and then
// vanished on the FIRST tick of the recording clock — `hidden = !undefined` is
// `hidden = true` — leaving a take running with no way to stop it and no sign
// it was going. The check that was supposed to catch it read `hidden` once, at
// the start, and asked only about the class after that.
function snapshot() {
  return { ...state, canRecord: !!control };
}

/** …and keeps saying where it has got to. */
export function takeStateChanged(next) {
  state = { ...state, ...next };
  const now = snapshot();
  for (const fn of watchers) {
    try { fn(now); } catch { /* a view that throws must not stop a recording */ }
  }
}

/** Whatever is true right now, for a control that has just been drawn. */
export function takeState() {
  return snapshot();
}

/** Called whenever it changes; hand back the unsubscribe. */
export function onTakeChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/**
 * Start a take, or stop the one running.
 *
 * The same one door as the button on the Record tab, because a take started
 * from the music and a take started from the tab have to be the same take —
 * two ways in that each held their own recorder would be two recorders, and on
 * iOS the second one takes the microphone away from the first.
 */
export async function toggleTake() {
  if (!control) return false;
  if (state.recording) return control.stop();
  return control.start();
}
