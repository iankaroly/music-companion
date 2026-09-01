import { startCapture, micIsHeld, prepareCapture, ensureMic } from './audio/capture.js';
import { saying } from './ui/why.js';
import { taught, teach, pressOf, pressName, forgetPedal } from './ui/pedal.js';
import { Analyzer } from './audio/analyzer.js';
import { NoteSegmenter } from './analysis/notes.js';
import { Recorder, MAX_SECONDS } from './audio/recording.js';
import { Tuner } from './ui/tuner.js';
import { renderFreeReview, hideReport, selectPlayedNote } from './ui/report.js';
import { shareFile, fileName } from './ui/export.js';
import {
  saveRecording, listRecordings, loadRecording, deleteRecording, renameRecording,
  createFolder, listFolders, renameFolder, deleteFolder, setRecordingFolder, setScoreFolder,
  fileTakeUnderName,
  listScores, setRecordingScore, renameScore, deleteScore, loadScorePages, savePageOrder,
  listSetlists, saveSetlist, deleteSetlist, replacePages,
} from './store/db.js';
import {
  initScoreCard, annotateTake, clearSheet, currentScoreId, selectScore, renderScoreTab,
  takeSaved, currentScoreStats, openScoreFromLibrary, scoreName,
  reviewIsWaiting, showTakeReview, scanPages, askScoreName,
  measurePages, scoreStatus,
} from './ui/score.js';
import { onScoreTabShown, onScoreTabHidden } from './ui/score-tab.js';
import { initPenCheck } from './ui/pen-check.js';
import { feedReading } from './ui/score-aids.js';
import { toggleDroneNote, retuneDrones, activeDroneNotes, setDroneTimbre } from './audio/drone.js';
import { encodeWav } from './audio/wav.js';
import {
  getVolume, setVolume, audioContext, wakeAudio, holdAudio, releaseAudio,
} from './audio/context.js';
import { fftMagnitudes } from './audio/fft.js';
import { RingBuffer } from './audio/ring-buffer.js';
import { Metronome, tempoName, scheduleClick } from './audio/metronome.js';
import { nameToMidi } from './analysis/note-utils.js';
import { initLiquidTabs } from './ui/liquid-tabs.js';
import { initControls, actionMenu, toggleMenu, refreshRangeFill } from './ui/controls.js';
import { followTextSize } from './ui/text-size.js';
import { readyHaptics } from './ui/haptics.js';
import { renderCoach } from './ui/coach.js';
import { initSettings, keepScreenAwake } from './ui/settings.js';
import { initWelcome } from './ui/welcome.js';
import { registerTakeControl, takeStateChanged } from './ui/take-control.js';
import { close as closeReader, readerIsOpen, sayOnTheMusic } from './ui/reader.js';
import { instrument, segmentation } from './analysis/instruments.js';

initSettings(document); // theme first: the canvases read their colours from it

// Safari raises gesture events for any two-finger pinch — trackpad included —
// and zooming the whole app is never what's wanted here: the charts do their
// own zooming, and everything else is already sized for the screen. Skipped
// while the page is somehow already zoomed, so pinching out still works.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => {
    if ((window.visualViewport?.scale ?? 1) <= 1.01) e.preventDefault();
  }, { passive: false });
}

const tuner = new Tuner(document);
const startBtn = document.querySelector('#start');
const statusEl = document.querySelector('#status');
const recNote = document.querySelector('#rec-note');
const saveBar = document.querySelector('#save-bar');

// Most of what this file says goes to #status, which is spoken and not shown.
// A few things have to be READ, though: they are the answer to a button that
// was just pressed and that otherwise appears to have done nothing at all — a
// take with nothing in it, a save that failed, a microphone that would not
// open. Those go through here as well, onto one line under the Record button.
function say(message, tone = '') {
  statusEl.textContent = message;
  if (!recNote) return;
  recNote.textContent = message;
  recNote.dataset.tone = tone;
}

const clearRecNote = () => say('');

let capture = null;       // active mic session
let lastTake = null;      // finished recording awaiting save/discard
// WHERE THE TAKE WAS STARTED, remembered until it is saved or thrown away.
//
// "when I record on a score and then I save it" is a claim about the DOOR the
// recording came through, not about what happens to be chosen. A piece can be
// open from an hour ago — this file already says so about the name the save
// offers — so gating on "is a score loaded" would file a run of scales under
// the Bach because the Bach was still on the Score tab. The reader's dot is on
// the music itself, and pressing it is somebody saying what they are playing.
//
// Declared HERE, beside the take it belongs to, rather than beside the function
// that sets it: `let` at module scope is in its temporal dead zone until the
// line runs, and a reader four hundred lines above that would abort the module
// on load. That has happened in this file once already.
let takeCameFromTheMusic = false;
// The take just saved to the library, until it is filed under a piece or
// another take replaces it — so "save it" and "file it under the Bach" can be
// done in either order.
let savedTakeId = null;
let tunerStarting = false; // declared before tabs init — onShown fires during it

// --- tabs ------------------------------------------------------------------

const tabs = initLiquidTabs({
  nav: document.querySelector('nav[role="tablist"]'),
  panes: document.querySelector('#panes'),
  order: ['tuner', 'analyze', 'score', 'library', 'coach', 'metronome'],
  // The Score tab is permanent: it is always in the dock and it always has
  // something to say — the review when a take has been marked up, and how to
  // load a piece when none is open. So it restores like every other tab. (It
  // used to be sent to Record on launch, from when the dock button appeared
  // and disappeared with the score and restoring stranded you on a blank
  // panel with no way out.)
  initial: localStorage.getItem('tab') ?? 'tuner',
  onShown: (name, previous) => {
    localStorage.setItem('tab', name);
    // The playback panel is one node shared by both views of the review, so
    // whichever tab is leaving hands it back before the arriving one takes it.
    if (previous === 'score') onScoreTabHidden();
    if (name === 'score') {
      onScoreTabShown();
      // Only now does the panel have a width to engrave into.
      renderScoreTab().catch(() => {});
    }
    if (name === 'coach') renderCoach(document); // fresh habits every visit
    // Deferred a tick, BOTH WAYS: the initial onShown fires while this module
    // is still initializing, and both of these read bindings declared further
    // down the file.
    //
    // Only the tuner half was deferred, and the other half threw — every time.
    // `autoStopTuner` reads `scoreWantsEars`, a `let` about 330 lines below
    // this one, so the branch taken for EVERY tab except the tuner ran inside
    // its temporal dead zone and aborted the rest of main.js with "Cannot
    // access 'scoreWantsEars' before initialization". Which is to say: the app
    // finished starting up only for somebody whose last tab was the tuner.
    // Everyone else got a shell — the tab bar, the markup, the CSS — with none
    // of the wiring below this line, which is why the metronome's pickers came
    // up as raw browser dropdowns and the saved tab did not always open.
    //
    // FOUND by looking — a screenshot taken for the metronome tab had the
    // app's own error toast in the corner of it — and then measured properly:
    // `npm run startup:tabs` opens on each tab in turn and requires zero page
    // errors. Against the commit before this one it fails five of six.
    if (name === 'tuner') queueMicrotask(autoStartTuner); // the tuner just runs here
    else queueMicrotask(autoStopTuner);
  },
});
const showTab = (name) => tabs.show(name);

// --- calibration -----------------------------------------------------------

const a4Input = document.querySelector('#a4');
a4Input.value = localStorage.getItem('a4') ?? '440';

function currentA4() {
  const v = Number(a4Input.value);
  return Number.isFinite(v) && v >= 400 && v <= 450 ? v : 440;
}

// Applied on every keystroke, not just committed changes — the drone and
// tuner must follow the calibration the moment it reads 442.
function applyA4() {
  const a4 = currentA4();
  localStorage.setItem('a4', String(a4));
  tuner.a4 = a4;
  if (capture?.segmenter) capture.segmenter.a4 = a4;
  if (capture?.chord) capture.chord.segmenter.a4 = a4;
  retuneDrones(droneFrequency);
}
a4Input.addEventListener('input', applyA4);
a4Input.addEventListener('change', () => { a4Input.value = String(currentA4()); applyA4(); });
tuner.a4 = currentA4();

// --- pitch pipe (chord-capable drone) ---------------------------------------

const PIPE_NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const pitchPipe = document.querySelector('#pitch-pipe');
const droneOctSel = document.querySelector('#drone-octave');

function droneFrequency(name) {
  const midi = nameToMidi(name + droneOctSel.value);
  return currentA4() * 2 ** ((midi - 69) / 12);
}

for (const name of PIPE_NOTES) {
  const btn = document.createElement('button');
  btn.textContent = name;
  btn.addEventListener('click', () => {
    const on = toggleDroneNote(name, droneFrequency(name));
    btn.classList.toggle('active', on);
  });
  pitchPipe.append(btn);
}
droneOctSel.addEventListener('change', () => retuneDrones(droneFrequency));
const timbreSel = document.querySelector('#drone-timbre');
timbreSel.addEventListener('change', () => {
  setDroneTimbre(timbreSel.value);
  localStorage.setItem('timbre', timbreSel.value);
});
// The instrument profile supplies the starting drone voice; once the player has
// touched the control, their choice wins.
timbreSel.value = localStorage.getItem('timbre') ?? instrument().timbre;
setDroneTimbre(timbreSel.value);

// --- tuner display: transposition & temperament ------------------------------

const transposeSel = document.querySelector('#transpose');
const temperamentSel = document.querySelector('#temperament');
const temperamentRootSel = document.querySelector('#temperament-root');
for (const name of PIPE_NOTES) {
  const opt = document.createElement('option');
  opt.value = String(PIPE_NOTES.indexOf(name));
  opt.textContent = `root ${name}`;
  temperamentRootSel.append(opt);
}
function applyTunerSettings() {
  tuner.transpose = Number(transposeSel.value);
  tuner.temperament = temperamentSel.value;
  tuner.temperamentRoot = Number(temperamentRootSel.value);
  localStorage.setItem('tunerSettings',
    JSON.stringify([transposeSel.value, temperamentSel.value, temperamentRootSel.value]));
}
for (const sel of [transposeSel, temperamentSel, temperamentRootSel]) {
  sel.addEventListener('change', applyTunerSettings);
}
try {
  const saved = JSON.parse(localStorage.getItem('tunerSettings'));
  if (saved) [transposeSel.value, temperamentSel.value, temperamentRootSel.value] = saved;
} catch { /* fresh install */ }
applyTunerSettings();

// --- volume ------------------------------------------------------------------

const volumeSlider = document.querySelector('#volume');
volumeSlider.value = String(getVolume());
volumeSlider.addEventListener('input', () => setVolume(Number(volumeSlider.value)));

// The settings sheet owns a second copy of some of these controls; it
// announces rather than reaching in, so everything that cares updates here.
document.addEventListener('settings-change', (e) => {
  if (e.detail?.key === 'volume') {
    volumeSlider.value = String(getVolume());
    refreshRangeFill(volumeSlider);
  }
  if (e.detail?.key === 'tolerance') tuner.refreshZones();
  if (e.detail?.key === 'library') refreshLibrary(); // a restore just landed
});

// --- shared display helpers ------------------------------------------------

// Every note is kept; none of them is shown while the take is running.
//
// A row of chips filling up with cents as you play is a screen you play TO —
// you hear a note, you read a number, and the next phrase is about the number.
// The whole take is read back the moment you stop, which is when reading it is
// any use. (The tuner tab is the place for a live reading, and it is a separate
// tab on purpose.)
function handleNote(note) {
  capture?.collected?.push(note);
}

function feed(analyzer, segmenter, chunk, onNote = handleNote, readings = null, chord = null) {
  for (const reading of analyzer.push(chunk)) {
    tuner.update(reading);
    // The same readings the dial on the tuner tab is fed, so a tuner opened on
    // a page of music is the same tuner rather than a second one listening.
    feedReading(reading);
    readings?.push(reading);
    for (const note of segmenter.push(reading)) onNote(note);
    if (chord) {
      // The second string of a double stop gets its own segmentation, so
      // chords land in the note boxes too.
      const sec = reading.secondary;
      const secReading = {
        frequency: sec?.frequency ?? null,
        confidence: sec?.confidence ?? 0,
        rms: reading.rms,
        time: reading.time,
      };
      for (const note of chord.segmenter.push(secReading)) chord.onNote(note);
    }
  }
}

