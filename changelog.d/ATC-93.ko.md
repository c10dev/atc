### 수정
- Claude Code가 아직 목록에 둔 멈춘 `claude --bg` job이 더는 LAUNCH를 막거나 살아 있는 세션으로 세이지 않는다(ATC-93, [docs/fleet.ko.md](docs/fleet.ko.md) 8.5.1). 2026-09-29에 `done`일 때 멈춘 TOWER job이 `pid`·`status` 없이 `claude agents`에 남아, atc가 TOWER LAUNCH를 거절했다.
  - background이고, `pid`·`status`가 없고, `~/.claude/jobs/<id>/state.json`의 `state`(읽는 칸은 이것뿐)가 `done`·`stopped`·`failed`이고, 시작한 지 2분이 넘은 줄이 STALE이다. 막 띄우는 job은 STALE이 되지 않는다.
  - 관제·팀 LAUNCH, `ATC_MAX_LAUNCHED` 상한, FLEET PLAN이 STALE 줄을 뺀다. STALE만 있는 세션의 STOP은 이유를 말하고 `claude stop`을 다시 하지 않는다.
  - CONTROL 블록과 FLEET 카드에 `STALE <id>`와 한 줄 설명이 보이고, LAUNCH는 그대로 쓸 수 있다. `GET /api/control/sessions`에 `stale`, `GET /api/fleet/sessions` 줄에 `stale: true`가 생겼다.
