# OCC procedure: Sending FLIGHT PLANs

[한국어](flight-plan.md) · **English**

> English translation for readers. The OCC session reads the Korean [`flight-plan.md`](flight-plan.md), which is the source of truth; this file is not loaded.

Procedure moved from [`CLAUDE.md`](../../../CLAUDE.en.md). Read it (2b) in `/tick` steps 1 and 4, when a FLIGHT PLAN or RECALL reply came in, or `inFlight` has approved or recalling ones, or `overdue` has any. `CLAUDE.md` sets the role and what OCC doesn't do.

## Commands

| Command | What it does |
|---|---|
| `node ../controller/atcctl.mjs dispatch release <D-0003>` | (2b) Mark an approved proposal sent and print `SEND TO` and the FLIGHT PLAN text. If already sent, print the same text again (for a resend) |
| `node ../controller/atcctl.mjs dispatch readback <D-0003>` | (2b) The CAPTAIN read back |
| `node ../controller/atcctl.mjs dispatch unable <D-0003> -- <reason>` | (2b) The CAPTAIN replied "UNABLE D-0003 — reason" (same as `dispatch decline`; closes it) |
| `node ../controller/atcctl.mjs dispatch standby <D-0003>` | (2b) The CAPTAIN replied "STANDBY D-0003" (stays sent; READBACK overdue counts again once, from the first STANDBY) |
| `node ../controller/atcctl.mjs dispatch await-supervisor <D-0003> -- <reason>` | (2b) The CAPTAIN is neither READING BACK nor refusing but waiting for its user (the SUPERVISOR) (stays sent; the reason goes into `awaitSupervisor`; raises an alert). A later `dispatch readback` clears it |
| `node ../controller/atcctl.mjs dispatch recall-send <D-0003>` | (2b) `SEND TO` and the RECALL text for a proposal the SUPERVISOR asked to recall (`recalling`). A resend gets the same text |
| `node ../controller/atcctl.mjs dispatch recalled <D-0003>` | (2b) The CAPTAIN replied "READBACK D-0003 RECALL" |
| `node ../controller/atcctl.mjs dispatch arrived <D-0003> -- <result link or one line>` | (2b) The CAPTAIN reported a STAND-free FLIGHT (SURVEY, CHECK) done |

## Sending FLIGHT PLANs (2b, only when `mode` is approval)

| Situation (brief field) | What to do |
|---|---|
| An `approved` ASSIGN in `inFlight` | `dispatch release <ID>` → SendMessage the `SEND:` line (only the header `[DISPATCH D-xxxx]`) to the `SEND TO` session. send-guard swaps in the stored text (the full text below `---` is for the log; don't retype it). One per CAPTAIN per pass |
| That ASSIGN's AIRCRAFT is in `fuel.coldCache` of `dispatch brief` (a HOLDING CAPTAIN whose cache has gone cold, ATC-56) | Send it as above anyway: it only warns and never blocks. Put its `text` in the OCC LOG. Don't send a separate message to warm the cache |
| The CAPTAIN replies "READBACK D-xxxx" | `dispatch readback D-xxxx` |
| The CAPTAIN replies "STANDBY D-xxxx" | `dispatch standby D-xxxx`. Don't resend; wait. A second STANDBY is recorded too, but overdue counts from the first |
| The CAPTAIN replies with neither READBACK nor UNABLE but "waiting for my user's go" (e.g. user-tier files need the SUPERVISOR's confirmation) | `dispatch await-supervisor D-xxxx -- <reason as written>`. Don't resend, don't retry, and don't relay an approval (never tell anyone "the SUPERVISOR approved"). The atc alert and FOLLOWING report it to the SUPERVISOR. The one-line paste text in `confirm` is the SUPERVISOR's. If "READBACK D-xxxx" arrives later, run `dispatch readback D-xxxx` |
| The CAPTAIN reports a STAND-free FLIGHT (SURVEY, CHECK; DEPARTED at READBACK) done | `dispatch arrived D-xxxx -- '<result link or one line>'` |
| `recalling` in `inFlight` (the SUPERVISOR requested a RECALL in the tab or API) | `dispatch recall-send <ID>` → SendMessage the `SEND:` line (only `[DISPATCH D-xxxx] RECALL`) to the printed `SEND TO` session; send-guard swaps in the stored RECALL text. Only the SUPERVISOR requests a RECALL; OCC never creates one. Send it even during an enforced ground stop (recalling is the safe direction) |
| The CAPTAIN replies "READBACK D-xxxx RECALL" | `dispatch recalled D-xxxx`. The FLIGHT becomes a candidate again and is not proposed to the same AIRCRAFT for 24 hours. A "READBACK D-xxxx" without "RECALL" is a FLIGHT PLAN READBACK; don't mix them up |
| A recalling proposal in `overdue` (no READBACK for over 10 minutes after the RECALL) | Get the same text with `dispatch recall-send <ID>` and send it once more. If there's still nothing, report to the SUPERVISOR |
| The CAPTAIN replies "UNABLE D-xxxx — reason", or declines with a reason without the fixed form | `dispatch unable D-xxxx -- <the reason as given>`. Don't resend; report to the SUPERVISOR (it also shows in FOLLOWING for a day). A RECALL has no UNABLE: it closes only with "READBACK D-xxxx RECALL" |
| A sent proposal in `overdue` (no READBACK for over 10 minutes; from the first STANDBY if there is one) | Get the same text with `dispatch release <ID>` and send it once more. If there's still nothing, report to the SUPERVISOR |
| An accepted proposal in `overdue` (no STAND for over 30 minutes after READBACK), or a STAND-free departed one (no ARRIVED report for over 24 hours) | Report to the SUPERVISOR only |
| send-guard blocks the send | Don't retry with changed text or recipient; report to the SUPERVISOR |
| `dispatch release` refuses with `GROUND STOP — …` (an enforced ground stop covers that AIRPORT) | Don't send. Leave the approved proposal as it is until the stop is released. Put the stop's reason in the OCC LOG; for "main 깨짐" (main broken), check the failing check and commit with read-only `gh` and report to the SUPERVISOR |
| `dispatch release` refuses with `… LAUNCHING — 새 세션을 기다림 …` or `… RESTARTING …` (no session — waiting for the first message after /clear) (the SUPERVISOR approved a launch card and the session atc launched isn't up yet, ATC-129 and 91) | Don't send. The approval stays. Run `dispatch release` again next pass; once the new session is up it goes out as usual. Don't send anything to start or wake a session |
| `dispatch release` refuses with `… LAUNCH 실패 …` (launch failed), or `following` has a `launch` issue | Don't send. Report to the SUPERVISOR (approving again or launching from FLEET is the SUPERVISOR's call) |

When a STAND appears, atc marks the proposal DEPARTED. RELEASE proposals are not sent even when approved (the SUPERVISOR tidies them up in Linear).
