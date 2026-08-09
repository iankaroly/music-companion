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
  // If the take on screen has already been saved, it counts straight away —
  // marking bars after saving a good run should not throw that run away.
  await recordAttempts(context.recordingId);
  await render();
}

// This take's stats for one passage, computed rather than read back — the take
// on screen has not necessarily been saved.
function statsFor(passage) {
  if (!context?.aligned) return null;
  return passageAttempt(
    context.aligned.attempts, context.timing, passage.fromMeasure, passage.toMeasure,
    { targetBpm: context.timing?.targetBpm ?? null },
  );
}

// An attempt is written when a take is SAVED, never when it is merely recorded.
//
// Annotating happens on every take, including the ones you listen back to and
// throw away — and a run-through you discarded is exactly the one that should
// not drag the trend line around. Saving is where a take becomes something you
// meant to keep, so saving is where it joins the history. It also means the
// recordingId is real, which makes the guard below the only one needed:
// re-opening the take or changing the tempo target must not count as another go
// at the passage.
export async function recordAttempts(recordingId) {
  if (!context?.aligned || recordingId == null) return;
  const passages = await listScorePassages(context.scoreId);
  for (const passage of passages) {
    const stats = statsFor(passage);
    if (!stats) continue; // the take did not reach these bars
    const already = await listScoreAttempts(passage.id);
    if (already.some((a) => a.recordingId === recordingId)) continue;
    await saveScoreAttempt({
      passageId: passage.id,
      recordingId,
      stats,
      date: context.takeDate,
    });
  }
  await render();
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

  // Comparing needs an earlier saved take to compare THIS one with.
  const anyHistory = await Promise.all(passages.map((p) => listScoreAttempts(p.id)));
  el('compare-last').hidden = !anyHistory
    .some((list) => list.some((a) => a.recordingId !== context.recordingId));
}

// The whole score recoloured by what has CHANGED since the last time, rather
// than by how in tune it is now. Same page, different question.
//
// "Last time" means the newest SAVED attempt that is not this take, and "now"
// is the take on screen — computed, not read back, because the take you are
// looking at may never have been saved. Comparing the two newest stored rows
// instead would answer a question nobody asked: how the last two saved takes
// differed, while a third one sits unexamined on the screen.
export async function compareWithLast() {
  if (!context) return null;
  const passages = await listScorePassages(context.scoreId);
  const perNote = new Map();
  let better = 0; let worse = 0;
  for (const passage of passages) {
    const now = statsFor(passage);
    if (!now) continue;
    const attempts = await listScoreAttempts(passage.id);
    const previous = attempts.filter((a) => a.recordingId !== context.recordingId).at(-1);
    if (!previous) continue;
    const diff = comparePassages(now, previous.stats);
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
  return render();
}

export function resetScorePassages() {
  context = null;
  marking = null;
  comparison = null;
  el('score-passage-list')?.replaceChildren();
  setStatus('');
}
