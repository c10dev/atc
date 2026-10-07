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
- 담당자로는 팀을 구분할 수 없으므로 **팀 적합도는 과거 운항 이력**(어느 팀이 관련 FLIGHT를 날았나)으로 추정한다. 다만 API 키 주인이 *아닌* 담당자나 위임 대상은 뜻이 있다: atc 밖의 누군가가 그 FLIGHT를 맡았다(5.1.2).
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
| `REPOSITION` | AIRCRAFT를 다른 AIRPORT로. FLEET PLAN의 종류로 만들었다(ATC-179, [fleet.ko.md](fleet.ko.md) 8.6). DISPATCH가 직접 내지는 않는다 | DSGN FLIGHT가 쌓였는데 DSGN 소속 AIRCRAFT가 없음 |

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
  - Linear에서 API 키 주인이 아닌 사람이나 agent(Codex 등)에게 담당·위임되지 않음
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
| **atc 밖에서 맡음**: Linear 위임 대상(delegate), 없으면 담당자가 API 키 주인(`viewer`)이 아님. 읽기만 하고 atc는 담당자를 바꾸지 않는다 | `Linear 담당 <이름> — atc 밖에서 맡음` | 2026-09-28 |
| 매핑 없는 프로젝트, 닫힌 AIRPORT | `배정 제외 프로젝트: <프로젝트>`, `프로젝트 없음`, `<CODE> AIRPORT가 운항 중이 아님` | |
| **이미 완료됨**: 그 FLIGHT의 PR이 LOGBOOK에 ARRIVED로 있고 되돌리지 않음([fleet.ko.md](fleet.ko.md) 7.1) | `이미 완료됨 — PR <repo>#N 머지됨(LOGBOOK)` | 2026-09-27 |
| **작업 중**: ticket key가 그 FLIGHT인 열린 PR(Draft 포함) | `열린 PR #N 있음` | 2026-09-27 |
| **FLIGHT 보류**: 최근 24시간 안에 FLIGHT 칩으로 거절된 ASSIGN이 있고, 그 뒤로 이슈가 바뀌지 않음(6.1) | `FLIGHT 보류 — <칩> (D-xxxx 판정) — 이슈가 바뀌거나 MM-DD HH:MM부터 다시` | 2026-09-27 |
| 워크트리(STAND)가 이미 있음 | `이미 STAND가 있음` | |
| **멈춘 AIRCRAFT**(ATC-90): health가 `RESUME`·`STALLED`이거나, 머지된 PR이 없는 In Progress FLIGHT(`tail:` 라벨이나 쥔 STAND)를 아직 쥐고 있다(STAND 없는 FLIGHT는 제외). 쥔 FLIGHT는 WAKE만큼 슬롯을 쓰므로, 슬롯이 남은 팀(예: `wake:L`을 쥐고 `perTeam` 1)은 그 안에 드는 FLIGHT를 받을 수 있다 | `TEAM_G — VOC-72 아직 진행 중(PR 없음)`, `TEAM_H — RESUME 필요(한도 풀림 22:10Z)`. 키는 REGISTRATION이다. 열린 제안은 `AIRCRAFT 멈춤 — …`으로 SUPERSEDED되고, SUPERVISOR 판정이 아니라서 24시간 짝 규칙을 시작하지 않는다 | 2026-09-29 |
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

**열린 제안 상한을 보여 준다(ATC-403).** `GET /api/dispatch/brief`에 `cap: {open, cap, full, waitingForCap}`(`capStateOf`, 순수)가 있고 FLEET PLAN 화면이 `열린 제안 n/상한`을 보여 준다. `open`은 `syncOps`와 같은 기준으로 결정 안 된 `ASSIGN` 카드를 센다(HELD·RESUME·PR HOLDER 카드는 세지 않는다). `open`이 `slots.openProposals`에 이르면 `waitingForCap`이 상한 때문에 카드가 되지 못한 계획의 FLIGHT를 점수 높은 순으로 적어, 가득 찬 상한을 일감이나 AIRCRAFT 부족으로 읽지 않게 한다. 보여 주기만 한다: 상한 값은 바꾸지 않고, 올릴지 둘지는 SUPERVISOR가 정한다.

### 5.3 점수 (높을수록 먼저)

| 요소 | 계산 | 기본 가중 |
|---|---|---|
| 우선순위 | Urgent 4 · High 3 · Medium 2 · Low 1 (없음은 후보에서 제외) | ×3 |
| 대기 시간 | Todo로 머문 일수(최대 14) | ×0.5 |
| 풀어 주는 FLIGHT | 이 FLIGHT가 blocks 하는 Todo 수 | ×2 |
| 팀 적합도 | 이 AIRCRAFT가 과거에 같은 프로젝트·related FLIGHT를 날았던 횟수(FLIGHT RECORDER·청구 이력) | ×1 |
| 충돌 위험 | 지금 AIRBORNE인 FLIGHT와 related로 묶인 수. AIRBORNE은 Linear 상태가 completed·canceled가 아니고 LOGBOOK에 ARRIVED도 없을 때만이다(ATC-139). 같은 기준이 AIRCRAFT 슬롯에 세는 FLIGHT, AIRPORT AIRBORNE 부하, 파일 겹침 holder도 정한다 | ×−2 |
| 파일 겹침 | 이 FLIGHT가 고칠 것으로 예측한 파일 중 같은 AIRPORT에서 날고 있는 FLIGHT가 이미 바꾼 파일, WAKE 가중(5.3.1). `weights.overlap` | ×−1 |
| 이어서 하면 충돌 없음 | 그 파일을 만지는 팀이 이 AIRCRAFT의 팀뿐(5.3.1). `weights.sameTeam` | ×1 |
| ROUTE | FLIGHT의 프로젝트가 그 AIRCRAFT의 routes에 있음([fleet.ko.md](fleet.ko.md) 5장) | ×1 |
| 지금 WAYPOINT | FLIGHT가 그 ROUTE의 지금 구간 WAYPOINT(지나지 않은 첫 Linear 마일스톤) 이슈임([routes.ko.md](routes.ko.md) 8단계). 설명에 ROUTE와 WAYPOINT가 보인다. `dispatch.json`의 `weights.waypoint` | ×1 |

각 제안에 요소별 점수를 그대로 보여 준다("왜 이 팀에 이 편인가"). 가중치는 설정 파일로 SUPERVISOR가 바꾼다.

점수 없이 짝의 이유만 보여 주는 표시가 둘 있다. `STAND 없이`(STAND 규칙 밖으로 준 SURVEY·CHECK, AIRCRAFT 상태와 함께. 예: `VOC-10 아직 진행 중(PR 없음) — 남은 슬롯 0.5`)와 모든 CHECK에 붙는 `CHECK 독립성`(빼 둔 만든 팀, 누가 만들었는지 모르면 `확인 못 함 — …`). 쉬는 AIRCRAFT에 주는 가산점은 없다.

#### 5.3.1 파일 겹침 (ATC-71)

같은 AIRPORT에서 같은 파일을 고칠 두 FLIGHT를 한꺼번에 시작하지 않도록 DISPATCH가 겹침을 본다.

- **날고 있는 FLIGHT의 파일**(읽기 전용, AIRPORT별). STAND에 활성 점유가 있는 FLIGHT(AIRBORNE·HOLDING)는 기본 브랜치와의 merge-base부터 HEAD까지 `git diff --name-only` 경로(head·merge-base별 캐시)와 커밋하지 않은 변경·새 파일(`git status`, DISPATCH 주기마다)을 본다. 열린 PR은 `gh`로 읽은 파일 목록(head SHA별 캐시, 새 head마다 한 번). git은 쓰지 않는다: fetch·checkout 없이 `GIT_OPTIONAL_LOCKS=0`. 둘 다 DISPATCH 주기에만 읽고 스냅샷마다 읽지 않는다. 서버를 켠 첫 바퀴는 이 값 없이 계획한다.
- **예측 파일**(순수 함수, 모델 호출 없음). FLIGHT 본문과 연결된 FLIGHT(related·blocks·blockedBy) 본문의 백틱 저장소 경로와 glob: `server/fuel-*.ts`, `docs/dispatch.md`, `web/src/{a,b}.tsx`, `server/sources` 같은 디렉터리. 펜스 코드 블록은 명령·예시가 많아 건너뛰고, URL·명령·`and/or` 같은 낱말도 뺀다. 예측한 경로마다 출처(`본문`, `ATC-70 본문`)가 보인다. 본문에 경로가 없는 FLIGHT는 겹침이 없다고 본다. 본문은 주기당 최대 8건만 Linear에서 읽고 30분(이슈가 바뀌면 그 전에) 캐시한다.
- **점수.** 겹침은 예측 ∩ 날고 있는 파일이고 날고 있는 FLIGHT마다 센다. 값은 `min(파일 수, 3) × WAKE(이 FLIGHT) × WAKE(잡은 FLIGHT)`(L 0.5 · M 1 · H 2)라 양쪽 어느 쪽이든 큰 FLIGHT가 낄수록 무겁다. 설명에 파일, 잡은 FLIGHT와 그 팀, 출처(`본문 → STAND`, `본문 → PR #12`)가 보인다.
- **같은 팀.** 이 AIRCRAFT의 팀이 날고 있는 FLIGHT와의 겹침은 충돌이 아니다. 겹치는 파일을 만지는 팀이 그 팀뿐이면 그 짝에 `이어서 하면 충돌 없음`(×1)을 준다. 그 팀이 달리 배정 가능할 때만 짝이 있다.
- **HOLD 스위치**(`dispatch.json`의 `overlap.hold`, 기본 `false`. `overlap.holdFiles`, 기본 2). `holdFiles`개 이상 겹치고 WAKE 곱이 1 이상(L끼리만은 아님)이면 무거운 겹침이다. 스위치가 켜져 있으면 그 FLIGHT는 `파일 겹침 — <FLIGHT>가 머지될 때까지`로 HOLD_DEPARTURE 된다. 잡은 FLIGHT의 STAND와 PR이 없어지면 다시 후보다. 그 파일을 만지는 팀이 그 팀뿐이고 그 팀이 날 수 있으면 HOLD하지 않는다. 꺼져 있으면 계획이 HOLD할 것을 목록(`overlapHolds`, DISPATCH 탭에 `shadow —`)으로만 보이고 요소 설명에도 적는다.
- **같은 팀 예외, 지은 대로(ATC-136).** 예외는 그 FLIGHT가 실제로 그 팀에 갈 때만 통한다. 겹치는 파일을 만지는 팀이 그 팀뿐이고 그 팀이 지금 받을 수 있으면(자격 있음, CHECK면 독립, 비어 있음, 자리 있음) 그 FLIGHT의 후보를 `tail:` 라벨처럼 그 팀 AIRCRAFT로 좁히고, 요소 설명에 `겹침은 TEAM_X뿐 — TEAM_X에만 제안`이 뜬다. 그 팀이 못 받으면(바쁨·HOLD·세션 없음·RATING 안 맞음) 다른 겹침과 똑같이 HOLD하고(스위치가 꺼져 있으면 `overlapHolds` shadow에만 남기고), 사유에 팀이 나온다: `파일 겹침 — <FLIGHT>가 머지될 때까지 (겹침은 TEAM_X뿐인데 TEAM_X가 지금 못 받음: <이유>)`. 겹치는 팀이 둘 이상이면 예전처럼 HOLD한다. 스위치 기본값, 무거운 겹침 기준, 점수 가중치는 그대로다.
- **지표.** 열린 PR이 `DIRTY`가 되면 ATFM이 `behind`처럼 `dirty` 기록을 남기고, 그때 파일이 겹치던 다른 열린 PR을 함께 적는다. ATFM 데이터 줄 `DIRTY(겹침 예측 가능)`은 7일 동안 `seen/dirty`: `DIRTY`가 된 PR 중 파일을 나누는 PR이 열려 있던 수/전체.

### 5.4 DISPATCH 세션의 검토

서버가 고른 상위 후보마다 DISPATCH 세션이 티켓 본문과 댓글을 읽고:

- DB·마이그레이션·보안·권리 작업(vocado의 `Codex Engineering Task` 대상)이면 `CAUTION` 표시를 붙이고 사유를 적는다.
- 사람 결정이 먼저 필요한 티켓(예: "사용자 확인 후")이면 값 없는 `--hold`로 선행 FLIGHT 없는 HOLD를 건다. 사유는 메모에 적고, HOLD 뒤에 FLIGHT가 수정되면 atc가 풀어 다시 검토하게 한다.
- 선행 작업이 본문에만 적혀 있고 `blocks` 관계로는 없으면 `dispatch note <ID> --hold <FLIGHT> -- <메모>`로 HOLD를 건다. 지정하는 FLIGHT는 **막는(선행) FLIGHT**이고, 제안은 ASSIGN 목록이 아니라 HELD 목록으로 간다. 제안 자신의 FLIGHT는 예약된 채로 남아 planner가 다시 올리지 않는다(AIRCRAFT는 다른 FLIGHT가 쓸 수 있게 놓아 둔다). 보낼 수는 없고, FLIGHT PLAN에 `HOLD — 선행 FLIGHT …` 줄이 들어간다. 지정한 FLIGHT가 모두 끝난 상태가 되면 atc가 그 제안을 SUPERSEDED로 풀어 다시 후보가 되게 한다. HOLD에는 24시간 만료가 없다. 대신 FLIGHT 자체가 Todo가 아니게 되면 닫힌다. SUPERVISOR는 HELD 제안을 판정하지 않는다: "대기열로"는 대기열로 돌리고, "FLIGHT 보류 확정"은 FLIGHT 보류를 걸어 닫는다(6.2).
- 판단 근거를 한두 줄로 제안에 남긴다.
- 열린 제안과 HELD 제안마다 **BRIEFING**(ATC-4)을 쓴다. 쉬운 한국어 세 줄이고, `dispatch briefing <ID> --what … --why … --risk …`로 쓴다. 추가만 하는 `brief` op로 저장하고, 다시 쓰면 덮어쓴다. 아래 "제안 카드"를 본다.

### 5.5 제안 카드 (BRIEFING, ATC-4)

SUPERVISOR는 티켓 내용을 기억하지 못할 때가 많다(VOC-195, VOC-172). 제안을 판정하려고 Linear를 열지 않아도 되게 한다. 열린 카드와 HELD 카드는 위에서 아래로 이렇게 읽힌다.

1. **BRIEFING**: 무슨 일, 왜 이 AIRCRAFT, 걸리는 점(선행, 위험, 사람이 정할 것). OCC가 쓴다(`occ/.claude/skills/tick/briefing.md` "BRIEFING"). OCC가 쓰기 전에는 제목과 본문 첫 문장에 "BRIEFING 대기"가 붙어 보인다. 본문은 atc가 백그라운드로 Linear에서 읽어 30분 동안 캐시한다(`server/briefing.ts`, `leadOf`).
2. **사실 줄**: 모델 없이 서버가 계산한다(`factsOf`). PRIORITY, FLIGHT를 만든 뒤 대기 일수, ROUTE MAP의 ROUTE와 WAYPOINT(예: "Beta Ready WAYPOINT(지금 구간) · 남은 3건 중 하나"), 선행 FLIGHT(Linear `blockedBy`와 DISPATCH HOLD)와 그 상태, 그 AIRCRAFT가 같은 ROUTE에서 최근 맡은 FLIGHT(30일 안 LOGBOOK ARRIVED와 날고 있는 ASSIGN, 셋까지), HELD 카드에서는 CROSSCHECK 판정과 사유(열린 카드는 CROSSCHECK 칩에 보인다).
3. 분류, AIRCRAFT와 점수, HOLD 줄, CROSSCHECK 칩, 판정 버튼은 전과 같다.
4. **접어 둔 자세히**("점수 요소 · 본문 · 메모"): 점수 요소, DISPATCH 메모, 본문 전체. 본문은 열 때 Linear에서 읽는다.

`GET /api/dispatch/brief`에 열린·HELD 제안의 `briefs: { <ID>: { facts, lead } }`가 더해진다. BRIEFING이 있으면 `lead`는 null이다. `POST /api/dispatch/proposals/:id/briefing {what, why, risk}`는 제안이 `proposed`일 때만 받는다. 세 줄 모두 필요하고, 공백은 한 칸으로 모으며, 한 줄 300자까지다. OCC guard는 바꾸지 않았다. `dispatch briefing`은 `dispatch note`와 같은 atc CLI 명령이고, CROSSCHECK의 허용 목록에는 없다.

### 5.6 빠른 길과 blind 표본 (ATC-6)

PREFLIGHT와 BRIEFING 뒤로 SUPERVISOR에게 오는 카드는 대부분 "이 AIRCRAFT가 맞다"만 확인하면 된다. 그래서 대기열을 나눠 그런 카드는 한 번 클릭으로 끝내고, 게이트가 뜻을 잃지 않게 일부는 blind로 둔다.

- **동의 묶음.** CROSSCHECK mark가 `agree`인 열린 ASSIGN 카드(blind 제외)는 ASSIGN 목록 맨 위에 한 줄씩 모인다. 줄에는 BRIEFING의 "무슨 일"(BRIEFING이 없으면 제목), FLIGHT, AIRCRAFT, **동의** 버튼이 있다. 버튼은 SUPERVISOR의 `agree` 판정(shadow)이나 승인(2b)을 기존 한 번 클릭 표시(`via: "crosscheck"`)와 함께 남긴다. 줄을 펼치면(▸, 키보드 Enter) 전체 카드가 보이고, 거절은 거기서 칩과 함께 한다. **"모두 동의"는 없다.** 판정마다 한 번씩 누른다.
- **반대는 펼친 채로.** CROSSCHECK가 disagree한 카드(`wrong-aircraft`, `other`. FLIGHT 칩은 이미 HELD로 간다)는 CROSSCHECK 칩과 "CROSSCHECK에 동의"가 있는 전체 카드로 남는다.
- **CROSSCHECK 대기.** 아직 mark가 없는 카드는 ATC-3의 "CROSSCHECK 대기" 상태로 mark가 있는 카드 뒤에 오고, 동의 묶음에 들어가지 않는다.
- **blind 표본.** 열린 카드의 약 5장에 1장이 blind다. 제안 ID로 정하므로(FNV-1a 해시를 5로 나눈 나머지, `server/blind.ts`) 새로고침해도 바뀌지 않는다. blind 카드는 판정할 때까지 CROSSCHECK 칩과 한 번 클릭 버튼 대신 **BLIND**를 보이고, CROSSCHECK가 agree해도 펼친 목록에 있다. 서버는 verdict·approve·reject에 `blind: true`를 남기고, blind 카드의 한 번 클릭(`via: "crosscheck"`) 판정은 409로 거절한다. 게이트 패널의 한 번 클릭 비율(`gate.crosscheck.oneClick`)에서는 blind 판정을 뺀다. 한 번 클릭이 애초에 막혀 있었기 때문이다. HELD 카드는 blind가 아니다(HOLD 자체가 CROSSCHECK 판단을 드러낸다).
- **anchoring 점검.** 게이트 패널에 "BLIND 합의율"이 더해진다. 게이트가 세는 판정 가운데 blind 카드에서 SUPERVISOR가 DISPATCH에 동의한 비율이다(`gateOf`의 `gate.blind`. 수치만 더하고 게이트에 넣고 빼는 규칙은 바꾸지 않는다). 전체 합의율보다 크게 낮으면 한 번 클릭을 기본값처럼 따르고 있다는 뜻이다.

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
  BRIEF: DIRECT
  FLIGHT VOC193 · AIRPORT VCDO · PRIORITY High
  <티켓 제목과 URL, 이슈에서 옮긴 Goal·Done when·Constraints, DISPATCH note>
  <PILOT'S DISCRETION 줄>
  — Reply to this message with "READBACK D-0003" if you take it. Reply with "UNABLE D-0003 — reason" if you cannot. Reply with "STANDBY D-0003" if you need time.(ATC-122)
  Carry the work through to the end. Stop and ask only for what needs a SUPERVISOR decision. ("DIRECT briefs" 참고)
CAPTAIN: READBACK → Linear In Progress, STAND 준비(지금 규칙 그대로)
atc: 해당 FLIGHT에 STAND가 생기면 DEPARTED, 안 생기면 30분 뒤 TOWER처럼 재확인
     STAND 없는 FLIGHT(SURVEY·CHECK): READBACK 자체로 DEPARTED(기다릴 STAND가 없다)
