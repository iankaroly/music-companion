// Questions a player's screen asks 60 times a second.
//
// "The recording is at 41.2 seconds — which bar is that, which beat of it, and
// which noteheads are sounding?" Everything here is a lookup against the
// timeline and the timemap; no scanning of the score, no re-parsing, and no
// allocation in the hot path beyond the answer itself.
//
// Binary search rather than a linear scan matters: a 300-bar piece with a
// repeat is 600 spans and 4000 events, and this is called on every animation
// frame while the audio plays.

import { quarterAtSeconds, secondsAt } from './timemap.js';

/** Index of the last element whose `key` is <= value, or -1. */
function lastAtOrBefore(items, key, value) {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid][key] <= value) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Beat number (1-based, in the bar's own beat unit) of a position in a bar. */
function beatIn(span, quarter) {
  const beatQuarters = 4 / (span.time?.beatType ?? 4);
  return Math.round(((quarter - span.startQuarter) / beatQuarters + 1) * 1000) / 1000;
}

/**
 * Where the performance is at `seconds`.
 *
 * @param {object} timeline from buildTimeline
 * @param {object} timemap from buildTimemap
 * @param {number} seconds position in the recording
 * @returns {object} the cursor: musical position, the bar it is in, the events
 *   sounding, and how long until the next attack — which is what a UI needs to
 *   schedule its next repaint instead of polling.
 */
export function cursorAt(timeline, timemap, seconds) {
  const quarter = quarterAtSeconds(timemap, seconds);

  const spanIndex = lastAtOrBefore(timeline.measures, 'startQuarter', quarter);
  const span = spanIndex >= 0 ? timeline.measures[spanIndex] : null;

  // Events are sorted by startQuarter, so everything that could still be
  // sounding starts at or before `quarter`. Walk back only as far as the
  // longest note we have seen — bounded, not the whole score.
  const sounding = [];
  let nextEvent = null;
  const startIndex = lastAtOrBefore(timeline.events, 'startQuarter', quarter);
  for (let i = startIndex; i >= 0; i -= 1) {
    const event = timeline.events[i];
    if (event.rest) continue;
    if (event.startQuarter + event.durationQuarters > quarter) sounding.push(event);
    // Stop once we are further back than any plausible note length. Four bars
    // of common time is the bound; a note tied across more than that drops out
    // of `sounding` early. That is a deliberate trade — the alternative is
    // walking to the start of the piece on every animation frame — and it costs
    // a highlight on a pedal note, not a wrong position.
    if (quarter - event.startQuarter > 16) break;
  }
  for (let i = startIndex + 1; i < timeline.events.length; i += 1) {
    if (timeline.events[i].rest) continue;
    nextEvent = timeline.events[i];
    break;
  }

  return {
    seconds,
    quarter,
    finished: quarter >= timeline.totalQuarters,
    measure: span && {
      ordinal: span.ordinal,
      measureIndex: span.measureIndex,
      measureNumber: span.measureNumber,
      pass: span.pass,
      beat: beatIn(span, quarter),
      page: span.layout?.page ?? null,
      system: span.layout?.system ?? null,
      startTime: secondsAt(timemap, span.startQuarter),
      endTime: secondsAt(timemap, span.startQuarter + span.durationQuarters),
    },
    // noteIds point at noteheads on the PAGE (one per printed note), which is
    // what a highlighter draws on; ids are unique per playing.
    sounding: sounding.map((e) => ({
      id: e.id, noteId: e.noteId, midi: e.midi, staff: e.staff, voice: e.voice,
    })),
    nextEvent: nextEvent && {
      id: nextEvent.id,
      noteId: nextEvent.noteId,
      time: secondsAt(timemap, nextEvent.startQuarter),
      inSeconds: Math.max(0, secondsAt(timemap, nextEvent.startQuarter) - seconds),
    },
  };
}

/**
 * Every note, with its start and end in seconds.
 *
 * This is the table an audio-sync feature actually consumes — for scheduling
 * playback, for drawing a piano roll under the waveform, and for scoring a take
 * note by note against what is printed.
 */
export function schedule(timeline, timemap, { from = -Infinity, to = Infinity, includeRests = false } = {}) {
  const out = [];
  for (const event of timeline.events) {
    if (event.rest && !includeRests) continue;
    const startTime = secondsAt(timemap, event.startQuarter);
    const endTime = secondsAt(timemap, event.startQuarter + event.durationQuarters);
    if (endTime < from || startTime > to) continue;
    out.push({
      id: event.id,
      noteId: event.noteId,
      measureNumber: event.measureNumber,
      measureIndex: event.measureIndex,
      ordinal: event.ordinal,
      pass: event.pass,
      voice: event.voice,
      staff: event.staff,
      midi: event.midi,
      pitch: event.pitch,
      rest: event.rest,
      startQuarter: event.startQuarter,
      durationQuarters: event.durationQuarters,
      startTime,
      endTime,
      durationSeconds: Math.round((endTime - startTime) * 1e6) / 1e6,
      tiedNoteIds: event.tiedNoteIds,
      layout: event.layout,
    });
  }
  return out;
}

/** The same, one row per bar — the grid a tap-along UI draws. */
export function measureSchedule(timeline, timemap) {
  return timeline.measures.map((span) => ({
    ordinal: span.ordinal,
    measureIndex: span.measureIndex,
    measureNumber: span.measureNumber,
    pass: span.pass,
    page: span.layout?.page ?? null,
    system: span.layout?.system ?? null,
    time: span.time,
    startQuarter: span.startQuarter,
    durationQuarters: span.durationQuarters,
    startTime: secondsAt(timemap, span.startQuarter),
    endTime: secondsAt(timemap, span.startQuarter + span.durationQuarters),
  }));
}
