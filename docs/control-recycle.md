# CONTROL RECYCLE design (restarting control sessions on purpose)

> Status: draft (2026-09-30). Only "1. Current facts" is written (SURVEY ATC-165). Sections 2 and 3 are a recommendation for the SUPERVISOR to accept or change; nothing in this document is built.

Related: [mcc.md](mcc.md) ("Context cap", section 6 RTS), [fleet.md](fleet.md) 8.5 (LAUNCH, STOP, STALE), [occ.md](occ.md), [dispatch.md](dispatch.md), `mcc/context-cap.mjs`, `server/session-control.ts`, `deploy/rts.mjs`.

A control session (TOWER, OCC, CROSSCHECK, MCC, REVIEW) runs `/loop <n>m /tick` for days. Its context only grows. This document asks: what does a STOP and LAUNCH lose, when is it safe, how fast does the context grow, and where should a cap sit. ENGINEERING (no folder, no LAUNCH) is out of scope.

## 1. Current facts

Read on 2026-09-30. Sources: the five control manuals and their `/tick` skills, `server/` and `deploy/` code, the transcript files under `~/.claude/projects/` for the five control folders (usage numbers, timestamps, record types and `compactMetadata` only; no message text was read into this document), and two scratch `claude --bg` jobs in a temporary folder (Claude Code 2.1.285). No control session was stopped, started or messaged. Nothing was written to the operating state.

### 1.1 What a STOP and LAUNCH does

| Step | What happens | Source |
|---|---|---|
| STOP | `claude stop <job id>` for a background session; `tmux kill-pane` for one in tmux. The transcript stays on disk. Nothing else is cleaned up: no cursor, CLEARANCE, proposal or lock is touched | `stopControl`, `server/session-control.ts:536` |
| LAUNCH | `claude --bg -n <NAME> --permission-mode auto [--strict-mcp-config] "/loop <n>m /tick"` in the control folder. A fresh context: the folder `CLAUDE.md` plus the `/tick` skill, and a new `/loop` timer (the timer belongs to the session, so the old one is gone). LAUNCH is refused while a non-stale row of the same name or folder is live | `CONTROL_SESSIONS` line 159–164, `controlLaunchPlanOf` line 197 |
| Intervals | TOWER 3 min, OCC 10, MCC 5, CROSSCHECK 10, REVIEW 10 | same |
| Manual re-read | `atcctl manual check` compares a hash of the folder's manual files with `~/.local/state/atc/manuals/<folder>.sha`. The file is per folder, not per session, so a fresh session sees `UNCHANGED` and does not re-read. That is fine: the folder `CLAUDE.md` and the `/tick` body are loaded anyway, and OCC reads its procedure files when a step needs them | `controller/atcctl.mjs:743` |
| Address | The new session has the same name (`-n`) but a new job id and a new socket. **Tested on 2026-09-30 (ATC-169, Claude Code 2.1.285, two scratch `--bg` sessions of one name in a temporary folder):** a message sent to the old session's `from` address fails at once with `ENOENT … the peer process may have restarted, so this socket path is stale` (the old socket file is gone), so a CAPTAIN that replies to the `from` address gets an error instead of a silent loss and has to call `ListAgents`; a message sent to the session **name** reaches the relaunched session. The reply to a FLIGHT PLAN or CLEARANCE is therefore asked to go to the session name (ATC-169, section 4) | `SendMessage` tool text, scratch test |

### 1.2 State per session

"Fresh recovers?" means: a new session, running its normal `/tick` and reading only `brief` output (`atcctl brief`, `dispatch brief`, `mcc queue`, `crosscheck brief`, `landing queue`), ends in the same state as the old one. Y = yes, P = partly (what is lost is a duplicate or a delay), N = no.

#### TOWER (`controller/`)

| Item | Where it lives | Fresh recovers? | Source |
|---|---|---|---|
| Brief cursor | `consumers/controller.json`, written by `atcctl ack` (one consumer for the folder). The event log is in server memory; a server restart gives `reset: true`, a session restart does not | Y | `server/controller.ts:262-295` |
| Events handled but not yet acked when stopped | replayed by the next `brief` (at-least-once). A repeat `HOLD` on a STAND that already has a CLEARANCE waiting for READBACK is skipped by the manual rule | P | `controller/CLAUDE.md` rows LOSS OF SEPARATION, GROUND STOP; tick step 4 |
| Open CLEARANCEs, READBACK wait, STANDBY, `overdue` | `clearances.jsonl`; `brief.clearances.overdue` counts from the send (or the first STANDBY) | Y | `server/clearances.ts:80` |
| A team's READBACK/ROGER/UNABLE reply that reached the old session but was not yet recorded with `atcctl readback` | conversation only. The CLEARANCE stays pending, becomes `overdue` after 10 min, and the new TOWER sends `RESEND` | P (10 min delay, one extra message) | `controller/CLAUDE.md` NO READBACK |
| "I already sent RESEND once" | conversation only; the server only stores `at` and `standbyAt` | P: a second RESEND, or a missed "still no answer" report to the SUPERVISOR | `server/clearances.ts` |
| GO AROUND already sent for this head | `goAround.action: "sent"` from the server | Y | `controller/CLAUDE.md` GO AROUND row |
| APPROACH INFO already sent | derived from `events` (no event, no resend) | Y unless the event was un-acked (then a duplicate INFO) | same |
| FUEL and FUEL LEAK `key` already reported to the SUPERVISOR | the ATC LOG line only | P: every `open.fuel` and `open.fuelLeaks` key still present is reported once more | CLAUDE.md rows FUEL, FUEL LEAK |
| Reports to the SUPERVISOR that came from `events` (UNIDENTIFIED, NO CONTACT, STRANDED, HEALTH) | tied to the cursor | Y | rows in `controller/CLAUDE.md` |
| The `/loop` timer | session-scoped | Y (LAUNCH starts a new one) | `CONTROL_SESSIONS` |

#### OCC (`occ/`)

| Item | Where it lives | Fresh recovers? | Source |
|---|---|---|---|
| Notes, CAUTION, HOLD, BRIEFING | on the proposal (`proposals.jsonl`); `dispatch brief` lists only those still missing one | Y | `occ/.claude/skills/tick/SKILL.md` step 3 |
| `settled` mark | computed by the server from age and status (`settledOf`), not stored in the session | Y | `server/proposals.ts:149` |
| Approved proposal not yet released | status `approved` in `inFlight` | Y | `flight-plan.md` |
| FLIGHT PLAN released (status `sent`) but the `SendMessage` never happened (stopped between `dispatch release` and the send) | status is already `sent`. `overdue` after 10 min; `dispatch release` on a `sent` proposal reprints the same text | P (10 min delay) | `flight-plan.md` overdue row |
| FLIGHT PLAN sent, READBACK not yet read back (`sent`, `standby`, `awaitSupervisor`) | status in `inFlight`, `overdue`, `awaitSupervisor` | Y for the record. A reply to the old socket address fails with ENOENT at the sender (tested, see 1.1) instead of being lost silently; answering by session name reaches the new OCC (ATC-169) | `flight-plan.md` |
| RECALL in progress (`recalling`) | status | Y | same |
| A CAPTAIN's final report `[TEAM_X → OCC] ARRIVED …` read but not yet recorded with `dispatch report` | conversation only. The CAPTAIN does not send it again. STAND-free FLIGHTs have `arrivalCandidates`; a FLIGHT with a STAND does not | **N** | `occ/CLAUDE.md` line 30 |
| CREW CHANGE approved, waiting, sent, overdue | `crew-change brief` | Y | `occ/CLAUDE.md` tools table |
| SCHEDULE drafts, candidates, `LIMIT` | `schedule.jsonl`, `schedule brief` | Y | same |
| CHARTER REQUEST being worked out with the SUPERVISOR (before `schedule draft NEW`) | conversation only | **N** | `occ/CLAUDE.md` CHARTER DESK |
| `following`, WAYPOINT slip, ROUTE-without-WAYPOINT "already reported" | server (`following ack`, `slip-ack`, `route-ack`) | Y | `SKILL.md` steps 5 and 7 |
| Procedure files read earlier | re-read when a step needs them | Y | `occ/CLAUDE.md` "절차 파일" |

