# 2단계 DISPATCH 설계 (초안)

[English](dispatch.md) · **한국어**

DISPATCH는 **어떤 FLIGHT(Linear 티켓)를 어떤 AIRCRAFT(팀 세션)에, 언제 보낼지** 제안한다. TOWER(1단계)가 이미 뜬 AIRCRAFT끼리 부딪히지 않게 하는 쪽이라면, DISPATCH는 뜨기 전의 계획을 맡는다. 항공사 운항관리(OCC)와 ATC가 나뉘어 있는 것과 같은 구분이다.

> 상태: DISPATCH 세션은 2026-09-26 OCC 세션(`atc/occ/`, [occ.ko.md](occ.ko.md))에 합쳐졌다. 아래 일은 그대로다. 2a(그림자 운용) 운용 중, 2b(승인 운용)는 `mode` 뒤에 구현돼 있고 기본은 꺼짐(2026-09-26). "2b 켜는 법" 참고. 결정 사항은 맨 아래 "결정"에 있다.
>
> 구현하며 정리한 것: TEAM당 동시 FLIGHT 1 규칙에 따라, 끝나지 않은 FLIGHT의 STAND를 쥔 HOLDING AIRCRAFT에는 대기 시간과 상관없이 STAND가 필요한 FLIGHT를 배정하지 않는다(5.1의 "30분" 기준은 쓰지 않음). STAND가 필요 없는 `SURVEY`·`CHECK`는 하나 받을 수 있다([fleet.ko.md](fleet.ko.md) 5.1, 2026-09-27). RELEASE는 AIRPORT에 매핑된 프로젝트(코드 작업)만 본다.

## 1. 지금 사실

| 항목 | 현재 |
|---|---|
| 배정 방식 | 사용자가 TEAM 세션(CAPTAIN)에 직접 말한다. CAPTAIN이 Linear 이슈를 찾거나 만들고 In Progress로 둔다(vocado `CLAUDE.md`: "Linear에는 리더만 쓴다") |
| 열린 FLIGHT | 30건. Todo 7 · In Progress 17 · In Review 6 · Backlog 0 |
| Linear 데이터 | 추정치 0건, 사이클 0건, 라벨 0건. 프로젝트는 30건 모두 있음(Beta Readiness, Song Experience, Vocado Pre-seed IR & Pitch Deck, Vocado Visual System (SEED)). blocks 관계 3개, related 76개. 담당자는 거의 모두 사용자 한 명 |
| 붐비는 정도 | In Progress 17건 중 STAND(워크트리)가 없는 FLIGHT가 늘 몇 건 있다(NO CONTACT 경보) |
| 다른 운항사 | Symphony(`vocado_nextjs/WORKFLOW.md`): `symphony-pilot` 라벨 + Beta Readiness 티켓을 Codex로 하나씩 처리. 지금 이 머신에서는 돌지 않음 |
| TOWER | 1단계 완료, 1.5단계 FLIGHT RECORDER·METRICS로 운용 데이터를 모으는 중 |

이 사실에서 나오는 제약:

- 추정치가 없으므로 **용량은 포인트가 아니라 건수(슬롯)** 로 잰다.
- 담당자로는 팀을 구분할 수 없으므로 **팀 적합도는 과거 운항 이력**(어느 팀이 관련 FLIGHT를 날았나)으로 추정한다.
- 라벨이 없으므로 위험 작업(DB·보안·권리)은 **티켓 본문**에서 읽어야 한다. 규칙 계산이 아니라 DISPATCH 세션(LLM)의 몫이다.
- Backlog는 비어 있고 Todo가 곧 "출발 대기"다.

## 2. 원칙

1. **제안만 한다, 결정은 SUPERVISOR(사용자).** 3단계(ATFM) 전까지 자동 배정은 없다.
2. **처음에는 그림자 운용(shadow).** 제안을 만들고 화면에만 보인다. 아무에게도 보내지 않고, 사용자가 "나라면 승인/거절"을 표시해 제안의 질을 잰다.
3. **Linear에 쓰지 않는다.** 승인된 FLIGHT PLAN을 받은 CAPTAIN이 지금처럼 Linear를 다룬다. 그래서 "Linear에는 리더만 쓴다" 규칙을 바꿀 필요가 없다.
4. **점수는 계산, 판단은 사람과 LLM.** 후보 고르기와 점수는 atc 서버의 순수 함수(테스트 가능, 이유가 보임)로 하고, 티켓 본문의 숨은 제약 읽기와 FLIGHT PLAN 문구는 DISPATCH 세션이 한다.
5. **TOWER와 섞지 않는다.** 배정한 쪽이 그 결과(LOS)를 심판하지 않도록 세션을 나눈다. DISPATCH도 코드를 만지지 않는다(TOWER와 같은 guard).
6. **사람이 직접 한 배정이 우선.** 사용자가 TEAM에 직접 일을 주면 DISPATCH는 그걸 따라간다(해당 제안은 superseded).

## 3. 역할과 권한

| 역할 | 누구 | 하는 일 | 쓸 수 있는 것 |
|---|---|---|---|
| SUPERVISOR | 사용자 | 제안 승인·거절, 슬롯·가중치 조정, 최종 권한 | 전부 |
| DISPATCH | OCC 세션(`atc/occ/`, 전 `atc/dispatch/`) | 제안 검토(본문 읽기), 승인된 FLIGHT PLAN 전달, 수락 기록 | atc CLI, SendMessage, Linear **읽기** |
| TOWER | 1단계 CONTROLLER | 충돌·HANDOFF·LANDING SEQUENCE | atc CLI, SendMessage |
| CAPTAIN | 각 TEAM 리더 | FLIGHT PLAN 수락(READBACK) 또는 사유 회신, Linear 상태 변경, STAND 준비 | 자기 저장소, Linear |
| Symphony | 다른 운항사 | `symphony-pilot` FLIGHT | DISPATCH는 건드리지 않음 |

## 4. 제안의 종류

| 종류 | 뜻 | 예 |
|---|---|---|
| `ASSIGN` | FLIGHT를 AIRCRAFT에 배정 | VOC193 → BRAVO (VCDO) |
| `HOLD_DEPARTURE` | 지금은 출발시키지 말 것 | VOC192는 VOC191(blocks)이 ARRIVED 될 때까지 대기 |
| `RELEASE` | STAND도 활동도 없는 ENROUTE FLIGHT를 정리 | VOC34: 7일째 STAND 없음 → Todo로 되돌릴지 SUPERVISOR 확인 |
| `REPOSITION` | AIRCRAFT를 다른 AIRPORT로(3단계 전까지는 드묾) | DSGN FLIGHT가 쌓였는데 DSGN 소속 AIRCRAFT가 없음 |

첫 구현은 `ASSIGN`과 `RELEASE`만. `RELEASE`는 In Progress 17건 중 방치된 것을 정리하는 효과가 크고 위험이 낮다(Linear 변경은 SUPERVISOR/CAPTAIN이 한다).

