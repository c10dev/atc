# 2단계 DISPATCH 설계 (초안)

[English](dispatch.md) · **한국어**

DISPATCH는 **어떤 FLIGHT(Linear 티켓)를 어떤 AIRCRAFT(팀 세션)에, 언제 보낼지** 제안한다. TOWER(1단계)가 이미 뜬 AIRCRAFT끼리 부딪히지 않게 하는 쪽이라면, DISPATCH는 뜨기 전의 계획을 맡는다. 항공사 운항관리(OCC)와 ATC가 나뉘어 있는 것과 같은 구분이다.

> 상태: DISPATCH 세션은 2026-09-26 OCC 세션(`atc/occ/`, [occ.md](occ.md), 영어)에 합쳐졌다. 아래 일은 그대로다. 2a(그림자 운용) 운용 중, 2b(승인 운용)는 `mode` 뒤에 구현돼 있고 기본은 꺼짐(2026-09-26). "2b 켜는 법" 참고. 결정 사항은 맨 아래 "결정"에 있다.
>
> 구현하며 정리한 것: TEAM당 동시 FLIGHT 1 규칙에 따라, 끝나지 않은 FLIGHT의 STAND를 쥔 HOLDING AIRCRAFT는 대기 시간과 상관없이 배정하지 않는다(5.1의 "30분" 기준은 쓰지 않음). RELEASE는 AIRPORT에 매핑된 프로젝트(코드 작업)만 본다.

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
| **이미 완료됨**: 그 FLIGHT의 PR이 LOGBOOK에 ARRIVED로 있고 되돌리지 않음([fleet.md](fleet.md) 7.1) | `이미 완료됨 — PR <repo>#N 머지됨(LOGBOOK)` | 2026-09-27 |
| **작업 중**: ticket key가 그 FLIGHT인 열린 PR(Draft 포함) | `열린 PR #N 있음` | 2026-09-27 |
| 워크트리(STAND)가 이미 있음 | `이미 STAND가 있음` | |
| 진행 중인 제안·HOLD가 있음 | `진행 중인 제안 D-xxxx`, `HOLD D-xxxx — …` | |
| 우선순위 없음 | `우선순위 없음 — 사람이 정할 때까지 배정하지 않음` | |
| `wake:J` | `wake:J — 너무 커서 배정하지 않음, 나눠야 함(SPLIT)` | |
| TAIL ASSIGNMENT, TYPE RATING, CREW([fleet.md](fleet.md) 5장) | `tail:TEAM_X — …`, `rating:SEC — …`, `type:BUILD — …` | |

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
| TEAM당 동시 FLIGHT | 1 | vocado 규칙: 팀 작업 한 번 = Linear 이슈 하나 |
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

각 제안에 요소별 점수를 그대로 보여 준다("왜 이 팀에 이 편인가"). 가중치는 설정 파일로 SUPERVISOR가 바꾼다.

### 5.4 DISPATCH 세션의 검토

서버가 고른 상위 후보마다 DISPATCH 세션이 티켓 본문과 댓글을 읽고:

- DB·마이그레이션·보안·권리 작업(vocado의 `Codex Engineering Task` 대상)이면 `CAUTION` 표시를 붙이고 사유를 적는다.
- 사람 결정이 먼저 필요한 티켓(예: "사용자 확인 후")이면 값 없는 `--hold`로 선행 FLIGHT 없는 HOLD를 건다. 사유는 메모에 적고, HOLD 뒤에 FLIGHT가 수정되면 atc가 풀어 다시 검토하게 한다.
- 선행 작업이 본문에만 적혀 있고 `blocks` 관계로는 없으면 `dispatch note <ID> --hold <FLIGHT> -- <메모>`로 HOLD를 건다. 지정하는 FLIGHT는 **막는(선행) FLIGHT**이고, 제안은 ASSIGN 목록이 아니라 HELD 목록으로 간다. 제안 자신의 FLIGHT는 예약된 채로 남아 planner가 다시 올리지 않는다(AIRCRAFT는 다른 FLIGHT가 쓸 수 있게 놓아 둔다). 보낼 수는 없고, FLIGHT PLAN에 `HOLD — 선행 FLIGHT …` 줄이 들어간다. 지정한 FLIGHT가 모두 끝난 상태가 되면 atc가 그 제안을 SUPERSEDED로 풀어 다시 후보가 되게 한다. HOLD에는 24시간 만료가 없다. 대신 FLIGHT 자체가 Todo가 아니게 되거나 SUPERVISOR가 "HOLD 풀기"를 누르면 닫힌다.
- 판단 근거를 한두 줄로 제안에 남긴다.

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
```

제안 상태: `PROPOSED → (SHADOW_AGREE | SHADOW_DISAGREE)`(2a), `PROPOSED → APPROVED → SENT → ACCEPTED → DEPARTED`(2b), 곁가지 `REJECTED`, `DECLINED`(CAPTAIN 사유), `SUPERSEDED`(사람이 직접 배정했거나 상황이 바뀜), `EXPIRED`(24시간). `HOLD`가 걸린 `PROPOSED` ASSIGN은 주 흐름에서 빠져, 풀릴 때까지 HELD 목록에서 기다린다(24시간 만료 없음).

거절에는 **사유 칩**을 쓴다. SUPERVISOR 화면에서 서버의 사유 목록(`server/reasons.ts`, 브리핑의 `reasonCodes`) 중 하나 이상을 고르고 메모를 선택으로 덧붙이며, `"<칩> · <칩> — <메모>"` 형태로 `reason`에, code는 `reasonCodes`에 저장된다. 점검은 칩별로 센다(`reasonCounts`). 가장 중요한 칩은 상위 이슈(5.1.1)로, 이건 planner가 스스로도 걸러 낸다.

브리핑의 `reasonStats`는 칩을 planner의 할 일 목록으로 바꾼다. 칩마다 건수, 최근 예시 FLIGHT 3건까지, 그리고 planner가 그 사유를 이미 스스로 거르는지(`auto`, `partial`, `manual`과 방법)를 준다. 지금은: 이미 완료됨 → LOGBOOK·열린 PR 규칙과 Linear Done 상태(auto), 상위 이슈 → 5.1.1(auto), 우선순위 미정 → 우선순위 없음 규칙(auto), 선행 FLIGHT·PR 대기 → Linear `blockedBy`는 HOLD, 다른 PR은 OCC HOLD로만(partial), 저장소 밖 작업 → 프로젝트 매핑만(partial), AIRCRAFT 부적합 → TYPE RATING·CREW·`tail:` 규칙(partial), 사람 결정 필요·기타 → manual. DISPATCH 점검 패널에 "거절 사유 → 배정 규칙"으로 보인다.

## 7. atc에 더할 것

| 곳 | 내용 |
|---|---|
| `server/sources/linear.ts` | 조회에 `relations`(blocks), `labels`, `project`, `createdAt`, 상태 진입 시각(가능하면 `history`) 추가 |
| `server/dispatch.ts` | 후보·슬롯·점수 계산(순수 함수 + 테스트) |
| `server/proposals.ts` | 제안 기록(`~/.local/state/atc/proposals.jsonl`, 추가만 함, clearances와 같은 방식) |
| API | `GET /api/dispatch/brief`, `POST /api/dispatch/proposals/:id/{note,hold,agree,disagree,approve,reject,sent,accept,decline}` |
| 이벤트·기록 | `proposal.created / decided / sent / accepted / departed / superseded`를 FLIGHT RECORDER에 |
| 설정 | `~/.local/state/atc/dispatch.json`: 프로젝트→AIRPORT 매핑, 슬롯, 가중치, 모드(`shadow`/`approval`) |
| 화면 | DISPATCH 탭: 제안 카드(FLIGHT·AIRCRAFT·요소별 점수·DISPATCH 메모·CAUTION·HOLD), 승인/거절 버튼(거절은 사유 칩 + 선택 메모), HELD 목록, 슬롯 현황, RELEASE 목록 |
| 지표 | 그림자 합의율, 제안→수락 시간, 유휴 AIRCRAFT 시간(PARKED인데 Todo가 있던 분), 방치된 ENROUTE 수 |
| `atc/occ/`(전 `atc/dispatch/`) | TOWER와 같은 구조: `CLAUDE.md`(역할·판단 기준), `/tick`, guard(atc CLI·jq만, Linear는 읽기 MCP만) |

## 8. 넘어가는 기준

| 전환 | 기준(제안값) |
|---|---|
| 1.5 → 2a | 바로 시작 가능(아무것도 보내지 않으므로 1.5와 나란히 운용) |
| 2a → 2b | 그림자 제안 20건 이상, 합의율 80% 이상, blocks를 어긴 제안 0건. 동시에 1.5 점검 4개 충족 |
| 2b → 3(ATFM) | 2주 이상, READBACK 비율 90% 이상, DISPATCH가 보낸 FLIGHT에서 난 LOS가 거의 0, 유휴 AIRCRAFT 시간 감소 |

## 9. 위험과 대응

| 위험 | 대응 |
|---|---|
| 팀에 일을 쏟아붓기 | TEAM당 1, AIRPORT·전체 슬롯, 복창 대기 중이면 추가 배정 없음 |
| 오래된 Linear 상태(방치된 In Progress) 때문에 판단이 틀림 | 첫 구현에 `RELEASE` 포함, NO CONTACT FLIGHT를 먼저 정리 |
| Symphony와 같은 티켓을 두고 경합 | `symphony-pilot` 라벨 제외. Symphony 클론이 생기면 별도 AIRPORT로 개설해 보이게 |
| 사용자가 직접 준 일과 겹침 | 직접 배정을 감지(STAND·Linear In Progress가 제안 없이 생김)하면 관련 제안 SUPERSEDED |
| 위험 작업을 가볍게 배정 | DISPATCH 세션의 본문 검토와 CAUTION, CAUTION 제안은 3단계에서도 자동 승인 대상에서 제외 |
| DISPATCH가 코드·Linear를 건드림 | guard(atc CLI·jq만), Linear는 읽기 전용 MCP만 허용 |

## 2b 켜는 법

2b는 구현돼 있고 `mode` 뒤에 있다. 켜면 승인한 제안이 실제 팀 세션에 나가므로 이 순서로 한다.

1. DISPATCH 탭에서 2b 진입 점검(그림자 판정 20건 이상, 합의율 80% 이상)을 확인한다.
2. 팀 CLAUDE.md(`vocado_nextjs/CLAUDE.md`)의 READBACK 규칙을 넓혀, CAPTAIN이 `[DISPATCH D-xxxx]` FLIGHT PLAN에도 `READBACK D-xxxx`(또는 사유)로 답하게 한다.
3. DISPATCH 탭의 "2b 승인 운용 켜기"(또는 `POST /api/dispatch/mode {"mode":"approval"}`). 돌고 있는 DISPATCH 세션은 다음 바퀴에 모드를 읽는다.
4. 멈추려면 shadow로 되돌린다. 이미 보낸 FLIGHT PLAN은 그대로 두고, 새로 보내지는 않는다.

알려진 한계: `dispatch release`는 메시지를 보내기 전에 제안을 SENT로 바꾼다. 전달이 실패하면(CAPTAIN 세션이 없거나 메시지가 승인 대기로 잡힘) SENT로 남고, 10분 뒤 NO READBACK으로 보이면 DISPATCH가 한 번 재송신한 뒤 SUPERVISOR에게 보고한다.

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

남은 결정: 2b에 들어갈 때 vocado `CLAUDE.md`의 READBACK 규칙을 FLIGHT PLAN(`[DISPATCH D-xxxx]`)까지 넓힐지. 2a에는 필요 없다.
