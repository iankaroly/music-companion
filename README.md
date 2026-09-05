# Stand Partner

A practice companion for anyone who plays a pitch — strings, winds, brass or voice. Every line of DSP is hand-written: the pitch detection, the segmentation, the time-stretching and the page reading are all in this repo, with no library doing any of it.

**Nothing leaves your device — there is no exception.** No account, no server, no analytics: the app makes no network requests at all once it has loaded. Recordings, scanned pages and everything derived from them live in IndexedDB on the device that made them. Photographed music used to be sent to an optical-music-recognition service; that route was removed rather than switched off, and the pages are now read on the device itself.

**Tuner · Record & analyze · Score · Library · Coach · Metronome**

## What it does

- **Analog tuner** — a gauge with a pivoting needle, vibrato-aware: it reads the pitch *center* your vibrato orbits (and reports the vibrato's width and rate) instead of calling the swing "out of tune". Detects **double stops** and shows both strings.
- **Record & analyze** — record anything; every note is detected and scored against equal temperament (configurable A4). The session renders as a scrollable pitch trace colored by intonation (green / amber / red). Click any note to hear it with its neighbors ducked, open a cents-level zoom with play/pause and drag-to-scrub, slow playback to ¼× **without changing pitch** (WSOLA time-stretch), hold the note's exact played pitch as a drone against an in-tune reference (unison or pure fifths, ±4 octaves), or compare it with another rendition of the same pitch from the take.
- **Timing** — the pulse is inferred from your own onsets, so **no metronome is needed** and every take already in the library can be read for timing. Reports the tempo you implied, a tempo curve, how far the average note sat off the beat, and which notes were early or late — tap one to hear it. Each note is measured against the *local* pulse, so ordinary drift isn't charged to every later note as a mistake; take-wide rushing or dragging is reported separately.
- **Passages** — mark a span inside a take, name it, and mark the same bars again next session under the same name. The coach then tracks that passage's intonation *and* timing across attempts.
- **Score** — photograph the music you are playing from, or import a PDF, and read it here: the edges are found and straightened, pages turn from the margins, and a pencil and lasso mark them up. Record while the part is open and the take is filed under that piece. The pages are read on the device — staves, clefs, keys and noteheads — with no service involved.
- **Library** — save takes (audio + analysis) to IndexedDB and reopen them with the full review.
- **Coach** — habits mined from every saved take: weekly streak, per-piece and per-passage progress, the notes most worth drilling, a tendency map, and a 14-day trend.
- **Metronome** — lookahead-scheduled on the audio clock, 20–260 BPM with tempo names, tap tempo, subdivisions (eighths, triplets, sixteenths, shuffle), per-bar accent, practice timer.
- **Light and dark** — a settings sheet in the top right; the theme follows the system by default, and the canvases repaint from the same palette the CSS uses.

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
npm run build    # static bundle in dist/
```

Chrome/Edge/Safari, HTTPS or localhost (the mic requires it).

## On an iPhone or iPad

The web app is wrapped for iOS with Capacitor. The wrapper is a shell: all the
code is still the same web build, so `dist/` is what actually ships.

```
npm run ios      # build, sync into the Xcode project, and open it
```

Xcode is required, from the Mac App Store. CocoaPods is not needed; Capacitor 8
uses Swift Package Manager.

Then in Xcode: pick your device in the toolbar, set a team under
*Signing & Capabilities*, and press run. A free Apple ID works — the app is
signed for 7 days at a time. The $99/year Developer Program extends that to a
year and opens TestFlight and the App Store.

## On the App Store

```
npm run store:upload   # build, archive, and upload a build to App Store Connect
```

`docs/store/listing.md` has every field the listing asks for, ready to paste,
and the screenshots beside it (`npm run store:shots` regenerates them). Xcode
must be signed in with the Apple ID that holds the membership, and the app
record must exist in App Store Connect first; the listing file says how.

Icons: `tools/icon.html` is the source, `tools/build-icons.sh` renders the web
icons, the maskable variant, the share image, **and** the 1024 iOS app icon in
one pass.
