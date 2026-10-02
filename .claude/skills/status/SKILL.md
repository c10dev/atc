---
name: status
description: Answer "현재 상태", "어디까지 진행됐어?" and "ATC-n 진행 상황" in seconds from one read-only atc endpoint (GET /api/status), in Korean, in a fixed format of at most 8 lines. Use when the SUPERVISOR asks a session for the current state of atc or the progress of a FLIGHT. It reads one endpoint and does not investigate further unless asked.
---

# status

One read, one fixed answer. The same question gets the same shape in every session.

## Read

```bash
curl -s "${ATC_URL:-http://localhost:7700}/api/status"                      # "현재 상태", "어디까지 진행됐어?"
curl -s "${ATC_URL:-http://localhost:7700}/api/status?flight=ATC-384"       # "ATC-384 진행 상황"
curl -s "${ATC_URL:-http://localhost:7700}/api/status?topic=FLIGHTS"        # "<주제> 어디까지?" (no FLIGHT key)
```

A `GET` that only reads (field list: `server/README.md`, `GET /api/status`). It does not move the SINCE LAST LOOK marker. If it fails (`503` snapshot not ready, or no connection), say so in one line and stop; do not fall back to other endpoints or to reading code.

## Answer (Korean, at most 8 lines, no extra prose)

**Current state** (no FLIGHT key):

```
현재 상태 · HH:MMZ
본 뒤: <since.line, 없으면 "새 것 없음">
비행 중 <flyingTotal>: <key 단계>, <key 단계> … (앞 5개, 넘으면 "외 n")
기다림 <waiting 수>: <첫 항목 text 한 줄> (없으면 "없음")
알림: WARNING <n> · CAUTION <n> — <첫 항목 text 한 줄> (없으면 "없음")
막힘 <since.stuck 수>: <key, key …> (없으면 "없음")
RTS: <result> <HH:MMZ> (없으면 "기록 없음")
```

**One FLIGHT** (`focus`): if `focus.found` is false, answer `ATC-n: 찾지 못함` and stop.

```
<key> <title 한 줄> · <state>
단계: <stageLabel> (없으면 "시작 전") · 지금: <now>
PR: #<number> <landing> · 막는 것: <blocks 앞 2개> (PR 없으면 "PR 없음")
막는 FLIGHT: <blockers> (없으면 "없음")
막힘: <stuck> (없으면 "없음")
다음: <next> (없으면 "—")
```

**A topic** (`topic`): the same lines as the state answer, using only `topic.flying`, `topic.waiting`, `topic.alerts` and a last line `이슈: <key 제목>, …` from `topic.issues`; leave out a line that is empty.

## Rules

- Times are UTC `HH:MMZ`. FLIGHT numbers are the keys as given. Aviation terms stay in English (FLIGHT, PR, HOME, RTS, ON, IN).
- Use the endpoint's words (`now`, `stuck`, `next`, `text`); do not rewrite or add facts. Cut long texts to one line.
- Do not investigate further (no `git`, no logs, no other endpoints, no Linear) unless the SUPERVISOR asks a follow-up. Offer nothing unasked; end after the last line.
- Never change anything: this skill only reads.
