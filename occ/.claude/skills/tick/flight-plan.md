# OCC 절차: FLIGHT PLAN 전달

**한국어** · [English](flight-plan.en.md)

[`CLAUDE.md`](../../../CLAUDE.md)에서 옮긴 절차다. (2b) `/tick` 1·2·4단계에서 FLIGHT PLAN·RECALL 답장이 왔거나 `inFlight`에 approved·recalling, `overdue`, `arrivalCandidates`·`arrivalMissing`이 있을 때 Read한다. 역할과 하지 않는 것은 `CLAUDE.md`가 정한다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `node ../controller/atcctl.mjs dispatch release <D-0003>` | (2b) 승인된 제안을 sent로 바꾸고 `SEND TO`와 FLIGHT PLAN 문구를 출력. 이미 sent면 같은 문구를 다시 출력(재송신용) |
| `node ../controller/atcctl.mjs dispatch readback <D-0003> [@a1b2c3]` | (2b) CAPTAIN이 READBACK함. `@a1b2c3`는 CAPTAIN이 답에 인용한 work-order 해시(ATC-555) — 답에 적힌 그대로만 넘기고, 없으면 넘기지 않는다. 브리핑·FLIGHT PLAN에서 해시를 옮겨 적지 않는다 |
| `node ../controller/atcctl.mjs dispatch unable <D-0003> -- <사유>` | (2b) CAPTAIN이 "UNABLE D-0003 — 사유"로 답함(= `dispatch decline`, 닫힌다) |
| `node ../controller/atcctl.mjs dispatch standby <D-0003>` | (2b) CAPTAIN이 "STANDBY D-0003"으로 답함(sent 그대로, READBACK overdue를 첫 STANDBY부터 한 번 다시 센다) |
| `node ../controller/atcctl.mjs dispatch await-supervisor <D-0003> -- <사유>` | (2b) CAPTAIN이 READBACK도 거절도 아니고 사용자(SUPERVISOR)의 go를 기다림(sent 유지, `awaitSupervisor`에 사유, 경보). READBACK이 오면 `dispatch readback`이 지운다 |
| `node ../controller/atcctl.mjs dispatch undelivered <D-0003> -- <사유>` | (2b) SendMessage 결과가 `success:false`였다(ATC-183). sent를 approved로 돌려 세션이 돌아오면 다시 release한다. SUPERVISOR 판정이 아니고, CAUTION 경보가 하나 뜬다. sent인 제안에만 |
| `node ../controller/atcctl.mjs dispatch recall-send <D-0003>` | (2b) SUPERVISOR가 RECALL을 요청한 제안(`recalling`)의 `SEND TO`와 RECALL 문구. 재송신도 같은 문구 |
| `node ../controller/atcctl.mjs dispatch recalled <D-0003>` | (2b) CAPTAIN이 "READBACK D-0003 RECALL"로 답함 |
| `node ../controller/atcctl.mjs dispatch arrived <D-0003> -- <결과 링크나 한 줄>` | (2b) STAND 없는 FLIGHT(SURVEY·CHECK)를 CAPTAIN이 마쳤다고 보고함 |

## FLIGHT PLAN 전달 (2b, `mode`가 approval일 때만)

