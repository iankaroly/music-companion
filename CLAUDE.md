# Working in this repo

Most of this app is ordinary. The page reader is not, and it is where almost all
the work goes, so this file is mostly about that. `docs/reader-handover.md` is
the full state of it — read that before changing the reader. This is the short
version that fits in your head.

## The one-paragraph summary of the reader

`src/analysis/scan-read.js` finds staves, clefs, key signatures, barlines and
noteheads on a photograph of sheet music, and `scan-notes.js` turns a notehead's
position into a pitch using the clef and the key. It works on a SINGLE-STAVE
PART in any key, in treble, bass or tenor clef. It reads a C-clef or a TREBLE
printed part way along a system; it does not read a mid-system BASS, and that is
measured and written up rather than untried. It has never been tested on a piano
score or on two voices on one stave.

## The five measurements, in the order they rank

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
npm test                 unit tests.
```

Plus `scan:corpus`, `scan:sizes`, `scan:few`, `scan:bars`, `scan:clef`,
`scan:clef-hard`, `scan:key-safety` — all synthetic, all must hold.

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
- Editing a source file while a measurement is running invalidates it — Vite
  hot-reloads and the page navigates out from under the browser.
- `ProtocolError: Runtime.callFunctionOn timed out` means the MACHINE is loaded,
  not that the change broke something. `scan:key-safety` already raises
  puppeteer's `protocolTimeout`; `scan:key-read` does not, and it is the one that
  dies first. Check `uptime` before believing a failure.
