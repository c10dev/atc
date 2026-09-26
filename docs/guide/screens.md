# 화면 안내

| 탭 | 주소 | 보는 것 | 할 수 있는 것 |
|---|---|---|---|
| RADAR | `#radar` | 세션 ─ STAND ─ FLIGHT 3열을 선으로 연결. 주인 없는 STAND, STAND 없는 진행 FLIGHT 강조 | 전체 보기 전환 |
| STRIPS | `#strips` | 세션마다 FLIGHT STRIP: 상태, 쥔 STAND, FLIGHT(없으면 AD HOC), 마지막 교신 | — |
| FIDS | `#board` | Linear 상태 열별 FLIGHT 카드와 점유 팀 배지 | — |
| AIRPORTS | `#airports` | 저장소 등록부, 소속 AIRCRAFT, OUTSTATION으로 와 있는 AIRCRAFT | AIRPORT 개설·코드 변경·폐쇄 |
| FLEET | `#fleet` | 팀별 상태, 지금 FLIGHT, 팀원, 자격, ROUTE, TARGETS | 프로필 편집, ENTRY INTO SERVICE, CREW BRIEFING, AOG, 퇴역 |
| METRICS | `#metrics` | FLIGHT RECORDER로 본 운용 지표와 추이 | — |
| DISPATCH | `#dispatch` | 배정 계획과 제안(CROSSCHECK 칩), HELD, IN FLIGHT, 제외된 FLIGHT, 2b·3단계 점검과 CROSSCHECK 일치 | 판정, CROSSCHECK에 동의, HOLD 풀기, 모드 전환 |
| SCHEDULE | `#schedule` | OCC 초안(CLASSIFY·PRIORITIZE·NEW, CROSSCHECK 칩), S2 점검과 CROSSCHECK 일치, 후보 수 | 판정, CROSSCHECK에 동의 |
| DOCS | `#docs` | 이 안내 | — |

## 상단

- **숫자판**: AIRBORNE(작업 중 세션), STANDS(점유), ENROUTE(진행 FLIGHT), HANDOFF, ALERTS.
- **ALERT 줄**: 경보가 흘러간다. 누르면 목록이 열린다.
- **ATC 로고**: 설정(테마, 움직임, 시계).

## 경보 종류

| 경보 | 뜻 |
|---|---|
| LOSS OF SEPARATION | 두 세션이 같은 STAND를 겹쳐 건드림 |
| NORDO STAND | 죽은 세션이 쥔 STAND |
| NO CONTACT | ENROUTE인데 STAND가 없는 FLIGHT(상위 이슈는 제외) |
| UNIDENTIFIED | 점유한 AIRCRAFT 없이 바뀐 STAND |
