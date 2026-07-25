# Music Companion

A practice companion for string players, built from scratch — every line of DSP is hand-written, zero runtime dependencies, ~14 KB gzipped.

**Tuner · Record & analyze · Library · Metronome**

## What it does

- **Analog tuner** — a gauge with a pivoting needle, vibrato-aware: it reads the pitch *center* your vibrato orbits (and reports the vibrato's width and rate) instead of calling the swing "out of tune". Detects **double stops** and shows both strings.
- **Record & analyze** — record anything; every note is detected and scored against equal temperament (configurable A4). The session renders as a scrollable pitch trace colored by intonation (green / amber / red). Click any note to hear it with its neighbors ducked, open a cents-level zoom with play/pause and drag-to-scrub, slow playback to ¼× **without changing pitch** (WSOLA time-stretch), hold the note's exact played pitch as a drone against an in-tune reference (unison or pure fifths, ±4 octaves), or compare it with another rendition of the same pitch from the take.
- **Library** — save takes (audio + analysis) to IndexedDB and reopen them with the full review.
- **Metronome** — lookahead-scheduled on the audio clock, 20–260 BPM with tempo names, tap tempo, subdivisions (eighths, triplets, sixteenths, shuffle), per-bar accent, practice timer.

## How the analysis works

```
mic → AudioWorklet → YIN pitch detection → dual-pitch probing → note segmentation → scoring
```

- **YIN** (de Cheveigné & Kawahara, 2002) implemented from the paper: cumulative mean normalized difference, first-dip thresholding, parabolic interpolation. Full piano range (A0–C8).
- **Double stops** by harmonic cancellation: YIN finds the harmonic base (for an interval, that's the phantom common fundamental), comb filters probe its multiples for a real constituent, and cancelling that recovers its partner. Octaves are physically inseparable and honestly report as one pitch.
- **Fast passages**: 11.6 ms analysis hop with a hybrid window — long for chord detection, a short sub-window for mono tracking, so fast runs don't smear across note boundaries.
- **Note segmentation** with vibrato medianing, octave-glitch rejection, and a 40 ms floor for fast semiquavers.
- **WSOLA time-stretching** for pitch-preserving slowdown — verified in tests by running YIN over the stretched output.

## Run it

```
npm install
npm run dev      # local
npm test         # 96 tests — the DSP is fully unit-tested with synthesized signals
npm run build    # static bundle in dist/
```

Chrome/Edge/Safari, HTTPS or localhost (the mic requires it).
