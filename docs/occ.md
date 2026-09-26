# OCC design (draft)

English only for now; a Korean version will follow.

atc splits into two control sessions, the way aviation does:

- **OCC** (operations control center, the airline side) decides **what flies, who flies it and when**. It keeps the schedule (Linear tickets), dispatches FLIGHTs to teams and follows them until they land.
- **ATC** (air traffic control) keeps what is already flying **separated**. TOWER today, flow management (stage 3) later.

In real aviation the flight dispatcher belongs to the airline's OCC, not to ATC. So DISPATCH (stage 2) moves into OCC, and OCC takes over the work the "President" session does by hand today.

> Status: S0 built (2026-09-26): the `atc/occ/` session (DISPATCH merged in), read-only `gh`, a read-only MCP guard, manual reload, and TAIL ASSIGNMENT (`tail:TEAM_X`, see [fleet.md](fleet.md)) in the planner. S1 built: SCHEDULE drafts in shadow operation for `CLASSIFY`, `PRIORITIZE` and `NEW` (`server/schedule.ts`, `atcctl schedule brief|draft`, the SCHEDULE tab, OCC rules). `NEW` is the CHARTER DESK: an AD HOC FLIGHT drafted from a CHARTER REQUEST, with body-section checks and a title-similarity duplicate search over the snapshot (issues updated in the last 45 days). At most 5 open drafts of any kind, and drafts expire after 3 days without a verdict. Other operations (`CLOSE`, `TAIL`, `LINK`, `SPLIT`, `COMMENT`) and S3 are design only. S2 (approval operation: linear-guard, `schedule release`, APPLIED detection) is built behind `mode` and off by default — see "Turning on S2". Decisions are listed under "Decisions" at the end.

## 1. Current facts

| Item | Today |
|---|---|
| Group head | A "President" session in `vocado_nextjs`, above TEAM_A … TEAM_F. It delegates work, verifies team reports against GitHub, Linear and the DB, reviews PRs and judges Codex findings, keeps Linear tidy, maintains rule files (`CLAUDE.md`, PR template), and routes merge, close and scope decisions to the user. It writes no product code and cannot merge |
| DISPATCH | A separate session (`atc/dispatch/`) in shadow operation (2a). It reviews proposals and adds notes, CAUTION and HOLDs. It does not write to Linear |
| TOWER | Stage 1 controller: LOSS OF SEPARATION, HANDOFF, LANDING SEQUENCE |
| Who writes Linear | Only team leaders (vocado `CLAUDE.md`: "only leaders write to Linear"). In practice President also creates, reprioritizes and closes issues |
| State changes | The GitHub integration moves issues through In Progress / In Review, and a merge moves them to Done |

What went wrong on 2026-09-26, all in one day:

| Incident | What it shows |
|---|---|
| VOC-196: President assigned it to TEAM_E, while DISPATCH proposed it to TEAM_D, then TEAM_B | Two dispatchers that cannot see each other |
| VOC-56: finished weeks ago, still open, proposed twice | Nobody closes issues whose done criteria are already met |
| VOC-195: a race found during VOC-193, split out by hand | Follow-up tickets depend on someone remembering to write them |
| VOC-177, VOC-179, VOC-195: Todo with no priority | Triage is not anyone's job |
| DISPATCH kept an old `CLAUDE.md` after the rules changed | Long-running control sessions need a way to reload their manual |

## 2. Principles

1. **Two sessions, two questions.** OCC decides what flies; ATC keeps it separated. Whoever plans and assigns work never judges the conflicts that work causes.
2. **The SUPERVISOR (user) decides.** OCC drafts, ATC reports, the SUPERVISOR approves. Automation grows step by step, as with DISPATCH (shadow → approval → automatic for low risk only).
3. **Linear fields have one owner each.** OCC owns the plan fields, the CAPTAIN owns the execution fields (section 4). Two writers never race on the same field.
4. **Every Linear write is traceable.** Each write carries its SCHEDULE id (`[OCC S-0001]`), is checked by a guard against an approved operation, and lands in the FLIGHT RECORDER.
5. **No code, no merges.** OCC changes neither code nor rule files. A rule change becomes a ticket that a TEAM implements through a PR. Only the SUPERVISOR merges.
6. **Assignments made directly by a person still win**, as in DISPATCH.

