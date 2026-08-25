import { audioContext, masterOut, holdAudio, releaseAudio, warmAudio } from '../audio/context.js';
import { saying } from './why.js';
import { buildEmphasizedClip, findComparisonNote, findSameNotes } from '../audio/clips.js';
import { timeStretch } from '../audio/stretch.js';
import { renderOverviewChart, renderNoteChart } from './pitch-chart.js';
import { intonationStatus, intonationHue, findNoteAt } from './chart-utils.js';
import { midiToName } from '../analysis/note-utils.js';
import { toggleMenu } from './controls.js';
import { renderLanding, hideLanding } from './landing.js';
import { initPassages, hidePassages, offerNote } from './passages.js';
import { scheduleClick } from '../audio/metronome.js';
import { rhythmReport } from '../analysis/rhythm.js';
import { stopWrittenPitch, whenWrittenPitchStarts } from '../audio/written-pitch.js';

// The one status line the app has, shared with the recorder above.
function say(root, message) {
  const el = (root ?? document).querySelector('#status');
  if (el) el.textContent = message;
}

const CONTEXT_SEC = 1.2;
let zoomContextSec = CONTEXT_SEC; // pinch on the zoom chart adjusts this

let playbackCtx = null;
let currentSource = null;
let playbackSpeed = 1;
let currentChart = null;    // the overview chart
let chartWatch = null;      // the ResizeObserver on #chart-scroll, if any
let zoomChart = null;       // the per-note inset below it
// The open report's own selectNote, so views outside this module — the score
// page, most obviously — can hand a note back and get the zoom inset, the
// drones and the playback that tapping a tile already gives, rather than
// growing a second, poorer copy of all of it.
let selectFromOutside = null;

// Views outside this module that want to follow the playhead — the score page,
// which lights the notehead being sounded and scrolls to keep it in view.
//
// A span carries one tile, and widening it to carry two would mean every
// producer of spans knowing about every view. A subscription costs nothing and
// keeps the arrangement one-way: the score knows about playback, playback knows
// nothing about the score.
const followers = new Set();

export function followPlayback(fn) {
  followers.add(fn);
  return () => followers.delete(fn);
}

function tellFollowers(note, time) {
  for (const fn of followers) {
    try { fn(note, time); } catch { /* a broken view must not stop the audio */ }
  }
}

/**
 * Play the take from a moment of it, from outside this file.
 *
 * The whole-take player, its playhead, its latency correction and its followers
 * already exist here and are wound round module state; a second player for the
 * scanned page would be a second one of all of that, drifting from this one.
 * So the page asks, and this answers — the one direction that keeps the
 * arrangement the way `followPlayback` set it up: the score knows about
 * playback, playback knows nothing about the score.
 *
 * @param {number} seconds into the recording
 * @returns {boolean} false when there is no take loaded to play
 */
export function playTakeFrom(seconds) {
  if (!full?.root || !full.recording) return false;
  const at = Math.max(0, Math.min(Number(seconds) || 0, full.recording.duration));
  // …AND THE CLOSE-UP UNDER THE GRAPH GOES THERE TOO.
  //
  // "if I click anywhere on the graph, or even if I click a bar, it should show
  // the zoomed-in graph below, and they should all be in sync." Pressing a bar
  // used to move the whole-take playhead and nothing else: the cents-level
  // inset kept showing whatever note was last chosen, or nothing at all, which
  // on a page you have just pressed is the panel answering a question you did
  // not ask. Tapping the graph has always opened it (see overviewSeek); a bar
  // is the same gesture made on the music instead of on the trace.
  selectAtMoment?.(at);
  playFullFrom(full.root, at);
  return true;
}

/** How long the take on screen is, or null when there is not one. */
export function takeLength() {
  return full?.recording?.duration ?? null;
}

/**
 * IS THE TAKE SOUNDING — asked properly, rather than read off a button's face.
 *
 * The reader used to answer this by comparing `#clip-play`'s textContent with
 * '▶', which is a second idea of the same fact kept in a glyph: change the
 * character and the reader silently believes a stopped take is running. There
 * is one player in this file and it knows.
 */
export function takeIsPlaying() {
  return !!(full?.playing || zoom?.playing);
}

/**
 * Play or pause the take from anywhere — the reader's button, the graph's, a
 * keyboard. Whichever of the two players is loaded is the one it works.
 *
 * @returns {boolean} false when there is nothing loaded to play
 */
export function toggleTakePlayback() {
  // `full.root` is the element the review was rendered into; the zoom player
  // has no root of its own and has always been driven against the document.
  const root = full?.root ?? document;
  if (full?.playing) { pauseFull(root); return true; }
  if (zoom?.playing) { pauseZoom(root); return true; }
  if (zoom) { playZoomFrom(root, zoom.pos); return true; }
  if (full) { playFullFrom(root, full.pos); return true; }
  return false;
}

// Set by whichever note is open, read by the playback tick: what to write in
// the note box for a given moment of the recording.
let cursorReadout = null;

// Open the close-up on whatever was played at a given second. Set by
// renderReport, which is where the take's notes and the note-selecting closure
// both live; called by playTakeFrom, so a press on a bar of the music and a tap
// on the graph land on the same panel.
let selectAtMoment = null;

function setPlayheads(t) {
  currentChart?.setPlayhead(t);
  zoomChart?.setPlayhead(t);
}
let animationFrame = 0;

let noteDrone = null; // { osc, gain, btn, tile } — synthesized at the pitch the player produced
let refDrone = null;  // { osc, gain, btn } — synthesized at the correct pitch

function makeOsc(frequency, level) {
  playbackCtx = audioContext();
  const real = new Float32Array(9);
  const imag = new Float32Array(9);
  for (let h = 1; h <= 8; h++) imag[h] = 1 / h ** 1.5;
  const osc = playbackCtx.createOscillator();
  osc.setPeriodicWave(playbackCtx.createPeriodicWave(real, imag));
  osc.frequency.value = frequency;
  const gain = playbackCtx.createGain();
  gain.gain.setValueAtTime(0, playbackCtx.currentTime);
  gain.gain.linearRampToValueAtTime(level, playbackCtx.currentTime + 0.1);
  osc.connect(gain).connect(masterOut());
  osc.start();
  return { osc, gain };
}

function fadeOutOsc({ osc, gain }) {
  gain.gain.setTargetAtTime(0, playbackCtx.currentTime, 0.04);
  setTimeout(() => osc.stop(), 250);
  // let the fade finish before the context is allowed to sleep under it
  setTimeout(reviewVoicesChanged, 300);
}

// The review screen can have several voices going at once — a held note, a
// reference pitch, any number of comparison drones. The audio session is held
// while ANY of them sound, so it is recounted rather than toggled.
function reviewVoicesChanged() {
  if (noteDrone || refDrone || compareDrones.size) holdAudio('review');
  else releaseAudio('review');
}

// "Hold as drone": not a loop of the recording — a steady synthesized tone
// at the exact pitch center the player produced (including its cents
// error), so it can be held indefinitely and beaten against the reference.
function startNoteDrone(frequency, btn, tile) {
  stopNoteDrone();
  noteDrone = { ...makeOsc(frequency, 0.3), btn, tile };
  reviewVoicesChanged();
  btn.classList.add('active');
  tile.classList.add('playing');
}

function stopNoteDrone() {
  if (!noteDrone) return;
  fadeOutOsc(noteDrone);
  noteDrone.btn.classList.remove('active');
  noteDrone.tile.classList.remove('playing');
  noteDrone = null;
}

