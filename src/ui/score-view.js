// The page you played from, wearing what you actually played.
//
// The music is RE-ENGRAVED from the MusicXML rather than annotated onto a
// photo. That was the deciding design choice: to put a mark on a specific
// notehead in a photograph you need pixel-accurate recognition coordinates on
// a picture taken at an angle, and a mark fifteen pixels out is indis-
// tinguishable from a bug. Engraving it ourselves means every notehead is a
// DOM element whose position we can simply ask for.
//
// OpenSheetMusicDisplay is loaded on FIRST USE, never at startup. It is about
// a megabyte, and it is the first runtime dependency this project has ever
// taken; the tuner, the metronome and the offline shell must not pay for a
// feature they don't open.

import { palette } from './theme.js';
import { intonationTone } from './chart-utils.js';
import { midiToName } from '../analysis/note-utils.js';
import { reconcile } from '../analysis/score-map.js';

let osmdModulePromise = null;

function loadEngraver() {
  osmdModulePromise ??= import('opensheetmusicdisplay');
  return osmdModulePromise;
}

// OSMD counts half tones from C0 = 0, MIDI counts from C-1 = 0, so the two
// scales sit an octave apart. Verified against a rendered score rather than
// assumed — see tests/score-view.browser.md.
const HALFTONE_TO_MIDI = 12;

// A quarter-note beat. OSMD measures time in whole notes.
const BEATS_PER_WHOLE = 4;

// Everything the reconciler needs to recognise a notehead, plus the notehead.
function engravedNotes(osmd, instrument) {
  const out = [];
  for (const staffMeasures of osmd.graphic?.MeasureList ?? []) {
    for (const measure of staffMeasures ?? []) {
      if (!measure) continue;
      if (instrument && measure.ParentStaff?.ParentInstrument !== instrument) continue;
      const number = measure.MeasureNumber;
      for (const entry of measure.staffEntries ?? []) {
        const beatInMeasure = (entry.relInMeasureTimestamp?.RealValue ?? 0) * BEATS_PER_WHOLE;
        for (const voiceEntry of entry.graphicalVoiceEntries ?? []) {
          for (const gnote of voiceEntry.notes ?? []) {
            const source = gnote.sourceNote;
            if (!source || source.isRest?.()) continue;
            out.push({
              measure: number,
              beatInMeasure,
              midi: source.halfTone + HALFTONE_TO_MIDI,
              gnote,
            });
          }
        }
      }
    }
  }
  return out;
}

// Warm for sharp, cool for flat, green for in tune. Size decides the tier,
// direction decides the family, so a page leaning one way is visible before a
// single number is read.
//
// A WRONG note gets no colour from this scale at all. Colouring it the same red
// as a badly sharp note says the two are the same kind of problem, and they are
// not: one is a note you need to hear better, the other is a note you did not
// play. It keeps its printed black and carries a mark instead, which leaves the
// whole colour scale meaning one thing — cents.
function verdictColour(attempt, colours) {
  if (!attempt) return null;
  if (attempt.verdict === 'missed') return colours.muted;
  if (attempt.verdict === 'not-taken') return null; // never played, nothing to say
  if (attempt.verdict === 'wrong' || attempt.verdict === 'octave') return null;

  const { tier, direction } = intonationTone(attempt.played.cents);
  if (tier === 'good') return colours.good;
  if (direction === 'flat') return tier === 'off' ? colours.flatOff : colours.flatBad;
  return tier === 'off' ? colours.off : colours.bad;
}

// Spoken form, because a coloured notehead says nothing to a screen reader.
function describe(attempt, timing) {
  if (!attempt) return null;
  const bar = `bar ${attempt.score?.measure ?? '?'}`;
  if (attempt.verdict === 'missed') return `${bar}: not played`;
  if (attempt.verdict === 'not-taken') return `${bar}: repeat not taken`;
  if (attempt.verdict === 'octave') return `${bar}: played an octave out`;
  if (attempt.verdict === 'wrong') return `${bar}: a different note was played`;

  const cents = Math.round(attempt.played.cents);
  const { direction } = intonationTone(attempt.played.cents);
  const tuning = direction === 'centred' ? 'in tune'
    : `${Math.abs(cents)} cents ${direction}`;
  const ms = timing?.deviationMs;
  if (ms === null || ms === undefined || timing.verdict === 'on') return `${bar}: ${tuning}`;
  return `${bar}: ${tuning}, ${Math.abs(Math.round(ms))} milliseconds ${timing.verdict}`;
}

