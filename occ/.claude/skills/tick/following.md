# OCC 절차: 운항 추적

**한국어** · [English](following.en.md)

[`CLAUDE.md`](../../../CLAUDE.md)에서 옮긴 절차다. `/tick` 1·7단계에서 CAPTAIN 보고나 SUPERVISOR 확인 요청이 왔거나 `following`에 `fresh: true`인 문제가 있을 때 Read한다. 역할과 하지 않는 것은 `CLAUDE.md`가 정한다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `gh pr view <n> -R <repo> --json state,isDraft,headRefOid,mergeStateStatus,reviews` | (운항 추적) PR 상태와 최신 커밋, 리뷰 |
| `gh pr checks <n> -R <repo>` / `gh pr diff <n> -R <repo>` | (운항 추적) 최신 커밋의 CI, 바뀐 파일 |

## 운항 추적 (flight following)

### 바퀴마다: `atcctl following`

atc가 배정된 FLIGHT의 진행을 따라간다(읽기 전용). 단계는 READBACK → DEPARTED(STAND·착수 기록) → PR 열림 → CLEARED → ARRIVED(LOGBOOK)이고, 문제(`issues`)는 이렇다.

| code | 뜻 | 보고 |
|---|---|---|
| `no-departure` · `no-pr` · `pr-not-cleared` · `no-arrival` | 지연: 지금 단계에서 WAKE 기대치(L 60분·M 240분·H 2일)의 1.5배를 넘도록 다음 단계가 없음. STAND 없는 FLIGHT(SURVEY·CHECK)는 PR 단계가 없어 `no-arrival`(DEPARTED 뒤 ARRIVED 보고 없음)만 본다 | SUPERVISOR |
| `no-report` | 정보(`severity: info`, ADVISORY): DISPATCH가 보낸 FLIGHT가 도착 보고 기록이 시작된 뒤(2026-09-29T08:34Z, ATC-124) 머지됐고, ON 30분이 지나도 기록된 도착 보고가 없음(ATC-124·152). 머지(ON) 뒤 하루만 보이고 저절로 사라진다. ENGINEERING PR과 FLIGHT PLAN 없는 직접 작업에는 뜨지 않는다. 받은 보고가 있으면 `dispatch report`로 기록하고, 없으면 OCC LOG에만 적는다(팀에 묻지 않는다) | OCC LOG에만 |
| `blocked-report` | 기록된 도착 보고의 `BLOCKED`가 `none`이 아님(하루 보임). `text`에 막힌 점이 있다 | SUPERVISOR |
| `landing-wait` | CLEARED 뒤 1시간 넘게 착륙 안 함(정보, 착륙은 SUPERVISOR 몫) | OCC LOG에만 |
| `review-no-pr` · `done-not-merged` | 불일치: Linear는 In Review·Done인데 PR이 없거나 머지되지 않음 | SUPERVISOR |
| `merged-not-done` | 불일치: PR은 머지됐는데 Linear가 Done이 아님(정보, CLOSE 초안 대상) | OCC LOG에만 |
| `health` | 그 FLIGHT를 쥔 AIRCRAFT가 멈췄거나 무언가를 기다린다(docs/fleet.ko.md 8.8): `LIMIT`(오류 없이 한도로 잘린 `cut`도), `RESUME`(한도가 풀렸는데 새 지시가 없음: SUPERVISOR가 그 세션에서 "계속"을 보낸다), `STALLED`(In Progress FLIGHT를 쥔 채 PR 없이 60분 넘게 idle), `NETWORK`, `MODEL`, `CONTEXT`, `PROVIDER`, `UNANSWERED`, `HUNG` … `text`에 표시, 오류 한 줄, 다음 할 일이 있다. 코드가 바뀌면 새 문제로 온다. 팀에 다시 보내지 않는다 | `warn`이면 SUPERVISOR, `info`면 OCC LOG에만 |
| `fuel` | 그 FLIGHT를 쥔 AIRCRAFT의 ACCOUNT가 사용 한도의 INFO 임계값(기본 80 %) 이상을 썼다(docs/fuel.md 6, ATC-55). `text`에 쓴 몫, reset, 같은 ACCOUNT의 AIRCRAFT가 있다. ACCOUNT·창·reset마다 한 번 온다. 팀에 보내지 않는다(TOWER가 SUPERVISOR에게 알린다) | OCC LOG에만 |
| `report` | 그 FLIGHT를 쥔 AIRCRAFT의 CAPTAIN이 마지막 턴에서 SUPERVISOR의 결정을 청했다고 Jev가 판정했다(docs/fleet.ko.md 8.8, ATC-89, 그림자). `text`에 확률이 있다. 턴마다 한 번 온다. 판정이 틀릴 수 있으니 그 세션의 마지막 메시지를 직접 읽어 확인하라고 SUPERVISOR에게 적는다. 팀에 다시 보내지 않는다 | OCC LOG에만 |
| `stranded` | 불일치: PR이 기본 브랜치가 아닌 곳에 머지돼 main에 닿지 않음(쌓인 PR을 아래에서부터 각자 아래 브랜치로 머지한 경우 등, ATC-29). Linear가 Done이어도 뜬다 | SUPERVISOR |
| `launch` | SUPERVISOR가 승인한 launch 카드의 LAUNCH가 실패했거나 LAUNCH 뒤 새 세션이 뜨지 않았다(ATC-129). FLIGHT PLAN은 나가지 않았다. 하루 뜬다. 다시 띄우지 않고 팀에 보내지 않는다 | SUPERVISOR |

- `fresh: true`인 문제만 새로 생긴 것이다. 하나에 한 줄로 OCC LOG에 적고, `severity: "warn"`이면 SUPERVISOR에게 보고한다. 그다음 `atcctl following ack`로 보고했다고 적는다.
- `fresh: false`인 것은 이미 보고했으니 다시 보고하지 않는다. 풀렸다가 다시 생기면 atc가 다시 fresh로 준다.
- 팀에 메시지를 보내지 않는다. 사실 확인이 더 필요하면 아래 표처럼 읽기 전용 `gh`로 본다.

### 팀 보고나 SUPERVISOR 요청이 왔을 때

CAPTAIN이 "PR 올림", "리뷰 끝남", "끝남"을 보고하거나 SUPERVISOR가 확인을 요청하면:

| 확인 | 방법 |
|---|---|
| PR이 보고한 최신 커밋인가 | `gh pr view … --json headRefOid` |
| 최신 커밋에서 required check가 모두 통과했나 | `gh pr checks …` |
| 리뷰가 그 최신 커밋에 달렸나 | `gh pr view … --json reviews` (리뷰의 commit과 head 비교) |
| 바뀐 파일이 이슈의 허용 범위 안인가 | `gh pr diff … --name-only`와 `dispatch flight <FLIGHT>`의 허용 파일 비교 |

보고와 다른 점이 있으면 사실만 SUPERVISOR에게 알린다. 머지 여부나 리뷰 판정은 말하지 않는다.
