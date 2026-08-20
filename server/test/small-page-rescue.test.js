// A page one pixel under the floor is read, not refused.
//
// Audiveris will not touch a sheet whose staff lines are closer together than
// eleven pixels. A scan off a phone came in at TEN — "that page came out too
// small or too blurred to read" — while the machinery for fixing it, rendering
// the page half again as big, sat behind a check for `kind === 'pdf'`. A
// photograph got one attempt and no second chance; a scan of two pages got the
// ladder, which is why those read and a single page did not.
//
// fixtures/interline-ten.jpg is a real photographed page shrunk until Audiveris
// reports exactly the interline that failed: not 8, which is a page too poor to
// read either way, and not 12, which never needed rescuing.
//
// Skipped where Audiveris is not installed, like the other engine tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { audiverisEngine: audiveris } = await import('../src/omr/engine-audiveris.js');
const { fixturePath } = await import('./helpers.js');

const probe = await audiveris.available();
const ready = probe.ok;

test('a page at interline ten is rescued by rendering it as a page', { skip: !ready && 'audiveris is not installed' }, async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'rescue-'));
  try {
    const out = await audiveris.convert({
      inputPath: fixturePath('interline-ten.jpg'),
      workDir,
      kind: 'image',
      timeoutMs: 10 * 60 * 1000,
    });
    const xml = out.documents.map((d) => d.musicXml).join('');
    const bars = (xml.match(/<measure[ >]/g) ?? []).length;
    assert.ok(bars > 5, `expected the page to read, got ${bars} bars`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