// Other takes of the same pitch, held as drones — keyed by note so several can
// sound together and each can be switched off on its own.
const compareDrones = new Map(); // note → { osc, gain }

function stopCompareDrones(btn = null) {
  for (const voice of compareDrones.values()) fadeOutOsc(voice);
  compareDrones.clear();
  btn?.classList.remove('active');
}

function toggleCompareDrone(sibling, a4, btn) {
  const existing = compareDrones.get(sibling);
  if (existing) {
    fadeOutOsc(existing);
    compareDrones.delete(sibling);
  } else {
    // the pitch actually produced, cents error and all — that's the point
    const frequency = a4 * 2 ** ((sibling.midi + sibling.cents / 100 - 69) / 12);
    compareDrones.set(sibling, makeOsc(frequency, 0.28));
    reviewVoicesChanged();
  }
  btn.classList.toggle('active', compareDrones.size > 0);
}

function startRefDrone(frequency, btn) {
  stopRefDrone();
  refDrone = { ...makeOsc(frequency, 0.26), btn };
  reviewVoicesChanged();
  btn.classList.add('active');
}

function stopRefDrone() {
  if (!refDrone) return;
  fadeOutOsc(refDrone);
  refDrone.btn.classList.remove('active');
  refDrone = null;
}

// --- click track: hear the take against the pulse the timing panel read -----
//
// Practising against a metronome tells you where you are now; hearing a take
// you already played laid over the click tells you where you were, which is
// the thing a recording can do that a metronome can't. The clicks are placed
// on the audio clock the same way the metronome places them, mapped through
// the same speed factor as the audio, so they stay in step at ¼× too.

let clickGrid = null;      // { phase, step, until } in recording seconds
let clickNodes = [];
const MAX_CLICKS = 2000;

function stopClicks() {
  for (const node of clickNodes) {
    try { node.stop(); } catch { /* already finished */ }
  }
  clickNodes = [];
}

function scheduleClickTrack(startTime, from, recSpan) {
  stopClicks();
  if (!clickGrid || !(clickGrid.step > 0)) return;
  const { phase, step, until } = clickGrid;
  const end = Math.min(until, from + recSpan);
  let k = Math.ceil((from - phase) / step);
  for (let n = 0; n < MAX_CLICKS; n++, k++) {
    const g = phase + k * step;
    if (g > end) break;
    const at = startTime + (g - from) / playbackSpeed;
    if (at < playbackCtx.currentTime) continue;
    clickNodes.push(...scheduleClick(playbackCtx, at, 'beat'));
  }
}

function stopPlayback(root) {
  stopClicks();
  releaseAudio('playback');
  if (currentSource) {
    currentSource.onended = null;
    try { currentSource.stop(); } catch { /* already finished on its own */ }
    // Disconnect and drop the buffer rather than leaving a stopped node hanging
    // off the master chain. The buffer is the whole take — around 115 MB for
    // ten minutes — and holding it until the graph happens to be collected is
    // how playing a long take a few times runs a phone out of memory.
    currentSource.disconnect();
    currentSource.buffer = null;
    currentSource = null;
  }
  cancelAnimationFrame(animationFrame);
  setPlayheads(null);
  if (zoom) zoomChart?.setPlayhead(zoom.pos);
  if (full) currentChart?.setPlayhead(full.pos);
  stopNoteDrone();
  tellFollowers(null, null);
  for (const el of root.querySelectorAll('.degree.playing')) el.classList.remove('playing');
  if (zoom) zoom.playing = false;
  if (full) full.playing = false;
  updateZoomButton(root);
  updateFullButton(root);
}

// Plays a clip with a live playhead on both charts. `timeMap` converts
// clip-audio seconds to recording time (null = inside a silence gap), and
// `spans` are tiles that light up exactly while their note is sounding.
// Returns the audio-clock start time (used for pause bookkeeping).
function playClip(clip, root, timeMap, spans, onDone) {
  // The OTHER voice on this screen, silenced first.
  //
  // The scanned review lets you press a notehead nobody played and hear what is
  // WRITTEN there, synthesised (src/audio/written-pitch.js). Press one and then
  // press play, and until this line the tone rang on over the top of the
  // recording — two voices a second apart, one of them a real cello and one of
  // them not, which is precisely the confusion that module exists to prevent.
  // The reverse direction is handled from the other side: written-pitch.js
  // announces a start and this file subscribes below, because the tone's module
  // must not be able to reach a Recorder.
  stopWrittenPitch();
  // Tearing down the previous clip drops its hold, so this one is taken after,
  // not before — otherwise the context would be free to sleep mid-playback.
  playbackCtx = audioContext();
  stopPlayback(root);
  playbackCtx = holdAudio('playback');

  // Every caller hands us a fresh array out of Recorder.extract, so the copy
  // that used to be here was pure waste — and not a small one. Playing a
  // ten-minute take from the beginning extracts ~115 MB of float samples, and
  // copying it again before handing a third copy to createBuffer asked iOS for
  // a third of a gigabyte in one gesture. That allocation is what "it won't
  // play from the start" looks like from the outside: the further in you began,
  // the less it needed, which is why playing from later in the take worked.
  const samples = playbackSpeed < 0.999
    ? timeStretch(clip.samples, clip.sampleRate, playbackSpeed)
    : clip.samples;

  // Phone recordings are quiet — normalize each clip's peak toward full
  // scale (gain capped so the noise floor of near-silence isn't blasted).
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0.0001 && peak < 0.85) {
    const boost = Math.min(0.85 / peak, 8);
    for (let i = 0; i < samples.length; i++) samples[i] *= boost;
  }

  // A long take is a big allocation and it can simply be refused. Saying so is
  // the point: this used to throw out of a click handler, which left the button
  // looking like it had ignored the tap.
  let buffer;
  try {
    buffer = playbackCtx.createBuffer(1, samples.length, clip.sampleRate);
    buffer.copyToChannel(samples, 0);
  } catch (err) {
    releaseAudio('playback');
    say(root, saying("couldn't play that much at once", err));
    return null;
  }
  const source = playbackCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(masterOut());

  // WHAT YOU ARE HEARING, NOT WHAT THE GRAPH IS AT.
  //
  // `playbackCtx.currentTime` is where the audio engine has got to, and the
  // sound of that moment has not left the speaker yet: the graph's output is
  // buffered, and on a phone or a tablet the whole path — buffer, mixer,
  // hardware, and a Bluetooth link if there is one — is tens of milliseconds
  // long. So a playhead and a lit notehead driven straight off the clock run
  // AHEAD of the music by exactly that, every time, and at speed it is a whole
  // note: semiquavers at 120 are 125 ms apart.
  //
  // A player put it as "I need the playing to sync perfectly with the score …
  // if you are playing fast, the notes being highlighted in the playback [must
  // be] synced exactly with that part of the audio", and this is the half of
  // that which is arithmetic rather than alignment. The browser reports the two
  // parts of the delay — `baseLatency` is the graph's own buffering and
  // `outputLatency` is everything past it — so the light is driven off the
  // moment being HEARD.
  //
  // Read every frame rather than once: `outputLatency` changes under you when
  // headphones go in or a Bluetooth speaker connects, which is the case where
  // being wrong is most obvious.
  // …and defended, because both numbers are optional and one of them lies.
  // `outputLatency` is NaN in a browser that has not measured it yet — which
  // `?? 0` does not catch, and NaN poisons the whole chain: the playhead reads
  // NaN, `headAt(NaN)` answers null, and not one notehead lights for the whole
  // take. MEASURED, `npm run score:follow` the moment this was added without
  // the guard: "0 different noteheads lit over 16s". Capped as well, because a
  // quarter of a second is already a long delay and a wilder figure would drag
  // the light further out of step than the delay it is correcting.
  const HEARD_MOST = 0.25;
  const real = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  const heard = () => Math.min(HEARD_MOST,
    real(playbackCtx.baseLatency) + real(playbackCtx.outputLatency));
  // Started at an explicit moment rather than "as soon as possible", so that
  // the clock the light reads and the clock the sound is played on are the same
  // number and not two numbers a render quantum apart.
  const startTime = playbackCtx.currentTime + 0.02;
  const tick = () => {
    if (source !== currentSource) return;
    const recTime = timeMap(
      Math.max(0, playbackCtx.currentTime - startTime - heard()) * playbackSpeed,
    );
    setPlayheads(recTime);
    // The note box reads whatever is under the cursor, so while the cursor is
    // moving on its own it should keep reading — watching the playhead cross a
    // scoop and seeing the box still describe where the cursor was left is the
    // opposite of what it is for.
    if (recTime !== null) cursorReadout?.(recTime);
    let sounding = null;
    for (const s of spans) {
      const active = recTime !== null && recTime >= s.start && recTime <= s.end;
      s.tile?.classList.toggle('playing', active);
      if (active) sounding = s.note ?? null;
    }
    currentChart?.setHighlight?.(sounding);
    tellFollowers(sounding, recTime);
    animationFrame = requestAnimationFrame(tick);
  };
  source.onended = () => { stopPlayback(root); onDone?.(); };
  source.start(startTime);
  currentSource = source;
  scheduleClickTrack(startTime, timeMap(0), (samples.length / clip.sampleRate) * playbackSpeed);
  tick();
  return startTime;
}

