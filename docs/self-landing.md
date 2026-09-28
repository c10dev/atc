# SELF-LANDING design (draft)

**English** · [한국어](self-landing.ko.md)

atc merges and deploys its own PRs. AUTOLAND ([occ.md](occ.md) 9.7) lands PRs in other repositories (vocado, AIRPORT `VCDO`) and does nothing after the merge. SELF-LANDING lands PRs in the atc repository (AIRPORT `ATCC`). The merge changes the code of the controller itself, so it must be followed by a deploy (fast-forward the service checkout, restart the service), a health check, and a way back when the new build is broken.

> Status: steps 1 and 2 built (shadow, 2026-09-28). The SUPERVISOR accepted all five proposals (see "Decisions" at the end). Steps 3–5 are not built yet.

Related: [occ.md](occ.md) 9 (CLEARED TO LAND, AUTOLAND, external review), `deploy/landing-tier.mjs` (LANDING CLEARANCE tiers), root `CLAUDE.md` "git과 PR" (who merges what), [fleet.md](fleet.md) 8.6–8.7 (the shadow → approval pattern this design reuses).

## 1. Current facts (2026-09-28)

| Fact | Value |
|---|---|
| How atc PRs land today | A team session opens the PR. The structure session runs its landing skill: `review.sh` (detached worktree at the exact head: `npm test`, tsc, vite build; tier; CI `check`; mergeable; not draft), then reads the diff itself. `READY (auto\|flagged)` → `gh pr merge --merge --match-head-commit <sha>`, then `deploy.sh`, then `sync.sh` (conflicts of other open PRs). `user` tier → the user merges. The skill lives outside this repository |
| `deploy.sh` | Refuses when the service checkout has local changes, `git merge --ff-only origin/main`, `systemctl --user restart atc`, waits up to 20 s for `GET /api/version`, prints the head. No rollback |
| Service | systemd user unit `atc` (`deploy/atc.service`): `ExecStartPre` builds the screen (`node --run build`), `ExecStart` runs `node server/index.ts`, `Restart=on-failure` after 5 s |
| Branch protection on `main` | required status check `check` (CI: npm test, tsc, vite build, tier summary), `strict: false` (a PR does not have to be up to date with main) |
| Merges since 2026-09-25 | 60 PRs, all merged by the owner account (by the structure session or the user). By tier: `auto` 29, `flagged` 16, `user` 15. No PR was reverted |
| CLEARED TO LAND for atc PRs | never reached: every atc PR is `APPROACH` with `no-review`. Codex does not review this repository, and the external review (DeepSeek REVIEW) excludes PRs without a FLIGHT, which most atc PRs are (AD HOC) |
| AUTOLAND | `mode: merge`, `airports: ["VCDO"]`. The config comment says atc's own landing is out of scope |
| Public repository | anyone can open a PR from a fork |

## 2. How SELF-LANDING differs from AUTOLAND

| | AUTOLAND (VCDO) | SELF-LANDING (ATCC) |
|---|---|---|
| What it merges | another repository's product code | the controller's own code |
| Evidence to merge | CLEARED TO LAND: CI, a Codex or DeepSeek review on the head, no findings | CI, the structure checks done mechanically, and a review (Decision 2) |
| Delegated class | CLEARED minus exclusions (no FLIGHT, SEC/Risk, security paths, Human Preview) | LANDING CLEARANCE tier `auto` (Decision 3) minus exclusions (section 4) |
| After the merge | nothing | deploy, health check, rollback on failure |
| When it breaks | vocado main is red; atc sees it and latches a GROUND STOP | the lander itself may be what broke, so the way back must not depend on the atc server |
| Order | one action per AIRPORT every 90 s | one PR at a time, the next only after the deployed build is healthy |

## 3. Principles

