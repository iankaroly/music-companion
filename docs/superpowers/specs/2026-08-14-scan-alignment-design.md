# Marking a take onto a scanned page

2026-08-14

## What this is for

You photograph a part with the iPhone scanner, play it, and the review appears
*on your own page* — each notehead wearing what you did with it, and a cursor
following the recording down the systems as it plays back.

The MusicXML path already does this against a re-engraved score. This is the
same promise for the pages people actually own: a Bärenreiter part, photographed
in a room with a lamp in it.

## What already exists

- `src/analysis/scan-read.js` — `readPage()` finds staves, barlines and notehead
  positions on a page image, normalised 0–1. No pitches: it reads the page's
  *shape*.
- `src/ui/paper.js` — `readPages()` runs that over every page of an imported PDF
  at a 1400px render, and the layout is stored with the score.
- `src/analysis/align-score.js` — full edit-distance alignment between an
  expected note sequence and a played one, with match / wrong / insert / delete
  costs already tuned so a wrong note cannot derail the path.
- `src/ui/reader.js` — draws marks on a paper page at head positions
  (`drawScanMarks`), and pairs head *N* with played note *N* by index.

That last line is the thing to replace. Index pairing survives nothing: one
missed head shifts every mark after it.

## The idea

**The recording is the oracle. The page supplies place and order; the audio
supplies pitch and time.**

A notehead's height against its own five lines gives its diatonic *step*
exactly. What a step does not give is a letter — and that unknown is a single
constant per staff: choose a clef and every head shifts together. So the clef is
not detected, it is **fitted**: try the candidate offsets, run the existing
aligner against the notes the take actually produced, and keep the pairing that
costs least. The key signature is fitted the same way, 15 candidates. Roughly
450 alignment runs, milliseconds each.

Nothing needs to recognise a duration, a beam, a rest or a time signature,
because the recording already knows when every note happened. That is what keeps
this out of full OMR — and out of a server, an AGPL dependency, and the end of
local-first.

Once fitted, the mapping is stored with the score and reused for every later
take, with a clef picker to override it.

## What the probe found

Measured against the user's own scan — Bärenreiter BWV 1007 Prélude, bars 1–20,
photographed with the iPhone scanner. Ground truth: **10 systems, ~320
noteheads**. Rendered at 1400px the staff space is ~12px, which is what the
reader wants, so resolution is not the problem.

| | staves found | heads |
|---|---|---|
| shipped `readPage()` | 2 of 10 | 153 |
| thresholds loosened | 6 of 10 | 461 |
| comb + predicted systems | **10 of 10** | — |
| …with beams wiped | 10 of 10 | 403 (uneven: 6 to 64 per system) |

Two findings, and they set the order of the work.

**Staff finding was the bottleneck, and it is solved.** The shipped reader hunts
each line alone — "is more than half this strip inked at this row" — and on a
photographed book page one line in five fails that test. Four lines is not a
stave, so whole systems vanished. Two changes fix it:

1. **Comb correlation.** Score a five-line *grid* at the page's measured
   spacing, with negative lobes in the gaps, instead of picking peaks one at a
   time. The four clear lines vote for the faint one.
2. **Predicted systems.** Systems on a printed page are evenly spaced, so the
   staves that were found say where the missed ones must be. A predicted
   position is accepted on much weaker evidence than an unprompted one — which
   is exactly right for the shadowed foot of a photographed page.

Result on the test page: 10 of 10, spacing 12.0–12.3px throughout, lines
visibly on the printed lines.

**Head finding is not solved.** 403 found against ~320, and badly distributed —
6 in one system, 64 in another. The cause is visible in the overlay: this
edition's double beams merge into one thick bar at photograph resolution, and a
notehead touching that bar is one connected blob with it. Erasing long thin
horizontal runs (cut at 0.5–0.65 × staff space) leaves chains of false heads
riding the beams; raising the cut to 1.2 erases the real heads along with them.
Row-run thickness cannot separate them.

The next thing to try, and the reason to keep the probe: erase along a beam's
*measured* thickness rather than a fixed cut — a beam's thickness is constant
along its length, and where a head joins it the profile bulges. Plus a lower
`fill` threshold in `findHeads`, since a photographed head is greyer than a
printed one.

## Phases

**Phase 1 — read the page.** Comb staff finding and predicted systems into
`scan-read.js`, with tests. Then beam removal by thickness profile, measured
against a hand-counted ground truth per system. Target: every system found, and
heads within ±10% of truth with no system off by more than a few. Nothing
downstream is worth building until this holds, because an aligner fed three
spurious notes for every real one cannot produce a mapping worth painting.

**Phase 2 — pitch and fit.** `stepOf(staff, head)` → diatonic step. Fit clef and
key by search over the existing aligner. One caveat to build in deliberately:
the aligner forgives octave errors cheaply, which is right for marking and wrong
for fitting — two clefs an octave apart would score identically. The fit uses an
octave-strict cost; only the final marking stays forgiving.

**Phase 3 — the page as the review.** Replace index pairing in
`drawScanMarks` with the alignment. Then the cursor: each matched head carries
its note's start and end from the audio, so playback moves a cursor between
heads and turns pages by itself. Tapping a head plays that note, as a tile does.

## What it refuses to do

The rule from the MusicXML path holds: **paint only after the check passes.**
Where the alignment's per-note cost is poor, those heads stay unmarked and the
page says it lost the thread. A wrong mark on your own music is worse than no
mark, and a mark cannot be un-seen.

Named failures, all of which degrade to "unmarked" rather than to "wrong":
repeats (one line of heads played twice), ties (two heads, one sound), trills
and ornaments (one head, many sounds), double stops, and any run of misdetected
heads.

## Out of scope

- **Piano and multi-voice staves.** The audio side resolves two simultaneous
  pitches at best, so a braced piano page could never be marked honestly. It
  should say so rather than try.
- **Full OMR** — durations, dynamics, articulation. Never needed: the recording
  has the time.
- **Playing without a recording.** Nothing here works score-first; the fit needs
  a take. That is the trade for not detecting clefs.

## How it gets checked

`tools/scan-probe.mjs` renders a real PDF through the production path, runs the
reader over it, and writes the page back with everything it found drawn on top.
Unit tests cannot reach this — a page is a photograph, and the question is
always "does that ellipse sit on that notehead". The probe is the instrument;
the numbers in this document are its first reading.
