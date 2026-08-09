// Bars you are working on, and what has happened to them since last time.
//
// Marking is two taps on the page — the first note of the passage and the last
// — because that is already how a passage is marked on the chart, and a bar
// range is what the score gives you that a waveform cannot.
//
// After that nothing has to be pressed again: every take of this piece records
// an attempt at every marked passage automatically. That is the whole point.
// A history you have to remember to save is a history you do not have.

import {
  passageAttempt, comparePassages, passageHistory,
} from '../analysis/score-passages.js';
import {
  saveScorePassage, listScorePassages, deleteScorePassage,
  saveScoreAttempt, listScoreAttempts,
} from '../store/db.js';

let context = null;   // { scoreId, aligned, timing, recordingId, onHighlight, onCompare }
let marking = null;   // { first } while waiting for the second tap
let comparison = null; // the passage being compared, if any

const el = (id) => document.querySelector(`#${id}`);

function setStatus(text) {
  const node = el('bars-status');
  if (node) node.textContent = text ?? '';
}

function barsLabel(from, to) {
  return from === to ? `bar ${from}` : `bars ${from}–${to}`;
}

function stopMarking() {
  marking = null;
  const btn = el('mark-bars');
  if (btn) btn.textContent = 'Mark bars to follow';
}

// Called before a notehead tap is treated as "play this note". Returns true
// when the tap was used for marking instead.
export function offerNotehead(attempt) {
  if (!marking || !attempt?.score) return false;
  const bar = attempt.score.measure;
  if (marking.first === null) {
    marking.first = bar;
    setStatus(`from bar ${bar} — now tap the LAST bar`);
    return true;
  }
  const from = Math.min(marking.first, bar);
  const to = Math.max(marking.first, bar);
  stopMarking();
  save(from, to);
  return true;
}

async function save(from, to) {
  if (!context) return;
  setStatus(`following ${barsLabel(from, to)}`);
  await saveScorePassage({
    scoreId: context.scoreId,
    name: barsLabel(from, to),
    fromMeasure: from,
    toMeasure: to,
  });
  // Record the take that is already on screen as the first attempt, so the
  // history starts with the playing that made you mark the bars.
  await recordAttempts();
  await render();
}

// Every marked passage gets an attempt from the current take. Called after each
// annotation, so practising is all it takes to build the history.
export async function recordAttempts() {
  if (!context?.aligned) return;
  const passages = await listScorePassages(context.scoreId);
  for (const passage of passages) {
    const stats = passageAttempt(
      context.aligned.attempts, context.timing, passage.fromMeasure, passage.toMeasure,
    );
    if (!stats) continue; // the take did not reach these bars
    const already = await listScoreAttempts(passage.id);
    // One attempt per take, not one per redraw: changing the tempo target or
    // reopening the tab re-runs the annotation, and each of those is not
    // another go at the passage.
    if (context.recordingId != null && already.some((a) => a.recordingId === context.recordingId)) continue;
    if (context.recordingId == null && already.some((a) => a.date === context.takeDate)) continue;
    await saveScoreAttempt({
      passageId: passage.id,
      recordingId: context.recordingId,
      stats,
      date: context.takeDate,
    });
  }
}

