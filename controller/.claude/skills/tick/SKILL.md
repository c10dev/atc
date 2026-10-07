---
name: tick
description: ATC 한 바퀴 — atc 브리핑을 읽고 CLAUDE.md 판단 기준대로 CLEARANCE·보고를 낸 뒤 커서를 넘긴다. 깨움 모드(기본)에서는 서버의 `[ATC WAKE …]` 글이, `/loop` 모드에서는 `/loop 3m /tick`이 부른다.
---

# ATC 한 바퀴

**한국어** · [English](SKILL.en.md)

## 두 가지 모드 (CONTROL WAKE, ATC-557)

SUPERVISOR가 설정 창 CONTROL WAKE TOWER로 고른다. 어느 모드인지는 첫 프롬프트와 `node atcctl.mjs tick tower`의 출력이 알려 준다.

- **깨움 모드(`wake`, 기본).** `/loop`가 없다. atc 서버가 판단할 일을 보면 `[ATC WAKE W-xxxx] TOWER` 글 하나로 깨운다(새 일, 아직 열린 일, 지난 깨움 뒤 풀린 일, 관련 FLIGHT). 처음 뜰 때는 `[ATC WAKE BOOT] TOWER`가 온다.
  - 그 글을 받으면 0단계를 `node atcctl.mjs tick tower --wake W-xxxx`(BOOT는 `--wake boot`)로 하고 아래 단계를 그대로 한다. 글에 적힌 일만 보지 않고 출력 전체를 본다.
  - ATC에게 답하지 않는다(세션이 아니라 서버다). 턴의 마지막 줄은 `WAKE RESULT: acted`(무엇이든 내거나 기록하거나 보내거나 보고함) 또는 `WAKE RESULT: nothing`(할 일이 없었음) 하나다. atc가 이 줄로 오작동을 센다.
  - 팀의 답(READBACK·UNABLE·질문 …)은 전처럼 세션 이름으로 와서 이 세션을 깨운다. 1단계대로 기록·보고하고 턴을 끝낸다. 그 밖의 일은 서버가 따로 깨운다.
  - `/loop`가 남은 세션의 `/tick`에서 0단계가 `TICK WAKE-MODE tower — …`를 찍으면 아무것도 하지 않고 곧장 턴을 끝낸다(ATC LOG 줄도 없다). atc가 안전한 순간에 이 세션을 `/loop` 없이 한 번 다시 띄운다.
  - 글의 둘째 줄이 `Daily review turn (ATC-557)`이면 하루 한 번 점검 턴이다(매일 01:00Z, CLAUDE.md "깨우는 방식"): 0단계부터 그대로 한 뒤, 글이 말하는 대로 지난 24시간을 돌아보고 CLAUDE.md대로 적는다. 마지막 줄은 같은 `WAKE RESULT`다.
- **`/loop` 모드(`loop`).** 오늘처럼 `/loop 3m /tick`으로 돈다. 0단계는 `--wake` 없이 `node atcctl.mjs tick tower`이다. 깨움 job이 멈췄거나 깨움 BREAKER가 멈추면 깨움 모드여도 `/tick`이 이렇게 일한다(`TICK WAKE-MODE`가 나오지 않는다). BREAKER가 멈추면 atc가 이 세션을 `/loop`로 한 번 다시 띄우고, 다시 켜지면 깨움 모드로 돌린다.

## 서버가 보내는 CLEARANCE (SERVER CLEARANCE, ATC-557 b)

SUPERVISOR 스위치가 on인 종류(기본 모두 on)의 LAND·APPROACH INFO·GO AROUND·FIX·첫 RESEND·SUPERVISOR RELAY는 atc 서버가 브리핑의 글 그대로 적고 팀에 보낸다. 브리핑에 서버 몫(`landVia: "server"`, `action: "server"`, `serverSends`)으로 표시된 것은 2·2a·3단계에서 보내지 않는다. 이 세션은 팀의 답(서버가 낸 C-xxxx도)과 판단할 일만 맡는다. 서버가 보내지 못한 것은 `action: "send"`·`relays[]`·`clearances.overdue`로 돌아오니 오늘처럼 낸다(CLAUDE.md "서버가 보내는 CLEARANCE").

