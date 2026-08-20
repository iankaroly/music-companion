// End-to-end over real HTTP: upload -> job -> score -> alignment -> cursor.
//
// The fixture engine stands in for OMR so this runs in a second with no models
// installed; every other layer is the real one, including multipart parsing,
// the queue and the on-disk store.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'score-pipeline-'));
process.env.SCORE_DATA_DIR = dataDir;
process.env.OMR_ENGINE = 'fixture';

const { createApp } = await import('../src/http/app.js');
const { initStore } = await import('../src/storage/store.js');
const { idle } = await import('../src/jobs/queue.js');
const { fixturePath } = await import('./helpers.js');

await initStore();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, init) => fetch(`${base}${path}`, init);

test.after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// A PDF whose bytes are never read: the fixture engine returns its canned
// score whatever the upload was. Uploading a PDF rather than MusicXML is what
// makes this exercise the OMR path instead of the passthrough one.
const STUB_PDF = Buffer.from('%PDF-1.4\n% a stub — the fixture engine ignores it\n');

async function upload(bytes, name, fields = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const response = await api('/v1/scores', { method: 'POST', body: form });
  assert.equal(response.status, 202);
  const body = await response.json();
  await idle(); // the queue is in-process, so this is deterministic
  return body;
}

const uploadFixture = (fields = {}) => upload(STUB_PDF, 'scan.pdf', fields);

test('health and engine probe answer before anything is uploaded', async () => {
  assert.equal((await api('/healthz')).status, 200);
  const { engines } = await (await api('/v1/engines')).json();
  const fixtureEngine = engines.find((e) => e.id === 'fixture');
  assert.equal(fixtureEngine.ok, true);
  assert.ok(engines.some((e) => e.id === 'audiveris'));
});

test('an upload is accepted immediately and converted in the background', async () => {
  const { scoreId, jobId, poll } = await uploadFixture();
  assert.match(scoreId, /^sc_/);
  assert.equal(poll, `/v1/jobs/${jobId}`);

  const { job } = await (await api(`/v1/jobs/${jobId}`)).json();
  assert.equal(job.status, 'done');
  assert.equal(job.result.measures, 5);   // four printed bars, five played
  assert.equal(job.result.engine, 'fixture');
  assert.equal(job.result.degraded, true); // the fixture is not a real reading
  assert.ok(job.log.length > 0);
});

test('MusicXML skips recognition entirely', async () => {
  const { scoreId, jobId } = await upload(
    readFileSync(fixturePath('two-bar-tune.musicxml')), 'tune.musicxml',
  );
  const { job } = await (await api(`/v1/jobs/${jobId}`)).json();
  // A player who already owns the file must never be handed a re-recognised
  // copy of it, so the engine is the passthrough and nothing is degraded.
  assert.equal(job.result.engine, 'musicxml');
  assert.equal(job.result.degraded, false);
  const summary = await (await api(`/v1/scores/${scoreId}`)).json();
  assert.equal(summary.title, 'Fixture Tune');
});

test('the score summary is a summary, and ?include=full is not', async () => {
  const { scoreId } = await uploadFixture();
  const summary = await (await api(`/v1/scores/${scoreId}`)).json();
  assert.equal(summary.status, 'ready');
  assert.equal(summary.measureCount, 5);
  assert.equal(summary.parts[0].name, 'Cello');
  assert.equal(summary.score, undefined);

  const full = await (await api(`/v1/scores/${scoreId}?include=full`)).json();
  assert.ok(full.score.parts[0].measures[0].notes.length > 0);

  // Neither shape may carry where the upload sits on this disk.
  assert.equal(summary.source.path, undefined);
  assert.equal(full.source.path, undefined);
  assert.equal(summary.source.sha256.length, 64);
});

test('the score list stays small however long the pieces are', async () => {
  await uploadFixture();
  const { scores } = await (await api('/v1/scores')).json();
  assert.ok(scores.length > 0);
  for (const score of scores) {
    assert.equal(score.score, undefined);      // no printed notes
    assert.equal(score.timeline, undefined);   // and no played ones either
    assert.equal(score.source.path, undefined);
  }
  // It still has to be useful: a list you cannot show without a second call is
  // not a list.
  assert.ok(scores.every((s) => s.title !== undefined));
  assert.ok(scores.some((s) => s.measureCount === 5));
});

