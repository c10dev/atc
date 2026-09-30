# Stage 2 DISPATCH design (draft)

**English** · [한국어](dispatch.ko.md)

DISPATCH proposes **which FLIGHT (Linear ticket) to send to which AIRCRAFT (team session), and when**. Where TOWER (stage 1) keeps aircraft that are already airborne from colliding, DISPATCH handles the plan before takeoff. It is the same split as between an airline's operations control center (OCC) and ATC.

> Status: the DISPATCH session merged into the OCC session (`atc/occ/`, [occ.md](occ.md)) on 2026-09-26; the work below is unchanged. 2a (shadow operation) running; 2b (approval operation) implemented behind `mode` and off by default (2026-09-26). See "Turning on 2b". Decisions are listed under "Decisions" at the end.
>
> Settled while implementing: under the 1-FLIGHT-per-TEAM rule, a HOLDING AIRCRAFT that holds the STAND of an unfinished FLIGHT is never assigned a FLIGHT that needs a STAND, however long it has been idle (the "30 minutes" rule in 5.1 is not used). It can take one `SURVEY` or `CHECK`, which need no STAND ([fleet.md](fleet.md) 5.1, 2026-09-27). RELEASE only looks at projects mapped to an AIRPORT (code work).

## 1. Current facts

| Item | Today |
|---|---|
| How work is assigned | The user talks to a TEAM session (CAPTAIN) directly. The CAPTAIN finds or creates the Linear issue and moves it to In Progress (vocado `CLAUDE.md`: "only leaders write to Linear") |
| Open FLIGHTs | 30. Todo 7 · In Progress 17 · In Review 6 · Backlog 0 |
| Linear data | 0 estimates, 0 cycles, 0 labels. All 30 have a project (Beta Readiness, Song Experience, Vocado Pre-seed IR & Pitch Deck, Vocado Visual System (SEED)). 3 blocks relations, 76 related. Almost everything is assigned to the one user |
| Congestion | Of the 17 In Progress, a few FLIGHTs always have no STAND (worktree) (NO CONTACT alerts) |
| Other operator | Symphony (`vocado_nextjs/WORKFLOW.md`): works `symphony-pilot` label + Beta Readiness tickets one at a time with Codex. Not running on this machine right now |
| TOWER | Stage 1 done; stage 1.5 FLIGHT RECORDER and METRICS are collecting operating data |

Constraints that follow from these facts:

- With no estimates, **capacity is measured in counts (slots), not points**.
- Assignees can't tell teams apart, so **team fit is estimated from past flight history** (which team flew related FLIGHTs). An assignee or delegate *other than* the API key's owner still means something: someone outside atc has the FLIGHT (5.1.2).
- With no labels, risky work (DB, security, rights) has to be read from the **ticket body**. That is the DISPATCH session's (LLM's) job, not a rule calculation.
- Backlog is empty, so Todo effectively means "waiting to depart".

## 2. Principles

1. **Propose only; the SUPERVISOR (user) decides.** No automatic assignment until stage 3 (ATFM).
2. **Start in shadow mode.** Proposals are made and shown on screen only. Nothing is sent to anyone; the user marks "I would approve / reject" to measure proposal quality.
3. **Don't write to Linear.** The CAPTAIN who receives an approved FLIGHT PLAN handles Linear as today, so the "only leaders write to Linear" rule doesn't need to change.
4. **Scores are computed; judgment belongs to people and the LLM.** Picking candidates and scoring are pure functions in the atc server (testable, with visible reasons). Reading hidden constraints in ticket bodies and writing the FLIGHT PLAN text is the DISPATCH session's job.
5. **Keep it separate from TOWER.** The sessions are split so that whoever assigns doesn't also judge the outcome (LOS). DISPATCH doesn't touch code either (same guard as TOWER).
6. **Assignments made directly by a person win.** If the user gives a TEAM work directly, DISPATCH follows along (the matching proposal becomes superseded).

## 3. Roles and permissions

| Role | Who | Does | May use |
|---|---|---|---|
| SUPERVISOR | The user | Approves and rejects proposals, adjusts slots and weights, final authority | Everything |
| DISPATCH | The OCC session (`atc/occ/`, was `atc/dispatch/`) | Reviews proposals (reads ticket bodies), delivers approved FLIGHT PLANs, records acceptance | atc CLI, SendMessage, Linear **read** |
| TOWER | The stage 1 CONTROLLER | Conflicts, HANDOFFs, LANDING SEQUENCE | atc CLI, SendMessage |
| CAPTAIN | Each TEAM leader | Accepts a FLIGHT PLAN (READBACK) or replies with a reason, changes Linear state, prepares the STAND | Its own repository, Linear |
| Symphony | Another operator | `symphony-pilot` FLIGHTs | DISPATCH leaves them alone |

## 4. Proposal types

| Type | Meaning | Example |
|---|---|---|
| `ASSIGN` | Assign a FLIGHT to an AIRCRAFT | VOC193 → BRAVO (VCDO) |
| `HOLD_DEPARTURE` | Don't depart it yet | VOC192 waits until VOC191 (blocks) is ARRIVED |
| `RELEASE` | Clean up an ENROUTE FLIGHT with no STAND and no activity | VOC34: no STAND for 7 days → SUPERVISOR confirms whether to move it back to Todo |
| `REPOSITION` | Move an AIRCRAFT to another AIRPORT (rare before stage 3) | DSGN FLIGHTs are piling up but no AIRCRAFT is based at DSGN |

The first implementation covers only `ASSIGN` and `RELEASE`. `RELEASE` does a lot to clean up neglected items among the 17 In Progress, at low risk (Linear changes are made by the SUPERVISOR or CAPTAIN).

## 5. Rules

### 5.1 Candidates

- **AIRCRAFT**: among live TEAM sessions (named `TEAM_X`)
  - PARKED (idle, no STAND) → can be assigned
  - HOLDING (idle, holds a STAND) → can be assigned if there has been no activity for more than N minutes (default 30); otherwise treated as wrapping up
  - AIRBORNE, NORDO → cannot
  - Cannot if it has a FLIGHT PLAN without READBACK (one at a time)
  - **STAND-free FLIGHTs** (`type:SURVEY`, `type:CHECK`): after the STAND rule, a HOLDING or PARKED AIRCRAFT can take one more, outside it: at most one STAND-free FLIGHT per AIRCRAFT counting in-flight proposals, one proposal per AIRCRAFT per plan, same WAKE slots. Never an AIRBORNE one. A `CHECK` never goes to the AIRCRAFT that built what it reviews. Rules in [fleet.md](fleet.md) 5.1 and 5.2
- **FLIGHT**: in the Todo state, and
  - not a **parent issue** (a container for child issues — see 5.1.1)
  - not labelled `symphony-pilot`
  - not assigned or delegated in Linear to someone other than the API key's owner (a person, or an agent such as Codex)
  - not blocked by a FLIGHT that hasn't ARRIVED (if blocked: `HOLD_DEPARTURE`)
  - has no STAND yet and nobody holds it
  - its project maps to an AIRPORT that is operating (OPEN)
  - it has a priority (No priority means nobody has decided when to do it yet, so it is excluded)
  - it has not already ARRIVED in the LOGBOOK (a merged PR, even while Linear still says Todo) and has no open PR (Draft included)

#### 5.1.2 Exclusion reasons

Every FLIGHT left out of `ASSIGN` is listed under "excluded" with one of these reasons. The same text is used when an open proposal is closed (SUPERSEDED), so the DISPATCH tab shows why. They are checked in this order:

| Rule | Reason shown | Since |
|---|---|---|
| Parent issue (5.1.1) | `상위 이슈 — 하위 N건을 묶음` | |
| Another operator's label | `라벨 symphony-pilot (다른 운항사)` | |
| **Taken outside atc**: the Linear delegate, or else the assignee, is not the API key's owner (the `viewer`). This is read-only; atc never changes the assignee | `Linear 담당 <name> — atc 밖에서 맡음` | 2026-09-28 |
| Project not mapped / AIRPORT closed | `배정 제외 프로젝트: <project>`, `프로젝트 없음`, `<CODE> AIRPORT가 운항 중이 아님` | |
| **Already done**: the FLIGHT's PR is in the LOGBOOK as ARRIVED and not reverted ([fleet.md](fleet.md) 7.1) | `이미 완료됨 — PR <repo>#N 머지됨(LOGBOOK)` | 2026-09-27 |
| **Being worked**: an open PR (Draft included) whose ticket key is the FLIGHT | `열린 PR #N 있음` | 2026-09-27 |
| **FLIGHT hold**: an ASSIGN for it was rejected in the last 24 hours with a FLIGHT chip, and the issue has not changed since (6.1) | `FLIGHT 보류 — <chip> (D-xxxx 판정) — 이슈가 바뀌거나 MM-DD HH:MM부터 다시` | 2026-09-27 |
| A worktree (STAND) already exists | `이미 STAND가 있음` | |
| **Stopped AIRCRAFT** (ATC-90): health `RESUME` or `STALLED`, or it still holds an In Progress FLIGHT with no merged PR (by `tail:` label or claimed STAND) that is not a STAND-free FLIGHT. The held FLIGHTs use the AIRCRAFT's slots by WAKE, so a team with room left (e.g. `wake:L` held, `perTeam` 1) can still get a FLIGHT that fits | `TEAM_G — VOC-72 아직 진행 중(PR 없음)`, `TEAM_H — RESUME 필요(한도 풀림 22:10Z)`. The key is the REGISTRATION. An open proposal is SUPERSEDED with `AIRCRAFT 멈춤 — …`, which is not a SUPERVISOR verdict, so the 24-hour pair rule does not start | 2026-09-29 |
| An open proposal or a HOLD already covers it | `진행 중인 제안 D-xxxx`, `HOLD D-xxxx — …` | |
| Every qualifying AIRCRAFT for it was proposed with it in the last 24 hours and that proposal is closed (6.1) | `24시간 안에 제안된 짝(D-xxxx) — MM-DD HH:MM부터 다시` | 2026-09-27 |
| No priority | `우선순위 없음 — 사람이 정할 때까지 배정하지 않음` | |
| `wake:J` | `wake:J — 너무 커서 배정하지 않음, 나눠야 함(SPLIT)` | |
| TAIL ASSIGNMENT, TYPE RATING, crew ([fleet.md](fleet.md) 5) | `tail:TEAM_X — …`, `rating:SEC — …`, `type:BUILD — …` | |
| **CHECK independence**: only the AIRCRAFT that built what the `CHECK` reviews could fly it ([fleet.md](fleet.md) 5.2) | `CHECK 독립성 — 검토 대상을 만든 TEAM_X 말고 이 CHECK를 날 AIRCRAFT 없음 (…)` | 2026-09-27 |

The two new rules come from the shadow verdicts: "이미 완료됨" (already done) was the most common rejection, because a merged PR does not move the Linear issue to Done by itself. They are checked before open proposals, so an open, approved or held proposal on such a FLIGHT is SUPERSEDED with that reason (the FLIGHT reason comes before any AIRCRAFT reason). A reverted PR puts the FLIGHT back among the candidates.

