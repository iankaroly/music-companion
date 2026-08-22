# Working in this repo

Most of this app is ordinary. The page reader is not, and it is where almost all
the work goes, so this file is mostly about that. `docs/reader-handover.md` is
the full state of it — read that before changing the reader. This is the short
version that fits in your head.

## The one-paragraph summary of the reader

`src/analysis/scan-read.js` finds staves, clefs, key signatures, barlines and
noteheads on a photograph of sheet music, and `scan-notes.js` turns a notehead's
position into a pitch using the clef and the key. A page whose systems read
DIFFERENT key signatures names NOTHING — the stave's own reading stands in for
the page's only where there was no second witness to begin with. It works on a SINGLE-STAVE
PART in any key, in treble, bass or tenor clef. It reads a C-clef or a TREBLE
printed part way along a system; it does not read a mid-system BASS, and that is
measured and written up rather than untried. It has never been tested on a piano
score or on two voices on one stave.

## The measurements, in the order they rank

```
npm run scan:key-read    synthetic key signatures. 0 READ AS THE WRONG KEY.
npm run bench            the three hand-marked real pages. precision / recall —
                         WHERE a ring sits, and nothing at all about what it is
                         called.
npm run scan:steps       the same three photographs, scored as the STEP against
                         the lines PRINTED around each hand mark. The only
                         measurement of pitch on real paper in this repo.
                         92.3% / 91.3% / 92.7%. Needs a truth file:
                         npm run scan:steps -- <pdf> --truth pages/truth/<p>.json
npm run scan:studies     32 real cello studies from MusicXML, scored NOTE FOR
                         NOTE — on pages this repo engraved itself, so it is the
                         north star for PITCH on CLEAN paper only.
npm run scan:values      the DURATION twin of scan:steps: the same three
                         photographs, scored note for note against
                         pages/truth/scanned.values.json (52 hand-encoded
                         noteheads, every one read off a crop at 11x-40x).
                         73.1%. It also prints THE DECISION — how many bars
                         scan-values.js believed, which is 0 of 39, 0 of 38 and
                         0 of 37, and which is the number that matters.
npm run scan:bars-believed  the OTHER half of the value question, and the one
                         nothing could see: of the bars scan-values.js
                         BELIEVES, is the music in one of them one printed bar?
                         The same 32 engraved studies, every printed bar four
                         crotchet beats and every printed head's coordinates
                         known. Today: 52 bars believed of 200 and every one of
                         the 52 is one printed bar; 67 of the 759 circles on
                         those clean pages are not printed noteheads, down from
                         251 of 943. It also prints WHO PROPOSED THEM — the
                         shape tests against the stem rescue — which is the
                         line that turned "251 circles are wrong" into a bug
                         with an address (all 251 came from the stem pass and
                         none of the 692 real heads did; see STEM_BODY in
                         scan-read.js). A route that circles nothing real is a
                         route with a missing test. MERGE=1 runs the rejected
                         regrouping experiment beside it. Run it whenever
                         anything about note values, barlines or the bar
                         decision moves.
npm run scan:align       the only instrument that can see `headsOf`, the
                         aligner and the pairing: 32 engraved studies, 4 seeded
                         takes each, scored as WHICH NOTEHEAD each played note
                         landed on. Run it whenever anything between a head's
                         pitch and a mark on the review moves.
npm run scan:floor       the OTHER question about the pairing: is this take
                         even this piece? The same 32 studies, 4 takes from
                         each study's own music against 4 from a DIFFERENT
                         study, crossings chosen same-clef-and-same-key first.
                         Prints both score distributions and the trade curve
                         the confidence floor in `pairNotes` was read off.
                         Run it whenever that floor or the statistic moves.
                         IT WENT BACKWARDS THIS ROUND and the reason is written
                         beside STEM_BODY: of 128 takes played from a DIFFERENT
                         study, 116 were refused, 79 after STEM_BODY and 86
                         once COVER_FLOOR was added. TWO mechanisms behind the
                         loss, counted rather than assumed: 31 of the 37 that
                         changed side are same-key same-clef crossings whose
                         score the phantom circles had been suppressing (an
                         arpeggio against its own scale, a relative minor),
                         which the note above FLOOR says this statistic is blind
                         to by construction — but 7 are takes the ENOUGH gate
                         used to refuse outright because their marks landed on
                         phantoms the page never priced. COVER_FLOOR took 7 of
                         the 31 back at no cost to any right take; ALL SEVEN OF
                         THE ENOUGH ESCAPEES ARE STILL OPEN, and they are the
                         first thing to pick up here.
                         `--miss <f>` reads the whole board on a page that
                         fraction of whose noteheads were never found, which is
                         the measurement that set COVER_FLOOR and the one this
                         tool did not have: the value the clean corpus alone
                         would have chosen refuses EVERY right take there.
npm run scan:key-gate    the GATE on the one failure this reader is not allowed
                         to have: a note named from a key the page could not
                         agree. `scan:studies --phone` with a non-zero exit.
                         MUST print `notes NAMED on one of them   0`.
npm run scan:pages       the SCANNER, not the reader: nineteen drawn camera
                         frames whose page corners are known, scored as IoU, as
                         SPILL (how much of the blue outline is not paper) and
                         as SPANS (one outline over two pages of a book).
                         91.6% mean IoU, worst spill 9%, 0 spans, 0 page counts
                         wrong. Run it whenever page-edges.js, straighten.js or
                         the scanner UI moves.
                         TWO COLUMNS, and the second one is new: IoU is
                         `findPages`, the finder; SHOWN is `papersIn` — the
                         finder PLUS the guard, which is the outline the player
                         is actually drawn and the one the shutter cuts to.
                         Eighteen of nineteen cases give the same number, this
                         corpus spent its whole life measuring only the first,
                         and the one case where they differ is the frame he
                         photographed. SHOWN mean 91.8%.
                         SHOWN IS ALSO THE OUTLINE ON THE GLASS NOW. The
                         scanner's preview used to call `findPages` itself, so
                         the blue box a player watched was the unguarded answer
                         while the page kept was the guarded one — the promise
                         at the top of scanner.js, that what is kept is exactly
                         what was outlined, was false on the one frame it
                         mattered on. `findPaper` calls `papersIn` now, so this
                         column measures both.
                         AND THE SHOWN COLUMN IMMEDIATELY FOUND TWO FAULTS
                         NOTHING COULD SEE, both older than it and neither
                         touched yet: `book, ONE page, a SLIVER of the next one`
                         95.5% found and 83.1% shown, and `sheet touching a
                         bright ledge` 92.8% found and 75.9% shown — the guard
                         makes both WORSE — with a worst shown spill of 24.0%
                         against 9.0% found. There is no gate on the shown
                         numbers yet because it would fail on those two. Three of the seventeen are the cases a phone
                         over a music stand actually makes and nothing drew
                         until now: one page of a book with a BAND of the next
                         in shot, the same with a SLIVER, and a page of DENSE
                         semiquaver runs (which was refused outright as "not
                         paper but ink" until this round).
npm run scan:edges       WHAT IS CUT IS WHAT WAS ASKED FOR, on both doors: the
                         corners somebody DRAGGED (taken as given — none of the
                         corrections `straightenCanvas` applies to a guess) and
                         the page the SHUTTER keeps off a book (no wider than
                         the page aimed at, none of the facing page in it).
npm run scan:guess       CAN THE APP FIND THE BARS IN THE TAKE BY ITSELF —
                         every system slid along a synthesised take by SHAPE,
                         no clef and no note named. Reports the two failures
                         apart: between the anchors (the map doing its job,
                         0.42s median on the Mozart) and past the last one (it
                         extrapolates and drifts, and wants a tap not a
                         cleverer match). `--drop`/`--wrong` spoil the take.
npm run scan:frame       WHAT THE SCANNER DOES WITH ONE REAL FRAME, and the only
                         instrument here that takes a photograph rather than a
                         drawing: `npm run scan:frame -- <image> [--crop t,b]
                         [--profile]`. It leaves the page the SHUTTER WOULD KEEP
                         beside the same corners taken as given, which is the
                         comparison that found the second half of the gutter
                         bug: the outline was right and the kept page was still
                         840 wide against 967, because `trimBackground` cut the
                         recovered margin off again. It says which route ran — two bright
                         regions found apart, or one wide quad cut at a fold —
                         where each boundary landed in the frame's own pixels,
                         how far the guard moved the gutter side, and with
                         `--profile` the brightness across the frame, which is
                         what a drawn fixture has to be built to match. A
                         screenshot of the scanner works: `--crop 300,220`
                         drops the buttons. It is what turned "the outline is
                         short on the gutter side" from two possible bugs into
                         one with an address.
npm run reader:review    STOP A TAKE ON THE MUSIC AND LAND ON THE REVIEW —
                         through the door he uses: the shelf on the Score tab,
                         a press on the row, the dot on the page, a take, and
                         then the score with marks to press and a sentence
                         about it. `reader:record` opens the reader by calling
                         `openReader` directly and therefore CANNOT see the
                         fault this was written for: opening a scan off the
                         shelf never made it the chosen score, so the review was
                         never built and stopping did nothing. Its fake
                         microphone plays real notes — a suspended AudioContext
                         is silence, and a take with nothing in it is discarded
                         before it can reach a review. NO MICROPHONE.
npm run reader:record    RECORDING WITHOUT LEAVING THE MUSIC — the dot on the
                         open score, pressed the way a finger presses it. One
                         recorder behind two doors (the Record tab's button must
                         read "Stop & review" while the reader's dot is red),
                         the music still on screen throughout, and — the
                         assertion that matters — the dot MEASURED IN PIXELS
                         while the take runs and a second into it. It shipped
                         invisible once: the state event carried no `canRecord`,
                         so the first tick of the clock hid the only way to stop
                         a running take, and a check that read `hidden` only at
                         the start passed ten out of ten over it.
                         NO MICROPHONE: getUserMedia is replaced before load.
npm run scan:practice    THE SAME, ON A TAKE THAT PRACTISES — one system four
                         times, a run-in, the whole page, once more at the end.
                         Checks the invariant the model exists for: a bar is
                         never offered a go that did not play it.
npm run scan:barmap      the bars drawn on the page they came off, for looking
                         at. It is how the map came to run on POSITION rather
                         than bar number: 31 boxes for 20 printed bars, because
                         a stem read as a barline cuts one bar into three.
npm run scan:barsync     tap a bar, hear that moment — the real layer over real
                         page elements, pressed the way a finger presses it.
npm run scan:anchors     and that the marks survive the app being shut, to the
                         take that made them and to no other.
npm run scan:book        the scanner on a book built out of REAL engraved pages
                         rather than drawn staves: a gutter, a lamp, an outer
                         edge curling. Says how much of the aimed page came back
                         and how much of its neighbour came with it, and leaves
                         frame.png / kept.jpg / sent.jpg to be looked at. Needs
                         a PDF from pages/index.json, and says so if there is
                         none rather than pretending.
npm run scan:import      THE SCAN, not the render: the three marked pages
                         photographed (SHRINK), straightened and de-shadowed
                         the way an import does it, read at READ_ACROSS and
                         scored against the same hand marks. It is the only
                         instrument that sees what a user's scan actually
                         gives the reader. 51.4% recall at a 6px staff space
                         against 85.8% at 10px — the size of the photograph is
                         the lever, not the light.
npm run scan:light       the two pages a photograph becomes: the bright one
                         that goes to the screen (paper 255, shadow gone, ink
                         still ink) and the plain one the reader reads. They are
                         separate because brightening what the reader reads
                         costs it notes — see scan:import.
npm run audio:fast       how fast you can play before the app stops HEARING
                         the notes — scales synthesised at 2 to 16 notes a
                         second through the real Analyzer + NoteSegmenter, with
                         no browser and no microphone. Every note heard and
                         named right up to 12 a second (83ms notes); at 16 a
                         second only 8 of 24 survive, because the analysis
                         window is 93ms. Onsets come back 16-31ms late with a
                         spread of ±20-30ms. Run it whenever the analyzer, the
                         segmenter or their windows move.
npm run score:open       a PDF imported THROUGH THE PICKER and then opened
                         through the shelf — the two things a player does and
                         the two things every other tool skips (they build a
                         part by calling savePagesScore). It also reads the
                         status line back and fails if the app ever says
                         "null". `npm run score:open -- <file.pdf>` tries a
                         particular file.
npm run score:fresh      the SEQUENCE nothing else can see: a review drawn
                         against a scan with no layout at all, then the reading
                         pass started underneath it. The rings have to appear
                         without the score being closed and reopened.
npm test                 unit tests.
```

