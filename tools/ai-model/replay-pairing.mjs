// Replays the real on-device model's SAVED replies (results/replies-final2.json)
// through the pairing guard, offline, and says what changed.
//
//   node tools/ai-model/replay-pairing.mjs [--split tune|held|all]
//
// 1. It rebuilds all 156 answerable questions with the code as it is NOW and
//    checks that every question the model saw at a7305c3 has byte-identical
//    facts and prompt, so a saved reply is still a reply to this prompt.
// 2. A question that is now routed away from the model (a list of bars or
//    notes) is counted, and its saved reply is not scored: it will never be
//    shown.
// 3. Every other reply is checked with the guard as it was (no slots) and as it
//    is now (slots); a reply whose verdict changed is printed to be read by hand.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runCase } from '../../tests/ai-eval/run.mjs';
import { QUESTIONS } from '../../tests/ai-eval/questions.js';
import { HELDOUT } from '../../tests/ai-eval/heldout.js';
import { MUSICALITY_QUESTIONS } from '../../tests/ai-eval/musicality-questions.js';
import { instructionsFor, promptFor } from '../../src/ai/assistant.js';
import { checkReply, stripScopeTags } from '../../src/ai/guard.js';

const args = process.argv.slice(2);
const split = args.includes('--split') ? args[args.indexOf('--split') + 1] : 'tune';
const dir = new URL('./results/', import.meta.url);
const saved = JSON.parse(readFileSync(new URL('cases-final2.json', dir), 'utf8'));
const savedCode = JSON.parse(readFileSync(new URL('cases-final2.code.json', dir), 'utf8'));
const replies = new Map(JSON.parse(readFileSync(new URL('replies-final2.json', dir), 'utf8')).map((r) => [r.id, r]));

// the same pool and order as export-cases.mjs
const sets = { dev: QUESTIONS, heldout: HELDOUT, shaping: MUSICALITY_QUESTIONS };
const seen = new Set();
const pool = [];
for (const [set, qs] of Object.entries(sets)) {
  for (const q of qs) {
    if (q.scope !== 'answer') continue;
    const key = `${q.lib}|${q.q}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push({ set, q, h: createHash('sha1').update(key).digest('hex') });
  }
}
pool.sort((a, b) => (a.h < b.h ? -1 : 1));
const now = pool.map((p, i) => ({ id: i, p, r: runCase(p.q) }));

let drift = 0;
for (const c of saved) {
  const n = now[c.id];
  const facts = JSON.stringify(n.r.facts);
  const prompt = promptFor(n.p.q.q, n.r.facts);
  if (facts !== JSON.stringify(c.facts) || prompt !== c.prompt || instructionsFor(n.r.intents) !== c.instructions) { drift += 1; console.log(`DRIFT #${c.id}: facts or prompt differ from the saved case`); }
}
console.log(`pool ${now.length}; saved model cases ${saved.length}, saved code cases ${savedCode.length}; facts/prompt identical for ${saved.length - drift}/${saved.length}`);

const routedAway = now.filter((n) => n.r.routed === 'code');
const byWhy = {};
for (const n of routedAway) byWhy[n.r.why] = (byWhy[n.r.why] ?? 0) + 1;
console.log(`now answered by code alone: ${routedAway.length} of ${now.length} ${JSON.stringify(byWhy)} (was ${savedCode.length})`);
const newlyAway = saved.filter((c) => now[c.id].r.routed === 'code');
console.log(`of the ${saved.length} questions the model was asked, ${newlyAway.length} no longer reach it: ${newlyAway.map((c) => `#${c.id}`).join(' ')}`);

// The app's own sentences, said back, must pass: a guard that refused the facts
// it was given would be refusing true statements. All 156 questions, both routes.
{
  let bad = 0;
  for (const n of now) {
    if (!n.r.facts.length) continue;
    const v = checkReply(n.r.facts.join(' '), n.r.facts, n.p.q.q, { takeCount: n.r.takesInFacts, slots: n.r.slots });
    if (v.problems.some((p) => p.kind === 'pairing')) { bad += 1; console.log(`FACTS REFUSED BY PAIRING #${n.id}: ${v.problems.filter((p) => p.kind === 'pairing').map((p) => p.text).join(' | ')}`); }
  }
  console.log(`the facts, said back as a reply, refused by the pairing checks: ${bad}/${now.length}`);
}

let kept = 0;
let oldOk = 0;
let newOk = 0;
const changed = [];
for (const c of saved) {
  if (split !== 'all' && c.split !== split) continue;
  if (now[c.id].r.routed === 'code') continue;
  const rep = replies.get(c.id);
  if (!rep || rep.error) continue;
  const text = stripScopeTags(String(rep.text ?? '')).trim();
  if (!text) continue;
  kept += 1;
  const opts = { takeCount: c.takesInFacts ?? c.takeCount };
  const a = checkReply(text, c.facts, c.question, opts);
  const b = checkReply(text, c.facts, c.question, { ...opts, slots: now[c.id].r.slots });
  if (a.ok) oldOk += 1;
  if (b.ok) newOk += 1;
  if (a.ok !== b.ok) changed.push({ c, text, a, b });
}
console.log(`[${split}] replies still reaching the model ${kept}: accepted before ${oldOk}, now ${newOk}`);
for (const x of changed) {
  console.log(`\n#${x.c.id} [${x.c.split}] ${x.a.ok ? 'WAS ACCEPTED, NOW REJECTED' : 'WAS REJECTED, NOW ACCEPTED'}  Q: ${x.c.question}`);
  console.log(`  FACTS: ${x.c.facts.join(' ').slice(0, 500)}`);
  console.log(`  REPLY: ${x.text}`);
  console.log(`  NOW:   ${x.b.problems.map((p) => `${p.kind}:${p.text}`).join(' | ')}`);
}
