# 단계와 로드맵

자동화는 한 번에 넓히지 않는다. 각 단계는 그림자 운용으로 품질을 잰 뒤 사용자가 켠다.

## 관제 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | TOWER: 충돌·HANDOFF·머지 순서, CLEARANCE와 READBACK | 운용 중 |
| 1.5 | FLIGHT RECORDER와 METRICS: 운용 데이터 수집 | 운용 중 |
| 2a | DISPATCH 그림자 운용: 배정 제안과 판정 | 운용 중 |
| 2b | DISPATCH 승인 운용: 승인한 제안을 FLIGHT PLAN으로 보냄. STAND 없는 FLIGHT는 READBACK에 DEPARTED, CAPTAIN 보고로 ARRIVED | 만들어 둠, 꺼져 있음. 켜기 전 점검표는 DISPATCH 탭 |
| 3 | ATFM(흐름 관리): 저위험 배정 자동 승인, 머지 슬롯, CI 혼잡 시 출발 중지 | 데이터·그림자 판정 운용 중, "main 깨짐"·"수동" 출발 중지와 머지 슬롯은 스위치로 켤 수 있음(기본 꺼짐·그림자), 자동 배정은 아직 없음 |
| 4 | 네트워크 계획: 목표·지표 운영 화면, 에이전트는 초안까지 | NETWORK 탭(읽기 전용 개요와 ROUTE MAP) 운용 중. WAYPOINT ETA와 지연 경고는 OCC 브리핑과 SCHEDULE 탭에 있음. OCC의 TARGET·ROUTE 변경 초안은 그림자 판정으로 운용(적용은 아직 없음) |

- 2a → 2b: 판정 20건 이상, 합의율 80% 이상.
- 2b → 3: 2주 이상, READBACK 90% 이상, DEPARTED 80% 이상(STAND가 필요한 FLIGHT만), DISPATCH가 보낸 FLIGHT에서 난 충돌이 거의 없음.
- 3단계 설계(저장소의 `docs/atfm.ko.md`)는 네 가지를 다룬다. 모두 그림자 운용(계산해서 보여 주기만 함)으로 먼저 잰 뒤 사용자가 켠다.
  - **저위험 배정 자동 승인**: WAKE L·M, SEC 아님, CAUTION 없음, 명시 라벨, TAIL·ROUTE 일치, CROSSCHECK agree일 때만.
  - **S3 자동 처리**: SEC가 아닌 CLASSIFY로, 빈 축에 라벨을 붙이는 것만.
  - **머지 슬롯**: 저장소마다 동시에 LAND를 받는 PR 수를 정한다.
  - **출발 중지(GROUND STOP)**: main이 깨지거나, CI 실패가 몰리거나, LOS가 늘면 새 배정과 LAND를 멈춘다.
- 모든 자동 동작에는 끄는 스위치, 하루 상한, 스스로 꺼지는 조건, FLIGHT RECORDER 기록이 붙는다. 자동 판정은 사람 판정 점검(게이트)에 세지 않는다.
- 지금 만들어진 것(1~5단계):
  - DISPATCH 탭의 **ATFM** 블록에서 볼 수 있다: 저장소마다 main CI, 출발 중지(ENFORCED·그림자), 머지 슬롯, 자동 배정·S3 대상 판정과 정확도, 켜는 조건. "2주 운용" 줄은 모드를 approval로 바꾼 기록에서 재고, 기록을 찾지 못하면 "△ 확인 필요"로 보인다.
  - 켤 수 있는 것은 세 가지뿐이다. **main 깨짐**을 켜면 그 AIRPORT에 새 배정과 LAND가 멈춘다. **수동**을 켜면 AIRPORT마다 이유를 적어 출발 중지를 선언하고 푼다. **머지 슬롯**을 켜면 TOWER가 저장소마다 슬롯 안의 PR에만 LAND를 준다(vocado_nextjs는 한 번에 1개). 슬롯을 기다리는 PR은 앞 PR이 머지되거나 그 LAND 뒤 30분이 지나면 LAND를 받는다. 켜기 전에 스위치 아래 "켜기 판단 (7일)"에서 같은 저장소의 동시 LAND와 머지당 BEHIND를 본다.
  - 나머지(CI 실패 몰림, CI 혼잡, LOS 증가)는 그림자다.
  - **ATFM OFF**를 누르면 모두 그림자로 돌아간다.
  - 스위치는 `~/.local/state/atc/atfm.json`에 있다.
- RECALL(보낸 FLIGHT PLAN을 거두는 문구)은 만들어 뒀다. 다음은 자동 배정이다.

## OCC 단계 (SCHEDULE)

| 단계 | 내용 | 상태 |
|---|---|---|
| S0 | OCC 세션: DISPATCH 흡수, 읽기 전용 gh, MCP 읽기만, 지침 다시 읽기 | 운용 중 |
| S1 | SCHEDULE 초안(그림자): CLASSIFY · PRIORITIZE · NEW(CHARTER DESK) | 운용 중 |
| S2 | 승인한 초안을 Linear에 씀(linear-guard). vocado "Linear에는 리더만" 규칙 변경 | 만들어 둠, 꺼져 있음 (판정 20건·80% 후 켬) |
| S3 | 저위험 작업만 자동(예: 머지 뒤 CLOSE). SEC는 계속 사람 승인 | S2 2주 후 |
| CROSSCHECK | 다른 계열 모델의 예비 판정 + 한 번 클릭 판정. 사람 판정과의 일치율을 따로 잼(게이트에는 안 셈) | 만들어 둠, 세션을 열면 운용 |

CROSSCHECK 일치율은 S3에서 SEC가 아닌 CLASSIFY 같은 저위험 작업을 자동으로 넘길지 정할 근거다. 자동 판정 자체는 아직 없다.

## FLEET

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | TAIL ASSIGNMENT(`tail:`) | 완료 |
| 2 | FLEET 등록부와 탭 | 완료 |
| 3 | 분류 라벨과 planner 규칙(TYPE RATING·CREW·WAKE·ROUTE) | 완료 |
| — | 팀 빌딩(ENTRY INTO SERVICE, CREW BRIEFING, AOG, 퇴역) | 완료 |
| — | 세션 조종: atc가 세션을 띄우고 멈춤(LAUNCH·STOP, SUPERVISOR가 누를 때) | 완료. 수요 기반 자동 제안은 다음 |
| 다음 | CREW CHANGE, CHECKRIDE, 실제 관측 팀원, TARGETS 실적 | 예정 |

설계 문서: 저장소의 `docs/dispatch.ko.md`, `docs/occ.ko.md`, `docs/fleet.ko.md`, `docs/atfm.ko.md`.
