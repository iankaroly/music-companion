// MusicXML -> the structured score the alignment API serves.
//
// THE ONE IDEA THIS FILE IS BUILT ON: every musical object gets a position on a
// single rational clock measured in QUARTER NOTES from the start of the score.
// MusicXML itself does not give you that — it gives you `divisions` (ticks per
// quarter, which may CHANGE mid-score), a cursor that moves forward through
// <note> elements and jumps with <backup>/<forward> so several voices can share
// one measure, and <chord/> notes that do not advance the cursor at all.
// Getting that walk right is the whole job; once every note carries
// `startQuarter`, aligning to audio is a one-dimensional problem.
//
// Divisions are converted to quarters IMMEDIATELY (`ticks / divisions`) rather
// than kept as ticks, because a score whose divisions change from 480 to 24
// half way through would otherwise need every downstream consumer to know it.
//
// What is deliberately NOT modelled: engraving (beams, stems, slurs), because
// nothing downstream plays them. Layout hints (page, system, default-x/y) ARE
// kept, because highlighting the bar you are hearing is the point of the
// feature and that needs to know where on the page it sits.

import { parseXml, XmlNode } from './xml.js';

/** Semitones above C for each letter name. */
const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Quarter-lengths of the written note types.
 *
 * Durations come from <duration> and <divisions>, never from here — the type is
 * how the note is DRAWN and a scanned score's two can disagree. This is used
 * only to read a metronome mark, where "dotted quarter = 60" has to be turned
 * into quarter-notes a minute.
 */
const TYPE_QUARTERS = {
  maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1,
  eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625,
  '128th': 0.03125, '256th': 0.015625, '512th': 0.0078125, '1024th': 0.00390625,
};

export class MusicXmlError extends Error {}

/** Round to 1e-6 of a quarter. Keeps 1/3-of-a-beat triplets from drifting. */
function q(value) {
  return Math.round(value * 1e6) / 1e6;
}

function pitchToMidi(pitchEl) {
  const step = pitchEl.textOf('step');
  const semitone = LETTER_SEMITONES[step];
  if (semitone === undefined) return null;
  const octave = pitchEl.numberOf('octave', 4);
  const alter = pitchEl.numberOf('alter', 0);
  // MIDI 60 = C4, so octave -1 is the zero octave.
  return (octave + 1) * 12 + semitone + alter;
}

/**
 * score-timewise -> score-partwise.
 *
 * Almost nothing writes timewise, but the format is legal and a score that
 * parses as "0 parts" is a mystifying failure. Regrouping is cheap insurance.
 */
function toPartwise(root) {
  if (root.name === 'score-partwise') return root;
  if (root.name !== 'score-timewise') {
    throw new MusicXmlError(`expected <score-partwise>, found <${root.name}> — this file is not MusicXML`);
  }
  /** @type {Map<string, XmlNode>} */
  const partsById = new Map();
  for (const measureEl of root.all('measure')) {
    for (const partEl of measureEl.all('part')) {
      const id = partEl.attrs.id;
      if (!partsById.has(id)) partsById.set(id, new XmlNode('part', { id }));
      // The <measure> wrapper keeps its own attributes (number, width); the
      // children come from the <part> that was nested inside it.
      const measureCopy = new XmlNode('measure', measureEl.attrs);
      measureCopy.children = partEl.children;
      partsById.get(id).children.push(measureCopy);
    }
  }
  const partwise = new XmlNode('score-partwise', root.attrs);
  for (const tag of ['work', 'identification', 'part-list']) {
    const el = root.child(tag);
    if (el) partwise.children.push(el);
  }
  partwise.children.push(...partsById.values());
  return partwise;
}

/** Names of the parts, from <part-list>. */
function readPartList(root) {
  const list = root.child('part-list');
  const names = new Map();
  if (!list) return names;
  for (const sp of list.all('score-part')) {
    names.set(sp.attrs.id, {
      name: sp.textOf('part-name'),
      abbreviation: sp.textOf('part-abbreviation'),
      instrument: sp.child('score-instrument')?.textOf('instrument-name') ?? null,
      midiProgram: sp.child('midi-instrument')?.numberOf('midi-program', null) ?? null,
    });
  }
  return names;
}