Plus `scan:corpus`, `scan:sizes`, `scan:few`, `scan:bars`, `scan:clef`,
`scan:clef-hard`, `scan:key-safety` — all synthetic, all must hold.

And two that measure the REVIEW rather than the reader — which branch the app
takes and what it says out loud, not how well it read:

```
npm run score:follow     the whole scanned review, end to end, in a headless
                         browser: the marks, the moving light, pressing a
                         notehead you played, pressing one nobody played, the
                         two voices that must never sound together, and the
                         rhythm sentence with the route it came from — on two
                         engraved pages with a synthesised take, and then again
                         on a REAL photograph out of pages/index.json — PHOTO=0
                         Bach (default), 1 the Concerto, 2 the Scanned score.
                         37 checks — one counts the audio sources a press
                         starts, and one holds the bar sentence to what it can
                         prove: on a page whose bars are refused it must take
                         the `groups` route and must not say "steady".
                         --shots leaves the crops it looked at in
                         $TMPDIR/practice-partner-follow.
                         NO MICROPHONE ANYWHERE IN IT and none may ever be added.
npm run score:agree      the REVIEW and the full-screen READER, driven through
                         their own doors on ONE take, compared notehead for
                         notehead. The reader is one tap from the review
                         (score-tab.js listens on the whole #score-stage) and
                         nothing compared what the two said about the same take
                         until this existed: they disagreed on every note.
                         13 checks. Run it whenever either view's pairing moves.
npm run score:hear       the one sentence the review is for — "if you click on
                         a note on the score you hear that note in the audio" —
                         counted in AUDIO SOURCES STARTED, by patching
                         AudioBufferSourceNode.prototype.start and
                         OscillatorNode.prototype.start in the page. A notehead
                         you played must start >= 1 buffer source; a notehead
                         NOBODY played must start ZERO and one oscillator (the
                         written pitch). It exists because `score:follow`
                         asserted that a PANEL OPENED, and 35 checks passed
                         over a press that started nothing at all.
                         PHOTO=0/1/2 chooses the page. NO MICROPHONE.
npm run scan:rhythm      which branch scan-rhythm.js takes on the three real
                         photographs — bars believed against bars refused, and
                         therefore how many notes could get a verdict against a
                         PRINTED duration. Today: 0 believed on all three, and
                         `scan:bars-believed` says that is the RIGHT answer
                         rather than a missing feature.
```

