# Does the profile help *you* learn? A 7-day n-of-1 check

The deterministic suite proves the profile reaches every agent and that upstream behavior is otherwise unchanged. It can't show the profile improves learning; only your delayed performance can. This protocol measures that with the least effort that still gives an honest answer.

## Design (one pair at a time)

1. **Pick two comparable concepts** of similar difficulty that you don't yet hold. The three templates work, and so does anything you write held-out items for *before* the session.
2. **Flip a coin** to decide which concept gets the profile. Run `npx tsx hayden/profile.ts on` or `off` before that session.
3. **Pre-test (2 min):** answer that concept's held-out items cold. Score each 0/1/2. Don't look at the key yet.
4. **Session:** a normal-length session from the template starter. Stop whenever you like. Stopping is part of what gets tested.
5. **Score the transcript:** run `npx tsx hayden/evals/check-session.ts <chatId>`. It reports rule violations (more than one question per turn, praise, a missing resume point on stop, sources not taken from a research brief, patient-identifier patterns) and the median words per turn.
6. **Day 7:** answer the same held-out items cold again, then score them against the key.
7. Log one row in `results.csv`: `date,concept,profile(on/off),pre,day7,gain,violations,median_words,notes`.

## Reading the result

- **Gain** = day-7 score minus pre-test score. Compare the profile-on and profile-off gains across pairs.
- After **4 or more pairs**, report the mean gain difference with the per-pair values. Don't report a p-value; n is far too small. Treat it as a signal for whether to keep, edit or switch off the profile.
- Changing the profile text resets the comparison. Edit it in Settings → Agent → Prompts, or edit `hayden/learner-profile.md` and run `on --force`.

## Why this design

- **Delayed, cold, changed-surface items** measure what lasted. Performance during practice overstates learning: blocked practice scores higher during practice but worse a week later (Rohrer & Taylor 2007; Roediger & Karpicke 2006), and unguarded AI help raised practice scores while lowering later unassisted exam scores (Bastani et al. 2025, *PNAS*).
- **The pre-test isn't wasted.** An unsuccessful retrieval attempt makes later learning stronger (Kornell, Hays & Bjork 2009). The pre-test is the same in both arms, so it doesn't bias the comparison.
- **Seven days** sits within the spacing range where a 1-week test still rewards real consolidation (Cepeda et al. 2008).
