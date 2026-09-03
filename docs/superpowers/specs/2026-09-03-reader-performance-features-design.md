# Reader: half-page turns, performance lock, auto-turn, transposition

Asked for on 2026-09-03: "do all of the [forScore features] that you think
would be beneficial and make sure to test them so they work perfectly", with
the reminder that the app is for any instrument and voice, not only cello.

Chosen, in order of how much they change playing from the app:

1. **Half-page turns.** Hands-free players (wind, brass, singers with a
   folder, anyone mid-phrase) lose their place on a whole-page turn. The first
   turn shows the top half of the next page over the top half of the current
   one, with a line across the join; the second completes the turn. Back
   cancels. Off by default; a menu row turns it on and it is remembered.
2. **Performance lock.** A row on the menu locks the page: turns still work
   (tap zones, swipe, pedal), everything else is ignored — no bar, no pinch,
   no pencil arming. A small lock chip at the top corner unlocks.
3. **Auto-turn.** A row offers a per-score interval (off, 20s … 2 min). A
   countdown chip shows the seconds left; any manual turn restarts the clock;
   it stops on the last page.
4. **Transpose** (engraved scores only). A row offers −12…+12 semitones, per
   score, remembered. The engraving, the key signature and the notes the take
   is aligned against all move together, so a singer sings what they see.

Not done, and why: library search and a library backup already exist;
cloud sync is against the app's local-only promise; Pencil double-tap and
Apple Watch are not reachable from a web app; audio tracks per score and page
management are worth doing but larger than one round.

## Half-page turns — how

`half = null | { from, to }`. While set, `visiblePages()` is `[from, to]`.
`showPage` lays both out at the same rectangle: `from` under, clipped to its
bottom half; `to` over, clipped to its top half. A fixed hairline sits at the
join. Ink: the dry layer is painted twice, each pass clipped to its half and
drawing only that page's marks; links and analysis rings are not drawn in the
half state. Annotating, pinching or arming a pencil first completes the turn.
`nextPage` from a whole page enters the half state; from the half state it
completes it. `previousPage` in the half state cancels it. Only at zoom 1 and
never with two pages side by side.

Test (`tools/half-turn-check.mjs`): engraved and paper scores. The top half
of the screen in the half state must be pixel-identical to the top half after
the completed turn, and the bottom half identical to the bottom half before
it. Then taps, pedal keys, back, and ink drawn on both pages checked to land
on the right page.

## Performance lock — how

`locked` flag; `#reader.locked`. `onTap`, the top-strip reach, `setChrome(true)`
from taps, pinch promotion and `armPencil` all refuse while locked. Turns are
untouched. `#reader-lock` chip, always visible while locked, unlocks on tap.
Escape unlocks. Not remembered across opens.

Test (`tools/reader-lock-check.mjs`): lock; tap middle → no bar; tap zones →
turn; pinch → zoom stays 1; pencil down → no tool; chip → unlocked, bar back.

## Auto-turn — how

`autoTurn` seconds, per score in localStorage `readerAutoTurn:<id>`; a
`setTimeout` armed on every `showPage`, cleared on close, on the last page,
and when the interval is off. A chip `#reader-countdown` shows the seconds
left, updated once a second. Test: interval 1s (set through the same store),
page advances to the end and the chip goes.

## Transpose — how

`transposeOf(score)` from localStorage `readerTranspose:<id>`. `showScore`
takes `transpose`; before render it sets `osmd.TransposeCalculator` and
`osmd.Sheet.Transpose`. `engravedNotes` reads `TransposedPitch ?? Pitch`, so
the take alignment follows the written page. Changing it re-engraves and keeps
the bar you were on (as `resize` does). Test: notes read back +2 semitones,
key signature moves, annotations survive.
