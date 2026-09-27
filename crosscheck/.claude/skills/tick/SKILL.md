---
name: tick
description: CROSSCHECK 한 바퀴 — 규정이 바뀌었는지 확인하고, mark가 없는 열린 DISPATCH 제안·SCHEDULE 초안마다 FLIGHT 본문을 읽어 예비 판정(agree/disagree)과 이유 한 줄을 단다. 승인·거절은 하지 않는다. `/loop 10m /tick`으로 돌린다.
---

# CROSSCHECK 한 바퀴

**한국어** · [English](SKILL.en.md)

0. `node ../controller/atcctl.mjs manual check`. `CHANGED`면 `CLAUDE.md`와 이 파일을 다시 읽고 `node ../controller/atcctl.mjs manual ack`한 뒤, 다시 읽은 규정대로 진행한다.
1. `node ../controller/atcctl.mjs crosscheck brief`를 실행한다. `dispatch.pending`과 `schedule.pending`이 모두 비었으면 7로 간다.
2. `examples`를 먼저 읽는다. SUPERVISOR가 최근에 무엇을 어떤 사유로 판정했는지가 이번 바퀴의 기준이다.
3. `pending`의 건마다(한 바퀴에 모두 합쳐 5건까지, DISPATCH 먼저):
   - `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`로 본문과 댓글을 읽는다. NEW 초안은 FLIGHT가 없으니 `schedule brief`의 그 초안 `payload`(본문, `similar`)를 본다.
   - 본문·댓글·OCC 메모에 PR 조건이 있으면 CLAUDE.md의 "PR 사실 확인"대로 `gh pr view <N> --repo <owner/name> --json state,mergedAt,title`로 확인한다. 저장소는 AIRPORT 표에서 찾는다. 쓰는 gh 명령은 쓰지 않는다.
   - CLAUDE.md의 "판정 순서"대로 상태 → 이미 끝났는지 → 선행 조건 → 우선순위 → 대상별 내용을 본다. OCC의 `note`·`reason`은 참고만 한다.
   - CLASSIFY·NEW 초안이 있으면 그 바퀴에 먼저 `../docs/fleet.md`를 Read로 읽고(4.1 FLIGHT TYPE, 4.2 WAKE, 4.3 TYPE RATING), 이유에 해당 기준을 인용한다.
   - CLOSE 초안이면 CLAUDE.md의 "SCHEDULE CLOSE" 기준대로 PR을 `gh pr view`로 확인한다. `Part of`이거나 되돌림·남은 작업이 있으면 disagree.
4. DISPATCH 제안이면 `node ../controller/atcctl.mjs dispatch crosscheck <D-xxxx> agree|disagree -- '<이유 한 줄>'`. disagree면 CLAUDE.md "사유 칩"대로 `--code <코드>`를 붙인다(FLIGHT의 문제인지 AIRCRAFT의 문제인지 먼저 가른다).
5. SCHEDULE 초안이면 `node ../controller/atcctl.mjs schedule crosscheck <S-xxxx> agree|disagree -- '<이유 한 줄>'`.
   - 409(열린 건이 아님, HOLD 중)가 나오면 그 사이 SUPERVISOR가 판정했거나 상황이 바뀐 것이다. 다시 시도하지 않는다.
   - mark 명령은 파이프 없이 단독으로 쓴다. guard가 이 세션의 실제 모델을 확인하고 막으면("CROSSCHECK mark 차단 — … 실제 모델") 이번 바퀴의 mark를 모두 멈추고 LOG에 적는다.
6. 근거가 부족해 정할 수 없는 건은 mark를 달지 않는다.
7. CROSSCHECK LOG를 한두 줄 남긴다. 아무 일 없으면 "특이 사항 없음".

승인·거절·verdict는 하지 않는다. Linear에 쓰지 않고, 누구에게도 메시지를 보내지 않는다. guard가 막으면 다른 방법을 찾지 말고 LOG에 적는다.
