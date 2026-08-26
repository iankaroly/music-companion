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
                         91.8% mean IoU (92.1% SHOWN), worst spill 9%, 0 spans,
                         0 page counts wrong.
                         WHY=<part of a case name> prints the sides — where the
                         paper really is, where the finder put it AT THE SCALE
                         THE GUARD SEES (220px, which is the only scale the app
                         ever uses), and where the guard left it. The IoU column
                         is measured at full canvas size and the app never runs
                         there, so a case where those two disagree has two
                         suspects and the table cannot tell them apart. It also
                         prints which route fired. Run it whenever page-edges.js, straighten.js or
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
                         THE GUTTER SIDE REACHES THE PAPER'S OWN EDGE NOW, not
                         the last note. "the blue rectangle, when it's an open
                         book, goes just to where the note's cut off… I want it
                         to go to the middle of the book, where the crease is."
                         `printReachesTo` asks where the PRINTING stops and that
                         is the last note; between it and the crease is this
                         page's own inner margin, which is paper.
                         `paperReachesTo` walks the same columns asking whether
                         it is still the page — blank margin holds the page's own
                         brightness, a crease falls away — and stops at the fall.
                         ONLY WHERE THE NEIGHBOUR IS A FACING PAGE: two loose
                         sheets are "beside" each other by the same test and the
                         middle of THAT is desk, so `besideOf` reports the gap
                         and anything wider than a seam keeps the old answer.
                         NOT THE MIDPOINT, which was tried first and is the
                         bottom of the trough with half of it belonging to the
                         other leaf: `open book, dark crease` 95.9% -> 93.7% and
                         `open book on a PALE desk` 94.9% -> 93.8%. Walking to
                         the paper's edge instead takes them to 96.6% and 95.9%
                         with nothing else moved either way.
                         THE ONE-REGION CASE IS STILL OPEN, and there is an
                         address for it. "the blue rectangle only reaches
                         about 85% of the page, especially if it's on the left
                         side." MEASURED, `WHY=BAND`, case `book, ONE page, a
                         BAND of the next one in shot`: one bright region, so
                         `pagesTogether` cuts it at the fold — and the fold is
                         put at 0.284 of the frame when the paper really parts
                         at 0.224..0.253. The seam lands PAST the gutter and a
                         twentieth of the frame inside the page being aimed at,
                         so that page's outline starts six per cent late on its
                         left and the other swallows the whole gutter (11.8%
                         spill). `foldByInk` was not the culprit — putting its
                         seam on the darkest column of the corridor rather than
                         the middle of it did not move this case at all — so
                         `foldIn` is answering and mis-locating the crease.
                         THAT IS THE NEXT THING TO PICK UP, and it wants
                         `scan:frame` on a real photograph of his book rather
                         than another pass over a drawn one.
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
npm run scan:strip       THE ROW OF THUMBNAILS AT THE FOOT OF THE SCANNER:
                         how long after the shutter a picture is in it (69ms
                         against 340ms for the finished page — the frame goes up
                         at once and the straightened page replaces it), that
                         the MIDDLE OF THE PICTURE opens the edges rather than a
                         thirty-pixel word in its corner, that the ✕ still owns
                         its own middle, and that the editor is the page and two
                         buttons with no instructions on it.
npm run page:card        "PAGE 1 COULD NOT BE READ" HAS TO BE TEMPORARY. Every
                         decoder is refused, the card goes up, the refusal is
                         lifted, and the very next ask has to get the page —
                         `load` never remembers a failure, and now `drewACard`
                         says one happened so the reader can ask again. It tests
                         the PAPER layer: driving the whole reader into an iOS
                         memory refusal headlessly hung rather than measured, so
                         the reader's own retry is watched through
                         `readerState().cardsDrawn/cardsHealed` on the device.
npm run crop:edit        MOVING THE EDGES OF A SCANNED PAGE — where the
                         handles START and what a drag COSTS. The scanner kept
                         the outline it FOUND and opened the editor on that, but
                         three things move an outline between being found and
                         being cut (the guard pushes a side out to the paper's
                         real edge, `widen` lets it out by a tenth, and
                         `trimBackground` takes back what that let in), so the
                         handles sat inside the page that had been kept —
                         2.9% of the frame on the drawn case, and dragging them
                         out again undid work already done right.
                         `straightenCanvas` reports the quad it cut (`onQuad`)
                         and the scanner keeps THAT.
                         The drag: 0.049ms a move before, 0.011 after —
                         `draw` was writing an SVG source string into innerHTML
                         on every pointermove, and the shade was a full-screen
                         MASK, which is an offscreen buffer the size of the
                         screen re-rasterised every frame over a
                         twelve-megapixel photograph. One even-odd path now.
                         AND IT ASSERTS THE OVERLAY IS THE SIZE OF THE LAYER,
                         because taking the viewBox off an <svg> makes it a
                         replaced element with an intrinsic 300x150 that ignores
                         `inset: 0` — the outline shrank into the corner and
                         every other assertion here still passed. That one was
                         found by LOOKING at a screenshot.
npm run settings:away    TAP THE DARK AND THE SETTINGS SHEET GOES AWAY, and
                         nothing else does. The one-line version of this —
                         close when `event.target` is the dialog — closes on a
                         tap on the sheet's own 24px of PADDING, which is inside
                         the sheet you can see; the rectangle version it was
                         replaced with would instead close on a slider dragged
                         out past the edge (range inputs capture the pointer) and
                         on a keyboard's click at 0,0. All three are checks here.
npm run review:taps      CAN A FINGER REACH THE REVIEW'S CONTROLS — the pixel
                         in the middle of the graph's play button, of Save and
                         of Discard, and what is actually there to receive a
                         touch, at 390x844. It exists because none of the three
                         could be pressed at all: the sentence in score.js that
                         reports what the barlines cut the take into carried the
                         class `scan-bars`, which is the LAYER of invisible
                         boxes over a photographed page (`position: absolute;
                         inset: 0; z-index: 3`), so a line of prose became a
                         390x1383 transparent sheet over the whole review. Every
                         handler was wired the whole time; the click never
                         arrived. It also MAKES the hazard — a stray sentence
                         carrying that class — because the real one is only
                         written on a take the reader managed to bar, and a
                         check that waits for the hazard to happen is a check
                         that passes because it did not. It also covers the
                         held-for picker under the graph (only the notes
                         sustained N seconds or longer stay in the list) —
                         including that a filtered note is HIDDEN and not
                         removed, because `tileByNote` is how a notehead pressed
                         on the page finds its tile.
                         AND THE LADDER UNDER THAT, which is the same picker
                         asked for a second way: "the presets could be 0.5 /
                         0.75 / 1 / 1.5 / 2 seconds… as soon as you select one of
                         those options, it shows you the list of the notes that
                         comply with those standards. You can just click on one
                         of them, and it'll take you to that part of the graph."
                         Six rungs and a typed field holding ONE number between
                         them, and a strip of buttons under it — one per note
                         that qualified, in the order they were PLAYED, each
                         saying what the note is and how far into the take it
                         is. The assertion the feature is for is the SCROLL:
                         pressing one moves `#chart-scroll` to that moment
                         (`controller.reveal` in pitch-chart.js, pulled out of
                         `setPlayhead` so the list and the playhead share one
                         answer to "is it visible"). It also counts the audio
                         sources the press starts, because a panel that opens is
                         not a note that sounded.
                         IT NEEDS A TAKE OF ITS OWN and builds one: the fixture
                         above holds every note for 0.3s, so against it all six
                         rungs would only ever exercise the empty case. The
                         second take alternates 0.35s and 1.4s and runs long
                         enough that the graph has somewhere to scroll TO.
                         READ THE TWO ELEMENTS, not `textContent`: the name is a
                         block <b> over the time, so "A#3" and "2.2s" run
                         together as "A#32.2s" and a regex for a number reads it
                         as thirty-two seconds. That cost a round.
                         NO MICROPHONE.
