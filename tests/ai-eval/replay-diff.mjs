// Re-scores the real on-device model's saved replies (tools/ai-model/results/)
// with two guards and prints every reply whose verdict changed, so each change
// can be read and called a true catch or a false rejection BY HAND. The model
// is not run; these are the replies it gave at 2b5b284.
//
//   node tests/ai-eval/replay-diff.mjs <old guard path> [--split tune|held|all]
//
// Held replies are only printed with --split held or all: tune on the tune split
// and look at the held one once, at the end.
import { readFileSync } from 'node:fs';
import { checkReply as now } from '../../src/ai/guard.js';

const args = process.argv.slice(2);
const oldPath = args.find((a) => !a.startsWith('--'));
const split = args.includes('--split') ? args[args.indexOf('--split') + 1] : 'tune';
const { checkReply: before } = await import(new URL(oldPath, `file://${process.cwd()}/`).href);

const dir = new URL('../../tools/ai-model/results/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases-after.json', dir), 'utf8'));
const replies = new Map(JSON.parse(readFileSync(new URL('replies-after.json', dir), 'utf8')).map((r) => [r.id, r]));

let nOld = 0;
let nNew = 0;
let n = 0;
const changed = [];
for (const c of cases) {
  if (split !== 'all' && c.split !== split) continue;
  const text = String(replies.get(c.id)?.text ?? '').trim();
  if (!text || replies.get(c.id)?.error) continue;
  n += 1;
  const a = before(text, c.facts, c.question, { takeCount: c.takeCount });
  const b = now(text, c.facts, c.question, { takeCount: c.takeCount });
  if (a.ok) nOld += 1;
  if (b.ok) nNew += 1;
  if (a.ok !== b.ok) changed.push({ c, text, a, b });
}
console.log(`[${split}] ${n} replies: accepted by the old guard ${nOld}, by this one ${nNew}`);
for (const x of changed) {
  console.log(`\n#${x.c.id} [${x.c.split}] ${x.a.ok ? 'WAS ACCEPTED, NOW REJECTED' : 'WAS REJECTED, NOW ACCEPTED'}  Q: ${x.c.question}`);
  console.log(`  REPLY: ${x.text}`);
  console.log(`  WHY: ${x.b.problems.map((p) => `${p.kind}: ${p.text}`).join(' | ')}`);
  console.log(`  FACTS: ${x.c.facts.join(' ').slice(0, 400)}`);
}
