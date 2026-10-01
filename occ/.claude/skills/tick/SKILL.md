---
name: tick
description: OCC 한 바퀴. `atcctl tick occ`로 규정 확인과 브리핑을 한 번에 읽고, 할 일이 있는 단계의 절차 파일만 Read한다. `/loop 10m /tick`.
---

# OCC 한 바퀴

**한국어** · [English](SKILL.en.md)

0. `[TEAM_X → OCC] ARRIVED …`가 와 있으면 **읽는 즉시, 다른 어떤 단계·`gh`보다 먼저** `dispatch report <D-xxxx|ATC-n> --pr <n>|--result <링크> --tier <t> --tests <통과/전체|n/a> --discretion <수> --blocked <none|막힌 점>`(고정 줄만, 직접 배정도 같다). 그다음 `node ../controller/atcctl.mjs tick occ`(규정 확인과 브리핑을 이미 한다. 따로 부르지 않는다). `TICK QUIET`면 1단계 답장만 하고 8단계로. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `manual ack`(전에 읽은 절차 파일도 그 단계에서 다시 Read). `TICK ACT`는 이유와 브리핑이 따른다.
1. 팀 답장 먼저. FLIGHT PLAN·RECALL 답은 `flight-plan.md`, CREW CHANGE 답은 `crew-change.md`, PR·리뷰 보고는 `following.md`.
2. `dispatch brief`의 `arrivalCandidates`·`arrivalMissing`: `flight-plan.md`.
3. `note`·`briefing` 없는 SETTLED 제안: `CLAUDE.md` "검토 기준"대로 `dispatch flight`를 읽고 `dispatch note`. BRIEFING은 `briefing.md`.
4. approval이면 `inFlight`·`overdue`는 `flight-plan.md`, `crew-change brief`는 `crew-change.md`.
5. `schedule brief`의 후보·`waypointGaps`·`slips`·`routesWithoutWaypoints`, 24시간 안에 TARGET·ROUTE 초안이 없을 때: `schedule.md`.
6. S2 `inProgress`의 approved: `schedule.md` "SCHEDULE 발부".
7. `following`의 `fresh: true`: `following.md`.
8. OCC LOG는 `CLAUDE.md`대로.
