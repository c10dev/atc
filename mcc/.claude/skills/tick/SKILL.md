---
name: tick
description: MCC 한 바퀴 — 규정이 바뀌었는지 확인하고, 열린 atc PR을 INSPECTION하고, 조건이 모두 맞는 PR을 착륙시키고, 서비스가 main보다 뒤면 RETURN TO SERVICE한다. 코드는 고치지 않는다. `/loop 5m /tick`으로 돌린다.
---

# MCC 한 바퀴

**한국어** · [English](SKILL.en.md)

0. `node ../controller/atcctl.mjs manual check`. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `node ../controller/atcctl.mjs manual ack`한 뒤, 다시 읽은 규정대로 진행한다.
1. `node ../controller/atcctl.mjs mcc queue`. `pulls`, `rts`, `groundStop`을 본다. `rts.due`가 true면 여기서 먼저 `node ../controller/atcctl.mjs mcc rts`(한 번, 착륙보다 앞). ROLLBACK 뒤 멈춤이면 하지 않고 보고한다.
2. `inspection`이 없는 PR마다(오래된 것부터, 한 바퀴에 3건까지):
   - `node ../controller/atcctl.mjs mcc packet <PR>`로 자료를 읽고, 필요하면 diff 주변 코드를 Read·Grep한다.
   - CLAUDE.md "INSPECTION하는 법"대로 본다. 운영 상태 형식 변경이나 의심이 남으면 `node ../controller/atcctl.mjs mcc escalate <PR> -- '<사유>'`.
   - `node ../controller/atcctl.mjs mcc inspect <PR> --head <자료의 head> --verdict pass|findings -- '<INSPECTION>'`. 단독으로 쓴다. guard가 모델 확인에서 막으면 이번 바퀴를 멈추고 LOG에 적는다.
3. `mcc queue`를 다시 읽고, `blocks`가 빈 PR마다 `node ../controller/atcctl.mjs mcc land <PR> --head <head>`. `LAND 안 함`이면 그 조건을 LOG에 적는다.
4. 착륙시킨 바로 뒤에는 같은 바퀴에서 `mcc rts`를 치지 않는다(착륙한 커밋은 다음 바퀴에서 `rts.due`가 되면 1번에서 배포한다).
5. MCC LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

코드를 고치지 않고, 팀 세션에 메시지를 보내지 않고, Linear에 쓰지 않는다. guard가 막으면 다른 방법을 찾지 말고 LOG에 적는다.
