---
name: qrh-03-undelivered
description: Use when OCC's send of a FLIGHT PLAN, RECALL or CREW CHANGE returned success:false, or one of them is overdue with no READBACK.
---

# QRH-03 undelivered   rev 2026-10-01.1   owner: OCC manual (flight-plan.md, crew-change.md; ATC-183, ATC-251)

Condition: you are OCC. A SendMessage for a FLIGHT PLAN, RECALL or CREW CHANGE returned `success:false`, or the brief's `overdue` lists a sent or recalling item (no READBACK for more than 10 minutes).

Commands below run from your own working folder (`occ/` for OCC, `controller/` for TOWER), as in your manual; do not `cd` to the skill's folder.

Steps (in this order):
1. FLIGHT PLAN with `success:false`: at once run `node ../controller/atcctl.mjs dispatch undelivered D-xxxx -- <the tool's message, verbatim>`. This returns the proposal to approved and raises one CAUTION.
2. Do not send it again in the same tick. In your OCC LOG write "undelivered" and the reason, never "sent".
3. RECALL with `success:false`: do not send again in the same tick; do not write "sent"; report to the SUPERVISOR. `recall-send` changes no state; the next tick's `overdue` rule resends once.
4. CREW CHANGE with `success:false`: do not send again in the same tick; write "undelivered" and the tool's message in your OCC LOG and report to the SUPERVISOR. There is no `undelivered` command for CREW CHANGE; the `overdue` rule resends once.
5. `overdue` sent (FLIGHT PLAN): run `dispatch release <ID>` to get the same text and send it once more. `overdue` recalling: run `dispatch recall-send <ID>` and send once more. If there is still no answer, report to the SUPERVISOR.
6. When the AIRCRAFT session is back, the proposal comes out again on the next tick: release it again.

Stop and report if:
- Expected: the send succeeds, or the one resend gets an answer.
- Found: `send-guard` blocks the send, or `dispatch release` refuses (GROUND STOP, LAUNCHING, no session, LAUNCH failed).
- Why it matters: do not change the text or the receiver and retry. Report to the SUPERVISOR and leave the approval as it is.

End state: the proposal is approved again (FLIGHT PLAN) or logged as undelivered (RECALL, CREW CHANGE); one CAUTION or SUPERVISOR report exists; nothing marked "sent" that did not arrive.

Report line: OCC LOG (Korean): `D-xxxx undelivered — <reason>`.
