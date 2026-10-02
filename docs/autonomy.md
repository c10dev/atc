# Autonomy: taking the SUPERVISOR out of the per-PR merge path

**English** · [한국어](autonomy.ko.md)

Status (2026-10-01): design draft for [ATC-333](https://linear.app/vocado/issue/ATC-333). The SUPERVISOR decided on 2026-10-01 that they set direction (ROUTEs, priorities, what to build) and do not read PRs, and agreed to keep exactly three human gates (section 2). Nothing in this document is built; what already exists is listed under "Current facts". No row below is marked done; DUTY or ENGINEERING update the status after merge.

Revised 2026-10-02: the SUPERVISOR set the arrow direction ("the human fires the arrow, the proposal; after that, human intervention should disappear") and confirmed the ten principles of section 3, each at most two sentences with what enforces it, and chose live first over shadow runs (D21). Their decisions are marked **Decided** in section 10; the code findings of that day are in 1.5. Still nothing in this document is built.

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

The routes that only the SUPERVISOR may call check a localhost `Origin` (`fromThisApp`), and `atcctl` has no command for them. Reading the routes found some without that check: DISPATCH approve and reject of a non-LAUNCH card, the DISPATCH and SCHEDULE mode switches, SCHEDULE approve and reject, and the ATFM routes (`proposals.ts`, `schedule.ts`, `atfm-run.ts`; also noted in [watch.md](watch.md) and [fleet.md](fleet.md)). They are SUPERVISOR-only because no control session has a command and the guards block `curl`, not because the server refuses. That matters here because the autonomy rules (K3) must hold against a session that finds another way to reach `7700`; hardening is control C12 and a decision in section 10. A re-read on 2026-10-02 adds RECALL creation (`proposals.ts`) and every ATFM route, including the manual GROUND STOP and the ATFM switch, which can also switch up and so is a K3 path (`atfm-run.ts` has no `fromThisApp`).

### 1.5 What the 2026-10-02 revision found

Code read at `999dc89` and read-only logs, 2026-10-02 [observed]:

- **Agents can release work.** DISPATCH takes Todo issues with a priority (`dispatch.ts`). DUTY may create or move ATC issues to Todo with a priority (`duty/CLAUDE.md`, `duty-linear.ts`), OCC prints the Linear calls for an approved SCHEDULE NEW, and ENGINEERING sessions write Linear directly. No record says that the SUPERVISOR released a FLIGHT (principle 10).
- **Text lowers risk or stands in for a check.** HUMAN CHECK need and completion are read from PR body lines (`human-check.ts`). The review and inspection record routes have no caller check (`landing-review.ts`, `mcc-run.ts`). Any non-author GitHub review on the head counts as a review (`landing.ts`). An unknown FLIGHT key from a branch name lifts the "no FLIGHT" exclusion. `type:SURVEY|CHECK` and `tail:` labels skip checks. Template lines skip the security keyword scan. Reviewer packets carry title, body and issue text without a data fence; only DUTY's packets have one (principle 6).
- **Decisions not bound to their input.** `clearances.jsonl` has no head field (it is only in the text), and `proposals.jsonl`, `schedule.jsonl`, `judges.jsonl` and `fleet-plan.jsonl` store no hash of what was judged. AUTOLAND's most frequent decision, not to merge, is not logged (principle 7).
- **Gates that count catches only.** MCC's shadow gate (`mccGateOf`) shows 55 mismatches that never enter its go decision. The Jev judges, scored against the SUPERVISOR's decisions, would have passed 11 of 12 refused DISPATCH proposals at 0.5 confidence (739 of 745 lines are replay, 6 shadow) (principle 2).
- **The Origin check is not authentication.** `fromThisApp` (`origin.ts`) reads only request headers. It keeps other web sites from acting through the browser, not a local process, so the atc screen is not yet an authenticated channel (principles 6, 9 and 10).
- **A flaky red stops the landers.** On 2026-10-02 a test unrelated to the merged PR failed once on `main`; MCC held two landable PRs and asked the SUPERVISOR. A revert of the newest merge would have reverted an innocent PR (principle 3, C4).

## 2. The three gates that stay

Decided by the SUPERVISOR on 2026-10-01 and extended on 2026-10-02 (D14, D15, principle 3). Under the arrow they are approved once, at release, as declared effects (section 6), not at merge. They are called K1 to K3 ("kept") so that they are not mixed up with the DUTY card buttons G2 (MERGE) and G3 (state move) in [duty.md](duty.md).

1. **K1: applying migrations to a hosted database, changing live data, or rewriting atc's own state records.** A merge can be reverted; lost data cannot.
2. **K2: secrets and keys (`.env`, credentials), payment or legal text, content rights (`Risk: Rights`), and data leaving atc's control** (private AIRPORT content into a public place, a new outside destination, a wider field allowlist). These are about outside responsibility, not code quality.
3. **K3: atc's own guards, permissions, `.claude/` settings and the autonomy rules themselves** (the files that decide what sessions may do, including the AUTOLAND, MCC and landing-tier rules), **and every loosening of a gate, threshold, route or mode.** An agent never approves a widening of its own limits.

## 3. Principles

Each principle states one invariant in at most two sentences, followed by what enforces it today: built, partly built, or **WISH** (no enforcement point yet). The mechanics (which control, which record, thresholds) live in sections 4, 5, 7, 8 and 10. Terms: the **release** (the arrow) is the SUPERVISOR's act that starts a FLIGHT, carrying its destination (goal and done-when) and its declared K1–K3 effects; a **leak** is a human step after release; a **floor** is a deterministic check that refuses before an effect happens; a **misfire** is a control acting wrongly (harmful) or holding wrongly (nuisance).

1. **The SUPERVISOR fires the arrow.** They set the destination and approve, at release, any K1–K3 effect a FLIGHT may have; any human step after release is a leak, counted and removed once its owner's control is live.
   *Enforced by:* WISH. No leak count yet (C8).
2. **A control goes live with its way back.** A gate leaves, or a human step disappears, only when its control is live with an off switch and a misfire counter from the first hour; when live misfires cross the limit the gate returns by itself, and only the SUPERVISOR removes it again.
   *Enforced by:* WISH. Per-control misfire counters and the per-control restore in C6 are not built.
3. **Tighten fast on a confirmed signal; only the SUPERVISOR loosens.** The server may tighten a rule and a lane may hold one item, and a trip that the re-check disproves reopens by itself; any other loosening of a gate, threshold, route or mode is a K3 approval with computed direction, and a second trip for the same cause within 7 days needs a fix first.
   *Enforced by:* partly built. The AUTOLAND GROUND STOP latch, RTS off after ROLLBACK and the Origin check on the settings switches exist; C6, the re-check, the self-reopen, computed direction, the Origin check on the ATFM and DISPATCH mode switches and the 7-day rule do not.
4. **Irreversible effects are declared at release; everything else gets a revert.** A change is reversible only if reverting and redeploying undoes every effect it had; unbounded irreversible effects (K1, K2) are declared and approved at release and a floor checks the built content against the declaration, bounded ones run under a cap, and the rest gets a revert within a stated time.
   *Enforced by:* partly built. The AUTOLAND migration and secret-path exclusions (L5, L6, ATC-329) and the `user` landing tier exist; C4, the message caps in C11 and C17 do not.
5. **Independence, not repetition.** Two reviews count as two only if they differ in model, instructions and input, differ from the author, and neither sees the other's verdict first; the SUPERVISOR's click is a review too, not ground truth. Independence is measured by both-miss on planted defects and late outcomes, not by agreement.
   *Enforced by:* partly built. Head-bound verdicts, Codex and REVIEW lanes from different vendors where allowed, and MCC's refusal of a truncated diff exist; a diff-only lane, verdict hiding, planted-defect runs and a single-review counter do not.
6. **After release, text is evidence of intent, never of fact or authority.** Decisions rest on computed facts (paths, diff, CI, git) and on the SUPERVISOR's recorded channels, checked against the approved release; text from agents or outsiders may raise risk, never lower it, and instructions inside it are data.
   *Enforced by:* partly built. Path tiers, raise-only `Risk:` and `rating:` labels and keywords, head-bound verdicts and DUTY's data fence exist; the violations listed in 1.5 remain.
7. **Every decision is bound to what it judged and joins to its outcome.** Each verdict, machine or human, is appended with its exact input (a head SHA or a content hash) and its FLIGHT's release, and a decision not to act is logged when it starts and when it ends.
   *Enforced by:* partly built. Heads are recorded in `mcc.jsonl`, the review logs, `autoland.jsonl`, `human-checks.jsonl`, `rts.jsonl` and the FLIGHT RECORDER landing and ATFM events, and the FLIGHT key in proposals, clearances and judges; content hashes, a head on clearances, a release id and exclusion start and end lines (WO-1) are missing.
8. **Live first, then adjust.** A control goes live at once with its off switch, its misfire counter and a limit written before it is turned on, and is tuned from live counts; a change to live data is rehearsed on a copy first (C20).
   *Enforced by:* partly built. AUTOLAND, MCC and the judges have off switches; per-control misfire counters, written limits and the migration rehearsal do not exist.
9. **A brake only stops, and only the SUPERVISOR pulls or releases it.** HOLD, CANCEL, RECALL, STOP, a manual GROUND STOP and switching a mode down can come at any time and nothing waits for them; releasing one returns the arrow to its approved envelope, while anything beyond that, or a stop the system set, is a new arrow or a K3 loosening.
   *Enforced by:* partly built. The AUTOLAND and MCC holds, the GROUND STOP clear, DISPATCH CANCEL, session STOP and the settings check Origin; RECALL creation, the DISPATCH and SCHEDULE mode switches and the ATFM routes do not (C12), and no CI test checks that every lane honors every brake.
10. **Only the SUPERVISOR fires an arrow, by a click on the atc screen or by their own words to a session, and it carries only the destination and its declared K effects.** Agents draft arrows as proposals and never release one on their own, and a FLIGHT that meets a direction question after release proceeds on a stated default or comes back as a new arrow.
   *Enforced by:* WISH. DISPATCH reads the Linear state and priority, which DUTY, OCC and ENGINEERING can set; no release record names the SUPERVISOR's channel (C18), and the screen channel is not authenticated yet (1.5).

## 4. Gate inventory

Every place where atc requires or offers a human decision, grouped by area (a sub-agent read the docs and routes; I checked the landing rules against `server/landing.ts` and `server/autoland.ts` and the counts against the logs). "7 days" is a count where a log exists; "not logged" means no record exists for the gate. Verdicts: **keep** (only K1, K2, K3), **automate** (the gate becomes a machine decision, its control named), **remove** (the gate disappears once its control runs), **brake** or **direction** (not a gate, see principles 9 and 10), **floor** (a deterministic refusal, no person) and **release** (the SUPERVISOR's arrow, principle 10). The control column names a control from section 5; it lands before the verdict takes effect (section 8 gives the order).

### 4.1 Landing and merge

| ID | Gate · where | Protects against | 7 days | Verdict | Control that lands first |
|---|---|---|---|---|---|
| L1 | `Risk: Contract` and `Risk: Security` labels, ticket or PR (`mergeExclusionOf`, `externalGateOf`; `autoland.ts`, `landing.ts`) | A contract or security change merging on a single review | 2 CLEARED PRs held today; replay found 0 PR labels in 121 merges (ticket labels not readable offline) | **automate** | C1 dual review, C2 classifier, C4 auto-revert, C6 breaker, C7 audit |
| L2 | `rating:SEC` ticket label (same functions) | SEC work merging without extra care | not logged | **automate** | C1, C2, C4, C6, C7 |
| L3 | Security paths: auth, session, RLS and policy, admission, functions, middleware (`securityPathOf`) | Access-control changes merging unseen | replay: 44 of 121 merged PRs (36%) | **automate**: the path becomes an input to C2; secret paths and migration paths follow L5 and L6 | C1, C2, C4, C6, C7 |
| L4 | Security keywords in PR or FLIGHT text (`securityWordOf`, `SECURITY_WORDS`) | A security change described in words | replay: 94 of 121 (78%), keyword alone 51 (42%) | **remove**, once C2, live with its counter, flags every PR the keyword caught that a person would have wanted | C2 diff-aware classifier (live, counted), C1 |
| L5 | Migration and SQL paths (`migrationPathOf`; `hostedDb` migration gate, ATC-329) | A migration merging before it is applied on the hosted DB | replay: 19 of 121 (16%) | **keep** (K1), declared at release: a floor compares the built migration with the declaration and atc applies it when they match (D6 g); an undeclared or unclassifiable statement is a new arrow | C9 release declaration, C18, C20 rehearsal |
| L6 | Secret and key paths (`secretPathOf`: `.env*`, credentials, keys, certificates) | Credentials entering the repository | replay: 0 of 121 | **keep** (K2), declared at release | C9, C17 |
| L7 | `Risk: Rights` label, payment or legal text | Outside responsibility (K2) | not logged | **keep** (K2), declared at release | C9 |
| L8 | No FLIGHT on the PR (`gate.hard`) | A change nobody asked for; no traceability | not logged | **automate** | C15 FLIGHT linkage (DUTY or DISPATCH links or opens the FLIGHT; a PR with none goes to DUTY, not to the SUPERVISOR) |
| L9 | 100 or more files, or an unreadable file list (`mergeExclusionOf` step 5) | A diff too large to judge | not logged | **automate** | C1 with the full tier (more reviewers, whole-diff packet), C7; size hint W7 of the survey |
| L10 | HUMAN CHECK classes CHOICE, ACCOUNT, DEVICE (`human-check.ts`, `/api/human-check`) | A UI change a person must judge | 1 record | **automate**: CHOICE behind a flag or preview, DEVICE by a device smoke run, ACCOUNT unless it touches K1 or K2. **Decided:** the need is computed from the changed paths and completion comes only from the record made on the atc screen; PR body lines may only raise the need | C10 verifier lane with evidence pack, C4, C6 |
| L11 | MCC ESCALATE (`mcc-run.ts`, `docs/mcc.md`): a model raising a PR to `user` | Doubt, state-format changes, hard-to-revert changes | 28 rows on 27 PRs | **automate** for additive state-format changes and reversible changes; **keep** where the PR touches K3 (L12) | C13 format-compat check, C1, C4 |
| L12 | Landing tier `user` for guards, hooks, `.claude/`, root `CLAUDE.md`, `rulebook/`, `*guard*.mjs`, `deploy/landing-tier.mjs` (`landing-tier.mjs`) | A session widening its own limits | included in the 28 above | **keep** (K3) | C9, C12 |
| L13 | Landing tier `user` for `.github/`, `package*.json`, `deploy/` units | A change to CI, dependencies or service units landing unseen | included in the 28 above | **keep** (K3) for `.github/` and `deploy/` units, **automate** for `package*.json`; where K3 ends is question D6 (a to c) | C12 for the kept part; C16 dependency review for `package*.json` |
| L14 | MERGE click (DUTY G2): the SUPERVISOR merges a `user`-tier PR (`pr-merge-run.ts`, `mergeVerdictOf`) | Merging a wrong or stale head | not logged separately | **remove**: no merge-time card. K3 effects are declared at release (C9), and a built change beyond the declaration is a new arrow | C9, C18 |
| L15 | GROUND STOP clear: the SUPERVISOR clears a latched stop (`autoland-run.ts`, ATC-330) | Merging onto a broken `main` | 0 latches | **automate**: a green head after the revert clears it | C3 main tests, C4 auto-revert, C6 |
| L16 | Review lane availability: Codex limit or exclusion leaves PRs unreviewed (`landing.ts`) | A PR with no review | 11 of 13 re-review requests went to REVIEW | **automate**. **Decided (D20):** when a lane is down on a PR that needs two, a single review passes, recorded as a single review and counted | C1 gives a second lane; spend caps C11 |
| L17 | Stacked PR and STRANDED alerts the SUPERVISOR fixes by hand (`docs/occ.md`) | A merge that never reached `main` | not logged | **automate** | C4: the revert and landing lane also retargets or rebases a stacked PR when its base merges |
| L18 | RELAY by hand for GO AROUND or FIX with no STAND holder (`supervisor-queue.ts`) | A notice going nowhere | 14 relay rows | **automate** | C15: DUTY takes the case and opens or reopens the FLIGHT; a rare case |
| L19 | Mode switches: AUTOLAND `off/update/merge`, `reviewedSecurity`, MCC mode, `teamsMerge`, `hostedDb`, `externalReview.security` (settings window) | Delegating merges without consent | 1 switch (delegate) | **keep** (K3) for switching up, a loosening with computed direction (principle 3); switching down is a brake (principle 9) | C6, C12 |
| L20 | HOLD on a PR (AUTOLAND and MCC), CANCEL, RECALL, session STOP, pulled by the SUPERVISOR | Stopping something wrong | 2 HOLD rows | **brake** (principle 9). A lane's own holds, such as TOWER's clearance cancels, are item holds under principle 3, not brakes | none needed |
| L21 | Publication in a public repository: a pushed branch, PR body or comment is public at once | Private AIRPORT content or secrets made public; a revert does not unpublish | not logged | **floor** at push and PR create; a flag is K2 (D14) | C17 pre-publish scanner |
| L22 | A new outside destination for AIRPORT data (review lanes, judges), or a wider field allowlist | Data leaving atc's control | `judges.jev` is such a switch today | **keep** (K2), declared at release (D14) | C9, C12 |
| L23 | Agents deleting what cannot be rebuilt (issues, records, branches with unmerged work) | Irreversible loss | not logged | **floor**: no agent deletes it; DUTY already may not delete or close | C12 |

### 4.2 Deploy

| ID | Gate · where | Protects against | 7 days | Verdict | Control |
|---|---|---|---|---|---|
| D1 | UPDATE bar click to start RTS (`update-run.ts`) | Deploy timing | most deploys are automatic in `land+rts`; clicks not separated | **remove** (nothing waits) | RTS health check and ROLLBACK, already built |
| D2 | RTS refusal for `package*.json` dependency changes (`deploy/rts.mjs`) | Unattended `npm ci` | 4 refused (with units) | **automate** | C16 dependency review as a required check, then `npm ci` inside RTS with the health check and ROLLBACK |
| D3 | RTS refusal for `deploy/*.service` units (`daemon-reload`) | A service unit changing what runs and with what power | included above | **keep** (K3: it sets what the service may do) | C9 |
| D4 | RTS stays off after ROLLBACK until the SUPERVISOR picks the MCC mode again (`docs/mcc.md`) | A rollback loop | 0 rollbacks | **keep** (K3, it is the deploy breaker; loosening is the SUPERVISOR's). It never reopens by itself (D12) | C6 |
| D5 | Killed sessions relaunched by hand after a deploy | Lost work | 0 | **automate** | C16 relaunch of the sessions the health check finds killed (CONTROL RECYCLE style); the 3-condition check already detects it |
| D6 | AIRPORT deploys: no post-deploy check exists | A bad deploy of an AIRPORT | n/a | **control missing** | C5 post-deploy check and rollback where the host supports it |

### 4.3 DISPATCH, FLEET, SCHEDULE

| ID | Gate · where | Protects against | Count | Verdict | Control that lands first |
|---|---|---|---|---|---|
| P1 | ASSIGN, RELEASE, CLASSIFY approve or reject (`proposals.ts`; [dispatch.md](dispatch.md)) | A wrong AIRCRAFT-FLIGHT pairing | 315 approvals, 285 by click, 7 rejections | **automate**. **Decided (D22):** the server approves every ASSIGN card that passes the planner's deterministic filters and the C11 caps; no CROSSCHECK agreement and no blind sample. RELEASE and CLASSIFY: open | planner filters, C11 caps, DISPATCH misfire count |
| P2 | LAUNCH card approval (`proposals.ts`, Origin) | Starting a session that spends usage | 89, all by the SUPERVISOR | **automate**. **Decided (D22):** the server approves LAUNCH cards within the C11 caps | C11 spend caps (FUEL hold, `ATC_MAX_LAUNCHED`) |
| P3 | FLEET PLAN approve and verdict (`fleet-plan-run.ts`) | Usage spend, stale proposals | 5 approvals, 15 expired | **automate** reversible kinds first (STOP of an idle session), then LAUNCH under caps | C14, C11 |
| P4 | CREW CHANGE approve and "delivered" (`crew-change.ts`) | Changing a running team's crew without consent | not logged | **automate** | C14 |
| P5 | SCHEDULE op approve, reject, verdict (CLASSIFY, NEW, CLOSE, TAIL, WAYPOINT; `schedule.ts`) | Wrong ticket edits | 28 drafts, 30 agree and 9 disagree CROSSCHECK verdicts | **automate** | C14 |
| P6 | UNDELIVERED FLIGHT PLAN and CLEARANCE hand delivery | A message that could not be delivered | 10 undelivered rows | **automate** | C14: retry of the delivery and a DUTY alert when it still fails |
| P7 | NEEDS YOU: a session blocked on a tool approval prompt | A session waiting on a permission decision | alerts, not counted here | **keep** (K3: a permission) for the permission itself; a prompt after release is a leak (principle 1); a blocked question about direction proceeds on a stated default or comes back as a new arrow (principle 10) | C9 |
| P8 | SUPERVISOR CONFIRM AT AIRCRAFT (go for a `user`-tier FLIGHT) | A `user`-tier FLIGHT proceeding without a go | 1 row | **keep** (K3) | C9 |
| P9 | DISPATCH, SCHEDULE, FLEET PLAN, ATFM, CONTROL RECYCLE, FUEL hold, REPOSITION, JEV, SQUELCH mode switches | Turning automation on before it is measured | 1 judges mode row | **keep** (K3) for switching up, a loosening with computed direction (principle 3); switching down is a brake (principle 9) | C6, C12 |
| P10 | ATFM switches and `s3` | Auto-actions before the shadow week | not counted | **keep** (K3) for switching up; switching down is a brake | C6, C12 |
| P11 | ATFM manual GROUND STOP, GROUND DELAY | Stopping departures by hand | not logged | **brake** | none |
| P12 | ADD ACCOUNT, LOGIN, SHARE MEMORY (`accounts-run.ts`) | Credentials | not logged | **keep** (K2) | C9 |
| P13 | CHECKRIDE rating grant (SEC ratings decide who may take SEC work) | A team getting a permission by a recommendation | not logged | **keep** (K3) grant, revoke is a tightening; **question** D6 | C9 |
| P14 | Workspace trust prompt, one time per repository | A session in an untrusted folder | not counted | **keep** (K3) | none |
| P15 | LAUNCH, STOP, AOG, RETIRE, ENTRY of AIRCRAFT by hand | Fleet shape and usage | FLEET PLAN counts above | **direction** (fleet design); a STOP of work in flight is a brake (principle 9) | none |

### 4.4 Direction, DUTY and guards

| ID | Gate · where | Protects against | Count | Verdict | Control |
|---|---|---|---|---|---|
| X1 | FLIGHT state moves Backlog, Todo, Canceled (DUTY G3 button, `flight-state-run.ts`) | Wrong Linear transitions; an agent starting work no one released | not logged | **release** (principle 10): a move to Todo with a priority starts a FLIGHT only with a release record from the SUPERVISOR's channel; an agent's Todo write without one is a proposal | C18 release record |
| X2 | IDEAS: labelling `idea` issues in GitHub | Unvetted work | not logged | **direction** | none |
| X3 | DUTY charter confirm, standing decisions, retire, dismiss (`duty-api.ts`) | DUTY acting on a wrong brief | 1 draft in 7 days | **direction** | none |
| X4 | DUTY level L1 switch `duty.json` `l1`; DUTY never L2 to L4 | DUTY gaining powers | 0 | **keep** (K3) | C12 |
| X5 | Guards: `controller/guard.mjs` profiles, `occ/*guard*`, `duty/guard.mjs`, `mcc/*guard*`, `crosscheck/read-guard.mjs`, `hooks/` | A role running another role's command | 0 block rows counted | **keep** (K3) | C12 |
| X6 | `.claude/` and root `CLAUDE.md` changes | Permission and instruction changes | in the 28 ESCALATE rows | **keep** (K3) | C9 |
| X7 | `SIDE_EFFECT` test scan in `landing-tier` | A new command-running server file landing as `auto` | CI fails until classified | **keep** (K3) | C12 |
| X8 | WATCH (design only, nothing built) | Overnight autonomy bounds | n/a | **not a gate yet**; WATCH's OPS SPEC folds into section 5 and 8 if built | C6 |

Not gates, left out: clearances between sessions, MCC INSPECTION `findings` (the author fixes, no click), MCC landing conditions L1–L8 and the review lanes themselves (machines), HOLD (brake).

## 5. Compensating controls

Each control says what it detects, how fast, what it does by itself and what it reports. The controls that replace a human decision are C1, C2, C4, C6, C10, C14, C15 and C16; C9 and C18 move the K1–K3 approvals to release; the others support them.

| ID | Control | Detects | How fast | Does by itself | Reports |
|---|---|---|---|---|---|
| C1 | **Dual independent review.** Two reviews of the same head must both pass instead of a human, for formerly security- or risk-gated PRs. The lanes differ in model, instructions and input (one lane reads the diff without the PR body; a packet truncated over a sensitive path cannot pass), differ from the author's model family, and neither sees the other's verdict (principles 5 and 6). **Decided (D3, D18):** a sensitive PR whose content may not go to another vendor uses a pre-approved outside model for that AIRPORT (K2 at release), otherwise the same vendor with a different model, instructions and input, counted as partial independence with its own both-miss rate; no human gate. Disagreement or a P0 or P1 finding blocks the merge and goes to a third review, then to DUTY, not to the SUPERVISOR. | A defect one reviewer would miss; today no head was reviewed by two lanes (survey 2.4) | Minutes per head; the second lane runs in parallel | Blocks, asks a third reviewer, writes both verdicts with a hash of each lane's input | Disagreements and how they ended; both-miss on planted defects (C7); single reviews (D20) |
| C2 | **Diff-aware risk classifier.** The reviewer decides from the diff whether the change touches a security or contract boundary and writes `securityBoundary` and a reason, together with the effect classes it touches (message builders, outside data transfer, state writers, public text; principle 4). The keyword rule is dropped once C2 runs live with its misfire counter, and template lines no longer hide keywords. Deterministic floors stay: secret paths, migration paths, K3 paths. The PR text can raise the risk, never lower it. | A boundary change that has no keyword; a keyword in a PR that touches nothing | In the review | Raises a PR to the full tier of C1; never lowers it | Classifier versus keyword and path results; both-miss cases; over-flags |
| C3 | **`main` runs lint and the test suites on every push** (the AIRPORT's own CI; tracked as a VOC issue linked from ATC-333), so GROUND STOP and the revert lane see test failures, not only a build failure. | A merge that builds but fails tests | At push | Fails the head's check | Red head count |
| C4 | **Automatic revert.** When a merge turns `main` red, the lander first re-runs the failed job once: green marks the red as flaky, with no revert (a work order goes to DUTY). Red again: it opens a revert PR for the merge that caused it, reviews and lands it by the same lane when CI is green, clears GROUND STOP on the next green head and tells DUTY. Guards: one revert at a time, never revert a revert, and after two reverts in an hour the breaker (C6) tightens instead of reverting again (revert storm). | A red `main` the author does not fix quickly | Minutes after the red head; target D16 | Re-runs, opens, lands and clears | Reverts landed, time to green, effects in that window, innocent reverts (misfires), storms |
| C5 | **Post-deploy check and rollback on AIRPORTs** where the host can promote a previous build: a smoke request and an error-rate read after the deploy, rollback on failure. | A deploy that passes CI and fails in production | Minutes after the deploy | Rolls back, latches GROUND STOP | Failed deploys per week |
| C6 | **Circuit breaker.** Over a rolling window it counts red heads, reverts, audit findings and disagreements, each only once confirmed (a red counts after one re-run of the failed job). Past a threshold it tightens by itself, in steps: restore the keyword and path gates, then AUTOLAND from `merge` to `update`, then GROUND STOP. It also restores a single control's gate when that control's live misfires cross its limit (principle 2). **Decided (D12, D13):** a trip disproved by a green re-run and a green next head reopens by itself, but never a brake and never the RTS-off-after-ROLLBACK latch (D4); a second trip for the same cause within 7 days needs a merged fix or a work-order link first. Any other loosening is a K3 approval. | A rising defect rate; a misfiring control | At each cycle (90 s) | Switches a mode down or restores a gate, reopens a disproved trip, sends one alert | Breaker state, every trip and reopen; self-reopens counted as its own misfires |
| C7 | **Audit sample and planted defects.** Known defects planted in copies of merged PRs, and replays of reverted PRs, measure each lane's misses and each pair's both-miss. **Decided (D17):** 10 a week on atc PRs to start (a public repository, so no outside data question), adjusted from the cost in the weekly report. A third reviewer, different from both lanes, still re-reviews about 10% of auto-merged heads after merge; its P0 or P1 findings count against the breaker. | Shared blind spots of C1 | Within the hour | Writes a record, no PR comment | Misses per lane, both-miss per pair, heads audited and findings |
| C8 | **Weekly report** (section 7), counted from the logs (principle 7), including leaks, misfires and the share of verdicts with no join key or no ground truth. | Drift | Weekly | Builds the report | The report |
| C9 | **K1, K2 and K3 declared at release** (section 6): the SUPERVISOR approves the declared effect once, when they release the FLIGHT; a floor compares the built content with the declaration, and a change beyond it stops the FLIGHT and comes back as a new arrow. | A built change beyond what was approved | At release, and at build | Refuses beyond the declaration; for K1, applies a matching migration (D6 g) | Releases with K effects; new arrows from envelope exits |
| C10 | **Verifier lane.** A session runs the change (tests, a smoke flow, the preview) and attaches evidence; replaces the HUMAN CHECK classes. | Failures visible only at runtime | Minutes | Attaches evidence, blocks on failure | Evidence per PR |
| C11 | **Spend caps** for the extra reviews and automatic LAUNCH: FUEL hold, `ATC_MAX_LAUNCHED`, a daily review budget, and rate caps on messages to our own sessions (principle 4). | Cost runaway; message floods | At each decision | Holds | Cost per merge; messages per FLIGHT |
| C12 | **K3 hardening.** Every SUPERVISOR-only route checks the localhost `Origin` (the routes found in 1.4), and AUTOLAND, MCC and RTS refuse any PR that touches a K3 path whatever the reviews say, from a rule file under `deploy/` that is itself `user` tier. The autonomy rules are data, each knob with a declared tightening direction, so a change's direction is computed (unknown counts as loosening; principle 3). Review and inspection records are accepted only from their lane, and an issue commenter counts as the SUPERVISOR only by configuration (principle 6). The Origin check only stops cross-site requests, so SUPERVISOR-only routes also need real authentication: a credential agents cannot read, or the server under a separate OS user (1.5). | An agent reaching a SUPERVISOR-only action, editing its own limits, or recording a review for itself | At the request | Refuses | Refusals |
| C13 | **State-format compatibility check.** A CI test parses the previous state files with the new code and allows only additive optional fields; a non-additive format or a rewrite of existing records is K1 (D15). | A format change that strands existing state | In CI | Fails the PR | Test result |
| C14 | **Agreement-based approval of proposals.** CREW CHANGE, SCHEDULE and FLEET PLAN items are approved when CROSSCHECK agrees (DISPATCH ASSIGN and LAUNCH no longer use it, D22), with the existing 1-in-5 blind sample kept for the SUPERVISOR to read, and caps from C11. | A wrong pairing or write | At the proposal | Approves, holds on disagreement | Auto versus manual agreement |
| C15 | **FLIGHT linkage.** A PR without a FLIGHT is linked to its issue by branch name or opens one; if none can be made it goes to DUTY. | Untraceable work | At PR open | Links or opens | Unlinked PRs |
| C16 | **Deploy hardening.** Dependency review as a required check; `npm ci` inside RTS before the restart, with the existing health check and ROLLBACK; relaunch of background sessions the health check finds killed. | A dependency change that breaks the service; sessions lost by a deploy | At deploy | Installs, checks, rolls back, relaunches | Deploys that needed rollback or relaunch |
| C17 | **Pre-publish scanner.** A hook (a K3 file) checks every push and PR creation for secrets and private-AIRPORT identifiers before they reach the public repository. | Publication that a revert cannot undo (principle 4) | At push | Refuses; a flag is a K2 new arrow | Flags per week |
| C18 | **Release record.** Each release is recorded with its FLIGHT, a hash of the declaration, and its channel: a click on the atc screen (Origin-checked), the SUPERVISOR's message in DUTY chat (verified by the server, which carries the chat), or their words to another session (attested by that session with the words and the time). DISPATCH takes only released FLIGHTs. | Work started without the SUPERVISOR; a false attestation | At release | Refuses an unreleased FLIGHT | Releases per channel; attested releases per session for spot checks |
| C19 | **Data fence.** Every reviewer and control packet wraps titles, bodies, issue text and comments as data, as DUTY's packets already do, and review criteria never come from editable text. | Instructions in text acting on a reviewer (principle 6) | In the packet | Fences | Packets without a fence (target 0) |
| C20 | **Migration rehearsal.** Each AIRPORT with a hosted database keeps a test database with the live schema and a recent data snapshot. After the declaration floor (C9) passes, atc applies the migration there and runs the app's smoke tests; only then does it take a restore point of the live database, apply, record the version and run a post-apply check. Any failure leaves live untouched and the FLIGHT returns as a new arrow; changes split into additive-first and destructive-later migrations. | Data-dependent failures (a constraint over existing data, a long lock) | Before each live apply | Rehearses, applies, checks, restores | Rehearsals passed and failed; post-apply failures |

## 6. The three kept gates, declared at release

Under the arrow (principles 1, 4 and 10) a K1–K3 effect is approved once, when the SUPERVISOR releases the FLIGHT, not at merge. The release declares the effect, and the release record (C18) binds the approval to a hash of the declaration (principle 7). After release a floor compares the built content with the declaration. A FLIGHT whose built change goes beyond it (an undeclared K path, a wider change, a statement the floor cannot classify) stops and comes back as a new arrow with the built content attached; that new arrow is the card. Nothing waits on the SUPERVISOR at merge time. The release stays minimal: the destination and the declared K effects, no path list and no per-FLIGHT budget (caps are C11).

- **K1: hosted migrations, live data, atc's own state records.** The declaration names every DML statement and every destructive object (`DROP`, `TRUNCATE`, a column type change, a rename, `DELETE` or `UPDATE` without a filter). The floor is strong for these classes and weak for logic (a wrong filter, a backfill), so any undeclared or unclassifiable statement is a new arrow. **Decided (D6 g):** when the built migration matches the declaration and its rehearsal on the test database passes (C20), atc takes a restore point, applies it and merges.
- **K2: secrets, money, legal text, rights, and data leaving atc's control.** The declaration names the environment keys (never values), the payment or legal text, the rights evidence, and any new outside destination or wider field allowlist (D14). The pre-publish scanner (C17) flags secrets or private-AIRPORT content at push; a flag is a new arrow. A card never prints a secret value.
- **K3: guards, permissions, `.claude/`, the autonomy rules, and every loosening.** The declaration states the widening; the server computes the diff of the permission sets and rule knobs (allow added, deny removed, hooks removed, a knob moved toward loosening; principle 3) and compares it with the declaration. Wider than declared, or a direction it cannot compute, is a new arrow.

## 7. The SUPERVISOR's weekly report

One page, built by C8 from existing records, shown as a block on the NETWORK tab (which already shows landing wait) and as one weekly ANNUNCIATOR notification. It is where the SUPERVISOR reviews the numbers; a loosen card (principle 3) may come at any time.

| Number | Source |
|---|---|
| PRs merged per AIRPORT by lane (AUTOLAND, MCC, by hand) | `autoland.jsonl`, `mcc.jsonl`, GitHub merged list |
| Residual SUPERVISOR merges, by reason | the exclusion log (survey W1) |
| Open to merge, median and p90 | LOGBOOK `landingWaitMin` |
| Red `main` heads per 100 merges, and time to green | `main` push runs |
| Revert and hotfix PRs within 72 h; auto-reverts landed and their outcome | GitHub, C4 records |
| Two-lane disagreements and how they ended; misses per lane and both-miss on planted defects; single reviews (D20) | `landing-reviews.jsonl`, `autoland-reviews.jsonl`, the second-lane log, C7 records |
| Audit sample: heads audited, P0 and P1 findings | C7 records |
| Tightenings: confirmed or disproved, self-reopens, hours held, items sent back (tightening load), second same-cause trips; loosen cards and their wait | C6 records |
| Cost per merge (review tokens, FUEL) | FUEL, judge logs |
| Releases: per channel, with K1–K3 effects, attested releases per session; new arrows from envelope exits | C18, C9 records |
| Brakes used, per kind (HOLD, CANCEL, RECALL, STOP, manual GROUND STOP, mode down) | `autoland.jsonl`, `mcc.jsonl`, `proposals.jsonl`, `atfm` records |
| DISPATCH misfires per day: declined, UNABLE, RECALL, superseded after send, wrong AIRCRAFT (D22); FLEET PLAN automatic versus manual agreement | `proposals.jsonl`, `fleet-plan.jsonl` |
| Leaks (principle 1): human steps after release, leak-minutes and the work held, split by whether the owner's control is live | SUPERVISOR QUEUE and NEEDS YOU open and close lines |
| Misfires per control and action, harmful and nuisance (principle 2) | live decision lines joined to outcomes |
| Time to revert and the effects in that window: messages sent, data sent out per destination, publications flagged (principle 4) | C4, C17, `clearances.jsonl` |
| Verdicts that cannot be joined to an outcome: no join key, or no ground truth (principle 7) | the logs |

## 8. Implementation order

A control lands before the gate it replaces is removed, and every step names its work orders (title, scope, expected tier), its off switch and misfire counter, and the live limit that keeps it on. **Decided 2026-10-02 (D21):** no step runs in shadow first; each control goes live with its switch and counter, and the measurements below are its live limits, not conditions for turning it on. The work orders are listed here and not created in Linear; DUTY or ENGINEERING will. Tiers follow `deploy/landing-tier.mjs`: a change to the AUTOLAND, MCC or landing-tier rules is a K3 file and goes through the SUPERVISOR once.

### Step 0: measure (this week, no gate changes)

- **WO-1 Exclusion log.** AUTOLAND writes one line when an exclusion starts on a CLEARED PR (its reason and head) and one when it ends, and a daily count (principle 7). Tier `flagged`.
- **WO-2 Escaped-defect record.** Count red `main` heads, revert and hotfix PRs, late review findings per week from GitHub and the logs; fix the LOGBOOK `reverted` write. Tier `auto` or `flagged`.
- **WO-3 Weekly report v0.** The section 7 block with the numbers that already exist. Tier `auto`.
- **MCC's existing gate.** `mccGateOf` shows 55 mismatches that never enter its go decision; adjudicate a sample (MCC false alarm or a person's slip) and add the misfire term (principle 2).
- Switch and counter: not needed (read only). Go: the report shows the residual SUPERVISOR merges by reason.

### Step 1: first controls live, with switch and counter (this week)

- **WO-4 Second review lane.** A different-vendor reviewer reviews each AIRPORT head, live with its counter; disagreements logged. Tier `flagged`.
- **WO-5 Reviewer-side classification.** The merge-review verdict gains `securityBoundary` with a reason, logged beside the keyword, path and label results. Tier `flagged`.
- **WO-6 Breaker v0.** A cycle counts red heads and reverts; past a threshold AUTOLAND drops from `merge` to `update` by itself and alerts once; only the SUPERVISOR raises it again, except that a disproved trip reopens by itself (D12). Tier `user` (an AUTOLAND rule: the SUPERVISOR merges this one).
- **WO-7 `main` tests on every push** on the AIRPORT (control C3; a VOC issue). Outside atc.
- **WO-8 Origin check on every SUPERVISOR-only route** (control C12, section 1.4). Tier `user` (server routes that guard autonomy; decision D10).
- Each goes live with its switch and counter. Limits: see step 2.

### Step 2: first gate cut, shippable this week (day 4 or 5, decided by measurement)

Gates L1, L2, L3 and L4 become delegable on AIRPORT A **when both lanes pass the head and the classifier agrees**. This is the first step that cuts SUPERVISOR merges on AIRPORT PRs: it removes the `Risk: Contract`, `Risk: Security`, `rating:SEC`, path and keyword exclusions, which together are the 79% of PRs the security gate touched.

- **WO-9 Dual-review delegation.** `mergeExclusionOf` lifts L1–L4 when C1 agrees; L5–L9 stay. Tier `user` (an AUTOLAND rule).
- Measurement that decides go (written now): over the first 50 live heads, agreement of at least 90%; the audit sample (C7) with no P0 or P1 miss on both-pass heads; breaker v0 live; C3 live. At about 17 PRs a day, 50 heads take about 3 days. Misfires (principle 2): the second lane's P0 or P1 false-alarm rate on an adjudicated sample and C2's over-flag rate stay under limits written before the run, and both-miss on planted defects (C7) stays under its limit.
- Expected effect: SUPERVISOR merges on AIRPORT A fall from about 117 a week to the residual of K1 migration PRs (16% by replay, declared at release and applied by atc when the built migration matches, or automatic when already applied), K2 and L8, L9 until their controls land (roughly 20% of PRs or fewer; WO-1 measures it).
- Rollback: the breaker, or one click restoring the exclusions.

### Step 3: auto-revert and weekly breaker v1

- **WO-10 Auto-revert lane (C4).** First as a proposal (a draft revert PR the SUPERVISOR sees but nothing lands), then landing by the same lane. The failed job is re-run once before any revert. Tier `flagged`.
- **WO-11 Breaker v1 (C6) and audit sample live (C7).** Thresholds per rate, tighten in steps. Tier `user`.
- Measurement that decides go: revert PRs correct and green on at least 5 cases or a replay of past red heads; no storm in the guard test; 0 innocent would-reverts on the replay, flaky reds included (the 2026-10-02 red in 1.5 is a fixture); breaker false trips at most 1 per window, with reds counted after one re-run.
- Then L15 (GROUND STOP clear) becomes automatic, with 0 premature clears on the replay; latches on a red that re-runs green are counted.

### Step 4: K effects declared at release (C9, C18)

- **WO-12 Release declaration for K1, K2, K3.** The release record (C18, [ATC-362](https://linear.app/vocado/issue/ATC-362)) carries the declared effects; floors compare the built content and stop the FLIGHT beyond them (section 6). Tier `user` (it changes who may start work and what lands).
- The gates stay; their moment moves from merge to release. Go: the floor misses 0 K paths on the last 20 K1 to K3 PRs.

### Step 5: narrow the `user` tier on atc

- **WO-13 State-format compatibility test (C13)** and additive-format PRs delegable to MCC. Tier `user` (landing-tier rule).
- **WO-14 Dependencies through dependency review and RTS `npm ci`** with health check and ROLLBACK. Tier `user` (deploy).
- Go: format-compat test green on the last 30 format PRs with 0 false passes on the replay (false fails reported); dependency review as a required check. Cuts the ESCALATE rows (28 a week) except K3 files.

### Step 6: more AIRPORTs and DISPATCH approvals

- **WO-15 AUTOLAND for other AIRPORTs** one at a time, each only with a required CI check and C3. Tier `user` (autoland.json airports list is read by an AUTOLAND rule; the SUPERVISOR enables per AIRPORT).
- **WO-16 Automatic DISPATCH and agreement-based approval.** ASSIGN and LAUNCH approved by the server under the planner filters and C11 caps ([ATC-367](https://linear.app/vocado/issue/ATC-367), D22); CREW CHANGE, SCHEDULE, then FLEET PLAN by C14. It goes live with its switch and counter; the existing verdict gate (20 verdicts at 80%) becomes a live limit. Tier `flagged`.
- Live limit for P1 and P2: the DISPATCH misfire share per day (declined, UNABLE, RECALL, superseded after send, wrong AIRCRAFT) under a limit written before the switch is turned on; crossing it turns the switch off and the cards return to the SUPERVISOR (principle 2). For C14: would-approve where the SUPERVISOR refused at most 2 per 100; would-hold where they approved reported as leaks.

### Step 7: verifier lane, FLIGHT linkage, post-deploy

- **WO-17 Verifier lane (C10)** and HUMAN CHECK classes retired in turn (CHOICE, DEVICE, then ACCOUNT). Tier `flagged`.
- **WO-18 FLIGHT linkage (C15).** Tier `flagged`.
- **WO-19 Post-deploy check and rollback for AIRPORTs (C5)** where the host supports it. Tier `flagged`.
- **WO-20 Spend caps (C11)** for the extra lanes. Tier `flagged`.
- Go: after step 3's numbers are stable for two weeks; WO-17 false blocks reported, WO-18 0 wrong links in 50, WO-19 at most 1 rollback of a healthy deploy.

### Added by the 2026-10-02 revision

- **WO-21 Release record (C18).** [ATC-362](https://linear.app/vocado/issue/ATC-362). Tier `user` when the DUTY guard changes.
- **WO-22 Leak counter (principle 1).** [ATC-363](https://linear.app/vocado/issue/ATC-363). Tier `auto` or `flagged`.
- **WO-23 Input binding (principle 7).** Content hashes on proposals, schedule, judges and fleet-plan records, a head field on clearances, and the release id on every record. Tier `flagged`.
- **WO-24 Text-trust fixes (principle 6, D19, L10).** Outside reviews never count, HUMAN CHECK from paths and the screen record, label skips as computed facts, review records bound to their lane, the data fence (C19). Tiers per file.
- **WO-25 Brake-honor test (principle 9).** A CI test that every lane refuses while each brake is set, and that a SUPERVISOR-only route answers 403 without Origin; joins WO-8. Tier `user`.
- **WO-26 Planted defects (C7, D17)** and **WO-27 pre-publish scanner (C17, a hook).** Tiers `flagged` and `user`.

No step leaves a window with neither a gate nor its control: step 2 requires C1, C2, C3, C6 v0 and C7 live with their counters; step 3 precedes the removal of the manual GROUND STOP clear; steps 5 to 7 need steps 3 and 4.

## 9. Risks

| Risk | What could happen | Mitigation |
|---|---|---|
| Two models share a blind spot | Both pass a bad change | Different vendors and instructions (principle 5); C7 audit by a third reviewer; agreement is a watched number; the breaker |
| Revert storms | A revert breaks `main` again, or reverts chain | One revert at a time, never revert a revert, breaker after two reverts in an hour (C4, C6) |
| A classifier gamed by PR text | A PR describes itself as harmless | The classifier reads the diff, text only raises risk (principle 6); deterministic floors stay |
| An agent edits the files behind K3 | An agent widens its own limits | K3 paths are `user` tier and refused by every lander (C12); the SUPERVISOR-only routes check `Origin`; note that every merge uses one GitHub login, so GitHub's own review rules cannot enforce this and atc's rules must |
| A prompt injection reaches a reviewer | A PR text instructs the reviewer (survey 1.6: a CVSS 9.4 flaw in AI review Actions) | Reviewers read a packet and run with no secrets; no review Action on `pull_request_target`; instructions in PR text are data |
| Cost of extra reviews | Two lanes plus audit about double the review tokens | Spend caps (C11); the audit is a 10% sample; cost per merge is in the weekly report |
| The breaker flaps | It tightens and loosens often | It tightens only on confirmed signals; a disproved trip reopens by itself, and a second same-cause trip within 7 days needs a fix (D12, D13); one alert per event |
| A self-reopen hides a real failure | A real red is taken for a flaky one | Disproof needs a green re-run and a green next head; never for brakes or the D4 latch; every self-reopen is counted as a breaker misfire |
| A false attestation | A session claims the SUPERVISOR's words to release a FLIGHT | Attested releases are marked and counted per session in the weekly report for spot checks (C18); a screen release cannot be made by an agent |
| A floor misses what the declaration hid | A migration's logic (a wrong filter, a backfill) passes the K1 floor | The declaration names every DML and destructive object; anything undeclared or unclassifiable is a new arrow; the floor's misses are measured before it goes live (principle 2) |
| A single review passes during a lane outage | A defect one lane would have caught lands | Single reviews are recorded and counted (D20); planted defects measure the single lane's misses (C7) |
| Pace outruns measurement | Gates leave before the data says so | Each control goes live with an off switch, a misfire counter and a limit written first; crossing it restores the gate by itself (principles 2 and 8) |
| Approval fatigue | Release declarations pile up | They are only K1–K3 at release, with no merge-time card; the weekly report counts them |
| AUTOLAND and MCC stall each other | A PR waits on two systems | One lander per AIRPORT (existing rule) |
| A small baseline | 7 days of data, 2 red heads | Thresholds are set on rates over a rolling window and reviewed at the first report |

## 10. Decisions for the SUPERVISOR

Recommended defaults, with the SUPERVISOR's decisions of 2026-10-02 marked **Decided**.

- **D1 Breaker thresholds.** Default: tighten when more than 3 `main` heads are red in any 50 merges (about 3 times the 1.7% baseline), or 2 reverts in 7 days, or an audit P0. A red head counts only after one re-run of the failed job. Reopening follows D12 and D13.
- **D2 Go condition for the first cut (step 2).** Default, as live limits: over the first 50 live heads, agreement at least 90%, no audit P0 or P1 miss on both-pass heads, misfire limits met (principle 2) and both-miss on planted defects under its limit.
- **D3 Review models.** Default: the second lane is a different vendor from the PR's author session (Codex when the author is Claude, the REVIEW lane when the author is Codex); the third (audit) reviewer is neither. Which vendor and plan, and a daily review budget, are the SUPERVISOR's. **Decided:** a sensitive PR whose content may not go to another vendor uses a pre-approved outside model for that AIRPORT (K2, approved at release), otherwise the same vendor with a different model, instructions and input, counted as partial independence.
- **D4 AIRPORT order.** Default: AIRPORT A (already delegating), then atc's `user` tier narrowing (step 5), then other AIRPORTs once each has a required CI check.
- **D5 Audit rate.** Default 10% of auto-merged heads.
- **D6 Where the three gates end** (questions, not designed in): (a) Is `.github/` (CI, required checks) part of K3? Recommended yes, because CI is a control. (b) Are `deploy/*.service` units part of K3? Recommended yes. (c) Is a dependency change in `package*.json` a gate? Recommended no (automate with dependency review). (d) Is granting a CHECKRIDE rating (a SEC rating decides who may take SEC work) part of K3? Recommended yes. (e) Is a tool-approval prompt a session waits on part of K3? Recommended yes; after release such a prompt is also a leak (principle 1). (f) Is an already applied migration (ATC-329) outside K1? Recommended yes, as built. (g) May atc itself apply a migration? **Decided 2026-10-02:** yes, when the built migration matches the declaration approved at release and its rehearsal on a test database passes (section 6, C20).
- **D7 Where releases and new arrows are made.** Default: the SUPERVISOR QUEUE and the FLIGHT drawer plus one ANNUNCIATOR notification; the SUPERVISOR's own words to a session count too (D9).
- **D8 Weekly report.** Default: Monday 09:00 local, NETWORK block plus one notification.
- **D9 Release.** **Decided:** only the SUPERVISOR releases a FLIGHT, by a click on the atc screen or by their own words to a session ("phone booking"); agents draft proposals and never release one (principle 10, C18). Labelling ideas and the DUTY charter stay direction inputs.
- **D10 Origin checks on every SUPERVISOR-only route** (section 1.4). Default yes, in step 1, independent of the rest.
- **D11 Brakes.** **Decided:** HOLD, CANCEL, RECALL, STOP, a manual GROUND STOP and switching a mode down are brakes, pulled and released by the SUPERVISOR; switching a mode up is a K3 loosening (principle 9).
- **D12 Self-reopen.** **Decided:** a trip disproved by a green re-run and a green next head reopens by itself; never a brake, never the D4 latch.
- **D13 Same-cause window.** **Decided:** 7 days; a second trip for the same cause needs a merged fix or a work-order link before it reopens.
- **D14 K2 covers data leaving atc's control.** **Decided:** yes, enforced first by floors (C17, C12) so that only flags reach the SUPERVISOR.
- **D15 Rewriting atc's own state records is K1.** **Decided:** yes (C13).
- **D16 Time to revert.** Default: 15 minutes from a confirmed red (C4).
- **D17 Planted defects.** **Decided:** 10 a week on atc PRs to start, adjusted from the cost in the weekly report (C7).
- **D18 Sensitive PRs.** **Decided:** no human gate; the review order of D3 applies.
- **D19 Outside reviews.** **Decided:** a GitHub review by a non-collaborator never counts as a review; only atc's lane records do (principle 6).
- **D20 Lane outage.** **Decided:** a PR that needs two lanes passes on a single review when a lane is down, recorded as a single review and counted (L16).
- **D21 Live first.** **Decided:** no shadow runs; every control goes live with an off switch and a misfire counter, and the measurements of section 8 are its live limits. K1 migrations are rehearsed on a test database (C20); an outside destination approved at release (K2) is used live at once.
- **D22 DISPATCH.** **Decided 2026-10-02:** the server approves every ASSIGN and LAUNCH card that passes the planner's deterministic filters and the C11 caps; CROSSCHECK leaves the DISPATCH path and there is no blind sample. It goes live with a SUPERVISOR-only off switch and a misfire count from late outcomes. Since 2026-10-01 06:00Z the SUPERVISOR had made 102 manual approvals and 2 rejections, with 7 automatic [observed].
- **Open, not decided:** whether DISPATCH RELEASE and CLASSIFY cards follow D22; whether SCHEDULE NEW drafts approved by CROSSCHECK agreement (C14) land in Backlog as proposals; the one bulk confirmation of the current Todo list proposed in ATC-362; how a background AIRCRAFT avoids permission prompts after release (a standing allowlist, or denying instead of prompting); whether C7 audits single-review heads first.
