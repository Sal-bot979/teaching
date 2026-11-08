# Walkthrough video

`learnharness-walkthrough.mp4` (78 s, 1440×900): a browser driven by Playwright uses the real app the way a learner would. It types a goal with a length cue, answers the probe (option, confidence, thinking), sees the plan map, approves it, predicts, reads the teaching, answers the check, opens the live plan window, stops for a resume point, then does a practice problem with a wrong attempt, a hint and the correct answer. It ends at the profile switch in Settings.

**What is real and what is scripted.** The app, its request handler, the prober/teacher/practice agents' tools, tool validation, persistence and the UI all run for real. The tutor's *words* come from `learnharness/hayden/evals/demo/mock-tutor.mjs`, a small OpenAI-compatible server connected through Settings → Providers → custom endpoint (the same path a local model server uses). So the video shows how the harness works, not how well a real model teaches.

Re-record it:

```bash
cd learnharness
node hayden/evals/demo/mock-tutor.mjs 4100 &
LH_DATA_DIR=/tmp/lh-video npx tsx hayden/profile.ts on
LH_DATA_DIR=/tmp/lh-video npx next start -H 127.0.0.1 -p 3200 &
# connect http://127.0.0.1:4100/v1 (keyless, model "tutor-sim") in Settings → Providers,
# set it as the strong/cheap/vision model, then:
node hayden/evals/demo/record-walkthrough.cjs http://127.0.0.1:3200 /tmp/lh-video-out --video
```

Without `--video`, the recorder saves a screenshot per step instead (`docs/screenshots/live-run/`).
