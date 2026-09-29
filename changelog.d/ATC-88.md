### Added
- DISPATCH judges (Jev): the judge family also marks each open ASSIGN proposal with Ready, Prerequisite (Noul) and Same area (Score), shadow only (ATC-88, [docs/fleet.md](docs/fleet.md) 6.1).
  - Shares the switch, the 3-a-minute limit (with CLASSIFY, taking turns), the back-off and the engines. Never changes a score, status or HOLD; `proposals.jsonl` is untouched.
  - Sends the FLIGHT under the ATC-36 allowlist. For Same area only, the titles of the AIRCRAFT's last 3 LOGBOOK FLIGHTs go too, and only when all are atc FLIGHTs.
  - `judges.jsonl` lines with `target: "dispatch"`. A `JEV` chip shows on closed proposals in RECENT only; the gate panel counts how often each answer matched the SUPERVISOR's rejection, a `waiting-on-prior` chip or OCC HOLD, and approval.