// …and the same seam from the other side. A press on an unplayed notehead while
// the take is playing stops the take, so the tone is heard alone — the two must
// never sound together and only one of them can be a recording of anything.
// Guarded on `currentSource` rather than called flat: stopPlayback also drops
// the note drone and tells the followers the playhead is gone, and doing that
// on every press when nothing is playing would put out a light nobody lit.
whenWrittenPitchStarts(() => {
  if (currentSource) stopPlayback(document);
});

// --- whole-take player: play/pause on the overview chart --------------------

let full = null; // { recording, spans, pos, playing, playInfo }

function updateFullButton(root) {
  const btn = root.querySelector('#clip-play');
  if (btn) btn.textContent = full?.playing ? '❚❚' : '▶';
}

function playFullFrom(root, from) {
  if (!full) return;
  const clip = {
    samples: full.recording.extract(from, full.recording.duration),
    sampleRate: full.recording.sampleRate,
  };
  const startTime = playClip(
    clip, root,
    (t) => from + t,
    full.spans,
    () => { if (full) { full.playing = false; full.pos = 0; } updateFullButton(root); },
  );
  // Nothing started: leave the player alone rather than flipping the button to
  // "pause" for a sound that does not exist.
  if (startTime === null) return;
  full.playing = true;
  full.pos = from;
  full.playInfo = { from, startTime };
  updateFullButton(root);
}

// Play one marked span and stop at its end — the whole-take player's spans and
// playhead still apply, so the chart follows along as usual.
function playSpan(root, startSec, endSec) {
  if (!full) return;
  const from = Math.max(0, startSec);
  const to = Math.min(full.recording.duration, endSec);
  if (!(to > from)) return;
  const clip = {
    samples: full.recording.extract(from, to),
    sampleRate: full.recording.sampleRate,
  };
  const startTime = playClip(
    clip, root,
    (t) => from + t,
    full.spans,
    () => { if (full) { full.playing = false; full.pos = from; } updateFullButton(root); },
  );
  if (startTime === null) return;
  full.playing = true;
  full.pos = from;
  full.playInfo = { from, startTime };
  updateFullButton(root);
}

function pauseFull(root) {
  if (!full?.playing) return;
  const { from, startTime } = full.playInfo;
  const elapsed = (playbackCtx.currentTime - startTime) * playbackSpeed;
  full.pos = Math.min(full.recording.duration, from + elapsed);
  stopPlayback(root);
  updateFullButton(root);
}

// --- zoom section player: play/pause and a draggable playhead --------------

let zoom = null; // { recording, t0, t1, pos, playing, wasPlaying, tile, note, playInfo, retune }
// Monotonic across zoom sessions: a per-zoom counter would restart at 0 for
// the next note and a pending loop would match it by accident.
let zoomLoopToken = 0;
let selectedNote = null; // the note whose zoom inset is open

function updateZoomButton(root) {
  const btn = root.querySelector('#zoom-play');
  if (btn) btn.textContent = zoom?.playing ? '❚❚' : '▶';
}

// The zoom section loops: reaching the end sends the cursor back to wherever
// it was started from and plays again, until pause. Practising a hard spot
// means hearing it over and over, and re-pressing play each time gets old.
//
// The restart can't happen inside onended — playClip's first act is
// stopPlayback, so calling it from that callback would re-enter the teardown
// it was called from. It goes on a fresh task instead, guarded by a token so
// a pause (or a jump to another note) in the gap cancels the pending loop.
function playZoomFrom(root, from) {
  if (!zoom) return;
  const clip = {
    samples: zoom.recording.extract(from, zoom.t1),
    sampleRate: zoom.recording.sampleRate,
  };
  const token = zoomLoopToken;
  // playClip stops any previous playback first, which resets the playing
  // flag — so mark this zoom as playing only after it starts.
  const startTime = playClip(
    clip, root,
    (t) => from + t,
    [{ tile: zoom.tile, start: zoom.note.start, end: zoom.note.end, note: zoom.note }],
    () => {
      if (!zoom || zoomLoopToken !== token) { updateZoomButton(root); return; }
      setTimeout(() => {
        if (zoom && zoomLoopToken === token) playZoomFrom(root, from);
      }, 0);
    },
  );
  if (startTime === null) return;
  zoom.playing = true;
  zoom.pos = from;
  zoom.playInfo = { from, startTime };
  updateZoomButton(root);
}

function pauseZoom(root) {
  if (!zoom?.playing) return;
  const { from, startTime } = zoom.playInfo;
  const elapsed = (playbackCtx.currentTime - startTime) * playbackSpeed;
  zoom.pos = Math.min(zoom.t1, from + elapsed);
  zoomLoopToken++; // cancels a loop restart already queued for this pass
  stopPlayback(root);
  setPlayheads(zoom.pos); // keep the marker where playback stopped
  updateZoomButton(root);
}

