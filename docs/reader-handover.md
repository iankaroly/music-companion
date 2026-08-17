# Reading a page of music — where this is up to

The page reader finds staves, clefs, barlines and noteheads on a photograph of
sheet music, so a recording can be paired with the notes on the page. This is
the state of it, what is measured, and what to do next.

## Run it

```
npm run dev                  # port 5199 — everything below needs this running
open http://localhost:5199/tools/reader-look.html
```

Drop a PDF or photo in. Tick **marking mode** to build ground truth: click a
ring that is not a note, click bare paper where one was missed, save. Marks are
positions, not indices, so they survive changes to the detector — that is the
whole point of them.

### Some of the commands named below exist only in the working tree

**Nothing has been committed on this branch (`reader-pitch-from-page`) by any of
this work.** A fresh checkout does not have these. If a command below is not
recognised, this is why — and if this branch is ever reset or the work is picked
up from a clean tree, these are what has to be re-created before the numbers in
this document can be reproduced at all.

Untracked FILES (`git status` shows them as `??`):

```
tools/key-probe.mjs         backs npm run scan:key-why
tools/key-read-check.mjs    backs npm run scan:key-read
tools/key-safety-check.mjs  backs npm run scan:key-safety
```

`package.json` SCRIPTS that exist only as an uncommitted edit (`git diff
package.json`) — five of them:

```
scan:sizes        scan:few        scan:key-read
scan:key-safety   scan:key-why
```

`scan:sizes` and `scan:few` point at `tools/scan-corpus.mjs`, which is tracked
but MODIFIED. **Checked against the committed file rather than inferred** —
`git show HEAD:tools/scan-corpus.mjs` contains `CORE` and `HARD` and contains
the strings `SIZES`, `FEW`, `--sizes` and `keyReach` **zero times each**. So
from a clean checkout `npm run scan:corpus` prints CORE and HARD only, and the
SIZES and FEW tables in this document cannot be produced at all.

Everything else in the tool table below is committed and works from a fresh
clone.

## Where it stands

`npm run bench` — every marked page, scored together:

```
page          space  found  really  precision  recall     F1   invented  missed   bars  clefs
Bach           12.1    324     319      98.1%   99.7%  98.9%         6       1     34  10/10
Mozart           10    341     332      89.1%   91.6%  90.3%        37      28     36  10/11
Scanned         9.6    455     440      91.2%   94.3%  92.7%        40      25     34  10/11
mean                            92.8%   95.2%  94.0%
```

**THE GROUND TRUTH ON TWO OF THESE PAGES WAS WRONG, AND IT WAS WRONG IN THE
READER'S FAVOUR.** Sixteen marks have been removed across the two files, each one
cropped and looked at before it went:

- `scanned.truth.json`, thirteen marks standing on the two crossbars of the
  printed key-signature sharp — a pair on system after system. Crop 114,497 and
  114,1199 and 111,635: all three are the sharp, with the first real note of the
  bar correctly ringed to the right.
- `bach.truth.json`, one mark on the round head of the bass clef (crop 100,310)
  and two clicks one pixel apart in the fork of a quarter rest (crop 311,751).

This matters more than the point of recall it is worth. A truth file that calls
the key signature a note **rewards the reader for circling it** — every
improvement to the key-signature suppression then shows up as a recall
regression, and the measurement argues against the fix. Both files record what
was removed in their own `cleaned` and `removed` fields; nothing was deleted
that was not first drawn on screen and looked at.

`tools/truth-check.mjs` reports such marks under SUSPECT LABELS and `--clean`
writes a corrected copy. Its clef test is now ONE-SIDED — everything at or left
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
(Recall reads 95.2% now; the difference is the three bad marks taken off the
Bach afterwards, not anything the reader does differently. The live figures are
the table at the top.) That is the only shape of change this table is allowed to
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
document measured against **453** notes on that page is stale by construction;
the denominator is 440.

An earlier round moved that from 91.6% / 93.7% by two changes, both aimed at
noteheads and neither at a threshold: **one head per stem end** in `stemHeads`,
and **centring a kept head on its own ink** at the end of `findHeads`. Every
other measurement was untouched by them **at the time** — `scan:clef` 15/15,
`scan:key-read` 163 of 224, 540 unit tests. The comments above each say what was
swept and what it cost. Live today: `scan:key-read` reads **172 of 224** printed
signatures right and there are **563** unit tests.

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

**The thirteen key-signature marks have since been removed**, the denominator is
440, and the page reads **91.2% precision to 94.3% recall** today — the row in
the headline table above. The thirteen on the title block have NOT been removed,
and `--clean` in `tools/truth-check.mjs` reports both under SUSPECT LABELS and
will write a corrected copy.

