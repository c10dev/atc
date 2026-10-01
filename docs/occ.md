# OCC design (draft)

**English** · [한국어](occ.ko.md)

atc splits into two control sessions, the way aviation does:

- **OCC** (operations control center, the airline side) decides **what flies, who flies it and when**. It keeps the schedule (Linear tickets), dispatches FLIGHTs to teams and follows them until they land.
- **ATC** (air traffic control) keeps what is already flying **separated**. TOWER today, flow management (stage 3) later.

In real aviation the flight dispatcher belongs to the airline's OCC, not to ATC. So DISPATCH (stage 2) moves into OCC, and OCC takes over the work the "President" session does by hand today.

> Status: S0 built (2026-09-26): the `atc/occ/` session (DISPATCH merged in), read-only `gh`, a read-only MCP guard, manual reload, and TAIL ASSIGNMENT (`tail:TEAM_X`, see [fleet.md](fleet.md)) in the planner. S1 built: SCHEDULE drafts in shadow operation for `CLASSIFY`, `PRIORITIZE`, `NEW`, `CLOSE`, `TAIL` and `WAYPOINT` (`server/schedule.ts`, `atcctl schedule brief|draft`, the SCHEDULE tab, OCC rules). `NEW` is the CHARTER DESK: an AD HOC FLIGHT drafted from a CHARTER REQUEST, with body-section checks and a title-similarity duplicate search over the snapshot (issues updated in the last 45 days). `CLOSE` (section 5.5, built 2026-09-27) drafts closing a FLIGHT whose PR is merged; it is never released, and the SUPERVISOR closes the issue in Linear. At most 5 open drafts of any kind, and drafts expire after 3 days without a verdict. ATC's CLEARED TO LAND check (section 9) is built: the LANDING SEQUENCE now comes from open GitHub PRs. `TAIL` ("TAIL as built", built 2026-09-28 with ATC-68) drafts a `tail:TEAM_X` label for an assignment made outside DISPATCH. Other operations (`LINK`, `SPLIT`, `COMMENT`) and S3 are design only (Not built yet). S2 (approval operation: linear-guard, `schedule release`, APPLIED detection) is built behind `mode` and off by default — see "Turning on S2". Decisions are listed under "Decisions" at the end.

## 1. Current facts

A snapshot from 2026-09-26, before S0. What has changed since is in the status line above.

| Item | Today (2026-09-26) |
|---|---|
| Group head | A "President" session in `vocado_nextjs`, above TEAM_A … TEAM_F. It delegates work, verifies team reports against GitHub, Linear and the DB, reviews PRs and judges Codex findings, keeps Linear tidy, maintains rule files (`CLAUDE.md`, PR template), and routes merge, close and scope decisions to the user. It writes no product code and cannot merge |
| DISPATCH | A separate session (`atc/dispatch/`) in shadow operation (2a). It reviews proposals and adds notes, CAUTION and HOLDs. It does not write to Linear. Merged into OCC at S0; the folder is now `occ/` |
| TOWER | Stage 1 controller: LOSS OF SEPARATION, HANDOFF, LANDING SEQUENCE |
| Who writes Linear | Only team leaders (vocado `CLAUDE.md`: "only leaders write to Linear"). In practice President also creates, reprioritizes and closes issues |
| State changes | The GitHub integration moves issues through In Progress / In Review. A merge moves them to Done only when the PR body says `Fixes VOC-n`; after any other merge the issue stays open, which is what `CLOSE` (5.5) and `merged-not-done` (8.1) cover |

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
| Propose closing: a `CLOSE` draft with the evidence (merged PR). The **SUPERVISOR** moves the issue to Done in Linear, because vocado's OCC exception says OCC does not change state or assignee (section 5.5). Mark duplicates | |

Neither side attaches PR links through the Linear API (vocado rule: attachments hit the rate limit).

## 5. SCHEDULE operations

OCC never writes to Linear freely. It drafts **SCHEDULE operations**. Each one is a single change with an id (`S-0001`), a reason and the exact payload it will write.

| Operation | Meaning | Example (2026-09-26) |
|---|---|---|
| `NEW` | Create a ticket | Split the batch-processor race out of VOC-193 (became VOC-195) |
| `CLOSE` | ✅ Built (5.5): the FLIGHT's PR is merged (LOGBOOK ARRIVED) but the issue is still open. Approved drafts are closed by the SUPERVISOR in Linear, never released | VOC-56: the `protect main` ruleset already meets every done criterion |
| `PRIORITIZE` | Set or change priority | VOC-177, VOC-179, VOC-195 have no priority |
| `TAIL` | ✅ Built ("TAIL as built", ATC-68): add or change `tail:TEAM_X` (TAIL ASSIGNMENT) | VOC-196 → `tail:TEAM_E` (what President decided) |
| `CLASSIFY` | Set FLIGHT TYPE, WAKE CATEGORY and required TYPE RATING ([fleet.md](fleet.md) section 4) | VOC-195 → `type:MAINT`, `wake:M`, `rating:SEC` |
| `LINK` | Add a parent, `blocks` or `related` relation | VOC-196 blocked by VOC-52 (written only in the body) |
| `SPLIT` | Turn a finding into a child or related ticket | P3 items from the PR #400 review |
| `COMMENT` | Leave a plan comment (not execution) | "Deferred until VOC-52 lands" |
| `TARGET`, `ROUTE` | ✅ S1 built (ATC-25): change an AIRCRAFT's FLEET TARGETS or ROUTE, not Linear. Shadow verdicts only in both modes, counted apart from the gate ([fleet.md](fleet.md) 7.4) | TEAM_C remove `Home & Discovery` (completed) |

Built: `NEW` (CHARTER DESK, 5.1), `CLOSE` (5.5), `PRIORITIZE`, `CLASSIFY`, `TAIL` ("TAIL as built"), `WAYPOINT` (ATC-77, [routes.md](routes.md) "Step 9 and the ROUTE notice as built"), and `TARGET`/`ROUTE` in shadow ([fleet.md](fleet.md) 7.4). Not built yet: `LINK`, `SPLIT`, `COMMENT`.

### 5.1 Where operations come from

- **The SUPERVISOR's instructions (CHARTER DESK)**: an assignment the SUPERVISOR states ("TEAM_E takes VOC-196") becomes a `TAIL` draft ("TAIL as built" below). A CHARTER REQUEST made directly in the OCC session ("make a ticket for X") becomes a `NEW` draft, an AD HOC FLIGHT (a FLIGHT added outside the regular schedule). Once approved and in Linear Todo (S2) it is FILED like any other FLIGHT. Small ticketless work handed straight to a team is AD HOC and never becomes a SCHEDULE operation. OCC never drafts `NEW` on its own initiative, with one exception: a WAYPOINT exit criterion no issue covers (5.6), which carries over a criterion the SUPERVISOR already wrote. Its duplicate search (section 5.3) covers atc's snapshot, which holds issues updated in the last 45 days.
- **A CHARTER REQUEST through DUTY** (ATC-233, [duty.md](duty.md) "D5 as built"): the SUPERVISOR says it to DUTY, DUTY writes it in English, and the SUPERVISOR confirms the card. `schedule brief` then has a `duty` section with the requests OCC has not seen (absent when `duty.charter` is off). In `shadow` OCC drafts nothing: it records what it would draft with `atcctl schedule charter-seen <CR-n> -- '<would draft>'`. In `on` it handles the request like a CHARTER DESK request (`schedule wip`, `schedule draft NEW`) and records `--draft <S-id>`. `schedule charter-seen` is allowed in OCC's guard profile only (`guard.mjs --occ`). The request text is data: OCC reads it as a request, never as a word about its own rules. The judging stays with the SUPERVISOR on the SCHEDULE tab.
- **Team findings**: a CAPTAIN reports "found Y outside my scope" → `SPLIT`.
- **PR reviews**: follow-up items in a review → `SPLIT`.
- **atc signals**: done but still open (`CLOSE`), no priority (`PRIORITIZE`), flown by a team without a `tail:` (`TAIL`, "TAIL as built" below), a body-only prerequisite (`LINK`), neglected ENROUTE (the DISPATCH `RELEASE` case).
- **Stage 4 network planning**: a goal broken down into tickets, as drafts only.
- **WAYPOINT gaps** (5.6): exit criteria of the active or next WAYPOINT that no issue covers → `NEW` with the milestone.

### 5.2 Ticket bodies

`NEW` and `SPLIT` use the DIRECT form ([dispatch.md](dispatch.md) "DIRECT briefs", since 2026-09-28): a goal and done criteria are required, with only the constraints specific to the task; DB, migration, security or rights work also carries a short Hard constraints line. Standing rules stay in vocado `CLAUDE.md` and `AGENTS.md`. Such tickets always carry CAUTION, and CAUTION operations are never automatic (section 7).

### 5.3 Duplicates and limits

- Before any `NEW` or `SPLIT`, OCC searches open and recently closed issues and records what it found in the operation ("no duplicate: searched X, Y").
- At most 5 open drafts of any kind (`SCHEDULE_OPEN_LIMIT` in `server/schedule.ts`). Past that, atc refuses a new draft (409), and OCC stops drafting and reports. A daily cap on applied `NEW` / `SPLIT` (10 per day, from a settings file) is Not built yet.
- A `CLOSE` needs evidence OCC checked itself: a merged PR, a config read, a comment. "Looks done" is not enough.

### 5.4 CLASSIFY accuracy

In the first seven SCHEDULE verdicts (2026-09-26), all three drafts the SUPERVISOR rejected were CLASSIFY misreadings:
- **S-0001 (VOC-195), S-0004 (VOC-196):** FLIGHT TYPE `BUILD` where [fleet.md](fleet.md) 4.1 gives `MAINT`. One was a lock race fix, the other a CI and static gate, and neither changes product behavior.
- **S-0006 (VOC-181):** WAKE `M` where 4.2 gives `L`: two rules in one file, no new tests.

CROSSCHECK, which cited 4.1, had these right. OCC now works the same way (`occ/.claude/skills/tick/schedule.md` "CLASSIFY 전에"):

- **Read the criteria:** before any CLASSIFY in a pass, OCC reads `docs/fleet.md` 4.1–4.3. `occ/.claude/settings.json` adds `permissions.additionalDirectories: ["../docs"]` so a non-interactive session can Read it; without it the read was denied.
- **FLIGHT TYPE in a fixed order:** CHECK (the output is a verdict) → SURVEY (research or a plan, no code) → TEST (a throwaway spike) → FERRY (a mechanical move) → MAINT (product behavior unchanged: refactor, infra, CI, static gates, tests, invisible race and lock fixes) → BUILD, only when a feature, behavior or screen users see changes. A security surface or tests alone never make a FLIGHT BUILD.
- **WAKE by the real size of the change:** test files listed in the allowed scope don't mean new tests.
- **Section numbers in the reason**, per axis, e.g. `4.1 MAINT: … · 4.2 M: … · 4.3 SEC: …`.
- **Calibration examples:** `GET /api/schedule/brief` (and `atcctl schedule brief`) carries `examples`. These are up to 8 recent SUPERVISOR decisions, those with a reason first, built with the same `examplesOf` as CROSSCHECK: `{id, kind, flight, proposed, draft, verdict, reason}`.
  - `proposed` is the classification or priority OCC drafted, without a NEW body or similar-title list.
  - OCC reads them before drafting and does not repeat a mistake a rejection reason names.

Checked on a test server with synthetic data:
- **With no examples,** an OCC `/tick` drafted VOC-196 `MAINT · M · SEC`, VOC-195 `MAINT · M · SEC` and VOC-181 `BUILD · L · UI`. All three match the SUPERVISOR's verdicts, and each reason cites 4.1–4.3.
- **With the two synthetic rejections as examples,** it drafted VOC-192 as `BUILD` (its layout changes). So the examples didn't push it into over-correcting.

### 5.5 CLOSE (built 2026-09-27)

Linear clean-up used to be President's job. Now OCC drafts it, and the SCHEDULE gets a steady supply of drafts again. The rules:

- **Candidates** (`schedule brief` → `candidates.close`, details in `close`): FLIGHTs whose PR is in the LOGBOOK as ARRIVED, not reverted ([fleet.md](fleet.md) 7.1), while the Linear issue is not Done or Canceled. Oldest merge first; those with an open CLOSE draft are left out.
  - When a FLIGHT has several PRs, the one whose body says `Fixes VOC-n` is used, else the latest.
  - vocado's rule is that only `Fixes` ends an issue. A PR whose body says `Part of VOC-n` is left out of the candidates.
  - The PR body's link (`fixes`, `part-of`, `none`) is stored on new LOGBOOK lines (`link`). For older lines, atc reads the body once with a read-only `gh pr view --json body` and caches it. The candidate appears on the next brief.
