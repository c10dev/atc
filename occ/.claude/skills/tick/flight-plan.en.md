# OCC procedure: Sending FLIGHT PLANs

[한국어](flight-plan.md) · **English**

> English translation for readers. The OCC session reads the Korean [`flight-plan.md`](flight-plan.md), which is the source of truth; this file is not loaded.

Procedure moved from [`CLAUDE.md`](../../../CLAUDE.en.md). Read it (2b) in `/tick` steps 1 and 4, when a FLIGHT PLAN or RECALL reply came in, or `inFlight` has approved or recalling ones, or `overdue` has any. `CLAUDE.md` sets the role and what OCC doesn't do.

## Commands

| Command | What it does |
|---|---|
| `node ../controller/atcctl.mjs dispatch release <D-0003>` | (2b) Mark an approved proposal sent and print `SEND TO` and the FLIGHT PLAN text. If already sent, print the same text again (for a resend) |
| `node ../controller/atcctl.mjs dispatch readback <D-0003>` | (2b) The CAPTAIN read back |
| `node ../controller/atcctl.mjs dispatch decline <D-0003> -- <reason>` | (2b) The CAPTAIN can't take it, with a reason |
| `node ../controller/atcctl.mjs dispatch recall-send <D-0003>` | (2b) `SEND TO` and the RECALL text for a proposal the SUPERVISOR asked to recall (`recalling`). A resend gets the same text |
| `node ../controller/atcctl.mjs dispatch recalled <D-0003>` | (2b) The CAPTAIN replied "READBACK D-0003 RECALL" |
| `node ../controller/atcctl.mjs dispatch arrived <D-0003> -- <result link or one line>` | (2b) The CAPTAIN reported a STAND-free FLIGHT (SURVEY, CHECK) done |

## Sending FLIGHT PLANs (2b, only when `mode` is approval)

| Situation (brief field) | What to do |
|---|---|
| An `approved` ASSIGN in `inFlight` | `dispatch release <ID>` → SendMessage the text below `---` **unchanged** to the `SEND TO` session. One per CAPTAIN per pass |
| The CAPTAIN replies "READBACK D-xxxx" | `dispatch readback D-xxxx` |
| The CAPTAIN reports a STAND-free FLIGHT (SURVEY, CHECK; DEPARTED at READBACK) done | `dispatch arrived D-xxxx -- '<result link or one line>'` |
| `recalling` in `inFlight` (the SUPERVISOR requested a RECALL in the tab or API) | `dispatch recall-send <ID>` → SendMessage the RECALL text below `---` to the printed `SEND TO` session **unchanged**. Only the SUPERVISOR requests a RECALL; OCC never creates one. Send it even during an enforced ground stop (recalling is the safe direction) |
| The CAPTAIN replies "READBACK D-xxxx RECALL" | `dispatch recalled D-xxxx`. The FLIGHT becomes a candidate again and is not proposed to the same AIRCRAFT for 24 hours. A "READBACK D-xxxx" without "RECALL" is a FLIGHT PLAN READBACK; don't mix them up |
| A recalling proposal in `overdue` (no READBACK for over 10 minutes after the RECALL) | Get the same text with `dispatch recall-send <ID>` and send it once more. If there's still nothing, report to the SUPERVISOR |
| The CAPTAIN declines with a reason | `dispatch decline D-xxxx -- <reason summary>`. Report to the SUPERVISOR |
| A sent proposal in `overdue` (no READBACK for over 10 minutes) | Get the same text with `dispatch release <ID>` and send it once more. If there's still nothing, report to the SUPERVISOR |
| An accepted proposal in `overdue` (no STAND for over 30 minutes after READBACK), or a STAND-free departed one (no ARRIVED report for over 24 hours) | Report to the SUPERVISOR only |
| send-guard blocks the send | Don't retry with changed text or recipient; report to the SUPERVISOR |
| `dispatch release` refuses with `GROUND STOP — …` (an enforced ground stop covers that AIRPORT) | Don't send. Leave the approved proposal as it is until the stop is released. Put the stop's reason in the OCC LOG; for "main 깨짐" (main broken), check the failing check and commit with read-only `gh` and report to the SUPERVISOR |

When a STAND appears, atc marks the proposal DEPARTED. RELEASE proposals are not sent even when approved (the SUPERVISOR tidies them up in Linear).
