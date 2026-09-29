### 변경
- 2b 켜기 점검표에서 vocado만 있던 READBACK 항목이 `candidateTeams`가 배정할 수 있는 AIRPORT마다 하나씩(`readback-*`, `server/readiness.ts`의 `airportReadbackOf`)으로 바뀌었다. `teamAirports`·`projectAirports`로 대상을 계산하고, vocado는 그대로 `ATC_VOCADO_CLAUDE_MD`(없으면 `<projectsDir>/vocado_nextjs/CLAUDE.md`)를 읽고, atc 자신의 AIRPORT는 늘 이 저장소의 루트 `CLAUDE.md`를, 다른 AIRPORT는 AIRPORT 등록부의 `CLAUDE.md`를 읽는다(ATC-75).

### 문서
- 루트 `CLAUDE.md`/`CLAUDE.en.md`의 "교신" 절과 `.claude/skills/atc-task/SKILL.md`에 vocado 팀과 같은 2b 메시지 규칙을 적었다: OCC의 `[DISPATCH D-xxxx]` FLIGHT PLAN에는 `READBACK D-xxxx`(또는 사유)로, `RECALL`에는 `READBACK D-xxxx RECALL`로, `[OCC CC-xxxx]` CREW CHANGE에는 `READBACK CC-xxxx`로 답하고, STAND 없는 SURVEY·CHECK를 마치면 OCC에 알린다. ENGINEERING이나 사용자의 직접 지시는 그대로 `READBACK ATC-n`으로 답하고, 최종 보고는 일을 맡긴 세션에 보낸다(ATC-75).