- **Draft** (`atcctl schedule draft CLOSE <FLIGHT> -- <reason>`): atc fills the payload from the LOGBOOK: `{pr: {repo, number, url}, mergedAt, fixes?, partOf?}`.
  - The FLIGHT may be in any open state (In Progress and In Review are common), unlike CLASSIFY and PRIORITIZE.
  - The draft is refused if the issue is already closed, the FLIGHT has no ARRIVED line, or its PR was reverted.
  - A `Part of` PR can still be drafted (OCC may know the rest is done), but it shows as "Part of — 일부만", and CROSSCHECK is told to disagree.
  - The reason names the PR, the merge time and whether the body says `Fixes`. The open-draft limit (5) applies as for every kind.
- **Closing the draft** (`syncLines`):
  - The Linear issue becomes Done or Canceled → SUPERSEDED, or APPLIED if it had been released.
  - The PR is reverted → SUPERSEDED.
  - Three days without a decision → EXPIRED. For an approved CLOSE: "승인 뒤 3일 동안 Linear에서 닫히지 않음".
- **No release.** A CLOSE changes the issue's state, and vocado's OCC exception says OCC does not change state or assignee. So `callsOf` refuses it and `schedule release` answers 409 `CLOSE는 SUPERVISOR가 Linear에서 직접 — vocado 규칙상 OCC는 상태를 바꾸지 않음`. linear-guard therefore never sees a CLOSE call. Instead the SCHEDULE tab lists **approved** CLOSEs, and in shadow mode those marked "승인했을 것" in the last 7 days, under "LINEAR에서 직접 DONE" with the issue and PR links. The SUPERVISOR moves them to Done, and the next brief drops them.
- **Evidence comment: not built, on purpose.** Releasing only a `save_comment` (`[OCC S-xxxx] PR … 머지됨`) would stay inside OCC's plan fields. But the SUPERVISOR closes by hand right after, the PR is already linked through the GitHub integration, and a bot comment per closed issue adds noise. The recommendation is to leave it off unless the SUPERVISOR wants an audit trail on the issue itself; it would be a CALL list of one comment in `callsOf`.
- **Switch for later.** If vocado's rule changes to let OCC close issues, `callsOf` is the one place to change. It would return `save_issue {id, state: "Done"}` plus the evidence comment, and the refusal constant `CLOSE_RELEASE_WHY` would go. Nothing else (drafts, verdicts, linear-guard) needs to change.

### 5.6 WAYPOINT gaps (built 2026-09-27, ATC-8)

On 2026-09-27 VOC Todo had 6 FLIGHTs and none could be assigned, so the DISPATCH gate got no new proposals. The ROUTE MAP already knows each WAYPOINT's exit criteria and issues ([routes.md](routes.md)), so uncovered criteria become `NEW` drafts. They feed the SCHEDULE gate now, and DISPATCH once S2 creates them.

- **Data.** `schedule brief` has `waypointGaps` (`server/waypoint-gaps.ts`, pure `waypointGapsOf`): per ROUTE that is not completed or canceled, the active WAYPOINT and the next one, each with `criteria` (the numbered list under "Exit criteria"), `description` when there is no list, and the milestone's `issues` (key, title, state; canceled and duplicate left out) and `truncated`. ROUTEs without WAYPOINTs, or with every WAYPOINT passed, are left out, and so are milestones of teams outside `candidateTeams` (atc reads every team's milestones, but NEW creates its issue in the main team). `null` means the milestones couldn't be read.
- **Judgment stays with OCC.** The server doesn't match criteria to issues. Each pass OCC reads the gaps, decides which criteria no open or finished issue covers, skips criteria a person must decide ("SUPERVISOR decides", recruiting, interviews) and descriptions without a checkable end condition, and drafts at most **2 per pass**, the active WAYPOINT first (`occ/.claude/skills/tick/schedule.md` "WAYPOINT gap").
- **The draft.** `schedule draft NEW --gap --project <ROUTE> --milestone <WAYPOINT> …`, with a DIRECT body and the criterion quoted in `## 목표`. `milestone` is checked against that project's milestones (name or id) and shown in `changesOf` ("WAYPOINT Beta Ready"). `--gap` requires a milestone, and atc refuses the draft when `similarTickets` finds a similar FLIGHT, so the "no duplicate" rule holds even if OCC misses one. Gap drafts count toward the 5 open drafts.
- **S2.** The released `save_issue` call carries `milestone: <milestone id>`, so the issue lands on the WAYPOINT. linear-guard (`occ/mcp-guard.mjs`, unchanged) passes only that exact input; `occ/mcp-guard.test.mjs` checks that dropping the milestone, or passing its name or another id, is refused.
- CROSSCHECK marks these drafts like any SCHEDULE draft.

### 5.7 WAYPOINT ETAs and slip warnings (built 2026-09-27, ATC-24)

The ROUTE MAP already knows each WAYPOINT's ETA and whether it is late ([routes.md](routes.md) 5). This brings both to OCC and the SUPERVISOR.