CAPTAIN(STAND 없는 FLIGHT만): 마쳤다고 보고 → OCC: atcctl dispatch arrived D-0003 -- '<결과 링크나 한 줄>' → atc: ARRIVED
```

제안 상태: `PROPOSED → (SHADOW_AGREE | SHADOW_DISAGREE)`(2a), `PROPOSED → APPROVED → SENT → ACCEPTED → DEPARTED`(2b), STAND 없는 FLIGHT는 `… → ACCEPTED → DEPARTED → ARRIVED`, 곁가지 `REJECTED`, `DECLINED`(CAPTAIN 사유), `SUPERSEDED`(사람이 직접 배정했거나 상황이 바뀜), `CLOSED`(보낸 뒤 FLIGHT가 Linear에서 이미 Done·Canceled·Duplicate, ATC-266), `EXPIRED`(24시간). SUPERVISOR 판정 없이 24시간 넘게 `PROPOSED`·`SHADOW_AGREE`·`SHADOW_DISAGREE`로 남은 제안은 ASSIGN·RELEASE 모두 "24시간 판정 없음" 사유로 만료된다(ATC-152. HOLD 걸린 제안은 만료가 없고, `APPROVED`는 전달 만료 규칙이 따로 있다). `HOLD`가 걸린 `PROPOSED` ASSIGN은 주 흐름에서 빠져, 풀릴 때까지 HELD 목록에서 기다린다(24시간 만료 없음). SUPERVISOR는 이것을 판정하지 않는다(6.2).

**STAND 없는 FLIGHT**(2026-09-27 구현, 규칙은 [fleet.ko.md](fleet.ko.md) 5.1.1). STAND가 필요한 FLIGHT는 PR이 머지돼 LOGBOOK에 오르면 끝이라 atc가 더 따라가지 않는다. SURVEY·CHECK는 STAND도, 대개 PR도 없어서 이렇게 한다.

- **READBACK에 DEPARTED.** `POST …/accept`가 `accept`와 `depart`(`stand: null`, `via: "readback"`)를 같은 시각에 남긴다. 제안에는 `departedStand: null`, `departedVia: "readback"`이 붙는다(STAND로 DEPARTED하면 `departedVia: "stand"`). FLIGHT 라벨은 그때 읽는다. 모르는 FLIGHT는 STAND가 필요한 쪽으로 보고, `accepted`에 남은 STAND 없는 제안은 다음 동기화에 DEPARTED가 된다.
- **CAPTAIN 보고로 ARRIVED.** OCC가 `atcctl dispatch arrived D-xxxx -- '<결과 링크나 한 줄>'`(`POST …/arrived {note}`, 500자)로 적는다. 제안은 `status: "arrived"`, `arrivedNote`, `arrivedUrl`(보고의 첫 링크)을 갖는다. STAND 없이 `departed`인 제안만 ARRIVED할 수 있다.
- **ARRIVED까지 잡아 둔다.** `inFlight`에 남고 AIRCRAFT·FLIGHT를 계속 잡으며, 만료·SUPERSEDED 없다. 보고 없이 24시간이 지나면 `overdue`에 든다. `sent`·`accepted`처럼 RECALL할 수 있다.
- **끝난 FLIGHT는 CLOSED(ATC-266).** `sent`·`accepted`·STAND 없는 `departed` 카드의 FLIGHT가 Linear에서 Done·Canceled·Duplicate가 되면 다음 동기화가 op `close`, 상태 `closed`, 사유 `FLIGHT 상태가 바뀜(<상태>)`로 닫는다. 사유는 RECENT 목록과 FOLLOWING에 하루 보인다(FOLLOWING은 이 카드의 지연을 세지 않는다). `recalling` 카드는 RECALL의 READBACK이 남아 있어 이렇게 닫지 않고, STAND가 있는 `departed`는 LOGBOOK(머지)이 끝낸다. Done인 FLIGHT는 STAND를 본 적 없는 카드(또는 STAND 없는 `departed`)에 `dispatch report`로 기록한 ARRIVED 보고나 머지된 PR이 있으면 닫는 대신 `arrived`로 끝내고, 보고가 없는 STAND 없는 FLIGHT는 보고를 기다린다. 닫힌 카드는 같은 짝을 다시 제안할 때 superseded처럼 센다: 24시간 짝 규칙은 그대로다.
- **`accepted`에서 `dispatch arrived`(ATC-266).** `accepted` 카드도 FLIGHT가 STAND 없는 종류이거나, STAND를 본 적이 없고(DEPARTURE LOG 줄도 워크트리도 없음) 그 FLIGHT의 ARRIVED 보고가 있으면 `arrived`를 받는다. 카드에는 `departedVia: "report"`가 붙고 `timeline.departed`는 없어서 FOLLOWING은 STAND 없는 FLIGHT로 읽고 LOGBOOK 줄은 쓰지 않는다. 아니면 사유와 함께 409로 거절한다.
- **ARRIVED인데 Linear는 아직 In Progress(ATC-473).** STAND 없는 FLIGHT는 워크트리가 있을 수 없어서 `no-workspace` 알림("진행 중인데 워크트리가 없음")을 내지 않는다(`server/arrived-open.ts`의 `noWorkspaceKeysOf`. STAND가 필요한 FLIGHT는 알림이 그대로다). 그런 FLIGHT에 되돌려지지 않은 LOGBOOK ARRIVED 줄이 있는데 Linear 이슈가 아직 `started`이면, HOME 할 일 목록의 종류 `ARRIVED` 한 줄이 된다(`arrivedOpenOf`): 제목에 FLIGHT key와 AIRCRAFT, 상세에 이슈 제목·ARRIVED 글·결과 링크·도착 시각·이슈 링크. Linear 상태가 `started`를 벗어나면 사라진다. `Done…` 동작은 화면에서 확인을 한 번 묻고, 기존 SUPERVISOR 전용 길 `POST /api/flight/:key/state`에 `{from, toType: "completed"}`를 보내 그 이슈 하나를 팀의 completed 상태로 옮긴다. 길은 같은 목록에 든 FLIGHT(STAND 없음, ARRIVED, `started`)만 이렇게 옮기고, 다른 started → completed 이동은 그대로 막히며, 서버는 스스로 Linear에 쓰지 않는다.
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

#### SETTLED as built (ATC-117)

2026-09-27의 churn 수정 뒤 만든 ASSIGN 65건을 비용 면에서 살펴보니 36건이 SUPERSEDED됐고, 그중 29건은 OCC 메모를, 28건은 BRIEFING을 받은 뒤였다(각각 OCC 한 바퀴. 메모에서 SUPERSEDE까지 중앙값 4.5분). SUPERVISOR는 빨리 승인하므로(만들고 승인까지 중앙값 3.9분) 메모 전에 그냥 기다리게 하면 정작 필요한 제안이 늦는다. 그래서 한 바퀴를 쓸 만한 제안인지를 본다.

- **SETTLED.** 제안이 `approved`이거나, 만든 뒤 열린 채(`proposed`, HOLD 포함) `settleMin`분 이상 지냈으면 SETTLED다. `settleMin`은 `dispatch.json`에 둔다(기본 10. `0`이면 전부 곧장 SETTLED라 예전과 같다. 음수나 숫자가 아니면 10). 읽을 때 계산한다(`server/proposals.ts`의 `settledOf`). `proposals.jsonl`에는 새 op이 없다.
- **무엇을 막나.** 관제 세션이 한 바퀴를 쓰는 때만이다. OCC는 `settled: true`인 것에만 메모·BRIEFING을 달고, CROSSCHECK는 SETTLED 제안에만 mark를 단다. 승인된 제안의 전달, RECALL, CREW CHANGE는 기다리지 않는다. planner, 점수, `REPLACE_MARGIN`, 짝 규칙, FLIGHT 보류는 그대로다.
- **빠른 승인(맞바꿈).** SUPERVISOR의 승인은 중앙값 3.9분으로 `settleMin`(10)보다 빠르다. 메모 전에 승인된 제안은 BRIEFING·CROSSCHECK mark 없이, 본문을 보고 `--hold`를 거는 OCC 검토도 없이 FLIGHT PLAN으로 나간다. 승인된 제안은 HOLD·BRIEFING·mark를 받을 수 없고 `open`·`held`에도 없어서 OCC 3단계가 읽지 않는다. ATC-117 전에는 OCC 한 바퀴보다 빠른 승인만 그랬다. 팀에게 가는 부분을 지키려고, OCC는 `inFlight`의 approved ASSIGN 중 메모가 없는 것에 `dispatch release` 직전에 메모를 단다(`dispatch note`. 본문에 선행 작업이나 "사용자가 정한다" 문구가 보이면 `--caution`). 전달은 늦추지 않는다. `settleMin`을 `0`으로 두면 예전 검토 시간으로 돌아간다.
- **브리핑.** `dispatch brief`는 `open`·`held` 항목마다 `settled: true|false`와 `settlesInMin`(남은 분, 올림, SETTLED면 0)을 붙이고 `unsettled: n`을 더한다. `crosscheckBriefOf`는 `pending`에 SETTLED만 담고 나머지 수는 `unsettledMarks`에 둔다(mark를 받을 수 있는 것만: 열림, HOLD 아님, mark 없음. 브리핑 자체의 `unsettled`는 메모가 있든 없든 아직 SETTLED가 아닌 열린·HELD 전부다). `atcctl crosscheck brief`가 `unsettledMarks`를 그대로 전한다. `settled`가 없는 옛 서버의 브리핑은 전부 SETTLED로 읽는다.
- **SQUELCH.** OCC 지문의 `needsNote`는 settled인 ID만 세고, CROSSCHECK 지문은 SETTLED뿐인 `pending`을 읽는다. 그래서 아직 아닌 제안은 tick을 열지 않는다. 제안이 SETTLED가 되면 그 ID가 저절로 들어와 시계 없이도 지문이 바뀐다.
- **카드.** 아직 아닌 제안은 메모 자리에 `메모 대기 (n분 뒤)`가 보인다(접힌 줄에서는 `BRIEFING 대기` 자리). SUPERVISOR는 그래도 바로 승인할 수 있다.
- **재생**(`server/proposals.test.ts`): 로그와 같은 모양의 고정 자료에서 메모를 받고 SUPERVISOR 판정 없이 SUPERSEDED된 29건 중 W = 5·10·15·20분이면 1·17·22·24건이 줄고, 승인된 제안은 하나도 늦지 않는다. W = 0이면 줄어드는 것이 없다.
- **다루지 않음.** 제안 몇 분 뒤 AIRCRAFT가 AIRBORNE이 되는 까닭(36건 중 13건)은 따로다. [ATC-90](https://linear.app/vocado/issue/ATC-90)(가용성)과 [ATC-95](https://linear.app/vocado/issue/ATC-95)를 본다.

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

#### 6.4 AIRCRAFT가 `/clear`를 넘어 남는다 (ATC-91)

D-0068(ATC-82 → TEAM_I)은 2026-09-29 01:40:31Z에 `aircraft: 04a9a868…`, 곧 세션 id로 만들어졌다. SUPERVISOR가 TEAM_I에서 `/clear`를 했고(대화 기록의 마지막 쓰기 01:41:20Z) 01:41:23Z에 승인했다. 새 세션은 새 id를 받았고 첫 지시가 오기 전까지 세션 파일이 없어서, 01:45:33Z에 제안이 `AIRCRAFT 불가: 세션 없음`으로 SUPERSEDED됐다. `/clear`는 `wrong-aircraft` 거절도 잊게 했고(짝 규칙이 세션 id를 키로 썼다), 진행 중인 FLIGHT PLAN의 AIRCRAFT를 잃게 할 수도 있었다. REFRESH([fleet.ko.md](fleet.ko.md) 8.6)와 FRESH START가 모두 SUPERVISOR에게 `/clear`를 부탁하므로 다시 생길 일이다.

- **키는 REGISTRATION이다.** 새 ASSIGN은 이미 있던 세션 id·이름 옆에 `registration`을 담는다(`registrationOf`, ATC-67: `Team I`와 `TEAM_I`는 한 AIRCRAFT). 짝 규칙(`recentPairsOf`, planner의 `blockedPairs`), AIRCRAFT 예약(`reservedOf`, AIRCRAFT마다 진행 중인 제안 하나와 쥔 FLIGHT), `stillValid`와 SUPERSEDED 사유(`why`), READBACK 추적이 모두 이것을 쓴다. `aircraft`(제안을 만들 때의 세션 id)와 `aircraftName`은 그대로다: FUEL 귀속이 id를 읽고, send-guard는 받는 사람을 `aircraftName`과 저장된 문구에 그대로 견준다. 메시지는 그 이름으로 가서 그 이름을 쓰는 살아 있는 세션에 닿는다. atc가 살아 있는 세션을 찾는 때는 제안을 만들 때가 아니라 메시지가 나갈 때다.
- **옛 줄**에는 `registration`이 없다. 전처럼 읽는다: `aircraftName`(그때의 이름)에서 REGISTRATION을 얻고, 이름도 없는 줄은 세션 id 그대로다. `proposals.jsonl`의 새 필드는 모르는 리더가 무시하므로 기록 형식은 그들에게 바뀐 것이 없다.
- **`RESTARTING`**([fleet.ko.md](fleet.ko.md) 8.5, "RESTARTING as built"). `/clear`와 다음 지시 사이에는 AIRCRAFT에 세션이 없다. `restartGraceMin`(`dispatch.json`, 기본 30, `0`이면 RESTARTING을 끈다: 세션 없는 AIRCRAFT는 ATC-91 이전처럼 곧바로 없음(absent). 음수·숫자가 아닌 값은 30) 동안은 없음(absent)이 아니라 `RESTARTING`이다. planner는 이것을 `plan.aircraft`에 `restarting: true`, `available: false`, `reason: "RESTARTING — 세션 없음 — /clear 뒤 첫 메시지 대기 (02:11Z까지)"`로 두어 새 FLIGHT를 받지 않게 한다.
- **제안은 닫히지 않고 기다린다.** AIRCRAFT가 `RESTARTING`인 `proposed`·`approved` ASSIGN은 "AIRCRAFT 불가"로 SUPERSEDED되지 않는다(다른 사유는 전처럼 바로 닫는다). `sent`는 원래 자동으로 닫지 않았다. 새 세션이 같은 이름으로 뜨면 같은 제안이 유효하고 그대로 나간다. 유예가 지나도 세션이 없으면 `RESTARTING`이 사라지고 제안은 전처럼 `AIRCRAFT 불가: 세션 없음`으로 닫힌다. `POST …/release`(보내기)는 그 AIRCRAFT에 살아 있는 세션이 없고 `RESTARTING`이면 409를 돌려주어 OCC가 아무도 없는 곳에 보내지 않게 한다. 승인은 그대로 남는다.
- **카드가 말한다.** brief의 `waiting: {D-0068: "세션 없음 — /clear 뒤 첫 메시지 대기"}`가 그 제안들에 붙고, DISPATCH가 카드와 진행 중 줄에 보인다.
- **빠진 것.** 친화(AFFINITY) 요소는 이전 FLIGHT를 세션 id로 읽어서 `/clear`가 그것은 여전히 초기화한다(별도의 더 작은 신호).

### LAUNCH on approve와 RESUME as built (ATC-129)

백그라운드 AIRCRAFT는 마지막 턴 뒤 60분쯤 지나면 Claude Code가 거둔다(증거는 [fleet.ko.md](fleet.ko.md)의 "유휴 종료와 DISPATCH의 LAUNCH as built (ATC-129)"). ATC-129 전에는 그 뒤 planner가 세션을 보지 못해 그 AIRCRAFT에 아무것도 주지 않았고, 사용 한도로 끊긴 FLIGHT는 SUPERVISOR가 세션을 다시 열어 "계속"을 칠 때까지 기다렸다. 이제 둘 다 SUPERVISOR가 카드 한 번 누르는 것으로 간다.

**후보**(`planDispatch`, [fleet.ko.md](fleet.ko.md)의 `snapshot.absent`). 살아 있는 세션이 없고, 전에 atc가 띄웠고(최근 14일 FLIGHT RECORDER LAUNCH), 등록부에 있고, RETIRED·`RESTARTING`이 아닌 AIRCRAFT를 `plan.aircraft`에 `id: "absent:<REG>"`, `launch: true`, 등록부의 base AIRPORT로 더한다. 붙들리지 않았으면 PARKED AIRCRAFT처럼 FLIGHT를 받는다(`reason: "ABSENT — 세션 없음, 승인하면 LAUNCH"`). 붙드는 것:

- AOG;
- `LIMIT`: 마지막 턴이 잘렸고 reset 전(`HOLD · LIMIT (cut 04:30Z) until 07:40Z`)이거나 reset을 모름. 살아 있는 형제의 ACCOUNT HOLD(같은 폴더: 관찰한 ACCOUNT가 먼저이고 `default`와 `~/.claude`를 가리키는 등록 항목은 한 ACCOUNT, [accounts.md](accounts.md) 5절). FUEL HOLD;
- 그 AIRCRAFT의 RESUME 카드가 나올 차례(`RESUME — ATC-200을 이어서(RESUME 카드)`, `stopped`);
- 끝나지 않은 `tail:` 라벨 In Progress FLIGHT(ATC-90, `stopped`);
- base AIRPORT 없음.

그 AIRCRAFT로 가는 ASSIGN은 계획과 제안에 `launch: true`를 싣는다. 데스크톱·터미널 AIRCRAFT는 LAUNCH 줄이 없어 목록에 없다.

**상한.** `launchCapOf`: 살아 있는 백그라운드 세션(관제 세션 제외)에, AIRCRAFT에 아직 살아 있는 세션이 없는 `approved` `launch` 카드를 더해 `ATC_MAX_LAUNCHED`(8.5와 같은 상한)와 견준다. `GET /api/dispatch/brief`는 `launchCap: {launched, pending, max, full}`과, 열린·HELD·승인된 `launch` 카드마다 `launch: {"D-xxxx": "LAUNCH on approve"}`를 준다. 상한이 차면 열린 카드의 글은 `LAUNCH 대기 — 백그라운드 5 + 승인된 LAUNCH 1 / 상한 6(ATC_MAX_LAUNCHED) — 자리가 나면 승인한다`이고, 승인하면 그 글과 함께 409이며 아무것도 바뀌지 않는다. 그래서 수가 상한을 넘지 않는다.

**승인**(`POST /api/dispatch/proposals/:id/approve`, `approveLaunch`). `launch` 카드는:

1. 세션을 띄우므로 이 화면에서만(`fromThisApp`, 아니면 403). OCC의 `atcctl`에는 승인이 없다.
2. 그새 그 REGISTRATION의 살아 있는 세션이 생겼으면 보통 승인이다: 아무것도 띄우지 않는다.
3. 아니면 상한을 보고(위), `approve`를 적고, `launchAircraft`를 부르고(FLEET LAUNCH와 같은 길, 그 AIRCRAFT의 마지막 LAUNCH의 permission mode·모델, FLIGHT RECORDER `by: "SUPERVISOR"`, `proposal: "D-xxxx"`), 그 결과를 새 op `{op: "launch", id, at, ok, by: "SUPERVISOR", jobId?, error?}`로 적는다. fold는 이것을 `proposal.launched`로 둔다. 상태는 `approved` 그대로다.
4. **LAUNCH 실패**: 결과는 `ok: false`이고 카드는 곧바로 `LAUNCH 실패 — <오류>`로 SUPERSEDED되어 아무것도 보내지 않는다. 응답은 같은 글의 502. 이 사유는 짝 규칙을 시작하지 않아(`BETTER_WHY`처럼) 다음 계획에 같은 카드가 다시 나오고 SUPERVISOR가 다시 승인할 수 있다. 스스로 다시 띄우지는 않는다. FLIGHT FOLLOWING에 `launch` 문제(`warn`)가 하루 뜬다.

**새 세션 기다리기**(`RESTARTING`과 같다, 6.4). `POST …/release`는 그 REGISTRATION의 살아 있는 세션이 생길 때까지 409 `TEAM_G: LAUNCHING — 새 세션을 기다림 — 새 세션이 뜬 뒤에 보낸다(승인은 그대로다)`를 돌려주고, brief의 `waiting`이 그 카드에 `LAUNCHING — 새 세션을 기다림`을 준다. LAUNCH 뒤 `launchCardTimeoutMin`(ATC-507, 기본 30, 양수만, 끌 수 없다) 동안은 "AIRCRAFT 불가"로 카드를 닫지 않는다(새 세션이 CREW BRIEFING을 읽는 동안 AIRBORNE이다). 유예가 지나도 세션이 없으면 `LAUNCH 실패 — LAUNCH 뒤 30분 동안 새 세션이 뜨지 않음`으로 닫는다(FOLLOWING `launch` 문제도). 승인은 적혔는데 LAUNCH 결과가 없으면(그 사이 서버가 멈춤) 유예 뒤 `LAUNCH 실패 — 승인 뒤 30분 동안 LAUNCH 기록이 없음 …`으로 똑같이 닫는다. atc가 스스로 다시 띄우지는 않는다. 세션이 뜨면 OCC가 전처럼 release하고 보낸다.

**LAUNCH 때 K3 재확인(ATC-506).** LAUNCH 직전에 `launchForCard`가 FLIGHT의 K3 선언과 발권을 다시 읽는다([autonomy.ko.md](autonomy.ko.md) "K3 hold"). `autoMode.allow` 항목을 만들 수 없는 K3 FLIGHT나 티켓이 스냅샷에 없는 FLIGHT는 띄우지 않는다. 카드는 `launch` 줄 없이 `approved`로 남고, brief의 `launch` 문구는 `K3 entries not ready — waiting`이며, 자동 승인 job이 tick마다 다시 시도한다. `launchCardTimeoutMin`이 지나면 K3를 사유에 적은 `LAUNCH 실패 — 승인 뒤 N분 …`로 닫힌다. 화면 승인은 `wait`와 함께 200을 돌려준다. `k3Hold`를 끄면 전과 같다.

**RESUME 카드**(`resumePlansOf`, 순수). 세션이 없는 백그라운드 AIRCRAFT의 `cut`에 reset이 있고 그것이 지났으면(새 턴 없음: cut 뒤 지시가 있으면 `cut`이 없다), DISPATCH가 그 AIRCRAFT가 날던 FLIGHT를 고른다: cut 전 마지막 DEPARTURE LOG claim·HANDOFF가 그 REGISTRATION인 FLIGHT, 없으면 `tail:` 라벨 FLIGHT 중 Linear In Progress이고 LOGBOOK에 없는 것, 가장 최근 하나. 이것이 `plan.resume`이 되고 `kind: "ASSIGN"`, `launch: true`, `resume: {cutAt, resetsAt, stand, branch, commit: {sha, at, pushed} | null, report}`인 제안이 된다: DEPARTURE LOG의 STAND와 브랜치(워크트리가 남아 있으면 그 브랜치), 워크트리의 마지막 커밋(WIP), CAPTAIN 마지막 메시지의 마지막 줄. AIRPORT는 DEPARTURE LOG의 저장소가 가리키는 것이다(착수 기록이 없는 `tail:` FLIGHT는 등록부의 base AIRPORT). AIRPORT를 모르면 카드를 만들지 않는다. 점수는 0이고 `resume` 요소가 붙으며, AIRPORT 슬롯과 `openProposals`에 세지 않는다.

- **cut 하나에 한 번.** `syncOps`는 같은 FLIGHT·같은 cut 시각으로 두 번째 카드를 만들지 않는다(`resumedOf`). 첫 카드가 어떻게 됐든(거절, 만료, 보냄) 그렇다. LAUNCH 실패로 닫힌 카드는 세지 않아 다시 나온다. 같은 FLIGHT가 나중에 새로 잘리면 새 카드가 나올 수 있다.
- **유효한 동안**은 FLIGHT가 In Progress이고 LOGBOOK에 없는 동안이다. 승인된 카드는 AIRCRAFT 사정(브리핑을 읽는 동안 AIRBORNE)으로 닫지 않는다. 열린 카드의 AIRCRAFT에 살아 있는 세션이 다시 생기면(누가 열었음) `AIRCRAFT 불가: 세션이 다시 떴음 — RESUME은 그 세션에서 SUPERVISOR가 "계속"(ATC-86)`으로 닫는다.
- **FLIGHT PLAN**(`formatFlightPlan`)은 머리와 DIRECT 줄을 그대로 두고, 제목·링크 뒤에 `RESUME — This FLIGHT was cut by a usage LIMIT at 04:30Z. Resume, don't restart — continue from the remaining work.`, `STAND … · branch … · last commit abc1234 (04:20Z) — not on origin yet`(워크트리가 없으면 `no last commit (worktree not found)`), `CAPTAIN's last report: …`(CAPTAIN이 쓴 그대로)를 더한다. FLIGHT PLAN의 다른 줄처럼 영어다(ATC-126). send-guard는 전처럼 저장된 문구와 견준다.
- **살아 있는 세션은 그대로.** 살아 있는 세션의 `RESUME`(ATC-86)에는 카드가 없다: SUPERVISOR가 그 세션에서 "계속"을 보낸다.

**OCC.** FLIGHT PLAN 절차(`occ/.claude/skills/tick/flight-plan.md`)에 한 줄이 더해졌다: `dispatch release`가 `LAUNCHING`이나 `RESTARTING`으로 409를 주면 보내지 않고 다음 바퀴에 다시 한다. `LAUNCH 실패`면 SUPERVISOR에게 보고한다. OCC의 다른 것은 그대로다.

**화면이 쓰는 API 필드.** `Proposal.launch?: true`, `Proposal.launched?: {at, ok, by, jobId?, error?}`, `Proposal.resume?: {cutAt, resetsAt, stand, branch, commit, report}`, `AssignPlan.launch?`, `AssignPlan.resume?`, `AircraftState.launch?`, `Plan.resume?`, brief의 `launch`·`launchCap`·`waiting`(이제 `LAUNCHING`도), FOLLOWING 문제 코드 `launch`.

**PILOT'S DISCRETION (ATC-129).**

- **백그라운드 출처**는 "atc가 띄웠다"(14일 안의 FLIGHT RECORDER LAUNCH, permission mode 조회가 이미 쓰는 창)이다. 등록부에는 출처 필드가 없고, 사람이 손으로 `claude --bg`로 띄운 job은 세지 않는다.
- LAUNCH 뒤 **유예**는 `restartGraceMin`(ATC-91)이었다. ATC-507부터 따로 `launchCardTimeoutMin`(기본 30, 양수만, 아니면 30)이다. 기다림과 `LAUNCH 실패 — LAUNCH 뒤 N분 …`·`승인 뒤 N분 동안 LAUNCH 기록이 없음` 닫기가 이것을 따른다. `restartGraceMin`은 더는 옮기지 않으므로 RESTARTING을 꺼도(`0`) launch 카드는 예전처럼 기다린다.
- **LAUNCH 실패**는 보낼 수 없는 승인된 카드를 남기지 않고 카드를 닫는다. 24시간 짝 규칙을 시작하지 않아 다음 계획이 다시 내놓는다.
- **RESUME 카드는 세션이 없는 백그라운드 AIRCRAFT에만**: 살아 있는 세션의 `RESUME`은 ATC-86대로이고, 세션이 없는 데스크톱 AIRCRAFT는 띄울 수 없으니 카드도 없다.
- **FLIGHT마다 한 번은 cut마다 한 번**이다. LAUNCH 실패로 닫힌 카드는 그 한 번을 쓰지 않는다.
- **RESUME 카드는 AIRCRAFT마다 하나**, 가장 최근 FLIGHT로. AIRPORT 슬롯과 `openProposals`는 보지 않는다: 이미 시작된 FLIGHT다.
- **승인하는 사이 AIRCRAFT가 다시 떴으면** 보통 승인이다. 남은 `launch` 표시는 아무것도 띄우지 않는다.
- **FLEET PLAN**도 같은 planner를 돌리므로, `launch` 카드가 받을 수 있는 FLIGHT는 거기서 더는 받을 AIRCRAFT 없는 수요가 아니고 FLEET PLAN이 같은 LAUNCH를 한 번 더 제안하지 않는다.

### LAUNCH 루프 as built (ATC-213)

2026-09-30: SUPERVISOR가 TEAM_F의 launch 카드를 두 번 승인했고 둘 다 `TEAM_F 세션이 이미 떠 있음(bg 40bb5e74)`로 실패했다. LAUNCH 실패는 판정이 아니라서 다음 주기에 같은 카드가 또 나왔다: 40분 동안 TEAM_F·TEAM_K 카드 11건이 실패했다. LAUNCH의 두 쪽이 서로 달리 봤다. 계획은 스냅샷 세션만 살아 있다고 세므로 TEAM_F는 `absent`였고 카드가 났다. LAUNCH는 `claude agents`에서 STALE 줄(ATC-93)을 빼는데, pid 없고 job state가 `blocked`인 줄은 STALE이 아니라서 살아 있는 세션으로 셌다.

Claude Code 2.1.285에서 scratch job으로 쟀다(빈 폴더에서 `claude --bg --model haiku`, 질문 하나를 해서 `blocked`가 되게 함. AIRCRAFT·관제 세션은 건드리지 않았다):

| 단계 | 결과 |
|---|---|
| 살아서 사람을 기다림 | 줄에 `pid`, `status: idle`, `state: blocked`. `state.json`은 `blocked`와 `needs` |
| worker를 SIGTERM으로 죽임(크래시) | daemon이 몇 초 안에 다시 띄움(`[worker crashed (exit 143) — respawning…]`). 새 `pid`, 여전히 `blocked` |
| worker가 정상 종료(SIGINT, 약 60분 idle 종료와 같은 꼴) | **다시 띄우지 않는다.** 줄은 `pid`·`status` 없이 `state: blocked`로 남고 `state.json`도 `blocked` 그대로. 15초 뒤에도 그대로 |
| 그 줄에 `claude stop <id>` | `stopped <id>`를 찍고 `state.json`이 `stopped`가 되며 `claude agents --json`에서 줄이 사라진다 |

운영 머신에도 같은 꼴이 있다: TEAM_F(`40bb5e74`)와 TEAM_K(`77803763`)는 SUPERVISOR가 손으로 멈춘 뒤 `state.json`이 `stopped`이고, 그 전에는 프로세스가 없었다. 프로세스 없는 job은 메시지를 받을 수 없다(세션 소켓이 없다). 실행 중인 AIRCRAFT가 아니다.

만든 것:

- **pid 없는 `blocked` 줄은 STALE이다.** `STALE_JOB_STATES`에 `blocked`를 더했다(`server/session-control.ts`). ATC-93의 보호는 그대로다: `pid`·`status` 없음, job state가 그 집합, 시작한 지 2분 이상. 살아 있는 blocked job은 `pid`와 `status: idle`이 있어 이 검사에 오지 않는다. 그러면 LAUNCH가 진행되고 옛 줄은 STALE로 남는다(둘 다 살아 보이는 줄은 생기지 않는다).
- **거절된 LAUNCH가 풀리지 않은 동안은 카드를 내지 않는다.** 그 REGISTRATION의 마지막 LAUNCH 시도가 "이미 떠 있음(bg <id>)"로 실패했고 그 job의 state가 `done`·`stopped`·`failed`가 아니면 `absentOf`가 그 AIRCRAFT를 `stuck`으로 표시하고 DISPATCH는 `LAUNCH 막힘 — bg <id>가 아직 목록에 남아 있음 — FLEET에서 그 세션을 STOP하거나 그 안에서 답한다`로 후보에서 뺀다. 사람이 그 job을 멈추거나 뒤 시도가 성공하면 저절로 풀린다. 다른 원인으로 같은 실패가 나도 막는 안전망이다.
- **FOLLOWING**의 `launch` 이슈도 사유가 "이미 떠 있음"이면 같은 말을 한다: 남은 job을 STOP하거나 그 안에서 답한다. atc가 스스로 job을 멈추지는 않는다.

풀지 못한 것: worker가 방금 크래시하면 daemon이 다시 띄우기 전 몇 초 동안 pid가 없으므로, 그 순간에는 `blocked` 줄이 STALE로 보일 수 있다(`done` 줄에도 있던 노출이다). 그 사이에 승인한 LAUNCH는 두 번째 세션을 띄울 수 있다. 더 재지는 않았다.

### 일치 기반 자동 승인 구현 내용(ATC-334)

[autonomy.ko.md](autonomy.ko.md) C14와 WO-16 1·2단계: CROSSCHECK가 agree하면 서버가 스스로 카드를 승인해서 SUPERVISOR가 카드마다 누르지 않는다. `dispatch.json`의 스위치 둘, **기본은 둘 다 off**이고 설정 창(OPERATIONS의 "AUTO APPROVE", `fromThisApp` 검사 뒤의 `PUT /api/settings`)에서만 바꾼다. `atcctl` 명령도 다른 길도 없어서 관제 세션은 켤 수 없다(K3). `on`을 고르면 다른 ⚠ 스위치처럼 확인을 묻는다.

| 스위치 | 값 | 다루는 것 |
|---|---|---|
| `autoApprove` | `off`, `shadow`, `on` | launch 카드가 아닌 열린 ASSIGN 카드와 SCHEDULE 초안 |
| `autoApproveLaunch` | `off`, `shadow`, `on` | launch 카드(ABSENT AIRCRAFT나 RESUME): 승인과 LAUNCH를 한 걸음으로 |

- **`off`**는 아무것도 바꾸지 않는다. **`shadow`**는 `auto-approve.jsonl`에 `would-approve`·`would-launch` 줄만 카드마다 한 번 적고 아무것도 승인하지 않는다. **`on`**은 `via: "auto"`(API가 보낼 수 없는 새 값. FLIGHT RECORDER 줄에는 `by: "auto"`)로 승인하고 `auto-approve.jsonl`에 `approve` 줄을 쓴다.
- **카드가 자격을 얻으려면** DISPATCH가 `approval` 모드이고, 카드가 열려 있고 SETTLED이며 HELD가 아니고, CROSSCHECK mark가 `agree`이고, **blind 표본이 아니고**(SUPERVISOR와 같은 5분의 1 해시, `server/blind.ts`), OCC가 주의를 달지 않았고, 그 AIRCRAFT의 ACCOUNT가 FUEL hold가 아니어야 한다. 순수 규칙은 `server/auto-approve.ts`의 `assignWhyNot`. disagree 카드, blind 카드, HELD 카드, 주의 카드는 전과 똑같이 SUPERVISOR 몫이다.
- **SCHEDULE 초안**도 같은 규칙(agree, blind 아님, SCHEDULE이 `approval` 모드)을 따른다. TARGET·ROUTE(그림자 전용 종류)는 승인하지 않는다. 발부와 적용은 전처럼 OCC가 한다.
- **하루 상한:** 굴러가는 24시간에 자동 승인은 `autoApproveMax`(기본 40)건까지, ASSIGN과 SCHEDULE을 같이 센다. 41번째 카드는 SUPERVISOR를 기다린다. `shadow`는 would 줄을 세어 상한이 어떻게 할지 보인다.
- **launch 카드**는 위의 공통 조건에 더해 모두 만족해야 한다: `launchCapOf`가 차지 않음(`ATC_MAX_LAUNCHED`), AIRCRAFT가 `stuck`이 아님(ATC-213), REGISTRATION이 대기 중이 아님(누가 눌렀든 그 REGISTRATION의 LAUNCH가 최근 `autoLaunchBackoffMin`분(기본 30) 안에 실패하지 않음), 24시간에 자동 LAUNCH가 `autoLaunchMax`(기본 6)번 미만. 승인과 LAUNCH는 같은 `approveLaunch`를 서버 안에서 불러서 한다(HTTP 길 없음). `POST /api/dispatch/proposals/:id/approve`는 launch 카드에 대해 `fromThisApp` 검사를 그대로 둔다. `launch` 줄과 FLIGHT RECORDER에는 `by: "auto"`가 남는다. LAUNCH가 실패하면 늘 그렇듯 카드가 SUPERSEDED로 닫히고 대기가 시작된다.
- **사람 판정이 아니다:** `via: "auto"`는 `atfm`·`preflight`처럼 `humanOf`, 2b 게이트(판정 20건에 80%), CROSSCHECK 일치율, 한 번 클릭 비율에서 뺀다. SCHEDULE의 게이트도 뺀다.
- **어디서 도나:** `server/auto-approve-run.ts`, `index.ts`가 1분에 한 번, 한 번에 한 주기만. 쓰기 직전에 카드를 다시 읽어서 먼저 온 클릭이 이긴다.
- **이번 단계가 아닌 것:** FLEET PLAN, CREW CHANGE, network 종류(WO-16의 나중 단계).

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

## 승인된 카드 CANCEL (ATC-272)

아직 보내지 않은 승인된 카드(`approved`)는 보내거나 24시간이 지날 때까지 AIRCRAFT와 FLIGHT를 잡아 둔다. 일찍 닫는 길이 둘이다:

- **FLIGHT가 상위 이슈가 됨.** `syncOps`가 열린 카드처럼 승인된 카드에도 상위 이슈 검사(5.1.1)를 한다. FLIGHT에 하위 이슈가 생겼거나 다른 FLIGHT의 `parent`로 지목되면 다음 reconcile에 사유 `상위 이슈 — 하위 N건을 묶음`으로 SUPERSEDED되고 AIRCRAFT가 풀린다.
- **SUPERVISOR가 취소함.** 진행 중 카드의 "CANCEL…"이 확인을 한 번 묻고 `POST /api/dispatch/proposals/:id/cancel`을 부른다. 서버는 화면에서 온 요청(Origin)만 받고(관제 세션의 CLI는 Origin이 없어 403), `approved`만 받는다(`sent` 이후는 409, RECALL을 쓴다). 카드는 사유 `SUPERVISOR가 취소함`으로 SUPERSEDED된다. 사람의 판정이라 24시간 짝 규칙이 적용되어 같은 FLIGHT–AIRCRAFT 짝은 24시간 다시 제안하지 않는다.

## FRESH START 만든 것 (ATC-73)

대화가 큰 AIRCRAFT에 승인된 ASSIGN은 새 세션으로 보낼 수 있다: SUPERVISOR가 진행 중 카드의 **FRESH START…**(CANCEL… 옆)를 누르고 아래 줄에서 확인한다. atc가 백그라운드 세션을 STOP하고, 첫 프롬프트가 CREW BRIEFING에 이어 FLIGHT PLAN인 새 세션을 LAUNCH한다. 내는 조건·순서·기록은 [fleet.ko.md](fleet.ko.md) 8.6 "FRESH START 만든 것 (ATC-73)".

- **API.** `GET /api/dispatch/fresh-start`는 승인된(`approved`) launch 아닌 ASSIGN마다 `{verdicts: {"D-xxxx": {ok, why?}}}`를 준다(읽기만. `ok`가 false면 카드에 `FRESH START 불가 — <why>`). `POST /api/dispatch/proposals/:id/fresh-start`(SUPERVISOR 화면만, approval 모드, launch 카드가 아닌 `approved` ASSIGN, 그 AIRPORT에 출발 중지 없음)가 실행하고 제안을 돌려준다.
- **타임라인.** LAUNCH가 성공한 뒤 제안에 `{op: "send", id, at, message, via: "fresh-start"}`가 붙는다(저장되는 message는 OCC가 보냈을 때와 같은 FLIGHT PLAN 문구, `Proposal.sentVia`). 그 뒤는 평범한 `sent` 카드다: READBACK·DEPARTED·LOGBOOK·FUEL 귀속은 어떻게 보냈는지 보지 않는다. 카드에 `FRESH START로 보냄`이 보인다. 옛 읽기는 새 칸을 무시하고, 기록은 계속 추가만 한다.
- **OCC는 다시 보내지 않는다.** `sentVia: "fresh-start"`인 `sent` 카드에 `dispatch release`는 재송신 문구를 주는 대신 409(`FRESH START가 새 세션의 첫 프롬프트로 이미 보냄`)로 답한다. 그래서 `occ/…/flight-plan.md`의 overdue 재송신 규칙이 같은 FLIGHT PLAN을 두 번 넣을 수 없고, OCC는 SUPERVISOR에게 보고한다. send-guard와 다른 guard는 그대로다.
- **launch 카드는 다르다.** 세션이 없는 `launch` 카드는 승인하면 이미 LAUNCH하고 새 세션이 뜬 뒤 OCC가 보낸다. FRESH START는 거기에 나오지 않는다.

## 자동 FRESH START (ATC-560)

ATC-560부터 AIRPORT의 FRESH START 스위치(`fresh-start.json`: `off`, `always`, `over`. 배포 값 `always`)가 그렇게 말하면, 서버는 AIRCRAFT의 세션이 이미 FLIGHT를 날은 승인된 ASSIGN에 FRESH START를 스스로 한다. 스위치, "이미 날았다" 규칙, 건너뛰는 사유, 기록과 오작동 수는 [fleet.ko.md](fleet.ko.md) 8.6 "자동 FRESH START 만든 것 (ATC-560)".

- **어디서.** `approved` 카드의 `dispatch release`에서, 출발 중지 거절 뒤·세션 확인 앞(`DispatchLauncher.beforeRelease`, `autoFreshStartGate`). 한 카드는 많아야 한 번 판정한다(`restart`·`skip`): `none`(스위치 off, `launch` 카드, 살아 있는 세션 없음, 세션의 첫 FLIGHT)은 줄 없이 전처럼 보내고, `skip`은 사유를 담은 `fresh-start-auto` 줄을 하나 남기고 전처럼 보내며, `restart`는 줄을 남기고 STOP과 LAUNCH를 뒤에서 시작한 뒤 409 `<AIRCRAFT>: RESTARTING — 자동 FRESH START(ATC-560) 중 …`으로 답한다.
- **OCC.** 새 규칙이 없다: 문구에 `RESTARTING`이 있어 OCC는 보내지 않고 승인을 그대로 두고 다음 바퀴에 다시 `release`한다. 그때 카드는 `sentVia: "fresh-start"`인 `sent`라 `release`가 이미 거절하고(ATC-73), 재시작이 실패했으면 전처럼 보내거나(STOP 실패) 세션을 기다린다(LAUNCH 실패).
- **busy.** 재시작(자동이든 버튼이든)이 STOP과 LAUNCH 사이에 있는 동안 `release`는 RESTARTING 문구로 답하고, 승인 카드의 재LAUNCH(ATC-388)는 그 카드를 건너뛰며, `POST /api/dispatch/proposals/:id/fresh-start`는 409로 답한다. 표시는 서버 메모리에만 있다.

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
  FLIGHT VOC193 · AIRPORT VCDO. This FLIGHT PLAN is withdrawn.
  <티켓 제목>
  사유: <SUPERVISOR의 사유>
  Stop work. Do not clean up the STAND (worktree). Leave it as it is. Then another AIRCRAFT can pick it up.
  — Reply to this message with "READBACK D-0003 RECALL" when you receive it.
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

## SUPERVISOR CONFIRM AT AIRCRAFT (ATC-120 as built)

사용자 등급 파일(`deploy/landing-tier.mjs`의 USER: guard, `.claude/`, 루트 `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`)을 만질 FLIGHT는 AIRCRAFT가 자기 세션 안에서 SUPERVISOR에게 go를 직접 묻는다. go는 SUPERVISOR가 그 세션에서 친다. **OCC도 서버도 "SUPERVISOR가 승인했다"고 말하지 않고**, SUPERVISOR의 go를 대신하는 atc 메시지도 없다.

- **예측(순수, `server/supervisor-confirm.ts`)**: ASSIGN마다 `planDispatch`가 이슈의 예측 경로(`predictedOf`, ATC-71)를 `tierOf`로 하나씩 돌린다. 사용자 등급인 경로가 ASSIGN의 `supervisorConfirm`이 되고 `create` op를 거쳐 제안에 실린다. 예측이 비었거나 모르는 경로면 아무것도 세우지 않는다(오탐 없음). 표시는 승인을 막지 않는다. **MCC AIRPORT에서만(ATC-159).** `deploy/landing-tier.mjs`의 등급 규칙은 atc 자신의 것이라, `planDispatch`는 AIRPORT가 MCC AIRPORT(`mcc.json`의 `airport`, 기본 `ATCC`. 파일이 없거나 깨져도 `ATCC`)인 FLIGHT에만 `supervisorConfirm`을 계산한다. ATCA나 VCDO의 FLIGHT가 `CLAUDE.md`나 `.claude/settings.json`을 예측해도 줄이 없다. 카드, 승인 창, `await-supervisor`는 필드가 있을 때만 읽으므로 고칠 것이 없었고, 이미 기록된 제안은 가진 필드를 그대로 둔다.
- **카드와 승인 창**: DISPATCH 카드, IN FLIGHT 줄(approved·sent), 승인 확인 창에 `SUPERVISOR CONFIRM AT AIRCRAFT`, 이유가 된 경로, 그 AIRCRAFT 세션에 붙여 넣을 한 줄(서버가 만든다: `D-0094 (ATC-115): SUPERVISOR go for CLAUDE.md, .claude/settings.json edits in this FLIGHT.`), 세션 여는 법(`claude agents`, 그 REGISTRATION 선택)이 보인다. `GET /api/dispatch/brief`의 `confirm[<D-xxxx>] = {paths, line, open}`이다.
- **HOLD 상태**: `atcctl dispatch await-supervisor <D-xxxx> -- <사유>`(`POST …/await-supervisor {reason}`)는 READBACK도 거절도 아닌 CAPTAIN 답(자기 사용자를 기다림)에 쓴다. `proposals.jsonl`에 추가만 하는 op `await-supervisor`. sent인 제안에만(아니면 409, 사유가 없으면 400). PILOT'S DISCRETION: 새 상태가 아니라 필드다. 제안은 `sent` 그대로 `awaitSupervisor {at, reason}`을 가져서 RELEASE·RECALL·상태 검사가 그대로 돈다. 다시 부르면 사유만 바뀌고 처음 `at`은 그대로다. READBACK(`accept`)·UNABLE(`decline`)·RECALL·만료가 지운다. 걸려 있는 동안은 READBACK overdue로 세지 않는다.
- **경보**: FLIGHT FOLLOWING이 SUPERVISOR를 기다리는 sent 제안을 따라가며 warn 문제 `await-supervisor`(key `<FLIGHT>|await-supervisor`, SUPERVISOR에게 한 번 보고)를 낸다. 스냅샷은 그 AIRCRAFT 세션에 `health` 경보(key `health|AWAIT-SUPERVISOR|<D-xxxx>`)를 올린다. ATC-99(BLOCKED 백그라운드 세션)·ATC-87과 같은 길이고 key마다 한 번이다. PILOT'S DISCRETION: 새 health 코드는 없다(`HealthCode`와 `hooks/health.d.mts`는 그대로).
- **OCC**: `occ/CLAUDE.md`와 `flight-plan.md`: CAPTAIN이 자기 사용자를 기다리며 멈추면 `dispatch await-supervisor`를 치고, 다시 보내지 않고, 어떤 승인도 전하지 않는다. guard·send-guard·FLIGHT PLAN 문구는 그대로다.

## FLIGHT FOLLOWING: 이정표 구현 내용(ATC-123)

항공사는 비행마다 OOOI, 네 개의 실제 시각을 적는다. atc도 이미 가진 기록으로 FLIGHT마다 같은 넷을 붙인다. 팀 작업을 새로 감지하지 않고 Linear에 쓰지도 않는다. ARRIVED의 뜻은 그대로고 IN이 그 옆에 놓인다.

| 이정표 | 뜻 | 출처(있는 첫 것) |
|---|---|---|
| `out` | OUT: DEPARTED | 그 FLIGHT의 첫 DEPARTURE LOG 줄(`departures.jsonl`). 없으면 제안의 `departed` 시각(STAND 없는 FLIGHT). 그것도 없으면 LOGBOOK 줄의 `departedAt`(`departedFrom`이 `pr`이 아닐 때만. PR로 추정한 값은 쓰지 않는다) |
| `off` | OFF: PR을 엶 | 다음 중 가장 이른 것: 그 FLIGHT에 묶인(브랜치, `Fixes`·`Refs` key) 열린 PR의 `createdAt`, 머지된 PR의 (머지 시각 − 착륙 대기), 첫 `landing.requested` 이벤트 |
| `on` | ON: 머지 | 머지된 PR의 LOGBOOK `arrivedAt`(여럿이면 가장 이른 머지) |
| `in` | IN: 서비스에 들어감 | `rts.jsonl`에서 결과가 `ok`이고 ON 이후이며 `to`가 머지 커밋을 품은(`git merge-base --is-ancestor`) 첫 줄의 `at`. RTS가 배포하는 저장소의 AIRPORT(`mcc.json`의 `airport`) FLIGHT에만 있다. 다른 AIRPORT는 IN이 없다 |

- `milestonesOf(flight, sources)`(`server/milestones.ts`, 순수 함수, 화면도 씀)는 `{out, off, on, in, reverted}`를 돌려준다. 출처가 없으면 그 시각은 `null`이고 추측하지 않는다. 로컬 저장소 읽기(`origin/main`의 `Merge pull request #n` 커밋으로 머지 커밋을 찾고 `is-ancestor`로 확인)는 `server/milestones-run.ts`에 있고, 읽기만 하며 캐시한다. 거절·실패한 RTS는 건너뛰고, IN은 머지를 품은 첫 성공이다.
- **되돌림**은 ON을 옮기지 않는다. 기록에서 그 PR은 머지된 채이고, `reverted`가 되돌린 PR을 담아 FIDS 툴팁이 그렇다고 알린다.
- **FLIGHT RECORDER**: FLIGHT·이정표마다 atc가 처음 본 때 한 줄. `{"t", "kind": "milestone", "milestone": "out|off|on|in", "flight", "at", "seenAt"}`. `t`와 `at`은 일이 일어난 시각이라(그 UTC 날짜 파일에 들어간다) `seenAt`이 atc가 본 시각이다. 위 기록에서 1분에 한 번 이하로 돌고, 이미 적힌 줄을 recorder에서 읽어 확인하므로 재시작해도 두 번 적지 않는다. 보관 30일보다 오래된 이정표는 적지 않는다. JSON에서는 스냅샷 차이 모양인 `TrafficEvent`가 아니라 `kind: "milestone"` 줄이라 `RecordLine`에 변형이 하나 늘었다.
- **화면**: FLIGHT FOLLOWING은 단계 막대 아래에 `OUT 03:12 · OFF 03:40 · ON 04:02 · IN 04:07`을 보인다(닿지 않은 칸은 `—`, 시계는 UTC·지역 설정을 따른다). FIDS는 REMARKS 옆에 가장 늦은 이정표를, 행 툴팁에 넷 모두 보인다. `GET /api/following` 항목에 `milestones`가 실리고, `GET /api/milestones`는 하나라도 닿은 FLIGHT의 `{at, flights: {<FLIGHT>: {out, off, on, in, reverted}}}`를 돌려준다.
- PILOT'S DISCRETION: 머지된 PR이 여럿이면 ON은 가장 이른 머지이고 IN은 그 PR의 머지 커밋을 따른다. OFF는 "대표 PR"을 고르지 않고 가장 이른 후보를 쓴다.
- 아직 없는 것(뒤에 더할 수 있다): WAKE 기대치에서 온 이정표별 목표 시각, IATA식 지연 사유 코드, ETA.

