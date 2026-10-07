---
name: tick
description: OCC 한 바퀴. `atcctl tick occ`로 규정 확인과 브리핑을 한 번에 읽고, 할 일이 있는 단계의 절차 파일만 Read한다. 깨움 모드(기본)에서는 서버의 `[ATC WAKE …]` 글이, `/loop` 모드에서는 `/loop 10m /tick`이 부른다.
---

# OCC 한 바퀴

**한국어** · [English](SKILL.en.md)

## 두 가지 모드 (CONTROL WAKE, ATC-557)

SUPERVISOR가 설정 창 CONTROL WAKE OCC로 고른다. 어느 모드인지는 첫 프롬프트와 `node ../controller/atcctl.mjs tick occ`의 출력이 알려 준다.

- **깨움 모드(`wake`, 기본).** `/loop`가 없다. atc 서버가 판단할 일을 보면 `[ATC WAKE W-xxxx] OCC` 글 하나로 깨운다(새 일, 아직 열린 일, 지난 깨움 뒤 풀린 일, 관련 FLIGHT). 처음 뜰 때는 `[ATC WAKE BOOT] OCC`가 온다.
  - 그 글을 받으면 0단계를 `node ../controller/atcctl.mjs tick occ --wake W-xxxx`(BOOT는 `--wake boot`)로 하고 아래 단계를 그대로 한다. 글에 적힌 일만 보지 않고 출력 전체를 본다.
  - ATC에게 답하지 않는다(세션이 아니라 서버다). 턴의 마지막 줄은 `WAKE RESULT: acted`(무엇이든 내거나 기록하거나 보내거나 보고함) 또는 `WAKE RESULT: nothing`(할 일이 없었음) 하나다. atc가 이 줄로 오작동을 센다.
  - 팀의 답(READBACK·UNABLE·질문 …)은 전처럼 세션 이름으로 와서 이 세션을 깨운다. 1단계대로 기록·보고하고 턴을 끝낸다. 그 밖의 일은 서버가 따로 깨운다.
  - `/loop`가 남은 세션의 `/tick`에서 0단계가 `TICK WAKE-MODE occ — …`를 찍으면 아무것도 하지 않고 곧장 턴을 끝낸다(OCC LOG 줄도 없다). atc가 안전한 순간에 이 세션을 `/loop` 없이 한 번 다시 띄운다.
  - 글의 둘째 줄이 `Daily review turn (ATC-557)`이면 하루 한 번 점검 턴이다(매일 01:15Z, CLAUDE.md "깨우는 방식"): 0단계부터 그대로 한 뒤, 글이 말하는 대로 지난 24시간을 돌아보고 CLAUDE.md대로 적는다. 마지막 줄은 같은 `WAKE RESULT`다.
- **`/loop` 모드(`loop`).** 오늘처럼 `/loop 10m /tick`으로 돈다. 0단계는 `--wake` 없이 `node ../controller/atcctl.mjs tick occ`이다. 깨움 job이 멈췄거나 깨움 BREAKER가 멈추면 깨움 모드여도 `/tick`이 이렇게 일한다(`TICK WAKE-MODE`가 나오지 않는다). BREAKER가 멈추면 atc가 이 세션을 `/loop`로 한 번 다시 띄우고, 다시 켜지면 깨움 모드로 돌린다.

0. `[TEAM_X → OCC] ARRIVED …`가 와 있으면 **읽는 즉시, 다른 어떤 단계·`gh`보다 먼저** `dispatch report <D-xxxx|ATC-n> --pr <n>|--result <링크> --tier <t> --tests <통과/전체|n/a> --discretion <수> --blocked <none|막힌 점>`(고정 줄만, 직접 배정도 같다). 그다음 `node ../controller/atcctl.mjs tick occ`(규정 확인과 브리핑을 이미 한다. 따로 부르지 않는다). `TICK QUIET`면 1단계 답장만 하고 8단계로. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `manual ack`(전에 읽은 절차 파일도 그 단계에서 다시 Read). `TICK ACT`는 이유와 브리핑이 따른다.
1. 팀 답장 먼저. FLIGHT PLAN·RECALL 답은 `flight-plan.md`(UNABLE·질문·두 번째 침묵은 그 파일의 "예외 판정", ATC-558), CREW CHANGE 답은 `crew-change.md`, PR·리뷰 보고는 `following.md`.
2. `dispatch brief`의 `arrivalCandidates`·`arrivalMissing`: `flight-plan.md`.
3. `note`·`briefing` 없는 SETTLED 제안: `CLAUDE.md` "검토 기준"대로 `dispatch flight`를 읽고 `dispatch note`. BRIEFING은 `briefing.md`.
4. approval이면 `inFlight`·`overdue`는 `flight-plan.md`, `crew-change brief`는 `crew-change.md`.
5. `schedule brief`의 후보·`waypointGaps`·`slips`·`routesWithoutWaypoints`, 24시간 안에 TARGET·ROUTE 초안이 없을 때: `schedule.md`.
6. S2 `inProgress`의 approved: `schedule.md` "SCHEDULE 발부".
7. `following`의 `fresh: true`: `following.md`.
8. OCC LOG는 `CLAUDE.md`대로.
