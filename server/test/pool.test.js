import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/util/pool.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('results come back in input order, whatever finishes first', async () => {
  const out = await mapWithConcurrency([30, 5, 20, 1], 3, async (ms, i) => {
    await tick(ms);
    return i;
  });
  assert.deepEqual(out.map((r) => r.value), [0, 1, 2, 3]);
});

test('never more than the limit are in flight', async () => {
  let live = 0;
  let peak = 0;
  await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
    live += 1;
    peak = Math.max(peak, live);
    await tick(5);
    live -= 1;
  });
  assert.equal(peak, 3);
});

test('one failure costs one item, not the run', async () => {
  const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error('page 2 is unreadable');
    return n * 10;
  });
  assert.deepEqual(out.map((r) => r.value), [10, undefined, 30]);
  assert.match(out[1].error.message, /unreadable/);
});

test('an empty list and a silly limit are both fine', async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  const out = await mapWithConcurrency([1, 2], 0, async (n) => n);
  assert.deepEqual(out.map((r) => r.value), [1, 2]);
});
