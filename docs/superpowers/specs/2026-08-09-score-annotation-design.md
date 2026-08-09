# Score annotation — play a piece, see your playing drawn on the music

Status: approved 2026-08-09. Local only; nothing pushed.

## The idea

Load the music you're about to play. Record as you always do. When you press
Stop, the app lines your take up against the score and hands back the same music
with every notehead coloured by how you actually played it — sharp, flat,
centred — plus where you rushed, dragged, or arrived under the pitch and slid up.

## What we are not building

- **No real-time follower.** Nothing happens on screen while you record. The
  cursor-chasing-you feature is a later, separate thing; committing to a
  position with no lookahead fails badly when you stop to fix a bar, and the
  annotation is the point, not the cursor.
- **No annotation on a photo of your part.** Considered and rejected: putting a
  mark on a specific notehead in a skewed phone photo needs pixel-accurate OMR
  coordinates, and a dot 15 px off is indistinguishable from a bug. We re-engrave
  the music instead and get exact coordinates for free.
- **No scanning in this milestone.** See "Scanning, later".
- **No polyphony.** The pitch engine is monophonic with limited double stops.
  Single-line parts only — cello, flute, voice, one line of a duet. Multi-staff
  scores are rejected at upload with a clear message, not silently mis-aligned.

## Shape

```
 .musicxml / .mxl  ──▶ musicxml.js ──▶ scoreNotes[]  ─┐
                                                      ├─▶ align-score.js ─▶ attempts[]
 mic ─▶ Analyzer ─▶ NoteSegmenter ──▶ playedNotes[]  ─┘         │
                                                                ├─▶ score-timing.js
                                                                └─▶ score-view.js (OSMD)
```

Everything downstream of `scoreNotes[]` is indifferent to where those notes came
from. That is the whole reason the file-upload path is first: it makes the
recogniser optional and replaceable.

## Modules

### `src/analysis/musicxml.js` (new, pure)

`parseScore(xmlString) -> { notes, divisions, timeSignature, parts }`

A flat, ordered list of what a player actually plays:

```js
{ id, midi, onsetBeats, durBeats, measure, beatInMeasure, tied, voice, pass }
```

- Repeats and voltas are **expanded** — a repeated bar appears twice, with
  `pass: 0` and `pass: 1` but the same `id`. The alignment sees a linear stream;
  the view collapses back onto one notehead.
- Ties collapse into one sounding note (the segmenter hears one note, so the
  score must present one).
- Rests are dropped from `notes` but their duration still advances `onsetBeats` —
  they matter for timing, not for pitch matching.
- `.mxl` is a zip; unzip in the browser before parsing.

### `src/analysis/align-score.js` (new, pure)

`alignScore(playedNotes, scoreNotes, opts) -> { attempts, matched, extra, missed }`

Full DTW / edit distance over the two sequences. `scoring.js:alignScale` is the
ancestor here — same tolerance philosophy (a re-bowed repeat, a skipped note, a
stray squeak are all normal) — but a greedy forward walk cannot recover from a
restart or a wrong note held for two beats, and a real score has both. So: a
proper cost matrix.

Cost of matching played `p` to score `s`:
- pitch: 0 if same midi; a smaller penalty at the octave (register slips are
  common and still tell you something); large otherwise
- rhythm: penalty on `|elapsedBeats - expectedBeats|` after the current tempo
  estimate, so ordering is not the only signal
- insertion (an extra played note) and deletion (a missed score note) each carry
  a flat penalty tuned so a single wrong note costs less than derailing

Returns one entry per **score note occurrence**:

```js
{ scoreNoteId, pass, played: playedNote|null, verdict: 'match'|'wrong'|'missed' }
```

Testable with synthetic note arrays — no audio, no DOM. The test cases that
matter: clean run; one wrong note; one skipped note; an extra grace/squeak; a
false start where the first two bars are played twice; a take that stops half
way.

### `src/analysis/score-timing.js` (new, pure)

`scoreTiming(attempts, scoreNotes, opts) -> { bpm, perNote, curve }`

This is genuinely new information, not a re-use of `rhythm.js`. `rhythm.js`
measures evenness *between* onsets with no idea what the rhythm was supposed to
be. With a score we know the intended duration of every note, so for the first
time the app can say "you rushed the dotted eighth" rather than "your spacing
was uneven".