function stopEverything() {
  stopSpectrum();
  if (capture) {
    capture.stop();
    capture = null;
  }
  startBtn.textContent = 'Record';
  statusEl.textContent = '';
  tuner.update({ frequency: null, confidence: 0, rms: 0 });
}

async function beginCapture(extra = {}) {
  let analyzer = null;
  let recorder = null;
  const readings = [];
  const segmenter = new NoteSegmenter({ a4: currentA4(), ...segmentation() });
  const chord = {
    // the profile first, then the second voice's own longer floor on top
    segmenter: new NoteSegmenter({ a4: currentA4(), ...segmentation(), minDuration: 0.12 }),
    onNote: (note) => { note.chord = true; handleNote(note); },
  };
  const session = await startCapture((chunk) => {
    recorder?.push(chunk);
    spectrumRing.write(chunk);
    feed(analyzer, segmenter, chunk, handleNote, readings, chord);
  }, {
    // A take keeps its microphone through a locked screen; the tuner does not
    // (it hands the hardware back the moment nobody is looking at it).
    throughLock: !extra.listen,
    // A phone call mid-take used to truncate it in silence while the button
    // still said "Stop & review". Now the take is closed off and offered for
    // review with what was actually captured, and the reason is said out loud.
    onInterrupted: (reason) => {
      if (!capture) return;
      if (capture.listen) {
        stopEverything();
        showListenButton(true);
        // On the TUNER, where the person watching the needle is looking. This
        // is the same mistake the failed-to-start path made: the microphone
        // stops working and the explanation appears on another tab.
        const note = document.querySelector('#tuner-listen-note');
        if (note) { note.textContent = reason; note.dataset.tone = 'bad'; }
        document.querySelector('#cents').textContent = '';
      } else {
        finishRecording(`${reason} — here's the take up to that point`);
      }
      statusEl.textContent = reason;
    },
  });
  startSpectrum();
  // Fine 11.6ms hop for fast passages; the long window plus a fast
  // sub-window keeps double-stop detection AND fast mono tracking.
  analyzer = new Analyzer(session.sampleRate, { dual: true, hopSize: 512 });
  recorder = new Recorder(session.sampleRate);
  session.segmenter = segmenter;
  session.chord = chord;
  session.recorder = recorder;
  session.readings = readings;
  Object.assign(session, extra);
  return session;
}

// --- live tuner: runs while the tuner tab is open ----------------------------
//
// It used to start itself the moment the app opened, which meant the browser's
// microphone prompt was the first thing you saw on every launch — and on iOS
// Safari a permission granted to a plain web page doesn't survive the page
// being closed, so "every launch" was literal. Nothing here can persist that
// grant; what it can do is stop asking unbidden. So: if the browser already
// holds the permission we start silently, and if it doesn't, the tuner waits
// behind a button and the prompt arrives when you ask for it.

const listenBtn = document.querySelector('#tuner-listen');
let micGranted = null; // null = not asked the browser yet

// Whether the mic has EVER been granted on this install.
//
// Safari has no 'microphone' descriptor for the Permissions API, so the query
// below rejects there and always read as "not granted" — which is why the app
// asked again on every single launch even though iOS had long since remembered
// the answer. Once a capture has actually succeeded we know the grant exists,
// and iOS keeps it across launches, so that fact is worth writing down.
//
// It is a cache of something the system owns, not the permission itself: if the
// grant is revoked in Settings the next capture throws, and the failure paths
// below clear this and put the button back.
const GRANTED_KEY = 'micGranted';

function grantedBefore() {
  try {
    return globalThis.localStorage?.getItem(GRANTED_KEY) === 'yes';
  } catch {
    return false;
  }
}

function rememberGrant(granted) {
  micGranted = granted;
  try {
    if (granted) globalThis.localStorage?.setItem(GRANTED_KEY, 'yes');
    else globalThis.localStorage?.removeItem(GRANTED_KEY);
  } catch { /* survivable */ }
}

async function permissionGranted() {
  if (micGranted !== null) return micGranted;
  try {
    // Not in every browser, and 'microphone' is not in every implementation
    // that does have it — an unknown name rejects, which reads as "ask first".
    const status = await navigator.permissions.query({ name: 'microphone' });
    // 'prompt' from a webview does not mean the system has not granted it —
    // the page-level answer and the app-level one are different things, and
    // only the app's survives a relaunch. What we watched work counts.
    micGranted = status.state === 'granted' || grantedBefore();
    status.onchange = () => rememberGrant(status.state === 'granted');
  } catch {
    // No usable answer from the browser; fall back to what we saw ourselves.
    micGranted = grantedBefore();
  }
  return micGranted;
}

function showListenButton(show) {
  listenBtn.hidden = !show;
  if (show) document.querySelector('#cents').textContent = '';
}

// What the note under the Listen button says when nothing has gone wrong.
const listenNote = document.querySelector('#tuner-listen-note')?.textContent ?? '';

async function startTuner() {
  if (capture || tunerStarting) return;
  tunerStarting = true;
  showListenButton(false);
  document.querySelector('#cents').textContent = 'listening';
  try {
    // Bounded, for the same reason the record button's wait is: a microphone
    // that never answers is a promise that never settles, and the tuner would
    // sit on the word "listening" until the app was closed. A late answer
    // after this has given up leaves a session nobody picked up — which costs
    // a stream on a device that is already refusing to work, and is worth it
    // for a tuner that says what happened.
    capture = await within(beginCapture({ listen: true }), 12000);
    const note = document.querySelector('#tuner-listen-note');
    if (note) { note.textContent = listenNote; delete note.dataset.tone; }
    rememberGrant(true); // whatever the Permissions API said, we have it now
  } catch (err) {
    // Said on the TUNER, where the person who tapped Listen is looking. It
    // used to be written to the Record tab's status line, on another screen —
    // so a microphone the iPad would not open left the tuner sitting on the
    // word "listening" for ever, with the explanation on a tab nobody had any
    // reason to visit.
    statusEl.textContent = saying('mic unavailable', err);
    document.querySelector('#cents').textContent = 'no microphone';
    const note = document.querySelector('#tuner-listen-note');
    if (note) {
      note.textContent = saying('The microphone did not open', err);
      note.dataset.tone = 'bad';
    }
    rememberGrant(false); // it was refused or revoked — ask again next time
    showListenButton(true);
  } finally {
    tunerStarting = false;
  }
  // the user may have left the tab while the mic was being granted
  if (capture?.listen && tabs.current !== 'tuner' && !scoreWantsEars) stopEverything();
}

async function autoStartTuner() {
  // an active recording already feeds the tuner display — don't touch it
  if (capture || tunerStarting) return;
  // Already granted, or already granted earlier in this visit (the parked
  // stream in capture.js means restarting costs nothing): just listen.
  if (micIsHeld() || await permissionGranted()) startTuner();
  else showListenButton(true);
}

function autoStopTuner() {
  // …unless a score is holding it. A tuner opened on a page of music is being
  // used by somebody who is not on the tuner tab and never will be while they
  // are playing from that page.
  if (scoreWantsEars) return;
  if (capture?.listen) stopEverything();
}

// A tuner opened over a page of music, asking for the microphone out loud —
// see score-aids.js. It is said this way round so there is still exactly one
// piece of code that starts and stops a capture: two would leave a stream open
// the first time they disagreed.
let scoreWantsEars = false;
document.addEventListener('score-tuner', (e) => {
  const want = !!e.detail?.on;
  if (want === scoreWantsEars) return;
  scoreWantsEars = want;
  if (want) {
    prepareCapture();
    // Tapped, so this IS the gesture and the microphone may be asked for
    // outright. Opened from a menu it is not, and the permission check that
    // autoStartTuner does first would end the gesture before getUserMedia was
    // ever called — which is why the strip has a Listen button of its own.
    if (e.detail?.tap) startTuner();
    else autoStartTuner();
  } else if (capture?.listen && tabs.current !== 'tuner') {
    stopEverything();
  }
});

// prepareCapture must run in the tap itself, before startTuner's first await
listenBtn.addEventListener('click', () => { prepareCapture(); startTuner(); });

// --- record → review → save or discard -------------------------------------

const saveBtn = document.querySelector('#save-rec');
const scoreSaveBar = document.querySelector('#score-save-bar');
const scoreSaveTake = document.querySelector('#score-save-take');

// Saving a take and keeping it as an attempt at a PIECE are two decisions, and
// they are now made in two places rather than by arming a toggle before
// pressing Save. Under Record: save it to the library, plainly. At the bottom
// of the Score tab, where you have just read the take against the music: keep
// it as a take of this piece.
//
// The order does not matter. Save it to the library first and the Score tab
// still offers to file it under the piece — it says "add" rather than "save",
// because by then the take is already kept and only the piece is missing.
function refreshSaveLabel() {
  const piece = scoreName();
  saveBtn.textContent = 'Save to library';
  if (!scoreSaveBar || !scoreSaveTake) return;
  scoreSaveBar.hidden = !(piece && (lastTake || savedTakeId !== null));
  scoreSaveTake.textContent = !piece ? ''
    : lastTake ? `Save this take to ${piece}` : `Add this take to ${piece}`;
}
refreshSaveLabel();

// SAYING IT WHERE THE BUTTON IS, and not only in the status line.
//
// Saving worked and looked as though it had not. The one line the app has is
// `#status`, and saving a take re-renders the whole review on top of itself —
// `renderFreeReview` and then `annotateTake`, which writes the take's summary
// into that same line a moment later. So "saved to Bach — Prelude" appeared and
// was overwritten inside a second by the sentence that had been there before
// the press, and the save bar hid itself. Press, and the screen goes back to
// exactly what it looked like: "when I click Save… none of those are working."
//
// So the confirmation lives in the bar the button is in, where it cannot be
// overwritten by something else's news, and it stays until the bar has another
// job to do. Feedback belongs beside the thing it is about.
const scoreSaid = document.createElement('p');
scoreSaid.id = 'score-saved';
scoreSaid.className = 'hint saved';
scoreSaid.hidden = true;
scoreSaveBar?.after(scoreSaid);

function saidOnTheBar(words) {
  if (!scoreSaid) return;
  scoreSaid.hidden = !words;
  scoreSaid.textContent = words ?? '';
}

scoreSaveTake?.addEventListener('click', async () => {
  if (lastTake) { saveTake({ toScore: true }); return; }
  // NOT A SILENT RETURN. There was one here, and it is the shape of every
  // button that "does nothing when I click it": nothing to save, nothing said,
  // nothing to tell a player whether the press was even received.
  if (savedTakeId === null) {
    saidOnTheBar(scoreName()
      ? `this take is already filed under ${scoreName()}`
      : 'no take on screen to keep');
    return;
  }
  const id = savedTakeId;
  const piece = scoreName();
  try {
    await setRecordingScore(id, currentScoreId(), currentScoreStats());
    savedTakeId = null;
    refreshSaveLabel();
    statusEl.textContent = `added to ${piece}`;
    saidOnTheBar(`added to ${piece}`);
    await takeSaved(id);
    refreshLibrary();
  } catch (err) {
    say(saying('could not add it to the piece', err), 'bad');
    saidOnTheBar(saying('could not add it to the piece', err));
  }
});

function clearTake() {
  clearRecNote(); // whatever went wrong last time is not about this take
  lastTake = null;
  // …and the door it came through goes with it. `startTakeNow` calls this
  // before it opens the microphone, so a take begun from the Record tab cannot
  // inherit the last one's answer.
  takeCameFromTheMusic = false;
  savedTakeId = null; // a new take on screen; the last one is the library's now
  saidOnTheBar(null);  // last take's news, about a take that is going away
  refreshSaveLabel();
  saveBar.hidden = true;
  hideReport(document);
  clearSheet();
}

// Close off the take and put the review up. Shared by the Stop button and by
// an interruption, which has to leave the player with what they played rather
// than with a screen that still claims to be recording.
function finishRecording(note = null) {
  if (!capture || capture.listen) return;
  pauseBtn.hidden = true;
  stopClock();
  const { segmenter, chord, collected, recorder, readings } = capture;
  for (const n of segmenter.flush()) collected.push(n);
  for (const n of chord.segmenter.flush()) chord.onNote(n);
  stopEverything();
  if (collected.length === 0) {
    say(note ?? 'nothing detected — recording discarded', note ? '' : 'bad');
    return;
  }
  lastTake = { recorder, notes: collected, readings, a4: currentA4() };
  refreshSaveLabel(); // there is a take to keep now, so the Score tab offers to
  renderFreeReview(document, collected, recorder, { readings, a4: lastTake.a4 });
  saveBar.hidden = false;
  if (note) statusEl.textContent = note;
  // The charts are up already; the score arrives a moment later because the
  // engraver is fetched on first use. Nothing below waits on it.
  annotateTake(collected, { readings, a4: lastTake.a4 })
    .catch(() => { /* score.js has already said so on the card */ });
}

