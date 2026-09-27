# 화면 안내

| 탭 | 주소 | 보는 것 | 할 수 있는 것 |
|---|---|---|---|
| RADAR | `#radar` | 세션 ─ STAND ─ FLIGHT 3열을 선으로 연결. 주인 없는 STAND, STAND 없는 진행 FLIGHT 강조 | 전체 보기 전환 |
| STRIPS | `#strips` | 맨 위 LANDING SEQUENCE(열린 PR), 세션마다 FLIGHT STRIP: 상태, 쥔 STAND, FLIGHT(없으면 AD HOC), STAND의 PR 착륙 배지, 마지막 교신 | PR 링크 열기, 막는 조건 펼치기 |
| FIDS | `#board` | Linear 상태 열별 FLIGHT 카드와 점유 팀 배지 | — |
| AIRPORTS | `#airports` | 저장소 등록부, 소속 AIRCRAFT, OUTSTATION으로 와 있는 AIRCRAFT | AIRPORT 개설·코드 변경·폐쇄 |
| FLEET | `#fleet` | 팀별 상태, 지금 FLIGHT, 팀원, 자격, ROUTE, TARGETS와 LOGBOOK 실적(이번 주, 정시, 되돌림, LOS, 최근 FLIGHT), CHECKRIDE(TYPE RATING 근거와 추천) | 프로필 편집, ENTRY INTO SERVICE, CREW BRIEFING, AOG, 퇴역, rating 부여·회수 |
| NETWORK | `#network` | 4단계 운항 개요(읽기 전용): ROUTE(Linear 프로젝트)별 열린 FLIGHT·14일 ARRIVED·도는 AIRCRAFT·착륙 대기·프로젝트 목표, AIRCRAFT별 TARGETS 대 실적, 28일 추세(ARRIVED·착륙 대기·되돌림, 게이트 판정·합의율·CROSSCHECK 일치율) | — |
| METRICS | `#metrics` | FLIGHT RECORDER로 본 운용 지표와 추이 | — |
| DISPATCH | `#dispatch` | 배정 계획과 제안(CROSSCHECK 칩), HELD, IN FLIGHT, 제외된 FLIGHT, 2b·3단계 점검과 CROSSCHECK 일치, ATFM 블록(출발 중지, main CI, 머지 슬롯, 자동 배정·S3 대상 그림자 판정), FLIGHT FOLLOWING 블록(배정된 FLIGHT의 단계 막대, 지연·불일치, OCC가 보고했는지) | 판정, CROSSCHECK에 동의, HOLD 풀기, 모드 전환, ATFM 스위치(main 깨짐·수동)와 수동 출발 중지, ATFM OFF |
| SCHEDULE | `#schedule` | OCC 초안(CLASSIFY·PRIORITIZE·NEW, CROSSCHECK 칩), S2 점검과 CROSSCHECK 일치, 후보 수 | 판정, CROSSCHECK에 동의 |
| DOCS | `#docs` | 이 안내 | — |

## NETWORK

ROUTE·AIRCRAFT·추세를 한 화면에서 보는 읽기 전용 개요다. 아무것도 바꾸지 않고, 배정 점수에도 쓰지 않는다. 숫자를 읽는 법:

- **ROUTE 표**: Linear 프로젝트마다 한 줄. 열린 FLIGHT는 Todo(FILED)·In Progress(ENROUTE)·In Review(APPROACH, Ready to Merge 포함)로 나눠 센다. Backlog·끝난 것·상위 이슈는 세지 않는다. ARRIVED 14일은 그 프로젝트 FLIGHT의 LOGBOOK 기록이고, 착륙 대기는 그 기록의 중앙값이다. 목표(목표일·진척·상태)는 Linear 프로젝트에서 10분마다 읽고, 못 읽으면 비어 있다.
- **AIRCRAFT 표**: FLEET 카드와 같은 숫자다(이번 주 ARRIVED 대 `flightsPerWeek`, 14일 정시율 대 `onTime`, 착륙 대기, 되돌림, LOS). 퇴역 AIRCRAFT는 빠진다.
- **추세**: 최근 28일. 날마다 ARRIVED 수, 착륙 대기 중앙값, 되돌림. 게이트 줄은 날마다 DISPATCH·SCHEDULE 그림자 판정 수와 그날까지의 누적 합의율(마지막 날이 DISPATCH·SCHEDULE 탭의 게이트 숫자와 같다), 둘을 합친 CROSSCHECK 일치율.
- Linear·GitHub·LOGBOOK 중 못 읽은 것이 있으면 그 표시가 뜬다. 그 출처에서 온 숫자는 비거나 0일 수 있다.

TARGETS·ROUTE를 바꾸는 것은 지금처럼 FLEET 탭에서 SUPERVISOR가 한다. OCC가 변경 초안을 내는 흐름은 설계만 있다(`docs/fleet.ko.md` 7.4).

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
- **새 버전 알림**: 이 탭을 연 뒤에 atc가 새로 배포되면 콘솔 바로 아래에 "새 버전이 배포됨"과 새로고침·닫기 버튼이 뜬다. 저절로 새로고침하지 않는다(입력 중인 내용을 지키려고). 닫으면 다음 배포 때까지 안 뜬다.
- **ALERT 줄**: 경보가 흘러간다. 누르면 목록이 열린다.
- **ATC 로고**: 설정(테마, 움직임, 시계).

## 경보 종류

| 경보 | 뜻 |
|---|---|
| LOSS OF SEPARATION | 두 세션이 같은 STAND를 겹쳐 건드림 |
| NORDO STAND | 죽은 세션이 쥔 STAND |
| NO CONTACT | ENROUTE인데 STAND가 없는 FLIGHT(상위 이슈는 제외) |
| UNIDENTIFIED | 점유한 AIRCRAFT 없이 바뀐 STAND |
