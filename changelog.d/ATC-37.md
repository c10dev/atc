### Added
- HUMAN CHECK queue: only PRs that truly wait on a person (ATC-37, [docs/occ.md](docs/occ.md) 9.8). atc reads the `## UI change` block of the PR body. PRs whose class is `CHOICE`, `ACCOUNT` or `DEVICE` and whose `Human check` isn't `done` for the current head show at the top of STRIPS.
  - Each row has PR, FLIGHT, team, class, the evidence pack (thumbnails from the linked PR comment, and the RUN-UP report for that exact head when there is one) and, for ACCOUNT and DEVICE, the Preview link and the 1–3 human steps.
  - PASS / FAIL is SUPERVISOR only (same Origin rule as the AUTOLAND switch). It re-reads the PR and refuses if the head moved. It then sets the single `Human check:` line to `done|failed <date> <sha> <note>` and posts one PR comment. Those are its only GitHub writes. Results are bound to the head and carry across main-only merges (ATC-31). Every attempt is appended to `human-checks.jsonl`.
  - RUN-UP report files are served only from inside that report folder, sandboxed. No Vercel share tokens are created or stored.

### Changed
- AUTOLAND `merge` no longer reads the old Human Preview gate (ATC-37). It holds back a classed PR until its HUMAN CHECK is `done` for the head, and a PR whose `## UI change` block is missing or whose class is unfilled. PRs with class `none` are not held back. LANDING SEQUENCE rows show `HUMAN CHECK <class>: <state>`.
