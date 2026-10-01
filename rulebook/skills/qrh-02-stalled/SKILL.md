---
name: qrh-02-stalled
description: Use when OCC or TOWER sees an AIRCRAFT health code STALLED or RESUME (a FLIGHT-following health issue or a health alert).
---

# QRH-02 stalled   rev 2026-10-01.1   owner: OCC manual (following.md), TOWER manual, docs/fleet.md 8.8

Condition: you are OCC or TOWER and an AIRCRAFT holding a FLIGHT has health code `STALLED` (idle 60 min or more with an In Progress FLIGHT and no PR) or `RESUME` (a usage limit has reset and no new instruction came).

Commands below run from your own working folder (`occ/` for OCC, `controller/` for TOWER), as in your manual; do not `cd` to the skill's folder.

Steps (in this order):
1. Read the server's `code`, `text` and `next` for that AIRCRAFT. Use the `next` text as given.
2. Do not message the team, do not resend a prompt or a FLIGHT PLAN, and do not issue a new CLEARANCE to an AIRCRAFT that has a code. atc never messages a team for this.
3. `RESUME` (an alert): tell the SUPERVISOR once, with the server's `message` and `next`: the SUPERVISOR sends "continue" in that session.
4. `STALLED` (info): write one line in your LOG (OCC LOG or ATC LOG) with the server's `next`: the SUPERVISOR looks at the session, sends "continue" if nothing blocks it, and decides RESTART if it cannot be revived.
5. Mark it reported: OCC `node ../controller/atcctl.mjs following ack`; TOWER acks its tick as usual. A new code is a new issue; do not report the same one again.

Stop and report if:
- Expected: the code clears after the SUPERVISOR's "continue".
- Found: the same code returns after "continue".
- Why it matters: a returning code arrives as a new issue and is reported by the same rule. Do not message the team; the SUPERVISOR decides.

End state: the SUPERVISOR told (`RESUME`) or one LOG line written (`STALLED`); nothing sent to the team; the issue acked.

Report line: OCC LOG or ATC LOG (Korean, for the SUPERVISOR): `<AIRCRAFT> <code> — <text> / next: <next>`.