// PRESS A NOTEHEAD, HEAR THAT NOTE. The one sentence this whole screen is for.
//
// MEASURED, before this existed, by patching AudioBufferSourceNode.prototype
// .start and OscillatorNode.prototype.start in the page and pressing a ring on
// a photographed page: `{ buffersStarted: 0, oscillatorsStarted: 0,
// zoomPlayButton: "play" }`. The chain scan-view.js → score.js → main.js →
// selectFromOutside was complete and every link worked; it ended in a panel
// that showed the note and never played it, while the tile's own title said
// "play this note back". The check that was watching this asserted that the
// PANEL OPENED, which is why 35 browser checks passed over a capability that
// measured zero. `npm run score:hear` counts sources started instead.
//
// It goes through `playClip` rather than starting a source of its own, and that
// is structural rather than tidy: playClip's first act is `stopWrittenPitch()`,
// so a press that sounds the recording cannot leave the written-pitch tone of
// some earlier press ringing under it — the one arrangement those two voices
// must never be in. Everything else here (the playhead, the light on the page,
// the tile that lights while its note sounds, the audio-session hold) comes
// along for free for the same reason.
//
// A SHORTER LEAD-IN THAN buildEmphasizedClip'S DEFAULT, and it is the
// difference between hearing the note you pressed and hearing the one before
// it. `contextSec` is 1.2 s either side by default — the right window when you
// press PLAY on a passage and want the moment in context, and the wrong one as
// the answer to a tap. MEASURED both ways with `npm run score:hear` on the
// Bach photograph, watching which notehead the follow-along lights:
//
//   contextSec 1.2   clip 2.78 s long, and the notehead that was pressed had
//                    STILL NOT LIT 1.2 s after the press — 41 frames watched,
//                    nothing lit at all. The whole of that window is the
//                    previous bar, ducked.
//   contextSec 0.35  clip 1.08 s long, and the pressed notehead lights
//                    0.40-0.43 s after the source starts, over three runs.
//
// 0.35 s is still long enough that the attack is not clipped — the segmenter's
// `start` is the first frame that carried the pitch, so the bow is already
// moving before it — and the neighbours stay audible at `contextGain`, ducked,
// so the note is heard IN the take rather than cut out of it.
const PRESS_CONTEXT_SEC = 0.35;

// Rule 3 lives on this function's first four lines.
//
// It plays the RECORDING, so the note it is handed must be a note that was
// really played and really recorded — a notehead nobody played must never be
// able to arrive here and be given somebody else's audio. Two things stop it.
// Structurally, the only caller is `showPlayback`, which is only reached
// through `selectNote`, which returns early unless the note is a key of
// `tileByNote` — a map built from `degrees.filter(d => d.played)`, i.e. from
// the take. An unplayed notehead on a photograph never becomes one of those:
// scan-view.js hands it to `pickSilent`, which takes a HEAD and can reach
// nothing but written-pitch.js. And numerically, the guard below refuses
// anything whose times are not a real moment in THIS recording — a note copied
// through the store without its clock, a note from another take.
//
// WHAT THE GUARD DELIBERATELY DOES NOT REFUSE, because the first version of it
// did and that was a second silent press: a note whose `end` runs past the end
// of the audio. The segmenter's `end` is a frame time and `duration` is a
// sample count, so the last note of a take can end a frame beyond it —
// buildEmphasizedClip already clamps both edges (`Math.min(recording.duration,
// …)`), so that press yields a perfectly good clip and refusing it would have
// left exactly the symptom this function exists to kill, scoped to the last
// note of every take. `npm run score:hear` presses the LAST ring for that
// reason. And a refusal SAYS so rather than returning quietly: a press that
// opens a panel and makes no sound with no explanation is the bug, whatever
// the reason for it.
function playNoteAloud(root, recording, note, tile) {
  if (!recording || !note) return null;
  if (!Number.isFinite(note.start) || !Number.isFinite(note.end)
    || !(note.end > note.start)
    || note.start < 0 || note.start >= recording.duration) {
    say(root, 'that note has no moment in this recording, so there is nothing to play');
    return null;
  }

  const clip = buildEmphasizedClip(recording, note.start, note.end, {
    contextSec: PRESS_CONTEXT_SEC,
  });
  // Where the clip begins in the recording. Taken back off the clip's own
  // `targetOffset` rather than recomputed as `start - contextSec`, because at
  // the very beginning of a take the clip is clamped at 0 and the two answers
  // differ — and this number is the whole time map.
  const from = note.start - clip.targetOffset;
  const startTime = playClip(
    clip, root,
    (t) => from + t,
    [{ tile, start: note.start, end: note.end, note }],
    () => { if (zoom) zoom.playing = false; updateZoomButton(root); },
  );
  // Nothing started: say nothing more. playClip has already told the user why.
  if (startTime === null) return null;
  // The zoom transport is the visible state of "something is playing" on this
  // panel, and it was the tell in the original measurement — `zoomPlayButton:
  // "play"` while a press was supposed to be sounding. If this note owns the
  // zoom inset, the press hands it the transport so ❚❚ stops what it started.
  // `zoom.pos` is deliberately NOT moved to the clip's start: the cursor stays
  // on the note, the playhead rides over it while the clip runs, and it comes
  // back to the note when it ends instead of parking a third of a second early.
  if (zoom && zoom.note === note) {
    zoom.playing = true;
    zoom.playInfo = { from, startTime };
  }
  updateZoomButton(root);
  return startTime;
}

// mm:ss for a position in the take — how the passage list writes times too.
function formatClock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function centsLabel(cents) {
  return `${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢`;
}

// Amplitude peaks at 1ms resolution, computed once per take — the waveform
// view reads these instead of rescanning raw audio on every redraw.
function buildWave(recording) {
  if (!recording || recording.duration === 0) return null;
  const samples = recording.extract(0, recording.duration);
  const perSec = 1000;
  const bucket = Math.max(1, Math.round(recording.sampleRate / perSec));
  const peaks = new Float32Array(Math.ceil(samples.length / bucket));
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    const b = (i / bucket) | 0;
    if (a > peaks[b]) peaks[b] = a;
  }
  // normalize to the take's own peak so quiet phone recordings still read
  let max = 0;
  for (const p of peaks) if (p > max) max = p;
  if (max > 0.001) for (let i = 0; i < peaks.length; i++) peaks[i] /= max;
  return { peaks, perSec };
}

let overviewPxPerSec = Number(localStorage.getItem('chartPxPerSec')) || 120;
let overviewMode = localStorage.getItem('chartMode') === 'wave' ? 'wave' : 'pitch';

