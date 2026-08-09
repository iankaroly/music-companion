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
import { intonationStatus } from './chart-utils.js';
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

function verdictColour(attempt, colours) {
  if (!attempt) return null;
  if (attempt.verdict === 'missed') return colours.muted;
  if (attempt.verdict === 'not-taken') return null; // never played, nothing to say
  if (attempt.verdict === 'wrong' || attempt.verdict === 'octave') return colours.bad;
  return colours[intonationStatus(attempt.played.cents)];
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
  const tuning = Math.abs(cents) < 1 ? 'in tune'
    : `${Math.abs(cents)} cents ${cents > 0 ? 'sharp' : 'flat'}`;
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
export function paint(view, { aligned, timing = null, landings = null, onPickNote = null } = {}) {
  const colours = palette();
  const { map, overlay, page } = view;
  view.last = { aligned, timing, landings, onPickNote };
  overlay.replaceChildren();

  const timingByNote = new Map();
  for (const entry of timing?.perNote ?? []) {
    if (entry.scoreNoteId) timingByNote.set(entry.scoreNoteId, entry);
  }

  const pageBox = page.getBoundingClientRect();

  for (const [scoreNoteId, engravedNote] of map) {
    const attempts = aligned.byNote.get(scoreNoteId) ?? [];
    // A repeated notehead is drawn once and played more than once. It wears
    // the LATEST pass that actually sounded, and says how many there were.
    const attempt = aligned.latest.get(scoreNoteId) ?? attempts.at(-1) ?? null;
    const colour = verdictColour(attempt, colours);
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

    const label = describe(attempt, timingByNote.get(scoreNoteId));
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
    if (when && when.verdict !== 'on' && when.deviationMs !== null) {
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

    let offset = 0;
    for (const mark of marks) {
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
