import { audioContext, masterOut, holdAudio, releaseAudio, warmAudio } from '../audio/context.js';
import { findComparisonNote, findSameNotes } from '../audio/clips.js';
import { timeStretch } from '../audio/stretch.js';
import { renderOverviewChart, renderNoteChart } from './pitch-chart.js';
import { intonationStatus, findNoteAt } from './chart-utils.js';
import { midiToName } from '../analysis/note-utils.js';
import { toggleMenu } from './controls.js';
import { renderTiming, hideTiming } from './timing.js';
import { renderLanding, hideLanding } from './landing.js';
import { initPassages, hidePassages, offerNote } from './passages.js';
import { scheduleClick } from '../audio/metronome.js';

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
let zoomChart = null;       // the per-note inset below it

// Set by whichever note is open, read by the playback tick: what to write in
// the note box for a given moment of the recording.
let cursorReadout = null;

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
    say(root, `couldn't play that much at once — ${err.message}`);
    return null;
  }
  const source = playbackCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(masterOut());

  const startTime = playbackCtx.currentTime;
  const tick = () => {
    if (source !== currentSource) return;
    const recTime = timeMap((playbackCtx.currentTime - startTime) * playbackSpeed);
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
    animationFrame = requestAnimationFrame(tick);
  };
  source.onended = () => { stopPlayback(root); onDone?.(); };
  source.start();
  currentSource = source;
  scheduleClickTrack(startTime, timeMap(0), (samples.length / clip.sampleRate) * playbackSpeed);
  tick();
  return startTime;
}

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

  // Dragging the overview cursor (or tapping the chart) steers everything:
  // the whole-take play position, which note the zoom inset shows, and the
  // pitch any held drone follows.
  const overviewSeek = (t, phase) => {
    if (phase === 'start' || phase === 'tap') {
      if (full?.playing) pauseFull(root);
      else if (zoom?.playing) pauseZoom(root);
    }
    if (full) full.pos = Math.max(0, t);
    const n = findNoteAt(allNotes, t);
    if (n && n !== selectedNote) {
      selectNote(n, t);
    } else if (zoom) {
      zoom.pos = Math.max(zoom.t0, Math.min(zoom.t1, t));
      zoom.retune?.();
    }
    setPlayheads(t);
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

  // the cursor knob starts at the beginning of the take
  if (full) {
    full.pos = Math.max(0, currentChart.range?.t0 ?? 0);
    currentChart.setPlayhead(full.pos);
  }
}

// Selecting a note opens its cents-level detail in the zoom inset below —
// nothing plays until the zoom's own play button is pressed. `atTime`
// places the zoom cursor (used when the overview cursor drags in).
function showPlayback(root, tile, note, name, allNotes, recording, extras, tileByNote, atTime = null) {
  root.querySelector('#playback').hidden = false;
  selectedNote = note;

  // The selected note as a box: name, cents, chord marker, status color.
  const selected = root.querySelector('#selected-note');
  selected.hidden = false;
  selected.className = note.chord ? 'degree chord' : 'degree';
  selected.dataset.state = intonationStatus(note.cents);
  selected.innerHTML = `<b>${note.chord ? '+' : ''}${name}</b>${centsLabel(note.cents)}${note.chord ? ' · chord' : ''}`;

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
    selected.dataset.state = intonationStatus(cents);
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
    root.querySelector('#zoom-label').textContent = `${name} up close`;
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
  return intonationStatus(d.played.cents);
}

