---
name: tick
description: OCC 한 바퀴 — 규정이 바뀌었는지 확인하고, 메모 없는 배정 제안을 FLIGHT 본문으로 검토해 메모·CAUTION을 달고, approval 모드면 승인된 제안을 FLIGHT PLAN으로 보내고 READBACK을 기록한다. 분류·우선순위 없는 FLIGHT에 SCHEDULE 초안(CLASSIFY·PRIORITIZE, 그림자 운용)을 쓴다. `/loop 10m /tick`으로 돌린다.
---

# OCC 한 바퀴

**한국어** · [English](SKILL.en.md)

0. `node ../controller/atcctl.mjs manual check`. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `node ../controller/atcctl.mjs manual ack`한 뒤, 다시 읽은 규정대로 진행한다.
1. 이번 바퀴 전에 CAPTAIN에게서 온 답장이 있으면 먼저 처리한다. PR·리뷰·완료 보고는 CLAUDE.md의 "운항 추적"대로 `gh`로 확인한다. FLIGHT PLAN 답장 중 "READBACK D-xxxx"는 `node ../controller/atcctl.mjs dispatch readback D-xxxx`, 사유를 든 거절은 `dispatch decline D-xxxx -- <사유>`.
2. `node ../controller/atcctl.mjs dispatch brief`를 실행하고 `mode`를 본다.
3. `open` 중 `note`가 없는 제안마다:
   - `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`로 본문과 댓글을 읽는다.
   - CLAUDE.md의 검토 기준에 따라 `node ../controller/atcctl.mjs dispatch note <ID> [--caution] [--hold [<FLIGHT>]] -- <메모>`. 본문에만 적힌 선행 작업이나 사람 결정 대기는 메모로 끝내지 말고 `--hold`를 건다.
4. `mode`가 `approval`이면 CLAUDE.md의 "FLIGHT PLAN 전달"을 따른다: `inFlight`의 approved → `dispatch release` → 출력 문구를 그대로 SendMessage, `overdue` 처리. `shadow`면 이 단계를 건너뛴다.
5. SCHEDULE 초안(S1, 그림자 운용). CLAUDE.md의 "SCHEDULE 초안"을 따른다:
   - `node ../controller/atcctl.mjs schedule brief`를 실행하고 `candidates`를 본다.
   - 후보 FLIGHT 3개까지 `dispatch flight <FLIGHT key>`로 읽는다. `candidates.classify`에 있으면 `schedule draft CLASSIFY <FLIGHT> [--type …] [--wake …] [--rating …] -- "<근거>"`. `candidates.prioritize`에 있고 본문·댓글에 근거가 있으면 `schedule draft PRIORITIZE <FLIGHT> --priority <1-4> -- "<근거>"`. 근거가 없으면 PRIORITIZE는 건너뛴다.
   - `LIMIT`이 나오면 이번 바퀴는 초안을 그만 쓴다. Linear에는 쓰지 않는다.
6. OCC LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

판정(승인·거절)은 하지 않는다. send-guard가 막으면 다시 시도하지 말고 SUPERVISOR에게 보고한다.
