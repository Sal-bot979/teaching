# teaching

## LearnHarness: Hayden Edition

A minimal personal fork of [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist (AGPL-3.0-only), now on upstream **v0.4.1** (`e69e852`). Upstream teaching, probing, planning, practice, knowledge graph, sessions and UI are unchanged. The fork adds:

- **An opt-in learner profile.** It asks for one step and one question at a time, brief by default, generative checks, confident-misconception repair, units/assumptions/law-vs-model rigor, synthetic-only examples, length cues and a resume point on stop. It reaches the prober, teacher and practice agents.
- **A study-folder boundary.** The agent's file tools reach only your study folder, never your whole home directory.
- **Templates, a transcript checker, a synthetic-learner live eval and a 7-day retention protocol.** These measure whether a model follows the profile and whether it helps *you*.

| | |
|---|---|
| The fork | [`learnharness/`](learnharness/) |
| Commits | `0a60044` upstream v0.3.7 import → `f844e04` study-folder boundary → `caa84f0` profile, evals, templates → 3 critic repair rounds → `2270bd7` upstream v0.4.1 import, merged in `a301f4f` → `c07d4c0` 0.4.1 test adaptations + live eval |
| Brief, team, scope | [`docs/01-director-brief.md`](docs/01-director-brief.md) |
| Per-file rationale, evidence, FMEA | [`docs/02-changes.md`](docs/02-changes.md) |
| Test results, critic findings | [`docs/03-results.md`](docs/03-results.md) |
| Rollback | [`docs/04-rollback.md`](docs/04-rollback.md) |
| Patch (fork vs upstream v0.4.1) | [`docs/fork.patch`](docs/fork.patch) |
| Screenshots (real app, scripted demo data) | [`docs/screenshots/`](docs/screenshots/) |
| Starter templates | [`learnharness/hayden/templates/`](learnharness/hayden/templates/) |

## Run it

```bash
cd learnharness
npm ci                                   # Node 22
npm test && npm run lint && npm run typecheck && npm run build
npx tsx hayden/profile.ts on             # opt in (or: Settings → Agent → Prompts)
LH_STUDY_DIR="$HOME/Study" npm run dev   # http://localhost:3000; put notes/PDFs in ~/Study
```

Real tutoring needs a model provider. Add your own key or subscription in **Settings → Providers**. **Provider calls may cost money.** Nothing in this repo makes one; every test and demo uses a scripted model.

Before relying on a model, run the synthetic-learner eval once: `npx tsx hayden/evals/live-eval.ts --dry-run` (free), then `--confirm-spend --max-usd 0.50` against a copy of your data dir. After real sessions, score them with `npx tsx hayden/evals/check-session.ts`, then follow [`hayden/evals/retention-protocol.md`](learnharness/hayden/evals/retention-protocol.md).

## Handoff

**Kept from upstream:**
- Everything in upstream v0.4.1: probing, dependency planning, predict → teach → check
- Separate practice with the hint ladder
- Thinking fields, the knowledge graph and its provenance
- Session history and persistence, providers, visuals and the UI
- The AGPL license and credit

The app-code diff against v0.4.1 is 8 files, +75 / −14.

**Personalized (opt-in, one switch):**
- One step and one question per turn, brief by default
- Generative checks: predict, explain, counterexample, changed version
- Confident misconception → repair the prerequisite
- Rigor: units, assumptions, law vs model vs convention
- Synthetic-only examples; never invent sources
- 10/25/45-minute starters and a resume point on stop

All of it defers to practice doctrine. Plus a study-folder boundary.

**Passed:**
- On v0.4.1: 3,268 / 3,269 tests. The one failure fails identically on unmodified v0.4.1 (environmental).
- Lint, typecheck and build pass.
- With the profile off, all three agents' prompts are byte-identical to upstream (apart from the two study-folder sentences). With it on, the profile reaches prober, teacher and practice through the real request path.
- Every file-escape attempt is blocked.
- Independent critic rounds, with every confirmed defect fixed.

**Unverified:**
- Whether a live model actually follows the profile, and whether it helps you learn. Every test uses a scripted model; the live eval makes the first question a one-command check.
- The reference video, which this environment couldn't reach.

**Your next step:** add a provider key in Settings → Providers and run `npx tsx hayden/profile.ts on`. Then run the live eval with a $0.50 cap to confirm your model follows the profile. Then start a normal session with the medical-physics starter in `learnharness/hayden/templates/`. Don't read `held-out-items.md` first.