#### MCC (`mcc/`)

| Item | Where it lives | Fresh recovers? | Source |
|---|---|---|---|
| INSPECTION verdict on a head, ESCALATE, LAND, RTS | `mcc.jsonl`, shown by `mcc queue` (`inspection` per PR, `recent` last 10 records, `rts`) | Y | `server/mcc-run.ts:296-308` |
| INSPECTION in progress (the `inspector` sub-agent is running) | nothing is written until `mcc inspect`. The PR shows no INSPECTION and is inspected again | P (repeat cost only; head-pinned, so no wrong record) | `mcc/CLAUDE.md` "INSPECTION하는 법" |
| LAND | one server call, head-pinned and re-checked | Y (all or nothing) | `mcc/CLAUDE.md` "착륙과 RTS" |
| RTS in progress | the `atc-rts` unit runs outside both the service and the session. `rts.jsonl` says `running`; `mcc queue` shows `rts.why` "RTS 진행 중"; the 5-minute spacing and the "not in the pass that landed" rule are server-side | Y (the STOP does not cancel it, see 1.3) | `server/mcc.ts:295`, `deploy/rts.mjs` |
| ROLLBACK stop | derived from `rts.jsonl` and the last mode change | Y | `server/mcc.ts:rtsStopOf` |
| CONTEXT CAP request text | in the transcript only; it is a prompt hook (`mcc/context-cap.mjs`), so a fresh session simply does not get it | Y | `mcc/CLAUDE.md` "컨텍스트 CAP" |

#### CROSSCHECK (`crosscheck/`)

| Item | Where it lives | Fresh recovers? | Source |
|---|---|---|---|
| Marks | on the proposal or draft, written by `dispatch|schedule crosscheck`; `crosscheck brief` lists only what has no mark | Y | `crosscheck/CLAUDE.md` tools table |
| Calibration (`examples`, `rate`) | recomputed by `brief` every pass | Y | same |
| A FLIGHT being read for a mark | nothing is stored; the mark is not written, and the item is still `pending` | Y | same |
| Model check by the guard | reads the new transcript | Y | `crosscheck/CLAUDE.md` |

#### REVIEW (`review/`)

| Item | Where it lives | Fresh recovers? | Source |
|---|---|---|---|
| Recorded reviews (head-pinned) | `landing queue` (`recent`); a reviewed head leaves `pending`; a moved head gives 409 and is read again | Y | `review/CLAUDE.md` |
| A review being written | nothing is stored; the PR is still `pending` | Y | same |

Summary: the durable state is in the server for all five. What only the conversation holds is small: TOWER's FUEL "already told" keys and its RESEND memory, OCC's unrecorded CAPTAIN report and an open CHARTER REQUEST. Each of those is also visible in the transcript on disk, but a fresh session does not read it.

### 1.3 Safe moments

A restart loses nothing when all of these hold. The first two are common to all five.

- **No RTS is running or about to start.** `deploy/rts.mjs` snapshots the live background sessions before it restarts atc and, up to about two minutes later, fails the run ("sessions … died") if any of them is gone; the failure ROLLBACKs and then stops RTS until the SUPERVISOR picks the MCC mode again. A STOP inside that window, of any control or team session, would cause exactly this. Signals: `mcc queue` `rts.last.result` is not `running`, and `rts.due` is false or the MCC mode is not `land+rts` (with `land+rts` the server starts an RTS by itself once `rts.due`; see `mcc.md` 5.1). The RTS check ignores ghost rows without `pid` and `status`, so STALE rows do not count.
- **The session is between ticks.** Signal: the job's `state.json` `state` is `done` and `tempo` is `idle` (read by `readJob`, `server/job-state.ts`; `settleJob` already handles the `blocked` leftovers). A STOP on `working` was observed to write `stopped` at once (1.5), so it is safe for the record but throws away the turn.

| Session | Extra condition | Signal atc already has | Gap |
|---|---|---|---|
| TOWER | `brief` `events` is empty (nothing since the last ack) and no CLEARANCE is `overdue`. Open CLEARANCEs waiting for READBACK are fine but may be re-sent once | `brief` (`events`, `clearances.overdue`, `clearances.pending`), job state | none for the record. FUEL keys will be re-reported once |
| OCC (approval mode) | `inFlight` has no `approved` and no `recalling`, and no `sent` younger than 10 min (a READBACK may be on its way), and no CAPTAIN report waiting to be recorded | `dispatch brief` `inFlight` statuses, `overdue`; `crew-change brief` `approved`, `sent` | **A CAPTAIN report that has arrived but is not yet recorded is not visible to atc**, and a CHARTER REQUEST in progress is not either. The former can only be avoided by restarting right after a pass has finished (job `done`); a report that arrives during the seconds between STOP and LAUNCH depends on how the CAPTAIN addresses OCC |
| MCC | `mcc queue` has no PR whose INSPECTION or LAND is being worked on in this pass; `rts.last.result` is not `running` | `mcc queue` (`pulls[].inspection`, `blocks`, `rts`, `recent`), job state | An `inspector` call in progress is not visible. A restart then repeats it (cost, not a wrong record) |
| CROSSCHECK | none beyond the common two | job state | none |
| REVIEW | none beyond the common two | job state | none |

For a shadow-mode OCC (`dispatch brief` `mode: shadow`) nothing is sent, so only the CHARTER REQUEST gap remains.

### 1.4 Context growth

Method: for each main-thread assistant request in the transcripts of the last 7 days, context = `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`, the same sum as `mcc/context-cap.mjs`; streaming snapshots of one message are folded into one request (last one wins); sub-agent requests are not in these files (0 found). The oldest transcript is from 2026-09-26, so the window is about four days, not seven. A transcript file is counted as one LAUNCH (a resumed session would share a file, so the count may be slightly low). "Long" sessions are those that ran at least three hours. Growth per hour is the change from the first to the last request divided by the elapsed time, so idle time is included. Model context windows differ: the Opus sessions ran up to about 970k, the Sonnet REVIEW session compacts at about 170k.

| Session | LAUNCHes in window (long) | Context at the first request (median) | Growth per hour, long sessions: median (range) | Hours from LAUNCH to 150k, long: median (range) | Sessions that crossed 150k / total crossings | Highest context seen | Requests per hour (median, long) |
|---|---|---|---|---|---|---|---|
| TOWER | 13 (8) | 58k | 41k (20–63) | 1.4 h (0.2–5.0) | 8 of 13 / 10 | 966k | 51 |
| OCC | 10 (8) | 64k | 47k (6–80) | 0.8 h (0.4–3.1) | 9 of 10 / 10 | 967k | 27 |
| MCC | 10 (5) | 36k | 42k (34–60) | 1.0 h (0.2–2.6) | 6 of 10 / 6 | 887k | 34 |
| CROSSCHECK | 8 (6) | 36k | 31k (13–41) | 2.7 h (2.1–5.4) | 6 of 8 / 7 | 793k | 22 |
| REVIEW | 3 (3) | 36k | 10k (2–11) | 4.0 h (4.0–13.1) | 2 of 3 / 6 | 279k | 12 |

The remaining short files (under three hours) are LAUNCHes that were stopped again soon, or restarts after a failure; they are counted in the first column only.

How much of the work happens above 150k (all requests in the window):