## STRIPS 진행 막대 as built (ATC-211)

STRIPS에 AIRCRAFT마다 그 FLIGHT가 어디까지 왔는지 보인다. 위의 OOOI 이정표를 바탕으로 한다. 지난 이정표는 사실이고, 추정은 지금 구간에만 있으며 퍼센트나 도착 시각이 아니라 범위다. 팀이 스스로 알리는 진행(%, todo)은 읽지 않는다.

- **모델**(`server/progress.ts`, 순수, 브라우저에서도 씀. GLOBE가 다시 쓴다). `typicalDurations`가 최근 60일 LOGBOOK 줄의 `blockMin`(OUT→OFF, `work`)과 `landingWaitMin`(OFF→ON, `landing`)의 p25·p50·p75를 셈한다. TYPE×WAKE → WAKE → AIRPORT로 넓혀 가며 표본이 3개 이상인 첫 단계를 쓴다(`tripFuelOf`와 같은 방식, 같은 `quantile`). 되돌려진 줄, PR 없는 줄, `null` 값, 그 FLIGHT 자신은 뺀다. `progressOf`는 지금 구간(`work` OUT→OFF, `landing` OFF→ON, `rts` ON→IN, `done`), 지난 분, 보통 범위(표본이 적으면 `null`), p75를 넘었는지(`late`), 표식 위치를 돌려준다. OUT이 없으면 막대가 없다.
- **구간.** `rts`는 LOGBOOK 통계가 없어 지난 시간만 보인다. 머지가 RTS로 배포되지 않는 FLIGHT(MCC AIRPORT가 아님)는 ON에서 `done`이다. STAND 없는 FLIGHT(PR 없음)는 ARRIVED까지 `work`뿐이다.
- **API.** `GET /api/milestones`가 FLIGHT마다 `progress`도 돌려준다(`server/milestones-run.ts`의 `progressNow`). PILOT'S DISCRETION: 새 길을 내지 않고 한 응답에 붙였다. 화면이 이미 스냅샷 분마다 이 길을 읽고, 진행이 같은 이정표를 쓰기 때문이다. LOGBOOK과 스냅샷만 읽고 아무것도 쓰지 않으며 코드 호스트·Linear를 부르지 않는다.
- **화면**(`web/src/views/FlightProgress.tsx`, 그리기만). FLIGHT가 있는 STAND 줄마다 얇은 막대 하나: 네 칸, 지난 칸은 실선, 지금 칸은 점선과 경과/p75 위치의 표식(칸 끝에서 멈춤), 앞 칸은 옅은 점선. 옆에 `작업 42분 · 보통 30–60분 (BUILD·M, n=12)`, `착륙 대기 8분 · 보통 5–20분 (…)`, `작업 42분 · 데이터 부족`, `RTS 대기 5분`이 붙는다. p75를 넘으면 표식과 글이 amber이고 글에 `길어짐`이 붙는다. 마우스를 올리면 이정표 시각(`milestoneTitle`), 같은 글이 `aria-label`에도 있다. `landing`에서는 이미 있는 착륙 배지와 AUTOLAND 표시를 막대 옆에 놓는다(다시 셈하지 않음). HOLD·NORDO·NEEDS YOU 표시는 그대로이고 AD HOC 줄에는 막대가 없다. 색은 `:root` 토큰만 쓴다.
- 아직 없음: 연료 게이지(토큰은 진행이 아니다), GLOBE, 막대 위 GO AROUND.

