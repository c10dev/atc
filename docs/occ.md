# OCC design (draft)

**English** · [한국어](occ.ko.md)

atc splits into two control sessions, the way aviation does:

- **OCC** (operations control center, the airline side) decides **what flies, who flies it and when**. It keeps the schedule (Linear tickets), dispatches FLIGHTs to teams and follows them until they land.
- **ATC** (air traffic control) keeps what is already flying **separated**. TOWER today, flow management (stage 3) later.

In real aviation the flight dispatcher belongs to the airline's OCC, not to ATC. So DISPATCH (stage 2) moves into OCC, and OCC takes over the work the "President" session does by hand today.

> Status: S0 built (2026-09-26): the `atc/occ/` session (DISPATCH merged in), read-only `gh`, a read-only MCP guard, manual reload, and TAIL ASSIGNMENT (`tail:TEAM_X`, see [fleet.md](fleet.md)) in the planner. S1 built: SCHEDULE drafts in shadow operation for `CLASSIFY`, `PRIORITIZE`, `NEW` and `CLOSE` (`server/schedule.ts`, `atcctl schedule brief|draft`, the SCHEDULE tab, OCC rules). `NEW` is the CHARTER DESK: an AD HOC FLIGHT drafted from a CHARTER REQUEST, with body-section checks and a title-similarity duplicate search over the snapshot (issues updated in the last 45 days). `CLOSE` (section 5.5, built 2026-09-27) drafts closing a FLIGHT whose PR is merged; it is never released, and the SUPERVISOR closes the issue in Linear. At most 5 open drafts of any kind, and drafts expire after 3 days without a verdict. ATC's CLEARED TO LAND check (section 9) is built: the LANDING SEQUENCE now comes from open GitHub PRs. Other operations (`TAIL`, `LINK`, `SPLIT`, `COMMENT`) and S3 are design only (Not built yet). S2 (approval operation: linear-guard, `schedule release`, APPLIED detection) is built behind `mode` and off by default — see "Turning on S2". Decisions are listed under "Decisions" at the end.

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
| `TAIL` | Add or change `tail:TEAM_X` (TAIL ASSIGNMENT) | VOC-196 → `tail:TEAM_E` (what President decided) |
| `CLASSIFY` | Set FLIGHT TYPE, WAKE CATEGORY and required TYPE RATING ([fleet.md](fleet.md) section 4) | VOC-195 → `type:MAINT`, `wake:M`, `rating:SEC` |
| `LINK` | Add a parent, `blocks` or `related` relation | VOC-196 blocked by VOC-52 (written only in the body) |
| `SPLIT` | Turn a finding into a child or related ticket | P3 items from the PR #400 review |
| `COMMENT` | Leave a plan comment (not execution) | "Deferred until VOC-52 lands" |

Built: `NEW` (CHARTER DESK, 5.1), `CLOSE` (5.5), `PRIORITIZE`, `CLASSIFY`. Not built yet: `TAIL`, `LINK`, `SPLIT`, `COMMENT`.

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
- At most 5 open drafts of any kind (`SCHEDULE_OPEN_LIMIT` in `server/schedule.ts`). Past that, atc refuses a new draft (409), and OCC stops drafting and reports. A daily cap on applied `NEW` / `SPLIT` (10 per day, from a settings file) is Not built yet.
- A `CLOSE` needs evidence OCC checked itself: a merged PR, a config read, a comment. "Looks done" is not enough.

### 5.4 CLASSIFY accuracy

In the first seven SCHEDULE verdicts (2026-09-26), all three drafts the SUPERVISOR rejected were CLASSIFY misreadings:
- **S-0001 (VOC-195), S-0004 (VOC-196):** FLIGHT TYPE `BUILD` where [fleet.md](fleet.md) 4.1 gives `MAINT`. One was a lock race fix, the other a CI and static gate, and neither changes product behavior.
- **S-0006 (VOC-181):** WAKE `M` where 4.2 gives `L`: two rules in one file, no new tests.

CROSSCHECK, which cited 4.1, had these right. OCC now works the same way (`occ/CLAUDE.md` "CLASSIFY 전에"):

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

