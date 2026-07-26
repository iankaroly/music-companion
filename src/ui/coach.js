import { listRecordingsWithStats, listPassages } from '../store/db.js';
import { aggregateTendencies, dailyScores, pickDrills, weeklyReport, pieceProgress } from '../analysis/coach.js';
import { passageProgress } from '../analysis/passages.js';
import { toggleDroneNote, activeDroneNotes } from '../audio/drone.js';
import { intonationStatus } from './chart-utils.js';

// The coach tab: personal intonation habits mined from the library.
// Three cards — today's drill (act on it), the tendency map (see it),
// and the trend line (watch it improve).

const BAR_MAX_CENTS = 30; // a bar at full half-width = 30¢ mean error
const TREND_DAYS = 14;

const STATUS_VAR = { good: 'var(--good)', off: 'var(--off)', bad: 'var(--bad)' };

function currentA4() {
  const v = Number(localStorage.getItem('a4'));
  return Number.isFinite(v) && v >= 400 && v <= 450 ? v : 440;
}

function midiFrequency(midi) {
  return currentA4() * 2 ** ((midi - 69) / 12);
}

export async function renderCoach(root) {
  const empty = root.querySelector('#coach-empty');
  const content = root.querySelector('#coach-content');
  let recordings = [];
  try {
    recordings = await listRecordingsWithStats();
  } catch { /* blocked IndexedDB — treated as no data */ }
  const sessions = recordings.map((r) => ({ date: r.date, name: r.name, noteStats: r.noteStats ?? [] }));
  const tendencies = aggregateTendencies(sessions);

  if (tendencies.length === 0) {
    empty.hidden = false;
    content.hidden = true;
    return;
  }
  empty.hidden = true;
  content.hidden = false;
  renderWeek(root, weeklyReport(sessions, Date.now()));
  renderPieces(root.querySelector('#piece-list'), pieceProgress(sessions));
  let passages = [];
  try {
    passages = await listPassages();
  } catch { /* blocked IndexedDB — the passage card just stays empty */ }
  renderPassages(root.querySelector('#passage-progress'), passageProgress(passages));
  renderDrills(root.querySelector('#drill-list'), pickDrills(tendencies));
  renderTendencies(root.querySelector('#tendency-rows'), tendencies);
  renderTrend(
    root.querySelector('#trend-chart'),
    root.querySelector('#trend-note'),
    dailyScores(sessions).slice(-TREND_DAYS),
  );
}

// --- this week: streak, days, notes, error vs last week ---------------------

function renderWeek(root, week) {
  const set = (id, v) => { root.querySelector(id).textContent = v; };
  set('#wk-streak', String(week.streak));
  set('#wk-days', String(week.daysPracticed));
  set('#wk-notes', String(week.noteCount));
  set('#wk-error', week.avgError === null ? '–' : `${week.avgError.toFixed(0)}¢`);
  const deltaEl = root.querySelector('#wk-delta');
  if (week.avgError !== null && week.prevAvgError !== null) {
    const d = week.avgError - week.prevAvgError;
    deltaEl.textContent = d <= 0
      ? `▼ ${Math.abs(d).toFixed(0)}¢ better than last week`
      : `▲ ${d.toFixed(0)}¢ worse than last week`;
    deltaEl.dataset.state = d <= 0 ? 'good' : 'bad';
  } else {
    deltaEl.textContent = week.prevAvgError === null ? 'first week — set the baseline' : '';
    deltaEl.dataset.state = '';
  }
}

// --- passages: the same few bars, attempt after attempt ---------------------

