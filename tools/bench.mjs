// Every marked page, scored in one command.
//
// The reader had one page of ground truth and every constant in it drifted
// toward that page: a notehead width fitted to a Bärenreiter Bach threw away
// the notes on a Mozart flute part, which are printed narrower. One page cannot
// tell you that. Two can, and the only way to keep them both honest is to
// measure them together, every time, so a change that helps one and wrecks the
// other is visible in the same breath.
//
//   npm run bench                 every page in pages/index.json
//   npm run bench -- --json
//
// pages/index.json is a list of { name, file, truth }, where file and truth are
// paths. Pages live outside the repo — they are somebody's music, not ours.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const index = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
const wantJson = process.argv.includes('--json');

const rows = [];
for (const page of index) {
  try {
    // Truth paths may be repo-relative — the marks are OURS, tiny, and worth
    // keeping in the repo; the music they were marked on is the user's and is
    // not. An absolute path still works, for a page not yet copied in.
    const truth = page.truth.startsWith('/')
      ? page.truth
      : new URL(`../${page.truth}`, import.meta.url).pathname;
    const { stdout } = await run('node', ['tools/truth-check.mjs', page.file, '--truth', truth, '--json']);
    const j = JSON.parse(stdout.slice(stdout.indexOf('{')));
    rows.push({
      name: page.name,
      space: j.space,
      found: j.found,
      truth: j.truth,
      precision: j.precision,
      recall: j.recall,
      f1: j.f1,
      invented: j.falsePositives.length,
      // WHICH PASS PROPOSED WHAT. The shape tests and the stem rescue are two
      // different readers sharing a page, and until this column existed a
      // change to either one moved the same two numbers with no way to say
      // which. It is what found STEM_BODY: on 32 engraved studies the stem
      // pass proposed 251 circles and not one real notehead, while here it
      // rescues 36 real notes on the Scanned page and is worth keeping.
      stemReal: j.matched.filter((m) => m.via === 'stem').length,
      stemFalse: j.falsePositives.filter((m) => m.via === 'stem').length,
      missed: j.missed.length,
      bars: j.bars,
      systems: j.systems,
      clefs: j.clefs,
    });
  } catch (e) {
    rows.push({ name: page.name, error: e.message.split('\n')[0] });
  }
}

if (wantJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log('\nMARKED PAGES — the reader against what a person can see\n');
  console.log('  page          space  found  really  precision  recall     F1   invented  missed   bars  clefs   stem pass');
  for (const r of rows) {
    if (r.error) { console.log(`  ${r.name.padEnd(12)}  ${r.error}`); continue; }
    console.log(`  ${r.name.padEnd(12)}  ${String(r.space).padStart(5)}  ${String(r.found).padStart(5)}`
      + `  ${String(r.truth).padStart(6)}  ${`${(r.precision * 100).toFixed(1)}%`.padStart(9)}`
      + `  ${`${(r.recall * 100).toFixed(1)}%`.padStart(6)}  ${`${(r.f1 * 100).toFixed(1)}%`.padStart(5)}`
      + `  ${String(r.invented).padStart(8)}  ${String(r.missed).padStart(6)}`
      + `  ${String(r.bars).padStart(5)}  ${`${r.clefs}/${r.systems}`.padStart(5)}`
      + `   ${`${r.stemReal} real / ${r.stemFalse} not`.padStart(9)}`);
  }
  const ok = rows.filter((r) => !r.error);
  if (ok.length) {
    const mean = (k) => ok.reduce((a, r) => a + r[k], 0) / ok.length;
    console.log(`\n  mean${' '.repeat(24)}${`${(mean('precision') * 100).toFixed(1)}%`.padStart(9)}`
      + `  ${`${(mean('recall') * 100).toFixed(1)}%`.padStart(6)}  ${`${(mean('f1') * 100).toFixed(1)}%`.padStart(5)}\n`);
  }
}
