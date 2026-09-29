### 추가
- RESTARTING(ATC-91, [docs/fleet.ko.md](docs/fleet.ko.md) 8.5 "RESTARTING as built"). 데스크톱의 `/clear`는 세션을 끝내고 다음 세션은 같은 이름으로 새 id를 받는다. 정상으로 끝난 뒤 `restartGraceMin`(기본 30, `dispatch.json`) 동안, 세션 파일도 그 REGISTRATION의 살아 있는 세션도 없으면 AIRCRAFT는 없음(absent) 대신 `RESTARTING`이다: FLEET 목록에 상태와 `세션 없음 — /clear 뒤 첫 메시지 대기`가 보이고, 카드에 기다리는 시각이 적히며, FLEET PLAN은 그 AIRCRAFT에 LAUNCH를 제안하지 않는다. 대화 기록과 세션 파일만으로 찾으므로 `hooks/`에는 더한 것이 없다.

### 변경
- DISPATCH가 제안을 REGISTRATION으로 짝짓는다(ATC-91, [docs/dispatch.ko.md](docs/dispatch.ko.md) 6.4). `/clear`가 AIRCRAFT를 잃게 하지 않는다. 새 ASSIGN 제안은 `aircraft`·`aircraftName` 옆에 `registration`(ATC-67 `registrationOf`)을 담고, 짝 규칙(24시간 `wrong-aircraft` 등), AIRCRAFT 예약, `stillValid`, READBACK 추적이 그것을 쓴다. 없는 옛 줄은 `aircraftName`으로 읽는다. send-guard는 그대로다.
- AIRCRAFT가 `RESTARTING`인 `proposed`·`approved` ASSIGN은 `AIRCRAFT 불가: 세션 없음`으로 SUPERSEDED되지 않고 기다린다. 유예가 지나면 전처럼 닫힌다. `POST /api/dispatch/proposals/:id/release`는 그 AIRCRAFT에 살아 있는 세션이 없고 `RESTARTING`이면 409를 돌려준다. brief에 `waiting`이 더해지고 DISPATCH 카드와 진행 중 줄이 제안이 첫 메시지를 기다린다고 말한다.
