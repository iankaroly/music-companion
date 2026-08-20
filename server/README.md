# score-pipeline

Scanned PDF → OMR → MusicXML → structured score → **an API that maps bars and
notes to timestamps in a recording**.

The last arrow is the point. Everything before it exists to produce a score
model precise enough that aligning it to audio is a one-dimensional problem.

```
POST /v1/scores            (a scanned PDF)          -> 202 { scoreId, jobId }
GET  /v1/jobs/:id                                   -> stage, percent, engine log
GET  /v1/scores/:id/measures                        -> bars, keys, times, page positions
GET  /v1/scores/:id/timeline                        -> the score as PLAYED (repeats unfolded)
POST /v1/scores/:id/alignments  { anchors }         -> a timemap
GET  /v1/alignments/:id/cursor?t=41.2               -> bar 17, beat 3, these noteheads
GET  /v1/alignments/:id/schedule                    -> every note, start and end in seconds
```

---

## Quick start

**A scan to a MusicXML file, in one command.** A PDF, a photo, or a MusicXML
file you already have — the type is sniffed from the bytes, not the extension:

```bash
cd server
npm install
./scripts/install-audiveris.sh      # the engine (~10 min, builds from source)

npm run convert -- ~/Downloads/part.pdf     # or part.jpg, part.png, part.tiff
# reading part.pdf (pdf, 1.8MB)
#    15%  audiveris: page 3 of 10
#   ...
# engine       audiveris
# pages        1:33 bars  2:FAILED  3:27 bars
# rhythm       0.65 (7 bars that do not add up)
# → ~/Downloads/part.musicxml
```

That is the whole interaction for "I have a scan and I want the XML" — no
server, no job polling. `--json score.json` also writes the parsed model
(bars, notes, the performance timeline). `--engines` says what is installed.

Without an engine installed nothing errors — you get the FIXTURE score, clearly
labelled `DEGRADED`, because silently returning invented notes would be the
worst failure available here. `./scripts/install-oemer.sh` is the lighter
alternative (pip, no Java) if you would rather not build Audiveris.

**The server, for everything else:**

```bash
npm run engines:probe               # what can this machine read?
npm start                           # http://127.0.0.1:4000 — the demo client is at /

# convert a scan
curl -X POST localhost:4000/v1/scores -F "file=@Menuet.pdf" -F "title=Bach Menuet"
# -> {"scoreId":"sc_…","jobId":"job_…","poll":"/v1/jobs/job_…"}

curl localhost:4000/v1/jobs/job_…   # poll until "done"

# align it to a recording: two taps is enough
curl -X POST localhost:4000/v1/scores/sc_…/alignments \
  -H 'content-type: application/json' \
  -d '{"anchors":[{"measure":1,"beat":1,"time":2.4},{"measure":16,"beat":1,"time":48.1}]}'

# then ask what is sounding at any moment
curl 'localhost:4000/v1/alignments/al_…/cursor?t=12.5'
```

`npm test` runs the whole thing end to end (133 tests, ~2s) with no OMR engine
installed — see **The fixture engine** below. That includes the multi-page
orchestration: `test/multipage.test.js` drives the real pipeline with STUB
engines returning prepared pages, so "page 2 was refused", "page 2 came back
nearly empty", "the second opinion was worse", "neither engine could read it"
and a thirty-page book are all covered in milliseconds rather than the half
hour a real run of them costs. `npm run demo:check` drives the
demo client at `/` in a headless browser (upload → convert → align → cursor)
and leaves a screenshot, since that page is the one piece of code the unit
tests cannot reach.

> **oemer needs pinned numeric packages.** oemer 0.1.5 still calls `np.int`,
> removed in numpy 1.24, so a plain `pip install oemer` fails on the first page
> with an `AttributeError`. `install-oemer.sh` pins `numpy<1.24` and
> `opencv-python<4.9` for that reason. A page takes minutes: it is a model plus
> a lot of Python pixel work, and it is the reason the API is job-based.

---

## Architecture, and why

### The pipeline is five modules that do not know about each other