atc marks a released operation APPLIED when the next Linear fetch shows the change: for `NEW`, an issue with the same title (normalized) created after the draft; for `CLASSIFY` and `PRIORITIZE`, the labels or priority as drafted; for `CLOSE`, a Done or Canceled issue. If the change shows before the operation is released, it is SUPERSEDED instead.

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
| President: assign work | DISPATCH proposals. Until 2b, a person's direct assignment is recorded as a `tail:TEAM_X` label so the planner can see it. For now that is done by hand: the SCHEDULE `TAIL` operation is Not built yet |
| President: verify team reports | **Flight following**. atc follows every assigned FLIGHT (`server/following.ts`, `GET /api/following`): DISPATCH ASSIGNs that are accepted, departed or recalling, plus In Progress FLIGHTs with a `tail:` label. It tracks the stages READBACK → DEPARTED → PR opened → CLEARED → ARRIVED (STAND-free FLIGHTs: READBACK → DEPARTED → ARRIVED, section 8.1), and flags delays (no next stage after 1.5× the WAKE expectation) and mismatches between Linear and the PR. Each pass, OCC runs `atcctl following`, reports only new issues and records them with `following ack`, so nothing is reported twice. It never messages teams. For a team report or a SUPERVISOR request, OCC still checks the PR head, CI and review with read-only `gh` (`gh pr view`, `gh pr checks`, `gh pr diff`). The mechanical landing check is ATC's CLEARED TO LAND (section 9) |
| President: keep Linear tidy | SCHEDULE operations |
| President: maintain rule files | A `NEW` ticket that a TEAM implements through a PR |
| President: judge PR reviews and scope | Stays with the SUPERVISOR. OCC can summarize, but does not decide |

OCC's guard is TOWER's Bash guard plus read-only `gh` subcommands (`guard.mjs --gh-read`). Edit and Write stay denied. `occ/mcp-guard.mjs` lets only read MCP tools through (names starting with get, list, search, read, query or fetch), so in S0 OCC cannot write to Linear or GitHub even though the connectors are loaded. In S2, linear-guard opens Linear writes for released calls of approved operations only (section 6).

The session reloads its manual: `/tick` starts with `atcctl manual check`, which compares the hash of `CLAUDE.md` and `/tick` with the last `atcctl manual ack` (stored under `~/.local/state/atc/manuals/`). If they changed, the session rereads them before doing anything else. TOWER's `/tick` does the same. That fixes the stale-manual incident from section 1.

**President retires** once all three hold: OCC has run S1 for a week, flight following covers every team report, and the `TAIL` operation is in use (Not built yet). Until then President keeps assigning and records each assignment as a `tail:` label by hand.

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
| `review-no-pr` | Linear says In Review but there is no PR | warn |
| `done-not-merged` | Linear says Done but there is no merged PR | warn |
| `merged-not-done` | the PR merged but Linear isn't Done; this is what a `CLOSE` draft handles | info |

- A recalling FLIGHT is not checked for delays, because it was told to stop.
- For STAND-free FLIGHTs, `no-departure`, `no-pr`, `pr-not-cleared` and `landing-wait` don't apply, and neither do the Linear/PR mismatches (`review-no-pr`, `done-not-merged`, `merged-not-done`). `no-arrival` is their only delay.
- A FLIGHT that has ARRIVED and is closed in Linear stays visible for a day, then drops off. A STAND-free FLIGHT stays visible for a day after its ARRIVED, like the others.
- `following-state.json` keeps the keys (`FLIGHT|code`) OCC has reported. An issue that clears is forgotten, so if it comes back it is reported again.

### 8.2 BRIEFING in the tick (ATC-4)

In step 3 of `/tick`, besides the review note, OCC writes a BRIEFING on every open or HELD proposal that has none: `atcctl dispatch briefing <D-xxxx> --what '…' --why '…' --risk '…'`, three plain Korean sentences (무슨 일, 왜 이 AIRCRAFT, 걸리는 점). It writes again when it sets or lifts a HOLD or rereads a changed body. The numbers (PRIORITY, wait days, ROUTE and WAYPOINT, prerequisites, recent FLIGHTs) come from the server in `briefs.<ID>.facts`; the BRIEFING explains them instead of repeating them. See docs/dispatch.md 5.5 for the card.

## 9. What ATC takes

