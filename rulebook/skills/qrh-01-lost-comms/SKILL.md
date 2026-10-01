---
name: qrh-01-lost-comms
description: Use when you are an AIRCRAFT CAPTAIN and your messages to OCC or TOWER fail or get no answer, so you cannot get instructions.
---

# QRH-01 lost-comms   rev 2026-10-01.1   owner: CREW BRIEFING (ATC-258 F4)

Condition: you are a team's CAPTAIN with an accepted FLIGHT, and neither OCC nor TOWER can be reached by SendMessage (the send fails, or replies do not come).

Steps (in this order):
1. Check you send to the session name ("OCC", "TOWER"), not to the `from` address of their last message. The address changes when a control session restarts, and a reply to the old address fails (ENOENT).
2. Keep your work safe: stay in your STAND (worktree); do not touch the main checkout `/home/c10/projects/atc` or `~/.local/state/atc/`; do not use bare `git stash`.
3. Commit work in progress as a temporary commit in your STAND.
4. Continue the accepted FLIGHT per its plan (the FLIGHT PLAN you read back). Do not start unrelated work.
5. Report to both OCC and TOWER, by name, with the normal final-report header, and say when contact was lost.
6. State the time contact was lost in the PR body.

Stop and report if:
- Expected: the accepted plan can still be followed safely without instructions.
- Found: the plan itself is unsafe, or needs a decision only the SUPERVISOR can make.
- Why it matters: the SUPERVISOR is the only one left to decide. Ask the SUPERVISOR through the tab (in Korean). Ask only for this; otherwise do not ask.

End state: work committed in your STAND; the FLIGHT continued per its plan; the PR body states the lost-comms time; OCC and TOWER told once they can be reached.

Report line: the normal final report (`[TEAM_X → OCC] ARRIVED ATC-n · PR #n`, then `TIER`, `TESTS`, `DISCRETION`, `BLOCKED`), with the lost-comms time in the free summary. There is no fixed lost-comms line today.
