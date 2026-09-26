# 화면 안내

| 탭 | 주소 | 보는 것 | 할 수 있는 것 |
|---|---|---|---|
| RADAR | `#radar` | 세션 ─ STAND ─ FLIGHT 3열을 선으로 연결. 주인 없는 STAND, STAND 없는 진행 FLIGHT 강조 | 전체 보기 전환 |
| STRIPS | `#strips` | 맨 위 LANDING SEQUENCE(열린 PR), 세션마다 FLIGHT STRIP: 상태, 쥔 STAND, FLIGHT(없으면 AD HOC), STAND의 PR 착륙 배지, 마지막 교신 | PR 링크 열기, 막는 조건 펼치기 |
| FIDS | `#board` | Linear 상태 열별 FLIGHT 카드와 점유 팀 배지 | — |
| AIRPORTS | `#airports` | 저장소 등록부, 소속 AIRCRAFT, OUTSTATION으로 와 있는 AIRCRAFT | AIRPORT 개설·코드 변경·폐쇄 |
| FLEET | `#fleet` | 팀별 상태, 지금 FLIGHT, 팀원, 자격, ROUTE, TARGETS | 프로필 편집, ENTRY INTO SERVICE, CREW BRIEFING, AOG, 퇴역 |
| METRICS | `#metrics` | FLIGHT RECORDER로 본 운용 지표와 추이 | — |
| DISPATCH | `#dispatch` | 배정 계획과 제안, HELD, IN FLIGHT, 제외된 FLIGHT, 2b·3단계 점검 | 판정, HOLD 풀기, 모드 전환 |
| SCHEDULE | `#schedule` | OCC 초안(CLASSIFY·PRIORITIZE·NEW), S2 점검, 후보 수 | 판정 |
| DOCS | `#docs` | 이 안내 | — |

## STRIPS의 LANDING SEQUENCE

STRIPS 맨 위에 GitHub에 열린 PR을 LANDING 순서대로 보여 준다([개념](concepts.md)의 LANDING SEQUENCE).

- **CLEARED TO LAND**: 조건을 모두 채운 PR. 준비된 순서(`readyAt`)대로 번호가 붙고 펼쳐 둔다. 제목의 숫자가 CLEARED TO LAND PR 수다.
- **APPROACH**: 막는 조건이 남은 PR(Draft 제외). PR을 연 순서로, 접어 둔 줄을 누르면 열린다. 줄마다 막는 조건이 한국어 한 줄씩 붙는다.
- **DRAFT**: 흐리게, 접어 둔다. LANDING SEQUENCE에는 들지 않는다.
- 줄마다 AIRPORT·FLIGHT(없으면 AD HOC), `#번호`(GitHub PR로 열림)와 제목, 그 STAND를 쥔 팀(없으면 STAND 이름이나 "STAND 없음").
- GitHub 조회가 실패하면 위에 "GitHub 조회 실패 · PR 상태가 오래됐을 수 있음"이 뜬다(마우스를 올리면 오류).

STAND 줄의 REMARKS 칸에도 그 STAND 브랜치의 PR 배지가 붙는다.

| 배지 | 뜻 |
|---|---|
| `CLEARED TO LAND` (+ `SEQ n`) | 머지할 수 있음. `SEQ n`은 CLEARED TO LAND PR이 둘 이상일 때 몇 번째인지 |
| `APPROACH` + 숫자 | 막는 조건 수. 아래 줄에 짧은 이름(CI 실패, 리뷰 없음, BEHIND …)이 있고, 누르면 전체 문장이 펼쳐진다 |
| `#번호` | GitHub PR 링크 |

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
