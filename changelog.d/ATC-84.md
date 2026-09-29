### Added
- MCC mode `rts` (ATC-84, [docs/mcc.md](docs/mcc.md) "Mode `rts` and the server's own RTS as built"): the SUPERVISOR merges atc PRs by hand and the atc server starts RETURN TO SERVICE by itself when it is due (main CI passed, 5-minute spacing, not stopped after ROLLBACK), without waiting for the MCC session's `/tick`.
  - `land+rts` keeps MCC's landing and uses the same server-side trigger. In `rts` MCC records `would-land` only. The choice is in the settings window (MCC row).
  - The decision is a pure function (`autoRtsOf`). Ranges that change `package*.json` or unit files, and a `main` the last RTS refused or failed on, stay with the SUPERVISOR (UPDATE bar). Test servers (temporary state folder, port other than 7700) never start the unit.
  - `mcc rts` from the session still works and says so when the server already started it. The UPDATE bar shows `자동 배포 켜짐` in these modes, with the next due time while it waits out the 5-minute spacing.
