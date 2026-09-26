---
name: tick
description: DISPATCH 한 바퀴 — 메모 없는 배정 제안을 FLIGHT 본문으로 검토해 메모·CAUTION을 달고, approval 모드면 승인된 제안을 FLIGHT PLAN으로 보내고 READBACK을 기록한다. `/loop 10m /tick`으로 돌린다.
---

# DISPATCH 한 바퀴

**한국어** · [English](SKILL.en.md)

1. 이번 바퀴 전에 CAPTAIN에게서 온 답장이 있으면 먼저 처리한다: "READBACK D-xxxx"는 `node ../controller/atcctl.mjs dispatch readback D-xxxx`, 사유를 든 거절은 `dispatch decline D-xxxx -- <사유>`.
2. `node ../controller/atcctl.mjs dispatch brief`를 실행하고 `mode`를 본다.
3. `open` 중 `note`가 없는 제안마다:
   - `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`로 본문과 댓글을 읽는다.
   - CLAUDE.md의 검토 기준에 따라 `node ../controller/atcctl.mjs dispatch note <ID> [--caution] -- <메모>`.
4. `mode`가 `approval`이면 CLAUDE.md의 "FLIGHT PLAN 전달"을 따른다: `inFlight`의 approved → `dispatch release` → 출력 문구를 그대로 SendMessage, `overdue` 처리. `shadow`면 이 단계를 건너뛴다.
5. DISPATCH LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

판정(승인·거절)은 하지 않는다. send-guard가 막으면 다시 시도하지 말고 SUPERVISOR에게 보고한다.
