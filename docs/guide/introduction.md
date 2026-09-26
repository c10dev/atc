# atc 소개

atc(Air Traffic Control)는 여러 Claude Code 세션이 한 저장소에서 동시에 일할 때, **누가 어디서 무엇을 하는지 보이게 하고 서로 부딪히지 않게 하는 로컬 관제 웹**이다. 세션은 항공기, 워크트리는 주기장, Linear 티켓은 운항편으로 본다.

## 무엇을 해 주나

| 질문 | atc가 보여 주는 것 |
|---|---|
| 지금 어느 팀이 일하고 있나 | 팀 세션마다 상태: AIRBORNE(작업 중), HOLDING(STAND를 쥔 채 대기), PARKED(대기) |
| 누가 어느 워크트리를 쓰나 | 세션 ─ STAND(워크트리) ─ FLIGHT(티켓)를 선으로 잇는 RADAR |
| 두 팀이 같은 워크트리를 건드리나 | LOSS OF SEPARATION(충돌) 경보. 넘겨준 경우는 HANDOFF로 구분 |
| 다음에 무엇을 누구에게 맡길까 | DISPATCH 배정 제안(지금은 그림자 운용: 판정만) |
| 티켓 정리는 누가 하나 | OCC의 SCHEDULE 초안(분류·우선순위·새 티켓) |
| 팀은 어떻게 꾸리나 | FLEET 탭: 팀 구성, 자격, 담당 프로젝트, 새 팀 들이기 |

## 누가 무엇을 하나

```
SUPERVISOR (사용자) ─ 판정·승인·머지, 최종 권한
   │
   ├─ OCC (운항관제, atc/occ 세션)   무엇을·누가·언제: DISPATCH 제안 검토, SCHEDULE 초안, 팀 보고 확인
   ├─ TOWER (교통관제, atc/controller 세션)   뜬 것끼리 간격: 충돌, HANDOFF, 머지 순서
   │
   └─ AIRCRAFT (TEAM_A … 팀 세션)   CAPTAIN(리더)이 CREW(팀원)를 데리고 실제 작업
```

- **OCC와 TOWER는 코드를 고치지 않는다.** 읽고, 제안하고, 교신만 한다. guard가 기계적으로 막는다.
- **결정은 사용자가 한다.** 자동화는 그림자 운용 → 승인 운용 → 저위험만 자동 순서로 넓힌다([단계와 로드맵](stages.md)).

## 어디서 시작하나

1. [빠른 시작](quickstart.md): atc를 띄우고 TOWER·OCC 세션을 연다.
2. [개념과 용어](concepts.md): 화면에 나오는 항공 용어.
3. [일 맡기기](requesting.md): 작은 수정은 팀에 직접, 티켓이 필요한 일은 CHARTER DESK로.
4. [판정하기](reviewing.md): DISPATCH·SCHEDULE 탭에서 "승인했을 것 / 거절했을 것".
