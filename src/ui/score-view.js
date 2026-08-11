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
function verdictColour(attempt, colours) {
  if (!attempt) return null;
  if (attempt.verdict === 'missed') return colours.muted;
  if (attempt.verdict === 'not-taken') return null; // never played, nothing to say

  // A wrong note is coloured too. The two facts are independent and both worth
  // having: the colour says how close to a pitch centre you were, the ✕ says it
  // was not the written pitch. A wrong note played dead in tune comes out green
  // with a cross, which is exactly what happened.
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

// pageFormat: { width, height } in OSMD units turns the engraving into real
// pages — the reader hands one screenful at a time. Left out, the music runs on
// endlessly and the panel it sits in is as tall as the music, which is what the
// Score tab wants.
export async function showScore(container, {
  xml,
  scoreNotes,
  partIndex = 0,
  aligned = null,
  timing = null,
  landings = null,
  onPickNote = null,
  zoom = 1,
  pageFormat = null,
  autoRelayout = true,
} = {}) {
  const { OpenSheetMusicDisplay } = await loadEngraver();

  container.replaceChildren();
  const page = document.createElement('div');
  page.className = 'score-page';
  container.append(page);

  const osmd = new OpenSheetMusicDisplay(page, {
    backend: 'svg', // the overlay and the per-notehead lookup both want real DOM
    drawTitle: true,
    drawPartNames: false,
    autoResize: false, // re-rendered on our own terms, so marks and page stay in step
  });
  // The music is drawn in the app's ink on the app's background — no sheet of
  // white paper laid on top of the screen. A page of engraving inside a panel
  // inside a screen is two edges too many, and on a dark theme a white page is
  // a torch in a dark room. The verdict colours in paint() still override every
  // notehead they touch, so nothing about the marking-up changes.
  const ink = palette().ink || '#000000';
  for (const rule of ['DefaultColorMusic', 'DefaultColorNotehead', 'DefaultColorStem',
    'DefaultColorRest', 'DefaultColorLabel', 'DefaultColorTitle']) {
    osmd.EngravingRules[rule] = ink;
  }
  // "Endless" instead of a paper size: this is a panel on a phone, not a sheet
  // to print, and A4 leaves most of a blank page hanging under a two-bar
  // exercise. The margins go with it for the same reason. The reader asks for
  // real pages instead, shaped like the screen it is about to fill.

  // The title is a label, not a banner. OSMD sizes a sheet title for the top of
  // a printed page — 4 units of staff height, with 5 more above it — which on a
  // phone gave a two-bar exercise a headline taller than its music and pushed
  // the first system off the bottom of the panel. These are the same numbers
  // scaled to a screen: the piece still says what it is, in one line, and the
  // music starts where you can see it.
  osmd.EngravingRules.SheetTitleHeight = 2;
  osmd.EngravingRules.SheetSubtitleHeight = 1.4;
  osmd.EngravingRules.SheetComposerHeight = 1.5;
  osmd.EngravingRules.SheetAuthorHeight = 1.5;
  osmd.EngravingRules.TitleTopDistance = 1;
  osmd.EngravingRules.TitleBottomDistance = 0.6;
  osmd.EngravingRules.PageTopMargin = 1;
  osmd.EngravingRules.PageBottomMargin = 1;
  osmd.EngravingRules.PageLeftMargin = 1;
  osmd.EngravingRules.PageRightMargin = 1;
  await osmd.load(xml);

  // AFTER the load, both of them, and that is not a style choice: load() resets
  // the zoom to 1, so setting it first is setting it for nothing. This cost an
  // afternoon — the music came out the same size on a phone and an iPad however
  // the numbers were juggled, because the number being juggled was thrown away.
  // The page format is set here too, so the two always agree.
  if (pageFormat) osmd.setCustomPageFormat(pageFormat.width, pageFormat.height);
  else osmd.setPageFormat('Endless');
  osmd.zoom = zoom;

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

  // OSMD draws each page into a container of its own. Tagging them is what lets
  // a mark be placed against the page it belongs to rather than against the
  // whole stack — and it is what the reader shows and hides one at a time.
  function tagPages() {
    const pages = [...page.children];
    for (const [i, node] of pages.entries()) {
      node.classList.add('osmd-page');
      node.dataset.page = String(i);
      if (!node.querySelector(':scope > .score-overlay')) {
        const layer = document.createElement('div');
        layer.className = 'score-overlay';
        layer.setAttribute('aria-hidden', 'true');
        node.append(layer);
      }
    }
    return pages;
  }

  const view = {
    osmd,
    page,
    pages: tagPages(),
    map,
    unmatched,
    ok,
    last: null,
    // Every mark is placed from a measured notehead box, so a reflow that moves
    // the noteheads has to redraw the marks in the same breath — otherwise they
    // stay behind, pointing at whatever note has moved under them.
    relayout() {
      osmd.render();
      this.pages = tagPages();
      if (this.last) paint(this, this.last);
      this.onRelayout?.();
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      container.replaceChildren();
    },
  };

  let resizeTimer = null;
  function onResize() {
    if (!autoRelayout) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => view.relayout(), 150);
  }
  window.addEventListener('resize', onResize);

  if (aligned) paint(view, { aligned, timing, landings, onPickNote });
  return view;
}