| 상황 (브리핑 위치) | 할 일 |
|---|---|
| `inFlight` 중 `approved` ASSIGN | `dispatch release <ID>` → 출력의 `SEND TO` 세션에 `SEND:` 줄(머리 `[DISPATCH D-xxxx]`만)을 SendMessage. send-guard가 저장된 문구로 바꿔 넣는다(`---` 아래 전체 문구는 로그용이니 다시 치지 않는다). 한 바퀴에 CAPTAIN마다 하나 |
| 그 ASSIGN의 AIRCRAFT가 `dispatch brief`의 `fuel.coldCache`에 있음(캐시가 식은 HOLDING CAPTAIN, ATC-56) | 그래도 위대로 보낸다 — 경고만 하고 막지 않는다. OCC LOG에 그 `text`를 적는다. 캐시를 데우려는 메시지는 따로 보내지 않는다 |
| CAPTAIN 답장 "READBACK D-xxxx @xxxxxx" | `dispatch readback D-xxxx @xxxxxx`(답의 해시 그대로). 해시 없는 "READBACK D-xxxx"면 `dispatch readback D-xxxx`(해시 전의 옛 FLIGHT PLAN은 그대로 받는다) |
| `dispatch readback`이 409 `READBACK D-xxxx refused — … quote the work-order hash @xxxxxx …`(ATC-555) | CAPTAIN이 FLIGHT PLAN의 해시를 인용하지 않았거나 다른 해시를 인용했다. 기록하지 않는다. 해시를 대신 채워 다시 부르지 않고, 이 일로 FLIGHT PLAN을 다시 보내지 않는다. OCC LOG에 인용한 해시(없으면 "없음")와 오류가 준 답 한 줄을 적는다. 다른 해시를 인용했으면 CAPTAIN이 다른 지시서를 받았다는 뜻이니 SUPERVISOR에게 보고한다. 카드는 sent로 남아 READBACK overdue가 SUPERVISOR에게 간다 |
| `dispatch accept`·`decline`·`standby`·`await-supervisor`가 409 `… answer the latest call D-yyyy`(ATC-554) | CAPTAIN이 같은 FLIGHT의 옛 FLIGHT PLAN에 답했다. 옛 id에는 기록하지 않고, 답이 새 계획에 대한 것이면 D-yyyy에 같은 명령을 내고 아니면 OCC LOG에 적는다. 이 일로 다시 보내지 않는다 |
| CAPTAIN의 최종 보고 `[TEAM_X → OCC] ARRIVED ATC-n · PR #n`(ATC-124) | 명령은 `/tick` 0단계(읽는 즉시, 다른 어떤 단계보다 먼저). 자유 요약은 기록하지 않는다. `blocked-report`가 뜨면 SUPERVISOR에게 보고한다. PR 없는 FLIGHT를 `dispatch report`로 기록했는데 그 카드가 아직 `accepted`(STAND를 본 적 없음)면 이어서 `dispatch arrived <D-xxxx> -- <링크나 한 줄>`(ATC-266. 서버는 STAND 없는 FLIGHT나 보고가 기록된 FLIGHT만 받는다). 머리가 없는 옛 꼴의 완료 보고("D-xxxx (ATC-n) done: <PR>")는 PR 번호·tier·tests·discretion·blocked를 메시지가 모두 말할 때만 그 값 그대로 기록하고, 하나라도 빠졌으면 짐작해 채우지 말고 기록하지 않은 채 OCC LOG에 "고정 보고 없음"으로 남긴다(팀에 묻지 않는다, ATC-152) |
| CAPTAIN 답장 "STANDBY D-xxxx" | `dispatch standby D-xxxx`. 다시 보내지 않고 기다린다. 두 번째 STANDBY도 기록하지만 overdue는 첫 STANDBY부터 센다 |
| CAPTAIN 답장이 READBACK도 UNABLE도 아니고 "사용자 go를 기다린다"(예: 사용자 등급 파일이라 SUPERVISOR 확인이 필요) | `dispatch await-supervisor D-xxxx -- <사유 그대로>`. 다시 보내지 않고, 재시도하지 않고, 승인을 전하지 않는다(누구에게도 "SUPERVISOR가 승인했다"고 하지 않는다). SUPERVISOR 보고는 atc 경보와 FOLLOWING이 한다. `confirm`의 붙여 넣기 한 줄은 SUPERVISOR 몫이다. 뒤늦게 "READBACK D-xxxx"가 오면 `dispatch readback D-xxxx` |
| CAPTAIN이 STAND 없는 FLIGHT(SURVEY·CHECK, READBACK 때 DEPARTED)를 마쳤다고 보고 | `dispatch arrived D-xxxx -- '<결과 링크나 한 줄>'`. D-xxxx 없이 직접 배정된 것이면 `dispatch arrived <FLIGHT> --aircraft <TEAM_X> -- '<결과 링크나 한 줄>'` |
| `inFlight` 중 `recalling`(SUPERVISOR가 화면·API로 RECALL 요청) | `dispatch recall-send <ID>` → 출력의 `SEND TO` 세션에 `SEND:` 줄(`[DISPATCH D-xxxx] RECALL`만)을 SendMessage. send-guard가 저장된 RECALL 문구로 바꿔 넣는다. RECALL 요청은 SUPERVISOR만 한다 — OCC는 만들지 않는다. 켜진 출발 중지가 있어도 보낸다(회수는 안전 쪽 동작) |
| CAPTAIN 답장 "READBACK D-xxxx RECALL" | `dispatch recalled D-xxxx`. FLIGHT는 다시 후보가 되고 같은 AIRCRAFT에는 24시간 제안되지 않는다. "RECALL" 없는 "READBACK D-xxxx"는 FLIGHT PLAN의 READBACK이니 헷갈리지 않는다 |
| `overdue`에 든 recalling(RECALL 뒤 10분 넘게 READBACK 없음) | `dispatch recall-send <ID>`로 같은 문구를 받아 한 번 더 보낸다. 그래도 없으면 SUPERVISOR 보고 |
| CAPTAIN 답장 "UNABLE D-xxxx — 사유", 또는 형식 없이 사유를 들어 거절 | `dispatch unable D-xxxx -- <사유 그대로>`. 다시 보내지 않고 SUPERVISOR 보고(FOLLOWING에도 하루 뜬다). RECALL에는 UNABLE이 없다 — RECALL은 "READBACK D-xxxx RECALL"로만 닫힌다 |
| `overdue`에 든 sent(10분 넘게 READBACK 없음. 첫 STANDBY가 있으면 그때부터 10분) | `dispatch release <ID>`로 같은 문구를 받아 한 번 더 보낸다. 그래도 없으면 SUPERVISOR 보고 |
| `overdue`에 든 accepted(READBACK 뒤 30분 넘게 STAND 없음), STAND 없는 departed(24시간 넘게 ARRIVED 보고 없음) | SUPERVISOR 보고만 |
| **SendMessage 결과가 `success:false`**(FLIGHT PLAN 전송, ATC-183) | 바로 `dispatch undelivered D-xxxx -- <도구가 돌려준 메시지 그대로>`. **같은 tick에 다시 보내지 않는다.** OCC LOG에 "sent"라고 쓰지 않고 "undelivered"와 사유를 쓴다. 제안은 approved로 돌아가 세션이 돌아오면 다음 바퀴에 다시 나온다. 결과가 성공이면 아무것도 더하지 않는다(READBACK이 온 뒤에야 `dispatch readback`) |
| RECALL을 보냈는데 `success:false` | 같은 tick에 다시 보내지 않는다. OCC LOG에 "sent"라고 쓰지 않고 SUPERVISOR 보고. `recall-send`는 상태를 바꾸지 않아 되돌릴 기록이 없다 — 다음 바퀴의 `overdue`(RECALL) 규칙이 한 번 다시 보낸다 |
| `dispatch release`가 `GROUND STOP — …`으로 거절(켜진 출발 중지가 그 AIRPORT에 걸림) | 보내지 않는다. 승인된 제안은 풀릴 때까지 그대로 둔다. OCC LOG에 출발 중지 사유를 적고, "main 깨짐"이면 실패한 체크와 커밋을 읽기 전용 `gh`로 확인해 SUPERVISOR에게 보고 |
| `dispatch release`가 `… LAUNCHING — 새 세션을 기다림 …`이나 `… RESTARTING …`(세션 없음 — /clear 뒤 첫 메시지 대기)으로 거절(launch 카드를 승인해 atc가 띄운 새 세션이 아직 없음, ATC-129·91) | 보내지 않는다. 승인은 그대로다. 다음 바퀴에 다시 `dispatch release`한다 — 새 세션이 뜨면 전처럼 나간다. 세션을 띄우거나 깨우는 메시지를 따로 보내지 않는다 |
| `dispatch release`가 `AIRCRAFT 세션 없음 — 보내지 않음 (LAUNCH 필요)`로 거절(그 AIRCRAFT에 살아 있는 세션이 없고 launch 카드도 아님, ATC-183) | 보내지 않는다. 승인은 그대로다. OCC LOG에 적고 SUPERVISOR 보고(LAUNCH는 SUPERVISOR가 FLEET에서). 세션이 돌아오면 다음 바퀴에 다시 `dispatch release`한다. 이 거절이 오면 SendMessage하지 않으니 `undelivered`도 필요 없다 |
| `dispatch release`가 `… LAUNCH 실패 …`로 거절, 또는 `following`에 `launch` 문제 | 보내지 않는다. SUPERVISOR 보고(다시 승인하거나 FLEET에서 LAUNCH하는 것은 SUPERVISOR 몫) |
| `dispatch release`가 `FRESH START가 새 세션의 첫 프롬프트로 이미 보냄 …`으로 거절(그 카드는 SUPERVISOR가 FRESH START로 보냈다: FLIGHT PLAN이 새 세션의 첫 프롬프트였다, ATC-73) | **다시 보내지 않는다.** 같은 계획이 두 번 가면 안 된다. `overdue`에 든 sent라도 마찬가지다. SUPERVISOR 보고 한 줄(READBACK 없음)만 한다. 카드의 `sentVia`가 `fresh-start`이면 처음부터 `release`하지 않는다 |

