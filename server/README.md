# server — the atc API

**English** · [한국어](README.ko.md)

Node 24 + Hono. Every 2 seconds it reads Claude Code, Codex, git, Linear and GitHub PRs, merges them into one `Snapshot`, and pushes it to the web UI over SSE. It also records events and samples (FLIGHT RECORDER), keeps the CONTROLLER's CLEARANCEs, DISPATCH proposals and OCC SCHEDULE drafts, and serves `web/dist`. It never writes to git, worktrees, Linear or GitHub (`gh` is only used to list PRs).

Node runs the TypeScript files directly; there is no build step for the server.

```bash
npm start          # node server/index.ts on 127.0.0.1:7700
npm run dev        # API on :7701 with --watch (vite serves the UI on :7700)
npm test           # node --test for server/**/*.test.ts, hooks and controller
```

## The loop

`index.ts` runs `tick()` every 2 seconds:

1. `buildSnapshot()` (`snapshot.ts`) reads the sources, joins session ─ claim ─ worktree ─ ticket, decides handoffs and conflicts (`occupancy.ts`), computes alerts and checks each open PR for CLEARED TO LAND (`landing.ts`).
2. `diffSnapshots()` (`events.ts`) turns the difference from the previous snapshot into events; each is written to the FLIGHT RECORDER.
3. Every 5 minutes, once the snapshot is warm (Linear, git and GitHub read at least once), it records a traffic sample and runs DISPATCH (`runDispatch`).
4. If anything besides the timestamp changed, the snapshot goes to every SSE listener.

Each tick also checks `web/dist/index.html` (only re-read when its mtime or size changes) for the entry script the page loads, `/assets/index-<hash>.js`. That path is the build id: a restart with the same bundle keeps it, a rebuild changes it, even without a restart. No build gives `null`.

`/api/events` sends `event: version` (`{build, startedAt}`) and the current snapshot on connect, then each snapshot change, a new `version` whenever the build id changes, and a `ping` every 25 seconds. EventSource reconnects on its own after a restart, so open tabs learn about a deploy without polling and show the "새 버전이 배포됨 · 새로고침" notice.

## Sources (`sources/`)

| File | Reads | Gives |
|---|---|---|
| `claude.ts` | `~/.claude/sessions/*.json`, hook claim files, transcripts (`~/.claude/projects/…`) | Claude sessions, `hook` claims, `transcript` claims (ESTIMATED TRACK, same rules as `hooks/paths.mjs`) |
| `codex.ts` | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex sessions (busy if active in the last 90 s), `cwd` claims |
| `git.ts` | `git worktree list --porcelain` per AIRPORT | Worktrees, branch, HEAD, dirty state, last commit (details cached 30 s); ticket key from the branch name |
| `linear.ts` | Linear GraphQL (`LINEAR_API_KEY`), polled every 60 s, one read per team in `LINEAR_TEAM_KEYS` | Tickets, states (merged by name across teams), priorities, projects, relations; issue details for DISPATCH. A team that fails keeps its last result; a team never read fails the whole read |
| `linear-projects.ts` | Linear GraphQL, two read-only queries for projects and project milestones, run for every team in `LINEAR_TEAM_KEYS` and merged (`mergeByTeam`, `teams` on each), cached 10 min | Project `name`, `targetDate`, `progress` and `status { name type }` (as `state`: the type, else the name) for NETWORK route goals. Milestones (root `projectMilestones`, 50 per page up to 10 pages, 50 issues each with a `truncated` mark): `name`, `description`, `targetDate`, `progress` (0–100 → 0–1, pure `toMilestone`), `sortOrder`, `status`, and each issue's key, title, state and `completedAt`. Without a key or on error the goals are `null`; a milestone error only empties the WAYPOINTs |
| `github.ts` | `gh pr list --repo <owner/name> --state open --json …` per AIRPORT whose git remote is on GitHub, polled every 90 s in the background (`execFile`, no shell) | Open PRs per AIRPORT: head, checks, reviews, merge state, Draft. For non-Draft PRs without a passing head review or with Codex findings on the head, also the Codex bot's 👍 reactions, the head's committer date (cached per sha) and Codex's PR comments (`gh api`, read-only). A failed repository keeps its last result; errors show in `snapshot.github.error`. Without `gh`, `enabled` is false. For the LOGBOOK, `listMerged` reads the last 30 PRs merged into the default branch (`gh pr list --state merged --base <default>`, the default branch cached per repository) |

