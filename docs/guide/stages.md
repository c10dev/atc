# 단계와 로드맵

자동화는 한 번에 넓히지 않는다. 각 단계는 그림자 운용으로 품질을 잰 뒤 사용자가 켠다.

## 관제 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | TOWER: 충돌·HANDOFF·머지 순서, CLEARANCE와 READBACK | 운용 중 |
| 1.5 | FLIGHT RECORDER와 METRICS: 운용 데이터 수집 | 운용 중 |
| 2a | DISPATCH 그림자 운용: 배정 제안과 판정 | 운용 중 |
| 2b | DISPATCH 승인 운용: 승인한 제안을 FLIGHT PLAN으로 보냄 | 만들어 둠, 꺼져 있음 |
| 3 | ATFM(흐름 관리): 저위험 배정 자동 승인, 머지 슬롯, CI 혼잡 시 출발 중지 | 설계 전 |
| 4 | 네트워크 계획: 목표·지표 운영 화면, 에이전트는 초안까지 | 설계 전 |

- 2a → 2b: 판정 20건 이상, 합의율 80% 이상.
- 2b → 3: 2주 이상, READBACK 90% 이상, DISPATCH가 보낸 FLIGHT에서 난 충돌이 거의 없음.

## OCC 단계 (SCHEDULE)

| 단계 | 내용 | 상태 |
|---|---|---|
| S0 | OCC 세션: DISPATCH 흡수, 읽기 전용 gh, MCP 읽기만, 지침 다시 읽기 | 운용 중 |
| S1 | SCHEDULE 초안(그림자): CLASSIFY · PRIORITIZE · NEW(CHARTER DESK) | 운용 중 |
| S2 | 승인한 초안을 Linear에 씀(linear-guard). vocado "Linear에는 리더만" 규칙 변경 | 판정 20건·80% 후 |
| S3 | 저위험 작업만 자동(예: 머지 뒤 CLOSE). SEC는 계속 사람 승인 | S2 2주 후 |

## FLEET

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | TAIL ASSIGNMENT(`tail:`) | 완료 |
| 2 | FLEET 등록부와 탭 | 완료 |
| 3 | 분류 라벨과 planner 규칙(TYPE RATING·CREW·WAKE·ROUTE) | 완료 |
| — | 팀 빌딩(ENTRY INTO SERVICE, CREW BRIEFING, AOG, 퇴역) | 완료 |
| 다음 | CREW CHANGE, CHECKRIDE, 실제 관측 팀원, TARGETS 실적 | 예정 |

설계 문서: 저장소의 `docs/dispatch.md`, `docs/occ.md`, `docs/fleet.md`.
