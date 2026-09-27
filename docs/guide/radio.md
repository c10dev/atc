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

## LAND와 LANDING 막힘 알림

- `LAND`는 **CLEARED TO LAND**인 PR에만 나간다([개념](concepts.md)의 LANDING SEQUENCE). 받는 쪽은 그 PR의 STAND를 쥔 팀이다. 문구는 atc 서버가 만들고 TOWER는 그대로 보낸다. 번호는 같은 저장소·같은 base의 CLEARED PR 안에서 센 순번이다. 다른 저장소의 PR이 머지돼도 rebase할 필요가 없어서다:

  ```
  LANDING 순서 1번 (VCDO): PR #389 (VOC52). 지금 LANDING 가능 — 머지 전에 base가 최신인지 확인.
  LANDING 순서 2번 (VCDO): PR #393 (VOC191). 앞 PR #389 머지 뒤 rebase하고 LANDING.
  LANDING 순서 1번 (TNNS): PR #21. 지금 LANDING 가능 — 머지 전에 base가 최신인지 확인.
  ```

  1번은 바로 머지해도 된다. 2번부터는 같은 저장소의 바로 앞 PR이 머지되기를 기다렸다가 rebase하고 LANDING한다. FLIGHT가 없는 PR은 괄호 부분이 빠진다.
- APPROACH인 PR은 `LAND`를 받지 않는다. CAPTAIN이 손써야 할 막힘(CI 실패, head 리뷰 없음, Codex 지적, Codex 한도, 변경 요청, rebase·충돌 등)이 새로 생기면 TOWER가 `INFO`로 알린다:

  ```
  [ATC C-0012] ECHO (TEAM_E) · INFO
  STAND vocado-voc-52-persistent-exec · FLIGHT VOC52
  PR #389 LANDING 불가: 리뷰가 이전 커밋 3510a91에만 있음: head 4cbacd8에 리뷰 필요
  — 받았으면 이 메시지에 "READBACK C-0012"로 답장해 주세요.
  ```

- 같은 막힘으로는 다시 보내지 않는다. CI 진행 중이나 GitHub 계산 중처럼 기다리면 풀리는 것은 알리지 않는다.
- 팀은 READBACK만 하고, 고치는 방법은 CAPTAIN이 정한다. 막힘이 풀리면 PR은 저절로 CLEARED TO LAND가 되고 그때 `LAND`가 온다.
- **GROUND STOP**(3단계 출발 중지, 스위치로 켰을 때만): 그 AIRPORT에는 `LAND`가 나가지 않는다. 시작할 때 CLEARED PR의 팀에 `HOLD`("GROUND STOP: <사유> — LAND 보류")가, 풀릴 때 `CONTINUE`("GROUND STOP 풀림 — LANDING SEQUENCE대로 진행")가 간다. 그 AIRPORT에는 새 배정도 나가지 않는다.

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
| `controller/guard.mjs` | TOWER·OCC·CROSSCHECK의 Bash: atc CLI·jq만(OCC는 읽기 전용 `gh pr view·checks·diff·list`도, CROSSCHECK는 `view·checks·list`). 리다이렉션과 작은따옴표 밖의 `$(…)`·백틱·`$변수`는 막는다. jq는 `… | jq '<필터>'`처럼 앞 명령의 출력만 읽는다: 파일 인자, `-f`·`--rawfile`·`--slurpfile`·`-L`·`--args` 같은 옵션(허용 목록 밖은 모두), 필터의 `env`·`$ENV`·`import`·`include`는 막는다. gh의 `--jq`도 같은 필터 검사를 한다 |
| `occ/send-guard.mjs` | OCC의 SendMessage: 승인된 FLIGHT PLAN 그대로만 |
| `occ/mcp-guard.mjs` | OCC의 MCP 도구: 읽기(get·list·search·read·query·fetch)만 — Linear·GitHub에 쓸 수 없음 |

모든 hook은 fail-closed다: 스크립트가 없거나 실패하면 도구가 막힌다. 막히면 관제 세션은 다시 시도하지 않고 사용자에게 보고한다.

## 팀 사이 메시지

팀 세션끼리는 메시지를 보내지 않는다. 결과와 막힌 점은 일을 맡긴 쪽(사용자, OCC, President)에만 보고한다.