// Played note → the notehead drawn for it, so the playhead can light the right
// one while a take plays back. Keyed on the note OBJECT: two notes can share a
// pitch and a bar and still be different notes, and the object is what playback
// hands back.
//
// Separate from paint() because lighting the note you are hearing and colouring
// the page by how in tune it was are two different things, and the reader wants
// the first without the second: you open a score to play from it, not to be
// told what last Tuesday sounded like.
export function indexNoteheads(view, aligned) {
  const noteheads = new Map();
  for (const [scoreNoteId, engravedNote] of view.map) {
    const element = engravedNote.gnote?.getSVGGElement?.();
    if (!element) continue;
    // Every pass that sounded points at this one notehead, so playing a
    // repeated bar lights it both times round.
    for (const attempt of aligned?.byNote?.get(scoreNoteId) ?? []) {
      if (attempt.played) noteheads.set(attempt.played, element);
    }
  }
  view.noteheadFor = (note) => noteheads.get(note) ?? null;
  return view.noteheadFor;
}

// Colour every notehead by what happened on it, and hang the marks that OSMD
// has no concept of over the top.
export function paint(view, {
  aligned, timing = null, landings = null, onPickNote = null, comparison = null,
} = {}) {
  const colours = palette();
  const { map, page } = view;
  view.last = { aligned, timing, landings, onPickNote, comparison };
  // One overlay per engraved page, so a mark lands on the page its notehead is
  // drawn on. With the music running on endlessly there is exactly one.
  for (const layer of page.querySelectorAll('.score-overlay')) layer.replaceChildren();

  const timingByNote = new Map();
  for (const entry of timing?.perNote ?? []) {
    if (entry.scoreNoteId) timingByNote.set(entry.scoreNoteId, entry);
  }

  // Every note that missed the beat gets an arrow — including all of them.
  // Against a set tempo the grid does not move, so playing faster than it puts
  // note after note further ahead, and seeing that run of arrows build IS the
  // reading: it is drift, drawn. Hiding all but the worst ten would flatten the
  // one thing a fixed tempo is there to show.
  const flagged = new Set(
    (timing?.perNote ?? [])
      .filter((n) => n.scoreNoteId && n.deviationMs !== null && n.verdict !== 'on')
      .map((n) => n.scoreNoteId),
  );

  indexNoteheads(view, aligned);

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
      // Stopped here on purpose: a tap on the page itself opens the full-screen
      // reader (score-tab.js), and picking a note is not asking for that.
      element.addEventListener('click', (e) => {
        e.stopPropagation();
        onPickNote(attempt);
      });
    }

    // Measured against the page the notehead is ON, not against the stack of
    // pages: in the reader every page but one is hidden, and a hidden page has
    // no box to measure from.
    const host = element.closest('.osmd-page') ?? page;
    const overlay = host.querySelector(':scope > .score-overlay');
    if (!overlay) continue;
    const hostBox = host.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const x = box.left - hostBox.left + box.width / 2;
    const y = box.top - hostBox.top;

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
