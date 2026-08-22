// A failure that says what went wrong.
//
// "Audiveris exited with code 1" reached a player as "failed (100%)" and a
// maintainer as three separate trips into the running machine to run the same
// command by hand. The cause is always in the log — hundreds of lines above the
// tail that was being kept.

import test from 'node:test';
import assert from 'node:assert/strict';

const { plainly } = await import('../src/omr/engine-audiveris.js');

// Verbatim from Audiveris refusing a photographed page at 1400px:
const TOO_SMALL = [
  'tiny-page   With a too low interline value of 8 pixels,  either this sheet '
    + 'contains no multi-line staves,  or the picture resolution is too low (try 300 DPI).',
  'Error processing stub org.audiveris.omr.step.StepException: Sheet ignored',
  'Exception occurred java.lang.Exception: Error in export',
];

test('a page too small to read says so, not "exited with code 1"', () => {
  const err = Object.assign(new Error('Audiveris exited with code 1'), { details: { why: TOO_SMALL } });
  const said = plainly(err);
  assert.match(said, /too small or too blurred/);
  assert.doesNotMatch(said, /exited with code/);
});

test('a page with no staves is a different sentence', () => {
  const err = Object.assign(new Error('Audiveris exited with code 1'), {
    details: { why: ['Error processing stub org.audiveris.omr.step.StepException: Sheet ignored'] },
  });
  assert.match(plainly(err), /looked like a staff/);
});

test('an unknown failure passes the log line through rather than inventing one', () => {
  const err = Object.assign(new Error('Audiveris exited with code 1'), {
    details: { why: ['Caused by: java.lang.NullPointerException: TreeMap.get is null'] },
  });
  assert.match(plainly(err), /NullPointerException/);
});

test('and with nothing to go on it falls back to the message', () => {
  assert.equal(plainly(new Error('Audiveris exited with code 1')), 'Audiveris exited with code 1');
});

test('the cause survives a log long enough to bury it', async () => {
  const { run } = await import('../src/omr/run.js');
  // The shape of a real failure: the cause first, then thousands of lines of
  // progress, then the death rattle. Only the last 2000 characters used to be
  // kept, and the cause is not in them.
  const script = 'console.log("With a too low interline value of 8 pixels, try 300 DPI");'
    + 'for (let i = 0; i < 4000; i++) console.log("INFO  processing measure " + i);'
    + 'console.log("Exception occurred java.lang.Exception: Error in export");'
    + 'process.exit(1);';
  const err = await run(process.execPath, ['-e', script], { timeoutMs: 20000 }).catch((e) => e);
  assert.ok(err.details.why.some((l) => /too low interline/.test(l)),
    `the cause was lost: ${JSON.stringify(err.details.why)}`);
  assert.ok(!/too low interline/.test(err.details.stdout),
    'this test proves nothing if the tail happens to contain the cause');
});

test('the scale comes from the interline Audiveris measured, not from a fixed dpi', async () => {
  const { scaleFor } = await import('../src/omr/engine-audiveris.js');
  const at = (n) => scaleFor({ details: { why: [`With a too low interline value of ${n} pixels, try 300 DPI`] } });
  // Ten is what the scan that failed reported; eighteen is where Audiveris is
  // comfortable. Blowing it up to A4 at 300dpi gave 32 — eight megapixels for
  // a JVM on two shared cores, and it failed anyway.
  assert.equal(at(10).toFixed(1), '1.8');
  assert.equal(at(9).toFixed(1), '2.0');
  assert.equal(at(2), 3);                    // never more than three times
  assert.equal(at(20), null);                // already big enough: no rescue
  assert.equal(scaleFor(new Error('exited with code 1')), null);
});

test('the reading with more of the music wins, unless its rhythm collapses', async () => {
  const { chooseReading } = await import('../src/pipeline.js');
  // The four readings this rule was written against — notes, and the bars that
  // hold their beats out of the bars found.
  const picture1800 = { notes: 202, good: 9, bars: 37 };
  const page1800 = { notes: 182, good: 13, bars: 37 };
  const picture2000 = { notes: 246, good: 11, bars: 36 };
  const page2000 = { notes: 120, good: 4, bars: 23 };
  const picture3200 = { notes: 151, good: 8, bars: 36 };
  const page3200 = { notes: 227, good: 11, bars: 36 };
  const pdf300 = { notes: 152, good: 19, bars: 62 };
  const pdf450 = { notes: 215, good: 10, bars: 37 };

  assert.equal(chooseReading(picture1800, page1800), 'first', 'fewer notes never wins');
  assert.equal(chooseReading(picture2000, page2000), 'first');
  assert.equal(chooseReading(picture3200, page3200), 'second', '76 more notes, better bars too');
  assert.equal(chooseReading(pdf300, pdf450), 'second', '63 more notes at much the same rhythm');

  // The floor: noteheads that make no rhythmic sense are not more of the page.
  const noise = { notes: 400, good: 1, bars: 40 };
  assert.equal(chooseReading(pdf300, noise), 'first', 'a reading whose bars collapse is refused');
});

// AND THE SAME THING ONE STEP FURTHER DOWN, measured on the DEPLOYED service
// rather than a laptop: a photographed page of BWV 1007 read four ways came
// back 14 notes / 0 of 2 bars, 9 / 0 of 2, 18 / 1 of 2, and 168 / 0 of 14 — and
// the pipeline kept the eighteen. One bar of two is a share of 0.5, none of
// fourteen is 0.0, and the reading with nine times the music lost to one that
// had failed to read the page at all and got half of its two bars tidy.
test('a reading of two bars has no rhythm to judge, however tidy those two are', async () => {
  const { chooseReading } = await import('../src/pipeline.js');
  const barelyRead = { notes: 18, good: 1, bars: 2 };
  const theMusic = { notes: 168, good: 0, bars: 14 };
  assert.equal(chooseReading(barelyRead, theMusic), 'second',
    'nine times the music beats a tidy pair of bars');
  // …and the guard above it still holds: a reading whose bars collapse does not
  // beat a real one just by carrying more noteheads.
  const real = { notes: 152, good: 19, bars: 62 };
  const noise = { notes: 400, good: 1, bars: 40 };
  assert.equal(chooseReading(real, noise), 'first');
});

test('a reading that found almost nothing does not win on tidiness', async () => {
  const { chooseReading } = await import('../src/pipeline.js');
  // The reading that cost a whole page: 22 notes in 4 bars, 3 of them tidy — a
  // 75% share, which an early exit read as "good enough" and kept over three
  // readings still running. Against the reading that actually found the music:
  const almostNothing = { notes: 22, good: 3, bars: 4 };
  const theMusic = { notes: 271, good: 39, bars: 72 };
  assert.equal(chooseReading(almostNothing, theMusic), 'second');
  assert.equal(chooseReading(theMusic, almostNothing), 'first');
});
