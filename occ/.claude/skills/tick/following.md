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

atc가 배정된 FLIGHT의 진행을 따라간다(읽기 전용). 대상은 둘이다.

- accepted·departed·recalling인 DISPATCH ASSIGN
- 2b 전이라도 `tail:`이 붙은 In Progress FLIGHT(사람이 직접 배정한 것)

단계는 READBACK → DEPARTED(STAND·착수 기록) → PR 열림 → CLEARED → ARRIVED(LOGBOOK)이고, 문제(`issues`)는 이렇다.

| code | 뜻 | 보고 |
|---|---|---|
| `no-departure` · `no-pr` · `pr-not-cleared` · `no-arrival` | 지연: 지금 단계에서 WAKE 기대치(L 60분·M 240분·H 2일)의 1.5배를 넘도록 다음 단계가 없음. STAND 없는 FLIGHT(SURVEY·CHECK)는 PR 단계가 없어 `no-arrival`(DEPARTED 뒤 ARRIVED 보고 없음)만 본다 | SUPERVISOR |
| `landing-wait` | CLEARED 뒤 1시간 넘게 착륙 안 함(정보, 착륙은 SUPERVISOR 몫) | OCC LOG에만 |
| `review-no-pr` · `done-not-merged` | 불일치: Linear는 In Review·Done인데 PR이 없거나 머지되지 않음 | SUPERVISOR |
| `merged-not-done` | 불일치: PR은 머지됐는데 Linear가 Done이 아님(정보, CLOSE 초안 대상) | OCC LOG에만 |

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