## 3. Roles and permissions

| Role | Who | Does | May use |
|---|---|---|---|
| SUPERVISOR | The user | Approves SCHEDULE operations and DISPATCH proposals, merges, final authority | Everything |
| OCC | One Claude session (`atc/occ/`), replaces DISPATCH and President | SCHEDULE (create, triage and close tickets), DISPATCH (proposals, FLIGHT PLANs, READBACK), flight following (checks team reports) | atc CLI, SendMessage (send-guard), Linear writes (linear-guard), read-only `gh` |
| ATC (TOWER) | The stage 1 controller | LOS, HANDOFF, LANDING SEQUENCE, CLEARED TO LAND checks; flow management in stage 3 | atc CLI, SendMessage |
| CAPTAIN | Each TEAM leader | READBACK or a reason, execution fields in Linear, the work itself | Its own repository, Linear execution fields |
| President | Today's group head | Retires once OCC covers its work (section 8) | — |
| Symphony | Another operator | `symphony-pilot` FLIGHTs | OCC leaves them alone |

## 4. Linear field ownership

| OCC (plan) | CAPTAIN (execution) |
|---|---|
| Create an issue (title, body from the template, project) | Move to In Progress when work starts |
| Priority | PR description (`Fixes VOC-n`), so the GitHub integration moves the state |
| `tail:TEAM_X` label (TAIL ASSIGNMENT: which team should fly it) and the classification labels `type:`, `wake:`, `rating:` ([fleet.md](fleet.md)) | Short comments at start, PR, blocked, done |
| Parent / child links, `blocks` / `blocked by` relations | |
| Close as Done or Canceled **with an evidence comment**, mark duplicates | |

Neither side attaches PR links through the Linear API (vocado rule: attachments hit the rate limit).

## 5. SCHEDULE operations

OCC never writes to Linear freely. It drafts **SCHEDULE operations**. Each one is a single change with an id (`S-0001`), a reason and the exact payload it will write.

| Operation | Meaning | Example (2026-09-26) |
|---|---|---|
| `NEW` | Create a ticket | Split the batch-processor race out of VOC-193 (became VOC-195) |
| `CLOSE` | Close as Done or Canceled, with an evidence comment | VOC-56: the `protect main` ruleset already meets every done criterion |
| `PRIORITIZE` | Set or change priority | VOC-177, VOC-179, VOC-195 have no priority |
| `TAIL` | Add or change `tail:TEAM_X` (TAIL ASSIGNMENT) | VOC-196 → `tail:TEAM_E` (what President decided) |
| `CLASSIFY` | Set FLIGHT TYPE, WAKE CATEGORY and required TYPE RATING ([fleet.md](fleet.md) section 4) | VOC-195 → `type:MAINT`, `wake:M`, `rating:SEC` |
| `LINK` | Add a parent, `blocks` or `related` relation | VOC-196 blocked by VOC-52 (written only in the body) |
| `SPLIT` | Turn a finding into a child or related ticket | P3 items from the PR #400 review |
| `COMMENT` | Leave a plan comment (not execution) | "Deferred until VOC-52 lands" |

### 5.1 Where operations come from

- **The SUPERVISOR's instructions (CHARTER DESK)**: a CHARTER REQUEST made directly in the OCC session ("make a ticket for X") becomes a `NEW` draft, an AD HOC FLIGHT (a FLIGHT added outside the regular schedule). Once approved and in Linear Todo (S2) it is FILED like any other FLIGHT. Small ticketless work handed straight to a team is AD HOC and never becomes a SCHEDULE operation. OCC never drafts `NEW` on its own initiative. Its duplicate search (section 5.3) covers atc's snapshot, which holds issues updated in the last 45 days.
- **Team findings**: a CAPTAIN reports "found Y outside my scope" → `SPLIT`.
- **PR reviews**: follow-up items in a review → `SPLIT`.
- **atc signals**: done but still open (`CLOSE`), no priority (`PRIORITIZE`), a body-only prerequisite (`LINK`), neglected ENROUTE (the DISPATCH `RELEASE` case).
- **Stage 4 network planning**: a goal broken down into tickets, as drafts only.

