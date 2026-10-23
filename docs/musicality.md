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
| contrast between stretches | spread (standard deviation) of the loudness of consecutive runs of eight notes, from 32 notes up; the fallback when no phrases exist, labelled as stretches, never as phrasing. Not loudest-minus-quietest, which grows with the length of the take (see *Fixes after the verifier*) | "varies by about 1.1 dB" |
| legato or detached | sounding length / time to the next note | "62% of the time to the next note" |
| evenness of articulation | quartile range of that ratio | "even" / "varies" |
| tempo flexibility, and whether it returns or drifts | local tempo curve, spread and first-third vs last-third | "moves by about 9% and comes back" |
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
| `junk` | the median step between neighbouring notes is 9 semitones or more | the same as `fragments` |
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
a test that fails on 2b5b284 (`tests/musicality-fixes.test.js`: 23 of its 25
tests fail on the old two files; the other two are regression guards) and a
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
follower wander.** Zero-drift takes with a random jitter on every spacing, 100
seeds per cell, ideal notes; cells are takes read / takes that claimed a drift:

| jitter | 6 phrases | 12 phrases | 24 phrases |
|---|---|---|---|
| 4% | 100/0 → 100/0 | 100/0 → 100/0 | 100/0 → 100/0 |
| 8% | 100/1 → 100/0 | 100/0 → 100/0 | 100/0 → 100/0 |
| 12% | 100/11 → 99/1 | 100/9 → 96/0 | 98/4 → 93/0 |
| 20% | 39/25 → 35/0 | 27/15 → 23/0 | 22/9 → 14/0 |

The one remaining false drift of 1200 (12% jitter, 6 phrases, +12%) is left in
the table rather than tuned away. Real pipeline, 20 seeds per cell (cached
heard takes, 240 takes): 15 false drifts before (3, 5 and 0 at 12% jitter; 5, 2
and 0 at 20%), 0 after, with 13 fewer takes read in all (7 at 12% jitter, 5 at 20%,
1 at 8%). The
price is on true drifts at high jitter (ideal, drift 20%: 93/94/97 claimed
before, 64/79/86 after at 12% jitter; drift 15%: 74/81/83 → 36/56/70; at 4%
jitter 100/100 both) and on waves: a 15% tempo wave with 8% jitter is refused
or read in 67-76 of 100 against 72-87 before, but is never called a drift
(false drifts on the wave takes 38/17/24 → 0/0/0 at 8% jitter).

What stops it: a drift is claimed only if (1) the beat the follower kept never
steps by a factor of two (otherwise tempo shape AND flexibility are refused and
say so; this is the seed-14 take that read "ends 49% slower"), (2) a second
reading, every spacing taken against one fixed reference with no following,
finds the same drift at least 8% and at least 3.5 standard errors, and (3)
that drift shows in both the even- and odd-numbered spacings alone. The
follower's reset was also tried at the octave nearest the last beat; that
stopped the lock and wrecked tempo waves (12 of 60 read against 56), so it was
reverted and the lock is caught afterwards.

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

**7. Junk and wrong-octave takes.** Random pitches (median step 14 semitones)
are treated like fragments: legato-or-detached only, low confidence. A take
read two octaves low is flagged and lowered to low confidence when the caller
passes a range (30% of its notes outside 36-88). `assistant.js` passes none, so
THE RANGE CHECK IS INERT IN THE APP until its call to `musicalityOf` is given
the instrument's range; `instruments.js` has families, not ranges. Under 24
notes the number of phrases is no longer a finding.

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
    11-14, above any tune's 2-3): chosen before any of the twelve real excerpts
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
now "the loudness of one run of eight notes to the next varies by about 0.6 dB",
so that line fails until it quotes 0.6 dB.

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
