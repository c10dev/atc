# CONTROL STOP CHECK: 관제 세션 STOP 확인과 중복 경고 (ATC-521)

[control-recycle.md](control-recycle.md) 5절과 6절의 한국어 요약이다(그 문서의 나머지는 영어판만 있다).

CONTROL STOP·CONTROL RECYCLE·APPLY NOW는 `claude stop`이 종료 코드 0이면 `ok: true`로 기록했다. 2026-10-02 22:26의 RECYCLE이 MCC job 4d8c68ae(acct-1)를 "멈췄다"고 기록했지만 그 `state.json`은 끝내 `stopped`가 되지 않았고(마지막 줄 22:22 `done`), 10-03 08:45에 깨어나 PR #527을 착륙시킨 뒤 새 MCC 옆에서 같이 tick했다. atc는 그것을 몰랐다.

- **STOP을 확인한다.** 백그라운드 관제 세션에 `claude stop`이 종료 코드 0으로 돌아오면, `stopControl`(FLEET STOP 단추, 일괄 STOP, RECYCLE, APPLY NOW가 모두 거치는 한 함수)이 그 job의 `state.json`을 최대 20초 다시 읽는다. `stopped`일 때만 `ok: true`이고, 아니면 `ok: false`, `unverified: true`와 따로 적은 사유(`claude stop은 종료 코드 0이었지만 job state.json이 done이라 …`)가 남는다. `claude stop 실패`와 다른 글이다. tmux pane 멈춤은 그대로다.
- **RECYCLE은 종료 코드만 믿고 새로 띄우지 않는다.** 확인이 안 된 STOP이면 `performRecycle`은 `result: "stop-unverified"`로 끝나고 `launchControl`을 부르지 않는다.
- **알림 둘, 모두 WARNING.** `control|unverified|<세션>|<job>`: 최근 6시간에 막은 STOP의 job이 지금도 `stopped`가 아니고 SUPERVISOR가 오탐으로 표시하지 않은 것(job이 `stopped`가 되면 저절로 사라진다). `control|duplicate|<세션>`: 같은 관제 이름의 살아 있는 job이 둘 이상 — STALE이 아니고, state가 `stopped`가 아니고, `state.json`을 쓴 지 60분 안(`DUP_RECENT_MIN`). 글에 관제 세션, job id, ACCOUNT, state가 든다. 10-01의 끝난 STALE 유령 줄은 세지 않는다.
- **스위치 하나, 기본 on.** 설정 창 OPERATIONS의 CONTROL STOP CHECK 블록(`control-stop-check.json`의 `controlStopCheck`). SUPERVISOR만(이 화면의 Origin) 바꾼다. atcctl 명령도 관제 세션의 변경도 없다. 끄면 옛 판정(종료 코드)으로 돌아가고 중복 검사가 빠진다. 바꾸면 FLIGHT RECORDER에 `policy control-stop-check-mode`로 남는다. 선언이 `server/switches/`에 있어 이 PR은 `user` 등급이다.
- **오작동 수.** 결정마다 FLIGHT RECORDER에 `control stop-check` 줄이 남는다: `blocked`(검사가 ok를 막음), `duplicate`(중복 WARNING), `contradicted`(나중에 검사가 틀렸다고 드러남: 막은 job이 뒤늦게 `stopped`가 됨, 중복 경고가 2분 안에 저절로 풀림), `dismissed`(SUPERVISOR가 `오탐으로 표시`). 설정 블록에 최근 7일·30일 수, 오탐 몫(contradicted·dismissed인 서로 다른 결정 ÷ blocked + duplicate), 지금 열린 중복, 최근 결정 다섯 줄이 보인다.

# 막는 것의 이름과 TOWER 넘겨 줌 (ATC-565)

[control-recycle.md](control-recycle.md) 6절의 한국어 요약이다.

2026-10-06(DUTY REVIEW R-0049) TOWER는 overdue CLEARANCE 8건 때문에 CAP 500k에 706–767k로 여섯 시간 넘게 재시작하지 못했고, OCC는 job이 SUPERVISOR를 기다리는 `blocked`라 700k 가까이에 머물렀다. 기다림 알림은 "overdue CLEARANCE 8건"과 "턴 사이가 아님(job blocked/blocked)"만 말했다.

