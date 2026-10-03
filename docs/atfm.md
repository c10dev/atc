# ATFM design (stage 3)

**English** · [한국어](atfm.ko.md)

ATFM (air traffic flow management) is stage 3 of atc. Stages 1–2 made atc see traffic (TOWER), propose work (DISPATCH), draft ticket changes (OCC SCHEDULE) and get a second opinion (CROSSCHECK), with every decision left to the SUPERVISOR. Stage 3 lets atc act on its own in the narrow cases where the data shows the SUPERVISOR would decide the same way, and lets it slow traffic down when the system is congested or broken.

> Status (2026-09-27): the SUPERVISOR decided the ten open questions (see "Decisions" at the end). Steps 1–5 of section 8 are built: data collection, ground stops, merge slots, and auto-eligibility for DISPATCH and S3, all in shadow operation (computed, shown and recorded, never acted on). Step 6 is built behind switches: all five ground stops (main broken, failure wave, congestion, LOS, manual) can be switched `on`, and then they are enforced; failure wave, congestion and LOS got their release rules and second triggers in ATC-62 (2026-09-28). Step 7 is built as a switch: merge slots can be switched `on` (default `shadow`), and then TOWER issues LAND only to `in-slot` PRs. Ground stops and merge slots are the only mechanisms that can be enforced, and no switch is on by default. Step 8, RECALL, is also built (docs/dispatch.md "RECALL"). Automatic assignment and automatic S3 are not built. Section 10 describes what exists.

Related: [dispatch.md](dispatch.md) section 8 (the 2b → 3 criteria), [occ.md](occ.md) sections 7 and 11 (S3), [fleet.md](fleet.md) section 4 (classification), `server/landing.ts` (CLEARED TO LAND), `server/proposals.ts` (`gate3Of`), `server/crosscheck.ts` (match rate, one-click count), `server/logbook.ts` (LOGBOOK).

## 1. Current facts

Read-only from the running atc (`/api/dispatch/brief`, `/api/schedule/brief`, `/api/logbook`, `/api/metrics`, `/api/snapshot`) on 2026-09-27. Nothing was written to the operating state.