### 5.2 Ticket bodies

`NEW` and `SPLIT` use vocado's formats: the four boxes from `CLAUDE.md` (goal, allowed scope, forbidden changes, done criteria), or the `Codex Engineering Task` template for DB, migration, security or rights work. Such tickets always carry CAUTION, and CAUTION operations are never automatic (section 7).

### 5.3 Duplicates and limits

- Before any `NEW` or `SPLIT`, OCC searches open and recently closed issues and records what it found in the operation ("no duplicate: searched X, Y").
- At most 5 open drafts and 10 applied `NEW` / `SPLIT` per day (settings file). Past that, OCC stops drafting and reports.
- A `CLOSE` needs evidence OCC checked itself: a merged PR, a config read, a comment. "Looks done" is not enough.

## 6. linear-guard

The same pattern as `occ/send-guard.mjs`: a PreToolUse hook on OCC's Linear write tools (`mcp__*__save_issue`, `save_comment`, and the relation and label tools). It is fail-closed (`… || exit 2`).

A write passes only when all of these hold:

1. The SCHEDULE mode allows writes (section 7). In shadow, every Linear write is blocked.
2. The payload carries a SCHEDULE id. Issue bodies end with `— OCC S-0001` and comments start with `[OCC S-0001]`.
3. That operation is **approved** (or automatic under section 7) and not yet applied.
4. The payload is **exactly** the operation's payload, as fetched from atc (`GET /api/schedule/ops/:id`).
5. It touches only OCC's fields (section 4). Moving an issue to In Progress or In Review is always blocked.

Everything else is blocked with `SCHEDULE 쓰기 차단 — …`. As with send-guard, OCC never retries a blocked write by rewording it. It reports to the SUPERVISOR.

atc marks an operation APPLIED when the next Linear fetch shows the change (an issue with footer `S-0001`, the new priority, the closed state), the same way DISPATCH detects DEPARTED.

## 7. Flow and stages

```
S1 shadow    OCC drafts → atc SCHEDULE tab → SUPERVISOR marks "would approve / would reject (reason)"
             nothing is written to Linear; only the agreement rate is measured
S2 approval  SUPERVISOR approves → OCC: atcctl schedule release S-0001 → exact payload
             → Linear write (linear-guard) → atc: APPLIED on the next fetch
S3 auto      low-risk operations skip approval (list below); everything else stays as in S2
```

Operation states in S1 (as built in `server/schedule.ts`): `draft → (agreed | disagreed)`, with side branches `superseded` (a newer draft for the same FLIGHT and kind, or the situation changed: the FLIGHT left Todo or Backlog, or Linear already shows the change, e.g. someone set it by hand) and `expired` (3 days without a verdict). S2 is to add `approved → released → applied`, with `rejected` as a side branch.

Candidates for automatic operations in S3, each to be confirmed from S2 data:

- `CLOSE` as Done when the issue's PR is merged, every done criterion is checked and the evidence is linked
- `LINK` for a prerequisite quoted verbatim from the body
- `PRIORITIZE` for a `SPLIT` child that inherits its parent's priority

Never automatic: anything with CAUTION, `Canceled`, deleting anything, adding or removing `rating:SEC`, changes to another team's `tail:` while it is AIRBORNE.

## 8. Merging DISPATCH and President into OCC