**Every one of them needs `npm run dev` running on port 5199**, because the
tools drive a headless browser against the app's own code. If `bench` comes back
with "Command failed" three times, the server is down or on the wrong port.

## The rules that are not negotiable

1. **ZERO KEYS READ WRONG.** `scan:key-read` reports how many signatures were
   read as the *wrong* key. It is zero and it stays zero. A wrong key puts a
   semitone on every note of a degree across a whole page; a refusal costs only
   a fallback. A change that makes this non-zero is wrong whatever else it buys.
2. **RECALL MUST NOT FALL.** Not on any page by more than 0.3, and not on the
   mean. A missing note breaks the alignment a take depends on; an extra circle
   is cosmetic.
3. **A RING IN THE RIGHT PLACE IS NOT A RIGHT NOTE.** `bench` scores position
   and cannot fall when a name is wrong: the Bach page read **98.8% precision
   and 99.7% recall while the opening of BWV 1007 came back a second out**, and
   the repair that fixed the pitch COST 0.7 of that precision. Pitch on a
   photograph is measured from the PRINTED lines — `npm run scan:steps` — and a
   residual against the reader's own stave model measures nothing, because a
   model a whole step out still has every head sitting neatly on its own lines.
   Run `scan:steps` on all three pages whenever anything upstream of the step
   moves: `trackCombs`, `stavesToLines`, `fillMissedStaves`, or where a head's
   centre is taken.
