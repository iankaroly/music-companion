import { describe, test, expect } from 'vitest';
import { qualityOf, compareQuality } from '../src/analysis/quality.js';

// A take built from known parts: every note is `len` seconds of a steady pitch
// with chosen vibrato, readings every 11.6 ms like the Analyzer's hop.
const HOP = 512 / 44100;
function take({ vibratoCents = 0, vibratoHz = 5.5, wander = 0, rms = 0.1, conf = 0.95, notes = 8, len = 0.8, rmsStep = 0 }) {
  const ns = [];
  const readings = [];
  let t = 0.1;
  for (let i = 0; i < notes; i++) {
    const midi = 55 + (i % 4) * 2;
    const f0 = 440 * 2 ** ((midi - 69) / 12);
    ns.push({ start: t, end: t + len, midi, name: `n${midi}`, cents: 0 });
    for (let k = 0; k < Math.floor(len / HOP); k++) {
      const time = t + k * HOP;
      const cents = vibratoCents * Math.sin(2 * Math.PI * vibratoHz * k * HOP)
        + wander * Math.sin(2 * Math.PI * 1.3 * k * HOP + i);
      readings.push({ time, frequency: f0 * 2 ** (cents / 1200), confidence: conf, rms: rms * (1 + rmsStep * (i % 2)), attack: 0 });
    }
    t += len + 0.1;
  }
  return { notes: ns, readings };
}

describe('qualityOf', () => {
  test('reads the vibrato it was built with', () => {
    const q = qualityOf(take({ vibratoCents: 25, vibratoHz: 5.5 }));
    expect(q.vibrato.share).toBeGreaterThan(0.8);
    expect(q.vibrato.rateHz).toBeGreaterThan(4.5);
    expect(q.vibrato.rateHz).toBeLessThan(6.5);
    expect(q.vibrato.widthCents).toBeGreaterThan(15);
    expect(q.vibrato.widthCents).toBeLessThan(35);
  });

  test('a straight tone has no vibrato and its wander is the steadiness number', () => {
    const calm = qualityOf(take({ wander: 2 }));
    const shaky = qualityOf(take({ wander: 9 }));
    expect(calm.vibrato.share).toBe(0);
    expect(shaky.steadinessCents).toBeGreaterThan(calm.steadinessCents * 2);
  });

  test('clarity follows the pitch confidence and loudness range follows rms', () => {
    const clean = qualityOf(take({ conf: 0.97 }));
    const rough = qualityOf(take({ conf: 0.7 }));
    expect(clean.clarity).toBeGreaterThan(rough.clarity + 0.2);
    const flat = qualityOf(take({ rmsStep: 0 }));
    const contrast = qualityOf(take({ rmsStep: 3 }));
    expect(contrast.dynamics.rangeDb).toBeGreaterThan(flat.dynamics.rangeDb + 6);
  });

  test('brightness: a sound with strong upper harmonics reads higher than a pure tone', () => {
    const sr = 44100;
    const base = take({});
    const make = (harmonics) => {
      const audio = new Float32Array(Math.ceil(sr * 8));
      for (const n of base.notes) {
        const f0 = 440 * 2 ** ((n.midi - 69) / 12);
        for (let i = Math.floor(n.start * sr); i < Math.min(audio.length, Math.floor(n.end * sr)); i++) {
          let v = 0;
          for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * f0 * h * i / sr) / h;
          audio[i] = 0.2 * v;
        }
      }
      return qualityOf({ ...base, audio, sampleRate: sr });
    };
    expect(make(12).brightness).toBeGreaterThan(make(1).brightness * 1.3);
  });

  test('too few notes gives null rather than a number from one note', () => {
    const q = qualityOf(take({ notes: 3 }));
    expect(q.steadinessCents).toBeNull();
    expect(q.vibrato).toBeNull();
  });
});

describe('compareQuality', () => {
  test('says what changed without grading what cannot be graded', () => {
    const a = qualityOf(take({ vibratoCents: 16, wander: 0 }));
    const b = qualityOf(take({ vibratoCents: 35, wander: 0 }));
    const rows = compareQuality(a, b);
    const width = rows.find((r) => r.key === 'vibrato-width');
    expect(width.verdict).toBe('wider vibrato');
    expect(width.better).toBeUndefined();
  });

  test('steadier IS graded, in the right direction', () => {
    const shaky = qualityOf(take({ wander: 9 }));
    const calm = qualityOf(take({ wander: 1 }));
    const row = compareQuality(shaky, calm).find((r) => r.key === 'steadiness');
    expect(row.verdict).toBe('steadier within notes');
    expect(row.better).toBe(true);
  });

  test('an unmeasured side is reported as unmeasured', () => {
    const a = qualityOf(take({ notes: 3 }));
    const b = qualityOf(take({}));
    expect(compareQuality(a, b).find((r) => r.key === 'steadiness').verdict).toBe('unmeasured');
  });
});
