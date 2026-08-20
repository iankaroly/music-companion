// The score as it is PLAYED, not as it is printed.
//
// Two clocks exist in this pipeline and confusing them is the classic bug:
//
//   score quarters       position in the printed score. A repeated bar has ONE
//                        position, because it is drawn once.
//   performance quarters position in the performance. That same bar has TWO,
//                        because it is played twice.
//
// Audio aligns against PERFORMANCE quarters — the recording contains the repeat
// — while highlighting on the page needs the SCORE position. So every event
// here carries both, plus the pass number, and the page cursor is then just a
// lookup rather than arithmetic the client has to get right.
//
// Ties are merged here too: two tied crotchets are one attack in the audio, and
// an onset-based aligner that expects two will drift by a beat.

const noteCount = (part) => part.measures.reduce(
  (n, m) => n + m.notes.filter((note) => !note.rest).length, 0,
);

/** Round to 1e-6 of a quarter (see parse.js). */
function q(value) {
  return Math.round(value * 1e6) / 1e6;
}

const MAX_STEPS = 100000; // a corrupt repeat structure must not hang the server

/**
 * Decide the order the measures are played in.
 *
 * Handles forward/backward repeats (including `times="3"`) and numbered first-
 * and second-time endings. It does NOT follow da capo / dal segno / coda — those
 * are recorded on the measure as `jumps` and left for a caller to act on,
 * because scanned parts rarely carry them correctly and guessing wrong
 * mis-times the whole recording rather than a bar of it.
 *
 * @param {object[]} measures measures of the part that carries the barlines
 * @returns {{measureIndex:number, pass:number}[]}
 */
export function unfoldRepeats(measures) {
  const out = [];
  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let steps = 0;

  while (i < measures.length && steps++ < MAX_STEPS) {
    const m = measures[i];

    // A forward repeat opens a new section — but not when we have just jumped
    // back to it, or the pass counter would reset forever.
    if (m.barlines.repeatForward && i !== repeatStart) {
      repeatStart = i;
      pass = 1;
    }

    // A numbered ending we are not on this time round is skipped whole.
    const openEnding = m.barlines.endings.find((e) => e.type === 'start');
    if (openEnding && openEnding.numbers.length && !openEnding.numbers.includes(pass)) {
      let j = i;
      while (j < measures.length
        && !measures[j].barlines.endings.some((e) => e.type === 'stop' || e.type === 'discontinue')) j += 1;
      i = j + 1;
      continue;
    }

    out.push({ measureIndex: i, pass });

    if (m.barlines.repeatBackward) {
      if (pass < m.barlines.repeatTimes) {
        pass += 1;
        i = repeatStart;
        continue;
      }
      // Section finished. The next one starts after this bar unless a forward
      // repeat says otherwise.
      repeatStart = i + 1;
      pass = 1;
      i += 1;
      continue;
    }

    // The last ending of a section closes it even though no repeat sign does:
    // after a second-time bar, the music that follows is played once, on pass 1
    // again. Without this the pass counter would stay at 2 for the rest of the
    // piece and every later anchor would ask for a playing that never happened.
    if (m.barlines.endings.some((e) => e.type === 'stop' || e.type === 'discontinue')) {
      repeatStart = i + 1;
      pass = 1;
    }
    i += 1;
  }

  // A score with no measures still needs a valid (empty) plan.
  return out;
}

/**
 * Merge tied notes into single sounding events.
 *
 * A tie is only followed within the same part, voice, staff and pitch, and only
 * to the NEXT such note — a `tieStart` with no matching `tieStop` (which
 * happens constantly in OMR output, where the far end of the tie was missed)
 * leaves the first note standing on its own rather than swallowing the rest of
 * the piece.
 */
function mergeTies(events) {
  const open = new Map(); // "voice/staff/midi" -> event still waiting for its tie to end
  const merged = [];

  for (const event of events) {
    // Keyed on the exact pitch: if OMR read the far end of a tie a semitone
    // out, the two halves do not merge and the audio side sees two attacks
    // instead of one. Merging them on position alone would be worse — it would
    // silently join two genuinely different notes.
    const key = `${event.voice}/${event.staff}/${event.midi}`;
    if (event.tieStop && open.has(key)) {
      const head = open.get(key);
      head.durationQuarters = q(event.startQuarter + event.durationQuarters - head.startQuarter);
      head.tiedNoteIds.push(event.noteId);
      if (event.tieStart) open.set(key, head); else open.delete(key);
      continue; // the tail is not a separate attack
    }
    if (event.tieStart && event.midi !== null) open.set(key, event);
    merged.push(event);
  }
  return merged;
}

/**
 * Build the performance timeline for a score.
 *
 * @param {object} score from `parseMusicXml`
 * @param {{partId?: string}} [options] which part carries the repeat structure
 *   and which part's notes become events. Defaults to the first part — for a
 *   solo scan that is the only one.
 * @returns {object} timeline
 */