function sparkline(series) {
  if (series.length < 2) return '';
  const w = 68; const h = 20;
  const min = Math.min(...series); const max = Math.max(...series);
  const span = max - min || 1;
  const points = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((v - min) / span) * h; // lower cents sit higher: better is up
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

function deltaText(delta) {
  if (delta === null) return '<span class="delta none">first time</span>';
  if (Math.abs(delta) < 0.5) return '<span class="delta none">no change</span>';
  const better = delta < 0;
  return `<span class="delta ${better ? 'better' : 'worse'}">${better ? '▼' : '▲'} ${Math.abs(delta).toFixed(1)}¢ ${better ? 'better' : 'worse'}</span>`;
}

export async function render() {
  const list = el('score-passage-list');
  if (!list || !context) return;
  const passages = await listScorePassages(context.scoreId);
  list.replaceChildren();

  if (passages.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Mark the bars you are working on, and every take of this piece is measured against the last one.';
    list.append(hint);
    el('compare-last').hidden = true;
    return;
  }

  for (const passage of passages) {
    const attempts = await listScoreAttempts(passage.id);
    const history = passageHistory(attempts);
    const row = document.createElement('div');
    row.className = 'passage-row';
    row.innerHTML =
      `<button class="passage-name" type="button">${barsLabel(passage.fromMeasure, passage.toMeasure)}</button>` +
      `<span class="passage-count">${history.attempts.length} ${history.attempts.length === 1 ? 'take' : 'takes'}</span>` +
      sparkline(history.series) +
      `<span class="passage-now">${history.latest === null ? '—' : `${history.latest.toFixed(1)}¢`}</span>` +
      deltaText(history.sinceLast) +
      '<button class="passage-drop" type="button" aria-label="Stop following these bars">✕</button>';

    row.querySelector('.passage-name').addEventListener('click', () => {
      context.onHighlight?.(passage.fromMeasure, passage.toMeasure);
      setStatus(`${barsLabel(passage.fromMeasure, passage.toMeasure)}: best ${history.best?.toFixed(1) ?? '—'}¢, now ${history.latest?.toFixed(1) ?? '—'}¢`);
    });
    row.querySelector('.passage-drop').addEventListener('click', async () => {
      await deleteScorePassage(passage.id);
      setStatus(`stopped following ${barsLabel(passage.fromMeasure, passage.toMeasure)}`);
      await render();
    });
    list.append(row);
  }

  // Comparing needs something to compare with.
  const anyHistory = await Promise.all(passages.map((p) => listScoreAttempts(p.id)));
  el('compare-last').hidden = !anyHistory.some((a) => a.length > 1);
}

// The whole score recoloured by what has CHANGED since the previous take of it,
// rather than by how in tune it is now. Same page, different question.
export async function compareWithLast() {
  if (!context) return null;
  const passages = await listScorePassages(context.scoreId);
  const perNote = new Map();
  let better = 0; let worse = 0;
  for (const passage of passages) {
    const attempts = await listScoreAttempts(passage.id);
    if (attempts.length < 2) continue;
    const diff = comparePassages(attempts.at(-1).stats, attempts.at(-2).stats);
    if (!diff) continue;
    for (const note of diff.perNote) {
      perNote.set(note.scoreNoteId, note);
      if (note.verdict === 'better') better++;
      if (note.verdict === 'worse') worse++;
    }
  }
  if (perNote.size === 0) {
    setStatus('nothing to compare yet — play these bars again');
    return null;
  }
  comparison = perNote;
  setStatus(`since last time: ${better} better, ${worse} worse`);
  context.onCompare?.(perNote);
  return perNote;
}

export function clearComparison() {
  comparison = null;
  context?.onCompare?.(null);
}

export function comparing() {
  return comparison !== null;
}

export function initScorePassages(ctx) {
  context = ctx;
  comparison = null;
  const mark = el('mark-bars');
  const compare = el('compare-last');
  if (mark && !mark.dataset.wired) {
    mark.dataset.wired = '1';
    mark.addEventListener('click', () => {
      if (marking) { stopMarking(); setStatus(''); return; }
      marking = { first: null };
      mark.textContent = 'Cancel';
      setStatus('tap the FIRST bar of the passage');
    });
  }
  if (compare && !compare.dataset.wired) {
    compare.dataset.wired = '1';
    compare.addEventListener('click', () => {
      if (comparing()) { clearComparison(); compare.textContent = 'Compare with last time'; setStatus(''); return; }
      compareWithLast().then((got) => {
        if (got) compare.textContent = 'Back to this take';
      });
    });
  }
  setStatus('');
  // The attempt goes in BEFORE the list is drawn, or the list shows the history
  // as it stood before this take and the newest playing is missing from it
  // until something else happens to redraw.
  return recordAttempts().then(render);
}

export function resetScorePassages() {
  context = null;
  marking = null;
  comparison = null;
  el('score-passage-list')?.replaceChildren();
  setStatus('');
}
