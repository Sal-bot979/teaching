# Rollback

Choose the smallest step that fits.

1. **Turn the profile off; keep everything else.** Run `npx tsx hayden/profile.ts off`, or flip the `shared/90-learner-profile.md` toggle in **Settings → Agent → Prompts**. Every agent's prompt then matches upstream exactly, apart from the two study-folder sentences. `tests/hayden-profile.test.ts` pins this. The override file stays on disk; delete `<data dir>/prompts/shared/90-learner-profile.md` to remove it.
2. **Widen file access back to upstream's home-directory scope** (not recommended): start the app with `LH_STUDY_DIR="$HOME"`. Upstream's prompt wording isn't restored by this, and the boundary still blocks symlinks that escape `$HOME`.
3. **Revert the code changes:**
   - Profile only: `git revert caa84f0` and the commits after it.
   - Boundary only: `git revert f844e04`.
   - Back to pure upstream: `git checkout 0a60044 -- learnharness`.
   - The full patch is `docs/fork.patch`; `git apply -R docs/fork.patch` inside a matching checkout undoes it.
4. **Use upstream directly:** clone `https://github.com/amosblomqvist/learnharness` at `b277ee3`. Your data directory (`LH_DATA_DIR`, default `learnharness/data/`) stays compatible, because the fork changes no record formats.
