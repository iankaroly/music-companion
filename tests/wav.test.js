import { describe, test, expect } from 'vitest';
import { encodeWav } from '../src/audio/wav.js';

describe('encodeWav', () => {
  test('produces a valid RIFF/WAVE header', () => {
    const buf = encodeWav(new Float32Array(100), 44100);
    const view = new DataView(buf);
    const tag = (off) => String.fromCharCode(...new Uint8Array(buf, off, 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(tag(36)).toBe('data');
    expect(view.getUint32(4, true)).toBe(36 + 200);   // riff size
    expect(view.getUint32(40, true)).toBe(200);       // data bytes (16-bit mono)
    expect(view.getUint32(24, true)).toBe(44100);     // sample rate
    expect(view.getUint16(22, true)).toBe(1);         // mono
    expect(view.getUint16(34, true)).toBe(16);        // bit depth
  });

  test('converts samples to 16-bit PCM with clipping', () => {
    const buf = encodeWav(Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]), 8000);
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32767));
    expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 32768));
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
    expect(view.getInt16(54, true)).toBe(32767);   // clipped
    expect(view.getInt16(56, true)).toBe(-32768);  // clipped
  });
});
