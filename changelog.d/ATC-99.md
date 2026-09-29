### Added
- NEEDS YOU: atc reads each background session's job state (`~/.claude/jobs/<jobId>/state.json`, read-only) and shows a `NEEDS YOU · <needs>` chip while the job is `blocked` (ATC-99, [docs/fleet.md](docs/fleet.md) "NEEDS YOU as built").
  - On the FLEET list and card (the card also shows the suggested reply as a copy-only line), on the STRIPS strip (a blocked session is shown even when PARKED) and in the CONTROL block. A `working` job shows its one-line `detail`.
  - A job blocked for 3 minutes (`ATC_HEALTH_BLOCKED_MIN`) raises a `BLOCKED` health alert with the `needs` text; it clears when the state leaves `blocked`.
  - `intent`, `output`, `providerEnv` and `linkScanPath` are never read or exposed. Unknown or missing files show nothing.
