// Can a classifier tell a notehead from a rest, and does it TRAVEL?
//
// The second half is the whole question. A model fitted to one engraving and
// scored on that same engraving would report whatever accuracy you like and
// tell you nothing — it is the same mistake as a notehead-width constant fitted
// to the Bärenreiter Bach, which read 1.24 spaces, was perfect on that page and
// threw away a Mozart flute part printed at 1.0.
//
// So this never scores a page it trained on. Train on the Bach, test on the
// Mozart; train on the Mozart, test on the Bach. If the numbers hold up both
// ways the shape of a notehead is what was learned. If they collapse, two pages
// is not enough data and no amount of tuning here will change that — which is
// also worth knowing, and cheaper to find out now.
//
//   npm run scan:train
//
import { readFile, writeFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../pages/patches.json', import.meta.url), 'utf8'));
const N = data.grid * data.grid;

// Logistic regression, plain gradient descent. Deliberately the simplest thing
// that could work: 793 examples is not enough to fit anything with a lot of
// parameters, and a model small enough to reason about is a model whose failure
// can be read off its weights.
function train(rows, { steps = 3000, rate = 0.5, decay = 0.002 } = {}) {
  const w = new Float64Array(N).fill(0);
  let b = 0;
  const xs = rows.map((r) => r.pixels.map((v) => v / 255));
  const ys = rows.map((r) => r.label);
  for (let step = 0; step < steps; step++) {
    const gw = new Float64Array(N);
    let gb = 0;
    for (let i = 0; i < rows.length; i++) {
      let z = b;
      for (let k = 0; k < N; k++) z += w[k] * xs[i][k];
      const p = 1 / (1 + Math.exp(-z));
      const d = p - ys[i];
      for (let k = 0; k < N; k++) gw[k] += d * xs[i][k];
      gb += d;
    }
    for (let k = 0; k < N; k++) w[k] -= rate * (gw[k] / rows.length + decay * w[k]);
    b -= rate * (gb / rows.length);
  }
  return { w: [...w], b };
}

const score = (model, row) => {
  let z = model.b;
  for (let k = 0; k < N; k++) z += model.w[k] * (row.pixels[k] / 255);
  return 1 / (1 + Math.exp(-z));
};

// What the reader gets if the classifier is allowed to veto its candidates.
// Precision and recall OF THE WHOLE READER, not of the classifier, because that
// is the number the page is judged by.
function reading(rows, model, cut) {
  const kept = rows.filter((r) => score(model, r) >= cut);
  const real = rows.filter((r) => r.label).length;
  const hit = kept.filter((r) => r.label).length;
  return {
    precision: kept.length ? hit / kept.length : 0,
    recall: real ? hit / real : 0,
    kept: kept.length,
    lost: real - hit,
  };
}

const pages = [...new Set(data.rows.map((r) => r.page))];
console.log('\nA PATCH CLASSIFIER, TESTED ON A PAGE IT HAS NEVER SEEN\n');
console.log(`  ${data.rows.length} patches, ${data.grid}x${data.grid}, ${data.span} staff spaces across\n`);

const models = {};
for (const held of pages) {
  const trainRows = data.rows.filter((r) => r.page !== held);
  const testRows = data.rows.filter((r) => r.page === held);
  const model = train(trainRows);
  models[held] = model;
  const before = {
    precision: testRows.filter((r) => r.label).length / testRows.length,
    recall: 1,
  };
  console.log(`  trained on ${pages.filter((p) => p !== held).join(', ')} — tested on ${held}`);
  console.log(`    the reader alone:  precision ${(before.precision * 100).toFixed(1)}%   recall 100.0%`);
  console.log('    with the classifier vetoing candidates:');
  console.log('      cut   precision   recall   kept   notes lost');
  for (const cut of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    const r = reading(testRows, model, cut);
    console.log(`      ${cut.toFixed(1)}   ${`${(r.precision * 100).toFixed(1)}%`.padStart(9)}`
      + `   ${`${(r.recall * 100).toFixed(1)}%`.padStart(6)}   ${String(r.kept).padStart(4)}   ${String(r.lost).padStart(10)}`);
  }
  console.log('');
}

// Shipped weights are trained on EVERYTHING, since by then the question of
// whether it travels has already been answered above.
const full = train(data.rows);
await writeFile(new URL('../pages/head-model.json', import.meta.url),
  JSON.stringify({ grid: data.grid, span: data.span, w: full.w.map((v) => +v.toFixed(5)), b: +full.b.toFixed(5) }));
console.log('  weights over both pages written to pages/head-model.json\n');
