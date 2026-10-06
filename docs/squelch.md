# SQUELCH design (skip a control `/tick` when nothing changed)

A radio's squelch keeps the speaker quiet until a real signal comes in. SQUELCH does the same for the control sessions. Before a `/loop`-scheduled `/tick` reaches the model, atc checks whether anything that session acts on has changed since its last pass. If nothing has changed, the prompt is dropped and the session spends no tokens.

> Status (2026-09-29): draft. S0 done (ATC-80): the hook path works ("S0 as probed" below), so the fallback is not needed. S1 is built (ATC-94, "S1 as built"): the server decides QUIET/OPEN per role. S2–S3 (hook, wiring), the v2 fingerprint (ATC-297) and the switch (ATC-552) are built. **Live mode (ATC-553, "Ships on as built" below): every control role runs `mode: on` with `fingerprint: v2` from the first start after deploy.** Earlier sections describe `shadow` as the starting point; that was true until ATC-553. Written from a usage reading of the last 4 hours of local transcripts (section 1).

Related: [fuel.md](fuel.md) (FUEL, `controlWake`, the 1 h cache tier on main transcripts), [fleet.md](fleet.md) 8.5–8.6 (how control sessions are launched, `/loop` intervals), [mcc.md](mcc.md) 4 (MCC pass), `controller/.claude/skills/tick/SKILL.md` and the other folders' `/tick`.

## 1. Current facts

Read on 2026-09-29 from local transcripts, 2026-09-28 20:36 to 2026-09-29 00:36 UTC. Only usage fields, tool names, command lines and short command outputs were read. Requests were deduped by `(message.id, sessionId)`. A tick counts as "working" when it ran a write command (`issue`, `readback`, `mcc inspect`, `dispatch note|briefing|crosscheck`, `schedule draft|crosscheck`, `landing review --verdict` …) or SendMessage.