**8건이 overdue였던 까닭**(2026-10-07 `GET /api/controller/brief`로만 읽음, 상태 파일은 열지 않음): 8건(C-1069, C-1070, C-1072, C-1074, C-1075, C-1077, C-1078, C-1080) 모두 `dead`인 DUTY 세션 `951f27c2`에게, STAND `duty-control-plane`으로, 2026-10-06 04:15Z에 머지된 PR #587에 대해 나갔다. FLIGHT가 없어 CLEARANCE MOOT(ATC-515, FLIGHT로 고른다)가 고르지 못하고, 받을 세션이 없어 답이 올 수 없으며, 셋(C-1072, C-1074, C-1078)은 TOWER의 RESEND가 새 CLEARANCE로 나가 다시 overdue가 된 것이다. 이런 CLEARANCE를 닫는 일은 이 변경에 없다. 뒤에 ATC-567이 `undeliverable`(`addressee ended`)로 닫는다([alerting.ko.md](alerting.ko.md) "받는 세션이 끝난 CLEARANCE").

- **2.3 항목 3(RESEND 쪽)은 지어져 있지 않았고, 이제 지었다.** 전에는 서버가 `at`과 `standbyAt`만 남겼다: TOWER의 RESEND는 글이 `RESEND`로 시작하는 새 CLEARANCE이고 무엇을 다시 보낸 것인지 잇는 것이 없었다. 이제 `resendLinksOf`(`server/clearance-resend.ts`, 순수)가 기록만으로 잇는다: 글이 `RESEND`로 시작하는 CLEARANCE는 받는 세션·종류·STAND·FLIGHT·PR 번호(ATC-554의 `prNumbersOf`)가 같고 먼저 나간 RESEND 아닌 CLEARANCE 가운데 아직 RESEND가 없는 가장 늦은 것(없으면 가장 늦은 것, 두 번째 RESEND)의 RESEND다. 새 op·새 파일·`atcctl` 명령이 없고 읽을 때마다 이으므로 이미 `clearances.jsonl`에 있는 것에도 맞는다. 고리 안 하나가 답(READBACK·ROGER·UNABLE, 취소는 답이 아니다)을 받으면 나머지는 그것을 `answeredVia`로 갖는다. 항목 3의 FUEL "이미 보고함" key는 여전히 짓지 않았다.
- **TOWER brief.** 고리에 든 `clearances.pending[]` 항목에 `resendOf`·`resentBy`·`answeredVia`가 붙고(고리 밖은 오늘과 같은 모양), `clearances.overdue`는 `answeredVia`인 것을 뺀다. 새 TOWER가 두 번째 RESEND와 "답 없음" 보고를 기록에서 가리는 근거다. TOWER 매뉴얼은 아직 이 칸을 읽지 않는다(아래).
- **기다림이 막는 것의 이름을 댄다.** TOWER: `overdue CLEARANCE 8건: C-1069→951f27c2(RESEND함), … 외 3건`(id와 받는 세션, 다섯까지). 턴 사이가 아니면 job이 `blocked`일 때 `턴 사이가 아님 — SUPERVISOR를 기다림(job blocked/blocked): <needs>`, 아니면 `턴 사이가 아님(job working/active, 턴 도중)`. OCC: 막는 것마다 앞에 종류(`FLIGHT PLAN`, `RECALL`, `FLIGHT PLAN READBACK`, `기록하지 않은 CAPTAIN 보고`, `CHARTER REQUEST 진행 중`). `recycle|wait` 알림, shadow의 `would-wait`, APPLY NOW, CONTROL BULK가 모두 같은 글을 쓴다.
- **TOWER 넘겨 줌.** 스위치가 켜져 있으면 overdue CLEARANCE가 TOWER 재시작을 막지 않는다. 결정은 `carry`(넘기는 id)를 돌려주고 사유에 `overdue CLEARANCE n건을 새 세션에 넘김`, `control` `recycle` 기록에 `carried: [id]`가 남는다. 다른 막는 것(문턱을 넘는 이벤트, RTS, 턴 도중, cooldown)은 그대로다. APPLY NOW·CONTROL BULK도 같은 안전 조건이라 overdue로 막히지 않는다(`carried`는 남기지 않는다).
- **스위치.** 설정 창 OPERATIONS, CONTROL RECYCLE 블록의 TOWER CARRY-OVER 줄(`control-recycle-carry.json`의 `controlRecycleCarry`). 기본 `on`, `off`는 이 변경 전(overdue가 하나라도 있으면 기다림). SUPERVISOR만(이 화면 Origin), atcctl 명령 없음. 바꾸면 `policy control-recycle-carry-mode` 한 줄. 선언이 `server/switches/`에 있어 `user` 등급이다.
- **오작동 수.** `carryCounterOf`(`server/recycle-carry.ts`, 순수)를 줄 아래에 보이고, 읽을 때마다 FLIGHT RECORDER의 `carried`가 있는 `recycle` 줄과 `clearances.jsonl`에서 센다(새 기록 없음). 최근 30일의 TOWER 재시작마다, 넘긴 고리마다, 다음 TOWER 재시작 전까지: **중복** = 재시작 전에 이미 RESEND가 있었는데 새 세션이 또 보냄(또는 새 세션이 두 번 보냄), **놓침** = RESEND가 없던 고리에 재시작 뒤 30분(`LOST_AFTER_MS`)이 지나도 RESEND·답·취소가 없음. 하나라도 있는 재시작이 오작동 하나다. "답 없음" 보고는 ATC LOG(대화)에만 있어 atc가 보지 못하므로 빠진 보고는 세지 않는다. 건강 코드가 있는 AIRCRAFT(매뉴얼이 재송신하지 않게 함)의 고리는 놓침으로 셀 수 있다.
- **CAP을 넘긴 채 SUPERVISOR를 기다리는 세션: HOME 카드 하나.** `capBlockedOf`(순수): CAP을 넘은 관제 세션의 job이 `waitAlertMin`(60분) 넘게 `blocked`이면 CAUTION `recycle|blocked|<세션>` 하나(HOME 할 일의 ALERT 줄): `CONTROL RECYCLE — OCC 컨텍스트 694k > CAP 500k, 104분째 SUPERVISOR를 기다리며 blocked라 재시작할 수 없음: <needs>`와, `wait`이면 그 밖에 막는 것. 시각은 job 기록의 `blocked` 시작이라 서버를 다시 띄워도 이어지고, 모드나 `auto`와 상관없이 뜬다. 그 세션의 `recycle|wait`·`recycle|over`는 내지 않는다(카드 하나). 답하거나, 재시작하거나, CAP 밑이 되면 사라진다. 큐 계약 줄 `recycle|blocked`(`server/queue-contract.ts`). ATC-352의 `CONTROL-BLOCKED` RULE BREACH 경고는 그대로다. 막힘 자체를 없애는 것은 ATC-549다.
- **남은 것(매뉴얼 한 줄).** TOWER 매뉴얼의 NO READBACK 줄(`controller/CLAUDE.md`, `CLAUDE.en.md`)은 아직 `resentBy`·`resendOf`·`answeredVia`를 읽지 않는다. 이 줄은 K 효과라 DUTY에 맡긴다.