| Area | Figure | What it means for stage 3 |
|---|---|---|
| DISPATCH | Still 2a (shadow). 6 shadow decisions, 2 agreed (33%). 2b has sent 0 FLIGHT PLANs, so `gate3` has no data | Automatic assignment is at least "2b gate + 2 weeks of 2b" away. The rules below must be ready to run in shadow long before that |
| DISPATCH rejections | Reasons given: already done (VOC-56 ruleset), waiting on a human decision (VOC-177), and for a RELEASE, a parent issue (VOC-34). 2 of the 3 rejected ASSIGNs carried an OCC CAUTION; the one CAUTION ASSIGN that was approved (D-0013, VOC-193) was security work for a SEC team | CAUTION marks most of the risky cases; excluding CAUTION from automation (dispatch.md section 9) is well founded |
| SCHEDULE | S1 (shadow). 7 decisions, 4 agreed (57%). The 3 rejections were all CLASSIFY misreadings (BUILD for MAINT twice, WAKE M for L), fixed in PR #29; the first draft after it (S-0010, VOC-181) matched | CLASSIFY quality is moving; S3 must be gated on data after #29, not before |
| CROSSCHECK | SCHEDULE: 7 of 7 marks matched the SUPERVISOR (5 marks from before model names were recorded, 2 from Muse). DISPATCH: 0 marks decided yet. One-click decisions: 0 of 0 (the button is new) | The only evidence that a second model agrees with the human is on SCHEDULE, and it is small |
| LOGBOOK (14 days) | 62 merged PRs: `chaehy5665/atc` 32, `chaehy5665/vocado_nextjs` 30. 0 reverted, 0 CHANGES_REQUESTED, 0 LOS. Codex found problems on 8 of 30 vocado PRs | Merges are frequent and clean so far |
| Landing wait (PR opened → merged) | All: median 13 min, p75 147, p90 439, max 1,734 (29 h). atc: median 2, p90 12. vocado: median 142.5, p90 583 | The queue that needs flow control is vocado's, not atc's |
| Merge spacing | Time between consecutive merges in the same repository: atc median 11 min (14 of 31 gaps under 10 min), vocado median 21 min (12 of 29 under 10 min) | Back-to-back merges are common. In vocado each one can put the other open PRs `BEHIND` and restart their CI |
| Block time (DEPARTED → PR opened) | Known for 13 of 62 entries: median 9 min, p90 31 | Too few to calibrate WAKE expectations yet |
| Attribution | 48 of 62 LOGBOOK entries have no AIRCRAFT, 46 have no FLIGHT or classification | Per-AIRCRAFT and per-WAKE figures are not yet reliable |
| TOWER | 2 operating days (the 1.5 readiness asks for 3). 11 CLEARANCEs (1 LAND, 10 INFO), READBACK 100% within 0.2 min median. LANDING: 11 requests, 4 landed, median wait 2.3 min, max 444 min | READBACK discipline is good; LAND volume is still tiny |
| Open PRs now | 1 CLEARED (vocado #389). vocado_RN PRs are all blocked by `no-checks`; DesignLAB PRs by `no-review` | Some AIRPORTs never reach CLEARED; slot rules must not assume every repository has CI |

## 2. Principles

1. **Shadow before action.** Every rule first runs as "would have done X" next to the human decision, for at least two weeks and a minimum number of cases. The SUPERVISOR switches it on only after the shadow record meets its criteria.
2. **Humans are measured, automation is not counted as a human.** Automatic decisions carry `via: "atfm"` and never count toward the 2a/S1 agreement gates or the CROSSCHECK match rate. Otherwise automation would grade itself.
3. **Narrow and reversible.** Automation only covers cases that are low-risk by construction (no `SEC`, no CAUTION, explicit labels) and each has a switch, a daily cap and trip conditions that turn it off by themselves.
4. **Protective controls come first.** Ground stops and merge slots only slow things down; they can be turned on earlier than anything that approves work.
5. **Same guards as today.** No new write path bypasses send-guard, linear-guard or the Bash guard. Automatic FLIGHT PLANs and Linear calls go through the existing release commands, so the guards still compare exact text and input.

## 3. Low-risk automatic assignment (DISPATCH stage 3)

**Purpose.** Send routine ASSIGNs as FLIGHT PLANs without waiting for the SUPERVISOR, so idle AIRCRAFT pick up clear work sooner, while every judgment call still goes to a person.

**Rule: an ASSIGN is auto-eligible only if all of these hold.** The planner computes an `auto` verdict with the list of failed conditions for every open ASSIGN.

| # | Condition | Why |
|---|---|---|
| A1 | The FLIGHT has **explicit** `type:` and `wake:` labels (not the BUILD · M default) | Defaults hide exactly the misclassifications seen in SCHEDULE |
| A2 | WAKE is `L` or `M` | `H` needs several review rounds; `J` must be split |
| A3 | FLIGHT TYPE is `BUILD`, `MAINT` or `FERRY` (decision 1: SURVEY excluded) | `SURVEY` and `TEST` outcomes are open-ended; `CHECK` needs independence from the BUILD it reviews |
| A4 | No `rating:SEC` and no label from the Risk group | SEC is never automatic (fleet.md section 4.3, occ.md section 7) |
| A5 | OCC has reviewed it (`note` present), no CAUTION, no HOLD | 2 of the 3 rejected ASSIGNs so far carried CAUTION |
| A6 | If the FLIGHT has `tail:`, it names this AIRCRAFT; if not, the FLIGHT's project is on this AIRCRAFT's ROUTES | A pre-assignment or a usual area is the SUPERVISOR's own earlier decision |
| A7 | **Dropped (ATC-371).** It required a CROSSCHECK `agree` mark; CROSSCHECK is retired, so the code is not checked and is skipped in the list of checked conditions | — |
| A8 | The AIRCRAFT is PARKED, not AOG, holds every required rating, has no NO READBACK and no DECLINED in the last 7 days, and is not flying a STAND-free FLIGHT that has not ARRIVED ([fleet.md](fleet.md) 5.1.1) | A team that is not answering should not receive more work automatically; a team on a SURVEY or CHECK is busy even when its session is idle |
| A9 | The FLIGHT has a priority, is not a parent issue, and was not declined or rejected before | These are the other real rejection reasons |
| A10 | No enforced ground stop covers the AIRPORT (section 6), and the caps have room (section 7): 3 automatic ASSIGNs per day overall, and at most 1 automatically assigned FLIGHT per AIRCRAFT that has not ARRIVED yet, on top of the WAKE slots (decision 3) | Flow control wins over assignment |

**Turn-on conditions** (all, checked from data, shown in the DISPATCH tab as a "STAGE 3" panel next to the existing gates):

1. 2b has run for 2 weeks or more and `gate3` is ready. dispatch.md section 8 asks for 2+ weeks, READBACK 90%+, DEPARTED 80%+, almost no LOS on FLIGHTs DISPATCH sent, and less idle AIRCRAFT time. The code (`gate3Of`, `GATE3`) checks 10 or more human-approved FLIGHT PLANs sent, READBACK 90%+ and DEPARTED 80%+; the minimum of 10 is the code's own. LOS is condition 5 below. The 2-week duration is measured from the last DISPATCH `mode:` switch in the FLIGHT RECORDER (`approvalRunOf`): 14 days or more in `approval` passes. When the mode is `approval` but the last switch recorded is not (the file was edited by hand, or the switch is older than the recorder's 30 days), the row shows "확인 필요" (check) instead of a verdict. Less idle AIRCRAFT time is not measured: Not built yet. The DEPARTED rate counts STAND-needing FLIGHTs only: a STAND-free FLIGHT departs at READBACK, so it counts toward the READBACK rate and is shown apart as `gate3.standFree`.
2. **Shadow precision of the auto-eligible set**: 20 or more auto-eligible ASSIGNs decided by the SUPERVISOR, of which 95% or more approved, and none rejected with `already-done`, `parent-issue`, `waiting-on-prior` or `needs-human`.
3. **CROSSCHECK on DISPATCH, per model family**: **dropped (ATC-371).** CROSSCHECK is retired, so no turn-on row waits on its match rate. Old marks and their match rate stay readable as history.
4. **One-click share**: among auto-eligible ASSIGNs, the share the SUPERVISOR approved with "CROSSCHECK에 동의" (`oneClick`). This is supporting evidence, not a gate: a high share shows those decisions are already routine, but it measures convenience, not correctness.
5. No LOS involving a FLIGHT that DISPATCH sent, in the last 2 weeks.

