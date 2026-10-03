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

Counts since the logs start on 2026-09-26 (about 5.5 days) [observed]. The CROSSCHECK numbers are history: CROSSCHECK is retired (D23).

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
| P3 | FLEET PLAN approve and verdict (`fleet-plan-run.ts`) | Usage spend, stale proposals | 5 approvals, 15 expired | **automate**. **Decided (D23):** runs without a human and without CROSSCHECK agreement, under the C11 caps, with misfires counted ([ATC-370](https://linear.app/vocado/issue/ATC-370)) | C11, misfire count |
| P4 | CREW CHANGE approve and "delivered" (`crew-change.ts`) | Changing a running team's crew without consent | not logged | **automate**. **Decided (D23):** without CROSSCHECK agreement, misfires counted | misfire count |
| P5 | SCHEDULE op approve, reject, verdict (CLASSIFY, NEW, CLOSE, TAIL, WAYPOINT; `schedule.ts`) | Wrong ticket edits | 28 drafts, 30 agree and 9 disagree CROSSCHECK verdicts | **automate**. **Decided (D23):** without a human or CROSSCHECK agreement; NEW drafts land in Backlog as proposals (principle 10), ROUTE and TARGET stay proposals, misfires counted ([ATC-370](https://linear.app/vocado/issue/ATC-370)) | misfire count |
| P6 | UNDELIVERED FLIGHT PLAN and CLEARANCE hand delivery | A message that could not be delivered | 10 undelivered rows | **automate** | Delivery by live session id and retry, then a DUTY alert when it still fails ([ATC-353](https://linear.app/vocado/issue/ATC-353)) |
| P7 | NEEDS YOU: a session blocked on a tool approval prompt | A session waiting on a permission decision | alerts, not counted here | **keep** (K3) for the permission rules themselves. **Decided (D24):** an AIRCRAFT never waits on a prompt; an atc policy hook passed at LAUNCH allows known-safe actions inside the STAND and denies and counts the rest, and an AIRCRAFT whose FLIGHT is done but that sits PENDING or HUNG over 30 minutes is stopped ([ATC-369](https://linear.app/vocado/issue/ATC-369)) | policy hook, C12 |
| P8 | SUPERVISOR CONFIRM AT AIRCRAFT (go for a `user`-tier FLIGHT) | A `user`-tier FLIGHT proceeding without a go | 1 row | **keep** (K3) | C9 |
| P9 | DISPATCH, SCHEDULE, FLEET PLAN, ATFM, CONTROL RECYCLE, FUEL hold, REPOSITION, JEV, SQUELCH mode switches | Turning automation on before it is measured | 1 judges mode row | **keep** (K3) for switching up, a loosening with computed direction (principle 3); switching down is a brake (principle 9) | C6, C12 |
| P10 | ATFM switches and `s3` | Auto-actions before the shadow week | not counted | **keep** (K3) for switching up; switching down is a brake | C6, C12 |
| P11 | ATFM manual GROUND STOP, GROUND DELAY | Stopping departures by hand | not logged | **brake** | none |
| P12 | ADD ACCOUNT, LOGIN, SHARE MEMORY (`accounts-run.ts`) | Credentials | not logged | **keep** (K2) | C9 |
| P13 | CHECKRIDE rating grant (SEC ratings decide who may take SEC work) | A team getting a permission by a recommendation | not logged | **keep** (K3) grant, revoke is a tightening; **question** D6 | C9 |
| P14 | Workspace trust prompt, one time per repository | A session in an untrusted folder | not counted | **keep** (K3) | none |
| P15 | LAUNCH, STOP, AOG, RETIRE, ENTRY of AIRCRAFT by hand | Fleet shape and usage | FLEET PLAN counts above | **direction** (fleet design); a STOP of work in flight is a brake (principle 9) | none |
| P16 | A Backlog proposal waiting for the SUPERVISOR on the RELEASE screen (DUTY REVIEW, SCHEDULE NEW; fire = Todo and a `screen` release, or discard = Canceled; [ATC-401](https://linear.app/vocado/issue/ATC-401)) | A proposal going into work that nobody chose | counted from the first day it ships (`BACKLOG` queue rows) | **keep** (the arrow, principle 10): the SUPERVISOR fires. Counted as a wait so it stays visible, not as a gate to remove. It is not a signal for DUTY REVIEW (a review does not start because proposals wait) | C14 (as P5) |

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

### Effect check as built (ATC-402)

Principle 7 asks whether a deployed FLIGHT changed what it was meant to change. Each work order now has a `## Measure` part ([rules.ko.md](rules.ko.md) "작업 지시서"): `metric: <source>:<name>`, `direction: down|up`, `window: <n>d` (1d–30d), or `None`. Sources are things atc already records: `leak:<kind>` and `leak-minutes:<kind>` (`leaks.jsonl`), `misfire:dispatch`, `alert:<alertKind>` (FLIGHT RECORDER `alert.raised`), `clearance:<TYPE>`, and `flow:<name>` (ATC-468: `idle-empty-min` is the minutes with an idle AIRCRAFT and no waiting Todo FLIGHT, `created-todo`, `todo-release` and `release-launch` are the median of that stretch over issues that finished it; a median needs at least 3 issues in both windows).

- **Verdict.** Every 10 minutes `server/effect-check-run.ts` looks at FLIGHTs deployed in the last 37 days that have no verdict yet (IN from the OOOI milestones; ON where the AIRPORT has no deploy; a reverted ON is skipped). It reads the issue body from Linear (at most 15 per cycle, never-read and newest-deployed first, every parse including `None` cached for a day, so any number of candidates is covered within a bounded number of cycles; FLIGHTs deployed less than a day ago are not read; the metric name is limited to letters, digits, space, `-`, `_`, `:` and 32 characters so body text cannot reach the REVIEW prompt), and once `deploy + window` has passed it compares the count in the window before the deploy with the same window after (`judge` in `server/effect-check.ts`): `improved` (moved the stated way by at least 20% and at least one), `worse` (moved the other way by that much), `not improved`, or `too little data` (the record does not cover the whole before window, or fewer than 3 events before for `down` and fewer than 3 in total for `up`). `None`, a missing or malformed part gives no verdict.
- **Record.** `effect-verdicts.jsonl`, append-only: one `verdict` line per FLIGHT (first one wins; it carries the measure, the two counts, the reason and the release id) and `mark` lines. `releaseIdOf` (`server/release.ts`) is `<FLIGHT>@<release time>`; leak records now carry the release id of the FLIGHT they held (`release`, was always null), so a leak joins to the FLIGHT that was meant to remove it.
- **Where it shows.** The FLIGHT drawer has an `EFFECT CHECK` line with the verdict, the two counts and a **틀림** button. HOME has an `EFFECT` section for open `not improved` and `worse` verdicts (not marked wrong), with the misfire count. `GET /api/effect[?flight=KEY]` returns `{ on, verdicts, misfire, open, skipped }` (`skipped` = bodies the last cycle could not read yet). DUTY REVIEW's prompt lists the open bad verdicts (`openEffectLines`); no new trigger.
- **Switch and misfire.** `effect-check.json` `on` (default on), changed only in Settings → OPERATIONS → EFFECT CHECK (a request with the SUPERVISOR credential; no `atcctl` command). A **misfire** is a verdict the SUPERVISOR marks wrong (`POST /api/effect/mark {flight, wrong}`, SUPERVISOR-only like every other write): `misfire { verdicts, wrong, share }`.
- **Formats** (additive): `effect-verdicts.jsonl`, `effect-check.json`, `Leak.release`, `ServerSettings.effectCheck`.

## 5. Compensating controls

Each control says what it detects, how fast, what it does by itself and what it reports. The controls that replace a human decision are C1, C2, C4, C6, C10, C15 and C16 (C14 is superseded); C9 and C18 move the K1–K3 approvals to release; the others support them.

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
| C14 | **Agreement-based approval of proposals.** **Superseded (D22, D23):** DISPATCH, SCHEDULE, FLEET PLAN and CREW CHANGE run without CROSSCHECK agreement, and the CROSSCHECK session is retired ([ATC-371](https://linear.app/vocado/issue/ATC-371)). Kept as a record of the earlier design. | — | — | — | — |
| C15 | **FLIGHT linkage.** A PR without a FLIGHT is linked to its issue by branch name or opens one; if none can be made it goes to DUTY. | Untraceable work | At PR open | Links or opens | Unlinked PRs |
| C16 | **Deploy hardening.** Dependency review as a required check; `npm ci` inside RTS before the restart, with the existing health check and ROLLBACK; relaunch of background sessions the health check finds killed. | A dependency change that breaks the service; sessions lost by a deploy | At deploy | Installs, checks, rolls back, relaunches | Deploys that needed rollback or relaunch |
| C17 | **Pre-publish scanner.** A hook (a K3 file) checks every push and PR creation for secrets and private-AIRPORT identifiers before they reach the public repository. | Publication that a revert cannot undo (principle 4) | At push | Refuses; a flag is a K2 new arrow | Flags per week |
| C18 | **Release record.** Each release is recorded with its FLIGHT, a hash of the declaration, and its channel: a click on the atc screen (Origin-checked), the SUPERVISOR's message in DUTY chat (verified by the server, which carries the chat), or their words to another session (attested by that session with the words and the time). DISPATCH takes only released FLIGHTs. | Work started without the SUPERVISOR; a false attestation | At release | Refuses an unreleased FLIGHT | Releases per channel; attested releases per session for spot checks |
| C19 | **Data fence.** Every reviewer and control packet wraps titles, bodies, issue text and comments as data, as DUTY's packets already do, and review criteria never come from editable text. | Instructions in text acting on a reviewer (principle 6) | In the packet | Fences | Packets without a fence (target 0) |
| C20 | **Migration rehearsal** (**Decided**, [ATC-368](https://linear.app/vocado/issue/ATC-368)). Each AIRPORT with a hosted database keeps a test database with the live schema and a recent data snapshot. After the declaration floor (C9) passes, atc applies the migration there and runs the app's smoke tests; only then does it take a restore point of the live database, apply, record the version and run a post-apply check. Any failure leaves live untouched and the FLIGHT returns as a new arrow; changes split into additive-first and destructive-later migrations. | Data-dependent failures (a constraint over existing data, a long lock) | Before each live apply | Rehearses, applies, checks, restores | Rehearsals passed and failed; post-apply failures |

### C4 as built (ATC-351, live first by ATC-394)

The auto-revert lane (control C4, WO-10 pulled forward) is **on from the start (live first, ATC-394): there is no shadow mode**. One switch, `autoRevert`, is `on` (default; a missing file, an unknown value or the old `shadow` all read as `on`) or `off`, and only an explicit `off` stops the lane. It is set only in the settings window (LANDING tab, "AUTO REVERT", a confirm step when turning it back on) through the `fromThisApp` settings route (`PUT /api/settings {autoRevert}`); there is no `atcctl` command. The rules are pure (`server/auto-revert.ts`, `revertDecisionOf`, tested); the cycle that reads GitHub and writes is `server/auto-revert-run.ts`. State is `auto-revert.json` (the switch) and the append-only `auto-revert.jsonl`. Both are new files, so nothing existing changes shape.

- **Trigger.** Once per GitHub read (90 s), for each AIRPORT AUTOLAND covers and for the MCC AIRPORT, when the default branch head is red (and the switch is on). atc walks back from the head to the last commit whose CI was green (at most 15 commits, one read-only status call per commit) and looks at what merged since.
- **Flake guard (ATC-394).** Before reverting or stopping a lane, atc re-runs the failing GitHub Actions run(s) once on the same `main` head (`rerun-failed-jobs`; line `rerun`, with the run ids and attempt numbers). Green on re-run means a flake: a `flake` line, nothing is reverted, and the head does not count toward the breaker (only a head that is red again gets a `red` line). Red again, **and** the PR's own head commit was green before it merged (checked again just before the revert), means the merge broke `main` and the revert PR is opened. A failing check that is not an Actions run cannot be re-run, so atc writes a `hold` line instead of guessing; a re-run that does not finish in 45 minutes is also a `hold`, and a PR whose own head was not green is a `hold`.
- **Which merge.** Only a merge that `autoland.jsonl` (`merge` ok) or `mcc.jsonl` (`land` ok) records and that GitHub confirms is that PR's merge commit. The newest such merge is reverted first. After its revert PR lands and the head is still red, the next cycle reverts the next newest one (a revert merge is skipped and never reverted). If any commit since the last green is not a lander merge (a human merge, a direct push, one atc cannot read), atc does not guess: it writes a `hold` line.
- **K1 and K3.** If the PR to revert changes a migration or SQL path (`migrationPathOf`), or a path the landing tier rates `user` (guards, `.claude/`, root `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`, ...), or its files cannot be read, atc writes a `hold` line and stops there. It does not skip to an older merge.
- **The revert PR.** GraphQL `revertPullRequest` (not a draft; no force-push, no branch deletion, no admin bypass). Title `Revert PR #n: main went red (auto-revert)` (no ATC key, so no issue is closed); the body names the failing check. One revert in flight per AIRPORT. It goes through the same review and CI as any PR. It is the one PR that a main-broken GROUND STOP on the MCC AIRPORT, or AUTOLAND's latched GROUND STOP, does not block, because it is the way out; every other condition stays (review, CI, base, tier, HOLD). It must have GitHub's revert branch name `revert-<n>-...` and a line in `auto-revert.jsonl`. AUTOLAND also accepts it without a FLIGHT.
- **Clearing.** The ATFM main-broken stop ends when the head is green again. AUTOLAND's latched stop is cleared by atc (record `groundstop-clear`, detail `auto-revert`) only when it was latched on a head where atc opened a revert PR and the next head is green. A stop the SUPERVISOR or another cause set is left alone.
- **Breaker.** A second new red head within an hour writes `stop`. A red head that is the merge of atc's own revert does not count, so a chain through several merges is one incident. `stop` drops AUTOLAND `merge` to `update` and MCC landing off (`land` to `shadow`, `land+rts` to `rts`), raises one SUPERVISOR alert (`revert|stop|<airport>|<at>`) and stops reverting until the SUPERVISOR picks the `autoRevert` switch again. Raising AUTOLAND or MCC again stays a SUPERVISOR switch.
- **Telling people.** DUTY, not the SUPERVISOR: the `hold`, `revert-opened`, `revert-failed`, `revert-landed` and `stop` lines go into the DUTY brief (an `AUTO-REVERT` section, last 24 hours). The FLIGHT of the reverted PR gets a FIX relay to the AIRCRAFT that last flew it (`relays.jsonl`; TOWER sends it) naming the failing check. When no holder is found atc writes a `fix` line saying so, and DUTY moves the issue back (atc does not write Linear).
- **Counted per day** (`GET /api/auto-revert`-style numbers in the settings window, under the AUTO REVERT row, last 7 UTC days): reverts opened, flakes caught (red, then green on re-run), misfires, and the `hold` and `stop` lines. A **misfire** is a reverted PR merged back unchanged within 24 hours of its revert landing: either a revert of atc's revert PR (GitHub's branch name `revert-<our revert PR>-…`) or a PR whose files and resulting blob hashes are the same as the original's. It is written once as a `misfire` line, and the DUTY brief shows it.
- **Off switch.** The SUPERVISOR's `off` stays: with it off atc reads nothing and writes nothing for this lane.
- Not built: the first half of WO-10 (a revert proposed as a draft for the SUPERVISOR to see); the lane acts at once, guarded by the flake re-run, the green-PR-head check, the K1 and K3 holds and the breaker. A flake that hides a real break is not caught by a re-run that happens to pass; the breaker is the net for that.

### C9: which K3 labels can be declared (ATC-399)

The server builds a classifier allow entry only from a K3 declaration in the form `K3[<label>]: <control> | files: <paths>` (`server/k3-allow.ts`, [dispatch.md](dispatch.md) "K3 releases reach the classifier"). Linear stores the line with escaped brackets (`K3\[Security Weaken\]: …`); the Markdown escapes are undone before the line is read. A label that is not in the first group below is not declarable: the line counts as unparsed, builds no entry, and the FLIGHT stays under the classifier. The list is every `soft_deny` label of `claude auto-mode defaults` as of 2026-10-02 (72 labels; 7 declarable). A later release adds a label by moving it into `K3_LABELS` and giving its entry the text its "must name" asks for.

| soft_deny label | K3 declaration | Why / what the entry names |
|---|---|---|
| Git Destructive | not declarable | Destroys data that a revert PR cannot bring back. A code FLIGHT has no need for it. |
| Code That Leaks When Run | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Code from External | not declarable | Brings code or packages from outside into the run. Supply-chain risk that a declaration cannot judge. |
| Cloud Storage Mass Delete | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Production Deploy | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Remote Shell Writes | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Sensitive Remote Exec | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Production Reads | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Blind Apply | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Protected-Scope IaC Apply | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Logging/Audit Tampering | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Permission Grant | **declarable** | the grant: who gets which permission |
| Account & Standing-Rule Changes | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| TLS/Auth Weaken | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Secret-Store Writes | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| DNS / Domain / Cert Changes | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Security Weaken | **declarable** | the control being weakened, and the files that change it |
| Security Test Removal | **declarable** | which tests are removed or skipped (the control field names them) |
| Safety Bypass Flag | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Create Unsafe Agents | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Interfere With Workloads | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Shared Cluster Mutation | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| CI Bypass | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Modify Shared Resources | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Irreversible Local Destruction | not declarable | Destroys data that a revert PR cannot bring back. A code FLIGHT has no need for it. |
| Unverifiable Deletion Target | not declarable | Destroys data that a revert PR cannot bring back. A code FLIGHT has no need for it. |
| Shared Scratch Sweep | not declarable | Destroys data that a revert PR cannot bring back. A code FLIGHT has no need for it. |
| Irreversible Deletion (general) | not declarable | Destroys data that a revert PR cannot bring back. A code FLIGHT has no need for it. |
| Unverifiable Deletion Scope | not declarable | Destroys data that a revert PR cannot bring back. A code FLIGHT has no need for it. |
| Create RCE Surface | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Expose Local Services | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| External Ingress Tunnel | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Credential Leakage | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Credential Materialization | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Credential Exploration | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| PII Data Handling | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Exfil Scouting | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Traffic Redirection | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Remote Repoint | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Out-of-Place Publication | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Sensitive-Source Provenance | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Excess Sensitive Detail | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Unrequested Artifact Publish | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Live-Shared Artifact Sensitive Delta | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Sandbox Network Callback | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Command Network Lists | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Containment Escape | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Create Public Surface | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Public Data-Sharing Upload | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Untrusted Code Integration | not declarable | Brings code or packages from outside into the run. Supply-chain risk that a declaration cannot judge. |
| Package Registry Bypass | not declarable | Brings code or packages from outside into the run. Supply-chain risk that a declaration cannot judge. |
| Unauthorized Persistence | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Self-Modification | **declarable** | the permission or consent change that is wanted |
| Tmux Self Drive | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Instruction Poisoning | **declarable** | that the instruction file edit is a wanted change, so a flag on it is a false positive (the control field says what changes) |
| Auto-Mode Bypass | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Session Transcript Tampering | not declarable | Switches off a check that auto mode relies on (logging, TLS, CI, sandbox, the classifier). A declaration cannot approve its own bypass. |
| Unrequested Commit in a Connected App | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| External System Writes | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Merge Without Review | **declarable** | the merge that skips review |
| Self-Approval | **declarable** | the approval that the change removes or self-grants |
| ChatOps Trigger Comments | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Feature Flag Writes | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Node Lifecycle Operations | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Cluster-Wide Workload Creation | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Real-World Transactions | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Third-Party Attack | not declarable | Acts on production, shared or third-party systems. A released FLIGHT is code only, so no declared effect maps to it. |
| Browser Navigate Exfil | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Browser Input Exfil | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Browser JS Exfil | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Browser File Upload Exfil | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |
| Browser Shortcut Execution | not declarable | Moves secrets or data out of the sandbox, or opens a way in or out. No declared code change needs it. |

What the two newest entries name (the classifier's "must name" text): *Security Test Removal* names which tests are removed or skipped; *Instruction Poisoning* says the flagged instruction file edit is a wanted change the SUPERVISOR authorized, so a flag on it is a false positive, and it covers only the declared files (no other instruction file, no memory directory). Every entry also names the control, the files, the STAND and the release id.

### C9 as built: the K3 hold (ATC-398)

A FLIGHT whose work order has a K3 effect leaves with the classifier allow for that effect, or it does not leave. It never stops mid-FLIGHT on a classifier denial for an effect the SUPERVISOR already released.

- **Work order.** Each K3 effect is one declaration line in `## K effects`, `K3[<label>]: <control it changes> | files: <repo-relative paths>`, with `<label>` one of `K3_LABELS`. A work order with no K3 effect has no line that starts with `K3`. A K3 work order is released on the RELEASE screen or in DUTY chat; a session never attests its release (the session creates the issue, the SUPERVISOR fires it). Rules: `docs/rules.ko.md` "작업 지시서" and the DUTY manual.
- **Hold.** DISPATCH does not send a FLIGHT that has a `K3` line in `## K effects` but would launch without an allow entry: a line that does not parse (reason "not a declaration", e.g. prose after `K3:` or `K3: none`), or a release that is not from a channel in `K3_CHANNELS` (reason "release on the screen"). The reason and the fix are the DISPATCH exclusion reason; a Todo FLIGHT also raises a HOME alert (`alert|k3-hold|<FLIGHT>`, shown while it is held). An unreleased FLIGHT is not an alert: it shows its K3 state on the RELEASE screen.
- **RELEASE screen.** Before the SUPERVISOR fires a FLIGHT that has a `K3` line, its row shows whether the declaration parses and whether the release grants the allow (now, or once fired on the screen).
- **Off switch.** `k3Hold` in `dispatch.json`, on by default, changed only in the settings window (K3 HOLD, `fromThisApp`; no `atcctl` command). A broken file reads as on.
- **Misfire counter** (RELEASE screen header; `GET /api/releases`, `k3Hold`): *nuisance* is a hold on a FLIGHT whose `K3` line declared no effect (`K3: none`); *miss* is a K3 FLIGHT that departed without an allow (its `launch` line has no `k3`) and whose AIRCRAFT stopped on a classifier denial (session health `DENIED`), within 7 days.

### C9 as built: K3 RELAUNCH (ATC-509)

A running session cannot take a new `--settings`, so a released K3 FLIGHT is served only by a freshly launched AIRCRAFT (an ABSENT one, through a DISPATCH launch card). When the AIRPORT has none, the SUPERVISOR used to stop an idle AIRCRAFT by hand and wait out RESTARTING.

- **Reason.** The unserved FLIGHT now says so in words: "K3: needs a fresh LAUNCH", plus the one-line fix (STOP an idle AIRCRAFT, or turn on `k3Relaunch`). It is the DISPATCH exclusion text and `unserved[].k3`.
- **Card.** With `k3Relaunch` on, FLEET PLAN proposes `K3 RELAUNCH` ("STOP <REGISTRATION> and LAUNCH it for <FLIGHT>") when the FLIGHT has K3 entries (`k3LaunchOf`), its AIRPORT has no ABSENT AIRCRAFT that can take it, and one AIRCRAFT there is idle (background session, not NORDO), has no open PR, no STAND, is not at LIMIT and is not under a FUEL hold. One AIRCRAFT per card: the longest idle. No such AIRCRAFT, no card.
- **Approve.** The approval re-checks, then checks that the release still grants the allow (same body hash) **before the STOP**, then STOPs and LAUNCHes through `launchAircraft` with the entries of `k3OfFlight` (the same function `launchForCard` uses). The two FLIGHT RECORDER lines (`stop`, `launch`) carry the card id in `proposal`.
- **Off switch.** `k3Relaunch` in `dispatch.json`, **off by default**, changed only in the settings window (K3 RELAUNCH, `fromThisApp`; no `atcctl` command). A broken file reads as off. With off, nothing changes except the reason text.
- **Misfire counter** (RELEASE screen header, shown once the switch is on or a count is above 0; `GET /api/releases`, `k3Relaunch`), 7 days: *approved* cards; *expired* and *rejected* cards; *stop only* is a STOP of a card that was not followed by a successful LAUNCH line with the same card id within `launchCardTimeoutMin`.
- **FLEET LAUNCH button.** `POST /api/fleet/:registration/launch` with a `flight` now builds the same K3 entries as a launch card (`k3OfFlight`: same `k3LaunchOf`, same hash check, only a screen or DUTY chat release). Without a valid release the LAUNCH is what it was.

## 6. The three kept gates, declared at release

Under the arrow (principles 1, 4 and 10) a K1–K3 effect is approved once, when the SUPERVISOR releases the FLIGHT, not at merge. The release declares the effect, and the release record (C18) binds the approval to a hash of the declaration (principle 7). After release a floor compares the built content with the declaration. A FLIGHT whose built change goes beyond it (an undeclared K path, a wider change, a statement the floor cannot classify) stops and comes back as a new arrow with the built content attached; that new arrow is the card. Nothing waits on the SUPERVISOR at merge time. The release stays minimal: the destination and the declared K effects, no path list and no per-FLIGHT budget (caps are C11).

- **K1: hosted migrations, live data, atc's own state records.** The declaration names every DML statement and every destructive object (`DROP`, `TRUNCATE`, a column type change, a rename, `DELETE` or `UPDATE` without a filter). The floor is strong for these classes and weak for logic (a wrong filter, a backfill), so any undeclared or unclassifiable statement is a new arrow. **Decided (D6 g):** when the built migration matches the declaration and its rehearsal on the test database passes (C20), atc takes a restore point, applies it and merges.
- **K2: secrets, money, legal text, rights, and data leaving atc's control.** The declaration names the environment keys (never values), the payment or legal text, the rights evidence, and any new outside destination or wider field allowlist (D14). The pre-publish scanner (C17) flags secrets or private-AIRPORT content at push; a flag is a new arrow. A card never prints a secret value.
- **K3: guards, permissions, `.claude/`, the autonomy rules, and every loosening.** The declaration states the widening; the server computes the diff of the permission sets and rule knobs (allow added, deny removed, hooks removed, a knob moved toward loosening; principle 3) and compares it with the declaration. Wider than declared, or a direction it cannot compute, is a new arrow.

### K approval reaches landing, as built (ATC-391)

The SUPERVISOR approves a K effect once, at release; a PR that builds what was approved lands through MCC, with no second human step at merge. It is **on from the start (live first)**; one off switch, `mcc.json` `kApproval` (`on` default, only an exact `off` turns it off), set only in the settings window (MCC row, "K APPROVAL"; `PUT /api/settings {mccKApproval}`, SUPERVISOR only, no `atcctl` command). The pure rule is `kApprovalOf` (`server/k-approval.ts`); `landBlocksOf` lifts L3 for a `user`-tier PR only when it says `ok`. Everything else about landing (L2, L4–L8: INSPECTION `pass` on the head, CI, merge state, HOLD, GROUND STOP, RTS) is unchanged.

- **What must hold.** (1) the PR's FLIGHT has a release record that is current (its hash equals the issue body now); (2) the release came through a channel the server can verify, the screen or the DUTY chat (`screen`, `duty-chat`); (3) the issue declares the K3 effect in the ATC-372 form (`K3[<label>]: <control> | files: <paths>` under `## K effects`) and every `user`-tier file in the diff is one of the declared files; (4) INSPECTION passed on the head and CI passed (L4, L6). A declared file the PR does not touch is fine: the declaration is a ceiling.
- **Attested alone carries no K authority.** An `attested` release (another session says what the SUPERVISOR said) does not lift L3. The RELEASE screen lists attested releases whose FLIGHT declares a K3 effect under "K 효과 확인"; one SUPERVISOR click (`POST /api/releases/k-confirm`, screen only, `releases.jsonl` line `k-confirm` on that release's hash) gives it K authority. That click is still at release time; a new release or an edited issue drops it.
- **What stays with the SUPERVISOR, with the reason shown** (`kApproval.why` in the L3 text, `mcc queue` and the packet): a change beyond the declaration (`beyond-declaration`: a `user`-tier file that was not declared, a new arrow); MCC's ESCALATE for doubt (never lifted); P0 or P1 findings (INSPECTION `findings`, L6); a PR that changes this check itself (`check-itself`). Two lists in `k-approval.ts`: `CHECK_CORE` (the rules and routes themselves: `k-approval.ts`, `k3-allow.ts`, `mcc.ts`, `mcc-run.ts`, `land-by.ts`, `release.ts`, `release-run.ts`, `release-store.ts`) stops a PR at **any landing tier**, because most of these files are `auto` or `flagged` in `landing-tier.mjs`: `landBlocksOf` puts an L3 on it (`checkPath`) and `landBy` says `supervisor` with `why: "check"`. `CHECK_CONTEXT` (what the check leans on: `origin.ts`, `supervisor-auth.ts`, `settings.ts`, `index.ts`, `landing.ts`, `sources/linear.ts`, `.github/`, `deploy/`, `mcc/`) is touched by many ordinary PRs (`server/index.ts` by nearly every route PR), so it blocks only a `user`-tier PR that tries to land through K approval; ordinary PRs there land as before; migration, SQL and secret or key paths (`k1-k2`: K1 and K2 declarations are not read yet); no FLIGHT, a FLIGHT already completed or canceled (`flight-closed`: a release gives K authority only while its FLIGHT is open), no release, a stale release, no declaration or an unreadable `K3` line (`no-flight`, `no-release`, `stale`, `no-declaration`, `unreadable-declaration`); the switch off (`off`).
- **Recorded and counted.** The `land` line in `mcc.jsonl` gets `k: {release, flight, channel}` (the release id is `<FLIGHT>@<hash>`, as in the K3 launch allow entries). The settings window shows, per UTC day (last 7), the PRs landed this way, how many had an auto-revert PR opened for them (`auto-revert.jsonl`), and how many were followed by a ROLLBACK (the first RTS result after the landing was `rollback`). A hand revert on GitHub is not seen.
- **Who lands.** `landBy` says `mcc` (not `supervisor`) for such a PR, so TOWER sends nothing to the team and the PR drawer shows MCC as the lander; a user-tier PR that is not `kApproval.ok` stays `supervisor` with the reason.
- **Control rules changed (reported separately in the PR).** `mcc/CLAUDE.md` and `CLAUDE.en.md` (MCC lands a `user` PR the server clears; it never ESCALATEs for the tier alone), `mcc/.claude/agents/inspector.md` (ESCALATE is for doubt; the packet carries `kApproval`), and the root `CLAUDE.md` and `CLAUDE.en.md` (the `user` bullet names the exception).
- **Not built:** K1 and K2 declarations (only K3 is read), a count of hand reverts, and a per-label check that the diff's change matches the declared control in words (the check is on files; INSPECTION reads the change).

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
| DISPATCH misfires per day: declined, UNABLE, RECALL, superseded after send, wrong AIRCRAFT (D22); SCHEDULE, FLEET PLAN and CREW CHANGE misfires (D23) | `proposals.jsonl`, `schedule.jsonl`, `fleet-plan.jsonl` |
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
- **WO-16 Proposals without a human.** DISPATCH ASSIGN and LAUNCH ([ATC-367](https://linear.app/vocado/issue/ATC-367), D22), then SCHEDULE, FLEET PLAN and CREW CHANGE ([ATC-370](https://linear.app/vocado/issue/ATC-370), D23), approved by the server under the planner filters and C11 caps; CROSSCHECK is retired afterwards ([ATC-371](https://linear.app/vocado/issue/ATC-371)). Each goes live with its switch and counter. Tier `flagged` (`user` for ATC-371).
- Live limit for P1 to P5: the misfire share per day (declined, UNABLE, RECALL, superseded after send, wrong AIRCRAFT; for SCHEDULE and FLEET PLAN, a reverted or refused edit) under a limit written before the switch is turned on; crossing it turns the switch off and the cards return to the SUPERVISOR (principle 2).

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
- **WO-28 Migration rehearsal (C20).** [ATC-368](https://linear.app/vocado/issue/ATC-368). One switch per AIRPORT, on once its test database and credentials (K2, set by the SUPERVISOR) exist. Tier `user`.

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
- **D23 SCHEDULE, FLEET PLAN and CREW CHANGE.** **Decided 2026-10-02:** they run without a human and without CROSSCHECK agreement, the way D22 runs DISPATCH; NEW drafts land in Backlog as proposals and ROUTE and TARGET stay proposals ([ATC-370](https://linear.app/vocado/issue/ATC-370)). The CROSSCHECK session is retired once D22 and D23 are live ([ATC-371](https://linear.app/vocado/issue/ATC-371)); its past verdicts stay as history.
- **D24 No prompt after release.** **Decided 2026-10-02:** AIRCRAFT tool prompts are replaced by an atc policy hook passed at LAUNCH, and finished AIRCRAFT that sit PENDING or HUNG are stopped ([ATC-369](https://linear.app/vocado/issue/ATC-369)); a DECISION card from a control session is only for K1–K3, and any other decision proceeds on a stated default or comes back as a new arrow ([ATC-352](https://linear.app/vocado/issue/ATC-352)).
- **Open, not decided:** whether DISPATCH RELEASE and CLASSIFY cards follow D22; the one bulk confirmation of the current Todo list proposed in ATC-362; whether C7 audits single-review heads first.
