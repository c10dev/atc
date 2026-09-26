# server — the atc API

**English** · [한국어](README.ko.md)

Node 24 + Hono. Every 2 seconds it reads Claude Code, Codex, git and Linear, merges them into one `Snapshot`, and pushes it to the web UI over SSE. It also records events and samples (FLIGHT RECORDER), keeps the CONTROLLER's CLEARANCEs and DISPATCH proposals, and serves `web/dist`. It never writes to git, worktrees or Linear.

Node runs the TypeScript files directly; there is no build step for the server.

```bash
npm start          # node server/index.ts on 127.0.0.1:7700
npm run dev        # API on :7701 with --watch (vite serves the UI on :7700)
npm test           # node --test for server/**/*.test.ts, hooks and controller
```

## The loop

`index.ts` runs `tick()` every 2 seconds:

1. `buildSnapshot()` (`snapshot.ts`) reads the sources, joins session ─ claim ─ worktree ─ ticket, decides handoffs and conflicts (`occupancy.ts`) and computes alerts.
2. `diffSnapshots()` (`events.ts`) turns the difference from the previous snapshot into events; each is written to the FLIGHT RECORDER.
3. Every 5 minutes, once the snapshot is warm (Linear and git fully read), it records a traffic sample and runs DISPATCH (`runDispatch`).
4. If anything besides the timestamp changed, the snapshot goes to every SSE listener.

`/api/events` sends the current snapshot on connect, then each change, plus a `ping` every 25 seconds.

## Sources (`sources/`)

| File | Reads | Gives |
|---|---|---|
| `claude.ts` | `~/.claude/sessions/*.json`, hook claim files, transcripts (`~/.claude/projects/…`) | Claude sessions, `hook` claims, `transcript` claims (ESTIMATED TRACK, same rules as `hooks/paths.mjs`) |
| `codex.ts` | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` | Codex sessions (busy if active in the last 90 s), `cwd` claims |
| `git.ts` | `git worktree list --porcelain` per AIRPORT | Worktrees, branch, HEAD, dirty state, last commit (details cached 30 s); ticket key from the branch name |
| `linear.ts` | Linear GraphQL (`LINEAR_API_KEY`), polled every 60 s | Tickets, states, priorities, projects, relations; issue details for DISPATCH |

## Modules

| File | Role |
|---|---|
| `index.ts` | Entry: tick loop, SSE, mounts the APIs, serves `web/dist` |
| `config.ts` | Loads `.env.local` and environment variables ([deploy](../deploy/README.md#configuration)) |
| `model.ts` | Shared types: `Session`, `Airport`, `Workspace`, `Ticket`, `Claim`, `Handoff`, `Alert`, `Clearance`, `TrafficEvent`, `Snapshot`. The web UI imports these directly |
| `snapshot.ts` | Merges sources, keeps fresh claims only, computes alerts |
| `occupancy.ts` | HANDOFF vs conflict vs brief visit from claim intervals `[since, lastAt]` |
| `airports.ts` | AIRPORT registry: auto-discovery under `~/projects`, identity by first commit hash, codes, open/close/rename/delete |
| `away.ts` | OUTSTATION: sessions holding a STAND outside their home AIRPORT (shared with the UI) |
| `callsign.ts` | Callsigns (`TEAM_A` → `ALPHA`) and FLIGHT NUMBERs (shared with the UI) |
| `events.ts` | Snapshot differences → events (alerts, handoffs, LANDING SEQUENCE, lost sessions, OUTSTATION), with a cursor-based event log |
| `controller.ts` | CONTROLLER (TOWER) API: brief, ack, CLEARANCE issue / readback / cancel, the fixed message format |
| `clearances.ts` | CLEARANCE log: append-only JSONL folded into current state |
| `recorder.ts` | FLIGHT RECORDER: daily JSONL (`event`, `sample`, `dispatch`, `ack`), kept 30 days |
| `metrics.ts` | Operating metrics and the stage 2 readiness check (pure `computeMetrics`) |
| `dispatch.ts` | DISPATCH planning: candidates, slots, scores (pure `planDispatch`); settings in `dispatch.json` |
| `proposals.ts` | DISPATCH proposal log (append-only JSONL), state transitions (shadow verdicts; approve → sent → accepted → departed), reservations, FLIGHT PLAN text, brief, stage 2b and 3 gates |

Every `*.test.ts` next to a module is its unit test.

## API

| Method and path | What it does |
|---|---|
| `GET /api/snapshot` | The current snapshot |
| `GET /api/events` | SSE stream of snapshots |
| `GET /api/airports` | All AIRPORTs with state |
| `POST /api/airports` | Open an AIRPORT `{path, code?, name?}` |
| `PATCH /api/airports/:id` | Rename, change code, close or reopen `{code?, name?, closed?}` |
| `DELETE /api/airports/:id` | Remove a manually opened AIRPORT |
| `GET /api/controller/brief?consumer=controller` | Events since the last ack + current state |
| `POST /api/controller/ack` | Mark a brief handled `{cursor}` |
| `POST /api/clearances` | Record a CLEARANCE `{to, type, stand?, flight?, text}`, returns the message to send |
| `POST /api/clearances/:id/readback` · `/cancel` | Confirm READBACK · cancel |
| `GET /api/metrics?days=1..30` | Operating metrics |
| `GET /api/dispatch/brief` | DISPATCH plan, open and recent proposals, 2b gate, FLIGHT summaries |
| `POST /api/dispatch/proposals/:id/verdict` | SUPERVISOR's shadow verdict `{verdict: "agree" \| "disagree", reason?}` |
| `POST /api/dispatch/proposals/:id/note` | DISPATCH review note `{text, caution?}` |
| `POST /api/dispatch/proposals/:id/{approve,reject}` | SUPERVISOR decision in approval mode; `reject` takes `{reason?}` |
| `POST /api/dispatch/proposals/:id/release` | Approved → SENT; returns `sendTo` and the FLIGHT PLAN text |
| `POST /api/dispatch/proposals/:id/{accept,decline}` | CAPTAIN READBACK, or decline with `{reason}` |
| `GET /api/dispatch/proposals/:id` | One proposal and the current mode (for send-guard) |
| `POST /api/dispatch/mode` | Switch `{mode: "shadow" \| "approval"}` (saved in `dispatch.json`) |
| `GET /api/dispatch/flight/:key` | Ticket body and comments from Linear (read-only) |

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
| `dispatch.json` | you (optional; defaults apply without it) | DISPATCH settings: project → AIRPORT mapping, slots, weights, mode (`shadow` / `approval`) |