export function buildTimeline(score, options = {}) {
  // Which part the recording is of. Named explicitly when the caller knows;
  // otherwise the one with the MOST NOTES rather than simply the first, because
  // OMR splits a single scanned line across parts more often than it should —
  // one page of a concerto came back as a part with 8 notes and a part with
  // 121, and aligning a recording to the 8 would look like the pipeline had
  // lost the music.
  const part = options.partId
    ? score.parts.find((p) => p.id === options.partId)
    : [...score.parts].sort((a, b) => noteCount(b) - noteCount(a))[0];
  if (!part) throw new Error(`no such part: ${options.partId}`);

  const plan = unfoldRepeats(part.measures);

  // Lay the planned measures end to end on the performance clock.
  let clock = 0;
  const spans = plan.map((step, ordinal) => {
    const measure = part.measures[step.measureIndex];
    const span = {
      ordinal,                                   // 0-based position in the performance
      measureIndex: step.measureIndex,           // where it is on the page
      measureNumber: measure.number,
      pass: step.pass,
      startQuarter: q(clock),                    // performance clock
      durationQuarters: measure.durationQuarters,
      scoreStartQuarter: measure.startQuarter,   // printed-score clock
      time: measure.time,
      key: measure.key,
      layout: measure.layout,
    };
    clock = q(clock + measure.durationQuarters);
    return span;
  });

  // Then place every note inside its span.
  const events = [];
  for (const span of spans) {
    const measure = part.measures[span.measureIndex];
    for (const note of measure.notes) {
      events.push({
        id: `${note.id}@${span.ordinal}`,        // unique per playing
        noteId: note.id,                         // the notehead on the page — one per print
        partId: part.id,
        ordinal: span.ordinal,
        pass: span.pass,
        measureIndex: span.measureIndex,
        measureNumber: span.measureNumber,
        voice: note.voice,
        staff: note.staff,
        startQuarter: q(span.startQuarter + note.measureQuarter),
        durationQuarters: note.durationQuarters,
        scoreStartQuarter: note.startQuarter,
        midi: note.midi,
        pitch: note.pitch,
        rest: note.rest,
        chord: note.chord,
        grace: note.grace,
        tieStart: note.tieStart,
        tieStop: note.tieStop,
        tiedNoteIds: [],
        layout: note.layout,
      });
    }
  }

  events.sort((a, b) => a.startQuarter - b.startQuarter || a.staff - b.staff || (a.midi ?? 0) - (b.midi ?? 0));
  const sounding = mergeTies(events);

  // Tempo marks, moved onto the performance clock. A mark inside a repeated
  // section applies on every pass.
  const tempoMarks = [];
  for (const span of spans) {
    for (const mark of part.tempoMarks) {
      if (mark.measureIndex !== span.measureIndex) continue;
      tempoMarks.push({
        startQuarter: q(span.startQuarter + (mark.startQuarter - part.measures[span.measureIndex].startQuarter)),
        quarterBpm: mark.quarterBpm,
        measureIndex: span.measureIndex,
        ordinal: span.ordinal,
      });
    }
  }

  return {
    partId: part.id,
    totalQuarters: q(clock),
    measureCount: spans.length,
    repeated: spans.length !== part.measures.length,
    measures: spans,
    tempoMarks,
    events: sounding,
    noteCount: sounding.filter((e) => !e.rest).length,
  };
}

/**
 * Performance quarter position of a bar (and optional beat inside it).
 *
 * Anchors from a user tapping along say "bar 17" — this is what turns that into
 * a number the timemap can use. `pass` picks which playing of a repeated bar;
 * without it the FIRST playing is meant, which is what a person tapping bar 17
 * for the first time means.
 */
export function quarterAt(timeline, { measureNumber, measureIndex, ordinal, pass, beat = 1 }) {
  let span;
  if (ordinal !== undefined && ordinal !== null) {
    span = timeline.measures[ordinal];
  } else if (measureIndex !== undefined && measureIndex !== null) {
    span = timeline.measures.find((m) => m.measureIndex === measureIndex && (pass === undefined || m.pass === pass));
  } else if (measureNumber !== undefined && measureNumber !== null) {
    const wanted = String(measureNumber);
    span = timeline.measures.find((m) => String(m.measureNumber) === wanted && (pass === undefined || m.pass === pass));
  }
  if (!span) return null;

  // `beat` is 1-based and counted in the bar's own beat unit, the way a
  // musician counts: in 6/8, beat 2 is the second quaver.
  const beatQuarters = 4 / (span.time?.beatType ?? 4);
  const offset = Math.max(0, (Number(beat) || 1) - 1) * beatQuarters;
  return {
    quarter: q(span.startQuarter + Math.min(offset, span.durationQuarters)),
    span,
  };
}