npm run review:follow    WHO IS DRIVING THE SCROLL WHILE A TAKE PLAYS. The light
                         moves down the music and the page is pulled after it,
                         so a hand reaching PAST the music for the pause button
                         or the trace was overruled a second later, every second.
                         A touch now takes the wheel and a SEEK gives it back —
                         latched on the gesture (`wheel`/`touchstart`/
                         `pointerdown`) and never on the `scroll` event, because
                         `keepInView` scrolls and a latch listening for that
                         would trip on its own footsteps. Three facts, not one:
                         the follower DOES scroll before anyone touches it, it
                         keeps arriving and stops scrolling after a touch, and a
                         bar press starts it again. score-tab.js counts both
                         halves (`followState`) so the middle one cannot pass by
                         being dead. NO MICROPHONE.
npm run metro:page       THE METRONOME IS A PAGE, NOT A SCROLL. One card with
                         everything on it, so the drag was slack rather than
                         content: the card is set in rem and comes to ~640px,
                         and the panel reserves another 104 for the tab bar, so
                         anything shorter than about 750 was a page and a bit —
                         and the bit was Start. Checked at every height a phone
                         hands this app (568 through 1180): no scroll, AND Start
                         still above the tab bar and still what a finger lands
                         on. That second half is the point — the cheap way to
                         stop a page scrolling is to clip it. It also has to
                         press the tab until it takes: the app restores the last
                         tab AFTER load, and a single click at a fixed delay
                         raced it and measured the tuner half the time.