4. **A NUMBER THAT WENT UP IS NOT A MEASUREMENT UNTIL THE ONES THAT COULD HAVE
   GONE DOWN HAVE BEEN RUN.** `20e004d` shipped a mid-system bass reader that
   never once read a bass clef — it was firing on the next notehead — and it
   broke both must-be-zero lines of `npm run scan:clef`. Its commit message
   quotes four measurements, every one of which is blind to a mid-system clef by
   construction. **A measurement that cannot see your change is not evidence
   about it**, however sacred its number is. The handover carries the correction
   under *The record on `20e004d`, corrected*.
5. **NULL PROPAGATES AND IS NEVER DEFAULTED.** A cello part is in bass clef most
   of the time, and "most of the time" is the assumption that turns the other
   times into a page of confident verdicts a sixth out of place. If the clef or
   the key could not be read, the pitch is null.
6. **DO NOT EDIT `pages/truth/*.json` WITHOUT LOOKING AT THE PAGE.** Those files
   are what every number is measured against, and a bad edit is invisible
   afterwards. Crop the mark, look at it, then remove it, and record what you
   removed in the file's own `removed` field. Twenty-three marks have been
   removed this way and every one was cropped first — some at 16x.

## The architecture, and why

**The shape tests localise, and a classifier judges.** Threshold sweeps stopped
working long ago: at a ten-pixel staff space a notehead and a rest are the same
size and the same shape class, so six sweeps in a row bought a point of recall
for a point of precision and gave it back. `head-model.js` carries the judge —
a logistic fit, plus a hidden layer consulted only where the logistic is unsure.

