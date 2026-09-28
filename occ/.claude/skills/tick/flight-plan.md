# OCC 절차: FLIGHT PLAN 전달

**한국어** · [English](flight-plan.en.md)

[`CLAUDE.md`](../../../CLAUDE.md)에서 옮긴 절차다. (2b) `/tick` 1·4단계에서 FLIGHT PLAN·RECALL 답장이 왔거나 `inFlight`에 approved·recalling, `overdue`가 있을 때 Read한다. 역할과 하지 않는 것은 `CLAUDE.md`가 정한다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `node ../controller/atcctl.mjs dispatch release <D-0003>` | (2b) 승인된 제안을 sent로 바꾸고 `SEND TO`와 FLIGHT PLAN 문구를 출력. 이미 sent면 같은 문구를 다시 출력(재송신용) |
| `node ../controller/atcctl.mjs dispatch readback <D-0003>` | (2b) CAPTAIN이 READBACK함 |
| `node ../controller/atcctl.mjs dispatch decline <D-0003> -- <사유>` | (2b) CAPTAIN이 사유를 들어 맡지 못함 |
| `node ../controller/atcctl.mjs dispatch recall-send <D-0003>` | (2b) SUPERVISOR가 RECALL을 요청한 제안(`recalling`)의 `SEND TO`와 RECALL 문구. 재송신도 같은 문구 |
| `node ../controller/atcctl.mjs dispatch recalled <D-0003>` | (2b) CAPTAIN이 "READBACK D-0003 RECALL"로 답함 |
| `node ../controller/atcctl.mjs dispatch arrived <D-0003> -- <결과 링크나 한 줄>` | (2b) STAND 없는 FLIGHT(SURVEY·CHECK)를 CAPTAIN이 마쳤다고 보고함 |

## FLIGHT PLAN 전달 (2b, `mode`가 approval일 때만)

| 상황 (브리핑 위치) | 할 일 |
|---|---|
| `inFlight` 중 `approved` ASSIGN | `dispatch release <ID>` → 출력의 `SEND TO` 세션에 `---` 아래 문구를 **그대로** SendMessage. 한 바퀴에 CAPTAIN마다 하나 |
| 그 ASSIGN의 AIRCRAFT가 `dispatch brief`의 `fuel.coldCache`에 있음(캐시가 식은 HOLDING CAPTAIN, ATC-56) | 그래도 위대로 보낸다 — 경고만 하고 막지 않는다. OCC LOG에 그 `text`를 적는다. 캐시를 데우려는 메시지는 따로 보내지 않는다 |
| CAPTAIN 답장 "READBACK D-xxxx" | `dispatch readback D-xxxx` |
| CAPTAIN이 STAND 없는 FLIGHT(SURVEY·CHECK, READBACK 때 DEPARTED)를 마쳤다고 보고 | `dispatch arrived D-xxxx -- '<결과 링크나 한 줄>'` |
| `inFlight` 중 `recalling`(SUPERVISOR가 화면·API로 RECALL 요청) | `dispatch recall-send <ID>` → 출력의 `SEND TO` 세션에 `---` 아래 RECALL 문구를 **그대로** SendMessage. RECALL 요청은 SUPERVISOR만 한다 — OCC는 만들지 않는다. 켜진 출발 중지가 있어도 보낸다(회수는 안전 쪽 동작) |
| CAPTAIN 답장 "READBACK D-xxxx RECALL" | `dispatch recalled D-xxxx`. FLIGHT는 다시 후보가 되고 같은 AIRCRAFT에는 24시간 제안되지 않는다. "RECALL" 없는 "READBACK D-xxxx"는 FLIGHT PLAN의 READBACK이니 헷갈리지 않는다 |
| `overdue`에 든 recalling(RECALL 뒤 10분 넘게 READBACK 없음) | `dispatch recall-send <ID>`로 같은 문구를 받아 한 번 더 보낸다. 그래도 없으면 SUPERVISOR 보고 |
| CAPTAIN이 사유를 들어 거절 | `dispatch decline D-xxxx -- <사유 요약>`. SUPERVISOR 보고 |
| `overdue`에 든 sent(10분 넘게 READBACK 없음) | `dispatch release <ID>`로 같은 문구를 받아 한 번 더 보낸다. 그래도 없으면 SUPERVISOR 보고 |
| `overdue`에 든 accepted(READBACK 뒤 30분 넘게 STAND 없음), STAND 없는 departed(24시간 넘게 ARRIVED 보고 없음) | SUPERVISOR 보고만 |
| send-guard가 막음 | 문구나 받는 사람을 고쳐 다시 시도하지 말고 SUPERVISOR 보고 |
| `dispatch release`가 `GROUND STOP — …`으로 거절(켜진 출발 중지가 그 AIRPORT에 걸림) | 보내지 않는다. 승인된 제안은 풀릴 때까지 그대로 둔다. OCC LOG에 출발 중지 사유를 적고, "main 깨짐"이면 실패한 체크와 커밋을 읽기 전용 `gh`로 확인해 SUPERVISOR에게 보고 |

STAND가 생기면 atc가 DEPARTED로 바꾼다. RELEASE 제안은 승인돼도 보내지 않는다(SUPERVISOR가 Linear에서 정리).