npm run read:stall       HOW LONG THE MAIN THREAD IS UNAVAILABLE while a part is
                         being read, which is the number behind "it takes a
                         while to load before i can tap through the pages". A
                         timer that wants to run every 50ms, reporting how late
                         it actually is: a block of work N ms long makes it N ms
                         late, whatever else the machine is doing.
                         MEAN TURN TIME IS THE WRONG MEASURE and an earlier
                         attempt at this was reverted because of it — cold means
                         ran 1344-2669ms on IDENTICAL code, so the noise swamped
                         the change and nothing could be told from it. The size
                         of the biggest uninterruptible block is what is
                         actually being changed, and it is stable to about 5%
                         run to run. NO MICROPHONE, NO CAMERA.
npm run reader:card      "PAGE 1 COULD NOT BE READ", TWENTY SECONDS IN, AND HOW
                         IT GOES AWAY. The twenty seconds is not the reading
                         pass being slow: when it finishes it STORES what it
                         measured, and storing triggers a re-layout —
                         `relayoutSameScore` → `layOutPaper` — which destroys
                         the paper instance and builds a new one with an empty
                         decode cache and an empty set of small copies, then
                         decodes every visible page again from nothing.
                         Measured at 11.7–20.3s after opening. Before that a
                         card is impossible; after it every page is decoded
                         afresh with nothing to fall back on, at exactly the
                         moment the reading pass has finished eating the memory.
                         This refuses every decode for TWELVE SECONDS, armed on
                         the re-layout itself, and then asserts the card is
                         gone. The window has to outlast the old three-try retry
                         (0.9 + 1.8 + 2.7 = 5.4s) or it heals on a broken build
                         and proves nothing — a three-second refusal does.
                         It reads the CANVAS, not a counter: the counter is the
                         thing that was wrong (17 cards drawn, 15 counted, one
                         boolean for the whole score drained by whoever asked
                         first). NO MICROPHONE, NO CAMERA.
                         WHAT IT ASSERTS IS NOW THE OPPOSITE. It used to require
                         a card to be DRAWN and then to heal; the small copies
                         of the pages outlive the re-layout now (`sparesFor` in
                         paper.js), so a page that has been read is never
                         replaced by a card at all, and the old setup assertion
                         fails on a working build. It asserts NO CARD across the
                         whole refusal window instead, which is the stronger
                         statement. The healing path underneath is still real
                         and is measured by `page:card`, which covers the one
                         case a card is honest about: a page never decoded.