RELEASE 제안은 승인돼도 보내지 않는다(SUPERVISOR가 Linear에서 정리).
## 도착 후보와 도착 보고 누락 (`dispatch brief`)

- `arrivalCandidates`(STAND 없는 FLIGHT의 ARRIVED 후보): 후보마다 `evidence.url`을 연다(GitHub이면 읽기 전용 `gh pr view <N> --comments`, Linear 댓글이면 `dispatch flight <FLIGHT>`). 그 팀이 그 FLIGHT의 일을 마친 결과가 맞으면 `command`를 그대로 실행한다. 아니거나 애매하면 치지 않고 SUPERVISOR에게 보고한다. 후보는 제안일 뿐이다: 잘못 확인하면 AIRCRAFT가 일찍 풀린다.
- `arrivalMissing`(머지됐는데 도착 보고가 없는 FLIGHT, ATC-169): 보고를 받은 OCC가 기록하지 못했거나 CAPTAIN이 보내지 않았다(기록 전에 이 세션이 멈추면 보고는 사라진다. CAPTAIN은 다시 보내지 않는다). `due: true`가 있으면 그 FLIGHT를 OCC LOG에 적고 SUPERVISOR에게 한 번 알린다. CAPTAIN에게 묻는 메시지는 보내지 않는다(새 send 종류가 없다). `due: false`(머지 30분 안)는 오는 중일 수 있으니 기다린다. 도착 보고를 받으면 이미 기록됐는지 이 목록으로 확인한다.