export async function showScore(container, {
  xml,
  scoreNotes,
  partIndex = 0,
  aligned = null,
  timing = null,
  landings = null,
  onPickNote = null,
  zoom = 1,
} = {}) {
  const { OpenSheetMusicDisplay } = await loadEngraver();

  container.replaceChildren();
  const page = document.createElement('div');
  page.className = 'score-page';
  const overlay = document.createElement('div');
  overlay.className = 'score-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  container.append(page, overlay);

  const osmd = new OpenSheetMusicDisplay(page, {
    backend: 'svg', // the overlay and the per-notehead lookup both want real DOM
    drawTitle: true,
    drawPartNames: false,
    autoResize: false, // re-rendered on our own terms, so marks and page stay in step
  });
  // "Endless" instead of a paper size: this is a panel on a phone, not a sheet
  // to print, and A4 leaves most of a blank page hanging under a two-bar
  // exercise. The margins go with it for the same reason.
  osmd.setPageFormat('Endless');
  osmd.EngravingRules.PageTopMargin = 1;
  osmd.EngravingRules.PageBottomMargin = 1;
  osmd.EngravingRules.PageLeftMargin = 1;
  osmd.EngravingRules.PageRightMargin = 1;
  osmd.zoom = zoom;
  await osmd.load(xml);

  // Show only the line that was played. A cellist reading their own part
  // should not be handed the whole quartet.
  const instruments = osmd.sheet?.Instruments ?? [];
  const instrument = instruments[partIndex] ?? null;
  if (instruments.length > 1 && instrument) {
    for (const other of instruments) other.Visible = other === instrument;
  }
  osmd.render();

  const engraved = engravedNotes(osmd, instruments.length > 1 ? instrument : null);
  const { map, unmatched, ok } = reconcile(scoreNotes ?? [], engraved);

  const view = {
    osmd,
    page,
    overlay,
    map,
    unmatched,
    ok,
    last: null,
    // Ring the bars of a passage so tapping its name in the list shows you
    // where on the page it actually is.
    highlightBars(from, to) {
      for (const el of page.querySelectorAll('.bar-marked')) el.classList.remove('bar-marked');
      let first = null;
      for (const [, engraved] of map) {
        const bar = engraved.measure;
        if (bar < from || bar > to) continue;
        const el = engraved.gnote.getSVGGElement?.();
        if (!el) continue;
        el.classList.add('bar-marked');
        first ??= el;
      }
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    // Every mark is placed from a measured notehead box, so a reflow that moves
    // the noteheads has to redraw the marks in the same breath — otherwise they
    // stay behind, pointing at whatever note has moved under them.
    relayout() {
      if (!this.last) return;
      osmd.render();
      paint(this, this.last);
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      overlay.replaceChildren();
      container.replaceChildren();
    },
  };

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => view.relayout(), 150);
  }
  window.addEventListener('resize', onResize);

  if (aligned) paint(view, { aligned, timing, landings, onPickNote });
  return view;
}

