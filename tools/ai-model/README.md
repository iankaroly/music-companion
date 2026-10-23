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

The detectors in `score.mjs` are regexes for reply faults the guard accepts
(a note's figure given as the take's, grade words, a premise echoed back,
"not measured" where a measurement exists). They are a floor, not a judge:
the counts that matter were also read by hand.
