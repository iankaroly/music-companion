import { yin } from './yin.js';

// Comb filter: subtract the signal delayed by one period (fractional delay
// via linear interpolation). Nulls that frequency and all its multiples.
function comb(buffer, period) {
  const offset = Math.ceil(period);
  const out = new Float32Array(buffer.length - offset);
  for (let n = 0; n < out.length; n++) {
    const pos = n + offset - period;
    const i = Math.floor(pos);
    const frac = pos - i;
    out[n] = buffer[n + offset] - (buffer[i] * (1 - frac) + buffer[i + 1] * frac);
  }
  return out;
}

function centsBetween(a, b) {
  return Math.abs(1200 * Math.log2(a / b));
}

// Two-pitch detection for double stops.
//
// The subtlety: a double stop's *mixture* is periodic at the common
// fundamental (a fifth D3+A3 repeats at D2), so a single YIN pass returns
// that phantom base, not either played note. Strategy:
//   1. YIN gives the harmonic base f0 (true pitch, or the phantom).
//   2. Probe multiples k·f0: comb-cancel each; if a strong different pitch
//      survives the comb, k·f0 was a real constituent and the survivor is
//      its partner.
//   3. Cancel the survivor in the original signal to recover the partner
//      cleanly, and report the pair.
//
// Physical limit (documented): octaves/twelfths share all harmonics of the
// upper note, so they can't be separated and report as one pitch.
export function detectTwoPitches(buffer, sampleRate, options = {}) {
  const {
    minSecondaryConfidence = 0.5,
    minSeparationCents = 80,
    octaveGuardCents = 60,
    maxProbeFreq = 1200,
    ...yinOptions
  } = options;

  const base = yin(buffer, sampleRate, yinOptions);
  if (base.frequency === null) return { primary: base, secondary: null };

  for (let k = 2; base.frequency * k <= maxProbeFreq; k++) {
    const probeFreq = base.frequency * k;
    const survivor = yin(comb(buffer, sampleRate / probeFreq), sampleRate, yinOptions);
    if (survivor.frequency === null || survivor.confidence < minSecondaryConfidence) continue;
    if (centsBetween(survivor.frequency, base.frequency) < minSeparationCents) continue;

    const partner = yin(comb(buffer, sampleRate / survivor.frequency), sampleRate, yinOptions);
    if (partner.frequency === null || partner.confidence < minSecondaryConfidence) continue;
    if (centsBetween(partner.frequency, survivor.frequency) < minSeparationCents) continue;

    // A pair sitting on an integer ratio is one note's harmonics, not two strings.
    const ratio = Math.max(partner.frequency, survivor.frequency) /
                  Math.min(partner.frequency, survivor.frequency);
    if (centsBetween(ratio, Math.round(ratio)) < octaveGuardCents && Math.round(ratio) >= 1) continue;

    return { primary: partner, secondary: survivor };
  }

  return { primary: base, secondary: null };
}