## Modules

| File | Role |
|---|---|
| `index.ts` | Entry: tick loop, SSE, mounts the APIs, serves `web/dist` |
| `config.ts` | Loads `.env.local` and environment variables ([deploy](../deploy/README.md#configuration)) |
| `model.ts` | Shared types: `Session`, `Airport`, `Workspace`, `Ticket`, `Claim`, `Handoff`, `Alert`, `Clearance`, `TrafficEvent`, `PullRequest`, `LandingBlockCode`, `Snapshot`. The web UI imports these directly |
| `snapshot.ts` | Merges sources, keeps fresh claims only, computes alerts and `pulls`. Snapshot fields: `linear` and `github` status (`{enabled, error, fetchedAt}`), `sessions`, `workspaces`, `tickets`, `columns`, `airports`, `claims`, `handoffs`, `alerts`, `clearances`, `pulls` (open PRs, CLEARED first) |
| `landing.ts` | CLEARED TO LAND conditions per PR (checks, review on the head, merge state, Draft, LOS), `readyAt` per head, LANDING SEQUENCE order (pure `buildPulls`, `landingBlocks`) |
| `autoland.ts` | AUTOLAND (ATC-34, [docs/occ.md](../docs/occ.md) 9.7): the switch and holds in `autoland.json` (`parseAutoland`, `saveAutoland`), state in `autoland-state.json`, the merge exclusions (pure `mergeExclusionOf`, `humanPreviewOf`), GROUND STOP latching (pure `latchGroundStops`), when an update is done (pure `settleOf`), and one action per AIRPORT with a tag per PR (pure `planAutoland`, shown as `snapshot.autoland`) |
| `autoland-run.ts` | AUTOLAND cycle on each new GitHub read: latch GROUND STOPs, settle updates, then `update-branch` (`expected_head_sha`) or the exact-head merge (`sha`), re-checking the switch and, for a merge, the PR itself right before writing; `autoland.jsonl` records; `GET /api/autoland`, `POST /api/autoland/hold`, `POST /api/autoland/groundstop/clear` |
| `judges/classify.ts` | Typed judges for SCHEDULE CLASSIFY (ATC-36, [docs/fleet.md](../docs/fleet.md) 6.1): the input allowlist (pure `classifyInputOf`, `bodyWithheld`), the questions (FLIGHT TYPE and WAKE Choices, a Noul per TYPE RATING), answer checks (`judgmentOf`) and the mark against the draft (`verdictOf`) |
| `judges/engines.ts` | Judge engines: `stub` (recorded responses, no network) and `jev` (`POST https://api.typesafe.ai/v1/systemone`, `jev-latest`, Bearer `TYPESAFE_API_KEY`; the key never appears in errors) |
| `judges/store.ts` | The `judges.json` switch (`off`/`replay`/`shadow`, default off), `judges.jsonl` records, per-family agreement through `crosscheckRateOf` (`judgeRateOf`), and the brief view that shows marks only after the SUPERVISOR's verdict (`judgesViewOf`) |
| `judges/run.ts` | Judge cycle on each warm snapshot while a switch is on: at most 3 drafts a minute, `replay` (judged drafts) or `shadow` (open drafts), picked by the pure `targetsOf` |
| `origin.ts` | `fromThisApp`: only a JSON request with a localhost `Origin` (this screen) may change settings, HOLDs or GROUND STOPs. `atcctl` sends no `Origin` |
| `occupancy.ts` | HANDOFF vs conflict vs brief visit from claim intervals `[since, lastAt]` |
| `airports.ts` | AIRPORT registry: auto-discovery under `~/projects`, identity by first commit hash, codes, open/close/rename/delete |
| `away.ts` | OUTSTATION: sessions holding a STAND outside their home AIRPORT (shared with the UI) |
| `callsign.ts` | Callsigns (`TEAM_A` → `ALPHA`) and FLIGHT NUMBERs (shared with the UI) |
| `version.ts` | Build id: the entry script path in `index.html` (pure `entryScript`), and whether a tab should show the new-version notice (pure `showNewVersion`, shared with the UI) |
| `events.ts` | Snapshot differences → events (alerts, handoffs, LANDING SEQUENCE `landing.requested` / `cleared` / `blocked` / `left`, lost sessions, OUTSTATION), with a cursor-based event log |
| `controller.ts` | CONTROLLER (TOWER) API: brief, ack, CLEARANCE issue / readback / cancel, the fixed message format, the LAND text for CLEARED PRs (pure `landTextOf`) |
| `clearances.ts` | CLEARANCE log: append-only JSONL folded into current state |
| `recorder.ts` | FLIGHT RECORDER: daily JSONL (`event`, `sample`, `dispatch`, `ack`, `schedule`, `checkride`), kept 30 days |
| `metrics.ts` | Operating metrics and the stage 2 readiness check (pure `computeMetrics`) |
| `logbook.ts` | LOGBOOK: every 10 minutes merged PRs → one `arrived` line per ARRIVED FLIGHT, `reverted` lines for merged Revert PRs (pure `buildEntry`, `planLogbook`, `foldLogbook`); TARGETS actuals for the FLEET cards (pure `computeActuals`, `expectationMin`); `GET /api/logbook`. AIRCRAFT and departure fall back to the DEPARTURE LOG, and `attributed` lines fill old unknown ones (pure `attribution`). `measured` lines add the brief (VECTORS / DIRECT), SOLO / CREW, rework commits and P0–P2 findings (pure `measureLines`); `GET /api/logbook/briefs` |
| `briefs.ts` | DIRECT briefs (ATC-32, pure): the brief fields from an issue body (`directSectionsOf`), the assignment text (`formatAssignment`), transcript events and a FLIGHT's brief facts (`talkEventsOf`, `briefFactsOf`), SOLO / CREW from writes in the STAND (`crewModeOf`), P0–P2 findings (`findingsOf`), rework commits (`reworkOf`), the VECTORS vs DIRECT comparison (`compareBriefs`) |
| `departures.ts` | DEPARTURE LOG: each warm tick compares claims and worktrees with the last AIRCRAFT per STAND and appends `stand` / `claim` / `handoff` lines (pure `diffDepartures`, `foldDepartures`); `matchDepartures` finds the AIRCRAFT and first time for a branch, FLIGHT or STAND |
| `crew-observed.ts` | OBSERVED CREW: the subagent calls under each AIRCRAFT's sessions in the last 14 days, from session metadata only (`subagents/*.meta.json` agentType and model, file time; `custom-title.json` for the session name), cached by mtime and rescanned at most every 30 s. Pure `parseMeta`, `positionOf` (agentType + model → declared POSITION), `observeCrew` (grouping and drift) |
| `crew-change.ts` | CREW CHANGE: when the complement of an in-service AIRCRAFT changes through `PATCH /api/fleet/:registration`, a text for the CAPTAIN, stored append-only. States pending → approved (SUPERVISOR, approval mode only) → sent (OCC `atcctl crew-change send`) → acknowledged (READBACK), or delivered / superseded (pure `diffCrew`, `ratingImpact`, `crewChangeText`, `crewChangeMessage`, `planCrewChange`, `foldCrewChanges`, `approveRefusal`, `sendRefusal`, `openCrewChangeOf`, `crewChangeBriefOf`, and `selfCheckCrewChange` for the 2b checklist); `withCrew` adds `observedCrew`, `crewDrift` and `pendingCrewChange` to the FLEET view; `GET /api/fleet/crew-changes`, `…/crew-changes/brief`, `…/crew-changes/:id`, `POST /api/fleet/:registration/crew-change/:id/{approve,delivered}`, `POST /api/fleet/crew-changes/:id/{send,readback}` |
| `checkride.ts` | CHECKRIDE: each FLIGHT's required rating from labels or accepted SCHEDULE CLASSIFY drafts (pure `flightRating`), GRANT / REVIEW / BLOCKED / BUILDING / HOLDS per AIRCRAFT and rating (pure `judge`, `checkrideRows`); `GET /api/fleet/checkride`, and `POST /api/fleet/:registration/checkride` for the SUPERVISOR's grant or revoke through `applyPatch`, recorded as a `checkride` line |
| `routes.ts` | ROUTE MAP (read-only, [docs/routes.md](../docs/routes.md)): WAYPOINT state (pure `waypointStates`), FLIGHT phase (`phaseOf`, `isBlocked`), exit criteria (`criteriaOf`), 28-day completions (`completedIn`: LOGBOOK ARRIVED ∪ Linear `completedAt`), cumulative ETA (`etaOf`) and late mark (`isLate`), put together by `buildRoutes`; AIRCRAFT from `following.targetsOf`. `GET /api/routes` |
| `briefing.ts` | DISPATCH card BRIEFING (ATC-4, [docs/dispatch.md](../docs/dispatch.md) 5.5): the three lines OCC writes (pure `parseBriefing`), the server facts line (pure `factsOf`, `waypointIndex` over `routes.ts`: PRIORITY, wait days, ROUTE and WAYPOINT, prerequisites, the AIRCRAFT's recent FLIGHTs on the ROUTE, CROSSCHECK), and the fallback lead (pure `firstSentence`; `leadOf` reads the body from Linear in the background, cached 30 min) |
| `blind.ts` | DISPATCH blind sample (ATC-6, [docs/dispatch.md](../docs/dispatch.md) 5.6): about 1 in 5 proposals by FNV-1a hash of the id (pure `isBlind`), and the agreement on blind verdicts among the gate's decided ones (pure `blindStatsOf`, shown as `gate.blind`) |
| `network.ts` | NETWORK (stage 4, read-only): per ROUTE open FLIGHTs, 14-day ARRIVED, AIRCRAFT and landing wait (pure `routeRows`, `openPhase`); per AIRCRAFT TARGETS vs `fleetView` actuals (pure `aircraftRows`); 28-day LOGBOOK and gate trends (pure `logbookTrend`, `gateTrend` over the `proposals.ts` / `schedule.ts` folds and `crosscheckRateOf`); `GET /api/network` |
| `dispatch.ts` | DISPATCH planning: candidates, slots, scores (pure `planDispatch`); settings in `dispatch.json`, including `teamAirports` and `candidateTeams` (`airportOfTicket`, `candidateTeamsOf`) |
| `linear-keys.ts` | Linear team and issue keys: `parseTeamKeys` (`LINEAR_TEAM_KEY` + `LINEAR_TEAM_KEYS`), keys in branch/worktree names and PR titles for every team read |
| `proposals.ts` | DISPATCH proposal log (append-only JSONL), state transitions (shadow verdicts; approve → sent → accepted → departed; STAND-free: departed at READBACK → arrived on the CAPTAIN's report), reservations, FLIGHT PLAN text (DIRECT brief, reads the issue body at release), brief, stage 2b and 3 gates, code facts for the 2b checklist (`selfCheck2b`) |
| `readiness.ts` | The "2b 켜기 점검표" (pure `readiness2bOf`, `vocadoReadbackOf`, `sendGuardOf`; code facts from `selfCheck2b` and `selfCheckCrewChange`; `vocado-readback` needs both `[DISPATCH D-xxxx]` and `[OCC CC-xxxx]` rules); reads `occ/send-guard.mjs` and vocado `CLAUDE.md` read-only (`ATC_VOCADO_CLAUDE_MD`, else `<projectsDir>/vocado_nextjs/CLAUDE.md`) |
| `schedule.ts` | OCC SCHEDULE draft log (append-only JSONL, S1 shadow): `CLASSIFY` / `PRIORITIZE` drafts and `NEW` (AD HOC FLIGHT from the CHARTER DESK: body sections, project / tail / key checks, `similar` titles from the snapshot, which covers the last 45 days), the 5-open-draft limit, SUPERSEDED / EXPIRED sync, shadow verdicts, candidates, the S2 gate |
| `waypoint-gaps.ts` | WAYPOINT gaps for OCC (ATC-8, [docs/occ.md](../docs/occ.md) 5.6): per ROUTE the active and next WAYPOINT with exit criteria (or the description), issues and `truncated` (pure `waypointGapsOf`, over `routes.ts` `waypointStates` and `criteriaOf`). Matching criteria to issues is left to OCC |
| `network-drafts.ts` | OCC `TARGET`/`ROUTE` drafts (ATC-25, [docs/fleet.md](../docs/fleet.md) 7.4): checks (same as `applyPatch`, step limits, 3 ARRIVED in 14 days, not AOG or retired), evidence from the NETWORK functions, changes against the FLEET profile, supersede reasons. `schedule.ts` plugs them in; shadow verdicts only |
| `waypoint-gates.ts` | atc gates on WAYPOINT exit criteria ([docs/routes.md](../docs/routes.md) step 6): rules that match an exit criterion to the DISPATCH/SCHEDULE gate, the 2b readiness checklist, the modes, the ATFM turn-on rows or RECALL, and turn it into a check (`criterionCheck`, pure). `routes.ts` gathers the facts (60 s cache) and adds `checks` to each WAYPOINT |
| `waypoint-slips.ts` | WAYPOINT ETAs and slip warnings for OCC (ATC-24, [docs/occ.md](../docs/occ.md) 5.7): `waypointEtasOf` over the ROUTE MAP, `slipOf` (`target-passed`, `eta-after-target`, `linear-overdue`), and the reported keys in `waypoint-slips.json` (`ackSlips`, like FOLLOWING) |
| `crosscheck.ts` | CROSSCHECK marks shared by DISPATCH and SCHEDULE: input checks (agree/disagree, reason ≤ 500 characters), the match rate against human decisions, calibration examples, how a decision was made (`via`, pure `viaOf`) and the one-click count (pure `oneClickOf`) |
| `reasons.ts` | DISPATCH reject reason chips (`REASON_CODES`), input check, the stored `reason` text (pure `composeReason`), per-chip counts |

Every `*.test.ts` next to a module is its unit test.

## API

| Method and path | What it does |
|---|---|
| `GET /api/snapshot` | The current snapshot |
| `GET /api/events` | SSE stream: `version` on connect and on change, `snapshot` on connect and on change, `ping` |
| `GET /api/version` | `{build, startedAt}`: the served bundle (`/assets/index-<hash>.js`, `null` without a build) and the server start time |
| `GET /api/airports` | All AIRPORTs with state |
| `POST /api/airports` | Open an AIRPORT `{path, code?, name?}` |
| `PATCH /api/airports/:id` | Rename, change code, close or reopen `{code?, name?, closed?}` |
| `DELETE /api/airports/:id` | Remove a manually opened AIRPORT |
| `GET /api/controller/brief?consumer=controller` | Events since the last ack + current state (CLEARED `landingQueue` entries carry `repoSeq` and `landText`) |
| `POST /api/controller/ack` | Mark a brief handled `{cursor}` |
| `POST /api/clearances` | Record a CLEARANCE `{to, type, stand?, flight?, text}`, returns the message to send |
| `POST /api/clearances/:id/readback` · `/cancel` | Confirm READBACK · cancel |
| `GET /api/metrics?days=1..30` | Operating metrics |
| `GET /api/routes` | ROUTE MAP: per ROUTE open FLIGHTs, AIRCRAFT, completion rate and WAYPOINTs with FLIGHTs, exit criteria and ETA (read-only) |
| `GET /api/network` | NETWORK overview: routes, AIRCRAFT TARGETS vs actuals, 28-day trends, source availability (read-only) |
| `GET /api/dispatch/brief` | DISPATCH plan, open and recent proposals (`via`, `reasonCodes`), 2b gate (`crosscheck.oneClick`, `reasonCounts`), `gate3.standFree`, the 2b readiness checklist `readiness2b` (`readiness.ts`), FLIGHT summaries, reject chips `reasonCodes: [{code, label}]`; `briefs` per open and HELD card (`facts`, `lead`) |
| `POST /api/dispatch/proposals/:id/verdict` | SUPERVISOR's shadow verdict `{verdict: "agree" \| "disagree", reason?, via?, reasonCodes?}` (`reasonCodes` with `disagree` only; 400 on an unknown code) |
| `POST /api/dispatch/proposals/:id/note` | DISPATCH review note `{text, caution?}` |
| `POST /api/dispatch/proposals/:id/briefing` | BRIEFING `{what, why, risk}` (open or HELD only; replaces the previous one) |
| `POST /api/dispatch/proposals/:id/hold` | DISPATCH sets a prerequisite HOLD `{blockedBy: ["VOC-180"]}`; the proposal moves to HELD. `[]` holds with no prerequisite (needs a note) |
| `POST /api/dispatch/proposals/:id/unhold` | SUPERVISOR releases a HOLD (the proposal is superseded) |
| `POST /api/dispatch/proposals/:id/{approve,reject}` | SUPERVISOR decision in approval mode; both take `{via?}`, `reject` also `{reason?, reasonCodes?}` |
| `POST /api/dispatch/proposals/:id/release` | Approved → SENT; returns `sendTo` and the FLIGHT PLAN text |
| `POST /api/dispatch/proposals/:id/{accept,decline}` | CAPTAIN READBACK, or decline with `{reason}`. A STAND-free FLIGHT is DEPARTED at the READBACK (`readbackOps`) |
| `POST /api/dispatch/proposals/:id/arrived` | OCC records the CAPTAIN's report `{note}` for a STAND-free DEPARTED FLIGHT → ARRIVED |
| `GET /api/dispatch/proposals/:id` | One proposal and the current mode (for send-guard) |
| `POST /api/dispatch/mode` | Switch `{mode: "shadow" \| "approval"}` (saved in `dispatch.json`) |
| `GET /api/dispatch/flight/:key` | Ticket body and comments from Linear (read-only) |
| `GET /api/dispatch/flight/:key/brief?to=TEAM_X` | DIRECT assignment text for that FLIGHT, `{key, brief, text}` (Linear, read-only) |
| `GET /api/schedule/brief` | SCHEDULE mode (`shadow`), open drafts with what each would change, drafts closed in the last 7 days (`via`), S2 gate (`crosscheck.oneClick`), open-draft limit, candidates, FLIGHT summaries; `waypointGaps` (ATC-8); `waypointEtas` and `slips` with `fresh` (ATC-24); `judges` (ATC-36: switch, per-family agreement, marks on judged drafts only) |
| `POST /api/schedule/slips/ack` | Record WAYPOINT slip warnings OCC reported (`{keys?}`, all fresh ones without keys) in `waypoint-slips.json` |
| `GET /api/schedule/ops/:id` | One SCHEDULE operation and the mode |
| `POST /api/schedule/ops` | OCC draft. `CLASSIFY` / `PRIORITIZE`: `{kind, flight, reason, type?, wake?, ratings?, priority?}`. `NEW`: `{kind: "NEW", title, body, project, reason, priority?, type?, wake?, ratings?, tail?, parent?, related?, blockedBy?}` → op with `flight: null` and `payload.similar: [{key, title}]`. 400 on bad input, 409 at the open-draft limit |
| `POST /api/schedule/ops/:id/verdict` | SUPERVISOR's shadow verdict `{verdict: "agree" \| "disagree", reason?, via?}` |
| `POST /api/schedule/ops/:id/approve`, `/reject` | S2 only: SUPERVISOR approves, or rejects with `{reason?}`; both take `{via?}` |
| `POST /api/schedule/ops/:id/release` | S2 only: OCC releases an approved operation; returns the exact Linear calls (the same ones again if already released) |
| `GET /api/schedule/released` | Mode and every released call, each with `used` (read by linear-guard) |
| `POST /api/schedule/released/claim` | `{tool, input}`: linear-guard claims a matching released call once; a used or unknown call answers 409 |
| `POST /api/schedule/mode` | `{mode: shadow\|approval}` |
| `GET /api/autoland` | AUTOLAND config, state, the current plan (`view`) and the last 50 records |
| `POST /api/autoland/hold` | SUPERVISOR only (this screen): `{repo, number, hold}` marks or clears HOLD on a PR |
| `POST /api/autoland/groundstop/clear` | SUPERVISOR only (this screen): `{airport}` clears the AUTOLAND GROUND STOP; that main SHA won't stop it again |

## State on disk

Everything lives under `ATC_STATE_DIR` (default `~/.local/state/atc`), outside git:

| Path | Written by | Contents |
|---|---|---|
| `claims/<sessionId>/*.json` | the [claim hook](../hooks/README.md) | Worktree claims (read-only for the server) |
| `airports.json` | `airports.ts` | AIRPORT registry |
| `clearances.jsonl` | `clearances.ts` | CLEARANCE log (append-only) |
| `crew-changes.jsonl` | `crew-change.ts` | CREW CHANGE texts (append-only; `created`, `approved`, `sent` with the exact message, `acknowledged`, `delivered`, `superseded` lines) |
| `consumers/<name>.json` | `controller.ts` | Brief cursor per consumer |
| `flight-recorder/YYYY-MM-DD.jsonl` | `recorder.ts` | FLIGHT RECORDER (UTC days, 30-day retention) |
| `logbook.jsonl` | `logbook.ts` | LOGBOOK of ARRIVED FLIGHTs (append-only; `arrived`, `reverted`, `attributed` and `measured` lines) |
| `departures.jsonl` | `departures.ts` | DEPARTURE LOG: first STAND or claim of a FLIGHT and HANDOFFs, written only on change (append-only) |
| `proposals.jsonl` | `proposals.ts` | DISPATCH proposals (append-only) |
| `schedule.jsonl` | `schedule.ts` | OCC SCHEDULE drafts and SUPERVISOR verdicts (append-only) |
| `autoland.json` | `autoland.ts` | AUTOLAND switch (`mode`, default off), `airports`, `mergeMethod`, `applicationCheck`, `holds` (written atomically) |
| `autoland-state.json` | `autoland-run.ts` | AUTOLAND updates in flight, GROUND STOPs, cleared main SHAs, skipped and merged heads |
| `autoland.jsonl` | `autoland-run.ts` | AUTOLAND records: every update, merge, result, GROUND STOP, switch and HOLD change (append-only) |
| `judges.json` | `judges/store.ts` | Judge family switches (`jev`: `off`, `replay`, `shadow`; default off). SUPERVISOR only, through Settings (written atomically) |
| `judges.jsonl` | `judges/run.ts` | Judge marks (`judge`: family, draft, classification, verdict, engine, model, what was sent) and switch changes (`mode`), append-only |
| `dispatch.json` | you (optional; defaults apply without it) | DISPATCH settings: project → AIRPORT mapping, slots, weights, mode (`shadow` / `approval`) |