| From | Moves to OCC as |
|---|---|
| DISPATCH session (`atc/dispatch/`) | The same work under `atc/occ/`: proposal review, HOLD, FLIGHT PLAN, READBACK. The DISPATCH tab, proposal ids (`D-xxxx`) and send-guard stay as they are |
| President: assign work | DISPATCH proposals. Until 2b, a person's direct assignment is recorded with `TAIL` so the planner can see it |
| President: verify team reports | **Flight following**. OCC checks the PR head, CI and review with read-only `gh` (`gh pr view`, `gh pr checks`, `gh pr diff`). The mechanical part becomes ATC's CLEARED TO LAND check (section 9) |
| President: keep Linear tidy | SCHEDULE operations |
| President: maintain rule files | A `NEW` ticket that a TEAM implements through a PR |
| President: judge PR reviews and scope | Stays with the SUPERVISOR. OCC can summarize, but does not decide |

OCC's guard is TOWER's Bash guard plus read-only `gh` subcommands (`guard.mjs --gh-read`). Edit and Write stay denied. `occ/mcp-guard.mjs` lets only read MCP tools through (names starting with get, list, search, read, query or fetch), so in S0 OCC cannot write to Linear or GitHub even though the connectors are loaded. In S2, linear-guard opens Linear writes for approved operations only.

The session reloads its manual: `/tick` starts with `atcctl manual check`, which compares the hash of `CLAUDE.md` and `/tick` with the last `atcctl manual ack` (stored under `~/.local/state/atc/manuals/`). If they changed, the session rereads them before doing anything else. TOWER's `/tick` does the same. That fixes the stale-manual incident from section 1.

**President retires** once all three hold: OCC has run S1 for a week, flight following covers every team report, and `TAIL` is in use. Until then President keeps assigning and records each assignment as a `tail:` label (by hand until OCC S2).

## 9. What ATC takes

- **CLEARED TO LAND**: a LANDING SEQUENCE entry is marked ready only when the PR's exact head has green required checks, a review on that head, no base drift and no LOS. This is the mechanical half of what President checks by hand today.
- **Flow management (stage 3)**: merge slots and ground stops when CI backs up, as in `docs/dispatch.md`.
- ATC keeps reading Linear only. It never drafts SCHEDULE operations.

## 10. What to add to atc

| Where | What |
|---|---|
| `server/schedule.ts` (new) | SCHEDULE log (`~/.local/state/atc/schedule.jsonl`, append-only), state transitions, APPLIED detection from the Linear fetch, daily limits |
| `server/sources/linear.ts` | Read labels (`tail:`, `type:`, `wake:`, `rating:`), recently closed issues (for duplicate search), and the `S-xxxx` footer |
| `server/dispatch.ts` | Respect `tail:TEAM_X` and the classification rules in [fleet.md](fleet.md) section 5 |
| API | `GET /api/schedule/brief`, `GET /api/schedule/ops/:id`, `POST /api/schedule/ops` (draft), `POST /api/schedule/ops/:id/{verdict,approve,reject,release}`, `POST /api/schedule/mode` |
| `atc/occ/` | Moved from `atc/dispatch/`: `CLAUDE.md` (operations manual), `/tick`, send-guard, **linear-guard**, a Bash guard with read-only `gh` |
| `controller/atcctl.mjs` | `schedule draft`, `schedule release`, `schedule brief` |
| UI | SCHEDULE tab: drafts with reason, payload preview and duplicate-search result; verdict and approve buttons; applied history |
| Records | `schedule.drafted / decided / released / applied` in the FLIGHT RECORDER; metrics: agreement rate, operations reverted by a person, tickets created per week |

## Turning on S2

S2 is built and sits behind the SCHEDULE `mode` (`~/.local/state/atc/schedule.json`, default `shadow`). Turning it on lets OCC write approved operations to Linear, so do it in this order:

1. Check the S2 gate in the SCHEDULE tab (20 or more shadow verdicts, 80% or more agreement).
2. Change the vocado `CLAUDE.md` rule "only leaders write to Linear" to "OCC and leaders write to Linear; OCC writes plan fields (through approved SCHEDULE operations), leaders write execution fields" (section 4). Confirm with the SUPERVISOR at that time.
3. Create the flat Linear labels `rating:SEC`, `rating:UI`, `rating:DATA`, `rating:DOCS` (the `type` and `wake` label groups and `tail:TEAM_X` already exist). A CLASSIFY or NEW call that names a missing label fails, and OCC reports it.
4. Press "S2 승인 운용 켜기" in the SCHEDULE tab (or `POST /api/schedule/mode {"mode":"approval"}`). OCC picks it up on its next pass.
5. To stop, switch back to shadow: linear-guard then blocks every Linear write, and released operations stay as they are.

