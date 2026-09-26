---
name: tick
description: DISPATCH 한 바퀴 — atc 배정 제안 중 메모가 없는 것을 FLIGHT 본문으로 검토해 메모·CAUTION을 단다. `/loop 10m /tick`으로 돌린다.
---

# DISPATCH 한 바퀴 (2a)

**한국어** · [English](SKILL.en.md)

1. `node ../controller/atcctl.mjs dispatch brief`를 실행한다.
2. `open` 중 `note`가 없는 제안마다:
   - `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`로 본문과 댓글을 읽는다.
   - CLAUDE.md의 검토 기준에 따라 `node ../controller/atcctl.mjs dispatch note <ID> [--caution] -- <메모>`.
3. DISPATCH LOG를 한두 줄 남긴다. 검토할 제안이 없으면 "특이 사항 없음".

판정(승인·거절)은 하지 않는다. SendMessage는 쓰지 않는다.