| Session | Requests | Mean context | Requests above 150k | Context tokens read in requests above 150k |
|---|---|---|---|---|
| TOWER | 5,035 | 348k | 78 % | 93 % |
| OCC | 2,372 | 318k | 79 % | 93 % |
| MCC | 1,775 | 279k | 73 % | 91 % |
| CROSSCHECK | 1,478 | 248k | 67 % | 88 % |
| REVIEW | 1,007 | 119k | 25 % | 40 % |

`/compact` and auto-compact:

- No manual `/compact` ran in any control session (no such command record in the window).
- Auto-compact ran 9 times, all `trigger: auto`: TOWER 2 (at about 968k, down to 13k and 22k), OCC 1 (968k → 22k), CROSSCHECK 1 (796k → 10k), REVIEW 5 (167–176k → 10–19k, all in one long session), MCC 0.
- Only MCC has a cap hook (`mcc/.claude/settings.json`). MCC crossed 150k in 6 sessions and its highest context was 887k, so the notice ("ask the SUPERVISOR to STOP and LAUNCH") did not lead to a restart before the context was several times the cap.
- The `away_summary` records that appear in the TOWER, OCC, MCC, CROSSCHECK and REVIEW transcripts are not compactions; they carry no `compactMetadata`.

### 1.5 The stale job row

Question: does a stopped job still stay `working` and block LAUNCH, as TOWER's job did on 2026-09-29 (Claude Code 2.1.284, `server/session-control.ts:52`)?

Test, on Claude Code 2.1.285, two scratch jobs started with `claude --bg --model haiku` in an empty temporary folder under `~/projects` (already trusted), and never in a control folder:

| Job | State when `claude stop` ran | After the stop |
|---|---|---|
| A: `/loop 1m` reply "ok" | `done`, `tempo: idle` (between turns), row `status: idle`, with `pid` | The row **stays** in `claude agents --json`, now with no `pid` and no `status`, and with `"state": "working"`. `state.json` is unchanged (`done`, same `updatedAt`); no `stopped` is written. The process is gone. The row was still there 8 minutes later (last check), still with `state: working` |
| B: a 120 s `sleep` turn | `working`, `tempo: active`, row `status: busy` | `state.json` becomes `stopped` at once and the row **disappears** from `claude agents --json` |

So the problem still happens on 2.1.285, but only when the session is stopped between turns, which is what happens to a `/loop` session most of the time. `isStaleRow` (ATC-93) already classes case A as STALE (no `pid`, no `status`, job state `done`, `stopped` or `failed`, older than 2 minutes) and LAUNCH ignores STALE rows. Without that rule the row would count as a live session and block LAUNCH and the launch limit.

How `stopControl` could confirm that a job is gone (today it only reports that `claude stop` returned 0):

| Check | Reliable? |
|---|---|
| Remember `row.pid` from `claude agents --json` before the STOP, then after the STOP test that the pid no longer exists (`kill(pid, 0)` fails with ESRCH) | Yes for both cases. Both scratch pids were gone at once. This is the direct proof |
| The row has no `pid` and no `status` in the next `claude agents --json` (or is absent) | Yes, same for both |
| `state.json` `state` | Only in case B (`stopped`). In case A it stays `done`, and a live idle job is also `done`, so it cannot prove anything alone. It is the right tiebreaker only when combined with "no pid, no status" (what `isStaleRow` does) |
| Absence of the row | Only in case B; case A leaves a row |

Recommended: STOP returns success only after the saved pid is gone, and reports "stopped, ghost row STALE" when the row remains without `pid`.

Whether the ghost row ever expires on its own was not observed beyond 8 minutes.

## 2. Recommendation (draft)

### 2.1 Cap per session

Observed: 67–79 % of the requests of TOWER, OCC, MCC and CROSSCHECK, and 88–93 % of their context tokens, are above 150k, and these sessions grow 30–47k per hour of wall time. The manual state that must survive a restart is small (1.2). A cap of 150k would restart TOWER about every 1.4 h, OCC every 0.8 h, MCC every 1 h, CROSSCHECK every 2.7 h. That is 15 to 30 restarts a day, which is too many to do by hand and only workable if atc restarts at a safe moment.

| Session | Suggested cap | Rest of the reasoning |
|---|---|---|
| TOWER | 250k | Growth is high and the loop is 3 min. The re-reported FUEL keys and one extra RESEND are the only costs, so a restart is cheap |
| OCC | 250k, only at a safe moment (1.3) | An unrecorded CAPTAIN report is the one real loss, so keep the restart conditional |
| MCC | 150k, as the manual already says, at a safe moment | Its state is all in the server |
| CROSSCHECK | 250k | Stateless between passes |
| REVIEW | none (Sonnet auto-compacts at about 170k and stays low) | Growth is 10k an hour |

The numbers are a starting point. The SUPERVISOR should pick them (see 3).

### 2.2 Restart conditions

A restart runs when the context is over the cap **and** the safe-moment checks of 1.3 pass, checked by atc, not by the session. Until then the session keeps working (the cap is a request, not a kill). If the safe moment does not come within a set time (for example 60 min), atc raises an alert for the SUPERVISOR, not a forced restart. atc has all the signals for TOWER, CROSSCHECK, REVIEW and MCC (job state, `brief`, `mcc queue` and the RTS record). For OCC it has all but the unrecorded CAPTAIN report and the CHARTER REQUEST.

### 2.3 What the BUILD must add so that a fresh session picks up cleanly

