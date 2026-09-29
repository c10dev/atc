# SQUELCH design (skip a control `/tick` when nothing changed)

A radio's squelch keeps the speaker quiet until a real signal comes in. SQUELCH does the same for the control sessions. Before a `/loop`-scheduled `/tick` reaches the model, atc checks whether anything that session acts on has changed since its last pass. If nothing has changed, the prompt is dropped and the session spends no tokens.

> Status (2026-09-29): draft. Nothing built. Written from a usage reading of the last 4 hours of local transcripts (section 1). No Linear issue yet.

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
6. **Shadow before on.** Like DISPATCH and MCC, SQUELCH first runs in `shadow` mode: it records what it would have dropped and drops nothing.

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

**Fallback, if hooks don't see `/loop` prompts** (verified in S0): step 0 of each `/tick` becomes `atcctl squelch <role>`, and on `QUIET` the model stops without an ATC LOG line. That still costs one call per tick (one context re-read) instead of 3–6, so roughly 60–75 % of the quiet-tick tokens are saved instead of ~100 %.

**HEARTBEAT and the cache.** A QUIET stretch longer than an hour lets the 1 h cache expire, and the next tick rewrites the whole context (300 K–966 K here). The default `heartbeatMin` is therefore 50 minutes, so a heartbeat tick is a cache read. Section 9 asks for the value.

**Estimate for the window in section 1.** 6 working ticks, about as many follow-up ticks (a write changes the state once more), and 5 sessions × ~5 heartbeats come to ~37 ticks instead of 202. That is about 60–70 M tokens instead of 314 M, a 75–85 % cut. Most of what's left is heartbeats.

## 6. Display

- In the CONTROL block of the settings window, each control row shows `QUIET since HH:MM · n dropped` or its last OPEN reason.
- FUEL: quiet ticks cost nothing, so no FUEL change is needed. A later issue could show SQUELCH savings next to `controlWake`.

## 7. Implementation order (one issue each)

| Step | What | Needs | Tier |
|---|---|---|---|
| S0 | Probe on a throwaway session in a temp folder (not a control folder): does a `/loop`-fired `/tick` pass through `UserPromptSubmit`, does `decision: block` drop it with no API request, and do the loop's later firings still come? Check `claude --bg` and `ocx claude` both. The result decides between the hook and the fallback | – | – (no PR, a note in this doc) |
| S1 | `server/squelch.ts` (pure, tests), `squelch-run.ts`, `POST /api/squelch/<role>`, `squelch.json`/`.jsonl`, `mode: shadow` by default | S0 | `auto` |
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
| `/loop` prompts don't go through `UserPromptSubmit` | S0 checks this first; the fallback is ready |
| A dropped prompt still shows in the transcript or ends the loop | S0 checks for both |
| A team message arrives only with the next `/tick` | Principle 3: only `/tick` is gated, and team messages are separate prompts. S0 also confirms that a message wakes an idle session on its own |
| Cold cache after long QUIET | HEARTBEAT under the 1 h TTL |
| Server restart loses the last fingerprint | The first tick after a restart opens (`reset`), same as TOWER today |

## 9. Decisions for the SUPERVISOR

1. `heartbeatMin`: 50 minutes for every role (keeps the 1 h cache warm), or longer for REVIEW and CROSSCHECK (they run on `ocx` routes whose caching is implicit, fuel.md 8.2)?
2. OCC's once-a-day TARGET and ROUTE draft: is HEARTBEAT enough, or should the fingerprint include the date of the last such draft?
3. Is a model judgment wanted anywhere in the gate (e.g. Jev on "does this team message need TOWER now")? This draft says no: section 1 shows no case that code can't settle.
4. Out of scope here, but next in line: working ticks still re-read 300 K–966 K of context. Earlier compaction of the control sessions is a separate design.
