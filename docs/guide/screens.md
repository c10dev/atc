# 화면 안내

**탭 줄**에는 일하는 화면만 있다(2026-10-02, ATC-381): HOME · RELEASE · FLIGHTS · FLEET · METRICS(NETWORK는 METRICS의 하위 화면이다, ATC-380). 기본 화면은 HOME이다. 나머지는 이렇게 연다.

- **GLOBE**: 헤더의 **GLOBE** 버튼(또는 `#globe`, `#globe/<AIRPORT>`)이 현재 화면 위에 꽉 찬 보기 모드로 연다. Esc나 닫기 버튼으로 닫으면 열기 전 화면으로 돌아오고, 포커스도 GLOBE 버튼으로 돌아간다. Tab은 창 안에서만 돌며, 공항 화면의 선은 Tab으로 가서 Enter·Space로 고른다. 서랍(FLIGHT·PR·DUTY·IDEAS)도 같다: Tab이 안에서만 돌고, 닫으면 연 곳으로 돌아가며, DUTY 입력칸의 Esc는 칸만 벗어난다.
- **AIRPORTS**: 설정 창(왼쪽 위 로고)의 **AIRPORTS** 분류. `#airports`도 그 분류를 연다. 등록부, 개설·코드 변경·폐쇄, 팀 머지 스위치가 그대로 있다.
- **DOCS**: 헤더의 **HELP** 메뉴(사용 안내, 화면 안내, 문제 해결, 변경 기록). `#docs`와 `#docs/<쪽>` 주소는 그대로 열린다.

