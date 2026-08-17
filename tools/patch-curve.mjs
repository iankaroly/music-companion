// What is actually stopping this: not enough pages, or too simple a model?
//
// The answer decides everything about what to do next. If accuracy is still
// climbing steeply with the number of labelled examples, then marking more
// pages is the work and no amount of cleverness substitutes for it. If it has
// flattened and a model with more capacity does better on the same data, then
// the model is the work and marking more pages is a slow way to get nowhere.
//
// Both are cheap to measure and neither is safe to guess, so this measures
// them, and it never scores a page it trained on.
//
//   npm run scan:curve
//
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../pages/patches.json', import.meta.url), 'utf8'));
const N = data.grid * data.grid;
const pages = [...new Set(data.rows.map((r) => r.page))];

const X = (r) => r.pixels.map((v) => v / 255);

// Deterministic shuffle, so a run can be repeated and compared. Math.random
// would make every column of the table below a different experiment.
function order(n, seed = 12345) {
  const ix = Array.from({ length: n }, (_, i) => i);
  let s = seed;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [ix[i], ix[j]] = [ix[j], ix[i]];
  }
  return ix;
}

function logistic(rows, { steps = 2500, rate = 0.5, decay = 0.002 } = {}) {
  const w = new Float64Array(N); let b = 0;
  const xs = rows.map(X); const ys = rows.map((r) => r.label);
  for (let s = 0; s < steps; s++) {
    const gw = new Float64Array(N); let gb = 0;
    for (let i = 0; i < rows.length; i++) {
      let z = b;
      for (let k = 0; k < N; k++) z += w[k] * xs[i][k];
      const d = 1 / (1 + Math.exp(-z)) - ys[i];
      for (let k = 0; k < N; k++) gw[k] += d * xs[i][k];
      gb += d;
    }
    for (let k = 0; k < N; k++) w[k] -= rate * (gw[k] / rows.length + decay * w[k]);
    b -= rate * (gb / rows.length);
  }
  return (r) => {
    let z = b; const x = X(r);
    for (let k = 0; k < N; k++) z += w[k] * x[k];
    return 1 / (1 + Math.exp(-z));
  };
}

// One hidden layer. The point is not to ship it — it is to find out whether a
// model that CAN draw a curved boundary does better on this data than one that
// cannot. If it does not, capacity is not what is missing.
function network(rows, { hidden = 24, steps = 1500, rate = 0.6, decay = 0.001, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return (s / 2147483648 - 0.5) * 0.4; };
  const W1 = Array.from({ length: hidden }, () => Float64Array.from({ length: N }, rnd));
  const b1 = new Float64Array(hidden);
  const W2 = Float64Array.from({ length: hidden }, rnd);
  let b2 = 0;
  const xs = rows.map(X); const ys = rows.map((r) => r.label);
  for (let step = 0; step < steps; step++) {
    const gW1 = Array.from({ length: hidden }, () => new Float64Array(N));
    const gb1 = new Float64Array(hidden);
    const gW2 = new Float64Array(hidden);
    let gb2 = 0;
    for (let i = 0; i < rows.length; i++) {
      const hpre = new Float64Array(hidden);
      const hact = new Float64Array(hidden);
      for (let j = 0; j < hidden; j++) {
        let z = b1[j];
        for (let k = 0; k < N; k++) z += W1[j][k] * xs[i][k];
        hpre[j] = z; hact[j] = z > 0 ? z : 0;
      }
      let z2 = b2;
      for (let j = 0; j < hidden; j++) z2 += W2[j] * hact[j];
      const d2 = 1 / (1 + Math.exp(-z2)) - ys[i];
      gb2 += d2;
      for (let j = 0; j < hidden; j++) {
        gW2[j] += d2 * hact[j];
        const dh = hpre[j] > 0 ? d2 * W2[j] : 0;
        if (dh === 0) continue;
        gb1[j] += dh;
        for (let k = 0; k < N; k++) gW1[j][k] += dh * xs[i][k];
      }
    }
    const n = rows.length;
    for (let j = 0; j < hidden; j++) {
      W2[j] -= rate * (gW2[j] / n + decay * W2[j]);
      b1[j] -= rate * (gb1[j] / n);
      for (let k = 0; k < N; k++) W1[j][k] -= rate * (gW1[j][k] / n + decay * W1[j][k]);
    }
    b2 -= rate * (gb2 / n);
  }
  return (r) => {
    const x = X(r);
    let z2 = b2;
    for (let j = 0; j < hidden; j++) {
      let z = b1[j];
      for (let k = 0; k < N; k++) z += W1[j][k] * x[k];
      if (z > 0) z2 += W2[j] * z;
    }
    return 1 / (1 + Math.exp(-z2));
  };
}

