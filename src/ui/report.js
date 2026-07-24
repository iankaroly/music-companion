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

// Renders the post-scale intonation report from a bestAlignment() result.
export function renderReport(root, alignment) {
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
    grid.append(tile);
  }

  const parts = [`from ${tonic}`, `${matched}/${degrees.length} notes`];
  const onsets = degrees.filter((d) => d.played).map((d) => d.played.start);
  const tempo = tempoStats(onsets);
  if (tempo) {
    parts.push(`≈${tempo.bpm.toFixed(0)} notes/min`);
    parts.push(`evenness ${(tempo.evenness * 100).toFixed(0)}%`);
    parts.push(tempo.drift < -0.08 ? 'rushing' : tempo.drift > 0.08 ? 'dragging' : 'steady tempo');
  }
  if (missed > 0) parts.push(`${missed} missed`);
  summary.textContent = parts.join(' · ');

  report.classList.add('visible');
}

export function hideReport(root) {
  root.querySelector('#report').classList.remove('visible');
}