// --- the recording clock, count-in and pause --------------------------------

const pauseBtn = document.querySelector('#pause-rec');
const recClock = document.querySelector('#rec-clock');
const countInSel = document.querySelector('#count-in');
let clockTimer = null;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
  recClock.textContent = '';
  recClock.classList.remove('warn');
}

function startClock(recorder) {
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    if (!capture || capture.listen) return stopClock();
    const left = recorder.remaining;
    recClock.textContent = recorder.paused
      ? `paused at ${mmss(recorder.duration)}`
      : mmss(recorder.duration);
    // The cap is not a surprise any more: the last minute counts down.
    if (left <= 60) {
      recClock.textContent += ` · ${Math.ceil(left)}s left`;
      recClock.classList.add('warn');
    }
    // …and whoever else is showing this take — the button on the music has its
    // own clock to keep.
    takeStateChanged({ seconds: recorder.duration, recording: true });
  }, 250);
}

// Four clicks (or eight) before the take starts, so a tempo is already in your
// head — the thing every player does with a metronome before they play.
function countIn(bars) {
  if (bars <= 0) return Promise.resolve();
  const beats = bars * metronome.beatsPerBar;
  const ctx = wakeAudio();
  const beat = 60 / metronome.bpm;
  const from = ctx.currentTime + 0.15;
  for (let i = 0; i < beats; i++) {
    scheduleClick(ctx, from + i * beat, i % metronome.beatsPerBar === 0 ? 'accent' : 'beat');
  }
  let left = beats;
  const tick = setInterval(() => {
    left--;
    statusEl.textContent = left > 0 ? `count-in… ${left}` : 'recording';
    if (left <= 0) clearInterval(tick);
  }, beat * 1000);
  statusEl.textContent = `count-in… ${beats}`;
  return new Promise((resolve) => setTimeout(resolve, (from - ctx.currentTime + beats * beat) * 1000));
}

pauseBtn.addEventListener('click', () => {
  const recorder = capture?.recorder;
  if (!recorder) return;
  recorder.paused = !recorder.paused;
  pauseBtn.textContent = recorder.paused ? 'Resume' : 'Pause';
  pauseBtn.classList.toggle('active', recorder.paused);
  statusEl.textContent = recorder.paused ? 'paused' : 'recording';
});

// A microphone that never answers is a promise that never settles, and a
// promise that never settles is a button that stays disabled for the rest of
// the session with nothing said. It happens on iOS: a permission prompt
// dismissed rather than answered, or an audio session the system will not hand
// over, and getUserMedia simply never comes back. So the wait is bounded, and
// running out of patience is an error like any other — the control comes back
// and the screen says what to do about it.
//
// Which advice, though, depends on where the app is running, and the wrong
// advice is worse than none: an app added to the home screen is not Safari and
// does not answer to Settings → Safari, so sending somebody there sends them to
// a switch that was never the one holding the microphone shut. Written the day
// that happened — both settings checked, both already right, and the app still
// silent, because the app doing the refusing was the installed one.
function noAnswer() {
  return 'the microphone never answered. If a permission prompt appeared, answer it and try again — '
    + (installedApp()
      ? 'otherwise this is the installed app being refused, which the Safari settings do not govern:'
        + ' open the same address in Safari itself and record there to see whether it is only the'
        + ' installed copy'
      : 'otherwise check Settings → Safari → Microphone, and Screen Time → Content & Privacy'
        + ' → Microphone if that is on')
    + `. ${SEE_SETTINGS}`;
}

// Every dead end above ends here, because the answer to "what is actually wrong
// on THIS iPad" is already one tap away and nothing on screen said so.
const SEE_SETTINGS = 'The gear, top right, checks the microphone and says what it finds';

function installedApp() {
  return navigator.standalone === true
    || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
}

async function within(work, ms) {
  let timer = null;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(noAnswer())), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * STOP THE TAKE — the one path, whichever door it was asked from.
 *
 * The Record tab has a button and so does the reader, and they must be the same
 * take: two doors each holding their own recorder would be two recorders, and
 * on iOS the second one takes the microphone away from the first. So both call
 * this. See ui/take-control.js for the wire between them.
 */
async function stopTakeNow() {
  if (!(capture && !capture.listen)) return false;
  // Said before, not after: this and `startTakeNow` both begin with a tap on
  // the same button, and "nothing happened" has to be able to tell which ran.
  say('finishing that take…');
  try {
    finishRecording();
  } catch (err) {
    // A capture left in pieces — an interruption iOS never told us about, a
    // session reclaimed while the app was away — must not turn this into a
    // button that can only ever try to finish something that is not there.
    // Whatever state it is in, the next press records.
    capture = null;
    startBtn.textContent = 'Record';
    say(`${saying('that take could not be finished', err)} — press record to start again`, 'bad');
  }
  takeStateChanged({ recording: false, busy: false, seconds: 0 });
  // AND THEN GO AND LOOK AT IT. Stopping used to leave you exactly where you
  // were, which is right on the Record tab — the review is already on the
  // screen you are looking at — and wrong on the music, where the page you are
  // reading covers the whole review and the take appears to vanish. "when i
  // record on an opened score, and stop recording, it should take me to a new
  // window to analyze the recording."
  //
  // The reader being OPEN is the condition, not the door the take started at:
  // record from the tab, put the phone on the stand, open the score, play, stop
  // — and you are still somebody looking at music who has just finished a take.
  //
  // A take with nothing in it does NOT take the page away. Being thrown out of
  // your music to be told the app heard nothing is a worse trade than the same
  // sentence over the page you are still reading from.
  if (readerIsOpen()) {
    if (lastTake) {
      closeReader();
      showTab('score');
    } else {
      sayOnTheMusic('nothing detected in that take');
    }
  }
  return true;
}

/** …and START one, from either door. */
async function startTakeNow({ from = 'analyze' } = {}) {
  if (capture && !capture.listen) return false;
  // in the tap, before the count-in — see prepareCapture in capture.js
  prepareCapture();
  stopEverything();
  clearTake();
  // AFTER `clearTake`, which resets it. Set before that line it would be wiped
  // by the very call that is meant to forget the LAST take, and every take
  // would look as though it came from the Record tab.
  takeCameFromTheMusic = from === 'reader';
  startBtn.disabled = true;
  takeStateChanged({ busy: true });
  say('asking for the microphone…');
  try {
    await within(ensureMic(), 12000);
    rememberGrant(true);
    await countIn(Number(countInSel.value) || 0);
    // A count-in is seconds long and the app is still usable during it; walking
    // away must not leave a recording running on a screen you can't see. The
    // READER counts as being here — it is the music, and recording while
    // reading it is the whole point of the button there — so the check is
    // against the door this came in by rather than against the tab.
    if (from === 'analyze' && tabs.current !== 'analyze') {
      statusEl.textContent = '';
      takeStateChanged({ recording: false, busy: false });
      return false;
    }
    capture = await beginCapture({ collected: [] });
    keepScreenAwake(); // ten minutes of playing is ten minutes of nobody tapping
    capture.recorder.onFull = () => {
      statusEl.textContent = `that's the ${MAX_SECONDS / 60}-minute limit — stop and review`;
    };
    startBtn.textContent = 'Stop & review';
    pauseBtn.hidden = false;
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('active');
    statusEl.textContent = 'recording';
    startClock(capture.recorder);
    takeStateChanged({ recording: true, busy: false, seconds: 0 });
    return true;
  } catch (err) {
    rememberGrant(false);
    // A REFUSAL IS NOT AN ERROR, IT IS AN ANSWER, and it needs the way back
    // rather than the browser's word for it. `why()` prefers a thrown message
    // over its own name, and Chrome's message here is "Permission denied" — so
    // the first thing a new player saw after pressing the app's one big button
    // was "mic unavailable — Permission denied", which says what happened and
    // nothing about what to do. This is the ONLY path that gets its own
    // sentence, because it is the only one where the player is the fix.
    say(err?.name === 'NotAllowedError'
      ? 'the microphone was not allowed — turn it on for this app in your'
        + ' browser or phone settings, then press Record again'
      : saying('mic unavailable', err), 'bad');
    takeStateChanged({ recording: false, busy: false });
    return false;
  } finally {
    startBtn.disabled = false;
  }
}

registerTakeControl({
  start: () => startTakeNow({ from: 'reader' }),
  stop: () => stopTakeNow(),
});

// THE RECORD TAB'S OWN BUTTON, which is now one of two doors into the same
// take: see `stopTakeNow` and `startTakeNow` above, and ui/take-control.js for
// the other door, on the music itself.
startBtn.addEventListener('click', async () => {
  if (capture && !capture.listen) {
    await stopTakeNow();
    return;
  }
  await startTakeNow({ from: 'analyze' });
});

// One save, two doors into it. toScore attaches the take to the piece it was
// read against, which is what puts it under that piece in the library.
//
// AND IT IS ASKED WHAT TO CALL IT, where there is something to suggest.
//
// "when you record from the score and then save it, it just saves to the
// library under that name or whatever name you want it." A take saved from a
// piece used to arrive in the library with no name at all, so `libraryRow` drew
// it as a date with the piece buried in the grey line underneath: nothing on
// the shelf was called what he had just played, which is what "it's not going
// anywhere" is describing. The piece's own name is already the right answer
// nearly every time, so it is filled in and selected rather than asked for
// blank, and Cancel backs out of the save entirely — the take is still on
// screen and Save is still there.
function saveTake({ toScore = false } = {}) {
  if (!lastTake) return;
  // ONLY THE DOOR THAT IS ABOUT A PIECE ASKS.
  //
  // The gate was `scoreName()` — is a piece open at all — and that is the wrong
  // question, because the Record tab's "Save to library" is the same function
  // and a piece can be open from an hour ago. Pressing it after a run of scales
  // would have offered to call them the Bach, and then filed them in the Bach's
  // folder on the second one. Its confirmation is the other hazard: `saidOnTheBar`
  // writes to a line under the SCORE tab's save bar, so a Cancel from the Record
  // tab would have said nothing anywhere at all — the button that does nothing
  // when you click it, which this file warns about twice.
  const suggested = toScore ? scoreName() : null;
  if (!suggested) { keepTake({ toScore, name: null }); return; }
  askTakeName(suggested, (name) => {
    if (name === null) { saidOnTheBar('not saved — it is still here'); return; }
    keepTake({ toScore, name: name || suggested });
  });
}

async function keepTake({ toScore = false, name = null } = {}) {
  if (!lastTake) return;
  const { recorder, notes, readings, a4 } = lastTake;
  // WHERE IT GOES IS NOT A SECOND DECISION ANY MORE.
  //
  // "when I record on a score and then I save it, it should just save to the
  // library" — and the piece it was played from goes with it. Filing the take
  // under the score used to happen only if you pressed the OTHER save, the one
  // at the foot of the Score tab, so a take played off the page in front of
  // you was kept with no piece attached at all. Reopening it tomorrow found a
  // recording of nothing in particular, on a tab with no music on it.
  //
  // There is nothing to ask. A score is open or it is not, and if it is, that
  // is the score the playing was against. `toScore` stays as an argument
  // because the Score tab's own button still passes it, and it now means the
  // same thing this does rather than something extra.
  const scoreId = currentScoreId();
  const filed = (toScore || takeCameFromTheMusic) && scoreId !== null;
  const piece = filed ? scoreName() : null;
  try {
    const id = await saveRecording({
      date: Date.now(),
      duration: recorder.duration,
      sampleRate: recorder.sampleRate,
      audio: recorder.extract(0, recorder.duration).buffer,
      notes,
      readings,
      a4,
      name,
      scoreId: filed ? scoreId : null,
      // Note-by-note against the written pitch, so this take can be read again
      // tomorrow without re-aligning anything.
      scoreStats: filed ? currentScoreStats() : null,
    });
    // …and the second go at the same thing makes a folder of it. See
    // fileTakeUnderName: one take is a row, two are a folder with both in.
    const folderId = name ? await fileTakeUnderName(id, name).catch(() => null) : null;
    saveBar.hidden = true;
    lastTake = null;
    takeCameFromTheMusic = false;
    // Null once it is filed, because `refreshSaveLabel` reads this to decide
    // whether to offer "Add this take to <piece>" — and offering to add a take
    // that is already under the piece is the bar asking for something it has.
    savedTakeId = filed ? null : id; // still fileable under a piece if it wasn't
    refreshSaveLabel();
    const where = name ? `saved as ${name}` : 'saved to library';
    const news = folderId ? `${where} — it is in the ${name} folder now` : where;
    statusEl.textContent = news;
    // …and where it will still be readable in a second's time. The two lines
    // below rebuild the whole review and write the take's summary into
    // `#status`, so this is the only copy of the news that survives the press.
    saidOnTheBar(folderId
      ? `${where} — ${piece ? `${piece}, ` : ''}in a folder with the other takes`
      : (piece ? `${where} — under ${piece}` : where));
    // Re-render the same review now that the take has an id, so passages can
    // be marked without reopening it from the library. The score card needs
    // the id for the same reason: without it, choosing a score for the take
    // just saved would mark the page but never attach the score to the take,
    // and the attachment would be lost until it was reopened.
    renderFreeReview(document, notes, recorder, { readings, a4, recordingId: id });
    annotateTake(notes, { readings, a4, recordingId: id })
      .then(() => (filed ? takeSaved(id) : null))
      .catch(() => {});
    refreshLibrary();
  } catch (err) {
    say(saying('could not save', err), 'bad');
  }
}