## 5. 판정

### 5.1 후보

- **AIRCRAFT**: 살아 있는 TEAM 세션(이름 규칙 `TEAM_X`) 중
  - PARKED(대기, STAND 없음) → 배정 가능
  - HOLDING(대기, STAND 있음) → 마지막 활동이 N분(기본 30) 넘게 없으면 배정 가능, 아니면 마무리 중으로 봄
  - AIRBORNE, NORDO → 불가
  - 복창하지 않은 FLIGHT PLAN이 있으면 불가(한 번에 하나)
  - **STAND 없는 FLIGHT**(`type:SURVEY`, `type:CHECK`): STAND 규칙으로 짝을 지은 뒤, HOLDING·PARKED AIRCRAFT가 그 규칙 밖으로 하나 더 받을 수 있다. 진행 중인 제안까지 세어 AIRCRAFT당 STAND 없는 FLIGHT 1건, 한 계획에서 AIRCRAFT당 제안 1건, WAKE 슬롯은 같이 센다. AIRBORNE은 받지 않는다. `CHECK`는 검토 대상을 만든 AIRCRAFT에 주지 않는다. 규칙은 [fleet.ko.md](fleet.ko.md) 5.1·5.2
- **FLIGHT**: Todo 상태이고
  - **상위 이슈**(하위 이슈를 묶는 컨테이너)가 아님 — 5.1.1
  - `symphony-pilot` 라벨 아님
  - 아직 ARRIVED 되지 않은 FLIGHT에 blocks 당하지 않음(당하면 `HOLD_DEPARTURE`)
  - 이미 STAND가 있거나 누가 점유 중이 아님
  - 프로젝트가 매핑된 AIRPORT가 운항 중(OPEN)
  - 우선순위가 정해져 있음(No priority는 사람이 아직 언제 할지 정하지 않은 것이라 제외)
  - LOGBOOK에 이미 ARRIVED로 없음(PR이 머지됐으면 Linear가 아직 Todo여도 제외), 열린 PR(Draft 포함)도 없음

#### 5.1.2 제외 사유

`ASSIGN`에서 빠진 FLIGHT는 모두 "제외" 목록에 아래 사유 중 하나로 뜬다. 열린 제안이 닫힐 때(SUPERSEDED)도 같은 문구를 써서 DISPATCH 탭에서 이유가 보인다. 이 순서로 본다.

| 규칙 | 보이는 사유 | 도입 |
|---|---|---|
| 상위 이슈(5.1.1) | `상위 이슈 — 하위 N건을 묶음` | |
| 다른 운항사 라벨 | `라벨 symphony-pilot (다른 운항사)` | |
| 매핑 없는 프로젝트, 닫힌 AIRPORT | `배정 제외 프로젝트: <프로젝트>`, `프로젝트 없음`, `<CODE> AIRPORT가 운항 중이 아님` | |
| **이미 완료됨**: 그 FLIGHT의 PR이 LOGBOOK에 ARRIVED로 있고 되돌리지 않음([fleet.ko.md](fleet.ko.md) 7.1) | `이미 완료됨 — PR <repo>#N 머지됨(LOGBOOK)` | 2026-09-27 |
| **작업 중**: ticket key가 그 FLIGHT인 열린 PR(Draft 포함) | `열린 PR #N 있음` | 2026-09-27 |
| **FLIGHT 보류**: 최근 24시간 안에 FLIGHT 칩으로 거절된 ASSIGN이 있고, 그 뒤로 이슈가 바뀌지 않음(6.1) | `FLIGHT 보류 — <칩> (D-xxxx 판정) — 이슈가 바뀌거나 MM-DD HH:MM부터 다시` | 2026-09-27 |
| 워크트리(STAND)가 이미 있음 | `이미 STAND가 있음` | |
| 진행 중인 제안·HOLD가 있음 | `진행 중인 제안 D-xxxx`, `HOLD D-xxxx — …` | |
| 배정 가능한 AIRCRAFT가 모두 최근 24시간 안에 이 FLIGHT와 제안됐다 닫힌 짝(6.1) | `24시간 안에 제안된 짝(D-xxxx) — MM-DD HH:MM부터 다시` | 2026-09-27 |
| 우선순위 없음 | `우선순위 없음 — 사람이 정할 때까지 배정하지 않음` | |
| `wake:J` | `wake:J — 너무 커서 배정하지 않음, 나눠야 함(SPLIT)` | |
| TAIL ASSIGNMENT, TYPE RATING, CREW([fleet.ko.md](fleet.ko.md) 5장) | `tail:TEAM_X — …`, `rating:SEC — …`, `type:BUILD — …` | |
| **CHECK 독립성**: `CHECK`가 검토하는 것을 만든 AIRCRAFT만 그 CHECK를 날 수 있음([fleet.ko.md](fleet.ko.md) 5.2) | `CHECK 독립성 — 검토 대상을 만든 TEAM_X 말고 이 CHECK를 날 AIRCRAFT 없음 (…)` | 2026-09-27 |

새 규칙 둘은 그림자 판정에서 나왔다. 가장 흔한 거절이 "이미 완료됨"이었는데, PR이 머지돼도 Linear 이슈가 저절로 Done이 되지 않기 때문이다. 진행 중인 제안보다 먼저 보므로, 그런 FLIGHT의 열린·승인된·HOLD 제안은 이 사유로 SUPERSEDED된다(FLIGHT 쪽 사유가 AIRCRAFT 쪽 사유보다 먼저). PR을 되돌리면 그 FLIGHT는 다시 후보가 된다.

#### 5.1.1 상위 이슈

Linear `children`이 있거나, 다른 FLIGHT가 `parent`로 지목한 FLIGHT는 **작업이 아니라 컨테이너**로 본다. 작업은 그 하위 이슈다. 컨테이너가 조용한 것은 방치가 아니므로 양쪽에서 뺀다.

- `ASSIGN` 제안을 만들지 않는다("제외" 목록에 `상위 이슈 — 하위 N건을 묶음`으로 뜬다)
- STAND 없이 아무리 오래 ENROUTE여도 `RELEASE` 제안을 만들지 않는다
- NO CONTACT 경보를 내지 않는다(자체 STAND가 있을 것으로 기대하지 않는다)

하위 이슈는 평소대로 계획한다. 관계는 한 단계만 본다(손자 이슈는 자기 직계 상위로 판단).

관계는 추측이 아니라 Linear에서 읽는다(`parent` / `children(first: 50)`). 그렇게 잡히지 않고 본문에만 적힌 선행 작업은 planner가 볼 `blocks` 관계가 없으므로 손으로 처리한다(5.4).

### 5.2 슬롯(용량)

