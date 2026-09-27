# ATFM design (stage 3, draft)

English only for now, like [occ.md](occ.md) and [fleet.md](fleet.md).

ATFM (air traffic flow management) is stage 3 of atc. Stages 1–2 made atc see traffic (TOWER), propose work (DISPATCH), draft ticket changes (OCC SCHEDULE) and get a second opinion (CROSSCHECK), with every decision left to the SUPERVISOR. Stage 3 lets atc act on its own in the narrow cases where the data shows the SUPERVISOR would decide the same way, and lets it slow traffic down when the system is congested or broken.

> Status: design only (2026-09-27). Nothing in this document is built. Every mechanism below starts in shadow operation (computed and shown, never acted on) and is turned on by the SUPERVISOR.

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
3. **Narrow and reversible.** Automation only covers cases that are low-risk by construction (no `SEC`, no CAUTION, explicit labels, a CROSSCHECK agree) and each has a switch, a daily cap and trip conditions that turn it off by themselves.
4. **Protective controls come first.** Ground stops and merge slots only slow things down; they can be turned on earlier than anything that approves work.
5. **Same guards as today.** No new write path bypasses send-guard, linear-guard or the Bash guard. Automatic FLIGHT PLANs and Linear calls go through the existing release commands, so the guards still compare exact text and input.

## 3. Low-risk automatic assignment (DISPATCH stage 3)

**Purpose.** Send routine ASSIGNs as FLIGHT PLANs without waiting for the SUPERVISOR, so idle AIRCRAFT pick up clear work sooner, while every judgment call still goes to a person.

**Rule: an ASSIGN is auto-eligible only if all of these hold.** The planner computes an `auto` verdict with the list of failed conditions for every open ASSIGN.

| # | Condition | Why |
|---|---|---|
| A1 | The FLIGHT has **explicit** `type:` and `wake:` labels (not the BUILD · M default) | Defaults hide exactly the misclassifications seen in SCHEDULE |
| A2 | WAKE is `L` or `M` | `H` needs several review rounds; `J` must be split |
| A3 | FLIGHT TYPE is `BUILD`, `MAINT` or `FERRY` | `SURVEY` and `TEST` outcomes are open-ended; `CHECK` needs independence from the BUILD it reviews |
| A4 | No `rating:SEC` and no label from the Risk group | SEC is never automatic (fleet.md section 4.3, occ.md section 7) |
| A5 | OCC has reviewed it (`note` present), no CAUTION, no HOLD | 2 of the 3 rejected ASSIGNs so far carried CAUTION |
| A6 | If the FLIGHT has `tail:`, it names this AIRCRAFT; if not, the FLIGHT's project is on this AIRCRAFT's ROUTES | A pre-assignment or a usual area is the SUPERVISOR's own earlier decision |
| A7 | A CROSSCHECK `agree` mark from an allowed model, recorded after OCC's note | Two independent reviewers agree before nobody looks |
| A8 | The AIRCRAFT is PARKED, not AOG, holds every required rating, has no NO READBACK and no DECLINED in the last 7 days | A team that is not answering should not receive more work automatically |
| A9 | The FLIGHT has a priority, is not a parent issue, and was not declined or rejected before | These are the other real rejection reasons |
| A10 | No ground stop covers the AIRPORT (section 6) and the daily cap has room (section 7) | Flow control wins over assignment |

**Turn-on conditions** (all, checked from data, shown in the DISPATCH tab as a "STAGE 3" panel next to the existing gates):

1. 2b has run for 2 weeks or more and `gate3` is ready: 10 or more FLIGHT PLANs, READBACK 90%+, DEPARTED 80%+ (dispatch.md section 8, `GATE3`).
2. **Shadow precision of the auto-eligible set**: 20 or more auto-eligible ASSIGNs decided by the SUPERVISOR, of which 95% or more approved, and none rejected with `already-done`, `parent-issue`, `waiting-on-prior` or `needs-human`.
3. **CROSSCHECK on DISPATCH, per model**: 20 or more marked decisions for the model currently in use (`byModel`), matching 90% or more. The overall rate is not enough, because the model changed once already.
4. **One-click share**: among auto-eligible ASSIGNs, the share the SUPERVISOR approved with "CROSSCHECK에 동의" (`oneClick`). This is supporting evidence, not a gate: a high share shows those decisions are already routine, but it measures convenience, not correctness.
5. No LOS involving a FLIGHT that DISPATCH sent, in the last 2 weeks.