saveBtn.addEventListener('click', () => {
  // Same silent-return hazard as the Score tab's button: `saveTake` returns at
  // once with no take, and a Save that answers nothing is a Save that looks
  // broken.
  if (!lastTake) { say('no take on screen to save', 'bad'); return; }
  saveTake();
});

document.querySelector('#discard-rec').addEventListener('click', () => {
  clearTake();
  statusEl.textContent = 'recording discarded';
});

// …and the same decision at the bottom of the Score tab, where the take has
// just been read against the music. A take that is already IN the library is
// not thrown away by this — by then the only thing on offer was filing it under
// the piece, so this says no to that and leaves the recording alone.
document.querySelector('#score-discard-take')?.addEventListener('click', () => {
  const kept = !lastTake && savedTakeId !== null;
  const words = kept
    ? 'left in the library, not filed under the piece'
    : 'take discarded';
  clearTake();   // clears the bar's own line, so the news goes on after it
  statusEl.textContent = words;
  saidOnTheBar(words);
});

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * A take, the page it was played from, and the marks made by ear — as a file.
 *
 * Read `npm run scan:real` for what it is for. In short: the app measures its
 * bar map against a synthesised take because that is the only take whose truth
 * is known, and a synthesised take is the page played back at itself. A mark
 * somebody made while listening is the one piece of ground truth about REAL
 * playing that exists anywhere, and it is sitting in the store unused.
 */
async function saveFixture(r) {
  try {
    const data = await loadRecording(r.id);
    if (!data) { say('that take could not be read back', 'bad'); return; }
    const pages = r.scoreId != null ? await loadScorePages(r.scoreId).catch(() => null) : null;
    const marks = pages?.barAnchors?.[r.id] ?? [];
    const fixture = {
      what: 'practice-partner bar-map fixture',
      // The reading and the analysis both move; a fixture that does not say
      // which app made it is a fixture nobody can interpret in a year.
      made: new Date(r.date ?? Date.now()).toISOString(),
      take: {
        name: r.name ?? null,
        seconds: r.duration ?? null,
        // What the segmenter heard. `cents` rides along because a fixture that
        // can only answer WHERE and never HOW WELL is half a fixture.
        notes: (data.notes ?? []).map((n) => ({
          midi: n.midi, start: n.start, end: n.end,
          cents: Number.isFinite(n.cents) ? Math.round(n.cents * 10) / 10 : null,
        })),
      },
      score: pages ? { name: r.scoreName ?? null, layout: pages.layout ?? null } : null,
      // THE ONLY GROUND TRUTH IN THE FILE. `{ at, time }`: a place in the piece
      // measured in systems, and the second somebody heard it at.
      marks,
    };
    const blob = new Blob([JSON.stringify(fixture)], { type: 'application/json' });
    const name = fileName(`${r.name || 'take'}-fixture`, 'json');
    const how = await shareFile(blob, name);
    if (how === 'cancelled') return;
    // SAID, and it says what is IN it — a fixture with no marks in it can still
    // be read but cannot be scored, and finding that out from the tool an hour
    // later is finding it out too late.
    say(marks.length
      ? `${name} — ${fixture.take.notes.length} notes, ${marks.length} marks by ear`
      : `${name} — ${fixture.take.notes.length} notes, and NO marks: `
        + 'mark a few bars by ear on this take and save it again, or nothing can be scored');
  } catch (err) {
    say(saying('could not save that fixture', err), 'bad');
  }
}

// A filename someone else can make sense of when it lands in their downloads.
function takeFilename(name, when, extension) {
  const stamp = new Date(when).toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const safe = String(name ?? '').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 40);
  return `${safe ? `${safe}-` : ''}${stamp}.${extension}`;
}

function downloadWav(samples, sampleRate, name, when) {
  saveBlob(new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' }),
    takeFilename(name, when, 'wav'));
}

// Send a take to a teacher.
//
// Playing something and having someone hear it is the whole point of a practice
// recording, and until now a take could only leave the app as a file you then
// had to find. The share sheet puts it into Messages or Mail in two taps; where
// there is no share sheet (desktop) it falls back to a download.
async function shareTake(r) {
  const data = await loadRecording(r.id);
  if (!data) return;
  const samples = data.samples ?? new Float32Array(data.audio);
  const rate = data.sampleRate ?? r.sampleRate;
  const filename = takeFilename(r.name, r.date, 'wav');
  const file = new File([encodeWav(samples, rate)], filename, { type: 'audio/wav' });
  const title = r.name || 'Practice take';
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${title} — ${formatDuration(r.duration)}` });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // they changed their mind
    }
  }
  downloadWav(samples, rate, r.name, r.date);
  statusEl.textContent = 'saved as a WAV file';
}

// --- library ---------------------------------------------------------------

const libraryList = document.querySelector('#library-list');
const librarySearch = document.querySelector('#library-search');
let libraryFilter = '';
const libraryEmpty = document.querySelector('#library-empty');
const renameDialog = document.querySelector('#rename-dialog');
const renameInput = document.querySelector('#rename-input');
const renameTitle = document.querySelector('#rename-dialog h2');
let renameId = null;
// A name asked for something that is NOT a rename — the take about to be saved.
// One dialog, two questions: the field, the keyboard and the two buttons are
// the same in both, and a second dialog that looked identical would be a second
// thing to keep in step.
let renameThen = null;

renameDialog.addEventListener('close', async () => {
  const then = renameThen;
  const id = renameId;
  renameThen = null;
  renameId = null;
  const name = renameInput.value.trim();
  if (then) { then(renameDialog.returnValue === 'save' ? name : null); return; }
  if (renameDialog.returnValue !== 'save' || id === null) return;
  await renameRecording(id, name);
  refreshLibrary();
});

/** Ask what to call a take, with something already in the box. */
function askTakeName(current, then) {
  renameId = null;
  renameThen = then;
  if (renameTitle) renameTitle.textContent = 'Name this take';
  renameInput.value = current ?? '';
  renameDialog.showModal();
  // Selected rather than merely present, so the piece's name is one keystroke
  // from being replaced and one press from being kept.
  renameInput.select?.();
}

function formatWhen(date) {
  return new Date(date).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// from: which tab asked. A take opened from a piece's shelf belongs on the
// Score tab — you went looking for it under the music, and the music is what
// you want it read against.
async function openRecording(r, { from = 'library' } = {}) {
  const data = await loadRecording(r.id);
  if (!data) return;
  clearTake();
  // The decoded rate, not the rate it was captured at — compressed takes come
  // back at the codec's own rate. Everything downstream is in seconds, so the
  // note and reading times still line up.
  const rec = new Recorder(data.sampleRate ?? r.sampleRate);
  rec.push(data.samples ?? new Float32Array(data.audio));
  // A TAKE OPENS WHERE ITS REVIEW IS, WHICH IS THE RECORD TAB.
  //
  // It used to jump to the Score tab for anything with a piece attached, from
  // the round that made a take open on its own music. With the audio sync on
  // hold (see BAR_SYNC in ui/score.js) that page has nothing to press, and a
  // take belongs to the library side again: "when you record on a score and open
  // it, it opens in the library tab instead of the score tab, and when you save
  // the take it saves just to the library".
  //
  // The Record tab, not the Library tab, because the Library is a list and the
  // review is not in it — `renderFreeReview` draws into `#report`, which lives
  // there. Landing on the Library would leave somebody looking at the row they
  // just pressed.
  showTab(from === 'score' ? 'score' : 'analyze');
  renderFreeReview(document, data.notes, rec, {
    readings: data.readings, a4: data.a4, recordingId: r.id,
  });
  // A take is marked up against the score IT was played from, not whatever is
  // selected right now: reopening last week's Elgar while the Bach is chosen
  // would otherwise produce a page of confident nonsense — every note wrong,
  // and nothing anywhere saying why. A take with no score attached simply
  // shows no page, and picking one now attaches it.
  selectScore(r.scoreId ?? null)
    .then(() => annotateTake(data.notes, {
      readings: data.readings, a4: data.a4, recordingId: r.id,
    }))
    .catch(() => {});
}

// --- folders ---------------------------------------------------------------
//
// A folder here is a label on a take, not a place a file was moved to: the
// library shows folders first, opening one filters the list to its takes, and
// deleting one only removes the label. Named by piece, it's how a player finds
// "every attempt at the Elgar" without scrolling a month of dates.

let openFolder = null;   // folder id, or null for the top level
let openScore = null;    // score id, when the list is one piece's shelf
let folders = [];
const folderDialog = document.querySelector('#folder-dialog');
const folderInput = document.querySelector('#folder-name');
let folderPending = null; // { mode: 'create' | 'rename', id, then }

folderDialog.addEventListener('close', async () => {
  const pending = folderPending;
  folderPending = null;
  const name = folderInput.value.trim();
  if (folderDialog.returnValue !== 'save' || !name || !pending) return;
  if (pending.mode === 'rename') await renameFolder(pending.id, name);
  else {
    const id = await createFolder(name);
    await pending.then?.(id);
  }
  refreshLibrary();
});

function askFolderName(mode, { id = null, current = '', then = null } = {}) {
  folderPending = { mode, id, then };
  folderInput.value = current;
  document.querySelector('#folder-dialog h2').textContent =
    mode === 'rename' ? 'Rename this folder' : 'Name this folder';
  folderDialog.showModal();
}

function moveMenu(button, r) {
  const rows = folders
    .filter((f) => f.id !== r.folderId)
    .map((f) => ({
      label: f.name,
      onPick: async () => { await setRecordingFolder(r.id, f.id); refreshLibrary(); },
    }));
  rows.push({
    label: '＋ New folder…',
    onPick: () => askFolderName('create', {
      then: (id) => setRecordingFolder(r.id, id),
    }),
  });
  if (r.folderId !== undefined && r.folderId !== null) {
    rows.push({
      label: 'Take out of folder',
      onPick: async () => { await setRecordingFolder(r.id, null); refreshLibrary(); },
    });
  }
  actionMenu(button, rows);
}

function folderRow(folder, count) {
  const li = document.createElement('li');
  li.className = 'lib-item';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const icon = document.createElement('span');
  icon.className = 'lib-folder';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h9A1.5 1.5 0 0 1 21 9.7v8.8A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = folder.name;
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  sub.textContent = `${count} ${count === 1 ? 'take' : 'takes'}`;
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(icon, text, chev);
  open.addEventListener('click', () => { openFolder = folder.id; refreshLibrary(); });

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'lib-more';
  more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-label', `More actions for the folder ${folder.name}`);
  more.addEventListener('click', () => actionMenu(more, [
    {
      label: 'Rename',
      onPick: () => askFolderName('rename', { id: folder.id, current: folder.name }),
    },
    {
      label: 'Delete folder',
      danger: true,
      onPick: async () => {
        await deleteFolder(folder.id);
        if (openFolder === folder.id) openFolder = null;
        statusEl.textContent = 'folder deleted — its takes are back in the library';
        refreshLibrary();
      },
    },
  ]));

  li.append(open, more);
  return li;
}