**And there is a third contamination in that file which runs the other way**:
ten or more of its ledger notes are not marked at all, so the page's PRECISION
column now punishes the reader for finding them. That one cannot be cleaned
automatically — nothing can detect a mark that was never made — and it is what
blocks the largest measured recall win left in the reader. See "Known broken"
and item 4 of "The next step".

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
  invented, total         6       37        40      83
    on the clef           0        0         2       2
    on an unfound band    2        1         1       4
    out in the music      4       36        37      77
  FURNITURE               2        1         3       6   of 83 invented
```

Two earlier readings of that same line, kept because the trend is the point and
neither reproduces now: **27 of 107** invented (Bach 9 · Mozart 12 · Scanned 6)
before the furniture work, and **13 of 98** (3 · 7 · 3) after it and before the
page-agreed key reach. It is **6 of 83** today.

**The key signature's own share went 12 to 4**, by the page agreeing how far it
reaches — Bach 4 to 2, Concerto 7 to 1, Scanned 1 to 1. The four that remain are
all out of the suppression's reach and are named individually under "The band
could stop inside the sharp": two on the Bach are INFLECTION accidentals
standing in the first bar rather than key signatures at all (looked at,
`CROP_MARKS=1 npm run scan:crop -- Menuet.pdf 117,1276`), and two are on the
clef-less phantom staves of the other pages, where no suppression of any kind
runs.

**Do not use `npm run scan:key-why`'s "noteheads stand …" line as this count.**
It over-counts by five to ten times, and the tool now says so in its own output:
its zone runs 12.6 staff spaces from the stave's left end, which on the Bach
ends at x = 186, and the truth file has 18 real hand-marked notes inside it (9
on the Concerto, 13 on the Scanned score). It is a per-system symptom count for
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
                                    invented           correct
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

**HOW BIG THE USER'S COMPLAINT ACTUALLY IS: 41 of the 83 false circles on the
three marked pages — half of them — stand in a stem, and 28 of those 41 were
proposed by the SHAPE pass rather than the stem pass.** `by pass` calls 15 of
the 83 `stem`. So the number quoted at the user until now was a lower bound on
the wrong population, low by a factor of 2.7, and the shape pass — not the stem
hunt — is where most of it comes from.

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

**Next-step item 2 — "re-mark that file" — is struck.** The file's known
contamination is now sixteen marks on the key signature, one on a bass clef, two
on a quarter rest and these four: twenty-three, all removed, all cropped first.

Removing the four cost precision, and that is the measurement becoming more
truthful rather than the reader becoming worse: the Scanned score reads
**90.3% / 94.3%** against 91.2% / 94.3%, because the reader had been credited
with four circles drawn on blank paper.

### THE CORRECT-HEAD COLUMN IS THE ONE THAT DECIDES WHETHER ANY OF THIS IS FIXABLE

A rule that removes circles standing in a stem is only worth having if real
noteheads do not also stand there. **Nobody had measured that. They do, and the
rate is the difference between the two clean pages and the contaminated one:**

```
  correct heads at the far end of another note's stem
    Bach          0 of 318     0.0%
    Concerto      9 of 304     3.0%
    Scanned     162 of 415    39.0%
```

**The Concerto's nine are GENUINE and were cropped one at a time: they are
chords.** Its opening bars print two and three noteheads stacked on one stem and
the truth file marks every one of them, so a real notehead at the far end of
another note's stem is a real arrangement in engraved music. That is the
viability number, and it is 3%.

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
feet. Item 2 of "The next step" — re-mark that file — is what unblocks this, and
the `stem-foot` column of `BY SHAPE OF ERROR` is now the fastest way to find the
marks that need removing.

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
be noteheads: **96% on the Bach, 97% on the Concerto, 95% on the Scanned score**,
printed every run. Below about 90 the `stem-foot` column has stopped meaning
what it says.

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
fail on the old code. Live today: the first four are unchanged at 15/15, 9/10,
64/72 and 8/8; `scan:key-read` reads 172 of 224 and there are 563 tests.

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
match. `few6faint` is that second order made visible, 85/72 found before and
84/72 after at 100% recall either way, because its faint system now comes from
the tracker instead of from a smoothed prediction.

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
few2                  14     2/2       89%    100%   100%    100%       27/24
few2faint             14     2/2       89%    100%   100%    100%       27/24
few2photo           14.2     2/2      100%    100%   100%    100%       24/24
few2faintPhoto      14.2     1/2      100%     58%    86%     50%       14/24
few3                  14     3/3       88%    100%   100%    100%       41/36
few3faint             14     3/3       86%    100%   100%    100%       42/36
few3photo           14.3     3/3      100%    100%   100%    100%       36/36
few3faintPhoto      14.3     2/3      100%     75%    89%     67%       27/36
few6faint             14     6/6       86%    100%   100%    100%       84/72
mean                                            91%
```

**At the time of the fix**, `few2faint` read **1/2 staves at 50% recall**
before it and `few3faint` **2/3 at 67%**; `few6faint` read 6/6 at 100%
throughout. The table above is the live run and both faint rows are 100% in it. **That last row is the
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
   is three fifths of the best curve on the page, which is what stops the joining
   assembling the blur artefact along the top edge of the image into a stave.
