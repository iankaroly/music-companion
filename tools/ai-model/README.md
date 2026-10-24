# tools/ai-model: the real on-device model, on this Mac

A dev harness, not part of the app. It runs the instructions and prompt that
`src/ai/assistant.js` builds through the same FoundationModels framework the
iPhone plugin uses (macOS 26, Apple silicon), then scores each reply with the
real `src/ai/guard.js`. The Swift side contains no prompt of its own.

```
swiftc -parse-as-library -O tools/ai-model/Sources/main.swift -o /tmp/ai-model
/tmp/ai-model availability                       # what SystemLanguageModel.default reports
node tools/ai-model/export-cases.mjs cases.json  # every answerable eval question + its prompt
/tmp/ai-model run cases.json replies.json 200    # fresh session each, temperature 0, 200-token reply cap
node tools/ai-model/score.mjs cases.json replies.json [--show tune]
node tools/ai-model/long-cases.mjs long.json     # synthetic oversize prompts (context-window probe)
```

`export-cases.mjs` seals every third question (by hash of the text) as `held`;
`score.mjs` shows only the `tune` split unless you pass `--reveal-held`.
`results/` holds the before and after cases and replies the numbers in the
commit message were scored from, and the context-window probe output.

ONLY QUESTIONS ABOUT ONE TAKE ARE SENT TO THE MODEL (round 3). A question whose
facts are built from more than one take (a comparison, a trend, habits over the
library, "my last 3 takes") is answered by the app's own sentences, because the
guard cannot tell which take a claim is about. `export-cases.mjs` writes the
single-take cases to `<out>.json` and the rest, with the same ids, to
`<out>.code.json`, so the count of questions routed away is read off the same
pool: 51 of the 156 answerable questions (105 go to the model). Ids are
positions in the hash order and do not move, so a case keeps its id and its
tune/held split across rounds. `results/*-round3.*` are that export, the real
model's replies to it, and the routed-away list. Scoring against an older
`cases-*.json` by id is wrong when the questions or facts changed (6 of the 156
differ between `cases-after.json` and a fresh export); score each reply file
against the cases file it was generated from.

The detectors in `score.mjs` are regexes for reply faults the guard accepts
(a note's figure given as the take's, grade words, a premise echoed back,
"not measured" where a measurement exists). They are a floor, not a judge:
the counts that matter were also read by hand.
