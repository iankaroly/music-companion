# Music Companion

A practice companion for cellists (and eventually any monophonic instrument). It listens while you play, tracks every note's pitch and timing, and shows you objective feedback: which notes ran sharp or flat and by how many cents, where the tempo rushed or dragged, and how today's session compares to the last two weeks on the same material.

Built as a web app so the demo is a URL: open it, allow the mic, play.

## How it works

```
mic → AudioWorklet → YIN pitch detection → note segmentation → scoring → session log
```

1. **Audio capture** — `getUserMedia` + an AudioWorklet for low-latency raw frames. Cello range is ~C2 (65 Hz) upward; laptop/phone mics are fine for fundamental-frequency tracking.
2. **Pitch detection** — the YIN algorithm (de Cheveigné & Kawahara, 2002), implemented from the paper. Window size 2048–4096 samples; ~50–90 ms latency is acceptable for visual feedback.
3. **Note segmentation** — onset detection (energy + spectral change) plus pitch-jump boundaries turn the continuous f0 stream into discrete notes. Vibrato (±20–50 cents) is averaged across the note's duration to get perceived pitch rather than flagged as bad intonation.
4. **Scoring** — per note: cents deviation from target, plus onset-time analysis for tempo drift and rhythmic evenness.
5. **Practice log** — sessions persist locally (IndexedDB): piece, duration, per-note stats, trend charts over weeks.

## Roadmap

### v1 — scale & étude mode
The note sequence is known up front, so alignment is trivial (expected note 1, 2, 3…).

- [ ] YIN pitch engine in an AudioWorklet with a live tuner display
- [ ] Scale mode: pick a scale, play it, get a per-note intonation heatmap
- [ ] Tempo/evenness analysis from note onsets
- [ ] Local session history with trend chart

### v2 — real repertoire
- [ ] MusicXML upload + score alignment (dynamic time warping)
- [ ] Vibrato width/rate as reported stats
- [ ] Just-intonation / drone practice mode
- [ ] Double-stop handling (detect and skip, or polyphonic tracking)

## Known constraints

- Monophonic only in v1 — double stops confuse YIN; the app should detect and skip them gracefully.
- Real-time *visual* feedback only; no attempt at note-by-note audio cues (latency makes that useless).
- Room noise tolerance matters more than mic quality.
