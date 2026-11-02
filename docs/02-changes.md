# What changed and why

Upstream app code changed: **8 files, +75 / −12 lines**. The other ~1,800 lines are new tests, the `hayden/` folder (profile text, toggle script, templates, eval tools, upstream goldens) and docs. Nothing in the knowledge graph, sessions/persistence, providers, UI components or the license was touched.

## Upstream source files

| File | Change | Why |
|---|---|---|
| `src/agent/prompts/shared/90-learner-profile.md` | **new, empty** | The slot for the profile. `composeInstructions` drops empty segments, so with the profile off this file adds nothing. The existing Settings → Agent → Prompts UI picks it up with no UI change. |
| `src/agent/prompt-segments.ts` | +1 entry on `PRACTICE_SHARED_FRAGMENTS` | Practice composes only allowlisted shared fragments. Without this entry, a new shared file would silently miss practice. Pinned by tests. |
| `src/agent/prompts/README.md` | +1 paragraph | Documents the empty-segment design for the next maintainer. |
| `src/agent/tools/fs-shared.ts` | `studyRoot()`; `resolveSourcePath` now confines paths | **Security exception.** Upstream resolved learner paths against the entire home directory. Now relative paths resolve inside `LH_STUDY_DIR` (default `<data>/study`). Traversal, outside absolute paths, `~`, and symlinks whose real target is outside are rejected with an error the model sees. |
| `src/agent/subagents/runner.ts` | PDF job path goes through `resolveSourcePath` | The learner PDF job read raw paths. It now follows the same boundary, and a refusal becomes a normal "PDF failed" brief. |
| `src/agent/subagents/headless.ts` | `stripExternalRefs` before SVG rendering; CSP meta on the browser-fallback page | **Security, added in repair round 1.** A model-written SVG figure could load any local image by absolute path (`<image href="/home/…">`), through resvg or the `file://` fallback page. Any `*href` (any namespace prefix) that isn't `data:` or `#id` is dropped, DOCTYPE and `<meta>` are removed (round 2), and the fallback blocks every external fetch. `data:` images and `#id` references still work. |
| `src/agent/prompts/shared/30-learner-files.md` | 1 sentence | The doctrine said paths resolve against the home directory, which is no longer true. |
| `src/agent/prompts/teacher/40-jobs.md` | 2 words | "home-anchored" → "anchored to his study folder", for the same reason. |

## Upstream tests changed (only where intended behavior changed)