npm run edges:card       THE SAME CARD, FROM THE OTHER DOOR: "after being in a
                         score and then clicking change edges and cropping it,
                         it will say page not read and i have to reopen it."
                         TRIMMING a page never did this and CHANGING ITS EDGES
                         always did, and the difference was one line of the
                         database — `setPageCrop` leaves the page's SIZE alone
                         and `replaceOnePage` nulled it. paper.js decides how
                         big to decode a page from that number (DECODE_MAX and
                         `big` in `load`), so with none on record it decoded the
                         WHOLE 2600-pixel page at the one moment there is least
                         room for it: the straightened canvas and the
                         twelve-megapixel photograph it was cut from were both
                         still alive, because nothing zeroed them. Every retry
                         then repeated the same unbounded decode, which is the
                         "I have to reopen it".
                         It goes through the ⋯ menu, "Change the edges…", the
                         page row and the tick, and arms twelve seconds of
                         refused decodes ON THE RE-LAYOUT — not on the tick,
                         because between them is a full-size decode of the
                         PHOTOGRAPH the edges are cut from, and refusing that
                         means the edit never happens and the check passes for
                         the wrong reason (it did, first time round: it read the
                         ORIGINAL page's size back and called it the new one).
                         Four assertions, every one of which fails without the
                         fix: the page really was replaced, the size is on
                         record BEFORE the first decode of it (read at the
                         re-layout, because the reader measures its own pages a
                         moment later and a size read at the end is there
                         either way), no card is ever drawn, and the page gets
                         its layout back so it is still cut into screenfuls.
                         NO MICROPHONE, NO CAMERA.
npm run take:save        A TAKE RECORDED FROM THE MUSIC LANDS SOMEWHERE YOU CAN
                         FIND IT. "when you record from the score and then save
                         it, it just saves to the library under that name…if you
                         save another take, then that one in the library turns
                         into a folder where it shows both the takes, because
                         right now when you save it, it's not going anywhere."
                         It WAS going somewhere: `saveRecording` ignored every
                         name it was handed, so a take saved from a piece
                         arrived with none and `libraryRow` drew it as its DATE
                         with the piece in the grey line underneath. Nothing on
                         the shelf was called what he had just played.
                         Two takes, through the doors he uses — the dot on the
                         music, the save bar under the review, the name dialog
                         with the piece already in it — and then the library is
                         read BOTH ways, from the store and from the rows on the
                         glass, because the rows are what he is looking at and
                         the store is what is wrong if they disagree. The second
                         lap reloads first: after a save the Score tab is
                         showing the REVIEW, not the shelf, and a check that
                         pressed the first button whose words contained the
                         piece's name pressed "Add this take to…" and measured a
                         lap that never happened.
                         AND BOTH TAKES ARE STILL TAKES OF THE PIECE: a folder
                         hides them from the library's top level, which is the
                         point, and must not touch `scoreId` — the shelf's
                         count, an engraved part's own take list and the coach
                         all read that, and a folder that quietly detached them
                         would empty all three as a side effect of the feature.
                         The decision it rests on is unit-tested apart from the
                         database: `whereTakeGoes` in store/db.js, and
                         tests/take-filing.test.js. NO MICROPHONE (the fake
                         device plays real notes, because a take the segmenter
                         finds nothing in is discarded before it can be saved).
npm run app:sweep        WALK THE WHOLE APP AND WRITE DOWN EVERYTHING IT THROWS.
                         It asserts almost nothing: it works the app the way a
                         hand works it and reports what came out of the console.
                         Both bugs that mattered this week were sitting there
                         and invisible to every targeted check in this repo —
                         main.js stopping dead for anybody whose last tab was
                         not the tuner, and a ReferenceError at the end of every
                         edges edit.
                         TWO THINGS MAKE IT SHARP, both taken from how those
                         hid. EVERYTHING TWICE — open, act, act again, close,
                         reopen — because the second lap is what catches a
                         handler holding something that has been replaced. And
                         FROM A COLD START, FIVE WAYS: what the app remembers
                         between visits is a real input and never the default.
                         It also COUNTS WHAT IT DID and fails if a step goes
                         quiet, which found three of its own steps doing nothing
                         the first time it ran. And it keeps a ledger over
                         `ResizeObserver`, because a watcher made on every
                         render and never disconnected throws nothing and draws
                         nothing wrong until the screen changes size.
                         NO REAL CAMERA: the fake device only.
npm run app:reach       EVERY CONTROL ON THE SCREEN CAN BE PRESSED. Three faults
                         in this app have been the same fault and none of them
                         threw anything or failed any check that existed at the
                         time: a SENTENCE carrying the bar layer's class became
                         a transparent sheet over the whole review; the word
                         "Edges" took the tap meant for the picture under it;
                         the shutter's flash had no `pointer-events: none`.
                         Each was found by accident. This asks the question of
                         every button, link and field on every screen.
                         TWO RULES DO THE WORK and both were wrong first time.
                         A control behind a sheet that covers the screen is
                         meant to be out of reach — but written as "only look
                         inside the top surface" that also hid a sheet sitting
                         on its OWN parent's controls, which is what the flash
                         and the options-sheet fault both are. And `hit.contains
                         (el)` was allowed, to let a menu row sit over the
                         button that opened it — which swallowed every case of
                         an ancestor painting over its own child, and a
                         full-screen `::after` is exactly that (elementFromPoint
                         reports the element, never the pseudo).
                         VERIFIED BY PUTTING BOTH FAULTS BACK: the first version
                         passed with them in. The flash is held up by hand
                         rather than raced — 180ms is not long enough to walk
                         the screen, and a step that passes by arriving late is
                         the failure this whole tool exists to avoid.
npm run edge:fit         NOTHING RUNS OFF THE EDGE OF THE SCREEN, at five phone
                         widths from 320 to 430. It looks at the DOCUMENT rather
                         than at a list of suspects, because the next one of
                         these will be somewhere nobody thought to look — and it
                         found five at once, including the tab bar (the last tab
                         cut off on every screen in the app) and the pitch graph
                         (11px off BOTH edges, taking the pitch names with it).
                         Two things are allowed past the edge and both are
                         named in the tool: anything inside something that
                         scrolls sideways, and the drifting colour behind
                         everything. It also asserts the graph REACHES both
                         edges, so a bleed that is too small fails too.
npm run scan:lag         HOW SLOW THE SCANNER IS, in three numbers, because "the
                         scanner is slow to use" was open and undiagnosed for
                         weeks behind one sentence: "I do not know whether what
                         is slow is the outline, the shutter, or the app." The
                         outline is a tick of the watch loop (it runs every
                         150ms and finds the page on every one); the shutter is
                         press-to-picture and press-to-page; the app is
                         press-to-usable-again. THROTTLE=6 slows the processor
                         by roughly the gap to a phone, which is where the
                         numbers in the commit messages are read.
npm run reader:turns:cold
                         HOW LONG A PAGE TAKES TO ARRIVE. Three knobs, and the
                         defaults hide the thing being complained about:
                         `WIDE=2600` builds the pages at the size a phone
                         photograph actually is (the default 1100px PNG decodes
                         in about twenty milliseconds), `KIND=pdf` measures the
                         other reader entirely — a PDF page is RENDERED afresh
                         every time it is drawn, where an image is decoded once
                         and cached — and `THROTTLE=6` slows the processor by
                         roughly the gap between this laptop and his phone.
                         It measures TURNS and, separately, JUMPS: a jump has no
                         look-ahead in front of it, which is the "tap to a page
                         you haven't tapped to yet" case.
                         ITS FIXTURE WAS BROKEN FOR A LONG TIME and every number
                         it printed was wrong: the pages were stored as data
                         URLs, `readableImage` cannot decode one, and what the
                         tool was timing was the DECODE LADDER GIVING UP — four
                         quick tries and a 900ms wait before the last. That is
                         where its ~1000ms turns came from, and why it concluded
                         cold and warm were alike. Blobs now, and `cardsDrawn`
                         is on `readerState()` so a run against placeholders
                         cannot look like a run against pages.
npm run shelf:find      SEARCHING THE THREE LISTS. The score shelf, the library
                         and the "playing from" pop-over are three different
                         mechanisms — two filter their own list, the third is a
                         pop-over `menu()` builds out of a hidden <select> — so
                         one sentence ("search like forScore") is three pieces
                         of work. The pop-over's search is gated on the LENGTH
                         of the list rather than on which control it is, because
                         the same function draws "same note / fifth up / fifth
                         down" and a search field in a list of three is worse
                         than none; BOTH halves of that gate are checked. It
                         also checks the ＋ Folder button on the shelf, and it
                         names its takes with `renameRecording` — handing a
                         `name` to `saveRecording` stores nothing, which is how
                         this first "found" no takes at all.
npm run reader:record    RECORDING WITHOUT LEAVING THE MUSIC — the button in the
                         reader's own bar, pressed the way a finger presses it. One
                         recorder behind two doors (the Record tab's button must
                         read "Stop & review" while the reader's dot is red),
                         and the music still on screen throughout.
                         THE CONTRACT REVERSED, and this entry with it. It used
                         to assert the dot was STILL THERE while the take ran: a
                         take pinned the bar open so there was always a visible
                         way to stop, after it once shipped invisible. He asked
                         for the opposite — "once you click record, it gets rid
                         of the menu bar right away… you can click at the top to
                         get it back" — so the bar now goes at the press, and
                         what pays for it is checked instead: it is bare a
                         second in, a tap at the top brings it back WITH the
                         stop on it and the take still running, and the pencil
                         path still has the stop under the hand.
                         `seen()` HIT-TESTS NOW. It used to read the button's
                         own hidden/box/opacity — none of which a button reports
                         about its PARENT — so it passed while the bar it sits
                         in was translated clean off the top of the screen.
                         AND THE PENCIL BAR HAS NO RECORD BUTTON IN IT, which
                         is the other half and pulls the opposite way — "there
                         shouldn't be a record button when I click on the pencil
                         icon… only on the main one like it is." The invariant
                         above is about a STOP and is untouched: a take that is
                         RUNNING still moves its button into the ink bar, where
                         it is a square and can be pressed. The two assertions
                         sit side by side here on purpose, because the tempting
                         way to satisfy either one is to break the other.
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
npm run scan:start       "I started here" — one tap saying where the playing
                         began, and the map run from that bar instead of from
                         the top of the part. Prints the before as well as the
                         after: what pressing a bar asks to hear when the take
                         is spread over the whole page, and what it asks once
                         the start is marked. Also the hole under it — a mark
                         made before the take has ever been played back used to
                         be written down as "second zero".
npm run scan:pager       a part of several pages in the review, one page at a
                         time. That the arrows turn it and stop at the ends,
                         and — the half that matters — that a turn touches
                         nothing the sound depends on: the same page elements,
                         canvases and bar boxes survive it by IDENTITY, the
                         follower is never unsubscribed, and the take is never
                         asked to play again.
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
                         MASTER raises the page the photograph is taken OF, so
                         a camera BIGGER than the old 1400px master can be
                         priced: with a 1400 master, SHRINK past 1.0 upscales a
                         render and measures a blurrier page, not a bigger one.
                         The whole curve, MASTER=2800, READ_ACROSS = the page's
                         own width, which is what the app reaches (paper.js
                         draws at 1400 and again at 2400 where the space is
                         small):
                            1008px across   space 4.0px   54.9%  Bach finds NO staves
                            1440px across   space 6.2px   73.0%
                            1920px across   space 8.0px   82.5%
                            2400px across   space 10.3px  84.0%
                            2800px across   space 12.0px  84.4%
                         A CLIFF AND THEN A PLATEAU, and it is the number that
                         decides whether a native camera is worth building: all
                         of the gain is between a thousand pixels and about
                         nineteen hundred, and a twelve-megapixel still buys
                         under two points over a 1080p frame. What the browser
                         hands over is therefore the only thing left to measure,
                         and Settings → Your camera says it (`cameraReport` in
                         ui/scanner.js).
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
npm run score:hear       the one sentence the review is for, and IT CHANGED on
                         2026-08-22. It used to be "if you click on a note on
                         the score you hear that note in the audio". A scanned
                         page no longer has note-level presses at all: "I don't
                         want to be able to press the note head. If you press
                         the note head, I just want to start at the beginning of
                         that bar… No going to individual notes, because I know
                         that's not possible." He is right that it is not — the
                         reader finds roughly one notehead where the paper has
                         one but not reliably THE one, and this check had been
                         reporting the consequence for two rounds (pressing head
                         116 lit heads 121, 122 and 123).
                         So it now measures: a real mouse over a RING lands on
                         the BAR under it; that press starts >= 1 buffer source
                         and ZERO oscillators; the bar that lights is the one
                         pressed (8ms after the source starts, on the Bach
                         photograph); a notehead nobody played does the same;
                         nothing on a scan ever sounds a synthesised note; and a
                         second press re-seeks rather than stopping.
                         It exists because `score:follow` asserted that a PANEL
                         OPENED, and 35 checks passed over a press that started
                         nothing at all. PHOTO=0/1/2 chooses the page.
                         THE NOTATION REVIEW IS UNTOUCHED: a part imported as
                         MusicXML knows which note is which by construction, and
                         a note-level control there is honest.
                         NO MICROPHONE.
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
