### Fixed
- A stopped `claude --bg` job that Claude Code still lists no longer blocks LAUNCH or counts as live (ATC-93, [docs/fleet.md](docs/fleet.md) 8.5.1). On 2026-09-29 a TOWER job stopped while `done` stayed in `claude agents` with no `pid` and no `status`, and atc refused to LAUNCH TOWER.
  - Such a row is STALE when it is background, has no `pid` and no `status`, its `~/.claude/jobs/<id>/state.json` `state` is `done`, `stopped` or `failed` (the only field read), and it is at least 2 minutes old. A job being spawned is never STALE.
  - Control and team LAUNCH, the `ATC_MAX_LAUNCHED` cap and FLEET PLAN skip STALE rows. STOP on a STALE-only session explains why and doesn't run `claude stop` again.
  - The CONTROL block and the FLEET card show `STALE <id>` with a one-line note; LAUNCH stays available. `GET /api/control/sessions` has `stale`, and `GET /api/fleet/sessions` rows have `stale: true`.