// One library row: the row itself opens the take, so the name gets the width
// it deserves and the rarer actions sit behind ⋯.
function libraryRow(r, { from = 'library' } = {}) {
  const li = document.createElement('li');
  li.className = 'lib-item';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = r.name || formatWhen(r.date);
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  const piece = r.scoreId != null ? scoreNames.get(r.scoreId) : null;
  sub.textContent = [
    r.name ? formatWhen(r.date) : null,
    formatDuration(r.duration),
    `${r.noteCount} notes`,
    piece ? `from ${piece}` : null,
  ].filter(Boolean).join(' · ');
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(text, chev);
  open.addEventListener('click', () => openRecording(r, { from }));

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'lib-more';
  more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-label', `More actions for ${r.name || formatWhen(r.date)}`);
  more.addEventListener('click', () => actionMenu(more, [
    {
      label: 'Rename',
      onPick: () => {
        renameId = r.id;
        renameThen = null;
        if (renameTitle) renameTitle.textContent = 'Name this recording';
        renameInput.value = r.name ?? '';
        renameDialog.showModal();
      },
    },
    {
      label: 'Share…',
      onPick: () => shareTake(r),
    },
    {
      label: 'Move to folder…',
      onPick: () => moveMenu(more, r),
    },
    {
      label: 'Download WAV',
      onPick: async () => {
        const data = await loadRecording(r.id);
        if (data) {
          downloadWav(data.samples ?? new Float32Array(data.audio),
            data.sampleRate ?? r.sampleRate, r.name ?? r.date, r.date);
        }
      },
    },
    // A TAKE THAT CAN BE MEASURED AGAINST, OFF THE DEVICE IT WAS PLAYED ON.
    //
    // Every number the bar map has ever been judged by comes from
    // `npm run scan:guess`, which SYNTHESISES the take out of the noteheads the
    // reader found — so the take really is that page, and nothing in it has a
    // cello's bottom string, a double stop, an ornament, or a note the reader
    // missed that the synthesiser never knew to drop. There is no corpus of
    // real playing at all, and there cannot be one until a real take leaves a
    // real phone.
    //
    // This is that door. The page as the reader read it, the notes as the
    // segmenter heard them, and — the part that makes it worth anything — the
    // marks somebody made BY EAR, which are ground truth from the only
    // instrument that cannot be wrong about when a bar was sounding.
    //
    // NO AUDIO. The map is computed from notes and not from samples, and a
    // take's samples are megabytes; `Download WAV` is next to this for when the
    // pitch engine itself is the thing being measured, which is a different
    // fixture. Nothing should add audio here for completeness.
    {
      label: 'Save as test fixture',
      onPick: () => saveFixture(r),
    },
    {
      label: 'Delete',
      danger: true,
      onPick: async () => {
        await deleteRecording(r.id);
        refreshLibrary();
      },
    },
  ]));

  li.append(open, more);
  return li;
}

const libraryBack = document.querySelector('#library-back');
const libraryTitle = document.querySelector('#library-title');

libraryBack.addEventListener('click', () => {
  openFolder = null;
  openScore = null;
  refreshLibrary();
});
document.querySelector('#new-folder').addEventListener('click', () => askFolderName('create'));
// The same button on the Scores shelf. One set of folders holds both takes and
// pieces (see the note above `openFolder`), so a folder made here is the folder
// the Library shows too — which is why making one had to be possible from both
// shelves and until now was only possible from one.
document.querySelector('#score-folder')?.addEventListener('click', () => askFolderName('create'));

// Score name by id, so a take can say which piece it was played from without
// each row going to the database for it.
const scoreNames = new Map();

function scoreRow(score, takes) {
  const li = document.createElement('li');
  li.className = 'lib-item';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  // Folders in the list above carry an icon and the same "N takes" subtitle;
  // without one of its own a score row reads as another folder.
  const icon = document.createElement('span');
  icon.className = 'lib-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
    + ' stroke-linecap="round" stroke-linejoin="round"><line x1="3.5" y1="7" x2="20.5" y2="7"/>'
    + '<line x1="3.5" y1="10.5" x2="20.5" y2="10.5"/><line x1="3.5" y1="14" x2="20.5" y2="14"/>'
    + '<circle cx="9" cy="15.6" r="2.1" fill="currentColor" stroke="none"/>'
    + '<path d="M11.1 15.6 V6.2 l4.6 1.3"/></svg>';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = score.name;
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  const paper = score.kind === 'pages';
  sub.textContent = paper
    ? `${score.pageCount ?? '?'} ${score.pageCount === 1 ? 'page' : 'pages'}`
      + (score.source === 'photos' ? ' · scanned' : ' · PDF')
    : takes === 0
      ? 'no takes yet'
      : `${takes} ${takes === 1 ? 'take' : 'takes'}`;
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(icon, text, chev);
  // Into the piece, not straight onto the page: a piece is a shelf with the
  // score on it and every take of it underneath, and both are things you might
  // have come here for. Paper has no takes to shelve, so its row opens it.
  open.addEventListener('click', () => {
    if (score.kind === 'pages') openScoreFromLibrary(score.id);
    else { openScore = score.id; refreshScoreTab(); }
  });

  // The rarer things behind ⋯, exactly as the library's own rows do them.
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'lib-more';
  more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-label', `More actions for ${score.name}`);
  more.addEventListener('click', () => actionMenu(more, scoreActions(score, more)));

  li.append(open, more);
  return li;
}

// --- the score shelf, on the Score tab ---------------------------------------
//
// Pieces at the top; open one and you get the score itself and every take of
// it. This replaces the Scores section that used to sit at the bottom of the
// library: a piece and its attempts belong on the screen you read music on, not
// underneath a list of every take you have ever kept.

const scoreBrowser = document.querySelector('#score-browser');
const scoreList = document.querySelector('#score-list');
const scoreListEmpty = document.querySelector('#score-list-empty');
const scoreBrowserBack = document.querySelector('#score-browser-back');
const scoreSearch = document.querySelector('#score-search');
let scoreFilter = '';
// Setlists: the shelf's other half. A programme is a list of pieces in the
// order they happen, and the shelf shows one thing at a time — pieces, or
// programmes, or the inside of one of either.
let showingSets = false;
// Which folder of PIECES is open, or null for the top of the shelf. The same
// folders the takes use — see setScoreFolder — looked at from the other side.
let openScoreFolder = null;
let openSet = null;      // the setlist being looked at
let sets = [];
const scoreBrowserTitle = document.querySelector('#score-browser-title');

// The row at the top of a piece's shelf: the music itself, apart from the takes
// of it. Reading the part is a different errand from listening back to Tuesday.
function openScoreRow(score) {
  const li = document.createElement('li');
  li.className = 'lib-item';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const icon = document.createElement('span');
  icon.className = 'lib-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
    + ' stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="17" rx="2"/>'
    + '<line x1="7.5" y1="8" x2="16.5" y2="8"/><line x1="7.5" y1="11.5" x2="16.5" y2="11.5"/>'
    + '<line x1="7.5" y1="15" x2="12.5" y2="15"/></svg>';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = 'Open the score';
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  sub.textContent = 'read it full screen';
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(icon, text, chev);
  open.addEventListener('click', () => openScoreFromLibrary(score.id));
  li.append(open);
  return li;
}

// The way back into a review you stepped out of. It disappears the moment the
// take is saved or discarded, because then the ordinary rows lead to it.
function pendingReviewRow() {
  const li = document.createElement('li');
  li.className = 'lib-item';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = 'The take you just played';
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  sub.textContent = lastTake ? 'read against this piece — not kept yet' : 'read against this piece';
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(text, chev);
  open.addEventListener('click', () => showTakeReview());
  li.append(open);
  return li;
}

// --- setlists on the shelf ------------------------------------------------------

function setRow(set) {
  const li = document.createElement('li');
  li.className = 'lib-item';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const icon = document.createElement('span');
  icon.className = 'lib-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"'
    + ' stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/>'
    + '<line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = set.name;
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  const count = (set.items ?? []).filter((id) => scoreNames.has(id)).length;
  sub.textContent = count === 0 ? 'nothing in it yet'
    : `${count} ${count === 1 ? 'piece' : 'pieces'}`;
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(icon, text, chev);
  open.addEventListener('click', () => { openSet = set.id; refreshScoreTab(); });

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'lib-more';
  more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-label', `More actions for ${set.name}`);
  more.addEventListener('click', () => actionMenu(more, [
    {
      label: 'Play through',
      onPick: () => playSet(set, 0),
    },
    {
      label: 'Rename…',
      onPick: async () => {
        const name = await askScoreName(set.name);
        if (!name) return;
        await saveSetlist({ id: set.id, name, items: set.items ?? [] });
        refreshLibrary();
      },
    },
    {
      label: 'Delete',
      danger: true,
      onPick: async () => {
        await deleteSetlist(set.id);
        if (openSet === set.id) openSet = null;
        refreshLibrary();
      },
    },
  ]));

  li.append(open, more);
  return li;
}

// One piece inside a programme: it opens to play, and ⋯ moves it or takes it
// out. The order IS the programme, so moving is the main thing you do here.
function setItemRow(set, scoreId, position) {
  const li = document.createElement('li');
  li.className = 'lib-item';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = scoreNames.get(scoreId) ?? 'a piece that has gone';
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  sub.textContent = `${position + 1} of ${set.items.length}`;
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(text, chev);
  open.addEventListener('click', () => playSet(set, position));

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'lib-more';
  more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-label', `Move or remove ${name.textContent}`);
  const move = async (delta) => {
    const items = [...set.items];
    const to = position + delta;
    if (to < 0 || to >= items.length) return;
    [items[position], items[to]] = [items[to], items[position]];
    await saveSetlist({ id: set.id, name: set.name, items });
    refreshLibrary();
  };
  more.addEventListener('click', () => actionMenu(more, [
    { label: 'Earlier in the programme', onPick: () => move(-1) },
    { label: 'Later in the programme', onPick: () => move(1) },
    {
      label: 'Take it out',
      danger: true,
      onPick: async () => {
        const items = set.items.filter((_, i) => i !== position);
        await saveSetlist({ id: set.id, name: set.name, items });
        refreshLibrary();
      },
    },
  ]));

  li.append(open, more);
  return li;
}

// Opening a piece as part of a programme, so the reader knows what comes next:
// past the last page of one piece is the first page of the next.
async function playSet(set, position) {
  const items = (set.items ?? []).filter((id) => scoreNames.has(id));
  if (!items.length) return;
  const at = Math.max(0, Math.min(items.length - 1, position));
  await openScoreFromLibrary(items[at], {
    // The names travel with the programme, not just the ids: the reader says
    // what is coming as you reach the end of a piece, and it has no way of its
    // own to turn an id into "Sarabande".
    setlist: {
      id: set.id,
      name: set.name,
      items,
      names: items.map((id) => scoreNames.get(id) ?? ''),
      index: at,
    },
  });
}

// Putting a piece into a programme, from the piece rather than from the list —
// which is where you are standing when you decide it belongs in one.
async function addToSet(score) {
  const all = await listSetlists();
  const rows = all.map((set) => ({
    label: (set.items ?? []).includes(score.id) ? `✓ ${set.name}` : set.name,
    onPick: async () => {
      const items = (set.items ?? []).includes(score.id)
        ? set.items.filter((id) => id !== score.id)
        : [...(set.items ?? []), score.id];
      await saveSetlist({ id: set.id, name: set.name, items });
      refreshLibrary();
    },
  }));
  rows.push({
    label: '＋ New setlist…',
    onPick: async () => {
      const name = await askScoreName('');
      if (!name) return;
      await saveSetlist({ name, items: [score.id] });
      refreshLibrary();
    },
  });
  actionMenu(document.querySelector('#score-sets'), rows);
}

