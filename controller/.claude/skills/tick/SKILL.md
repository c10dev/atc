---
name: tick
description: ATC 한 바퀴 — atc 브리핑을 읽고 CLAUDE.md 판단 기준대로 CLEARANCE·보고를 낸 뒤 커서를 넘긴다. `/loop 3m /tick`으로 돌린다.
---

# ATC 한 바퀴

**한국어** · [English](SKILL.en.md)

0. `node atcctl.mjs tick tower`. 규정 확인(`manual check`), 브리핑, 할 일이 없을 때의 `ack`을 한 번에 한다. 출력이 정한다:
   - `TICK QUIET tower — …`: 브리핑에 할 일이 없고 이미 ack까지 됐다. 브리핑을 다시 부르지 않는다. 그래도 1단계(이번 바퀴 전에 팀 세션에서 온 READBACK·ROGER·UNABLE·STANDBY 답을 기록)는 하고, 그다음 5단계(ATC LOG "특이 사항 없음")로 간다.
   - `CHANGED …`가 먼저 나오면 규정이 바뀐 것이다(ack는 하지 않았다). `CLAUDE.md`와 이 파일을 다시 읽고 `node atcctl.mjs manual ack`한 뒤, 이어서 찍힌 브리핑을 다시 읽은 규정대로 처리한다.
   - `TICK ACT tower`: `REASONS:`가 이번에 할 일의 종류이고 그 아래가 `brief` 출력(JSON) 그대로다. 1단계부터 이어서 한다. `NOTE: … 서버가 판정하지 못했다`가 있으면 `node atcctl.mjs brief`로 직접 읽고 옛 방식대로 한다.
1. 이번 바퀴 전에 팀 세션에서 온 메시지가 있으면 먼저 처리한다. "READBACK C-xxxx"는 `node atcctl.mjs readback C-xxxx`, "ROGER C-xxxx"는 `roger C-xxxx`, "UNABLE C-xxxx — 사유"는 `unable C-xxxx -- <사유>`(그리고 SUPERVISOR 보고 목록에), "STANDBY C-xxxx"는 `standby C-xxxx`. 정한 형식이 아닌 거부·질문은 SUPERVISOR 보고 목록에 올린다.
2. 0단계에서 찍힌 브리핑을 본다. `reset: true`면 서버가 재시작된 것이니 `events`보다 현재 상태(`open`, `landingQueue`)를 기준으로 본다. `landingQueue[].info`·`goAround`·`fix`는 상태에서 만든 것이라(마지막 INFO·GO AROUND·FIX 본문과 비교한다) 이 바퀴에도 `action`대로 처리한다(ATC-128, ATC-270). 서버가 재시작돼 이벤트가 사라져도 보낼 것이 빠지지 않고, 이미 보낸 것은 다시 가지 않는다.
2a. `relays[]`(SUPERVISOR RELAY, ATC-271)가 있으면 CLAUDE.md의 SUPERVISOR RELAY 행대로 글을 그대로(항목에 `stand`가 있으면 `--stand`로 넘겨) 보내고 `relay issued`로 표시한다. 닿지 못하면 `undeliverable`과 `relay undeliverable`로 표시한다.
3. CLAUDE.md의 판단 기준표를 위에서부터 적용한다. CLEARANCE가 필요하면:
   - `node atcctl.mjs issue <세션> <TYPE> --stand <STAND> --flight <FLIGHT> -- <내용>`
   - 출력의 `SEND TO` 세션에 `---` 아래 문구를 그대로 SendMessage로 보낸다.
4. 모두 처리했으면 `node atcctl.mjs ack <brief의 cursor>`. (`TICK QUIET`이면 이미 됐다.)
5. ATC LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

판단이 애매하면 3단계에서 CLEARANCE를 내지 말고 ATC LOG에 SUPERVISOR 확인 요청으로 남긴다.