**Turn-off and rollback.**

- Switch: `atfm.json` `autoAssign` (decision 10). Today it only takes `off | shadow` (default `shadow`: computes, shows and records); `on` comes with the automatic assignment PR.
- Automatic trips (switch goes back to `shadow` and an alert is raised): an auto-sent FLIGHT PLAN is DECLINED or has NO READBACK after 10 minutes; the SUPERVISOR supersedes or recalls an auto-approved proposal; an auto-sent FLIGHT is part of a LOS; the CROSSCHECK match of the current model family over the last 20 decisions falls below 85%.
- Rollback of one FLIGHT: FLIGHT PLANs already sent stay sent (like turning 2b off). The SUPERVISOR can **recall** an auto-sent proposal: OCC sends a fixed `[DISPATCH D-xxxx] RECALL` text (send-guard allows it only for proposals in `recalling`), and the CAPTAIN answers `READBACK D-xxxx RECALL`. Decision 4: built before automatic assignment — see docs/dispatch.md "RECALL".

**Metrics.** Auto-eligible count and the failed-condition histogram; shadow precision; auto-sent per day; READBACK and DEPARTED rates of auto-sent vs human-approved FLIGHT PLANs; declines; recalls; LOS on auto FLIGHTs; block time against the WAKE expectation (`WAKE_EXPECT_MIN`) once enough LOGBOOK entries have an AIRCRAFT and a class.

**Data needed.** Explicit labels on more FLIGHTs (only 16 of 62 LOGBOOK entries are classified); CROSSCHECK marks on DISPATCH (none decided yet); LOGBOOK attribution of AIRCRAFT (48 of 62 missing); 2b running at all.

## 4. S3 automatic operations (OCC)

**Purpose.** Let OCC apply routine plan-field changes without an approval click, starting with classification labels, while anything that changes risk stays human.

**Rule: a SCHEDULE operation is auto-eligible only if all hold.** S1–S4 are condition codes, the ones `s3Eligibility` reports as failed conditions. They are not the OCC stages S1–S3 ([occ.md](occ.md) section 11), such as S3 in this section's title. Where a stage is meant in the conditions and below them, it is written "stage S2" or "stage S3".

| # | Condition |
|---|---|
| S1 | Kind is `CLASSIFY` and it only **adds** labels on axes that have none (no `removeLabels` in its calls). Replacing an existing label is a human decision (decision 5: this is the whole stage S3 scope for now) |
| S2 | It does not add `rating:SEC`, and the FLIGHT has no `rating:SEC`, no label from the Risk group (`Risk:Security`, or the old single `Risk: Security`; `classOf` reads every `Risk:` label as SEC) and no OCC CAUTION on any DISPATCH proposal for it. If atc cannot read the FLIGHT, S2 fails: SEC work is never automatic |
| S3 | OCC's reason cites fleet.md sections for every axis it sets (the #29 rule). The CROSSCHECK `agree` mark it also required is dropped (ATC-371) |
| S4 | The FLIGHT is Todo or Backlog and no team is flying it: no STAND, and no DISPATCH proposal between approval and ARRIVED (`isInFlight`, which includes a STAND-free FLIGHT that departed at READBACK). A `tail:` label alone does not block it; it only pre-assigns |

One more condition is not a per-draft check: stage S2 (approval operation) must be on, so the Linear call is the one atc releases and linear-guard compares. It holds for every draft or for none, so it is turn-on condition 1 below.

