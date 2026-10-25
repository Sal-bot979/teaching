# teaching

## LearnHarness: Hayden Edition

A minimal personal fork of [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist (AGPL-3.0-only), at upstream `b277ee3`. Upstream teaching, probing, planning, practice, knowledge graph, sessions and UI are unchanged. The fork adds:

- **An opt-in learner profile.** It asks for one step and one question at a time, brief by default, generative checks, confident-misconception repair, units/assumptions/law-vs-model rigor, synthetic-only examples, length cues and a resume point on stop. It reaches the prober, teacher and practice agents.
- **A study-folder boundary.** The agent's file tools reach only your study folder, never your whole home directory.
- **Templates, a transcript checker and a 7-day retention protocol.** These measure whether the profile helps *you*.

| | |
|---|---|
| The fork | [`learnharness/`](learnharness/) |
| Commits | `0a60044` verbatim upstream import → `f844e04` study-folder boundary → `caa84f0` profile, evals, templates → repair rounds |
| Brief, team, scope | [`docs/01-director-brief.md`](docs/01-director-brief.md) |
| Per-file rationale, evidence, FMEA | [`docs/02-changes.md`](docs/02-changes.md) |
| Test results, critic findings | [`docs/03-results.md`](docs/03-results.md) |
| Rollback | [`docs/04-rollback.md`](docs/04-rollback.md) |
| Patch | [`docs/fork.patch`](docs/fork.patch) |
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

After a few real sessions, score them with `npx tsx hayden/evals/check-session.ts`, then follow [`hayden/evals/retention-protocol.md`](learnharness/hayden/evals/retention-protocol.md).
