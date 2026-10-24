# Musicality: what the assistant can say about how a take is shaped

`src/analysis/musicality.js` describes a take at the level of the phrase, for
any instrument and for a voice. `src/ai/musicality-facts.js` turns the result
into the same kind of plain sentences as `src/ai/facts.js`, numbers inside, so
the on-device model only ever phrases them and `guard.js` can trace every
figure it repeats. Nothing here is a score, and nothing is learned.

## What is measured

Each one is a descriptor: a number, a plain phrase, `n` (what it was measured
from), a confidence word, and `measured: false` with a reason when the take
could not support it. None is ever defaulted.

| Descriptor | What it reads | Said as |
|---|---|---|
| phrases found, how clearly marked | breaths, held notes and loudness restarts that agree | "6 phrases of about 10 notes" |
| loudness shape of phrases | per phrase: swell-and-fade, build, die away, level, uneven | "of 6 phrases, 4 swell and fade, 2 stay level" |
| contrast between phrases | spread of phrase loudness, in dB | "differ by about 3.7 dB" |
| contrast between stretches | spread (standard deviation) of the loudness of consecutive runs of eight notes, from 32 notes up; the fallback when no phrases exist, labelled as stretches, never as phrasing. Not loudest-minus-quietest, which grows with the length of the take (see *Fixes after the verifier*) | "the runs of eight notes vary in loudness by about 1.1 dB (the standard deviation of their levels)" |
| legato or detached | sounding length / time to the next note | "62% of the time to the next note" |
| evenness of articulation | quartile range of that ratio | "even" / "varies" |
| tempo flexibility, and whether it returns or drifts | local tempo curve: spread in windows of 24 spacings, and the whole-curve trend (see *Round 3*) | "moves by about 9% and comes back" |
| lengthening at phrase ends | last note's length against the notes before it | "1.5 times as long" |
| matching five-note patterns | any two runs of five notes with the same steps (a sequence or an arpeggio counts, so this is not "repeated passages"): timing and loudness differences | "timing differs by about 2%" |
| vibrato opening up | on notes held 0.8 s or more, early half vs late half | "usually starts plain and opens up" |
| pitch leaning | where notes sit after a step up vs a step down | "4 cents higher after a step up" |
| character | one sentence assembled ONLY from the measured descriptors above. "Very evenly timed and even in loudness" is said only when tempo, phrase shape and phrase-end lengthening were all measured and none of what was read moves | |