```
 upload ──▶ sniff ──▶ OMR engine ──▶ MusicXML ──▶ score model ──▶ timeline ──▶ timemap
            │         (pluggable)     (text)       (parse.js)     (played)     (seconds)
            └ bytes, not filenames
```

`src/pipeline.js` is the only file that knows the order. Each stage's contract
is a data structure, not a function call into the next stage, so any one of them
can be replaced without touching the others. That is what makes "swap the OMR
engine" a one-file change and "add audio-driven alignment" a change to *nothing*
— an aligner is just something that produces anchors.

### 1. OMR is behind an adapter, and there are four of them

| engine | needs | reads | layout coordinates | why it exists |
|---|---|---|---|---|
| **audiveris** | a JDK + Tesseract (`scripts/install-audiveris.sh` installs both and builds it) | a whole PDF at once, and page by page when one sheet is bad | **yes** | the primary: best accuracy, much the fastest (~30s a sheet), and the only one that says *where on the page* each note is |
| **oemer** | `pip install oemer` | one image per page | no | the no-Java path; makes the pipeline runnable on any machine today |
| **fixture** | nothing | ignores the upload | n/a | tests, front-end development, and telling a recognition bug from a pipeline bug |
| **musicxml** | nothing | `.musicxml` / `.mxl` | as exported | a player who already owns the file must never be made to scan it |

An adapter is four things — `id`, `accepts`, `available()`, `convert()` — and
adding one (homr, Mozart, a hosted API, your own model) is a new file plus one
line in `registry.js`. Nothing downstream knows which engine ran, because
everything downstream is written against MusicXML.

**Why Audiveris is the primary and not the only one.** It is the only mature
open-source OMR that exports MusicXML *with engraving positions*: `<print>`,
system breaks, `default-x` / `default-y` per note. Those are what let a UI
highlight the bar you are hearing on the scan itself. But it is a JVM
application built from source — a real barrier — so the pipeline must work
without it, degrade honestly, and say so.

**Honest degradation.** If no engine is installed, `chooseEngine` falls back to
the fixture and marks the job `degraded: true`. A canned score returned as if it
were a reading of your scan is the worst failure mode available here, so it is
labelled at the job, at the score, and in the API response.

### 1b. Many pages, and what happens when one of them is bad

A twelve-page scan is not twelve times a one-page scan. Three things had to be
true before this pipeline could claim to handle one, and each was measured:

**A bad page must not cost the good ones.** Audiveris reads a whole PDF in one
pass — much the best outcome, because page and system breaks survive — but a
sheet whose scale it cannot measure is REMOVED, and then the book refuses to
export at all: *"could not export since transcription did not complete
successfully"*. On a photographed concerto part, sheet 2 was dropped and sheets
1 and 3, which were fine, came back with nothing. So the adapter tries the book
whole and, on failure, falls back to **one page at a time**, where a bad page
costs only itself. Measured: whole-book gave 0 of 3 pages, page-by-page gave 2.

**A page that comes back nearly EMPTY is treated as a failure.** This is the
one that matters most, and it is invisible without it. Audiveris read a printed
menuet page as *two bars* and reported success; oemer read the same page as
twenty. On a ten-page book it did the same to four pages, and the job succeeded
with a third of the music. `util/thin-pages.js` calls a page thin when it is
under a quarter of the median page, or under four bars at all — the second rule
being what catches a single-page upload, where there is no median. Thin pages
get a second opinion, and the better answer wins. When a whole-book result is
thin on *every* page, the other engine is asked for the entire book.

**A page one engine cannot read, the other sometimes can.** After the primary
engine finishes, the pages it failed on are re-rendered and handed to whatever
other engine is installed — Audiveris fails on scale detection, oemer on
staffline alignment, and those are not the same pages. Bounded: one alternative,
one attempt per failed page, and only for a PDF. (On the one page available to
test, *both* engines fail. It is a rescue, not a guarantee.)

**Pages run in parallel.** OMR saturates three or four cores per page, so pages
go through a bounded pool — `OEMER_CONCURRENCY`, `AUDIVERIS_CONCURRENCY`,
defaulting to a quarter of the machine and to 2. One at a time left a ten-core
machine idle and a twelve-page scan taking the best part of an hour.