| 탭 | 주소 | 보는 것 | 할 수 있는 것 |
|---|---|---|---|
| FLIGHTS | `#flights`, `#flights/board`, `#flights/radar`, `#flights/radio` (옛 `#follow`·`#strips`·`#board`·`#radar`·`#radio`도 그 보기로 열린다) | 같은 FLIGHT를 보는 한 화면(ATC-379)의 네 보기. 위 줄에서 LIST·BOARD·RADAR·RADIO를 고른다. 목록의 FLIGHT 줄에는 그 FLIGHT의 PR이 있으면 착륙 상태 배지(`CLEARED TO LAND`·`APPROACH`)가 붙는다. 맨 위 HUMAN CHECK는 HOME의 QUEUE로 옮겼다. **LIST(기본, 옛 FOLLOW)**: 따라가기로 한 상위 이슈(번들)마다 하위 이슈·related 이슈를 한 줄씩. 줄마다 Todo → 제안 → 승인 → 발송 → READBACK → PR → CLEARED → 착륙 → 배포 단계 점과 "지금 글"(막는 이슈, DISPATCH가 배정하지 않은 이유, 승인 후 발송 없음, 작업 경과, 막힘 코드·GO AROUND, RTS 대기). 한도를 넘은 줄은 주황 점·`막힘`으로 번들 맨 위에 오르고(Todo 제안 없음 30분, 승인 뒤 발송 없음 10분, 착륙 뒤 배포 없음 15분과 FLIGHT FOLLOWING의 기존 한도), 줄마다 다음 할 일 칩이 최대 하나 붙는다(`Todo로`·`우선순위 정하기`·`승인하러`·`HUMAN CHECK`/`머지`·`살펴보기`). 머리의 `NEXT n`이 칩의 수다. 새 사실은 없다 — 제안·FLIGHT FOLLOWING·OOOI·DISPATCH 계획을 합칠 뿐이다. 자세히는 [일 따라가기](follow.md) **AIRCRAFT STRIPS(목록 아래 접힌 칸, 옛 STRIPS)**: 세션마다 FLIGHT STRIP(쥔 STAND가 모두 ARRIVED·취소된 FLIGHT의 것인 AIRCRAFT는 맨 아래 접힌 `GATE CLEANUP`에 모임. 미완 FLIGHT의 STAND를 쥔 NORDO는 NORDO에 그대로): 상태, 쥔 STAND, FLIGHT(없으면 AD HOC), STAND의 PR 착륙 배지, 마지막 교신 **BOARD(옛 FIDS)**: Linear 상태 열별 FLIGHT 카드와 점유 팀 배지. 모든 그룹(목록은 비행 단계, 보드는 상태 열)은 머리에 FLIGHT 수가 있고 앞 5건만 보인다. `<그룹> N more · 전체 보기` 줄이 그 자리에서 나머지를 펼친다(누르거나 Enter, 누를 때마다 접기와 펼치기, 저장하지 않음). 팀(AIRCRAFT)이 맡았거나 경고가 걸린 FLIGHT는 접혀도 보인다. 표시 옵션의 "SCHEDULED · ARRIVED · CANCELLED 포함"은 그 열을 화면에 올리고, 그 열도 같이 접힌다. 목록 보기에서는 REMARKS 옆에 그 FLIGHT의 가장 늦은 이정표(`ON 04:02`)가 보이고, 행에 마우스를 올리면 OUT·OFF·ON·IN 넷이 나온다(OOOI, concepts의 FLIGHT FOLLOWING). 폰 폭(860px 아래)에서는 행이 한 줄 카드(FLIGHT, 제목, AIRCRAFT, 나이 `3h`)가 되고 이정표와 NO CONTACT는 작은 둘째 줄에 붙으며, 보드는 열이 세로로 쌓인다 **RADAR(옛 RADAR)**: 세션 ─ STAND ─ FLIGHT 3열을 선으로 연결. 주인 없는 STAND, STAND 없는 진행 FLIGHT 강조. ARRIVED·취소된 FLIGHT의 STAND와 그것만 쥔 AIRCRAFT는 기본으로 접고 툴바에 `ARRIVED STAND N 숨김`을 보임 **RADIO(옛 RADIO)**: 기록된 교신(TOWER CLEARANCE와 READBACK, OCC FLIGHT PLAN·RECALL·CREW CHANGE, ARRIVED 보고, MCC·RTS)을 주파수(DELIVERY·TOWER·GROUND·COMPANY)별로 시간순으로. 답은 호출 밑에 들여쓰고, 답 없는 호출은 나이와 `NO REPLY`(10분 넘김)를 글자로 보여 준다. 실시간 갱신과 지난 6시간 되감기(1×·4×·16×). 자세한 것은 [RADIO 탭](radio-tab.md) | LIST: 상위 이슈 key로 따라가기 시작·끝(FLIGHT 서랍의 FOLLOW 버튼도 같음), 줄의 key로 FLIGHT 서랍 열기, 줄의 기록 펼치기, `Todo로` 칩(Linear 상태를 Backlog → Todo로, 한 줄씩) AIRCRAFT STRIPS: PR 링크 열기, 막는 조건 펼치기 BOARD: 표시 옵션(목록·보드, 포함 범위), 그룹 펼치기 RADAR: 전체 보기 전환, `ARRIVED STAND 포함` RADIO: 주파수·AIRPORT·AIRCRAFT 거르기(브라우저에 기억), 본문 펼치기, 되감기. 보내기·ACK 없음 |
| GLOBE (보기 모드) | 헤더 버튼, `#globe` | 읽기 전용 정사영 지구본(ATC-254). SUPERVISOR의 위치를 가운데 두고 AIRPORT를 안정된 자리에, AIRPORT마다 FLIGHT가 없는 AIRCRAFT(base 기준)를 작은 비행기 표시로 놓는다(여럿이면 ×수). 진행 중인 FLIGHT는 자기 AIRPORT에서 뜨고 내리는 바퀴를 도는 비행기로 그린다(ATC-260). 밤 영역은 지금 시각(UTC)의 해 위치로 그린다. 옆 목록은 같은 내용을 글로 적은 것이다. SPACE 보기(ATC-261)로 바꿔 우주처럼 볼 수 있다. 무선 교신은 AIRPORT와 비행기 사이의 선으로 그리고 AIRPORT를 누르면 가까이서 본다(ATC-268). 다른 AIRPORT에서 일하는 AIRCRAFT(OUTSTATION)와 base를 옮기는 REPOSITION은 AIRPORT 사이의 큰 원 호로 그린다(ATC-263): 점선 호의 끝에 그 AIRCRAFT가 있고, 옆 목록 `MOVES`에 `TEAM_H · ferry ATCC → VCDO`처럼 적힌다. 우주 보기의 전이 궤도는 아직 없다 | GLOBE | SPACE 바꾸기, HOME AIRPORT 고르기, 위도·경도 입력, 내 위치 사용(1°로 반올림해 저장), 위치 지우기, 끌어서 돌리기, 휠·두 손가락 확대, 홈으로, AIRPORT를 끌어 옮기기(이 브라우저에만 기억), AIRPORT 위치 되돌리기, 비행기를 눌러 FLIGHT 서랍 열기 |
| AIRPORTS (설정 창) | 설정 → AIRPORTS, `#airports` | 저장소 등록부, 소속 AIRCRAFT, OUTSTATION으로 와 있는 AIRCRAFT | AIRPORT 개설·코드 변경·폐쇄, 팀 머지 켜고 끄기(끄면 그 AIRPORT는 팀에게 LAND를 내지 않고 SUPERVISOR가 머지) |
| FLEET | `#fleet` | 팀별 상태, 지금 FLIGHT, 판정 계열의 REPORT 칩(`JEV REPORT`, 켜져 있을 때 · 카드에서 맞음·틀림 표시), RULES(규칙 파일을 확인했나: `RULES current` 또는 `RULES 미확인 since <시각>`과 파일, rules-drift hook이 있을 때), 팀원, 자격, ROUTE, TARGETS와 LOGBOOK 실적(이번 주, 정시, 되돌림, LOS, 최근 FLIGHT), CHECKRIDE(TYPE RATING 근거와 추천), FLEET PLAN(atc의 제안과 AIRPORT별 수요, 그림자·승인 운용), CONTROL SESSIONS(관제 세션 배지·NEEDS YOU·ACCOUNT, `#fleet/control`. LAUNCH ALL·RESTART ALL·STOP ALL·ALIGN은 미리 보기에서 순서·이유·ACCOUNT drift를 보고 한 번 확인한다. 모두 내려가면 복구 배너) | 프로필 편집, ENTRY INTO SERVICE, LAUNCH·STOP(팀과 관제 세션 띄우기·멈추기), CREW BRIEFING, AOG, 퇴역, rating 부여·회수, FLEET PLAN 동의·반대, 승인 운용 켜기·끄기, 승인(실행) |
| METRICS | `#metrics`, `#metrics/leaks`, `#metrics/misfire`, `#metrics/fuel`, `#metrics/network` (옛 `#network`도 여기) | 위쪽 줄에 하위 화면 다섯: OPERATIONS, LEAKS, MISFIRE, FUEL, NETWORK(2026-10-02, NETWORK 탭을 들였다). OPERATIONS: FLIGHT RECORDER로 본 운용 지표와 추이와 한 레인 착륙. LEAKS: 릴리스 뒤에도 사람이 거친 단계를 지난 7일 동안 종류별로 센다(건수, 붙잡은 분, 붙잡힌 FLIGHT, `gate 행 · 통제`). "통제 없음"(그 통제가 서면 사라질 단계)과 "통제 있음"(통제가 도는데도 사람이 거친 단계)으로 나뉘고, K1~K3 승인과 SUPERVISOR가 당긴 brake는 세지 않는다. 세기만 하고 게이트는 바꾸지 않는다. MISFIRE: 사람 없이 도는 레인(DISPATCH, SCHEDULE, FLEET PLAN)이 지난 7일에 한 일 가운데 나중에 틀렸다고 드러난 몫. 위에 레인마다 한 줄(스위치, 한 일, MISFIRE, 몫. FLEET PLAN은 적용 실패 수도), 그 밑에 DISPATCH의 날짜별 줄(자동 승인이 없으면 안 보인다)과 SCHEDULE·FLEET PLAN의 최근 misfire(되돌려짐, 멈춘 뒤 LAUNCH, LAUNCH 뒤 놀음, 재시작 반복). 읽기만 하고 아무것도 바꾸지 않는다. FUEL: 기간(1·7·14·30일, 기본 7일)의 FUEL을 한 화면에 — 맨 위 TODAY(오늘 0시부터 지금까지를 어제 같은 시각까지와 견줌: COST·요청·가동 시간·ARRIVED. 하루의 경계는 보는 브라우저의 시간대), 합계(FUEL COST·요청 밑에 지난 같은 기간 값과 변화, 가격 없는 모델 몫과 "API 정가, 청구액 아님" 안내), USAGE(가동 시간·AIRCRAFT, ARRIVED·PR·FLIGHT당 비용을 지난 같은 기간과 견줌. 지난 기간 기록이 다 차지 않았으면 변화 대신 그 까닭을 적는다. 그 아래 최근 8주 막대와 표로 보기), ACCOUNT별 FUEL REMAINING, AIRCRAFT·관제 세션별 표(정렬 가능, 팀 AIRCRAFT는 FLEET 카드로 연결), 모델별, LEAK 종류별과 CREW 경고, 날짜별 CAPTAIN·CREW 비용 막대(표로 보기), NET이 큰 ARRIVED FLIGHT 10개와 TRIP 판정 | 기간 고르기, 새로고침(FUEL은 열 때·기간을 바꿀 때·새로고침을 누를 때만 읽는다) |
| RELEASE | `#release` | 화살을 쏘는 화면(ATC-376). 후보(READY Backlog 이슈, SCHEDULE NEW 초안 같은 에이전트 제안), 발권 없는 Todo 이슈, 최근 발권(채널별 7일 수). 줄마다 우선순위와 선언한 K 효과가 클릭 전에 보인다 | READY 이슈 **발권**(Todo로 옮기고 발권을 기록), Todo 이슈 **발권**·**모두 발권…**. 우선순위 없는 이슈는 FLIGHT 서랍으로, 제안은 HOME의 QUEUE로 간다. 이 화면의 클릭만 화면 발권이 된다 |
| HOME | `#home` (옛 `#dispatch`와 `#schedule`도 여기) | 사용자에게 남은 일 한 화면(2026-10-02, DISPATCH를 해체). **QUEUE**(SUPERVISOR QUEUE: 승인·거절·머지 같은 결정. 자동 운항을 끄면 ASSIGN·launch 카드도 여기 오고 줄마다 승인·거절), **ALERTS**(WARNING·CAUTION), **STUCK**(막힌 FLIGHT 줄과 그 줄의 CANCEL…·RECALL…), **EFFECT**(배포한 FLIGHT가 작업 지시서 `## Measure`의 것을 바꾸지 못한 평결: `not improved`·`worse`, 틀렸다고 표시하지 않은 것만. FLIGHT 서랍의 `EFFECT CHECK` 줄에서 **틀림**으로 표시, ATC-402), **LATE WAYPOINTS**(ETA가 목표일을 넘거나 목표일이 지난 WAYPOINT, 예외라 있을 때만. 2026-10-02 SCHEDULE을 해체), **LINEAR에서 직접 DONE**(승인한 CLOSE, 있을 때만), 그리고 늘 있는 중립 **BRAKES** 줄(GROUND STOP·수동 출발 중지 수, 자동화 스위치 상태, **ATFM…**, **STOP ALL…**, DISPATCH 2a↔2b, SCHEDULE S1↔S2, 스위치 설정). QUEUE에는 SCHEDULE 초안도 오고(S2일 때) 줄마다 승인·거절. 정상이면 BRAKES 줄만 보이고, 실제 GROUND STOP이 걸리면 ATFM 블록이 맨 위로 펴진다. 배정 기록은 FLIGHT 서랍의 `배정 기록`, MISFIRE는 METRICS | 큐 줄의 버튼, 알림 누르기, CANCEL·RECALL, ATFM 스위치와 수동 출발 중지, STOP ALL, DISPATCH·SCHEDULE 모드 전환 |
| DOCS (HELP 메뉴) | HELP 메뉴, `#docs`, `#docs/<쪽>` | 이 안내와 변경 기록(`CHANGELOG.ko.md`에 아직 접지 않은 `changelog.d/` 조각까지 `[Unreleased]` 아래에) | — |

## METRICS → NETWORK

