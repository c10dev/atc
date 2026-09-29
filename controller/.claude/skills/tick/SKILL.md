---
name: tick
description: ATC 한 바퀴 — atc 브리핑을 읽고 CLAUDE.md 판단 기준대로 CLEARANCE·보고를 낸 뒤 커서를 넘긴다. `/loop 3m /tick`으로 돌린다.
---

# ATC 한 바퀴

**한국어** · [English](SKILL.en.md)

0. `node atcctl.mjs manual check`. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `node atcctl.mjs manual ack`한 뒤, 다시 읽은 규정대로 진행한다.
1. 이번 바퀴 전에 팀 세션에서 온 메시지가 있으면 먼저 처리한다. "READBACK C-xxxx"는 `node atcctl.mjs readback C-xxxx`, "ROGER C-xxxx"는 `roger C-xxxx`, "UNABLE C-xxxx — 사유"는 `unable C-xxxx -- <사유>`(그리고 SUPERVISOR 보고 목록에), "STANDBY C-xxxx"는 `standby C-xxxx`. 정한 형식이 아닌 거부·질문은 SUPERVISOR 보고 목록에 올린다.
2. `node atcctl.mjs brief`를 실행한다. `reset: true`면 서버가 재시작된 것이니 `events`보다 현재 상태(`open`, `landingQueue`)를 기준으로 본다. 이때 APPROACH PR의 막힘 INFO는 보내지 않는다(이미 보냈을 수 있다). `landingQueue[].goAround`는 상태에서 만든 것이라 이 바퀴에도 `action`대로 처리한다(ATC-128).
3. CLAUDE.md의 판단 기준표를 위에서부터 적용한다. CLEARANCE가 필요하면:
   - `node atcctl.mjs issue <세션> <TYPE> --stand <STAND> --flight <FLIGHT> -- <내용>`
   - 출력의 `SEND TO` 세션에 `---` 아래 문구를 그대로 SendMessage로 보낸다.
4. 모두 처리했으면 `node atcctl.mjs ack <brief의 cursor>`.
5. ATC LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

판단이 애매하면 3단계에서 CLEARANCE를 내지 말고 ATC LOG에 SUPERVISOR 확인 요청으로 남긴다.