### STRIPS 진행 막대 고침 as built (ATC-218)

- **클래스 충돌.** 막대의 뿌리 클래스 `.fp`가 FLEET PLAN 카드의 클래스(`FleetPlan.css`, FLEET 탭과 함께 불러와 문서에 남는다)와 `styles.css`의 옛 규칙과 같아서, FLEET 탭을 한 번 연 뒤에는 막대마다 어두운 판이 됐다. 막대 클래스는 이제 `flp`, `flp-bar`, `flp-seg`, `flp-fill`, `flp-mark`, `flp-text`, `flp-tags`다(`FlightProgress.tsx`, `Teams.tsx`, `Teams.css`). `web/src`의 다른 곳은 쓰지 않는다. FLEET PLAN과 옛 `.fp` 규칙은 건드리지 않았다.
- **끝난 막대는 조용히.** `done` FLIGHT는 막대를 그리지 않고 `--paper-muted`의 작은 `완료`만 둔다. `aria-label`과 이정표 `title`은 그대로다. PILOT'S DISCRETION: 아무것도 그리지 않는 대신 작은 글을 남겨, 줄이 그 FLIGHT가 끝났음을 여전히 말하게 했다.
- **지금 칸이 눈에 띈다.** 지금 칸에서 표식까지 지난 부분을 실색(`--paper-ink`, 길어지면 amber)으로 채우고 나머지는 점선으로 둔다. 앞 칸은 옅게 두고 막대는 8px, 표식은 5×16px이다. 모델(`server/progress.ts`)은 그대로다: 퍼센트도 도착 시각도 없고 추정은 지금 칸 안에만 있다.

## 도착 보고 구현 내용(ATC-124)

CAPTAIN의 최종 보고는 OCC가 읽고 요약해야 하는 자유 글이었다. 이제 고정 머리와 고정 줄로 시작하고, 받은 세션이 명령 하나로 기록한다. atc는 팀 메시지를 읽지 않는다: 보고를 받은 세션(OCC, 또는 ENGINEERING)이 READBACK처럼 기록한다.

```
[TEAM_X → OCC] ARRIVED ATC-n · PR #n
TIER auto|flagged|user
TESTS <통과>/<전체> · tsc ✓ · build ✓
DISCRETION <수> — <하나씩 한 줄, 없으면 none>
BLOCKED none | <한 줄씩>
<자유 요약>
```

PR이 없는 SURVEY·CHECK FLIGHT는 `PR #n` 대신 `RESULT <링크>`를 쓴다. 코드나 테스트가 바뀌지 않은 PR(문서·설정·CI만)은 숫자 대신 `TESTS n/a`를 쓴다(ATC-209): `dispatch report --tests n/a`는 `{ na: true }`로 저장되고, 보고 줄에는 `TESTS n/a`가 보이며, 읽는 쪽은 0/0이나 실패가 아니라 "해당 없음"으로 본다. 그 밖의 자유 글은 여전히 거절하고, OCC는 숫자를 지어내지 않는다. 형식은 루트 `CLAUDE.md` "교신"과 `atc-task` skill 8절에 있다.

**빠진 보고(ATC-169).** 받은 OCC가 읽었지만 기록하기 전에 멈추면 그 보고는 사라진다. CAPTAIN이 다시 보내지 않기 때문이다. OCC 매뉴얼은 이제 읽는 즉시 기록하게 하고, `dispatch brief`의 `arrivalMissing`이 DISPATCH가 보낸 FLIGHT 가운데 STAND가 있고 PR이 ATC-124 시작 뒤(하루 안)에 머지됐는데 기록이 없는 것을 보여 준다(30분이 지나면 `due: true`). OCC는 SUPERVISOR에게 알리고 CAPTAIN에게 묻지 않는다. [control-recycle.md](control-recycle.md) 4절.

- **기록.** `atcctl dispatch report <D-xxxx|ATC-n> --pr <n> --tier <t> --tests <p/t> --discretion <수> --blocked <none|글>`(PR이 없는 FLIGHT는 `--pr` 대신 `--result <링크>`, 그때 `--tests`는 없어도 된다)이 `POST /api/dispatch/report`를 부른다. `D-xxxx`는 그 FLIGHT로 풀리고, `ATC-n` key는 직접 배정을 덮는다. `report` op를 `arrival-reports.jsonl`(`server/arrival-report.ts`, 추가만 함)에 FLIGHT별로 더하고, FLIGHT의 마지막 보고가 유효하다. 고정 칸만 저장한다: `flight`, `at`, `proposal`, `pr` 또는 `result`, `tier`, `tests`, `discretion`(수), `blocked`. 자유 요약은 atc로 보내지 않는다. `GET /api/dispatch/reports`가 목록을 준다.
- **FOLLOWING**(`server/following.ts`, key `FLIGHT|code`):
  - `no-report`: PR이 머지(ON)된 지 30분이 넘도록 기록된 보고가 없는 FLIGHT에 뜨는 정보(ADVISORY, 알림 제목 숫자에 세지 않는다). CAPTAIN이 PR을 올릴 때 보고하므로 머지 전에 기록된 보고도 센다. STAND 없는 FLIGHT에는 없다(ARRIVED는 `dispatch arrived`로 온다). DISPATCH가 보낸 FLIGHT(제안에 `send`가 있다)이고 PR이 첫 보고가 기록된 때(`REPORT_START`, 2026-09-29T08:34Z, ATC-124) 이후에 머지된 것에만 뜬다. ENGINEERING PR과 FLIGHT PLAN 없는 직접 작업에는 뜨지 않는다. 머지(ON) 뒤 24시간이 지나면 저절로 닫힌다(ATC-152).
  - `blocked-report`: 기록된 보고의 `BLOCKED`가 `none`이 아님. 하루 보이고 보고마다 한 번(`FLIGHT|blocked-report|<at>`). FOLLOWING이 더는 따라가지 않는 FLIGHT도 이 때문에 다시 들어온다.
  - 둘 다 OCC가 SUPERVISOR에게 보고할 것이고, 팀에 묻지 않는다.
- **매뉴얼.** OCC 매뉴얼(`CLAUDE.md`, `flight-plan.md`, `following.md`, 한국어가 원본)이 보고가 오면 기록하라고 하고 두 코드를 적는다. ENGINEERING도 받은 보고를 같은 명령으로 기록할 수 있다.
- PILOT'S DISCRETION: `tsc ✓ · build ✓`는 줄의 고정 부분이지만 저장하지 않는다(테스트 수는 저장하고, ✗는 `BLOCKED`에 쓴다). 한 FLIGHT에 `dispatch report`를 다시 치면 앞의 것을 대신한다. 규칙은 이 변경 뒤에 머지되는 FLIGHT뿐 아니라 최근 하루 안에 머지된 FLIGHT에도 적용되므로, 배포 뒤 첫 tick에 `no-report`가 몇 건 한꺼번에 뜰 수 있다(`following ack` 한 번으로 정리된다).
- 만들지 않은 것: 응용 저장소의 보고 규칙(SUPERVISOR가 각 저장소 `CLAUDE.md`에 줄을 더한다), 팀 메시지를 자동으로 읽는 것.

## 전달 실패한 FLIGHT PLAN 구현 내용(ATC-183)

`dispatch release`는 OCC의 `SendMessage`가 돌기 전에 제안을 SENT로 바꾼다. 메시지가 아무 데도 닿지 않으면(세션이 없거나 도구가 `success:false`를 돌려줌) 제안은 10분 동안 SENT로 남고 OCC는 그래도 LOG에 "sent"라고 썼다. 두 가지로 이 틈을 막는다.

- **없는 곳으로 보내지 않는다.** `POST /api/dispatch/proposals/:id/release`는 제안의 AIRCRAFT에 살아 있는 세션이 없으면 `<AIRCRAFT>: AIRCRAFT 세션 없음 — 보내지 않음 (LAUNCH 필요)`로 `409`를 돌려준다(`noLiveSessionWhyOf`, `server/proposals.ts`). `RESTARTING`이든 아니든 같다. `RESTARTING`과 `LAUNCHING`은 전처럼 더 구체적인 거절을 쓰고, 이 거절은 나머지(유예가 지나 사라진 AIRCRAFT)를 맡는다. 승인은 그대로다. `launch: true` 카드는 뺀다(LAUNCH가 FLIGHT PLAN을 첫 프롬프트로 가져간다). 이미 sent인 제안의 재송신에도 같다. `atcctl`은 거절을 `오류: …`로 출력하고, OCC의 jq 필터가 이미 그 줄을 고른다.
- **전달 실패를 기록하는 길.** `atcctl dispatch undelivered D-xxxx -- <사유>`(`POST …/undelivered {reason}`, 사유 필수, 300자 이내)는 `sent`인 제안에만 받는다. `undelivered` op를 더해 제안을 `approved`로 돌린다(승인 시각은 그대로, 보낸 시각과 문구는 지운다). `undelivered: { at, reason, n }`도 남긴다. **SUPERVISOR 판정이 아니다**: `humanOf`는 그대로이고 24시간 짝 규칙도 시작하지 않는다. AIRCRAFT가 돌아오면 다음 `dispatch release`가 다시 보낸다. 다음 동기화 때 AIRCRAFT가 더는 후보가 아니면 `AIRCRAFT 불가: 전달 실패 — <사유>`로 닫히고, 그 사유는 짝 규칙을 시작하지 않는 사유다.
- **CAUTION.** FLIGHT FOLLOWING에 `undelivered` 문제(심각도 `warn`이라 SUPERVISOR 경보는 CAUTION)가 뜨고 제안, AIRCRAFT, 사유를 적는다. key에 시도한 시각이 들어 있어 실패한 시도마다 경보 하나가 뜨고, 제안이 닫히거나 다시 보내진 뒤에도 24시간 남는다(`undeliveredOf`, `unable`과 같다).
- **RADIO.** DELIVERY의 FLIGHT PLAN 교신이 닫히고 표시된다: `undelivered`에 사유가, `closedBy`는 `undelivered`. 새 시도의 id가 `D-xxxx`이므로 겹치지 않게 이 교신의 id는 `D-xxxx#undelivered1`(다음은 `2`…)로 바뀐다. 새 기록 파일은 없다. READABILITY는 이것을 답 없음이 아니라 철회로 센다.
- **OCC 매뉴얼**(`occ/CLAUDE.md`, `.en.md`, tick skill의 FLIGHT PLAN·CREW CHANGE 파일): `SendMessage` 결과가 `success:false`이면 도구의 메시지로 곧바로 `dispatch undelivered`를 하고, 같은 tick에 다시 보내지 않고, OCC LOG에 "sent"라고 쓰지 않는다.
- **RECALL과 CREW CHANGE.** RECALL 전송은 상태를 바꾸지 않아서(`recall-send`는 문구만 출력) 되돌릴 것이 없다. OCC는 LOG에 "undelivered"라고 쓰고, 같은 tick에 다시 보내지 않고, SUPERVISOR에게 보고하며, RECALL `overdue` 규칙이 한 번 다시 보낸다. CREW CHANGE는 `crew-change send`가 sent로 기록해서 자기 `undelivered` op가 있어야 하는데 그것은 만들지 않았다. 매뉴얼은 같은 LOG·재송신 금지 규칙을 주고, 10분 `overdue` 규칙이 한 번 다시 보낸다. "알려진 빈틈"에 남는다.
- **Guard.** `controller/guard.mjs`에는 TOWER와 OCC의 명령별 목록이 없어서(`atcctl` 명령은 모두 통과) 새 명령에 허용 목록을 고칠 곳이 없다. CROSSCHECK·REVIEW·MCC 목록에는 없고, 테스트가 그것을 확인한다. `occ/send-guard.mjs`는 `SendMessage`만 지키고 그대로다: `undelivered` 뒤 제안은 `approved`이고, guard는 보내려면 여전히 `sent`(새 `release`)를 요구한다.

## SUPERVISOR RELAY와 이슈 댓글 구현 내용(ATC-271)

SUPERVISOR가 atc 화면에서 AIRCRAFT에게 말을 걸 길이 없었다. ENGINEERING은 다른 설정 폴더의 세션에 닿지 못하고(`SendMessage`는 보내는 세션의 폴더 안에서만 이름을 찾는다, ATC-251), TOWER는 닿지만 atc가 시킨 것만 보내고, FLIGHT PLAN에는 이슈 본문만 실려서 Linear 댓글로 남긴 이어받을 점이 팀에 가지 않았다.

- **RELAY.** `POST /api/relay {to, kind: "info" | "instruction", text, flight?, pr?}`(`server/relay-run.ts`, 순수 부분은 `server/relay.ts`). SUPERVISOR만: `fromThisApp`이 아니면 `403`. **relay를 만드는 `atcctl` 명령은 없어서** 세션은 만들 수 없다. 글은 영어여야 한다(서버가 한글·가나·한자, 빈 글, 2,000자를 넘는 글을 거절하고 화면도 그렇게 말한다). 추가만 하는 `relays.jsonl`(`create` → `issued` → `undeliverable` | `hand`. `delivered`는 이어진 CLEARANCE에서 읽는다: READBACK·ROGER가 닫는다)에 담고, 단계마다 FLIGHT RECORDER에 한 줄(`kind: "relay"`, 글은 싣지 않는다).
- **TOWER가 보낸다.** `GET /api/controller/brief`에 `relays[]`가 생겼다(아직 안 보낸 것만: `id`, `to`, `kind`, `type`, `flight`, `pr`, `text`). TOWER는 항목마다 `atcctl issue <to> <type> -- <text>`를 글 그대로 내고, 돌려받은 메시지를 보낸 뒤 `atcctl relay issued <R-0001> <C-xxxx>`로 표시한다(서버는 글이 relay와 다르거나 다른 AIRCRAFT에게 간 CLEARANCE를 거절한다). `type`은 `info`면 `INFO`(ROGER), `instruction`이면 PR이 있을 때 `FIX`, 아니면 `CONTINUE`다. 둘 다 READBACK이나 UNABLE로 답하는 기존 W/U 종류이고 새 CLEARANCE 종류는 없다. TOWER 매뉴얼: 행 하나(SUPERVISOR RELAY)와 명령 둘, 한국어가 원본(`controller/CLAUDE.md`, `.en.md`, tick skill 2a단계). guard는 바꾸지 않았다: `controller/guard.mjs`에는 TOWER용 명령 목록이 없다.
- **여는 곳.** PR 서랍에는 STAND를 쥔 세션이 있는 열린 PR에 `RELAY…` 줄이 있고, 현재 head에 리뷰 지적이 있으면 그 head의 FIX 글이 채워진다(`GET /api/pr/:airport/:n/detail`에 `relay: {to, flight, pr, text}`가 생겼다). FLEET 카드에는 빈 `RELAY…`가 있고, 카드에 FLIGHT가 있으면 버튼 하나가 SUPERVISOR의 이슈 댓글을 글로 채운다(`flightPlanNotesOf`. FLIGHT PLAN을 보낸 뒤에 달린 댓글용). 둘 다 보내기 전에 받는 AIRCRAFT·종류·글을 보이고 한 번 묻는다.
- **닿지 못함은 조용하지 않다.** atc가 이미 못 닿는 줄 알면 만들 때 바로 `undeliverable`이다: 그 이름의 살아 있는 세션이 없음, TOWER가 없음, AIRCRAFT가 TOWER와 다른 ACCOUNT 폴더에 있음(ATC-251). 나머지는 TOWER가 표시한다: `atcctl undeliverable <C-xxxx> -- <사유>`가 CLEARANCE를 닫고(새 op `undeliverable`. 취소처럼 닫히고 사유가 남는다) `atcctl relay undeliverable <R-0001> -- <사유>`가 relay를 표시한다. 답 없이 취소된 CLEARANCE에 이어진 relay도 undeliverable로 보인다.
- **손으로 전하는 카드.** SUPERVISOR QUEUE에 새 종류 `UNDELIVERED`가 생겼다: undeliverable relay, undeliverable CLEARANCE(3일 안), `dispatch undelivered` 뒤 `approved`로 돌아온 FLIGHT PLAN(ATC-183). 항목에 `hand: {source, id, to, reason, text, card}`가 있고 `card`는 `handCardOf`(순수)가 정한 한 걸음이다: 살아 있는 백그라운드 세션은 `CLAUDE_CONFIG_DIR=<그 ACCOUNT 폴더> claude attach <job id>`(폴더가 `~/.claude`가 아닐 때만 변수), 살아 있는 데스크톱·터미널 세션은 "열고 붙여 넣기", 살아 있는 세션이 없으면 "FLEET에서 LAUNCH하고 붙여 넣기". 카드에 글과 복사 버튼이 있고 "손으로 전했음"(`POST /api/relay/:id/hand`, `POST /api/clearances/:id/hand`, 화면에서만)이 닫는다. FLIGHT PLAN 카드에는 글이 없고(DIRECT 지시서는 FLIGHT 카드에 있다) 제안이 다시 나가면 큐에서 빠진다. 카드는 DUTY 서랍의 QUEUE에 있어서 DUTY가 켜져 있어야 보인다.
- **쓸모없어진 줄은 스스로 닫힌다(ATC-540).** `server/undelivered-moot.ts`(`isMoot`, 순수, `supervisorQueueOf`의 relay·CLEARANCE·FLIGHT PLAN 세 갈래가 함께 쓴다)가 더 전할 것이 없는 `UNDELIVERED` 줄을 큐에서 뺀다: 닿지 못한 뒤 CLEARANCE가 답을 받았거나 취소됐다. 글이 말하는 PR(본문의 `#n`·`pull/n`, `Relay.pr`, GO AROUND·FIX·LAND는 그 FLIGHT·STAND의 PR)이 더는 열려 있지 않다(GitHub를 읽었을 때만). 그 FLIGHT가 Linear에서 Done·Canceled·Duplicate다. 같은 FLIGHT에 같은 종류의 더 새 글이 닿았다. RELAY 줄도 CLEARANCE 줄과 같은 3일(`HAND_KEEP_MS`)에 사라진다. 기록은 그대로이고 큐 개수도 같은 목록을 센다. `/api/status`의 "기다림"은 `dest queue` 알림만 싣고 `UNDELIVERED` 줄은 싣지 않아 바꿀 것이 없다.
- **NOTES FROM THE ISSUE.** `flightPlanNotesOf(comments, cfg, url)`(`server/issue-notes.ts`, 순수)가 FLIGHT PLAN(`release`)과 DIRECT 지시서(`GET /api/dispatch/flight/<FLIGHT>/brief`)의 본문 절 뒤에 블록을 더한다: SUPERVISOR의 Linear 사용자가 쓴 댓글, 가장 새것이 맨 뒤, 쓴 그대로, 댓글 3개·2,000자까지(오래된 것을 빼고 "more in the issue: <url>"). Linear 사용자가 있고 이름이 봇·연동이 아니며 본문이 링크백이 아닌 댓글을 센다. `dispatch.json`의 `issueNotes: {users: [...], maxComments, maxChars}`로 사용자를 정할 수 있다. 댓글이 없거나 봇 댓글뿐이면 블록이 없다. FLIGHT PLAN을 보낸 뒤 달린 댓글은 저절로 다시 가지 않고, FLEET 카드의 RELAY가 채워 준다.
- **만들지 않은 것:** ACCOUNT를 넘는 소켓 전달(ATC-251), ENGINEERING·DUTY·모델이 만드는 relay, 지시용 일반 CLEARANCE 종류.