`compareMusicality(before, after)` says what changed in neutral words ("more
phrasing contrast", "less even articulation"). Nothing is ever marked better: a
row that moved carries `direction` ('higher' or 'lower', of the number) and no
ranking, including for matching five-note patterns played more alike, because
whether sameness is what the music asks for is the player's and the teacher's
to say. The smallest difference a row may call a difference is the larger of its
fixed number and the noise floor of EACH take at its own tempo (`FLOOR_OF`), so
one performance at two tempos compares as about the same.

## What is NOT measured, and never will be from this code

- **Taste.** Whether a rubato is beautiful, whether the phrasing suits the piece.
- **Tone beauty.** `quality.js` reports brightness, clarity and steadiness as
  descriptions; nothing here ranks them.
- **Anything about a recording that the Analyzer and segmenter cannot hear.**
  Double stops, fast legato and a noisy room produce fragments (see below).
- **Whether a long note was written long.** Without a score the number for
  phrase-end lengthening includes written long notes, so it is for comparing
  two takes of one piece, where the written values cancel. The phrase says so.

There is no labelled data in this repo for "good phrasing", so the module does
not produce a quality score, and nothing in it was fitted to any recording.

## The noise floor, and why thresholds move with note length

The Analyzer's window is about 93 ms and onsets are found to a few
milliseconds at best and tens at worst. That is a fixed error in milliseconds,
so it is a small share of a slow note and a large share of a fast one. Every
threshold that turns a timing number into a word is the larger of a fixed
floor and a number of milliseconds over the take's own typical note spacing
(`NOISE_MS` and `floorsFor` in `musicality.js`).

Measured with `node tools/musicality-synth-check.mjs`, metronomic flat
synthetic takes through the real Analyzer + NoteSegmenter:

| note length | articulation read (played 0.97 / 0.5) | tempo spread | repeat timing differs | articulation spread |
|---|---|---|---|---|
| 0.6 s | 0.99 / 0.52 | 1.2% / 1.1% | 2.9% / 2.0% | 0.03 / 0.02 |
| 0.3 s | 0.98 / 0.54 | 1.9% / 0.5% | 4.5% / 3.2% | 0.07 / 0.04 |
| 0.15 s | 0.92 / 0.61 | refused / 4.0% | 12.2% / 7.2% | 0.16 / 0.11 |

At 0.15 s a metronomic legato line scatters so much in the pipeline that the
module refuses to read a tempo from it (`scatterPct`), because the first
version read it as a 27% free tempo. A detached note is read about 16 ms long
and the "detached" line moves accordingly.

A take that was not heard well is no longer described at low confidence, it is
described far less (`reliabilityOf`, `reliability.reason`):

| reason | when | what is printed |
|---|---|---|
| `quiet` | under half of the loud sound (readings within 20 dB of the take's own 90th-percentile level) falls inside a heard note | nothing: every descriptor withdrawn and the facts say most of the take was too quiet or unclear to hear |
| `fragments` | 25% or more of the heard notes are under 80 ms | only legato-or-detached, recomputed from the notes of 80 ms or longer, low confidence; phrase counts, stretch loudness, phrase-end lengthening and dB figures are withdrawn |
| `junk` | the median step between neighbouring notes is 9 semitones or more AND under a fifth of the five-note windows have their steps again elsewhere in the take (an octave drill or a wide arpeggio repeats; noise does not) | the same as `fragments` |
| `outOfRange` | 25% or more of the notes lie outside a `range: {lowMidi, highMidi}` the caller passes | everything as before but at low confidence, and the facts say the pitch was probably read an octave off |

Under 24 notes the number of phrases is not reported either, and a take of one
pitch has no phrase-level reading at all.

## Validation

**1. Synthetic, known shaping, through the real pipeline**
(`node tools/musicality-synth-check.mjs`, 23 checks, all pass; `--ideal` feeds
the notes straight from the spec and is what `tests/musicality.test.js` holds).
Arched, flat, building and jumping loudness; phrase-end stretch; tempo wave
(built 15%, read 11.5%, "returns"); drift; staccato vs legato (built 0.45/0.98,
read 0.48/0.96); mixed articulation; identical vs varied repeats (3.4% vs 8.3%);
vibrato opening vs steady (100% vs 0%). A metronomic flat take is described as
"very evenly timed and even in loudness" when its tempo could be read (not at
0.15 s legato, where it cannot), and none of six shaped takes is, including the
one with only its phrase ends stretched, which the first version called
"mechanical". (The word is gone; it graded a take as lifeless.)

**2. Real MusicNet solo cello**, Bach suites 3 and 4 (same player), 45 s from
60 s in, through the real Analyzer + NoteSegmenter:

| | Suite 3 sarabande | Suite 4 sarabande | Suite 3 gigue | Suite 4 gigue |
|---|---|---|---|---|
| notes heard / in labels | 108 / 47 | 98 / 50 | 195 / 226 | 225 / 287 |
| heard notes under 80 ms | 29% | 16% | 34% | 39% |
| legato vs detached | 0.96 | 0.98 | 0.78 | 0.73 |
| articulation spread | 0.20 | 0.12 | 0.35 | 0.43 |
| phrases found | 11 | 7 | 16 | 22 |
| phrase-end lengthening | 3.3x | 3.4x | 1.6x | 1.7x |
| loudness between stretches | 11 dB | 12 dB | 15 dB | 12 dB |
| phrase swells (share) | 25% | 17% | 12% | 6% |
| tempo | refused | refused | refused | refused |
| called mechanical (first version; the word no longer exists) | no | no | no | no |

This table is the FIRST version's reading and is kept as the record. What the
module now prints for the same four excerpts is in *Fixes after the verifier*.

- **Agrees, with a confound checked:** the slow movements read more connected
  than the fast ones, in both suites. Because double-stop fragments sit back to
  back and could push the ratio toward one on exactly the excerpts that have the
  most of them, it was rerun with every heard note under 80 ms dropped first
  (a generic filter, not a cello-range one): sarabandes 0.89 and 0.97, gigues
  0.73 and 0.74. The gap survives (0.16 and 0.23 against a floor bias of about
  0.1), smaller on Suite 3.
- **Does not survive the same check:** phrase-end lengthening (3.3x and 3.4x
  against 1.6x and 1.7x becomes 2.0x and 3.0x against 0.9x and 1.2x; the
  direction holds, the values do not) and articulation spread (0.20 and 0.12
  against 0.35 and 0.43 becomes 0.32 and 0.16 against 0.40 and 0.44; it no
  longer separates). Treat both as unvalidated on real playing.
- **Weak or nothing:** loudness between stretches and between phrases do not
  separate slow from fast (11-15 dB for all four, 9-13 dB with fragments
  dropped). Phrase swells trend the expected way but on 4-16 phrases each.
- **Does not work: tempo.** The module refuses on all four real excerpts, and
  the picture shows why: against the score's own tempo from the labels (written
  beats over seconds) the module's estimate scatters, with a correlation of 0.73
  on one sarabande (17 points) and -0.18, 0.03 and 0.01 on the rest. Run on the
  labels' own score-aligned onsets WITHOUT the written lengths, the first
  version read 33% on a gigue against a true 12.8%; with the mixed-note-value
  gate it now refuses all four (three as "note values are mixed", at 42%, 59%
  and 33% of spacings the same length, one as irregular). The score-aware path
  (notes carrying `beats`) reproduces the label tempo to the decimal, but that
  check is circular (the truth is the same arithmetic) and only proves the
  plumbing. Whether the module can say anything true about a real cellist's
  rubato is NOT shown.
- **Repeated figures were not found** on any real audio excerpt: a five-note
  figure must repeat with identical steps, and mis-heard fragments break every
  one. On the label notes the same module finds 25 and 60 repeated pairs on the
  two gigues.
- **Pitch leaning** reads -4 to -9 cents on the three excerpts where it could
  be measured, always the same sign. That consistency is a reason to suspect the
  pipeline (a note's median pitch after a glide) rather than the cellist, and it
  is unvalidated.
- **Phrase boundaries on real takes are unvalidated:** there is no labelled
  phrasing, and the picture (dashed lines over per-note loudness) could only be
  judged for plausibility, not correctness.
- **The sarabandes' notes are the worst heard**: double stops are read as
  fragments and octave errors (30-43% of heard notes below the cello's range,
  16-29% under 80 ms). The short-note rule (25%) marks Suite 3's sarabande and
  both gigues low confidence; Suite 4's sarabande, at 16%, is still reported as
  "good" while 30% of its notes are octave errors. That is a hole in the
  reliability check, not a clean reading.

## Fixes after the verifier (branch ai-fix-musicality)

An independent verifier found seven faults in the version above. Every fix has
a test that fails on 2b5b284 (`tests/musicality-fixes.test.js`: 26 of its 28
tests fail on the old two files; the other two are guards that a real drift and
a wave are still found and that transposing changes nothing on ideal notes) and a
check in `tools/musicality-synth-check.mjs`. Numbers below are from this
round's runs; "ideal" is notes straight from the spec, "real" is the real
Analyzer + NoteSegmenter.

**1. Loudness between stretches depended on the length of the take.** It was
loudest minus quietest run of eight notes. Identical random loudness (±6 dB),
mean of 24 seeds, ideal:

| notes | 20 | 40 | 80 | 160 | 320 | 640 |
|---|---|---|---|---|---|---|
| before (range) | 1.07 | 2.73 | 3.63 | 4.44 | 5.21 | 5.70 |
| after (sd of runs) | not read | 1.07 | 1.13 | 1.16 | 1.20 | 1.20 |

Through the real pipeline (8 seeds): 1.11, 1.07, 1.03, 1.17 at 40, 80, 160, 320.
Below 32 notes the descriptor now says so instead of reading a range of two
runs. The robust spread the verifier suggested (p75-p25) was tried first and is
not flat either: it reads about 0.6 of its long-take value on a handful of
stretches (1.0 dB at 32 notes against 1.64 at 640), so the n-1 standard
deviation is used. The "loudest to quietest" clause of the phrase-contrast
sentence is gone for the same reason. Thresholds that read this number
(`flatStretchDb` 1, `wideStretchDb` 3) were reset from the flat synthetic floor
(0.0 through the real pipeline), not from a recording.

**2. The comparison ignored the tempo-dependent noise floor.** One performance
scaled in time to 0.4 s and 0.7 s a note (breath scaled too), each with 14 ms of
onset error, compared through `compareMusicality`: 23 of 60 pairs reported a
shaping difference (repeated-figure timing 1.6% against 3.6% was "less alike";
phrase-definition moved 20 points), 0 of 60 now. Rows use the larger of their
fixed number and the noise floor of each take (`FLOOR_OF`); phrase-definition,
which moves in steps of a third of a point per phrase end, needs 30. The same
check through the real pipeline: "less alike in timing" before, "about the
same" on every row after. Two takes whose breaths are NOT scaled with the
tempo (0.35 s at 0.4 s and at 0.7 s) are different performances, and the
phrase rows still say so.

**3. "Mechanical" is gone.** It graded a take as lifeless and fired for a take
with every phrase end stretched 1.5 times (the tempo ladder reads a stretched
final note as a longer written value and removes it) and for a 30-note drone.
It is now "very evenly timed and even in loudness", said only when tempo, phrase
shape and phrase-end lengthening were all measured (an unmeasured measure is not
a flat one) and none of what was read moves: steady tempo with no drift, every
phrase level, no phrase-end lengthening (≥ 1.25; a metronomic take reads up to
1.17 through the real pipeline), no loudness contrast, even articulation. Real
pipeline: the take with only its phrase ends stretched was "mechanical" (the
30-note drone was too, on ideal notes; through the real pipeline the segmenter
merged it into 3 notes and it said nothing); neither is now. A
take of one pitch says it is one pitch and gives no phrase-level reading.

**4. "Which is what repeating a figure asks for" was normative, and "repeated
figure" was any five notes with the same steps.** Removed: nothing ranks a row
(`better` no longer exists; `direction` is 'higher' or 'lower' of the number) and
the descriptor, its label and its sentences say "matching five-note patterns".

**5. The tempo ladder locked on half a beat and a drift was claimed from
follower wander.** Takes with a random jitter on every spacing, 100 seeds per
cell, ideal notes. Each cell is three counts of 100 takes, before → after: tempo
shape read / claimed a drift / said "returns" or "steady".

Zero true drift (every claim is false):

| jitter | 6 phrases | 12 phrases | 24 phrases |
|---|---|---|---|
| 4% | 100/0/100 → 100/0/100 | 100/0/100 → 100/0/100 | 100/0/100 → 100/0/100 |
| 8% | 100/1/99 → 99/0/99 | 100/0/100 → 100/0/100 | 100/0/100 → 100/0/100 |
| 12% | 100/11/89 → 89/1/88 | 100/9/91 → 90/0/90 | 98/4/94 → 91/0/91 |
| 20% | 39/25/14 → 12/0/12 | 27/15/12 → 11/0/11 | 22/9/13 → 8/0/8 |

True drift, 20% faster by the end (a claim is a detection; "returns/steady" is
a false statement):

| jitter | 6 phrases | 12 phrases | 24 phrases |
|---|---|---|---|
| 4% | 100/100/0 → 100/100/0 | 100/100/0 → 100/100/0 | 100/100/0 → 100/100/0 |
| 8% | 100/99/1 → 99/98/1 | 100/100/0 → 100/100/0 | 100/100/0 → 99/99/0 |
| 12% | 98/93/5 → 69/64/5 | 98/94/4 → 83/79/4 | 98/97/1 → 86/86/0 |

True drift 15%: 12% jitter reads 97/74/23 → 59/36/23, 99/81/18 → 73/56/17,
98/83/15 → 81/70/11 (8% jitter: 100/89/11 → 94/83/11, 100/95/5 → 98/93/5,
100/100/0 → 97/97/0; 4%: 100/100/0 both). A 15% tempo WAVE with no drift, where
a claim is false: 4% jitter 100/12/88, 99/18/81, 99/15/84 → 87/0/87, 80/0/80,
83/0/83; 8% jitter 87/38/49, 72/17/55, 72/24/48 → 47/0/47, 52/0/52, 47/0/47.
The wave's flexibility (the thing a wave is) is still read in 96-98 of 100 at 4%
jitter (99-100 before) and 67-76 at 8% (72-87 before); what is refused more is
the SHAPE, the word "returns", which now needs a drift reading that agrees
before it is said.

The cost, plainly: at 12% jitter a true 20% drift is claimed in 64, 79, 86 of
100 takes against 93, 94, 97; and "refuse rather than guess" means the shape is
refused in the rest, not turned into "returns". The ONE remaining false drift in
the zero-drift table (12% jitter, 6 phrases, +12%) is left in rather than tuned
away. Real pipeline, 20 seeds per cell (cached heard takes, 240 takes, the same
specs): 15 false drifts before (3, 5 and 0 at 12% jitter; 5, 2 and 0 at 20%), 0
after, with shape read in 48 of 60 at 12% (60 before) and 12 of 60 at 20% (22).

What stops it: a drift is claimed only if (1) the beat the follower kept never
steps by a factor of two (otherwise tempo shape AND flexibility are refused and
say so; this is the seed-14 take that read "ends 49% slower"), (2) a second
reading, every spacing of the commonest length taken against one fixed
reference with no following, finds the same drift at least 8% and at least 3.5
standard errors, and (3) that drift shows in both the even- and odd-numbered
spacings alone. A follower drift of 8% or more that this does not back refuses
the shape and says so (flexibility stays); the first cut called it "returns",
which told 33 of 100 true-20%-drift takes at 12% jitter that the tempo comes
back to where it began. The follower's reset was also tried at the octave
nearest the last beat; that stopped the lock and wrecked tempo waves (12 of 60
read against 56), so it was reverted and the lock is caught afterwards.

*Transposition.* The module reads onset times only, and the ideal path gives the
same tempo reading at every transposition (tested). Through the real pipeline,
48 takes × 5 transpositions (−24 … +24 semitones, 4% and 8% jitter, 6 and 12
phrases): 0 flips between read and refused, 22 takes whose reading changed
between "steady" and "returns". The cause is upstream of this file: the same
performance transposed gets different onsets from the Analyzer and segmenter
(change in a spacing: 14-24 ms rms, up to 57 ms, on a 0.5 s spacing), so a
flexibility near its floor moves across it. The measured/not flip the verifier
saw was not reproduced here, and nothing in `musicality.js` can remove timing
noise that has already been added.

**6. Noisy takes printed counts and dB figures.** See the table under *The noise
floor*. A take 20 dB quieter (60 notes → 12 heard, coverage 9%) was "detached
0.59"; it is now refused as too quiet. 12 dB quieter is still read in full
(coverage 71%; a clean take reads 81%).

**7. Junk and wrong-octave takes.** Random pitches (median step 14 semitones, no
five-note window repeating) are treated like fragments: legato-or-detached only,
low confidence. An octave drill, a wide arpeggio and a leaping figure (median
step 12-14, every window repeating) are NOT, ideal and real (tested); the real
mis-heard excerpts repeat 0-6% of their windows and still are. A take
read two octaves low is flagged and lowered to low confidence when the caller
passes a range (30% of its notes outside 36-88). `assistant.js` passes none, so
THE RANGE CHECK WAS INERT IN THE APP (round 3 gives it a generic range to fall
back on and exports `rangeFor(family)`; `assistant.js` still passes none, see
*Round 3*); `instruments.js` has families, not ranges. Under 24
notes the number of phrases is no longer a finding.

**The other suites.** `npm run ai:eval` is 163/163 development, 46/48 held-out and
21/21 shaping questions on both 2b5b284 and now (run both ways); `npm run ask:card`
is 47/47 now (headless shell on port 5199, no microphone; not re-run on 2b5b284,
whose own commit message reports 47/47). Unit suite: 1474 of 1475 pass; the one
failure is `tests/ai-musicality-wiring.test.js` line 114 (see *Wiring*).

**The four real excerpts and eight held-out ones, through the same code.**
Cached Analyzer + segmenter output, nothing re-tuned. Short = heard notes under
80 ms; coverage = share of the loud sound inside a heard note; step = median
semitones between neighbouring notes.

| excerpt | short | coverage | step | before printed | after prints |
|---|---|---|---|---|---|
| 2220 suite 3 sarabande | 29% | 0.89 | 19 | 11 phrases, 11 dB, 3.3×, 0.96 | legato/detached 0.89 (low) |
| 2222 suite 3 gigue | 34% | 0.71 | 12 | 16 phrases, 15 dB, 1.6×, 0.78 | 0.73 (low) |
| 2296 suite 4 sarabande | 16% | 0.91 | 14 | 7 phrases, 12 dB, 3.4×, 0.98 | 0.97 (low) |
| 2298 suite 4 gigue | 39% | 0.61 | 6 | 22 phrases, 12 dB, 1.7×, 0.73 | 0.74 (low) |

Held out (the other eight movements of the same recording, run once through the
finished code; no threshold was changed after looking at them, but the junk and
fragment TREATMENT was decided after the first four showed a step of 12-19): short 27-39%, coverage 0.67-0.81, step 3-16; six are
`junk`, two `fragments`, none `quiet`; all eight print legato/detached only
(0.72-0.88). What that shows is that no real excerpt trips the coverage line
(the minimum over twelve is 0.61, against 0.5), not that it is correctly placed:
nothing real is quiet. The `junk` step line (9) cannot tell random notes (step
11-14) from a real cello mis-heard (step 11-19 on 9 of 12): it is a statement
that the pitches are not a tune, not that nobody played one. With a range of
36-96 the sarabandes' notes outside it are 43% (2220) and 30% (2296), the
figures that prompted fault 7.

## Round 3 (branch ai-fix-musicality2, from 26c4196)

A skeptic's list, worked in priority order. Each number below was run on this
code and on 26c4196's on the same takes; "pairs with a false difference" means
two takes of one unchanged player (shifted in time, length, pitch or level) that
the comparison said differ on some row. The sweep scripts are in the session
scratchpad, not the repo; the checks that stay are `tests/musicality-round3.test.js`
(35 tests, 28 of which fail on 26c4196; the seven that pass there are controls
that a fix must not break: no cut in a breath-free take, a constant tempo is
steady, a true wave is still moving, a quiet gap after each note is read, two
lengths of one player do not compare as a tempo change, and two real-vibrato
reads) and the `round 3` section of
`node tools/musicality-synth-check.mjs` (real Analyzer + segmenter).

**1. "About the same" was said of nothing.** `compareMusicalityFacts` printed
"shaped about the same on everything that could be measured in both" for two
takes that were both refused as too quiet, for a 14-note take against an 80-note
one, and when a topic filter had hidden the row that differed. It now says "about
the same" only when at least one wanted row was read in both, names those rows
("on phrases found, typical phrase length, ..."), and otherwise says nothing was
measured in both so it cannot say whether they are shaped alike. `facts.js`
needed two regex edits to follow (the plain-comparison fold and the pointer to
differences), and `tests/ai-facts-compare.test.js` was updated to the new
wording.

**2. Phrase count between takes of different lengths.** 72 of 80 pairs of one
simulated player (every phrase ten notes) at 3, 4, 6, 8 and 12 phrases said
"more, shorter phrases". The count is compared only when the takes are within a
fifth in note count, and a new row, typical phrase length in notes, is compared
always (two notes or a quarter, whichever is more). Now 0 of 80. A player who
really phrases in fives instead of tens is still told so.

**3. The breath bar was in seconds.** A flat performance with a breath of 0.6 of
a note, 8 phrases of 8, through the real pipeline: 8 phrases at 0.4 s a note,
2-5 by seed at 0.35 s, 1 at 0.3 s (the skeptic's numbers). The bar is now 0.4 of
the local spacing beyond the take's usual silence with a 0.12 s floor.

| family (real Analyzer + segmenter, 16 seeds, 6 tempos 0.3-0.7 s) | 26c4196 | now |
|---|---|---|
| skeptic's: breath 0.6 note, 8 x 8, slurred, 6% jitter, 240 pairs | 136 pairs with a false phrase difference | 0 |
| breath 0.7 note, 6 x 10, 4% jitter, 240 pairs | 15 | 0 |
| breath 1.0 note, 8 x 8, 240 pairs | 0 | 0 |
| HELD OUT (breath 0.55 / 0.8 / 1.5 notes, arched, new seeds), 54 pairs | 12 | 0 |
| no breath at all, 0.12-0.6 s a note, 112 takes: false phrase cuts | 0 | 0 |

Two takes with a note spacing under 0.28 s are not compared on their phrases at
all (`FASTEST_BEAT_SEC`): at 0.2 s a note the same player finds 1-8 phrases by seed
and no bar fixes that, because the pipeline's own onset error is as big as the
breath. WORTH KNOWING: the floor was 0.08 s first (every breath found from 0.25
s a note) and was raised to 0.12 after the seven real cello excerpts showed 11-33
silences of 0.08-0.2 s each in 45 s (bow changes), against 0-9 of 0.2 s or more.
The seven excerpts' phrase cuts are 79 on 26c4196, 136 at a floor of 0.08, 117
at 0.12, 99 at 0.2. Whether 117 is right for real playing is NOT known: the
MusicNet labels have no silence of 0.12 s anywhere in the seven excerpts, so
they cannot say where phrases end. The excerpts are all refused by the junk or
fragments gate today, so none of this is printed for them.

**4. Pitch wobble in the quiet tail read as vibrato opening up.** Frames more than
about 9 dB under the note's own peak are dropped, 16 frames must be left, and a
single sine wave at 3.5-9.5 Hz must explain at least half of the wobble (the
vibrato measure's own confidence; calibrated on simulated stretches: white
wobble of 8 cents passes 0.5%, 0.1% and 0% at 16, 24 and 40 frames, a 28-cent
vibrato 100%, one that opens up from nothing 96-99.5%). The frames dropped are
only those AFTER the note's loudest frame: a note that swells into its peak keeps
its quiet start, and a first cut that dropped quiet frames wherever they fell read a
vibrato that opens up on a 36 dB swell as "about the same width" (48 of 48 notes). A
staccato line in a 3 s hall (real pipeline, 22 long notes) went from a vibrato found
on 12 of them, 7 of those "opens up" (the commit message of 4ae1975 says "12 of 22"
for what is 7 of 12), to none found; a decaying tone with room noise went from
"opens up" on 9, 14, 10 and 19 of 32 long notes (four of six configurations; the
other two were already clean or too quiet) to none. Each half alone is not enough:
with the confidence removed 2 of the 4 decaying configurations that misread still
did (8 and 18 notes); with the tail kept, 1 of 22 hall notes still read as vibrato.
Clean vibrato through the real pipeline reads as before (100% opening, 0% steady,
at levels 0 and -6 dB).

**5. The range check and the hum.** `assistant.js` passes no range, so the check
never ran. Without a range, `musicalityOf` now uses `GENERIC_RANGE` (E1-G7, 28-103)
and, only then, treats a note more than three octaves from the take's median as
outside; `rangeFor('strings' | 'winds' | 'brass' | 'voice' | 'keys')` is exported
for a caller that knows the family, and the facts say "any instrument's or voice's
range" when none was given. That catches only pitch nobody makes (a 20 Hz
rumble), not a cello read an octave low (still inside E1-G7); `assistant.js` still
has to pass `rangeFor(family)` for that. A 60 Hz hum with a little drift run
through the real pipeline is 133-228 "notes" with no silence; three of four
takes had read as "one continuous stretch", "6 phrases" or "8 phrases". A new
reason, `unbroken`, fires when under 2% of the readings are more than 12 dB under
the take's loud level (hum 0-0.3%, seven real cello excerpts 8.5-21%) AND the
10th percentile of the loudness is within 3 dB of the 90th (hum 1.7 dB, real
cello 11-14 dB), and withdraws every descriptor with the reason in words. The
second condition came from review: with the first alone a long slur with no
breath that swells and fades (real pipeline: 1.2% of readings 12 dB down, 6.9 dB
between its percentiles) was withdrawn whole and told it was "not what playing is
like"; it is read now, and the sentence for a hum says only what was measured.

**6. The tempo.** (a) The follower could lock on two thirds or three quarters of
a beat (not only half or double). TRIED AND WRONG: refusing a step of 0.32-0.69
of an octave between neighbouring runs of four spacings (a 15% tempo wave steps
0.41), and then requiring it to arrive at one note (the spacing after a breath
jumps that much anyway). What works: three spacings in a row near the take's
commonest length that the follower gave a rung other than one. Of 60,000
constant-tempo takes (jitter up to 20%, 8 or 15 ms onset error) 2,111 are
refused by it; 26c4196 read 1,220 of those as "free" (median 19%, p90 30%) and 509
as returns/steady. (b) The drift is the line through the whole smoothed curve
with an independent second reading, not the first third against the last. A
true +11% accelerando, 20 takes through the real pipeline: 3 "speeds up", 6
"returns", 8 "steady", 3 refused on 26c4196, now 17 "speeds up", 2 "leans
faster", 1 refused. -9%: none right and 11 "returns" + 6 "steady" on 26c4196, now
18 "slows down" and 2 "leans slower". +25%: 20 of 20 both. Constant tempo: 20 of
20 steady both. "Comes back to where it began" is said only when the curve ends
within 4% of where it began; a wave that stops elsewhere is "moves ... not said to
come back". A drift line must explain 40% of the curve's movement to be a drift
rather than a wave. COST: waves of 15% are read in 33 of 40 takes at 80 notes
(36 on 26c4196); waves of 20% in 9 of 40 (31 on 26c4196), because the lock check
reads them as a lock; a constant-tempo player with 8% jitter has the shape
refused as unbacked in 14% of takes (1% on 26c4196) and described as "moves ...
not said to come back" in 13%.

**7. The length bias.** Tempo flexibility is read in windows of 24 spacings and
pooled, refused below 24 steady spacings, and carries its standard error (1 over
the square root of two thirds of the spacings: 29% at 28 notes, 5% at 672). The
same playing (spacings off by up to 4%) read 2.29 at 28 notes and 2.63 at 672 on
26c4196 (1.66 at 14), now 2.43 and 2.60 (the 14-note take is refused). A player
at +-9% was "steady" in 12 of 40 takes of 56 notes and 0 of 40 of 448 (the
seeds of the unit test; 13 of 40 on the sweep's own), now 4 and 0, with the rest saying "on the edge between steady and giving a little". The
comparison needs 1.5 combined standard errors to call a flexibility different.
REPEAT TIMING: the number is not length-biased (identical playing reads 3.8-4.05%
at +-4% jitter and 5.4-6.0% at +-8% from 16 notes to 320; the number of matching
pairs changes but its median does not), but its WORD flipped: at +-6% jitter
"alike" in 80% of 28-note takes and 98% of 672-note ones, "different" in 20% of
the short ones. It now carries a standard error (1.25 sd over the square root of a
quarter of the pairs, because neighbouring pairs share notes: with every pair
counted the error was half the number's real spread across 200 seeds, with a
quarter it matches, ratio 0.9-1.1 from 20 to 96 notes) and a number within one of
it of the line says "on the edge between alike and different": "different" in 8%
of 20-note takes, 2.5% of 32-note ones. Not done: repeat loudness (not asked) and
a take of 320+ notes, which uses only its first 60 pairs. (Repeat LOUDNESS looked
biased in the same sweep, 2.9 dB at 16 notes against 0.01 at 320, but that was
my own take: one arch across the whole take, so the repeats sat at different
heights of it.)

**8. The sweep: length x tempo x transposition x level, the real pipeline.** A flat
player, 4 lengths (24-192 notes) x 2 tempos x 3 transpositions x 2 levels x 3 seeds
= 144 takes, and then a second grid of different seeds, tempos, shifts and gains
(held out for the fix this found). Pairs with a false difference:

| axis | 26c4196 grid 1 | now | 26c4196 grid 2 | now |
|---|---|---|---|---|
| transposition (144 pairs) | 21 | 2 | 22 | 1 |
| level (72) | 11 | 0 | 1 | 0 |
| tempo (72) | 17 | 0 | 7 | 0 |
| length (108) | 104 | 0 | 108 | 0 |

The transposition, level and tempo leaks were all `phrase-definition`, the mean
of one score per phrase end (67 or 100 each): with two or three ends one end more
or less cued moves it by 33 or 17. Its comparison bar now grows with how few ends
there are (two standard errors of 17/sqrt(ends)); the grid-1 numbers were seen
before that bar was set, grid 2 was not. Found and not fixed: (i) among the
448 tempo-only pairs of the fast family (0.2-0.7 s) 7 still differ, 4 on
tempo flexibility ("a steadier tempo", a 0.2-0.25 s take reading 6-8% from timing
noise alone) and 3 on articulation; (ii) a take of 24 notes now has no tempo
spread and no tempo shape unless it drifts (it had both); (iii) a take of
constant loudness (within 3 dB between its percentiles) with no quiet reading at
all is called unbroken whatever made it, so a synthetic flat legato line with no
breath and no dip, or a held organ note, is unreadable too (real cello is never
like that; the sentence says only what was measured).

**The real excerpts.** The four earlier (2220, 2222, 2296, 2298) and three more
(2218 suite 3 allemande, 2221 suite 3 bourree, 2295 suite 4 courante), 45 s from
60 s in. THE THREE "NEW" ONES ARE NOT NEW: they were among the eight held-out
movements of the previous round, and no movement of this recording set has not
been run. All seven are refused by `junk` (six) or `fragments` (one) before and
after, so nothing about phrases, tempo or vibrato is printed for any of them, and
the only number that moves is legato-or-detached, by 0.01-0.02 on four of the
seven (0.73 to 0.75, 0.88 to 0.89, 0.97 to 0.98, 0.74 to 0.75), because it excludes
the links at phrase cuts and the cuts moved. These excerpts therefore validate none
of the seven fixes. They are not held out for the breath floor: its change from
0.08 to 0.12 s was made after looking at all seven. Three windows no earlier run
used (2293 suite 4 prelude, 2297 suite 4 bourree and 2219 suite 3 courante, 45 s
from 150 s in; the same recordings, other audio) were run once, after the code was
frozen: all three are refused by `junk` on both versions and print only
legato-or-detached (0.85, 0.80 and 0.82 on 26c4196; 0.86, 0.80 and 0.83 now). With
the gate bypassed (a diagnostic, not the product) the phrase counts go from 13, 18
and 16 to 17, 23 and 26, tempo is refused for mixed note values on both, and
phrase-end lengthening reads 1.76x, 0.87x and 1.17x on 26c4196 against 1.76x, 0.79x
and 1.49x now.

## Which thresholds were set after seeing real data

Said plainly, because a threshold fitted to the thing it is then tested on is
the failure `no-gaming-the-measure` exists to catch.

- Set from the synthetic floor before any real recording was run: every
  `LIMITS` value, `NOISE_MS`, the 0.12-octave ladder tolerance's replacement
  (0.17, widened because a synthetic 15% tempo wave was lost behind a 13% step
  after a breath), and the 8% note-to-note scatter gate (added because a
  synthetic metronomic legato line read 27% free).
- Set AFTER seeing real data: the 25% short-note line (`noisyShortShare`, chosen
  to sit between the cleanest excerpt, 16%, and the rest, 29-39%, so it is
  fitted to these four), and the 60% dominant-note-value gate (added after the
  score-aligned gigue onsets read 33% against 12.8%). The tempo "mixed" gate
  has since been run on the label onsets that motivated it; neither was run on
  any held-out recording.
- Added in the verifier round, and where each came from (none was fitted to a
  recording; several WERE fitted to the synthetic takes they are then tested on,
  so the synthetic checks below are demonstrations, not validation):
  - `flatLengthening` 1.25: above the highest a metronomic take reads through
    the real pipeline (1.17 at 0.15 s legato). Synthetic.
  - `flatStretchDb` 1 and `wideStretchDb` 3: from the flat synthetic floor.
  - `minCoverage` 0.5 ("most"), `ACTIVE_BELOW_DB` 20, `outOfRangeShare` 0.25
    (the existing short-note line's number), `junkStep` 9 (below random pitches'
    11-14, above any tune's 2-3), `junkPatterned` 0.2 (a drill repeats every
    window, random pitches none): chosen before any of the twelve real excerpts
    was run through them. `junkStep`'s TREATMENT was changed after the first four
    read 12-19 (withdraw everything → legato-or-detached only).
  - The false-drift gate (3.5 standard errors, 8%, replication in both halves,
    the factor-of-two window 1 ± 0.2) was set on the synthetic zero-drift
    battery, seeds 1-100, after seeing its failures; the cached real-pipeline
    takes (seeds 1-20) were run once afterwards and not used to set anything.
  - Phrase-definition's comparison threshold (30): set so that the identical
    performance at two tempos with 14 ms of onset error compares as the same in
    60 of 60 pairs. Synthetic, and fitted to those pairs.
  - Real data used to SET anything this round: none. Real data used to CHECK:
    the four excerpts (not held out; the 25% line was fitted to them) and eight
    others.

## Wiring it into the assistant (done on branch ai-integrated)

Wired as below, with two differences: the router pattern is a narrower one of its own (MUSICALITY_PATTERN also catches tempo, dynamic, consistent, steady and shape, which belong to other intents), and a plain comparison folds the three largest shaping differences in. The guard also rejects taste words (beautiful, musical, expressive, lifeless...) when these facts are in the prompt. The original plan:

Two things the verifier round leaves for the owners of those files. (1)
`assistant.js` calls `musicalityOf({ notes, readings, a4 })`; pass `range:
{ lowMidi, highMidi }` for the instrument in use or the out-of-range check never
fires. (2) `tests/ai-musicality-wiring.test.js` line 114 quotes the old
stretch figure ("The loudest stretch is 1.4 dB above the quietest"); the fact is
now "the runs of eight notes vary in loudness by about 0.6 dB (the standard deviation of their levels...)",
so that line fails until it says, for example, "The runs of eight notes vary in
loudness by about 0.6 dB, so the loudness barely moves."

Left to whoever owns `router.js`, `facts.js` and `assistant.js`:

1. `router.js`: add `['musicality', MUSICALITY_PATTERN]` to `INTENTS` (import
   it from `musicality-facts.js`) and `musicality: intents.includes('musicality')`
   to `needsOf`.
2. `assistant.js`: where `needs.quality` loads the take, also set
   `t.musicality = musicalityOf({ notes: data.notes, readings: data.readings, a4: data.a4 })`
   when `needs.musicality`; append `MUSICALITY_INSTRUCTION` to `INSTRUCTIONS`.
3. `facts.js`: in `factsFor`, `else if (intent === 'musicality')` use
   `compareMusicalityFacts(chosen[0], chosen[1], { question })` when two takes
   are chosen and a comparison is asked, else `musicalityFacts(chosen[0], { question })`.

## Design note: how teacher ratings could teach quality for real (not built)

What cannot be learned from this repo's data can be learned from people who
can hear it. Nothing below exists.

- **Ask for preferences, not scores.** A teacher hears two takes of the same
  passage by the same player and answers "which is more ...?" on a few named
  axes (phrasing, rhythm and pulse, tone, overall) with "no difference" allowed.
  Pairs within one player and one passage cancel the player, the instrument and
  the microphone, which is most of what a score from one recording would
  confuse with quality. Free-text and "mark the moment" tags ride along.
- **Store, per rating,** the two takes' descriptor vectors as computed then,
  the module version, the instrument, and a pseudonymous teacher id. Ratings
  stay on the device. Anything leaving it is opt-in, per upload, with the
  consent text stored beside it, because the app promises everything stays on
  the device.
- **Fit something small and readable first:** a Bradley-Terry / logistic model
  on descriptor differences, per axis, so a learned weight can be shown and
  argued with. Only then anything bigger.
- **Gate on agreement, not accuracy.** Measure how often two teachers agree
  with each other first; a model cannot be better than that. Hold out whole
  players, not whole pairs. Show a learned judgement to anyone only when its
  held-out agreement with teachers is within reach of teacher-to-teacher
  agreement, per axis and per instrument family, and say which teachers it
  learned from.
- **Keep the measured descriptors as the vocabulary.** The model may say a pair
  differs in phrasing; the sentence that explains it still comes from the
  measured descriptors, so the guard still holds and the model still never
  invents a number.
- **Expect disagreement** between schools and between teachers, and keep it:
  a rating tagged by teacher is data, an average of teachers is a taste nobody
  holds.