1. `stopControl` confirms the pid is gone and reports a ghost row (1.5).
2. The `/tick` skill of every session says how to treat a fresh start: read `brief` as-is, do not assume the ATC LOG history exists.
3. TOWER: put the FUEL and FUEL LEAK "already reported" keys on the server side, like `following ack`, so a restart does not repeat them. Record a RESEND on the CLEARANCE so a second RESEND and the "no answer" report are decided from the record.
4. OCC: record a CAPTAIN report the moment it arrives, or make `dispatch brief` show FLIGHTs whose `accepted` state is old enough that an ARRIVED report may have been lost. Keep a CHARTER REQUEST in a draft file (`schedule draft` in a `wip` state) as it is worked out.
5. MCC and CROSSCHECK, REVIEW: nothing.
6. The cap notice stays a prompt hook for MCC; a shared, table-driven `context-cap.mjs` would give the other sessions the same notice at their cap.
7. Ask each CAPTAIN to answer a FLIGHT PLAN or CLEARANCE by the session **name**, not the socket address (or have the new session's `from` name resolve), so a reply survives a restart. This needs a test first (1.1).

## 3. Decisions (for the SUPERVISOR)

1. Cap per session (2.1) and whether atc restarts the sessions by itself at a safe moment or only asks, as MCC does today.
2. Whether OCC's unrecorded-report gap is closed before OCC is allowed to auto-restart (2.3, item 4).
3. Whether the REVIEW and CROSSCHECK caps are worth setting at all, given that REVIEW compacts by itself.

### 2.4 As built (ATC-166)

Built as the recommendation, with these decisions. Where it differs from the issue text the PR body says so.

- **Modes.** `off` (default, also after deploy), `shadow`, `on` in `~/.local/state/atc/control-recycle.json` (atomic write; a broken file reads as `off`). The SUPERVISOR changes it in the settings window, AUTOMATION tab (`PUT /api/settings` `controlRecycleMode`, this screen's Origin only); a change is one `control` `recycle-mode` line in the FLIGHT RECORDER. `on` is a ⚠ mode (confirm step). The control sessions cannot change it.
- **Caps** (same file, `caps`, editable in the same block; 0 = no cap): TOWER 250k, MCC 150k, CROSSCHECK 250k, REVIEW none, as the SUPERVISOR decided on 2026-09-30 (2.1). OCC keeps a 250k cap for measuring. Cooldown 3 hours (`cooldownHours`).
- **OCC is excluded from automatic recycle** (SUPERVISOR decision, 2026-09-30) until its unrecorded-report gap (2.3 item 4) is closed by a separate issue. It is expressed as a per-session flag in the same file: `"auto": { "OCC": false, … }` (default: `false` for OCC, `true` for the others; the settings window shows it as `OCC 재시작 alert` and switches to `auto`). `controlRecycleOf` returns `skip` when `auto` is false, in every mode, so `shadow` writes no `would` line for OCC either. OCC's context is still measured and shown, and over its cap atc raises one SUPERVISOR ALERT (ADVISORY, group `recycle`, key `recycle|over|OCC`, present while it stays over, also when the mode is `off`) and does not restart it. Turning OCC on later is one setting (`auto.OCC` → `true`).
- **Context** is the sum of `mcc/context-cap.mjs` (last non-sidechain request: input + cache read + cache write), read from the transcript tail `<account folder>/projects/<cwd with non-alphanumerics as "-">/<sessionId>.jsonl` (cached by mtime and size). A test keeps the two implementations equal. It is shown next to each cap in the settings window (`GET /api/control/recycle`).
- **Decision** is the pure `controlRecycleOf` in `server/control-recycle.ts`. It recycles only when: mode is not `off`; a cap is set; the context is over it; the session is an atc-launched `claude --bg` job (a tmux or desktop session cannot be relaunched, so it is skipped); the job is between turns (`state` `done` and `tempo` `idle`); the safe-moment checks below pass; the session was not recycled in the last `cooldownHours` (read back from the FLIGHT RECORDER, so a server restart does not reset it); and no other control session is being recycled. If the safe facts could not be read it waits (fail-closed). Over the cap but not safe: nothing happens and nothing is written (`wait`); one session per pass, checked once a minute.
- **Safe moment** (1.3): every session: no RTS running or starting, and none about to start (UPDATE state `available` while the MCC mode deploys). TOWER: no un-acked `brief` events, no overdue CLEARANCE. OCC: no `approved` FLIGHT PLAN not yet released, no `recalling`, no `sent` younger than 10 minutes, no open CREW CHANGE. MCC: the job-idle check is the only signal for "not mid-INSPECTION/LAND", because atc cannot see an `inspector` call in progress (a repeat costs money, not correctness). CROSSCHECK, REVIEW: the common two only. Not closed: OCC's unrecorded CAPTAIN report and an open CHARTER REQUEST (2.3 item 4), which stay open gaps; that is why OCC is excluded (see above).
- **Action** (`performRecycle`): `stopControl(name, "RECYCLE")` → confirm the job is gone: the saved `pid` no longer exists (`kill(pid, 0)`) **and** the job's row has no `pid` and no `status` (or is absent), polled up to 15 s (1.5; the ghost row of a job stopped at `done` is expected and LAUNCH ignores it as STALE) → `launchControl(name, "RECYCLE", <same ACCOUNT label>)`. STOP that cannot be confirmed does not LAUNCH. These are the functions behind the FLEET STOP and LAUNCH buttons, so their refusals (launch limit, ACCOUNT login or FUEL hold, folder trust) apply unchanged; no new way to send to or control a session was added, and no guard was touched.
- **Record and ALERT.** Each attempt is one `control` `recycle` line in the FLIGHT RECORDER: `session`, `contextBefore`, `reason`, `mode`, `result` (`recycled`, `would`, `stop-failed`, `stop-unconfirmed`, `launch-failed`), `ok`, `account`, new `jobId`, `error`. The individual `stop` and `launch` lines are written too (`by: RECYCLE`). Shadow writes a `would` line once per session and job per cooldown. The SUPERVISOR ALERT (group `recycle`, key `recycle|<session>|<time>`, kept for 6 hours) is ADVISORY on success and CAUTION on failure; `launch-failed` says the session stays stopped, `stop-failed` and `stop-unconfirmed` say it kept running or its state is unknown. `would` lines are not alerted.
- **MCC.** `GET /api/mcc/queue` carries `recycle: { mode }`, because the MCC session cannot read the state folder. The manuals (`mcc/CLAUDE.md`, `.en.md`, the tick skills) say: `on` → atc recycles, ask for nothing, do not mark BLOCKED; `off`/`shadow` → log "context <n>k — CAP 초과" only. They also say how a fresh session starts (read `mcc queue`; all state is in the server). The hook text (`context-cap.mjs`) points to `recycle.mode`.
- **Not done here** (still in 2.3): server-side FUEL/RESEND keys for TOWER (item 3), recording a CAPTAIN report the moment it arrives and a `wip` CHARTER draft for OCC (item 4; a separate issue, and OCC is excluded until it closes), a shared cap notice for the other sessions (item 6), replying by session name instead of socket (item 7, untested), and an alert when the safe moment does not come within 60 minutes (2.2). The TOWER and OCC manuals did not change: a fresh session recovers from `brief` as 1.2 says, at the cost listed there.

### 2.5 Follow-up as built (ATC-175)

- **Between turns.** `jobIdle` is now `tempo === "idle"` and `state !== "blocked"`. ATC-165 1.3 measured `done/idle`; a `/loop` session that waits for its next pass can also show `working/idle`, which is the same resting shape. Not between turns: `working/active`, `blocked/*`, `tempo` missing, and no job. Tests use these observed shapes.
- **Stuck waiting.** In `control-recycle.json`, `waitAlertMin` (default 60, range 5–1440). A session over its cap that has been in `wait` for that long raises one CAUTION alert, key `recycle|wait|<session>`, naming the blocks; its next step says what the SUPERVISOR can do (wait, or STOP and LAUNCH it by hand in FLEET, CONTROL SESSIONS). It clears when the session recycles or the cap is no longer exceeded. In `shadow` it also writes one `would-wait` line per session per cooldown (with `blocks`). Wait starts when the server first sees the session in `wait`; a server restart resets the clock.
- **After an unconfirmed STOP.** `performRecycle` still records `stop-unconfirmed`, and now also tries `launchControl`. `launchControl` refuses on its own while a live (not STALE) row exists, so two sessions cannot result. The record has `launch: { ok, jobId?, error? }`. The alert says which case it is: LAUNCH succeeded (a new session is running; check that only one is), or LAUNCH refused (CAUTION: the old row is still live, and the session may be down).
- **TOWER safe moment.** `brief` events that were not acked are replayed to a fresh TOWER (1.2), so no event kind is unrecoverable. The wait now only starts above a small threshold, `TOWER_EVENTS_MAX` = 5 un-acked events (a pass in progress). Overdue CLEARANCEs still block.
- **Recorded changes.** One FLIGHT RECORDER line per changed cap or `auto` value: `recycle-caps` and `recycle-auto`, each with `session`, `from`, `to`, `by`. An unchanged value writes nothing. Switching a session to `auto` needs the same ⚠ confirm on screen as mode `on`, for OCC too (with a line about the ATC-169 manual).
- **OCC wired.** `safeFactsOf` calls `restartSafetyOf` (the pure function behind `dispatch brief` `restartSafety`) and `safeBlocksOf` blocks OCC on its blockers, plus an open CREW CHANGE. The earlier duplicated counts (`approved`, `recalling`, `youngSent`, `arrivalFresh`, `wipActive`) are gone, so the recycle and `dispatch brief` cannot disagree.
- **OCC can be turned on only after this.** Until ATC-175 is deployed, `auto.OCC` must stay `false`. Defaults are unchanged: mode `off`, `auto.OCC: false`; nothing is turned on by this change.

## 4. As built: OCC restart safety (ATC-169)

The two OCC gaps of 1.2 and 1.3 (an unrecorded CAPTAIN ARRIVED report, an open CHARTER REQUEST) are closed so that OCC can join CONTROL RECYCLE. Nothing here restarts anything.

- **Arrival: record on arrival, with a server check (approach a).** The OCC manual (`occ/CLAUDE.md`, the tick skill) now says to record a CAPTAIN `[TEAM_X → OCC] ARRIVED …` report the moment it is read, before the `gh` check and before any other step, so the window in which a stop loses it is one tool call. The server check is `arrivalMissing` in `dispatch brief` (`arrivalMissingOf`, `server/following.ts`): a FLIGHT that DISPATCH sent (`timeline.sent`), that has a STAND, whose PR merged (LOGBOOK ON), that has no `arrival-reports.jsonl` record, merged after the ATC-124 cutoff (`REPORT_START`) and within the last day. Each entry has `ageMin` and `due` (`false` while merged under 30 minutes ago, so the report may still be on its way). The existing `no-report` FOLLOWING issue uses the same predicate (`unreportedAgeMs`), so the two cannot drift. Why (a) and not (b): (b) has a fresh OCC ask the CAPTAIN, which is a new kind of outgoing message and would mean widening `occ/send-guard.mjs`; the DISPATCH note forbids that without the SUPERVISOR. A `due: true` entry is reported to the SUPERVISOR once in the OCC LOG instead. No new send kind, no guard change, no change to the `arrival-reports.jsonl` or `proposals.jsonl` line format (one optional field, `dispatched`, was added to the in-memory `FollowItem`).
- **CHARTER REQUEST in progress.** `schedule wip -- '<summary>'`, `schedule wip touch <W-0001>` and `schedule wip done <W-0001>` keep a short summary in `charter-wip.json` (atomic JSON, `server/charter-wip.ts`), listed as `wip` in `schedule brief`. It is **not** a SCHEDULE draft (not a new status), so it never releases, has no verdict, does not count toward the 5 open drafts, and cannot be used to get around that limit: the draft is still written with `schedule draft NEW`, which is checked against the limit as before. Its own limits: 3 open at a time, 600 characters each, dropped by the server after 24 hours untouched. A fresh OCC reads `wip`, writes the summary in the OCC LOG, and asks the SUPERVISOR once whether to continue (`schedule.md`, "CHARTER DESK").
- **OCC safe moment.** `restartSafetyOf` (`server/occ-safe.ts`) turns the four conditions into `dispatch brief` `restartSafety: { safe, blockers[] }`: no `approved` or `recalling` in `inFlight`; no `sent` younger than 10 min (`SENT_GRACE_MS`, measured from `timeline.sent`); no `arrivalMissing` entry merged under 30 min ago (`ARRIVAL_GRACE_MS`); no `wip` touched in the last 30 min (`WIP_IDLE_MS`). ATC-166's recycle has its own OCC safe moment (2.4, `safeBlocksOf`, which also holds back for an open CREW CHANGE); ATC-169 adds the last two conditions to it (`arrivalFresh`, `wipActive`, computed by the same `restartSafetyOf`), so the recycle and `dispatch brief` agree. OCC stays excluded from automatic recycle (`auto.OCC: false`) until the SUPERVISOR switches it.
- **Reply address.** The test result is in 1.1. The CREW BRIEFING gets one line and every CLEARANCE, FLIGHT PLAN, RECALL and CREW CHANGE gets one line above the reply request asking the CAPTAIN to reply to the session name (`OCC` or `TOWER`), not the `from` address (`addressLine`, `server/response.ts`). Running teams see it from their next message on; the CREW BRIEFING line applies from their next briefing.
- **Turning OCC on.** With this PR the two OCC gaps of 2.3 item 4 are closed. OCC is switched on by the SUPERVISOR in `control-recycle.json` (`"auto": { "OCC": true }`, the per-session flag of 2.4), still off by default; ATC-166 reads no other switch. Do this once the OCC manual change has been running for a while (an OCC that still runs the old manual does not record on arrival).

## 5. As built: CONTROL STOP CHECK (ATC-521)

CONTROL STOP, CONTROL RECYCLE and APPLY NOW used to record `ok: true` when `claude stop` exited 0. MCC job 4d8c68ae (acct-1) was "stopped" by a RECYCLE on 2026-10-02 22:26 (`ok: true`), but its `state.json` never became `stopped` (last line 22:22 `done`); on 2026-10-03 08:45 it woke up, landed PR #527 and ticked next to its replacement, and atc did not know.

- **STOP is verified.** After `claude stop` exits 0 on a background control session, `stopControl` (the one function behind the FLEET STOP button, bulk STOP, RECYCLE's retire/stop step, `performRecycle` and APPLY NOW) re-reads that job's `state.json` for up to 20 s (`STOP_VERIFY_WAIT_MS`, 1 s steps). It records `ok: true` only when the state reads `stopped`. Otherwise the record is `ok: false` with `unverified: true` and its own text (`claude stop은 종료 코드 0이었지만 job state.json이 done이라 멈췄는지 확인하지 못함 …`), not the `claude stop 실패` of a failed exit. A tmux pane stop is unchanged.
- **RECYCLE does not launch on the exit code.** A not-verified STOP makes `performRecycle` return `result: "stop-unverified"` (a new `RecycleResult`) and stop there: no `launchControl`. `stop-unconfirmed` (ATC-175) is unchanged and only happens after a verified STOP.
- **Two alerts, both WARNING, both in `alerts`.** `control|unverified|<session>|<job>`: a recent (6 h) blocked STOP whose job still does not read `stopped` and that the SUPERVISOR has not marked as a false alarm; it clears itself when the job reads `stopped`. `control|duplicate|<session>`: more than one job with the same control name that is alive, meaning not STALE, state not `stopped`, and `state.json` written in the last 60 min (`DUP_RECENT_MIN`). The text names the control session, the job ids, their ACCOUNTs and states. STALE ghost rows (the finished 10-01 ones) are not counted.
- **One switch, default on.** `controlStopCheck` in `control-stop-check.json`, settings window, OPERATIONS, block CONTROL STOP CHECK. SUPERVISOR only (this screen's Origin); there is no atcctl command and a control session cannot change it. Off restores the old exit-code verdict and removes the duplicate check; a change is recorded as `policy control-stop-check-mode`. The declaration lives in `server/switches/`, so the PR is tier `user`.
- **Misfire counter.** Every decision is a FLIGHT RECORDER line `control stop-check` with `event` `blocked` (a STOP the check kept from being `ok`), `duplicate` (the WARNING fired), `contradicted` (the check was wrong afterwards: the blocked job later read `stopped`, or a duplicate warning cleared by itself within 2 min) and `dismissed` (the SUPERVISOR pressed `오탐으로 표시` on a recent decision). The settings block shows the 7-day and 30-day counts, the false-alarm share (distinct decisions that were contradicted or dismissed, over blocked + duplicates), the duplicates open now and the five latest decisions. `GET /api/control-stop-check` is the same data read only; `POST /api/control-stop-check/dismiss` needs this screen's Origin.
- **Tested** with injected job states and rows only (`server/control-stop-check.test.ts`, `server/control-recycle.test.ts`): exit 0 with `done` is not ok; with `stopped` it is ok; two live jobs with one control name warn; a STALE or old `stopped` ghost beside one live job does not.
- **Pilot's discretion.** The duplicate check runs once a minute as a read-only job (`server/jobs/control-stop-check.ts`); an unreadable `state.json` counts as not verified; the 20 s wait and the 60 min activity window are constants, not settings.

## 6. As built: named blockers and TOWER carry-over (ATC-565)

On 2026-10-06 (DUTY REVIEW R-0049) TOWER sat at 706–767k against a 500k cap for more than six hours because 8 CLEARANCEs were overdue, and OCC sat at about 700k because its job was `blocked` on the SUPERVISOR. The wait alert said "overdue CLEARANCE 8건" and "턴 사이가 아님 (job blocked/blocked)" and nothing else.

**Why the 8 were overdue** (read on 2026-10-07 from `GET /api/controller/brief` only, no state file opened): all 8 (C-1069, C-1070, C-1072, C-1074, C-1075, C-1077, C-1078, C-1080) went to one DUTY session, `951f27c2`, which is `dead`, on STAND `duty-control-plane`, all about PR #587, which merged on 2026-10-06 04:15Z. They carry no FLIGHT, so the CLEARANCE MOOT rule (ATC-515, keyed by FLIGHT) never lists them; the addressee is gone, so no answer can come; and three of them (C-1072, C-1074, C-1078) are TOWER's RESENDs, sent as new CLEARANCEs that went overdue in turn. Closing such CLEARANCEs is not part of this change. ATC-567 closes them later as `undeliverable` (`addressee ended`); see [alerting.md](alerting.md) "CLEARANCEs to an ended session".

- **2.3 item 3 (RESEND half) was not built; it is now.** Before this change the server stored only `at` and `standbyAt`: TOWER's RESEND is a new CLEARANCE whose text starts with `RESEND`, and nothing tied it to the one it repeats. `resendLinksOf` (`server/clearance-resend.ts`, pure) now ties them from the record alone: a CLEARANCE whose text starts with `RESEND` is a RESEND of the latest earlier non-RESEND CLEARANCE with the same addressee, type, STAND, FLIGHT and PR numbers (`prNumbersOf`, as in ATC-554) that has no RESEND yet, or else of the latest one (a second RESEND). No new op, no new file, no `atcctl` command: the link is derived each time, so it also covers the CLEARANCEs already in `clearances.jsonl`. When one CLEARANCE of a chain is answered (READBACK, ROGER or UNABLE; a cancel is not an answer) the others are `answeredVia` that one. The FUEL "already reported" keys of item 3 are still not built.
- **TOWER brief.** `clearances.pending[]` entries of a chain carry `resendOf` (this is a RESEND of that id), `resentBy` (RESENDs already sent for this one) and `answeredVia`; entries outside a chain keep today's shape. `clearances.overdue` leaves out `answeredVia` entries (the team answered the RESEND; the original stays open in the record but is not waiting any more). This is what lets a fresh TOWER decide a second RESEND and the "no answer" report from the record. The TOWER manual does not read these fields yet (see "Not done" below).
- **The wait names what blocks.** TOWER: `overdue CLEARANCE 8건: C-1069→951f27c2(RESEND함), C-1070→951f27c2(RESEND함), C-1072→951f27c2(C-1069의 RESEND), … 외 3건` (ids and addressees, five named, the rest counted). Not between turns: `턴 사이가 아님 — SUPERVISOR를 기다림(job blocked/blocked): <needs>` when the job is `blocked` (the `needs` line Claude Code writes), `턴 사이가 아님(job working/active, 턴 도중)` otherwise. OCC: each `restartSafetyOf` blocker gets its kind in front: `FLIGHT PLAN`, `RECALL`, `FLIGHT PLAN READBACK`, `기록하지 않은 CAPTAIN 보고`, `CHARTER REQUEST 진행 중`. The `recycle|wait` alert, the shadow `would-wait` line, APPLY NOW and CONTROL BULK all show these texts (they share `safeBlocksOf`).
- **TOWER carry-over.** With the switch on, an overdue CLEARANCE no longer holds TOWER's restart. `controlRecycleOf` returns `carry` (the overdue ids) and the reason says `overdue CLEARANCE n건을 새 세션에 넘김`; the `control` `recycle` record gets `carried: [ids]`. Every other block (un-acked events over `TOWER_EVENTS_MAX`, RTS, not between turns, cooldown) still holds. APPLY NOW and CONTROL BULK use the same safe facts, so their TOWER restart is not held by overdue CLEARANCEs either (they write no `carried`).
- **Switch.** `controlRecycleCarry` in `control-recycle-carry.json`, settings window, OPERATIONS, block CONTROL RECYCLE, row TOWER CARRY-OVER. Default `on`; `off` is the behavior before this change (any overdue CLEARANCE holds TOWER). SUPERVISOR only (this screen's Origin), no `atcctl` command; a change is one `policy` `control-recycle-carry-mode` line. Declared in `server/switches/`, so the PR is tier `user`.
- **Misfire counter.** `carryCounterOf` (`server/recycle-carry.ts`, pure), shown under the row and read each time from the FLIGHT RECORDER `recycle` lines with `carried` and `clearances.jsonl` (nothing new is written). Per TOWER restart in the last 30 days that carried CLEARANCEs, per carried chain, up to the next TOWER restart: **repeated** = the chain already had a RESEND before the restart and the fresh session sent another (or the fresh session sent two); **lost** = the chain had no RESEND yet, and 30 minutes after the restart (`LOST_AFTER_MS`) there is still no RESEND, answer or cancel. A restart with either counts as one misfire. The "no answer" report itself is an ATC LOG line that atc cannot see, so a missed report is not counted; a chain whose AIRCRAFT carries a health code (the manual says do not resend then) can count as lost.
- **OCC blocked past the cap: one HOME card.** `capBlockedOf` (pure): a control session over its cap whose job is `blocked` for at least `waitAlertMin` (60 min) gives one CAUTION alert `recycle|blocked|<session>` (HOME to-do, ALERT row): `CONTROL RECYCLE — OCC 컨텍스트 694k > CAP 500k, 104분째 SUPERVISOR를 기다리며 blocked라 재시작할 수 없음: <needs>`, plus the other blocks if the session is also in `wait`. The time is the job's own `blocked` start (`since`), so a server restart does not reset it, and it is raised whatever the mode or `auto` is (the cap is passed either way). For that session the `recycle|wait` and `recycle|over` alerts are not raised (one card). It goes away when the session is answered, recycles or drops under the cap. Queue contract row `recycle|blocked` (`server/queue-contract.ts`). The separate `CONTROL-BLOCKED` RULE BREACH warning (ATC-352) is unchanged. Ending the block itself is ATC-549.
- **Not done (needs a manual line).** The TOWER manual's NO READBACK row (`controller/CLAUDE.md`, and `CLAUDE.en.md`) does not read `resentBy`, `resendOf` or `answeredVia` yet, so a fresh TOWER still decides from the conversation it no longer has. The line is a K effect and is left to DUTY.

## 7. As built: event wakes instead of `/loop` (ATC-557, part a)

TOWER, OCC and MCC no longer need a `/loop`. Each stays an idle background session; the server wakes it with one message when something needs a decision. This is part (a) of ATC-557. Server-composed CLEARANCEs, relaunching an absent control role, REVIEW wakes and the daily review turn are later parts.

- **Switch, per role, default `wake`.** `control-wake.json` `roles.tower|occ|mcc`, values `loop` (as before) and `wake`. Settings window, OPERATIONS, block CONTROL WAKE; SUPERVISOR only (this screen's Origin), no `atcctl` command. A missing value reads `wake`, a value that is present but unknown reads `loop`. A change is one `policy` `control-wake-mode` line. There is no `fresh` value (a fresh session per wake) in this part.
- **Events.** Every 30 s (TOWER), 60 s (OCC) and 120 s (MCC, whose queue reads GitHub per PR) the server reads the same brief the role's `/tick` reads (`gatherInputs`, the SQUELCH and `atcctl tick` source) and lists what that role's `/tick` would act on (`actionable`, `server/tick.ts`), one item per thing with a stable key (`wakeEventsOf`, `server/control-wake.ts`).
  - TOWER: every brief event except the ATC-LOG-only ones (`handoff`, `away.*`); `reset`; a CLEARED PR whose holder must get `LAND`; `goAround`, `info`, `fix` with `action` `send` or `supervisor`; a SUPERVISOR RELAY; an overdue CLEARANCE (first silence: RESEND; after a RESEND: the second silence, a "no answer" report); a conflict with no CLEARANCE pending; a first sighting of a FUEL, FUEL LEAK, GitHub error, excluded external review, STRANDED, NORDO, UNIDENTIFIED, NO CONTACT or health alert key; an answered DECISION card.
  - OCC: a SETTLED proposal with no note or BRIEFING; an approved FLIGHT PLAN the server did not send within 3 minutes; a RECALL to send; an overdue FLIGHT PLAN (one the server sent is the server's until its resend; after the resend it is a second silence); ARRIVED candidates; CREW CHANGE to send or overdue; SCHEDULE candidates, WAYPOINT gaps, fresh slips and ROUTEs without WAYPOINTs; S2 operations to release; fresh FLIGHT FOLLOWING issues; DUTY CHARTER REQUESTs; first sightings of `arrivalMissing`, `wip` and the daily TARGET/ROUTE check (the last one waits until 00:30Z, away from DUTY REVIEW's 00:00Z); an answered DECISION card.
  - MCC: a PR head with no INSPECTION; a PR with no blocks (LAND) and a due RTS, both after 3 minutes, so MCC SERVER AUTO goes first.
  - An UNABLE or a CAPTAIN's question needs no server event: the team's message reaches the session by name and wakes it, as before. A brief the server cannot read is one "outside the menu" event, so the session reads it itself.
- **One message per new event.** An event is held one pass (20 s) so a burst goes into one wake; a role is woken at most once a minute; a new wake waits while the previous one has no result yet (at most 20 minutes), because the session's own `tick` shows everything current. An event is put in a wake once. If it is still open 30 minutes after its wake it is put in one more wake as "still open", once.
- **Message.** `[ATC WAKE W-0001] TOWER`, then what is new, what is still open, what was resolved since the last wake (`W-…`, minutes ago), the open FLIGHTs these bear on with a fact line each from the brief, and three instructions: run `atcctl tick <role> --wake W-0001` and follow `/tick`; do not reply to ATC; end with `WAKE RESULT: acted` or `WAKE RESULT: nothing`. English, at most 8,000 characters.
- **Same writer, own check.** `checkControlWake` (`server/send-checks.ts`) mints the same `CheckedSend` brand as a FLIGHT PLAN (`kind: "control-wake"`): the role is TOWER, OCC or MCC; the switch is `wake` (or the live session was launched in wake mode); the recipient session's name is the role name; the header and id match; the result instruction is there; no team header (`[DISPATCH …]`, `[OCC CC-…]`, `[ATC C-…]`) is in the text. `deliverChecked` (`server/session-socket.ts`) stays the only code that touches a socket, and only the production server writes. A test server writes only with `ATC_SERVER_SEND_TEST=1`, to a session under the OS temp folder whose name is `ATC_CONTROL_WAKE_TEST_PREFIX` plus the role.
- **Breaker per target kind.** The ATC-562 breaker now takes a scope (`BreakerScope`, `server/server-send.ts`). Team FLIGHT PLANs keep their scope (`server-send` lines); each control role has its own (`control-wake` lines of that role, reset by `policy control-wake-mode` for that role). A control session that is busy and not seen in time stops only its own wakes, never FLIGHT PLAN sends to teams.
- **When wakes stop.** `GET /api/tick/<role>` without `--wake` (a `/loop` tick) answers `wakeMode` only while the switch is `wake`, the wake job ran in the last 3 minutes and that role's breaker is armed. Otherwise the `/loop` tick works as before, so a session that still has its `/loop` is not left deaf.
- **Breaker trip fails safe to `loop`** (review of PR #607). While a role's wake breaker is not armed, its effective mode is `loop` even with the switch at `wake` (`effectiveWakeOf`, `server/control-wake-switch.ts`): LAUNCH uses the `/loop` first message, `atcctl tick <role>` stops answering `TICK WAKE-MODE`, and a live session that was launched in wake mode (no `/loop`) is relaunched once with `/loop` through the same `recycleOnce` path and safety conditions, without the 5-minute uptime and 3-hour cooldown waits (a failed try is retried after 10 minutes). If that relaunch is not possible right now (not between turns, a safe-moment block, CONTROL RECYCLE `mode: off` or `auto` off, another recycle running, or the relaunch failed), a CAUTION card `control|wake|<ROLE>` says so until the relaunch happens or the breaker re-arms. The breaker still probes after 30 minutes with one wake to the (now looping) session; when it is seen the breaker re-arms, the role's effective mode is `wake` again and the normal switch-over (with its cooldown) relaunches it without `/loop`. A trip writes a `control-wake fallback` line `to: loop`, a re-arm one `to: wake`; the relaunch itself is a `transition` line with `cause: breaker`. The CONTROL WAKE block counts both.
- **TOWER cursor.** When the brief holds only ATC-LOG-only events and nothing to wake for, the session is idle and no wake is open, the server acks the cursor (what a quiet tick did), so these events do not pile up past `TOWER_EVENTS_MAX` and hold CONTROL RECYCLE.
- **Transition from `/loop`.** The server cannot cancel a running `/loop`. `launchControl` now picks the first message by the role's switch: `wake` gives `[ATC WAKE BOOT] <ROLE>` (one pass with `tick --wake boot`, then end the turn), `loop` gives `/loop <n>m /tick`. The `control launch` line carries `wake: true|false`. A live session whose launch line differs from the switch (a session launched before this change has no `wake` field and counts as `loop`) is relaunched once, by the production server only, through `recycleOnce` (same lock and `performRecycle` STOP → confirm → LAUNCH as CONTROL RECYCLE, same ACCOUNT) when: CONTROL RECYCLE `mode` is not `off` and `auto` is on for it (a role whose `auto` is off, OCC by ATC-166 default, is never relaunched: it keeps its `/loop`, its loop ticks get `TICK WAKE-MODE`, and it acts on the socket wakes), the job is between turns, `safeBlocksOf` is empty (no RTS running or due, TOWER/OCC/MCC safe moment), the server has been up 5 minutes, no attempt in the last 3 hours, nothing else is recycling. One role per pass; each attempt is a `control-wake transition` line plus the usual `control recycle` line (`by: WAKE`). Until it happens, the old session's `/tick` short-circuits (`TICK WAKE-MODE`) and the session already receives wakes. The same path moves a session back when the switch goes to `loop`; until then the server keeps waking it.
- **Context bound.** CONTROL RECYCLE stays the bound, with its caps (production today: TOWER 500k, OCC 500k, MCC 150k). No new cap setting: a wake costs one turn instead of 20 (TOWER) to 6 (OCC) `/loop` turns an hour, so the context grows by the work done, not by the clock (section 1.4 measured 30–47k an hour of wall time, mostly idle ticks). Whether the caps should drop for wake mode is read off the context numbers after a week.
- **Misfire counters** (settings block, 7 days, per role): **missed** (a judgment event open 15 minutes, plus its server-first wait, that was in no delivered wake; one `control-wake missed` line each), **menu** (a wake whose items are all ones the brief already fully determines: LAND, INFO/GO AROUND/FIX `send`, RELAY, first RESEND, FLIGHT PLAN, RECALL and CREW CHANGE sends, SCHEDULE release, MCC LAND and RTS; part (b) moves these to the server), **nothing** (the session ended the turn with `WAKE RESULT: nothing`). Also wakes, acted, unknown result, failed, refused, not seen, breaker trips, transitions, and loop fallbacks and returns.
- **FLIGHT RECORDER.** Every wake is a `control-wake deliver` line with its input: event keys, kinds and menu flags, new / still open / resolved keys, FLIGHTs, the full text and its hash, the session, pid and `msg_id`. Then `confirm` (seen in the transcript), `result` (`acted`, `nothing` or `unknown`), `pickup` (the session ran `tick --wake`), `failed`, `refused`, `missed`, `breaker`, `transition`, `ack`.
- **What a fresh session picks up (2.3).** Item 2: the `/tick` skills and manuals say a fresh session reads the brief as it is. Items 3 and 4 were closed by ATC-565 and ATC-169. Item 7: replies by session name are what keeps the mailbox across a relaunch. Nothing new is needed for a wake-mode relaunch: the BOOT pass is a normal `/tick`.
- **Not built here.** `fresh` mode, the daily review turn, REVIEW and CROSSCHECK wakes, server-composed CLEARANCEs, relaunching an absent role, any judgment logic (ATC-558).

## 8. As built: relaunch or escalate an absent control session (ATC-532)

On 2026-10-03/04 TOWER was absent about 5.5 hours and MCC about 4 hours (ATC-531); the `control|down` WARNING sat in the list all night and nobody was paged. On 2026-10-07 the host rebooted at 03:23Z and TOWER, MCC, OCC and REVIEW stayed down until the SUPERVISOR launched them by hand. Absence is no longer a silent list line.

- **Roles.** Every control session atc launches: TOWER, OCC, MCC, REVIEW (`CONTROL_SESSIONS` with `launch: "bg"`). CROSSCHECK is retired (ATC-371, `launch: null`) and `launchControl` refuses it, so it is not judged; bringing it back needs an explicit un-retire decision. ENGINEERING is a badge only.
- **Absent.** No live session for the role in the snapshot (the same `controlPresentOf` as `control|down`) and no live (not STALE) `claude agents` row. Not absent: the last control record is a SUPERVISOR STOP (FLEET STOP or STOP ALL, whatever its `ok`), a launch or stop in the last 2 minutes (`CONTROL_DOWN_GRACE_MS`), or the role is between STOP and LAUNCH of a CONTROL RECYCLE or CONTROL WAKE switch-over (`recyclingNow`).
- **When to act.** After the limit (`limitMin`, default 20, one of 10/15/20/30/45/60). **After a server (re)start**, a role that is already absent at the first pass (the first minute job after the first snapshot) or whose absence was open in the FLIGHT RECORDER is judged 2 minutes after that first pass (`STARTUP_SETTLE_MS`), not after 20. Two minutes is the same wait as the `control|down` grace and the STALE age (`STALE_MIN_AGE_MS`): the `claude agents` list and the session files settle, and a session that the SUPERVISOR or RTS launched at the same moment shows up.
- **Relaunch, only on evidence that the previous job is gone** (`absentProofOf`, `server/control-absent.ts`). Live evidence wins: a live agents row, any process whose cwd is the control folder (the worker runs there), or a live worker for the last job in a reliable daemon roster (ATC-534 `readRoster`). Gone evidence is one of: the last launched job started before the host boot (`/proc/stat` `btime`); the job's `state.json` reads `stopped` or `failed`; the daemon is up (roster reliable) and has no live worker for that job. The last job is the newest `control launch` line with `ok` in the last 14 days. With no such line, nothing is proven (the role may have been put down on purpose), and with the daemon down and no reboot, nothing is proven either. ATC-531's own evidence ("daemon settled it as killed", pty-host check) is not in the code; the reboot and `state.json` prongs stand in for it.
- **Relaunch path.** `launchControl(name, "ABSENT")`, the function behind the FLEET LAUNCH button, so a role whose CONTROL WAKE switch is `wake` comes back without `/loop` and a `loop` role comes back with `/loop`; there is no second launch path. Every existing refusal applies unchanged (a live non-STALE row, ACCOUNT not logged in, FUEL hold, folder not trusted, unreadable session list). The ACCOUNT is chosen as for the button (LAUNCH ACCOUNT for control sessions, else the role's home). Only the production server launches: port 7700, the real state folder and not under `node --test` (`writerModeOf(...) === "production"`; the `ATC_SERVER_SEND_TEST` opt-in does not count). One attempt per absence; at most one automatic relaunch per role per hour (`RELAUNCH_COOLDOWN_MS`), except right after a server start. OCC is relaunched only while `auto.OCC` in `control-recycle.json` is true (ATC-166, default false: escalation only); the other roles follow their `auto` value the same way (default true).
- **Escalation.** When atc does not relaunch (switch off, `auto` false, no or live evidence, not the production server, cooldown) or the relaunch is refused or fails, or the relaunched session has not appeared after the grace, one WARNING `control|absent|<SESSION>|<n>` goes into the SUPERVISOR alert list: `관제 세션 TOWER 25분째 없음 — 마지막 job a1b2c3d4 · atc가 다시 띄우지 않은 이유: …`. It repeats every 30 minutes (`ESCALATE_REPEAT_MS`) with `n + 1`: the browser and ANNUNCIATOR notify on a new key, so every repeat is a new notification, and the previous key disappears. It stops when the session is seen again, when the SUPERVISOR presses `확인(ACK)` or `오탐으로 표시` in the settings block, or when the escalation switch is turned off. The existing `control|down` line stays as it was. Queue contract row `control|absent` (ends: `absentEscalationsNow`).
- **How it reaches the SUPERVISOR.** atc has no push service: WARNING reaches ANNUNCIATOR through `/api/events` (`alert` topic) and `/api/supervisor-alerts`, and the app posts a banner for every new WARNING key, also in its quiet hours (its quiet hours mute only tone and voice). The browser plays the WARNING tone.
- **Quiet hours.** A visible SUPERVISOR setting, `CONTROL ABSENT QUIET PASS`, default **on** (live first). When on, the escalation item carries `passQuiet: true` and the browser plays its tone inside the browser's quiet hours (other alerts stay silent there). ANNUNCIATOR does not read `passQuiet` yet; making the app play the tone in its quiet hours is an atc-app change.
- **Switches, SUPERVISOR only.** `control-absent.json`, settings window, OPERATIONS, block CONTROL ABSENT: `controlAbsentRelaunch` (on/off, default on, ⚠ because the server launches a control session by itself), `controlAbsentEscalate` (on/off, default on), `controlAbsentQuietPass` (on/off, default on), `controlAbsentLimit` (minutes, default 20). Only this screen's Origin with the SUPERVISOR credential can change them; there is no `atcctl` command. A change is one `policy control-absent-mode` line. Declared in `server/switches/`, so tier `user`.
- **FLIGHT RECORDER** (`control absent`, no new state file): `start` and `end` (the pair: `end.minutes` is the absence; `why` says whether the session came back or the SUPERVISOR stopped it), `relaunch` (`ok`, new `jobId`, `lastJobId`, the evidence used in `proof`, the refusal in `why`), `escalate` (`n`, `minutes`, `why`), `ack`, `false` (`of` = the escalate line). `startup: true` marks decisions made under the server-start rule. A restarted server restores an open absence from these lines.
- **Measure.** Minutes absent per role per UTC day come from the `start`/`end` pairs: `GET /api/control-absent` returns `days` (last 7 days) along with the counts, the open absences and the latest decisions.
- **Misfire counters** (settings block and `GET /api/control-absent`, 7 and 30 days): relaunches followed within an hour by the ATC-521 `duplicate` check for that name, and escalations the SUPERVISOR marked false; also relaunches, failed relaunches, escalations and repeats, and absent minutes, per role.
- **STALE after a reboot.** A background row with no `pid` and no `status` that started before the host boot is STALE whatever its job state (`isStaleRow`, new `bootAt` argument). A job cut off by a reboot in `working` used to look live, which would have blocked both this relaunch and the FLEET LAUNCH button.
- **Tested** with injected rows, records, evidence, launch and clock (`server/control-absent.test.ts`, `server/control-absent-run.test.ts`): absent 25 min with gone evidence → one launch; alive evidence → escalation, no launch; under the limit → nothing; SUPERVISOR STOP → nothing; launch refused → escalation; both switches off → nothing; reboot → TOWER, MCC and REVIEW relaunched 2 minutes after the first pass and OCC escalated; not the production server → no launch.

## Not built yet

Everything in section 2. Section 1 is a survey; no code, manual, guard or production state was changed.
