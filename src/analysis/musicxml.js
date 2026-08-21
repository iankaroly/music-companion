// MusicXML → the flat stream of notes a player actually plays.
//
// The alignment downstream does not care about beams, slurs, staves or
// engraving. It wants what the segmenter produces: an ordered list of pitches
// with times. So this reads a part and returns exactly that, with the score
// facts the annotation needs bolted on — which measure a note is in, and which
// pass through a repeat it belongs to.
//
// Repeats are EXPANDED. Play a repeated bar and you play it twice, so the
// stream holds it twice, with pass 0 and pass 1 but the SAME id: the id points
// at the notehead on the page, which is only drawn once.

import { parseXml } from './xml.js';

const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pitchToMidi(pitch) {
  const step = pitch.textOf('step');
  const octave = pitch.numberOf('octave', 4);
  const alter = pitch.numberOf('alter', 0);
  const semitone = LETTER_SEMITONES[step];
  if (semitone === undefined) return null;
  return (octave + 1) * 12 + semitone + alter;
}

function tieKinds(el) {
  // <tie> is the sounding tie; <tied> inside <notations> is the drawn slur-like
  // mark. Either one is written by real exporters, so accept both.
  const kinds = el.all('tie').map((t) => t.attrs.type);
  const notations = el.child('notations');
  if (notations) kinds.push(...notations.all('tied').map((t) => t.attrs.type));
  return kinds;
}

// --- repeats -----------------------------------------------------------
// Everything here works on measure elements, before any note is read, so the
// note walk below only ever sees a straight line of measures.

function barlines(measure, location) {
  return measure.all('barline').filter((b) => !location || b.attrs.location === location);
}

function hasRepeat(measure, direction) {
  return barlines(measure).some((b) => b.child('repeat')?.attrs.direction === direction);
}

function repeatTimes(measure) {
  for (const b of barlines(measure)) {
    const repeat = b.child('repeat');
    if (repeat?.attrs.direction === 'backward') return Number(repeat.attrs.times) || 2;
  }
  return 2;
}

// ['1', '2'] → [1, 2]. An ending with no number plays on every pass.
function endingStart(measure) {
  for (const b of barlines(measure)) {
    const ending = b.child('ending');
    if (ending && (ending.attrs.type === 'start' || ending.attrs.type === undefined)) {
      const numbers = String(ending.attrs.number ?? '')
        .split(',')
        .map((n) => Number(n.trim()))
        .filter(Number.isFinite);
      return numbers.length ? numbers : null;
    }
  }
  return null;
}

const MAX_STEPS = 20000; // a corrupt repeat structure must not hang the tab

export function playOrder(measures) {
  const out = [];
  const jumps = new Map();
  let i = 0;
  let repeatStart = 0;
  let pass = 0;
  let justJumped = false;
  let steps = 0;

  while (i < measures.length && steps++ < MAX_STEPS) {
    const measure = measures[i];

    // Arriving at a forward repeat opens a new section — unless we arrived by
    // jumping back to it, which is the same section going round again.
    if (hasRepeat(measure, 'forward') && !justJumped) {
      repeatStart = i;
      pass = 0;
    }
    justJumped = false;

    const ending = endingStart(measure);
    if (ending && !ending.includes(pass + 1)) {
      // Skip to the ending meant for this pass; if there isn't one, the piece
      // is over.
      let next = i + 1;
      while (next < measures.length) {
        const found = endingStart(measures[next]);
        if (found && found.includes(pass + 1)) break;
        next++;
      }
      if (next >= measures.length) break;
      i = next;
      continue;
    }

    out.push({ measure, index: i, pass });

    if (hasRepeat(measure, 'backward')) {
      const taken = (jumps.get(i) ?? 0) + 1;
      if (taken < repeatTimes(measure)) {
        jumps.set(i, taken);
        pass++;
        i = repeatStart;
        justJumped = true;
        continue;
      }
      // Leaving the section: forget the count so an outer repeat that comes
      // back through here takes it again.
      jumps.set(i, 0);
      pass = 0;
    }
    i++;
  }
  return out;
}

// --- parts -------------------------------------------------------------

function partsOf(root) {
  const list = root.child('part-list');
  const bodies = new Map(root.all('part').map((p) => [p.attrs.id, p]));
  const declared = list ? list.all('score-part') : [];
  const entries = declared.length
    ? declared.map((sp) => ({ id: sp.attrs.id, name: sp.textOf('part-name', sp.attrs.id ?? '') }))
    : [...bodies.keys()].map((id) => ({ id, name: id }));

  return entries.map((entry) => {
    const body = bodies.get(entry.id);
    let staves = 1;
    for (const measure of body?.all('measure') ?? []) {
      for (const attrs of measure.all('attributes')) {
        staves = Math.max(staves, attrs.numberOf('staves', 1));
      }
    }
    return { ...entry, staves, body };
  });
}

// --- the walk ----------------------------------------------------------