**Turn-off and rollback.**

- Switch: `dispatch.json` `auto: "off" | "shadow" | "on"` (default `off`; `shadow` computes and shows only). The DISPATCH tab has the switch; `POST /api/dispatch/auto`.
- Automatic trips (switch goes back to `shadow` and an alert is raised): an auto-sent FLIGHT PLAN is DECLINED or has NO READBACK after 10 minutes; the SUPERVISOR supersedes or recalls an auto-approved proposal; an auto-sent FLIGHT is part of a LOS; the per-model CROSSCHECK match over the last 20 decisions falls below 85%.
- Rollback of one FLIGHT: FLIGHT PLANs already sent stay sent (like turning 2b off). The SUPERVISOR can **recall** an auto-sent proposal: OCC sends a fixed `[DISPATCH D-xxxx] RECALL` text (send-guard extended to allow it only for proposals marked recalled), and the CAPTAIN answers `READBACK D-xxxx`. Until recall is built, the SUPERVISOR tells the CAPTAIN directly.

**Metrics.** Auto-eligible count and the failed-condition histogram; shadow precision; auto-sent per day; READBACK and DEPARTED rates of auto-sent vs human-approved FLIGHT PLANs; declines; recalls; LOS on auto FLIGHTs; block time against the WAKE expectation (`WAKE_EXPECT_MIN`) once enough LOGBOOK entries have an AIRCRAFT and a class.

**Data needed.** Explicit labels on more FLIGHTs (only 16 of 62 LOGBOOK entries are classified); CROSSCHECK marks on DISPATCH (none decided yet); LOGBOOK attribution of AIRCRAFT (48 of 62 missing); 2b running at all.

## 4. S3 automatic operations (OCC)

**Purpose.** Let OCC apply routine plan-field changes without an approval click, starting with classification labels, while anything that changes risk stays human.

**Rule: a SCHEDULE operation is auto-eligible only if all hold.**

| # | Condition |
|---|---|
| S1 | Kind is `CLASSIFY` and it only **adds** labels on axes that have none (no `removeLabels` in its calls). Replacing an existing label is a human decision |
| S2 | It neither adds nor removes `rating:SEC`, and the FLIGHT has no `rating:SEC`, no Risk label and no CAUTION |
| S3 | A CROSSCHECK `agree` mark from an allowed model on this draft, and OCC's reason cites fleet.md sections for every axis it sets (the #29 rule) |
| S4 | The FLIGHT is Todo or Backlog and not AIRBORNE on another team's `tail:` |
| S5 | S2 (approval mode) is on, so the Linear call is the one atc releases and linear-guard compares |

Later candidates, each only after its own S2 record (occ.md section 7): `CLOSE` as Done when the FLIGHT's PR is in the LOGBOOK as merged, not reverted, 1 hour has passed, and every done-criteria box in the body is checked (OCC reads it; `CLOSE` itself is not built yet); `LINK` for a prerequisite quoted verbatim from the body. `PRIORITIZE` stays human: priority follows the SUPERVISOR's plans, which ticket bodies rarely state. Never automatic: `rating:SEC` added or removed, CAUTION, `Canceled`, deletion, changing a `tail:` of an AIRBORNE team.

**Turn-on conditions.**

1. S2 has run for 2 weeks (occ.md section 11), with no APPLIED operation undone by a person. "Undone" is detected as a label that OCC added and that is gone within 7 days.
2. Human agreement on CLASSIFY drafts written after #29: 20 or more decided, 85% or more agreed.
3. CROSSCHECK on SCHEDULE CLASSIFY, per current model: 20 or more marked, 90% or more matched (today: 7 of 7, 2 of them from Muse).
4. Shadow precision: 20 or more auto-eligible drafts decided, 95% or more approved.

