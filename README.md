<div align="center">

<img src="docs/assets/banner.svg" alt="ATC — Air traffic control for your AI coding sessions. Ready for takeoff?" width="100%">

**A control tower for your AI coding sessions**<br>
Claude Code and Codex sessions, git worktrees and Linear tickets on one radar screen.

[![Node](https://img.shields.io/badge/node-%E2%89%A524-3ef08f?style=flat-square&logo=nodedotjs&logoColor=white&labelColor=0b1118)](package.json)
[![React](https://img.shields.io/badge/react-19-5cd0ff?style=flat-square&logo=react&logoColor=white&labelColor=0b1118)](web/src)
[![Hono](https://img.shields.io/badge/hono-4-ff4a4a?style=flat-square&logo=hono&logoColor=white&labelColor=0b1118)](server)
[![Vite](https://img.shields.io/badge/vite-8-8aa8ff?style=flat-square&logo=vite&logoColor=white&labelColor=0b1118)](vite.config.ts)
[![Release](https://img.shields.io/github/v/release/chaehy5665/atc?style=flat-square&logo=github&logoColor=white&labelColor=0b1118&color=c3adff)](https://github.com/chaehy5665/atc/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-ffb627?style=flat-square&labelColor=0b1118)](LICENSE)
![Status](https://img.shields.io/badge/status-READY%20FOR%20TAKEOFF-ffd36b?style=flat-square&labelColor=0b1118)

**English** · [한국어](README.ko.md)

[Ready for takeoff](#-ready-for-takeoff) · [Screens](#screens) · [Glossary](#glossary) · [Running](#running) · [Folder docs](#folder-docs) · [Project layout](#project-layout) · [Changelog](CHANGELOG.md)

</div>

A local ATC web app. It shows on one screen which session (team) holds which worktree, and which Linear ticket that worktree is working on.

- Runs on: this machine (`/home/c10/projects/atc`), port `7700`
- Access (from a Mac): `ssh -L 7700:localhost:7700 <host>`, then open `http://localhost:7700`
- Read-only by default. It never creates or deletes worktrees and never writes to Linear.

## 🛫 Ready for takeoff?

> **Pre-flight checklist** — Node 24 or later · Claude Code or Codex · a repository you work on with git worktrees

```bash
npm install
npm run build && npm start      # 🛬 http://localhost:7700
```

To see Linear tickets too, put `LINEAR_API_KEY` in `.env.local`. For always-on operation (systemd) and the claim hook, see [Running](#running) and [Claim hook](#claim-hook).

## Screens

| Screen | What it shows |
|---|---|
| RADAR (`#radar`) | Three columns — session ─ worktree ─ ticket — joined by lines. Highlights worktrees with no owner and in-progress tickets with no worktree |
| FLIGHT STRIPS (`#strips`) | One card per session (ALPHA…, Codex sessions): state, the worktrees it holds, linked tickets |
| FIDS (`#board`) | Ticket cards in Linear state columns, with a badge for the team holding each one |
| Metrics (`#metrics`) | Operating metrics from the FLIGHT RECORDER, the stage 2 readiness check, 5-minute sample trends, a daily table |
| AIRPORT (`#airports`) | Repository registry. Open, rename, close, reopen and delete AIRPORTs. Home AIRCRAFT and AIRCRAFT visiting from another airport (TRANSIENT) |
| FLEET (`#fleet`) | Every AIRCRAFT with its status, current FLIGHTs, crew, TYPE RATINGS, ROUTES and TARGETS. Edit profiles, ENTRY INTO SERVICE, CREW BRIEFING, AOG, RETIREMENT |
| DISPATCH (`#dispatch`) | The current plan, proposal cards with OCC notes and would-approve / would-reject verdicts (approve / reject in 2b), HELD, IN FLIGHT, excluded FLIGHTs, stage 2b and 3 checks |
| SCHEDULE (`#schedule`) | OCC SCHEDULE drafts (S1 shadow): the S2 gate panel, open draft cards with would-approve / would-reject verdicts, candidate counts, a last-7-days table |
| DOCS (`#docs`) | How to use atc: introduction, quickstart, concepts, requesting work (CHARTER DESK / AD HOC), reviewing, FLEET, radio rules, screens, stages, troubleshooting. Rendered from `docs/guide/*.md` (Korean) |

## Glossary

Code and the API use the names on the left; the UI shows aviation terms (`web/src/aviation.ts`).

| Code | Meaning | Identifier | Shown as |
|---|---|---|---|
| `Session` | One Claude Code / Codex session | `sessionId` | AIRCRAFT. `TEAM_A` → `ALPHA` (phonetic alphabet) |
| `Workspace` | One git worktree (including the main checkout) | absolute path | STAND |
| `Ticket` | A Linear issue | `VOC-191` | FLIGHT NUMBER `VOC191` (branches and PRs keep `VOC-191`) |
| `Claim` | A record that a session holds a workspace | `sessionId` + path | STAND occupancy. Confirmed by hook or cwd: "IDENTIFIED"; inferred from transcripts: "ESTIMATED TRACK" |

| Repository / main checkout | — | main checkout path | AIRPORT code (4 capital letters) / TOWER `VCDO TWR` |

### AIRPORT registry

The AIRPORT list lives in `~/.local/state/atc/airports.json` (outside git, since the paths differ per machine) and is managed from the AIRPORT tab or the API.

- Git repositories under `~/projects` are opened automatically. The code is derived from the name (first letter + consonants, e.g. `tennis` → `TNNS`).
- Other repositories are opened by entering a path in the AIRPORT tab. A worktree or subfolder path also works; the main checkout is found from it. Paths outside the home folder and bare repositories are not allowed.
- An AIRPORT is recognized by its **first commit hash**. Moving or renaming the folder keeps the same AIRPORT and code; only the path in the registry is updated. Another clone with the same first commit is opened separately with the id `firstcommit~pathhash`; when one of several is moved, it is matched to the one with the same folder name. Repositories with no commits are recognized by path.
- A closed AIRPORT drops out of the RADAR, FLIGHT STRIPS and STAND lists, but its code stays reserved. Only manually opened (not auto-discovered) AIRPORTs can be deleted.

**OUTSTATION**: a session is at an OUTSTATION when it holds a STAND at an AIRPORT other than its home AIRPORT (the repository its working folder is in) (`server/away.ts`). It shows as `OUTSTATION TNNS` next to the callsign on the RADAR aircraft block and the FLIGHT STRIPS, an `OUTSTATION` stamp on that part of the strip, and `TRANSIENT BRAVO(VCDO)` in the AIRPORT tab. Handed-off claims and sessions opened outside a repository don't count. It also appears in the CONTROLLER brief as `traffic[].home`/`away` and as the events `away.started`/`away.ended`.

| API | What it does |
|---|---|
| `GET /api/airports` | All AIRPORTs with their state (`open` / `closed` / `missing` path) |
| `POST /api/airports` | `{path, code?, name?}` open one |
| `PATCH /api/airports/:id` | `{code?, name?, closed?}` rename, change code, close or reopen |
| `DELETE /api/airports/:id` | Remove from the registry (manually opened ones only) |

### FLEET registry

Teams (AIRCRAFT) are described in `~/.local/state/atc/fleet.json` and edited in the FLEET tab ([docs/fleet.md](docs/fleet.md)). For each `TEAM_X`: **CREW COMPLEMENT** (positions under the CAPTAIN, such as backend Opus, `ui-builder`, `ui-qa` or `flash-helper`), **TYPE RATING** (`SEC`, `UI`, `DATA`, `DOCS`), **ROUTE** (usual Linear projects), **TARGETS** (FLIGHTs per week, on-time rate) and a note. Anything not set follows the defaults, which come from the vocado `CLAUDE.md` crew rules. `SEC` is refused for a crew that has no member able to do security work (`flash-helper` alone is not enough). The file stores only what was changed, so the defaults keep following the code. The planner uses the TYPE RATINGS, crew and ROUTES (see FLIGHT classification under DISPATCH), and skips AIRCRAFT that are AOG or retired.

**Team building** in the FLEET tab: **ENTRY INTO SERVICE** adds a new AIRCRAFT from a **CONFIGURATION** template, then a **CREW BRIEFING** gives a kickoff text to paste into a new session with that name. atc links the session by name once it appears; it never starts sessions itself. **AOG** stands a team down with a reason and optional date; **RETIREMENT** removes it from the list (restorable). `TEAM_X` stays the REGISTRATION; in atc's words a team is an AIRCRAFT flown by a CREW.

| API | What it does |
|---|---|
| `GET /api/fleet` | Every TEAM session and registered AIRCRAFT with status, current FLIGHTs, crew, ratings, routes and targets, plus the rating list, defaults and known projects |
| `POST /api/fleet` | ENTRY INTO SERVICE: `{registration, configuration?, base?, routes?, note?}` (configurations: `general`, `security`, `ui`, `research`) |
| `GET /api/fleet/:registration/briefing` | CREW BRIEFING text to paste into the new session |
| `PATCH /api/fleet/:registration` | `{complement?, ratings?, routes?, targets?, base?, note?, aog?, retired?}`; `null` resets a field to the default. `aog: {reason, until?}` stands a team down; `retired: {reason?}` / `false` retires or restores it |

| State | Shown as |
|---|---|
| Session busy / idle + holding / idle / dead | AIRBORNE / HOLDING / PARKED / NORDO |
| Backlog / Todo | SCHEDULED / FILED |
| In Progress / In Review / Ready to Merge | ENROUTE / APPROACH / CLEARED TO LAND |
| Done / Canceled / Duplicate | ARRIVED / CANCELLED / CONSOLIDATED |

## Data sources and join keys

```
Session ──claim──▶ Workspace ──branch──▶ Ticket
```

| Source | Location | What it gives |
|---|---|---|
| Claude sessions | `~/.claude/sessions/*.json` | pid, sessionId, cwd, name, status |
| Claude transcripts | `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`, `…/<sessionId>/subagents/*.jsonl` | Worktrees entered through tool calls (for inference) |
| Codex sessions | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex sessions and their cwd |
| git | `git worktree list --porcelain` in each repository | Worktree path, branch, HEAD, dirty or not |
| Linear | GraphQL API (`LINEAR_API_KEY`) | Ticket title, state, assignee, URL |
| GitHub | `gh pr list --repo <owner/name> --state open` for each AIRPORT with a GitHub remote, every 90 seconds (`server/sources/github.ts`) | Open PRs: head commit, checks, reviews, merge state, Draft; Codex's 👍 and comments via `gh api` for PRs without a passing head review or with Codex findings on the head |
| Claim | `~/.local/state/atc/claims/<sessionId>/*.json` | Claims recorded by the hook |

Join rules:

1. **Workspace → Ticket**: take `voc-(\d+)` from the branch name to get `VOC-n`. Directory names are not used (they are inconsistent today).
2. **Session → Workspace**: the hook record if there is one (`hook`). For Codex, the session cwd (`cwd`). Otherwise, read the **tool calls** in the transcript (including subagent transcripts) with the same rules as the hook (`hooks/paths.mjs`) and take the most recently worked worktree (`transcript`, shown as an ESTIMATED TRACK). Paths that only appear in tool results or message text don't count, and a worktree is dropped once its last activity is older than the TTL.
   Every team session's cwd is the main `vocado_nextjs` directory, so cwd alone can't tell them apart. Transcript inference is imprecise because one session moves between several worktrees, so the Claim is the source of truth.
3. **PR → Ticket, Workspace**: `voc-(\d+)` in the PR's branch name (same rule as 1), or else `(VOC-n)` at the end of the PR title, gives the FLIGHT, and the worktree whose branch equals the PR's `headRefName` is its STAND.

## Running

```bash
npm install
npm run build && npm start      # http://localhost:7700 (serves web/dist)
npm run dev                     # development: vite on 7700 + API server on 7701
npm run typecheck
npm test                        # unit tests for handoff/conflict rules and shell parsing
```

For always-on operation, run it as a systemd user service.

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now atc     # start now and at boot
systemctl --user restart atc          # after code changes (includes the build)
journalctl --user -u atc -f           # logs
```

Without `LINEAR_API_KEY` in `.env.local`, it shows only the tickets found in branch names, without Linear data.

## Claim hook

`PostToolUse` in `~/.claude/settings.json` (Edit, Write, MultiEdit, NotebookEdit, Bash; async) runs `hooks/claim.mjs`.

- It looks at Edit/Write file paths, Bash `cd <dir>` and `git -C <dir>` targets, and the session cwd, and finds the directory whose `.git` is a **file** (a linked worktree). The main checkout is not recorded.
- Bash commands that only mention a path (`ls`, `cat`, `grep`, …) don't count as a claim, so a reviewer who only reads files never creates one.
- `hooks/shell.mjs` splits Bash commands with a simplified shell grammar and only looks at `cd` and `git -C` in **command position**. Argument strings of `echo`, `printf`, `jq` and the like, heredoc bodies, here-strings and comments are skipped. It looks one level into `bash -c "…"`.
- It creates `~/.local/state/atc/claims/<sessionId>/<encoded path>.json` once and afterwards only updates its mtime. Concurrent calls are safe.
- A claim ends once `ATC_CLAIM_TTL_MIN` (default 180 minutes) has passed since the last update.
- The claim start time (`since`) restarts in two cases: touching a worktree again after the TTL expired, and taking back a worktree another session held after you let go (A → B → A).

## Handoffs and conflicts

When several sessions claim the same worktree, `server/occupancy.ts` decides using each claim's interval `[since, last touch]`. The threshold is `ATC_HANDOFF_GRACE_MIN` (default 5 minutes).

| Verdict | Condition | UI |
|---|---|---|
| HANDOFF | The earlier session hasn't touched it for more than 5 minutes after the later one started, and the later one touched it last | The earlier claim fades with "→ CHARLIE HANDOFF" and is listed under handoffs. Not an alert |
| LOSS OF SEPARATION (conflict) | Not a handoff, and the claims of two live sessions overlap by more than 5 minutes | Alert |
| Brief visit | Overlap of 5 minutes or less | Both show as holding, no alert |

- A handed-off claim no longer counts as a claim (it is excluded from ticket badges, the HOLDING check and the unowned-STAND check).
- A claim handed off by a session that has since ended is not treated as orphaned (NORDO STAND).
- ESTIMATED TRACK claims (transcript inference) are not used for these verdicts.
- To turn the hook off, remove its entry from settings.json. The record folder can be deleted.

## CONTROLLER (stage 1, advisory)

A Claude session opened in the `controller/` folder becomes the TOWER session (CONTROLLER). It reads the atc RADAR and sends CLEARANCEs to team sessions. The CONTROLLER decides; atc records and displays.

```
1. In Claude Desktop, open a new session in /home/c10/projects/atc/controller and rename it TOWER
   (a one-time folder trust prompt appears)
2. /loop 3m /tick
```

- Role and decision rules: [controller/CLAUDE.en.md](controller/CLAUDE.en.md) (English translation; the session loads the Korean [CLAUDE.md](controller/CLAUDE.md)). One pass: [controller/.claude/skills/tick](controller/.claude/skills/tick/SKILL.en.md).
- The CONTROLLER doesn't fly: Edit and Write are left out of its permissions, and `guard.mjs` blocks every Bash command except `node atcctl.mjs …` and `jq`. Redirection is blocked, and so are command substitution and variable expansion anywhere outside single quotes (`$(…)`, backticks, `${…}`, `$VAR`), because the shell expands them even inside double quotes. Put message text in single quotes.
- CLEARANCE flow: `atcctl issue` records the CLEARANCE in atc and returns a fixed message → the CONTROLLER sends it to the team session with SendMessage → when the team replies `READBACK C-0007`, the CONTROLLER runs `atcctl readback`. FLIGHT STRIPS show it as awaiting READBACK (blue), NO READBACK after 10 minutes (orange), or READBACK (dotted).
- Example of the fixed message (`formatClearance` in `server/controller.ts`; the instruction line is in Korean):

  ```
  [ATC C-0007] BRAVO (TEAM_B) · HOLD
  STAND vocado-voc-175 · FLIGHT VOC175
  앞 팀이 끝나 HANDOFF할 때까지 이 STAND를 건드리지 말 것
  — 받았으면 이 메시지에 "READBACK C-0007"로 답장해 주세요.
  ```

  (Roughly: "Don't touch this STAND until the team ahead finishes and hands it off. Reply to this message with "READBACK C-0007" once received.")

- If the team session and the TOWER session use different permission modes (auto-approve or not), messages may wait for user approval.

| API | What it does |
|---|---|
| `GET /api/controller/brief?consumer=controller` | Events since the last ack + current state (open alerts, LANDING SEQUENCE, GitHub status, CLEARANCEs without READBACK, traffic) |
| `POST /api/controller/ack` | `{cursor}` mark as handled (`~/.local/state/atc/consumers/`) |
| `POST /api/clearances` | `{to, type, stand?, flight?, text}` record a CLEARANCE, returns the message to send |
| `POST /api/clearances/:id/readback` · `/cancel` | Confirm READBACK · cancel |

Events (`server/events.ts`) are differences between snapshots: alerts raised and cleared, HANDOFF, the LANDING SEQUENCE (`landing.requested` when a PR enters, `landing.cleared` when it becomes CLEARED TO LAND, `landing.blocked` when a block the CAPTAIN has to fix appears, `landing.left` when it is merged, closed or turned back into a Draft), a session ending while holding a claim, OUTSTATION start and end. Snapshots taken right after the server starts, before Linear, git and GitHub are first read, are not compared; LANDING events are only compared once both snapshots have PRs from GitHub.

### LANDING SEQUENCE and CLEARED TO LAND

The LANDING SEQUENCE is the list of open GitHub PRs that aren't Drafts, across every AIRPORT with a GitHub remote. atc checks each PR mechanically (`server/landing.ts`) and marks it **CLEARED TO LAND** only when all of these hold; otherwise it is **APPROACH** with the blocking conditions (a code and a Korean line each):

| Condition | Blocks with |
|---|---|
| Not a Draft | `draft` |
| Every check at the head commit passed (NEUTRAL and SKIPPED count as passed; every check is treated as required) | `checks-pending`, `checks-failed`, `no-checks` (no checks at all) |
| A review on the head commit (APPROVED or COMMENTED) by someone other than the PR author and the Codex bot, or the Codex bot's 👍 reaction on the PR made after the head commit (Codex's "no major issues" signal). A Codex COMMENTED review on the head means findings and blocks until a Codex 👍 or a human APPROVED on the head after it; and no reviewer whose latest verdict is CHANGES_REQUESTED | `no-review`, `review-stale` (reviews only on older commits), `review-findings` (Codex findings on the head), `changes-requested` |
| No drift from base: `mergeStateStatus` CLEAN, UNSTABLE or HAS_HOOKS | `behind`, `dirty`, `blocked`, `merge-unknown` (GitHub is still computing) |
| No LOSS OF SEPARATION on the PR's STAND | `los` |

CLEARED PRs come first, in the order they became ready (`readyAt`, the first time every condition held at that head; a new push starts over), then APPROACH PRs in the order they were opened. The TOWER gives `LAND` only to CLEARED PRs and tells the CAPTAIN about new blocks on APPROACH PRs with `INFO`. The reasons behind these rules are in [docs/occ.md](docs/occ.md) section 9. The snapshot carries every open PR, Drafts included, in `pulls`, and the GitHub status in `github` (`{enabled, error, fetchedAt}`). If `gh` fails, the last result stays and the error shows there. CLEARANCEs are recorded in `~/.local/state/atc/clearances.jsonl` (append-only).

## FLIGHT RECORDER and operating metrics (stage 1.5)

The atc server keeps an append-only log in `~/.local/state/atc/flight-recorder/YYYY-MM-DD.jsonl` (UTC dates) and deletes files older than 30 days.

| Record | When |
|---|---|
| `event` | Every snapshot-difference event (alerts, HANDOFF, LANDING SEQUENCE, NORDO, OUTSTATION) |
| `sample` | Traffic every 5 minutes: AIRBORNE, HOLDING, claims, conflicts, open alerts, LANDING SEQUENCE (PRs that aren't Drafts), CLEARANCEs without READBACK |
| `ack` | When the TOWER session handles a brief — counts the days TOWER actually operated |

`GET /api/metrics?days=1..30` (the Metrics tab) aggregates this log and the CLEARANCE log (`clearances.jsonl`) (`server/metrics.ts`).

- Conflicts: count, median duration, share resolved within 5 minutes (likely false alarms)
- CLEARANCEs: count by type, READBACK rate (excluding cancelled), median time to READBACK, CLEARANCEs over 10 minutes, cancellations
- LANDING (merge) wait: median and maximum from entering to leaving the LANDING SEQUENCE, per PR
- HANDOFF, NORDO, OUTSTATION starts, NO CONTACT and UNIDENTIFIED occurrences, daily table

**Stage 2 readiness check** (proposed criteria, `READINESS`): TOWER operated on 3 or more days, READBACK rate of 90% or more, median READBACK time of 5 minutes or less, 30% or fewer conflicts resolved within 5 minutes. With fewer than 5 CLEARANCEs or fewer than 3 resolved conflicts, it shows "not enough data".

## DISPATCH (stage 2: 2a shadow operation, 2b approval operation behind a switch)

Design: [docs/dispatch.md](docs/dispatch.md). Every 5 minutes the atc server computes a plan for assigning FLIGHTs (Linear Todo tickets) to AIRCRAFT (TEAM sessions) (`server/dispatch.ts`) and records it as proposals (`server/proposals.ts`, `~/.local/state/atc/proposals.jsonl`). The mode (`mode` in `dispatch.json`) is `shadow` by default: **nothing is sent to anyone.**

- Proposals: `ASSIGN` (FLIGHT → AIRCRAFT, scored per factor: priority, days waiting, FLIGHTs it unblocks, team affinity, conflict risk) and `RELEASE` (a code-work FLIGHT ENROUTE for more than 3 days without a STAND). FLIGHTs blocked by an unfinished FLIGHT show as `HOLD_DEPARTURE`; excluded FLIGHTs are listed with the reason. Parent issues — an issue with `children`, or named as another's `parent` — are containers, not work: they are excluded from ASSIGN and RELEASE and raise no NO CONTACT alert. FLIGHTs with no priority are not ASSIGN candidates until someone sets one.
- Limits: 1 FLIGHT per TEAM, concurrent AIRBORNE per AIRPORT (VCDO 4, others 2), 5 open ASSIGN and 5 open RELEASE proposals. The same pair is not proposed again within 24 hours; proposals become SUPERSEDED when the situation changes and EXPIRED after 24 hours.
- Settings: `~/.local/state/atc/dispatch.json` (defaults when absent) — project → AIRPORT mapping, slots, weights, RELEASE threshold.
- **DISPATCH tab**: the SUPERVISOR marks each proposal card "would approve / would reject". A rejection offers reason chips (parent issue, prerequisite only in the body, waiting on a human decision, already in progress, low priority, no slot, another team fits better, already done) plus an optional memo. 20 or more decisions with 80% or more agreement meet the stage 2b (approval operation) check.
- **OCC session** (operations control; a session opened in the `occ/` folder, `/loop 10m /tick`; design: [docs/occ.md](docs/occ.md)). It does the DISPATCH work: for each proposal without a note it reads the FLIGHT body and comments and adds a note and CAUTION (DB, security or rights work; waiting for a human decision). When a prerequisite exists only in the body, with no `blocks` relation, it adds `--hold <FLIGHT>`, which moves the proposal to the HELD list until that FLIGHT is done. When it waits for a human decision instead, a bare `--hold` holds it until the FLIGHT is edited. HELD proposals never expire; the SUPERVISOR can release one with "HOLD 풀기". It never decides. It also does flight following: when a CAPTAIN reports or the SUPERVISOR asks, it checks the PR's head commit, CI and review with read-only `gh` and reports differences. Its Bash guard is TOWER's plus read-only `gh pr view|checks|diff|list` (`guard.mjs --gh-read`), and `occ/mcp-guard.mjs` lets only read MCP tools through, so it cannot write to Linear or GitHub. Each `/tick` starts with `atcctl manual check` and rereads `CLAUDE.md` when it changed (TOWER does the same).
- **TAIL ASSIGNMENT** (`tail:TEAM_X` Linear label, [docs/fleet.md](docs/fleet.md)): a FLIGHT with this label is proposed only to that team. If that team cannot take it (AIRBORNE, HOLDING, missing), the FLIGHT is excluded instead of going to another team. The old `lane:TEAM_X` is still honored until 2026-10-10.
- **FLIGHT classification** ([docs/fleet.md](docs/fleet.md) section 4): Linear labels `type:` (`BUILD` `MAINT` `TEST` `SURVEY` `CHECK` `FERRY`), `wake:` (`L` `M` `H` `J`) and `rating:` (`SEC` `UI` `DATA` `DOCS`); any label in the Risk group counts as `SEC`. Labels in a Linear label group are read as `group:name`. The planner proposes a FLIGHT only to an AIRCRAFT that holds every required TYPE RATING in the FLEET registry and whose crew can fly that type (no `BUILD` for a `flash-helper`-only crew). AIRPORT slots are counted by WAKE (L 0.5, M 1, H 2), `J` is excluded until split, and a FLIGHT on the AIRCRAFT's ROUTE gets +1. Missing labels mean `BUILD · M`. The DISPATCH card shows the classification under the title.
- **2b approval operation** (`mode: approval`, switched from the DISPATCH tab): the SUPERVISOR approves or rejects proposals. For an approved ASSIGN, the OCC session runs `dispatch release`, which marks it SENT and returns a fixed FLIGHT PLAN (`[DISPATCH D-0003] FLIGHT PLAN · BRAVO (TEAM_B)` …), and sends that text to the CAPTAIN. The CAPTAIN's `READBACK D-0003` makes it ACCEPTED, and when a STAND for the FLIGHT appears atc marks it DEPARTED. Approved, sent and accepted proposals reserve their AIRCRAFT and FLIGHT so they are not proposed twice. Approved RELEASEs are not sent; the SUPERVISOR tidies them up in Linear.
- **send-guard** (`occ/send-guard.mjs`, PreToolUse on SendMessage): lets a message through only in approval mode, only for a SENT proposal, only to that proposal's CAPTAIN, and only if the text is exactly the FLIGHT PLAN atc generated. The hooks of both the TOWER and OCC folders are fail-closed (`… || exit 2`), so a missing or failing hook blocks the tool.
- **CROSSCHECK** ([docs/occ.md](docs/occ.md) "CROSSCHECK"): a session opened in `crosscheck/` on a model from a different family than OCC (Muse Spark 1.3 by default, GPT-5.6 Terra as the fallback, through `ocx claude --strict-mcp-config`; never DeepSeek, which is `flash-helper`'s model) leaves a provisional verdict — a mark, `agree`/`disagree` plus a one-line reason — on each open DISPATCH proposal and SCHEDULE draft (`atcctl crosscheck brief`, `atcctl dispatch|schedule crosscheck <ID> agree|disagree -- <reason>`). A mark never changes state. The tabs show it as a dashed chip, and "CROSSCHECK에 동의" submits the same decision in one click. The gates count human verdicts only; "CROSSCHECK 일치 n/m" in the gate panels shows how often the mark matched the human, overall and per model. Each mark records its model from the settings `env`, not from the session; older marks count as `unknown`. Its guards are fail-closed: `guard.mjs --crosscheck --gh-read` (atcctl reads, crosscheck commands, and read-only `gh pr view|checks|list` for checking PR facts), `mcp-guard.mjs --read-only`, and no Edit, Write, SendMessage, Agent or Artifact.
- Before turning 2b on, extend the READBACK line in the teams' CLAUDE.md to FLIGHT PLANs (`[DISPATCH D-xxxx]`). See "Turning on 2b" in the design.

| API | What it does |
|---|---|
| `GET /api/dispatch/brief` | Mode, current plan, open / held / in-flight / overdue / recent proposals, stage 2b and 3 checks, FLIGHT summaries |
| `POST /api/dispatch/proposals/:id/verdict` | `{verdict: agree\|disagree, reason?}` shadow verdict (shadow mode only) |
| `POST /api/dispatch/proposals/:id/note` | `{text, caution?}` DISPATCH review note |
| `POST /api/dispatch/proposals/:id/hold` | `{blockedBy: ["VOC-180"]}` DISPATCH prerequisite HOLD; the proposal moves to HELD. `[]` holds with no prerequisite (needs a note) |
| `POST /api/dispatch/proposals/:id/unhold` | SUPERVISOR releases a HOLD; the proposal is superseded and the FLIGHT becomes a candidate again |
| `POST /api/dispatch/proposals/:id/{approve,reject}` | SUPERVISOR decision (approval mode only), `reject` takes `{reason?}` |
| `POST /api/dispatch/proposals/:id/release` | Approved → SENT, returns `sendTo` and the FLIGHT PLAN (the same text again if already sent) |
| `POST /api/dispatch/proposals/:id/{accept,decline}` | CAPTAIN READBACK, or decline with `{reason}` |
| `GET /api/dispatch/proposals/:id` | One proposal and the mode (used by send-guard) |
| `POST /api/dispatch/mode` | `{mode: shadow\|approval}` |
| `GET /api/dispatch/flight/:key` | FLIGHT body and comments (Linear, read-only) |

## SCHEDULE (OCC S1: shadow drafts)

Design: [docs/occ.md](docs/occ.md) sections 5–7. The OCC session drafts the Linear changes it would make as SCHEDULE operations (`server/schedule.ts`, `~/.local/state/atc/schedule.jsonl`, append-only). S1 is shadow operation: **nothing is written to Linear.** The SUPERVISOR marks each draft, and the agreement rate decides when S2 (approved drafts written through linear-guard) can start.

- Operations: `CLASSIFY` (FLIGHT TYPE, WAKE and TYPE RATING labels, [docs/fleet.md](docs/fleet.md) section 4; labels are only added), `PRIORITIZE` (priority 1 Urgent … 4 Low) and `NEW` (a new issue, an AD HOC FLIGHT from the [CHARTER DESK](#charter-desk-request-desk)). Each has an id (`S-0001`), the FLIGHT (`null` for `NEW`), the payload and OCC's one-line reason.
- Candidates: Todo or Backlog FLIGHTs with no `type:` or `wake:` label (CLASSIFY) or no priority (PRIORITIZE), minus those with an open draft of the same kind. A draft that would change nothing is refused.
- Limits: 5 open drafts of any kind, `NEW` included (409 past that). A new draft for the same FLIGHT and kind supersedes the old one; a `NEW` never supersedes another. atc closes an open draft as SUPERSEDED when the FLIGHT leaves Todo / Backlog or Linear already shows the change (for `NEW`: an issue with the same title appears in Linear after the draft), and as EXPIRED after 3 days without a verdict.
- **SCHEDULE tab** (after DISPATCH): the S2 check (20 or more decided drafts, 80% or more agreement), open draft cards with the FLIGHT, title, current classification, what would change and OCC's reason, "승인했을 것 / 거절했을 것" (would approve / would reject) buttons with an optional reject reason, a hint of the labels to add in Linear by hand, candidate counts, and a table of the last 7 days.
- **OCC session**: each `/tick` runs `atcctl schedule brief`, reads up to 3 candidate FLIGHTs with `dispatch flight`, and drafts with `atcctl schedule draft CLASSIFY <FLIGHT> [--type X] [--wake Y] [--rating Z]… -- <reason>` or `schedule draft PRIORITIZE <FLIGHT> --priority 1-4 -- <reason>`. It drafts PRIORITIZE only when the body or comments give grounds. On `LIMIT` it stops drafting for that pass. Linear stays read-only (`occ/mcp-guard.mjs`).

| API | What it does |
|---|---|
| `GET /api/schedule/brief` | Mode (`shadow`), open drafts with what each would change, drafts closed in the last 7 days, the S2 check, the open-draft limit, candidates, FLIGHT summaries |
| `GET /api/schedule/ops/:id` | One SCHEDULE operation and the mode |
| `POST /api/schedule/ops` | OCC draft. `CLASSIFY` / `PRIORITIZE`: `{kind, flight, reason, type?, wake?, ratings?, priority?}`. `NEW`: `{kind: "NEW", title, body, project, reason, priority?, type?, wake?, ratings?, tail?, parent?, related?, blockedBy?}`; the op has `flight: null` and atc adds `similar: [{key, title}]`. 400 with the reason on bad input, 409 at the open-draft limit |
| `POST /api/schedule/ops/:id/verdict` | `{verdict: agree\|disagree, reason?}` SUPERVISOR shadow verdict |
| `POST /api/schedule/ops/:id/approve`, `/reject` | S2 only: SUPERVISOR approves, or rejects with `{reason?}` |
| `POST /api/schedule/ops/:id/release` | S2 only: OCC releases an approved operation; returns the exact Linear calls (the same ones again if already released) |
| `GET /api/schedule/released` | Mode and every released call (read by linear-guard) |
| `POST /api/schedule/mode` | `{mode: shadow\|approval}` |

## CHARTER DESK (request desk)

The CHARTER DESK is OCC's request desk for work that is not on the schedule (Linear). The SUPERVISOR asks for it in the OCC session (a **CHARTER REQUEST**), and OCC drafts it as a SCHEDULE `NEW` operation: an **AD HOC FLIGHT**, a FLIGHT added outside the regular schedule. Rules for the session: "CHARTER DESK" in [occ/CLAUDE.en.md](occ/CLAUDE.en.md).

```
CHARTER REQUEST → AD HOC FLIGHT draft (S1: verdict in the SCHEDULE tab) → FILED (S2: Linear Todo) → ASSIGN → ENROUTE → ARRIVED
```

- Small fixes go straight to a team as **AD HOC** work, with no ticket. Work that needs a ticket goes to the OCC session. The Linear issue is created for real only from S2; in S1 the SUPERVISOR judges the draft and creates the issue by hand if wanted.
- The body follows vocado's four sections (목표, 수정 허용 범위, 금지 사항, 완료 기준; English Goal / Outcome, Allowed changes or files, Forbidden, Acceptance or Done criteria also count). A `rating:SEC` issue also needs the Codex Engineering Task sections Allowed files (`### Allowed files / surfaces`), Forbidden changes, Invariants, Acceptance Criteria and Verification. The title is 1–120 characters, the project must be one on current tickets, `tail` a FLEET registration that is not retired, and `parent` / `related` / `blockedBy` keys in the FLIGHT list.
- Duplicate search: OCC's reason must contain "중복 검색:" ("duplicate search:") with what it looked for. atc also lists up to 5 tickets with similar titles in `similar` (same normalized title, or 2+ shared words covering at least half of the shorter title). It searches only the snapshot, which holds issues updated in the last 45 days (plus issues linked to them), so an open issue untouched for longer than 45 days is not found.
- CLI: `atcctl schedule draft NEW --title <t> --project <p> [--priority n] [--type X] [--wake Y] [--rating Z]… [--tail TEAM_X] [--parent K] [--related K]… [--blocked-by K]… --reason <reason> -- '<body>'`. The body comes after `--` because the OCC guard blocks heredocs and redirection; `\n` in it becomes a newline.

## Folder docs

| Folder | What's there | Docs |
|---|---|---|
| (root) | Working rules for sessions that change atc's code: worktrees, verification, git, terms | [CLAUDE.en.md](CLAUDE.en.md) |
| `server/` | API server: snapshot loop, sources, CONTROLLER, DISPATCH and SCHEDULE APIs, FLIGHT RECORDER | [server/README.md](server/README.md) |
| `web/` | The ATC screen (Vite + React): tabs, themes, settings | [web/README.md](web/README.md) |
| `hooks/` | Claim hook that records which worktree each session works in | [hooks/README.md](hooks/README.md) |
| `controller/` | Working folder for the TOWER session (stage 1) | [CLAUDE.en.md](controller/CLAUDE.en.md) · [/tick](controller/.claude/skills/tick/SKILL.en.md) |
| `occ/` | Working folder for the OCC session (DISPATCH, SCHEDULE drafts, flight following) | [CLAUDE.en.md](occ/CLAUDE.en.md) · [/tick](occ/.claude/skills/tick/SKILL.en.md) |
| `crosscheck/` | Working folder for the CROSSCHECK session (provisional verdicts from a different model) | [CLAUDE.en.md](crosscheck/CLAUDE.en.md) · [/tick](crosscheck/.claude/skills/tick/SKILL.en.md) |
| `deploy/` | systemd user service | [deploy/README.md](deploy/README.md) |
| `docs/guide/` | The user guide shown in the DOCS tab (Korean) | [introduction](docs/guide/introduction.md) |
| `docs/` | Design and conventions | [DISPATCH design](docs/dispatch.md) · [OCC design](docs/occ.md) · [FLEET design](docs/fleet.md) · [Naming rules](docs/naming.md) |
| — | Changelog | [CHANGELOG.md](CHANGELOG.md) |

Each has a Korean version next to it (`README.ko.md`, `*.ko.md`; for the session folders the Korean `CLAUDE.md` / `SKILL.md` are the originals the sessions load).

## Project layout

```
atc/
├── hooks/
│   ├── claim.mjs           # PostToolUse hook (no dependencies)
│   ├── paths.mjs           # tool call → working path; shared by the hook and server inference
│   └── shell.mjs           # extracts cd / git -C targets from Bash commands (shell.test.mjs)
├── server/                 # Node 24 + Hono. Builds a snapshot every 2 seconds and pushes it over SSE
│   ├── sources/
│   │   ├── claude.ts       # ~/.claude/sessions, hook records, transcript inference (claude.test.ts)
│   │   ├── codex.ts        # ~/.codex/sessions (claims by cwd)
│   │   ├── git.ts          # git worktree list, dirty state, last commit
│   │   ├── github.ts       # open PRs through gh, every 90 seconds
│   │   └── linear.ts       # Linear GraphQL, every minute
│   ├── model.ts            # Session / Workspace / Ticket / Claim / Alert
│   ├── airports.ts         # AIRPORT registry and API (airports.test.ts)
│   ├── fleet.ts            # FLEET registry and API (fleet.test.ts)
│   ├── away.ts             # OUTSTATION detection (shared with the UI)
│   ├── callsign.ts         # callsigns and FLIGHT NUMBERs (shared with the UI)
│   ├── clearances.ts       # CLEARANCE and READBACK records
│   ├── controller.ts       # CONTROLLER API and brief (controller.test.ts)
│   ├── dispatch.ts         # DISPATCH plan: candidates, slots, scores (dispatch.test.ts)
│   ├── events.ts           # snapshot differences → events
│   ├── landing.ts          # CLEARED TO LAND conditions and LANDING SEQUENCE order (landing.test.ts)
│   ├── metrics.ts          # operating metrics and stage 2 check (metrics.test.ts)
│   ├── proposals.ts        # DISPATCH proposal log and API (proposals.test.ts)
│   ├── schedule.ts         # OCC SCHEDULE draft log and API (schedule.test.ts)
│   ├── recorder.ts         # FLIGHT RECORDER log
│   ├── occupancy.ts        # HANDOFF and conflict verdicts (occupancy.test.ts)
│   ├── snapshot.ts         # merges sources + computes alerts
│   └── index.ts            # /api/snapshot, /api/events
├── web/src/                # Vite + React. Connection / team / ticket screens
├── occ/                    # working folder for the OCC session (CLAUDE.md, /tick, settings, send-guard, mcp-guard)
├── crosscheck/             # working folder for the CROSSCHECK session (CLAUDE.md, /tick, fail-closed settings)
├── controller/             # working folder for the TOWER session
│   ├── CLAUDE.md           # role and decision rules
│   ├── atcctl.mjs          # atc CLI for TOWER and OCC (atcctl.test.mjs)
│   ├── guard.mjs           # hook that restricts Bash (guard.test.mjs)
│   └── .claude/            # permissions and hook settings, /tick skill
├── deploy/atc.service      # systemd user service
└── docs/naming.md
```

## Alerts

| Kind (`AlertKind`) | Shown as | Condition |
|---|---|---|
| `conflict` | LOSS OF SEPARATION | Two live sessions work in the same worktree with more than 5 minutes of overlap (handoffs excluded) |
| `orphan` | NORDO STAND | A claim from an ended session that was never handed off is still within the TTL |
| `unattended` | UNIDENTIFIED | A worktree has changed files but no session holds it |
| `no-workspace` | NO CONTACT | A Linear ticket is in a started state but the worktree its branch points to doesn't exist |
