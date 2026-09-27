# OCC procedure: SCHEDULE

[한국어](schedule.md) · **English**

> English translation for readers. The OCC session reads the Korean [`schedule.md`](schedule.md), which is the source of truth; this file is not loaded.

Procedure moved from [`CLAUDE.md`](../../../CLAUDE.en.md). Read it in `/tick` steps 5 and 6, when `schedule brief` has candidates, `waypointGaps` or S2 releases, when TARGET and ROUTE drafts are due, and when a CHARTER REQUEST comes in. `CLAUDE.md` sets the role and what OCC doesn't do.

## Commands

| Command | What it does |
|---|---|
| `node ../controller/atcctl.mjs schedule draft CLASSIFY <VOC-193> [--type <TYPE>] [--wake <WAKE>] [--rating <RATING>]… -- <reason>` | Draft classification labels. Only the missing axes are needed. `--rating` can repeat |
| `node ../controller/atcctl.mjs schedule draft PRIORITIZE <VOC-193> --priority <1-4> -- <reason>` | Draft a priority. 1 Urgent · 2 High · 3 Medium · 4 Low |
| `node ../controller/atcctl.mjs schedule draft CLOSE <VOC-193> -- <reason>` | Draft a close. atc fills in the PR, merge time and Fixes status from the LOGBOOK. Never released (the SUPERVISOR moves it to Done in Linear) |
| `node ../controller/atcctl.mjs schedule draft NEW --title <title> --project <project> [--milestone <milestone>] [--gap] [--priority <1-4>] [--type <TYPE>] [--wake <WAKE>] [--rating <RATING>]… [--tail <TEAM_X>] [--parent <FLIGHT>] [--related <FLIGHT>]… [--blocked-by <FLIGHT>]… --reason <reason> -- '<body>'` | (CHARTER DESK) Draft an AD HOC FLIGHT. `\n` in the body becomes a newline. Prints the draft id and the similar FLIGHTs atc found (`similar`). `--milestone` is a milestone (WAYPOINT) name of that project. `--gap` marks a WAYPOINT gap draft: it needs `--milestone`, and atc refuses it if a similar FLIGHT exists |
| `node ../controller/atcctl.mjs network` | NETWORK overview (JSON): ROUTE rows (`routes`: open FLIGHTs, ARRIVED in 14 days, AIRCRAFT, the project's `goal.state`), AIRCRAFT TARGETS against actuals (`aircraft`), 28-day trends |
| `node ../controller/atcctl.mjs schedule draft TARGET <TEAM_X> [--flights-per-week <n\|none>] [--on-time <0-1\|none>] -- <reason>` | Draft a change to an AIRCRAFT's FLEET TARGETS. `none` clears a target. atc attaches the evidence numbers |
| `node ../controller/atcctl.mjs schedule draft ROUTE <TEAM_X> [--add <project>]… [--remove <project>]… -- <reason>` | Draft a change to an AIRCRAFT's ROUTE. Add only Linear projects that are not finished; remove only projects on its ROUTE now |
| `node ../controller/atcctl.mjs schedule slip-ack [<key>]…` | Record the WAYPOINT slip warnings (`slips` in `schedule brief`) as reported. Without a key, every warning that is fresh now. A reported warning doesn't become fresh again, unless it clears and comes back |
| `node ../controller/atcctl.mjs schedule release <S-0001>` | (S2) Release an approved operation and print its Linear calls as `CALL n/m · <tool>` with the JSON input. If already released, print the same CALLs again |

## SCHEDULE drafts (S1, shadow operation)

Each pass, pick from `candidates` in `schedule brief`. FLIGHTs that already have an open draft of the same kind are left out of the candidates. **At most 3 FLIGHTs per pass**; for each, read the body and comments with `dispatch flight <FLIGHT>` and write the drafts. The reason is one line of fact from the body or comments, in quotes (a `>` or `<` outside quotes is blocked by the guard).

| Candidate | Draft |
|---|---|
| `candidates.classify`: no `type:` or `wake:` label | `CLASSIFY`. Read `../docs/fleet.md` 4.1–4.3 as in "Before a CLASSIFY" below, then TYPE, WAKE and RATING, with section numbers in the reason. Leave out any axis that already has a label |
| `candidates.prioritize`: no priority | `PRIORITIZE`, **only when the body or comments give grounds** (a deadline, an outage or security exposure, it blocks other FLIGHTs, a priority a person wrote down). With no grounds, don't draft |
| `candidates.close`: the PR was merged (LOGBOOK ARRIVED, not reverted) but Linear is not Done or Canceled | `CLOSE`. Check as in "Before a CLOSE" below; the reason names the PR number, the merge time and whether the body says `Fixes` |

| Axis | Values ([`../docs/fleet.md`](../../../../docs/fleet.md) section 4) |
|---|---|
| TYPE | `BUILD` implement and open a PR · `MAINT` upkeep, infra, CI, tests with no behavior change · `TEST` a trial that may be thrown away · `SURVEY` research or docs, no code · `CHECK` review or verification, the output is a verdict · `FERRY` mechanical move with no design decision, docs fix of 5 lines or less |
| WAKE | `L` one file or a few lines, under an hour · `M` one feature or fix with tests, one PR · `H` several modules, migration or security surface, several review rounds · `J` crosses teams or AIRPORTs and needs a design first; must be split |
| RATING | `SEC` DB, migration, RLS, auth, permissions, security, rights, deployment, payment · `UI` screens, components, accessibility · `DATA` language data, pipelines, content, analytics · `DOCS` docs, rule files. May be more than one |


### Before a CLOSE

1. **Check the PR.** `close.<FLIGHT>` in `schedule brief` has the PR (`pr.url`), the merge time (`mergedAt`) and the body's link (`link`). Look once with read-only `gh pr view <number> --repo <owner/name> --json state,mergedAt,body` that it was merged and what the body says.
2. **Only `Fixes` ends an issue.** By vocado's rule only `Fixes VOC-n` in the PR body ends the issue. A `Part of VOC-n` PR is not a candidate. If the body has neither (`link: none`), read the done criteria with `dispatch flight <FLIGHT>`; if some look unfinished, don't draft.
3. **One-line reason**: `"PR vocado_nextjs#400 merged 09-26 13:41 · Fixes VOC-193 · all four done criteria within the PR"`. If there is a revert PR, or the body says follow-up FLIGHTs remain, don't draft.
4. **Never change state.** A CLOSE is not released even in S2 (`schedule release` refuses it). Once approved, the SUPERVISOR moves it to Done in Linear, and atc closes the draft on its next read.

### Before a CLASSIFY

1. **Read the criteria.** Before writing any CLASSIFY in a pass, open `../docs/fleet.md` with Read and read 4.1 FLIGHT TYPE, 4.2 WAKE CATEGORY and 4.3 TYPE RATING. The table above is only a summary.
2. **Look at the examples.** `examples` in `schedule brief` are the SUPERVISOR's recent decisions (`proposed` is the classification OCC drafted, `draft` its reason then, `reason` the rejection reason). **Don't repeat a mistake a rejection reason names.** For example: "FLIGHT TYPE은 MAINT — 수정 허용 범위가 tests·CI 게이트뿐, 제품 동작 변경 없음(4.1)", "WAKE는 L — 파일 하나·두 규칙, 새 테스트 없음(4.2)".
3. **Decide the FLIGHT TYPE in this order** (4.1). Stop at the first match.

| Order | Question | If yes |
|---|---|---|
| 1 | Is the output a review or audit verdict? | `CHECK` |
| 2 | Does it produce only research, an audit, an inventory or a plan, with no code (implementation said to come later)? | `SURVEY` |
| 3 | Is it a spike or prototype that may be thrown away? | `TEST` |
| 4 | Is it a mechanical move with no design decision (dependency bump, rename, docs fix of 5 lines or less)? | `FERRY` |
| 5 | **Does product behavior stay the same?** Refactoring, cleanup, infra, CI and static gates, tests, a race or lock fix users don't see (4.1's example: VOC-195 lock race fix) | `MAINT` |
| 6 | Does a feature, behavior or screen users see or experience appear or change? | `BUILD` |

   `BUILD` is only for 6. A security surface (SEC) or the presence of tests does not make it BUILD; those belong to RATING and WAKE.
