### Changed
- DUTY runs with the 1M context window: `duty/settings.json` sets `model` to `claude-sonnet-5-5[1m]` instead of `claude-sonnet-5-5` (200k), so a long shift fits before Claude Code compacts the conversation ([docs/duty.md](docs/duty.md) 3 and 7). A running DUTY process keeps its model until it is spawned again (idle exit, NEW SHIFT or a restart). The settings are `user` tier.