| 한도 | 기본 | 이유 |
|---|---|---|
| TEAM당 동시 FLIGHT | 1, 여기에 STAND 없는 FLIGHT(`SURVEY`·`CHECK`) 1 | vocado 규칙: 팀 작업 한 번 = Linear 이슈 하나. SURVEY·CHECK는 워크트리가 필요 없다([fleet.ko.md](fleet.ko.md) 5.1) |
| AIRPORT당 동시 AIRBORNE | VCDO 4, 그 밖 2 | 개발 서버 포트(3001~), CI, LANDING SEQUENCE 혼잡 |
| 전체 대기 중 제안 | 5 | SUPERVISOR 검토 부담 |

슬롯이 차면 `ASSIGN` 대신 아무것도 내지 않는다(3단계에서 ground delay로 확장).

### 5.3 점수 (높을수록 먼저)

| 요소 | 계산 | 기본 가중 |
|---|---|---|
| 우선순위 | Urgent 4 · High 3 · Medium 2 · Low 1 (없음은 후보에서 제외) | ×3 |
| 대기 시간 | Todo로 머문 일수(최대 14) | ×0.5 |
| 풀어 주는 FLIGHT | 이 FLIGHT가 blocks 하는 Todo 수 | ×2 |
| 팀 적합도 | 이 AIRCRAFT가 과거에 같은 프로젝트·related FLIGHT를 날았던 횟수(FLIGHT RECORDER·청구 이력) | ×1 |
| 충돌 위험 | 지금 AIRBORNE인 FLIGHT와 related로 묶인 수 | ×−2 |
| ROUTE | FLIGHT의 프로젝트가 그 AIRCRAFT의 routes에 있음([fleet.ko.md](fleet.ko.md) 5장) | ×1 |

각 제안에 요소별 점수를 그대로 보여 준다("왜 이 팀에 이 편인가"). 가중치는 설정 파일로 SUPERVISOR가 바꾼다.

점수 없이 짝의 이유만 보여 주는 표시가 둘 있다. `STAND 없이`(STAND 규칙 밖으로 준 SURVEY·CHECK, AIRCRAFT 상태와 함께. 예: `HOLDING — VOC-10 진행 중`)와 모든 CHECK에 붙는 `CHECK 독립성`(빼 둔 만든 팀, 누가 만들었는지 모르면 `확인 못 함 — …`). 쉬는 AIRCRAFT에 주는 가산점은 없다.

### 5.4 DISPATCH 세션의 검토

서버가 고른 상위 후보마다 DISPATCH 세션이 티켓 본문과 댓글을 읽고:

- DB·마이그레이션·보안·권리 작업(vocado의 `Codex Engineering Task` 대상)이면 `CAUTION` 표시를 붙이고 사유를 적는다.
- 사람 결정이 먼저 필요한 티켓(예: "사용자 확인 후")이면 값 없는 `--hold`로 선행 FLIGHT 없는 HOLD를 건다. 사유는 메모에 적고, HOLD 뒤에 FLIGHT가 수정되면 atc가 풀어 다시 검토하게 한다.
- 선행 작업이 본문에만 적혀 있고 `blocks` 관계로는 없으면 `dispatch note <ID> --hold <FLIGHT> -- <메모>`로 HOLD를 건다. 지정하는 FLIGHT는 **막는(선행) FLIGHT**이고, 제안은 ASSIGN 목록이 아니라 HELD 목록으로 간다. 제안 자신의 FLIGHT는 예약된 채로 남아 planner가 다시 올리지 않는다(AIRCRAFT는 다른 FLIGHT가 쓸 수 있게 놓아 둔다). 보낼 수는 없고, FLIGHT PLAN에 `HOLD — 선행 FLIGHT …` 줄이 들어간다. 지정한 FLIGHT가 모두 끝난 상태가 되면 atc가 그 제안을 SUPERSEDED로 풀어 다시 후보가 되게 한다. HOLD에는 24시간 만료가 없다. 대신 FLIGHT 자체가 Todo가 아니게 되면 닫힌다. SUPERVISOR는 HELD 제안을 판정하지 않는다: "대기열로"는 대기열로 돌리고, "FLIGHT 보류 확정"은 FLIGHT 보류를 걸어 닫는다(6.2).
- 판단 근거를 한두 줄로 제안에 남긴다.
- 열린 제안과 HELD 제안마다 **BRIEFING**(ATC-4)을 쓴다. 쉬운 한국어 세 줄이고, `dispatch briefing <ID> --what … --why … --risk …`로 쓴다. 추가만 하는 `brief` op로 저장하고, 다시 쓰면 덮어쓴다. 아래 "제안 카드"를 본다.

### 5.5 제안 카드 (BRIEFING, ATC-4)

SUPERVISOR는 티켓 내용을 기억하지 못할 때가 많다(VOC-195, VOC-172). 제안을 판정하려고 Linear를 열지 않아도 되게 한다. 열린 카드와 HELD 카드는 위에서 아래로 이렇게 읽힌다.

1. **BRIEFING**: 무슨 일, 왜 이 AIRCRAFT, 걸리는 점(선행, 위험, 사람이 정할 것). OCC가 쓴다(`occ/CLAUDE.md` "BRIEFING"). OCC가 쓰기 전에는 제목과 본문 첫 문장에 "BRIEFING 대기"가 붙어 보인다. 본문은 atc가 백그라운드로 Linear에서 읽어 30분 동안 캐시한다(`server/briefing.ts`, `leadOf`).
2. **사실 줄**: 모델 없이 서버가 계산한다(`factsOf`). PRIORITY, FLIGHT를 만든 뒤 대기 일수, ROUTE MAP의 ROUTE와 WAYPOINT(예: "Beta Ready WAYPOINT(지금 구간) · 남은 3건 중 하나"), 선행 FLIGHT(Linear `blockedBy`와 DISPATCH HOLD)와 그 상태, 그 AIRCRAFT가 같은 ROUTE에서 최근 맡은 FLIGHT(30일 안 LOGBOOK ARRIVED와 날고 있는 ASSIGN, 셋까지), HELD 카드에서는 CROSSCHECK 판정과 사유(열린 카드는 CROSSCHECK 칩에 보인다).
3. 분류, AIRCRAFT와 점수, HOLD 줄, CROSSCHECK 칩, 판정 버튼은 전과 같다.
4. **접어 둔 자세히**("점수 요소 · 본문 · 메모"): 점수 요소, DISPATCH 메모, 본문 전체. 본문은 열 때 Linear에서 읽는다.

`GET /api/dispatch/brief`에 열린·HELD 제안의 `briefs: { <ID>: { facts, lead } }`가 더해진다. BRIEFING이 있으면 `lead`는 null이다. `POST /api/dispatch/proposals/:id/briefing {what, why, risk}`는 제안이 `proposed`일 때만 받는다. 세 줄 모두 필요하고, 공백은 한 칸으로 모으며, 한 줄 300자까지다. OCC guard는 바꾸지 않았다. `dispatch briefing`은 `dispatch note`와 같은 atc CLI 명령이고, CROSSCHECK의 허용 목록에는 없다.

## 6. 흐름

### 2a — 그림자 운용

