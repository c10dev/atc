---
name: tick
description: 관제 한 바퀴 — atc 브리핑을 읽고 CLAUDE.md 판단 기준대로 지시·보고한 뒤 커서를 넘긴다. `/loop 3m /tick`으로 돌린다.
---

# 관제 한 바퀴

1. 이번 바퀴 전에 팀 세션에서 온 메시지가 있으면 먼저 처리한다. "READBACK C-xxxx"는 `node atcctl.mjs readback C-xxxx`, 거부·질문은 감독관 보고 목록에 올린다.
2. `node atcctl.mjs brief`를 실행한다. `reset: true`면 서버가 재시작된 것이니 `events`보다 현재 상태(`open`, `landingQueue`)를 기준으로 본다.
3. CLAUDE.md의 판단 기준표를 위에서부터 적용한다. 지시가 필요하면:
   - `node atcctl.mjs issue <세션> <TYPE> --stand <주기장> --flight <편> -- <내용>`
   - 출력의 `SEND TO` 세션에 `---` 아래 문구를 그대로 SendMessage로 보낸다.
4. 모두 처리했으면 `node atcctl.mjs ack <brief의 cursor>`.
5. 관제 일지를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

판단이 애매하면 3단계에서 지시하지 말고 일지에 감독관 확인 요청으로 남긴다.