## STAND를 쥔 세션이 없는 GO AROUND·FIX의 RELAY 구현 내용(ATC-308)

PR에 GO AROUND나 FIX가 필요한데 그 STAND를 쥔 세션이 없으면 TOWER가 보낼 곳이 없어(`goAround.action`·`fix.action`이 `supervisor`, `why: "no-holder"`) SUPERVISOR가 TOWER의 글을 손으로 옮겨야 했다. 이제 SUPERVISOR QUEUE에 카드가 하나 뜨고, 한 번 확인하면 그 글이 전해진다.

- **카드.** SUPERVISOR QUEUE의 새 종류 `RELAY`(`server/relay-offer.ts`, 순수. `relayOffersOf`). PR과 head마다 아직 안 보낸 쥔 세션 없는 동작의 첫 번째 하나: GO AROUND가 먼저고, 그것이 나가면 FIX다. 항목에 `offer: {key, type, repo, pr, head, flight, airport, stand, standName, text, to, reason}`가 있다. `text`는 TOWER의 brief가 싣는 글 그대로이고(`goAroundOf`·`fixOf`, 같은 함수와 같은 사건 목록) `to`는 제안하는 AIRCRAFT다. head가 바뀌거나(key에 head가 있다) PR이 닫히거나 Draft가 되거나 쥔 세션이 생기거나(그러면 TOWER가 보낸다) 그 PR·type·head의 relay가 이미 있으면(어느 상태든. undeliverable은 `UNDELIVERED` 카드가 맡는다) 카드가 사라진다. `why: "repeat"`는 내지 않는다.
- **제안하는 AIRCRAFT.** `server/relay.ts`의 `lastAircraftOf(flight, …)`(순수): 그 FLIGHT의 가장 늦은 DEPARTURE LOG 줄의 AIRCRAFT. 없으면 출발했거나 도착한 가장 늦은 ASSIGN 제안의 REGISTRATION. 없으면 가장 늦은 ARRIVED 보고의 제안의 것. 아니면 `null`(SUPERVISOR가 REGISTRATION을 쓴다). 카드에서 받는 이를 고칠 수 있다.
- **relay 기록.** `POST /api/relay`가 선택 `type`(`GO AROUND` | `FIX`)과 `stand`(아는 워크스페이스의 경로나 이름, 경로로 저장)를 받는다. `type`은 `kind: "instruction"`과 `pr`·`flight`가 있어야 하고 `stand`는 `type`이 있어야 한다. `clearanceTypeOf`가 `type`을 쓴다. brief의 `relays[]` 항목에 `stand`가 생겼다. 여전히 SUPERVISOR만(`fromThisApp`, 아니면 `403`). 화면은 TOWER의 글을 고칠 수 없게(읽기 전용) 그대로 보낸다.
- **TOWER.** 항목에 `stand`가 있으면 `atcctl issue <to> <type> --stand <stand> --flight <FLIGHT> -- <text>`로 낸다. 서버의 `/api/relay/:id/issued`는 이제 CLEARANCE의 type과 STAND도 relay와 같아야 받는다. 그래서 `goAroundSent`·`fixSent`가 보낸 것으로 읽고, 그 head의 `goAround.action`이 `sent`가 되어 카드가 다시 뜨지 않는다. TOWER 매뉴얼: `controller/CLAUDE.md`·`.en.md`와 tick skill(2a)의 SUPERVISOR RELAY 행.
- **PR 서랍.** 쥔 세션이 없어도 `RELAY…` 줄이 보인다: 받는 이는 제안하는 AIRCRAFT(고칠 수 있다), 글은 GO AROUND 글이 있으면 그것, 없으면 FIX 글이고 `type`과 `stand`가 붙는다(`GET /api/pr/:airport/:n/detail`의 `relay: {to, suggested, flight, pr, text, type, stand}`).
- **팀 쪽.** 바꾼 것이 없다: 팀은 `.claude/skills/atc-task/SKILL.md`와 루트 `CLAUDE.md`대로 `GO AROUND`·`FIX`에 답하고 CLEARANCE에 STAND가 실려 있다. 그 FLIGHT를 난 AIRCRAFT가 그 STAND에 더는 없으면 `.claude/worktrees/` 안이므로 `EnterWorktree path=`로(승인 없이) 연다.
- **만들지 않은 것:** 카드로서의 `why: "repeat"`, ACCOUNT를 넘는 전달(ATC-251: 다른 폴더의 AIRCRAFT는 전처럼 `UNDELIVERED` 카드), TOWER가 스스로 하는 relay.

## PR holder 구현 내용(ATC-354)

STAND를 쥔 세션이 없고 GO AROUND나 FIX가 남은 PR은 지금까지 SUPERVISOR를 기다렸다(위의 `RELAY` 카드). 이제 DISPATCH가 먼저 holder를 고르고, 아무도 받을 수 없을 때만 SUPERVISOR에게 묻는다.

- **선택**(`holderOf`, `server/pr-holder.ts`, 순수 함수). 착륙 대기열 PR 가운데 쥔 세션 없는 GO AROUND·FIX가 남은 것(RELAY 카드와 같은 `noHolderPickOf`)마다: (1) 그 FLIGHT를 난 AIRCRAFT(`lastAircraftOf`)가 놀고 있고 필요한 TYPE RATING이 있으면 그것(`resumed`), (2) 아니면 PR의 AIRPORT 소속이고 TYPE RATING이 FLIGHT를 덮는 놀고 있는 AIRCRAFT(세션이 살아 있는 것, 그다음 LAUNCH가 필요한 것, REGISTRATION 순), (3) 없으면 받을 AIRCRAFT가 없는 것이라 `RELAY` 카드가 남는다. "놀고 있다"는 planner의 `available`이면서 예약이 없고, 멈춘·RESTARTING이 아니고, 이번 계획이 ASSIGN·RESUME으로 고르지 않았고, 열린(판정 대기·승인됨) ASSIGN 카드를 쥐지 않은 것이다. `rating:SEC`와 `Risk:` FLIGHT는 `SEC`가 필요하므로(`classOf`) 그 TYPE RATING이 있는 AIRCRAFT에만 간다. FLIGHT를 난 AIRCRAFT에 SEC가 없으면 그것도 건너뛴다.
- **카드.** `holderPlansOf`(같은 파일)가 선택을 `plan.holders`로 바꾸고, `runDispatch`가 `planDispatch` 뒤에 붙이고, `syncOps`가 `prHolder` 필드(`key`=PR·head·type, `type`, `text`, `reason`, `branch`, `stand`, `resumed`)가 있는 보통의 `ASSIGN` 제안을 쓴다. 다른 ASSIGN처럼 CROSSCHECK와 SUPERVISOR 판정을 거치고, AIRCRAFT에 세션이 없으면 같은 LAUNCH 단계를 쓴다. PR·head·type마다 카드 하나: 판정 대기부터 출발까지 살아 있는 카드는 매 주기 `plan.holders`에 남아 `syncOps`가 닫았다 다시 만들지 않는다. 끝난 카드(거절·UNABLE·RECALL)는 바로 다시 제안하지 않는다(아래 "끝내고 나서 시작한다": 기다렸다 다시 제안하고, 3번 끝나면 그 PR은 `relay` 경로로 간다). SUPERSEDED·EXPIRED면 다시 낼 수 있다. `autoApprove`가 켜져 있으면(ATC-334) PR HOLDER 카드도 다른 ASSIGN처럼 CROSSCHECK가 동의할 때 자동 승인된다. `openProposals`에 세지 않는다. 계획에 같은 PR·head·type·AIRCRAFT가 있는 동안 유효하고, 쥔 세션이 생기거나 PR이 닫히거나 head가 바뀌거나 AIRCRAFT가 받을 수 없게 되면 SUPERSEDED.
- **FLIGHT PLAN.** `formatFlightPlan`이 `PR HOLDER — PR #n … You hold it now: continue on branch … · STAND … Do not merge; the landing rules are unchanged.`와 보류 중인 글을 인용 줄(`> …`)로 더한다. TOWER가 보냈을 글(`goAroundOf`·`fixOf`)과 같다.
- **FLIGHT 없는 PR.** `ticketKey`가 없는 PR은 브랜치 이름(`ticketKeyFromBranch`, 알려진 이슈의 key여야 한다)으로 이슈를 찾는다. 못 찾으면 DUTY로 간다: DUTY brief에 `ORPHAN PRS` 구역이 생긴다(저장소 이름과 번호만).
- **RELAY 카드.** `relayOffersOf`가 `holderRoutes`(마지막 `runDispatch`의 결과, `server/pr-holder-state.ts`)를 받는다. 경로가 `relay`인 PR만 카드가 된다. 첫 계산 전에는 카드가 없고, `holderRoutes`를 안 주면 ATC-308 그대로다.
- **그대로인 것:** 새 holder는 머지하지 않고, AIRPORT 머지 규칙과 LANDING CLEARANCE 등급은 바뀌지 않는다. GO AROUND·FIX가 없는 PR에는 holder 카드가 없다.
- **아직 없음:** DUTY에게 보내는 메시지(brief에 PR을 싣기만 한다), TYPE RATING이 맞는 AIRCRAFT가 여럿일 때 부하로 고르기.

### 끝내고 나서 시작한다, 구현 내용(ATC-392)

- **순서.** `runDispatch`는 PR holder 카드를 새 ASSIGN 카드보다 먼저 계획한다. 먼저 계획의 AIRCRAFT 상태를 읽어 holder를 고르고(RESUME 카드만 그보다 앞), 고른 AIRCRAFT를 예약한 뒤 계획을 다시 짠다. 그 PR의 AIRPORT에서 놀고 있는 AIRCRAFT가 열린 PR을 먼저 받고, 새 ASSIGN 카드는 남은 AIRCRAFT에 간다.
- **아무도 못 받을 때만 RELAY.** `holderOf`가 AIRCRAFT를 못 찾았을 때만 SUPERVISOR 카드가 되고, 이제 사유가 보인다(`noHolder`, 경로의 `why`): `no AIRCRAFT at <AIRPORT>`, `no AIRCRAFT with <rating> rating at <AIRPORT>`, `none can take it now: <REGISTRATION과 사유>`(예: LAUNCH 한도).
- **보내기.** 승인된 PR holder 카드는 보통의 승인된 ASSIGN이다. 쥔 세션이 없을 때만 제안하므로, 다른 세션이 연 PR이라는 이유로 OCC가 SUPERVISOR 확인을 기다리며 붙들지 않는다(`occ/CLAUDE.md`).
- **다시 제안.** 끝난 holder 카드(거절·UNABLE·RECALL)는 30분 동안 다시 제안하지 않고(경로 `wait`, SUPERVISOR 카드 없음) 그 뒤에 같은 head로 다시 제안한다. 새 head는 key가 달라 바로 제안한다. 한 head에 카드가 3번 끝나면 사유와 함께 RELAY로 간다.
- **READBACK까지의 시간.** `prHolder.since`는 GO AROUND나 FIX가 필요해진 시각이다: GO AROUND는 그 head의 `landing.conflict`·`landing.prevMerged` 이벤트, FIX는 `review-findings`로 막힌 `landing.blocked` 이벤트, 이벤트 기록(메모리라 재시작 뒤에는 비어 있다)에 없으면 카드를 만드는 시각. `holderReadbackOf`가 `since`부터 holder의 READBACK까지의 건수와 중앙값(분)을 주고, 2b 점검(`gate3Of`)의 `holderReadback`이다.

## 발권 기록 (ATC-362, as built)

DISPATCH는 SUPERVISOR가 발권한("화살을 쏜", [autonomy.md](autonomy.md) 원칙 1·10) FLIGHT만 배정한다. 발권 기록이 없는 Todo FLIGHT는 제안일 뿐이다: DISPATCH는 `발권 기록 없음 — 제안 상태, SUPERVISOR가 발권(RELEASE)해야 배정`이라는 이유를 보이며 건너뛰고, SUPERVISOR는 DISPATCH 탭 맨 위 RELEASE 패널에서 클릭 한 번으로 발권한다. 기록은 `releases.jsonl`(상태 폴더, 추가만)이다.

- **발권이 싣는 것.** FLIGHT, 채널, 시각, `hash`: 이슈의 `## Goal`·`## Done when`·`## K effects` 절의 SHA-256 앞 16자리(세 절이 모두 없으면 본문 전체. `Ticket.releaseHash`, Linear 보드를 읽을 때 같이 계산, 추가 필드). 발권 뒤 본문이 바뀌면 해시가 달라져 그 FLIGHT는 다시 제안이 되고(`발권 뒤 목표·완료 기준이 바뀜`) 다시 발권해야 한다. 발권은 목적지와 선언한 K 효과만 싣는다. 우선순위는 따로 있는 규칙이고 그대로다.
- **채널.**
  - `screen`: RELEASE 패널의 클릭(`POST /api/releases {flight, hash}`). 서버는 이 화면에서 온 요청만 받는다(`fromThisApp`, 아니면 403). FLIGHT 상태 버튼과 같은 검사라 agent는 만들 수 없다. 화면은 보여 준 해시를 보내고, 그 사이 이슈가 바뀌었으면 409.
  - `duty-chat`: DUTY 채팅의 SUPERVISOR 본인의 말. Origin 검사를 거치는 `/api/duty/message`로 보낸 글에 `RELEASE ATC-n [ATC-m …]`나 `발권 ATC-n` 줄이 있으면 글(앞 500자)과 함께 발권을 적는다. DUTY가 이 길로 쓸 수는 없다: 이를 위한 `atcctl` 명령이 없고 DUTY guard는 바뀌지 않았다. 두 번째 길은 아래의 `duty linear create --release`(ATC-471)다.
  - `duty-chat`, `via: "create"`(ATC-471): SUPERVISOR가 DUTY 채팅에서 작업 지시서를 만들고 진행하라고 하면 그 글이 발권이다. DUTY가 `--release`(`POST /api/duty/linear`의 `release: true`)를 붙이고, 서버는 지금 도는 DUTY 턴이 SUPERVISOR가 Origin 검사를 거친 `/api/duty/message`로 쓴 글에서 시작됐을 때만 받는다(런타임이 그 글을 기억한다. REVIEW 턴·턴 없음·다른 길에서 시작한 턴은 403이고 아무것도 만들지 않는다). 이슈는 Todo로 만들고(`--release`와 `--state Backlog`는 400), 이슈가 생긴 뒤에야 `release` 한 줄을 적는다: `channel: "duty-chat"`, `via: "create"`, `words`(그 글 앞 500자), 만든 본문의 해시(스냅숏이 계산하는 `releaseHashOf`와 같다), 새 key. K3 줄을 선언했거나 `## K effects`가 `None`으로 시작하지 않는 본문은 409("fire this one on the RELEASE screen")로 거절하고 아무것도 만들지 않는다. 우선순위, ATC 팀, Backlog·Todo 상태, `--blocked-by`, 본문 모양 점검은 그대로다. `dispatch.json`의 스위치 `chatRelease`(`"on"` 기본, `"off"`면 아무것도 쓰기 전에 403, SUPERVISOR가 설정 창에서만 바꾼다: Origin 검사, DUTY·atcctl는 못 바꾼다). 스위치 옆 오작동 세기: 이 길로 7일 동안 적은 발권 수와, 그 가운데 이슈가 시작되기 전에 SUPERVISOR가 버린(Canceled·Duplicate) · Backlog로 되돌린 · 거둔 수. 위의 채팅 명령은 그대로다.
  - `attested`: 다른 세션(ENGINEERING, 데스크톱)에 한 SUPERVISOR의 말을 그 세션이 `atcctl release attest <FLIGHT> --session <이름> -- <그 말>`로 증언(`POST /api/releases/attest`). 서버는 그 말을 확인할 수 없어(agent가 쓴 글이라 거짓일 수 있다) 기록에 `attested`, 세션 이름, 말을 남기고, RELEASE 패널이 세션마다 attested 수를 세어 표본으로 확인하게 한다. 요청 본문의 `channel`은 읽지 않는다: attest는 `screen` 기록을 만들지 못한다.
