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
| `linear.ts` | Linear GraphQL (`LINEAR_API_KEY`), polled every 60 s | Tickets, states, priorities, projects, relations; issue details for DISPATCH |
| `github.ts` | `gh pr list --repo <owner/name> --state open --json …` per AIRPORT whose git remote is on GitHub, polled every 90 s in the background (`execFile`, no shell) | Open PRs per AIRPORT: head, checks, reviews, merge state, Draft. For non-Draft PRs without a passing head review or with Codex findings on the head, also the Codex bot's 👍 reactions, the head's committer date (cached per sha) and Codex's PR comments (`gh api`, read-only). A failed repository keeps its last result; errors show in `snapshot.github.error`. Without `gh`, `enabled` is false |

## Modules

| File | Role |
|---|---|
| `index.ts` | Entry: tick loop, SSE, mounts the APIs, serves `web/dist` |
| `config.ts` | Loads `.env.local` and environment variables ([deploy](../deploy/README.md#configuration)) |
| `model.ts` | Shared types: `Session`, `Airport`, `Workspace`, `Ticket`, `Claim`, `Handoff`, `Alert`, `Clearance`, `TrafficEvent`, `PullRequest`, `LandingBlockCode`, `Snapshot`. The web UI imports these directly |
| `snapshot.ts` | Merges sources, keeps fresh claims only, computes alerts and `pulls`. Snapshot fields: `linear` and `github` status (`{enabled, error, fetchedAt}`), `sessions`, `workspaces`, `tickets`, `columns`, `airports`, `claims`, `handoffs`, `alerts`, `clearances`, `pulls` (open PRs, CLEARED first) |
| `landing.ts` | CLEARED TO LAND conditions per PR (checks, review on the head, merge state, Draft, LOS), `readyAt` per head, LANDING SEQUENCE order (pure `buildPulls`, `landingBlocks`) |
| `occupancy.ts` | HANDOFF vs conflict vs brief visit from claim intervals `[since, lastAt]` |
| `airports.ts` | AIRPORT registry: auto-discovery under `~/projects`, identity by first commit hash, codes, open/close/rename/delete |
| `away.ts` | OUTSTATION: sessions holding a STAND outside their home AIRPORT (shared with the UI) |
| `callsign.ts` | Callsigns (`TEAM_A` → `ALPHA`) and FLIGHT NUMBERs (shared with the UI) |
| `version.ts` | Build id: the entry script path in `index.html` (pure `entryScript`), and whether a tab should show the new-version notice (pure `showNewVersion`, shared with the UI) |
| `events.ts` | Snapshot differences → events (alerts, handoffs, LANDING SEQUENCE `landing.requested` / `cleared` / `blocked` / `left`, lost sessions, OUTSTATION), with a cursor-based event log |
| `controller.ts` | CONTROLLER (TOWER) API: brief, ack, CLEARANCE issue / readback / cancel, the fixed message format, the LAND text for CLEARED PRs (pure `landTextOf`) |
| `clearances.ts` | CLEARANCE log: append-only JSONL folded into current state |
| `recorder.ts` | FLIGHT RECORDER: daily JSONL (`event`, `sample`, `dispatch`, `ack`, `schedule`), kept 30 days |
| `metrics.ts` | Operating metrics and the stage 2 readiness check (pure `computeMetrics`) |
| `dispatch.ts` | DISPATCH planning: candidates, slots, scores (pure `planDispatch`); settings in `dispatch.json` |
| `proposals.ts` | DISPATCH proposal log (append-only JSONL), state transitions (shadow verdicts; approve → sent → accepted → departed), reservations, FLIGHT PLAN text, brief, stage 2b and 3 gates |
| `schedule.ts` | OCC SCHEDULE draft log (append-only JSONL, S1 shadow): `CLASSIFY` / `PRIORITIZE` drafts and `NEW` (AD HOC FLIGHT from the CHARTER DESK: body sections, project / tail / key checks, `similar` titles from the snapshot, which covers the last 45 days), the 5-open-draft limit, SUPERSEDED / EXPIRED sync, shadow verdicts, candidates, the S2 gate |
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
| `GET /api/dispatch/brief` | DISPATCH plan, open and recent proposals (`via`, `reasonCodes`), 2b gate (`crosscheck.oneClick`, `reasonCounts`), FLIGHT summaries, reject chips `reasonCodes: [{code, label}]` |
| `POST /api/dispatch/proposals/:id/verdict` | SUPERVISOR's shadow verdict `{verdict: "agree" \| "disagree", reason?, via?, reasonCodes?}` (`reasonCodes` with `disagree` only; 400 on an unknown code) |
| `POST /api/dispatch/proposals/:id/note` | DISPATCH review note `{text, caution?}` |
| `POST /api/dispatch/proposals/:id/hold` | DISPATCH sets a prerequisite HOLD `{blockedBy: ["VOC-180"]}`; the proposal moves to HELD. `[]` holds with no prerequisite (needs a note) |
| `POST /api/dispatch/proposals/:id/unhold` | SUPERVISOR releases a HOLD (the proposal is superseded) |
| `POST /api/dispatch/proposals/:id/{approve,reject}` | SUPERVISOR decision in approval mode; both take `{via?}`, `reject` also `{reason?, reasonCodes?}` |
| `POST /api/dispatch/proposals/:id/release` | Approved → SENT; returns `sendTo` and the FLIGHT PLAN text |
| `POST /api/dispatch/proposals/:id/{accept,decline}` | CAPTAIN READBACK, or decline with `{reason}` |
| `GET /api/dispatch/proposals/:id` | One proposal and the current mode (for send-guard) |
| `POST /api/dispatch/mode` | Switch `{mode: "shadow" \| "approval"}` (saved in `dispatch.json`) |
| `GET /api/dispatch/flight/:key` | Ticket body and comments from Linear (read-only) |
| `GET /api/schedule/brief` | SCHEDULE mode (`shadow`), open drafts with what each would change, drafts closed in the last 7 days (`via`), S2 gate (`crosscheck.oneClick`), open-draft limit, candidates, FLIGHT summaries |
| `GET /api/schedule/ops/:id` | One SCHEDULE operation and the mode |
| `POST /api/schedule/ops` | OCC draft. `CLASSIFY` / `PRIORITIZE`: `{kind, flight, reason, type?, wake?, ratings?, priority?}`. `NEW`: `{kind: "NEW", title, body, project, reason, priority?, type?, wake?, ratings?, tail?, parent?, related?, blockedBy?}` → op with `flight: null` and `payload.similar: [{key, title}]`. 400 on bad input, 409 at the open-draft limit |
| `POST /api/schedule/ops/:id/verdict` | SUPERVISOR's shadow verdict `{verdict: "agree" \| "disagree", reason?, via?}` |
| `POST /api/schedule/ops/:id/approve`, `/reject` | S2 only: SUPERVISOR approves, or rejects with `{reason?}`; both take `{via?}` |
| `POST /api/schedule/ops/:id/release` | S2 only: OCC releases an approved operation; returns the exact Linear calls (the same ones again if already released) |
| `GET /api/schedule/released` | Mode and every released call (read by linear-guard) |
| `POST /api/schedule/mode` | `{mode: shadow\|approval}` |

## State on disk

Everything lives under `ATC_STATE_DIR` (default `~/.local/state/atc`), outside git:

| Path | Written by | Contents |
|---|---|---|
| `claims/<sessionId>/*.json` | the [claim hook](../hooks/README.md) | Worktree claims (read-only for the server) |
| `airports.json` | `airports.ts` | AIRPORT registry |
| `clearances.jsonl` | `clearances.ts` | CLEARANCE log (append-only) |
| `consumers/<name>.json` | `controller.ts` | Brief cursor per consumer |
| `flight-recorder/YYYY-MM-DD.jsonl` | `recorder.ts` | FLIGHT RECORDER (UTC days, 30-day retention) |
| `proposals.jsonl` | `proposals.ts` | DISPATCH proposals (append-only) |
| `schedule.jsonl` | `schedule.ts` | OCC SCHEDULE drafts and SUPERVISOR verdicts (append-only) |
| `dispatch.json` | you (optional; defaults apply without it) | DISPATCH settings: project → AIRPORT mapping, slots, weights, mode (`shadow` / `approval`) |