**Turn-off and rollback.** Switch `schedule.json` `auto: "off" | "shadow" | "on"`. Trips back to `shadow`: a human rejects a draft the rule marked eligible (in shadow) or removes an auto-applied label (in `on`), a linear-guard block, or the per-model match falling below 85%. Rollback of one applied CLASSIFY: atc drafts the inverse operation (remove exactly the labels it added) as a normal S2 draft for the SUPERVISOR to approve; nothing is removed automatically.

**Metrics.** Eligible and applied per day, undone within 7 days, human agreement on CLASSIFY, per-model CROSSCHECK match, label mismatches found later by DISPATCH (a FLIGHT excluded or re-classified after auto-apply).

**Data needed.** Post-#29 CLASSIFY verdicts; S2 turned on; label-removal detection in the Linear source (compare labels between fetches).

## 5. Merge slots

**Purpose.** Keep the LANDING SEQUENCE from thrashing: in a repository whose branch protection needs an up-to-date branch, every merge can put the other CLEARED PRs `BEHIND`, and each of them then rebases and reruns CI. The vocado queue (median wait 142 min, p90 583) is where this matters; atc (median 2 min, no CI) needs nothing.

**Rules.**

- **Slots per repository and base.** At most `landingSlots` PRs at a time hold a LAND CLEARANCE that has not landed yet. Default: 1 for repositories that require up-to-date branches or have required checks (vocado_nextjs), unlimited for repositories without CI (atc). A PR that is CLEARED but outside the slots stays in the sequence with its number, and TOWER does not send it LAND yet.
- **Order.** As today: CLEARED PRs by `readyAt`. Optional (SUPERVISOR decision): an Urgent-priority FLIGHT moves to the front of its repository's sequence.
- **Pacing.** The next LAND in the same repository goes out when the previous one merged, or when its LAND is older than `landTimeout` (default 30 min: atc's p90 landing wait is 12 min, so 30 min leaves margin. vocado's longer LOGBOOK waits run from PR opened to merged, which includes review time before the PR is CLEARED, so they overstate the time after LAND). A timed-out LAND is reported to the SUPERVISOR and its slot freed.
- **Rebase cost.** After a merge, PRs in the same repository that turn `BEHIND` are counted. If more than 2 PRs are made `BEHIND` per merge on average over a day, the slot stays at 1; if CI duration is short (median under 10 min), the slot can be raised to 2.
- **Where it runs.** atc computes `slot` for each PR in `landingQueue` (`in-slot` / `waiting-slot`); TOWER's rules issue LAND only to `in-slot` PRs. No new write path.

**Turn-on.** Run in shadow (show `waiting-slot` in STRIPS, TOWER still issues LAND as today) for 1 week, then compare: how often two LANDs in the same repository were active at once, and how many PRs went `BEHIND` after each merge.

**Turn-off.** `atfm.json` `slots: "off" | "shadow" | "on"`. Off restores today's behaviour (LAND for every CLEARED PR).

**Metrics.** Landing wait per repository (median and p90), LAND → merge time, BEHIND events per merge, CI reruns per PR, LAND timeouts.

