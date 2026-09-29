### Added
- FLEET marks background AIRCRAFT with the job they run and copies `claude attach <jobId>` (ATC-98, [docs/fleet.md](docs/fleet.md) 8.5.2).
  - The snapshot's `Session` gains `kind` (`background` or `interactive`) and `jobId` from the session file, and `AircraftView` and the FLEET list rows carry `background: { jobId }` from the AIRCRAFT's live session. It is computed from the snapshot, so `claude agents` isn't called more often. Dead sessions and STALE jobs have no chip.
  - The `BG` chip's tooltip reads `BG <jobId> — claude attach <jobId>`, and the card has an `ATTACH 복사` button that copies that command.
