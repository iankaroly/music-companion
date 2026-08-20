import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AlignmentError, buildTimemap, constantTimemap, fitConstantTempo,
  quarterAtSeconds, secondsAt,
} from '../src/align/timemap.js';

test('two anchors define a tempo, and the map is exact at them', () => {
  const map = buildTimemap([{ quarter: 0, time: 1 }, { quarter: 8, time: 5 }]);
  assert.equal(map.segments[0].quarterBpm, 120);
  assert.equal(secondsAt(map, 0), 1);
  assert.equal(secondsAt(map, 8), 5);
  assert.equal(secondsAt(map, 4), 3);
});

test('the map is invertible', () => {
  const map = buildTimemap([
    { quarter: 0, time: 0 }, { quarter: 4, time: 2 }, { quarter: 12, time: 10 },
  ]);
  for (const q of [0, 1.5, 4, 7, 11.999, 12]) {
    assert.ok(Math.abs(quarterAtSeconds(map, secondsAt(map, q)) - q) < 1e-4, `roundtrip at ${q}`);
  }
});

test('tempo changes between segments are followed', () => {
  const map = buildTimemap([
    { quarter: 0, time: 0 }, { quarter: 4, time: 2 }, { quarter: 8, time: 6 },
  ]);
  assert.equal(map.segments[0].quarterBpm, 120);
  assert.equal(map.segments[1].quarterBpm, 60);
  assert.equal(secondsAt(map, 6), 4);
});

test('positions outside the anchored span extrapolate at the edge tempo', () => {
  const map = buildTimemap([{ quarter: 4, time: 2 }, { quarter: 8, time: 4 }]);
  assert.equal(secondsAt(map, 0), 0);   // two quarters a second, backwards
  assert.equal(secondsAt(map, 12), 6);
  assert.equal(quarterAtSeconds(map, 0), 0);
});

test('one anchor needs a tempo, and then works', () => {
  assert.throws(() => buildTimemap([{ quarter: 0, time: 0 }]), AlignmentError);
  const map = buildTimemap([{ quarter: 4, time: 10 }], { quarterBpm: 60 });
  assert.equal(secondsAt(map, 5), 11);
});

test('anchors that go backwards in time are refused', () => {
  assert.throws(
    () => buildTimemap([{ quarter: 0, time: 5 }, { quarter: 4, time: 3 }]),
    /backwards/,
  );
});

test('two times for one musical position are refused, but an exact duplicate is dropped', () => {
  assert.throws(() => buildTimemap([{ quarter: 4, time: 1 }, { quarter: 4, time: 9 }]), AlignmentError);
  const map = buildTimemap([
    { quarter: 0, time: 0 }, { quarter: 4, time: 2 }, { quarter: 4, time: 2 },
  ]);
  assert.equal(map.anchors.length, 2);
});

test('anchors need no sorting', () => {
  const map = buildTimemap([{ quarter: 8, time: 4 }, { quarter: 0, time: 0 }]);
  assert.equal(secondsAt(map, 4), 2);
});

test('a constant-tempo map is a two-anchor map', () => {
  const map = constantTimemap({ quarterBpm: 120, offsetSeconds: 0.5, totalQuarters: 16 });
  assert.equal(secondsAt(map, 0), 0.5);
  assert.equal(secondsAt(map, 16), 8.5);
});

test('fitConstantTempo averages noisy taps', () => {
  const anchors = [
    { quarter: 0, time: 0.02 }, { quarter: 4, time: 1.98 },
    { quarter: 8, time: 4.03 }, { quarter: 12, time: 5.99 },
  ];
  const fit = fitConstantTempo(anchors);
  assert.ok(Math.abs(fit.quarterBpm - 120) < 1, `bpm was ${fit.quarterBpm}`);
  assert.ok(fit.rmsSeconds < 0.05);
});

test('a tempo cannot be fitted from anchors at one position', () => {
  assert.throws(() => fitConstantTempo([{ quarter: 4, time: 1 }, { quarter: 4, time: 2 }]), AlignmentError);
  assert.throws(() => fitConstantTempo([{ quarter: 0, time: 0 }]), AlignmentError);
});

test('a hundred anchors stay monotone and fast', () => {
  const anchors = Array.from({ length: 100 }, (_, i) => ({ quarter: i * 4, time: i * 2 + Math.sin(i) * 0.1 }));
  const map = buildTimemap(anchors);
  let previous = -Infinity;
  for (let q = 0; q < 400; q += 0.25) {
    const t = secondsAt(map, q);
    assert.ok(t > previous, `time went backwards at quarter ${q}`);
    previous = t;
  }
});