// What a piece offers besides opening: the things you reach for once a shelf
// has more than three things on it.
// A folder on the score shelf. The library's own folder row, wearing the count
// that means something here: pieces, not takes.
function scoreFolderRow(folder, count) {
  const li = document.createElement('li');
  li.className = 'lib-item';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lib-open';
  const icon = document.createElement('span');
  icon.className = 'lib-folder';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"'
    + ' stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h9A1.5 1.5 0 0 1 21 9.7v8.8A1.5 1.5 0 0'
    + ' 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
  const text = document.createElement('span');
  text.className = 'lib-text';
  const name = document.createElement('span');
  name.className = 'lib-name';
  name.textContent = folder.name;
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  sub.textContent = `${count} ${count === 1 ? 'piece' : 'pieces'}`;
  text.append(name, sub);
  const chev = document.createElement('span');
  chev.className = 'lib-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
    + ' stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  open.append(icon, text, chev);
  open.addEventListener('click', () => { openScoreFolder = folder.id; refreshScoreTab(); });

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'lib-more';
  more.textContent = '⋯';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-label', `More actions for the folder ${folder.name}`);
  more.addEventListener('click', () => actionMenu(more, [
    {
      label: 'Rename…',
      onPick: () => askFolderName('rename', { id: folder.id, current: folder.name }),
    },
    {
      label: 'Delete folder',
      danger: true,
      onPick: async () => {
        // The folder goes; the music does not. Everything in it comes back to
        // the top of the shelf, which is the only forgiving way to delete a
        // container somebody has filed their part in.
        await deleteFolder(folder.id);
        if (openScoreFolder === folder.id) openScoreFolder = null;
        refreshLibrary();
      },
    },
  ]));
  li.append(open, more);
  return li;
}

// Which folder a piece lives in.
//
// Same folders as the takes use, and deliberately so: "Bach" is one folder
// whether what you are filing in it is the suites or Tuesday's attempt at them.
// Two parallel sets with the same names in both would be a filing system to
// keep in step by hand.
function moveScoreToFolder(button, score) {
  const rows = folders
    .filter((f) => f.id !== score.folderId)
    .map((f) => ({
      label: f.name,
      onPick: async () => { await setScoreFolder(score.id, f.id); refreshLibrary(); },
    }));
  rows.push({
    label: '＋ New folder…',
    onPick: () => askFolderName('create', {
      then: (id) => setScoreFolder(score.id, id),
    }),
  });
  if (score.folderId !== undefined && score.folderId !== null) {
    rows.unshift({
      label: 'Take out of the folder',
      onPick: async () => { await setScoreFolder(score.id, null); refreshLibrary(); },
    });
  }
  actionMenu(button, rows);
}

function scoreActions(score, anchor = null) {
  const rows = [
    { label: 'Open', onPick: () => openScoreFromLibrary(score.id) },
    {
      label: 'Rename\u2026',
      onPick: async () => {
        const name = await askScoreName(score.name);
        if (!name) return;
        await renameScore(score.id, name);
        refreshLibrary();
      },
    },
  ];
  if (score.kind === 'pages') {
    rows.push({ label: 'Pages\u2026', onPick: () => openPageManager(score) });
    rows.push({
      label: 'Straighten the pages',
      onPick: () => straightenScore(score),
    });
    rows.push({
      label: 'Read the pages again',
      onPick: async () => { await measurePages(score.id); refreshLibrary(); },
    });
  }
  rows.push({ label: 'Move to a folder…', onPick: () => moveScoreToFolder(anchor, score) });
  rows.push({ label: 'Add to a setlist…', onPick: () => addToSet(score) });
  rows.push({
    label: 'Delete',
    danger: true,
    onPick: async () => {
      await deleteScore(score.id);
      if (openScore === score.id) openScore = null;
      refreshLibrary();
    },
  });
  return rows;
}

// The pages of a scan, as thumbnails: throw one away, move one earlier or
// later. A camera shoots in the order your hand went, which is usually the
// order of the music and occasionally not.
// Pages that came in before the app knew how to find the paper in a
// photograph: the same job, done again, to the pictures already stored. It says
// what it will do to the marks first, because a scan straightened is a
// differently shaped page and anything written on it moves with the music
// rather than staying under the finger that wrote it.
async function straightenScore(score) {
  const payload = await loadScorePages(score.id);
  if (!payload?.pages?.length) {
    scoreStatus('a PDF is already flat — this is for photographed pages');
    return;
  }
  const { straightenFile } = await import('./ui/straighten.js');
  const done = [];
  for (const [at, file] of payload.pages.entries()) {
    scoreStatus(`straightening page ${at + 1} of ${payload.pages.length}…`);
    done.push(await straightenFile(file));
  }
  await replacePages(score.id, done);
  await measurePages(score.id);
  refreshLibrary();
  scoreStatus(`${score.name} — straightened. Anything written on these pages has moved with the music.`);
}

async function openPageManager(score) {
  const payload = await loadScorePages(score.id);
  if (!payload?.pages?.length) {
    say('a PDF keeps its own page order', 'bad');
    return;
  }
  const dialog = document.querySelector('#pages-dialog');
  const list = document.querySelector('#pages-list');
  if (!dialog || !list) return;
  let order = payload.pages.map((_, i) => i);
  const urls = payload.pages.map((blob) => URL.createObjectURL(blob));

  const draw = () => {
    list.replaceChildren();
    for (const [position, index] of order.entries()) {
      const item = document.createElement('div');
      item.className = 'page-item';
      const image = document.createElement('img');
      image.src = urls[index];
      image.alt = `Page ${position + 1}`;
      const number = document.createElement('span');
      number.className = 'page-number';
      number.textContent = String(position + 1);
      const tools = document.createElement('div');
      tools.className = 'page-tools';
      const move = (delta) => {
        const to = position + delta;
        if (to < 0 || to >= order.length) return;
        [order[position], order[to]] = [order[to], order[position]];
        draw();
      };
      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = '\u2190';
      back.setAttribute('aria-label', `Move page ${position + 1} earlier`);
      back.addEventListener('click', () => move(-1));
      const forward = document.createElement('button');
      forward.type = 'button';
      forward.textContent = '\u2192';
      forward.setAttribute('aria-label', `Move page ${position + 1} later`);
      forward.addEventListener('click', () => move(1));
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'danger';
      drop.textContent = '\u2715';
      drop.setAttribute('aria-label', `Throw away page ${position + 1}`);
      drop.addEventListener('click', () => { order = order.filter((_, i) => i !== position); draw(); });
      tools.append(back, forward, drop);
      item.append(image, number, tools);
      list.append(item);
    }
  };
  draw();

  const done = async () => {
    dialog.removeEventListener('close', done);
    for (const url of urls) URL.revokeObjectURL(url);
    if (dialog.returnValue !== 'save' || !order.length) return;
    await savePageOrder(score.id, order);
    refreshLibrary();
  };
  dialog.addEventListener('close', done);
  dialog.showModal();
}

// THE NOTATION DOORS ARE GONE FROM THE SURFACE, and the machinery is not.
//
// "Get rid of the ad notation stuff." Pairing a photographed part with a
// MusicXML file is the one thing that lets this app say "that was the wrong
// note", and it was offered in four places — the shelf's ⋯ menu, the reader's
// options sheet, a button under the review, and a paragraph explaining why the
// analysis was incomplete. Four offers for something almost nobody has the file
// for, and the paragraph was the worst of them: a block of grey prose about a
// feature, on the screen you land on straight after playing.
//
// `pairWithNotation`, `importNotationFor`, `notationId` and the whole paired
// review path STAY — a score that is already paired still reads that way, and
// `scan:import` still measures it. What went is every way of asking for it.
// `pairFromShelf` lived here.

async function refreshScoreTab() {
  if (!scoreList) return;
  try {
    // The folders too, rather than trusting whatever the library last left in
    // the variable: a folder made from THIS shelf, to put this piece in, does
    // not exist as far as the library is concerned until the library refreshes.
    const [scores, recordings, allFolders] = await Promise.all([
      listScores(), listRecordings(), listFolders(),
    ]);
    folders = allFolders;
    scoreNames.clear();
    for (const score of scores) scoreNames.set(score.id, score.name);
    if (openScore !== null && !scoreNames.has(openScore)) openScore = null;

    const counts = new Map();
    for (const r of recordings) {
      if (r.scoreId != null) counts.set(r.scoreId, (counts.get(r.scoreId) ?? 0) + 1);
    }

    sets = await listSetlists();
    if (openSet !== null && !sets.some((set) => set.id === openSet)) openSet = null;
    const inSet = openSet !== null;
    const set = inSet ? sets.find((s) => s.id === openSet) : null;
    const inScore = openScore !== null;
    if (openScoreFolder !== null && !folders.some((f) => f.id === openScoreFolder)) {
      openScoreFolder = null;   // the folder was deleted from the other shelf
    }
    const inFolder = openScoreFolder !== null && !inScore && !inSet && !showingSets;
    scoreBrowserBack.hidden = !(inScore || inSet || inFolder);
    scoreBrowserTitle.textContent = inSet ? set.name
      : inScore ? scoreNames.get(openScore)
        : showingSets ? 'Setlists'
          : inFolder ? (folders.find((f) => f.id === openScoreFolder)?.name ?? 'Scores')
            : 'Scores';
    const setsButton = document.querySelector('#score-sets');
    if (setsButton) {
      setsButton.hidden = inScore || inSet || inFolder;
      setsButton.textContent = showingSets ? 'Scores' : 'Setlists';
    }

    scoreList.replaceChildren();
    // "THE TAKE YOU JUST PLAYED" IS NOT ON THE SHELF ANY MORE.
    //
    // It was a row for a take that had not been saved yet, on the theory that
    // nothing else in this list could lead back to it. "when you save the take
    // it saves just to the library and doesnt say the take you just played in
    // the score section" — a take belongs to the library, and the shelf is a
    // shelf of pieces. `pendingReviewRow` and `reviewIsWaiting` are kept for the
    // day the score review is a place a take lives again; see BAR_SYNC.
    void pendingReviewRow;
    if (inSet) {
      const items = (set.items ?? []).filter((id) => scoreNames.has(id));
      for (const [position, id] of items.entries()) {
        scoreList.append(setItemRow({ ...set, items }, id, position));
      }
    } else if (showingSets) {
      for (const one of sets) scoreList.append(setRow(one));
    } else if (inScore) {
      scoreList.append(openScoreRow({ id: openScore, name: scoreNames.get(openScore) }));
      for (const r of recordings.filter((t) => t.scoreId === openScore)) {
        scoreList.append(libraryRow(r, { from: 'score' }));
      }
    } else {
      const needle = scoreFilter.trim().toLowerCase();
      // Searching looks through the whole shelf, folders and all. Being made to
      // remember which folder you filed a piece in before you may look for it
      // is the thing a search box exists to spare you.
      const matches = needle
        ? scores.filter((score) => score.name.toLowerCase().includes(needle))
        : scores;
      if (needle) {
        for (const score of matches) scoreList.append(scoreRow(score, counts.get(score.id) ?? 0));
      } else {
        const here = (score) => (openScoreFolder === null
          ? score.folderId === undefined || score.folderId === null
          : score.folderId === openScoreFolder);
        if (openScoreFolder === null) {
          const inside = new Map();
          for (const score of scores) {
            if (score.folderId === undefined || score.folderId === null) continue;
            inside.set(score.folderId, (inside.get(score.folderId) ?? 0) + 1);
          }
          // Only folders with music in them. The same folders hold takes, and a
          // shelf of pieces listing every folder you ever made for a recording
          // is a shelf of empty rooms.
          for (const folder of folders) {
            if (!inside.has(folder.id)) continue;
            scoreList.append(scoreFolderRow(folder, inside.get(folder.id)));
          }
        }
        for (const score of matches.filter(here)) {
          scoreList.append(scoreRow(score, counts.get(score.id) ?? 0));
        }
      }
    }
    // Hidden only where searching means nothing: inside one piece, inside a
    // setlist, or on the list of setlists. It used to also require six pieces
    // on the shelf, which made it a box you had to earn — and the shelf you
    // are looking at is not the one you learn the app on.
    if (scoreSearch) scoreSearch.hidden = inScore || inSet || showingSets;
    const folderBtn = document.querySelector('#score-folder');
    if (folderBtn) folderBtn.hidden = inScore || inSet || inFolder || showingSets;
    scoreListEmpty.style.display = scoreList.children.length ? 'none' : 'block';
    scoreListEmpty.textContent = showingSets && !inSet
      ? 'No setlists yet. A setlist is the pieces of a recital or a lesson in the order'
        + ' they happen — make one from ⋯ on any piece.'
      : inSet
        ? 'Nothing in this programme yet — add pieces from ⋯ on the Scores list.'
        : scoreFilter && !inScore
          ? `Nothing here called “${scoreFilter}”.`
          : inScore
      ? 'No takes of this one yet — record, and keep it from the bottom of this tab.'
      : 'No scores yet. Load a MusicXML or .mxl part — export one from MuseScore, or'
        + ' download it from IMSLP — and it will open here to play from.';
  } catch { /* blocked IndexedDB — the shelf stays empty */ }
}

