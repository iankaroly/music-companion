import { tempoStats } from '../analysis/scoring.js';
import { buildEmphasizedClip, buildComparisonClip, findComparisonNote } from '../audio/clips.js';
import { timeStretch } from '../audio/stretch.js';
import { renderPitchChart } from './pitch-chart.js';

const GOOD_CENTS = 8;

let playbackCtx = null;
let currentSource = null;
let playbackSpeed = 1;
let replayCurrent = null;  // re-plays the active note (used by speed buttons)
let compareTimer = null;

function setPlaying(root, tile) {
  for (const el of root.querySelectorAll('.degree.playing')) el.classList.remove('playing');
  tile?.classList.add('playing');
}

// Slowdown is WSOLA time-stretch, so pitch and octave are preserved —
// only time expands. Playback rate stays 1.
function playClip(clip, tile, root) {
  playbackCtx ??= new AudioContext();
  if (currentSource) {
    currentSource.onended = null; // its ended-event must not wipe the new highlight
    currentSource.stop();
  }
  clearTimeout(compareTimer);

  const samples = playbackSpeed < 0.999
    ? timeStretch(clip.samples, clip.sampleRate, playbackSpeed)
    : clip.samples;

  const buffer = playbackCtx.createBuffer(1, samples.length, clip.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = playbackCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackCtx.destination);

  setPlaying(root, tile);
  source.onended = () => setPlaying(root, null);
  source.start();
  currentSource = source;
}

function centsLabel(cents) {
  return `${cents >= 0 ? '+' : ''}${cents.toFixed(0)}¢`;
}

function showPlayback(root, tile, note, name, allNotes, recording, extras, tileByNote) {
  const panel = root.querySelector('#playback');
  panel.hidden = false;

  root.querySelector('#playback-label').textContent =
    `${name} ${centsLabel(note.cents)} — surrounding notes ducked`;

  if (extras.readings?.length) {
    renderPitchChart(root.querySelector('#pitch-chart'), {
      readings: extras.readings,
      note,
      a4: extras.a4 ?? 440,
    });
  }

  const play = () => playClip(buildEmphasizedClip(recording, note.start, note.end), tile, root);
  replayCurrent = play;
  play();

  const compareBtn = root.querySelector('#compare');
  const ref = findComparisonNote(allNotes, note);
  if (ref) {
    compareBtn.hidden = false;
    compareBtn.textContent = `hear vs your other ${name} (${centsLabel(ref.cents)})`;
    compareBtn.onclick = () => {
      // Highlight follows the audio: the reference tile lights first, then
      // the clicked note when its turn comes.
      const clip = buildComparisonClip(recording, ref, note);
      playClip(clip, tileByNote.get(ref) ?? null, root);
      const handoffMs = ((clip.refDuration + clip.gapDuration) / playbackSpeed) * 1000;
      compareTimer = setTimeout(() => setPlaying(root, tile), handoffMs);
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
  return Math.abs(d.played.cents) < GOOD_CENTS ? 'good' : 'off';
}

// Renders the post-scale intonation report from a bestAlignment() result.
// With a recording, each played tile replays that moment — target note at
// full volume, neighbors ducked — with a pitch trace and a same-note
// comparison when the passage contains another rendition of that pitch.
export function renderReport(root, alignment, recording = null, extras = {}) {
  const report = root.querySelector('#report');
  const grid = root.querySelector('#report-grid');
  const summary = root.querySelector('#report-summary');

  const { degrees, matched, missed, tonic } = alignment;
  const allNotes = degrees.filter((d) => d.played).map((d) => d.played);

  root.querySelector('#playback').hidden = true;
  replayCurrent = null;
  wireSpeedButtons(root);

  const tileByNote = new Map();
  grid.replaceChildren();
  for (const d of degrees) {
    const tile = document.createElement('div');
    tile.className = 'degree';
    tile.dataset.state = degreeState(d);
    const label = d.played ? centsLabel(d.played.cents) : 'missed';
    tile.innerHTML = `<b>${d.name}</b>${label}`;
    if (recording && d.played) {
      tileByNote.set(d.played, tile);
      tile.classList.add('clickable');
      tile.title = 'play this note back';
      tile.addEventListener('click', () =>
        showPlayback(root, tile, d.played, d.name, allNotes, recording, extras, tileByNote));
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

  report.classList.add('visible');
}

export function hideReport(root) {
  root.querySelector('#report').classList.remove('visible');
  root.querySelector('#playback').hidden = true;
  replayCurrent = null;
  clearTimeout(compareTimer);
}

// Free-play review: every detected note as a replayable tile, no expected
// scale to align against.
export function renderFreeReview(root, notes, recording, extras = {}) {
  const degrees = notes.map((n) => ({ midi: n.midi, name: n.name, played: n }));
  renderReport(root, { degrees, matched: notes.length, missed: 0, tonic: null }, recording, extras);
}