```
atc 서버: 5분마다 후보·점수 → PROPOSED 제안 기록
DISPATCH 세션(/tick): 새 제안 검토 → 메모·CAUTION 추가
SUPERVISOR: DISPATCH 탭에서 "나라면 승인 / 거절(사유)" 표시
→ 아무에게도 보내지 않음. 합의율만 잰다.
```

### 2b — 승인 운용

```
SUPERVISOR 승인 → atc: APPROVED
DISPATCH 세션: FLIGHT PLAN을 CAPTAIN에게 SendMessage
  [DISPATCH D-0003] FLIGHT PLAN · BRAVO (TEAM_B)
  FLIGHT VOC193 · AIRPORT VCDO · PRIORITY High
  <티켓 제목과 URL, DISPATCH 메모>
  — 맡으면 이 메시지에 "READBACK D-0003", 못 맡으면 사유로 답장해 주세요.
CAPTAIN: READBACK → Linear In Progress, STAND 준비(지금 규칙 그대로)
atc: 해당 FLIGHT에 STAND가 생기면 DEPARTED, 안 생기면 30분 뒤 TOWER처럼 재확인
     STAND 없는 FLIGHT(SURVEY·CHECK): READBACK 자체로 DEPARTED(기다릴 STAND가 없다)
CAPTAIN(STAND 없는 FLIGHT만): 마쳤다고 보고 → OCC: atcctl dispatch arrived D-0003 -- '<결과 링크나 한 줄>' → atc: ARRIVED
```

제안 상태: `PROPOSED → (SHADOW_AGREE | SHADOW_DISAGREE)`(2a), `PROPOSED → APPROVED → SENT → ACCEPTED → DEPARTED`(2b), STAND 없는 FLIGHT는 `… → ACCEPTED → DEPARTED → ARRIVED`, 곁가지 `REJECTED`, `DECLINED`(CAPTAIN 사유), `SUPERSEDED`(사람이 직접 배정했거나 상황이 바뀜), `EXPIRED`(24시간). `HOLD`가 걸린 `PROPOSED` ASSIGN은 주 흐름에서 빠져, 풀릴 때까지 HELD 목록에서 기다린다(24시간 만료 없음). SUPERVISOR는 이것을 판정하지 않는다(6.2).

**STAND 없는 FLIGHT**(2026-09-27 구현, 규칙은 [fleet.ko.md](fleet.ko.md) 5.1.1). STAND가 필요한 FLIGHT는 PR이 머지돼 LOGBOOK에 오르면 끝이라 atc가 더 따라가지 않는다. SURVEY·CHECK는 STAND도, 대개 PR도 없어서 이렇게 한다.

- **READBACK에 DEPARTED.** `POST …/accept`가 `accept`와 `depart`(`stand: null`, `via: "readback"`)를 같은 시각에 남긴다. 제안에는 `departedStand: null`, `departedVia: "readback"`이 붙는다(STAND로 DEPARTED하면 `departedVia: "stand"`). FLIGHT 라벨은 그때 읽는다. 모르는 FLIGHT는 STAND가 필요한 쪽으로 보고, `accepted`에 남은 STAND 없는 제안은 다음 동기화에 DEPARTED가 된다.
- **CAPTAIN 보고로 ARRIVED.** OCC가 `atcctl dispatch arrived D-xxxx -- '<결과 링크나 한 줄>'`(`POST …/arrived {note}`, 500자)로 적는다. 제안은 `status: "arrived"`, `arrivedNote`, `arrivedUrl`(보고의 첫 링크)을 갖는다. STAND 없이 `departed`인 제안만 ARRIVED할 수 있다.
- **ARRIVED까지 잡아 둔다.** `inFlight`에 남고 AIRCRAFT·FLIGHT를 계속 잡으며, 만료·SUPERSEDED 없다. 보고 없이 24시간이 지나면 `overdue`에 든다. `sent`·`accepted`처럼 RECALL할 수 있다.
- **gate3.** STAND 없는 READBACK은 READBACK 비율에는 넣고 DEPARTED 비율에서는 뺀다. 정의상 DEPARTED라 넣으면 비율이 저절로 오른다. `gate3.standFree`가 그 READBACK·ARRIVED 수를 따로 보인다.

#### 6.1 최근 짝과 판정 대기 제안 지키기

2026-09-27에 고쳤다. 제안 19건 중 10건이 판정 전에 SUPERSEDED됐고, 그중 7건의 사유가 "더 나은 배정으로 바뀜"이었다. D-0017(VOC-196 → TEAM_E, `tail:TEAM_E`)은 planner가 TEAM_E에게 점수가 조금 높은 VOC-177(10.8 대 10.3)을 줘서 닫혔다. 그런데 VOC-177 → TEAM_E는 D-0010에서 거절된 짝이라 `syncOps`의 24시간 규칙이 다시 제안하지 않았다. 결국 두 FLIGHT 모두 제안이 없어 열린 제안이 0건이 됐다.

- **한 규칙을 두 곳에서.** 최근 24시간 안에 제안됐다가 닫힌 FLIGHT–AIRCRAFT 짝(거절, SUPERSEDED, EXPIRED, DECLINED, RECALLED. RECALL은 READBACK부터 24시간)은 다시 제안하지 않는다. `proposals.ts`의 `recentPairsOf`가 한 번 계산한다. planner는 이것을 `Reserved.recentPairs`로 받아 후보 조합에서 빼므로, AIRCRAFT는 다음으로 좋은 FLIGHT를 받는다. `syncOps`의 `seen`도 같은 기간을 쓴다. 열린(`PROPOSED`) 짝은 막지 않아 계획에 그대로 남는다.
- **보이게.** 계획은 뺀 짝을 `blockedPairs`(FLIGHT, AIRCRAFT, 제안, 다시 가능한 시각)에 적는다. 배정 가능한 AIRCRAFT가 모두 막힌 FLIGHT는 "제외" 목록에 `24시간 안에 제안된 짝(D-xxxx) — MM-DD HH:MM부터 다시`(로컬 시각)로 뜬다.
- **FLIGHT 보류.** 짝 규칙은 AIRCRAFT가 문제였다고 본다. 문제가 FLIGHT에 있으면 FLIGHT를 다음 팀으로 넘길 뿐이다. D-0022(VOC-177 → TEAM_D, "사용자 지시를 기다림")와 D-0023(VOC-125 → TEAM_A, "사용자 모집·관찰 필요")을 거절하자 곧바로 D-0024(VOC-125 → TEAM_D)와 D-0025(VOC-177 → TEAM_B)가 나왔다. 그래서 사유 칩이 차단 범위를 정한다. 거절된(그림자 disagree 포함) ASSIGN에 `already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`, `no-priority`, `out-of-repo` 중 하나라도 있으면 `recentFlightsOf`가 **FLIGHT 전체**를 모든 AIRCRAFT에서 보류한다(`Reserved.recentFlights`). "제외" 목록에는 `FLIGHT 보류 — <칩> (D-xxxx 판정) — 이슈가 바뀌거나 MM-DD HH:MM부터 다시`로 뜨고, 그 FLIGHT의 다른 AIRCRAFT 열린 제안도 같은 사유로 SUPERSEDED된다. 판정부터 24시간이 지나거나, Linear 이슈의 `updatedAt`이 판정 뒤로 바뀌면(본문 수정, 답변, 우선순위 변경) 그 전에 풀린다. `wrong-aircraft`, `other`, 칩 없는 판정(옛 판정 포함)은 짝 규칙만 받는다.
- **오락가락은 막지 않는다.** "더 나은 배정으로 바뀜"으로 닫힌 제안은 판정받지 못한 것이라 24시간 규칙에서 빼고 곧바로 다시 제안될 수 있다. D-0017의 짝이 이것으로 돌아온다.
- **판정 대기 중인 제안 지키기.** PROPOSED ASSIGN이 계획에서 빠졌는데 이유가 "더 나은 배정"뿐이면(상태 변화 없음) 열어 둔다. 같은 `syncOps`에서 같은 FLIGHT나 같은 AIRCRAFT에 점수가 20% 이상 높은 새 제안이 실제로 만들어질 때만 SUPERSEDED한다(`REPLACE_MARGIN`, 차이를 점수의 절댓값과 비교). 그때 사유에 새 제안과 두 점수를 적는다: `더 나은 배정으로 바뀜 — D-0021 (10.3 → 13)`. 기준에 못 미치면 새 제안을 만들지 않고 기존 제안이 판정을 기다린다.
- **왜 20%.** 점수는 천천히 움직이고(대기 하루에 0.5), 우선순위 한 단계는 3점(흔한 10점짜리 점수의 약 30%)이다. 20%면 새로 급해진 FLIGHT처럼 확실히 나은 것은 바꾸고, 작은 흔들림 때문에 SUPERVISOR가 판정할 기회를 잃지는 않는다. 처음 제안값이다.
- **상태가 바뀌면 지금처럼 바로 닫는다:** FLIGHT가 Todo가 아님·완료됨·열린 PR 있음, AIRCRAFT가 더는 받을 수 없음, 제외 규칙에 걸림.