(`#metrics/network`, 옛 `#network`) ROUTE·AIRCRAFT·추세를 한 화면에서 보는 읽기 전용 개요다. 아무것도 바꾸지 않고, 배정 점수에도 쓰지 않는다. 숫자를 읽는 법:

- **ROUTE MAP**: 맨 위. ROUTE(Linear 프로젝트)마다 WAYPOINT(프로젝트 마일스톤)를 가로 경로로 잇는다. ●는 지난 WAYPOINT(Linear에서 done), ◉는 지금 구간(끝나지 않은 것 중 순서상 첫 번째)과 진행률, ○는 앞으로 갈 WAYPOINT다. 지금 구간 위의 ✈는 그 WAYPOINT의 FLIGHT를 모는 AIRCRAFT다(FOLLOWING과 같은 규칙: ASSIGN 제안, 없으면 `tail:` 라벨). 주황은 지연이다. WAYPOINT를 누르면 완료 기준이 보이고, atc가 잴 수 있는 기준(판정 게이트, 2b 점검표, 모드, ATFM 켜기 조건) 아래에는 지금 상태가 ✓ 충족 · ✗ 미달 · ○ 데이터 부족 · △ 확인 필요로 붙는다.
  - WAYPOINT를 누르면(Tab으로 옮겨 Enter·Space도 된다) 진행률, 목표일, ETA, 완료 기준(마일스톤 설명의 "Exit criteria" 번호 목록), FLIGHT 목록(진행·막힘·계획·완료와 AIRCRAFT)이 열린다. 한 번 더 누르거나 ✕로 닫는다.
  - **ETA**: 그 ROUTE에서 최근 28일에 끝난 FLIGHT 수(LOGBOOK ARRIVED와 Linear 완료 시각)로 하루 속도를 내고, 이 WAYPOINT까지 남은 FLIGHT(앞 구간 것 포함)를 나눈다. 28일 완료가 3개 미만이거나, 남은 FLIGHT가 없거나, FLIGHT가 50개를 넘으면 "모름"이다. 목표일이 ETA보다 앞이거나 이미 지났으면 "지연"이다.
  - 마일스톤이 없는 ROUTE는 아래쪽에 "WAYPOINT 없음" 점선으로, 열린 FLIGHT 수(진행·계획·막힘)와 AIRCRAFT만 보인다. WAYPOINT를 만들려면 Linear 프로젝트에 마일스톤을 추가한다(atc는 읽기만 한다).
  - 좁은 화면에서는 경로가 자기 상자 안에서 가로로 넘어간다.
- **ROUTE 표**: Linear 프로젝트마다 한 줄. 열린 FLIGHT는 Todo(FILED)·In Progress(ENROUTE)·In Review(APPROACH, Ready to Merge 포함)로 나눠 센다. Backlog·끝난 것·상위 이슈는 세지 않는다. ARRIVED 14일은 그 프로젝트 FLIGHT의 LOGBOOK 기록이고, 착륙 대기는 그 기록의 중앙값이다. 목표(목표일·진척·상태)는 Linear 프로젝트에서 10분마다 읽고, 못 읽으면 비어 있다.
- **AIRCRAFT 표**: FLEET 카드와 같은 숫자다(이번 주 ARRIVED 대 `flightsPerWeek`, 14일 정시율 대 `onTime`, 착륙 대기, 되돌림, LOS). 퇴역 AIRCRAFT는 빠진다.
- **추세**: 최근 28일. 날마다 ARRIVED 수, 착륙 대기 중앙값, 되돌림. 게이트 줄은 날마다 DISPATCH·SCHEDULE 그림자 판정 수와 그날까지의 누적 합의율(마지막 날이 S2 진입 점검 숫자와 같다), 둘을 합친 CROSSCHECK 일치율.
- Linear·GitHub·LOGBOOK 중 못 읽은 것이 있으면 그 표시가 뜬다. 그 출처에서 온 숫자는 비거나 0일 수 있다.

TARGETS·ROUTE를 바꾸는 것은 지금처럼 FLEET 탭에서 SUPERVISOR가 한다. OCC가 변경 초안을 내는 흐름은 설계만 있다(`docs/fleet.ko.md` 7.4).

## GLOBE

SUPERVISOR의 위치를 가운데 둔 읽기 전용 지구본이다(설계: `docs/globe.md`). 서버는 장면(`GET /api/globe`: AIRPORT의 자리, 세워 둔 AIRCRAFT, 나는 FLIGHT, AIRPORT 사이의 옮김)만 주고, 화면이 지구본에 그린다.

- **위치는 이 브라우저에만 있다.** 위치, HOME, 옮긴 AIRPORT, 시점은 `localStorage`의 `atc.globe` 한 곳에만 저장한다. 서버로 보내지 않고 기록하지도 않는다. 위치를 정하지 않으면 브라우저 시간대(예: `Asia/Seoul`)의 대표 도시에 놓는다(IANA `zone1970.tab`을 화면에 넣어 둔 표라 외부 요청이 없다. 서울이면 약 37.6°N 127.0°E). 표에 없는 시간대(`Etc/*` 등)는 UTC 오프셋으로 경도만 맞추고 위도는 0이다. 위도·경도를 직접 적거나 "내 위치 사용"을 누르면 그 값이 이긴다. "내 위치 사용"은 브라우저가 알려 준 위치를 1°로 반올림해 저장한다. 도시 검색은 없다(외부 요청이 필요하다). 화면을 남에게 보여 줄 때는 위도·경도 칸과 지구본의 가운데 점에 위치가 드러난다.
- **HOME AIRPORT**는 지구본에서 위치(가운데 점) 자리에 놓인다. 기본은 살아 있는 세션이 가장 많은 AIRPORT이고, 목록에서 다른 곳을 고를 수 있다. 다른 AIRPORT는 HOME에서 본 방위와 거리(12°~30°)를 AIRPORT id에서 정하고, 그 방위에 가장 가까운 **실제 큰 공항**(OurAirports, 마우스를 올리면 IATA 코드가 보인다)에 놓아 육지 위에 선다. 후보가 없으면 45°까지 넓히고, 그래도 없으면(바다 한가운데 위치) 정한 방위·거리 그대로다. 그래서 새로고침하거나 날이 바뀌어도 같은 자리이고, 한 공항을 두 AIRPORT가 쓰지 않는다. FLIGHT의 바퀴는 바다를 지나도 된다. AIRPORT를 끌어 옮기면 그 자리를 이 브라우저가 기억하고, "AIRPORT 위치 되돌리기"로 지운다.
- **세워 둔 AIRCRAFT**: 지금 STAND를 쥔 FLIGHT가 없는 AIRCRAFT를 base AIRPORT 옆에 작은 비행기로 놓는다(여럿이면 ×수). base가 없거나 퇴역한 AIRCRAFT는 그리지 않는다. AIRPORT 위에 마우스를 올리면 콜사인이 뜬다. 오른쪽 목록에도 같은 내용이 있다(스크린 리더, 좁은 화면).
- **FLIGHT**(ATC-260): 진행 중인 FLIGHT마다 비행기 하나가 자기 AIRPORT에서 떠서 같은 AIRPORT로 내리는 바퀴(출발 → 회전점 → IAF → 최종 → 활주로 → 게이트)를 돈다. 나가는 방향은 FLIGHT 번호에서 정하고 같은 AIRPORT의 다른 FLIGHT와 겹치지 않게 벌린다. 바퀴의 크기는 가장 가까운 다른 AIRPORT까지 거리에 맞춘다. 비행기 옆에 FLIGHT 번호가 붙는다. 위치는 STRIPS의 진행 막대와 같은 모델이다. **사실만** 그린다: 지난 이정표(OUT·OFF·ON·IN)가 구간을 정하고, 추정은 지금 구간 안에서 그 구간이 보통 걸린 시간(p75)에 견준 위치뿐이다. 보통 시간을 모르면 구간의 처음에 서 있다. 퍼센트도 도착 시각도 없다.
  - **ENROUTE**(초록): OUT 뒤 PR 전. 구간 안 위치로 IAF 쪽으로 간다. 보통보다 길어지면(`길어짐`, `LATE`) 호박색으로 바뀌고 IAF 앞에서 멈춘다(홀딩이 아니다).
  - **HOLDING**(호박): AIRCRAFT가 STAND를 쥔 채 쉬고 있거나(idle), 그 FLIGHT에 열린 HOLD CLEARANCE가 있으면 지금 자리에서 레이스트랙을 돈다. 착륙 대기 중 PR이 막혀 있으면(APPROACH) IAF에서 돌고, 막는 조건 코드(`checks-pending` 등)가 툴팁과 목록에 붙는다.
  - **FINAL**(초록): PR이 CLEARED. IAF에서 활주로로, 위치는 착륙 대기 구간 안의 막대 위치.
  - **GO AROUND**(`GA`, 호박): 최근 30분 안에 GO AROUND CLEARANCE가 나갔거나 PR이 `dirty`·`behind`로 막혔다. 최종에서 올라 한 바퀴 돌아 IAF로 돌아오는 고리로 그린다. 새 head가 CLEARED가 되면 FINAL로 돌아온다.
  - **TAXI**: 머지(ON) 뒤 RTS가 서비스에 넣기를 기다린다(MCC AIRPORT만). **ARRIVED**: IN(RTS가 없는 FLIGHT는 ON)부터 게이트에서 30분 동안 서서히 사라진다. 되돌려진 PR은 `되돌려짐`으로 목록에 적힌다.
  - **NORDO**: 세션이 죽었다. 멈춘 자리에 회색 비행기로 서고 `NORDO`가 붙는다. **BOARDING**: STAND는 있고 아직 OUT이 없다.
  - **SUP**(ATC-300): 착륙 대기 중(HOLDING·FINAL·GO AROUND)인 FLIGHT의 PR을 **SUPERVISOR가 머지해야** 하면 비행기 둘레에 청록색 고리가 생기고 이름 옆에 `SUP`이 붙는다. 비행기 색(호박 등)은 그대로다. 마우스를 올리면 이유가 나온다: `user 등급`, `MCC ESCALATE`, `SUPERVISOR HOLD`, `MCC가 착륙시키지 않는 모드`, `등급을 아직 모름`, `팀이 머지하지 않는 AIRPORT`. 오른쪽 FLIGHTS 목록의 `LAND BY`는 누가 착륙시키는지 적는다: `MCC`(auto·flagged는 MCC가 착륙시킴), `SUPERVISOR`, `TEAM`(MCC AIRPORT가 아닌 곳에서 STAND를 쥔 팀이 머지). `SUP`이면 STRIPS의 LANDING SEQUENCE나 PR 서랍(`#pr/<AIRPORT>/<번호>`)에서 그 PR을 직접 머지한다. 지구본, SPACE, AIRPORT 뷰가 같은 표시를 쓴다.
  - 비행기를 누르면 FLIGHT 서랍(`#flight/<KEY>`)이 열린다. 오른쪽 FLIGHTS 목록에 콜사인, FLIGHT, AIRPORT, 상태, 막는 조건이 같은 내용으로 있다. 홀딩과 고어라운드는 `motion`이 켜져 있을 때만 돈다(꺼져 있으면 멈춘 그림). AIRPORT를 모르는 FLIGHT는 그리지 않는다. 그려진 FLIGHT의 AIRCRAFT는 "세워 둔" 표시에서 빠진다.