# 관제 세션을 `/loop` 대신 일이 생길 때 깨움 (ATC-557 a)

TOWER·OCC·MCC는 `/loop` 없이 쉬는 백그라운드 세션이 되고, 판단할 일이 생기면 atc 서버가 그 세션에 글 하나를 써서 깨운다. ATC-557의 첫 부분이다(서버가 짓는 CLEARANCE, 빠진 관제 세션 다시 띄우기, REVIEW 깨움, 하루 한 번 검토 턴은 뒤 PR).

- **스위치(역할마다, 기본 `wake`).** `control-wake.json`의 `roles.tower|occ|mcc`: `loop`(전과 같음) · `wake`. 설정 창 OPERATIONS의 CONTROL WAKE 블록, SUPERVISOR만(이 화면 Origin), atcctl 명령 없음. 값이 없으면 `wake`, 있는데 모르는 값이면 `loop`. 바꾸면 `policy control-wake-mode` 한 줄.
- **사건.** 30초(TOWER)·1분(OCC)·2분(MCC)마다 그 역할의 `/tick`이 읽는 브리핑을 같은 함수(`gatherInputs`)로 읽고, `/tick`이 할 일로 보는 것(`actionable`)을 항목 하나하나(안정한 key)로 나눈다. 새 사건, 두 번째 침묵, 리뷰 지적(FIX·INSPECTION), 메뉴 밖 일(모르는 사건·읽지 못한 브리핑)이 모두 여기 든다. UNABLE과 CAPTAIN의 질문은 팀 글이 이름으로 와서 세션을 깨운다(전과 같다).
- **새 사건마다 글 하나.** 한꺼번에 생긴 일은 한 깨움에, 역할마다 1분에 한 번까지, 앞 깨움의 결과가 없으면(20분까지) 기다린다. 같은 사건은 한 번 싣고, 깨운 뒤 30분 넘게 열리면 "아직 열림"으로 한 번만 더 싣는다.
- **글.** `[ATC WAKE W-0001] TOWER`, 새 일·아직 열린 일·지난 깨움 뒤 풀린 일·관련 FLIGHT, 그리고 할 일 셋: `atcctl tick <역할> --wake W-0001`로 `/tick`, ATC에게 답하지 않기, 마지막 줄 `WAKE RESULT: acted` 또는 `WAKE RESULT: nothing`. 영어, 8000자까지.
- **같은 writer, 자기 검사.** `checkControlWake`(`server/send-checks.ts`)가 FLIGHT PLAN과 같은 `CheckedSend`를 만들고(`kind: "control-wake"`), 세션 소켓에 쓰는 곳은 여전히 `deliverChecked` 하나다. 운영 서버만 쓴다.
- **BREAKER 범위.** ATC-562의 BREAKER가 범위를 받는다: 팀 FLIGHT PLAN 하나, 관제 역할마다 하나. 바쁜 관제 세션이 제때 보이지 않아도 팀에 가는 FLIGHT PLAN은 멈추지 않는다.
- **깨움이 멈추면.** `--wake` 없는 `/tick`(옛 `/loop`)은 스위치 wake, 깨움 job이 3분 안에 돎, 그 역할 BREAKER 켜짐일 때만 `TICK WAKE-MODE`로 끝난다. 아니면 전처럼 일한다.
- **TOWER cursor.** ATC LOG에만 적는 사건뿐이고 깨울 일이 없으면, 세션이 쉬고 열린 깨움이 없을 때 서버가 ack한다(조용한 tick이 하던 일). 쌓여서 CONTROL RECYCLE을 막지 않게.
- **`/loop`에서 옮기기.** 서버는 돌고 있는 `/loop`를 끌 수 없다. `launchControl`이 스위치로 첫 메시지를 고르고(wake: `[ATC WAKE BOOT] <역할>`, loop: `/loop <n>m /tick`) `control launch` 줄에 `wake`를 적는다. 스위치와 다른 모드로 뜬 세션(이 변경 전 LAUNCH는 loop로 본다)은 운영 서버가 CONTROL RECYCLE과 같은 잠금·STOP → 확인 → LAUNCH(같은 ACCOUNT)로 한 번 다시 띄운다: CONTROL RECYCLE `mode`가 off가 아니고 그 세션의 `auto`가 켜짐, 턴 사이, `safeBlocksOf`가 비었음(RTS 없음 포함), 서버가 뜬 지 5분, 3시간 안에 시도 없음, 다른 재시작 없음. 그때까지 옛 세션의 `/tick`은 `TICK WAKE-MODE`로 끝나고 깨움은 이미 받는다. 스위치를 `loop`로 되돌리면 같은 길로 `/loop`를 건 세션으로 옮긴다.
- **컨텍스트 한도.** CONTROL RECYCLE의 CAP 그대로(지금 운영 TOWER 500k·OCC 500k·MCC 150k). 새 CAP 설정은 없다: 깨움 하나가 시간당 `/loop` 턴 20번(TOWER)~6번(OCC)을 대신해 컨텍스트가 시계가 아니라 한 일만큼 자란다. 한 주 뒤 숫자로 CAP을 낮출지 본다.
- **오작동 수**(설정 블록, 7일, 역할마다): 깨우지 못함(판단할 일이 15분 열렸는데 어느 깨움에도 실리지 않음), 서버가 할 수 있던 일로 깨움(실린 일이 모두 메뉴: LAND·INFO·GO AROUND·FIX 보내기, RELAY, 첫 RESEND, FLIGHT PLAN·RECALL·CREW CHANGE 보내기, SCHEDULE 발부, MCC LAND·RTS), 할 일 없이 깨움(`WAKE RESULT: nothing`). 깨움·일함·결과 모름·실패·막음·안 보임·BREAKER 멈춤·다시 띄움도.
- **FLIGHT RECORDER.** 깨움마다 `control-wake deliver` 줄에 입력 전체(사건 key·종류·메뉴, 새·열림·풀림, FLIGHT, 글과 해시, 세션·pid·msg_id). 이어서 `confirm`·`result`·`pickup`·`failed`·`refused`·`missed`·`breaker`·`transition`·`ack`.
- **이 PR에 없는 것.** `fresh` 모드, 하루 한 번 검토 턴, REVIEW·CROSSCHECK 깨움, 서버가 짓는 CLEARANCE, 빠진 역할 다시 띄우기, 판단 로직(ATC-558).
