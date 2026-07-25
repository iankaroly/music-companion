import { tempoStats } from '../analysis/scoring.js';
import { audioContext, masterOut } from '../audio/context.js';
import { buildEmphasizedClip, buildComparisonClip, findComparisonNote } from '../audio/clips.js';
import { timeStretch } from '../audio/stretch.js';
import { renderOverviewChart, renderNoteChart } from './pitch-chart.js';
import { intonationStatus } from './chart-utils.js';

const GOOD_CENTS = 8;
const CONTEXT_SEC = 1.2;
const PAD_SEC = 0.06;
const GAP_SEC = 0.35;

let playbackCtx = null;
let currentSource = null;
let playbackSpeed = 1;
let replayCurrent = null;   // re-plays the active note (used by speed buttons)
let currentChart = null;    // the overview chart
let zoomChart = null;       // the per-note inset below it

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
}

// "Hold as drone": not a loop of the recording — a steady synthesized tone
// at the exact pitch center the player produced (including its cents
// error), so it can be held indefinitely and beaten against the reference.
function startNoteDrone(frequency, btn, tile) {
  stopNoteDrone();
  noteDrone = { ...makeOsc(frequency, 0.3), btn, tile };
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

function startRefDrone(frequency, btn) {
  stopRefDrone();
  refDrone = { ...makeOsc(frequency, 0.26), btn };
  btn.classList.add('active');
}

function stopRefDrone() {
  if (!refDrone) return;
  fadeOutOsc(refDrone);
  refDrone.btn.classList.remove('active');
  refDrone = null;
}

function stopPlayback(root) {
  if (currentSource) {
    currentSource.onended = null;
    currentSource.stop();
    currentSource = null;
  }
  cancelAnimationFrame(animationFrame);
  setPlayheads(null);
  stopNoteDrone();
  for (const el of root.querySelectorAll('.degree.playing')) el.classList.remove('playing');
  if (zoom) zoom.playing = false;
  updateZoomButton(root);
}

// Plays a clip with a live playhead on both charts. `timeMap` converts
// clip-audio seconds to recording time (null = inside a silence gap), and
// `spans` are tiles that light up exactly while their note is sounding.
// Returns the audio-clock start time (used for pause bookkeeping).
function playClip(clip, root, timeMap, spans, onDone) {
  playbackCtx = audioContext();
  stopPlayback(root);

  const samples = playbackSpeed < 0.999
    ? timeStretch(clip.samples, clip.sampleRate, playbackSpeed)
    : clip.samples.slice(0);

  // Phone recordings are quiet — normalize each clip's peak toward full
  // scale (gain capped so the noise floor of near-silence isn't blasted).
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0.0001 && peak < 0.85) {
    const boost = Math.min(0.85 / peak, 8);
    for (let i = 0; i < samples.length; i++) samples[i] *= boost;
  }

  const buffer = playbackCtx.createBuffer(1, samples.length, clip.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = playbackCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(masterOut());

  const startTime = playbackCtx.currentTime;
  const tick = () => {
    if (source !== currentSource) return;
    const recTime = timeMap((playbackCtx.currentTime - startTime) * playbackSpeed);
    setPlayheads(recTime);
    for (const s of spans) {
      s.tile?.classList.toggle('playing', recTime !== null && recTime >= s.start && recTime <= s.end);
    }
    animationFrame = requestAnimationFrame(tick);
  };
  source.onended = () => { stopPlayback(root); onDone?.(); };
  source.start();
  currentSource = source;
  tick();
  return startTime;
}

// --- zoom section player: play/pause and a draggable playhead --------------

let zoom = null; // { recording, t0, t1, pos, playing, wasPlaying, tile, note, playInfo }

function updateZoomButton(root) {
  const btn = root.querySelector('#zoom-play');
  if (btn) btn.textContent = zoom?.playing ? '❚❚' : '▶';
}

function playZoomFrom(root, from) {
  if (!zoom) return;
  const clip = {
    samples: zoom.recording.extract(from, zoom.t1),
    sampleRate: zoom.recording.sampleRate,
  };
  // playClip stops any previous playback first, which resets the playing
  // flag — so mark this zoom as playing only after it starts.
  const startTime = playClip(
    clip, root,
    (t) => from + t,
    [{ tile: zoom.tile, start: zoom.note.start, end: zoom.note.end }],
    () => { if (zoom) { zoom.playing = false; zoom.pos = zoom.t0; } updateZoomButton(root); },
  );
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
  stopPlayback(root);
  setPlayheads(zoom.pos); // keep the marker where playback stopped
  updateZoomButton(root);
}

function centsLabel(cents) {
  return `${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢`;
}

function showOverview(root, allNotes, extras, selectNote, tileByNote) {
  stopPlayback(root);
  root.querySelector('#playback').hidden = false;
  root.querySelector('#playback-label').textContent =
    'click any note on the graph (or a box) to hear it';
  root.querySelector('#selected-note').hidden = true;
  root.querySelector('#compare').hidden = true;
  root.querySelector('#note-drone').hidden = true;
  root.querySelector('#ref-drone').hidden = true;
  root.querySelector('#ref-octave').hidden = true;
  root.querySelector('#ref-interval').hidden = true;
  root.querySelector('#note-zoom').hidden = true;
  zoomChart = null;
  zoom = null;
  replayCurrent = null;
  currentChart = renderOverviewChart(root.querySelector('#pitch-chart'), {
    readings: extras.readings,
    notes: allNotes,
    a4: extras.a4 ?? 440,
    onNoteClick: selectNote,
    onNoteHover: (note) => {
      for (const { tile } of tileByNote.values()) tile.classList.remove('peek');
      if (note) tileByNote.get(note)?.tile.classList.add('peek');
    },
  });
}

// Selecting a note plays it right on the overview — the playhead sweeps
// both charts — and its cents-level detail opens in a zoom inset below,
// replaced whenever a different note is picked.
function showPlayback(root, tile, note, name, allNotes, recording, extras, tileByNote) {
  root.querySelector('#playback').hidden = false;

  // The selected note as a box: name, cents, chord marker, status color.
  const selected = root.querySelector('#selected-note');
  selected.hidden = false;
  selected.className = note.chord ? 'degree chord' : 'degree';
  selected.dataset.state = intonationStatus(note.cents);
  selected.innerHTML = `<b>${note.chord ? '+' : ''}${name}</b>${centsLabel(note.cents)}${note.chord ? ' · chord' : ''}`;

  root.querySelector('#playback-label').textContent = 'surrounding notes ducked';

  if (extras.readings?.length) {
    root.querySelector('#note-zoom').hidden = false;
    root.querySelector('#zoom-label').textContent = `${name} up close`;
    zoom = {
      recording,
      t0: Math.max(0, note.start - CONTEXT_SEC),
      t1: Math.min(recording.duration, note.end + CONTEXT_SEC),
      pos: Math.max(0, note.start - CONTEXT_SEC),
      playing: false,
      wasPlaying: false,
      tile,
      note,
      playInfo: null,
    };
    updateZoomButton(root);
    root.querySelector('#zoom-play').onclick = () => {
      if (zoom.playing) pauseZoom(root);
      else playZoomFrom(root, zoom.pos);
    };
    zoomChart = renderNoteChart(root.querySelector('#note-chart'), {
      readings: extras.readings,
      note,
      a4: extras.a4 ?? 440,
      contextSec: CONTEXT_SEC,
      onSeek: (t, phase) => {
        if (phase === 'start') {
          zoom.wasPlaying = zoom.playing;
          if (zoom.playing) pauseZoom(root);
        }
        zoom.pos = t;
        setPlayheads(t);
        if (phase === 'end' && zoom.wasPlaying) playZoomFrom(root, t);
      },
    });
  }

  const play = () => {
    const clip = buildEmphasizedClip(recording, note.start, note.end, { contextSec: CONTEXT_SEC });
    const clipStart = Math.max(0, note.start - CONTEXT_SEC);
    playClip(clip, root, (t) => clipStart + t, [{ tile, start: note.start, end: note.end }]);
  };
  replayCurrent = play;
  play();

  // Hold the note as a drone, and layer an in-tune reference over it.
  const noteDroneBtn = root.querySelector('#note-drone');
  const refBtn = root.querySelector('#ref-drone');
  const refOct = root.querySelector('#ref-octave');
  const refInterval = root.querySelector('#ref-interval');
  noteDroneBtn.hidden = false;
  refBtn.hidden = false;
  refOct.hidden = false;
  refInterval.hidden = false;
  stopRefDrone();
  stopNoteDrone();
  refBtn.textContent = `+ in-tune ${name} drone`;

  const a4 = extras.a4 ?? 440;
  const playedFrequency = a4 * 2 ** ((note.midi + note.cents / 100 - 69) / 12);
  noteDroneBtn.onclick = () => {
    if (noteDrone) {
      stopNoteDrone();
    } else {
      if (currentSource) stopPlayback(root); // a held pitch replaces any replay
      startNoteDrone(playedFrequency, noteDroneBtn, tile);
    }
  };

  // Fifths are pure (3:2), not equal-tempered — a correctly played note
  // locks beat-free against a pure fifth, the same way open strings are
  // tuned. Unison stays equal-tempered (it IS the reference pitch).
  const INTERVAL_RATIOS = { unison: 1, 'fifth-up': 3 / 2, 'fifth-down': 2 / 3 };
  const refFrequency = () =>
    a4 * 2 ** ((note.midi + Number(refOct.value) * 12 - 69) / 12) *
    INTERVAL_RATIOS[refInterval.value];
  refBtn.onclick = () => {
    if (refDrone) stopRefDrone();
    else startRefDrone(refFrequency(), refBtn);
  };
  const retune = () => {
    if (refDrone) refDrone.osc.frequency.setTargetAtTime(refFrequency(), playbackCtx.currentTime, 0.02);
  };
  refOct.onchange = retune;
  refInterval.onchange = retune;

  const compareBtn = root.querySelector('#compare');
  const ref = findComparisonNote(allNotes, note);
  if (ref) {
    compareBtn.hidden = false;
    compareBtn.textContent = `hear vs your other ${name} (${centsLabel(ref.cents)})`;
    compareBtn.onclick = () => {
      const clip = buildComparisonClip(recording, ref, note, { padSec: PAD_SEC, gapSec: GAP_SEC });
      const refStart = ref.start - PAD_SEC;
      const targetStart = note.start - PAD_SEC;
      const timeMap = (t) => {
        if (t <= clip.refDuration) return refStart + t;
        if (t <= clip.refDuration + clip.gapDuration) return null;
        return targetStart + (t - clip.refDuration - clip.gapDuration);
      };
      playClip(clip, root, timeMap, [
        { tile: tileByNote.get(ref)?.tile, start: ref.start, end: ref.end },
        { tile, start: note.start, end: note.end },
      ]);
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
      replayCurrent?.();
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
  const summary = root.querySelector('#report-summary');

  const { degrees, matched, missed, tonic } = alignment;
  const allNotes = degrees.filter((d) => d.played).map((d) => d.played);

  replayCurrent = null;
  wireSpeedButtons(root);

  const tileByNote = new Map();
  const selectNote = (note) => {
    const entry = tileByNote.get(note);
    if (!entry) return;
    currentChart?.setHighlight?.(note);
    showPlayback(root, entry.tile, note, entry.name, allNotes, recording, extras, tileByNote);
  };

  grid.replaceChildren();
  for (const d of degrees) {
    const tile = document.createElement('div');
    tile.className = d.played?.chord ? 'degree chord' : 'degree';
    tile.dataset.state = degreeState(d);
    const label = d.played ? centsLabel(d.played.cents) : 'missed';
    tile.innerHTML = `<b>${d.played?.chord ? '+' : ''}${d.name}</b>${label}`;
    if (recording && d.played) {
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

  const parts = [];
  if (tonic) parts.push(`from ${tonic}`);
  parts.push(`${matched}/${degrees.length} notes`);
  const tempo = tempoStats(allNotes.map((n) => n.start));
  if (tempo) {
    parts.push(`≈${tempo.bpm.toFixed(0)} notes/min`);
    parts.push(`evenness ${(tempo.evenness * 100).toFixed(0)}%`);
    parts.push(tempo.drift < -0.08 ? 'rushing' : tempo.drift > 0.08 ? 'dragging' : 'steady tempo');
  }
  if (missed > 0) parts.push(`${missed} missed`);
  if (recording) parts.push('click a note to hear it');
  summary.textContent = parts.join(' · ');
  root.querySelector('#notes-summary').textContent =
    `${allNotes.length} notes — expand to browse`;

  // Make the card visible BEFORE rendering the chart — a hidden container
  // measures 0 wide and the chart would fall back to a guessed width.
  report.classList.add('visible');

  if (extras.readings?.length && allNotes.length > 0) {
    showOverview(root, allNotes, extras, selectNote, tileByNote);
  } else {
    root.querySelector('#playback').hidden = true;
  }
}

export function hideReport(root) {
  stopPlayback(root);
  stopRefDrone();
  root.querySelector('#report').classList.remove('visible');
  root.querySelector('#playback').hidden = true;
  root.querySelector('#note-zoom').hidden = true;
  replayCurrent = null;
  currentChart = null;
  zoomChart = null;
  zoom = null;
}

// Free-play review: every detected note as a replayable tile, no expected
// scale to align against.
export function renderFreeReview(root, notes, recording, extras = {}) {
  // Chord notes complete on their own clock — order everything by onset.
  const ordered = [...notes].sort((a, b) => a.start - b.start);
  const degrees = ordered.map((n) => ({ midi: n.midi, name: n.name, played: n }));
  renderReport(root, { degrees, matched: ordered.length, missed: 0, tonic: null }, recording, extras);
}