| Session | Model | `/loop` | Ticks | Working ticks | Tokens | Tokens in non-working ticks |
|---|---|---|---|---|---|---|
| TOWER | `claude-sonnet-5` | 3 m | 80 | 1 (C-0090 LAND and READBACK) | 146.9 M | 143.9 M (98 %) |
| MCC | `claude-opus-5-5` | 5 m | 50 | 1 (INSPECTION of #147 and #148) | 81.4 M | 76.8 M (94 %) |
| OCC | `claude-sonnet-5` | 10 m | 24 | 2 (D-0057, D-0058 note and BRIEFING) | 57.4 M | 51.2 M (89 %) |
| CROSSCHECK | Muse via `ocx` | 10 m | 24 | 1 (D-0058 mark) | 19.2 M | 18.2 M (94 %) |
| REVIEW | DeepSeek via `ocx` | 10 m | 24 | 1 (#147, #148 reviews) | 8.7 M | 6.7 M (77 %) |
| **All** | | | **202** | **6** | **313.6 M** | **296.7 M (95 %)** |

- **The cost is re-reading, not deciding.** 97.8 % of all tokens in the window were cache reads, and only 130 K were output. A TOWER tick makes a median of 3 calls, and each call re-reads the whole context: up to 966 K before a compaction, 620 K on average. That comes to about 2.0 M tokens per tick. OCC ticks cost about 2.4 M (6 calls, 446 K context) and MCC ticks about 1.6 M.
- **Sticky signals repeat work.** MCC is in `shadow` mode, so its queue kept offering the same actions. It ran `mcc land 147 --head f2389ce` 48 times (`WOULD LAND (shadow) · auto` every time) and `mcc rts` 51 times (`WOULD RTS · 4cc5ac4 → c0ca22e` every time). The state never changed, but every tick acted on it again.
- **Every loop is a fixed interval.** Each session was started with `/loop <n>m /tick` (fleet.md 8.5–8.6). No part of atc decides whether a tick is needed; the model finds out by running the tick.
- **Team messages don't come through `/tick`.** A CAPTAIN's READBACK or report reaches TOWER or OCC as its own message. The `/tick` skills only say to handle messages received "before this pass".
- **Hooks already run in these sessions.** The guards (`PreToolUse`) run in `claude --bg` sessions and in the `ocx claude` tmux sessions (fleet.md 8.6, checked 2026-09-28). No folder has a `UserPromptSubmit` hook yet.
- **Main transcripts write the 1 h cache tier** (fuel.md section 1). A session that stays idle for more than an hour pays a full cache write of its context on the next call. That is the `controlWake` / `coldCache` leak.

## 2. Principles

1. **Skip, never decide.** SQUELCH only chooses between running the tick as usual and dropping it. It issues no CLEARANCE, marks nothing, and never changes a tick's content.
2. **Fail open.** If the server is down, the hook errors or times out, or a fingerprint can't be built, the tick runs. The guards fail closed (`… || exit 2`); SQUELCH is the opposite, and it must never be wired that way.
3. **Only the plain `/tick` is gated.** Any other prompt passes untouched: team messages, SUPERVISOR instructions, CHARTER REQUESTs, and `/tick` with arguments.
4. **Fingerprint what the tick acts on, not the clock.** Time-based rules already show up in the briefs as fields (`clearances.overdue`, `slotHold`, `overdue`, `slips[].fresh`), so they change the fingerprint by themselves. Volatile fields (`generatedAt`, ages, cursors that move without events) are left out.
5. **Code first, models later.** Every signal below is already structured JSON. SQUELCH needs no model. A judgment model such as Jev is considered only if a real case turns up that code can't settle (section 9).
6. **Shadow before on.** Like DISPATCH and MCC, SQUELCH first ran in `shadow` mode: it records what it would have dropped and drops nothing. (Since ATC-553 it ships on; the shadow log remains as the `would` fields.)

## 3. Terms

| Term | Meaning |
|---|---|
| SQUELCH | The gate in front of a control session's `/tick` |
| SIGNAL | A change in what that session acts on since its last pass. The session's fingerprint differs from the one recorded at that pass |
| QUIET | A `/tick` dropped because there is no SIGNAL |
| OPEN | A `/tick` let through, with the reason: `signal`, `manual` (rules changed), `heartbeat`, `fail-open` or `shadow` |
| HEARTBEAT | The longest a session may go without a tick. Once it passes, the next `/tick` opens even with no SIGNAL |

## 4. What each session's fingerprint covers

Each role reads the same data its own `/tick` reads. `manual check` = `CHANGED` opens every role.

| Role | Source | Fields in the fingerprint |
|---|---|---|
| TOWER | `brief` | `reset`; `events` non-empty (the events are unacked, so they always count); for `landingQueue[]`: PR, head, `blocks`, `slotHold`, `codex`/`extReview.status`, `review`; `open` items that call for a CLEARANCE or report (STAND holders, `clearances.overdue`, new `fuelLeaks` keys) |
| MCC | `mcc queue` | `mode`, `groundStop`; for `pulls[]`: PR, head, whether `inspection` exists, `blocks`; `rts.due` with its `from → to` |
| OCC | `dispatch brief`, `crew-change brief`, `schedule brief`, `following` | `mode`; IDs of `open`/`held` proposals missing `note` or `briefing`; `inFlight` approved and recalling; `overdue`; crew-change `approved`/`overdue`; `candidates` and `waypointGaps` IDs; `slips[]` with `fresh: true`; `following` items with `fresh: true`; `inProgress` approved and released (in `approval` mode) |
| CROSSCHECK | `crosscheck brief` | IDs of `dispatch.pending` and `schedule.pending` |
| REVIEW | `landing queue` | For `pending[]`: PR and head |

The sticky cases in section 1 become QUIET. MCC's `WOULD LAND` on #147 at f2389ce and `WOULD RTS · 4cc5ac4 → c0ca22e` keep the same fingerprint from tick to tick, so after the first pass those ticks are dropped. A new head, a new PR or a new RTS target is a SIGNAL.

OCC's TARGET and ROUTE draft ("once in 24 h") has no field to watch, so HEARTBEAT covers it. Section 9 asks whether that is enough.

## 5. Mechanism

**Pure part** (`server/squelch.ts`, `auto`):

- `project(role, inputs)` builds the stable object from section 4.
- `fingerprint(obj)` is sha256 of canonical JSON.
- `decide({ fp, last, now, heartbeatMin, manualChanged, mode })` returns `{ open, reason }`. `open` is always true in `shadow`, and `reason` then records the result as `shadow:quiet` or `shadow:signal`.

**I/O and API** (`server/squelch-run.ts`, `auto`):

- `POST /api/squelch/<role>` builds the inputs from the same server functions the briefs use (not HTTP back to itself) and decides.
- When the decision is OPEN, it stores `{ fp, openedAt }` as that role's last pass. It records the fingerprint at open time, not when the tick ends. A tick that dies midway (guard block, LIMIT) is caught by HEARTBEAT.
- State goes to `~/.local/state/atc/squelch.json`, rewritten atomically: per role `{ fp, openedAt, quietSince, quietCount }`. Every decision is also appended to `squelch.jsonl`: `{ t, role, open, reason, fp }`.
- Config lives in `squelch.json` `config`: `mode: off | shadow | on` and `heartbeatMin` per role.

**CLI** (`controller/atcctl.mjs`, `flagged`): `atcctl squelch <role>` prints `OPEN <reason>` or `QUIET since HH:MM (n)`. It serves debugging and the fallback below.

**Hook** (`controller/squelch.mjs`, `flagged`; wired in each folder's `.claude/settings.json`, `user`):

```json
"UserPromptSubmit": [{ "hooks": [{ "type": "command",
  "command": "\"<node>\" \"$CLAUDE_PROJECT_DIR/../controller/squelch.mjs\" <role>", "timeout": 5 }] }]
```

- It reads the hook JSON on stdin. If `prompt.trim()` is not exactly `/tick`, it exits 0 with no output.
- Otherwise it calls the API with a 3 s timeout. On QUIET it prints `{"decision":"block","reason":"SQUELCH QUIET since …"}` and exits 0. On OPEN, and on every error, it exits 0 with no output.
- Never `exit 2` and never `|| exit 2` (principle 2).

**Fallback, if hooks don't see `/loop` prompts** (not needed: S0 confirmed that they do): step 0 of each `/tick` becomes `atcctl squelch <role>`, and on `QUIET` the model stops without an ATC LOG line. That still costs one call per tick (one context re-read) instead of 3–6, so roughly 60–75 % of the quiet-tick tokens are saved instead of ~100 %.

**HEARTBEAT and the cache.** A QUIET stretch longer than an hour lets the 1 h cache expire, and the next tick rewrites the whole context (300 K–966 K here). The default `heartbeatMin` is therefore 50 minutes, so a heartbeat tick is a cache read. Section 9 asks for the value.

**Estimate for the window in section 1.** 6 working ticks, about as many follow-up ticks (a write changes the state once more), and 5 sessions × ~5 heartbeats come to ~37 ticks instead of 202. That is about 60–70 M tokens instead of 314 M, a 75–85 % cut. Most of what's left is heartbeats.

### S0 as probed (ATC-80)

TEAM_G, 2026-09-29 02:02–02:15 UTC, Claude Code 2.1.284. Throwaway folders in `/tmp`, each with its own `.claude/settings.json`, a one-word `tick` skill and a stub `UserPromptSubmit` hook (`timeout` 5) that logged stdin and acted from a mode file. Two launch styles: `claude --bg --permission-mode auto --setting-sources project --strict-mcp-config --model claude-sonnet-5-5 "/loop 1m /tick"`, and `ocx claude` in tmux on DeepSeek V4.1 Flash (opencodex 2.56.0). `--setting-sources project` kept the user-level atc hooks out, so nothing touched the state folder. Both styles gave the same answers.

| Question | Answer |
|---|---|
| Does a `/loop`-fired `/tick` run `UserPromptSubmit`? | Yes. `prompt` is exactly `/tick`, not the expanded skill. The initial `/loop 1m /tick` passes the hook as its own prompt. Stdin has `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode`, `hook_event_name`, `prompt`, `session_title` (the `-n` name), and no secrets |
| Does `{"decision":"block"}` drop the turn with no API request? | Yes: 5 blocked ticks per session, 0 assistant lines, 0 usage. A blocked tick writes 4 transcript lines: `queue-operation` ×2, system `scheduled_task_fire`, and system `informational` ("UserPromptSubmit operation blocked by hook: <reason> Original prompt: /tick"). No user line, no skill text. An allowed tick writes the `/tick` user line, the skill text, an attachment, an assistant line and `turn_duration` |
| Does `/loop` keep firing after blocks? | Yes, every 60 s through 5 blocks in a row, and ticks ran normally once the hook stopped blocking |
| Fail open? | Yes. Exit 1 → attachment `hook_non_blocking_error`; a crash → the same with stderr; a timeout (12 s against 5) → `hook_cancelled`, and the turn went ahead about 6 s late |
| Does a peer message wake an idle session between ticks? | Yes, within 5 s, as its own `<cross-session-message …>` prompt. The hook passed it untouched while blocking ticks |
| Is a block visible? | In the tmux pane and `claude logs`, 3 lines per block. `claude agents --json` shows only `idle`. Claude Desktop was not checked |

Consequences for S1–S3:

- The hook is the mechanism; the fallback is dropped.
- The block reason is printed on every block, so it stays short (`SQUELCH QUIET since HH:MM`).
- atc's transcript readers (health, FUEL, the section 1 tick count) must treat the four lines of a blocked tick as neither a prompt waiting for an answer nor a tick (S1, ATC-94).
- A slow hook delays the tick by up to its timeout, so the 3 s API timeout inside a 5 s hook timeout stands.
- A Haiku background session loaded the scheduling tool but never scheduled its loop. That is the model, not the hook: don't use Haiku for a `/loop` control session.

### S1 as built (ATC-94)

The server side of the gate. No hook, `.claude/` setting, guard or control-session manual calls it yet (S2, S3), and the default mode is `shadow`, so nothing drops a tick.

- **Files.** `server/squelch.ts` (pure: `project`, `canonical`, `fingerprint`, `naturalReason`, `decide`), `server/squelch-run.ts` (I/O, `mountSquelch`), both wired in `server/index.ts`. Tests: `squelch.test.ts`, `squelch-run.test.ts`, `squelch-transcript.test.ts`.
- **Inputs.** `gatherInputs` reads the same JSON as the `atcctl` read commands by calling the mounted brief handlers in-process (`app.request`, no network): TOWER `/api/controller/brief?consumer=controller`; MCC `/api/mcc/queue`; OCC `/api/dispatch/brief`, `/api/fleet/crew-changes/brief`, `/api/schedule/brief`, `/api/following`; CROSSCHECK `crosscheck.pending` inside the dispatch and schedule briefs (what `atcctl crosscheck brief` filters); REVIEW `/api/landing/reviews`.
- **Fingerprint.** sha256 of key-sorted JSON of `project(role, inputs)`. Arrays are sorted by ID where order carries no meaning. Left out: `at`, `ageMin`, cursors, `gate` text, `recent`, `examples`, `reasonCodes`, `config`, `flights` titles, RTS `why` when not due. Time-based rules count through the fields the briefs already set, as in section 4.
  - PILOT'S DISCRETION where section 4 is loose: TOWER's "open items" are `conflicts`, `orphans`, `unattended`, `noContact`, `health` (code, level, `since`), `healthAlerts`, `fuel` keys, `fuelLeaks` keys, `coldCache`, `stranded`, plus `groundStops` and pending CLEARANCE IDs; blocks are compared by `code`, not by their text. OCC adds `arrivalCandidates` (flight, AIRCRAFT, proposal) and the `mode`s, because OCC acts on them. MCC adds `tier`, `landable` and an error flag per PR.
- **Decision.** `naturalReason` gives the reason the pass should open, in this order: `first` (no last pass), `manual` (the folder's rules hash differs from its last `manual ack`, read like `atcctl manual check`), `signal` (fingerprint differs), `heartbeat` (`heartbeatMin` since `openedAt`), else quiet. `decide` maps it by mode: `off` is always open with reason `off`; `on` is `{open: false, reason: "quiet"}` when quiet; `shadow` is always open, with `shadow:quiet` or `shadow:<reason>` (`shadow:signal`, `shadow:first`, …) so S4 can audit every would-be reason, not only signal.
- **State.** `squelch.json` is `{config: {mode, heartbeatMin}, roles: {<role>: {fp, openedAt, quietSince, quietCount}}}`, written to a temp file and renamed. A missing or corrupt file, an unknown mode or a bad heartbeat reads as the defaults (`shadow`, 50). `squelch.jsonl` gets one `{t, role, open, reason, fp}` line per call, `fp: null` on `fail-open`. `GET /api/squelch` returns the file's content.
  - In `shadow`, the last pass moves only when the pass would have opened, so a quiet stretch counts (`quietSince`, `quietCount`) and the heartbeat fires exactly as it would in `on`. `off` neither counts nor moves it.
  - There is no config-editing endpoint yet: the SUPERVISOR changes `mode` and `heartbeatMin` in the file until S5 adds a screen. (ATC-552 added one: see "Switch as built".)
- **API.** `POST /api/squelch/:role` (`tower`, `mcc`, `occ`, `crosscheck`, `review`) returns `{open, reason, quietSince, quietCount}`. An unknown role is 404 and writes nothing. Any error while reading a brief, the `manual` check, or the state is `200 {open: true, reason: "fail-open", error}` and leaves `squelch.json` alone. The state is read and written synchronously, so concurrent calls in the one server process can't interleave.
- **Transcript readers.** The four lines of a blocked tick (`queue-operation` ×2, `system` `scheduled_task_fire`, `system` `informational`) were already ignored: `health.ts` `factsOf` reads only `user` and `assistant` lines, `fuel.ts` `parseFuelLines` drops lines without `"usage"`, `compact_boundary` or `agent-name`, and `fuel-leaks.ts` works from those records. So no reader changed; `squelch-transcript.test.ts` pins it with the S0 line shapes (a run of 14 blocked ticks gives the same facts and records as none, adds no request, and no `UNANSWERED`, `HUNG` or `PENDING`; a heartbeat inside the 1 h tier is no LEAK, and one after it is a `coldCache` as before). The same readers on the four S0 transcripts read 0 unknown lines and 1 prompt each. One side effect: a transcript's mtime, which is `lastActiveAt`, moves on a blocked tick. That only touches control sessions, which are not FLEET AIRCRAFT, so the `STALLED` and `coldCache` (HOLDING CAPTAIN) warnings that read `lastActiveAt` are unaffected.
- **7702 run** (temp state folder with copied `airports.json` and `fleet.json`, `manual ack` run from each role's folder in the worktree): `POST /api/squelch/tower` twice with no change gave `shadow:first`, then `shadow:quiet`. The same for `mcc`, `crosscheck` and `review`. `occ` gave `shadow:signal` for a minute after the server started (its Linear-backed fields were still loading), then `shadow:quiet` on every call, and its projection was identical across two reads 4 s apart. Without a `manual ack` the second call is `shadow:manual`, as intended.

### S2 as built (ATC-108)

The hook script and the debugging command. Nothing runs them yet: no `.claude/settings.json` is wired (S3) and no guard changed, so no tick is dropped, and the server is still in `shadow` (always `open: true`).

- **`controller/squelch.mjs <role>`** (`flagged`). Pure parts are exported for the tests (`isPlainTick`, `isQuiet`, `quietText`, `blockOutput`, `askSquelch`, `hookDecision`, `squelchLine`); `main` runs only when the file is the entry script.
  - Reads the hook JSON on stdin. Only `prompt.trim() === "/tick"` goes on. Anything else exits 0 with no output and never calls the server: team messages, SUPERVISOR prompts, `/tick now`, `/loop 3m /tick`.
  - Calls `POST <base>/api/squelch/<role>` with a 3 s `AbortController` timeout (inside the hook's 5 s `timeout`). Only a `200` whose JSON has `open === false` blocks, printing `{"decision":"block","reason":"SQUELCH QUIET since 03:03Z (4)"}` and exiting 0. The reason holds only the UTC time of `quietSince` and the count (`SQUELCH QUIET (n)` without a time), never a string from the server. `open: true`, a non-200 (even with a QUIET-looking body), a timeout, bad JSON, a non-object body, server down, unparseable stdin and an unknown role all exit 0 with no output.
  - `main` is wrapped, ends in `process.exit(0)` and has no `exit 2` path; a test checks the source for `exit(2)` and the word `guard`. It waits for stdout to flush before exiting.
  - The base URL is `atcBase()`: `ATC_URL`, else `http://127.0.0.1:7700`. `atcctl.mjs` now takes its `BASE` from the same function.
- **`atcctl squelch <role>`** (`flagged`; `tower`, `mcc`, `occ`, `crosscheck`, `review`, anything else is an error) prints the decision the hook would act on: `OPEN <reason>` or `QUIET since HH:MM (n)` (UTC). A server error prints `OPEN fail-open (<message>)` and exits 0, like the hook, so the command shows what the tick would do.
- **Guards unchanged.** TOWER and OCC run `guard.mjs` without a role flag, which already allows every `atcctl` command, so the command works there. The CROSSCHECK (`--crosscheck`) and REVIEW (`--review`) allow lists don't cover every read, so `squelch` is not added; MCC (`--mcc`) allows only `manual` and `mcc …`. The hook is a `UserPromptSubmit` command, not a Bash call, so it needs none of that.
- **Tests** (`controller/squelch.test.mjs`, 12): non-`/tick` prompts pass without a call; `/tick` and `/tick   ` with QUIET block with the exact reason; OPEN passes; each error path passes (500, 404, bad JSON, null and string bodies, missing `open`, server down, timeout); `/tick now` and `/loop …` pass; the 3 s default and the shared base URL; the `atcctl squelch` lines; and real child processes against a stub HTTP server (stdout, exit code 0 in every case).
- **End to end** (a temp state folder on port 7703, because 7702 was taken by another session's test server, with `airports.json` and `fleet.json` copied and a `manual ack` from `review/`): in `shadow`, `atcctl squelch review` printed `OPEN shadow:first`, then `OPEN shadow:quiet`, and the hook printed nothing for `/tick`. After editing `squelch.json` to `mode: on`, the command printed `QUIET since 03:43 (3)` and `echo '{"prompt":"/tick"}' | node controller/squelch.mjs review` printed `{"decision":"block","reason":"SQUELCH QUIET since 03:43Z (4)"}` with exit 0. `/tick now` and a dead `ATC_URL` printed nothing and exited 0.
- **Not done here (S3).** The `UserPromptSubmit` entry in each folder's `.claude/settings.json`, and a test that its command has no `exit 2`. When S3 wires it, the command must not end in `|| exit 2`.

### S3 as built (ATC-109)

The hook is wired into the five control folders, and the mode is still `shadow`, so no tick is dropped. `GET /api/squelch` and `squelch.jsonl` start filling per role once a session loads the new settings.

- **Wiring.** Each folder's `.claude/settings.json` gets one `UserPromptSubmit` entry (no `matcher`, `timeout` 5): `"<node>" "$CLAUDE_PROJECT_DIR/../controller/squelch.mjs" <role>`, with the node path written as the PreToolUse guards write it. `controller/` (TOWER, role `tower`) uses its own file, `$CLAUDE_PROJECT_DIR/squelch.mjs`. The other roles are `occ`, `mcc`, `crosscheck`, `review`. There is no `|| exit 2`, unlike the guards, and the PreToolUse guards are untouched.
- **Tests.** Each folder's `settings.test.mjs` (new for `controller/` and `occ/`) asserts that the squelch hook is there with its role and `timeout` 5, that its command has no `exit 2` and no `||`, that `UserPromptSubmit` has no `matcher`, and that the PreToolUse hooks equal their exact previous list (so the guards can't drift silently).
- **Check.** The five commands, run as Claude Code would (`CLAUDE_PROJECT_DIR` set to each folder, `ATC_URL` pointing at a closed port, stdin `{"prompt":"/tick"}`), each exit 0 with no output, so the paths resolve and a dead server fails open.
- **Manuals.** Each folder's `CLAUDE.md` and `CLAUDE.en.md` says in one line that SQUELCH may drop a plain `/tick` and is not a guard. Because the manual text changed, each session's `manual check` reports a change once, and its next `squelch` decision is `shadow:manual`.
- **Step 0 after merge (plan; the result goes here).** Whether a running control session reloads `.claude/settings.json` is not known: S0 only started sessions with the hook already in place.
  1. After the merge, and after the SUPERVISOR has run RETURN TO SERVICE, read `GET /api/squelch` and `squelch.jsonl` for one loop interval (TOWER 3 min, OCC and CROSSCHECK and REVIEW 10 min, MCC 5 min).
  2. A `shadow:*` line for a role means that session loaded the hook. Write which roles did, and Claude Code's version, in this section.
  3. A role with no line after one interval didn't reload. The SUPERVISOR relaunches it from the settings window's CONTROL block, STOP then LAUNCH (the new session reads the settings at start), and the line then appears within one interval.
  - The PR's session does not restart or message any control session. A separate S0-style probe (throwaway folder in `/tmp`, hook added to a running `claude --bg` session) can answer the reload question without touching the real sessions.

### Fingerprint v2 and opens-by-field as built (ATC-297)

Why: the control-skills survey ([research/control-skills.md](research/control-skills.md) 2.1) counted 1.2 G cache-read tokens in five days in ticks that did nothing (TOWER 51 % quiet, MCC 63 %, CROSSCHECK 79 %, REVIEW 93 %, OCC 26 %). SQUELCH was already `on`, so this issue looks at why it still opens, and prepares the cure without turning it on.

- **Re-measured first.** From `squelch.jsonl` on 2026-10-01 (read only): the mode went from `shadow` to `on` at **2026-09-30 07:47 UTC**, so most of the survey window (2026-09-26 to 10-01) was shadow, where every tick reaches the model. Natural decisions before and after: TOWER quiet **5 %** (535 decisions, 460 `signal`) in shadow and **25 %** (422, 315 `signal`) in `on`; MCC 63 % and 59 %; OCC 36 % and 26 %; CROSSCHECK 69 % and 78 %; REVIEW 74 % and 72 %. In shadow the "quiet" decisions were still ticks (nothing was dropped), so the survey's quiet ticks before that time were the cost of shadow; since `on` only the opens reach the model. The rates themselves hardly moved, which says the fingerprints are what they are: MCC, CROSSCHECK and REVIEW are quiet about as often as their briefs allow, and **75 % of TOWER's decisions still open on `signal`** (about 25 % quiet), against 51 % quiet by the survey's tool-call rule.
- **Where TOWER's signal comes from.** The fingerprint projection (`server/squelch.ts` `projectTower`) was sampled six times 20 s apart from the live brief (read only). Only two fields moved with nothing happening: `events[]` (new events; legitimate, but `handoff`, `away.started` and `away.ended` are, by `controller/CLAUDE.md`, ATC LOG only) and `open.healthAlerts[].message`, whose text carries a running duration (`BLOCKED — TOWER이 5분째 …`, `… 24분째 …`), so it changes **every minute for as long as a session waits on approval**. That alone opens every TOWER tick while one session is blocked. OCC moved on `schedule.candidates.tail[]` and `following[]` (both real, fresh candidates). MCC, CROSSCHECK and REVIEW did not move.
- **Opens-by-field (the table).** Each `signal` decision now carries `fields` in `squelch.jsonl`: the paths of the projected fields that changed since the last open pass, from a pure diff (`changedFields`: objects recursed, arrays of objects merged to `a[].b`, order ignored, at most 30 paths, **no values**). The last open pass's projection is kept in `squelch.json` (`roles.<role>.proj`; it is not returned by `GET /api/squelch`). `GET /api/squelch/opens?days=N` (default 7, max 60) joins those decisions with the control session transcripts and returns, per role: `decisions`, `opens`, `reasons`, `signal` (`total`, `idle`, `worked`, `unknown`), `fields` (per path: `opens`, `idle`, `worked`, `unknown`, most idle first, top 15) and the `v2` block below. A tick is **idle** when the role's session made two tool calls or fewer between the open and the next open decision (at most 30 minutes), **worked** with three or more (the ATC-292 rule). Tool-call times come from the control folders' transcripts through the ATC-289 reader (`readSessionCalls` with `uses`: one timestamp per tool call, no names, no text); a role with no transcript, or a tick that has not ended, is `unknown`.
- **Fingerprint v2 (`projectV2`).** A candidate per role, computed beside v1 on every call. Only TOWER differs from v1 for now, because only TOWER has evidence: `handoff`, `away.started` and `away.ended` events and `level: "info"` health entries no longer change the fingerprint, and durations (`5분째`, `2h07m`, `24분`) are removed from alert text (`stripDurations`). Everything else in the projection is v1, so any real change (a new event kind, a CLEARED PR, a new alert, an overdue CLEARANCE) still changes it. The other four roles use v1 as v2 until their `fields` data shows a field worth coarsening.
- **Shadow and switch.** Every decision line also carries `fingerprint` (`v1` or `v2`, the one that decided), `fp2`, `would` (`open` or `quiet`: what v2 would have decided in `on` mode) and `reason2`; a v2 `signal` carries `fields2`. v1 and v2 each keep their own last open pass in `squelch.json` (`roles.<role>.v2`). `config.fingerprint.<role>` (`"v1"` default, `"v2"`) in `squelch.json` picks which one decides; nothing in this PR sets it (ATC-552 added the switch), and `mode` and `heartbeatMin` are untouched. `heartbeatMin` still caps any miss for both.
- **Fail-open (unchanged rule).** `controller/squelch.mjs` is not touched (no `exit 2`, no `||`). If v2 cannot be computed the run decides with v1 (`fingerprint: "v1"`, no `would`); if v1 or the brief fails, the route answers `open: true, reason: "fail-open"` as before.
- **Wrong-skip.** `v2.wrongSkips` counts decisions where v2 would have been quiet but the tick (which reached the model because v1 opened) **worked**. The SUPERVISOR flips a role to `v2` only when its `wrongSkips` is 0 over a week and `unknown` is small; the order stays CROSSCHECK and REVIEW, then MCC and OCC, TOWER last (S4). `wouldQuietIdle` is the saving.
- **Composite `atcctl tick <role>`.** One call for the quiet tick: it runs the `manual check` comparison locally, asks `GET /api/tick/<role>` (the brief and the pure `actionable(role, inputs) → { act, reasons }`, `server/tick.ts`) and, for TOWER, acks the brief's `cursor` when nothing is to be done. Output: `TICK QUIET tower — nothing to act on` (plus `(n info events acked)` for ATC-LOG-only events), or `TICK ACT tower` + `REASONS: …` + the brief, or `CHANGED …` first when the manual changed (never acked then; the pass is shown as `TICK ACT` with `manual-changed`). `actionable` is deliberately cautious: anything it does not know (a malformed brief, an unknown event kind, a server error) is `act: true`. TOWER acts on: any event except `handoff`/`away.*`, a CLEARED PR the holder must LAND (no `groundStop`, `slotHold` or `landClearance`, `landBy` not `mcc`/`supervisor`), a `goAround`, `info` or `fix` whose `action` is `send` or `supervisor` (ATC-128, ATC-270), an overdue CLEARANCE, `reset`, a conflict with no pending CLEARANCE, and **a state item the decision table reports once when it first appears**: a new `open.fuel` or `open.fuelLeaks` key, a `github.error`, an `extReview` that is `excluded`, `open.stranded`, `open.orphans`, `open.unattended`, `open.noContact`, an alert-level `open.health` entry and `open.healthAlerts` text (durations removed). These stay in the brief until they clear, so events cannot tell a first sighting from a repeat: `GET /api/tick/tower` keeps the keys it has already handed to the session in `tick-seen.json` (state folder, written only by this route, atomic; unreadable means empty, which only makes it act more). A key not in that set is `act` with reason `new:<kind>`; after an `act` answer every current key counts as seen; a quiet answer drops keys that went away (so a returning item is new again). Rows deliberately left out: `open.coldCache` (only accompanies a CLEARANCE that is issued anyway), `open.fuelError`, `traffic[].away` and `info`-level health (ATC LOG only), `groundStops` and `slotHold` (they only withhold LAND; a new instruction comes from an event or `reset`), and `codex`/`review` fields (they surface through LAND, `info` and `fix`). On `TICK QUIET` the TOWER `/tick` still does step 1 (team READBACK/ROGER/UNABLE/STANDBY replies) and then the ATC LOG line. It is built for all five roles. TOWER's `/tick` (`controller/.claude/skills/tick/SKILL.md`) and, since ATC-298, OCC's (`occ/.claude/skills/tick/SKILL.md`, a pointer of under 2 KB that runs `atcctl tick occ`) use it. MCC, CROSSCHECK and REVIEW adopt it in their own manual PRs, because they need a guard allow-list change (tier `user`); OCC's guard already allows every `atcctl` command. For OCC `actionable` is true for any of: an approved or recalling plan to send, an overdue item, a needs-note proposal, an arrival candidate, an approved or overdue CREW CHANGE, schedule candidates, WAYPOINT gaps, fresh slips, fresh ROUTEs without WAYPOINTs, fresh FOLLOWING issues, an S2 `inProgress` operation, an unrecorded DUTY CHARTER REQUEST, and three state items reported once through the same seen keys as TOWER (an `arrivalMissing` entry that is `due`, a `wip` CHARTER REQUEST left by an earlier session, and the once-a-day NETWORK check for TARGET and ROUTE drafts when none was written in the last 24 hours; key `target-route:<UTC date>`). On `TICK QUIET occ` OCC does only the team replies and the OCC LOG; there is no cursor to ack (`following ack` is only needed when a fresh issue was reported, which is an `act`).
- **Not built here.** Flipping any role to v2; a settings-window control for `fingerprint`; a screen for the opens table; the other roles' `/tick` changes; any guard change. After one week ENGINEERING reads `GET /api/squelch/opens?days=7` and asks the SUPERVISOR to flip the roles whose `wrongSkips` is 0. Measures: ticks that reach the model per hour (`reasons` and `fingerprint` in `squelch.jsonl`) and tool calls per quiet tick (`opens.signal`, and the ATC-292 reader).

**PILOT'S DISCRETION.**

- v2 is the same as v1 except for TOWER, as above; coarsening fields without evidence would be a guess.
- `idle` and `worked` use the ATC-292 threshold of 3 tool calls, with the next open decision of the same role as the tick's end (cap 30 min).
- `actionable` treats an unknown event kind as work and a `reset: true` brief as work, even though some of those are noise; a wrong "quiet" costs more than a wasted tick.
- `atcctl tick` for the other four roles prints `TICK QUIET`/`TICK ACT` and the brief, but acks nothing (they have no `cursor` ack in this flow).
- The `proj` kept in `squelch.json` holds PR numbers, session names and event ids (what the brief shows), not message text.

### Switch as built (ATC-552)

Why: until now the SUPERVISOR changed SQUELCH only by editing `squelch.json` by hand. `mode` was one global value, so one role could not go `on` alone, and `heartbeatMin` and `fingerprint` had no screen at all (S5 below is only the row display). This adds a SUPERVISOR-only switch for one control role at a time. It touches no guard, hook or manual.

- **Live mode, settled.** `GET /api/squelch` on the production server on 2026-10-06 reads `config.mode: "on"` (the ATC-297 section is right: it went `on` on 2026-09-30; the S3 text describes the state at that time). Every role's `fingerprint` is `v1` and `heartbeatMin` is 50.
- **State shape.** `squelch.json` `config` gained `roles: { <role>: { mode } }`. A role's effective mode is `config.roles.<role>.mode` when it is a known mode, else `config.mode`, else the default `on` (ATC-553; it was `shadow` before; a value that is present but unknown is still `shadow`) (`modeOf` in `server/squelch.ts`). The existing global `mode` stays and is the fallback, so the file the server already has works unchanged. `GET /api/squelch` returns `config.roles` with the rest of `config`.
- **Route.** Files: `server/squelch-switch.ts` (pure: `parsePatch`, `applyPatch`, `resetAll`, `lastChanges`, `changesThisWeek`), `server/squelch-switch-run.ts` (I/O, `mountSquelchSwitch`), tests in `server/squelch-switch.test.ts`.
  - `GET /api/squelch-switch`: per role the effective `mode` (and whether it is the role's own or the global one), `heartbeatMin`, `fingerprint`, the last change per field, `changes7d`, and the last 10 change lines. Read only.
  - `PUT /api/squelch-switch/:role` with a JSON body of any of `mode` (`off|shadow|on`), `heartbeatMin` (integer 1–720) and `fingerprint` (`v1|v2`). **SUPERVISOR only:** it needs the settings window's Origin (`fromThisApp`: a JSON request from `localhost`), so a request without an Origin, such as `atcctl`, or from another site is `403` and writes nothing. In the full server the global SUPERVISOR credential gate (`server/supervisor-auth.ts`, ATC-373) also applies, as to every non-agent write under `/api/`: neither route is on the agent allow-list, so without the SUPERVISOR secret both are `403` before this check (verified on a test server: no Origin gives 403, an Origin without the secret gives 403 `SUPERVISOR credential required`). A bad value or an unknown field is `400`, an unknown role `404`; neither writes anything.
  - `POST /api/squelch-switch/off`, same Origin check: the off state. Every role's mode goes to `shadow` (role entries are removed and the global `mode` is set to `shadow`) and every `fingerprint` to `v1`, in one action. `heartbeatMin` is left alone, because `shadow` opens every tick whatever it is.
- **Log.** Every changed field appends one `{t, by, role, field, from, to}` line to `squelch-changes.jsonl` (`by` is `SUPERVISOR`, the only caller the Origin check lets in). A write that sets a field to the value it already has appends nothing. The off action logs only what it actually changed, so pressing it twice logs once.
- **Fails open.** Writes are strict, reads are not: a corrupt file, an unknown `mode` (global or per role) and an unknown `fingerprint` read as `shadow` and `v1`, and a `heartbeatMin` that is not a positive number reads as 50, so a tick still runs (a missing file or a missing entry reads as `on` and `v2` since ATC-553) and nothing is dropped because of a bad write. A failed switch write returns `500` and leaves the file as it was. `squelchRun` re-reads the file just before it writes a role's state, so a switch change that lands between a decision's read and write is not lost (reads and writes are synchronous in the one server process).
- **Screen.** `web/src/SettingsSquelch.tsx`, in the settings window's CONTROL block: one row per role with the mode, `heartbeatMin` and `fingerprint` controls, the last change (age, field, old → new), "(전체 <mode>)" when the role follows the global mode, the changes this week, and an **off** button (all roles back to `shadow` and `v1`; disabled when everything already is).
- **Counter.** Changes per week = lines in `squelch-changes.jsonl` newer than 7 days (`changes7d`; one request that changes two fields counts two).
- **Not built here.** Moving a role to `on` (that is the SUPERVISOR's decision, W1 in [control-plane.md](control-plane.md)), any `controller/squelch.mjs` change, and a chart of the changes.

**PILOT'S DISCRETION.**

- Per-role mode lives in `config.roles.<role>.mode`, as the issue suggested, next to the global `config.mode` rather than replacing it.
- `heartbeatMin` is limited to integers 1–720 (12 h) on write.
- The off action resets `mode` and `fingerprint` as the issue says and leaves `heartbeatMin`.
- A new route family `/api/squelch-switch` instead of `/api/squelch/:role`, because `POST /api/squelch/:role` is the hook's fail-open path and must stay free of an Origin check.

### Ships on as built (ATC-553)

Why: SQUELCH only saves tokens when it is on. The SUPERVISOR keeps the off switch and now also sees a misfire counter, so the live state ships on from the first day (control-plane.md principle 6, "live first").

- **Defaults in code.** `DEFAULT_MODE = on`, `DEFAULT_FINGERPRINT = v2` (`server/squelch.ts`). A missing `squelch.json`, or a role with no `config.roles.<role>` / `config.fingerprint.<role>` entry, reads `on` and `v2`. The only inputs that read `shadow` and `v1` are a file that cannot be parsed (or is not an object) and a value that is present but unknown: `SAFE_MODE` / `SAFE_FINGERPRINT`. A tick still runs in those cases. `heartbeatMin` stays 50.
- **One-time upgrade.** `migrateOnce()` (`server/squelch-run.ts`, pure part `upgradeOnce` in `server/squelch-switch.ts`) runs at server start. If the file is missing or readable and has no `migrated` record, it writes `mode: on`, `roles.<role>.mode: on` and `fingerprint.<role>: v2` for all five roles, keeps `heartbeatMin`, and records `migrated: { id: "ATC-553", at, from }`, where `from` is the old values as the file had them (`mode`, `roles`, `fingerprint`; `null` when there was no file). With the record present it does nothing, so from then on only the SQUELCH switch changes the live state. A file that cannot be parsed is not touched (a rewrite would lose the SUPERVISOR's values); it stays `shadow`/`v1` and the server logs a warning.
- **Off switch.** Unchanged from ATC-552, `POST /api/squelch-switch/off` (and `PUT /api/squelch-switch/:role`): `resetAll` writes global `mode: shadow`, no role entries and every `fingerprint: v1`. It writes `shadow` explicitly now, because an absent value reads `on`. The upgrade never runs again after pressing it.
- **MCC, CROSSCHECK, REVIEW use `atcctl tick`.** Their `/tick` skill step 0 is `node ../controller/atcctl.mjs tick <role>` (it includes `manual check`); `TICK QUIET` goes straight to the LOG step, `TICK ACT` continues with the old steps (`mcc queue`, `crosscheck brief`, `landing queue`), because the tick output for these roles is the raw briefs, not those commands' views. `controller/guard.mjs` allows `tick mcc` in `--mcc`, `tick crosscheck` in `--crosscheck` and `tick review` in `--review`, and nothing else new. The guards stay fail-closed. OCC and TOWER already allowed it.
- **Misfire panel.** `GET /api/squelch/opens?days=N` gains `roles.<role>.live` and the settings window (CONTROL block, under the switch) shows it for 7 days: `dropped` (ticks the gate dropped), `disagreed` (dropped ticks where the other fingerprint's shadow verdict would have opened; the log line now carries `mode` and `would1`, the v1 verdict while v2 decides), `wrongSkips` (disagreed drops whose next opened tick did work, three or more tool calls, the ATC-292 threshold), `idle`, `unknown` (the next tick is not over, no transcript, or no later open), and `since` (first drop in the window). A dropped tick never reaches the model, so whether it would have worked can not be read directly; this counts the disagreement cases and is a spot-check, not a measure. It gates nothing. The earlier `v2.wrongSkips` (shadow time) is unchanged.
- **Tests.** `server/squelch-v3.test.ts` (defaults, unreadable file, the one-time upgrade, `resetAll`, panel numbers), `controller/guard.test.mjs` (tick allowances).

**PILOT'S DISCRETION.**

- A present-but-unknown value reads `shadow`/`v1`, not the new default: a typo should not drop ticks. Only an absent value reads `on`/`v2`.
- The panel's `wrongSkips` is the disagreement proxy above, because a dropped tick has no model turn to inspect.
- The upgrade writes role entries for all five roles (not only the global `mode`), so the file shows the live state per role.
- No `squelch-changes.jsonl` line for the upgrade (it is not a SUPERVISOR change and would inflate `changes7d`); the `migrated` record holds the old values.
- `docs/squelch.md` has no Korean edition, so Korean is in the changelog fragment, `docs/guide/screens.md`, `controller/README.ko.md` and the Korean manuals.

## 6. Display

- In the CONTROL block of the settings window, each control row shows `QUIET since HH:MM · n dropped` or its last OPEN reason.
- FUEL: quiet ticks cost nothing, so no FUEL change is needed. A later issue could show SQUELCH savings next to `controlWake`.

## 7. Implementation order (one issue each)

| Step | What | Needs | Tier |
|---|---|---|---|
| S0 ✅ (ATC-80) | Probe on a throwaway session in a temp folder (not a control folder): does a `/loop`-fired `/tick` pass through `UserPromptSubmit`, does `decision: block` drop it with no API request, and do the loop's later firings still come? Check `claude --bg` and `ocx claude` both. The result decides between the hook and the fallback | – | – (no PR, a note in this doc) |
| S1 ✅ (ATC-94) | `server/squelch.ts` (pure, tests), `squelch-run.ts`, `POST /api/squelch/<role>`, `squelch.json`/`.jsonl`, `mode: shadow` by default; transcript readers ignore blocked ticks | S0 | `auto` |
| S2 | `atcctl squelch`, `controller/squelch.mjs` hook script (tests: non-`/tick` passes, error passes, QUIET blocks) | S1 | `flagged` |
| S3 | Wire the hook into the five folders' `.claude/settings.json`, still `shadow` | S2 | `user` |
| S4 | A week of `shadow`: for every `shadow:quiet` decision, check in the transcript that the tick really did nothing (the section 1 method). Zero missed working ticks → SUPERVISOR switches `on` role by role, REVIEW and CROSSCHECK first, TOWER last | S3 | – |
| S5 | CONTROL row display (section 6) | S1 | `auto` |

## 8. Risks

| Risk | Guard |
|---|---|
| A tick that should have run is dropped (missing field in the fingerprint) | `shadow` week with a per-tick check (S4); HEARTBEAT caps any miss at `heartbeatMin`; the switch is per role |
| Hook bug blocks every tick | Fail open by construction: only an explicit QUIET from the server blocks; tests cover error paths |
| Gate mistaken for a guard and made fail-closed | Separate file name (no `guard` in it, so its tier stays `flagged`), a note in each folder's `CLAUDE.md`, and a test that the settings command has no `exit 2` |
| `/loop` prompts don't go through `UserPromptSubmit` | S0: they do (Claude Code 2.1.284). Re-check after a Claude Code upgrade |
| A dropped prompt still shows in the transcript or ends the loop | S0: the loop continues; the transcript gets four non-turn lines, which S1 teaches atc's readers to skip |
| A team message arrives only with the next `/tick` | Principle 3: only `/tick` is gated, and team messages are separate prompts. S0 also confirms that a message wakes an idle session on its own |
| Cold cache after long QUIET | HEARTBEAT under the 1 h TTL |
| Server restart loses the last fingerprint | The first tick after a restart opens (`reset`), same as TOWER today |

## 9. Decisions for the SUPERVISOR

1. `heartbeatMin`: 50 minutes for every role (keeps the 1 h cache warm), or longer for REVIEW and CROSSCHECK (they run on `ocx` routes whose caching is implicit, fuel.md 8.2)?
2. OCC's once-a-day TARGET and ROUTE draft: is HEARTBEAT enough, or should the fingerprint include the date of the last such draft?
3. Is a model judgment wanted anywhere in the gate (e.g. Jev on "does this team message need TOWER now")? This draft says no: section 1 shows no case that code can't settle.
4. Out of scope here, but next in line: working ticks still re-read 300 K–966 K of context. Earlier compaction of the control sessions is a separate design.
