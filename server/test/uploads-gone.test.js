// The upload is gone afterwards — including when the reading failed.
//
// The service tells people their pages are deleted as soon as they are read.
// That was true of pages it could read: the delete sat in the success path, so
// a page no engine could make sense of stayed on the disk for good. On a laptop
// that is a spare copy; on a service other people share it is somebody else's
// sheet music, kept precisely because nothing useful came of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'score-pipeline-uploads-'));
process.env.SCORE_DATA_DIR = dataDir;
process.env.OMR_ENGINE = 'fixture';

const { createApp } = await import('../src/http/app.js');
const { initStore } = await import('../src/storage/store.js');
const { idle } = await import('../src/jobs/queue.js');

await initStore();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const uploadsLeft = () => {
  const dir = path.join(dataDir, 'uploads');
  return existsSync(dir) ? readdirSync(dir) : [];
};

async function send(bytes, name) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const response = await fetch(`${base}/v1/scores`, { method: 'POST', body: form });
  const body = await response.json();
  await idle();
  const { job } = await fetch(`${base}/v1/jobs/${body.jobId}`).then((r) => r.json());
  return { ...body, status: job.status };
}

test('a score that was read keeps nothing of the upload', async () => {
  const { scoreId, status } = await send(
    Buffer.from('%PDF-1.4\n% the fixture engine ignores this\n'), 'read-me.pdf',
  );
  assert.equal(status, 'done');
  assert.ok(!uploadsLeft().includes(scoreId), `${scoreId} is still in uploads/`);
});

test('a score that could NOT be read keeps nothing either', async () => {
  // MusicXML goes through the passthrough engine, which parses it; bytes that
  // are not XML fail there, which is the shape of a page nothing could read.
  const { scoreId, status } = await send(
    Buffer.from('this is not musicxml, and no parser will pretend otherwise'),
    'unreadable.musicxml',
  );
  assert.equal(status, 'failed');
  assert.ok(!uploadsLeft().includes(scoreId), `${scoreId} survived a failed reading`);
});

test('a score that could not be read says so, rather than converting for ever', async () => {
  const { scoreId } = await send(
    Buffer.from('this is not musicxml either'), 'nope.musicxml',
  );
  const score = await fetch(`${base}/v1/scores/${scoreId}`).then((r) => r.json());
  assert.equal(score.status, 'failed');
  assert.ok(score.error?.message, 'a failed score carries the reason');
});