4. **WAKE by the real size of the change** (4.2): one file or a few lines with no new tests needed is `L`; one feature or fix with tests in one PR is `M`; several modules or services, a migration, a security surface or several review rounds is `H`; crossing teams or AIRPORTs with design first is `J`. Test files listed in the allowed scope don't mean new tests are needed.
5. **Cite the section numbers in the reason.** In the one-line reason, name the section applied for each axis you set: `"4.1 MAINT: 허용 범위가 tests 정적 규칙뿐, 제품 동작 변경 없음 · 4.2 M: 규칙 하나와 테스트 · 4.3 SEC: GRANT EXECUTE 게이트"`.

- On `LIMIT` (open drafts are at the limit), write no more drafts this pass. Carry on in a later pass once verdicts free a slot. Open `NEW` (CHARTER DESK) drafts count toward the limit of 5 too.
- On an error (`이미 그렇게 되어 있음` "already so", `Todo·Backlog가 아님` "not Todo or Backlog", etc.), don't retry; put it in the OCC LOG.
- Drafting the same FLIGHT and kind again supersedes the earlier draft. Don't redraft unless the judgment changed.
- A draft expires after 3 days without a verdict, and is superseded when the FLIGHT leaves Todo or Backlog or the change shows up in Linear (atc does this). A CLOSE is superseded when Linear shows Done or Canceled, or the PR is reverted.

