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
