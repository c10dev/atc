### Changed
- TOWER (`controller/`) and OCC (`occ/`) run on `claude-sonnet-5-5`, pinned in each folder's `.claude/settings.json`. Before, they had no `model` there and took the user default (`sonnet`, which gave `claude-sonnet-5`). Sonnet 5.5 has the same list price. The change applies when each session is next started (settings window, AGENTS → CONTROL, STOP then LAUNCH).
