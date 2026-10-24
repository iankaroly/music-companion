// What the real model said to the questions that are now routed away for
// holding a list, and whether the guard at a7305c3 let each through.
//   node tools/ai-model/routed-away-replies.mjs
import { readFileSync } from 'node:fs';
import { checkReply, stripScopeTags } from '../../src/ai/guard.js';

const dir = new URL('./results/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases-final2.json', dir), 'utf8'));
const replies = new Map(JSON.parse(readFileSync(new URL('replies-final2.json', dir), 'utf8')).map((r) => [r.id, r]));
const ids = [4, 11, 12, 19, 20, 40, 48, 77, 80, 94, 106, 107, 114, 115, 135, 141];
for (const id of ids) {
  const c = cases.find((x) => x.id === id);
  const text = stripScopeTags(String(replies.get(id)?.text ?? '')).trim();
  const v = checkReply(text, c.facts, c.question, { takeCount: c.takesInFacts });
  console.log(`\n#${id} [${c.split}] Q: ${c.question}  (guard then: ${v.ok ? 'ACCEPTED' : 'rejected'})`);
  console.log(`  FACTS: ${c.facts.join(' ')}`);
  console.log(`  REPLY: ${text}`);
}
