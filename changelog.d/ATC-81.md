### Added
- FOB (FUEL ON BOARD) on the FLEET row and card (ATC-81, [docs/fleet.md](docs/fleet.md) 8.6 "FOB as built"): the AIRCRAFT's own fuel, the context window left, as `FOB 50% · 504k/1M`. It replaces the CONTEXT column. The colour follows the meaning: amber at 60 % left or less, alert at 30 % or less (the same points as ATC-69's 40 % / 70 % used). `GET /api/fleet` keeps `context` and adds `fobPct`.

### Changed
- The ACCOUNT plan-limit percentage leaves the FLEET row, so it no longer reads as the AIRCRAFT's own fuel. The row keeps only `HOLD · FUEL (account acct-2) until …` when the ACCOUNT is at the hold level. `GET /api/fleet` rows drop `fuel` for `fuelHold`.
- Every ACCOUNT plan-limit text now says it is used: `사용 87% · resets 21:00Z` in the FLEET FUEL block and on the card, `FUEL 사용 87% · resets …` in the TOWER `open.fuel`, FOLLOWING and FLEET PLAN texts, and `HOLD · FUEL (account pro-2) until …` (no percentage) in the DISPATCH reason. Display text only: no value, threshold or rule changed.
