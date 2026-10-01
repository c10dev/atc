---
name: qrh-05-arrival-missing
description: Use when OCC reads a CAPTAIN's ARRIVED report, or the dispatch brief's arrivalMissing lists a merged FLIGHT with due true and no recorded report.
---

# QRH-05 arrival-missing   rev 2026-10-01.1   owner: OCC manual (tick step 1 and 2; ATC-124, ATC-169)

Condition: you are OCC. Either a message starting `[TEAM_X → OCC] ARRIVED …` has arrived, or `dispatch brief` has an `arrivalMissing` entry (a merged FLIGHT with no recorded arrival report) with `due: true`.

Commands below run from your own working folder (`occ/` for OCC, `controller/` for TOWER), as in your manual; do not `cd` to the skill's folder.

Steps (in this order):
1. A message that starts `[TEAM_X → OCC] ARRIVED …`: on reading it, before the `gh` check and before any other step of the tick, record the fixed lines only: `node ../controller/atcctl.mjs dispatch report <D-xxxx|ATC-n> --pr <n> --tier <t> --tests <pass/total|n/a> --discretion <n> --blocked <none|the blocked point>`. For a SURVEY or CHECK without a PR use `--result <link>` instead of `--pr`. Never record the free summary.
2. A report in the old shape (no fixed header): record only if the message states PR number, tier, tests, discretion and blocked; if any is missing, record nothing, guess nothing, and write "no fixed report" in the OCC LOG.
3. `arrivalMissing` entry with `due: true`: write the FLIGHT in your OCC LOG and tell the SUPERVISOR once (the receiving session missed it or the CAPTAIN did not send it).
4. Do not message the CAPTAIN to ask.
5. `due: false`: the report may still be on its way; wait.
6. When a report arrives later, check it against the `arrivalMissing` list to see whether it is already recorded.

Stop and report if:
- Expected: the report has the fixed header and every value.
- Found: a value is missing, or the report's `BLOCKED` is not `none`.
- Why it matters: a guessed value is a false record; a real BLOCKED reaches the SUPERVISOR through `blocked-report`. Record nothing you cannot read, and report the rest.

End state: the report is recorded (fixed lines), or the missing FLIGHT is in the OCC LOG and the SUPERVISOR has been told once.

Report line: OCC LOG (Korean): the FLIGHT, "merged, no ARRIVED report", and the age in minutes.
