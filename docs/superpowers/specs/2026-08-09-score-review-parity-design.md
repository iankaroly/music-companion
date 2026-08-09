# The score as a full review surface

Status: approved 2026-08-09. Local only; nothing pushed.
Follows [the score annotation spec](2026-08-09-score-annotation-design.md).

## What it is

A Score tab that is not a picture of the analysis but the analysis itself, read
off the page instead of off a graph: noteheads coloured sharp or flat, a note
you can tap to hear from the recording, the drones and the comparison it
already has, and a highlight that walks the music while the take plays.

## One review, two views

The Score tab and the Record tab are two windows onto the SAME review, not two
reviews. Selection, playback position, speed and drones are shared; switching
tabs mid-playback changes what you are looking at and nothing else.

That is a decision about `report.js`, which is 927 lines built around single
element ids (`#clip-play`, `#note-drone`, `#ref-drone`, `#compare`, the speed
pills) and one module-level review. Two independent review instances would mean
making all of it instance-based — a large, risky change to the file that owns
every bit of playback in the app.

So instead: **the panel moves.** There is exactly ONE playback control panel in
the document, and whichever tab is showing adopts it (`appendChild` relocates a
node — it can only be in one place regardless). Every existing query in
`report.js` keeps working untouched, no ids are duplicated, and the two views
cannot drift out of step because there is only one of everything.

## How the score follows the playback

`playClip` already walks a list of spans each frame and lights whichever is
sounding. It does not need to know what a span is drawn as. Rather than widen a
span to carry two tiles, `report.js` gains a small subscription:

```js
export function followPlayback(fn)   // fn(soundingNote, recordingTime); returns an unsubscribe
```

called from the same tick that moves the playheads, and once with `(null, null)`
when playback stops. The score view subscribes and does three things: marks the
sounding notehead, moves its own playhead, and scrolls the page so the sounding
bar stays visible. Nothing else in the app needs to know the score exists.

This is also what keeps the Record tab's chart working exactly as it does now —
the subscription is additive.

## Colour: direction as well as size

Today a notehead is green, amber or red by how far off it is. That answers "how
bad" and not "which way", and which way is the thing you act on.

- **in tune** — green, unchanged, and it means the same thing it means
  everywhere else in the app
- **sharp** — warm: amber then red, which is exactly what `--off` and `--bad`
  already are
- **flat** — cool: sky then indigo, two new tokens

Sharp reads hot and high, flat reads cold and low. The tier thresholds stay in
`chart-utils.js` where the chart, the tiles and the coach already share them —
only the hue family is new, so nothing else in the app shifts meaning.

`intonationTone(cents) -> { tier, direction }` is pure and testable; the score
is the only view that uses direction, so the graph and the tiles are untouched.

## Interactions

- **Tap a notehead** — selects that note: plays it from the recording, opens the
  zoom inset, and arms the drone / reference / compare buttons, which is what
  tapping a tile does today. It goes through `selectPlayedNote`, so there is one
  selection path rather than a second, poorer one.
- **Play** — the take plays and the highlight travels the score.
- **Restart** — a button beside play that starts the take from the beginning
  from wherever you are in it, without having to drag a cursor back.

## The tab appears with the score

Five tabs is already tight on a phone (the dock is at `min-width: 3.2rem`). A
sixth that is empty most of the time would cost width for nothing, so the Score
tab is hidden until a score is loaded and hides again when it is removed.

## Testing

`intonationTone` is pure and unit-tested with the rest of the analysis.

The rest is DOM and OSMD, verified in the browser as the first round was: that
the panel survives being moved between tabs, that the sounding notehead is the
one the playhead is over, that restart plays from zero, and that a tap on a
notehead opens the same zoom inset a tile does.
