// The guard's two error rates, side by side with the guard it replaced.
//
//   npm run ai:guard
//
// A guard that rejects everything is useless and one that passes everything is
// dangerous, so both are printed: how many of the honest replies it throws
// away (false rejects) and how many of the adversarial ones it lets through
// (escapes). The original check from d99246e is kept in legacy-guard.js for
// the "before" column; it is the same function the app shipped on that branch.
//
// Two batches: guard-cases.js, which the guard was built against, and
// guard-heldout.js, written afterwards. Only the second says anything about
// replies the guard has not been shaped by.

import { checkReply } from '../../src/ai/guard.js';
import { checkReply as legacy } from './legacy-guard.js';
import { HONEST, ADVERSARIAL, KNOWN_GAPS, scenario } from './guard-cases.js';
import { HONEST_2, ADVERSARIAL_2, DERIVED_HONEST } from './guard-heldout.js';

const run = (fn, s, reply) => {
  const sc = scenario(s);
  return fn(reply, sc.facts, sc.question, { takeCount: sc.takeCount });
};

export function measureSet({ honest, adversarial, derived = [], gaps = [] }) {
  return {
    honest: honest.map(([s, r]) => ({ s, r, v: run(checkReply, s, r), old: run(legacy, s, r) })),
    adv: adversarial.map(([kind, s, r]) => ({ kind, s, r, v: run(checkReply, s, r), old: run(legacy, s, r) })),
    derived: derived.map(([s, r, why]) => ({ s, r, why, v: run(checkReply, s, r) })),
    gaps: gaps.map(([s, r, why]) => ({ s, r, why, v: run(checkReply, s, r) })),
  };
}

export const SETS = {
  built: () => measureSet({ honest: HONEST, adversarial: ADVERSARIAL, gaps: KNOWN_GAPS }),
  heldout: () => measureSet({ honest: HONEST_2, adversarial: ADVERSARIAL_2, derived: DERIVED_HONEST }),
};

function print(label, { honest, adv, derived, gaps }) {
  const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
  const hr = honest.filter((h) => !h.v.ok);
  const hrOld = honest.filter((h) => !h.old.ok);
  console.log(`\n=== ${label} ===`);
  console.log(`honest replies: ${honest.length}`);
  console.log(`  wrongly rejected, new guard      ${hr.length} / ${honest.length}  ${pct(hr.length, honest.length)}`);
  console.log(`  wrongly rejected, original guard ${hrOld.length} / ${honest.length}  ${pct(hrOld.length, honest.length)}`);
  for (const h of hr) console.log(`    REJECTED [${h.s}] ${h.r}\n      -> ${h.v.problems.map((p) => `${p.kind}: ${p.text}`).join('; ')}`);
  const esc = adv.filter((a) => a.v.ok);
  const escOld = adv.filter((a) => a.old.ok);
  console.log(`adversarial replies: ${adv.length}`);
  console.log(`  caught by new guard      ${adv.length - esc.length} / ${adv.length}  ${pct(adv.length - esc.length, adv.length)}`);
  console.log(`  caught by original guard ${adv.length - escOld.length} / ${adv.length}  ${pct(adv.length - escOld.length, adv.length)}`);
  for (const k of [...new Set(adv.map((a) => a.kind))]) {
    const g = adv.filter((a) => a.kind === k);
    console.log(`    ${k.padEnd(11)} new ${g.filter((a) => !a.v.ok).length}/${g.length}   original ${g.filter((a) => !a.old.ok).length}/${g.length}`);
  }
  for (const a of esc) console.log(`  ESCAPED [${a.kind}/${a.s}] ${a.r}`);
  if (derived.length) {
    console.log(`honest but derived (rejected on purpose): ${derived.filter((d) => !d.v.ok).length} / ${derived.length} rejected`);
  }
  if (gaps.length) console.log(`known gaps (false claims in true words): ${gaps.filter((g) => g.v.ok).length} / ${gaps.length} still pass`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  print('built against (guard-cases.js)', SETS.built());
  print('held out (guard-heldout.js; written after the guard)', SETS.heldout());
}