test('measures, notes, timeline and the original MusicXML are all served', async () => {
  const { scoreId } = await uploadFixture();

  const { measures } = await (await api(`/v1/scores/${scoreId}/measures`)).json();
  assert.equal(measures.length, 4);              // printed bars
  assert.equal(measures[0].notes, undefined);    // notes come from /notes

  const { notes } = await (await api(`/v1/scores/${scoreId}/notes?fromMeasure=0&toMeasure=0`)).json();
  assert.equal(notes.length, 4);
  assert.equal(notes[0].midi, 48);

  const timeline = await (await api(`/v1/scores/${scoreId}/timeline`)).json();
  assert.equal(timeline.measureCount, 5);        // played bars
  assert.equal(timeline.repeated, true);
  assert.equal(timeline.events, undefined);

  const xml = await (await api(`/v1/scores/${scoreId}/musicxml`)).text();
  assert.match(xml, /<score-partwise/);
});

test('an alignment can be made from two taps, in bars', async () => {
  const { scoreId } = await uploadFixture();
  const created = await api(`/v1/scores/${scoreId}/alignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'take 1',
      anchors: [
        { measure: 1, beat: 1, time: 2 },     // bar 1 lands two seconds in
        { measure: 4, beat: 1, time: 22 },    // bar 4 (after the repeat) at 22s
      ],
      audio: { uri: 'file:///takes/take1.wav', durationSeconds: 30 },
    }),
  });
  assert.equal(created.status, 201);
  const { alignment } = await created.json();
  assert.match(alignment.id, /^al_/);
  assert.equal(alignment.mode, 'anchors');
  assert.equal(alignment.anchors.length, 2);
  assert.equal(alignment.timemap.segments.length, 1);
  // 16 quarters in 20 seconds is 48 quarter-bpm.
  assert.equal(alignment.timemap.segments[0].quarterBpm, 48);
  assert.equal(alignment.audio.durationSeconds, 30);

  const cursor = await (await api(`/v1/alignments/${alignment.id}/cursor?t=2`)).json();
  assert.equal(cursor.measure.measureNumber, '1');
  assert.equal(cursor.measure.pass, 1);
  assert.deepEqual(cursor.sounding.map((s) => s.midi), [48]);

  const { notes } = await (await api(`/v1/alignments/${alignment.id}/schedule`)).json();
  assert.equal(notes[0].startTime, 2);
  assert.ok(notes.every((n) => n.startTime >= 2));

  const { measures } = await (await api(`/v1/alignments/${alignment.id}/measures`)).json();
  assert.equal(measures.length, 5);
  assert.equal(measures[0].startTime, 2);
});

test('a constant-tempo alignment needs only a bpm', async () => {
  const { scoreId } = await uploadFixture();
  const { alignment } = await (await api(`/v1/scores/${scoreId}/alignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'constant', quarterBpm: 60, offsetSeconds: 1 }),
  })).json();

  const convert = await (await api(`/v1/alignments/${alignment.id}/convert?measure=2&beat=1`)).json();
  assert.equal(convert.seconds, 5); // bar 2 starts at quarter 4, one second each
  const back = await (await api(`/v1/alignments/${alignment.id}/convert?t=5`)).json();
  assert.equal(back.quarter, 4);
});

test('adding a tap re-fits the alignment in place', async () => {
  const { scoreId } = await uploadFixture();
  const { alignment } = await (await api(`/v1/scores/${scoreId}/alignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ anchors: [{ measure: 1, time: 0 }, { measure: 4, time: 20 }] }),
  })).json();

  const patched = await api(`/v1/alignments/${alignment.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      anchors: [
        { measure: 1, time: 0 },
        { measure: 2, time: 3 },       // the player hurried the first bar
        { measure: 4, time: 20 },
      ],
    }),
  });
  const updated = (await patched.json()).alignment;
  assert.equal(updated.id, alignment.id);
  assert.equal(updated.anchors.length, 3);
  assert.equal(updated.timemap.segments.length, 2);
  assert.notEqual(updated.timemap.segments[0].quarterBpm, updated.timemap.segments[1].quarterBpm);
});

