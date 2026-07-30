import { describe, it, expect } from 'vitest';
import { inferGrid, fitGrid, fitPhase, tempoCurve, rhythmReport } from '../src/analysis/rhythm.js';

// Note lists shaped like the segmenter's output: what rhythm.js actually reads
// is `start` (and `end` for the fill ratio).
function notesAt(starts, { fill = 0.9 } = {}) {
  return starts.map((start, i) => {
    const next = starts[i + 1] ?? start + 0.5;
    return { midi: 48 + (i % 8), name: 'C3', cents: 0, start, end: start + fill * (next - start) };
  });
}

function evenStarts(count, period, from = 0) {
  return Array.from({ length: count }, (_, i) => from + i * period);
}

describe('inferGrid', () => {
  it('reads even quarters as their own grid', () => {
    const g = inferGrid(evenStarts(16, 0.6));
    expect(g.grid).toBeCloseTo(0.6, 2);
    expect(g.bpm).toBeGreaterThan(97);
    expect(g.bpm).toBeLessThan(103);
  });

  it('hears eighths as a subdivision, not as the beat', () => {
    // 120 bpm played in even eighths: the grid is the eighth (0.25 s) but the
    // tempo a musician would name is still 120, not 240.
    const g = inferGrid(evenStarts(24, 0.25));
    expect(g.grid).toBeCloseTo(0.25, 2);
    expect(g.bpm).toBeGreaterThan(115);
    expect(g.bpm).toBeLessThan(125);
  });

  it('finds the shared grid under a mix of quarters and eighths', () => {
    // 120 bpm: quarter, two eighths, repeated
    const starts = [];
    for (let bar = 0; bar < 6; bar++) {
      const t = bar * 1.5;
      starts.push(t, t + 0.5, t + 0.75, t + 1.0, t + 1.25);
    }
    const g = inferGrid(starts);
    expect(g.grid).toBeCloseTo(0.25, 2);
    expect(g.bpm).toBeGreaterThan(112);
    expect(g.bpm).toBeLessThan(128);
  });

  it('names the tempo a musician would count, not a slow multiple of it', () => {
    // A stream of notes every 0.3 s is 100 bpm in eighths. Phrase structure can
    // make some longer multiple correlate best (three notes per bar, say), but
    // reporting 67 bpm for this would be wrong.
    const g = inferGrid(evenStarts(32, 0.3));
    expect(g.grid).toBeCloseTo(0.3, 2);
    expect(g.bpm).toBeGreaterThan(95);
    expect(g.bpm).toBeLessThan(105);
  });

  it('gives up on too few onsets to imply a pulse', () => {
    expect(inferGrid([0, 0.5, 1.0])).toBeNull();
    expect(inferGrid([])).toBeNull();
  });
});

describe('fitGrid', () => {
  it('reports near-zero deviation for a metronomic run', () => {
    const starts = evenStarts(12, 0.5);
    const fit = fitGrid(starts, 0.5);
    expect(fit.grid).toBeCloseTo(0.5, 3);
    for (const d of fit.deviations) expect(Math.abs(d)).toBeLessThan(0.004);
  });

  it('pins the deviation on the one note that came in late', () => {
    const starts = evenStarts(12, 0.5);
    starts[6] += 0.06; // 60 ms late
    const fit = fitGrid(starts, 0.5);
    expect(fit.deviations[6]).toBeGreaterThan(0.045);
    // its neighbours stay honest — the fit doesn't smear the error around
    expect(Math.abs(fit.deviations[5])).toBeLessThan(0.02);
    expect(Math.abs(fit.deviations[7])).toBeLessThan(0.02);
  });

  it('keeps the grid assignment when a note is missing from the run', () => {
    const starts = evenStarts(12, 0.5).filter((_, i) => i !== 5);
    const fit = fitGrid(starts, 0.5);
    expect(fit.grid).toBeCloseTo(0.5, 2);
    for (const d of fit.deviations) expect(Math.abs(d)).toBeLessThan(0.01);
  });
});

describe('tempoCurve', () => {
  it('is flat for a steady take', () => {
    const curve = tempoCurve(evenStarts(20, 0.5), 0.5);
    const bpms = curve.map((p) => p.bpm);
    expect(Math.max(...bpms) - Math.min(...bpms)).toBeLessThan(4);
    expect(bpms[0]).toBeCloseTo(120, 0);
  });

  it('rises through an accelerando', () => {
    // each interval 3% shorter than the last
    const starts = [0];
    let step = 0.6;
    for (let i = 0; i < 20; i++) { starts.push(starts.at(-1) + step); step *= 0.97; }
    const curve = tempoCurve(starts, 0.6);
    expect(curve.at(-1).bpm).toBeGreaterThan(curve[0].bpm + 10);
  });
});

