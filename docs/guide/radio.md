# 교신 규칙

관제 세션과 팀 세션은 Claude Code의 세션 간 메시지로 교신한다. 문구는 atc가 만들고, 받는 쪽은 문구 끝줄이 청하는 답으로 확인한다.

## 답하는 말 (ATC-122)

메시지마다 어떤 답이 그 메시지를 닫는지 atc가 정해 끝줄에 적는다(CPDLC의 응답 속성과 같다, [조사](../research/aviation-signals.ko.md) 1–2절).

| 답 | 뜻 | 받는 메시지 |
|---|---|---|
| `READBACK <id>` | 받았고, 하겠다 | 모든 메시지. 닫힌다 |
| `ROGER <id>` | 받았다(알림) | INFO·TRAFFIC·REPORT CLEARANCE(R). 닫힌다 |
| `UNABLE <id> — 사유` | 못 한다 | LAND·HOLD·CONTINUE CLEARANCE, FLIGHT PLAN, CREW CHANGE(W/U). 닫힌다. 관제 세션은 다시 보내지 않고 SUPERVISOR에게 보고한다 |
| `STANDBY <id>` | 받았지만 시간이 필요하다 | W/U 메시지. 열린 채 남고, READBACK 10분 overdue를 첫 STANDBY부터 한 번 다시 센다. 두 번째 STANDBY는 기록만 된다 |

- RECALL은 `READBACK D-xxxx RECALL`로만 닫힌다(멈추라는 지시라 UNABLE·STANDBY가 없다).
- 받을 수 없는 답(지시에 ROGER, 알림에 STANDBY)은 관제 세션이 기록하려 할 때 atc가 거절한다. 그때는 SUPERVISOR에게 올라간다.
- 답은 관제 세션(TOWER·OCC)이 읽고 `atcctl`로 기록한다. STRIPS 도장에 `ROGER`·`STANDBY`·`UNABLE — 사유`가, DISPATCH IN FLIGHT 줄에 `STANDBY`가 보인다. FLIGHT가 있는 UNABLE은 FLIGHT FOLLOWING에 하루 뜨고, CREW CHANGE의 UNABLE은 `crew-change brief`의 `unable`에 하루 남는다.

## TOWER → 팀: CLEARANCE

```
[ATC C-0007] BRAVO (TEAM_B) · HOLD
STAND vocado-voc-175 · FLIGHT VOC175
Wait until DELTA finishes
— Reply to this message with "READBACK C-0007" if you take it, "UNABLE C-0007 — reason" if you cannot, or "STANDBY C-0007" if you need time.
```

- 팀 리더는 끝줄이 청하는 답으로 답한다(위 "답하는 말"). 형식 없이 거부하거나 질문하면 TOWER가 SUPERVISOR에게 전한다.
- 종류: TRAFFIC · HOLD · CONTINUE · LAND · REPORT · INFO. LAND·HOLD·CONTINUE는 W/U, INFO·TRAFFIC·REPORT는 R(끝줄이 `ROGER C-xxxx`를 청한다).

## LAND와 LANDING 막힘 알림

- `LAND`는 **CLEARED TO LAND**인 PR에만 나간다([개념](concepts.md)의 LANDING SEQUENCE). 받는 쪽은 그 PR의 STAND를 쥔 팀이다. 문구는 atc 서버가 만들고 TOWER는 그대로 보낸다. 번호는 같은 저장소·같은 base의 CLEARED PR 안에서 센 순번이다. 다른 저장소의 PR이 머지돼도 rebase할 필요가 없어서다:

  ```
  LANDING sequence 1 (VCDO): PR #389 (VOC52). Clear to LAND now — check that base is current before merging.
  LANDING sequence 2 (VCDO): PR #393 (VOC191). Rebase and LAND after the PR ahead (#389) merges.
  LANDING sequence 1 (TNNS): PR #21. Clear to LAND now — check that base is current before merging.
  ```

  1번은 바로 머지해도 된다. 2번부터는 같은 저장소의 바로 앞 PR이 머지되기를 기다렸다가 rebase하고 LANDING한다. FLIGHT가 없는 PR은 괄호 부분이 빠진다.
