### Added
- ARRIVED candidates for STAND-free FLIGHTs, confirmed by OCC, and LOGBOOK entries so they count (ATC-72, [docs/fleet.md](docs/fleet.md) 5.1.1). atc still never marks ARRIVED on its own.
  - Detection is attributed by the flying team's own session transcript (its `gh pr review|comment`, `gh issue comment`, `gh api` writes and Linear `save_comment` calls), because all GitHub and Linear writes come from one account. It is matched to the real GitHub review or comment by time.
  - CHECK: a review or PR comment by the checking team on a target PR after departure. SURVEY: a merged docs-only PR naming the FLIGHT, a GitHub comment naming it, or a Linear comment with a result link. Unknown team, wrong author or before departure means no candidate.
  - Candidates show in `dispatch brief` (`arrivalCandidates`, with evidence, reason and the `command` to run) and on the DISPATCH card as "ARRIVED 후보". OCC checks the evidence and runs the command.
  - Direct assignment (no D-xxxx): the team's READBACK becomes a DEPARTURE LOG `readback` line (`stand: null`). `atcctl dispatch arrived <FLIGHT> --aircraft <TEAM_X> -- '<link>'` confirms it.
  - A confirmed STAND-free ARRIVED writes a LOGBOOK `arrived` line with no `pr` (`standFree: {arrivedVia, evidence, workDoneAt, proposal}`), so TARGETS, CHECKRIDE and FUEL F4 count it. PR-only readers skip these lines, and old lines read unchanged.
  - `gate3.standFree.timely`: share of STAND-free ARRIVED confirmed within 24 h of the work being done.
