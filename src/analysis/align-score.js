// Lining a take up against the score it was meant to be.
//
// scoring.js:alignScale is the ancestor of this: same belief that a re-bowed
// note, a skipped one and a stray squeak are all normal playing rather than
// errors to choke on. But that one walks forward greedily, and a greedy walk
// cannot undo a decision — play the opening twice, or hold a wrong note where
// the right one belonged, and every note after it lands on the wrong degree.
// Real music has both, so this is a full edit distance with a traceback: it
// sees the whole take before deciding what anything was.
//
// The costs are the whole design. They encode what is more likely: that you
// played the written note badly (cheap), that you played a different note
// (dearer), or that a note is missing or extra entirely (dearest). Reading a
// wrong note as an insert plus a delete would lose the one thing worth saying
// about it — WHICH note it should have been.

const COST = {
  match: 0,
  octave: 0.5, // right note, wrong register — still tells you something
  wrong: 1.4, // must stay under insert + delete, or wrong notes derail the path
  insert: 1.0, // a played note the score does not have
  delete: 1.0, // a score note that never sounded
};

const DIAGONAL = 0;
const UP = 1; // consume a score note, nothing played
const LEFT = 2; // consume a played note, nothing written

function substitution(scoreNote, playedNote) {
  const distance = playedNote.midi - scoreNote.midi;
  if (distance === 0) return { cost: COST.match, verdict: 'match' };
  if (distance % 12 === 0) return { cost: COST.octave, verdict: 'octave' };
  return { cost: COST.wrong, verdict: 'wrong' };
}

// Contiguous runs of the same pass above zero. A run nobody played is a repeat
// that was not taken, which is a choice — not the same as missing the notes.
function repeatRuns(scoreNotes) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= scoreNotes.length; i++) {
    const pass = scoreNotes[i]?.pass ?? 0;
    if (pass > 0 && start === -1) start = i;
    else if (!(pass > 0) && start !== -1) {
      runs.push([start, i]);
      start = -1;
    }
  }
  return runs;
}

export function alignScore(playedNotes, scoreNotes) {
  const played = playedNotes ?? [];
  const score = scoreNotes ?? [];
  if (score.length === 0) throw new Error('the score has no notes to align against');

  const S = score.length;
  const P = played.length;
  const width = P + 1;

  // A 10-minute take against a long movement is a few thousand by a few
  // thousand: tens of MB as doubles, a quarter of that as Float32.
  const dist = new Float32Array((S + 1) * width);
  const from = new Uint8Array((S + 1) * width);

  for (let i = 1; i <= S; i++) {
    dist[i * width] = i * COST.delete;
    from[i * width] = UP;
  }
  for (let j = 1; j <= P; j++) {
    dist[j] = j * COST.insert;
    from[j] = LEFT;
  }

  for (let i = 1; i <= S; i++) {
    const scoreNote = score[i - 1];
    const row = i * width;
    const above = (i - 1) * width;
    for (let j = 1; j <= P; j++) {
      const diagonal = dist[above + j - 1] + substitution(scoreNote, played[j - 1]).cost;
      const up = dist[above + j] + COST.delete;
      const left = dist[row + j - 1] + COST.insert;

      // Ties go UP — to leaving the LATER score note unplayed. The tie that
      // actually happens is a repeat: play a repeated bar once and matching it
      // to the first pass costs exactly what matching it to the second does.
      // Preferring UP settles that the way a player would read it, as the
      // first time through with the repeat not taken. A real match still wins
      // outright, since matching costs 0 and skipping costs 1.
      let best = up;
      let step = UP;
      if (diagonal < best) { best = diagonal; step = DIAGONAL; }
      if (left < best) { best = left; step = LEFT; }
      dist[row + j] = best;
      from[row + j] = step;
    }
  }

  const attempts = new Array(S);
  const extras = [];
  let i = S;
  let j = P;
  while (i > 0 || j > 0) {
    const step = i === 0 ? LEFT : j === 0 ? UP : from[i * width + j];
    if (step === DIAGONAL) {
      const scoreNote = score[i - 1];
      const playedNote = played[j - 1];
      const { verdict } = substitution(scoreNote, playedNote);
      attempts[i - 1] = {
        scoreNoteId: scoreNote.id,
        pass: scoreNote.pass ?? 0,
        score: scoreNote,
        played: playedNote,
        verdict,
      };
      i--; j--;
    } else if (step === UP) {
      const scoreNote = score[i - 1];
      attempts[i - 1] = {
        scoreNoteId: scoreNote.id,
        pass: scoreNote.pass ?? 0,
        score: scoreNote,
        played: null,
        verdict: 'missed',
      };
      i--;
    } else {
      extras.push(played[j - 1]);
      j--;
    }
  }
  extras.reverse();

  for (const [start, end] of repeatRuns(score)) {
    const untouched = attempts.slice(start, end).every((a) => a.played === null);
    if (!untouched) continue;
    for (let k = start; k < end; k++) attempts[k].verdict = 'not-taken';
  }

  // One notehead, however many times it is visited. The view draws the last
  // pass that actually sounded and badges the count.
  const byNote = new Map();
  const latest = new Map();
  for (const attempt of attempts) {
    if (!byNote.has(attempt.scoreNoteId)) byNote.set(attempt.scoreNoteId, []);
    byNote.get(attempt.scoreNoteId).push(attempt);
    if (attempt.played || !latest.has(attempt.scoreNoteId)) {
      latest.set(attempt.scoreNoteId, attempt);
    }
  }

  const count = (verdict) => attempts.filter((a) => a.verdict === verdict).length;
  return {
    attempts,
    byNote,
    latest,
    extras,
    matched: attempts.filter((a) => a.played !== null).length,
    wrong: count('wrong') + count('octave'),
    missed: count('missed'),
    notTaken: count('not-taken'),
    extra: extras.length,
  };
}