Fit a tempo (least squares over matched onsets, `rhythm.js:fitPhase` for the
phase), then per note: `deviationMs`, `verdict: early|on|late`, and a tempo curve
across the take so a gradual accelerando reads as one thing rather than fifty
late notes.

### `src/ui/score-view.js` (new)

OpenSheetMusicDisplay ([BSD](https://opensheetmusicdisplay.org/)), **lazy-loaded
on first score open** so the tuner, metronome and PWA shell stay as light as they
are today. This is the project's first runtime dependency; it should cost nothing
to anyone who never opens a score.

- `osmd.load(xml)` then `render()`
- per-note paint via `getGraphicalNoteFromNote(note).setColor(...)` — repaints a
  single notehead without re-rendering the page
- an absolutely-positioned SVG overlay above the OSMD canvas for anything OSMD
  won't draw: the landing arrow (arrived flat and corrected), timing ticks,
  the repeat-count badge. Coordinates come from
  `GraphicalNote.PositionAndShape.AbsolutePosition` scaled by
  `osmd.zoom` × unit-to-pixel.
- colours come from the existing tiers in `chart-utils.js` — good/off/bad already
  mean something in this app and must not fork
- tapping a notehead selects that note and drives the **existing** review
  machinery in `report.js`: zoom inset, playback, drones, comparison

**Repeats:** a notehead visited N times shows the **latest** pass, with a small
count badge; the tap detail lists every pass. (Chosen for now; "worst pass" is a
one-line change if it reads better in practice.)

**Rendering at length.** The 10-minute-take lesson applies again — a 30-page
score is the same paint-everything trap the overview chart was. Render page by
page and only paint annotations for pages in view.

### Storage — `src/store/db.js`

DB version 4 → 5, new `scores` store: `{ id, name, xml, date, partIndex }`.
`recordings` gains an optional `scoreId`. A score is uploaded once and reused for
every take of that piece, which also means `passages.js` can eventually key on
real measure numbers instead of a name you typed.

Backfill rule follows the precedent already set in `db.js`: `needsBackfill()`
checks every stat, so takes saved before this shipped don't silently skip new
panels.

### Wiring

`main.js`: a score picker on the analyze tab ("playing from: …"). On
`finishRecording`, if a score is attached, run parse → align → timing and show
the annotated score above the existing report. The chart, timing panel, landing
card and coach all keep working exactly as they do; the score is an additional
view of the same take, never a replacement.

## Landing on the page — the reason to build this

`landing.js` already knows a note *spoke* 20 ¢ flat and corrected over ~150 ms.
Drawn as a small arrow on the actual notehead — "this shift arrives under the
pitch, every time" — that is the thing no other app can show. Tuners have no
score; notation apps have no ear. Lead with it.

Report bands, never a stopwatch figure: the pipeline validation in
`tests/landing.test.js` established that `settleMs` is only good to a band.

## Scanning, later

Deliberately last, because everything above works regardless of how the symbolic
notes arrive.

Open items to settle before building it, not asserted now:
- [Audiveris](https://github.com/Audiveris/audiveris) is the strongest engine but
  **AGPLv3**, against a public MIT repo, served over a network — exactly the case
  the licence's network clause is about. Needs a real answer, not a guess.
- [oemer](https://github.com/BreezeWhite/oemer) is MIT and clean, but Python +
  ONNX, 3–5 min a page with a GPU, printed notation only.
- Commercial APIs ([klang.io](https://klang.io/scan2notes/),
  [SeeScore](https://www.seescore.co.uk/developers/)) — pricing unverified.

All of them mean a server, which reverses the local-first decision for this one
feature. The audio never leaves the device either way; only the page image would.
That is a choice to make deliberately when the time comes.

## Testing

Pure modules get unit tests in the existing vitest suite, following the house
pattern: synthetic inputs, no mocks.

The test that actually proves this works, in the spirit of landing.test.js's
"survives the real analysis pipeline": synthesise a scale from a known MusicXML
fixture with one note deliberately 30 ¢ sharp and one note late, push it through
the **real** Analyzer + NoteSegmenter, align it, and assert the annotation lands
on the right notehead. Anything less tests the aligner against its own
assumptions.

UI verified headless in Playwright on localhost, as every other view has been.
