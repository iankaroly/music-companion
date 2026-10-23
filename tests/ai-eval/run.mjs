// Runs every question in questions.js through the router and the fact builder
// (no model, no audio, no network) and says how many came out right.
//
//   npm run ai:eval            the table and every miss
//   npm run ai:eval -- --quiet just the table
//
// The score has four parts because one number hides which part is wrong:
//   intent    the router picked exactly the measurements the question needs
//   takes     it picked the right takes, in the order the facts use them
//   facts     the sentences contain every required fact and none forbidden
//   scope     off-topic, unmeasurable and unknown-take questions are refused
//             by code, and nothing answerable is refused

import { plan } from '../../src/ai/router.js';
import { factsFor } from '../../src/ai/facts.js';
import { QUESTIONS } from './questions.js';
import { HELDOUT } from './heldout.js';
import { NOW } from './fixtures.js';

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// What the product does with a question, minus the model. Shared by the
// runner and the unit tests so they cannot drift apart.
export function runCase(q) {
  const library = q.library.map((t) => ({ ...t }));
  const p = plan(q.question ?? q.q, library, NOW);
  const scope = p.scope?.kind ?? (p.takeIds.length === 0 ? 'nodata' : 'answer');
  const byId = new Map(library.map((t) => [t.id, t]));
  const chosen = p.takeIds.map((id) => byId.get(id)).filter(Boolean).map((t) => ({ ...t }));
  for (const t of chosen) {
    if (p.needs.quality) t.quality = t._quality;
    if (p.needs.rhythm) t.rhythm = t._rhythm;
  }
  let facts = [];
  if (scope === 'answer' || scope === 'nodata') {
    facts = factsFor({ question: q.q, intents: p.intents, chosen, all: library, now: NOW }).facts;
  }
  return { intents: p.intents, takeIds: p.takeIds, scope, facts, text: facts.join(' ') };
}

export function evaluate(questions = QUESTIONS) {
  const rows = questions.map((q) => {
    const r = runCase(q);
    const answerable = q.scope === 'answer';
    const row = { q, r, scopeOk: r.scope === q.scope };
    if (answerable) {
      row.intentOk = sameSet(r.intents, q.i);
      row.takesOk = q.t ? same(r.takeIds, q.t) : true;
    }
    if (answerable || q.scope === 'nodata') {
      row.missing = (q.must ?? []).filter((re) => !re.test(r.text));
      row.forbidden = (q.not ?? []).filter((re) => re.test(r.text));
      row.factsOk = row.missing.length === 0 && row.forbidden.length === 0;
    }
    row.allOk = row.scopeOk && (row.intentOk ?? true) && (row.takesOk ?? true) && (row.factsOk ?? true);
    return row;
  });

  const answer = rows.filter((x) => x.q.scope === 'answer');
  const refuse = rows.filter((x) => ['offtopic', 'unmeasurable', 'unsupported', 'notfound'].includes(x.q.scope));
  const nodata = rows.filter((x) => x.q.scope === 'nodata');
  const pct = (n, d) => (d === 0 ? null : (100 * n) / d);
  const summary = {
    total: rows.length,
    answerable: answer.length,
    intent: pct(answer.filter((x) => x.intentOk).length, answer.length),
    takes: pct(answer.filter((x) => x.takesOk).length, answer.length),
    facts: pct(answer.filter((x) => x.factsOk).length, answer.length),
    answerEndToEnd: pct(answer.filter((x) => x.allOk).length, answer.length),
    refusable: refuse.length,
    refusedRight: pct(refuse.filter((x) => x.scopeOk).length, refuse.length),
    byKind: Object.fromEntries(['offtopic', 'unmeasurable', 'unsupported', 'notfound'].map((k) => {
      const g = refuse.filter((x) => x.q.scope === k);
      return [k, { n: g.length, ok: g.filter((x) => x.scopeOk).length }];
    })),
    falseRefusals: answer.filter((x) => ['offtopic', 'unmeasurable', 'unsupported', 'notfound'].includes(x.r.scope)).length,
    noData: pct(nodata.filter((x) => x.allOk).length, nodata.length),
    noDataN: nodata.length,
    allOk: rows.filter((x) => x.allOk).length,
  };
  return { rows, summary };
}

const f = (v) => (v === null ? '  n/a' : `${v.toFixed(1)}%`.padStart(6));

export function printReport({ rows, summary: s }, { quiet = false } = {}) {
  const line = (name, ok, n, v) => console.log(`  ${name.padEnd(46)} ${String(ok).padStart(3)} / ${String(n).padEnd(3)} ${f(v)}`);
  console.log(`\nai eval: ${s.total} questions\n`);
  const a = rows.filter((x) => x.q.scope === 'answer');
  line('intent: exactly the right measurements', a.filter((x) => x.intentOk).length, s.answerable, s.intent);
  line('take selection: right takes, right order', a.filter((x) => x.takesOk).length, s.answerable, s.takes);
  line('answerable, facts correct (must / must not)', a.filter((x) => x.factsOk).length, s.answerable, s.facts);
  line('answerable, all three at once', a.filter((x) => x.allOk).length, s.answerable, s.answerEndToEnd);
  line('refused by code when it should be', Math.round(((s.refusedRight ?? 0) * s.refusable) / 100), s.refusable, s.refusedRight);
  for (const [k, v] of Object.entries(s.byKind)) line(`  ${k}`, v.ok, v.n, v.n ? (100 * v.ok) / v.n : null);
  line('answerable questions refused by mistake', s.falseRefusals, s.answerable, (100 * s.falseRefusals) / s.answerable);
  line('empty / silent library says so', Math.round(((s.noData ?? 0) * s.noDataN) / 100), s.noDataN, s.noData);
  line('EVERYTHING right for the question', s.allOk, s.total, (100 * s.allOk) / s.total);
  if (quiet) return;
  const misses = rows.filter((x) => !x.allOk);
  if (misses.length) console.log(`\n${misses.length} misses:`);
  for (const m of misses) {
    const why = [];
    if (!m.scopeOk) why.push(`scope ${m.r.scope} (wanted ${m.q.scope})`);
    if (m.intentOk === false) why.push(`intents [${m.r.intents}] (wanted [${m.q.i}])`);
    if (m.takesOk === false) why.push(`takes [${m.r.takeIds}] (wanted [${m.q.t}])`);
    if (m.missing?.length) why.push(`missing ${m.missing.map(String).join(' & ')}`);
    if (m.forbidden?.length) why.push(`forbidden ${m.forbidden.map(String).join(' & ')}`);
    console.log(`  #${String(m.q.n).padStart(3)} [${m.q.lib}] ${JSON.stringify(m.q.q)}\n        ${why.join('; ')}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const quiet = process.argv.includes('--quiet');
  console.log('\n=== development set (questions.js; the rules were fitted to this) ===');
  printReport(evaluate(), { quiet });
  console.log('\n=== held-out set (heldout.js; written after the fit) ===');
  printReport(evaluate(HELDOUT), { quiet });
}