// Three ways in, because music arrives in three forms: as notation, as a PDF
// somebody printed or downloaded, and as the photograph of a page you took
// because that is what was on the stand.
document.querySelector('#score-load')?.addEventListener('click', (e) => {
  actionMenu(e.currentTarget, [
    { label: 'Scan', onPick: () => scanPages() },
    { label: 'PDF', onPick: () => document.querySelector('#score-pdf')?.click() },
    // Photographs, MusicXML and a PDF you would rather find yourself, all
    // through one picker — see the input in index.html for why the separate
    // "Photograph (full size)" row went and what happens to the camera.
    { label: 'Choose file', onPick: () => document.querySelector('#score-file')?.click() },
  ]);
});

scoreSearch?.addEventListener('input', () => { scoreFilter = scoreSearch.value; refreshScoreTab(); });
scoreBrowserBack?.addEventListener('click', () => {
  // Out of the innermost thing you are inside, one layer at a time: a piece
  // opened from inside a folder goes back to the folder, not to the top.
  if (openSet !== null) openSet = null;
  else if (openScore !== null) openScore = null;
  else openScoreFolder = null;
  refreshScoreTab();
});
document.querySelector('#score-sets')?.addEventListener('click', () => {
  showingSets = !showingSets;
  openScore = null;
  openScoreFolder = null;
  refreshScoreTab();
});
// Stepping out of a review puts the shelf back up, and the shelf has to be
// redrawn to carry the way back IN — the take being reviewed is not in the
// database yet, so nothing else in the list leads to it. (score.js owns the
// button; this is the list's half of the same press.)
document.querySelector('#score-review-back')?.addEventListener('click', () => refreshScoreTab());

async function refreshLibrary() {
  try {
    const [recordings, allFolders, scores] = await Promise.all([
      listRecordings(), listFolders(), listScores(),
    ]);
    // Names first: the take rows below say which piece they came from.
    scoreNames.clear();
    for (const score of scores) scoreNames.set(score.id, score.name);
    folders = allFolders;
    // A folder deleted in another tab shouldn't leave this one inside it.
    if (openFolder !== null && !folders.some((f) => f.id === openFolder)) openFolder = null;

    const inFolder = openFolder !== null;
    libraryBack.hidden = !inFolder;
    libraryTitle.textContent = inFolder
      ? folders.find((f) => f.id === openFolder)?.name ?? 'Folder'
      : 'Library';

    // SEARCHING LOOKS THROUGH THE WHOLE LIBRARY, folders and all — the same
    // rule the score shelf uses, and for the same reason: being made to
    // remember which folder you filed a take in before you may look for it is
    // the thing a search box exists to spare you. A take is found by its own
    // name, by the piece it was played from, or by its date as it is written on
    // the row, because those are the three things on screen to read.
    const needle = libraryFilter.trim().toLowerCase();
    const says = (r) => [
      r.name ?? '',
      r.scoreId != null ? (scoreNames.get(r.scoreId) ?? '') : '',
      formatWhen(r.date),
    ].join(' ').toLowerCase().includes(needle);
    const shown = needle
      ? recordings.filter(says)
      : inFolder
        ? recordings.filter((r) => r.folderId === openFolder)
        : recordings.filter((r) => r.folderId === undefined || r.folderId === null);

    libraryList.replaceChildren();
    if (!inFolder && !needle) {
      const counts = new Map();
      for (const r of recordings) {
        if (r.folderId != null) counts.set(r.folderId, (counts.get(r.folderId) ?? 0) + 1);
      }
      for (const f of folders) libraryList.append(folderRow(f, counts.get(f.id) ?? 0));
    }
    for (const r of shown) libraryList.append(libraryRow(r));

    libraryEmpty.style.display = libraryList.children.length ? 'none' : 'block';
    libraryEmpty.textContent = needle
      ? `Nothing here called “${libraryFilter.trim()}”.`
      : inFolder
        ? 'Nothing in this folder yet — move a take in from ⋯'
        : 'Nothing here yet — record a take and save it 🎶';
    await refreshScoreTab(); // the same takes, shelved by piece
  } catch { /* blocked IndexedDB — library stays empty */ }
}
librarySearch?.addEventListener('input', () => {
  libraryFilter = librarySearch.value;
  refreshLibrary();
});
refreshLibrary();

// --- metronome -------------------------------------------------------------

const bpmDisplay = document.querySelector('#bpm-display');
const tempoNameEl = document.querySelector('#tempo-name');
const bpmSlider = document.querySelector('#bpm-slider');
const beatsSelect = document.querySelector('#beats-per-bar');
const beatDots = document.querySelector('#beat-dots');
const metroToggle = document.querySelector('#metro-toggle');

const metronome = new Metronome((beat) => {
  beatDots.querySelectorAll('.beat-dot').forEach((dot, i) => {
    dot.classList.toggle('on', i === beat);
  });
});

function setBpm(bpm) {
  metronome.bpm = Math.max(20, Math.min(260, Math.round(bpm)));
  bpmDisplay.textContent = String(metronome.bpm);
  tempoNameEl.textContent = tempoName(metronome.bpm);
  bpmSlider.value = String(metronome.bpm);
  refreshRangeFill(bpmSlider); // tap tempo and the trainer move it from code
  localStorage.setItem('bpm', String(metronome.bpm));
}

function rebuildBeatDots() {
  beatDots.replaceChildren();
  for (let i = 0; i < metronome.beatsPerBar; i++) {
    const dot = document.createElement('div');
    dot.className = i === 0 ? 'beat-dot downbeat' : 'beat-dot';
    beatDots.append(dot);
  }
}

bpmSlider.addEventListener('input', () => setBpm(Number(bpmSlider.value)));
document.querySelector('#bpm-down').addEventListener('click', () => setBpm(metronome.bpm - 2));
document.querySelector('#bpm-up').addEventListener('click', () => setBpm(metronome.bpm + 2));

beatsSelect.addEventListener('change', () => {
  metronome.beatsPerBar = Number(beatsSelect.value);
  localStorage.setItem('beatsPerBar', beatsSelect.value);
  rebuildBeatDots();
});

const taps = [];
document.querySelector('#tap-tempo').addEventListener('click', () => {
  const now = performance.now();
  if (taps.length && now - taps.at(-1) > 3000) taps.length = 0;
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length >= 2) {
    const intervals = taps.slice(1).map((t, i) => t - taps[i]);
    setBpm(60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length));
  }
});

// subdivisions, downbeat accent, practice timer (iMusic-School-style)
const subdivisionSel = document.querySelector('#subdivision');
subdivisionSel.addEventListener('change', () => {
  metronome.subdivision = subdivisionSel.value;
  localStorage.setItem('subdivision', subdivisionSel.value);
});
subdivisionSel.value = localStorage.getItem('subdivision') ?? 'quarter';
metronome.subdivision = subdivisionSel.value;

// Hearing the click pitch you just chose. The slider itself is in the settings
// sheet and settings.js owns its value; only the preview is here, because it has
// to know whether the metronome is already running and this is where that
// instance lives. A preview over a running click is just a click out of time,
// and the next beat already carries the new pitch anyway.
//
// On 'change' rather than 'input': dragging fires input continuously and would
// machine-gun a click per semitone. scheduleClick re-reads the stored value, so
// by the time this runs the slider has already saved it.
document.querySelector('#set-click-pitch')?.addEventListener('change', () => {
  if (metronome.running) return;
  try {
    const ctx = holdAudio('click-preview');
    scheduleClick(ctx, ctx.currentTime + 0.03, 'beat');
    setTimeout(() => releaseAudio('click-preview'), 300);
  } catch { /* no audio yet; the choice is still saved */ }
});

const accentBtn = document.querySelector('#accent-toggle');
accentBtn.addEventListener('click', () => {
  metronome.accentFirst = !metronome.accentFirst;
  accentBtn.classList.toggle('active', metronome.accentFirst);
});

const timerSel = document.querySelector('#timer-mins');
const timerDisplay = document.querySelector('#timer-display');
let timerInterval = null;
let timerEnd = 0;

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerDisplay.textContent = '';
}

function startTimer(minutes) {
  timerEnd = Date.now() + minutes * 60000;
  const tick = () => {
    const left = Math.max(0, timerEnd - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    timerDisplay.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (left === 0) stopMetronome();
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

function stopMetronome() {
  metronome.stop();
  metroToggle.textContent = 'Start';
  beatDots.querySelectorAll('.beat-dot').forEach((d) => d.classList.remove('on'));
  stopTimer();
}

metroToggle.addEventListener('click', () => {
  if (metronome.running) {
    stopMetronome();
  } else {
    metronome.start();
    metroToggle.textContent = 'Stop';
    const minutes = Number(timerSel.value);
    if (minutes > 0) startTimer(minutes);
  }
});

// Backgrounding stops the metronome rather than letting it fall apart.
//
// The scheduler tops up a 120 ms lookahead from a 25 ms setInterval, and a
// backgrounded web view throttles timers to seconds — so the click doesn't keep
// time in the background, it drifts and then stalls. Scheduling far enough
// ahead to survive that would mean minutes of clicks committed to the audio
// clock, which then can't respond to the tempo slider. Stopping is the honest
// behaviour, and it also means the app never sits on the lock screen ticking.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && metronome.running) {
    stopMetronome();
    statusEl.textContent = 'metronome stopped when the app went to the background';
  }
});

setBpm(Number(localStorage.getItem('bpm') ?? 80));
beatsSelect.value = localStorage.getItem('beatsPerBar') ?? '4';
metronome.beatsPerBar = Number(beatsSelect.value);
rebuildBeatDots();


// --- live spectrum (hand-rolled FFT) -----------------------------------------

const spectrumRing = new RingBuffer(2048);
const spectrumCanvas = document.querySelector('#spectrum');
let spectrumFrame = 0;

function drawSpectrum() {
  const dpr = window.devicePixelRatio || 1;
  const w = spectrumCanvas.clientWidth;
  const h = spectrumCanvas.clientHeight;
  if (spectrumCanvas.width !== w * dpr) {
    spectrumCanvas.width = w * dpr;
    spectrumCanvas.height = h * dpr;
  }
  const ctx = spectrumCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (vizMode === 'wave') {
    const wave = spectrumRing.latest(1024);
    ctx.strokeStyle = '#6d4ef6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = (i / wave.length) * w;
      const y = h / 2 - wave[i] * (h / 2 - 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    spectrumFrame = requestAnimationFrame(drawSpectrum);
    return;
  }

  const windowed = spectrumRing.latest(2048);
  for (let i = 0; i < windowed.length; i++) {
    windowed[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowed.length - 1)));
  }
  const mags = fftMagnitudes(windowed);
  const sr = capture?.sampleRate ?? 44100;
  const maxBin = Math.min(mags.length - 1, Math.ceil(2200 / (sr / 2048)));
  const bars = 56;
  const barW = w / bars;
  ctx.fillStyle = '#6d4ef6';
  for (let b = 0; b < bars; b++) {
    const bin = 1 + Math.floor((b / bars) * maxBin);
    const mag = Math.min(1, mags[bin] * 14);
    const barH = Math.max(1, mag * (h - 2));
    ctx.globalAlpha = 0.25 + 0.75 * mag;
    ctx.fillRect(b * barW + 1, h - barH, barW - 2, barH);
  }
  ctx.globalAlpha = 1;
  spectrumFrame = requestAnimationFrame(drawSpectrum);
}

function startSpectrum() {
  cancelAnimationFrame(spectrumFrame);
  spectrumFrame = requestAnimationFrame(drawSpectrum);
}

function stopSpectrum() {
  cancelAnimationFrame(spectrumFrame);
  spectrumCanvas?.getContext('2d').clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
}

// --- metronome tempo trainer wiring ------------------------------------------

const trainerStepSel = document.querySelector('#trainer-step');
const trainerBarsSel = document.querySelector('#trainer-bars');
function applyTrainer() {
  metronome.trainerStep = Number(trainerStepSel.value);
  metronome.trainerBars = Number(trainerBarsSel.value);
  localStorage.setItem('trainer', JSON.stringify([trainerStepSel.value, trainerBarsSel.value]));
}
trainerStepSel.addEventListener('change', applyTrainer);
trainerBarsSel.addEventListener('change', applyTrainer);
try {
  const savedTrainer = JSON.parse(localStorage.getItem('trainer'));
  if (savedTrainer) [trainerStepSel.value, trainerBarsSel.value] = savedTrainer;
} catch { /* fresh install */ }
applyTrainer();
metronome.onTempo = (bpm) => setBpm(bpm);