## SCHEDULE release (S2, only when `mode` in `schedule brief` is approval)

In S2, OCC writes to Linear what the SUPERVISOR approved in the SCHEDULE tab. atc builds the content; OCC only carries it over.

| Situation (where in `schedule brief`) | What to do |
|---|---|
| `approved` in `inProgress` | `node ../controller/atcctl.mjs schedule release <S-xxxx>` → pass the JSON under each `CALL n/m · <tool>` **unchanged** as the input of that Linear MCP tool (`save_issue`, `save_comment`). Make every CALL, in order |
| `released` in `inProgress` (still there on the next pass) | atc checks on its next Linear read whether it landed. Run `schedule release` once more to get the same CALLs and redo only the missing one. A call that already passed is blocked by linear-guard with `이미 한 번 통과함` (so a repeat never writes twice) — don't redo it. If it is still there, report to the SUPERVISOR |
| linear-guard blocked it (`OCC MCP 차단`) | Don't change the input and retry; report to the SUPERVISOR |
| The Linear tool returned an error (missing label etc.) | Don't retry; report the error as is to the SUPERVISOR |

- Write nothing to Linear except the released CALLs. State (In Progress etc.) and assignee belong to the CAPTAIN, so they are never in a CALL.
- An approved `CLOSE` is never released: `schedule release` refuses it with `CLOSE는 SUPERVISOR가 Linear에서 직접` (the SUPERVISOR closes it in Linear). Don't retry; it is on the SCHEDULE tab's "LINEAR에서 직접 DONE" list.
- In `shadow` (S1) skip this section. OCC never approves or rejects.

## WAYPOINT gap (NEW drafts from exit criteria, S1 shadow operation)

