---
name: tick
description: OCC 한 바퀴 — 규정이 바뀌었는지 확인하고, 메모 없는 배정 제안을 FLIGHT 본문으로 검토해 메모·CAUTION을 달고, approval 모드면 승인된 제안을 FLIGHT PLAN으로, 승인된 CREW CHANGE를 그 AIRCRAFT에 보내고 READBACK을 기록한다. 분류·우선순위 없는 FLIGHT와 PR이 머지됐는데 열린 FLIGHT에 SCHEDULE 초안(CLASSIFY·PRIORITIZE·CLOSE, 그림자 운용)을 쓴다. `/loop 10m /tick`으로 돌린다.
---

# OCC 한 바퀴

**한국어** · [English](SKILL.en.md)

절차 파일(`.claude/skills/tick/*.md`, `CLAUDE.md`의 "절차 파일")은 그 단계에 할 일이 있을 때만 Read한다. 할 일이 없으면 열지 않는다.

0. `node ../controller/atcctl.mjs manual check`. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `node ../controller/atcctl.mjs manual ack`한 뒤, 다시 읽은 규정대로 진행한다. 전에 읽은 절차 파일도 그 단계에서 다시 Read한다.
1. 이번 바퀴 전에 CAPTAIN에게서 온 답장이 있으면 먼저 처리한다. PR·리뷰·완료 보고가 있으면 `.claude/skills/tick/following.md`를 Read하고 "팀 보고나 SUPERVISOR 요청이 왔을 때"대로 `gh`로 확인한다. FLIGHT PLAN·RECALL 답장이 있으면 `flight-plan.md`, CREW CHANGE 답장이 있으면 `crew-change.md`를 Read한다. FLIGHT PLAN 답장 중 "READBACK D-xxxx"는 `node ../controller/atcctl.mjs dispatch readback D-xxxx`, 사유를 든 거절은 `dispatch decline D-xxxx -- <사유>`. RECALL 답장 "READBACK D-xxxx RECALL"은 `dispatch recalled D-xxxx`. STAND 없는 FLIGHT(SURVEY·CHECK)를 마쳤다는 보고는 `dispatch arrived D-xxxx -- '<결과 링크나 한 줄>'`. CREW CHANGE 답장 "READBACK CC-xxxx"(또는 READBACK 없이 온 "… CREW CHANGE CC-xxxx COMPLETE")는 `crew-change readback CC-xxxx`.
2. `node ../controller/atcctl.mjs dispatch brief`를 실행하고 `mode`를 본다.
3. `open` 중 `note`가 없는 제안, 그리고 `open`·`held` 중 `briefing`이 없는 제안마다:
   - `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`로 본문과 댓글을 읽는다.
   - CLAUDE.md의 검토 기준에 따라 `node ../controller/atcctl.mjs dispatch note <ID> [--caution] [--hold [<FLIGHT>]] -- <메모>`. 본문에만 적힌 선행 작업이나 사람 결정 대기는 메모로 끝내지 말고 `--hold`를 건다. 본문·댓글에 "사용자가 정한다"·"사용자 지시를 기다린다"·"user decides" 같은 문구가 있으면 AIRCRAFT와 상관없이 선행 없는 `--hold`(CLAUDE.md "사용자가 정한다" 문구).
   - `briefing`이 없으면 `.claude/skills/tick/briefing.md`를 Read하고 그대로 `node ../controller/atcctl.mjs dispatch briefing <ID> --what '<무슨 일>' --why '<왜 이 AIRCRAFT>' --risk '<걸리는 점>'`. 쉬운 한국어로 한 줄에 한 문장씩 쓰고, `briefs.<ID>.facts`의 숫자를 되풀이하지 않는다. HOLD를 걸었으면 걸리는 점에 그 이유를 쓴다.