거절에는 **사유 칩**을 쓴다. SUPERVISOR 화면에서 서버의 사유 목록(`server/reasons.ts`, 브리핑의 `reasonCodes`) 중 하나 이상을 고르고 메모를 선택으로 덧붙이며, `"<칩> · <칩> — <메모>"` 형태로 `reason`에, code는 `reasonCodes`에 저장된다. 점검은 칩별로 센다(`reasonCounts`). 가장 중요한 칩은 상위 이슈(5.1.1)로, 이건 planner가 스스로도 걸러 낸다.

브리핑의 `reasonStats`는 칩을 planner의 할 일 목록으로 바꾼다. 칩마다 건수, 최근 예시 FLIGHT 3건까지, 그리고 planner가 그 사유를 이미 스스로 거르는지(`auto`, `partial`, `manual`과 방법)를 준다. 지금은: 이미 완료됨 → LOGBOOK·열린 PR 규칙과 Linear Done 상태(auto), 상위 이슈 → 5.1.1(auto), 우선순위 미정 → 우선순위 없음 규칙(auto), 선행 FLIGHT·PR 대기 → Linear `blockedBy`는 HOLD, 다른 PR은 OCC HOLD로만(partial), 저장소 밖 작업 → 프로젝트 매핑만(partial), AIRCRAFT 부적합 → TYPE RATING·CREW·`tail:` 규칙(partial), 사람 결정 필요 → "사용자가 정한다"류 문구는 OCC HOLD(partial), 기타 → manual. 칩마다 차단 범위(`scope`: `flight`나 `pair`, 위 FLIGHT 보류)도 붙는다. DISPATCH 점검 패널에 "거절 사유 → 배정 규칙"으로 보인다.

#### 6.2 PREFLIGHT: 시작할 상태가 아닌 FLIGHT 잡아 두기

2026-09-27에 만들었다(ATC-3). 처음 DISPATCH 판정 9건 중 6건이 거절이었고, 6건 모두 티켓이 아직 시작할 상태가 아니어서였다: 상위 이슈(VOC-34), 이미 완료됨, 사람의 결정이나 손이 필요함(VOC-177, VOC-125 …), 우선순위·담당 없음. AIRCRAFT 때문인 것은 없었다. 게이트(9/20, 33%)는 대부분 티켓 준비 상태를 재고 있었고, SUPERVISOR는 CROSSCHECK가 같은 사유로 이미 짚은 것을 잡으려고 티켓을 모두 읽어야 했다.

- **SUPERVISOR가 보기 전에 HELD로 가는 것.** (a) CROSSCHECK가 FLIGHT 칩(`already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`, `no-priority`, `out-of-repo`. 6.1의 FLIGHT 보류와 같은 목록)으로 `disagree`를 달거나, (b) OCC가 HOLD를 걸면(5.4) 제안은 대기열에서 빠져 HELD로 간다. (a)는 서버가 `crosscheck` op 바로 뒤에 `preflight` op(`{op:"preflight", id, at, by, model, codes, reason}`)를 남긴다. CROSSCHECK에는 새 권한이 없다: HOLD는 기존 mark를 받은 서버가 내는 결과다. 서버 tick마다 열린 제안도 훑으므로 이 변경 전에 달린 mark에도 적용된다.
- **대기열에 남는 것.** `wrong-aircraft`, `other`, 칩 없는 mark, `agree`. 팀 선택은 게이트가 재야 할 것이다.
- **HELD 카드**에는 누가 걸었는지(`PREFLIGHT`: CROSSCHECK와 모델 계열, 칩. OCC면 `HOLD`와 메모), CROSSCHECK mark(있으면), 한 번 클릭 동작 두 개가 있다. 판정 버튼은 없다: HELD 제안에 `verdict`·`approve`·`reject`는 409다.
  - **대기열로(requeue)**: `{op:"requeue"}`가 HOLD를 풀고 같은 제안을 SUPERVISOR 대기열로 돌린다. 24시간(만료와 짝 규칙)은 돌린 때부터 센다. 다시 HOLD되지 않는다: tick은 건너뛰고, OCC의 `hold`는 409다.
  - **FLIGHT 보류 확정(confirm-hold)**: 제안을 `via: "preflight"`와 칩으로 disagreed(그림자)나 rejected(승인 운용)로 닫는다. 그러면 6.1의 FLIGHT 보류(모든 AIRCRAFT에서 24시간, 이슈가 바뀌면 그 전에 풀림)가 걸린다. 칩은 PREFLIGHT의 칩, 없으면 HOLD 전에 달린 mark의 FLIGHT 칩, 그것도 없으면 선행 없는 OCC HOLD라 `needs-human`(정의상 사람을 기다리는 HOLD)이다. 이유 문장에서 추정하지 않는다. 선행 FLIGHT가 있는 HOLD는 확정하지 않는다. 선행이 끝나면 atc가 푼다.
