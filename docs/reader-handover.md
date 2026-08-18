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
music — two rendered from PDF and one a scan — it circles heads at **95.0%
precision and 98.1% recall** (`npm run bench`).
It reads the key signature and refuses rather than guess — **0 of 352 drawn
signatures read as the wrong key** — it reads the accidental standing
in front of a note and carries it to the end of the bar, and it reads a **C-clef
printed part way along a system**, which is what a cello part does every time it
goes up and comes back down. **On a clean page of two systems or more it also
reads a page that prints NO signature as C major** rather than declining to name
anything — but not on one system, and not on a photograph, which are the two
qualifiers that clause has to carry: 6 of 6 drawn photographed bare pages still
name nothing, and the 26 unpitched notes above are the two single-system
arpeggio studies.

**EVERY PITCH NUMBER ABOVE IS A CLEAN-PAGE NUMBER, and that is the qualifier a
ship decision turns on.** Spoil the same 32 studies the way a phone spoils a page
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
measured NOT to do**: a mid-system change to BASS or TREBLE (a C-clef is read;
those two are not, and their notes stay named in the clef the system began in,
silently), a key CHANGE mid-page, note values beyond counting beams — and beam
counting itself collapses below a working staff space of about 12 on a
photograph, where every note is still found and given the wrong length. It has
never been shown a handwritten page, and it finds no stave at all on a close-up
blown past a working space of about 35.

Everything below is the evidence for those three paragraphs. **`CLAUDE.md`'s
one-paragraph summary still says the reader "has never been tested on … a clef
change mid-system", which is out of date; where the two disagree, this file is
the one that was measured.**

## Run it

```
npm run dev                  # port 5199 — everything below needs this running
open http://localhost:5199/tools/reader-look.html
```

Drop a PDF or photo in. Tick **marking mode** to build ground truth: click a
ring that is not a note, click bare paper where one was missed, save. Marks are
positions, not indices, so they survive changes to the detector — that is the
whole point of them.

### What is committed and what is not — RE-CHECKED, and it is the other way round now

**An earlier copy of this section said the instruments existed only in the
working tree. That is out of date and the correction runs the opposite way: the
INSTRUMENTS are all committed and the READER's last four rounds are not.**
Checked with the commands rather than inferred, at HEAD `07a40dc`:

```
git ls-files --error-unmatch tools/key-probe.mjs tools/key-read-check.mjs \
    tools/key-safety-check.mjs tools/study-check.mjs src/analysis/acc-model.js
                              -> all five TRACKED
git show HEAD:package.json | grep -c 'scan:studies'      -> 1
   …the same for scan:key-read, scan:key-safety, scan:key-why,
     scan:sizes and acc:train                            -> 1 each
git show HEAD:tools/scan-corpus.mjs | grep -c SIZES      -> 9
git status --short package.json                          -> (nothing)
```

So a fresh checkout of this branch DOES have `scan:studies`, `scan:key-read`,
`scan:key-safety`, `scan:key-why`, `scan:sizes`, `scan:few` and `acc:train`, and
`scan:corpus` prints all four of its blocks.

**What a fresh checkout does NOT have is the reader itself as this document
describes it.** Four rounds of work sit uncommitted in the working tree, and
every number in this file was measured against them, not against `07a40dc`:

```
src/analysis/scan-read.js    agreeNoKey wiring · dropDoubledHeads ·
                             fillMissedStaves' page-relative floor ·
                             findClefChanges
src/analysis/scan-key.js     scanKeyBand · agreeNoKey
src/analysis/scan-clef.js    midClefAt
src/analysis/scan-notes.js   pitchOf learning alto
tests/scan-{read,key,clef,notes}.test.js      the 607 tests below
tools/key-safety-check.mjs   its THIRD block · tools/study-check.mjs its three
                             key columns, its accidental block and --phone
tools/truth-check.mjs        the `title` and doubled-mark suspect classes
tools/scan-clef-check.mjs    its THIRD block · tools/glyphs.mjs the C-clef
pages/truth/{mozart,scanned}.truth.json       70 marks off, 13 on
```

`git stash`, `git checkout` or a branch reset on this tree destroys all of it.
`tools/train-big.mjs` also shows as modified and predates all four rounds.

**And `CLAUDE.md` is UNTRACKED and one clause of it is now false.** Its
one-paragraph summary still says the reader "has never been tested on a piano
score, two voices on one stave, or a clef change mid-system". The clef-change
half is out of date — see *A clef printed part way along a system* — and it is a
protected file that no round has been asked to edit. **Where the two disagree,
this file is the one that was measured.**

## Where it stands

`npm run bench` — every marked page, scored together:

```
page          space  found  really  precision  recall     F1   invented  missed   bars  clefs
Bach           12.1    322     319      98.8%   99.7%  99.2%         4       1     34  10/10
Mozart           10    336     328      92.9%   95.1%  94.0%        24      16     36  10/10
Scanned         9.6    439     412      93.4%   99.5%  96.4%        29       2     34  10/10
mean                            95.0%   98.1%  96.5%
```

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
(Both figures are **at the time**. The live mean is 95.0 / 98.1, four rounds and
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
signatures right with **0 read as the wrong key**, and there are **607** unit
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
there are **607** tests. HARD's mean has since moved 93% to **94%** and it was
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
    C-clefs only, by the waist, and refuses everything it cannot place on a
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
touching. Counted before anything was edited, and again on the shipped code:

```
  the three marked photographs, every window          13,148 windows    0 fires
  24 pieces of drawn furniture, clean AND photographed    48 pages      0 fires
  12 drawn pages from the hard-cases probe                             0 fires
     (chord stacks, two voices, grand staves, all the furniture)
  scan:corpus 49 rows · scan:studies · scan:key-read     byte-identical
```

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

Two more things it deliberately does not do:

- **A mid-system change to bass or treble is not read.** A treble printed
  mid-system passes the height and continuity tests and its waist lands nowhere
  near a line, so it is refused rather than misnamed — but its notes stay wrong.
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
`bench` reads **95.0 / 98.1**, invented **4 / 24 / 29**, the key band's own
furniture share **2 / 0 / 0**, `scan:corpus` **99/94/89/91**, and there are
**607** tests. The one row that has not moved is `scan:key-read`, still 300 of
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

- **3 of 205 systems** of drawn pages that plainly print a signature come back
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
scan:key-safety` identical, 563 tests **at the time** (607 today). It was kept as an invariant rather than
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
| `npm run scan:bars` / `scan:clef-hard` | synthetic, with real truth |
| `npm run scan:clef` | THREE blocks. The first two are the clef at the head of a system — the classifier against a column this file samples, then the same thing through `readPage`. The third is a **clef printed part way along a system**, scored NOTE FOR NOTE on pitch, with a paired control and — the part that matters — **twenty-four pieces of furniture printed where the clef would be, clean and photographed, on which the count of clef changes found MUST BE ZERO**. Accidentals on each of the five lines, a repeat barline, a chord of thirds, and the rest. It **fails the build** on a false fire and on a note named wrong on a page whose change it found; a change it MISSES is printed as a DEBT line instead, because that is the reader as it was. It also carries its own copy of the clef-to-MIDI arithmetic and refuses to run if the self-check disagrees — that table has been written wrong twice in this project |
| `npm run reader:mark` | the marking tool still works |
| `npm run scan:spread` | the camera scanner: a book spread comes back as two pages |

**WHICH OF THESE ACTUALLY FAIL A BUILD, because "it is measured" and "it is
gated" are not the same claim and this document has confused them before.** Only
three commands here have a must-be-zero line that exits non-zero:
`scan:key-read` (any key read as the WRONG key), `scan:key-safety` (five lines
across its three blocks — the band eating a head, the widening putting a head in
a suppression, and `agreeNoKey`'s three), and `scan:clef` (a false clef-change
fire, and a note named wrong on a page whose change was found). **`bench`,
`scan:studies` and `scan:corpus` gate nothing** — they print, and a human reads
them. Everything this document says about PITCH rests on `scan:studies`, which
is in that second group, and everything it says about pitch on a PHOTOGRAPH
rests on a flag of it that no check passes.

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
  **92.9%** and the mean at **95.0 / 98.1** today, and the vertical-gap bound is
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
    `bench` reads **95.0 / 98.1** now, moved by four later rounds and by seventy
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

### The pitch rounds' dead ends

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
  notes are buying. The corroborating count is **3 of 205** systems of
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

## The next step, in order

**RANKED BY HOW MUCH REAL MUSIC EACH ONE BLOCKS, not by how interesting it is
and no longer by what was asked for first.** The ordering rule this round used,
written down so the next round can disagree with it deliberately: an item scores
high if it fires on a PHOTOGRAPH (which is the only input the app ever gets), if
it is silent when it fires (a confident wrong answer beats a refusal for damage),
and if the music it spoils is music a cellist actually plays. It scores low if it
costs precision only, if it is measured on drawn pages nobody photographs, or if
it is a debt line that has not grown in three rounds.

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

---

1. **THE WRONG KEY AT PHONE QUALITY. It is the only confidently wrong answer
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

2. **WHY A HEAD WITH AN ACCIDENTAL TOUCHING IT DISAPPEARS ON A PHOTOGRAPH.**
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

3. **`LEDGER_LONGEST = 4`. One constant, and the largest measured recall win
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
