---
name: tick
description: MCC 한 바퀴 — 규정이 바뀌었는지 확인하고, 열린 atc PR을 INSPECTION하고, 조건이 모두 맞는 PR을 착륙시키고, 서비스가 main보다 뒤면 RETURN TO SERVICE한다. 코드는 고치지 않는다. 깨움 모드(기본)에서는 서버의 `[ATC WAKE …]` 글이, `/loop` 모드에서는 `/loop 5m /tick`이 부른다.
---

# MCC 한 바퀴

**한국어** · [English](SKILL.en.md)

## 두 가지 모드 (CONTROL WAKE, ATC-557)

SUPERVISOR가 설정 창 CONTROL WAKE MCC로 고른다. 어느 모드인지는 첫 프롬프트와 `node ../controller/atcctl.mjs tick mcc`의 출력이 알려 준다.

- **깨움 모드(`wake`, 기본).** `/loop`가 없다. atc 서버가 판단할 일을 보면 `[ATC WAKE W-xxxx] MCC` 글 하나로 깨운다(새 일, 아직 열린 일, 지난 깨움 뒤 풀린 일, 관련 FLIGHT). 처음 뜰 때는 `[ATC WAKE BOOT] MCC`가 온다.
  - 그 글을 받으면 0단계를 `node ../controller/atcctl.mjs tick mcc --wake W-xxxx`(BOOT는 `--wake boot`)로 하고 아래 단계를 그대로 한다. 글에 적힌 일만 보지 않고 출력 전체를 본다.
  - ATC에게 답하지 않는다(세션이 아니라 서버다). 턴의 마지막 줄은 `WAKE RESULT: acted`(무엇이든 내거나 기록하거나 보내거나 보고함) 또는 `WAKE RESULT: nothing`(할 일이 없었음) 하나다. atc가 이 줄로 오작동을 센다.
  - `/loop`가 남은 세션의 `/tick`에서 0단계가 `TICK WAKE-MODE mcc — …`를 찍으면 아무것도 하지 않고 곧장 턴을 끝낸다(MCC LOG 줄도 없다). atc가 안전한 순간에 이 세션을 `/loop` 없이 한 번 다시 띄운다.
- **`/loop` 모드(`loop`).** 오늘처럼 `/loop 5m /tick`으로 돈다. 0단계는 `--wake` 없이 `node ../controller/atcctl.mjs tick mcc`이다. 깨움 job이 멈췄거나 깨움 BREAKER가 멈추면 깨움 모드여도 `/tick`이 이렇게 일한다(`TICK WAKE-MODE`가 나오지 않는다). BREAKER가 멈추면 atc가 이 세션을 `/loop`로 한 번 다시 띄우고, 다시 켜지면 깨움 모드로 돌린다.

0. `node ../controller/atcctl.mjs tick mcc`(`manual check`를 이미 한다. 따로 부르지 않는다, ATC-553). `TICK QUIET mcc`면 할 일이 없다: 아래 5단계(LOG)로 간다. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `node ../controller/atcctl.mjs manual ack`한 뒤, 다시 읽은 규정대로 진행한다. `TICK ACT mcc`면 1단계로.
1. `node ../controller/atcctl.mjs mcc queue`. `pulls`, `rts`, `groundStop`을 본다. `rts.due`가 true면 여기서 먼저 `node ../controller/atcctl.mjs mcc rts`(한 번, 착륙보다 앞). ROLLBACK 뒤 멈춤이면 하지 않고 보고한다.
2. `inspection`이 없는 PR마다(오래된 것부터, 한 바퀴에 3건까지):
   - Agent `subagent_type: inspector`를 부른다. 프롬프트는 `PR <번호>, head <queue의 head>`. 여러 PR이면 한 번에 부른다. **packet·diff를 이 세션에서 읽지 않는다**(`mcc packet`, `gh pr diff`, diff 주변 코드 모두). 기준은 CLAUDE.md "INSPECTION하는 법".
   - 답의 `VERDICT: escalate`(또는 `ESCALATE:`가 `none`이 아님)면 `node ../controller/atcctl.mjs mcc escalate <PR> -- '<ESCALATE 사유>'`. 답의 `COUNTS`에 P0나 P1이 있으면 이어서 같은 head에 `mcc inspect <PR> --head <답의 HEAD> --verdict findings -- '<TEXT>'`도 남긴다(P0·P1이 없으면 ESCALATE만으로 그 head를 본 것으로 센다, ATC-390).
   - 아니면 `node ../controller/atcctl.mjs mcc inspect <PR> --head <답의 HEAD> --verdict <VERDICT> -- '<TEXT>'`. 단독으로 쓴다. `HEAD`가 queue의 head와 다르면 기록하지 않고 다음 바퀴에 다시 부른다. guard가 모델 확인에서 막으면 이번 바퀴를 멈추고 LOG에 적는다.
   - 답이 블록 모양이 아니거나 inspector가 실패하면 한 번 다시 부르고, 안 되면 LOG에 적고 넘어간다(직접 읽어 대신하지 않는다).
3. `mcc queue`를 다시 읽고, `blocks`가 빈 PR마다 `node ../controller/atcctl.mjs mcc land <PR> --head <head>`. `LAND 안 함`이면 그 조건을 LOG에 적는다.
4. 착륙시킨 바로 뒤에는 같은 바퀴에서 `mcc rts`를 치지 않는다(착륙한 커밋은 다음 바퀴에서 `rts.due`가 되면 1번에서 배포한다).
5. MCC LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음". 프롬프트에 `[MCC CONTEXT CAP]` 안내가 붙었으면 CLAUDE.md "컨텍스트 CAP"대로 `mcc queue`의 `recycle.mode`를 본다: `on`이면 atc가 다시 시작하니 아무것도 청하지 않고, 아니면 "컨텍스트 <n>k — CAP 초과"만 적는다.

코드를 고치지 않고, 팀 세션에 메시지를 보내지 않고, Linear에 쓰지 않는다. guard가 막으면 다른 방법을 찾지 말고 LOG에 적는다.
