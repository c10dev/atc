# Autonomy: taking the SUPERVISOR out of the per-PR merge path

**English** · [한국어](autonomy.ko.md)

Status (2026-10-01): design draft for [ATC-333](https://linear.app/vocado/issue/ATC-333). The SUPERVISOR decided on 2026-10-01 that they set direction (ROUTEs, priorities, what to build) and do not read PRs, and agreed to keep exactly three human gates (section 2). Nothing in this document is built; what already exists is listed under "Current facts". No row below is marked done; DUTY or ENGINEERING update the status after merge.

Related: [occ.md](occ.md) 9.7 (AUTOLAND), [mcc.md](mcc.md) (MCC, tiers, SHIP / SHOW / ASK), [research/code-review.md](research/code-review.md) (the ATC-332 survey, source of most numbers here), [watch.md](watch.md) (on hold), [duty.md](duty.md) (L0–L4), [fleet.md](fleet.md), [dispatch.md](dispatch.md), [atfm.md](atfm.md).

## 1. Current facts

Re-read from `origin/main` and read-only logs on 2026-10-01 ~17:30Z. Counts only; other AIRPORTs are described generically. Labels: *[observed]* from atc's logs or GitHub, *[replay]* an atc rule re-run on merged PRs, *[assumed]* my reasoning. The survey ([research/code-review.md](research/code-review.md)) has the outside evidence.

### 1.1 The merge path

- **AIRPORT A (the AUTOLAND AIRPORT).** In 7 days to 2026-10-01: 121 PRs merged, 0 closed unmerged, about 117 merged by hand and 4 by AUTOLAND; median 150 min from open to merge, p90 45 h [observed, survey 2.2–2.3]. On 2026-10-01 the SUPERVISOR switched `reviewedSecurity` to `delegate` (16:25Z), turned off "Require branches to be up to date" and pointed `applicationCheck` at the build check. Before that, about 40 PRs a day were merged by hand and one by AUTOLAND. A rule of the security gate fires on 79% of merged PRs by replay (keyword alone 42%) [replay]. CLEARED PRs still left to the SUPERVISOR are held by `Risk: Contract` labels (2) and a security keyword with no merge review yet (1) [observed, ATC-333 text].
- **ATCC (atc itself).** MCC lands `auto` and `flagged` PRs in `land+rts` mode: 134 landed in 7 days, median 5 min from open to merge; INSPECTION found findings on 8% of heads; 28 ESCALATE rows on 27 PRs went to the SUPERVISOR (`user` tier and state-format changes) [observed].
- **Other AIRPORTs.** Some have no lander: the SUPERVISOR or a delegated session merges by hand ([mcc.md](mcc.md), [occ.md](occ.md); counts not re-measured here).
- **Merged since the survey:** the migration gate (ATC-329: a migration PR is delegable once every new version is applied on the hosted database), GROUND STOP matching workflow names plus a warning when the name matches nothing (ATC-330), and a grace window for a CLEARED PR left to the SUPERVISOR (ATC-331).

### 1.2 Safety nets today

- **Before merge:** CI; four review lanes (Codex, REVIEW, MCC INSPECTION, AUTOLAND merge review), each bound to the exact head; the deterministic exclusions; GROUND STOP, which stops AUTOLAND on a red `main`.
- **After merge on atc:** RTS with a health check and ROLLBACK.
- **Missing** (what this document asks for): an automatic revert of the PR that turned `main` red; a post-deploy check and rollback on AIRPORTs; a second reviewer independent of the first; a classifier that reads the diff instead of keywords; a weekly escaped-defect report; a breaker that tightens the gates by itself; `main` lint and tests on every push on the AIRPORT so GROUND STOP sees test failures.
- **Baseline of defects let through** (survey): 2 of 118 `main` heads red (1.7%) on AIRPORT A, no revert or hotfix PR, no PR closed unmerged, in 7 days. Small numbers: a baseline to watch, not proof that gates catch nothing.

### 1.3 Other human decisions logged

Counts since the logs start on 2026-09-26 (about 5.5 days) [observed]:

- DISPATCH: 414 ASSIGN proposals, 315 approvals (285 by a click, 30 by CROSSCHECK agreement), 7 rejections; CROSSCHECK verdicts 73 agree, 17 disagree; 89 LAUNCH approvals, all by the SUPERVISOR.
- FLEET PLAN: 5 approvals (LAUNCH or REFRESH), 15 expired. SCHEDULE: 28 drafts, CROSSCHECK verdicts on 26.
- Clearances: 513 issued (326 INFO, 90 GO AROUND, 68 LAND, 23 FIX); they run between sessions and need no person.
- RTS: 8 refused (4 for `package*.json` or a systemd unit, 4 for CI not ready or absent), 146 ran. HUMAN CHECK: 1 record.

### 1.4 What the inventory found about the SUPERVISOR-only rule

The routes that only the SUPERVISOR may call check a localhost `Origin` (`fromThisApp`), and `atcctl` has no command for them. Reading the routes found some without that check: DISPATCH approve and reject of a non-LAUNCH card, the DISPATCH and SCHEDULE mode switches, SCHEDULE approve and reject, and the ATFM routes (`proposals.ts`, `schedule.ts`, `atfm-run.ts`; also noted in [watch.md](watch.md) and [fleet.md](fleet.md)). They are SUPERVISOR-only because no control session has a command and the guards block `curl`, not because the server refuses. That matters here because the autonomy rules (K3) must hold against a session that finds another way to reach `7700`; hardening is control C12 and a decision in section 10.

## 2. The three gates that stay

Exactly as decided by the SUPERVISOR on 2026-10-01. This document does not change them; where the analysis suggests a change, it is a question in section 10. They are called K1 to K3 ("kept") so that they are not mixed up with the DUTY card buttons G2 (MERGE) and G3 (state move) in [duty.md](duty.md).

1. **K1: applying migrations to a hosted database, or changing live data.** A merge can be reverted; lost data cannot.
2. **K2: secrets and keys (`.env`, credentials), payment or legal text, and content rights (`Risk: Rights`).** These are about outside responsibility, not code quality.
3. **K3: atc's own guards, permissions, `.claude/` settings and the autonomy rules themselves** (the files that decide what sessions may do, including the AUTOLAND, MCC and landing-tier rules). An agent never approves a widening of its own limits.

## 3. Principles

1. **The SUPERVISOR sets direction.** Their time goes to ROUTEs, priorities, a weekly quality report and three kinds of approval, not to reading PRs.
2. **A control lands before its gate leaves.** No step may leave a window in which neither the gate nor its control exists. A gate is removed only after its control has run in shadow and a stated measurement said go.
3. **Tighten fast, loosen slowly.** The system may tighten a rule by itself (the breaker, control C6); loosening needs the SUPERVISOR. K3 follows from this: nothing the system runs may approve its own widening.
4. **Irreversible things stay human, reversible things get a revert.** K1 and K2 are the irreversible ones; for everything else the answer to a missed defect is a revert that lands quickly, not a person reading first.
5. **Independence, not repetition.** Two reviews help only if their errors differ: different vendor or model, different instructions, no sight of each other. Outside evidence says errors correlate (the same wrong answer 60% of the time, survey 1.2), so the number to watch is agreement, and a sample is audited by a third reviewer.
6. **PR text is input from an untrusted writer.** A classifier or reviewer reads the diff; the PR body and labels are hints that may raise the risk, never lower it.
7. **Everything is head-bound, logged and counted.** Every automated verdict names the head it judged, is stored, and shows up in the weekly report.
8. **Shadow first, then switch.** Each control runs next to the old gate and writes what it would have done; the measurement that decides the switch is written down before the run.
9. **Brakes are not gates.** The SUPERVISOR keeps HOLD, a manual GROUND STOP, CANCEL, RECALL and the mode switches as brakes. Nothing waits for them, so they stay.
10. **Direction is not a gate.** Choosing ROUTEs and priorities, moving an issue from Backlog to Todo, labelling an idea and the DUTY charter are inputs that say what to build. Nothing in the PR path waits for them.

## 4. Gate inventory

Every place where atc requires or offers a human decision, grouped by area (a sub-agent read the docs and routes; I checked the landing rules against `server/landing.ts` and `server/autoland.ts` and the counts against the logs). "7 days" is a count where a log exists; "not logged" means no record exists for the gate. Verdicts: **keep** (only K1, K2, K3), **automate** (the gate becomes a machine decision, its control named), **remove** (the gate disappears once its control runs), **brake** or **direction** (not a gate, see principles 9 and 10). The control column names a control from section 5; it lands before the verdict takes effect (section 8 gives the order).

### 4.1 Landing and merge

| ID | Gate · where | Protects against | 7 days | Verdict | Control that lands first |
|---|---|---|---|---|---|
| L1 | `Risk: Contract` and `Risk: Security` labels, ticket or PR (`mergeExclusionOf`, `externalGateOf`; `autoland.ts`, `landing.ts`) | A contract or security change merging on a single review | 2 CLEARED PRs held today; replay found 0 PR labels in 121 merges (ticket labels not readable offline) | **automate** | C1 dual review, C2 classifier, C4 auto-revert, C6 breaker, C7 audit |
| L2 | `rating:SEC` ticket label (same functions) | SEC work merging without extra care | not logged | **automate** | C1, C2, C4, C6, C7 |
| L3 | Security paths: auth, session, RLS and policy, admission, functions, middleware (`securityPathOf`) | Access-control changes merging unseen | replay: 44 of 121 merged PRs (36%) | **automate**: the path becomes an input to C2; secret paths and migration paths follow L5 and L6 | C1, C2, C4, C6, C7 |
| L4 | Security keywords in PR or FLIGHT text (`securityWordOf`, `SECURITY_WORDS`) | A security change described in words | replay: 94 of 121 (78%), keyword alone 51 (42%) | **remove**, once C2 shadow flags every PR the keyword caught that a person would have wanted | C2 diff-aware classifier (shadow two weeks), C1 |
| L5 | Migration and SQL paths (`migrationPathOf`; `hostedDb` migration gate, ATC-329) | A migration merging before it is applied on the hosted DB | replay: 19 of 121 (16%) | **keep** (K1) as a one-click approval; already automatic when every new version is applied; an edited, deleted or renamed existing migration stays a K1 approval | C9 one-click approval |
| L6 | Secret and key paths (`secretPathOf`: `.env*`, credentials, keys, certificates) | Credentials entering the repository | replay: 0 of 121 | **keep** (K2) as a one-click approval | C9 |
| L7 | `Risk: Rights` label, payment or legal text | Outside responsibility (K2) | not logged | **keep** (K2) | C9 |
| L8 | No FLIGHT on the PR (`gate.hard`) | A change nobody asked for; no traceability | not logged | **automate** | C15 FLIGHT linkage (DUTY or DISPATCH links or opens the FLIGHT; a PR with none goes to DUTY, not to the SUPERVISOR) |
| L9 | 100 or more files, or an unreadable file list (`mergeExclusionOf` step 5) | A diff too large to judge | not logged | **automate** | C1 with the full tier (more reviewers, whole-diff packet), C7; size hint W7 of the survey |
| L10 | HUMAN CHECK classes CHOICE, ACCOUNT, DEVICE (`human-check.ts`, `/api/human-check`) | A UI change a person must judge | 1 record | **automate**: CHOICE behind a flag or preview, DEVICE by a device smoke run, ACCOUNT unless it touches K1 or K2 | C10 verifier lane with evidence pack, C4, C6 |
| L11 | MCC ESCALATE (`mcc-run.ts`, `docs/mcc.md`): a model raising a PR to `user` | Doubt, state-format changes, hard-to-revert changes | 28 rows on 27 PRs | **automate** for additive state-format changes and reversible changes; **keep** where the PR touches K3 (L12) | C13 format-compat check, C1, C4 |
| L12 | Landing tier `user` for guards, hooks, `.claude/`, root `CLAUDE.md`, `rulebook/`, `*guard*.mjs`, `deploy/landing-tier.mjs` (`landing-tier.mjs`) | A session widening its own limits | included in the 28 above | **keep** (K3) | C9, C12 |
| L13 | Landing tier `user` for `.github/`, `package*.json`, `deploy/` units | A change to CI, dependencies or service units landing unseen | included in the 28 above | **keep** (K3) for `.github/` and `deploy/` units, **automate** for `package*.json`; where K3 ends is question D6 (a to c) | C12 for the kept part; C16 dependency review for `package*.json` |
| L14 | MERGE click (DUTY G2): the SUPERVISOR merges a `user`-tier PR (`pr-merge-run.ts`, `mergeVerdictOf`) | Merging a wrong or stale head | not logged separately | **keep** for K3 PRs (it is the one-click approval, C9); **remove** for the rest as L11 and L13 narrow | C9 |
| L15 | GROUND STOP clear: the SUPERVISOR clears a latched stop (`autoland-run.ts`, ATC-330) | Merging onto a broken `main` | 0 latches | **automate**: a green head after the revert clears it | C3 main tests, C4 auto-revert, C6 |
| L16 | Review lane availability: Codex limit or exclusion leaves PRs unreviewed (`landing.ts`) | A PR with no review | 11 of 13 re-review requests went to REVIEW | **automate** (already a fallback lane) | C1 gives a second lane; spend caps C11 |
| L17 | Stacked PR and STRANDED alerts the SUPERVISOR fixes by hand (`docs/occ.md`) | A merge that never reached `main` | not logged | **automate** | C4: the revert and landing lane also retargets or rebases a stacked PR when its base merges |
| L18 | RELAY by hand for GO AROUND or FIX with no STAND holder (`supervisor-queue.ts`) | A notice going nowhere | 14 relay rows | **automate** | C15: DUTY takes the case and opens or reopens the FLIGHT; a rare case |
| L19 | Mode switches: AUTOLAND `off/update/merge`, `reviewedSecurity`, MCC mode, `teamsMerge`, `hostedDb`, `externalReview.security` (settings window) | Delegating merges without consent | 1 switch (delegate) | **keep** (K3): the SUPERVISOR chooses how much autonomy exists; the breaker (C6) may only tighten | C6 |
| L20 | HOLD on a PR (AUTOLAND and MCC), CANCEL, RECALL | Stopping something wrong | 2 HOLD rows | **brake** | none needed |

### 4.2 Deploy

| ID | Gate · where | Protects against | 7 days | Verdict | Control |
|---|---|---|---|---|---|
| D1 | UPDATE bar click to start RTS (`update-run.ts`) | Deploy timing | most deploys are automatic in `land+rts`; clicks not separated | **remove** (nothing waits) | RTS health check and ROLLBACK, already built |
| D2 | RTS refusal for `package*.json` dependency changes (`deploy/rts.mjs`) | Unattended `npm ci` | 4 refused (with units) | **automate** | C16 dependency review as a required check, then `npm ci` inside RTS with the health check and ROLLBACK |
| D3 | RTS refusal for `deploy/*.service` units (`daemon-reload`) | A service unit changing what runs and with what power | included above | **keep** (K3: it sets what the service may do) | C9 |
| D4 | RTS stays off after ROLLBACK until the SUPERVISOR picks the MCC mode again (`docs/mcc.md`) | A rollback loop | 0 rollbacks | **keep** (K3, it is the deploy breaker; loosening is the SUPERVISOR's) | C6 |
| D5 | Killed sessions relaunched by hand after a deploy | Lost work | 0 | **automate** | C16 relaunch of the sessions the health check finds killed (CONTROL RECYCLE style); the 3-condition check already detects it |
| D6 | AIRPORT deploys: no post-deploy check exists | A bad deploy of an AIRPORT | n/a | **control missing** | C5 post-deploy check and rollback where the host supports it |

### 4.3 DISPATCH, FLEET, SCHEDULE

| ID | Gate · where | Protects against | Count | Verdict | Control that lands first |
|---|---|---|---|---|---|
| P1 | ASSIGN, RELEASE, CLASSIFY approve or reject (`proposals.ts`; [dispatch.md](dispatch.md)) | A wrong AIRCRAFT-FLIGHT pairing | 315 approvals, 285 by click, 7 rejections | **automate** | C14 CROSSCHECK agreement plus the existing blind sample, C11 caps |
| P2 | LAUNCH card approval (`proposals.ts`, Origin) | Starting a session that spends usage | 89, all by the SUPERVISOR | **automate** | C11 spend caps (FUEL hold, `ATC_MAX_LAUNCHED`), C14 |
| P3 | FLEET PLAN approve and verdict (`fleet-plan-run.ts`) | Usage spend, stale proposals | 5 approvals, 15 expired | **automate** reversible kinds first (STOP of an idle session), then LAUNCH under caps | C14, C11 |
| P4 | CREW CHANGE approve and "delivered" (`crew-change.ts`) | Changing a running team's crew without consent | not logged | **automate** | C14 |
| P5 | SCHEDULE op approve, reject, verdict (CLASSIFY, NEW, CLOSE, TAIL, WAYPOINT; `schedule.ts`) | Wrong ticket edits | 28 drafts, 30 agree and 9 disagree CROSSCHECK verdicts | **automate** | C14 |
| P6 | UNDELIVERED FLIGHT PLAN and CLEARANCE hand delivery | A message that could not be delivered | 10 undelivered rows | **automate** | C14: retry of the delivery and a DUTY alert when it still fails |
| P7 | NEEDS YOU: a session blocked on a tool approval prompt | A session waiting on a permission decision | alerts, not counted here | **keep** (K3: a permission) for the prompt; a blocked question about direction is a **direction** input | C9 |
| P8 | SUPERVISOR CONFIRM AT AIRCRAFT (go for a `user`-tier FLIGHT) | A `user`-tier FLIGHT proceeding without a go | 1 row | **keep** (K3) | C9 |
| P9 | DISPATCH, SCHEDULE, FLEET PLAN, ATFM, CONTROL RECYCLE, FUEL hold, REPOSITION, JEV, SQUELCH mode switches | Turning automation on before it is measured | 1 judges mode row | **keep** (K3) | C6 |
| P10 | ATFM switches and `s3` | Auto-actions before the shadow week | not counted | **keep** (K3) | C6 |
| P11 | ATFM manual GROUND STOP, GROUND DELAY | Stopping departures by hand | not logged | **brake** | none |
| P12 | ADD ACCOUNT, LOGIN, SHARE MEMORY (`accounts-run.ts`) | Credentials | not logged | **keep** (K2) | C9 |
| P13 | CHECKRIDE rating grant (SEC ratings decide who may take SEC work) | A team getting a permission by a recommendation | not logged | **keep** (K3) grant, revoke is a tightening; **question** D6 | C9 |
| P14 | Workspace trust prompt, one time per repository | A session in an untrusted folder | not counted | **keep** (K3) | none |
| P15 | LAUNCH, STOP, AOG, RETIRE, ENTRY of AIRCRAFT by hand | Fleet shape and usage | FLEET PLAN counts above | **direction** (fleet design) | none |

### 4.4 Direction, DUTY and guards

| ID | Gate · where | Protects against | Count | Verdict | Control |
|---|---|---|---|---|---|
| X1 | FLIGHT state moves Backlog, Todo, Canceled (DUTY G3 button, `flight-state-run.ts`) | Wrong Linear transitions | not logged | **direction** | none |
| X2 | IDEAS: labelling `idea` issues in GitHub | Unvetted work | not logged | **direction** | none |
| X3 | DUTY charter confirm, standing decisions, retire, dismiss (`duty-api.ts`) | DUTY acting on a wrong brief | 1 draft in 7 days | **direction** | none |
| X4 | DUTY level L1 switch `duty.json` `l1`; DUTY never L2 to L4 | DUTY gaining powers | 0 | **keep** (K3) | C12 |
| X5 | Guards: `controller/guard.mjs` profiles, `occ/*guard*`, `duty/guard.mjs`, `mcc/*guard*`, `crosscheck/read-guard.mjs`, `hooks/` | A role running another role's command | 0 block rows counted | **keep** (K3) | C12 |
| X6 | `.claude/` and root `CLAUDE.md` changes | Permission and instruction changes | in the 28 ESCALATE rows | **keep** (K3) | C9 |
| X7 | `SIDE_EFFECT` test scan in `landing-tier` | A new command-running server file landing as `auto` | CI fails until classified | **keep** (K3) | C12 |
| X8 | WATCH (design only, nothing built) | Overnight autonomy bounds | n/a | **not a gate yet**; WATCH's OPS SPEC folds into section 5 and 8 if built | C6 |

Not gates, left out: clearances between sessions, MCC INSPECTION `findings` (the author fixes, no click), MCC landing conditions L1–L8 and the review lanes themselves (machines), HOLD (brake).

### Leak counter as built (ATC-363)

Counting only; no gate changes. `server/leaks.ts` (pure) decides for each SUPERVISOR QUEUE item whether it is a leak (principle 1) or exempt, and which row of section 4 it belongs to; `server/leaks-run.ts` ticks every 60 s and appends to `leaks.jsonl`, one `open` line when a leak appears and one `close` line (with `heldMin`) when it has been gone for two ticks (a blink in the snapshot is not counted twice). Nothing is written per cycle. `GET /api/leaks?days=7` and METRICS → LEAKS show the last 7 days by kind, split into "its control exists" and "its control is missing".

| Queue kind | Row | Control | Counted |
|---|---|---|---|
| PROPOSAL (ASSIGN, RELEASE, CLASSIFY / LAUNCH) | P1 / P2 | C14 / C11 | leak |
| SCHEDULE, FLEET PLAN | P5, P3 | C14 | leak |
| HUMAN CHECK | L10 | C10 | leak |
| LANDING: MCC escalate / SUPERVISOR merges for another reason | L11 / L14 | C13 / C9 | leak |
| LANDING: `user` tier (K3) / SUPERVISOR HOLD | L14 / L20 | — | exempt (K3, brake) |
| UPDATE | D1 | RTS (built) | leak, control exists |
| NEEDS YOU: tool approval prompt / any other block | P7 | — / C9 | exempt (K3) / leak |
| RELAY, UNDELIVERED | L18, P6 | C15, C14 | leak |
| GO | P8 | — | exempt (K3) |

A record carries `kind`, `gate`, `control`, `controlBuilt`, `flight`, `since` and a `release` field that stays `null` until the ATC-362 release record exists. The `CONTROLS` table in `leaks.ts` says which controls are built; flip a flag there when a control lands and new leaks move to "its control exists".

### SCHEDULE and FLEET PLAN without a human (ATC-370)

Rows P3 and P5 are cut (K3, approved by the SUPERVISOR on 2026-10-02: "live first"). `server/autonomy-auto.ts` (pure) decides, `server/autonomy-auto-run.ts` reads and writes; both run inside the server only (no HTTP route and no `atcctl` command changes them).

- **SCHEDULE.** Every minute the server approves open drafts of CLASSIFY, TAIL, CLOSE, WAYPOINT and NEW with no SUPERVISOR verdict and no CROSSCHECK agreement (`via: "auto"`; OCC still releases them in the S2 flow). PRIORITIZE, ROUTE and TARGET stay proposals (direction, principle 10). A NEW draft creates its issue in **Backlog** (`state: "Backlog"` in the released call): only the SUPERVISOR releases it to Todo (ATC-362). CLOSE is approved, but atc still never moves an issue to Done (no server or OCC path writes it); it stays on the SCHEDULE tab's "set Done in Linear" list. The existing daily cap `autoApproveMax` counts these approvals together with the CROSSCHECK-agreement ones.
- **FLEET PLAN.** After each cycle the server runs open LAUNCH, STOP, RESTART, REFRESH and AOG proposals through the same executor as the approve button (`by: "auto"`), so it re-checks the stale test, `ATC_MAX_LAUNCHED`, the FUEL hold and the ACCOUNT login. ENTRY, ACCOUNT CHANGE, REPOSITION (own switch), RETIRE and RETURN stay proposals, and so does a REFRESH of a desktop session. Extra caps: `autoApproveMax` for all auto actions and `autoLaunchMax` for LAUNCH, RESTART and REFRESH in a rolling 24 hours (DISPATCH auto-LAUNCHes count too), and an AIRCRAFT the server touched in the last 30 minutes (failed: 60) is left alone.
- **Switches.** `schedule.json` `auto` and `fleet-plan.json` `auto`, `on` or `off`, absent = `on` (both are on once this lands). They are written only through `PUT /api/settings` (`scheduleAuto`, `fleetPlanAuto`), which needs the screen's Origin (`fromThisApp`); settings window → OPERATIONS → SCHEDULE·FLEET PLAN AUTO. A change is written to the FLIGHT RECORDER.
- **Misfires.** `auto-actions.jsonl` records what the server did; `misfires.jsonl` records what was undone, once per event: SCHEDULE: an auto-approved draft that reached APPLIED and whose label or TAIL was reverted, whose CLOSE was reopened, or that a later draft of the same kind on the same FLIGHT contradicts (3-day window); FLEET PLAN: a STOP followed by a LAUNCH of the same AIRCRAFT within 1 hour, a LAUNCH still idle after 1 hour (a snapshot check, so it is an upper bound), or a third RESTART/REFRESH within 6 hours. `GET /api/autonomy/auto?days=14` returns the switches, the counts per day (UTC) and the last 20 events.
- **Not built.** A screen for the misfire counts (the API and the files are the record for now), a Done path for CLOSE, and the shared STOP rule with ATC-369.

### DISPATCH automatic as built (ATC-367)

K3 loosening, approved by the SUPERVISOR on 2026-10-02: the server approves every ASSIGN and launch card that passes the planner filters and caps; no CROSSCHECK step, no blind sample, no SUPERVISOR card. Switch `dispatch.json` `autoDispatch` (default on, SUPERVISOR-only through `fromThisApp`, damaged file reads as off). The late-outcome count is MISFIRE (`/api/dispatch/misfire`, DISPATCH tab). Rows P1 and P2 of section 4 no longer reach the SUPERVISOR QUEUE, so the leak counter's PROPOSAL class should fall to zero. Details: [dispatch.md](dispatch.md) "Automatic DISPATCH as built".

### SUPERVISOR credential as built (ATC-373)

Control C12 in the form the SUPERVISOR chose through the PR: a **pairing hash**. A localhost `Origin` proves nothing, because any process on the host can write that header, so the SUPERVISOR-only routes now also need a secret that only the SUPERVISOR's own screen holds.

- **Where the secret lives.** The atc page (or the ANNUNCIATOR app) makes a random 256-bit secret and keeps it in that device's own storage: the browser's `localStorage` on the Mac, or the app's keychain. It is sent in the `X-ATC-Supervisor` header with every write. The server never stores it, prints it or logs it; it only knows the sha256 hash.
- **Where the hash lives.** `/etc/atc/supervisor.sha256` (override `ATC_SUPERVISOR_HASH_FILE`), one hash per line, so several devices can be paired. The file must be owned by root and not group- or world-writable; a session running as the service user can read it but not rewrite it (no passwordless `sudo` on the host). A missing, empty, user-owned or writable file means **unpaired or insecure: every SUPERVISOR-only write is refused** (fail-closed). `ATC_SUPERVISOR_ALLOW_USER_FILE=1` accepts a user-owned file for a test server only.
- **What is gated.** `supervisorGate` runs before every route. Any `POST`, `PUT`, `PATCH` or `DELETE` under `/api/` needs the credential, **unless** it is on the allow list of writes that agents legitimately make through `atcctl` and SQUELCH (`server/supervisor-auth.ts`, matched by `server/supervisor-auth.test.ts` against `controller/atcctl.mjs`). So the routes the 1.4 sweep found without any check (DISPATCH approve and reject, RECALL creation, the DISPATCH and SCHEDULE mode switches, SCHEDULE approve and reject, every ATFM route) and every route found later are covered by default; a new write route is SUPERVISOR-only until someone adds it to the allow list on purpose. The routes' own `Origin` checks stay as a second layer. Reads are not gated.
- **Pairing.** The screen shows a bar when the server does not accept this device (`GET /api/supervisor/auth` returns `unpaired`, `missing`, `invalid` or `insecure`). "Create credential" makes the secret and shows one command to run once on the host, with the hash only: `sudo install -d /etc/atc && echo <hash> | sudo tee -a /etc/atc/supervisor.sha256`. ANNUNCIATOR does the same with its own secret.
- **Limits, stated plainly.** This stops a session that forges requests from the host. It does not stop one that can become root (the host user is in the `docker` and `sudo` groups: `docker` can mount `/etc`; `sudo` needs a password today), one that edits the service's code or unit file and waits for a restart, or one that reads the SUPERVISOR's Mac. Those are K3 matters for the landing rules, not for this check. The secret crosses the SSH tunnel and loopback in clear text, which a same-user process cannot sniff without extra capabilities.
- **Not changed.** `atcctl` and the guards: what agents may do through the allow-listed routes works as before. No record format changed.

## 5. Compensating controls

Each control says what it detects, how fast, what it does by itself and what it reports. The controls that replace a human decision are C1, C2, C4, C6, C10, C14, C15 and C16; the others support them.

| ID | Control | Detects | How fast | Does by itself | Reports |
|---|---|---|---|---|---|
| C1 | **Dual independent review.** Two reviews of the same head must both pass instead of a human, for formerly security- or risk-gated PRs. The second lane is a different vendor from the PR's author session and from the first lane, has its own instructions and does not see the first verdict (principles 5 and 6). Disagreement or a P0 or P1 finding blocks the merge and goes to a third review, then to DUTY, not to the SUPERVISOR. | A defect one reviewer would miss; today no head was reviewed by two lanes (survey 2.4) | Minutes per head; the second lane runs in parallel | Blocks, asks a third reviewer, writes both verdicts | Agreement rate and disagreements per week |
| C2 | **Diff-aware risk classifier.** The reviewer decides from the diff whether the change touches a security or contract boundary and writes `securityBoundary` and a reason. The keyword rule is dropped only after shadow. Deterministic floors stay: secret paths, migration paths, gate-3 paths. The PR text can raise the risk, never lower it. | A boundary change that has no keyword; a keyword in a PR that touches nothing | In the review | Raises a PR to the full tier of C1; never lowers it | Classifier versus keyword and path results; both-miss cases |
| C3 | **`main` runs lint and the test suites on every push** (the AIRPORT's own CI; tracked as a VOC issue linked from ATC-333), so GROUND STOP and the revert lane see test failures, not only a build failure. | A merge that builds but fails tests | At push | Fails the head's check | Red head count |
| C4 | **Automatic revert.** When a merge turns `main` red, the lander opens a revert PR for that merge, reviews and lands it by the same lane when CI is green, clears GROUND STOP on the next green head and tells DUTY. Guards: one revert at a time, never revert a revert, and after two reverts in an hour the breaker (C6) tightens instead of reverting again (revert storm). | A red `main` the author does not fix quickly | Minutes after the red head | Opens, lands and clears | Reverts landed, time to green, storms |
| C5 | **Post-deploy check and rollback on AIRPORTs** where the host can promote a previous build: a smoke request and an error-rate read after the deploy, rollback on failure. | A deploy that passes CI and fails in production | Minutes after the deploy | Rolls back, latches GROUND STOP | Failed deploys per week |
| C6 | **Circuit breaker.** Over a rolling window it counts red heads, reverts, audit findings and disagreements. Past a threshold it tightens by itself, in steps: restore the keyword and path gates, then AUTOLAND from `merge` to `update`, then GROUND STOP. It never loosens: the SUPERVISOR loosens again after reading the report. | A rising defect rate | At each cycle (90 s) | Switches a mode down, sends one alert | Breaker state and every event |
| C7 | **Audit sample.** A third reviewer, different from both lanes, re-reviews about 10% of auto-merged heads after merge; its P0 or P1 findings count against the breaker. | Shared blind spots of C1 | Within the hour | Writes a record, no PR comment | Heads audited and findings |
| C8 | **Weekly report** (section 7). | Drift | Weekly | Builds the report | The report |
| C9 | **One-click approvals for K1, K2 and K3** (section 6): an evidence pack bound to the head, the SUPERVISOR clicks. | Approving a stale or different head | At the click | Merges at that head after the server re-checks | The approval and its wait time |
| C10 | **Verifier lane.** A session runs the change (tests, a smoke flow, the preview) and attaches evidence; replaces the HUMAN CHECK classes. | Failures visible only at runtime | Minutes | Attaches evidence, blocks on failure | Evidence per PR |
| C11 | **Spend caps** for the extra reviews and automatic LAUNCH: FUEL hold, `ATC_MAX_LAUNCHED`, a daily review budget. | Cost runaway | At each decision | Holds | Cost per merge |
| C12 | **K3 hardening.** Every SUPERVISOR-only route checks the localhost `Origin` (the routes found in 1.4), and AUTOLAND, MCC and RTS refuse any PR that touches a K3 path whatever the reviews say, from a rule file under `deploy/` that is itself `user` tier. | An agent reaching a SUPERVISOR-only action or editing its own limits | At the request | Refuses | Refusals |
| C13 | **State-format compatibility check.** A CI test parses the previous state files with the new code and allows only additive optional fields. | A format change that strands existing state | In CI | Fails the PR | Test result |
| C14 | **Agreement-based approval of proposals.** DISPATCH, CREW CHANGE, SCHEDULE and FLEET PLAN items are approved when CROSSCHECK agrees, with the existing 1-in-5 blind sample kept for the SUPERVISOR to read, and caps from C11. | A wrong pairing or write | At the proposal | Approves, holds on disagreement | Auto versus manual agreement |
| C15 | **FLIGHT linkage.** A PR without a FLIGHT is linked to its issue by branch name or opens one; if none can be made it goes to DUTY. | Untraceable work | At PR open | Links or opens | Unlinked PRs |
| C16 | **Deploy hardening.** Dependency review as a required check; `npm ci` inside RTS before the restart, with the existing health check and ROLLBACK; relaunch of background sessions the health check finds killed. | A dependency change that breaks the service; sessions lost by a deploy | At deploy | Installs, checks, rolls back, relaunches | Deploys that needed rollback or relaunch |

## 6. The three kept gates as one-click approvals

Ideally each approval is one button, not a PR read. One surface serves all three: the existing SUPERVISOR QUEUE row (`LANDING`) and the PR drawer, with one ANNUNCIATOR notification. The server binds each approval to the full 40-character head SHA, expires it on a new head, and re-checks the conditions at the click (the existing DUTY G2 MERGE does this in `mergeVerdictOf`); a click on a stale card is refused.

- **K1: hosted migrations and live data.** The card shows each new migration version with a two-model plain-language summary, a list of destructive statements (`DROP`, `TRUNCATE`, `DELETE` without a filter, column type changes), the target project name, whether the version is already applied (atc reads this; ATC-329) and the review verdicts. The SUPERVISOR applies the migration with their own tools; atc detects the applied version and merges. Whether atc may apply it itself under the SUPERVISOR's click is a question (section 10, D6).
- **K2: secrets, payment or legal text, rights.** The card shows the names (never values) of added or changed environment keys, the diff of payment or legal text, and the evidence for a `Risk: Rights` PR (the licence or attribution text). It never prints a secret value.
- **K3: guards, permissions, `.claude/`, autonomy rules.** The card shows a machine-computed difference of the permission sets (allow added, deny removed, hooks removed), the list of K3 paths changed, and a two-model sentence "what this widens". The widening is computed, not described: if the allow set grows or a deny set shrinks, the card says so in those words.

## 7. The SUPERVISOR's weekly report

One page, built by C8 from existing records, shown as a block on the NETWORK tab (which already shows landing wait) and as one weekly ANNUNCIATOR notification. It is the place where loosening is decided.

| Number | Source |
|---|---|
| PRs merged per AIRPORT by lane (AUTOLAND, MCC, by hand) | `autoland.jsonl`, `mcc.jsonl`, GitHub merged list |
| Residual SUPERVISOR merges, by reason | the exclusion log (survey W1) |
| Open to merge, median and p90 | LOGBOOK `landingWaitMin` |
| Red `main` heads per 100 merges, and time to green | `main` push runs |
| Revert and hotfix PRs within 72 h; auto-reverts landed and their outcome | GitHub, C4 records |
| Two-lane agreement, disagreements and how they ended | `landing-reviews.jsonl`, `autoland-reviews.jsonl`, the second-lane log |
| Audit sample: heads audited, P0 and P1 findings | C7 records |
| Breaker state and every tighten or loosen event | C6 records |
| Cost per merge (review tokens, FUEL) | FUEL, judge logs |
| K1, K2, K3 approvals: count and median wait | C9 records |
| Brakes used (HOLD, manual GROUND STOP) | `autoland.jsonl`, `atfm` records |
| DISPATCH and FLEET PLAN: automatic versus manual agreement | `proposals.jsonl`, `fleet-plan.jsonl` |

## 8. Implementation order

A control lands before the gate it replaces is removed, and every step names its work orders (title, scope, expected tier), how it runs in shadow, and the measurement that lets it go live. The work orders are listed here and not created in Linear; DUTY or ENGINEERING will. Tiers follow `deploy/landing-tier.mjs`: a change to the AUTOLAND, MCC or landing-tier rules is a K3 file and goes through the SUPERVISOR once.

### Step 0: measure (this week, no gate changes)

- **WO-1 Exclusion log.** AUTOLAND writes one record per CLEARED PR and head with the exclusion reason each cycle, and a daily count. Tier `flagged`.
- **WO-2 Escaped-defect record.** Count red `main` heads, revert and hotfix PRs, late review findings per week from GitHub and the logs; fix the LOGBOOK `reverted` write. Tier `auto` or `flagged`.
- **WO-3 Weekly report v0.** The section 7 block with the numbers that already exist. Tier `auto`.
- Shadow: not needed (read only). Go: the report shows the residual SUPERVISOR merges by reason.

### Step 1: controls in shadow (this week)

- **WO-4 Second review lane in shadow.** A different-vendor reviewer reviews each AIRPORT head, not counted toward CLEARED; agreement logged. Tier `flagged`.
- **WO-5 Reviewer-side classification in shadow.** The merge-review verdict gains `securityBoundary` with a reason, logged beside the keyword, path and label results. Tier `flagged`.
- **WO-6 Breaker v0.** A cycle counts red heads and reverts; past a threshold AUTOLAND drops from `merge` to `update` by itself and alerts once; only the SUPERVISOR raises it again. Tier `user` (an AUTOLAND rule: the SUPERVISOR merges this one).
- **WO-7 `main` tests on every push** on the AIRPORT (control C3; a VOC issue). Outside atc.
- **WO-8 Origin check on every SUPERVISOR-only route** (control C12, section 1.4). Tier `user` (server routes that guard autonomy; decision D10).
- Shadow: all four run next to the existing gates and change nothing. Go: see step 2.

### Step 2: first gate cut, shippable this week (day 4 or 5, decided by measurement)

Gates L1, L2, L3 and L4 become delegable on AIRPORT A **when both lanes pass the head and the classifier agrees**. This is the first step that cuts SUPERVISOR merges on AIRPORT PRs: it removes the `Risk: Contract`, `Risk: Security`, `rating:SEC`, path and keyword exclusions, which together are the 79% of PRs the security gate touched.

- **WO-9 Dual-review delegation.** `mergeExclusionOf` lifts L1–L4 when C1 agrees; L5–L9 stay. Tier `user` (an AUTOLAND rule).
- Measurement that decides go (written now): at least 50 heads in the shadow lanes with agreement of at least 90%; the audit sample (C7, run in shadow) with no P0 or P1 miss on both-pass heads; breaker v0 live; C3 live. At about 17 PRs a day, 50 heads take about 3 days.
- Expected effect: SUPERVISOR merges on AIRPORT A fall from about 117 a week to the residual of K1 migration PRs (16% by replay, one-click or automatic when already applied), K2 and L8, L9 until their controls land (roughly 20% of PRs or fewer; WO-1 measures it).
- Rollback: the breaker, or one click restoring the exclusions.

### Step 3: auto-revert and weekly breaker v1

- **WO-10 Auto-revert lane (C4).** First as a proposal (a draft revert PR the SUPERVISOR sees but nothing lands), then landing by the same lane. Tier `flagged`.
- **WO-11 Breaker v1 (C6) and audit sample live (C7).** Thresholds per rate, tighten in steps. Tier `user`.
- Measurement that decides go: revert PRs correct and green on at least 5 cases or a replay of past red heads; no storm in the guard test.
- Then L15 (GROUND STOP clear) becomes automatic.

### Step 4: one-click approvals (C9)

- **WO-12 Approval cards for K1, K2, K3** on the SUPERVISOR QUEUE and PR drawer, head-bound. Tier `flagged`.
- Gates stay; their cost falls from a PR read to a click. Go: the card shows what a reader needs (checked with the last 20 K1 to K3 PRs).

### Step 5: narrow the `user` tier on atc

- **WO-13 State-format compatibility test (C13)** and additive-format PRs delegable to MCC. Tier `user` (landing-tier rule).
- **WO-14 Dependencies through dependency review and RTS `npm ci`** with health check and ROLLBACK. Tier `user` (deploy).
- Go: format-compat test green on the last 30 format PRs; dependency review as a required check. Cuts the ESCALATE rows (28 a week) except K3 files.

### Step 6: more AIRPORTs and DISPATCH approvals

- **WO-15 AUTOLAND for other AIRPORTs** one at a time, each only with a required CI check and C3. Tier `user` (autoland.json airports list is read by an AUTOLAND rule; the SUPERVISOR enables per AIRPORT).
- **WO-16 Agreement-based approval (C14)** for ASSIGN, CREW CHANGE, SCHEDULE, then FLEET PLAN, with LAUNCH under spend caps (C11). Shadow is the existing verdict gate (20 verdicts at 80%). Tier `flagged`.
- Go for P1: CROSSCHECK agreement with the SUPERVISOR's decisions at least 90% over 100 decisions, blind sample unchanged.

### Step 7: verifier lane, FLIGHT linkage, post-deploy

- **WO-17 Verifier lane (C10)** and HUMAN CHECK classes retired in turn (CHOICE, DEVICE, then ACCOUNT). Tier `flagged`.
- **WO-18 FLIGHT linkage (C15).** Tier `flagged`.
- **WO-19 Post-deploy check and rollback for AIRPORTs (C5)** where the host supports it. Tier `flagged`.
- **WO-20 Spend caps (C11)** for the extra lanes. Tier `flagged`.
- Go: after step 3's numbers are stable for two weeks.

No step leaves a window with neither a gate nor its control: step 2 requires C1, C2, C3, C6 v0 and C7 in shadow; step 3 precedes the removal of the manual GROUND STOP clear; steps 5 to 7 need steps 3 and 4.

## 9. Risks

| Risk | What could happen | Mitigation |
|---|---|---|
| Two models share a blind spot | Both pass a bad change | Different vendors and instructions (principle 5); C7 audit by a third reviewer; agreement is a watched number; the breaker |
| Revert storms | A revert breaks `main` again, or reverts chain | One revert at a time, never revert a revert, breaker after two reverts in an hour (C4, C6) |
| A classifier gamed by PR text | A PR describes itself as harmless | The classifier reads the diff, text only raises risk (principle 6); deterministic floors stay |
| An agent edits the files behind K3 | An agent widens its own limits | K3 paths are `user` tier and refused by every lander (C12); the SUPERVISOR-only routes check `Origin`; note that every merge uses one GitHub login, so GitHub's own review rules cannot enforce this and atc's rules must |
| A prompt injection reaches a reviewer | A PR text instructs the reviewer (survey 1.6: a CVSS 9.4 flaw in AI review Actions) | Reviewers read a packet and run with no secrets; no review Action on `pull_request_target`; instructions in PR text are data |
| Cost of extra reviews | Two lanes plus audit about double the review tokens | Spend caps (C11); the audit is a 10% sample; cost per merge is in the weekly report |
| The breaker flaps | It tightens and loosens often | It only tightens; loosening is the SUPERVISOR's; one alert per event |
| Pace outruns measurement | Gates leave before the data says so | Each step has a written measurement and a shadow run (principle 8) |
| Approval fatigue | One-click approvals pile up | They are only K1–K3; the weekly report counts them and their wait |
| AUTOLAND and MCC stall each other | A PR waits on two systems | One lander per AIRPORT (existing rule) |
| A small baseline | 7 days of data, 2 red heads | Thresholds are set on rates over a rolling window and reviewed at the first report |

## 10. Decisions for the SUPERVISOR

Recommended defaults first; none changes K1, K2 or K3.

- **D1 Breaker thresholds.** Default: tighten when more than 3 `main` heads are red in any 50 merges (about 3 times the 1.7% baseline), or 2 reverts in 7 days, or an audit P0; loosening only by the SUPERVISOR after the weekly report.
- **D2 Go condition for the first cut (step 2).** Default: at least 50 shadow heads, agreement at least 90%, no audit P0 or P1 miss on both-pass heads.
- **D3 Review models.** Default: the second lane is a different vendor from the PR's author session (Codex when the author is Claude, the REVIEW lane when the author is Codex); the third (audit) reviewer is neither. Which vendor and plan, and a daily review budget, are the SUPERVISOR's.
- **D4 AIRPORT order.** Default: AIRPORT A (already delegating), then atc's `user` tier narrowing (step 5), then other AIRPORTs once each has a required CI check.
- **D5 Audit rate.** Default 10% of auto-merged heads.
- **D6 Where the three gates end** (questions, not designed in): (a) Is `.github/` (CI, required checks) part of K3? Recommended yes, because CI is a control. (b) Are `deploy/*.service` units part of K3? Recommended yes. (c) Is a dependency change in `package*.json` a gate? Recommended no (automate with dependency review). (d) Is granting a CHECKRIDE rating (a SEC rating decides who may take SEC work) part of K3? Recommended yes. (e) Is a tool-approval prompt a session waits on part of K3? Recommended yes. (f) Is an already applied migration (ATC-329) outside K1? Recommended yes, as built. (g) May atc itself apply a migration under a one-click approval, or does the SUPERVISOR apply it? Recommended: the SUPERVISOR applies (atc never runs SQL), revisited when step 4 has run.
- **D7 Where the one-click approvals live.** Default: the SUPERVISOR QUEUE row and PR drawer plus one ANNUNCIATOR notification.
- **D8 Weekly report.** Default: Monday 09:00 local, NETWORK block plus one notification.
- **D9 Direction inputs stay human.** Default: moving an issue Backlog to Todo, labelling ideas and the DUTY charter stay with the SUPERVISOR (principle 10).
- **D10 Origin checks on every SUPERVISOR-only route** (section 1.4). Default yes, in step 1, independent of the rest.
- **D11 Brakes.** Default: HOLD, CANCEL, RECALL, manual GROUND STOP and the mode switches stay, and the SUPERVISOR may switch automation down at any time.