Two smaller things that only bite at length: a PDF longer than `MAX_PAGES` is
reported as truncated rather than silently halved, and `GET
/v1/scores/:id/pages` gives a row per page — read, failed, or rescued — because
a hole in the middle of a piece makes an alignment *wrong*, not just short.

### 1b-ii. A single image is a book of one page

A photo of a page goes through the same path as a PDF, minus the rasterising —
including the second opinion, which matters more here than anywhere: with one
page there is no median to compare against, so the check is the absolute one
(under four bars is nearly empty). Measured, on a JPEG of a printed menuet
page: Audiveris read 2 bars and reported success, oemer read 23, and the 23
were kept.

What an image cannot have is per-page rescue — there is only the one page — so
if both engines fail on it, the job fails rather than returning part of a score.

### 1b-iii. A stack of photographs is not a document

Photographing a six-page part gives you six files with no relationship to each
other, and the pipeline's best behaviour is only available to a PDF: page
numbers, per-page fallback, re-rendering a failed page bigger. So several files
in one upload are **combined into one PDF first**, in the order they were sent.

```bash
npm run convert -- page1.jpg page2.jpg page3.jpg      # -> one 3-page document
```
```js
const form = new FormData();
for (const file of files) form.append('file', file);  // same field name
await fetch('/v1/scores', { method: 'POST', body: form });
```

**The images are embedded, not converted.** A JPEG goes in as a `/DCTDecode`
stream — the same compressed bytes the camera produced. A PNG's `IDAT` is
already a zlib stream with PNG row predictors, and PDF understands exactly that
(`/FlateDecode` with `/Predictor 15`), so it goes in whole as well. Nothing is
decoded, resized or re-compressed on the way in, which matters because the next
thing to read those pixels measures the thickness of staff lines. Several PDFs
in one upload are merged instead, with Ghostscript's own re-compression turned
off for the same reason.

Order is the order you send them — not filename order, because `IMG_0042` and
`page-3` sort differently and guessing would put bar 200 before bar 40. A file
that can be neither embedded nor merged is refused **by name**, and a mixture of
PDFs and images is refused rather than half-handled.

### 1c. The MusicXML you get back

One document from the engine — kept exactly as written. It carries beams, slurs
and layout this model never parsed, and provenance beats round-tripping.

Several documents, because the engine read a page at a time — **the joined score
is written out here** (`musicxml/serialise.js`). Handing back page 1 of a
twelve-page scan and calling it the MusicXML is the wrong answer to "turn my
scan into a file", and stitching documents as text would be guesswork about
someone else's markup. The model knows how the pages join, so it does the
writing. What it carries: every note, its pitch, length, voice and staff, the
bar it is in, and the key, time, clef, page breaks and repeats around it. What
it does not: engraving, because that was never parsed. The response says which
you got — an `X-Score-Generated` header, and `omr.generatedMusicXml`.

The round trip is tested note for note — parse, write, parse again, and every
note lands in the same bar at the same moment with the same pitch — on hand-made
fixtures and on real engine output.

**And an independent reader has to open it.** `npm run osmd:check <file>`
renders the file in OpenSheetMusicDisplay, in a real browser; the same check
runs in the test suite. A round trip through our own parser only proves the
parser and the serialiser agree with each other, and it missed both of these:

- a rest of ZERO length, out of a real Audiveris scan, made OSMD refuse the
  whole document (*"The provided duration is not valid"*). Zero-length notes
  are now dropped, and a bar left empty gets a proper whole-measure rest so it
  still occupies its time.
- parts of UNEQUAL length — one page recognised as two parts, the next rescued
  as one — which OSMD accepts and then renders truncated to the shortest part,
  silently. A ten-page book displayed as its first 120 bars instead of 230.
  Pages now contribute silent bars to the parts they are missing, so measure N
  of every part is the same bar, which is what a partwise score means.

### 2. Everything sits on one clock, measured in quarter notes

MusicXML does not give you musical time. It gives you `divisions` (ticks per
quarter, **which can change mid-score**), a cursor that moves through `<note>`
elements, `<backup>` / `<forward>` jumps so several voices can share a bar, and
`<chord/>` notes that do not advance the cursor at all. Getting that walk right
is the whole parsing job.