#### 5.1.1 Parent issues

A FLIGHT whose Linear `children` is non-empty, or that another FLIGHT names as its `parent`, is treated as a **container, not work**. Its children are the work. The silence of a container is not neglect, so it is left out on both sides:

- no `ASSIGN` proposal (it appears under "excluded": `상위 이슈 — 하위 N건을 묶음`)
- no `RELEASE` proposal, however long it sits ENROUTE without a STAND
- no NO CONTACT alert (it is not expected to have a STAND of its own)

Children are planned normally. The parent link is one level: a grandchild is judged by its own direct parent.

The relation is read from Linear (`parent` / `children(first: 50)`), not guessed from the body. Failing that, a prerequisite written only in the body has no `blocks` relation for the planner to see, so it is handled by hand (5.4).

### 5.2 Slots (capacity)

| Limit | Default | Why |
|---|---|---|
| Concurrent FLIGHTs per TEAM | 1, plus one STAND-free FLIGHT (`SURVEY`, `CHECK`) | vocado rule: one team job = one Linear issue. A SURVEY or CHECK needs no worktree ([fleet.md](fleet.md) 5.1) |
| Concurrent AIRBORNE per AIRPORT | VCDO 4, others 2 | Dev server ports (3001+), CI, LANDING SEQUENCE congestion |
| Pending proposals overall | 5 | SUPERVISOR review load |

When slots are full, nothing is proposed instead of an `ASSIGN` (extended to ground delay in stage 3).

### 5.3 Score (higher goes first)

| Factor | Calculation | Default weight |
|---|---|---|
| Priority | Urgent 4 · High 3 · Medium 2 · Low 1 (none is excluded from candidates) | ×3 |
| Wait time | Days spent in Todo (max 14) | ×0.5 |
| FLIGHTs it unblocks | Number of Todo items this FLIGHT blocks | ×2 |
| Team fit | How many times this AIRCRAFT flew FLIGHTs in the same project or related ones (FLIGHT RECORDER, claim history) | ×1 |
| Conflict risk | Number of currently AIRBORNE FLIGHTs linked by related. A FLIGHT is AIRBORNE only while its Linear state is not completed or canceled and the LOGBOOK has no ARRIVED for it (ATC-139); the same test decides which held FLIGHTs count toward an AIRCRAFT's slots, the AIRPORT AIRBORNE load and the file-overlap holders | ×−2 |
| File overlap | Files the FLIGHT is predicted to edit that a FLIGHT in flight at the same AIRPORT already changes, WAKE-scaled (5.3.1). `weights.overlap` | ×−1 |
| Continue the same team | Only the asked AIRCRAFT's own team touches those files (5.3.1). `weights.sameTeam` | ×1 |
| ROUTE | The FLIGHT's project is on the AIRCRAFT's routes ([fleet.md](fleet.md) 5) | ×1 |
| Active WAYPOINT | The FLIGHT is an issue of its ROUTE's active WAYPOINT (the first unpassed Linear milestone, [routes.md](routes.md) step 8); the detail names the ROUTE and WAYPOINT. `weights.waypoint` in `dispatch.json` | ×1 |

Each proposal shows the per-factor scores as they are ("why this flight for this team"). The SUPERVISOR changes the weights in a settings file.

