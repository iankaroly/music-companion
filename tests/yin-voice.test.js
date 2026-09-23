// A BREATHY VOICE, through YIN itself. Two faults, both measured on sung vowels
// with breath noise under them (see the voice section of tools/tuner-check.mjs):
//
//   - the period was read off the normalised curve, which noise TILTS, so a
//     breathy "ee" read 10-17 cents sharp on average;
//   - with no dip clearing the threshold, the DEEPEST dip was taken, and under
//     noise that is the one at twice the period — an octave down, at 0.8
//     confidence, a third of the time.
import { describe, it, expect } from 'vitest';
import { yin } from '../src/audio/yin.js';

const SR = 48000;

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOWELS = {
  a: [[800, 80], [1150, 90], [2900, 120]],
  i: [[280, 50], [2250, 100], [2900, 120]],
};

// One analysis window of a sung vowel, `breath` = noise-to-voice RMS ratio.
function vowel(midi, which, breath, rand) {
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const amps = [];
  for (let h = 1; h * f0 < 5000; h++) {
    let g = 0;
    for (const [fc, bw] of VOWELS[which]) g += 1 / Math.sqrt(1 + ((h * f0 - fc) / bw) ** 2);
    amps.push(g / h ** 1.5);
  }
  const norm = Math.sqrt(amps.reduce((s, a) => s + (a * a) / 2, 0));
  const phase = amps.map(() => rand() * 2 * Math.PI);
  const buf = new Float32Array(2048);
  for (let i = 0; i < buf.length; i++) {
    let v = 0;
    for (let h = 0; h < amps.length; h++) v += amps[h] * Math.sin((h + 1) * 2 * Math.PI * f0 * i / SR + phase[h]);
    buf[i] = v / norm + breath * Math.sqrt(3) * (rand() * 2 - 1);
  }
  return { buf, f0 };
}

const cents = (f, f0) => 1200 * Math.log2(f / f0);

describe('YIN on a breathy voice', () => {
  it('does not read a breathy "ee" sharp', () => {
    const rand = mulberry(11);
    for (const midi of [40, 48, 60]) {
      const errs = [];
      for (let k = 0; k < 60; k++) {
        const { buf, f0 } = vowel(midi, 'i', 0.25, rand);
        const r = yin(buf, SR);
        if (r.frequency && Math.abs(cents(r.frequency, f0)) < 50) errs.push(cents(r.frequency, f0));
      }
      const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
      expect(Math.abs(mean)).toBeLessThan(3);
    }
  });

  it('does not drop an octave when the noise keeps every dip above the threshold', () => {
    const rand = mulberry(5);
    let wrong = 0;
    let total = 0;
    for (const midi of [48, 55, 60, 67, 72]) {
      for (let k = 0; k < 40; k++) {
        const { buf, f0 } = vowel(midi, 'a', 0.4, rand);
        const r = yin(buf, SR);
        if (!r.frequency || r.confidence < 0.6) continue;
        total++;
        if (Math.abs(cents(r.frequency, f0)) > 50) wrong++;
      }
    }
    expect(total).toBeGreaterThan(150);
    expect(wrong / total).toBeLessThan(0.03);
  });
});