function showOverview(root, allNotes, recording, extras, selectNote, tileByNote) {
  stopPlayback(root);
  root.querySelector('#playback').hidden = false;
  root.querySelector('#selected-note').hidden = true;
  root.querySelector('#compare').hidden = true;
  root.querySelector('#note-drone').hidden = true;
  root.querySelector('#ref-drone').hidden = true;
  root.querySelector('#ref-octave').hidden = true;
  root.querySelector('#ref-interval').hidden = true;
  root.querySelector('#note-zoom').hidden = true;
  zoomChart = null;
  zoom = null;
  selectedNote = null;

  // whole-take play/pause above the overview chart
  full = recording ? {
    recording,
    // The element the player was rendered into, so something outside this file
    // can ask for a moment of the take without having to know where the report
    // lives. See playTakeFrom.
    root,
    spans: allNotes.map((n) => ({
      tile: tileByNote.get(n)?.tile, start: n.start, end: n.end, note: n,
    })),
    pos: 0,
    playing: false,
    playInfo: null,
  } : null;
  root.querySelector('#clip-head').hidden = !recording;
  updateFullButton(root);
  // The press is long enough to wake the context in; the click then has
  // nothing left to wait for. See warmAudio.
  root.querySelector('#clip-play').onpointerdown = warmAudio;
  root.querySelector('#clip-play').onclick = () => {
    if (!full) return;
    if (full.playing) pauseFull(root);
    else playFullFrom(root, full.pos);
  };

  // Back to the top from anywhere in the take, without dragging a cursor the
  // length of a ten-minute recording to get there. It always PLAYS: pressing it
  // while paused and being left at a stopped playhead would just be a second
  // way to lose your place.
  const restart = root.querySelector('#clip-restart');
  if (restart) {
    restart.hidden = !recording;
    restart.onpointerdown = warmAudio;
    restart.onclick = () => {
      if (!full) return;
      stopPlayback(root);
      full.pos = 0;
      playFullFrom(root, 0);
    };
  }

  // Hearing a take you already played laid over a click is the thing a
  // recording can do that a metronome cannot. The pulse is read from the take
  // itself, so it needs nothing set up first.
  const clickBtn = root.querySelector('#clip-click');
  if (clickBtn) {
    clickBtn.hidden = !recording;
    clickBtn.classList.remove('active');
    clickBtn.onclick = () => {
      if (clickGrid) {
        clickGrid = null;
        clickBtn.classList.remove('active');
        stopClicks();
        return;
      }
      const beat = rhythmReport(allNotes);
      if (!beat?.tactus) {
        say(root, 'not enough of a pulse in that take to lay a click over');
        return;
      }
      clickGrid = {
        phase: beat.phase ?? 0,
        step: beat.tactus,
        until: Math.max(...allNotes.map((n) => n.start)) + beat.tactus,
      };
      clickBtn.classList.add('active');
      // Toggled mid-playback it takes effect at once rather than at the next
      // press — the point is to A/B the click against what you played.
      if (full?.playing) {
        pauseFull(root);
        playFullFrom(root, full.pos);
      }
    };
  }

  // Dragging the overview cursor (or tapping the chart) steers everything:
  // the whole-take play position, which note the zoom inset shows, and the
  // pitch any held drone follows.
  //
  // AND IT NO LONGER STOPS THE MUSIC. Pointing at a moment used to end the
  // take: you were listening, you pointed at the passage you wanted, and the
  // sound went out — so the only way to hear the place you had just chosen was
  // to find the play button again. "I should be able to play and pause from any
  // of them, and they should all kind of work together." Pointing is a SEEK
  // now; the take carries on from where you pointed, and stopping is the pause
  // button's job and nothing else's.
  //
  // It still pauses UNDER the gesture, because a moving playhead being dragged
  // to a new place is two things arguing about where the cursor is. The pause
  // lasts as long as the finger does.
  //
  // The cursor strip reports a drag as start · move · end and then fires a
  // click on top of it, so an 'end' swallows the 'tap' behind it — without that
  // letting go would restart the playback the 'end' had just resumed.
  //
  // SWALLOWED FOR A MOMENT, NOT UNTIL SOMEBODY TAPS. A pointercancel — the
  // browser taking the gesture away for a scroll, a second finger, a call
  // arriving — reports 'end' with no click behind it, and a flag left standing
  // would eat the next real tap instead. One dead tap, minutes later, with
  // nothing to connect it to: the shape of "it doesn't work sometimes". The
  // click a drag leaves behind arrives in the same task or the next, so the
  // window only has to cover that.
  let resumeAfterSeek = false;
  let swallowUntil = 0;
  const SWALLOW_MS = 300;
  const now = () => (globalThis.performance?.now?.() ?? 0);
  const overviewSeek = (t, phase) => {
    const at = Math.max(0, t);
    if (phase === 'tap' && now() < swallowUntil) { swallowUntil = 0; return; }
    if (phase === 'start' || phase === 'tap') {
      if (full?.playing) { resumeAfterSeek = true; pauseFull(root); }
      else if (zoom?.playing) { resumeAfterSeek = true; pauseZoom(root); }
    }
    if (full) full.pos = at;
    const n = findNoteAt(allNotes, t);
    if (n && n !== selectedNote) {
      selectNote(n, t);
    } else if (zoom) {
      zoom.pos = Math.max(zoom.t0, Math.min(zoom.t1, t));
      zoom.retune?.();
    }
    setPlayheads(t);
    if (phase === 'end') swallowUntil = now() + SWALLOW_MS;
    if ((phase === 'end' || phase === 'tap') && resumeAfterSeek) {
      resumeAfterSeek = false;
      playFullFrom(root, at);
    }
  };

  // Built on demand rather than on every report open: it walks every sample,
  // which is 26 million of them on a ten-minute take, and most reports are
  // never switched to the waveform view at all.
  let wave = null;
  let waveBuilt = false;
  const waveFor = () => {
    if (!waveBuilt) { wave = buildWave(recording); waveBuilt = true; }
    return wave;
  };
  const hasAudio = !!recording && recording.duration > 0;
  const scroller = root.querySelector('#chart-scroll');
  let scalePending = null;

  const buildChart = () => {
    const useWave = overviewMode === 'wave' && hasAudio;
    currentChart = renderOverviewChart(root.querySelector('#pitch-chart'), {
      readings: extras.readings,
      notes: allNotes,
      a4: extras.a4 ?? 440,
      pxPerSec: overviewPxPerSec,
      mode: useWave ? 'wave' : 'pitch',
      wave: useWave ? waveFor() : null,
      onSeek: overviewSeek,
      onScale: (s) => {
        // rebuild at most once a frame while the pinch is moving
        scalePending = s;
        if (scalePending !== null && scalePending !== overviewPxPerSec) {
          requestAnimationFrame(() => {
            if (scalePending === null) return;
            overviewPxPerSec = scalePending;
            scalePending = null;
            localStorage.setItem('chartPxPerSec', String(Math.round(overviewPxPerSec)));
            rebuild();
          });
        }
      },
      onNoteHover: (note) => {
        for (const { tile } of tileByNote.values()) tile.classList.remove('peek');
        if (note) tileByNote.get(note)?.tile.classList.add('peek');
      },
    });
    currentChart.setPlayhead(full ? full.pos : null);
    if (selectedNote) currentChart.setHighlight(selectedNote);
  };

  // THE CHART HAS TO BE BUILT AT THE WIDTH IT IS ACTUALLY SHOWN AT.
  //
  // `renderOverviewChart` sizes the canvas from `scroller.clientWidth`, and
  // falls back to 900 when that is 0 — which is what a container that has not
  // been laid out yet measures. The Record tab renders the card visible first
  // for exactly this reason. The SCORE tab does not get that: the whole
  // playback panel is moved into `#score-dock` (see score-tab.js) and the chart
  // is built before the panel has landed anywhere with a width.
  //
  // MEASURED at 390x844: a canvas 900 CSS pixels wide, sitting at x = -11, so
  // 510px of the trace was off the right of the screen and the pitch names down
  // the left were cut in half — "G#2" reading "#2". Every take reviewed from
  // the Score tab.
  //
  // So the scroller is WATCHED. A width it has never been built at rebuilds the
  // chart, which covers the borrow, a tab switch, a rotation and a window drag
  // with one mechanism instead of three.
  let builtAt = 0;
  let watching = null;

  // Re-render at a new scale/mode, keeping the time at the viewport center
  // under the viewport center.
  const rebuild = () => {
    const half = scroller.clientWidth / 2;
    const centerTime = currentChart?.timeAtX?.(scroller.scrollLeft + half) ?? null;
    buildChart();
    if (centerTime !== null) {
      scroller.scrollLeft = Math.max(0, currentChart.xOfTime(centerTime) - half);
    }
  };

  // pitch ↔ waveform toggle (hidden when there is no audio to draw)
  const modeGroup = root.querySelector('#chart-mode');
  modeGroup.hidden = !hasAudio;
  for (const btn of modeGroup.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.mode === overviewMode);
    btn.onclick = () => {
      if (overviewMode === btn.dataset.mode) return;
      overviewMode = btn.dataset.mode;
      localStorage.setItem('chartMode', overviewMode);
      for (const b of modeGroup.querySelectorAll('button')) {
        b.classList.toggle('active', b === btn);
      }
      rebuild();
    };
  }

  buildChart();
  builtAt = scroller?.clientWidth ?? 0;

  watching?.disconnect();
  if (scroller && typeof ResizeObserver === 'function') {
    watching = new ResizeObserver(() => {
      const now = scroller.clientWidth;
      // Nothing to draw into yet, and no point redrawing for a pixel: the
      // spacer this rebuild sets is what scrolls, and it does not change the
      // scroller's own width, so there is no loop to guard against beyond this.
      if (!now || Math.abs(now - builtAt) < 4) return;
      builtAt = now;
      rebuild();
    });
    watching.observe(scroller);
    chartWatch = watching;
  }

  // the cursor knob starts at the beginning of the take
  if (full) {
    full.pos = Math.max(0, currentChart.range?.t0 ?? 0);
    currentChart.setPlayhead(full.pos);
  }
}

