### Added
- UPDATE bar (ATC-82, [docs/mcc.md](docs/mcc.md) "UPDATE bar as built"). When the running service is behind `origin/main`, the top bar shows `업데이트 있음 · c0ca22e → 4678e03 · PR 2 · CI ✓ [업데이트]`, and the button starts the same `atc-rts` unit MCC uses, in any MCC mode. The bar follows it: starting, running, "재시작 중" while the SSE reconnects (LINK shows "재시작", not "끊김"), then the new-version bar. A refusal shows its reason; after a ROLLBACK the bar says RTS is stopped and how to clear it; when the range changes `package*.json` or `deploy/*.service`/`*.timer` it shows why a person must deploy instead of the button. `GET /api/update` is the status, `POST /api/update/start` is SUPERVISOR-only (the screen's own request) and records `{op: "rts", by: "supervisor"}` in `mcc.jsonl`.
- Guide page "배포하기" (`docs/guide/deploy.md`): the bar, and when to deploy by hand.

### Fixed
- A server with a temporary `ATC_STATE_DIR` or a port other than 7700 no longer starts the `atc-rts` unit (it deploys 7700), from `/api/mcc/rts` too.