- APPROACH인 PR은 `LAND`를 받지 않는다. CAPTAIN이 손써야 할 막힘(CI 실패, head 리뷰 없음, Codex 지적, Codex 한도, 변경 요청, rebase·충돌 등)이 새로 생기면 TOWER가 `INFO`로 알린다:

  ```
  [ATC C-0012] ECHO (TEAM_E) · INFO
  STAND vocado-voc-52-persistent-exec · FLIGHT VOC52
  PR #389 cannot LAND: the review is only on the earlier commit 3510a91; head 4cbacd8 needs a review
  — When received, reply to this message with "ROGER C-0012".
  ```

- 같은 막힘으로는 다시 보내지 않는다. CI 진행 중이나 GitHub 계산 중처럼 기다리면 풀리는 것은 알리지 않는다.
- 팀은 ROGER만 하고, 고치는 방법은 CAPTAIN이 정한다. 막힘이 풀리면 PR은 저절로 CLEARED TO LAND가 되고 그때 `LAND`가 온다.
- **GROUND STOP**(3단계 출발 중지, 스위치로 켰을 때만): 그 AIRPORT에는 `LAND`가 나가지 않는다. 시작할 때 CLEARED PR의 팀에 `HOLD`("GROUND STOP: <사유> — LAND 보류")가, 풀릴 때 `CONTINUE`("GROUND STOP 풀림 — LANDING SEQUENCE대로 진행")가 간다. 그 AIRPORT에는 새 배정도 나가지 않는다.

## OCC → CAPTAIN: FLIGHT PLAN (2b부터)

```
[DISPATCH D-0003] FLIGHT PLAN · BRAVO (TEAM_B)
BRIEF: DIRECT
FLIGHT VOC193 · AIRPORT VCDO · PRIORITY High
<제목>
<URL>
Goal: …
Done when: …
Constraints: …
DISPATCH note: CAUTION · …
Where it is ambiguous, use PILOT'S DISCRETION: pick a reasonable default and record it in the PR.
— Reply to this message with "READBACK D-0003" if you take it, "UNABLE D-0003 — reason" if you cannot, or "STANDBY D-0003" if you need time.
Carry it through to the end; stop and ask only for what needs a SUPERVISOR decision.
```

- FLIGHT PLAN은 DIRECT 지시서다. Goal·Done when·Constraints(이슈 본문의 목표·완료 기준·제약)는 보낼 때 옮긴다. 세션끼리 주고받는 글이라 이 문구들은 영어다(ATC-126). 늘 지키는 규칙(CLAUDE.md, guard, 브랜치 보호)은 적지 않는다.
- 사용자나 다른 세션이 팀에 직접 일을 줄 때도 같은 모양을 쓴다. `GET /api/dispatch/flight/<FLIGHT>/brief?to=TEAM_X`가 붙여 넣을 문구를 준다. 손으로 쓸 때도 `BRIEF: DIRECT` 줄을 넣어야 비교에 DIRECT로 잡힌다.

- 지금은 2a(그림자 운용)라 보내지 않는다. 2b를 켜기 전에 vocado `CLAUDE.md`의 READBACK 규칙을 FLIGHT PLAN과 CREW CHANGE까지 넓힌다.
- OCC의 SendMessage는 send-guard가 지킨다: approval 모드, SENT 상태 제안, 그 CAPTAIN, atc가 만든 문구 그대로일 때만 통과.

## OCC → CAPTAIN: RECALL (2b부터)

SUPERVISOR가 보낸 FLIGHT PLAN을 거둬들이면 OCC가 서버가 만든 문구를 그대로 보낸다:

```
[DISPATCH D-0003] RECALL · BRAVO (TEAM_B)
FLIGHT VOC193 · AIRPORT VCDO — this FLIGHT PLAN is withdrawn.
권한 정리
Reason: 우선순위 바뀜
Stop work. Do not clean up the STAND (worktree); leave it as is — so another AIRCRAFT can pick it up.
— When received, reply to this message with "READBACK D-0003 RECALL".
```