How it runs: the SUPERVISOR approves (or rejects with a reason) → OCC runs `atcctl schedule release S-xxxx`, which records RELEASED and prints the exact Linear MCP calls (`save_issue`, plus a `save_comment` with the reason for CLASSIFY and PRIORITIZE) → OCC makes each call with the input unchanged; `occ/mcp-guard.mjs` (linear-guard) passes a Linear write only when the mode is approval and the tool and input match a released call exactly → on the next Linear read atc marks the operation APPLIED (the change is visible, or for NEW an issue with that title appeared). Approved or released operations that don't land within 3 days expire. Calls only touch plan fields: labels, priority, a new issue's title/body/project/relations, and a comment. Never state or assignee.

## 11. Criteria for moving on

| Transition | Criteria (proposed) |
|---|---|
| S0 (OCC session, DISPATCH merged, Linear read-only) | Can start right away |
| S0 → S1 | SCHEDULE log, tab and `atcctl schedule draft` exist |
| S1 → S2 | 20+ decided drafts, 80%+ agreement, 0 duplicates found after the fact. **Vocado `CLAUDE.md` changes "only leaders write to Linear" to "OCC and leaders write to Linear; OCC writes plan fields, leaders write execution fields"** |
| S2 → S3 | 2+ weeks in S2, almost no operations reverted by a person, no linear-guard block caused by a wrong payload |

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Ticket spam fills the backlog | Daily limits, mandatory duplicate search, shadow first to measure draft quality |
| A security ticket gets the wrong scope | vocado templates (allowed files, forbidden changes, invariants); CAUTION operations are never automatic |
| Closing an issue that isn't done | `CLOSE` needs checked evidence; automatic `CLOSE` only after a merged PR and checked done criteria |
| OCC creates work and then dispatches it to itself | The SUPERVISOR approves both steps; ATC, a separate session, judges the conflicts |
| OCC and a CAPTAIN write the same field | Field ownership (section 4), enforced by linear-guard |
| Linear API rate limits | Batched fetches, no API attachments, daily write limits |
| A stale operations manual | `/tick` rereads `CLAUDE.md` when its hash changes |

## 13. Implementation order

1. ✅ **S0**: create `atc/occ/` from `atc/dispatch/` (merge), add read-only `gh` to its guard, a read-only MCP guard, reload the manual on change. Still to do: tell President about the handover
2. ✅ TAIL ASSIGNMENT `tail:TEAM_X` in the planner, first shipped as `lane:TEAM_X` (fixes the VOC-196 double dispatch right away). Labels are read from the existing Linear query
3. ✅ **S1**: SCHEDULE log, API, `atcctl schedule`, SCHEDULE tab, shadow verdicts. First operations: `CLASSIFY` and `PRIORITIZE`
4. Flight following in `/tick` (read-only `gh`), CLEARED TO LAND checks in TOWER
5. ◐ **S2**: built behind `mode` (linear-guard, `schedule release`, APPLIED detection). Still to do when turning it on: the vocado `CLAUDE.md` rule change (confirmed with the SUPERVISOR at that time)
6. **S3**: automatic operations, only those that S2 data supports

## Decisions (2026-09-26, SUPERVISOR)

| Item | Decision |
|---|---|
| Structure | Two control sessions: OCC (operations) and ATC (traffic) |
| DISPATCH | **Merged into OCC**, not kept as a separate session |
| Linear writes | OCC may write to Linear from S2; the vocado "only leaders write to Linear" rule **may be changed** at S2 |
| Order | Design document first |

Still open: the exact S3 automatic list (after S2 data), and whether the TOWER session is renamed ATC or keeps its name.
