// The pipeline behind a tunnel is on the open web.
//
// On a home network the address is the protection: nobody outside can route to
// 192.168.x.x. Put it behind a tunnel so a phone can reach it from anywhere and
// that is gone — the URL is public, and a stranger who finds it can queue
// twenty-minute recognition jobs on somebody's laptop and read what is
// uploaded. So when OMR_TOKEN is set, everything but the health probe needs it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'omr-token-'));
process.env.SCORE_DATA_DIR = dataDir;
process.env.OMR_ENGINE = 'fixture';
process.env.OMR_TOKEN = 'a-long-shared-secret';

const { createApp } = await import('../src/http/app.js');
const { initStore } = await import('../src/storage/store.js');
await initStore();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.OMR_TOKEN;
});

test('without the password, nothing but the health probe answers', async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);

  for (const path of ['/v1/engines', '/v1/scores', '/']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 401, path);
  }
  const refused = await (await fetch(`${base}/v1/engines`)).json();
  assert.match(refused.error.message, /password/);
});

test('a wrong password is refused, however close it is', async () => {
  for (const wrong of ['', 'a-long-shared-secre', 'a-long-shared-secretX', 'A-LONG-SHARED-SECRET']) {
    const response = await fetch(`${base}/v1/engines`, { headers: { 'x-omr-token': wrong } });
    assert.equal(response.status, 401, JSON.stringify(wrong));
  }
});

test('the right password lets the app in, by header or by query', async () => {
  const byHeader = await fetch(`${base}/v1/engines`, { headers: { 'x-omr-token': 'a-long-shared-secret' } });
  assert.equal(byHeader.status, 200);

  // The query form is for the one call a browser makes without headers: a
  // download the player taps on.
  const byQuery = await fetch(`${base}/v1/engines?token=a-long-shared-secret`);
  assert.equal(byQuery.status, 200);
});

test('with a password, the app may call in from wherever it is served', async () => {
  // A tunnel exists so a phone can reach this from anywhere, and the app doing
  // the calling is served from its own host. Refusing that origin while
  // accepting the password would leave the feature broken in exactly the
  // arrangement it was set up for.
  const origin = 'https://practicepartner.vercel.app';
  const response = await fetch(`${base}/v1/engines`, {
    headers: { origin, 'x-omr-token': 'a-long-shared-secret' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);

  // The password is still the gate: the origin alone opens nothing.
  const without = await fetch(`${base}/v1/engines`, { headers: { origin } });
  assert.equal(without.status, 401);
});
