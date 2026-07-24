// YIN pitch detection (de Cheveigné & Kawahara, 2002).
// Returns { frequency, confidence }. frequency is null when no periodic
// candidate clears the threshold — silence, noise, or out-of-range input.
export function yin(buffer, sampleRate, options = {}) {
  // Default range covers the full piano: A0 (27.5 Hz) to C8 (4186 Hz).
  const { threshold = 0.1, minFreq = 26, maxFreq = 4500 } = options;

  const n = buffer.length;
  const w = Math.floor(n / 2); // integration window
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), w);
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));

  // Step 1+2: difference function over candidate lags.
  const diff = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const d = buffer[j] - buffer[j + lag];
      sum += d * d;
    }
    diff[lag] = sum;
  }

  // Step 3: cumulative mean normalized difference. Dips below 1 mark
  // candidate periods; normalization removes the bias toward lag 0.
  const cmnd = new Float64Array(maxLag + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    runningSum += diff[lag];
    cmnd[lag] = runningSum === 0 ? 1 : (diff[lag] * lag) / runningSum;
  }

  // Step 4: absolute threshold — take the FIRST dip below threshold (then
  // ride it to its local minimum), not the global minimum. This is what
  // prevents octave errors on harmonically rich signals.
  let tau = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (cmnd[lag] < threshold) {
      while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) lag++;
      tau = lag;
      break;
    }
  }
  if (tau === -1) {
    let best = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (cmnd[lag] < cmnd[best]) best = lag;
    }
    // No dip cleared the threshold and even the best candidate is weak:
    // treat as unpitched.
    if (cmnd[best] > 0.3) return { frequency: null, confidence: Math.max(0, 1 - cmnd[best]) };
    tau = best;
  }

  // Step 5: parabolic interpolation around the minimum for sub-sample
  // period precision (worth several cents at cello frequencies).
  let refinedTau = tau;
  if (tau > 1 && tau < maxLag) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) refinedTau = tau + (s2 - s0) / denom;
  }

  return { frequency: sampleRate / refinedTau, confidence: 1 - cmnd[tau] };
}