| File | Change |
|---|---|
| `tests/fs-tools.test.ts` | The fixtures live in the OS temp dir, so it becomes the study root. The missing-path probe moved from `/nonexistent` to a missing path inside the fixture: `/nonexistent` is now rejected *before* the not-found check. |
| `tests/read-tool.test.ts` | Scratch dir = study root. The "relative paths resolve against home" test now asserts "against the study folder". |
| `tests/jobs.test.ts` | PDF fixtures dir = study root. The doctrine assertion now looks for "study folder" instead of "home directory". **+1 test:** a PDF outside the folder fails the job before anything is read. |
| `tests/prompt-overrides.test.ts` | The pinned prober segment list gains `shared/90-learner-profile.md`. |
| `tests/fs-tools.test.ts` (0.4.1's `resolveSourcePath` suite) | Upstream 0.4.1 added tests pinning home-directory semantics. They're restated for the fork: tilde expansion is unchanged (leading `~`/`~/` is home, `~user` and inner tildes are literal), and every result is then held to the study folder, shown with a synthetic home that has `Study/` inside it. |
| `tests/pdf-reader.test.ts`, `tests/jobs.test.ts` (0.4.1 source-path suites) | The suite's synthetic home is also the study root (saved and restored); the test reading the repo fixture scopes the study root to `tests/fixtures`. |
| `tests/agent-image-paths.test.ts`, `custom-provider-lifecycle`, `background-capture`, `provider-neutral-agents` (new in 0.4.1) | Each rebuilds `process.env`; the study root is added to it (scratch dir or `tests/fixtures`). `agent-image-paths` copies its PDF fixture into the scratch study folder, as a learner would. |

**Why so many upstream tests needed a study root after 0.4.1:** upstream's PDF reader now calls `resolveSourcePath` itself (for `~` support). With the fork, that means the boundary is enforced inside the reader too, not just at the job runner. That's stronger, so it stays.

## New files

| Path | Purpose |
|---|---|
| `hayden/learner-profile.md` | The profile text (32 lines). Every clause traces to the request; see the [profile clause table](#profile-clauses-and-their-evidence). |
| `hayden/profile.ts` | `npx tsx hayden/profile.ts on [--force] \| off \| status`. It does what Settings does by hand. It never overwrites a customized override unless `--force` is given. |
| `hayden/templates/` | Three starters (medical physics, statistics/AI, business) × short/normal/deep, plus held-out transfer items with keys. |
| `hayden/evals/transcript-checks.ts`, `check-session.ts` | Rule checker for saved sessions: one question per turn, no performed praise, resume point on stop, sources only from research briefs or the learner, and patient-identifier patterns. |
| `hayden/evals/retention-protocol.md`, `results.csv` | A 7-day n-of-1 on/off comparison you run yourself. |
| `hayden/evals/seed-demo.ts` | Writes scripted demo sessions into a throwaway data dir, for the screenshots. |
| `hayden/evals/golden/upstream-*.txt` | Upstream's own composed prompts, captured from the pristine checkout. |
| `hayden/evals/live-eval.ts` | Synthetic-learner live eval: four scripted learners (correct, confidently wrong, interrupted, practice with a wrong first attempt) run through the app's real request path against your configured model, with a dollar cap and a turn cap, plus a free `--dry-run`. Refuses to spend without `--confirm-spend`. Adds a practice reveal screen: a hint after a wrong attempt that contains numbers found only in the committed solution. |
| `tests/hayden-*.test.ts` | 5 new test files ([results](03-results.md)). |

## Profile clauses and their evidence

| Clause | Grounding (all 13 citations were checked against publisher, PubMed or DOI-indexed records) |
|---|---|
| Measure despite credentials; move on once shown | Expertise reversal: techniques that help novices can hurt experienced learners (Kalyuga, Ayres, Chandler & Sweller 2003, *Educ. Psychol.* 38:23). Upstream's probe already measures; this keeps it from being skipped and stops re-teaching. |
| Predict / own words / counterexample / changed version | Testing effect (Roediger & Karpicke 2006, *Psych. Sci.* 17:249); self-explanation (Chi et al. 1994, *Cogn. Sci.* 18:439); failed retrieval attempts still help (Kornell, Hays & Bjork 2009, *JEP:LMC* 35:989). Upstream already does predict → check; the clause adds counterexample and changed-surface demands. |
| Confidently wrong → name it, contrast, repair the prerequisite | Hypercorrection: high-confidence errors are corrected more readily after feedback (Butterfield & Metcalfe 2001, *JEP:LMC* 27:1491). It complements upstream's `25-confidence.md`. |
| One step, one question; brief by default; no syllabus | Attention budget. This mirrors upstream's "one question per turn" and adds brevity and a no-overview rule. |
| Units, assumptions, law vs model vs convention; synthetic only; never invent sources | Accuracy for technical and clinical-adjacent material; it extends upstream's `15-accuracy.md`. |
| Resume point; "covered ≠ demonstrated"; no mastery because time ran out | Keeps a record of reasoning distinct from proof of mastery, which upstream also guards. |

**Already in upstream, so not duplicated:**
- the ~85% success band for practice difficulty (Wilson et al. 2019, *Nat. Commun.* 10:4646, a computational result)
- interleaving (Rohrer & Taylor 2007, *Instr. Sci.* 35:481)
- the predict → teach → check cycle
- the hint ladder
- the no-praise voice

**Why guardrails matter:** unguarded AI help raised practice scores but lowered later unassisted exam scores (Bastani et al. 2025, *PNAS* 122:e2422633122). A carefully designed AI tutor beat in-class active learning in a Harvard physics RCT (Kestin et al. 2025, *Sci. Rep.* 15:17458). Design decides which of those outcomes you get.

## FMEA: tutor failure modes (TG-100 style)

S = severity, O = likelihood, D = how hard it is to detect, each scored 1–10. RPN = S × O × D. Scores are judgment, not measurements.

| Failure mode | Effect | S | O | D | RPN | Control in this fork |
|---|---|---|---|---|---|---|
| Profile silently misses practice | Personalization doesn't apply where retrieval happens | 6 | 7 | 8 | 336 | Allowlist entry; tests assert the exact composition for all 3 agents **and** for the real handler request |
| Profile "off" leaves residue | Upstream behavior not restorable | 7 | 3 | 7 | 147 | Empty source segment; tests check byte equality with upstream goldens |
| Agent reads files outside study materials | Private data, credentials or patient data in the context | 9 | 4 | 6 | 216 | Study-folder boundary covering read/ls/find/grep/PDF; adversarial tests for traversal, `~`, symlinks and prefix tricks |
| Answer leakage in practice | Retrieval practice turns into reading | 7 | 4 | 5 | 140 | Profile defers to practice doctrine; scenario S4 checks no reveal before conclude (upstream UI also hides it; [see note](03-results.md#known-limitations)) |
| Fake mastery or inflated praise | Miscalibrated self-assessment | 6 | 5 | 6 | 180 | Profile + upstream voice; `checkTranscript` flags praise; the resume point lists only what was *demonstrated* |
| Invented citation or value | False beliefs in a safety-critical field | 9 | 4 | 7 | 252 | Profile + upstream accuracy rule; checker flags URLs/DOIs absent from research briefs |
| Session lost on interruption | Lost progress and context | 5 | 3 | 4 | 60 | Upstream persistence, unchanged; scenario S3 reloads from disk in a fresh request |
| Live model ignores the profile | Personalization has no effect | 6 | 5 | 8 | 240 | **Not controllable by fixtures.** Use `check-session.ts` on real sessions plus the 7-day retention protocol |