**Data needed.** CI duration per PR and per check run (check runs' `startedAt` is already fetched for CLEARED TO LAND; `completedAt` must be added); BEHIND transitions per merge (from consecutive snapshots); whether each repository requires up-to-date branches (branch protection, read-only `gh api`).

## 6. Ground stop

**Purpose.** When the system itself is in trouble, stop adding load: no new assignments and, where it helps, no new merges, until the cause is gone. A **GROUND STOP** stops new ASSIGNs (and LAND where stated) for one AIRPORT; a **GROUND DELAY** only reduces its AIRBORNE slots by one.

**Triggers and releases** (per AIRPORT, i.e. per repository):

| Trigger | Stops | Released when |
|---|---|---|
| **Main broken**: the default branch head has a failing required check | New ASSIGN and all LAND for that AIRPORT (new work would branch from a broken base; merges would pile on) | The default branch head is green, or the SUPERVISOR releases it |
| **CI failure wave**: 3 or more PRs in the same repository fail the same check within 1 hour | New ASSIGN and LAND | The failing check passes on a newer head in 2 PRs, or the SUPERVISOR releases it |
| **CI congestion**: more than 4 PRs with pending checks for over 30 min, or median check duration over 2× the 7-day baseline | GROUND DELAY: AIRBORNE slots −1; LAND continues so the queue drains | Below the threshold for 30 min |
| **LOS rising**: 2 or more open LOS at the AIRPORT, or 3 or more LOS there in 24 h | New ASSIGN | No open LOS for 30 min |
| **Manual**: the SUPERVISOR declares a ground stop with a reason | Whatever the SUPERVISOR selects | The SUPERVISOR releases it |

Codex usage-limit notices (PRs stuck on `no-review` with "Codex 한도") are reported as INFO, not a ground stop: they block landing by themselves.

**Who does what.**

- **atc** computes `groundStops` (AIRPORT, kind, trigger, since, evidence) in the snapshot, shows it as an ALERT and on the AIRPORTS and STRIPS tabs, and records start and end in the FLIGHT RECORDER.
- **Planner (DISPATCH)** excludes stopped AIRPORTs with the reason `GROUND STOP — <trigger>` and holds approved-but-unsent ASSIGNs there (`dispatch release` refuses while stopped).
- **TOWER** issues no LAND for a stopped AIRPORT. When a stop starts, it sends one `HOLD` CLEARANCE to the holders of that AIRPORT's CLEARED PRs ("GROUND STOP: <trigger> — LAND 보류"). When the stop ends, it sends `CONTINUE` and resumes LAND in sequence order.
- **OCC** writes no FLIGHT PLAN for a stopped AIRPORT, and puts the stop in its OCC LOG. For "main broken" it reports the failing check and the commit to the SUPERVISOR (read-only `gh`).

**Turn-on.** Shadow for 1 week: triggers are computed and shown, nothing is stopped. The SUPERVISOR reviews false positives (for example a flaky check) and adjusts thresholds before `on`.

**Turn-off.** `atfm.json` `groundStop: "off" | "shadow" | "on"`, plus a manual release per stop.

**Metrics.** Stops per week by trigger, duration, false-positive share (stops the SUPERVISOR released manually within 10 min), assignments and LANDs held.

**Data needed.** The default branch head's check status per repository (read-only `gh api repos/<slug>/commits/<branch>/check-runs`, polled with the PR list); check durations (section 5); LOS per AIRPORT is already in the snapshot.

## 7. Safeguards (all automatic behaviour)

| Safeguard | Rule |
|---|---|
| Switches | One per mechanism, each `off \| shadow \| on`, default `off`: `dispatch.json` `auto`, `schedule.json` `auto`, `atfm.json` `slots` and `groundStop`. One "ATFM OFF" button sets every switch to `shadow` at once |
| Daily caps | Automatic ASSIGNs: at most 3 per day overall and 1 per AIRCRAFT per day. S3 automatic operations: at most 5 per day. Days are KST. At the cap, eligible items fall back to the normal human flow |
| Automatic trips | Each mechanism has trip conditions (sections 3–4) that set its switch back to `shadow` and raise an alert. Turning it back on is a SUPERVISOR action |
| Notification | Every automatic action is an event in `/api/events` and a line in an "AUTO" list in its tab. Trips and ground stops are ALERTs. OCC and TOWER mention automatic actions in their LOG lines |
| Record | FLIGHT RECORDER lines of a new kind `atfm`: `{op: "auto-approve" \| "auto-apply" \| "trip" \| "ground-stop" \| "ground-release" \| "slot-hold" \| "switch", id, rule, inputs}`. `inputs` is the snapshot of the conditions that were checked, so any automatic action can be explained afterwards |
| Attribution | Automatic approvals are `approve` ops with `by: "atfm"` and `via: "atfm"`. They are excluded from the human gates and the CROSSCHECK match rate (principle 2) |
| Guards | Automatic FLIGHT PLANs go through `dispatch release` and send-guard; automatic Linear writes through `schedule release` and linear-guard. No guard gets a bypass |

## 8. Implementation order

Each step is one PR. Shadow steps change nothing that teams or Linear see.

1. **Data** (shadow-free): record check durations and the default branch head status per repository; BEHIND transitions per merge; label-removal detection in the Linear source; `atfm` recorder kind. No behaviour change.
2. **Ground stop, shadow**: compute `groundStops`, ALERT, AIRPORTS/STRIPS display, recorder. Nothing is stopped.
3. **Merge slots, shadow**: `slot` in `landingQueue`, shown in STRIPS. TOWER unchanged.
4. **Auto-eligibility for DISPATCH, shadow**: `auto` verdict and failed conditions on every open ASSIGN, the "STAGE 3" panel with shadow precision. Can start during 2a, because it only compares with human decisions.
5. **Auto-eligibility for S3, shadow**: the same for CLASSIFY drafts.
6. **Ground stop on**: planner exclusion, `dispatch release` refusal, TOWER HOLD/CONTINUE rules. After the SUPERVISOR accepts the week of shadow.
7. **Merge slots on**: TOWER issues LAND only to `in-slot` PRs.
8. **Recall** (`[DISPATCH D-xxxx] RECALL`, send-guard extension) — needed before automatic assignment.
9. **Automatic assignment on**: switch, caps, trips, attribution. Only after the section 3 turn-on conditions hold.
10. **S3 automatic CLASSIFY on**: after the section 4 turn-on conditions hold.

Steps 1–5 can be built now; they give the data that steps 6–10 need. Steps 2 and 3 are the cheapest to turn on and protect the most.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Automation grades itself | `via: "atfm"` is excluded from every agreement and match figure |
| A flaky check triggers ground stops | A week of shadow first, a false-positive metric, manual release, the CI failure wave needs 3 PRs |
| Slots slow down repositories that don't need them | Slots default to unlimited for repositories without CI; per-repository settings |
| An automatic FLIGHT PLAN lands on a team that is busy in reality | A8 (PARKED, no recent NO READBACK or DECLINED), 1 per AIRCRAFT per day, recall |
| Labels drift and make A1–A4 wrong | A1 requires explicit labels, S3 only adds labels on empty axes, human agreement on CLASSIFY is part of the S3 gate |
| Too little data to ever turn things on | Shadow eligibility (steps 4–5) starts now, during 2a and S1, so the precision record builds up in parallel |

## Decisions for the SUPERVISOR

Collected here; none of them is decided yet.

1. **Auto-eligible FLIGHT TYPEs**: BUILD, MAINT and FERRY only (proposed), or also SURVEY?
2. **Thresholds**: shadow precision 95% over 20, CROSSCHECK per-model match 90% over 20, trip at 85% — keep, or change?
3. **Daily caps**: 3 automatic ASSIGNs per day, 1 per AIRCRAFT; 5 S3 operations per day?
4. **Recall**: build `[DISPATCH D-xxxx] RECALL` before automatic assignment (proposed), or accept that rollback is a direct message from the SUPERVISOR?
5. **S3 scope**: CLASSIFY on empty axes only (proposed); when to consider `CLOSE` after merge?
6. **Merge slots**: 1 for vocado_nextjs and unlimited for atc (proposed); may an Urgent FLIGHT jump its repository's queue?
7. **LAND timeout**: 30 minutes?
8. **Ground stop scope**: should "main broken" also stop LAND (proposed) or only new ASSIGNs? Which of the four triggers go to `on` first?
9. **Order**: build steps 1–5 (data and shadow) now, in parallel with 2a/S1 (proposed)?
10. **Where the switches live**: separate `atfm.json` for slots and ground stops (proposed), or all in `dispatch.json`?
