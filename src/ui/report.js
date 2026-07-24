import { tempoStats } from '../analysis/scoring.js';

const GOOD_CENTS = 8;
const OFF_CENTS = 25;

function degreeState(d) {
  if (!d.played) return 'missed';
  const c = Math.abs(d.played.cents);
  if (c < GOOD_CENTS) return 'good';
  if (c < OFF_CENTS) return 'off';
  return 'off';
}

// Playback of a single note from the session recording. Pad the start
// generously: note times come from analysis windows, which trail the
// actual audio onset slightly.
const START_PAD = 0.35;
const END_PAD = 0.15;

let playbackCtx = null;
let currentSource = null;

function playNote(root, tile, recording, note) {
  const segment = recording.extract(note.start - START_PAD, note.end + END_PAD);
  if (segment.length === 0) return;

  playbackCtx ??= new AudioContext();
  currentSource?.stop();

  const buffer = playbackCtx.createBuffer(1, segment.length, recording.sampleRate);
  buffer.copyToChannel(segment, 0);
  const source = playbackCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackCtx.destination);

  for (const el of root.querySelectorAll('.degree.playing')) el.classList.remove('playing');
  tile.classList.add('playing');
  source.onended = () => tile.classList.remove('playing');
  source.start();
  currentSource = source;
}

// Renders the post-scale intonation report from a bestAlignment() result.
// With a recording, each played tile becomes a button that replays that
// note from the session audio.
export function renderReport(root, alignment, recording = null) {
  const report = root.querySelector('#report');
  const grid = root.querySelector('#report-grid');
  const summary = root.querySelector('#report-summary');

  const { degrees, matched, missed, tonic } = alignment;

  grid.replaceChildren();
  for (const d of degrees) {
    const tile = document.createElement('div');
    tile.className = 'degree';
    tile.dataset.state = degreeState(d);
    const label = d.played
      ? `${d.played.cents >= 0 ? '+' : ''}${d.played.cents.toFixed(0)}¢`
      : 'missed';
    tile.innerHTML = `<b>${d.name}</b>${label}`;
    if (recording && d.played) {
      tile.classList.add('clickable');
      tile.title = 'play this note back';
      tile.addEventListener('click', () => playNote(root, tile, recording, d.played));
    }
    grid.append(tile);
  }

  const parts = [];
  if (tonic) parts.push(`from ${tonic}`);
  parts.push(`${matched}/${degrees.length} notes`);
  const onsets = degrees.filter((d) => d.played).map((d) => d.played.start);
  const tempo = tempoStats(onsets);
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
}

// Free-play review: every detected note as a replayable tile, no expected
// scale to align against.
export function renderFreeReview(root, notes, recording) {
  const degrees = notes.map((n) => ({ midi: n.midi, name: n.name, played: n }));
  renderReport(root, { degrees, matched: notes.length, missed: 0, tonic: null }, recording);
}