/** <sound tempo="..."> or a <metronome> mark, as quarter-notes per minute. */
function readTempo(directionEl) {
  const sound = directionEl.child('sound');
  const direct = sound?.attrNumber('tempo', null);
  if (direct) return direct;

  const metronome = directionEl.child('direction-type')?.child('metronome');
  if (!metronome) return null;
  const perMinute = metronome.numberOf('per-minute', null);
  const beatUnit = metronome.textOf('beat-unit');
  if (!perMinute || !beatUnit) return null;
  const unitQuarters = (TYPE_QUARTERS[beatUnit] ?? 1) * (metronome.all('beat-unit-dot').length ? 1.5 : 1);
  return perMinute * unitQuarters; // "dotted quarter = 60" is 90 quarter-notes a minute
}

/** Repeat and ending marks on a measure, used later to unfold the performance. */
function readBarlines(measureEl) {
  const marks = { repeatForward: false, repeatBackward: false, repeatTimes: 2, endings: [] };
  for (const bar of measureEl.all('barline')) {
    const repeat = bar.child('repeat');
    if (repeat?.attrs.direction === 'forward') marks.repeatForward = true;
    if (repeat?.attrs.direction === 'backward') {
      marks.repeatBackward = true;
      const times = Number(repeat.attrs.times);
      if (Number.isFinite(times) && times >= 2) marks.repeatTimes = times;
    }
    const ending = bar.child('ending');
    if (ending) {
      const numbers = String(ending.attrs.number ?? '')
        .split(',').map((n) => Number(n.trim())).filter(Number.isFinite);
      marks.endings.push({
        type: ending.attrs.type ?? 'start',
        location: bar.attrs.location ?? 'right',
        numbers,
      });
    }
  }
  return marks;
}

/** da capo / dal segno / coda words that we record but do not yet follow. */
function readJumps(measureEl) {
  const jumps = [];
  for (const sound of measureEl.walk()) {
    if (sound.name !== 'sound') continue;
    for (const key of ['dacapo', 'dalsegno', 'segno', 'coda', 'tocoda', 'fine']) {
      if (sound.attrs[key] !== undefined) jumps.push({ kind: key, value: sound.attrs[key] });
    }
  }
  return jumps;
}

/**
 * Parse a MusicXML document into a Score.
 *
 * @param {string} source MusicXML text (already un-zipped if it came as .mxl)
 * @param {{sourceId?: string}} [meta]
 * @returns {object} Score — plain JSON-serialisable data, no class instances,
 *   because it is written to disk and served over HTTP unchanged.
 */
export function parseMusicXml(source, meta = {}) {
  let root;
  try {
    root = toPartwise(parseXml(source));
  } catch (err) {
    throw new MusicXmlError(`could not read the MusicXML: ${err.message}`);
  }

  const partInfo = readPartList(root);
  const work = root.child('work')?.textOf('work-title') ?? null;
  const movement = root.textOf('movement-title');
  const creators = {};
  for (const creator of root.child('identification')?.all('creator') ?? []) {
    creators[creator.attrs.type || 'creator'] = creator.text.trim();
  }

  const parts = root.all('part').map((partEl, partIndex) => readPart(partEl, partIndex, partInfo));

  return {
    schemaVersion: 1,
    title: work ?? movement ?? meta.title ?? null,
    composer: creators.composer ?? null,
    software: root.child('identification')?.child('encoding')?.textOf('software') ?? null,
    parts,
    // A score-level summary saves every client from walking the parts to answer
    // "how long is this?" — the first question an audio aligner asks.
    totalQuarters: parts.reduce((max, p) => Math.max(max, p.totalQuarters), 0),
    measureCount: parts.reduce((max, p) => Math.max(max, p.measures.length), 0),
  };
}

