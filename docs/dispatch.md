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
- Assignees can't tell teams apart, so **team fit is estimated from past flight history** (which team flew related FLIGHTs).
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
| Project not mapped / AIRPORT closed | `배정 제외 프로젝트: <project>`, `프로젝트 없음`, `<CODE> AIRPORT가 운항 중이 아님` | |
| **Already done**: the FLIGHT's PR is in the LOGBOOK as ARRIVED and not reverted ([fleet.md](fleet.md) 7.1) | `이미 완료됨 — PR <repo>#N 머지됨(LOGBOOK)` | 2026-09-27 |
| **Being worked**: an open PR (Draft included) whose ticket key is the FLIGHT | `열린 PR #N 있음` | 2026-09-27 |
| **FLIGHT hold**: an ASSIGN for it was rejected in the last 24 hours with a FLIGHT chip, and the issue has not changed since (6.1) | `FLIGHT 보류 — <chip> (D-xxxx 판정) — 이슈가 바뀌거나 MM-DD HH:MM부터 다시` | 2026-09-27 |
| A worktree (STAND) already exists | `이미 STAND가 있음` | |
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
| Conflict risk | Number of currently AIRBORNE FLIGHTs linked by related | ×−2 |
| ROUTE | The FLIGHT's project is on the AIRCRAFT's routes ([fleet.md](fleet.md) 5) | ×1 |

Each proposal shows the per-factor scores as they are ("why this flight for this team"). The SUPERVISOR changes the weights in a settings file.

