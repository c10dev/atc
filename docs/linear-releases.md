# Linear Releases: Done means "in service", not "merged"

Today `Fixes ATC-n` moves an ATC issue to Done when its PR merges. Since MCC runs in `land+rts` mode, a merge is followed by RETURN TO SERVICE (RTS), and RTS can end in ROLLBACK. This draft asks whether Linear's Releases feature should say "Done" only after RTS succeeded.

> Status (2026-09-30): survey (ATC-182), draft. Idea: [#154](https://github.com/chaehy5665/atc/issues/154). Nothing is built. Nothing in the Linear workspace or in production was changed for this survey; Linear was only read.

Related: [mcc.md](mcc.md) (landing and RTS), [dispatch.md](dispatch.md) (AIRBORNE, HOLD), [schedule](occ.md) (CLOSE).

## 1. Current facts

Answers 1 to 5 of the issue. Line numbers are on `origin/main` at `0970fe1`.

### 1.1 Where atc treats an issue as finished, and what a `Merged` state of type `started` would do

Assume a new ATC state `Merged` with type `started`, entered when the PR merges, and Done entered when the release is recorded. atc reads the state **type**, not the name, in almost every place, so a `started` state is read as "still flying".

| Place | Rule today | With `Merged` (started) | Verdict |
|---|---|---|---|
| `DONE_STATES` (`server/dispatch.ts:295`) = completed, canceled, duplicate. Used by SCHEDULE (`schedule.ts:302,405,495,562,574,592,726,741,925`), NETWORK (`network.ts:95`), ROUTE (`routes.ts:111,119`), briefing blockers (`briefing.ts:110`), overlap (`overlap-run.ts:75`) | closed by Linear state type | a merged issue is "open" until Done | **changes** (mostly right, see the next rows) |
| DISPATCH `blockedBy` HOLD (`dispatch.ts:521`, `routes.ts:119`, `briefing.ts:110`) | a blocker is open until its type is in `DONE_STATES` | a dependent FLIGHT waits until the blocker is in service, not merged | **changes, on purpose**: HOLD gets safer (the dependent starts from a deployed base) but slower by one RTS (at most about 5 min plus RTS). If RTS is stopped after a ROLLBACK, the dependents wait for a person |
| `isFlying` (`dispatch.ts:321-324`, ATC-139): not in `DONE_STATES`, no LOGBOOK ARRIVED, no arrival report | not flying once merged: LOGBOOK ARRIVED covers it | unchanged, because the LOGBOOK and the arrival report already say it landed | **covered** (the ATC-139 fix does not depend on the Linear state) |
| Slot use, AIRPORT AIRBORNE load, file-overlap holders (`dispatch.ts:523,823,860`, `overlap-run.ts:75`) | use `isFlying`, or `DONE_STATES` in `overlap-run.ts` | `overlap-run.ts` alone would keep the merged FLIGHT's files as held until Done | **needs a change** (make it use `isFlying`, or accept it: a merged, not yet deployed FLIGHT still holds its files) |
| `tail:` holding checks (`dispatch.ts:581,634`) | `started` and not `landed` and needs a STAND | `landed` (LOGBOOK) excludes the merged FLIGHT | **covered** |
| Dispatch launch `open` (`dispatch-launch.ts:239`) | `started` and not `landed` | same | **covered** |
| `targetsOf` (`following.ts:162`) | a `started` FLIGHT with a `tail:` label is a target even without a proposal | a merged FLIGHT with a `tail:` label stays a target; later filtered by the arrived window (`following.ts:373`) | **needs a check** (small: the FLIGHT would stay in FOLLOWING as a target after ARRIVED) |
| `isClosed` (`following.ts:151`), used for the KEEP_ARRIVED filter (`following.ts:373`) | closed = completed, canceled, duplicate | a merged FLIGHT is not closed, so FOLLOWING keeps the row until Done | **changes** (row stays until RTS: acceptable, arguably wanted) |
| `merged-not-done` mismatch (`following.ts:225`) | PR merged but Linear not closed: info, "CLOSE draft target" | fires for every FLIGHT between merge and RTS | **breaks** (a permanent false mismatch for about 10 min, and every ROLLBACK). Needs `isClosed`-or-`Merged` |
| SCHEDULE CLOSE candidates (`schedule.ts:472,833,557-567`) | LOGBOOK ARRIVED and Linear not Done | a `Merged` issue is a CLOSE candidate at once; the CLOSE draft text says "In Review → Done" | **breaks / needs a change** (CLOSE must skip `Merged`, or become the release's job). CLOSE is not issued to OCC (`schedule.ts:98,629`, the SUPERVISOR closes by hand) so the effect is a SUPERVISOR-facing list |
| Alert `no-workspace` (`snapshot.ts:378`) | `started`, no worktree, not a parent: "in progress but no worktree" | **every merged FLIGHT raises it** once its worktree is removed | **breaks** (biggest one: an alert storm, and `alert-level.ts`, voice callouts and ANNUNCIATOR follow) |
| Alert `orphan` level (`alert-level.ts:21`) | completed or canceled → advisory, else caution | merged FLIGHT's leftover worktree becomes caution, not advisory | **needs a change** |
| Health stall (`health-flights.ts:38,41,51`) | `started` FLIGHT of a team: a stalled team with an open FLIGHT | merged FLIGHTs of a `tail:` team count as open work | **needs a change** (or it reports a team as holding a FLIGHT after it arrived) |
| Route map and phases (`routes.ts:108-115`, `network.ts:95-97`) | `started` → ACTIVE / `inProgress` (In Review and Ready to Merge → `inReview`) | `Merged` counts as in progress, by state type | **needs a change**: add `Merged` to `openPhase` by name, like `In Review` |
| Web: `aviation.ts:10-45` (`phaseByStateType`, `toneByStateType`), `fids-rows.ts:21-29`, `App.tsx:92` (in-progress count), `Map.tsx:225,242` | `started` → ENROUTE; only `completed` is ARRIVED | `Merged` shows as ENROUTE, is counted as in progress, and fills the RADAR/MAP; FIDS shows ARRIVED only after Done | **needs a change** (a name → phase entry, like `In Review`) |
| LOGBOOK (`logbook.ts`), `landedOf` (`dispatch.ts:350`), ON milestone | PR-based, not Linear-state-based | none | **covered** |
| OOOI IN (`milestones.ts:65-77`, `milestones-run.ts`) | first `ok` RTS whose target contains the merge commit, MCC AIRPORT only | unchanged; it becomes the source of truth for "Done" | **covered** (already computed) |

The short reading: a `started` `Merged` state is **not free**. Six places read the state type and would misread it (`no-workspace`, `merged-not-done`, CLOSE candidates, `orphan` level, health stall, `openPhase`/web phase), and at least three more need a look (`overlap-run`, `targetsOf`, `App.tsx` count). The fix each time is small, but it is a change to a wide, scattered rule ("a `started` issue is being worked on"), and every new place that reads `started` in the future has to remember `Merged`.

### 1.2 Release API

Read from Linear's Releases documentation (linear.app/docs/releases). Nothing was created.

- **State of the workspace (checked 2026-09-30 through the Linear MCP):** `list_release_pipelines` returns none. The ATC team has states Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate; there is no `Merged`.
- **Plan:** the docs say Releases need the Business or Enterprise plan (Business: up to 15 pipelines). The read tools answer on this workspace, but they do not show the plan, so **whether the workspace can create a pipeline is not proven by this survey**.
- **Continuous pipeline:** each deploy is one release. The open-source `linear-release` CLI (and its GitHub Action) scans the commits since the latest release for issue keys (`ATC-n`), creates a release, attaches the issues and completes it in one step. The release name and version default to the commit SHA. The CLI authenticates with a **pipeline access key** made in the pipeline's settings (a personal API key does not work).
- **Other ways:** GraphQL with the same access key, or the Linear MCP release tools (`save_release`, `list_releases`, `get_release`). The MCP tools use the user's OAuth login, so they belong to a session, not to a systemd unit. The CLI or GraphQL is what a unit can run.
- **Issues without `Fixes`:** the CLI looks for issue keys in commits, not for magic words, so `Part of ATC-n` and `Refs ATC-n` would be attached to the release too (to check on the first real run). Linear's status automation on release completion updates an issue with no linked PR, and an issue whose closing PR has merged with no open closing or contributing PR left. **An issue linked only to contributing PRs (`Part of`) is not updated**: it would be in the release but stay In Progress, which is the right thing.
- **A commit range with a revert:** unknown from the docs. The CLI reads commit messages, so a revert commit that names the same key attaches the same issue again. atc's own ROLLBACK does not create a commit (`git reset --hard` in `deploy/rts.mjs`, after the RTS attempt), so a ROLLBACK creates no release at all: what needs answering is a *PR* revert that lands and deploys, where the reverted issue would still be Done. To test on a throw-away pipeline before any decision.
- **Ordering:** the RTS range is `from..to` on `main`, several PRs at once (`rts.mjs:151-185`). One release would carry all the issues of the range, which fits a continuous pipeline.

### 1.3 Hook point in `deploy/rts.mjs`

- The success path is one line: `return log({ from, to: target, result: "ok", … })` (`deploy/rts.mjs:197`). It is reached only after `health()` (version and snapshot, `rts.mjs:104-117`) **and** `sessionsHealth()` (ATC-102, `rts.mjs:137-145`) both pass. A ROLLBACK goes past it to `git reset` and `result: "rollback"` (`rts.mjs:203-207`), so a hook placed just before the `ok` log never fires on ROLLBACK.
- The hook must be a `try/catch` that only `console.log`s a warning and writes an extra `rts.jsonl` field (for example `release: "recorded" | "skipped" | "failed"`), and must have its own timeout well under the unit's `TimeoutStartSec=400` (`atc-rts.service`). The lock is held until the end of `main()`, so a slow Linear call also delays the next RTS: keep it short (10 to 15 s) and run it after the `ok` line is logged (log first, release second).
- **Manual and automatic deploys share the path.** The UPDATE bar and the server's own `pass` both call `deps.startUnit()` (`server/update-run.ts:110,148`, `startRtsUnit`), and MCC does the same. All three start `atc-rts.service`, so one hook covers them all. A deploy done by hand outside the unit (for example a SUPERVISOR's `git pull` and restart) is not covered, and `planRts` refuses ranges that need a person (`package*.json`, `deploy/*.service`), which the SUPERVISOR deploys by hand: those would never be recorded.
- **The unit has no secrets.** `atc-rts.service` sets only `PATH`. `deploy/rts.mjs` has no dependencies and no Linear code (`rts.mjs:8`). A hook needs the CLI binary (or a `fetch` to GraphQL) and the key.
- **No release needed for an RTS that only restarts** (`plan.reason` "재시작만"): the range is empty; the hook skips it.

### 1.4 Key and tier

- **Where the key could live:** a systemd `EnvironmentFile=` with the file at `~/.config/atc/linear-release.env` (mode 600) or the existing `.env.local` pattern, outside the repository and outside the state folder that the UI reads. It is never printed: the hook passes it through the environment to a child process and never logs the command line. It is a **different key** from `LINEAR_API_KEY` (which the server reads through `server/config.ts:29` and the settings window `settings.ts:126`): the pipeline access key can only create releases.
- **Adding `EnvironmentFile=` to the unit is a `deploy/*.service` change**: `deploy/landing-tier.mjs` makes that `user` tier, `planRts` refuses a range that touches it (`NEEDS_USER`, `rts.mjs:16`), and a unit change needs a `daemon-reload`, so the SUPERVISOR deploys it by hand once.
- **Tier of the build: `user`** (`deploy/`, and a Git-automation and state-flow change in Linear). Any PR that also changes the state rules (`server/` phase code) is `flagged` on its own, but is bundled with the `user` part.
- **Linear side (not repository code):** creating the pipeline, its access key and any automation is done by the SUPERVISOR in Linear settings. atc's sessions do not write those.

### 1.5 State mapping (Git automation)

- The wanted flow: PR opened → In Review (exists today); PR merged → `Merged` (new, type `started`); release completed → Done (a release automation on the ATC pipeline).
- The Git automation is a **team setting** (Team settings → Workflow: "on PR merge → status"). The Linear MCP tools available to this survey (`get_team`, `list_issue_statuses`, `get_issue_status`) return the team's states, **not its automation rules**, so the current setting could not be read from here. From the observed behaviour (`Fixes ATC-n` moves the issue to Done at the merge; `docs/mcc.md` and the `merged-not-done` alert exist because it does not always do so), the "on merge" target is Done today. **The SUPERVISOR must read Settings → Teams → atc → Workflow before any decision.** Nothing was changed.
- Linear's own docs recommend exactly this shape ("a started Merged status on merge, and let a release automation mark the issue done once the change has landed") and note that release-completion automation ignores issues linked only to contributing PRs.
- ATC team only: the setting is per team, and the release pipeline can be attached to the ATC team only.

## 2. Principles

1. **Read before write, and never in production first.** Any Linear change (pipeline, state, automation) is made by the SUPERVISOR and first tried with a throw-away pipeline, not by an atc session.
2. **A release failure never fails an RTS and never blocks a deploy.** Warn, record, go on.
3. **ROLLBACK creates no release.** Done is claimed only after `ok`.
4. **atc's own truth stays in atc.** `rts.jsonl`, OOOI IN and LOGBOOK already say what is in service. Linear's state is a mirror for the SUPERVISOR, not an input that atc's DISPATCH depends on more than it does now.
5. **Do not widen "started".** If a new state is added, atc names it (as `In Review` and `Ready to Merge` are) instead of relying on its state type.
6. **Public repository.** The draft, the hook and the docs describe atc's own flow only.

## 3. Options

| | What | atc code | Linear |
|---|---|---|---|
| **A. Build** | Pipeline + release hook + `Merged` state + Git automation + release automation | hook in `rts.mjs`, unit `EnvironmentFile=`, name `Merged` in the ~9 places of 1.1, docs | pipeline, key, state, two automations |
| **B. Build partly** | Pipeline + release hook only. Keep Done at merge. Releases show which deploy carried an issue and when | hook and unit `EnvironmentFile=` only | pipeline and key |
| **C. Drop** | Keep Done at merge. Show IN and ROLLBACK in atc (OOOI, RADIO, ATC-123) | none | none |

B gives the "which release shipped this issue, and which issues a deploy carried" view, and it is enough for a ROLLBACK to be visible **as a missing release** (a merged issue with no release yet). It does not make Done mean "in service".

## 4. Implementation order (if built)

| # | Step | Tier |
|---|---|---|
| 0 | SUPERVISOR: check that the plan allows Releases, read the Git automation of the ATC team (1.5), create a throw-away continuous pipeline `atc (test)` and run `linear-release` once by hand on a scratch clone to answer the two open points in 1.2 (`Part of`, a PR revert in the range) | Linear only |
| 1 | `docs/linear-releases.md` becomes the adopted design (Status, decisions) | auto |
| 2 | Hook in `deploy/rts.mjs`: after the `ok` log only, own timeout, warn-only, `release` field in the `rts.jsonl` line, a pure `releaseStepOf()` tested with `node:test`; unit `EnvironmentFile=` | user |
| 3 | SUPERVISOR: create the real ATC pipeline and key, deploy the unit by hand (`daemon-reload`) | user |
| 4 (option A only) | Name `Merged` in `openPhase`, `aviation.ts`, `no-workspace`, `orphan` level, `merged-not-done`, CLOSE candidates, health stall, `overlap-run` (1.1); tests for each | flagged |
| 5 (option A only) | SUPERVISOR: add the state `Merged`, switch the merge automation to `Merged`, add the release automation | Linear only |
| 6 | `docs/guide/` usage page, CHANGELOG fragment, `docs/mcc.md` "as built" | auto |

Steps 4 and 5 must land together: adding the state before the code raises alerts, and adding the code first is harmless.

## 5. Risks

- **A `started` state is misread** in about nine places (1.1). This is the largest cost and it stays as a maintenance cost for every future reader of the state type.
- **DISPATCH HOLD slows down.** Dependents wait for RTS. If RTS stops after a ROLLBACK, every `Merged` issue stays `Merged` and its dependents stay held until a person acts. In `land+rts` mode that is rare but not zero.
- **Issues stuck in `Merged`.** RTS refused for `package*.json` or unit changes (`NEEDS_USER`), a failed release call, a range deployed by hand: the issue never becomes Done without a person. There is no atc job that tidies this today; it would need a "stuck in Merged" alert.
- **Release call on the RTS path.** A hung call delays the RTS lock. Mitigated by a short timeout and by running it after the `ok` log.
- **Key handling.** A second secret on the host, read by a unit that today has none. A leak allows creating releases only (not reading or writing issues), which is a small blast radius.
- **Plan and cost.** Releases need Business or Enterprise. Unknown for this workspace.
- **Revert ranges** are unverified (1.2).
- **atc is public.** Nothing here names another team's deploy; the pipeline name and the key never appear in the repository.

## 6. Decisions (for the SUPERVISOR)

Recommendation: **B, build partly; drop the `Merged` state (do not build A).**

1. **Does the workspace's plan allow Releases, and what does the Git automation of the ATC team do on merge today?** These two answers decide go or no-go, and only the SUPERVISOR can read them. If Releases are not available, the answer is C (drop) and nothing else is left to decide.
2. **`Merged` state: no.** It buys "Done means in service" at the price of widening `started` in about nine places, a slower HOLD and issues that can stick in `Merged`. atc already shows IN and ROLLBACK (OOOI, ATC-123; RADIO), so the SUPERVISOR who wants "is it in service" can read it in atc. Revisit only if someone outside atc must read Linear alone.
3. **Release record after RTS `ok`: yes, if 1 allows it.** Small (one hook, one env file, a unit line), warn-only, and it gives Linear a release list and a visible gap on ROLLBACK. Do step 0 first.
4. **Where the key lives:** a `EnvironmentFile=` outside the repository, mode 600, separate from `LINEAR_API_KEY`. The unit change is `user` tier and is deployed by the SUPERVISOR by hand.
5. **Manual deploys:** the UPDATE bar and MCC already share `atc-rts.service`, so they are covered. Hand deploys outside the unit are not recorded; accepted.

PILOT'S DISCRETION (this survey): the doc is English only (a new design document, `CLAUDE.md` "계획과 아이디어"); no CHANGELOG fragment (no behaviour change); the options table (section 3) was added to make the recommendation readable; "Merged" is used as the state's name only as a working name.