Later candidates, each only after its own stage S2 record (occ.md section 7). Decision 5: `CLOSE` after merge is reviewed once stage S2 has run for 2 weeks. `CLOSE` as Done when the FLIGHT's PR is in the LOGBOOK as merged, not reverted, 1 hour has passed, and every done-criteria box in the body is checked (OCC reads it). The `CLOSE` draft is built ([occ.md](occ.md) section 5.5), but atc never releases it: the SUPERVISOR moves the issue to Done in Linear. Automatic `CLOSE` is not built yet. `LINK` for a prerequisite quoted verbatim from the body. `PRIORITIZE` stays human: priority follows the SUPERVISOR's plans, which ticket bodies rarely state. Never automatic: `rating:SEC` added or removed, CAUTION, `Canceled`, deletion, changing a `tail:` of an AIRBORNE team.

**Turn-on conditions.**

1. Stage S2 has run for 2 weeks (occ.md section 11), measured from the last SCHEDULE `mode:` switch like condition 1 of section 3, with no APPLIED operation undone by a person. "Undone" is detected as a label that OCC added and that is gone within 7 days.
2. Human agreement on CLASSIFY drafts written after #29: 20 or more decided, 85% or more agreed.
3. CROSSCHECK on SCHEDULE CLASSIFY: **dropped (ATC-371)**, same reason as in section 3.
4. Shadow precision: 20 or more auto-eligible drafts decided, 95% or more approved.

**Turn-off and rollback.** Switch `atfm.json` `s3` (today `off | shadow`, default `shadow`). Trips back to `shadow`: a human rejects a draft the rule marked eligible (in shadow) or removes an auto-applied label (in `on`), a linear-guard block, or the current model family's match falling below 85%. Rollback of one applied CLASSIFY: atc drafts the inverse operation (remove exactly the labels it added) as a normal stage S2 draft for the SUPERVISOR to approve; nothing is removed automatically.

**Metrics.** Eligible and applied per day, undone within 7 days, human agreement on CLASSIFY, per-family CROSSCHECK match, label mismatches found later by DISPATCH (a FLIGHT excluded or re-classified after auto-apply).

**Data needed.** Post-#29 CLASSIFY verdicts; stage S2 turned on; label-removal detection in the Linear source (compare labels between fetches).

## 5. Merge slots

**Purpose.** Keep the LANDING SEQUENCE from thrashing: in a repository whose branch protection needs an up-to-date branch, every merge can put the other CLEARED PRs `BEHIND`, and each of them then rebases and reruns CI. The vocado queue (median wait 142 min, p90 583) is where this matters; atc (median 2 min, no CI) needs nothing.

**Rules.**

- **Slots per repository and base.** At most N PRs at a time hold a LAND CLEARANCE that has not landed yet. Decision 6: 1 for vocado_nextjs, unlimited for repositories without CI (atc and others). In code: 1 when the default branch head has any check, unlimited when it has none; `atfm.json` `slotLimits` (AIRPORT code → number or `null`) overrides it. A PR that is CLEARED but outside the slots stays in the sequence with its number; from step 7, TOWER does not send it LAND until it is in a slot.
- **Order.** PRs that already hold a LAND come first and are never displaced; then Urgent-priority FLIGHTs; then the rest by `readyAt` (decision 6).
- **Pacing.** The next LAND in the same repository goes out when the previous one merged, or when its LAND is older than the LAND timeout (30 min, decision 7: atc's p90 landing wait is 12 min, so 30 min leaves margin. vocado's longer LOGBOOK waits run from PR opened to merged, which includes review time before the PR is CLEARED, so they overstate the time after LAND). A timed-out LAND is reported to the SUPERVISOR and its slot freed.
- **Rebase cost.** Open PRs that turn `BEHIND` are recorded (`behind`), so `BEHIND` per merge can be counted. The limit stays as decision 6 sets it; only the SUPERVISOR changes it, through `slotLimits`. The adjustment first proposed here (keep 1 when more than 2 PRs go `BEHIND` per merge on average over a day, raise to 2 when the CI median is under 10 min) is not built yet, and it would need a new decision.
- **Where it runs.** atc computes `slot` for each PR in `landingQueue` (`in-slot` / `waiting-slot`); from step 7, TOWER's rules issue LAND only to `in-slot` PRs. Built (ATC-22): with `slots: on` each `waiting-slot` PR also gets `slotHold` (`slotHoldOf`, a one-line reason) and TOWER issues it no LAND and sends no message; in shadow only `slot` is there and TOWER ignores it. No new write path.