export function parseScore(xml, { partIndex = 0, steadyBars = false } = {}) {
  const root = typeof xml === 'string' ? parseXml(xml) : xml;
  if (root.name === 'score-timewise') {
    throw new Error('this is a score-timewise file; export it as score-partwise');
  }
  if (root.name !== 'score-partwise') {
    throw new Error(`not a MusicXML score: <${root.name}>`);
  }

  const parts = partsOf(root);
  const chosen = parts[partIndex];
  if (!chosen?.body) throw new Error(`no part at index ${partIndex}`);

  const title = root.child('work')?.textOf('work-title') || root.child('movement-title')?.text || '';
  const measures = chosen.body.all('measure');

  const notes = [];
  let divisions = 1;
  let firstDivisions = null;
  let timeSignature = null;
  let voice = null; // the first voice seen is the line we follow
  let measureStart = 0;
  // Outside the measure loop on purpose: a tie's whole reason for existing is
  // to cross a barline.
  let previous = null;

  for (const { measure, index, pass } of playOrder(measures)) {
    // Note ids come from the notated position, not the play order, so both
    // passes of a repeat land on the same notehead.
    const notated = measure.all('note');
    const idOf = (el) => `${chosen.id}-m${index}-n${notated.indexOf(el)}`;

    let cursor = 0; // in divisions, from the start of this measure
    let longest = 0;

    for (const el of measure.children) {
      if (el.name === 'attributes') {
        divisions = el.numberOf('divisions', divisions);
        if (firstDivisions === null) firstDivisions = divisions;
        const time = el.child('time');
        if (time) {
          timeSignature = {
            beats: Number(time.textOf('beats')) || 4,
            beatType: Number(time.textOf('beat-type')) || 4,
          };
        }
        continue;
      }
      if (el.name === 'backup') {
        cursor -= el.numberOf('duration', 0);
        continue;
      }
      if (el.name === 'forward') {
        cursor += el.numberOf('duration', 0);
        continue;
      }
      if (el.name !== 'note') continue;

      const duration = el.numberOf('duration', 0);
      const isChord = !!el.child('chord');
      const isGrace = !!el.child('grace');
      const isRest = !!el.child('rest');

      // A chord member is drawn under the note we already emitted; the engine
      // hears one line, so it colours that one notehead and moves on.
      if (isChord) {
        if (previous) previous.chord = true;
        continue;
      }

      const noteVoice = el.textOf('voice') || null;
      if (voice === null && !isRest) voice = noteVoice;
      const mine = noteVoice === null || voice === null || noteVoice === voice;

      const advance = () => {
        if (!isGrace) {
          cursor += duration;
          longest = Math.max(longest, cursor);
        }
      };

      if (isRest || !mine) { advance(); continue; }

      const pitch = el.child('pitch');
      const midi = pitch ? pitchToMidi(pitch) : null;
      if (midi === null) { advance(); continue; }

      const ties = tieKinds(el);
      const durBeats = isGrace ? 0 : duration / divisions;

      // A tie means one sounding note written twice. The segmenter will hear
      // one, so the score must present one.
      if (ties.includes('stop') && previous && previous.midi === midi && previous.tied) {
        previous.durBeats += durBeats;
        advance();
        continue;
      }

      const note = {
        id: idOf(el),
        midi,
        onsetBeats: measureStart + cursor / divisions,
        durBeats,
        measure: Number(measure.attrs.number ?? index + 1),
        // WHERE THE BAR IS, as against what it is called. A recogniser reading
        // a photograph writes the numbers it thinks it can see, and it gets
        // them wrong: one real page came back with two bars numbered 5, so
        // every bar after that was called one less than the engraver calls it
        // and the two readings of the same file stopped agreeing about which
        // notehead was which. Order is the thing both sides can be sure of.
        measureIndex: index,
        beatInMeasure: cursor / divisions,
        tied: ties.includes('start'),
        grace: isGrace,
        chord: false,
        voice: noteVoice,
        pass,
      };
      notes.push(note);
      previous = note;
      advance();
    }

    // The bar's own length, not the time signature's: pickups are short and a
    // cadenza bar can be any length at all.
    //
    // STEADY BARS, WHEN THE SCORE WAS READ OFF A PHOTOGRAPH. There, a bar that
    // comes up short is not a cadenza — it is a note the recogniser missed, and
    // the deficit is never repaid, so every bar after it starts early by the
    // running total. Measured on a real read page: the clock ends 8.79 beats —
    // four and a half seconds at 120 — ahead of the printed music, and with a
    // target tempo set (an absolute grid, no rebound) 176 of 188 notes came out
    // marked off the beat while the same report claimed zero drift.
    //
    // So on a read score the bars sit where the time signature says, and the
    // reading's own arithmetic is not allowed to move them. Stretching only the
    // SHORT bars halved the error and no more (13.04 beats to 5.04): the long
    // ones — bars the reader gave too much to — push everything after them late
    // just as surely. Pinned both ways it is exact: 0 of 36 bars off the
    // printed grid, against 33 of 36.
    //
    // WHAT IT COSTS: a note in a bar the reader over-filled now runs past the
    // barline. Its place INSIDE the bar is untouched, and the aligner pairs on
    // pitch alone, so nothing is mispaired by it — the error is one bar's
    // worth, in that bar, instead of every bar after it for the rest of the
    // piece. The first bar is exempt either way, because a short first bar is a
    // pickup and that is real.
    const nominal = timeSignature
      ? (timeSignature.beats * 4) / timeSignature.beatType
      : null;
    const measured = longest / divisions;
    measureStart += steadyBars && nominal && index > 0 ? nominal : measured;
  }

  return {
    notes,
    divisions: firstDivisions ?? divisions,
    timeSignature: timeSignature ?? { beats: 4, beatType: 4 },
    parts: parts.map(({ id, name, staves }) => ({ id, name, staves })),
    partIndex,
    title,
  };
}