- CAPTAIN은 작업을 멈추고, 워크트리는 그대로 두고, `READBACK D-0003 RECALL`로 답한다(RECALL을 꼭 붙인다).
- send-guard는 RECALL 요청된 제안의 CAPTAIN에게 이 문구 그대로 보낼 때만 통과시킨다.

## OCC → CAPTAIN: CREW CHANGE (2b부터)

운항 중인 AIRCRAFT의 CREW COMPLEMENT를 바꾸고 SUPERVISOR가 FLEET 탭에서 승인하면, OCC가 `atcctl crew-change send`로 받은 문구를 그대로 보낸다:

```
[OCC CC-0001] CREW CHANGE · HOTEL (TEAM_H)

TEAM_H CAPTAIN, the SUPERVISOR changed this AIRCRAFT's CREW COMPLEMENT. Change your crew as follows.

CREW leaving (stop them and do not call them again)
- flash-helper: flash-helper (no BUILD, no CHECK verdicts, no SEC)
…
When applied, leave only the line "TEAM_H CREW CHANGE CC-0001 COMPLETE".

— Reply to this message with "READBACK CC-0001" if you take it, "UNABLE CC-0001 — reason" if you cannot, or "STANDBY CC-0001" if you need time.
```

- CAPTAIN은 받으면 `READBACK CC-0001`로 답하고, 팀원을 바꾼 뒤 `COMPLETE` 한 줄을 남긴다. OCC가 READBACK을 기록한다(`crew-change readback`).
- 10분 넘게 READBACK이 없으면(첫 STANDBY가 있으면 그때부터 10분) OCC가 같은 문구를 한 번 더 보내고, 그래도 없으면 SUPERVISOR에게 보고한다. `UNABLE CC-0001 — 사유`면 다시 보내지 않고 SUPERVISOR에게 보고한다.
- 2a(shadow)에서는 보내지 않는다. SUPERVISOR가 FLEET 카드에서 복사해 붙여 넣는다. 2b를 켜기 전에 vocado `CLAUDE.md`의 READBACK 규칙을 `[OCC CC-xxxx]`까지 넓힌다(SUPERVISOR가 고친다).
- send-guard는 approval 모드이고, `crew-change send`로 보냄(sent) 상태가 된 건을 그 AIRCRAFT(REGISTRATION)에게 서버가 저장한 문구 그대로 보낼 때만 통과시킨다.

## 기계적 안전장치

| guard | 지키는 것 |
|---|---|
| `controller/guard.mjs` | TOWER·OCC·CROSSCHECK의 Bash: atc CLI·jq만(OCC는 읽기 전용 `gh pr view·checks·diff·list`도, CROSSCHECK는 `view·checks·list`). 리다이렉션과 작은따옴표 밖의 `$(…)`·백틱·`$변수`는 막는다. jq는 `… | jq '<필터>'`처럼 앞 명령의 출력만 읽는다: 파일 인자, `-f`·`--rawfile`·`--slurpfile`·`-L`·`--args` 같은 옵션(허용 목록 밖은 모두), 필터의 `env`·`$ENV`·`import`·`include`는 막는다. gh의 `--jq`도 같은 필터 검사를 한다 |
| `occ/send-guard.mjs` | OCC의 SendMessage: approval 모드에서 승인된 FLIGHT PLAN, RECALL 요청된 제안의 RECALL 문구, 발부된 CREW CHANGE 문구를 그대로 그 CAPTAIN·AIRCRAFT에게만 |
| `occ/mcp-guard.mjs` | OCC의 MCP 도구: 읽기(get·list·search·read·query·fetch)만 — Linear·GitHub에 쓸 수 없음 |

모든 hook은 fail-closed다: 스크립트가 없거나 실패하면 도구가 막힌다. 막히면 관제 세션은 다시 시도하지 않고 사용자에게 보고한다.

## 팀 사이 메시지

팀 세션끼리는 메시지를 보내지 않는다. 결과와 막힌 점은 일을 맡긴 쪽(사용자, OCC, President)에만 보고한다.