The same division solved accidentals after four geometric attempts failed, and
it is the first thing to reach for when a rule keeps trading one error for
another.

## How to work on it

- **LOOK AT THE PAGE.** Every real bug in this reader was found by drawing
  something on top of it. Every dead end came from reasoning about what the code
  probably does. `npm run scan:crop -- <pdf> x,y` draws one place;
  `npm run scan:sheet` draws a grid of them, which is how 162 marks were settled
  rather than sampled. **Magnification is not a detail of the method, it is the
  method** — at 3x a beam and a stem foot are the same smudge, and a
  twelve-point sample at low zoom got a conclusion exactly backwards once.
  `node tools/stave-look.mjs <pdf> --at x,y` draws the reader's five model lines
  over the printed ones at 8x — the same method for the stave, and how the wave
  that was losing the pitch was found.
- **`npm run scan:whatif -- '<find>' '<replace>'`** tries a constant WITHOUT
  editing the file: it fetches the served module, patches one string and imports
  the result from a blob URL, then prints all three pages before and after. A
  one-line idea costs a minute instead of a round.
- **Read "What is measured and does NOT work"** in the handover before proposing
  anything. It is long, it has numbers, and it exists because several ideas have
  been proposed three times.
- **Retraining any model changes which candidates exist**, so the model must be
  refitted against the new distribution. `npm run scan:patches` must run with
  the judge OFF or the model eats its own tail.

## House style

Comments explain WHY, in prose, above the code — including what was tried and
did not work, with the measurement. This is not decoration: it is the only
reason six dead ends have not been re-implemented. Match it. Write
`// MEASURED, on the Bärenreiter page: …` and not `// set threshold`.

Commit messages are lower-case sentences that say what changed about the
BEHAVIOUR and what it cost, with the numbers.

## Things that are easy to get wrong

- `npm run scan:truth -- --all` does not work; npm eats `--all`. Invoke the tool
  directly: `node tools/truth-check.mjs "<pdf>" --truth <json> --all`.
- Two sessions have shared this repo. Use `git add <explicit paths>`, never
  `git add -A`.