With too few FLIGHTs to assign, the gate doesn't fill. The ROUTE MAP knows each WAYPOINT's (Linear milestone's) exit criteria, so OCC drafts NEW issues for criteria no issue covers. Do this every pass, after the SCHEDULE drafts.

1. Read `waypointGaps` in `schedule brief`. Each ROUTE lists its active WAYPOINT and the next one, each with its exit criteria (`criteria`, or `description` when there is no numbered list) and the milestone's issues (`issues`: key, title, state). If it is `null`, atc couldn't read the milestones; skip.
2. **Judge for yourself** whether an issue covers each criterion (the server doesn't match them). An open or finished issue that deals with the criterion covers it. When unsure, read it with `dispatch flight <FLIGHT>`. If `truncated: true`, issues may be missing, so skip that WAYPOINT.
3. Don't draft for:
   - criteria a person must decide: "SUPERVISOR decides", "사용자가 정한다", policy decisions, or work that needs a person's hands (recruiting users, interviews);
   - a description with no numbered list and no clear checkable outcome. If the description has a concrete end condition such as "Exit when …", that sentence can serve as the criterion.
4. For each uncovered criterion, draft the same way as the CHARTER DESK, with these rules:
   - pass the ROUTE as `--project`, the WAYPOINT name as `--milestone`, and add `--gap`;
   - the body has the four sections (the Codex template for SEC), and `## 목표` quotes the criterion verbatim as a `> ` quote;
   - the reason is `--reason "WAYPOINT gap: <WAYPOINT> criterion <n>. 중복 검색: <what you checked in waypointGaps issues and the board>"`.
5. **At most 2 per pass**, starting with the active WAYPOINT's criteria.
6. If atc refuses with `비슷한 FLIGHT가 있어 … 쓰지 않음` (a similar FLIGHT exists), don't retry; note that FLIGHT in the OCC LOG. On `LIMIT`, stop for this pass.

CROSSCHECK marks these drafts like any other SCHEDULE draft. Once approved in S2, the released call carries the milestone id, so the new issue lands on that WAYPOINT.

## TARGET and ROUTE drafts (shadow verdicts only)

FLEET TARGETS (`flightsPerWeek`, `onTime`) and ROUTEs are the SUPERVISOR's. OCC only drafts changes from NETWORK numbers. Whatever the mode, these drafts only get shadow verdicts, and approving one doesn't make atc write `fleet.json`. OCC never writes it either (`../docs/fleet.md` 7.4).

1. **Once in 24 hours.** If `open` or `recent` in `schedule brief` has a `TARGET` or `ROUTE` draft written in the last 24 hours, skip. Otherwise read `node ../controller/atcctl.mjs network`.
2. **Remove a ROUTE**: when a project on an AIRCRAFT's ROUTE has ended (`goal.state` in `routes` is completed or canceled), `schedule draft ROUTE <TEAM_X> --remove <project>`. This is the draft with the clearest evidence.
3. **Add a ROUTE**: `--add` only when most of that AIRCRAFT's ARRIVED FLIGHTs in the last 14 days went to one project that is not on its ROUTE. atc attaches "where the 14-day ARRIVED FLIGHTs went" to the draft, so check that number first.
4. **TARGET**: only when `targets.flightsPerWeek` in `aircraft` and the actuals (`actuals.weekDone`, ARRIVED in 14 days) have been far apart for more than two weeks (for example 6 or more a week against a target of 3, or under half the target). Change `flightsPerWeek` by at most 2 or 50%, whichever is larger, and `onTime` by at most 0.1 (atc refuses bigger steps). atc also refuses when the AIRCRAFT has fewer than 3 ARRIVED in 14 days, or is AOG or retired.
5. **At most 1 per pass.** The reason is one line of numbers: `"14일 ARRIVED 9 · 주별 4·5 · 목표 3"`. atc attaches the numbers again, so don't guess; write only what you saw in `network`.
6. These drafts count toward the limit of 5 open drafts and expire after 3 days. A new draft for the same AIRCRAFT and kind replaces the earlier one. If the SUPERVISOR already changed it on the FLEET tab, atc closes the draft as SUPERSEDED.

## CHARTER DESK (AD HOC FLIGHT drafts, S1 shadow operation)

The CHARTER DESK is the request desk inside OCC. It takes only requests the SUPERVISOR makes directly in this session (CHARTER REQUESTs). It is not a per-pass duty; it happens only when a request comes in.

- If the request is small enough to hand to a team without a ticket (a fix of 5 lines or less, a docs note), tell the SUPERVISOR it fits AD HOC. OCC does not send it to the team.
- If the work needs a ticket, draft an AD HOC FLIGHT (new issue). Once approved, from S2 it becomes a Linear Todo (FILED), and DISPATCH assigns it like any other FLIGHT.

| Step | What to do |
|---|---|
| 1. Duplicate search | Look for similar work in `schedule brief` (open drafts' `payload.title`, `flights`) and the FLIGHTs in `dispatch brief`; read anything that looks similar with `dispatch flight <FLIGHT>`. If the same work already exists, don't draft; point to that FLIGHT. atc's FLIGHT list holds only **issues updated in the last 45 days** (and issues linked to them), so an open issue untouched for longer can't be found here |
| 2. Body | vocado's four sections: `## 목표`, `## 수정 허용 범위`, `## 금지 사항`, `## 완료 기준`. SEC work (DB, migration, RLS, auth, permissions, security, rights, deployment, payment) uses the Codex Engineering Task headings verbatim: `## Outcome`, `## Context`, `## Scope` (`### In scope`, `### Allowed files / surfaces`, `### Out of scope`), `## Forbidden changes`, `## Invariants`, `## Acceptance Criteria`, `## Verification`, `## Risks / Rollback`, `## Review Readiness`. Don't invent scope the request doesn't give; write "SUPERVISOR 확인 필요" ("needs SUPERVISOR confirmation") |
| 3. Classification | `--type`, `--wake` and `--rating` by the criteria above. `--priority` only when the request gives grounds. When the right team is clear (the scope continues that team's ROUTES or past FLIGHTs, and it holds SEC for SEC work), suggest `--tail TEAM_X`. Otherwise leave it out |
| 4. Relations | A prerequisite as `--blocked-by`, a parent issue as `--parent`, connected work as `--related`. All must be keys in the FLIGHT list |
| 5. Reason | `--reason "<one-line summary of the request>. 중복 검색: <what was searched and found>"`. atc refuses a reason without "중복 검색:" ("duplicate search:") |
| 6. Tell the SUPERVISOR | Give the draft id (`S-xxxx`) from the output and ask for a verdict in the SCHEDULE tab. Mention any `비슷한 FLIGHT` (similar FLIGHTs) listed. On `LIMIT`, say the draft could not be written (open drafts need verdicts first) |

Command shape: multi-word values in double quotes, the body as one single-quoted argument `-- '## 목표\n…\n## 완료 기준\n…'`. Write newlines as `\n` (the guard blocks heredocs and redirection). Don't put `'` inside single quotes, and don't put backticks or `$` inside double quotes (the shell would run them).

It is shadow operation, so nothing is written to Linear. If an issue with the same title appears in Linear after the draft, atc closes the draft as SUPERSEDED; after 3 days without a verdict, as EXPIRED.