- **일괄 확인.** 이미 Todo에 있는 FLIGHT는 한 번의 확인으로 발권한다. "모두 발권…"이 발권 없는 FLIGHT 목록을 보이고 화면이 보여 준 목록을 발권한다(`POST /api/releases/bulk {flights: [{key, hash}]}`, Origin 검사. 그 사이 바뀐 것은 건너뛰고 알린다). 같은 클릭이 `arm` 줄을 쓴다.
- **gate가 켜지는 때.** `dispatch.json`의 `releaseGate`: `"auto"`(기본)는 첫 일괄 확인 때 켜진다. 이 변경이 착륙해도 SUPERVISOR가 날리고 싶은 Todo FLIGHT를 확인하기 전까지는 달라지는 것이 없다. `"on"`은 항상, `"off"`는 끔. 없거나 모르는 값은 `auto`.
- **형식.** `releases.jsonl`, `Ticket.releaseHash`, `Snapshot.releases`, `releaseGate`는 모두 추가다. `atcctl release [brief]`가 읽는다. DUTY guard, 루트 규칙, 다른 guard는 바뀌지 않았다.
- **여기서 정하지 않은 것.** CROSSCHECK가 승인한 SCHEDULE NEW 초안이 Backlog로 가는지, 발권 기록이 생긴 뒤에도 우선순위 규칙이 남는지([ATC-334](https://linear.app/vocado/issue/ATC-334)). ATC-363이 이 기록을 읽는다.

## 마이그레이션 리허설 (ATC-368, as built)

호스티드 DB가 있는 AIRPORT(`airports.json`의 `hostedDb`, ATC-329)에서 PR의 새 마이그레이션이 사람 단계 없이 실전 DB에 닿는다. AUTOLAND 주기(`server/autoland-run.ts`)가 머지 전에 한 주기에 PR 하나를 리허설한다: 스위치가 켜진 AIRPORT의 CLEARED PR 가운데 막힌 것이 "새 마이그레이션이 호스티드 DB에 아직 없음"뿐이고 이 head로 시도한 적이 없는 것. 그 사유는 AUTOLAND가 그 PR을 위임했을 때(`reviewedSecurity`가 `delegate`이고 머지 리뷰 통과)에만 나온다. 아니면 일반 보안 게이트가 막아 리허설은 돌지 않는다. "뿐"은 쓰기 전에 확인한다: PR을 다시 읽어 새 마이그레이션이 적용된 것으로 치고 제외 전체를 다시 계산하고, HUMAN CHECK, 다른 SQL 경로, HOLD 같은 제외가 하나라도 남으면 실전을 건드리지 않는다. 멈춘 실행은(실전이 이미 바뀌었어도) 그 head를 AUTOLAND의 머지 후보에서도 뺀다(버전 줄이 이미 있어 ATC-329 게이트가 통과할 수 있기 때문). 성공하면 실전에 적용하고, 다음 주기에 ATC-329 게이트가 통과해 AUTOLAND가 머지한다(적용이 머지보다 먼저). 모든 단계는 PR head와 마이그레이션 버전과 함께 `migrations.jsonl`(상태 폴더, 추가만)에, 요약 한 줄은 `autoland.jsonl`(`op: "migrate"`)에 남는다. `GET /api/migrate`가 스위치와 기록을 읽는다.

순서는 정해져 있고 처음 실패에서 멈춘다:

1. **선언 검사**(`server/migration-declare.ts`, 순수). 새 SQL을 발권 때 선언한 K1 효과와 견준다: 이슈의 `## K effects` 절이고, 발권 기록(ATC-362)의 해시가 지금 본문과 같을 때만 받는다. K1이 선언되지 않았거나, 파괴적 문장(DROP, TRUNCATE, REVOKE, 이름 바꿈, 열 타입 변경, DISABLE RLS, WHERE 없는 UPDATE·DELETE), 분류할 수 없는 문장, 선언이 그 표를 적지 않은 DML이 있으면 멈춘다. 추가형 DDL은 K1이 선언돼 있으면 통과한다. 접근을 넓히거나 기존 동작을 바꾸는 문장(정책, GRANT, 역할, 확장, SECURITY, OWNER TO, CREATE OR REPLACE)은 선언의 K1 부분(`K1`부터 다음 `K2`·`K3` 앞까지)이 해당하는 낱말(`policy`·`grant`·`role`·`extension`·`security`·`trigger`·`owner`·`replace`. `ALTER FUNCTION … SET`은 `replace`로 센다. "no grant changes"처럼 부정으로만 나온 낱말은 쓴 것이 아니다)을 모두 적었을 때만 통과한다: `CREATE OR REPLACE FUNCTION … SECURITY DEFINER`는 `replace`와 `security`가 둘 다 있어야 한다. DML의 표 이름도 K1 부분에서만 찾는다. 맨 앞 BEGIN과 맨 뒤 COMMIT이 아닌 트랜잭션 문장도 멈춘다: 적용기가 파일마다 자체 트랜잭션으로 감싸므로 파일 중간의 COMMIT은 그 일부를 감싼 트랜잭션 밖에서 확정해 버린다. 기계 검사는 이 종류에는 강하고 논리(틀린 WHERE, backfill)에는 약하다. 그것은 리허설과 복원점의 몫이다.
2. **리허설.** 시험 DB가 실전과 같은 마이그레이션 버전이어야 하고, 아무것도 적용하기 전에 함수 본문 해시와 grant도 같아야 한다(실전에 손으로 고친 것 같은 어긋남은 적용 뒤 검사를 늘 실패시키므로, 실전이 그대로일 때 여기서 멈춘다)(실전에서 다시 가져오는 일은 atc 밖에서 하고, atc는 그것이 됐는지만 확인). 그다음 파일마다 버전 줄과 함께 한 트랜잭션으로 적용하고, AIRPORT의 `smoke` 질의를 돌린다.
3. **복원점.** 만들지 않고 확인한다: 호스팅 제공자에서 읽는다: PITR이 켜져 있으면 그것, 아니면 `maxBackupAgeHours`(기본 24) 안의 가장 새 완료 백업. 없으면 멈춘다. atc가 백업을 만들지는 않는다.
4. **실전 적용.** 파일마다 한 트랜잭션: 파일의 문장들(자체 BEGIN·COMMIT은 뗌)과 그 파일의 version·name 그대로의 버전 줄.
5. **적용 뒤 검사.** 버전 줄이 있고, `public`의 함수 본문 해시와 grant가 시험 DB와 같고, `healthUrl`이 있으면 200.

- **결과.** `stopped`: 실전 그대로(4단계 전의 실패, 4단계의 첫 파일 실패). `live-changed`: 4단계에서 일부 파일을 적용한 뒤 실패했거나, 실패가 서버에서 이미 커밋됐을 수 있거나(시간 초과·네트워크 오류: 실전 버전을 다시 읽고, 읽지 못하면 바뀐 것으로 본다) 5단계가 실패. 기록에 복원점이 있다. 자동 복원은 하지 않는다(아래 "Not built yet"). 같은 head는 다시 하지 않는다. `live-changed` 뒤에는 PR 전체가 어느 head에서든 사람이 풀 때까지(SUPERVISOR가 직접 머지) AUTOLAND에서 빠진다: 버전 줄이 이미 실전에 있어서, 같은 마이그레이션을 같은 버전으로 고친 새 head는 실전에서 돌아 본 적 없는 SQL로 ATC-329 게이트를 통과해 버리기 때문이다. 같은 이유로 실행마다 마이그레이션 파일별 내용 해시를 남기고, AUTOLAND가 머지 직전에 지금 파일을 적용한 것과 견주며, `applied` 뒤에 바뀐 파일은 보류한다. 4단계 전에 멈춘 실행은 실전이 그대로라 새 head가 새 시도다. 보류는 `migrations.jsonl`의 끝이 아니라 전체를 읽는다. 이유는 `migrations.jsonl`, AUTOLAND 기록, `GET /api/migrate`에 보이고, 멈추면 FLIGHT가 아직 Todo일 때 그 FLIGHT의 발권 기록도 거둔다(`releases.jsonl`의 `revoke` 줄, ATC-362. 이 파일은 SUPERVISOR의 발권을 적는데 이 op만 자동 과정이 쓴다. 추가이고 읽는 쪽은 모르는 op를 건너뛴다). CLEARED PR이 있는 FLIGHT의 보통 상태인 진행 중·검토 중 FLIGHT는 되돌릴 발권 효과가 없다: head만 머지에서 빠지고 이유는 기록에 남는다. Todo FLIGHT는 제안으로 돌아오고 이유가 RELEASE 패널에 보이며, SUPERVISOR가 다시 발권할 때까지 DISPATCH가 건너뛴다. 시험 DB는 되돌리지 않는다: 리허설 단계 뒤에서 멈추면 시험 DB가 실전보다 앞서 있고, 그 AIRPORT의 다음 리허설은 누군가 atc 밖에서 다시 가져올 때까지 "시험 DB가 실전과 같은 버전이 아님"에서 멈춘다.
- **스위치.** AIRPORT마다 하나, `migrate.json`. `PUT /api/settings`의 `migrateRehearsal: {코드: bool}`로만 바꾼다(`fromThisApp`, `atcctl` 명령 없음, 설정 창에 MIGRATE 블록). `hostedDb.testProjectRef`와 `SUPABASE_MIGRATE_TOKEN`이 있는 AIRPORT만 켤 수 있다. 기본 꺼짐.
- **자격 증명(K2).** `.env.local`의 `SUPABASE_MIGRATE_TOKEN`(읽기 전용 `SUPABASE_ACCESS_TOKEN`과 따로). SUPERVISOR가 둔다. 요청 머리에만 쓰고 오류·기록은 `redact`를 거친다. 출력·로그·복사·전송하지 않는다. 토큰의 범위는 SUPERVISOR가 고르고 기본으로는 넓다: 호스팅 제공자의 계정 토큰은 시험·실전 프로젝트와 그 계정의 다른 모든 프로젝트에 쓸 수 있으므로, 제공자가 주는 가장 좁은 토큰(또는 이 프로젝트만 가진 전용 계정)을 쓴다. 파일 하나는 요청 하나(`BEGIN`, 문장들, 버전 줄, `COMMIT`)로 보내고, 실패하면 atc가 최선으로 `ROLLBACK`을 보낸다. 제공자가 실패한 요청을 재사용 세션에서 어떻게 다루는지는 확인하지 못했다. 리허설은 AUTOLAND 모드 `merge`에서만 돈다. 단계는 끝나는 즉시 `migrations.jsonl`에 덧붙고, 실전에 쓰기 직전에도 한 줄이 남는다. 그래서 도중에 서버가 재시작돼도 흔적이 남는다(`live-apply` 시작 줄만 있고 끝이 없으면 실전이 바뀌었을 수 있다). 리허설은 AUTOLAND 주기 안에서 돌고 공급자 질의 하나가 최대 120초 걸릴 수 있어서, 리허설 하나가 모든 AIRPORT의 머지·갱신을 몇 분 늦출 수 있다. 한 주기에 PR 하나이고 드문 일(새 마이그레이션이 있는 PR)이며, 주기 밖으로 빼는 것은 후속이다. 시험 DB 확인은 버전과 카탈로그 일치뿐이다. 실전에서 최근 데이터 스냅샷으로 다시 가져오는 일과 그 나이는 atc 밖이다. PR은 제외 사유의 문구가 아니라 구조로 고른다: 바뀐 파일(알면)에 마이그레이션 폴더가 있고, 새로 읽은 게이트가 없는 버전을 말하고, 다시 계산한 제외에 다른 것이 남지 않을 때. 공급자 오류 본문은 행 값(`DETAIL` 줄, `Key (열)=(값)`, JSON의 `detail` 칸)을 걷어 낸 뒤에야 `migrations.jsonl`, `GET /api/migrate`, RELEASE 패널에 닿는다. 실전에 아직 없는 버전만 리허설하므로, 적용 뒤 같은 PR에 마이그레이션이 더해져도 다룬다. SUPERVISOR에게: 이슈는 시험 DB와 자격 증명이 준비되면 스위치가 켜진다고 하지만, 이 PR은 AIRPORT마다 SUPERVISOR가 켜기 전까지 꺼져 있는 스위치를 둔다(더 안전하고 이슈와 다르다). 멈춘 FLIGHT의 발권을 거두는 것은 FLIGHT가 아직 Todo일 때만이고, 이미 진행 중인 FLIGHT에는 영향이 없다(그 head는 그래도 머지에서 빠진다).
- **형식.** 모두 추가: `hostedDb.testProjectRef`·`smoke`·`healthUrl`·`maxBackupAgeHours`, `migrate.json`, `migrations.jsonl`, `autoland.jsonl`의 op `migrate`.
- **Not built yet.** 실전 적용 실패 뒤 자동 복원, 복원점을 그때 만들기, 시험 DB를 실전에서 다시 가져오기, 앱 점검 명령(SQL 질의만), 자체 호스팅 시험 DB(호스팅 제공자의 project ref만). 복원점에 쓰는 백업 목록 응답 모양은 실제 API로 확인하지 못했다.

## 살아 있는 세션으로 주소를 정하기와 전달 실패, 만든 것 (ATC-353)

FLIGHT PLAN·CLEARANCE·RELAY는 만들 때 저장한 이름으로 주소를 정했기 때문에, 재시작·이름 바꾸기·ACCOUNT 이동 뒤에는 아무도 답하지 않는 이름으로 갔다. 메시지 문구와 guard가 읽는 머리는 그대로이고, 바뀐 것은 누구에게 가는가와 실패한 뒤의 길뿐이다. 기록은 모두 새 선택 필드만 더한다.

- **보낼 때 정한다**(`server/address.ts`, 순수). `resolveRecipient`가 저장한 세션 id → job id → REGISTRATION → (다른 것이 없을 때만) 정확한 세션 이름 순으로 살아 있는 세션을 찾는다. 제목은 받는 이로 거절한다(`looksLikeTitle`: 공백, `#`, 따옴표, `ATC-353` 같은 이슈 키, 40자 초과. cause `bad-recipient`). `standHolderOf`는 STAND를 쥔 살아 있는 세션을 준다. `POST /api/clearances`는 `to` 없이 `stand`만 오면 이것을 쓴다. 이름이 바뀐 세션도 id로 찾고, 이름이 겹치면 가장 최근에 움직인 살아 있는 세션이다.
- **보이는 곳.** FLIGHT PLAN의 보내기 답(`release`, `recall-send`)에 `sendTo`(그대로: 제안의 `aircraftName`. `occ/send-guard.mjs`가 받는 이를 이 이름과 비교한다)와 선택 필드 `sendToName`(살아 있는 세션의 지금 이름)·`sendToId`·`sendToJobId`·`sendToAccount`가 있다. `POST /api/clearances`는 제목인 `to`를 거절하고 같은 필드를 돌려준다. RELAY는 만들 때 `toSessionId`·`toJobId`·`toAccount`를 저장하고, TOWER의 brief는 그 id로 큐에 있는 relay마다 살아 있는 `sendTo…` 필드를 주고, TOWER 매뉴얼은 `sendToId`가 있으면 그것으로 `issue`하라고 한다. `POST /api/clearances`는 `to`를 이름·콜사인·세션 id로 먼저, 그다음 REGISTRATION(가장 최근의 살아 있는 세션)으로 찾고, 그래도 없을 때만 제목이라고 거절한다. 같은 이름의 살아 있는 세션이 둘이면 모호하다고 거절한다.
- **실패 뒤의 길: 있는 것.** 닿지 못한 글은 원인과 함께 기록되고, 손으로 전하는 `UNDELIVERED` 카드는 전처럼 곧바로 뜬다. 이미 아는 ACCOUNT 사이 실패도 늦추지 않는다.
- **아직 안 만든 것.** 재시도(그 AIRCRAFT의 다음 CHECK IN이나 relaunch 뒤) → DISPATCH의 RESUME·LAUNCH 제안 → DUTY 카드 → 그다음에야 SUPERVISOR 카드로 가는 단계 길은 아직 없는 행위자(CLEARANCE·RELAY의 재시도 트리거, DUTY 카드)가 필요하다. 그것이 생기기 전에는 카드를 붙잡아 두지 않는다: 아무도 모르는 채 붙잡힌 카드는 전보다 늦다. 닿지 못한 FLIGHT PLAN은 이미 `approved`로 돌아가 다음 release가 다시 보내고, 세션이 없는 AIRCRAFT의 launch 카드는 DISPATCH 계획이 이미 낸다.
- **원인.** `undelivered`(FLIGHT PLAN)·`undeliverable`(CLEARANCE·RELAY)는 선택 `cause`를 받는다. 없으면 사유에서 읽는다(`causeOf`): `absent`, `cross-account`, `tower-down`, `restarting`, `bad-recipient`, `stale-address`, `other`. `cause` / `undeliverableCause`로 저장한다.
- **READABILITY.** 하루 기록의 모든 bucket에 `undelivered: { n, causes }`가 있다. 닿지 못한 것으로 닫힌 호출(`Transmission.undelivered`·`undeliveredCause`)에서 센다. undeliverable로 닫힌 CLEARANCE는 RADIO에서 `cancel` 대신 `undelivered`로 닫히지만, 둘 다 거둔 호출이라 다른 수는 바뀌지 않는다.

## DISPATCH 자동 운항 구현 내용 (ATC-367)

K3: DISPATCH가 사람이나 CROSSCHECK 없이 나는 것을 SUPERVISOR가 2026-10-02에 승인했다(이슈에 인용됐고 TEAM_G 세션에서 직접 확인). live first, shadow 없음([autonomy.md](autonomy.md) 원칙 1·5).

- **서버가 하는 일.** `runAutoApprove`가 1분마다, planner 자신의 필터(`settleMin` 동안 SETTLED, HELD 아님, 발권된 FLIGHT, FUEL hold 아님)와 기존 상한(`ATC_MAX_LAUNCHED`, 하루 승인·LAUNCH 상한, LAUNCH 실패 뒤 대기, LAUNCH 막힘)을 통과한 열린 ASSIGN·launch 카드를 모두 승인한다. CROSSCHECK mark, blind 표본, CAUTION 메모는 보지 않는다(메모는 FLIGHT PLAN 글에 실려 간다). 승인은 `via: "auto"`다.
- **SUPERVISOR 카드 없음.** ASSIGN·launch 카드는 SUPERVISOR QUEUE와 판정 대기 알림에서 빠진다. 갈 수 없는 카드(상한이 참, FUEL hold)는 `autoCardTtlMin`(기본 60분) 뒤 `자동 운항: 승인되지 못함` 사유로 SUPERSEDED되고, 이 사유는 churned라 그 짝이 곧바로 다시 후보가 되어 planner가 다시 제안한다. CROSSCHECK의 DISPATCH 브리핑은 비어 있다. RELEASE 카드와 SCHEDULE 초안, 그 CROSSCHECK는 그대로다. 손으로 누르는 승인·거절 버튼은 brake로 남는다.
- **스위치 하나.** `dispatch.json`의 `autoDispatch`: `"on"`(이게 들어간 뒤 기본) 또는 `"off"`. SUPERVISOR만 바꾼다: 설정 → AUTOMATION → AUTO APPROVE, Origin을 확인하는 설정 길(`fromThisApp`)로만. `atcctl` 명령은 없다. 깨진 `dispatch.json`은 `off`로 읽는다. `off`면 옛 `autoApprove`·`autoApproveLaunch` 모드(CROSSCHECK가 agree한 카드만, ATC-334)가 전처럼 돌고 SCHEDULE 초안은 계속 `autoApprove`가 정한다.
- **MISFIRE.** `GET /api/dispatch/misfire?days=7`과 DISPATCH 탭 맨 위 MISFIRE 블록이, 서버가 승인한 ASSIGN 카드 가운데 나중에 틀렸다고 드러난 것(거절·UNABLE, RECALL, 보낸 뒤 SUPERSEDED, AIRCRAFT 불가로 SUPERSEDED)을 승인한 UTC 날짜별로 그날 승인 대비 몫으로 센다. 카드는 한 번만 센다.
- **형식.** `dispatch.json`의 `autoDispatch`·`autoCardTtlMin`과 SUPERSEDE 사유 `AUTO_STALE_WHY`는 추가다. 기록 형식은 바뀌지 않는다.
- **아직 아님.** SETTLED를 기다리는 동안 있는 DISPATCH 카드에는 agree 줄과 CROSSCHECK mark가 여전히 그려진다.

## DISPATCH 화면은 없어졌다 (ATC-377)

DISPATCH가 자기 카드를 스스로 승인하므로(ATC-367) 판정 화면이던 탭을 해체했다([layout.md](layout.md) Y2). planner, 제안 기록, 모든 길은 그대로이고 화면만 옮겼다:

| DISPATCH 탭에 있던 것 | 지금 |
|---|---|
| 열린 ASSIGN·launch 카드의 승인·거절 | HOME(`#home`)의 SUPERVISOR QUEUE. 자동 운항 스위치가 꺼져 있을 때만, RELEASE 카드는 늘 |
| CROSSCHECK 동의 묶음·칩, BLIND 표본, HELD(PREFLIGHT) 버튼 | 없앴다 |
| IN FLIGHT: CANCEL, RECALL, FRESH START | FOLLOW 줄과 FLIGHT 서랍(`web/src/FlightBrakes.tsx`) |
| FLIGHT의 배정 이력(RECENT) | FLIGHT 서랍의 `배정 기록`(`GET /api/dispatch/proposals?flight=KEY`) |
| ATFM 블록(GROUND STOP, 수동 출발 중지, 슬롯)과 2a/2b 전환 | HOME의 BRAKES 줄 |
| MISFIRE | METRICS → OPERATIONS |
| 2b 점검·게이트·FLIGHT FOLLOWING 블록, 슬롯·제외 목록 | 없앴다(FOLLOW 줄이 왜 배정되지 않았는지 보인다) |

`#dispatch`는 HOME을 연다.

## K3 발권이 classifier에 닿는 길, 만든 것 (ATC-372)

K3: Claude Code auto-mode classifier가 FLIGHT에 무엇을 바꾸게 둘지 정하고, LAUNCH 플래그를 바꾼다([autonomy.md](autonomy.md) C9). 항목은 서버만, 발권 기록에서 만든다.

- **선언.** 이슈 `## K effects` 절에 효과마다 한 줄: `K3[<라벨>]: <바꾸는 통제> | files: <경로>, <경로>`. 라벨은 `Security Weaken`, `Self-Approval`, `Permission Grant`, `Self-Modification`, `Merge Without Review`, `Security Test Removal`, `Instruction Poisoning`(classifier의 soft_deny 라벨, ATC-399가 뒤의 둘을 더했다). 나머지 soft_deny 라벨은 선언할 수 없고 이유는 [autonomy.ko.md](autonomy.ko.md) C9 표에 있다. 경로는 저장소 기준 상대 경로이고 글롭과 `..`은 없다. Linear가 저장한 줄(`K3\[Security Weaken\]: …`처럼 기호 앞에 역슬래시)은 이스케이프를 되돌려 읽는다. 맞지 않는 `K3` 줄은 무시한다(항목 없음): 그 FLIGHT는 classifier 아래에 남는다.
- **항목을 만드는 때.** FLIGHT의 발권이 `screen`이나 `duty-chat` 채널이고 해시가 지금 이슈 본문과 같을 때. `attested` 발권은 항목을 만들지 않는다: agent가 증언을 쓸 수 있다(`server/k3-allow.ts`의 `k3LaunchOf`).
- **LAUNCH가 넘기는 것.** `--settings '{"autoMode":{"allow":["$defaults", <항목>…]}}'`. 선언마다 항목 하나이고 라벨, 통제, 파일, STAND(`<repo>/.claude/worktrees/<flight>-*`), 발권 id(`<FLIGHT>@<해시>`)를 적고 "Code only; nothing is executed against production during the FLIGHT"를 말한다. `$defaults`는 항목이 아니다: 없으면 `allow`가 classifier의 기본 allow 목록을 통째로 대신한다. 그 밖에는 더하지 않는다: ACCOUNT settings의 정적 allow, `bypassPermissions`, 정책 훅 모두 없다.
- **새 AIRCRAFT.** 돌고 있는 세션은 새 `--settings`를 받지 못하므로, 플래너는 이런 FLIGHT를 그 FLIGHT를 위해 띄우는 AIRCRAFT(launch 카드)에만 짝짓는다.
- **서버만.** `launchAircraft`는 항목을 옵션이 아니라 서버가 만든 별도 인자로 받고, LAUNCH 라우트는 요청 본문의 `settings`·`k3`를 버린다. LAUNCH를 시작하는 라우트는 SUPERVISOR 라우트 인증(ATC-373)이 지킨다.
- **기록.** FLIGHT RECORDER의 `launch` 줄에 `flight`와 `k3: { release, stand, entries }`가 남는다.
- **PARKED(ATC-487).** 후보 팀의 Backlog 이슈 가운데 `blockedBy`가 없고 atc가 직접 올린 것(DUTY REVIEW·SCHEDULE NEW 제안)도 아닌 이슈는 어느 화면에도 없었다. RELEASE 화면에 접힌 절 `PARKED`(기본 닫힘, 머리에 수)가 생겨 key·제목·우선순위·나이·올린 쪽·K 줄·`Sequence:` 줄(막지도 숨기지도 않는다)과 함께 보인다. 상위 이슈, 끝난 이슈, 다른 팀, 나무의 줄, 제안은 싣지 않는다. 줄에는 READY 줄과 같은 **발권** 단추가 있다: 클릭 한 번이 `POST /api/releases/fire` 한 번이고 Origin 검사, 우선순위 0 거절, K3 길(allow 항목은 이 클릭에서만)이 같다. 이 절은 스스로 발권하거나 옮기지 않고 SUPERVISOR QUEUE에 줄을 더하지 않는다. 이슈를 "park"하려면 그대로 둔다. 끄는 스위치 `dispatch.json`의 `releaseParked`(기본 켜짐, 설정 창에서만): 끄면 절이 사라지고 엔드포인트가 PARKED 이슈를 다시 거절한다. 절의 오작동 카운터: 지난 7일에 PARKED에서 발권한 이슈가 24시간 안에 Canceled·Duplicate가 된 수.
- **기다리는 이유와 제목 중복(ATC-488).** RELEASE의 "X 대기" 줄이 X가 왜 줄이 아니고 어디 있는지 막는 이슈마다 한 마디와 링크로 말한다: `PARKED`(접힌 PARKED 절을 연다), `<TEAM> 팀, 후보 아님`(atc가 보이지 않는 팀, Linear 링크), `상위 이슈`(FLIGHTS 서랍), `알 수 없음`(스냅샷에 없음), 그 밖은 상태 이름(`TreeRow.missing`, `releaseTreeOf`). 같은 일이 두 번 올라가는 것은 둘로 잡는다. 둘 다 `similarTickets`(`server/title-dup.ts`)를 쓴다: `duty linear create`는 제목이 열린 ATC 이슈와 거의 같으면 모든 DUTY 턴에서 기존 key(`existing`)와 함께 `409`로 거절한다(Canceled·Duplicate·끝난 쌍은 세지 않고, REVIEW 턴은 자기 검사를 그대로 쓴다). 새 이슈가 일부러 옛 이슈와 비슷하면 호출하는 쪽이 `--same-title-ok`(`sameTitleOk`)를 주고 그 넘김은 센다. MCP로 올린 이슈는 서버 검사를 거치지 않으니 PARKED 줄이 `possible duplicate of ATC-n`을 보인다(정보일 뿐: 아무것도 숨기거나 합치거나 취소하지 않는다). 끄는 스위치 `dispatch.json`의 `duplicateTitle`(기본 켜짐, 설정 창에서만): 끄면 409도 표시도 없다. PARKED 절의 오작동 카운터(7일): 거절, 넘김(거절을 뒤집은 수), 둘 다 발권(표시가 있는 이슈를 쏘는데 쌍도 이미 발권됨). `policy / duplicate-title`로 기록한다.
- **K3 hold(ATC-398).** `## K effects`에 `K3` 줄이 있는데 항목 없이 떠날 FLIGHT는 보내지 않는다. planner가 이유와 고치는 길을 붙여 제외한다: 읽히지 않는 줄은 "not a declaration"(줄을 고친다), `screen`·`duty-chat`이 아닌 발권(또는 그 뒤 본문이 바뀜)은 "release on the screen". 같은 이유가 HOME 알림과, 쏘기 전 RELEASE 줄에 보인다. 스위치 `dispatch.json`의 `k3Hold`(기본 켜짐, 설정 창에서만), 오작동 카운터는 `GET /api/releases`의 `k3Hold.nuisance`·`k3Hold.miss`. [autonomy.ko.md](autonomy.ko.md) C9.
- **K3는 새 LAUNCH가 필요(ATC-509).** 발권된 K3 FLIGHT는 새로 띄운 AIRCRAFT만 받는다. 받을 ABSENT AIRCRAFT가 없으면 `unserved`에 `why: "no-aircraft"`와 `k3: true`로 남고, 제외 사유는 "K3: needs a fresh LAUNCH"와 고치는 길(쉬는 AIRCRAFT를 STOP하거나 `k3Relaunch`를 켠다, 설정 창, 기본 꺼짐)을 말한다. 켜면 FLEET PLAN이 `K3 RELAUNCH` 카드를 낸다([fleet.ko.md](fleet.ko.md) "K3 RELAUNCH, 만든 것").

## 착륙만 기다리는 PR은 AIRCRAFT의 슬롯을 쓰지 않는다 (ATC-387)

FLIGHT가 착륙만 기다리는 동안 AIRCRAFT가 놀지 않는다. 전에는 PR이 열린 진행 중 FLIGHT가 머지될 때까지 그 AIRCRAFT를 "멈춘 팀"으로 붙들었다. 이제 슬롯을 쓰지 않는다.

- **"착륙만 기다림"**(`server/dispatch.ts`의 `waitsToLandOf`): 그 FLIGHT의 열린 PR이 모두 Draft가 아니고, 그 FLIGHT로 열린 FIX·GO AROUND CLEARANCE가 없고, AIRCRAFT가 고칠 막힘이 없다. 허용하는 막힘은 없음(CLEARED), `checks-pending`, `no-review`, `review-stale`, `stacked`, `merge-unknown`(`WAITING_BLOCKS`)뿐이다. 그 밖의 막힘(`checks-failed`, `review-findings`, `changes-requested`, `dirty`, `behind`, `blocked`, `no-checks`, `los`, `draft`, 나중에 생기는 코드)은 할 일이 있다는 뜻이라 슬롯을 계속 쓴다. PR이 없는 FLIGHT도 슬롯을 쓴다.
- **효과**: 기다리는 FLIGHT는 세션이 있는 AIRCRAFT와 ABSENT(`tail:`) AIRCRAFT 모두에서 `holding`(`perTeam` 부하), 열린 FLIGHT 수, "멈춘 팀" 사유에서 빠진다. `AircraftState.waiting`이 그 목록이고 `reason`은 `착륙 대기 PR n건 … 다음 FLIGHT는 새 STAND`로 읽힌다. 일하는 FLIGHT(PR 아직 없음, 실패한 체크, 리뷰 지적, FIX)는 그대로 슬롯을 써서 한 AIRCRAFT가 한 번에 한 FLIGHT를 하는 것은 같다.
- **상한**: `dispatch.json`의 `slots.waitingPr`(기본 2). 기다리는 PR을 그만큼 쥔 AIRCRAFT는 하나가 착륙하기 전까지 STAND가 필요한 FLIGHT를 받지 않는다(STAND 없는 SURVEY·CHECK는 받는다).
- **새 STAND**: AIRCRAFT는 다음 FLIGHT를 새 STAND에서 시작하고 앞 STAND를 남긴다. ASSIGN 카드에 `waitingFlights`가 들어가고, FLIGHT PLAN에 한 줄이 붙는다: 앞 FLIGHT는 자기 STAND에서 착륙만 기다린다, 이 FLIGHT는 새 STAND에서 시작해라, 앞 PR의 FIX·GO AROUND는 앞 STAND에서 처리해라.
- **FIX·GO AROUND는 그대로 닿는다**: TOWER는 PR의 STAND를 점유(claim)한 세션에게 보낸다. 점유는 `ATC_CLAIM_TTL_MIN`(180분)이 지나면 낡는데, `keptStandClaims`(`server/snapshot.ts`)가 열린 PR이 있는 STAND에서 살아 있는 세션의 낡은 점유를 이어 둔다(STAND마다 가장 최근에 건드린 세션 하나, 지금 다른 세션이 쥔 STAND는 건드리지 않는다). 충돌·알림·건강 계산이 끝난 뒤에 더해서 홀더 조회만 본다. CLEARANCE에는 앞 STAND가 실려 AIRCRAFT가 거기서 처리한다.
- **측정**: FIX·GO AROUND CLEARANCE는 낼 때 `elsewhere`를 남긴다: 그 세션이 다른 STAND에서 쥔 진행 중 FLIGHT, 없으면 `null`. METRICS → OPERATIONS의 `FIX·GO AROUND READBACK` 타일이 다른 FLIGHT를 하던 AIRCRAFT와 아닌 AIRCRAFT의 READBACK 중앙값을 나눠 보인다(`clearances.fixReadback`). 필드가 없는 옛 CLEARANCE는 어느 쪽에도 넣지 않는다.
- **형식**(추가만): `slots.waitingPr`, `Proposal.waitingFlights`, `Clearance.elsewhere`, `clearances.fixReadback`.

## CROSSCHECK 은퇴, 만든 것 (ATC-371)

K3: 관제 세션 목록을 바꾸고 mark를 기다리던 승인 규칙을 푼다([autonomy.md](autonomy.md) D23, C14). ATC-367과 ATC-370 뒤에 들어가므로 자동 승인이 멈추지 않는다.

- **세션 없음.** `CONTROL_SESSIONS`가 CROSSCHECK를 `retired`로 둔다: 띄우지 않고, 살려 두지(CONTROL BULK) 않고, 재시작하지(기본 CAP·auto 항목 없음) 않고, FLEET의 관제 목록에도 줄이 없다. 아직 떠 있는 CROSSCHECK 세션은 다음 CONTROL RECYCLE 주기에 서버가 한 번 멈춘다(`retired-stop`, 모드와 상관없이, SUPERVISOR 단계 없음). STOP은 그 세션에 여전히 된다.
- **mark를 기다리는 규칙 없음.** `auto-approve.ts`에서 `no-crosscheck`·`disagree` 건너뛰기를 뺐다(DISPATCH ASSIGN·launch·SCHEDULE. blind, 주의, HELD, FUEL hold, 상한은 그대로). ATFM A7은 없애고 S3는 절 인용 검사만 남긴다(`server/atfm.ts`). ATFM 켜기 점검의 "CROSSCHECK 일치" 두 줄도 뺐다. 서버는 disagree mark로 PREFLIGHT HOLD를 걸지 않고, `POST /api/dispatch/proposals/:id/crosscheck`와 `POST /api/schedule/ops/:id/crosscheck`는 410으로 답한다. brief의 `crosscheck` 블록은 늘 비어 있다.
- **기록은 남는다.** 옛 mark, `preflight` op, 옛 카드의 칩, NETWORK GATES(은퇴로 표시), `gate.crosscheck`는 그대로 읽힌다. `crosscheck/` 폴더와 `controller/guard.mjs`는 건드리지 않았다.

## 세션 없는 AIRCRAFT에 승인된 카드, 만든 것 (ATC-388)

D-0441 사례: TEAM_K에게 낸 ASSIGN 카드를 TEAM_K가 ABSENT(살아 있는 세션 없음)일 때 승인했다. launch 카드가 아니라 아무도 TEAM_K를 띄우지 않았고, `POST …/release`는 없는 곳으로 보내지 않아 카드가 `approved`로 남았다. 이제 승인된 ASSIGN은 늘 출발, LAUNCH, 닫힌 카드 가운데 하나로 끝난다.

- **LAUNCH.** 1분마다 AUTO APPROVE 주기와 별도로, 서버가 승인된 ASSIGN 카드(launch 카드 아님) 가운데 AIRCRAFT에 살아 있는 세션이 없고 RESTARTING도 아닌 것을 본다(`runApprovedRelaunch`, `server/auto-approve-run.ts`). AIRCRAFT가 ABSENT이고 LAUNCH 상한이 모두 허락하면 `relaunch` op를 적고(카드가 launch 카드가 된다) launch 카드와 같은 길로 LAUNCH한 뒤(`by: "auto"`, `auto-approve.jsonl`의 `launch` 줄) 새 세션이 뜨면 FLIGHT PLAN이 간다(`LAUNCHING`). AUTO APPROVE·AUTO DISPATCH 스위치와 상관없이 돈다: SUPERVISOR의 승인이 이미 있다. DISPATCH가 approval 모드여야 한다.
- **상한.** launch 카드의 규칙(`launchWhyNot`): `ATC_MAX_LAUNCHED`(`cap-full`), FUEL hold, LAUNCH 막힘, 실패 뒤 대기(`autoLaunchBackoffMin`), 하루 LAUNCH 상한(`autoLaunchMax`), reset 전인 LIMIT cut(`limit`). atc가 띄운 적 없는 AIRCRAFT(`no-absent`)는 띄울 수 없다.
- **띄울 수 없으면.** 카드는 기다린다. `approvedWaitMin`(`dispatch.json`, 기본 승인 뒤 15분)이 지나면 `승인 뒤 세션 없음 — LAUNCH 못 함(<상한>)…` 사유로 SUPERSEDED로 닫는다. 판정이 아니라서 24시간 짝 규칙을 시작하지 않으므로 FLIGHT는 planner로 돌아가 다른 AIRCRAFT를 받을 수 있다. LAUNCH가 실패하면 다른 launch 카드처럼 `LAUNCH 실패 — …`로 닫는다.
- **센다.** DISPATCH brief의 `approvedNoSession: { waiting, overdue, closed24h, waitMin }`: 세션을 기다리는 승인 카드 수, 그중 `approvedWaitMin`을 넘긴 수(이 주기가 돌면 0으로 남아야 한다), 지난 24시간에 이 사유로 닫은 수.
- **형식.** `relaunch` op와 `approvedWaitMin`은 추가다. `proposals.jsonl`의 다른 것은 바뀌지 않는다.

## OCC가 닿지 못하는 AIRCRAFT는 DISPATCH가 고르지 않는다, 만든 것 (ATC-458)

ATC-251(accounts.md 5.6)의 후속이다. 그때는 계획이 AIRCRAFT를 이미 고른 뒤에 카드가 `ACCOUNT 불일치`라고 말하는 데 그쳤고, 승인된 카드는 FLIGHT를 쥔 채 끝없이 기다렸다.

- **계획 규칙.** 살아 있는 AIRCRAFT의 관찰한 ACCOUNT가 OCC의 관찰한 ACCOUNT와 다르면 `available: false`, `crossAccount: true`이고 사유는 `ACCOUNT 불일치 — <AIRCRAFT>는 ACCOUNT x에 있고 OCC는 y에 있어 … ACCOUNT CHANGE·APPLY NOW …`다(`crossAccountAircraftWhy`, `server/account-reach.ts`. `crossAccountWhyOf`와 같은 규칙: 한쪽 ACCOUNT를 모르면 막지 않는다). ABSENT AIRCRAFT는 그대로다: LAUNCH ACCOUNT로 LAUNCH한다.
- **쥔 FLIGHT 풀기.** 닿지 못하게 된 AIRCRAFT의 열린 ASSIGN 카드(제안·승인, 아직 안 보냄)는 기존 AIRCRAFT 불가 규칙(`syncOps`)으로 `AIRCRAFT 불가: ACCOUNT 불일치 — …` 사유와 함께 SUPERSEDED가 되고, 자동 승인한 카드는 `misfireOf`가 `wrong-aircraft`로 센다. FLIGHT는 계획으로 돌아간다. 판정이 아니라서 24시간 짝 규칙을 시작하지 않는다: 그 AIRCRAFT가 닿게 되면 곧바로 다시 후보다.
- **끄는 스위치.** `dispatch.json`의 `crossAccountRelease`(기본 `on`, 설정 → OPERATIONS → ACCOUNT RELEASE, SUPERVISOR만, `atcctl` 명령 없음, 바꾸면 `policy / cross-account-release-mode`로 기록). `off`면 계획 규칙만 적용되고 카드는 ATC-251 사유로 계속 기다린다(`syncOps`의 `waits` 규칙).
- **세는 곳.** `GET /api/dispatch/misfire`의 날짜별과 `total`에 `crossAccount`(이 규칙으로 닫은 카드, 닫은 날 기준, 누가 승인했든 센다)가 있고, METRICS → MISFIRE에 `ACCOUNT 불일치로 닫은 DISPATCH 카드 n건`으로 보인다.
- **보이는 사유.** 승인된 카드가 ACCOUNT 불일치로 기다리는 동안 FOLLOW 줄과 `GET /api/status`(`now`, 10분 뒤 `stuck`)는 `승인 n분 · 발송 없음` 대신 `승인 n분 · ACCOUNT 불일치 — TEAM_H(acct-1) ≠ OCC(acct-3), OCC가 닿지 못함`을 보인다(`FollowInput.cardWaits`, `crossAccountCardWaitsOf`).
- **형식.** `dispatch.json`의 `crossAccountRelease`와 misfire 보기의 `crossAccount` 수는 추가 항목이다. `proposals.jsonl`은 바뀌지 않는다.

## 막힘 알림이 받을 곳 없는 Todo의 사유를 말한다, as built (ATC-522)

DISPATCH가 `plan.unserved`에 올린 Todo FLIGHT는 `follow|stuck`가 `제안 없이 Todo n분`과 "제외 사유를 확인한다"만 말했다. 이제 알림이 왜 못 받는지와 무엇이 풀어 주는지를 말한다.

- **어느 알림.** `plan.unserved`에 있는 FLIGHT의 `todo-no-proposal` 막힘 표시(우선순위 있는 Todo, 제안 없이 30분)만. `FollowStuck.unserved`가 `why`, `airport`, `ratings`, `tails`, `k3`, 그 AIRPORT 소속 AIRCRAFT를 나른다(`stuckOf`, `server/follow.ts`). 다른 이유로 막힌 Todo(열린 제안, HOLD, 선행 FLIGHT, PREFLIGHT 제외)는 `unserved`가 없어 글과 다음 한 걸음이 그대로다.
- **글과 다음 한 걸음**(`unservedStuckOf`, `server/stuck-unserved.ts`, 순수). 글은 `why`(`no-aircraft`, `unqualified`, `no-tail`)와 AIRPORT, 모자란 RATING을 적는다. 다음 한 걸음: 그 AIRPORT 소속 AIRCRAFT를 LAUNCH(세션 없는 ABSENT는 이름으로, 소속이 한 번도 없으면 "첫 LAUNCH", 모두 바쁘면 기다리거나 하나 더), `unqualified`면 그 RATING을 가진 AIRCRAFT, `no-tail`이면 그 팀. `k3`가 true면 `k3Relaunch`를 켜거나(이미 켜졌으면 K3 RELAUNCH 카드를 승인) 쉬는 AIRCRAFT를 STOP해 새 LAUNCH가 가능하게 한다.
- **끄는 스위치.** `dispatch.json`의 `stuckUnserved`(기본 켜짐, 설정 → OPERATIONS → STUCK UNSERVED, SUPERVISOR만, `atcctl` 명령 없음, 바꾸면 `policy / stuck-unserved-mode`로 기록). 끄면 옛 글. 글만 바뀐다: 막거나 보내거나 숨기는 것은 없다.
- **카운터.** 새 글로 올라온 알림마다 올라올 때 한 번 `policy / stuck-unserved`(`flight`, `why`, `airport`)를 기록한다. `GET /api/stuck-unserved?days=7`이 스위치와 수를 읽는다.
- **형식.** `dispatch.json`의 `stuckUnserved`, 두 `policy` 기록 op, 알림 항목의 `unserved`는 덧붙은 것이다.

## 자리 잡은 카드는 "더 나은 배정"에 밀려나지 않는다, 만든 것 (ATC-547)

자동 운항에서 점수가 낮은 FLIGHT가 카드가 자동 승인되려는 바로 그 순간에 카드를 잃었다. 계획이 `더 나은 배정으로 바뀜`으로 뺀 열린 ASSIGN은 "판정 대기(contested)"로 남았다가 같은 FLIGHT·AIRCRAFT의 더 높은 점수 카드가 만들어지는 즉시 닫혔고, 새 카드는 settle과 같은 주기로 나온다. 2026-10-05에 ATC-539가 30분에 카드를 세 번 잃고 끝내 출발하지 못했다.

- **보호하는 카드**(`guardedOf`, `server/proposals.ts`, 순수). 열린 ASSIGN(HELD·RESUME·PR HOLDER 제외)은 (a) 자동 운항이 켜져 있고 settle(`settleMin`)이 지났거나 다음 계획 주기(`DISPATCH_MS`, 5분) 안에 지날 때, 또는 (c) 그 FLIGHT가 24시간에 이미 두 번 밀려났을 때 보호한다. 보호한 카드는 `더 나은 배정`으로 닫지 않는다. 다른 닫는 사유(FLIGHT 상태, AIRCRAFT 불가, `autoCardTtlMin` 뒤 자동 카드의 STALE)는 그대로라서, 승인되지 못하는 보호 카드가 AIRCRAFT를 쥐는 시간은 길어야 `autoCardTtlMin`(60분)이다.
- **빈 AIRCRAFT가 점수 높은 FLIGHT를 받는다.** 계획이 보호한 카드의 짝을 뺐으면 `runDispatch`가 그 AIRCRAFT와 FLIGHT를 예약으로 넣고 다시 계획한다(`droppedGuardedOf`, PR HOLDER와 같은 두 번 계획): 점수가 높은 FLIGHT는 자격이 맞는 다른 빈 AIRCRAFT로 가고(RATING·AIRPORT 슬롯은 planner가 따진다), 보호한 카드는 AIRCRAFT와 나이를 그대로 지킨다. 빈 AIRCRAFT가 없으면 점수 높은 FLIGHT는 한 주기 기다린다. `syncOps`도 보호한 카드의 FLIGHT·AIRCRAFT에 둘째 카드를 만들지 않는다.
- **그래도 밀려나야 하는 카드**(보호 아님)는 전처럼 SUPERSEDED하되 `supersede` op에 `by`(새 카드)와 `gap`(점수 차)을 적는다. 밀려난 FLIGHT의 다음 카드(같은 바퀴나 30분 안)는 원래 카드의 나이를 이어받는다: `create` op의 `ageFrom`을 `fold`가 카드의 `at`으로 저장하고, SETTLED·자동 승인·TTL이 그 시각부터 센다. `timeline.proposed`는 실제 시각 그대로다.
- **24시간에 두 번.** `displacedCountOf`는 지난 24시간에 `by`가 있는 채 SUPERSEDED된 그 FLIGHT의 카드를 센다. 둘이면 세 번째 카드는 보호한다. 24시간 짝 규칙은 `더 나은 배정` 닫힘을 그대로 뺀다.
- **끄는 스위치.** `dispatch.json`의 `contestGuard`(기본 켜짐, 설정 → OPERATIONS → CONTEST GUARD, SUPERVISOR만, `atcctl` 명령 없음, 바꾸면 `policy / contest-guard-mode`로 기록). `off`면 위 규칙이 모두 빠지고 `syncOps`가 옛 `supersede`를 그대로 쓴다(`by`·`gap`·`ageFrom` 없음).
- **카운터와 misfire.** `GET /api/dispatch/misfire`가 날짜별과 `total`에 `displaced`·`displacedMisfires`를 싣고, METRICS → MISFIRE의 ACCOUNT 줄 옆에 보인다. 밀려난 날에 세고, 밀어낸 카드가 나중에 SUPERSEDED·EXPIRED로 닫히면 misfire다(`displacementMisfire`).
- **형식.** `contestGuard`, `supersede`의 `by`·`gap`, `create`의 `ageFrom`, 접은 카드의 `displacedBy`·`displacedGap`, misfire 두 수는 덧붙은 것이다.

## orphan FLIGHT는 그 REGISTRATION의 슬롯을 쓴다, 만든 것 (ATC-516)

`planDispatch`는 [fleet.md](fleet.md)의 ORPHAN FLIGHT("ORPHAN FLIGHT, 만든 것")를 마지막 선택 입력(`orphans`, REGISTRATION → FLIGHT들. 다섯 호출부 모두 `orphanCountsNow`가 채운다)으로 받는다.

- **앞 세션이 멈춘 뒤 첫 계획부터 센다.** DISPATCH는 알림의 유예를 기다리지 않는다. orphan은 `tail:` FLIGHT처럼 REGISTRATION의 `unfinished` 집합에 들어가 WAKE만큼 `perTeam` 슬롯을 쓴다. 슬롯이 차면 그 REGISTRATION은 `stopped`이고 사유는 `VOC-317 ORPHAN FLIGHT(앞 세션이 멈춘 뒤 아무도 쥐지 않음)`이며 `excluded`에도 나와, 다른 FLIGHT를 받지 않는다. 2026-10-03 07:52의 경우: TEAM_O는 `stopped`이고 VOC-352는 배정되지 않는다.
- **세기를 그친다**: 살아 있는 세션이 쥐거나, PR이 머지되거나, FLIGHT가 취소되면(더는 orphan이 아니다).
- **`orphanOnly`.** orphan이 없으면 멈춤이 없을 때 `AircraftState.orphanOnly`가 그 FLIGHT들을 담는다. `runDispatch`가 MISFIRE 셈을 위해 orphan마다 `hold` 줄을 `orphan-flight-events.jsonl`에 한 번 쓴다.
- **끄는 스위치.** `orphanFlight`가 off면 빈 맵을 넘겨 계획이 전과 똑같다.
- **형식.** `orphan-flight.json`, `orphan-flight-events.jsonl`, `AircraftState.orphanOnly`는 더하기만 한다. `proposals.jsonl`은 그대로다.
- **ABSENT와 살아 있는 AIRCRAFT는 ORPHAN 규칙이 같다(ATC-548).** ABSENT 분기(세션 없음, LAUNCH 후보)도 그 REGISTRATION의 ORPHAN FLIGHT를 살아 있는 분기와 같은 슬롯·WAKE 셈과 같은 `orphanOnly` 표시로 센다: 슬롯이 차면 `stopped`(LAUNCH 카드 없음, 사유가 ORPHAN FLIGHT를 적는다), 남으면 `room`을 가진 `available`이다. 전에는 ABSENT AIRCRAFT에 LAUNCH 카드를 냈다가 세션이 뜨면 DISPATCH가 `AIRCRAFT 멈춤`으로 거두었다(2026-10-03 09:25–09:40). ABSENT AIRCRAFT가 쥔 `tail:` FLIGHT도 이제 무조건 멈추지 않고 같은 슬롯 셈을 쓴다. RESUME 길은 그대로이고 ORPHAN FLIGHT 자신에게는 여전히 먼저 간다. METRICS → MISFIRE 탭이 LAUNCH 뒤 한 settle 안에 `AIRCRAFT 멈춤`으로 거둔 LAUNCH 카드를 날짜별로 센다(`launchStopped`, launch-then-stopped). 0이어야 한다. 새 스위치는 없다: 두 분기를 맞출 뿐이고 `orphanFlight`가 off면 여전히 빈 맵을 넘긴다.

## DIRECT briefs (ATC-32)

상태: 2026-09-28 구현. SUPERVISOR는 요즘 에이전트가 긴 템플릿과 단계별 지시보다, 분명한 목표와 꼭 필요한 제약, 한 번에 끝내도 된다는 허락이 있을 때 더 잘한다는 것을 봤다. atc는 이제 그렇게 일을 넘기고, 그게 실제로 나은지 잰다.

| 용어 | 뜻 |
|---|---|
| **VECTORS** | 지금까지의 지시서. 관제가 방향을 하나씩 준다: 번호 붙은 구현 단계, 전체 템플릿, "구현 전에 묻기" |
| **DIRECT** | 새 지시서. 목표로 "cleared direct". 목표, 완료 기준, 이 작업만의 제약, "끝까지 한 번에"만 담는다. 경로는 팀이 정한다 |
| **SOLO** | CAPTAIN이 FLIGHT를 구현했고 서브에이전트는 도움(조사, 리뷰, 문서)만 했다. 2026-09-28부터 vocado `CLAUDE.md`는 리더가 직접 구현하고 WAKE H나 여러 영역에 걸친 일만 나눈다. ATC-559부터는 모든 AIRPORT의 FLIGHT PLAN이 같은 것을 말한다(아래 "SOLO 기본 as built") |
| **CREW** | 구현을 나눴다: 팀원(서브에이전트)이 하나 이상 FLIGHT의 STAND에 코드를 썼다 |
| **PILOT'S DISCRETION** | DIRECT FLIGHT 안에서 흔한 애매함은 팀이 스스로 푼다. 합리적인 기본값을 고르고 PR에 적고 계속 간다. 정말 SUPERVISOR가 정할 일(guard, 기록 형식, 승인 게이트, SUPERVISOR 몫인 것)만 멈춰서 묻는다 |

AUTOPILOT이라는 말은 쓰지 않는다. 기계가 날고 조종사는 지켜본다는 뜻이라 SUPERVISOR의 게이트가 꺼진 것처럼 들리고, 나중의 진짜 자동화(AUTOLAND 같은)를 위해 남겨 둔다.

늘 지키는 규칙은 제자리(vocado `CLAUDE.md`·`AGENTS.md`, atc `CLAUDE.md`, guard, 브랜치 보호, 승인 게이트)에 두고 지시서에 되풀이하지 않는다. 그것들이 그대로라서 짧은 지시서가 안전하다.

**지시서.** 모든 지시서의 둘째 줄은 `BRIEF: DIRECT`다. 그다음 FLIGHT, 제목과 링크, 이슈 본문에서 옮긴 세 칸(`server/briefs.ts` `directSectionsOf`): `Goal:`, `Done when:`, `Constraints:`로 이름 붙인다(ATC-126: 지시서 글은 영어). 이슈 본문에서는 `목표`(Goal·Outcome), `완료 기준`(Acceptance·Done criteria·Done when·Exit criteria), `이 작업만의 제약`(Constraints·Hard constraints·금지·Forbidden·Invariants·Not in scope) 칸을 찾는다. 칸의 글은 쓴 그대로 싣는다(ATC-58): Linear의 역슬래시 이스케이프를 풀고(`\~31 K` → `~31 K`), `linear.app/<워크스페이스>/issue/<KEY>/…`로 가는 이슈 링크는 key만 남긴다(`ATC-46`. 글을 따로 쓴 링크는 `the design (ATC-46)`처럼 글도 남긴다). Linear가 `linear.app/<워크스페이스>/review/…` 링크로 둔 PR 언급은 링크 글만 남긴다(`chaehy5665/atc#134`, ATC-70). 코드 스팬과 펜스 블록 안은 그대로다. 한 줄짜리 칸이 목록 항목이면 이름표 다음 줄에 싣는다. 완료 기준과 제약은 자르지 않고 모두 싣는다. 목표만 푼 글 기준 600자에서 줄 경계로 자른다(ATC-35). 세 칸을 합쳐 4,000자를 넘으면 일부만 싣지 않고, 목표만 두고 `Read the full done criteria and constraints in the issue body.`라고 적는다. 첫 항목 뒤에서 잘린 목록은 뒤따르는 규칙을 가리기 때문이다. 보통 이슈는 들어간다: ATC-34 본문(약 3,200자)이 시험 fixture다. 허용 범위, 배경, 확인 방법은 링크의 이슈에 둔다. 완료 기준 칸이 없으면 이슈의 완료 기준을 따르라고 적는다. 끝은 PILOT'S DISCRETION 줄, READBACK 요청, `Carry the work through to the end. Stop and ask only for what needs a SUPERVISOR decision.`

- **FLIGHT PLAN**(`formatFlightPlan`): `dispatch release`가 Linear에서 이슈 본문을 읽고(읽기 전용) 지시서를 제안의 `message`로 저장한다. Linear를 못 읽어도 세 칸 없이 보낸다. send-guard는 전처럼 저장된 문구와 비교한다.
- **다른 세션의 배정**(ENGINEERING, 사람): `GET /api/dispatch/flight/:key/brief?to=TEAM_X`가 같은 모양의 문구를 `{key, brief: "DIRECT", text}`로 준다. 손으로 쓴 지시서도 `BRIEF: DIRECT` 줄만 있으면 된다.
- **OCC NEW 초안**(`server/schedule.ts` `missingSections`): 목표(Goal·Outcome)와 완료 기준(Acceptance·Done criteria·Done when·Exit criteria)만 필수이고, 둘 다 내용이 있어야 한다. 마크다운 제목, 굵은 줄, 평문 `목표: …` 이름표 모두 된다. `rating:SEC`는 이 작업만의 보안 한계를 적은 `Hard constraints` 줄(또는 `필수 제약`)이 더 있어야 한다. 예: "staging에 적용하지 않음", "service_role 경로 유지". 허용 범위, 금지 사항, Invariants, Verification은 쓰지 않아도 된다.
- **atc 자체 이슈**: `atc-task` skill은 구현 전에 묻는 대신 PILOT'S DISCRETION을 따른다.

**재기.** FLIGHT를 시작한 메시지에 `BRIEF: DIRECT` 줄이 있으면 DIRECT, 아니면 VECTORS다. 그래서 이 변경 전 FLIGHT는 모두 VECTORS로 센다. LOGBOOK 바퀴(10분마다)가 최근 30일 ARRIVED FLIGHT마다 `measured` 줄을 더한다(`server/logbook.ts` `measureLines`). 빈 칸만 채우고 이미 쓴 값은 바꾸지 않는다.

```json
{"op":"measured","t":"…","key":"owner/repo#85","brief":{"kind":"DIRECT","at":"…","by":"ENGINEERING","readbackAt":"…","questions":0},"crew":"SOLO","rework":1,"findings":{"p0":0,"p1":1,"p2":0}}
```

| 칸 | 출처 |
|---|---|
| `brief` | 그 AIRCRAFT 세션들의 대화 기록(OBSERVED CREW가 잇는 세션과 같다: 살아 있는 세션 이름이나 `custom-title.json`). 지시서는 팀의 READBACK 직전에 받은, 그 FLIGHT를 언급한 마지막 메시지다. READBACK이 없으면 착수 12시간 전 이후의 첫 메시지. `by`는 보낸 세션 이름. AD HOC이거나 지시서를 못 찾으면 `null`, AIRCRAFT나 대화 기록을 아직 모르면 비워 둔다 |
| `readbackAt` | 팀이 보낸 SendMessage 중 READBACK과 그 FLIGHT key(또는 FLIGHT PLAN의 `D-xxxx`)가 든 첫 것 |
| `questions` | 중간 질문: READBACK(없으면 지시서) 뒤 PR을 열기 전까지, 지시한 세션에 보낸 SendMessage(READBACK·PR 보고·팀원에게 보낸 것은 뺌)와 AskUserQuestion 호출 |
| `crew` | **SOLO**·**CREW**(ATC-33): 팀이 어떻게 날았나. 신호는 착수(또는 PR) 하루 전부터 머지까지 FLIGHT의 STAND 안 쓰기다. AIRCRAFT의 서브에이전트(`subagents/agent-*.jsonl`)가 Edit·Write·MultiEdit·NotebookEdit로 문서 밖 파일을 하나라도 썼으면 CREW, 서브에이전트는 안 썼고 CAPTAIN이 그 안에서 일했으면(그 도구들, 또는 STAND 경로를 적은 Bash. CAPTAIN이 python·sed로 고치는 일이 많아서) SOLO. `.md`·`.mdx`·`.txt`는 도움으로 보고, 서브에이전트의 Bash(대개 시험 실행)는 세지 않는다. STAND 안에 흔적이 없으면(다른 세션이 했거나, STAND를 모르거나, 대화 기록이 없음) `null`. 따로 세션으로 도는 agent team 팀원은 OBSERVED CREW처럼 보이지 않는다. ATC-33 전에 쓴 줄은 나중 `measured` 줄이 `crew`만 채운다 |
| `rework` | PR을 연 뒤 작성된 PR 커밋 수, 병합 커밋 제외(rebase해도 작성 시각은 그대로라 다시 세지 않는다) |
| `findings` | P0–P2: Codex 인라인 스레드(배지, 없으면 P2, P3는 뺌) + 외부 착륙 리뷰(head마다 마지막 리뷰). LANDING과 같은 리뷰 스레드 질의로, 한 바퀴에 PR 10건씩 읽는다 |

atc는 대화 기록에서 필요한 줄만 읽고(받은 메시지, SendMessage·AskUserQuestion 호출, 파일 쓰기 도구 호출과 CAPTAIN의 Bash 명령. 서브에이전트 기록에서는 파일 쓰기 호출만. 도구 결과는 읽지 않음) 시각, 받는 곳, FLIGHT key, 표시, 쓴 경로만 메모리에 두며, 위의 수와 구분만 적는다. 대화 기록은 지난번에 읽은 곳부터 이어 읽는다.

**비교.** DISPATCH 탭의 FLIGHT FOLLOWING 아래 **VECTORS · DIRECT** 판이 지시서별, SOLO·CREW별, 둘을 겹친 2×2로 묶어 14·30·90일 동안의 FLIGHT 수, FLIGHT당 중간 질문, 질문 없이 끝낸 비율, READBACK → PR 중앙값, FLIGHT당 P0–P2 지적, FLIGHT당 PR 뒤 수정 커밋을 나란히 보여 주고, FLIGHT별 행을 아래에 접어 둔다. `GET /api/logbook/briefs?days=30`은 `{days, rows, stats: {VECTORS, DIRECT}, crewStats: {SOLO, CREW}, grid: {"VECTORS·SOLO", …}, unmeasured, crewUnknown}`를 돌려준다. 행에는 `crew`가 있고, `crew: null`인 행은 SOLO·CREW 묶음에서 빠진다. 보여 주기만 하고 점수나 배정에 쓰지 않는다. 한쪽이라도 5건 미만이면 표본 부족이라고 적는다.

Not built yet: vocado 쪽 템플릿(vocado `CLAUDE.md`의 네 칸 규칙, Linear `Codex Engineering Task` 템플릿)은 SUPERVISOR가 고친다. 맞춰 고칠 문구는 ATC-32 PR에 제안했다.

## SOLO 기본 as built (ATC-559)

vocado의 SOLO 규칙(위 표의 SOLO 줄)을 모든 AIRPORT로 넓힌다. 지시서 글로 한다: 다른 AIRPORT는 자기 규칙 파일이 아니라 FLIGHT PLAN에서 안다. DISPATCH는 여전히 여러 AIRCRAFT에 FLIGHT를 나란히 보내고, 바뀌는 것은 FLIGHT 하나 안의 나눔뿐이다. 설계: [control-plane.md](control-plane.md) 원칙 5와 W7.

- **규칙**(`server/solo-default.ts` `crewPlanOf`, 순수). WAKE는 다른 곳과 같이 FLIGHT 라벨에서 읽는다(`classOf`, WAKE 라벨이 없으면 M). WAKE **L**·**M** → **SOLO**. WAKE **H**·**J** → **CREW**. **여러 영역(multi-area)** FLIGHT는 WAKE와 상관없이 **CREW**: 라벨에 Linear `Area` 라벨 그룹의 서로 다른 라벨이 둘 이상(`Area:Web`, `Area:Database`) 있거나, DOCS가 아닌 TYPE RATING이 둘 이상(`rating:UI`, `rating:DATA`, `rating:SEC`, `Risk:*` 라벨은 SEC) 있을 때다. 두 가지를 섞어 세지 않는다(`Area:Web`과 `rating:UI`는 같은 영역일 수 있다).
- **줄.** FLIGHT PLAN(`formatFlightPlan`)과 DIRECT 배정 문구(`formatAssignment`, FLEET LAUNCH with a FLIGHT와 K3 RELAUNCH의 첫 프롬프트도 이것)의 PILOT'S DISCRETION 줄 앞에 한 줄:
  - SOLO: `SOLO (WAKE M): fly this FLIGHT as a solo CAPTAIN. Implement it yourself, with no CREW; subagents may search or review but do not write code. If it turns out to need CREW, add it and say why under Pilot's discretion in the PR.`
  - CREW: `CREW (WAKE H): you may split the implementation across your CREW COMPLEMENT.` 또는 `CREW (multi-area: Database, Web): …`.
  - 라벨은 스냅샷의 티켓에서, 티켓이 스냅샷에 없으면 이슈 상세에서 읽는다(상세 조회가 이제 라벨도 읽는다). AIRPORT는 카드의 것이고, DIRECT 문구는 이슈의 프로젝트·팀 매핑(`airportOfTicket`)이다. CREW BRIEFING과 CREW COMPLEMENT는 그대로다.
- **스위치**(SUPERVISOR 전용): 설정 창 AUTOMATION → OPERATIONS → **SOLO**, 열린 AIRPORT마다 `on`/`off` 줄 하나, 상태 폴더의 `solo-default.json`(`{default, airports, migrated}`, 원자적으로 바꿔 쓴다. `PUT /api/settings {soloDefault: {CODE: "on"|"off"}}`, `fromThisApp`, `atcctl` 명령 없음). `off`면 FLIGHT PLAN이 ATC-559 전과 똑같다(줄이 아예 없다). **모든 AIRPORT on**으로 내놓는다: 배포 뒤 첫 서버 시작이 열린 AIRPORT마다 `on`과 `migrated: {id: "ATC-559", at}`를 한 번 쓴다. 파일이 없어도 `on`, 깨졌으면 `off`로 읽고 블록에 그렇게 적힌다. 파일에 없는 AIRPORT는 `default`를 따른다. 다시 보내는 FLIGHT PLAN은 저장된 문구 그대로라, 스위치를 바꾸면 그 뒤에 보내는 것만 달라진다.
- **FLIGHT가 어느 쪽을 받았나**는 제안에 저장된 FLIGHT PLAN 문구(`message`)에서 읽는다: 새 기록이나 칸이 없다.
- **오작동 수**: 스위치 밑에 AIRPORT마다 최근 7일(보여 주기만 하고 어느 것도 스위치를 끄지 않는다). 기준은 `migrated.at` 앞 7일, 같은 AIRPORT, 같은 WAKE다:
  - (a) **CREW를 씀**: SOLO FLIGHT PLAN인데 그 FLIGHT가 나중에 `crew: CREW`로 재졌거나(ATC-33: 서브에이전트가 STAND에 문서 아닌 파일을 씀), 도착 보고의 BLOCKED 줄·UNABLE 사유·SUPERVISOR 질문(`await-supervisor`)에 CREW가 나온 것.
  - (b) **느려짐**: block time(LOGBOOK `blockMin`, DEPARTED → PR 열림. PR 뒤 착륙 대기는 MCC 몫이라 뺀다)이 그 WAKE 기준 중앙값보다 긴 SOLO FLIGHT. 넘음 / 잰 수로 보인다. 기준 FLIGHT가 3개보다 적은 WAKE는 재지 않는다.
  - (c) **WAKE별 착륙한 FLIGHT당 토큰**: 최근 7일에 도착한 FLIGHT의 CAPTAIN + CREW 토큰(LOGBOOK `fuel`, FUEL F4의 FLIGHT 연료) 중앙값 대 기준, L·M·H마다. ATC-551의 관제 몫은 관제 역할별이지 FLIGHT별이 아니라서 따로 작게 읽는다(`server/solo-default-run.ts`).

## 2b 켜는 법

2b는 구현돼 있고 `mode` 뒤에 있다. 켜면 승인한 제안이 실제 팀 세션에 나가므로 이 순서로 한다.

1. DISPATCH 탭에서 "2b 켜기 점검표"(아래)와 2b 진입 점검(그림자 판정 20건 이상, 합의율 80% 이상)을 확인한다.
2. 후보 AIRPORT마다 그 저장소 `CLAUDE.md`의 READBACK 규칙을 넓혀, CAPTAIN이 `[DISPATCH D-xxxx]` FLIGHT PLAN에도 `READBACK D-xxxx`(또는 사유)로, `[OCC CC-xxxx]` CREW CHANGE에는 `READBACK CC-xxxx`로 답하게 한다. 점검표는 `candidateTeams`가 배정할 수 있는 AIRPORT마다(`teamAirports`·`projectAirports`) `readback-*` 항목 하나를 두고 더할 문장을 준다. atc 자신의 루트 `CLAUDE.md`는 이미 이 규칙을 담고 있다(ATC-75). vocado `CLAUDE.md`는 SUPERVISOR가 고치고 atc는 읽기만 한다(`ATC_VOCADO_CLAUDE_MD`로 경로 지정).
3. DISPATCH 탭의 "2b 승인 운용 켜기"(또는 `POST /api/dispatch/mode {"mode":"approval"}`). 돌고 있는 DISPATCH 세션은 다음 바퀴에 모드를 읽는다.
4. 멈추려면 shadow로 되돌린다. 이미 보낸 FLIGHT PLAN은 그대로 두고, 새로 보내지는 않는다.

### 2b 켜기 점검표

`GET /api/dispatch/brief`가 `readiness2b: {items: [{id, label, status, detail, link?, suggestion?}]}`를 돌려준다(`server/readiness.ts`). `status`는 `ready`, `not-ready`, `check`(사람이 봐야 함)다. 표시만 하고, 모드 전환은 SUPERVISOR가 한다.

| id | 계산 |
|---|---|
| `gate` | `gateOf`: 2a 게이트(판정 20건, 일치 80%)를 넘으면 `ready` |
| `recall` | 상수가 아니라 코드 사실로 본다. 합성 기록이 `sent → recalling → recalled`로 접히고 예약이 풀리는지, `formatRecall`이 머리 줄을 만드는지, `recall`·`recall-send`·`recalled` API가 등록됐는지(`DISPATCH_ACTIONS`), `controller/atcctl.mjs`에 `recall-send`·`recalled` 명령이 있는지(`selfCheck2b`) |
| `send-guard` | 서버는 테스트를 돌리지 않는다. `occ/send-guard.mjs`를 읽어 `checkSend` export, approval 모드 확인, FLIGHT PLAN(`proposal.message`)·RECALL(`proposal.recallMessage`)·CREW CHANGE(`change.message`, 받는 사람 `change.registration`) 비교, 받는 사람 확인, `exit 2`가 있는지 보고 파일 sha256 앞자리를 보인다. 모두 있으면 `check`(`node --test occ/send-guard.test.mjs`로 확인하라는 안내), 빠지거나 파일이 없으면 `not-ready` |
| `vocado-readback`, `readback-<code>`(`candidateTeams`가 배정할 수 있는 AIRPORT마다 하나, `server/dispatch.ts`의 `assignableAirportCodes`) | 그 AIRPORT의 `CLAUDE.md`를 읽기만 한다. vocado는 늘 `ATC_VOCADO_CLAUDE_MD`(없으면 `<projectsDir>/vocado_nextjs/CLAUDE.md`), atc 자신의 AIRPORT(`teamAirports.ATC`, 기본 `ATCC`)는 늘 이 저장소의 루트 `CLAUDE.md`, 그 밖은 AIRPORT 등록부(`airports.json`)의 path에서 `<path>/CLAUDE.md`를 읽는다. 한 줄에 `[DISPATCH D-`와 `READBACK D-`가 함께 있고, 한 줄(같은 줄이든 다른 줄이든)에 `[OCC CC-`와 `READBACK CC-`가 함께 있으면 `ready`, 아니면 `not-ready`와 더할 문장(`detail`, `suggestion`), 파일을 못 읽거나 등록부에 AIRPORT가 없으면 `check` |
| `stand-free` | `recall`처럼 코드 사실: SURVEY의 READBACK이 STAND 없이 DEPARTED하고, 30일이 지나도 잡혀 있고 만료되지 않으며, ARRIVED가 풀어 주고, `arrived` API와 `atcctl dispatch arrived`가 있는지 |
| `crew-change` | `recall`처럼 코드 사실(`server/crew-change.ts`의 `selfCheckCrewChange`): 합성 기록이 `pending → approved → sent → acknowledged`로 접히는지, `sent`가 10분 뒤 overdue인지, shadow 모드 승인을 거절하는지, `crewChangeMessage`가 `[OCC CC-xxxx]` 머리와 `READBACK CC-xxxx` 줄을 만드는지, 새 변경이 `approved`는 대신하고 `sent` 뒤에서는 기다리는지, `approve`·`send`·`readback` API와 `atcctl crew-change send`·`readback`이 있는지([fleet.md](fleet.md) 8.4) |
| `known-gaps` | 늘 `check`, 아래 절로 링크 |

### 2b 켜기 전 알려진 빈틈

- `dispatch release` 뒤 메시지가 승인 대기로 잡히면 OCC가 알리기(`dispatch undelivered`, [전달 실패한 FLIGHT PLAN 구현 내용](#전달-실패한-flight-plan-구현-내용atc-183)) 전까지 제안은 SENT로 남는다. 세션이 없는 곳은 보내기 전에 거절하고, `success:false` 결과는 OCC가 기록한다. 전달은 됐는데 답이 없는 경우만 10분 뒤 NO READBACK으로 보이고, OCC가 한 번 재송신한 뒤 SUPERVISOR에게 보고한다.
- STAND 없는 FLIGHT는 OCC가 확인할 때 ARRIVED한다. CAPTAIN 보고로, 또는 그 팀이 한 리뷰·댓글·문서 PR에서 atc가 찾은 ARRIVED 후보로 확인한다(ATC-72, [fleet.ko.md](fleet.ko.md) 5.1.1). atc가 스스로 적지는 않는다. 확인을 잊으면 SUPERVISOR가 `overdue`(24시간)를 보고 챙길 때까지 그 AIRCRAFT의 STAND 없는 칸 하나가 잡혀 있다. send-guard가 FLIGHT PLAN·RECALL·CREW CHANGE만 통과시키므로 OCC가 CAPTAIN에게 직접 묻지 못한다.
- STAND 없는 READBACK은 CAPTAIN이 실제로 시작하지 않아도 DEPARTED로 센다. 일이 시작됐다는 다른 신호가 없다.
- STAND 없는 ARRIVED는 LOGBOOK에 오르지 않아 TARGETS에 세지 않는다. planner는 ARRIVED 뒤 7일 동안 그 FLIGHT를 빼고, 그 뒤에는 Linear를 믿으므로 Linear에서 닫아야 한다.
- FLIGHT TYPE은 READBACK 때 읽는다. 그 뒤에 라벨을 바꿔도 기록된 DEPARTED는 바뀌지 않는다.
- STAND가 있는 DEPARTED는 RECALL할 수 없다. SUPERVISOR가 CAPTAIN에게 직접 말한다.
- `crew-change send`도 `dispatch release`처럼 메시지를 보내기 전에 SENT로 바꾼다. 전달이 실패하면 10분 뒤 overdue로 보이고, OCC가 한 번 재송신한 뒤 보고한다. READBACK을 기다리는 동안 같은 AIRCRAFT의 새 CREW CHANGE도 기다린다([fleet.md](fleet.md) 8.4).
- send-guard의 동작은 테스트로만 증명된다. 점검표는 `ready`가 아니라 `check`로 보인다.
- `readback-*`는 두 표지가 한 줄에 있는지만 본다. 문장 내용은 판단하지 않는다.

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
| 빠른 길 (2026-09-27, ATC-6) | CROSSCHECK가 agree한 카드는 **동의 묶음**에 한 줄씩, 한 번 클릭으로. **한꺼번에 동의는 없다.** 제안 ID로 고른 **20% blind 표본**을 두고, 그 합의율을 게이트 패널에 anchoring 점검으로 따로 보인다(5.6) |

남은 결정: 2b에 들어갈 때 vocado `CLAUDE.md`의 READBACK 규칙을 FLIGHT PLAN(`[DISPATCH D-xxxx]`)까지 넓힐지. 2a에는 필요 없다.