function renderPassages(list, rows) {
  if (!list) return;
  list.replaceChildren();
  if (rows.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'drill-done';
    hint.textContent = 'Open a take, mark a passage, and give it a name. '
      + 'Mark it again next session under the same name to watch it improve.';
    list.append(hint);
    return;
  }
  for (const p of rows.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'pg-row';
    const name = document.createElement('span');
    name.className = 'pg-name';
    name.textContent = p.name;
    const count = document.createElement('span');
    count.className = 'pg-count';
    const cents = Number.isFinite(p.latestCents) ? `${p.latestCents.toFixed(0)}¢` : '–';
    const ms = Number.isFinite(p.latestMs) ? ` · ${Math.round(p.latestMs)}ms` : '';
    count.textContent = `${p.attempts.length}× · ${cents}${ms}`;
    const delta = document.createElement('span');
    delta.className = 'pg-delta';
    if (p.centsDelta === null && p.msDelta === null) {
      delta.textContent = 'baseline';
      delta.classList.add('flat');
    } else {
      const parts = [];
      if (Number.isFinite(p.centsDelta)) {
        parts.push(`${p.centsDelta <= 0 ? '▼' : '▲'}${Math.abs(p.centsDelta).toFixed(0)}¢`);
      }
      if (Number.isFinite(p.msDelta)) {
        parts.push(`${p.msDelta <= 0 ? '▼' : '▲'}${Math.abs(p.msDelta).toFixed(0)}ms`);
      }
      delta.textContent = parts.join(' ');
      delta.classList.add(p.improving ? 'better' : 'worse');
    }
    row.append(name, count, delta);
    list.append(row);
  }
}

// --- pieces: name-grouped takes with a per-take error sparkline -------------

function renderPieces(list, pieces) {
  list.replaceChildren();
  if (pieces.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'drill-done';
    hint.textContent = 'Name your takes in the library (same name = same piece) to track each piece over time.';
    list.append(hint);
    return;
  }
  for (const p of pieces.slice(0, 6)) {
    const row = document.createElement('div');
    row.className = 'piece-row';
    const info = document.createElement('div');
    info.className = 'piece-info';
    const title = document.createElement('b');
    title.textContent = p.name;
    const sub = document.createElement('small');
    sub.textContent = `${p.takes.length} take${p.takes.length === 1 ? '' : 's'} · latest ${p.latest.toFixed(0)}¢`;
    info.append(title, sub);
    const spark = document.createElement('canvas');
    spark.className = 'piece-spark';
    row.append(info, spark);
    const delta = document.createElement('span');
    delta.className = 'piece-delta';
    if (p.delta !== null) {
      delta.textContent = p.delta <= 0 ? `▼${Math.abs(p.delta).toFixed(0)}¢` : `▲${p.delta.toFixed(0)}¢`;
      delta.dataset.state = p.delta <= 0 ? 'good' : 'bad';
    } else {
      delta.textContent = 'new';
    }
    row.append(delta);
    list.append(row);
    drawSpark(spark, p.takes.map((t) => t.absMean));
  }
}

function drawSpark(canvas, values) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = 72;
  const cssH = 26;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const max = Math.max(10, ...values);
  const x = (i) => (values.length === 1 ? cssW / 2 : 2 + (i / (values.length - 1)) * (cssW - 4));
  const y = (v) => 3 + (1 - v / max) * (cssH - 6);
  ctx.strokeStyle = '#6d4ef6';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
  ctx.stroke();
  ctx.fillStyle = '#6d4ef6';
  ctx.beginPath();
  ctx.arc(x(values.length - 1), y(values.at(-1)), 3, 0, 2 * Math.PI);
  ctx.fill();
}

// --- today's drill ----------------------------------------------------------

function renderDrills(list, drills) {
  list.replaceChildren();
  if (drills.length === 0) {
    const done = document.createElement('div');
    done.className = 'drill-done';
    done.textContent = 'No strong habits to fix — everything is centering. Keep playing!';
    list.append(done);
    return;
  }
  for (const d of drills) {
    const row = document.createElement('div');
    row.className = 'drill';
    const text = document.createElement('div');
    text.className = 'drill-text';
    const dir = d.verdict === 'sharp' ? 'sharp' : 'flat';
    const aim = d.verdict === 'sharp' ? 'aim lower' : 'aim higher';
    text.innerHTML = `<b>${d.name}</b> runs ${Math.abs(d.meanCents).toFixed(0)}¢ ${dir} `
      + `<small>(${d.count} notes) — long-tone it against the drone and ${aim} until the beats stop</small>`;
    const btn = document.createElement('button');
    btn.className = 'ctl';
    const key = `coach:${d.name}`;
    const label = () => { btn.textContent = activeDroneNotes().has(key) ? `Stop ${d.name}` : `Drone ${d.name}`; };
    btn.classList.toggle('active', activeDroneNotes().has(key));
    label();
    btn.addEventListener('click', () => {
      const on = toggleDroneNote(key, midiFrequency(d.midi));
      btn.classList.toggle('active', on);
      label();
    });
    row.append(text, btn);
    list.append(row);
  }
}

