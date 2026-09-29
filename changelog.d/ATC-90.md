### Changed
- DISPATCH no longer treats a stopped team as free (ATC-90, [docs/dispatch.md](docs/dispatch.md) 5.1.2). An AIRCRAFT whose health is `RESUME` or `STALLED`, or that still holds an In Progress FLIGHT with no merged PR (by `tail:` label or claimed STAND), gets no new ASSIGN.
  - It shows under "excluded" with the reason and the FLIGHT it holds, like `TEAM_G — VOC-72 아직 진행 중(PR 없음)` or `TEAM_H — RESUME 필요(한도 풀림 22:10Z)`.
  - Held FLIGHTs use the AIRCRAFT's slots by WAKE, so a team with room left can still get a FLIGHT that fits, and STAND-free FLIGHTs (SURVEY, CHECK) still go to a team that holds one.
  - An open proposal to such an AIRCRAFT is SUPERSEDED as `AIRCRAFT 멈춤 — …`. It is not a SUPERVISOR verdict, so the 24-hour pair rule does not start.