2. **Clef** read from a band just past each stave's left end (`scan-clef.js`).
3. **Key signature — where it is, and which key it is.** The EXTENT is found by
   walking off the end of the clef until something is not an accidental
   (`scan-key.js`). The page then agrees with itself about HOW MANY accidentals
   there are — a low quartile of the per-system counts, because over-reading is
   the common failure and under-reading is the cheap one — and each system's
   band is trimmed to its own first n runs. That trim can only ever make a band
   narrower.
   **AND THE PAGE NOW AGREES ONE MORE THING, WHICH DOES WIDEN — read this
   before reasoning from the old invariant.** Until this round every bound in
   `findKeyBand` was measured off the ink of the system it was scanning and
   nothing another system found could widen it. That sentence used to be in
   this paragraph and it is false now: the systems that read a signature also
   agree HOW FAR PAST THE STAVE'S LEFT END it reaches, and a system whose own
   band stopped inside the printed sharp borrows it. The reason the old
   invariant had to go, and the weaker argument that replaces it, are under
   "The band could stop inside the sharp" below and above `agreeKeyReach` in
   `scan-key.js`.
4. **Which key it is** — see the section below. `readPage` reports it on every
   stave and once for the page, and `notesInOrder` carries it beside the clef.
5. **Barlines** — a column of ink spanning the stave with nothing wide hanging
   off it and no overhang past the lines.
6. **Noteheads** in two passes: shape tests propose candidates, then a
   classifier judges them (`head-model.js`). Stems propose extra candidates for
   notes the shape tests never offer.

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

```
page      drawn  working  staves  precision  recall  beams  overall
clean6        6        6     6/6       95%     96%   100%     96%
clean8        8        8     6/6       91%    100%   100%    100%
clean10      10       10     6/6       90%    100%   100%    100%
clean12      12       12     6/6       88%    100%   100%    100%
clean14      14       14     6/6       89%    100%   100%    100%
clean16      16       16     6/6       87%    100%   100%    100%
clean20      20       20     6/6       74%    100%   100%    100%
clean24      24       24     6/6       82%    100%   100%    100%
clean28      28       28     6/6       78%    100%   100%    100%
photo6       10      6.2     6/6      100%     96%    10%     10%
photo8       13        8     6/6       99%     93%    49%     46%
photo10      16      9.9     7/6       88%     97%    80%     78%
photo12      19     11.8     6/6      100%     99%    92%     90%
photo14      23     14.3     6/6      100%    100%   100%    100%
photo16      26     16.1     6/6      100%     97%   100%     97%
photo20      32     19.8     6/6      100%    100%   100%    100%
```

**What it says.** Finding the notes survives the whole range: recall is 93% or
better everywhere, on a clean page and on a photograph — the two lowest rows are
`photo8` at 93% and `photo6` at 96%. What does NOT survive is
**counting the beams on a photograph below about a twelve-pixel staff space** —
100% at 14, 92% at 12, 49% at 8, 10% at 6. A beam is half a space thick with a
quarter space of paper under it, so at a working space of 8 a pair of beams is
four pixels of ink and two of paper before the camera blurs it, and `readValues`
cannot separate them. **Every note is found and told the wrong length**, which is
the failure a practice app feels as the take drifting out of step. Precision
drifts down on CLEAN pages as they get bigger — 95% at 6 to 74% at 20 — which is
the head finder proposing more candidates when it has more pixels to propose them
in; recall does not move, so this is false circles rather than lost notes.

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
false positive the size sweep still shows and it costs that row 12 points of
precision. **It is the same failure class the curve-score test was written for
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

**Every figure in the `after` column re-runs to the digit today** — this is the
most recent change in the reader, so its `after` and the live table are the same
thing. Checked this round: `bench` 92.8 / 94.9, invented 6 / 37 / 40, the
furniture breakdown 2 / 1 / 1 on the key band, all four corpus blocks,
`scan:key-read` 300 of 352 with none wrong, and 563 tests.

**`npm run scan:key-why` named the cause on every one of them and the crops
confirmed it rather than the reasoning.** The Concerto's systems 5, 7 and 11
return bands 0.40, 0.40 and 0.81 staff spaces wide where the same page's
readable systems return 1.39; the Bach's system 3 returns no band at all beside
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
gates that same cell at zero. They are printed every run and they are item 13 of
"The next step".

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
scan:key-safety` identical, 563 tests. It was kept as an invariant rather than
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
  bench                             92.1 / 94.9   92.1 / 94.9  92.8 / 94.9
  scan:corpus CORE/HARD/SIZES/FEW   99/93/89/91   99/93/89/91  99/93/89/91
  unit tests                        555           559          563
```

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
argued. The `found` column has since moved on two pages, and only because the
page-agreed key reach removed false circles: it reads 324, 341, 455 today. The
`really` column has since moved too, on two pages and for a different reason —
three bad marks off the Bach and thirteen off the Scanned score, so it now reads
319, 332, 440. Neither movement is the candidate distribution changing, which is
the same argument still standing.

