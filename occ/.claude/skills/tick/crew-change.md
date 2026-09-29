# OCC 절차: CREW CHANGE 발부

**한국어** · [English](crew-change.en.md)

[`CLAUDE.md`](../../../CLAUDE.md)에서 옮긴 절차다. (2b) `/tick` 1·4단계에서 CREW CHANGE 답장이 왔거나 `crew-change brief`에 `approved`·`overdue`가 있을 때 Read한다. 역할과 하지 않는 것은 `CLAUDE.md`가 정한다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `node ../controller/atcctl.mjs crew-change send <CC-0001>` | (2b) 승인된 CREW CHANGE를 sent로 바꾸고 `SEND TO`(REGISTRATION)와 문구를 출력. 이미 sent면 같은 문구(재송신용) |
| `node ../controller/atcctl.mjs crew-change readback <CC-0001>` | CAPTAIN이 "READBACK CC-0001"로 답함 |
| `node ../controller/atcctl.mjs crew-change unable <CC-0001> -- <사유>` | CAPTAIN이 "UNABLE CC-0001 — 사유"로 답함(닫힌다) |
| `node ../controller/atcctl.mjs crew-change standby <CC-0001>` | CAPTAIN이 "STANDBY CC-0001"로 답함(sent 그대로, overdue를 첫 STANDBY부터 한 번 다시 센다) |

## CREW CHANGE 발부 (2b, `crew-change brief`의 `mode`가 approval일 때만)

SUPERVISOR가 운항 중인 AIRCRAFT의 CREW COMPLEMENT를 바꾸면 atc가 CREW CHANGE(`CC-xxxx`)를 만든다. **승인은 SUPERVISOR만 한다**(FLEET 탭). OCC는 승인된 것만 보내고 READBACK을 기록한다. 문구는 atc가 만들고(`[OCC CC-xxxx] CREW CHANGE · …`), OCC는 그대로 옮기기만 한다.

| 상황 (`crew-change brief` 위치) | 할 일 |
|---|---|
| `approved` | `crew-change send <CC-xxxx>` → 출력의 `SEND TO` 세션(그 AIRCRAFT)에 `SEND:` 줄(머리 `[OCC CC-xxxx]`만)을 SendMessage. send-guard가 저장된 문구로 바꿔 넣는다(`---` 아래 전체 문구는 로그용). 한 바퀴에 AIRCRAFT마다 하나 |
| `waiting`(승인됐지만 같은 AIRCRAFT의 앞 건 `waitingFor`가 READBACK 전) | 보내지 않는다. `crew-change send`도 409로 거절한다. 앞 건의 READBACK 뒤 다음 바퀴에 `approved`로 온다 |
| CAPTAIN 답장 "READBACK CC-xxxx" | `crew-change readback CC-xxxx`. READBACK 없이 "… CREW CHANGE CC-xxxx COMPLETE"만 와도 받은 것이 분명하니 `crew-change readback CC-xxxx`하고 OCC LOG에 COMPLETE를 적는다 |
| CAPTAIN 답장 "UNABLE CC-xxxx — 사유" | `crew-change unable CC-xxxx -- <사유 그대로>`. 다시 보내지 않고 SUPERVISOR 보고(`crew-change brief`의 `unable`에 하루 남는다). COMPLEMENT를 되돌릴지 정하는 것은 SUPERVISOR다 |
| CAPTAIN 답장 "STANDBY CC-xxxx" | `crew-change standby CC-xxxx`. 다시 보내지 않고 기다린다 |
| `overdue`에 든 sent(보낸 뒤 10분 넘게 READBACK 없음. 첫 STANDBY가 있으면 그때부터 10분) | `crew-change send <CC-xxxx>`로 같은 문구를 받아 **한 번만** 더 보낸다. 그래도 없으면 SUPERVISOR 보고 |
| `pending` | 할 일 없음(SUPERVISOR 승인 대기). OCC는 승인하거나 재촉하지 않는다 |
| send-guard가 막음, 또는 `crew-change send`가 거절 | 문구나 받는 사람을 고쳐 다시 시도하지 말고 SUPERVISOR 보고 |

- `shadow`(2a)면 이 절을 건너뛴다. CREW CHANGE는 SUPERVISOR가 FLEET 카드에서 복사해 직접 붙여 넣는다.
- 보낸 뒤 SUPERVISOR가 COMPLEMENT를 또 바꾸면 새 CC가 생기고 앞 건의 READBACK 뒤에 보낸다. 보내기 전(approved)에 바뀌면 atc가 새 CC로 대신하고, 새 것은 다시 승인을 받는다.
- FLIGHT PLAN의 "READBACK D-xxxx", RECALL의 "READBACK D-xxxx RECALL"과 헷갈리지 않는다. CC 번호는 `CC-`로 시작한다.