describe('rhythmReport', () => {
  it('calls a metronomic take steady and centred', () => {
    const r = rhythmReport(notesAt(evenStarts(16, 0.5)));
    expect(r.bpm).toBeCloseTo(120, 0);
    expect(r.meanAbsMs).toBeLessThan(6);
    expect(r.verdict).toBe('steady');
    expect(r.worst).toHaveLength(0);
  });

  it('reports the tempo curve in the same units as the headline tempo', () => {
    // Notes every 0.3 s: the grid is the 0.3 s subdivision but the beat is
    // 0.6 s, and a curve counting grid steps would plot at double the bpm the
    // tiles show.
    const r = rhythmReport(notesAt(evenStarts(32, 0.3)));
    for (const point of r.curve) {
      expect(Math.abs(point.bpm - r.bpm)).toBeLessThan(r.bpm * 0.1);
    }
  });

  it('flags the late note and reports how late', () => {
    const starts = evenStarts(16, 0.5);
    starts[9] += 0.07;
    const r = rhythmReport(notesAt(starts));
    expect(r.worst.length).toBeGreaterThan(0);
    expect(r.worst[0].index).toBe(9);
    expect(r.worst[0].deviationMs).toBeGreaterThan(50);
    expect(r.worst[0].verdict).toBe('late');
    expect(r.notes[9].verdict).toBe('late');
    expect(r.notes[8].verdict).toBe('on');
  });

  it('calls out rushing when the take speeds up', () => {
    const starts = [0];
    let step = 0.6;
    for (let i = 0; i < 24; i++) { starts.push(starts.at(-1) + step); step *= 0.985; }
    const r = rhythmReport(notesAt(starts));
    expect(r.drift).toBeLessThan(0);
    expect(r.verdict).toBe('rushing');
  });

  it('blames no individual note once the tempo itself has moved', () => {
    // A smooth accelerando is not 24 late entries. Every note's neighbourhood
    // is at a slightly different tempo, so the residuals are the drift — and
    // telling a player the 22nd note was 200 ms late would be a lie.
    const starts = [0];
    let step = 0.6;
    for (let i = 0; i < 24; i++) { starts.push(starts.at(-1) + step); step *= 0.985; }
    const r = rhythmReport(notesAt(starts));
    expect(r.drifting).toBe(true);
    expect(r.worst).toEqual([]);
  });

  it('still names notes on a take whose tempo held still', () => {
    const starts = evenStarts(20, 0.5);
    starts[8] += 0.08;
    const r = rhythmReport(notesAt(starts));
    expect(r.drifting).toBe(false);
    expect(r.worst.map((w) => w.index)).toEqual([8]);
  });

  it('blames nobody for a phrase that breathes and comes back', () => {
    // Rubato leaves no take-wide drift at all — the first third and the last
    // third are at the same tempo — so the drift verdict cannot catch it, and
    // the notes at the peak of the stretch were being called 150 ms errors.
    const gaps = [
      ...Array(8).fill(0.5),
      0.55, 0.62, 0.7, 0.62, 0.55,
      ...Array(8).fill(0.5),
    ];
    const starts = [0];
    for (const g of gaps) starts.push(starts.at(-1) + g);
    const r = rhythmReport(notesAt(starts));
    expect(r.drifting).toBe(false);        // nothing drifted, correctly
    expect(r.flagged.length).toBeGreaterThan(0); // the deviations are real
    expect(r.worst).toEqual([]);           // ...but they are not the player's fault
  });

  it('blames nobody in the steady half of a take with two tempi in it', () => {
    // No single grid suits 120 and 88, so the one that gets fitted suits
    // neither — and the section played metronomically came out looking as
    // wrong as the section that changed.
    const starts = [0];
    for (let i = 0; i < 9; i++) starts.push(starts.at(-1) + 0.5);
    for (let i = 0; i < 10; i++) starts.push(starts.at(-1) + 60 / 88);
    const r = rhythmReport(notesAt(starts));
    expect(r.worst).toEqual([]);
  });

  it('calls out dragging when the take slows down', () => {
    const starts = [0];
    let step = 0.5;
    for (let i = 0; i < 24; i++) { starts.push(starts.at(-1) + step); step *= 1.015; }
    const r = rhythmReport(notesAt(starts));
    expect(r.drift).toBeGreaterThan(0);
    expect(r.verdict).toBe('dragging');
  });

  it('measures each note against the local pulse, not a line through the whole take', () => {
    // A player whose timing wanders (each note continues from the last, jitter
    // and all) has NOT played every later note late — a global grid would say
    // otherwise, and would bury the two real mistakes in the noise.
    const starts = [0];
    for (let i = 0; i < 20; i++) starts.push(starts.at(-1) + 0.6 + Math.sin(i * 1.9) * 0.025);
    starts[7] -= 0.08; // one note clearly early
    starts[14] += 0.09; // one note clearly late
    const r = rhythmReport(notesAt(starts));
    expect(r.worst.map((w) => w.index).sort((a, b) => a - b)).toEqual([7, 14]);
    expect(r.worst.find((w) => w.index === 7).verdict).toBe('early');
    expect(r.worst.find((w) => w.index === 14).verdict).toBe('late');
    expect(r.meanAbsMs).toBeLessThan(30); // the wander itself isn't an error
  });

  it('reads a long–short dotted figure on the subdivision, not the bar', () => {
    // 90 bpm, quarter + sixteenth alternating. Snapping this to the bar would
    // report half the notes as a sixth of a second out of place.
    const starts = [0];
    for (let i = 0; i < 30; i++) starts.push(starts.at(-1) + (i % 2 ? 1 / 6 : 0.5));
    const r = rhythmReport(notesAt(starts));
    expect(r.grid).toBeCloseTo(1 / 6, 1);
    expect(r.meanAbsMs).toBeLessThan(10);
    expect(r.verdict).toBe('steady');
  });

  it('returns null when there is nothing rhythmic to read', () => {
    expect(rhythmReport(notesAt([0, 1.2]))).toBeNull();
    expect(rhythmReport([])).toBeNull();
  });

  it('survives a free take with no pulse at all without inventing one', () => {
    // deliberately arrhythmic onsets: it may or may not find a grid, but it
    // must never claim the playing was steady
    const starts = [0, 0.31, 1.02, 1.13, 2.4, 2.44, 3.9, 5.2, 5.28, 6.9];
    const r = rhythmReport(notesAt(starts));
    if (r) expect(r.verdict).not.toBe('steady');
  });
});