test('fit mode turns noisy taps into one tempo', async () => {
  const { scoreId } = await uploadFixture();
  const { alignment } = await (await api(`/v1/scores/${scoreId}/alignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'fit',
      anchors: [
        { measure: 1, time: 0.05 }, { measure: 2, time: 1.98 },
        { measure: 3, pass: 2, time: 6.1 }, { measure: 4, time: 8.02 },
      ],
    }),
  })).json();
  assert.equal(alignment.mode, 'fit');
  assert.ok(Math.abs(alignment.fit.quarterBpm - 120) < 6, `bpm was ${alignment.fit.quarterBpm}`);
  assert.ok(alignment.fit.rmsSeconds < 0.2);
});

test('bad input is refused with a reason, not a stack trace', async () => {
  const { scoreId } = await uploadFixture();

  const noAnchors = await api(`/v1/scores/${scoreId}/alignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ anchors: [] }),
  });
  assert.equal(noAnchors.status, 400);
  assert.match((await noAnchors.json()).error.message, /non-empty/);

  const missingBar = await api(`/v1/scores/${scoreId}/alignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ anchors: [{ measure: 99, time: 1 }, { measure: 100, time: 2 }] }),
  });
  assert.equal(missingBar.status, 400);

  const backwards = await api(`/v1/scores/${scoreId}/alignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ anchors: [{ measure: 1, time: 9 }, { measure: 2, time: 1 }] }),
  });
  assert.equal(backwards.status, 400);
  assert.match((await backwards.json()).error.message, /backwards/);

  assert.equal((await api('/v1/scores/sc_nope')).status, 404);
  assert.equal((await api('/v1/scores/../../etc/passwd')).status, 404);
  assert.equal((await api('/v1/alignments/al_nope/cursor?t=1')).status, 404);
  assert.equal((await api('/v1/nothing-here')).status, 404);
});

test('an upload that is not music is refused at the door', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('just some text')]), 'notes.txt');
  const response = await api('/v1/scores', { method: 'POST', body: form });
  assert.equal(response.status, 415);
});

test('a score can be deleted, and its alignments go with it', async () => {
  const { scoreId } = await uploadFixture();
  const { alignment } = await (await api(`/v1/scores/${scoreId}/alignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'constant', quarterBpm: 90 }),
  })).json();

  assert.equal((await api(`/v1/scores/${scoreId}`, { method: 'DELETE' })).status, 204);
  assert.equal((await api(`/v1/scores/${scoreId}`)).status, 404);
  assert.equal((await api(`/v1/alignments/${alignment.id}`)).status, 404);
});

test('the per-page report is served, and says what was read', async () => {
  const { scoreId } = await uploadFixture();
  const body = await (await api(`/v1/scores/${scoreId}/pages`)).json();
  assert.equal(body.pages.length, 1);
  assert.equal(body.pages[0].status, 'read');
  assert.equal(body.pages[0].measures, 4);   // printed bars on page 1
  assert.equal(body.read, 1);
  assert.equal(body.failed, 0);
  assert.equal(body.truncated, false);

  const summary = await (await api(`/v1/scores/${scoreId}`)).json();
  assert.equal(summary.pagesRead, 1);
  assert.equal(summary.pagesFailed, 0);
});

test('the MusicXML comes back as a file, named after the score', async () => {
  const { scoreId } = await uploadFixture();
  const response = await api(`/v1/scores/${scoreId}/musicxml`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename=".*\.musicxml"/);
  // One document from the engine, so it is the engine's own file, unmodified.
  assert.equal(response.headers.get('x-score-generated'), null);
  assert.match(await response.text(), /<score-partwise/);
});

test('several photos in one upload become one document', async () => {
  // What photographing a three-page part looks like from a browser: three files
  // under the same field name, in page order.
  const form = new FormData();
  for (const name of ['page1.jpg', 'page2.png', 'page3.jpg']) {
    const file = name.endsWith('.png') ? 'tiny-page.png' : 'tiny-page.jpg';
    form.append('file', new Blob([readFileSync(fixturePath(file))]), name);
  }
  form.append('title', 'Photographed part');

  const response = await api('/v1/scores', { method: 'POST', body: form });
  assert.equal(response.status, 202);
  const { scoreId } = await response.json();
  await idle();

  const score = await (await api(`/v1/scores/${scoreId}`)).json();
  assert.equal(score.status, 'ready');
  assert.equal(score.title, 'Photographed part');
  // The three photos were combined into one PDF before anything read them.
  assert.equal(score.source.kind, 'pdf');
  assert.deepEqual(score.source.assembledFrom, ['page1.jpg', 'page2.png', 'page3.jpg']);
  assert.match(score.source.assemblyNote, /3 images were combined/);
  assert.equal(score.source.filename, 'Photographed part.pdf');
});

test('a mixture of file types in one upload is refused with the reason', async () => {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(fixturePath('tiny-page.jpg'))]), 'page1.jpg');
  form.append('file', new Blob([Buffer.from('some notes')]), 'notes.txt');
  const response = await api('/v1/scores', { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /notes\.txt/);
});

test('a single upload still behaves exactly as it did', async () => {
  const { scoreId } = await uploadFixture();
  const score = await (await api(`/v1/scores/${scoreId}`)).json();
  assert.equal(score.source.assembledFrom, null);
  assert.equal(score.source.filename, 'scan.pdf');
});
