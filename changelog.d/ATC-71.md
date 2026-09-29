### Added
- DISPATCH sees file overlap between a FLIGHT about to be assigned and the FLIGHTs already in flight at the same AIRPORT (ATC-71, [docs/dispatch.md](docs/dispatch.md) 5.3.1).
  - Files in flight: the STAND's `git diff` from the merge-base plus uncommitted paths (read-only), and each open PR's file list (cached per head). Predicted files: backticked paths and globs in the FLIGHT's body and its linked FLIGHTs' bodies, each with its source. No model call.
  - New factors `파일 겹침` (WAKE-scaled, names the files, FLIGHT and team) and `이어서 하면 충돌 없음` (the team already flying the overlapping FLIGHT is the only one touching those files).
  - `dispatch.json` `overlap.hold` (default `false`) holds a heavily overlapping FLIGHT as HOLD_DEPARTURE until the holding FLIGHT merges; off, the DISPATCH tab shows what it would hold (`shadow —`).
  - ATFM records a `dirty` operation when an open PR turns `DIRTY`, with the PRs that shared files then; the ATFM data line `DIRTY(겹침 예측 가능)` shows `seen/dirty` over 7 days.