`parse.js` converts to quarters *immediately* and gives every note and every bar
a `startQuarter`. After that, alignment is one-dimensional.

### 3. Two clocks, never confused

```
score quarters        position in the PRINTED score. A repeated bar has one.
performance quarters  position in the PERFORMANCE. That bar has two.
```

The recording contains the repeat, so audio aligns against **performance**
quarters. The highlighter needs the **score** position, because the bar is
drawn once. `timeline.js` unfolds repeats and first/second-time endings, and
every event carries both positions plus its pass number. Getting this wrong is
the classic sync bug: a cursor that jumps to the wrong bar the second time
through.

Ties are merged here too. Two tied crotchets are **one attack** in the audio;
an onset-based aligner told to expect two will drift by a beat.

### 4. The alignment is a piecewise-linear map, and it is its own resource

An alignment is a list of `{quarter, time}` anchors and the monotone map they
define. That is deliberately the smallest thing that can work, because **every
possible producer of alignment data emits anchors**:

| producer | anchors |
|---|---|
| a person tapping bar lines | one per tap |
| a click-track take | two (`mode: "constant"`, a bpm and an offset) |
| DTW against a reference rendering | a few hundred |
| onset detection + note matching | one per note |
| a human correcting a drift | one more, POSTed to the existing alignment |

None of them need a new endpoint, and none of them change this module. **That
is the extension point for the audio work that comes next**: write an aligner
that produces anchors, PATCH them in, and every existing query — cursor,
schedule, measure grid — improves.

A score has *many* alignments (one per take, several per take while you refine
one), so an alignment has its own id rather than being a field on the score.

**The audio itself is never stored here.** `alignment.audio` is an opaque
`{uri, durationSeconds}` the client owns. Recordings are large and private, and
they already live in whatever made them.

### 5. Jobs, not requests

OMR takes 30 seconds to several minutes on a real scan. The upload returns
`202` with a job id and the score id; the client polls. The queue is
in-process with a concurrency limit of 1 — OMR is CPU-bound and memory-hungry,
and two at once on a laptop makes both slower.

It is **not durable**: a process that dies mid-conversion loses the job, and at
boot anything left `running` is marked failed rather than pretended about. For
one machine serving one musician that is the right size; swapping in BullMQ or
a hosted queue is `jobs/queue.js` alone, because everything else only calls
`enqueue`.

### 6. Storage is JSON files

Every stored thing is a document written once and read whole — a score, an
alignment, a job. No queries, no joins, no partial updates. A file per document
is less code than a schema, survives restarts, and is readable with `cat` when a
conversion goes wrong. Writes are atomic (temp file + rename). The swap to
SQLite or Postgres is `storage/store.js` alone.

### 7. Dependencies: express, multer, and nothing else

The XML reader, the zip (`.mxl`) reader, the timemap and the timeline are all
written here. MusicXML is a closed vocabulary and the parts of it that matter
are small; a 150-line reader with no transitive dependencies is less attack
surface than a general parser, and it keeps **source order**, which MusicXML
depends on absolutely.

Uploads are untrusted input handed to a PDF interpreter, so rasterising runs
`gs -dSAFER` / `pdftoppm` with argv only (never a shell), under a hard timeout,
with bounded output capture.

---

## The score model

Two views of the same music, both JSON, both served by the API.

**Printed** (`/v1/scores/:id/measures`, `/notes`) — what is on the page:

```jsonc
{
  "index": 4, "number": "5",
  "startQuarter": 16, "durationQuarters": 4, "nominalQuarters": 4,
  "irregular": false,          // the notes do not fill the bar — an OMR warning sign
  "implicit": false,           // a pickup
  "time": { "beats": 4, "beatType": 4 },
  "key":  { "fifths": -1, "mode": "major" },
  "clefs": [{ "staff": 1, "sign": "F", "line": 4 }],
  "layout": { "page": 2, "system": 3, "width": 210 },
  "barlines": { "repeatForward": false, "repeatBackward": true, "repeatTimes": 2, "endings": [] }
}
```