1. **The lander is outside the server.** A small script run by its own systemd timer (`atc-lander`) does the merge, deploy, health check and rollback. The atc server only shows what the lander did. A broken server build cannot stop the lander from rolling it back. The lander lives in `deploy/`, which is `user` tier, so SELF-LANDING can never change its own rules.
2. **Same checks as structure, done on the merge result.** The lander builds `origin/main` merged with the PR head in a detached worktree and runs `npm test`, tsc and vite build there. Because `strict` is off, testing the head alone could miss a semantic conflict with main.
3. **A review must exist on the exact head** (source: Decision 2). No review, no merge, the same rule as CLEARED TO LAND.
4. **Narrow delegation.** Start with tier `auto` only. `flagged` (control-session manuals) and `user` stay with structure and the user.
5. **Deploy is part of landing.** A merge is done only when the new build runs: the service restarted, `/api/version` reports the new build, and smoke calls answer. Otherwise the lander rolls the service back and stops (SELF-LANDING GROUND STOP).
6. **One at a time, and quiet.** One PR per cycle, never while a FLEET PLAN approval is executing or an AUTOLAND update is in flight, and never twice for one head.
7. **Shadow first.** Like DISPATCH, SCHEDULE and FLEET PLAN, the lander first only records what it would do, next to what structure and the user actually did.

## 4. Delegated class and exclusions

A PR is delegated when all of these hold:

- base `main`, head branch in `chaehy5665/atc` itself (never a fork), authored by the owner account, not draft, no `hold` label;
- tier `auto` (`deploy/landing-tier.mjs` on the merge-base diff);
- CI `check` passed on the head;
- the local checks (principle 2) passed on the merge result;
- a review on the exact head with no P0 or P1 finding (Decision 2);
- none of the exclusions below.

Exclusions, whatever the tier says:

| Exclusion | Why |
|---|---|
| Landing and merge logic: `server/landing*.ts`, `server/autoland*.ts`, `server/origin.ts`, `server/settings.ts`, `server/fleet-plan*.ts`, `server/session-control.ts` | what decides merges, switches and session control; a mistake here widens its own permissions |
| Operational state format: a diff that adds or renames a file under the state directory, or changes an append-only record's line shape (the `*Op` / `RecordLine` types) | the root `CLAUDE.md` sends these to the user; hard to undo |
| A PR body with `SELF-LANDING: no` | lets the author keep a PR for a human |
| More than 1,500 changed lines | too large for a model review to be the only reading |

## 5. Cycle

The `atc-lander` timer runs every 5 minutes (`deploy/lander.sh`, pure decision part in `deploy/lander.mjs` with tests):

1. **Stop latched?** If `~/.local/state/atc/self-landing.json` has a GROUND STOP, do nothing.
2. **Mode.** `off` does nothing, `shadow` records, `merge` acts (the same file, set by the SUPERVISOR).
3. **Quiet?** Skip the cycle when FLEET PLAN has an `executing` proposal or AUTOLAND has an update in flight (read from `GET /api/fleet/plan` and `GET /api/autoland`; if the server does not answer, skip).
4. **Pick.** The oldest delegated PR, re-reading its head right before acting.
5. **Check.** Detached worktree of `origin/main` merged with the head: test, tsc, build.
6. **Shadow:** write `{op: "would-merge" | "would-skip", pr, head, reasons}` and stop here.
7. **Merge** (`merge` mode): `PUT /pulls/{n}/merge` with `sha` = the checked head and `merge_method: merge`, the REST form of `--match-head-commit`. Never GitHub auto-merge.
8. **Deploy:**
   1. Note the running build (`/api/version`).
   2. `git merge --ff-only` in the service checkout, `systemctl --user restart atc`.
9. **Health check.** Within 60 s all of the following must hold, and 5 minutes later the unit must not have restarted again (`NRestarts` unchanged):
   - `systemctl is-active` is `active`;
   - `/api/version` answers with a new `build` and a later `startedAt`;
   - `GET /api/snapshot`, `/api/fleet` and `/api/fleet/plan` answer 200.
10. **Roll back** when the health check fails:
    1. `git reset --hard <previous head>` in the service checkout, restart, check again.
    2. Latch the GROUND STOP with the PR, the reason and the logs.
    3. Open a `Revert "…"` PR against main for the user.
    4. Write `rollback`.
11. **Record.** Each step is a line in `~/.local/state/atc/self-landing.jsonl` (append only), and each merge and rollback also goes to the FLIGHT RECORDER (`kind: "self-landing"`). The LANDING SEQUENCE header shows the lander's line for ATCC, the same way AUTOLAND shows one for VCDO.