0. `node atcctl.mjs tick tower`. 규정 확인(`manual check`), 브리핑, 할 일이 없을 때의 `ack`을 한 번에 한다. 출력이 정한다:
   - `TICK QUIET tower — …`: 브리핑에 할 일이 없고 이미 ack까지 됐다. 브리핑을 다시 부르지 않는다. 그래도 1단계(이번 바퀴 전에 팀 세션에서 온 READBACK·ROGER·UNABLE·STANDBY 답을 기록)는 하고, 그다음 5단계(ATC LOG "특이 사항 없음")로 간다.
   - `CHANGED …`가 먼저 나오면 규정이 바뀐 것이다(ack는 하지 않았다). `CLAUDE.md`와 이 파일을 다시 읽고 `node atcctl.mjs manual ack`한 뒤, 이어서 찍힌 브리핑을 다시 읽은 규정대로 처리한다.
   - `TICK ACT tower`: `REASONS:`가 이번에 할 일의 종류이고 그 아래가 `brief` 출력(JSON) 그대로다. 1단계부터 이어서 한다. `NOTE: … 서버가 판정하지 못했다`가 있으면 `node atcctl.mjs brief`로 직접 읽고 옛 방식대로 한다.
1. 이번 바퀴 전에 팀 세션에서 온 메시지가 있으면 먼저 처리한다. "READBACK C-xxxx"는 `node atcctl.mjs readback C-xxxx`, "ROGER C-xxxx"는 `roger C-xxxx`, "UNABLE C-xxxx — 사유"는 `unable C-xxxx -- <사유>`(그리고 SUPERVISOR 보고 목록에), "STANDBY C-xxxx"는 `standby C-xxxx`. 정한 형식이 아닌 거부·질문은 SUPERVISOR 보고 목록에 올린다.
2. 0단계에서 찍힌 브리핑을 본다. `reset: true`면 서버가 재시작된 것이니 `events`보다 현재 상태(`open`, `landingQueue`)를 기준으로 본다. `landingQueue[].info`·`goAround`·`fix`는 상태에서 만든 것이라(마지막 INFO·GO AROUND·FIX 본문과 비교한다) 이 바퀴에도 `action`대로 처리한다(ATC-128, ATC-270). `server`는 서버가 보내니 건너뛴다(ATC-557 b). 서버가 재시작돼 이벤트가 사라져도 보낼 것이 빠지지 않고, 이미 보낸 것은 다시 가지 않는다.
2a. `relays[]`(SUPERVISOR RELAY, ATC-271. 서버가 보내는 것은 `serverSends.relays`에 따로 있다)가 있으면 CLAUDE.md의 SUPERVISOR RELAY 행대로 글을 그대로(항목에 `stand`가 있으면 `--stand`로 넘겨) 보내고 `relay issued`로 표시한다. 닿지 못하면 `undeliverable`과 `relay undeliverable`로 표시한다.
3. CLAUDE.md의 판단 기준표를 위에서부터 적용한다. CLEARANCE가 필요하면:
   - `node atcctl.mjs issue <세션> <TYPE> --stand <STAND> --flight <FLIGHT> -- <내용>`
   - 출력의 `SEND TO` 세션에 `---` 아래 문구를 그대로 SendMessage로 보낸다.
4. 모두 처리했으면 `node atcctl.mjs ack <brief의 cursor>`. (`TICK QUIET`이면 이미 됐다.)
5. ATC LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

판단이 애매하면 3단계에서 CLEARANCE를 내지 말고 ATC LOG에 SUPERVISOR 확인 요청으로 남긴다.