- **AIRPORT 사이의 옮김**(ATC-263): 두 가지뿐이다. **OUTSTATION**은 AIRCRAFT가 base 아닌 AIRPORT의 STAND에서 일하는 것으로, base에서 그 AIRPORT까지 점선 호를 긋고 비행기는 도착한 곳에 선다. **REPOSITION**은 승인한 base 옮김이다: 옛 base에서 새 base까지 점(.) 모양의 흐린 호이고, 실행 중에는 비행기가 출발지에 있다가(새 LAUNCH 전) 끝나면 도착지에 선다. 중간 위치는 짐작하지 않는다. 끝난 REPOSITION은 2시간 동안 옅어지며 남고, 실패한 것(LAUNCH까지 못 감)은 호박색이다. 평소 상태라서 호는 신호색이 아니고, 옮김이 없으면 `MOVES` 목록도 없다. SPACE 보기에는 호가 없고 목록만 있다.
- **무선 교신**(ATC-268): 관제 세션과 주고받은 교신이 지구본 위에 그려진다. RADIO가 이미 합친 교신(`GET /api/radio`)을 그릴 뿐 새 기록은 없다. 최근 2분의 교신은 AIRPORT와 그 교신의 비행기 사이의 점선과 움직이는 점이다. **열린 호출**(답이 아직 없음)은 답이 올 때까지 청록색으로 깜박이고, 늦으면(`overdueAt`을 넘기면) 호박색 실선이 된다. 답한 교신은 초록 점선이다. 움직임(깜박임, 점)은 `motion`이 켜져 있을 때만이고 꺼져 있으면 멈춘 선이다. 비행기를 모르는 교신(MCC의 GROUND 방송)은 지구본에는 그리지 않고 AIRPORT 뷰에 나온다.
- **AIRPORT 뷰**(`#globe/<CODE>`): 지구본에서 AIRPORT를 끌지 않고 누르거나 오른쪽 목록의 코드를 누르면 그 AIRPORT를 가까이서 본다. STANDs는 게이트, 활주로는 하나, 시설은 OCC(DELIVERY·COMPANY), TOWER, MCC(GROUND·RTS)이고, PREFLIGHT 교신이 있으면 CROSSCHECK가 더해진다. 모르는 주파수의 교신은 점선 `RADIO` 상자로 나온다. 비행기는 장면의 상태 그대로 놓인다: BOARDING·ARRIVED·NORDO는 게이트, ENROUTE는 활주로 끝에서 오른쪽 위 가장자리로, HOLDING은 왼쪽 위의 레이스트랙, FINAL은 왼쪽에서 활주로 앞까지(도착은 짐작하지 않는다), GO AROUND는 활주로 위의 올라가는 고리, TAXI는 활주로에서 게이트로. 최근 10분의 교신(열린 호출은 답이 올 때까지)은 시설에서 비행기까지의 선과 **head 한 줄**로 그려지고, 선이나 아래 목록의 줄을 누르면 기록된 **문구(body)**가 그제서야 보인다. 목록 위의 `RADIO에서 <CODE> 보기`는 RADIO 탭을 그 AIRPORT로 거른 채 연다. `← GLOBE`로 돌아온다.
- **SPACE 보기**(ATC-261): 툴바의 `GLOBE | SPACE`로 같은 장면을 우주로 본다. 지구가 HOME AIRPORT이고 가운데에 있다. 다른 AIRPORT는 행성이고, 궤도 순서는 HOME에서의 거리 순위, 방향은 지구본과 같은 방위라 날마다 같은 자리에 있다. FLIGHT는 자기 AIRPORT(몸) 둘레에서 발사 → 궤도 → 착륙을 한다: ENROUTE는 발사해 궤도를 도는 중, HOLDING은 바깥쪽 대기 궤도, FINAL은 궤도에서 내려오는 길, 착륙은 발사대, TAXI·ARRIVED·BOARDING은 발사대에 서 있다(NORDO는 멈춘 자리의 회색 비행기, GO AROUND는 올라갔다 돌아오는 고리). 상태·색·툴팁·링크·목록은 지구본과 똑같다. 배경은 움직이지 않는 별이고 밤 영역은 없다. 홀딩·고어라운드는 `motion`이 켜져 있을 때만 돈다. 선택은 `localStorage`의 `atc.globe`에 저장되고, 저장한 것이 없으면 Night Sky(`night`) 테마만 SPACE로 연다. SPACE에서는 위치·홈으로·AIRPORT 위치 되돌리기가 필요 없어 보이지 않는다.
- **밤 영역**은 UTC 시각(위 설명 줄에 적힌 분)의 해 위치로 그린다. 10초마다 다시 셈하고, 숨은 탭에서는 멈춘다.
- 조작: 끌기(돌리기), 휠·두 손가락(확대, 1~8배), "홈으로"(위치를 가운데로, 확대 1배). 애니메이션을 끈 설정(`motion` 꺼짐)이면 "홈으로"는 바로 옮긴다.
- 지구본의 육지는 Natural Earth 1:110m(공개 도메인)를 줄여 화면 파일 안에 넣은 것이다. 외부 요청은 없다. 이 화면 첫 방문 때만 GLOBE 화면 파일(약 19 KB)을 더 받는다.