// Selecting a note opens its cents-level detail in the zoom inset below.
// `atTime` places the zoom cursor (used when the overview cursor drags in).
// `autoplay` is the difference between PRESSING a note and merely SELECTING
// one. A press on a notehead — on the photograph, on the engraved page, or on
// the tile that says "play this note back" — is a request to hear it. Dragging
// the overview cursor or picking a note out of the landing chart is a request
// to LOOK at it, and starting the recording under someone who is reading a
// graph is not the same gesture at all, so those callers leave it false.
function showPlayback(root, tile, note, name, allNotes, recording, extras, tileByNote, atTime = null, autoplay = false) {
  root.querySelector('#playback').hidden = false;
  selectedNote = note;

  // WHAT TO CALL IT WHEN NOTHING NAMED IT.
  //
  // `name` is the degree's name, which on a take against notation is the
  // WRITTEN note and on a free review is the played note's own `name` field.
  // notes.js fills that field in, so this is not a case the live app reaches
  // today — but the close-up's heading is built by string interpolation, and a
  // note that arrives without one (a fixture, a take rebuilt by a caller, a
  // future producer) put the word `null` in front of a player: MEASURED, in
  // npm run score:follow, the close-up read "null up close" for a note whose
  // pitch the panel underneath was drawing correctly as B3. Falling back to the
  // MIDI number's own name is not a guess — it is the same arithmetic the
  // cursor readout two lines below already does.
  const shown = name ?? midiToName(note.midi) ?? '—';

  // The selected note as a box: name, cents, chord marker, status color.
  const selected = root.querySelector('#selected-note');
  selected.hidden = false;
  selected.className = note.chord ? 'degree chord' : 'degree';
  selected.dataset.state = intonationHue(note.cents);
  selected.innerHTML = `<b>${note.chord ? '+' : ''}${shown}</b>${centsLabel(note.cents)}${note.chord ? ' · chord' : ''}`;

  // Reused by retuneCursorDrones below, which rewrites this box on every move
  // of a dragged cursor and should not be parsing HTML to do it.
  const cursorName = document.createElement('b');
  const cursorCents = document.createTextNode('');

  const a4 = extras.a4 ?? 440;

  // Pitch actually played at time t, from the recorded readings — this is
  // what the cursor drone holds and retunes to while it's dragged.
  // Called on every pointermove while the cursor drone is dragged, so it
  // bisects the (time-ordered) readings and looks at a handful around the
  // target rather than scanning the take — which on a ten-minute session was
  // 52,000 comparisons per mouse event.
  const readingFreqAt = (t) => {
    const rs = extras.readings ?? [];
    let lo = 0;
    let hi = rs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rs[mid].time < t) lo = mid + 1;
      else hi = mid;
    }
    let best = null;
    for (let i = Math.max(0, lo - 30); i < Math.min(rs.length, lo + 30); i++) {
      const r = rs[i];
      if (r.frequency === null || r.confidence < 0.6) continue;
      if (best === null || Math.abs(r.time - t) < Math.abs(best.time - t)) best = r;
    }
    return best && Math.abs(best.time - t) < 0.25 ? best.frequency : null;
  };
  const cursorMidi = () => {
    const f = readingFreqAt(zoom?.pos ?? note.start);
    return f ? Math.round(69 + 12 * Math.log2(f / a4)) : note.midi;
  };

  const noteDroneBtn = root.querySelector('#note-drone');
  const refBtn = root.querySelector('#ref-drone');
  const refOct = root.querySelector('#ref-octave');
  const refInterval = root.querySelector('#ref-interval');

  // Fifths are pure (3:2), not equal-tempered — a correctly played note
  // locks beat-free against a pure fifth, the same way open strings are
  // tuned. Unison stays equal-tempered (it IS the reference pitch).
  const INTERVAL_RATIOS = { unison: 1, 'fifth-up': 3 / 2, 'fifth-down': 2 / 3 };
  const refFrequency = () =>
    a4 * 2 ** ((cursorMidi() + Number(refOct.value) * 12 - 69) / 12) *
    INTERVAL_RATIOS[refInterval.value];
  const refreshRefLabel = () => {
    refBtn.textContent = `+ in-tune ${midiToName(cursorMidi())} drone`;
  };
  // What the box says for a given moment: the note under it and how far off it
  // was. Written from two kept nodes rather than an innerHTML string — this
  // runs on every pointer move of a drag and on every frame of playback.
  const showCursorReading = (t) => {
    const f = readingFreqAt(t);
    if (!f) return;
    const mf = 69 + 12 * Math.log2(f / a4);
    const m = Math.round(mf);
    const cents = (mf - m) * 100;
    selected.dataset.state = intonationHue(cents);
    cursorName.textContent = midiToName(m);
    cursorCents.textContent = centsLabel(cents);
    if (selected.firstChild !== cursorName) selected.replaceChildren(cursorName, cursorCents);
  };
  cursorReadout = showCursorReading;

  const retuneCursorDrones = () => {
    if (noteDrone) {
      const f = readingFreqAt(zoom.pos);
      if (f) noteDrone.osc.frequency.setTargetAtTime(f, playbackCtx.currentTime, 0.03);
    }
    if (refDrone) {
      refDrone.osc.frequency.setTargetAtTime(refFrequency(), playbackCtx.currentTime, 0.03);
    }
    refreshRefLabel();
    showCursorReading(zoom?.pos ?? note.start);
  };

  if (extras.readings?.length) {
    zoomLoopToken++; // any loop still pending belongs to the note we just left
    root.querySelector('#note-zoom').hidden = false;
    root.querySelector('#zoom-label').textContent = `${shown} up close`;
    zoom = {
      recording,
      t0: 0,
      t1: 0,
      // the cursor starts ON the note (or where the overview cursor is),
      // so the drone grabs this note's pitch
      pos: atTime ?? note.start + Math.min(0.15, (note.end - note.start) / 2),
      playing: false,
      wasPlaying: false,
      tile,
      note,
      playInfo: null,
    };
    updateZoomButton(root);
    root.querySelector('#zoom-play').onpointerdown = warmAudio;
    root.querySelector('#zoom-play').onclick = () => {
      if (zoom.playing) pauseZoom(root);
      else playZoomFrom(root, zoom.pos);
    };

    let zoomScalePending = null;
    const buildZoomChart = () => {
      zoom.t0 = Math.max(0, note.start - zoomContextSec);
      zoom.t1 = Math.min(recording.duration, note.end + zoomContextSec);
      zoom.pos = Math.max(zoom.t0, Math.min(zoom.t1, zoom.pos));
      zoomChart = renderNoteChart(root.querySelector('#note-chart'), {
        readings: extras.readings,
        note,
        a4,
        contextSec: zoomContextSec,
        onSeek: (t, phase) => {
          if (phase === 'start') {
            zoom.wasPlaying = zoom.playing;
            if (zoom.playing) pauseZoom(root);
          }
          zoom.pos = t;
          setPlayheads(t);
          retuneCursorDrones();
          if (phase === 'end' && zoom.wasPlaying) playZoomFrom(root, t);
        },
        onScale: (c) => {
          zoomScalePending = c;
          requestAnimationFrame(() => {
            if (zoomScalePending === null || zoomScalePending === zoomContextSec) return;
            zoomContextSec = zoomScalePending;
            zoomScalePending = null;
            buildZoomChart();
          });
        },
      });
      zoomChart.setPlayhead(zoom.pos);
    };
    buildZoomChart();
    zoom.retune = retuneCursorDrones;
  }

  // Hold the pitch under the zoom cursor as a drone (it retunes live as
  // the cursor is dragged), and layer an in-tune reference over it. Any
  // drone already sounding stays alive and glides to the new cursor spot.
  noteDroneBtn.hidden = false;
  refBtn.hidden = false;
  refOct.hidden = false;
  refInterval.hidden = false;
  if (noteDrone) {
    noteDrone.tile?.classList.remove('playing');
    noteDrone.tile = tile;
    tile.classList.add('playing');
  }
  retuneCursorDrones();

  const playedFrequency = a4 * 2 ** ((note.midi + note.cents / 100 - 69) / 12);
  noteDroneBtn.onclick = () => {
    if (noteDrone) {
      stopNoteDrone();
    } else {
      if (currentSource) stopPlayback(root); // a held pitch replaces playback
      startNoteDrone(readingFreqAt(zoom?.pos ?? note.start) ?? playedFrequency, noteDroneBtn, tile);
    }
  };

  refBtn.onclick = () => {
    if (refDrone) stopRefDrone();
    else startRefDrone(refFrequency(), refBtn);
  };
  const retune = () => {
    if (refDrone) refDrone.osc.frequency.setTargetAtTime(refFrequency(), playbackCtx.currentTime, 0.02);
  };
  refOct.onchange = retune;
  refInterval.onchange = retune;

  // Every other time you played this pitch. Opening the list lights them all
  // up on the graph, and any number can be held as drones at once — three
  // takes of the same G3 sounding together makes the spread audible.
  const compareBtn = root.querySelector('#compare');
  const siblings = findSameNotes(allNotes, note);
  stopCompareDrones();
  if (siblings.length) {
    const best = findComparisonNote(allNotes, note);
    compareBtn.hidden = false;
    compareBtn.textContent = `Compare your other ${name} (${siblings.length})`;
    compareBtn.setAttribute('aria-haspopup', 'menu');
    compareBtn.onclick = () => {
      // the whole family lights up while the list is open, so the graph shows
      // where each candidate is before you pick one
      currentChart?.setHighlight?.([note, ...siblings]);
      toggleMenu(compareBtn, () => siblings.map((sib) => ({
        label: `${formatClock(sib.start)} · ${centsLabel(sib.cents)}${sib === best ? ' ★' : ''}`,
        on: compareDrones.has(sib),
        onPick: () => toggleCompareDrone(sib, a4, compareBtn),
      })));
    };
  } else {
    compareBtn.hidden = true;
  }

  // LAST, and that is load-bearing. Everything above this line either tears
  // down the previous note's playback (`stopCompareDrones`, the zoom rebuild)
  // or rewires a control, and a clip started before any of it would be stopped
  // by its own panel finishing opening.
  if (autoplay) playNoteAloud(root, recording, note, tile);
}

