# Reading a page of music — where this is up to

The page reader finds staves, clefs, barlines and noteheads on a photograph of
sheet music, so a recording can be paired with the notes on the page. This is
the state of it, what is measured, and what to do next.

## What it can and cannot do — the paragraph a ship decision needs

**It reads a SINGLE-STAVE PART, one voice, printed music, in treble, bass or
tenor clef and in any of the fifteen key signatures, and it NAMES the notes** —
a list of noteheads carrying a MIDI number, a degree and a beam count each. On
CLEANLY ENGRAVED pages, 692 notes of real cello repertoire in fourteen keys come
back **692 found, 666 named right, 26 unpitched and NOT ONE named wrong**
(`npm run scan:studies`); on the three hand-marked pages of real published
music — two rendered from PDF and one a scan — it circles heads at **94.9%
precision and 98.1% recall** (`npm run bench`).
It reads the key signature and refuses rather than guess — **0 of 352 drawn
signatures read as the wrong key** — it reads the accidental standing
in front of a note and carries it to the end of the bar, and it reads a **C-clef
or a TREBLE clef printed part way along a system**, which is half of what a cello
part does every time it goes up and comes back down — the F clef that brings it
back down is the half that is not read, and cannot be off this measurement (see
*A mid-system treble is now read, and a mid-system bass cannot be read off the
clef column*). **On a clean page of two systems or more it also
reads a page that prints NO signature as C major** rather than declining to name
anything — but not on one system, and not on a photograph, which are the two
qualifiers that clause has to carry: 6 of 6 drawn photographed bare pages still
name nothing, and the 26 unpitched notes above are the two single-system
arpeggio studies.

**AND PITCH ON A PHOTOGRAPH IS MEASURED AT LAST — which it was not for any of
the rounds that quoted a pitch figure.** The reader used to circle Bach's
noteheads at 99.7% recall and NAME them wrong, and nothing in this repo could
see it: `bench` scores where a ring SITS, `scan:studies` scores pages this repo
engraved itself with straight lines, and a residual taken against the reader's
own stave model is a measurement of nothing. `npm run scan:steps` takes the
PRINTED lines around each hand-marked notehead as the truth and asks which line
or space the reader put that head on — **a wrong step is a wrong note, a second
out, whatever the clef and the key then do with it**:

```
                    marks   read  scored   step right      wrong   whole page
  Bach photograph     319    248     248   229  92.3%         19        87.3%
  Concerto (PDF)      328    238     230   210  91.3%         20        91.6%
  Scanned score       412    303     301   279  92.7%         22        92.7%
```

Read it with its qualifiers, all of which the tool prints itself. The harness
answers 73–78% of the marks and names every refusal by reason; `whole page` is
its own reweighting of what it did answer, not 319 notes checked by hand; a right
step is not yet a right note, because the clef and the key still sit above it;
and **only the Bach column has a self-check behind it** — `pages/truth/bach.pitch.json`
holds the 32 steps of the BWV 1007 opening, which are not in dispute, the harness
gets 25 of them right of the 25 it reads at all, and **the reader gets 30 of 32,
where before the stave model was repaired it got 14**. There is no such file for
the other two pages, so those two columns are trusted rather than verified. See
*The stave model waves, and the pitch was lost in the fit*, which is the round
that fixed it.

**EVERY NAMED-NOTE NUMBER ABOVE IS A CLEAN-PAGE NUMBER — the step table is the
only pitch figure in this document taken on real paper — and that is the
qualifier a ship decision turns on.** Spoil the same 32 studies the way a phone spoils a page
— 0.72 downscale, blur, contrast, a JPEG round trip, so a 14-pixel staff space
arrives as 10 — and the reader still finds **631 of the 692 notes** but names only
**378 of them right, 54.6%**. 245 notes come back with no pitch at all because
their page could not read a key, and **two studies read a key that is not the
printed one**, which puts eight notes a semitone or a tone out with full
confidence. That is the only wrong key anywhere in this project's measurements,
nothing gates it, and it is item 1 of "The next step". Finding the notes survives
a camera; naming them does not yet.

**What it has never been measured on at all: a PIANO SCORE and TWO VOICES ON ONE
STAVE.** There is no ground truth of either kind in this repo — every marked
page is a single-stave part and every one of the 32 studies is one voice — so
the reader's behaviour on them is unknown rather than poor. **What it is
measured NOT to do**: a mid-system change to BASS (a C-clef and a treble are
read; a bass is not, and its notes stay named in the clef the system began in,
silently — 129 notes of `scan:clef`'s debt line and 72 of `scan:clef-change`'s 86
wrong pitches are that one thing, 68 of them beyond what the controls get wrong
by themselves), a key CHANGE mid-page, note values beyond counting beams — and beam
counting itself collapses below a working staff space of about 12 on a
photograph, where every note is still found and given the wrong length. It has
never been shown a handwritten page, and it finds no stave at all on a close-up
blown past a working space of about 35.

Everything below is the evidence for those paragraphs. **`CLAUDE.md` was brought
into line with this file in the round that wrote this sentence** — its summary
had said for two rounds that the reader "has never been tested on … a clef change
mid-system", which was false once a C-clef and then a treble were read
mid-system. Where the two ever disagree again, this file is the one that was
measured.

## THE LATEST ROUND — THE SCAN, not the reader, and the three complaints it came from

Nothing below this section moved. This round is about the pipe between the
camera and the recogniser, and every number in it is new.

**"when i scan a page from a book, it doesnt single out the page but instead get
part of the page to the right or left."** The fold was only ever looked for down
the MIDDLE of a bright shape (`GUTTER_BAND` a sixth either way), and
`pagesTogether` refused to look at all unless the shape was 1.08x wider than
tall and BOTH halves were page-sized. That describes a spread photographed
whole. It does not describe the picture a phone over a music stand takes, which
is one page filling the frame with a band of the next one catching the side —
fold at a fifth, shape of a page, and the far half a scrap. The band is a third
either way now, the aspect gate is gone, and the far half need not be a page.
What replaces the gate is the evidence itself: a crease dark and narrow and in
the same place at the top, the middle and the bottom, or a blank corridor with
music printed on BOTH sides of it. A shape that fills less than 0.6 of its own
outline is not looked in at all — that is what stops the wall behind a stand
coming back as a spread, and it is the guard the aspect gate used to be.

```
  npm run scan:pages, two cases drawn from the complaint
    book, ONE page, a BAND of the next    72.1% IoU, ONE OUTLINE OVER TWO PAGES
                                       -> 84.1%, two outlines, the page aimed
                                          at 92.1% with no spill
    book, ONE page, a SLIVER of the next  94.4% IoU, 1.7% spill -> 95.5%, 0.5%
  the fourteen cases already right       0 wrong counts, 0 spans, worst spill
                                         9.0%, unmoved
```

**"when i trim after taking the photo in scan, it doesnt update to what i
cropped it to, but instead stays the same."** True, and total rather than
approximate. `straightenCanvas` put every outline through three corrections
written for a GUESS: `guardQuad` pushes a side out to the frame when there is
print beyond it (and keeps the WHOLE FRAME when the sheet reaches both edges of
the picture, which is what filling the frame means), `widen` lets it out by a
tenth, `trimBackground` takes some back. A crop dragged onto one leaf of a book
trips all three — there IS print beyond that edge, it is the facing page. A hand
crop is now taken as given. MEASURED, `npm run scan:edges`: the crop came back
as the WHOLE PHOTOGRAPH, 1360x1000 where the page dragged was 1000x1000, a third
of its right edge made of the facing page -> 1000x1000 and 3.45%. The scanner's
own shutter ran the same guard a second time on a page that is one of several
(the kept page 1109px wide where the page aimed at is 1010 -> 1040), and a page
of a book is widened up and down only, because sideways is where its neighbour
is.

**"the conversion to musicxml through audiveris was nothing like the score."**
Two things, and the second is the big one.

*A busy page was not being found at all.* `INK_CEILING` — how much of a bright
shape may be ink before it is not paper — was 0.62, and every sheet ever drawn
in `scan:pages` reads 20–39%, so nothing in this project had asked what a page
of semiquaver runs reads. A photographed cadenza reads 56%; the same music
engraved by LilyPond reads 65%. Over the bar, `findPage` returns null,
`straightenCanvas` falls back to cropping the bright part of the frame, and the
player is told nothing. It is 0.8 now, with `scan:pages` case "sheet of DENSE
music" (75.6% ink) drawn to hold it, and the other sixteen cases unmoved.

*And the page being sent to the recogniser was the wrong page.* The app sent the
SQUARED-UP page — the sheet found, pulled flat, the lighting divided out — on
the reasoning that it is a better page than the snapshot. It is a better page to
READ FROM and a much worse page to RECOGNISE: every pixel of it has been
resampled, a staff line is one pixel of black on white, and rotating a raster
three degrees turns each line into two grey ones. Audiveris finds staves by
looking for long dark runs and deskews the page itself, on the marks rather than
on the pixels. What goes now is the photograph CUT to the sheet of paper found
in it — a rectangle of the original pixels, copied, never interpolated, brought
down to 2600 on its long edge — which keeps the facing page and the table out of
it without touching a pixel of the music. On a book the corners the scanner kept
say which of the two sheets the page was, so they are stored with the
photograph.

**AND THE INSTRUMENT THAT SAYS SO IS NEW, because there was none.** Everything
the pipeline reports — bars, notes, how many bars add up — is blind to whether
the notes are the RIGHT notes; `server/README.md` says so in as many words. So
`npm run omr:truth` generates a page of music as a list of MIDI numbers,
engraves it with LILYPOND (a real engraver, and pointedly not this repo's own),
photographs it the way a phone does, brings it in through the app's own path,
sends it to the pipeline, and scores the longest run of the page's notes that
comes back IN THE ORDER THEY ARE PRINTED. A reading that finds every notehead
and names them all a third out scores zero.

```
  352 notes, engraved, photographed, read by Audiveris
                                          notes  in order  recall  invented
    the engraving itself, no camera         306       305   86.6%         1
    the photograph, as taken                340       301   85.5%        39
    the photograph, cut to the paper        318       276   78.4%        42   <- sent now
    the page the app squared up             264       201   57.1%        63   <- sent before
```

The camera costs one point. The squaring cost twenty-eight, and it had been
costing them since the day scans were first sent. `npm run omr:payload` is the
other half of that: it drives the app's own send, catches the upload before it
leaves (no service is contacted) and looks at what is in it, because the last
time a fix was proved on the convenient path instead of the one a player takes
it cost four rounds.

**What this round did NOT do, said plainly.** It did not make the recognition
right. 78.4% of the notes in order, on a clean engraving photographed under a
lamp, is what this pipeline is worth today, and the ceiling with no camera at
all is 86.6% — the gap to a hundred is Audiveris, not us. "Identical to the
score" is not on the table and nothing here should imply it is. What moved is
that the app has stopped taking twenty-eight points off the top before the
recogniser sees the page, and that there is now a number that would notice if it
started again.

## THE ROUND THAT WROTE THIS — three items closed, and where each number moved

Everything below this section was true before it. These three are not.

**1. THE WRONG KEY AT PHONE QUALITY IS GONE — the only confidently wrong answer
anywhere in this project's measurements.** `notesInOrder` used to fall back to a
STAVE's own key whenever the page could not agree one, and `agreeKey` returns
null for two quite different reasons: a page of ONE system has no second witness
(the fallback is right there, and fourteen arpeggio studies score 92% off it),
and a page whose systems read DIFFERENT signatures knows one of them is wrong
and cannot say which (the fallback is a coin toss). Those two are now told
apart: on a split page the pitch is null. MEASURED, `npm run scan:studies --
--phone`: `Bb-major-scale` reads `[-3 -2]` and `Eb-major-scale` reads `[-2 -3]`
— first system one flat out on both — and the eight notes those pages named a
semitone or a tone wrong are now refusals. `wrong by semitones` loses its
`{1:2, 2:1, -1:3}` group. It costs 50 notes their name at phone quality (347
right of 692 to 297) and nothing at all clean or at `--camera`, where 666 of 692
are still right and no page has ever had two systems disagree.

**AND IT HAS A GATE, which is what the old item 1 actually asked for.**
`npm run scan:key-gate` (= `scan:studies --phone --gate`) exits non-zero if any
page names a key that is not the printed one OR if a single note is named on a
page whose systems disagreed. It prints the two lines it holds:

```
  pages whose systems disagreed on the key   2 of 32
  notes NAMED on one of them                0   <- MUST BE ZERO
```

It belongs on a PHOTOGRAPHED corpus and nowhere else: clean and `--camera` have
never produced a disagreement, so a gate run on them cannot see the rule.
`scan:studies` also prints WHAT a wrong stave read now — `1/2! [-3 -2]` — because
"wrong on 2" was the only line in this file a round could act on and it never
said what to look at.

**2. THE HEAD THAT DISAPPEARS UNDER AN ACCIDENTAL: FOUND, AND IT WAS THE BEAM
MASK.** The old item 2 had five suspects ruled out one at a time (`open`,
`HEAD_CUT`, the `fill` floor, the sideways-run bound, `dropDoubledHeads`) and no
owner. It is none of them: it is `beamMask`. At a ten-pixel staff space a flat
and the head beside it blur into ONE horizontal run about 2.7 spaces long, which
is longer than `run` — so the mask treats it as a beam, and because the run's
low-quartile column height IS the head's own height, the "a head joins here"
test spares the tall accidental and erases the notehead. MEASURED on
`A-minor-scale` at `--phone`: 23 of 29 heads and 0 of the 5 notes carrying an
accidental; with the mask off entirely, 28 and 5.

The mask cannot simply be removed — off, `bench` recall falls to 91.7% and the
Scanned score loses 57 notes. What separates the two cases is that **a beam is
thinner than a notehead is tall, or else it is long**: `BEAM_THIN = 0.5` spaces,
`BEAM_LONG = 3` spaces, either one enough. Swept: at `BEAM_LONG` 2.6 the fix
disappears entirely, at 2.8 it recovers 4 of the 5, at 3 all five.

```
                          before            after
  scan:studies --phone    631 found 91.2%   661 found 95.5%
    accidental notes      2 of 30 found     26 of 30 found, 25 named right
    right pitch           297               306
  scan:studies clean      692 found, 666 right — UNCHANGED, accidentals 30/30
  bench recall            98.1% mean        98.2% mean (no page falls)
  bench precision         94.9% mean        93.7% mean
  scan:sizes beams        100/92/49/10%     100/91/48/10% at space 14/12/8/6
```

The precision is the price and it is the one rule 2 says to pay: a missing note
breaks an alignment, an extra circle is cosmetic. It is also the price that
makes the bar sums harder — see item 3 — so the next round on false circles buys
it back.

**AND ONE DEAD END, MEASURED, so nobody builds it twice: THE ACCIDENTAL MODEL
CANNOT BE USED AS A VETO ON A NOTEHEAD.** The obvious answer to those false
circles is that the reader already owns a model that knows a sharp when it sees
one — so show it each head, centred on the head itself, and drop the ones it
claims. Built, and it takes the page with it: `bench` goes from 93.7 / 98.2 to
**48.7 / 8.8**, with the Bach reduced to TWO circles of its 319 notes. The model
reads a patch 4.8 spaces across and was fitted on patches centred where an
accidental stands — a head's own patch looks enough like one that the model says
yes to nearly every notehead on the page. Whatever removes those six circles, it
is not this model asked this question.

**3. THE BARLINES WERE MOSTLY STEMS, AND THAT WAS THE FIRST OF "the two things to
measure first".** `BAR_ATTACHED` — how much of a full-height column may have
something wide hanging off it before it is a stem rather than a barline — was
0.4. MEASURED with `barProbe` on the Bach photograph, the four false barlines of
system 3 read `attached` 0.179 to 0.208 while the two REAL ones read 0.000. At
0.25:

```
                    Bach          Concerto      Scanned
  barlines before   40            34            33
  barlines after    22            24            33
  printed           20            ~20           —
```

and the Bach's ten systems go from 2, 3, 9, 7, 5, 3, 10, 2, 2, 2 barlines to
2, 2, 3, 2, 3, 2, 3, 2, 2, 2. `scan:bars` is unmoved on its must-hold lines
(mean recall 100%, 63 of 72 systems exactly right, the same as before), `bench`
does not move one notehead on any page, and `scan:values` now says the thing
nothing in this repo had ever printed:

```
  Bach: 15.5 notes per bar-group; the commonest sums are 4 beats x9, 4.25 x4 …
```

**Nine of the Bach's twenty bar-groups now add up to exactly four beats**, where
before the round no bar on any real page added up to anything. The join still
refuses — `COVERAGE` in scan-values.js wants 0.55 and this is 0.45 — and the
four groups at 4.25 beats are the answer to what is left: each is a bar with ONE
false circle in it, priced at a semiquaver. The Bach has seven false circles and
**they were cropped and looked at**: one is the TIME SIGNATURE (a `C`, system 1
only, at x=181), and the rest are the lower half of a printed SHARP standing in
front of a note at the head of a system. That is the whole remaining distance to
a believed bar on a real photograph, and it is the "stop circling the key
signature" that scan-values.js has been asking for — now with the page and the
positions to work from.

## THE ROUND AFTER THAT — the click that played the wrong music

A user scanned a page, recorded against it, and reported two things: about half
the notes came back, and **"I would click on a note that was out of tune, and it
would play audio from a different part of the music."** The second one is what
this round is about, and it was three separate faults stacked on each other.

**1. THE ALIGNER HAD NO REASON TO PUT THE TAKE ANYWHERE.** `alignScore` was a
GLOBAL edit distance: every notehead on the page had to be consumed, so the ones
before the take and after it were deleted at 1.0 each. That sounds like a cost
and is not — it is the SAME cost wherever the take sits. Twenty-eight notes over
a page of 750 noteheads delete 722 of them by any path, and a matching pitch
costs 0 whether it is the right notehead or one two hundred notes earlier. Every
placement tied, and the tie-break took the earliest.

Drawn, with `LANDED=1 PHOTO=1 npm run score:follow`, where the take is
synthesised from the page's own noteheads so the right answer is known:

```
  0: 253->2   1: 254->19   2: 255->32   3: 256->40 … 17: 270->223
  18: 271->271  19: 272->272 …                     (the tail, which had
                                                     nowhere left to slide)
```

The ends are now FREE — the noteheads before the take and after it cost nothing
to skip, while a gap INSIDE it still costs 1.0 a head — so a path that leaps 250
heads and comes back is expensive rather than free. Free ends only where there
is room to slide (`S > P * 2 + 8`): a take that covers everything it is compared
against wants the old end-to-end reading, and on a two-note score free ends turn
a fumbled last note into "you stopped early and made a noise".

```
  marks that landed on the very notehead they were built from
  Bach photograph   22 of 28  ->  28 of 28
  Concerto          11 of 28  ->  28 of 28
  Scanned score     27 of 28  ->  28 of 28
```

**2. THE CONTOUR ROUTE WAS PLACING MARKS IT COULD NOT STAND BEHIND, and nothing
had ever scored it.** A page whose clef or key would not read prices no head, so
`pairNotes` fell to `pairByShape` — findStart, then pitches estimated from the
take itself, then either an alignment or NOTES COUNTED OFF one by one. All of it
drew rings you could press. `npm run scan:align -- --unpriced` strips the pitch
off every head and scores where the marks land, over 32 studies and 128 takes:
**130 notes on the right notehead, 307 on the WRONG one**, and its own
confidence cannot tell those apart — at a fit agreement of 0.6 it is 27 right
against 37 wrong. It refuses now. A page with no priced head draws no rings,
says why, and still shows the music.

**3. …AND THE PAGE THAT COULD NOT NAME ITS NOTES COULD STILL HAVE PLACED THEM.**
The two fixes above would have left a phone scan with no rings at all, because
the round before this one made a page whose systems disagree price nothing. But
the aligner does not need a note's NAME. It needs to tell one notehead from its
neighbour, and the clef alone does that — two heads a third apart are a third
apart in any key. So `headsOf` now carries a second pitch, `matchMidi`: the head
priced through its clef with NO key at all, used for MATCHING and never for
naming. A mark placed on one of those carries the verdict `unpriced`, so nothing
tells a player their note was wrong on the strength of a key nobody read.

```
                             before this round        after
  scan:align                 91.3% right, 118 wrong,  94.8%, 124, 16
                             115 unmarked
  scan:align --phone         92.3% right, 75 wrong,   96.2%, 34, 64
                             54 unmarked, 88/128 on   128/128 on the pitch route
                             the pitch route
  scan:align --unpriced       4.9% right, 307 wrong   94.8%, 124, 16
  scan:align --miss 0.5      52.7% right, 691         53.7%, 675
  (half the page's heads     unmarked
   never found)
```

`--miss` and `--unpriced` are new knobs on `scan:align`, and they exist because
the corpus was too kind: every page in it was read well and priced fully, which
is not the page a user photographs. `--miss 0.5` drops half the noteheads from
the reference before the pairing runs and counts the notes whose own head was
never found apart, so what is scored is the notes that COULD still be placed.

**AND THE FLOOR STAYED AT 0.70, measured rather than kept.** `npm run scan:floor`
now refuses 0 of 128 right pairings at both 0.70 and 0.75, and 0.75 catches two
more wrong ones of 106 — but on a page read badly (`--miss 0.5`) 0.75 costs
53.7% of played notes landing right, down to 44.3%, and 140 more notes lose
their notehead. The table is drawn on pages the reader read well; the pages this
is for are not those.

**AND THE TWO WAYS THE ENDING RULE CAN BE GOT WRONG, both found by breaking it.**
A take ends where its last note was MATCHED, and where no row offers that, on
the cheapest row of any kind. End anywhere at all and a take of the WRONG music
matches a handful of notes that happen to fit, drops the rest as extras, and is
placed on the strength of the handful — `score:follow`'s "a take of a different
piece is REFUSED rather than drawn" comes back placed, 8 marks of 24 notes. End
only on a match with the old global traceback behind it, and the sliding bug
comes back for any take whose last sound is bow noise: a squeak is cheaper to
insert (1.0) than to call a wrong note (1.4), so no row ends on a match at all.
`tests/align-place.test.js` holds all three cases — a plain take, one that ends
on a squeak and one that begins with one — on a page whose pitches repeat, which
is what makes sliding possible in the first place.

**WHAT IS STILL OPEN on the user's other complaint — "about half the notes".**
Unmeasured, because the page that produced it is not in this repo. What IS
measured is that every notehead the reader finds is now pressable: the silent
markers used to stop eight heads either side of the take, which on a real page
of two hundred notes offered a dozen controls, and they now cover every head on
the pages shown.

## WHAT A SCAN COSTS BEFORE THE READER SEES IT — `npm run scan:import`

Everything else here measures the reader against a page rendered straight out of
a PDF at 1400 pixels. A scan is not that. A scan is a photograph — smaller,
softer, unevenly lit — straightened and de-shadowed on the way in, and the reader
meets the RESULT. Nothing measured the result until this round, and a user's
report is what it was missing: **"it ended up rendering about 50% of the notes"**.

`npm run scan:import` puts the three marked pages through it: degraded the way
`scan:studies --phone` degrades a study (downscale, 1px blur, 0.62 contrast, a
JPEG round trip) plus the one thing a rendered page never has and every
photograph does — a lamp on one side — then through `straightenCanvas`, then read
and scored against the same hand marks `bench` uses. `SHRINK` sets how big the
photograph is and `READ_ACROSS` how wide it is read.

**IT IS THE SIZE OF THE PHOTOGRAPH, AND NOT THE LIGHT.**

```
  photograph   read at   staff space   RECALL of 1059 marks
    x0.72       1400px       6 px         51.4%    <- and the Bach: NO STAVES
    x0.72       2200px       9 px         42.4%       AT ALL, 0 of its 319
    x1.60       1400px      10 px         85.8%
    x1.60       2200px      16 px         82.4%
```

A staff line is ONE pixel wide before anything is done to it, and once it is half
a pixel it is gone: the crop of the failing Bach page shows its notes and beams
perfectly visible with the five lines a ghost between them. Reading a small page
at a bigger canvas does not bring them back — 42.4%, worse than reading it small,
because upscaling adds no ink — and neither does anything done to the contrast:

- **A cut scaled to the page's own darkest ink**, replacing the flat "16 levels
  under the local background", moved `scan:import` by nothing at all. The page
  HAS dark ink — it is on the notes — so a page-wide statistic never sees the
  lines. Reverted.
- **A softer mask for the staff lines alone**, at half the cut, used only by the
  line profiles and the page scale. Also nothing on `scan:import`, and it cost
  `bench` a point: the Concerto 95.4% recall to 94.2%, precision 91.8% to 90.4%.
  Reverted.

So the lever is upstream of the reader entirely, and there are only two things
that move it: how many pixels the camera gives, and how much of the frame the
page fills. The scanner now asks for `width: 4096, height: 3072` (ideal, not
min — a device that cannot give it must still open its camera), and a scan whose
staff space comes out under 8 pixels SAYS SO, because nothing downstream can put
back detail that was never in the file and the person holding the phone can fix
it in five seconds.

**WHAT WOULD BE WORTH TRYING NEXT, in order.** A still capture rather than a
video frame (`ImageCapture.takePhoto()` gives the sensor's full resolution where
it exists, which is Chrome and not Safari); raising the shutter's "fill the
frame" bar, since a page filling two thirds of the frame instead of a third is
twice the staff space; and — the one thing inside the reader that might survive
the measurement — tracking staff lines by their PERIODICITY in the greyscale
rather than in the binary mask, which is where a one-pixel line still exists.

## THE SCANNER-APP LOOK, and why it is two pages and not one

A player asked for it plainly: "notice how an app like Scanner Pro makes the
lighting better by making the page brighter and eliminating shadows. can you add
that to my scanner". `unshadow.js` had refused to do it for a stated reason —
pushing ink to black and paper to white turns a pencilled fingering into print —
and the refusal was right about the INK and wrong about the paper.

**What it does now.** The lighting is divided out as before (blur the picture
until the notes vanish, and what is left is the lamp), and then, for the page
that goes to the SCREEN, the paper is taken to just under white and the room's
colour is taken off it — each channel scaled by what that channel's own paper is
worth, so a page photographed under a tungsten lamp comes back white rather than
brighter tea. `npm run scan:light`: paper 255, ink 36, and the two far corners of
a page with a lamp across it read 255 and 253 — the shadow is gone.

**What it still refuses.** There is no threshold and nothing is snapped to either
end. `test/scan-enhance.test.js` has held since before this round that the ink
may be lifted with the paper around it and must never be pushed DOWN, and a knee
at the foot of the curve — the thing that makes a scanner app look crisp — took
the print from 53 to 49 of 255 and was taken out. A pencil mark still comes back
a shade lighter than the print beside it.

**And it is two pages, which is the part worth keeping.** MEASURED,
`npm run scan:import`: brightening the page the READER reads costs it notes —
51.4% of the marks on the three photographed pages down to 49.9%, the Concerto
losing two of its ten staves in the version that overshot — because taking the
paper up takes the faintest staff lines with it, and a staff line at a few per
cent under the paper is what a stave is found by. So the stored page keeps its
lighting flattened and nothing else, and the brightening happens in
`paper.js:brighten`, on the pixels going to the screen, at 33 ms a full-page
draw. The reader's own call passes `plain: true`, and so does the crop editor,
whose output is stored.

**One thing that was measured and is worth not re-deriving.** Taking the paper to
white by overshooting and letting the clamp do the work is what a first attempt
does, and it is why the reader lost those notes: everything within a few per cent
of the paper clips to white WITH it. The paper lands at 248 with headroom above
it instead.

## "IT SAID NULL AND DIDNT WORK" — what a failure is allowed to say

A player imported a PDF, opened it, and got the word **null**. That message could
not be reproduced here — the same file kinds import and open correctly on the
bench (`npm run score:open`, which is new and does the two things every other
tool skips: hands the file to the PICKER and opens the part from the SHELF) —
and it did not need to be, because the way every message in the app was built
made it inevitable:

```
  status(`could not open that score: ${err.message}`)
```

Three ways that says nothing. `err` may not be an Error at all — a rejected
fetch, a DOMException with no message, a library that rejects with a string or a
plain object — and `err.message` is then undefined. `err` may be **null**, in
which case `err.message` THROWS, inside a catch block, so the failure being
reported is replaced by a second failure nobody catches and whatever was meant
to happen next does not: a blank page and no explanation. Or the message is the
empty string, which several Safari DOMExceptions are.

`src/ui/why.js` is the answer and every user-facing catch in the app now goes
through it (20 of them). It takes anything at all and returns a sentence: the
message where there is one; a named explanation where there is only a name
(`QuotaExceededError` becomes "there is no room left on this device"); the
caller's own description of what it was doing where there is neither. It never
returns "null", "undefined" or "[object Object]", and it cannot throw.

**AND ONE REAL DEFECT CAME OUT OF LOOKING.** `loadPdfLib` wrapped both of its
imports in `catch { throw new Error('this browser cannot open PDFs — it is too
old…') }`, discarding the actual error. But the PDF engine is a CHUNK FETCHED THE
FIRST TIME A PDF IS OPENED, so a flaky connection, a deploy landing between the
page loading and the part being opened, or a practice room with no signal all
fail there too — and every one of them was told their browser was too old and to
photograph the pages instead. It now tells those two apart and says which.

## "I PLAYED THE EXACT NOTES … NONE OF THEM MATCHED" — the octave

A player recorded a FLUTE part against its own page and was told none of what
they played matched it. This was a known hole with a name: the note above FLOOR
in scan-view.js has said since the floor was built that "no take in scan:align's
corpus is octave-displaced wholesale … so this floor has never been tested
against one and would refuse it".

`exactAgreement` counts marks whose pitch agreed EXACTLY and excludes octaves on
purpose — `distance % 12 === 0` fires on any transposition, so letting octaves
vouch for a take would let a wrong piece in. That is right for a stray note and
catastrophic for a whole take displaced by one: every mark scores `octave`, the
agreement is zero, and a perfect performance is refused.

**Two ordinary things put a take an octave out, and neither is a wrong piece.** A
part can be played 8va. And the pitch reader can hear an instrument's second
harmonic rather than its first, which is ordinary on a flute — whose fundamental
is the weak one.

So a take is offered to the page as played FIRST, and only where that is refused
is it offered ±1 and ±2 octaves. A shift has to clear the floor AND clear the
unshifted reading by a wide margin, because five chances at one floor is five
times the chance a wrong piece slips through it. SWEPT, `npm run scan:floor`,
which now builds 128 takes of each page's own music played 8va and 8vb beside
its 128 foreign ones:

```
  leap    displaced takes placed    foreign takes surviving (of 128)
  none         128 of 128            17, six of them by a shift
  0.35         128 of 128            15, four of them by a shift
  0.50         128 of 128            12, ONE of them by a shift     <- shipped
```

Eleven of those twelve survive at written pitch and have nothing to do with the
search: it costs exactly one, and buys back every take played or heard in the
wrong register. The review says which way it went — "these came back an octave
above what is written — either played that way, or heard that way" — and
deliberately does not say whose doing it was, because nothing here can know.

**AND THE READER NOW LOOKS AGAIN WHEN THE MUSIC IS SMALL.** `WORK_WIDTH` is 1400
and its comment says "enough detail for a staff space of ~9px", which is true of
a page with four or five systems and false of a study page or a method book: at
1400 across those come out at four to six pixels, under every size this reader is
measured at. `readPage` now measures the space on a first pass and reads again up
to `WORK_MOST` (2400) where it is under nine, and `readPages` re-renders the page
to give it the pixels — but only for the pages that ask, since a re-render is the
most expensive thing in that loop. Upscaling is NOT done: a source with no more
pixels to give is left alone, because `scan:import` measures upscaling a small
photograph as worse (42.4% against 51.4%).

**One dead end from this round, so it is not chased twice.** `Burdett.pdf` looked
like the perfect reproduction — a "cello method book" whose pages 2 to 5 read
zero staves while page 1 read 40, with crops that cut 40% off the width. Every
part of that was measured, and then the page was DRAWN and looked at: it is an
academic essay about disability studies. Pages 2-5 read nothing because there is
nothing to read, and page 1's "40 staves and 492 noteheads" are lines of TEXT.
The crop was following the ink correctly the whole time. Look at the page before
believing a table about it — the oldest rule in this file, and it cost an hour.

## A NOTE STARTS WHEN THE SOUND STARTS — the last of the sync work

`npm run audio:fast` measured the recording half of "can a fast piece stay in
step with the page", and the answer had a systematic error in it: every note
came back **16-31 ms late**, with a spread of ±20-30 ms. A note was opened on the
first frame whose PITCH the segmenter believed, and believing a pitch takes a
4096-sample window plus a hop or two to settle. At semiquavers at 180 that is a
quarter of a note.

Energy needs no window. The analyzer now walks each hop in 1.4 ms blocks and
reports where the sound STEPPED UP — the first block more than 2.2× the one
before it — beside the pitch, and the segmenter opens its note there.

```
  notes/s   note      heard    lag (was)   lag (now)   10th..90th
     2      500ms     23/24      16ms        -0ms       -1ms..0ms
     4      250ms     23/24      20ms         0ms       -1ms..19ms
     8      125ms     23/24      29ms         2ms       -1ms..18ms
    12       83ms     22/24      31ms         5ms       -0ms..19ms
    16       63ms      8/24      23ms        -0ms       -1ms..18ms
```

**And it raised the ceiling as a side effect.** At sixteen notes a second the app
heard 8 of 24; it now hears 21. Nothing about the pitch reading changed — a note
was being thrown away by `minDuration` because its measured length was the part
AFTER the attack, which at 63 ms notes is under the 40 ms floor. Given its real
start, the note is long enough to keep.

**Three things it deliberately does not do**, each of which was wrong when tried:

- **It does not invent an attack.** A slurred note, a bow change under a slur, a
  note growing out of the one before it: no step in loudness, no back-dating,
  and the note keeps the time it was heard at. Inventing one would move it
  earlier than it was played.
- **It does not measure the rise against a floor that adapts.** Tried first: with
  a slowly-adapting floor every block of a loud note beats it, so the biggest
  ratio in a hop is wherever the note is loudest rather than where it began —
  median lag went straight back to 8-27 ms.
- **It does not take the biggest jump, but the first.** The biggest is the peak
  of the attack; the first is its start.
- **And it never reaches back behind the previous note's end.** Back-dating moves
  a start earlier and leaves the last note's end where it was, so without a
  clamp two notes overlap — and everything that asks "what is sounding now"
  would have two answers for one instant.

## THE TWO CASES THE ONSET WORK DID NOT COVER, and now does

The energy onset put an articulated note within a few milliseconds of where it
was played. It left two kinds of playing where it was, and both are ordinary:

**A SLUR HAS NO ATTACK.** A note played out of the one before it — most of what a
flute or a cello does — has no step in loudness at all, so there is nothing for
the energy to find and the note kept the time it was first BELIEVED at. What a
slurred boundary has instead is a ramp: the pitch window is 93ms and stamped at
its middle, so across a boundary the reported pitch slides from one note to the
other over a frame or two. The boundary is interpolated from that, clamped
between the last frame that was still the old note and the first that was the
new one — no extrapolation, because an answer outside those two frames is
arithmetic on noise.

And then the window's own bias comes off. The ramp is not really a ramp: YIN does
not average two pitches, it LOCKS onto one, and it changes its mind only when the
new note fills comfortably more than half the window. That surplus is a property
of the estimator, not of the instrument, and it is worth about a fifth of a
window. MEASURED, `npm run audio:fast -- --gap 0` — a true slur, one tone with
the phase running through the change of pitch, which is not the same thing as
notes with no silence between them (those still have their own fades, and the
energy onset finds them; measuring that and calling it legato is a trap this
round fell into first):

```
  median lag, 2 to 12 notes a second
  no interpolation            33  33  24  29  29  ms
  interpolated                22  17  17  19  15  ms
  …and the window's bias off  22   6   9  16  11  ms
```

Past a fifth of a window the correction stops doing anything, because the clamp
binds — which is the right way for a calibration to end: out of evidence rather
than out of nerve.

**AND AN ABSOLUTE LOUDNESS FLOOR ONLY WORKS AT ONE VOLUME.** `ATTACK_FLOOR` was
0.01, which is right for a cello a foot from the microphone and wrong for a flute
across a room or a phone in a case. MEASURED, `npm run audio:fast -- --gain 0.03`
(the same scale recorded quietly): with the fixed floor every note came back a
median of **25ms EARLY**, spread −36 to −17ms — what clears an absolute floor in
a quiet recording is not the attack but the noise around it. The floor now
follows the room: the quietest block heard lately, times three, with an absolute
minimum underneath so silence cannot make a hiss an attack. Same scale, same
gain: **0ms**.

```
                      articulated      legato        quiet (gain 0.03)
  median lag           0-5ms          6-22ms          0-5ms
  10th..90th          -1..19ms       -9..43ms        -0..19ms
```

The slurred case is the loose one and is honestly loose: a slurred boundary is
not as sharp as an attack, and `tests/onset.test.js` holds the articulated case
to 20ms and the slurred one to 40.

## THE FALSE CIRCLES ON A PRINTED ACCIDENTAL — four ways, all measured, none works

`scan-values.js` says the next thing worth doing is to stop circling things that
are not noteheads, because a bar that has one extra circle in it cannot add up
and the written-value route stays refused. On the Bach photograph the whole
population is seven circles, and they were cropped and looked at one at a time
at 6x: **one is the time signature, and six are the lower-left corner of a
printed sharp** — two thick strokes crossed by two thin ones, whose corner is a
solid blob the size and shape of a notehead.

The reader already knows those six are accidentals. `accidentalFor` looks at a
patch one and a third staff spaces left of each head and had NAMED them, so the
rule writes itself: a circle standing where a named accidental was found is that
accidental. It is the same reading used twice and it costs nothing.

**It does not work, and here is every version of it.** `npm run bench`, where
the baseline is Bach 97.8 / 99.7, Concerto 91.8 / 95.4, Scanned 91.5 / 99.5:

```
  rule                                   Bach invented   Scanned recall
  baseline                                    7             99.5%
  at the accidental model's floor (0.5)       6             98.5%   (-4 notes)
  …only where it is sure (0.9)                6             98.8%   (-3 notes)
  …only where it is certain (0.98)            7             99.0%   (-2 notes)
  …and only where the circle has NO STEM      7             99.5%   (inert)
```

The middle two buy one false circle on one page for three or four real notes on
another, which is the trade rule 2 forbids in the plainest terms. And the
version that keeps every note keeps every false circle with it, for a reason
that is obvious once seen: **a sharp is drawn with two vertical strokes**, so
`findStem` finds a stem through the corner and the circle is spared.

What defeats it in every version is the same fact about music: dense engraving
puts a real note exactly where the next note's accidental would be, and neither
position, nor the model's own confidence, nor the presence of a stem separates
those two populations.

**AND THE MODEL CANNOT BE ASKED DIRECTLY EITHER** — that was the first attempt,
in an earlier round, and it is worse: showing each head to the accidental model
centred on ITSELF takes `bench` from 93.7 / 98.2 to **48.7 / 8.8**, the Bach down
to two circles of its 319 notes, because the model reads a patch 4.8 spaces
across and a notehead's own patch looks like the patches it was fitted on.

So the population is understood, cropped and measured, and every route to it
through the reader's existing machinery is closed. What is left is a real
accidental DETECTOR — glyphs found by their own shape in the space before a
head, rather than a patch judged at a fixed offset — which is the thing
scan-key.js has been waiting for since the key signature was read.

## Run it

```
npm run dev                  # port 5199 — everything below needs this running
open http://localhost:5199/tools/reader-look.html
```

Drop a PDF or photo in. Tick **marking mode** to build ground truth: click a
ring that is not a note, click bare paper where one was missed, save. Marks are
positions, not indices, so they survive changes to the detector — that is the
whole point of them.

### What is committed and what is not — RE-CHECKED at HEAD `20e004d`, and it has moved AGAIN

**This section has now been wrong in both directions, so it carries the commands
and not a claim.** Every line below was run, at HEAD `20e004d`:

```
git ls-files --error-unmatch tools/key-probe.mjs tools/key-read-check.mjs \
    tools/key-safety-check.mjs tools/study-check.mjs src/analysis/acc-model.js
                                                         -> all five TRACKED
git show HEAD:package.json | grep -c '"scan:studies"'    -> 1
   …the same for scan:key-read, scan:key-safety, scan:key-why, scan:sizes,
     scan:few, acc:train, scan:chords and scan:clef-change  -> 1 each
   …but scan:steps and scan:lieder                          -> 0, 0
git show HEAD:tools/scan-corpus.mjs | grep -c SIZES      -> 9
git ls-files --error-unmatch CLAUDE.md docs/reader-handover.md
                                                         -> both TRACKED
```

**The four rounds an earlier copy of this section listed as uncommitted have
since been committed.** `scan-key.js`, `scan-notes.js`, `study-check.mjs`,
`key-safety-check.mjs`, `truth-check.mjs`, `glyphs.mjs`, `train-big.mjs` and both
repaired truth files no longer appear in `git status` at all. What sits in the
working tree now is the last TWO rounds — the stave model and the mid-system
treble — and every number in this file was measured against them:

```
src/analysis/scan-read.js     smoothTrack, the stave model's running median and
                              mean, WHICH IS THE PITCH FIX · tailUnderBody ·
                              findClefChanges taking the head clef and blanking
                              the accidental that falls inside a clef glyph
src/analysis/scan-clef.js     midBassAt DELETED · midTrebleAt added
tests/scan-clef.test.js       seven new tests (614 below)
tools/scan-clef-check.mjs     the treble rows, the controls, overFloor
tools/clef-change-check.mjs   bass->treble and tenor->treble
package.json                  scan:steps and scan:lieder
tools/reader-look.html        shows as modified; no recent round claims it
UNTRACKED — and the first three are instruments this document quotes:
  tools/step-truth.mjs        npm run scan:steps, the ONLY measurement of pitch
                              on real paper anywhere in this repo
  tools/stave-look.mjs        the model drawn on the page, magnified
  pages/truth/bach.pitch.json the 32 known steps of the BWV 1007 opening
  tools/lieder-check.mjs · tools/lieder-truth.ily
```

`git stash`, `git checkout` or a branch reset on this tree destroys all of it,
and the two untracked instruments are not even recoverable from a reflog.

**AND AGAIN AT HEAD `148a4c7`, which is where the scanned review was built.** Run
`git status --short`; what is untracked now is the whole of the review's scanned
half plus two more instruments this document quotes:

```
src/analysis/scan-sync.js     the head <-> recording-seconds bridge
src/analysis/scan-rhythm.js   the rhythm join
src/audio/written-pitch.js    the tone for a notehead nobody played
src/fixtures/take-fixture.js  a take without a microphone, in src/ so vite
                              serves it to the browser checks
pages/truth/scanned.values.json  the DURATION ground truth — npm run scan:values
tools/value-truth.mjs · tools/align-check.mjs · tools/rhythm-check.mjs
tools/scan-follow-check.mjs
tests/scan-sync.test.js · tests/scan-rhythm.test.js · tests/scan-follow.test.js
```

`package.json`'s `scan:values`, `scan:align` and `scan:rhythm` lines are
uncommitted with them.

**AND HEAD ITSELF IS A COMMIT THIS DOCUMENT NOW CONTRADICTS.** `20e004d` added
`midBassAt` and claimed a gain for it; the working tree DELETES it, with the
sweep that says nothing can replace it. A fresh checkout of this branch therefore
reads mid-system bass clefs that were never really read and fails both
must-be-zero lines of `npm run scan:clef`. See *The record on `20e004d`,
corrected*.

**`CLAUDE.md` IS TRACKED, and the claim in an earlier copy of this section that
it was untracked was wrong** — `git ls-files --error-unmatch CLAUDE.md` succeeds
and `git status --short CLAUDE.md` prints nothing. Its one false clause (that the
reader had never been tested on a clef change mid-system) was corrected in the
same round that wrote this line, so the two files agree today. **If they ever
disagree again, this one is the one that was measured.**

## Where it stands

`npm run bench` — every marked page, scored together:

```
page          space  found  really  precision  recall     F1   invented  missed   bars  clefs
Bach           12.1    324     319      98.1%   99.7%  98.9%         6       1     40  10/10
Mozart           10    335     328      93.1%   95.1%  94.1%        23      16     39  10/10
Scanned         9.6    439     412      93.4%   99.5%  96.4%        29       2     38  10/10
mean                            94.9%   98.1%  96.5%
```

**AND HERE IS WHAT `bench` CANNOT SEE, WHICH IS THE WHOLE POINT OF THE LAST
THREE ROUNDS.** That table is POSITIONS. A ring can sit dead centre on a notehead
and carry the wrong name, and the two numbers above cannot move when it does.
`npm run scan:steps` scores the other half — the step each hand-marked head
stands on, against the lines PRINTED around it:

```
  page              marks   read  scored   step right          wrong        whole page
  Bach photograph     319    248     248   229  92.3%   19  {+1:9, -1:10}      87.3%
  Concerto (PDF)      328    238     230   210  91.3%   20  {+1:4, -1:16}      91.6%
  Scanned score       412    303     301   279  92.7%   22  {+1:12, -1:10}     92.7%
```

Every wrong step is a wrong NOTE, a second out, whatever the clef and the key
then do with it. `read` is where the harness found the printed lines and `scored`
where it also had a detection to compare; `whole page` is the harness's own
reweighting of what it answered onto all the marks, and it is an estimate and
labelled one. **Where the wrong steps come from is printed too**, and the three
pages do not answer the same way:

```
  what is to blame for the wrong steps           Bach   Concerto   Scanned
  the stave model, out from the print in the
    same direction as the error                    13        0         0
  something else — the model square on the print    6       20        22
```

On the Bach the model is still the problem and all of it is on the two systems
`fillMissedStaves` INVENTED rather than tracked (item 0 of "The next step"). On
the other two pages the tool blames the model for NONE of the 42, and its own
model-off band puts every mark on both pages under 0.3 of a step — so whatever is
wrong there is not stave geometry. It is undiagnosed, it is now the larger half
of the reader's remaining pitch error on real paper, and it should not be
assumed to be the same bug (item 0d).

**WHICH OF THESE WERE RUN FOR THIS DOCUMENT, because "it holds" and "I ran it"
are different claims.** On the tree as it stands, this round watched these print:

```
  npm run bench            the table above
  npm run scan:steps  x3   229/248 · 210/230 · 279/301, and the tables below them
  npm run scan:studies     692 found, 666 right pitch, page key wrong 0, stave
                           key wrong 0, wrong by semitones {}
  npm run scan:key-safety  all five gated zeroes: 0/1008 · 0/1320 · 0/76 · 0/6 · 0/4
  npm run scan:clef        0 false fires · 15 notes wrong, 0 of them above its
                           controls' own floor · 18 of 26 changes · debt 129
  npm run scan:clef-change 86 confidently wrong on the changing pages, against
                           8 on the controls
  npm test                 52 files, 614 tests
  npm run scan:key-read    300 of 352 read correctly, **0 read as the WRONG
                           key**, 52 refused — THE SACRED ZERO HOLDS. It died
                           first on `protocolTimeout` at load 19 and was re-run
                           from a copy with the timeout raised, which changes
                           nothing it measures.
```

**NOT re-run this round.** Five of them stand on the mid-system treble round,
which reported every one byte-identical to the stave-model round before it:
`scan:corpus` 99/94/89/91, `scan:sizes` 89, `scan:few` 91, `scan:bars` (mean
recall 100%), `scan:clef-hard` 9/10. Nothing in the tree has changed since, so
the inference is fair, but nobody watched them today.

**`scan:chords` 81.4% is older than that and is attributed properly here**: it
was taken in the `20e004d` round — the one this document spends a section
correcting — and `src/analysis/scan-read.js` has changed twice since, for
`smoothTrack` and `tailUnderBody`. It is UNVERIFIED against the current tree.
Nothing rests on it either way: what chords cost this reader on real paper is
four suppressions and two notes, and that measurement is separate (see the chords
entry in "What is measured and does NOT work").

**PRECISION MOVED 95.0 TO 94.9 AND THE `bars` COLUMN MOVED A LOT, BOTH IN THE
SAME CHANGE**, which is *The stave model waves, and the pitch was lost in the
fit* below. Recall is flat to the digit on all three pages, which is the line
that is not allowed to move.

**THE SCANNED SCORE'S RECALL FIGURE IS NOT COMPARABLE WITH ANY EARLIER COPY OF
THIS TABLE, AND THE READER IS NOT WHY.** That page's denominator went 431 to
412 with a different COMPOSITION, not merely a smaller one: nineteen marks that
are not notes came off, thirteen more on the title block came off, and thirteen
printed noteheads nobody had ever marked went ON. 94.7% to 99.5% is not the
reader finding five points more notes. It found two — the change that moved it
is the phantom stave, below — and the rest is the measurement catching up with
the page. The `clefs` column is the tell: 10/11 to 10/10 on both Mozart pages,
because the eleventh "system" was the title block.

**THE GROUND TRUTH ON TWO OF THESE PAGES WAS WRONG, AND IT WAS WRONG IN BOTH
DIRECTIONS AT ONCE.** Seventy marks have now been removed across the two files
and thirteen added, every one cropped and looked at before it moved. **Nine of
the removals were hiding a bug in the reader** (see *One piece of ink reported
by two staves*) and **thirteen of the additions unblocked two changes that had
been measured and reverted for years of rounds** — the ledger overrule's
supposed precision cost and the phantom stave. The arithmetic is separated so
no half can be mistaken for another:

```
                       precision / recall
                 Bach            Mozart          Scanned         mean
before          98.8 / 99.7     92.0 / 95.1     89.3 / 94.7     93.4 / 96.5
truth repaired  98.8 / 99.7     92.0 / 95.1     89.7 / 99.5     93.5 / 98.1   <- no reader change
+ the phantom   98.8 / 99.7     92.9 / 95.1     93.4 / 99.5     95.0 / 98.1   <- reader change
```

Both rows are `bench` runs and neither is arithmetic: the middle one was taken
by restoring `src/analysis/scan-read.js` from the round's backup, running
`bench`, and putting it back. The middle row is the truth file alone and it is
not a reader measurement — dropping thirteen title-block marks turns eleven
detections that used to match into invented ones, which is why its precision
gain is only 0.4 on a page that had nineteen non-notes taken off it. The bottom
row is the reader alone against the middle row: **recall is flat to the digit on
all three pages** and precision is +0.9 on the Concerto and +3.7 on the Scanned
score, all of it the phantom stave going.

The Scanned score's per-stage walk, from `truth-check`, so nothing is conflated:

```
                                    precision  recall   invented  missed  really
  before                              89.3%    94.7%       49       23      431
  −19 marks that are not notes        89.3%    99.0%       49        4      412
  +13 printed heads never marked      92.1%    99.1%       36        4      425
  −13 marks on the title block        89.7%    99.5%       47        2      412
  + the phantom stave goes            93.4%    99.5%       29        2      412
```

**AND THAT PAGE'S CEILING IS NOW 99.5 RECALL, NOT 100, AND IT IS A DECISION.**
The two marks left in its `missed` column are real notes: 647,1191 is the lower
of two grace heads and 1304,1350 is a filled ledger head, and the reader rings
both — at 651,1186 and 1306,1345, which is 0.67 and 0.56 of a space away, just
outside the 0.5-space matching radius. So each is scored as a missed note AND an
invented head at once, and no change to the reader can move either: it already
found them. Both were cropped at 6x and 40x. **They were deliberately NOT
nudged onto their own ink.** Moving a mark is the one truth-file operation with
no independent witness — the only thing that says where it should go is the
detection it would then match — so the pair stands as a permanent floor of
2 recall and 2 precision on that page, recorded here rather than quietly fixed.

**THE ROUND AFTER THAT ONE MOVED NOTHING IN THIS TABLE, DELIBERATELY.** It
taught the reader to see a C-clef printed part way along a system — the thing a
cello part does every time it goes up and comes back down, and previously worth
**24 of 48 notes named a ninth wrong at `clefConfidence` 1** on an engraved
page. Every measurement below is BYTE-IDENTICAL across it, because the change is
constructed so that nothing deciding what gets CIRCLED can see it:

```
  bench · scan:studies · scan:key-read · scan:key-safety   byte-identical
  scan:corpus, all 49 rows · scan:bars · scan:clef-hard    byte-identical
  scan:clef, its first two blocks                          byte-identical
  scan:clef, its NEW third block   9 of 12 changes read · 0 false fires
                                   · 0 notes named wrong where one was found
  unit tests                       590 -> 607
```

On the fixture that found the bug — diagnosis 4's own, not one written to pass —
it now reads **48 of 48 right pitch, `offBy {}`**, where it read 24 right and 24
wrong by a ninth. See "A clef printed part way along a system".

**WHAT THE ROUND BEFORE THAT MOVED, against clean pre-edit baselines captured
before the first edit** (they reproduced the handover exactly: 93.4/96.5;
300/352 with 0 wrong; 666/692; 99/94/89/91):

```
                                    before            after
  bench  Bach                     98.8 / 99.7      98.8 / 99.7   identical
         Mozart                   92.0 / 95.1      92.9 / 95.1   precision +0.9
         Scanned                  89.3 / 94.7      93.4 / 99.5   see the walk above
         mean                     93.4 / 96.5      95.0 / 98.1
         clefs                    10/10 10/11 10/11 -> 10/10 10/10 10/10
  invented heads, all three       83               57
    standing on furniture         6                2
  truth-check --all, all three    SUSPECT LABELS: none on any page
  scan:corpus  CORE/HARD/SIZES/FEW  99/94/89/91 — BYTE-IDENTICAL, all 49 rows
  scan:studies                    666 of 692 — BYTE-IDENTICAL, whole file
  scan:key-read                   300 of 352, 0 wrong — BYTE-IDENTICAL
  scan:key-safety                 exit 0 — BYTE-IDENTICAL
  scan:bars · clef · clef-hard    64/72 · 15/15 · 9/10   unchanged
  unit tests                      586              590
```

The only reader change in it is `fillMissedStaves`' floor, so `scan:studies`,
`scan:corpus`, `scan:key-read` and `scan:key-safety` coming back byte-identical
is what says the change reaches only the pages that have a title block — no
drawn page in any of those corpora has one.

What has been taken off, in the order it was taken:

- `mozart.truth.json` four and `scanned.truth.json` five, **a second click on a
  note already marked**. Marking is done in passes — the page once, the misses
  swept up afterwards — and a head that was already marked gets marked again.
  The file says so: the pairs are notes 99/128, 85/100, 214/238 and 159/187 on
  the Concerto and 163/198, 141/165, 337/371, 347/377 and 341/374 on the Scanned
  score, every second member far later in the list than its twin. `CROP_MARKS=1
  CROP_TRUTH=… npm run scan:crop` on all nine: every one is a single filled
  notehead on a ledger line above the stave with its own stem, carrying two red
  dots overlapping into a figure of eight, and in eight of the nine two
  concentric green rings as well — the reader was reporting the same ink twice
  too. **The bound is not a new constant.** It is `near`, the radius
  `truth-check.mjs` already matches with, and the argument is structural: two
  marks closer together than the matching radius cannot both be scored, because
  one detection lands inside both. Such a page can never reach 100% recall and no
  change to the reader can move it. The populations do not touch — the nine stand
  0.0 to 4.1 pixels apart against a `near` of 5.0 and 4.8, and the next closest
  pair on either page is 9.0 and 8.0, which at those staff spaces is a third.
- `scanned.truth.json`, thirteen marks standing on the two crossbars of the
  printed key-signature sharp — a pair on system after system. Crop 114,497 and
  114,1199 and 111,635: all three are the sharp, with the first real note of the
  bar correctly ringed to the right.
- `bach.truth.json`, one mark on the round head of the bass clef (crop 100,310)
  and two clicks one pixel apart in the fork of a quarter rest (crop 311,751).
- `scanned.truth.json`, **nineteen marks out in the music with no head-shaped
  ink under them at all** — eleven on a bare stem, six on blank paper, two on a
  slur. This is the fourth contamination class this document had already named
  from two examples, swept properly at last: every one of the page's twenty-three
  missed notes was cropped at 6x with `CROP_MARKS=1 CROP_TRUTH=…`, and in
  nineteen of them the red dot sits on a thin vertical run, or on nothing, while
  the note it belongs to is a filled head two to four spaces away carrying both
  a ring and a dot of its own. `908,789` is the picture of the whole class: a
  dot in the middle of a stem three spaces below its own correctly ringed and
  dotted head. **The method, in the order it was used**: one `scan:sheet` at
  `--zoom 8` over all twenty-three, which sorts them but settles nothing; ten
  doubtful ones at `--zoom 20`, where a stem crossing a staff line stops looking
  like a head on one; three at `--zoom 40`; and then a `scan:crop` at pad 45–55
  of every one that was going to be removed, because `crop.mjs` draws the ring
  and the dot as filled shapes and a contact-sheet tile does not.
- `scanned.truth.json`, **thirteen marks on the printed letters of the title
  block** — "Édition · F. CARATGÉ · Solo · Concert · Lamoureux · Comique" and
  "W. A. MOZART". Looked at as two contact sheets at `--zoom 14`: every one is a
  green mark and a pink ring on a serif. They are the reader's own phantom
  stave, accepted by the marking hand, and they are what made the phantom fix
  read as a regression for three rounds. `truth-check.mjs` now reports them as
  `title` (see below) and `--clean` took all thirteen.

And **thirteen printed noteheads were ADDED**, which is the other direction and
the first time this file has moved in it. They are at 1259,530 · 588,908 ·
670,1182 · 412,1327 · 758,1322 · 898,1311 · 1187,1314 · 748,1458 · 818,1448 ·
341,1608 · 416,1594 · 456,1589 · 494,1592, all in the ledger passage of systems
3 to 11. Every one was cropped at 6x before it went on: a large filled head (one
a hollow MINIM, at 1187,1314) on a ledger line above the stave with its own
stem, several behind a printed natural or sharp, with the heads on either side
of it carrying a mark. **The falsification test is the Concerto**, which prints
the same passage x for x:

```
CROP_MARKS=1 CROP_TRUTH=pages/truth/scanned.truth.json CROP_PAD=110 \
  npm run scan:crop -- "Scanned score.pdf" 420,1595
CROP_MARKS=1 CROP_TRUTH=pages/truth/mozart.truth.json  CROP_PAD=110 \
  npm run scan:crop -- Concerto.pdf 420,1628
```

Four ledger heads at 338,1636 · 379,1629 · 419,1625 · 460,1628 against 341,1608
· 416,1594 · 456,1589 · 494,1592 — same notes, same natural-sharp-natural-sharp,
same slur — and `mozart.truth.json` marks all four while `scanned.truth.json`
marked none. Two truth files, one passage, opposite verdicts.

**THE COORDINATE OF AN ADDED MARK IS THE PAGE'S, NOT THE READER'S**, and that
distinction is the whole guard against this being the key-signature
contamination with the sign flipped. Taking the ring's own centre would make
"the reader circled it" the reason, which is exactly the mistake the thirteen
key-signature marks were. Each of the thirteen is instead the darkness-weighted
centroid of the ink within 0.75 of a staff space, measured off the working
raster — an independent statement about where the printed head is. The two
agree to between 0.04 and 0.29 of a space on all thirteen, which is the
strongest available evidence that the reader is centred on the ink and not on
something beside it. The file records them in a new `added` field, in the same
idiom as `removed`.

**A HAZARD THAT NOW HAS THREE FIELDS TO DESTROY, and nothing guards it.**
`tools/reader-look.html` builds its truth object from scratch on save —
`source`, `width`, `height`, `space`, `marked`, `notes`, `rejected` — so saving
over any of these files from the marking tool would silently drop `cleaned`,
`removed` and `added`, which is the entire record of why the Scanned score's
denominator is 412 and not 453. `--clean` was made to append for exactly this
reason; the marking tool has not been. Whoever marks a page next should save to
a NEW name and merge, or teach the tool to carry the three fields through.

This matters more than the point of recall it is worth. A truth file that calls
the key signature a note **rewards the reader for circling it** — every
improvement to the key-signature suppression then shows up as a recall
regression, and the measurement argues against the fix. Both files record what
was removed in their own `cleaned` and `removed` fields; nothing was deleted
that was not first drawn on screen and looked at.

`tools/truth-check.mjs` reports such marks under SUSPECT LABELS and `--clean`
writes a corrected copy. **`--clean` used to overwrite the `cleaned` and
`removed` fields rather than appending to them**, and both files had already
been cleaned once by hand — seventeen entries on the Scanned score, three on the
Bach, none of which a fresh run can reproduce, because a mark that is gone
cannot be detected again. One `--clean` would have deleted the whole record of
why that denominator is 412 and not 453. It appends now.

**IT NOW HAS A FOURTH SUSPECT CLASS, `title`, and the bound is borrowed rather
than fitted** — the same discipline as `near`. A mark is suspect when it stands
further above the topmost stave that READ A CLEF than `findHeads` will ever look:
`reach = space * 7`, the constant at `scan-read.js:1806`, four ledger lines. Two
things follow from borrowing it. A mark the reader cannot reach cannot be scored
against it, so removing one takes nothing away, exactly as with two marks inside
one matching radius. And a stave with NO CLEF is not a witness — which is the
point, because the phantom these marks were made on is precisely a stave with no
clef. Measured, every mark on every page, in staff spaces above that line:

```
  Scanned    13 marks at 11.9 to 19.9 · the next nearest mark on the page  2.7
  Concerto   nothing past 7          · the highest mark on the page        2.1
  Bach       nothing past 7          · the highest mark on the page        2.4
```

More than four to one of daylight on the page that has the population, and it
fires on nothing at all on the two that do not. Its clef test is now ONE-SIDED — everything at or left
of where the clef band ends, with no left bound at all — because nothing is
printed to the left of a clef on any system of any page, and the rule it
replaces ran from the stave's own measured edge, which is the number most likely
to be wrong. On the Bach's indented first system the edge measures 136 where the
clef is drawn near 95, so the mark on the bass clef fell in the gap between them
and was never tested: the detector was blind exactly where the reader is
documented as measuring badly, and "no suspect labels printed" was being read as
"this page is clean". The two marks on the quarter rest are in the music and no
furniture rule can ever catch them; they were found by a reviewer cropping the
page's four missed notes one at a time.

**A round of pure documentation repair found about a dozen figures here that no
longer reproduced** — every one true when it was written and overtaken by a
later change in the same round.

**Be precise about what that round did and did not verify.** It re-ran `bench`,
`scan:train`, `scan:curve`, `scan:corpus` (all four blocks), `scan:key-read`,
`scan:key-why` on all three marked pages, `scan:key-safety`, `scan:clef`,
`scan:clef-hard`, `scan:bars`, `scan:spread`, `scan:stems`, `scan:res` on the
Scanned score, `truth-check --all` on all three pages, and the test suite, and
corrected every figure those printed. **It did NOT re-run** `scan:heads-audit`,
`scan:ledger`, `scan:key`, `scan:why`, `scan:bar-why` or `reader:mark`, and it
did not re-measure the sweeps recorded in "What is measured and does NOT work" —
the `beamMask` figures, the `onRule` bridge, the `LEDGER_LONGEST` sweep, the
blur-box conversions, the `combPeaks` percentage window, the six ledger
discriminators. Those are as their authors left them. Treat a number in this
document as verified only where it says so.

Three habits caused all the rot that was found, and they are worth naming
because the next round will do it again otherwise:

- a delta table written mid-round (`before` → `after`) is still correct as
  history and reads as current the moment anything else moves. Those are now
  labelled **at the time** with a pointer to the live table;
- a figure quoted in prose in one section and in a table in another drifts apart
  silently. The key-signature agreement counts had **four** different values in
  this file at once;
- a number derived from a file that has since been overwritten cannot be
  re-measured at all. Those are labelled as historical, not corrected.

**That round moved precision and did not touch recall by a digit** — mean
precision 92.1% to **92.8%**, mean recall 94.9% either way, on all three pages.
(Both figures are **at the time**. The live mean is 94.9 / 98.1, five rounds and
seventy truth marks later — the table at the top.) That is the only shape of change this table is allowed to
make. It was one change —
the page agreeing how far its own key signature reaches, below — and the eight
false circles it removed were all standing on the printed sharp beside the clef.
The round's other half is measured and REVERTED and is in "What is measured and
does NOT work"; the user asked for both.

**The Scanned row moved on the day the TRUTH FILE was corrected and not on any
change to the reader.** Thirteen of its marks stood on the two crossbars of the
printed key-signature sharp — the hand that marked the page accepted the
reader's own false circles — and they are now removed, with the removal recorded
in the file's own `cleaned` and `removed` fields. Any number anywhere in this
document measured against **453** notes on that page — or against 440, or 436,
or 431 — is stale by construction; the denominator is **412**, and it got there
by four separate sweeps in both directions. See the top of this document.

An earlier round moved that from 91.6% / 93.7% by two changes, both aimed at
noteheads and neither at a threshold: **one head per stem end** in `stemHeads`,
and **centring a kept head on its own ink** at the end of `findHeads`. Every
other measurement was untouched by them **at the time** — `scan:clef` 15/15,
`scan:key-read` 163 of 224, 540 unit tests. The comments above each say what was
swept and what it cost. Live today: `scan:key-read` reads **300 of 352** printed
signatures right with **0 read as the wrong key**, and there are **614** unit
tests.

**The round after that did not move this table at all, on purpose**, and moved
the ones below it a long way. It was about SIZE: every number above comes from a
staff space between 9.6 and 12.1 pixels, and a phone held closer or further away
moves that by a factor of four. Three changes went into `trackCombs`, all of
them asking the page instead of carrying a number, and all three are neutral on
the three marked pages to the digit:

```
                            HARD mean   downStems   SIZES mean   marked pages
before                          89%           0%         77%        92.1 / 94.0
after                           93%          97%         89%        92.1 / 94.0
```

**The marked-pages column there is AT THE TIME**, against the truth files as
they then were — the Scanned score still had its thirteen key-signature marks,
which is where 94.0 comes from rather than 94.9. The point of the row is that it
did not move, and it did not.

`scan:clef-hard` went 8/10 to 9/10 and `scan:bars` 63 to 64 perfect systems of
72; `scan:clef`, `scan:key-read` and the 540 unit tests were unchanged. See "How
big is the page" below, and four measured negatives in "What is measured and does
NOT work" — including the one the brief for that round asked for.

**CORE's MEAN is unchanged at 99% and four of its rows moved**, which is the
honest way to say it: `tiny` 126 to 127 found, `tilted` 140 to 141 and `creased`
141 to 142 — one extra false circle each — and `photograph` 96/95/91 to
**98/94/92**, two notes of recall for one beam. Nothing lost a stave anywhere in
either block.

**"Neutral on the marked pages" is a printed comparison and not an inference**,
because it decides whether the classifier has to be retrained. The per-system
fitted staff spaces, the per-system clefs and the per-system matched-plus-invented
head counts were dumped before and after and are identical to the digit on all
three pages — Bach `11.99 12.06 12.08 12.14 12.12 12.14 12.29 12.26 12.27 12.39`,
`32+1 32+1 32+2 32+0 31+0 31+1 32+1 32+0 32+1 32+1`, and the same for the other
two. The candidate distribution `head-model.js` was fitted to has not moved, so
`scan:patches`/`scan:train` were correctly not run. Note the claim is about the
three TRAINING pages specifically: four corpus rows did move by a head.

**The Scanned column is not comparable with the other two, and the reason is in
the truth file rather than in the reader.** Thirteen of what were then four
hundred and fifty-three marks were on the key signature — a pair per system at
x = 110 to 116, on systems 3, 4, 6, 7, 8, 10 and 11 — sitting on the two
crossbars of the printed sharp. `CROP_MARKS=1
CROP_TRUTH=pages/truth/scanned.truth.json npm run scan:crop -- "Scanned
score.pdf" 120,920` shows them plainly: two red dots on the sharp, and no green
ring, because the reader now knows better. Thirteen more sit on the title block
— see "Known broken". Those twenty-six marks were scored as notes the reader
failed to find, so the page's recall figure credited the reader for circling the
composer's name and the key signature, and it fell **92.7% to 91.4% at the
time** the reader stopped doing both.

**Both sets of thirteen have since been removed** — the key-signature marks in
one round and the title-block marks in a later one — and `--clean` in
`tools/truth-check.mjs` reports both under SUSPECT LABELS. The paragraph above
is history; the live figure is the headline table.

**And the third contamination in that file ran the other way**: ten or more of
its ledger notes were not marked at all, so the page's PRECISION column punished
the reader for finding them. Thirteen have now been added. That one could not be
cleaned automatically — nothing can detect a mark that was never made — and it
was found by cropping the INVENTED column one entry at a time, which is the
method the next such sweep should use.

False circles standing on the furniture — counted by the `by furniture` line of

```
node tools/truth-check.mjs "<pdf>" --truth pages/truth/<page>.truth.json --all
```

(invoke the tool directly; `npm run scan:truth` swallows `--all` as its own
flag). That line splits every INVENTED head into the furniture it stands on —
`clef`, `key-unfound` — or `music`, meaning it is out in the notes. Furniture is
everything that is not `music`. Re-measured this round, all three pages:

```
                       Bach   Mozart   Scanned   total
  invented, total         4       24        29      57
    on the clef           0        0         0       0
    on an unfound band    2        0         0       2
    out in the music      2       24        29      55
  FURNITURE               2        0         0       2   of 57 invented
```

Three earlier readings of that same line, kept because the trend is the point
and none of them reproduces now: **27 of 107** invented (Bach 9 · Mozart 12 ·
Scanned 6) before the furniture work, **13 of 98** (3 · 7 · 3) after it and
before the page-agreed key reach, and **6 of 83** (2 · 1 · 3) before the phantom
stave went. It is **2 of 57** today, and both survivors are on the Bach.

**The Scanned score's column is zero for the first time**, and that is the
phantom stave: every ring it had on furniture was on a letter of the title
block. The two on the Bach are the same two named under "The band could stop
inside the sharp" — inflection accidentals in the first bar, not key signatures
at all.

**The key signature's own share went 12 to 4**, by the page agreeing how far it
reaches — Bach 4 to 2, Concerto 7 to 1, Scanned 1 to 1. The four that remain are
all out of the suppression's reach and are named individually under "The band
could stop inside the sharp": two on the Bach are INFLECTION accidentals
standing in the first bar rather than key signatures at all (looked at,
`CROP_MARKS=1 npm run scan:crop -- Menuet.pdf 117,1276`), and two are on the
clef-less phantom staves of the other pages, where no suppression of any kind
runs.

**Do not use `npm run scan:key-why`'s "noteheads stand …" line as this count.**
It over-counts by an order of magnitude, and the tool now says so in its own
output: its zone runs 12.6 staff spaces from the stave's left end, which on the
Bach ends at x = 186, and the truth file has 18 real hand-marked notes inside it
(9 on the Concerto, 13 on the Scanned score). Re-run for this document, that
line reads **22 on the Bach, 12 on the Concerto and 15 on the Scanned score**
against a real furniture count of **2, 0 and 0**. It is a per-system symptom count for
comparing systems on one page — a system whose band came back null carries a
visibly bigger number than its neighbours — and the table above is the score.

### WHERE THE CIRCLE SITS — and why `by pass` was never a measurement of it

**THE USER'S FIRST COMPLAINT HAS BEEN SCORED AGAINST THE WRONG POPULATION FOR
EVERY ROUND SO FAR, AND THE ERROR IS A FACTOR OF THREE.** "Many false circles
still happen oftentimes in the stem at the bottom." Every round has answered
that with `by pass` — shape against stem — and `by pass` says which CODE PATH
proposed a head, not WHERE THE CIRCLE SITS. The Bach's remaining circle at
(117,1815) settles it: it is a ring at the foot of a stem where the stem meets
the beam, and `by pass` calls it `shape`. Five candidate rules were rejected
after being scored against a population defined by which pass proposed a head.

`node tools/truth-check.mjs "<pdf>" --truth pages/truth/<page>.truth.json` now
prints a third breakdown, **`BY SHAPE OF ERROR`**, beside `by pass` and `by
furniture`. It asks the ink, not the code path:

- a thin vertical run passes through or ends at the candidate — the reader's own
  `STEM_TALL` of 2 spaces, and a width test on the LOW QUARTILE down the run
  rather than at its midpoint;
- a real notehead — **a truth mark**, so nothing the reader did can move the
  label — stands on that same run, at least 0.9 of a space away;
- so the circle is somewhere along a stem rather than on the head it belongs to.

```
                                    invented           correct        AT THE TIME
  page        total            stem-foot   stem     stem-foot     of
  Bach            6              3          3          0        318
  Mozart         37             18          3          9        304
  Scanned        40             20          8        162        415
  all three      83             41         14        171       1037
```

`stem-foot` is "in a stem with a real head on it"; `stem` is a thin vertical run
with no other head on it, which is what a notehead's OWN stem looks like and is
therefore not evidence of anything. The other rows are `beam` (0 / 4 / 1
invented) and `other` (0 / 12 / 11).

**LIVE, after the truth repair and the phantom stave, re-run for this document
on all three pages** — and the shape of the finding is unchanged, which is the
point of printing both:

```
                                    invented           correct
  page        total            stem-foot   stem     stem-foot     of
  Bach            4              2          2          0        318
  Mozart         24              9          3          9        312
  Scanned        29             22          4        146        410
  all three      57             33          9        155       1040
```

**HOW BIG THE USER'S COMPLAINT ACTUALLY IS: 33 of the 57 false circles on the
three marked pages stand in a stem** — it was 41 of 83 — **and 16 of those 33
were proposed by the SHAPE pass rather than the stem pass** (Bach 2, Concerto 9,
Scanned 5; the figure read 14 before the truth repair). `by pass` calls 19 of
the 57 `stem`. So the complaint is still under-counted by `by pass`, by a factor
of 1.7 rather than 2.7, and the shape pass is still where half of it comes
from. The other rows now read `beam` (0 / 4 / 1 invented) and `other` (0 / 8 /
2): **the Scanned score's `other` fell 11 to 2**, which is the title block
going.

**THE TALLY IS HAND-MADE FIRST AND THE INSTRUMENT AGREES WITH IT.** All 83 were
cropped and classified by eye before the detector existed
(`tools/crop.mjs`-style crops at 4x to 8x, plus wide-context crops for the
thirty-five that were not obvious). The hand tally:

```
                                              Bach  Mozart  Scanned  total
  at the foot of a stem                          3      18       21     42
  on a beam, no stem through it                  0       4        1      5
  a rest                                         0       5        0      5
  an accidental                                  2       1        0      3
  text, a dynamic or an ornament                 0       7       11     18
  a printed time signature                       0       0        1      1
  A REAL NOTEHEAD THE TRUTH FILE DOES NOT MARK   1       1        4      6
  a second circle on a head already circled      0       0        2      2
  something else                                 0       1        0      1
                                                 6      37       40     83
```

**Hand and instrument agree on 41 of the 42, and the `beam` row matches exactly
at 5.** The single disagreement is the Scanned score's (525,481), a ring on a
stem whose own notehead is 0.73 of a space away — inside the 0.9-space floor
that separates "another note's head" from "this circle's own", so the instrument
files it as `stem`.

**Eight points were adjudicated a second time, at 7x, because the first pass and
the instrument disagreed, and in seven of the eight THE INSTRUMENT WAS RIGHT.**
(306,1100) on the Scanned score and (825,967), (1059,1107), (1229,1243),
(1232,1224) on the Concerto are rings standing on a BEAM about a space to the
right of the nearest stem, which the eye at 3x had generously called stem feet;
(869,1332) and (1147,650) are stem feet the eye had left unclassified. The tally
above is the corrected one. **This is the reason the instrument had to exist: at
3x a beam and a stem foot are the same smudge.**

**SIX OF THE 83 ARE THE READER BEING RIGHT.** Cropped one at a time, they are
plainly printed noteheads with no truth mark on them, or with a mark more than
half a space away:
`CROP_PAD=110 CROP_MARKS=1 CROP_TRUTH=pages/truth/bach.truth.json npm run
scan:crop -- Menuet.pdf 200,1120` shows the Bach's (137,1097) — the first note
of the bar, on the middle line, down-stem into the beam, ringed and unmarked.
The others are the Concerto's (555,779) and the Scanned score's (1259,530),
(589,906), (1188,1311) and (1306,1345); two of those are minims. So the
precision column on every page is pessimistic by a note or two, and the Scanned
score's by four.

**THAT WAS AN UNDER-COUNT OF THE SCANNED SCORE BY A FACTOR OF THREE, AND THE
FOUR NAMED HERE ARE WHY IT WAS BELIEVED.** A later round cropped all fifty-one
of that page's invented heads rather than the ones that looked wrong, and found
FOURTEEN printed noteheads with no mark on them, not four. Thirteen are now on
the file — (1259,530), (589,906) and (1188,1311) among them — and the
fourteenth, (1306,1345), was left alone because the head it stands on is already
marked at (1304,1350), 0.56 of a space away: adding it would have manufactured
exactly the doubled mark nine of which had just been removed. **The lesson is
the same one this document keeps re-learning in a new costume: a population is
measured by looking at all of it. The Concerto's (555,779) and the Bach's
(137,1097) have NOT been swept the same way and are probably still an
under-count of those two pages.**

### ALL 162 WERE LOOKED AT, AND THE TWELVE-POINT SAMPLE WAS WRONG

The section below concluded from a twelve-point sample that the Scanned score's
162 stem-foot marks are mostly its own contamination — eight of twelve standing
on a bare stem — and that re-marking the file is what unblocks every one-head-
per-stem rule. **All 162 have since been looked at, and that conclusion does not
survive it.**

`npm run scan:sheet` lays crops out in a grid — twenty-four to a sheet, each with
the reader's ring in pink, the hand's mark in green and a crosshair on the point
the tile is about — so a hundred and sixty-two marks can be SEEN rather than
sampled. Seven sheets at five times, twenty-seven candidates carried forward to
nine times, five of those to sixteen.

  **Four are contamination.** (466,779), (519,1056), (942,1331) and (1129,1331)
  are blank paper carrying the reader's own phantom ring with a hand mark
  accepted on top of it. They are removed, and recorded in the truth file's own
  `removed` field.

  **The other 158 are noteheads.** Dark, filled, head-shaped, with both rings on
  them — and very often two of them stacked a third apart on one stem, which is
  what this music is.

**FOUR OF THOSE 158 ARE NOT, AND THE CORRECTION IS WORTH MORE THAN THE FOUR
MARKS.** (340,1206), (1311,1210), (979,1331) and (245,1487) were among this
sheet's population and came off in the round that repaired the file, each after
a crop at 6x that puts a red dot on a bare stem or on blank paper with the real
head two to four spaces away. **The 39% conclusion survives** — the column now
reads 146 of 410, 35.6%, against the Concerto's 9 of 312 — and so does
everything that follows from it, because the population is still overwhelmingly
noteheads and one head per stem still loses real notes. What does not survive is
the sentence "the other 158 are noteheads" as a statement about every member.

**AND THE METHOD NOTE THAT CAME WITH IT, which is the durable part.** One of the
four, 979,1331, had been classified as a genuine near-miss on the strength of
its distance to the nearest detection — 0.94 of a space, so surely the reader
had found it and mislocalised. **The nearest detection was itself invented.**
980,1322 is a ring on the same bare stem, and the two were being used to vouch
for each other. A distance-to-nearest-detection test says nothing whatever about
a mark whose neighbourhood is full of phantoms, which is exactly the
neighbourhood a contaminated page has. The crop at 40x settles in one look what
the distance cannot settle at all.

**THE SAMPLE FAILED IN THE EXACT WAY THIS DOCUMENT ALREADY WARNS ABOUT.** The
entry below says it in as many words: "at 3x a beam and a stem foot are the same
smudge". At five times a notehead sitting ON a staff line and a stem crossing
that line are also the same smudge, and the first pass over these sheets called
about a fifth of them suspect on that basis. At nine times most of the suspects
were plainly heads. **Magnification is not a detail of the method, it is the
method** — and a sample of twelve is not a measurement of a hundred and sixty-two
when the error rate of the eye at that zoom is itself twenty percent.

**SO THE 39% IS REAL, AND THREE THINGS FOLLOW.**

- **One head per stem is dead for a REAL reason.** The notes those rules lose are
  notes. Nothing about re-marking the file rescues the idea.
- **The Scanned score genuinely prints 39% of its heads at another note's stem
  end.** The argument from "it is the same music as the Concerto, so it cannot
  have thirteen times the rate" is weaker than it looks: it is a different page
  of that music, in a different edition, with 436 heads against 332, and the
  classification also depends on the reader finding the stems.
- **The classifier work is not blocked on the truth file.** When a model rejects
  those heads it is losing real notes, and the number is what it says.

**"Re-mark that file", which was next-step item 3 for several rounds, is DONE
and struck off the list entirely.** The file's known
contamination is now sixteen marks on the key signature, one on a bass clef, two
on a quarter rest and these four: twenty-three, all removed, all cropped first.
**And a later round took another thirty-two off it and put thirteen on** — see
the top of this document. That file is now clean by every detector it has and by
every crop taken of what those detectors cannot see.

Removing the four cost precision, and that is the measurement becoming more
truthful rather than the reader becoming worse: the Scanned score read
**90.3% / 94.3%** against 91.2% / 94.3% **at the time**, because the reader had
been credited with four circles drawn on blank paper. The live figure is the
table at the top.

### THE CORRECT-HEAD COLUMN IS THE ONE THAT DECIDES WHETHER ANY OF THIS IS FIXABLE

A rule that removes circles standing in a stem is only worth having if real
noteheads do not also stand there. **Nobody had measured that. They do, and the
rate is the difference between the two clean pages and the contaminated one:**

```
  correct heads at the far end of another note's stem      LIVE, after the repair
    Bach          0 of 318     0.0%                          0 of 318   0.0%
    Concerto      9 of 304     3.0%                          9 of 312   2.9%
    Scanned     162 of 415    39.0%                        146 of 410  35.6%
```

**The right-hand column is the same measurement after the truth file was
repaired**, and it is the answer to the doubt the left-hand one raised: taking
nineteen non-notes off that page and putting thirteen real heads on moved 39% to
35.6%, not to 3%. The engraving is what it is. **And the invented side of the
same row is the bound the next attempt has to beat: 22 invented against 146
correct**, where it used to read 25 against 156. Nothing about the file rescues
one head per stem.

**The Concerto's nine are GENUINE and were cropped one at a time: they are
chords.** Its opening bars print two and three noteheads stacked on one stem and
the truth file marks every one of them, so a real notehead at the far end of
another note's stem is a real arrangement in engraved music. That is the
viability number, and it is 3%.

**The paragraph below is the twelve-point sample and it is WRONG — it is kept
because the section above it is the correction and the two only make sense
together.** All 162 were looked at afterwards and 158 are heads; four of those
158 were later shown to be marks on bare stems and came off. Do not read the
next paragraph as a live finding.

**The Scanned score's 162 are mostly its own truth file, and a twelve-point
sample says so.** Cropped: eight of the twelve have their collinear "notehead"
standing on a BARE STEM with a truth dot on it and no head-shaped ink under it —
the fourth contamination class already recorded in "Known broken", where a hand
clicking through four hundred rings accepted the reader's own phantom. One is a
genuine chord (the same music as the Concerto's opening) and three are
unresolved. **The Scanned score is the same music as the Concerto**, so it
cannot have thirteen times the Concerto's rate of stem-collinear noteheads; the
difference is in the marks, not in the engraving.

**Which is the mechanism behind a fact this document has been recording for
rounds without an explanation: every one-head-per-stem variant "loses real
notes" on that page and on no other.** The notes it loses are marks on stem
feet. Re-marking that file is what unblocks this, and the `stem-foot` column of
`BY SHAPE OF ERROR` is now the fastest way to find the marks that need removing.
**That re-marking is DONE and the rule is still dead** — see the correction two
sections up: the ratio it broke on got worse, not better. The stem-circle item
is now number 7 of "The next step".

### THE LEDGER OVERRULE IS SETTLED: KEEP IT, AND IT COSTS NOTHING

The rule that a sure second judge may overrule `LEDGER_LONGEST` (the `||` in
`readPage`, `LEDGER_OVERRULE` = 6 spaces of run and `LEDGER_SURE` = 0.9) has
been carried for rounds with an apology attached — "THE SCANNED SCORE PAYS FOR
THIS", 1.9 points of precision traded for the Concerto's recall, taken on the
doctrine that a missing note breaks an alignment and an extra circle is
cosmetic. **The trade was not real.** Of the thirteen detections the overrule
owns on that page, three were marked notes and the other ten were printed
noteheads nobody had marked; they are among the thirteen now added.

Re-measured against the repaired files with `tools/whatif.mjs`, all three
options on all three pages:

```
  page       KEEP (live)   REVERSE       NARROW run 4.5   NARROW sure 0.99
  Bach       98.8 / 99.7   98.8 / 99.7   98.8 / 99.7      98.8 / 99.7
  Mozart     92.9 / 95.1   92.6 / 91.8   92.8 / 94.8      92.7 / 93.0
  Scanned    93.4 / 99.5   93.2 / 96.4   93.4 / 99.5      93.4 / 99.5
```

REVERSE now costs **3.4 points of the Concerto's recall AND 3.2 of the Scanned
score's** and buys 0.2 precision on neither. NARROW cannot reach the Scanned
score at all, at any setting of either constant — it moves that row by exactly
0.0/0.0 while costing the Concerto up to 2.1 recall — and the reason is
measured rather than argued: the thirteen heads that fire there read `ledgerRun`
3.01 to 4.12 against a bound of 6 and MLP 0.9967 to 1.0000, while the
Concerto's eleven span 3.03 to 5.15 and 0.9232 to 0.9992. Tightening either
number deletes the Concerto's real notes first.

**And the plainest statement of it, which only became sayable once the file was
repaired: every head this overrule rescues is a real note — 13 of 13 on the
Scanned score and 11 of 11 on the Concerto.** Its precision cost is not worth
paying; it is zero. The probe that prints those two distributions and the
marked/unmarked split is `ledger-why.mjs`, kept read-only in the round's
scratchpad; it is `whatif.mjs`'s trick with the filter patched to record what it
decided instead of a constant patched to a different value, which is a shape
worth reusing.

### What the instrument is, and how it says when it has drifted

Three things had to be got right and each is written above `shapeOf` in
`tools/truth-check.mjs` with the measurement that forced it:

- **the stem is measured in `body`, not in `ink`.** In the raw ink a stem crosses
  a staff line every space and a staff line is a horizontal run hundreds of
  pixels long, so "how wide is this stem" answers three hundred at every
  crossing. The Concerto's (238,686) reads a low-quartile width of 1.10 spaces in
  `ink` and 0.40 in `body`. Fifteen of that page's thirty-seven moved on that
  line. `body` is also the layer `findHeads` looks at.
- **the width test asks the LOW QUARTILE down the run, not the midpoint.** This
  is the same correction `beamMask` already makes about its own baseline. A stem
  is wide exactly where something joins it, and the midpoint of a short
  photographed stem is inside the beam: the Bach's (117,1815) — the case that
  started this round — medians 1.07 spaces and quartiles 0.25.
- **the walk steps over a two-pixel break**, because a four-pixel photographed
  stem thresholds into pieces and a strict walk stops short of its own head.

**And it carries its own smoke alarm, the way `tools/head-probe.mjs` does.**
Almost every notehead has a stem, so the share of CORRECT heads under which this
code finds one is a measurement of the stem finder on a thousand points known to
be noteheads: **96% on the Bach, 97% on the Concerto and 98% on the Scanned
score**, re-run for this document and printed every run. (The Scanned score read
95% before its truth file was repaired — nineteen marks on bare stems and blank
paper is exactly the population that dilutes this alarm.) Below about 90 the
`stem-foot` column has stopped meaning what it says.

**MEASURED AND NOT KEPT: a second look in the raw ink.** `body` loses a stem
when beamMask erases the beam column it hangs from — the Scanned score's
(306,1100) reads 1.76 spaces there. Searching both layers and keeping the longer
qualifying run changed **not one** of the 83 false circles or the 1037 correct
heads, because the raw ink puts the staff lines back and those columns read a
low-quartile width of 3.11 spaces. Cropped, that circle is not a stem case at
all: it stands on the beam 1.2 spaces right of the stem, which is what `beam`
already says. The entry is left in the code above `inBody`.

**AND `npm run bench` WAS SILENTLY DROPPING PAGES, WHICH IS FIXED.**
`truth-check --json` called `process.exit(0)` straight after `console.log`, and
`console.log` to a PIPE is asynchronous in node — so anything past the pipe's
64 kB buffer was thrown away. The Scanned score's report was 52 kB of the 64
available; adding this breakdown took it to 90, and two of bench's three pages
came back as "Unexpected end of JSON input" with the mean computed from the one
that fitted. Redirecting the same command to a FILE hid it completely, because a
file write is synchronous. It now waits for the write callback. **`bench` is
identical to the digit afterwards — 98.1/99.7, 89.1/91.6, 91.2/94.3, mean
92.8/95.2 — and 563 tests pass.**

The key signature is now READ and not merely located: all three pages come back
ONE SHARP, F sharp, G major or E minor, unanimously among the systems that read
one, and no system on any page reads anything else. The live counts are in "The
three marked pages" below and are the only place in this file that states them.
`npm run bench` is unchanged to the digit by that work, which is as it should
be: it adds a reading, it does not change which circles are drawn.

**AND THAT READING BROKE ITS OWN CONTRACT IN FOUR PLACES, WHICH IS ALSO FIXED.**
Tenor clef was wrong by two degrees in two files — in a cello app — and answered
"one sharp, F sharp" for a glyph standing on D; a plain notehead was classified
as a sharp and one such system could name a whole page's key; `agreeKeyCount`'s
low quartile WAS the minimum on any page of four systems or fewer; and a
signature the scan cut short was read as the valid-looking prefix it resembles.
`scan:key-read` went 163 of 224 to 159 **at the time**, and **the four WRONG
keys in it went to zero** — and its gate now fails on any wrong key at all
rather than exempting photographs. `bench` and all four corpus blocks were
identical to the digit. The next round's fix to `column()` then took the reading
back up: it is **172 of 224 printed right, still zero wrong**, today. See
"Reading the key signature".

**Those figures are optimistic by construction**, because the notehead
classifier's weights are fitted to the pages it is scored on. The honest kind of
number is a cross-page one — train on some pages, score on a held-out one — and
that is what `npm run scan:train` prints.

**BUT THE SHIPPED WEIGHTS NO LONGER HAVE ONE, AND NO COMMAND IN THIS REPO CAN
PRODUCE IT.** This paragraph used to tell you to quote 98.1% / 99.4% on the Bach
and 93.3% / 89.5% on the Mozart. Those are real historical measurements of the
installed fit and they are **not reproducible**: `pages/patches.json` is now the
three-page, 1267-row dump, so `scan:train` holds out one page of three and
prints three blocks, none of which describes the model in
`src/analysis/head-model.js` — not even the "trained on Mozart, Scanned — tested
on Bach" block, which is a two-page fit but not *that* two-page fit, because the
dump those weights came from was overwritten.

**The decision, and why.** The alternative was to install the three-page refit
so that the table and the model agree again. That is measured and it is
forbidden by this document's own standard: it costs `bench` about two points of
recall (92.1 / 94.0 to 90.0 / 92.1 as measured on the day, against an allowance
of 0.3 on any page), through `STEM_CUT` rather than through the classifier. The
whole experiment is in "What is measured and does NOT work". So the older fit
stays, and instead the fact is stated **at the point of use** — in the long note
at the top of `head-model.js`, beside the weights themselves, rather than eight
hundred lines away here.

**What to quote today**, from `npm run scan:train`, at `HEAD_CUT` = 0.4 — this
is the REFIT, the model that is not installed, and it is the only live
cross-page table there is:

```
  held out   trained on            precision   recall
  Bach       Mozart, Scanned          99.1%     99.4%
  Mozart     Bach, Scanned            89.6%     98.0%
  Scanned    Bach, Mozart             96.2%     90.9%
```

The 87.4% that used to stand here was the reader's precision WITHOUT the
classifier and had no business being the headline.

**The classifier was retrained against the current candidate distribution, the
retrain is a better classifier and a worse reader, and it is measured and NOT
installed.** `pages/patches.json` and `pages/head-model.json` are now the
three-page artifacts and `src/analysis/head-model.js` deliberately is not; the
long note at the top of that file says why, and the short version is that
`STEM_CUT` is a number on the classifier's own score scale that no held-out
measurement covers. The full entry is in "What is measured and does NOT work",
and it is the reason the retraining instructions below now carry a warning.

**THE KEY BAND COULD DELETE A REAL NOTEHEAD, AND THAT IS FIXED.** `column()` in
`findKeyBand` measured ink only inside the band the scan searches, so a note
hanging out of that window was CLIPPED, measured 3.17 spaces against a ceiling
of 3.2, and was taken for an accidental — and `dropFurniture` deletes every head
the band covers. Columns now follow their own ink out of the band. `bench` and
all four corpus blocks are identical to the digit, `scan:key-read` goes 159 of
224 printed right to **172** with no wrong key, and the property has its own
gated check, `npm run scan:key-safety`. See "Reading the key signature".

**THE READER COULD RETURN A BLANK PAGE, AND THAT IS FIXED.** It was two faults
in one line of `trackCombs` and they needed separate answers. Both are now
pinned by unit tests that fail on the old code, and by a fourth corpus block.

```
                    FEW mean   SIZES photo6 recall   clef end-to-end   bench
before                  81%             94%             4 4 4 / 4 4 4   92.1 / 94.9
after                   91%             96%             4 4 4 / 4 4 4   92.1 / 94.9
```

`npm run scan:corpus`'s CORE and HARD means are unchanged at 99% and 93% and
every row of both is identical to the digit; **at the time**, `scan:clef` 15/15,
`scan:clef-hard` 9/10, `scan:bars` 64/72, `scan:key-read` 163 of 224,
`scan:spread` 8/8, and 543 unit tests — three of them new then, and all three
fail on the old code. Live today, re-run for this document: the first four are
unchanged at 15/15, 9/10, 64/72 and 8/8; `scan:key-read` reads 172 of 224 and
there are **614** tests. HARD's mean has since moved 93% to **94%** and it was
`dropDoubledHeads` that moved it, not this.

- **`best` was taken over EVERY joined curve**, including the scraps the very
  next line rejects for being too short — so a two-strip fragment scoring 0.95
  set the bar for a page whose six real staves scored 0.52, all six were deleted,
  `fillMissedStaves` bailed at its own three-stave floor and `readPage` returned
  null. A typo-class fix: `best` is now taken over the curves that pass the
  length test. **It is not hypothetical** — `scan:sizes` photo6 took its best
  from a ONE-strip scrap at 0.686 where its longest curves read 0.400 to 0.457,
  and one of its six real staves was being deleted here and quietly put back by
  `fillMissedStaves`. That row reads 94% recall before and **96% after**, and it
  is the only number in CORE, HARD or SIZES that moved at all.
- **The bar had no absolute lower bound and its stated fallback was false.**
  `combPeaks`' 0.3 is a floor on each POINT, so every curve's median has already
  cleared it — a conjunctive floor here is a no-op, which is why the answer had
  to be a DISJUNCTION. A curve is now a stave if it clears three fifths of the
  best **or** clears `STAVE_FLOOR = 0.45` outright.

**0.45 came from a dumped score distribution and a two-sided sweep, not from a
metric.** Every joined curve's median was printed for the pages that matter:

```
                                                      length   median
  clef-check end-to-end, top-edge blur artefact          20      0.400
  FEW's faint system — few2faint, few3faint              27      0.471
  FEW's faint system — few6faint                         23      0.471
  FEW's crisp systems                                    31-36   0.926-0.971
  scan:sizes photo6, a REAL stave                        21      0.400
```

Those are dumped on the shipped FEW recipes themselves, not on a probe drawn
like them: `best` is 0.941 on the two- and three-system pages and 0.971 on
`few6faint`, so the relative bar stands at 0.565 and 0.583 and the faint system
misses it by a tenth in each case.

The artefact reaches exactly 20 strips, which is `reach`, so it PASSES the
length test and only this bar stops it. Swept: **every floor from 0.41 to 0.47
keeps the artefact out and rescues the faint system**; 0.40 lets the artefact
back — five staves, `treble` read on a page of basses — and 0.48 loses the faint
system again. 0.45 is the middle of a window whose edges are both measured.

**BOTH CHANGES ARE STRICTLY LOOSENING, which is why `bench` did not move and
why that is a consequence rather than a coincidence.** `best` over the long
curves is never larger than `best` over all of them, and the floor is a
disjunct — so no page can LOSE a stave to this change, and the only movement
possible anywhere is second-order: `fillMissedStaves`' gap median, or the greedy
match. `few6faint` is that second order made visible, **at the time** 85/72
found before and 84/72 after at 100% recall either way, because its faint system
now comes from the tracker instead of from a smoothed prediction. (It reads
85/72 again today; a later round put the head back. The live table is below.)

**The last row of that table is the uncomfortable one and it is left standing
deliberately**: a REAL stave on `photo6` medians 0.400, exactly what the
artefact reads, so the two populations are not separable in absolute terms at
the bottom of the range. It does not bite today because the first fix takes that
page's `best` down to 0.457, which puts the real stave over the RELATIVE bar and
means the floor never has to reach for it. Anyone tempted to raise 0.45 should
read that row first.

**A page-relative version was considered and is worse**, recorded so it is not
proposed as the obvious improvement: measuring against the MEDIAN of the long
curves rather than the best separates both fixtures too — the clef page's four
staves out-vote its one artefact — but on a page with two long curves the median
IS the lower of them and the test becomes vacuous, and a two-system page is the
page the whole rule is for.

**The sibling change in the same function, `reach = min(strips * cross, longest
* 0.6)`, is the same class of fault and is bounded harmless.** `longest` is also
taken over every curve, junk included, but the `min` is what saves it: junk can
only make `longest` bigger, which can only push `reach` back UP towards the old
constant, and the `min` stops it there. The worst a forty-strip edge artefact
can do is CANCEL the close-up rescue and leave the page read exactly as it was
before that rule existed. It cannot throw away a stave the old code kept. Left
alone, with the bound written into the comment.

### FEW — the corpus block that had to exist first

`npm run scan:few`, and it is part of `npm run scan:corpus`. Every other page in
the corpus has SIX systems all printed alike, which hides both faults at once:
`fillMissedStaves` returns early below three staves, so on a six-system page a
stave the tracker drops is put back and nothing downstream ever knows.

```
page             working  staves  precision  recall  beams  overall   found/drawn
few2                  14     2/2       86%    100%   100%    100%       28/24
few2faint             14     2/2       86%    100%   100%    100%       28/24
few2photo           14.2     2/2      100%    100%   100%    100%       24/24
few2faintPhoto      14.2     1/2      100%     58%    86%     50%       14/24
few3                  14     3/3       86%    100%   100%    100%       42/36
few3faint             14     3/3       86%    100%   100%    100%       42/36
few3photo           14.3     3/3      100%    100%   100%    100%       36/36
few3faintPhoto      14.3     2/3      100%     75%    89%     67%       27/36
few6faint             14     6/6       85%    100%   100%    100%       85/72
mean                                            91%
```

**That is the live run, re-run for this document, and its PRECISION column has
drifted a point since it was last pasted here** — `few2` and `few2faint` read
89% at 27/24 and `few3` 88% at 41/36 before `dropDoubledHeads` and the phantom
stave; the recall, beam and stave columns are unmoved and the mean is 91%
either way. Nothing about the block's meaning changes: it is a block about
whether a system SURVIVES, and no row has lost one.

**At the time of the fix**, `few2faint` read **1/2 staves at 50% recall**
before it and `few3faint` **2/3 at 67%**; `few6faint` read 6/6 at 100%
throughout. Both faint rows are 100% in the table above. **That last row is the
control and it is the point of the block**: the same faint system on a page with
enough systems for `fillMissedStaves` to have a rhythm to predict from is never
lost, so the difference between it and `few3faint` is the rescue and nothing
else.

**The faint system is CALIBRATED, not chosen by eye**, and the calibration is
the reason the block measures the rule it claims to. `drawPage` now takes a
per-system `lineDuty`: the staff-line segments are laid down every four pixels,
five wide is the solid line every page here has always drawn, and **two wide is
a line inked half the time** — which is what a faint system thresholds into.
Duty 2 puts the curve at 0.471 against 0.94 for the crisp ones: above
`combPeaks`' 0.3 floor at every point, below three fifths of the best. Fainter
(duty 1.5 and below) and the curve SHATTERS into fragments that die on LENGTH
instead, which measures a different rule; darker (duty 2.5) and it clears the
bar and the case tests nothing. **Grey ink was tried first and is the wrong
lever**: on a clean page the local threshold divides it out entirely and nothing
moves at any grey from #666 to #c8c8c8, and on a photograph it fragments the
curve rather than lowering its score.

**The heads are drawn at full ink on every system**, deliberately. A faint
NOTEHEAD would confound the recall column with a head-detection loss; the comb
only ever looks at staff lines, so faint lines isolate the rule and the recall
column reads as a step — the system is kept and all twelve of its notes are
found, or it is dropped and all twelve are missed.

**The two `faintPhoto` rows are honest failures and are NOT fixed by this
work.** They read 1/2 and 2/3 before and after, and the reason is a different
rule: on a photograph the faint system's curve fragments into pieces of 10, 11
and 16 strips of forty and dies on LENGTH, not on score. The pieces sit 31 and
44 pixels apart in y where the rejoin's bound is a pitch and a half — about 21 —
so they are not joined either. That is the next thing to look at on this page
and nothing here touches it.

## The stave model waves, and the pitch was lost in the fit

**THE READER FOUND BACH'S NOTEHEADS AT 99.7% RECALL AND NAMED THEM WRONG, AND
THE USER'S OBJECTION WAS THE RIGHT ONE:** position plus clef is arithmetic, so a
wrong pitch means something upstream is wrong. It was the stave model, and the
step is measured FROM THE LINES, so a model half a space out names every note of
that passage a second wrong while the ring still sits dead centre on the head.

**A RESIDUAL TEST CANNOT SEE THIS AND ONE WAS TRIED.** If the whole model is a
step out the heads still land neatly on ITS lines and the residual stays near
zero. Measured: no head on the Bach page is more than half a step from the
model, and the pitches were still wrong.

### How it hid for years of rounds, which is the part worth carrying forward

Three instruments were pointed straight at that page and not one of them could
see a whole-step offset:

- **`bench` scores POSITION and nothing else.** Precision and recall ask whether
  a ring sits on a notehead. On the reader that named 18 of the Bach's first 32
  notes wrong, `bench` read **98.8% precision and 99.7% recall on that page** —
  and the repair that brought the pitches back COST 0.7 of that precision, so
  the number moved the wrong way when the reader got better. No part of it was
  ever evidence about pitch, and it was quoted as reassurance for rounds.
- **`scan:studies`, the north star for PITCH, engraves its own staff lines.**
  692 notes, 96.2% named right, `wrong by semitones {}` empty — on lines this
  repo drew straight itself. The failure is a photograph of a BOUND BOOK, where
  the printed line waves by about a staff space across a system. Nothing in that
  corpus can wave, so nothing in it can fail this way.
- **A residual against the reader's own model is circular, and it was tried.**
  If the whole model sits a step low, the heads still land neatly on ITS lines
  and the residual stays near zero. Measured on the Bach: **no head is more than
  half a step from the model, and the pitches are still wrong.** A residual can
  only find a head that disagrees with the model; it cannot find a model that
  disagrees with the page.

**What found it was a person reading the music.** The opening of BWV 1007 is
G D B A B D B D, and the reader said otherwise. That is not a repeatable
instrument, which is why the first job of the round was to build one — and why
rule 3 of `CLAUDE.md`'s non-negotiables is now that a ring in the right place is
not a right note.

### The instrument that had to exist first — `npm run scan:steps`

`tools/step-truth.mjs`. For each hand-marked notehead it finds the PRINTED staff
lines in two ink columns either side of the mark — never through the head —
fits a five-line comb to them, and says which line or space the mark is on. No
comb tracked across the page, no curve fit, no model. A truth file holds
positions rather than pitches, but a position plus the printed lines under it IS
a step, so a marked page becomes step truth without anybody naming a note.

```
npm run scan:steps -- <file.pdf> --truth <truth.json> [--known <steps.json>]
STEP_DRAW=3,7,11 …    one magnified crop per mark, its lines in green and the
                      reader's model in red
```

**IT CHECKS ITSELF BEFORE IT IS ALLOWED TO SCORE THE READER.**
`pages/truth/bach.pitch.json` holds the 32 steps of bars 1–2 of BWV 1007, which
are not in dispute; the harness answers 25 of those 32 marks and gets 25 right.
It reads 78% of the Bach page, 73% of the Concerto and 74% of the Scanned score,
and refuses the rest BY NAME. An earlier version of this file took a ±7-space
window and reported the reader at 59.8% — every part of that figure was its own,
because the window reached the neighbouring stave. Do not trust a number from a
step harness that has not printed its own self-score.

### What was wrong, drawn on the page

`trackCombs` finds the printed stave on the Bach photograph almost perfectly.
`stavesToLines` then fitted a QUADRATIC through its forty per-strip answers, and
on a photograph of a bound book **the printed line is not a bend, it is a WAVE**
— down at the left, up by strip 12, down again by strip 30, up at the right end,
about 13px of swing on a 12px staff space. A quadratic has one turning point and
that shape has three, so the fit least-squares straight through it.

Drawn at 8x with `node tools/stave-look.mjs <pdf> --at x,y` (red = the model,
blue = a hand mark), Bach system 1: at x=420 every red line ran through the
WHITE of a space with the printed line below it; at x=910 the red lines ran
below the print. After the change the red lines lie on the print in both crops —
you have to look for the grey because the red covers it.

### The fix, and the number that says it worked

`stavesToLines` now smooths the stave's POSITION with a running median of five
followed by a running mean of three, and fits nothing. What separates the signal
from the failure is SCALE: a strip that landed on a beam is ONE strip, and the
wave is ten strips wide, so a median throws the first away by construction and
passes the second. **The SPACING keeps the quadratic** — the stave slides
(−5.4 to +6.2px on Bach staff 0) and does not stretch (4×the spacing error stays
inside ±0.65px) — and **a stave `fillMissedStaves` PREDICTED keeps it too**,
because that is a search and not a track and its answer swings 9.5 and 10.1
steps end to end.

```
the STEP, per hand-marked notehead, against the lines printed around it
                      Bach            Concerto        Scanned score
the quadratic         193/248  77.8%  204/230  88.7%  262/301  87.0%
median 5, mean 3      229/248  92.3%  210/230  91.3%  279/301  92.7%
```

The denominators are identical, so those are the same marks before and after,
and the harness's own self-score is 25 of 32 on the same 25 marks in both. The
BWV 1007 opening read `0 4 9 8 9 3 8 3 -1 4 8 8 9 4 9 4 …` and now reads
`0 4 9 8 9 4 9 4 0 4 9 8 9 4 9 4 …`, 14 of 32 to 30 of 32, both statements of
bar 1 exactly right.

**And the model's own distance from the print, per system, is the thing that
says this is geometry and not luck.** On the eight systems `trackCombs` tracks,
the end-to-end swing was 0.20 to 1.67 steps and is now 0.10 to 0.18.

### What it cost, and what it did NOT move — ALL OF IT AT THE TIME

Every figure in this subsection was taken in the stave-model round itself, before
the mid-system treble landed on top of it. The live numbers are at the top of
this document; these are the delta.

`scan:key-read` byte-identical (300/352, **0 wrong keys**). `scan:key-safety`
passes all five of its gated zeroes. `scan:studies` unchanged on every summary
line it prints, in bass and again under `FORCE_CLEF=treble` and
`FORCE_CLEF=tenor` (diffed on the lines the tool prints, not note by note). `scan:corpus` identical in all four means,
`scan:clef-change` byte-identical, `npm test` 607. `bench` recall flat on every
page. The costs: `bench` mean precision 95.0 → 94.9; `scan:bars` loses one
barline of 42 on its `faint` fixture. The mid-system clef block of `scan:clef`
improved on both of its totals (158 false fires → 155, 141 notes named wrong →
118).

### WHAT IS LEFT — one thing on this page, and a different thing on the other two

**On the Bach it is one thing. Systems 8 and 9 are `fillMissedStaves`
inventions, they still carry the quadratic, and they hold ALL 45 of the page's
remaining half-step-or-worse marks.** The reweighted whole-page estimate went
72.4% to 87.3% and essentially the entire remainder is those two systems: the
reader is wrong on 64.3% of the marks it answers where the model is half a step
or worse from the print, against 4.3% everywhere else. The job is to make a
PREDICTED stave trackable, not to touch the smoother.

**On the Concerto and the Scanned score it is NOT the model at all, and that is
new since the fix.** `scan:steps` prints its own blame line, and it blames the
model for **0 of the Concerto's 20 wrong steps and 0 of the Scanned score's 22**.
Two more of its own lines say the same thing from different directions: every
mark on both pages falls in its `0.0 to 0.3` model-off band, with nothing in the
bands above; the fourteen wrong marks it lists in full run −0.22 to +0.18 steps
of model error on the Concerto and −0.22 to +0.25 on the Scanned score (it prints
fourteen of each, not all forty-two); and the per-system table has both pages
tracked to a swing of 0.13 to 0.40 steps end to end. Something else
names those notes a second wrong. It is undiagnosed, it is now the larger half of
the reader's remaining pitch error on real paper, and it has its own entry (0d)
in "The next step". **Do not carry the stave-model explanation over to it**: the
evidence that it is a different bug is already printed by the tool.


## How it works

1. **Staves** by comb filter in vertical strips, tracked across the page as
   curves. A photographed page is not flat and nothing downstream flattens it.
   Three things then decide which curves are staves, and each asks the page
   rather than carrying a number — see the comments in `trackCombs`. **Fragments
   that continue one another are joined** before anything is measured, because
   the comb slips a line here and there on a small photograph and every slip used
   to start a new curve. **How far a curve has to get** is the lower of half the
   strips and three fifths of the page's own longest curve, so a page where
   nothing crosses half is still read. **How much like a stave it has to look**
   is three fifths of the best curve on the page **or** `STAVE_FLOOR = 0.45`
   outright, whichever it clears — a disjunction, because a page of two systems
   has no spare curves to set a relative bar with. That is what stops the joining
   assembling the blur artefact along the top edge of the image into a stave
   while still keeping a legitimately faint one.
   **The five lines the rest of the reader uses are built in `stavesToLines`,
   and how they are built is where the pitch lives.** The stave's POSITION per
   strip is smoothed with a running median of five and then a running mean of
   three, and fitted with nothing — a printed line on a photographed bound book
   waves three times across a system and a curve fit cannot follow it. The
   SPACING keeps its quadratic (the stave slides, it does not stretch), and so
   does a stave that `fillMissedStaves` predicted, which has no per-strip
   evidence to smooth. A pitch is measured FROM these lines, so anything moved
   here moves every note: re-run `npm run scan:steps` on all three pages.
2. **A system the tracker dropped is PREDICTED back** (`fillMissedStaves`), from
   the rhythm of the ones it kept, but only above three staves and only if the
   place it predicts scores like a stave on this page — **a fifth of the low
   quartile, across staves, of the low quartile across strips of what the page's
   own tracked staves score**, `Math.max`ed with the old flat 0.05 so the bar can
   only ever rise. The flat floor is what let the title block of a photographed
   page become system 1 on both Mozart pages for three rounds.
3. **Clef** read from a band just past each stave's left end (`scan-clef.js`).
4. **Key signature — where it is, and which key it is.** The EXTENT is found by
   walking off the end of the clef until something is not an accidental
   (`scan-key.js`). The page then agrees with itself about HOW MANY accidentals
   there are — a low quartile of the per-system counts, because over-reading is
   the common failure and under-reading is the cheap one — and each system's
   band is trimmed to its own first n runs. That trim can only ever make a band
   narrower.
   **AND THE PAGE NOW AGREES ONE MORE THING, WHICH DOES WIDEN — read this
   before reasoning from the old invariant.** Until `agreeKeyReach` every bound in
   `findKeyBand` was measured off the ink of the system it was scanning and
   nothing another system found could widen it. That sentence used to be in
   this paragraph and it is false now: the systems that read a signature also
   agree HOW FAR PAST THE STAVE'S LEFT END it reaches, and a system whose own
   band stopped inside the printed sharp borrows it. The reason the old
   invariant had to go, and the weaker argument that replaces it, are under
   "The band could stop inside the sharp" below and above `agreeKeyReach` in
   `scan-key.js`.
5. **Which key it is** — see the section below. `readPage` reports it on every
   stave and once for the page, and `notesInOrder` carries it beside the clef.
6. **Barlines** — a column of ink spanning the stave with nothing wide hanging
   off it and no overhang past the lines.
7. **Noteheads** in two passes: shape tests propose candidates, then a
   classifier judges them (`head-model.js`). Stems propose extra candidates for
   notes the shape tests never offer.
8. **One piece of ink claimed by two staves is given to one of them.**
   `findHeads` runs per stave and reaches `space * 7` either side, which is more
   than half the gap to the next system, so two neighbouring staves used to
   return the same notehead twice with two `step` values 26 apart.
   `dropDoubledHeads` runs after the stave loop and **before** `dropFurniture`,
   so the heads stay index-aligned with the values `readValues` is about to give
   them. See *One piece of ink reported by two staves*.
9. **Furniture is deleted** — `dropFurniture` drops heads standing inside the
   clef band and inside the key band, and this is the only place in the reader
   where one system's evidence can widen another's suppression
   (`agreeKeyReach`).
10. **The accidental in front of the note** (`scan-accidental.js`), read AFTER
   `dropFurniture` so the key signature's own glyphs are already gone. Four
   geometric attempts failed and `acc-model.js` is a small classifier, the same
   division of labour as noteheads. Measured on the studies: 30 printed, 30
   found, 30 named right, 0 invented on 662.
11. **A clef printed part way along the system.** `findClefChanges` slides the
    reader's own clef window and asks `midClefAt` of each position; it reads
    C-clefs by the waist and TREBLE clefs by their tail, and refuses everything
    it cannot place on a
    line. It is read by `clefHere` and by `notesInOrder`, and by **nothing that
    decides what gets circled** — which is why the round that added it moved no
    other measurement by a digit.
12. **Note values** — `readValues` counts beams. That is the whole of it: rests,
    dots, ties and tuplets are not read.
13. **The pitch.** `notesInOrder` gives every head the clef in force AT ITS OWN X
    (`clefHere`, not the head of the system), the PAGE's agreed key with the
    stave's as fallback, and `pitchOf` turns step + clef + key into a MIDI
    number and a degree. Then `applyAccidentals` runs **one bar at a time**, so
    a printed accidental binds its own note and every later note on the same
    line until the barline, and REPLACES what the signature said rather than
    adding to it. **Null propagates and is never defaulted**: no clef or no key
    means no pitch. The one exception is a reading and not a default — a page
    whose every system found the place a signature is printed to be empty comes
    back with `kind: 'none'` and `keySource: 'bare'`, which is C major read off
    the paper. *A null key is unknown; a key of kind `none` is C major. The two
    must not be conflated in either direction.*

**One stale comment in the source, named here because this document cannot fix
it.** The long comment block inside `notesInOrder` still says "WHAT THIS STILL
DOES NOT KNOW is an accidental standing in front of the note in its own bar.
Those are not read at all… a note whose bar carries one comes back a semitone
out." That was true when it was written and is false now — `head.accidental` is
set at `scan-read.js:2655` and `applyAccidentals` runs at the foot of the same
function. `scan-pitch.js`'s opening comment ("no clef, no key signature, no
accidental… none of them is read") is stale in the same way, and its own text
already admits to being two thirds wrong.

## How big is the page

The user's ask is that this work at different sizes, and until `npm run
scan:sizes` was written nothing measured it. Every page in CORE and HARD is drawn
at a staff space of 7 to 20 and the three marked pages sit between 9.6 and 12.1,
so a constant measured in PIXELS could be wrong by a factor of four outside that
band and every number in this document would still look fine.

`npm run scan:sizes` draws one page shape at nine sizes, clean and photographed,
and reports precision and recall for each. **Read the WORKING column**: `readPage`
clamps to `WORK_WIDTH`, and the photographed rows are drawn large and shrunk by
the camera, which is how a phone photograph arrives.

Re-run for this document, and the `found/drawn` column is kept this time because
it is what makes the precision column readable:

```
page      drawn  working  staves  precision  recall  beams  overall   found/drawn
clean6        6        6     6/6       93%     96%   100%     96%       74/72
clean8        8        8     6/6       90%    100%   100%    100%       80/72
clean10      10       10     6/6       90%    100%   100%    100%       80/72
clean12      12       12     6/6       88%    100%   100%    100%       82/72
clean14      14       14     6/6       86%    100%   100%    100%       84/72
clean16      16       16     6/6       82%    100%   100%    100%       88/72
clean20      20       20     6/6       73%    100%   100%    100%       99/72
clean24      24       24     6/6       80%    100%   100%    100%       90/72
clean28      28       28     6/6       77%    100%   100%    100%       94/72
photo6       10      6.2     6/6      100%     96%    10%     10%       69/72
photo8       13        8     6/6       99%     93%    49%     46%       68/72
photo10      16      9.9     7/6       86%     97%    83%     81%       81/72
photo12      19     11.8     6/6      100%     99%    92%     90%       71/72
photo14      23     14.3     6/6      100%    100%   100%    100%       72/72
photo16      26     16.1     6/6      100%     97%   100%     97%       70/72
photo20      32     19.8     6/6      100%    100%   100%    100%       72/72
mean                                                     89%
```

**The precision column has drifted since it was last pasted here and no other
column has**: `clean6` read 95%, `clean14` 89%, `clean16` 87%, `clean20` 74%,
`clean24` 82%, `clean28` 78% and `photo10` 88%/80%/78% before the rounds that
added `dropDoubledHeads` and the page-relative stave floor. Every staff, recall
and beam figure is unmoved except `photo10`'s beams, which went 80% to **83%**,
and the mean is 89% either way. The trend the block exists to show is the same
one, a point or two lower.

**What it says.** Finding the notes survives the whole range: recall is 93% or
better everywhere, on a clean page and on a photograph — the two lowest rows are
`photo8` at 93% and `photo6` at 96%. What does NOT survive is
**counting the beams on a photograph below about a twelve-pixel staff space** —
100% at 14, 92% at 12, 49% at 8, 10% at 6. A beam is half a space thick with a
quarter space of paper under it, so at a working space of 8 a pair of beams is
four pixels of ink and two of paper before the camera blurs it, and `readValues`
cannot separate them. **Every note is found and told the wrong length**, which is
the failure a practice app feels as the take drifting out of step. Precision
drifts down on CLEAN pages as they get bigger — 93% at 6 to 73% at 20, which is
27 extra circles on a page of 72 notes — and that is the head finder proposing
more candidates when it has more pixels to propose them in; recall does not move,
so this is false circles rather than lost notes.

**Two honest limits of the block itself.**

- **It cannot reach the size where the reader really breaks.** `drawPage` sizes
  its canvas at `space * max(50, 12 + widest span)` and `readPage` clamps to
  1400, so the working staff space can never exceed 1400/50 = 28 whatever the
  block asks for. Measured on real pages by an earlier probe, the cliff is above
  that: the Menuet blown up to a working space of about 35 finds NO STAVE AT ALL.
  Raising the ceiling means narrowing the drawn page, and nothing here does.
- **The match radius had to be changed to make the sweep mean anything.** CORE
  and HARD match a detection to a drawn note within `max(6, width/160)` pixels,
  which is a whole staff space of slack at space 6 and a third of one at 28 — a
  ruler that tightens as the page grows would show a cliff that is the ruler
  moving. The size block passes its own radius, 0.6 of a staff space, measured
  the way `tools/truth-check.mjs` measures its own.

`photo10` comes back with a seventh stave on a six-system page, which is the one
false positive the size sweep still shows and it costs that row **14 points of
precision** — 86% where every other photographed row reads 99 or 100. (That cost
read 12 points when it was last written down; the row is 86% now and the two
neighbours it is compared against are 99% and 100%.)
**It is the same failure class the curve-score test was written for
and it survives at three fifths**, so that rule is incomplete rather than
finished — worth knowing before anyone concludes the tracker no longer invents.
**And no absolute floor will reach it either**: dumped, photo10's phantom is a
19-strip curve at y = 120 medianing **0.633**, sitting beside the real system at
y = 143 medianing 0.783 — comfortably over both the relative bar and
`STAVE_FLOOR`. It is a comb locking onto a near neighbour of a real stave, which
is a different bug from a comb locking onto the furniture, and it wants
`combPeaks`' `apart` rule rather than either of these two.

**Three things about the stave finder that this round did not settle**, recorded
so they are not mistaken for settled:

- ~~**The curve-score bar is RELATIVE and every corpus page is spoiled
  uniformly.**~~ — **SETTLED, and it was a bug.** The case did not exist in
  CORE, HARD or SIZES and now exists in FEW, where it showed the bar deleting a
  legitimately faint system with no absolute lower bound under it. The
  mitigating argument recorded here — that `fillMissedStaves` accepts a
  predicted position at 0.05 — **is false below three staves**, which is where
  it returns early and where a close-up photograph lives. See "The reader could
  return a blank page".
- **`curve.last < s - 3`** — how many strips a curve may go missing before it is
  given up on — was on the ranked list of fitted constants (3 strips is 10.5
  staff spaces at the marked pages' scale and 3.0 at a working space of 35) and
  is now largely superseded: the rejoin puts the pieces back together afterwards,
  so the constant decides how the work is divided rather than what survives it.
  Sweeping it is probably wasted effort.
- **`readPage` can still return `null`, and after this round it should be far
  harder to make it.** The two routes are a page whose staff space measures
  outside 2 to 40, and `trackCombs` coming back empty. The second is what the
  blank-page bug rode in on and both of its causes are now fixed and tested;
  nothing measures whether a third route exists.
- **A page of PROSE now returns a page with no staves rather than `null`.**
  Checked directly on a blank sheet, a page of prose and a title block, each
  clean and photographed: no configuration produces a stave, and no configuration
  produces a notehead, which is the property that matters. But the joined curves
  on a page of prose now get as far as `realStaff` — which drops them, having
  been written for exactly this — where before they died earlier and `readPage`
  returned `null`. Both answers mean "no music" and `notesInOrder` handles both;
  a caller distinguishing "unreadable" from "read, nothing on it" would see the
  difference.

## One piece of ink reported by two staves

**Every note the engraved cello studies got wrong was this, and it was not a
pitch bug at all.** `npm run scan:studies` reported a group of notes wrong by
**-44, -45 and +45 semitones** — three and a half octaves — and the handover said
nobody had looked at one. They are a single notehead returned TWICE, once by the
stave it belongs to and once by its neighbour, with two `step` values 26 apart.
Twenty-six diatonic steps is one system.

**THE MECHANISM, from the source and then from the page.** `findHeads` runs once
per stave and searches `reach = space * 7` above the top line and below the
bottom — four ledger lines, which this repertoire needs and which the note above
`reach` argues for at length. The distance from one system to the next is 13 to
15 spaces on every page here and a stave is 4 of them, so **two neighbouring
staves' search bands overlap**, by 4.4 to 5.8 spaces on the three marked pages,
and nothing anywhere deduplicated the result. Twenty-five heads on 12 of the 32
studies came back at PIXEL identity from two staves at once, e.g.
`A-major-scale (175,258) staff 0 step -13 midi 21 === (175,258) staff 1 step 13
midi 66`. It is not a study artefact: the Concerto does it 4 times and the
Scanned score 5, and the nine hand-marks that had to come off those two truth
files stand on exactly those nine heads.

**SHRINKING `reach` IS NOT THE FIX AND WAS TRIED FIRST.** Patching only the
constant in the served module: reach 7 gives 557 right pitch, 6 gives 572, 5
gives 577 and the group is gone — but `FORCE_CLEF=treble` at reach 5 costs recall
98.0% to 92.1%, because bass-clef music read in treble sits BELOW its stave and
the same notes fall off the other end. The reach is right. What was missing is
that a stave has no claim on ink that plainly belongs to its neighbour.

**THE RULE** is `dropDoubledHeads` in `scan-read.js`, run after the stave loop
and before `dropFurniture`, so the heads stay index-aligned with the values
`readValues` is about to give them. Where two staves report a head within 0.8 of
a space in x and in y, the stave whose own five lines are NEARER keeps it —
distance measured outside the stave only, under that head's own strip. It is a
re-ASSIGNMENT and not a narrowing: no head is ever lost and `found` can only fall
by the doubles.

**AND IT REFUSES TO ARBITRATE BETWEEN TWO STAVES THAT OVERLAP**, which is the
half that took the measuring. The rule's premise is that the two staves are
distinct objects in different places, so "nearer" names an owner. Where the
tracker has reported ONE system as two the premise is gone, and it does:
`photo10` in `npm run scan:sizes` finds SEVEN staves where six were drawn, and
the extra is not a phantom on bare paper between systems — staves 0 and 1 span
y 65–189 and 95–225 at a space of 9.7, **overlapping by 9.7 spaces, more than
either stave is tall**, while the real system gap on that page is 157 to 161
pixels and these two stand 30 apart. Arbitrating between them moved three notes'
beam counts (`rightBeams` 58 to 55) purely by changing which of two wrong
descriptions won, and dragged the SIZES mean from 89 to 88. With the overlap
guard every corpus row that moves, moves the right way.

**WHAT IT BOUGHT, measured AT THE TIME against clean pre-edit baselines captured
this round (they reproduced the handover exactly: 300/352 with 0 wrong; 636/692;
93.3/96.4; 99/93/89/90). The `660` below is history within its own round** — the
harness fix landed after it and the live figure is **666**, in *The studies now
get every note they can name right* just below. Every other row is still live:**

```
                                    before            after
  scan:studies, right pitch       636  91.9%       660  95.4%
    wrong by semitones            {1:6, 45:2,      {1:6}
                                   -44:10, -45:12}
    notes found                   692 of 692       692 of 692    100% either way
  bench, against REPAIRED truth   92.6 / 96.5      93.4 / 96.5   recall flat on all three
  scan:corpus  CORE               99               99
               HARD               93               94   tightSystems recall 79% -> 100%
               SIZES              89               89
               FEW                90               91   three faint rows, beams 96/97 -> 100
  scan:key-read                   300 of 352, 0 wrong — BYTE-IDENTICAL
  scan:key-safety                 exit 0, every must-be-zero line still zero
  scan:bars · clef · clef-hard    64/72 · 15/15 · 9/10   unchanged
  unit tests                      578              586
```

`tightSystems` is the corpus page drawn at `sysGap: 10.5` — tighter than the
studies — and it was failing at 79% recall with 100 spurious heads and a beam
confusion of `3->2 x9, 2->1 x8, 1->3 x6`. All of it was this bug, and the
handover had it recorded as a size problem. It now reads 100/100/100 with the
confusion empty.

**DOES THIS FORCE A RETRAIN?** No — but not for the reason it is tempting to
give, and the first draft of this paragraph got it wrong by reasoning about the
code instead of reading it. `tools/patch-dump.mjs:89` calls
`readPage(work, w, h, { judge: false })` and then `notesInOrder`, so it sees the
reader's FINAL head list and `dropDoubledHeads` most certainly does change what
it dumps: the row count falls by the number of doubles on each page.

What makes that safe is what the removed rows ARE. At `patch-dump.mjs:105` the
patch is `headPatch(gray, bg, w, h, space, cx, cy)` where `space` is the PAGE
median (`:92`), not the stave's — so two staves reporting one head at the same
pixel produce **byte-identical patches with the same label**, and one of them is
a duplicate row that was being counted twice. `tools/patch-train.mjs` fits on
`r.pixels` and `r.label` only (`:46`, `:67`); `step` and `beats` are dumped and
never read. So the DISTRIBUTION `pages/patches.json` describes is unchanged and
the shipped weights still judge what they were fitted to — the change is that a
handful of rows stop being double-weighted.

That is a different argument from "the dump cannot see it", and it is the true
one. Anyone re-dumping should expect the row count to fall slightly and should
not read that as the corpus shrinking.

## `scan:studies` — the north star for pitch

**WHAT IT IS.** `npm run scan:studies` takes 32 real cello studies from
`~/Downloads/cello-studies`, engraves each one from its MusicXML with the real
Bravura an engraver uses, reads the resulting page with `readPage` and
`notesInOrder`, and scores **every note against what the file says it is** —
same note order, same bar, same pitch. 692 notes, fourteen different key
signatures, scales, arpeggios and thirds, one voice, bass clef unless
`FORCE_CLEF` says otherwise.

**WHY IT IS THE NORTH STAR FOR PITCH, and why nothing else in the project can
be.** Every other instrument here scores a CIRCLE: `bench` and `scan:corpus`
ask whether a notehead was found in the right place, and a reader that finds
every head and names them all a third out scores perfectly on both.
`scan:studies` is the only one that asks what the note IS, so it is the only one
that can see a wrong clef, a wrong key, a missed accidental or a head assigned
to the wrong stave — and every one of those four has been caught by it and by
nothing else. It is also the only corpus in the project with more than one key
in it: the three marked pages are all ONE SHARP and two of them are the same
music, so before this existed fourteen of the fifteen possible answers were
measured only on glyphs drawn by the same tool that scored them.

**AND ITS TRUTH IS AS GOOD AS TRUTH GETS HERE.** A drawn notehead is this
project's own idea of a notehead; a study engraved from MusicXML is somebody
else's music, rendered by a real font, and the pitch it is scored against was
never a guess. What it is NOT is a photograph — see `--phone` below, which is
where it stops being flattering.

Live, re-run for this document:

```
  notes engraved      692
  found               692  100.0% recall
  RIGHT PITCH         666  96.2%
  no pitch at all     26
  page key right      18 of 32   (WRONG on 0)
  page key not agreed 14 of 32
  stave key right     42 of 50   (WRONG on 0)
  ACCIDENTALS PRINTED   30 — found 30, named right 30, invented 0 of 662
  wrong by semitones  {}
```

**Read `wrong by semitones` and `WRONG on 0` first, the way `scan:key-read`'s
wrong-key line is read first.** `RIGHT PITCH` falling is a refusal and costs a
note; those two moving off empty and zero is the reader being confidently wrong,
which is the failure this project does not spend.

**`wrong by semitones` is empty. Not one of the 692 notes is named a wrong
pitch.** Every remaining loss is the 26 notes of `A-minor-arpeggio` and
`C-major-arpeggio` — one system each, no signature printed, and one system is
not a page. That floor is deliberate and is priced in the section above.

**"KEY SIGNATURE RIGHT 15 of 32" WAS NEVER A READING FAILURE AND THE COLUMN WAS
LYING.** It reported the PAGE key, which `agreeKey` refuses to name without more
than one witness, so all fourteen single-system arpeggios counted as failures
while their staves read the signature perfectly and twelve of them scored 100%
right pitch off it. `tools/study-check.mjs` now prints three numbers because
there are three answers — read right, read WRONG, and declined to agree — and a
per-stave column beside them. **On a clean page nothing on this corpus has ever
read a wrong key, at either level**, and there is no second bass-clef-dots
pattern to find there. **On a PHOTOGRAPH there is: `--phone` reads two stave keys
wrong** — see the table two sections down. The clean claim was being quoted
without the qualifier, which is how it became a claim about the reader rather
than about the easy half of the corpus.

**THE `+1` GROUP WAS THE HARNESS, AND THE HARNESS IS FIXED.** `study-check.mjs`
decided whether to print an accidental by comparing the note to the KEY
SIGNATURE alone. That is not the rule of accidentals: a printed accidental holds
for the rest of its bar, so a note that agrees with the key but follows an
inflection of the same degree in the same bar needs a cancelling natural, and
this drew nothing there. Every melodic minor scale has that shape — bar 3 of
`B-minor-scale` is `G4#(sharp) A4#(sharp) B4 A4`, and the closing A4 was engraved
bare on the same line as the A4# three notes earlier. The reader carried the
sharp to the end of the bar, which is what the rule, the engraver and the player
all say, and was scored wrong for being right on six notes. It now prints the
natural, keyed by the note's absolute DEGREE (an accidental binds the line it is
written on, not the letter) and seeded from the key at every barline. **The
reader read all six of the newly-printed naturals correctly**, which is six
glyphs of evidence it had never been shown.

### The accidental reader is not the bottleneck, and `--camera` was measuring nothing

`study-check.mjs` now scores accidentals separately from pitch, because `RIGHT
PITCH` is shared between the clef, the key and the accidental and a change to one
of them cannot be attributed from it.

```
                       clean    --camera   --phone
  accidentals printed    30        30         30
  their note FOUND       30        30          2      <- 6.7%
  accidental found       30        30          2
  …and named right       30        30          2
  invented on a note
     with none            0         0          0
  notes found        692/692   692/692    631/692
  RIGHT PITCH            666       666        378   (54.6%)
  no pitch at all         26        26        245
  page key right      18 of 32  18 of 32    5 of 32   WRONG on 0 in all three
  stave key right     42 of 50  42 of 50   29 of 50   WRONG on 0, 0 and TWO
  wrong by semitones      {}        {}     {1:2, 2:3, -1:3}
```

**AND THAT LAST PAIR OF ROWS IS A FINDING, NOT A FOOTNOTE — IT IS THE FIRST TIME
THIS CORPUS HAS EVER READ A WRONG KEY.** Re-run for this document, both spoilings
end to end. Clean and `--camera` are 0 wrong at both levels and `wrong by
semitones {}`; at `--phone` **two staves read a key that is not the printed one**
and eight notes are named a wrong pitch. The tool flags them in its `page key`
column with a `!` — `Bb-major-scale` and `Eb-major-scale`, `1/2!`, two flats and
three flats, 25 of 29 right where the other flat scales are 12 of 29 or 24 of 29.
The PAGE level still refuses on all 32 (`page key right 5 of 32, WRONG on 0`), so
`agreeKey`'s witness floor is doing its job and the damage lands where a page
cannot agree and `notesInOrder` falls back to `staff.key`. **This is the failure
this project calls unforgivable — silent, confident and a whole degree wide — and
it is the strongest argument in the file for making `--phone` a gated corpus
rather than a flag somebody remembers to pass.**

**`--camera` is identical to clean in every field, note for note, and always
was.** Its filter is blur 0.7px, contrast 0.88 and a light gradient — no
rescale, no JPEG — which is too gentle to move anything this file prints. Quoting
it as evidence that the reader survives a photograph is quoting nothing, and that
belief is why the column existed. **`--phone` is new**: the degradation
`key-read-check.mjs` spoils its signatures with, which does move numbers there —
0.72 downscale (a 14px staff space arrives as 10), blur 1px, contrast 0.62 and a
JPEG round trip at 0.6.

**AND AT THAT QUALITY THE READER LOSES PRECISELY THE NOTES WITH AN ACCIDENTAL IN
FRONT OF THEM, AS NOTEHEADS.** 61 of 692 heads are lost and 28 of the 61 are the
30 that carry an accidental: 4% of the notes taking 46% of the losses. The
accidental model reads 2 of 2 of the survivors right and invents none on 629, so
**a retrain of `acc-model.js` cannot address this** — there is no glyph left to
judge. Looked at, on `A-minor-scale` at `--phone`: the five missed heads are at
(345,126) (385,119) (668,77) (708,70) (787,70), all five carry an accidental, and
there is **no detection of any kind near any of them** — the nearest are the
notes either side. The sixth missed note is the final semibreve, which is a ring
and a different population.

**FOUR CAUSES RULED OUT, by patching one string in the served module and
re-reading the same page** (`open` is the paper-ring test, which was the answer
for chords and is not the answer here):

```
  open < 0.45  ->  off, and 0.25        23 of 29 found, 0 of 5 accidental heads
  HEAD_CUT 0.4 ->  0.15                 24 of 29 found, 0 of 5
  fill >= 0.3  ->  0.15                 23 of 29 found, 0 of 5
  across > space * 2.6 -> 3.4, and 4.5  23 of 29 found, 0 of 5
  dropDoubledHeads off                  23 of 29 found, 0 of 5   (not this round's change)
  the same page CLEAN                   29 of 29 found, 5 of 5
  THE CONTROL — same page at --phone,
    the accidental GLYPHS not drawn     28 of 29 found, 5 of 5
```

**The control is the row that makes this a finding rather than a correlation, and
it was nearly left out.** In a melodic minor scale the accidentals ARE the raised
sixth and seventh — the top of the ascending run — so "carries an accidental" and
"is the highest note on the page" are very nearly the same set, and three of the
five missed heads are at steps 13 and 14, well above a bass stave that tops at 8.
Height would have explained the whole thing and none of the four sweeps above
distinguishes the two. Engraving the identical notes at the identical size with
the accidental glyphs suppressed brings **all five heads back**, and the only note
still missing is the closing semibreve, which is a ring and a different
population. It is the accidental's ink.

So the head with an accidental touching it is refused somewhere earlier than any
of those four tests, and finding where is the next question worth asking about
accidentals — not the mixture retrain, which the numbers above say has nothing to
fix. The probe is
`scratchpad/PITCH/phone-noacc.mjs`: `study-check.mjs` with the accidental `put()`
behind a flag and `scan-read.js` fetched, string-patched and imported from a blob
so a constant can be moved without touching the file.

## A clef printed part way along a system

A cello part alternates bass and tenor constantly, and until this round every
note printed after a mid-system clef change was named in the clef the system
STARTED in. Measured on a page engraved with real Bravura — treble at the head
of every system, a C-clef halfway through the first bar, eight notes each side —
**24 of 48 notes came back a ninth wrong, the STEP right on every one of them,
with `clefConfidence` reading 1 and the key read correctly.** That is the shape
this project treats as the unforgivable failure: silent, confident and
page-wide. A clef change at a SYSTEM BREAK was already perfect (48 of 48), so
the hole was exactly the middle of a system.

`findClefChanges` (in `scan-read.js`) slides `clefColumn` — the reader's own
clef window, and the one piece of this machinery already proven on a photograph
— from past the key signature to the end of the stave, and asks `midClefAt` (in
`scan-clef.js`) of each position. On the same fixture it now reads **48 of 48,
`offBy {}`**.

### classifyClef cannot do this job, and the reason is worth keeping

**It is a CHOOSER, not a detector.** Treble needs ink below the bottom line,
tenor needs ink above the top one, and **bass is the residual**, guarded only by
"taller than a speck" — so it always answers. Slid along one drawn system with
**no clef change anywhere in it**, the clef window read `bass` at 201 x-positions
out of 651 and **`tenor` at 30**. Anything that walks a window along a stave and
asks `classifyClef` will find clefs in the music.

It was also right on the fixture by an accident too small to build on: a C-clef
at three-quarter size measured a top of **-0.61** against `ABOVE_STAVE`'s
**-0.60**. One hundredth of a staff space, and the coin is half a system.

### What separates a C-clef from everything else on a page

Four numbers, none of them a size, because a mid-system clef is engraved at
about three quarters of a full one and a rule fitted to a height would be a rule
fitted to one publisher:

```
symmetric          the centre of MASS at the middle of the extent   >= 0.90
waist ON a line    within a quarter space of line 1 or line 2
continuous         no paper across its height                       >= 0.95
half a stave to a whole stave tall                                  half 1.30..2.20
```

**The waist is the whole reading.** A C-clef is the only glyph on a page built
symmetrically about its waist with that waist standing on the line it names —
line 1 is tenor, line 2 alto — so the same test that finds it says which it is.

Two dead ends, measured, so they are not tried again:

- **Density inside the band is BACKWARDS.** The mid-system C-clef reads 0.233 of
  the 3.6-space band inked and a plain notehead reads 0.524, because the band is
  sized for a full-size clef and a small one does not fill it.
- **Per-column ink extent off the raw binary saturates on a photograph.** It read
  3.66 spaces of a 3.66-space window at every x on the Concerto, because a
  photographed staff line at a working space of 10 pixels is three pixels thick
  and survives a per-column run-length drop. `clefFeatures` does not have that
  problem and that is why everything here is measured on its profile.

### The false-fire count, which is the number that decides whether this ships

Every page in every other corpus in this project is in one clef per system, so a
detector that fires on any of them renames notes on a page it has no business
touching. Counted before anything was edited, and again on the shipped code.
**NOTE WHICH LINES A COMMITTED TOOL PRINTS AND WHICH DO NOT.** `scan:clef`,
`scan:corpus`, `scan:studies` and `scan:key-read` are commands anyone can re-run;
**the count on the three marked photographs is not** — no tool in `tools/`
reports `clefChanges` on a real page (checked: only `scan-clef-check.mjs` and
`clef-change-check.mjs` mention it, and both draw their own pages). That row and
the 10-staves row below it came from a bespoke probe in the round that measured
them, and re-taking them means writing the probe again.

```
  the three marked photographs, every window          13,148 windows    0 fires
  24 pieces of drawn furniture, clean AND photographed    48 pages      0 fires
  12 drawn pages from the hard-cases probe                             0 fires
     (chord stacks, two voices, grand staves, all the furniture)
  scan:corpus 49 rows · scan:studies · scan:key-read     byte-identical
```

**THAT TABLE WAS TRUE WHEN IT WAS WRITTEN, WENT SILENTLY FALSE, AND IS TRUE
AGAIN.** `20e004d` added `midBassAt` after it and nobody re-ran the block: with
that function in, `npm run scan:clef` read **155 false fires** and **118 notes
named wrong on a page whose change was found**. Both numbers are back to zero
now that it is deleted, and the same round added the pages the table did not
have — a mid-system treble at three sizes, two `-> bass` rows that are expected
to miss, and an accidental standing beside the change. **A count in this
document is a claim about a version; re-run the block before quoting it.**

The furniture block is drawn on purpose and lives in `npm run scan:clef`, which
**fails the build if the count is not zero**. It contains a sharp, a flat and a
natural inflecting a note **on each of the five lines** — the case whose waist
lands exactly where a C-clef's would — a thick-and-thin repeat barline with its
dots, a double barline, a plain barline, a fermata, a forte, a common-time C, a
quarter rest, a multi-bar rest with its number, and a chord of thirds.

**Only one thing ever beat the shape tests**: a chord of three notes a third
apart on a photograph, reading height 3.51, symmetry 0.98 and continuity 0.97 —
as tall, as solid and as symmetric as a small C-clef. What it could not fake was
the waist, which came out **1.71**, a third of a space off the line, where every
real C-clef measured here lands within **0.06** of one.

**That is why naming is part of the gate and not a step after it, and why there
is NO "something is here that I cannot name" refusal.** The obvious design was
presence-then-naming, with an unnamed candidate blanking the pitches after it;
the chord is the measurement that killed it. The shape half on its own is not
specific enough to carry a refusal, and a refusal that fired on every double
stop would blank half of the Bach suites.

The one window of the Bach that passes the shape half is a **printed sharp**
(`CROP_PAD=80 node tools/crop.mjs …/Menuet.pdf 697,649` — a barline, then an
accidental). Its waist reads 2.47 and it is refused. That is not luck about
sharps in general; it is why the fixture draws one on every line.

### What it is measured NOT to do

`npm run scan:clef`, third block, both spoilings:

```
  clef changes found, of 12 printed                            9
  a note named WRONG on a page whose change was found          0
  false fires                                                  0
  DEBT: notes still a ninth out because a change was missed    56
```

The three misses, each with its cause, so the next round does not re-derive it:

- **A clef engraved at 0.6 em**, clean and photographed. It measures 2.37 spaces
  tall against a bound of 2.6. That bound is what refuses the shorter half of the
  furniture, so lowering it is not free and was not swept.
- **treble → alto at 0.75 em, photographed only.** The same page clean reads it,
  and alto at full size reads it photographed.

**THOSE NUMBERS ARE NOW 18 OF 26 AND A DEBT OF 129**, because the block grew: it
carries four `-> treble` rows, two `-> bass` rows labelled NOT READ on purpose,
and two rows with an accidental beside the change. The two bass rows are expected
to miss for the reason above and are there to keep the debt visible.

Where it misses, the page keeps exactly the behaviour it had before this
existed — the notes after the change are named in the old clef — which is why
those 56 notes are printed as a DEBT line and not as a build failure.

**AND ONE THING THAT IS NOW SILENTLY WRONG IN A NARROW CASE, named here rather
than left to be discovered.** `applyAccidentals` keys its in-force map by
`step`, which is correct within one clef — an accidental binds the line it is
written on, not the letter — and that was checked before this shipped. **Across
a clef change it is wrong in both directions**: after the change the same step
is a different pitch, so an accidental printed before it carries to the wrong
note, and a note at the same PITCH on a new line loses one it should keep. It
needs an accidental and a clef change in the same bar, which is why neither
fixture can see it — the mid-system pages print no accidentals in that bar and
the furniture block prints accidentals but no clef change. **That is the row to
add to `scan:clef` first**, and it is the first bullet of item 5 of "The next
step" — a silent wrong pitch, which is the category item 1 is in.

**What it cost in time**, because `readPage` runs on a phone photograph inside a
UI and none of the ten correctness measurements can see its wall clock. Median
of eleven runs, the same page in the same browser, against the same module with
`findClefChanges` short-circuited:

```
              readPage with the scan off    as shipped      added
  Bach                637ms                    704ms      +67ms  (11%)
  Concerto            535ms                    579ms      +44ms   (8%)
  Scanned score       505ms                    561ms      +56ms  (11%)
```

Sliding the window half a space instead of a quarter gives back only 14–20ms of
that, and it halves the margin `MID_CLEF_RUN` exists to provide — the clef
answers over 6 to 8 windows at a quarter space, which is 3 to 4 at a half
against a bound of 3. **Not worth it**, and the probe that says so is
`scratchpad/CLEF/timing.mjs`. Note also that the scan runs inside the loop that
builds the returned page, so it runs on phantom staves too, before
`out.filter(realStaff)`; that is cost only and it is free to skip.

### The record on `20e004d`, corrected

**The commit at the head of this branch claims a gain it did not earn, and this
is the correction. Read it before trusting any commit message in this log.**
`20e004d bring a passage back down: read the bass clef that ends a clef change`
prints this in its message:

```
                     notes  named  RIGHT before  RIGHT after
  bass -> tenor       120     80        64            64
  tenor -> bass       120     60        30            38
  treble -> bass      120     80        38            54
  confidently wrong   88 -> 64
```

Three things are wrong with it, all measured in the round that deleted the
function:

- **`midBassAt` never read a bass clef — not once, at any size, clean or
  photographed.** Slid across a real mid-system F clef at 0.72 and 1.0 em, at
  staff spaces 12 and 16, it returns null at all 80 window positions. What made
  it fire was the following NOTEHEAD, which supplied the bottom edge the clef
  never produced. The +8 and +16 in that table are that accident landing right
  24 times on staff 0 of two fixture pages.
- **It broke a gate, and the gate was not re-run.** With `midBassAt` in,
  `npm run scan:clef` reads **155 false fires** and **118 notes named wrong on a
  page whose change was found** — two lines the tool itself prints as MUST BE
  ZERO. It answered `bass` on every sharp, every flat, every natural, on
  barlines, on the common-time C and on a chord of thirds. Deleting it takes both
  to 0.
- **Its "12 of 12 changes found" counted pages that change to TENOR** as bass
  changes found.

**NONE OF THAT `before` COLUMN IS REPRODUCIBLE FROM THIS TREE, and it is
labelled rather than left to look live.** `midBassAt` is deleted, so reproducing
the 155 and the 118 means restoring the function to `src/analysis/scan-clef.js`
first — `git show 20e004d:src/analysis/scan-clef.js` has it. All three numbers
above were measured in the round that removed it, and the AFTER column is the one
this document keeps live: `npm run scan:clef` is a build gate and prints both
totals every run.

**The lesson is not about clefs.** The commit's closing block quotes `bench`,
`scan:studies`, `scan:key-read` and `scan:corpus` — every one of which is blind
to a mid-system clef by construction, as this document says twice elsewhere —
while the one block that could see the change was not run. A number that went up
is not a measurement until the numbers that could have gone DOWN have been run,
and the ones that cannot move are not evidence at all.

### A MID-SYSTEM TREBLE IS NOW READ, AND A MID-SYSTEM BASS CANNOT BE READ OFF THE CLEF COLUMN

(The heading used to end "never will be". That is more than the measurement
says: 58,411 windows rule out every rule the one-dimensional clef PROFILE can
express, and they say nothing about a measurement with 2-D structure in it — the
F clef's two dots. The bound is on the instrument, not on the future.)

That is the round that deleted `midBassAt`, and both halves of it are
measurements rather than opinions.

**`midBassAt` never once read a bass clef.** Slid across a real mid-system F clef
at 0.72 and 1.0 em, at staff spaces 12 and 16, clean and photographed, it
returned null at all 80 window positions. Its apparent four-of-twelve on `npm run
scan:clef-change` came from the following NOTEHEAD supplying the bottom that the
clef never produced. Worse, on the pages where it did fire it fired on
EVERYTHING: measured on `npm run scan:clef` before it was removed, its two
MUST-BE-ZERO totals read **155 false fires and 118 notes named wrong on a page
whose change was found** — it answered `bass` on every sharp, every flat, every
natural, the barlines, the common-time C and the chord of thirds — and the
"12 of 12 changes found" it reported included rows where a `bass` change was
"found" on a page changing to TENOR. The commit that added it (`20e004d`) claimed
a gain it did not earn and broke a gate. Deleting it takes those two totals to
**0** and **0 above the controls' own floor**.

**And no gate exists.** 58,411 windows — every window of those sixty pages plus
all twenty-two pieces of `scan:clef` furniture at both spoilings — were swept
against every rule that can be built out of the clef column: the extent at four
ink floors (0.12 down to 0.04), the F line's position within that extent as a
fraction of its height, continuity, symmetry, top-heaviness, the widest row, the
ratio of widest to narrowest, and a required run of 3 to 7 windows. **The most
sensitive gate read 41 of 60 systems and fired 88 times on the furniture; the
quietest that read any clef at all read 32 of 60 and still fired 25.** The reason is the one `classifyClef` already writes down: bass is
the RESIDUAL. Treble is alone below the stave and a C-clef is alone above it; a
bass clef is known by where its ink STOPS, and a sharp, a flat, a natural, a
common-time C, a quarter rest and a chord of thirds all stop there. At the head
of a system that costs nothing because the other two answers are excluded first;
mid-system there is a fourth answer — "nothing, this is music" — and a residual
cannot carry it.

**Two things that are NOT the reason, so they are not re-proposed.** `INK` (0.12)
does truncate a cue-sized F clef — its lower curl covers 0.114 of the 3.6-space
band — and at a floor of 0.06 the extent comes back correct at every size (2.01,
2.51, 2.67, 3.23, 3.56 spaces for em 0.6 to 1.0). `BASS_SOLID` (0.8) did refuse
even a full-size clef, because solidity was taken at `SOLID_INK` over a band
sized for a full-size C-clef and an F clef reads 0.55 there. **Both were fixed
inside the sweep and the false fires are what remained.**

**The TREBLE, by contrast, separates.** `midTrebleAt` reads **54 of 60** drawn
mid-system G clefs with **zero false fires** over the same 58,411 windows, and
on `npm run scan:clef-change` the two new pairs score EXACTLY what their controls
score — bass→treble 78 of 120 against a control of 78, tenor→treble 60 against
60, each finding its change on 12 of 12 systems. The six misses are all at em 0.6, which is the same size floor the C-clef
already has. What does the work, by ablation (drop one test at a time):
continuity 47 false fires, "below the stave" 18, a run of 3 instead of 5 twelve.
Symmetry, the height bound and the anchor ratio cost no recall and catch nothing
on this furniture; they are kept because the furniture is not the last page this
will meet, and the comment in `scan-clef.js` says so plainly rather than letting
them read as measured.

**TWO TESTS CAME OFF THE BACH PHOTOGRAPH AND NOTHING SYNTHETIC COULD HAVE ASKED
FOR THEM.** With only the sixty-page gate satisfied, the detector fired four
times on the Bach — staves 4, 6 and 7 — and cropped at 8x every one is **a
barline or a sharp standing between two beamed groups whose beams hang below the
bottom line**. Every bar of the Prélude is beamed semiquavers with the stems
down. The barline supplies ink continuous from the top line to the bottom one and
the beam a space away supplies the depth, and the column profile cannot see that
they are two objects because it has already summed across the band. So:

- **`TREBLE_BEAM`** (in `scan-clef.js`): a beam is WIDE. Rows below the bottom
  line covering more than 0.55 of the band — every one of 675 windows on a real
  G clef has at most ONE (0.09 of a space), and the Bach's beamed group has eight
  to ten (0.7 to 0.9 of a space).
- **`tailUnderBody`** (in `scan-read.js`, because it needs the page and not the
  profile): a treble's tail hangs UNDER its own body. The x-centre of the ink
  below the bottom line against the x-centre of the ink between the lines, both
  with the staff lines left out — 0.19 of a space apart at the median on a real
  G clef and 0.50 at the ninetieth centile, against 0.68 to 1.36 on all three of
  the Bach's barline windows.

With both, the three marked photographs report **0 clef changes** on 10 staves
each, `scan:clef`'s furniture block is 0, and `bench` is byte-identical.

**THE COST IN TIME COULD NOT BE MEASURED THIS ROUND AND THE OLD TABLE STANDS.**
The machine was at load 6 with a browser of the user's own saturating it —
`readPage` on the Bach measured 1785ms against the 637ms the table above records
— and at that noise the probe returned the shipped reader FASTER than a variant
with a test removed, which is not a measurement of anything. `scan:key-read`
timed out identically with the ORIGINAL files and with the new ones, which is how
the load was ruled in and the change ruled out. Re-measure on a quiet machine
before quoting a number; the shape of the added work is one extra `clefFeatures`
per window on non-treble systems, and `tailUnderBody` only where the profile has
already said treble.

**AND THE CLEF IS NO LONGER READ AS AN ACCIDENTAL.** `accidentalFor` takes a
patch a fixed distance left of each notehead; an engraver prints the next note
close behind a cue clef, so for that one note the patch lands on the CLEF and the
model — which has never been shown one — answers `flat` at 0.99 and `sharp` at
0.993. Eight of the 64 wrong pitches on `scan:clef-change` were that, every one
the first note after a change, every one a confident semitone. `findClefChanges`
now reports the glyph's own `from`/`to` and `readPage` blanks the accidental of
any head whose PATCH CENTRE falls inside it. After: no note whose change was
found carries a wrong accidental.

One more thing it deliberately does not do:

- **A mid-system clef is still CIRCLED** as up to two false noteheads where
  `findHeads` mistakes it for one (measured at 0.6 em and 1.0 em, not at 0.75 or
  0.9). Suppressing it would change what is circled, which this change is
  constructed not to do, so it is left for a round that can measure it. Note the
  interaction runs the other way too: an earlier draft required "no accepted
  head in the window" and that test suppressed detection at exactly those two
  sizes. It was dropped — it costs nothing on the photographs and it coupled the
  detector to a false-circle bug in a different subsystem.

### Why nothing about what gets circled moved

By construction, not by luck. The three things that decide what is circled all
consult `clefs[i].clef` — the band gate in `dropFurniture`, `readKeySignature`,
and the key-signature suppression — and **none of them can see `clefChanges`**.
The list is computed in the loop that builds the returned page and is read by
`clefHere`, which is read by `notesInOrder` and by nothing else. That is the same
discipline the `agreeNoKey` round used to keep the suppression out of its change.

**`pitchOf` learned `alto`** in the same round (`scan-notes.js`), because the
scan that finds a tenor C-clef finds an alto one by the same measurement, and
detecting a glyph and then refusing to name it is a bug wearing the clothes of
caution. Derived rather than remembered — an alto clef puts middle C on the
third line, so the bottom line is F3 — and checked the only way this table can
be checked, against the one note the clef names: `pitchOf(4, 'alto', NONE)`
comes back 60. **This table has now been written wrong twice in this project and
both times it was a C-clef**, so `scan:clef` carries its own copy of the
arithmetic and refuses to run if its self-check disagrees. That self-check
caught a wrong row in its author's first draft the first time it ran.

**`scan-key.js` carries the SECOND copy of that table (`BOTTOM_DEGREE`, and its
own comment says so) and it did NOT get `alto`.** That is checked, not assumed:
`readKeySignature` has one call site, `dropFurniture` in `scan-read.js`, which
passes `clefs[i].clef` — and `clefs` comes from `classifyClef`, which can only
return treble, tenor, bass or null. `clefChanges` never reaches it, which is the
same reason nothing about what gets circled moved. **If a later round ever feeds
a mid-system clef to the key reader, that table needs alto first**, or the two
copies will have drifted for the third time.

## Reading the key signature

### The band could stop inside the sharp, and the page now fixes it

**This is the whole of the user's second complaint — "many false circles on the
key signature like the sharps next to the clef" — and it is closed on every
system the suppression can reach.**

```
                                   before      after
  bench mean precision              92.1%      92.8%
  bench mean recall                 94.9%      94.9%   (unchanged on all 3 pages)
  Bach invented                        8          6
  Concerto invented                   43         37
  Scanned invented                    40         40
  false circles on the key band     4 / 7 / 1  2 / 1 / 1   (Bach / Concerto / Scanned)
  scan:corpus CORE/HARD/SIZES/FEW  99/93/89/91  99/93/89/91   (the rule fires on NO corpus page)
  scan:key-read                    300 of 352 · 0 wrong · identical
  scan:clef · clef-hard · bars · spread    15/15 · 9/10 · 64/72 · 8/8    identical
  unit tests                          559        563
```

**BOTH COLUMNS OF THAT TABLE ARE AT THE TIME, AND AN EARLIER COPY OF THIS
PARAGRAPH CLAIMED THE `after` COLUMN WAS STILL LIVE. IT IS NOT.** Four rounds
have landed since — the bare-page key, `dropDoubledHeads`, the truth repair with
the phantom stave, and the mid-system clef — and every row of it has moved:
`bench` read **95.0 / 98.1** at the time, invented **4 / 24 / 29**, the key
band's own furniture share **2 / 0 / 0**, `scan:corpus` **99/94/89/91**. Live
today it is **94.9 / 98.1**, invented **6 / 23 / 29**, and there are **614**
tests. The one row that has not moved is `scan:key-read`, still 300 of
352 with none wrong. Read the table at the top of this document for the live
figures; this one is kept only because it is the delta this particular change
bought.

**`npm run scan:key-why` named the cause on every one of them and the crops
confirmed it rather than the reasoning.** **Its system NUMBERS have shifted by
one on both Mozart pages since this was written, because the phantom title-block
stave they used to count as system 1 is gone** — the bands are the same bands.
Live, re-run for this document: the Concerto's systems **4, 6 and 10** return
bands 0.40, 0.40 and 0.81 staff spaces wide where the same page's readable
systems return 1.39; the Bach's system 3 returns no band at all beside
neighbours returning 1.14 to 1.16. `CROP_MARKS=1
CROP_TRUTH=pages/truth/mozart.truth.json npm run scan:crop -- Concerto.pdf
74,797` shows two green rings on the two crossbars of the printed sharp and
nothing else. **And the narrow bands are not the sharp read short**: the sharp
stands at x = 74, the band is at 55..59, and 55 is the treble clef's own
trailing ink — the scan stopped fifteen pixels before it ever reached the
signature.

**A key signature is printed at the same distance past every system's left end,
so the systems that read one know how far it reaches.** `agreeKeyReach` takes
that distance in staff spaces and `dropFurniture` widens any system that falls
short of it. The suppression is one range, `[edge, hi]`, so only the right-hand
end matters and nothing has to be moved.

**WHY THIS IS NOT THE CROSS-SYSTEM VOTING THAT IS ALREADY DEAD.** The dead rule
located NOTEHEADS by repetition and cost four to eight points of recall on the
corpus, because music near a system's start is often similar system to system.
This measures ONE PRINTED OBJECT THAT GENUINELY REPEATS and infers nothing about
music: no candidate is proposed, accepted or located, only a distance is agreed.

**IT BREAKS AN INVARIANT THIS DOCUMENT ASSERTED IN THREE PLACES, and all three
are rewritten rather than left to mislead.** "Every bound in `findKeyBand` is
measured off the ink of the system it is scanning, and nothing another system
found can widen it" was true and is not. The replacement argument is weaker and
has to be checked instead of assumed:

- the reach is a MEDIAN of what systems that successfully READ A KEY measured
  for themselves, so it is a distance at which real accidentals were found on
  this page;
- it only ever WIDENS — `Math.max` against the system's own answer — so no
  system can lose suppression it already had, and nothing can be narrowed;
- it needs two witnesses AND a page that AGREED a key, which is what keeps it
  off a page of bare staves;
- and each witness's own reach came out of `findKeyBand` walking that system's
  ink, with over-readers already trimmed back by `agreeKeyCount` first.

**THE UPPER MIDDLE, AND THE CHOICE IS A MEASURED PLATEAU.** Swept on the three
marked pages — false circles left standing on the key signature, recall
unchanged to the digit at every setting:

```
  statistic       Bach   Concerto   Scanned    bench mean P / R
  nothing            4        7        1        92.1 / 94.9
  minimum            4        6        1        92.2 / 94.9
  lower middle       4        1        1        92.6 / 94.9
  UPPER MIDDLE       2        1        1        92.8 / 94.9     <- shipped
  maximum            2        1        1        92.8 / 94.9
```

The top of the distribution is FLAT, so the choice between the upper middle and
the maximum is made on which a single bad witness cannot move. **The lower
middle is a knife edge and the measurement says so**: the Bach's four witnesses
reach 4.87, 4.88, 5.20 and 5.46 spaces, its false circles stand at x = 93, and
the lower middle puts the band's end at 93.0.

**AND ONE OF THOSE FOUR WITNESSES IS ITSELF A SHORT READING, which is the
fragility to know about before anybody tightens this.** "A system that read a
key" is a weaker filter than it sounds: a sharp measured half-width is still
classified as a sharp, and one sharp is still one sharp. The Bach's system 4
returns a band **0.74 spaces wide** against 1.14 to 1.16 on the systems that read
cleanly, reads "1 sharp" perfectly happily, and contributes the 4.87 that the
lower middle would have used. Under-reading is the failure this rule exists to
repair, so a statistic the short witnesses can decide is deciding the page off
the broken readings — which is the whole argument for the upper middle rather
than a preference for larger numbers. Filtering witnesses by band width instead
is a different statistic with its own sweep to do, and the plateau says it would
buy nothing today.

**IT FIRES ON NO CORPUS PAGE AT ALL, and that is printed rather than argued.**
`npm run scan:corpus` now ends with a line saying how many of its 58 pages the
rule fired on, and it is **0 of 58** — no page of bare staves agrees a key, so
no band there is ever widened and CORE, HARD, SIZES and FEW are unchanged by
construction rather than by coincidence. That line is the guard: the day a
corpus page starts agreeing a key, the number stops being zero and somebody
sees it.

**AND THE SAFETY PROPERTY IS CHECKED ON A PAGE, BECAUSE THE OLD CHECK COULD NOT
SEE THIS RULE.** `npm run scan:key-safety` drew one stave per case and called
`findKeyBand` directly, where a rule needing two witnesses never fires — a green
run of it would have said nothing whatever about the widening. It now has a
second block: five systems through `readPage`, each printing the same real
signature and then music, with one system's signature printed faint and thin so
its own scan under-reads it, which is the Concerto's failure reproduced.

**What it gates is the DELTA and not the total.** Each system's suppression is
rebuilt twice from what `readPage` reports — `plain`, exactly the old range, and
`wide`, the same with the page's reach allowed in. A head inside `wide` but not
inside `plain` is one this rule ate, and there must never be one.

```
                                              before        after
  pages the widening fired on                 0 of 33      19 of 33
  heads the WIDENING put in a suppression     0 of 1320     0 of 1320   gated
  heads the band's own scan reached           13 of 1320   13 of 1320   pre-existing
```

**The thirteen are not new and that is measured, not asserted** — the same block
run against the code before this round reports the same thirteen. They are on
three pages, all treble with sharps at a two-space gap, and this block found
them only because it draws a PAGE where the single-stave block draws a stave and
gates that same cell at zero. They are printed every run and they are the second
half of item 14 of "The next step".

### A PAGE THAT PRINTS NO KEY SIGNATURE NOW NAMES ITS NOTES

**A page in C major could not name one note, and 110 of the 692 notes of the
engraved cello studies were on such a page.** `agreeKey` returns null when
nothing is printed, `pitchOf` refuses a null key on purpose, and so a study in C
major came back with twenty-nine noteheads and twenty-nine empty pitches. Every
one of the 110 was on one of the five C-major or A-minor studies.

**THE DISCRIMINATOR IS THE SCAN'S OWN VERDICT, NOT A THRESHOLD ON INK, AND THAT
IS WHY THE TWO EARLIER ATTEMPTS FAILED.** `findKeyBand` returning null was three
answers wearing one face — a degenerate window, a scan that accepted nothing, a
scan that accepted more than seven runs — and only one flavour of the middle one
is evidence. `scanKeyBand` now carries the reason out, and `empty` means *the
scan walked the place a signature is printed and the next ink stands further
from the clef than one accidental ever stands from the next* (`why === 'gap'`
with no glyph accepted). Measured, the two populations do not overlap:

```
                                            band empty     of
  drawn bare C-major cells                     16          16
  drawn printed signatures                      0         224
  drawn cancellations                           0         112
    …including all 52 the reader REFUSES        0          52   (bands of 2 to 7 glyphs)
  study systems in C major or A minor            8           8
  study systems with a printed signature         0          42
```

**"A signature whose glyphs were all refused looks identical from outside" was
the stated reason for the last revert and it is false**: all 52 refusals hold a
band of two to seven glyphs. What is true, and is why this has to be a PAGE
rule, is that a single system can look bare over a printed sharp — the Bach's
system 3 does exactly that.

**THE TWO REVERTS ARE EXPLAINED TO THE DIGIT.** "Empty band means C major" scored
16 wrong keys because `tools/key-read-check.mjs` requires C major to read as
SILENCE (`want = count === 0 ? null : …`), so the 16 were the 16 bare cells being
named, not sixteen misread signatures. "Ink within `KEY_ADJACENT`" scored 15 and
still failed every C-major study because on a BASS clef the clef's own two dots
stand 0.00 spaces past the clef band — that test was measuring the clef.

**THE RULE.** Every system that ran the scan must have come back `empty`, none
may have read a key, and there must be at least **two** of them. `agreeNoKey` in
`scan-key.js`; the page then reports `key` with `kind: 'none'` and
`keySource: 'bare'`. **Decided at the page's own key and deliberately NOT inside
`dropFurniture`**, whose local page key drives `agreeKeyReach` — feeding that a
page whose systems have no band at all would put NaN into it for no gain, since
there is nothing to suppress on bare paper. That is why every number about what
gets CIRCLED is unmoved.

**THE SWEEP, BOTH HALVES.** The prize is `npm run scan:studies`; the price is the
third block of `npm run scan:key-safety` — 76 drawn pages that PRINT a signature,
both clefs, 1 to 7 accidentals, clean and photographed, 1 to 5 systems:

```
  floor   right pitch   no pitch at all   keys      a page with a signature
          of 692        of 692            of 32     that named itself C major
    1     662  95.7%      0               20        1 of 76      <- A WRONG KEY
    2     636  91.9%     26               18        0 of 76      <- shipped
    3     557  80.5%    110               15        0 of 76      <- buys nothing
```

Read the third row first: **a floor of three is the reader with no rule at all,
to the digit**, because the pages that print no signature have two systems and
not three. So the sweep is a choice between one and two, and the page that
breaks at one is `bass, 2 sharps, photographed, ONE system` — the camera takes
the printed signature below the scan's floor, the single system says the place
is bare, and the page names itself C major, two degrees wrong on every note of
it. **That settles the single-system question with a number**: one system is not
a page, the two single-system arpeggio studies keep no key, and that costs 26
notes.

**AND IT MAKES A ONE-SYSTEM PAGE BEHAVE TWO DIFFERENT WAYS, WHICH IS DELIBERATE
AND CONTRADICTS AN OLDER PARAGRAPH IN THIS FILE IF READ CARELESSLY.** "Single-
system pages have no page key … their pitches are still right because the
stave's own key is the fallback" is true of a PRINTED signature and false of
bare paper. `notesInOrder` reads `page?.key ?? staff.key`, and there is no
staff-level bare key — on purpose. The studies print both halves side by side:
the twelve single-system arpeggios WITH a signature read 100% right pitch off
`staff.key`, and `A-minor-arpeggio` and `C-major-arpeggio` read 0.0%. The
asymmetry is the rule's whole safety argument. A printed signature is positive
evidence from that system's own ink; bare paper on one system is not evidence of
anything, and a per-system version of this is exactly what the 3-of-205
measurement below forbids.

**THE DENOMINATOR IS "SYSTEMS THAT RAN THE SCAN", NOT "SYSTEMS ON THE PAGE",**
and that is a decision rather than an accident — a unit test pins it. A system
with no left edge or no named clef never calls `findKeyBand`, so it is not a
witness for bare paper and it is not a witness against one either. The
consequence to know: on a badly degraded page where most systems lose their
clef, the rule could fire on a minority of the page's systems. `keyAgreement`
reports `systems` and `scanned` separately so that gap is visible, and nothing
in the eighteen crops got near it — the Concerto at 6 per cent scanned 3 of 10
with 0 saying bare, the Scanned score at 8 per cent scanned 2 with 1. It is
unobserved, not impossible.

**THE MARGIN, MEASURED TWO WAYS.**

- **3 of 206 systems** of drawn pages that plainly print a signature come back
  saying the place is bare, all three photographed. Every one is a system a
  PER-SYSTEM rule would have named C major; not one of their pages fires.
- **The three marked pages re-read with 0, 4, 6, 8, 10 and 14 per cent of their
  left margin cut off** — a photograph framed past its own key signature, which
  is where this would fire wrongly if it fired anywhere. Eighteen crops, every
  page in ONE SHARP, **fired on none**. Closest was the Bach at 10 per cent: 5
  of its 10 scanned systems said bare against the 10 the rule needs. `empty` is
  what buys that margin over a plain `band === null` test — at 4 per cent the
  Bach has SIX systems with no band and only TWO of them ending on a gap.

**WHERE IT IS GATED, AND WHY NOT WHERE YOU WOULD EXPECT.** `npm run
scan:key-read`'s "0 read as the WRONG key" **cannot see this rule at all** — that
tool draws one stave and calls `findKeyBand` directly, so a two-witness page rule
never fires there and its zero would stay zero however wrong this went. Citing
it as evidence of safety would be citing nothing. The gate is the third block of
`npm run scan:key-safety`, through `readPage`, on whole pages, with three
must-be-zero lines: a page with a signature must never say bare; a clean bare
page of two systems or more must always say it; a bare page of ONE system must
never say it.

**THE DEBT: A PHOTOGRAPHED BARE PAGE, 6 of 6, printed and not gated.** The cause
is measured and it is not this rule. The camera smears the clef, the overhang
walk steps further right to get past it, and the first note of the bar then
stands INSIDE `KEY_ADJACENT` of where the scan starts — so the scan measures the
note, finds it too wide or too tall to be an accidental, and ends on it. Swept at
space 14, 20 and 28 photographed: the ending is `wide` or `tall` while the music
stands 3 to 5 spaces past the clef band, `gap` at 8, `none` past 12. **The
refusal is correct** — there is ink where a signature would be and the reader
cannot name it — and it costs a photographed C-major page its pitches. Closing
it means measuring where the clef ENDS better, which is a weakness the clef band
already has; it does not mean widening what counts as empty. The studies' own
`--camera` filter is gentler and does not move a digit: 636 either way — and that
is because it is too gentle to move ANYTHING, which is now known and has its own
entry under *The accidental reader is not the bottleneck*. Use `--phone` to ask
this question of a photograph.

**WHAT MOVED AND WHAT DID NOT.**

```
                                   before          after
  scan:studies, right pitch      557  80.5%    636  91.9%
    no pitch at all                110              26
    key signature right          15 of 32        18 of 32
  scan:studies --camera          557             636
  scan:studies --space 9         557             638
  scan:studies --space 22        481  69.5%     506  73.1%
  scan:key-read, read right      300 of 352      300 of 352
    …read as the WRONG key         0               0
  bench                          93.3 / 96.4     93.3 / 96.4   identical to the digit
  scan:corpus CORE/HARD/SIZES/FEW 99/93/89/90    99/93/89/90   byte-identical
  scan:bars · clef · clef-hard   64/72 · 15/15 · 9/10   unchanged
  unit tests                     567             578
```

**THE 84 NOTES RECOVERED ARE 79 RIGHT AND 5 WRONG, AND THAT IS A SUM RATHER THAN
A CLAIM** — `offBy` is the one column that got worse and it is the first thing
anyone should challenge, so here is the arithmetic closing to the digit:

```
  newly pitched   110 - 26  =  84
  newly right     636 - 557 =  79
  newly wrong      84 - 79  =   5
  offBy before    5 + 9 + 11        = 25
  offBy after     6 + 2 + 10 + 12   = 30      difference 5, exactly
```

Those five notes had NO pitch before and now have one, so the two bugs the second
diagnosis already named — one notehead reported by two staves, and
`tools/study-check.mjs` under-printing a cancelling natural — become visible on
the C-major pages for the first time. Neither was touched in the round this
table describes, deliberately: fixing the harness moves the studies number for
reasons unrelated to the key and destroys the attribution on the one number that
round was trying to move.

**Both are fixed now, in the round after**, and `offBy` is empty: see *One piece
of ink reported by two staves* and *`scan:studies` — the north star for pitch*.
The live figure is 666 of 692 with the 26 unpitched notes unchanged —
they are still the two single-system arpeggios and they are still the price
argued for above.

### A band nobody could read a key from does not get to delete noteheads

`findKeyBand` marks a band `cut` when its scan stopped on a speck or ran out of
reach rather than on clean blank paper, and `readKeySignature` refuses such a
band outright — a prefix of a key signature is a valid key signature, so a
signature cut short reads as a confident wrong key. `dropFurniture` was not
asking. It took `key.x1` whatever the scan thought of it, which is the same
loaded gun pointed at the music instead of at the answer: on a stave with no
signature at all — bare staves with music where the furniture would be, which is
most of the synthetic corpus and every cropped photograph — a phantom band that
ends on a speck reaches into the first bar and the heads inside it are deleted
rather than mislabelled. A reviewer measured three of forty drawn heads gone at
space 12 and two at space 16.

One rule now answers both questions: **a band good enough to name a key is good
enough to suppress, and nothing else is.** The clef band still applies on its
own, so a system whose signature could not be read keeps its furniture covered.

**MEASURED, AND IT MOVED NOTHING.** `bench` identical to the digit, `npm run
scan:key-safety` identical, 563 tests **at the time** (614 today). It was kept as an invariant rather than
an improvement — the failure it closes is on page shapes the marked pages do not
contain, which is precisely why no number here could have caught it. The
safety check's own residual of *13 of 1320 heads reached by a band's own scan*
is a DIFFERENT, pre-existing population: those bands are not `cut`, they end
cleanly and still overrun. That one is still open.

### The band could eat a real notehead

**THE BAND MAY EAT FURNITURE. IT MAY NEVER EAT MUSIC — AND IT COULD, AND THAT IS
FIXED.** `dropFurniture` deletes every notehead whose x falls inside the band
`findKeyBand` returns, so a note the band covers is a note gone from the page.
A reviewer's probe caught it doing exactly that: a stave at space 12 with lines
at y = 60..108, a two-pixel fleck of grain at x = 92 between the clef and the
music, and a crotchet below the stave — before, the band came back 92..104 and
the note was deleted.

**The cause was not the speck-skip, and reverting that would have been the wrong
fix.** `column()` measured only from 1.2 spaces above the top line to 1.2 below
the bottom one — a bound on WHERE THE SCAN LOOKS, used as a MEASUREMENT. A note
is four spaces of ink from stem tip to the far side of its head, so a note
standing anywhere but the middle of the stave hangs out of that window. Opened
up on the reviewer's own fixture: the note's ink runs y = 84 to 132 and the
column reported 85 to **122**, cut off exactly at the window's edge — **3.17
spaces against GLYPH_TALL's ceiling of 3.2**, so the height test took a notehead
for an accidental. Now each column follows its own ink out of the band by
contiguity, stopping as soon as it is over the ceiling because past that point
no further pixel can change a decision.

Both columns are **as measured on the day of this change**; the `bench` and
test rows have moved since for unrelated reasons and the live values are in the
third column.

```
                                     before        after      LIVE TODAY
  scan:key-safety, named fixture    EATEN         safe        safe
  …the gated cell                   0 of 1008     0 of 1008   0 of 1008
  …the DEBT line (grain at 2)       6 heads       6 heads     6 heads
  scan:key-read, printed right      159 of 224    172 of 224  172 of 224
  …read as the WRONG key              0             0           0
  bench                             92.1 / 94.9   92.1 / 94.9  95.0 / 98.1
  scan:corpus CORE/HARD/SIZES/FEW   99/93/89/91   99/93/89/91  99/94/89/91
  unit tests                        555           559          607
```

The LIVE TODAY column was re-run for this document. Its `bench` and test rows
have nothing to do with this change: four later rounds moved them, and the
Scanned score's denominator moved underneath them as well — see the headline
table.

**It is not a trade — the reading got BETTER by thirteen signatures.** Once a
column measures its true height, the third sharp of a treble signature (printed
above the top line, reaching 1.9 spaces past it, which the narrow band used to
cut 0.7 of a space off) is measured as what it is.

**It cannot let new ink into the scan**, which is what makes it safe against the
bar number and the pencilled bowing the narrow window exists to exclude: the
walk only starts from ink already found inside the window and only follows ink
that touches, with no bridge. A column that was blank is still blank.

**The neighbouring clamp bug is fixed too.** The clef-overhang walk computed
`overhang = start + round(space * 2)` without the `Math.min(w - 1, …)` that
`limit` twelve lines above has, so `column()` could be called with `x >= w` and
index `ink[y * w + x]` straight into row `y + 1`. Reachable on a stave whose left
edge is within two spaces of the right edge of the image — a crop or a fragment.
**It cannot change the band and the test says so**: a walk that reaches the edge
leaves `from` at or past `w`, and `limit` is itself clamped, so the glyph loop
never runs either way. It is a silent wrong read, and the test asserts it as one
— the ink goes in behind a proxy that refuses any index past the end of the page.

**The classifier was correctly NOT retrained, and that is a claim with evidence
rather than an omission.** `findKeyBand` feeds only `dropFurniture`, which
filters heads *after* `findHeads` has produced them, so it cannot move the
candidate distribution the model is fitted to — and `bench`'s `found` and
`really` columns were identical to the digit on all three pages **at the time**
(326/322, 347/332, 455/440), which is that distribution measured rather than
argued. **Both columns have moved several times since and neither movement is
the candidate distribution changing**, which is the argument still standing.
Live in `bench` today: `found` **322, 336, 439** and `really` **319, 328, 412**.
The `found` column moved because the page-agreed key reach, `dropDoubledHeads`
and the phantom stave each removed circles; the `really` column moved because
seventy marks came off the two Mozart truth files and thirteen went on. (It read
324/341/455 and 319/332/440 when this paragraph was last written.)

**THE PRICE, on the marked pages: the Scanned score's LAST system** — numbered
11 when this was written and 10 now that the phantom is gone. Its band goes
1.25 spaces to 0.73 and its sharp is no longer read, so the page went from 10 of
10 systems agreeing to **9 of 9**, where it stands today. The page's answer is
unchanged and still unanimous, and the witness floor is two, so the margin is
seven. See "The three marked pages" for all three pages' live counts.

**THE SAFETY PROPERTY IS NOW MEASURED RATHER THAN ASSERTED — `npm run
scan:key-safety`.** 768 drawn pages, 2304 noteheads: real Bravura signatures of
0, 2, 4 and 7 accidentals in both clefs at four sizes, clean and photographed,
with music starting 1.5, 2 and 3 spaces past the last accidental, with a fleck
of grain in the gap and without. It asks one question — is any drawn notehead
inside the band — and the reviewer's fixture is in it by name as `grain-fleck`.

**What it gates and what it only prints, because a green check trusted too far
is worse than none.** Gated at zero, on 1008 of the 2304 heads: the named
fixture; every page with clean paper in the gap at two spaces or more at a size
this reader works at; and every page at three spaces or more whatever is in the
gap, grain included.
Printed, not gated: a gap of a space and a half, which is inside `GLYPH_GAP` and
`KEY_ADJACENT` — the distances one accidental in a signature stands from the
next, so a note set that close cannot be told from the next sharp by position at
all; and the 6.5-pixel cell (space 9 photographed), which is the exclusion
`key-read-check.mjs` already states in prose.

**THE DEBT IT REPORTS IS REAL AND IS NOT NEW: six heads on three pages** —
treble space 12 photographed with four sharps and with two flats, bass space 16
photographed with four sharps, all three with a fleck in the gap. **The same
three pages and the same six heads on the code before this round**, so the fix
regressed nothing; it is printed every run so it cannot grow unnoticed, and
closing it is item 14 of "The next step".

**THE KEY READER'S CONTRACT IS "A WRONG KEY IS WORSE THAN NO KEY", AND IT WAS
BROKEN IN FOUR PLACES. All four are fixed, all four are pinned by unit tests
that fail on the old code, and `npm run bench` does not move a digit.**

**Both columns are AS MEASURED ON THE DAY OF THAT CHANGE**, which is what makes
them a comparison. Three of the rows have moved since, for reasons that have
nothing to do with this work; the live values are in the third column.

```
                                    before        after       LIVE TODAY
  scan:key-read, printed right     163 of 224   159 of 224    172 of 224
  …read as the WRONG key             4 of 224     0 of 224      0 of 224
  cancellations refused            112 of 112   112 of 112    112 of 112
  bare C major, nothing invented    16 of 16     16 of 16      16 of 16
  bench                            92.1 / 94.9  92.1 / 94.9   95.0 / 98.1
  scan:corpus CORE/HARD/SIZES/FEW  99/93/89/91  99/93/89/91   99/94/89/91
  scan:clef · clef-hard            15/15 · 9/10 15/15 · 9/10  15/15 · 9/10
  scan:bars · scan:spread          64/72 · 8/8  64/72 · 8/8   64/72 · 8/8
  unit tests                       543          555           607
```

The LIVE TODAY column was re-run for this document. The reading rose to 172 when
`column()` stopped clipping its measurement at the band (the section above), and
every movement in the `bench`, corpus and test rows since belongs to a later
round — the page-agreed key reach, the bare-page key, `dropDoubledHeads`, the
truth repair with the phantom stave, and the mid-system clef. None of it is this
change.

**Four correct reads were given up and four wrong keys were removed, and that is
the trade this file exists to make.** A refusal falls back to C major, which puts
a semitone on nothing; a wrong key puts one on every note of a degree for as long
as the page is open. **`npm run scan:key-read`'s gate is now ANY wrong key**, on
any page at any size — it used to exempt photographs on the argument that gating
on them would ship a check that is red the day it is written, and that argument
expired with the last of them.

**1. TENOR CLEF WAS WRONG BY TWO DEGREES, in a cello app, in two files.**
`BOTTOM_DEGREE.tenor` was 3 with a comment saying the bottom line is F3. A tenor
clef puts middle C on the FOURTH line, so the lines read D3 F3 A3 C4 E4 and the
bottom one is D3, degree 1 — F3 is the SECOND line. `scan-clef.js` returns
`tenor`, so this was reachable on any cello page, and **it did not fail by going
quiet**: a probe sweeping a lone sharp over steps 0 to 9 in tenor came back
`{degrees:[3]}` — one sharp, F sharp, the commonest signature in print — at
steps 0 and 7, where the glyph is standing on D. It now reads F sharp at steps 2
and 9 and refuses 0 and 7.

**The same two numbers were wrong the same way in `scan-notes.js`**, which is
the copy that names an actual pitch: `BOTTOM_LINE.tenor` was MIDI 53 and its own
`BOTTOM_DEGREE.tenor` was 3, so **every note of a tenor-clef page came out a
third too high**. Both are now derived from where the C-clef sits rather than
remembered, and `tests/scan-notes.test.js` asserts the one note the clef
actually names — `pitchOf(6, 'tenor')` is middle C — instead of asserting the
table. That test file previously asserted the bug.

**2. A PLAIN NOTEHEAD WAS CLASSIFIED AS A SHARP AND BECAME THE PAGE'S KEY.**
`classifyKeyGlyph`'s three corner patterns are a PARTITION, so every run was one
of sharp, flat or natural and there was no way to say "none of these". Measured
on 288 bare staves — no printed signature, one crotchet standing where the
signature would be, nine steps, both stem directions, two clefs, four sizes,
clean and photographed — **26 came back with a key and 22 of those said ONE
SHARP**, one of them at confidence 0.99. A down-stemmed crotchet puts its head
in the top third of its own box (both corners inked) and its stem down the left
of the bottom third, which is a sharp's pattern to the digit.

Two fixes, and the second is the one that closes it:

- **`classifyKeyGlyph` can now say `'notehead'`**, on the STEM leaving the shape
  window rather than on shape. `describe` grows a glyph's box by contiguity out
  to 2.4 spaces past each end of the stave; an accidental is printed on the
  stave and its ink stops inside that, a stem is 3.2 spaces long and does not.
  **0 of 1331 drawn accidentals reach the bound against 51 of 138 crotchets** —
  zero false positives on the whole drawn corpus, which is why it ships as a
  hard refusal. It removes 11 of the 26 phantoms and costs nothing at all.
- **`agreeKey` now needs TWO witnesses.** The majority test `best * 2 <=
  read.length` is `2 <= 1` for a single reader — false — so one system carried
  the whole page and "unanimous" was reported for it. A key signature is printed
  on every system, so a second witness is free on a page that has one: **at the
  time** the three marked pages read 4 of 4, 7 of 7 and 10 of 10 in agreement
  before this and 4, 5 and 7 after it. Two later changes moved those again and
  the live counts are only in "The three marked pages" — 4 of 4, 5 of 5, 9 of 9.

**HEIGHT IS NOT THE SEPARATOR, and the note above `GLYPH_TALL` should not be
read as saying it is.** That note's "accidental 2.15–2.89, notehead 3.67–3.74"
is `tools/key-audit.mjs`'s number, and key-audit measures a box CLIPPED at the
scan's own narrow band and cleaned by a different line test. Measured on the box
`classifyKeyGlyph` is actually handed, **162 of 1331 drawn accidentals stand
over 3.2 spaces and the tallest is 4.63**, because a signature's neighbours
touch and the contiguity walk joins them — against a crotchet's 1.23 to 4.32.
The fourth sharp of a four-sharp treble signature, which the reader READS today,
measures 3.83 where the crotchet that started all this measures 3.75. Four
candidate rules were swept on the same 288 bare staves against the 167 drawn
signatures the reader gets right, counting whole signatures because one refused
glyph refuses the signature:

```
  rule                            real signatures lost   phantom keys removed
  the stem leaves the window            0 of 167              11 of 26     <- shipped
  a sharp must fill the BOTTOM-RIGHT   14 of 167              21 of 26
  a sharp must fill the TOP-LEFT        4 of 167               2 of 26
  all four corners                    102 of 167              26 of 26
  the box taller than 3.4 spaces       18 of 167              10 of 26
  the box taller than 3.7 spaces        8 of 167               6 of 26
```

**Re-measured after the whole round, the residual is 14 of the 288 bare staves**
— the notehead test removes 11 and the truncation rule removes one more. Those
14 are notes whose stem happens to end inside the window: a head on the middle
line with a down stem finishes 1.2 spaces below the bottom line, comfortably in.
Nothing measured reaches them for less than it costs, and **the two-witness rule
is what makes them harmless** — every one of the 14 is a single system, and a
single system can no longer name a page.

**3. `agreeKeyCount`'s LOW QUARTILE WAS THE MINIMUM IN DISGUISE — fixed at four
witnesses, and DELIBERATELY NOT below four.** It indexed
the sorted counts at `floor((n - 1) * 0.25)`, which is ZERO for n = 1, 2, 3
**and 4** — so a page of four systems reading 2, 4, 4, 4 agreed on 2, every
system's band was trimmed to its first two glyphs, and on an E major page the
third and fourth sharps came back as false circles on every system of it. Three
systems out of four had read the truth and the one that had not decided the
page.

It got away with it because of what it was measured on: the three marked pages
are ONE SHARP on every system between them, so the only failure they can show is
over-reading, and the minimum is the perfect statistic for a page that can only
over-read. **That is not evidence about a page in five flats.**

It is now stated as the question it is asking — **what is the largest count that
at least three quarters of the witnesses will support** — which is the sorted
counts indexed at `n - ceil(n * 0.75)`, the honest rounding of the low quartile
rather than a floor that keeps landing on zero. It answers 4 on the E major page
and is unchanged on all three marked pages.

**Be precise about what is fixed: n = 4, not n ≤ 4.** A THREE-system page in E
major reading 2, 4, 4 still agrees on 2 and still puts false circles on two
systems. That is not an oversight — below four witnesses three quarters rounds up
to all of them and this statistic CANNOT be anything but the minimum, so
`MIN_WITNESSES = 4` declares it rather than leaving it to be discovered, and
below the floor the answer is the narrowest reading any system made. **The
minimum is the SAFE direction**: the trim can only ever narrow a band, so
under-counting costs a false circle and over-counting reaches a suppression into
the music and costs a note. The alternative — `Math.max(1, …)` for n ≥ 2 — makes
a two-system page take the LARGER of its two readings, which is the direction
that costs notes, and it is rejected for that.

**The counts that comment used to quote are stale and were re-measured.** It
said Bach 1,1,1,1,4,1,5,3 · Concerto 2,1,1,2,1,4,2,3,1,2 · Scanned
2,2,1,1,1,4,2,2,2. `npm run scan:key-why` now reads a band count of **one on
every system that finds a band at all** — Bach 9 of 10, Concerto 10 of 11,
Scanned 10 of 11. The over-reading those numbers describe was fixed by the band
scan since they were taken, so every statistic — minimum, quartile, median,
mode — returns 1 on all three pages, and **no marked page can currently tell
them apart**. The E major case is a unit test for exactly that reason.

**4. A SIGNATURE THE SCAN CUT SHORT IS NOW DETECTABLE, and the wrong-key count
is zero.** `findKeyBand` reports `why` — what ended the scan — and `cut`, and
`readKeySignature` refuses a cut band before reading a degree off it. **The band
itself is still returned and the suppression still uses it**, which is the
property that keeps `bench` immovable: this changes what is READ, never what is
circled.

**The mechanism is not the one the obvious version of the rule looks for**, and
this is the part worth reading before touching it. All four wrong reads end with
`why = 'speck'`. The next accidental had NOT been measured and rejected — the
photograph had thresholded it down to fragments under `GLYPH_FLOOR`, the scan
stepped over them as grain, and because a stepped-over speck deliberately does
not move `lastEnd`, the adjacency test then measured from the last accidental it
TOOK all the way to the first note of the bar and reported a clean gap. So the
signature ended on the intended terminator while the missing accidental's own
ink sat inside the band the whole time. Hence `lastInk` against `lastEnd`, which
is the honest form of "the ink continues past the last glyph the scan accepted":
it counts the runs the scan LOOKED at, not only the one it broke on.

**Which endings count as cut is drawn where this file already drew the line**,
not at "anything but a blank gap":

`npm run scan:key-read` prints this table itself. Live, re-run this round, over
all 352 drawn scans:

```
  ending    cases   a key would have been read:  RIGHT  WRONG
  gap        236                          146      146      0    kept
  none        34                           18       18      0    kept
  tall        21                            8        8      0    kept
  speck       17                            5        1      4    REFUSED
  reach       28                            3        3      0    REFUSED
  no band     16                            0        0      0    n/a
```

An earlier reading of the same table, kept only because the `SAME_GLYPH` floor
below is argued from the difference: before that floor `speck` stood at **36
cases costing 5 correct reads**, and it is 17 costing 1 now. The other rows have
drifted since as well (`gap` 216, `none` 28, `reach` 35 when that was taken) —
`column()` stopped clipping its measurement in between, which changed what the
scan sees before it decides how to stop. **Read the table above, not the prose
around it.**

`gap` and the height and width tests are the INTENDED terminators — the note
above `GLYPH_TALL` says everything the scan cannot identify stops the signature,
the first note of the bar included — so a signature that ends because the thing
beside it was measured and is not an accidental ended the way the function is
built to end. **Refusing those as well costs eight correct reads and removes no
wrong key at all** (it was seven when the rule was written; it is the `tall` row
above). `speck` and `reach` are the scan giving up mid-signature, and refusing
those two takes the wrong-key count from four to zero.

**AND A SPECK ONLY COUNTS IF IT STANDS FAR ENOUGH OUT TO BE A DIFFERENT GLYPH**,
bounded by `SAME_GLYPH` — reused, not invented, because it is already this
file's answer to "are these two pieces of ink one accidental or two". Without
that floor the rule fires on the accidental's OWN debris: a sharp centred on a
staff line splits into two uprights and the leftover one is stepped over as a
speck sitting almost on top of the glyph that was taken. Measured on the three
marked pages, the specks that fired stood 0.00 to 0.52 spaces out; on the drawn
truncations they stand a glyph's pitch away. The floor is worth **four correct
reads on the drawn corpus and three system readings on the Scanned score, with
all four wrong keys still caught**.

**`reach` had to be asked properly to be worth anything.** The first version
asked "is there ink anywhere out past the limit", which the first note of the
bar answers yes to on a page whose signature is complete — that gated nine
correct reads for nothing. It now asks whether there is ink where the NEXT
accidental would stand, within one glyph's spacing of the last one taken.

**`KEY_REACH = 9` binds on the long signatures and that is now visible**: **28**
of the 352 scans end on `reach` (35 when this was written). Its comment says
"seven flats and slack" while
`GLYPH_WIDE`'s says seven flats is ten spaces of band, and those cannot both be
right. Raising it is a loosening of the band and therefore of the suppression,
so it needs its own measurement against `bench` — see "The next step".

Three questions, and they are answered separately because they fail separately.

**Sharp, flat or natural**, by the two DIAGONAL corners of the glyph's own box.
Width and height do not do it — a sharp measures 1.05–1.27 spaces across and
2.15–2.89 tall, a flat 0.95–1.23 by 2.43–2.62, a natural 0.73–1.08 by 2.31–2.84,
three ranges lying on top of each other. What separates them is where the
strokes reach. A sharp is two uprights the full height of the box, so ink reaches
the top-right corner and the bottom-left one. A flat is one upright on the left
with a bowl on its lower right, so the bottom-left is full and the top-right is
bare paper. A natural's two uprights are offset diagonally, so both those corners
are empty. Measured on 204 real Bravura accidentals at four sizes clean and
photographed, a cut at 0.6 reads 67 of 67 sharps, 70 of 70 flats and 64 of 67
naturals; all three misses are the smallest cell.

**Which degree it stands on**, from the centre of its ink and the clef. The clef
contributes one number — which degree the bottom line is, E for treble, G for
bass, **D for tenor** — and the degree is `(bottom + step) mod 7`. **Deliberately
mod 7**: the octave an engraver writes the fifth sharp in is a convention, tenor
clef inverts the whole pattern to keep it on the stave, and none of that matters
if the check is made on the degree. **That one number was wrong for tenor and
said F** — see the head of this section; deriving it from where the C-clef sits
is the only way to write it that cannot be wrong.

**A FLAT IS READ FROM ITS BOWL AND NOTHING ELSE**, and this is the trap in the
file. A flat's ascender runs about two spaces above the bowl and belongs to no
pitch; the centre of all a flat's ink sits +0.84 half-steps high, which rounds a
flat on a line onto the space above it and turns B flat into C flat. The bowl is
the only part of a flat in the right half of its own box, so the centre of ink
there is the bowl's, and it reads +0.40 ± 0.25. A sharp and a natural ARE centred
on their degree and are read from all their ink, +0.13 ± 0.21.

**Then it is checked against the order, and refused if it does not match.** A key
signature is not a set of accidentals, it is a PREFIX of one fixed sequence:
three sharps are F, C and G and can be nothing else. So the degrees read off the
stave are compared with `SHARP_ORDER` / `FLAT_ORDER`, and anything else returns
null. So does a mixed band, and so does any natural — a natural at the head of a
system is a key CHANGE, which this reader has no notion of, and a cancellation
stands at exactly the degrees it cancels so the order check cannot see it. So
does a NOTEHEAD in the band, and so does a band the scan reports it CUT SHORT,
which are the two refusals added this round. **Wrong is far worse than absent**:
a key read as two sharps on a page in G major puts a semitone on every C for as
long as the reading lasts, and a key read as null puts a semitone on nothing.

Finally the page agrees with itself, **and it needs two witnesses to do it**.

Each system reads its own band; `agreeKey` takes a strict majority of the systems
that read anything, refuses a page where fewer than two read one at all, reports
null when they disagree, and hands back `{ key, systems, read, agreed }` so a
caller can tell "eleven of eleven agree" from "one guessed". Before the witness
floor it could not: a single reader passes a majority test unanimously.

### What it measures

`npm run scan:key-read` draws every signature from seven flats to seven sharps,
in both clefs, at four sizes, clean and photographed, from the real Bravura an
engraver uses — plus a cancellation of each length and a bare C major. **A drawn
key signature is real truth, unlike a drawn notehead**: it is the same glyph from
the same font at the same place on the stave on every printed page there is, and
the three marked pages between them hold exactly one of the fifteen answers.

Re-run this round:

```
  300 of 352 signatures read correctly  (85.2%)

  printed signatures, read right           172 of 224    without the 6.5-pixel cell: 170 of 196
  cancellations, refused as they must be   112 of 112    without the 6.5-pixel cell:  98 of 98
  bare C major, nothing invented            16 of 16     without the 6.5-pixel cell:  14 of 14
  0 read as the WRONG key, 52 refused
  confidence on a correct read: 0.21 to 1.00, median 0.66

  by how many accidentals are printed (the 6.5-pixel cell left out)
    n      sharps        flats
    1     14 of 14      12 of 14
    2     14 of 14      12 of 14
    3     14 of 14      12 of 14
    4     11 of 14      11 of 14
    5     12 of 14      12 of 14
    6     14 of 14      12 of 14
    7     10 of 14      10 of 14

  and where the failures are, by cell — every one of them a REFUSAL:
    treble  9 clean 22/22   12 clean 21/22   16 clean 22/22   22 clean 22/22
    treble  9 photo 10/22   12 photo 13/22   16 photo 17/22   22 photo 22/22
    bass    9 clean 22/22   12 clean 21/22   16 clean 22/22   22 clean 22/22
    bass    9 photo  8/22   12 photo 14/22   16 photo 20/22   22 photo 22/22
```

**One to three accidentals is 42 of 42 sharps and 36 of 42 flats.** That is C, G,
D and A major, F, B flat and E flat major and all their minors — most of what is
printed. Four and up is where it frays, and the failure is almost entirely the
photographed column at a nine- and twelve-pixel staff space.

**The whole of the shortfall is small photographs, not long signatures.** Every
clean cell is 21 or 22 of 22 in both clefs at every size, and the two that are
21 are seven sharps. A page at 22 pixels a space reads 22 of 22 photographed.

Two earlier readings of this table, kept because the argument below is about the
difference and neither reproduces now: **163 of 224 with FOUR wrong keys in
it**, and then **159 with zero wrong** when the truncation rule bought all four.
It is 172 with zero wrong today, the reading having gone UP by thirteen when
`column()` stopped clipping its own measurement. **Read the wrong-key line
first**: it is the only line on which this reader can do real damage, and it has
been zero since. `npm run scan:key-read` also prints a per-ending table saying
exactly which refusals the truncation rule is responsible for and what each was
going to say.

The 6.5-pixel cell is a staff space of 9 PHOTOGRAPHED, which after the camera's
own downscale leaves an accidental five pixels wide with strokes a pixel thick.
The three marked pages work at 9.6 to 12.1 pixels a space and the synthetic
corpus floors at 7, so nothing this reader is asked to read is that small. It is
counted separately rather than dropped.

**TRUNCATION WAS THE ONE DANGEROUS FAILURE AND IT IS NOW DETECTED.** Four of the
224 used to be read as the wrong key and all four were the same shape: the scan
was cut in the middle of a long signature on a photograph, so seven flats came
back as two. **A cut signature is a valid prefix of the real one, so the order
check cannot see it** — that was the one hole in the safety argument above.
`findKeyBand` now reports WHY it stopped, and `readKeySignature` refuses a band
that stopped mid-signature. All four are gone and the cost is measured. See the
head of this section for the mechanism, which is not the one you would guess.

### The three marked pages

All three are ONE SHARP, F sharp, G major or E minor, and all three read it.

**This table is the ONE place in this document that states these counts.** They
appeared in four places at once with three different values in them, all of them
true when written; every other mention now points here. Re-measured for this
document with `node tools/key-probe.mjs "<pdf>"`:

```
  page       clef    found a band   read a key   agreed   the reach it agreed
  Bach       bass       9 of 10       4 of 10    4 of 4      5.20 staff spaces
  Concerto   treble    10 of 10       5 of 10    5 of 5      6.45
  Scanned    treble    10 of 10       9 of 10    9 of 9      6.18
```

**THE DENOMINATOR ON BOTH MOZART PAGES USED TO READ 11 AND IT WAS THE PHANTOM
TITLE-BLOCK STAVE.** Nothing about the key reading changed; a stave that was
never there stopped being counted, so `10 of 11` became `10 of 10` on the same
ten systems. Every system number in this section is one lower than it was for
the same reason, which is worth knowing before comparing against an older copy.

No system on any of the three pages reads a key that is not one sharp. The
witness floor is two, so the margins are 2, 3 and 7.

**Every `cut` these three pages report is a false alarm, and that was checked
rather than assumed** — the first version of this paragraph asserted the
opposite. Every band on every system of all three pages holds ONE glyph, and a
one-glyph signature has no next accidental to be cut off. `npm run scan:key-why`
prints what ended each scan and how far the last run it LOOKED at stood from the
last one it TOOK, which is the number that tells the cases apart. Live, re-run
for this document — the tool lists these under "systems hold a band that is a
PREFIX":

```
  page       system   ended on   gap to the last run looked at
  Bach          6      speck      0.91 spaces
  Bach          8      tall       0.73
  Concerto      2      speck      0.90      <- refused as cut
  Concerto      5      speck      1.02      <- refused as cut
  Concerto      4, 10  gap        (no later run at all)
  Concerto      6      tall       0.60
  Scanned      10      gap        (no later run at all)
```

**Only `speck` and `reach` are refused as cut**, so of these the two the
truncation rule actually costs are the Concerto's systems 2 and 5. The others
are on kept endings and are not read for their own reasons — the Concerto's 4
and 6 return bands 0.40 spaces wide, which is a third of a sharp.

**An earlier reading of this table had the Scanned score's systems 7, 9 and 10
ending on `speck` at 0.41, 0.42 and 0.00 spaces, and the Concerto's two at 1.30
and 1.22.** That is the measurement `SAME_GLYPH` was chosen from and it no longer
reproduces: the Scanned score now has one prefix system and it ends on `gap`.
The mechanism it describes is still the right one to know — a sharp centred on a
staff line loses its crossbars to `onRule` and splits into two uprights, and
where the rejoin fails the leftover upright is stepped over as a speck sitting
almost on top of the glyph that was taken, which is exactly what `SAME_GLYPH`
excludes. At the time, all three of those systems came back, the page returned
to 10 of 10 and the drawn corpus gained four correct reads (155 to 159) with all
four wrong keys still caught.

**The margin this leaves is worth knowing before the next page arrives.** The
witness floor is two and the Bach holds at four — so a page like the Bach that
lost three more systems would lose its key entirely. The Bach is already the
weak one for a different reason (its bands are half a sharp wide; see below).

Nothing on these three pages is a page in any key but one sharp, which is the
honesty problem the drawn corpus above exists to cover: `scan:key-read` is the
only measurement of the other fourteen answers, and two of these three pages are
the same music.

The Bach is the weak one and the reason is visible in `npm run scan:key-why`.
Its ten bands, in system order, re-measured this round:

```
  0.67   1.16   none   0.74   1.15   1.56   1.14   0.57   0.57   0.89   spaces
```

A sharp is about 1.2. So **five of the ten come back 0.57 to 0.89 spaces wide, a
sixth finds no band at all, and only four are a whole sharp** — the shape being
classified on half the page is half a sharp. That is its band scan, not its key
reader. (This paragraph read "six of its ten bands come back 0.57 to 0.89"
before; five do, and the sixth system is the one with no band.)

The division of labour matters and was arrived at by measurement: the shape
tests localise well and judge badly. Six threshold sweeps in a row bought a
point of recall for a point of precision and gave it back, because at a
ten-pixel staff space a notehead and a rest are the same size and shape class.

## The measuring tools, and why each exists

| command | what it answers |
|---|---|
| `npm run bench` | every marked page at once — precision, recall, bars and clefs on the three hand-marked photographs, which are the only real paper in the project. It scores WHERE THE CIRCLE IS and nothing about what the note is called; a reader that found every head and named them all a third out would score 100/100 here. For that, `scan:studies` |
| `npm run scan:truth -- <pdf> --truth <json>` | one page: where every invented and missed head is. **For the `--all` listing and the `by furniture` breakdown, invoke the tool directly** — `node tools/truth-check.mjs "<pdf>" --truth pages/truth/<page>.truth.json --all` — because npm swallows `--all` as its own flag. `--clean` writes a corrected truth file — and APPENDS to its `cleaned` and `removed` fields rather than overwriting them, which it used to do. Its SUSPECT LABELS detector reports FOUR populations: a mark inside a clef band, a mark on the key signature, **a second click on a note already marked** (any pair standing closer together than the radius the same file matches detections with — such a pair can never both be scored, so it is not measuring the reader), and **`title`**, a mark standing further above the topmost stave that READ A CLEF than `findHeads` will ever look. Both of the newer bounds are BORROWED rather than fitted — `near` and `space * 7` — so each flags only marks that cannot be scored either way. **Crop every one before writing.** The nine that came off the Concerto and the Scanned score stood 0.0 to 4.1 pixels apart against a radius of 4.8 to 5.0, so the margin is real but it is not large: a chord in SECONDS puts two heads half a space apart, which is about 5 pixels at those staff spaces, and `--clean` would take one of them without asking |
| `npm run scan:crop -- <pdf> x,y` | LOOK at it. `CROP_MARKS=1` draws heads and bars, `CROP_TRUTH=<json>` adds the marks, `CROP_LAYER=body` shows what findHeads sees |
| `npm run scan:why -- <pdf> x,y` | which test in findHeads rejected a point, and by how much |
| `npm run scan:bar-why -- <pdf> x,y` | the same for barlines |
| `npm run scan:train` | retrain the classifier, cross-page validated. It writes `pages/head-model.json`, **which nothing imports** — installing a fit means pasting BIAS and WEIGHTS into `src/analysis/head-model.js` by hand. None of the three blocks it prints describes the fit that currently ships; see the note at the top of that file |
| `npm run scan:curve` | is the bottleneck data or model capacity |
| `npm run scan:res -- <pdf>` | is the reader resolution-starved (it is not, above 1400px). **Its `space` column is in the RENDERED canvas's pixels, not the reader's** — it climbs to 24.9 at a width of 3600 while `readPage` is still working at 9.6, because `w = Math.min(WORK_WIDTH, naturalWidth)`. Do not read that column as detail reaching the reader |
| `npm run scan:key-why -- <pdf>` | per system: edge, clef, confidence, the key band it found and what ended the scan, which systems hold a PREFIX — and, once for the page, the key it agreed and **how far it agreed its signature reaches**, the one bound in the suppression not measured off the system it is applied to. **Its `furniture` column is a head count inside a fixed 12.6-space zone, not a count of false circles**: that zone holds 18 real hand-marked notes on the Bach, so the totals run an order of magnitude high — live it reads 22 / 12 / 15 on the three pages against a real furniture count of 2 / 0 / 0. Use it to compare systems on one page; for the score use truth-check's `by furniture`. **Its system NUMBERS moved by one on both Mozart pages when the phantom title-block stave went**, so a system named in an older note here is one higher than the one the tool prints now |
| `npm run scan:key-read` | every key signature from 7 flats to 7 sharps, both clefs, four sizes, clean and photographed — plus the cancellations, which must be refused. **Read the WRONG-key line, not the total**: a refusal costs C major and a wrong key costs a semitone on every note of a degree. Also prints what ended each scan and what refusing the cut ones costs. `KEY_DEBUG=1` explains each failure run by run |
| `npm run scan:key-safety` | **THREE blocks now**, and it is the only gate on two separate page-level rules. (1) The one thing the key band is never allowed to do: cover a notehead, which `dropFurniture` then deletes — 768 drawn pages, 2304 heads, music 1.5, 2 and 3 spaces past the signature, with grain and without; **GATED 0 of 1008** on clean paper from two spaces at a size this reader works at, with a space and a half and the 6.5-pixel cell printed and not gated. (2) A whole PAGE: five systems through `readPage` with one signature printed faint, the only way to see the page-agreed reach at all — it fails if the widening never fires (**19 of 33** pages) and gates the DELTA at **0 of 1320**. (3) **The gate for `agreeNoKey`**, 76 drawn pages that PRINT a signature plus bare pages clean, photographed and one-system: `a page WITH a signature that named itself C major 0 of 76` · `a CLEAN bare page of 2 systems or more, silent 0 of 6` · `a bare page of ONE system that named a key 0 of 4`, each failing the build. **`scan:key-read`'s sacred zero cannot see block 3 at all** — that tool draws one stave and calls `findKeyBand` directly, so a two-witness PAGE rule never fires inside it. Three debts printed and not gated: six heads to a fleck of grain at exactly two spaces, thirteen to the band's own scan on the page block, and a photographed bare page staying silent 6 of 6. None is new |
| `npm run scan:corpus` | synthetic pages — the only stand-in for a page nobody marked. Four blocks now: CORE, HARD, SIZES and FEW. Its last line says how many of its 58 pages the **page-agreed key reach** fired on, because that is the one rule in the reader that lets one system's evidence widen another's suppression and a page of bare staves is where it would do damage. It is 0 of 58 |
| `npm run scan:few` | the FEW block on its own: two and three systems, one of them printed faint. The only pages in the corpus where `fillMissedStaves` cannot cover for the stave tracker |
| `npm run scan:sizes` | the SIZES block on its own: one page shape at nine staff spaces from 6 to 28 pixels, clean and photographed, precision and recall for each. The only measurement in the project whose x-axis is scale |
| `npm run scan:studies` | **THE NORTH STAR FOR PITCH.** 32 real cello studies from `~/Downloads/cello-studies`, engraved with real Bravura from their MusicXML and scored NOTE FOR NOTE against what the file says — 692 notes, fourteen key signatures, one voice. **It is the only instrument in the project that asks what the note IS rather than where the circle is**, so it is the only one that can see a wrong clef, a wrong key, a missed accidental or a head given to the wrong stave — and all four have been caught by it and by nothing else. It is also the only corpus with more than one key in it; the three marked pages are all one sharp and two of them are the same music. Live: 692 found, 666 right pitch, `wrong by semitones {}`. Prints the page key and the per-stave key separately — a page of ONE system has no page key by design and the column used to count that as a failure — and scores the printed ACCIDENTALS on their own, because `RIGHT PITCH` is shared between the clef, the key and the accidental. **Read `wrong by semitones` and `WRONG on 0` first**, the way `scan:key-read`'s wrong-key line is read first. `--camera` is a gentle filter that has never moved a digit; **`--phone` is the one that measures a photograph** (0.72 downscale, blur 1px, contrast 0.62, JPEG 0.6 — the same spoiling `scan:key-read` uses) and **nothing runs it automatically**, which is item 1 of "The next step". `--space N` sweeps size, `--dir <name>` narrows to one study, `--keep <dir>` writes the engraved pages out, `FORCE_CLEF=` re-reads the same music in another clef |
| `npm run scan:align` | **WHICH NOTEHEAD DID THE TAKE LAND ON** — the first measurement of the ALIGNMENT rather than of the reader. The same 32 engraved studies, but the take is SYNTHESISED FROM THE MUSICXML (dropped notes, inserted squeaks, the odd wrong note, a start somewhere other than the top of the page, seeded so before and after see identical playing) and the reference is what the reader read off its own engraving. "The right notehead" is settled by the engraver's own coordinates, before any pitch is consulted, so this cannot be gamed by a reference that is wrong in the same places as the take. Prints BEFORE and AFTER in one run: the AFTER reference is the shipped `headsOf`, the BEFORE is that same output re-priced through `pitchOf(step, clef, NO_KEY)`, which is character for character the line that used to be in it. Read the SECOND rollup — the takes that stayed on the pitch route — and the count of takes that dropped to the contour route, because a change here moves the ROUTE as well as the quality. **Its pages are ONE TO THREE SYSTEMS long**, which is the shape `agreeKey` cannot get a quorum on, so a page-level key rule shows up here as an alignment result unless the route column is read. `--real` is the companion for the three photographs: no pitch truth exists for them, so it counts COVERAGE only — how many heads reach the aligner with a pitch on them at all — which is the way this change can hurt a real page, because an unpriced head is dropped from the aligner's window. `--takes N`, `--seed N`, `--only <name>`, `--phone` (**run it — the clean numbers and the photographed ones point opposite ways**), `--json` |
| `npm run scan:bars` / `scan:clef-hard` | synthetic, with real truth |
| `npm run scan:clef` | THREE blocks. The first two are the clef at the head of a system — the classifier against a column this file samples, then the same thing through `readPage`. The third is a **clef printed part way along a system**, scored NOTE FOR NOTE on pitch, with a paired control and — the part that matters — **twenty-four pieces of furniture printed where the clef would be, clean and photographed, on which the count of clef changes found MUST BE ZERO**. Accidentals on each of the five lines, a repeat barline, a chord of thirds, and the rest. It **fails the build** on a false fire and on a note named wrong on a page whose change it found; a change it MISSES is printed as a DEBT line instead, because that is the reader as it was. It also carries its own copy of the clef-to-MIDI arithmetic and refuses to run if the self-check disagrees — that table has been written wrong twice in this project |
| `npm run scan:steps -- <pdf> --truth <json>` | **THE STEP, ON A REAL PHOTOGRAPH.** For each hand-marked notehead it finds the PRINTED staff lines around it from the ink alone — no comb tracked across the page, no curve fit, no reader model — and says which line or space the mark is on. It is the only instrument that can see a stave model that has drifted off the print, which a residual test cannot: if the whole model is a step out the heads still land neatly on ITS lines. `--known pages/truth/bach.pitch.json` scores the HARNESS against steps taken from the music (25 of 32, and it prints that before it says anything about the reader — do not trust a step number from a harness that has not self-scored). Prints per system how far the model sits from the print, in steps, and which of the wrong steps that explains. `STEP_DRAW=3,7,11` writes one magnified crop per mark with the lines it found in green and the model in red |
| `node tools/stave-look.mjs <pdf> --at x,y [--zoom 8]` | draws the reader's five model lines on the page, magnified, in red. The house rule made runnable: a pitch is measured FROM THE LINES, and the only way to see a model that has parted company with the print is to draw it |
| `npm run reader:mark` | the marking tool still works |
| `npm run scan:spread` | the camera scanner: a book spread comes back as two pages |

**WHICH OF THESE ACTUALLY FAIL A BUILD, because "it is measured" and "it is
gated" are not the same claim and this document has confused them before.** Only
three commands here have a must-be-zero line that exits non-zero:
`scan:key-read` (any key read as the WRONG key), `scan:key-safety` (five lines
across its three blocks — the band eating a head, the widening putting a head in
a suppression, and `agreeNoKey`'s three), and `scan:clef` (a false clef-change
fire, and a note named wrong on a page whose change was found). **`bench`,
`scan:studies`, `scan:steps` and `scan:corpus` gate nothing** — they print, and a
human reads them.

**AND THAT IS EXACTLY HOW A WHOLE-STEP OFFSET LIVED ON THE BACH PAGE FOR
ROUNDS.** Everything this document says about naming a note on CLEAN paper rests
on `scan:studies`, and everything it says about naming one on a PHOTOGRAPH rests
on `scan:steps` and on `scan:studies --phone` — a harness that did not exist
until the pitch round, and a flag somebody has to remember to pass. Neither
gates anything, and `scan:steps` cannot become a build gate as it stands because
it needs a page with hand marks on it and there are three of those in the world.
**So it is a discipline instead: run `scan:steps` on all three pages whenever
anything upstream of the step moves** — `trackCombs`, `stavesToLines`,
`fillMissedStaves`, or where a head's own centre is taken. Nothing else in the
repo can see that class of bug.

**Every real bug in this reader was found by looking at the page. Every dead end
came from reasoning about what the code probably does.** `scan:crop` and
`scan:why` are the two that pay for themselves fastest.

## The key signature reached the aligner, and what that cost

`headsOf` in `src/ui/scan-view.js` — the one function that turns a read page
into the reference the aligner is handed — priced every notehead with
`pitchOf(note.step, note.clef, NO_KEY)`, under a comment saying "NO_KEY until
the signature detector lands". It landed several rounds ago. `notesInOrder`
had been returning a fully priced `midi` (the clef in force at the head's own
x, the page's agreed signature, and the accidentals of the head's own bar
through `applyAccidentals`) and `headsOf` threw all three away and recomputed
a worse one. The bug was in `headsOf` and nowhere deeper; the fix is a
deletion, `midi: note.midi ?? null`.

Nothing in the repo could see it, because nothing measured the alignment.
`npm run scan:align` was built for this and is the number:

```
                                       right head   WRONG head   unmarked   pitch route
  every take            BEFORE            93.3%         162          18       128/128
                        AFTER             91.3%         118         115       120/128
  the takes that        BEFORE            93.3%         156          17       120/120
  stayed on pitch       AFTER             94.8%         118          15       120/120
```

2672 played notes per side, 128 takes, 32 studies, seed 11. It reproduces on a
second seed — `--seed 29` gives 96.4% -> 97.5% and 78 -> 52 wrong heads — and
**the misplacement count is the robust half**: the percentage moves a point
either way with the seed, the drop in wrong heads is -24% and -33%. A quarter of
the misplacements gone on the takes that were aligned either way, and the
misplacement histogram says why: the `-1` column falls 68 to 51 and `-2` falls
18 to 8, while `+1` barely moves (41 to 42). **The gain is not the semitone
being repaired for its own sake** — `alignScore` runs with `nearMiss`, so a
semitone already cost 0.6 and not 1.4. It is that a reference wrong on three
degrees out of seven stops telling one head from its NEIGHBOUR, so a dropped
note or a squeak slides the whole path by one and nothing pulls it back.

**AND IT COSTS SOMETHING, WHICH IS THE HALF WORTH READING.** `NO_KEY` has an
`alter` array, so under the old line every head with a readable clef got a
confident pitch and **no page ever took the contour route for want of a key**.
Now a page whose signature cannot be established prices its heads null, and
`pairNotes` drops it to contour — which on those pages refuses outright, no
marks at all. That is 8 of the 128 takes, and it is exactly the two studies that
PRINT NO SIGNATURE and have a SINGLE system (`C-major-arpeggio`,
`A-minor-arpeggio`), where `agreeNoKey` wants more than one witness before it
will call a page bare. Those two were being answered correctly BY ACCIDENT: C
major is what `NO_KEY` happens to be. Across all 128 takes that reads as a fall
from 93.3% to 91.3%, and those two pages are the whole of it.

Rule 5 says that is right — a key nobody read is unknown, not C major — and the
repair, if anybody wants those pages back, belongs in `agreeNoKey` on a
one-system page and **not in a default in `headsOf`**.

**AND ON A PAGE THE READER STRUGGLES WITH IT IS MUCH WORSE THAN THAT.** This is
the number to read before believing the change is safe everywhere.
`npm run scan:align -- --phone` spoils the same studies the way
`scan:key-read` spoils its signatures, and most staves then fail to read their
signature at all:

```
                                       right head   WRONG head   unmarked   pitch route
  every take            BEFORE            95.9%          30          71       128/128
                        AFTER             65.3%         119         728        88/128
  the takes that        BEFORE            95.7%          22          50        88/88
  stayed on pitch       AFTER             81.1%          17         299        88/88
```

Read the BEFORE column with the denominator in mind before concluding that a
photograph is easier than clean paper: `scorable` leaves out the notes whose
head the reader never found, and on `--phone` it loses far more of them, so the
hardest played notes drop out of the denominator (2439 scorable against 2672,
and 23 of 64 squeaks ringed against 53 of 64).

The mechanism is not the null itself, it is what `alignByPitch` does with one:
**an unpriced head is FILTERED OUT of the aligner's window**, so a page where
only SOME staves read a signature hands the aligner a reference with holes in
it, and every note played over those systems has nowhere to land.

**THAT FILTER HAS SINCE BEEN REMOVED — degrade instead of delete — and most of
this collapse comes back.** The head now STAYS in the window carrying
`midi: null`, and `align-score.js` charges `COST.unpriced` to sit a played note
on it, so an unreadable system absorbs its notes positionally instead of
closing up and shifting everything around it:

```
                                       right head   WRONG head   unmarked   pitch route
  every take            deleted           65.3%         119         728        88/128
                        degraded          72.9%         177         483        88/128
  the takes that        deleted           81.1%          17         299        88/88
  stayed on pitch       degraded          92.3%          75          54        88/88
  the same, --seed 29   deleted           81.3%          32         282        88/88
                        degraded          93.8%          61          43        88/88
```

The denominator is IDENTICAL either side — 1673 scorable played notes over the
same 88 takes on the same route — so this is not the `scorable` artefact the
paragraph above warns about. **The plain run does not move at all**: 91.3%
(2439/2672), 118 wrong, 115 unmarked, 120/128 on the pitch route, digit for
digit, on both seeds. On clean paper a page either reads its key and prices
every head or reads none and takes the contour route, so there is almost no
half-priced reference for the window to keep.

**The constant is not where the result comes from, and the sweep says so.**
Every value in the legal window (0.6, 2.0) buys eight to eleven points over the
filter and the spread WITHIN it is 88.9% to 92.3%, not monotone: 0.65 reads
90.9%, 0.70 reads 92.3%, 0.80 reads 88.9%, 1.00 reads 89.8%, 1.40 reads 91.5%,
1.80 reads 91.9%. 0.70 ships because it is the best cell on BOTH seeds and 1.00
is the worst on both, which is the only ordering that reproduces. Under 0.6 an
unreadable head would outbid a head that WAS read and agrees to a semitone; at
2.0 the path steps around the hole exactly as the filter did. The full table is
above `substitutionCost` in `align-score.js`.

The 40 takes that never reach the pitch route are NOT touched by this and must
not be read as if they were — their pages priced no head at all, so `pairNotes`
sends them to the contour route whatever the window does, and they are the whole
of the remaining gap between 72.9% and the 95.9% a C-major assumption bought.
That is `agreeKey`'s quorum on a one-to-three-system page.

Its verdict comes back **`'unpriced'`** — its own word, never `match`, `near`,
`wrong` or `octave`, so a head the page could not read is counted as evidence
neither for the player nor against them, and it is excluded from the wrong-piece
floor's denominator as well.

**And the flip fails in two OPPOSITE ways depending on the page, which is the
part to carry forward.** On clean paper the flipped takes refuse outright —
`findStart` is not sure, no marks at all, `0.0%` and 50 unmarked. On a
photographed page it is not sure enough to refuse: `pairByShape` runs, and the
wrong-head count on the flipped takes goes from **8 to 102** (subtract the kept
rollup from the every-take one: 30 - 22 against 119 - 17). `A-minor-scale`,
`B-minor-scale` and `C-major-thirds` alone ring 26, 26 and 38 wrong
noteheads. So the contour route is not a safe place to land a page whose key
went unread — it is quiet on one kind of page and loud on the other.
**Degrading instead of deleting is the obvious next move** — keep an unpriced
head in the aligner's window rather than removing it — and it is a change to the
WINDOW, not to `headsOf`, and must be measured on its own.

**What saves the real pages is the PAGE-AGREED key, and that is measured rather
than hoped.** `npm run scan:align -- --real` counts, on the three marked
photographs, how many heads reach the aligner with a pitch on them at all — no
truth file needed, a head is priced or it is not:

```
  page       staves  clefs  staves w/ key  page key   heads   priced NO_KEY   priced from the read key
  Bach           10     10           5/10   1 sharp     324             324                        324
  Mozart         10     10           5/10   1 sharp     335             335                        335
  Scanned        10     10           9/10   1 sharp     439             439                        439
```

**Not one head lost on any of the three.** Half the staves cannot read the
signature for themselves on two of these pages, and it does not matter: the page
agrees one sharp off the five that can, and `notesInOrder` prices every head
off the page's answer. The `--phone` collapse is a property of pages of ONE TO
THREE SYSTEMS, where `agreeKey` cannot get a quorum — which is the shape of the
study corpus and not the shape of a photographed part.

What did NOT move: `npm run bench` (98.9 / 94.1 / 96.4 F1, mean 94.9 precision
/ 98.1 recall), `npm run scan:key-read` (**0 read as the WRONG key**, 52
refused), `npm test` (all passing, with three new guards on `headsOf` in tests/scan-pair.test.js).
None of those three can SEE `src/ui/scan-view.js` — nothing in their import
graph reaches it — so they are quoted as "unmoved by construction" and not as
evidence about the change. `scan:align` is the only instrument that can see it.
And across the 32 studies the reader read 42 stave signatures right, 0 wrong,
8 unread — the 8 are the bare pages — so no page in this measurement was
aligned against a MISREAD key.


## Retraining the classifier

Any change to the shape tests changes which candidates exist, so the model must
be retrained against the new distribution or it is judging something it has not
seen:

```
npm run scan:patches     # dump candidates + labels (runs with the judge OFF)
npm run scan:train       # cross-page validation, writes pages/head-model.json
```

then copy the weights into `src/analysis/head-model.js` — BIAS and WEIGHTS only.
`npm run scan:patches` must run with `judge: false` or each round trains on the
survivors of the last and the model eats its own tail.

**`npm run scan:train` cannot change how the reader behaves, and it is worth
knowing that before running it.** `pages/head-model.json` is written by that
command and imported by nothing — `grep -rn head-model` finds only the trainer
writing it. The reader imports `src/analysis/head-model.js`, whose BIAS and
WEIGHTS are pasted in by hand. So the two files disagreeing is not a bug to be
tidied up, and running the trainer is free.

**It also overwrites `pages/patches.json`'s companion silently**, and one
overwrite has already cost this project a measurement it cannot get back: the
two-page dump the shipped weights were fitted to no longer exists, so the
shipped model's held-out figures can never be re-derived. If a dump is going to
be replaced, copy the old one somewhere first.

**Pick the threshold from the cross-page table, never from `bench`.** The bench
reads its best at cut 0.7; on a held-out page 0.7 throws away a fifth of the
notes. It is 0.4 — `HEAD_CUT` in `scan-read.js`, checked this round.

**AND THAT PROCEDURE IS NOT SUFFICIENT — IT HAS BEEN FOLLOWED EXACTLY AND THE
RESULT COULD NOT BE SHIPPED.** Read this before running it again.

- **The shipped weights are deliberately older than `pages/head-model.json`.**
  Do not reconcile them by copying. `src/analysis/head-model.js` carries the
  whole story at the top and the numbers are in the dead-end entry below.
- **`STEM_CUT` is on the same score scale and the cross-page table cannot see
  it.** `scan:patches` dumps with the judge off; `stemHeads` only runs with the
  judge on; so no stem-pass candidate has ever been in `pages/patches.json`.
  `STEM_CUT = 0.95` was read off `bench`, sits in the extreme tail of one
  particular model's scores, and a refit moved 22 real notes out of the Scanned
  score's stem pass. **A retrain is not shippable until that constant is
  page-relative or gets a held-out measurement of its own.**
- **A refit is not a small perturbation, and the reason is the negatives.** The
  optimiser is converged — 3000 steps against 12000 on identical data moves the
  weights by 0.30 against a vector norm of 6.10 — but re-dumping the candidates
  moves them by 1.83. Every kept head is re-centred on its ink now, so 132 of
  the Bach's 365 rows and 158 of the Mozart's 448 come back different, and the
  false candidates the last round's fixes removed were the HARDEST negatives:
  median score 0.088 under the shipped weights against 0.048 for the ones that
  remain. **A shape test that gets better at rejecting a false circle deletes
  the example that taught the classifier to reject it.**
- **Fit the old pages over the new dump before blaming a new page.** It is two
  experiments at once otherwise, and here the two halves land in different
  places: the re-dump alone costs `bench` a point through the stem pass, and the
  corpus loosening (CORE 119 to 190 spurious heads) belongs entirely to the
  third page — two pages over the new dump reads 111.
- **Check the whole reader, not just the table.** `npm run bench`,
  `npm run scan:corpus` and `npm run scan:sizes` all moved on a change whose
  cross-page columns every one improved.

## What is NOT built

~~**Naming a pitch.**~~ and ~~**an accidental standing against a single
notehead**~~ **are BUILT** and both used to head this list. `pitchOf` turns step
+ clef + key into a MIDI number, `accidentalFor` reads the glyph in front of the
head and `applyAccidentals` binds it to the rest of its bar. Measured on 692
notes of real cello repertoire: **666 right, 26 unpitched, 0 wrong**, and 30 of
30 printed accidentals found and named with none invented on the other 662. What
is left is below.

- **More than one voice on a stave, and a piano score.** Nothing has ever been
  measured on either. **Do not read the clef work's false-fire block as
  evidence** — its twelve hard-cases pages include chord stacks, two voices and
  grand staves and the mid-system clef detector fires on none of them, but that
  is a statement that one detector stays quiet, not that the reader reads the
  page. There is no ground truth of any kind for a second voice: `bench`'s three
  pages are single-stave parts and every one of the 32 studies is one voice.
- **A key CHANGE mid-page**, and a signature of naturals is refused rather than
  read for exactly that reason — see "Reading the key signature". A cancellation
  is 112 of 112 correctly REFUSED in `scan:key-read`, which is the safe half of
  the answer and not the whole one.
- **A mid-system change to BASS or TREBLE.** A C-clef is read (see below), which
  is the change a cello part makes most, and the other two are not: their notes
  stay named in the clef the system began in, silently. The waist test that
  finds a C-clef cannot be loosened into them — only a C-clef is symmetric about
  the line it names — so they need a different discriminator, and two candidates
  are already dead in "What is measured and does NOT work".
- **A clef-shaped-ink test.** The clef band is only suppressed where `scan-clef`
  could NAME the clef, and that conditional is load-bearing (below). What would
  lift it is a test for a tall confident glyph in the band, which is furniture
  whether or not the classifier can say treble from bass. The obvious candidate
  does not work: `clefFeatures` already discards the staff lines, and a notehead
  with a stem measures about three and a half spaces against `SHORTEST`'s one
  and a half, which is exactly why the unconditional drop cost what it did.
  **`midClefAt` is now a test of this kind and it is NOT the missing one.** It
  answers "is this a C-clef" and it refuses treble and bass by construction, so
  it cannot decide whether a band holds furniture — see the section on the
  mid-system clef for what it does and what it deliberately does not.
- **The time signature.** A first system prints one immediately after the key
  signature and `scan-key.js` has no notion of it. Measured, the common-time C
  is 2.18 spaces wide against a sharp's 1.14–1.35, so it is separable — but it
  is now REJECTED by `GLYPH_WIDE` rather than swept into the count, which means
  it is no longer suppressed either. The price of the ceiling is a false circle
  or two on the Scanned score's FIRST system — numbered 2 before the phantom
  title-block stave went and renumbered that page. **Be careful what is measured
  there and what is a hand reading**: `truth-check --all` prints three invented
  heads on that system today, at (263,382), (275,316) and (497,357), and it says
  only what the ink under each is arranged as — `stem`, `other`, `stem-foot`. It
  does not say which glyph is which. The identification of (263,382) as the
  common-time C is an older crop, not something the instrument re-asserts every
  run; crop it before quoting it as the time signature's cost.
- **A GATED measurement of PITCH on a photograph.** `scan:studies` scores 692
  notes note-for-note and `scan:studies -- --phone` spoils them the way a camera
  does, but no check runs the second one and nothing fails a build on it — which
  is how two wrong stave keys and eight wrong pitches came to be findings rather
  than red lines. Every gated pitch number in this document is a CLEAN-PAGE
  number. This is item 1 of "The next step" and it is the largest hole in the
  measurement rather than in the reader.
- **Note values beyond beam counting** — rests, dots, ties, tuplets. And beam
  counting itself collapses on a small photograph: 100% at a working staff space
  of 14, 92% at 12, 49% at 8, 10% at 6, while recall stays above 93% throughout.
  Every note found and given the wrong length.
- ~~**Mid-system clef changes.**~~ — **A C-CLEF IS NOW READ**, which is the one
  a cello part changes to. See the section below, and the bass/treble bullet
  above for what is still missing.
- **Handwriting, and any page not already in the repo.** Every page this reader
  has been measured on is engraved: three printed pages, 32 pages this project
  engraved itself from MusicXML, and a synthetic corpus drawn by the same tool
  that scores it.
- **Barline ground truth.** The counts in `bench` are counts, not accuracy.
  This is how the barline failure hid for a day: every number went to noteheads.

## Known broken

- **ONE NOTE IN TWELVE IS NAMED A SECOND WRONG ON REAL PAPER, AND UNTIL THIS
  ROUND NOTHING MEASURED IT.** `npm run scan:steps`, run for this document:
  229 of 248 on the Bach, 210 of 230 on the Concerto, 279 of 301 on the Scanned
  score — 92.3%, 91.3%, 92.7% of the marks the harness can score, against a
  clean-page figure of 96.2% for the whole NAME. A wrong step is a wrong note.
  **Where the remaining error lives is known on one page and unknown on two**:
  13 of the Bach's 19 are the two systems `fillMissedStaves` invents rather than
  tracks, and **0 of the other 42 are the stave model at all** — see item 0d of
  "The next step". This entry exists because the failure it names was invisible
  to `bench`, which read 98.8 / 99.7 on the page whose first bar was a second
  wrong.
- **A MID-SYSTEM BASS CLEF IS NOT READ, AND THE NOTES AFTER IT STAY SILENTLY IN
  THE CLEF THE SYSTEM BEGAN IN.** A C-clef and a treble are read; the F clef that
  brings a cello part back DOWN is not, and no refusal fires — the pitches are
  confident and a ninth out. Live: **129 notes on `npm run scan:clef`'s debt
  line** and **72 of `npm run scan:clef-change`'s 86 wrong pitches**, 68 of them
  beyond what the controls get wrong by themselves. It is not a constant waiting
  to be loosened — 58,411 windows say no rule the clef column can express
  separates a bass clef from a sharp, and the round that measured that deleted
  the function which pretended to (*The record on `20e004d`, corrected*).
- **AT PHONE QUALITY THE PITCH LARGELY STOPS WORKING, AND THAT IS THE HEADLINE
  OF THIS WHOLE SECTION.** Re-run for this document, `npm run scan:studies --
  --phone` against the clean run of the same 692 notes:

  ```
                        clean    --camera   --phone
    notes found       692/692    692/692    631/692
    RIGHT PITCH           666        666        378   54.6%
    no pitch at all        26         26        245
    page key right   18 of 32   18 of 32    5 of 32   WRONG on 0 in all three
    stave key right  42 of 50   42 of 50   29 of 50   WRONG on 0, 0 and TWO
    wrong by semitones     {}         {}   {1:2, 2:3, -1:3}
  ```

  A 14-pixel staff space arriving as 10 is not an unusual photograph, and at it
  the reader still FINDS 91% of the notes and names barely half of them. **Almost
  all of the loss is the key signature**, not the noteheads: 245 notes come back
  with no pitch at all because their page could not read one. Every other entry
  below is a piece of this one. `--camera` is identical to clean in every field
  and always was, so nothing in this document that quotes it is evidence about a
  photograph.
- **AT PHONE QUALITY, TWO OF THE STUDIES READ A WRONG KEY — the only wrong key
  anywhere in this project's measurements, and it is NEW.** `npm run scan:studies
  -- --phone` (0.72 downscale, blur 1px, contrast 0.62, JPEG 0.6 — a 14-pixel
  staff space arriving as 10) reads `stave key right 29 of 50, WRONG on 2`, and
  eight notes come back a wrong pitch: `wrong by semitones {1:2, 2:3, -1:3}`.
  The two are `Bb-major-scale` and `Eb-major-scale`, two flats and three flats,
  printed by the tool as `1/2!`. Clean and `--camera` are 0 wrong at both levels
  with `wrong by semitones {}`. **The page level held**: `page key right 5 of 32,
  WRONG on 0`, so `agreeKey`'s two-witness floor refused every page and the
  damage lands only where the page cannot agree and `notesInOrder` falls back to
  `staff.key`. Nothing gates this — `scan:studies` is not run with `--phone` by
  any check, and `scan:key-read`'s sacred zero is a different corpus. **It is
  item 1 of "The next step"** — first on that list because it is the only
  confidently wrong answer in the project and it fires on the only input the app
  ever gets.
- **A NOTEHEAD WITH AN ACCIDENTAL TOUCHING IT DISAPPEARS ON A PHOTOGRAPH.** The
  newest of these and the cheapest remaining pitch win on real music. At
  `npm run scan:studies -- --phone` — a 14-pixel staff space arriving as 10 —
  **61 of the 692 heads are lost and 28 of the 61 are among the 30 that carry a
  printed accidental**: 4% of the notes taking 46% of the losses, with no
  detection of any kind within a staff space of them. It is not the accidental
  MODEL: it reads 2 of 2 of the survivors right and invents none on 629, so a
  retrain has no glyph left to judge. Four causes are ruled out by patching one
  string in the served module (`open`, `HEAD_CUT`, the `fill` floor, the
  sideways-run bound) and so is `dropDoubledHeads`; the control that makes it a
  finding rather than a correlation is engraving the same notes at the same size
  with the accidental glyphs SUPPRESSED, which brings all five missed heads on
  `A-minor-scale` back. Table and method under *The accidental reader is not the
  bottleneck*. It is a `findHeads` question.
- **`applyAccidentals` IS SILENTLY WRONG ACROSS A CLEF CHANGE.** It keys its
  in-force map by `step`, which is right within one clef — an accidental binds
  the line it is written on, not the letter — and wrong in both directions once
  the clef changes mid-bar: an accidental printed before the change carries to
  the wrong note, and a note at the same PITCH on a new line loses one it should
  keep. It needs an accidental and a clef change in the SAME BAR, which is why
  neither fixture can see it: the mid-system clef pages print no accidentals in
  that bar and the furniture pages print accidentals but no clef change. **That
  is the row to add to `scan:clef` first**, and it is the first bullet of item 5
  of "The next step".
- **A mid-system clef is still CIRCLED**, as up to two false noteheads where
  `findHeads` mistakes it for one — measured at 0.6 em and 1.0 em, not at 0.75 or
  0.9. Suppressing it changes what is circled, which the round that added the
  detector was constructed not to do. It is the only part of the mid-system clef
  work that can move `bench`.
- **`photo10` in `scan:sizes` finds SEVEN staves on a six-system page, and two of
  them are one system tracked twice.** Staves 0 and 1 span y 65–189 and 95–225 at
  a staff space of 9.7 — overlapping by more than either stave is tall — and
  stand 30px apart where that page's real system gap is 157–161. It costs that
  row **14 points of precision** — 86% against 99–100% on every other
  photographed row, re-measured for this document.
  `dropDoubledHeads` **steps around it rather than
  laundering it into a pitch** — it refuses to arbitrate between two staves that
  overlap, because "whose lines are nearer" names nothing there, and without that
  guard SIZES fell 89 to 88 and three notes' beam counts moved by picking between
  two wrong descriptions. This is a different bug from the phantom stave on bare
  paper: this one sits ON the real system. It is the same failure class the
  curve-score test was written for and it survives at three fifths — see "How big
  is the page", where the phantom is dumped: a 19-strip curve medianing 0.633
  beside a real system at 0.783, so no absolute floor reaches it either.
- **`tools/reader-look.html` DESTROYS THE RECORD OF WHY A DENOMINATOR IS WHAT IT
  IS.** It builds its truth object from scratch on save — `source`, `width`,
  `height`, `space`, `marked`, `notes`, `rejected` — so one save over any of the
  three truth files silently drops `cleaned`, `removed` and `added`, which is the
  whole account of the 70 marks taken off and the 13 put on. `--clean` in
  `truth-check.mjs` was made to APPEND for exactly this reason; the marking tool
  has not been. Save to a new name and merge, or teach the tool to carry the
  three fields through.
- **A PHOTOGRAPHED page in C major still names no note.** The clean page does —
  see "A page that prints no key signature now names its notes" — but on a
  photograph the camera smears the clef, the overhang walk steps further right,
  and the first note of the bar then stands inside `KEY_ADJACENT` of where the
  key scan starts, so the scan ends on the note (`wide` or `tall`) instead of on
  clean paper and the page is refused. 6 of 6 drawn photographed bare pages; the
  ending is `gap` again once the music stands 8 spaces clear. `npm run
  scan:key-safety` prints it as a debt line every run so it cannot grow
  unnoticed. **The refusal itself is correct** — there IS ink where a signature
  would be and the reader cannot name it — so the fix is to measure where the
  clef ENDS, not to widen what counts as bare. Note the studies' own `--camera`
  filter is far gentler than `key-safety`'s spoil path and does not reproduce
  this at all, which is a reason to trust the harsher one.
- ~~**System 1 on both Mozart pages is a stave that is not there.**~~ —
  **FIXED.** `fillMissedStaves` extrapolated one system ABOVE the first real one
  (`scan-read.js`, the `wanted` loop) and landed on the page's title block: on
  the Scanned score it drew 21 noteheads on printed type — the É of CARATGÉ, the
  o of Solo, five on W. A. MOZART — and on the Concerto 3. `floor = 0.05` is
  what admitted it, thirteen times below the faintest honest stave on the same
  photograph. **The floor now asks the page**: a fifth of the low quartile,
  across staves, of the low quartile across strips of what the page's own
  tracked staves score, combined with `Math.max` so the bar can only ever rise.
  Both phantoms go, `clefs` reads 10/10 on both pages instead of 10/11, the
  corpus is BYTE-IDENTICAL across all 49 rows, and `bench` reads Concerto
  92.0/95.1 → **92.9/95.1** and Scanned 89.7/99.5 → **93.4/99.5**, recall flat to
  the digit on all three pages. It was written and measured three rounds
  earlier and reverted every time because twelve of the phantom's heads matched
  marks somebody had put on the composer's name; those thirteen marks are now
  off the file and `truth-check.mjs` reports such a mark as `title`.
- ~~**A FOURTH CONTAMINATION IN `pages/truth/scanned.truth.json`: marks standing
  on a bare stem where it crosses a staff line.**~~ — **SWEPT.** The entry named
  two, at (754,521) and (1129,1332), and said "at least two". It was nineteen:
  eleven on a bare stem, six on blank paper, two on a slur, found by cropping
  every one of that page's twenty-three missed notes at 6x with `CROP_MARKS=1
  CROP_TRUTH=…` rather than by sampling. All nineteen are off the file and
  recorded in its `removed` field. **No detector was built for them and one
  should not be built lightly**: the test that would find them — no head-shaped
  ink under the mark, a real head within a space and a half on the same stem —
  is a test the READER would also have to pass, so it can only ever agree with
  the reader, which is the thing a truth file exists not to do. Cropping the
  missed column is cheap and answers it.
- ~~**`pages/truth/scanned.truth.json` is contaminated four ways over**~~ —
  **ALL FOUR DISCHARGED.** 13 marks on the key-signature sharps (gone, earlier
  round), 13 on the title block (gone, and now detected as `title`), 19 on bare
  stems and blank paper (gone), and the one that ran the other way — **the
  ledger notes above the stave were largely NOT MARKED**, which punished the
  reader for being right. Thirteen printed heads have been added, each cropped
  first, each placed at the ink's own centroid rather than at the reader's ring.
  The falsification test is at the top of this document: the Concerto prints the
  same passage x for x and marks every head of it.

  What is LEFT on that page is two marks and it is not contamination: 647,1191
  and 1304,1350 are real notes marked 0.67 and 0.56 of a space off their own
  centres, so each scores as a missed note and an invented head at once and no
  change to the reader can move either. They were deliberately not nudged. See
  the top of this document for why.
- **Invented heads on the harder two pages — no longer mostly furniture.**
  Re-measured this round with `truth-check --all`:

  ```
                          Bach   Mozart   Scanned
    invented, total          6       37        40
      proposed by shape      5       37        26
      proposed by the stem   1        0        14
      standing on furniture  2        1         3
      out in the music       4       36        37
    the stem pass alone   1 real   4 real   48 real
                        1 invented 0 inv   14 invented
  ```

  This entry used to say "45 invented heads per page on the harder two" and "19
  of 45 come from the stem pass" on the Scanned score. Neither reproduces: it is
  37 and 40, and the stem pass's share is **14 of 40**. What has NOT changed is
  the shape of the problem — the stem pass on that page buys 48 real notes for
  14 false ones, which is why no filter on it has ever been worth shipping (see
  "What is measured and does NOT work").

  **The table above is AT THE TIME; the live one is this**, after the truth
  repair and the phantom stave:

  ```
                          Bach   Mozart   Scanned
    invented, total          4       24        29
      proposed by shape      3       24        11
      proposed by the stem   1        0        18
      standing on furniture  2        0         0
      out in the music       2       24        29
    the stem pass alone   1 real   4 real   44 real
                        1 invented 0 inv   18 invented
  ```

  **Nothing on the Scanned score stands on furniture any more**, which is what
  the phantom going bought: the seven letters of the title block that used to
  carry a ring are the whole of the difference between 40 and 29 that is not a
  mark being added. **The 29 that remain are, by `BY SHAPE OF ERROR`, 26 in a
  stem, 1 on a beam and 2 on ink of some other shape** — the eighth rest at
  146,685 and the A of Allegro at 275,316. A THIRD piece of printed furniture,
  the common-time C at 263,382, is counted in the 26 rather than here, because
  the ink under it is a thin vertical run and the instrument answers about the
  ink and not about what the glyph is. The
  26 are the population four one-head-per-stem rules have died on, and the ratio
  that killed them is now **22 invented against 146 correct**, which is not a
  better ratio than the one that killed them.

  What the crops found, still true as a characterisation: on the Mozart, 11 of
  20 examined are the compact blob left where a stem meets a beam, 4 are rests,
  and the rest are ornaments, a dynamic and the letters of the printed title. On
  the Scanned score the stem-pass phantoms sit just outside the suppression box
  of a head the pass was not allowed to touch.
- ~~**`downStems` in the corpus reads 0 of 120 notes**~~ — **FIXED.** It now
  reads 97% of its 120 notes with every beam right. It was the reader's only total
  failure: `trackCombs` returned zero curves and `readPage` returned null. The
  cause was not the aliasing the earlier diagnosis proposed but the tracker
  SHATTERING one stave into fragments, and the cure is the rejoin described
  under "Staves" above. HARD's mean went 89% to 93% on that one case.
- **Counting beams on a small photograph.** `npm run scan:sizes` puts numbers on
  it: beam accuracy is 100% at a working staff space of 14, 92% at 12, 49% at 8
  and 10% at 6, while recall stays above 93% throughout. Every note is found and
  given the wrong length. This is the largest measured hole in the reader that
  is not blocked on the truth file — the larger one, `LEDGER_LONGEST`, is — and
  it is in `readValues`, not in `findHeads`.
- **`densePhoto` counts 65% of its beams** on a page whose shape is the Bach's
  own, hiding behind 99% recall — the same failure at a comfortable size.
- **The reader still cannot read a close-up.** Blown up past a working staff
  space of about 35 — a phone held near two bars on a stand, which is the
  commonest thing a practice app will be handed — the Menuet finds no stave at
  all. The size sweep cannot reach that far (see "How big is the page"), so this
  rests on an earlier probe and nothing in the repo measures it.

## What is measured and does NOT work

- **CHORDS, by any change to the cluster rule — AND ON REAL PAPER THEY ARE
  WORTH TWO NOTES, which is the fact to read before the table.** Instrumented
  across the three marked photographs, the cluster rule fires about **43,000
  times** and exactly **4 of those suppressions land on a hand-marked
  notehead** — of which **2 are real double stops**. Everything else it removes
  is a second reading of one head, which is what it is for. So the synthetic
  table below is a measurement of DRAWN CHORDS, not of what chords cost this
  reader: 6,480 heads on pages built entirely of stacked chords, against two
  notes on the only real paper in the repo. **That is why chords are not on "The
  next step" at any rank**, and why the round that measured it spent itself on
  the stave model instead.

  **Two caveats, because the number is not reproducible and a second instrument
  disagrees with it.** The 43,000 count came from an instrumented build of
  `scan-read.js` and nothing in the tree reproduces it — `npm run scan:chords`
  measures drawn chords only. And an earlier splice of `findHeads`' survivor
  lists attributed **5 of the Concerto's 30 missed marks at the time** to the
  cluster stage (see the `LEDGER_LONGEST` entry), against a truth file whose
  denominator has since changed and a page that now misses 16. Those two counts
  are not obviously the same population and nobody has sat them side by side; an
  unexplained disagreement between two instruments is a finding, not a footnote.

  The drawn measurement, which stands as far as it goes: `tools/chord-check.mjs`
  draws chords of two, three and four notes at every interval from a second to an
  octave, four sizes, clean and photographed, and scores how many of each
  chord's heads come back:

  ```
    interval   a 2nd    a 3rd    a 4th   a 5th   an octave
    found      34-50%   52-81%    100%    100%    98-100%
    everything together — 5272 of 6480, 81.4%
  ```

  A fourth and wider already clears the cluster rule. A third is the interval a
  cello double stop actually uses and half of them are lost. **It is not the
  shape tests** — `headProbe` returns `accepted` on every missing head, fill 0.91
  to 0.94 with a solid core — and **it is not either judge**: turning the
  classifier off entirely moves the total to 81.8% and turning the second judge
  off moves it to 81.2%. It is the cluster rule, which keeps one head per place.

  **Loosening the radius is not available.** Swept on this build:

  ```
    CLUSTER_Y     0.9      0.6      0.5      0.42
    chords        81.4%    85.4%    88.3%    91.2%
    bench prec    95.0%    83.2%    71.9%    68.9%
  ```

  **Nor is a rescue for pairs stacked on one stem.** Two candidates at the same
  x, at least half a space apart, kept as a chord: 91.2% chords and **72.6%**
  bench precision, because a notehead and its own stem produce exactly that
  arrangement.

  **Nor is the waist between them.** The idea was that between two heads of a
  chord the midpoint lies at the EDGE of both ellipses where a notehead is
  narrow, while between two readings of one head it lies at the head's own
  centre where it is widest. Measured, it rescues NOTHING — 81.4% chords, bench
  94.9/98.1 — because at a third the two heads overlap so heavily that the ink
  between them is as wide as the heads are. There is no waist to find.

  What is left is to know it is a chord from the STEM — one stem carrying
  several heads — rather than from the heads' own geometry. That has not been
  tried and is the only avenue this measurement leaves open.

Written down so it is not proposed a third time. Each has numbers in the commit
that removed it:

- **ONE HEAD PER STEM, at every granularity that means anything.** This is the
  user's first complaint — "many false circles still happen oftentimes in the
  stem at the bottom" — and the rule that ought to close it. A stem has ONE
  notehead, so if the stem pass proposes at both ends of one it has proposed one
  candidate too many, and which to keep is decidable without knowing what the
  shape pass found. **It is measured four ways and every one of them costs more
  real notes than it removes false circles.** Read this before spending a day on
  it; the population is far smaller than the complaint suggests.
  - **What the population actually is.** Instrumented: 691 stem runs on the
    Bach, 627 on the Concerto, 759 on the Scanned score. Runs proposing at BOTH
    ends: **0, 0 and 4.** That is the entire reach of the rule as stated, and
    all of it is on one page.
  - **Per COLUMN — the literal reading — does nothing, and the reason is
    structural.** `stemHeads` walks x one pixel at a time and a printed stem is
    `STEM_WIDE` = 0.35 of a space across, so one stem is three or four separate
    runs and the pairing is per run. Taking the stronger end removed **two real
    heads and not one false circle**: the phantom came straight back from the
    column next door. `bench` Scanned 91.2/94.3 to **91.2/93.9**.
  - **Per PRINTED STEM — the runs joined by union-find, adjacent within a stem's
    width in x and overlapping in y — is worse.** `bench` Scanned to
    **91.1/93.4**: four real heads gone, invented still 40. Simulated offline it
    **simulated offline it is 2 real for 2 invented and measured through
    `truth-check` it is 4 real for 0 invented, and the gap was not chased.** The
    likely cause is that removing a stem proposal changes which candidate wins
    its cluster and shifts the greedy match, but that is a guess and is recorded
    as one: an unexplained disagreement between two instruments is a finding,
    not a footnote, and anybody re-opening this should start there.
  - **Generalised to collinearity — one head per stem COLUMN among the pass's
    own proposals — is dead at every setting.** Swept |dx| 0.30 to 0.80 spaces
    against |dy| 2.0 to 4.5: the best cell removes 3 circles for 2 real notes
    and the rest are worse. Every removal it makes is a note.
  - **"Is this end a real stem end, or did the ink just blink?"** — reject a
    proposal where the column resumes within k spaces past the run's end, on the
    theory that a phantom sits mid-stem where thresholding broke the run and a
    real head terminates it. **The two populations lie exactly on top of each
    other**: on the Scanned score the resuming gaps are 0.20 to 1.35 spaces for
    real notes and 0.20 to 1.35 for invented ones, medians 0.41 against 0.52.
    Every cut from 0.15 to 1.5 spaces costs more than it buys.
  - **The SHAPE TESTS as a filter on the stem pass, which looked like the
    structural answer and is the most interesting negative here.** `findHeads`
    runs a chain — fill, rim and core, ink running too far sideways, ink too
    narrow, paper above and below — and `stemHeads` runs NONE of it: it calls
    `headScore(headPatch(...))`, the classifier alone, at `STEM_CUT`. Running
    `headProbe` (which mirrors that chain exactly) at every stem proposal:
    **not one of the 73 proposals passes, real or invented.** 26 real and 10
    invented fail on rim-or-core, 15 real and 9 invented are not candidates at
    all, 9 real and 4 invented have too little ink. That is not a bug — it is
    what the stem pass is FOR, and it is the sharpest possible statement of it:
    every note the stem pass recovers is a note the shape tests reject. No
    filter drawn from them can ever be applied here.
  - **AND THE MEASUREMENT IS CONTAMINATED IN THE SAME DIRECTION AS EVERYTHING
    ELSE ON THAT PAGE.** Two of the four "real" heads the per-stem rule removes
    are truth marks standing on a bare stem where it crosses a staff line, with
    no notehead anywhere near. `CROP_PAD=26 CROP_MARKS=1
    CROP_TRUTH=pages/truth/scanned.truth.json npm run scan:crop -- "Scanned
    score.pdf" 754,510 948,510` puts the case beyond argument: the two crops are
    the same picture, one carries a red truth dot and the other does not. See
    "Known broken" — this is a FOURTH contamination class in that file. It does
    not rescue the rule (the per-stem version still loses four and removes
    none), but it is why the rule looks worse than it is.

- **BOUNDING THE VERTICAL GAP INSIDE `column()`** — taking the tallest
  contiguous piece of a column instead of its first and last inked row, so that
  a speck of grain is not joined to a notehead two spaces below it. **It looks
  like a clear win on three instruments out of four and it costs RECALL, which
  is the one direction that is not allowed.** At a bound of 1.2 spaces, all
  taken **at the time** and before the page-agreed key reach existed:
  `scan:key-read` 172 printed signatures right of 224 to **175** with no wrong
  key either way, `bench` precision on the Mozart 87.6% to **89.1%** for six
  fewer false circles, `scan:key-safety` **1422 heads to 794** — and then
  `scan:corpus` says **slopedPhoto recall 98% to 95%, mixedPhoto 99% to 97%,
  barMixPhoto 98% to 97%**. The mechanism is plain once seen: taking the tallest
  piece makes every column measure SHORTER, so more noteheads pass the height
  test, so the band eats more music. Swept at 0.5, 0.8, 1.2, 1.6, 2.0 and 2.5
  spaces; under 1.2 it is worse on every axis at once, because real photographed
  accidentals split and measure short — at 0.5 `scan:key-read` falls to 158 with
  **five wrong keys back**. **`scan:corpus` is the instrument that caught this
  one**, and nothing else would have.

  **A trap for whoever re-opens this, and it has now sprung twice.** The Mozart's
  precision read 89.1% for a while — exactly the "after" figure above — and it
  got there by a completely different change, the page-agreed key reach. Anyone
  diffing that number against this entry would have concluded the variant was
  already installed. It is not, and it never was: `bench` reads the Mozart at
  **93.1%** and the mean at **94.9 / 98.1** today, and the vertical-gap bound is
  not in the source. The lesson is the one this document keeps re-learning — a
  figure that happens to coincide is not evidence about which change produced it.
- **ASKING THE HEIGHT CEILING BEFORE THE SPECK FLOOR** in `findKeyBand`'s glyph
  loop — the idea that grain is small in BOTH directions, so a run a fifth of a
  space wide and three and a half spaces tall is a STEM and should end the
  signature rather than be walked past. It is the natural second half of the
  measurement-window fix, and on safety it is superb: `scan:key-safety` **131
  heads eaten to 47**, and the residue at a realistic two-space gap **23 to 3**.
  **It is a catastrophe on reading.** `scan:key-read` goes 172 of 224 to **145**
  and from **zero wrong keys to sixty-four** — sixty-four of the 224 drawn
  signatures contain a narrow run over the ceiling, so the test truncates them
  mid-signature, and a truncated signature is a valid PREFIX that every check
  below it passes. Marking those endings `cut` instead removes the wrong keys
  and leaves the reads at 145, the same 27 signatures given up. **`scan:key-read`
  is the instrument that caught this one. Do not re-derive it from the safety
  number alone; from there it looks like a pure win.**
- **`describe`'s `ran` flag as the notehead test for the clipping bug.** It is
  what says NOTEHEAD to `classifyKeyGlyph` and it does not cover this failure:
  `ran` is FALSE on every one of the 3746 arrangements that put a head in the
  band, because a head hanging below the stave stops at y = 131 where the
  contiguity bound is at 137. It is a real notehead that never reaches the edge.
- **A height ceiling on `describe`'s box** instead of fixing `column`'s window —
  already measured last round at 18 real signatures of 167 lost at 3.4 spaces,
  because that box is grown by contiguity and joins a signature's neighbours.
- **Step residual** as a notehead filter — distributions overlap almost
  completely; cut 0.25 keeps 71% of real notes and rejects 54% of false.
- **Cross-system voting** to find the key signature by its being printed in the
  same place on every system — costs 4 to 8 points of RECALL on the corpus,
  because music near a system's start is often similar system to system.
- **Requiring a ledger line** on a head far outside the stave — three marks
  removed and a real note lost, at every threshold from step 10 to 14.
- **A bigger model** — one hidden layer of 24 read 87.8% on the held-out Mozart
  against logistic regression's 92.0%, and it was memorising the page it trained
  on. **Re-measured on three pages the gap has almost closed**: 94.7% against
  95.0% in the mean, with the hidden layer now WINNING the held-out Mozart
  (92.7% against 92.1%) and losing the Scanned score (93.0% against 94.2%).
  Logistic still wins and is still what ships, but this is no longer a rout and
  a fourth page is what would settle it. `npm run scan:curve`.
- **More patches from pages already in the set** — two pages: 60 gives 94.3%,
  397 gives 95.1%. Three pages: 127 gives 93.5%, 845 gives 95.0%, and it is not
  monotone on the way (253 reads 93.9%, 423 reads 93.7%). Flat both times.
- **INSTALLING THE RETRAINED CLASSIFIER.** The retrain was run exactly as
  "Retraining the classifier" prescribes, against the current shape tests and
  with the Scanned score in the training set for the first time. **It is a
  better classifier by every column of the only honest table in the project,
  and it costs the reader two points of precision and two of recall.** It was
  measured, written up in `head-model.js`, and not installed.
  - **What the cross-page table says**, at cut 0.4 — the shipped weights (a fit
    over two pages) against the refit (three pages, 1267 patches):

    ```
    held out    shipped          refit
    Bach        98.1 / 99.4      99.1 / 99.4
    Mozart      93.3 / 89.5      89.6 / 98.0
    Scanned     not in that fit  96.2 / 90.9
    ```

    **Only the refit column is live.** `npm run scan:train` reprints it every
    run and it was re-run this round unchanged to the digit. The shipped column
    is historical and cannot be reproduced by any command here, because the
    two-page dump it came from was overwritten by the three-page one — see the
    head of `head-model.js` and "Where it stands".

    **And the Mozart row is flattered**: it is trained on the Bach and the
    Scanned score, and the Scanned score is the same music as the Concerto. The
    only clean independent row is the Bach, and it moves one point of precision.
    So this does not settle "a page of a different KIND" — a third scan is not a
    third kind.
  - **What `bench` says**, both rows taken on the day of the experiment against
    the same reader and the same truth files, which is what makes the comparison
    mean anything. **The left-hand figure is not the reader's score today** —
    `bench` reads **94.9 / 98.1** now, moved by five later rounds and by seventy
    marks coming off two truth files, none of them the classifier. **The two points of
    RECALL are the number that matters here, and they are far outside the 0.3
    this document's standard allows.** 92.1 / 94.0 to **90.0 / 92.1**. Bach
    97.5/98.8 to 95.8/98.8, Mozart 87.6/91.6 to 88.0/91.0, Scanned 91.2/91.6 to
    **86.2 / 86.5**. The Scanned score loses 23 real notes and they are spread
    through the music at y = 500 to 1650, not on the contaminated marks; only 5
    of the 23 have a newly-invented head anywhere near them, so the shape pass
    crowding out the stem hunt explains at most five of them.
  - **Where they go is the stem pass, and the constant is `STEM_CUT`.** On the
    Scanned score it reads 48 real / 14 invented with the shipped weights and
    26 / 22 with the refit. Swept with the refit installed (mean precision /
    mean recall over the three marked pages, against 92.12 / 93.98): 0.80 reads
    85.42 / 93.10 with a stem pass of 37/89; 0.90 reads 88.53 / 92.73 at 32/45;
    0.95 reads 89.99 / 92.09 at 26/22; 0.98 reads 90.87 / 91.15 at 16/7; 0.99
    reads 91.15 / 90.93 at 13/4. **No value recovers it.** Raising `HEAD_CUT`
    does not either — at 0.5 and at 0.6 the Scanned stem pass does not move a
    digit (26/22 at both) while mean recall keeps falling — and the best joint
    attempt, `HEAD_CUT` 0.5 with `STEM_CUT` 0.85, reads 89.34 / 92.92.
  - **The corpus splits, which is why this is a judgement and not an accident.**
    CORE and HARD means are unchanged at 99% and 93% and every recall and beam
    column is within a note, but the spurious heads move in opposite
    directions: **CORE 119 to 190** (`small` 5 to 30, `creased` 22 to 34,
    `tilted` 21 to 30) and **HARD 398 to 343** (`noBeams` 11 to 0, `minims` 9 to
    0, `pairs` 46 to 24, `usCrossLines` 66 to 44). `scan:sizes` keeps its 89%
    mean and loses precision across the clean column — `clean10` 90% to 76%,
    `clean16` 87% to 80%, `clean28` 78% to 71%. The refit is looser on clean
    engraving and tighter on rests and minims, which is exactly what training on
    a page whose hard negatives were deleted would do.
  - **A third fit separates the two things that changed**, and without it this
    is two experiments at once — the dump moved AND a page was added. The same
    trainer over the NEW dump with only the two OLD pages in it (803 rows)
    reads `bench` **91.0 / 92.9** (Scanned 89.3/88.7, stem pass 36/20) and
    **111 spurious heads on CORE against 119 for the shipped weights**. So:
    **the re-dump alone costs the bench a point, through the stem pass, with no
    new page and no new labels involved** — that is the portable finding, and
    any future change to the shape tests will do it again. And **the CORE
    loosening is the third page, not the re-dump**: two pages over the new dump
    invents fewer heads than what ships, and only the three-page fit invents
    190. That points at the Scanned score's labels, whose truth file is
    contaminated three ways over and hands training twelve positives standing on
    the letters of the title block.
  - **Why a refit moves the weights at all.** Not the optimiser: 3000 steps
    against 12000 on identical data moves them 0.30 against a norm of 6.10,
    where the re-dump moves them 1.83. The candidates themselves changed — every
    kept head is re-centred on its ink now, so 132 of the Bach's 365 rows and
    158 of the Mozart's 448 are different pixels — and the negatives that
    vanished were the hard ones: median 0.088 under the shipped weights against
    0.048 for those that remain, and the Bach's hardest deleted negative read
    0.531 where its hardest surviving one reads 0.204. **A shape test that gets
    better at rejecting a false circle deletes the example that taught the
    classifier to reject it.** That is measured on the dump; it is not what
    explains CORE's 190, which the two-page fit above rules out.
  - **So the honest statement is that the measurement doctrine has a hole in
    it**, not that the retrain is wrong. Every number `scan:train` prints got
    better. What broke is a threshold chosen outside that table, on a page the
    weights were fitted to. Fix `STEM_CUT` first — item 8 of "The next step" —
    and this becomes shippable.
- **DROPPING THE CURVE-SCORE BAR ALTOGETHER**, which is the other half of the
  blank-page fix and was measured against keeping it. It buys everything the
  absolute floor buys and costs a stave that is not there. With the
  `best * 0.6` conjunct removed and only the length test left, `npm run
  scan:few` reads the same 91% mean as the shipped answer — `few2faint` and
  `few3faint` both fully rescued — and `npm run scan:clef`'s end-to-end page
  grows a **fifth stave at y = 0 on a four-system page**, spanning the top edge,
  which reads `treble` on a page of basses and `treble` on a page of tenors:
  4/4 4/4 4/4 becomes 5/5 4/5 4/5. So the bar buys something real and reverting
  it is NOT the right answer; a floor beneath it is. See the score table in
  "The reader could return a blank page" for the 0.07-wide window that separates
  the artefact from a faint stave, and for the one datum that says the two
  populations touch at the bottom of the range.
- **Higher working resolution** — heads plateau from 1400px to 3600px. Re-run
  this round **on the Scanned score only** (`npm run scan:res -- "<pdf>"`; one
  page, so read the conclusions as being about that page), and the CAVEAT THAT
  USED TO STAND HERE WAS WRONG in a way worth reading, because it is a mistake
  about what a tool measures rather than about the reader:

  ```
    width   canvas         staves  space  clefs  bars  heads
     1000   1000x1266          11    6.9     10    37    378
     1400   1400x1773          11    9.6     11    35    452
     1800   1800x2280          11   12.4     10    34    455
     2200   2200x2787          11   15.2     11    35    444
     2600   2600x3294          11     18     11    35    464
     3000   3000x3800          11   20.7     10    34    442
     3600   3600x4560          11   24.9     10    34    456
  ```

  The old text said "every row at or above 1400 hands the reader the identical
  image". **It does not, and the table says so** — heads wander 442 to 464 and
  the clef and bar counts move too. `res-sweep.mjs` re-renders the PDF AT each
  width and `readPage` then throws it down to `WORK_WIDTH` (`w = Math.min(1400,
  naturalWidth)`), so each row is a DIFFERENT resampling of the same page, not
  the same pixels. What the rows share is the reader's working staff space,
  which never leaves about 9.6 whatever the width. So the plateau is real — the
  spread is resampling noise with no trend in it — but "identical image" was
  never true.

  **And the `space` column is a footgun.** It is measured in the RENDERED
  canvas's pixels, not the reader's, which is why it climbs to 24.9 at 3600
  while the reader is still working at 9.6. Do not read that column as the
  reader getting more detail; above 1400 it is getting none.

  **The one real datum is still 1000px**, the only row with no downscale at all:
  378 heads against 452 at 1400, so **74 fewer — 16% of them** — and one clef
  lost as well. Upward was never really tested and this entry is still not
  evidence about it.
- **Opening the key band on a system whose clef could not be read.** It looks
  free — the key scan has its own evidence and returns null when the first thing
  past the clef band is not an accidental — and on the three marked pages it
  changes nothing whatever (Bach 97.5/98.8, Mozart 87.0/91.0, Scanned 90.2/91.4
  either way). On the corpus it costs a note a page: CORE mean 99% to 98%, with
  clean, small, tiny, blurred, faint, jpeg, tilted, creased and shrunk all
  falling off 100% recall, and HARD heavyBlur 97% to 93%. A page of bare staves
  has music where the furniture would be, which is the same reason the clef band
  waits for a clef.
- **A two-pixel bridge in `onRule`.** A photographed staff line thresholds into
  broken segments, so the horizontal-run test that recognises it has to be
  allowed to step over the breaks — but two pixels is not enough. Measured on
  Bach system 4, space 12.1, over the seven columns between the clef's ink and
  the sharp, which hold nothing but paper and five printed lines: rows surviving
  `onRule` are 2–5 at a bridge of 0, 1–3 at 2, 0–1 at 4 and 0 at 6, and the
  tallest extent they measure is 3.14, 2.15, 0.08 and 0 spaces. At a bridge of
  two, bare paper still reads 2.15 spaces tall, which is inside `GLYPH_TALL`, so
  it is an accidental and the real sharp two columns later is never reached. On
  the same page the sharp's own fifteen columns keep 28 of 31 rows at a bridge
  of 6, and 8 reads identically to 6. It is half a staff space.
- **A rest has no stem and sits in a column of its own.** The step-4 population
  the histogram names is not rests, it is beam residue, so the test inverts: the
  false heads carry a column-ink median of 165px against real notes' 120px,
  because they are sitting on beams. A stem-height cut is net-negative at every
  threshold from 0.5 to 2.5 spaces — the best it ever gets is −4 heads at 1.2.
- **Widening the run's blank tolerance in `findKeyBand`** to stop a sharp
  breaking in two. A sharp centred ON a staff line loses its crossbars — they lie
  along the line, the merged run is hundreds of pixels wide, and `onRule` takes
  those rows out as line ink — so what is left is two separate uprights. Letting
  a run step over two blank columns instead of one would rejoin them, and it is
  dead: measured on the drawn seven sharps in treble at a space of 16, the gaps
  BETWEEN accidentals are one and two columns (at x = 111, 129, 147–148, 166,
  184, 203) and the gap inside the broken sharp is two. There is no daylight in
  the horizontal at all. What works instead is the VERTICAL — two pieces of one
  accidental share a centre to within the stem offset, about 0.15 of a space,
  while two different accidentals are never nearer than three steps, a space and
  a half. That is what `SAME_GLYPH` and `JUMP` in `scan-key.js` are.
- **HEIGHT AS THE TEST FOR A NOTEHEAD IN THE KEY BAND**, which is the obvious
  reading of the note above `GLYPH_TALL` and is wrong. That note says an
  accidental measures 2.15–2.89 spaces tall against a notehead's 3.67–3.74 and
  concludes there is three quarters of a space of daylight. **Its number comes
  from `tools/key-audit.mjs`, which measures a box CLIPPED at the scan's own
  narrow band and cleaned by a different line test from the one
  `classifyKeyGlyph` sees.** Measured on the box that function is actually
  handed — `describe`'s, grown by contiguity to 2.4 spaces past the stave —
  **162 of 1331 drawn accidentals stand over 3.2 spaces tall and the tallest is
  4.63**, because a signature's neighbours are printed two or three pixels apart
  and the contiguity walk joins them. A crotchet reads 1.23 to 4.32. The
  populations lie on top of each other, and the sharpest way to say it is that
  the fourth sharp of a four-sharp treble signature — which the reader READS
  today — measures 3.83 where the crotchet that started the whole investigation
  measures 3.75. A cut at 3.4 costs 18 real signatures of 167 and removes 10
  phantoms of 26; a cut at 3.7 costs 8 and removes 6.
  **The lesson is portable and worth more than the entry: a measurement is only
  evidence about the estimator that produced it.** Two probes measuring "how
  tall is this glyph" disagreed by a whole space and a half because one of them
  followed the ink out and the other did not.
- **THE OTHER TWO CORNERS, as the test for a notehead.** `describe` measures the
  two DIAGONAL corners a sharp fills; the natural next thought is that a sharp
  must fill all four, since both its uprights run the full height, while a
  down-stemmed crotchet has nothing at all in its bottom right. It is true about
  the glyphs and false about the boxes. Measured on the same corpus: requiring
  the bottom-right corner costs **14 of 167** real signatures and removes 21 of
  26 phantoms; requiring all four costs **102 of 167**. The reason is the same
  as above — the box is contaminated by whatever the contiguity walk joined, so
  the "bottom third" of a real sharp is often not the sharp. The top-left corner
  costs 4 and removes 2. What ships instead is the STEM LEAVING THE WINDOW,
  which costs nothing at all: see "Reading the key signature".
- **REFUSING A KEY BECAUSE THE THING NEXT TO THE SIGNATURE IS NOT AN
  ACCIDENTAL.** This is the broad reading of the truncation rule — "the band's
  ink continues past the last glyph the scan accepted" — and it goes one step
  too far. The height and width tests are the INTENDED terminators of the scan;
  the note above `GLYPH_TALL` says in as many words that everything the scan
  cannot identify stops the signature, and the first note of the bar is one of
  those things. Measured on the 352 drawn signatures and re-measured this round:
  of the 21 scans that end on the height test, **8 would have read the right key
  and none would have read a wrong one** (it was 7 when the rule was written).
  Pure cost. What ships is the narrower rule — refuse only where the scan gave
  up MID-signature, on a stepped-over speck or on running out of reach — which
  costs **4** correct reads today (1 on `speck`, 3 on `reach`; it was 6) and
  removes all 4 wrong keys. Both figures come straight out of the ending table
  in "Reading the key signature", which `npm run scan:key-read` prints.
- **ASKING `reach` AS "IS THERE INK OUT THERE".** The first form of the
  out-of-reach test asked whether any ink stood at or past the scan's limit,
  which the first note of the bar answers yes to on a page whose signature is
  perfectly complete. It refused **nine correct reads for no wrong key at all**.
  Asked properly — is there ink where the NEXT accidental would stand, within
  one glyph's spacing of the last one taken — it costs three.
- **Cutting the run harder to separate neighbouring accidentals.** `JUMP` bounds
  how much one column may add to a run's vertical extent, and the two halves of
  the score move in opposite directions, swept on the 352 drawn signatures:
  0.9 spaces reads 295 correctly with 6 read as the WRONG key, 1.1 reads 291 with
  4 wrong, 1.2 reads 290 with 4. A run cut in the middle of a signature is read
  as a SHORTER signature, which is a valid prefix of the real one and passes the
  order check — so the four extra correct reads at 0.9 cost two extra wrong ones,
  and both of those were on CLEAN pages at a comfortable size. It is 1.1.
- **Turning `beamMask` off, as a way of testing whether the mask is eating the
  missed notes.** It is not a test, it is a confound, and it answers the wrong
  question loudly. With `body = ink` the three pages read 94.1/99.1, 82.9/84.9
  and 84.6/80.1 — recall COLLAPSES, because without the mask a beamed group
  fuses into one shape and the candidates that carry the page stop existing. Of
  the Concerto's 30 missed notes only 6 come back and of the Scanned score's 39
  only 3, while 26 and 54 new ones are lost. Nothing about the mask can be
  concluded from it either way. What answers the question is splicing the four
  survivor lists out of `findHeads` and asking which stage lost each mark — see
  the entry below, which is what that probe found.
- **Relaxing `LEDGER_LONGEST`, the rule that a head standing on more than three
  staff spaces of horizontal rule is standing on a beam or a heading.** This is
  the largest measured population of missed notes in the reader and the change
  is BLOCKED ON THE TRUTH FILE rather than wrong. Read the whole entry before
  spending a day on it.
  - **What it costs today.** Splicing `findHeads` and asking which stage lost
    each of the Concerto's 30 missed marks: 11 no candidate, 5 cluster, 1
    classifier, 1 width floor, 1 lost to the greedy match — and **11 dropped
    after `findHeads` by `offStaveIsCredible`**, at classifier scores of 0.835
    to 0.998. They are high notes on ledger lines. Consecutive notes above a
    stave each get their own ledger stub, the stubs nearly touch, and
    `ledgerRun`'s two-pixel gap bridge chains them into one rule three to five
    spaces long — so a rule written to catch a head sitting on a beam catches a
    passage of ledger notes instead. `CROP_MARKS=1
    CROP_TRUTH=pages/truth/mozart.truth.json CROP_PAD=70 npm run scan:crop --
    Concerto.pdf 400,1628` shows five hand-marked heads in a row and not one
    ring on any of them.
  - **What relaxing it does**, measured on top of the two changes above:
    `LEDGER_LONGEST = 4` leaves the Bach untouched, takes the Concerto from
    87.6/91.6 to 87.4/94.3 — **nine real notes back for two false circles** —
    and the Scanned score from 91.2/91.6 to 88.9/92.3. Mean 91.30/95.10 against
    92.12/93.98. It fails the standard on precision and every other value fails
    it the same way: 3.5 and 4.5 both trade about one for one.
  - **And the Scanned column of that is not a measurement.** Twelve of the
    heads it adds there are counted as invented; two are on the phantom title
    stave and the other ten are in the ledger passage of systems 8 to 11. Six
    of the ten have been looked at and every one is a plainly printed notehead
    that nobody marked. **The Scanned score is the same music as the Concerto**,
    and the Concerto's truth file marks every head in that passage while the
    Scanned score's marks almost none: `CROP_MARKS=1
    CROP_TRUTH=pages/truth/scanned.truth.json CROP_PAD=140 npm run scan:crop --
    "Scanned score.pdf" 420,1595` beside the same call on `Concerto.pdf` at
    420,1628 shows the two pages side by side. Corrected for those ten,
    `LEDGER_LONGEST = 4` reads Scanned **91.1% precision to 92.4% recall**
    against 91.2/91.6 — precision flat, recall up — and the corrected mean is
    92.00/95.17, i.e. **twelve real notes recovered at no precision cost at
    all.** That correction is a third contamination in the same file and it is
    in "Known broken" with the other two.
  - **No second discriminator exists**, and six were measured on all 38 heads
    the rule refuses across the three pages (14 of them hand-marked notes). The
    run's length is the only thing that separates and it separates badly: real
    notes run 3.02 to 5.15 spaces with 12 of 14 under 3.87, and the three
    verified-false on the Bach run 4.25, 6.63 and 9.28, so the populations
    overlap between 3.87 and 4.25 and any cut is one measurement wide. Flat, all
    of them: how far the run reaches each side of the head; the thickness of the
    run at its low quartile, median and ninetieth (a beam reads 0.58–0.67 spaces
    and a ledger chain 0.30–0.71, on top of each other); the share of the run
    that is as thin as a printed rule (0.00–0.35 for real notes, 0.00–0.25 for
    false); the length of bare rule leaving the head before something notehead-
    sized stops it (0.00–0.73 spaces for both); and whether anything notehead-
    sized stands at the end of the run at all.
  - **So: re-mark the Scanned score first.** This change is worth more recall
    than anything else measured in the reader and it will read as a regression
    until that file is honest.
  - **THE FILE IS NOW HONEST AND THIS HAS NOT BEEN RE-MEASURED AGAINST IT.**
    Every figure in this entry is AT THE TIME, against a denominator of 440 or
    453 with ten of those ledger heads unmarked and thirteen title-block marks
    on. Ten of the twelve "invented" heads the entry predicts away are among the
    thirteen now ADDED to the file, and the two on the phantom title stave
    cannot happen at all any more. So the corrected reading the entry works out
    by hand — twelve real notes at no precision cost — is now something `bench`
    will simply print. **This is the next thing to do and it is one constant.**
    Nothing else in the entry needs redoing: the six failed discriminators are
    properties of the ink and did not move.
- **Vetoing a stem-pass proposal by plain distance to the nearest head**, and
  the two other shapes of that veto. What works is asking, before the hunt runs,
  whether the stem END already has a head — see the note on `owned` in
  `stemHeads`. What does not: a round radius (1.2 spaces removes four circles
  and a real note, 1.4 removes six and two); and putting a FLOOR under the
  vertical offset as well, on the theory that a chord stacks in thirds while a
  phantom sits further down the stem — vetoing only a head 1.15 to 2.5 spaces
  away loses three real notes and removes no more circles than the tight bound
  does. A chord of a third and a phantom are the same picture, one head a space
  above another at the same x, and nothing of this shape can tell them apart.
- **Centring a kept head on its ink VERTICALLY.** Horizontally it is worth 0.26
  of precision and 0.28 of recall and costs nothing; vertically it is worth one
  more head on one page and costs five note VALUES on the corpus, because
  `readValues` counts beams by looking along the stem from the head. See the
  note above `HEAD_CENTRE_CAP`. The trap in measuring this: a probe that splices
  a second copy of the centring block into a file that already has one reports
  the axis it added as carrying the whole effect. Both single-axis numbers in
  that note were re-measured from a clean file after exactly that mistake.
- **Asking the page how weak a predicted stave may be** — `fillMissedStaves`'
  `floor = 0.05` replaced by a fifth of the low quartile, across staves, of the
  low quartile across strips of what the page's OWN tracked staves score. This is
  the phantom-stave fix and it is CORRECT; it is reverted only because the
  Scanned score's truth file is not. **THIS ENTRY IS NOW HISTORY: THE FIX IS
  SHIPPED.** It is in `fillMissedStaves` and every figure below is AT THE TIME,
  against a truth file that carried thirteen marks on the composer's name. With
  those marks off, the same change reads Concerto 92.0/95.1 → **92.9/95.1** and
  Scanned 89.7/99.5 → **93.4/99.5**, recall flat on every page. The entry is
  kept because it is the clearest statement anywhere of why the measurement
  argued against the fix for three rounds, and that failure shape is the one
  worth remembering. The measurement was complete in a way it was not before,
  and the last line was the new part:
  - **Concerto: free.** 87.6/91.6 to **88.4/91.6** — precision up 0.8, recall
    unchanged to the digit. Its phantom carried 3 heads and matched none.
  - **Scanned score: +1.7 precision for −2.65 recall.** 91.2/91.6 to 92.9/89.0.
    It gives up exactly 12 matched heads and 9 invented ones, and all 21 are on
    the phantom. The 13 marks it can no longer match are at (104,168) (122,194)
    (136,223) (219,227) (245,197) (256,227) (278,245) (1183,213) (1213,213)
    (1243,205) (1243,213) (1284,204) (1301,212) — every one above y=330, where
    the page's first real system begins at y=367. Looked at:
    `CROP_MARKS=1 CROP_TRUTH=pages/truth/scanned.truth.json CROP_PAD=90 npm run
    scan:crop -- "Scanned score.pdf" 1243,208` shows five red truth dots sitting
    on the letters of W. A. MOZART and no ring anywhere near them.
  - **Every real stave on both pages is byte-identical** after the change — the
    fitted spaces, the head counts, the bars. Only the phantom goes. So no
    retraining is implied and none was done.
  - **AND IT COSTS THE CORPUS NOTHING.** All 49 rows of CORE, HARD and SIZES come
    back identical, not merely equal in the mean. That is the answer to the one
    real worry about this change — `fillMissedStaves` exists to rescue the faint
    system at the foot of a photographed page, and it still rescues every one.
  There is no setting that separates the two pages: both phantoms score 0.00 and
  both are title blocks, so they live or die together.
- **Agreeing the staff space across the page, and clamping the system that
  disagrees.** This is the obvious shape of the phantom fix — one page is
  engraved at one size, the real systems agree to within 1.6% of their own
  median, and a system 18% off is wrong rather than unusual — and it is a
  strictly weaker discriminator than the comb score above. Two measurements
  killed it:
  - **It cannot see the Concerto's phantom at all**, at any bound. The clamp is
    applied to the mean of the per-strip steps, and the phantom's per-strip step
    oscillates between the two EXTREMES of `combPeaks`' search window — 8.5 and
    11.5 at a pitch of 10 — so its mean is the page's own. What is wrong with it
    is the SCATTER, which is the signature of an argmax over noise. The 9.36 that
    shows in the reports is what survives `fitCurve` dropping the outliers, and
    by then the clamp has already been decided. Tried at 10% and at 5%: the
    Concerto column does not move a digit either way.
  - **On the Scanned score it buys a weaker version of the same trade**:
    91.2/91.6 to 92.1/90.3 — precision +0.9 for recall −1.3, where the comb-score
    fix gets +1.7 for −2.65. The clamped phantom keeps 10 of its 21 heads instead
    of losing all of them, so it is the same failure at half scale.
  The general lesson is worth keeping: the two populations are separated by an
  ORDER OF MAGNITUDE in comb score (0.00 against 0.66–0.86) and by six per cent
  in staff space against a real spread of 1.6 per cent. Use the one with the
  daylight in it.
- **Measuring the background blur box in STAFF SPACES instead of page widths.**
  This is the most convincing wrong idea in the reader and it has now been
  measured twice. The local threshold divides the page's own lighting out and
  only works while the blur box is comfortably larger than a glyph; the box is
  `w/36`, 39 pixels at `WORK_WIDTH`, which is 3.2 to 4.0 staff spaces on the
  three marked pages and 0.9 on a photograph of two bars — so it is obviously
  the wrong units, and converting it is obviously right. It is not.
  - `space * 3.5`, two passes (blur, measure the page, re-blur): the marked pages
    **collapse** — Concerto 87.6/91.6 to 84.7/84.9 and the Scanned score
    91.2/91.6 to **85.0/78.8**, with the barline counts moving too (34 to 42).
    `w/36` is 4.9 staff spaces on the Scanned score, not 3.5, so the conversion
    SHRANK the box on the page it was supposed to help.
  - `max(w/36, pitch * 3.5)` — one-directional, so the box may only ever be made
    bigger and the marked pages are almost untouched: Bach gains a note
    (97.6/99.1), the other two do not move, mean recall +0.1. And it **fails the
    size sweep**, which is what the sweep is for: mean 88% to 87%, `photo6`
    recall 32% to 8%, `photo8` beam accuracy 50% to **13%**.
  A constant that is right for the three pages and wrong for the corpus is
  exactly the failure this is meant to prevent, and the second reading is that
  failure with the sign flipped — right for the marked pages, wrong for the
  sweep. The units are wrong and the number is load-bearing anyway. If it is
  attacked again, the thing to fix first is that `pageScale` runs AFTER the
  threshold that feeds it, so any conversion costs a second blur over the page.
- **`combPeaks`' step window as a PERCENTAGE of the pitch** — `pitch * 0.88 …
  pitch * 1.12` in steps of `pitch/50`, in place of `pitch ± 1.5` in steps of
  0.25. An earlier diagnosis ranked this the third most dangerous fitted constant
  in the reader, on the argument that ±1.5 pixels is ±12.5% at the Bach's pitch
  and ±4.3% at a pitch of 35, and that a stave's spacing varies by a RATIO and
  not by a fixed number of pixels. The argument is sound and the change is
  measured to be worse in both directions. On the marked pages Bach improves
  (97.6/99.1) and both hard pages lose recall — Concerto 91.6% to 91.0%, Scanned
  91.6% to 90.5%, mean recall 94.0% to 93.5%, which fails the standard on two
  pages at once. On the size sweep it is a wash that costs the small clean end:
  mean 89% to 88%, `clean6` recall 96% to 85%. The reason it does not help where
  it should is that ±1.5 pixels is ±21% at a pitch of 7 and ±30% at a pitch of 5,
  so at the small sizes the fixed window is the WIDER of the two and the
  percentage version narrows it.
- **Rejecting a stem-pass candidate for being centred on a staff line.** All 19
  of the Scanned score's invented stem heads are at even steps — and so are 45
  of the 47 correct ones. Median distance to the nearest line is 0.70px for the
  invented and 0.80px for the correct, at a 9.63px space. Eight discriminators
  were measured and every one came back flat. The rule deletes the 45 real notes
  that carry that page's recall to remove 19 false ones.

### The clef rounds' dead ends

- **A MID-SYSTEM BASS CLEF, READ OFF THE CLEF COLUMN. Measured over 58,411
  windows against every rule the profile can express, and the best point that
  read anything read 41 of 60 systems and fired 25 times on the furniture.** The
  full sweep and the reason are written up under *A clef printed part way along a
  system*. Do not re-propose it as a constant to loosen: `INK` and `BASS_SOLID`
  were both blocking it, both were fixed inside the sweep, and the false fires
  are what remained. If a round wants to try again it needs a measurement with
  2-D structure in it — an F clef's own unique signature is its TWO DOTS
  straddling the line it names, and each is about a fifth of a space across in a
  band 3.6 spaces wide, contributing 0.06 to a row the curl beside it already
  fills to 0.3.
- **Cutting the glyph out of the clef band by its own ink, to measure a
  mid-system clef in a band its own size.** It recovers the extent on a
  photograph (a cue F clef reads 2.7 spaces where the 3.6-space band reads 1.25)
  and falls apart on a CLEAN page, where the binarised curl is not connected
  column to column and the segment comes back 0.5 to 1.2 spaces wide against a
  glyph of 2.0. Not the way in.
- **A run of 3 for the mid-system treble.** Reads the same 54 of 60 and fires 12
  times, on a double barline through the camera. The run is 5 and the two extra
  windows are half a staff space.

### The pitch rounds' dead ends

**Measured this round, on the stave model's own smoother, so the windows are not
swept a second time.** Scored as the STEP against the printed lines
(`scan:steps`, marks right of the three pages' 248 / 230 / 301):
a median window of **3** ties the chosen 5 on the total (229 · 211 · 278 against
229 · 210 · 279) and is not taken, because a median of 3 survives only ONE bad
strip and a beamed group is wider than a 35px strip; a window of **7** is worse
(229 · 210 · 276); **no trailing mean** is worse (229 · 209 · 275) and leaves the
median's staircase; **a five-wide mean** costs Bach a mark (228 · 210 · 278); and
**running the three-wide mean twice** for sub-pixel resolution costs Bach and the
Concerto one each (228 · 209 · 279). **Raising the polynomial degree was not
tried and should not be** — the shape has three turning points, so it needs a
quartic, and a global quartic goes unstable at exactly the strip ends where
`trackCombs`' clamp fabricates flat data.


Newer than everything above, and grouped because they all came out of teaching
the reader to NAME a note rather than to find one. The first two are the same
idea tried twice, and both times the cost was paid in the one currency this
project does not spend.

- **"AN EMPTY KEY BAND MEANS C MAJOR", the plain version — 16 KEYS READ WRONG.**
  A page in C major prints no signature, `findKeyBand` returns null, `pitchOf`
  refuses a null key, and 110 of the studies' 692 notes came back with no pitch
  at all. The obvious repair is to let a null band mean C major. Written and
  measured, it took `npm run scan:key-read` from **0 keys read as the wrong key
  to 16**, which is the one line in this project that is not allowed to move.
  **AND THE 16 WERE MISREAD BY THE TOOL BEFORE THEY WERE MISREAD BY THE
  READER** — `tools/key-read-check.mjs` requires C major to read as SILENCE
  (`want = count === 0 ? null : …`), so the 16 are its 16 bare cells being NAMED,
  not sixteen printed signatures read as the wrong key. That correction does not
  rescue the idea; it relocates the fault, and the fault that remains is the real
  one: `null` from `findKeyBand` is three different answers wearing one face — a
  degenerate window, a scan that accepted nothing, and a scan that accepted more
  than seven runs — and only one flavour of the middle one is evidence of bare
  paper.
- **"INK WITHIN `KEY_ADJACENT`" as the narrower version — 15 KEYS READ WRONG,
  and it still failed every C-major study.** The second attempt kept the rule and
  tried to bound it by asking whether there was ink close to where the signature
  would start. It reads 15 wrong instead of 16 and buys nothing, because **on a
  BASS clef the clef's own two dots stand 0.00 spaces past the clef band**: the
  test was measuring the clef on every bass page in the corpus, which is all 32
  studies. Worth keeping for the general lesson — a bound measured from the clef
  band is a bound measured on the clef, and the bass clef's dots have now
  produced two separate bugs in this reader (the other is the sharp-rejoin, see
  the git log).
- **The rule that DID ship, and the sweep that says why its floor is 2 and not
  1.** `agreeNoKey` needs every system that ran the scan to have come back
  `empty` — the scan's own verdict, carried out of the no-glyphs path, meaning
  *the next ink stands further from the clef than one accidental ever stands from
  the next* — with none reading a key and at least two of them. The floor is the
  whole trade and both halves were measured, prize from `scan:studies` and price
  from the third block of `scan:key-safety` (76 drawn pages that PRINT a
  signature, both clefs, 1–7 accidentals, clean and photographed, 1–5 systems):

  ```
    floor   right pitch   no pitch at all   keys      a page with a signature
            of 692        of 692            of 32     that named itself C major
      1     662  95.7%      0               20        1 of 76      <- A WRONG KEY
      2     636  91.9%     26               18        0 of 76      <- shipped
      3     557  80.5%    110               15        0 of 76      <- the old reader
  ```

  **A floor of 1 is a per-system rule and it is dead on one page**: bass, two
  sharps, photographed, ONE system — the camera takes the printed signature below
  the scan's floor, the lone system says the place is bare, and the page names
  itself C major, two degrees wrong on every note. That is what 26 unpitched
  notes are buying. The corroborating count is **3 of 206** systems of
  signature-printing pages coming back `empty`, all photographed, every one a
  system a per-system rule would have named C major.
- **Citing `scan:key-read`'s zero as the safety argument for any PAGE rule.** It
  cannot see one: that tool draws a single stave and calls `findKeyBand`
  directly, so a two-witness page rule never fires inside it and its zero would
  have stayed zero however wrong `agreeNoKey` went. The gate had to be built —
  the third block of `scan:key-safety`, through `readPage`, on whole pages, with
  three must-be-zero lines. Worth remembering as a shape: **a measurement that
  cannot see a change is not evidence about it**, however sacred the number is.
- **SHRINKING `findHeads`' `reach` to stop one notehead being reported by two
  staves.** The straightforward fix for the −44/−45 group, tried first, by
  patching the constant in the served module: reach 7 gives 557 right pitch, 6
  gives 572, **5 gives 577 and the group is gone** — and then `FORCE_CLEF=treble`
  at reach 5 costs recall **98.0% to 92.1%**, because bass-clef music read in
  treble sits below its stave and the same notes fall off the other end. The
  reach is right; what was missing is that a stave has no claim on ink that
  plainly belongs to its neighbour. `dropDoubledHeads` re-assigns instead.
- **`classifyClef` as the detector for a mid-system clef.** It is a CHOOSER, not
  a detector: treble needs ink below the bottom line, tenor above the top, and
  **bass is the residual**, guarded only by "taller than a speck", so it always
  answers. Slid along one drawn system with **no clef change anywhere in it**,
  the reader's own clef window read `bass` at **201 x-positions out of 651** and
  `tenor` at **30**. Anything that walks a window along a stave and asks
  `classifyClef` finds clefs in the music.
- **Density inside the clef band, as the presence test for a small clef. It is
  BACKWARDS.** The mid-system C-clef reads **0.233** of the 3.6-space band inked
  and a plain notehead reads **0.524**, because the band is sized for a full-size
  clef and a three-quarter one does not fill it.
- **Per-column ink extent off the raw binary.** It SATURATES on a photograph:
  3.66 spaces of a 3.66-space window at **every x** on the Concerto, because a
  photographed staff line at a working space of 10 is three pixels thick and
  survives a per-column run-length drop. `clefFeatures` does not have that
  problem, which is why every mid-clef measurement is taken on its profile.
- **PRESENCE-THEN-NAMING for the mid-system clef, with an unnamed candidate
  blanking the pitches after it.** Built first, because refusing looks safer than
  guessing. **A chord of three notes a third apart on a photograph killed it**:
  height 3.51, symmetry 0.98, continuity 0.97 — as tall, as solid and as
  symmetric as a small C-clef. The only thing it could not fake was the WAIST, at
  **1.71**, a third of a space off the line, where every real C-clef measured
  here lands within **0.06**. So naming is part of the gate and there is no
  "something is here I cannot name" refusal: the shape half alone is not specific
  enough to carry one, and a refusal firing on every double stop would blank half
  the Bach suites.
- **"No accepted head in the window" as a guard on the mid-clef detector.** An
  earlier draft required it. It suppressed detection at exactly the two engraved
  sizes where `findHeads` circles the clef itself (0.6 and 1.0 em), it cost
  nothing on the photographs, and it coupled the detector to a false-circle bug
  in a different subsystem. Dropped.
- **Sliding the mid-clef window half a space instead of a quarter.** Proposed as
  the cheap half of the 8–11% that `findClefChanges` adds to `readPage`
  (Bach 637→704ms, Concerto 535→579ms, Scanned 505→561ms, median of eleven runs).
  It gives back only **14–20ms** and halves the margin `MID_CLEF_RUN` exists for:
  a real clef answers over 6 to 8 windows at a quarter space, which is 3 to 4 at
  a half against a bound of 3. Not taken, with the number rather than the
  assumption.
- **A MIXTURE RETRAIN of `acc-model.js` to survive a photograph.** The obvious
  next accidental job and there is nothing for it to fix. Clean and `--camera`:
  **30 printed, 30 found, 30 named right, 0 invented on 662.** At `--phone` the
  loss is the NOTEHEADS under the accidentals — 28 of the 61 lost heads carry one
  of the 30 — and the model reads **2 of 2 of the survivors** right and invents
  none on 629. There is no glyph left to judge. Note also that `pages/engraved`
  is EMPTY, so `npm run acc:train` would have to regenerate its corpus from
  scratch, and the 82.8% clean figure quoted in some briefs exists nowhere in the
  tree.
- **`--camera` as evidence that anything survives a photograph.** Not a rule, a
  measurement that was measuring nothing, and it is recorded here because it was
  quoted for several rounds. Its filter is blur 0.7px, contrast 0.88 and a light
  gradient — no rescale, no JPEG — and it is **identical to clean in every field,
  note for note**: 692 found and 666 right pitch either way. `--phone` is the one
  that moves (0.72 downscale, blur 1px, contrast 0.62, JPEG 0.6): 631 found, 378
  right pitch.

### NOTE VALUES ARE NOW MEASURED, and the rhythm path is dead for a reason that is not the beams

`npm run scan:values` — `tools/value-truth.mjs`, against
`pages/truth/scanned.values.json`. Before this round nothing in the tree scored a
DURATION on a real page: `npm run scan:stems` sounds like it does and is a
stem-height sweep. This is the duration twin of `scan:steps`, built the same way
— truth encoded by cropping every mark at 11x to 40x — and its pairing
reproduces `truth-check`'s `hit` exactly on all three pages (318, 312, 410),
which is the check that says a bad number would be the reader's and not the
tool's.

**Note for note, truth-backed: 38 of 52, 73.1%** over marks 0–32 and 92–123 of
the Scanned score (systems 1 and 3, eight bars, six of which sum to exactly four
crotchets from the encoded values alone). Every one of those 52 was found by the
reader, so recall is not in this number.

**AND STILL 38 of 52 AFTER A DOT READER WAS BUILT FOR IT** — see
`scan-stems.js`'s header for the two crops that say why, and *WHY EVERY BAR IS
REFUSED* below for the corpus that says the refusal is right.

**THE HEADLINE IS NOT 73.1%. IT IS THAT `scan-values.js` BELIEVES ZERO BARS ON
ALL THREE PAGES** — 0 of 39, 0 of 38, 0 of 37, at coverage 21%, 18% and 11%
against `COVERAGE = 0.55`. So `scanTiming`'s `fromWritten` is false on every real
page in the repo and always has been; every per-note timing verdict a take has
ever been given came from the even-spacing fallback. Two causes, and neither of
them is beam counting:

- **The bar GROUPING is roughly doubled.** The Bach photograph averages **8.3
  notes per bar-group where a printed 4/4 bar of that page holds sixteen**, and
  its bar sums scatter (0.5 beats ×8, 4 beats ×7, 1.25 ×4, …). `notesInOrder`
  numbers bars by counting the barlines found within a stave, and a printed bar
  split in two makes two half-bars neither of which can ever agree with
  anything. **This is upstream of `scan-values.js` and no amount of beam work
  reaches it.**
- **Chords break the sum by construction.** `validateValues` adds up NOTEHEADS,
  and two heads on one stem are one onset counted twice. Bar 1 of the Scanned
  score's system 1 is printed as four crotchet beats and its ten marked heads
  come to **eight**; the tool prints `printed 4 / truth over the heads 8` side by
  side. A PERFECT reader cannot make that bar add up. Part of the Scanned page's
  refusal is therefore unfixable without a notion of a chord.

**And the values themselves are nearly right where the page is uniform.** On the
Bach photograph 315 of the 318 heads that landed on a hand mark read as
semiquavers, and that page is 20 bars of sixteen semiquavers — ten systems
carrying exactly 32 marks each, which is the arithmetic that corroborates it.
**99.1%, and the page is still refused entirely.** (Truth-backed by the music and
that mark count, NOT by an encoded values file. While checking it: the "quarter
rest" recorded in `bach.truth.json`'s own `cleaned` field at (311,751) is not a
rest — cropped at 12x it is the pencilled fingering **4**. No printed rest was
found on that page.)

**The 14 wrong values, by mechanism** — this is what rhythm work should aim at:

```
  beams OVERcounted     7   5 quaver→semiquaver (one printed beam read as two,
                            and the group vote spread it), 1 crotchet→semiquaver,
                            1 flagged quaver→semiquaver
  dot missed            3   3 of 3 dotted quavers in the span — 100% of the
                            feature. readValues says out loud it does not read
                            dots; this is the price on a real page
  beams UNDERcounted    3   2 semiquaver→quaver (the partial second beam that
                            hooks back off a dotted-quaver pair is not seen),
                            1 quaver→crotchet
  hollow missed         1   a minim read as a crotchet at working space 9.6
```

**A correction to `readValues`' own header comment.** It says an unbeamed filled
head "is called a crotchet, and where that is wrong the bar it is in will not add
up". Measured: the one flagged unbeamed quaver in the span (mark 32) came back a
**semiquaver, `beams: 2`** — the flag's ink is counted as two beams. That is
worse than the file claims and it is a different repair: not "fall back to a
crotchet" but "stop the beam counter walking into a flag".

The old bullet above — *Note values beyond beam counting — rests, dots, ties,
tuplets* — is no longer un-measured. `npm run scan:values` is the instrument.

## THE SCANNED REVIEW, END TO END — what a take on a photograph now does

Five separate pieces of work landed on this in one round (the key in the
aligner's reference, the time bridge, the duration truth file, the review's
follow-along, and the rhythm join) and none of them was wired to the next. This
section is the state of the joined thing, walked by hand in a headless browser
on port 5199 with a SYNTHESISED take — no microphone, no camera, and none may
ever be added to this path. `npm run score:follow` is the walk; `--shots` leaves
the crops it looked at in `$TMPDIR/music-companion-follow`.

**35 checks, ALL PASS.** What the walk actually does, in order, is the user's own
path: two engraved bass-clef pages in one sharp are stored as a part, a take is
played FROM WHAT IS WRITTEN on them (37 notes, starting 36 noteheads into page
one, running over the page break, with three written notes deliberately
skipped), the review is opened, the take is paired, the transport is pressed and
the light watched for sixteen seconds, a notehead that WAS played is pressed, a
notehead NOBODY played is pressed, and the rhythm sentence is read off the
summary. Then four failures it has to survive: a take of a different piece, a
page with no clef, the report closed under it, and a take with no notes in it.
**And then the whole review again on a REAL PHOTOGRAPH** — the Bach page out of
`pages/index.json`, stored as a PDF-backed part exactly as an imported part is.

**What holds, with the number beside it:**

- 101 noteheads read where 96 were engraved; 37 marks; the PITCH route, not the
  contour fallback.
- The light moves over **34 different noteheads in 16 s, strictly forward**, goes
  out **34 times** (the tenth-of-a-second gaps between notes — the last head is
  NOT held lit), and crosses onto page two on its own. Asked directly at the
  moments a screenshot cannot catch: inside a note → head 48, in a gap → null, at
  the instant a note ends → null, before the take → null, after it → null, NaN →
  null.
- 49 silent markers are drawn for the 64 unplayed heads INSIDE the take's reach,
  each at least 23 px across, and the review says out loud what they are.
- Pressing one sounds the pitch the PAGE reads there (midi 47 where the page
  reads 47), says so in words, colours nothing, opens no close-up, and selects no
  played note. With the report closed underneath it still answers, because that
  answer never came out of the recording.
- Pressing a ring opens that note's close-up AND PLAYS THE MOMENT — which this
  line claimed for a whole round while it measured zero. The check under it
  asserted that the PANEL OPENED; a panel is not a sound, and pressing a ring
  started `{ buffersStartedAfterPress: 0, oscillatorsAfterPress: 0,
  zoomPlayButton: "play" }`. `report.js:playNoteAloud` now builds the
  emphasised clip around the note's own span (`buildEmphasizedClip`, lead-in cut
  from 1.2 s to 0.35 s so the note you asked for is what you hear first) and
  plays it through `playClip`, which silences the written-pitch tone by
  construction. **`npm run score:hear` is the instrument, and counting audio
  sources is the whole of it**: `AudioBufferSourceNode.prototype.start` and
  `OscillatorNode.prototype.start` are patched in the page and counted as
  deltas around each press. On the Bach photograph, 11 checks, all pass:

  ```
    press a notehead you PLAYED     1 buffer source, 0 oscillators, ctx running
    press one NOBODY played         0 buffer sources, 1 oscillator at 185.0 Hz
  ```

  The second line is rule 5 as a number rather than as an argument. The LAST
  ring of the take is pressed too, because a take's final note can end a frame
  past the end of the audio (a frame time against a sample count) and the first
  version of the guard in `playNoteAloud` refused exactly that press — a fix
  everywhere except on the one note no check presses. The first press is a REAL
  MOUSE CLICK with the autoplay policy left ON (no
  `--autoplay-policy=no-user-gesture-required`, unlike `score:follow`), the
  light is asserted to land on the very head that was pressed 0.41 s after the
  source started — the lead-in — and the transport is SAMPLED EVERY FRAME
  rather than read at the end, because the clip is a second long and a check
  that waits for it correctly finds ▶ afterwards. `score:follow` carries the
  one-line version of the same count beside the panel assertion it used to end
  at (36 checks now, all pass).
- A page whose clef could not be read draws **0 rings and 0 silent markers** and
  says why.
- **ON ALL THREE PHOTOGRAPHS, through the PDF path** — `PHOTO=0`, `1`, `2`.
  Every one of them is read, DRAWN in the review (1 page, canvas 1656 px), taken
  onto by PITCH, marked, and given a rhythm sentence; nothing throws on any of
  them. Read what the take is before reading anything into it: it is synthesised
  FROM THE READER'S OWN midi for 28 consecutive noteheads, so it says nothing at
  all about pitch — that is a tautology by construction. What it does say is
  where the marks LANDED, which is a fact about the aligner and is asked of real
  paper nowhere else in this repo:

  ```
    page              heads   priced   marks   on their OWN notehead   dashed
    Bach                324      324      28          24 of 28            74
    Concerto            749      749      28          11 of 28           257
    Scanned score       443      443      28          27 of 28           139
  ```

  **Every head on every page was priced**, so the "reference with holes" case the
  `headsOf` note warns about did not arise on real paper — `agreeKey` got its
  quorum on all three, exactly as `scan:align --real` says it does. **The
  Concerto losing more than half of a take taken verbatim off its own noteheads
  is the number to look at**: it is the blurriest of the three and the one whose
  reference is longest (749 heads, because the whole part is read, not one page),
  and its marks scatter far enough that the dashed-marker reach covers 257 heads.
  Nobody has yet drawn one of those misplacements on the page.

**The three seams that were open between the pieces, and what was done to them:**

1. **TWO SOURCES OF TRUTH FOR "WHICH NOTEHEAD".** `alignByPitch` built each mark
   with `{ ...heads[attempt.score.id] }` — the spread takes the HEAD, so the
   aligner's own answer died on that line — and `scan-sync.js` then recovered it
   by matching the exact `(page, x, y)` triple back onto the heads array. All
   three pairing routes now carry `headIndex`, and the bridge believes it ONLY
   where the head it points at is the head the mark is a copy of; where it
   disagrees, or is absent (a hand-built pairing in a test), the place-join
   answers exactly as before. Pinned by four tests, one of which asserts the two
   join to the identical spans.
2. **A RHYTHM VERDICT THE UI NEVER SHOWED.** `src/ui/score.js` called
   `scanTiming` directly and `scan-rhythm.js` was dead code. It now calls
   `scanRhythm`, keeps `ready.bars = rhythm.timing` (the same object, so no
   consumer of that field had to be found) and prints ONE of two sentences,
   never blended: the written route where the page's own note values could be
   believed bar by bar, and a refusal WITH ITS REASON where they could not. The
   walk asserts that the route the sentence claims is the route the join took.
3. **TWO VOICES THAT COULD SOUND AT ONCE.** Pressing an unplayed notehead gives a
   synthesised tone; pressing play gives a recording of an instrument; the whole
   point of the tone is that it cannot be mistaken for the take, and both at once
   is the one arrangement where that fails. `playClip` now stops the tone, and
   the tone ANNOUNCES itself (`whenWrittenPitchStarts`) so that report.js can
   stop the take — inverted deliberately, because `written-pitch.js` must not be
   able to import anything that can reach a Recorder. Both directions are checked
   in the browser.

Also: `npm run scan:rhythm` is wired into package.json (it was left out because
two sessions were editing that file); a dead `HUE` export was removed from
`scan-view.js`; and the close-up panel no longer says **"null up close"** — the
heading interpolated a degree's `name`, which the segmenter fills in and a
fixture does not, so a note that arrived without one put the word `null` in
front of a player over a graph that was drawing B3 correctly. It falls back to
the MIDI number's own name, which is the arithmetic the cursor readout two lines
below was already doing, and `score:follow` now asserts the heading is a note
name.

### What this review still gets WRONG, measured rather than guessed

### WHY EVERY BAR IS REFUSED — answered, with the page cropped and a new corpus

**Two causes, and the second one is bigger than the barlines.** The old entry
below said the blocker was the bar GROUPING; that is true and it is not the
whole of it.

**ONE: the barline reader accepts stems.** Dumping the reader's own answer per
stave on the Bach photograph and then cropping the page at 6x and looking
(`tools/crop.mjs` at `274,1277` and `705,1277`, side by side):

```
  staff 0  bars at 735, 1301          groups of 17, 17 heads     RIGHT
  staff 1  bars at 696, 1302          groups of 16, 16           RIGHT
  staff 2  bars at 713 881 918 956…   groups of 17, 4, 1, 1, 6, 2, 2
  staff 3  bars at 162 309 378 449…   groups of 1, 4, 2, 2, 2, 5, 16
  staff 8  bars at 1319 only          one group of 32   A BARLINE MISSED
```

The page is twenty printed bars of sixteen semiquavers. **Four of its ten
systems are barred exactly right, one has an interior barline missed, and the
other five are cut into fragments.** What the crop shows at 274,1277 is the STEM
of a beamed semiquaver group whose notehead sits on the top line and whose beam
sits on the bottom one: it fills the column between the lines, the beam is five
pixels of a fifty-pixel stave so nothing wide touches it over most of its
height, and it does not overhang. All three of `findBars`' tests pass on it. The
real barline at 705 in the same system is the same shape with nothing attached.
So `notesInOrder`'s bar-group sums come to **0.5 beats ×8, 4 beats ×7, 1.25 ×4**
— and the MODE over bar-groups is half a beat, because a two-note fragment and a
sixteen-note bar count the same.

**TWO: a bar sum is built out of CIRCLES, not out of noteheads.** `npm run
scan:bars-believed` (new, `tools/value-bars.mjs`) engraves the same 32 studies
`scan:studies` uses, where **every printed bar is four crotchet beats** and every
printed notehead's own coordinates are known, so a believed bar can be checked
against the heads actually printed in it. On those clean, computer-drawn pages:

```
  printed heads 692 · found 692 · things CIRCLED 943
  251 circles are not a printed notehead — 218 of them priced at a FULL CROTCHET
  note values themselves        676 of 692 right, 97.7%
  bars believed (as shipped)    6 of 200, of which 2 are a printed bar
```

**No arithmetic over those sums can recover a printed bar**, and that is why the
values being 97.7% right does not help.

**AND THEN THE 251 GOT AN ADDRESS.** That count sat here for weeks and nothing
could say WHICH circles they were. `value-bars.mjs` now tallies them by the
`via` field every head already carried, and the answer is a clean split:

```
  pass       real heads   circles on nothing
  shape           692                    0
  stem              0                  251
```

Every one came from `stemHeads`, the rescue pass that proposes a notehead at the
end of a bare stem. Drawn — the engraved page with a green ring on every printed
head and a red one on the rest — all 251 sit exactly where a **stem crosses a
staff line**. The classifier scores that little cross of ink 0.95 and over.

`STEM_BODY` in `scan-read.js` is the test that tells them apart, and it asks
about the candidate's own ink rather than about stem ends, which is why it is
not the sixth of the five geometric vetoes that failed before it: on the rows
that are NOT the staff line, is there anything across here wider than the stem?
The write-up beside the constant carries the sweep, the cost and what it does
not do. What it bought:

```
                                       before      after
  circles on nothing               251 of 943   67 of 759
  printed heads found              692 of 692  692 of 692
  BARS BELIEVED                      6 of 200    52 of 200
  …and IS ONE PRINTED BAR            2 of 6      52 of 52
  values right inside a believed bar 20 of 24   187 of 187
  scan:align, on the right head        94.8%       97.5%
  …on the WRONG head                     124          43
  …takes marking a squeak nobody wrote  53/64       38/64
```

It is nearly inert on a photograph — the Scanned page's stem pass goes from
37 real / 18 invented to 36 / 17, and `scan:import` at a 6px staff space is
byte-identical — because at that size a notehead and a line-crossing are four
pixels across and three. **Where it works is clean paper, which is what a PDF
import produces.** The cost is `scan:floor`, written up under its own heading in
CLAUDE.md and beside the constant: wrong takes refused fall from 116 of 128 to
79, and `COVER_FLOOR` in scan-view.js has since brought that back to 86. Thirty-four takes changed side and TWO mechanisms did it, separated by
dumping every crossing's verdict in both states and diffing — 31 are same-key
same-clef crossings whose agreement the phantoms had been suppressing (A major
arpeggio on A major scale, 0.39 to 0.79), which the note above `FLOOR` already
calls blind by construction, and **7 are takes the `ENOUGH` gate used to refuse
outright** because their marks were landing on phantom circles the page never
priced. Those 7 are a guard that was load-bearing by accident, and the corpus
argument does not cover them.

**`COVER_FLOOR` closes part of it and NOT that part.** With the phantoms gone a
wrong take also marks less of itself, so coverage — marks / notes played —
separates the two where it could not before (wrong takes covered 77% at worst
with the phantoms in, and 40% without them). `scan:floor` gained `--miss`, the
knob `align-check.mjs` has always had, because that is the measurement which
decides it: on a clean page a coverage floor of 0.9 refuses 31 of the 49
survivors and no right take, and on a page half of whose noteheads were never
found **the same 0.9 refuses 113 right takes of 113.** 0.45 is the last value
that refuses none anywhere measured, including a page two-thirds unread. It
takes 7 back — 42 survive rather than 49, and 6 rather than 13 on a half-read
page — with `scan:align` byte-identical in and out at both read qualities.

But the 7 it catches are **not** the 7 from the `ENOUGH` gate. All seven of
those still survive; the seven recovered were refused by the agreement floor
before. That was checked by dumping every crossing's verdict in all three states
and diffing them, rather than inferred from two totals happening to move by the
same number — which they did. **The ENOUGH seven are still open and are the
first thing to pick up here.** The lever that would answer that — a COVERAGE floor, which
only became usable once the phantoms were gone — is measured and printed by
`scan:floor` and deliberately not shipped, because the argument that pinned
`FLOOR` at 0.70 is about a badly-read page and that measurement has not been run.

**THE OBVIOUS REPAIR WAS BUILT, MEASURED AND REJECTED.** Merging consecutive
bar-groups until their values add up to a bar — merging only, never splitting,
so a barline the reader found stays evidence and the system with the missed
barline stays refused — is a clear win on the Bach photograph: **0 bars believed
becomes 9 of its 20, and every one of those nine holds exactly the sixteen
semiquaver heads printed in it.** On the corpus, where the answer can be
checked, the same code takes bars believed from 6 to 28 and the bars that ARE a
printed bar from 2 to 10: **eight more right bars bought with fourteen more
wrong ones.** It is kept whole in `tools/value-bars.mjs` (`MERGE=1`) and is not
in `src/`. Counting the agreement in NOTES rather than in bar-groups — which is
right about Bach, and defensible on its own terms — was measured the same way
and is also not shipped: 19 bars believed of 200 and **not one of them** a
printed bar.

**A DOT READER WAS BUILT AND TAKEN OUT TOO**, and the reason is in
`scan-stems.js`'s header with the crops: `npm run scan:values` came back 38 of
52 either way, with zero dots found. Instrumented, the blob beside mark 94 is
5×13 px at a staff space of 9.8 — the dot has merged with the staff line above
it — and the blob beside the dotted CHORD at marks 2 and 3 is 4×17, which is its
two dots blurred into one vertical smear. A dot at this printing is four or five
pixels across; it wants a sharper photograph or a shape classifier, not another
box.

**So the honest answer to "why is every bar refused" is that it SHOULD be**, and
the next thing that would move it is upstream of the values and upstream of the
grouping: stop circling the key signature.

- **THE WRITTEN-VALUE ROUTE DOES NOT FIRE ON ANY PAGE IN THIS REPO — including
  the engraved one.** `npm run scan:rhythm`: Bach 0 of 36 bars believed, Mozart 0
  of 34, Scanned 0 of 33, coverage 22%, 21%, 12% against the 0.55 gate. And on
  the walk's own clean engraving, 0 of 17. Its bar table (RHYTHM_DUMP=1) is
  `1n=0.5 1n=1 1n=0.5 1n=0.5 4n=4 4n=4 3n=2 2n=2 1n=1 3n=3 1n=1 3n=2.5 4n=2.5
  1n=0.5 3n=1.5 2n=2 2n=2` — every head on that page is an unbeamed filled
  notehead, i.e. a crotchet, so the two `4n=4` groups are what a whole bar looks
  like and everything else is a fragment or a value read as half of what it is.
  So the sentence a user gets about note values is the REFUSAL, always, and the
  written branch is exercised only by `tests/scan-rhythm.test.js`. That is
  honest, and it is not a bug in the join: the blockers are upstream, and both
  are already written up above — the bar GROUPING in `notesInOrder`, and beam
  counting on a small staff space.
- **`steadiness` IS A STATEMENT ABOUT THE READER'S BAR-GROUPS, NOT ABOUT A
  PLAYER'S PULSE — and THE REVIEW NO LONGER SAYS IT IS.** The number is
  unchanged and still means what this entry says it means; what changed is that
  `src/ui/score.js` stopped printing it as a verdict on the player. On a page
  whose bars are refused the sentence now reads *"The barlines found on this
  page cut what you played into 6 stretches, and the values printed inside them
  do not add up to equal bars — so one stretch running longer than another is
  not a fact about your pulse, and nothing here is claiming it is. How even you
  played is measured directly in the review of the take itself, which needs no
  page."* The old wording is kept below as the before, and `npm run score:follow`
  now asserts that on the photograph the bar sentence takes the `groups` route
  and does not contain the word "steady" — 37 checks, all pass. The claim IS
  still offered where it can be checked: where three or more bars were believed
  their lengths hold the same written music and are comparable, and that branch
  has no executor anywhere, exactly like the written-values sentence beside it.
  The before:
  On the walk's engraved take — synthesised on a 0.45 s grid, even by
  construction, with the free review beside it saying "100% even" — the review
  reads **"47% steady across 17 bars, dragging"**. A bar-group's length runs from
  its own first note to the NEXT group's first note, so a group holding one note
  of a four-note bar measures a quarter of that bar and then stands in the same
  list as groups that hold all four. A filter was written for this (drop the
  fragments before computing steadiness, the same argument as `RUNT` but on note
  counts) and it was TAKEN OUT AGAIN because it does not work: the median count
  over those seventeen groups is 2, so a half-the-typical filter keeps every
  fragment, and weighting by notes instead leaves groups of 2, 3 and 4 whose
  lengths are 0.9 s, 1.35 s and 1.8 s — the spread barely moves. The defect is
  not that fragments are short, it is that two bar-groups' lengths are only
  comparable when they hold the same music. The reasoning is in
  `scan-timing.js` beside the code so nobody writes that filter a third time.
- **THE FIRST TWO MARKS OF THE WALK'S TAKE ARE ON THE WRONG NOTEHEADS**, and the
  light dutifully lights them: the take was played from written head 36 and the
  first marks are head 9 at 0.6 s and head 30 at 1.05 s. The follow-along is
  exactly as accurate as `alignByPitch` and nothing in the UI can improve on it —
  this is the same misplacement class `npm run scan:align` counts (118 played
  notes on the WRONG notehead at seed 11, after the key fix). **Any screenshot of
  "the take, marked on the page" contains wrong rings**, and the caption has to
  say so.
- **`pairNotes` DID NOT REFUSE A WRONG PIECE. IT DOES NOW, and this entry is
  kept as the before.** Two octaves of D major over these pages used to come back
  `placed: true` with 24 marks and 77 silent markers, verdicts
  `{ match: 6, wrong: 6, octave: 7, near: 1 }`. `alignScore` has no refusal in it
  and always returns a path; the only refusal on the scanned side was
  `findStart`'s, which the pitch route never reaches on a page that read its own
  clef. **`pairNotes` now carries a confidence floor** — the share of judgeable
  marks whose pitch agreed EXACTLY, against 0.70 — and that fixture scores 6 of
  20, so it comes back `placed: false`, draws nothing, and the review says "what
  was played does not match the notes on these pages". The refusal is TERMINAL
  and does not fall through to the contour route, which on a photographed page
  is sure enough to run and would have laundered it into a different wrong
  answer. The floor was DERIVED, not picked: **`npm run scan:floor`** builds both
  distributions on the same 32 studies — 4 takes from each study's own music
  against 4 played from a DIFFERENT study, crossings chosen
  same-clef-and-same-key first — and prints the trade curve. Clean: RIGHT n=120
  min 77% median 93%; WRONG n=120 median 54%, 90th 79%. `--phone`: RIGHT n=88
  min 64% median 91%; WRONG n=76 median 64%, 90th 91%. At 0.70 it refuses **0 of
  120 clean and 1 of 88 photographed** right pairings and **96 of 120 / 47 of
  76** wrong ones; 0.75 costs five more good takes for nine more wrong ones.
  What survives it is the crossings whose PITCH CONTENT IS IDENTICAL — an
  arpeggio over its own scale, a relative minor scale over its major — and no
  floor on a pitch-agreement statistic can catch those, because every note
  really is on that page in that order. **On real paper** — the only evidence
  outside the engraved corpus — two octaves of D major over the three marked
  photographs score 0.58, 0.29 and 0.33 and are refused on all three, while the
  walk's own 28-note take scores 1.00 on all three and is placed. That 1.00 is a
  TAUTOLOGY about pitch (the take is synthesised FROM the reference) and says
  only that the floor does not refuse the app's own walk, which `PHOTO=0`, `1`
  and `2 npm run score:follow` confirm at 36 PASS each. The Bach row is the
  thinnest margin anywhere: D major against a page in G major shares six notes
  of seven, and 0.58 is twelve points under the floor rather than two.
  **And note what the floor cannot do.** `PHOTO=1` places all 28 marks while
  only 11 of them land on the notehead they were built from. This number asks
  whether the notes belong to the page, not where a mark went, and a take on the
  right page in the wrong place is invisible to it. The whole table is above
  `FLOOR` in `scan-view.js`.
- **THE THREE RED UI CHECKS ARE STILL RED AND ARE IDENTICAL TO THE BASELINE,
  LINE FOR LINE.** Not "the same count" — the runs were diffed against a
  worktree at `148a4c7` served on its own port: `score:review` 15 FAILED,
  `score:heads` 3, `score:playback` 2, every failing line and every number in its
  detail string the same. They fail because those checks draw ellipses on five
  lines with no clef, where the reader finds 143 noteheads for 80 drawn and
  prices none of them, so the pairing refuses and nothing is drawn to assert on.
- **`score:pdf`'s 2 failures are THE SAME REFUSAL AND NOT A DRAWING FAILURE, and
  that was measured rather than assumed.** It looked like the review might be
  unable to draw a PDF-backed part — which would have been a hole under the
  commonest way a part gets into this app — because that check reads 127
  noteheads off its own PDF and then draws 0 pages. So the check now prints the
  pairing and the sentence the stage is showing: `placed=null 0 marks over 0
  heads`, and on the page *"40 notes played, and 127 noteheads read off the pages
  — but what was played does not follow the shape of the notes on these pages"*.
  Its PDF is drawn ellipses with no clef, so no head is priced, the contour route
  runs and refuses, and `renderScanTab` returns before `openPaper` is ever
  called. **The review demonstrably CAN draw a PDF page**: `score:follow`'s
  photograph step draws the Bach PDF at 1656 px with 28 rings on it. (A baseline
  for `score:pdf` could not be taken — a second vite serving a `148a4c7`
  worktree shares `node_modules/.vite` and pdf.js will not load under it.)

### What is NOT verified, even now

- **The written-value sentence in `src/ui/score.js` has never been rendered by
  anything.** `notesJudged > 0` is false on every page in the repo, so the branch
  that names notes on time, late and early is exercised only by
  `tests/scan-rhythm.test.js` at the module level — the WORDS have no executor.
  It loads (the browser reports 0 page errors) and that is all that is known.
  **The same is now true of the bar sentence's `believed` branch** — the one
  that offers a comparison of bar lengths because the bars it compares hold the
  same written music. `barsBelieved >= 3` is false on every page here, so what
  `score:follow` asserts is the `groups` branch beside it, and the believed
  wording is written and unexecuted. Reported, not claimed.
- **`follow()` on an ENGRAVED score.** No tool in `tools/` drives it, so the
  one-line signature change in `score-tab.js` is argued from the code
  (`score-view.js`'s `noteheadFor` takes one argument and ignores a second;
  `noteheads.get(null)` is already null-safe) and not measured.
- **`npm run scan:steps`, `scan:clef`, `scan:clef-hard`, `scan:key-safety`,
  `scan:corpus` and the rest were NOT run this round**, deliberately: nothing
  upstream of a step, a clef or a head moved, so none of them can see the diff,
  and a measurement that cannot see a change is not evidence about it (rule 4, in
  the honest direction).

### The two things to measure first, next

1. **DONE, and it was `BAR_ATTACHED`: the Bach's forty barlines were mostly
   STEMS and are now twenty-two, with nine bar-groups summing to exactly four
   beats. See the top of this file. What is left of this item is the FALSE
   CIRCLES — a time signature and the lower halves of printed sharps — which is
   now the whole distance to a believed bar.**
   **WHERE THE BARLINES ARE COUNTED, in `notesInOrder`.** It is the single
   blocker on everything the note values could buy, and the Bach regroup probe
   already quantifies it: `PER=16 npm run scan:rhythm` regroups that page to the
   sixteen heads its printed bar actually holds, changes nothing else, and the
   join goes from 0 of 36 bars believed to **16 of 20**, with 256 of 320 notes on
   the written route. The values on that page are already 99.1% right.
2. **THE MISPLACED MARKS, ON THE CONCERTO, WITH THE PAGE DRAWN UNDERNEATH.**
   `npm run scan:align` measures the population on engraved studies; nobody has
   yet looked at ONE of them on real paper. There is now a place to start that
   needs no new fixture: `PHOTO=1 npm run score:follow` puts 28 notes taken
   verbatim off that page's own noteheads back onto it and only 11 land where
   they came from, against 27 of 28 on the Scanned score. The walk prints the
   first four marks and the first four noteheads lit every run, and `--shots`
   leaves the page with the rings on it.

### One environment trap that cost this round an hour

**A browser check run straight after an edit measures a DIFFERENT COPY of the
edited module from the one the app is using.** Vite serves an edited module at a
versioned URL (`/src/x.js?t=…`) to everything that imports it, while a check's
own `await import('/src/x.js')` asks for the unversioned one — two module
instances, two sets of module state. MEASURED: five checks in `score:follow`
failed with "0 noteheads lit" and "tone sounded midi null" against code that was
working, `report.js`'s follower set and `written-pitch.js`'s `last` living in one
copy while the check read the other. Reverting the change did not fix it;
restarting `npm run dev` did, and all 32 checks then passed. **Restart the dev
server after editing and before measuring.** This is also in CLAUDE.md.

## The next step, in order

**RANKED BY HOW MUCH REAL MUSIC EACH ONE BLOCKS, not by how interesting it is
and no longer by what was asked for first.** The ordering rule this round used,
written down so the next round can disagree with it deliberately: an item scores
high if it fires on a PHOTOGRAPH (which is the only input the app ever gets), if
it is silent when it fires (a confident wrong answer beats a refusal for damage),
and if the music it spoils is music a cellist actually plays. It scores low if it
costs precision only, if it is measured on drawn pages nobody photographs, or if
it is a debt line that has not grown in three rounds.

**CHORDS ARE NOT ON THIS LIST AT ANY RANK, and that is a measurement.** The
cluster rule fires about 43,000 times across the three marked photographs and
takes exactly 4 hand-marked noteheads, 2 of them real double stops. A synthetic
page of stacked thirds loses half its heads and a real page loses two notes; the
entry under "What is measured and does NOT work" carries both numbers and the
caveat that the 43,000 is not reproducible from the tree.

**Two consequences of that rule worth naming before the list.** The user's own
first complaint — false circles standing in a stem — has fallen to seventh,
because it costs precision and nothing else, and because four rules have now died
on it with the ratio getting WORSE rather than better. And the top four items are
all the same sentence in different clothes: **this reader is measured almost
entirely on clean engraving and it is deployed on a camera.**

**WHAT THE PITCH ROUNDS CLOSED, so nobody re-opens it.** Naming a pitch is BUILT
and so is the accidental in front of the note — the old items 11 and "an
accidental against a single notehead" are struck, not deferred. The −44/−45/+45
group was one notehead reported by two staves (`dropDoubledHeads`) and
`scan:studies` now reports `wrong by semitones {}` on a clean page. The `+1`
group was `study-check.mjs` under-printing a cancelling natural, and the harness
is fixed. "Keys misread, 17 of 32" was a column reporting the PAGE key on
single-system pages; the column now prints all three answers. Re-marking
`pages/truth/scanned.truth.json` is DONE and paid for itself twice over, and the
phantom title-block stave went with it. **A mixture retrain of `acc-model.js` is
NOT the next accidental job** — clean and `--camera` both read 30 of 30
accidentals and invent none on 662, and at `--phone` the loss is the NOTEHEADS
under the accidentals, which is item 2.

**WHAT THE STAVE-MODEL ROUND CLOSED, and the ONE thing it left.** The step on a
photograph is fixed — Bach 77.8% to 92.3%, the Concerto 88.7% to 91.3%, the
Scanned score 87.0% to 92.7%, and the BWV 1007 opening comes back right (see
*The stave model waves*). **Do not re-sweep the smoother's windows**; five of
them are measured in the pitch dead-ends. What is left is one item, and it is
now the whole remainder on that page:

**WHAT THE CLEF ROUND CLOSED AND WHAT IT OPENED.** A mid-system TREBLE is read
(54 of 60, zero false fires, and `bass->treble` scores exactly what its control
scores); `midBassAt` is DELETED with the sweep that says no replacement exists;
and the clef is no longer read as the accidental in front of the next note. Three
things it leaves, each with the fixture that can now see it:

0a. **THE RETURN TRIP IS STILL NOT READ, and it is the commonest change a cello
    part makes.** A passage goes up in tenor and comes back down in BASS, and
    `npm run scan:clef` carries two rows labelled `NOT READ, on purpose` that
    will keep missing until somebody brings a 2-D measurement. 129 notes of that
    block's debt and 72 of `scan:clef-change`'s 86 wrong pitches are this one
    thing — 30 on `tenor->bass` where the control gets none wrong, and 42 on
    `treble->bass` where the control gets 4. It is NOT a constant to loosen —
    see the clef dead-ends.

0b. **`accidentalFor` READS THE PREVIOUS NOTEHEAD AS A FLAT AT TIGHT SPACING, and
    the new `+ a sharp on the next note` row in `scan:clef` is what exposed it.**
    Six of that row's notes come back wrong. It is NOT the clef change's fault
    and that is measured, not assumed: the row beside it reserves the clef's
    width and prints NO clef, and the same six come back wrong. A cue clef eats
    width, so the notes after it sit 2.09 staff spaces apart against the plain
    control's 2.36, and at 2.09 the patch `ACC_OFFSET` centres 1.35 spaces left
    of the head lands on the previous head and its stem. One false flat costs
    two notes, because `applyAccidentals` then carries it.

0c. **A SPURIOUS KEY SIGNATURE WHERE THE FIRST NOTE SITS TOO CLOSE TO THE CLEF.**
    Six of `scan:clef-change`'s 84 wrong pitches, and DIAGNOSED RATHER THAN
    TOUCHED. `scan:clef-change` puts its first notehead about 9.4 staff spaces
    past the stave's left end and the key band runs from 3.6 to 12.6, so the note
    is inside the place a signature is printed and is read as one — at
    confidence 0.01 and 0.04 on the treble pages, and 0.96 on one bass page. The
    fix would be a threshold inside the key reader, which is the one thing in
    this project gated by a sacred zero, and six notes on a fixture whose own
    layout causes them do not buy that risk. If a round does take it, the first
    measurement is whether a real engraver ever sets a note that close.

0d. **42 WRONG STEPS ON THE OTHER TWO PAGES THAT THE STAVE MODEL DOES NOT
    EXPLAIN, AND NOBODY HAS LOOKED AT ONE OF THEM.** `scan:steps` prints what is
    to blame, and it blames the model for 13 of the Bach's 19 wrong steps and for
    **0 of the Concerto's 20 and 0 of the Scanned score's 22**. Every mark on
    both pages sits in its `0.0 to 0.3` model-off band with nothing above, and
    the fourteen wrong marks it lists in full — it prints fourteen of each, not
    all forty-two — carry model errors of −0.22 to +0.18 and −0.22 to +0.25
    steps. There is a second cause, it is the ENTIRE remaining pitch error on two of the three
    pages, and it is undiagnosed. Three things to hand the round that takes it.
    **The error is not symmetric** — the Concerto reads 16 of its 20 LOW, the
    Scanned score is 12 high against 10 low. **Both pages sit at a 10 and 9.6
    pixel staff space** against the Bach's 12.1, and both put far more marks
    between a line and a space: of the offsets the harness counted, 139 of 325
    and 156 of 396 are 0.3 of a step or more, against the Bach's 45 of 250. And
    **neither column has a self-check behind it**: `pages/truth/bach.pitch.json`
    is the only file of steps known from the MUSIC, so the harness's 25-of-32 is
    a statement about the Bach alone and the 91.3% and 92.7% are trusted, not
    verified. Start by drawing four of the 42 (`STEP_DRAW=`), and do NOT start by
    re-refining the head's own y — that is measured and dead on the Bach.

0. **A STAVE `fillMissedStaves` PREDICTED IS STILL FITTED WITH A QUADRATIC, AND
   IT HOLDS EVERY REMAINING WRONG STEP ON THE BACH PHOTOGRAPH.** Systems 8 and 9
   there are inventions, not tracks; they carry ALL 45 of the page's marks where
   the model is half a step or worse from the print, and the reader is wrong on
   64% of the ones it answers there against 4.3% everywhere else. The smoother
   cannot be pointed at them as they stand — their per-strip answer swings 9.5
   and 10.1 steps end to end, because it is a local search in strips too faint to
   track rather than a tracked curve. So the job is to make a predicted stave
   TRACKABLE (give it real evidence per strip, or refuse the strips that have
   none) and only then to smooth it. Measure with `npm run scan:steps`, whose
   per-system table is where all of this is visible.

---

1. **CLOSED — see "THE ROUND THAT WROTE THIS" at the top. A page whose systems
   disagree now names nothing, and `npm run scan:key-gate` holds it at zero.
   What follows is the entry as it stood when it was item 1.**
   **THE WRONG KEY AT PHONE QUALITY. It is the only confidently wrong answer
   anywhere in this project's measurements and nothing gates it.**
   `npm run scan:studies -- --phone` — 0.72 downscale, blur 1px, contrast 0.62,
   JPEG 0.6, so a 14-pixel staff space arrives as 10 — reads **`stave key right
   29 of 50, WRONG on 2`** and **`wrong by semitones {1:2, 2:3, -1:3}`**: eight
   notes named a pitch that is not the printed one, on `Bb-major-scale` and
   `Eb-major-scale`, two flats and three flats. Clean and `--camera` are 0 wrong
   at both levels with `wrong by semitones {}`.
   **Why it is first.** Every other item on this list costs a refusal, a false
   circle or a wrong note LENGTH. This one puts a semitone on every note of a
   degree and reports it with confidence, which is the failure this document's
   own standard calls unforgivable, and it does it on the exact input the app
   receives. **The PAGE level held** — `page key right 5 of 32, page key not
   agreed 27 of 32, WRONG on 0`: five pages still agreed a key and all five were
   right, twenty-seven declined, and NOT ONE page named a key that is not the
   printed one. So `agreeKey`'s two-witness floor did its job and every wrong
   note lands where the page could not agree and `notesInOrder` falls back to
   `staff.key` — which is the shape of the fix as well as the shape of the bug.
   **What doing it means, in order.** First make it a GATE: `--phone` is a flag
   somebody remembers to pass, and `scan:key-read`'s sacred zero is a different
   corpus that cannot see a page rule at all. A photographed corpus with a
   must-be-zero wrong-key line is the deliverable, and it should be wired the way
   `scan:key-safety`'s third block is. Only then look at the two studies. **One
   CONJECTURE to test rather than a finding to build on**: both are FLAT
   signatures, and flats are where `scan:key-read` is weaker too (1 to 3
   accidentals is 42 of 42 sharps against 36 of 42 flats), so the two
   measurements may be pointing at one cause. Against it: that tool's shortfall
   is concentrated in the small PHOTOGRAPHED cells rather than in flats as such —
   every clean cell is 21 or 22 of 22 in both clefs at every size. Two witnesses
   is not a pattern.

2. **CLOSED — it was `beamMask`, and none of the five suspects below. See the
   top of this file for the measurement. What follows is the entry as it stood.**
   **WHY A HEAD WITH AN ACCIDENTAL TOUCHING IT DISAPPEARS ON A PHOTOGRAPH.**
   Measured, controlled and unowned. At `--phone`, 61 of the studies' 692 heads
   are lost and **28 of the 61 are among the 30 that carry a printed
   accidental** — 4%
   of the notes taking 46% of the losses, with no detection of any kind within a
   staff space of them. **It is not the accidental model**: it reads 2 of 2 of
   the survivors right and invents none on 629, so a retrain has no glyph left to
   judge. `open`, `HEAD_CUT`, the `fill` floor, the sideways-run bound and
   `dropDoubledHeads` are all ruled out by patching one string in the served
   module, and the control that makes it a finding rather than a correlation is
   engraving the same notes at the same size with the accidental GLYPHS
   suppressed, which brings all five missed heads on `A-minor-scale` back.
   **Why it is second.** Same input as item 1, one rank lower only because a
   missing note is a refusal and a wrong key is a lie. Real music is full of
   accidentals and this loses the note under every one of them. It is a
   `findHeads` question, it needs no new instrument — `npm run scan:studies --
   --phone --dir <one study> --keep <dir>` engraves, scores and writes the PNG
   out — and the table is under *The accidental reader is not the bottleneck*.

3. **STALE, AND RE-MEASURED: there is no gain left here to take.** The constant
   in the tree is `LEDGER_LONGEST = 3` with the second judge's overrule beside
   it, and the entry below predates both the overrule and the repair of
   `scanned.truth.json`. `npm run scan:whatif -- 'const LEDGER_SURE = 0.9;'
   'const LEDGER_SURE = 0.8;'` moves precision and recall by 0.0 points on all
   three pages, so the heads this entry is about are no longer being thrown away
   by this rule. Whatever the Concerto's remaining fifteen misses are, they are
   not this. The entry is kept for its history.
   **`LEDGER_LONGEST = 4`. One constant, and the largest measured recall win
   left with nothing in front of it.** Eleven of the Concerto's missed notes and
   three of the Scanned score's are found by `findHeads` at classifier scores of
   0.835 to 0.998 and then thrown away by `offStaveIsCredible` for standing on a
   chain of ledger lines — consecutive high notes each carry a ledger stub, the
   stubs nearly touch, and `ledgerRun`'s gap bridge chains them into one rule
   three to five spaces long. A rule written to catch a head sitting on a beam
   catches a passage of ledger notes instead. **A cello part lives up there**,
   which is why this outranks the two precision items below it.
   **It needed the truth file repaired and the repair is done.** Every figure in
   its entry under "What is measured and does NOT work" is AT THE TIME, against a
   denominator of 440 or 453 with ten of those ledger heads unmarked and thirteen
   title-block marks on; ten of the twelve heads the entry predicts away as
   "invented" are among the thirteen now ADDED to the file, and the two on the
   phantom stave cannot happen at all any more. **The corrected reading the entry
   works out by hand — twelve real notes at no precision cost — is now something
   `bench` will simply print.** Note what is left to gain: the Concerto's sixteen
   missed notes are now very nearly the WHOLE recall gap on the marked pages,
   since the Scanned score is at 99.5% and the Bach at 99.7%. Nothing else in the
   entry needs redoing — its six failed discriminators are properties of the ink.

4. **COUNTING BEAMS ON A SMALL PHOTOGRAPH.** `npm run scan:sizes`: beam accuracy
   is 100% at a working staff space of 14, 92% at 12, 49% at 8 and 10% at 6,
   while recall stays at 93% or better throughout. **Every note is found and
   given the wrong length**, which is the failure a practice app feels as the
   take drifting out of step — the alignment this whole reader exists to produce.
   `densePhoto` shows the same thing at a comfortable size, 65% of its beams
   behind 99% recall, so it is not purely a size problem. It is `readValues` in
   `scan-stems.js`, which already measures its own beam pitch and thickness off
   the page; the question is what it should fall back to when the page cannot
   resolve a pair, which is precisely the `halfSpaceThree` case that block exists
   for. Blocked on nothing.

5. **THE REST OF THE MID-SYSTEM CLEF.** A C-clef is read — 9 of 12 printed, 0
   false fires on 13,148 photograph windows and 48 pages of drawn furniture, 0
   notes named wrong where a change was found — and three jobs are left, each
   with a row in `npm run scan:clef` waiting for it:
   - **`applyAccidentals` ACROSS a clef change, which is silently wrong today.**
     It keys its in-force map by `step`, which is right within one clef and wrong
     in both directions once the clef changes mid-bar: an accidental printed
     before the change carries to the wrong note, and a note at the same PITCH on
     a new line loses one it should keep. It needs an accidental and a clef change
     in the SAME BAR, which no fixture has. **That is the row to add first** — it
     is a silent wrong pitch, which is item 1's category, and it is cheap.
   - **bass and treble printed mid-system.** Their notes stay named in the clef
     the system began in. A treble mid-system already passes the height and
     continuity tests; what it has no equivalent of is the WAIST, because only a
     C-clef is symmetric about the line it names. These need a DIFFERENT
     discriminator, not a loosened one, and two candidates are already dead.
   - **the clef engraved at 0.6 em**, 2.37 spaces tall against a bound of 2.6 —
     and that bound is what refuses the shorter furniture, so it cannot simply be
     lowered; it wants the false-fire block re-run at every value.
   - **suppressing the mid-system clef's own false circles**, the only part of
     this that touches what gets CIRCLED and therefore the only part that can
     move `bench`.

6. **A PHOTOGRAPHED PAGE IN C MAJOR STILL NAMES NO NOTE, 6 of 6.** The clean page
   names them all now; the camera smears the clef, the overhang walk steps
   further right, and the first note of the bar then stands inside `KEY_ADJACENT`
   of where the key scan starts — so the scan ends on the note (`wide` or `tall`)
   instead of on clean paper and the page is refused. **The refusal is correct**,
   which is why this is a clef-band job and not a loosening of `agreeNoKey`: the
   fix is to measure where the clef ENDS. C major and A minor are a large share of
   what a student photographs, and on a photograph they currently get nothing.
   `npm run scan:key-safety` prints it as a debt line every run.

7. **THE FALSE CIRCLES STANDING IN A STEM. The user asked for this and it is NOT
   fixed — and it has fallen down this list on purpose.** "Many false circles
   still happen oftentimes in the stem at the bottom." It costs PRECISION and
   nothing else: an extra circle is cosmetic where a missing or misnamed note
   breaks an alignment, which is why six items now sit above it. Read the
   one-head-per-stem entry in "What is measured and does NOT work" before
   spending a day here, because it bounds the problem better than the rule does:
   - **The population is tiny where the rule can see it.** Of 691, 627 and 759
     stem runs on the three pages, **0, 0 and 4** propose at both ends of one
     stem, and all of it is on one page.
   - **Every proposal the stem pass makes fails the shape tests, real ones
     included — 73 of 73.** `stemHeads` calls `headScore(headPatch(...))` and
     runs none of `findHeads`' chain, so no test drawn from `findHeads` can ever
     filter it. That is what the stem pass is FOR.
   - **What has NOT been tried is attacking it BEFORE the hunt rather than
     after.** Every phantom looked at is a stem crossing a STAFF LINE, and
     `owned` is already the shape of a rule asked at the stem end.
   Live: the stem pass buys 44 real notes for 18 false ones on the Scanned score,
   4 for 0 on the Concerto and 1 for 1 on the Bach; 33 of the three pages' 57
   invented heads stand in a stem and 16 of those 33 came from the SHAPE pass.
   **AND THE TRUTH FILE NO LONGER EXCUSES IT.** The one argument this item had
   left is spent: the file has been swept in both directions and the ratio the
   four dead rules broke on is now **22 invented against 146 correct** where it
   was 25 against 156. That is not a better ratio. Whatever is tried next has to
   be a new idea and not a re-run.

8. **`STEM_CUT`, which blocks every future retrain and therefore the shape tests
   too.** It is a bar on the classifier's own score, read off `bench` rather than
   off the cross-page table, and it is the only such number the honest
   measurement cannot see: `scan:patches` dumps with the judge OFF and
   `stemHeads` only runs with the judge ON, so no stem-pass candidate has ever
   been in `pages/patches.json`. A refit against the current shape tests moved 22
   real notes out of the Scanned score's stem pass and no value of `STEM_CUT`
   recovers them. **Since any change to the shape tests forces a retrain, this
   blocks them all** — including item 2, if the answer there turns out to be a
   shape test. The proposal is to stop carrying a number: ask for a quantile of
   what this same model says about the heads the shape pass ALREADY accepted on
   this page, which moves with the model instead of being invalidated by it. That
   is a change to the head passes, so it needs its own retrain — do it in the same
   round and get the three-page refit installed as the proof. Doing it also gives
   the shipped weights a reproducible held-out figure again, which they do not
   currently have.

9. **A PAGE OF A DIFFERENT KIND, AND A PAGE IN A KEY THAT IS NOT ONE SHARP.**
   These were two items and they are one: both are the same shortage, which is
   that this reader has three real pages and two of them are the same music in
   one key. Handwritten, a piano score, a photograph of a page in three flats —
   any of them is worth more than another sweep. **The Scanned score does not
   count as a different kind**: it is a third scan of the Concerto's music, and
   the one clean cross-page row it produced moved a point. Variety is the lever
   rather than volume — `scan:curve` reads 93.5% at 127 patches and 95.0% at 845,
   not monotone on the way. And the drawn key corpus, real Bravura though it is,
   cannot test a photocopy, a bent page or a pencilled fingering through the
   signature; every failure the key round fixed was found on drawn pages or in
   the tables rather than on paper.

10. **THE BACH'S BAND SCAN.** Only four of its ten systems reach the key reader,
    because its bands come back 0.67, 1.16, none, 0.74, 1.15, 1.56, 1.14, 0.57,
    0.57 and 0.89 spaces wide where a sharp is about 1.2 — half a sharp on five
    systems and nothing at all on a sixth. **The page-agreed reach has taken the
    CIRCLES off those systems and has not made them READ**, which is the right
    division of labour: the widening decides what is suppressed and cannot decide
    what a glyph is. Four witnesses is the Bach's whole margin against a floor of
    two. `npm run scan:key-why -- Menuet.pdf` shows which and `CROP_MARKS=1 npm
    run scan:crop -- Menuet.pdf 84,700` shows why. Worth more than lengthening
    long signatures: a bass page at 12 pixels a space is the easy case, and it is
    the one still failing.

11. **THE READER STILL CANNOT READ A CLOSE-UP, and nothing in the repo measures
    it.** Blown up past a working staff space of about 35 — a phone held near two
    bars on a stand, which is the commonest thing a practice app will be handed —
    the Menuet finds NO STAVE AT ALL. `scan:sizes` cannot reach that far: its
    canvas is `space * max(50, 12 + widest span)` and `readPage` clamps to 1400,
    so the working space can never exceed 28, and reaching further means narrowing
    the drawn page. This rests on one earlier probe and it should not — the first
    job here is a measurement, not a fix.

12. **CAPTURE QUALITY IN THE APP.** `src/ui/scanner.js` already outlines the
    page, splits a book spread and asks the user to come closer. Better input
    lifts every number in this document without touching the reader, and after
    items 1, 2 and 4 it is the cheapest thing on the list that moves a
    photograph.

13. **`KEY_REACH = 9`.** What is left of the truncation hole, and measurable
    rather than suspected: **28 of the 352 drawn scans end on `reach`**, which is
    the scan hitting its own nine-space bound with the next accidental's ink
    already in view. Its comment says "seven flats and slack" while `GLYPH_WIDE`'s
    says seven flats is ten spaces of band, and those cannot both be true. Only 3
    of the 28 would have read correctly, so it is worth little on the drawn
    corpus — and it is a loosening of the BAND, and the band is what suppresses,
    so it has to be measured against `bench` and the corpus and not against
    `scan:key-read` alone.

14. **THE TWO DEBT LINES `scan:key-safety` PRINTS, which have not grown in three
    rounds.** Six heads eaten by the band on three photographed pages, each with
    a fleck of grain sitting in the gap at exactly two spaces — the mechanism is
    known and written above `column()`, a speck in the same column as a notehead
    is joined to it, and **both obvious attacks are already measured and dead**,
    so it needs a third idea rather than a sweep. And thirteen heads on the PAGE
    block, where a system's own key band runs into the first note of the bar,
    which is `findKeyBand` over-reaching — the opposite failure from the one the
    widening repairs, and the two want looking at together. Neither is new; both
    are printed every run so neither can grow unnoticed.

15. **`STRIPS = 40`, the last of the ranked fitted constants, deliberately left
    alone.** A strip is 3.5 staff spaces on the three marked pages and 1.0 — one
    beam wide — at a working space of 35, so it is genuinely the wrong units, and
    `pitch` is already measured four lines before the strips are built. It was not
    touched because the strip grid is the coordinate system every downstream
    measurement is expressed in: `readPage` reports `strips: STRIPS`, and
    `tools/crop.mjs` and `tools/reader-look.html` index into the line arrays with
    their own arithmetic. Making it per-page is a refactor with a silent
    mis-indexing failure mode, not a threshold change, and the two cheaper halves
    of the same constant — the crossing test and the rejoin — took `downStems`
    from 0% to 97% without it.

**AND TWO HAZARDS THAT ARE NOT WORK ITEMS BUT WILL COST A ROUND IF FORGOTTEN.**
`tools/reader-look.html` rebuilds its truth object from scratch on save, so one
save over any of the three truth files silently drops `cleaned`, `removed` and
`added` — the entire record of why the Scanned score's denominator is 412 and not
453. And four rounds of reader work sit UNCOMMITTED in this tree; `git stash`,
`git checkout` or a branch reset destroys all of it, and every number in this
document with it.

### And keep this document honest

The round that produced this list was spent entirely on repairing about a dozen
figures in it that no longer reproduced. **Run the command and paste what it
printed. Do not paraphrase a number you did not watch a tool produce**, and when
a mid-round `before` / `after` table is left behind, label it *at the time* and
point at the live figure. The three failure shapes are named at the top of
"Where it stands".

**THREE MORE, ALL LEARNED FROM ONE COMMIT AND ONE BUG, and all of them are about
what a number is evidence FOR.**

- **A measurement that cannot see your change is not evidence about it.**
  `20e004d`'s message quotes `bench`, `scan:studies`, `scan:key-read` and
  `scan:corpus` behind a mid-system clef reader that none of them can see, and
  the one block that could see it went from 0 false fires to 155 unread. Before
  quoting a number as reassurance, say out loud which of your lines it could have
  moved.
- **Say whether a figure is reproducible from the tree, and how.** Three numbers
  in this document are not commands anybody can run: the 155/118 before the
  deletion (needs `midBassAt` restored), the 43,000 cluster fires (needs an
  instrumented `scan-read.js`), and the clef-change fires on the three
  photographs (needs a probe nobody committed). Each now says so where it stands.
  A number without a command behind it is a memory, and this document has been
  wrong from memory before.
- **Scoring the position of a thing is not scoring the thing.** `bench` was at its
  best figures on the page whose opening bar was named a second wrong, for
  rounds. When a new capability lands — a name, a length, a fingering — ask what
  measures the NEW half before quoting the old one at all.

**And a practical one.** Two sessions share this machine and the tools drive a
headless browser: at load 19, `scan:key-read` dies on puppeteer's
`protocolTimeout` and `scan:key-safety` (which raises it) merely takes ten
minutes. Check `uptime` before believing a failure, and re-run the tool from a
copy with `protocolTimeout` raised rather than concluding anything about the
reader.