- **HOLD는 지금처럼 저절로도 풀린다**: FLIGHT가 Todo가 아니게 됨, 끝났거나 열린 PR이 있음, (선행 없는 HOLD) HOLD 뒤에 이슈가 바뀜.
- **CROSSCHECK 대기.** mark가 없는 열린 제안은 `CROSSCHECK 대기`로 표시하고 mark가 있는 것 뒤로 정렬한다. 거름이 돌기 전에 SUPERVISOR가 판정하지 않게.
- **게이트.** HELD 제안은 게이트 밖이다(결정 표). 확정(`via: "preflight"`)은 사람 판정이 아니어서 판정 건수, 합의율, CROSSCHECK 일치율, `reasonCounts`에서 빠지지만, `reasonStats`는 planner의 할 일로 그 칩을 센다. `gate.preflight`는 `held`(OCC·PREFLIGHT로 한 번이라도 HOLD된 ASSIGN, 뒤에 대기열로 돌렸거나 확정한 것 포함), `holding`(지금 HOLD 중), `passed`(HOLD 없이 SUPERVISOR 판정까지 갔고 준비 안 됨 거절이 아님), `notReady`(HOLD 없이 판정까지 갔지만 준비 안 됨 거절, 6.3), `readyRate = passed / (passed + held + notReady)`를 준다. 기준 없는 공급 품질 지표다. 점검 패널에 `PREFLIGHT HELD n건 · 준비율`로 보인다.

#### 6.3 게이트는 AIRCRAFT 선택만 잰다

2026-09-27에 만들었다(ATC-5). 이제 PREFLIGHT가 SUPERVISOR 판정 전에 준비 문제를 거르지만, 그 전의 거절 6건(D-0001, D-0003, D-0006, D-0010, D-0022, D-0023, 모두 티켓 문제)이 게이트를 3/9(33%)에 묶어 두었다. 이대로면 80%에 가려면 틀림 없이 30건쯤 더 판정해야 한다.

- **준비 안 됨 거절은 게이트에서 뺀다.** `gateOf`는 사유 칩이 모두 FLIGHT 칩(`FLIGHT_HOLD_CODES`: `already-done`, `parent-issue`, `waiting-on-prior`, `needs-human`, `no-priority`, `out-of-repo`)인 `disagreed` 제안을 빼고 `gate.notReady`로 센다. `agreed`와, `wrong-aircraft`·`other`가 있거나 섞였거나 칩이 없는 거절은 전처럼 센다. 점검 패널에는 PREFLIGHT HELD 옆에 "준비 안 됨 거절 n건"(게이트 제외)이 보이고, 판정 줄은 "판정한 제안(HELD·준비 안 됨 제외)"이 된다.
- **지난 판정에 칩 달기.** `POST /api/dispatch/proposals/:id/codes {codes}`(`server/reasons.ts`의 칩 하나 이상)는 `{op:"recode", id, at, by:"SUPERVISOR", codes}`를 남긴다. 사람이 판정한 `disagreed` 제안에만 받고(그 밖은 409, ATFM·PREFLIGHT 확정도), 나중 recode가 앞의 것을 대신한다. fold는 이것을 `reasonCodes`와 따로 `gateCodes`로 두고 게이트만 읽는다(`gateCodesOf`: `gateCodes`, 없으면 `reasonCodes`). 그래서 recode는 6.1의 FLIGHT 보류를 뒤늦게 걸지 않고, 사유 문장, `reasonCounts`, `reasonStats`, CROSSCHECK 일치와 한 번 클릭 수치도 그대로다. atcctl 명령은 없다: 배포 뒤 SUPERVISOR 지시로 structure가 위 6건에 API를 한 번 부른다(칩은 ATC-5에 있다). 그러면 게이트는 3/3에서 다시 시작한다.

## 7. atc에 더할 것

| 곳 | 내용 |
|---|---|
| `server/sources/linear.ts` | 조회에 `relations`(blocks), `labels`, `project`, `createdAt`, 상태 진입 시각(가능하면 `history`) 추가 |
| `server/dispatch.ts` | 후보·슬롯·점수 계산(순수 함수 + 테스트) |
| `server/proposals.ts` | 제안 기록(`~/.local/state/atc/proposals.jsonl`, 추가만 함, clearances와 같은 방식) |
| API | `GET /api/dispatch/brief`, `POST /api/dispatch/proposals/:id/{note,hold,agree,disagree,approve,reject,sent,accept,decline}` |
| 이벤트·기록 | `proposal.created / decided / sent / accepted / departed / superseded`를 FLIGHT RECORDER에 |
| 설정 | `~/.local/state/atc/dispatch.json`: 프로젝트→AIRPORT 매핑, 팀별 기본 AIRPORT(`teamAirports`), 후보 Linear 팀(`candidateTeams`, 비면 주 팀), 슬롯, 가중치, 모드(`shadow`/`approval`) |
| 화면 | DISPATCH 탭: 제안 카드(FLIGHT·AIRCRAFT·요소별 점수·DISPATCH 메모·CAUTION·HOLD), 승인/거절 버튼(거절은 사유 칩 + 선택 메모), HELD 목록, 슬롯 현황, RELEASE 목록 |
| 지표 | 그림자 합의율, 제안→수락 시간, 유휴 AIRCRAFT 시간(PARKED인데 Todo가 있던 분), 방치된 ENROUTE 수 |
| `atc/occ/`(전 `atc/dispatch/`) | TOWER와 같은 구조: `CLAUDE.md`(역할·판단 기준), `/tick`, guard(atc CLI·jq만, Linear는 읽기 MCP만) |

## 8. 넘어가는 기준

| 전환 | 기준(제안값) |
|---|---|
| 1.5 → 2a | 바로 시작 가능(아무것도 보내지 않으므로 1.5와 나란히 운용) |
| 2a → 2b | 그림자 제안 20건 이상, 합의율 80% 이상, blocks를 어긴 제안 0건. 동시에 1.5 점검 4개 충족 |
| 2b → 3(ATFM) | 2주 이상, READBACK 비율 90% 이상, DEPARTED 비율 80% 이상(STAND가 필요한 FLIGHT만, `GATE3`), DISPATCH가 보낸 FLIGHT에서 난 LOS가 거의 0, 유휴 AIRCRAFT 시간 감소 |

## 9. 위험과 대응

| 위험 | 대응 |
|---|---|
| 팀에 일을 쏟아붓기 | TEAM당 1, AIRPORT·전체 슬롯, 복창 대기 중이면 추가 배정 없음 |
| 오래된 Linear 상태(방치된 In Progress) 때문에 판단이 틀림 | 첫 구현에 `RELEASE` 포함, NO CONTACT FLIGHT를 먼저 정리 |
| Symphony와 같은 티켓을 두고 경합 | `symphony-pilot` 라벨 제외. Symphony 클론이 생기면 별도 AIRPORT로 개설해 보이게 |
| 사용자가 직접 준 일과 겹침 | 직접 배정을 감지(STAND·Linear In Progress가 제안 없이 생김)하면 관련 제안 SUPERSEDED |
| 위험 작업을 가볍게 배정 | DISPATCH 세션의 본문 검토와 CAUTION, CAUTION 제안은 3단계에서도 자동 승인 대상에서 제외 |
| DISPATCH가 코드·Linear를 건드림 | guard(atc CLI·jq만), Linear는 읽기 전용 MCP만 허용 |

