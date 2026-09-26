# 교신 규칙

관제 세션과 팀 세션은 Claude Code의 세션 간 메시지로 교신한다. 문구는 atc가 만들고, 받는 쪽은 READBACK으로 확인한다.

## TOWER → 팀: CLEARANCE

```
[ATC C-0007] BRAVO (TEAM_B) · HOLD
STAND vocado-voc-175 · FLIGHT VOC175
DELTA가 끝날 때까지 대기
— 받았으면 이 메시지에 "READBACK C-0007"로 답장해 주세요.
```

- 팀 리더는 그 메시지에 `READBACK C-0007`로 답한다. 따를 수 없거나 판단이 필요하면 READBACK 대신 이유를 답한다(vocado `CLAUDE.md` 규칙).
- 종류: TRAFFIC · HOLD · CONTINUE · LAND · REPORT · INFO.

## OCC → CAPTAIN: FLIGHT PLAN (2b부터)

```
[DISPATCH D-0003] FLIGHT PLAN · BRAVO (TEAM_B)
FLIGHT VOC193 · AIRPORT VCDO · PRIORITY High
<제목>
<URL>
DISPATCH 메모: CAUTION · …
— 맡으면 이 메시지에 "READBACK D-0003", 못 맡으면 사유로 답장해 주세요.
```

- 지금은 2a(그림자 운용)라 보내지 않는다. 2b를 켜기 전에 vocado `CLAUDE.md`의 READBACK 규칙을 FLIGHT PLAN까지 넓힌다.
- OCC의 SendMessage는 send-guard가 지킨다: approval 모드, SENT 상태 제안, 그 CAPTAIN, atc가 만든 문구 그대로일 때만 통과.

## 기계적 안전장치

| guard | 지키는 것 |
|---|---|
| `controller/guard.mjs` | TOWER·OCC의 Bash: atc CLI·jq만(OCC는 읽기 전용 `gh pr view·checks·diff·list`도). 리다이렉션과 작은따옴표 밖의 `$(…)`·백틱·`$변수`는 막는다 |
| `occ/send-guard.mjs` | OCC의 SendMessage: 승인된 FLIGHT PLAN 그대로만 |
| `occ/mcp-guard.mjs` | OCC의 MCP 도구: 읽기(get·list·search·read·query·fetch)만 — Linear·GitHub에 쓸 수 없음 |

모든 hook은 fail-closed다: 스크립트가 없거나 실패하면 도구가 막힌다. 막히면 관제 세션은 다시 시도하지 않고 사용자에게 보고한다.

## 팀 사이 메시지

팀 세션끼리는 메시지를 보내지 않는다. 결과와 막힌 점은 일을 맡긴 쪽(사용자, OCC, President)에만 보고한다.
