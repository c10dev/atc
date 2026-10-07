# One OCC pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

## Two modes (CONTROL WAKE, ATC-557)

The SUPERVISOR picks the mode in the settings window, CONTROL WAKE OCC. The first prompt and the output of `node ../controller/atcctl.mjs tick occ` tell which one is on.

- **Wake mode (`wake`, the default).** There is no `/loop`. When the atc server sees something that needs a decision it wakes this session with one `[ATC WAKE W-xxxx] OCC` message (what is new, what is still open, what was resolved since the last wake, the FLIGHTs it bears on). At start the session gets `[ATC WAKE BOOT] OCC`.
  - On such a message, step 0 is `node ../controller/atcctl.mjs tick occ --wake W-xxxx` (`--wake boot` for BOOT), and the steps below follow unchanged. Work from the whole output, not only the items in the message.
  - Do not reply to ATC (it is the server, not a session). The last line of the turn is one of `WAKE RESULT: acted` (anything was issued, recorded, sent or reported) or `WAKE RESULT: nothing` (there was nothing to do). atc counts misfires from this line.
  - Team replies (READBACK, UNABLE, questions …) still arrive by session name and wake this session. Record and report them as step 1 says and end the turn; the server wakes the session separately for anything else.
  - If step 0 of a `/tick` from a leftover `/loop` prints `TICK WAKE-MODE occ — …`, do nothing and end the turn at once (no OCC LOG line). atc relaunches the session once, without `/loop`, at a safe moment.
- **Loop mode (`loop`).** As before: In wake mode (the default) the server's `[ATC WAKE …]` message calls it; in loop mode `/loop 10m /tick` does. Step 0 is `node ../controller/atcctl.mjs tick occ` without `--wake`. If the wake job or the wake BREAKER has stopped, `/tick` also works this way in wake mode (no `TICK WAKE-MODE` is printed).

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
