# Reading a page of music — where this is up to

The page reader finds staves, clefs, barlines and noteheads on a photograph of
sheet music, so a recording can be paired with the notes on the page. This is
the state of it, what is measured, and what to do next.

## Run it

```
npm run dev                  # port 5199 — everything below needs this running
open http://localhost:5199/tools/reader-look.html
```

Drop a PDF or photo in. Tick **marking mode** to build ground truth: click a
ring that is not a note, click bare paper where one was missed, save. Marks are
positions, not indices, so they survive changes to the detector — that is the
whole point of them.

## Where it stands

`npm run bench` — every marked page, scored together:

```
page          space  found  really  precision  recall     F1   invented  missed   bars  clefs
Bach           12.1    331     322      96.1%   98.8%  97.4%        13       4     34  10/10
Mozart           10    351     332      86.0%   91.0%  88.4%        49      30     36  10/11
Scanned         9.6    465     453      90.3%   92.7%  91.5%        45      33     34  10/11
```

**Those figures are optimistic by construction.** The notehead classifier's
weights are fitted to all three pages. The honest number is the cross-page one
from `npm run scan:train`, which trains on some pages and scores on a held-out
one: **87.4% precision to 99.4% on a page the model had never seen.** Quote that
one.

## How it works

1. **Staves** by comb filter in vertical strips, tracked across the page as
   curves. A photographed page is not flat and nothing downstream flattens it.
2. **Clef** read from a band just past each stave's left end (`scan-clef.js`).
3. **Key signature** — only its EXTENT is found, by walking off the end of the
   clef until something is not an accidental (`scan-key.js`). Nothing reads
   WHICH key it is. See "not built yet".
4. **Barlines** — a column of ink spanning the stave with nothing wide hanging
   off it and no overhang past the lines.
5. **Noteheads** in two passes: shape tests propose candidates, then a
   classifier judges them (`head-model.js`). Stems propose extra candidates for
   notes the shape tests never offer.

The division of labour matters and was arrived at by measurement: the shape
tests localise well and judge badly. Six threshold sweeps in a row bought a
point of recall for a point of precision and gave it back, because at a
ten-pixel staff space a notehead and a rest are the same size and shape class.

## The measuring tools, and why each exists

| command | what it answers |
|---|---|
| `npm run bench` | every marked page at once |
| `npm run scan:truth -- <pdf> --truth <json>` | one page: where every invented and missed head is |
| `npm run scan:crop -- <pdf> x,y` | LOOK at it. `CROP_MARKS=1` draws heads and bars, `CROP_TRUTH=<json>` adds the marks, `CROP_LAYER=body` shows what findHeads sees |
| `npm run scan:why -- <pdf> x,y` | which test in findHeads rejected a point, and by how much |
| `npm run scan:bar-why -- <pdf> x,y` | the same for barlines |
| `npm run scan:train` | retrain the classifier, cross-page validated |
| `npm run scan:curve` | is the bottleneck data or model capacity |
| `npm run scan:res` | is the reader resolution-starved (it is not) |
| `npm run scan:corpus` | synthetic pages — the only stand-in for a page nobody marked |
| `npm run scan:bars` / `scan:clef` / `scan:clef-hard` | synthetic, with real truth |
| `npm run reader:mark` | the marking tool still works |
| `npm run scan:spread` | the camera scanner: a book spread comes back as two pages |

**Every real bug in this reader was found by looking at the page. Every dead end
came from reasoning about what the code probably does.** `scan:crop` and
`scan:why` are the two that pay for themselves fastest.

## Retraining the classifier

Any change to the shape tests changes which candidates exist, so the model must
be retrained against the new distribution or it is judging something it has not
seen:

```
npm run scan:patches     # dump candidates + labels (runs with the judge OFF)
npm run scan:train       # cross-page validation, writes pages/head-model.json
```

then copy the weights into `src/analysis/head-model.js` — BIAS and WEIGHTS only.
`npm run scan:patches` must run with `judge: false` or each round trains on the
survivors of the last and the model eats its own tail.

**Pick the threshold from the cross-page table, never from `bench`.** The bench
reads its best at cut 0.7; on a held-out page 0.7 throws away a fifth of the
notes. It is 0.4.

## What is NOT built

- **Which key signature it is.** The band is found; the sharps and flats in it
  are not identified. Every note name on a page in G major has its F natural.
  `scan-key.js` has the order tables ready.
- **Note values beyond beam counting** — rests, dots, ties, tuplets.
- **Mid-system clef changes.**
- **Barline ground truth.** The counts in `bench` are counts, not accuracy.
  This is how the barline failure hid for a day: every number went to noteheads.

## Known broken

- **System 1 on both Mozart pages.** Its staff space measures 7.9 against 9.6
  for the rest, so the stave MODEL is wrong on the first system, not just the
  clef it then fails to read. Both pages, same symptom. Next thing to chase.
- 30-49 invented heads per page on the harder two, mostly rests, accidentals,
  ornaments and text inside the stave.

## What is measured and does NOT work

Written down so it is not proposed a third time. Each has numbers in the commit
that removed it:

- **Step residual** as a notehead filter — distributions overlap almost
  completely; cut 0.25 keeps 71% of real notes and rejects 54% of false.
- **Cross-system voting** to find the key signature by its being printed in the
  same place on every system — costs 4 to 8 points of RECALL on the corpus,
  because music near a system's start is often similar system to system.
- **Requiring a ledger line** on a head far outside the stave — three marks
  removed and a real note lost, at every threshold from step 10 to 14.
- **A bigger model** — one hidden layer of 24 reads 87.8% on the held-out
  Mozart against logistic regression's 92.0%.
- **More patches from pages already in the set** — 60 gives 94.3%, 397 gives
  95.1%. Flat.
- **Higher working resolution** — heads plateau from 1400px to 3600px.

## The next step, in order

1. **A page of a different KIND.** Handwritten, a piano score, a phone photo of
   something not already here. The asymmetry says variety is the lever: the Bach
   contributes 46 negative patches and the Mozart 152, and the model trained on
   the richer set travels much better in both directions. `scan:curve` says
   whether a new page bought anything.
2. **System 1's stave model**, above.
3. **A key signature reader**, so a note can be NAMED and not just found.
4. Capture quality in the app — `src/ui/scanner.js` already outlines the page,
   splits a book spread and asks the user to come closer. Better input lifts
   every number here without touching the reader.
