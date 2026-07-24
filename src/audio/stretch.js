// WSOLA time-stretching: change duration without changing pitch.
//
// Rate-based slowdown shifts pitch (half speed = octave down), useless for
// intonation review. WSOLA instead re-tiles the waveform: short Hann-
// windowed frames are taken from the input at a slower advance than they
// are laid down in the output (50% overlap-add), and each frame's exact
// source position is chosen within a small search window to maximize
// cross-correlation with the previous frame's natural continuation — that
// alignment is what avoids phase-cancellation artifacts.
const FRAME = 2048;
const HOP_OUT = FRAME / 2;      // Hann at 50% overlap sums to unity gain
const SEARCH = 300;             // ± samples of alignment freedom
const CORR_LEN = 512;

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

const WINDOW = hann(FRAME);

export function timeStretch(input, sampleRate, speed) {
  if (Math.abs(speed - 1) < 0.001 || input.length < FRAME + 2 * SEARCH) {
    return input.slice(0);
  }

  const hopIn = Math.round(HOP_OUT * speed);
  const outLength = Math.ceil(input.length / speed);
  const out = new Float32Array(outLength + FRAME);

  let prevChosen = 0;
  for (let i = 0; i < FRAME; i++) out[i] += input[i] * WINDOW[i];

  for (let k = 1; ; k++) {
    const nominal = k * hopIn;
    const outPos = k * HOP_OUT;
    if (nominal + FRAME + SEARCH >= input.length || outPos + FRAME >= out.length) break;

    // The input position that would seamlessly continue the previous frame.
    const natural = prevChosen + HOP_OUT;
    let bestDelta = 0;
    let bestCorr = -Infinity;
    if (natural + CORR_LEN < input.length) {
      for (let d = -SEARCH; d <= SEARCH; d++) {
        const cand = nominal + d;
        if (cand < 0) continue;
        let corr = 0;
        for (let i = 0; i < CORR_LEN; i++) corr += input[cand + i] * input[natural + i];
        if (corr > bestCorr) { bestCorr = corr; bestDelta = d; }
      }
    }

    const chosen = nominal + bestDelta;
    for (let i = 0; i < FRAME; i++) out[outPos + i] += input[chosen + i] * WINDOW[i];
    prevChosen = chosen;
  }

  return out.subarray(0, outLength).slice(0);
}