function readPart(partEl, partIndex, partInfo) {
  const id = partEl.attrs.id || `P${partIndex + 1}`;
  const info = partInfo.get(id) ?? {};

  // State that survives from measure to measure — MusicXML only writes these
  // when they CHANGE, so a measure with no <attributes> inherits everything.
  let divisions = 1;
  let time = { beats: 4, beatType: 4 };
  let key = { fifths: 0, mode: null };
  let clefs = [];
  let staves = 1;
  let page = 1;
  let system = 1;
  let cursorQuarters = 0; // start of the current measure, in score quarters

  const measures = [];
  const tempoMarks = [];

  for (const [index, measureEl] of partEl.all('measure').entries()) {
    // --- print / layout ------------------------------------------------
    const print = measureEl.child('print');
    if (print) {
      // new-page implies a new system; count both so a client can group
      // measures into the rectangles they are actually drawn in.
      if (print.attrs['new-page'] === 'yes') { page += 1; system = 1; }
      else if (print.attrs['new-system'] === 'yes') { system += 1; }
      const pageNumber = Number(print.attrs['page-number']);
      if (Number.isFinite(pageNumber) && pageNumber > 0) page = pageNumber;
    }
    // The very first measure is page 1 system 1 even without a <print>.
    if (index === 0) { page = Number(print?.attrs['page-number']) || 1; system = 1; }

    // --- attributes ----------------------------------------------------
    // <attributes> may appear more than once in a measure (mid-bar clef change).
    // Take them in order; the last one wins for state carried forward.
    for (const attrs of measureEl.all('attributes')) {
      const d = attrs.numberOf('divisions', null);
      if (d && d > 0) divisions = d;
      const timeEl = attrs.child('time');
      if (timeEl) {
        time = {
          beats: Number(timeEl.textOf('beats', time.beats)) || time.beats,
          beatType: Number(timeEl.textOf('beat-type', time.beatType)) || time.beatType,
          symbol: timeEl.attrs.symbol ?? null,
        };
      }
      const keyEl = attrs.child('key');
      if (keyEl) key = { fifths: keyEl.numberOf('fifths', 0), mode: keyEl.textOf('mode') };
      const clefEls = attrs.all('clef');
      if (clefEls.length) {
        clefs = clefEls.map((c) => ({
          staff: c.attrNumber('number', 1),
          sign: c.textOf('sign', 'G'),
          line: c.numberOf('line', 2),
          octaveChange: c.numberOf('clef-octave-change', 0),
        }));
      }
      staves = attrs.numberOf('staves', staves);
    }

    // --- tempo ---------------------------------------------------------
    for (const direction of measureEl.all('direction')) {
      const bpm = readTempo(direction);
      if (bpm) {
        // <offset> is in divisions from the direction's position; we place the
        // mark at the bar line, which is where all but the fussiest scores put it.
        tempoMarks.push({ measureIndex: index, startQuarter: q(cursorQuarters), quarterBpm: bpm });
      }
    }

    // --- the note walk --------------------------------------------------
    const notes = [];
    let cursor = 0;          // position inside the measure, in quarters
    let lastStart = 0;       // where the previous non-chord note began
    let maxReach = 0;        // furthest any voice got — the measure's real length
    let noteSeq = 0;

    for (const el of measureEl.children) {
      if (el.name === 'backup') {
        cursor = Math.max(0, cursor - el.numberOf('duration', 0) / divisions);
        continue;
      }
      if (el.name === 'forward') {
        cursor += el.numberOf('duration', 0) / divisions;
        maxReach = Math.max(maxReach, cursor);
        continue;
      }
      if (el.name === 'attributes') {
        const d = el.numberOf('divisions', null);
        if (d && d > 0) divisions = d; // mid-measure divisions change
        continue;
      }
      if (el.name !== 'note') continue;

      const isChord = el.child('chord') !== null;
      const isGrace = el.child('grace') !== null;
      const isRest = el.child('rest') !== null;
      const isCue = el.child('cue') !== null;

      // Grace notes carry no <duration>: they are stolen from a neighbour, so
      // they get zero length and sit exactly where the cursor is. An aligner
      // treats them as ornaments on the following note.
      const durationQuarters = isGrace
        ? 0
        : q(el.numberOf('duration', 0) / divisions);

      const startQuarter = isChord ? lastStart : cursor;

      const pitchEl = el.child('pitch') ?? el.child('unpitched');
      const midi = el.child('pitch') ? pitchToMidi(el.child('pitch')) : null;

      const ties = new Set([
        ...el.all('tie').map((t) => t.attrs.type),
        ...(el.child('notations')?.all('tied').map((t) => t.attrs.type) ?? []),
      ]);

      const voice = el.textOf('voice', '1');
      const note = {
        id: `${id}-m${index}-v${voice}-n${noteSeq++}`,
        measureIndex: index,
        voice,
        staff: el.numberOf('staff', 1),
        startQuarter: q(cursorQuarters + startQuarter),
        measureQuarter: q(startQuarter),       // offset inside the bar
        durationQuarters,
        type: el.textOf('type'),
        dots: el.all('dot').length,
        rest: isRest,
        chord: isChord,
        grace: isGrace,
        cue: isCue,
        midi,
        pitch: pitchEl && el.child('pitch') ? {
          step: pitchEl.textOf('step'),
          alter: pitchEl.numberOf('alter', 0),
          octave: pitchEl.numberOf('octave', 4),
        } : null,
        tieStart: ties.has('start'),
        tieStop: ties.has('stop'),
        // Where it is drawn. default-x is tenths from the left of the measure,
        // default-y tenths above the staff's bottom line. Kept raw: turning
        // them into page pixels needs the renderer's scaling, and the client
        // doing the highlighting is the one that knows it.
        layout: {
          page,
          system,
          defaultX: el.attrNumber('default-x', null),
          defaultY: el.attrNumber('default-y', null),
        },
      };

      // Grace notes must not move the cursor; chord members must not move it
      // a second time.
      if (!isChord && !isGrace) {
        lastStart = cursor;
        cursor = q(cursor + durationQuarters);
        maxReach = Math.max(maxReach, cursor);
      } else if (isChord) {
        maxReach = Math.max(maxReach, q(startQuarter + durationQuarters));
      }

      notes.push(note);
    }

    const nominalQuarters = q((time.beats * 4) / time.beatType);
    // A pickup bar, or a bar the OMR mis-read, is shorter than the time
    // signature says. Trust what is written — the audio follows the notes that
    // are there, not the ones that should be.
    const measureQuarters = q(maxReach || nominalQuarters);

    measures.push({
      index,
      number: measureEl.attrs.number ?? String(index + 1),
      startQuarter: q(cursorQuarters),
      durationQuarters: measureQuarters,
      nominalQuarters,
      // A bar shorter than its time signature and not the first is a signal
      // that the OMR dropped something; surface it rather than hide it.
      irregular: measureQuarters !== nominalQuarters,
      implicit: measureEl.attrs.implicit === 'yes', // a pickup, unnumbered
      time: { ...time },
      key: { ...key },
      clefs: clefs.map((c) => ({ ...c })),
      staves,
      layout: { page, system, width: measureEl.attrNumber('width', null) },
      barlines: readBarlines(measureEl),
      jumps: readJumps(measureEl),
      noteCount: notes.length,
      notes,
    });

    cursorQuarters = q(cursorQuarters + measureQuarters);
  }

  return {
    id,
    index: partIndex,
    name: info.name ?? null,
    abbreviation: info.abbreviation ?? null,
    instrument: info.instrument ?? null,
    midiProgram: info.midiProgram ?? null,
    staves,
    tempoMarks,
    totalQuarters: q(cursorQuarters),
    measures,
  };
}
