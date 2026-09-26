# 개념과 용어

화면과 문서의 항공 용어는 영어로 쓴다. 코드 이름은 그대로 둔다.

## 무엇이 무엇인가

| 용어 | 뜻 | 예 |
|---|---|---|
| AIRPORT | 저장소 하나(대문자 4자 코드) | `VCDO` = vocado_nextjs, `ATCC` = atc |
| AIRCRAFT | 팀 세션 하나 | `TEAM_B`, 호출부호 BRAVO |
| REGISTRATION | 팀 세션 이름(바뀌지 않는 식별자) | `TEAM_B` |
| CAPTAIN | 팀 리더 세션 | TEAM_B의 리더 |
| CREW | CAPTAIN 아래 팀원(서브에이전트·팀원 세션) | backend(Opus), ui-builder, ui-qa, flash-helper |
| STAND | git 워크트리 | `vocado-voc-193-…` |
| FLIGHT | Linear 티켓 | `VOC-193`, 화면 표기 `VOC193` |
| AD HOC | 티켓 없는 작업(작은 수정) | STRIPS의 FLIGHT 칸에 `AD HOC` |
| FLEET | 팀 전체 | TEAM_A … TEAM_H |

## AIRCRAFT 상태

| 상태 | 뜻 |
|---|---|
| AIRBORNE | 세션이 일하는 중 |
| HOLDING | 대기 중인데 끝나지 않은 FLIGHT의 STAND를 쥐고 있음 |
| PARKED | 대기 중, 쥔 STAND 없음 — 새 일을 받을 수 있음 |
| NORDO | 세션이 죽었는데 점유가 남음 |
| AOG | FLEET에서 잠시 운항 중지로 둠(배정 안 함) |

## FLIGHT 단계 (Linear 상태)

| 화면 | Linear |
|---|---|
| SCHEDULED | Backlog |
| FILED | Todo |
| ENROUTE | In Progress |
| APPROACH | In Review |
| CLEARED TO LAND | Ready to Merge |
| ARRIVED | Done |

## 충돌과 인계

- **LOSS OF SEPARATION**: 살아 있는 두 세션이 같은 STAND를 5분 넘게 겹쳐 건드림 — 경보.
- **HANDOFF**: 앞 세션이 손을 떼고 뒤 세션이 이어받음 — 경보 아님.
- **OUTSTATION**: 자기 AIRPORT가 아닌 저장소의 STAND에서 일하는 중.

## FLIGHT 분류

티켓의 Linear 라벨로 분류하고, DISPATCH planner가 쓴다.

| 축 | 라벨 | 값 |
|---|---|---|
| FLIGHT TYPE | `type` 그룹 | BUILD(구현) · MAINT(정비) · TEST(시험) · SURVEY(리서치) · CHECK(리뷰) · FERRY(기계적 수정) |
| WAKE CATEGORY | `wake` 그룹 | L(1시간 이내) · M(몇 시간) · H(1~2일) · J(여러 날, 나눠야 함) |
| TYPE RATING | `rating:` 또는 Risk 그룹 | SEC(보안·DB·권리) · UI · DATA · DOCS |
| TAIL ASSIGNMENT | `tail:TEAM_X` | 이 팀에만 제안 |

라벨이 없으면 BUILD · M로 본다. 자세한 규칙은 저장소의 `docs/fleet.md`.

## 교신

| 용어 | 뜻 |
|---|---|
| CLEARANCE | TOWER가 팀에 보내는 지시(`[ATC C-0007]`) |
| FLIGHT PLAN | OCC가 승인된 배정을 CAPTAIN에게 보내는 문구(`[DISPATCH D-0003]`, 2b부터) |
| READBACK | 받았다는 확인(`READBACK C-0007`) |
| HOLD | 선행 작업이나 사람 결정을 기다리게 잡아 둔 제안 |
