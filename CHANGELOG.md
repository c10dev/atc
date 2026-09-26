# Changelog

**English** · [한국어](CHANGELOG.ko.md)

All notable changes to atc are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- FLIGHT classification in the planner ([docs/fleet.md](docs/fleet.md) step 3): Linear labels `type:`, `wake:` and `rating:` (and any Risk-group label as `SEC`). A FLIGHT goes only to an AIRCRAFT holding every required TYPE RATING whose crew can fly its type. Slots are counted by WAKE (L 0.5, M 1, H 2), `wake:J` is excluded until split, and a new ROUTE factor adds +1 for the AIRCRAFT's own projects. When no AIRCRAFT could ever qualify, the FLIGHT is excluded with the reason. Linear label-group children are now read as `group:name` (e.g. `Risk:Security`). The DISPATCH card shows the classification.
- FLEET registry and tab ([docs/fleet.md](docs/fleet.md) step 2): `~/.local/state/atc/fleet.json` holds each team's CREW COMPLEMENT, TYPE RATINGS (`SEC`, `UI`, `DATA`, `DOCS`), ROUTES and TARGETS, with defaults from the vocado crew rules. `SEC` is refused for a crew without a member able to do security work. The FLEET tab shows every AIRCRAFT with its status (AIRBORNE / HOLDING / PARKED), current FLIGHTs and profile, and edits it (`GET /api/fleet`, `PATCH /api/fleet/:registration`). The planner does not use it yet.
- FLEET design draft ([docs/fleet.md](docs/fleet.md), English only for now): teams as a FLEET with CREW COMPLEMENT, TYPE RATINGS, ROUTES and TARGETS in a `fleet.json` registry, and FLIGHT classification on three axes (FLIGHT TYPE `BUILD`/`MAINT`/`TEST`/`SURVEY`/`CHECK`/`FERRY`, WAKE CATEGORY `L`/`M`/`H`/`J`, required TYPE RATING `SEC`/`UI`/`DATA`/`DOCS`) as Linear labels the planner uses. `lane:TEAM_X` is to be renamed TAIL ASSIGNMENT (`tail:TEAM_X`).
- OCC session, stage S0 (`occ/`, [docs/occ.md](docs/occ.md)). The DISPATCH session folder moved from `dispatch/` to `occ/` and keeps its work (proposal review, HOLD, FLIGHT PLAN, READBACK). OCC adds flight following: read-only `gh pr view|checks|diff|list` through `guard.mjs --gh-read`. `occ/mcp-guard.mjs` lets only read MCP tools through, so OCC cannot write to Linear or GitHub in S0.
- `atcctl manual check` / `manual ack`: a control session's `/tick` (OCC and TOWER) starts by checking whether its `CLAUDE.md` or `/tick` changed since the last ack, and rereads them if so.
- TAIL ASSIGNMENT, the `tail:TEAM_X` Linear label (first shipped as `lane:TEAM_X`, which stays an alias until 2026-10-10 and asks to be renamed in the exclusion reason): the planner proposes that FLIGHT only to that team. If the team cannot take it (AIRBORNE, HOLDING, no such session, another AIRPORT), the FLIGHT is excluded with the reason instead of going to another team.
- OCC design draft ([docs/occ.md](docs/occ.md), English only for now). atc splits into two control sessions: OCC (operations: schedule, dispatch, flight following) and ATC (traffic: TOWER, later flow management). DISPATCH and the President session merge into OCC, and OCC gains guarded Linear writes through SCHEDULE operations, staged shadow → approval → automatic for low risk.
- Parent issues (a Linear issue with `children`, or named as another's `parent`) are no longer treated as work. They get no ASSIGN proposal, no RELEASE proposal however long they sit ENROUTE without a STAND, and no NO CONTACT alert — their children are the work. The board query now reads `parent` / `children`, and the DISPATCH tab lists them under "excluded" with the child count.
- `dispatch note --hold <FLIGHT>`: the DISPATCH session can name a prerequisite written only in the ticket body, with no `blocks` relation. The proposal moves to a new HELD list on the DISPATCH tab; its own FLIGHT stays reserved so the planner will not offer it again (its AIRCRAFT is left free for other FLIGHTs), it cannot be sent, and it carries a `HOLD — 선행 FLIGHT …` line in the FLIGHT PLAN. Once every named FLIGHT is done, atc supersedes the proposal so the planner can offer it again. A bare `--hold` holds a proposal with no prerequisite FLIGHT (waiting on a human decision; the note is the reason) and is released when the FLIGHT is edited after the HOLD. A HOLD never expires after 24 hours; it also closes when the FLIGHT itself leaves Todo, or when the SUPERVISOR presses "HOLD 풀기" (`POST /api/dispatch/proposals/:id/unhold`). Prerequisites must be keys in the open FLIGHT list and cannot be the proposal's own FLIGHT.
- FLIGHTs with no priority are not ASSIGN candidates: nobody has decided when to do them yet. They are listed under "excluded".
- Rejection reason chips in the DISPATCH tab. Rejecting a proposal now offers a list of reasons (parent issue, prerequisite only in the body, waiting on a human decision, already in progress, low priority, no slot, another team fits better, already done) plus an optional memo, stored as `"<chip> — <memo>"` in the proposal's reason.
- The SUPERSEDED reason now reuses the plan's exclusion reason. When a FLIGHT drops out because it is a parent issue, held, labelled or already has a STAND, that reason (`HOLD D-0005 — 선행 FLIGHT 대기`) is recorded instead of "더 나은 배정으로 바뀜".
- DISPATCH stage 2b approval operation, off by default behind `mode` (`shadow` / `approval`). In approval mode the SUPERVISOR approves or rejects proposals in the DISPATCH tab; DISPATCH sends approved ASSIGNs to the CAPTAIN as a fixed FLIGHT PLAN (`dispatch release`), records `READBACK D-xxxx` or a decline, and atc marks the proposal DEPARTED when a STAND for the FLIGHT appears. Approved, sent and accepted proposals reserve their AIRCRAFT and FLIGHT. The tab gains an IN FLIGHT list with NO READBACK / NO DEPARTURE flags, a stage 3 (ATFM) check and a confirmed mode switch.
- `dispatch/send-guard.mjs`: DISPATCH's SendMessage goes through only in approval mode, for a SENT proposal, to its CAPTAIN, with exactly the FLIGHT PLAN text atc generated.
- Settings panel tabs LINEAR and AGENTS. They show read-only server settings from the new `GET /api/settings`, which never returns secrets.
  - LINEAR: connection status, last sync, API key presence, team key, LANDING state.
  - AGENTS: session counts, session folders, claim hook installed or not, TTL and handoff grace.
- Release badge in the READMEs.
- This changelog.

### Changed
- SUPERSEDED reasons name the real rule even when the FLIGHT is no longer in the plan's exclusion list: STAND already exists, no priority, project not mapped, another operator's label. The planner and the reason text share one set of phrases, so they cannot drift apart.
- TOWER and DISPATCH hooks run from `$CLAUDE_PROJECT_DIR` and are fail-closed (`… || exit 2`): a missing or failing hook now blocks the tool instead of letting it through.
- FIDS split-flap motion looks like a real board. Tiles no longer go blank mid-flap: the new letter waits behind the falling flap, which speeds up like gravity and darkens as it tilts. Text without tiles (TIME, REMARKS, Glass Cockpit and Night Sky) drops in letter by letter instead of showing half-letters. At most 6 flaps per cell, and the board settles faster.

## [0.1.0] — 2026-09-26

First release. ✈️ Ready for takeoff.

### Added

#### Radar and screens
- RADAR: session ─ worktree ─ ticket columns joined by lines, highlighting worktrees with no owner and in-progress tickets with no worktree.
- FLIGHT STRIPS: one strip per session with status, STANDs held, tickets and CLEARANCEs.
- FIDS: a DEPARTURES board, as a list or a board by flight phase, with split-flap characters.
- AIRPORTS: repository registry with auto-discovery under `~/projects`, 4-letter codes, identity by first commit hash, and open / close / rename / delete.
- OUTSTATION: sessions holding a STAND outside their home AIRPORT.
- Aviation terms and phonetic callsigns throughout (`TEAM_A` → `ALPHA`).
- A scrolling ALERT ticker.
- Themes: Radar Console, Glass Cockpit and Night Sky.
- A settings panel: motion, clock (UTC / local), density (comfortable / compact), FIDS view and range.

#### Claims, handoffs and conflicts
- Claim hook (`hooks/claim.mjs`): a Claude Code `PostToolUse` hook that records which linked worktree each session works in. It counts edited files and `cd` / `git -C` in command position only. Echo strings, heredocs and read-only commands don't count.
- ESTIMATED TRACK: claims inferred from transcript tool calls when there is no hook record.
- Codex sessions, claimed by their cwd.
- Verdicts from claim intervals: HANDOFF, LOSS OF SEPARATION or brief visit.
- Alerts: LOSS OF SEPARATION, NORDO STAND, UNIDENTIFIED, NO CONTACT.

#### Stage 1 — CONTROLLER (TOWER)
- A guarded Claude session in `controller/` that reads a traffic brief and sends CLEARANCEs (TRAFFIC, HOLD, CONTINUE, LAND, REPORT, INFO) to team sessions.
- READBACK tracking on the flight strips.
- `atcctl` CLI and a Bash guard.

#### Stage 1.5 — FLIGHT RECORDER and METRICS
- An append-only daily log of events and 5-minute traffic samples, kept for 30 days.
- METRICS tab: conflicts, CLEARANCE READBACK rate and time, merge wait, and the stage 2 readiness check.

#### Stage 2a — DISPATCH (shadow operation)
- Assignment proposals: which FLIGHT (ticket) goes to which AIRCRAFT (team session), with per-factor scores and slots.
- RELEASE suggestions for neglected work.
- A guarded DISPATCH session in `dispatch/` that reviews proposals and adds notes and CAUTION.
- DISPATCH tab where the SUPERVISOR marks agree or disagree. Nothing is sent to anyone yet.

#### Operations and docs
- systemd user service (`deploy/atc.service`).
- English and Korean docs for the root README and every folder.
- MIT license.

[Unreleased]: https://github.com/chaehy5665/atc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chaehy5665/atc/releases/tag/v0.1.0
