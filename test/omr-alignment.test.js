import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseScore } from '../src/analysis/musicxml.js';
import { alignScore } from '../src/analysis/align-score.js';

// Real Audiveris output from a photographed page. Its key signature flips
// between systems, so every F in the sections it read as C major is written
// natural — a semitone below what is printed on the paper.
const READ = readFileSync(new URL('./fixtures/recognised-page.musicxml', import.meta.url), 'utf8');

describe('a score read off a photograph keeps its own clock', () => {
  it('puts every bar where its time signature says, not where the reading drifted to', () => {
    const loose = parseScore(READ, { partIndex: 0 });
    const steady = parseScore(READ, { partIndex: 0, steadyBars: true });
    const sig = steady.timeSignature;
    const nominal = (sig.beats * 4) / sig.beatType;

    const offTheGrid = (score) => {
      const bars = [...new Set(score.notes.map((n) => n.measureIndex))].sort((a, b) => a - b);
      let off = 0;
      let worst = 0;
      for (const bar of bars) {
        const first = score.notes.find((n) => n.measureIndex === bar);
        const gap = Math.abs((first.onsetBeats - first.beatInMeasure) - bar * nominal);
        if (gap > 0.01) off += 1;
        worst = Math.max(worst, gap);
      }
      return { off, worst, bars: bars.length };
    };

    // Without it, the reading's own arithmetic moves the music: a bar it read
    // short is a note it missed, and the deficit is never repaid.
    const before = offTheGrid(loose);
    expect(before.off).toBeGreaterThan(20);
    expect(before.worst).toBeGreaterThan(5);      // beats — seconds of drift

    const after = offTheGrid(steady);
    expect(after.off).toBe(0);
    expect(after.worst).toBeLessThan(0.01);
  });

  it('leaves a pickup bar short, because a short first bar is real', () => {
    const steady = parseScore(READ, { partIndex: 0, steadyBars: true });
    const first = steady.notes.find((n) => n.measureIndex === 0);
    expect(first.onsetBeats - first.beatInMeasure).toBe(0);
  });

  it('does not touch a score nobody read off a page', () => {
    const plain = parseScore(READ, { partIndex: 0 });
    const alsoPlain = parseScore(READ, { partIndex: 0, steadyBars: false });
    expect(plain.notes.map((n) => n.onsetBeats)).toEqual(alsoPlain.notes.map((n) => n.onsetBeats));
  });
});

describe('what the player is accused of', () => {
  // Playing the page EXACTLY as printed. The paper has F sharps; the reading
  // lost some of them, so a faithful performance disagrees with the file by a
  // semitone in those bars.
  const asPrinted = () => {
    const chunks = READ.split(/(?=<measure )/);
    let key = null;
    return chunks.map((bar) => {
      const found = /<fifths>(-?\d+)<\/fifths>/.exec(bar);
      if (found) key = found[1];
      if (key !== '0') return bar;
      return bar.replace(/<pitch>(\s*)<step>F<\/step>/g, '<pitch>$1<step>F</step><alter>1</alter>');
    }).join('');
  };

  it('stops calling a note wrong when the reader is the one that was wrong', () => {
    const read = parseScore(READ, { partIndex: 0, steadyBars: true }).notes;
    const played = parseScore(asPrinted(), { partIndex: 0, steadyBars: true }).notes
      .map((n, i) => ({ midi: n.midi, at: i * 0.5, dur: 0.4 }));

    const strict = alignScore(played, read);
    const forgiving = alignScore(played, read, { nearMiss: true });

    // The file and the paper disagree, so there is something to forgive.
    expect(strict.wrong).toBeGreaterThan(0);
    expect(forgiving.wrong).toBe(0);
    // And nothing is lost by forgiving it: the same notes are still paired.
    expect(forgiving.attempts.filter((a) => a.played).length)
      .toBeGreaterThanOrEqual(strict.attempts.filter((a) => a.played).length);
  });
});

describe('what a short take is told about the rest of the page', () => {
  it('does not accuse the player of missing music they never reached', () => {
    const score = parseScore(READ, { partIndex: 0, steadyBars: true }).notes;
    // One line, played correctly, against a whole page — which is what
    // practising a passage IS.
    const take = score.slice(0, 12).map((n, i) => ({ midi: n.midi, at: i * 0.5, dur: 0.4 }));
    const aligned = alignScore(take, score, { nearMiss: true });

    expect(aligned.matched).toBe(12);
    // The other 176 are the rest of the page, not 176 failures.
    expect(aligned.missed).toBe(0);
    expect(aligned.notReached).toBe(score.length - 12);
  });

  it('still calls a note missed when the take played through it', () => {
    const score = parseScore(READ, { partIndex: 0, steadyBars: true }).notes;
    const take = score.slice(0, 12)
      .filter((_, i) => i !== 5)                    // one note simply not played
      .map((n, i) => ({ midi: n.midi, at: i * 0.5, dur: 0.4 }));
    const aligned = alignScore(take, score, { nearMiss: true });
    expect(aligned.missed).toBe(1);
  });

  it('and silence against a score is still notes that did not sound', () => {
    const score = parseScore(READ, { partIndex: 0 }).notes;
    const aligned = alignScore([], score);
    expect(aligned.missed).toBe(score.length);
    expect(aligned.notReached ?? 0).toBe(0);
  });
});