// The reader's own precision and recall if this model vetoes its candidates.
function reading(rows, f, cut = 0.3) {
  const kept = rows.filter((r) => f(r) >= cut);
  const real = rows.filter((r) => r.label).length;
  const hit = kept.filter((r) => r.label).length;
  const p = kept.length ? hit / kept.length : 0;
  const rc = real ? hit / real : 0;
  return { p, rc, f1: (p + rc) ? (2 * p * rc) / (p + rc) : 0 };
}

console.log('\nWHAT IS THE BOTTLENECK — data, or the model?\n');
console.log(`  ${data.rows.length} labelled patches from ${pages.length} pages, scored only on pages held out\n`);

// ONE COLUMN PER PAGE, WHOEVER THE PAGES ARE. This printed `per.Bach` and
// `per.Mozart` by name while averaging the mean over every page in the file,
// which was harmless while pages/index.json listed two pages and became a lie
// the day a third was added: the mean moved and the column that moved it was
// not on the screen. The columns are now built from `pages`, so adding a fourth
// marked page shows up here without an edit.
const col = (v) => `${(v * 100).toFixed(1)}%`.padStart(9);
const header = pages.map((p) => `${p} F1`.padStart(9)).join('  ');

console.log('  HOW MUCH DOES MORE DATA BUY? (logistic, held-out page)');
console.log(`  training patches  ${header}       mean`);
const fracs = [0.15, 0.3, 0.5, 0.75, 1];
for (const frac of fracs) {
  const per = {};
  let used = 0;
  for (const held of pages) {
    const pool = data.rows.filter((r) => r.page !== held);
    const ix = order(pool.length).slice(0, Math.max(20, Math.round(pool.length * frac)));
    const trainRows = ix.map((i) => pool[i]);
    used += trainRows.length;
    per[held] = reading(data.rows.filter((r) => r.page === held), logistic(trainRows)).f1;
  }
  const mean = pages.reduce((a, p) => a + per[p], 0) / pages.length;
  console.log(`  ${String(Math.round(used / pages.length)).padStart(16)}  `
    + `${pages.map((p) => col(per[p])).join('  ')}  ${col(mean)}`);
}

console.log('\n  DOES A BIGGER MODEL DO BETTER ON THE SAME DATA? (held-out page)');
console.log(`  model                ${header}       mean`);
for (const [name, fit] of [['logistic (shipped)', logistic], ['one hidden layer, 24', network]]) {
  const per = {};
  for (const held of pages) {
    per[held] = reading(data.rows.filter((r) => r.page === held), fit(data.rows.filter((r) => r.page !== held))).f1;
  }
  const mean = pages.reduce((a, p) => a + per[p], 0) / pages.length;
  console.log(`  ${name.padEnd(19)}  ${pages.map((p) => col(per[p])).join('  ')}  ${col(mean)}`);
}
console.log('');

// WHAT THE ANSWER WAS, so nobody runs this and draws the opposite conclusion.
// Both readings are kept: the two-page one that set the project's direction,
// and the three-page one measured after the Scanned score was marked.
//
//   more patches      TWO PAGES: 60 patches gave 94.3% and 397 gave 95.1%.
//                     THREE PAGES: 127 gave 93.5% and 845 gave 95.0%, and it is
//                     not even monotone on the way (253 reads 93.9%, 423 reads
//                     93.7%). Flat both times. Extra examples from a page
//                     already in the set are redundant — the four hundredth
//                     notehead on the Bach looks like the first.
//   more capacity     TWO PAGES: a hidden layer of 24 read 87.8% on the
//                     held-out Mozart against logistic regression's 92.0%, a
//                     gap of 4.2 points, and it was memorising the page it
//                     trained on. THREE PAGES: 94.7% against 95.0% in the mean
//                     — the gap has closed to 0.3, and the hidden layer now
//                     WINS on the held-out Mozart (92.7% against 92.1%) and
//                     loses on the Scanned score (93.0% against 94.2%).
//                     Logistic still wins, but "capacity is obviously wrong for
//                     this much data" is no longer what the numbers say, and a
//                     fourth page is the measurement that would settle it.
//
// Neither is the lever, and the third page has NOT answered the question this
// could not answer with two — because the Scanned score is the same music as
// the Concerto, photographed rather than typeset. It is a third SCAN and not a
// third KIND. What is short is still KINDS of example: a page with handwriting
// on it, a piano score, a phone photograph of something not already here. Each
// new kind is a column in this table, and this file is how you find out whether
// it bought anything.
//
// One warning that belongs with this table. It scores the CLASSIFIER, on the
// candidate list the shape tests hand it, and a model that reads better here
// can still read worse as a whole reader: the three-page refit is better in
// every column above and costs npm run bench two points of both precision and
// recall, through a constant this table cannot see. See head-model.js.
