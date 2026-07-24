import { describe, test, expect } from 'vitest';
import { RingBuffer } from '../src/audio/ring-buffer.js';

describe('RingBuffer', () => {
  test('latest(n) returns the most recent n samples in order', () => {
    const rb = new RingBuffer(8);
    rb.write(Float32Array.from([1, 2, 3, 4]));
    rb.write(Float32Array.from([5, 6]));
    expect(Array.from(rb.latest(3))).toEqual([4, 5, 6]);
  });

  test('wraps around when writes exceed capacity', () => {
    const rb = new RingBuffer(4);
    rb.write(Float32Array.from([1, 2, 3]));
    rb.write(Float32Array.from([4, 5, 6]));
    expect(Array.from(rb.latest(4))).toEqual([3, 4, 5, 6]);
  });

  test('filled reports total samples written, capped at capacity', () => {
    const rb = new RingBuffer(4);
    expect(rb.filled).toBe(0);
    rb.write(Float32Array.from([1, 2, 3]));
    expect(rb.filled).toBe(3);
    rb.write(Float32Array.from([4, 5]));
    expect(rb.filled).toBe(4);
  });

  test('latest(n) pads with zeros when fewer than n samples were written', () => {
    const rb = new RingBuffer(8);
    rb.write(Float32Array.from([7, 8]));
    expect(Array.from(rb.latest(4))).toEqual([0, 0, 7, 8]);
  });

  test('a chunk larger than capacity keeps only its tail', () => {
    const rb = new RingBuffer(3);
    rb.write(Float32Array.from([1, 2, 3, 4, 5]));
    expect(Array.from(rb.latest(3))).toEqual([3, 4, 5]);
  });
});
