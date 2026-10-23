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
| contrast between stretches | loudest vs quietest run of eight notes; the fallback when no phrases exist, labelled as stretches, never as phrasing | |
| legato or detached | sounding length / time to the next note | "62% of the time to the next note" |
| evenness of articulation | quartile range of that ratio | "even" / "varies" |
| tempo flexibility, and whether it returns or drifts | local tempo curve, spread and first-third vs last-third | "moves by about 9% and comes back" |
| lengthening at phrase ends | last note's length against the notes before it | "1.5 times as long" |
| repeated figures | the same five-note shape played twice: timing and loudness differences | "timing differs by about 2%" |
| vibrato opening up | on notes held 0.8 s or more, early half vs late half | "usually starts plain and opens up" |
| pitch leaning | where notes sit after a step up vs a step down | "4 cents higher after a step up" |
| character | one sentence assembled ONLY from the measured descriptors above | |

`compareMusicality(before, after)` says what changed in neutral words ("more
phrasing contrast", "less even articulation"). The one place it marks a
direction is a repeated figure played more alike the second time, because
sameness is what a repeat asks for, and even there it says alike, not better.

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

A take whose heard notes are 25% or more shorter than 80 ms is read as low
confidence throughout and the facts say so: on four real cello excerpts that
share was 16-39%, mostly double stops and fast runs mis-heard as fragments.

## Validation

**1. Synthetic, known shaping, through the real pipeline**
(`node tools/musicality-synth-check.mjs`, 23 checks, all pass; `--ideal` feeds
the notes straight from the spec and is what `tests/musicality.test.js` holds).
Arched, flat, building and jumping loudness; phrase-end stretch; tempo wave
(built 15%, read 11.5%, "returns"); drift; staccato vs legato (built 0.45/0.98,
read 0.48/0.96); mixed articulation; identical vs varied repeats (3.4% vs 8.3%);
vibrato opening vs steady (100% vs 0%). A metronomic flat take reads
**mechanical** at 0.6 s and at 0.15 s, legato and detached; none of five shaped
takes does.

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
| called mechanical | no | no | no | no |

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

## Wiring it into the assistant (done on branch ai-integrated)

Wired as below, with two differences: the router pattern is a narrower one of its own (MUSICALITY_PATTERN also catches tempo, dynamic, consistent, steady and shape, which belong to other intents), and a plain comparison folds the three largest shaping differences in. The guard also rejects taste words (beautiful, musical, expressive, lifeless...) when these facts are in the prompt. The original plan:

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