// --- spectrum / waveform toggle ----------------------------------------------

let vizMode = localStorage.getItem('vizMode') ?? 'spectrum';
for (const btn of document.querySelectorAll('#viz-toggle button')) {
  btn.classList.toggle('active', btn.dataset.viz === vizMode);
  btn.addEventListener('click', () => {
    vizMode = btn.dataset.viz;
    localStorage.setItem('vizMode', vizMode);
    for (const b of document.querySelectorAll('#viz-toggle button')) {
      b.classList.toggle('active', b === btn);
    }
  });
}

// --- presets: named snapshots of every setting --------------------------------

// What a named setup is made of. The levels and the in-tune tolerance belong
// here — they're part of "how I have this set for the cello" — while the
// microphone, screen and timing-pulse preferences are about the device and the
// take in front of you, not the instrument, so they stay out.
const PRESET_KEYS = ['a4', 'volume', 'droneLevel', 'clickLevel', 'tolerance',
  'tunerSettings', 'timbre', 'bpm', 'beatsPerBar', 'subdivision', 'trainer', 'vizMode'];
const presetSel = document.querySelector('#preset-list');

function refreshPresets() {
  const presets = JSON.parse(localStorage.getItem('presets') ?? '{}');
  presetSel.replaceChildren(new Option('presets…', ''));
  for (const name of Object.keys(presets)) presetSel.append(new Option(name, name));
}

const presetDialog = document.querySelector('#preset-dialog');
const presetName = document.querySelector('#preset-name');

document.querySelector('#preset-save').addEventListener('click', () => {
  presetName.value = '';
  presetDialog.showModal();
});

presetDialog.addEventListener('close', () => {
  const name = presetName.value.trim();
  if (presetDialog.returnValue !== 'save' || !name) return;
  const presets = JSON.parse(localStorage.getItem('presets') ?? '{}');
  presets[name] = Object.fromEntries(
    PRESET_KEYS.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null));
  localStorage.setItem('presets', JSON.stringify(presets));
  refreshPresets();
  presetSel.value = name;
  presetSel.dispatchEvent(new Event('refresh-label'));
});

presetSel.addEventListener('change', () => {
  if (!presetSel.value) return;
  const presets = JSON.parse(localStorage.getItem('presets') ?? '{}');
  const preset = presets[presetSel.value];
  if (!preset) return;
  for (const [k, v] of Object.entries(preset)) localStorage.setItem(k, v);
  location.reload(); // simplest way to apply every setting consistently
});
refreshPresets();

// --- free drone: any note, layered over whatever else is sounding --------------

// One button: tapping it opens the note grid, and tapping notes there stacks
// them up as drones. Any number can sound at once, so a chord to play against
// is a few taps rather than a control each.
const anyDroneBtn = document.querySelector('#any-drone');
const FREE = 'free-'; // key prefix, so these voices are told apart from the pipe's

const freeDroneNames = () =>
  [...activeDroneNotes()].filter((k) => k.startsWith(FREE)).map((k) => k.slice(FREE.length));

function refreshDroneButton() {
  const on = freeDroneNames();
  anyDroneBtn.textContent = on.length ? `Drone · ${on.join(' ')}` : 'Drone';
  anyDroneBtn.classList.toggle('active', on.length > 0);
}

function freeDroneFrequency(name) {
  return currentA4() * 2 ** ((nameToMidi(name) - 69) / 12);
}

anyDroneBtn.addEventListener('click', () => {
  const sounding = new Set(freeDroneNames());
  const rows = [];
  for (let oct = 2; oct <= 5; oct++) {
    for (const name of PIPE_NOTES) {
      const full = `${name}${oct}`;
      rows.push({
        label: full,
        on: sounding.has(full),
        onPick: () => {
          const nowOn = toggleDroneNote(FREE + full, freeDroneFrequency(full));
          if (nowOn) {
            sounding.add(full);
            localStorage.setItem('anyDrone', full); // remembered as the default
          } else {
            sounding.delete(full);
          }
          refreshDroneButton();
        },
      });
    }
  }
  toggleMenu(anyDroneBtn, () => rows.map((r) => ({ ...r, on: sounding.has(r.label) })), { columns: true });
});
refreshDroneButton();

// --- first run -----------------------------------------------------------------

initWelcome(document, {
  onDone: (chosen) => {
    timbreSel.value = chosen.timbre;
    setDroneTimbre(chosen.timbre);
    localStorage.setItem('timbre', chosen.timbre);
    timbreSel.dispatchEvent(new Event('refresh-label'));
  },
});

// --- the score you played from -------------------------------------------------

initScoreCard({
  onPickNote: (note) => selectPlayedNote(note),
  onOpenScoreTab: () => showTab('score'),
  onScoreChanged: () => { refreshSaveLabel(); refreshLibrary(); },
});

// --- custom pickers replace every native select --------------------------------

initControls(document);

// --- the text size the reader already asked the device for ---------------------

followTextSize();
// Resolved now, at a moment nobody is waiting on anything, so the first mark of
// a session is not the one that pays for finding the native side.
readyHaptics();

// --- installable app: register the service worker -----------------------------

// --- teaching the pedal -------------------------------------------------------
//
// Press it, and whatever it sent is that pedal from now on. There is nothing to
// look up, nothing to configure, and no list of supported hardware — the pedal
// says what it says and the app writes it down.

function refreshPedalReport() {
  const report = document.querySelector('#set-pedal-report');
  if (!report) return;
  const { forward, back } = taught();
  report.textContent = forward || back
    ? `Next page: ${pressName(forward)}. Page before: ${pressName(back)}.`
      + ' The built-in keys still work as well.'
    : 'Built-in keys: arrows, page up and page down, space and return.';
  report.dataset.tone = '';
}

function learnPedal(direction, button) {
  const report = document.querySelector('#set-pedal-report');
  const was = button.textContent;
  button.textContent = 'Press it now…';
  if (report) {
    report.textContent = direction === 'forward'
      ? 'Press the pedal you want to turn FORWARD with.'
      : 'Press the pedal you want to go BACK with.';
  }
  const listen = (e) => {
    // Escape is how you change your mind, so it can never be a pedal.
    if (e.key !== 'Escape') {
      e.preventDefault();
      teach(direction, pressOf(e));
    }
    stop();
  };
  const stop = () => {
    document.removeEventListener('keydown', listen, true);
    button.textContent = was;
    refreshPedalReport();
  };
  document.addEventListener('keydown', listen, true);
}

document.querySelector('#set-pedal-forward')?.addEventListener('click', (e) => learnPedal('forward', e.currentTarget));
document.querySelector('#set-pedal-back')?.addEventListener('click', (e) => learnPedal('back', e.currentTarget));
document.querySelector('#set-pedal-forget')?.addEventListener('click', () => {
  forgetPedal();
  refreshPedalReport();
});
refreshPedalReport();

// --- what this device will actually do with a microphone ----------------------
//
// One tap, and the app says what it found instead of somebody guessing from the
// other end of a message. It matters most on the device where nothing works:
// the same app on the same account can be fine on a phone and dead on an iPad,
// and the difference is never in the code — it is the permission, the iOS
// version, or a home-screen app the system will not give a microphone to.

function appSetting() {
  const os = navigator.userAgent.match(/OS (\d+)[._](\d+)/);
  return [
    installedApp() ? 'Added to the home screen' : 'Running in the browser',
    os ? `iOS/iPadOS ${os[1]}.${os[2]}` : null,
    globalThis.isSecureContext ? null : 'the page is not secure, which alone stops the microphone',
  ].filter(Boolean).join(' · ');
}

// Two seconds of the app's OWN capture — the same constraints, the same audio
// worklet, the same context — and what came out of it.
async function listenThrough() {
  let chunks = 0;
  let peak = 0;
  let session = null;
  try {
    session = await startCapture((block) => {
      chunks++;
      for (let i = 0; i < block.length; i++) {
        const level = Math.abs(block[i]);
        if (level > peak) peak = level;
      }
    });
    await new Promise((resolve) => { setTimeout(resolve, 2000); });
  } catch (err) {
    return { chunks: 0, peak: 0, error: err.message };
  } finally {
    session?.stop();
  }
  return { chunks, peak };
}

async function checkMicrophone() {
  const report = document.querySelector('#set-mic-report');
  const button = document.querySelector('#set-mic-check');
  if (!report) return;
  const say = (line, bad = false) => {
    report.textContent = `${appSetting()}. ${line}`;
    report.dataset.tone = bad ? 'bad' : '';
  };
  if (!navigator.mediaDevices?.getUserMedia) {
    say('This device offers the app no microphone at all — open the site in Safari itself'
      + ' and record there, which does work on older iPads.', true);
    return;
  }
  button.disabled = true;
  say('Asking…');
  let timer = null;
  try {
    const stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('no answer')), 10000);
      }),
    ]);
    stream.getTracks().forEach((t) => t.stop());
    // Opening it is not the same as HEARING anything through it, and the
    // difference is the whole of "the check says it works but the tuner
    // doesn't": a microphone can be granted, live and completely silent. So the
    // check goes the rest of the way — the same capture the tuner uses, for two
    // seconds, reporting what actually arrived.
    say('The microphone opened. Listening through it…');
    const heard = await listenThrough();
    if (heard.chunks === 0) {
      say('The microphone opens but no sound arrives through it — which is a fault in this app'
        + ' on this device, not a setting on the iPad. Send this line on.', true);
    } else if (heard.peak < 0.002) {
      say(`Sound is arriving (${heard.chunks} blocks) but it is silent — the microphone is`
        + ' open and hearing nothing. Check nothing is covering it, and that no other app has it.', true);
    } else {
      say(`Working: ${heard.chunks} blocks heard, peak ${heard.peak.toFixed(3)}.`
        + ' The tuner and recording should work here.');
    }
  } catch (err) {
    if (err.message === 'no answer') {
      say('No answer after ten seconds — the permission prompt never appeared. That is the system'
        + ' refusing silently: '
        + (installedApp()
          // Said differently to an app that is not Safari, because Settings →
          // Safari is not the switch holding it shut and the ten minutes spent
          // there are ten minutes not spent finding the one that is.
          ? 'and since this is the app added to the home screen rather than Safari, the Safari'
            + ' settings are not what is holding it shut. Open the same address in Safari itself'
            + ' and try recording there: if that works, it is this installed copy that has been'
            + ' refused, and re-adding it to the home screen asks again from scratch.'
          : 'check Settings → Safari → Microphone, and Screen Time → Content &'
            + ' Privacy Restrictions → Microphone if that is switched on.'), true);
    } else {
      say(`Refused: ${err.name} — ${err.message}`, true);
    }
  } finally {
    clearTimeout(timer);
    button.disabled = false;
  }
}

document.querySelector('#set-mic-check')?.addEventListener('click', checkMicrophone);
initPenCheck();

// Which build this is, said out loud in Settings.
//
// Installed from Safari's "Add to Home Screen" there is no address bar, no
// reload button and no console: the app holds the page it loaded for days at a
// time, and iOS resumes it from a snapshot rather than starting it again. So
// "it still does nothing" and "it is still running last week's code" look
// identical from the outside, and one of them is not a bug. Now it can be read
// off the screen.
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
const buildLine = document.querySelector('#set-build');
if (buildLine) buildLine.textContent = `Build ${BUILD}`;

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Registered under the build, so every deploy is a DIFFERENT worker script.
  // Registering the same URL forever meant a home-screen app had nothing to
  // notice: the worker it installed on the day it was added is the worker it
  // keeps, and the page it loaded is the page it keeps with it.
  navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(BUILD)}`).then((registration) => {
    // A standalone app is resumed, not reloaded. Coming back to it is the
    // moment to ask whether there is a newer one.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  }).catch(() => {});

  // A new worker has taken over, which means there is a newer app than the one
  // on screen. Take it — once, and never in a loop. The FIRST worker to claim
  // an uncontrolled page is not news: nothing has changed underneath it, and
  // reloading there would make every first visit flicker.
  const wasControlled = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled || reloading) return;
    reloading = true;
    location.reload();
  });
}