**THE PRICE, on the marked pages: the Scanned score's system 11.** Its band goes
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
closing it is item 12 below.

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
  bench                            92.1 / 94.9  92.1 / 94.9   92.8 / 94.9
  scan:corpus CORE/HARD/SIZES/FEW  99/93/89/91  99/93/89/91   99/93/89/91
  scan:clef · clef-hard            15/15 · 9/10 15/15 · 9/10  15/15 · 9/10
  scan:bars · scan:spread          64/72 · 8/8  64/72 · 8/8   64/72 · 8/8
  unit tests                       543          555           563
```

The reading rose to 172 when `column()` stopped clipping its measurement at the
band (the section above), and `bench` precision rose to 92.8 when the page began
agreeing how far its signature reaches. Neither is this change.

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
true when written; every other mention now points here. Re-measured this round
with `node tools/key-probe.mjs "<pdf>"`:

```
  page       clef    found a band   read a key   agreed   the reach it agreed
  Bach       bass       9 of 10       4 of 10    4 of 4      5.20 staff spaces
  Concerto   treble    10 of 11       5 of 11    5 of 5      6.45
  Scanned    treble    10 of 11       9 of 11    9 of 9      6.18
```

No system on any of the three pages reads a key that is not one sharp. The
witness floor is two, so the margins are 2, 3 and 7.

**Every `cut` these three pages report is a false alarm, and that was checked
rather than assumed** — the first version of this paragraph asserted the
opposite. Every band on every system of all three pages holds ONE glyph, and a
one-glyph signature has no next accidental to be cut off. `npm run scan:key-why`
prints what ended each scan and how far the last run it LOOKED at stood from the
last one it TOOK, which is the number that tells the cases apart. Live, this
round — the tool lists these under "systems hold a band that is a PREFIX":

```
  page       system   ended on   gap to the last run looked at
  Bach          6      speck      0.91 spaces
  Bach          8      tall       0.73
  Concerto      3      speck      0.90      <- refused as cut
  Concerto      6      speck      1.02      <- refused as cut
  Concerto      5, 11  gap        (no later run at all)
  Concerto      7      tall       0.60
  Scanned      11      gap        (no later run at all)