## 설정 창의 MIGRATE(마이그레이션 리허설)

설정 창 AUTOMATION의 **MIGRATE** 블록은 호스티드 DB가 있는 AIRPORT마다 스위치 하나다(SUPERVISOR 전용, 세션은 못 바꿈, 기본 꺼짐). 시험 DB(`hostedDb.testProjectRef`)와 `.env.local`의 `SUPABASE_MIGRATE_TOKEN`이 있어야 켤 수 있고, 없으면 이유가 적힌다.

- 켜면 AUTOLAND가 CLEARED PR의 새 마이그레이션을 시험 DB에 먼저 적용해 보고, 통과하면 호스팅 제공자에 이미 있는 PITR·최근 백업을 확인한 뒤(atc가 백업을 만들지는 않는다) 실전 DB에 적용한다. 그다음 PR이 머지된다.
- 리허설은 AUTOLAND가 그 PR을 위임했을 때(보안 위임 `delegate`와 머지 리뷰 통과)만 돌고, 마이그레이션 말고 다른 제외(HUMAN CHECK, 다른 SQL 경로, HOLD)가 남은 PR은 실전을 건드리지 않는다. 멈춘 PR은 머지되지 않는다.
- 실전 적용 전에 멈추면 실전은 그대로이고 PR은 머지되지 않는다. 실전 적용이 중간에 실패하거나 적용 뒤 검사가 실패하면 실전이 바뀐 채로 남고(`live-changed`, 자동 복원 없음) 복원은 사람이 정한다.
- 시험 DB는 실패해도 되돌리지 않는다. 멈춘 뒤에는 시험 DB를 실전에서 다시 가져와야 다음 리허설이 돈다(atc 밖에서).
- 각 단계와 멈춘 이유는 `GET /api/migrate`와 AUTOLAND 기록에 남는다. 멈추면 그 FLIGHT의 발권이 거둬져 RELEASE 패널에 이유와 함께 제안으로 돌아오고, SUPERVISOR가 다시 발권해야 한다.

## AIRCRAFT STRIPS의 진행 막대

FLIGHT가 있는 STAND 줄 아래에 얇은 막대가 붙는다. 네 칸(작업 → 착륙 대기 → RTS 대기 → 서비스)으로, 지난 칸은 실선이고 지금 칸은 점선에 표식이 있으며 앞 칸은 옅은 점선이다. OUT·OFF·ON·IN 이정표는 atc가 기록한 실제 시각이다.

- 옆의 글은 지금 칸의 경과 시간과 비슷한 지난 FLIGHT들이 보통 걸린 범위다: `작업 42분 · 보통 30–60분 (BUILD·M, n=12)`. 괄호는 어느 표본인지(TYPE·WAKE, 모자라면 WAKE나 AIRPORT)와 표본 수다. 표본이 3개보다 적으면 `데이터 부족`이고 지난 시간만 보인다.
- 퍼센트나 도착 시각은 없다. 팀이 스스로 알리는 진행도 읽지 않는다. 표식은 지금 칸에서 경과/보통 범위의 위 끝(p75)만큼 간 자리이고, 칸 끝에서 멈춘다.
- 보통 범위를 넘으면 표식과 글이 amber이고 `길어짐`이 붙는다. 막힌 것이 아니라 평소보다 길다는 뜻이다. HOLD·NORDO·NEEDS YOU 표시는 그대로다.
- 마우스를 올리면 이정표 시각이 나온다. `착륙 대기` 칸에서는 CLEARED·APPROACH 배지와 AUTOLAND 표시가 막대 옆에 붙는다.
- 지금 칸은 표식까지 지난 부분이 진하게 채워지고 나머지는 점선이다. 앞 칸은 옅다.
- 끝난 FLIGHT는 막대 없이 작은 `완료` 글만 보인다(마우스를 올리면 이정표 시각은 그대로). 진행 중인 FLIGHT가 더 잘 보이게 한 것이다.
- AD HOC 줄(티켓 없는 작업)과 아직 OUT이 없는 FLIGHT에는 막대가 없다.

## HOME의 HUMAN CHECK

PR 본문 `## UI change` 블록의 class가 CHOICE·ACCOUNT·DEVICE인데 이 head에 `Human check: done`이 없는 PR만 HOME의 QUEUE에 `HUMAN CHECK` 줄로 모인다(ATC-379, 옛 STRIPS 맨 위 칸). 없으면 이 칸이 보이지 않는다.

- 줄마다 `#번호`, AIRPORT·FLIGHT, STAND를 쥔 팀, class 칩, 상태(`pending`, `FAILED`, `옛 head에 기록됨 (sha)`, `채우지 않음`), 제목.
- 증거: Evidence pack 링크가 가리키는 PR 댓글의 스크린샷 썸네일, 이 head의 RUN-UP 보고서가 있으면 바뀐 화면·컷 수, UNEXPECTED 경고, 바뀐 컷 썸네일과 보고서 링크. 증거가 없으면 "증거 없음".
- ACCOUNT·DEVICE면 **Preview ↗**(현재 head의 Preview)와 사람이 할 1~3 단계.
- **PASS**·**FAIL**: 메모 칸에 본 것을 적고 누른다(FAIL은 메모 필수). atc가 PR 본문의 `Human check:` 줄 하나를 `done <날짜> <sha> <메모>`(또는 `failed`)로 바꾸고 PR 댓글 하나를 단다. 결과는 이 head에 묶인다. 그 뒤 main 병합만 한 head는 결과를 잇고, PR 변경이 바뀐 head는 다시 확인해야 한다. 화면이 본 head가 그새 바뀌었으면 거절된다.
- 누르면 "PASS 기록됨 · sha · 댓글"이 뜨고, GitHub을 다시 읽으면(90초 안) 줄이 대기열에서 빠진다.
- AUTOLAND `merge`는 이 대기열의 PR과 `## UI change` 블록이 없는 PR을 머지하지 않는다. LANDING SEQUENCE 줄에는 `HUMAN CHECK ACCOUNT: pending`처럼 보인다.

## FLIGHTS의 LANDING SEQUENCE

FLIGHTS 목록 아래에 GitHub에 열린 PR을 LANDING 순서대로 보여 준다([개념](concepts.md)의 LANDING SEQUENCE).

- **CLEARED TO LAND**: 조건을 모두 채운 PR. 준비된 순서(`readyAt`)대로 번호가 붙고 펼쳐 둔다. 제목의 숫자가 CLEARED TO LAND PR 수다.
- **APPROACH**: 막는 조건이 남은 PR(Draft 제외). PR을 연 순서로, 접어 둔 줄을 누르면 열린다. 줄마다 막는 조건이 한국어 한 줄씩 붙는다.
- **DRAFT**: 흐리게, 접어 둔다. LANDING SEQUENCE에는 들지 않는다.
- 줄마다 AIRPORT·FLIGHT(없으면 AD HOC), `#번호`(GitHub PR로 열림)와 제목, 그 STAND를 쥔 팀(없으면 STAND 이름이나 "STAND 없음").
- GitHub 조회가 실패하면 위에 "GitHub 조회 실패 · PR 상태가 오래됐을 수 있음"이 뜬다(마우스를 올리면 오류).
- **AUTOLAND**가 켜져 있으면 제목 아래에 AIRPORT마다 한 줄: `UPDATE VCDO AUTOLAND: updating #383`(갱신함, CI 대기), `AUTOLAND: waiting — #383 CLEARED, SUPERVISOR 머지 대기`(먼저 머지하거나 HOLD), `AUTOLAND: GROUND STOP — main Application Check 실패`(빨강, 설정 창에서 푼다), `AUTOLAND: 갱신할 PR 없음`.
- PR 줄마다 AUTOLAND 표시: `AUTOLAND update 대기 2번째`, `AUTOLAND 대기 — 리뷰 없음 먼저`(behind 말고도 막힘이 있음), `AUTOLAND 제외 — DIRTY(충돌)`(Draft, STACKED, 충돌, LOS는 건드리지 않음), `AUTOLAND: review requested (codex)`·`(deepseek)`(갱신한 head에 리뷰가 이어지지 않아 atc가 재리뷰를 요청함), `AUTOLAND: SUPERVISOR 리뷰 필요 — 외부 리뷰 제외(…)`, merge 모드면 `AUTOLAND merge 대상` 또는 `SUPERVISOR 머지 — rating:SEC`(머지하지 않는 까닭).
- **HOLD** 버튼(AUTOLAND가 켜졌을 때, 맡은 AIRPORT의 PR): 누르면 `HOLD ✓`. AUTOLAND가 그 PR을 머지하지 않고, CLEARED여도 다음 PR 갱신을 막지 않는다. 다시 누르면 풀린다.