Two marks add no points and only explain the pair: `STAND 없이` (a SURVEY or CHECK given outside the STAND rule, with the AIRCRAFT's state, e.g. `HOLDING — VOC-10 진행 중`), and `CHECK 독립성` on every CHECK (the builder that was left out, or `확인 못 함 — …` when atc could not tell who built it). There is no bonus for idle AIRCRAFT.

### 5.4 DISPATCH session review

For each top candidate the server picks, the DISPATCH session reads the ticket body and comments and:

- Adds a `CAUTION` mark with a reason for DB, migration, security or rights work (what vocado routes to `Codex Engineering Task`).
- Adds a HOLD with no prerequisite FLIGHT (a bare `--hold`) when the ticket needs a human decision first (e.g. "after user confirmation"). The note carries the reason; if the FLIGHT is edited after the HOLD, atc releases it for another review.
- Adds a `HOLD` with `dispatch note <ID> --hold <FLIGHT> -- <note>` when the prerequisite is written only in the body, with no `blocks` relation. The named FLIGHT is the **blocking (prerequisite)** one, and the proposal moves to the HELD list instead of the ASSIGN list. Its own FLIGHT stays reserved so the planner will not offer it again (its AIRCRAFT is left free for other FLIGHTs), it cannot be sent, and its FLIGHT PLAN carries a `HOLD — 선행 FLIGHT …` line. When every named FLIGHT reaches a done state, atc supersedes the proposal so the planner can offer it again. A HOLD does not expire after 24 hours; it also closes when the FLIGHT itself is no longer Todo. The SUPERVISOR does not judge a HELD proposal: "대기열로" (requeue) puts it back in the queue and "FLIGHT 보류 확정" (confirm) closes it with a FLIGHT hold (6.2).
- Leaves a one- or two-line rationale on the proposal.
- Writes a **BRIEFING** (ATC-4) on each open or HELD proposal: three plain Korean lines, `dispatch briefing <ID> --what … --why … --risk …`, stored as an append-only `brief` op; writing again replaces it. See "Proposal cards" below.

### 5.5 Proposal cards (BRIEFING, ATC-4)

The SUPERVISOR often doesn't remember what a ticket is about (VOC-195, VOC-172), and should not have to open Linear to judge a proposal. Every open and HELD card reads top to bottom:

1. **BRIEFING**: 무슨 일 (what the work is), 왜 이 AIRCRAFT (why this AIRCRAFT), 걸리는 점 (prerequisites, risk, what a person must decide), written by OCC (`occ/CLAUDE.md` "BRIEFING"). Until OCC writes one, the card shows the title and the first sentence of the body, marked "BRIEFING 대기". atc reads the body from Linear in the background and caches it for 30 minutes (`server/briefing.ts`, `leadOf`).
2. **Facts line**, computed by the server with no model (`factsOf`): PRIORITY, wait days since the FLIGHT was created, ROUTE and WAYPOINT from the ROUTE MAP (for example "Beta Ready WAYPOINT(지금 구간) · 남은 3건 중 하나"), each prerequisite FLIGHT (Linear `blockedBy` and the DISPATCH HOLD) with its state, the AIRCRAFT's recent FLIGHTs on the same ROUTE (LOGBOOK ARRIVED in 30 days and its in-flight ASSIGNs, at most three), and on HELD cards the CROSSCHECK verdict and reason (open cards show it in the CROSSCHECK chip).
3. Classification, AIRCRAFT and score, HOLD line, CROSSCHECK chip and the verdict buttons, as before.
4. **Collapsed details** ("점수 요소 · 본문 · 메모"): the score factors, the DISPATCH note and the full body, read from Linear when opened.

`GET /api/dispatch/brief` adds `briefs: { <ID>: { facts, lead } }` for open and HELD proposals; `lead` is null once a BRIEFING exists. `POST /api/dispatch/proposals/:id/briefing {what, why, risk}` is accepted only while the proposal is `proposed`; each line is required, whitespace is collapsed and 300 characters is the limit. The OCC guard needed no change: `dispatch briefing` is an atc CLI command like `dispatch note`, and CROSSCHECK's allowlist does not include it.

### 5.6 Fast path and blind sample (ATC-6)

After PREFLIGHT and the BRIEFING, most cards that reach the SUPERVISOR only need "yes, this AIRCRAFT". The queue is split so those take one click, while a sample stays blind to keep the gate honest.

- **Agreement group.** Open ASSIGN cards whose CROSSCHECK mark is `agree` (and that are not blind) sit at the top of the ASSIGN list as one line each: the BRIEFING "무슨 일" line (the title while there is no BRIEFING), the FLIGHT, the AIRCRAFT and a **동의** button. The button records the SUPERVISOR's `agree` verdict (shadow) or approval (2b) with `via: "crosscheck"`, the existing one-click flag. Expanding a line (▸, keyboard Enter) shows the full card; rejecting, with chips, is done from there. There is **no "confirm all"**: each verdict is one deliberate click.
- **Disagreement stays expanded.** Cards where CROSSCHECK disagrees (`wrong-aircraft`, `other`; FLIGHT chips already go to HELD) stay full cards with the CROSSCHECK chip and "CROSSCHECK에 동의".
- **CROSSCHECK 대기.** Cards CROSSCHECK has not marked yet keep the ATC-3 "CROSSCHECK 대기" state, sorted after marked cards, and are never in the agreement group.
- **Blind sample.** About 1 in 5 open cards is blind, chosen from the proposal id (FNV-1a hash mod 5, `server/blind.ts`), so a reload never changes it. A blind card shows **BLIND** instead of the CROSSCHECK chip and the one-click button until it is judged, and sits in the expanded list even when CROSSCHECK agrees. The server records `blind: true` on the verdict, approve or reject, and refuses a one-click (`via: "crosscheck"`) verdict on a blind card (409). HELD cards are never blind (the HOLD itself shows what CROSSCHECK said).
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
  FLIGHT VOC193 · AIRPORT VCDO · PRIORITY High
  <ticket title and URL, DISPATCH note>
  — If you take it, reply "READBACK D-0003"; if not, reply with the reason.
CAPTAIN: READBACK → Linear In Progress, prepares the STAND (same rules as today)
atc: DEPARTED once that FLIGHT gets a STAND; if not, rechecks after 30 minutes like TOWER does
     STAND-free FLIGHT (SURVEY, CHECK): DEPARTED at the READBACK itself (no STAND to wait for)
CAPTAIN (STAND-free only): reports it done → OCC: atcctl dispatch arrived D-0003 -- '<result link or one line>' → atc: ARRIVED
```

Proposal states: `PROPOSED → (SHADOW_AGREE | SHADOW_DISAGREE)` (2a), `PROPOSED → APPROVED → SENT → ACCEPTED → DEPARTED` (2b), `… → ACCEPTED → DEPARTED → ARRIVED` for a STAND-free FLIGHT, with side branches `REJECTED`, `DECLINED` (CAPTAIN gave a reason), `SUPERSEDED` (a person assigned it directly or the situation changed) and `EXPIRED` (24 hours). A `PROPOSED` ASSIGN that carries a `HOLD` leaves the main flow: it waits on the HELD list until released (no 24-hour expiry), and the SUPERVISOR does not judge it (6.2).

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
  FLIGHT VOC193 · AIRPORT VCDO — 이 FLIGHT PLAN을 거둬들입니다.
  <ticket title>
  사유: <SUPERVISOR's reason>
  작업을 멈추세요. STAND(워크트리)는 정리하지 말고 그대로 두세요 — 다른 AIRCRAFT가 이어받을 수 있게.
  — 받았으면 이 메시지에 "READBACK D-0003 RECALL"로 답장해 주세요.
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

## Turning on 2b

2b is built and sits behind `mode`. Turning it on sends approved proposals to real team sessions, so do it in this order:

1. Check the "2b 켜기 점검표" in the DISPATCH tab (below) and the stage 2b gate (20 or more shadow decisions, 80% or more agreement).
2. Extend the READBACK line in the teams' CLAUDE.md (`vocado_nextjs/CLAUDE.md`) so CAPTAINs also answer `[DISPATCH D-xxxx]` FLIGHT PLANs with `READBACK D-xxxx` (or a reason) and `[OCC CC-xxxx]` CREW CHANGEs with `READBACK CC-xxxx`. The checklist's `vocado-readback` item gives the sentence to add; the SUPERVISOR edits that file, atc only reads it.
3. Press "2b 승인 운용 켜기" in the DISPATCH tab (or `POST /api/dispatch/mode {"mode":"approval"}`). The running DISPATCH session picks up the mode on its next pass.
4. To stop, switch back to shadow. FLIGHT PLANs already sent stay as they are; no new ones go out.

### 2b readiness checklist

`GET /api/dispatch/brief` returns `readiness2b: {items: [{id, label, status, detail, link?, suggestion?}]}` (`server/readiness.ts`). `status` is `ready`, `not-ready` or `check` (a person must look). It only displays; switching the mode stays with the SUPERVISOR.

| id | How it is computed |
|---|---|
| `gate` | `gateOf`: `ready` when the 2a gate is met (20 decisions, 80% agreement) |
| `recall` | Code facts, not a constant: a synthetic log folds `sent → recalling → recalled` and releases the reservation, `formatRecall` produces the header, the `recall`, `recall-send` and `recalled` endpoints are registered (`DISPATCH_ACTIONS`), and `controller/atcctl.mjs` has the `recall-send` and `recalled` commands (`selfCheck2b`) |
| `send-guard` | The server does not run tests. It reads `occ/send-guard.mjs` and looks for the `checkSend` export, the approval-mode check, the FLIGHT PLAN (`proposal.message`), RECALL (`proposal.recallMessage`) and CREW CHANGE (`change.message`, recipient `change.registration`) comparisons, the recipient check and `exit 2`, and shows the file's sha256 prefix. All present → `check` with a pointer to `node --test occ/send-guard.test.mjs`; something missing or no file → `not-ready` |
| `vocado-readback` | Reads `vocado_nextjs/CLAUDE.md` (read-only; `ATC_VOCADO_CLAUDE_MD`, else `<projectsDir>/vocado_nextjs/CLAUDE.md`). `ready` when one line holds both `[DISPATCH D-` and `READBACK D-` and one line (the same or another) holds both `[OCC CC-` and `READBACK CC-`; otherwise `not-ready` with the sentence to add in `detail` and `suggestion`; `check` when the file cannot be read |
| `stand-free` | Code facts like `recall`: READBACK of a SURVEY departs with no STAND, it stays reserved and does not expire after 30 days, ARRIVED releases it, the `arrived` endpoint and `atcctl dispatch arrived` exist |
| `crew-change` | Code facts like `recall` (`selfCheckCrewChange` in `server/crew-change.ts`): a synthetic log folds `pending → approved → sent → acknowledged`, a `sent` one is overdue after 10 minutes, approval is refused in shadow mode, `crewChangeMessage` produces the `[OCC CC-xxxx]` header and the `READBACK CC-xxxx` line, a newer change supersedes an `approved` one and waits behind a `sent` one, the `approve`, `send` and `readback` endpoints exist, and `controller/atcctl.mjs` has `crew-change send` and `readback` ([fleet.md](fleet.md) 8.4) |
| `known-gaps` | Always `check`, linking to the section below |

### Known gaps before turning on 2b

- `dispatch release` marks a proposal SENT before the message goes out. If delivery fails (the CAPTAIN session is gone, or the message is held for approval), it stays SENT; after 10 minutes it shows as NO READBACK, DISPATCH resends once, then reports to the SUPERVISOR.
- A STAND-free FLIGHT ARRIVES only on the CAPTAIN's report. There is no automatic detection yet (a review on the target PR, a docs PR or issue comment). A forgotten report keeps the AIRCRAFT's one STAND-free slot until the SUPERVISOR follows up from `overdue` (24 hours); OCC cannot ask the CAPTAIN itself, since send-guard lets through only FLIGHT PLANs, RECALLs and CREW CHANGEs.
- A STAND-free READBACK counts as DEPARTED even if the CAPTAIN never starts; nothing else shows the work began.
- A STAND-free ARRIVED does not enter the LOGBOOK, so it does not count toward TARGETS. The planner excludes the FLIGHT for 7 days after ARRIVED; after that it trusts Linear, so the FLIGHT should be closed there.
- The FLIGHT TYPE is read at READBACK. Relabelling afterwards does not change a recorded departure.
- A DEPARTED FLIGHT with a STAND cannot be RECALLED; the SUPERVISOR talks to the CAPTAIN directly.
- `crew-change send` marks a CREW CHANGE SENT before the message goes out, like `dispatch release`. A failed delivery shows as overdue after 10 minutes; OCC resends once, then reports. While it waits for READBACK, a newer CREW CHANGE for the same AIRCRAFT waits too ([fleet.md](fleet.md) 8.4).
- send-guard's behaviour is only proven by its tests; the checklist shows `check`, not `ready`.
- The `vocado-readback` check looks for the two markers on one line. It does not judge the wording.

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
