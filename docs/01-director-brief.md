# Director's brief

**Destination:** a personal fork of LearnHarness that keeps about 95% of upstream untouched and adds a small, opt-in personalization for one advanced learner. It ships with deterministic proof that the personalization reaches every learning agent and that switching it off restores upstream.

**Source of truth:** upstream repo [`amosblomqvist/learnharness`](https://github.com/amosblomqvist/learnharness), AGPL-3.0-only. The fork was built on `b277ee3e0fa24249c1b2d0f9b7fd6ed485f484b9` (v0.3.7, imported verbatim in `0a60044`), then rebased by a 3-way merge onto **`e69e852` (v0.4.1, 190 commits later, imported verbatim in `2270bd7`, merged in `a301f4f`)**. Upstream 0.4.1 composes byte-identical agent prompts to 0.3.7. Behavior was read from the current code and tests, not the docs. The reference video ([youtu.be/nfTDljFG2g0](https://youtu.be/nfTDljFG2g0)) **could not be accessed**: YouTube is blocked by this environment's network proxy and no transcript was found. Nothing here claims to reflect its content; the build rests on the repository alone.

**Scope:**
- **In:**
  - one opt-in profile prompt that reaches prober, teacher and practice through the existing override mechanism
  - a study-folder boundary for learner-file tools (the documented security exception)
  - starter templates with held-out items
  - a transcript rule checker and a retention protocol
  - deterministic tests
- **Out:** new UI, new frameworks, dashboards, schedulers or integrations; live model calls; provider authentication; publishing.

**Quality bar:**
- With the profile off, all three composed prompts are byte-identical to upstream, apart from two documented sentences about the study folder.
- With the profile on, each prompt is exactly upstream + separator + profile.
- Lint, typecheck and build pass, and no upstream test regresses.
- An independent critic finds no unaddressed confirmed defect.

**Definition of done:**
- The fork runs.
- A patch file and per-file rationale exist.
- Before/after results are recorded, and screenshots taken from the running app.
- Rollback steps are written.
- Three templates exist.
- Live tutoring quality is labeled **unverified**.

## Team and ownership

| Role | Who | Owned files |
|---|---|---|
| PM / integrator / builder | main session | `learnharness/src/**` diff, `learnharness/hayden/**`, `learnharness/tests/hayden-*`, `docs/**` |
| Citation and transcript research | subagent (read-only, web) | none; report only (all 13 citations verified; video inaccessible) |
| Independent critic | fresh subagent, given the frozen candidate and these acceptance criteria but not the builder's rationale | none; report only ([results](03-results.md#independent-critic)) |

**Shared interface fixed before parallel work:**
- the segment path `shared/90-learner-profile.md`
- the switch key in `settings.json` → `agent.prompts`
- the `LH_STUDY_DIR` / `<data>/study` boundary contract
- `checkTranscript(messages) → { findings[], … }`