## RECALL

보냈거나(`sent`) READBACK 받은(`accepted`) FLIGHT PLAN, 그리고 READBACK으로 DEPARTED했지만 아직 ARRIVED하지 않은 STAND 없는 FLIGHT(`departed`, `departedVia: "readback"`)를 SUPERVISOR가 거둬들인다. [atfm.ko.md](atfm.ko.md)의 결정 4에 따라 자동 배정보다 먼저 만들었다.

```
SUPERVISOR: 진행 중 카드의 "RECALL…"(또는 POST /api/dispatch/proposals/:id/recall {reason}) → atc: RECALLING
OCC:        atcctl dispatch recall-send D-0003 → CAPTAIN에게 RECALL 문구를 SendMessage
CAPTAIN:    작업을 멈추고 STAND는 그대로 둔 채 "READBACK D-0003 RECALL"로 답한다
OCC:        atcctl dispatch recalled D-0003 → atc: RECALLED
```

- **상태**: `sent`·`accepted`·STAND 없는 `departed` → `recalling` → `recalled`.
  - `recalling`은 AIRCRAFT와 FLIGHT를 계속 잡아 둔다. STAND가 생겨도 DEPARTED로 바꾸지 않는다(멈추라고 한 FLIGHT다).
  - RECALL READBACK이 10분 넘게 없으면 `overdue`에 들고, 24시간이면 EXPIRED가 된다.
  - STAND가 생긴 `departed`는 RECALL하지 않는다. 이때는 SUPERVISOR가 CAPTAIN에게 직접 말한다. STAND 없는 것은 지킬 STAND가 없어 RECALL할 수 있고, RECALL 문구는 "STAND를 그대로 두라" 대신 중간 결과를 남기라고 한다.
- **RECALLED 뒤**: FLIGHT는 다시 후보가 된다. 같은 FLIGHT·AIRCRAFT 짝은 RECALL READBACK부터 24시간 제안하지 않고, 다른 AIRCRAFT에는 바로 제안할 수 있다.
- **누가 하나**:
  - RECALL 요청은 SUPERVISOR만 한다(DISPATCH 탭이나 API, 사유 300자 이내).
  - OCC는 요청을 만들지 않고(atcctl에 그 명령이 없다), 서버 문구를 보내고 READBACK을 기록하기만 한다.
  - ATFM 출발 중지가 켜져 있어도 RECALL은 막지 않는다. 회수는 안전 쪽 동작이다.
- **문구**: `formatFlightPlan`처럼 서버가 RECALL 요청 때 만들어 제안에 저장한다(`recallMessage`).

  ```
  [DISPATCH D-0003] RECALL · BRAVO (TEAM_B)
  FLIGHT VOC193 · AIRPORT VCDO — 이 FLIGHT PLAN을 거둬들입니다.
  <티켓 제목>
  사유: <SUPERVISOR의 사유>
  작업을 멈추세요. STAND(워크트리)는 정리하지 말고 그대로 두세요 — 다른 AIRCRAFT가 이어받을 수 있게.
  — 받았으면 이 메시지에 "READBACK D-0003 RECALL"로 답장해 주세요.
  ```

  답장에 RECALL을 붙이게 해서(`READBACK D-0003 RECALL`) FLIGHT PLAN의 `READBACK D-0003`과 헷갈리지 않는다.
- **send-guard**: `[DISPATCH D-xxxx] RECALL`로 시작하는 메시지는 다음을 모두 만족할 때만 통과한다.
  - approval 모드다.
  - 그 제안이 `recalling`이다.
  - 받는 사람이 그 제안의 CAPTAIN이다.
  - 본문이 `recallMessage`와 정확히 같다.

  그 밖의 `[DISPATCH D-xxxx]` 메시지는 전처럼 FLIGHT PLAN으로 검사한다. shadow 모드에서는 보내지 않으므로 SUPERVISOR가 CAPTAIN에게 직접 말한다.
- **API**:
  - `POST /api/dispatch/proposals/:id/recall {reason}`: SUPERVISOR.
  - `POST …/recall-send`: `{sendTo, message}`를 돌려주고 상태는 바꾸지 않는다(OCC, approval 모드만).
  - `POST …/recalled`: CAPTAIN의 READBACK 뒤 OCC.

## 2b 켜는 법

2b는 구현돼 있고 `mode` 뒤에 있다. 켜면 승인한 제안이 실제 팀 세션에 나가므로 이 순서로 한다.

1. DISPATCH 탭에서 "2b 켜기 점검표"(아래)와 2b 진입 점검(그림자 판정 20건 이상, 합의율 80% 이상)을 확인한다.
2. 팀 CLAUDE.md(`vocado_nextjs/CLAUDE.md`)의 READBACK 규칙을 넓혀, CAPTAIN이 `[DISPATCH D-xxxx]` FLIGHT PLAN에도 `READBACK D-xxxx`(또는 사유)로, `[OCC CC-xxxx]` CREW CHANGE에는 `READBACK CC-xxxx`로 답하게 한다. 점검표의 `vocado-readback` 항목이 더할 문장을 준다. 그 파일은 SUPERVISOR가 고치고 atc는 읽기만 한다.
3. DISPATCH 탭의 "2b 승인 운용 켜기"(또는 `POST /api/dispatch/mode {"mode":"approval"}`). 돌고 있는 DISPATCH 세션은 다음 바퀴에 모드를 읽는다.
4. 멈추려면 shadow로 되돌린다. 이미 보낸 FLIGHT PLAN은 그대로 두고, 새로 보내지는 않는다.

### 2b 켜기 점검표

`GET /api/dispatch/brief`가 `readiness2b: {items: [{id, label, status, detail, link?, suggestion?}]}`를 돌려준다(`server/readiness.ts`). `status`는 `ready`, `not-ready`, `check`(사람이 봐야 함)다. 표시만 하고, 모드 전환은 SUPERVISOR가 한다.

