// Scores the harness's replies with the real guard.
//
//   node tools/ai-model/score.mjs cases.json replies.json [--show tune|held|all] [--accepted|--rejected]
//
// The sealed split is invisible unless you pass --reveal-held: no counts, no
// text. (The first versions of this script printed held counts on every run, so
// during tuning of v2..v5 the aggregate held numbers WERE seen, though no held
// reply text was; the report says so.)
import { readFileSync } from 'node:fs';
import { checkReply, stripScopeTags } from '../../src/ai/guard.js';

const [casesPath, repliesPath, ...flags] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const replies = new Map(JSON.parse(readFileSync(repliesPath, 'utf8')).map((r) => [r.id, r]));
const reveal = flags.includes('--reveal-held');
let show = flags.includes('--show') ? flags[flags.indexOf('--show') + 1] : null;
if (!reveal && show !== 'tune') show = null;

const rows = cases.map((c) => {
  const r = replies.get(c.id);
  // what the app does: strip the prompt's own scope tags, and count the takes the
  // FACTS were built from (not the ones named) for "the two takes"
  const text = stripScopeTags(String(r?.text ?? '')).trim();
  const v = r?.error ? { ok: false, reason: `model error: ${r.error}`, problems: [{ kind: 'error' }], stray: [] } : checkReply(text, c.facts, c.question, { takeCount: c.takesInFacts ?? c.takeCount });
  return { c, r, text, v };
});

// Mechanical detectors for replies the guard ACCEPTS that I would call wrong or
// misleading. Regexes, so they are a floor: they find the classes I found by
// reading, they do not replace reading. `labels` is checked against hand labels.
const NOTE = /\b[A-G][#b]?\d\b/;
const VERDICT = /\b(good|bad|well|fine|ok|okay|correct|great|better|worse|improving|improved|in tune|out of tune|not in tune)\b/gi;
const NAMED = /\b(violin|viola|cello|flute|piano|guitar|trumpet|soprano|major|minor)\b/gi;
export function detect(c, text) {
  const out = [];
  const facts = c.facts.join(' ').toLowerCase();
  const asked = c.question.toLowerCase();
  // a note's "on average over N times" sentence without a note name in it
  for (const sent of text.split(/(?<=[.!?])\s+/)) if (/over \d+ times/.test(sent) && !NOTE.test(sent)) { out.push('note-as-take'); break; }
  const v = [...text.matchAll(VERDICT)].map((m) => m[0].toLowerCase()).filter((w) => !facts.includes(w));
  if (v.length) out.push(`verdict:${[...new Set(v)].join('/')}`);
  if (/\b[A-G][#b]?\d\b[^.]*\bthan\b[^.]*\b[A-G][#b]?\d\b/.test(text)) out.push('invented-relation');
  const n = [...text.matchAll(NAMED)].map((m) => m[0].toLowerCase()).filter((w) => !facts.includes(w));
  if (n.length) out.push(`echoed:${[...new Set(n)].join('/')}`);
  if (/not measured|was not measured|could not be measured/i.test(text) && !/not be measured|cannot|no steady|nothing to compare|not measured/i.test(facts) && /\d/.test(facts)) out.push('maybe-false-not-measured');
  if (/\b(31|44|E4|etude)\b/i.test(text) && !/\b(31|44|E4|etude)\b/i.test(facts + asked)) out.push('example-leak');
  if (/MEASUREMENTS:|QUESTION:|ANSWER:/i.test(text)) out.push('prompt-echo');
  return out;
}

const pct = (n, d) => (d ? `${n}/${d} = ${(100 * n / d).toFixed(1)}%` : 'n/a');
const pctile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const split of reveal ? ['tune', 'held', 'all'] : ['tune']) {
  const g = rows.filter((x) => split === 'all' || x.c.split === split);
  const ok = g.filter((x) => x.v.ok);
  const kinds = {};
  for (const x of g.filter((y) => !y.v.ok)) { const k = x.v.problems[0]?.kind ?? '?'; kinds[k] = (kinds[k] ?? 0) + 1; }
  const ms = g.map((x) => x.r?.ms ?? 0);
  const words = g.map((x) => x.text.split(/\s+/).filter(Boolean).length);
  console.log(`\n[${split}] accepted ${pct(ok.length, g.length)}; rejected ${pct(g.length - ok.length, g.length)} by first problem: ${JSON.stringify(kinds)}`);
  const acc = ok.map((x) => ({ x, d: detect(x.c, x.text) }));
  const byKind = {};
  for (const { d } of acc) for (const k of d) byKind[k.split(':')[0]] = (byKind[k.split(':')[0]] ?? 0) + 1;
  console.log(`   accepted AND flagged by a detector: ${acc.filter((a) => a.d.length).length}/${ok.length}  ${JSON.stringify(byKind)}`);
  console.log(`   latency ms mean ${(ms.reduce((a, b) => a + b, 0) / g.length).toFixed(0)}, median ${pctile(ms, 0.5).toFixed(0)}, p95 ${pctile(ms, 0.95).toFixed(0)}, max ${Math.max(...ms).toFixed(0)}; words/reply mean ${(words.reduce((a, b) => a + b, 0) / g.length).toFixed(1)}`);
}
if (show) {
  for (const x of rows.filter((y) => (show === 'all' || y.c.split === show) && (flags.includes('--accepted') ? y.v.ok : flags.includes('--rejected') ? !y.v.ok : true))) {
    console.log(`\n#${x.c.id} [${x.c.split}/${x.c.lib}] Q: ${x.c.question}  ${x.v.ok ? 'ACCEPTED' + (detect(x.c, x.text).length ? ' FLAGS ' + detect(x.c, x.text).join(',') : '') : 'REJECTED ' + x.v.problems.map((p) => `${p.kind}:${p.text}`).join(' | ')}`);
    console.log('  FACTS: ' + x.c.facts.join(' ').slice(0, 900));
    console.log('  REPLY: ' + x.text);
  }
}