```

**Only `speck` and `reach` are refused as cut**, so of these the two the
truncation rule actually costs are the Concerto's systems 3 and 6. The others
are on kept endings and are not read for their own reasons — the Concerto's 5
and 7 return bands 0.40 spaces wide, which is a third of a sharp.

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
| `npm run bench` | every marked page at once |
| `npm run scan:truth -- <pdf> --truth <json>` | one page: where every invented and missed head is. **For the `--all` listing and the `by furniture` breakdown, invoke the tool directly** — `node tools/truth-check.mjs "<pdf>" --truth pages/truth/<page>.truth.json --all` — because npm swallows `--all` as its own flag. `--clean` writes a corrected truth file |
| `npm run scan:crop -- <pdf> x,y` | LOOK at it. `CROP_MARKS=1` draws heads and bars, `CROP_TRUTH=<json>` adds the marks, `CROP_LAYER=body` shows what findHeads sees |
| `npm run scan:why -- <pdf> x,y` | which test in findHeads rejected a point, and by how much |
| `npm run scan:bar-why -- <pdf> x,y` | the same for barlines |
| `npm run scan:train` | retrain the classifier, cross-page validated. It writes `pages/head-model.json`, **which nothing imports** — installing a fit means pasting BIAS and WEIGHTS into `src/analysis/head-model.js` by hand. None of the three blocks it prints describes the fit that currently ships; see the note at the top of that file |
| `npm run scan:curve` | is the bottleneck data or model capacity |
| `npm run scan:res -- <pdf>` | is the reader resolution-starved (it is not, above 1400px). **Its `space` column is in the RENDERED canvas's pixels, not the reader's** — it climbs to 24.9 at a width of 3600 while `readPage` is still working at 9.6, because `w = Math.min(WORK_WIDTH, naturalWidth)`. Do not read that column as detail reaching the reader |
| `npm run scan:key-why -- <pdf>` | per system: edge, clef, confidence, the key band it found and what ended the scan, which systems hold a PREFIX — and, once for the page, the key it agreed and **how far it agreed its signature reaches**, the one bound in the suppression not measured off the system it is applied to. **Its `furniture` column is a head count inside a fixed 12.6-space zone, not a count of false circles**: that zone holds 18 real hand-marked notes on the Bach, so the totals run five to ten times high. Use it to compare systems on one page; for the score use truth-check's `by furniture` |
| `npm run scan:key-read` | every key signature from 7 flats to 7 sharps, both clefs, four sizes, clean and photographed — plus the cancellations, which must be refused. **Read the WRONG-key line, not the total**: a refusal costs C major and a wrong key costs a semitone on every note of a degree. Also prints what ended each scan and what refusing the cut ones costs. `KEY_DEBUG=1` explains each failure run by run |
| `npm run scan:key-safety` | the one thing the key band is never allowed to do: cover a notehead, which `dropFurniture` then deletes. TWO blocks. **One stave**: 768 drawn pages, 2304 heads, music 1.5, 2 and 3 spaces past the signature, with grain and without — gated at zero on the named `grain-fleck` regression and on clean paper from two spaces at a size this reader works at; a space and a half and the 6.5-pixel cell are printed and not gated. **A whole PAGE**: five systems through `readPage` with one signature printed faint, which is the only way to see the page-agreed reach at all — it fails if the widening never fires, and it gates the DELTA (a head inside the widened range that the old range did not cover) at zero. Two debts printed and not gated: six heads to a fleck of grain at exactly two spaces, and thirteen to the band's own scan on the page block. Neither is new |
| `npm run scan:corpus` | synthetic pages — the only stand-in for a page nobody marked. Four blocks now: CORE, HARD, SIZES and FEW. Its last line says how many of its 58 pages the **page-agreed key reach** fired on, because that is the one rule in the reader that lets one system's evidence widen another's suppression and a page of bare staves is where it would do damage. It is 0 of 58 |
| `npm run scan:few` | the FEW block on its own: two and three systems, one of them printed faint. The only pages in the corpus where `fillMissedStaves` cannot cover for the stave tracker |
| `npm run scan:sizes` | the SIZES block on its own: one page shape at nine staff spaces from 6 to 28 pixels, clean and photographed, precision and recall for each. The only measurement in the project whose x-axis is scale |
| `npm run scan:bars` / `scan:clef` / `scan:clef-hard` | synthetic, with real truth |
| `npm run reader:mark` | the marking tool still works |
| `npm run scan:spread` | the camera scanner: a book spread comes back as two pages |

**Every real bug in this reader was found by looking at the page. Every dead end
came from reasoning about what the code probably does.** `scan:crop` and
`scan:why` are the two that pay for themselves fastest.

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

- **Naming a pitch.** The key is now read and carried on every note beside the
  clef, but nothing turns a step into a note name. That is the next small job and
  it is arithmetic: degree from step and clef, octave from step, then
  `alter[degree]` semitones. `step` means what it always meant and this round did
  not touch it.
- **A key CHANGE mid-page**, and a signature of naturals is refused rather than
  read for exactly that reason — see "Reading the key signature". Also nothing
  reads an accidental standing against a single notehead, which is the other half
  of naming a pitch correctly.
- **A clef-shaped-ink test.** The clef band is only suppressed where `scan-clef`
  could NAME the clef, and that conditional is load-bearing (below). What would
  lift it is a test for a tall confident glyph in the band, which is furniture
  whether or not the classifier can say treble from bass. The obvious candidate
  does not work: `clefFeatures` already discards the staff lines, and a notehead
  with a stem measures about three and a half spaces against `SHORTEST`'s one
  and a half, which is exactly why the unconditional drop cost what it did.
- **The time signature.** A first system prints one immediately after the key
  signature and `scan-key.js` has no notion of it. Measured, the common-time C
  is 2.18 spaces wide against a sharp's 1.14–1.35, so it is separable — but it
  is now REJECTED by `GLYPH_WIDE` rather than swept into the count, which means
  it is no longer suppressed either. That is two false circles on the Scanned
  score's system 2 and it is the price of the ceiling.
- **Note values beyond beam counting** — rests, dots, ties, tuplets.
- **Mid-system clef changes.**
- **Barline ground truth.** The counts in `bench` are counts, not accuracy.
  This is how the barline failure hid for a day: every number went to noteheads.

## Known broken

- **System 1 on both Mozart pages is a stave that is not there.** Its staff
  space measures 7.9 against 9.6 for the rest, and the reason is that
  `fillMissedStaves` extrapolates one system ABOVE the first real one
  (`scan-read.js`, the `wanted` loop) and lands on the page's title block. On
  the Scanned score it draws 21 noteheads on printed type — the É of CARATGÉ,
  the o of Solo, five on W. A. MOZART. Its comb score is 0.00 where the page's
  real staves score 0.66 to 0.86, so the `floor = 0.05` that admits it is
  thirteen times below the faintest honest stave. **The fix is written, measured
  and reverted, and the numbers are now complete** — see "Asking the page how
  weak a predicted stave may be" below. The short version: it costs the corpus
  NOTHING AT ALL, it is a pure gain on the Concerto, and on the Scanned score it
  reads as a 2.6-point recall FALL because twelve of the phantom's heads are
  matched to marks somebody put on the composer's name. **Do not attempt it again
  before the truth file is re-marked**; the standard will force it back out, as
  it did this time.
- **A FOURTH CONTAMINATION IN `pages/truth/scanned.truth.json`: marks standing
  on a bare stem where it crosses a staff line.** Found this round while
  measuring the one-head-per-stem rule, and it is the same mistake as the
  thirteen on the key-signature sharps — a hand accepting the reader's own
  phantom. At least two, at **(754, 521)** and **(1129, 1332)** in working
  pixels. They are not a judgement call, because the same page prints the same
  picture unmarked a few notes away:

  ```
  CROP_PAD=26 CROP_MARKS=1 CROP_TRUTH=pages/truth/scanned.truth.json \
    npm run scan:crop -- "Scanned score.pdf" 754,510 948,510
  ```

  754 and 948 are the identical arrangement — an up-stem crossing a staff line,
  the notehead a space above and to the right — and 754 carries a red truth dot
  while 948 does not. 1129,1332 is a third of the same, with a flat sign beside
  it. **The suspect detector cannot see these**: it looks for marks inside the
  clef band and on the key signature, and these are out in the music. Whoever
  re-marks this page (item 2) should sweep for a mark that has no head-shaped
  ink under it and a real notehead within a space and a half of it on the same
  stem.
- **`pages/truth/scanned.truth.json` is contaminated**, now FOUR ways over
  (three of them below, and the bare-stem marks above).
  Two of them are marks somebody clicked because the reader had drawn a ring
  there: 13 on the title block and 13 on the key-signature sharps (x = 110–116,
  systems 3, 4, 6, 7, 8, 10, 11). Until they are rejected, that page's recall
  column rewards the reader for being wrong.
  **The third runs the other way and is worse, because it punishes the reader
  for being right: the ledger notes above the stave are largely NOT MARKED.**
  The Scanned score is the same music as the Concerto, and in the passage of
  high notes on ledger lines that runs through systems 8 to 11, the Concerto's
  truth file marks every head and the Scanned score's marks about one in three.
  Put these two crops side by side and it is not arguable:

  ```
  CROP_MARKS=1 CROP_TRUTH=pages/truth/scanned.truth.json CROP_PAD=140 \
    npm run scan:crop -- "Scanned score.pdf" 420,1595
  CROP_MARKS=1 CROP_TRUTH=pages/truth/mozart.truth.json  CROP_PAD=140 \
    npm run scan:crop -- Concerto.pdf 420,1628
  ```

  At least ten heads are involved, at 342,1605 · 417,1593 · 456,1588 ·
  494,1591 · 412,1326 · 760,1320 · 899,1309 · 748,1457 · 819,1448 · 1012,1246,
  and six of the ten have been looked at one at a time. That page also carries
  21 pairs of marks closer than 1.2 staff spaces, of which five are duplicate
  clicks (two at the same coordinate to a pixel) and the rest are genuine
  seconds. **Missing marks cannot be found by any suspect detector** — `--clean`
  can only reject what is there — so this one needs a person and
  `tools/reader-look.html`.
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

  **A trap for whoever re-opens this.** The Mozart's precision is 89.1% TODAY,
  which is the "after" figure above — and it got there by a completely different
  change, the page-agreed key reach. Anyone diffing that number against this
  entry will conclude the variant is already installed. It is not. `bench` mean
  precision is 92.8% and the vertical-gap bound is not in the source.
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
    `bench` reads 92.8 / 94.9 now, moved by the truth-file correction and the
    page-agreed key reach, neither of them the classifier. **The two points of
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
    weights were fitted to. Fix `STEM_CUT` first — item 3 of "The next step" —
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
  Scanned score's truth file is not. The measurement is now complete in a way it
  was not before, and the last line is the new part:
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

## The next step, in order

**Ordered by what the USER asked for first, then by what is blocked behind one
piece of work, then by size.** Two of the top three are things the user named in
so many words and neither is finished; the item that blocks four separate
correct changes sits between them because doing it makes three of the others
land the same week.

1. **THE FALSE CIRCLES STANDING IN A STEM. The user asked for this and it is NOT
   fixed.** "Many false circles still happen oftentimes in the stem at the
   bottom." The one-head-per-stem rule is measured four ways in "What is
   measured and does NOT work" and every one costs more real notes than it
   removes circles. Read that entry before spending a day here, because it
   bounds the problem in two ways that are more useful than the rule itself:
   - **The population is tiny where the rule can see it.** Of 691, 627 and 759
     stem runs on the three pages, **0, 0 and 4** propose at both ends of one
     stem. All of it is on one page, and that page's truth file is contaminated.
   - **Every proposal the stem pass makes fails the shape tests, real ones
     included — 73 of 73.** `stemHeads` calls `headScore(headPatch(...))` and
     runs none of `findHeads`' chain, so no test drawn from `findHeads` can ever
     filter it. That is not a bug; it is what the stem pass is FOR.
   - **What has NOT been tried is attacking it BEFORE the hunt rather than
     after.** Every phantom looked at is a stem crossing a STAFF LINE, and
     `owned` is already the shape of a rule asked at the stem end.
   Live figures for the population: the stem pass buys 48 real notes for 14
   false ones on the Scanned score, 4 for 0 on the Concerto and 1 for 1 on the
   Bach. Fourteen of that page's forty invented heads are its doing.

2. **Re-mark `pages/truth/scanned.truth.json`** in `tools/reader-look.html`.
   Still the single highest-value hour in the project, and it needs no reading
   of any code. **Four separate correct changes are blocked behind this one
   file**: the ledger rule (item 4, twelve notes), the phantom stave (item 5),
   the stem-pass work the user asked for in item 1 (it reads as a regression on
   this page and on no other), and any honest reading of that page's precision
   column at all.
   - Thirteen marks on the title block remain. Extend the suspect detector in
     `tools/truth-check.mjs` and run `--clean` for those.
   - Thirteen on the key-signature sharps are already GONE — the denominator is
     440, not 453, and the removal is recorded in the file's own `cleaned` and
     `removed` fields.
   - At least ten real notes in the ledger passage are not marked at all, which
     `--clean` cannot fix and a person must.
   - **At least three marks stand on a bare stem where it crosses a staff
     line**, out in the music where no existing detector looks, at (754, 521),
     (1129, 1332) and near 1129,1332 with a flat beside it. See "Known broken"
     for the two crops that settle it and the shape of a detector that would
     find the rest.

3. **`STEM_CUT`, which blocks every future retrain and therefore the shape tests
   too.** It is a bar on the classifier's own score, read off `bench` rather
   than off the cross-page table, and it is the only such number the honest
   measurement cannot see: `scan:patches` dumps with the judge off and
   `stemHeads` only runs with the judge on, so no stem-pass candidate has ever
   been in `pages/patches.json`. A refit against the current shape tests moved
   22 real notes out of the Scanned score's stem pass and no value of `STEM_CUT`
   recovers them. **Since any change to the shape tests forces a retrain, this
   blocks them all.** The proposal is to stop carrying a number: ask for a
   quantile of what this same model says about the heads the shape pass ALREADY
   accepted on this page, which moves with the model instead of being
   invalidated by it. That is a change to the head passes, so it needs its own
   retrain — do it in the same round and get the three-page refit installed as
   the proof. Doing this also gives the shipped weights a reproducible held-out
   figure again, which they currently do not have (see "Where it stands").

4. **`LEDGER_LONGEST = 4`** — eleven of the Concerto's missed notes and three of
   the Scanned score's, found by `findHeads` at classifier 0.84 to 0.998 and
   then thrown away for standing on a chain of ledger lines. The whole change is
   one constant. It needs item 2 first and nothing else, and it is the largest
   measured recall win left in the reader. Entry in "What is measured and does
   NOT work".

5. **System 1's stave model** — WRITTEN AND MEASURED, in "What is measured and
   does NOT work". Free on the Concerto and free on all 49 corpus rows. All that
   stands between it and shipping is item 2.

6. **Counting beams on a small photograph**, which `npm run scan:sizes` names as
   the largest hole in the reader that is not blocked on anything: beam accuracy
   100% at a working staff space of 14, 92% at 12, 49% at 8, 10% at 6, while
   recall stays at 93% or better throughout. Every note found and given the
   wrong length, which is the failure a practice app feels as the take drifting
   out of step. It is `readValues` in `scan-stems.js`, and that file already
   measures its own beam pitch and thickness off the page — the question is what
   it should fall back to when the page cannot resolve a pair, which is
   precisely the `halfSpaceThree` case that block was built for.

7. **A page of a different KIND.** Handwritten, a piano score, a phone photo of
   something not already here. Variety is the lever: the model trained on the
   richer set of negatives travels better in both directions. In the current
   three-page dump the negatives run Bach 41, Mozart 145, Scanned 103 (the old
   two-page dump ran 46 and 152; it was overwritten and those counts cannot be
   re-derived). `scan:curve` says whether a new page bought anything — on three
   pages it reads 93.5% at 127 patches and 95.0% at 845, not monotone on the
   way, so it is variety and not volume. **The Scanned score does not count as
   one**: it is the same music as the Concerto, so it is a third scan and not a
   third kind, and the one clean cross-page row it produced moved a point.

8. **A page in a key that is not one sharp.** The honesty problem the key-reader
   round could only half fix. Every real page in this project is one sharp, two
   of the three are the same music, and every other one of the fifteen answers
   is measured only on Bravura drawn by the tool that scores it. The drawn
   corpus is real truth for the GLYPHS — same font, same places — but it cannot
   test a photocopy, a bent page or a pencilled fingering through the signature,
   and every failure fixed in that round was found on drawn pages or in the
   tables rather than on paper. One photograph of a page in three flats would be
   worth more than another sweep.

9. **The Bach's band scan.** Only four of its ten systems reach the key reader,
   because its bands come back 0.67, 1.16, none, 0.74, 1.15, 1.56, 1.14, 0.57,
   0.57 and 0.89 spaces wide where a sharp is about 1.2 — the scan hands the
   reader half a sharp on five systems and nothing at all on a sixth. **The
   page-agreed reach has taken the CIRCLES off those systems and has not made
   them READ**, which is the right division: the widening decides what is
   suppressed and cannot decide what a glyph is. Four witnesses is the Bach's
   whole margin against a floor of two. `npm run scan:key-why -- Menuet.pdf`
   shows which and `CROP_MARKS=1 npm run scan:crop -- Menuet.pdf 84,700` shows
   why. Worth more than lengthening long signatures: a bass page at 12 pixels a
   space is the easy case and it is the one still failing.

10. **Naming the pitch**, now a small job: the key is read, agreed and carried on
   every note beside the clef. Degree from step and clef, octave from step,
   `alter[degree]` semitones — `pitchOf` in `scan-notes.js` already does it. The
   remaining hole is an accidental standing against a single notehead, which
   nothing reads. **`scan-notes.js`'s clef table was wrong for tenor by a third
   until recently and nothing measured it**; when this is wired up, the thing to
   check is not that it runs but that `pitchOf(6, 'tenor')` is middle C.

11. **`KEY_REACH = 9`.** What is left of the truncation hole, and now measurable
   rather than suspected: **28 of the 352 drawn scans end on `reach`** (35 when
   that was written), which is the scan hitting its own nine-space bound with
   the next accidental's ink already in view. Its comment says "seven flats and
   slack" while `GLYPH_WIDE`'s says seven flats is ten spaces of band, and those
   cannot both be true. Only 3 of the 28 would have read correctly, so it is
   worth little on the drawn corpus — but it is a loosening of the BAND, and the
   band is what suppresses, so it has to be measured against `bench` and the
   corpus and not against `scan:key-read` alone.

12. **The six heads `scan:key-safety` still reports as DEBT.** Three
   photographed pages — treble space 12 with four sharps and with two flats,
   bass space 16 with four sharps — each with a fleck of grain in the gap, each
   losing two or three noteheads to the band. Not new; the same six on the code
   before the fix that found them. **The mechanism is known and written above
   `column()`: a speck of grain in the same column as a notehead is joined to
   it**, because a column takes its first and last inked row across whatever
   blank lies between — which it must, since an accidental standing on a staff
   line arrives in two pieces. A fleck 1.8 spaces above a head makes the pair
   measure 1.4 spaces where the bare head measures 1.08, and 1.2 is
   `GLYPH_TALL`'s floor. **Both obvious attacks are already measured and dead**
   — the first two entries of "What is measured and does NOT work" — so this
   needs a third idea, not a sweep. Note the shape of the target: without grain
   the check is clean at every gap and size, so whatever is done must separate a
   head-plus-speck from a real accidental, not tighten a bound.

13. **The thirteen heads the PAGE block of `scan:key-safety` reports.** Five
   systems through `readPage` at a two-space gap, three pages in treble with
   sharps, where a system's OWN key band runs into the first note of the bar.
   **Not new behaviour**: the same block against the code before that round
   reports the same thirteen, and the single-stave block gates that same cell at
   zero and passes, so what the page block adds is a case the stave block cannot
   draw. It is `findKeyBand` over-reaching, the opposite failure from the one
   the widening repairs, and the two want looking at together. Printed every run.

14. **`STRIPS = 40`, the last of the ranked fitted constants, deliberately left
   alone.** A strip is 3.5 staff spaces on the three marked pages and 1.0 — one
   beam wide — at a working space of 35, so it is genuinely the wrong units, and
   `pitch` is already measured four lines before the strips are built. It was
   not touched because the strip grid is the coordinate system every downstream
   measurement is expressed in: `readPage` reports `strips: STRIPS`, and
   `tools/crop.mjs` and `tools/reader-look.html` index into the line arrays with
   their own arithmetic. Making it per-page is a refactor with a silent
   mis-indexing failure mode, not a threshold change, and the two cheaper halves
   of the same constant — the crossing test and the rejoin — took `downStems`
   from 0% to 97% without it.

15. **The reader still cannot read a close-up**, and nothing in the repo
   measures it. Blown up past a working staff space of about 35 — a phone held
   near two bars on a stand, the commonest thing a practice app will be handed —
   the Menuet finds no stave at all. `scan:sizes` cannot reach that far: its
   canvas is `space * max(50, 12 + widest span)` and `readPage` clamps to 1400,
   so the working space can never exceed 28. Reaching it means narrowing the
   drawn page, and nothing does. This rests on one earlier probe.

16. **Capture quality in the app** — `src/ui/scanner.js` already outlines the
   page, splits a book spread and asks the user to come closer. Better input
   lifts every number here without touching the reader.

### And keep this document honest

The round that produced this list was spent entirely on repairing about a dozen
figures in it that no longer reproduced. **Run the command and paste what it
printed. Do not paraphrase a number you did not watch a tool produce**, and when
a mid-round `before` / `after` table is left behind, label it *at the time* and
point at the live figure. The three failure shapes are named at the top of
"Where it stands".