function wireSpeedButtons(root) {
  for (const btn of root.querySelectorAll('#playback-speed button')) {
    btn.onclick = () => {
      playbackSpeed = Number(btn.dataset.speed);
      for (const b of root.querySelectorAll('#playback-speed button')) {
        b.classList.toggle('active', b === btn);
      }
      // whichever player is running restarts at the new speed
      if (zoom?.playing) { pauseZoom(root); playZoomFrom(root, zoom.pos); }
      else if (full?.playing) { pauseFull(root); playFullFrom(root, full.pos); }
    };
  }
}

function degreeState(d) {
  if (!d.played) return 'missed';
  return intonationHue(d.played.cents);
}

// Renders the intonation report from a bestAlignment() result. The full-
// session pitch trace appears immediately; clicking a played tile zooms
// the chart to that note and replays it (target at full volume, neighbors
// ducked) with a playhead sweeping in sync with the audio.
// --- ONLY THE NOTES THAT WERE HELD -----------------------------------------
//
// "I'd like to add a feature where you can select a duration, like 0.5 seconds
// and up… It'll only show you the pitches, like the notes, that were sustained
// for that amount of time or longer."
//
// A take of a real piece is mostly passing notes, and a semiquaver has no
// intonation worth arguing with: the pitch a player can actually judge — and
// fix — is the one that stood still long enough to have one. Reading a grid of
// four hundred tiles to find the dozen long notes is the job this does.
//
// HIDDEN, NOT REMOVED. `tileByNote` is how a notehead pressed on the score
// finds its tile (see selectNote → showPlayback), and a note filtered out of
// the grid is still a note somebody can press on the page. So the tiles stay
// in the map and in the DOM, and only stop being shown — a filtered note
// pressed on the score still opens, still plays, and still lights up.
//
// The GRAPH is left whole on purpose. It draws the take's own trace, and its
// time and pitch range are taken from the notes it is given — filtering them
// would crop the recording to whatever survived the filter and leave the
// playhead unable to reach the rest of it. The trace is the recording; this is
// a filter on the list of what was found in it.
let heldLeast = Number(localStorage.getItem('heldLeast')) || 0;
let applyHeldFilter = null;   // set by renderReport, called by the select

function wireHeldFilter(root) {
  const pick = root.querySelector('#held-least');
  if (!pick) return;
  pick.value = String(heldLeast);
  pick.onchange = () => {
    heldLeast = Number(pick.value) || 0;
    localStorage.setItem('heldLeast', String(heldLeast));
    applyHeldFilter?.();
  };
}