- **Data.** `schedule brief` has `waypointEtas` (`server/waypoint-slips.ts`, pure `waypointEtasOf`): every WAYPOINT not yet passed, per ROUTE (ROUTE name order, ROUTE MAP order within), with `targetDate`, `progress`, `eta` (or `null` with `reason`), `remaining`, `cumulative` and `late`. It also has `slips`: one warning per late WAYPOINT (`slipOf`, the same condition as the ROUTE MAP's late mark), with `code`, `days` and a one-line `text`. Both are `null` when the milestones couldn't be read.
- **Codes.** `target-passed`: the target date is past and the WAYPOINT is not passed (`days` since the target). `eta-after-target`: the ETA is after the target date (`days` late). `linear-overdue`: Linear says overdue with no target date to compare. A past target is checked first.
- **Report once.** Like FLIGHT FOLLOWING, each warning has a `key` (`<milestone id>:<code>`) and `fresh` (not reported yet). In `/tick` step 5, OCC writes each fresh warning as one line in the OCC LOG, reports it to the SUPERVISOR and runs `atcctl schedule slip-ack` (`POST /api/schedule/slips/ack`). Reported keys live in `waypoint-slips.json`; a warning that clears is forgotten, so it is fresh again if it comes back. When `eta-after-target` becomes `target-passed`, the key changes and OCC reports it once more. OCC doesn't message teams or draft anything because of a slip.
- **Screen.** The SCHEDULE tab lists the warnings under **LATE WAYPOINTS** (code, ROUTE · WAYPOINT, target, ETA, days, and when OCC reported it), with a link to the ROUTE MAP.

### TAIL as built (ATC-68)

A `TAIL` operation sets a FLIGHT's `tail:TEAM_X` (TAIL ASSIGNMENT, [fleet.md](fleet.md)) to one AIRCRAFT, so an assignment made outside DISPATCH ends up as a label the planner respects.

- **Payload.** One REGISTRATION (`atcctl schedule draft TAIL <FLIGHT> <TEAM_X> -- <reason>`, pure `parseTail` in `server/schedule-tail.ts`). atc refuses the draft when the REGISTRATION doesn't match `teamPattern`, isn't in FLEET (`fleet.json`) or is RETIRED, when Linear has no `tail:TEAM_X` label (read-only label lookup, 10-minute cache, refetched once on a miss; the reason says ENGINEERING or the user creates it, OCC never does), or when the FLIGHT already has that `tail:`. Any FLIGHT that isn't closed qualifies, In Progress included, unlike `CLASSIFY` and `PRIORITIZE`.
- **Release.** One `save_issue` with `addLabels: ["tail:TEAM_X"]` and, when there is one, `removeLabels` with the other `tail:` labels, plus the usual `[OCC S-xxxx]` comment. The resulting label set is the current labels minus other `tail:` plus the new one (`tailLabelsOf`); every other label stays, the old `lane:` alias included. It never touches state or assignee. The call uses `addLabels`/`removeLabels` rather than `labels` (full replacement): atc's snapshot keeps at most 20 labels per issue and shows group labels as `type:BUILD` where Linear's name is `BUILD`, so rebuilding the full set could drop labels. APPLIED when the next fetch shows `tail:TEAM_X`; SUPERSEDED when the FLIGHT closes.
- **CAUTION.** Changing another team's `tail:` while that team is AIRBORNE, or while it holds the FLIGHT's STAND, puts `caution` in the payload (shown on the SCHEDULE card and printed by `atcctl`). Such an operation is never automatic (section 7).
- **Sources.** A SUPERVISOR instruction at the CHARTER DESK, and an atc signal: `schedule brief` lists `candidates.tail`, FLIGHTs not closed and without `tail:` that a team is flying, each with its `evidence`: `STAND` (the team holds the FLIGHT's STAND), `DEPARTURE LOG` (the last AIRCRAFT on a `departures.jsonl` line in the last 7 days) or `READBACK` (a DISPATCH ASSIGN accepted or departed, or a TOWER CLEARANCE read back). Only REGISTRATIONs that could be drafted appear, and FLIGHTs with an open `TAIL` operation are left out. atc never drafts from the signal; OCC reads it and decides (`occ/.claude/skills/tick/schedule.md`, "TAIL 전에").
- **Gate.** Verdicts on `TAIL` count toward the S2 gate like `CLASSIFY` and `PRIORITIZE`. ATFM's S3 candidates stay `CLASSIFY` only.
- **Section 8.** This is the `TAIL` operation that President's "assign work" row and "President retires" refer to. Their status wording is left for ENGINEERING to update after merge.

### WAYPOINT as built (ATC-77)

A `WAYPOINT` operation puts a FLIGHT that has no milestone on a WAYPOINT (Linear milestone) of its ROUTE, so it counts in the ROUTE MAP's WAYPOINT numbers and ETAs and gets DISPATCH's `waypoint` bonus ([routes.md](routes.md) step 9). atc never creates, renames or reorders milestones; setting an issue's milestone is an issue edit, like `NEW`'s `milestone`.

- **Payload.** The ROUTE and one milestone `{id, name}` (`atcctl schedule draft WAYPOINT <FLIGHT> <milestone name or id> -- <reason>`, pure `parseWaypoint` in `server/schedule-waypoint.ts`). atc refuses the draft when the FLIGHT is closed or has no project, when it already has a milestone, when the milestone is not of the FLIGHT's project or is passed (`done`), when the ROUTE has a milestone whose issue list was truncated (membership can't be told), or when the milestones couldn't be read. Any FLIGHT that isn't closed qualifies, In Progress included. Membership comes from the milestone side (routes.md principle 5): the issue query is unchanged.
- **Release.** One `save_issue {id, milestone: <milestone id>}` plus the usual `[OCC S-xxxx]` comment. No labels, state or assignee. linear-guard (`occ/mcp-guard.mjs`, unchanged) passes only that exact input; `occ/mcp-guard.test.mjs` checks that a name instead of the id, another FLIGHT, or an added state or assignee is refused.
- **Closing.** Checked against the milestones (10-minute cache), read only while a `WAYPOINT` operation is open. APPLIED when that milestone's issues show the FLIGHT after release (SUPERSEDED before release). SUPERSEDED when the FLIGHT closes, shows up on another milestone, the milestone disappears, or it is passed before release. When the milestones can't be read, only closing and the 3-day expiry apply.
- **Candidates.** `schedule brief` lists `candidates.waypoint`: per ROUTE with WAYPOINTs not yet passed, those WAYPOINTs (`id`, `name`, `state`, `targetDate`, `criteria`, or `description` when there is no numbered list) and the open FLIGHTs of candidate teams on none of the ROUTE's milestones (`flights`), leaving out FLIGHTs with an open `WAYPOINT` operation. ROUTEs whose WAYPOINTs are all passed, or with a truncated milestone, give none. `null` when the milestones couldn't be read. atc never drafts from the list; OCC reads the FLIGHT and drafts only when one WAYPOINT's exit criteria clearly cover it, at most 2 per pass (`occ/.claude/skills/tick/schedule.md` "WAYPOINT 전에").
- **ROUTEs without WAYPOINTs.** `schedule brief` has `routesWithoutWaypoints`: ROUTE MAP rows with open FLIGHTs (active, blocked, planned; parent issues left out) and no WAYPOINT at all, each with `open`, `fresh` and `reportedAt`, every Linear team read (like slips), `null` when the milestones couldn't be read. OCC reports each fresh ROUTE to the SUPERVISOR once and runs `atcctl schedule route-ack` (`POST /api/schedule/routes/ack`, `{keys?}` of ROUTE names). Reported ROUTEs live in `routes-without-waypoints.json`; a ROUTE that gets a WAYPOINT or runs out of open FLIGHTs is forgotten, so it is fresh again if it comes back. A ROUTE whose WAYPOINTs are all passed is not in this notice.
- **Screen.** The SCHEDULE tab shows `WAYPOINT` cards like `PRIORITIZE` (now: no WAYPOINT and the ROUTE; change: the WAYPOINT; manual hint: Milestone), a WAYPOINT candidate list, and ROUTES WITHOUT WAYPOINTS under LATE WAYPOINTS. Verdicts on `WAYPOINT` count toward the S2 gate; ATFM's S3 candidates stay `CLASSIFY` only.
- **Rollback.** An older atc reading `schedule.jsonl` does not skip `WAYPOINT` lines, the same as found for `TAIL`: its generic sync sees "nothing to change" for an unknown kind, so on its next brief it closes open `WAYPOINT` drafts as SUPERSEDED and marks released ones APPLIED, without writing to Linear. The new `routes-without-waypoints.json` is simply not read.

## 6. linear-guard

linear-guard is part of `occ/mcp-guard.mjs`, the PreToolUse hook on all of OCC's MCP tools (matcher `mcp__.*`, fail-closed `… || exit 2`). Read tools pass as in S0. linear-guard judges the two Linear write tools, `save_issue` and `save_comment`. Every other write tool (relations, labels, GitHub) is blocked as in S0.

A Linear write passes only when all of these hold:

1. The SCHEDULE mode is `approval` (S2, section 7). In shadow, every Linear write is blocked.
2. The tool and its input **exactly** match (key order aside) a call atc has released: `GET /api/schedule/released` lists the calls of operations in state `released`. A call drops off that list once its operation is APPLIED, superseded or expired.
3. That call has not passed before. Right before letting the write through, the guard claims it: `POST /api/schedule/released/claim {tool, input}` finds a matching released call that is not used yet and records a `use` line for it (the operation stays `released`). A second identical call is blocked with `… 이미 한 번 통과함`, so repeating a released `save_comment` or `save_issue` cannot post a comment or create an issue twice. `GET /api/schedule/released` shows `used` on each call.
4. atc answers within 3 seconds, both for the list and for the claim. If it can't be reached, or it does not record the claim, the write is blocked.

The guard checks nothing else. The rest follows from the fact that only atc builds released calls (`callsOf`, see "Turning on S2"): an issue body ends with `— OCC S-0001 · CHARTER REQUEST …` and a comment starts with `[OCC S-0001]`, and no call touches state or assignee, so moving an issue to In Progress or In Review can never match.

Everything else is blocked with `OCC MCP 차단 — …`. As with send-guard, OCC never retries a blocked write by rewording it. It reports to the SUPERVISOR.

A used call stays used: releasing the operation again returns the same calls with the same `used` marks, and nothing un-marks one. If the Linear write failed after the guard let it through, OCC reports it, and the SUPERVISOR makes the change in Linear by hand; atc still marks the operation APPLIED when the next fetch shows it (or it expires after 3 days).

atc marks a released operation APPLIED when the next Linear fetch shows the change: for `NEW`, an issue with the same title (normalized) created after the draft; for `CLASSIFY` and `PRIORITIZE`, the labels or priority as drafted; for `TAIL`, the drafted `tail:` label; for `CLOSE`, a Done or Canceled issue. If the change shows before the operation is released, it is SUPERSEDED instead.

## 7. Flow and stages

```
S1 shadow    OCC drafts → atc SCHEDULE tab → SUPERVISOR marks "would approve / would reject (reason)"
             nothing is written to Linear; only the agreement rate is measured
S2 approval  SUPERVISOR approves → OCC: atcctl schedule release S-0001 → exact payload
             → Linear write (linear-guard) → atc: APPLIED on the next fetch
S3 auto      low-risk operations skip approval (list below); everything else stays as in S2
```

Operation states in S1 (as built in `server/schedule.ts`): `draft → (agreed | disagreed)`, with side branches `superseded` (a newer draft for the same FLIGHT and kind, or the situation changed: the FLIGHT left Todo or Backlog, or Linear already shows the change, e.g. someone set it by hand) and `expired` (3 days without a verdict). S2 adds (built, behind `mode`) `approved → released → applied`, with `rejected` as a side branch; approved and released operations can also become `superseded` or `expired` (3 days without being released or applied).

Candidates for automatic operations in S3, each to be confirmed from S2 data:

- `CLOSE` as Done when the issue's PR is merged, every done criterion is checked and the evidence is linked. Only if vocado's rule changes to let OCC change state (5.5): until then a `CLOSE` is never released, so it can't be automatic
- `LINK` for a prerequisite quoted verbatim from the body
- `PRIORITIZE` for a `SPLIT` child that inherits its parent's priority

Never automatic: anything with CAUTION, `Canceled`, deleting anything, adding or removing `rating:SEC`, changes to another team's `tail:` while it is AIRBORNE.

## 8. Merging DISPATCH and President into OCC

| From | Moves to OCC as |
|---|---|
| DISPATCH session (`atc/dispatch/`) | The same work under `atc/occ/`: proposal review, HOLD, FLIGHT PLAN, READBACK. The DISPATCH tab, proposal ids (`D-xxxx`) and send-guard stay as they are |
| President: assign work | DISPATCH proposals. Until 2b, a person's direct assignment is recorded as a `tail:TEAM_X` label so the planner can see it. OCC drafts it as a SCHEDULE `TAIL` operation ("TAIL as built", ATC-68). Until S2 releases drafts, the label is still added by hand |
| President: verify team reports | **Flight following**. atc follows every assigned FLIGHT (`server/following.ts`, `GET /api/following`): DISPATCH ASSIGNs that are accepted, departed or recalling, plus In Progress FLIGHTs with a `tail:` label. It tracks the stages READBACK → DEPARTED → PR opened → CLEARED → ARRIVED (STAND-free FLIGHTs: READBACK → DEPARTED → ARRIVED, section 8.1), and flags delays (no next stage after 1.5× the WAKE expectation) and mismatches between Linear and the PR. Each pass, OCC runs `atcctl following`, reports only new issues and records them with `following ack`, so nothing is reported twice. It never messages teams. For a team report or a SUPERVISOR request, OCC still checks the PR head, CI and review with read-only `gh` (`gh pr view`, `gh pr checks`, `gh pr diff`). The mechanical landing check is ATC's CLEARED TO LAND (section 9) |
| President: keep Linear tidy | SCHEDULE operations |
| President: maintain rule files | A `NEW` ticket that a TEAM implements through a PR |
| President: judge PR reviews and scope | Stays with the SUPERVISOR. OCC can summarize, but does not decide |

OCC's guard is TOWER's Bash guard plus read-only `gh` subcommands (`guard.mjs --gh-read`). Edit and Write stay denied. `occ/mcp-guard.mjs` lets only read MCP tools through (names starting with get, list, search, read, query or fetch), so in S0 OCC cannot write to Linear or GitHub even though the connectors are loaded. In S2, linear-guard opens Linear writes for released calls of approved operations only (section 6).

The session reloads its manual: `/tick` starts with `atcctl manual check`, which compares the hash of `CLAUDE.md`, `/tick` and its procedure files (every Korean `*.md` in `.claude/skills/tick/`) with the last `atcctl manual ack` (stored under `~/.local/state/atc/manuals/`). If they changed, the session rereads them before doing anything else. TOWER's `/tick` does the same. OCC's `CLAUDE.md` holds only the core (role, prohibitions, always-used commands, review rules); each procedure (BRIEFING, FLIGHT PLAN, CREW CHANGE, SCHEDULE, flight following) is a file next to `/tick`, read only at the step that has work, so the always-loaded manual stays short (ATC-9). That fixes the stale-manual incident from section 1.

**President retires** once all three hold: OCC has run S1 for a week, flight following covers every team report, and the `TAIL` operation is in use (built with ATC-68; it writes labels once S2 is on). Until then President keeps assigning and records each assignment as a `tail:` label by hand.

### 8.1 Flight following in detail

| Stage | Source |
|---|---|
| READBACK | the proposal's `timeline.accepted` (none for `tail:` FLIGHTs) |
| DEPARTED | `timeline.departed`, else the first departure record (`departures.jsonl`) for the FLIGHT |
| PR opened | an open PR for the FLIGHT (`snapshot.pulls`), else the LOGBOOK entry (merge time minus landing wait) |
| CLEARED | the open PR's `readyAt` while it is CLEARED TO LAND |
| ARRIVED | the FLIGHT's LOGBOOK entry (not reverted) |

**STAND-free FLIGHTs** (SURVEY and CHECK: the proposal DEPARTED on READBACK, `departedVia: "readback"`) produce no PR. They skip the PR opened and CLEARED stages, so their stage bar is READBACK → DEPARTED → ARRIVED:

| Stage | Source |
|---|---|
| READBACK | the proposal's `timeline.accepted` |
| DEPARTED | the proposal's `timeline.departed` (the READBACK itself) |
| ARRIVED | the proposal's `arrived` status (`timeline.arrived`, with `arrivedNote` / `arrivedUrl`): the CAPTAIN's report, recorded by OCC with `atcctl dispatch arrived D-xxxx -- <result link or one line>` |

A `tail:` FLIGHT without a proposal counts as STAND-free when its FLIGHT TYPE is SURVEY or CHECK; then DEPARTED is the Linear start time and ARRIVED is Linear Done.

| Issue | When | Severity |
|---|---|---|
| `no-departure` | READBACK, no STAND and no departure after 1.5× the WAKE expectation (L 60, M 240 min, H 2 days, as in the LOGBOOK) | warn |
| `no-pr` | a STAND or departure, no PR after 1.5× | warn |
| `pr-not-cleared` | a PR, not CLEARED after 1.5×; the text lists its landing blocks | warn |
| `landing-wait` | CLEARED for more than 1 hour without landing; landing is the SUPERVISOR's call | info |
| `no-arrival` | STAND-free FLIGHTs only: DEPARTED, no ARRIVED after 1.5× the WAKE expectation | warn |
| `no-report` | the PR of a DISPATCH-sent FLIGHT merged (ON) more than 30 minutes ago, after reports began (2026-09-29T08:34Z), and no arrival report is recorded; gone 24 hours after ON (ATC-124, ATC-152, `dispatch report`) | info |
| `blocked-report` | a recorded arrival report has `BLOCKED` other than `none`; visible for a day | warn |
| `review-no-pr` | Linear says In Review but there is no PR | warn |
| `done-not-merged` | Linear says Done but there is no merged PR | warn |
| `merged-not-done` | the PR merged but Linear isn't Done; this is what a `CLOSE` draft handles | info |

- A recalling FLIGHT is not checked for delays, because it was told to stop.
- For STAND-free FLIGHTs, `no-departure`, `no-pr`, `pr-not-cleared` and `landing-wait` don't apply, and neither do the Linear/PR mismatches (`review-no-pr`, `done-not-merged`, `merged-not-done`). `no-arrival` is their only delay.
- A FLIGHT that has ARRIVED and is closed in Linear stays visible for a day, then drops off. A STAND-free FLIGHT stays visible for a day after its ARRIVED, like the others.
- `following-state.json` keeps the keys (`FLIGHT|code`) OCC has reported. An issue that clears is forgotten, so if it comes back it is reported again.

### 8.2 BRIEFING in the tick (ATC-4)

In step 3 of `/tick`, besides the review note, OCC writes a BRIEFING on every open or HELD proposal that has none: `atcctl dispatch briefing <D-xxxx> --what '…' --why '…' --risk '…'`, three plain Korean sentences (무슨 일, 왜 이 AIRCRAFT, 걸리는 점). It writes again when it sets or lifts a HOLD or rereads a changed body. The numbers (PRIORITY, wait days, ROUTE and WAYPOINT, prerequisites, recent FLIGHTs) come from the server in `briefs.<ID>.facts`; the BRIEFING explains them instead of repeating them. See docs/dispatch.md 5.5 for the card.

### 8.3 Delivery by ID as built (ATC-119)

OCC sends only the header; send-guard puts in the text atc stored. Since ATC-126 the stored FLIGHT PLAN, RECALL and CREW CHANGE texts are English (the headers `[DISPATCH D-xxxx]`, `[OCC CC-xxxx]` and the `READBACK …` replies are unchanged, so the guard's matching is unchanged); a text stored before that stays as it was stored. OCC never retypes a FLIGHT PLAN, RECALL or CREW CHANGE, so a typo can't turn into an instruction the team receives.

- **Header only:** `[DISPATCH D-xxxx]`, `[DISPATCH D-xxxx] RECALL` or `[OCC CC-xxxx]`, followed by nothing but whitespace. `atcctl dispatch release`, `dispatch recall-send` and `crew-change send` print it as the `SEND:` line under `SEND TO:`; the full text stays below `---` for the log.
- **Guard:** every check runs as before: approval mode, status (`sent`, `recalling` for a RECALL), recipient is that CAPTAIN (a CREW CHANGE: that AIRCRAFT, `[ref]` allowed), a stored text exists. The stored text must also start with the same header. Then the PreToolUse hook answers `permissionDecision: "allow"` with `updatedInput`: `message` (and the harness copy `content`) becomes the stored text, and `additionalContext` puts the delivered text into OCC's transcript.
- **Failed delivery (ATC-183):** if the `SendMessage` result is `success:false`, OCC runs `atcctl dispatch undelivered D-xxxx -- <the tool's message>` (sent goes back to approved), does not resend in the same tick and does not log "sent"; `dispatch release` also refuses with `AIRCRAFT 세션 없음 — 보내지 않음 (LAUNCH 필요)` when the AIRCRAFT has no live session. See [dispatch.md](dispatch.md) "Undelivered FLIGHT PLANs as built".
- **Unchanged paths:** the full text, exactly equal to the stored text, is allowed as before (no replacement). Anything else is blocked: a header plus other text, a wrong recipient or status, shadow mode, a missing record, atc unreachable. The hook command keeps `|| exit 2`.
- **Checked before building** (a throwaway sender and receiver under a temporary directory, not OCC or a team): Claude Code 2.1.284 applies `updatedInput` from a `SendMessage` PreToolUse hook. The receiver got the replaced text. The sender's own transcript keeps the original tool input, and the tool result echoes the original text, which is why the guard adds `additionalContext` with what was actually sent.
- Changed: `occ/send-guard.mjs` (`resolveSend`, `hookOutputOf`; `checkSend` keeps its meaning), `controller/atcctl.mjs` (`SEND:` line), the OCC manual and `/tick` files. Not changed: the stored text, how atc builds it, the DISPATCH and CREW CHANGE states, `controller/guard.mjs`, `occ/mcp-guard.mjs`.

## 9. What ATC takes

- **CLEARED TO LAND** (built): a LANDING SEQUENCE entry is marked ready only when the PR's exact head has green required checks, a passing review on that head (for Codex, a 👍 after the head: its COMMENTED review means findings), no base drift and no LOS. This is the mechanical half of what President checks by hand today. It catches CI that is green only on an older commit, a review left on an older commit, and drift from main.
- **GO AROUND** (built, ATC-128): when a PR in the LANDING SEQUENCE turns `dirty` or `behind`, or the PR ahead of it named in its LAND text merges, TOWER sends the holders of its STAND a `GO AROUND` CLEARANCE (W/U): merge origin/main, resolve, run the checks, push with `--force-with-lease`, or answer UNABLE. `server/go-around.ts` builds the text (which merge caused it, the files the two PRs share from the ATC-71 changed-file list, empty when unknown) and `landingQueue[].goAround` carries it with an `action` (`send`, `sent` for this head, or `supervisor` for no holder or a second GO AROUND within the hour). It is derived from state, so a server restart (`reset: true`) does not lose it. The events `landing.conflict` (once per PR head) and `landing.prevMerged` carry the cause. atc never resolves a conflict itself, and who merges is unchanged: MCC re-inspects the new head.
- **FIX** (built, ATC-270): when the current head of an APPROACH PR carries a `review-findings` block (MCC INSPECTION, the landing review, Codex, a carried review), TOWER sends the holders of its STAND a `FIX` CLEARANCE (W/U): fix on the same branch or say in the PR body why one stays, run the checks, push, or answer UNABLE. The blocks now carry their findings as data (`blocks[].findings`), `server/fix.ts` builds the text (P0 and P1 lines in full, P2 as a count plus the PR link, a `head <7>` marker) and `landingQueue[].fix` carries it with an `action` (`send`, `sent` for this head, `supervisor` for no holder or a third FIX within the hour). It is derived from state like GO AROUND, so a server restart does not lose it. Why: on 2026-10-01 the findings for a PR (MCC INSPECTION, seconds after TOWER's INFO) were emitted as an event, the server restarted for RTS before the next TOWER tick, and the `reset: true` pass sent no INFO, so the team waited. Findings also went out as an INFO (ROGER and wait) clipped to 400 characters; both are fixed. The APPROACH INFO is state-based now too (`landingQueue[].info`: sent only when an actionable block code is new, by the `[blocks: …]` code marker of the last INFO for the PR) and no longer carries the findings.
  - Why PR 194's INFO came late on 2026-09-29: it entered the LANDING SEQUENCE already `dirty` at 04:30:26, right after a server restart. The one `landing.requested` event reached a TOWER pass with `reset: true`, where the manual sends no APPROACH INFO, and no later event fired until a new blocking code appeared at 04:39:30. State-based `goAround` and `landing.conflict` on entry close that gap.
- **Flow management (stage 3)**: merge slots and ground stops when CI backs up, designed in [atfm.md](atfm.md) and partly built there (in shadow operation, see its status line).
- ATC keeps reading Linear only. It never drafts SCHEDULE operations.

### 9.1 CLEARED TO LAND as built (2026-09-26)

Source: `server/sources/github.ts` runs `gh pr list --repo <owner/name> --state open --limit 100 --json …` for every open AIRPORT whose git remote is on GitHub, every 90 seconds in the background (`execFile`, no shell). A failing repository keeps its last result and the error shows in the snapshot's `github` field; the snapshot never waits for `gh`. The verdict is a pure function (`server/landing.ts`, tests in `landing.test.ts`). Each PR is linked to a FLIGHT by `voc-(\d+)` in its branch name and to a STAND by the worktree checked out on its branch.

| Condition | Decision | Why |
|---|---|---|
| Checks | The head's `statusCheckRollup` must be non-empty and every check passed. NEUTRAL and SKIPPED pass; anything not completed is `checks-pending`; any other conclusion (and StatusContext FAILURE / ERROR) is `checks-failed`. A re-run check counts only in its latest run. **Every check is treated as required** | Knowing which checks are required takes a `gh pr checks --required` call per PR on every poll (vocado alone has about 20 open PRs). vocado's three checks (Database security contract, core-sync-check, Vercel) all matter before a merge anyway. Revisit if a repository adds optional checks that often fail |
| No checks | Blocks (`no-checks`) | CLEARED means mechanically verified; a PR with no checks has no evidence. It also covers the seconds after a push before checks register. Consequence: repositories without CI (atc itself today) never get CLEARED TO LAND, and the SUPERVISOR decides by hand as before |
| Review | A review whose `commit.oid` equals the head, in state APPROVED or COMMENTED, by someone other than the PR author and other than the Codex bot (`CODEX_BOTS` in `server/landing.ts`). **Or** a `+1` reaction on the PR by the Codex bot created at or after the head commit's committer date. A Codex review never passes: when the head has a Codex COMMENTED review, the PR is blocked (`review-findings`, "Codex 지적 있음(head sha7) — 반영 후 재리뷰 필요") until a Codex 👍 created after that review's `submittedAt` (and at or after the head's committer date), or a human (not Codex, not the author) APPROVED review on the head submitted after that review. A human APPROVED from before the findings, and a human COMMENTED, don't clear them. Only older commits reviewed: `review-stale` (older Codex reviews count here, so the text names that commit); none at all: `no-review`. When the Codex bot's latest PR comment after the head is its "usage limits" notice, the text says "Codex 한도 — 사람 리뷰 필요". | The author's own COMMENTED reviews are thread replies (empty body), not reviews. Codex leaves a COMMENTED review ("💡 Codex Review · Here are some automated review suggestions" with P1/P2 inline comments) only when it found problems (vocado 389, 393, 400); on a clean PR it leaves no review, only a 👍 (seen on merged PRs 377, 378, 393, 400, each 👍 a few minutes after the head commit). Counting its COMMENTED review as a pass made a PR CLEARED right when Codex had asked for fixes. A human APPROVED after the findings means a person has judged them (for example a false positive, or Codex out of its usage limits and unable to re-review). The reaction is not tied to a commit, so the committer date and the findings' `submittedAt` are the links: a 👍 kept from before a newer head or before the findings doesn't count. Limits: the committer date is not the push time, so a commit made before the 👍 but pushed after it would wrongly count; and if Codex ever kept its old 👍 instead of adding a new one after re-reviewing, the new head would show `no-review`. Other comments and reactions don't count. The reactions, the head's committer date and the Codex comments are fetched (`gh api`, read-only) only for non-Draft PRs without a passing head review or with Codex findings on the head that no later human APPROVED has cleared; the committer date is cached per sha, and a 👍 already seen to pass a head isn't fetched again (unless newer findings arrive on that head) |
| Changes requested | Blocks (`changes-requested`) when any reviewer's latest verdict (APPROVED / CHANGES_REQUESTED / DISMISSED, ignoring COMMENTED) is CHANGES_REQUESTED, on any commit, or `reviewDecision` says so | Matches how GitHub keeps a change request open until the reviewer approves or it is dismissed |
| Base drift | `mergeStateStatus` CLEAN, UNSTABLE and HAS_HOOKS pass. BEHIND (`behind`), DIRTY (`dirty`), BLOCKED (`blocked`) and UNKNOWN (`merge-unknown`, "GitHub이 아직 계산 중") block. DRAFT is left to the Draft condition | UNSTABLE means mergeable with checks that didn't pass, and the checks condition already names them. HAS_HOOKS is CLEAN plus server hooks. BEHIND only appears when the base branch requires branches to be up to date (vocado does) |
| Draft | Blocks (`draft`). Drafts are in `pulls` but **not in the LANDING SEQUENCE** (brief, events, sample) | A Draft hasn't asked to land; listing 15 vocado Drafts to the TOWER would only make noise |
| LOS | Blocks (`los`) when an open `conflict` alert is on the PR's STAND | Merging while two teams work in the same worktree is how commits get lost |

**Human COMMENTED reviews still pass**: a reviewer other than Codex and the author who leaves COMMENTED (not CHANGES_REQUESTED) on the head has chosen not to block, and only Codex uses COMMENTED to carry findings.

Order: CLEARED PRs by `readyAt`, the first time every condition held at that head (kept in memory, keyed by `repo#number@head`, so a new push starts over; a transient block at the same head keeps the original time), then APPROACH PRs by `createdAt`. The TOWER numbers `LAND` by that order (`seq`).

**Linear `Ready to Merge`**: dropped, together with the `ATC_LANDING_STATE` setting. vocado's Linear has no such state, the PR already carries everything the check needs, and keeping an unused setting would mislead. The FIDS still shows a Linear state named `Ready to Merge` as CLEARED TO LAND if a team adds one.

**Telling the CAPTAIN**: the TOWER sends `INFO`, not `REPORT`. The blocks are information for the CAPTAIN, who decides how to fix them; `REPORT` would ask for a status report back that the TOWER doesn't need, since atc sees the PR itself. To avoid repeats, atc emits `landing.blocked` only when a block the CAPTAIN has to act on appears (`checks-pending`, `merge-unknown` and `los` don't count: the first two resolve by waiting, LOS has its own alert), and the TOWER sends at most one `INFO` per such event, and none after a server restart.

### 9.2 Landing review when Codex is unavailable (ATC-7, 2026-09-27; reviewer and exclusions changed by ATC-27)

On 2026-09-27, 17 vocado PRs (#366–#399) sat at APPROACH for 26–49 hours with CI green, because Codex answered "You have reached your Codex usage limits". ATC-7 let a CROSSCHECK (Muse) review stand in for Codex. Its exclusion rule read only Linear labels, and VOC FLIGHTs carry almost none (S1 doesn't write them), so seven security diffs went to Muse (#382, #388, #391, #395–#398) and four of them (#391, #396, #397, #398) became CLEARED on the Muse pass alone. ATC-27 fixed that: the SUPERVISOR moved landing reviews to a separate session on **DeepSeek V4.1 Flash** and made the exclusion look at the diff and the text, not just labels.

- **CODEX UNAVAILABLE** (`codexUnavailableOf`, `server/landing.ts`): a PR whose current head has no Codex review (no Codex findings, no Codex 👍 after the head) and no passing human review, and either the Codex bot posted a usage-limit comment after the head (`why: "limit"`), or no Codex signal arrived for `ATC_CODEX_SILENT_HOURS` (default 6) after the head commit or the PR's creation, whichever is later (`why: "silent"`). A Codex comment that is not about the limit resets the wait. Drafts are not read for Codex signals, so they never qualify. The PR carries `codexUnavailable` and `extReview` (`excluded`, `waiting`, `pass`, `findings`); the TOWER brief's `landingQueue` has `codex`, `extReview` and `review` (the reviewer, e.g. `"DEEPSEEK"`, when a landing review cleared it).
- **The reviewer** is the REVIEW session in [`review/`](../review/README.md) (until 2026-09-29 tmux `atc-review`, `ocx claude` on `claude-ocx-opencode-go--deepseek-v4.1-flash`; now Claude Sonnet, 9.9), separate from CROSSCHECK, which keeps Muse for DISPATCH and SCHEDULE marks so per-family figures stay clean. Its guard mode `controller/guard.mjs --review` allows only `atcctl manual`, `landing queue` and `landing review`, with the transcript real-model check limited to DeepSeek V4.1 Flash names (`REVIEW_MODELS`); `--crosscheck` no longer allows any `landing` command. The server also refuses a review whose model is not DeepSeek V4.1 Flash (`LANDING_REVIEW_MODELS`). Older Muse records in `landing-reviews.jsonl` stay as they are.
- **Never sent to an external reviewer** (`externalExclusionOf`): vocado forbids outside models for confidential work because request data is used for training. A PR is excluded when **any** of these holds, even with no labels:
  - it has no FLIGHT key ("FLIGHT 없음": no code goes out unless a FLIGHT asked for it);
  - the FLIGHT has `rating:SEC`, or the FLIGHT or PR has `Risk: Security`/`Risk/Security`/`Security`, `Risk: Rights`/`Rights` or `Risk: Contract`/`Contract`;
  - a changed path is under `supabase/migrations/` or `supabase/functions/`, is a `*.sql`, is auth, session or admission code (`auth`, `oauth`, `authentication…`, `authoriz…`, `session(s)`, `admission` as a path segment), RLS or policy code, `middleware`, or `.env*`, secret, key or credential paths (`securityPathOf`);
  - the PR title or body, or the FLIGHT title (and, before a packet is handed out, the FLIGHT description) contains security, privilege(s), RLS, grant, revoke, definer, admission, auth, authentication, authorization, ACL, exposure/exposed, "use server", or `EXECUTE` in capitals (`securityWordOf`).

  atc reads PR bodies with the PR list and the changed paths (`gh api …/pulls/N/files`, cached per head) for every PR with no Codex review on its head, and checks again against the real diff and the FLIGHT description before giving out a packet (403 when excluded, 409 when the FLIGHT can't be read). The strip shows the reason: "외부 리뷰 제외 — migrations", "— 키워드 revoke" and so on, and the block reads "Codex 한도 — 외부 리뷰 제외(migrations) — Codex나 SUPERVISOR 리뷰 필요".
- **Review packet**: `GET /api/landing/review/:repo/:pr` (`:repo` is the repository name or `owner/name`) returns the PR title and body (8,000 characters), the FLIGHT's acceptance criteria and forbidden changes (the Linear sections headed 완료 기준/Acceptance/Exit criteria/Done when and 금지/Forbidden/Do not/Out of scope, plus the description up to 6,000 characters), the head SHA, the changed files and the diff (80,000 characters, cut at a line with `diffTruncated`), read with read-only `gh pr view`/`gh pr diff`. It answers 403 for an excluded PR and 409 for a draft, a PR that Codex can review, a changed head or an unreadable FLIGHT. `GET /api/landing/reviews` lists `pending`, `excluded` (with reasons) and recent reviews (`atcctl landing queue`).
- **Review record**: `POST /api/landing/review/:repo/:pr {head, verdict, text, model}` appends to `landing-reviews.jsonl` (`at, repo, number, head, verdict, text, by, model, family, p0, p1, p2`). The head must be the current one (a 7+ character prefix is fine). `pass` may carry P2 but no P0 or P1; `findings` needs at least one P0/P1/P2. The model is required and must be DeepSeek V4.1 Flash; the REVIEW guard reads it from the session transcript and adds it as `ATC_REVIEW_MODEL`, and the family comes from `modelFamily`.
- **Landing rule** (`reviewBlocks`): for a CODEX UNAVAILABLE PR that is **not excluded**, a `pass` on the current head with no P0/P1 counts as the head review, so the PR can be CLEARED TO LAND; the strip shows "REVIEW: DEEPSEEK (Codex 한도)" (or "Codex 무응답"; the name is the record's family). On an excluded PR no external pass counts, whatever the records hold: the PRs that were CLEARED on a Muse pass went back to APPROACH. A `findings` becomes a `review-findings` block with the severities and the review ("DEEPSEEK 지적(Codex 한도, head abc1234, P0 0 · P1 1 · P2 0): …"), which TOWER passes to the CAPTAIN like Codex findings. A new head needs a new review. When Codex comes back and reviews the head (👍 or findings), Codex wins. `changes-requested` still blocks.
- Guards and settings changed, so these PRs were `user` tier.

### Codex limit across heads as built (ATC-312)

A Codex usage-limit notice used to count only for the PR it was posted on and only after that PR's current head, so a head pushed after the notice (or a notice on another PR) waited the 6 silent hours even though Codex was known to be out. Now a repository-level signal decides it.

- **Rule** (`codexUnavailableOf`, `repoCodexOf`, pure, `server/landing.ts`). For a PR whose head has no Codex review, no Codex 👍, no findings and no passing human review, and that has no Codex comment after its head: Codex counts as limited when the latest limit notice in the repository (the last Codex comment of any open PR, with "usage limits") is within `ATC_CODEX_LIMIT_HOURS` (default 6, `server/config.ts`) before now, and Codex has posted no real signal in the repository after it (a Codex review, findings, a 👍 or a non-limit comment on any open PR). The notice may come before the head. The result is `{why: "limit", since: <notice time>, scope: "repo"}`. No new `why` value: AUTOLAND (`codexLimited`) and the REVIEW queue already read `why: "limit"`, so a repository-limited head is requested from REVIEW instead of Codex, as before for a same-PR notice. Once a landing review (REVIEW) exists for the current head, the PR stays limited even after the window ends or Codex posts on another PR (the review is the head's review, so a CLEARED PR must not fall back to APPROACH); only the PR's own Codex review, 👍 or comment, or a human review, ends it. The 6 h `silent` rule stays as the fallback when no recent notice exists.
- **No new GitHub call.** The notice and signal times come from what `attachCodex` already reads (`codex.lastComment`, `codex.thumbsAt`, the PRs' `reviews`). A PR whose Codex signal is not read (Draft, or a head that already has a review) contributes nothing, which can only keep a limit in force a little longer, never invent one.
- **Unchanged.** The external-review exclusions (no FLIGHT, rating:SEC / Risk, secret paths, the security switch) still win: such a PR stays `extReview: excluded` and goes to the SUPERVISOR. Review carry (ATC-31) and AUTOLAND's re-review request (ATC-38) are untouched; REVIEW and its guards are unchanged.
- **Visible.** The strip and the block text say "Codex 한도(저장소, 06:29Z~)"; the TOWER brief's `landingQueue[].codex` carries `scope: "repo"`, `since` and a `label` ("Codex limit (repository, 06:29Z~)").
- **Not built:** a limit notice older than the window is ignored; there is no per-repository switch.

### 9.3 Codex finding severity: P3-only heads don't block (2026-09-27, ATC-28)

vocado #394 went through fix → `@codex review` → a new, smaller finding (P2, then P3) → fix → … Codex finds something a little smaller each round, and the landing rule treated any Codex COMMENTED review on the head as `review-findings`. The SUPERVISOR decided that P3-only findings don't block landing.

- **Severity** (`findingSeverityOf`, `codexHeadFindingsOf`, `server/landing.ts`): Codex's inline findings carry a badge (`![P2 Badge](https://img.shields.io/badge/P2-yellow…)`). atc reads it from the first comment of each review thread whose Codex comment was made on the current head (`originalCommit` = head). A finding without a readable badge counts as P2. Findings on earlier commits don't count.
- **Landing rule** (`reviewBlocks`): when every head finding is P3 and each P3 thread is resolved or answered by someone other than Codex, the Codex head review counts as the review and `review-findings` does not block. Any P0, P1 or P2 blocks as before, with the counts: "Codex 지적 있음(head b1c684c, P2 1 · P3 1) — 반영 후 재리뷰 필요". An open P3 (neither resolved nor answered) blocks with "Codex P3 지적 2건 중 1건이 해결·답글 없음 … — 스레드를 resolve하거나 답글을 달면 P3는 착륙을 막지 않음". A head review with no inline findings, or threads atc couldn't read, blocks as before. A later Codex 👍 or a human APPROVED still clears.
- **Threads**: atc reads review threads (`gh api graphql`, `reviewThreads`, read-only, every poll, not cached) for non-draft PRs with Codex findings on the head and for BLOCKED PRs.
- **BLOCKED reason**: vocado's protection rule "review threads must be resolved" still applies on GitHub. A BLOCKED PR with unresolved threads shows "GitHub 보호 규칙이 머지를 막음 — 해결 안 된 리뷰 스레드 N개(스레드 해결 필수: resolve해야 머지된다)". #394 (a P2 and a P3 open on the head) is this case.
- **Shown**: `PullRequest.codexFindings` and `landingQueue[].codexFindings` (`p0`–`p3`, `unmarked`, `open`, `ok`). The strip shows "Codex P3 2건(해결됨) — 착륙 막지 않음", and the LAND text ends with "Codex P3 findings left: 2 (resolved or answered; they do not block landing)."

### 9.4 Stacked PRs and stranded merges (2026-09-27, ATC-29)

The vocado VOC-189/190 stack (#395 → main ← #396 ← #397 ← #398, each based on the branch below) was squash-merged bottom-up at 14:41, each PR into the branch below it. #396's squash commit reached #395's branch; #397's and #398's stayed on intermediate branches that #395 does not carry. GitHub showed them MERGED and Linear marked VOC-190 Done, but the security fix was not on main. atc had shown #396–#398 as CLEARED although their base was not main.

- **STACKED** (`stackOf`, `stackedText`, `server/landing.ts`): a PR whose base is not the repository's default branch (read once per repository, `defaultByRepo`) gets a `stacked` block and is never CLEARED. The text names what must land first and the chain: "쌓인 PR — #395가 먼저 main에 들어간 뒤 base를 main으로 바꿈 (#395 → #396 → #397 → #398)". The chain follows open PRs down through their base branches and up through PRs based on their heads (the lowest-numbered one when it branches), and is on `PullRequest.stack` and `landingQueue[].stack` (`stacked: true`). If the base branch has no open PR, the text asks to change the base. When the default branch is unknown, no PR is marked stacked. The strip shows `STACKED #395 → #396 → …`. The PR stays APPROACH for everyone else, so TOWER never issues LAND for it.
- **STRANDED** (`strandedOf`, `firstReach`, `strandedMessage`; `server/sources/github.ts`): each poll atc lists PRs merged in the last 14 days into a non-default branch (`gh pr list --state merged`, all bases). For those with a FLIGHT key (branch, title or `Fixes`/`Closes`/`Resolves` in the body) it checks, read-only with `gh api …/compare/<target>...<commit>`, whether the merge commit or the head is an ancestor of the default branch or of the head of an open PR into it (the PR whose head is the merged PR's base is checked first). Results between fixed SHAs are cached. If neither reaches, an alert of kind `stranded` is raised: "STRANDED — #398(VOC-190)이 main에 닿지 않음 — … (Linear는 Done)". It stays while Linear says Done and clears only when the commit reaches main or an open PR into it. A check that fails raises nothing. The TOWER brief lists them in `open.stranded`, and FLIGHT FOLLOWING adds a `stranded` issue (warn) to that FLIGHT even when it is already Done.

### STRANDED: a merge carried to main by a squash-merged PR (ATC-216)

A stack P1 (base `main`) ← P2 ← P3 ← P4 can be squash-merged bottom-up, each into the branch below it. P3 and P4 then really are stranded for a moment. When the working session merges their commits into P1's branch, atc stops reporting them while P1 is open (P1's head is a target). Once P1 was **squash-merged** into `main`, neither target held the commits any more (`main` has only the squash commit, P1 is no longer open), so STRANDED came back and stayed until the 14-day window ended.

- **A third target** (`reachTargetsOf`, `server/landing.ts`): after the default branch and the open PRs into it, the head (`headRefOid`) of a PR **merged into the default branch at or after this PR's `mergedAt`**. A squash merge of a head that contains the commit carries the change. These rows are already in the same `gh pr list --state merged --limit 60` call, so there is no extra listing. Ordering: the PR whose `headRefName` equals this PR's base branch first (as for open PRs), then the nearest merge first, at most `MERGED_TARGET_MAX` (20) targets to bound the `compare` calls. The label is `#N (merged)`.
- A PR merged **before** this PR is not a target (its head cannot contain a later commit). Targets are SHAs, so the existing `containsCache` keeps working. A `compare` that fails still raises no STRANDED, as before. A merge no carrier reached is still STRANDED; the alert text and level are unchanged. Read-only GitHub API only (`gh pr list`, `compare`).
- `compare/<main>...<merged head SHA>` answers by SHA (checked read only on a merged PR's head: `behind` when main contains it); the SHA stays reachable through `refs/pull/N/head` after the branch is deleted, but that case could not be checked on a deleted branch.

### 9.5 Security PRs to the DeepSeek reviewer, behind a switch (2026-09-27, ATC-30)

Codex hit its 5-hour limit and left vocado #392 (admission keyword) and #395 (SQL paths) with no reviewer, because ATC-27 excludes security PRs from every external reviewer. The SUPERVISOR decided the DeepSeek V4.1 Flash reviewer may take them, accepting that vocado security diffs from a private repo go to DeepSeek.

- **Switch**: `dispatch.json` `externalReview.security`, `"exclude"` (default; unknown values count as exclude) or `"deepseek"`. It is edited on the settings window's AUTOMATION tab (REVIEW row) with the warning "보안 PR diff와 Linear 이슈 본문이 DeepSeek로 나감"; `PUT /api/settings {reviewSecurity}` writes it atomically.
- **Two kinds of exclusion** (`externalGateOf`): **hard**, in every mode: no FLIGHT, `.env*`, secret, key or credential paths (checked first); **security**: rating:SEC or Risk labels, security paths, security keywords. With `"deepseek"`, a PR excluded only by the security rules goes to the REVIEW queue; its `extReview.security` keeps the reason, the waiting text says "보안 PR: …", the strip shows "REVIEW: DEEPSEEK (보안, Codex 한도)", findings read "DEEPSEEK 지적(보안, …)", the packet carries `security` and a stricter guide, and the record gets `security: true`. A DeepSeek pass on the current head then counts as landing evidence like any other.
- Muse is still never used for landing reviews (the server accepts only DeepSeek V4.1 Flash), and the guards are unchanged. The REVIEW manual says how to review a security PR (permissions, RLS, authentication, migration rollback, leaks; unsure → P1).

### 9.6 Reviews carry across main-only merges (2026-09-27, ATC-31)

vocado's `main` ruleset requires branches to be up to date (`strict`), so every merge puts the other open PRs `behind`. The team merges `origin/main` into its branch, the head moves, and the review atc had turned into `review-stale`. On 2026-09-27 #394 had a DeepSeek pass at 18700c1; c12b706 was only a main merge with the same change, and it still waited 1.5 hours for a new review. The SUPERVISOR decided to keep `strict` and let atc carry a review across main-only merges.

- **Candidates** (`mergeOnlyChain`, `sameChange`; `server/sources/github.ts` `carryCandidates`): for a non-draft PR with no review on its head, atc walks back from the head through the PR's commits (`gh api …/pulls/N/commits`, cached per head) while each commit is a merge whose other parents are already in the default branch (`compare` against the current main SHA), collecting the first parents as candidates `R`. A candidate counts only if the PR's own change is the same at `R` and at the head: `compare(main...R)` and `compare(main...head)` list the same files with the same status and blob SHA (300 files or a failed read → no carry). A main merge that resolved a conflict inside a PR file changes a blob, so it needs a new review. All reads are read-only; `strict` and GitHub settings are unchanged.
- **What carries** (`carriedReviewOf`, latest `R` first): a human `APPROVED` on `R`; a Codex 👍 posted after `R` was committed; a DeepSeek landing-review record on `R` (only if the PR is not excluded from external review; Muse records don't carry). Findings carry as findings: a Codex COMMENTED review on `R` not cleared by a later 👍, or a DeepSeek `findings` on `R`, becomes `review-findings` on the head ("Codex 지적이 이전 커밋 18700c1에 남아 있음(그 뒤 main 병합만) — 반영 후 재리뷰 필요").
- **Effects**: a carried pass clears the review condition, so the PR is CLEARED as soon as CI and the base are fine. It doesn't enter the REVIEW queue (no `extReview`), so DeepSeek doesn't spend a run on it. `PullRequest.carried` / `landingQueue[].carried` (`from`, `by`, `findings`); the strip shows "REVIEW: DEEPSEEK (carried from 18700c1, main merge only)"; the `landing.cleared` event records `carriedFrom`.

### 9.7 AUTOLAND: update CLEARED-but-behind PRs, merge a delegated class (2026-09-28, ATC-34)

With `strict` on vocado's `main`, every merge puts the other open PRs `behind`, and the SUPERVISOR repeated Update branch → wait for CI → merge for each PR. Since ATC-31 a main-only update keeps its review, so the wait is pure mechanics. AUTOLAND does it behind one switch.

- **Switch**: `autoland.json` `mode`: `"off"` (default; unknown values count as off), `"update"` or `"merge"`. Only the SUPERVISOR changes it: the settings window's AUTOMATION tab (AUTOLAND row, a one-line warning per mode) or `PUT /api/settings {autolandMode}`. The server takes it only from this screen (a JSON request with a localhost `Origin`); the control sessions' CLI (`atcctl`) has no AUTOLAND command and sends no `Origin`, and their guards block `curl`. The file also holds `airports` (default `["VCDO"]`; atc's own landing is out of scope), `mergeMethod` (default `squash`), `applicationCheck` (default `Application Check`) and the SUPERVISOR's `holds`.
- **One cycle per GitHub read** (every 90 s, `server/autoland-run.ts`), per AIRPORT in the list, one action at most (pure `planAutoland`):
  1. GROUND STOP → nothing.
  2. An update in flight → wait until its new head's CI finishes (CLEARED, blocked, closed; 10 min without a new head or 90 min of CI → give up and move on).
  3. `merge`: the first CLEARED PR in LANDING SEQUENCE order that is delegated → merge it.
  4. A CLEARED PR that is not on HOLD is waiting for the SUPERVISOR's merge → wait. Updating another PR now would put it `behind` again after that merge. HOLD frees the runway.
  5. The first PR in LANDING SEQUENCE order whose only block is `behind` → update it.
- **update**: `PUT /repos/{o}/{r}/pulls/{n}/update-branch` with `expected_head_sha` (a normal merge commit, not a force-push). The PR returns to CLEARED once CI passes, because ATC-31 carries the review. Draft, stacked, `dirty` and LOS PRs are never touched. A rejected update (the head moved) is skipped for that head and retried on the next cycle with the new head; other failures skip that head until it changes.
- **merge**: the delegated class is every CLEARED PR not excluded by `mergeExclusionOf`: SUPERVISOR HOLD (the HOLD button on the landing strip); no FLIGHT; `rating:SEC` or any `Risk…` label (ticket or PR); changed files not read (atc reads them for all non-draft PRs while in `merge`); the ATC-27 security gate (`.env`/secret/key paths, migrations, SQL, auth, session, admission, RLS/policy, middleware, security keywords); a PR that waits on a HUMAN CHECK, or whose `## UI change` block is missing or its class unfilled (9.8, ATC-37; this replaced the old Human Preview gate check). Right before merging, atc re-reads the PR (`gh pr view`) and checks the head and every exclusion again. The merge is `PUT /repos/{o}/{r}/pulls/{n}/merge` with `sha` = the planned head (the REST form of `--match-head-commit`) and `merge_method`. GitHub auto-merge is never set. An excluded CLEARED PR stays with the SUPERVISOR and, unless on HOLD, holds the runway.
- **GROUND STOP**: when the check named `applicationCheck` fails on the default branch's head of an AIRPORT in the list, AUTOLAND stops both modes there and stays stopped, even after main turns green, until the SUPERVISOR clears it (settings window, or `POST /api/autoland/groundstop/clear {airport}`). A cleared SHA doesn't stop it again; a new red SHA does. It is latched even while the switch is off, so turning AUTOLAND on shows it first.
- **Records**: `autoland.jsonl` (append-only): `update`, `merge`, `settle`, `skip`, `groundstop`, `groundstop-clear`, `mode`, `hold`, `unhold`, each with the mode, AIRPORT, PR, head, result and detail. State (in flight, GROUND STOPs, cleared SHAs, skipped and merged heads) is `autoland-state.json`. `GET /api/autoland` shows config, state, the plan and the last 50 records.
- **Screen**: the LANDING SEQUENCE header shows one line per AIRPORT ("AUTOLAND: updating #383", "AUTOLAND: waiting — #383 CLEARED, …", "AUTOLAND: GROUND STOP — …"); each PR shows what AUTOLAND will do or why not ("AUTOLAND update 대기 2번째", "AUTOLAND 제외 — DIRTY(충돌)", "AUTOLAND 대기 — 리뷰 없음 먼저", "SUPERVISOR 머지 — rating:SEC") and a HOLD button.
- **Turning on**: the SUPERVISOR decided on 2026-09-28 to turn `update` on once this ships. `merge` is built but stays off: vocado `AGENTS.md` says "Human merge is the final gate", so the SUPERVISOR first adds an AUTOLAND exception there, like the VOC-141 one.
- **Re-review after an update (ATC-38)**: on 2026-09-28 AUTOLAND updated #401 to 36f36a0. The review correctly did not carry, because #403 had changed two of #401's files on main. Codex never reviewed the merge commit, and the REVIEW hand-over waits for 6 h of Codex silence, so TEAM_D posted `@codex review` by hand. Now, when an update settles and the new head has `no-review` or `review-stale`, atc asks once for that head (`reviewRequestOf`):
  - **Codex available** (no limit comment at or after the head): one PR comment `@codex review`. This is AUTOLAND's only other GitHub write.
  - **Codex limited, or no Codex answer within 30 min** (`escalateOf`): the head goes to the REVIEW (DeepSeek) queue right away (`buildPulls` `fastTrack`, `codexUnavailable.why = "autoland"`, "AUTOLAND 재리뷰 — Codex 30분 무응답"), unless Codex has already answered after the head.
  - ATC-27/30 still decide: `buildPulls` re-checks the external-review exclusion with the current switch. An excluded PR is not queued, and the strip says "AUTOLAND: SUPERVISOR 리뷰 필요 — 외부 리뷰 제외(migrations)".
  - One request per head (`autoland-state.json` `reviewRequests`), recorded as `op: "review-request"` with `via` (`codex`, `deepseek` or `supervisor`). The strip shows "AUTOLAND: review requested (codex|deepseek)" until a review lands. Only while AUTOLAND is `update` or `merge` and the AIRPORT is not in GROUND STOP.

### 9.8 HUMAN CHECK: only CHOICE, ACCOUNT and DEVICE PRs wait on a person (2026-09-28, ATC-37)

After the ATC-39 research ([research/human-preview.md](research/human-preview.md)), a person is required only for three classes of UI PR. The application repository's PR body carries a short `## UI change` block, and atc reads only these fields from it:

| Field | What atc takes |
|---|---|
| `UI impact` | `none`, or a rendered UI change |
| `Human check class` | any of `CHOICE`, `ACCOUNT`, `DEVICE`, or `none`. The template text left as is counts as unfilled |
| `Evidence pack` | a link to a comment on the same PR (`…/pull/<n>#issuecomment-<id>`) |
| `Preview` | ACCOUNT/DEVICE: the Preview URL for the current head |
| `Human steps` | ACCOUNT/DEVICE: the 1–3 steps (following indented lines included) |
| `Human check` | `not needed`, `pending`, or `done <date> <sha> <note>` / `failed <date> <sha> <note>` |

atc doesn't read the old Human Preview gate section at all.

- **Queue** (`waitsOnHuman`): open, non-draft PRs whose block has a class and whose `Human check` isn't `done` for the current head. A result is bound to a head. It counts for the head it names (`sha` is a prefix of the head). It also counts for an earlier commit that the head reaches by main-only merges with the same change: the ATC-31 rule, from `carryFrom`, or for a PR whose review is already on its head, from a separate `humanCarryFrom` read so the review decision isn't touched. Any other SHA shows as "recorded on an old head". `failed` on the current head stays in the queue. Class `none` or `UI impact: none` never enters.
- **Row** (STRIPS, above LANDING SEQUENCE, `HUMAN CHECK n`): PR, AIRPORT and FLIGHT, the team holding the STAND, the class chips, and the state.
  - The evidence pack: thumbnails of the images in the linked PR comment. They are read as GitHub's `body_html`, whose signed image URLs work for private repositories and expire within minutes, so atc keeps them in memory for 3 min and never stores them. A link to a comment on another PR is refused.
  - The RUN-UP report (ATC-41), when one exists for this exact head: `.runup/<base7>-<head7>/report.json` in the AIRPORT checkout or one of its STANDs, with `head.sha` equal to the head. The row shows changed screens and cuts, UNEXPECTED warnings and changed-cut thumbnails, and links the report.
  - For ACCOUNT and DEVICE: the Preview link and the steps.
- **PASS / FAIL** (`POST /api/human-check/:owner/:name/:number {result, head, note}`): SUPERVISOR only, with the same Origin rule as the AUTOLAND switch. atc re-reads the PR first. The `head` the screen showed must still be the head, the block must have a class and exactly one `Human check` line, and FAIL needs a note (one line, no backticks, 200 characters max).
  - Then exactly two GitHub writes. First the PR body with only that line changed to `` `done <YYYY-MM-DD> <sha7> <note>` `` (or `failed`), sent as JSON on stdin. Then one PR comment "HUMAN CHECK: PASS|FAIL · head · classes · date" with the note.
  - If the body write fails, no comment is posted. Each attempt is a line in `human-checks.jsonl` (append-only): time, repo, PR, head, result, classes, note, `by`, `ok`, `line`, the comment URL and any error.
  - No Vercel share tokens are created or kept.
- **Landing** (replaces the Human Preview exclusion of 9.7): AUTOLAND `merge` doesn't merge a classed PR until its `Human check` is `done` for the head (checked again right before the merge). It also doesn't merge a PR whose block is missing or whose class is unfilled while `UI impact` isn't `none`: atc can't tell whether a person is needed. A PR with class `none` isn't held back. LANDING SEQUENCE rows show `HUMAN CHECK <classes>: <state>` for classed PRs. The CLEARED TO LAND conditions are unchanged.
- **API**:
  - `GET /api/human-check`: the queue and the last 50 records.
  - `GET /api/human-check/:owner/:name/:number/evidence`: comment images and the RUN-UP summary.
  - `GET /api/human-check/:owner/:name/:number/runup/:run/<file>`: RUN-UP report files. Only files inside that report folder are served, and only `.html`/`.json`/images/`.css`/`.js`, after resolving symlinks. They are sent with `Content-Security-Policy: sandbox allow-scripts`, so the report's scripts run on an opaque origin and can't call atc's SUPERVISOR-only endpoints.
- Pure parts: `server/human-check.ts` (`uiChangeOf`, `humanCheckStatusOf`, `humanCheckExclusionOf`, `setHumanCheckLine`, `checkRequestOf`, `imagesOf`, `pickRunup`). I/O: `server/human-check-run.ts`.

### 9.9 REVIEW on Claude Sonnet, no ocx (2026-09-29)

SUPERVISOR decision 2026-09-29: atc stops using the `ocx` (opencodex) route for its control sessions. On that day a newly launched `ocx claude` DeepSeek session failed every main request with `400 Provider error` (the ATC-80 probe), and TOWER and OCC had just moved to Sonnet 5.5.

- **Reviewer**: REVIEW runs on `claude-sonnet-5-5` (`review/.claude/settings.json`). That is a different model from the teams' CAPTAINs (Opus) and from CROSSCHECK (Opus). The guard (`REVIEW_MODELS`) and the server (`LANDING_REVIEW_MODELS`) accept only `claude-sonnet-…` names; DeepSeek and Muse names are refused.
- **Launch**: `claude --bg -n REVIEW --permission-mode auto --strict-mcp-config "/loop 10m /tick"` in `review/`, the same path as TOWER, OCC and MCC ([fleet.md](fleet.md) 8.5.1). The tmux and `ocx claude` LAUNCH of ATC-66 is gone. STOP still closes a control session someone opened in a tmux pane.
- **Old records**: carrying a review across main-only merges (9.6) accepts landing reviews from the `claude-sonnet-…` family and the older `deepseek…` family (`LANDING_REVIEW_FAMILIES`), still not Muse. The reviewer name on strips and in TOWER's `review` drops the `claude-` prefix: `REVIEW: SONNET (Codex 한도)`. A carried review shows `by: "review"` instead of `"deepseek"`; it is computed, not stored.
- **Security PRs**: SUPERVISOR decision 2026-09-29: security PRs go to REVIEW too. That is the 9.5 switch, which was already set to send. Its value keeps the old name `"deepseek"` (`dispatch.json` `externalReview.security`), and AUTOLAND keeps `via: "deepseek"` (`autoland-state.json`), so no stored state changes. The hard exclusions (no FLIGHT, secret or key paths) stay.

## 10. What to add to atc

| Where | What |
|---|---|
| `server/schedule.ts` (new) | SCHEDULE log (`~/.local/state/atc/schedule.jsonl`, append-only), state transitions, APPLIED detection from the Linear fetch, the open-draft limit (daily limits: Not built yet) |
| `server/sources/linear.ts` | Read labels (`tail:`, `type:`, `wake:`, `rating:`), recently closed issues (for duplicate search). NEW is detected as APPLIED by title, not by an `S-xxxx` footer (section 6) |
| `server/dispatch.ts` | Respect `tail:TEAM_X` and the classification rules in [fleet.md](fleet.md) section 5 |
| API | `GET /api/schedule/brief`, `GET /api/schedule/ops/:id`, `POST /api/schedule/ops` (draft), `POST /api/schedule/ops/:id/{verdict,approve,reject,release}`, `POST /api/schedule/mode`, `POST /api/schedule/slips/ack`, `POST /api/schedule/routes/ack` |
| `atc/occ/` | Moved from `atc/dispatch/`: `CLAUDE.md` (operations manual, core), `/tick` and its procedure files, send-guard, **linear-guard**, a Bash guard with read-only `gh` |
| `controller/atcctl.mjs` | `schedule draft`, `schedule release`, `schedule brief` |
| UI | SCHEDULE tab: drafts with reason, payload preview and duplicate-search result; verdict and approve buttons; applied history |
| Records | `schedule.drafted / decided / released / applied` in the FLIGHT RECORDER; metrics: agreement rate, operations reverted by a person, tickets created per week |

## Turning on S2

S2 is built and sits behind the SCHEDULE `mode` (`~/.local/state/atc/schedule.json`, default `shadow`). Turning it on lets OCC write approved operations to Linear, so do it in this order:

1. Check the S2 gate in the SCHEDULE tab (20 or more shadow verdicts, 80% or more agreement). The gate atc shows (`gateOf`) checks only these two; the "0 duplicates found after the fact" criterion of section 11 is not counted by atc (Not built yet).
2. Change the vocado `CLAUDE.md` rule "only leaders write to Linear" to "OCC and leaders write to Linear; OCC writes plan fields (through approved SCHEDULE operations), leaders write execution fields" (section 4). Confirm with the SUPERVISOR at that time.
3. Create the flat Linear labels `rating:SEC`, `rating:UI`, `rating:DATA`, `rating:DOCS` (the `type` and `wake` label groups and `tail:TEAM_X` already exist). A CLASSIFY or NEW call that names a missing label fails, and OCC reports it.
4. Press "S2 승인 운용 켜기" in the SCHEDULE tab (or `POST /api/schedule/mode {"mode":"approval"}`). OCC picks it up on its next pass.
5. To stop, switch back to shadow: linear-guard then blocks every Linear write, and released operations stay as they are.

How it runs: the SUPERVISOR approves (or rejects with a reason) → OCC runs `atcctl schedule release S-xxxx`, which records RELEASED and prints the exact Linear MCP calls (`save_issue`, plus a `save_comment` with the reason for CLASSIFY and PRIORITIZE) → OCC makes each call with the input unchanged; `occ/mcp-guard.mjs` (linear-guard) passes a Linear write only when the mode is approval, the tool and input match a released call exactly, and that call has not passed before (section 6) → on the next Linear read atc marks the operation APPLIED (the change is visible, or for NEW an issue with that title appeared). Approved or released operations that don't land within 3 days expire. Calls only touch plan fields: labels, priority, a new issue's title/body/project/relations, and a comment. Never state or assignee.

## CROSSCHECK

Shadow verdicts (DISPATCH proposals and SCHEDULE drafts) are decided one by one by the SUPERVISOR, which is a heavy load. Handing the verdict to a model would make the gate (20 decisions, 80%) measure whether two models agree with each other, which means nothing. So the work is split:

- A **CROSSCHECK** session, running on a model from a different family than OCC, leaves a provisional verdict (a **mark**: `agree`/`disagree` and a one-line reason) on each open item first.
- The SUPERVISOR accepts it with one click ("CROSSCHECK에 동의"), or overrules it with a reason as before.
- The gates keep counting **human verdicts only**.
- How often CROSSCHECK matches the human is measured separately. It is the evidence for later deciding whether low-risk work (e.g. non-`SEC` CLASSIFY) can be handed over automatically. Automatic verdicts are not built.

**Log.** `proposals.jsonl` and `schedule.jsonl` take a `crosscheck` op: `{op:"crosscheck", id, at, by, verdict:"agree"|"disagree", reason}`. Like `note`, it never changes state itself; a DISPATCH `disagree` with a FLIGHT chip makes the server put a PREFLIGHT HOLD next to it (below). It is accepted only while a proposal is `proposed` and not on HOLD, or a draft is `draft`; a later mark replaces an earlier one. The fold adds `crosscheck: {by, verdict, reason, at} | null` to Proposal and ScheduleOp. ScheduleOp also gains `decision: {verdict, at} | null`, the SUPERVISOR's decision, which survives later states (released, applied).

**API.** `POST /api/dispatch/proposals/:id/crosscheck` and `POST /api/schedule/ops/:id/crosscheck` with `{verdict, reason, by?}`. They work in either mode, because a mark is a reference, not a decision. `reason` is required and at most 500 characters. A HOLD proposal or a closed item returns 409.

**Match rate.** Both `gateOf` results carry `crosscheck: {marked, matched, rate}`. Only human decisions count (shadow `agreed`/`disagreed`, approval `approved`/`rejected`), and only those that had a mark before the decision. `agree` matches `agreed`/`approved`; `disagree` matches `disagreed`/`rejected`. Supersede and expire are not human decisions and are not counted.

**Brief.** Both briefs carry `crosscheck: {pending, examples}`: open items without a mark, and up to 8 recent human decisions with their reasons (those with a reason first) as calibration examples. Real SUPERVISOR reasons look like "이미 완료됨", "PR #393 머지 전이면 HOLD", "우선순위가 미정".

**atcctl.** `crosscheck brief` (both briefs' pending, examples and rates, plus the FLIGHTs they name), `dispatch crosscheck D-xxxx agree|disagree -- <reason>`, `schedule crosscheck S-xxxx agree|disagree -- <reason>`.

**PREFLIGHT HOLD** (2026-09-27, ATC-3; [dispatch.md](dispatch.md) 6.2). A proposal that is not ready never waits in the SUPERVISOR queue:
- CROSSCHECK `disagree` with a FLIGHT chip (`already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`, `no-priority`, `out-of-repo`): the server appends `{op:"preflight", id, at, by, model, codes, reason}` after the mark and the proposal goes to HELD. CROSSCHECK gets no new permission and the guards are unchanged; the HOLD is the server's consequence of the mark. Each tick also applies it to open proposals marked earlier. `atcctl dispatch crosscheck` prints `FLIGHT 칩이라 서버가 PREFLIGHT HOLD` in that case.
- OCC HOLD (`dispatch note … --hold`) goes to HELD as before.
- `wrong-aircraft`, `other` and marks without chips stay in the queue. A proposal without a mark shows `CROSSCHECK 대기` and sorts last.
- On a HELD proposal the SUPERVISOR does not give a verdict (409). "대기열로" (`POST …/requeue`) returns the same proposal to the queue; OCC cannot HOLD it again (409). "FLIGHT 보류 확정" (`POST …/confirm-hold`, not for a prerequisite HOLD) closes it with `via: "preflight"` and the chips, which holds the FLIGHT from every AIRCRAFT for 24 hours or until the issue changes. Neither counts in the gate or the CROSSCHECK match rate.

**Landing reviews are not CROSSCHECK's** (ATC-27; 9.2): from ATC-7 until ATC-27 CROSSCHECK (Muse) also reviewed PR diffs when Codex was limited. They moved to the REVIEW session on DeepSeek V4.1 Flash (`review/`), and `--crosscheck` no longer allows `landing` commands, so CROSSCHECK's per-family figures cover DISPATCH and SCHEDULE marks only.

**Session** (`crosscheck/`, same layout as `occ/`): Korean `CLAUDE.md` and `/tick` as the source, `*.en.md` translations. `/tick`: `manual check` → `crosscheck brief` → for each item without a mark, read the body with `dispatch flight <key>` → record the mark (at most 5 per pass). The rules: a mark is advice only (never approve, reject or verdict); never write to Linear or message anyone; check ticket state, prerequisites and whether the work is already done first; treat OCC's notes as reference, not as the answer; leave no mark when the evidence is insufficient.

`crosscheck/.claude/settings.json` is fail-closed:

| Tool | Rule |
|---|---|
| Bash | `controller/guard.mjs --crosscheck --gh-read`: atcctl `manual`, `crosscheck brief`, `dispatch brief\|flight`, `schedule brief` and the two `crosscheck` commands, `jq` after a pipe only (stdin only: no file arguments, an option allowlist, no `env`, `$ENV`, `import` or `include` in the filter; the same filter check applies to gh's `--jq`), and read-only `gh pr view\|checks\|list` (allowed in `permissions.allow` too). Every other atcctl command (note, hold, draft, release, readback …) is blocked, and so is every other `gh` use: `gh pr diff` (CROSSCHECK doesn't read code; OCC's `--gh-read` alone still allows it), `merge`, `comment`, `review`, `close`, `edit`, `gh api`, `--web`, chained commands and substitutions. With `--crosscheck` alone, `gh` stays blocked |
| MCP | `occ/mcp-guard.mjs --read-only`: read tools only. Unlike OCC, released Linear writes are blocked too |
| Read, Glob, Grep | `crosscheck/` itself and atc's `docs/` only (SUPERVISOR decision, 2026-09-26), so it can read the classification criteria in `docs/fleet.md` 4.1–4.3 and cite them. `permissions.additionalDirectories: ["../docs"]` grants the one extra directory (a relative `Read(../docs/**)` allow rule did not take effect in testing). `crosscheck/read-guard.mjs`, a fail-closed PreToolUse hook, blocks everything else: atc's source, `~/.local/state/atc`, other repositories, other sessions' files, Glob patterns with `..` or absolute paths. This also covers interactive sessions (Desktop), where a read outside the working directories would otherwise open a permission prompt. The session's own saved tool outputs (`<transcript dir>/<session_id>/`) stay readable, because oversized results are stored there and read back |
| Edit, Write, NotebookEdit, SendMessage, Agent, Artifact | Denied, and a PreToolUse hook exits 2 |

**Model.** (The ocx period, until 2026-09-29; now Claude Opus, see "CROSSCHECK on Claude Opus" below.) It must not be OCC's family (Claude). DeepSeek V4.1 Flash is out too: it is the model behind `flash-helper`, and FLEET does not let it give verdicts ([fleet.md](fleet.md)). Two models are set up, both served by the local opencodex proxy:

| Role | Model id | Agent file |
|---|---|---|
| **Default** (SUPERVISOR decision, 2026-09-26) | `claude-ocx-opencode-go--muse-spark-1.3-contributor[1m]` (Muse Spark 1.3) | `~/.claude/agents/ocx-muse-spark-1-3-contributor.md` |
| Fallback | `claude-ocx-native--gpt-5.6-terra` (GPT-5.6 Terra) | `~/.claude/agents/ocx-gpt-5-6-terra.md` |

`crosscheck/.claude/settings.json` sets `"model"` for sessions launched from the terminal. It no longer sets the model name for marks: the guard reads the real model (below). `crosscheck/settings.test.mjs` fails when the settings model is outside the CROSSCHECK list (Muse or Terra), or when the settings `env` names a model. To switch to the fallback, change `model` to the terra id.

Launch checks (2026-09-26, Claude Code 2.1.283):

| Launch | Result |
|---|---|
| `claude` (settings model or `--agent`) | 404 "issue with the selected model", for both models. The ClaudeRipple proxy does not route `claude-ocx-*`. This is the safe failure: it never runs silently on Claude |
| `ocx claude` with `ANTHROPIC_BASE_URL` exported | 404: an exported `ANTHROPIC_*` overrides the proxy URL `ocx claude` sets |
| `ocx claude` without `ANTHROPIC_BASE_URL` | 405: the `HTTPS_PROXY` (ClaudeRipple) from `~/.claude/settings.json` intercepts the request to the local proxy |
| `env -u ANTHROPIC_BASE_URL NO_PROXY=… ocx claude`, terra | Works (settings model and `--agent`). `modelUsage` reports `claude-ocx-native--gpt-5.6-terra`. A full `/tick` has not run on terra yet: the upstream quota was exhausted |
| Same, Muse, default tools | 400 "Invalid JSON schema" (the Artifact tool's `pattern` keyword). Fixed by denying `Artifact` in the settings |
| Same, Muse, Artifact denied | A one-line reply works, but a `/tick` fails on its second request: 400 "JSON schema exceeds the maximum nesting depth of 10 levels". MCP servers that finish connecting after the first request add deeply nested tool schemas |
| Same, Muse, Artifact denied, `--strict-mcp-config` | Works: a full `/tick` against a test server marked 3 items in 20 turns, and every mark carried the Muse id |

So the session is opened in `crosscheck/` with

```bash
env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude --strict-mcp-config
```

named `CROSSCHECK`, and run with `/loop 10m /tick`. The **LAUNCH** button on the CROSSCHECK row of the settings window's CONTROL block does this in one step (ATC-66, [fleet.md](fleet.md) 8.5.1): a tmux session `atc-crosscheck` in `crosscheck/` running

```bash
env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude --strict-mcp-config -n CROSSCHECK '/loop 10m /tick'
```

`-n` names the session and the last argument is its first message. By hand, the same command goes inside `tmux new-session -d -s atc-crosscheck -c /home/c10/projects/atc/crosscheck "…"`.

**From Claude Desktop.** Desktop does not follow the settings `model`; it uses the model picked in the app, and that model goes through the ClaudeRipple proxy (`HTTPS_PROXY` 127.0.0.1:8790), which passes Claude models through as well. Open a session in the `crosscheck/` folder, name it `CROSSCHECK`, **pick `muse-spark-1.3-contributor` in the app's model menu**, then `/loop 10m /tick`. On 2026-09-26 two Desktop sessions ran on the default `claude-opus-5-5` and their marks were recorded under the Muse name (S-0006 and S-0007 are the likely cases); the real-model check below now blocks that.

`--strict-mcp-config` with no `--mcp-config` loads no MCP servers at all. The session then has no MCP tools. It reads GitHub through read-only `gh pr` instead (SUPERVISOR decision, 2026-09-26), the same Bash guard pattern as OCC: when a body, comment or OCC note names a PR condition, it checks the fact with `gh pr view <N> --repo <owner/name> --json state,mergedAt,title` before marking (e.g. "PR #393 머지 전이면 HOLD", "이미 완료됨"). `crosscheck/CLAUDE.md` maps each AIRPORT to its repository (VCDO → `chaehy5665/vocado_nextjs`). `occ/mcp-guard.mjs --read-only` stays in place. When an upstream account is rate-limited, the session stops with an API error; nothing falls back to Claude.

**Real model on each mark.** A mark must come from Muse or Terra, and must record the model that actually wrote it. Neither the settings nor the proxy can prove that: Desktop ignores the settings model, and ClaudeRipple forwards Claude requests too. So the Bash guard checks the session's own transcript.

- For a mark command (`atcctl dispatch|schedule crosscheck`), `guard.mjs --crosscheck` reads the hook input's `transcript_path` (the session's own JSONL, last 4 MB). It takes `message.model` of the last assistant message, skipping `<synthetic>`.
- It passes only a model matching `/muse-spark|gpt-5\.6-terra/i`. Anything else is blocked with "앱에서 모델을 Muse로 바꾸거나, 터미널에서 ocx claude로 여세요": a Claude model (`claude-opus-5-5`, `claude-sonnet-5` …), DeepSeek, a missing or unreadable transcript, or no model in it (fail-closed).
- Read commands (`brief`, `flight`, `gh pr view` …) are not checked.
- When it passes, the guard answers with PreToolUse `updatedInput`: the same command prefixed with `ATC_CROSSCHECK_MODEL='<real model>'`. atcctl sends that as the mark's `model`.
- The session cannot supply the name itself:
  - A variable in front of the command is already blocked.
  - `--model` in a mark command is blocked.
  - The mark command must stand alone (no pipes or chains), so the prefix applies to atcctl.
- Names seen in real transcripts (checked 2026-09-26 in test sessions): `claude-ocx-opencode-go--muse-spark-1.3-contributor` via `ocx claude` (without the `[1m]` of the requested id), `muse-spark-1.3-contributor` via ClaudeRipple (Desktop's path), and `claude-opus-5-5` for opus. On a session's first tool call the transcript has no assistant message yet; mark commands always come later in a pass.
- The server stores the name on the op (`{…, model}`, at most 120 characters). A mark without it, including every mark recorded before the field existed, reads as `"unknown"`. Marks made before this check keep whatever name they were recorded with.
- `gateOf(...).crosscheck` keeps the overall `{marked, matched, rate}` and adds `byModel: {<family>: {marked, matched, rate}}`, keyed by model family (`modelFamily` in `server/crosscheck.ts` strips the path prefix, a `[1m]`-style suffix and `-contributor`, so both Muse paths count as `muse-spark-1.3`). `examples` carry the mark's model. The mark itself keeps its full model name, which the chip's tooltip shows. Marks from before model names were recorded stay `unknown`, and ATFM's turn-on conditions never count them.

**Web.** Open cards in the DISPATCH and SCHEDULE tabs show a dashed chip `CROSSCHECK agree · <reason>`, and a "CROSSCHECK에 동의" button submits the same decision in one click: shadow → verdict, approval → approve/reject. When agreeing with a `disagree` mark, its reason becomes the decision reason. Approval-mode approvals keep their confirm dialog, since they send a FLIGHT PLAN or write to Linear. The gate panels show "CROSSCHECK 일치 n/m (xx%)" as a reference row outside the gate criteria, with one sub-row per model (short name, e.g. `muse-spark-1.3-contributor`, full id in the tooltip). The chip shows the short model name next to its time, and the chip and RECENT tooltips give the full id.

### CROSSCHECK on Claude Opus (2026-09-29)

SUPERVISOR decision 2026-09-29, together with 9.9: CROSSCHECK runs on `claude-opus-5-5` (`crosscheck/.claude/settings.json`) and is launched with `claude --bg` like the other control sessions. OCC runs on Sonnet 5.5, so the second look still comes from a different model, though no longer from a different family. The "Model" and "Real model on each mark" parts above describe the ocx period.

- The guard passes a mark only from a `claude-opus-…` transcript (`CROSSCHECK_MODELS`). Sonnet, Muse, Terra and DeepSeek names are blocked.
- ATFM A7 and S3 ([atfm.md](atfm.md)) accept an agree from Claude Opus, and from Muse or Terra for marks already on open items.
- `modelFamily` still strips the old `claude-ocx-…--` prefixes, so the per-model figures keep the Muse history apart from the new `claude-opus-5-5` family.
- A judge from outside Claude is left to the Jev judges ([fleet.md](fleet.md) 6.1), not to this session.

## 11. Criteria for moving on

| Transition | Criteria (proposed) |
|---|---|
| S0 (OCC session, DISPATCH merged, Linear read-only) | Can start right away |
| S0 → S1 | SCHEDULE log, tab and `atcctl schedule draft` exist |
| S1 → S2 | 20+ decided drafts, 80%+ agreement (atc's gate, `gateOf`), 0 duplicates found after the fact (not counted by atc: Not built yet). **Vocado `CLAUDE.md` changes "only leaders write to Linear" to "OCC and leaders write to Linear; OCC writes plan fields, leaders write execution fields"** |
| S2 → S3 | 2+ weeks in S2, almost no operations reverted by a person, no linear-guard block caused by a wrong payload |

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Ticket spam fills the backlog | The open-draft limit (5; daily limits Not built yet), mandatory duplicate search, shadow first to measure draft quality |
| A security ticket gets the wrong scope | vocado templates (allowed files, forbidden changes, invariants); CAUTION operations are never automatic |
| Closing an issue that isn't done | `CLOSE` needs checked evidence (a merged PR in the LOGBOOK), is never released, and the SUPERVISOR closes the issue in Linear (5.5) |
| OCC creates work and then dispatches it to itself | The SUPERVISOR approves both steps; ATC, a separate session, judges the conflicts |
| OCC and a CAPTAIN write the same field | Field ownership (section 4), enforced by linear-guard |
| Linear API rate limits | Batched fetches, no API attachments, daily write limits (Not built yet) |
| A stale operations manual | `/tick` rereads `CLAUDE.md` when its hash changes |

## 13. Implementation order

1. ✅ **S0**: create `atc/occ/` from `atc/dispatch/` (merge), add read-only `gh` to its guard, a read-only MCP guard, reload the manual on change. Still to do as of 2026-09-26 (not rechecked since): tell President about the handover
2. ✅ TAIL ASSIGNMENT `tail:TEAM_X` in the planner, first shipped as `lane:TEAM_X` (fixes the VOC-196 double dispatch right away). Labels are read from the existing Linear query
3. ✅ **S1**: SCHEDULE log, API, `atcctl schedule`, SCHEDULE tab, shadow verdicts. First operations: `CLASSIFY` and `PRIORITIZE`, then `NEW` (CHARTER DESK, 5.1) and ✅ `CLOSE` (5.5, 2026-09-27)
4. ✅ Flight following in `/tick`: `atcctl following` (stages, delays, mismatches, no repeat reports) plus read-only `gh` for team reports. ✅ CLEARED TO LAND checks in TOWER (section 9.1)
5. ◐ **S2**: built behind `mode` (linear-guard, `schedule release`, APPLIED detection). Still to do when turning it on: the vocado `CLAUDE.md` rule change (confirmed with the SUPERVISOR at that time)
6. **S3**: automatic operations, only those that S2 data supports
7. ✅ **CROSSCHECK**: provisional marks from a different model family, one-click decisions, match rate kept outside the gates. Still to do: decide from the match rate whether any non-`SEC` operation may skip the human

## Decisions (2026-09-26, SUPERVISOR)

| Item | Decision |
|---|---|
| Structure | Two control sessions: OCC (operations) and ATC (traffic) |
| DISPATCH | **Merged into OCC**, not kept as a separate session |
| Linear writes | OCC may write to Linear from S2; the vocado "only leaders write to Linear" rule **may be changed** at S2 |
| Order | Design document first |
| Security PRs to DeepSeek (2026-09-27, ATC-30) | When Codex is unavailable, the DeepSeek V4.1 Flash landing reviewer may review security PRs **if `externalReview.security` is `"deepseek"`**; vocado security diffs and Linear issue bodies then go to DeepSeek. `.env`, secret and key paths and PRs without a FLIGHT never do, and Muse is never used for landing (9.5) |
| Reviews across main-only merges (2026-09-27, ATC-31) | Keep `strict` (up to date with main) on vocado. A review on an earlier commit carries to a head reached only by main merges when the PR's own change (files and blobs against the merge base) is the same; findings carry as findings (9.6) |
| AUTOLAND (2026-09-28, ATC-34) | Build AUTOLAND behind `autoland: off \| update \| merge` (default off, SUPERVISOR only). Turn `update` on after it ships. `merge` stays off until the SUPERVISOR adds an AUTOLAND exception to vocado `AGENTS.md`. No force-push, no GitHub auto-merge, no change to branch protection or `strict` (9.7) |

Still open: the exact S3 automatic list (after S2 data), and whether the TOWER session is renamed ATC or keeps its name.