- **`scan:steps` lives only in the working tree** — `tools/step-truth.mjs`,
  `tools/stave-look.mjs` and `pages/truth/bach.pitch.json` are UNTRACKED, and the
  `scan:steps` line in `package.json` is uncommitted. A `git stash` or a branch
  reset takes the only instrument that measures pitch on real paper with it.
  **The same is now true of the duration and alignment instruments**:
  `pages/truth/scanned.values.json`, `tools/value-truth.mjs`,
  `tools/value-bars.mjs`,
  `tools/align-check.mjs`, `tools/align-floor.mjs`, `tools/rhythm-check.mjs`,
  `tools/scan-follow-check.mjs`,
  `tools/reader-agree-check.mjs`,
  `src/analysis/scan-sync.js`, `src/analysis/scan-rhythm.js`,
  `src/audio/written-pitch.js` and `src/fixtures/take-fixture.js` are all
  untracked as this is written. A stash takes the review's whole scanned half.
- **THE SCAN FIXTURES ARE ENGRAVED, and must stay that way.** `score:review`,
  `score:playback` and `score:agree` build their pages with
  `src/fixtures/engraved-page.js` — Bravura noteheads, a bass clef, one sharp —
  because a page with no clef prices no notehead, and the review REFUSES to
  place a take on a page it cannot price. Fixtures drawn as bare ellipses (which
  is what three of those four used) leave twenty-nine assertions about the
  review failing for one reason that is not the app.
- **THERE IS NO SCORE RECOGNISER ANY MORE, no `server/`, and nothing to install
  for one.** The fly.io app it ran on is destroyed, the Audiveris build and the
  oemer virtualenv under `server/` are deleted, and the JDK that was installed
  to build Audiveris is uninstalled. `tesseract` STAYS — ghostscript and
  lilypond depend on it, and ghostscript is what renders a PDF page for
  `scan:book`. A scan used to be sent to that service, which handed back
  MusicXML — see "Playing a scan from a bar" in the handover for what replaced
  it and for the measurements that decided it. `omr:truth`, `omr:look`,
  `omr:payload`, `score:scan`, `score:omr` and `score:hosted` went with it, as
  did `src/analysis/omr-client.js` and the whole `server/` directory. Importing
  a MusicXML file you already have is a DIFFERENT feature and is untouched: that
  route is exact, and it is the one to point somebody at who wants wrong notes
  caught.
- **MEASURE ON THE MACHINE, NOT ON THE LAPTOP.** The pipeline races four
  readings of a short document with a deadline on each and keeps the best that
  finished. The fly machine has two cores; this one has more. A photographed
  page that reads as 297 notes here read as 14 there, and the rule that picks
  between readings then kept an 18-note reading over a 168-note one — a bug
  nothing local could see, and the reason a fix could be "verified" three times
  and still not work for the person using it. Every percentage in the handover
  taken locally is an upper bound. `scratchpad/hosted-check.mjs`-shaped scripts
  (POST /v1/scores, poll /v1/jobs/:id — note the response is `{job:{...}}`, and
  the four readings are in `job.log`) are how to see what the service actually
  did.
- **A BROWSER CHECK RUN STRAIGHT AFTER AN EDIT MEASURES A DIFFERENT MODULE FROM
  THE ONE THE APP IS USING.** `score:agree` now DETECTS this and stops with the
  instruction rather than emitting eleven phantom failures — one round baselined
  those eleven as pre-existing, and they were sixteen passes after a restart. Vite serves an edited module at a versioned URL
  (`/src/x.js?t=…`) to everything that imports it, while a check's own
  `await import('/src/x.js')` asks for the unversioned one — so the check gets a
  SECOND INSTANCE with its own module state. MEASURED, this round: five checks
  in `score:follow` failed with "the light never moved" and "the tone sounded
  midi null" against code that was working, because `report.js`'s follower set
  and `written-pitch.js`'s `last` lived in one copy and the check read the
  other. **Restart `npm run dev` after editing and before measuring.** A failure
  that appears the moment you touch a file and survives a revert is this, not
  your change.
- Editing a source file while a measurement is running invalidates it — Vite
  hot-reloads and the page navigates out from under the browser.
- `ProtocolError: Runtime.callFunctionOn timed out` means the MACHINE is loaded,
  not that the change broke something. `scan:key-safety` already raises
  puppeteer's `protocolTimeout`; `scan:key-read` does not, and it is the one that
  dies first. Check `uptime` before believing a failure.