// --- tendency map: diverging bars, flat ← 0 → sharp -------------------------

function renderTendencies(container, tendencies) {
  container.replaceChildren();
  for (const t of tendencies) {
    const row = document.createElement('div');
    row.className = 'tend-row';
    const name = document.createElement('span');
    name.className = 'tend-name';
    name.textContent = t.name;
    const track = document.createElement('div');
    track.className = 'tend-track';
    const center = document.createElement('i');
    center.className = 'tend-center';
    const bar = document.createElement('i');
    bar.className = 'tend-bar';
    const frac = Math.min(1, Math.abs(t.meanCents) / BAR_MAX_CENTS) * 50;
    bar.style.width = `${Math.max(1.5, frac)}%`;
    bar.style[t.meanCents >= 0 ? 'left' : 'right'] = '50%';
    bar.style.background = STATUS_VAR[intonationStatus(t.meanCents)];
    track.append(center, bar);
    const val = document.createElement('span');
    val.className = 'tend-val';
    val.textContent = `${t.meanCents >= 0 ? '+' : ''}${t.meanCents.toFixed(0)}¢ · ×${t.count}`;
    row.append(name, track, val);
    container.append(row);
  }
}

// --- trend: average error per practice day ----------------------------------

function renderTrend(canvas, noteEl, days) {
  const summary = days.length
    ? `avg error per practice day · latest ${days.at(-1).absMean.toFixed(0)}¢`
    : '';
  noteEl.textContent = summary;
  if (days.length < 2) {
    canvas.hidden = true;
    noteEl.textContent = days.length
      ? `one practice day so far (avg ${days[0].absMean.toFixed(0)}¢) — the trend starts with your next session`
      : '';
    return;
  }
  canvas.hidden = false;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300;
  const cssH = canvas.clientHeight || 96;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const PADL = 8; const PADR = 34; const PADT = 12; const PADB = 18;
  const w = cssW - PADL - PADR;
  const h = cssH - PADT - PADB;
  const maxY = Math.max(12, ...days.map((d) => d.absMean));
  const x = (i) => PADL + (days.length === 1 ? w / 2 : (i / (days.length - 1)) * w);
  const y = (v) => PADT + (1 - v / maxY) * h;

  // baseline + endpoint date labels, recessive
  ctx.strokeStyle = 'rgba(42, 33, 73, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADL, y(0));
  ctx.lineTo(PADL + w, y(0));
  ctx.stroke();
  ctx.fillStyle = '#7b74a0';
  ctx.font = '10px -apple-system, sans-serif';
  const short = (day) => new Date(`${day}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  ctx.textAlign = 'left';
  ctx.fillText(short(days[0].day), PADL, cssH - 4);
  ctx.textAlign = 'right';
  ctx.fillText(short(days.at(-1).day), PADL + w, cssH - 4);

  ctx.strokeStyle = '#6d4ef6';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  days.forEach((d, i) => (i === 0 ? ctx.moveTo(x(i), y(d.absMean)) : ctx.lineTo(x(i), y(d.absMean))));
  ctx.stroke();

  // latest point gets the marker and the direct label
  const li = days.length - 1;
  ctx.fillStyle = '#6d4ef6';
  ctx.beginPath();
  ctx.arc(x(li), y(days[li].absMean), 4, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#2a2149';
  ctx.textAlign = 'left';
  ctx.font = '600 11px -apple-system, sans-serif';
  ctx.fillText(`${days[li].absMean.toFixed(0)}¢`, x(li) + 8, y(days[li].absMean) + 4);

  // touch/hover readout: nearest day into the note line below
  canvas.onpointermove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * cssW;
    let nearest = 0;
    for (let i = 1; i < days.length; i++) {
      if (Math.abs(x(i) - px) < Math.abs(x(nearest) - px)) nearest = i;
    }
    const d = days[nearest];
    noteEl.textContent = `${short(d.day)} · avg ${d.absMean.toFixed(0)}¢ over ${d.noteCount} notes`;
  };
  canvas.onpointerleave = () => { noteEl.textContent = summary; };
}
