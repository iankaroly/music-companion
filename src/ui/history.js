// Session history: recent list plus a trend sparkline of average intonation
// error for the currently selected scale spec (lower = better).

const MAX_LISTED = 8;

function drawTrend(canvas, values) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;

  const max = Math.max(...values, 20); // keep a stable scale up to 20¢+
  const pad = 4;
  const x = (i) => pad + (i / (values.length - 1)) * (w - 2 * pad);
  const y = (v) => h - pad - (v / max) * (h - 2 * pad);

  ctx.strokeStyle = '#b09a7d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
  ctx.stroke();

  ctx.fillStyle = '#33261b';
  values.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(v), 2, 0, 2 * Math.PI);
    ctx.fill();
  });
}

export function renderHistory(root, sessions, currentSpecKey) {
  const panel = root.querySelector('#history');
  const list = root.querySelector('#session-list');
  const canvas = root.querySelector('#trend');
  const trendLabel = root.querySelector('#trend-label');

  if (sessions.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  const matching = sessions
    .filter((s) => s.specKey === currentSpecKey && s.avgAbsCents !== null)
    .sort((a, b) => a.date - b.date);
  drawTrend(canvas, matching.map((s) => s.avgAbsCents));
  trendLabel.textContent = matching.length >= 2
    ? `${currentSpecKey}: avg error across ${matching.length} sessions`
    : `play ${currentSpecKey} twice to see a trend`;

  list.replaceChildren();
  for (const s of sessions.slice(0, MAX_LISTED)) {
    const li = root.ownerDocument?.createElement('li') ?? document.createElement('li');
    const day = new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const err = s.avgAbsCents === null ? '' : ` · avg ${s.avgAbsCents.toFixed(1)}¢`;
    li.textContent = `${day} · ${s.specKey} from ${s.tonic} · ${s.matched}/${s.total}${err}`;
    list.append(li);
  }
}
