# Survey: a standing improvement-finding role (RELIABILITY)

**English** · [한국어](improvement-watch.ko.md)

> Status (2026-10-01): research, not adopted. Written for [ATC-299](https://linear.app/vocado/issue/ATC-299/survey-a-standing-improvement-finding-role-watch-linear-the-repository). No code, manual, guard, setting, Linear issue, GitHub issue or state file was written. The follow-up work orders in section 6 are not created in Linear.

Related: [watch.md](../watch.md) (ON HOLD, not reopened here), [duty.md](../duty.md) (IDEAS / ADOPT), [occ.md](../occ.md) 5 (SCHEDULE `NEW`), [safety-report.md](../safety-report.md), [readability.md](../readability.md), [knowledge.md](../knowledge.md), [atfm.md](../atfm.md) principle 1 (shadow first), [control-context.md](control-context.md) (what a session costs), [aviation-signals.md](aviation-signals.md).

## Question

The SUPERVISOR wants something that keeps finding what atc should fix or build next, instead of waiting for them to notice. What should it watch, how should it run, where do the findings go, and how is it kept cheap and quiet?

## Method and limits

- **Facts** are from `origin/main` at `338c2f4` (2026-10-01) and from this host's state on the same day. The Linear picture is the atc server's own snapshot (`GET /api/snapshot`, 466 KB, 411 tickets of which 211 are ATC). Nothing was fetched from Linear directly.
- **Dry run.** Five throwaway scripts in a scratch folder (not in the repository) ran each detector once. They read the repository, the snapshot and `~/.local/state/atc/*.jsonl`. **Counts and keys only**: no record text and no transcript was read or is quoted. Two GitHub reads (open `idea` issues, the last 100 CI runs). No test server was needed, nothing was written to state, no session was messaged.
- **"Would the SUPERVISOR accept it?"** in section 5 is my own call. It is not a measurement. Measuring it is what the shadow phase is for.
- **Short history.** atc's records start on 2026-09-26, five days ago. Detectors about age (stale Todo, long-running FLIGHTs) have nothing to find yet, so their thresholds are untested.
- **Prior art (section 2)** is written from the cited standards and tools as I know them. I did not re-fetch the sources for this survey, so details such as numeric alert levels are marked where they are recalled and not verified.
- **Public repository:** no other AIRPORT's internals. The second Linear team in the snapshot is only counted, never described.
- Spend: one session, no helper agents, about 0.15 M tokens (a rough estimate, about 1 to 2 USD at list price).

## Summary

1. **Most of what a finder would find is already in data atc holds**: the snapshot (0 extra Linear calls), the docs and the append-only records. One pass over all of it took about 0.15 s of CPU and 2 REST calls to GitHub.
2. **Model-free detectors give usable but narrow output.** Of 23 detectors run, 3 are worth building first (STATUS MARKS, PARENT CLOSABLE, IDEA ADOPTED) and 3 more are cheap (CHANGELOG PILE, MCC ESCALATE RECURRENCE, UNLABELLED). The rest were empty, duplicated an existing screen, or were too noisy without judgment.
3. **The judgment-needing signals** ("Not built yet" items with no issue, repeated review comments, manual friction) are real but are prose. They should come **second**, after the noise controls and the acceptance measure exist.
4. **Recommendation: Option A in shadow, then A feeds E.** A deterministic server `findings` list, behind a read-only API, recorded as "would show", with the SUPERVISOR's verdict chips as the measure. No new session, no model, no authority. Section 3 compares the options; section 4 gives the findings path.

## 1. Signals by source

Columns: **Kind** is `D` (a deterministic check finds it, no model) or `J` (needs judgment). **Cost** is the cost of one read. **Cadence** is how often the source changes. Detector IDs link to the dry run (section 5).

### 1.1 Linear (ATC; the second team only counted)

Read from the atc server's snapshot. The server already polls Linear, so a detector adds no Linear call.

| Signal | Kind | Cost | Cadence | Detector |
|---|---|---|---|---|
| `Todo` with no priority (the DISPATCH planner skips it) | D | 0 (snapshot) | minutes | L1 |
| `Todo` or `Backlog` untouched for N days | D | 0 | days | L2 |
| Parent in `Todo` with no children, or open parent whose children are all Done | D | 0 | hours | L3, L3b |
| Open issue whose `blockedBy` are all closed (unblocked, still waiting) | D | 0 | hours | L4 |
| High priority (1 or 2) left in `Backlog` | D, then J (some are on hold on purpose) | 0 | days | L5 |
| `In Progress` for N days without an update | D | 0 | hours | L6 |
| Missing classification labels (`type:`, `wake:`, `rating:`) | D | 0 | minutes | L7 |
| Design-doc status marks that disagree with Linear (a row's issue is Done, no ✅) | D after a row filter, else J | 0 + file reads | hours | L8 |
| Same issue UNABLE or rejected repeatedly, and why | D to count, J to read why | records | hours | R2, R4 |
| Done issue without an "as built" section in its design doc | D to list, J to say it is needed | 0 + file reads | hours | not run (needs a per-issue doc map) |

### 1.2 Repository

All reads are local files: no API, cost is milliseconds (74 ms for everything below over about 1,000 files).

| Signal | Kind | Cadence | Detector |
|---|---|---|---|
| `*.md` / `*.ko.md` pair drifted (heading count, line ratio) | D | per PR | D2 |
| A doc that must have a pair has none | D (needs the list from root `CLAUDE.md`) | per PR | D2 |
| Unfolded `changelog.d/` fragments (count, age) | D | per PR | D3 |
| `TODO` / `FIXME` | D | per PR | D4 |
| `server/*.ts` with no `*.test.ts` | D to list, J to say which are pure | per PR | D5 |
| Large or fast-growing files | D (size now), needs history for growth | per PR | D6 |
| "Not built yet" sections: how many items and which cite an issue | D to find the sections, **J** to split prose into items | per PR | D7 |
| "Not built yet" items with no issue anywhere | J | per PR | not run |
| Manuals past a size budget (control manuals, [control-context.md](control-context.md)) | D once a budget is decided | per PR | not run (no budget exists) |
| Ratchets (CSS tokens, rules drift) | D, already built, one-off each | per PR | exist |

### 1.3 atc records (`~/.local/state/atc/`, read-only)

JSONL files are append-only. On 2026-10-01: `proposals` 1,856 lines (1.0 MB), `clearances` 627 (142 KB), `mcc` 636 (553 KB), `schedule` 63 (22 KB), `readability` 5 days (245 KB). A full pass over them is 31 ms; a cursor (last line read) makes a pass read only new lines.

| Signal | Kind | Cadence | Detector |
|---|---|---|---|
| MCC ESCALATE rate, and the recurring reason class | D to count, **J** to classify the reason (I used a crude regex) | per PR | R1 |
| CLEARANCE UNABLE count and class | D | per CLEARANCE | R2 |
| The same FLIGHT receiving 4 or more CLEARANCEs (rework, conflicts) | D | per FLIGHT | R3 |
| DISPATCH reject reason codes, `undelivered`, `expire`, `recall` | D | per card | R4 |
| SCHEDULE verdict agreement and its gate | D | per verdict | R5 |
| READABILITY daily metrics against a threshold (latency, overdue, UNABLE) | D | daily | R6 |
| NEEDS YOU and BLOCKED frequency, FUEL burn per FLIGHT kind, LAUNCH refusals | D | per event | not run (state lives in job files and FUEL, not these four records) |
| ROLLBACK | D | rare | none in the window |

### 1.4 GitHub

| Signal | Kind | Cost | Detector |
|---|---|---|---|
| CI failures by job | D | 1 REST call (`gh run list`, last 100 runs) | G2 |
| `idea` issues cited by a design doc (adopted, still open) | D to cite-match, J to confirm | 1 call (the server already serves `/api/ideas`) | G1 |
| `idea` issues with no activity | D | same | G1 |
| PRs that sat unlanded | D | 0 (snapshot `pulls`, already carries `landing` and `blocks`) | exists on the PR screens |
| Review comments that repeat across PRs | **J** | many calls | not run |

Use REST for the idea list. `gh issue list` uses GraphQL, the budget shared with the atc server's polling ([watch.md](../watch.md) 1.1: it ran out hourly during the overnight loop). My two reads cost 2 GraphQL points; the REST form costs none of that budget.

## 2. Prior art

I recalled these from the standards and tools, not from a new fetch (see Method). What matters is the pattern each one gives.

| Source | What it does | Deterministic | Model or human | Noise control | What carries over to atc |
|---|---|---|---|---|---|
| **FOQA / FDM** (FAA AC 120-82, ICAO Annex 6 and Doc 10000) | Every flight's recorded data is scanned against defined **events** (a parameter exceeds a threshold); trends go to a safety group | Event detection | An analyst reads trends and decides action | De-identified data; events are tuned; the programme reports **rates over time**, not single exceedances | atc's FLIGHT RECORDER and the JSONL records are flight data. Detectors are events; report **rates** (R1, R6) before single hits |
| **SMS safety assurance** (ICAO Annex 19, Doc 9859) | Safety performance indicators with **alert levels** and targets | Indicator calculation | Safety review board | A level fires on the indicator, not on each event | Each detector has an alert level; the SUPERVISOR is not shown below it |
| **Maintenance reliability programme** (EASA Part-M AMC M.A.302, FAA reliability programmes) | Removal and failure rates per component; an **alert level** set statistically from the history (commonly mean plus a multiple of the standard deviation); exceeding it triggers an investigation, not a repair | Rate and alert level | Engineers investigate | Level is recomputed from the fleet's own history; an investigation closes when the rate returns | Needs history atc does not have yet (5 days). Start with fixed thresholds; compute levels after about 4 weeks |
| **Dependency and code-health bots** (Dependabot, Renovate; CodeScene-style hotspots) | Open one PR or one finding per change; hotspot = size times change frequency | Fully | None, or a human merges | Grouping, schedule, rate limit per day, ignore lists | Daily cap, a cool-down per key, and an ignore verdict are the same mechanism (section 4) |
| **Scheduled agent runs** (Claude Code `/loop`, scheduled routines, headless `claude -p`) | A model runs a fixed prompt on a timer | No | The model | Fixed output file, fixed prompt; cost is per run | Option D. Cost per run is real; atc already measured it ([control-context.md](control-context.md) 1: the cache is shared between separate `claude -p` runs on the 1-hour tier) |
| **Linear Triage Intelligence** (idea [#155](https://github.com/chaehy5665/atc/issues/155)) | Suggests labels, teams, duplicates on incoming issues | No | Linear's model | Per-team opt-in | A second opinion on a finding's draft, not a source of findings |
| **Issue mining from CI and review history** | Cluster failing checks and repeated review comments into recurring causes | Clustering by key | A person names the cause | Needs a recurrence threshold | The SAFETY REPORT threshold (3 reports on 2 days in 7) is the same idea and is already designed |

The aviation lesson for atc is the same in all three: **detect by rule, count a rate, alert on a level, let a person investigate**. A model belongs in the investigation, not the detection.

## 3. Options

All five on the same columns. Costs are estimates from [control-context.md](control-context.md) (a control session's tick is about 0.2 USD cached; headless runs share the cache on the 1-hour tier).

| | A. Server detectors, no model | B. New control session, slow tick | C. A DUTY mode | D. Scheduled headless run | E. Through OCC SCHEDULE `NEW` |
|---|---|---|---|---|---|
| Sketch | Pure `findingsOf(snapshot, docs, records)` and `GET /api/findings` | A read-only session reads A's list and writes drafts | DUTY gets a "review" turn, turns findings into cards | A daily `claude -p` or routine, fixed prompt, fixed output file | Findings become `NEW` drafts under the existing limits |
| Tokens per day | **0** | one tick an hour at 0.05 to 0.2 USD cached, so **about 1 to 5 USD** | one turn per review, **about 0.2 to 0.5 USD** each, only when asked | one run, **about 0.3 to 1 USD** | the OCC tick already runs; a draft adds a Linear read and a CROSSCHECK review |
| GitHub rate | 2 REST calls a pass (cached by the server) | same, through atcctl | same | a `gh` read per run | the SCHEDULE snapshot already reads Linear |
| Noise | set by detectors and caps (section 4) | model-written text, more variable | the SUPERVISOR chooses when | one report a day; no feedback loop | **limits already exist**: 5 open drafts, 3-day expiry, duplicate search |
| Where authority sits | none: it lists | session with a guard; drafts only | DUTY (decides nothing, acts when spoken to) | none: file only | SUPERVISOR verdict on each draft; **OCC never drafts `NEW` on its own initiative today**, except WAYPOINT gaps (occ.md 5, as the ATC-299 brief quotes it) |
| Guard / settings change and tier | none; new `server/` files: **`auto`** | new folder, guard, settings, LAUNCH entry in `session-control.ts`: **`user`** | `duty/CLAUDE.md` and possibly `duty/guard.mjs`: **`user`** | `.claude/` settings or a timer outside atc: **`user`**, and an unattended model | `occ/CLAUDE.md` and server: **`flagged`**; **a rule change** the SUPERVISOR must decide |
| Overlap | READABILITY, SAFETY REPORT S1 (same pattern, other sources) | WATCH (on hold), CROSSCHECK | DUTY IDEAS / ADOPT | WATCH's overnight loop (the shape to avoid: re-reads everything) | SCHEDULE `NEW` / CHARTER DESK |
| Can start in shadow | **yes**: `findings.jsonl` of "would show" | yes, but a session costs from the first tick | yes | yes (file only) | yes: the SCHEDULE shadow gate already exists |
| Judgment signals | no | yes | yes | yes | only if A or a model supplies them |

**Recommendation: A, in shadow, and later A feeds E.** Reasons:

1. **Cost and rate.** A is free in tokens and in Linear calls, because the snapshot is already in the server. B and D add a model run to find things a 150 ms function finds.
2. **The overnight lesson.** The ENGINEERING loop re-read everything each tick and 40 of 43 ticks were "unchanged" ([watch.md](../watch.md) 1.1). A fingerprint of findings (the key set) lets nothing change cost nothing; the SUPERVISOR is touched only when a **new key** appears.
3. **Authority stays with the SUPERVISOR.** A lists. Nothing is created until the SUPERVISOR clicks, and then the route is the existing one (DUTY ADOPT, or later a `NEW` draft). No guard changes in the first steps, so the first steps are `auto`.
4. **It measures itself.** The verdict chips per detector are the acceptance measure that decides whether a detector stays (section 4). A model-run option would have to build that measure first anyway.
5. **It reuses what is designed.** SAFETY REPORT S1 already specifies the same group, threshold and `safety:<key>` INFO alert shape. READABILITY already holds the radio numbers. A is the same pattern over the sources they do not cover.

**First step in shadow.** Ship `findingsOf` and `GET /api/findings` with six detectors, record each pass's new keys in `findings.jsonl` as `would-show`, show **nothing** on the screen, and count for two weeks which of them the SUPERVISOR would have accepted by marking a sample by hand. Then show them (work order 3) with verdicts.

**Rejected for now:** B (a session to read a list is a model run for no new information, and it needs a guard), D (an unattended model and a settings change, with no feedback measure), C as the first step (DUTY then decides when to look, so findings arrive only when asked; it is the right *consumer* of a finding, which is work order 5). E is the right *destination* for a few accepted finding kinds, but it changes a rule that the SUPERVISOR set ("OCC never drafts `NEW` on its own initiative"), so it waits for decision 2 in section 7.

## 4. Findings path and noise control

### 4.1 Where a finding goes

```
detectors (server, pure) → findings list (GET /api/findings, findings.jsonl)
   → SUPERVISOR sees it: INFO alert key `finding:<key>` + a list on a screen
   → SUPERVISOR verdict: ACCEPT (+ send to DUTY) · DISMISS (+ reason chip) · SNOOZE
   → ACCEPT → an ADOPT-style message to DUTY → a work order (Backlog / Todo)
   (later, per kind, after its acceptance gate) → a SCHEDULE `NEW` draft (E)
```

- **Always the SUPERVISOR decides.** A finding is never a Linear issue, a GitHub issue or a message to a team by itself.
- **Surface:** one INFO alert per new key (the SAFETY REPORT S1 pattern) and a list. Where the list lives (its own tab, the DISPATCH tab, or a drawer like IDEAS) is decision 3.
- **Business or private ideas** do not enter this list. It is built from the public repository and the ATC team only.

### 4.2 Dedup against what exists

A finding is dropped, or marked `similar`, when:

- its **key** (`<detector>:<subject>`) is open, snoozed or in cool-down (below);
- `similarTickets(title, tickets, now)` (`server/schedule.ts`) returns a hit among open issues or issues closed in the last 45 days. This reuses SCHEDULE's duplicate search unchanged;
- the same check against open `idea` issue titles and against the text of a doc's "Not built yet" section (a token match; the knowledge index of [knowledge.md](../knowledge.md) replaces this when it exists, ATC-105 to 107).

### 4.3 Thresholds and caps (proposed, to be tuned in shadow)

| Control | Proposal | Why |
|---|---|---|
| Per-detector threshold | A fixed value per detector, written next to it. Alert levels from history after about 4 weeks (section 2, reliability programmes) | atc has 5 days of history |
| Rate before single event | R-detectors fire on a rate (for example 3 on 2 days in 7, the SAFETY REPORT threshold), not on one line | One escalation is a decision; five is a pattern |
| Daily cap | 3 new findings shown a day, the rest held in order of detector value | Same spirit as `SCHEDULE_OPEN_LIMIT` (5 open) |
| Open cap | 5 open findings; a new one waits until one is decided | Same as SCHEDULE |
| Cool-down per key | Dismissed: 14 days. Snoozed: until the snooze. Accepted: until the work order closes | No nagging |
| Quiet when unchanged | A pass whose key set equals the last pass writes nothing and alerts nothing | The overnight lesson |
| Pass cadence | Event-driven where the snapshot already changes (docs on merge, tickets on poll), otherwise hourly | A pass costs about 0.15 s |

### 4.4 Acceptance measure

Per detector, from the verdicts in `findings.jsonl`: **accepted / (accepted + dismissed)** over the last 14 days, with `snoozed` counted separately.

- **Stays on** at 50 % or more with at least 10 verdicts.
- **Goes back to shadow** below 20 % with at least 10 verdicts (the WATCH rule: an intervention moves a kind back, [watch.md](../watch.md) section 2, principle 5).
- **Dismiss reasons** are chips (`already-known`, `not-worth-it`, `wrong`, `later`) so a detector can be fixed rather than only switched off. `wrong` counts double against it.
- The gate follows the SCHEDULE pattern (`gateOf`: a minimum number of verdicts and a rate), with lower numbers because a finding is cheaper to dismiss than a SCHEDULE draft is to apply.

## 5. Dry-run results

Run on 2026-10-01 at about 06:30Z. Scratch scripts, not in the repository. Cost per pass: **repository 74 ms (about 1,000 files)**, **Linear detectors 11 to 27 ms over the 466 KB snapshot (0 Linear calls)**, **records 31 ms over 2.0 MB of JSONL**, **GitHub 2 REST-equivalent reads**. The whole pass is about 0.15 s and no model tokens.

### 5.1 Numbers

| ID | Detector | Findings | After my filter | Notes |
|---|---|---|---|---|
| L1 | `Todo` with no priority | 2 raw, **0** | 0 | Both were `Exit:` issues (no priority by design). A title-prefix exclusion is needed |
| L2 | Todo/Backlog untouched 14+ days | 0 | 0 | atc is 5 days old: untestable |
| L3 | Todo parent with no children | 0 | 0 | |
| L3b | Open parent, all children Done | **1** | 1 | ATC-275 |
| L4 | Todo/Backlog whose blockers are all closed | **12** | 4 on Todo | The 8 Backlog ones are held on purpose (parent or revisit). Todo ones are what DISPATCH already shows |
| L5 | Priority 1 or 2 in Backlog | 5 | 0 | All are WATCH (on hold, ATC-223 to 226) or an ALERTING step. A hold marker is needed, which is judgment |
| L6 | In Progress 3+ days without an update | 0 | 0 | |
| L7 | Open issue with no `type:` label | 6 | 4 | Two are `Exit:` issues. The `wake:` gap is the same 6 |
| L8 | Design-doc row's issue Done, no ✅ | **17** | about 7 | Hand check of 6 rows: 3 real, 3 are "depends on" mentions. A filter on the **row's first cell** is needed |
| D2 | `*.md`/`*.ko.md` pair drift | **0** | 0 | 0 drifted pairs among the required pairs. The first run flagged 21 `docs/*.md` with no `.ko.md`; root `CLAUDE.md` requires pairs only for a named list, so the detector needs that list |
| D3 | Unfolded `changelog.d` fragments | **130** (65 pairs) | 1 finding | Oldest is from 2026-09-29. One finding ("fold now"), not 130 |
| D4 | `TODO` / `FIXME` | 2 raw | 0 | Both are the word "TODO" as a Follow stage label. Nothing real |
| D5 | `server/*.ts` with no test | 23 of 152 | about 5 | Top: `snapshot.ts` 383 lines, `index.ts` 338, `model.ts` 284, `events.ts` 136, `recorder.ts` 123. Most are wiring; only a human tells which hold pure logic |
| D6 | Source files over 1,000 lines | 7 | 0 as a finding | `Dispatch.tsx` 1,642, `globe-geo.ts` 1,626 (data), `proposals.ts` 1,519, `Schedule.tsx` 1,372, `schedule.ts` 1,188, `atcctl.mjs` 1,019, `dispatch.ts` 1,012. Growth needs history |
| D7 | "Not built yet" sections | 13 docs | n/a | The section is prose: my item counter found 0 items in 9 of 13. This detector needs judgment; not usable without a model |
| R1 | MCC ESCALATE | 23 of 177 INSPECTIONs (13 %) | **1 trend** | 15 of 23 reasons mention an operating-state format change, 7 a `user`-tier file, 1 other (regex class) |
| R2 | CLEARANCE UNABLE | 14 of 314 (4.5 %) | 0 | READABILITY already classes these |
| R3 | A FLIGHT with 4+ CLEARANCEs | 7 FLIGHTs | 2 | 5 of the 7 belong to the second team; `ATC-129` and `ATC-219` are atc's |
| R4 | DISPATCH undelivered / reject / expire | 8 undelivered, 5 reject, 17 expire | 1 | 6 of 8 undelivered are "no agent by that name": the known cause of ATC-251 |
| R5 | SCHEDULE verdicts | 13 (10 agree, 3 disagree) | 0 | Below the 20-verdict gate. Not a finding; a progress number |
| R6 | READABILITY, last day | 139 calls, p90 25.6 s, 1 overdue | 0 | Thresholds not set yet |
| G1 | `idea` issues cited by a design doc | **6 of 14** open | 4 | `#246`, `#271`, `#154`, `#280` have a design doc or built feature; `#41`, `#96` are cited as comparison or partial. `#121` (named in the survey brief as stale) is **already closed** (2026-09-30) |
| G2 | CI failures by job | **0** of the last 100 runs | 0 | All `ci` runs succeeded |

### 5.2 Samples and my call

"Accept" means I think the SUPERVISOR would act on it. This is not measured.

| Detector | Sample (5) | My call |
|---|---|---|
| **L8 STATUS MARKS** | `knowledge.md:206` (ATC-104 Done, row has no ✅); `mac-app.md:75` (ATC-152 Done); `launch.md:279`, `launch.md:287`; `alerting.md:186` | **Accept 2 of 5** (the first two). The other three mention the issue as a dependency, so the first-cell filter would drop them. After the filter I expect most rows to be real |
| **L3b PARENT CLOSABLE** | ATC-275 (FOLLOW board, Backlog, 3 of 3 children Done) | **Accept** (close the parent). Only 1 now, but exactly the kind of chore DUTY does after a merge |
| **G1 IDEA ADOPTED** | `#246` (SAFETY REPORT design exists), `#271` (DUTY chat built), `#154` (Linear Releases design), `#280` (GLOBE built in steps), `#41` (cited as comparison) | **Accept 4 of 5**: close with a link or relabel. `#41` is a comparison, dismiss |
| **D3 CHANGELOG PILE** | one finding: 130 fragments, oldest 2026-09-29 | **Accept**, but low value: it is a chore for ENGINEERING or the SUPERVISOR with an existing command |
| **R1 MCC ESCALATE RECURRENCE** | one finding: 15 of 23 escalations are about an operating-state format change | **Accept**: it asks whether the rule could be checked earlier (in `atc-task`, or by `landing-tier`) so a team does not learn it from an ESCALATE. This is the most "improvement-like" finding of the run |
| **L4 UNBLOCKED** | ATC-262, ATC-263 (blocked by ATC-260 and ATC-291, now Done), ATC-296, ATC-287 | **Reject as a detector**: DISPATCH already lists these as ready. Redundant, which is a dedup rule (do not report what a screen already shows) |
| **L5 BACKLOG HIGH** | ATC-223, 224, 225, 226 (WATCH, on hold on purpose), ATC-203 | **Reject**: 4 of 5 are deliberate holds. Without a hold marker this is noise |
| **D5 NO TEST** | `snapshot.ts`, `index.ts`, `model.ts`, `events.ts`, `recorder.ts` | **Reject for now**: wiring files that need no unit test. Needs a purity check, which is judgment |
| **D7 NOT BUILT YET** | 13 sections, mostly prose | **Cannot judge**: the detector cannot yet split items; it is a stage-2 (model) detector |

### 5.3 What the run says

- **3 first detectors, 3 cheap ones, 3 to drop.** Dry-run precision is high only where the finding is a **status mismatch between two records** (L8, L3b, G1) or a **rate** (R1). Single-record "this looks old" detectors (L2, L5, D5, D6) are noise or empty at this history.
- **Redundancy is the main noise source.** L4, R2 and R4 each duplicate a screen or READABILITY. Section 4.2 gets a rule: a finding that the SUPERVISOR already sees on a screen is not a finding.
- **Zero is a result.** D2 (0 drifted pairs) and G2 (0 failed CI runs) are the detectors saying the process is healthy. A finder that shows only the non-zero ones, per detector, stays quiet.
- **The regex classes (R1, R2) were crude.** R2 put all 14 into one class. Reading the reason text, which I did not do, is judgment. Counting by `reasonCodes` where they exist (DISPATCH reject has them) is deterministic and preferred.

## 6. Ranked detectors and follow-up work orders

### 6.1 Build order (value over effort)

| Rank | Detector | Value | Effort | Why this rank |
|---|---|---|---|---|
| 1 | **STATUS MARKS** (L8) | high: it replaces the manual "mark ✅ after merge" chore DUTY owns | S: one pure function over the snapshot and the docs, plus a row filter | Highest precision once filtered; the same check repeats every merge |
| 2 | **IDEA ADOPTED** (G1) | medium: keeps `idea` issues honest | S: reuse `/api/ideas` | 4 real findings today |
| 3 | **PARENT CLOSABLE** (L3b) | medium | S | Complements `closableOf` (CLOSE). 1 finding now |
| 4 | **MCC ESCALATE RECURRENCE** (R1) | high per finding, rare | S: a rate over `mcc.jsonl` | The single best "improve a rule" finding of the run |
| 5 | **CHANGELOG PILE** (D3) | low | XS | Cheap; shows the shape for repository detectors |
| 6 | **UNLABELLED** (L7) | low | XS | 4 real; needs the `Exit:` exclusion |
| 7 | **Required `.ko.md` pair** (D2) | low now (0), protects the rule | S | Needs the named list from root `CLAUDE.md`. Ship as a ratchet, as ATC-294 did |
| 8 | CI failure rate by job (G2) | 0 today, high on the day CI breaks | S | 1 REST call; alert level from history |
| – | Drop: L4, L5 (without a hold marker), D5, D6, D4, R2, R4 | | | Redundant, noisy or empty |
| – | Stage 2, model: D7 (not-built-yet items with no issue), review-comment repeats | high | M, needs the acceptance measure first | After the shadow measure exists |

### 6.2 Follow-up work orders (not created in Linear)

Each one is sized for a single FLIGHT. All of 1 to 4 and 6 are server or screen work with no guard change. I expect `auto`, and the server code that writes one new append-only file is `flagged` at worst; the real tier comes from `deploy/landing-tier.mjs` on the changed paths.

| # | Title | Scope | Expected tier |
|---|---|---|---|
| 1 | **FINDINGS core, shadow** | `server/findings.ts`: type `Finding {key, detector, subject, title, evidence[], at}`, `findingsOf(snapshot, docs, records)` pure, key set fingerprint, cool-down, daily and open caps; `server/findings-run.ts` runs it on the existing snapshot poll and appends `would-show` to `~/.local/state/atc/findings.jsonl`; `GET /api/findings` (read-only); tests with fixtures. No screen, no alert. The file is new and append-only | `auto` (or `flagged` for the new state file) |
| 2 | **FINDINGS detectors, set 1** | In `server/findings-detectors.ts`: STATUS MARKS (row's first cell is the key, Done, no ✅; "Implementation order" tables only), IDEA ADOPTED (open `idea` cited by a doc, via the server's existing ideas fetch), PARENT CLOSABLE, MCC ESCALATE RECURRENCE (3 in 7 days with a class from the escalate reason), CHANGELOG PILE (over 40 fragments or oldest over 3 days), UNLABELLED (with the `Exit:` exclusion). One pure function and tests per detector | `auto` |
| 3 | **FINDINGS on the screen with verdicts** | An INFO alert key `finding:<key>` per new key through ALERTING (the SAFETY REPORT S1 shape); a list (surface per decision 3); ACCEPT, DISMISS with reason chip, SNOOZE; verdict lines appended to `findings.jsonl` through a `fromThisApp` route; follows [design-language.md](../design-language.md) 3.5 and the section 5 checklist, and runs `ui-review` | `auto` (web) or `flagged` |
| 4 | **FINDINGS gate and acceptance measure** | `findingGateOf` (pure, tested) per detector: accepted over decided in 14 days with at least 10 verdicts; auto-return to shadow below 20 %; the number shown next to each detector | `auto` |
| 5 | **FINDINGS to DUTY** | An ACCEPT builds an ADOPT-style message (the server builds the text, as ADOPT does) to DUTY; a short "FINDING" section in `duty/CLAUDE.md` and `CLAUDE.en.md`; no guard change if `duty message` already carries it | `user` (`duty/`) |
| 6 | **FINDINGS dedup against ideas and "Not built yet"** | Extract `similarTickets` token logic into a shared helper; add the idea-title and doc-section sources; later swap in the knowledge index | `auto` |
| 7 | **SURVEY or build: stage-2 model detectors** | Which judgment signals earn a model turn (Not-built-yet items without an issue; repeated review comments; manual friction through SAFETY REPORT) and through which consumer (DUTY turn, or one `claude -p` per day with a fixed output file). Starts only after work orders 1 to 4 show an acceptance rate | `auto` (docs) |
| 8 | **Chore, not a detector: fold the 130 fragments and close the 4 adopted ideas** | `node server/changelog-fold.ts`; the SUPERVISOR or DUTY closes `#246`, `#271`, `#154`, `#280` with a link to the design doc | n/a (a person) |

The first four are independent of DUTY and WATCH. Work order 5 needs DUTY's L1 turned on (`duty.json`, off by default).

## 7. Decisions for the SUPERVISOR

1. **Go for A in shadow (work orders 1 and 2), and the name.** The role name is proposed as **RELIABILITY** (after the maintenance reliability programme: rates, alert levels, investigation by people), with FOQA as the name of the records-based detectors inside it. The document name `improvement-watch` is kept; say if you prefer another.
2. **May findings later become SCHEDULE `NEW` drafts on OCC's own initiative** (option E)? Today `occ.md` 5 (as the brief quotes it) says OCC never does, except WAYPOINT gaps. My suggestion: not before a detector has 10 verdicts and 50 % acceptance, one kind at a time, with SCHEDULE's own limits. This is your call, because it changes a rule you set.
3. **Where does the list live?** A drawer like IDEAS (`#findings`), a card on the DISPATCH tab, or its own tab. A drawer is the cheapest and fits "read, then send to DUTY".
4. **Scope of the Linear teams.** Default proposed: ATC only (`candidateTeams` in `dispatch.json`), because the second team's findings would need its owners. Say if the second team should be included.
5. **Caps and gate numbers** in 4.3 and 4.4 (3 a day, 5 open, 14-day cool-down, 50 % and 20 % with 10 verdicts). They are starting points for shadow, not rules; confirm or change.
6. **A model for the judgment signals (stage 2).** Not needed before work orders 1 to 4. A spend limit for a daily model run (about 0.3 to 1 USD) is a decision to take later.

## What this survey does not say

- The "would accept" calls are mine. The acceptance rates of section 4.4 are targets, not results.
- The regex classes in R1 and R2 are rough; neither read the text of a reason.
- Prior art (section 2) is recalled, not re-fetched. Numeric alert-level definitions and document numbers should be checked before they are quoted in a design.
- The time-based detectors (L2, L6, D6 growth) could not be tested on a five-day history.
- Cost estimates for options B, C and D use the control-session numbers of ATC-274, not a new measurement.
- Transcripts were not read. SUPERVISOR interventions per session, a candidate signal in [safety-report.md](../safety-report.md), are therefore not in the table.

## Sources

`origin/main` at `338c2f4` (2026-10-01): `docs/` (occ, duty, watch, safety-report, readability, knowledge, atfm, mcc, design-language), `server/schedule.ts` (`similarTickets`, `SCHEDULE_OPEN_LIMIT`, `gateOf`), `deploy/landing-tier.mjs`, `changelog.d/`. State on this host, 2026-10-01: `GET /api/snapshot` and `~/.local/state/atc/{proposals,clearances,mcc,schedule,readability}.jsonl` (counts only). GitHub: open `idea` issues of `chaehy5665/atc` and the last 100 `ci` runs. Standards named in section 2 (FAA AC 120-82, ICAO Annex 19 and Doc 9859, EASA Part-M AMC M.A.302), from recall.
