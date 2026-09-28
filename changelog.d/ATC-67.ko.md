### 변경
- 한 REGISTRATION을 어디서나 같게 읽는다(ATC-67, [docs/fleet.ko.md](docs/fleet.ko.md) "REGISTRATION 표기 as built"). DISPATCH `teamPattern`은 `Team G`, `TEAM-G`, `team_g`를 팀 세션으로 받았지만 나머지는 `toUpperCase()`로만 비교해서, 이런 이름은 `fleet.json`의 `TEAM_G`, `tail:TEAM_G`, ACCOUNT 구성원과 만나지 못했다.
  - 순수 함수 `registrationOf(name, teamPattern)`(`server/registration.ts`)가 받는 표기를 모두 `TEAM_G`로 바꾼다. 규칙은 `teamPattern`에서 가져온다. 팀이 아닌 이름은 `null`이고 전처럼 대문자로 비교한다.
  - FLEET, DISPATCH(tail, CHECK 독립성, FUEL, 프로필·ACCOUNT), CREW CHANGE, 관찰한 CREW, CHECKRIDE, BRIEFING, FLEET PLAN, ATFM, FUEL, FLIGHT FOLLOWING, 세션 조종, TAIL 초안이 REGISTRATION으로 비교한다. `tail:team-g`도 `TEAM_G`다.
  - 새 LOGBOOK, DEPARTURE LOG, FLIGHT RECORDER, FLEET PLAN 기록은 정식 REGISTRATION으로 쓴다. 옛 줄은 표기를 그대로 두고 읽을 때 맞춘다. DISPATCH 제안의 `aircraftName`과 CREW CHANGE의 `registration`은 `occ/send-guard.mjs`가 정확히 맞춰 보는 수신자라 살아 있는 세션 이름을 그대로 둔다(SUPERVISOR 결정). guard는 바꾸지 않았다.
  - 살아 있는 세션 이름이 정식 표기가 아니면 FLEET가 그 AIRCRAFT에 `세션 이름 Team G → TEAM_G로 바꾸면 좋다`를 보인다. 같은 REGISTRATION으로 읽히는 세션이 둘이면 합치지 않고 충돌로 보인다(idea #96).