STAND 줄의 REMARKS 칸에도 그 STAND 브랜치의 PR 배지가 붙는다.

| 배지 | 뜻 |
|---|---|
| `CLEARED TO LAND` (+ `SEQ n`) | 머지할 수 있음. `SEQ n`은 CLEARED TO LAND PR이 둘 이상일 때 몇 번째인지 |
| `APPROACH` + 숫자 | 막는 조건 수. 아래 줄에 짧은 이름(CI 실패, 리뷰 없음, BEHIND …)이 있고, 누르면 전체 문장이 펼쳐진다 |
| `#번호` | PR 서랍을 연다. 옆의 `↗`는 GitHub PR 링크 |

## FLIGHT 서랍과 PR 서랍

FLIGHT 번호(`ATC206`)나 STRIPS의 PR 번호를 누르면 화면 오른쪽에 서랍이 열린다(폰에서는 화면 전체). Linear 이슈와 GitHub PR을 atc 안에서 읽는다. 읽기가 기본이고, 쓰는 것은 둘뿐이다: FLIGHT 서랍의 상태 이동 버튼과 PR 서랍의 **MERGE** 버튼(둘 다 아래).

- **FLIGHT 서랍**(주소 `#flight/ATC-206`): 이 FLIGHT의 RADIO 스레드(호출과 답 묶음, 지난 7일, 없으면 칸 없음 · 전체 기록은 `#flights/radio`, ATC-379), 상태, 우선순위, 담당, 라벨, 막는·막고 있는 FLIGHT(눌러 그 FLIGHT 서랍으로), 상위·하위, 붙은 PR, 본문, 댓글. 마지막 줄 링크로 Linear를 연다.
- **상태 이동**(FLIGHT 서랍): 그 이슈가 Backlog·Todo·Canceled에 있을 때만 이 팀의 Backlog·Todo·Canceled 중 지금 상태를 뺀 버튼이 보인다. 누르면 "Backlog → Todo로 옮긴다. Linear에 바로 쓴다."를 한 번 더 묻고, [확인]을 눌러야 Linear에 쓴다. 지금 상태가 그 사이에 바뀌었으면 옮기지 않고 알린다. Started·Done으로는 옮길 수 없다: 그 상태는 팀의 PR(`Fixes ATC-n`)과 Linear에서 SUPERVISOR가 정한다. 옮길 때마다 FLIGHT RECORDER에 한 줄 남는다. 이 화면에서 누른 클릭만 쓴다(세션·`atcctl`·`curl`은 못 한다).
- **READY**: Backlog인 이슈가 막는 FLIGHT를 하나 이상 갖고 모두 Done이나 Canceled면 상태 옆에 `READY` 칩이 뜨고 Todo 버튼이 강조된다. "막는 FLIGHT가 다 풀렸으니 Todo로 옮길까?"를 알려 줄 뿐이고, 옮기는 것은 늘 SUPERVISOR의 클릭이다. 아직 QUEUE 목록에는 올라가지 않는다.
- **PR 서랍**(주소 `#pr/ATCC/281`): 브랜치, 작성자, 착륙 상태와 막는 조건, 등급(TIER), MCC INSPECTION, 리뷰 결정, 체크, 본문, 바뀐 파일(100개까지). 착륙 상태·등급·INSPECTION은 atc가 폴링하는 열린 PR만 보인다.
- **MERGE**(PR 서랍): MCC AIRPORT(atc 저장소)의 **user 등급**(또는 MCC가 ESCALATE한) PR이 CLEARED TO LAND일 때만 `MERGE…` 버튼이 뜬다. 누르면 "TIER user · head e726794 · merge 방식. GitHub에 바로 머지한다."를 한 번 더 묻고, [머지 확인]을 눌러야 머지한다. 서버는 눌린 뒤 지금 GitHub 자료로 다시 판정한다: 서랍이 보여 준 head가 그대로일 때만(움직였으면 409와 새 head가 뜨고 머지하지 않는다), PR이 열려 있고 Draft·fork가 아니고 SUPERVISOR HOLD가 없고 atc가 그 head를 CLEARED로 볼 때만 머지한다. 머지는 그 head(sha)에 고정하고 auto-merge는 켜지 않는다. **auto·flagged 등급 PR은 여기서 머지하지 않는다**(MCC의 몫이라 버튼도 없다). 후보인데 지금 안 되면 버튼 자리에 까닭이 보인다. 이 화면에서 누른 클릭만 받고(세션·CLI는 못 한다), 시도마다 FLIGHT RECORDER에 한 줄(누가·PR·head·결과, 거절도) 남는다. 머지한 뒤의 배포는 [배포하기](deploy.md).
- 본문과 댓글의 Markdown은 안전하게 그린다: HTML 태그는 글자로 보이고, 이미지는 링크로만 남고, 링크는 새 탭에서 열린다.
- Esc, 바깥 클릭, ×로 닫는다. 브라우저 뒤로 가기도 닫는다. 서랍은 열 때 한 번 읽고 60초 동안 기억한다(백그라운드로 다시 읽지 않는다). `ATC_GITHUB=off`인 서버에서는 PR 서랍이 "GitHub이 꺼져 있다"고 알린다.
- 지금 번호를 눌러 열리는 곳: FLIGHTS(LANDING SEQUENCE의 FLIGHT와 PR 번호), HOME(HUMAN CHECK·STUCK), DISPATCH 표·후보·승인 기록, FOLLOWING, FLEET(카드·목록). 이미 다른 링크(Linear) 안에 있는 번호는 그 링크 그대로다. 주소를 직접 써도 열린다.

## DUTY 서랍

헤더의 `● DUTY`(설정에서 켰을 때만 보인다)나 주소 `#duty`로 여는 글 대화 서랍이다. 어느 탭 위에서도 열리고 닫는 방법은 위 서랍과 같다. 쓰는 법은 [DUTY 채팅](duty.md).

## 상단

