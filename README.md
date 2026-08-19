# Practice Partner

A practice companion for anyone who plays a pitch — strings, winds, brass or voice. Built from scratch: every line of DSP is hand-written, zero runtime dependencies, ~28 KB gzipped. Your recordings never leave your device — the one feature that sends anything at all is **Ask about a take**, it is off until you turn it on, and what it sends is numbers, never audio.

**Tuner · Record & analyze · Library · Coach · Metronome**

## What it does

- **Analog tuner** — a gauge with a pivoting needle, vibrato-aware: it reads the pitch *center* your vibrato orbits (and reports the vibrato's width and rate) instead of calling the swing "out of tune". Detects **double stops** and shows both strings.
- **Record & analyze** — record anything; every note is detected and scored against equal temperament (configurable A4). The session renders as a scrollable pitch trace colored by intonation (green / amber / red). Click any note to hear it with its neighbors ducked, open a cents-level zoom with play/pause and drag-to-scrub, slow playback to ¼× **without changing pitch** (WSOLA time-stretch), hold the note's exact played pitch as a drone against an in-tune reference (unison or pure fifths, ±4 octaves), or compare it with another rendition of the same pitch from the take.
- **Timing** — the pulse is inferred from your own onsets, so **no metronome is needed** and every take already in the library can be read for timing. Reports the tempo you implied, a tempo curve, how far the average note sat off the beat, and which notes were early or late — tap one to hear it. Each note is measured against the *local* pulse, so ordinary drift isn't charged to every later note as a mistake; take-wide rushing or dragging is reported separately.
- **Passages** — mark a span inside a take, name it, and mark the same bars again next session under the same name. The coach then tracks that passage's intonation *and* timing across attempts.
- **Library** — save takes (audio + analysis) to IndexedDB and reopen them with the full review.
- **Coach** — habits mined from every saved take: weekly streak, per-piece and per-passage progress, the notes most worth drilling, a tendency map, and a 14-day trend.
- **Metronome** — lookahead-scheduled on the audio clock, 20–260 BPM with tempo names, tap tempo, subdivisions (eighths, triplets, sixteenths, shuffle), per-bar accent, practice timer.
- **Light and dark** — a settings sheet in the top right; the theme follows the system by default, and the canvases repaint from the same palette the CSS uses.

## Ask about a take

**Off by default.** Settings → *Ask about a take* → On puts a small button on the
right edge of the app, above the tab bar. Press it and a chat pops out over
whatever you are looking at: "which notes went flat?", "did I rush the second
half?", "is this better than last week's?". Escape or a press anywhere else
closes it.

It reads the take on the screen if a review is open, and the one-line index of
your saved takes either way — so it can still answer "how has my intonation
moved this month" with nothing open. When no take is open it says so rather than
answering as though one were.

It is not listening to the recording, and it says so when you ask it to be. The
Messages API takes text, images and PDFs — there is no audio content block — so
no product can hand a language model a WAV and have it hear you. What this sends
is the **digest**: every note the app already detected, with its onset time, its
name, its cents from equal temperament, its milliseconds from the pulse, its
duration, and how long it took to settle. Those numbers are far more precise
about pitch and timing than a general audio model would be, and completely
silent about tone — so the model is instructed to say "the app measures pitch and
timing, not tone" rather than guess at your sound.

```
your take ──► digest (text) ──► /api/ask ──► Claude ──► the answer, streamed back
     audio stays here ────────────x
```

- Nothing is sent while the setting is off, nothing is sent when a review opens,
  and nothing is sent when the chat opens — only when you press Ask. `npm run ask:check` proves all three in a
  headless browser, with the request intercepted so it needs no key and sends
  nothing anywhere; one of its checks reads the outgoing body and fails if any
  audio, reading or sample rate is in it.
- The key lives on the server, never in the bundle: `api/ask.js` in production,
  the same handler mounted on the dev server by `vite.config.js`. Set
  `ANTHROPIC_API_KEY` in the environment (and in the Vercel project). Without
  one the panel says so instead of failing silently.
- `@anthropic-ai/sdk` is a **server-only** dependency. The client bundle still
  has no runtime dependencies — `src/ui/ask.js` talks to the endpoint over
  `fetch`.
- `vite preview` serves the static build with no functions, so the panel only
  answers under `npm run dev` or a deploy.
- **Not yet run against the live API** — it was built on a machine with no key,
  so everything up to the request is measured and the request itself is not. The
  first thing to check when a key exists is the request shape in
  `src/ai/ask-handler.js`: a two-block `system` with `cache_control` on the
  second, `output_config.effort`, and no `thinking` field. A 400 there arrives in
  the panel as "the answer stopped: …" and nowhere else.

## How the analysis works

```
mic → AudioWorklet → YIN pitch detection → dual-pitch probing → note segmentation → scoring
```

- **YIN** (de Cheveigné & Kawahara, 2002) implemented from the paper: cumulative mean normalized difference, first-dip thresholding, parabolic interpolation. Full piano range (A0–C8).
- **Double stops** by harmonic cancellation: YIN finds the harmonic base (for an interval, that's the phantom common fundamental), comb filters probe its multiples for a real constituent, and cancelling that recovers its partner. Octaves are physically inseparable and honestly report as one pitch.
- **Fast passages**: 11.6 ms analysis hop with a hybrid window — long for chord detection, a short sub-window for mono tracking, so fast runs don't smear across note boundaries.
- **Note segmentation** with vibrato medianing, octave-glitch rejection, and a 40 ms floor for fast semiquavers.
- **WSOLA time-stretching** for pitch-preserving slowdown — verified in tests by running YIN over the stretched output.

### How the timing analysis works

```
onsets → autocorrelation → grid period → least-squares fit → local deviations
```

- **Grid, then beat.** The *grid* is the finest pulse the onsets land on; the *tactus* is the beat you'd count, and that's what gets reported as BPM. Scoring against the grid is what stops a run of eighths reading as "every other note is 250 ms late".
- **Coarsest grid that explains the notes.** Any finer grid trivially fits, so the search runs coarse-to-fine and stops at the first period where every gap between notes comes out a whole number of steps. Judging gaps rather than fitted residuals is deliberate: gaps are phase-independent, so a grid that's half a step wrong can't hide by shifting until its error straddles the beat — which is how a long–short dotted figure otherwise gets misread at bar length.
- **A tactus prior** near walking pace (~100 bpm) picks the beat among multiples of the grid. It leads, and correlation strength only nudges: every multiple correlates to some degree, and which one correlates *best* is often decided by phrase structure rather than by the pulse.
- **Local, not global.** Deviations are measured against a pulse fitted to each note's neighbourhood, because timing errors carry forward in real playing. Tempo drift is reported on its own, from a median-filtered tempo curve that one fumbled note can't move.

## Run it

```
npm install
npm run dev      # local
npm test         # the DSP and analysis are unit-tested with synthesized signals
npm run ask:check # the Ask panel, end to end, with the request intercepted
npm run build    # static bundle in dist/
```

Chrome/Edge/Safari, HTTPS or localhost (the mic requires it).

## On an iPhone or iPad

The web app is wrapped for iOS with Capacitor. The wrapper is a shell: all the
code is still the same web build, so `dist/` is what actually ships.

```
npm run ios      # build, sync into the Xcode project, and open it
```

**Xcode is required and is not installed here yet** — get it from the Mac App
Store. CocoaPods is not needed; Capacitor 8 uses Swift Package Manager.

Then in Xcode: pick your device in the toolbar, set a team under
*Signing & Capabilities*, and press run. A free Apple ID works — the app is
signed for 7 days at a time. The $99/year Developer Program extends that to a
year and opens TestFlight.

Nothing here is public. An App Store listing happens only when a build is
submitted, and builds can sit on your own device or in TestFlight indefinitely
before that.

Icons: `tools/icon.html` is the source, `tools/build-icons.sh` renders the web
icons, the maskable variant, the share image, **and** the 1024 iOS app icon in
one pass.