// Colour every notehead by what happened on it, and hang the marks that OSMD
// has no concept of over the top.
export function paint(view, {
  aligned, timing = null, landings = null, onPickNote = null, comparison = null,
} = {}) {
  const colours = palette();
  const { map, overlay, page } = view;
  view.last = { aligned, timing, landings, onPickNote, comparison };
  overlay.replaceChildren();

  const timingByNote = new Map();
  for (const entry of timing?.perNote ?? []) {
    if (entry.scoreNoteId) timingByNote.set(entry.scoreNoteId, entry);
  }

  // Only the worst few get an arrow. Against a target tempo almost every note
  // is off the fixed grid — play a steady 120 against 104 and all twenty-nine
  // are late, which is true and unreadable. The report already ranks them, so
  // the page marks that ranking and the sentence above it carries the count.
  const flagged = new Set((timing?.worst ?? []).map((n) => n.scoreNoteId).filter(Boolean));

  // Played note → the notehead drawn for it, so the playhead can light the
  // right one. Keyed on the note OBJECT: two notes can share a pitch and a bar
  // and still be different notes, and the object is what playback hands back.
  const noteheads = new Map();
  view.noteheadFor = (note) => noteheads.get(note) ?? null;

  const pageBox = page.getBoundingClientRect();

  for (const [scoreNoteId, engravedNote] of map) {
    const attempts = aligned.byNote.get(scoreNoteId) ?? [];
    // A repeated notehead is drawn once and played more than once. It wears
    // the LATEST pass that actually sounded, and says how many there were.
    const attempt = aligned.latest.get(scoreNoteId) ?? attempts.at(-1) ?? null;
    // In comparison mode the page answers a different question — not "how in
    // tune is this note" but "is it better than last time" — so the whole
    // colour scale is replaced rather than mixed with. Notes with no history
    // go grey: no comparison exists, and colouring them by intonation would
    // put two meanings on the page at once.
    const change = comparison?.get(scoreNoteId) ?? null;
    const colour = comparison
      ? (change
        ? { better: colours.good, worse: colours.bad, same: colours.muted }[change.verdict]
        : colours.muted)
      : verdictColour(attempt, colours);
    const gnote = engravedNote.gnote;

    if (colour) {
      try {
        gnote.setColor(colour, { applyToStem: true, applyToBeams: false });
      } catch {
        // An engraver that will not take a colour is not a reason to lose the
        // whole page — the marks below still land.
      }
    }

    const element = gnote.getSVGGElement?.();
    if (!element) continue;

    // Every pass that sounded points at this one notehead, so playing a
    // repeated bar lights it both times round.
    for (const a of attempts) if (a.played) noteheads.set(a.played, element);

    const label = comparison
      ? (change
        ? `bar ${attempt?.score?.measure ?? '?'}: ${Math.abs(change.delta).toFixed(0)} cents ${change.verdict === 'better' ? 'closer' : change.verdict === 'worse' ? 'further' : 'the same'} than last time`
        : null)
      : describe(attempt, timingByNote.get(scoreNoteId));
    if (label) {
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', label);
    }

    if (onPickNote && attempt?.played) {
      element.style.cursor = 'pointer';
      element.addEventListener('click', () => onPickNote(attempt));
    }

    const box = element.getBoundingClientRect();
    const x = box.left - pageBox.left + box.width / 2;
    const y = box.top - pageBox.top;

    const marks = [];

    // A note that was not the written one says so in words, since no amount of
    // cents describes it.
    if (attempt?.verdict === 'wrong') {
      marks.push({
        className: 'score-mark wrong',
        text: '✕',
        title: `written ${midiToName(attempt.score.midi)}, played ${midiToName(attempt.played.midi)}`,
      });
    } else if (attempt?.verdict === 'octave') {
      marks.push({
        className: 'score-mark wrong',
        text: '8ve',
        title: `played an octave ${attempt.played.midi > attempt.score.midi ? 'up' : 'down'}`,
      });
    }

    // The mark no other app can draw. The pitch engine already knows whether a
    // note SPOKE in tune or arrived under it and was corrected — the shift
    // scoop on a string, the embouchure settling on a wind. Averaged over the
    // note it vanishes, which is why a professional's tendency map says
    // "everything is centring, nothing to fix". On the notehead it is the
    // whole point: "this shift arrives flat, every time."
    const landing = landings?.get(scoreNoteId);
    if (landing && landing.approach !== 'centred' && Math.abs(landing.travelCents) >= 8) {
      marks.push({
        className: `score-mark landing ${landing.approach}`,
        text: landing.approach === 'flat' ? '↗' : '↘',
        title: `came in ${Math.abs(Math.round(landing.onsetCents))}¢ ${landing.approach}`
          + `${landing.settleMs === null ? ' and never settled' : ' and corrected'}`,
      });
    }

    const when = timingByNote.get(scoreNoteId);
    if (when && flagged.has(scoreNoteId) && when.deviationMs !== null) {
      marks.push({
        className: `score-mark timing ${when.verdict}`,
        text: when.verdict === 'late' ? '›' : '‹',
        title: `${Math.abs(Math.round(when.deviationMs))} ms ${when.verdict}`,
      });
    }

    if (attempts.length > 1) {
      const played = attempts.filter((a) => a.played).length;
      if (played > 1) marks.push({ className: 'score-mark passes', text: `×${played}`, title: `played ${played} times` });
    }

    // One question at a time: while the page is showing what changed, the
    // timing and landing marks from this take would be answering a different
    // one over the top of it.
    let offset = 0;
    for (const mark of comparison ? [] : marks) {
      const el = document.createElement('span');
      el.className = mark.className;
      el.textContent = mark.text;
      el.title = mark.title;
      el.style.left = `${x + offset}px`;
      el.style.top = `${y}px`;
      overlay.append(el);
      offset += 12;
    }
  }
}