**Turn-on.** Run in shadow (show `waiting-slot` in STRIPS, TOWER still issues LAND as today) for 1 week, then compare: how often two LANDs in the same repository were active at once, and how many PRs went `BEHIND` after each merge. Built: `GET /api/atfm` `data.lands` gives, per AIRPORT over 7 days, the LANDs issued, how many were alive together with another LAND of the same AIRPORT (`concurrent`), the LAND → merge median and the LANDs not merged within 30 minutes (`landSpansOf` pairs each LAND with the first LOGBOOK ARRIVED on its STAND, or its FLIGHT when it has no STAND; an unmatched LAND ends when cancelled or at the timeout; `landFiguresOf`), next to `data.behind` (BEHIND per merge). The DISPATCH tab's ATFM block shows them under the slot switch as "켜기 판단 (7일)". There is no pass/fail threshold: the SUPERVISOR compares them.

**Turn-off.** `atfm.json` `slots` (`off | shadow | on`, default `shadow`). The SUPERVISOR switches it on the DISPATCH tab's ATFM block (with a confirmation); ATFM OFF puts `on` back to `shadow`.

**Metrics.** Landing wait per repository (median and p90), LAND → merge time, BEHIND events per merge, CI reruns per PR, LAND timeouts.

**Data needed.** CI duration per PR and per check run (check runs' `startedAt` is already fetched for CLEARED TO LAND; `completedAt` must be added); BEHIND transitions per merge (from consecutive snapshots); whether each repository requires up-to-date branches (branch protection, read-only `gh api`).

## 6. Ground stop

**Purpose.** When the system itself is in trouble, stop adding load: no new assignments and, where it helps, no new merges, until the cause is gone. A **GROUND STOP** stops new ASSIGNs (and LAND where stated) for one AIRPORT; a **GROUND DELAY** only reduces its AIRBORNE slots by one.

**Triggers and releases** (per AIRPORT, i.e. per repository):

| Trigger | Stops | Released when |
|---|---|---|
| **Main broken**: the default branch head has a failing required check | New ASSIGN and all LAND for that AIRPORT (new work would branch from a broken base; merges would pile on) | The default branch head is green, or the SUPERVISOR releases it |
| **CI failure wave**: 3 or more PRs in the same repository fail the same check within 1 hour | New ASSIGN and LAND | The failing check passes on a newer head in 2 PRs, or the SUPERVISOR releases it |
| **CI congestion**: more than 4 PRs with a check running for over 30 min, or the median check duration of the last 2 hours over 2× the median of the 7 days before (at least 3 and 10 samples) | GROUND DELAY: AIRBORNE slots −1; LAND continues so the queue drains | Below the threshold for 30 min |
| **LOS rising**: 2 or more open LOS at the AIRPORT, or 3 or more LOS raised there in 24 h | New ASSIGN | Below both thresholds for 30 min |
| **Manual**: the SUPERVISOR declares a ground stop with a reason | Whatever the SUPERVISOR selects | The SUPERVISOR releases it |

Release as built (ATC-62): "main broken" and "manual" end at the first snapshot where the trigger no longer holds. Congestion and LOS are held until the trigger has stayed off for 30 minutes in a row; if it comes back inside those 30 minutes (a flapping trigger) the same stop goes on, with the same start time, and the 30 minutes start again. A failure wave is held until the failing check has passed in 2 PRs on runs that finished after the stop started; one PR is not enough. A held stop shows what it still waits for (`releasing`: "기준 아래 12분 / 30분", "build 통과 PR 1/2 (#381)"). "The SUPERVISOR releases it" means switching that trigger to `shadow` or `off`, or ATFM OFF: an automatic stop has no per-stop release button.

Codex usage-limit notices (PRs stuck on `no-review` with "Codex 한도") are reported as INFO, not a ground stop: they block landing by themselves.

**Who does what.**

- **atc** computes `groundStops` (AIRPORT, kind, trigger, since, evidence) in the snapshot, shows it as an ALERT and on the AIRPORTS and STRIPS tabs, and records start and end in the FLIGHT RECORDER.
- **Planner (DISPATCH)** excludes stopped AIRPORTs with the reason `GROUND STOP — <trigger>` and holds approved-but-unsent ASSIGNs there (`dispatch release` refuses while stopped).
- **TOWER** issues no LAND for a stopped AIRPORT. When a stop starts, it sends one `HOLD` CLEARANCE to the holders of that AIRPORT's CLEARED PRs ("GROUND STOP: <trigger> — LAND 보류"). When the stop ends, it sends `CONTINUE` and resumes LAND in sequence order.
- **OCC** writes no FLIGHT PLAN for a stopped AIRPORT, and puts the stop in its OCC LOG. For "main broken" it reports the failing check and the commit to the SUPERVISOR (read-only `gh`).

**Turn-on.** Shadow for 1 week: triggers are computed and shown, nothing is stopped. The SUPERVISOR reviews false positives (for example a flaky check) and adjusts thresholds before `on`.

**Switches** (`atfm.json` `groundStop`, decision 8, ATC-62): `mainBroken`, `failureWave`, `congestion`, `los: off | shadow | on` (default `shadow`) and `manual: off | on` (default `off`). Turning any of them on is the SUPERVISOR's (ATC-23); ATFM OFF puts every `on` back to `shadow`. When on, "main broken" and "failure wave" stop new ASSIGNs and LAND for their AIRPORT, "LOS" stops only new ASSIGNs (TOWER keeps landing and sends no HOLD), and "congestion" is a GROUND DELAY that takes one AIRBORNE slot. A manual stop is declared per AIRPORT with a reason and released by hand.

**Metrics.** Stops per week by trigger, duration, false-positive share (stops the SUPERVISOR released manually within 10 min), assignments and LANDs held.

**Data needed.** The default branch head's check status per repository (read-only `gh api repos/<slug>/commits/<branch>/check-runs`, polled with the PR list); check durations (section 5); LOS per AIRPORT is already in the snapshot.

## 7. Safeguards (all automatic behaviour)

| Safeguard | Rule |
|---|---|
| Switches | All in `~/.local/state/atc/atfm.json` (decision 10), written atomically, defaults `off` or `shadow`: `groundStop.*`, `slots`, `autoAssign`, `s3`, plus `slotLimits` and `manualStops`. One "ATFM OFF" button (`POST /api/atfm/off`) turns every `on` back to `shadow` and the manual switch off |
| Caps | Automatic ASSIGNs: at most 3 per day overall, and at most 1 automatically assigned FLIGHT per AIRCRAFT that has not ARRIVED, together with the WAKE slots (decision 3). S3 automatic operations: at most 5 per day. Days are KST. At a cap, eligible items fall back to the normal human flow |
| Automatic trips | Each mechanism has trip conditions (sections 3–4) that set its switch back to `shadow` and raise an alert. Turning it back on is a SUPERVISOR action |
| Notification | Every automatic action is an event in `/api/events` and a line in an "AUTO" list in its tab. Trips and ground stops are ALERTs. OCC and TOWER mention automatic actions in their LOG lines |
| Record | FLIGHT RECORDER lines of kind `atfm`: `{op, id?, airport?, data?}`. The built ops are listed in section 10 (`ground-stop` (with `land`, and `check` for a failure wave), `ground-release` (with `releasedBy`: `cleared`, `30-min-below`, `passed-in-2-prs`, `switched-off` or `restart`), `ci`, `behind`, `eligible`, `s3-eligible`, `undone`, `switch`, `off`, `manual-stop`, `manual-release`, `slot-hold`). `eligible` and `s3-eligible` carry `checked`, the condition codes that were checked (A1–A10, S1–S4). Not built yet: `auto-approve`, `auto-apply` and `trip`, and the `rule` and `inputs` fields that come with them. `inputs` is to be the snapshot of the values behind each condition, so any automatic action can be explained afterwards |
| Attribution | Automatic approvals are `approve` ops with `by: "atfm"` and `via: "atfm"`. They are excluded from the human gates and the CROSSCHECK match rate (principle 2) |
| Guards | Automatic FLIGHT PLANs go through `dispatch release` and send-guard; automatic Linear writes through `schedule release` and linear-guard. No guard gets a bypass |

## 8. Implementation order

Each step is one PR. Shadow steps change nothing that teams or Linear see.

1. **Data** (shadow-free): record check durations and the default branch head status per repository; BEHIND transitions per merge; label-removal detection in the Linear source; `atfm` recorder kind. No behaviour change.
2. **Ground stop, shadow**: compute `groundStops`, ALERT, AIRPORTS/STRIPS display, recorder. Nothing is stopped.
3. **Merge slots, shadow**: `slot` in `landingQueue`, shown in STRIPS. TOWER unchanged.
4. **Auto-eligibility for DISPATCH, shadow**: `auto` verdict and failed conditions on every open ASSIGN, the "STAGE 3" panel with shadow precision. Can start during 2a, because it only compares with human decisions.
5. **Auto-eligibility for S3, shadow**: the same for CLASSIFY drafts.
6. ✅ **Ground stop on**: planner exclusion, `dispatch release` refusal, TOWER HOLD/CONTINUE rules, the release rules and the GROUND DELAY. Built behind switches that stay `shadow` until the SUPERVISOR accepts the week of shadow (ATC-23).
7. ✅ **Merge slots on**: TOWER issues LAND only to `in-slot` PRs — built behind the `slots` switch (ATC-22), default `shadow`.
8. ✅ **Recall** (`[DISPATCH D-xxxx] RECALL`, send-guard extension) — built (docs/dispatch.md "RECALL"), needed before automatic assignment.
9. **Automatic assignment on**: switch, caps, trips, attribution. Only after the section 3 turn-on conditions hold.
10. **S3 automatic CLASSIFY on**: after the section 4 turn-on conditions hold.

Steps 1–5 are built (section 10). Step 6 is built too: "main broken" and "manual" first (decision 8), then the release rules, second triggers and `on` switch for failure wave, congestion and LOS (ATC-62). All five switches default to `shadow` (manual to `off`); none is on until the SUPERVISOR turns it on. Step 7 (merge slots) is built behind the `slots` switch, default `shadow` (ATC-22). Step 8 (RECALL) is built too (decision 4). Next is step 9, automatic assignment, once the section 3 turn-on conditions hold.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Automation grades itself | `via: "atfm"` is excluded from every agreement and match figure |
| A flaky check triggers ground stops | A week of shadow first, a false-positive metric, manual release, the CI failure wave needs 3 PRs |
| Slots slow down repositories that don't need them | Slots default to unlimited for repositories without CI; per-repository settings |
| An automatic FLIGHT PLAN lands on a team that is busy in reality | A8 (PARKED, no recent NO READBACK or DECLINED), at most 1 unfinished automatic FLIGHT per AIRCRAFT, recall |
| Labels drift and make A1–A4 wrong | A1 requires explicit labels, S3 only adds labels on empty axes, human agreement on CLASSIFY is part of the S3 gate |
| Too little data to ever turn things on | Shadow eligibility (steps 4–5) is built and runs during 2a and S1, so the precision record builds up in parallel |

## 10. What is built (steps 1–7)

| Piece | Where | What it does |
|---|---|---|
| Default branch CI | `server/sources/github.ts` (`readMain`) | Every GitHub poll (90 s) reads the default branch head's check-runs and commit statuses per AIRPORT (read-only `gh api`). `mainStateOf` turns them into `success`, `failure`, `pending` or `none` (no CI). Shown in `snapshot.atfm.mains` |
| Check durations | `server/atfm.ts` `ciMinutesOf` | Earliest start to latest finish of a PR head's check runs, once all have finished. Uses `completedAt`, now read with the PR list |
| Ground stops | `server/atfm.ts` `groundStopsOf`, `holdStops`, `server/snapshot.ts` | Computed with every snapshot: main broken, CI failure wave (3 PRs failing the same check within 1 h, keyed by the check), CI congestion (more than 4 PRs with a check running for over 30 min, or the 2-hour check median over 2× the 7-day one; a GROUND DELAY), LOS (2 or more open at an AIRPORT, or 3 or more in 24 h), and manual. `holdStops` keeps a stop until its release rule holds (section 6) and fills `clearSince` and `releasing`. `enforced` is true when that trigger's switch is on; `land` says whether the stop also blocks LAND. After a restart, stops recorded in `atfm-state.json` `stops` are revived and their release rule counts from the restart. The second-trigger figures (`ciTrendOf` over `ci` lines, `losDayOf` over LOS events) are recounted every minute by `server/atfm-run.ts` from the FLIGHT RECORDER. Shown in `snapshot.atfm.groundStops` |
| Enforcement (on only) | `server/proposals.ts`, `server/controller.ts`, `server/events.ts`, TOWER and OCC `CLAUDE.md` | The planner moves ASSIGNs at a stopped AIRPORT to `excluded` with `GROUND STOP — …`, so open proposals there are SUPERSEDED with that reason. `dispatch release` refuses. The TOWER brief puts `groundStop` on each `landingQueue` item only for stops that block LAND (`enforcedStops(…, "land")`: main broken, failure wave, manual), and TOWER issues no LAND there. `groundstop.started` and `groundstop.ended` events, also only for those, make TOWER send HOLD and CONTINUE. An LOS stop only excludes ASSIGNs; a congestion GROUND DELAY lowers the AIRPORT's AIRBORNE limit by one in `planDispatch`. Shadow stops produce no events |
| Merge slots | `server/atfm.ts` `slotsOf`, `slotHoldOf`, TOWER brief `landingQueue[].slot` and `slotHold` | `in-slot` or `waiting-slot`, lane position, Urgent, LAND time and the 30-minute timeout. With `slots: on` (step 7, ATC-22) a `waiting-slot` PR gets `slotHold` and TOWER issues it no LAND; each such PR head is recorded once as `slot-hold` (`atfm-state.json` `slotHold`) |
| Auto-eligibility (shadow) | `server/atfm.ts` `autoEligibility` (A1–A10), `s3Eligibility` (S1–S4) | Computed for every open ASSIGN and CLASSIFY draft, with the failed conditions |
| Shadow precision and turn-on rows | `server/atfm-run.ts` `atfmView` | Precision is taken over items ever recorded as eligible, compared with human decisions. It also counts rejections that should have been blocked (`already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`). Each section 3/4 turn-on condition becomes a pass/fail/insufficient row (the 2-week rows can also be "check", `approvalRunOf`), and the CROSSCHECK rate is taken for the family of the latest non-`unknown` mark (`currentModelRate`) |
| Recording | FLIGHT RECORDER lines `kind: "atfm"` | `ground-stop`, `ground-release`, `ci`, `behind` (an open PR turning BEHIND), `eligible` and `s3-eligible` (with `checked`), `undone` (a label applied through S2 that disappears within 7 days), `switch`, `off`, `manual-stop`, `manual-release`. `~/.local/state/atc/atfm-state.json` remembers what was recorded, so a restart doesn't duplicate lines |
| API | `server/atfm-run.ts` | `GET /api/atfm` (switches, main CI, ground stops, slots, eligibility with failed conditions, precision, turn-on rows, data), `POST /api/atfm/switch {key, value}`, `POST /api/atfm/off`, `POST /api/atfm/stops {airport, reason}` (only while `groundStop.manual` is on), `POST /api/atfm/stops/:airport/release` |
| Screen | DISPATCH tab, "ATFM" block (`web/src/views/Atfm.tsx`) | Ground stops (ENFORCED, ENFORCED · ASSIGN for LOS, GROUND DELAY or shadow, with "해제 대기" while a release rule is pending), the switches with confirmation (main broken, failure wave, congestion, LOS, manual, merge slots), a manual stop form, main CI per AIRPORT, slots, eligibility, S3, data, and ATFM OFF. It may move to the NETWORK tab later |
| Attribution | `server/crosscheck.ts` `Via`, `humanOf`, gates | `via: "atfm"` can only be set inside the server. `humanOf` returns nothing for it, the 2a and S1 gates skip it, `gate3` counts only human-approved FLIGHT PLANs, and the CROSSCHECK rate and one-click count exclude it |

## Decisions (2026-09-27, SUPERVISOR)

| # | Decision |
|---|---|
| 1 | Automatically approved FLIGHT TYPEs: BUILD, MAINT and FERRY only. SURVEY is excluded |
| 2 | Thresholds as proposed: shadow precision 95% over 20, CROSSCHECK per-model-family match 90% over 20 (`unknown` not counted), trip at 85% |
| 3 | Caps: 3 automatic ASSIGNs per day overall, 5 S3 operations per day. The per-AIRCRAFT limit is not "1 per day" but an in-progress limit: at most 1 automatically assigned FLIGHT per AIRCRAFT that has not ARRIVED, applied together with the WAKE slots |
| 4 | Build `[DISPATCH D-xxxx] RECALL` before automatic approval — **built** |
| 5 | S3 scope: CLASSIFY that adds labels on empty axes only. `CLOSE` after merge is reviewed after 2 weeks of S2 |
| 6 | Merge slots: 1 for vocado_nextjs, unlimited for repositories without CI (atc and others). An Urgent FLIGHT goes to the front of its repository's line but never displaces a PR that already has a LAND |
| 7 | LAND timeout: 30 minutes |
| 8 | Ground stop: "main broken" stops both new ASSIGNs and LAND. "Main broken" and "manual" are the first to be switchable on; CI failure wave, CI congestion and LOS rising stay in shadow |
| 9 | Build steps 1–5 now, in parallel with 2a and S1 |
| 10 | Switches live in a separate `~/.local/state/atc/atfm.json` (atomic writes, defaults off or shadow) |

The questions as they were asked are kept below for reference.

## Questions put to the SUPERVISOR (answered above)

1. **Auto-eligible FLIGHT TYPEs**: BUILD, MAINT and FERRY only (proposed), or also SURVEY?
2. **Thresholds**: shadow precision 95% over 20, CROSSCHECK per-model-family match 90% over 20, trip at 85% — keep, or change?
3. **Daily caps**: 3 automatic ASSIGNs per day, 1 per AIRCRAFT; 5 S3 operations per day?
4. **Recall**: build `[DISPATCH D-xxxx] RECALL` before automatic assignment (proposed), or accept that rollback is a direct message from the SUPERVISOR?
5. **S3 scope**: CLASSIFY on empty axes only (proposed); when to consider `CLOSE` after merge?
6. **Merge slots**: 1 for vocado_nextjs and unlimited for atc (proposed); may an Urgent FLIGHT jump its repository's queue?
7. **LAND timeout**: 30 minutes?
8. **Ground stop scope**: should "main broken" also stop LAND (proposed) or only new ASSIGNs? Which of the four triggers go to `on` first?
9. **Order**: build steps 1–5 (data and shadow) now, in parallel with 2a/S1 (proposed)?
10. **Where the switches live**: separate `atfm.json` for slots and ground stops (proposed), or all in `dispatch.json`?
