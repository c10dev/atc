### 추가
- NEEDS YOU: atc가 백그라운드 세션의 job 상태(`~/.claude/jobs/<jobId>/state.json`, 읽기 전용)를 읽어 job이 `blocked`인 동안 `NEEDS YOU · <needs>` 칩을 보인다(ATC-99, [docs/fleet.ko.md](docs/fleet.ko.md) "NEEDS YOU as built").
  - FLEET 목록과 카드(카드에는 제안된 답이 복사만 되는 줄로 보인다), STRIPS 스트립(blocked 세션은 PARKED여도 보인다), CONTROL 블록에 붙는다. `working`인 job은 한 줄 `detail`이 보인다.
  - 3분(`ATC_HEALTH_BLOCKED_MIN`) 넘게 blocked이면 `needs` 글과 함께 `BLOCKED` health 경보가 뜨고, state가 `blocked`를 벗어나면 풀린다.
  - `intent`·`output`·`providerEnv`·`linkScanPath`는 읽지도 내보내지도 않는다. 모르는 파일·없는 파일은 아무것도 보이지 않는다.