- **CLEARED TO LAND** (built): a LANDING SEQUENCE entry is marked ready only when the PR's exact head has green required checks, a passing review on that head (for Codex, a 👍 after the head: its COMMENTED review means findings), no base drift and no LOS. This is the mechanical half of what President checks by hand today. It catches CI that is green only on an older commit, a review left on an older commit, and drift from main.
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

## 10. What to add to atc

| Where | What |
|---|---|
| `server/schedule.ts` (new) | SCHEDULE log (`~/.local/state/atc/schedule.jsonl`, append-only), state transitions, APPLIED detection from the Linear fetch, the open-draft limit (daily limits: Not built yet) |
| `server/sources/linear.ts` | Read labels (`tail:`, `type:`, `wake:`, `rating:`), recently closed issues (for duplicate search). NEW is detected as APPLIED by title, not by an `S-xxxx` footer (section 6) |
| `server/dispatch.ts` | Respect `tail:TEAM_X` and the classification rules in [fleet.md](fleet.md) section 5 |
| API | `GET /api/schedule/brief`, `GET /api/schedule/ops/:id`, `POST /api/schedule/ops` (draft), `POST /api/schedule/ops/:id/{verdict,approve,reject,release}`, `POST /api/schedule/mode` |
| `atc/occ/` | Moved from `atc/dispatch/`: `CLAUDE.md` (operations manual), `/tick`, send-guard, **linear-guard**, a Bash guard with read-only `gh` |
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

**Session** (`crosscheck/`, same layout as `occ/`): Korean `CLAUDE.md` and `/tick` as the source, `*.en.md` translations. `/tick`: `manual check` → `crosscheck brief` → for each item without a mark, read the body with `dispatch flight <key>` → record the mark (at most 5 per pass). The rules: a mark is advice only (never approve, reject or verdict); never write to Linear or message anyone; check ticket state, prerequisites and whether the work is already done first; treat OCC's notes as reference, not as the answer; leave no mark when the evidence is insufficient.

`crosscheck/.claude/settings.json` is fail-closed:

| Tool | Rule |
|---|---|
| Bash | `controller/guard.mjs --crosscheck --gh-read`: atcctl `manual`, `crosscheck brief`, `dispatch brief\|flight`, `schedule brief` and the two `crosscheck` commands, `jq` after a pipe only (stdin only: no file arguments, an option allowlist, no `env`, `$ENV`, `import` or `include` in the filter; the same filter check applies to gh's `--jq`), and read-only `gh pr view\|checks\|list` (allowed in `permissions.allow` too). Every other atcctl command (note, hold, draft, release, readback …) is blocked, and so is every other `gh` use: `gh pr diff` (CROSSCHECK doesn't read code; OCC's `--gh-read` alone still allows it), `merge`, `comment`, `review`, `close`, `edit`, `gh api`, `--web`, chained commands and substitutions. With `--crosscheck` alone, `gh` stays blocked |
| MCP | `occ/mcp-guard.mjs --read-only`: read tools only. Unlike OCC, released Linear writes are blocked too |
| Read, Glob, Grep | `crosscheck/` itself and atc's `docs/` only (SUPERVISOR decision, 2026-09-26), so it can read the classification criteria in `docs/fleet.md` 4.1–4.3 and cite them. `permissions.additionalDirectories: ["../docs"]` grants the one extra directory (a relative `Read(../docs/**)` allow rule did not take effect in testing). `crosscheck/read-guard.mjs`, a fail-closed PreToolUse hook, blocks everything else: atc's source, `~/.local/state/atc`, other repositories, other sessions' files, Glob patterns with `..` or absolute paths. This also covers interactive sessions (Desktop), where a read outside the working directories would otherwise open a permission prompt. The session's own saved tool outputs (`<transcript dir>/<session_id>/`) stay readable, because oversized results are stored there and read back |
| Edit, Write, NotebookEdit, SendMessage, Agent, Artifact | Denied, and a PreToolUse hook exits 2 |

**Model.** It must not be OCC's family (Claude). DeepSeek V4.1 Flash is out too: it is the model behind `flash-helper`, and FLEET does not let it give verdicts ([fleet.md](fleet.md)). Two models are set up, both served by the local opencodex proxy:

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

named `CROSSCHECK`, and run with `/loop 10m /tick`.

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

Still open: the exact S3 automatic list (after S2 data), and whether the TOWER session is renamed ATC or keeps its name.
