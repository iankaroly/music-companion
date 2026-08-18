// The pitch a notehead is WRITTEN at, synthesised — for a notehead nobody
// played.
//
// This module exists because of one specific way the scanned review can lie,
// and it is the way a reviewer would never catch by reading the code: a page
// carries hundreds of noteheads and a take covers a few dozen of them, so most
// of what you can press on that page has NO AUDIO BEHIND IT. The plausible
// thing to do when somebody presses one is to play the nearest recorded note —
// it sounds instant, it sounds musical, and it is a specific false claim about
// a specific note. CLAUDE.md rule 5: null propagates and is never defaulted.
//
// So the answer for an unplayed notehead is either nothing at all, or a tone
// that is OBVIOUSLY not the recording. This is the tone. It is a synthesised
// sine-ish voice at the written pitch, at a fixed level, saying "this is what
// is on the page", and the caller says so in words at the same time.
//
// WHY IT IS ITS OWN MODULE, TWICE OVER
//
// Structural, first. The whole hazard is that the unplayed path can reach the
// recording. Here it cannot: this module imports the audio context and nothing
// else, so there is no route from a press on a silent notehead to a Recorder,
// to a played note, or to the report's clip player. That is a stronger
// guarantee than care, and it survives whoever edits scan-view.js next.
//
// Practical, second. The natural home looked like src/ui/report.js, which owns
// every other voice on the review — but report.js reaches document at import
// time through pitch-chart.js and controls.js, and tests/scan-pair.test.js
// imports src/ui/scan-view.js under node. Measured: `node -e
// "import('./src/ui/report.js')"` fails with "document is not defined" while
// `import('./src/audio/context.js')` is clean. Putting the tone in report.js
// and importing it from scan-view.js would have taken the whole scanned-page
// unit suite down with it.

import { audioContext, masterOut, holdAudio, releaseAudio } from './context.js';

// A key of its own in the audio session's hold count. Joining the review's
// 'review' key would mean this voice was invisible to reviewVoicesChanged's
// recount (noteDrone || refDrone || compareDrones.size), which is what decides
// whether the session may sleep — a voice missing from that predicate can be
// switched off underneath itself mid-note.
const HOLD = 'written-pitch';

// About as long as a bowed reference note and no longer. It is an answer to a
// press, not a drone: the drone on the review is a control you can leave on,
// and this is not one — there is no button for it to be stuck down on.
const LENGTH_SEC = 1.1;
// Under the take's own playback level. It is a reference, not a performance,
// and it should not be the loudest thing on the page.
const LEVEL = 0.22;
const ATTACK_SEC = 0.02;
const FADE_SEC = 0.22;

// WHO ELSE IS MAKING A NOISE — and why the dependency runs this way round.
//
// Two voices could sound at once: the take's own playback (report.js) and this
// tone. A press on a dashed notehead while the recording is playing used to
// give you both, which is worse than either — the one thing this tone must be
// is unmistakably NOT the recording, and playing it over the recording is the
// one arrangement where that fails.
//
// The obvious fix is for this module to stop the playback, and it must not:
// this file importing report.js would put the whole scanned unit suite through
// a module that reaches `document` at import time (see the note above), and it
// would also give the unplayed-notehead path a route to the recording, which is
// exactly what this module's import list exists to forbid. So it is inverted —
// this module ANNOUNCES that it is about to sound, report.js subscribes and
// silences its own player. The dependency arrow keeps pointing the safe way and
// nothing here can reach a Recorder.
const starting = new Set();

export function whenWrittenPitchStarts(fn) {
  starting.add(fn);
  return () => starting.delete(fn);
}

let voice = null;   // { osc, gain, ctx }
let timer = 0;
// The last thing this module sounded, for a check to assert on. A browser
// check can see a class and read a sentence, but "was the WRITTEN pitch the
// one that sounded" is not visible from outside — and it is precisely the
// claim this module exists to keep honest.
let last = null;    // { midi, at } | null

export function lastWrittenPitch() {
  return last;
}

export function writtenPitchSounding() {
  return !!voice;
}

export function stopWrittenPitch() {
  clearTimeout(timer);
  timer = 0;
  if (!voice) return;
  const { osc, gain, ctx } = voice;
  voice = null;
  try {
    gain.gain.setTargetAtTime(0, ctx.currentTime, FADE_SEC / 4);
    setTimeout(() => { try { osc.stop(); } catch { /* already finished */ } }, FADE_SEC * 1000);
  } catch {
    // A context that has gone away takes its nodes with it; the hold below is
    // the part that must still be given back.
  }
  // AFTER the fade, not during it. Releasing the hold the instant stop() is
  // asked for lets the session go to sleep under a tone that is still ringing,
  // which on iOS ducks it to nothing halfway through.
  setTimeout(() => releaseAudio(HOLD), FADE_SEC * 1000 + 60);
}

// A soft tone at `midi`, or false if there is no pitch to sound.
//
// Returns FALSE rather than sounding anything when the midi is null, and the
// null case is the common one on a page whose clef or key could not be read.
// The caller has to be able to tell "I sounded the written pitch" from "there
// is no written pitch to sound", because those are two different sentences on
// screen and one of them is a refusal.
export function playWrittenPitch(midi, { a4 = 440 } = {}) {
  if (!Number.isFinite(midi)) return false;
  stopWrittenPitch();
  let ctx;
  try {
    ctx = audioContext();
  } catch {
    return false;
  }
  if (!ctx) return false;

  // Deliberately NOT the report's own drone timbre (report.js:makeOsc, eight
  // harmonics at 1/h^1.5, which is bowed-string-ish on purpose). Three quiet
  // harmonics reads as an obviously synthetic reference next to a recording of
  // a real instrument — the whole point is that nobody can mistake this for
  // the take.
  const real = new Float32Array(4);
  const imag = new Float32Array(4);
  imag[1] = 1;
  imag[2] = 0.18;
  imag[3] = 0.06;

  // Before the tone starts, not after: a subscriber that stops the take's
  // playback has to have stopped it by the time this is audible, or the two
  // overlap for however long the message takes.
  for (const fn of starting) {
    try { fn(midi); } catch { /* a subscriber must not stop the tone sounding */ }
  }

  const osc = ctx.createOscillator();
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
  osc.frequency.value = a4 * 2 ** ((midi - 69) / 12);
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(LEVEL, now + ATTACK_SEC);
  osc.connect(gain).connect(masterOut());
  osc.start();

  holdAudio(HOLD);
  voice = { osc, gain, ctx };
  last = { midi, at: Date.now() };
  timer = setTimeout(stopWrittenPitch, LENGTH_SEC * 1000);
  return true;
}