| id | 계산 |
|---|---|
| `gate` | `gateOf`: 2a 게이트(판정 20건, 일치 80%)를 넘으면 `ready` |
| `recall` | 상수가 아니라 코드 사실로 본다. 합성 기록이 `sent → recalling → recalled`로 접히고 예약이 풀리는지, `formatRecall`이 머리 줄을 만드는지, `recall`·`recall-send`·`recalled` API가 등록됐는지(`DISPATCH_ACTIONS`), `controller/atcctl.mjs`에 `recall-send`·`recalled` 명령이 있는지(`selfCheck2b`) |
| `send-guard` | 서버는 테스트를 돌리지 않는다. `occ/send-guard.mjs`를 읽어 `checkSend` export, approval 모드 확인, FLIGHT PLAN(`proposal.message`)·RECALL(`proposal.recallMessage`)·CREW CHANGE(`change.message`, 받는 사람 `change.registration`) 비교, 받는 사람 확인, `exit 2`가 있는지 보고 파일 sha256 앞자리를 보인다. 모두 있으면 `check`(`node --test occ/send-guard.test.mjs`로 확인하라는 안내), 빠지거나 파일이 없으면 `not-ready` |
| `vocado-readback` | `vocado_nextjs/CLAUDE.md`를 읽기만 한다(`ATC_VOCADO_CLAUDE_MD`, 없으면 `<projectsDir>/vocado_nextjs/CLAUDE.md`). 한 줄에 `[DISPATCH D-`와 `READBACK D-`가 함께 있고, 한 줄(같은 줄이든 다른 줄이든)에 `[OCC CC-`와 `READBACK CC-`가 함께 있으면 `ready`, 아니면 `not-ready`와 더할 문장(`detail`, `suggestion`), 파일을 못 읽으면 `check` |
| `stand-free` | `recall`처럼 코드 사실: SURVEY의 READBACK이 STAND 없이 DEPARTED하고, 30일이 지나도 잡혀 있고 만료되지 않으며, ARRIVED가 풀어 주고, `arrived` API와 `atcctl dispatch arrived`가 있는지 |
| `crew-change` | `recall`처럼 코드 사실(`server/crew-change.ts`의 `selfCheckCrewChange`): 합성 기록이 `pending → approved → sent → acknowledged`로 접히는지, `sent`가 10분 뒤 overdue인지, shadow 모드 승인을 거절하는지, `crewChangeMessage`가 `[OCC CC-xxxx]` 머리와 `READBACK CC-xxxx` 줄을 만드는지, 새 변경이 `approved`는 대신하고 `sent` 뒤에서는 기다리는지, `approve`·`send`·`readback` API와 `atcctl crew-change send`·`readback`이 있는지([fleet.md](fleet.md) 8.4) |
| `known-gaps` | 늘 `check`, 아래 절로 링크 |

### 2b 켜기 전 알려진 빈틈

- `dispatch release`는 메시지를 보내기 전에 제안을 SENT로 바꾼다. 전달이 실패하면(CAPTAIN 세션이 없거나 메시지가 승인 대기로 잡힘) SENT로 남고, 10분 뒤 NO READBACK으로 보이면 DISPATCH가 한 번 재송신한 뒤 SUPERVISOR에게 보고한다.
- STAND 없는 FLIGHT는 CAPTAIN 보고로만 ARRIVED한다. 자동 감지(대상 PR의 리뷰, 문서 PR·이슈 댓글)는 아직 없다. 보고를 잊으면 SUPERVISOR가 `overdue`(24시간)를 보고 챙길 때까지 그 AIRCRAFT의 STAND 없는 칸 하나가 잡혀 있다. send-guard가 FLIGHT PLAN·RECALL·CREW CHANGE만 통과시키므로 OCC가 CAPTAIN에게 직접 묻지 못한다.
- STAND 없는 READBACK은 CAPTAIN이 실제로 시작하지 않아도 DEPARTED로 센다. 일이 시작됐다는 다른 신호가 없다.
- STAND 없는 ARRIVED는 LOGBOOK에 오르지 않아 TARGETS에 세지 않는다. planner는 ARRIVED 뒤 7일 동안 그 FLIGHT를 빼고, 그 뒤에는 Linear를 믿으므로 Linear에서 닫아야 한다.
- FLIGHT TYPE은 READBACK 때 읽는다. 그 뒤에 라벨을 바꿔도 기록된 DEPARTED는 바뀌지 않는다.
- STAND가 있는 DEPARTED는 RECALL할 수 없다. SUPERVISOR가 CAPTAIN에게 직접 말한다.
- `crew-change send`도 `dispatch release`처럼 메시지를 보내기 전에 SENT로 바꾼다. 전달이 실패하면 10분 뒤 overdue로 보이고, OCC가 한 번 재송신한 뒤 보고한다. READBACK을 기다리는 동안 같은 AIRCRAFT의 새 CREW CHANGE도 기다린다([fleet.md](fleet.md) 8.4).
- send-guard의 동작은 테스트로만 증명된다. 점검표는 `ready`가 아니라 `check`로 보인다.
- `vocado-readback`은 두 표지가 한 줄에 있는지만 본다. 문장 내용은 판단하지 않는다.

## 10. 구현 순서

1. Linear 조회 확장 + `dispatch.ts`(후보·슬롯·점수) + 테스트
2. 제안 기록·API·이벤트, 그림자 모드 기본
3. DISPATCH 탭(그림자 합의 표시) + 지표
4. `atc/dispatch/` 세션(검토 메모, CAUTION), 지금은 `atc/occ/`의 일부
5. 승인 운용(2b): 승인 버튼, FLIGHT PLAN 전달, READBACK, DEPARTED 판정 — vocado `CLAUDE.md`의 READBACK 줄을 `[DISPATCH D-xxxx]`까지 넓힘

## 결정 (2026-09-26, SUPERVISOR)

| 항목 | 결정 |
|---|---|
| DISPATCH 세션 | TOWER와 **별도 세션**(`atc/dispatch/`). 같은 날 OCC(`atc/occ/`)로 합침 |
| 후보 FLIGHT | **Todo만**. Backlog는 사람이 Todo로 올린 뒤에만 대상 |
| 프로젝트 → AIRPORT | Beta Readiness · Song Experience → **VCDO**. Vocado Pre-seed IR & Pitch Deck · Vocado Visual System (SEED)는 **배정 제외** |
| `RELEASE` 기준 | STAND 없이 ENROUTE인 채로 **3일** |
| 슬롯 | 제안값으로 시작: TEAM당 1, VCDO 동시 AIRBORNE 4, 그 밖 2, 대기 중 제안 5 |
| 게이트가 재는 것 (2026-09-27, ATC-5) | **AIRCRAFT 선택만.** 준비 상태는 PREFLIGHT(6.2)가 거르고, 칩이 모두 FLIGHT 칩인 거절은 판정 건수와 합의율에서 빼 따로 보인다(6.3). 지난 판정에는 `recode`로 칩을 달고, 이것은 게이트만 바꾼다 |
| HELD 제안과 게이트 (2026-09-27, ATC-3) | **게이트 밖.** PREFLIGHT나 OCC가 잡아 둔 제안은 SUPERVISOR 판정이 아니고, 확정한 HOLD는 `via: "preflight"`로 남아 세지 않는다. 게이트는 준비된 티켓에서의 팀 선택을 재고, 티켓 준비 상태는 준비율(6.2)로 따로 보인다 |

남은 결정: 2b에 들어갈 때 vocado `CLAUDE.md`의 READBACK 규칙을 FLIGHT PLAN(`[DISPATCH D-xxxx]`)까지 넓힐지. 2a에는 필요 없다.
