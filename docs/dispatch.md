# Stage 2 DISPATCH design (draft)

**English** · [한국어](dispatch.ko.md)

DISPATCH proposes **which FLIGHT (Linear ticket) to send to which AIRCRAFT (team session), and when**. Where TOWER (stage 1) keeps aircraft that are already airborne from colliding, DISPATCH handles the plan before takeoff. It is the same split as between an airline's operations control center (OCC) and ATC.

> Status: 2a (shadow operation) implemented (2026-09-26). Decisions are listed under "Decisions" at the end.
>
> Settled while implementing: under the 1-FLIGHT-per-TEAM rule, a HOLDING AIRCRAFT that holds the STAND of an unfinished FLIGHT is never assigned, however long it has been idle (the "30 minutes" rule in 5.1 is not used). RELEASE only looks at projects mapped to an AIRPORT (code work).

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
| DISPATCH | A new Claude session (`atc/dispatch/`) | Reviews proposals (reads ticket bodies), delivers approved FLIGHT PLANs, records acceptance | atc CLI, SendMessage, Linear **read** |
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
- **FLIGHT**: in the Todo state, and
  - not labelled `symphony-pilot`
  - not blocked by a FLIGHT that hasn't ARRIVED (if blocked: `HOLD_DEPARTURE`)
  - has no STAND yet and nobody holds it
  - its project maps to an AIRPORT that is operating (OPEN)

### 5.2 Slots (capacity)

| Limit | Default | Why |
|---|---|---|
| Concurrent FLIGHTs per TEAM | 1 | vocado rule: one team job = one Linear issue |
| Concurrent AIRBORNE per AIRPORT | VCDO 4, others 2 | Dev server ports (3001+), CI, LANDING SEQUENCE congestion |
| Pending proposals overall | 5 | SUPERVISOR review load |

When slots are full, nothing is proposed instead of an `ASSIGN` (extended to ground delay in stage 3).

### 5.3 Score (higher goes first)

| Factor | Calculation | Default weight |
|---|---|---|
| Priority | Urgent 4 · High 3 · Medium 2 · Low 1 · none 1.5 | ×3 |
| Wait time | Days spent in Todo (max 14) | ×0.5 |
| FLIGHTs it unblocks | Number of Todo items this FLIGHT blocks | ×2 |
| Team fit | How many times this AIRCRAFT flew FLIGHTs in the same project or related ones (FLIGHT RECORDER, claim history) | ×1 |
| Conflict risk | Number of currently AIRBORNE FLIGHTs linked by related | ×−2 |

Each proposal shows the per-factor scores as they are ("why this flight for this team"). The SUPERVISOR changes the weights in a settings file.

### 5.4 DISPATCH session review

For each top candidate the server picks, the DISPATCH session reads the ticket body and comments and:

- Adds a `CAUTION` mark with a reason for DB, migration, security or rights work (what vocado routes to `Codex Engineering Task`).
- Holds the proposal back when the ticket needs a human decision first (e.g. "after user confirmation").
- Leaves a one- or two-line rationale on the proposal.

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
```

Proposal states: `PROPOSED → (SHADOW_AGREE | SHADOW_DISAGREE)` (2a), `PROPOSED → APPROVED → SENT → ACCEPTED → DEPARTED` (2b), with side branches `REJECTED`, `DECLINED` (CAPTAIN gave a reason), `SUPERSEDED` (a person assigned it directly or the situation changed) and `EXPIRED` (24 hours).

## 7. What to add to atc

| Where | What |
|---|---|
| `server/sources/linear.ts` | Add `relations` (blocks), `labels`, `project`, `createdAt` and the time a state was entered (via `history` if possible) to the query |
| `server/dispatch.ts` | Candidate, slot and score calculation (pure functions + tests) |
| `server/proposals.ts` | Proposal log (`~/.local/state/atc/proposals.jsonl`, append-only, same approach as clearances) |
| API | `GET /api/dispatch/brief`, `POST /api/dispatch/proposals/:id/{agree,disagree,approve,reject,sent,accept,decline}` |
| Events and records | `proposal.created / decided / sent / accepted / departed / superseded` into the FLIGHT RECORDER |
| Settings | `~/.local/state/atc/dispatch.json`: project → AIRPORT mapping, slots, weights, mode (`shadow`/`approval`) |
| UI | DISPATCH tab: proposal cards (FLIGHT, AIRCRAFT, per-factor scores, DISPATCH note, CAUTION), approve/reject buttons, slot status, RELEASE list |
| Metrics | Shadow agreement rate, proposal → acceptance time, idle AIRCRAFT time (minutes PARKED while Todo items existed), number of neglected ENROUTE FLIGHTs |
| `atc/dispatch/` | Same structure as TOWER: `CLAUDE.md` (role and decision rules), `/tick`, a guard (atc CLI and jq only; Linear through a read-only MCP only) |

## 8. Criteria for moving on

| Transition | Criteria (proposed) |
|---|---|
| 1.5 → 2a | Can start right away (nothing is sent, so it runs alongside 1.5) |
| 2a → 2b | 20+ shadow proposals, 80%+ agreement, 0 proposals that violated blocks. The four stage 1.5 checks are also met |
| 2b → 3 (ATFM) | 2+ weeks, READBACK rate 90%+, almost no LOS on FLIGHTs DISPATCH sent, less idle AIRCRAFT time |

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Flooding teams with work | 1 per TEAM, AIRPORT and overall slots, no new assignment while a READBACK is pending |
| Wrong calls because of stale Linear state (neglected In Progress) | Include `RELEASE` in the first implementation; clean up NO CONTACT FLIGHTs first |
| Competing with Symphony for the same ticket | Exclude the `symphony-pilot` label. If a Symphony clone appears, open it as a separate AIRPORT so it is visible |
| Overlapping with work the user gave directly | When a direct assignment is detected (a STAND or Linear In Progress appears without a proposal), mark related proposals SUPERSEDED |
| Assigning risky work too lightly | Body review and CAUTION by the DISPATCH session; CAUTION proposals stay excluded from auto-approval even in stage 3 |
| DISPATCH touching code or Linear | Guard (atc CLI and jq only), Linear through a read-only MCP only |

## 10. Implementation order

1. Extend the Linear query + `dispatch.ts` (candidates, slots, scores) + tests
2. Proposal log, API and events, shadow mode by default
3. DISPATCH tab (shadow agreement display) + metrics
4. `atc/dispatch/` session (review notes, CAUTION)
5. Approval operation (2b): approve button, FLIGHT PLAN delivery, READBACK, DEPARTED detection — widen the READBACK line in vocado `CLAUDE.md` to cover `[DISPATCH D-xxxx]`

## Decisions (2026-09-26, SUPERVISOR)

| Item | Decision |
|---|---|
| DISPATCH session | A **separate session** from TOWER (`atc/dispatch/`) |
| Candidate FLIGHTs | **Todo only**. Backlog items qualify only after a person moves them to Todo |
| Project → AIRPORT | Beta Readiness · Song Experience → **VCDO**. Vocado Pre-seed IR & Pitch Deck · Vocado Visual System (SEED) are **excluded from assignment** |
| `RELEASE` threshold | **3 days** ENROUTE without a STAND |
| Slots | Start with the proposed values: 1 per TEAM, 4 concurrent AIRBORNE at VCDO, 2 elsewhere, 5 pending proposals |

Still open: when entering 2b, whether to widen the READBACK rule in vocado `CLAUDE.md` to cover FLIGHT PLANs (`[DISPATCH D-xxxx]`). Not needed for 2a.