- **SINCE LAST LOOK**(처음 도착하는 탭의 맨 위. HOME이 생기면 그쪽 맨 위): "지금 어때?"에 묻지 않고 답하는 한 줄이다. 마지막으로 본 뒤 `발권 2 · 착륙(ON) 1 · 배포(IN) 1`처럼 바뀐 것과, 지금 `막힘`과 `기다림`(SUPERVISOR를 기다리는 항목) 수가 칩으로 보인다. 칩을 누르면 그 뒤의 목록이 열린다(FLIGHT는 서랍, 기다림은 그 항목이 있는 탭). 새 것도 기다리는 것도 없으면 줄 자체가 없다. "마지막으로 본 시각"은 서버에 하나라서 브라우저와 Mac 메뉴 막대가 같은 줄을 본다. **읽음**을 누르거나 줄이 보이는 탭이 가려지면 그 시각까지 옮겨진다(그린 뒤에 생긴 일은 다음에 센다). 막힘과 기다림은 일어난 일이 아니라 지금 상태라서 읽음으로 사라지지 않고, 풀려야 사라진다.
- **숫자판**: AIRBORNE(작업 중 세션), STANDS(점유), ENROUTE(진행 FLIGHT), HANDOFF, ALERTS(WARNING·CAUTION만 센다. ADVISORY는 `+n ADV`로 옆에 보인다. 색: WARNING이 있으면 빨강, CAUTION만 있으면 호박, 없으면 기본).
- **CONTROL 띠**(탭 줄 아래, 관제 세션이 있을 때): 관제 세션마다 칩 하나 `TWR`·`OCC`·`MCC`·`XCHK`·`REV`·`ENG`. `MCC ● 5m · 2분 전`은 그 세션의 `/loop` 주기(5분)와 마지막 tick이 2분 전이라는 뜻이다. 색: 초록 `ok`, 하늘색 `working`(job이 일하는 중), 호박색 `NEEDS`(job이 blocked이거나 NEEDS YOU가 있거나 health가 alert 수준)와 `LATE`(마지막 tick이 2 × 주기 + 1분보다 오래됨), 빨강 `DOWN`(떠 있지 않거나 세션이 죽음). ENG는 떠 있는지만 보인다(주기 없음). 마지막 tick은 SQUELCH의 마지막 판정 시각이고, SQUELCH 기록이 없을 때만 세션의 마지막 활동을 쓴다(툴팁에 출처가 적힌다). 툴팁에는 종류(`BG <id>`·tmux·interactive), job의 detail과 needs, 주기, 마지막 tick과 출처, 마지막 OPEN 뒤 QUIET 수가 있다. 칩을 누르면 FLEET 탭의 CONTROL SESSIONS(`#fleet/control`)가 열린다. 보기만 한다: LAUNCH·STOP은 거기서 한다. 768px보다 좁으면 `CTRL 5/6` 한 칩으로 접힌다(하나라도 ok가 아니면 호박색, DOWN이면 빨강). 1분에 한 번 읽는다(서버가 `claude agents`를 30초 캐시).
- **UPDATE 막대**: 서비스가 `origin/main`보다 뒤이고 main CI가 통과했으면 `업데이트 있음 · c0ca22e → 4678e03 · PR 2 · CI ✓ [업데이트]`가 뜬다. 버튼이 MCC와 같은 `atc-rts`를 시작하고 막대가 진행·거절·ROLLBACK을 보인다. 사람이 배포해야 하면 버튼 대신 사유가 뜬다([배포하기](deploy.md)).
- **새 버전 알림**: 이 탭을 연 뒤에 atc가 새로 배포되면 콘솔 바로 아래에 "새 버전이 배포됨"과 새로고침·닫기 버튼이 뜬다. 저절로 새로고침하지 않는다(입력 중인 내용을 지키려고). 닫으면 다음 배포 때까지 안 뜬다.
- **ALERT 줄**: WARNING·CAUTION이 흘러간다(WARNING이 있으면 빨강). ADVISORY만 있으면 줄이 없다. 누르면 목록이 열린다(등급별로 묶인다). [경보 종류](#경보-종류)
- **BELL**(ALERTS 옆): 알림(브라우저 알림·소리)이 알린 항목의 작은 목록. 숫자는 조치가 필요한 것 가운데 아직 확인(ACK)하지 않은 수다. 누르면 목록이 열리고, 항목을 누르면 그 탭으로 가고 ACK하면 WARNING 소리가 멈춘다. 알림이 꺼져 있거나 거부됐으면 탭 제목에도 `(n)`이 붙는다. 켜는 법은 [알림 받기](alerts.md).
- **ATC 로고**: 설정 창. 화면 가운데 넓은 창으로 열리고, 왼쪽 메뉴에서 분류를 고른다: 화면(테마, 움직임, 시계, 밀도. 운영체제가 움직임 줄이기를 요청하면 움직임 설정과 상관없이 멈추고, 그동안 설정 창에 그렇다고 나온다), LINEAR, AGENTS, ACCOUNTS, 알림, 그리고 AUTOMATION 묶음의 **LANDING**(AUTOLAND, MCC, REVIEW)과 **OPERATIONS**(FUEL, REPOSITION, CONTROL RECYCLE, JUDGES). 메뉴 맨 위 **찾기** 칸에 `fuel`, `음성`, `login`, `LINEAR_API_KEY`처럼 블록 이름·한국어 이름·줄 이름·환경 변수를 적으면 맞는 블록이 나오고, 누르거나 Enter를 치면 그 분류로 가서 블록까지 내려가 잠깐 밝힌다. Esc는 찾기 글을 먼저 지우고, 한 번 더 누르거나 창 바깥을 누르면 닫힌다. 폰에서는 창이 화면을 채우고 분류가 위에 가로로 늘어선다. 창은 마지막에 쓴 분류로 다시 열린다(이 브라우저에 기억, 없으면 화면. 옛 AUTOMATION 탭을 기억하고 있으면 LANDING). AGENTS에는 SOURCES, STANDS, CALLSIGNS와 관제 세션 안내 한 줄이 있고, ACCOUNTS에는 폴더 상태(요금제와 한도의 사용·남음, REFRESH. [FLEET](fleet.md)), REGISTRY(등록부), ADD ACCOUNT와 LOGIN이 있다. 그 아래에 LAUNCH ACCOUNT(다음 LAUNCH가 쓸 ACCOUNT)와 **LAUNCH MODEL**(다음 LAUNCH가 `--model`로 넘길 모델: 기본, AIRPORT마다. [FLEET](fleet.md))이 있다. SUPERVISOR의 정책 스위치는 모두 **AUTOMATION** 묶음(LANDING·OPERATIONS)에 있다(2026-09-29부터). 두 분류 맨 위 한 줄이 지금 정책이다: `AUTOLAND off · AUTOLAND REVIEW off · MCC shadow · JEV off · FUEL HOLD off · REVIEW exclude`. ⚠ 모드는 호박색이다. **⚠ 모드로 올릴 때**(AUTOLAND `update`·`merge`, AUTOLAND REVIEW `delegate`, MCC `land`·`land+rts`·`rts`, JEV `replay`·`shadow`, FUEL HOLD `on`, REVIEW `deepseek`, CONTROL RECYCLE `on`, 세션의 `auto`, REPOSITION `auto`)는 고르는 중에 그 모드의 경고가 보이고, 저장을 누르면 "○○로 올리기" 확인 버튼이 한 번 더 나온다. 내리는 것(`off`, MCC `shadow`, REVIEW `exclude`)은 전처럼 바로 저장된다. 스위치마다 지금 모드의 경고만 보이고, 나머지 모드는 "다른 모드 n개"에 접혀 있다. REVIEW의 `deepseek`은 옛 이름이라 화면에는 `sonnet (deepseek)`으로 보인다(저장 값은 그대로). LANDING의 **REVIEW** 줄(`externalReview.security`)은 Codex 한도 때 보안 PR도 착륙 리뷰 세션(REVIEW, Claude Sonnet)에 보낼지 정한다. 기본 exclude, deepseek(옛 이름, 뜻은 "보냄")으로 바꾸면 보안 PR도 REVIEW가 리뷰한다(`.env`·비밀 경로와 FLIGHT 없는 PR은 계속 빠짐). 스트립에는 "REVIEW: SONNET (보안, Codex 한도)"로 보인다. LANDING의 **AUTOLAND** 줄(`autoland.mode`)은 착륙 자동화 스위치다: `off`(기본), `update`(behind인 CLEARED PR을 하나씩 갱신, 머지는 SUPERVISOR), `merge`(위임된 PR은 머지까지. vocado AGENTS.md에 예외를 적은 뒤에만). 모드마다 경고가 한 줄씩 보이고, GROUND STOP이 걸려 있으면 그 아래 **풀기** 버튼이 있다. 이 스위치는 이 화면에서만 바뀐다(관제 세션은 못 바꿈). 그 아래 **머지 리뷰 위임** 줄(`autoland.reviewedSecurity`, `off` 기본 · `delegate` ⚠)은 AUTOLAND 맡은 AIRPORT에서 REVIEW 세션이 atc에 남긴 이 head의 머지 리뷰 `pass`(스트립에 `MERGE REVIEW: REVIEW pass`)로 `rating:SEC`·보안 게이트 PR까지 AUTOLAND가 머지해도 되는지 정한다. `.env`·키·마이그레이션·SQL 경로와 Risk 라벨은 `delegate`여도 SUPERVISOR 몫이다. 머지 리뷰 자체는 이 스위치와 상관없이 `no-review`를 푼다([docs/occ.md](../occ.md) 9.7). 같은 분류의 **MCC** 줄 아래 **SHADOW GATE** 패널은 MCC를 `land`로 올릴 근거를 보여 준다: 판단한 atc PR(머지된 head에 INSPECTION·ESCALATE) 20건 이상, 첫 MCC 기록부터 5일 이상, would-land였는데 되돌린 PR 0건. 셋 다 맞으면 "준비됨"이다. 그 아래에는 불일치가 PR 링크와 함께 보인다: MCC가 findings였거나 INSPECTION이 없었는데 사람·structure가 머지한 PR, would-land였는데 되돌린 PR. 불일치를 보고 판단하는 것과 모드를 올리는 것은 SUPERVISOR가 MCC 줄에서 한다(패널은 읽기만). 관제 세션(TOWER·OCC·MCC·CROSSCHECK·REVIEW·ENGINEERING)은 2026-09-29부터 설정이 아니라 **FLEET 탭의 CONTROL SESSIONS 구역**(AIRCRAFT 목록 아래, 주소 `#fleet/control`)에 있다. AGENTS의 **CONTROL** 줄은 그리로 가는 링크 한 줄이다. 구역은 세션마다 떠 있는지 배지로 보인다: `BG <id>`(atc가 띄운 백그라운드), `tmux <세션>`(tmux pane), `interactive`(데스크톱 등, 그 창에서 닫는다), `not running`. 꺼져 있으면 **LAUNCH**: 다섯 세션 모두 그 폴더에서 백그라운드(`claude --bg`)로 띄운다(첫 메시지 `/loop … /tick`). 모델은 폴더 설정이 정한다: TOWER·OCC·REVIEW는 Claude Sonnet, MCC·CROSSCHECK는 Claude Opus. 떠 있으면 **STOP**(tmux pane에서 연 세션이면 묻고 나서 그 pane만 닫는다). ENGINEERING은 배지만 있다. FLEET가 보이는 동안 1분에 한 번 다시 읽는다. OPERATIONS의 **REPOSITION** 줄(`fleet-plan.json`의 `reposition`)은 쉬는 AIRCRAFT를 FLIGHT가 기다리는데 소속 AIRCRAFT가 없는 AIRPORT로 옮길지 정한다: `off`, `shadow`(기본, "옮겼을 것"을 FLIGHT RECORDER에만 남김), `approval`(FLEET PLAN에 REPOSITION 카드, 승인하면 멈추고 base를 바꿔 새 AIRPORT 저장소에서 다시 띄움), `auto`(⚠ 승인 없이 atc가 스스로: 하루 4건까지, AIRCRAFT마다 2시간에 한 번, 옮길 때마다 알림. 같은 AIRCRAFT가 직전 base로 되돌아가려 하면 approval로 돌아온다). 진행 중인 FLIGHT는 옮기지 않는다. 옮긴 AIRCRAFT의 카드(FLEET 탭)에 base 옆으로 마지막 REPOSITION이 보인다. `auto`로 올릴 때는 CONTROL RECYCLE `on`처럼 확인 버튼이 한 번 더 나온다. 배포해도 `shadow`다.
OPERATIONS의 **CONTROL RECYCLE** 줄(`control-recycle.json`)은 컨텍스트가 CAP을 넘은 관제 세션을 atc가 스스로 STOP하고 같은 ACCOUNT로 LAUNCH할지 정한다: `off`(기본, 아무것도 하지 않음), `shadow`("재시작했을 것"을 FLIGHT RECORDER에만 남김), `on`(⚠ 실제로 재시작). 재시작은 CAP을 넘었고, 세션이 턴 사이(job `done`·`idle`)이고, 안전한 순간(RTS가 돌지 않음, TOWER는 처리하지 않은 이벤트·overdue CLEARANCE 없음, OCC는 나가지 않은 FLIGHT PLAN·RECALL·10분 안에 나간 FLIGHT PLAN·열린 CREW CHANGE 없음)이고, 그 세션을 3시간 안에 재시작하지 않았고, 다른 세션이 재시작 중이 아닐 때만 한 번에 한 세션씩 한다. 줄 아래에는 세션마다 지금 컨텍스트와 CAP(k 토큰, 0이면 그 세션은 재시작 안 함)이 보이고 CAP은 여기서 고친다. 기본 CAP은 TOWER·CROSSCHECK 250k, MCC 150k, REVIEW 없음(스스로 auto-compact). **OCC는 자동 재시작에서 빠져 있다**(SUPERVISOR 결정 2026-09-30, 미기록 CAPTAIN 보고 틈이 별도 이슈로 닫힐 때까지): CAP 250k는 재기만 하고, 넘으면 SUPERVISOR ALERT(ADVISORY)만 뜬다. 세션마다 있는 **재시작** 줄을 `auto`로 바꾸면 그 세션도 자동 재시작 대상이 된다(⚠ 확인). 재시작이 끝나면 SUPERVISOR ALERT가 하나 뜬다(성공은 ADVISORY, 실패는 CAUTION. LAUNCH만 실패했으면 세션이 멈춘 채라고 적힌다). 이 스위치도 이 화면에서만 바뀌고, 바꾼 것은 FLIGHT RECORDER에 남는다. 배포해도 `off`다.
OPERATIONS의 **JUDGES** 줄(`judges.jev`)은 판정 계열 Jev 스위치다: `off`(기본), `replay`(판정한 지난 CLASSIFY 초안을 다시 판정), `shadow`(새 CLASSIFY 초안을 판정해 두고 판정 뒤에만 보임). 켜면 티켓 제목과 목표·수정 허용 범위·완료 기준이 TypeSafe로 나간다(`rating:SEC`·Risk 티켓은 제목만). DISPATCH의 열린 ASSIGN도 같은 스위치로 판정하고, 그때는 AIRCRAFT의 지난 atc FLIGHT 3개의 제목도 나간다. atc 저장소 AIRCRAFT의 턴이 끝날 때 CAPTAIN의 마지막 메시지(경로·URL을 가리고 최대 1,500자)도 나간다. 이것도 이 화면에서만 바뀐다.

## 경보 종류

경보마다 등급이 있다(ECAM의 WARNING·CAUTION·ADVISORY). 상단 ALERTS 숫자와 ALERT 줄은 조치가 필요한 WARNING·CAUTION만 센다. ADVISORY는 숫자에서 빠지고 `+n ADV`로 옆에 보인다. 목록에는 세 등급이 모두 있다.

| 경보 | 등급 | 뜻 |
|---|---|---|
| LOSS OF SEPARATION | WARNING(빨강) | 두 세션이 같은 STAND를 겹쳐 건드림 |
| STRANDED | WARNING(빨강) | FLIGHT의 PR이 main이 아닌 브랜치에 머지돼 main에 닿지 않음(Linear가 Done이어도 뜬다, ATC-29) |
| AIRCRAFT HEALTH | CAUTION(호박) | AIRCRAFT의 NETWORK·LIMIT 같은 health 경보(ATC-45) |
| NO CONTACT | CAUTION(호박) | ENROUTE인데 STAND가 없는 FLIGHT(상위 이슈는 제외) |
| UNIDENTIFIED | CAUTION(호박) | 점유한 AIRCRAFT 없이 바뀐 STAND |
| NORDO STAND | CAUTION(호박) | 죽은 세션이 쥔 STAND. 그 STAND의 FLIGHT가 아직 ARRIVED·CANCELLED가 아니거나 FLIGHT가 없을 때 |
| NORDO STAND | ADVISORY(회색) | 죽은 세션이 쥔 STAND인데 그 FLIGHT가 ARRIVED·CANCELLED라 정리만 하면 됨 |

목록은 등급 순(WARNING → CAUTION → ADVISORY)이고, 같은 등급 안에서는 종류끼리 묶인다. ADVISORY만 있으면 ALERT 줄이 뜨지 않고 ALERTS는 `00 +n ADV`로 보인다. 그것을 누르면 목록이 열린다.