describe('fitPhase', () => {
  it('finds the offset without moving the period it was given', () => {
    const onsets = evenStarts(12, 0.5, 0.18);
    const fit = fitPhase(onsets, 0.5);
    expect(fit.grid).toBe(0.5);
    expect(fit.phase).toBeCloseTo(0.18, 3);
    for (const d of fit.deviations) expect(Math.abs(d)).toBeLessThan(0.001);
  });

  it('keeps the given period even when the playing disagrees with it', () => {
    // played at 0.52 s against a 0.5 s grid: the fit must report the growing
    // lateness rather than quietly re-fitting to what was played
    const fit = fitPhase(evenStarts(10, 0.52), 0.5);
    expect(fit.grid).toBe(0.5);
    expect(Math.max(...fit.deviations)).toBeGreaterThan(0.05);
  });
});

describe('rhythmReport with a locked pulse', () => {
  it('measures against the named tempo, not the one that was played', () => {
    // 100 bpm played, 120 bpm asked for
    const r = rhythmReport(notesAt(evenStarts(16, 0.6)), { bpm: 120 });
    expect(r.locked).toBe(true);
    expect(r.bpm).toBe(120);
    expect(r.meanAbsMs).toBeGreaterThan(30);
  });

  it('accepts a subdivision so eighths score against a quarter-note tempo', () => {
    // even eighths at 120 bpm: against the beat alone every other note is half
    // a beat out, but with ÷2 they all land
    const eighths = notesAt(evenStarts(24, 0.25));
    expect(rhythmReport(eighths, { bpm: 120 }).meanAbsMs).toBeGreaterThan(100);
    const divided = rhythmReport(eighths, { bpm: 120, subdivision: 2 });
    expect(divided.meanAbsMs).toBeLessThan(6);
    expect(divided.bpm).toBe(120);
    expect(divided.onBeat).toBe(1);
  });

  it('still names late notes on a take that drifted', () => {
    // an accelerando: the inferred pulse declines to blame individual notes,
    // but against a click the player asked for, falling behind is the answer
    const starts = [0];
    let step = 0.5;
    for (let i = 0; i < 24; i++) { starts.push(starts.at(-1) + step); step *= 0.97; }
    const auto = rhythmReport(notesAt(starts));
    expect(auto.drifting).toBe(true);
    expect(auto.worst).toHaveLength(0);
    const locked = rhythmReport(notesAt(starts), { bpm: 120 });
    expect(locked.worst.length).toBeGreaterThan(0);
  });

  it('reports the share of notes that landed on the beat', () => {
    const r = rhythmReport(notesAt(evenStarts(16, 0.5)), { bpm: 120 });
    expect(r.onBeat).toBe(1);
    const sloppy = evenStarts(16, 0.5);
    sloppy[4] += 0.09;
    sloppy[9] -= 0.08;
    expect(rhythmReport(notesAt(sloppy), { bpm: 120 }).onBeat).toBeCloseTo(14 / 16, 2);
  });
});