// Renders the intonation report from a bestAlignment() result. The full-
// session pitch trace appears immediately; clicking a played tile zooms
// the chart to that note and replays it (target at full volume, neighbors
// ducked) with a playhead sweeping in sync with the audio.
export function renderReport(root, alignment, recording = null, extras = {}) {
  const report = root.querySelector('#report');
  const grid = root.querySelector('#report-grid');

  const { degrees } = alignment;
  const allNotes = degrees.filter((d) => d.played).map((d) => d.played);

  // renderTiming re-renders its button switched off, so the grid it was
  // playing has to go with it — saving a take re-renders the review without
  // going through hideReport, which would otherwise leave clicks armed under
  // a button that says they aren't.
  clickGrid = null;

  wireSpeedButtons(root);

  const tileByNote = new Map();
  const selectNote = (note, atTime = null) => {
    const entry = tileByNote.get(note);
    if (!entry) return;
    // While a passage is being marked, taps name its bounds instead of playing.
    if (offerNote(note)) {
      currentChart?.setHighlight?.(note);
      return;
    }
    currentChart?.setHighlight?.(note);
    showPlayback(root, entry.tile, note, entry.name, allNotes, recording, extras, tileByNote, atTime);
  };

  // Spoken form of a tile, for anyone who isn't looking at the colour.
  const spoken = (d) => {
    if (!d.played) return `${d.name}, missed`;
    const cents = Math.round(d.played.cents);
    const how = cents === 0 ? 'exactly in tune'
      : `${Math.abs(cents)} cents ${cents > 0 ? 'sharp' : 'flat'}`;
    const tier = { good: 'in tune', off: 'slightly off', bad: 'badly off' }[degreeState(d)];
    return `${d.name}, ${how}, ${tier}${d.played.chord ? ', chord note' : ''}`;
  };

  grid.replaceChildren();
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
      tile.title = 'play this note back';
      tile.addEventListener('click', () => selectNote(d.played));
      // hovering a box lights up its span on the chart
      tile.addEventListener('mouseenter', () => currentChart?.setHighlight?.(d.played));
      tile.addEventListener('mouseleave', () => currentChart?.setHighlight?.(null));
    }
    grid.append(tile);
  }

  root.querySelector('#notes-summary').textContent =
    `${allNotes.length} notes — expand to browse`;

  // The chart is the centre of this screen and a canvas says nothing to a
  // screen reader, so it carries a summary of what it draws.
  const chartEl = root.querySelector('#pitch-chart');
  if (chartEl && allNotes.length) {
    const tally = { good: 0, off: 0, bad: 0 };
    for (const n of allNotes) tally[intonationStatus(n.cents)]++;
    const span = allNotes.at(-1).end - allNotes[0].start;
    chartEl.setAttribute('role', 'img');
    chartEl.setAttribute('aria-label',
      `Pitch over ${Math.round(span)} seconds. ${allNotes.length} notes: `
      + `${tally.good} in tune, ${tally.off} slightly off, ${tally.bad} badly off. `
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
    renderTiming(root, allNotes, {
      onPickNote: (note) => selectNote(note),
      onClickTrack: recording ? (grid) => {
        clickGrid = grid;
        // Toggled mid-playback, it takes effect at once rather than at the
        // next press — the point is to A/B the click against what you played.
        if (full?.playing) {
          pauseFull(root); // updates full.pos to where the audio actually is
          playFullFrom(root, full.pos);
        } else {
          stopClicks();
        }
      } : null,
    });
    initPassages(root, allNotes, {
      recordingId: extras.recordingId ?? null,
      onPlaySpan: (from, to) => playSpan(root, from, to),
    });
  } else {
    root.querySelector('#playback').hidden = true;
    hideLanding(root);
    hideTiming(root);
    hidePassages(root);
  }
}

export function hideReport(root) {
  stopPlayback(root);
  stopRefDrone();
  stopCompareDrones();
  clickGrid = null;
  root.querySelector('#report').classList.remove('visible');
  root.querySelector('#playback').hidden = true;
  hideLanding(root);
  hideTiming(root);
  hidePassages(root);
  root.querySelector('#note-zoom').hidden = true;
  currentChart = null;
  zoomChart = null;
  zoom = null;
  full = null;
  cursorReadout = null; // the box it wrote into belongs to a closed report
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