Two marks add no points and only explain the pair: `STAND 없이` (a SURVEY or CHECK given outside the STAND rule, with the AIRCRAFT's state, e.g. `VOC-10 아직 진행 중(PR 없음) — 남은 슬롯 0.5`), and `CHECK 독립성` on every CHECK (the builder that was left out, or `확인 못 함 — …` when atc could not tell who built it). There is no bonus for idle AIRCRAFT.

#### 5.3.1 File overlap (ATC-71)

DISPATCH avoids starting two FLIGHTs that edit the same files at one AIRPORT.

- **Files in flight** (read-only, per AIRPORT). For each FLIGHT whose STAND has an active claim (AIRBORNE or HOLDING): the paths of `git diff --name-only` from the merge-base with the default branch to HEAD (cached per head and merge-base), plus uncommitted and untracked paths (`git status`, read on every DISPATCH cycle). For each open PR: its file list from `gh`, cached per head SHA (one call per new head). Git never writes: no fetch, no checkout, `GIT_OPTIONAL_LOCKS=0`. Both are read on the DISPATCH cycle only, never per snapshot; the first cycle after a start plans without them.
- **Predicted files** (pure, no model call). Backticked repository paths and globs in the FLIGHT's body and in its linked FLIGHTs' bodies (related, blocks, blockedBy): `server/fuel-*.ts`, `docs/dispatch.md`, `web/src/{a,b}.tsx`, a directory such as `server/sources`. Fenced code blocks are skipped (they hold commands and examples), so are URLs, commands and words like `and/or`. Every predicted path shows where it came from (`본문` or `ATC-70 본문`). A FLIGHT whose body names no path is not predicted to overlap with anything. Bodies are read from Linear at most 8 per cycle and cached 30 minutes or until the issue changes.
- **Score.** Overlap is predicted ∩ in-flight, per holding FLIGHT. The factor value is `min(files, 3) × WAKE(this) × WAKE(holder)` (L 0.5 · M 1 · H 2), so a heavier FLIGHT on either side weighs more. The detail names the files, the holding FLIGHT and its team, and where each came from (`본문 → STAND` or `본문 → PR #12`).
- **Same team.** Overlap with a FLIGHT the asked AIRCRAFT's own team is flying is not a conflict. When that team is the only one touching the overlapping files, the pair gets `이어서 하면 충돌 없음` (×1). The pair only exists when that team is otherwise assignable.
- **HOLD switch** (`dispatch.json` `overlap.hold`, default `false`; `overlap.holdFiles`, default 2). An overlap of at least `holdFiles` files where the WAKE product is at least 1 (not L against L) is heavy. With the switch on, the FLIGHT is held as HOLD_DEPARTURE with `파일 겹침 — <FLIGHT>가 머지될 때까지`; it comes back when the holding FLIGHT's STAND and PR are gone. A same-team-only overlap on a qualified team is not held. With the switch off the plan lists what it would hold (`overlapHolds`, shown as `shadow —` on the DISPATCH tab) and the factor detail says so.
- **Same-team exemption as built (ATC-136).** The exemption holds only if the FLIGHT actually goes to that team. When the sole team touching the overlapping files can take the FLIGHT now (qualified, independent for a CHECK, free, with room), the FLIGHT's candidates are limited to that team's AIRCRAFT, as a `tail:` label would limit them, and the factor detail says `겹침은 TEAM_X뿐 — TEAM_X에만 제안`. If that team can't (busy, held, no session, wrong rating), the FLIGHT gets the overlap HOLD like any other, or with the switch off the shadow `overlapHolds` entry, and the why names the team: `파일 겹침 — <FLIGHT>가 머지될 때까지 (겹침은 TEAM_X뿐인데 TEAM_X가 지금 못 받음: <reason>)`. Two or more overlapping teams are held as before. The switch default, the heavy-overlap thresholds and the scoring weights are unchanged.
- **Metric.** ATFM records a `dirty` operation when an open PR turns `DIRTY` (like `behind`), with the other open PRs that shared files with it at that moment. The ATFM data line `DIRTY(겹침 예측 가능)` is `seen/dirty` over 7 days: PRs that went `DIRTY` while a PR sharing files was open, out of all that went `DIRTY`.

### 5.4 DISPATCH session review

For each top candidate the server picks, the DISPATCH session reads the ticket body and comments and:

- Adds a `CAUTION` mark with a reason for DB, migration, security or rights work (what vocado routes to `Codex Engineering Task`).
- Adds a HOLD with no prerequisite FLIGHT (a bare `--hold`) when the ticket needs a human decision first (e.g. "after user confirmation"). The note carries the reason; if the FLIGHT is edited after the HOLD, atc releases it for another review.
- Adds a `HOLD` with `dispatch note <ID> --hold <FLIGHT> -- <note>` when the prerequisite is written only in the body, with no `blocks` relation. The named FLIGHT is the **blocking (prerequisite)** one, and the proposal moves to the HELD list instead of the ASSIGN list. Its own FLIGHT stays reserved so the planner will not offer it again (its AIRCRAFT is left free for other FLIGHTs), it cannot be sent, and its FLIGHT PLAN carries a `HOLD — 선행 FLIGHT …` line. When every named FLIGHT reaches a done state, atc supersedes the proposal so the planner can offer it again. A HOLD does not expire after 24 hours; it also closes when the FLIGHT itself is no longer Todo. The SUPERVISOR does not judge a HELD proposal: "대기열로" (requeue) puts it back in the queue and "FLIGHT 보류 확정" (confirm) closes it with a FLIGHT hold (6.2).
- Leaves a one- or two-line rationale on the proposal.
- Writes a **BRIEFING** (ATC-4) on each open or HELD proposal: three plain Korean lines, `dispatch briefing <ID> --what … --why … --risk …`, stored as an append-only `brief` op; writing again replaces it. See "Proposal cards" below.

### 5.5 Proposal cards (BRIEFING, ATC-4)

The SUPERVISOR often doesn't remember what a ticket is about (VOC-195, VOC-172), and should not have to open Linear to judge a proposal. Every open and HELD card reads top to bottom:

1. **BRIEFING**: 무슨 일 (what the work is), 왜 이 AIRCRAFT (why this AIRCRAFT), 걸리는 점 (prerequisites, risk, what a person must decide), written by OCC (`occ/.claude/skills/tick/briefing.md` "BRIEFING"). Until OCC writes one, the card shows the title and the first sentence of the body, marked "BRIEFING 대기". atc reads the body from Linear in the background and caches it for 30 minutes (`server/briefing.ts`, `leadOf`).
2. **Facts line**, computed by the server with no model (`factsOf`): PRIORITY, wait days since the FLIGHT was created, ROUTE and WAYPOINT from the ROUTE MAP (for example "Beta Ready WAYPOINT(지금 구간) · 남은 3건 중 하나"), each prerequisite FLIGHT (Linear `blockedBy` and the DISPATCH HOLD) with its state, the AIRCRAFT's recent FLIGHTs on the same ROUTE (LOGBOOK ARRIVED in 30 days and its in-flight ASSIGNs, at most three), and on HELD cards the CROSSCHECK verdict and reason (open cards show it in the CROSSCHECK chip).
3. Classification, AIRCRAFT and score, HOLD line, CROSSCHECK chip and the verdict buttons, as before.
4. **Collapsed details** ("점수 요소 · 본문 · 메모"): the score factors, the DISPATCH note and the full body, read from Linear when opened.

`GET /api/dispatch/brief` adds `briefs: { <ID>: { facts, lead } }` for open and HELD proposals; `lead` is null once a BRIEFING exists. `POST /api/dispatch/proposals/:id/briefing {what, why, risk}` is accepted only while the proposal is `proposed`; each line is required, whitespace is collapsed and 300 characters is the limit. The OCC guard needed no change: `dispatch briefing` is an atc CLI command like `dispatch note`, and CROSSCHECK's allowlist does not include it.

### 5.6 Fast path and blind sample (ATC-6)

After PREFLIGHT and the BRIEFING, most cards that reach the SUPERVISOR only need "yes, this AIRCRAFT". The queue is split so those take one click, while a sample stays blind to keep the gate honest.

- **Agreement group.** Open ASSIGN cards whose CROSSCHECK mark is `agree` (and that are not blind) sit at the top of the ASSIGN list as one line each: the BRIEFING "무슨 일" line (the title while there is no BRIEFING), the FLIGHT, the AIRCRAFT and a **동의** button. The button records the SUPERVISOR's `agree` verdict (shadow) or approval (2b) with `via: "crosscheck"`, the existing one-click flag. Expanding a line (▸, keyboard Enter) shows the full card; rejecting, with chips, is done from there. There is **no "confirm all"**: each verdict is one deliberate click.
- **Disagreement stays expanded.** Cards where CROSSCHECK disagrees (`wrong-aircraft`, `other`; FLIGHT chips already go to HELD) stay full cards with the CROSSCHECK chip and "CROSSCHECK에 동의".
- **CROSSCHECK 대기.** Cards CROSSCHECK has not marked yet keep the ATC-3 "CROSSCHECK 대기" state, sorted after marked cards, and are never in the agreement group.
- **Blind sample.** About 1 in 5 open cards is blind, chosen from the proposal id (FNV-1a hash mod 5, `server/blind.ts`), so a reload never changes it. A blind card shows **BLIND** instead of the CROSSCHECK chip and the one-click button until it is judged, and sits in the expanded list even when CROSSCHECK agrees. The server records `blind: true` on the verdict, approve or reject, and refuses a one-click (`via: "crosscheck"`) verdict on a blind card (409). Blind verdicts are left out of the gate panel's one-click rate (`gate.crosscheck.oneClick`), since one click was never possible on them. HELD cards are never blind (the HOLD itself shows what CROSSCHECK said).
- **Anchoring check.** The gate panel adds "BLIND 합의율": the SUPERVISOR's agreement with DISPATCH on blind cards, among the verdicts the gate counts (`gate.blind` from `gateOf`, which only adds the figure and does not change what the gate includes). If it is much lower than the overall agreement, the one-click path is being followed by default.

## 6. Flow

### 2a — Shadow operation

```
atc server: candidates and scores every 5 minutes → records PROPOSED proposals
DISPATCH session (/tick): reviews new proposals → adds notes and CAUTION
SUPERVISOR: marks "I would approve / reject (reason)" in the DISPATCH tab
→ Nothing is sent to anyone. Only the agreement rate is measured.
```

### 2b — Approval operation

```
SUPERVISOR approves → atc: APPROVED
DISPATCH session: SendMessage the FLIGHT PLAN to the CAPTAIN
  [DISPATCH D-0003] FLIGHT PLAN · BRAVO (TEAM_B)
  BRIEF: DIRECT
  FLIGHT VOC193 · AIRPORT VCDO · PRIORITY High
  <ticket title and URL, Goal · Done when · Constraints from the issue, DISPATCH note>
  <PILOT'S DISCRETION line>
  — If you take it, reply "READBACK D-0003"; if you can't, "UNABLE D-0003 — reason"; if you need time, "STANDBY D-0003" (ATC-122).
  Carry it through to the end; stop and ask only for what needs a SUPERVISOR decision. (see "DIRECT briefs")
CAPTAIN: READBACK → Linear In Progress, prepares the STAND (same rules as today)
atc: DEPARTED once that FLIGHT gets a STAND; if not, rechecks after 30 minutes like TOWER does
     STAND-free FLIGHT (SURVEY, CHECK): DEPARTED at the READBACK itself (no STAND to wait for)
CAPTAIN (STAND-free only): reports it done → OCC: atcctl dispatch arrived D-0003 -- '<result link or one line>' → atc: ARRIVED
```

Proposal states: `PROPOSED → (SHADOW_AGREE | SHADOW_DISAGREE)` (2a), `PROPOSED → APPROVED → SENT → ACCEPTED → DEPARTED` (2b), `… → ACCEPTED → DEPARTED → ARRIVED` for a STAND-free FLIGHT, with side branches `REJECTED`, `DECLINED` (CAPTAIN gave a reason), `SUPERSEDED` (a person assigned it directly or the situation changed) and `EXPIRED` (24 hours). A proposal that stays `PROPOSED`, `SHADOW_AGREE` or `SHADOW_DISAGREE` for more than 24 hours without a SUPERVISOR decision expires with the reason "24시간 판정 없음", ASSIGN or RELEASE alike (ATC-152; a held proposal never expires, and an `APPROVED` one has its own delivery rule). A `PROPOSED` ASSIGN that carries a `HOLD` leaves the main flow: it waits on the HELD list until released (no 24-hour expiry), and the SUPERVISOR does not judge it (6.2).

**STAND-free FLIGHTs** (built 2026-09-27, rules in [fleet.md](fleet.md) 5.1.1). A STAND-needing FLIGHT's end is the merged PR in the LOGBOOK, so atc tracks it no further. A SURVEY or CHECK has neither a STAND nor usually a PR, so:

- **DEPARTED at READBACK.** `POST …/accept` records `accept` and `depart` at the same time, with `stand: null` and `via: "readback"`; the proposal gets `departedStand: null` and `departedVia: "readback"` (a STAND departure has `departedVia: "stand"`). The FLIGHT's labels are read at that moment; an unknown FLIGHT is treated as needing a STAND, and a STAND-free `accepted` left over departs on the next sync.
- **ARRIVED on the CAPTAIN's report.** OCC records it with `atcctl dispatch arrived D-xxxx -- '<result link or one line>'` (`POST …/arrived {note}`, 500 characters). The proposal gets `status: "arrived"`, `arrivedNote` and `arrivedUrl` (the first link in the note). Only a STAND-free `departed` proposal can arrive.
- **Held until ARRIVED.** It stays in `inFlight`, keeps its AIRCRAFT and FLIGHT, never expires and is never superseded. After 24 hours without a report it shows in `overdue`. It can be RECALLED like a `sent` or `accepted` one.
- **gate3.** STAND-free READBACKs count toward the READBACK rate but not the DEPARTED rate, since they depart by definition and would inflate it. `gate3.standFree` shows their READBACK and ARRIVED counts.

#### 6.1 Recent pairs and keeping proposals open

Fixed on 2026-09-27. Of 19 proposals, 10 were SUPERSEDED before anyone judged them, 7 of those as "더 나은 배정으로 바뀜" (better assignment). D-0017 (VOC-196 → TEAM_E, `tail:TEAM_E`) was closed because the planner gave TEAM_E the slightly higher VOC-177 (10.8 against 10.3). But VOC-177 → TEAM_E had been rejected as D-0010, and the 24-hour rule in `syncOps` would not propose it again. Neither FLIGHT got a proposal, so none was open.

- **One rule for both places.** A FLIGHT–AIRCRAFT pair proposed in the last 24 hours and since closed (disagreed, rejected, superseded, expired, declined, recalled; a RECALL counts 24 hours from its READBACK) is not proposed again. `recentPairsOf` in `proposals.ts` computes it once. The planner gets it as `Reserved.recentPairs` and leaves those pairs out of the candidates, so the AIRCRAFT gets its next-best FLIGHT. `syncOps` uses the same window for `seen`. Open (`PROPOSED`) pairs are not blocked, so they stay in the plan.
- **Visible.** The plan lists the skipped pairs in `blockedPairs` (FLIGHT, AIRCRAFT, proposal, until). A FLIGHT whose every qualifying AIRCRAFT is blocked appears under "excluded" as `24시간 안에 제안된 짝(D-xxxx) — MM-DD HH:MM부터 다시` (local time).
- **FLIGHT hold.** The pair rule assumes the AIRCRAFT was the problem. When the problem is the FLIGHT, it only moves the FLIGHT to the next team: after D-0022 (VOC-177 → TEAM_D, "wait for the user's instruction") and D-0023 (VOC-125 → TEAM_A, "needs recruiting and observing users") were rejected, D-0024 (VOC-125 → TEAM_D) and D-0025 (VOC-177 → TEAM_B) followed at once. So the reason chips decide the scope. If a rejected (or shadow-disagreed) ASSIGN carries any of `already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`, `no-priority` or `out-of-repo`, `recentFlightsOf` holds the **whole FLIGHT** from every AIRCRAFT (`Reserved.recentFlights`). It shows under "excluded" as `FLIGHT 보류 — <chip> (D-xxxx 판정) — 이슈가 바뀌거나 MM-DD HH:MM부터 다시`, and open proposals for that FLIGHT on other AIRCRAFT are SUPERSEDED with the same reason. The hold ends 24 hours after the verdict, or earlier when the Linear issue's `updatedAt` moves past the verdict (someone edited the body, answered, changed the priority). `wrong-aircraft`, `other` and verdicts without chips (older ones included) keep only the pair rule.
- **Churn does not block.** A proposal closed as "더 나은 배정으로 바뀜" was never judged, so its pair is exempt from the 24-hour rule and can be proposed again at once. This is what brings D-0017's pair back.
- **Keeping a PROPOSED ASSIGN.** When a PROPOSED ASSIGN drops out of the plan and the only reason is "더 나은 배정" (no state change), it stays open. It is superseded only when the same sync actually creates a proposal for the same FLIGHT or the same AIRCRAFT that scores at least 20% higher (`REPLACE_MARGIN`; the absolute difference against the absolute score). The reason then names the new proposal and both scores: `더 나은 배정으로 바뀜 — D-0021 (10.3 → 13)`. Below the margin no new proposal is made and the old one waits for its verdict.
- **Why 20%.** Scores move slowly (0.5 a day of waiting), while one priority step is worth 3 points (about 30% of a typical 10-point score). 20% lets a clearly better FLIGHT, such as a newly urgent one, take over. Small drifts do not cost the SUPERVISOR a verdict. The number is a first proposal.
- **State changes close right away, as before:** the FLIGHT is no longer Todo, is done or has an open PR, the AIRCRAFT can no longer take it, or an exclusion rule applies.

Rejections carry **reason chips** in the SUPERVISOR's UI: one or more chips from the server's list (`server/reasons.ts`, `reasonCodes` in the brief) plus an optional memo, stored as `"<chip> · <chip> — <memo>"` in `reason` and as codes in `reasonCodes`; the gate counts them per chip (`reasonCounts`). The chip that matters most is the parent issue (5.1.1), which the planner should also catch by itself.

The brief's `reasonStats` turns the chips into a to-do list for the planner: per chip, the count, up to 3 recent example FLIGHTs, and whether the planner already filters that reason itself (`auto`, `partial` or `manual`, with how). Today: already done → the LOGBOOK and open-PR rules and the Linear Done state (auto); parent issue → 5.1.1 (auto); no priority → the no-priority rule (auto); waiting on a prior FLIGHT or PR → Linear `blockedBy` becomes a HOLD, other PRs only through OCC's HOLD (partial); outside the repository → project mapping only (partial); wrong AIRCRAFT → TYPE RATING, crew and `tail:` rules (partial); needs a human → the "user decides" wording becomes an OCC HOLD (partial); other → manual. Each chip also carries its scope (`scope`: `flight` or `pair`, see FLIGHT hold above). The DISPATCH gate panel shows it as "거절 사유 → 배정 규칙".

#### SETTLED as built (ATC-117)

A cost review of 65 ASSIGNs created after the 2026-09-27 churn fix found 36 SUPERSEDED, 29 of them after an OCC note and 28 after a BRIEFING (a full OCC turn each; the median from note to supersede was 4.5 minutes). The SUPERVISOR approves fast (median 3.9 minutes from create to approve), so a plain delay before noting would hold back the proposals that matter. The rule looks at what is worth a turn instead.

- **SETTLED.** A proposal is SETTLED when it is `approved`, or has stayed open (`proposed` or on HOLD) for at least `settleMin` minutes since it was created. `settleMin` is in `dispatch.json` (default 10; `0` means everything is SETTLED at once, as before; a negative or non-number falls back to 10). It is computed when read (`settledOf` in `server/proposals.ts`); `proposals.jsonl` has no new op.
- **What it gates.** Only when control sessions spend a turn. OCC adds a note and BRIEFING only to `settled: true` items; CROSSCHECK marks only SETTLED proposals. Sending an approved proposal, a RECALL and a CREW CHANGE never wait. The planner, scores, `REPLACE_MARGIN`, the pair rule and the FLIGHT hold are untouched.
- **Fast approvals (a trade-off).** The SUPERVISOR's median approval (3.9 minutes) comes before `settleMin` (10). A proposal approved before it has been noted goes out as a FLIGHT PLAN without a BRIEFING or a CROSSCHECK mark, and without OCC's `--hold` review of the body: an approved proposal can no longer take a HOLD, a BRIEFING or a mark, and it isn't in `open` or `held`, so nothing in OCC step 3 reads it. Before ATC-117 only approvals faster than one OCC tick skipped these. To keep the team-facing part, OCC adds a note (`dispatch note`, `--caution` if the body shows a prerequisite or "user decides" wording) to an approved ASSIGN in `inFlight` that has none, right before `dispatch release`; it never delays the send. Setting `settleMin` to `0` restores the old review window.
- **Brief.** `dispatch brief` marks each `open` and `held` item `settled: true|false` and `settlesInMin` (minutes left, rounded up, 0 when settled), and adds `unsettled: n`. `crosscheckBriefOf` returns only SETTLED items in `pending` and the count of the rest in `unsettledMarks` (markable items only: open, not on HOLD, no mark yet; the brief's own `unsettled` counts every open or HELD item that isn't SETTLED yet, noted or not). `atcctl crosscheck brief` passes `unsettledMarks` through. A brief from an old server without `settled` is read as all settled.
- **SQUELCH.** The OCC fingerprint's `needsNote` counts only settled IDs, and the CROSSCHECK fingerprint reads `pending`, which is SETTLED-only, so an unsettled proposal doesn't open a tick. A proposal turning SETTLED adds its ID by itself, so the fingerprint changes without any timer.
- **Card.** An unsettled proposal shows `메모 대기 (n분 뒤)` where the note would be (and in the collapsed row's `BRIEFING 대기` slot). The SUPERVISOR can still approve at once.
- **Replay** (`server/proposals.test.ts`): a fixture shaped like the log gives 1, 17, 22 and 24 of the 29 noted-then-SUPERSEDED proposals avoided at W = 5, 10, 15 and 20 minutes, and no approved proposal is delayed. W = 0 avoids none.
- **Not covered.** Why AIRCRAFT go AIRBORNE minutes after a proposal (13 of the 36) is a separate question; see [ATC-90](https://linear.app/vocado/issue/ATC-90) (availability) and [ATC-95](https://linear.app/vocado/issue/ATC-95).

#### 6.2 PREFLIGHT: hold FLIGHTs that are not ready

Built on 2026-09-27 (ATC-3). Of the first 9 DISPATCH verdicts, 6 were rejections, and all 6 were about the ticket not being ready: a parent issue (VOC-34), already done, a person's decision or hands needed (VOC-177, VOC-125 …), no priority or owner. None was about the AIRCRAFT. The gate (9/20 at 33%) was mostly measuring ticket readiness, and the SUPERVISOR had to read every ticket to catch what CROSSCHECK had already flagged with the same reasons.

- **What goes to HELD before the SUPERVISOR sees it.** A proposal leaves the queue and goes to HELD when (a) CROSSCHECK marks it `disagree` with a FLIGHT chip (`already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`, `no-priority`, `out-of-repo`; the same set as the FLIGHT hold in 6.1), or (b) OCC holds it (5.4). For (a) the server appends a `preflight` op (`{op:"preflight", id, at, by, model, codes, reason}`) right after the `crosscheck` op. CROSSCHECK gets no new permission: the HOLD is the server's consequence of the existing mark. Each server tick also sweeps open proposals for such marks, so marks recorded before this change apply too.
- **What stays in the queue.** `wrong-aircraft`, `other`, a mark without chips and an `agree` stay in the queue. Team choice is what the gate should measure.
- **The HELD card** shows who flagged it (`PREFLIGHT`, CROSSCHECK and the model family, with the chips, or `HOLD` for OCC with its note), the CROSSCHECK mark if any, and two one-click actions. There is no verdict button: `verdict`, `approve` and `reject` on a HELD proposal return 409.
  - **대기열로 (requeue)**: `{op:"requeue"}` clears the HOLD and puts the same proposal back in the SUPERVISOR queue. Its 24 hours (expiry and the pair rule) count from the requeue. It is not held again: the sweep skips it, and OCC's `hold` returns 409.
  - **FLIGHT 보류 확정 (confirm-hold)**: closes the proposal as disagreed (shadow) or rejected (approval) with `via: "preflight"` and the chips, which puts the FLIGHT hold of 6.1 on it (every AIRCRAFT, 24 hours or until the issue changes). The chips come from the PREFLIGHT, else from a FLIGHT-chip mark left before the HOLD, else `needs-human` for OCC's no-prerequisite HOLD (which by definition waits on a person). Nothing is guessed from the reason text. A HOLD on a prerequisite FLIGHT cannot be confirmed; atc releases it when the prerequisite is done.
- **The HOLD still ends by itself** as before: the FLIGHT is no longer Todo, is done or has an open PR, or (no prerequisite) the issue changed after the HOLD.
- **CROSSCHECK wait.** An open proposal without a mark shows `CROSSCHECK 대기` and sorts after the marked ones, so the SUPERVISOR does not judge before the filter has run.
- **Gate.** Held proposals are outside the gate (Decisions). A confirmed HOLD (`via: "preflight"`) is not a human verdict: it is left out of the decided count, the agreement, the CROSSCHECK match rate and `reasonCounts`, but `reasonStats` counts its chips as work for the planner. `gate.preflight` carries `held` (ASSIGNs ever held by OCC or PREFLIGHT, including ones later requeued or confirmed), `holding` (held now), `passed` (reached a SUPERVISOR verdict without a HOLD and was not a readiness rejection), `notReady` (reached a verdict without a HOLD but was rejected for readiness, 6.3) and `readyRate = passed / (passed + held + notReady)`, a supply-quality figure with no threshold. The gate panel shows it as `PREFLIGHT HELD n건 · 준비율`.

#### 6.3 The gate measures the AIRCRAFT choice only

Built on 2026-09-27 (ATC-5). PREFLIGHT now catches readiness problems before the SUPERVISOR judges, but the six rejections from before it (D-0001, D-0003, D-0006, D-0010, D-0022, D-0023, all about the ticket) still held the gate at 3/9 (33%). With them, reaching 80% would take about 30 more verdicts without a miss.

- **Readiness rejections leave the gate.** `gateOf` leaves out a `disagreed` proposal whose reason chips are all FLIGHT chips (`FLIGHT_HOLD_CODES`: `already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`, `no-priority`, `out-of-repo`) and counts it in `gate.notReady`. `agreed`, and rejections with `wrong-aircraft`, `other`, a mix including those, or no chip, count as before. The panel shows "준비 안 됨 거절 n건" (게이트 제외) next to PREFLIGHT HELD, and the decided row reads "판정한 제안(HELD·준비 안 됨 제외)".
- **Chips on an old verdict.** `POST /api/dispatch/proposals/:id/codes {codes}` (at least one chip from `server/reasons.ts`) appends `{op:"recode", id, at, by:"SUPERVISOR", codes}`. It is accepted only on a `disagreed` proposal decided by a person (409 otherwise, also for ATFM and PREFLIGHT closes); a later recode replaces the earlier one. The fold keeps it as `gateCodes`, apart from `reasonCodes`, and only the gate reads it (`gateCodesOf`: `gateCodes`, else `reasonCodes`). So a recode never starts the FLIGHT hold of 6.1 after the fact, and the reason text, `reasonCounts`, `reasonStats`, the CROSSCHECK match and the one-click figures stay as they were. There is no atcctl command: structure calls the API once after deploy, on the SUPERVISOR's instruction, for the six rejections above (ATC-5 lists their chips). After that the gate starts again at 3/3.

#### 6.4 The AIRCRAFT survives `/clear` (ATC-91)

D-0068 (ATC-82 → TEAM_I) was created at 01:40:31Z on 2026-09-29 with `aircraft: 04a9a868…`, the session id. The SUPERVISOR ran `/clear` in TEAM_I (last transcript write 01:41:20Z) and approved at 01:41:23Z. The new session got a new id and no session file until its first prompt, so at 01:45:33Z the proposal was SUPERSEDED with `AIRCRAFT 불가: 세션 없음`. A `/clear` also forgot a `wrong-aircraft` rejection (the pair rule keyed the session id) and could lose the AIRCRAFT of an in-flight FLIGHT PLAN. REFRESH ([fleet.md](fleet.md) 8.6) and FRESH START both ask the SUPERVISOR to `/clear`, so this recurs.

- **The key is the REGISTRATION.** A new ASSIGN stores `registration` (`registrationOf`, ATC-67: `Team I` and `TEAM_I` are one AIRCRAFT) next to the session id and name it already had. The pair rule (`recentPairsOf`, the planner's `blockedPairs`), the AIRCRAFT reservation (`reservedOf`, one in-flight proposal per AIRCRAFT and the FLIGHTs it holds), `stillValid` and the `why` of a SUPERSEDED, and the READBACK bookkeeping all use it. `aircraft` (the session id when the proposal was made) and `aircraftName` stay as they were: FUEL attribution reads the id, and send-guard still compares the recipient with `aircraftName` and the stored text, unchanged. The message goes to that name, so it reaches whichever live session carries it; atc looks the live session up when a message goes out, not when the proposal is made.
- **Old lines** have no `registration`. They read as before: the registration comes from `aircraftName` (the name at that time), and a line with no name at all keeps its session id. A new field in `proposals.jsonl` is ignored by readers that do not know it, so nothing in the record format changed for them.
- **`RESTARTING`** ([fleet.md](fleet.md) 8.5, "RESTARTING as built"). Between a `/clear` and the next prompt the AIRCRAFT has no session. For `restartGraceMin` (default 30 in `dispatch.json`, a positive number) it is `RESTARTING`, not absent. The planner lists it in `plan.aircraft` with `restarting: true`, `available: false` and `reason: "RESTARTING — 세션 없음 — /clear 뒤 첫 메시지 대기 (02:11Z까지)"`, so it gets no new FLIGHT.
- **Proposals wait instead of closing.** A `proposed` or `approved` ASSIGN whose AIRCRAFT is `RESTARTING` is not SUPERSEDED for "AIRCRAFT 불가" (every other reason still closes it at once). A proposal that is `sent` was never auto-closed. When the new session appears with the same name, the same proposal is valid and goes out. When the grace passes with no session, `RESTARTING` disappears and the proposal closes as before with `AIRCRAFT 불가: 세션 없음`. `POST …/release` (send) returns 409 while the AIRCRAFT has no live session and is `RESTARTING`, so OCC does not send into nothing: the approval stays.
- **The cards say so.** The brief has `waiting: {D-0068: "세션 없음 — /clear 뒤 첫 메시지 대기"}` for those proposals; DISPATCH shows it on the card and on the in-flight row.
- **Not covered.** The AFFINITY factor reads earlier FLIGHTs by session id, so a `/clear` still resets it (a separate, smaller signal).

### LAUNCH on approve and RESUME as built (ATC-129)

A background AIRCRAFT is retired by Claude Code about 60 minutes after its last turn ([fleet.md](fleet.md), "Idle exit and LAUNCH from DISPATCH as built (ATC-129)", has the evidence). Until ATC-129 the planner then saw no session and gave the AIRCRAFT nothing; a FLIGHT cut by the usage limit waited for the SUPERVISOR to open the session again and type "continue". Now both go through the SUPERVISOR's one click on a card.

**Candidates** (`planDispatch`, the `snapshot.absent` list from [fleet.md](fleet.md)). An AIRCRAFT with no live session, launched by atc before (a FLIGHT RECORDER LAUNCH in the last 14 days), in the registry and not RETIRED or `RESTARTING` is added to `plan.aircraft` with `id: "absent:<REG>"`, `launch: true`, and its base AIRPORT from the registry. It takes FLIGHTs like a PARKED AIRCRAFT (`reason: "ABSENT — 세션 없음, 승인하면 LAUNCH"`) unless it is held:

- AOG;
- `LIMIT`: its last turn was cut and the reset has not passed (`HOLD · LIMIT (cut 04:30Z) until 07:40Z`), or the reset is unknown; an ACCOUNT HOLD from a live sibling; a FUEL HOLD;
- a RESUME card is due for it (`RESUME — ATC-200을 이어서(RESUME 카드)`, `stopped`);
- an unfinished `tail:`-labelled In Progress FLIGHT (ATC-90, `stopped`);
- no base AIRPORT.

An ASSIGN to it carries `launch: true` in the plan and in the proposal. A desktop or terminal AIRCRAFT has no LAUNCH line and is never in the list.

**The cap.** `launchCapOf`: live background sessions (not the control sessions) plus `approved` `launch` cards whose AIRCRAFT has no live session yet, against `ATC_MAX_LAUNCHED` (the same cap as 8.5). `GET /api/dispatch/brief` returns `launchCap: {launched, pending, max, full}` and `launch: {"D-xxxx": "LAUNCH on approve"}` for every open, held or approved `launch` card. When the cap is full an open card's text is `LAUNCH 대기 — 백그라운드 5 + 승인된 LAUNCH 1 / 상한 6(ATC_MAX_LAUNCHED) — 자리가 나면 승인한다`, and approving it returns 409 with that text and changes nothing. So the count never passes the cap.

**Approve** (`POST /api/dispatch/proposals/:id/approve`, `approveLaunch`). For a `launch` card:

1. Only from this screen (`fromThisApp`, 403 otherwise), because it starts a session. OCC's `atcctl` has no approve.
2. If a live session with that REGISTRATION exists by now, it is an ordinary approval: nothing is launched.
3. Otherwise the cap is checked (above); then `approve` is written, then `launchAircraft` runs (the FLEET LAUNCH path, with the permission mode and model of the AIRCRAFT's last LAUNCH; FLIGHT RECORDER `by: "SUPERVISOR"`, `proposal: "D-xxxx"`), then its result as a new op `{op: "launch", id, at, ok, by: "SUPERVISOR", jobId?, error?}`. The fold keeps it as `proposal.launched`. The status stays `approved`.
4. **Launch failure**: the result has `ok: false` and the card is SUPERSEDED at once with `LAUNCH 실패 — <error>`, so nothing is sent. The response is 502 with the same text. The reason starts no pair rule (like `BETTER_WHY`), so the same card comes back in the next plan and the SUPERVISOR can approve it again; nothing retries by itself. FLIGHT FOLLOWING shows a `launch` issue (`warn`) for a day.

**Waiting for the new session** (like `RESTARTING`, 6.4). `POST …/release` returns 409 `TEAM_G: LAUNCHING — 새 세션을 기다림 — 새 세션이 뜬 뒤에 보낸다(승인은 그대로다)` until a live session carries the REGISTRATION; the brief's `waiting` has `LAUNCHING — 새 세션을 기다림` for the card. For `restartGraceMin` after the LAUNCH, "AIRCRAFT 불가" does not close the card (the new session is AIRBORNE while it reads its CREW BRIEFING). If the grace passes with no session, the card closes with `LAUNCH 실패 — LAUNCH 뒤 30분 동안 새 세션이 뜨지 않음` (also a FOLLOWING `launch` issue). If the approval was written but no LAUNCH result was (the server stopped in between), the card closes the same way after the grace with `LAUNCH 실패 — 승인 뒤 30분 동안 LAUNCH 기록이 없음 …`; atc never launches it on its own. Once the session is live, OCC releases and sends as usual.

**RESUME cards** (`resumePlansOf`, pure). For an absent background AIRCRAFT whose `cut` has a reset that has passed (and no new turn: a prompt after the cut clears `cut`), DISPATCH picks the FLIGHT it was flying: the FLIGHT whose last DEPARTURE LOG claim or HANDOFF before the cut names that REGISTRATION, else its `tail:`-labelled FLIGHT, In Progress in Linear and not in the LOGBOOK; the most recent one. It becomes `plan.resume` and a proposal with `kind: "ASSIGN"`, `launch: true` and `resume: {cutAt, resetsAt, stand, branch, commit: {sha, at, pushed} | null, report}`: the STAND and branch from the DEPARTURE LOG (the branch from the worktree if it still exists), the worktree's last commit (the WIP), and the last line of the CAPTAIN's last message. Its AIRPORT is the one whose repository the DEPARTURE LOG names (for a `tail:` FLIGHT with no departure, the registry's base AIRPORT); with no known AIRPORT there is no card. Its score is 0 with a `resume` factor, and it counts against neither the AIRPORT slots nor `openProposals`.

- **Once per cut.** `syncOps` makes no second card for the same FLIGHT and cut time (`resumedOf`), whatever happened to the first (rejected, expired, sent). A card closed by a launch failure does not count, so it comes back. A later new cut of the same FLIGHT can make a new card.
- **It stays valid** while the FLIGHT is In Progress and not in the LOGBOOK; AIRCRAFT reasons (AIRBORNE while it reads the briefing) don't close an approved one. An open card whose AIRCRAFT got a live session again (someone opened it) closes with `AIRCRAFT 불가: 세션이 다시 떴음 — RESUME은 그 세션에서 SUPERVISOR가 "계속"(ATC-86)`.
- **The FLIGHT PLAN** (`formatFlightPlan`) keeps its header and DIRECT lines and adds, after the title and link: `RESUME — This FLIGHT was cut by a usage LIMIT at 04:30Z. Resume, don't restart — continue from the remaining work.`, `STAND … · branch … · last commit abc1234 (04:20Z) — not on origin yet` (or `no last commit (worktree not found)`), and `CAPTAIN's last report: …` (the CAPTAIN's line as written). The lines are English like the rest of the FLIGHT PLAN (ATC-126). send-guard compares the stored text as before.
- **Live sessions are unchanged.** A live session in `RESUME` (ATC-86) gets no card: the SUPERVISOR sends "continue" in that session.

**OCC.** The flight-plan procedure (`occ/.claude/skills/tick/flight-plan.md`) has one new row: when `dispatch release` answers 409 with `LAUNCHING` or `RESTARTING`, OCC sends nothing and tries again next tick; with `LAUNCH 실패` it reports to the SUPERVISOR. Nothing else in OCC changes.

**API fields for the screen.** `Proposal.launch?: true`, `Proposal.launched?: {at, ok, by, jobId?, error?}`, `Proposal.resume?: {cutAt, resetsAt, stand, branch, commit, report}`; `AssignPlan.launch?`, `AssignPlan.resume?`, `AircraftState.launch?`, `Plan.resume?`; brief `launch`, `launchCap`, and `waiting` (now also `LAUNCHING`); FOLLOWING issue code `launch`.

**Pilot's discretion (ATC-129).**

- **Background origin** is "atc launched it" (a FLIGHT RECORDER LAUNCH in 14 days, the window the permission-mode lookup already uses). The registry has no origin field, and a job someone started by hand with `claude --bg` is not counted.
- **The grace** after a LAUNCH is `restartGraceMin`, ATC-91's setting, not a new one.
- **A launch failure** closes the card rather than leaving an approved card that can't be sent; it starts no 24-hour pair rule, so the next plan offers it again.
- **RESUME cards only for absent background AIRCRAFT**: a live session in `RESUME` keeps ATC-86; an absent desktop AIRCRAFT can't be launched, so it gets none either.
- **Once per FLIGHT means once per cut**; a card closed by a launch failure doesn't use it up.
- **One RESUME card per AIRCRAFT**, for its most recent FLIGHT. RESUME cards ignore AIRPORT slots and `openProposals`: the FLIGHT is already started.
- **An approval whose AIRCRAFT came back live** is an ordinary approval; the stale `launch` flag launches nothing.
- **FLEET PLAN** runs the same planner, so a FLIGHT a `launch` card can serve is no longer unserved demand there and FLEET PLAN proposes no second LAUNCH for it.

## 7. What to add to atc

| Where | What |
|---|---|
| `server/sources/linear.ts` | Add `relations` (blocks), `labels`, `project`, `createdAt`, `parent` / `children` and the time a state was entered (via `history` if possible) to the query |
| `server/dispatch.ts` | Candidate, slot and score calculation (pure functions + tests); parent issues (5.1.1) are excluded from both ASSIGN and RELEASE |
| `server/proposals.ts` | Proposal log (`~/.local/state/atc/proposals.jsonl`, append-only, same approach as clearances); `hold` operations for prerequisites written only in the body |
| API | `GET /api/dispatch/brief`, `POST /api/dispatch/proposals/:id/{note,hold,agree,disagree,approve,reject,sent,accept,decline}` |
| Events and records | `proposal.created / decided / sent / accepted / departed / superseded` into the FLIGHT RECORDER |
| Settings | `~/.local/state/atc/dispatch.json`: project → AIRPORT mapping, per-team default AIRPORT (`teamAirports`), candidate Linear teams (`candidateTeams`, empty = the main team), slots, weights, mode (`shadow`/`approval`) |
| UI | DISPATCH tab: proposal cards (FLIGHT, AIRCRAFT, per-factor scores, DISPATCH note, CAUTION), approve/reject buttons, slot status, RELEASE list |
| Metrics | Shadow agreement rate, proposal → acceptance time, idle AIRCRAFT time (minutes PARKED while Todo items existed), number of neglected ENROUTE FLIGHTs |
| `atc/occ/` (was `atc/dispatch/`) | Same structure as TOWER: `CLAUDE.md` (role and decision rules), `/tick`, a guard (atc CLI and jq only; Linear through a read-only MCP only) |

## 8. Criteria for moving on

| Transition | Criteria (proposed) |
|---|---|
| 1.5 → 2a | Can start right away (nothing is sent, so it runs alongside 1.5) |
| 2a → 2b | 20+ shadow proposals, 80%+ agreement, 0 proposals that violated blocks. The four stage 1.5 checks are also met |
| 2b → 3 (ATFM) | 2+ weeks, READBACK rate 90%+, DEPARTED rate 80%+ (STAND-needing FLIGHTs only, `GATE3`), almost no LOS on FLIGHTs DISPATCH sent, less idle AIRCRAFT time |

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Flooding teams with work | 1 per TEAM, AIRPORT and overall slots, no new assignment while a READBACK is pending |
| Wrong calls because of stale Linear state (neglected In Progress) | Include `RELEASE` in the first implementation; clean up NO CONTACT FLIGHTs first |
| Competing with Symphony for the same ticket | Exclude the `symphony-pilot` label. If a Symphony clone appears, open it as a separate AIRPORT so it is visible |
| Overlapping with work the user gave directly | When a direct assignment is detected (a STAND or Linear In Progress appears without a proposal), mark related proposals SUPERSEDED |
| Assigning risky work too lightly | Body review and CAUTION by the DISPATCH session; CAUTION proposals stay excluded from auto-approval even in stage 3 |
| DISPATCH touching code or Linear | Guard (atc CLI and jq only), Linear through a read-only MCP only |

## RECALL

A FLIGHT PLAN that was sent (`sent`), read back (`accepted`), or read back as a STAND-free FLIGHT that has not ARRIVED (`departed` with `departedVia: "readback"`) can be pulled back by the SUPERVISOR. This is decision 4 of [atfm.md](atfm.md): it is built before any automatic assignment.

```
SUPERVISOR: "RECALL…" on the in-flight card (or POST /api/dispatch/proposals/:id/recall {reason}) → atc: RECALLING
OCC:        atcctl dispatch recall-send D-0003 → SendMessage the RECALL text to the CAPTAIN
CAPTAIN:    stops work, leaves the STAND as it is, replies "READBACK D-0003 RECALL"
OCC:        atcctl dispatch recalled D-0003 → atc: RECALLED
```

- **States:** `sent`, `accepted` or STAND-free `departed` → `recalling` → `recalled`.
  - A `recalling` proposal still holds its AIRCRAFT and FLIGHT. If a STAND appears, it does not become DEPARTED, because the FLIGHT was told to stop.
  - After 24 hours without the RECALL READBACK it expires, and after 10 minutes it shows in `overdue`.
  - A `departed` FLIGHT with a STAND is not recalled; the SUPERVISOR deals with the CAPTAIN directly. A STAND-free one has no STAND to protect, so it can be; its RECALL text asks for any partial result instead of "leave the STAND".
- **After RECALLED:** the FLIGHT is a candidate again. The same FLIGHT–AIRCRAFT pair is not proposed for 24 hours from the RECALL READBACK. A different AIRCRAFT can get it right away.
- **Who does what:**
  - Only the SUPERVISOR requests a RECALL (DISPATCH tab or API), with a reason of up to 300 characters.
  - OCC never creates one; its atcctl has no command for it. OCC only sends the server's text and records the READBACK.
  - An enforced ATFM ground stop does not block a RECALL, because pulling work back is the safe direction.
- **Text:** the server builds it when the RECALL is requested, like `formatFlightPlan`, and stores it on the proposal (`recallMessage`):

  ```
  [DISPATCH D-0003] RECALL · BRAVO (TEAM_B)
  FLIGHT VOC193 · AIRPORT VCDO — this FLIGHT PLAN is withdrawn.
  <ticket title>
  사유: <SUPERVISOR's reason>
  Stop work. Do not clean up the STAND (worktree); leave it as is — so another AIRCRAFT can pick it up.
  — When received, reply to this message with "READBACK D-0003 RECALL".
  ```

  The reply names the RECALL (`READBACK D-0003 RECALL`) so it can't be confused with the FLIGHT PLAN's `READBACK D-0003`.
- **send-guard:** a message starting `[DISPATCH D-xxxx] RECALL` passes only when all of these hold:
  - the mode is approval;
  - the proposal is `recalling`;
  - the recipient is that proposal's CAPTAIN;
  - the text equals `recallMessage` exactly.

  Any other `[DISPATCH D-xxxx]` message is checked as a FLIGHT PLAN, as before. In shadow mode nothing is sent, so the SUPERVISOR tells the CAPTAIN directly.
- **API:**
  - `POST /api/dispatch/proposals/:id/recall {reason}` (SUPERVISOR);
  - `POST …/recall-send` returns `{sendTo, message}` and changes nothing (OCC, approval mode only);
  - `POST …/recalled` (OCC, after the CAPTAIN's READBACK).

## SUPERVISOR CONFIRM AT AIRCRAFT (ATC-120 as built)

Some FLIGHTs touch user-tier files (`deploy/landing-tier.mjs` USER: guards, `.claude/`, root `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`). The AIRCRAFT then asks the SUPERVISOR for a go inside its own session. The go is typed by the SUPERVISOR there; **neither OCC nor the server ever says "the SUPERVISOR approved"**, and no atc message stands for that go.

- **Prediction (pure, `server/supervisor-confirm.ts`).** For an ASSIGN, `planDispatch` takes the issue's predicted paths (`predictedOf`, ATC-71) and runs `tierOf` on each. Paths that are user tier become `supervisorConfirm` on the ASSIGN and, through the `create` op, on the proposal. An empty or unknown prediction sets nothing (no false alarms). The mark never blocks approval. **Only on the MCC AIRPORT (ATC-159).** The tier rules in `deploy/landing-tier.mjs` are atc's own, so `planDispatch` computes `supervisorConfirm` only for a FLIGHT whose AIRPORT is the MCC AIRPORT (`mcc.json` `airport`, default `ATCC`; a missing or broken file also gives `ATCC`). An ATCA or VCDO FLIGHT that predicts `CLAUDE.md` or `.claude/settings.json` gets no line, whatever the file. The card, the approve dialog and `await-supervisor` read the field only when present, so they needed no change; proposals recorded earlier keep the field they already have.
- **Card and approve dialog.** The DISPATCH card, its IN FLIGHT row (approved, sent) and the approve confirm show `SUPERVISOR CONFIRM AT AIRCRAFT`, the paths that caused it, one line the server builds for the SUPERVISOR to paste into that AIRCRAFT's session (`D-0094 (ATC-115): SUPERVISOR go for CLAUDE.md, .claude/settings.json edits in this FLIGHT.`), and how to open the session (`claude agents`, then the REGISTRATION). `GET /api/dispatch/brief` carries it as `confirm[<D-xxxx>] = {paths, line, open}`.
- **Hold state.** `atcctl dispatch await-supervisor <D-xxxx> -- <reason>` (`POST …/await-supervisor {reason}`) is for a CAPTAIN reply that is neither READBACK nor a refusal (it waits for its user). Append-only op `await-supervisor` in `proposals.jsonl`; sent proposals only (409 otherwise, 400 without a reason). PILOT'S DISCRETION: it is a field, not a new status. The proposal stays `sent` with `awaitSupervisor {at, reason}`, so RELEASE, RECALL and every status check keep working. Calling it again replaces the reason and keeps the first `at`. A READBACK (`accept`), UNABLE (`decline`), RECALL or expiry clears it. While it is set the proposal isn't counted as READBACK overdue.
- **Alerts.** FLIGHT FOLLOWING follows a sent proposal that awaits the SUPERVISOR and shows a warn issue `await-supervisor` (key `<FLIGHT>|await-supervisor`, reported to the SUPERVISOR once). The snapshot raises a `health` alert on the AIRCRAFT session, key `health|AWAIT-SUPERVISOR|<D-xxxx>`, through the same path as ATC-99 (BLOCKED background session) and ATC-87, once per key. PILOT'S DISCRETION: no new health code (`HealthCode` and `hooks/health.d.mts` are unchanged).
- **OCC.** `occ/CLAUDE.md` and `flight-plan.md` say: when a CAPTAIN holds for its user, run `dispatch await-supervisor`; don't retry, and don't relay any approval. Guards, send-guard and the FLIGHT PLAN text are unchanged.

## FLIGHT FOLLOWING: milestones as built (ATC-123)

Airlines log OOOI, the four actual times of a flight. atc gives each FLIGHT the same four, from records it already has. Nothing new detects team work, nothing is written to Linear, and ARRIVED means what it meant; IN sits beside it.

| Milestone | Meaning | Source (first one that exists) |
|---|---|---|
| `out` | OUT: DEPARTED | The first DEPARTURE LOG entry (`departures.jsonl`) for the FLIGHT; else the proposal's `departed` time (STAND-free FLIGHT); else the LOGBOOK line's `departedAt` when its `departedFrom` is not `pr` (an estimate from the PR is never used) |
| `off` | OFF: PR opened | The earliest of: `createdAt` of an open PR linked to the FLIGHT (branch, `Fixes` or `Refs` key); a merged PR's merge time minus its landing wait; the first `landing.requested` event |
| `on` | ON: merged | The LOGBOOK `arrivedAt` of the merged PR (the earliest merge if there are several) |
| `in` | IN: in service | The `at` of the first `rts.jsonl` record with result `ok`, at or after ON, whose `to` contains the merge commit (`git merge-base --is-ancestor`). Only for the AIRPORT whose repository RTS deploys (`mcc.json` `airport`); other AIRPORTs show no IN |

- `milestonesOf(flight, sources)` (`server/milestones.ts`, pure, also used by the browser) returns `{out, off, on, in, reverted}`; a time is `null` when its source is missing, never guessed. The reads of the local repository (the merge commit is found from the `Merge pull request #n` commit on `origin/main`, then `is-ancestor`) live in `server/milestones-run.ts`, are read-only, and are cached. A refused or failed RTS is skipped; the IN is the first success that contains the merge.
- **A revert** does not move ON: the PR stays merged in the record, and `reverted` carries the reverting PR, which the FIDS tooltip states.
- **FLIGHT RECORDER.** One line per FLIGHT and milestone the first time atc sees it: `{"t", "kind": "milestone", "milestone": "out|off|on|in", "flight", "at", "seenAt"}`. `t` and `at` are when it happened (so the line sits in that UTC day's file); `seenAt` is when atc saw it. The pass runs at most once a minute from the records above and asks the recorder which lines exist, so a restart writes nothing twice. Milestones older than the 30-day retention are not written. In the JSON this is a `kind: "milestone"` line, not a `TrafficEvent` (the snapshot-diff shape), so `RecordLine` gains one variant.
- **Screens.** FLIGHT FOLLOWING shows `OUT 03:12 · OFF 03:40 · ON 04:02 · IN 04:07` under the stage bar (`—` for a milestone not reached; the clock follows the UTC/local setting). FIDS shows the latest milestone beside REMARKS, and all four in the row tooltip. `GET /api/following` items carry `milestones`; `GET /api/milestones` returns `{at, flights: {<FLIGHT>: {out, off, on, in, reverted}}}` for FLIGHTs with at least one.
- PILOT'S DISCRETION: ON is the earliest merge when a FLIGHT has several merged PRs, and IN follows that PR's merge commit; OFF takes the earliest candidate rather than trying to pick a "main" PR.
- Not built (a later step could add): target times per milestone from the WAKE expectation, IATA-style delay reason codes, and ETAs.

## Arrival reports as built (ATC-124)

The CAPTAIN's final report used to be free text that OCC had to read and summarize. It now starts with a fixed header and fixed lines that the receiving session records with one command. atc does not read team messages: the session that received the report (OCC, or ENGINEERING) records it, like a READBACK.

```
[TEAM_X → OCC] ARRIVED ATC-n · PR #n
TIER auto|flagged|user
TESTS <pass>/<total> · tsc ✓ · build ✓
DISCRETION <n> — <one line each, or none>
BLOCKED none | <one line each>
<free summary>
```

A SURVEY or CHECK FLIGHT without a PR writes `RESULT <link>` in place of `PR #n`. The format is in root `CLAUDE.md` "교신" and the `atc-task` skill section 8.

**Missing reports (ATC-169).** A report that the receiving OCC read but did not record before it was stopped is lost, because the CAPTAIN does not send it again. The OCC manual now records it the moment it is read, and `dispatch brief` lists `arrivalMissing`: FLIGHTs that DISPATCH sent, with a STAND, whose PR merged after the ATC-124 cutoff (within one day) and that have no record (`due: true` once 30 minutes have passed). OCC tells the SUPERVISOR; it does not ask the CAPTAIN. See [control-recycle.md](control-recycle.md) section 4.

- **Recording.** `atcctl dispatch report <D-xxxx|ATC-n> --pr <n> --tier <t> --tests <p/t> --discretion <n> --blocked <none|text>` (`--result <link>` in place of `--pr` for a FLIGHT without a PR, and `--tests` is then optional) calls `POST /api/dispatch/report`. `D-xxxx` resolves to its FLIGHT; an `ATC-n` key covers a direct assignment. A `report` op is appended to `arrival-reports.jsonl` (`server/arrival-report.ts`, append-only), keyed by FLIGHT; the latest report for a FLIGHT counts. Only the fixed fields are stored: `flight`, `at`, `proposal`, `pr` or `result`, `tier`, `tests`, `discretion` (a count), `blocked`. The free summary is never sent to atc. `GET /api/dispatch/reports` lists them.
- **FOLLOWING** (`server/following.ts`, key `FLIGHT|code`):
  - `no-report`: an info item (ADVISORY, not counted in the alert title) for a FLIGHT whose PR merged (ON) more than 30 minutes ago with no recorded report. A report recorded before the merge counts, since the CAPTAIN reports when the PR goes up. Not for STAND-free FLIGHTs (their ARRIVED comes from `dispatch arrived`). Only for a FLIGHT that DISPATCH sent (its proposal has a `send`) and whose PR merged at or after the first recorded report (`REPORT_START`, 2026-09-29T08:34Z, ATC-124); ENGINEERING PRs and direct work with no FLIGHT PLAN never get it. It closes by itself 24 hours after ON (ATC-152).
  - `blocked-report`: a recorded report whose `BLOCKED` is not `none`, visible for a day, once per report (`FLIGHT|blocked-report|<at>`). It also brings in a FLIGHT that FOLLOWING no longer tracks.
  - Both are for OCC to report to the SUPERVISOR; nothing asks the team.
- **Manuals.** The OCC manual (`CLAUDE.md`, `flight-plan.md`, `following.md`, Korean first) says to record a report when it arrives and lists the two codes. ENGINEERING may record reports it receives with the same command.
- PILOT'S DISCRETION: `tsc ✓ · build ✓` are a fixed part of the line but not stored (the tests count is; a ✗ goes in `BLOCKED`); a second `dispatch report` for a FLIGHT replaces the first; rules apply to FLIGHTs that merge after this ships as well as the ones merged in the last day, so the first tick after the deploy may list a few `no-report` items at once (one `following ack` clears them).
- Not built: application repositories' report rules (the SUPERVISOR adds the line to each repo's `CLAUDE.md`), and any automatic reading of team messages.

## DIRECT briefs (ATC-32)

Status: built 2026-09-28. The SUPERVISOR observed that current agents do better with a clear goal, only the constraints that matter and permission to finish in one pass than with long templates and step-by-step instructions. atc now hands work over that way and measures whether it helps.

| Term | Meaning |
|---|---|
| **VECTORS** | The old brief. The controller gives headings step by step: numbered build steps, full templates, "ask before implementing" |
| **DIRECT** | The new brief, "cleared direct to" the goal: the goal, the exit criteria, only the constraints specific to this task, and "finish it in one pass". The team flies its own route |
| **SOLO** | The CAPTAIN implemented the FLIGHT; subagents only supported (research, review, docs). Since 2026-09-28 vocado `CLAUDE.md` has leaders implement directly and split only WAKE H or multi-area work |
| **CREW** | Implementation was split: at least one teammate (subagent) wrote code in the FLIGHT's STAND |
| **PILOT'S DISCRETION** | Inside a DIRECT flight the team settles ordinary ambiguity itself: it picks a reasonable default, notes it in the PR and keeps going. It stops to ask only for a decision that is truly the SUPERVISOR's (a guard, a record format, approval gates, anything the SUPERVISOR owns) |

AUTOPILOT is not used for this. It means a machine flies while the pilot watches, which suggests the SUPERVISOR's gates are off; the word stays reserved for real automation later (such as AUTOLAND).

Standing rules stay where they are (vocado `CLAUDE.md` and `AGENTS.md`, atc `CLAUDE.md`, guards, branch protection, approval gates) and briefs don't repeat them. Short briefs are safe because those don't change.

**The brief.** Line 2 of every brief is `BRIEF: DIRECT`. Then the FLIGHT, its title and link, and three fields taken from the issue body (`server/briefs.ts` `directSectionsOf`): labeled `Goal:`, `Done when:` and `Constraints:` (ATC-126; the brief text is English). They are found in the issue body under `목표` / Goal / Outcome, `완료 기준` / Acceptance / Done criteria / Done when / Exit criteria, and `이 작업만의 제약` / Constraints / Hard constraints / 금지 / Forbidden / Invariants / Not in scope. The fields carry the text as written (ATC-58): Linear's backslash escapes are removed (`\~31 K` → `~31 K`), an issue link to `linear.app/<workspace>/issue/<KEY>/…` becomes the bare key (`ATC-46`; a link with its own text keeps it, `the design (ATC-46)`), a PR mention, which Linear stores as a link to `linear.app/<workspace>/review/…`, becomes its link text (`chaehy5665/atc#134`, ATC-70), and code spans and fenced blocks are left as they are. A one-line field that is a list item starts on its own line. Exit criteria and constraints are carried in full; only the goal is cut at 600 characters of that cleaned text on a line break (ATC-35). If the three fields together pass 4,000 characters, the brief keeps the goal and says `Read the full done criteria and constraints in the issue body.` instead of carrying a partial list, since a list cut after its first item hides the rules that follow. A normal issue fits: the ATC-34 body (about 3,200 characters) is the test fixture. Allowed scope, context and verification stay in the linked issue. Without an exit-criteria field the brief says to follow the issue's exit criteria. It ends with the PILOT'S DISCRETION line, the READBACK request, and `Carry it through to the end; stop and ask only for what needs a SUPERVISOR decision.`

- **FLIGHT PLAN** (`formatFlightPlan`): `dispatch release` reads the issue body from Linear (read-only) and stores the brief as the proposal's `message`. If Linear can't be read, the FLIGHT PLAN still goes out without the fields. send-guard compares the stored text as before.
- **Assignment by another session** (ENGINEERING, a person): `GET /api/dispatch/flight/:key/brief?to=TEAM_X` returns the same shape as `{key, brief: "DIRECT", text}` to paste. A hand-written brief works too as long as it has the `BRIEF: DIRECT` line.
- **OCC NEW drafts** (`missingSections` in `server/schedule.ts`): only 목표 (Goal / Outcome) and 완료 기준 (Acceptance / Done criteria / Done when / Exit criteria) are required, each with content. A heading, a bold line or a plain `목표: …` label all count. `rating:SEC` also needs a `Hard constraints` line (or `필수 제약`) with the task-specific security limits, such as "no staging apply" or "keep the service_role path". Allowed scope, forbidden changes, invariants and verification are optional.
- **atc's own issues**: the `atc-task` skill follows PILOT'S DISCRETION instead of asking before implementing.

**Measuring it.** A brief is DIRECT when the message that started the FLIGHT has the `BRIEF: DIRECT` line and VECTORS otherwise, so every FLIGHT before this change counts as VECTORS. The LOGBOOK run (every 10 minutes) adds a `measured` line per ARRIVED FLIGHT from the last 30 days (`server/logbook.ts` `measureLines`); it fills only empty fields and never changes one already written:

```json
{"op":"measured","t":"…","key":"owner/repo#85","brief":{"kind":"DIRECT","at":"…","by":"ENGINEERING","readbackAt":"…","questions":0},"crew":"SOLO","rework":1,"findings":{"p0":0,"p1":1,"p2":0}}
```

| Field | Source |
|---|---|
| `brief` | The AIRCRAFT's session transcripts (the same sessions OBSERVED CREW links: live session name or `custom-title.json`). The brief is the last received message naming the FLIGHT before the team's READBACK, or with no READBACK the first one from 12 hours before departure. `by` is the sender's session name. `null` for AD HOC or when no brief was found; missing while the AIRCRAFT or its transcripts are unknown |
| `readbackAt` | The team's first SendMessage containing READBACK with that FLIGHT key or the FLIGHT PLAN's `D-xxxx` |
| `questions` | Mid-task questions: after READBACK (or the brief) and before the PR opened, SendMessage calls to the session that briefed (not READBACK, not a PR report, not to crew members) plus AskUserQuestion calls |
| `crew` | **SOLO** or **CREW** (ATC-33): how the team flew it. Signal: writes inside the FLIGHT's STAND from one day before departure (or the PR) to the merge. CREW when a subagent of the AIRCRAFT (`subagents/agent-*.jsonl`) wrote a non-doc file there with Edit, Write, MultiEdit or NotebookEdit; SOLO when no subagent did and the CAPTAIN worked there (those tools, or a Bash command naming a path in the STAND, since leaders often edit with python or sed). Files ending in `.md`, `.mdx` or `.txt` count as support, and subagent Bash (mostly test runs) is not counted. `null` when nothing in the STAND shows up (another session did it, the STAND is unknown, or no transcript). Agent-team teammates that run as separate sessions are not seen, as in OBSERVED CREW. Lines written before ATC-33 get `crew` from a later `measured` line |
| `rework` | Commits in the PR authored after it opened, merge commits excluded (a rebase keeps the author date, so it isn't counted again) |
| `findings` | P0–P2: Codex inline threads (badge; unmarked counts as P2; P3 left out) plus the external LANDING REVIEW, last review per head. Read with the same review-thread query as LANDING, 10 PRs per run |

atc reads only the transcript lines it needs (received messages, SendMessage and AskUserQuestion calls, file-writing tool calls and the CAPTAIN's Bash commands; from subagent transcripts only file-writing calls; never tool results), keeps only times, recipients, FLIGHT keys, flags and written paths in memory, and writes only the counts and labels above. Transcripts are read incrementally from where the last read stopped.

**The comparison.** The DISPATCH tab shows **VECTORS · DIRECT** under FLIGHT FOLLOWING, grouped by brief, by SOLO/CREW, or as a 2×2 of both: for 14, 30 or 90 days, FLIGHTs, mid-task questions per FLIGHT, share with no questions, median READBACK → PR, P0–P2 findings per FLIGHT and rework commits per FLIGHT, side by side, with the per-FLIGHT rows folded below. `GET /api/logbook/briefs?days=30` returns `{days, rows, stats: {VECTORS, DIRECT}, crewStats: {SOLO, CREW}, grid: {"VECTORS·SOLO", …}, unmeasured, crewUnknown}`; rows carry `crew`, and rows with `crew: null` drop out of the SOLO/CREW groupings. It is shown only; nothing is scored or used for assignment. With fewer than 5 FLIGHTs on a side it says the sample is thin.

Not built yet: vocado's own templates (the four-section rule in vocado `CLAUDE.md`, the Linear `Codex Engineering Task` template) are the SUPERVISOR's to change; the matching wording is proposed in the ATC-32 PR.

## Turning on 2b

2b is built and sits behind `mode`. Turning it on sends approved proposals to real team sessions, so do it in this order:

1. Check the "2b 켜기 점검표" in the DISPATCH tab (below) and the stage 2b gate (20 or more shadow decisions, 80% or more agreement).
2. Extend the READBACK line in each candidate AIRPORT's `CLAUDE.md` so CAPTAINs also answer `[DISPATCH D-xxxx]` FLIGHT PLANs with `READBACK D-xxxx` (or a reason) and `[OCC CC-xxxx]` CREW CHANGEs with `READBACK CC-xxxx`. The checklist has one `readback-*` item per AIRPORT `candidateTeams` can assign to (`teamAirports`/`projectAirports`) and gives the sentence to add for each. atc's own root `CLAUDE.md` carries these rules already (ATC-75); vocado's `CLAUDE.md` is the SUPERVISOR's to edit, atc only reads it (`ATC_VOCADO_CLAUDE_MD` override).
3. Press "2b 승인 운용 켜기" in the DISPATCH tab (or `POST /api/dispatch/mode {"mode":"approval"}`). The running DISPATCH session picks up the mode on its next pass.
4. To stop, switch back to shadow. FLIGHT PLANs already sent stay as they are; no new ones go out.

### 2b readiness checklist

`GET /api/dispatch/brief` returns `readiness2b: {items: [{id, label, status, detail, link?, suggestion?}]}` (`server/readiness.ts`). `status` is `ready`, `not-ready` or `check` (a person must look). It only displays; switching the mode stays with the SUPERVISOR.

| id | How it is computed |
|---|---|
| `gate` | `gateOf`: `ready` when the 2a gate is met (20 decisions, 80% agreement) |
| `recall` | Code facts, not a constant: a synthetic log folds `sent → recalling → recalled` and releases the reservation, `formatRecall` produces the header, the `recall`, `recall-send` and `recalled` endpoints are registered (`DISPATCH_ACTIONS`), and `controller/atcctl.mjs` has the `recall-send` and `recalled` commands (`selfCheck2b`) |
| `send-guard` | The server does not run tests. It reads `occ/send-guard.mjs` and looks for the `checkSend` export, the approval-mode check, the FLIGHT PLAN (`proposal.message`), RECALL (`proposal.recallMessage`) and CREW CHANGE (`change.message`, recipient `change.registration`) comparisons, the recipient check and `exit 2`, and shows the file's sha256 prefix. All present → `check` with a pointer to `node --test occ/send-guard.test.mjs`; something missing or no file → `not-ready` |
| `vocado-readback`, `readback-<code>` (one per AIRPORT `candidateTeams` can assign to, `assignableAirportCodes` in `server/dispatch.ts`) | Reads that AIRPORT's `CLAUDE.md`, read-only. vocado always reads `ATC_VOCADO_CLAUDE_MD`, else `<projectsDir>/vocado_nextjs/CLAUDE.md`; atc's own AIRPORT (`teamAirports.ATC`, default `ATCC`) always reads this repository's root `CLAUDE.md`; any other AIRPORT reads `<path>/CLAUDE.md` from the AIRPORT registry (`airports.json`). `ready` when one line holds both `[DISPATCH D-` and `READBACK D-` and one line (the same or another) holds both `[OCC CC-` and `READBACK CC-`; otherwise `not-ready` with the sentence to add in `detail` and `suggestion`; `check` when the file cannot be read or the AIRPORT is not in the registry |
| `stand-free` | Code facts like `recall`: READBACK of a SURVEY departs with no STAND, it stays reserved and does not expire after 30 days, ARRIVED releases it, the `arrived` endpoint and `atcctl dispatch arrived` exist |
| `crew-change` | Code facts like `recall` (`selfCheckCrewChange` in `server/crew-change.ts`): a synthetic log folds `pending → approved → sent → acknowledged`, a `sent` one is overdue after 10 minutes, approval is refused in shadow mode, `crewChangeMessage` produces the `[OCC CC-xxxx]` header and the `READBACK CC-xxxx` line, a newer change supersedes an `approved` one and waits behind a `sent` one, the `approve`, `send` and `readback` endpoints exist, and `controller/atcctl.mjs` has `crew-change send` and `readback` ([fleet.md](fleet.md) 8.4) |
| `known-gaps` | Always `check`, linking to the section below |

### Known gaps before turning on 2b

- `dispatch release` marks a proposal SENT before the message goes out. If delivery fails (the CAPTAIN session is gone, or the message is held for approval), it stays SENT; after 10 minutes it shows as NO READBACK, DISPATCH resends once, then reports to the SUPERVISOR.
- A STAND-free FLIGHT ARRIVES when OCC confirms it: on the CAPTAIN's report, or on an ARRIVED candidate atc finds from the team's own review, comment or docs PR (ATC-72, [fleet.md](fleet.md) 5.1.1). atc never marks it by itself. A forgotten confirmation keeps the AIRCRAFT's one STAND-free slot until the SUPERVISOR follows up from `overdue` (24 hours); OCC cannot ask the CAPTAIN itself, since send-guard lets through only FLIGHT PLANs, RECALLs and CREW CHANGEs.
- A STAND-free READBACK counts as DEPARTED even if the CAPTAIN never starts; nothing else shows the work began.
- A STAND-free ARRIVED does not enter the LOGBOOK, so it does not count toward TARGETS. The planner excludes the FLIGHT for 7 days after ARRIVED; after that it trusts Linear, so the FLIGHT should be closed there.
- The FLIGHT TYPE is read at READBACK. Relabelling afterwards does not change a recorded departure.
- A DEPARTED FLIGHT with a STAND cannot be RECALLED; the SUPERVISOR talks to the CAPTAIN directly.
- `crew-change send` marks a CREW CHANGE SENT before the message goes out, like `dispatch release`. A failed delivery shows as overdue after 10 minutes; OCC resends once, then reports. While it waits for READBACK, a newer CREW CHANGE for the same AIRCRAFT waits too ([fleet.md](fleet.md) 8.4).
- send-guard's behaviour is only proven by its tests; the checklist shows `check`, not `ready`.
- The `readback-*` checks look for the two markers on one line. They do not judge the wording.

## 10. Implementation order

1. Extend the Linear query + `dispatch.ts` (candidates, slots, scores) + tests
2. Proposal log, API and events, shadow mode by default
3. DISPATCH tab (shadow agreement display) + metrics
4. `atc/dispatch/` session (review notes, CAUTION), now part of `atc/occ/`
5. Approval operation (2b): approve button, FLIGHT PLAN delivery, READBACK, DEPARTED detection — widen the READBACK line in vocado `CLAUDE.md` to cover `[DISPATCH D-xxxx]`

## Decisions (2026-09-26, SUPERVISOR)

| Item | Decision |
|---|---|
| DISPATCH session | A **separate session** from TOWER (`atc/dispatch/`). Merged into OCC (`atc/occ/`) later the same day |
| Candidate FLIGHTs | **Todo only**. Backlog items qualify only after a person moves them to Todo |
| Project → AIRPORT | Beta Readiness · Song Experience → **VCDO**. Vocado Pre-seed IR & Pitch Deck · Vocado Visual System (SEED) are **excluded from assignment** |
| `RELEASE` threshold | **3 days** ENROUTE without a STAND |
| Slots | Start with the proposed values: 1 per TEAM, 4 concurrent AIRBORNE at VCDO, 2 elsewhere, 5 pending proposals |
| What the gate measures (2026-09-27, ATC-5) | **The AIRCRAFT choice only.** Readiness is caught by PREFLIGHT (6.2), and a rejection whose chips are all FLIGHT chips is left out of the decided count and the agreement and shown separately (6.3). Old verdicts get chips through `recode`, which changes only the gate |
| Held proposals and the gate (2026-09-27, ATC-3) | **Outside the gate.** A proposal held by PREFLIGHT or OCC is not a SUPERVISOR verdict, and a confirmed HOLD is recorded with `via: "preflight"` and not counted. The gate measures team choice on tickets that were ready; ticket readiness is shown separately as the ready rate (6.2) |
| Fast path (2026-09-27, ATC-6) | **Agreement group** for CROSSCHECK-agree cards, one line and one click each; **no bulk confirm**; a **20% blind sample** chosen from the proposal id, whose agreement the gate panel shows separately as the anchoring check (5.6) |

Still open: when entering 2b, whether to widen the READBACK rule in vocado `CLAUDE.md` to cover FLIGHT PLANs (`[DISPATCH D-xxxx]`). Not needed for 2a.
