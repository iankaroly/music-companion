// Clip assembly for report playback. All pure — the AudioContext glue
// lives in the report UI.

function applyEdgeFades(samples, sampleRate, fadeSec) {
  const n = Math.min(Math.floor(fadeSec * sampleRate), Math.floor(samples.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    samples[i] *= g;
    samples[samples.length - 1 - i] *= g;
  }
}

// The clicked note at full volume with its neighbors audible but ducked,
// so you hear the moment in context while the target stays in front.
export function buildEmphasizedClip(recording, targetStart, targetEnd, options = {}) {
  const { contextSec = 1.2, contextGain = 0.35, rampSec = 0.05, edgeFadeSec = 0.02 } = options;
  const clipStart = Math.max(0, targetStart - contextSec);
  const clipEnd = Math.min(recording.duration, targetEnd + contextSec);
  const samples = recording.extract(clipStart, clipEnd);
  const sr = recording.sampleRate;

  for (let i = 0; i < samples.length; i++) {
    const t = clipStart + i / sr;
    let gain;
    if (t < targetStart - rampSec || t > targetEnd + rampSec) {
      gain = contextGain;
    } else if (t < targetStart) {
      gain = contextGain + (1 - contextGain) * (1 - (targetStart - t) / rampSec);
    } else if (t <= targetEnd) {
      gain = 1;
    } else {
      gain = contextGain + (1 - contextGain) * (1 - (t - targetEnd) / rampSec);
    }
    samples[i] *= gain;
  }
  applyEdgeFades(samples, sr, edgeFadeSec);

  return { samples, sampleRate: sr, targetOffset: targetStart - clipStart };
}

// Reference note, a beat of silence, then the target note — for hearing an
// out-of-tune note against another take of the same pitch from the same
// passage.
export function buildComparisonClip(recording, refNote, targetNote, options = {}) {
  const { padSec = 0.06, gapSec = 0.35, edgeFadeSec = 0.02 } = options;
  const sr = recording.sampleRate;

  const ref = recording.extract(refNote.start - padSec, refNote.end + padSec);
  const target = recording.extract(targetNote.start - padSec, targetNote.end + padSec);
  applyEdgeFades(ref, sr, edgeFadeSec);
  applyEdgeFades(target, sr, edgeFadeSec);

  const gap = Math.floor(gapSec * sr);
  const samples = new Float32Array(ref.length + gap + target.length);
  samples.set(ref, 0);
  samples.set(target, ref.length + gap);

  return { samples, sampleRate: sr, refDuration: ref.length / sr, gapDuration: gapSec };
}

// The most in-tune *other* rendition of the same pitch in this session.
export function findComparisonNote(notes, target) {
  let best = null;
  for (const note of notes) {
    if (note === target || note.midi !== target.midi) continue;
    if (!best || Math.abs(note.cents) < Math.abs(best.cents)) best = note;
  }
  return best;
}
