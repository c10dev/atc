# 조사: 개선점을 계속 찾는 상설 역할 (RELIABILITY)

[English](improvement-watch.md) · **한국어**

> 상태 (2026-10-01): 조사, 채택 전. [ATC-299](https://linear.app/vocado/issue/ATC-299/survey-a-standing-improvement-finding-role-watch-linear-the-repository)를 위해 썼다. 코드, 매뉴얼, guard, 설정, Linear 이슈, GitHub 이슈, 상태 파일을 쓰지 않았다. 6절의 후속 작업 지시서는 Linear에 만들지 않았다.

관련: [watch.md](../watch.md)(ON HOLD, 여기서 다시 열지 않는다), [duty.md](../duty.md)(IDEAS / ADOPT), [occ.md](../occ.md) 5(SCHEDULE `NEW`), [safety-report.md](../safety-report.md), [readability.md](../readability.md), [knowledge.md](../knowledge.md), [atfm.md](../atfm.md) 원칙 1(shadow first), [control-context.md](control-context.md)(세션 비용), [aviation-signals.md](aviation-signals.md).

## 질문

SUPERVISOR는 자신이 알아차리기를 기다리지 않고, atc가 무엇을 고치거나 만들어야 하는지 계속 찾아 주는 것을 원한다. 무엇을 보고, 어떻게 돌고, 발견은 어디로 가고, 어떻게 싸고 조용하게 유지하는가?

## 방법과 한계

- **사실**은 2026-10-01의 `origin/main` `338c2f4`와 같은 날 이 호스트의 상태다. Linear 그림은 atc 서버가 가진 snapshot(`GET /api/snapshot`, 466 KB, 티켓 411개 중 ATC 211개)이다. Linear를 직접 부르지 않았다.
- **Dry run.** 던질 스크립트 5개를 scratch 폴더(저장소 밖)에서 한 번씩 돌렸다. 저장소, snapshot, `~/.local/state/atc/*.jsonl`을 읽는다. **개수와 key만** 썼다. 기록 본문과 transcript는 읽지도 인용하지도 않았다. GitHub 읽기 두 번(열린 `idea` 이슈, 최근 CI 100회). 시험 서버는 필요 없었고 상태에 쓰지 않았고 세션에 메시지를 보내지 않았다.
- 5절의 **"SUPERVISOR가 받아들일까"**는 내 판단이지 측정이 아니다. 그것을 재는 것이 shadow 단계의 일이다.
- **짧은 기록.** atc 기록은 2026-09-26에 시작해 닷새다. 나이에 관한 감지기(오래된 Todo, 오래 도는 FLIGHT)는 아직 찾을 것이 없어 임계값을 시험하지 못했다.
- **선행 사례(2절)**는 인용한 표준과 도구를 내가 아는 대로 적었다. 이번에 출처를 다시 가져오지 않았으므로 알림 수준의 수치 같은 세부는 기억에 의한 것이라고 표시했다.
- **공개 저장소**: 다른 AIRPORT의 내부는 쓰지 않았다. snapshot의 두 번째 Linear 팀은 개수만 세고 설명하지 않았다.
- 지출: 세션 하나, helper agent 없음, 약 0.15 M 토큰(거친 추정, 정가로 1~2 USD).

## 요약

1. **찾을 거리의 대부분은 atc가 이미 가진 자료에 있다.** snapshot(Linear 추가 호출 0), 문서, 추가만 하는 기록. 전체를 한 번 훑는 데 CPU 약 0.15초와 GitHub REST 2회가 들었다.
2. **모델 없는 감지기도 쓸 만하지만 좁다.** 돌린 감지기 23개 중 먼저 만들 것은 3개(STATUS MARKS, PARENT CLOSABLE, IDEA ADOPTED), 싼 것은 3개(CHANGELOG PILE, MCC ESCALATE RECURRENCE, UNLABELLED)다. 나머지는 비었거나 이미 있는 화면과 겹치거나 판단 없이는 시끄러웠다.
3. **판단이 필요한 신호**("Not built yet" 항목인데 이슈 없음, 반복되는 리뷰 댓글, 매뉴얼 마찰)는 실제로 있지만 산문이다. 잡음 통제와 수용률 측정이 생긴 **뒤 두 번째**로 한다.
4. **권고: A를 shadow로, 그다음 A가 E를 먹인다.** 읽기만 하는 API 뒤의 결정적 서버 `findings` 목록, "보였을 것"으로 기록, SUPERVISOR의 판정 chip을 측정으로 쓴다. 새 세션도 모델도 권한도 없다. 3절이 선택지를 비교하고 4절이 발견의 길을 준다.

## 1. 출처별 신호

열: **종류** `D`는 결정적 검사(모델 없음), `J`는 판단 필요. **비용**은 한 번 읽는 비용. **주기**는 출처가 바뀌는 빈도. 감지기 ID는 dry run(5절)과 이어진다.

### 1.1 Linear (ATC, 두 번째 팀은 개수만)

atc 서버의 snapshot에서 읽는다. 서버가 이미 Linear를 폴링하므로 감지기는 Linear 호출을 더하지 않는다.

| 신호 | 종류 | 비용 | 주기 | 감지기 |
|---|---|---|---|---|
| 우선순위 없는 `Todo`(DISPATCH planner가 건너뜀) | D | 0(snapshot) | 분 | L1 |
| N일 동안 손대지 않은 `Todo`·`Backlog` | D | 0 | 일 | L2 |
| 하위 이슈 없는 Todo 부모, 하위가 모두 Done인 열린 부모 | D | 0 | 시간 | L3, L3b |
| `blockedBy`가 모두 닫혔는데 그대로인 열린 이슈 | D | 0 | 시간 | L4 |
| `Backlog`에 남은 높은 우선순위(1, 2) | D 다음 J(일부는 일부러 hold) | 0 | 일 | L5 |
| 갱신 없이 N일째 `In Progress` | D | 0 | 시간 | L6 |
| 분류 라벨 빠짐(`type:`, `wake:`, `rating:`) | D | 0 | 분 | L7 |
| Linear와 어긋난 설계 문서 상태 표시(행의 이슈가 Done인데 ✅ 없음) | 행 필터 뒤 D, 아니면 J | 0 + 파일 읽기 | 시간 | L8 |
| 같은 이슈가 UNABLE이나 반려를 반복, 그 이유 | 세는 것은 D, 이유 읽기는 J | 기록 | 시간 | R2, R4 |
| 설계 문서에 "as built" 절이 없는 Done 이슈 | 나열은 D, 필요 판단은 J | 0 + 파일 읽기 | 시간 | 안 돌림(이슈별 문서 대응표 필요) |

### 1.2 저장소

모두 로컬 파일이다. API가 없고 비용은 밀리초(아래 전부 파일 약 1,000개에 74 ms).

| 신호 | 종류 | 주기 | 감지기 |
|---|---|---|---|
| `*.md` / `*.ko.md` 짝이 어긋남(제목 수, 줄 비율) | D | PR마다 | D2 |
| 짝이 있어야 하는 문서에 짝이 없음 | D(루트 `CLAUDE.md`의 목록 필요) | PR마다 | D2 |
| 접지 않은 `changelog.d/` 조각(수, 나이) | D | PR마다 | D3 |
| `TODO` / `FIXME` | D | PR마다 | D4 |
| `*.test.ts`가 없는 `server/*.ts` | 나열은 D, 순수 함수인지는 J | PR마다 | D5 |
| 크거나 빨리 자라는 파일 | 지금 크기는 D, 성장은 이력 필요 | PR마다 | D6 |
| "Not built yet" 절: 항목 수와 이슈를 인용한 항목 | 절 찾기는 D, 산문을 항목으로 나누기는 **J** | PR마다 | D7 |
| 이슈가 어디에도 없는 "Not built yet" 항목 | J | PR마다 | 안 돌림 |
| 크기 예산을 넘은 매뉴얼([control-context.md](control-context.md)) | 예산이 정해지면 D | PR마다 | 안 돌림(예산 없음) |
| ratchet(CSS 토큰, rules drift) | D, 이미 있음, 각각 일회성 | PR마다 | 있음 |

### 1.3 atc 기록(`~/.local/state/atc/`, 읽기 전용)

JSONL은 추가만 한다. 2026-10-01: `proposals` 1,856줄(1.0 MB), `clearances` 627(142 KB), `mcc` 636(553 KB), `schedule` 63(22 KB), `readability` 5일(245 KB). 전부 훑는 데 31 ms이고, 커서(마지막으로 읽은 줄)를 두면 새 줄만 읽는다.

| 신호 | 종류 | 주기 | 감지기 |
|---|---|---|---|
| MCC ESCALATE 비율과 되풀이되는 이유 분류 | 세는 것은 D, 이유 분류는 **J**(거친 regex 사용) | PR마다 | R1 |
| CLEARANCE UNABLE 수와 분류 | D | CLEARANCE마다 | R2 |
| 한 FLIGHT가 CLEARANCE를 4번 이상 받음(재작업, 충돌) | D | FLIGHT마다 | R3 |
| DISPATCH 반려 사유 코드, `undelivered`, `expire`, `recall` | D | 카드마다 | R4 |
| SCHEDULE 판정 일치율과 gate | D | 판정마다 | R5 |
| READABILITY 일일 지표의 임계 초과(지연, overdue, UNABLE) | D | 매일 | R6 |
| NEEDS YOU·BLOCKED 빈도, FLIGHT 종류별 FUEL 소모, LAUNCH 거부 | D | 사건마다 | 안 돌림(job 파일과 FUEL에 있고 이 네 기록에는 없음) |
| ROLLBACK | D | 드묾 | 이 기간에는 없음 |

### 1.4 GitHub

| 신호 | 종류 | 비용 | 감지기 |
|---|---|---|---|
| job별 CI 실패 | D | REST 1회(`gh run list`, 최근 100회) | G2 |
| 설계 문서가 인용한 `idea` 이슈(채택됐는데 열려 있음) | 인용 대조는 D, 확인은 J | 1회(서버가 이미 `/api/ideas`를 냄) | G1 |
| 활동 없는 `idea` 이슈 | D | 같음 | G1 |
| 착륙 못 하고 머문 PR | D | 0(snapshot `pulls`에 `landing`과 `blocks`가 있음) | PR 화면에 이미 있음 |
| PR 사이에 반복되는 리뷰 댓글 | **J** | 호출 많음 | 안 돌림 |

idea 목록은 REST로 읽는다. `gh issue list`는 GraphQL을 쓰고 이것은 atc 서버의 폴링과 같이 쓰는 한도다([watch.md](../watch.md) 1.1: 밤샘 루프에서 매시간 바닥났다). 이번 읽기 두 번은 GraphQL 2점을 썼고, REST 형태는 그 한도를 쓰지 않는다.

## 2. 선행 사례

위 방법에 적은 대로 새로 가져오지 않고 표준과 도구를 기억해 적었다. 중요한 것은 각각이 주는 패턴이다.

| 출처 | 하는 일 | 결정적인 부분 | 모델 또는 사람 | 잡음 통제 | atc로 가져올 것 |
|---|---|---|---|---|---|
| **FOQA / FDM**(FAA AC 120-82, ICAO Annex 6, Doc 10000) | 모든 비행의 기록 자료를 정의된 **event**(매개변수가 임계를 넘음)로 훑고, 추세를 안전 그룹에 올린다 | event 감지 | 분석가가 추세를 읽고 조치를 정한다 | 비식별 자료, event 조정, 단발 초과가 아니라 **시간에 따른 비율**을 보고 | FLIGHT RECORDER와 JSONL 기록이 곧 비행 자료다. 감지기가 event이고, 단발보다 **비율**(R1, R6)을 먼저 보고한다 |
| **SMS safety assurance**(ICAO Annex 19, Doc 9859) | **alert level**과 목표가 있는 안전 성과 지표 | 지표 계산 | safety review board | 사건마다가 아니라 지표에서 울린다 | 감지기마다 alert level이 있다. 그 아래는 SUPERVISOR에게 보이지 않는다 |
| **정비 신뢰성 프로그램**(EASA Part-M AMC M.A.302, FAA 신뢰성 프로그램) | 부품별 제거·고장 비율. 이력으로 통계적으로 정한 **alert level**(보통 평균에 표준편차의 배수). 넘으면 수리가 아니라 조사 | 비율과 alert level | 엔지니어가 조사 | 수준은 그 기단의 이력으로 다시 계산하고, 비율이 돌아오면 조사를 닫는다 | atc에 아직 없는 이력(5일)이 필요하다. 처음엔 고정 임계로 하고 4주쯤 뒤 수준을 계산한다 |
| **의존성·코드 건강 bot**(Dependabot, Renovate, CodeScene식 hotspot) | 변경마다 PR 하나나 발견 하나. hotspot = 크기 × 변경 빈도 | 전부 | 없음, 또는 사람이 머지 | 묶기, 일정, 하루 한도, 무시 목록 | 하루 한도, key별 cool-down, 무시 판정이 같은 장치다(4절) |
| **예약된 agent 실행**(Claude Code `/loop`, 예약 routine, headless `claude -p`) | 모델이 고정 prompt를 타이머로 돈다 | 아니오 | 모델 | 고정 출력 파일, 고정 prompt. 비용은 실행마다 | 선택지 D. 실행당 비용은 실재하고 atc가 이미 재 두었다([control-context.md](control-context.md) 1: 서로 다른 `claude -p` 실행이 1시간 tier에서 cache를 공유한다) |
| **Linear Triage Intelligence**(idea [#155](https://github.com/chaehy5665/atc/issues/155)) | 들어오는 이슈의 라벨, 팀, 중복을 제안 | 아니오 | Linear의 모델 | 팀별 opt-in | 발견의 초안에 대한 두 번째 의견이지 발견의 출처가 아니다 |
| **CI·리뷰 이력에서 이슈 캐기** | 실패하는 검사와 반복되는 리뷰 댓글을 되풀이 원인으로 묶는다 | key별 묶기 | 사람이 원인을 이름 붙인다 | 되풀이 임계 필요 | SAFETY REPORT 임계(7일 안 2일에 3건)가 같은 생각이고 이미 설계돼 있다 |

세 항공 사례의 교훈은 같다. **규칙으로 감지하고, 비율을 세고, 수준에서 알리고, 사람이 조사한다.** 모델은 감지가 아니라 조사에 둔다.

## 3. 선택지

다섯 개를 같은 열로 비교한다. 비용은 [control-context.md](control-context.md)에서 온 추정이다(관제 세션의 tick은 cache로 약 0.2 USD, headless 실행은 1시간 tier에서 cache를 공유).

| | A. 서버 감지기, 모델 없음 | B. 새 관제 세션, 느린 tick | C. DUTY 모드 | D. 예약 headless 실행 | E. OCC SCHEDULE `NEW`로 |
|---|---|---|---|---|---|
| 스케치 | 순수 `findingsOf(snapshot, docs, records)`와 `GET /api/findings` | 읽기 전용 세션이 A의 목록을 읽고 초안을 쓴다 | DUTY에 "review" 턴을 주고 발견을 카드로 만든다 | 매일 `claude -p`나 routine, 고정 prompt, 고정 출력 파일 | 발견이 기존 한도 아래 `NEW` 초안이 된다 |
| 하루 토큰 | **0** | 매시간 tick 0.05~0.2 USD(cache), **약 1~5 USD** | 리뷰 턴마다 **약 0.2~0.5 USD**, 청할 때만 | 한 번 **약 0.3~1 USD** | OCC tick은 이미 돈다. 초안은 Linear 읽기와 CROSSCHECK 검토를 더한다 |
| GitHub 한도 | 한 번에 REST 2회(서버가 cache) | 같음, atcctl 경유 | 같음 | 실행마다 `gh` 읽기 | SCHEDULE snapshot이 이미 Linear를 읽는다 |
| 잡음 | 감지기와 한도로 정해짐(4절) | 모델이 쓴 글이라 들쭉날쭉 | SUPERVISOR가 때를 고른다 | 하루 한 보고, 피드백 고리 없음 | **한도가 이미 있다**: 열린 초안 5, 3일 만료, 중복 검색 |
| 권한이 있는 곳 | 없음: 목록만 | guard가 있는 세션, 초안만 | DUTY(결정하지 않고 말을 걸면 움직임) | 없음: 파일만 | 초안마다 SUPERVISOR 판정. **OCC는 지금 스스로 `NEW`를 쓰지 않는다**(WAYPOINT 격차 제외, occ.md 5, ATC-299 지시가 인용한 대로) |
| guard·설정 변경과 등급 | 없음. 새 `server/` 파일: **`auto`** | 새 폴더, guard, 설정, `session-control.ts`의 LAUNCH 항목: **`user`** | `duty/CLAUDE.md`와 어쩌면 `duty/guard.mjs`: **`user`** | `.claude/` 설정이나 atc 밖 타이머: **`user`**, 그리고 사람 없이 도는 모델 | `occ/CLAUDE.md`와 서버: **`flagged`**. SUPERVISOR가 정해야 할 **규칙 변경** |
| 겹침 | READABILITY, SAFETY REPORT S1(같은 패턴, 다른 출처) | WATCH(on hold), CROSSCHECK | DUTY IDEAS / ADOPT | WATCH의 밤샘 루프(피해야 할 모양: 매번 전부 다시 읽음) | SCHEDULE `NEW` / CHARTER DESK |
| shadow로 시작 | **가능**: "보였을 것"의 `findings.jsonl` | 가능하나 세션은 첫 tick부터 돈이 든다 | 가능 | 가능(파일만) | 가능: SCHEDULE shadow gate가 이미 있다 |
| 판단 신호 | 아니오 | 예 | 예 | 예 | A나 모델이 주는 경우만 |

**권고: A를 shadow로, 나중에 A가 E를 먹인다.** 이유:

1. **비용과 한도.** A는 토큰도 Linear 호출도 0이다. snapshot이 이미 서버에 있기 때문이다. B와 D는 150 ms짜리 함수가 찾는 것을 찾으려고 모델 실행을 더한다.
2. **밤샘의 교훈.** ENGINEERING 루프는 tick마다 전부 다시 읽었고 43번 중 40번이 "unchanged"였다([watch.md](../watch.md) 1.1). 발견의 지문(key 집합)을 두면 바뀐 것이 없는 pass는 비용이 없다. SUPERVISOR는 **새 key**가 생길 때만 건드린다.
3. **권한은 SUPERVISOR에게 남는다.** A는 나열한다. SUPERVISOR가 누르기 전에는 아무것도 만들어지지 않고, 누른 뒤의 길은 기존 것이다(DUTY ADOPT, 나중에 `NEW` 초안). 첫 단계에 guard 변경이 없으므로 `auto`다.
4. **스스로를 잰다.** 감지기별 판정 chip이 감지기를 남길지 정하는 수용률 측정이다(4절). 모델 실행 선택지는 어차피 이 측정부터 만들어야 한다.
5. **설계된 것을 재사용한다.** SAFETY REPORT S1이 같은 묶음, 임계, `safety:<key>` INFO alert 모양을 이미 정했다. READABILITY가 이미 radio 수치를 가진다. A는 그 둘이 덮지 않는 출처에 같은 패턴을 쓴다.

**shadow의 첫 단계.** `findingsOf`와 `GET /api/findings`를 감지기 6개로 내고, pass마다 새 key를 `findings.jsonl`에 `would-show`로 기록하고, 화면에는 **아무것도** 보이지 않는다. 두 주 동안 표본을 손으로 표시해 SUPERVISOR가 받아들였을 것을 센다. 그다음에 판정과 함께 보인다(작업 지시서 3).

**지금은 기각:** B(목록을 읽으려는 세션은 새 정보 없는 모델 실행이고 guard가 필요), D(사람 없는 모델과 설정 변경, 피드백 측정 없음), 첫 단계로서의 C(그러면 DUTY가 볼 때를 정하므로 청해야만 발견이 온다. 발견의 맞는 *소비자*이고 작업 지시서 5가 그것이다). E는 일부 수용된 발견 종류의 맞는 *종착점*이지만, SUPERVISOR가 정한 규칙("OCC는 스스로 `NEW`를 쓰지 않는다")을 바꾸므로 7절의 결정 2를 기다린다.

## 4. 발견의 길과 잡음 통제

### 4.1 발견은 어디로 가나

```
감지기(서버, 순수) → 발견 목록(GET /api/findings, findings.jsonl)
   → SUPERVISOR가 본다: INFO alert key `finding:<key>` + 화면의 목록
   → SUPERVISOR 판정: ACCEPT(+ DUTY에 보냄) · DISMISS(+ 이유 chip) · SNOOZE
   → ACCEPT → DUTY에 ADOPT 모양의 메시지 → 작업 지시서(Backlog / Todo)
   (나중에, 종류별로, 수용 gate 통과 뒤) → SCHEDULE `NEW` 초안(E)
```

- **결정은 늘 SUPERVISOR.** 발견은 그 자체로 Linear 이슈, GitHub 이슈, 팀에 보내는 메시지가 되지 않는다.
- **표면:** 새 key마다 INFO alert 하나(SAFETY REPORT S1 패턴)와 목록. 목록의 자리(자기 탭, DISPATCH 탭, IDEAS 같은 drawer)는 결정 3이다.
- **사업·비공개 아이디어**는 이 목록에 들어오지 않는다. 공개 저장소와 ATC 팀만으로 만든다.

### 4.2 이미 있는 것과의 중복 제거

발견은 다음이면 버리거나 `similar`로 표시한다.

- **key**(`<감지기>:<대상>`)가 열려 있거나 snooze 중이거나 cool-down 안에 있다(아래).
- `similarTickets(title, tickets, now)`(`server/schedule.ts`)가 열린 이슈나 45일 안에 닫힌 이슈에서 찾는다. SCHEDULE의 중복 검색을 그대로 쓴다.
- 열린 `idea` 이슈 제목과 문서 "Not built yet" 절의 글에도 같은 검사(토큰 대조)를 한다. [knowledge.md](../knowledge.md)의 knowledge index가 생기면(ATC-105~107) 그것이 대신한다.

### 4.3 임계와 한도(제안, shadow에서 조정)

| 통제 | 제안 | 이유 |
|---|---|---|
| 감지기별 임계 | 감지기 옆에 적은 고정값. 이력이 4주쯤 쌓이면 이력으로 alert level 계산(2절, 신뢰성 프로그램) | atc 이력은 5일 |
| 단발보다 비율 | R 감지기는 한 줄이 아니라 비율(예: 7일 안 2일에 3건, SAFETY REPORT 임계)에서 울린다 | escalate 한 번은 결정이고 다섯 번은 패턴이다 |
| 하루 한도 | 하루 새 발견 3건까지 보이고 나머지는 감지기 가치 순으로 보류 | `SCHEDULE_OPEN_LIMIT`(열린 5)와 같은 취지 |
| 열린 한도 | 열린 발견 5건. 하나가 결정되면 새것이 나온다 | SCHEDULE과 같음 |
| key별 cool-down | DISMISS 14일. SNOOZE는 snooze가 끝날 때까지. ACCEPT는 작업 지시서가 닫힐 때까지 | 닦달하지 않는다 |
| 바뀐 것 없으면 조용 | key 집합이 지난 pass와 같으면 쓰지도 알리지도 않는다 | 밤샘의 교훈 |
| pass 주기 | snapshot이 이미 바뀌는 시점(머지 때 문서, 폴링 때 티켓), 그 밖에는 매시간 | pass 한 번이 약 0.15초 |

### 4.4 수용률 측정

감지기별로 `findings.jsonl`의 판정에서: 최근 14일 **accepted / (accepted + dismissed)**, `snoozed`는 따로 센다.

- 판정 10건 이상에서 50% 이상이면 **켜 둔다**.
- 판정 10건 이상에서 20% 미만이면 **shadow로 되돌린다**(WATCH 규칙: 개입이 그 종류를 되돌린다, [watch.md](../watch.md) 2절 원칙 5).
- DISMISS 이유는 chip(`already-known`, `not-worth-it`, `wrong`, `later`)이라 감지기를 끄기만 하지 않고 고칠 수 있다. `wrong`은 두 배로 센다.
- gate는 SCHEDULE 패턴(`gateOf`: 최소 판정 수와 비율)을 따르되 숫자는 낮다. DISMISS가 SCHEDULE 초안을 적용하는 것보다 싸기 때문이다.

## 5. Dry run 결과

2026-10-01 약 06:30Z에 돌렸다. scratch 스크립트이고 저장소에 없다. pass 비용: **저장소 74 ms(파일 약 1,000개)**, **Linear 감지기 11~27 ms(466 KB snapshot, Linear 호출 0)**, **기록 31 ms(JSONL 2.0 MB)**, **GitHub 읽기 2회(REST 상당)**. 전체 약 0.15초, 모델 토큰 없음.

### 5.1 수치

| ID | 감지기 | 발견 | 내 필터 뒤 | 비고 |
|---|---|---|---|---|
| L1 | 우선순위 없는 `Todo` | 원본 2, **0** | 0 | 둘 다 `Exit:` 이슈(설계상 우선순위 없음). 제목 접두어 제외가 필요 |
| L2 | 14일+ 손대지 않은 Todo/Backlog | 0 | 0 | atc가 5일: 시험 불가 |
| L3 | 하위 없는 Todo 부모 | 0 | 0 | |
| L3b | 하위가 모두 Done인 열린 부모 | **1** | 1 | ATC-275 |
| L4 | blocker가 모두 닫힌 Todo/Backlog | **12** | Todo 4 | Backlog 8건은 일부러 둔 것(부모, 재검토). Todo는 DISPATCH가 이미 보여 준다 |
| L5 | Backlog의 우선순위 1·2 | 5 | 0 | 전부 WATCH(on hold, ATC-223~226)나 ALERTING 단계. hold 표시가 필요하고 그것은 판단이다 |
| L6 | 3일+ 갱신 없는 In Progress | 0 | 0 | |
| L7 | `type:` 라벨 없는 열린 이슈 | 6 | 4 | 둘은 `Exit:` 이슈. `wake:` 빠짐도 같은 6건 |
| L8 | 설계 문서 행의 이슈가 Done인데 ✅ 없음 | **17** | 약 7 | 6행 손 확인: 3건 진짜, 3건은 "의존" 언급. **행의 첫 칸** 필터가 필요 |
| D2 | `*.md`/`*.ko.md` 짝 어긋남 | **0** | 0 | 필수 짝 가운데 어긋난 것 0. 첫 실행은 `.ko.md` 없는 `docs/*.md` 21개를 표시했지만 루트 `CLAUDE.md`는 이름 붙은 목록에만 짝을 요구하므로 감지기에 그 목록이 필요 |
| D3 | 접지 않은 `changelog.d` 조각 | **130**(65쌍) | 발견 1 | 가장 오래된 것이 2026-09-29. 130건이 아니라 "접어라" 하나 |
| D4 | `TODO` / `FIXME` | 원본 2 | 0 | 둘 다 Follow 단계 라벨의 "TODO" 낱말. 진짜는 없음 |
| D5 | 테스트 없는 `server/*.ts` | 152개 중 23 | 약 5 | 위: `snapshot.ts` 383줄, `index.ts` 338, `model.ts` 284, `events.ts` 136, `recorder.ts` 123. 대부분 배선이고 순수 로직이 든 것은 사람이 가려야 한다 |
| D6 | 1,000줄 넘는 소스 | 7 | 발견으로는 0 | `Dispatch.tsx` 1,642, `globe-geo.ts` 1,626(데이터), `proposals.ts` 1,519, `Schedule.tsx` 1,372, `schedule.ts` 1,188, `atcctl.mjs` 1,019, `dispatch.ts` 1,012. 성장은 이력이 필요 |
| D7 | "Not built yet" 절 | 문서 13 | n/a | 절이 산문이다. 내 항목 세기가 13개 중 9개에서 0을 냈다. 판단(모델)이 필요한 감지기이고 지금은 못 쓴다 |
| R1 | MCC ESCALATE | INSPECTION 177 중 23(13%) | **추세 1** | 23건 중 15건의 이유가 운영 상태 형식 변경, 7건이 `user` 등급 파일, 1건 기타(regex 분류) |
| R2 | CLEARANCE UNABLE | 314 중 14(4.5%) | 0 | READABILITY가 이미 분류한다 |
| R3 | CLEARANCE 4번 이상 받은 FLIGHT | 7 | 2 | 7건 중 5건은 두 번째 팀 것. `ATC-129`와 `ATC-219`가 atc 것 |
| R4 | DISPATCH undelivered / reject / expire | undelivered 8, reject 5, expire 17 | 1 | undelivered 8건 중 6건이 "그 이름의 agent 없음": ATC-251의 알려진 원인 |
| R5 | SCHEDULE 판정 | 13(일치 10, 불일치 3) | 0 | 판정 20건 gate에 못 미침. 발견이 아니라 진행 수치 |
| R6 | READABILITY, 마지막 날 | 139건, p90 25.6초, overdue 1 | 0 | 임계가 아직 없음 |
| G1 | 설계 문서가 인용한 `idea` 이슈 | 열린 14개 중 **6** | 4 | `#246`, `#271`, `#154`, `#280`은 설계 문서나 만든 기능이 있다. `#41`, `#96`은 비교나 부분 인용. 지시서에 낡았다고 적힌 `#121`은 **이미 닫혔다**(2026-09-30) |
| G2 | job별 CI 실패 | 최근 100회 중 **0** | 0 | `ci` 실행이 모두 성공 |

### 5.2 표본과 내 판단

"Accept"는 SUPERVISOR가 움직였을 것이라고 내가 보는 것이다. 측정이 아니다.

| 감지기 | 표본(5) | 내 판단 |
|---|---|---|
| **L8 STATUS MARKS** | `knowledge.md:206`(ATC-104 Done, 행에 ✅ 없음), `mac-app.md:75`(ATC-152 Done), `launch.md:279`, `launch.md:287`, `alerting.md:186` | **5건 중 2건 Accept**(앞의 둘). 나머지 셋은 이슈를 의존으로 언급한 것이라 첫 칸 필터가 걸러 낸다. 필터 뒤에는 대부분 진짜일 것으로 본다 |
| **L3b PARENT CLOSABLE** | ATC-275(FOLLOW board, Backlog, 하위 3/3 Done) | **Accept**(부모를 닫는다). 지금은 1건이지만 DUTY가 머지 뒤에 하는 바로 그 잡일이다 |
| **G1 IDEA ADOPTED** | `#246`(SAFETY REPORT 설계 있음), `#271`(DUTY chat 만듦), `#154`(Linear Releases 설계), `#280`(GLOBE 단계별로 만듦), `#41`(비교로 인용) | **5건 중 4건 Accept**: 링크를 달아 닫거나 라벨을 바꾼다. `#41`은 비교이므로 DISMISS |
| **D3 CHANGELOG PILE** | 발견 하나: 조각 130개, 가장 오래된 것 2026-09-29 | **Accept**, 가치는 낮다: 기존 명령이 있는 ENGINEERING이나 SUPERVISOR의 잡일 |
| **R1 MCC ESCALATE RECURRENCE** | 발견 하나: ESCALATE 23건 중 15건이 운영 상태 형식 변경 | **Accept**: 팀이 ESCALATE로 알게 되지 않도록 이 규칙을 더 일찍(`atc-task`나 `landing-tier`에서) 검사할 수 있는지 묻는다. 이번 실행에서 가장 "개선" 같은 발견 |
| **L4 UNBLOCKED** | ATC-262, ATC-263(ATC-260·ATC-291이 풀려 Done), ATC-296, ATC-287 | **감지기로는 기각**: DISPATCH가 이미 ready로 보여 준다. 중복이며 이는 중복 제거 규칙이 된다(화면이 이미 보여 주는 것은 보고하지 않는다) |
| **L5 BACKLOG HIGH** | ATC-223, 224, 225, 226(WATCH, 일부러 hold), ATC-203 | **기각**: 5건 중 4건이 의도한 hold. hold 표시 없이는 잡음 |
| **D5 NO TEST** | `snapshot.ts`, `index.ts`, `model.ts`, `events.ts`, `recorder.ts` | **지금은 기각**: 단위 시험이 필요 없는 배선 파일. 순수성 검사가 필요하고 그것은 판단 |
| **D7 NOT BUILT YET** | 절 13개, 대부분 산문 | **판단 불가**: 항목을 아직 못 나눈다. 2단계(모델) 감지기 |

### 5.3 실행이 말해 주는 것

- **먼저 3개, 싼 것 3개, 버릴 것 3개.** dry run의 정밀도가 높은 것은 **두 기록의 상태 불일치**(L8, L3b, G1)나 **비율**(R1)일 때뿐이다. 기록 하나에서 "오래돼 보인다"를 찾는 감지기(L2, L5, D5, D6)는 이 이력에서는 잡음이거나 비었다.
- **중복이 가장 큰 잡음 출처.** L4, R2, R4가 각각 화면이나 READABILITY와 겹친다. 4.2에 규칙이 하나 생긴다: SUPERVISOR가 이미 화면에서 보는 것은 발견이 아니다.
- **0도 결과다.** D2(어긋난 짝 0)와 G2(실패한 CI 0)는 감지기가 절차가 건강하다고 말하는 것이다. 감지기별로 0이 아닌 것만 보이는 finder는 조용하다.
- **regex 분류(R1, R2)는 거칠었다.** R2는 14건을 한 분류에 넣었다. 이유 글을 읽는 것은 판단이고 읽지 않았다. `reasonCodes`가 있는 곳(DISPATCH reject에 있다)에서는 그것으로 세는 것이 결정적이라 낫다.

## 6. 감지기 순위와 후속 작업 지시서

### 6.1 만드는 순서(가치 ÷ 노력)

| 순위 | 감지기 | 가치 | 노력 | 이 순위인 이유 |
|---|---|---|---|---|
| 1 | **STATUS MARKS**(L8) | 높음: DUTY가 맡은 "머지 뒤 ✅ 표시" 잡일을 대신한다 | S: snapshot과 문서 위의 순수 함수 하나와 행 필터 | 필터 뒤 정밀도가 가장 높고 머지마다 같은 검사가 반복된다 |
| 2 | **IDEA ADOPTED**(G1) | 중간: `idea` 이슈를 정직하게 유지 | S: `/api/ideas` 재사용 | 오늘 진짜 4건 |
| 3 | **PARENT CLOSABLE**(L3b) | 중간 | S | `closableOf`(CLOSE)를 보완. 지금은 1건 |
| 4 | **MCC ESCALATE RECURRENCE**(R1) | 건당 높음, 드묾 | S: `mcc.jsonl` 위의 비율 | 이번 실행에서 "규칙을 개선"하는 가장 좋은 발견 |
| 5 | **CHANGELOG PILE**(D3) | 낮음 | XS | 싸다. 저장소 감지기의 모양을 보여 준다 |
| 6 | **UNLABELLED**(L7) | 낮음 | XS | 진짜 4건. `Exit:` 제외가 필요 |
| 7 | **필수 `.ko.md` 짝**(D2) | 지금은 낮음(0), 규칙을 지킨다 | S | 루트 `CLAUDE.md`의 이름 붙은 목록이 필요. ATC-294처럼 ratchet으로 낸다 |
| 8 | job별 CI 실패율(G2) | 오늘 0, CI가 깨지는 날 높음 | S | REST 1회. alert level은 이력에서 |
| – | 버림: L4, L5(hold 표시 없이), D5, D6, D4, R2, R4 | | | 중복, 잡음, 또는 빔 |
| – | 2단계, 모델: D7(이슈 없는 not-built-yet 항목), 리뷰 댓글 반복 | 높음 | M, 수용률 측정이 먼저 | shadow 측정이 생긴 뒤 |

### 6.2 후속 작업 지시서(Linear에 만들지 않음)

각각 FLIGHT 하나 크기다. 1~4와 6은 guard 변경 없는 서버·화면 작업이다. `auto`를 예상하고, 새 추가 전용 파일 하나를 쓰는 서버 코드는 많아야 `flagged`다. 실제 등급은 바뀐 경로로 `deploy/landing-tier.mjs`가 정한다.

| # | 제목 | 범위 | 예상 등급 |
|---|---|---|---|
| 1 | **FINDINGS core, shadow** | `server/findings.ts`: `Finding {key, detector, subject, title, evidence[], at}` 타입, 순수 `findingsOf(snapshot, docs, records)`, key 집합 지문, cool-down, 하루·열린 한도. `server/findings-run.ts`가 기존 snapshot 폴링에 얹혀 돌며 `~/.local/state/atc/findings.jsonl`에 `would-show`를 추가. `GET /api/findings`(읽기 전용). fixture 시험. 화면 없음, alert 없음. 파일은 새것이고 추가 전용 | `auto`(새 상태 파일 때문에 `flagged`일 수 있음) |
| 2 | **FINDINGS 감지기, 1차 묶음** | `server/findings-detectors.ts`에: STATUS MARKS(행의 첫 칸이 key, Done, ✅ 없음. "Implementation order" 표만), IDEA ADOPTED(문서가 인용한 열린 `idea`, 서버의 기존 ideas 가져오기 사용), PARENT CLOSABLE, MCC ESCALATE RECURRENCE(7일 안 3건, escalate 이유로 분류), CHANGELOG PILE(조각 40개 초과 또는 가장 오래된 것이 3일 초과), UNLABELLED(`Exit:` 제외). 감지기마다 순수 함수 하나와 시험 | `auto` |
| 3 | **FINDINGS 화면과 판정** | ALERTING을 통한 새 key마다 INFO alert `finding:<key>`(SAFETY REPORT S1 모양), 목록(자리는 결정 3), ACCEPT, 이유 chip이 있는 DISMISS, SNOOZE. 판정 줄은 `fromThisApp` 경로로 `findings.jsonl`에 추가. [design-language.md](../design-language.md) 3.5와 5절 점검표를 따르고 `ui-review`를 돌린다 | `auto`(web) 또는 `flagged` |
| 4 | **FINDINGS gate와 수용률 측정** | 감지기별 `findingGateOf`(순수, 시험): 14일 안 판정 10건 이상에서 accepted/decided. 20% 미만이면 자동으로 shadow로 복귀. 감지기 옆에 수치 표시 | `auto` |
| 5 | **FINDINGS를 DUTY로** | ACCEPT가 DUTY에 ADOPT 모양의 메시지(ADOPT처럼 서버가 글을 만든다)를 보낸다. `duty/CLAUDE.md`와 `CLAUDE.en.md`에 짧은 "FINDING" 절. `duty message`가 이미 나른다면 guard 변경 없음 | `user`(`duty/`) |
| 6 | **FINDINGS 중복 제거: idea와 "Not built yet"** | `similarTickets`의 토큰 논리를 공용 helper로 빼고 idea 제목과 문서 절 출처를 더한다. 나중에 knowledge index로 교체 | `auto` |
| 7 | **SURVEY 또는 만들기: 2단계 모델 감지기** | 어떤 판단 신호가 모델 턴을 받을 만한지(이슈 없는 Not-built-yet 항목, 반복되는 리뷰 댓글, SAFETY REPORT를 통한 매뉴얼 마찰)와 어떤 소비자로(DUTY 턴, 또는 고정 출력 파일의 하루 한 번 `claude -p`). 작업 지시서 1~4가 수용률을 보인 뒤에만 시작 | `auto`(docs) |
| 8 | **감지기가 아닌 잡일: 조각 130개 접기와 채택된 idea 4개 닫기** | `node server/changelog-fold.ts`. SUPERVISOR나 DUTY가 `#246`, `#271`, `#154`, `#280`을 설계 문서 링크와 함께 닫는다 | n/a(사람) |

처음 넷은 DUTY나 WATCH와 무관하다. 작업 지시서 5는 DUTY L1을 켜야 한다(`duty.json`, 기본 꺼짐).

## 7. SUPERVISOR가 정할 것

1. **A를 shadow로 갈지(작업 지시서 1, 2)와 이름.** 역할 이름은 **RELIABILITY**를 제안한다(정비 신뢰성 프로그램에서: 비율, alert level, 사람의 조사). 그 안의 기록 기반 감지기 이름은 FOQA다. 문서 이름 `improvement-watch`는 유지했다. 다른 이름이 좋으면 말해 달라.
2. **나중에 발견이 OCC의 자체 판단으로 SCHEDULE `NEW` 초안이 되어도 되는가**(선택지 E)? 지금 `occ.md` 5(지시서가 인용한 대로)는 WAYPOINT 격차를 빼고 OCC가 하지 않는다고 한다. 제안: 감지기가 판정 10건과 수용률 50%를 채우기 전에는 안 한다. 한 번에 한 종류씩, SCHEDULE의 한도 그대로. SUPERVISOR가 정한 규칙을 바꾸므로 당신의 결정이다.
3. **목록은 어디에 두나?** IDEAS 같은 drawer(`#findings`), DISPATCH 탭의 카드, 자기 탭. drawer가 가장 싸고 "읽고 DUTY에 보낸다"에 맞다.
4. **Linear 팀 범위.** 제안 기본값: ATC만(`dispatch.json`의 `candidateTeams`). 두 번째 팀의 발견은 그 팀 소유자가 필요하다. 두 번째 팀을 넣으려면 말해 달라.
5. **4.3과 4.4의 한도와 gate 숫자**(하루 3, 열린 5, cool-down 14일, 판정 10건에서 50%와 20%). shadow의 출발점이지 규칙이 아니다. 확인하거나 바꿔 달라.
6. **판단 신호용 모델(2단계).** 작업 지시서 1~4 전에는 필요 없다. 하루 모델 실행의 지출 한도(약 0.3~1 USD)는 나중에 정할 일이다.

## 이 조사가 말하지 않는 것

- "받아들일 것" 판단은 내 것이다. 4.4의 수용률은 결과가 아니라 목표다.
- R1과 R2의 regex 분류는 거칠고 이유 글을 읽지 않았다.
- 선행 사례(2절)는 기억에 의한 것이고 다시 가져오지 않았다. alert level의 수치 정의와 문서 번호는 설계에 인용하기 전에 확인해야 한다.
- 시간 기반 감지기(L2, L6, D6 성장)는 닷새 이력으로 시험하지 못했다.
- 선택지 B, C, D의 비용 추정은 새 측정이 아니라 ATC-274의 관제 세션 수치를 쓴다.
- transcript는 읽지 않았다. [safety-report.md](../safety-report.md)의 후보 신호인 세션별 SUPERVISOR 개입은 표에 없다.

## 출처

2026-10-01 `origin/main` `338c2f4`: `docs/`(occ, duty, watch, safety-report, readability, knowledge, atfm, mcc, design-language), `server/schedule.ts`(`similarTickets`, `SCHEDULE_OPEN_LIMIT`, `gateOf`), `deploy/landing-tier.mjs`, `changelog.d/`. 2026-10-01 이 호스트의 상태: `GET /api/snapshot`과 `~/.local/state/atc/{proposals,clearances,mcc,schedule,readability}.jsonl`(개수만). GitHub: `chaehy5665/atc`의 열린 `idea` 이슈와 최근 `ci` 100회. 2절의 표준(FAA AC 120-82, ICAO Annex 19와 Doc 9859, EASA Part-M AMC M.A.302)은 기억에 의한 것이다.