## 6. Implementation order

**Built (steps 1 and 2, shadow, 2026-09-28).** `deploy/lander.mjs` (pure decision and I/O, tests in `deploy/lander.test.mjs`), `deploy/atc-lander.service` and `.timer`, `server/self-landing.ts` (`GET /api/self-landing`) and the SELF-LANDING line in the STRIPS LANDING SEQUENCE header. Details settled while building:

- **Mode.** No state file means `shadow`. `merge` is not built yet, so it runs as shadow.
- **Once per head.** Each head is judged once. When the PR ends, an `outcome` line records `merged-as-is` (merged at the judged head), `merged-changed` or `closed`.
- **Local checks** run only when nothing but the review is missing. `readyExceptReview` marks a `would-skip` whose only reason is the missing review, so the shadow data is useful before step 3.
- **Gate counting.**
  - Agree: `would-merge` and merged as-is; or `would-skip` and closed, changed, or not tier `auto`.
  - Refused: `would-merge` on a PR that was closed or changed.
- **Review.** For now the lander counts only the landing-review records (`landing-reviews.jsonl`). atc PRs have none until step 3, so every judgment is `would-skip` until then.
- **First run on 2026-09-28:** #105 (docs) was `would-skip` for the missing review only. The local checks on the merge result passed in 10 s, and nothing was left behind.

1. ✅ `deploy/lander.mjs`: pure decision (delegated class, exclusions, next action), with tests. Shadow records only.
2. ✅ The `atc-lander` systemd service and timer (they run `deploy/lander.mjs` directly, no `lander.sh`); state file and records; ATCC line in the LANDING SEQUENCE header.
3. Review source for atc PRs (Decision 2).
4. Health check and rollback, tried first against a test instance on 7702 with a deliberately broken build.
5. `merge` mode behind the switch, after the shadow gate (Decision 5).
6. Later and separately: `flagged` tier.

Steps 1, 2, 4 and 5 change `deploy/`, so their PRs are `user` tier.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A bad merge breaks the controller | health check with a 5-minute watch, rollback done by the lander outside the server, latched GROUND STOP |
| SELF-LANDING widens its own permissions | the lander and the tier rules are in `deploy/` (`user` tier); landing and switch code are excluded (section 4) |
| A fork PR from the public repository | only branches in this repository by the owner account |
| Main moved since CI ran (`strict` off) | local checks on the merge result, not only the head |
| Restart interrupts work in progress | quiet window (FLEET PLAN executing, AUTOLAND in flight); one PR per cycle |
| Someone runs `deploy.sh` by hand after a rollback | the service goes back to the bad head. The GROUND STOP message says to merge the revert PR first. `deploy.sh` should also refuse while the stop is latched (a `user`-tier change to the skill) |
| A model review misses what a person would catch | tier `auto` only, size limit, shadow comparison with structure's decisions before `merge` |
| Rate of change | 29 of 60 recent merges were `auto`; about ten a day would land without structure |

## 8. Decisions (2026-09-28, SUPERVISOR: all as proposed)

1. **Where the lander runs.** Decided: a separate systemd timer and script in `deploy/`, outside the atc server. Alternative: inside the server, next to AUTOLAND (simpler, but a broken build cannot roll itself back).
2. **Review source for atc PRs.** Decided: the DeepSeek REVIEW session also reviews atc PRs without a FLIGHT (the repository is public, so there is no confidentiality reason to exclude them), and a pass with no P0 or P1 on the exact head counts. Alternatives: the structure session posts a GitHub approval after its own check, so the lander only automates merge and deploy; or no review, CI and local checks only (not proposed).
3. **Scope.** Decided: tier `auto` only; `flagged` decided later from shadow data.
4. **On a failed deploy.** Decided: roll the service back to the previous head, latch a GROUND STOP, open a revert PR for the user. Alternative: also merge the revert PR itself.
5. **Shadow gate.** Decided: 20 PRs where the lander's `would-merge` / `would-skip` matches what structure and the user did (merged as-is vs changes asked or kept for a human), at least 90% agreement, and no `would-merge` on a PR structure refused.
