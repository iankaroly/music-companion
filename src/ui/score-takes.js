// Every take of this piece, and whether today is better than last time.
//
// The takes are ordinary library recordings — they are saved, renamed, played
// and deleted exactly like any other. What makes them a history is the score
// they were played from: a take carries its scoreId and a small per-note
// summary, so two takes of the same piece line up note for note without anyone
// naming or marking anything.
//
// Only SAVED takes appear. A run-through you listened back to and discarded is
// exactly the one that should not drag the trend around.

import { compareTakes, takeHistory } from '../analysis/score-history.js';
import { listRecordingsForScore } from '../store/db.js';

let context = null;    // { scoreId, stats, recordingId, onCompare, onOpenTake }
let comparison = null;

const el = (id) => document.querySelector(`#${id}`);

function setStatus(text) {
  const node = el('bars-status');
  if (node) node.textContent = text ?? '';
}

const takeLabel = (take) => (take.name ? take.name : when(take.date));

function when(date) {
  const d = new Date(date);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function sparkline(series) {
  if (series.length < 2) return '';
  const w = 68; const h = 20;
  const min = Math.min(...series); const max = Math.max(...series);
  const span = max - min || 1;
  const points = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((v - min) / span) * h; // fewer cents sits higher: better is up
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

function deltaText(delta) {
  if (delta === null) return '<span class="delta none">first take</span>';
  if (Math.abs(delta) < 0.5) return '<span class="delta none">no change</span>';
  const better = delta < 0;
  return `<span class="delta ${better ? 'better' : 'worse'}">${better ? '▼' : '▲'} ${Math.abs(delta).toFixed(1)}¢ ${better ? 'better' : 'worse'}</span>`;
}

// The newest saved take that is not the one on screen — what "last time" means.
async function previousTake() {
  if (!context) return null;
  const takes = await listRecordingsForScore(context.scoreId);
  return takes.filter((t) => t.id !== context.recordingId && t.scoreStats).at(-1) ?? null;
}

export async function render() {
  const list = el('score-take-list');
  if (!list || !context) return;
  const takes = await listRecordingsForScore(context.scoreId);
  const history = takeHistory(takes.map((t) => ({ ...t, scoreStats: t.scoreStats })));
  list.replaceChildren();

  const head = document.createElement('div');
  head.className = 'takes-head';
  if (history.takes.length === 0) {
    head.innerHTML = '<span class="hint">Save a take and it joins this piece\'s history. The next one is measured against it.</span>';
  } else {
    head.innerHTML =
      `<b>${history.takes.length} saved ${history.takes.length === 1 ? 'take' : 'takes'}</b>` +
      sparkline(history.series) +
      `<span class="passage-now">now ${history.latest.toFixed(1)}¢</span>` +
      `<span class="passage-count">best ${history.best.toFixed(1)}¢</span>` +
      deltaText(history.sinceLast);
  }
  list.append(head);

  // Newest first: the one you just played is the one you want to see.
  for (const take of [...history.takes].reverse()) {
    const row = document.createElement('div');
    row.className = 'passage-row';
    const isCurrent = take.id === context.recordingId;
    row.innerHTML =
      `<button class="passage-name" type="button">${takeLabel(take)}</button>` +
      `<span class="passage-count">${take.scoreStats.played} notes${isCurrent ? ' · this take' : ''}</span>` +
      `<span class="passage-now">${take.scoreStats.absMeanCents.toFixed(1)}¢</span>` +
      (take.scoreStats.targetBpm ? `<span class="passage-count">at ${take.scoreStats.targetBpm}</span>` : '');
    row.querySelector('.passage-name').addEventListener('click', () => context.onOpenTake?.(take));
    list.append(row);
  }

  const previous = await previousTake();
  el('compare-last').hidden = !(previous && context.stats);
}

// The page recoloured by what CHANGED since the last saved take, rather than by
// how in tune this one is. Same page, different question.
export async function compareWithLast() {
  if (!context?.stats) return null;
  const previous = await previousTake();
  if (!previous) {
    setStatus('nothing to compare with yet — save another take of this piece');
    return null;
  }
  const diff = compareTakes(context.stats, previous.scoreStats);
  if (!diff || diff.perNote.length === 0) {
    setStatus('no notes in common with the last take');
    return null;
  }
  comparison = new Map(diff.perNote.map((n) => [n.scoreNoteId, n]));
  const overall = diff.centsDelta;
  setStatus(`against ${takeLabel(previous)}: ${diff.better} better, ${diff.worse} worse`
    + (Math.abs(overall) < 0.5 ? '' : `, ${Math.abs(overall).toFixed(1)}¢ ${overall < 0 ? 'closer' : 'further'} overall`));
  context.onCompare?.(comparison);
  return comparison;
}

export function clearComparison() {
  comparison = null;
  context?.onCompare?.(null);
}

export function comparing() {
  return comparison !== null;
}

export function initScoreTakes(ctx) {
  context = ctx;
  comparison = null;
  const compare = el('compare-last');
  if (compare) {
    compare.textContent = 'Compare with last time';
    if (!compare.dataset.wired) {
      compare.dataset.wired = '1';
      compare.addEventListener('click', () => {
        if (comparing()) {
          clearComparison();
          compare.textContent = 'Compare with last time';
          setStatus('');
          return;
        }
        compareWithLast().then((got) => {
          if (got) compare.textContent = 'Back to this take';
        });
      });
    }
  }
  setStatus('');
  return render();
}

export function resetScoreTakes() {
  context = null;
  comparison = null;
  el('score-take-list')?.replaceChildren();
  setStatus('');
}
