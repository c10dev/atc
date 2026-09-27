---
name: tick
description: 착륙 리뷰(REVIEW) 한 바퀴 — 규정이 바뀌었는지 확인하고, Codex 한도로 멈춘 PR(landing queue의 pending)마다 리뷰 자료를 읽어 P0·P1·P2 리뷰를 남긴다. 머지·판정은 하지 않는다. `/loop 10m /tick`으로 돌린다.
---

# 착륙 리뷰 한 바퀴

**한국어** · [English](SKILL.en.md)

0. `node ../controller/atcctl.mjs manual check`. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `node ../controller/atcctl.mjs manual ack`한 뒤, 다시 읽은 규정대로 진행한다.
1. `node ../controller/atcctl.mjs landing queue`를 실행한다. `pending`이 비었으면 4로 간다. `excluded`는 건드리지 않는다.
2. `pending`의 PR마다(한 바퀴에 2건까지):
   - `node ../controller/atcctl.mjs landing review <pr>`로 자료를 읽는다. 403(외부 리뷰 제외)·409(Codex를 쓸 수 있게 됨, head 바뀜, FLIGHT를 못 읽음)면 다시 시도하지 않고 LOG에 적는다.
   - CLAUDE.md "리뷰하는 법"대로 완료 기준·금지 사항·위험을 본다. 보안 성격이 보이면 리뷰하지 말고 P0 findings로 남긴다.
3. `node ../controller/atcctl.mjs landing review <pr> --head <자료의 head> --verdict pass|findings -- '<리뷰>'`. 등급은 P0·P1·P2, P0·P1이 없을 때만 pass. 명령은 파이프 없이 단독으로 쓴다. guard가 실제 모델을 확인하고 막으면("착륙 리뷰 기록 차단 — … 실제 모델") 이번 바퀴를 멈추고 LOG에 적는다.
4. REVIEW LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

머지·승인·거절·판정은 하지 않는다. Linear·GitHub에 쓰지 않고, 누구에게도 메시지를 보내지 않는다. guard가 막으면 다른 방법을 찾지 말고 LOG에 적는다.
