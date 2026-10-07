---
name: tick
description: 착륙 리뷰(REVIEW) 한 바퀴 — 규정이 바뀌었는지 확인하고, Codex 한도로 멈춘 PR(landing queue의 pending)마다 리뷰 자료를 읽어 P0·P1·P2 리뷰를 남긴다. 머지·판정은 하지 않는다. 깨움 모드(기본)에서는 서버의 `[ATC WAKE …]` 글이, `/loop` 모드에서는 `/loop 10m /tick`이 부른다.
---

# 착륙 리뷰 한 바퀴

**한국어** · [English](SKILL.en.md)

## 두 가지 모드 (CONTROL WAKE, ATC-557)

SUPERVISOR가 설정 창 CONTROL WAKE REVIEW로 고른다. 어느 모드인지는 첫 프롬프트와 `node ../controller/atcctl.mjs tick review`의 출력이 알려 준다. CROSSCHECK는 은퇴해서(ATC-371) 깨움이 없다.

- **깨움 모드(`wake`, 기본).** `/loop`가 없다. 착륙 리뷰를 기다리는 PR head가 생기면 atc 서버가 `[ATC WAKE W-xxxx] REVIEW` 글 하나로 깨운다(새 PR 2건까지, 아직 열린 PR, 지난 깨움 뒤 풀린 PR, 관련 FLIGHT). 처음 뜰 때는 `[ATC WAKE BOOT] REVIEW`가 온다.
  - 그 글을 받으면 0단계를 `node ../controller/atcctl.mjs tick review --wake W-xxxx`(BOOT는 `--wake boot`)로 하고 아래 단계를 그대로 한다. 2단계에서는 글에 실린 PR부터 고른다(한 바퀴 2건까지). 남은 PR은 atc가 다음 깨움에 싣는다.
  - ATC에게 답하지 않는다(세션이 아니라 서버다). 턴의 마지막 줄은 `WAKE RESULT: acted`(리뷰를 기록했거나 403·409·guard 막힘을 LOG에 적음) 또는 `WAKE RESULT: nothing`(할 일이 없었음) 하나다. atc가 이 줄로 오작동을 센다.
  - `/loop`가 남은 세션의 `/tick`에서 0단계가 `TICK WAKE-MODE review — …`를 찍으면 아무것도 하지 않고 곧장 턴을 끝낸다(REVIEW LOG 줄도 없다). atc가 안전한 순간에 이 세션을 `/loop` 없이 한 번 다시 띄운다.
  - 글의 둘째 줄이 `Daily review turn (ATC-557)`이면 하루 한 번 점검 턴이다(매일 01:45Z, CLAUDE.md "깨우는 방식"): 0단계부터 그대로 한 뒤, 글이 말하는 대로 지난 24시간을 돌아보고 CLAUDE.md대로 적는다. 마지막 줄은 같은 `WAKE RESULT`다.
- **`/loop` 모드(`loop`).** 오늘처럼 `/loop 10m /tick`으로 돈다. 0단계는 `--wake` 없이 `node ../controller/atcctl.mjs tick review`이다. 깨움 job이 멈췄거나 깨움 BREAKER가 멈추면 깨움 모드여도 `/tick`이 이렇게 일한다(`TICK WAKE-MODE`가 나오지 않는다). BREAKER가 멈추면 atc가 이 세션을 `/loop`로 한 번 다시 띄우고, 다시 켜지면 깨움 모드로 돌린다.

0. `node ../controller/atcctl.mjs tick review`(`manual check`를 이미 한다. 따로 부르지 않는다, ATC-553). `TICK QUIET review`면 할 일이 없다: 아래 4단계(LOG)로 간다. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `node ../controller/atcctl.mjs manual ack`한 뒤, 다시 읽은 규정대로 진행한다. `TICK ACT review`면 1단계로.
1. `node ../controller/atcctl.mjs landing queue`를 실행한다. `pending`이 비었으면 4로 간다. `excluded`는 건드리지 않는다.
2. `pending`의 PR마다(한 바퀴에 2건까지):
   - `node ../controller/atcctl.mjs landing review <pr>`로 자료를 읽는다. 403(외부 리뷰 제외)·409(Codex를 쓸 수 있게 됨, head 바뀜, FLIGHT를 못 읽음)면 다시 시도하지 않고 LOG에 적는다.
   - CLAUDE.md "리뷰하는 법"대로 완료 기준·금지 사항·위험을 본다. 보안 성격이 보이면 리뷰하지 말고 P0 findings로 남긴다.
3. `node ../controller/atcctl.mjs landing review <pr> --head <자료의 head> --verdict pass|findings -- '<리뷰>'`. 등급은 P0·P1·P2, P0·P1이 없을 때만 pass. 명령은 파이프 없이 단독으로 쓴다. guard가 실제 모델을 확인하고 막으면("착륙 리뷰 기록 차단 — … 실제 모델") 이번 바퀴를 멈추고 LOG에 적는다.
4. REVIEW LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음". 깨움으로 시작한 턴이면 그 뒤 마지막 줄에 `WAKE RESULT: acted` 또는 `WAKE RESULT: nothing`.

머지·승인·거절·판정은 하지 않는다. Linear·GitHub에 쓰지 않고, 누구에게도 메시지를 보내지 않는다. guard가 막으면 다른 방법을 찾지 말고 LOG에 적는다.