export function renderReport(root, alignment, recording = null, extras = {}) {
  const report = root.querySelector('#report');
  const grid = root.querySelector('#report-grid');

  const { degrees } = alignment;
  const allNotes = degrees.filter((d) => d.played).map((d) => d.played);

  // The click button re-renders switched off, so the grid it was playing has to
  // go with it — saving a take re-renders the review without going through
  // hideReport, which would otherwise leave clicks armed under a button that
  // says they aren't.
  clickGrid = null;

  wireSpeedButtons(root);

  const tileByNote = new Map();
  // `tileByNote` is the gate that keeps a notehead nobody played out of the
  // recording: it holds only notes out of THIS take (`degrees.filter(d =>
  // d.played)`), and a note that is not in it leaves here without opening a
  // panel and without a sound. See playNoteAloud.
  const selectNote = (note, atTime = null, { play = false } = {}) => {
    const entry = tileByNote.get(note);
    if (!entry) return;
    // While a passage is being marked, taps name its bounds instead of playing.
    if (offerNote(note)) {
      currentChart?.setHighlight?.(note);
      return;
    }
    currentChart?.setHighlight?.(note);
    showPlayback(root, entry.tile, note, entry.name, allNotes, recording, extras, tileByNote, atTime, play);
  };
  // A note picked in ANOTHER VIEW is a note somebody pressed on a score — the
  // photograph's rings (scan-view.js) and the engraved noteheads (score.js)
  // both arrive here through main.js's `selectPlayedNote`. That press is the
  // user's own sentence, "if you click on a note on the score you hear that
  // note in the audio", so it plays.
  selectFromOutside = (note, atTime = null) => selectNote(note, atTime, { play: true });

  // WHICH NOTE WAS BEING PLAYED AT THIS SECOND — the question a bar press asks.
  //
  // A bar is a rectangle on a page and a moment is a second of a recording (see
  // bar-sync.js); neither of them knows a note object. This turns the second
  // into the note that was sounding then, so pressing a bar opens the same
  // close-up that tapping the trace at the same place opens.
  //
  // NEAREST, not `findNoteAt`'s tenth-of-a-second window: a bar press lands
  // wherever the map put it, which is routinely in the rest between two notes,
  // and answering "nothing" there would leave the inset showing whatever was
  // last chosen — a panel answering a question nobody asked. It does not play:
  // playTakeFrom starts the take a line later, and two starts is one of them
  // cut off.
  selectAtMoment = (t) => {
    let best = null;
    let bestDistance = Infinity;
    for (const note of allNotes) {
      const d = t < note.start ? note.start - t : t > note.end ? t - note.end : 0;
      if (d < bestDistance) { bestDistance = d; best = note; }
    }
    if (best && best !== selectedNote) selectNote(best, t);
  };

  // Spoken form of a tile, for anyone who isn't looking at the colour.
  const spoken = (d) => {
    if (!d.played) return `${d.name}, missed`;
    const cents = Math.round(d.played.cents);
    const how = cents === 0 ? 'exactly in tune'
      : `${Math.abs(cents)} cents ${cents > 0 ? 'sharp' : 'flat'}`;
    // The tile is coloured in tune / sharp / flat, so that is what it says.
    const tier = { good: 'in tune', sharp: 'sharp', flat: 'flat' }[degreeState(d)];
    return `${d.name}, ${how}, ${tier}${d.played.chord ? ', chord note' : ''}`;
  };

  grid.replaceChildren();
  const rowFor = new Map();   // degree -> its tile, for the held-for filter
  for (const d of degrees) {
    // A real button when it does something: a div with a click handler cannot
    // be reached by keyboard and is announced as nothing at all.
    const playable = !!(recording && d.played);
    const tile = document.createElement(playable ? 'button' : 'div');
    if (playable) tile.type = 'button';
    tile.className = d.played?.chord ? 'degree chord' : 'degree';
    tile.dataset.state = degreeState(d);
    const label = d.played ? centsLabel(d.played.cents) : 'missed';
    tile.innerHTML = `<b>${d.played?.chord ? '+' : ''}${d.name}</b>${label}`;
    tile.setAttribute('aria-label', playable ? `${spoken(d)}. Play it back.` : spoken(d));
    if (playable) {
      tileByNote.set(d.played, { tile, name: d.name });
      tile.classList.add('clickable');
      // The title and the aria-label have both promised "play this note back"
      // since long before anything did, and MEASURED before this round a press
      // started 0 audio sources — the tile opened the close-up and left the
      // panel's own ▶ to be found and pressed. The promise is now kept rather
      // than reworded, because the reworded version ("show this note") would be
      // a worse app than the one the label described.
      tile.title = 'play this note back';
      tile.addEventListener('click', () => selectNote(d.played, null, { play: true }));
      // hovering a box lights up its span on the chart
      tile.addEventListener('mouseenter', () => currentChart?.setHighlight?.(d.played));
      tile.addEventListener('mouseleave', () => currentChart?.setHighlight?.(null));
    }
    rowFor.set(d, tile);
    grid.append(tile);
  }

  // Held long enough, or not: applied here and again whenever the picker moves.
  applyHeldFilter = () => {
    let shown = 0;
    for (const d of degrees) {
      const row = rowFor.get(d);
      if (!row) continue;
      const long = !d.played || (d.played.end - d.played.start) >= heldLeast;
      row.hidden = !long;
      if (long) shown += 1;
    }
    const summary = root.querySelector('#notes-summary');
    if (summary) {
      summary.textContent = heldLeast > 0 && shown !== degrees.length
        ? `${shown} of ${degrees.length} notes, held ${heldLeast}s or longer`
        : `${allNotes.length} notes`;
    }
  };
  wireHeldFilter(root);
  applyHeldFilter();

  // The chart is the centre of this screen and a canvas says nothing to a
  // screen reader, so it carries a summary of what it draws.
  const chartEl = root.querySelector('#pitch-chart');
  if (chartEl && allNotes.length) {
    // Named the way the chart is coloured, so the spoken summary and the
    // picture are the same three groups.
    const tally = { good: 0, sharp: 0, flat: 0 };
    for (const n of allNotes) tally[intonationHue(n.cents)]++;
    const span = allNotes.at(-1).end - allNotes[0].start;
    chartEl.setAttribute('role', 'img');
    chartEl.setAttribute('aria-label',
      `Pitch over ${Math.round(span)} seconds. ${allNotes.length} notes: `
      + `${tally.good} in tune, ${tally.sharp} sharp, ${tally.flat} flat. `
      + 'The note list above has each one.');
  }

  // Make the card visible BEFORE rendering the chart — a hidden container
  // measures 0 wide and the chart would fall back to a guessed width.
  report.classList.add('visible');

  if (extras.readings?.length && allNotes.length > 0) {
    showOverview(root, allNotes, recording, extras, selectNote, tileByNote);
    renderLanding(root, allNotes, extras.readings, extras.a4 ?? 440, {
      onPickNote: (note) => selectNote(note),
    });
    initPassages(root, allNotes, {
      recordingId: extras.recordingId ?? null,
      onPlaySpan: (from, to) => playSpan(root, from, to),
    });
  } else {
    root.querySelector('#playback').hidden = true;
    hideLanding(root);
    hidePassages(root);
  }
}

// Select one of the take's notes from another view. A no-op when no report is
// open, or when the note came from a take that is no longer on screen.
export function selectPlayedNote(note) {
  if (note) selectFromOutside?.(note);
}

export function hideReport(root) {
  selectFromOutside = null;
  stopPlayback(root);
  stopRefDrone();
  stopCompareDrones();
  clickGrid = null;
  root.querySelector('#report').classList.remove('visible');
  root.querySelector('#playback').hidden = true;
  hideLanding(root);
  hidePassages(root);
  root.querySelector('#note-zoom').hidden = true;
  chartWatch?.disconnect();
  chartWatch = null;
  currentChart = null;
  zoomChart = null;
  zoom = null;
  full = null;
  applyHeldFilter = null; // the tiles it hid have gone with the report
  cursorReadout = null; // the box it wrote into belongs to a closed report
  selectAtMoment = null; // …and so do the notes it would have looked through
  selectedNote = null;
}

// Free-play review: every detected note as a replayable tile, no expected
// scale to align against.
export function renderFreeReview(root, notes, recording, extras = {}) {
  // Chord notes complete on their own clock — order everything by onset.
  const ordered = [...notes].sort((a, b) => a.start - b.start);
  const degrees = ordered.map((n) => ({ midi: n.midi, name: n.name, played: n }));
  renderReport(root, { degrees, matched: ordered.length, missed: 0, tonic: null }, recording, extras);
}
