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
| Address | The new session has the same name (`-n`) but a new job id and a new socket. Messages sent to a name reach it. A reply that copies the old message's `from` address (as `SendMessage` says to do) would go to the old socket. This last point was **not tested** | `SendMessage` tool text |

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
| FLIGHT PLAN sent, READBACK not yet read back (`sent`, `standby`, `awaitSupervisor`) | status in `inFlight`, `overdue`, `awaitSupervisor` | Y for the record. The CAPTAIN's reply, if addressed to the old socket, is lost and the plan is re-sent after 10 min (untested, see 1.1) | `flight-plan.md` |
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

## Not built yet

Everything in section 2. Section 1 is a survey; no code, manual, guard or production state was changed.