4. `mode`가 `approval`이면, `inFlight`에 approved·recalling이 있거나 `overdue`가 있을 때 `.claude/skills/tick/flight-plan.md`를 Read하고 "FLIGHT PLAN 전달"을 따른다: `inFlight`의 approved → `dispatch release` → 출력 문구를 그대로 SendMessage, `inFlight`의 recalling → `dispatch recall-send` → RECALL 문구를 그대로 SendMessage, `overdue` 처리. 이어서 `node ../controller/atcctl.mjs crew-change brief`를 실행하고, `approved`나 `overdue`가 있으면 `.claude/skills/tick/crew-change.md`를 Read하고 "CREW CHANGE 발부"를 따른다: `approved` → `crew-change send <CC-xxxx>` → 출력 문구를 그 AIRCRAFT에 그대로 SendMessage, `waiting`은 보내지 않고, `overdue`는 같은 문구를 한 번만 다시 보낸 뒤 그래도 없으면 SUPERVISOR 보고. 승인은 SUPERVISOR만 한다. `shadow`면 이 단계를 건너뛴다.
5. SCHEDULE 초안(S1, 그림자 운용):
   - `node ../controller/atcctl.mjs schedule brief`를 실행한다. `candidates`나 `waypointGaps`에 할 일이 있으면 `.claude/skills/tick/schedule.md`를 Read하고 "SCHEDULE 초안"을 따른다. 없으면 아래 WAYPOINT 지연만 보고 6단계로 간다.
   - `candidates`와 `examples`(SUPERVISOR의 최근 판정과 거절 사유)를 본다. 거절 사유와 같은 실수를 되풀이하지 않는다.
   - CLASSIFY 후보가 있으면 먼저 `../docs/fleet.md`를 Read로 읽는다(4.1 FLIGHT TYPE, 4.2 WAKE, 4.3 TYPE RATING). FLIGHT TYPE은 `schedule.md` "CLASSIFY 전에"의 순서로 정하고(BUILD는 사용자가 보는 동작이 바뀔 때만), 근거에 적용한 절 번호를 인용한다.
   - 후보 FLIGHT 3개까지 `dispatch flight <FLIGHT key>`로 읽는다. `candidates.classify`에 있으면 `schedule draft CLASSIFY <FLIGHT> [--type …] [--wake …] [--rating …] -- "<근거>"`. `candidates.prioritize`에 있고 본문·댓글에 근거가 있으면 `schedule draft PRIORITIZE <FLIGHT> --priority <1-4> -- "<근거>"`. 근거가 없으면 PRIORITIZE는 건너뛴다.
   - `candidates.close`에 있으면 `schedule.md` "CLOSE 전에"대로 `close.<FLIGHT>`의 PR을 읽기 전용 `gh pr view`로 확인하고 `schedule draft CLOSE <FLIGHT> -- "<PR·머지 시각·Fixes 여부>"`. `Fixes`가 없고 완료 기준이 남아 보이면 쓰지 않는다. 한 바퀴 3개 상한과 열린 초안 5건 한도에 함께 든다.
   - `LIMIT`이 나오면 이번 바퀴는 초안을 그만 쓴다. Linear에는 쓰지 않는다.
   - 열린 `NEW`(CHARTER DESK의 AD HOC FLIGHT) 초안도 한도 5건에 든다. CHARTER REQUEST는 바퀴마다 할 일이 아니다 — SUPERVISOR가 이 세션에서 요청할 때 `schedule.md`를 Read하고 "CHARTER DESK"대로 한다.
   - WAYPOINT 지연: `slips`에 `fresh: true`인 경고가 있으면 그 경고만 하나에 한 줄(`text`)로 OCC LOG에 적고 SUPERVISOR에게 보고한 뒤 `node ../controller/atcctl.mjs schedule slip-ack`. 이미 보고한 것(`fresh: false`)은 다시 보고하지 않는다. `slips`가 `null`이면 마일스톤을 못 읽은 것이니 건너뛴다. 팀에 메시지를 보내지 않고, 지연 때문에 초안을 쓰지 않는다.
   - TARGET·ROUTE: `open`·`recent`에 24시간 안에 쓴 `TARGET`·`ROUTE` 초안이 없으면 `schedule.md`를 Read하고(아직 안 읽었으면) "TARGET·ROUTE 초안"대로 `atcctl network`를 읽는다. 근거가 분명할 때만 **한 바퀴 1건**. 그림자 판정만 받고 FLEET에는 아무도 쓰지 않는다.
   - WAYPOINT gap: `schedule.md` "WAYPOINT gap"대로 `waypointGaps`에서 덮는 이슈가 없는 완료 기준을 찾아 `schedule draft NEW --gap --project <ROUTE> --milestone <WAYPOINT> …`로 올린다. **한 바퀴 2건까지**, 지금 구간 WAYPOINT부터. 본문 `## 목표`에 기준을 `> `로 인용한다. 사람이 정할 기준, 비슷한 FLIGHT가 있다고 거절된 것, `truncated`인 WAYPOINT는 건너뛰고 OCC LOG에 적는다. 열린 초안 5건 한도에 함께 든다.
6. `schedule brief`의 `mode`가 `approval`(S2)이고 `inProgress`에 approved·released가 있으면 `.claude/skills/tick/schedule.md`의 "SCHEDULE 발부"를 따른다(5단계에서 읽지 않았으면 Read): `inProgress`의 approved마다(CLOSE는 빼고 — 발부되지 않는다) `schedule release <S-xxxx>` → 출력의 CALL마다 그 Linear 도구에 JSON 입력을 그대로. linear-guard가 막거나 Linear 오류면 다시 시도하지 말고 SUPERVISOR 보고. `shadow`면 건너뛴다.
7. 운항 추적: `node ../controller/atcctl.mjs following`을 실행한다. `fresh: true`인 문제가 있으면 `.claude/skills/tick/following.md`를 Read하고(code의 뜻과 보고 대상), 그 문제만 하나에 한 줄로 OCC LOG에 적고, `severity: "warn"`이면 SUPERVISOR에게 보고한다. 그다음 `node ../controller/atcctl.mjs following ack`. 이미 보고한 것(`fresh: false`)은 다시 보고하지 않고, 팀에 메시지를 보내지 않는다.
8. OCC LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

판정(승인·거절)은 하지 않는다. send-guard가 막으면 다시 시도하지 말고 SUPERVISOR에게 보고한다.
