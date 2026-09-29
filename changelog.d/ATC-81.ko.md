### 추가
- FLEET 줄과 카드에 FOB(FUEL ON BOARD)(ATC-81, [docs/fleet.ko.md](docs/fleet.ko.md) 8.6 "FOB as built"): AIRCRAFT 자기 연료, 곧 맥락 창에 남은 몫을 `FOB 50% · 504k/1M`으로 보인다. CONTEXT 열을 대신한다. 색은 뜻을 따른다: 남은 몫 60 % 이하 노랑, 30 % 이하 빨강(ATC-69의 쓴 몫 40 % / 70 %와 같은 지점). `GET /api/fleet`은 `context`를 그대로 두고 `fobPct`를 더한다.

### 변경
- ACCOUNT 사용 한도 백분율이 FLEET 줄에서 빠진다. AIRCRAFT 자기 연료처럼 읽히지 않게 하려는 것이다. ACCOUNT가 hold 수준일 때만 줄에 `HOLD · FUEL (account acct-2) until …`이 남는다. `GET /api/fleet` 줄은 `fuel` 대신 `fuelHold`를 준다.
- ACCOUNT 사용 한도 글은 모두 쓴 몫이라고 말한다: FLEET FUEL 블록과 카드는 `사용 87% · resets 21:00Z`, TOWER `open.fuel`·FOLLOWING·FLEET PLAN 글은 `FUEL 사용 87% · resets …`, DISPATCH 사유는 `HOLD · FUEL (account pro-2) until …`(백분율 없이). 표시 글만 바꿨다: 값·임계값·규칙은 그대로다.