```jsonc
{
  "id": "P1-m4-v1-n2",         // stable: this is the notehead on the page
  "startQuarter": 18, "measureQuarter": 2, "durationQuarters": 1.5,
  "midi": 55, "pitch": { "step": "G", "alter": 0, "octave": 3 },
  "rest": false, "chord": false, "grace": false,
  "tieStart": true, "tieStop": false,
  "layout": { "page": 2, "system": 3, "defaultX": 120, "defaultY": -15 }
}
```

**Played** (`/v1/scores/:id/timeline`) — repeats unfolded, ties merged:

```jsonc
{
  "id": "P1-m4-v1-n2@9",       // unique per playing
  "noteId": "P1-m4-v1-n2",     // still points at the one notehead
  "ordinal": 9, "pass": 2,     // 10th bar played, second time through
  "measureIndex": 4, "measureNumber": "5",
  "startQuarter": 38,          // PERFORMANCE clock
  "scoreStartQuarter": 18,     // PRINTED clock
  "durationQuarters": 1.5, "midi": 55,
  "tiedNoteIds": ["P1-m5-v1-n0"]
}
```

`layout.defaultX` / `defaultY` are kept **raw**, in MusicXML tenths (x from the
left of the bar, y from the bottom staff line). Turning them into page pixels
needs the renderer's scale, and the client doing the drawing is the one that
knows it.

---

## API

### Conversion

| | |
|---|---|
| `POST /v1/scores` | multipart `file` — a PDF, an image (PNG/JPEG/TIFF), or MusicXML (`.musicxml`/`.mxl`), sniffed from the bytes. Repeat the field to send a page each: images are combined into one PDF, PDFs are merged. Optional `title`, `engine`. → `202 {scoreId, jobId, poll}` |
| `GET /v1/jobs/:id` | `status` (queued/running/done/failed), `progress {stage, percent}`, `log`, `result` |
| `GET /v1/jobs` | recent jobs, without logs |
| `GET /v1/engines` | what this machine can read — call it before offering an upload button |
| `GET /healthz` | liveness |

### The score

| | |
|---|---|
| `GET /v1/scores` | list |
| `GET /v1/scores/:id` | summary; `?include=full` for everything |
| `GET /v1/scores/:id/musicxml` | the score as a file. The engine's own output when it read the whole book; written from the joined pages otherwise (`X-Score-Generated`) |
| `GET /v1/scores/:id/measures` | printed bars (`?part=P1`) |
| `GET /v1/scores/:id/notes` | notes (`?fromMeasure=&toMeasure=`) |
| `GET /v1/scores/:id/timeline` | the performance view; `?include=events` for every note |
| `GET /v1/scores/:id/pages` | a row per page of the upload: read, failed, or rescued by the other engine |
| `GET /v1/scores/:id/quality` | rhythm score, irregular bars, per-part note counts |
| `DELETE /v1/scores/:id` | and its alignments |

### Alignment

`POST /v1/scores/:id/alignments` — three modes:

```jsonc
// anchors: piecewise linear through the points you give (the general case)
{ "anchors": [ { "measure": 1, "beat": 1, "time": 2.4 },
               { "measure": 9, "beat": 1, "time": 27.0 },
               { "quarter": 64, "time": 61.5 } ],       // machine aligners use quarters
  "audio": { "uri": "file:///takes/take1.wav", "durationSeconds": 92.3 } }

// constant: a click-track take
{ "mode": "constant", "quarterBpm": 92, "offsetSeconds": 0.4 }

// fit: many noisy taps -> one straight line, least squares
{ "mode": "fit", "anchors": [ … ] }
```

An anchor is `{time}` plus **either** `measure` (+ optional `beat`, `pass`)
**or** a raw `quarter`. `pass` picks which playing of a repeated bar; without it
the first is meant, which is what a person tapping bar 17 means.

