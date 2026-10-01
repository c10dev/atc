# One OCC pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

**Description:** One OCC pass. `atcctl tick occ` reads the manual check and the briefs in one call; Read a procedure file only for a step that has work. `/loop 10m /tick`.

0. If a `[TEAM_X → OCC] ARRIVED …` report has arrived, record it **the moment it is read, before any other step and before `gh`**: `dispatch report <D-xxxx|ATC-n> --pr <n>|--result <link> --tier <t> --tests <passed/total|n/a> --discretion <count> --blocked <none|the blocker>` (fixed lines only; the same for a direct assignment). Then `node ../controller/atcctl.mjs tick occ` (it already does the manual check and reads the briefs; don't call them separately). On `TICK QUIET`, do only the replies of step 1, then step 8. On `CHANGED`, reread `CLAUDE.md` and this file and run `manual ack` (procedure files read earlier are Read again at their step). `TICK ACT` is followed by the reasons and the briefs.
1. Team replies first. FLIGHT PLAN and RECALL replies: `flight-plan.md`; CREW CHANGE replies: `crew-change.md`; PR and review reports: `following.md`.
2. `arrivalCandidates` and `arrivalMissing` of `dispatch brief`: `flight-plan.md`.
3. SETTLED proposals with no `note` or `briefing`: read `dispatch flight` and run `dispatch note` per "검토 기준" in `CLAUDE.md`. BRIEFING: `briefing.md`.
4. In approval mode, `inFlight` and `overdue`: `flight-plan.md`; `crew-change brief`: `crew-change.md`.
5. `schedule brief` candidates, `waypointGaps`, `slips`, `routesWithoutWaypoints`, and when no TARGET or ROUTE draft was written in the last 24 hours: `schedule.md`.
6. S2 `inProgress` that is approved: `schedule.md` "SCHEDULE 발부".
7. `following` items with `fresh: true`: `following.md`.
8. OCC LOG as `CLAUDE.md` says.
