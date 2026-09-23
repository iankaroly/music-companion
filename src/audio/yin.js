// YIN pitch detection (de Cheveigné & Kawahara, 2002).
// Returns { frequency, confidence }. frequency is null when no periodic
// candidate clears the threshold — silence, noise, or out-of-range input.
export function yin(buffer, sampleRate, options = {}) {
  // Default range covers the full piano: A0 (27.5 Hz) to C8 (4186 Hz).
  const { threshold = 0.1, minFreq = 26, maxFreq = 4500, nearBest = 0.03 } = options;

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
    // …but the DEEPEST dip is not the period when noise is in the way. Noise
    // lifts every dip by about the same amount and the one at twice the period
    // wins by a hair, so a breathy voice — whose dips never clear the
    // threshold — came back an octave down at 0.8 confidence. MEASURED, sung
    // vowels E2..G5 with breath 20 to 4 dB under the voice, 5040 windows: 1699
    // wrong with the deepest dip, 30 with the FIRST dip within `nearBest` of
    // it (92 at 0.02, 32 at 0.04, 180 at 0.1 — wider starts taking the formant
    // ripples near the shortest lags). The threshold path above, which is
    // every clean note, is untouched, and `npm run audio:fast` and the test
    // suite read the same with it on and off.
    if (nearBest > 0) {
      for (let lag = minLag + 1; lag < best; lag++) {
        if (cmnd[lag] <= cmnd[lag - 1] && cmnd[lag] <= cmnd[lag + 1] && cmnd[lag] <= cmnd[best] + nearBest) {
          tau = lag;
          break;
        }
      }
    }
  }

  // Step 5: WHERE the minimum is, read off the RAW difference function.
  //
  // The normalised curve above is the right thing for choosing WHICH dip is
  // the period and the wrong one for saying exactly where it sits. Noise adds
  // roughly a constant to every d(τ), and the normalisation multiplies by τ, so
  // noise tilts d'(τ) upward and slides its minimum toward shorter periods —
  // sharp. MEASURED, a sung "ee" at E2 with breath 12 dB under the voice: +33¢
  // on every window, and +7 to +9¢ on "ah" (scratchpad bias check behind
  // `npm run tuner:check`'s voice section). The paper says as much and takes
  // the final estimate from d(τ) itself; so does this, walking downhill from
  // the chosen lag and no further than a few per cent, so the choice of dip
  // made above is never overruled.
  const reach = Math.max(2, Math.round(tau * 0.04));
  let best = tau;
  for (let lag = Math.max(1, tau - reach); lag <= Math.min(maxLag, tau + reach); lag++) {
    if (diff[lag] < diff[best]) best = lag;
  }
  // Only a genuine local minimum of d counts; one pinned to the edge of the
  // search is a slope, not a period, and the old estimate stands.
  const settled = best > 1 && best < maxLag
    && diff[best] <= diff[best - 1] && diff[best] <= diff[best + 1];
  const at = settled ? best : tau;
  const curve = settled ? diff : cmnd;

  // Step 6: parabolic interpolation around the minimum for sub-sample
  // period precision (worth several cents at cello frequencies).
  let refinedTau = at;
  if (at > 1 && at < maxLag) {
    const s0 = curve[at - 1];
    const s1 = curve[at];
    const s2 = curve[at + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) refinedTau = at + (s2 - s0) / denom;
  }

  return { frequency: sampleRate / refinedTau, confidence: 1 - cmnd[tau] };
}