| | |
|---|---|
| `GET /v1/scores/:id/alignments` | every alignment of this score — one per take |
| `GET /v1/alignments/:id` | one alignment: its anchors, its fitted tempo, its timemap |
| `PATCH /v1/alignments/:id` | re-fit in place — this is "tap along and watch it get better" |
| `DELETE /v1/alignments/:id` | |
| `GET /v1/alignments/:id/cursor?t=` | bar, beat, page, sounding noteheads, time to the next attack |
| `GET /v1/alignments/:id/schedule?from=&to=` | every note with `startTime` / `endTime` in seconds |
| `GET /v1/alignments/:id/measures` | one row per played bar with its seconds — the tap-along grid |
| `GET /v1/alignments/:id/convert?t=` / `?measure=&beat=` | both directions of the map |

Errors are `{ error: { message, status, details } }`. A client's mistake is a
4xx with a sentence you can show a person (*"anchors go backwards in time:
quarter 0 at 9s, then quarter 4 at 1s"*); a 500 means a bug here.

---

## In the practice app

The app in this repo uses this service directly, so a player who scans a part
never uploads anything twice:

1. import a scan the way they always have — the PDF button, or photographing
   the pages;
2. the app sends those pages here by itself and waits;
3. the MusicXML comes back and is **paired to the scan** through the app's own
   mechanism, so the page they are looking at now has notes behind it and a
   take can be marked for wrong notes, not just timing.

`src/analysis/omr-client.js` is the whole client; `src/ui/score.js` calls it
from `addPaper`, beside the existing background page-measuring, so nothing
blocks and the score is open and playable while the reading happens.

**It starts by itself only when the service is on this machine.** The default is
`127.0.0.1:4000`, which keeps the app's promise that nothing leaves the device
literally true. Point `localStorage['omr-service-url']` somewhere else and the
automatic path switches off: a remote service is only ever used by pressing the
"Read the notes" button on the score card.

If no service answers, or one answers with no OMR engine installed, the app is
exactly what it was before — a scan you can play from and mark up — and the
button stays hidden. A pipeline with no engine returns a FIXTURE score, so
"answers" is not enough to earn the button.

`npm run score:omr` (from the repo root, with both `npm run dev` and this
service running) drives the whole thing in a real browser: it imports a PDF
through the app's own file input and then asks the app's database whether the
scan ended up with notation that parses to actual notes.

## Two ways in, one pipeline

| | |
|---|---|
| `npm run convert -- scan.pdf` | blocks until done, writes the file, prints what happened. For a person at a terminal. |
| `POST /v1/scores` | returns a job id in milliseconds and converts in the background. For a browser, which cannot hold a request open for ten minutes. |

They share everything below the entry point — same engines, same page fallback,
same parser, same serialiser — so anything one can convert, the other can too.
The CLI writes into its own temporary directory and deletes it; the server keeps
its scratch under `data/work` so a failed job can be looked at.

## Quality signals

OMR gets things wrong, and an alignment built on a bar that lost a beat drifts
from that bar onward. `/v1/scores/:id/quality` reports what can be checked
without the original:

- `irregularMeasures` — bars whose notes do not fill their time signature. This
  is the failure that breaks alignment.
- `rhythmScore` — 1.0 means every bar adds up. Bars are counted ONCE across
  parts, so the count of bad bars can never exceed the score's own bar count.
- `emptyMeasures`, `unpitchedNotes`.

Nothing here can tell you a note was read at the **wrong pitch** — no check can,
without the original. Treat a low `rhythmScore` as "correct this in MuseScore
and re-upload", which the passthrough engine exists to make easy.

---

## The fixture engine

`OMR_ENGINE=fixture` returns a canned score and ignores the upload. It is the
most-used engine in this repo:

1. **Tests** — every layer above OMR is exercised in a second, with no models.
2. **Development** — a front end needs *a* score to draw, not a correct one.
3. **Diagnosis** — re-run a bad conversion with `engine=fixture`; if the result
   is still wrong, the bug is not in the recognition.

---

## Configuration

| variable | default | |
|---|---|---|
| `PORT` / `HOST` | 4000 / 127.0.0.1 | |
| `SCORE_DATA_DIR` | `server/data` | uploads, scores, alignments, jobs |
| `OMR_ENGINE` | `auto` | `audiveris` \| `oemer` \| `fixture` \| `musicxml` |
| `OMR_DPI` | 300 | the default an engine gets unless it prefers otherwise |
| `OEMER_DPI` | 200 | oemer's post-processing cost grows with the square of the page |
| `OMR_CONCURRENCY` | 1 | how many JOBS at once; OMR is CPU-bound |
| `OEMER_CONCURRENCY` | cores/4 | how many PAGES at once within a job |
| `AUDIVERIS_CONCURRENCY` | 2 | the same, for Audiveris (a sheet costs it about a gigabyte) |
| `OMR_TIMEOUT_MS` | 1200000 | 20 minutes, for the real conversion |
| `RESCUE_TIMEOUT_MS` | 480000 | 8 minutes: a second opinion that outlasts the job is not worth waiting for |
| `OMR_KEEP_WORK` | off | keep engine scratch files for debugging |
| `MAX_UPLOAD_BYTES` | 60MB | |
| `MAX_PAGES` | 30 | a longer PDF is truncated *and says so* |
| `AUDIVERIS_BIN` / `OEMER_BIN` | auto-detected | |
| `TESSDATA_PREFIX` | **unset on purpose** | see below |

---

### Audiveris opens no window

Audiveris is a desktop application being used here as a library, and its
launcher starts a JVM with the AWT toolkit — so macOS treats every conversion as
an app being launched and puts a Java icon in the Dock while you are working.
The adapter therefore passes `-Djava.awt.headless=true -Dapple.awt.UIElement=true`
(appended to any `AUDIVERIS_OPTS` you set). The image classes recognition
actually needs work headless; verified by converting a page with it on.
`GET /v1/engines` reports `headless: true` so this can be checked without
starting a JVM.

### Audiveris and Tesseract, which is fiddlier than it looks

Audiveris initialises Tesseract in LEGACY mode. Homebrew's `eng.traineddata` is
the LSTM-only build, so pointing `TESSDATA_PREFIX` at it makes Audiveris find
the language, fail to load it, and log *"Tesseract couldn't load any
languages!"* — while still reading the notes, because OCR only affects the words
on the page. The adapter therefore does **not** set `TESSDATA_PREFIX`, and the
install script drops the full 23MB file from the tessdata repository into the
folder Audiveris keeps for itself. If you set `TESSDATA_PREFIX` yourself, it is
passed through and you own the consequences.

## Measured, on real paper

**Ten pages, Audiveris + oemer, on an M-series Mac.** A book built by
concatenating a printed menuet, a photographed concerto part and a scanned page,
twice over — deliberately mixed, and containing one page nothing can read.

```
whole-book pass    failed (one sheet dropped -> the book refuses to export)
page-by-page       10 pages, 2 at a time
second opinion     6 pages went badly (2 refused, 4 came back nearly empty)
                   -> oemer read 4 of them: 20, 35, 20, 35 bars where
                      Audiveris had 2, 1, 2, 1. Those four were swapped in.
result             8 of 10 pages; pages 3 and 7 failed in BOTH engines
                   230 bars, 1844 notes, one 428KB MusicXML file
                   rhythm score 0.261 — 170 of the 230 bars do not add up
verified           OpenSheetMusicDisplay opens it: 230 measures, 876.38
                   quarter notes — the same length this pipeline computed.
                   Two taps at either end put the cursor on page 4 at 150s,
                   page 9 at 450s and page 10 at 590s.
took               22m 38s
```

The middle line is the one worth reading twice. Without the second opinion the
same book came back as 126 bars and 672 notes, and nothing about it looked
wrong: the four thin pages were *successes* as far as Audiveris was concerned.
That check is worth more than every other robustness measure here combined.

**One page.** Bach, Menuet BWV Anh. 114, scanned to PDF — and the clearest case
for the thin-page check, because there is only one page to be thin:

```
audiveris          read the whole book in 15s as TWO bars, and called it done
thin-page check    two bars over one page is nearly empty -> ask oemer
oemer              20 bars, 319 notes, key of one sharp, bass clef (4m)
kept               oemer's, because it read ten times as much
rhythm score       0.65 — seven bars whose notes do not add up
verified           OSMD opens it: 20 measures, 82.88 quarter notes
aligned            three taps -> 96.6 and 97.6 quarter-bpm, fit 97.2, rms 57ms
cursor at 25.0s    bar 10, beat 1.88, system 5, the notes sounding
```

### PDF or a photo?

Two pages, each fed in three ways. The PNG is a 300 dpi render of the same PDF
page and the JPEGs are compressions of that PNG, so the *content* is identical —
only the container changes.

```
Menuet page (printed, clean)        bars  notes  rhythm
  PDF                                 20    319   0.65
  PNG  (300 dpi)                      21    318   0.43
  JPEG (quality 80)                   23    318   0.43

Concerto page 1 (photographed)      bars  notes  rhythm
  PDF                                 31    152   0.29
  PNG  (300 dpi)                      33    142   0.39
  JPEG (quality 95)                   34    201   0.21
  JPEG (quality 80)                   36    193   0.03
  JPEG (quality 50)                   36    172   0.22
```

**On recognition quality the format barely decides anything.** PDF won clearly
on the clean page and *lost* to PNG on the photographed one, and the three JPEG
qualities of one identical page scored 0.03, 0.21 and 0.22 — the run-to-run
noise on a hard page is larger than the format effect. What dominates is the
page: clean print 0.65, photograph 0.03–0.39, whatever it is wrapped in.

**On everything else a PDF is decisively better, and for reasons that are
structural rather than statistical:**

- it can be MANY PAGES; an image is one page, and that is the whole difference
  between a piece and a page of one
- its resolution is ours to choose — each engine gets the dpi it wants, and a
  page that failed can be re-rendered BIGGER and tried again. A photo is
  whatever resolution it arrived at, for ever
- a failed page inside a PDF falls back to page-by-page; a failed image is a
  failed job

So: a PDF if you have one. If you only have a photo, PNG over JPEG — but do not
expect either to rescue a bad photograph. Both engines fail outright on page 2
of that concerto part in every format tried.

### How to read these numbers

A `rhythmScore` of 0.261 means three quarters of the bars do not add up. That is
a real measurement of a hard, photographed book — and it is exactly why the
quality report exists rather than a "success" flag. Nothing here can tell you
whether the notes that *were* read are the right PITCHES; that needs the
original. Treat a low score as "correct it in MuseScore and upload that", which
is what the passthrough engine is for.

None of this is an accuracy claim about the engines. It is evidence that the
pipeline runs end to end on real paper, that one bad page no longer costs the
book, and that a page read badly is now noticed.

## What this does not do yet

Stated plainly, because each is a place the next piece of work goes:

- **OMR splits one instrument's line across parts.** Audiveris returned a
  photographed page as two parts holding 76 notes each, and another page as one
  part with 8 notes and one with 121. Nothing here re-joins them: the quality
  report counts every part, and the timeline follows the part with the most
  notes rather than blindly the first, but a score that should be one part may
  arrive as two. `?part=` selects.
- **No audio analysis.** There is no onset detector, no DTW, no listener. The
  alignment layer is built to receive anchors from one; producing them is the
  next project. Nothing in the API needs to change when it lands.
- **Da capo / dal segno / coda are not followed.** They are recorded on the
  measure as `jumps` and left alone: scanned parts carry them unreliably, and
  guessing wrong mis-times the whole recording rather than one bar.
- **One part at a time on the timeline.** Multi-part scores parse fully; the
  performance timeline is built for one part — the one with the most notes,
  unless `?part=` says otherwise. Anything driven by a solo recording only
  needs one.
- **A page nothing can read stays unread.** Both engines fail on the same
  photographed page (Audiveris cannot measure its scale, oemer cannot align its
  stafflines), at every resolution and in greyscale. It is reported as a failed
  page rather than papered over, and the score simply does not contain it.
- **Long books are slow.** Ten pages took 25 minutes, most of it the four
  rescues. Pages run in parallel, but OMR is minutes-per-page work; the API is
  job-based for this reason.
- **Layout coordinates are pass-through, not page pixels.** Converting tenths to
  a rectangle on the rendered scan needs the renderer's scale.
- **The queue is in-process.** See §5.
