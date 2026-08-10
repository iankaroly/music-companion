// The landing section of a take's report: how each note arrived.
//
// Deliberately not a chart. The finding here is a habit — "your shifts speak
// flat and take a fifth of a second to come up" — and a habit is a sentence
// plus a handful of bars, not a trace to read. The per-note evidence is behind
// the chips, which play the note so you can hear what the number means.

import { landingReport } from '../analysis/landing.js';
import { intonationTolerance } from './chart-utils.js';
import { instrument } from '../analysis/instruments.js';

function clock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function tierOf(share) {
  return share >= 0.8 ? 'good' : share >= 0.55 ? 'mixed' : 'poor';
}

// The whole panel in one sentence, because that's what gets read.
function summarise(report) {
  const pct = Math.round(report.cleanShare * 100);
  const bits = [`${pct}% of your notes were in tune the moment they spoke.`];

  if (report.counts.settled > 0) {
    const ms = Math.round((report.medianSettleMs ?? 0) / 10) * 10;
    bits.push(`Another ${report.counts.settled} came in off and were corrected,`
      + ` taking about ${ms} ms to settle.`);
  }
  if (report.counts.unsettled > 0) {
    bits.push(`${report.counts.unsettled} never settled.`);
  }
  if (report.approachBias) {
    bits.push(`When you miss, you miss ${report.approachBias} —`
      + ' a consistent direction, which means you can aim off it.');
  }
  // The one actionable line: which reach you land worst.
  const weak = report.byBand.length > 1
    ? [...report.byBand].sort((a, b) => a.cleanShare - b.cleanShare)[0]
    : null;
  if (weak && weak.cleanShare < 0.75) {
    bits.push(`Weakest by reach: ${weak.plural}, ${Math.round(weak.cleanShare * 100)}% clean.`);
  }
  return bits.join(' ');
}

export function renderLanding(root, notes, readings, a4, { onPickNote } = {}) {
  const section = root.querySelector('#landing');
  if (!section) return null;

  const report = landingReport(notes, readings, a4,
    { tolerance: intonationTolerance(), motion: instrument().motion });
  if (!report) {
    section.hidden = true;
    return null;
  }
  section.hidden = false;

  const verdict = root.querySelector('#landing-verdict');
  const tier = tierOf(report.cleanShare);
  verdict.textContent = tier === 'good' ? 'clean' : tier === 'mixed' ? 'mixed' : 'scooping';
  verdict.dataset.verdict = tier === 'good' ? 'clean' : tier === 'mixed' ? 'mixed' : 'scooping';

  root.querySelector('#landing-summary').textContent = summarise(report);

  const bars = root.querySelector('#landing-bars');
  bars.replaceChildren();
  for (const band of report.byBand) {
    const row = document.createElement('div');
    row.className = 'ld-row';
    const name = document.createElement('span');
    name.className = 'ld-name';
    name.textContent = band.label;
    const track = document.createElement('span');
    track.className = 'ld-track';
    const fill = document.createElement('span');
    fill.className = 'ld-fill';
    fill.dataset.tier = tierOf(band.cleanShare);
    fill.style.width = `${Math.max(2, band.cleanShare * 100)}%`;
    track.append(fill);
    const val = document.createElement('span');
    val.className = 'ld-val';
    const onset = Math.round(band.medianOnsetCents);
    val.textContent = `${Math.round(band.cleanShare * 100)}% · ${onset >= 0 ? '+' : ''}${onset}¢`;
    val.title = `${band.count} notes · median arrival ${onset >= 0 ? '+' : ''}${onset} cents`;
    row.append(name, track, val);
    bars.append(row);
  }

  // Every note that never found the centre, behind a summary you have to open.
  // All of them, because a shortlist of six in a take with forty is a shortlist
  // of the wrong thing — but folded away, because forty chips unrolled under
  // the bars is a wall nobody reads.
  const worst = root.querySelector('#landing-worst');
  worst.replaceChildren();
  const unsettled = report.unsettled ?? [];
  if (unsettled.length) {
    const box = document.createElement('details');
    box.className = 'ld-list';
    const summary = document.createElement('summary');
    summary.textContent = `${unsettled.length} ${unsettled.length === 1 ? 'note' : 'notes'} never settled — tap one to hear it`;
    box.append(summary);
    const chips = document.createElement('div');
    chips.className = 'ld-chips';
    for (const row of unsettled) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `ld-chip ${row.approach}`;
      const onset = Math.round(row.onsetCents);
      // The same note is usually flubbed the same way more than once in a take,
      // so the clock time is what tells two otherwise identical chips apart.
      chip.textContent = `${row.name} ${clock(row.start)} · in ${onset >= 0 ? '+' : ''}${onset}¢`;
      chip.addEventListener('click', () => onPickNote?.(row.note));
      chips.append(chip);
    }
    box.append(chips);
    worst.append(box);
  }

  const hint = root.querySelector('#landing-hint');
  if (hint) {
    hint.textContent = 'How each note arrived, before you corrected it — the part a'
      + ' sustained reading can\'t show. Timing is measured to about a twentieth of a'
      + ' second, so read these as bands rather than stopwatch figures.';
  }
  return report;
}

export function hideLanding(root) {
  const section = root.querySelector('#landing');
  if (section) section.hidden = true;
}
